// Verifier fixes (server side): admin password file, persistent admin sessions, login/session rate limits,
// host tools (forceSpin/skipTurn, turn timer auto spin), spectators over HTTP, SSE stream cap, player
// session TTL, ordered snapshot writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { startServer } from '../server/index.js';
import { resolveAdminPassword } from '../server/config.js';
import { LOGIN_RATE } from '../server/routes/admin.js';
import { SESSION_RATE } from '../server/routes/api.js';
import { createRateLimiter } from '../server/routes/common.js';
import { RoomStore } from '../server/store/roomStore.js';
import { GameRunner } from '../server/store/gameRunner.js';
import { addCharacter, joinRoom } from '../server/game/lobby.js';
import { validateRoomConfig } from '../server/game/config.js';
import { httpCall, tempDir } from './helpers.js';

const boot = (dataDir, extra = {}) => startServer({ port: 0, host: '127.0.0.1', dataDir, debounceMs: 5, ...extra });

async function login(srv, password) {
  const r = await httpCall(srv.url, 'POST', '/admin/api/login', { body: { password } });
  return { status: r.status, json: r.json, cookie: r.headers.get('set-cookie')?.split(';')[0] };
}

test('admin password: generated once (10 chars, mode 600), printed once, kept across restarts', async () => {
  const tmp = await tempDir();
  try {
    const a = resolveAdminPassword(tmp.dir);
    assert.equal(a.source, 'generated');
    assert.match(a.password, /^[A-Za-z0-9]{10}$/);
    assert.equal((await stat(a.file)).mode & 0o777, 0o600);
    const b = resolveAdminPassword(tmp.dir);
    assert.deepEqual([b.source, b.password], ['file', a.password]);
    assert.deepEqual(resolveAdminPassword(tmp.dir, 'env-pw'), { password: 'env-pw', source: 'env' });

    const dir = path.join(tmp.dir, 'srv');
    const logs = [];
    let srv = await boot(dir, { log: (m) => logs.push(String(m)) });
    const pw = (await readFile(path.join(dir, 'admin-password'), 'utf8')).trim();
    assert.ok(logs.some((l) => l.includes(pw) && /관리자 비밀번호를 새로 만들었습니다/.test(l)), 'printed once when generated');
    assert.equal((await login(srv, pw)).status, 200);
    assert.equal((await login(srv, 'admin')).status, 401, 'no default "admin" password any more');
    await srv.close();
    logs.length = 0;
    srv = await boot(dir, { log: (m) => logs.push(String(m)) });
    assert.ok(!logs.some((l) => l.includes(pw)), 'not printed again');
    assert.equal((await login(srv, pw)).status, 200, 'same password after restart');
    await srv.close();
  } finally {
    await tmp.cleanup();
  }
});

test('admin sessions survive a restart (hashed tokens, 7 days); logout revokes', async () => {
  const tmp = await tempDir();
  try {
    let srv = await boot(tmp.dir, { adminPassword: 'pw' });
    const { cookie } = await login(srv, 'pw');
    assert.match(cookie, /^jinsei_admin=/);
    await srv.close();
    const file = await readFile(path.join(tmp.dir, 'admin-sessions.json'), 'utf8');
    assert.ok(!file.includes(cookie.split('=')[1]), 'raw token never stored');
    assert.equal((await stat(path.join(tmp.dir, 'admin-sessions.json'))).mode & 0o777, 0o600);
    srv = await boot(tmp.dir, { adminPassword: 'pw' });
    assert.deepEqual((await httpCall(srv.url, 'GET', '/admin/api/me', { cookie })).json, { admin: true });
    assert.equal((await httpCall(srv.url, 'GET', '/admin/api/rooms', { cookie })).status, 200);
    await httpCall(srv.url, 'POST', '/admin/api/logout', { cookie });
    assert.deepEqual((await httpCall(srv.url, 'GET', '/admin/api/me', { cookie })).json, { admin: false });
    await srv.close();
  } finally {
    await tmp.cleanup();
  }
});

