// Stage 8 — romance & family: data, 고교 전원 만남, 만남 / 데이트 / 프로포즈, 결혼식 축의금, 맞벌이, 출산 (max 4),
// 자녀 성장 + 용돈, presentation / MC, a random lifetime game, restore mid-marriage and pre-Stage-8 saves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameData } from '../server/data/index.js';
import { applyAction, startGame } from '../server/game/engine.js';
import { createTx } from '../server/game/effects.js';
import {
  CHILD_STAGES,
  GROWTH_STEPS,
  TRAITS,
  allowanceAmount,
  bearChild,
  birthChance,
  growChildrenOnEra,
  growChildrenOnSpin,
  proposeChance,
  schoolMeet,
  spouseSalary,
} from '../server/game/family.js';
import { paySalary } from '../server/game/jobs.js';
import { resolvePrompt } from '../server/game/prompts.js';
import { resolveTile } from '../server/game/spaces.js';
import { CUTIN_TYPES, EVENT_TYPES, attachMc, decorateEvents, isBoundary } from '../server/game/presentation.js';
import { createRng } from '../server/game/rng.js';
import { viewFor } from '../server/game/view.js';
import { addCharacter, joinRoom } from '../server/game/lobby.js';
import { makeRoom } from './helpers.js';

const data = gameData();
const P = data.partners;
const avatars = data.avatars;

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
const ch = (room, id) => room.characters.find((c) => c.id === id);
const cur = (room) => room.turn.order[room.turn.currentIndex];
const partnerOf = (over = {}) => ({ id: 'pt90', name: '서연', trait: 'int', stars: 2, body: 'girl', avatar: { ...avatars.default, body: 'girl' }, ...over });
/** Every character grown up in `era` with a job and cash; a tx over a clone. */
function sandbox({ era = 'young', rng = {}, news = {}, money = 1000 } = {}) {
  const room = structuredClone(started());
  room.news = news;
  room.erasOpened = room.board.eras.map((e) => e.id);
  room.schoolMeetDone = true;
  for (const c of room.characters) {
    Object.assign(c, { era, money, careerDone: true, military: { status: 'done', turnsLeft: 0 }, job: { id: 'office_worker', rank: 1, exp: 0, injured: 0 }, stats: { int: 5, str: 2, charm: 3, luck: 2 } });
  }
  const tx = createTx(room, { rng: fixedRng(rng), now: 0, data });
  return { room, tx, c: room.characters[0], others: room.characters.slice(1) };
}
const heart = (tx, c) => resolveTile(tx, c, { id: 'young:love:3', type: 'heart', route: 'love' });
const answer = (tx, c, optionId) => {
  tx.room.turn.pending.answers[c.id] = optionId;
  resolvePrompt(tx);
};
const types = (tx) => tx.events.map((e) => e.type);
const isKorean = (s) => /^[가-힣]+$/.test(s);

// ---------- data ----------

test('partners.json: 4 traits, ★1–4, ≥ 20 Korean names per body, dates / outings / costs; board hearts are live', () => {
  assert.deepEqual(Object.keys(P.traits), TRAITS);
  for (const t of TRAITS) assert.ok(P.traits[t].name.endsWith('형') && P.traits[t].icon, t);
  assert.deepEqual(Object.keys(P.stars), ['1', '2', '3', '4']);
  let prev = 0;
  for (const s of Object.values(P.stars)) {
    assert.ok(s.salary > prev && s.allowanceMult >= 1 && s.weight > 0);
    prev = s.salary;
  }
  for (const body of ['boy', 'girl']) {
    assert.ok(P.names[body].length >= 20, body);
    assert.equal(new Set(P.names[body]).size, P.names[body].length, `${body}: unique`);
    for (const n of P.names[body]) assert.ok(isKorean(n) && n.length <= 3, n);
  }
  for (const k of ['meet', 'dateGain', 'matchBonus', 'proposeAt', 'max']) assert.ok(Number.isFinite(P.affection[k]), k);
  assert.ok(P.affection.meet < P.affection.proposeAt && P.affection.proposeAt <= P.affection.max);
  for (const d of P.dates) assert.ok(d.id && d.name && d.icon && (d.trait === null || TRAITS.includes(d.trait)) && d.cost >= 0 && d.gain > 0, d.id);
  for (const t of TRAITS) assert.ok(P.dates.some((d) => d.trait === t), `a date for ${t}`);
  for (const o of P.outings) assert.ok(o.id && o.text.includes('{name}') && o.money.length === 2, o.id);
  assert.equal(P.children.max, 4);
  for (const key of ['hair', 'outfit']) for (const list of Object.values(P.avatar[key])) for (const id of list) assert.ok(avatars.parts[key].some((o) => o.id === id), `${key} ${id}`);
  // board: heart / house tiles are live; the love route is the heart route
  assert.ok(!('heart' in data.board.placeholders) && !('house' in data.board.placeholders));
  const w = (pool, type) => pool.find((t) => t.type === type)?.weight ?? 0;
  const rp = data.board.routePools;
  assert.ok(w(rp.love.pool, 'heart') > w(rp.career.pool, 'heart') && w(rp.love.pool, 'heart') > w(rp.money.pool, 'heart'));
  assert.ok(w(rp.money.pool, 'house') > 0 && w(data.board.eras.senior.pool, 'house') > 0);
  assert.ok(w(data.board.eras.high.pool, 'heart') > 0);
  assert.equal(data.news.news.find((n) => n.id === 'birth_bonus').effects.birthBonus, 300);
});

