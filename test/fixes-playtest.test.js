// Post-simulation fix batch (server side): held side-bet stakes, finished characters out of gifts / bets / birthday
// parties, engine action lookup, invisible / bidi characters in names, Korean particles, line repetition, pension by
// assets, per-era route pools, free habits for broke kids, room TTL + admin expiry, trust proxy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { gameData } from '../server/data/index.js';
import { applyAction, endGame, pensionWorth, startGame } from '../server/game/engine.js';
import { NAME_MAX, addCharacter, addCpuCharacter, cleanName, joinRoom } from '../server/game/lobby.js';
import { createTx } from '../server/game/effects.js';
import { fixParticle, josa, particle } from '../server/game/korean.js';
import { LINE_HISTORY, decorateEvents, fillLine, pickLine } from '../server/game/presentation.js';
import { PROMPTS, openPrompt } from '../server/game/prompts.js';
import { buildBoard, routePool } from '../server/game/board.js';
import { createRng } from '../server/game/rng.js';
import { viewFor } from '../server/game/view.js';
import { parseTrustProxy } from '../server/config.js';
import { RoomStore } from '../server/store/roomStore.js';
import { GameRunner } from '../server/store/gameRunner.js';
import { startServer } from '../server/index.js';
import { httpCall, makeRoom, tempDir } from './helpers.js';

const data = gameData();

function lobby({ chars = [['A', 'A1'], ['B', 'B1'], ['A', 'A2']], config = {}, seed = 7 } = {}) {
  let room = makeRoom({ seed });
  room.config = { ...room.config, ...config };
  room = joinRoom(room, 'A', '에이', 0).room;
  room = joinRoom(room, 'B', '비', 0).room;
  for (const [owner, name] of chars) room = addCharacter(room, owner, { name }, 0).room;
  return room;
}
function started(opts = {}) {
  const r = startGame(lobby(opts), { now: 0 });
  assert.equal(r.ok, true, r.error);
  return r.room;
}
function fixedRng(ints = []) {
  const q = [...ints];
  return { next: () => 0.5, int: (a) => (q.length ? q.shift() : a), pick: (arr) => arr[0], weighted: (items) => items[0], get state() { return 99; } };
}
const act = (room, action, ints = [], now = 1000) => applyAction(room, action, { rng: fixedRng(ints), now });
const ch = (room, id) => room.characters.find((c) => c.id === id);
const cur = (room) => room.turn.order[room.turn.currentIndex];

/** A room whose current character belongs to A, plus B's character as the bettor. */
function betRoom() {
  let room = started();
  while (ch(room, cur(room)).ownerSessionId !== 'A') room = act(room, { type: 'skip', actor: { admin: true } }).room;
  const bettor = room.characters.find((c) => c.ownerSessionId === 'B').id;
  return { room, bettor };
}

// ---------- A11: side-bet stakes are held ----------

test('bets: the stake is held at bet time; a lost bet never becomes debt even after the cash is gone', () => {
  const { room: r0, bettor } = betRoom();
  const money0 = ch(r0, bettor).money;
  const bet = act(r0, { type: 'bet', characterId: bettor, kind: 'oddEven', pick: 'even', amount: 20, actor: { sessionId: 'B' } });
  const stake = bet.events.find((e) => e.type === 'moneyChanged');
  assert.deepEqual([stake.charId, stake.delta, stake.reason, stake.line], [bettor, -20, 'betStake', null]);
  assert.equal(ch(bet.room, bettor).money, money0 - 20);
  assert.equal(bet.room.bets[bet.room.turn.turnNo][bettor].staked, true);
  // the bettor gives away every won it still has, then loses the bet (roulette 1 = odd)
  const rest = ch(bet.room, bettor).money;
  const target = bet.room.characters.find((c) => c.id !== bettor).id;
  const gave = act(bet.room, { type: 'gift', characterId: bettor, toId: target, money: rest, actor: { sessionId: 'B' } });
  assert.equal(ch(gave.room, bettor).money, 0);
  const spun = act(gave.room, { type: 'spin', characterId: cur(gave.room) }, [1]);
  const res = spun.events.find((e) => e.type === 'betResolved').results[0];
  assert.deepEqual([res.won, res.delta, res.stake, res.paid], [false, -20, 20, 0], 'delta = net result as before');
  assert.equal(ch(spun.room, bettor).debt, 0, 'no debt from a lost bet');
  assert.ok(!spun.events.some((e) => e.type === 'moneyChanged' && e.charId === bettor && e.reason === 'bet'), 'nothing paid on a loss');
});