test('rate limits: admin login per IP (429), POST /api/session per IP; limiter prunes stale keys', async () => {
  assert.deepEqual(LOGIN_RATE, { windowMs: 60_000, max: 10 });
  assert.deepEqual(SESSION_RATE, { windowMs: 60_000, max: 30 });
  const tmp = await tempDir();
  try {
    const srv = await boot(tmp.dir, { adminPassword: 'pw', rate: { login: { windowMs: 60_000, max: 3 }, session: { windowMs: 60_000, max: 4 } } });
    for (let i = 0; i < 3; i++) assert.equal((await login(srv, 'wrong')).status, 401);
    const blocked = await login(srv, 'pw');
    assert.equal(blocked.status, 429, 'even the right password is throttled');
    assert.match(blocked.json.error, /로그인 시도가 너무 많아요/);
    for (let i = 0; i < 4; i++) assert.equal((await httpCall(srv.url, 'POST', '/api/session')).status, 200);
    const s = await httpCall(srv.url, 'POST', '/api/session');
    assert.equal(s.status, 429);
    assert.match(s.json.error, /잠시 후/);
    await srv.close();
  } finally {
    await tmp.cleanup();
  }
  let now = 0;
  const lim = createRateLimiter({ windowMs: 1000, max: 2, clock: () => now });
  assert.equal(lim.hit('a'), true);
  assert.equal(lim.hit('a'), true);
  assert.equal(lim.hit('a'), false);
  for (let i = 0; i < 50; i++) lim.hit(`k${i}`);
  now = 5000;
  lim.hit('fresh');
  assert.equal(lim.size(), 1, 'stale keys pruned');
  assert.equal(lim.hit('a'), true, 'window slid');
});

test('host tools over HTTP: forceSpin / skipTurn / timeout phases; spectators join and are read-only', async () => {
  const tmp = await tempDir();
  const srv = await boot(tmp.dir, { adminPassword: 'pw' });
  const call = (m, p, o) => httpCall(srv.url, m, p, o);
  try {
    const { cookie } = await login(srv, 'pw');
    const meta = (await call('GET', '/admin/api/meta', { cookie })).json;
    assert.deepEqual(meta.turnTimeouts, [0, 30, 60, 90, 120]);
    assert.equal(meta.defaults.turnTimeoutSec, 0);
    assert.deepEqual([meta.minTurns.lifetime.young, meta.minTurns.kids.high, meta.minTurns.lifetime.high], [3, 2, 1]);
    const created = await call('POST', '/admin/api/rooms', { cookie, body: { mode: 'adult', eraTurns: { young: 5, middle_age: 5, senior: 3 }, turnTimeoutSec: 60 } });
    assert.equal(created.status, 201);
    assert.equal(created.json.room.config.turnTimeoutSec, 60);
    const bad = await call('POST', '/admin/api/rooms', { cookie, body: { eraTurns: { young: 2 } } });
    assert.equal(bad.status, 400);
    assert.match(bad.json.error, /청년 턴 수는 갈림길·합류 칸이 있어 3 이상/);
    const { id, code } = created.json.room;
    const A = (await call('POST', '/api/session')).json.token;
    const W = (await call('POST', '/api/session')).json.token;
    await call('POST', '/api/rooms/join', { token: A, body: { code, name: '에이' } });
    await call('POST', `/api/rooms/${id}/characters`, { token: A, body: { name: '에이1' } });
    await call('POST', `/api/rooms/${id}/characters`, { token: A, body: { name: '에이2' } });
    // before the game: admin actions need a playing room
    assert.equal((await call('POST', `/admin/api/rooms/${id}/actions`, { cookie, body: { type: 'forceSpin' } })).status, 409);
    assert.equal((await call('POST', `/admin/api/rooms/${id}/start`, { cookie })).status, 200);

    // spectator joins a playing room
    const j = await call('POST', '/api/rooms/join', { token: W, body: { code, name: '관전러', spectator: true } });
    assert.equal(j.status, 200, j.text);
    assert.equal(j.json.room.me.role, 'spectator');
    assert.equal(j.json.room.players.find((p) => p.isMe).role, 'spectator');
    const cur = j.json.room.turn.order[j.json.room.turn.currentIndex];
    assert.equal(typeof j.json.room.turn.spinDeadlineAt, 'number');
    for (const body of [{ type: 'spin', characterId: cur }, { type: 'bet', characterId: cur, kind: 'oddEven', pick: 'odd', amount: 5 }, { type: 'choose', characterId: cur, promptId: 'pr1', optionId: 'x' }]) {
      const r = await call('POST', `/api/rooms/${id}/actions`, { token: W, body });
      assert.equal(r.status, 403, body.type);
      assert.match(r.json.error, /관전자/);
    }
    assert.equal((await call('POST', `/api/rooms/${id}/characters`, { token: W, body: { name: '몰래' } })).status, 403, 'spectators never create characters');
    assert.equal((await call('POST', `/api/rooms/${id}/reactions`, { token: W, body: { emoji: '👏' } })).status, 200, 'reactions allowed');
    const late = await call('POST', '/api/rooms/join', { token: (await call('POST', '/api/session')).json.token, body: { code, name: '늦음' } });
    assert.equal(late.status, 409);
    assert.match(late.json.error, /관전/);

    // unknown admin action
    assert.equal((await call('POST', `/admin/api/rooms/${id}/actions`, { cookie, body: { type: 'nope' } })).status, 400);
    // timeout with nothing pending
    assert.equal((await call('POST', `/admin/api/rooms/${id}/actions`, { cookie, body: { type: 'timeout' } })).status, 409);
    // skipTurn: next character, no movement
    const skip = await call('POST', `/admin/api/rooms/${id}/actions`, { cookie, body: { type: 'skipTurn' } });
    assert.equal(skip.status, 200, skip.text);
    assert.notEqual(skip.json.room.turn.order[skip.json.room.turn.currentIndex], cur);
    assert.deepEqual(skip.json.room.characters.find((c) => c.id === cur).position, { eraIndex: 0, route: 'main', index: -1 });
    // forceSpin: spins for the current character → lands on the 갈림길 stop (adult mode: job offer, then routeChoice)
    const fs = await call('POST', `/admin/api/rooms/${id}/actions`, { cookie, body: { type: 'forceSpin' } });
    assert.equal(fs.status, 200, fs.text);
    assert.ok(fs.json.events.some((e) => e.type === 'spun'));
    assert.equal(fs.json.room.turn.pending.kind, 'jobOffer');
    assert.equal(typeof fs.json.room.turn.pending.deadlineAt, 'number', 'single prompt gets the 60 s turn timer');
    for (const type of ['forceSpin', 'skipTurn']) {
      const r = await call('POST', `/admin/api/rooms/${id}/actions`, { cookie, body: { type } });
      assert.equal(r.status, 409, type);
      assert.match(r.json.error, /룰렛을 기다리는 중에만/);
    }
    const to1 = await call('POST', `/admin/api/rooms/${id}/actions`, { cookie, body: { type: 'timeout' } });
    assert.equal(to1.status, 200);
    assert.equal(to1.json.room.turn.pending.kind, 'routeChoice');
    const to = await call('POST', `/admin/api/rooms/${id}/actions`, { cookie, body: { type: 'timeout' } });
    assert.equal(to.status, 200);
    assert.equal(to.json.room.turn.phase, 'awaitSpin');
  } finally {
    await srv.close();
    await tmp.cleanup();
  }
});

