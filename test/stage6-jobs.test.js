// Stage 6 — jobs: data schemas (jobs / events / news / eraOutfits), job-offer filtering, salary, rank-ups,
// injuries, job tiles, the 6 hidden-job unlocks, presentation + MC mapping of the new events, config, /api/meta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameData, loadData } from '../server/data/index.js';
import { applyAction, startGame } from '../server/game/engine.js';
import { STAT_KEYS, createTx } from '../server/game/effects.js';
import {
  PART_TIME_ID,
  checkHiddenUnlocks,
  eligibleJobs,
  hiddenJobs,
  jobDef,
  jobRequirements,
  offerCandidates,
  offerJob,
  offerWeight,
  paySalary,
  rankUpChance,
  rollInjury,
  salaryAmount,
  tryRankUp,
  unlockMet,
} from '../server/game/jobs.js';
import { NEWS_DEFAULTS } from '../server/game/news.js';
import { CUTIN_TYPES, EMOTIONS, EVENT_TYPES, SCENES, TONES, attachMc, decorateEvents } from '../server/game/presentation.js';
import { eventConditionsMet, eventPool } from '../server/game/spaces.js';
import { validateRoomConfig } from '../server/game/config.js';
import { addCharacter, joinRoom } from '../server/game/lobby.js';
import { viewFor } from '../server/game/view.js';
import { startServer } from '../server/index.js';
import { httpCall, makeRoom, tempDir } from './helpers.js';

const data = gameData();
const avatars = loadData('avatars');
const lines = loadData('lines');
const OUTFITS = new Set(avatars.parts.outfit.map((o) => o.id));
const ERA_IDS = loadData('eras').eras.map((e) => e.id);
const TONE_OK = (t) => TONES.includes(data.tones.toneAliases?.[t] ?? t);

function started({ mode = 'lifetime', eraTurns = {}, chars = [['A', 'A1'], ['B', 'B1']], seed = 7 } = {}) {
  let room = makeRoom({ seed });
  room.config = { ...room.config, mode, eraTurns: { ...room.config.eraTurns, ...eraTurns } };
  room = joinRoom(room, 'A', '에이', 0).room;
  room = joinRoom(room, 'B', '비', 0).room;
  for (const [owner, name, avatar] of chars) room = addCharacter(room, owner, { name, avatar }, 0).room;
  const r = startGame(room, { now: 0 });
  assert.equal(r.ok, true, r.error);
  return r.room;
}
function fixedRng({ ints = [], nexts = [] } = {}) {
  const qi = [...ints];
  const qn = [...nexts];
  return { next: () => (qn.length ? qn.shift() : 0), int: (a) => (qi.length ? qi.shift() : a), pick: (arr) => arr[0], weighted: (items) => items[0], get state() { return 4242; } };
}
/** A tx over a copy of a started room + its first character placed in an era. */
function sandbox({ era = 'young', patch = {}, rng = {}, news = {} } = {}) {
  const room = structuredClone(started());
  room.news = news;
  const c = room.characters[0];
  Object.assign(c, { era, stats: { int: 2, str: 2, charm: 2, luck: 2 }, education: 'none', military: { status: 'done', turnsLeft: 0 } }, patch);
  const tx = createTx(room, { rng: fixedRng(rng), now: 0, data });
  return { room, c, tx };
}
const act = (room, action, rng = {}) => applyAction(room, action, { rng: fixedRng(rng), now: 1000 });
const cur = (room) => room.turn.order[room.turn.currentIndex];
const ch = (room, id) => room.characters.find((c) => c.id === id);
const setJob = (c, id, rank = 1, extra = {}) => {
  c.job = { id, rank, exp: 0, injured: 0, ...extra };
  c.jobHistory = [...(c.jobHistory ?? []), { id, rank, era: c.era }];
};

// ---------- data ----------

