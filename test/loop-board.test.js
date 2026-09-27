// Loop maps (원작식 순환 맵): forced stops, 찬스 광장 pause / resume (+ buffs, wishes, the shop chain, 이직), the shared era
// clock (transitions, openings once, skipped turns), the final goal race (조기 은퇴 / 전 재산 올인), 동아리, CPU answers,
// the migration of linear saves, presentation and the public view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameData } from '../server/data/index.js';
import { applyAction, isLoopBoard, migrateLoopBoard, startGame } from '../server/game/engine.js';
import { addCharacter, joinRoom } from '../server/game/lobby.js';
import { CPU_ANSWERS, cpuAimScores, cpuDecide } from '../server/game/cpu.js';
import { minTurnsTable, validateRoomConfig } from '../server/game/config.js';
import { viewFor } from '../server/game/view.js';
import { RoomStore } from '../server/store/roomStore.js';
import { GameRunner } from '../server/store/gameRunner.js';
import { startServer } from '../server/index.js';
import { atEraEnd, httpCall, makeRoom, plainEra, tempDir, toEra } from './helpers.js';

const data = gameData();
const SHORT = { baby: 1, elem: 1, middle: 1, high: 1, young: 3, middle_age: 3 };

function started({ mode = 'lifetime', chars = [['A', 'A1'], ['B', 'B1'], ['A', 'A2']], seed = 7, config = {} } = {}) {
  let room = makeRoom({ seed });
  room.config = { ...room.config, mode, ...config, eraTurns: { ...room.config.eraTurns, ...(config.eraTurns ?? {}) } };
  room = joinRoom(room, 'A', '에이', 0).room;
  room = joinRoom(room, 'B', '비', 0).room;
  for (const [owner, name] of chars) room = addCharacter(room, owner, { name }, 0).room;
  const r = startGame(room, { now: 0 });
  assert.equal(r.ok, true, r.error);
  return r.room;
}
/** RNG stub: int() / next() take queued values (then min / 0.99); pick / weighted take the first item. */
function fixedRng({ ints = [], nexts = [] } = {}) {
  const qi = [...ints];
  const qn = [...nexts];
  return { next: () => (qn.length ? qn.shift() : 0.99), int: (a) => (qi.length ? qi.shift() : a), pick: (arr) => arr[0], weighted: (items) => items[0], get state() { return 99; } };
}
const act = (room, action, rng = {}, now = 1000) => applyAction(room, action, { rng: fixedRng(rng), now });
const cur = (room) => room.turn.order[room.turn.currentIndex];
const ch = (room, id) => room.characters.find((c) => c.id === id);
const types = (events) => events.map((e) => e.type);
function setTile(room, eraIndex, index, tile, route = 'main') {
  const era = room.board.eras[eraIndex];
  const track = route === 'main' ? era.tiles : era.routes[route].tiles;
  track[index] = { id: track[index].id, label: 'test', ...(route !== 'main' ? { route } : {}), ...tile };
}
const choose = (room, optionId, rng = {}) => {
  const p = room.turn.pending;
  return act(room, { type: 'choose', characterId: p.forCharacterIds.find((x) => !Object.hasOwn(p.answers, x)), promptId: p.promptId, optionId }, rng);
};
const settle = (c) => Object.assign(c, { careerDone: true, military: { status: 'done', turnsLeft: 0 }, job: { id: 'chef', rank: 1, exp: 0, injured: 0 }, clubAsked: true, schoolMet: true });

// ---------- 찬스 광장 ----------

