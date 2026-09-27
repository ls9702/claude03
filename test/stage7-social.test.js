// Stage 7 — trades, gifts, 명절 대잔치, 전국 로또, presentation / MC of the new events, runner expiry, restore, HTTP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameData } from '../server/data/index.js';
import { applyAction, startGame } from '../server/game/engine.js';
import { createTx } from '../server/game/effects.js';
import { holidayEra, lottoDraw, lottoExpectedValue, lottoNumbers, openHoliday } from '../server/game/holidays.js';
import { createRng } from '../server/game/rng.js';
import { CUTIN_TYPES, EVENT_TYPES, attachMc, decorateEvents } from '../server/game/presentation.js';
import { validateRoomConfig } from '../server/game/config.js';
import { addCharacter, joinRoom } from '../server/game/lobby.js';
import { viewFor } from '../server/game/view.js';
import { GameRunner } from '../server/store/gameRunner.js';
import { startServer } from '../server/index.js';
import { randomCardAction } from '../scripts/simulate.js';
import { httpCall, makeRoom, tempDir } from './helpers.js';

const data = gameData();
const lines = data.lines;

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
const expect = (fn, status, re) => assert.throws(fn, (e) => e.status === status && (!re || re.test(e.message)), `expected ${status}${re ? ` ${re}` : ''}`);
/** c1 (A1, owner A) · c2 (B1, owner B) · c3 (A2, owner A); order c1 → c3 → c2; everyone holds a card. */
function social() {
  const room = structuredClone(started());
  room.characters.forEach((c, i) => {
    c.money = 500;
    c.cards = [{ uid: `k${80 + i}`, id: ['taxi', 'lotto', 'gossip'][i] }];
  });
  return room;
}

// ---------- trades ----------

test('trades: offer validation, one open offer, accept swaps atomically, reject / cancel, never touch the turn', () => {
  const room = social();
  const [c1, c2, c3] = ['c1', 'c2', 'c3'].map((id) => ch(room, id));
  expect(() => act(room, { type: 'offerTrade', characterId: 'c1', toId: 'c3', give: { money: 10 }, want: { money: 5 } }), 409, /내 캐릭터끼리/);
  expect(() => act(room, { type: 'offerTrade', characterId: 'c1', toId: 'c2', give: { money: 10 }, want: { money: 5 } }), 400, /돈과 돈/);
  expect(() => act(room, { type: 'offerTrade', characterId: 'c1', toId: 'c2', give: { money: 900 }, want: { cardUid: 'k81' } }), 409, /돈이 부족/);
  expect(() => act(room, { type: 'offerTrade', characterId: 'c1', toId: 'c2', give: { money: 10 }, want: { cardUid: 'k80' } }), 409, /손패에 없는/);
  expect(() => act(room, { type: 'offerTrade', characterId: 'c1', toId: 'c2', give: { money: 10, cardUid: 'k80' }, want: { cardUid: 'k81' } }), 400, /하나만/);
  expect(() => act(room, { type: 'offerTrade', characterId: 'c1', toId: 'c2', give: { money: 10 }, want: { cardUid: 'k81' }, actor: { sessionId: 'B' } }), 403);
  const before = structuredClone(room.turn);
  const o = act(room, { type: 'offerTrade', characterId: 'c1', toId: 'c2', give: { money: 100 }, want: { cardUid: 'k81' } }, {}, 5000);
  assert.deepEqual(o.room.turn, before, 'the turn state machine is untouched');
  const trade = o.room.trades[0];
  assert.deepEqual(trade, { id: 't1', fromId: 'c1', toId: 'c2', give: { money: 100 }, want: { cardUid: 'k81', cardId: 'lotto' }, createdAt: 5000, expiresAt: 65000 });
  const offered = o.events.find((e) => e.type === 'tradeOffered');
  assert.deepEqual([offered.tradeId, offered.fromId, offered.toId, offered.want.cardId, offered.cutin], ['t1', 'c1', 'c2', 'lotto', false]);
  assert.deepEqual(viewFor(o.room, 'B').trades, o.room.trades, 'offers are public');
  expect(() => act(o.room, { type: 'offerTrade', characterId: 'c1', toId: 'c2', give: { money: 10 }, want: { cardUid: 'k81' } }), 409, /이미/);
  expect(() => act(o.room, { type: 'respondTrade', characterId: 'c3', tradeId: 't1', accept: true }), 403, /상대/);
  expect(() => act(o.room, { type: 'respondTrade', characterId: 'c2', tradeId: 't1', accept: 'yes' }), 400);
  expect(() => act(o.room, { type: 'cancelTrade', characterId: 'c2', tradeId: 't1' }), 403);
  // accept
  const a = act(o.room, { type: 'respondTrade', characterId: 'c2', tradeId: 't1', accept: true, actor: { sessionId: 'B' } });
  assert.deepEqual([ch(a.room, 'c1').money, ch(a.room, 'c2').money], [c1.money - 100, c2.money + 100]);
  assert.deepEqual(ch(a.room, 'c1').cards.map((k) => k.uid), ['k80', 'k81'], 'the card keeps its uid');
  assert.deepEqual(ch(a.room, 'c2').cards, []);
  assert.equal(a.events.find((e) => e.type === 'tradeResolved').status, 'accepted');
  assert.equal(a.events.find((e) => e.type === 'cardGained').source, 'trade');
  assert.deepEqual(a.room.trades, []);
  // reject / cancel
  assert.equal(act(o.room, { type: 'respondTrade', characterId: 'c2', tradeId: 't1', accept: false }).events.find((e) => e.type === 'tradeResolved').status, 'rejected');
  const cx = act(o.room, { type: 'cancelTrade', characterId: 'c1', tradeId: 't1' });
  assert.deepEqual([cx.events.find((e) => e.type === 'tradeResolved').status, cx.room.trades.length], ['cancelled', 0]);
  expect(() => act(cx.room, { type: 'respondTrade', characterId: 'c2', tradeId: 't1', accept: true }), 409, /이미 끝났/);
  // re-validation at accept time: c1 gave the offered card away (family gift) → the trade falls through
  const o2 = act(room, { type: 'offerTrade', characterId: 'c1', toId: 'c2', give: { cardUid: 'k80' }, want: { money: 50 } });
  const moved = act(o2.room, { type: 'gift', characterId: 'c1', toId: 'c3', cardUid: 'k80' });
  const inv = act(moved.room, { type: 'respondTrade', characterId: 'c2', tradeId: 't1', accept: true });
  const res = inv.events.find((e) => e.type === 'tradeResolved');
  assert.deepEqual([res.status, res.reason], ['cancelled', 'invalid']);
  assert.equal(ch(inv.room, 'c2').money, c2.money, 'nothing moved');
  assert.ok(c3);
});

