// Stage 6 — growth: stats, habits, 수능 probabilities, 진로 (college / job / 재수 once), 군 복무 (mandatory /
// volunteer / halved spins), era news, pre-Stage-6 save migration and snapshot restore mid-career.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameData } from '../server/data/index.js';
import { applyAction, startGame } from '../server/game/engine.js';
import { STAT_KEYS, addStat, createTx } from '../server/game/effects.js';
import { EDUCATIONS, examChances, examOutcome } from '../server/game/growth.js';
import { NEWS_DEFAULTS, drawNews, newsPool } from '../server/game/news.js';
import { addCharacter, joinRoom } from '../server/game/lobby.js';
import { viewFor } from '../server/game/view.js';
import { makeRoom } from './helpers.js';

const data = gameData();
const BOY = { body: 'boy' };
const GIRL = { body: 'girl' };

/** Started game. chars: [[owner, name, avatar?], ...]. */
function started({ mode = 'lifetime', eraTurns = {}, chars = [['A', 'A1', BOY], ['B', 'B1', GIRL]], seed = 7, ctx = {} } = {}) {
  let room = makeRoom({ seed });
  room.config = { ...room.config, mode, eraTurns: { ...room.config.eraTurns, ...eraTurns } };
  room = joinRoom(room, 'A', '에이', 0).room;
  room = joinRoom(room, 'B', '비', 0).room;
  for (const [owner, name, avatar] of chars) room = addCharacter(room, owner, { name, avatar }, 0).room;
  const r = startGame(room, { now: 0, ...ctx });
  assert.equal(r.ok, true, r.error);
  return r;
}

/** RNG stub: int() / next() take queued values (then min / 0); pick/weighted take the first item. */
function fixedRng({ ints = [], nexts = [] } = {}) {
  const qi = [...ints];
  const qn = [...nexts];
  return {
    next: () => (qn.length ? qn.shift() : 0),
    int: (a) => (qi.length ? qi.shift() : a),
    pick: (arr) => arr[0],
    weighted: (items) => items[0],
    get state() {
      return 4242;
    },
  };
}
const act = (room, action, rng = {}, now = 1000) => applyAction(room, action, { rng: fixedRng(rng), now });
const cur = (room) => room.turn.order[room.turn.currentIndex];
const ch = (room, id) => room.characters.find((c) => c.id === id);
const types = (events) => events.map((e) => e.type);
const choose = (room, optionId, rng = {}) => {
  const p = room.turn.pending;
  return act(room, { type: 'choose', characterId: p.charId, promptId: p.promptId, optionId }, rng);
};
function setTile(room, eraIndex, index, tile, route = 'main') {
  const era = room.board.eras[eraIndex];
  const track = route === 'main' ? era.tiles : era.routes[route].tiles;
  track[index] = { id: track[index].id, label: 'test', ...tile };
}
/** Put the current character on the last 고등학생 tile with a given 수능 result (next spin → young:0 갈림길). */
function atYoungGate(room, patch = {}) {
  const id = cur(room);
  Object.assign(ch(room, id), { position: { eraIndex: 3, route: 'main', index: 4 }, era: 'high', examResult: 'college' }, patch);
  return id;
}

// ---------- init / stats ----------

