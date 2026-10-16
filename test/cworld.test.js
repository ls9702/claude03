// 세계 설정 (🐹 치이카와 모드 / 🏙️ 현실 모드) — server: the overlay format + worldData memo, room config, the real world
// unchanged, the Chiikawa job set, 토벌 / 풀뽑기 검정 / 쿠지 rules (seeded), presentation + MC, CPU answers at both levels,
// old saves = real, a random Chiikawa lifetime game, HTTP meta + room create with a world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameData, getWorldOverlays, loadData } from '../server/data/index.js';
import { DEFAULT_WORLD, WORLDS, WORLD_INFO, applyPatch, dataForWorld, dataWorld, patchProblems, roomData, worldData, worldOf } from '../server/game/world.js';
import { defaultRoomConfig, validateRoomConfig } from '../server/game/config.js';
import { applyAction, startGame } from '../server/game/engine.js';
import { createTx } from '../server/game/effects.js';
import { addCharacter, addCpuCharacter, joinRoom } from '../server/game/lobby.js';
import { openPrompt, resolvePrompt, ANCHOR_TYPES } from '../server/game/prompts.js';
import { resolveTile } from '../server/game/spaces.js';
import { WEED_MAX, huntChance, monsterPool, weedExamChance, weedExamFee, weedGrade, weedWorkAmount } from '../server/game/hunt.js';
import { jobDef, meetsRequirements, meritNeeded, regularJobs, salaryAmount, unlockMet } from '../server/game/jobs.js';
import { kujiDraw, kujiExpectedValue, kujiPrizes, lottoDraw } from '../server/game/holidays.js';
import { CUTIN_TYPES, EVENT_TYPES, SCENES, decorateEvents, presentationFor } from '../server/game/presentation.js';
import { PERSONALITIES, cpuAnswer, cpuDecide, cpuDreamJob, cpuNextAction } from '../server/game/cpu.js';
import { computeTitles } from '../server/game/awards.js';
import { NEWS_DEFAULTS, newsEffects } from '../server/game/news.js';
import { startServer } from '../server/index.js';
import { httpCall, makeRoom, tempDir } from './helpers.js';

const real = gameData();
const cw = dataForWorld('chiikawa');
const SHORT = { baby: 1, elem: 1, middle: 1, high: 1, young: 4, middle_age: 4 };

function fixedRng({ ints = [], nexts = [] } = {}) {
  const qi = [...ints];
  const qn = [...nexts];
  return { next: () => (qn.length ? qn.shift() : 0), int: (a) => (qi.length ? qi.shift() : a), pick: (arr) => arr[0], weighted: (items) => items[0], get state() { return 4242; } };
}
function started({ world = 'chiikawa', seed = 7 } = {}) {
  let room = makeRoom({ seed });
  room.config = { ...room.config, world };
  if (world === null) delete room.config.world; // an old save: no world at all
  room = joinRoom(room, 'A', '에이', 0).room;
  room = joinRoom(room, 'B', '비', 0).room;
  for (const [o, n] of [['A', 'A1'], ['B', 'B1'], ['A', 'A2']]) room = addCharacter(room, o, { name: n }, 0).room;
  const r = startGame(room, { now: 0 });
  assert.equal(r.ok, true, r.error);
  return r.room;
}
let base = null;
/** A tx over a started Chiikawa room; its first character in `era` with `patch`. */
function sandbox({ era = 'young', patch = {}, rng = {}, world = 'chiikawa' } = {}) {
  base ??= started();
  const room = structuredClone(base);
  room.config.world = world;
  const c = room.characters[0];
  Object.assign(c, { era, stats: { int: 3, str: 4, charm: 3, luck: 3 }, money: 1000, debt: 0, job: null, items: [], cards: [] }, patch);
  const tx = createTx(room, { rng: fixedRng(rng), now: 0, data: roomData(room) });
  return { room, c, tx };
}
function answer(sb, kind, optionId, rng = {}) {
  const p = openPrompt(sb.tx, kind, sb.c);
  p.answers[sb.c.id] = optionId;
  sb.tx.rng = fixedRng(rng);
  const at = sb.tx.events.length;
  resolvePrompt(sb.tx);
  return { p, events: sb.tx.events.slice(at) };
}
const ev = (events, type) => events.find((e) => e.type === type);

// ---------- overlay format ----------

test('applyPatch: id arrays replace / add / remove, objects deep-merge, arrays / scalars replace, null deletes, _ keys skipped', () => {
  const baseData = { list: [{ id: 'a', x: 1, y: 2 }, { id: 'b', x: 3 }, { id: 'c' }], obj: { k: 1, arr: [1, 2], deep: { p: 1, q: 2 }, gone: 5 }, keep: 'same' };
  const out = applyPatch(baseData, {
    _comment: 'ignored',
    list: { remove: ['c'], replace: { a: { x: 10, y: null, _n: 'skip' } }, add: [{ id: 'd', z: 4 }] },
    obj: { arr: [9], deep: { q: 3 }, gone: null, added: true },
  });
  assert.deepEqual(out.list, [{ id: 'a', x: 10 }, { id: 'b', x: 3 }, { id: 'd', z: 4 }]);
  assert.deepEqual(out.obj, { k: 1, arr: [9], deep: { p: 1, q: 3 }, added: true });
  assert.equal(out.keep, 'same');
  assert.equal(out._comment, undefined);
  assert.equal(out.list[1], baseData.list[1], 'unchanged entries are shared');
  assert.deepEqual(baseData.list.map((x) => x.id), ['a', 'b', 'c'], 'the base is never mutated');
  // an add of an existing id replaces it (lenient); patchProblems reports what is wrong
  assert.deepEqual(applyPatch([{ id: 'a', v: 1 }], { add: [{ id: 'a', v: 2 }] }), [{ id: 'a', v: 2 }]);
  const probs = patchProblems(baseData, { list: { remove: ['zz'], replace: { yy: {} }, add: [{ id: 'a' }, { x: 1 }] }, obj: { replace: { a: {} } } });
  assert.equal(probs.length, 5, probs.join(' / '));
  // the shipped overlay is clean against the real data
  const ov = getWorldOverlays().chiikawa;
  const all = Object.entries(ov).filter(([k]) => !k.startsWith('_')).flatMap(([k, v]) => patchProblems(real[k], v, k));
  assert.deepEqual(all, []);
});