test('jobs.json: 17 regular + 6 hidden + 알바, valid requirements, ranks, outfits, scenes, unlocks', () => {
  const regular = data.jobs.jobs.filter((j) => !j.hidden);
  const hidden = data.jobs.jobs.filter((j) => j.hidden);
  assert.deepEqual(regular.map((j) => j.name), ['공무원', '대기업 회사원', '웹툰 작가', '국회의원', '야구선수', '축구선수', 'e스포츠 선수', '격투기 선수', '배우', '아이돌', '유튜버', '셰프', '의사', '연구원', '경찰관', '개그맨', '교사']);
  assert.deepEqual(hidden.map((j) => j.name).sort(), ['건물주', '국민 MC', '산신령', '우주비행사', '재벌 총수', '트로트 스타'].sort());
  const ids = new Set();
  for (const j of [...data.jobs.jobs, data.jobs.partTime]) {
    assert.match(j.id, /^[a-z_]+$/);
    assert.ok(!ids.has(j.id), `duplicate ${j.id}`);
    ids.add(j.id);
    assert.ok(j.name && j.icon && j.desc, j.id);
    assert.ok(OUTFITS.has(j.outfit), `${j.id}: outfit ${j.outfit} exists in avatars.json`);
    assert.ok(SCENES.includes(j.scene), `${j.id}: scene ${j.scene}`);
    assert.ok(TONE_OK(j.tone), `${j.id}: tone ${j.tone}`);
    assert.ok(j.ranks.length >= 3 && j.ranks.length <= 5, `${j.id}: 3–5 ranks`);
    j.ranks.forEach((r, i) => {
      assert.ok(r.name && Number.isInteger(r.salary) && r.salary > 0, `${j.id} rank ${i + 1}`);
      if (i) assert.ok(r.salary > j.ranks[i - 1].salary, `${j.id}: salaries increase`);
    });
    assert.ok(STAT_KEYS.includes(j.rankUp.stat) && j.rankUp.base > 0 && j.rankUp.perStat >= 0 && j.rankUp.expNeeded >= 1, j.id);
    assert.ok(j.injuryRisk >= 0 && j.injuryRisk < 0.5);
    for (const [k, v] of Object.entries(j.requires?.stats ?? {})) assert.ok(STAT_KEYS.includes(k) && v >= 0 && v <= 10, `${j.id}: ${k}`);
    if (j.requires?.education) assert.ok(['college', 'elite'].includes(j.requires.education));
  }
  assert.equal(data.jobs.partTime.id, PART_TIME_ID);
  for (const j of hidden) {
    const u = j.unlock;
    assert.ok(u && u.desc, `${j.id} unlock`);
    for (const k of Object.keys(u)) assert.ok(['era', 'stats', 'money', 'netWorth', 'badEvents', 'maxRankOf', 'desc'].includes(k), `${j.id}: ${k}`);
    for (const id of u.maxRankOf ?? []) assert.ok(regular.some((r) => r.id === id));
    for (const e of u.era ?? []) assert.ok(ERA_IDS.includes(e));
  }
  // sports / fighting carry an injury risk, desk jobs don't
  for (const id of ['baseball', 'soccer', 'fighter']) assert.ok(jobDef(data, id).injuryRisk > 0.05, id);
  for (const id of ['civil_servant', 'office_worker', 'teacher']) assert.equal(jobDef(data, id).injuryRisk, 0);
});

test('avatars.eraOutfits (contract) uses existing outfits; job eras defer to the job outfit', () => {
  assert.deepEqual(avatars.eraOutfits, {
    baby: { any: 'dino' },
    elem: { any: 'tracksuit' },
    middle: { boy: 'uniform', girl: 'sailor' },
    high: { boy: 'uniform', girl: 'sailor' },
    young: { job: true },
    middle_age: { job: true },
    senior: { any: 'hanbokTrad' },
  });
  for (const entry of Object.values(avatars.eraOutfits)) for (const [k, v] of Object.entries(entry)) if (k !== 'job') assert.ok(OUTFITS.has(v), v);
  assert.deepEqual(Object.keys(avatars.eraOutfits), ERA_IDS);
});

test('events.json: ≥ 60 events across eras, valid effects / presentation / conditions', () => {
  const list = data.events.events;
  assert.ok(list.length >= 60, `${list.length} events`);
  const ids = new Set();
  const jobIds = new Set([...data.jobs.jobs.map((j) => j.id), PART_TIME_ID, 'any', 'none', 'parttime']);
  for (const e of list) {
    assert.ok(!ids.has(e.id), `duplicate ${e.id}`);
    ids.add(e.id);
    assert.ok(e.text.includes('{name}'), `${e.id}: {name}`);
    for (const era of e.eras ?? []) assert.ok(ERA_IDS.includes(era), `${e.id}: era ${era}`);
    if (e.money) assert.ok(Number.isInteger(e.money.min) && Number.isInteger(e.money.max) && e.money.min <= e.money.max, e.id);
    for (const [k, v] of Object.entries(e.stats ?? {})) assert.ok(STAT_KEYS.includes(k) && Number.isInteger(v) && v !== 0, `${e.id}: ${k}`);
    assert.ok(TONE_OK(e.tone), `${e.id}: tone ${e.tone}`);
    if (e.scene) assert.ok(SCENES.includes(e.scene), `${e.id}: scene`);
    assert.ok(e.emotion === null || EMOTIONS.includes(e.emotion), `${e.id}: emotion`);
    if (e.lineTag) assert.ok(lines.tags[e.lineTag], `${e.id}: lineTag ${e.lineTag}`);
    for (const k of Object.keys(e.conditions ?? {})) assert.ok(['job', 'education', 'route'].includes(k), `${e.id}: condition ${k}`);
    for (const j of [e.conditions?.job ?? []].flat()) assert.ok(jobIds.has(j), `${e.id}: job ${j}`);
    for (const r of [e.conditions?.route ?? []].flat()) assert.ok(['love', 'career', 'money'].includes(r));
    for (const d of [e.conditions?.education ?? []].flat()) assert.ok(['none', 'college', 'elite'].includes(d));
    if (e.kind) assert.equal(e.kind, 'groupGift');
  }
  // every era has its own events (not just the all-era ones), and the kids eras raise stats
  for (const era of ERA_IDS) assert.ok(list.filter((e) => e.eras?.includes(era)).length >= 6, `${era} events`);
  for (const k of Object.keys(data.tones.eventScenes)) assert.ok(ids.has(k), `eventScenes.${k}`);
  // conditions
  const ev = (conditions) => ({ id: 'x', conditions });
  const worker = { job: { id: 'doctor' }, education: 'college', route: 'career' };
  const pt = { job: { id: PART_TIME_ID }, education: 'none', route: 'love' };
  const none = { job: null, education: 'elite', route: null };
  assert.equal(eventConditionsMet(ev({ job: 'any' }), worker), true);
  assert.equal(eventConditionsMet(ev({ job: 'any' }), pt), false);
  assert.equal(eventConditionsMet(ev({ job: ['parttime', 'none'] }), pt), true);
  assert.equal(eventConditionsMet(ev({ job: ['parttime', 'none'] }), none), true);
  assert.equal(eventConditionsMet(ev({ job: ['parttime', 'none'] }), worker), false);
  assert.equal(eventConditionsMet(ev({ job: 'doctor', education: ['college', 'elite'], route: 'career' }), worker), true);
  assert.equal(eventConditionsMet(ev({ education: 'elite' }), worker), false);
  assert.equal(eventConditionsMet(ev({ route: 'money' }), worker), false);
  const youngPool = eventPool(data, 'young', pt).map((e) => e.id);
  assert.ok(youngPool.includes('interview_fail') && !youngPool.includes('surprise_bonus') && !youngPool.includes('dividend'));
  assert.ok(eventPool(data, 'young', worker).map((e) => e.id).includes('surprise_bonus'));
});

