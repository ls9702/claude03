// Stage 8 — real estate: houses.json, listings (capacity / 1인 1채 / 청약 / lucky 제주 별장 / news prices), buy + swap
// (보상판매), the 노년 시세 draw (once, news-influenced), ranking with the house value, 건물주 via swaps, HTTP / meta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameData } from '../server/data/index.js';
import { applyAction, startGame } from '../server/game/engine.js';
import { createTx } from '../server/game/effects.js';
import { HOUSE_IDS, buyHouse, drawHousingMarket, houseListings, houseOwners, priceMult, tradeInValue } from '../server/game/houses.js';
import { checkHiddenUnlocks } from '../server/game/jobs.js';
import { resolvePrompt } from '../server/game/prompts.js';
import { resolveTile } from '../server/game/spaces.js';
import { computeRanking } from '../server/game/result.js';
import { addCharacter, joinRoom } from '../server/game/lobby.js';
import { startServer } from '../server/index.js';
import { httpCall, makeRoom, tempDir } from './helpers.js';

const data = gameData();
const H = data.houses;
const def = (id) => H.houses.find((h) => h.id === id);
const r5 = (v) => Math.max(5, Math.round(v / 5) * 5);

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
function fixedRng({ ints = [], nexts = [], picks = [] } = {}) {
  const qi = [...ints];
  const qn = [...nexts];
  const qp = [...picks];
  return {
    next: () => (qn.length ? qn.shift() : 0.99),
    int: (a) => (qi.length ? qi.shift() : a),
    pick: (arr) => {
      if (!qp.length) return arr[0];
      const want = qp.shift();
      return arr.find((x) => (x.id ?? x) === want) ?? arr[0];
    },
    weighted: (items) => items[0],
    get state() {
      return 77;
    },
  };
}
const ch = (room, id) => room.characters.find((c) => c.id === id);
const cur = (room) => room.turn.order[room.turn.currentIndex];
function sandbox({ era = 'young', rng = {}, news = {}, money = 5000 } = {}) {
  const room = structuredClone(started());
  room.news = news;
  room.erasOpened = room.board.eras.map((e) => e.id);
  room.schoolMeetDone = true;
  for (const c of room.characters) Object.assign(c, { era, money, careerDone: true, military: { status: 'done', turnsLeft: 0 }, job: { id: 'teacher', rank: 1, exp: 0, injured: 0 } });
  const tx = createTx(room, { rng: fixedRng(rng), now: 0, data });
  return { room, tx, c: room.characters[0], others: room.characters.slice(1) };
}
const houseTile = (route = 'money') => ({ id: `young:${route}:2`, type: 'house', route });
const answer = (tx, c, optionId) => {
  tx.room.turn.pending.answers[c.id] = optionId;
  resolvePrompt(tx);
};

test('houses.json: 6 fixed ids, capacity (apartment unlimited), lucky 제주 별장, tradeIn 0.7, market 0.8–1.5', () => {
  assert.deepEqual(H.houses.map((h) => h.id), HOUSE_IDS);
  assert.deepEqual(HOUSE_IDS, ['oneroom', 'villa', 'apartment', 'hanok', 'penthouse', 'jeju_villa']);
  for (const h of H.houses) {
    assert.ok(h.name && h.icon && h.desc && h.price > 0 && h.value > 0, h.id);
    assert.ok(h.capacity === 1 || h.capacity === null, h.id);
  }
  assert.equal(def('apartment').capacity, null);
  assert.deepEqual(H.houses.filter((h) => h.lucky).map((h) => h.id), ['jeju_villa']);
  assert.ok(def('jeju_villa').value > def('jeju_villa').price);
  assert.ok(def('penthouse').price > def('hanok').price && def('oneroom').price < def('villa').price);
  assert.equal(H.tradeIn, 0.7);
  assert.deepEqual([H.market.min, H.market.max], [0.8, 1.5]);
  assert.equal(H.subscription.houseId, 'apartment');
});