test('worldData: real = the data itself; Chiikawa memoized + deep-frozen; merged data never re-patched; worldOf / roomData', () => {
  assert.deepEqual(WORLDS, ['chiikawa', 'real']);
  assert.equal(DEFAULT_WORLD, 'chiikawa');
  assert.deepEqual(WORLD_INFO.map((w) => [w.id, w.icon]), [['chiikawa', '🐹'], ['real', '🏙️']]);
  assert.equal(gameData(), real, 'gameData() is cached');
  assert.equal(dataForWorld('real'), real);
  assert.equal(worldData(real, 'real', getWorldOverlays()), real);
  assert.equal(dataForWorld('chiikawa'), cw, 'memoized');
  assert.notEqual(cw, real);
  assert.ok(Object.isFrozen(cw) && Object.isFrozen(cw.jobs.jobs) && Object.isFrozen(cw.jobs.jobs[0]) && Object.isFrozen(cw.balance.kuji));
  assert.equal(worldData(cw, 'chiikawa', getWorldOverlays()), cw, 'a merged object is returned as is for its world');
  assert.equal(worldData(cw, 'real', getWorldOverlays()), real, 'and resolved from its base for another world');
  assert.equal(dataWorld(cw), 'chiikawa');
  assert.equal(dataWorld(real), 'real');
  assert.equal(worldData(real, 'nope', getWorldOverlays()), real);
  assert.equal(worldData(real, 'chiikawa', null), real, 'no overlays → the data as is');
  // unchanged sections are shared with the real data (structural sharing)
  assert.equal(cw.roster, real.roster);
  assert.equal(cw.houses, real.houses);
  // a room without config.world plays the real world; custom test data is respected (and merged for 치이카와)
  assert.equal(worldOf({ config: {} }), 'real');
  assert.equal(worldOf(null), 'real');
  assert.equal(worldOf({ config: { world: 'chiikawa' } }), 'chiikawa');
  assert.equal(worldOf({ config: { world: 'mars' } }), 'real');
  assert.equal(roomData({ config: {} }), real);
  const custom = { ...real, balance: { ...real.balance, spin: { min: 1, max: 6 } } };
  assert.equal(roomData({ config: {} }, custom), custom);
  const merged = roomData({ config: { world: 'chiikawa' } }, custom);
  assert.equal(merged.balance.spin.max, 6);
  assert.equal(merged.balance.lottoMode, 'kuji');
});

test('room config: world chiikawa | real — new rooms default to 🐹 치이카와 모드; anything else → 400 text', () => {
  assert.equal(defaultRoomConfig().world, 'chiikawa');
  assert.equal(validateRoomConfig({}).config.world, 'chiikawa');
  assert.equal(validateRoomConfig({ world: 'real' }).config.world, 'real');
  for (const bad of ['mars', '', null, 1, 'REAL']) {
    const v = validateRoomConfig({ world: bad });
    assert.equal(v.ok, false, String(bad));
    assert.deepEqual(v.errors, ['세계는 치이카와 모드(chiikawa) 또는 현실 모드(real) 중 하나여야 합니다.']);
  }
});

// ---------- the real world stays today's data ----------

test('현실 모드: the data files are the real world (jobs, items, cards, lotto, board pools without 토벌 / 풀뽑기)', () => {
  const ids = real.jobs.jobs.map((j) => j.id);
  for (const id of ['civil_servant', 'doctor', 'politician', 'chef', 'astronaut', 'landlord', 'mountain_spirit']) assert.ok(ids.includes(id), id);
  assert.equal(ids.length, 23);
  assert.equal(real.jobs.partTime.name, '알바');
  assert.deepEqual(real.items.items.map((i) => i.id), ['car', 'laptop', 'gym_pass', 'designer_bag', 'lucky_cat', 'massage_chair']);
  assert.equal(real.items.items[0].name, '경차');
  assert.equal(real.cards.cards.find((k) => k.id === 'pledge').jobOnly, 'politician');
  assert.equal(real.cards.cards.find((k) => k.id === 'lotto').name, '로또 복권');
  assert.equal(real.balance.lottoMode, 'numbers');
  assert.equal(real.treasures.treasures.length, 22);
  assert.ok(!real.treasures.treasures.some((t) => t.id === 'kuji_plush'));
  assert.ok(!real.news.news.some((n) => ['chimera_surge', 'weed_boom', 'ramen_price'].includes(n.id)));
  const pools = [...Object.values(real.board.eras), ...Object.values(real.board.routePools)].flatMap((e) => e.pool);
  assert.ok(!pools.some((t) => t.type === 'hunt' || t.type === 'weed'), 'no hunt / weed tiles in the real world');
  assert.ok(!real.board.finalTrack.pool.some((t) => t.type === 'hunt' || t.type === 'weed'));
  // the tile types themselves are world-independent (base board.json)
  assert.deepEqual([real.board.tileTypes.hunt.icon, real.board.tileTypes.weed.icon], ['⚔️', '🌿']);
  // an old save (no world) plays the real world: its board has no hunt / weed tile
  const room = started({ world: null });
  assert.equal(worldOf(room), 'real');
  const tiles = room.board.eras.flatMap((e) => [...e.tiles, ...Object.values(e.routes ?? {}).flatMap((r) => r.tiles)]);
  assert.ok(!tiles.some((t) => t.type === 'hunt' || t.type === 'weed'));
});

// ---------- the Chiikawa world ----------

const CW_REGULAR = ['weeder', 'hunter', 'ramen', 'workshop', 'bookstore', 'busker', 'pancake', 'photographer', 'sento', 'delivery', 'fisher', 'cafe'];
const CW_HIDDEN = ['landlord', 'mountain_spirit', 'legend_hunter', 'weed_sage', 'ramen_owner', 'armor_san'];

