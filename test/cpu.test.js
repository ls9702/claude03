// Stage 9-C — CPU players (pure): decisions for every prompt kind, cards / sabotage, trades, lobby rules, full games.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameData } from '../server/data/index.js';
import { applyAction, startGame } from '../server/game/engine.js';
import { createTx } from '../server/game/effects.js';
import { PROMPTS, openPrompt } from '../server/game/prompts.js';
import { validateRoomConfig } from '../server/game/config.js';
import { CPU_NAMES, addCharacter, addCpuCharacter, canManageCpu, joinRoom, removeCpuCharacter, roomHost } from '../server/game/lobby.js';
import { CPU_ANSWERS, PERSONALITIES, cpuCardAction, cpuDecide, cpuDue, cpuNextAction, cpuPersonality, cpuTradeAccept } from '../server/game/cpu.js';
import { createRng } from '../server/game/rng.js';
import { viewFor } from '../server/game/view.js';
import { cpuVsRandom, playCpuGame } from '../scripts/cpu-game.js';
import { makeRoom } from './helpers.js';

const data = gameData();
/** Short lifetime board (route eras ≥ 3) so whole games stay fast. */
const SHORT = { baby: 2, elem: 2, middle: 2, high: 2, young: 3, middle_age: 3, senior: 2 };

/** Lobby with `cpus` CPU characters (+ optional human characters of session H). */
function lobby({ cpus = 3, humans = 0, config = {}, seed = 5 } = {}) {
  let room = makeRoom({ seed, config: { ...makeRoom().config, ...config } });
  if (humans) room = joinRoom(room, 'H', '사람', 0).room;
  for (let i = 0; i < humans; i++) room = addCharacter(room, 'H', { name: `사람${i + 1}` }, 0).room;
  for (let i = 0; i < cpus; i++) {
    const r = addCpuCharacter(room, {}, 0);
    assert.equal(r.ok, true, r.error);
    room = r.room;
  }
  return room;
}
function started(opts) {
  const r = startGame(lobby(opts), { now: 0 });
  assert.equal(r.ok, true, r.error);
  return r.room;
}
const ch = (room, id) => room.characters.find((c) => c.id === id);
const cur = (room) => room.turn.order[room.turn.currentIndex];

// ---------- lobby ----------

test('lobby: CPU characters get a pool name, a seeded look + personality; max characters; only CPUs are removable here', () => {
  const room = lobby({ cpus: 3, humans: 1 });
  const cpus = room.characters.filter((c) => c.ownerSessionId === 'cpu');
  assert.equal(cpus.length, 3);
  assert.deepEqual(cpus.map((c) => c.name), CPU_NAMES.slice(0, 3), 'first unused pool names');
  for (const c of cpus) {
    assert.ok(PERSONALITIES.includes(c.cpuPersonality));
    assert.equal(typeof c.avatar.hair, 'string');
    assert.equal(cpuPersonality(c, room), c.cpuPersonality);
  }
  // deterministic per room + seq
  assert.deepEqual(lobby({ cpus: 3 }).characters.map((c) => [c.avatar, c.cpuPersonality]), lobby({ cpus: 3 }).characters.map((c) => [c.avatar, c.cpuPersonality]));
  // a given name / avatar is kept
  const named = addCpuCharacter(room, { name: '  로봇  태권 ', avatar: { body: 'girl' } }, 0);
  assert.equal(named.character.name, '로봇 태권');
  assert.equal(named.character.avatar.body, 'girl');
  assert.equal(addCpuCharacter(room, { name: 'x'.repeat(20) }, 0).status, 400);
  // view: owner 'cpu' / 'CPU', personality public, no session tokens
  const v = viewFor(room, 'H');
  assert.deepEqual(v.characters.filter((c) => c.ownerId === 'cpu').map((c) => c.ownerName), ['CPU', 'CPU', 'CPU']);
  // max characters
  let full = makeRoom({ config: { ...makeRoom().config, maxCharacters: 2 } });
  full = addCpuCharacter(full, {}, 0).room;
  full = addCpuCharacter(full, {}, 0).room;
  assert.equal(addCpuCharacter(full, {}, 0).status, 409);
  // remove: CPU only, lobby only
  const human = room.characters.find((c) => c.ownerSessionId === 'H');
  assert.equal(removeCpuCharacter(room, human.id, 0).status, 409);
  assert.equal(removeCpuCharacter(room, 'c99', 0).status, 404);
  const removed = removeCpuCharacter(room, cpus[0].id, 0);
  assert.equal(removed.ok, true);
  assert.equal(removed.room.characters.length, 3);
  assert.equal(removeCpuCharacter(started(), 'c1', 0).status, 409, 'not while playing');
  assert.equal(addCpuCharacter(started(), {}, 0).status, 409);
});

