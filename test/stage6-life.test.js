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
import { makeRoom, plainEra, toEra } from './helpers.js';

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
/**
 * The first adult turn of the first character in order (loop maps: 진로 / 군 복무 / 취업 happen at the start of it,
 * before the spin): everyone moves to the young era start, the others are settled, the admin `skip` of the last
 * character starts `id`'s turn. @returns id
 */
function atYoungStart(room, patch = {}, id = room.turn.order[0]) {
  const y = room.board.eras.findIndex((e) => e.id === 'young');
  toEra(room, y);
  plainEra(room, y, { type: 'loss', amount: 5 });
  for (const c of room.characters) {
    if (c.id === id) Object.assign(c, { examResult: 'college' }, patch);
    else Object.assign(c, { careerDone: true, military: { status: 'done', turnsLeft: 0 }, job: { id: 'chef', rank: 1, exp: 0, injured: 0 } });
  }
  const i = room.turn.order.indexOf(id);
  room.turn.currentIndex = (i - 1 + room.turn.order.length) % room.turn.order.length;
  return id;
}
/** Start the next character's turn (admin skip of the current one). */
const nextTurn = (room, rng = {}) => act(room, { type: 'skip' }, rng);
/** Play `id`'s spin (value v) and answer its prompts with the first enabled option until the next turn. */
function spinThrough(room, id, v = 1) {
  room.turn.currentIndex = room.turn.order.indexOf(id);
  let r = act(room, { type: 'spin', characterId: id }, { ints: [v] });
  const events = [...r.events];
  while (r.room.turn.pending && r.room.turn.pending.charId === id) {
    r = choose(r.room, r.room.turn.pending.options.find((o) => !o.disabled).id);
    events.push(...r.events);
  }
  return { room: r.room, events };
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
  setTile(room, 0, 1, { type: 'habit' });
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

test('수능: the last high-school turn starts with the exam prompt (before the spin); seeded roll → examResult; scholarship', () => {
  const room = started().room;
  const hi = room.board.eras.findIndex((e) => e.id === 'high');
  // the round before the last: skipping the last character in order starts the last high-school round
  toEra(room, hi, { round: room.board.eras[hi].turns - 1 });
  room.turn.currentIndex = room.turn.order.length - 1;
  const id = room.turn.order[0];
  for (const c of room.characters) c.schoolMet = true; // (the 고교 첫 만남 prompt is its own test)
  const r = nextTurn(room);
  assert.equal(cur(r.room), id);
  assert.equal(r.room.turn.pending.kind, 'exam');
  assert.equal(r.room.turn.pending.charId, id);
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
    assert.equal(out.room.turn.phase, 'awaitSpin', 'then the spin');
  }
  // not on an earlier high-school turn
  const early = started().room;
  toEra(early, hi, { round: 1 });
  for (const c of early.characters) c.schoolMet = true;
  early.turn.currentIndex = early.turn.order.length - 1;
  const e = nextTurn(early); // → round 2 of 3
  assert.equal(e.room.turn.eraRound, 2);
  assert.notEqual(e.room.turn.pending?.kind, 'exam');
  // a skip covering the last high-school turn → the exam right after the move that set it (no missed 수능)
  const skipper = started().room;
  toEra(skipper, hi, { round: skipper.board.eras[hi].turns - 1 });
  plainEra(skipper, hi);
  for (const c of skipper.characters) c.schoolMet = true;
  const sid = cur(skipper);
  ch(skipper, sid).skipTurns = 1;
  const s1 = act(skipper, { type: 'spin', characterId: sid }, { ints: [1] });
  assert.equal(s1.room.turn.pending?.kind, 'exam');
});

// ---------- 진로 ----------