test('trades expire: after 60 s (checked before any action, runner deadline), on the offerer’s next turn, on finishing', () => {
  const room = social();
  const o = act(room, { type: 'offerTrade', characterId: 'c3', toId: 'c2', give: { cardUid: 'k82' }, want: { money: 10 } }, {}, 1000);
  // runner deadline: the offer's expiry when nothing else is due
  assert.deepEqual(GameRunner.deadlineOf(o.room), { kind: 'trades', at: 61000, key: 't:t1:61000' });
  const withPrompt = structuredClone(o.room);
  withPrompt.turn.pending = { promptId: 'pr9', deadlineAt: 30000, forCharacterIds: [], answers: {}, options: [] };
  assert.equal(GameRunner.deadlineOf(withPrompt).kind, 'prompt', 'the earlier deadline wins');
  withPrompt.turn.pending.deadlineAt = 90000;
  assert.equal(GameRunner.deadlineOf(withPrompt).kind, 'trades');
  expect(() => act(o.room, { type: 'expireTrades', actor: { sessionId: 'A' } }), 403);
  const early = act(o.room, { type: 'expireTrades', actor: { system: true } }, {}, 60999);
  assert.equal(early.room.trades.length, 1);
  const late = act(o.room, { type: 'expireTrades', actor: { system: true } }, {}, 61000);
  assert.deepEqual([late.room.trades.length, late.events[0].type, late.events[0].status], [0, 'tradeResolved', 'expired']);
  // any other action past the deadline expires it first
  const gift = act(o.room, { type: 'gift', characterId: 'c1', toId: 'c2', money: 5 }, {}, 70000);
  assert.equal(gift.events[0].status, 'expired');
  // the offerer's (c3) next turn starts → expired
  const spin = act(o.room, { type: 'spin', characterId: 'c1' }, { ints: [1] }, 2000);
  assert.equal(cur(spin.room), 'c3');
  assert.deepEqual(spin.room.trades, []);
  assert.ok(spin.events.some((e) => e.type === 'tradeResolved' && e.status === 'expired'));
  // finished characters can't trade
  const fin = structuredClone(room);
  ch(fin, 'c2').finished = true;
  expect(() => act(fin, { type: 'offerTrade', characterId: 'c1', toId: 'c2', give: { money: 10 }, want: { cardUid: 'k81' } }), 409, /골인/);
});

