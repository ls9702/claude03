// CPU 난이도 (room setting `cpuLevel`): easy (the weak CPUs + the money handicap, default + old saves) / normal (no
// handicap; the strong heuristic with chance `balance.cpu.levels.normal.hardShare`, else the personality tables) / hard
// (the old strong heuristic, no handicap). Config, meta, lobby rule, handicap only at easy, decision level resolution,
// the normal blend, HTTP routes (host + admin), scripts/cpu-game.js level targets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameData } from '../server/data/index.js';
import { CPU_LEVELS, cpuLevelOf, defaultRoomConfig, validateRoomConfig } from '../server/game/config.js';
import { applyAction, startGame } from '../server/game/engine.js';
import { createTx } from '../server/game/effects.js';
import { addCharacter, addCpuCharacter, joinRoom, setCpuLevel } from '../server/game/lobby.js';
import { cpuAnswer, cpuDecide, cpuLevelFor, cpuNextAction } from '../server/game/cpu.js';
import { cpuHandicap, cpuMeta, handicapActive, treasureValueFor } from '../server/game/cpuHandicap.js';
import { effectsFor } from '../server/game/news.js';
import { createRng } from '../server/game/rng.js';
import { levelTargets, playCpuGame } from '../scripts/cpu-game.js';
import { startServer } from '../server/index.js';
import { httpCall, makeRoom, tempDir } from './helpers.js';
import { cpuLevelInfo, cpuLevelOf as clientLevelOf, cpuLevelOptions, cpuLevelText } from '../public/js/format.js';

const data = gameData();
const SHORT = { baby: 2, elem: 2, middle: 2, high: 2, young: 3, middle_age: 3, senior: 2 };

/** A lobby with `humans` characters of session H and `cpus` CPU characters (config overrides merged). */
function lobby({ cpus = 2, humans = 1, config = {}, seed = 5 } = {}) {
  let room = makeRoom({ seed, config: { ...makeRoom().config, ...config } });
  if (humans) room = joinRoom(room, 'H', '사람', 0).room;
  for (let i = 0; i < humans; i++) room = addCharacter(room, 'H', { name: `사람${i + 1}` }, 0).room;
  for (let i = 0; i < cpus; i++) room = addCpuCharacter(room, {}, 0).room;
  return room;
}
const started = (opts) => startGame(lobby(opts), { now: 0 }).room;

test('config: cpuLevel easy (default) | normal | hard; anything else is refused in Korean; old rooms = easy', () => {
  assert.deepEqual(CPU_LEVELS, ['easy', 'normal', 'hard']);
  assert.equal(defaultRoomConfig().cpuLevel, 'easy');
  assert.equal(validateRoomConfig({}).config.cpuLevel, 'easy');
  for (const lv of CPU_LEVELS) assert.equal(validateRoomConfig({ cpuLevel: lv }).config.cpuLevel, lv);
  for (const bad of ['HARD', 'expert', 1, null, true, '']) {
    const r = validateRoomConfig({ cpuLevel: bad });
    assert.equal(r.ok, false, String(bad));
    assert.match(r.errors.join(' '), /CPU 난이도는 쉬움\(easy\)·보통\(normal\)·어려움\(hard\) 중 하나여야 해요/);
  }
  assert.equal(cpuLevelOf({ config: {} }), 'easy', 'an old save without the field');
  assert.equal(cpuLevelOf({ config: { cpuLevel: 'weird' } }), 'easy');
  assert.equal(cpuLevelOf(null), 'easy');
  assert.equal(cpuLevelOf({ config: { cpuLevel: 'hard' } }), 'hard');
});

test('cpuMeta: levels [{id, icon, name, desc}] + defaultLevel next to personalities and the handicap', () => {
  const m = cpuMeta(data.balance);
  assert.deepEqual(m.levels.map((x) => x.id), ['easy', 'normal', 'hard']);
  assert.deepEqual(m.levels.map((x) => `${x.icon} ${x.name} (${x.desc})`), ['😊 쉬움 (사람이 거의 이겨요)', '🙂 보통 (비슷한 실력)', '😈 어려움 (예전의 강한 CPU)']);
  assert.equal(m.defaultLevel, 'easy');
  assert.ok(m.handicap && m.handicap.startMoneyMult < 1);
});