test('치이카와 모드 jobs: 12 regular + 6 hidden, 갑옷씨네 노동, requirement / merit jobs, props = props.json jobProps, scenes known', () => {
  assert.deepEqual(regularJobs(cw).map((j) => j.id).sort(), [...CW_REGULAR].sort());
  assert.deepEqual(cw.jobs.jobs.filter((j) => j.hidden).map((j) => j.id).sort(), [...CW_HIDDEN].sort());
  assert.equal(cw.jobs.partTime.id, 'parttime');
  assert.equal(cw.jobs.partTime.name, '갑옷씨네 노동');
  assert.deepEqual(cw.jobs.partTime.ranks.map((r) => r.name), ['노동 견습', '노동 반장', '노동 대장']);
  assert.deepEqual(cw.jobs.partTime.props, real.jobs.partTime.props);
  const req = (id) => jobDef(cw, id).requires;
  assert.deepEqual(req('hunter').cards, ['iron_body']);
  assert.deepEqual(req('ramen').cards, ['tongue']);
  assert.deepEqual(req('bookstore').cards, ['research']);
  assert.deepEqual(req('busker').cards, ['charisma']);
  assert.equal(req('weeder').weed, 1);
  for (const id of ['hunter', 'workshop', 'busker']) assert.ok(jobDef(cw, id).rankUp.merit >= 1, `${id}: merit`);
  assert.equal(cw.cards.cards.find((k) => k.id === 'pledge').jobOnly, 'busker');
  for (const j of [...cw.jobs.jobs, cw.jobs.partTime]) {
    assert.deepEqual(j.props, cw.props.jobProps[j.id], `${j.id}: props.json jobProps`);
    assert.ok(SCENES.includes(j.scene), `${j.id}: scene ${j.scene}`);
    assert.ok(j.ranks.length >= 3 && j.ranks.every((r) => r.name && Number.isInteger(r.salary)), j.id);
    for (const id of j.requires?.cards ?? []) assert.ok(cw.cards.cards.some((k) => k.id === id), `${j.id}: card ${id}`);
    if (j.hidden && j.unlock) assert.ok(j.unlock.desc, `${j.id}: unlock desc`);
  }
  // meritFrom: 토벌대 needs a merit card only for 조장 / 대장, 갑옷씨 공방 for 공방장
  const hunter = jobDef(cw, 'hunter');
  assert.deepEqual([2, 3, 4].map((r) => meritNeeded(hunter, r)), [0, 1, 1]);
  assert.deepEqual([2, 3, 4].map((r) => meritNeeded(jobDef(cw, 'workshop'), r)), [0, 0, 1]);
  assert.equal(meritNeeded(jobDef(real, 'doctor'), 2), 1, 'real-world merit jobs: every rank-up');
  // a job missing in the room's world (an old save hiring a real-world job) falls back to the real definition
  assert.equal(jobDef(cw, 'doctor').name, '의사');
  assert.equal(jobDef(real, 'hunter'), null);
  // items / treasures / news / lotto mode of the world
  assert.deepEqual(cw.items.items.map((i) => i.name), ['씽씽 킥보드', '고서점 책 꾸러미', '사스마타', '포셰트', '네잎클로버', '목욕탕 평생 회수권', '갑옷', '하치와레표 기타']);
  assert.equal(cw.items.items.find((i) => i.id === 'gym_pass').effect.huntBonus, true);
  assert.equal(cw.items.items.find((i) => i.id === 'armor').effect.huntArmor, true);
  const plush = cw.treasures.treasures.find((t) => t.id === 'kuji_plush');
  assert.equal(plush.weight, 0);
  assert.equal(cw.treasures.treasures.length, 23);
  for (const id of ['chimera_surge', 'weed_boom', 'ramen_price']) assert.ok(cw.news.news.some((n) => n.id === id), id);
  for (const n of cw.news.news) for (const k of Object.keys(n.effects ?? {})) assert.ok(Object.hasOwn(NEWS_DEFAULTS, k), `${n.id}: effect ${k}`);
  for (const n of cw.news.news) for (const id of Object.keys({ ...(n.effects?.jobDelta ?? {}), ...(n.effects?.jobSalaryMult ?? {}) })) assert.ok(jobDef(cw, id) && cw.jobs.jobs.some((j) => j.id === id), `${n.id}: job ${id}`);
  assert.equal(cw.balance.lottoMode, 'kuji');
  assert.ok(cw.events.events.length >= real.events.events.length + 15, 'at least 15 new events');
  for (const e of cw.events.events) for (const id of [e.conditions?.job].flat().filter((x) => x && !['any', 'none', 'parttime'].includes(x))) assert.ok(cw.jobs.jobs.some((j) => j.id === id), `${e.id}: job ${id}`);
  for (const e of cw.events.events) if (e.scene) assert.ok(SCENES.includes(e.scene), `${e.id}: scene ${e.scene}`);
  // CPU dream jobs come from the world's list
  for (const p of PERSONALITIES) for (const id of cw.balance.cpu.personalities[p].dreamJobs) assert.ok(CW_REGULAR.includes(id), `${p}: ${id}`);
});

test('치이카와 모드 board: 토벌 (young / middle_age main, career ×2, money ×1) and 풀뽑기 (middle / high ×2, adult ×1, love) — never kids / final race', () => {
  const w = (pool, type) => pool.find((x) => x.type === type)?.weight ?? 0;
  const era = (id) => cw.board.eras[id].pool;
  const route = (id) => cw.board.routePools[id].pool;
  const has = (pool, type) => (w(pool, type) > 0 ? 1 : 0);
  assert.deepEqual(['baby', 'elem', 'middle', 'high', 'young', 'middle_age', 'senior'].map((e) => has(era(e), 'hunt')), [0, 0, 0, 0, 1, 1, 0]);
  assert.deepEqual(['baby', 'elem', 'middle', 'high', 'young', 'middle_age', 'senior'].map((e) => has(era(e), 'weed')), [0, 0, 1, 1, 1, 1, 0]);
  assert.ok(w(era('middle'), 'weed') > w(era('young'), 'weed'), 'kids eras: 풀뽑기 more often');
  assert.deepEqual(['love', 'career', 'money'].map((r) => has(route(r), 'hunt')), [0, 1, 1]);
  assert.ok(w(route('career'), 'hunt') > w(route('money'), 'hunt'));
  assert.deepEqual(['love', 'career', 'money'].map((r) => has(route(r), 'weed')), [1, 0, 0]);
  assert.ok(!cw.board.finalTrack.pool.some((t) => t.type === 'hunt' || t.type === 'weed'));
  // the rest of every pool is the real one (only the two tiles were added)
  for (const id of ['middle', 'high', 'young', 'middle_age']) assert.deepEqual(era(id).filter((t) => !['hunt', 'weed'].includes(t.type)), real.board.eras[id].pool, id);
  assert.notDeepEqual(cw.board.routePools.career.labels, real.board.routePools.career.labels);
  // a started Chiikawa room's board has them
  const room = started();
  const tiles = room.board.eras.flatMap((e) => [...e.tiles, ...Object.values(e.routes ?? {}).flatMap((r) => r.tiles)]);
  assert.ok(tiles.some((t) => t.type === 'hunt') && tiles.some((t) => t.type === 'weed'));
});