test('찬스 광장: passing it with steps left pauses the move behind its prompt; the rest of the move resumes after it', () => {
  const room = started();
  plainEra(room, 0);
  setTile(room, 0, 3, { type: 'pass', label: '찬스 광장', icon: '🎪' });
  const id = cur(room);
  const r = act(room, { type: 'spin', characterId: id }, { ints: [6] });
  const moved = r.events.find((e) => e.type === 'moved');
  assert.deepEqual(moved.path, ['baby:main:1', 'baby:main:2', 'baby:main:3']);
  assert.deepEqual([moved.halted, moved.remaining], ['pass', 3]);
  assert.ok(!r.events.some((e) => e.type === 'landed'), 'no landing while paused');
  assert.deepEqual(r.room.turn.move, { charId: id, remaining: 3, tileId: 'baby:main:3' });
  const p = r.room.turn.pending;
  assert.equal(p.kind, 'passTile');
  assert.deepEqual(p.options.map((o) => o.id), ['wish', 'wishAll', 'buy', 'jobChange', 'pass']);
  assert.equal(p.defaultOptionId, 'pass');
  const job = p.options.find((o) => o.id === 'jobChange');
  assert.equal(job.disabled, true);
  assert.match(job.desc, /학생/);
  const pass = p.options.find((o) => o.id === 'pass');
  assert.ok(pass.buff?.id && pass.desc.includes(pass.buff.name), 'the buff is shown before choosing');
  const wish = p.options.find((o) => o.id === 'wish');
  assert.ok(wish.cost > 0 && wish.chance > 0 && wish.money > 0);
  // choose 그냥 지나가기 → the buff, then the move resumes from the 찬스 광장 (not re-triggered)
  const res = choose(r.room, 'pass');
  const ts = types(res.events);
  assert.ok(ts.indexOf('promptResolved') < ts.indexOf('chanceBuff') && ts.indexOf('chanceBuff') < ts.indexOf('moved'), ts.join(','));
  const pr = res.events.find((e) => e.type === 'promptResolved');
  assert.deepEqual([pr.kind, pr.result, pr.buff, pr.cutin], ['passTile', 'passed', pass.buff.id, false]);
  const again = res.events.find((e) => e.type === 'moved');
  assert.deepEqual([again.resumed, again.from, again.path], [true, 'baby:main:3', ['baby:main:4', 'baby:main:5', 'baby:main:6']]);
  assert.equal(res.events.find((e) => e.type === 'landed').tileId, 'baby:main:6');
  assert.equal(res.room.turn.move, null);
  assert.equal(ch(res.room, id).chanceBuff.id, pass.buff.id);
  const gained = res.events.find((e) => e.type === 'chanceBuff');
  assert.deepEqual([gained.action, gained.cutin], ['gained', false]);
  // a payday / the fork after the 찬스 광장 still ends the resumed move
  const r2 = structuredClone(r.room);
  setTile(r2, 0, 5, { type: 'salary', label: '월급날' });
  const res2 = choose(r2, 'pass');
  const m2 = res2.events.find((e) => e.type === 'moved' && e.resumed);
  assert.deepEqual([m2.path.length, m2.halted], [2, 'salary']);
});

test('찬스 광장: landing exactly on it opens the prompt (no resume); the next 찬스 광장 ends the buff before its prompt', () => {
  let room = started();
  plainEra(room, 0);
  setTile(room, 0, 2, { type: 'pass' });
  setTile(room, 0, 5, { type: 'pass' });
  const id = cur(room);
  let r = act(room, { type: 'spin', characterId: id }, { ints: [2] });
  assert.equal(r.events.find((e) => e.type === 'moved').halted, null);
  assert.equal(r.events.find((e) => e.type === 'landed').tileType, 'pass');
  assert.equal(r.room.turn.move, null);
  r = choose(r.room, 'pass');
  assert.ok(!r.events.some((e) => e.type === 'moved'), 'nothing to resume');
  const buff = ch(r.room, id).chanceBuff;
  assert.ok(buff);
  room = r.room;
  room.turn.currentIndex = room.turn.order.indexOf(id);
  room.turn.phase = 'awaitSpin';
  const r2 = act(room, { type: 'spin', characterId: id }, { ints: [4] });
  const exp = r2.events.find((e) => e.type === 'chanceBuff');
  assert.deepEqual([exp.action, exp.buff.id], ['expired', buff.id]);
  assert.ok(types(r2.events).indexOf('chanceBuff') < types(r2.events).indexOf('prompt'));
  assert.equal(ch(r2.room, id).chanceBuff, null);
});