test('startGame: every character gets an empty family record; viewFor exposes it (+ houseOwners / housingMarket)', () => {
  const room = started();
  for (const c of room.characters) {
    assert.deepEqual(c.love, { candidates: [], partner: null, affection: 0, dates: 0 });
    assert.deepEqual([c.spouse, c.children, c.house, c.houseSwaps], [null, [], null, 0]);
  }
  assert.deepEqual([room.nextPartnerSeq, room.nextChildSeq, room.schoolMeetDone, room.housingMarket], [0, 0, false, null]);
  const v = viewFor(room, 'B');
  assert.deepEqual(v.characters[0].love, room.characters[0].love);
  assert.deepEqual(v.houseOwners, {});
  assert.equal(v.housingMarket, null);
});

// ---------- 고교 전원 만남 ----------

test('schoolMeet: the first character entering 고등학생 gives every single unfinished character a ★1 partner, once', () => {
  let room = structuredClone(started());
  const [c1, c2, c3] = room.turn.order.map((id) => ch(room, id));
  c2.love.partner = partnerOf({ id: 'pt50' }); // already dating → skipped
  c3.finished = true; // finished → skipped
  const middle = room.board.eras.findIndex((e) => e.id === 'middle');
  c1.position = { eraIndex: middle, route: 'main', index: room.board.eras[middle].tiles.length - 1 };
  c1.stats = { int: 6, str: 2, charm: 2, luck: 2 };
  const r = applyAction(room, { type: 'spin', characterId: c1.id }, { rng: fixedRng({ ints: [1] }), now: 5 });
  const ev = r.events.filter((e) => e.type === 'schoolMeet');
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0].pairs.map((p) => p.charId), [c1.id]);
  const p = ev[0].pairs[0].partner;
  assert.deepEqual([p.stars, p.trait, p.body], [1, 'int', 'girl']);
  assert.deepEqual(Object.keys(p.avatar), avatars.order, 'a full sanitized avatar');
  assert.equal(p.avatar.body, 'girl');
  const a1 = ch(r.room, c1.id);
  assert.deepEqual(a1.love.partner, p);
  assert.equal(a1.love.affection, P.affection.meet + P.affection.matchBonus, '지력형 partner for a 지력-top character');
  assert.equal(ch(r.room, c2.id).love.partner.id, 'pt50');
  assert.equal(r.room.schoolMeetDone, true);
  assert.equal(ev[0].cutin, true);
  assert.equal(ev[0].scene, 'school');
  assert.ok(ev[0].pairs[0].line && !/\{/.test(ev[0].pairs[0].line));
  // once: a later entrant gets nothing
  room = r.room;
  const tx = createTx(room, { rng: fixedRng(), now: 0, data });
  ch(room, c2.id).love.partner = null;
  assert.equal(schoolMeet(tx, 'high'), null);
  assert.equal(tx.events.length, 0);
});

// ---------- 만남 / 데이트 / 프로포즈 ----------