test('lobby: setCpuLevel changes the room level (log, lobby only, same value → unchanged, invalid → 400), never mutates', () => {
  const room = lobby();
  const r = setCpuLevel(room, 'hard', 1, { by: '민수' });
  assert.equal(r.ok, true);
  assert.equal(r.changed, true);
  assert.equal(r.room.config.cpuLevel, 'hard');
  assert.equal(room.config.cpuLevel, undefined, 'input untouched');
  assert.equal(r.logs[0].text, '🤖 민수 님이 CPU 난이도를 😈 어려움으로 바꿨습니다.');
  assert.equal(setCpuLevel(r.room, 'normal', 2).logs[0].text, '🤖 관리자 님이 CPU 난이도를 🙂 보통으로 바꿨습니다.');
  const same = setCpuLevel(room, 'easy', 3); // an old room without the field is already easy
  assert.equal(same.ok, true);
  assert.equal(same.changed, false);
  assert.equal(same.room, room);
  for (const bad of ['x', undefined, null, 3]) assert.equal(setCpuLevel(room, bad, 4).status, 400);
  const playing = started();
  assert.equal(setCpuLevel(playing, 'hard', 5).status, 409);
  assert.match(setCpuLevel(playing, 'hard', 5).error, /로비에서만 CPU 난이도/);
});

test('handicap only at easy: normal / hard rooms give CPUs the full start money, income and treasure values', () => {
  const h = data.balance.cpu.handicap;
  for (const level of CPU_LEVELS) {
    const room = started({ config: { cpuLevel: level } });
    const human = room.characters.find((c) => c.ownerSessionId === 'H');
    const cpu = room.characters.find((c) => c.ownerSessionId === 'cpu');
    const easy = level === 'easy';
    assert.equal(handicapActive(room), easy, level);
    assert.equal(cpu.money, easy ? Math.round((1000 * h.startMoneyMult) / 10) * 10 : 1000, level);
    assert.equal(human.money, 1000);
    assert.equal(cpuHandicap(room, cpu, data) === null, !easy, level);
    const tx = createTx(room, { rng: createRng(1), now: 0, data });
    const [eh, ec] = [effectsFor(tx, human), effectsFor(tx, cpu)];
    assert.equal(ec.salaryMult, easy ? eh.salaryMult * h.incomeMult : eh.salaryMult, level);
    assert.equal(ec.moneyTileMult, easy ? eh.moneyTileMult * h.incomeMult : eh.moneyTileMult, level);
    assert.equal(treasureValueFor(room, cpu, data, 1000, false) === 1000, !easy, level);
  }
});

test('decision level: opts.level wins, else the room cpuLevel, else easy; a hard room plays exactly like level hard', () => {
  const room = started({ cpus: 3, humans: 0, config: { cpuLevel: 'hard', eraTurns: SHORT } });
  assert.equal(cpuLevelFor(room), 'hard');
  assert.equal(cpuLevelFor(room, { level: 'easy' }), 'easy');
  assert.equal(cpuLevelFor(room, { level: 'nope' }), 'hard', 'an unknown override → the room level');
  assert.equal(cpuLevelFor({ config: {} }), 'easy');
  // a short CPU-only game at hard (through 중년; the final race is another module's): every room-level decision = the explicit
  // hard decision
  let r = room;
  let steps = 0;
  for (; r.status === 'playing' && !r.board.eras[r.eraIndex]?.final; steps++) {
    assert.ok(steps < 4000, 'stuck');
    const next = cpuNextAction(r, data);
    assert.deepEqual(next.action, cpuDecide(r, next.charId, data, { level: 'hard' }), `step ${steps}`);
    r = applyAction(r, { ...next.action, actor: { system: true, cpu: true } }, { now: steps }).room;
  }
  assert.ok(steps > 50 && r.eraIndex >= 5, `played through the loop eras (${steps} steps, era ${r.eraIndex})`);
});

