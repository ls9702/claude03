// Player REST API: session, join, characters, ready, reactions.
import express from 'express';
import { getAvatars, getBalance, getBoardData, getEras, getJobs, getLines, getMc, getNews, getTones } from '../data/index.js';
import {
  addCharacter,
  findPlayer,
  isSpectator,
  joinRoom,
  removeCharacter,
  setReady,
  spectatorFail,
  updateCharacter,
} from '../game/lobby.js';
import { viewFor } from '../game/view.js';
import { validFile, validKey } from '../assets/charArt.js';
import { clientIp, createRateLimiter, sendFail, sessionMiddleware } from './common.js';

export const REACTIONS = ['ㅋㅋㅋ', '헐', '오~', '화이팅', '🐔', '👏', '😂', '😱', '❤️', '🎉'];
const RATE_WINDOW_MS = 2000;
// `timeout` is allowed for players too, but the engine only accepts it once the deadline passed.
const PLAYER_ACTIONS = ['spin', 'choose', 'bet', 'timeout'];
const RATE_MAX = 5;
/** New sessions per IP per minute (POST /api/session). */
export const SESSION_RATE = { windowMs: 60_000, max: 30 };

const ART_CACHE_CONTROL = 'public, max-age=604800'; // a key's files only change on an admin force (then ?v=rev)

export function createApiRouter({ store, runner, charArt = null, sessionRate = SESSION_RATE }) {
  const router = express.Router();
  const requireSession = sessionMiddleware(store);
  const reactionLimiter = createRateLimiter({ windowMs: RATE_WINDOW_MS, max: RATE_MAX }); // per session, self-pruning
  const sessionLimiter = createRateLimiter(sessionRate); // per IP

  router.post('/session', (req, res) => {
    if (!sessionLimiter.hit(clientIp(req))) {
      return res.status(429).json({ error: '접속 요청이 너무 많아요. 잠시 후 다시 시도해 주세요.' });
    }
    res.json({ token: store.createSession() });
  });

  router.get('/session', requireSession, (req, res) => {
    res.json({ ok: true });
  });

  router.get('/meta', async (req, res) => {
    const board = getBoardData();
    const { bets, spin, bonusSpinUnit, stats, military, career } = getBalance();
    const charArtOn = charArt ? await charArt.enabled() : false;
    res.json({
      eras: getEras(),
      avatars: getAvatars(),
      reactions: REACTIONS,
      board: { tileTypes: board.tileTypes, routes: board.routes },
      balance: { bets, spin, bonusSpinUnit, stats, military, career },
      presentation: getTones(), // Stage 5: tone → frame/colors/sfx, scenes (cut-ins + audio)
      features: { charArt: charArtOn }, // Stage 5.5-D: a Gemini key is configured → "✨ AI 일러스트 만들기"
      mc: { ...getMc(), lines: getLines().mc ?? {} }, // Stage 5.6: MC NPC profiles + line pools (lobby greeting, result fallback)
      jobs: getJobs(), // Stage 6: jobs.json (17 regular + 6 hidden + partTime)
      news: getNews(), // Stage 6: news.json (era news flashes; room.news = {eraId: newsId})
    });
  });

  // `spectator: true` → watcher (role 'spectator'): any room status, not counted toward the 4 players.
  router.post('/rooms/join', requireSession, (req, res) => {
    const { code, name, spectator } = req.body ?? {};
    const room = store.findByCode(code);
    if (!room) return res.status(404).json({ error: '방 코드를 찾을 수 없습니다.' });
    const r = joinRoom(room, req.sessionId, name, Date.now(), { spectator: spectator === true });
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
    if (r.ok) charArt?.syncCharacter(r.room, r.character.id); // a cached AI art set of this look → ready
    respond(req, res, r, r.ok ? { characterId: r.character.id } : {});
  });

  router.patch('/rooms/:id/characters/:charId', requireSession, withRoom, (req, res) => {
    const r = updateCharacter(req.room, req.sessionId, req.params.charId, req.body ?? {});
    if (r.ok) charArt?.syncCharacter(r.room, req.params.charId); // edited look → art reset / cached set
    respond(req, res, r);
  });

  router.delete('/rooms/:id/characters/:charId', requireSession, withRoom, (req, res) => {
    const r = removeCharacter(req.room, req.sessionId, req.params.charId);
    if (r.ok) charArt?.cancel(req.room.id, req.params.charId);
    respond(req, res, r);
  });

  // Stage 5.5-D: optional AI illustration set of a character (owner, lobby only, needs a server key).
  router.post('/rooms/:id/characters/:charId/art', requireSession, withRoom, async (req, res, next) => {
    try {
      const c = req.room.characters.find((x) => x.id === req.params.charId);
      if (!c) return res.status(404).json({ error: '캐릭터를 찾을 수 없습니다.' });
      if (c.ownerSessionId !== req.sessionId) return res.status(403).json({ error: '내 캐릭터만 AI 일러스트를 만들 수 있어요.' });
      if (req.room.status !== 'lobby') return res.status(409).json({ error: '로비에서만 AI 일러스트를 만들 수 있어요.' });
      if (!charArt) return res.status(409).json({ error: 'AI 일러스트 기능이 꺼져 있어요' });
      const r = await charArt.request(req.room.id, c.id, { sessionId: req.sessionId });
      if (!r.ok) return sendFail(res, r);
      res.status(r.art.status === 'pending' ? 202 : 200).json({ ok: true, art: r.art, room: viewFor(r.room, req.sessionId) });
    } catch (err) {
      next(err);
    }
  });

  // Generated art files: strict key/file validation + containment in DATA_DIR/char-art.
  router.get('/char-art/:key/:file', (req, res) => {
    const { key, file } = req.params;
    if (!validKey(key) || !validFile(file)) return res.status(400).json({ error: '잘못된 경로입니다.' });
    const p = charArt?.service.filePath(key, file);
    if (!p) return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    res.setHeader('Cache-Control', ART_CACHE_CONTROL);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type('image/webp');
    res.sendFile(p, { dotfiles: 'deny' });
  });

  router.post('/rooms/:id/ready', requireSession, withRoom, (req, res) => {
    respond(req, res, setReady(req.room, req.sessionId, req.body?.ready));
  });

  // Game actions → pure engine inside a store transaction; state + events go out over SSE.
  router.post('/rooms/:id/actions', requireSession, withRoom, (req, res) => {
    const body = req.body ?? {};
    if (!PLAYER_ACTIONS.includes(body.type)) return res.status(400).json({ error: '알 수 없는 행동입니다.' });
    if (isSpectator(findPlayer(req.room, req.sessionId))) return sendFail(res, spectatorFail());
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
    if (!reactionLimiter.hit(req.sessionId)) return res.status(429).json({ error: '리액션을 너무 자주 보냈어요. 잠시 후 다시!' });
    const player = findPlayer(req.room, req.sessionId);
    store.broadcast(req.room.id, 'reaction', { emoji, playerId: player.id, name: player.name, at: now });
    res.json({ ok: true });
  });

  router.limiters = { session: sessionLimiter, reaction: reactionLimiter }; // tests
  return router;
}