test('listings: available houses of the era (capacity, own house excluded), sorted; 청약 discount; lucky 제주 only by the roll', () => {
  const { tx, c, others } = sandbox();
  // plain: first picks (seeded), no lucky / 청약 roll
  const plain = houseListings(tx, c, { route: 'money' });
  assert.equal(plain.length, H.listings);
  assert.ok(plain.every((l, i) => i === 0 || plain[i - 1].price <= l.price), 'sorted by price');
  assert.ok(!plain.some((l) => l.lucky));
  // capacity: the villa is taken by someone else → never listed; my own house never listed
  others[0].house = { id: 'villa', price: 700, value: 700, boughtTurn: 1 };
  c.house = { id: 'oneroom', price: 300, value: 300, boughtTurn: 1 };
  for (let i = 0; i < 6; i++) {
    const t = createTx(tx.room, { rng: fixedRng({ picks: [['oneroom', 'villa', 'apartment', 'hanok', 'penthouse'][i % 5]] }), now: 0, data });
    const ids = houseListings(t, c).map((l) => l.houseId);
    assert.ok(!ids.includes('villa') && !ids.includes('oneroom'), ids.join(','));
  }
  // apartment is unlimited
  others[1].house = { id: 'apartment', price: 1200, value: 1200, boughtTurn: 1 };
  const t2 = createTx(tx.room, { rng: fixedRng({ picks: ['apartment'] }), now: 0, data });
  assert.ok(houseListings(t2, c).some((l) => l.houseId === 'apartment'));
  // 청약: the apartment's price is discounted when the roll wins (lucky roll first, then 청약)
  const s = sandbox({ rng: { picks: ['apartment', 'villa', 'hanok'], nexts: [0.99, 0] } });
  const sub = houseListings(s.tx, s.c, { route: 'career' }).find((l) => l.houseId === 'apartment');
  assert.equal(sub.subscription, true);
  assert.equal(sub.basePrice, def('apartment').price);
  assert.equal(sub.price, r5(def('apartment').price * (1 - H.subscription.discount)));
  assert.equal(sub.value, def('apartment').value, '청약 lowers the price, not the value');
  // lucky roll on the money route → 제주 별장 replaces the last pick
  const l = sandbox({ rng: { nexts: [0] } });
  const lucky = houseListings(l.tx, l.c, { route: 'money' });
  assert.equal(lucky.length, H.listings);
  const jeju = lucky.find((x) => x.houseId === 'jeju_villa');
  assert.ok(jeju?.lucky);
  assert.equal(jeju.value, def('jeju_villa').value);
  // lucky chance: money route > elsewhere, + luck
  const lc = H.luckyChance;
  assert.ok(lc.money > lc.other && lc.perLuck > 0);
  // news: housing boom scales prices and values
  const b = sandbox({ news: { young: 'housing_boom' } });
  const boom = houseListings(b.tx, b.c);
  const mult = data.news.news.find((n) => n.id === 'housing_boom').effects.housePriceMult;
  assert.equal(priceMult(b.tx, b.c), mult);
  for (const x of boom) {
    assert.equal(x.price, r5(def(x.houseId).price * mult));
    assert.equal(x.value, r5(def(x.houseId).value * mult));
  }
});

test('house tile → prompt: buy / pass, cash-only (disabled), one net moneyChanged; swap = trade-in (houseSold, swaps +1)', () => {
  const { tx, c, others } = sandbox({ money: 800 });
  assert.equal(resolveTile(tx, c, houseTile('career')), 'prompt');
  const p = tx.room.turn.pending;
  assert.equal(p.kind, 'house');
  assert.equal(p.defaultOptionId, 'pass');
  assert.equal(p.options.at(-1).id, 'pass');
  for (const o of p.options.slice(0, -1)) {
    assert.equal(o.id, `buy:${o.houseId}`);
    assert.ok(Number.isInteger(o.price) && Number.isInteger(o.value) && o.tradeIn === 0 && o.cost === o.price);
    assert.equal(!!o.disabled, o.cost > 800, o.id);
  }
  assert.ok(p.options.find((o) => o.houseId === 'apartment')?.disabled, 'too expensive');
  answer(tx, c, 'buy:villa');
  const bought = tx.events.find((e) => e.type === 'houseBought');
  assert.deepEqual([bought.houseId, bought.price, bought.tradeIn, bought.swap], ['villa', 700, 0, false]);
  assert.deepEqual(c.house, { id: 'villa', price: 700, value: def('villa').value, boughtTurn: tx.room.turn.turnNo });
  assert.equal(c.money, 100);
  assert.deepEqual(tx.events.filter((e) => e.type === 'moneyChanged').map((e) => [e.reason, e.delta]), [['house', -700]]);
  assert.deepEqual(tx.room.houseOwners, { villa: [c.id] });
  assert.ok(!tx.events.some((e) => e.type === 'promptResolved'), 'houseBought is the anchor');
  // swap: the villa is traded in at value × 0.7
  c.money = 1000;
  c.house.value = 800; // e.g. after a boom
  const credit = tradeInValue(data, c);
  assert.equal(credit, 560);
  tx.events.length = 0;
  buyHouse(tx, c, { houseId: 'apartment', price: 1200, basePrice: 1200, value: 1200 });
  assert.deepEqual(tx.events.map((e) => e.type).filter((t) => t !== 'log'), ['houseBought', 'houseSold', 'moneyChanged']);
  const sold = tx.events.find((e) => e.type === 'houseSold');
  assert.deepEqual([sold.houseId, sold.value, sold.amount], ['villa', 800, 560]);
  assert.equal(c.money, 1000 - (1200 - 560));
  assert.equal(c.houseSwaps, 1);
  assert.deepEqual(houseOwners(tx.room), { apartment: [c.id] });
  // pass → promptResolved {result: pass}
  const s = sandbox();
  resolveTile(s.tx, s.c, houseTile());
  answer(s.tx, s.c, 'pass');
  assert.equal(s.c.house, null);
  assert.equal(s.tx.events.find((e) => e.type === 'promptResolved').result, 'pass');
  // capacity race / money gone between opening and answering → noMoney
  const r = sandbox({ money: 5000 });
  resolveTile(r.tx, r.c, houseTile());
  const pick = r.tx.room.turn.pending.options.find((o) => o.houseId !== 'apartment' && o.id !== 'pass');
  r.others[0].house = { id: pick.houseId, price: 1, value: 1, boughtTurn: 1 };
  answer(r.tx, r.c, pick.id);
  assert.equal(r.c.house, null);
  assert.equal(r.tx.events.find((e) => e.type === 'promptResolved').result, 'noMoney');
  // kids: only a look around
  const k = sandbox({ era: 'high' });
  assert.equal(resolveTile(k.tx, k.c, houseTile()), null);
  assert.equal(others.length, 2);
});

