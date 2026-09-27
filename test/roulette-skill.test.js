// 룰렛 실력 모드 (server): config, the jitter distribution + edge reflection, engine spins (any target every turn — the number deck was removed; skill /
// random / invalid target / auto / admin), bets refused, CPU targets (legal, prefer good tiles, never touch the game
// RNG), presentation tags, HTTP (spin target + /api/meta).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameData } from '../server/data/index.js';
import { validateRoomConfig, defaultRoomConfig, ROULETTE_MODES } from '../server/game/config.js';
import { applyAction, startGame } from '../server/game/engine.js';
import { addCharacter, addCpuCharacter, joinRoom } from '../server/game/lobby.js';
import { cpuAimScores, cpuDecide, cpuSkillTarget } from '../server/game/cpu.js';
import { createRng } from '../server/game/rng.js';
import {
  jitterTable,
  parseTarget,
  reflect,
  skillDistribution,
  skillValue,
  skillValueFor,
} from '../server/game/roulette.js';
import { startServer } from '../server/index.js';
import { httpCall, makeRoom, tempDir } from './helpers.js';

const data = gameData();
const JITTER = data.balance.roulette.skill.jitter;

function lobby({ rouletteMode = 'skill', cpu = false, seed = 7, mode = 'lifetime' } = {}) {
  let room = makeRoom({ seed });
  room.config = { ...room.config, rouletteMode, mode, allowCpu: cpu };
  room = joinRoom(room, 'A', '에이', 0).room;
  room = joinRoom(room, 'B', '비', 0).room;
  room = addCharacter(room, 'A', { name: 'A1' }, 0).room;
  room = addCharacter(room, 'B', { name: 'B1' }, 0).room;
  if (cpu) room = addCpuCharacter(room, { name: '로봇' }, 0).room;
  return room;
}
const started = (opts) => startGame(lobby(opts), { now: 0 }).room;
const cur = (room) => room.turn.order[room.turn.currentIndex];
const ownerOf = (room, id) => room.characters.find((c) => c.id === id).ownerSessionId;
const spinOf = (r) => r.events.find((e) => e.type === 'spun');

test('config: rouletteMode random (default) | skill; anything else is refused in Korean', () => {
  assert.deepEqual(ROULETTE_MODES, ['random', 'skill']);
  assert.equal(defaultRoomConfig().rouletteMode, 'random');
  assert.equal(validateRoomConfig({}).config.rouletteMode, 'random');
  assert.equal(validateRoomConfig({ rouletteMode: 'skill' }).config.rouletteMode, 'skill');
  for (const bad of ['SKILL', 'aim', 1, null, true]) {
    const r = validateRoomConfig({ rouletteMode: bad });
    assert.equal(r.ok, false);
    assert.match(r.errors.join(' '), /룰렛 방식은/);
  }
});

test('jitter: default 50 / 40 / 10, reflected at the edges, exact distribution sums to 1', () => {
  assert.deepEqual(JITTER, { 0: 0.5, 1: 0.4, 2: 0.1 });
  const table = jitterTable(JITTER);
  assert.deepEqual(table.map((x) => x.offset), [0, -1, 1, -2, 2]);
  assert.ok(Math.abs(table.reduce((a, x) => a + x.p, 0) - 1) < 1e-12);
  assert.deepEqual([reflect(0, 1, 10), reflect(-1, 1, 10), reflect(11, 1, 10), reflect(12, 1, 10), reflect(5, 1, 10)], [2, 3, 9, 8, 5]);
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const mid = skillDistribution(5, { jitter: JITTER });
  assert.ok(near(mid[5], 0.5) && near(mid[4], 0.2) && near(mid[6], 0.2) && near(mid[3], 0.05) && near(mid[7], 0.05));
  const lo = skillDistribution(1, { jitter: JITTER }); // 0 → 2, −1 → 3
  assert.ok(near(lo[1], 0.5) && near(lo[2], 0.4) && near(lo[3], 0.1));
  const hi = skillDistribution(10, { jitter: JITTER });
  assert.ok(near(hi[10], 0.5) && near(hi[9], 0.4) && near(hi[8], 0.1));
  for (let t = 1; t <= 10; t++) {
    const d = skillDistribution(t, { jitter: JITTER });
    assert.ok(near(Object.values(d).reduce((a, b) => a + b, 0), 1));
    for (const v of Object.keys(d).map(Number)) assert.ok(v >= 1 && v <= 10 && Math.abs(v - t) <= 2);
  }
  // r walks the table in order: [0, .5) exact, then −1, +1, −2, +2
  assert.deepEqual([0, 0.49, 0.5, 0.69, 0.7, 0.89, 0.9, 0.94, 0.95, 0.9999].map((r) => skillValueFor(6, r, { jitter: JITTER })), [6, 6, 5, 5, 7, 7, 4, 4, 8, 8]);
  // invalid tables fall back to the default
  assert.deepEqual(jitterTable({ 0: 0 }), jitterTable(JITTER));
  assert.deepEqual(jitterTable(null), jitterTable(JITTER));
});

