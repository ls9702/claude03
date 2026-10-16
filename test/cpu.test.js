// Stage 9-C — CPU players (pure): decisions for every prompt kind, cards / sabotage, trades, lobby rules, full games.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameData, loadData } from '../server/data/index.js';
import { applyAction, startGame } from '../server/game/engine.js';
import { createTx } from '../server/game/effects.js';
import { PROMPTS, openPrompt } from '../server/game/prompts.js';
import { validateRoomConfig } from '../server/game/config.js';
import { CPU_NAMES, addCharacter, addCpuCharacter, canManageCpu, joinRoom, parseCpuPersonality, removeCpuCharacter, roomHost, setCpuPersonality } from '../server/game/lobby.js';
import { CPU_ANSWERS, PERSONALITIES, cpuAnswer, cpuCardAction, cpuConfig, cpuDecide, cpuDreamJob, cpuDue, cpuNextAction, cpuPersonality, cpuTradeAccept, prefWeight } from '../server/game/cpu.js';
import { cpuHandicap, cpuMeta, handicapActive, startMoneyFor, treasureValueFor } from '../server/game/cpuHandicap.js';
import { findTreasure } from '../server/game/treasures.js';
import { effectsFor } from '../server/game/news.js';
import { regularJobs } from '../server/game/jobs.js';
import { resolveTile } from '../server/game/spaces.js';
import { createRng } from '../server/game/rng.js';
import { viewFor } from '../server/game/view.js';
import { TARGETS, cpuVsHumans, cpuVsRandom, humanAction, playCpuGame, seatPlan } from '../scripts/cpu-game.js';
import { makeRoom } from './helpers.js';

const data = gameData();
/** The strong heuristic (expert human proxy / simulations); the real CPUs use the personality tables (default level). */
const HARD = { level: 'hard' };
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
    // CH-1: a seeded roster character + 0–2 choosable props
    assert.ok(loadData('roster').characters.some((r) => r.id === c.avatar.character), c.avatar.character);
    assert.ok(Object.keys(c.avatar.props).length <= 2);
    assert.equal(cpuPersonality(c, room), c.cpuPersonality);
  }
  // deterministic per room + seq
  assert.deepEqual(lobby({ cpus: 3 }).characters.map((c) => [c.avatar, c.cpuPersonality]), lobby({ cpus: 3 }).characters.map((c) => [c.avatar, c.cpuPersonality]));
  // a given name / avatar is kept
  const named = addCpuCharacter(room, { name: '  로봇  태권 ', avatar: { character: 'rakko', props: { hand: 'wand' } } }, 0);
  assert.equal(named.character.name, '로봇 태권');
  assert.deepEqual(named.character.avatar, { character: 'rakko', props: { hand: 'wand' } });
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

