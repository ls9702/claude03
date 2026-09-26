import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { httpCall, sseReader, tempDir } from './helpers.js';

let srv;
let tmp;

before(async () => {
  tmp = await tempDir();
  srv = await startServer({ port: 0, host: '127.0.0.1', dataDir: tmp.dir, adminPassword: 'pw', debounceMs: 10 });
});

after(async () => {
  await srv?.close();
  await tmp?.cleanup();
});

const call = (method, path, opts) => httpCall(srv.url, method, path, opts);

test('end-to-end lobby flow over HTTP + SSE', async () => {
  // static pages
  const home = await call('GET', '/');
  assert.equal(home.status, 200);
  assert.match(home.text, /인생게임/);
  const adminPage = await call('GET', '/admin');
  assert.equal(adminPage.status, 200);
  assert.match(adminPage.text, /관리자/);

  // sessions
  const A = (await call('POST', '/api/session')).json.token;
  const B = (await call('POST', '/api/session')).json.token;
  assert.ok(A && B && A !== B);
  assert.equal((await call('GET', '/api/session', { token: 'bogus' })).status, 401);

  // admin auth
  assert.equal((await call('POST', '/admin/api/rooms', { body: {} })).status, 401);
  assert.equal((await call('POST', '/admin/api/login', { body: { password: 'wrong' } })).status, 401);
  const login = await call('POST', '/admin/api/login', { body: { password: 'pw' } });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.match(login.headers.get('set-cookie'), /HttpOnly/);

  const bad = await call('POST', '/admin/api/rooms', { cookie, body: { eraTurns: { baby: 0 }, maxCharacters: 9 } });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.errors.length, 2);

  const created = await call('POST', '/admin/api/rooms', { cookie, body: { eraTurns: { young: 10 }, maxCharacters: 8 } });
  assert.equal(created.status, 201);
  const { id: roomId, code } = created.json.room;
  assert.equal(created.json.room.config.eraTurns.young, 10);

  // join
  assert.equal((await call('POST', '/api/rooms/join', { token: A, body: { code: 'ZZZZZZ', name: 'x' } })).status, 404);
  const jA = await call('POST', '/api/rooms/join', { token: A, body: { code: code.toLowerCase(), name: '에이' } });
  assert.equal(jA.status, 200);
  assert.equal(jA.json.roomId, roomId);
  assert.equal(jA.json.room.me.name, '에이');

  // SSE: B isn't a player yet → 403
  assert.equal((await call('GET', `/api/rooms/${roomId}/events?token=${B}`)).status, 403);
  assert.equal((await call('GET', `/api/rooms/${roomId}`, { token: B })).status, 403);

  // A opens SSE and receives the initial state snapshot
  const ctrl = new AbortController();
  const res = await fetch(`${srv.url}/api/rooms/${roomId}/events?token=${A}`, { signal: ctrl.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const until = sseReader(res.body);
  const first = await until((f) => f.event === 'state');
  assert.equal(first.data.status, 'lobby');
  assert.equal(first.data.players[0].isMe, true);
  // presence broadcast marks A connected
  await until((f) => f.event === 'state' && f.data.players[0].connected === true);

  // B joins → A sees B through SSE
  await call('POST', '/api/rooms/join', { token: B, body: { code, name: '비' } });
  const seen = await until((f) => f.event === 'state' && f.data.players.length === 2);
  assert.equal(seen.data.players[1].isMe, false);

  // characters: 4 each, 9th rejected, ownership enforced
  let lastChar;
  for (let i = 0; i < 4; i++) {
    const r = await call('POST', `/api/rooms/${roomId}/characters`, { token: A, body: { name: `A${i}`, avatar: { hair: 'bun' } } });
    assert.equal(r.status, 200);
    lastChar = r.json.characterId;
  }
  for (let i = 0; i < 4; i++) {
    assert.equal((await call('POST', `/api/rooms/${roomId}/characters`, { token: B, body: { name: `B${i}` } })).status, 200);
  }
  const ninth = await call('POST', `/api/rooms/${roomId}/characters`, { token: B, body: { name: 'B9' } });
  assert.equal(ninth.status, 409);
  assert.equal((await call('DELETE', `/api/rooms/${roomId}/characters/${lastChar}`, { token: B })).status, 403);
  const patched = await call('PATCH', `/api/rooms/${roomId}/characters/${lastChar}`, { token: A, body: { name: '에이짱' } });
  assert.equal(patched.status, 200);
  await until((f) => f.event === 'state' && f.data.characters.length === 8);

  // ready
  const ready = await call('POST', `/api/rooms/${roomId}/ready`, { token: A, body: { ready: true } });
  assert.equal(ready.json.room.me.ready, true);

  // reactions: broadcast only
  assert.equal((await call('POST', `/api/rooms/${roomId}/reactions`, { token: B, body: { emoji: '<b>' } })).status, 400);
  assert.equal((await call('POST', `/api/rooms/${roomId}/reactions`, { token: B, body: { emoji: '헐' } })).status, 200);
  const reaction = await until((f) => f.event === 'reaction');
  assert.equal(reaction.data.emoji, '헐');
  assert.equal(reaction.data.name, '비');

  // start → playing with family order (A's four then B's four)
  const started = await call('POST', `/admin/api/rooms/${roomId}/start`, { cookie });
  assert.equal(started.status, 200);
  const order = started.json.room.turn.order;
  const owners = order.map((id) => started.json.room.characters.find((c) => c.id === id).ownerId);
  assert.deepEqual(owners, ['p1', 'p1', 'p1', 'p1', 'p2', 'p2', 'p2', 'p2']);
  const playing = await until((f) => f.event === 'state' && f.data.status === 'playing');
  assert.equal(playing.data.turn.phase, 'awaitSpin');
  await until((f) => f.event === 'log');

  // no token leak in admin view
  const adminRoom = await call('GET', `/admin/api/rooms/${roomId}`, { cookie });
  assert.ok(!adminRoom.text.includes(A) && !adminRoom.text.includes(B));

  // end + delete
  assert.equal((await call('POST', `/admin/api/rooms/${roomId}/end`, { cookie })).json.room.status, 'finished');
  assert.equal((await call('DELETE', `/admin/api/rooms/${roomId}`, { cookie })).status, 200);
  assert.equal((await call('GET', `/api/rooms/${roomId}`, { token: A })).status, 404);

  ctrl.abort();
});

test('reaction rate limit returns 429', async () => {
  const login = await call('POST', '/admin/api/login', { body: { password: 'pw' } });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const { id, code } = (await call('POST', '/admin/api/rooms', { cookie, body: {} })).json.room;
  const t = (await call('POST', '/api/session')).json.token;
  await call('POST', '/api/rooms/join', { token: t, body: { code, name: '연타' } });
  const statuses = [];
  for (let i = 0; i < 7; i++) statuses.push((await call('POST', `/api/rooms/${id}/reactions`, { token: t, body: { emoji: '🐔' } })).status);
  assert.deepEqual(statuses.slice(0, 5), [200, 200, 200, 200, 200]);
  assert.equal(statuses[6], 429);
});

test('game page carries the three.js import map; /api/models lists drop-in models; scene modules are served', async () => {
  const home = await call('GET', '/');
  assert.match(home.text, /"three": "\/vendor\/three\/three\.module\.js"/);
  const models = await call('GET', '/api/models');
  assert.equal(models.status, 200);
  assert.ok(Array.isArray(models.json.models));
  assert.ok(models.json.models.every((m) => /\.(glb|gltf)$/i.test(m)));
  for (const f of ['/js/scene/board3d.js', '/js/scene/animator.js', '/js/scene/roulette3d.js', '/js/format.js']) {
    assert.equal((await call('GET', f)).status, 200, f);
  }
});