test('lobby: the host (first joined player) manages CPUs only when allowCpu; spectators never', () => {
  let room = makeRoom();
  room = joinRoom(room, 'A', '에이', 0).room;
  room = joinRoom(room, 'W', '관전', 0, { spectator: true }).room;
  room = joinRoom(room, 'B', '비', 0).room;
  assert.equal(roomHost(room).sessionId, 'A');
  assert.equal(canManageCpu(room, 'A').status, 409, 'allowCpu off');
  room.config.allowCpu = true;
  assert.equal(canManageCpu(room, 'A').ok, true);
  assert.equal(canManageCpu(room, 'B').status, 403);
  assert.equal(canManageCpu(room, 'W').status, 403);
  assert.equal(canManageCpu(room, 'nobody').status, 403);
});

test('a CPU-only lobby starts (≥ 2 characters, no ready players needed)', () => {
  const r = startGame(lobby({ cpus: 2 }), { now: 0 });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.room.status, 'playing');
  assert.equal(startGame(lobby({ cpus: 1 }), { now: 0 }).ok, false);
});

// ---------- prompts ----------

/** Build `kind` for character `c` in a copy of `room` (fixtures for the known kinds). @returns room | null */
function withPrompt(room, kind, charId) {
  const next = structuredClone(room);
  const c = ch(next, charId);
  const ids = next.characters.map((x) => x.id);
  c.era = ['habit', 'exam'].includes(kind) ? 'high' : 'young';
  c.money = 5000;
  c.job = { id: 'civil_servant', rank: 1, exp: 0, injured: 0 };
  c.jobHistory = [{ id: 'civil_servant', rank: 1, era: 'young' }];
  if (c.love) c.love = { ...c.love, partner: { id: 'pt9', name: '연인', trait: 'int', stars: 2, body: 'girl' }, affection: 60 };
  const extras = {
    groupGift: [{ event: { text: '{name}의 생일!', gift: 20 } }, next.characters.find((x) => x.id !== charId)],
    exam: [{ retake: false }],
    career: [{ options: [{ id: 'college', label: '대학' }, { id: 'job', label: '취업' }, { id: 'retake', label: '재수' }] }],
    military: [{ mode: 'volunteer' }],
    jobOffer: [{ candidates: ['civil_servant', 'office_worker', 'police'] }],
    hiddenJobOffer: [{ jobId: 'landlord' }],
    holiday: [{ eraId: 'young', kind: 'seol', players: ids }],
    house: [{ listings: [{ houseId: 'oneroom', price: 300, basePrice: 300, value: 300, subscription: false, lucky: false }, { houseId: 'villa', price: 700, basePrice: 700, value: 700, subscription: false, lucky: false }] }],
  };
  const [extra = {}, opener = c] = extras[kind] ?? [];
  const tx = createTx(next, { rng: createRng(3), now: 0, data });
  try {
    openPrompt(tx, kind, opener, extra);
  } catch {
    return null;
  }
  return next.turn.pending?.forCharacterIds.includes(charId) ? next : null;
}

test('cpuDecide answers every registered prompt kind with an enabled option the engine accepts', (t) => {
  const room = started({ cpus: 3 });
  const core = ['routeChoice', 'groupGift', 'habit', 'exam', 'career', 'military', 'jobOffer', 'jobTile', 'hiddenJobOffer', 'shop', 'holiday'];
  for (const kind of core) assert.ok(PROMPTS[kind], `${kind} registered`);
  for (const kind of Object.keys(PROMPTS)) {
    const charId = 'c1';
    let r = withPrompt(room, kind, charId);
    if (!r) {
      // a kind this test has no fixture for (added by a later stage): a synthetic pending of that kind
      assert.ok(!core.includes(kind), `fixture for ${kind}`);
      t.diagnostic(`${kind}: no fixture → synthetic prompt`);
      r = structuredClone(room);
      r.turn.pending = { promptId: 'pr99', kind, charId, title: kind, text: '', forCharacterIds: [charId], options: [{ id: 'a', label: 'A', disabled: true }, { id: 'b', label: 'B' }], defaultOptionId: 'a', simultaneous: false, answers: {}, deadlineAt: null, context: {} };
      r.turn.phase = 'awaitDecision';
      const a = cpuDecide(r, charId, data);
      assert.equal(a.optionId, 'b', `${kind}: a disabled default falls back to an enabled option`);
      continue;
    }
    assert.deepEqual(r.turn.pending.answers, {}, `${kind}: nobody answers for a CPU at open`);
    const action = cpuDecide(r, charId, data);
    assert.equal(action.type, 'choose', kind);
    assert.equal(action.promptId, r.turn.pending.promptId);
    const opt = r.turn.pending.options.find((o) => o.id === action.optionId);
    assert.ok(opt && !opt.disabled, `${kind}: ${action.optionId} is an enabled option`);
    assert.doesNotThrow(() => applyAction(r, action, { now: 1 }), kind);
  }
  // every known kind has a heuristic (the rest use the default)
  for (const kind of core) assert.equal(typeof CPU_ANSWERS[kind], 'function', kind);
});