test('bets: a win pays stake × payout (net delta unchanged); replacing a bet moves only the difference; finished → 409', () => {
  const { room: r0, bettor } = betRoom();
  const money0 = ch(r0, bettor).money;
  const b1 = act(r0, { type: 'bet', characterId: bettor, kind: 'oddEven', pick: 'odd', amount: 10, actor: { sessionId: 'B' } });
  const b2 = act(b1.room, { type: 'bet', characterId: bettor, kind: 'range', pick: '1-3', amount: 15, actor: { sessionId: 'B' } });
  const mc = b2.events.filter((e) => e.type === 'moneyChanged');
  assert.deepEqual(mc.map((e) => [e.delta, e.reason]), [[-5, 'betStake']], 'only the extra 5 is held');
  assert.equal(ch(b2.room, bettor).money, money0 - 15);
  const spun = act(b2.room, { type: 'spin', characterId: cur(b2.room) }, [2]);
  const res = spun.events.find((e) => e.type === 'betResolved').results[0];
  const payout = data.balance.bets.payouts['1-3'];
  assert.equal(res.delta, Math.floor(15 * (payout - 1)));
  assert.equal(res.paid, 15 + res.delta);
  assert.equal(ch(spun.room, bettor).money, money0 + res.delta, 'net = winnings');
  // finished characters cannot bet
  const { room: r3, bettor: b } = betRoom();
  ch(r3, b).finished = true;
  assert.throws(() => act(r3, { type: 'bet', characterId: b, kind: 'oddEven', pick: 'odd', amount: 10, actor: { sessionId: 'B' } }), { status: 409, message: /골인/ });
  // cannot hold more than the cash (replacement counts the held stake)
  const { room: r4, bettor: b4 } = betRoom();
  ch(r4, b4).money = 12;
  const h = act(r4, { type: 'bet', characterId: b4, kind: 'oddEven', pick: 'odd', amount: 12, actor: { sessionId: 'B' } });
  assert.equal(ch(h.room, b4).money, 0);
  assert.throws(() => act(h.room, { type: 'bet', characterId: b4, kind: 'oddEven', pick: 'odd', amount: 13, actor: { sessionId: 'B' } }), { status: 409 });
  assert.equal(ch(act(h.room, { type: 'bet', characterId: b4, kind: 'oddEven', pick: 'even', amount: 5, actor: { sessionId: 'B' } }).room, b4).money, 7);
});

test('bets: skipped turns and a forced game end give the held stake back', () => {
  const { room: r0, bettor } = betRoom();
  const money0 = ch(r0, bettor).money;
  const bet = act(r0, { type: 'bet', characterId: bettor, kind: 'oddEven', pick: 'odd', amount: 20, actor: { sessionId: 'B' } });
  const skip = act(bet.room, { type: 'skip', actor: { admin: true } });
  const refund = skip.events.find((e) => e.type === 'moneyChanged' && e.reason === 'betRefund');
  assert.deepEqual([refund.charId, refund.delta], [bettor, 20]);
  assert.equal(ch(skip.room, bettor).money, money0);
  let r2 = skip.room;
  while (ch(r2, cur(r2)).ownerSessionId !== 'A') r2 = act(r2, { type: 'skip', actor: { admin: true } }).room;
  const bet2 = act(r2, { type: 'bet', characterId: bettor, kind: 'oddEven', pick: 'odd', amount: 15, actor: { sessionId: 'B' } });
  assert.equal(ch(bet2.room, bettor).money, money0 - 15);
  const ended = endGame(bet2.room, { now: 5 });
  assert.equal(ended.ok, true);
  assert.equal(ch(ended.room, bettor).money, ch(bet2.room, bettor).money + 15, 'force end refunds');
});