test('jitter: seeded samples ≈ 50 / 40 / 10 (middle and edge targets)', () => {
  const rng = createRng(12345);
  for (const t of [1, 6, 10]) {
    const off = [0, 0, 0];
    const N = 12000;
    for (let i = 0; i < N; i++) off[Math.abs(skillValue(rng, t, { jitter: JITTER }) - t)]++;
    const share = off.map((n) => n / N);
    assert.ok(Math.abs(share[0] - 0.5) < 0.015, `t=${t} exact ${share[0]}`);
    assert.ok(Math.abs(share[1] - 0.4) < 0.015, `t=${t} ±1 ${share[1]}`);
    assert.ok(Math.abs(share[2] - 0.1) < 0.01, `t=${t} ±2 ${share[2]}`);
  }
});

test('targets: parse (1..10 integers only); no number-deck helpers are exported any more', async () => {
  assert.deepEqual([parseTarget(7), parseTarget('3'), parseTarget(0), parseTarget(11), parseTarget(2.5), parseTarget('x'), parseTarget(null)], [7, 3, null, null, null, null, null]);
  const mod = await import('../server/game/roulette.js');
  for (const k of ['availableTargets', 'snapTarget', 'useTarget']) assert.equal(mod[k], undefined, k);
  assert.equal(data.balance.roulette.skill.deck, undefined);
});

test('engine: skill spin lands near the target; spun + lastSpin + log carry it; the same number again next turn', () => {
  let room = started();
  const c = cur(room);
  const actor = { sessionId: ownerOf(room, c) };
  const r = applyAction(room, { type: 'spin', characterId: c, target: 7, input: 'gauge', actor }, { now: 1 });
  const sp = spinOf(r);
  assert.equal(sp.skill, true);
  assert.equal(sp.target, 7);
  assert.equal(sp.input, 'gauge');
  assert.ok(Math.abs(sp.value - 7) <= 2);
  assert.equal(r.room.turn.lastSpin.target, 7);
  assert.equal(r.room.turn.lastSpin.skill, true);
  assert.equal(r.room.characters.find((x) => x.id === c).aimUsed, undefined, 'no used-number tracking');
  const log = r.events.find((e) => e.type === 'log' && /🎡/.test(e.text));
  assert.match(log.text, new RegExp(`🎯 목표 7 → 결과 ${sp.rolls?.[0] ?? sp.value}`));
  // the next turn of the same character may aim at 7 again (no deck, no snapping, no `wanted`); a leftover
  // `aimUsed` from an old save is ignored
  room = structuredClone(r.room);
  room.turn = { ...room.turn, phase: 'awaitSpin', pending: null, currentIndex: room.turn.order.indexOf(c) };
  room.characters.find((x) => x.id === c).aimUsed = [7, 8];
  const r2 = applyAction(room, { type: 'spin', characterId: c, target: 7, input: 'shake', actor }, { now: 2 });
  const sp2 = spinOf(r2);
  assert.equal(sp2.target, 7);
  assert.equal(sp2.wanted, undefined);
  assert.equal(r2.room.turn.lastSpin.wanted, undefined);
  assert.deepEqual(r2.room.characters.find((x) => x.id === c).aimUsed, [7, 8], 'leftover field untouched');
  // unknown input names are dropped, the target still counts
  const r3 = applyAction(room, { type: 'spin', characterId: c, target: 4, input: '<script>', actor }, { now: 3 });
  assert.equal(spinOf(r3).target, 4);
  assert.equal(spinOf(r3).input, undefined);
});

test('engine: skill spins through applyAction follow the jitter (seeded samples)', () => {
  const room = started();
  const c = cur(room);
  const off = [0, 0, 0];
  const N = 160;
  for (let i = 0; i < N; i++) {
    const sp = spinOf(applyAction(room, { type: 'spin', characterId: c, target: 5 }, { rng: createRng(1000 + i * 7919), now: 1 }));
    off[Math.abs(sp.value - 5)]++;
  }
  assert.ok(off[0] / N > 0.4 && off[0] / N < 0.6, `exact ${off[0] / N}`);
  assert.ok(off[1] / N > 0.3 && off[1] / N < 0.5, `±1 ${off[1] / N}`);
  assert.ok(off[2] / N > 0.03 && off[2] / N < 0.18, `±2 ${off[2] / N}`);
});

