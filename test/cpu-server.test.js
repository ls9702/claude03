// Stage 9-C — CPU players on the server: runner pacing (mocked timers), a CPU-only game finishing by itself, trade
// answers, admin / host CPU routes, admin start of a CPU-only room with a spectator watching.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRoomConfig } from '../server/game/config.js';
import { addCharacter, addCpuCharacter, joinRoom } from '../server/game/lobby.js';
import { RoomStore } from '../server/store/roomStore.js';
import { CPU_DELAY_MS, GameRunner, cpuDelays } from '../server/store/gameRunner.js';
import { startServer } from '../server/index.js';
import { httpCall, tempDir } from './helpers.js';

const SHORT = { baby: 2, elem: 2, middle: 2, high: 2, young: 3, middle_age: 3, senior: 2 };
const boot = (dataDir, extra = {}) => startServer({ port: 0, host: '127.0.0.1', dataDir, debounceMs: 5, ...extra });

async function login(srv, password) {
  const r = await httpCall(srv.url, 'POST', '/admin/api/login', { body: { password } });
  assert.equal(r.status, 200);
  return { cookie: r.headers.get('set-cookie').split(';')[0] };
}

/** Wait (real timers) until `pred()` holds. */
async function until(pred, ms = 5000) {
  const end = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 5));
  }
}

test('cpuDelays: defaults 1600 / 1200 / 1200 (+2500 after a cut-in), a number sets all', () => {
  assert.deepEqual(cpuDelays(undefined), { ...CPU_DELAY_MS });
  assert.deepEqual(CPU_DELAY_MS, { spin: 1600, prompt: 1200, trade: 1200, cutin: 2500 });
  assert.deepEqual(cpuDelays(0), { spin: 0, prompt: 0, trade: 0, cutin: 0 });
  assert.deepEqual(cpuDelays({ spin: 5 }), { spin: 5, prompt: 1200, trade: 1200, cutin: 2500 });
});

test('runner: a CPU spins after 1.6 s, answers its prompt after 1.2 s and a trade offer after 1.2 s (actor system+cpu)', async (t) => {
  const tmp = await tempDir();
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  try {
    const store = new RoomStore({ dataDir: tmp.dir, debounceMs: 1 });
    await store.load();
    const runner = new GameRunner(store, { secret: () => 99, cpuDelayMs: { cutin: 0 } });
    const cfg = validateRoomConfig({ mode: 'adult', eraTurns: { young: 5, middle_age: 5, senior: 3 }, turnOrder: 'index' }).config;
    let room = store.createRoom(cfg);
    room = addCpuCharacter(room, {}, 0).room; // c1 = CPU, first in index order
    room = joinRoom(room, 'H', '사람').room;
    room = addCharacter(room, 'H', { name: '사람' }).room; // c2
    store.put(room);
    assert.equal(runner.start(room.id).ok, true);
    // adult mode (loop maps): the CPU's first turn starts with the job offer, answered after the prompt delay
    const first = store.getRoom(room.id);
    assert.equal(first.turn.pending?.kind, 'jobOffer');
    assert.deepEqual(first.turn.pending.answers, {});
    t.mock.timers.tick(1150);
    assert.equal(store.getRoom(room.id).turn.pending?.kind, 'jobOffer');
    t.mock.timers.tick(100);
    const hired = store.getRoom(room.id);
    assert.ok(hired.characters.find((c) => c.id === 'c1').job, 'hired');
    assert.equal(hired.turn.phase, 'awaitSpin');
    assert.equal(hired.turn.lastSpin, null);
    t.mock.timers.tick(1500);
    assert.equal(store.getRoom(room.id).turn.lastSpin, null, 'not before the spin delay');
    t.mock.timers.tick(150);
    const spun = store.getRoom(room.id);
    assert.equal(spun.turn.lastSpin?.charId, 'c1', 'the CPU spun');
    assert.ok(!spun.log.some((l) => /자동으로 돌렸어요|관리자가/.test(l.text)), 'no timeout / admin log for a CPU spin');
    // whatever the move opened (찬스 광장 / tile prompts) is answered 1.2 s apart, then the human's turn: nothing is
    // scheduled for a human
    for (let i = 0; i < 12 && store.getRoom(room.id).turn.order[store.getRoom(room.id).turn.currentIndex] === 'c1'; i++) t.mock.timers.tick(1250);
    const human = store.getRoom(room.id);
    assert.equal(human.turn.order[human.turn.currentIndex], 'c2');
    // (the human's own pre-spin job offer may be open; it is not the CPU's)
    assert.ok(!human.turn.pending || human.turn.pending.charId === 'c2');
    assert.equal(runner.cpuTimers.size, 0);
    // a trade offer to the CPU is answered after the trade delay
    const live = structuredClone(store.getRoom(room.id));
    live.characters.find((c) => c.id === 'c1').cards = [{ uid: 'k70', id: 'taxi' }];
    live.characters.find((c) => c.id === 'c2').money = 500;
    store.put(live);
    const off = runner.dispatch(room.id, { type: 'offerTrade', characterId: 'c2', toId: 'c1', give: { money: 90 }, want: { cardUid: 'k70' }, actor: { sessionId: 'H' } });
    assert.equal(off.ok, true, off.error);
    t.mock.timers.tick(1100);
    assert.equal(store.getRoom(room.id).trades.length, 1);
    t.mock.timers.tick(150);
    const traded = store.getRoom(room.id);
    assert.equal(traded.trades.length, 0);
    assert.equal(traded.characters.find((c) => c.id === 'c2').cards.at(-1)?.id, 'taxi', 'accepted'); // (a graduate may start with a requirement card)
    runner.stop();
    t.mock.timers.reset();
    await store.close();
  } finally {
    t.mock.timers.reset();
    await tmp.cleanup();
  }
});