test('lobby: a CPU personality is chosen on add (cautious / normal / bold; absent / random = seeded) and changed in the lobby', () => {
  let room = lobby({ cpus: 0, humans: 1 });
  for (const p of PERSONALITIES) {
    const r = addCpuCharacter(room, { personality: p }, 0);
    assert.equal(r.ok, true, r.error);
    assert.equal(r.character.cpuPersonality, p);
    room = r.room;
  }
  // absent / null / '' / 'random' → the seeded pick (identical to no field)
  const seeded = addCpuCharacter(room, {}, 0).character.cpuPersonality;
  for (const v of [undefined, null, '', 'random']) assert.equal(addCpuCharacter(room, { personality: v }, 0).character.cpuPersonality, seeded, String(v));
  // anything else → 400 with a Korean message (before any other check)
  for (const v of ['wild', 'Bold', 3, {}, ['bold'], true]) {
    const r = addCpuCharacter(room, { personality: v }, 0);
    assert.equal(r.status, 400, String(v));
    assert.match(r.error, /CPU 성향은 신중·보통·대담 중 하나여야 해요/);
  }
  assert.equal(parseCpuPersonality('bold').personality, 'bold');
  assert.equal(parseCpuPersonality('random').personality, null);
  // change: a valid value (pure, logged), the same value → unchanged, 'random' → a different one
  const cpu = room.characters.find((c) => c.cpuPersonality === 'cautious');
  const changed = setCpuPersonality(room, cpu.id, 'bold', 0, { by: '사람' });
  assert.equal(changed.ok, true);
  assert.equal(changed.changed, true);
  assert.equal(ch(changed.room, cpu.id).cpuPersonality, 'bold');
  assert.equal(ch(room, cpu.id).cpuPersonality, 'cautious', 'the input room is not mutated');
  assert.match(changed.logs[0].text, /사람 님이 CPU 「.+」의 성향을 🔥 대담으로 바꿨습니다/);
  const same = setCpuPersonality(changed.room, cpu.id, 'bold', 0);
  assert.equal(same.changed, false);
  assert.equal(same.room, changed.room);
  for (let now = 0; now < 6; now++) {
    const re = setCpuPersonality(changed.room, cpu.id, 'random', now);
    assert.ok(PERSONALITIES.includes(ch(re.room, cpu.id).cpuPersonality));
    assert.notEqual(ch(re.room, cpu.id).cpuPersonality, 'bold', 'a re-roll changes it');
  }
  // refused: invalid / missing value 400, unknown 404, a human character 409, not in the lobby 409
  assert.equal(setCpuPersonality(room, cpu.id, 'wild', 0).status, 400);
  assert.equal(setCpuPersonality(room, cpu.id, undefined, 0).status, 400);
  assert.equal(setCpuPersonality(room, 'c99', 'bold', 0).status, 404);
  const human = room.characters.find((c) => c.ownerSessionId === 'H');
  assert.equal(setCpuPersonality(room, human.id, 'bold', 0).status, 409);
  assert.equal(setCpuPersonality(started(), 'c1', 'bold', 0).status, 409);
  // the view shows it (public)
  assert.ok(viewFor(changed.room, 'H').characters.some((c) => c.ownerId === 'cpu' && c.cpuPersonality === 'bold'));
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
  if (c.love) c.love = { ...c.love, partner: { id: 'pt9', name: '콩이', trait: 'int', stars: 2, species: 'penguin', avatar: { npc: 'penguin', props: {} } }, affection: 60 };
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

test('cpuDecide answers every registered prompt kind with an enabled option the engine accepts (both levels, every personality)', (t) => {
  const room = started({ cpus: 3 });
  const core = ['routeChoice', 'groupGift', 'habit', 'exam', 'career', 'military', 'jobOffer', 'jobTile', 'hiddenJobOffer', 'shop', 'holiday'];
  for (const kind of core) assert.ok(PROMPTS[kind], `${kind} registered`);
  const noFixture = new Set();
  for (const kind of Object.keys(PROMPTS)) {
    for (const personality of PERSONALITIES) {
      for (const opts of [{}, HARD]) {
        const charId = 'c1';
        const tag = `${kind}/${personality}/${opts.level ?? 'easy'}`;
        ch(room, charId).cpuPersonality = personality;
        let r = withPrompt(room, kind, charId);
        if (!r) {
          // a kind this test has no fixture for (added by a later stage): a synthetic pending of that kind
          assert.ok(!core.includes(kind), `fixture for ${kind}`);
          noFixture.add(kind);
          r = structuredClone(room);
          r.turn.pending = { promptId: 'pr99', kind, charId, title: kind, text: '', forCharacterIds: [charId], options: [{ id: 'a', label: 'A', disabled: true }, { id: 'b', label: 'B' }], defaultOptionId: 'a', simultaneous: false, answers: {}, deadlineAt: null, context: {} };
          r.turn.phase = 'awaitDecision';
          const a = cpuDecide(r, charId, data, opts);
          assert.equal(a.optionId, 'b', `${tag}: a disabled default falls back to an enabled option`);
          continue;
        }
        assert.deepEqual(r.turn.pending.answers, {}, `${tag}: nobody answers for a CPU at open`);
        const before = r.rngState;
        const action = cpuDecide(r, charId, data, opts);
        assert.equal(r.rngState, before, `${tag}: the game RNG is untouched`);
        assert.equal(action.type, 'choose', tag);
        assert.equal(action.promptId, r.turn.pending.promptId);
        const opt = r.turn.pending.options.find((o) => o.id === action.optionId);
        assert.ok(opt && !opt.disabled, `${tag}: ${action.optionId} is an enabled option`);
        assert.doesNotThrow(() => applyAction(r, action, { now: 1 }), tag);
      }
    }
  }
  for (const kind of noFixture) t.diagnostic(`${kind}: no fixture → synthetic prompt`);
  // every known kind has a heuristic (the rest use the default)
  for (const kind of core) assert.equal(typeof CPU_ANSWERS[kind], 'function', kind);
});

test('strong heuristic (level hard): route by stats / cash, jobs by salary fit, exam by odds, promotion by chance, shop reserve, holiday stake', () => {
  const room = started({ cpus: 3 });
  const pick = (kind, tweak) => {
    const r = withPrompt(room, kind, 'c1');
    tweak(ch(r, 'c1'), r);
    return cpuDecide(r, 'c1', data, HARD).optionId;
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
  // (the seeded 전직 candidate depends on the board RNG → dropped here; the change rule has its own case)
  const noChange = (r) => (r.turn.pending.options = r.turn.pending.options.filter((o) => o.id !== 'change'));
  assert.equal(pick('jobTile', (c, r) => (normal(c), (c.stats = { int: 10, str: 2, charm: 2, luck: 10 }), (c.education = 'elite'), noChange(r))), 'promotion');
  assert.equal(pick('jobTile', (c, r) => (normal(c), (c.stats = { int: 10, str: 2, charm: 2, luck: 10 }), (c.job.injured = 2), noChange(r))), 'overtime');
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

test('strong heuristic: sabotage targets the richest rival — not one holding a lawyer card, not one targeted this / last round', () => {
  const room = started({ cpus: 4 });
  room.characters.forEach((c, i) => (c.money = [100, 3000, 2000, 500][i]));
  let r = turnOf(room, 'c1', ['tax_audit']);
  let a = cpuCardAction(r, 'c1', data, HARD);
  assert.deepEqual(a, { type: 'useCard', characterId: 'c1', cardUid: 'k50', targetId: 'c2' });
  assert.doesNotThrow(() => applyAction(r, a, { now: 1 }));
  r = turnOf(room, 'c1', ['tax_audit']);
  ch(r, 'c2').cards = [{ uid: 'k9', id: 'lawyer' }];
  assert.equal(cpuCardAction(r, 'c1', data, HARD).targetId, 'c3', 'the lawyer holder is skipped');
  r = turnOf(room, 'c1', ['tax_audit']);
  ch(r, 'c2').lastTargetedBy = { c4: 2 };
  assert.equal(cpuCardAction(r, 'c1', data, HARD).targetId, 'c3', 'recently targeted by someone');
  r = turnOf(room, 'c1', ['tax_audit']);
  ch(r, 'c1').money = 10000;
  ch(r, 'c1').cpuPersonality = 'normal';
  assert.equal(cpuCardAction(r, 'c1', data, HARD), null, 'the leader keeps its sabotage card when nobody is close');
});

test('card use legality: no card when used / not my turn / prompt open; passive never; job-only only with the job', () => {
  const room = started({ cpus: 3 });
  let r = turnOf(room, 'c1', ['insurance', 'lotto', 'pledge']);
  assert.equal(cpuCardAction(r, 'c1', data, HARD), null, 'passive + another job’s pledge');
  ch(r, 'c1').job = { id: 'politician', rank: 1, exp: 0, injured: 0 };
  assert.equal(cpuCardAction(r, 'c1', data, HARD).cardUid, 'k52', '공약 with the job');
  r.turn.cardUsed = true;
  assert.equal(cpuCardAction(r, 'c1', data, HARD), null);
  r = turnOf(room, 'c1', ['energy']);
  assert.equal(cpuCardAction(r, 'c2', data, HARD), null, 'not its turn');
  // a stat card for the key stat
  r = turnOf(room, 'c1', ['study']);
  Object.assign(ch(r, 'c1'), { job: { id: 'civil_servant', rank: 1, exp: 0, injured: 0 }, era: 'young', careerDone: true, stats: { int: 3, str: 2, charm: 2, luck: 2 } });
  assert.equal(cpuCardAction(r, 'c1', data, HARD)?.cardUid, 'k50');
  // energy / taxi near the goal
  r = turnOf(room, 'c1', ['taxi']);
  const last = r.board.eras.length - 1;
  ch(r, 'c1').position = { eraIndex: last, route: 'main', index: r.board.eras[last].tiles.length - 4 };
  assert.equal(cpuCardAction(r, 'c1', data, HARD)?.cardUid, 'k50');
  // the chosen card is always legal for the engine, and cpuDecide falls back to the spin
  const a = cpuDecide(r, 'c1', data, HARD);
  const after = applyAction(r, a, { now: 1 }).room;
  assert.deepEqual(cpuDecide(after, 'c1', data, HARD), { type: 'spin', characterId: 'c1' });
  // the real CPUs: now and then one red card (any legal one, random valid target / number), never blue / passive cards
  const plays = { card: 0, none: 0 };
  for (const persona of PERSONALITIES) {
    for (let k = 0; k < 40; k++) {
      const x = turnOf(room, 'c1', ['insurance', 'research', 'tax_audit', 'exact_roll', 'big_roll']); // 5 < hand limit 6
      ch(x, 'c1').cpuPersonality = persona;
      x.rngState = 1000 + k * 7919;
      const act = cpuCardAction(x, 'c1', data);
      if (!act) {
        plays.none++;
        continue;
      }
      plays.card++;
      const id = ch(x, 'c1').cards.find((c) => c.uid === act.cardUid)?.id;
      assert.ok(['tax_audit', 'exact_roll', 'big_roll'].includes(id), `${persona}: red cards only (${id})`);
      if (id === 'exact_roll') assert.ok(act.value >= 1 && act.value <= 10);
      if (id === 'tax_audit') assert.ok(act.targetId && act.targetId !== 'c1');
      assert.equal(x.rngState, 1000 + k * 7919, 'the game RNG is untouched');
      assert.doesNotThrow(() => applyAction(x, act, { now: 1 }), `${persona}: ${id}`);
    }
  }
  assert.ok(plays.card > 0 && plays.none > 0, JSON.stringify(plays));
  // 🐢 cautious never plays a sabotage card
  for (let k = 0; k < 40; k++) {
    const x = turnOf(room, 'c1', ['tax_audit', 'noise']);
    ch(x, 'c1').cpuPersonality = 'cautious';
    x.rngState = k * 104729;
    assert.equal(cpuCardAction(x, 'c1', data), null);
  }
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

// ---------- the real CPUs (default level): personality tables, dream job ----------

test('prefWeight: exact ids, prefixes, "*", best, default and dream add up; "_" keys / non-positive weights ignored', () => {
  const prefs = { '*': 1, best: 3, default: 2, 'train:': 4, wish: 5, dream: 6, _comment: 99, leave: 0, skip: -3 };
  const ctx = { best: 'wish', def: 'leave', dream: (o) => o.id === 'train:int' };
  assert.equal(prefWeight(prefs, { id: 'wish' }, ctx), 1 + 3 + 5);
  assert.equal(prefWeight(prefs, { id: 'leave' }, ctx), 1 + 2);
  assert.equal(prefWeight(prefs, { id: 'train:int' }, ctx), 1 + 4 + 6);
  assert.equal(prefWeight(prefs, { id: 'train:str' }, ctx), 1 + 4);
  assert.equal(prefWeight(prefs, { id: 'skip' }, ctx), 1);
  assert.equal(prefWeight({}, { id: 'x' }, ctx), 0);
  // the data: every personality has prefs, knobs in range
  const cfg = cpuConfig(data);
  for (const p of PERSONALITIES) {
    const k = cfg.personalities[p];
    assert.ok(k.prefs && typeof k.prefs === 'object', p);
    for (const key of ['cardPlay', 'sabotage', 'aimRandom']) assert.ok(k[key] >= 0 && k[key] <= 1, `${p}.${key}`);
    assert.ok(k.tradeMargin > 0, p);
  }
  assert.equal(cfg.personalities.cautious.sabotage, 0);
});

/** A CPU's pick of a synthetic prompt for many sub-RNG states: {optionId: count}. */
function picks(room, charId, pending, n = 80, opts = {}) {
  const r = structuredClone(room);
  r.turn.pending = { promptId: 'pr90', charId, title: pending.kind, text: '', forCharacterIds: [charId], simultaneous: false, answers: {}, deadlineAt: null, context: {}, ...pending };
  r.turn.phase = 'awaitDecision';
  const out = {};
  for (let k = 0; k < n; k++) {
    r.rngState = 31 + k * 7919;
    const id = cpuAnswer(r, charId, data, opts);
    const o = pending.options.find((x) => x.id === id);
    assert.ok(o && !o.disabled, `${pending.kind}: ${id} enabled`);
    out[id] = (out[id] ?? 0) + 1;
  }
  return out;
}

test('personalities play in style: 🐢 passes 찬스 광장 / skips gambles, 🔥 wishes / gambles on favourites, never 올인 or long shots', () => {
  const room = started({ cpus: 3 });
  const c1 = ch(room, 'c1');
  c1.money = 3000;
  const pass = { kind: 'passTile', defaultOptionId: 'pass', options: [{ id: 'wish', price: 40, cost: 40, chance: 0.4, money: 100 }, { id: 'wishAll', price: 32, cost: 32, gift: 8, others: 2 }, { id: 'buy', price: 150, offers: [] }, { id: 'jobChange', disabled: true }, { id: 'pass', buff: { id: 'statUp' } }] };
  c1.cpuPersonality = 'cautious';
  const cautious = picks(room, 'c1', pass);
  assert.ok((cautious.pass ?? 0) >= 50, JSON.stringify(cautious));
  c1.cpuPersonality = 'bold';
  const bold = picks(room, 'c1', pass);
  assert.ok((bold.wish ?? 0) + (bold.wishAll ?? 0) >= 40, JSON.stringify(bold));
  assert.ok((bold.pass ?? 0) < (cautious.pass ?? 0));
  // the final race's 인생역전섬: no CPU goes 전 재산 올인 or bets on a 5배 / 10배 long shot
  const rev = { kind: 'reversal', defaultOptionId: 'skip', options: ['lotto', 'horse:2', 'horse:5', 'horse:10', 'allIn', 'retire', 'skip'].map((id) => ({ id })) };
  for (const p of PERSONALITIES) {
    c1.cpuPersonality = p;
    const got = picks(room, 'c1', rev, 60);
    for (const bad of ['allIn', 'horse:5', 'horse:10']) assert.ok(!got[bad], `${p}: ${bad} ${JSON.stringify(got)}`);
    if (p === 'cautious') assert.ok(!got['horse:2'] && !got.lotto || (got.skip ?? 0) + (got.retire ?? 0) >= 40, JSON.stringify(got));
  }
  // jobTile: 🐢 mostly overtime, 🔥 mostly a change of job
  const tile = { kind: 'jobTile', defaultOptionId: 'promotion', options: [{ id: 'promotion' }, { id: 'change', jobId: 'chef' }, { id: 'overtime' }] };
  c1.cpuPersonality = 'cautious';
  assert.ok((picks(room, 'c1', tile).overtime ?? 0) >= 35);
  c1.cpuPersonality = 'bold';
  assert.ok((picks(room, 'c1', tile).change ?? 0) >= 35);
  // the strong heuristic ignores the tables (deterministic: one answer for every sub-RNG state)
  c1.cpuPersonality = 'normal';
  assert.equal(Object.keys(picks(room, 'c1', pass, 20, HARD)).length, 1);
});

test('dream job: seeded per CPU from its personality pool; offered → mostly taken; habits train toward it', () => {
  const room = started({ cpus: 3 });
  const ids = regularJobs(data).map((j) => j.id);
  const cfg = cpuConfig(data);
  for (const c of room.characters) {
    const d = cpuDreamJob(room, c, data);
    assert.ok(ids.includes(d), d);
    assert.equal(cpuDreamJob(room, c, data), d, 'deterministic');
    const pool = cfg.personalities[cpuPersonality(c, room)].dreamJobs;
    if (Array.isArray(pool)) assert.ok(pool.includes(d), `${c.cpuPersonality}: ${d}`);
  }
  // spread over the CPUs of many rooms: every regular job is somebody's dream
  const seen = new Set();
  for (let seed = 1; seed <= 60 && seen.size < ids.length; seed++) for (const c of started({ cpus: 3, seed }).characters) seen.add(cpuDreamJob(started({ cpus: 3, seed }), c, data));
  assert.equal(seen.size, ids.length, [...ids].filter((x) => !seen.has(x)).join(','));
  const c1 = ch(room, 'c1');
  const dream = cpuDreamJob(room, c1, data);
  const others = ids.filter((x) => x !== dream).slice(0, 2);
  const offer = { kind: 'jobOffer', defaultOptionId: others[0], options: [...others, dream].map((id) => ({ id, jobId: id })) };
  const got = picks(room, 'c1', offer);
  assert.ok((got[dream] ?? 0) >= 50, JSON.stringify(got));
});

// ---------- the handicap against people ----------

test('CPU handicap: against people a CPU starts with less money, earns less (salary / money tiles / good events) and finds cheaper treasures; CPU-only rooms unchanged', () => {
  const h = data.balance.cpu.handicap;
  assert.ok(h.enabled !== false && h.startMoneyMult < 1 && h.incomeMult < 1 && h.treasureMult < 1, 'the handicap is on');
  const room = started({ cpus: 2, humans: 1 });
  const human = room.characters.find((c) => c.ownerSessionId === 'H');
  const cpu = room.characters.find((c) => c.ownerSessionId === 'cpu');
  assert.equal(handicapActive(room), true);
  assert.equal(human.money, 1000);
  assert.equal(cpu.money, Math.round((1000 * h.startMoneyMult) / 10) * 10);
  assert.equal(startMoneyFor(room, cpu, data), cpu.money);
  assert.equal(cpuHandicap(room, human, data), null, 'people never');
  const only = started({ cpus: 3 });
  assert.equal(handicapActive(only), false);
  assert.ok(only.characters.every((c) => c.money === 1000), 'a CPU-only room plays as before');
  // income: through the per-character effect multipliers (losses untouched)
  const tx = createTx(room, { rng: createRng(1), now: 0, data });
  const eh = effectsFor(tx, human);
  const ec = effectsFor(tx, cpu);
  assert.equal(ec.salaryMult, eh.salaryMult * h.incomeMult);
  assert.equal(ec.moneyTileMult, eh.moneyTileMult * h.incomeMult);
  assert.equal(ec.incomeMult, h.incomeMult);
  assert.equal(ec.lossMult, eh.lossMult);
  assert.equal(effectsFor(createTx(only, { rng: createRng(1), now: 0, data }), only.characters[0]).salaryMult, eh.salaryMult);
  // a money tile: the amount logged = the money moved (consistent on screen)
  const before = cpu.money;
  resolveTile(tx, cpu, { id: 'young:main:9', type: 'money', amount: 100, label: '보너스' });
  const ev = tx.events.find((e) => e.type === 'moneyChanged' && e.charId === cpu.id);
  assert.equal(ev.delta, Math.round((100 * h.incomeMult) / 5) * 5);
  assert.equal(cpu.money - before, ev.delta);
  assert.ok(tx.room.log.at(-1).text.includes(`+${ev.delta}만원`), tx.room.log.at(-1).text);
  // switched off in the data → no handicap; /api/meta.cpu mirrors it
  const off = structuredClone(data);
  off.balance.cpu.handicap.enabled = false;
  assert.equal(cpuHandicap(room, cpu, off), null);
  assert.equal(cpuMeta(off.balance).handicap, null);
  assert.deepEqual(cpuMeta(data.balance), { personalities: PERSONALITIES, handicap: { startMoneyMult: h.startMoneyMult, incomeMult: h.incomeMult, treasureMult: h.treasureMult } });
  // treasures: a CPU's real treasure is appraised × treasureMult (fakes untouched); people / CPU-only rooms unchanged
  assert.equal(treasureValueFor(room, cpu, data, 1000, false), Math.max(5, Math.round((1000 * h.treasureMult) / 5) * 5));
  assert.equal(treasureValueFor(room, cpu, data, 3, true), 3);
  assert.equal(treasureValueFor(room, human, data, 1000, false), 1000);
  assert.equal(treasureValueFor(only, only.characters[0], data, 1000, false), 1000);
  const ttx = createTx(room, { rng: createRng(5), now: 0, data });
  const found = findTreasure(ttx, cpu, 'tile');
  const ref = createTx(structuredClone(room), { rng: createRng(5), now: 0, data });
  const refCpu = ch(ref.room, cpu.id);
  refCpu.ownerSessionId = 'H'; // the same draw for a person
  const same = findTreasure(ref, refCpu, 'tile');
  assert.equal(same.id, found.id, 'the same RNG draws');
  assert.equal(ttx.room.treasureValues[found.uid], treasureValueFor(room, cpu, data, ref.room.treasureValues[same.uid], !!ref.room.treasureFakes?.[same.uid]));
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

test('scripts/cpu-game.js: CPU-only games, human proxies (casual / random / expert) with legal actions, rotating seats, summaries', async () => {
  const g = playCpuGame({ cpus: 4, seed: 2, eraTurns: SHORT });
  assert.equal(g.room.status, 'finished');
  assert.equal(g.ranking.length, 4);
  assert.deepEqual(seatPlan(4, 1, 0), ['human', 'cpu', 'cpu', 'cpu']);
  assert.deepEqual(seatPlan(4, 1, 2), ['cpu', 'cpu', 'human', 'cpu']);
  assert.deepEqual(seatPlan(4, 2, 1), ['cpu', 'human', 'cpu', 'human']);
  assert.equal(seatPlan(8, 4, 3).filter((x) => x === 'human').length, 4);
  // every proxy action is accepted by the engine (playCpuGame would throw otherwise); the expert = the strong heuristic
  for (const [humanPolicy, seed] of [['casual', 3], ['random', 4], ['expert', 5]]) {
    const r = playCpuGame({ cpus: 2, humans: 1, humanPolicy, seed, seat: seed % 3, eraTurns: SHORT, cpuPersonality: 'mix' });
    assert.equal(r.room.status, 'finished', humanPolicy);
    assert.equal(r.room.characters.filter((c) => c.ownerSessionId === 'cpu').length, 2);
    assert.deepEqual(new Set(r.room.characters.filter((c) => c.ownerSessionId === 'cpu').map((c) => c.cpuPersonality)).size, 2, 'mix rotates personalities');
  }
  // casual: the default 70 % of the time + a random enabled option 30 % (never the default for routes)
  const room = started({ cpus: 1, humans: 1 });
  const hid = room.characters.find((c) => c.ownerSessionId === 'H').id;
  const r = structuredClone(room);
  r.turn.pending = { promptId: 'pr5', kind: 'temple', charId: hid, forCharacterIds: [hid], options: [{ id: 'wish', disabled: true }, { id: 'train:int' }, { id: 'leave' }], defaultOptionId: 'leave', answers: {}, simultaneous: false, context: {} };
  const rng = createRng(3);
  const count = {};
  for (let k = 0; k < 200; k++) {
    const a = humanAction('casual', r, hid, rng, data);
    count[a.optionId] = (count[a.optionId] ?? 0) + 1;
  }
  assert.ok(!count.wish && count.leave > 150 && count['train:int'] > 10, JSON.stringify(count)); // ≈ 85 / 15
  const s = await cpuVsHumans({ games: 2, seed: 1, cpus: 2, humans: 1, humanPolicy: 'casual', eraTurns: SHORT, cpuPersonality: 'mix' });
  assert.equal(s.games, 2);
  assert.equal(s.humanWins + s.cpuWins, 2);
  assert.ok(s.humanWinShare >= 0 && s.humanWinShare <= 1);
  assert.ok(Object.keys(s.byPers).every((k) => PERSONALITIES.includes(k)));
  const vs = cpuVsRandom({ games: 1, seed: 1, cpus: 2, randoms: 2, eraTurns: SHORT });
  assert.equal(vs.games, 1);
  assert.ok(vs.cpuWinShare >= 0 && vs.cpuWinShare <= 1);
  assert.deepEqual(TARGETS.map((t) => [t.key, t.min]), [['casual1', 0.9], ['random1', 0.75], ['casual2', 0.97], ['casual4', 0.97], ['expert1', 0.95]]);
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
