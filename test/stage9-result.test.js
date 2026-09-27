// Stage 9-A — result show (server): special awards + tie rules, ending titles (data-driven conditions), life records
// + highlights (capture, cap), the final ranking composition, the gameOver payload, MVP vote rules (engine, runner
// timer, admin / player HTTP), snapshot restore with the vote open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameData } from '../server/data/index.js';
import { applyAction, endGame, startGame } from '../server/game/engine.js';
import { addCharacter, addCpuCharacter, joinRoom } from '../server/game/lobby.js';
import { AWARD_METRICS, careerScore, computeAwards, computeTitles, conditionMet, routeMedal, routesExperienced, titleFacts } from '../server/game/awards.js';
import { eventRef, recordHighlights, topHighlights, trackRecords } from '../server/game/highlights.js';
import { applyResult, computeRanking, mvpCounts } from '../server/game/result.js';
import { validateRoomConfig } from '../server/game/config.js';
import { viewFor } from '../server/game/view.js';
import { RoomStore } from '../server/store/roomStore.js';
import { GameRunner } from '../server/store/gameRunner.js';
import { startServer } from '../server/index.js';
import { httpCall, makeRoom, tempDir } from './helpers.js';

const data = gameData();
const SHORT = { baby: 1, elem: 1, middle: 1, high: 2, young: 3, middle_age: 3, senior: 2 };

function started({ chars = [['A', 'A1'], ['B', 'B1'], ['A', 'A2']], seed = 7, config = {}, players = ['A', 'B'] } = {}) {
  let room = makeRoom({ seed });
  room.config = { ...room.config, ...config };
  for (const p of players) room = joinRoom(room, p, `플레이어${p}`, 0).room;
  for (const [owner, name] of chars) room = addCharacter(room, owner, { name }, 0).room;
  const r = startGame(room, { now: 0 });
  assert.equal(r.ok, true, r.error);
  return r.room;
}
const cur = (room) => room.turn.order[room.turn.currentIndex];
const ch = (room, id) => room.characters.find((c) => c.id === id);

/** Play a room to the end with a simple policy (prompt default / first enabled option). */
function playToEnd(room, now = 1000) {
  let t = now;
  for (let i = 0; i < 5000 && room.status === 'playing'; i++) {
    const p = room.turn.pending;
    t += 1000;
    const action = p
      ? { type: 'choose', characterId: p.forCharacterIds.find((x) => !Object.hasOwn(p.answers, x)), promptId: p.promptId, optionId: (p.options.find((o) => o.id === p.defaultOptionId && !o.disabled) ?? p.options.find((o) => !o.disabled)).id }
      : { type: 'spin', characterId: cur(room) };
    const r = applyAction(room, action, { now: t });
    room = r.room;
    if (room.status === 'finished') return { room, events: r.events, now: t };
  }
  throw new Error('game did not finish');
}

/** A finished-looking room for pure result tests (characters with hand-set fields). */
function endRoom(patches) {
  const room = started({ chars: patches.map((p, i) => [i % 2 ? 'B' : 'A', `C${i + 1}`]) });
  room.characters.forEach((c, i) => {
    Object.assign(c, { money: 1000, debt: 0, children: [], jobHistory: [], job: null, routeHistory: [], house: null, treasures: [], place: i + 1, finished: true, record: { ...c.record } }, patches[i]);
  });
  return room;
}

// ---------- awards ----------

