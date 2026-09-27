// Stage 7 — cards, spin modifiers, passive cards, shop, items and the final ranking (pure engine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gameData } from '../server/data/index.js';
import { applyAction, startGame } from '../server/game/engine.js';
import { createTx } from '../server/game/effects.js';
import {
  CARD_COLORS,
  CARD_IDS,
  REQUIREMENT_CARDS,
  ITEM_IDS,
  applyLoss,
  drawableCards,
  gainCard,
  guardStats,
  itemsValue,
  shopPrice,
} from '../server/game/cards.js';
import { paySalary, rollInjury, salaryAmount } from '../server/game/jobs.js';
import { openPrompt } from '../server/game/prompts.js';
import { resolveTile } from '../server/game/spaces.js';
import { computeRanking } from '../server/game/result.js';
import { addCharacter, joinRoom } from '../server/game/lobby.js';
import { makeRoom } from './helpers.js';

const data = gameData();

function started({ chars = [['A', 'A1'], ['B', 'B1'], ['A', 'A2']], seed = 7, config = {} } = {}) {
  let room = makeRoom({ seed });
  room.config = { ...room.config, ...config };
  room = joinRoom(room, 'A', '에이', 0).room;
  room = joinRoom(room, 'B', '비', 0).room;
  for (const [owner, name] of chars) room = addCharacter(room, owner, { name }, 0).room;
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
const act = (room, action, rng = {}, now = 1000) => applyAction(room, action, { rng: fixedRng(rng), now });
let uidSeq = 900;
const give = (c, ...ids) => {
  for (const id of ids) c.cards.push({ uid: `k${++uidSeq}`, id });
  return c.cards.at(-1).uid;
};
/** A started room where the current character sits in 청년 (young) on a plain money tile ahead. */
function youngRoom() {
  const room = structuredClone(started());
  for (const c of room.characters) Object.assign(c, { era: 'young', position: { eraIndex: 4, route: 'career', index: 0 }, route: 'career', careerDone: true, military: { status: 'done', turnsLeft: 0 }, job: { id: 'office_worker', rank: 1, exp: 0, injured: 0 } });
  room.erasOpened = room.board.eras.map((e) => e.id); // no era openings in these tests
  const track = room.board.eras[4].routes.career.tiles;
  for (let i = 1; i < track.length; i++) Object.assign(track[i], { type: 'money', amount: 10, label: '용돈' });
  return room;
}
const expect = (fn, status, re) =>
  assert.throws(fn, (e) => e.status === status && (!re || re.test(e.message)), `expected ${status}${re ? ` ${re}` : ''}`);

// ---------- data ----------

test('data: cards.json / items.json / holidays.json schemas, fixed ids, manifest art items', () => {
  const cards = data.cards.cards;
  assert.equal(data.cards.handLimit, 6);
  assert.deepEqual(cards.map((k) => k.id), CARD_IDS);
  const kinds = {
    instant: ['study', 'insider', 'energy', 'taxi', 'pledge', 'big_roll', 'small_roll', 'exact_roll', 'payday_rush'],
    passive: ['bonus', 'insurance', 'amulet', 'lotto', 'coupon', 'lawyer'],
    sabotage: ['cut_line', 'noise', 'tax_audit', 'complaint', 'gossip'],
    held: ['marriage_luck', 'popular', 'research', 'charisma', 'tongue', 'iron_body', 'health_charm', 'salary_charm'],
    merit: ['merit'],
    status: ['injury'],
  };
  for (const [kind, ids] of Object.entries(kinds)) assert.deepEqual(cards.filter((k) => k.kind === kind).map((k) => k.id), ids, kind);
  for (const k of cards) {
    assert.ok(k.name && k.icon && k.desc && k.effect, k.id);
    assert.ok(CARD_COLORS.includes(k.color), `${k.id}: color`);
    assert.equal(k.color, ['held', 'merit', 'status'].includes(k.kind) ? 'blue' : 'red', `${k.id}: colour by kind`);
    if (k.kind === 'status') assert.ok(k.price === 0 && k.weight === 0, k.id);
    else if (k.kind === 'merit') assert.ok(k.price > 0 && k.weight === 0, k.id);
    else assert.ok(Number.isInteger(k.price) && k.price > 0 && k.weight > 0, k.id);
  }
  for (const id of REQUIREMENT_CARDS) assert.equal(cards.find((k) => k.id === id).effect.requirement, true, id);
  for (const id of ['marriage_luck', 'popular']) assert.equal(cards.find((k) => k.id === id).hold?.until, 'married', id);
  assert.equal(cards.find((k) => k.id === 'pledge').jobOnly, 'politician');
  assert.deepEqual(data.items.items.map((i) => i.id), ITEM_IDS);
  for (const i of data.items.items) assert.ok(i.name && i.icon && i.desc && i.price > 0 && i.resale > 0 && i.resale < 1, i.id);
  assert.deepEqual(data.holidays.eras, ['middle', 'middle_age']); // post-simulation: 2 holidays per lifetime game
  const m = JSON.parse(readFileSync(new URL('../server/assets/manifest.json', import.meta.url), 'utf8'));
  const byId = new Map(m.items.map((i) => [i.id, i]));
  for (const id of CARD_IDS) assert.equal(byId.get(`card-${id.replaceAll('_', '-')}`)?.meta.card, id);
  for (const id of ITEM_IDS) assert.equal(byId.get(`item-${id.replaceAll('_', '-')}`)?.meta.item, id);
  for (const j of data.jobs.jobs) assert.equal(byId.get(`icon-job-${j.id.replaceAll('_', '-')}`)?.meta.job, j.id);
  // board: card / shop tiles are live (no placeholder text any more)
  assert.ok(!('card' in data.board.placeholders) && !('shop' in data.board.placeholders));
  // loop maps: shop tiles are folded into the 찬스 광장 (「구입」 → the shop prompt); no pool draws them any more
  const pools = [...Object.values(data.board.eras).map((e) => e.pool), ...Object.values(data.board.routePools).map((r) => r.pool), data.board.finalTrack.pool];
  assert.ok(pools.every((p) => !p.some((t) => t.type === 'shop')));
  assert.equal(data.board.tileTypes.pass.name, '찬스 광장');
});

// ---------- useCard validation ----------

test('useCard: turn / phase / one per turn / passive / job-only / target rules (Korean errors)', () => {
  const room = youngRoom();
  const me = ch(room, cur(room));
  const other = room.characters.find((c) => c.id !== me.id && c.ownerSessionId !== me.ownerSessionId);
  const study = give(me, 'study');
  const lawyer = give(me, 'lawyer');
  const pledge = give(me, 'pledge');
  const gossip = give(me, 'gossip');
  const oCard = give(other, 'study');
  expect(() => act(room, { type: 'useCard', characterId: other.id, cardUid: oCard }), 409, /내 차례/);
  expect(() => act(room, { type: 'useCard', characterId: me.id, cardUid: study, actor: { sessionId: other.ownerSessionId } }), 403);
  expect(() => act(room, { type: 'useCard', characterId: me.id, cardUid: 'k0' }), 404, /손패/);
  expect(() => act(room, { type: 'useCard', characterId: me.id, cardUid: lawyer }), 409, /자동/);
  expect(() => act(room, { type: 'useCard', characterId: me.id, cardUid: pledge }), 409, /국회의원 전용/);
  expect(() => act(room, { type: 'useCard', characterId: me.id, cardUid: gossip }), 400, /대상/);
  expect(() => act(room, { type: 'useCard', characterId: me.id, cardUid: gossip, targetId: me.id }), 400, /자기 자신/);
  const fin = structuredClone(room);
  ch(fin, other.id).finished = true;
  expect(() => act(fin, { type: 'useCard', characterId: me.id, cardUid: gossip, targetId: other.id }), 409, /골인/);
  const pend = structuredClone(room);
  pend.turn.pending = { promptId: 'px', forCharacterIds: [me.id], answers: {}, options: [] };
  expect(() => act(pend, { type: 'useCard', characterId: me.id, cardUid: study }), 409, /룰렛을 돌리기 전/);
  // one card per turn
  const r1 = act(room, { type: 'useCard', characterId: me.id, cardUid: study });
  assert.equal(r1.room.turn.cardUsed, true);
  assert.equal(r1.room.turn.phase, 'awaitSpin');
  expect(() => act(r1.room, { type: 'useCard', characterId: me.id, cardUid: gossip, targetId: other.id }), 409, /한 장/);
  // same target two rounds in a row → refused; a round later it is fine again
  const r2 = act(room, { type: 'useCard', characterId: me.id, cardUid: gossip, targetId: other.id });
  assert.equal(ch(r2.room, other.id).lastTargetedBy[me.id], room.turn.round);
  const next = structuredClone(r2.room);
  next.turn.cardUsed = false;
  next.turn.round += 1;
  give(ch(next, me.id), 'noise');
  const noise = ch(next, me.id).cards.at(-1).uid;
  expect(() => act(next, { type: 'useCard', characterId: me.id, cardUid: noise, targetId: other.id }), 409, /연달아/);
  next.turn.round += 1;
  assert.ok(act(next, { type: 'useCard', characterId: me.id, cardUid: noise, targetId: other.id }).events.some((e) => e.type === 'cardUsed'));
});

// ---------- instant / sabotage effects + spin modifiers ----------

test('instant cards: study / insider stats; energy +2; taxi keeps the higher of two rolls; mods cleared', () => {
  const room = youngRoom();
  const me = ch(room, cur(room));
  me.stats = { int: 3, str: 3, charm: 3, luck: 3 };
  const s = act(room, { type: 'useCard', characterId: me.id, cardUid: give(me, 'study') });
  assert.equal(ch(s.room, me.id).stats.int, 4);
  const used = s.events.find((e) => e.type === 'cardUsed');
  assert.deepEqual([used.cardId, used.cardKind, used.cutin], ['study', 'instant', false]);
  assert.ok(s.events.some((e) => e.type === 'statChanged' && e.stat === 'int' && e.reason === 'card'));
  const room2 = youngRoom();
  const me2 = ch(room2, cur(room2));
  assert.equal(act(room2, { type: 'useCard', characterId: me2.id, cardUid: give(me2, 'insider') }).room.characters.find((c) => c.id === me2.id).stats.charm, me2.stats.charm + 1);
  // energy: roll 4 → move 6
  const e1 = act(room2, { type: 'useCard', characterId: me2.id, cardUid: give(me2, 'energy') });
  assert.deepEqual(ch(e1.room, me2.id).spinMods, [{ kind: 'plus', value: 2, card: 'energy' }]);
  const e2 = act(e1.room, { type: 'spin', characterId: me2.id }, { ints: [4] });
  const spun = e2.events.find((e) => e.type === 'spun');
  assert.deepEqual([spun.value, spun.steps, e2.events.find((e) => e.type === 'moved').path.length], [4, 6, 6]);
  assert.deepEqual(spun.mods, [{ kind: 'plus', value: 2, card: 'energy' }]);
  assert.deepEqual(ch(e2.room, me2.id).spinMods, []);
  // taxi: rolls 3 and 8 → 8
  const room3 = youngRoom();
  const me3 = ch(room3, cur(room3));
  const t1 = act(room3, { type: 'useCard', characterId: me3.id, cardUid: give(me3, 'taxi') });
  const t2 = act(t1.room, { type: 'spin', characterId: me3.id }, { ints: [3, 8] });
  const sp = t2.events.find((e) => e.type === 'spun');
  assert.deepEqual([sp.value, sp.rolls], [8, [3, 8]]);
  assert.equal(t2.room.turn.lastSpin.value, 8);
});

test('sabotage: cut_line (−3, min 1, 경차 1 → 2) / noise (lower of two) hit the target’s next spin; lawyer blocks', () => {
  const room = youngRoom();
  const me = ch(room, cur(room));
  const order = room.turn.order;
  const target = ch(room, order[(room.turn.currentIndex + 1) % order.length]);
  // cut_line → target's next spin 5 → 2
  let r = act(room, { type: 'useCard', characterId: me.id, cardUid: give(me, 'cut_line'), targetId: target.id });
  const used = r.events.find((e) => e.type === 'cardUsed');
  assert.deepEqual([used.cardKind, used.targetId, used.cutin, used.tone, used.lineTag], ['sabotage', target.id, true, 'bad', 'sabotage']);
  assert.ok(used.targetLine && !/\{\w+\}/.test(used.targetLine), 'victim reaction line');
  assert.deepEqual(ch(r.room, target.id).spinMods, [{ kind: 'minus', value: 3, by: me.id, card: 'cut_line' }]);
  r = act(r.room, { type: 'spin', characterId: me.id }, { ints: [2] });
  assert.equal(cur(r.room), target.id);
  const t = act(r.room, { type: 'spin', characterId: target.id }, { ints: [5] });
  const sp = t.events.find((e) => e.type === 'spun');
  assert.deepEqual([sp.value, sp.steps], [5, 2]);
  // min 1, and a car turns 1 into 2
  const low = structuredClone(r.room);
  assert.equal(act(low, { type: 'spin', characterId: target.id }, { ints: [2] }).events.find((e) => e.type === 'spun').steps, 1);
  ch(low, target.id).items = ['car'];
  const car = act(low, { type: 'spin', characterId: target.id }, { ints: [2] }).events.find((e) => e.type === 'spun');
  assert.deepEqual([car.steps ?? car.value, car.car], [2, true]); // steps omitted when equal to the value
  // noise → rolls 9 and 2 → 2
  const room2 = youngRoom();
  const me2 = ch(room2, cur(room2));
  const tg2 = room2.characters.find((c) => c.id !== me2.id);
  const n = act(room2, { type: 'useCard', characterId: me2.id, cardUid: give(me2, 'noise'), targetId: tg2.id });
  const n2 = structuredClone(n.room);
  n2.turn.currentIndex = n2.turn.order.indexOf(tg2.id);
  const ns = act(n2, { type: 'spin', characterId: tg2.id }, { ints: [9, 2] }).events.find((e) => e.type === 'spun');
  assert.deepEqual([ns.value, ns.rolls], [2, [9, 2]]);
  // lawyer: both cards consumed, cardBlocked, nothing happens to the target
  const room3 = youngRoom();
  const me3 = ch(room3, cur(room3));
  const tg3 = room3.characters.find((c) => c.id !== me3.id);
  give(tg3, 'lawyer');
  const b = act(room3, { type: 'useCard', characterId: me3.id, cardUid: give(me3, 'gossip'), targetId: tg3.id });
  const blocked = b.events.find((e) => e.type === 'cardBlocked');
  assert.deepEqual([blocked.charId, blocked.targetId, blocked.cardId, blocked.cutin], [me3.id, tg3.id, 'gossip', true]);
  assert.ok(!b.events.some((e) => e.type === 'cardUsed' || e.type === 'statChanged'));
  assert.deepEqual(ch(b.room, tg3.id).cards, []);
  assert.deepEqual(ch(b.room, me3.id).cards, []);
  assert.equal(ch(b.room, tg3.id).stats.charm, tg3.stats.charm);
});

test('sabotage money / stat effects: tax_audit 10 % (cap), complaint exp −2 or fine, gossip charm −1; pledge donations', () => {
  const run = (cardId, patch) => {
    const room = youngRoom();
    const me = ch(room, cur(room));
    const tg = room.characters.find((c) => c.id !== me.id);
    Object.assign(tg, patch);
    const r = act(room, { type: 'useCard', characterId: me.id, cardUid: give(me, cardId), targetId: tg.id });
    return { r, me: ch(r.room, me.id), tg: ch(r.room, tg.id), before: tg };
  };
  assert.equal(run('tax_audit', { money: 1000 }).tg.money, 900);
  assert.equal(run('tax_audit', { money: 5000 }).tg.money, 4700, 'capped at 300');
  const ins = run('tax_audit', { money: 1000, cards: [{ uid: 'k1', id: 'insurance' }] });
  assert.equal(ins.tg.money, 950, '실손 보험 halves it');
  assert.ok(ins.r.events.some((e) => e.type === 'cardUsed' && e.cardId === 'insurance' && e.auto));
  assert.equal(run('complaint', { job: { id: 'teacher', rank: 1, exp: 3, injured: 0 } }).tg.job.exp, 1);
  const fine = run('complaint', { job: null, money: 500 });
  assert.equal(fine.tg.money, 500 - 30 * data.cards.eraScale.young);
  const g = run('gossip', { stats: { int: 2, str: 2, charm: 4, luck: 2 } });
  assert.equal(g.tg.stats.charm, 3);
  assert.ok(g.r.events.some((e) => e.type === 'statChanged' && e.reason === 'sabotage'));
  // pledge (국회의원): every other unfinished character pays, never into debt
  const room = youngRoom();
  const me = ch(room, cur(room));
  me.job = { id: 'politician', rank: 1, exp: 0, injured: 0 };
  const others = room.characters.filter((c) => c.id !== me.id);
  others[0].money = 20;
  const p = act(room, { type: 'useCard', characterId: me.id, cardUid: give(me, 'pledge') });
  const amount = 30 * data.cards.eraScale.young;
  assert.equal(ch(p.room, others[0].id).money, 0);
  assert.equal(ch(p.room, others[1].id).money, others[1].money - amount);
  assert.equal(ch(p.room, me.id).money, me.money + 20 + amount);
  assert.equal(p.events.find((e) => e.type === 'cardUsed').cutin, true);
  assert.ok(drawableCards(data, me).some((k) => k.id === 'pledge'));
  assert.ok(!drawableCards(data, others[0]).some((k) => k.id === 'pledge'), 'job-only cards are only drawn by that job');
});

// ---------- passive cards ----------

test('passive cards: insurance halves a loss tile, amulet cancels an injury / bad event, bonus doubles a salary', () => {
  const room = youngRoom();
  const c = room.characters[0];
  c.money = 1000;
  give(c, 'insurance');
  const tx = createTx(room, { rng: fixedRng(), now: 0, data });
  resolveTile(tx, c, { id: 'x', type: 'loss', amount: 100, label: '월세' });
  assert.equal(c.money, 950);
  assert.equal(c.cards.length, 0);
  assert.deepEqual(applyLoss(tx, c, 100, 'tile'), { amount: 100, debt: 0 }, 'only once');
  // amulet vs injury
  c.job = { id: 'soccer', rank: 1, exp: 0, injured: 0 };
  give(c, 'amulet');
  const tx2 = createTx(room, { rng: fixedRng({ nexts: [0] }), now: 0, data });
  assert.equal(rollInjury(tx2, c), false);
  assert.equal(c.job.injured, 0);
  assert.ok(tx2.events.some((e) => e.type === 'cardUsed' && e.cardId === 'amulet' && e.cancelled === 'injury'));
  // amulet vs a bad event tile (events pool: weighted → first matching entry for this era)
  give(c, 'amulet');
  const badEvents = { ...data, events: { events: [{ id: 'rent_up', text: '{name} 월세 폭탄', money: { min: -100, max: -100 }, tone: 'bad' }] } };
  const tx3 = createTx(room, { rng: fixedRng({ ints: [-100] }), now: 0, data: badEvents });
  const before = c.money;
  resolveTile(tx3, c, { id: 'y', type: 'event', label: '이벤트' });
  assert.equal(c.money, before);
  assert.ok(!tx3.events.some((e) => e.type === 'moneyChanged'));
  // bonus: next salary ×2 (consumed)
  c.job = { id: 'teacher', rank: 1, exp: 0, injured: 0 };
  give(c, 'bonus');
  const tx4 = createTx(room, { rng: fixedRng({ nexts: [0.99, 0.99] }), now: 0, data });
  const base = salaryAmount(tx4, c);
  assert.equal(paySalary(tx4, c), base * 2);
  assert.equal(paySalary(tx4, c), base);
});

test('hand limit 6: the oldest red card is discarded; card tile draws one (source tile); event card rewards', () => {
  const room = youngRoom();
  const c = room.characters[0];
  const tx = createTx(room, { rng: fixedRng(), now: 0, data });
  for (const id of ['study', 'insider', 'energy', 'taxi', 'lotto', 'coupon']) gainCard(tx, c, id, 'shop');
  gainCard(tx, c, 'gossip', 'tile');
  assert.deepEqual(c.cards.map((k) => k.id), ['insider', 'energy', 'taxi', 'lotto', 'coupon', 'gossip']);
  const last = tx.events.filter((e) => e.type === 'cardGained').at(-1);
  assert.deepEqual([last.cardId, last.source, last.discarded, last.color], ['gossip', 'tile', 'study', 'red']);
  const lost = tx.events.find((e) => e.type === 'cardLost');
  assert.deepEqual([lost.cardId, lost.reason], ['study', 'discarded']);
  assert.equal(new Set(c.cards.map((k) => k.uid)).size, 6, 'uids are unique');
  const d = room.characters[1];
  d.cards = [];
  resolveTile(tx, d, { id: 'z', type: 'card', label: '카드' });
  assert.equal(d.cards.length, 1);
  assert.equal(tx.events.at(-2).type, 'cardGained');
  const withCard = data.events.events.filter((e) => e.card);
  assert.ok(withCard.length >= 5 && withCard.every((e) => CARD_IDS.includes(e.card)));
});

// ---------- shop + items ----------

test('shop: 2 cards + 1 item, buy / leave / coupon / not enough cash / one item of each; item stats + resale', () => {
  const room = youngRoom();
  const c = ch(room, cur(room));
  c.money = 5000;
  c.stats = { int: 3, str: 3, charm: 3, luck: 3 };
  const tx = createTx(room, { rng: fixedRng(), now: 0, data });
  const p = openPrompt(tx, 'shop', c);
  assert.deepEqual(p.options.map((o) => o.id), ['buy:0', 'buy:1', 'buy:2', 'leave']);
  assert.deepEqual(p.context.offers.map((o) => o.kind), ['card', 'card', 'item']);
  assert.equal(p.defaultOptionId, 'leave');
  // weighted() → first entries: study + insider, item car
  assert.deepEqual(p.options.slice(0, 3).map((o) => o.cardId ?? o.itemId), ['study', 'insider', 'car']);
  // buy the item
  let r = act(room, { type: 'choose', characterId: c.id, promptId: p.promptId, optionId: 'buy:2' });
  const bought = r.events.find((e) => e.type === 'itemBought');
  assert.deepEqual([bought.itemId, bought.price, bought.cutin], ['car', 300, true]);
  assert.ok(!r.events.some((e) => e.type === 'promptResolved'), 'itemBought is the anchor');
  assert.deepEqual(ch(r.room, c.id).items, ['car']);
  assert.equal(ch(r.room, c.id).money, 4700);
  // next visit: the owned car is not offered again
  const room2 = structuredClone(r.room);
  room2.turn.phase = 'awaitSpin';
  const tx2 = createTx(room2, { rng: fixedRng(), now: 0, data });
  const p2 = openPrompt(tx2, 'shop', ch(room2, c.id));
  assert.equal(p2.options[2].itemId, 'laptop');
  // laptop: int +1
  const r2 = act(room2, { type: 'choose', characterId: c.id, promptId: p2.promptId, optionId: 'buy:2' });
  assert.equal(ch(r2.room, c.id).stats.int, 4);
  // buy a card → cardGained (shop) + promptResolved {result: 'card'}
  const room3 = structuredClone(room2);
  const r3 = act(room3, { type: 'choose', characterId: c.id, promptId: p2.promptId, optionId: 'buy:0' });
  assert.deepEqual(r3.events.find((e) => e.type === 'cardGained').source, 'shop');
  assert.deepEqual([r3.events.find((e) => e.type === 'promptResolved').result, r3.events.find((e) => e.type === 'promptResolved').cardId], ['card', 'study']);
  // leave
  const r4 = act(room3, { type: 'choose', characterId: c.id, promptId: p2.promptId, optionId: 'leave' });
  assert.equal(r4.events.find((e) => e.type === 'promptResolved').result, 'left');
  // coupon → half price, consumed on purchase
  const room5 = youngRoom();
  const c5 = ch(room5, cur(room5));
  c5.money = 1000;
  give(c5, 'coupon');
  assert.equal(shopPrice(createTx(room5, { rng: fixedRng(), now: 0, data }), c5, 300), 150);
  const tx5 = createTx(room5, { rng: fixedRng(), now: 0, data });
  const p5 = openPrompt(tx5, 'shop', c5);
  assert.deepEqual([p5.options[2].price, p5.options[2].basePrice], [150, 300]);
  const r5 = act(room5, { type: 'choose', characterId: c5.id, promptId: p5.promptId, optionId: 'buy:2' });
  assert.equal(ch(r5.room, c5.id).money, 850);
  assert.ok(!ch(r5.room, c5.id).cards.some((k) => k.id === 'coupon'));
  // not enough cash → disabled option, choosing it is refused
  const room6 = youngRoom();
  const c6 = ch(room6, cur(room6));
  c6.money = 35;
  const p6 = openPrompt(createTx(room6, { rng: fixedRng(), now: 0, data }), 'shop', c6);
  assert.equal(p6.options[2].disabled, true);
  assert.match(p6.options[2].desc, /돈이 부족/);
  assert.ok(p6.options.slice(0, 3).every((o) => o.disabled) && !p6.options[3].disabled);
  expect(() => act(room6, { type: 'choose', characterId: c6.id, promptId: p6.promptId, optionId: 'buy:0' }), 409, /고를 수 없는/);
});

test('items: resale value in the ranking (items field), laptop salary bonus, massage chair guards senior str loss', () => {
  const room = youngRoom();
  const [a, b] = room.characters;
  Object.assign(a, { money: 1000, debt: 0, items: ['designer_bag', 'car'] });
  Object.assign(b, { money: 1500, debt: 0, items: [] });
  assert.equal(itemsValue(data, a), 400 * 0.9 + 300 * 0.5);
  const ranking = computeRanking(room);
  const ra = ranking.find((r) => r.charId === a.id);
  assert.deepEqual([ra.items, ra.total], [510, 1510]);
  assert.equal(ranking[0].charId, a.id, '1510 > 1500');
  // laptop +10 % salary for youtubers only
  a.job = { id: 'youtuber', rank: 1, exp: 0, injured: 0 };
  const tx = createTx(room, { rng: fixedRng(), now: 0, data });
  const base = salaryAmount(tx, a);
  a.items.push('laptop');
  assert.equal(salaryAmount(tx, a), Math.round((base * 1.1) / 5) * 5);
  a.job.id = 'teacher';
  const t = salaryAmount(tx, a);
  a.items = a.items.filter((x) => x !== 'laptop');
  assert.equal(salaryAmount(tx, a), t);
  // massage chair
  a.era = 'senior';
  assert.deepEqual(guardStats(data, a, { str: -1, luck: 1 }), { str: -1, luck: 1 });
  a.items.push('massage_chair');
  assert.deepEqual(guardStats(data, a, { str: -1, luck: 1 }), { luck: 1 });
  a.era = 'young';
  assert.deepEqual(guardStats(data, a, { str: -1 }), { str: -1 });
});
