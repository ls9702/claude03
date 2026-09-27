// Verifier fixes (engine/rules side): pension recipients, side-bet EV, host turn timer, skip/force spin,
// RNG secret mixing, era-turn minimums, spectators, turn-order balance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameData } from '../server/data/index.js';
import { minEraTurns, validateRoomConfig } from '../server/game/config.js';
import { applyAction, betWinDelta, betWins, mixSecret, startGame } from '../server/game/engine.js';
import { MAX_PLAYERS, addCharacter, joinRoom, setReady } from '../server/game/lobby.js';
import { viewFor } from '../server/game/view.js';
import { simulateBias } from '../scripts/simulate.js';
import { atEraEnd, makeRoom, plainEra, toEra } from './helpers.js';

function lobby({ chars = [['A', 'A1'], ['B', 'B1']], config = {}, seed = 7 } = {}) {
  let room = makeRoom({ seed });
  room.config = { ...room.config, ...config, eraTurns: { ...room.config.eraTurns, ...(config.eraTurns ?? {}) } };
  room = joinRoom(room, 'A', '에이', 0).room;
  room = joinRoom(room, 'B', '비', 0).room;
  for (const [owner, name] of chars) room = addCharacter(room, owner, { name }, 0).room;
  return room;
}

function started(opts = {}, ctx = { now: 0 }) {
  const r = startGame(lobby(opts), ctx);
  assert.equal(r.ok, true, r.error);
  return r.room;
}

function fixedRng(values) {
  const q = [...values];
  return { next: () => 0, int: (a) => (q.length ? q.shift() : a), pick: (arr) => arr[0], weighted: (items) => items[0], get state() { return 4242; } };
}
const act = (room, action, values = [], now = 1000) => applyAction(room, action, { rng: fixedRng(values), now });
const ch = (room, id) => room.characters.find((c) => c.id === id);
const cur = (room) => room.turn.order[room.turn.currentIndex];

test('pension: recipients decided once at the transition into senior; never more than bottomN payouts', () => {
  const cfg = gameData().balance.pension;
  let room = started({ chars: [['A', 'A1'], ['B', 'B1'], ['A', 'A2'], ['B', 'B2'], ['A', 'A3']] });
  const seniorIdx = room.board.eras.findIndex((e) => e.id === cfg.era);
  toEra(room, seniorIdx - 1);
  plainEra(room, seniorIdx - 1);
  for (const c of room.characters) Object.assign(c, { careerDone: true, military: { status: 'done', turnsLeft: 0 }, job: { id: 'chef', rank: 1, exp: 0, injured: 0 } });
  const order = [...room.turn.order];
  order.forEach((id, i) => (ch(room, id).money = 1000 + i * 1000)); // first in order = poorest
  atEraEnd(room);
  const r = act(room, { type: 'spin', characterId: cur(room) }, [1]);
  const paid = r.events.filter((e) => e.type === 'moneyChanged' && e.reason === 'pension').map((e) => e.charId);
  room = r.room;
  const decided = structuredClone(room.pension);
  assert.equal(decided.recipients.length, cfg.bottomN);
  assert.deepEqual(decided.recipients, order.slice(0, cfg.bottomN), 'the bottom by total assets');
  assert.equal(typeof decided.decidedAt, 'number');
  assert.deepEqual([...paid].sort(), [...decided.recipients].sort(), 'each recipient paid at once');
  assert.equal(room.characters.filter((c) => c.pensionGiven).length, cfg.bottomN);
  // the order of events: eraTransition → eraChanged ×5 → pension (an opening) → turnStarted
  const ts = r.events.map((e) => e.type);
  const pensionAt = r.events.findIndex((e) => e.reason === 'pension');
  assert.ok(ts.indexOf('eraTransition') < ts.lastIndexOf('eraChanged') && ts.lastIndexOf('eraChanged') < pensionAt);
  assert.ok(pensionAt < ts.indexOf('turnStarted'));
});