test('awards.json / titles.json: schema (metrics exist, tie rules, bonuses within 25 % of a typical winner)', () => {
  const ids = new Set();
  for (const a of data.awards.awards) {
    assert.ok(!ids.has(a.id), a.id);
    ids.add(a.id);
    assert.ok(a.name && a.icon && a.desc, a.id);
    assert.ok(AWARD_METRICS[a.metric], `${a.id}: metric ${a.metric}`);
    assert.ok(['all', 'split', 'place', 'qualify'].includes(a.tie), `${a.id}: tie ${a.tie}`);
    assert.ok(Number.isInteger(a.bonus) && a.bonus > 0 && a.bonus <= 400, a.id);
    if (a.metric === 'routeMedal') assert.ok(['love', 'career', 'money'].includes(a.route));
  }
  for (const id of ['dabok', 'genius_parent', 'career', 'treasure_king', 'landlord', 'love_medal', 'career_medal', 'money_medal', 'max_level', 'lucky']) assert.ok(ids.has(id), id);
  const T = data.titles.titles;
  assert.ok(T.filter((t) => !t.fallback).length >= 15, `${T.length} titles`);
  assert.equal(T.filter((t) => t.fallback).length, 1);
  assert.equal(new Set(T.map((t) => t.id)).size, T.length);
  const facts = titleFacts(started(), started().characters[0], { data, ranking: [] });
  const walk = (c) => {
    if (!c) return;
    if (c.all || c.any) return (c.all ?? c.any).forEach(walk);
    if (c.not) return walk(c.not);
    assert.ok(c.fact in facts, `unknown fact ${c.fact}`);
  };
  for (const t of T) {
    assert.ok(t.name && t.icon && t.desc && Number.isFinite(t.priority), t.id);
    if (!t.fallback) walk(t.when);
  }
  for (const name of ['흙수저 신화', '파산의 왕', '만년 공무원', '연애 고자', '대가족', '부동산 큰손', '로또 인생', '워커홀릭']) assert.ok(T.some((t) => t.name === name), name);
});

test('computeAwards: best value wins; ties all / split / place; medals qualify everyone; min thresholds', () => {
  const kid = (talent = 'normal') => ({ id: 'k', talent });
  const room = endRoom([
    { children: [kid(), kid('genius')], routeHistory: [{ era: 'young', route: 'love', completed: true }, { era: 'middle_age', route: 'love', completed: true }], place: 2 },
    { children: [kid(), kid()], routeHistory: [{ era: 'young', route: 'love', completed: true }, { era: 'middle_age', route: 'love', completed: true }], place: 1 },
    { children: [], house: { id: 'villa', price: 700, value: 900, boughtTurn: 1 }, record: { luckWin: 40 }, routeHistory: [{ era: 'young', route: 'money', completed: true }, { era: 'middle_age', route: 'career', completed: true }] },
  ]);
  const [a, b, c] = room.characters;
  const aw = Object.fromEntries(computeAwards(room, data).map((x) => [x.id, x]));
  assert.deepEqual(aw.dabok.charIds, [b.id, a.id], 'tie all: both, earlier goal first');
  assert.equal(aw.dabok.bonus, data.awards.awards.find((x) => x.id === 'dabok').bonus);
  assert.deepEqual(aw.genius_parent.charIds, [a.id]);
  assert.deepEqual(aw.love_medal.charIds, [b.id, a.id], 'qualify: everyone');
  assert.equal(aw.money_medal, undefined, 'money medal needs both route eras');
  assert.deepEqual(aw.landlord.charIds, [c.id]);
  assert.deepEqual([aw.lucky.charIds, aw.lucky.value], [[c.id], 40]);
  assert.equal(aw.treasure_king, undefined, 'nobody has a treasure');
  assert.equal(aw.career, undefined, 'min 20 = rank 2 of a regular job');
  // split / place with custom data
  const custom = { ...data, awards: { awards: [
    { id: 's', name: 'S', metric: 'children', min: 1, bonus: 101, tie: 'split' },
    { id: 'p', name: 'P', metric: 'children', min: 1, bonus: 50, tie: 'place' },
  ] } };
  const cw = Object.fromEntries(computeAwards(room, custom).map((x) => [x.id, x]));
  assert.deepEqual([cw.s.charIds.length, cw.s.bonus], [2, 50]);
  assert.deepEqual(cw.p.charIds, [b.id], 'place: the earlier goal');
});