test('news.json: ≥ 20 news, never baby, known effect keys, valid tones', () => {
  const list = data.news.news;
  assert.ok(list.length >= 20);
  const ids = new Set();
  for (const n of list) {
    assert.ok(!ids.has(n.id));
    ids.add(n.id);
    assert.ok(n.title && n.text, n.id);
    assert.ok(TONE_OK(n.tone), `${n.id}: tone`);
    for (const e of n.eras ?? []) assert.ok(ERA_IDS.includes(e) && e !== 'baby', `${n.id}: era ${e}`);
    assert.ok(Object.keys(n.effects).length, n.id);
    for (const [k, v] of Object.entries(n.effects)) {
      assert.ok(Object.hasOwn(NEWS_DEFAULTS, k), `${n.id}: effect ${k}`);
      if (k === 'statBonus') for (const s of Object.keys(v)) assert.ok(STAT_KEYS.includes(s));
      if (k === 'jobDelta') for (const j of Object.keys(v)) assert.ok(jobDef(data, j), `${n.id}: job ${j}`);
    }
  }
  for (const era of ERA_IDS.filter((e) => e !== 'baby')) assert.ok(list.filter((n) => !n.eras || n.eras.includes(era)).length >= 4, era);
  assert.ok(list.some((n) => n.effects.jobRequireDelta > 0), '취업 한파');
  assert.ok(list.some((n) => n.effects.eventMoneyMult > 1), '코인 열풍');
});

// ---------- job offers ----------

test('job offer: requirements, education, news deltas; ≤ 3 distinct weighted candidates; 알바 fallback', () => {
  let { c, tx } = sandbox({ patch: { stats: { int: 2, str: 2, charm: 2, luck: 2 } } });
  assert.deepEqual(eligibleJobs(tx, c), []);
  assert.equal(offerJob(tx, c), false, 'nothing eligible → 알바 at once');
  const jc = tx.events.find((e) => e.type === 'jobChanged');
  assert.deepEqual([jc.jobId, jc.reason, jc.rank], [PART_TIME_ID, 'parttime', 1]);
  assert.equal(c.job.id, PART_TIME_ID);

  ({ c, tx } = sandbox({ patch: { stats: { int: 3, str: 2, charm: 2, luck: 2 } } }));
  assert.deepEqual(eligibleJobs(tx, c).map((j) => j.id), ['civil_servant']);
  // 취업 한파 (+1 to every requirement) → nothing left
  ({ c, tx } = sandbox({ patch: { stats: { int: 3, str: 2, charm: 2, luck: 2 } }, news: { young: 'job_freeze' } }));
  assert.deepEqual(eligibleJobs(tx, c), []);
  assert.equal(jobRequirements(jobDef(data, 'civil_servant'), { jobRequireDelta: 1 }).int, 4);
  // e스포츠 붐: esports −2 (luck 2 is enough)
  ({ c, tx } = sandbox({ patch: { stats: { int: 2, str: 2, charm: 2, luck: 2 } }, news: { young: 'esports_boom' } }));
  assert.deepEqual(eligibleJobs(tx, c).map((j) => j.id), ['esports', 'youtuber']); // esports −2, youtuber −1
  // education gates: 지력 6 without a degree → no doctor / researcher / teacher / office
  ({ c, tx } = sandbox({ patch: { stats: { int: 6, str: 2, charm: 2, luck: 2 } } }));
  const noDegree = eligibleJobs(tx, c).map((j) => j.id);
  for (const id of ['doctor', 'researcher', 'teacher', 'office_worker']) assert.ok(!noDegree.includes(id), id);
  c.education = 'college';
  const degree = eligibleJobs(tx, c).map((j) => j.id);
  for (const id of ['doctor', 'researcher', 'teacher', 'office_worker', 'civil_servant']) assert.ok(degree.includes(id), id);
  assert.ok(!degree.some((id) => jobDef(data, id).hidden), 'hidden jobs are never offered');
  // candidates: distinct, ≤ offerCount, and demanding jobs weigh more
  const cand = offerCandidates(tx, c);
  assert.equal(cand.length, data.balance.jobs.offerCount);
  assert.equal(new Set(cand).size, cand.length);
  assert.ok(offerWeight(jobDef(data, 'doctor'), data) > offerWeight(jobDef(data, 'civil_servant'), data));
  assert.deepEqual(offerCandidates(tx, c, { exclude: degree.slice(1) }), [degree[0]]);
  // prompt through the engine: options carry jobId + desc
  assert.equal(offerJob(tx, c), true);
  const p = tx.room.turn.pending;
  assert.equal(p.kind, 'jobOffer');
  for (const o of p.options) assert.deepEqual([o.jobId, typeof o.desc], [o.id, 'string']);
});