test('찬스 광장 wishes: 나를 위한 소원 (chance → 운 +1 + money, wishes +1) and 모두를 위한 소원 (gifts, 운 +1 for sure)', () => {
  const room = started();
  plainEra(room, 0);
  setTile(room, 0, 1, { type: 'pass' });
  const id = cur(room);
  const r = act(room, { type: 'spin', characterId: id }, { ints: [1] });
  const p = r.room.turn.pending;
  const c0 = ch(r.room, id);
  // success (next() = 0)
  const ok = choose(r.room, 'wish', { nexts: [0] });
  const w = p.options.find((o) => o.id === 'wish');
  const okEv = ok.events.find((e) => e.type === 'promptResolved');
  assert.deepEqual([okEv.result, okEv.wishes, okEv.cutin], ['wishOk', 1, true]);
  assert.equal(okEv.lineTag, 'pass_wish_ok');
  assert.equal(ch(ok.room, id).money, c0.money - w.cost + w.money);
  assert.equal(ch(ok.room, id).stats.luck, Math.min(10, c0.stats.luck + 1));
  assert.equal(ch(ok.room, id).wishes, 1, 'the same counter as the temple wish (산신령)');
  // failure (next() = 0.99): the offering is gone
  const bad = choose(r.room, 'wish', { nexts: [0.99] });
  assert.equal(bad.events.find((e) => e.type === 'promptResolved').result, 'wishFail');
  assert.equal(ch(bad.room, id).money, c0.money - w.cost);
  assert.equal(ch(bad.room, id).wishes, 0);
  // 모두를 위한 소원
  const all = choose(r.room, 'wishAll');
  const wa = p.options.find((o) => o.id === 'wishAll');
  const ev = all.events.find((e) => e.type === 'promptResolved');
  assert.deepEqual([ev.result, ev.others, ev.cutin], ['wishAll', 2, true]);
  assert.equal(ch(all.room, id).stats.luck, Math.min(10, c0.stats.luck + 1));
  assert.equal(ch(all.room, id).wishes, 1);
  assert.equal(ch(all.room, id).money, c0.money - wa.cost);
  for (const o of all.room.characters.filter((x) => x.id !== id)) assert.equal(o.money, ch(r.room, o.id).money + wa.gift);
  assert.ok(all.events.filter((e) => e.type === 'moneyChanged' && e.reason === 'wishGift').length === 2);
  // no cash → both wishes disabled
  const broke = structuredClone(room);
  ch(broke, id).money = 0;
  const rb = act(broke, { type: 'spin', characterId: id }, { ints: [1] });
  assert.ok(rb.room.turn.pending.options.filter((o) => o.id.startsWith('wish')).every((o) => o.disabled));
});

test('찬스 광장 구입 chains into the shop prompt (the same listing); after the purchase the move resumes', () => {
  const room = started();
  plainEra(room, 0);
  setTile(room, 0, 2, { type: 'pass' });
  const id = cur(room);
  const r = act(room, { type: 'spin', characterId: id }, { ints: [5] });
  const buy = r.room.turn.pending.options.find((o) => o.id === 'buy');
  assert.ok(!buy.disabled && buy.offers.length === 3);
  const shop = choose(r.room, 'buy');
  const p = shop.room.turn.pending;
  assert.equal(p.kind, 'shop');
  assert.deepEqual(p.context.offers.map((o) => [o.kind, o.id]), buy.offers.map((o) => [o.kind, o.id]), 'the listing shown on the 찬스 광장');
  assert.ok(shop.room.turn.move, 'still paused');
  const opt = p.options.find((o) => o.id.startsWith('buy:') && !o.disabled);
  const done = choose(shop.room, opt.id);
  assert.ok(done.events.some((e) => e.type === 'moneyChanged' && e.reason === 'shop'));
  const resumed = done.events.find((e) => e.type === 'moved' && e.resumed);
  assert.equal(resumed.path.length, 3);
  assert.equal(done.room.turn.move, null);
  // nothing affordable → 구입 disabled with the reason
  const poor = structuredClone(room);
  ch(poor, id).money = 1;
  const rp = act(poor, { type: 'spin', characterId: id }, { ints: [5] });
  const b2 = rp.room.turn.pending.options.find((o) => o.id === 'buy');
  assert.equal(b2.disabled, true);
  assert.match(b2.desc, /살 수 있는 물건이 없어요/);
});