test('award metrics: career score (hidden jobs first), route medals, experienced areas, treasure / house values', () => {
  const max = (id) => data.jobs.jobs.find((j) => j.id === id).ranks.length;
  assert.equal(careerScore(data, { job: { id: 'doctor', rank: 2 }, jobHistory: [{ id: 'doctor', rank: 2 }] }), 20);
  assert.equal(careerScore(data, { job: null, jobHistory: [{ id: 'chef', rank: max('chef') }] }), max('chef') * 10 + 5);
  assert.ok(careerScore(data, { job: { id: 'mountain_spirit', rank: 1 }, jobHistory: [{ id: 'doctor', rank: 4 }, { id: 'mountain_spirit', rank: 1 }] }) > 100);
  assert.equal(careerScore(data, { job: { id: 'parttime', rank: 3 }, jobHistory: [{ id: 'parttime', rank: 3 }] }), 0);
  assert.equal(routeMedal({ routeHistory: [{ era: 'young', route: 'money', completed: true }, { era: 'middle_age', route: 'money', completed: false }] }, 'money'), false);
  assert.equal(routesExperienced({ routeHistory: [{ route: 'love' }, { route: 'career' }], house: { id: 'villa' } }), 3);
  assert.equal(routesExperienced({ routeHistory: [], spouse: { name: 'x' }, job: { rank: 2 }, treasures: [] }), 2);
});

// ---------- titles ----------

test('titles: conditions (all / any / not / eq / min / max, missing facts fail); ≤ 2 per character by priority; fallback', () => {
  const f = { a: 3, job: 'civil_servant', none: null };
  assert.equal(conditionMet({ fact: 'a', min: 3 }, f), true);
  assert.equal(conditionMet({ fact: 'a', max: 2 }, f), false);
  assert.equal(conditionMet({ fact: 'job', eq: 'civil_servant' }, f), true);
  assert.equal(conditionMet({ fact: 'none', max: 5 }, f), false, 'null fact');
  assert.equal(conditionMet({ fact: 'nope', min: 0 }, f), false, 'missing fact');
  assert.equal(conditionMet({ all: [{ fact: 'a', min: 1 }, { any: [{ fact: 'a', eq: 9 }, { not: { fact: 'a', eq: 9 } }] }] }, f), true);

  const room = endRoom([
    // 흙수저 신화 + 로또 인생 + (more, but only 2)
    { money: 5000, record: { worstRankPct: 1, luckWin: 900, bankruptcies: 2, submaps: {} }, children: [{}, {}, {}], place: 3 },
    // 만년 공무원 (priority 85) + 파산의 왕
    { money: 100, job: { id: 'civil_servant', rank: 1, exp: 0, injured: 0 }, jobHistory: [{ id: 'civil_servant', rank: 1, era: 'young' }], record: { bankruptcies: 3, submaps: {} }, place: 1 },
    // nothing special → 평범한 인생 (kids era, 3rd place of 4 would be…)
    { money: 500, era: 'high', place: 2, stats: { int: 3, str: 3, charm: 3, luck: 3 } },
    { money: 400, era: 'high', place: 4, stats: { int: 3, str: 3, charm: 3, luck: 3 } },
  ]);
  const ranking = computeRanking(room, { data, reveal: true });
  const titles = computeTitles(room, data, { ranking });
  const [a, b, c, d] = room.characters;
  assert.deepEqual(titles[a.id], ['dirt_spoon', 'lotto_life']);
  assert.deepEqual(titles[b.id], ['eternal_civil', 'bankrupt_king']);
  assert.deepEqual(titles[c.id], ['ordinary']);
  assert.deepEqual(titles[d.id], ['turtle'], 'last to arrive (≥ 3 characters)');
  for (const list of Object.values(titles)) assert.ok(list.length >= 1 && list.length <= data.titles.perCharacter);
  // 연애 고자: adult life, never married, a failed proposal
  const lz = endRoom([{ era: 'senior', spouse: null, record: { proposeFails: 1, submaps: {} } }, { era: 'senior', spouse: { name: 'x' } }]);
  const lt = computeTitles(lz, data, { ranking: computeRanking(lz, { data }) });
  assert.ok(lt[lz.characters[0].id].includes('love_zero'));
  assert.ok(!lt[lz.characters[1].id].includes('love_zero'));
});

// ---------- records + highlights ----------