// ---------- salary / rank-up / injury ----------

test('salary: rank pay × era × news, injury cut, 알바 when jobless, military pay while serving', () => {
  const J = data.balance.jobs;
  let { c, tx } = sandbox();
  setJob(c, 'office_worker', 2);
  const base = jobDef(data, 'office_worker').ranks[1].salary;
  assert.equal(salaryAmount(tx, c), base * J.salaryEraMult.young);
  c.era = 'middle_age';
  assert.equal(salaryAmount(tx, c), Math.round((base * J.salaryEraMult.middle_age) / 5) * 5);
  c.era = 'young';
  tx.room.news = { young: 'pay_raise' };
  assert.equal(salaryAmount(tx, c), Math.round((base * 1.2) / 5) * 5);
  tx.room.news = {};
  c.job.injured = 1;
  assert.equal(salaryAmount(tx, c), Math.round((base * J.injurySalaryMult) / 5) * 5);
  c.job = null;
  assert.equal(salaryAmount(tx, c), data.jobs.partTime.ranks[0].salary);
  tx.room.news = { young: 'min_wage' };
  assert.equal(salaryAmount(tx, c), Math.round((data.jobs.partTime.ranks[0].salary * 1.5) / 5) * 5);

  // salary tile through the engine: salary + moneyChanged(reason salary) + exp; landing stays on the board
  const room = started();
  const id = cur(room);
  Object.assign(ch(room, id), { position: { eraIndex: 4, route: 'career', index: 0 }, era: 'young', route: 'career', careerDone: true, military: { status: 'done', turnsLeft: 0 } });
  setJob(ch(room, id), 'police', 1);
  room.board.eras[4].routes.career.tiles[1] = { id: 'young:career:1', type: 'salary', label: '월급날', route: 'career' };
  const r = act(room, { type: 'spin', characterId: id }, { ints: [1], nexts: [0.99, 0.99] });
  const sal = r.events.find((e) => e.type === 'salary');
  assert.deepEqual([sal.jobId, sal.rank, sal.amount, sal.cutin], ['police', 1, jobDef(data, 'police').ranks[0].salary, false]);
  const m = r.events.find((e) => e.type === 'moneyChanged' && e.reason === 'salary');
  assert.equal(m.delta, sal.amount);
  assert.equal(r.events.find((e) => e.type === 'landed').cutin, false);
  assert.equal(ch(r.room, id).job.exp, J.expPerSalary);
  // serving: military pay instead
  ({ c, tx } = sandbox({ patch: { military: { status: 'serving', turnsLeft: 1 } } }));
  setJob(c, 'police', 1);
  paySalary(tx, c);
  assert.ok(!tx.events.some((e) => e.type === 'salary'));
  assert.equal(tx.events.find((e) => e.type === 'moneyChanged').reason, 'military');
});

test('rank-up: chance formula, passive at expNeeded (seeded), stat +1, history; injury blocks; max rank', () => {
  const J = data.balance.jobs;
  let { c, tx } = sandbox({ patch: { stats: { int: 6, str: 2, charm: 2, luck: 4 }, education: 'college' } });
  setJob(c, 'office_worker', 1);
  const ru = jobDef(data, 'office_worker').rankUp;
  const want = ru.base + ru.perStat * 6 + J.luckBonus * 4 + J.educationBonus.college;
  assert.ok(Math.abs(rankUpChance(tx, c) - Math.min(J.maxChance, want)) < 1e-9);
  assert.ok(Math.abs(rankUpChance(tx, c, { exam: true }) - Math.min(J.maxChance, want + J.examBonus)) < 1e-9);
  tx.room.news = { young: 'restructuring' };
  c.era = 'young';
  assert.ok(rankUpChance(tx, c) <= Math.min(J.maxChance, want)); // restructuring is middle_age only → no change in young
  tx.room.news = {};
  assert.equal(tryRankUp(tx, c), ru.expNeeded > 0 ? 'notReady' : 'fail');
  c.job.exp = ru.expNeeded;
  tx.rng = fixedRng({ nexts: [0.999] });
  assert.equal(tryRankUp(tx, c), 'fail');
  assert.equal(c.job.rank, 1);
  tx.rng = fixedRng({ nexts: [0] });
  assert.equal(tryRankUp(tx, c), 'up');
  assert.deepEqual([c.job.rank, c.job.exp], [2, 0]);
  const up = tx.events.find((e) => e.type === 'rankUp');
  assert.deepEqual([up.jobId, up.rank, up.rankName], ['office_worker', 2, '대리']);
  assert.ok(tx.events.some((e) => e.type === 'statChanged' && e.stat === 'int' && e.reason === 'rankUp'));
  assert.equal(c.jobHistory.at(-1).rank, 2);
  c.job.injured = 1;
  c.job.exp = 9;
  assert.equal(tryRankUp(tx, c), 'blocked');
  c.job.injured = 0;
  c.job.rank = jobDef(data, 'office_worker').ranks.length;
  assert.equal(tryRankUp(tx, c, { exam: true }), 'max');
});