test('찬스 광장 이직 (adult eras): one eligible alternate job (job-tile rules) → hire change, then the move resumes', () => {
  const room = started();
  const y = room.board.eras.findIndex((e) => e.id === 'young');
  toEra(room, y);
  plainEra(room, y);
  for (const c of room.characters) settle(c);
  const id = cur(room);
  Object.assign(ch(room, id), { stats: { int: 6, str: 6, charm: 6, luck: 6 }, education: 'college' });
  setTile(room, y, 2, { type: 'pass' });
  const r = act(room, { type: 'spin', characterId: id }, { ints: [4] });
  const job = r.room.turn.pending.options.find((o) => o.id === 'jobChange');
  assert.ok(!job.disabled && job.jobId && job.jobId !== 'chef', JSON.stringify(job));
  assert.ok(job.salary > 0 && job.requires);
  const done = choose(r.room, 'jobChange');
  const jc = done.events.find((e) => e.type === 'jobChanged');
  assert.deepEqual([jc.jobId, jc.fromJobId, jc.reason, jc.rank], [job.jobId, 'chef', 'change', 1]);
  assert.equal(done.events.find((e) => e.type === 'promptResolved').result, 'changed');
  assert.ok(done.events.some((e) => e.type === 'moved' && e.resumed));
  // students / soldiers / kids: disabled with a Korean reason
  const soldier = structuredClone(room);
  ch(soldier, id).military = { status: 'serving', turnsLeft: 3 };
  const rs = act(soldier, { type: 'spin', characterId: id }, { ints: [8] }); // 4 steps (halved) → passes the 찬스 광장
  assert.match(rs.room.turn.pending.options.find((o) => o.id === 'jobChange').desc, /복무/);
});

test('buffs until the next 찬스 광장: 월급 두 배 (용돈 too), 행운 주머니 ×1.5, 액땜 ½ loss, 성장 버프 +1 per stat gain', () => {
  const room = started();
  plainEra(room, 0);
  const id = cur(room);
  const c = ch(room, id);
  const buff = (bid) => ({ id: bid, name: bid, icon: '', desc: '', since: 1 });
  const pocket = data.balance.salary.pocketMoney.baby;
  // 용돈 × 2
  setTile(room, 0, 1, { type: 'salary', label: '월급날' });
  c.chanceBuff = buff('salaryX2');
  let r = act(room, { type: 'spin', characterId: id }, { ints: [1] });
  assert.equal(r.events.find((e) => e.type === 'salary').amount, pocket * 2);
  assert.equal(r.events.find((e) => e.type === 'salary').buff, 'salaryX2');
  // 행운 주머니: money tiles × 1.5
  setTile(room, 0, 1, { type: 'money', amount: 40 });
  c.chanceBuff = buff('moneyX15');
  r = act(room, { type: 'spin', characterId: id }, { ints: [1] });
  assert.equal(r.events.find((e) => e.type === 'moneyChanged').delta, 60);
  // 액땜: losses halved
  setTile(room, 0, 1, { type: 'loss', amount: 40 });
  c.chanceBuff = buff('lossShield');
  r = act(room, { type: 'spin', characterId: id }, { ints: [1] });
  assert.equal(r.events.find((e) => e.type === 'moneyChanged').delta, -20);
  // 성장 버프: a habit +3 → +4 (+1 bonus roll)
  setTile(room, 0, 1, { type: 'habit' });
  c.chanceBuff = buff('statUp');
  c.stats.int = 2;
  r = act(room, { type: 'spin', characterId: id }, { ints: [1] });
  const h = choose(r.room, 'academy', { nexts: [0.99] });
  assert.equal(ch(h.room, id).stats.int, 2 + data.balance.habits.options.find((o) => o.id === 'academy').gain + 1);
  // adult payday: salary + spouse salary doubled
  const adult = started();
  const y = adult.board.eras.findIndex((e) => e.id === 'young');
  toEra(adult, y);
  plainEra(adult, y);
  for (const x of adult.characters) settle(x);
  const a = ch(adult, cur(adult));
  setTile(adult, y, 1, { type: 'salary', label: '월급날' });
  const base = act(adult, { type: 'spin', characterId: a.id }, { ints: [1] }).events.find((e) => e.type === 'salary').amount;
  a.chanceBuff = buff('salaryX2');
  const doubled = act(adult, { type: 'spin', characterId: a.id }, { ints: [1] }).events.find((e) => e.type === 'salary').amount;
  assert.equal(doubled, base * 2);
});