// ---------- A12 / A13: finished characters ----------

test('gifts: finished characters can neither send nor receive (409)', () => {
  const room = started();
  const [a, b] = room.characters;
  const act2 = (r, from, to) => act(r, { type: 'gift', characterId: from.id, toId: to.id, money: 5 });
  const r1 = structuredClone(room);
  ch(r1, b.id).finished = true;
  assert.throws(() => act2(r1, a, b), { status: 409, message: /골인/ });
  assert.throws(() => act2(r1, ch(r1, b.id), a), { status: 409, message: /골인/ });
  assert.equal(act2(room, a, b).room.characters.find((c) => c.id === b.id).money, b.money + 5);
});

test('birthday party (groupGift): finished characters are not invited; nobody left → no prompt, no wait', () => {
  const room = started({ chars: [['A', 'A1'], ['B', 'B1'], ['A', 'A2'], ['B', 'B2']] });
  const host = ch(room, cur(room));
  const others = room.characters.filter((c) => c.id !== host.id);
  others[0].finished = true;
  const tx = createTx(structuredClone(room), { rng: fixedRng(), now: 0, data });
  const p = openPrompt(tx, 'groupGift', ch(tx.room, host.id), { event: { text: '{name}의 생일!', gift: 10 } });
  assert.deepEqual(p.forCharacterIds.sort(), others.slice(1).map((c) => c.id).sort());
  // everyone else finished: the event tile resolves at once (no prompt)
  const r2 = structuredClone(room);
  for (const c of r2.characters) if (c.id !== host.id) c.finished = true;
  const party = { id: 'party_only', text: '{name}의 생일 파티!', kind: 'groupGift', gift: 10, weight: 1, tone: 'good', emotion: 'joy' };
  const only = { ...data, events: { ...data.events, events: [party] } };
  const pos = r2.board.eras.findIndex((e) => !e.routes);
  r2.board.eras[pos].tiles[0] = { id: r2.board.eras[pos].tiles[0].id, type: 'event', label: 'x', icon: '' };
  Object.assign(ch(r2, host.id), { position: { eraIndex: pos, route: 'main', index: -1 }, era: r2.board.eras[pos].id });
  const res = applyAction(r2, { type: 'spin', characterId: host.id }, { rng: fixedRng([1]), now: 1, data: only });
  assert.ok(!res.events.some((e) => e.type === 'prompt' && e.kind === 'groupGift'), 'no party prompt');
  assert.equal(res.room.turn.pending, null);
  assert.ok(res.events.some((e) => e.type === 'log' && /생일/.test(e.text)));
});

// ---------- A17: action lookup ----------

test('engine: Object.prototype names and non-string types are unknown actions (400)', () => {
  const room = started();
  for (const type of ['toString', '__proto__', 'constructor', 'hasOwnProperty', 'valueOf']) {
    assert.throws(() => applyAction(room, { type }), { status: 400 }, type);
  }
  for (const type of [1, null, undefined, {}, ['spin']]) assert.throws(() => applyAction(room, { type }), { status: 400 });
  assert.equal(Object.getPrototypeOf(PROMPTS), null);
});

// ---------- A10: names ----------