test('prompt heuristics: route by stats / cash, jobs by salary fit, exam by odds, promotion by chance, shop reserve, holiday stake', () => {
  const room = started({ cpus: 3 });
  const pick = (kind, tweak) => {
    const r = withPrompt(room, kind, 'c1');
    tweak(ch(r, 'c1'), r);
    return cpuDecide(r, 'c1', data).optionId;
  };
  const normal = (c) => (c.cpuPersonality = 'normal');
  // route
  assert.equal(pick('routeChoice', (c) => (normal(c), (c.stats = { int: 2, str: 2, charm: 9, luck: 2 }), (c.job = null), (c.money = 0), (c.house = { id: 'villa', value: 700 }))), 'love');
  assert.equal(pick('routeChoice', (c) => (normal(c), (c.stats = { int: 8, str: 2, charm: 2, luck: 2 }), (c.job = { id: 'office_worker', rank: 3, exp: 0, injured: 0 }), (c.money = 200))), 'career');
  assert.equal(pick('routeChoice', (c) => (normal(c), (c.stats = { int: 2, str: 2, charm: 2, luck: 6 }), (c.job = null), (c.money = 4000))), 'money');
  // job offer: the better paid job that fits
  assert.equal(pick('jobOffer', (c) => (c.stats = { int: 6, str: 2, charm: 2, luck: 2 }, (c.education = 'college'))), 'office_worker');
  // exam: study with high int, guess with high luck / low int
  assert.equal(pick('exam', (c) => (c.stats = { int: 9, str: 2, charm: 2, luck: 1 })), 'study');
  assert.equal(pick('exam', (c) => (c.stats = { int: 0, str: 2, charm: 2, luck: 10 })), 'guess');
  // career: college when admitted
  assert.equal(pick('career', () => {}), 'college');
  // job tile: promotion with a good chance, overtime with a poor one (injured → no promotion)
  assert.equal(pick('jobTile', (c) => (normal(c), (c.stats = { int: 10, str: 2, charm: 2, luck: 10 }), (c.education = 'elite'))), 'promotion');
  assert.equal(pick('jobTile', (c) => (normal(c), (c.stats = { int: 10, str: 2, charm: 2, luck: 10 }), (c.job.injured = 2))), 'overtime');
  // hidden job: accept
  assert.equal(pick('hiddenJobOffer', () => {}), 'accept');
  // shop: nothing below the reserve
  assert.equal(pick('shop', (c) => (normal(c), (c.money = 100))), 'leave');
  // holiday: pass when poor, a stake when rich
  assert.equal(pick('holiday', (c) => (normal(c), (c.money = 10))), 'pass');
  assert.notEqual(pick('holiday', (c) => (normal(c), (c.money = 100000))), 'pass');
  // birthday gift: the default (모른 척)
  assert.equal(pick('groupGift', () => {}), 'skip');
});

