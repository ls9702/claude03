// Blue (held) / red (used) cards: hand discard order, held effects (requirement cards, 결혼운◎, 인기 폭발◎, 건강기원 부적,
// 월급 부적), the injury status card, 공적 카드 (merit) rank-ups, the red roulette cards (큰 수 / 작은 수 / 딱 그 칸 /
// 월급날 직행), side bets on a fixed spin, trades / gifts, CPU use and valuation, old-save migration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameData } from '../server/data/index.js';
import { applyAction, startGame } from '../server/game/engine.js';
import { createTx } from '../server/game/effects.js';
import { addCharacter, joinRoom } from '../server/game/lobby.js';
import {
  CARD_IDS,
  ROLL_CARDS,
  cardBlockReason,
  cardColor,
  cardDef,
  discardIndex,
  drawableCards,
  gainCard,
  rushDistance,
  syncInjuryCard,
} from '../server/game/cards.js';
import { eligibleJobs, hire, paySalary, rollInjury, salaryAmount, tryRankUp } from '../server/game/jobs.js';
import { graduate, skillCardFor, spinSteps } from '../server/game/growth.js';
import { gainAffection } from '../server/game/family.js';
import { openPrompt } from '../server/game/prompts.js';
import { cardValue, cpuCardAction, cpuTradeAccept } from '../server/game/cpu.js';
import { makeRoom, plainEra, toEra } from './helpers.js';

const data = gameData();

function started({ seed = 7, config = {} } = {}) {
  let room = makeRoom({ seed });
  room.config = { ...room.config, ...config };
  room = joinRoom(room, 'A', '에이', 0).room;
  room = joinRoom(room, 'B', '비', 0).room;
  for (const [owner, name] of [['A', 'A1'], ['B', 'B1']]) room = addCharacter(room, owner, { name }, 0).room;
  const r = startGame(room, { now: 0 });
  assert.equal(r.ok, true, r.error);
  return r.room;
}
function fixedRng({ ints = [], nexts = [] } = {}) {
  const qi = [...ints];
  const qn = [...nexts];
  return { next: () => (qn.length ? qn.shift() : 0.99), int: (a) => (qi.length ? qi.shift() : a), pick: (arr) => arr[0], weighted: (items) => items[0], get state() { return 77; } };
}
const cur = (room) => room.turn.order[room.turn.currentIndex];
const ch = (room, id) => room.characters.find((c) => c.id === id);
const expect = (fn, status, re) => assert.throws(fn, (e) => e.status === status && (!re || re.test(e.message)), `expected ${status}${re ? ` ${re}` : ''}`);
let uidSeq = 500;
const give = (c, ...ids) => {
  for (const id of ids) c.cards.push({ uid: `k${++uidSeq}`, id });
  return c.cards.at(-1).uid;
};

/**
 * 청년 (young, eraIndex 4) with a plain main ring: money tiles, the payday on main index 6, a 찬스 광장 on index 3,
 * everyone employed (공무원) on the start tile; no era openings.
 */
function young({ seed = 7, config = {} } = {}) {
  const room = structuredClone(started({ seed, config }));
  toEra(room, 4);
  plainEra(room, 4);
  const main = room.board.eras[4].tiles;
  main[6] = { ...main[6], type: 'salary', label: '월급날' };
  main[3] = { ...main[3], type: 'pass', label: '찬스 광장' };
  for (const c of room.characters) {
    Object.assign(c, { careerDone: true, examResult: 'college', military: { status: 'done', turnsLeft: 0 }, job: { id: 'civil_servant', rank: 1, exp: 0, injured: 0 }, stats: { int: 4, str: 4, charm: 4, luck: 4 }, money: 1000 });
  }
  room.erasOpened = room.board.eras.map((e) => e.id);
  return room;
}
const tx0 = (room, rng = {}) => createTx(room, { rng: fixedRng(rng), now: 0, data });

// ---------- data / hand ----------