test('names: invisible / bidi controls are stripped, blank results refused, length counted in graphemes', () => {
  assert.equal(cleanName('‮악당‬'), '악당');
  assert.equal(cleanName('a​b‌‎⁦c⁩﻿'), 'abc');
  for (const blank of ['​​', 'ㅤ', 'ᅟᅠ', ' ⠀ ', '‮', '\u0000\u0007']) assert.equal(cleanName(blank), null, JSON.stringify(blank));
  assert.equal(cleanName('👨‍👩‍👧 가족'), '👨‍👩‍👧 가족', 'a ZWJ inside an emoji sequence survives');
  assert.equal(cleanName('🏳️‍🌈'), '🏳️‍🌈');
  assert.equal(cleanName('😀'.repeat(NAME_MAX)), '😀'.repeat(NAME_MAX), 'emoji count as one each');
  assert.equal(cleanName('😀'.repeat(NAME_MAX + 1)), null);
  assert.equal(cleanName('👨‍👩‍👧'.repeat(4)), '👨‍👩‍👧'.repeat(4), '4 graphemes');
  assert.equal(cleanName('가'.repeat(NAME_MAX + 1)), null);
  assert.equal(cleanName(`a${'́'.repeat(80)}`), null, 'zalgo: one grapheme but too long');
  // every entry point uses it (players, characters, CPU names)
  let room = makeRoom();
  const j = joinRoom(room, 'S', '‮관리자', 0);
  assert.equal(j.room.players[0].name, '관리자');
  assert.equal(joinRoom(room, 'T', '​', 0).status, 400);
  room = j.room;
  assert.equal(addCharacter(room, 'S', { name: '⁧뚱이' }, 0).character.name, '뚱이');
  assert.equal(addCharacter(room, 'S', { name: '﻿' }, 0).status, 400);
  const cpu = addCpuCharacter({ ...room, config: { ...room.config, allowCpu: true } }, { name: '로봇‍​' }, 0);
  assert.equal(cpu.room.characters.at(-1).name, '로봇');
});

// ---------- A16: Korean particles ----------

test('josa: shared particle helper; lines fix the particle after a placeholder; lobby / shop logs', () => {
  assert.equal(josa('뚱이', '이/가'), '뚱이가');
  assert.equal(josa('철수', '을/를'), '철수를');
  assert.equal(josa('서울', '으로/로'), '서울로');
  assert.equal(particle('집', '으로/로'), '으로');
  assert.equal(particle('Tom', '이/가'), '이(가)');
  assert.equal(`뚱이${fixParticle('뚱이', '이 왔다')}`, '뚱이가 왔다');
  assert.equal(`뚱이${fixParticle('뚱이', '이다멍!')}`, '뚱이다멍!');
  assert.equal(`철수${fixParticle('철수', '이라니!')}`, '철수라니!');
  assert.equal(`청년${fixParticle('청년', '는 처음')}`, '청년은 처음');
  assert.equal(`300만원${fixParticle('300만원', '을 벌었')}`, '300만원을 벌었');
  assert.equal(`3만원${fixParticle('3만원', '를 잃')}`, '3만원을 잃');
  assert.equal(`뚱이${fixParticle('뚱이', '가게')}`, '뚱이가게', 'not a particle');
  assert.equal(fillLine('1등은 {name}이다!', { name: '뚱이' }), '1등은 뚱이다!');
  assert.equal(fillLine('{stat}이 올랐어', { stat: '매력' }), '매력이 올랐어');
  assert.equal(fillLine('{name}이 {unknown}', { name: '뚱이' }), '뚱이가 {unknown}');
  // server text no longer writes 이(가) / 을(를) after a name
  for (const f of ['server/game/cards.js', 'server/game/lobby.js', 'server/game/engine.js', 'server/game/spaces.js', 'server/game/family.js']) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!/\$\{[^}]+\}(이\(가\)|을\(를\)|은\(는\)|와\(과\)|\(으\)로)/.test(src), f);
  }
  let room = makeRoom();
  room = joinRoom(room, 'S', '호야', 0).room;
  const made = addCharacter(room, 'S', { name: '뚱이' }, 0);
  assert.match(made.logs[0].text, /「뚱이」를 만들었습니다/);
  const renamed = joinRoom(made.room, 'S', '서울', 0);
  assert.match(renamed.logs[0].text, /서울로 바꿨습니다/);
});

test('spelling: 프러포즈 everywhere in server data / code', () => {
  for (const dir of ['server/data', 'server/game']) {
    for (const f of readdirSync(dir)) {
      if (!/\.(json|js)$/.test(f)) continue;
      assert.ok(!readFileSync(path.join(dir, f), 'utf8').includes('프로포즈'), `${dir}/${f}`);
    }
  }
});

// ---------- dialogue repetition ----------