test('startGame: stats 2 each + 1 seeded point, fresh life record; adult mode starts grown up', () => {
  const r = started();
  for (const c of r.room.characters) {
    assert.deepEqual(Object.keys(c.stats), STAT_KEYS);
    assert.equal(Object.values(c.stats).reduce((a, b) => a + b, 0), 4 * data.balance.stats.start + data.balance.stats.randomPoints);
    assert.ok(Object.values(c.stats).every((v) => v >= data.balance.stats.start));
    assert.equal(c.education, 'none');
    assert.equal(c.examResult, null);
    assert.deepEqual(c.military, { status: 'none', turnsLeft: 0 });
    assert.equal(c.job, null);
    assert.deepEqual([c.jobHistory, c.hiddenUnlocked], [[], []]);
  }
  assert.deepEqual(r.room.news, {});
  assert.deepEqual(started().room.characters.map((c) => c.stats), r.room.characters.map((c) => c.stats), 'seeded');
  // the secret only affects the gameplay stream, not the (public) starting stats
  assert.deepEqual(started({ ctx: { secret: 99 } }).room.characters.map((c) => c.stats), r.room.characters.map((c) => c.stats));

  const adult = started({ mode: 'adult', eraTurns: { young: 5, middle_age: 5, senior: 3 } });
  const [boy, girl] = adult.room.characters;
  const s = data.balance.stats;
  for (const c of [boy, girl]) {
    assert.equal(Object.values(c.stats).reduce((a, b) => a + b, 0), 4 * s.start + s.randomPoints + s.adultPoints);
    assert.ok(EDUCATIONS.includes(c.education));
    assert.equal(c.careerDone, true);
  }
  assert.equal(boy.military.status, 'done');
  assert.equal(girl.military.status, 'exempt');
  // adult mode: the first era's news is drawn at game start
  const flash = adult.events.find((e) => e.type === 'newsFlash');
  assert.ok(flash);
  assert.equal(adult.room.news.young, flash.newsId);
});

test('addStat: clamped to 0..cap, emits the actual delta, nothing when clamped away', () => {
  const room = structuredClone(started().room);
  const tx = createTx(room, { rng: fixedRng(), now: 0, data });
  const c = room.characters[0];
  const cap = data.balance.stats.cap;
  const before = c.stats.int;
  assert.equal(addStat(tx, c, 'int', 99, 'test'), cap - before);
  assert.equal(c.stats.int, cap);
  const ev = tx.events.at(-1);
  assert.deepEqual([ev.type, ev.stat, ev.delta, ev.value, ev.reason], ['statChanged', 'int', cap - before, cap, 'test']);
  assert.equal(addStat(tx, c, 'int', 1, 'test'), 0);
  assert.equal(tx.events.length, 1, 'no event at the cap');
  const luck0 = c.stats.luck;
  assert.equal(addStat(tx, c, 'luck', -50, 'test'), -luck0);
  assert.equal(c.stats.luck, 0);
  assert.equal(addStat(tx, c, 'luck', -1, 'test'), 0);
  assert.equal(addStat(tx, c, 'nope', 3, 'test'), 0);
});

// ---------- habits ----------

test('habit tile → habit prompt; each option raises its stat (+bonus), costs / wins money; result anchor', () => {
  const room = started().room;
  const id = cur(room);
  setTile(room, 0, 0, { type: 'habit' });
  let r = act(room, { type: 'spin', characterId: id }, { ints: [1] });
  const p = r.room.turn.pending;
  assert.equal(p.kind, 'habit');
  assert.deepEqual(p.options.map((o) => [o.id, o.stat]), [['academy', 'int'], ['taekwondo', 'str'], ['art', 'charm'], ['game', 'luck']]);
  for (const o of p.options) assert.ok(o.desc && o.label && o.icon);
  const land = r.events.find((e) => e.type === 'landed');
  assert.equal(land.cutin, false, 'the prompt cut-in replaces the landing one');
  const cfg = data.balance.habits;
  const opt = (k) => cfg.options.find((o) => o.id === k);
  const int0 = ch(r.room, id).stats.int;
  // bonus roll hits (next() = 0) → gain + 1; cost = cost × baby scale
  const a = choose(r.room, 'academy', { nexts: [0] });
  assert.equal(ch(a.room, id).stats.int, Math.min(10, int0 + opt('academy').gain + 1));
  const iResolved = types(a.events).indexOf('promptResolved');
  assert.ok(iResolved > types(a.events).indexOf('chose') && iResolved < types(a.events).indexOf('statChanged'), 'anchor before chips');
  assert.deepEqual([a.events[iResolved].result, a.events[iResolved].stat], ['academy', 'int']);
  const money = a.events.find((e) => e.type === 'moneyChanged');
  assert.equal(money.delta, -10); // 15 × 0.5 → 7.5 → 10 (5만원 steps)
  assert.equal(a.events[iResolved].lineTag, 'habit_int');
  // no bonus → exactly the gain
  const b = choose(r.room, 'art', { nexts: [0.99] });
  assert.equal(ch(b.room, id).stats.charm, ch(r.room, id).stats.charm + opt('art').gain);
  // 게임·뽑기: luck + money roll (int() → min)
  const g = choose(r.room, 'game', { nexts: [0.99] });
  assert.equal(ch(g.room, id).stats.luck, ch(r.room, id).stats.luck + opt('game').gain);
  assert.equal(g.events.find((e) => e.type === 'moneyChanged').delta, -10); // -15 × 0.5
});