test('노년 시세: drawn once by the first senior entrant (× senior news, clamped), every house value × mult', () => {
  const { tx, c, others } = sandbox({ era: 'senior', rng: { ints: [120] }, news: { senior: 'redevelopment' } });
  c.house = { id: 'villa', price: 700, value: 700, boughtTurn: 1 };
  others[0].house = { id: 'apartment', price: 1200, value: 1300, boughtTurn: 2 };
  const m = drawHousingMarket(tx, 'senior');
  assert.deepEqual(m, { eraId: 'senior', mult: 1.44 }); // 1.20 × 1.2 (재개발)
  assert.equal(c.house.value, r5(700 * 1.44));
  assert.equal(others[0].house.value, r5(1300 * 1.44));
  const ev = tx.events.find((e) => e.type === 'houseValueChanged');
  assert.deepEqual(ev.changes.map((x) => x.charId), [c.id, others[0].id]);
  assert.equal(ev.mult, 1.44);
  // once
  assert.equal(drawHousingMarket(tx, 'senior'), null);
  assert.equal(tx.events.filter((e) => e.type === 'houseValueChanged').length, 1);
  // clamped to max
  const hi = sandbox({ era: 'senior', rng: { ints: [150] }, news: { senior: 'redevelopment' } });
  assert.equal(drawHousingMarket(hi.tx, 'senior').mult, H.market.max);
  const lo = sandbox({ era: 'senior', rng: { ints: [80] }, news: { senior: 'housing_slump' } });
  assert.equal(drawHousingMarket(lo.tx, 'senior').mult, H.market.min);
  // later senior listings use the market price
  assert.equal(priceMult(tx, c), 1.44);
  // engine: the first entrant of senior triggers it
  const room = structuredClone(started());
  room.erasOpened = room.board.eras.map((e) => e.id).filter((e) => e !== 'senior');
  room.config.holidays = false;
  const mover = ch(room, cur(room));
  const mid = room.board.eras.findIndex((e) => e.id === 'middle_age');
  Object.assign(mover, { era: 'middle_age', route: 'career', position: { eraIndex: mid, route: 'main', index: 1 }, careerDone: true, military: { status: 'done', turnsLeft: 0 }, job: { id: 'teacher', rank: 1, exp: 0, injured: 0 } });
  mover.house = { id: 'hanok', price: 1800, value: 1800, boughtTurn: 1 };
  const r = applyAction(room, { type: 'spin', characterId: mover.id }, { rng: fixedRng({ ints: [1, 100] }), now: 5 });
  const hv = r.events.find((e) => e.type === 'houseValueChanged');
  assert.ok(hv, r.events.map((e) => e.type).join(','));
  assert.equal(hv.mcStudio, true);
  assert.equal(hv.mcKey, 'market');
  assert.ok(r.room.housingMarket.mult >= H.market.min && r.room.housingMarket.mult <= H.market.max);
  assert.equal(ch(r.room, mover.id).house.value, r5(1800 * r.room.housingMarket.mult));
});