test('card data: every card has a colour; drawable pool never holds merit / injury; requirement cards are blue', () => {
  for (const id of CARD_IDS) assert.ok(['blue', 'red'].includes(cardColor(cardDef(data, id))), id);
  const pool = drawableCards(data, { job: null }).map((k) => k.id);
  assert.ok(!pool.includes('merit') && !pool.includes('injury') && !pool.includes('pledge'));
  for (const id of ['marriage_luck', 'popular', 'research', 'health_charm', 'salary_charm', ...ROLL_CARDS]) assert.ok(pool.includes(id), id);
  assert.deepEqual(ROLL_CARDS.map((id) => cardColor(cardDef(data, id))), ['red', 'red', 'red', 'red']);
});

test('hand limit 6: discard the oldest red, then blue non-requirement, then requirement — never the injury card', () => {
  const room = young();
  const c = room.characters[0];
  c.cards = [];
  const tx = tx0(room);
  for (const id of ['research', 'injury', 'merit', 'study', 'charisma', 'energy']) gainCard(tx, c, id, 'shop', { log: false });
  gainCard(tx, c, 'popular', 'tile', { log: false }); // → study goes (oldest red)
  gainCard(tx, c, 'salary_charm', 'tile', { log: false }); // → energy
  gainCard(tx, c, 'tongue', 'tile', { log: false }); // → merit (oldest blue non-requirement)
  assert.deepEqual(c.cards.map((k) => k.id), ['research', 'injury', 'charisma', 'popular', 'salary_charm', 'tongue']);
  const lost = tx.events.filter((e) => e.type === 'cardLost').map((e) => [e.cardId, e.reason]);
  assert.deepEqual(lost, [['study', 'discarded'], ['energy', 'discarded'], ['merit', 'discarded']]);
  assert.equal(discardIndex(data, [{ id: 'injury' }, { id: 'research' }]), 1, 'requirement card last, injury never');
  assert.equal(discardIndex(data, [{ id: 'injury' }]), -1);
});

// ---------- useCard rules ----------

test('useCard: blue / status cards are never played; 딱 그 칸 needs 1–10; 월급날 직행 needs a payday ahead', () => {
  const room = young();
  const me = ch(room, cur(room));
  me.cards = [];
  const research = give(me, 'research');
  const injury = give(me, 'injury');
  const merit = give(me, 'merit');
  const exact = give(me, 'exact_roll');
  const rush = give(me, 'payday_rush');
  const act = (a) => applyAction(room, { characterId: me.id, type: 'useCard', ...a }, { now: 1000 });
  expect(() => act({ cardUid: research }), 409, /보유 효과/);
  expect(() => act({ cardUid: merit }), 409, /보유 효과/);
  expect(() => act({ cardUid: injury }), 409, /부상 카드/);
  expect(() => act({ cardUid: exact }), 400, /1~10/);
  expect(() => act({ cardUid: exact, value: 11 }), 400, /1~10/);
  expect(() => act({ cardUid: exact, value: 2.5 }), 400);
  // 월급날 직행: from the start the payday (index 6) is ahead; past it the fork (a forced stop) comes first
  assert.equal(rushDistance(room, me), 6);
  me.position = { eraIndex: 4, route: 'main', index: 8 };
  assert.equal(rushDistance(room, me), null);
  assert.match(cardBlockReason(room, me, cardDef(data, 'payday_rush'), data), /월급날/);
  expect(() => act({ cardUid: rush }), 409, /월급날/);
  // the final race: no payday left once past the last one
  const fin = room.board.eras.length - 1;
  const last = room.board.eras[fin].tiles.findLastIndex((t) => t.type === 'salary');
  me.position = { eraIndex: fin, route: 'main', index: last };
  assert.equal(rushDistance(room, me), null);
});