// ---------- 토벌 ----------

test('토벌: prompt (monster drawn, chance, reward range, run = default) → win: money, hunts +1, maybe 체력', () => {
  const sb = sandbox({ patch: { stats: { int: 3, str: 4, charm: 3, luck: 2 } } });
  const m = monsterPool(cw, 'young')[0];
  assert.equal(m.id, 'small_chimera');
  assert.ok(!monsterPool(cw, 'young').some((x) => x.id === 'dekatsuyo'), '데카츠요 only in middle_age');
  assert.ok(monsterPool(cw, 'middle_age').some((x) => x.id === 'dekatsuyo'));
  const H = cw.hunts.balance;
  const expected = Math.min(H.max, H.base[0] + 4 * H.perStr + 2 * H.perLuck);
  assert.equal(huntChance(sb.tx, sb.c, m), expected);
  // win (rng 0 < chance), reward = the lowest of the range, 체력 roll 0 < strChance
  const { p, events } = answer(sb, 'hunt', 'fight', { nexts: [0, 0] });
  assert.equal(p.defaultOptionId, 'run');
  const fight = p.options.find((o) => o.id === 'fight');
  assert.equal(fight.chance, expected);
  assert.deepEqual(fight.reward, [m.reward.min, m.reward.max].map((v) => Math.max(5, Math.round(v / 5) * 5)));
  assert.equal(p.context.monsterId, 'small_chimera');
  const r = ev(events, 'huntResult');
  assert.deepEqual([r.success, r.monsterId, r.amount, r.injured], [true, 'small_chimera', fight.reward[0], 0]);
  assert.equal(events.indexOf(r), 0, 'the result anchor comes before its follow-ups');
  assert.ok(events.some((e) => e.type === 'moneyChanged' && e.reason === 'hunt' && e.delta === fight.reward[0]));
  assert.ok(events.some((e) => e.type === 'statChanged' && e.stat === 'str' && e.reason === 'hunt'));
  assert.equal(sb.c.hunts, 1);
  assert.ok(!events.some((e) => e.type === 'promptResolved'), 'a fight anchors on huntResult (no second cut-in)');
});

test('토벌: lose → loss × era scale (갑옷 halves, no injury); without armor a job gets hurt; run = promptResolved (banner)', () => {
  const H = cw.hunts.balance;
  // a defeat without armor (job holder): loss = failLoss.min × middle_age scale, injured
  let sb = sandbox({ era: 'middle_age', patch: { job: { id: 'sento', rank: 1, exp: 0, injured: 0 } } });
  let { events } = answer(sb, 'hunt', 'fight', { nexts: [0.99, 0] });
  let r = ev(events, 'huntResult');
  const loss = Math.round((H.failLoss.min * H.eraScale.middle_age) / 5) * 5;
  assert.deepEqual([r.success, r.amount, r.injured], [false, -loss, cw.balance.jobs.injuryTurns]);
  assert.equal(sb.c.job.injured, cw.balance.jobs.injuryTurns);
  assert.ok(sb.c.cards.some((k) => k.id === 'injury'), 'the 🤕 status card');
  assert.ok(!events.some((e) => e.type === 'injured'), 'one cut-in: the injury rides on huntResult');
  // with armor: half the loss, never an injury roll
  sb = sandbox({ era: 'middle_age', patch: { items: ['armor'], job: { id: 'sento', rank: 1, exp: 0, injured: 0 } } });
  ({ events } = answer(sb, 'hunt', 'fight', { nexts: [0.99, 0] }));
  r = ev(events, 'huntResult');
  assert.deepEqual([r.success, r.armor, r.amount, r.injured], [false, true, -Math.round((loss * 0.5) / 5) * 5, 0]);
  assert.equal(sb.c.job.injured, 0);
  // insurance halves what is left (applyLoss); the event carries the actual amount
  sb = sandbox({ era: 'young', patch: { cards: [{ uid: 'k1', id: 'insurance' }] } });
  ({ events } = answer(sb, 'hunt', 'fight', { nexts: [0.99] }));
  r = ev(events, 'huntResult');
  assert.equal(r.amount, -events.filter((e) => e.type === 'moneyChanged' && e.reason === 'hunt').reduce((a, e) => a - e.delta, 0));
  // 건강기원 부적 prevents the injury
  sb = sandbox({ era: 'young', patch: { cards: [{ uid: 'k2', id: 'health_charm' }], job: { id: 'sento', rank: 1, exp: 0, injured: 0 } } });
  ({ events } = answer(sb, 'hunt', 'fight', { nexts: [0.99, 0] }));
  assert.equal(ev(events, 'huntResult').injured, 0);
  // run: nothing happens, promptResolved {kind: hunt, result: run}, presented as a banner (cutin false)
  sb = sandbox();
  ({ events } = answer(sb, 'hunt', 'run'));
  const pr = ev(events, 'promptResolved');
  assert.deepEqual([pr.kind, pr.result], ['hunt', 'run']);
  assert.ok(!events.some((e) => e.type === 'moneyChanged'));
  decorateEvents(events, { room: sb.room, data: cw, seed: 3 });
  assert.equal(pr.cutin, false);
  assert.equal(pr.lineTag, 'hunt_run');
  // 사스마타 (+chance) and the 토벌대 rank bonus
  sb = sandbox({ patch: { items: ['gym_pass'], job: { id: 'hunter', rank: 3, exp: 0, injured: 0 } } });
  const m = monsterPool(cw, 'young')[1];
  const plain = Math.min(H.max, H.base[1] + 4 * H.perStr + 3 * H.perLuck);
  assert.ok(Math.abs(huntChance(sb.tx, sb.c, m) - Math.min(H.max, plain + H.sasumata + 3 * H.hunterRank)) < 1e-9);
});

