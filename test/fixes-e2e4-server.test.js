// E2E round 4 fixes (server side): save debounce max-wait, slow SSE consumers, superseded streams (≥ 4 tabs), boot with
// damaged saves, the SSE board cache (boardKey), Korean 413, engine errors answered without crashing the runner.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startServer } from '../server/index.js';
import { RoomStore, SAVE_MAX_WAIT_MS, stateFrame } from '../server/store/roomStore.js';
import { GameRunner, playingRoomProblem } from '../server/store/gameRunner.js';
import { addCharacter, joinRoom } from '../server/game/lobby.js';
import { startGame } from '../server/game/engine.js';
import { defaultRoomConfig } from '../server/game/config.js';
import { attachBoard } from '../public/js/api.js';
import { httpCall, makeRoom, sseReader, tempDir } from './helpers.js';

const boot = (dataDir, extra = {}) => startServer({ port: 0, host: '127.0.0.1', dataDir, debounceMs: 5, adminPassword: 'pw', ...extra });
async function login(srv) {
  const r = await httpCall(srv.url, 'POST', '/admin/api/login', { body: { password: 'pw' } });
  return r.headers.get('set-cookie')?.split(';')[0];
}

// ---------- 2. save debounce max-wait ----------

test('save debounce: commits every 100 ms still write a snapshot at least every maxWait (mocked timers)', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let now = 0;
    const s = new RoomStore({ dataDir: '/nonexistent-never-written', debounceMs: 300, maxWaitMs: 2000, clock: () => now });
    const saves = [];
    s.saveNow = (id) => saves.push([id, now]);
    const tick = (ms) => {
      now += ms;
      mock.timers.tick(ms);
    };
    for (let i = 0; i < 65; i++) {
      s.scheduleSave('r1');
      tick(100);
    }
    // 6.5 s of commits every 100 ms: written at 2.0, 4.0 and 6.0 s (a plain debounce would never have written)
    assert.deepEqual(saves.map(([, at]) => at), [2000, 4000, 6000]);
    tick(100); // the last commit was at 6400 (now 6500 → 6600)
    assert.equal(saves.length, 3);
    tick(100);
    assert.deepEqual(saves.map(([, at]) => at), [2000, 4000, 6000, 6700], 'the quiet debounce after the last commit');
    // a lone change still waits the plain debounce
    s.scheduleSave('r2');
    tick(200);
    assert.equal(saves.length, 4);
    tick(100);
    assert.deepEqual(saves.at(-1), ['r2', 7000]);
    assert.equal(SAVE_MAX_WAIT_MS, 2000);
    s.closed = true;
  } finally {
    mock.timers.reset();
  }
});

// ---------- 3. slow SSE consumers ----------

function fakeRes({ reads = true } = {}) {
  const res = {
    writableLength: 0,
    frames: [],
    destroyed: false,
    write(x) {
      this.frames.push(x);
      if (!reads) this.writableLength += Buffer.byteLength(x);
      return reads;
    },
    end() {
      this.ended = true;
    },
    destroy() {
      this.destroyed = true;
    },
  };
  return res;
}

test('SSE: a stream that stops reading is dropped past maxBufferedBytes; a reading one stays', async () => {
  const tmp = await tempDir();
  try {
    const logs = [];
    const s = await new RoomStore({ dataDir: tmp.dir, debounceMs: 5, maxBufferedBytes: 20_000, log: (m) => logs.push(m) }).load();
    let room = s.createRoom(defaultRoomConfig());
    room = joinRoom(room, 'A', 'a', 0).room;
    room = joinRoom(room, 'B', 'b', 0).room;
    s.commit(room);
    const stalled = fakeRes({ reads: false });
    const live = fakeRes();
    s.subscribe(room.id, 'A', stalled);
    s.subscribe(room.id, 'B', live);
    for (let i = 0; i < 200 && !stalled.destroyed; i++) s.broadcast(room.id, 'reaction', { emoji: '헐', pad: 'x'.repeat(500) });
    assert.equal(stalled.destroyed, true, 'destroyed (frees the buffered frames)');
    assert.equal(s.subscriberCount(room.id, 'A'), 0);
    assert.equal(s.subscriberCount(room.id, 'B'), 1);
    assert.ok(stalled.writableLength > 20_000 && stalled.writableLength < 22_000);
    assert.ok(logs.some((l) => /느린 SSE 연결을 끊었습니다/.test(l)));
    const before = live.frames.length;
    s.broadcastState(room.id);
    assert.equal(live.frames.length, before + 1, 'the reading stream keeps getting frames');
    await s.close();
  } finally {
    await tmp.cleanup();
  }
});