test('딱 그 칸: the chosen number, no aim / second roll; bets on that spin are refunded and refused', () => {
  let room = young();
  const me = ch(room, cur(room));
  const other = room.characters.find((c) => c.id !== me.id);
  const uid = give(me, 'exact_roll');
  // a side bet placed before the card: refunded once the card fixes the spin
  room = applyAction(room, { type: 'bet', characterId: other.id, kind: 'oddEven', pick: 'odd', amount: 10 }, { now: 900 }).room;
  assert.equal(ch(room, other.id).money, 990);
  let r = applyAction(room, { type: 'useCard', characterId: me.id, cardUid: uid, value: '5' }, { now: 1000 });
  assert.equal(r.events.find((e) => e.type === 'cardUsed').value, 5);
  assert.equal(ch(r.room, other.id).money, 1000, 'stake back');
  assert.ok(r.events.some((e) => e.type === 'moneyChanged' && e.reason === 'betRefund'));
  expect(() => applyAction(r.room, { type: 'bet', characterId: other.id, kind: 'oddEven', pick: 'odd', amount: 10 }, { now: 1100 }), 409, /카드로 정해져서/);
  ch(r.room, me.id).spinMods.push({ kind: 'max2', card: 'taxi' }); // a taxi second roll is ignored by an exact number
  r = applyAction(r.room, { type: 'spin', characterId: me.id }, { now: 1200 });
  const spun = r.events.find((e) => e.type === 'spun');
  assert.equal(spun.value, 5);
  assert.equal(spun.rolls, undefined);
  assert.deepEqual(spun.mods.map((m) => m.kind), ['exact', 'max2']);
  const moved = r.events.find((e) => e.type === 'moved'); // 5 tiles: the 찬스 광장 on index 3 pauses the walk (2 left)
  assert.deepEqual([moved.steps, moved.halted, moved.remaining], [3, 'pass', 2]);
  assert.deepEqual(ch(r.room, me.id).spinMods, []);
});

test('큰 수 / 작은 수: random rooms draw inside the range; skill rooms clamp the aimed result into it', () => {
  const seen = { big: new Set(), small: new Set() };
  for (let seed = 1; seed <= 24; seed++) {
    for (const [card, key] of [['big_roll', 'big'], ['small_roll', 'small']]) {
      const room = young({ seed });
      const me = ch(room, cur(room));
      const uid = give(me, card);
      room.rngState = seed * 7919;
      let r = applyAction(room, { type: 'useCard', characterId: me.id, cardUid: uid }, { now: 1000 });
      r = applyAction(r.room, { type: 'spin', characterId: me.id }, { now: 1100 });
      const spun = r.events.find((e) => e.type === 'spun');
      seen[key].add(spun.value);
      assert.deepEqual(spun.mods[0], { kind: 'range', min: key === 'big' ? 6 : 1, max: key === 'big' ? 10 : 5, card });
    }
  }
  assert.ok([...seen.big].every((v) => v >= 6 && v <= 10) && seen.big.size >= 4, [...seen.big].join());
  assert.ok([...seen.small].every((v) => v >= 1 && v <= 5) && seen.small.size >= 4, [...seen.small].join());
  // skill mode: aiming at 1 with 큰 수 → at least 6
  for (let seed = 1; seed <= 6; seed++) {
    const room = young({ seed, config: { rouletteMode: 'skill' } });
    const me = ch(room, cur(room));
    const uid = give(me, 'big_roll');
    let r = applyAction(room, { type: 'useCard', characterId: me.id, cardUid: uid }, { now: 1000 });
    r = applyAction(r.room, { type: 'spin', characterId: me.id, target: 1, input: 'gauge' }, { now: 1100 });
    const spun = r.events.find((e) => e.type === 'spun');
    assert.equal(spun.value, 6);
    assert.equal(spun.target, 1);
  }
});