test('pension: < minCharacters → nobody; restart resets room.pension', () => {
  const room = started();
  assert.equal(room.pension, null);
  const seniorIdx = room.board.eras.findIndex((e) => e.id === gameData().balance.pension.era);
  toEra(room, seniorIdx - 1);
  plainEra(room, seniorIdx - 1);
  for (const c of room.characters) Object.assign(c, { careerDone: true, military: { status: 'done', turnsLeft: 0 }, job: { id: 'chef', rank: 1, exp: 0, injured: 0 } });
  atEraEnd(room);
  const r = act(room, { type: 'spin', characterId: cur(room) }, [1]);
  assert.ok(r.events.some((e) => e.type === 'eraTransition'));
  assert.ok(!r.events.some((e) => e.reason === 'pension'));
});

test('side bets: every pick has expected value ≤ 0 (and ≥ −0.1 per unit) for every stake', () => {
  const { bets, spin } = gameData().balance;
  const values = [];
  for (let v = spin.min; v <= spin.max; v++) values.push(v);
  // ranges partition the spin values
  const covered = values.map((v) => Object.values(bets.ranges).filter(([lo, hi]) => v >= lo && v <= hi).length);
  assert.ok(covered.every((n) => n === 1), 'ranges cover each value exactly once');
  const picks = [...['odd', 'even'].map((pick) => ({ kind: 'oddEven', pick })), ...Object.keys(bets.ranges).map((pick) => ({ kind: 'range', pick }))];
  assert.deepEqual(Object.keys(bets.payouts).sort(), picks.map((p) => p.pick).sort(), 'a payout per pick');
  const bal = gameData().balance;
  for (const p of picks) {
    const win = values.filter((v) => betWins(p, v, bal)).length / values.length;
    const evUnit = win * bets.payouts[p.pick] - 1;
    assert.ok(evUnit <= 1e-9 && evUnit >= -0.1 - 1e-9, `${p.pick}: EV/unit ${evUnit}`);
    for (let amount = bets.minAmount; amount <= bets.maxAmount; amount++) {
      const ev = win * betWinDelta({ ...p, amount }, bal) - (1 - win) * amount;
      assert.ok(ev <= 1e-9, `${p.pick} ${amount}: EV ${ev}`);
    }
  }
});

test('host turn timer: spinDeadlineAt, auto spin only after it, single-character prompt deadline', () => {
  const t = 30;
  // kids mode: the first turn starts at the roulette
  let room = started({ config: { turnTimeoutSec: t, mode: 'kids' } }, { now: 0 });
  assert.equal(room.turn.spinDeadlineAt, t * 1000);
  const c = cur(room);
  const auto = { type: 'spin', characterId: c, auto: true, actor: { system: true } };
  assert.throws(() => act(room, auto, [1], t * 1000 - 1), { status: 409 });
  const r = act(room, auto, [1], t * 1000);
  assert.ok(r.events.some((e) => e.type === 'log' && /자동/.test(e.text)));
  assert.equal(r.events.find((e) => e.type === 'spun').auto, true);
  // adult mode: the first turn opens the job offer before the spin → a single-character prompt gets the turn timer
  room = started({ config: { turnTimeoutSec: t, mode: 'adult', eraTurns: { young: 5, middle_age: 5 } } }, { now: 0 });
  const offer = room.turn.pending;
  assert.equal(offer.kind, 'jobOffer');
  assert.equal(offer.deadlineAt, t * 1000);
  const a = cur(room);
  // answered → back to the roulette with a fresh spin deadline
  const r1 = act(room, { type: 'choose', characterId: a, promptId: offer.promptId, optionId: offer.options[0].id }, [], 40_000);
  assert.equal(r1.room.turn.phase, 'awaitSpin');
  assert.equal(r1.room.turn.spinDeadlineAt, 40_000 + t * 1000);
  // a prompt after the spin (찬스 광장 / tile) also gets the timer; the spin deadline is gone
  const r2 = act(r1.room, { type: 'spin', characterId: a }, [1], 50_000);
  assert.equal(r2.room.turn.spinDeadlineAt === null || r2.room.turn.order[r2.room.turn.currentIndex] !== a, true);
  if (r2.room.turn.pending?.charId === a) assert.equal(r2.room.turn.pending.deadlineAt, 50_000 + t * 1000);
  // off (default): no deadlines
  room = started({ config: { mode: 'adult', eraTurns: { young: 5, middle_age: 5 } } });
  assert.equal(room.turn.spinDeadlineAt, null);
  assert.equal(room.turn.pending.kind, 'jobOffer');
  assert.equal(room.turn.pending.deadlineAt, null);
  const kids = started({ config: { mode: 'kids' } });
  assert.throws(() => act(kids, { ...auto, characterId: cur(kids) }, [1], 10 ** 9), { status: 409 });
  // group prompts keep the (raised) multi timeout
  assert.equal(gameData().balance.prompts.multiTimeoutMs, 40000);
});