test('meet: a single character on a heart tile gets 2 candidates + pass; picking one → met, affection = meet (+match)', () => {
  const { tx, c } = sandbox();
  assert.equal(heart(tx, c), 'prompt');
  const p = tx.room.turn.pending;
  assert.equal(p.kind, 'meet');
  assert.deepEqual(p.options.map((o) => o.id.split(':')[0]), ['meet', 'meet', 'pass']);
  const [o1, o2] = p.options;
  for (const o of [o1, o2]) {
    assert.ok(o.partnerId && TRAITS.includes(o.trait) && o.stars >= 1 && o.stars <= 4 && o.salary === P.stars[o.stars].salary);
    assert.equal(o.partner.id, o.partnerId);
    assert.deepEqual(Object.keys(o.partner.avatar), avatars.order);
  }
  assert.notEqual(o1.partner.name, o2.partner.name);
  assert.deepEqual(c.love.candidates.map((x) => x.id), [o1.partnerId, o2.partnerId], 'candidates visible while the prompt is open');
  assert.equal(p.defaultOptionId, o1.id, 'default = the 찰떡궁합 / higher-★ candidate');
  assert.equal(o1.match, true, '지력형 matches the 지력-top character');
  answer(tx, c, o2.id);
  const met = tx.events.find((e) => e.type === 'met');
  assert.equal(met.partner.id, o2.partnerId);
  assert.equal(c.love.partner.id, o2.partnerId);
  assert.equal(c.love.affection, P.affection.meet + (o2.match ? P.affection.matchBonus : 0));
  assert.deepEqual(c.love.candidates, []);
  assert.ok(!types(tx).includes('promptResolved'), 'met is the anchor');
  // pass
  const s2 = sandbox();
  heart(s2.tx, s2.c);
  answer(s2.tx, s2.c, 'pass');
  assert.equal(s2.c.love.partner, null);
  assert.equal(s2.tx.events.find((e) => e.type === 'promptResolved').result, 'pass');
  // kids eras before 고등학생: no meeting
  const s3 = sandbox({ era: 'middle' });
  assert.equal(heart(s3.tx, s3.c), null);
});

test('date: 5 options (costs × era scale, disabled when broke), trait match bonus; reaching proposeAt opens 프로포즈', () => {
  const { tx, c } = sandbox({ money: 25 });
  c.love.partner = partnerOf({ trait: 'int' });
  c.love.affection = 30;
  heart(tx, c);
  const p = tx.room.turn.pending;
  assert.equal(p.kind, 'date');
  assert.deepEqual(p.options.map((o) => o.dateId), P.dates.map((d) => d.id));
  const scale = P.costs.scale.young;
  for (const o of p.options) {
    const d = P.dates.find((x) => x.id === o.dateId);
    assert.equal(o.cost, d.cost ? Math.max(5, Math.round((d.cost * scale) / 5) * 5) : 0);
    assert.equal(o.match, d.trait === 'int');
    assert.equal(o.gain, d.gain + (o.match ? P.affection.matchBonus : 0));
    assert.equal(!!o.disabled, o.cost > 25, o.id);
  }
  assert.equal(p.defaultOptionId, 'date:library', 'default = the matched (affordable) date');
  answer(tx, c, 'date:library');
  const dated = tx.events.find((e) => e.type === 'dated');
  assert.deepEqual([dated.dateId, dated.match, dated.gain, dated.affection], ['library', true, 30, 60]);
  assert.equal(c.money, 5);
  assert.equal(c.love.dates, 1);
  assert.equal(tx.events.find((e) => e.type === 'promptResolved').kind, 'date', 'date result cut-in');
  assert.equal(tx.room.turn.pending.kind, 'propose', 'affection ≥ proposeAt → 프로포즈 right away');
  // high school: no proposal
  const h = sandbox({ era: 'high' });
  h.c.love.partner = partnerOf();
  h.c.love.affection = 45;
  heart(h.tx, h.c);
  answer(h.tx, h.c, 'date:library');
  assert.equal(h.c.love.affection, 75);
  assert.equal(h.tx.room.turn.pending, null);
  // a heart with affection ≥ proposeAt → the propose prompt directly
  const s = sandbox();
  s.c.love.partner = partnerOf();
  s.c.love.affection = 50;
  heart(s.tx, s.c);
  assert.equal(s.tx.room.turn.pending.kind, 'propose');
});