test('gifts: money / card, own characters allowed (family), validation; allowed during a pending prompt', () => {
  const room = social();
  const g = act(room, { type: 'gift', characterId: 'c1', toId: 'c3', money: 120 });
  assert.deepEqual([ch(g.room, 'c1').money, ch(g.room, 'c3').money], [380, 620]);
  const ev = g.events.find((e) => e.type === 'gift');
  assert.deepEqual([ev.fromId, ev.toId, ev.money, ev.family, ev.cutin, ev.lineTag], ['c1', 'c3', 120, true, false, 'gift_send']);
  const card = act(room, { type: 'gift', characterId: 'c2', toId: 'c1', cardUid: 'k81' });
  assert.deepEqual(ch(card.room, 'c1').cards.map((k) => k.uid), ['k80', 'k81']);
  assert.deepEqual([card.events.find((e) => e.type === 'gift').cardId, card.events.find((e) => e.type === 'cardGained').source], ['lotto', 'gift']);
  expect(() => act(room, { type: 'gift', characterId: 'c1', toId: 'c2', money: 501 }), 409, /부족/);
  expect(() => act(room, { type: 'gift', characterId: 'c1', toId: 'c1', money: 5 }), 400);
  expect(() => act(room, { type: 'gift', characterId: 'c1', toId: 'c2', money: 5, cardUid: 'k80' }), 400);
  expect(() => act(room, { type: 'gift', characterId: 'c1', toId: 'c2', money: 0 }), 400);
  const pend = structuredClone(room);
  pend.turn.pending = { promptId: 'pr5', kind: 'habit', forCharacterIds: ['c1'], answers: {}, options: [{ id: 'a' }], defaultOptionId: 'a', deadlineAt: null };
  pend.turn.phase = 'awaitDecision';
  const r = act(pend, { type: 'gift', characterId: 'c2', toId: 'c1', money: 10 });
  assert.deepEqual([r.room.turn.phase, r.room.turn.pending.promptId], ['awaitDecision', 'pr5']);
});

// ---------- 명절 대잔치 ----------

/** The current character stands on the last 초등 tile; the first 중등 tile is a plain money tile. */
function holidayRoom(config = { holidays: true }) {
  const room = structuredClone(started({ config }));
  const me = ch(room, cur(room));
  me.position = { eraIndex: 1, route: 'main', index: room.board.eras[1].tiles.length - 1 };
  me.era = 'elem';
  for (const c of room.characters) if (c.id !== me.id) Object.assign(c, { era: 'young', money: 300 });
  me.money = 300;
  room.erasOpened = ['baby', 'elem'];
  Object.assign(room.board.eras[2].tiles[0], { type: 'money', amount: 10, label: '용돈' });
  return { room, me };
}

