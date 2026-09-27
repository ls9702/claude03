// Stage 9-A — submaps (고향 / 사찰 / 제주도 / 인생역전), treasures with hidden appraisal values, 산신령 via 사찰 소원,
// presentation / MC of the new events, CPU answers, restore mid-submap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameData } from '../server/data/index.js';
import { applyAction, endGame, startGame } from '../server/game/engine.js';
import { createTx } from '../server/game/effects.js';
import { addCharacter, joinRoom } from '../server/game/lobby.js';
import { openPrompt, resolvePrompt } from '../server/game/prompts.js';
import { resolveTile } from '../server/game/spaces.js';
import { HORSE_ODDS, SUBMAPS, horseStake, jejuTreasureChance, reversalLottoEv, trainStats, wishChance } from '../server/game/submaps.js';
import { appraise, findTreasure, treasureDefs } from '../server/game/treasures.js';
import { CUTIN_TYPES, EVENT_TYPES, decorateEvents } from '../server/game/presentation.js';
import { ANCHOR_TYPES, PROMPTS } from '../server/game/prompts.js';
import { cpuAnswer } from '../server/game/cpu.js';
import { viewFor } from '../server/game/view.js';
import { createRng } from '../server/game/rng.js';
import { makeRoom } from './helpers.js';

const data = gameData();
const SM = data.balance.submaps;
const r5 = (v) => Math.round(v / 5) * 5;

