// Admin API under /admin/api — cookie auth with ADMIN_PASSWORD.
import express from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getEras } from '../data/index.js';
import { validateRoomConfig, defaultRoomConfig } from '../game/config.js';
import { adminSummary, adminView } from '../game/view.js';
import { sendFail } from './common.js';

export const ADMIN_COOKIE = 'jinsei_admin';
const COOKIE_MAX_AGE_S = 60 * 60 * 12;

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

export function createAdminRouter({ store, runner, adminPassword, charArt = null }) {
  const router = express.Router();
  const tokens = new Map(); // token -> expiresAt

  const isAdmin = (req) => {
    const t = parseCookies(req.get('cookie'))[ADMIN_COOKIE];
    const exp = t && tokens.get(t);
    if (!exp) return false;
    if (exp < Date.now()) {
      tokens.delete(t);
      return false;
    }
    return true;
  };

  const requireAdmin = (req, res, next) => {
    if (!isAdmin(req)) return res.status(401).json({ error: '관리자 로그인이 필요합니다.' });
    next();
  };

  router.post('/login', (req, res) => {
    const password = req.body?.password;
    if (typeof password !== 'string' || !safeEqual(password, adminPassword)) {
      return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
    }
    const token = randomBytes(24).toString('base64url');
    tokens.set(token, Date.now() + COOKIE_MAX_AGE_S * 1000);
    res.setHeader(
      'Set-Cookie',
      `${ADMIN_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=${COOKIE_MAX_AGE_S}`,
    );
    res.json({ ok: true });
  });

  router.post('/logout', (req, res) => {
    const t = parseCookies(req.get('cookie'))[ADMIN_COOKIE];
    if (t) tokens.delete(t);
    res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=0`);
    res.json({ ok: true });
  });

  router.get('/me', (req, res) => res.json({ admin: isAdmin(req) }));

  router.get('/meta', requireAdmin, (req, res) => {
    res.json({ eras: getEras(), defaults: defaultRoomConfig() });
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

  // Admin interventions. Stage 2: force-timeout the pending prompt (default answers).
  router.post('/rooms/:id/actions', requireAdmin, withRoom, (req, res) => {
    const body = req.body ?? {};
    if (body.type !== 'timeout') return res.status(400).json({ error: '관리자는 timeout만 실행할 수 있습니다.' });
    const r = runner.dispatch(req.room.id, { type: 'timeout', promptId: body.promptId, force: true, actor: { admin: true } });
    if (!r.ok) return sendFail(res, r);
    res.json({ room: adminView(r.room), events: r.events });
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
  return router;
}