test('월급날 직행: straight to the next payday (찬스 광장 on the way ignored, no halving), paid there', () => {
  const room = young();
  const me = ch(room, cur(room));
  me.military = { status: 'serving', turnsLeft: 3 }; // serving soldiers still go the whole way
  const uid = give(me, 'payday_rush');
  let r = applyAction(room, { type: 'useCard', characterId: me.id, cardUid: uid }, { now: 1000 });
  r = applyAction(r.room, { type: 'spin', characterId: me.id }, { now: 1100 });
  const spun = r.events.find((e) => e.type === 'spun');
  assert.deepEqual([spun.rush, spun.steps, spun.halved], [true, 6, undefined]);
  const moved = r.events.find((e) => e.type === 'moved');
  assert.deepEqual([moved.steps, moved.halted, moved.rush], [6, 'salary', true]);
  assert.ok(!r.events.some((e) => e.type === 'prompt' && e.kind === 'passTile'), 'no 찬스 광장 on the way');
  assert.equal(ch(r.room, me.id).position.index, 6);
  assert.ok(r.events.some((e) => e.type === 'landed' && e.tileType === 'salary'));
});

// ---------- blue cards: held effects ----------

test('requirement cards gate jobs; graduation grants the best stat card (next best when held); adult graduates start with one', () => {
  const room = young();
  const c = room.characters[0];
  const tx = tx0(room);
  Object.assign(c, { stats: { int: 9, str: 2, charm: 2, luck: 2 }, education: 'college', cards: [] });
  assert.ok(!eligibleJobs(tx, c).some((j) => j.id === 'doctor'));
  assert.equal(skillCardFor(data, c), 'research');
  c.school = { tier: 'college', turnsLeft: 0 };
  graduate(tx, c);
  assert.deepEqual(c.cards.map((k) => k.id), ['research']);
  assert.equal(tx.events.find((e) => e.type === 'cardGained').source, 'graduation');
  assert.ok(eligibleJobs(tx, c).some((j) => j.id === 'doctor'));
  assert.equal(skillCardFor(data, c), 'iron_body', 'research held → next best stat (ties by STAT_KEYS order)');
  // hired, the card stays (skills are permanent) but rank-ups never ask for it
  hire(tx, c, 'doctor', 'hire');
  assert.ok(c.cards.some((k) => k.id === 'research'));
  // adult mode: graduates start with their card
  const adult = started({ config: { mode: 'adult' } });
  for (const x of adult.characters) assert.equal(x.cards.some((k) => ['research', 'charisma', 'tongue', 'iron_body'].includes(k.id)), x.education !== 'none', x.name);
});

test('injury card mirrors job.injured: added on injury, healed by the countdown / a job change; 건강기원 부적 blocks injuries', () => {
  const room = young();
  const c = room.characters[0];
  const tx = tx0(room, { nexts: [0, 0, 0] });
  c.job = { id: 'soccer', rank: 1, exp: 0, injured: 0 };
  c.cards = [];
  assert.equal(rollInjury(tx, c), true);
  assert.deepEqual(c.cards.map((k) => k.id), ['injury']);
  assert.equal(tx.events.find((e) => e.type === 'cardGained').source, 'status');
  const turns = c.job.injured;
  for (let i = 0; i < turns; i++) spinSteps(tx, c, 5);
  assert.equal(c.job.injured, 0);
  assert.deepEqual(c.cards, []);
  assert.deepEqual(tx.events.filter((e) => e.type === 'cardLost').map((e) => e.reason), ['healed']);
  // a job change clears an injury too
  c.job.injured = 2;
  syncInjuryCard(tx, c);
  hire(tx, c, 'police', 'change');
  assert.deepEqual(c.cards, []);
  // 건강기원 부적: the roll hits, nothing happens, the charm stays
  c.job = { id: 'soccer', rank: 1, exp: 0, injured: 0 };
  give(c, 'health_charm');
  const tx2 = tx0(room, { nexts: [0] });
  assert.equal(rollInjury(tx2, c), false);
  assert.equal(c.job.injured, 0);
  assert.deepEqual(c.cards.map((k) => k.id), ['health_charm']);
  // the injury card cannot be gifted / traded
  let r2 = young();
  const a = ch(r2, cur(r2));
  const b = r2.characters.find((x) => x.id !== a.id);
  const inj = give(a, 'injury');
  a.job.injured = 2;
  expect(() => applyAction(r2, { type: 'gift', characterId: a.id, toId: b.id, cardUid: inj }, { now: 1 }), 409, /부상 카드/);
  expect(() => applyAction(r2, { type: 'offerTrade', characterId: a.id, toId: b.id, give: { cardUid: inj }, want: { money: 5 } }, { now: 1 }), 409, /부상 카드/);
  // blue held cards CAN be gifted
  const pop = give(a, 'popular');
  r2 = applyAction(r2, { type: 'gift', characterId: a.id, toId: b.id, cardUid: pop }, { now: 2 }).room;
  assert.ok(ch(r2, b.id).cards.some((k) => k.id === 'popular'));
});