test('runner: after a cut-in event the CPU waits the extra cut-in delay', async (t) => {
  const tmp = await tempDir();
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  try {
    const store = new RoomStore({ dataDir: tmp.dir, debounceMs: 1 });
    await store.load();
    const runner = new GameRunner(store, { secret: () => 99 });
    const cfg = validateRoomConfig({ mode: 'adult', eraTurns: { young: 5, middle_age: 5, senior: 3 } }).config;
    let room = store.createRoom(cfg);
    room = addCpuCharacter(room, {}, 0).room;
    room = addCpuCharacter(room, {}, 0).room;
    store.put(room);
    const r = runner.start(room.id);
    // the first turn opens the CPU's job offer (a prompt = a cut-in anchor) → 1200 + 2500 before the answer
    const pending = store.getRoom(room.id).turn.pending;
    assert.equal(pending?.kind, 'jobOffer');
    assert.ok(r.events.some((e) => e.cutin));
    t.mock.timers.tick(3600);
    assert.equal(store.getRoom(room.id).turn.pending?.promptId, pending.promptId, 'still showing the prompt cut-in');
    t.mock.timers.tick(200);
    const hired = store.getRoom(room.id);
    assert.notEqual(hired.turn.pending?.promptId, pending.promptId, 'answered');
    // the hire (jobChanged, a cut-in) → spin delay + cut-in delay
    t.mock.timers.tick(1600 + 2500 - 150);
    assert.equal(store.getRoom(room.id).turn.lastSpin, null);
    t.mock.timers.tick(200);
    assert.ok(store.getRoom(room.id).turn.lastSpin, 'spun after spin + cut-in delay');
    runner.stop();
    t.mock.timers.reset();
    await store.close();
  } finally {
    t.mock.timers.reset();
    await tmp.cleanup();
  }
});

test('runner: a CPU-only game plays to the end by itself (zero delay); end() clears the CPU timer', async () => {
  const tmp = await tempDir();
  try {
    const store = new RoomStore({ dataDir: tmp.dir, debounceMs: 1 });
    await store.load();
    const runner = new GameRunner(store, { secret: () => 7, cpuDelayMs: 0 });
    const cfg = validateRoomConfig({ mode: 'lifetime', eraTurns: SHORT }).config;
    let room = store.createRoom(cfg);
    for (let i = 0; i < 4; i++) room = addCpuCharacter(room, {}, 0).room;
    store.put(room);
    assert.equal(runner.start(room.id).ok, true);
    await until(() => store.getRoom(room.id).status === 'finished');
    const done = store.getRoom(room.id);
    assert.equal(done.result.ranking.length, 4);
    assert.ok(done.characters.every((c) => c.finished));
    assert.equal(runner.cpuTimers.size, 0);
    // a second game force-ended mid-way leaves no CPU timer behind
    let r2 = store.createRoom(cfg);
    for (let i = 0; i < 2; i++) r2 = addCpuCharacter(r2, {}, 0).room;
    store.put(r2);
    const slow = new GameRunner(store, { secret: () => 7 });
    slow.start(r2.id);
    assert.equal(slow.cpuTimers.size, 1);
    assert.equal(slow.end(r2.id).ok, true);
    assert.equal(slow.cpuTimers.size, 0);
    runner.stop();
    slow.stop();
    await store.close();
  } finally {
    await tmp.cleanup();
  }
});

