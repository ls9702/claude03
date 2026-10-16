// E2E round 4 fixes (engine side): side bets vs 택시 / 층간소음 second rolls (EV), 기초연금 vs family gifts, invisible
// names, 쿠지 / 로또 card use (cardLost 'used'), gameStarted.laps, 소원 counting, 생일 파티 답례, malformed boards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameData } from '../server/data/index.js';
import { applyAction, betWinDelta, startGame } from '../server/game/engine.js';
import { createTx } from '../server/game/effects.js';
import { addCharacter, joinRoom } from '../server/game/lobby.js';
import { applySpinMods, BET_VOID_MODS, betsVoided } from '../server/game/cards.js';
import { makeRoom, plainEra, toEra } from './helpers.js';

const data = gameData();
const cur = (room) => room.turn.order[room.turn.currentIndex];
const ch = (room, id) => room.characters.find((c) => c.id === id);
const expect = (fn, status, re) => assert.throws(fn, (e) => e.status === status && (!re || re.test(e.message)), `expected ${status}${re ? ` ${re}` : ''}`);

function started({ seed = 7, config = {}, owners = [['A', 'A1'], ['B', 'B1']] } = {}) {
  let room = makeRoom({ seed });
  room.config = { ...room.config, ...config };
  for (const s of new Set(owners.map(([o]) => o))) room = joinRoom(room, s, `p${s}`, 0).room;
  for (const [owner, name] of owners) room = addCharacter(room, owner, { name }, 0).room;
  const r = startGame(room, { now: 0 });
  assert.equal(r.ok, true, r.error);
  return r.room;
}

/** 청년 with a plain money ring, everyone employed and on the start tile, no era openings. */
function young(opts = {}) {
  const room = structuredClone(started(opts));
  toEra(room, 4);
  plainEra(room, 4);
  for (const c of room.characters) {
    Object.assign(c, { careerDone: true, examResult: 'college', military: { status: 'done', turnsLeft: 0 }, job: { id: 'civil_servant', rank: 1, exp: 0, injured: 0 }, stats: { int: 4, str: 4, charm: 4, luck: 4 }, money: 1000 });
  }
  room.erasOpened = room.board.eras.map((e) => e.id);
  return room;
}
let uidSeq = 900;
const give = (c, ...ids) => {
  for (const id of ids) c.cards.push({ uid: `k${++uidSeq}`, id });
  return c.cards.at(-1).uid;
};

// ---------- 1. side bets vs second rolls ----------

/** Exact distribution of the roulette value side bets settle on, given the pending mods (first × second roll). */
function valueDistribution(room, c, mods) {
  const dist = new Map();
  for (let first = 1; first <= 10; first++) {
    for (let second = 1; second <= 10; second++) {
      const clone = { ...c, spinMods: mods.map((m) => ({ ...m })), items: [] };
      const tx = createTx(room, { rng: { int: () => second, next: () => 0.5, pick: (a) => a[0], weighted: (a) => a[0], state: 1 }, now: 0, data });
      const { value } = applySpinMods(tx, clone, first);
      dist.set(value, (dist.get(value) ?? 0) + 1 / 100);
    }
  }
  return dist;
}

test('side bets: every pick has EV ≤ 0 in every spin-mod state (taxi / noise / roulette cards refuse bets)', () => {
  const states = {
    none: [],
    plus: [{ kind: 'plus', value: 2, card: 'energy' }],
    minus: [{ kind: 'minus', value: 3, card: 'cut_line', by: 'x' }],
    taxi: [{ kind: 'max2', card: 'taxi' }],
    noise: [{ kind: 'min2', card: 'noise', by: 'x' }],
    both: [{ kind: 'max2', card: 'taxi' }, { kind: 'min2', card: 'noise', by: 'x' }],
    big: [{ kind: 'range', min: 6, max: 10, card: 'big_roll' }],
    small: [{ kind: 'range', min: 1, max: 5, card: 'small_roll' }],
    exact: [{ kind: 'exact', value: 3, card: 'exact_roll' }],
    rush: [{ kind: 'rush', card: 'payday_rush' }],
    taxiPlus: [{ kind: 'max2', card: 'taxi' }, { kind: 'plus', value: 2, card: 'energy' }],
  };
  const bal = data.balance;
  const picks = [['oddEven', 'odd'], ['oddEven', 'even'], ...Object.keys(bal.bets.ranges).map((p) => ['range', p])];
  let allowedStates = 0;
  for (const [name, mods] of Object.entries(states)) {
    const room = young();
    const me = ch(room, cur(room));
    const other = room.characters.find((c) => c.id !== me.id);
    me.spinMods = mods.map((m) => ({ ...m }));
    const skewing = mods.some((m) => BET_VOID_MODS.includes(m.kind));
    assert.equal(betsVoided(me), skewing, name);
    if (skewing) {
      for (const [kind, pick] of picks) expect(() => applyAction(room, { type: 'bet', characterId: other.id, kind, pick, amount: 10 }, { now: 1 }), 409, /훈수 베팅을 할 수 없어요/);
      continue;
    }
    allowedStates++;
    applyAction(room, { type: 'bet', characterId: other.id, kind: 'oddEven', pick: 'odd', amount: 10 }, { now: 1 }); // accepted
    const dist = valueDistribution(room, me, mods);
    for (const [kind, pick] of picks) {
      for (let amount = bal.bets.minAmount; amount <= bal.bets.maxAmount; amount++) {
        const bet = { kind, pick, amount };
        const [lo, hi] = kind === 'range' ? bal.bets.ranges[pick] : [];
        let ev = 0;
        for (const [v, p] of dist) {
          const wins = kind === 'oddEven' ? (v % 2 === 1 ? 'odd' : 'even') === pick : v >= lo && v <= hi;
          ev += p * (wins ? betWinDelta(bet, bal) : -amount);
        }
        assert.ok(ev <= 1e-9, `${name} ${pick} ${amount}: EV ${ev}`);
      }
    }
  }
  assert.equal(allowedStates, 3, 'none / plus / minus keep bets');
});

