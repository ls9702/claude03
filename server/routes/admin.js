// Admin API under /admin/api — cookie auth with ADMIN_PASSWORD.
import express from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getEras } from '../data/index.js';
import { TURN_TIMEOUTS, defaultRoomConfig, minEraTurns, validateRoomConfig } from '../game/config.js';
import { adminSummary, adminView } from '../game/view.js';
import { addCpuCharacter, removeCpuCharacter } from '../game/lobby.js';
import { clientIp, createRateLimiter, sendFail } from './common.js';

export const ADMIN_COOKIE = 'jinsei_admin';
/** Admin sessions last 7 days and survive restarts (DATA_DIR/admin-sessions.json, token hashes only). */
export const ADMIN_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const COOKIE_MAX_AGE_S = ADMIN_SESSION_TTL_MS / 1000;
/** Login attempts per IP per minute. */
export const LOGIN_RATE = { windowMs: 60_000, max: 10 };
/** Admin game interventions → engine actions. */
export const ADMIN_ACTIONS = ['timeout', 'forceSpin', 'skipTurn'];

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[k] = part.slice(i + 1).trim();
    }
  }
  return out;
}

function safeEqual(a, b) {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

const hashToken = (t) => createHash('sha256').update(String(t)).digest('hex');

/**
 * Persistent admin sessions: Map<sha256(token), expiresAt> mirrored to `<dataDir>/admin-sessions.json`
 * (mode 600, atomic, serialized writes). Expired entries are dropped on load and on every save.
 */
export function createAdminSessions({ dataDir = null, ttlMs = ADMIN_SESSION_TTL_MS, clock = () => Date.now(), log = () => {} } = {}) {
  const file = dataDir ? path.join(dataDir, 'admin-sessions.json') : null;
  const map = new Map();
  if (file) {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8'));
      const now = clock();
      for (const [h, exp] of Object.entries(raw ?? {})) if (typeof exp === 'number' && exp > now) map.set(h, exp);
    } catch (err) {
      if (err.code !== 'ENOENT') log(`관리자 세션 복원 실패: ${err.message}`);
    }
  }
  let chain = Promise.resolve();
  const save = () => {
    if (!file) return chain;
    const now = clock();
    for (const [h, exp] of map) if (exp <= now) map.delete(h);
    const body = JSON.stringify(Object.fromEntries(map));
    chain = chain
      .then(async () => {
        await mkdir(dataDir, { recursive: true });
        const tmp = `${file}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`;
        await writeFile(tmp, body, { mode: 0o600 });
        await rename(tmp, file);
      })
      .catch((err) => log(`관리자 세션 저장 실패: ${err.message}`));
    return chain;
  };
  return {
    create() {
      const token = randomBytes(24).toString('base64url');
      map.set(hashToken(token), clock() + ttlMs);
      save();
      return token;
    },
    valid(token) {
      if (!token) return false;
      const h = hashToken(token);
      const exp = map.get(h);
      if (!exp) return false;
      if (exp <= clock()) {
        map.delete(h);
        save();
        return false;
      }
      return true;
    },
    revoke(token) {
      if (token && map.delete(hashToken(token))) save();
    },
    flush: () => chain,
    size: () => map.size,
  };
}