test('lines: a room never repeats a line within its recent picks; bland events stay quiet; history is server-only', () => {
  const pool = data.lines.tags.neutral;
  const history = [];
  const picks = Array.from({ length: pool.length * 3 }, (_, i) => pickLine(data.lines, 'neutral', 1234, {}, history));
  for (let i = 0; i + pool.length <= picks.length; i++) {
    assert.equal(new Set(picks.slice(i, i + pool.length)).size, pool.length, `window ${i}`);
  }
  assert.ok(history.length <= LINE_HISTORY);
  const big = Object.entries(data.lines.tags).find(([, v]) => v.length >= 8)[0];
  const h2 = [];
  const first = Array.from({ length: 8 }, () => pickLine(data.lines, big, 7, { name: '가' }, h2));
  assert.equal(new Set(first).size, 8, 'the same seed still gives fresh lines');

  // a whole game: turn / spin / move / log events never speak; room.lineHistory never reaches clients
  let room = started();
  const seenLine = new Map();
  for (let i = 0; i < 400 && room.status === 'playing'; i++) {
    const a = room.turn.pending ? { type: 'timeout', force: true } : { type: 'spin', characterId: cur(room) };
    const r = applyAction(room, a, { now: 1000 + i });
    room = r.room;
    room.log = [];
    for (const e of r.events) {
      if (['turnStarted', 'spun', 'moved', 'log'].includes(e.type)) assert.equal(e.line, null, e.type);
      if (e.line) seenLine.set(e.line, (seenLine.get(e.line) ?? 0) + 1);
    }
  }
  assert.ok(Array.isArray(room.lineHistory) && room.lineHistory.length <= LINE_HISTORY);
  const v = viewFor(room, 'A');
  assert.equal(v.lineHistory, undefined);
  assert.ok(!JSON.stringify(v).includes('"lineHistory"'));
  const worst = Math.max(...seenLine.values());
  assert.ok(worst <= 12, `most repeated line appeared ${worst} times`);
});

test('decorateEvents: a small money follow-up is quiet; a plain money landing speaks only rarely', () => {
  const room = started();
  const c = room.characters[0];
  let spoken = 0;
  for (let s = 0; s < 200; s++) {
    const evs = [
      { type: 'landed', charId: c.id, tileId: 'x', tileType: 'money', route: null },
      { type: 'moneyChanged', charId: c.id, delta: 20, reason: 'tile', money: 100, debt: 0 },
    ];
    decorateEvents(evs, { room, data, seed: s });
    assert.equal(evs[1].line, null);
    if (evs[0].line) spoken++;
  }
  assert.ok(spoken > 20 && spoken < 90, `${spoken}/200 plain money landings spoke`);
  const big = [{ type: 'moneyChanged', charId: c.id, delta: 500, reason: 'tile', money: 600, debt: 0 }];
  decorateEvents(big, { room, data, seed: 1 });
  assert.ok(big[0].line);
});

// ---------- B2 / B4 / kids habits ----------

test('pension: recipients and the gap use total assets (cash − debt + house + items), not cash', () => {
  let room = started({ chars: [['A', 'A1'], ['B', 'B1'], ['A', 'A2'], ['B', 'B2']] });
  const cfg = data.balance.pension;
  const seniorIdx = room.board.eras.findIndex((e) => e.id === cfg.era);
  const [rich, poorA, poorB, mid] = room.turn.order;
  Object.assign(ch(room, rich), { money: 0, house: { id: 'penthouse', price: 3000, value: 3150, boughtTurn: 1 } });
  ch(room, poorA).money = 100;
  ch(room, poorB).money = 200;
  ch(room, mid).money = 1500;
  assert.equal(pensionWorth(ch(room, rich), data), 3150);
  ch(room, rich).position = { eraIndex: seniorIdx - 1, route: 'main', index: 1 };
  room.turn.currentIndex = room.turn.order.indexOf(rich);
  const r = act(room, { type: 'spin', characterId: rich }, [1]);
  assert.deepEqual([...r.room.pension.recipients].sort(), [poorA, poorB].sort(), 'the cash-poor house owner is not a recipient');
  assert.ok(!r.events.some((e) => e.type === 'moneyChanged' && e.reason === 'pension' && e.charId === rich));
});