// ---------- 4. superseded streams ----------

test('SSE: the 4th stream of one session supersedes the oldest — `superseded` is sent before it ends', async () => {
  const tmp = await tempDir();
  const srv = await boot(tmp.dir);
  try {
    const cookie = await login(srv);
    const { id, code } = (await httpCall(srv.url, 'POST', '/admin/api/rooms', { cookie, body: {} })).json.room;
    const T = (await httpCall(srv.url, 'POST', '/api/session')).json.token;
    await httpCall(srv.url, 'POST', '/api/rooms/join', { token: T, body: { code, name: '탭' } });
    const ctrls = [];
    const bodies = [];
    for (let i = 0; i < 4; i++) {
      const ctrl = new AbortController();
      ctrls.push(ctrl);
      const res = await fetch(`${srv.url}/api/rooms/${id}/events?token=${T}`, { signal: ctrl.signal });
      bodies.push(res.body);
      await new Promise((r) => setTimeout(r, 10));
    }
    // read the first stream to its end
    const reader = bodies[0].getReader();
    let text = '';
    const dec = new TextDecoder();
    const timeout = setTimeout(() => ctrls[0].abort(), 3000);
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += dec.decode(value, { stream: true });
      }
    } finally {
      clearTimeout(timeout);
    }
    assert.match(text, /event: superseded\ndata: \{"roomId":"[a-f0-9]+","reason":"tabs","max":3\}/);
    assert.ok(text.indexOf('event: state') < text.indexOf('event: superseded'), 'the state came first');
    assert.equal(srv.store.subscriberCount(id, T), 3);
    for (const c of ctrls) c.abort();
    await Promise.all(bodies.slice(1).map((b) => b.cancel().catch(() => {})));
    await new Promise((r) => setTimeout(r, 30));
  } finally {
    await srv.close();
    await tmp.cleanup();
  }
});

// ---------- 9. SSE board cache ----------

function playingRoom() {
  let room = makeRoom({ id: 'b0a4d0c0' });
  room = joinRoom(room, 'A', 'a', 0).room;
  room = addCharacter(room, 'A', { name: 'x' }, 0).room;
  room = addCharacter(room, 'A', { name: 'y' }, 0).room;
  return startGame(room, { now: 0 }).room;
}

test('SSE state frames: the board only on a stream’s first frame and when its key changes; attachBoard re-attaches it', () => {
  const room = playingRoom();
  const sub = { sessionId: 'A' };
  const parse = (f) => JSON.parse(f.split('\n')[1].slice('data: '.length));
  const f1 = parse(stateFrame(room, sub));
  assert.ok(f1.board && f1.boardKey);
  assert.equal(f1.boardKey, room.boardKey);
  const f2 = parse(stateFrame({ ...room, version: 2 }, sub));
  assert.equal(Object.hasOwn(f2, 'board'), false, 'omitted');
  assert.equal(f2.boardKey, f1.boardKey);
  // a rebuilt board (migration) → a new key → sent again
  const rebuilt = { ...room, board: { ...room.board, eras: room.board.eras.slice() }, boardKey: 'other-key' };
  const f3 = parse(stateFrame(rebuilt, sub));
  assert.ok(f3.board);
  // another stream starts with the board
  assert.ok(parse(stateFrame(room, { sessionId: 'A' })).board);
  // lobby: no board, no key
  const lobby = parse(stateFrame(makeRoom(), { sessionId: 'A' }));
  assert.equal(lobby.board, null);
  assert.equal(lobby.boardKey, null);
  // client merge (public/js/api.js)
  const cache = { key: null, board: null };
  assert.deepEqual(attachBoard(cache, f1).state.board, f1.board);
  const merged = attachBoard(cache, f2);
  assert.equal(merged.ok, true);
  assert.equal(merged.state.board, f1.board, 'the cached board object');
  assert.equal(attachBoard({ key: 'nope', board: {} }, f2).ok, false, 'cache miss → refetch');
  assert.deepEqual(attachBoard(cache, { status: 'lobby', board: null, boardKey: null }).state.board, null);
  assert.equal(attachBoard({ key: null, board: null }, { status: 'lobby', boardKey: null }).state.board, null);
  // saves from before boardKey: the view computes a stable content key
  const old = { ...room };
  delete old.boardKey;
  const k1 = parse(stateFrame(old, { sessionId: 'A' })).boardKey;
  assert.equal(k1, room.boardKey, 'same content → same key');
});