test('Stage 8 option fields: best partner, affordable date, propose by chance, house by value', () => {
  const ctx = { room: started({ cpus: 2 }), data };
  const c = { ...ch(ctx.room, 'c1'), cpuPersonality: 'normal', money: 1000, stats: { int: 2, str: 2, charm: 2, luck: 2 } };
  const P = (options, def = 'pass') => ({ promptId: 'p', options, defaultOptionId: def });
  assert.equal(CPU_ANSWERS.meet(ctx, c, P([{ id: 'meet:a', partnerId: 'a', stars: 1 }, { id: 'meet:b', partnerId: 'b', stars: 3 }, { id: 'pass' }])), 'meet:b');
  assert.equal(CPU_ANSWERS.date(ctx, c, P([{ id: 'walk', cost: 0, price: 0, gain: 5 }, { id: 'concert', cost: 20, price: 20, gain: 25 }], 'walk')), 'concert');
  assert.equal(CPU_ANSWERS.propose(ctx, c, P([{ id: 'propose', chance: 0.8 }, { id: 'steady', chance: 0 }])), 'propose');
  assert.equal(CPU_ANSWERS.propose(ctx, c, P([{ id: 'propose', chance: 0.2 }, { id: 'steady', chance: 0 }])), 'steady');
  const houses = [{ id: 'buy:villa', houseId: 'villa', price: 700, value: 700, tradeIn: 0, cost: 700 }, { id: 'buy:penthouse', houseId: 'penthouse', price: 3000, value: 3000, tradeIn: 0, cost: 3000 }, { id: 'pass' }];
  assert.equal(CPU_ANSWERS.house(ctx, c, P(houses)), 'buy:villa', 'the best affordable one (keeps a reserve)');
  assert.equal(CPU_ANSWERS.house(ctx, { ...c, money: 200 }, P(houses)), 'pass');
});

// ---------- cards ----------

function turnOf(room, charId, cards, round = 3) {
  const r = structuredClone(room);
  r.turn.currentIndex = r.turn.order.indexOf(charId);
  r.turn.phase = 'awaitSpin';
  r.turn.pending = null;
  r.turn.cardUsed = false;
  r.turn.round = round;
  ch(r, charId).cards = cards.map((id, i) => ({ uid: `k${50 + i}`, id }));
  return r;
}

test('sabotage targets the richest rival — not one holding a lawyer card, not one targeted this / last round', () => {
  const room = started({ cpus: 4 });
  room.characters.forEach((c, i) => (c.money = [100, 3000, 2000, 500][i]));
  let r = turnOf(room, 'c1', ['tax_audit']);
  let a = cpuCardAction(r, 'c1', data);
  assert.deepEqual(a, { type: 'useCard', characterId: 'c1', cardUid: 'k50', targetId: 'c2' });
  assert.doesNotThrow(() => applyAction(r, a, { now: 1 }));
  r = turnOf(room, 'c1', ['tax_audit']);
  ch(r, 'c2').cards = [{ uid: 'k9', id: 'lawyer' }];
  assert.equal(cpuCardAction(r, 'c1', data).targetId, 'c3', 'the lawyer holder is skipped');
  r = turnOf(room, 'c1', ['tax_audit']);
  ch(r, 'c2').lastTargetedBy = { c4: 2 };
  assert.equal(cpuCardAction(r, 'c1', data).targetId, 'c3', 'recently targeted by someone');
  r = turnOf(room, 'c1', ['tax_audit']);
  ch(r, 'c1').money = 10000;
  ch(r, 'c1').cpuPersonality = 'normal';
  assert.equal(cpuCardAction(r, 'c1', data), null, 'the leader keeps its sabotage card when nobody is close');
});

test('card use legality: no card when used / not my turn / prompt open; passive never; job-only only with the job', () => {
  const room = started({ cpus: 3 });
  let r = turnOf(room, 'c1', ['insurance', 'lotto', 'pledge']);
  assert.equal(cpuCardAction(r, 'c1', data), null, 'passive + another job’s pledge');
  ch(r, 'c1').job = { id: 'politician', rank: 1, exp: 0, injured: 0 };
  assert.equal(cpuCardAction(r, 'c1', data).cardUid, 'k52', '공약 with the job');
  r.turn.cardUsed = true;
  assert.equal(cpuCardAction(r, 'c1', data), null);
  r = turnOf(room, 'c1', ['energy']);
  assert.equal(cpuCardAction(r, 'c2', data), null, 'not its turn');
  // a stat card for the key stat
  r = turnOf(room, 'c1', ['study']);
  Object.assign(ch(r, 'c1'), { job: { id: 'civil_servant', rank: 1, exp: 0, injured: 0 }, era: 'young', careerDone: true, stats: { int: 3, str: 2, charm: 2, luck: 2 } });
  assert.equal(cpuCardAction(r, 'c1', data)?.cardUid, 'k50');
  // energy / taxi near the goal
  r = turnOf(room, 'c1', ['taxi']);
  const last = r.board.eras.length - 1;
  ch(r, 'c1').position = { eraIndex: last, route: 'main', index: r.board.eras[last].tiles.length - 4 };
  assert.equal(cpuCardAction(r, 'c1', data)?.cardUid, 'k50');
  // the chosen card is always legal for the engine, and cpuDecide falls back to the spin
  const a = cpuDecide(r, 'c1', data);
  const after = applyAction(r, a, { now: 1 }).room;
  assert.deepEqual(cpuDecide(after, 'c1', data), { type: 'spin', characterId: 'c1' });
});