export function createAdminRouter({ store, runner, adminPassword, charArt = null, loginRate = LOGIN_RATE, sessions = null, log = () => {} }) {
  const router = express.Router();
  const tokens = sessions ?? createAdminSessions({ dataDir: store?.dataDir ?? null, log });
  const loginLimiter = createRateLimiter(loginRate);

  const isAdmin = (req) => tokens.valid(parseCookies(req.get('cookie'))[ADMIN_COOKIE]);

  const requireAdmin = (req, res, next) => {
    if (!isAdmin(req)) return res.status(401).json({ error: '관리자 로그인이 필요합니다.' });
    next();
  };

  router.post('/login', (req, res) => {
    if (!loginLimiter.hit(clientIp(req))) {
      return res.status(429).json({ error: '로그인 시도가 너무 많아요. 1분 후에 다시 시도하세요.' });
    }
    const password = req.body?.password;
    if (typeof password !== 'string' || !safeEqual(password, adminPassword)) {
      return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
    }
    const token = tokens.create();
    res.setHeader(
      'Set-Cookie',
      `${ADMIN_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=${COOKIE_MAX_AGE_S}`,
    );
    res.json({ ok: true });
  });

  router.post('/logout', (req, res) => {
    const t = parseCookies(req.get('cookie'))[ADMIN_COOKIE];
    tokens.revoke(t);
    res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=0`);
    res.json({ ok: true });
  });

  router.get('/me', (req, res) => res.json({ admin: isAdmin(req) }));

  router.get('/meta', requireAdmin, (req, res) => {
    const eras = getEras();
    // Form hints: minimum turns per era for each mode (route eras ≥ 3, kids 고등학생 ≥ 2) + turn timer choices.
    const minTurns = Object.fromEntries(Object.entries(eras.modes).map(([mode, m]) => [mode, Object.fromEntries(m.eras.map((id) => [id, minEraTurns(id, mode)]))]));
    res.json({ eras, defaults: defaultRoomConfig(), turnTimeouts: TURN_TIMEOUTS, minTurns });
  });

  router.get('/rooms', requireAdmin, (req, res) => {
    res.json({ rooms: store.listRooms().map(adminSummary) });
  });

  router.post('/rooms', requireAdmin, (req, res) => {
    const v = validateRoomConfig(req.body ?? {});
    if (!v.ok) return res.status(400).json({ error: v.errors.join(' '), errors: v.errors });
    const room = store.createRoom(v.config);
    res.status(201).json({ room: adminView(room) });
  });

  const withRoom = (req, res, next) => {
    const room = store.getRoom(req.params.id);
    if (!room) return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
    req.room = room;
    next();
  };

  router.get('/rooms/:id', requireAdmin, withRoom, (req, res) => {
    res.json({ room: adminView(req.room) });
  });

  router.post('/rooms/:id/start', requireAdmin, withRoom, (req, res) => {
    const r = runner.start(req.room.id);
    if (!r.ok) return sendFail(res, r);
    res.json({ room: adminView(r.room) });
  });

  router.post('/rooms/:id/end', requireAdmin, withRoom, (req, res) => {
    const r = runner.end(req.room.id);
    if (!r.ok) return sendFail(res, r);
    res.json({ room: adminView(r.room) });
  });

  // Admin interventions (host tools): `timeout` force-resolves the pending prompt (default answers),
  // `forceSpin` spins for the current character now, `skipTurn` ends the current turn without moving.
  router.post('/rooms/:id/actions', requireAdmin, withRoom, (req, res) => {
    const body = req.body ?? {};
    if (!ADMIN_ACTIONS.includes(body.type)) {
      return res.status(400).json({ error: '관리자 행동은 timeout / forceSpin / skipTurn 중 하나여야 합니다.' });
    }
    const room = req.room;
    if (room.status !== 'playing' || !room.turn) return res.status(409).json({ error: '게임이 진행 중이 아니에요.' });
    let action;
    if (body.type === 'timeout') {
      action = { type: 'timeout', promptId: typeof body.promptId === 'string' ? body.promptId : undefined, force: true, actor: { admin: true } };
    } else {
      if (room.turn.phase !== 'awaitSpin' || room.turn.pending) {
        const what = body.type === 'forceSpin' ? '대신 돌리기' : '턴 넘기기';
        return res.status(409).json({ error: `룰렛을 기다리는 중에만 ${what}를 할 수 있어요.` });
      }
      const characterId = room.turn.order[room.turn.currentIndex];
      action = body.type === 'forceSpin' ? { type: 'spin', characterId, actor: { admin: true } } : { type: 'skip', actor: { admin: true } };
    }
    const r = runner.dispatch(room.id, action);
    if (!r.ok) return sendFail(res, r);
    res.json({ room: adminView(r.room), events: r.events });
  });

  // Stage 9-C: CPU characters (lobby only; the admin may add them even without 「CPU 허용」). A room with only
  // CPU characters (+ spectators) can be started by the admin — demos / TV mode.
  router.post('/rooms/:id/cpu', requireAdmin, withRoom, (req, res) => {
    const body = req.body ?? {};
    const r = addCpuCharacter(req.room, { name: body.name, avatar: body.avatar }, Date.now());
    if (!r.ok) return sendFail(res, r);
    store.commit(r.room, r.logs);
    res.status(201).json({ characterId: r.character.id, room: adminView(r.room) });
  });

  router.delete('/rooms/:id/cpu/:charId', requireAdmin, withRoom, (req, res) => {
    const r = removeCpuCharacter(req.room, req.params.charId, Date.now());
    if (!r.ok) return sendFail(res, r);
    store.commit(r.room, r.logs);
    res.json({ room: adminView(r.room) });
  });

  // Stage 5.5-D: (re)generate a character's AI art; ?force=1 ignores the cache and the 1-per-character rule.
  router.post('/rooms/:id/characters/:charId/art', requireAdmin, withRoom, async (req, res, next) => {
    try {
      if (!req.room.characters.some((c) => c.id === req.params.charId)) return res.status(404).json({ error: '캐릭터를 찾을 수 없습니다.' });
      if (!charArt) return res.status(409).json({ error: 'AI 일러스트 기능이 꺼져 있어요' });
      const force = ['1', 'true'].includes(String(req.query.force ?? req.body?.force ?? ''));
      const r = await charArt.request(req.room.id, req.params.charId, { admin: true, force });
      if (!r.ok) return sendFail(res, r);
      res.status(r.art.status === 'pending' ? 202 : 200).json({ ok: true, art: r.art, room: adminView(r.room) });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/rooms/:id', requireAdmin, withRoom, async (req, res) => {
    await store.deleteRoom(req.room.id);
    res.json({ ok: true });
  });

  router.requireAdmin = requireAdmin; // reused by routes/adminAssets.js
  router.adminSessions = tokens;
  return router;
}