test('trackRecords: bankruptcies (not 학자금), luck winnings, gambles, sabotage, overtime, worst rank at adult era entries', () => {
  const room = started();
  const [a, b, c] = room.characters;
  a.money = 0;
  b.money = 5000;
  const events = [
    { type: 'moneyChanged', charId: a.id, delta: -60, reason: 'tuition', money: 0, debt: 60 },
    { type: 'moneyChanged', charId: a.id, delta: 100, reason: 'salary', money: 40, debt: 0 },
    { type: 'moneyChanged', charId: a.id, delta: -300, reason: 'tile', money: 0, debt: 260 },
    { type: 'moneyChanged', charId: c.id, delta: 200, reason: 'lotto', money: 1200, debt: 0 },
    { type: 'submapResult', charId: c.id, submap: 'reversal', optionId: 'horse:2', result: 'horseWin', amount: 150 },
    { type: 'moneyChanged', charId: c.id, delta: 150, reason: 'reversal', money: 1350, debt: 0 },
    { type: 'submapResult', charId: c.id, submap: 'temple', optionId: 'leave', result: 'leave' },
    { type: 'cardUsed', charId: b.id, cardId: 'noise', uid: 'k1', cardKind: 'sabotage', targetId: a.id },
    { type: 'promptResolved', charId: b.id, kind: 'jobTile', result: 'overtime' },
    { type: 'proposed', charId: b.id, success: false },
    { type: 'eraChanged', charId: a.id, era: 'young' },
  ];
  a.debt = 260;
  trackRecords(room, events);
  assert.equal(a.record.bankruptcies, 1, 'the tuition loan is not a bankruptcy, the later loss is');
  assert.equal(events[2].bankrupt, true);
  assert.equal(events[0].bankrupt, undefined);
  assert.deepEqual([c.record.luckWin, c.record.gambles, c.record.submaps.reversal, c.record.submaps.temple], [350, 1, 1, 0]);
  assert.deepEqual([b.record.sabotage, a.record.sabotaged, b.record.overtime, b.record.proposeFails], [1, 1, 1, 1]);
  assert.equal(a.record.worstRankPct, 1, 'the poorest at its 청년 entry');
  assert.equal(a.record.maxDebt, 260);
});

test('highlights: dramatic moments per character, top 8 by score kept (chronological), top 5 in the result; eventRef is scalar', () => {
  const room = started();
  const [a, b] = room.characters;
  const ev = (e) => ({ tone: 'good', scene: 'office', emotion: 'joy', ...e });
  const events = [
    ev({ type: 'married', charId: a.id, spouse: { name: '서연', avatar: { body: 'girl' } } }),
    ev({ type: 'childBorn', charId: a.id, child: { name: '하윤', talent: 'genius' } }),
    ev({ type: 'submapResult', charId: a.id, submap: 'reversal', optionId: 'lotto', result: 'jackpot', amount: 2965, prize: 3000 }),
    ev({ type: 'cardUsed', charId: b.id, cardId: 'tax_audit', uid: 'k1', cardKind: 'sabotage', targetId: a.id }),
    ev({ type: 'moneyChanged', charId: b.id, delta: -400, reason: 'tile', money: 0, debt: 100, bankrupt: true }),
    ev({ type: 'moneyChanged', charId: a.id, delta: 20, reason: 'tile', money: 20, debt: 0 }), // too small
  ];
  recordHighlights(room, events, { data });
  const ha = room.highlights[a.id];
  assert.deepEqual(ha.map((h) => h.type), ['married', 'childBorn', 'submapResult', 'cardUsed']);
  assert.match(ha[0].text, /서연/);
  assert.ok(ha[2].score > ha[0].score, 'the jackpot beats the wedding');
  assert.deepEqual(room.highlights[b.id].map((h) => h.type), ['cardUsed', 'moneyChanged']);
  for (const h of ha) {
    assert.ok(h.turnNo >= 1 && h.tone && h.scene && h.text);
    for (const v of Object.values(h.eventRef)) assert.ok(v === null || typeof v !== 'object', 'scalar eventRef');
  }
  assert.equal(ha[0].eventRef.spouseName, '서연');
  // cap: 12 more big money swings → 8 kept, the best scores, still in order
  const many = Array.from({ length: 12 }, (_, i) => ev({ type: 'moneyChanged', charId: a.id, delta: 300 + i * 100, reason: 'tile', money: 5000, debt: 0 }));
  recordHighlights(room, many, { data });
  assert.equal(room.highlights[a.id].length, data.balance.result.highlights.keep);
  const seqs = room.highlights[a.id].map((h) => h.seq);
  assert.deepEqual(seqs, [...seqs].sort((x, y) => x - y));
  assert.ok(room.highlights[a.id].some((h) => h.eventRef.result === 'jackpot'), 'the jackpot survives');
  const top = topHighlights(room.highlights, 5);
  assert.equal(top[a.id].length, 5);
  assert.deepEqual(eventRef({ type: 'x', a: 1, b: { c: 2 }, mc: [1] }), { type: 'x', a: 1 });
});