test('월급 부적 +10 % salary while held; 결혼운◎ / 인기 폭발◎ romance bonuses, both gone on marriage', () => {
  const room = young();
  const c = room.characters[0];
  const tx = tx0(room);
  c.cards = [];
  const base = salaryAmount(tx, c);
  give(c, 'salary_charm');
  assert.equal(salaryAmount(tx, c), Math.round((base * 1.1) / 5) * 5);
  // 결혼운◎: every affection gain +5
  c.love = { candidates: [], partner: { id: 'pt9', name: '연인', trait: 'luck', stars: 2, body: 'girl', avatar: {} }, affection: 30, dates: 0 };
  gainAffection(tx, c, 10);
  assert.equal(c.love.affection, 40);
  give(c, 'marriage_luck');
  gainAffection(tx, c, 10);
  assert.equal(c.love.affection, 55);
  // 인기 폭발◎: +2 on dates (and 결혼운◎ +5) shown in the option's gain; one 찰떡궁합 candidate
  give(c, 'popular');
  const date = openPrompt(tx, 'date', c);
  const walk = date.options.find((o) => o.dateId === 'walk');
  assert.equal(walk.gain, data.partners.dates.find((d) => d.id === 'walk').gain + 5 + 2);
  c.love.partner = null;
  c.stats = { int: 9, str: 1, charm: 1, luck: 1 };
  room.turn.pending = null;
  const meet = openPrompt(tx0(room, { nexts: [0.9, 0.9] }), 'meet', c);
  assert.ok(meet.options.some((o) => o.match), 'a 찰떡궁합 candidate is guaranteed');
  // a wedding drops both held romance cards
  room.turn.pending = null;
  c.love = { candidates: [], partner: { id: 'pt9', name: '연인', trait: 'int', stars: 2, body: 'girl', avatar: {} }, affection: 90, dates: 3 };
  const tx3 = tx0(room, { nexts: [0] });
  const p = openPrompt(tx3, 'propose', c);
  const r = applyAction(room, { type: 'choose', characterId: c.id, promptId: p.promptId, optionId: 'propose' }, { rng: fixedRng({ nexts: [0] }), now: 1 });
  const lost = r.events.filter((e) => e.type === 'cardLost').map((e) => [e.cardId, e.reason]);
  assert.deepEqual(lost.sort(), [['marriage_luck', 'married'], ['popular', 'married']]);
  assert.deepEqual(ch(r.room, c.id).cards.map((k) => k.id), ['salary_charm']);
});

test('공적 카드: merit jobs need them for the review (job tile option disabled without), earn them on the job', () => {
  const room = young();
  const c = room.characters[0];
  Object.assign(c, { job: { id: 'doctor', rank: 1, exp: 0, injured: 0 }, education: 'college', cards: [] });
  const tx = tx0(room);
  const p = openPrompt(tx, 'jobTile', c);
  const promo = p.options.find((o) => o.id === 'promotion');
  assert.deepEqual([promo.disabled, promo.merit, promo.merits], [true, 1, 0]);
  assert.notEqual(p.defaultOptionId, 'promotion');
  expect(() => applyAction(room, { type: 'choose', characterId: c.id, promptId: p.promptId, optionId: 'promotion' }, { now: 1 }), 409, /고를 수 없는/);
  // overtime at a merit job: a merit card on a successful roll
  const r = applyAction(room, { type: 'choose', characterId: c.id, promptId: p.promptId, optionId: 'overtime' }, { rng: fixedRng({ nexts: [0] }), now: 1 });
  assert.deepEqual(ch(r.room, c.id).cards.map((k) => k.id), ['merit']);
  assert.equal(r.events.find((e) => e.type === 'cardGained').source, 'job');
  // a passed promotion exam consumes the merit and earns one for the next rank
  const tx2 = tx0(room, { nexts: [0] });
  c.cards = [{ uid: 'kOld', id: 'merit' }];
  assert.equal(tryRankUp(tx2, c, { exam: true }), 'up');
  assert.deepEqual(c.cards.map((k) => k.id), ['merit']);
  assert.notEqual(c.cards[0].uid, 'kOld');
  // a non-merit job never earns merits on the job
  Object.assign(c, { job: { id: 'civil_servant', rank: 1, exp: 99, injured: 0 }, cards: [] });
  paySalary(tx0(room, { nexts: [0, 0, 0] }), c);
  assert.deepEqual(c.cards, []);
});