test('engine: invalid / missing target → a plain random spin; random rooms ignore the target', () => {
  const skill = started();
  const c = cur(skill);
  for (const target of [undefined, 0, 11, 'abc', 3.5, null]) {
    const sp = spinOf(applyAction(skill, { type: 'spin', characterId: c, target }, { now: 1 }));
    assert.equal(sp.skill, undefined, `target ${target}`);
    assert.equal(sp.target, undefined);
  }
  const rnd = started({ rouletteMode: 'random' });
  const cr = cur(rnd);
  const a = applyAction(rnd, { type: 'spin', characterId: cr, target: 7 }, { now: 1 });
  const b = applyAction(rnd, { type: 'spin', characterId: cr }, { now: 1 });
  assert.equal(spinOf(a).skill, undefined);
  assert.equal(spinOf(a).value, spinOf(b).value, 'same RNG draw as without a target');
  assert.equal(a.room.rngState, b.room.rngState);
  assert.equal(a.room.characters.find((x) => x.id === cr).aimUsed, undefined);
});

test('engine: turn-timer auto spin and admin forceSpin stay random in skill mode', () => {
  let room = startGame(lobby(), { now: 0 }).room;
  room.config.turnTimeoutSec = 30;
  room.turn.spinDeadlineAt = 30_000;
  const c = cur(room);
  const auto = spinOf(applyAction(room, { type: 'spin', characterId: c, target: 7, auto: true, actor: { system: true } }, { now: 30_000 }));
  assert.equal(auto.auto, true);
  assert.equal(auto.skill, undefined);
  const admin = spinOf(applyAction(room, { type: 'spin', characterId: c, target: 7, actor: { admin: true } }, { now: 1 }));
  assert.equal(admin.skill, undefined);
  // a CPU actor's target counts
  const cpu = spinOf(applyAction(room, { type: 'spin', characterId: c, target: 7, input: 'cpu', actor: { system: true, cpu: true } }, { now: 1 }));
  assert.equal(cpu.skill, true);
  assert.equal(cpu.input, 'cpu');
});

test('bets: refused in skill mode (409), unchanged in random mode', () => {
  const room = started();
  const c = cur(room);
  const other = room.characters.find((x) => x.id !== c && x.ownerSessionId !== ownerOf(room, c));
  const bet = { type: 'bet', characterId: other.id, kind: 'oddEven', pick: 'odd', amount: 5, actor: { sessionId: other.ownerSessionId } };
  assert.throws(() => applyAction(room, bet, { now: 1 }), (e) => e.status === 409 && /실력 모드에서는 훈수 베팅이 없어요/.test(e.message));
  const rnd = started({ rouletteMode: 'random' });
  const o2 = rnd.characters.find((x) => x.id !== cur(rnd) && x.ownerSessionId !== ownerOf(rnd, cur(rnd)));
  const ok = applyAction(rnd, { ...bet, characterId: o2.id, actor: { sessionId: o2.ownerSessionId } }, { now: 1 });
  assert.ok(ok.events.some((e) => e.type === 'betPlaced'));
});

test('presentation: aim_hit on an exact hit, aim_miss when off by 2, plain spin otherwise', () => {
  const room = started();
  const c = cur(room);
  const tags = {};
  for (let i = 0; i < 60 && Object.keys(tags).length < 3; i++) {
    const sp = spinOf(applyAction(room, { type: 'spin', characterId: c, target: 5 }, { rng: createRng(77 + i * 131), now: 1 }));
    const d = Math.abs(sp.value - 5);
    tags[d] = sp;
  }
  assert.equal(tags[0].lineTag, 'aim_hit');
  assert.equal(typeof tags[0].line, 'string');
  assert.equal(tags[2].lineTag, 'aim_miss');
  assert.ok(tags[2].line && !/\{\w+\}/.test(tags[2].line));
  assert.equal(tags[1].lineTag, 'spin');
  assert.equal(tags[1].line, null);
  const lines = data.lines.tags;
  for (const t of ['aim_hit', 'aim_miss']) assert.ok(lines[t].length >= 5 && lines[t].length <= 10);
});