test('holiday: first entrant of 중등 opens one simultaneous prompt for everyone; sebae / nagging / 고스톱 pot conserved', () => {
  const { room, me } = holidayRoom();
  ch(room, me.id).cards = [{ uid: 'k70', id: 'lotto' }];
  const r = act(room, { type: 'spin', characterId: me.id }, { ints: [1] }, 1000);
  const types = r.events.map((e) => e.type);
  assert.ok(types.indexOf('newsFlash') < types.indexOf('lottoDraw') && types.indexOf('lottoDraw') < types.indexOf('holidayStarted'), types.join(','));
  const hs = r.events.find((e) => e.type === 'holidayStarted');
  assert.deepEqual([hs.eraId, hs.kind, hs.cutin, hs.scene, hs.mcStudio, hs.mcKey], ['middle', 'seol', true, 'holiday', true, 'holiday']);
  const p = r.room.turn.pending;
  assert.deepEqual([p.kind, p.simultaneous, p.deadlineAt, p.defaultOptionId], ['holiday', true, 1000 + data.balance.prompts.multiTimeoutMs, 'pass']);
  assert.deepEqual(p.forCharacterIds, r.room.turn.order);
  assert.deepEqual(p.options.map((o) => [o.id, o.stake]), [['pass', 0], ['small', 20], ['big', 60]]);
  assert.deepEqual(r.room.holidays, { middle: 'seol' });
  // answers: c1 big, c3 small, c2 pass (the last answer resolves with a scripted rng)
  const [a, b, c] = r.room.turn.order;
  let s = act(r.room, { type: 'choose', characterId: a, promptId: p.promptId, optionId: 'big' });
  s = act(s.room, { type: 'choose', characterId: b, promptId: p.promptId, optionId: 'small' });
  const money0 = Object.fromEntries(s.room.characters.map((x) => [x.id, x.money]));
  // ints: sebae ×3, then (stat, line) ×3, then hwatu cards of the 2 stakers; nexts: nagging ±1
  const sebae = { [a]: 40, [b]: -40, [c]: -20 };
  const done = act(s.room, { type: 'choose', characterId: c, promptId: p.promptId, optionId: 'pass' }, { ints: [sebae[a], sebae[b], sebae[c], 0, 0, 1, 0, 2, 0, 3, 9], nexts: [0.1, 0.9, 0.1] });
  const hr = done.events.find((e) => e.type === 'holidayResult');
  assert.deepEqual([hr.cutin, hr.tone, hr.scene], [true, 'holiday', 'holiday']);
  const row = Object.fromEntries(hr.results.map((x) => [x.charId, x]));
  assert.deepEqual([row[a].stake, row[a].card, row[a].won], [60, 3, -20], 'the loser pays min(own stake, winner stake)');
  assert.deepEqual([row[b].stake, row[b].card, row[b].won], [20, 9, 20]);
  assert.deepEqual([row[c].stake, row[c].card, row[c].won], [0, null, 0]);
  assert.deepEqual([hr.pot, hr.winners], [20, [b]]);
  assert.equal(hr.results.reduce((x, y) => x + y.won, 0), 0, 'money only moves between stakers');
  for (const id of [a, b, c]) assert.equal(ch(done.room, id).money, money0[id] + sebae[id] + row[id].won, id);
  assert.deepEqual(row[a].nagging.stat, 'int');
  assert.deepEqual([row[a].nagging.delta, row[b].nagging.delta], [1, -1]);
  for (const x of hr.results) assert.ok(lines.tags[x.lineTag] && x.line && !/\{\w+\}/.test(x.line));
  assert.equal(done.room.turn.pending, null);
  // a second entrant of 중등 → nothing; the next holiday era alternates to 추석
  const tx = createTx(structuredClone(done.room), { rng: fixedRng(), now: 0, data });
  assert.equal(openHoliday(tx, 'middle'), false);
  assert.equal(openHoliday(tx, 'young'), false, 'young is not a holiday era (2 holidays: 중학생 + 중년)');
  assert.equal(openHoliday(tx, 'middle_age'), true);
  assert.equal(tx.room.holidays.middle_age, 'chuseok');
});

test('holiday: ties split the pot (floor, remainder to the first), lone staker plays nobody, config / first era off', () => {
  const { room } = holidayRoom();
  const r = act(room, { type: 'spin', characterId: cur(room) }, { ints: [1] });
  const p = r.room.turn.pending;
  const [a, b, c] = r.room.turn.order;
  for (const ch_ of r.room.characters) ch_.money = 1000;
  let s = act(r.room, { type: 'choose', characterId: a, promptId: p.promptId, optionId: 'big' });
  s = act(s.room, { type: 'choose', characterId: b, promptId: p.promptId, optionId: 'small' });
  const done = act(s.room, { type: 'choose', characterId: c, promptId: p.promptId, optionId: 'big' }, { ints: [0, 0, 0, 0, 0, 0, 0, 0, 0, 8, 3, 8] });
  const hr = done.events.find((e) => e.type === 'holidayResult');
  const won = Object.fromEntries(hr.results.map((x) => [x.charId, x.won]));
  assert.deepEqual([won[a], won[b], won[c]], [10, -20, 10]);
  assert.deepEqual(hr.winners, [a, c]);
  // lone staker
  let l = act(r.room, { type: 'choose', characterId: a, promptId: p.promptId, optionId: 'big' });
  l = act(l.room, { type: 'choose', characterId: b, promptId: p.promptId, optionId: 'pass' });
  const lone = act(l.room, { type: 'choose', characterId: c, promptId: p.promptId, optionId: 'pass' }).events.find((e) => e.type === 'holidayResult');
  assert.ok(lone.results.every((x) => x.won === 0 && x.card === null));
  // config off → no holiday (the era still opens: news, lotto)
  const off = holidayRoom({ holidays: false });
  const ro = act(off.room, { type: 'spin', characterId: off.me.id }, { ints: [1] });
  assert.ok(!ro.events.some((e) => e.type === 'holidayStarted'));
  assert.equal(ro.room.erasOpened.includes('middle'), true);
  assert.equal(validateRoomConfig({}).config.holidays, true);
  assert.equal(validateRoomConfig({ holidays: false }).config.holidays, false);
  assert.match(validateRoomConfig({ holidays: 'no' }).errors[0], /명절/);
  // the mode's first era never holds one (adult mode starts in 청년)
  const adult = started({ config: { mode: 'adult', holidays: true } });
  const tx = createTx(adult, { rng: fixedRng(), now: 0, data });
  assert.deepEqual([holidayEra(tx, 'young'), holidayEra(tx, 'middle_age')], [false, true]);
  assert.deepEqual(adult.erasOpened, ['young']);
});