test('board: per-era route pool overrides (young career money tiles) only touch that era', () => {
  const bd = data.board;
  const young = routePool(bd, 'career', 'young');
  const mid = routePool(bd, 'career', 'middle_age');
  const ov = bd.routePools.career.eraOverrides?.young?.money;
  assert.ok(ov, 'board.json routePools.career.eraOverrides.young.money');
  assert.deepEqual(routePool(bd, 'career', 'no_such_era'), bd.routePools.career.pool);
  const m = young.find((e) => e.type === 'money');
  assert.deepEqual([m.weight, m.scale], [ov.weight ?? m.weight, ov.scale ?? m.scale]);
  const base = bd.routePools.career.pool.find((e) => e.type === 'money');
  assert.deepEqual(mid.find((e) => e.type === 'money'), base, 'middle_age keeps the base money tiles');
  // every override names a real era and a pool entry
  for (const [route, rp] of Object.entries(bd.routePools)) {
    for (const [era, types] of Object.entries(rp.eraOverrides ?? {})) {
      if (era.startsWith('_')) continue;
      assert.ok(bd.routeEras.includes(era), `${route}.${era}`);
      for (const t of Object.keys(types)) assert.ok(rp.pool.some((e) => e.type === t), `${route}.${era}.${t}`);
    }
  }
  // built boards: over many seeds the young career route has more money tiles than middle_age
  let y = 0;
  let a = 0;
  for (let s = 0; s < 40; s++) {
    const board = buildBoard({ mode: 'lifetime', eraTurns: { young: 15, middle_age: 15 } }, createRng(s), data);
    const count = (id) => board.eras.find((e) => e.id === id).routes.career.tiles.filter((t) => t.type === 'money').length;
    y += count('young');
    a += count('middle_age');
  }
  assert.ok(y > a * 1.3, `young ${y} vs middle_age ${a}`);
});

test('habits: a broke kid never goes into debt (fees capped at cash → 무료), 뽑기 losses capped too', () => {
  const room = started({ config: { startingMoney: 0 } });
  const c = ch(room, cur(room));
  const tx = createTx(structuredClone(room), { rng: fixedRng(), now: 0, data });
  const kid = ch(tx.room, c.id);
  kid.money = 0;
  const p = openPrompt(tx, 'habit', kid);
  const paid = p.options.filter((o) => data.balance.habits.options.find((h) => h.id === o.id)?.cost);
  assert.ok(paid.length && paid.every((o) => o.cost === 0 && o.desc.includes('무료')), JSON.stringify(paid.map((o) => o.desc)));
  for (const opt of data.balance.habits.options) {
    const t = createTx(structuredClone(tx.room), { rng: { next: () => 0.9, int: (a) => a, pick: (x) => x[0], weighted: (x) => x[0], state: 1 }, now: 0, data });
    t.room.turn.pending.answers[kid.id] = opt.id;
    PROMPTS.habit.resolve(t, t.room.turn.pending);
    const k = ch(t.room, kid.id);
    assert.deepEqual([k.money, k.debt], [0, 0], opt.id);
  }
});

// ---------- ops: room TTL, trust proxy ----------