// ---------- CPU ----------

test('CPU: values blue cards for its plans, never plays them, plays 딱 그 칸 / 월급날 직행 when they pay', () => {
  const room = young();
  const me = ch(room, cur(room));
  me.cards = [];
  // requirement card worth: high for a jobless high-int graduate aiming at doctor / researcher, low once employed
  const grad = { ...me, job: null, careerDone: false, education: 'college', stats: { int: 9, str: 2, charm: 2, luck: 2 }, cards: [] };
  assert.ok(cardValue(data, grad, 'research', room) >= 100, 'wanted requirement card');
  assert.ok(cardValue(data, me, 'research', room) < 60, 'employed: a job change only');
  assert.equal(cardValue(data, me, 'injury', room), 0);
  assert.ok(cardValue(data, { ...me, spouse: null }, 'marriage_luck', room) > cardValue(data, { ...me, spouse: { id: 'x' } }, 'marriage_luck', room));
  // blue cards only → nothing to play
  give(me, 'research', 'popular', 'merit', 'salary_charm');
  assert.equal(cpuCardAction(room, me.id, data), null);
  // a treasure 4 tiles ahead, losses everywhere else → 딱 그 칸 4
  const main = room.board.eras[4].tiles;
  for (let i = 1; i <= 10; i++) if (i !== 6 && i !== 3) main[i] = { ...main[i], type: 'loss', amount: 80 };
  main[4] = { ...main[4], type: 'treasure' };
  const exact = give(me, 'exact_roll');
  const a = cpuCardAction(room, me.id, data);
  assert.deepEqual([a?.cardUid, a?.value], [exact, 4]);
  const r = applyAction(room, a, { now: 1 });
  assert.ok(r.events.some((e) => e.type === 'cardUsed' && e.value === 4));
  // with only 월급날 직행 (payday 6 ahead) the CPU rushes
  me.cards = me.cards.filter((k) => k.id !== 'exact_roll');
  const rush = give(me, 'payday_rush');
  assert.equal(cpuCardAction(room, me.id, data)?.cardUid, rush);
  // trades: a wanted requirement card is worth more than its price
  const other = room.characters.find((x) => x.id !== me.id);
  Object.assign(other, { job: null, careerDone: false, education: 'college', stats: { int: 9, str: 2, charm: 2, luck: 2 }, cards: [] });
  const offer = { id: 't1', fromId: me.id, toId: other.id, give: { cardUid: 'kx', cardId: 'research' }, want: { money: 90 } };
  other.money = 500;
  assert.equal(cpuTradeAccept(room, offer, data), true);
});

test('old saves: an ongoing injury gets its injury card on the next action', () => {
  const room = young();
  const me = ch(room, cur(room));
  const other = room.characters.find((x) => x.id !== me.id);
  other.job = { id: 'soccer', rank: 1, exp: 0, injured: 2 };
  other.cards = [];
  const r = applyAction(room, { type: 'spin', characterId: me.id }, { now: 1 });
  assert.ok(ch(r.room, other.id).cards.some((k) => k.id === 'injury'));
});