// ---------- the final result ----------

test('game over: ranking total = money − debt + items + house + treasures + awards; payload carries awards / titles / treasures', () => {
  let room = started({ config: { mode: 'lifetime', eraTurns: SHORT } });
  // seed a treasure + a house on one character so every component shows up
  const c = room.characters[0];
  c.treasures = [{ uid: 'tr1', id: 'celadon' }];
  room.treasureValues = { tr1: 555 };
  room.treasureFakes = {};
  room.nextTreasureSeq = 1;
  const { room: done, events } = playToEnd(room);
  room = done;
  const go = events.find((e) => e.type === 'gameOver');
  const res = room.result;
  for (const r of res.ranking) {
    const x = ch(room, r.charId);
    assert.equal(r.total, r.money - r.debt + r.items + r.house + r.treasures + r.awards);
    assert.equal(r.treasures, (x.treasures ?? []).reduce((s, t) => s + room.treasureValues[t.uid], 0));
    const bonus = res.awards.filter((a) => a.charIds.includes(r.charId)).reduce((s, a) => s + a.bonus, 0);
    assert.equal(r.awards, bonus);
  }
  for (let i = 1; i < res.ranking.length; i++) assert.ok(res.ranking[i - 1].total >= res.ranking[i].total);
  assert.equal(res.ranking.find((r) => r.charId === c.id).treasures, 555);
  assert.deepEqual(res.treasures.find((t) => t.uid === 'tr1'), { ...res.treasures.find((t) => t.uid === 'tr1'), charId: c.id, treasureId: 'celadon', value: 555, fake: false });
  assert.deepEqual(go.ranking, res.ranking);
  assert.deepEqual(go.awards.map((a) => a.id), res.awards.map((a) => a.id));
  assert.deepEqual(go.titles, res.titles);
  assert.deepEqual(go.treasures.map((t) => [t.uid, t.value]), res.treasures.map((t) => [t.uid, t.value]));
  assert.ok(go.treasures.every((t) => t.line && t.lineTag), 'appraisal lines');
  assert.ok(go.awards.every((a) => a.line && !/\{\w+\}/.test(a.line)));
  assert.ok(res.treasures.every((t) => t.line), 'lines copied onto the result (reload)');
  assert.equal(go.mvpClosesAt, res.mvp.closesAt);
  assert.deepEqual([res.mvp.closed, res.mvp.winner, res.mvp.votes], [false, null, {}]);
  assert.equal(res.mvp.closesAt - room.finishedAt, data.balance.result.mvpVoteMs);
  assert.ok(Object.keys(res.titles).length === room.characters.length);
  assert.ok(Object.values(res.highlights).every((l) => l.length <= 5));
  assert.ok(go.mc.some((l) => l.part === 'appraisal'), 'the MC appraises the treasure');
  assert.ok(go.mc.some((l) => l.part === 'mvp'), 'the MC calls the vote');
  // everyone sees the values now
  assert.equal(viewFor(room, 'B').treasureValues.tr1, 555);
});

// ---------- MVP vote ----------

function finishedRoom({ players = ['A', 'B'], chars } = {}) {
  const room = started({ players, chars, config: { mode: 'kids', eraTurns: { baby: 1, elem: 1, middle: 1, high: 2 } } });
  return playToEnd(room);
}