// ---------- era clock ----------

test('era clock: skipped turns (재수 / 고향 휴식 / 사찰 수련) still consume the round; eras change on schedule', () => {
  let room = started({ config: { eraTurns: { baby: 2 } } });
  plainEra(room, 0);
  const [a, b, c] = room.turn.order;
  ch(room, b).skipTurns = 2;
  ch(room, b).skipReason = 'hometown';
  const seen = [];
  for (let i = 0; i < 8 && room.eraIndex === 0; i++) {
    const id = cur(room);
    seen.push(id);
    room = act(room, { type: 'spin', characterId: id }, { ints: [1] }).room;
  }
  assert.deepEqual(seen, [a, c, a, c], 'b sits both baby rounds out');
  assert.equal(room.eraIndex, 1, 'the era still ended after 2 rounds');
  assert.equal(ch(room, b).skipTurns, 0);
  assert.equal(ch(room, b).era, 'elem', 'the skipper moved along with everyone');
  assert.deepEqual(ch(room, b).position, { eraIndex: 1, route: 'main', index: 0 });
});

test('transition openings run once, in order: eraTransition → eraChanged ×n → news → 기초연금 → 노년 시세 → entry effects → lotto → turnStarted', () => {
  const room = started();
  const mid = room.board.eras.findIndex((e) => e.id === 'middle_age');
  toEra(room, mid);
  plainEra(room, mid);
  for (const c of room.characters) settle(c);
  const [x, y, z] = room.turn.order;
  Object.assign(ch(room, x), { money: 0, house: { id: 'villa', price: 700, value: 735, boughtTurn: 1 } });
  ch(room, y).money = 9000;
  ch(room, z).cards = [{ uid: 'k9', id: 'lotto' }];
  room.nextCardSeq = 9;
  room.erasOpened = room.board.eras.slice(0, mid + 1).map((e) => e.id);
  atEraEnd(room);
  const r = act(room, { type: 'spin', characterId: cur(room) }, { ints: [1] });
  const ts = types(r.events);
  const at = (t) => ts.indexOf(t);
  assert.ok(at('eraTransition') >= 0);
  const pension = r.events.findIndex((e) => e.reason === 'pension');
  assert.ok(at('eraTransition') < ts.lastIndexOf('eraChanged'));
  assert.ok(ts.lastIndexOf('eraChanged') < at('newsFlash') && at('newsFlash') < pension);
  assert.ok(pension < at('houseValueChanged') && at('houseValueChanged') < at('lottoDraw') && at('lottoDraw') < at('turnStarted'), ts.join(','));
  assert.equal(r.events.filter((e) => e.type === 'eraTransition').length, 1);
  assert.equal(r.events.filter((e) => e.type === 'eraChanged').length, 3);
  const tr = r.events.find((e) => e.type === 'eraTransition');
  assert.deepEqual([tr.toEraId, tr.final, tr.turns, tr.length], ['senior', true, null, room.board.eras.at(-1).tiles.length]);
  assert.equal(r.room.turn.eraRound, null, 'the final race has no era clock');
  assert.ok(r.room.characters.every((c) => c.era === 'senior'));
  // openings are once per era
  assert.equal(r.room.erasOpened.filter((e) => e === 'senior').length, 1);
  assert.equal(r.room.housingMarket.eraId, 'senior');
});

// ---------- final race ----------