test('injury: risky jobs roll injuryRisk (× news), injured turns count down per spin; desk jobs never', () => {
  let { c, tx } = sandbox();
  setJob(c, 'soccer', 1);
  tx.rng = fixedRng({ nexts: [0] });
  assert.equal(rollInjury(tx, c), true);
  const ev = tx.events.find((e) => e.type === 'injured');
  assert.deepEqual([ev.jobId, ev.turns], ['soccer', data.balance.jobs.injuryTurns]);
  assert.equal(c.job.injured, data.balance.jobs.injuryTurns);
  assert.equal(rollInjury(tx, c), false, 'already injured');
  tx.rng = fixedRng({ nexts: [jobDef(data, 'soccer').injuryRisk + 0.01] });
  c.job.injured = 0;
  assert.equal(rollInjury(tx, c), false);
  ({ c, tx } = sandbox());
  setJob(c, 'civil_servant', 1);
  assert.equal(rollInjury(tx, c), false);
  // count-down through the engine
  const room = started();
  const id = cur(room);
  Object.assign(ch(room, id), { era: 'young', careerDone: true, military: { status: 'done', turnsLeft: 0 } });
  setJob(ch(room, id), 'soccer', 1, { injured: 2 });
  const r = act(room, { type: 'spin', characterId: id }, { ints: [1] });
  assert.equal(ch(r.room, id).job.injured, 1);
});

test('job tile: 승진 시험 / 전직 / 야근 (money + exp, 체력 −1); results anchor only without another anchor', () => {
  const room = started();
  const id = cur(room);
  Object.assign(ch(room, id), {
    position: { eraIndex: 4, route: 'career', index: 0 },
    era: 'young',
    route: 'career',
    careerDone: true,
    military: { status: 'done', turnsLeft: 0 },
    stats: { int: 5, str: 5, charm: 5, luck: 5 },
  });
  setJob(ch(room, id), 'police', 1);
  room.board.eras[4].routes.career.tiles[1] = { id: 'young:career:1', type: 'job', label: '직업', route: 'career' };
  const r = act(room, { type: 'spin', characterId: id }, { ints: [1] });
  const p = r.room.turn.pending;
  assert.equal(p.kind, 'jobTile');
  assert.deepEqual(p.options.map((o) => o.id), ['promotion', 'change', 'overtime']);
  const change = p.options.find((o) => o.id === 'change');
  assert.ok(change.jobId && change.jobId !== 'police' && !jobDef(data, change.jobId).hidden);
  assert.equal(p.context.candidate, change.jobId);
  const pick = (opt, rng) => act(r.room, { type: 'choose', characterId: id, promptId: p.promptId, optionId: opt }, rng);
  // promotion success → rankUp anchor, no promptResolved
  const up = pick('promotion', { nexts: [0, 0.99] });
  assert.ok(up.events.some((e) => e.type === 'rankUp'));
  assert.ok(!up.events.some((e) => e.type === 'promptResolved'));
  // failure → promptResolved{result: failed} + exp +1
  const fail = pick('promotion', { nexts: [0.999, 0.999] });
  assert.equal(fail.events.find((e) => e.type === 'promptResolved').result, 'failed');
  assert.equal(ch(fail.room, id).job.exp, 1);
  // change → jobChanged(change), rank 1, history keeps both
  const chg = pick('change', {});
  const jc = chg.events.find((e) => e.type === 'jobChanged');
  assert.deepEqual([jc.reason, jc.jobId, jc.fromJobId, jc.rank], ['change', change.jobId, 'police', 1]);
  assert.deepEqual(ch(chg.room, id).jobHistory.map((h) => h.id), ['police', change.jobId]);
  // overtime → money + exp + 체력 −1, result anchor with the chips after it
  const ot = pick('overtime', { nexts: [0.999] });
  const pr = ot.events.find((e) => e.type === 'promptResolved');
  assert.deepEqual([pr.result, pr.lineTag], ['overtime', 'overtime']);
  assert.ok(ot.events.some((e) => e.type === 'moneyChanged' && e.reason === 'overtime' && e.delta > 0));
  assert.equal(ch(ot.room, id).stats.str, 4);
  assert.ok(ch(ot.room, id).job.exp >= data.balance.jobs.overtime.exp || ot.events.some((e) => e.type === 'rankUp'));
  // at max rank the promotion becomes a 성과급 negotiation
  const top = structuredClone(room);
  ch(top, id).job.rank = jobDef(data, 'police').ranks.length;
  const t = act(top, { type: 'spin', characterId: id }, { ints: [1] });
  assert.equal(t.room.turn.pending.options[0].id, 'bonus');
  // students / soldiers only look around
  const stud = structuredClone(room);
  ch(stud, id).school = { tier: 'college', turnsLeft: 1 };
  ch(stud, id).job = null;
  const s = act(stud, { type: 'spin', characterId: id }, { ints: [1] });
  assert.ok(!s.events.some((e) => e.type === 'prompt' && e.kind === 'jobTile'));
});