test('MVP vote: players only, one vote each (changeable), never your own character, ties → higher total, admin close', () => {
  const { room: done, now } = finishedRoom({ chars: [['A', 'A1'], ['B', 'B1'], ['B', 'B2']] });
  let room = done;
  const [a1, b1, b2] = room.characters;
  room = joinRoom(room, 'W', '관전', now, { spectator: true }).room;
  const vote = (sid, targetId, t = now + 10) => applyAction(room, { type: 'vote', targetId, actor: { sessionId: sid } }, { now: t });
  const err = (fn, status, re) => assert.throws(fn, (e) => e.status === status && re.test(e.message));
  err(() => vote('A', a1.id), 409, /내 캐릭터/);
  err(() => vote('W', a1.id), 403, /관전자/);
  err(() => vote('Z', a1.id), 403, /참가자/);
  err(() => vote('A', 'c99'), 404, /캐릭터/);
  err(() => applyAction(room, { type: 'vote', targetId: a1.id, actor: { admin: true } }, { now }), 403, /플레이어만/);
  let r = vote('A', b1.id);
  assert.deepEqual(r.events.map((e) => e.type), ['mvpVoted']);
  assert.deepEqual([r.events[0].playerId, r.events[0].charId, r.events[0].changed], ['p1', b1.id, false]);
  room = r.room;
  r = vote('A', b2.id);
  assert.equal(r.events[0].changed, true);
  room = r.room;
  assert.deepEqual(room.result.mvp.votes, { p1: b2.id });
  // B votes A1 → everyone voted: the vote closes after the settle time
  r = vote('B', a1.id, now + 20);
  room = r.room;
  assert.equal(room.result.mvp.closesAt, now + 20 + data.balance.result.mvpSettleMs);
  err(() => applyAction(room, { type: 'closeVote', actor: { system: true } }, { now: now + 21 }), 409, /남았어요/);
  const closed = applyAction(room, { type: 'closeVote', actor: { system: true } }, { now: room.result.mvp.closesAt });
  const d = closed.events.find((e) => e.type === 'mvpDecided');
  // 1 : 1 tie → the one ranked higher (higher total)
  assert.equal(d.charId, room.result.ranking.find((x) => [a1.id, b2.id].includes(x.charId)).charId);
  assert.deepEqual(d.votes, mvpCounts(room.result.mvp.votes));
  assert.deepEqual([d.mcKey, d.mcStudio, d.cutin, d.lineTag], ['mvp', true, true, 'mvp']);
  assert.ok(d.mc.every((l) => !/\{\w+\}/.test(l.line)));
  const after = closed.room;
  assert.deepEqual([after.result.mvp.closed, after.result.mvp.winner], [true, d.charId]);
  assert.equal(after.result.mvp.line, d.line);
  err(() => applyAction(after, { type: 'vote', targetId: b1.id, actor: { sessionId: 'A' } }, { now: now + 99999 }), 409, /이미 끝났어요/);
  err(() => applyAction(after, { type: 'closeVote', actor: { admin: true } }, { now: now + 99999 }), 409, /이미 끝났어요/);
  // admin closes early; no votes → 1st place, note noVotes
  const early = applyAction(done, { type: 'closeVote', actor: { admin: true } }, { now: now + 1 });
  const e = early.events.find((x) => x.type === 'mvpDecided');
  assert.deepEqual([e.charId, e.note], [done.result.ranking[0].charId, 'noVotes']);
  // vote / closeVote only after the game
  const playing = started();
  err(() => applyAction(playing, { type: 'vote', targetId: 'c1', actor: { sessionId: 'B' } }, { now: 1 }), 409, /결과 발표 중이 아니에요/);
  // a player owning every character may vote for one of them
  const solo = finishedRoom({ players: ['A'], chars: [['A', 'A1'], ['A', 'A2']] });
  const sv = applyAction(solo.room, { type: 'vote', targetId: solo.room.characters[1].id, actor: { sessionId: 'A' } }, { now: solo.now + 1 });
  assert.equal(sv.room.result.mvp.votes.p1, solo.room.characters[1].id);
});