test('토벌: news huntRewardMult / CPU income handicap scale the reward; a 토벌대 win may earn a merit card', () => {
  const sb = sandbox({ era: 'young', patch: { job: { id: 'hunter', rank: 1, exp: 0, injured: 0 } } });
  sb.room.news = { young: 'chimera_surge' };
  const p = openPrompt(sb.tx, 'hunt', sb.c);
  const m = monsterPool(cw, 'young')[0];
  assert.equal(p.options[0].reward[0], Math.round((m.reward.min * 1.5) / 5) * 5);
  p.answers[sb.c.id] = 'fight';
  sb.tx.rng = fixedRng({ nexts: [0, 0.9, 0] }); // win, no 체력, merit roll 0 < meritChance
  const at = sb.tx.events.length;
  resolvePrompt(sb.tx);
  assert.ok(sb.tx.events.slice(at).some((e) => e.type === 'cardGained' && e.cardId === 'merit'));
  // CPU against people: × incomeMult
  const sb2 = sandbox({ era: 'young' });
  sb2.c.ownerSessionId = 'cpu';
  const p2 = openPrompt(sb2.tx, 'hunt', sb2.c);
  const h = cw.balance.cpu.handicap.incomeMult;
  assert.equal(p2.options[0].reward[1], Math.max(5, Math.round((m.reward.max * h) / 5) * 5));
});

// ---------- 풀뽑기 검정 ----------

test('풀뽑기 검정: work pay (era, level, 풀뽑기 일꾼), exam fee (kids eras free), chance (stats, retries), pass / fail / 1급', () => {
  const W = cw.balance.weed;
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(weedGrade), ['무자격', '5급', '4급', '3급', '2급', '1급']);
  let sb = sandbox({ era: 'middle' });
  assert.equal(weedWorkAmount(sb.tx, sb.c), Math.max(5, Math.round((W.work.base * W.eraScale.middle) / 5) * 5));
  assert.equal(weedExamFee(sb.tx, sb.c), 0, 'kids eras: 부모님 찬스');
  sb = sandbox({ era: 'middle_age', patch: { weed: { level: 2, tries: 0 }, job: { id: 'weeder', rank: 1, exp: 0, injured: 0 } } });
  assert.equal(weedWorkAmount(sb.tx, sb.c), Math.round((W.work.base * (1 + 2 * W.work.perLevel) * W.eraScale.middle_age * W.work.weederMult) / 5) * 5);
  assert.equal(weedExamFee(sb.tx, sb.c), Math.round((W.exam.fee[2] * W.eraScale.middle_age) / 5) * 5);
  const s = sb.c.stats;
  const base = W.exam.base[2] + W.exam.perInt * s.int + W.exam.perStr * s.str + W.exam.perLuck * s.luck;
  assert.ok(Math.abs(weedExamChance(sb.tx, sb.c) - base) < 1e-9);
  sb.c.weed.tries = 9;
  assert.ok(Math.abs(weedExamChance(sb.tx, sb.c) - (base + W.exam.retryMax)) < 1e-9, 'retry bonus capped');
  // pass → level + 1, tries 0, fee paid; weedResult first
  sb = sandbox({ era: 'young', patch: { weed: { level: 0, tries: 2 } } });
  let { p, events } = answer(sb, 'weed', 'exam', { nexts: [0] });
  assert.equal(p.defaultOptionId, 'work');
  let r = ev(events, 'weedResult');
  assert.deepEqual([r.action, r.success, r.level, r.grade, events.indexOf(r)], ['exam', true, 1, '5급', 0]);
  assert.deepEqual(sb.c.weed, { level: 1, tries: 0 });
  assert.ok(events.some((e) => e.type === 'moneyChanged' && e.reason === 'weedFee' && e.delta === -W.exam.fee[0]));
  // fail → tries + 1
  ({ events } = answer(sb, 'weed', 'exam', { nexts: [0.99] }));
  assert.equal(ev(events, 'weedResult').success, false);
  assert.deepEqual(sb.c.weed, { level: 1, tries: 1 });
  // work: money + maybe 체력
  ({ events } = answer(sb, 'weed', 'work', { nexts: [0] }));
  r = ev(events, 'weedResult');
  assert.deepEqual([r.action, r.amount], ['work', weedWorkAmount(sb.tx, sb.c)]);
  assert.ok(events.some((e) => e.type === 'moneyChanged' && e.reason === 'weed' && e.delta === r.amount));
  assert.ok(events.some((e) => e.type === 'statChanged' && e.reason === 'weed'));
  // 1급: the exam is disabled; no cash for the fee: disabled too
  sb = sandbox({ era: 'young', patch: { weed: { level: WEED_MAX, tries: 0 } } });
  ({ p } = answer(sb, 'weed', 'work'));
  assert.equal(p.options.find((o) => o.id === 'exam').disabled, true);
  sb = sandbox({ era: 'young', patch: { money: 0, weed: { level: 3, tries: 0 } } });
  ({ p } = answer(sb, 'weed', 'work'));
  assert.equal(p.options.find((o) => o.id === 'exam').disabled, true);
});

test('풀뽑기 / 토벌 in jobs: 풀뽑기 일꾼 needs 5급, its salary + 10 % per level; 풀뽑기 1급 명인 / 전설의 토벌자 unlocks', () => {
  const sb = sandbox({ era: 'young', patch: { stats: { int: 9, str: 9, charm: 9, luck: 9 } } });
  const eff = { ...NEWS_DEFAULTS };
  const weeder = jobDef(cw, 'weeder');
  assert.equal(meetsRequirements(sb.c, weeder, eff), false);
  sb.c.weed = { level: 1, tries: 0 };
  assert.equal(meetsRequirements(sb.c, weeder, eff), true);
  sb.c.job = { id: 'weeder', rank: 1, exp: 0, injured: 0 };
  const s1 = salaryAmount(sb.tx, sb.c);
  sb.c.weed.level = 4;
  assert.ok(salaryAmount(sb.tx, sb.c) > s1);
  assert.equal(unlockMet(sb.tx, sb.c, jobDef(cw, 'weed_sage')), false);
  sb.c.weed.level = 5;
  assert.equal(unlockMet(sb.tx, sb.c, jobDef(cw, 'weed_sage')), true);
  const legend = jobDef(cw, 'legend_hunter');
  sb.c.hunts = legend.unlock.hunts - 1;
  assert.equal(unlockMet(sb.tx, sb.c, legend), false);
  sb.c.hunts = legend.unlock.hunts;
  assert.equal(unlockMet(sb.tx, sb.c, legend), true);
  // news jobSalaryMult (풀뽑기 일감 폭증)
  const before = salaryAmount(sb.tx, sb.c);
  sb.room.news = { young: 'weed_boom' };
  assert.ok(salaryAmount(sb.tx, sb.c) > before);
  assert.equal(newsEffects(sb.room, 'young', cw).weedMult, 1.5);
});