test('propose: chance formula; seeded success → wedding (축의금 conserved, capped at cash, cost); fail → affection drop', () => {
  const { tx, c, others } = sandbox();
  c.love.partner = partnerOf({ stars: 3, trait: 'int' });
  c.love.affection = 70;
  c.stats = { int: 6, str: 1, charm: 5, luck: 3 };
  const pc = P.propose;
  const want = Math.min(pc.max, pc.base + (70 - P.affection.proposeAt) * pc.perAffection + pc.charm * 5 + pc.luck * 3 + pc.match);
  assert.ok(Math.abs(proposeChance(c, data) - want) < 1e-9);
  heart(tx, c);
  const opt = tx.room.turn.pending.options;
  assert.deepEqual(opt.map((o) => o.id), ['propose', 'steady']);
  assert.ok(Math.abs(opt[0].chance - want) < 1e-9);
  assert.equal(tx.room.turn.pending.defaultOptionId, 'propose');
  others[0].money = 7; // pays what they have
  const before = new Map(tx.room.characters.map((x) => [x.id, x.money]));
  tx.rng = fixedRng({ nexts: [0] });
  answer(tx, c, 'propose');
  const proposed = tx.events.find((e) => e.type === 'proposed');
  assert.equal(proposed.success, true);
  const married = tx.events.find((e) => e.type === 'married');
  const per = Math.round((P.costs.weddingGift * P.costs.scale.young) / 5) * 5;
  assert.deepEqual(married.gifts, [{ fromId: others[0].id, amount: 7 }, { fromId: others[1].id, amount: per }]);
  assert.equal(married.total, 7 + per);
  assert.equal(married.spouse.name, '서연');
  assert.deepEqual([c.spouse.id, c.spouse.salary, c.spouse.stars], ['pt90', P.stars[3].salary, 3]);
  assert.equal(c.love.partner, null);
  const cost = Math.round((P.costs.wedding * P.costs.scale.young) / 5) * 5;
  assert.equal(c.money, before.get(c.id) + married.total - cost);
  assert.equal(others[0].money, 0);
  assert.equal(others[1].money, before.get(others[1].id) - per);
  const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);
  assert.equal(sum(new Map(tx.room.characters.map((x) => [x.id, x.money]))), sum(before) - cost, '축의금 only moves money');
  assert.ok(types(tx).indexOf('proposed') < types(tx).indexOf('married'));
  // fail
  const f = sandbox();
  f.c.love.partner = partnerOf();
  f.c.love.affection = 55;
  heart(f.tx, f.c);
  f.tx.rng = fixedRng({ nexts: [0.999] });
  answer(f.tx, f.c, 'propose');
  assert.equal(f.tx.events.find((e) => e.type === 'proposed').success, false);
  assert.equal(f.c.spouse, null);
  assert.equal(f.c.love.affection, 55 - P.affection.failDrop);
  assert.ok(!types(f.tx).includes('married'));
  // steady: free affection
  const st = sandbox();
  st.c.love.partner = partnerOf();
  st.c.love.affection = 55;
  heart(st.tx, st.c);
  answer(st.tx, st.c, 'steady');
  assert.equal(st.c.love.affection, 55 + P.affection.steadyGain);
  assert.equal(st.tx.events.find((e) => e.type === 'dated').dateId, 'steady');
});

test('spouse salary: paid on salary tiles with the job salary (salary.spouseAmount = ★ salary × era mult)', () => {
  const { tx, c } = sandbox({ era: 'middle_age' });
  c.spouse = { ...partnerOf({ stars: 4 }), salary: P.stars[4].salary, marriedTurn: 1 };
  const want = Math.round((P.stars[4].salary * data.balance.jobs.salaryEraMult.middle_age) / 5) * 5;
  assert.equal(spouseSalary(tx, c), want);
  const money0 = c.money;
  const job = paySalary(tx, c);
  const sal = tx.events.find((e) => e.type === 'salary');
  assert.equal(sal.spouseAmount, want);
  const spouse = tx.events.find((e) => e.type === 'moneyChanged' && e.reason === 'spouseSalary');
  assert.equal(spouse.delta, want);
  assert.equal(c.money, money0 + job + want);
  // single → no spouseAmount
  const s = sandbox();
  paySalary(s.tx, s.c);
  assert.equal(s.tx.events.find((e) => e.type === 'salary').spouseAmount, undefined);
});

// ---------- children ----------