test('room TTL: finished rooms (3 days) and idle lobbies (7 days) are pruned with their save file; playing rooms stay', async () => {
  const tmp = await tempDir();
  try {
    let now = 1_000_000;
    const DAY = 24 * 60 * 60 * 1000;
    const store = new RoomStore({ dataDir: tmp.dir, debounceMs: 1, clock: () => now });
    await store.load();
    const runner = new GameRunner(store, { clock: () => now });
    const fin = store.createRoom(validateConfig(), now);
    const lob = store.createRoom(validateConfig(), now);
    const play = store.createRoom(validateConfig(), now);
    store.put({ ...fin, status: 'finished', finishedAt: now });
    store.put({ ...play, status: 'playing' });
    await store.flush();
    assert.equal(store.roomExpiresAt(store.getRoom(fin.id)), now + 3 * DAY);
    assert.equal(store.roomExpiresAt(store.getRoom(lob.id)), now + 7 * DAY);
    assert.equal(store.roomExpiresAt(store.getRoom(play.id)), null);
    const deleted = [];
    store.onRoomDeleted((id) => deleted.push(id));
    now += 3 * DAY - 1;
    assert.equal((await store.pruneAll()).rooms, 0);
    now += 2;
    assert.equal((await store.pruneAll()).rooms, 1);
    assert.deepEqual(deleted, [fin.id]);
    await assert.rejects(access(path.join(tmp.dir, 'saves', `${fin.id}.json`)));
    now += 4 * DAY;
    assert.equal((await store.pruneRooms()), 1);
    assert.equal(store.getRoom(lob.id), null);
    assert.ok(store.getRoom(play.id), 'playing rooms never expire');
    await access(path.join(tmp.dir, 'saves', `${play.id}.json`));
    runner.stop();
    await store.close();
    // boot: an expired save file is dropped at load; TTL 0 = keep forever
    const s2 = new RoomStore({ dataDir: tmp.dir, clock: () => now, finishedRoomTtlMs: 0 });
    await s2.load();
    assert.ok(s2.getRoom(play.id));
    assert.equal(s2.roomExpiresAt({ status: 'finished', finishedAt: 0 }), null);
    await s2.close();
    const saved = JSON.parse(await readFile(path.join(tmp.dir, 'saves', `${play.id}.json`), 'utf8'));
    assert.equal(saved.status, 'playing');
  } finally {
    await tmp.cleanup();
  }
});

function validateConfig() {
  return { ...makeRoom().config };
}

test('admin room list carries expiresAt; TRUST_PROXY parsing; trust proxy uses X-Forwarded-For for the login lock', async () => {
  assert.equal(parseTrustProxy(undefined), false);
  assert.equal(parseTrustProxy(''), false);
  assert.equal(parseTrustProxy('off'), false);
  assert.equal(parseTrustProxy('1'), 1);
  assert.equal(parseTrustProxy('true'), true);
  assert.equal(parseTrustProxy('loopback, 10.0.0.0/8'), 'loopback, 10.0.0.0/8');
  const tmp = await tempDir();
  const login = (srv, ip) =>
    fetch(`${srv.url}/admin/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ password: 'wrong' }) }).then((r) => r.status);
  try {
    const rate = { login: { windowMs: 60_000, max: 2 } };
    // off (default): X-Forwarded-For is ignored → everyone behind the socket address shares one bucket
    let srv = await startServer({ port: 0, host: '127.0.0.1', dataDir: path.join(tmp.dir, 'a'), adminPassword: 'pw', rate, debounceMs: 5 });
    assert.deepEqual([await login(srv, '1.1.1.1'), await login(srv, '2.2.2.2'), await login(srv, '3.3.3.3')], [401, 401, 429]);
    const ok = await httpCall(srv.url, 'POST', '/admin/api/login', { body: { password: 'pw' } });
    assert.equal(ok.status, 429, 'the socket IP is locked');
    await srv.close();
    // trust proxy: each forwarded client has its own bucket
    srv = await startServer({ port: 0, host: '127.0.0.1', dataDir: path.join(tmp.dir, 'b'), adminPassword: 'pw', rate, trustProxy: 'loopback', debounceMs: 5 });
    assert.deepEqual([await login(srv, '1.1.1.1'), await login(srv, '1.1.1.1'), await login(srv, '1.1.1.1'), await login(srv, '2.2.2.2')], [401, 401, 429, 401]);
    const res = await fetch(`${srv.url}/admin/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '9.9.9.9' }, body: JSON.stringify({ password: 'pw' }) });
    const cookie = res.headers.get('set-cookie')?.split(';')[0];
    const room = await httpCall(srv.url, 'POST', '/admin/api/rooms', { body: {}, cookie });
    assert.equal(room.status, 201);
    const list = await httpCall(srv.url, 'GET', '/admin/api/rooms', { cookie });
    const row = list.json.rooms.find((r) => r.id === room.json.room.id);
    assert.equal(typeof row.expiresAt, 'number', 'lobby rooms expire when idle');
    const detail = await httpCall(srv.url, 'GET', `/admin/api/rooms/${row.id}`, { cookie });
    assert.equal(detail.json.room.expiresAt, row.expiresAt);
    await srv.close();
  } finally {
    await tmp.cleanup();
  }
});