// ---------- 쿠지 ----------

test('쿠지: the box adds up to 1; EV (money + card × 0.5 + plush) < 응모권 price, also with the 쿠지 열풍 news', () => {
  const price = cw.cards.cards.find((k) => k.id === 'lotto').price;
  assert.equal(cw.cards.cards.find((k) => k.id === 'lotto').name, '쿠지 응모권');
  for (const luck of [1, 1.25, 2]) assert.ok(Math.abs(kujiPrizes(cw.balance.kuji, luck).reduce((a, p) => a + p.chance, 0) - 1) < 1e-9, `luck ${luck}`);
  assert.ok(kujiPrizes(cw.balance.kuji, 1.25)[0].chance > kujiPrizes(cw.balance.kuji, 1)[0].chance);
  const ev1 = kujiExpectedValue(cw);
  const fever = kujiExpectedValue(cw, { luck: cw.news.news.find((n) => n.id === 'lotto_fever').effects.kujiLuck });
  assert.ok(ev1 > 0 && ev1 < price, `EV ${ev1} < ${price}`);
  assert.ok(fever < price, `fever EV ${fever} < ${price}`);
});

test('쿠지 draw (치이카와 모드 era opening): one ticket per 응모권; payload {kuji, entries [{charId, rank, prize}]}; 1등 = money + plush treasure', () => {
  const sb = sandbox({ era: 'young' });
  const [a, b, c] = sb.room.characters;
  for (const x of [a, b, c]) x.cards = [];
  a.cards.push({ uid: 'k1', id: 'lotto' });
  b.cards.push({ uid: 'k2', id: 'lotto' });
  c.cards.push({ uid: 'k3', id: 'lotto' });
  for (const x of [a, b, c]) x.era = 'young';
  sb.tx.rng = fixedRng({ nexts: [0.001, 0.45, 0.99] }); // a → 1등, b → 4등 (0.23 ≤ r < 0.5), c → 꽝
  const at = sb.tx.events.length;
  const draw = lottoDraw(sb.tx, 'young');
  const events = sb.tx.events.slice(at);
  const ld = ev(events, 'lottoDraw');
  assert.equal(events.indexOf(ld), 0);
  assert.equal(ld.kuji, true);
  assert.equal(ld.numbers, undefined);
  assert.deepEqual(ld.entries.map((e) => [e.charId, e.rank]), [[a.id, 1], [b.id, 4], [c.id, 5]]);
  assert.equal(ld.entries[0].prize.treasureId, 'kuji_plush');
  assert.equal(ld.entries[0].prize.money, 150);
  assert.deepEqual(ld.entries[1].prize.stats, { str: 1 });
  assert.deepEqual(Object.keys(ld.entries[2].prize), ['name']);
  assert.ok(events.some((e) => e.type === 'moneyChanged' && e.reason === 'kuji' && e.charId === a.id && e.delta === 150));
  assert.ok(events.some((e) => e.type === 'treasureFound' && e.source === 'kuji' && e.treasureId === 'kuji_plush'));
  assert.ok([a, b, c].every((x) => !x.cards.some((k) => k.id === 'lotto')), 'tickets used');
  assert.deepEqual(sb.room.lotto.draws.at(-1).kuji, true);
  assert.equal(draw.entries.length, 3);
  // 3등 = a random card (source kuji)
  const sb2 = sandbox({ era: 'young' });
  sb2.room.characters[0].cards = [{ uid: 'k9', id: 'lotto' }];
  for (const x of sb2.room.characters.slice(1)) x.cards = [];
  sb2.tx.rng = fixedRng({ nexts: [0.1] });
  kujiDraw(sb2.tx, 'young');
  const e3 = sb2.tx.events.find((e) => e.type === 'lottoDraw');
  assert.equal(e3.entries[0].rank, 3);
  assert.ok(e3.entries[0].prize.cardId);
  assert.ok(sb2.tx.events.some((e) => e.type === 'cardGained' && e.source === 'kuji'));
  // presentation: scene kuji, lotto_win for the best prize, a line per entry
  decorateEvents(events, { room: sb.room, data: cw, seed: 5 });
  assert.equal(ld.scene, 'kuji');
  assert.equal(ld.lineTag, 'lotto_win');
  assert.ok(ld.entries.every((e) => e.lineTag && typeof e.line === 'string'));
  // the real world keeps the numbered lotto
  const sb3 = sandbox({ era: 'young', world: 'real' });
  sb3.room.characters[0].cards = [{ uid: 'k8', id: 'lotto' }];
  for (const x of sb3.room.characters.slice(1)) x.cards = [];
  sb3.tx.rng = fixedRng({});
  lottoDraw(sb3.tx, 'young');
  const real3 = sb3.tx.events.find((e) => e.type === 'lottoDraw');
  assert.ok(Array.isArray(real3.numbers) && real3.kuji === undefined);
});

// ---------- presentation / MC ----------