test('SSE over HTTP: the game-start frame carries the board, later frames omit it; HTTP keeps it; frames shrink', async () => {
  const tmp = await tempDir();
  const srv = await boot(tmp.dir, { cpuDelayMs: 3_600_000 });
  try {
    const cookie = await login(srv);
    const { id, code } = (await httpCall(srv.url, 'POST', '/admin/api/rooms', { cookie, body: { mode: 'lifetime' } })).json.room;
    const T = (await httpCall(srv.url, 'POST', '/api/session')).json.token;
    await httpCall(srv.url, 'POST', '/api/rooms/join', { token: T, body: { code, name: '에이' } });
    const a = (await httpCall(srv.url, 'POST', `/api/rooms/${id}/characters`, { token: T, body: { name: '하나' } })).json.characterId;
    await httpCall(srv.url, 'POST', `/api/rooms/${id}/characters`, { token: T, body: { name: '둘' } });
    const ctrl = new AbortController();
    const res = await fetch(`${srv.url}/api/rooms/${id}/events?token=${T}`, { signal: ctrl.signal });
    const until = sseReader(res.body);
    assert.equal((await httpCall(srv.url, 'POST', `/admin/api/rooms/${id}/start`, { cookie })).status, 200);
    const first = await until((f) => f.event === 'state' && f.data.status === 'playing');
    assert.ok(first.data.board?.eras?.length, 'the first playing frame has the board');
    const spin = await httpCall(srv.url, 'POST', `/api/rooms/${id}/actions`, { token: T, body: { type: 'spin', characterId: a } });
    assert.equal(spin.status, 200, spin.text);
    assert.ok(spin.json.room.board, 'HTTP responses keep the full board');
    const later = await until((f) => f.event === 'state' && f.data.version > first.data.version);
    assert.equal(Object.hasOwn(later.data, 'board'), false);
    assert.equal(later.data.boardKey, first.data.boardKey);
    const get = await httpCall(srv.url, 'GET', `/api/rooms/${id}`, { token: T });
    assert.ok(get.json.board && get.json.boardKey === first.data.boardKey);
    const sizeOf = (d) => Buffer.byteLength(JSON.stringify(d));
    assert.ok(sizeOf(later.data) < sizeOf(first.data) - 10_000, `${sizeOf(later.data)} vs ${sizeOf(first.data)}`);
    ctrl.abort();
    await res.body.cancel().catch(() => {});
  } finally {
    await srv.close();
    await tmp.cleanup();
  }
});

// ---------- 5. damaged saves at boot ----------