test('SSE: at most 3 streams per session per room — the oldest is closed', async () => {
  const tmp = await tempDir();
  const srv = await boot(tmp.dir, { adminPassword: 'pw' });
  try {
    const { cookie } = await login(srv, 'pw');
    const { id, code } = (await httpCall(srv.url, 'POST', '/admin/api/rooms', { cookie, body: {} })).json.room;
    const T = (await httpCall(srv.url, 'POST', '/api/session')).json.token;
    await httpCall(srv.url, 'POST', '/api/rooms/join', { token: T, body: { code, name: '탭' } });
    const ctrls = [];
    const streams = [];
    for (let i = 0; i < 4; i++) {
      const ctrl = new AbortController();
      ctrls.push(ctrl);
      const res = await fetch(`${srv.url}/api/rooms/${id}/events?token=${T}`, { signal: ctrl.signal });
      streams.push(res.body.getReader());
    }
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(srv.store.subscriberCount(id, T), 3);
    // the first stream ends (drain until done)
    const drain = async (reader) => {
      for (;;) {
        const { done } = await reader.read();
        if (done) return true;
      }
    };
    let timer;
    const timeout = new Promise((r) => (timer = setTimeout(() => r(false), 2000)));
    assert.equal(await Promise.race([drain(streams[0]), timeout]), true);
    clearTimeout(timer);
    const room = srv.store.getRoom(id);
    assert.equal(room.players[0].connected, true, 'still connected through the newer streams');
    for (const c of ctrls) c.abort();
    await Promise.all(streams.map((r) => r.cancel().catch(() => {})));
    await new Promise((r) => setTimeout(r, 30));
  } finally {
    await srv.close();
    await tmp.cleanup();
  }
});