test('presentation: huntResult / weedResult registered (anchors, cut-ins, scenes, tags); MC huntWin / huntLose / weedPass (big moments)', () => {
  for (const t of ['huntResult', 'weedResult']) {
    assert.ok(EVENT_TYPES.includes(t) && CUTIN_TYPES.has(t) && ANCHOR_TYPES.has(t), t);
  }
  for (const s of ['weed-field', 'hunt-forest', 'ramen-shop', 'workshop', 'sento', 'bookstore', 'cafe', 'kuji']) {
    assert.ok(SCENES.includes(s), s);
    assert.ok(cw.tones.scenes[s]?.bg && cw.tones.sceneFallbacks[s], s);
  }
  for (const tag of ['hunt', 'hunt_win', 'hunt_lose', 'hunt_run', 'weed', 'weed_work', 'weed_pass', 'weed_fail']) assert.ok(real.lines.tags[tag]?.length >= 5, tag);
  for (const k of ['huntWin', 'huntLose', 'weedPass']) assert.ok(real.mc.situations[k] && real.lines.mc[k], k);
  const room = structuredClone(started());
  const c = room.characters[0];
  const ctx = (e) => ({ events: [e], index: 0, room, tones: cw.tones, lines: cw.lines, data: cw, eraOf: () => 'young' });
  let e = { type: 'huntResult', charId: c.id, monsterId: 'chimera', success: true, amount: 80 };
  let p = presentationFor(e, ctx(e));
  assert.deepEqual([p.tag, p.scene, p.tone, p.cutin, p.vars.monster], ['hunt_win', 'hunt-forest', 'good', true, '키메라']);
  e = { type: 'huntResult', charId: c.id, monsterId: 'chimera', success: false, amount: -30 };
  assert.equal(presentationFor(e, ctx(e)).tag, 'hunt_lose');
  e = { type: 'weedResult', charId: c.id, action: 'exam', success: false, level: 1, grade: '5급' };
  assert.deepEqual([presentationFor(e, ctx(e)).tag, presentationFor(e, ctx(e)).scene], ['weed_fail', 'weed-field']);
  e = { type: 'weedResult', charId: c.id, action: 'work', level: 0, grade: '무자격', amount: 20 };
  assert.equal(presentationFor(e, ctx(e)).tag, 'weed_work');
  // MC: a 데카츠요 win / 1급 are big (always hosted unless off); lines filled
  room.config.mcFrequency = 'few';
  const big = [
    { type: 'huntResult', charId: c.id, monsterId: 'dekatsuyo', success: true, amount: 400 },
    { type: 'weedResult', charId: c.id, action: 'exam', success: true, level: 5, grade: '1급' },
  ];
  decorateEvents(big, { room, data: cw, seed: 11 });
  assert.deepEqual(big.map((x) => [x.mcKey, x.mcWeight]), [['huntWin', 'big'], ['weedPass', 'big']]);
  for (const x of big) {
    assert.ok(x.line && !/\{\w+\}/.test(x.line), x.line);
    for (const l of x.mc) assert.ok(l.line && !/\{\w+\}/.test(l.line), l.line);
  }
});

test('overlay lines / MC pools follow the lines.json schema (5–10 lines ≤ 40 chars, known placeholders; MC ≥ 6 + duos, 호야 멍)', () => {
  const allowed = new Set(real.lines.placeholders);
  const ov = getWorldOverlays().chiikawa.lines;
  for (const [tag, pool] of Object.entries(ov.tags)) {
    assert.ok(real.lines.tags[tag], `${tag}: replaces an existing pool`);
    assert.ok(pool.length >= 5 && pool.length <= 10, `${tag}: ${pool.length}`);
    for (const l of pool) {
      assert.ok(l.length <= 40, `${tag}: "${l}"`);
      for (const [, k] of l.matchAll(/\{(\w+)\}/g)) assert.ok(allowed.has(k), `${tag}: {${k}}`);
    }
  }
  const text = (e) => (typeof e === 'string' ? e : e.t);
  for (const [key, pool] of Object.entries(ov.mc)) {
    const vars = real.mc.situations[key].vars;
    for (const who of ['hoya', 'bomi']) {
      assert.ok(pool[who].length >= 6, `${key}.${who}`);
      for (const e of pool[who]) {
        assert.ok(text(e).length <= 48, text(e));
        for (const [, k] of text(e).matchAll(/\{(\w+)\}/g)) assert.ok(vars.includes(k), `${key}: {${k}}`);
      }
    }
    for (const e of pool.hoya) assert.match(text(e), /멍/);
    for (const e of pool.bomi) assert.doesNotMatch(text(e), /멍[!~]/);
    assert.ok(pool.duo.length >= 6, `${key}.duo`);
    for (const d of pool.duo) assert.deepEqual([...new Set(d.map((l) => l.s))].sort(), ['bomi', 'hoya']);
  }
});

// ---------- titles / awards ----------

test('awards / titles: 토벌왕, 풀뽑기 명인상, 사스마타 마스터, 평화주의자, 풀뽑기 1급, 만년 풀뽑기 일꾼', () => {
  const room = structuredClone(started());
  const [a, b, c] = room.characters;
  Object.assign(a, { hunts: 6, record: { ...a.record, huntPrompts: 7, huntRuns: 1 } });
  Object.assign(b, { weed: { level: 5, tries: 0 }, job: { id: 'weeder', rank: 2, exp: 0, injured: 0 }, jobHistory: [{ id: 'weeder', rank: 2, era: 'young' }] });
  Object.assign(c, { hunts: 0, record: { ...c.record, huntPrompts: 3, huntRuns: 3 } });
  const titles = computeTitles(room, cw, { ranking: [] });
  assert.ok(titles[a.id].includes('sasumata_master'), titles[a.id].join());
  assert.ok(titles[b.id].includes('weed_first'), titles[b.id].join());
  assert.ok(titles[c.id].includes('pacifist'), titles[c.id].join());
  const b2 = structuredClone(room);
  b2.characters[1].weed.level = 3;
  assert.ok(computeTitles(b2, cw, { ranking: [] })[b.id].includes('eternal_civil'), '만년 풀뽑기 일꾼');
  assert.equal(cw.titles.titles.find((t) => t.id === 'eternal_civil').name, '만년 풀뽑기 일꾼');
  for (const id of ['hunt_king', 'weed_master']) assert.ok(cw.awards.awards.some((x) => x.id === id), id);
});

// ---------- CPU ----------