test('side bets: a taxi played after bets voids them (stakes back); a pending 층간소음 refuses bets on the target', () => {
  let room = young();
  const me = ch(room, cur(room));
  const other = room.characters.find((c) => c.id !== me.id);
  const taxi = give(me, 'taxi');
  room = applyAction(room, { type: 'bet', characterId: other.id, kind: 'range', pick: '7-10', amount: 20 }, { now: 900 }).room;
  assert.equal(ch(room, other.id).money, 980);
  let r = applyAction(room, { type: 'useCard', characterId: me.id, cardUid: taxi }, { now: 1000 });
  assert.equal(ch(r.room, other.id).money, 1000, 'stake back');
  assert.ok(r.events.some((e) => e.type === 'moneyChanged' && e.reason === 'betRefund' && e.charId === other.id));
  assert.ok(r.events.some((e) => e.type === 'log' && /두 번 돌려서 이번 훈수 베팅은 무효/.test(e.text)));
  assert.equal(r.room.bets[r.room.turn.turnNo], undefined);
  expect(() => applyAction(r.room, { type: 'bet', characterId: other.id, kind: 'oddEven', pick: 'odd', amount: 10 }, { now: 1100 }), 409, /두 번 돌려서/);
  // 층간소음 on the other character: its next roulette refuses bets
  r = applyAction(r.room, { type: 'spin', characterId: me.id }, { now: 1200 });
  room = r.room;
  while (room.turn.pending) room = applyAction(room, { type: 'choose', characterId: room.turn.pending.charId, optionId: room.turn.pending.defaultOptionId }, { now: 1300 }).room;
  assert.equal(cur(room), other.id);
  ch(room, other.id).spinMods.push({ kind: 'min2', by: me.id, card: 'noise' });
  expect(() => applyAction(room, { type: 'bet', characterId: me.id, kind: 'range', pick: '1-3', amount: 20 }, { now: 1400 }), 409, /두 번 돌려서/);
});

// ---------- 6. 기초연금 by family ----------