test('CPU: skill target is any number 1..10, prefers the good tile in reach, never consumes the game RNG', () => {
  const room = started({ cpu: true });
  const cpuChar = room.characters.find((c) => c.ownerSessionId === 'cpu');
  cpuChar.cpuPersonality = 'cautious'; // aimNoise 0 → deterministic best target
  room.turn.currentIndex = room.turn.order.indexOf(cpuChar.id);
  // crafted board: the start era's tiles 1..10 ahead → only distance 4 pays, the rest are losses
  const era = room.board.eras[0];
  era.tiles = era.tiles.map((t) => ({ ...t, type: 'loss', amount: 80 }));
  while (era.tiles.length < 12) era.tiles.push({ ...era.tiles[0], id: `${era.id}:main:${era.tiles.length}`, index: era.tiles.length });
  era.tiles = era.tiles.map((t, i) => ({ ...t, id: `${era.id}:main:${i}`, index: i }));
  era.tiles[3] = { ...era.tiles[3], type: 'money', amount: 500 }; // 4 steps from the start (index −1)
  cpuChar.position = { eraIndex: 0, route: 'main', index: -1 };
  const before = room.rngState;
  const scores = cpuAimScores(room, cpuChar.id, data);
  assert.equal(Object.keys(scores).length, 10);
  const t = cpuSkillTarget(room, cpuChar.id, data);
  assert.equal(t, 4);
  const act = cpuDecide(room, cpuChar.id, data);
  assert.deepEqual(act, { type: 'spin', characterId: cpuChar.id, target: 4, input: 'cpu' });
  assert.equal(room.rngState, before);
  // no deck: the same best number again (a leftover `aimUsed` is ignored)
  cpuChar.aimUsed = [4];
  assert.equal(cpuSkillTarget(room, cpuChar.id, data), 4);
  // any state: always legal
  cpuChar.cpuPersonality = 'bold';
  for (let k = 0; k < 20; k++) {
    room.rngState = k * 99991;
    const x = cpuSkillTarget(room, cpuChar.id, data);
    assert.ok(Number.isInteger(x) && x >= 1 && x <= 10);
  }
  // random rooms: a plain spin
  const rnd = started({ cpu: true, rouletteMode: 'random' });
  const rc = rnd.characters.find((c) => c.ownerSessionId === 'cpu');
  rnd.turn.currentIndex = rnd.turn.order.indexOf(rc.id);
  const a = cpuDecide(rnd, rc.id, data);
  if (a.type === 'spin') assert.equal(a.target, undefined);
});

test('HTTP: spin {target, input} reaches the engine; /api/meta carries balance.roulette; admin creates skill rooms', async () => {
  const tmp = await tempDir();
  const srv = await startServer({ port: 0, host: '127.0.0.1', dataDir: tmp.dir, debounceMs: 5, adminPassword: 'pw', cpuDelayMs: 0 });
  const call = (m, p, o) => httpCall(srv.url, m, p, o);
  try {
    const meta = (await call('GET', '/api/meta')).json;
    assert.deepEqual(meta.balance.roulette.skill.jitter, JITTER);
    const login = await call('POST', '/admin/api/login', { body: { password: 'pw' } });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const bad = await call('POST', '/admin/api/rooms', { cookie, body: { rouletteMode: 'x' } });
    assert.equal(bad.status, 400);
    const created = await call('POST', '/admin/api/rooms', { cookie, body: { mode: 'kids', rouletteMode: 'skill' } });
    assert.equal(created.status, 201);
    assert.equal(created.json.room.config.rouletteMode, 'skill');
    const { id, code } = created.json.room;
    const A = (await call('POST', '/api/session')).json.token;
    const B = (await call('POST', '/api/session')).json.token;
    await call('POST', '/api/rooms/join', { token: A, body: { code, name: '에이' } });
    await call('POST', '/api/rooms/join', { token: B, body: { code, name: '비' } });
    await call('POST', `/api/rooms/${id}/characters`, { token: A, body: { name: '에이1' } });
    await call('POST', `/api/rooms/${id}/characters`, { token: B, body: { name: '비1' } });
    assert.equal((await call('POST', `/admin/api/rooms/${id}/start`, { cookie })).status, 200);
    const room = (await call('GET', `/api/rooms/${id}`, { token: A })).json;
    const c = room.characters.find((x) => x.id === room.turn.order[room.turn.currentIndex]);
    const [me, other] = c.isMe ? [A, B] : [B, A];
    const otherChar = room.characters.find((x) => x.id !== c.id);
    const bet = await call('POST', `/api/rooms/${id}/actions`, { token: other, body: { type: 'bet', characterId: otherChar.id, kind: 'oddEven', pick: 'odd', amount: 5 } });
    assert.equal(bet.status, 409);
    assert.match(bet.json.error, /실력 모드/);
    const r = await call('POST', `/api/rooms/${id}/actions`, { token: me, body: { type: 'spin', characterId: c.id, target: 3, input: 'shake' } });
    assert.equal(r.status, 200, r.text);
    const sp = r.json.events.find((e) => e.type === 'spun');
    assert.deepEqual([sp.skill, sp.target, sp.input], [true, 3, 'shake']);
    assert.equal(r.json.room.characters.find((x) => x.id === c.id).aimUsed, undefined);
    assert.equal(meta.balance.roulette.skill.deck, undefined);
  } finally {
    await srv.close();
    await tmp.cleanup();
  }
});