// ---------- hidden jobs ----------

test('hidden jobs: all 6 unlock conditions (boundaries), unlock event once, offer → accept / decline', () => {
  const def = (id) => jobDef(data, id);
  const check = (id, patch, want, era = 'young') => {
    const { c, tx } = sandbox({ era, patch });
    assert.equal(unlockMet(tx, c, def(id)), want, `${id} ${JSON.stringify(patch)} → ${want}`);
  };
  const S = (o) => ({ stats: { int: 2, str: 2, charm: 2, luck: 2, ...o } });
  // 우주비행사: 지력 9 & 체력 9
  check('astronaut', S({ int: 9, str: 9 }), true);
  check('astronaut', S({ int: 9, str: 8 }), false);
  // 국민 MC: 개그맨/배우/유튜버 최고 랭크 + 매력 9 (current job or history)
  const maxOf = (id) => def(id).ranks.length;
  check('national_mc', { ...S({ charm: 9 }), job: { id: 'comedian', rank: maxOf('comedian'), exp: 0, injured: 0 } }, true);
  check('national_mc', { ...S({ charm: 9 }), job: { id: 'civil_servant', rank: 1, exp: 0, injured: 0 }, jobHistory: [{ id: 'youtuber', rank: maxOf('youtuber'), era: 'young' }] }, true);
  check('national_mc', { ...S({ charm: 8 }), job: { id: 'actor', rank: maxOf('actor'), exp: 0, injured: 0 } }, false);
  check('national_mc', { ...S({ charm: 9 }), job: { id: 'actor', rank: maxOf('actor') - 1, exp: 0, injured: 0 } }, false);
  // 재벌 총수: 대기업 최고 랭크 + 순자산
  const nw = def('chaebol').unlock.netWorth;
  check('chaebol', { job: { id: 'office_worker', rank: maxOf('office_worker'), exp: 0, injured: 0 }, money: nw, debt: 0 }, true);
  check('chaebol', { job: { id: 'office_worker', rank: maxOf('office_worker'), exp: 0, injured: 0 }, money: nw, debt: 1 }, false);
  check('chaebol', { job: { id: 'office_worker', rank: 1, exp: 0, injured: 0 }, money: nw * 2, debt: 0 }, false);
  // 트로트 스타: 노년 + 매력 8 & 운 8
  check('trot_star', S({ charm: 8, luck: 8 }), true, 'senior');
  check('trot_star', S({ charm: 8, luck: 8 }), false, 'middle_age');
  check('trot_star', S({ charm: 8, luck: 7 }), false, 'senior');
  // 산신령 (임시): 운 9 + 나쁜 일 3번
  check('mountain_spirit', { ...S({ luck: 9 }), badEvents: 3 }, true);
  check('mountain_spirit', { ...S({ luck: 9 }), badEvents: 2 }, false);
  // 건물주 (임시): 중년 + 현금
  const cash = def('landlord').unlock.money;
  check('landlord', { money: cash }, true, 'middle_age');
  check('landlord', { money: cash - 1 }, false, 'middle_age');
  check('landlord', { money: cash }, false, 'young');
  assert.equal(hiddenJobs(data).length, 6);

  // unlock once + engine offer at the end of the turn
  const { c, tx } = sandbox({ patch: S({ int: 9, str: 9 }) });
  assert.deepEqual(checkHiddenUnlocks(tx, c), ['astronaut']);
  assert.deepEqual(checkHiddenUnlocks(tx, c), [], 'only once');
  assert.deepEqual(c.hiddenUnlocked, ['astronaut']);
  const kids = sandbox({ era: 'high', patch: S({ int: 9, str: 9 }) });
  assert.deepEqual(checkHiddenUnlocks(kids.tx, kids.c), [], 'kids eras never unlock');

  const room = started();
  const id = cur(room);
  Object.assign(ch(room, id), { era: 'young', position: { eraIndex: 4, route: 'career', index: 0 }, route: 'career', careerDone: true, military: { status: 'done', turnsLeft: 0 }, stats: { int: 9, str: 9, charm: 2, luck: 2 } });
  setJob(ch(room, id), 'police', 1);
  room.board.eras[4].routes.career.tiles[1] = { id: 'young:career:1', type: 'loss', amount: 5, label: 'x', route: 'career' };
  const r = act(room, { type: 'spin', characterId: id }, { ints: [1] });
  const un = r.events.find((e) => e.type === 'hiddenJobUnlocked');
  assert.deepEqual([un.jobId, un.cutin, un.mcKey], ['astronaut', true, 'hiddenJob']);
  const p = r.room.turn.pending;
  assert.deepEqual([p.kind, p.options.map((o) => o.id)], ['hiddenJobOffer', ['accept', 'decline']]);
  const acc = act(r.room, { type: 'choose', characterId: id, promptId: p.promptId, optionId: 'accept' });
  const jc = acc.events.find((e) => e.type === 'jobChanged');
  assert.deepEqual([jc.reason, jc.jobId, jc.fromJobId], ['hidden', 'astronaut', 'police']);
  assert.equal(ch(acc.room, id).job.id, 'astronaut');
  // decline → re-offered on the next job tile
  const dec = act(r.room, { type: 'choose', characterId: id, promptId: p.promptId, optionId: 'decline' });
  const room2 = dec.room;
  room2.turn.currentIndex = room2.turn.order.indexOf(id);
  room2.turn.phase = 'awaitSpin';
  room2.board.eras[4].routes.career.tiles[2] = { id: 'young:career:2', type: 'job', label: '직업', route: 'career' };
  const again = act(room2, { type: 'spin', characterId: id }, { ints: [1] });
  assert.equal(again.room.turn.pending.kind, 'hiddenJobOffer');
});