test('기초연금: ranked by family-average assets — a family gift before the senior transition changes nothing', () => {
  const owners = [['A', 'a1'], ['A', 'a2'], ['B', 'b1'], ['C', 'c1']];
  const cfg = data.balance.pension;
  const run = (gift) => {
    const room = structuredClone(started({ owners }));
    const seniorIdx = room.board.eras.findIndex((e) => e.id === cfg.era);
    toEra(room, seniorIdx - 1);
    plainEra(room, seniorIdx - 1);
    for (const c of room.characters) Object.assign(c, { careerDone: true, military: { status: 'done', turnsLeft: 0 }, job: null, debt: 0 });
    const by = Object.fromEntries(room.characters.map((c) => [c.name, c]));
    Object.assign(by.a1, { money: 3500 });
    Object.assign(by.a2, { money: 3500 });
    Object.assign(by.b1, { money: 3000 });
    Object.assign(by.c1, { money: 3200 });
    room.turn.eraRound = room.turn.eraTurns;
    room.turn.currentIndex = room.turn.order.length - 1;
    let r = { room };
    if (gift) r = applyAction(room, { type: 'gift', characterId: by.a1.id, toId: by.a2.id, money: 3400 }, { now: 5 });
    r = applyAction(r.room, { type: 'spin', characterId: cur(r.room) }, { now: 6 });
    const events = [...r.events];
    // the move may open a prompt first (the fork's 갈림길): answer with defaults until the era turns over
    for (let i = 0; i < 10 && !events.some((e) => e.type === 'eraTransition') && r.room.turn.pending; i++) {
      const pend = r.room.turn.pending;
      r = applyAction(r.room, { type: 'choose', characterId: pend.charId, promptId: pend.promptId, optionId: pend.defaultOptionId }, { now: 7 + i });
      events.push(...r.events);
    }
    assert.ok(events.some((e) => e.type === 'eraTransition'));
    const paid = events.filter((e) => e.type === 'moneyChanged' && e.reason === 'pension').map((e) => [ch(r.room, e.charId).name, e.delta]);
    return { paid: Object.fromEntries(paid), recipients: r.room.pension.recipients.map((id) => ch(r.room, id).name).sort() };
  };
  const plain = run(false);
  const gifted = run(true);
  assert.deepEqual(plain.recipients, ['b1', 'c1'], 'the two poorest families (A averages 3500)');
  assert.deepEqual(gifted, plain, 'parking cash on a2 does not make a1 a recipient or raise any amount');
  assert.equal(plain.paid.b1, Math.min(cfg.max, Math.round((cfg.base + (3500 - 3000) * cfg.gapRatio) / 10) * 10), 'gap to the richest family average');
});

test('기초연금: CPUs are families of one; a player family averages its characters', async () => {
  const { pensionFamily, pensionRankWorth } = await import('../server/game/engine.js');
  const room = { characters: [
    { id: 'c1', ownerSessionId: 'A', money: 1000, debt: 0 },
    { id: 'c2', ownerSessionId: 'A', money: 3000, debt: 500 },
    { id: 'c3', ownerSessionId: 'cpu', money: 100, debt: 0 },
    { id: 'c4', ownerSessionId: 'cpu', money: 900, debt: 0 },
  ] };
  assert.notEqual(pensionFamily(room.characters[2]), pensionFamily(room.characters[3]));
  assert.equal(pensionFamily(room.characters[0]), pensionFamily(room.characters[1]));
  const w = pensionRankWorth(room, data);
  assert.deepEqual([...w.values()], [1750, 1750, 100, 900]);
});

// ---------- 7. invisible names ----------

test('names: only invisible marks / variation selectors / lone surrogates → refused; emoji with VS16 kept', async () => {
  const { cleanName } = await import('../server/game/lobby.js');
  for (const bad of ['️', '️️', '\u{E0100}', '͏', '឴', '឵', '᠋', '᠌', '᠍', '᠎', '᠏', 'ᅟ', 'ᅠ', 'ㅤ', 'ﾠ', '\uD800', '\uDC00', ' ️ ', '́', '​️', 'ㅤ͏']) {
    assert.equal(cleanName(bad), null, JSON.stringify(bad));
  }
  assert.equal(cleanName('❤️'), '❤️');
  assert.equal(cleanName('❤️호야'), '❤️호야');
  assert.equal(cleanName('1️⃣'), '1️⃣');
  assert.equal(cleanName('👨‍👩‍👧'), '👨‍👩‍👧');
  assert.equal(cleanName('️민수'), '민수', 'a leading selector is dropped');
  assert.equal(cleanName('가͏나'), '가나');
  assert.equal(cleanName('a\uD800b'), 'ab', 'lone surrogates dropped');
  // the lobby refuses them like an empty name
  let room = makeRoom();
  const r = joinRoom(room, 'S', '️឵', 0);
  assert.equal(r.ok, false);
  room = joinRoom(room, 'S', '뚱이', 0).room;
  assert.equal(addCharacter(room, 'S', { name: '᠋͏' }, 0).ok, false);
});

// ---------- 10. lotto / 쿠지 ticket use; gameStarted.laps ----------