// ---------- 전국 로또 ----------

test('lotto: EV < card price, seeded distinct numbers, one ticket per holder, prizes by matches, skipped without tickets', () => {
  const cfg = data.balance.lotto;
  const ev = lottoExpectedValue(cfg);
  const price = data.cards.cards.find((k) => k.id === 'lotto').price;
  assert.ok(ev > 0 && ev < price, `EV ${ev} < ${price}`);
  const rng = createRng(123);
  let prize = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const mine = lottoNumbers(rng, cfg.pool, cfg.pick);
    const drawn = lottoNumbers(rng, cfg.pool, cfg.pick);
    assert.equal(new Set(mine).size, 3);
    assert.ok(mine.every((x) => x >= 1 && x <= cfg.pool));
    prize += cfg.prizes[mine.filter((x) => drawn.includes(x)).length] ?? 0;
  }
  assert.ok(Math.abs(prize / N - ev) < ev * 0.25, `sampled ${prize / N} vs EV ${ev}`);
  assert.deepEqual(lottoNumbers(createRng(5), 20, 3), lottoNumbers(createRng(5), 20, 3));
  // draw
  const room = social();
  const tx0 = createTx(structuredClone(room), { rng: fixedRng(), now: 0, data });
  tx0.room.characters.forEach((c) => (c.cards = []));
  assert.equal(lottoDraw(tx0, 'young'), null);
  assert.equal(tx0.events.length, 0);
  const r2 = structuredClone(room);
  ch(r2, 'c1').cards.push({ uid: 'k98', id: 'lotto' }, { uid: 'k99', id: 'lotto' });
  const tx = createTx(r2, { rng: fixedRng(), now: 0, data }); // no swaps → everyone [1,2,3], draw [1,2,3]
  const d = lottoDraw(tx, 'young');
  assert.deepEqual(d.numbers, [1, 2, 3]);
  assert.deepEqual(d.entries.map((e) => [e.charId, e.matches, e.prize]), [['c1', 3, 1000], ['c2', 3, 1000]]);
  assert.deepEqual(ch(r2, 'c1').cards.map((k) => k.id), ['taxi', 'lotto'], 'one ticket per draw');
  assert.equal(ch(r2, 'c2').money, 1500);
  const ev0 = tx.events[0];
  assert.equal(ev0.type, 'lottoDraw');
  decorateEvents(tx.events, { room: r2, data, seed: 1 });
  assert.deepEqual([ev0.cutin, ev0.lineTag], [true, 'lotto_win']);
  assert.ok(ev0.entries.every((e) => lines.tags[e.lineTag] && e.line));
  assert.equal(r2.lotto.draws.at(-1).eraId, 'young');
});

// ---------- presentation / MC ----------