// ---------- presentation / MC ----------

test('presentation: Stage 6 event types registered; cut-in anchors vs chips; job scenes; lines exist', () => {
  for (const t of ['statChanged', 'jobChanged', 'rankUp', 'salary', 'injured', 'hiddenJobUnlocked', 'newsFlash', 'militaryStart', 'militaryEnd', 'educationChanged']) {
    assert.ok(EVENT_TYPES.includes(t), t);
  }
  for (const t of ['jobChanged', 'rankUp', 'hiddenJobUnlocked', 'injured', 'newsFlash', 'militaryStart', 'educationChanged']) assert.ok(CUTIN_TYPES.has(t), t);
  for (const t of ['statChanged', 'salary', 'militaryEnd']) assert.ok(!CUTIN_TYPES.has(t), t);
  const room = started();
  const c = room.characters[0].id;
  const events = [
    { type: 'jobChanged', charId: c, jobId: 'doctor', fromJobId: null, rank: 1, reason: 'hire' },
    { type: 'statChanged', charId: c, stat: 'int', delta: 1, value: 5, reason: 'rankUp' },
    { type: 'rankUp', charId: c, jobId: 'teacher', rank: 2, rankName: '정교사' },
    { type: 'salary', charId: c, jobId: 'teacher', rank: 2, amount: 300 },
    { type: 'injured', charId: c, jobId: 'soccer', turns: 2 },
    { type: 'newsFlash', eraId: 'young', newsId: 'job_freeze', title: '취업 한파', text: 'x', tone: 'bad' },
    { type: 'militaryStart', charId: c, turns: 2 },
    { type: 'educationChanged', charId: c, education: 'elite' },
  ];
  decorateEvents(events, { room, data, seed: 3 });
  const [hire, stat, rank, sal, inj, news, mil, edu] = events;
  assert.deepEqual([hire.cutin, hire.scene, hire.lineTag], [true, 'hospital', 'hire']);
  assert.ok(hire.line.length > 0 && !/\{\w+\}/.test(hire.line));
  assert.deepEqual([stat.cutin, stat.lineTag, stat.tone], [false, 'stat_up', 'good']);
  assert.deepEqual([rank.cutin, rank.scene, rank.lineTag], [true, 'school', 'promotion']);
  assert.deepEqual([sal.cutin, sal.tone], [false, 'career']);
  assert.deepEqual([inj.cutin, inj.scene, inj.tone, inj.emotion], [true, 'hospital', 'bad', 'cry']);
  assert.deepEqual([news.cutin, news.tone, news.lineTag], [true, 'bad', 'news']);
  assert.ok(news.line.includes('취업 한파') || !news.line.includes('{news}'));
  assert.deepEqual([mil.cutin, mil.scene], [true, 'army']); // Stage 7 scenes
  assert.deepEqual([edu.cutin, edu.scene, edu.lineTag], [true, 'campus', 'graduation']);
  for (const e of events) {
    assert.ok(TONES.includes(e.tone) && SCENES.includes(e.scene) && EMOTIONS.includes(e.emotion), e.type);
    assert.ok(lines.tags[e.lineTag], `${e.type}: ${e.lineTag}`);
  }
  // prompts: every new kind has a tag + line
  for (const kind of ['habit', 'career', 'military', 'jobOffer', 'jobTile', 'hiddenJobOffer']) {
    const e = [{ type: 'prompt', kind, charId: c, promptId: 'p1', forCharacterIds: [c], options: [] }];
    decorateEvents(e, { room, data, seed: 1 });
    assert.ok(lines.tags[e[0].lineTag] && e[0].line, kind);
  }
});

test('MC: job / promotion / hiddenJob / injury / military / news only on real outcomes; news = studio', () => {
  const room = started();
  room.config.mcFrequency = 'many';
  const c = room.characters[0].id;
  const run = (ev) => {
    const r = structuredClone(room);
    r.mcState = { cool: 0, eras: ['baby'], firstSpin: true };
    const events = [ev];
    attachMc(events, { room: r, data, seed: 5 });
    return events[0];
  };
  assert.equal(run({ type: 'jobChanged', charId: c, jobId: 'doctor', reason: 'hire', rank: 1 }).mcKey, 'job');
  assert.equal(run({ type: 'jobChanged', charId: c, jobId: 'doctor', reason: 'change', rank: 1 }).mcKey, undefined);
  assert.equal(run({ type: 'jobChanged', charId: c, jobId: PART_TIME_ID, reason: 'parttime', rank: 1 }).mcKey, undefined);
  assert.equal(run({ type: 'rankUp', charId: c, jobId: 'doctor', rank: 2, rankName: '레지던트' }).mcKey, 'promotion');
  assert.equal(run({ type: 'hiddenJobUnlocked', charId: c, jobId: 'astronaut' }).mcKey, 'hiddenJob');
  assert.equal(run({ type: 'injured', charId: c, jobId: 'soccer', turns: 2 }).mcKey, 'injury');
  assert.equal(run({ type: 'militaryStart', charId: c, turns: 2 }).mcKey, 'military');
  const news = run({ type: 'newsFlash', eraId: 'young', newsId: 'coin_boom', title: '코인 열풍', text: 'x', tone: 'treasure' });
  assert.deepEqual([news.mcKey, news.mcStudio, news.mcWeight], ['news', true, 'big']);
  assert.ok(news.mc.length >= 2 && news.mc.some((l) => l.speaker === 'bomi' && l.line.includes('코인 열풍')) || news.mc.some((l) => l.line.includes('코인 열풍')));
  for (const e of [run({ type: 'rankUp', charId: c, jobId: 'doctor', rank: 2, rankName: '레지던트' })]) assert.ok(e.mc.every((l) => !/\{\w+\}/.test(l.line)));
  // job tile landing (no outcome) stays quiet
  assert.equal(run({ type: 'landed', charId: c, tileType: 'job', tileId: 't' }).mcKey, undefined);
});

