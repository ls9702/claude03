// Admin API under /admin/api — cookie auth with ADMIN_PASSWORD.
import express from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getEras } from '../data/index.js';
import { validateRoomConfig, defaultRoomConfig } from '../game/config.js';
import { endGame, startGame } from '../game/lobby.js';
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

export function createAdminRouter({ store, adminPassword }) {
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
    const r = startGame(req.room);
    if (!r.ok) return sendFail(res, r);
    store.commit(r.room, r.logs);
    res.json({ room: adminView(r.room) });
  });

  router.post('/rooms/:id/end', requireAdmin, withRoom, (req, res) => {
    const r = endGame(req.room);
    if (!r.ok) return sendFail(res, r);
    store.commit(r.room, r.logs);
    res.json({ room: adminView(r.room) });
  });

  router.delete('/rooms/:id', requireAdmin, withRoom, async (req, res) => {
    await store.deleteRoom(req.room.id);
    res.json({ ok: true });
  });

  router.requireAdmin = requireAdmin; // reused by routes/adminAssets.js
  return router;
}