test('player sessions: pruned after the TTL unless still in a room (boot + interval)', async () => {
  const tmp = await tempDir();
  try {
    let now = 1_000_000_000;
    const store = new RoomStore({ dataDir: tmp.dir, debounceMs: 1, clock: () => now, sessionTtlMs: 1000 });
    await store.load();
    const old = store.createSession();
    const member = store.createSession();
    const room = store.createRoom(validateRoomConfig({}).config, now);
    store.put(joinRoom(room, member, '멤버', now).room);
    now += 500;
    const active = store.createSession();
    now += 600; // old + member are past the TTL, active is not
    assert.equal(store.pruneSessions(), 1);
    assert.equal(store.hasSession(old), false);
    assert.equal(store.hasSession(member), true, 'room members keep their session');
    assert.equal(store.hasSession(active), true);
    // hasSession refreshes lastSeenAt
    now += 900;
    assert.equal(store.pruneSessions(), 0, 'active was used just now');
    await store.close();
    // boot prunes too
    now += 5000;
    const again = new RoomStore({ dataDir: tmp.dir, clock: () => now, sessionTtlMs: 1000 });
    await again.load();
    assert.equal(again.hasSession(active), false);
    assert.equal(again.hasSession(member), true);
    await again.close();
  } finally {
    await tmp.cleanup();
  }
});

test('snapshot writes are ordered per room: an older (slower) write never overwrites a newer one', async () => {
  const tmp = await tempDir();
  try {
    const store = new RoomStore({ dataDir: tmp.dir, debounceMs: 1 });
    await store.load();
    const room = store.createRoom(validateRoomConfig({}).config);
    const big = { ...room, version: 1, log: Array.from({ length: 40000 }, (_, i) => ({ at: i, type: 'info', text: `긴 로그 ${i} `.repeat(4) })) };
    store.rooms.set(room.id, big);
    const writes = [store.saveNow(room.id)];
    for (let v = 2; v <= 6; v++) {
      store.rooms.set(room.id, { ...room, version: v });
      writes.push(store.saveNow(room.id));
    }
    await Promise.all(writes);
    await store.flush();
    const saved = JSON.parse(await readFile(path.join(tmp.dir, 'saves', `${room.id}.json`), 'utf8'));
    assert.equal(saved.version, 6);
    await store.close();
  } finally {
    await tmp.cleanup();
  }
});

test('turn timer: the runner auto-spins after turnTimeoutSec and defaults a single prompt', async (t) => {
  const tmp = await tempDir();
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  try {
    const store = new RoomStore({ dataDir: tmp.dir, debounceMs: 1 });
    await store.load();
    const runner = new GameRunner(store, { secret: () => 99 });
    const cfg = validateRoomConfig({ mode: 'adult', eraTurns: { young: 5, middle_age: 5, senior: 3 }, turnTimeoutSec: 30 }).config;
    let room = store.createRoom(cfg);
    room = joinRoom(room, 'S', '에스').room;
    room = addCharacter(room, 'S', { name: '하나' }).room;
    room = addCharacter(room, 'S', { name: '둘' }).room;
    store.put(room);
    assert.equal(runner.start(room.id).ok, true);
    const first = store.getRoom(room.id);
    assert.equal(first.turn.spinDeadlineAt, 1_000_000 + 30_000);
    t.mock.timers.tick(29_000);
    assert.equal(store.getRoom(room.id).turn.lastSpin, null, 'not yet');
    t.mock.timers.tick(1_100);
    const spun = store.getRoom(room.id);
    assert.equal(spun.turn.lastSpin?.charId, first.turn.order[0], 'auto spin for the current character');
    assert.ok(spun.log.some((l) => /자동으로 돌렸어요/.test(l.text)));
    // landed on the 갈림길 stop → single prompts with the same timer (adult mode: job offer, then the route)
    // → default answers on timeout
    assert.equal(spun.turn.pending?.kind, 'jobOffer');
    assert.equal(spun.turn.pending.deadlineAt, spun.updatedAt + 30_000);
    t.mock.timers.tick(30_100);
    const routed = store.getRoom(room.id);
    assert.equal(routed.turn.pending?.kind, 'routeChoice');
    assert.equal(routed.turn.pending.deadlineAt, routed.updatedAt + 30_000);
    t.mock.timers.tick(30_100);
    const after = store.getRoom(room.id);
    assert.equal(after.turn.pending, null);
    assert.equal(after.characters.find((c) => c.id === first.turn.order[0]).route, 'career', 'default option');
    assert.equal(after.turn.order[after.turn.currentIndex], first.turn.order[1]);
    assert.equal(typeof after.turn.spinDeadlineAt, 'number');
    runner.stop();
    t.mock.timers.reset();
    await store.close();
  } finally {
    t.mock.timers.reset();
    await tmp.cleanup();
  }
});