test('skip turn: admin/system only, awaitSpin only; voids this turn’s side bets', () => {
  let room = started({ chars: [['A', 'A1'], ['B', 'B1'], ['A', 'A2']] });
  const first = cur(room);
  const bettor = room.turn.order.find((id) => ch(room, id).ownerSessionId === 'B');
  if (ch(room, first).ownerSessionId !== 'B') room = act(room, { type: 'bet', characterId: bettor, kind: 'oddEven', pick: 'odd', amount: 10, actor: { sessionId: 'B' } }).room;
  assert.throws(() => act(room, { type: 'skip', actor: { sessionId: 'A' } }), { status: 403 });
  const turnNo = room.turn.turnNo;
  const r = act(room, { type: 'skip', actor: { admin: true } });
  assert.notEqual(cur(r.room), first);
  assert.equal(r.room.turn.turnNo, turnNo + 1);
  assert.equal(r.room.bets[turnNo], undefined);
  assert.deepEqual(ch(r.room, first).position, ch(room, first).position, 'did not move');
  assert.ok(r.events.some((e) => e.type === 'log' && /턴을 넘겼/.test(e.text)));
  assert.ok(r.events.some((e) => e.type === 'turnStarted'));
  // not while a prompt is open
  const p = structuredClone(r.room);
  p.turn.pending = { promptId: 'prX', forCharacterIds: [cur(p)], answers: {}, options: [{ id: 'a' }], defaultOptionId: 'a', kind: 'exam', charId: cur(p) };
  p.turn.phase = 'awaitDecision';
  assert.throws(() => act(p, { type: 'skip', actor: { admin: true } }), { status: 409 });
  // admin force spin = spin for the current character with an admin log line
  const f = act(r.room, { type: 'spin', characterId: cur(r.room), actor: { admin: true } }, [2]);
  assert.ok(f.events.some((e) => e.type === 'log' && /관리자가/.test(e.text)));
});

test('rng secret: board unchanged, spins unpredictable from it; injected secret stays deterministic', () => {
  const base = lobby();
  const plain = startGame(base, { now: 0 }).room;
  const s1 = startGame(base, { now: 0, secret: 123456 }).room;
  const s1b = startGame(base, { now: 0, secret: 123456 }).room;
  const s2 = startGame(base, { now: 0, secret: 654321 }).room;
  assert.deepEqual(s1.board, plain.board, 'the public board does not depend on the secret');
  assert.equal(s1.rngState, s1b.rngState, 'same secret → same stream');
  assert.notEqual(s1.rngState, plain.rngState);
  assert.notEqual(s1.rngState, s2.rngState);
  assert.equal(mixSecret(plain.rngState, 123456), s1.rngState);
  // a restored game continues identically from rngState
  const spin = (room) => applyAction(room, { type: 'spin', characterId: cur(room) }, { now: 1 }).events.find((e) => e.type === 'spun').value;
  assert.equal(spin(s1), spin(JSON.parse(JSON.stringify(s1))));
  const values = new Set();
  for (let k = 1; k <= 12; k++) values.add(spin(startGame(base, { now: 0, secret: k * 7919 }).room));
  assert.ok(values.size > 1, 'different secrets give different first spins');
});