// ---------- 수능 ----------

test('exam probability table: base + int×지력 + luck×운 (+news, +재수), clamped, elite ≤ college', () => {
  const cfg = data.balance.exam;
  const expect = (row, c, extra = 0) => Math.max(cfg.min, Math.min(cfg.max, row.base + row.int * c.stats.int + row.luck * c.stats.luck + extra));
  for (const [int, luck] of [[2, 2], [5, 3], [8, 8], [0, 0], [10, 10]]) {
    const c = { stats: { int, luck } };
    for (const choice of ['study', 'guess']) {
      const ch_ = examChances(c, choice, data);
      assert.ok(Math.abs(ch_.college - expect(cfg[choice].college, c)) < 1e-9, `${choice} ${int}/${luck}`);
      assert.ok(Math.abs(ch_.elite - Math.min(ch_.college, expect(cfg[choice].elite, c))) < 1e-9);
      assert.ok(ch_.elite <= ch_.college && ch_.college <= cfg.max && ch_.elite >= cfg.min);
      const bonus = examChances(c, choice, data, { examBonus: 0.1, retake: true });
      assert.ok(Math.abs(bonus.college - expect(cfg[choice].college, c, 0.1 + cfg.retakeBonus)) < 1e-9);
    }
  }
  // 지력 favours 차근차근, 운 favours 찍기
  const brainy = { stats: { int: 8, luck: 2 } };
  const lucky = { stats: { int: 2, luck: 8 } };
  assert.ok(examChances(brainy, 'study', data).college > examChances(brainy, 'guess', data).college);
  assert.ok(examChances(lucky, 'guess', data).college > examChances(lucky, 'study', data).college);
  assert.equal(examOutcome({ elite: 0.2, college: 0.6 }, 0.1), 'elite');
  assert.equal(examOutcome({ elite: 0.2, college: 0.6 }, 0.2), 'college');
  assert.equal(examOutcome({ elite: 0.2, college: 0.6 }, 0.6), 'fail');
});

test('수능 stop: seeded roll → examResult + promptResolved{result}; scholarship per result', () => {
  const room = started().room;
  const id = cur(room);
  ch(room, id).position = { eraIndex: 2, route: 'main', index: 3 }; // last middle tile → next is high:0 (수능)
  const r = act(room, { type: 'spin', characterId: id }, { ints: [1] });
  assert.equal(r.room.turn.pending.kind, 'exam');
  for (const [roll, result] of [[0.001, 'elite'], [0.3, null], [0.999, 'fail']]) {
    const out = choose(r.room, 'study', { nexts: [roll] });
    const pr = out.events.find((e) => e.type === 'promptResolved');
    const c = ch(out.room, id);
    const chances = examChances(ch(r.room, id), 'study', data, { examBonus: 0 });
    const want = result ?? examOutcome(chances, roll);
    assert.equal(c.examResult, want);
    assert.equal(pr.result, want);
    const reward = data.balance.exam.reward[want];
    const money = out.events.find((e) => e.type === 'moneyChanged' && e.reason === 'exam');
    assert.equal(money?.delta ?? 0, reward);
  }
});

// ---------- 진로 ----------