test('presentation + MC: Stage 7 types registered, anchors vs chips, lines filled, MC situations', () => {
  for (const t of ['cardGained', 'cardUsed', 'cardBlocked', 'itemBought', 'tradeOffered', 'tradeResolved', 'gift', 'holidayStarted', 'holidayResult', 'lottoDraw']) assert.ok(EVENT_TYPES.includes(t), t);
  for (const t of ['cardBlocked', 'itemBought', 'holidayStarted', 'holidayResult', 'lottoDraw']) assert.ok(CUTIN_TYPES.has(t), t);
  for (const t of ['cardGained', 'cardUsed', 'gift', 'tradeOffered', 'tradeResolved']) assert.ok(!CUTIN_TYPES.has(t), t);
  for (const tag of ['card', 'card_use', 'sabotage', 'sabotaged', 'blocked', 'shop', 'shop_buy', 'holiday', 'holiday_sebae', 'holiday_nagging', 'gostop_win', 'gostop_lose', 'lotto_win', 'lotto_lose', 'gift', 'gift_send', 'trade']) {
    assert.ok(lines.tags[tag]?.length >= 5, tag);
  }
  const room = social();
  const mk = () => [
    { type: 'cardGained', charId: 'c1', cardId: 'taxi', uid: 'k1', source: 'tile' },
    { type: 'cardUsed', charId: 'c1', cardId: 'insurance', uid: 'k2', cardKind: 'passive', auto: true },
    { type: 'cardUsed', charId: 'c1', cardId: 'tax_audit', uid: 'k3', cardKind: 'sabotage', targetId: 'c2' },
    { type: 'cardBlocked', charId: 'c2', targetId: 'c1', cardId: 'noise', uid: 'k4' },
    { type: 'itemBought', charId: 'c1', itemId: 'designer_bag', price: 400 },
    { type: 'gift', fromId: 'c1', toId: 'c2', charId: 'c1', money: 30 },
    { type: 'holidayStarted', eraId: 'young', kind: 'chuseok', name: '추석' },
    { type: 'lottoDraw', eraId: 'young', numbers: [1, 2, 3], entries: [{ charId: 'c2', numbers: [4, 5, 6], matches: 0, prize: 0 }] },
    { type: 'tradeOffered', tradeId: 't1', fromId: 'c1', toId: 'c2', give: { money: 5 }, want: { cardUid: 'k9', cardId: 'lotto' } },
    { type: 'tradeResolved', tradeId: 't1', fromId: 'c1', toId: 'c2', status: 'rejected' },
  ];
  const events = mk();
  const r = structuredClone(room);
  r.config.mcFrequency = 'many';
  r.mcState = { cool: 0, eras: ['baby'], firstSpin: true };
  const always = { ...data, mc: { ...data.mc, frequency: { ...data.mc.frequency, many: { ...data.mc.frequency.many, medium: 1, minor: 1, cooldown: 0 } } } };
  decorateEvents(events, { room: r, data: always, seed: 9 });
  const [gain, auto, sab, blocked, item, gift, hol, lotto, offer, resolved] = events;
  assert.deepEqual([gain.cutin, auto.cutin, sab.cutin, blocked.cutin, item.cutin, gift.cutin, hol.cutin, lotto.cutin, offer.cutin, resolved.cutin], [false, false, true, true, true, false, true, true, false, false]);
  assert.deepEqual([sab.tone, blocked.tone, item.scene, hol.scene, lotto.lineTag], ['bad', 'good', 'shop', 'holiday', 'lotto_lose']);
  for (const e of events) {
    assert.ok(lines.tags[e.lineTag], `${e.type}: ${e.lineTag}`);
    assert.ok(e.line && !/\{\w+\}/.test(e.line), `${e.type}: "${e.line}"`);
    for (const l of e.mc ?? []) assert.ok(!/\{\w+\}/.test(l.line), `${e.type} mc: ${l.line}`);
  }
  assert.ok(sab.line.includes('비') || !sab.line.includes('{target}'));
  assert.deepEqual([sab.mcKey, blocked.mcKey, item.mcKey, gift.mcKey, hol.mcKey, lotto.mcKey], ['sabotage', 'blocked', 'shopping', 'gift', 'holiday', 'lotto']);
  assert.deepEqual([hol.mcStudio, lotto.mcStudio, sab.mcStudio], [true, true, undefined]);
  assert.equal(auto.mcKey, undefined, 'passive triggers stay quiet');
  // off → nothing
  const quiet = mk();
  const q = structuredClone(r);
  q.config.mcFrequency = 'off';
  attachMc(quiet, { room: q, data });
  assert.ok(quiet.every((e) => !e.mc));
});