test('진로: college → tuition debt, collegeTurns of school, graduation (+int, educationChanged) → job offer', () => {
  let room = started({ chars: [['A', 'A1', GIRL], ['B', 'B1', GIRL]] }).room;
  const id = atYoungStart(room, { stats: { int: 5, str: 2, charm: 2, luck: 2 } });
  let r = nextTurn(room);
  let p = r.room.turn.pending;
  assert.equal(p.kind, 'career');
  assert.equal(p.charId, id);
  assert.deepEqual(p.options.map((o) => o.id), ['college', 'job', 'retake']);
  const debt0 = ch(r.room, id).debt;
  r = choose(r.room, 'college');
  const c = ch(r.room, id);
  assert.equal(c.debt - debt0, data.balance.career.tuition.college);
  assert.deepEqual(c.school, { tier: 'college', turnsLeft: data.balance.career.collegeTurns });
  assert.equal(c.military.status, 'exempt', 'girl with low 체력: no volunteer prompt');
  assert.equal(c.careerChoice, 'college');
  assert.equal(r.room.turn.pending, null, 'students get their job offer after graduating');
  assert.equal(r.room.turn.phase, 'awaitSpin');
  room = r.room;
  let grad = null;
  for (let i = 0; i < data.balance.career.collegeTurns; i++) {
    room.turn.currentIndex = room.turn.order.indexOf(id);
    r = act(room, { type: 'spin', characterId: id }, { ints: [1] });
    room = r.room;
    grad ??= r.events.find((e) => e.type === 'educationChanged') ?? null;
    if (!grad) assert.equal(ch(room, id).school.turnsLeft, data.balance.career.collegeTurns - 1 - i);
  }
  assert.deepEqual([grad.charId, grad.education, grad.cutin], [id, 'college', true]);
  assert.equal(ch(room, id).education, 'college');
  assert.equal(ch(room, id).stats.int, 5 + (data.balance.career.graduationStats.int ?? 0));
  assert.equal(ch(room, id).school, null);
  p = room.turn.pending;
  assert.equal(p.kind, 'jobOffer');
  assert.match(p.text, /졸업/);
  assert.ok(p.options.some((o) => data.jobs.jobs.find((j) => j.id === o.id)?.requires?.education), 'degree jobs on offer');
});

test('진로: 바로 취업 → job offer → the spin; 재수 once (skip a turn, retake, pass → enroll); elite has no 재수', () => {
  const room = started({ chars: [['A', 'A1', GIRL], ['B', 'B1', GIRL]] }).room;
  const id = atYoungStart(room);
  const r0 = nextTurn(room);
  const job = choose(r0.room, 'job');
  assert.equal(job.room.turn.pending.kind, 'jobOffer');
  const hired = choose(job.room, job.room.turn.pending.options[0].id);
  const jc = hired.events.find((e) => e.type === 'jobChanged');
  assert.deepEqual([jc.reason, jc.rank, jc.fromJobId], ['hire', 1, null]);
  assert.equal(hired.room.turn.phase, 'awaitSpin');
  assert.equal(cur(hired.room), id);
  assert.deepEqual(ch(hired.room, id).jobHistory, [{ id: jc.jobId, rank: 1, era: 'young' }]);

  // 재수: fail → options job/retake; retake → skip next turn + retake exam; a pass enrolls at once
  const failed = structuredClone(room);
  atYoungStart(failed, { examResult: 'fail' });
  let r = nextTurn(failed);
  assert.deepEqual(r.room.turn.pending.options.map((o) => o.id), ['job', 'retake']);
  r = choose(r.room, 'retake');
  assert.equal(r.room.turn.pending.kind, 'exam');
  assert.equal(r.room.turn.pending.title, '📝 재수 수능');
  assert.equal(ch(r.room, id).retook, true);
  assert.equal(ch(r.room, id).skipTurns, data.balance.career.retakeSkipTurns);
  r = choose(r.room, 'study', { nexts: [0] }); // elite this time
  assert.equal(ch(r.room, id).examResult, 'elite');
  assert.deepEqual(ch(r.room, id).school, { tier: 'elite', turnsLeft: data.balance.career.collegeTurns });
  assert.equal(r.room.turn.pending, null, 'no second 진로 prompt after a 재수');
  assert.equal(r.room.turn.phase, 'awaitSpin', 'this turn still spins');
  // the 재수 costs the next turn: the other character plays twice in a row
  const other = r.room.turn.order.find((x) => x !== id);
  const r1 = act(r.room, { type: 'spin', characterId: id }, { ints: [1] });
  assert.equal(cur(r1.room), other);
  const r2 = act(r1.room, { type: 'spin', characterId: other }, { ints: [1] });
  assert.ok(r2.events.some((e) => e.type === 'log' && /재수 중/.test(e.text)));
  assert.equal(cur(r2.room), other);
  assert.equal(ch(r2.room, id).skipTurns, 0);

  // a second fail after 재수 goes straight to work (job offer); 재수 is never offered twice
  const twice = structuredClone(room);
  atYoungStart(twice, { examResult: 'fail', retook: true });
  const t = nextTurn(twice);
  assert.equal(t.room.turn.pending.kind, 'jobOffer', 'only one choice left → applied without a prompt');
  // elite: college or job, no 재수
  const elite = structuredClone(room);
  atYoungStart(elite, { examResult: 'elite' });
  const e = nextTurn(elite);
  assert.deepEqual(e.room.turn.pending.options.map((o) => o.id), ['college', 'job']);
  // a 수능 missed in high school is taken before the 진로 decision
  const missed = structuredClone(room);
  atYoungStart(missed, { examResult: null });
  const m = nextTurn(missed);
  assert.equal(m.room.turn.pending.kind, 'exam');
  const m2 = choose(m.room, 'study', { nexts: [0] });
  assert.equal(m2.room.turn.pending.kind, 'career');
});