test('로또 / 쿠지: each used ticket emits cardLost {reason: used} right after the draw (chip, no line)', async () => {
  const { lottoDraw } = await import('../server/game/holidays.js');
  const { decorateEvents } = await import('../server/game/presentation.js');
  const { dataForWorld } = await import('../server/game/world.js');
  for (const world of ['real', 'chiikawa']) {
    const wd = dataForWorld(world, data);
    const room = young();
    room.config.world = world;
    const [a, b] = room.characters;
    a.cards = [{ uid: 'k1', id: 'lotto' }, { uid: 'k2', id: 'lotto' }];
    b.cards = [{ uid: 'k3', id: 'taxi' }];
    const tx = createTx(room, { rng: { int: (lo) => lo, next: () => 0.99, pick: (x) => x[0], weighted: (x) => x[0], state: 1 }, now: 0, data: wd });
    lottoDraw(tx, 'young');
    const draw = tx.events.findIndex((e) => e.type === 'lottoDraw');
    const lost = tx.events.filter((e) => e.type === 'cardLost');
    assert.equal(draw, 0, world);
    assert.deepEqual(lost.map((e) => [e.charId, e.cardId, e.uid, e.reason]), [[a.id, 'lotto', 'k1', 'used']], world);
    assert.equal(tx.events.indexOf(lost[0]), 1, 'right after the draw');
    assert.deepEqual(a.cards.map((k) => k.uid), ['k2'], 'one ticket per draw');
    decorateEvents(tx.events, { room, data: wd, seed: 1 });
    assert.equal(lost[0].line, null);
    assert.equal(lost[0].cutin, false);
  }
});

test('gameStarted: turns null and laps = the race length for the final era (no nulls in laps)', () => {
  let room = makeRoom();
  room = joinRoom(room, 'A', 'a', 0).room;
  room = addCharacter(room, 'A', { name: 'x' }, 0).room;
  room = addCharacter(room, 'A', { name: 'y' }, 0).room;
  const r = startGame(room, { now: 0 });
  const g = r.events.find((e) => e.type === 'gameStarted');
  const fin = r.room.board.eras.at(-1);
  assert.equal(fin.final, true);
  assert.equal(g.turns.at(-1), null);
  assert.equal(g.laps.at(-1), fin.length);
  assert.ok(g.laps.every((n) => Number.isInteger(n) && n > 0), g.laps.join());
  assert.equal(typeof r.room.boardKey, 'string', 'the engine keys every board it builds (SSE board cache)');
});

// ---------- B8. 생일 파티 답례 ----------

test('생일 파티: each giver may get the 답례 stat (balance.groupGift.thanks); the gift option names it', async () => {
  const { openPrompt } = await import('../server/game/prompts.js');
  const { resolvePrompt } = await import('../server/game/spaces.js');
  const thanks = data.balance.groupGift.thanks;
  assert.deepEqual(thanks, { stat: 'charm', gain: 1, chance: 0.5 });
  const room = young({ owners: [['A', 'a1'], ['B', 'b1'], ['C', 'c1']] });
  const [host, g1, g2] = room.characters;
  for (const x of [g1, g2]) x.stats.charm = 4;
  const nexts = [0.2, 0.9]; // g1 lucky, g2 not
  const tx = createTx(room, { rng: { next: () => nexts.shift() ?? 0.99, int: (a) => a, pick: (x) => x[0], weighted: (x) => x[0], state: 1 }, now: 0, data });
  const p = openPrompt(tx, 'groupGift', host, { event: { text: '{name}의 생일!', gift: 10 } });
  const gift = p.options.find((o) => o.id === 'gift');
  assert.deepEqual([gift.price, gift.thanks], [10, thanks]);
  assert.match(gift.desc, /답례로 매력 \+1 \(50%\)/);
  p.answers = { [g1.id]: 'gift', [g2.id]: 'gift' };
  room.turn.pending = p;
  resolvePrompt(tx);
  assert.deepEqual([g1.stats.charm, g2.stats.charm], [5, 4]);
  assert.deepEqual([g1.money, g2.money, host.money], [990, 990, 1020]);
  const st = tx.events.filter((e) => e.type === 'statChanged');
  assert.deepEqual(st.map((e) => [e.charId, e.stat, e.delta, e.reason]), [[g1.id, 'charm', 1, 'thanks']]);
});

// ---------- B9. 찬스 광장 wish prize per era ----------

test('찬스 광장: wish.moneyByEra raises the prize in the kids eras only', async () => {
  const { passTileSpec } = await import('../server/game/passTile.js');
  const cfg = data.balance.passTile;
  assert.deepEqual(cfg.wish.moneyByEra, { baby: 35, elem: 35, middle: 35, high: 35 });
  const room = young();
  const c = room.characters[0];
  const tx = createTx(room, { rng: { next: () => 0.5, int: (a) => a, pick: (x) => x[0], weighted: (x) => x[0], state: 1 }, now: 0, data });
  const round5 = (x) => Math.round(x / 5) * 5;
  for (const [era, base] of [['elem', 35], ['high', 35], ['young', 25], ['middle_age', 25]]) {
    c.era = era;
    const wish = passTileSpec(tx, c).options.find((o) => o.id === 'wish');
    assert.equal(wish.money, round5(base * cfg.scale[era]), era);
  }
});