// ---------- trades ----------

test('trades: a CPU accepts offers worth at least what it gives, rejects the rest; offers to CPUs are allowed', () => {
  const room = started({ cpus: 1, humans: 1 });
  const human = room.characters.find((c) => c.ownerSessionId === 'H');
  const cpu = room.characters.find((c) => c.ownerSessionId === 'cpu');
  cpu.cpuPersonality = 'normal';
  cpu.cards = [{ uid: 'k70', id: 'taxi' }]; // price 40
  human.money = 1000;
  const good = applyAction(room, { type: 'offerTrade', characterId: human.id, toId: cpu.id, give: { money: 60 }, want: { cardUid: 'k70' }, actor: { sessionId: 'H' } }, { now: 1 }).room;
  const t = good.trades[0];
  assert.equal(cpuTradeAccept(good, t, data), true);
  const d = cpuDecide(good, cpu.id, data);
  assert.deepEqual(d, { type: 'respondTrade', characterId: cpu.id, tradeId: t.id, accept: true });
  assert.equal(cpuDue(good).kind, 'trade');
  const done = applyAction(good, { ...d, actor: { system: true, cpu: true } }, { now: 2 }).room;
  assert.equal(done.characters.find((c) => c.id === human.id).cards[0].id, 'taxi');
  const cheap = applyAction(room, { type: 'offerTrade', characterId: human.id, toId: cpu.id, give: { money: 10 }, want: { cardUid: 'k70' } }, { now: 1 }).room;
  assert.equal(cpuTradeAccept(cheap, cheap.trades[0], data), false);
});

// ---------- whole games ----------

test('CPU-only games finish through cpuNextAction; CPUs never bet, offer trades or gift; every action is legal', () => {
  for (const [mode, seed] of [['lifetime', 3], ['adult', 4], ['kids', 5]]) {
    const cfg = validateRoomConfig({ mode, eraTurns: SHORT, holidays: true }).config;
    let room = lobby({ cpus: 4, config: cfg, seed });
    room = startGame(room, { now: 0 }).room;
    const types = new Set();
    for (let n = 0; room.status === 'playing'; n++) {
      assert.ok(n < 5000, 'stuck');
      const next = cpuNextAction(room, data);
      assert.ok(next, `a CPU always has something to do (${mode})`);
      types.add(next.action.type);
      const r = applyAction(room, { ...next.action, actor: { system: true, cpu: true } }, { now: n });
      for (const e of r.events) assert.ok(!['betPlaced', 'tradeOffered', 'gift'].includes(e.type), e.type);
      room = r.room;
    }
    assert.equal(room.status, 'finished');
    assert.equal(room.result.ranking.length, 4);
    for (const t of types) assert.ok(['spin', 'useCard', 'choose', 'respondTrade'].includes(t), t);
  }
});

test('scripts/cpu-game.js: headless CPU games and a CPU-vs-random sample run', () => {
  const g = playCpuGame({ cpus: 4, seed: 2, eraTurns: SHORT });
  assert.equal(g.room.status, 'finished');
  assert.equal(g.ranking.length, 4);
  const vs = cpuVsRandom({ games: 2, seed: 1, cpus: 2, randoms: 2 });
  assert.equal(vs.games, 2);
  assert.ok(vs.cpuWinShare >= 0 && vs.cpuWinShare <= 1);
});

test('cpuDue: keys follow the awaited step (card then spin → new key); humans are never awaited', () => {
  const room = started({ cpus: 1, humans: 1, config: { turnOrder: 'index' } });
  // index order: the human (c1) first
  assert.equal(cur(room), 'c1');
  assert.equal(cpuDue(room), null);
  const r = turnOf(room, 'c2', ['energy']);
  const d1 = cpuDue(r);
  assert.equal(d1.kind, 'spin');
  r.turn.cardUsed = true;
  assert.notEqual(cpuDue(r).key, d1.key);
});