test('MVP: no eligible voters (CPU-only / spectators only) → decided at game over (1st place, noVoters) in the same batch', () => {
  let room = makeRoom({ seed: 3 });
  room.config = { ...room.config, mode: 'kids', eraTurns: { baby: 1, elem: 1, middle: 1, high: 2 }, allowCpu: true };
  room = joinRoom(room, 'W', '관전', 0, { spectator: true }).room;
  room = addCpuCharacter(room, {}, 0).room;
  room = addCpuCharacter(room, {}, 0).room;
  const s = startGame(room, { now: 0 });
  assert.equal(s.ok, true, s.error);
  const { room: done, events } = playToEnd(s.room);
  const types = events.map((e) => e.type);
  assert.ok(types.indexOf('gameOver') < types.indexOf('mvpDecided'));
  const go = events.find((e) => e.type === 'gameOver');
  assert.equal(go.mvpClosesAt, null);
  assert.ok(!go.mc?.some((l) => l.part === 'mvp'), 'no vote call without voters');
  assert.deepEqual([done.result.mvp.closed, done.result.mvp.winner, done.result.mvp.note], [true, done.result.ranking[0].charId, 'noVoters']);
  const d = events.find((e) => e.type === 'mvpDecided');
  assert.deepEqual([d.charId, d.note], [done.result.ranking[0].charId, 'noVoters']);
  assert.equal(GameRunner.deadlineOf(done), null, 'nothing to wait for');
});

test('forced end (admin): full result (awards / titles / treasures) with the vote open; runner closes it on its timer', async (t) => {
  const tmp = await tempDir();
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 2_000_000 });
  try {
    const store = new RoomStore({ dataDir: tmp.dir, debounceMs: 1 });
    await store.load();
    const runner = new GameRunner(store, { secret: () => 5, cpuDelayMs: 0 });
    const cfg = validateRoomConfig({ mode: 'adult', eraTurns: { young: 5, middle_age: 5, senior: 3 }, turnOrder: 'index' }).config;
    let room = store.createRoom(cfg);
    room = joinRoom(room, 'A', '에이').room;
    room = joinRoom(room, 'B', '비').room;
    room = addCharacter(room, 'A', { name: '에이1' }).room;
    room = addCharacter(room, 'B', { name: '비1' }).room;
    store.put(room);
    assert.equal(runner.start(room.id).ok, true);
    const ended = runner.end(room.id);
    assert.equal(ended.ok, true);
    const live = store.getRoom(room.id);
    assert.equal(live.status, 'finished');
    assert.equal(live.result.forced, true);
    assert.ok(Array.isArray(live.result.awards) && live.result.titles && Array.isArray(live.result.treasures));
    assert.equal(live.result.mvp.closed, false);
    const d = GameRunner.deadlineOf(live);
    assert.deepEqual([d.kind, d.at], ['vote', live.result.mvp.closesAt]);
    // a vote, then the timer closes it
    const v = runner.dispatch(room.id, { type: 'vote', targetId: 'c2', actor: { sessionId: 'A' } });
    assert.equal(v.ok, true, v.error);
    t.mock.timers.tick(data.balance.result.mvpVoteMs - 10);
    assert.equal(store.getRoom(room.id).result.mvp.closed, false);
    // snapshot restore with the vote open: the restored runner closes it too
    const snap = JSON.parse(JSON.stringify(store.getRoom(room.id)));
    t.mock.timers.tick(20);
    const fin = store.getRoom(room.id);
    assert.deepEqual([fin.result.mvp.closed, fin.result.mvp.winner], [true, 'c2']);
    runner.stop();
    const store2 = new RoomStore({ dataDir: tmp.dir, debounceMs: 1 });
    store2.rooms.set(snap.id, snap);
    const runner2 = new GameRunner(store2, { cpuDelayMs: 0 });
    runner2.restore();
    t.mock.timers.tick(50);
    assert.deepEqual([store2.getRoom(snap.id).result.mvp.closed, store2.getRoom(snap.id).result.mvp.winner], [true, 'c2']);
    runner2.stop();
    await store.close?.();
    await store2.close?.();
  } finally {
    t.mock.timers.reset();
    await tmp.cleanup();
  }
});