test('config: route eras ≥ 3 turns, other eras ≥ 1, the final race length 20–80, turnTimeoutSec ∈ {0,30,60,90,120}', () => {
  assert.equal(minEraTurns('young', 'lifetime'), 3);
  assert.equal(minEraTurns('high', 'kids'), 1);
  assert.equal(minEraTurns('high', 'lifetime'), 1);
  let r = validateRoomConfig({ eraTurns: { young: 2 } });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /청년 턴 수는 갈림길·합류 칸이 있어 3 이상/);
  assert.equal(validateRoomConfig({ mode: 'adult', eraTurns: { middle_age: 1 } }).ok, false);
  assert.equal(validateRoomConfig({ eraTurns: { young: 3, middle_age: 3 } }).ok, true);
  assert.equal(validateRoomConfig({ mode: 'kids', eraTurns: { young: 1 } }).ok, true, 'eras outside the mode are not checked');
  assert.equal(validateRoomConfig({ mode: 'kids', eraTurns: { high: 1 } }).ok, true);
  assert.equal(validateRoomConfig({ mode: 'lifetime', eraTurns: { high: 1 } }).ok, true);
  // the final era has no turn limit: its eraTurns value is not checked; finalLength is
  assert.equal(validateRoomConfig({ eraTurns: { senior: 1 } }).ok, true);
  assert.equal(validateRoomConfig({}).config.finalLength, 40);
  assert.equal(validateRoomConfig({ finalLength: 80 }).config.finalLength, 80);
  for (const bad of [19, 81, 40.5, '40', null]) {
    const v = validateRoomConfig({ finalLength: bad });
    assert.equal(v.ok, false, String(bad));
    assert.match(v.errors[0], /노년 길이는 20~80칸/);
  }
  assert.equal(validateRoomConfig({}).config.turnTimeoutSec, 0);
  assert.equal(validateRoomConfig({ turnTimeoutSec: 60 }).config.turnTimeoutSec, 60);
  for (const bad of [45, -30, '30', 30.5, null]) assert.equal(validateRoomConfig({ turnTimeoutSec: bad }).ok, false, String(bad));
});

test('spectators: join any status, not counted, no characters/ready; role in viewFor', () => {
  let room = makeRoom();
  for (let i = 0; i < MAX_PLAYERS; i++) room = joinRoom(room, `s${i}`, `P${i}`, 0).room;
  assert.equal(joinRoom(room, 'late', '늦음', 0).ok, false, 'room is full for players');
  const sp = joinRoom(room, 'watch', '관전', 0, { spectator: true });
  assert.equal(sp.ok, true);
  assert.equal(sp.player.role, 'spectator');
  room = sp.room;
  assert.equal(addCharacter(room, 'watch', { name: '몰래' }, 0).status, 403);
  assert.equal(setReady(room, 'watch', true).status, 403);
  const v = viewFor(room, 'watch');
  assert.equal(v.me.role, 'spectator');
  assert.equal(v.players.find((p) => p.isMe).role, 'spectator');
  assert.equal(viewFor(room, 's0').me.role, 'player');
  // playing / finished rooms accept spectators only
  const playing = started();
  assert.equal(joinRoom(playing, 'x', '엑스', 0).status, 409);
  const j = joinRoom(playing, 'x', '엑스', 0, { spectator: true });
  assert.equal(j.ok, true);
  assert.equal(joinRoom({ ...playing, status: 'finished' }, 'y', '와이', 0, { spectator: true }).ok, true);
  // a spectator session cannot act for a character
  const c = cur(j.room);
  assert.throws(() => act(j.room, { type: 'spin', characterId: c, actor: { sessionId: 'x' } }), { status: 403 });
});

test('turn-order balance: small seeded 8-character lifetime simulation stays even', () => {
  const { goalPrizes } = gameData().balance;
  assert.ok(goalPrizes.every((p, i) => i === 0 || p <= goalPrizes[i - 1]), 'prizes never increase');
  // Tuned offline with `node scripts/simulate.js --bias --games 1000` (win share 10.5–14.5 %); this quick run with
  // short eras only guards against a gross regression.
  const r = simulateBias({ games: 6, seed: 5, eraTurns: { baby: 1, elem: 1, middle: 1, high: 1, young: 3, middle_age: 3 }, finalLength: 20 });
  // Σ win share = 1 (+ the rare exact tie for 1st: both characters get rank 1)
  const share = r.winShare.reduce((a, b) => a + b, 0);
  assert.ok(share >= 1 - 1e-9 && share <= 1 + 2 / 6 + 1e-9, `win share sum ${share}`);
  assert.ok(Math.abs(r.avgRank[0] - r.avgRank.at(-1)) <= 1.5, `spread ${r.avgRank[0] - r.avgRank.at(-1)}`);
  assert.ok(Math.max(...r.winShare) <= 0.67, `max win share ${Math.max(...r.winShare)}`);
});