test('HTTP: admin adds / removes CPUs, host players only with 「CPU 허용」, admin starts a CPU-only room, a spectator watches it finish', async () => {
  const tmp = await tempDir();
  const srv = await boot(tmp.dir, { adminPassword: 'pw', cpuDelayMs: 0 });
  const call = (m, p, o) => httpCall(srv.url, m, p, o);
  try {
    const { cookie } = await login(srv, 'pw');
    // room without allowCpu: the admin may add CPUs, the host player may not
    const plain = (await call('POST', '/admin/api/rooms', { cookie, body: { mode: 'lifetime', eraTurns: SHORT, maxCharacters: 3 } })).json.room;
    assert.equal(plain.config.allowCpu, false);
    const A = (await call('POST', '/api/session')).json.token;
    await call('POST', '/api/rooms/join', { token: A, body: { code: plain.code, name: '방장' } });
    const denied = await call('POST', `/api/rooms/${plain.id}/cpu`, { token: A, body: {} });
    assert.equal(denied.status, 409);
    assert.match(denied.json.error, /CPU/);
    assert.equal((await call('POST', `/admin/api/rooms/${plain.id}/cpu`, {})).status, 401, 'admin login needed');
    const added = await call('POST', `/admin/api/rooms/${plain.id}/cpu`, { cookie, body: { name: '로봇 태권' } });
    assert.equal(added.status, 201, added.text);
    const cpuId = added.json.characterId;
    const cpuChar = added.json.room.characters.find((c) => c.id === cpuId);
    assert.equal(cpuChar.name, '로봇 태권');
    assert.equal(cpuChar.ownerId, 'cpu');
    assert.equal(cpuChar.ownerName, 'CPU');
    assert.ok(!JSON.stringify(added.json).includes(A), 'no session tokens');
    const removed = await call('DELETE', `/admin/api/rooms/${plain.id}/cpu/${cpuId}`, { cookie });
    assert.equal(removed.status, 200);
    assert.equal(removed.json.room.characters.length, 0);

    // 「CPU 허용」 room: the host adds CPUs, another player / a spectator cannot; max characters respected
    const open = (await call('POST', '/admin/api/rooms', { cookie, body: { mode: 'lifetime', eraTurns: SHORT, maxCharacters: 3, allowCpu: true } })).json.room;
    const B = (await call('POST', '/api/session')).json.token;
    const W = (await call('POST', '/api/session')).json.token;
    await call('POST', '/api/rooms/join', { token: A, body: { code: open.code, name: '방장' } });
    await call('POST', '/api/rooms/join', { token: B, body: { code: open.code, name: '손님' } });
    await call('POST', '/api/rooms/join', { token: W, body: { code: open.code, name: '구경', spectator: true } });
    const h1 = await call('POST', `/api/rooms/${open.id}/cpu`, { token: A, body: {} });
    assert.equal(h1.status, 201, h1.text);
    assert.equal((await call('POST', `/api/rooms/${open.id}/cpu`, { token: B, body: {} })).status, 403);
    assert.equal((await call('POST', `/api/rooms/${open.id}/cpu`, { token: W, body: {} })).status, 403);
    assert.equal((await call('DELETE', `/api/rooms/${open.id}/cpu/${h1.json.characterId}`, { token: B })).status, 403);
    assert.equal((await call('POST', `/api/rooms/${open.id}/cpu`, { token: A, body: {} })).status, 201);
    assert.equal((await call('POST', `/api/rooms/${open.id}/cpu`, { token: A, body: {} })).status, 201);
    const full = await call('POST', `/api/rooms/${open.id}/cpu`, { token: A, body: {} });
    assert.equal(full.status, 409, 'max characters');
    const del = await call('DELETE', `/api/rooms/${open.id}/cpu/${h1.json.characterId}`, { token: A });
    assert.equal(del.status, 200, del.text);
    assert.equal(del.json.room.characters.length, 2);

    // CPU-only room + a spectator: the admin starts it, the game plays itself to the end
    const tv = (await call('POST', '/admin/api/rooms', { cookie, body: { mode: 'lifetime', eraTurns: SHORT } })).json.room;
    await call('POST', '/api/rooms/join', { token: W, body: { code: tv.code, name: '구경', spectator: true } });
    for (let i = 0; i < 3; i++) assert.equal((await call('POST', `/admin/api/rooms/${tv.id}/cpu`, { cookie, body: {} })).status, 201);
    const st = await call('POST', `/admin/api/rooms/${tv.id}/start`, { cookie });
    assert.equal(st.status, 200, st.text);
    let view;
    await until(async () => {
      view = (await call('GET', `/api/rooms/${tv.id}`, { token: W })).json;
      return view.status === 'finished';
    });
    assert.equal(view.me.role, 'spectator');
    assert.equal(view.result.ranking.length, 3);
    assert.equal((await call('POST', `/api/rooms/${tv.id}/actions`, { token: W, body: { type: 'spin', characterId: 'c1' } })).status, 403);
  } finally {
    await srv.close();
    await tmp.cleanup();
  }
});