test('normal level: the strong pick with chance hardShare, else the personality table; the game RNG untouched', () => {
  const room = started({ cpus: 2, humans: 1, config: { cpuLevel: 'normal' } });
  const cpu = room.characters.find((c) => c.ownerSessionId === 'cpu');
  // a synthetic prompt: no heuristic for kind 'zzz' → the strong pick = the default 'a'; the table only likes 'b'
  const d = structuredClone(data);
  d.balance.cpu.prefs.zzz = { b: 1 };
  const pending = (seq) => ({ promptId: `pr${seq}`, kind: 'zzz', charId: cpu.id, title: 'z', text: '', forCharacterIds: [cpu.id], options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], defaultOptionId: 'a', simultaneous: false, answers: {}, deadlineAt: null, context: {} });
  const r = structuredClone(room); // one copy, re-pointed per draw
  r.turn = { ...r.turn, phase: 'awaitDecision' };
  const pick = (dd, level, i) => {
    r.promptSeq = i;
    r.rngState = 1000 + i * 7919;
    r.turn.pending = pending(i);
    const id = cpuAnswer(r, cpu.id, dd, level ? { level } : {});
    assert.equal(r.rngState, 1000 + i * 7919);
    return id;
  };
  const N = 400;
  const share = (dd, level) => Array.from({ length: N }, (_, i) => pick(dd, level, i)).filter((x) => x === 'a').length / N;
  assert.equal(share(d, 'hard'), 1);
  assert.equal(share(d, 'easy'), 0);
  const hs = d.balance.cpu.levels.normal.hardShare;
  assert.ok(hs > 0 && hs < 1, 'normal mixes the two');
  const s = share(d, undefined); // the room's level (normal)
  assert.ok(Math.abs(s - hs) < 0.07, `normal: strong picks ${s} ≈ hardShare ${hs}`);
  // the extremes of the knob: 1 = hard, 0 = easy
  const all = structuredClone(d);
  all.balance.cpu.levels.normal.hardShare = 1;
  assert.equal(share(all, 'normal'), 1);
  all.balance.cpu.levels.normal.hardShare = 0;
  assert.equal(share(all, 'normal'), 0);
});

test('HTTP: admin creates a room with cpuLevel and changes it in the lobby; the host too (「CPU 허용」 only); meta.cpu.levels', async () => {
  const tmp = await tempDir();
  const srv = await startServer({ port: 0, host: '127.0.0.1', dataDir: tmp.dir, debounceMs: 5, adminPassword: 'pw', cpuDelayMs: 100000 });
  const call = (m, p, o) => httpCall(srv.url, m, p, o);
  try {
    const login = await call('POST', '/admin/api/login', { body: { password: 'pw' } });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const meta = (await call('GET', '/api/meta')).json;
    assert.deepEqual(meta.cpu.levels.map((x) => x.id), ['easy', 'normal', 'hard']);
    assert.deepEqual((await call('GET', '/admin/api/meta', { cookie })).json.cpu, meta.cpu);
    assert.equal((await call('GET', '/admin/api/meta', { cookie })).json.defaults.cpuLevel, 'easy');
    const bad = await call('POST', '/admin/api/rooms', { cookie, body: { cpuLevel: 'insane' } });
    assert.equal(bad.status, 400);
    assert.match(bad.json.error, /CPU 난이도는/);
    const room = (await call('POST', '/admin/api/rooms', { cookie, body: { mode: 'lifetime', eraTurns: SHORT, allowCpu: true, cpuLevel: 'hard' } })).json.room;
    assert.equal(room.config.cpuLevel, 'hard');
    // admin: change in the lobby (unchanged value → no log), invalid → 400, no cookie → 401
    const a1 = await call('PATCH', `/admin/api/rooms/${room.id}/cpu-level`, { cookie, body: { level: 'normal' } });
    assert.equal(a1.status, 200, a1.text);
    assert.equal(a1.json.room.config.cpuLevel, 'normal');
    assert.ok(a1.json.room.log.some((l) => l.text === '🤖 관리자 님이 CPU 난이도를 🙂 보통으로 바꿨습니다.'));
    assert.equal((await call('PATCH', `/admin/api/rooms/${room.id}/cpu-level`, { cookie, body: { level: 'x' } })).status, 400);
    assert.equal((await call('PATCH', `/admin/api/rooms/${room.id}/cpu-level`, { body: { level: 'hard' } })).status, 401);
    // host / guest / spectator
    const [A, B, W] = await Promise.all([0, 1, 2].map(async () => (await call('POST', '/api/session')).json.token));
    await call('POST', '/api/rooms/join', { token: A, body: { code: room.code, name: '방장' } });
    await call('POST', '/api/rooms/join', { token: B, body: { code: room.code, name: '손님' } });
    await call('POST', '/api/rooms/join', { token: W, body: { code: room.code, name: '구경', spectator: true } });
    const h = await call('PATCH', `/api/rooms/${room.id}/cpu-level`, { token: A, body: { level: 'easy' } });
    assert.equal(h.status, 200, h.text);
    assert.equal(h.json.room.config.cpuLevel, 'easy');
    assert.ok(h.json.room.log.some((l) => l.text === '🤖 방장 님이 CPU 난이도를 😊 쉬움으로 바꿨습니다.'));
    assert.equal((await call('PATCH', `/api/rooms/${room.id}/cpu-level`, { token: B, body: { level: 'hard' } })).status, 403);
    assert.equal((await call('PATCH', `/api/rooms/${room.id}/cpu-level`, { token: W, body: { level: 'hard' } })).status, 403);
    assert.equal((await call('PATCH', `/api/rooms/${room.id}/cpu-level`, { token: A, body: { level: 'x' } })).status, 400);
    // a room without 「CPU 허용」: the host may not; the admin may
    const plain = (await call('POST', '/admin/api/rooms', { cookie, body: { mode: 'lifetime', eraTurns: SHORT } })).json.room;
    await call('POST', '/api/rooms/join', { token: A, body: { code: plain.code, name: '방장' } });
    assert.equal((await call('PATCH', `/api/rooms/${plain.id}/cpu-level`, { token: A, body: { level: 'hard' } })).status, 409);
    // 보통 → no handicap: the CPU starts with the full money; after the start the level is fixed (409)
    await call('PATCH', `/api/rooms/${room.id}/cpu-level`, { token: A, body: { level: 'normal' } });
    await call('POST', `/api/rooms/${room.id}/characters`, { token: A, body: { name: '나' } });
    await call('POST', `/admin/api/rooms/${room.id}/cpu`, { cookie, body: { personality: 'bold' } });
    const st = await call('POST', `/admin/api/rooms/${room.id}/start`, { cookie });
    assert.equal(st.status, 200, st.text);
    assert.ok(st.json.room.characters.every((c) => c.money === st.json.room.config.startingMoney), 'no handicap at 보통');
    assert.equal((await call('PATCH', `/admin/api/rooms/${room.id}/cpu-level`, { cookie, body: { level: 'hard' } })).status, 409);
    assert.equal((await call('PATCH', `/api/rooms/${room.id}/cpu-level`, { token: A, body: { level: 'hard' } })).status, 409);
  } finally {
    await srv.close();
    await tmp.cleanup();
  }
});

