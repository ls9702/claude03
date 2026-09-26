// Player REST API: session, join, characters, ready, reactions.
import express from 'express';
import { getAvatars, getBalance, getBoardData, getEras, getTones } from '../data/index.js';
import {
  addCharacter,
  findPlayer,
  joinRoom,
  removeCharacter,
  setReady,
  updateCharacter,
} from '../game/lobby.js';
import { viewFor } from '../game/view.js';
import { sendFail, sessionMiddleware } from './common.js';

export const REACTIONS = ['ㅋㅋㅋ', '헐', '오~', '화이팅', '🐔', '👏', '😂', '😱', '❤️', '🎉'];
const RATE_WINDOW_MS = 2000;
// `timeout` is allowed for players too, but the engine only accepts it once the deadline passed.
const PLAYER_ACTIONS = ['spin', 'choose', 'bet', 'timeout'];
const RATE_MAX = 5;

export function createApiRouter({ store, runner }) {
  const router = express.Router();
  const requireSession = sessionMiddleware(store);
  const reactionTimes = new Map(); // sessionId -> timestamps

  router.post('/session', (req, res) => {
    res.json({ token: store.createSession() });
  });

  router.get('/session', requireSession, (req, res) => {
    res.json({ ok: true });
  });

  router.get('/meta', (req, res) => {
    const board = getBoardData();
    const { bets, spin, bonusSpinUnit } = getBalance();
    res.json({
      eras: getEras(),
      avatars: getAvatars(),
      reactions: REACTIONS,
      board: { tileTypes: board.tileTypes, routes: board.routes },
      balance: { bets, spin, bonusSpinUnit },
      presentation: getTones(), // Stage 5: tone → frame/colors/sfx, scenes (cut-ins + audio)
    });
  });

  router.post('/rooms/join', requireSession, (req, res) => {
    const { code, name } = req.body ?? {};
    const room = store.findByCode(code);
    if (!room) return res.status(404).json({ error: '방 코드를 찾을 수 없습니다.' });
    const r = joinRoom(room, req.sessionId, name);
    if (!r.ok) return sendFail(res, r);
    store.commit(r.room, r.logs);
    res.json({ roomId: r.room.id, room: viewFor(r.room, req.sessionId) });
  });

  // Room-scoped routes: load room and require membership.
  const withRoom = (req, res, next) => {
    const room = store.getRoom(req.params.id);
    if (!room) return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
    if (!findPlayer(room, req.sessionId)) return res.status(403).json({ error: '이 방의 참가자가 아닙니다.' });
    req.room = room;
    next();
  };

  const respond = (req, res, r, extra = {}) => {
    if (!r.ok) return sendFail(res, r);
    store.commit(r.room, r.logs);
    res.json({ ok: true, ...extra, room: viewFor(r.room, req.sessionId) });
  };

  router.get('/rooms/:id', requireSession, withRoom, (req, res) => {
    res.json(viewFor(req.room, req.sessionId));
  });

  router.post('/rooms/:id/characters', requireSession, withRoom, (req, res) => {
    const r = addCharacter(req.room, req.sessionId, req.body ?? {});
    respond(req, res, r, r.ok ? { characterId: r.character.id } : {});
  });

  router.patch('/rooms/:id/characters/:charId', requireSession, withRoom, (req, res) => {
    respond(req, res, updateCharacter(req.room, req.sessionId, req.params.charId, req.body ?? {}));
  });

  router.delete('/rooms/:id/characters/:charId', requireSession, withRoom, (req, res) => {
    respond(req, res, removeCharacter(req.room, req.sessionId, req.params.charId));
  });

  router.post('/rooms/:id/ready', requireSession, withRoom, (req, res) => {
    respond(req, res, setReady(req.room, req.sessionId, req.body?.ready));
  });

  // Game actions → pure engine inside a store transaction; state + events go out over SSE.
  router.post('/rooms/:id/actions', requireSession, withRoom, (req, res) => {
    const body = req.body ?? {};
    if (!PLAYER_ACTIONS.includes(body.type)) return res.status(400).json({ error: '알 수 없는 행동입니다.' });
    const action = {
      type: body.type,
      characterId: typeof body.characterId === 'string' ? body.characterId : undefined,
      promptId: typeof body.promptId === 'string' ? body.promptId : undefined,
      optionId: typeof body.optionId === 'string' ? body.optionId : undefined,
      kind: body.kind,
      pick: body.pick,
      amount: body.amount,
      actor: { sessionId: req.sessionId },
    };
    const r = runner.dispatch(req.room.id, action);
    if (!r.ok) return sendFail(res, r);
    res.json({ ok: true, events: r.events, room: viewFor(r.room, req.sessionId) });
  });

  // Emoji reactions: SSE broadcast only, never stored in room state.
  router.post('/rooms/:id/reactions', requireSession, withRoom, (req, res) => {
    const emoji = req.body?.emoji;
    if (!REACTIONS.includes(emoji)) return res.status(400).json({ error: '사용할 수 없는 리액션입니다.' });
    const now = Date.now();
    const times = (reactionTimes.get(req.sessionId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    if (times.length >= RATE_MAX) return res.status(429).json({ error: '리액션을 너무 자주 보냈어요. 잠시 후 다시!' });
    times.push(now);
    reactionTimes.set(req.sessionId, times);
    const player = findPlayer(req.room, req.sessionId);
    store.broadcast(req.room.id, 'reaction', { emoji, playerId: player.id, name: player.name, at: now });
    res.json({ ok: true });
  });

  return router;
}