test('CPU: hunt / weed answers are enabled options at both levels × every personality; hard = EV; the game RNG untouched', () => {
  const sb = sandbox({ era: 'young' });
  for (const kind of ['hunt', 'weed']) {
    openPrompt(sb.tx, kind, sb.c);
    const room = sb.room;
    const p = room.turn.pending;
    const before = room.rngState;
    for (const level of ['easy', 'hard']) {
      for (const personality of PERSONALITIES) {
        const id = cpuAnswer(room, sb.c.id, null, { level, personality });
        assert.ok(p.options.some((o) => o.id === id && !o.disabled), `${kind} ${level} ${personality}: ${id}`);
      }
    }
    assert.equal(room.rngState, before);
    room.turn.pending = null;
  }
  // hard: an easy monster with a good chance → fight; a hopeless one → run; kids-era 검정 (free) → exam
  const strong = sandbox({ era: 'young', patch: { stats: { int: 3, str: 9, charm: 3, luck: 9 } } });
  openPrompt(strong.tx, 'hunt', strong.c);
  assert.equal(cpuAnswer(strong.room, strong.c.id, null, { level: 'hard', personality: 'normal' }), 'fight');
  const weak = sandbox({ era: 'young', patch: { stats: { int: 0, str: 0, charm: 0, luck: 0 } } });
  const wp = openPrompt(weak.tx, 'hunt', weak.c);
  wp.options[0].chance = 0.05;
  assert.equal(cpuAnswer(weak.room, weak.c.id, null, { level: 'hard', personality: 'cautious' }), 'run');
  const kid = sandbox({ era: 'middle' });
  openPrompt(kid.tx, 'weed', kid.c);
  assert.equal(cpuAnswer(kid.room, kid.c.id, null, { level: 'hard', personality: 'normal' }), 'exam');
  // dream jobs come from the room's world
  const room = started();
  for (const ch of room.characters) assert.ok(CW_REGULAR.includes(cpuDreamJob(room, ch)), cpuDreamJob(room, ch));
  const realRoom = started({ world: 'real' });
  assert.ok(!CW_REGULAR.includes(cpuDreamJob(realRoom, realRoom.characters[0])));
});

// ---------- whole games ----------

test('a CPU-only 🐹 치이카와 lifetime game finishes; 토벌 / 풀뽑기 happen; Chiikawa jobs only; every event known; lines filled', () => {
  let seen = { hunt: 0, weed: 0, jobs: new Set() };
  for (const seed of [3, 4]) {
    let room = makeRoom({ seed });
    room.config = { ...room.config, world: 'chiikawa', eraTurns: { ...room.config.eraTurns, ...SHORT }, finalLength: 20, holidays: true, turnOrder: 'index' };
    for (let i = 0; i < 4; i++) room = addCpuCharacter(room, {}, 0).room;
    room = startGame(room, { now: 0 }).room;
    let now = 1000;
    for (let i = 0; i < 6000 && room.status === 'playing'; i++) {
      const next = cpuNextAction(room);
      assert.ok(next, 'a CPU always has something to do');
      const r = applyAction(room, { ...next.action, actor: { system: true, cpu: true } }, { now: (now += 10) });
      for (const e of r.events) {
        assert.ok(EVENT_TYPES.includes(e.type), e.type);
        assert.ok(!/\{\w+\}/.test(e.line ?? ''), `${e.type}: ${e.line}`);
        if (e.type === 'prompt' && e.kind === 'hunt') seen.hunt++;
        if (e.type === 'prompt' && e.kind === 'weed') seen.weed++;
        if (e.type === 'jobChanged') seen.jobs.add(e.jobId);
      }
      room = r.room;
    }
    assert.equal(room.status, 'finished');
    assert.ok(room.result.ranking.length === 4);
  }
  assert.ok(seen.hunt > 0 && seen.weed > 0, JSON.stringify({ hunt: seen.hunt, weed: seen.weed }));
  for (const id of seen.jobs) assert.ok(cw.jobs.jobs.some((j) => j.id === id) || id === 'parttime', id);
});

test('old saves: a playing room without config.world continues in the real world; a Chiikawa character holding a real-world job still gets paid', () => {
  const room = started({ world: null });
  delete room.config.world;
  const c = room.characters[0];
  const r = applyAction(room, { type: 'spin', characterId: room.turn.order[room.turn.currentIndex] }, { now: 1 });
  assert.equal(worldOf(r.room), 'real');
  // a 치이카와 room with a job id of the other world (e.g. migrated by hand): jobDef falls back, salary computed
  const sb = sandbox({ era: 'young', patch: { job: { id: 'doctor', rank: 2, exp: 0, injured: 0 } } });
  assert.ok(salaryAmount(sb.tx, sb.c) > 0);
  void c;
});

// ---------- HTTP ----------

test('HTTP: /api/meta has worlds + worldOverlays (+ hunts, balance.weed / kuji / lottoMode); admin creates rooms per world', async (t) => {
  const tmp = await tempDir();
  const srv = await startServer({ port: 0, host: '127.0.0.1', dataDir: tmp.dir, adminPassword: 'pw', debounceMs: 10, log: () => {} });
  t.after(async () => {
    await srv.close();
    await tmp.cleanup();
  });
  const base = `http://127.0.0.1:${srv.port}`;
  const meta = (await httpCall(base, 'GET', '/api/meta')).json;
  assert.deepEqual(meta.worlds.map((w) => w.id), ['chiikawa', 'real']);
  assert.deepEqual(Object.keys(meta.worldOverlays), ['chiikawa']);
  assert.deepEqual(meta.worldOverlays.chiikawa.jobs.jobs.remove.length, 21);
  assert.equal(meta.jobs.partTime.name, '알바', 'meta itself = the real world');
  assert.equal(meta.balance.lottoMode, 'numbers');
  assert.ok(meta.balance.weed?.exam);
  assert.equal(meta.hunts.monsters.length, 4);
  // the client resolves the room's world from the meta (same pure module)
  const cmeta = worldData(meta, 'chiikawa', meta.worldOverlays);
  assert.equal(cmeta.jobs.partTime.name, '갑옷씨네 노동');
  assert.equal(cmeta.balance.lottoMode, 'kuji');
  assert.equal(cmeta.items.items.find((i) => i.id === 'car').name, '씽씽 킥보드');
  const login = await httpCall(base, 'POST', '/admin/api/login', { body: { password: 'pw' } });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const ameta = (await httpCall(base, 'GET', '/admin/api/meta', { cookie })).json;
  assert.equal(ameta.defaults.world, 'chiikawa');
  assert.equal(ameta.worlds.length, 2);
  const a = await httpCall(base, 'POST', '/admin/api/rooms', { body: {}, cookie });
  assert.equal(a.status, 201);
  assert.equal(a.json.room.config.world, 'chiikawa');
  const b = await httpCall(base, 'POST', '/admin/api/rooms', { body: { world: 'real' }, cookie });
  assert.equal(b.json.room.config.world, 'real');
  const bad = await httpCall(base, 'POST', '/admin/api/rooms', { body: { world: 'mars' }, cookie });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /세계는 치이카와 모드/);
  void loadData;
});