test('birth: married heart tile → childBorn (talent / trait / avatar), 출산장려금 news; max 4 children → family outing', () => {
  const { tx, c } = sandbox({ news: { young: 'birth_bonus' } });
  c.spouse = { ...partnerOf({ trait: 'int' }), salary: 70, marriedTurn: 1 };
  c.love.affection = 60;
  const bp = P.birth;
  assert.ok(Math.abs(birthChance(c, data) - Math.min(bp.max, bp.base + 60 * bp.perAffection)) < 1e-9);
  // rolls: birth 0 → born; genius 0.3 < 0.15 + 0.25 (match) + luck 2 × 0.01 → genius
  tx.rng = fixedRng({ nexts: [0, 0.3, 0.9, 0.9] });
  const money0 = c.money;
  assert.equal(heart(tx, c), null);
  const born = tx.events.find((e) => e.type === 'childBorn');
  const kid = born.child;
  assert.deepEqual([kid.id, kid.talent, kid.stage, kid.body], ['ch1', 'genius', 'baby', 'girl']);
  assert.ok(TRAITS.includes(kid.trait));
  assert.deepEqual(Object.keys(kid.avatar), avatars.order);
  assert.ok(P.avatar.outfit.child.includes(kid.avatar.outfit), 'child outfit');
  assert.ok([c.avatar.hairColor, 'black'].includes(kid.avatar.hairColor), 'inherits a parent hair colour');
  assert.equal(born.spouse.id, 'pt90');
  assert.equal(c.children.length, 1);
  const cost = Math.round((P.costs.birth * P.costs.scale.young) / 5) * 5;
  assert.equal(c.money, money0 - cost + 300, '출산 비용 − + 장려금 300');
  // without 찰떡궁합 the same roll is a normal child
  const n = sandbox();
  n.c.spouse = { ...partnerOf({ trait: 'luck' }), salary: 70, marriedTurn: 1 };
  n.tx.rng = fixedRng({ nexts: [0.3] });
  assert.equal(bearChild(n.tx, n.c).talent, 'normal');
  // max 4 → no birth, outing (money / stat, affection +)
  const m = sandbox();
  m.c.spouse = { ...partnerOf(), salary: 70, marriedTurn: 1 };
  m.c.children = [1, 2, 3, 4].map((i) => ({ id: `ch${i}`, name: `아이${i}`, trait: 'int', talent: 'normal', stage: 'baby', bornTurn: 1, avatar: avatars.default, body: 'boy', growth: 0, turns: 0 }));
  m.c.love.affection = 40;
  assert.equal(birthChance(m.c, data), 0);
  m.tx.rng = fixedRng({ nexts: [0, 0] });
  heart(m.tx, m.c);
  assert.equal(m.c.children.length, 4);
  assert.ok(!types(m.tx).includes('childBorn'));
  assert.equal(m.c.love.affection, 40 + P.affection.familyGain);
  assert.ok(m.tx.events.some((e) => e.type === 'moneyChanged' && e.reason === 'family'));
  // senior: no more births
  const sen = sandbox({ era: 'senior' });
  sen.c.spouse = { ...partnerOf(), salary: 70, marriedTurn: 1 };
  assert.equal(birthChance(sen.c, data), 0);
});

test('children grow 돌잔치 → 입학 → 수능 → 취업 (era entries + every growTurns spins); 용돈 on salary tiles', () => {
  const { tx, c, others } = sandbox({ era: 'middle_age' });
  c.spouse = { ...partnerOf({ stars: 4 }), salary: 140, marriedTurn: 1 };
  tx.rng = fixedRng({ nexts: [0.99] }); // normal talent
  const kid = bearChild(tx, c);
  assert.equal(kid.talent, 'normal');
  assert.deepEqual(GROWTH_STEPS.map((s) => s.kind), ['dol', 'school', 'exam', 'job']);
  assert.deepEqual(CHILD_STAGES, ['baby', 'kid', 'teen', 'adult']);
  tx.events.length = 0;
  // era entry → 돌잔치: gifts from every other character (conserved)
  const before = tx.room.characters.reduce((a, x) => a + x.money, 0);
  growChildrenOnEra(tx, c);
  const dol = tx.events.find((e) => e.type === 'childGrew');
  const per = Math.round((P.children.dolGift * P.costs.scale.middle_age) / 5) * 5;
  assert.deepEqual([dol.kind, dol.stage, dol.amount, dol.gifts.length], ['dol', 'kid', per * others.length, others.length]);
  assert.equal(tx.room.characters.reduce((a, x) => a + x.money, 0), before);
  assert.equal(dol.child.id, kid.id);
  // spins: every growTurns → next step
  tx.events.length = 0;
  for (let i = 0; i < P.children.growTurns - 1; i++) growChildrenOnSpin(tx, c);
  assert.ok(!types(tx).includes('childGrew'));
  const m0 = c.money;
  growChildrenOnSpin(tx, c);
  const school = tx.events.find((e) => e.type === 'childGrew');
  const fee = Math.round((P.children.schoolCost * P.costs.scale.middle_age) / 5) * 5;
  assert.deepEqual([school.kind, school.stage, school.amount], ['school', 'teen', -fee]);
  assert.equal(c.money, m0 - fee);
  // exam: normal child, roll < collegeChance → 대학 축하금
  tx.rng = fixedRng({ nexts: [0.1] });
  tx.events.length = 0;
  growChildrenOnEra(tx, c);
  const exam = tx.events.find((e) => e.type === 'childGrew');
  assert.deepEqual([exam.kind, exam.result, exam.amount], ['exam', 'college', Math.round((P.children.examGift.college * P.costs.scale.middle_age) / 5) * 5]);
  tx.events.length = 0;
  growChildrenOnEra(tx, c);
  const job = tx.events.find((e) => e.type === 'childGrew');
  assert.deepEqual([job.kind, job.stage], ['job', 'adult']);
  const allowance = Math.round((P.children.allowance * 1 * P.stars[4].allowanceMult * data.balance.jobs.salaryEraMult.middle_age) / 5) * 5;
  assert.equal(job.amount, allowance);
  assert.equal(allowanceAmount(tx, c, c.children[0]), allowance);
  // grown up: no more steps
  tx.events.length = 0;
  growChildrenOnEra(tx, c);
  for (let i = 0; i < 5; i++) growChildrenOnSpin(tx, c);
  assert.ok(!types(tx).includes('childGrew'));
  // salary tile → allowance event + money
  tx.events.length = 0;
  paySalary(tx, c);
  const al = tx.events.find((e) => e.type === 'allowance');
  assert.deepEqual([al.childId, al.amount], [kid.id, allowance]);
  assert.ok(tx.events.some((e) => e.type === 'moneyChanged' && e.reason === 'allowance' && e.delta === allowance));
  // a genius child doubles it
  c.children[0].talent = 'genius';
  assert.equal(allowanceAmount(tx, c, c.children[0]), Math.round((P.children.allowance * P.children.talentMult.genius * P.stars[4].allowanceMult * data.balance.jobs.salaryEraMult.middle_age) / 5) * 5);
});