test('full random lifetime game with holidays, cards, shops and gifts: known events, filled lines, conserved pots', () => {
  const seen = new Set();
  // a few seeded games (one short game may miss a card tile); every one must end with the holidays of its eras
  for (const seed of [21, 22, 23, 24, 25]) {
    let room = started({ seed, config: { holidays: true } });
    const rng = createRng(seed - 16);
    for (let i = 0; i < 3000 && room.status === 'playing'; i++) {
      const p = room.turn.pending;
      let action;
      if (p) {
        const opts = p.options.filter((o) => !o.disabled);
        action = { type: 'choose', characterId: p.forCharacterIds.find((x) => !Object.hasOwn(p.answers, x)), promptId: p.promptId, optionId: rng.pick(opts).id };
      } else {
        const c = ch(room, cur(room));
        const to = room.characters.find((x) => x.id !== c.id && !x.finished);
        if (rng.next() < 0.05 && c.money > 10 && to) action = { type: 'gift', characterId: c.id, toId: to.id, money: 5 };
        else action = randomCardAction(room, c, rng, 0.7) ?? { type: 'spin', characterId: c.id };
      }
      const r = applyAction(room, action, { now: i * 1000 });
      room = r.room;
      room.log = [];
      for (const e of r.events) {
        seen.add(e.type);
        assert.ok(EVENT_TYPES.includes(e.type), e.type);
        if (e.type === 'holidayResult') assert.equal(e.results.reduce((a, x) => a + x.won, 0), 0);
        if (e.type === 'chose' || e.type === 'betPlaced') continue;
        assert.ok(lines.tags[e.lineTag], `${e.type}: tag ${e.lineTag}`);
        assert.ok(!/\{\w+\}/.test(e.line ?? ''), `${e.type}: "${e.line}"`);
        for (const l of e.mc ?? []) assert.ok(!/\{\w+\}/.test(l.line), `${e.type} mc: "${l.line}"`);
      }
    }
    assert.equal(room.status, 'finished');
    const hEras = gameData().holidays.eras.filter((e) => room.board.eras.some((x, i) => i > 0 && x.id === e));
    assert.deepEqual(Object.keys(room.holidays).sort(), [...hEras].sort(), 'one holiday per holiday era of the mode');
    assert.deepEqual(Object.values(room.holidays), hEras.map((_, i) => (i % 2 ? 'chuseok' : 'seol')));
    assert.ok(room.result.ranking.every((r) => Number.isInteger(r.items)));
  }
  for (const t of ['cardGained', 'cardUsed', 'gift', 'holidayStarted', 'holidayResult']) assert.ok(seen.has(t), t);
});

// ---------- restore / migration ----------

test('restore: a JSON snapshot with hands, trades and spin mods continues identically; pre-Stage-7 saves migrate', () => {
  const room = social();
  ch(room, 'c3').spinMods = [{ kind: 'minus', value: 3, by: 'c1', card: 'cut_line' }];
  const o = applyAction(room, { type: 'offerTrade', characterId: 'c2', toId: 'c1', give: { cardUid: 'k81' }, want: { money: 20 } }, { now: 10 });
  const snap = JSON.parse(JSON.stringify(o.room));
  const run = (r) => {
    let x = r;
    const out = [];
    for (let i = 0; i < 12 && x.status === 'playing'; i++) {
      const p = x.turn.pending;
      const action = p
        ? { type: 'choose', characterId: p.forCharacterIds.find((id) => !Object.hasOwn(p.answers, id)), promptId: p.promptId, optionId: p.defaultOptionId }
        : { type: 'spin', characterId: cur(x) };
      const res = applyAction(x, action, { now: 100 + i });
      out.push(res.events.map((e) => [e.type, e.line]));
      x = res.room;
    }
    return { out, x };
  };
  const a = run(o.room);
  const b = run(snap);
  assert.deepEqual(a.out, b.out);
  assert.equal(a.x.rngState, b.x.rngState);
  // pre-Stage-7 save: fields filled in, eras already reached count as opened
  const old = structuredClone(started());
  for (const c of old.characters) for (const k of ['cards', 'items', 'spinMods', 'lastTargetedBy']) delete c[k];
  for (const k of ['nextCardSeq', 'nextTradeSeq', 'trades', 'holidayCount', 'holidays', 'lotto', 'erasOpened', 'eraQueue']) delete old[k];
  old.characters[0].position = { eraIndex: 2, route: 'main', index: 0 };
  const m = applyAction(old, { type: 'gift', characterId: 'c1', toId: 'c2', money: 1 }, { now: 5 });
  assert.deepEqual(m.room.erasOpened, ['baby', 'elem', 'middle']);
  assert.deepEqual([m.room.trades, ch(m.room, 'c2').cards, ch(m.room, 'c2').items], [[], [], []]);
});

// ---------- HTTP ----------