test('진로: college → tuition debt, 1 turn of school, graduation (+int, educationChanged) → job offer', () => {
  let room = started({ chars: [['A', 'A1', GIRL], ['B', 'B1', GIRL]] }).room;
  const id = atYoungGate(room, { stats: { int: 5, str: 2, charm: 2, luck: 2 } });
  let r = act(room, { type: 'spin', characterId: id }, { ints: [1] });
  let p = r.room.turn.pending;
  assert.equal(p.kind, 'career');
  assert.deepEqual(p.options.map((o) => o.id), ['college', 'job', 'retake']);
  const debt0 = ch(r.room, id).debt;
  r = choose(r.room, 'college');
  const c = ch(r.room, id);
  assert.equal(c.debt - debt0, data.balance.career.tuition.college);
  assert.deepEqual(c.school, { tier: 'college', turnsLeft: data.balance.career.collegeTurns });
  assert.equal(c.military.status, 'exempt', 'girl with low 체력: no volunteer prompt');
  assert.equal(c.careerChoice, 'college');
  assert.equal(r.room.turn.pending.kind, 'routeChoice', 'students get their job offer after graduating');
  r = choose(r.room, 'career');
  room = r.room;
  room.turn.currentIndex = room.turn.order.indexOf(id);
  setTile(room, 4, 0, { type: 'loss', amount: 5 }, 'career');
  r = act(room, { type: 'spin', characterId: id }, { ints: [1] });
  const edu = r.events.find((e) => e.type === 'educationChanged');
  assert.deepEqual([edu.charId, edu.education, edu.cutin], [id, 'college', true]);
  assert.equal(ch(r.room, id).education, 'college');
  assert.equal(ch(r.room, id).stats.int, 5 + (data.balance.career.graduationStats.int ?? 0));
  assert.equal(ch(r.room, id).school, null);
  p = r.room.turn.pending;
  assert.equal(p.kind, 'jobOffer');
  assert.match(p.text, /졸업/);
  assert.ok(p.options.some((o) => data.jobs.jobs.find((j) => j.id === o.id)?.requires?.education), 'degree jobs on offer');
});

test('진로: 바로 취업 → job offer → 갈림길; 재수 once (skip a turn, retake, pass → enroll); elite has no 재수', () => {
  const room = started({ chars: [['A', 'A1', GIRL], ['B', 'B1', GIRL]] }).room;
  const id = atYoungGate(room);
  const r0 = act(room, { type: 'spin', characterId: id }, { ints: [1] });
  const job = choose(r0.room, 'job');
  assert.equal(job.room.turn.pending.kind, 'jobOffer');
  const hired = choose(job.room, job.room.turn.pending.options[0].id);
  const jc = hired.events.find((e) => e.type === 'jobChanged');
  assert.deepEqual([jc.reason, jc.rank, jc.fromJobId], ['hire', 1, null]);
  assert.equal(hired.room.turn.pending.kind, 'routeChoice');
  assert.deepEqual(ch(hired.room, id).jobHistory, [{ id: jc.jobId, rank: 1, era: 'young' }]);

  // 재수: fail → options job/retake; retake → skip next turn + retake exam; a pass enrolls at once
  const failed = structuredClone(room);
  atYoungGate(failed, { examResult: 'fail' });
  let r = act(failed, { type: 'spin', characterId: id }, { ints: [1] });
  assert.deepEqual(r.room.turn.pending.options.map((o) => o.id), ['job', 'retake']);
  r = choose(r.room, 'retake');
  assert.equal(r.room.turn.pending.kind, 'exam');
  assert.equal(r.room.turn.pending.title, '📝 재수 수능');
  assert.equal(ch(r.room, id).retook, true);
  assert.equal(ch(r.room, id).skipTurns, data.balance.career.retakeSkipTurns);
  r = choose(r.room, 'study', { nexts: [0] }); // elite this time
  assert.equal(ch(r.room, id).examResult, 'elite');
  assert.deepEqual(ch(r.room, id).school, { tier: 'elite', turnsLeft: data.balance.career.collegeTurns });
  assert.equal(r.room.turn.pending.kind, 'routeChoice', 'no second 진로 prompt after a 재수');
  r = choose(r.room, 'love');
  // the 재수 costs the next turn: the other character plays twice in a row
  const other = r.room.turn.order.find((x) => x !== id);
  assert.equal(cur(r.room), other);
  const r2 = act(r.room, { type: 'spin', characterId: other }, { ints: [1] });
  assert.ok(r2.events.some((e) => e.type === 'log' && /재수 중/.test(e.text)));
  assert.equal(cur(r2.room), other);
  assert.equal(ch(r2.room, id).skipTurns, 0);

  // a second fail after 재수 goes straight to work (job offer); 재수 is never offered twice
  const twice = structuredClone(failed);
  atYoungGate(twice, { examResult: 'fail', retook: true });
  const t = act(twice, { type: 'spin', characterId: id }, { ints: [1] });
  assert.equal(t.room.turn.pending.kind, 'jobOffer', 'only one choice left → applied without a prompt');
  // elite: college or job, no 재수
  const elite = structuredClone(room);
  atYoungGate(elite, { examResult: 'elite' });
  const e = act(elite, { type: 'spin', characterId: id }, { ints: [1] });
  assert.deepEqual(e.room.turn.pending.options.map((o) => o.id), ['college', 'job']);
});