test('full random lifetime games: every event type / line tag is known; no unfilled placeholders', () => {
  const seen = new Set();
  for (const seed of [3, 11]) {
    let room = started({ seed, chars: [['A', 'A1', { body: 'boy' }], ['B', 'B1', { body: 'girl' }], ['A', 'A2', { body: 'girl' }]] });
    for (let i = 0; i < 2000 && room.status === 'playing'; i++) {
      const p = room.turn.pending;
      const action = p
        ? { type: 'choose', characterId: p.forCharacterIds.find((x) => !Object.hasOwn(p.answers, x)), promptId: p.promptId, optionId: ((o) => o[(seed + i) % o.length].id)(p.options.filter((x) => !x.disabled)) }
        : { type: 'spin', characterId: cur(room) };
      const r = applyAction(room, action, { now: i });
      room = r.room;
      room.log = [];
      for (const e of r.events) {
        seen.add(e.type);
        assert.ok(EVENT_TYPES.includes(e.type), e.type);
        if (e.type === 'chose' || e.type === 'betPlaced') continue;
        assert.ok(lines.tags[e.lineTag], `${e.type}: tag ${e.lineTag}`);
        assert.ok(!/\{\w+\}/.test(e.line ?? ''), `${e.type}: "${e.line}"`);
        for (const l of e.mc ?? []) assert.ok(!/\{\w+\}/.test(l.line), `${e.type} mc: "${l.line}"`);
      }
    }
    assert.equal(room.status, 'finished');
    for (const c of room.characters) assert.ok(c.job, `${c.name} ends with a job`);
  }
  for (const t of ['statChanged', 'jobChanged', 'salary', 'newsFlash', 'educationChanged', 'militaryStart', 'militaryEnd']) assert.ok(seen.has(t), t);
});

// ---------- config / view / meta ----------

test('config: growthOutfits boolean (default true); viewFor exposes the Stage 6 fields to everyone', () => {
  assert.equal(validateRoomConfig({}).config.growthOutfits, true);
  assert.equal(validateRoomConfig({ growthOutfits: false }).config.growthOutfits, false);
  for (const bad of ['yes', 1, null, 'false']) {
    const r = validateRoomConfig({ growthOutfits: bad });
    assert.equal(r.ok, false);
    assert.match(r.errors[0], /성장 의상/);
  }
  const room = started();
  const c = room.characters[0];
  setJob(c, 'chef', 2);
  c.hiddenUnlocked = ['astronaut'];
  room.news = { elem: 'coding_edu' };
  const other = viewFor(room, 'B').characters.find((x) => x.id === c.id);
  for (const k of ['stats', 'education', 'examResult', 'military', 'job', 'jobHistory', 'hiddenUnlocked']) assert.deepEqual(other[k], c[k], k);
  assert.deepEqual(viewFor(room, null).news, { elem: 'coding_edu' });
});

test('GET /api/meta serves jobs, news and balance.stats; admin rooms accept growthOutfits', async (t) => {
  const tmp = await tempDir();
  const srv = await startServer({ port: 0, host: '127.0.0.1', dataDir: tmp.dir, adminPassword: 'pw', debounceMs: 10, log: () => {} });
  t.after(async () => {
    await srv.close();
    await tmp.cleanup();
  });
  const meta = (await httpCall(srv.url, 'GET', '/api/meta')).json;
  assert.equal(meta.jobs.jobs.length, 23);
  assert.equal(meta.jobs.partTime.id, PART_TIME_ID);
  assert.ok(meta.news.news.length >= 20);
  assert.equal(meta.balance.stats.cap, 10);
  assert.deepEqual(meta.avatars.eraOutfits.young, { job: true });
  assert.ok(meta.board.tileTypes.salary && meta.board.tileTypes.habit);
  const login = await httpCall(srv.url, 'POST', '/admin/api/login', { body: { password: 'pw' } });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const room = await httpCall(srv.url, 'POST', '/admin/api/rooms', { cookie, body: { growthOutfits: false } });
  assert.equal(room.status, 201);
  assert.equal(room.json.room.config.growthOutfits, false);
  assert.equal((await httpCall(srv.url, 'POST', '/admin/api/rooms', { cookie, body: { growthOutfits: 'no' } })).status, 400);
});