test('인생역전섬 (final race): 조기 은퇴 = next place with half the prize, no bonus spins; 전 재산 올인 hit ×7 / miss → 빈곤 농장 (last place)', () => {
  let room = started({ chars: [['A', 'A1'], ['B', 'B1'], ['A', 'A2'], ['B', 'B2']] });
  const last = room.board.eras.length - 1;
  toEra(room, last);
  plainEra(room, last);
  for (const c of room.characters) settle(c);
  setTile(room, last, 1, { type: 'reversal', label: '인생역전섬' });
  const id = cur(room);
  let r = act(room, { type: 'spin', characterId: id }, { ints: [1] });
  const p = r.room.turn.pending;
  assert.equal(p.kind, 'reversal');
  assert.equal(p.title, '🏝️ 인생역전섬');
  const ids = p.options.map((o) => o.id);
  assert.ok(ids.includes('allIn') && ids.includes('retire'));
  const prizes = data.balance.goalPrizes;
  // retire
  const ret = choose(r.room, 'retire');
  const fin = ret.events.find((e) => e.type === 'finished');
  assert.deepEqual([fin.charId, fin.place, fin.retired, fin.cutin], [id, 1, 'early', false]);
  assert.equal(fin.prize, Math.round((prizes[0] * data.balance.retirePrizeMult) / 5) * 5);
  const sr = ret.events.find((e) => e.type === 'submapResult');
  assert.deepEqual([sr.result, sr.lineTag, sr.cutin], ['retire', 'retire_early', true]);
  assert.ok(!/\{/.test(sr.line ?? ''));
  // … and never takes a bonus spin afterwards
  let g = ret.room;
  for (let i = 0; i < 3; i++) {
    const next = cur(g);
    const res = act(g, { type: 'spin', characterId: next }, { ints: [1] });
    assert.ok(!res.events.some((e) => e.type === 'bonusSpin' && e.charId === id));
    g = res.room;
    while (g.turn.pending) g = choose(g, g.turn.pending.defaultOptionId).room;
  }
  // all-in: pick a number (plain random roll); miss → cash 0, last place, no prize
  const ai = choose(r.room, 'allIn');
  assert.equal(ai.room.turn.pending.kind, 'allIn');
  assert.deepEqual(ai.room.turn.pending.options.map((o) => o.number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const cash = ch(ai.room, id).money;
  const miss = choose(ai.room, '3', { ints: [7] });
  const f2 = miss.events.find((e) => e.type === 'finished');
  assert.deepEqual([f2.place, f2.retired, f2.prize], [4, 'bust', 0]);
  assert.equal(ch(miss.room, id).money, 0);
  assert.equal(miss.events.find((e) => e.type === 'submapResult').result, 'allInLose');
  const hit = choose(ai.room, '7', { ints: [7] });
  assert.equal(ch(hit.room, id).money, cash * data.balance.submaps.reversal.allIn.mult);
  assert.equal(ch(hit.room, id).finished, false);
  assert.equal(hit.events.find((e) => e.type === 'submapResult').lineTag, 'reversal_allin_win');
  // outside the final race the reversal has neither option
  const kids = started({ mode: 'kids' });
  plainEra(kids, 0);
  setTile(kids, 0, 1, { type: 'reversal' });
  const rk = act(kids, { type: 'spin', characterId: cur(kids) }, { ints: [1] });
  assert.ok(!rk.room.turn.pending.options.some((o) => ['allIn', 'retire'].includes(o.id)));
});

// ---------- 동아리 ----------

test('동아리: the first middle-school turn opens the club prompt; stat now, +1 on every middle / high payday; job offer weight', () => {
  const room = started();
  const mid = room.board.eras.findIndex((e) => e.id === 'middle');
  toEra(room, mid);
  plainEra(room, mid);
  room.turn.currentIndex = room.turn.order.length - 1;
  const id = room.turn.order[0];
  let r = act(room, { type: 'skip' });
  const p = r.room.turn.pending;
  assert.equal(p.kind, 'club');
  assert.deepEqual(p.options.map((o) => o.id), data.balance.clubs.options.map((o) => o.id));
  const band = data.balance.clubs.options.find((o) => o.id === 'band');
  const charm0 = ch(r.room, id).stats.charm;
  r = choose(r.room, 'band');
  assert.equal(ch(r.room, id).club, 'band');
  assert.equal(ch(r.room, id).stats.charm, charm0 + band.stats.charm);
  const pr = r.events.find((e) => e.type === 'promptResolved');
  assert.deepEqual([pr.kind, pr.result, pr.clubId, pr.cutin, pr.lineTag], ['club', 'joined', 'band', true, 'club']);
  assert.equal(r.room.turn.phase, 'awaitSpin');
  // training on a payday
  const r2 = structuredClone(r.room);
  setTile(r2, mid, 1, { type: 'salary', label: '월급날' });
  const pay = act(r2, { type: 'spin', characterId: id }, { ints: [1] });
  assert.ok(pay.events.some((e) => e.type === 'statChanged' && e.reason === 'club' && e.stat === band.train[0]));
  // asked once
  assert.equal(ch(pay.room, id).clubAsked, true);
});

// ---------- CPU ----------

test('CPU: 찬스 광장 / 동아리 / 올인 answers are enabled options; the aim counts forced stops (a payday ahead ends every longer move)', () => {
  const room = started({ config: { rouletteMode: 'skill' } });
  plainEra(room, 0);
  setTile(room, 0, 2, { type: 'pass' });
  const id = cur(room);
  const r = act(room, { type: 'spin', characterId: id }, { ints: [4] });
  const a = cpuDecide(r.room, id, data);
  assert.equal(a.type, 'choose');
  assert.ok(r.room.turn.pending.options.some((o) => o.id === a.optionId && !o.disabled));
  for (const kind of ['passTile', 'club', 'allIn']) assert.equal(typeof CPU_ANSWERS[kind], 'function', kind);
  // a payday 3 tiles ahead: every target ≥ 3 lands on it (same landing) — the scores tie there
  const s = structuredClone(room);
  plainEra(s, 0);
  setTile(s, 0, 3, { type: 'salary' });
  const scores = cpuAimScores(s, id, data);
  assert.ok(Math.abs(scores[8] - scores[10]) < 1e-9, JSON.stringify(scores));
  // a CPU-only lifetime game with short eras finishes; every CPU answer is legal
  const cfg = validateRoomConfig({ mode: 'lifetime', eraTurns: SHORT, finalLength: 20, holidays: true }).config;
  let g = { ...makeRoom({ seed: 3 }), config: cfg };
  for (let i = 0; i < 3; i++) g = { ...g, characters: [...g.characters, { id: `c${i + 1}`, seq: i + 1, name: `CPU${i}`, ownerSessionId: 'cpu', cpuPersonality: ['cautious', 'normal', 'bold'][i], avatar: { body: i % 2 ? 'girl' : 'boy' } }], nextCharSeq: i + 1 };
  g = startGame(g, { now: 0 }).room;
  for (let n = 0; n < 1500 && g.status === 'playing'; n++) {
    const p = g.turn.pending;
    const who = p ? p.forCharacterIds.find((x) => !Object.hasOwn(p.answers, x)) : cur(g);
    const action = cpuDecide(g, who, data);
    g = applyAction(g, action, { now: n }).room;
    g.log = [];
  }
  assert.equal(g.status, 'finished');
  assert.ok(g.characters.every((c) => c.finished));
});

// ---------- migration ----------

/** A save from before the loop maps: linear board (no loop / final), positions on it, a finished character. */
function legacyRoom() {
  const room = started();
  for (const e of room.board.eras) {
    delete e.loop;
    delete e.final;
    delete e.lap;
  }
  delete room.eraIndex;
  for (const k of ['eraRound', 'eraTurns', 'move', 'spun']) delete room.turn[k];
  const [a, b, c] = room.characters;
  Object.assign(a, { era: 'young', position: { eraIndex: 4, route: 'career', index: 3 }, route: 'career', routeHistory: [{ era: 'young', route: 'career', completed: false }] });
  Object.assign(b, { era: 'high', position: { eraIndex: 3, route: 'main', index: 2 } });
  Object.assign(c, { era: 'middle_age', position: { eraIndex: 5, route: 'main', index: 1 } });
  delete a.laps;
  return room;
}

test('migration: a linear-board save moves to the loop board at the start of the most advanced era (engine + runner restore)', async () => {
  const legacy = legacyRoom();
  assert.equal(isLoopBoard(legacy.board), false);
  const m = migrateLoopBoard(legacy, { now: 5 });
  assert.equal(m.migrated, true);
  assert.ok(isLoopBoard(m.room.board));
  const mid = m.room.board.eras.findIndex((e) => e.id === 'middle_age');
  assert.equal(m.room.eraIndex, mid);
  assert.deepEqual([m.room.turn.eraRound, m.room.turn.eraTurns], [1, m.room.board.eras[mid].turns]);
  for (const c of m.room.characters) {
    assert.deepEqual(c.position, { eraIndex: mid, route: 'main', index: 0 });
    assert.equal(c.era, 'middle_age');
    assert.equal(c.route, null);
    assert.equal(c.laps, 0);
  }
  assert.ok(m.room.characters[0].routeHistory.every((h) => h.completed));
  assert.ok(m.logs.some((l) => /순환 맵/.test(l.text)));
  assert.equal(migrateLoopBoard(m.room).migrated, false, 'idempotent');
  // the engine migrates on the fly (an old save restored without the runner)
  const r = applyAction(legacy, { type: 'spin', characterId: cur(legacy) }, { now: 6 });
  assert.ok(isLoopBoard(r.room.board));
  assert.equal(r.room.eraIndex, mid);
  // the runner migrates every playing legacy room at boot
  const tmp = await tempDir();
  try {
    const store = new RoomStore({ dataDir: tmp.dir, debounceMs: 1 });
    await store.load();
    const created = store.createRoom(legacy.config);
    store.put({ ...legacyRoom(), id: created.id, code: created.code });
    const runner = new GameRunner(store, { cpuDelayMs: 0 });
    runner.restore();
    const live = store.getRoom(created.id);
    assert.ok(isLoopBoard(live.board));
    assert.equal(live.eraIndex, mid);
    runner.stop();
    await store.close();
  } finally {
    await tmp.cleanup();
  }
});

// ---------- presentation / view / meta ----------

test('presentation + view: eraTransition = the cut-in with the MC studio; eraChanged quiet; public loop fields; /api/meta', async () => {
  let room = started();
  plainEra(room, 0);
  atEraEnd(room);
  const r = act(room, { type: 'spin', characterId: cur(room) }, { ints: [1] });
  const tr = r.events.find((e) => e.type === 'eraTransition');
  assert.deepEqual([tr.cutin, tr.mcStudio, tr.mcKey, tr.lineTag], [true, true, 'eraElem', 'era_elem']);
  assert.ok(tr.line && !/\{/.test(tr.line));
  for (const e of r.events.filter((x) => x.type === 'eraChanged')) assert.deepEqual([e.cutin, e.line, e.mc], [false, null, undefined]);
  room = r.room;
  ch(room, cur(room)).chanceBuff = { id: 'statUp', name: '성장 버프', icon: '📈', desc: '', since: 1 };
  const v = viewFor(room, 'A');
  assert.equal(v.eraIndex, 1);
  assert.deepEqual([v.turn.eraRound, v.turn.eraTurns], [1, room.board.eras[1].turns]);
  assert.ok(v.board.eras.every((e) => e.loop || e.final));
  assert.equal(v.characters.find((c) => c.id === cur(room)).chanceBuff.id, 'statUp');
  assert.ok(v.characters.every((c) => typeof c.laps === 'number'));
  // minTurns: route eras ≥ 3, the final era → null
  assert.deepEqual([minTurnsTable().lifetime.young, minTurnsTable().lifetime.senior, minTurnsTable().kids.high], [3, null, 1]);
  const tmp = await tempDir();
  const srv = await startServer({ port: 0, host: '127.0.0.1', dataDir: tmp.dir, debounceMs: 5, adminPassword: 'pw' });
  try {
    const meta = (await httpCall(srv.url, 'GET', '/api/meta')).json;
    assert.equal(meta.board.loop.lapPerTurn, 5.4);
    assert.deepEqual(meta.board.loop.payday, { min: 18, max: 25 });
    assert.equal(meta.board.tileTypes.pass.icon, '🎪');
    assert.equal(meta.board.tileTypes.salary.name, '월급날');
    assert.equal(meta.minTurns.lifetime.young, 3);
    assert.deepEqual(meta.finalLength, { min: 20, max: 80, default: 40 });
    assert.ok(meta.balance.chanceBuffs.length >= 4 && meta.balance.passTile.wish && meta.balance.clubs.options.length >= 4);
  } finally {
    await srv.close();
    await tmp.cleanup();
  }
});