test('HTTP: /api/meta Stage 9 data; players vote (spectators 403, own 409); admin closeVote', async () => {
  const tmp = await tempDir();
  const srv = await startServer({ port: 0, host: '127.0.0.1', dataDir: tmp.dir, adminPassword: 'pw', debounceMs: 5, log: () => {}, cpuDelayMs: 0 });
  const call = (m, p, o) => httpCall(srv.url, m, p, o);
  try {
    const meta = (await call('GET', '/api/meta')).json;
    assert.ok(meta.treasures.treasures.length >= 20 && meta.awards.awards.length >= 10 && meta.titles.titles.length >= 16);
    assert.equal(meta.balance.result.mvpVoteMs, 180000);
    assert.ok(meta.balance.submaps.reversal.horse.odds['10']);
    assert.ok(meta.board.tileTypes.temple && meta.board.tileTypes.reversal);
    const login = await call('POST', '/admin/api/login', { body: { password: 'pw' } });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const created = await call('POST', '/admin/api/rooms', { cookie, body: { mode: 'adult', eraTurns: { young: 3, middle_age: 3, senior: 2 } } });
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
    // vote during play → 409
    assert.equal((await call('POST', `/api/rooms/${id}/actions`, { token: A, body: { type: 'vote', targetId: 'c2' } })).status, 409);
    assert.equal((await call('POST', `/admin/api/rooms/${id}/actions`, { cookie, body: { type: 'closeVote' } })).status, 409);
    assert.equal((await call('POST', `/admin/api/rooms/${id}/end`, { cookie })).status, 200);
    const own = await call('POST', `/api/rooms/${id}/actions`, { token: A, body: { type: 'vote', targetId: 'c1' } });
    assert.equal(own.status, 409);
    assert.match(own.json.error, /내 캐릭터/);
    const spec = await call('POST', `/api/rooms/${id}/actions`, { token: W, body: { type: 'vote', targetId: 'c1' } });
    assert.equal(spec.status, 403);
    const ok = await call('POST', `/api/rooms/${id}/actions`, { token: A, body: { type: 'vote', targetId: 'c2' } });
    assert.equal(ok.status, 200, ok.text);
    assert.deepEqual(ok.json.room.result.mvp.votes, { p1: 'c2' });
    assert.deepEqual(ok.json.events.map((e) => e.type), ['mvpVoted']);
    const close = await call('POST', `/admin/api/rooms/${id}/actions`, { cookie, body: { type: 'closeVote' } });
    assert.equal(close.status, 200, close.text);
    assert.equal(close.json.room.result.mvp.winner, 'c2');
    assert.ok(close.json.events.some((e) => e.type === 'mvpDecided' && e.charId === 'c2'));
    assert.equal((await call('POST', `/admin/api/rooms/${id}/actions`, { cookie, body: { type: 'closeVote' } })).status, 409);
  } finally {
    await srv.close();
    await tmp.cleanup();
  }
});

test('applyResult on a clone: status finished, the mvp window from `now`, treasures revealed from the hidden maps', () => {
  const room = structuredClone(started());
  room.characters[0].treasures = [{ uid: 'tr7', id: 'fake_painting' }];
  room.treasureValues = { tr7: 3 };
  room.treasureFakes = { tr7: true };
  const ranking = applyResult(room, 5000, { data });
  assert.equal(room.status, 'finished');
  assert.equal(room.result.mvp.closesAt, 5000 + data.balance.result.mvpVoteMs);
  assert.deepEqual(room.result.treasures, [{ charId: room.characters[0].id, uid: 'tr7', treasureId: 'fake_painting', value: 3, fake: true }]);
  assert.equal(ranking.find((r) => r.charId === room.characters[0].id).treasures, 3);
  // mid-game rankings (CPU heuristics) never count the hidden values
  assert.equal(computeRanking(room, { data }).find((r) => r.charId === room.characters[0].id).treasures, 0);
  const forced = endGame(started(), { now: 7 });
  assert.equal(forced.room.result.forced, true);
  assert.ok(forced.room.result.mvp);
});