test('engine: a married parent entering a new era grows the children and rolls a birth; spins grow children too', () => {
  const room = structuredClone(started());
  room.erasOpened = room.board.eras.map((e) => e.id);
  const c = ch(room, cur(room));
  const young = room.board.eras.findIndex((e) => e.id === 'young');
  Object.assign(c, { era: 'young', route: 'career', position: { eraIndex: young, route: 'main', index: 1 }, careerDone: true, military: { status: 'done', turnsLeft: 0 }, job: { id: 'teacher', rank: 1, exp: 0, injured: 0 } });
  c.spouse = { ...partnerOf(), salary: 70, marriedTurn: 1 };
  c.children = [{ id: 'ch1', name: '하윤', trait: 'int', talent: 'normal', stage: 'baby', bornTurn: 1, avatar: avatars.default, body: 'girl', growth: 0, turns: 0 }];
  room.nextChildSeq = 1;
  // merge of young → 1 step into middle_age (era entry)
  const r = applyAction(room, { type: 'spin', characterId: c.id }, { rng: fixedRng({ ints: [1], nexts: [0, 0.99] }), now: 5 });
  const evs = r.events.map((e) => e.type);
  assert.ok(evs.includes('eraChanged') && evs.includes('childGrew') && evs.includes('childBorn'), evs.join(','));
  const a = ch(r.room, c.id);
  assert.equal(a.children[0].stage, 'kid');
  assert.equal(a.children.length, 2);
  assert.equal(r.events.find((e) => e.type === 'childGrew').cutin, true, '돌잔치 cut-in');
  assert.equal(r.events.find((e) => e.type === 'childBorn').mcKey, 'birth');
});

// ---------- presentation / MC ----------