test('HTTP: card / trade / gift actions, spectators 403, /api/meta cards·items·holidays, admin holidays config', async () => {
  const tmp = await tempDir();
  const srv = await startServer({ port: 0, host: '127.0.0.1', dataDir: tmp.dir, debounceMs: 5, adminPassword: 'pw' });
  const call = (m, p, o) => httpCall(srv.url, m, p, o);
  try {
    const login = await call('POST', '/admin/api/login', { body: { password: 'pw' } });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await call('POST', '/admin/api/rooms', { cookie, body: { holidays: 'x' } })).status, 400);
    const created = await call('POST', '/admin/api/rooms', { cookie, body: { mode: 'adult', eraTurns: { young: 5, middle_age: 5, senior: 3 }, holidays: false } });
    assert.equal(created.json.room.config.holidays, false);
    const { id, code } = created.json.room;
    const A = (await call('POST', '/api/session')).json.token;
    const B = (await call('POST', '/api/session')).json.token;
    const W = (await call('POST', '/api/session')).json.token;
    await call('POST', '/api/rooms/join', { token: A, body: { code, name: '에이' } });
    await call('POST', '/api/rooms/join', { token: B, body: { code, name: '비' } });
    await call('POST', `/api/rooms/${id}/characters`, { token: A, body: { name: '에이1' } });
    await call('POST', `/api/rooms/${id}/characters`, { token: B, body: { name: '비1' } });
    assert.equal((await call('POST', `/admin/api/rooms/${id}/start`, { cookie })).status, 200);
    await call('POST', '/api/rooms/join', { token: W, body: { code, name: '관전', spectator: true } });
    // hand the current character a taxi card and the other one a lotto card
    const room = structuredClone(srv.store.getRoom(id));
    const current = room.turn.order[room.turn.currentIndex];
    const other = room.characters.find((c) => c.id !== current);
    const mine = room.characters.find((c) => c.id === current);
    mine.cards = [{ uid: 'k1', id: 'taxi' }];
    other.cards = [{ uid: 'k2', id: 'lotto' }];
    srv.store.put(room);
    const tokenOf = (charId) => (srv.store.getRoom(id).characters.find((c) => c.id === charId).ownerSessionId === A ? A : B);
    for (const body of [{ type: 'useCard', characterId: current, cardUid: 'k1' }, { type: 'gift', characterId: current, toId: other.id, money: 5 }, { type: 'offerTrade', characterId: current, toId: other.id, give: { money: 5 }, want: { cardUid: 'k2' } }]) {
      const r = await call('POST', `/api/rooms/${id}/actions`, { token: W, body });
      assert.equal(r.status, 403, body.type);
      assert.match(r.json.error, /관전자/);
    }
    const use = await call('POST', `/api/rooms/${id}/actions`, { token: tokenOf(current), body: { type: 'useCard', characterId: current, cardUid: 'k1' } });
    assert.equal(use.status, 200, use.text);
    assert.ok(use.json.events.some((e) => e.type === 'cardUsed' && e.cardId === 'taxi'));
    assert.deepEqual(use.json.room.characters.find((c) => c.id === current).spinMods, [{ kind: 'max2', card: 'taxi' }]);
    const offer = await call('POST', `/api/rooms/${id}/actions`, { token: tokenOf(current), body: { type: 'offerTrade', characterId: current, toId: other.id, give: { money: 5 }, want: { cardUid: 'k2' } } });
    assert.equal(offer.status, 200, offer.text);
    assert.equal(offer.json.room.trades.length, 1);
    const resp = await call('POST', `/api/rooms/${id}/actions`, { token: tokenOf(other.id), body: { type: 'respondTrade', characterId: other.id, tradeId: offer.json.room.trades[0].id, accept: true } });
    assert.equal(resp.status, 200, resp.text);
    assert.ok(resp.json.room.characters.find((c) => c.id === current).cards.some((k) => k.uid === 'k2'));
    const gift = await call('POST', `/api/rooms/${id}/actions`, { token: tokenOf(other.id), body: { type: 'gift', characterId: other.id, toId: current, money: 99999 } });
    assert.equal(gift.status, 409);
    assert.match(gift.json.error, /부족/);
    const meta = (await call('GET', '/api/meta')).json;
    assert.equal(meta.cards.cards.length, 16);
    assert.equal(meta.items.items.length, 6);
    assert.deepEqual(meta.holidays.eras, gameData().holidays.eras);
    assert.equal(meta.balance.lotto.pool, 20);
    assert.equal(meta.presentation.sceneFallbacks.stage, 'wedding-hall');
  } finally {
    await srv.close();
    await tmp.cleanup();
  }
});