// ---------- 군 복무 ----------

test('군 복무: college boy chooses now → halved spins (+ pay) → 전역 (체력 +strGain); later → after graduation, job kept', () => {
  const room = started({ chars: [['A', 'A1', BOY], ['B', 'B1', GIRL]] }).room;
  const id = atYoungGate(room);
  let r = act(room, { type: 'spin', characterId: id }, { ints: [1] });
  r = choose(r.room, 'college');
  let p = r.room.turn.pending;
  assert.equal(p.kind, 'military');
  assert.deepEqual(p.options.map((o) => o.id), ['now', 'later']);
  const now = choose(r.room, 'now');
  const ms = now.events.find((e) => e.type === 'militaryStart');
  assert.deepEqual([ms.turns, ms.cutin], [data.balance.military.turns, true]);
  assert.equal(ch(now.room, id).military.status, 'serving');
  assert.equal(now.room.turn.pending.kind, 'routeChoice');
  let room2 = choose(now.room, 'career').room;
  const str0 = ch(room2, id).stats.str;
  for (let i = 0; i < data.balance.military.turns; i++) {
    room2.turn.currentIndex = room2.turn.order.indexOf(id);
    const s = act(room2, { type: 'spin', characterId: id }, { ints: [8] });
    const spun = s.events.find((e) => e.type === 'spun');
    assert.deepEqual([spun.value, spun.steps, spun.halved], [8, 4, true]);
    assert.equal(s.events.find((e) => e.type === 'moved').path.length, 4);
    if (data.balance.military.pay) assert.ok(s.events.some((e) => e.type === 'moneyChanged' && e.reason === 'military' && e.delta === data.balance.military.pay));
    else assert.ok(!s.events.some((e) => e.type === 'moneyChanged' && e.reason === 'military'), 'no pay (balance.military.pay 0)');
    room2 = s.room;
    if (s.room.turn.pending) room2 = choose(s.room, s.room.turn.pending.options[0].id).room;
    if (i === data.balance.military.turns - 1) {
      const end = s.events.find((e) => e.type === 'militaryEnd');
      assert.ok(end, '전역 after the last served spin');
      assert.equal(end.cutin, false);
      assert.ok(s.events.some((e) => e.type === 'statChanged' && e.stat === 'str' && e.reason === 'military'));
    }
  }
  assert.equal(ch(room2, id).military.status, 'done');
  assert.equal(ch(room2, id).stats.str, Math.min(10, str0 + data.balance.military.strGain));
  assert.ok(ch(room2, id).school, 'school is paused while serving');

  // later: deferred once; after graduation → job offer first, then 입대 (the job is kept)
  const later = choose(r.room, 'later');
  assert.equal(ch(later.room, id).military.deferred, true);
  let room3 = choose(later.room, 'career').room;
  room3.turn.currentIndex = room3.turn.order.indexOf(id);
  setTile(room3, 4, 0, { type: 'loss', amount: 5 }, 'career');
  const g = act(room3, { type: 'spin', characterId: id }, { ints: [1] });
  assert.ok(g.events.some((e) => e.type === 'educationChanged'));
  assert.equal(g.room.turn.pending.kind, 'jobOffer');
  const h = choose(g.room, g.room.turn.pending.options[0].id);
  assert.ok(h.events.some((e) => e.type === 'jobChanged'));
  assert.ok(h.events.some((e) => e.type === 'militaryStart'), 'deferred service starts right after hiring');
  assert.equal(ch(h.room, id).military.status, 'serving');
  assert.ok(ch(h.room, id).job, 'job kept while serving');
});