test('presentation + MC: Stage 8 types registered; anchors vs chips; lines filled; MC only on real outcomes', () => {
  for (const t of ['met', 'dated', 'proposed', 'married', 'schoolMeet', 'childBorn', 'childGrew', 'allowance', 'houseBought', 'houseSold', 'houseValueChanged']) assert.ok(EVENT_TYPES.includes(t), t);
  for (const t of ['met', 'proposed', 'married', 'schoolMeet', 'childBorn', 'houseBought', 'houseValueChanged']) assert.ok(CUTIN_TYPES.has(t), t);
  for (const t of ['dated', 'allowance', 'houseSold', 'childGrew']) assert.ok(!CUTIN_TYPES.has(t), t);
  assert.equal(isBoundary({ type: 'childGrew', kind: 'dol' }), true);
  assert.equal(isBoundary({ type: 'childGrew', kind: 'school' }), false);
  assert.equal(isBoundary({ type: 'allowance' }), false);
  for (const tag of ['meet', 'date', 'propose', 'propose_ok', 'propose_fail', 'wedding', 'birth', 'dol', 'house_buy', 'market_up', 'market_down', 'allowance', 'school_meet', 'house_sell']) {
    assert.ok(data.lines.tags[tag]?.length >= 5, tag);
  }
  for (const k of ['marriage', 'proposeFail', 'birth', 'house', 'market', 'schoolMeet']) assert.ok(data.mc.situations[k] && data.lines.mc[k], k);
  assert.deepEqual(data.mc.tileSituations, {});
  const room = structuredClone(started());
  const c = room.characters[0];
  c.love.partner = partnerOf();
  const kid = { id: 'ch1', name: '하윤', talent: 'normal', stage: 'kid' };
  c.children = [kid];
  const evs = [
    { type: 'landed', charId: c.id, tileType: 'heart', tileId: 'x', route: 'love' },
    { type: 'married', charId: c.id, spouse: partnerOf(), gifts: [], total: 0, cost: 0 },
    { type: 'moneyChanged', charId: c.id, delta: 40, reason: 'weddingGift', money: 1, debt: 0 },
    { type: 'childGrew', charId: c.id, childId: 'ch1', kind: 'school', stage: 'teen', amount: -40, child: kid },
    { type: 'proposed', charId: c.id, partner: partnerOf(), success: false, chance: 0.5 },
    { type: 'childBorn', charId: c.id, child: kid },
    { type: 'allowance', charId: c.id, childId: 'ch1', amount: 30 },
    { type: 'houseBought', charId: c.id, houseId: 'villa', price: 700, tradeIn: 0 },
    { type: 'houseSold', charId: c.id, houseId: 'oneroom', value: 300, amount: 210 },
    { type: 'houseValueChanged', eraId: 'senior', mult: 0.9, changes: [{ charId: c.id, houseId: 'villa', before: 700, after: 630 }] },
    { type: 'schoolMeet', eraId: 'high', pairs: [{ charId: c.id, partner: partnerOf() }] },
  ];
  room.mcState = { cool: 0, eras: ['baby'], firstSpin: true };
  decorateEvents(evs, { room, data: { ...data, mc: { ...data.mc, frequency: { ...data.mc.frequency, normal: { ...data.mc.frequency.many, medium: 1, minor: 1, cooldown: 0 } } } }, seed: 3 });
  const by = (t) => evs.find((e) => e.type === t);
  assert.equal(by('landed').cutin, false, 'the wedding takes over the heart landing');
  assert.equal(by('married').lineTag, 'wedding');
  assert.equal(by('married').scene, 'wedding-hall');
  assert.equal(by('childGrew').cutin, false);
  assert.equal(by('proposed').lineTag, 'propose_fail');
  assert.equal(by('childBorn').scene, 'hospital');
  assert.equal(by('houseBought').scene, 'house');
  assert.equal(by('houseValueChanged').lineTag, 'market_down');
  assert.ok(by('houseValueChanged').changes[0].line);
  for (const e of evs) {
    assert.ok(data.lines.tags[e.lineTag], `${e.type}: ${e.lineTag}`);
    assert.ok(e.line && !/\{\w+\}/.test(e.line), `${e.type}: "${e.line}"`);
    for (const l of e.mc ?? []) assert.ok(!/\{\w+\}/.test(l.line), `${e.type} mc "${l.line}"`);
  }
  assert.deepEqual(
    Object.fromEntries(evs.filter((e) => e.mcKey).map((e) => [e.type, e.mcKey])),
    { married: 'marriage', proposed: 'proposeFail', childBorn: 'birth', houseBought: 'house', houseValueChanged: 'market', schoolMeet: 'schoolMeet' },
  );
  assert.equal(by('houseValueChanged').mcStudio, true);
  // a heart landing alone never gets marriage / birth MC lines
  const alone = [{ type: 'landed', charId: c.id, tileType: 'heart', tileId: 'y' }, { type: 'log', text: 'x', tone: 'love', charId: c.id }];
  attachMc(alone, { room, data, seed: 1 });
  assert.ok(!['marriage', 'birth', 'house'].includes(alone[0].mcKey));
});

// ---------- full games / restore / migration ----------