test('scripts/cpu-game.js: --cpu-level sets the room setting; targets per level (easy ≥ 90 %, normal 25–45 %, hard none)', () => {
  const easy = levelTargets('easy');
  assert.equal(easy.find((t) => t.key === 'casual1').min, 0.9);
  const normal = levelTargets('normal');
  assert.deepEqual([normal[0].key, normal[0].min, normal[0].max], ['casual1', 0.25, 0.45]);
  assert.ok(normal.slice(1).every((t) => t.min == null));
  assert.ok(levelTargets('hard').every((t) => t.min == null));
  const g = playCpuGame({ cpus: 2, humans: 1, humanPolicy: 'casual', seed: 3, eraTurns: SHORT, cpuLevel: 'hard' });
  assert.equal(g.room.config.cpuLevel, 'hard');
  assert.equal(g.room.status, 'finished');
});

test('client format.js: level fallback = the server info, meta wins, picker options, short / long text', () => {
  const meta = { cpu: cpuMeta(data.balance) };
  for (const x of meta.cpu.levels) assert.deepEqual(cpuLevelInfo(x.id, null), x, 'the fallback mirrors the server');
  assert.equal(clientLevelOf({ config: {} }), 'easy');
  assert.equal(clientLevelOf({ config: { cpuLevel: 'normal' } }), 'normal');
  assert.equal(cpuLevelInfo('hard', { cpu: { levels: [{ id: 'hard', name: '매운맛' }] } }).name, '매운맛');
  const opts = cpuLevelOptions('normal', meta);
  assert.equal((opts.match(/<option /g) ?? []).length, 3);
  assert.match(opts, /<option value="normal" selected>🙂 보통 \(비슷한 실력\)<\/option>/);
  assert.equal(cpuLevelText({ config: { cpuLevel: 'hard' } }, meta), '😈 어려움 (예전의 강한 CPU)');
  assert.equal(cpuLevelText({ config: {} }, meta, { short: true }), '🤖 CPU 😊 쉬움');
});