test('boot: damaged save files never stop the server; a playing room without board / turn is listed as broken', async () => {
  const tmp = await tempDir();
  const S = path.join(tmp.dir, 'saves');
  await mkdir(S, { recursive: true });
  const put = (name, body) => writeFile(path.join(S, name), typeof body === 'string' ? body : JSON.stringify(body));
  await put('aaaaaaaa.json', '{"id":"aaaaaaaa","players":[');
  await put('bbbbbbbb.json', '');
  await put('cccccccc.json', 'null');
  await put('dddddddd.json', '[]');
  await put('eeeeeeee.json', '"str"');
  await put('ffffffff.json', { id: 'ffffffff', players: 5 });
  await put('11111111.json', { id: '11111111', code: 'ZZZZZZ', status: 'playing', players: [], characters: [], config: { mode: 'lifetime' } });
  await put('22222222.json', { id: '22222222', code: 'YYYYYY', status: 'playing', players: [], characters: [{ id: 'c1' }], turn: { order: ['c1'], currentIndex: 0, phase: 'awaitSpin' }, board: { eras: [] }, config: {} });
  await put('33333333.json', { id: '33333333', code: 'XXXXXX', status: 'lobby', players: [{ id: 'p1', sessionId: 'tok', name: 'x' }], characters: [], config: { mode: 'lifetime', eraTurns: {} }, log: [], createdAt: Date.now() });
  await put('44444444.json', { id: '44444444', code: 'WWWWWW', status: 'playing', players: [], characters: [{ id: 'c1' }], turn: { order: ['c1'], currentIndex: 0, phase: 'awaitSpin' }, board: { eras: [{ id: 'baby', tiles: [] }] }, config: {} });
  await writeFile(path.join(tmp.dir, 'sessions.json'), '{"tok": {"createdAt": 1}, bad');
  const logs = [];
  const srv = await boot(tmp.dir, { log: (m) => logs.push(String(m)), cpuDelayMs: 0 });
  try {
    const cookie = await login(srv);
    const rooms = (await httpCall(srv.url, 'GET', '/admin/api/rooms', { cookie })).json.rooms;
    const ids = rooms.map((r) => r.id).sort();
    assert.deepEqual(ids, ['11111111', '22222222', '33333333', '44444444']);
    for (const r of rooms) {
      const d = await httpCall(srv.url, 'GET', `/admin/api/rooms/${r.id}`, { cookie });
      assert.equal(d.status, 200, `${r.id}: ${d.text}`);
    }
    const broken = Object.fromEntries(rooms.map((r) => [r.id, r.broken]));
    assert.match(broken['11111111'], /캐릭터|게임판/);
    assert.match(broken['22222222'], /게임판/);
    assert.ok(broken['44444444'], 'the engine throws on it → marked broken, not fatal');
    assert.equal(broken['33333333'], null);
    assert.ok(logs.some((l) => /복원하지 못해 멈춰 둡니다/.test(l)));
    // a broken room refuses game actions with a Korean 409 and can be deleted
    const act = await httpCall(srv.url, 'POST', '/admin/api/rooms/22222222/actions', { cookie, body: { type: 'forceSpin' } });
    assert.equal(act.status, 409);
    assert.match(act.json.error, /저장 파일이 손상/);
    assert.equal((await httpCall(srv.url, 'POST', '/admin/api/rooms/22222222/end', { cookie })).status, 409);
    assert.equal((await httpCall(srv.url, 'DELETE', '/admin/api/rooms/22222222', { cookie })).status, 200);
    // the server works normally: a new room plays
    const { id, code } = (await httpCall(srv.url, 'POST', '/admin/api/rooms', { cookie, body: { mode: 'kids' } })).json.room;
    const T = (await httpCall(srv.url, 'POST', '/api/session')).json.token;
    await httpCall(srv.url, 'POST', '/api/rooms/join', { token: T, body: { code, name: '플레이' } });
    for (const n of ['하나', '둘']) await httpCall(srv.url, 'POST', `/api/rooms/${id}/characters`, { token: T, body: { name: n } });
    assert.equal((await httpCall(srv.url, 'POST', `/admin/api/rooms/${id}/start`, { cookie })).status, 200);
  } finally {
    await srv.close();
    await tmp.cleanup();
  }
});

test('runner: an unexpected engine error is answered with a Korean 500 and logged, never thrown', async () => {
  const tmp = await tempDir();
  try {
    const logs = [];
    const store = await new RoomStore({ dataDir: tmp.dir, debounceMs: 5 }).load();
    const runner = new GameRunner(store, { log: (m) => logs.push(String(m)), cpuDelayMs: 0 });
    const room = store.createRoom(defaultRoomConfig());
    store.put({ ...room, status: 'playing', board: { eras: [{ id: 'young', loop: true, tiles: [] }] }, turn: { order: ['c1'], currentIndex: 0, phase: 'awaitSpin' }, characters: [{ id: 'c1', name: 'x' }] });
    const r = runner.dispatch(room.id, { type: 'spin', characterId: 'c1' });
    assert.equal(r.ok, false);
    assert.equal(r.status, 500);
    assert.match(r.error, /오류가 났어요/);
    assert.ok(logs.some((l) => /게임 처리 중 오류/.test(l)));
    assert.equal(playingRoomProblem({ status: 'playing', characters: [{}], board: { eras: [{}] }, turn: { order: ['c1'] }, config: {} }), null);
    assert.match(playingRoomProblem({ status: 'playing', characters: [{}], board: { eras: [{}] }, config: {} }), /차례/);
    runner.stop();
    await store.close();
  } finally {
    await tmp.cleanup();
  }
});

// ---------- 8. 413 ----------

test('413: an oversized JSON body gets the Korean 「요청이 너무 커요.」', async () => {
  const tmp = await tempDir();
  const srv = await boot(tmp.dir);
  try {
    const r = await httpCall(srv.url, 'POST', '/api/rooms/join', { body: { code: 'ABCDEF', name: 'x'.repeat(100_000) } });
    assert.equal(r.status, 413);
    assert.equal(r.json.error, '요청이 너무 커요.');
    const bad = await fetch(`${srv.url}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, '요청 형식이 올바르지 않습니다.');
  } finally {
    await srv.close();
    await tmp.cleanup();
  }
});