test('full random lifetime games: family + house events, known types, filled lines; love-route marriages happen', () => {
  const seen = new Set();
  let married = 0;
  for (const seed of [3, 12]) {
    let room = started({ seed, chars: [['A', 'A1'], ['B', 'B1'], ['A', 'A2'], ['B', 'B2']] });
    const rng = createRng(seed);
    for (let i = 0; i < 3000 && room.status === 'playing'; i++) {
      const p = room.turn.pending;
      let action;
      if (p) {
        const opts = p.options.filter((o) => !o.disabled);
        const pick = p.kind === 'routeChoice' ? 'love' : ['meet', 'date', 'propose'].includes(p.kind) ? p.defaultOptionId : p.kind === 'house' ? (opts.find((o) => o.id !== 'pass') ?? opts[0]).id : rng.pick(opts).id;
        action = { type: 'choose', characterId: p.forCharacterIds.find((x) => !Object.hasOwn(p.answers, x)), promptId: p.promptId, optionId: pick };
      } else action = { type: 'spin', characterId: cur(room) };
      const r = applyAction(room, action, { now: i * 1000 });
      room = r.room;
      room.log = [];
      for (const e of r.events) {
        seen.add(e.type);
        assert.ok(EVENT_TYPES.includes(e.type), e.type);
        if (e.type === 'chose' || e.type === 'betPlaced') continue;
        assert.ok(data.lines.tags[e.lineTag], `${e.type}: tag ${e.lineTag}`);
        assert.ok(!/\{\w+\}/.test(e.line ?? ''), `${e.type}: "${e.line}"`);
        for (const l of e.mc ?? []) assert.ok(!/\{\w+\}/.test(l.line), `${e.type} mc: "${l.line}"`);
      }
    }
    assert.equal(room.status, 'finished');
    married += room.characters.filter((c) => c.spouse).length;
    for (const r of room.result.ranking) {
      const c = ch(room, r.charId);
      assert.equal(r.house, c.house?.value ?? 0);
      assert.equal(r.total, r.money - r.debt + r.items + r.house);
    }
    assert.deepEqual(room.houseOwners, Object.fromEntries(Object.entries(room.houseOwners)));
  }
  for (const t of ['schoolMeet', 'dated', 'proposed', 'married']) assert.ok(seen.has(t), t);
  assert.ok(married >= 2, `married ${married}`);
});

test('restore: a JSON snapshot mid-marriage (open 프로포즈) continues identically; pre-Stage-8 saves migrate', () => {
  const room = structuredClone(started());
  room.erasOpened = room.board.eras.map((e) => e.id);
  const c = ch(room, cur(room));
  const young = room.board.eras.findIndex((e) => e.id === 'young');
  const track = room.board.eras[young].routes.love.tiles;
  Object.assign(track[1], { type: 'heart', label: '하트', icon: '💗' });
  Object.assign(c, { era: 'young', route: 'love', position: { eraIndex: young, route: 'love', index: 0 }, careerDone: true, military: { status: 'done', turnsLeft: 0 }, job: { id: 'teacher', rank: 1, exp: 0, injured: 0 } });
  c.love = { candidates: [], partner: partnerOf(), affection: 60, dates: 2 };
  const opened = applyAction(room, { type: 'spin', characterId: c.id }, { rng: fixedRng({ ints: [1] }), now: 5 });
  assert.equal(opened.room.turn.pending.kind, 'propose');
  const snap = JSON.parse(JSON.stringify(opened.room));
  const run = (r) => {
    let x = r;
    const out = [];
    for (let i = 0; i < 10 && x.status === 'playing'; i++) {
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
  const a = run(opened.room);
  const b = run(snap);
  assert.deepEqual(a.out, b.out);
  assert.equal(a.x.rngState, b.x.rngState);
  assert.deepEqual(ch(a.x, c.id).spouse, ch(b.x, c.id).spouse);
  // pre-Stage-8 save (in 청년): fields filled, no retroactive 고교 전원 만남
  const old = structuredClone(started());
  for (const x of old.characters) {
    for (const k of ['love', 'spouse', 'children', 'house', 'houseSwaps']) delete x[k];
    x.era = 'young';
  }
  for (const k of ['nextPartnerSeq', 'nextChildSeq', 'schoolMeetDone', 'houseOwners', 'housingMarket']) delete old[k];
  const m = applyAction(old, { type: 'gift', characterId: 'c1', toId: 'c2', money: 1 }, { now: 5 });
  assert.equal(m.room.schoolMeetDone, true);
  assert.deepEqual(m.room.houseOwners, {});
  assert.equal(m.room.housingMarket, null);
  assert.deepEqual(ch(m.room, 'c2').love, { candidates: [], partner: null, affection: 0, dates: 0 });
  assert.deepEqual([ch(m.room, 'c2').children, ch(m.room, 'c2').house, ch(m.room, 'c2').houseSwaps], [[], null, 0]);
});