test('ranking adds the house value: total = money − debt + items + house', () => {
  const room = structuredClone(started());
  const [a, b] = room.characters;
  Object.assign(a, { money: 500, debt: 0, house: { id: 'hanok', price: 1800, value: 2100, boughtTurn: 3 } });
  Object.assign(b, { money: 2000, debt: 100, house: null });
  const rows = computeRanking(room, { data });
  const ra = rows.find((r) => r.charId === a.id);
  assert.deepEqual([ra.house, ra.total, ra.rank], [2100, 2600, 1]);
  assert.equal(rows.find((r) => r.charId === b.id).house, 0);
});

test('건물주: unlocked after the 3rd swap (or owning 펜트하우스 / 제주 별장)', () => {
  const { tx, c } = sandbox({ money: 99999 });
  for (const id of ['oneroom', 'villa', 'apartment']) buyHouse(tx, c, { houseId: id, price: def(id).price, basePrice: def(id).price, value: def(id).value });
  assert.equal(c.houseSwaps, 2);
  assert.deepEqual(checkHiddenUnlocks(tx, c), []);
  buyHouse(tx, c, { houseId: 'hanok', price: 1800, basePrice: 1800, value: 1800 });
  assert.equal(c.houseSwaps, 3);
  assert.deepEqual(checkHiddenUnlocks(tx, c), ['landlord']);
  assert.ok(tx.events.some((e) => e.type === 'hiddenJobUnlocked' && e.jobId === 'landlord'));
  const s = sandbox({ money: 99999 });
  buyHouse(s.tx, s.c, { houseId: 'penthouse', price: 3000, basePrice: 3000, value: 3000 });
  assert.deepEqual(checkHiddenUnlocks(s.tx, s.c), ['landlord']);
});

test('HTTP: /api/meta partners + houses; a house prompt answered over HTTP; state exposes houseOwners', async () => {
  const tmp = await tempDir();
  const srv = await startServer({ port: 0, host: '127.0.0.1', dataDir: tmp.dir, debounceMs: 5, adminPassword: 'pw' });
  const call = (m, p, o) => httpCall(srv.url, m, p, o);
  try {
    const meta = await call('GET', '/api/meta');
    assert.deepEqual(meta.json.houses.houses.map((h) => h.id), HOUSE_IDS);
    assert.deepEqual(Object.keys(meta.json.partners.traits), ['int', 'str', 'charm', 'luck']);
    const login = await call('POST', '/admin/api/login', { body: { password: 'pw' } });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const created = await call('POST', '/admin/api/rooms', { cookie, body: { mode: 'adult', eraTurns: { young: 5, middle_age: 5, senior: 3 }, holidays: false } });
    const { id, code } = created.json.room;
    const A = (await call('POST', '/api/session')).json.token;
    const B = (await call('POST', '/api/session')).json.token;
    await call('POST', '/api/rooms/join', { token: A, body: { code, name: '에이' } });
    await call('POST', '/api/rooms/join', { token: B, body: { code, name: '비' } });
    await call('POST', `/api/rooms/${id}/characters`, { token: A, body: { name: '에이1' } });
    await call('POST', `/api/rooms/${id}/characters`, { token: B, body: { name: '비1' } });
    assert.equal((await call('POST', `/admin/api/rooms/${id}/start`, { cookie })).status, 200);
    // open a house prompt for the current character through the engine, then answer it over HTTP
    const room = structuredClone(srv.store.getRoom(id));
    const c = room.characters.find((x) => x.id === room.turn.order[room.turn.currentIndex]);
    Object.assign(c, { money: 5000, careerDone: true, military: { status: 'done', turnsLeft: 0 } });
    const tx = createTx(room, { rng: fixedRng(), now: Date.now(), data });
    resolveTile(tx, c, houseTile());
    srv.store.put(room);
    const p = srv.store.getRoom(id).turn.pending;
    const token = c.ownerSessionId === A ? A : B;
    const other = token === A ? B : A;
    const opt = p.options.find((o) => o.id !== 'pass' && !o.disabled);
    assert.equal((await call('POST', `/api/rooms/${id}/actions`, { token: other, body: { type: 'choose', characterId: c.id, promptId: p.promptId, optionId: opt.id } })).status, 403);
    const r = await call('POST', `/api/rooms/${id}/actions`, { token, body: { type: 'choose', characterId: c.id, promptId: p.promptId, optionId: opt.id } });
    assert.equal(r.status, 200, r.text);
    assert.ok(r.json.events.some((e) => e.type === 'houseBought' && e.houseId === opt.houseId));
    assert.deepEqual(r.json.room.houseOwners, { [opt.houseId]: [c.id] });
    assert.equal(r.json.room.characters.find((x) => x.id === c.id).house.id, opt.houseId);
  } finally {
    await srv.close();
    await tmp.cleanup();
  }
});