function started({ chars = [['A', 'A1'], ['B', 'B1'], ['A', 'A2']], seed = 7, config = {} } = {}) {
  let room = makeRoom({ seed });
  room.config = { ...room.config, ...config };
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
/** A tx over a started room; its first character placed in `era` with `patch`. */
function sandbox({ era = 'young', patch = {}, rng = {} } = {}) {
  const room = structuredClone(started());
  const c = room.characters[0];
  Object.assign(c, { era, stats: { int: 3, str: 2, charm: 5, luck: 4 }, money: 1000, debt: 0 }, patch);
  const tx = createTx(room, { rng: fixedRng(rng), now: 0, data });
  return { room, c, tx };
}
/** Open a submap prompt for c, answer it and resolve (events after the prompt). */
function answer(sb, kind, optionId, rng = {}) {
  const p = openPrompt(sb.tx, kind, sb.c);
  p.answers[sb.c.id] = optionId;
  sb.tx.rng = fixedRng(rng);
  const at = sb.tx.events.length;
  resolvePrompt(sb.tx);
  return { p, events: sb.tx.events.slice(at) };
}
const cur = (room) => room.turn.order[room.turn.currentIndex];
const ch = (room, id) => room.characters.find((c) => c.id === id);

// ---------- data ----------

test('data: treasures.json (≥ 20, named classics), board pools per era / route, tile types, no placeholders left', () => {
  const T = treasureDefs(data);
  assert.ok(T.length >= 20, `${T.length} treasures`);
  assert.equal(new Set(T.map((t) => t.id)).size, T.length);
  for (const t of T) {
    assert.match(t.id, /^[a-z0-9_]+$/);
    assert.ok(t.name && t.icon && t.desc, t.id);
    assert.ok(Number.isInteger(t.min) && Number.isInteger(t.max) && t.min >= 0 && t.min <= t.max, t.id);
    assert.ok(t.fakeChance >= 0 && t.fakeChance <= 1 && t.weight > 0, t.id);
    assert.ok(t.min > data.treasures.fake.max || t.fakeChance > 0, `${t.id}: a real piece is worth more than a fake`);
  }
  for (const name of ['고려청자', '조선백자', '옛날 동전', '아이돌 굿즈', '공룡 화석', '금두꺼비', '희귀 우표', 'LP판', '한정판 운동화', '가짜 명화']) {
    assert.ok(T.some((t) => t.name === name), name);
  }
  const bd = data.board;
  assert.deepEqual(bd.placeholders, {});
  for (const t of [...SUBMAPS, 'treasure']) assert.ok(bd.tileTypes[t]?.name && bd.tileTypes[t].icon, t);
  const w = (pool, type) => pool.find((x) => x.type === type)?.weight ?? 0;
  const era = (id) => bd.eras[id].pool;
  const route = (id) => bd.routePools[id].pool;
  // 고향: 초등 이상 main + 연애 루트 · 사찰: 중학생 이상 main + 금전 루트 · 제주: 연애/금전 루트 · 인생역전: 노년만
  assert.equal(w(era('baby'), 'hometown'), 0);
  for (const e of ['elem', 'middle', 'high', 'senior']) assert.ok(w(era(e), 'hometown') > 0, `hometown ${e}`);
  assert.ok(w(route('love'), 'hometown') > 0);
  for (const e of ['baby', 'elem']) assert.equal(w(era(e), 'temple'), 0);
  for (const e of ['middle', 'high', 'senior']) assert.ok(w(era(e), 'temple') > 0, `temple ${e}`);
  assert.ok(w(route('money'), 'temple') > 0);
  assert.ok(w(route('love'), 'jeju') > 0 && w(route('money'), 'jeju') > 0 && w(route('career'), 'jeju') === 0);
  for (const e of Object.keys(bd.eras)) if (e !== 'senior') assert.equal(w(era(e), 'reversal'), 0, `reversal ${e}`);
  assert.ok(w(era('senior'), 'reversal') > 0);
  for (const r of Object.keys(bd.routePools)) assert.equal(w(route(r), 'reversal'), 0);
  // loop maps: the final race (노년) track has fixed 인생역전섬 tiles (2–3) and its own mostly-good pool
  assert.ok(bd.finalTrack.reversal.min >= 2 && bd.finalTrack.reversal.max <= 3);
  assert.equal(w(bd.finalTrack.pool, 'reversal'), 0, 'placed as fixed spots, not drawn');
  assert.equal(w(bd.finalTrack.pool, 'loss'), 0, 'trouble only at the fixed spots');
  // 보물: 금전 루트가 가장 많이, 노년 골인 경주에도 조금
  assert.ok(w(route('money'), 'treasure') > w(bd.finalTrack.pool, 'treasure') && w(bd.finalTrack.pool, 'treasure') > 0);
  // 산신령 = 소원 성취 n번 (사찰 + 찬스 광장; data-driven — 8 since the loop maps)
  assert.deepEqual(Object.keys(data.jobs.jobs.find((j) => j.id === 'mountain_spirit').unlock).sort(), ['desc', 'wishes']);
  assert.ok(data.jobs.jobs.find((j) => j.id === 'mountain_spirit').unlock.wishes >= 2);
  for (const k of SUBMAPS) assert.ok(PROMPTS[k], `prompt ${k}`);
});

test('appraise: fakes (fakeChance) are worth fake.min..fake.max, real pieces min..max (5 단위)', () => {
  const rng = createRng(5);
  const def = treasureDefs(data).find((t) => t.id === 'celadon');
  let fakes = 0;
  for (let i = 0; i < 400; i++) {
    const { value, fake } = appraise(rng, def, data);
    if (fake) {
      fakes++;
      assert.ok(value >= data.treasures.fake.min && value <= data.treasures.fake.max);
    } else {
      assert.ok(value >= def.min && value <= def.max && value % 5 === 0, String(value));
    }
  }
  assert.ok(fakes > 60 && fakes < 150, `fakes ${fakes} (25 %)`);
});

// ---------- 고향 시골집 ----------

test('hometown: rest = skip the next spin + 체력 + 부모님 용돈; visit = small 용돈 + 매력 (default visit)', () => {
  const sb = sandbox({ era: 'middle' });
  const p0 = openPrompt(sb.tx, 'hometown', sb.c);
  assert.deepEqual(p0.options.map((o) => o.id), ['rest', 'visit']);
  assert.equal(p0.defaultOptionId, 'visit');
  const scale = SM.scale.middle;
  assert.equal(p0.options[0].money, r5(SM.hometown.restGift * scale));
  assert.equal(p0.options[0].skipTurns, 1);
  sb.tx.room.turn.pending = null;

  const a = sandbox({ era: 'middle' });
  const before = { money: a.c.money, str: a.c.stats.str };
  const { events } = answer(a, 'hometown', 'rest');
  const res = events.find((e) => e.type === 'submapResult');
  assert.deepEqual([res.submap, res.optionId, res.result, res.amount], ['hometown', 'rest', 'rest', r5(SM.hometown.restGift * scale)]);
  assert.equal(events.indexOf(res), 0, 'the result anchor comes before its money / stat follow-ups');
  assert.equal(a.c.money, before.money + res.amount);
  assert.equal(a.c.stats.str, before.str + 1);
  assert.deepEqual([a.c.skipTurns, a.c.skipReason], [1, 'hometown']);

  const b = sandbox({ era: 'senior' });
  const r = answer(b, 'hometown', 'visit').events.find((e) => e.type === 'submapResult');
  assert.deepEqual([r.result, r.amount], ['visit', r5(SM.hometown.visitGift * SM.scale.senior)]);
  assert.equal(b.c.stats.charm, 6);
  assert.equal(b.c.skipTurns ?? 0, 0);
});

test('engine: a hometown rest skips the next turn with its own log line, then play resumes', () => {
  let room = started();
  const id = cur(room);
  // put the current character one step before a hometown tile in 초등학생
  const c = ch(room, id);
  c.position = { eraIndex: 1, route: 'main', index: 0 };
  c.era = 'elem';
  room.board.eras[1].tiles[1] = { id: 'elem:main:1', type: 'hometown', label: '고향 시골집', icon: '🏡' };
  let r = applyAction(room, { type: 'spin', characterId: id }, { rng: fixedRng({ ints: [1] }), now: 1 });
  assert.equal(r.room.turn.pending?.kind, 'hometown');
  assert.ok(r.events.some((e) => e.type === 'submapEntered' && e.submap === 'hometown' && e.tileId === 'elem:main:1'));
  const landed = r.events.find((e) => e.type === 'landed');
  assert.equal(landed.cutin, false, 'the prompt takes the stage');
  assert.equal(r.room.turn.pending.scene, 'hometown');
  r = applyAction(r.room, { type: 'choose', characterId: id, promptId: r.room.turn.pending.promptId, optionId: 'rest' }, { now: 2 });
  room = r.room;
  // everyone else takes a turn; the resting character is skipped exactly once
  const order = room.turn.order;
  let skipped = 0;
  for (let i = 0; i < order.length * 2 + 2 && ch(room, id).skipTurns > 0; i++) {
    const turnChar = cur(room);
    assert.notEqual(turnChar, id);
    const res = applyAction(room, room.turn.pending ? { type: 'timeout', force: true } : { type: 'spin', characterId: turnChar }, { now: 10 + i });
    if (res.room.log.some((l) => l.text.includes('고향에서 푹 쉬는 중'))) skipped = 1;
    room = res.room;
  }
  assert.equal(skipped, 1);
  assert.equal(ch(room, id).skipTurns, 0);
  assert.equal(ch(room, id).skipReason, undefined);
});

// ---------- 사찰 ----------

test('temple: train offers the weakest + strongest stat (+2, skip a spin); wish = 시주 + luck check; leave', () => {
  const sb = sandbox({ era: 'middle', patch: { stats: { int: 3, str: 1, charm: 9, luck: 4 } } });
  assert.deepEqual(trainStats(sb.c, data), ['str', 'charm']);
  assert.deepEqual(trainStats({ stats: { int: 10, str: 10, charm: 10, luck: 2 } }, data), ['luck']);
  assert.deepEqual(trainStats({ stats: { int: 10, str: 10, charm: 10, luck: 10 } }, data), []);
  const p = openPrompt(sb.tx, 'temple', sb.c);
  assert.deepEqual(p.options.map((o) => o.id), ['train:str', 'train:charm', 'wish', 'leave']);
  assert.equal(p.defaultOptionId, 'leave');
  const wish = p.options.find((o) => o.id === 'wish');
  assert.equal(wish.chance, wishChance(sb.c, data));
  assert.equal(wish.cost, r5(SM.temple.offering * SM.scale.middle));

  const t = sandbox({ era: 'senior' });
  const ev = answer(t, 'temple', 'train:int').events;
  const res = ev.find((e) => e.type === 'submapResult');
  assert.deepEqual([res.result, res.stat, res.gain], ['train', 'int', 2]);
  assert.equal(t.c.stats.int, 5);
  assert.deepEqual([t.c.skipTurns, t.c.skipReason], [1, 'temple']);

  const ok = sandbox({ era: 'senior' });
  const m0 = ok.c.money;
  const okEv = answer(ok, 'temple', 'wish', { nexts: [0] }).events.find((e) => e.type === 'submapResult');
  const off = r5(SM.temple.offering * SM.scale.senior);
  const gain = r5(SM.temple.wish.money * SM.scale.senior);
  assert.deepEqual([okEv.result, okEv.amount, okEv.wishes], ['wishOk', gain - off, 1]);
  assert.deepEqual([ok.c.wishes, ok.c.stats.luck, ok.c.money], [1, 5, m0 - off + gain]);

  const no = sandbox({ era: 'senior' });
  const noEv = answer(no, 'temple', 'wish', { nexts: [0.999] }).events.find((e) => e.type === 'submapResult');
  assert.deepEqual([noEv.result, noEv.amount, no.c.wishes, no.c.stats.luck], ['wishFail', -off, 0, 4]);

  const lv = sandbox({ era: 'high' });
  assert.equal(answer(lv, 'temple', 'leave').events.find((e) => e.type === 'submapResult').result, 'leave');
  // no cash for the offering → wish disabled
  const poor = sandbox({ era: 'senior', patch: { money: 0 } });
  assert.equal(openPrompt(poor.tx, 'temple', poor.c).options.find((o) => o.id === 'wish').disabled, true);
});

test('산신령: the n-th granted wish (jobs.json unlock.wishes) at a 사찰 unlocks it (job era) → hiddenJobUnlocked + offer', () => {
  const W = data.jobs.jobs.find((j) => j.id === 'mountain_spirit').unlock.wishes;
  const room = started();
  const id = cur(room);
  const c = ch(room, id);
  Object.assign(c, { era: 'young', position: { eraIndex: 4, route: 'money', index: 0 }, route: 'money', careerDone: true, military: { status: 'done', turnsLeft: 0 }, wishes: W - 1, money: 800 });
  c.job = { id: 'police', rank: 1, exp: 0, injured: 0 };
  c.jobHistory = [{ id: 'police', rank: 1, era: 'young' }];
  room.board.eras[4].routes.money.tiles[1] = { id: 'young:money:1', type: 'temple', label: '사찰', icon: '🛕', route: 'money' };
  let r = applyAction(room, { type: 'spin', characterId: id }, { rng: fixedRng({ ints: [1] }), now: 1 });
  assert.equal(r.room.turn.pending?.kind, 'temple');
  r = applyAction(r.room, { type: 'choose', characterId: id, promptId: r.room.turn.pending.promptId, optionId: 'wish' }, { rng: fixedRng({ nexts: [0] }), now: 2 });
  assert.equal(ch(r.room, id).wishes, W);
  const un = r.events.find((e) => e.type === 'hiddenJobUnlocked');
  assert.equal(un?.jobId, 'mountain_spirit');
  assert.equal(r.room.turn.pending?.kind, 'hiddenJobOffer');
  assert.equal(r.room.turn.pending.context.jobId, 'mountain_spirit');
  const wishEv = r.events.find((e) => e.type === 'submapResult');
  assert.deepEqual([wishEv.cutin, wishEv.scene, wishEv.lineTag], [true, 'temple', 'temple_wish_ok']);
});

// ---------- 제주도 ----------

test('jeju: trip = cost + 매력/운 + maybe a treasure (source jeju); skip; no cash → disabled, default skip', () => {
  const sb = sandbox({ era: 'young' });
  const p = openPrompt(sb.tx, 'jeju', sb.c);
  assert.deepEqual(p.options.map((o) => o.id), ['trip', 'skip']);
  assert.equal(p.defaultOptionId, 'trip');
  const cost = r5(SM.jeju.cost * SM.scale.young);
  assert.deepEqual([p.options[0].cost, p.options[0].treasureChance], [cost, jejuTreasureChance(sb.c, data)]);

  const a = sandbox({ era: 'young' });
  const m0 = a.c.money;
  const ev = answer(a, 'jeju', 'trip', { nexts: [0, 0, 0] }).events;
  const res = ev.find((e) => e.type === 'submapResult');
  assert.deepEqual([res.result, res.amount, res.treasure], ['trip', -cost, true]);
  assert.deepEqual([a.c.stats.charm, a.c.stats.luck, a.c.money], [6, 5, m0 - cost]);
  const tf = ev.find((e) => e.type === 'treasureFound');
  assert.equal(tf.source, 'jeju');
  assert.equal(a.c.treasures.length, 1);
  assert.ok(Object.hasOwn(a.room.treasureValues, tf.uid));
  assert.ok(ev.indexOf(res) < ev.indexOf(tf));

  const b = sandbox({ era: 'middle_age' });
  const noT = answer(b, 'jeju', 'trip', { nexts: [0.99] }).events;
  assert.equal(noT.find((e) => e.type === 'submapResult').treasure, false);
  assert.ok(!noT.some((e) => e.type === 'treasureFound'));

  const s = sandbox({ era: 'young' });
  assert.equal(answer(s, 'jeju', 'skip').events.find((e) => e.type === 'submapResult').result, 'skip');
  assert.equal(s.c.money, 1000);

  const poor = sandbox({ era: 'young', patch: { money: 10 } });
  const pp = openPrompt(poor.tx, 'jeju', poor.c);
  assert.equal(pp.options[0].disabled, true);
  assert.equal(pp.defaultOptionId, 'skip');
});

// ---------- 인생역전 ----------

test('reversal: lotto (jackpot / lose), horse 2·5·10 (share of cash, win / lose), skip; every bet has EV < 1', () => {
  const L = SM.reversal.lotto;
  assert.ok(reversalLottoEv(data) < L.cost, `lotto EV ${reversalLottoEv(data)} < ${L.cost}`);
  for (const o of HORSE_ODDS) assert.ok(SM.reversal.horse.odds[o] * Number(o) < 1, `horse ${o}`);
  const sb = sandbox({ era: 'senior', patch: { money: 1000 } });
  const p = openPrompt(sb.tx, 'reversal', sb.c);
  assert.deepEqual(p.options.map((o) => o.id), ['lotto', 'horse:2', 'horse:5', 'horse:10', 'skip']);
  assert.equal(p.defaultOptionId, 'skip');
  assert.equal(horseStake(sb.c, data), 200);
  assert.ok(p.options.filter((o) => o.id.startsWith('horse:')).every((o) => o.stake === 200 && o.ev < 1));

  const j = sandbox({ era: 'senior', patch: { money: 1000 } });
  const jr = answer(j, 'reversal', 'lotto', { nexts: [0.001] }).events.find((e) => e.type === 'submapResult');
  assert.deepEqual([jr.result, jr.prize, jr.amount], ['jackpot', 3000, 3000 - L.cost]);
  assert.equal(j.c.money, 1000 + 3000 - L.cost);
  assert.equal(jr.tone, 'treasure');
  const lo = sandbox({ era: 'senior', patch: { money: 1000 } });
  const lr = answer(lo, 'reversal', 'lotto', { nexts: [0.99] }).events.find((e) => e.type === 'submapResult');
  assert.deepEqual([lr.result, lr.amount, lo.c.money], ['lottoLose', -L.cost, 1000 - L.cost]);

  const hw = sandbox({ era: 'senior', patch: { money: 1000 } });
  const hwr = answer(hw, 'reversal', 'horse:5', { nexts: [0.1] }).events.find((e) => e.type === 'submapResult');
  assert.deepEqual([hwr.result, hwr.odds, hwr.stake, hwr.amount, hw.c.money], ['horseWin', 5, 200, 800, 1800]);
  const hl = sandbox({ era: 'senior', patch: { money: 1000 } });
  const hlr = answer(hl, 'reversal', 'horse:10', { nexts: [0.5] }).events.find((e) => e.type === 'submapResult');
  assert.deepEqual([hlr.result, hlr.amount, hl.c.money], ['horseLose', -200, 800]);
  assert.equal(hlr.tone, 'bad');

  const sk = sandbox({ era: 'senior' });
  const skr = answer(sk, 'reversal', 'skip').events.find((e) => e.type === 'submapResult');
  assert.equal(skr.result, 'skip');
  const poor = sandbox({ era: 'senior', patch: { money: 5 } });
  assert.ok(openPrompt(poor.tx, 'reversal', poor.c).options.filter((o) => o.id !== 'skip').every((o) => o.disabled));
});

// ---------- treasures ----------

test('treasure tile: a treasure {uid, id} (public) with a hidden value; viewFor masks values until the game is over', () => {
  const room = started();
  const id = cur(room);
  const c = ch(room, id);
  Object.assign(c, { era: 'young', position: { eraIndex: 4, route: 'money', index: 0 }, route: 'money', careerDone: true, military: { status: 'done', turnsLeft: 0 } });
  c.job = { id: 'police', rank: 1, exp: 0, injured: 0 };
  room.board.eras[4].routes.money.tiles[1] = { id: 'young:money:1', type: 'treasure', label: '보물', icon: '🏺', route: 'money' };
  const r = applyAction(room, { type: 'spin', characterId: id }, { rng: fixedRng({ ints: [1] }), now: 1 });
  const found = r.events.find((e) => e.type === 'treasureFound');
  assert.ok(found, 'treasureFound');
  assert.deepEqual(ch(r.room, id).treasures, [{ uid: found.uid, id: found.treasureId }]);
  const value = r.room.treasureValues[found.uid];
  assert.ok(Number.isInteger(value));
  // presentation: the find takes over the landing's cut-in; MC treasure (big)
  assert.equal(r.events.find((e) => e.type === 'landed').cutin, false);
  assert.deepEqual([found.cutin, found.tone, found.lineTag, found.mcKey], [true, 'treasure', 'treasure', 'treasure']);
  assert.ok(found.mc.some((l) => !/\{\w+\}/.test(l.line)));
  // no value anywhere a client can see during play
  for (const sid of ['A', 'B', null]) {
    const v = viewFor(r.room, sid);
    assert.equal(v.treasureValues, null);
    assert.ok(!('treasureFakes' in v));
    assert.deepEqual(v.characters.find((x) => x.id === id).treasures, [{ uid: found.uid, id: found.treasureId }]);
  }
  assert.ok(!Object.keys(found).some((k) => /value|fake/i.test(k)));
  // forced end: values revealed in the result + treasureValues
  const done = endGame(r.room, { now: 9 });
  const v = viewFor(done.room, 'B');
  assert.equal(v.treasureValues[found.uid], value);
  const row = v.result.treasures.find((t) => t.uid === found.uid);
  assert.deepEqual([row.charId, row.treasureId, row.value, row.fake], [id, found.treasureId, value, !!r.room.treasureFakes[found.uid]]);
  assert.equal(v.result.ranking.find((x) => x.charId === id).treasures, value);
});

test('findTreasure: uids tr<n>, values in [min,max] or fake, weighted by the pool', () => {
  const sb = sandbox({ era: 'senior' });
  sb.tx.rng = createRng(3);
  const seen = new Set();
  for (let i = 0; i < 60; i++) {
    const t = findTreasure(sb.tx, sb.c, 'tile');
    seen.add(t.id);
    const def = treasureDefs(data).find((x) => x.id === t.id);
    const v = sb.room.treasureValues[t.uid];
    if (sb.room.treasureFakes[t.uid]) assert.ok(v <= data.treasures.fake.max);
    else assert.ok(v >= def.min && v <= def.max);
  }
  assert.equal(sb.c.treasures.at(-1).uid, 'tr60');
  assert.ok(seen.size >= 12, `variety ${seen.size}`);
});

// ---------- presentation ----------

test('presentation: Stage 9 events registered (anchors, cut-ins, scenes, tags, MC situations)', () => {
  for (const t of ['submapEntered', 'submapResult', 'treasureFound', 'mvpVoted', 'mvpDecided']) assert.ok(EVENT_TYPES.includes(t), t);
  for (const t of ['submapResult', 'treasureFound', 'mvpDecided']) {
    assert.ok(CUTIN_TYPES.has(t), `cut-in ${t}`);
    assert.ok(ANCHOR_TYPES.has(t), `anchor ${t}`);
  }
  assert.ok(!CUTIN_TYPES.has('submapEntered') && !CUTIN_TYPES.has('mvpVoted'));
  for (const s of ['hometown', 'temple', 'jeju', 'casino']) {
    assert.ok(data.tones.scenes[s]?.bg, s);
    assert.ok(data.tones.sceneFallbacks[s], `fallback ${s}`);
  }
  const room = started();
  const c = room.characters[0];
  const deco = (ev) => decorateEvents([{ ...ev }], { room: structuredClone(room), data, seed: 1 })[0];
  const cases = [
    [{ type: 'submapResult', charId: c.id, submap: 'hometown', optionId: 'rest', result: 'rest', amount: 30 }, 'hometown_rest', 'hometown', null],
    [{ type: 'submapResult', charId: c.id, submap: 'temple', optionId: 'wish', result: 'wishOk', amount: 20, wishes: 1 }, 'temple_wish_ok', 'temple', 'temple'],
    [{ type: 'submapResult', charId: c.id, submap: 'jeju', optionId: 'trip', result: 'trip', amount: -120 }, 'jeju_trip', 'jeju', 'jeju'],
    [{ type: 'submapResult', charId: c.id, submap: 'reversal', optionId: 'lotto', result: 'jackpot', amount: 2965, prize: 3000 }, 'reversal_jackpot', 'casino', 'reversalWin'],
    [{ type: 'submapResult', charId: c.id, submap: 'reversal', optionId: 'horse:2', result: 'horseLose', amount: -200 }, 'reversal_lose', 'casino', 'reversalLose'],
  ];
  for (const [ev, tag, scene, mcKey] of cases) {
    const d = deco(ev);
    assert.deepEqual([d.lineTag, d.scene, d.cutin], [tag, scene, true], JSON.stringify(ev));
    assert.ok(d.line && !/\{\w+\}/.test(d.line), d.line);
    if (mcKey === 'reversalWin') assert.equal(d.mcKey, mcKey); // big → always hosted
    else if (d.mcKey) assert.equal(d.mcKey, mcKey);
  }
  assert.equal(deco({ type: 'submapResult', charId: c.id, submap: 'reversal', optionId: 'skip', result: 'skip' }).cutin, false, 'a pass is a banner');
  const entered = deco({ type: 'submapEntered', charId: c.id, submap: 'reversal', tileId: 'x' });
  assert.deepEqual([entered.cutin, entered.scene], [false, 'casino']);
});

// ---------- CPU ----------

test('CPU: answers every submap prompt with an enabled option the engine accepts; bold gambles, cautious passes', () => {
  for (const kind of SUBMAPS) {
    for (const personality of ['cautious', 'normal', 'bold']) {
      for (const money of [0, 60, 800, 5000]) {
        const room = started();
        const id = cur(room);
        const c = ch(room, id);
        Object.assign(c, { ownerSessionId: 'cpu', cpuPersonality: personality, money, era: kind === 'reversal' ? 'senior' : kind === 'jeju' ? 'young' : 'middle' });
        const tx = createTx(room, { rng: createRng(1), now: 0, data });
        openPrompt(tx, kind, c);
        const optionId = cpuAnswer(room, id, data);
        const opt = room.turn.pending.options.find((o) => o.id === optionId);
        assert.ok(opt && !opt.disabled, `${kind}/${personality}/${money}: ${optionId}`);
        const r = applyAction(room, { type: 'choose', characterId: id, promptId: room.turn.pending.promptId, optionId, actor: { system: true, cpu: true } }, { now: 1 });
        assert.ok(r.events.some((e) => e.type === 'submapResult'), kind);
      }
    }
  }
  const pick = (personality, money = 5000) => {
    const room = started();
    const id = cur(room);
    Object.assign(ch(room, id), { ownerSessionId: 'cpu', cpuPersonality: personality, money, era: 'senior' });
    openPrompt(createTx(room, { rng: createRng(1), now: 0, data }), 'reversal', ch(room, id));
    return cpuAnswer(room, id, data);
  };
  assert.equal(pick('cautious'), 'skip');
  assert.match(pick('bold'), /^horse:|^lotto$/);
});

// ---------- restore ----------

test('restore: a JSON snapshot with treasures + an open temple prompt continues identically', () => {
  const room = started();
  const id = cur(room);
  const c = ch(room, id);
  Object.assign(c, { era: 'high', position: { eraIndex: 3, route: 'main', index: 0 } });
  room.board.eras[3].tiles[1] = { id: 'high:main:1', type: 'temple', label: '사찰', icon: '🛕' };
  const tx = createTx(room, { rng: createRng(2), now: 0, data });
  findTreasure(tx, c, 'tile');
  room.rngState = tx.rng.state;
  const r = applyAction(room, { type: 'spin', characterId: id }, { rng: fixedRng({ ints: [1] }), now: 1 });
  assert.equal(r.room.turn.pending?.kind, 'temple');
  const snap = JSON.parse(JSON.stringify(r.room));
  const act = { type: 'choose', characterId: id, promptId: snap.turn.pending.promptId, optionId: 'wish' };
  const a = applyAction(r.room, act, { now: 5 });
  const b = applyAction(snap, act, { now: 5 });
  assert.deepEqual(b.room, a.room);
  assert.deepEqual(b.room.treasureValues, r.room.treasureValues);
  // pre-Stage-9 characters / rooms migrate (no treasures / record / wishes fields)
  const old = JSON.parse(JSON.stringify(snap));
  for (const x of old.characters) {
    delete x.treasures;
    delete x.record;
    delete x.wishes;
  }
  for (const k of ['treasureValues', 'treasureFakes', 'nextTreasureSeq', 'highlights', 'highlightSeq']) delete old[k];
  const m = applyAction(old, act, { now: 5 });
  assert.ok(m.room.characters.every((x) => Array.isArray(x.treasures) && x.record && typeof x.wishes === 'number'));
  assert.deepEqual(m.room.treasureValues, {});
});

// ---------- random games ----------

test('random lifetime games: submaps / treasures happen; every event known, lines filled; totals add up', () => {
  const seen = new Set();
  for (const seed of [4, 9, 12]) {
    let room = started({ seed, chars: [['A', 'A1'], ['B', 'B1'], ['A', 'A2'], ['B', 'B2']] });
    const rng = createRng(seed);
    for (let i = 0; i < 3000 && room.status === 'playing'; i++) {
      const p = room.turn.pending;
      const action = p
        ? { type: 'choose', characterId: p.forCharacterIds.find((x) => !Object.hasOwn(p.answers, x)), promptId: p.promptId, optionId: rng.pick(p.options.filter((o) => !o.disabled)).id }
        : { type: 'spin', characterId: cur(room) };
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
    for (const r of room.result.ranking) assert.equal(r.total, r.money - r.debt + r.items + r.house + r.treasures + r.awards);
  }
  for (const t of ['submapEntered', 'submapResult', 'treasureFound', 'gameOver']) assert.ok(seen.has(t), t);
});