// ---------- 군 복무 ----------

test('군 복무: college boy chooses now → halved spins (+ pay) → 전역 (체력 +strGain); later → after graduation, job kept', () => {
  const room = started({ chars: [['A', 'A1', BOY], ['B', 'B1', GIRL]] }).room;
  const id = atYoungStart(room);
  let r = nextTurn(room);
  r = choose(r.room, 'college');
  const p = r.room.turn.pending;
  assert.equal(p.kind, 'military');
  assert.deepEqual(p.options.map((o) => o.id), ['now', 'later']);
  const now = choose(r.room, 'now');
  const ms = now.events.find((e) => e.type === 'militaryStart');
  assert.deepEqual([ms.turns, ms.cutin], [data.balance.military.turns, true]);
  assert.equal(ch(now.room, id).military.status, 'serving');
  assert.equal(now.room.turn.pending, null);
  let room2 = now.room;
  const str0 = ch(room2, id).stats.str;
  for (let i = 0; i < data.balance.military.turns; i++) {
    room2.turn.currentIndex = room2.turn.order.indexOf(id);
    const s = act(room2, { type: 'spin', characterId: id }, { ints: [8] });
    const spun = s.events.find((e) => e.type === 'spun');
    assert.deepEqual([spun.value, spun.steps, spun.halved], [8, 4, true]);
    const mv = s.events.find((e) => e.type === 'moved');
    if (!mv.halted) assert.equal(mv.path.length, 4);
    if (data.balance.military.pay) assert.ok(s.events.some((e) => e.type === 'moneyChanged' && e.reason === 'military' && e.delta === data.balance.military.pay));
    else assert.ok(!s.events.some((e) => e.type === 'moneyChanged' && e.reason === 'military'), 'no pay (balance.military.pay 0)');
    room2 = s.room;
    while (room2.turn.pending?.charId === id) room2 = choose(room2, room2.turn.pending.options.find((o) => !o.disabled).id).room;
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
  let room3 = later.room;
  let g = null;
  for (let i = 0; i < data.balance.career.collegeTurns; i++) {
    room3.turn.currentIndex = room3.turn.order.indexOf(id);
    g = act(room3, { type: 'spin', characterId: id }, { ints: [1] });
    room3 = g.room;
  }
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
  atYoungStart(room);
  let r = nextTurn(room);
  r = choose(r.room, 'job');
  assert.equal(r.room.turn.pending.kind, 'jobOffer');
  r = choose(r.room, r.room.turn.pending.options[0].id);
  assert.ok(r.events.some((e) => e.type === 'militaryStart'));
  assert.equal(r.room.turn.pending, null);
  assert.ok(!r.events.some((e) => e.type === 'prompt' && e.kind === 'military'));

  const girlRoom = started({ chars: [['A', 'A1', BOY], ['B', 'B1', GIRL]] }).room;
  const girl = girlRoom.characters.find((c) => c.avatar.body === 'girl').id;
  const gid = atYoungStart(girlRoom, { stats: { int: 3, str: data.balance.military.volunteerMinStr, charm: 2, luck: 2 } }, girl);
  assert.equal(ch(girlRoom, gid).avatar.body, 'girl');
  let g = nextTurn(girlRoom);
  g = choose(g.room, 'job');
  const p = g.room.turn.pending;
  assert.equal(p.kind, 'military');
  assert.deepEqual(p.options.map((o) => o.id), ['volunteer', 'skip']);
  assert.equal(p.defaultOptionId, 'skip');
  const vol = choose(g.room, 'volunteer');
  assert.equal(ch(vol.room, gid).military.status, 'serving');
  assert.equal(vol.room.turn.pending, null, 'job offer waits until 전역');
  const skip = choose(g.room, 'skip');
  assert.equal(ch(skip.room, gid).military.status, 'exempt');
  assert.equal(skip.room.turn.pending.kind, 'jobOffer');
});

// ---------- news ----------

test('news: drawn once per era at the transition (never baby), statBonus for every character, effects apply', () => {
  const room = started({ chars: [['A', 'A1', BOY], ['B', 'B1', GIRL]] }).room;
  plainEra(room, 0);
  room.turn.eraRound = room.turn.eraTurns;
  room.turn.currentIndex = room.turn.order.length - 1;
  const r = applyAction(room, { type: 'spin', characterId: cur(room) }, { rng: fixedRng({ ints: [1] }), now: 1 });
  const flash = r.events.filter((e) => e.type === 'newsFlash');
  assert.equal(flash.length, 1);
  assert.equal(r.room.news.elem, flash[0].newsId);
  assert.ok(types(r.events).indexOf('eraTransition') < types(r.events).indexOf('newsFlash'));
  assert.ok(types(r.events).lastIndexOf('eraChanged') < types(r.events).indexOf('newsFlash'));
  assert.equal(flash[0].cutin, true);
  assert.equal(flash[0].mcKey, 'news');
  assert.equal(flash[0].mcStudio, true);
  const n = data.news.news.find((x) => x.id === flash[0].newsId);
  assert.ok(!n.eras || n.eras.includes('elem'));
  // a statBonus news applies to every character at the transition
  const withBonus = structuredClone(room);
  withBonus.news.elem = 'coding_edu';
  const int0 = withBonus.characters.map((c) => c.stats.int);
  const r2 = applyAction(withBonus, { type: 'spin', characterId: cur(withBonus) }, { rng: fixedRng({ ints: [1] }), now: 2 });
  assert.equal(r2.events.filter((e) => e.type === 'newsFlash').length, 0, 'already drawn');
  assert.deepEqual(r2.room.characters.map((c) => c.stats.int), int0.map((v) => Math.min(10, v + 1)));
  assert.ok(r2.events.some((e) => e.type === 'statChanged' && e.reason === 'news'));
  // baby / unknown eras never draw
  const tx = createTx(structuredClone(room), { rng: fixedRng(), now: 0, data });
  assert.equal(drawNews(tx, 'baby'), null);
  assert.deepEqual(newsPool(data, 'baby'), []);
  // lossMult: 물가 폭등 makes loss tiles × 1.3 for characters in that era
  const room3 = structuredClone(r.room);
  room3.news.elem = 'price_surge';
  plainEra(room3, 1);
  setTile(room3, 1, 1, { type: 'loss', amount: 100 });
  room3.turn.pending = null;
  room3.turn.phase = 'awaitSpin';
  const r3 = act(room3, { type: 'spin', characterId: cur(room3) }, { ints: [1] });
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
  const last = room.board.eras.length - 1;
  toEra(room, last);
  plainEra(room, last);
  const id = cur(room);
  const tiles = room.board.eras[last].tiles;
  Object.assign(ch(room, id), {
    position: { eraIndex: last, route: 'main', index: tiles.length - 2 },
    military: { status: 'serving', turnsLeft: 1 },
    careerDone: true,
  });
  const r = act(room, { type: 'spin', characterId: id }, { ints: [1] });
  const c = ch(r.room, id);
  assert.equal(c.finished, true);
  assert.equal(c.military.status, 'done');
  assert.ok(r.events.some((e) => e.type === 'militaryEnd'));
});