test('군 복무: non-college boys serve after hiring (no prompt); girls volunteer only with 체력 ≥ min', () => {
  const room = started({ chars: [['A', 'A1', BOY], ['B', 'B1', GIRL]] }).room;
  const id = atYoungGate(room);
  let r = act(room, { type: 'spin', characterId: id }, { ints: [1] });
  r = choose(r.room, 'job');
  assert.equal(r.room.turn.pending.kind, 'jobOffer');
  r = choose(r.room, r.room.turn.pending.options[0].id);
  assert.ok(r.events.some((e) => e.type === 'militaryStart'));
  assert.equal(r.room.turn.pending.kind, 'routeChoice');
  assert.ok(!r.events.some((e) => e.type === 'prompt' && e.kind === 'military'));

  const girlRoom = structuredClone(room);
  girlRoom.turn.currentIndex = girlRoom.turn.order.findIndex((x) => ch(girlRoom, x).avatar.body === 'girl');
  const gid = atYoungGate(girlRoom, { stats: { int: 3, str: data.balance.military.volunteerMinStr, charm: 2, luck: 2 } });
  let g = act(girlRoom, { type: 'spin', characterId: gid }, { ints: [1] });
  g = choose(g.room, 'job');
  const p = g.room.turn.pending;
  assert.equal(p.kind, 'military');
  assert.deepEqual(p.options.map((o) => o.id), ['volunteer', 'skip']);
  assert.equal(p.defaultOptionId, 'skip');
  const vol = choose(g.room, 'volunteer');
  assert.equal(ch(vol.room, gid).military.status, 'serving');
  assert.equal(vol.room.turn.pending.kind, 'routeChoice', 'job offer waits until 전역');
  const skip = choose(g.room, 'skip');
  assert.equal(ch(skip.room, gid).military.status, 'exempt');
  assert.equal(skip.room.turn.pending.kind, 'jobOffer');
});

// ---------- news ----------

test('news: drawn once per era by the first entrant (never baby), statBonus for every entrant, effects apply', () => {
  const room = started({ chars: [['A', 'A1', BOY], ['B', 'B1', GIRL]] }).room;
  const [a, b] = room.turn.order;
  ch(room, a).position = { eraIndex: 0, route: 'main', index: 2 };
  setTile(room, 1, 0, { type: 'loss', amount: 5 });
  const r = applyAction(room, { type: 'spin', characterId: a }, { rng: fixedRng({ ints: [1] }), now: 1 });
  const flash = r.events.filter((e) => e.type === 'newsFlash');
  assert.equal(flash.length, 1);
  assert.equal(r.room.news.elem, flash[0].newsId);
  assert.ok(types(r.events).indexOf('eraChanged') < types(r.events).indexOf('newsFlash'));
  assert.equal(flash[0].cutin, true);
  assert.equal(flash[0].mcKey, 'news');
  assert.equal(flash[0].mcStudio, true);
  const n = data.news.news.find((x) => x.id === flash[0].newsId);
  assert.ok(!n.eras || n.eras.includes('elem'));
  // second entrant: no new draw; a statBonus news applies to it as well
  const room2 = structuredClone(r.room);
  room2.news.elem = 'coding_edu';
  room2.turn.currentIndex = room2.turn.order.indexOf(b);
  ch(room2, b).position = { eraIndex: 0, route: 'main', index: 2 };
  const int0 = ch(room2, b).stats.int;
  const r2 = applyAction(room2, { type: 'spin', characterId: b }, { rng: fixedRng({ ints: [1] }), now: 2 });
  assert.equal(r2.events.filter((e) => e.type === 'newsFlash').length, 0);
  assert.equal(ch(r2.room, b).stats.int, int0 + 1);
  assert.ok(r2.events.some((e) => e.type === 'statChanged' && e.reason === 'news'));
  // baby / unknown eras never draw
  const tx = createTx(structuredClone(room), { rng: fixedRng(), now: 0, data });
  assert.equal(drawNews(tx, 'baby'), null);
  assert.deepEqual(newsPool(data, 'baby'), []);
  // lossMult: 물가 폭등 makes loss tiles × 1.3 for characters in that era
  const room3 = structuredClone(r.room);
  room3.news.elem = 'price_surge';
  room3.turn.currentIndex = room3.turn.order.indexOf(a);
  setTile(room3, 1, 1, { type: 'loss', amount: 100 });
  const r3 = act(room3, { type: 'spin', characterId: a }, { ints: [1] });
  assert.equal(r3.events.find((e) => e.type === 'moneyChanged').delta, -130);
  assert.deepEqual(Object.keys(NEWS_DEFAULTS).includes('housePriceMult'), true);
  // public: every session sees room.news
  assert.deepEqual(viewFor(r.room, 'B').news, r.room.news);
});

// ---------- saves ----------

test('pre-Stage-6 saves: characters without life fields are filled in and keep playing', () => {
  const room = started().room;
  for (const c of room.characters) for (const k of ['stats', 'education', 'examResult', 'military', 'job', 'jobHistory', 'hiddenUnlocked']) delete c[k];
  delete room.news;
  const r = applyAction(room, { type: 'spin', characterId: cur(room) }, { now: 1 });
  for (const c of r.room.characters) {
    assert.deepEqual(Object.keys(c.stats), STAT_KEYS);
    assert.equal(c.military.status, 'none');
    assert.equal(c.job, null);
  }
  assert.ok(r.room.news);
});

test('restore from a JSON snapshot mid-career continues identically (jobs, school, military, news)', () => {
  const play = (room, steps) => {
    for (let i = 0; i < steps && room.status === 'playing'; i++) {
      const p = room.turn.pending;
      const action = p
        ? { type: 'choose', characterId: p.forCharacterIds.find((x) => !Object.hasOwn(p.answers, x)), promptId: p.promptId, optionId: ((o) => o[(room.turn.turnNo + i) % o.length].id)(p.options.filter((x) => !x.disabled)) }
        : { type: 'spin', characterId: cur(room) };
      room = applyAction(room, action, { now: i }).room;
    }
    return room;
  };
  const start = started({ chars: [['A', 'A1', BOY], ['B', 'B1', GIRL], ['A', 'A2', GIRL], ['B', 'B2', BOY]], seed: 99 }).room;
  let mid = start;
  let steps = 0;
  while (steps < 600 && !mid.characters.some((c) => c.job) && mid.status === 'playing') {
    mid = play(mid, 1);
    steps++;
  }
  assert.ok(mid.characters.some((c) => c.job), 'someone got a job');
  const restored = JSON.parse(JSON.stringify(mid));
  const endA = play(mid, 120);
  const endB = play(restored, 120);
  assert.deepEqual(endA.characters, endB.characters);
  assert.deepEqual(endA.news, endB.news);
  assert.equal(endA.rngState, endB.rngState);
});

test('군 복무: the last served spin reaching the goal still discharges (no finished character left serving)', () => {
  const room = started().room;
  const id = cur(room);
  const last = room.board.eras.length - 1;
  const tiles = room.board.eras[last].tiles;
  Object.assign(ch(room, id), {
    position: { eraIndex: last, route: 'main', index: tiles.length - 2 },
    era: room.board.eras[last].id,
    military: { status: 'serving', turnsLeft: 1 },
  });
  const r = act(room, { type: 'spin', characterId: id }, { ints: [1] });
  const c = ch(r.room, id);
  assert.equal(c.finished, true);
  assert.equal(c.military.status, 'done');
  assert.ok(r.events.some((e) => e.type === 'militaryEnd'));
});
