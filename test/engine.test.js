import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameData } from '../server/data/index.js';
import { applyAction, betWins, startGame } from '../server/game/engine.js';
import { addCharacter, joinRoom } from '../server/game/lobby.js';
import { viewFor } from '../server/game/view.js';
import { makeRoom } from './helpers.js';

/** Started game. chars: [[ownerSession, name], ...] (sessions 'A', 'B'). */
function started({ mode = 'lifetime', eraTurns = {}, chars = [['A', 'A1'], ['B', 'B1']], startingMoney = 1000, seed = 7 } = {}) {
  let room = makeRoom({ seed });
  room.config = { ...room.config, mode, eraTurns: { ...room.config.eraTurns, ...eraTurns }, startingMoney };
  room = joinRoom(room, 'A', '에이', 0).room;
  room = joinRoom(room, 'B', '비', 0).room;
  for (const [owner, name] of chars) room = addCharacter(room, owner, { name }, 0).room;
  const r = startGame(room, { now: 0 });
  assert.equal(r.ok, true, r.error);
  return r.room;
}

/** RNG stub: int() returns queued values (then min); pick/weighted take the first item. */
function fixedRng(values) {
  const q = [...values];
  return {
    next: () => 0,
    int: (a) => (q.length ? q.shift() : a),
    pick: (arr) => arr[0],
    weighted: (items) => items[0],
    get state() {
      return 4242;
    },
  };
}

const act = (room, action, values = [], extra = {}) => applyAction(room, action, { rng: fixedRng(values), now: 1000, ...extra });
const cur = (room) => room.turn.order[room.turn.currentIndex];
const ch = (room, id) => room.characters.find((c) => c.id === id);
const types = (events) => events.map((e) => e.type);
function setTile(room, eraIndex, index, tile, route = 'main') {
  const era = room.board.eras[eraIndex];
  const track = route === 'main' ? era.tiles : era.routes[route].tiles;
  track[index] = { id: track[index].id, label: 'test', ...tile };
}

test('startGame initializes board, characters and turn; input untouched', () => {
  let lobby = makeRoom();
  lobby = joinRoom(lobby, 'A', '에이', 0).room;
  lobby = addCharacter(lobby, 'A', { name: 'A1' }, 0).room;
  lobby = addCharacter(lobby, 'A', { name: 'A2' }, 0).room;
  const before = structuredClone(lobby);
  const r = startGame(lobby, { now: 5 });
  assert.deepEqual(lobby, before);
  assert.equal(r.room.status, 'playing');
  assert.equal(r.room.board.eras.length, 7);
  assert.equal(typeof r.room.rngState, 'number');
  assert.deepEqual(r.room.turn.order, ['c1', 'c2']);
  assert.equal(r.room.turn.turnNo, 1);
  for (const c of r.room.characters) {
    assert.equal(c.money, 1000);
    assert.equal(c.debt, 0);
    assert.deepEqual(c.position, { eraIndex: 0, route: 'main', index: -1 });
    assert.equal(c.era, 'baby');
    assert.equal(c.finished, false);
  }
  assert.ok(types(r.events).includes('turnStarted'));
  assert.equal(startGame(r.room).ok, false); // already started
});

test('spin rolls 1..10 and moves exactly that many tiles (real rng)', () => {
  let room = started({ eraTurns: { baby: 40, elem: 40 } });
  const seen = new Set();
  for (let i = 0; i < 60; i++) {
    const id = cur(room);
    const from = ch(room, id).position.index;
    const r = applyAction(room, { type: 'spin', characterId: id }, { now: i });
    const spun = r.events.find((e) => e.type === 'spun');
    assert.ok(spun.value >= 1 && spun.value <= 10);
    seen.add(spun.value);
    const moved = r.events.find((e) => e.type === 'moved');
    assert.equal(moved.path.length, spun.value);
    assert.equal(ch(r.room, id).position.index, from + spun.value);
    room = r.room;
    if (room.turn.pending) break;
    if (ch(room, id).position.index > 25) break;
  }
  assert.ok(seen.size >= 5);
});

test('input room is never mutated by applyAction', () => {
  const room = started();
  const snap = structuredClone(room);
  act(room, { type: 'spin', characterId: cur(room) }, [3]);
  assert.deepEqual(room, snap);
});

test('movement across an era boundary emits eraChanged', () => {
  const room = started();
  const id = cur(room);
  ch(room, id).position = { eraIndex: 0, route: 'main', index: 2 }; // last baby tile
  setTile(room, 1, 1, { type: 'money', amount: 30 });
  const r = act(room, { type: 'spin', characterId: id }, [2]);
  assert.deepEqual(r.events.find((e) => e.type === 'moved').path, ['elem:main:0', 'elem:main:1']);
  const ec = r.events.find((e) => e.type === 'eraChanged');
  assert.equal(ec.era, 'elem');
  assert.equal(ch(r.room, id).era, 'elem');
  assert.ok(types(r.events).indexOf('eraChanged') < types(r.events).indexOf('landed'));
});

test('money and loss tiles; loss beyond cash becomes debt, gains repay debt', () => {
  let room = started({ startingMoney: 100 });
  const [a, b] = room.turn.order;
  setTile(room, 0, 0, { type: 'loss', amount: 150 });
  let r = act(room, { type: 'spin', characterId: a }, [1]);
  const mc = r.events.find((e) => e.type === 'moneyChanged');
  assert.equal(mc.delta, -150);
  assert.deepEqual([ch(r.room, a).money, ch(r.room, a).debt], [0, 50]);
  assert.equal(r.events.find((e) => e.type === 'landed').tileType, 'loss');
  assert.equal(mc.emotion === 'cry' || mc.emotion === 'shock', true);
  room = r.room;
  setTile(room, 0, 1, { type: 'money', amount: 80 });
  r = act(room, { type: 'spin', characterId: b }, [2]); // b → baby:main:1
  assert.equal(ch(r.room, b).money, 180);
  room = r.room;
  r = act(room, { type: 'spin', characterId: a }, [1]); // a → baby:main:1 (+80, repays 50)
  assert.deepEqual([ch(r.room, a).money, ch(r.room, a).debt], [30, 0]);
});

test('stop tile halts movement and opens route choice; choose sets the route', () => {
  let room = started({ chars: [['A', 'A1'], ['B', 'B1'], ['A', 'A2']] });
  const id = cur(room);
  ch(room, id).position = { eraIndex: 3, route: 'main', index: 4 }; // last high tile
  let r = act(room, { type: 'spin', characterId: id }, [7]);
  const moved = r.events.find((e) => e.type === 'moved');
  assert.deepEqual(moved.path, ['young:main:0']);
  assert.equal(moved.halted, 'stop');
  assert.equal(r.room.turn.phase, 'awaitDecision');
  const p = r.room.turn.pending;
  assert.equal(p.kind, 'routeChoice');
  assert.deepEqual(p.forCharacterIds, [id]);
  assert.deepEqual(p.options.map((o) => o.id), ['love', 'career', 'money']);
  assert.equal(p.deadlineAt, null);
  assert.equal(cur(r.room), id, 'turn does not advance while deciding');
  room = r.room;

  assert.throws(() => act(room, { type: 'spin', characterId: id }), { status: 409 });
  assert.throws(() => act(room, { type: 'choose', characterId: id, promptId: 'nope', optionId: 'love' }), { status: 409 });
  assert.throws(() => act(room, { type: 'choose', characterId: id, promptId: p.promptId, optionId: 'x' }), { status: 400 });
  assert.throws(
    () => act(room, { type: 'choose', characterId: id, promptId: p.promptId, optionId: 'love', actor: { sessionId: 'B' } }),
    { status: 403 },
  );
  r = act(room, { type: 'choose', characterId: id, promptId: p.promptId, optionId: 'love', actor: { sessionId: 'A' } });
  assert.deepEqual(types(r.events).slice(0, 2), ['chose', 'routeChosen']);
  const c = ch(r.room, id);
  assert.equal(c.route, 'love');
  assert.deepEqual(c.routeHistory, [{ era: 'young', route: 'love', completed: false }]);
  assert.equal(r.room.turn.pending, null);
  assert.notEqual(cur(r.room), id);

  // next time this character moves it goes down the love track and later merges
  room = r.room;
  room.turn.currentIndex = room.turn.order.indexOf(id);
  const L = room.board.eras[4].routes.love.tiles.length;
  r = act(room, { type: 'spin', characterId: id }, [L + 1]);
  const path = r.events.find((e) => e.type === 'moved').path;
  assert.equal(path[0], 'young:love:0');
  assert.equal(path.at(-1), 'young:main:1');
  assert.equal(ch(r.room, id).routeHistory[0].completed, true);
});

test('ownership and turn validation', () => {
  const room = started();
  const [a, b] = room.turn.order;
  assert.throws(() => act(room, { type: 'spin', characterId: a, actor: { sessionId: 'B' } }), { status: 403 });
  assert.throws(() => act(room, { type: 'spin', characterId: b, actor: { sessionId: 'B' } }), { status: 409 });
  assert.throws(() => act(room, { type: 'spin', characterId: 'c99' }), { status: 404 });
  assert.throws(() => act(room, { type: 'dance' }), { status: 400 });
  assert.throws(() => act({ ...room, status: 'lobby' }, { type: 'spin', characterId: a }), { status: 409 });
  assert.doesNotThrow(() => act(room, { type: 'spin', characterId: a, actor: { sessionId: 'A' } }, [1]));
});

test('simultaneous prompt (생일 파티) collects answers; timeout fills defaults', () => {
  const base = gameData();
  const birthday = base.board.events.find((e) => e.kind === 'groupGift');
  const data = { ...base, board: { ...base.board, events: [birthday] } };
  let room = started({ chars: [['A', 'A1'], ['B', 'B1'], ['A', 'A2'], ['B', 'B2']] });
  const [a1, b1, a2, b2] = room.turn.order; // turn positions; family order = A1, A2, B1, B2
  assert.deepEqual([a1, b1, a2, b2].map((id) => ch(room, id).name), ['A1', 'A2', 'B1', 'B2']);
  setTile(room, 0, 0, { type: 'event' });
  let r = act(room, { type: 'spin', characterId: a1 }, [1], { data });
  const p = r.room.turn.pending;
  assert.equal(p.kind, 'groupGift');
  assert.deepEqual(p.forCharacterIds, [b1, a2, b2]);
  assert.equal(p.deadlineAt, 1000 + base.balance.prompts.multiTimeoutMs);
  assert.ok(r.events.some((e) => e.type === 'prompt' && e.forCharacterIds.length === 3));
  room = r.room;

  const choose = (rm, id, opt, sess) => act(rm, { type: 'choose', characterId: id, promptId: p.promptId, optionId: opt, actor: { sessionId: sess } }, [], { data });
  const firstAnswer = choose(room, b1, 'gift', 'A');
  const choseEv = firstAnswer.events.find((e) => e.type === 'chose');
  assert.equal(choseEv.charId, b1);
  assert.equal(Object.hasOwn(choseEv, 'optionId'), false, 'simultaneous answers are not broadcast');
  room = firstAnswer.room; // b1 = A2 (owned by A)
  assert.throws(() => choose(room, b1, 'skip', 'A'), { status: 409 }); // already answered
  assert.throws(() => choose(room, a1, 'gift', 'A'), { status: 403 }); // birthday kid can't answer
  assert.equal(room.turn.phase, 'awaitDecision');

  // masking: B sees that A2 answered but not what
  const vb = viewFor(room, 'B');
  assert.deepEqual(vb.turn.pending.answered, [b1]);
  assert.deepEqual(vb.turn.pending.answers, {});
  assert.deepEqual(viewFor(room, 'A').turn.pending.answers, { [b1]: 'gift' });

  room = choose(room, a2, 'gift', 'B').room; // a2 = B1
  assert.throws(() => act(room, { type: 'timeout', promptId: p.promptId, actor: { sessionId: 'B' } }, [], { data }), { status: 409 });
  const moneyBefore = ch(room, a1).money;
  r = act(room, { type: 'timeout', promptId: p.promptId, actor: { system: true } }, [], { data, now: p.deadlineAt });
  const timedOut = r.events.filter((e) => e.type === 'chose' && e.timedOut);
  assert.deepEqual(timedOut.map((e) => [e.charId, e.optionId]), [[b2, 'skip']]);
  assert.equal(ch(r.room, a1).money, moneyBefore + 2 * birthday.gift);
  assert.equal(ch(r.room, b1).money, 1000 - birthday.gift);
  assert.equal(ch(r.room, b2).money, 1000);
  assert.equal(r.room.turn.pending, null);
  assert.equal(cur(r.room), b1);
  // admin can force a timeout early
  const early = act(room, { type: 'timeout', force: true, actor: { admin: true } }, [], { data });
  assert.equal(early.room.turn.pending, null);
});

test('side bets: payout math, validation, masking until resolved', () => {
  const bal = gameData().balance;
  assert.equal(betWins({ kind: 'oddEven', pick: 'odd' }, 7, bal), true);
  assert.equal(betWins({ kind: 'oddEven', pick: 'even' }, 7, bal), false);
  assert.equal(betWins({ kind: 'range', pick: '1-3' }, 3, bal), true);
  assert.equal(betWins({ kind: 'range', pick: '4-6' }, 7, bal), false);
  assert.equal(betWins({ kind: 'range', pick: '7-10' }, 10, bal), true);

  let room = started({ chars: [['A', 'A1'], ['B', 'B1'], ['B', 'B2'], ['A', 'A2']], startingMoney: 100 });
  const order = room.turn.order; // A1, A2, B1, B2
  const [a1, a2, b1, b2] = order;
  const bet = (rm, id, kind, pick, amount, sess = 'B') => act(rm, { type: 'bet', characterId: id, kind, pick, amount, actor: { sessionId: sess } });
  assert.throws(() => bet(room, a2, 'oddEven', 'odd', 10, 'A'), { status: 403 }); // same family as current
  assert.throws(() => bet(room, b1, 'oddEven', 'odd', 10, 'A'), { status: 403 }); // not my character
  assert.throws(() => bet(room, b1, 'oddEven', 'maybe', 10), { status: 400 });
  assert.throws(() => bet(room, b1, 'range', '1-3', 4), { status: 400 });
  assert.throws(() => bet(room, b1, 'range', '1-3', 25), { status: 400 });
  room = bet(room, b1, 'oddEven', 'odd', 10).room;
  room = bet(room, b2, 'range', '1-3', 20).room;
  const slot = room.bets[room.turn.turnNo];
  assert.deepEqual(Object.keys(slot).sort(), [b1, b2].sort());
  // A can't see B's picks before the spin
  const va = viewFor(room, 'A');
  assert.equal(va.bets[room.turn.turnNo][b1].hidden, true);
  assert.equal(va.bets[room.turn.turnNo][b1].pick, undefined);
  assert.equal(viewFor(room, 'B').bets[room.turn.turnNo][b1].pick, 'odd');

  // replace b2's bet, then spin 5: odd wins ×2 (+10), '1-3' loses (-15)
  room = bet(room, b2, 'range', '1-3', 15).room;
  const r = act(room, { type: 'spin', characterId: a1 }, [5]);
  const res = r.events.find((e) => e.type === 'betResolved');
  assert.equal(res.value, 5);
  const byId = Object.fromEntries(res.results.map((x) => [x.charId, x]));
  assert.deepEqual([byId[b1].won, byId[b1].delta], [true, 10]);
  assert.deepEqual([byId[b2].won, byId[b2].delta], [false, -15]);
  assert.equal(ch(r.room, b1).money, 110);
  assert.equal(ch(r.room, b2).money, 85);
  assert.ok(types(r.events).indexOf('spun') < types(r.events).indexOf('betResolved'));
  assert.equal(viewFor(r.room, 'A').bets[room.turn.turnNo][b1].pick, 'odd'); // visible once resolved

  // 7-10 pays ×2.5 (net +1.5×amount, rounded down); can't bet more than you have
  let room2 = r.room; // now A2's turn
  assert.equal(cur(room2), a2);
  room2 = bet(room2, b1, 'range', '7-10', 15).room;
  const r2 = act(room2, { type: 'spin', characterId: a2 }, [9]);
  assert.equal(r2.events.find((e) => e.type === 'betResolved').results[0].delta, 22);
  const poor = structuredClone(r.room);
  ch(poor, b1).money = 7;
  assert.throws(() => bet(poor, b1, 'oddEven', 'even', 10), { status: 409 });
});

test('역전 보정: bottom-2 entering senior get 기초연금 (≥3 characters)', () => {
  const room = started({ chars: [['A', 'A1'], ['B', 'B1'], ['A', 'A2']] });
  const [x, y, z] = room.turn.order;
  ch(room, x).money = 0;
  ch(room, y).money = 5000;
  ch(room, z).money = 1000;
  ch(room, x).position = { eraIndex: 5, route: 'main', index: 1 }; // middle_age merge
  setTile(room, 6, 0, { type: 'event' });
  const r = act(room, { type: 'spin', characterId: x }, [1]);
  const pension = r.events.find((e) => e.type === 'moneyChanged' && e.reason === 'pension');
  const cfg = gameData().balance.pension;
  assert.equal(pension.delta, Math.min(cfg.max, cfg.base + 5000 * cfg.gapRatio));
  assert.equal(ch(r.room, x).pensionGiven, true);
  // the richest does not get it
  const room2 = structuredClone(room);
  room2.turn.currentIndex = room2.turn.order.indexOf(y);
  ch(room2, y).position = { eraIndex: 5, route: 'main', index: 1 };
  const r2 = act(room2, { type: 'spin', characterId: y }, [1]);
  assert.ok(!r2.events.some((e) => e.reason === 'pension'));
});

test('goal → finished with prize → others continue while finished get bonus spins → gameOver ranking', () => {
  let room = started({ mode: 'kids', eraTurns: { baby: 1, elem: 1, middle: 1, high: 1 } });
  const [a, b] = room.turn.order;
  let r = act(room, { type: 'spin', characterId: a }, [10]);
  const fin = r.events.find((e) => e.type === 'finished');
  assert.deepEqual([fin.charId, fin.place], [a, 1]);
  assert.equal(r.events.find((e) => e.type === 'moved').path.length, 4);
  assert.equal(r.events.filter((e) => e.type === 'eraChanged').length, 3);
  const prize = gameData().balance.goalPrizes[0];
  assert.equal(ch(r.room, a).money, 1000 + prize);
  room = r.room;
  assert.equal(cur(room), b);
  // b moves 1 → a's turn is skipped with an automatic bonus spin
  r = act(room, { type: 'spin', characterId: b }, [1, 6]);
  const bonus = r.events.find((e) => e.type === 'bonusSpin');
  assert.deepEqual([bonus.charId, bonus.value, bonus.amount], [a, 6, 6 * gameData().balance.bonusSpinUnit]);
  assert.equal(cur(r.room), b);
  assert.equal(ch(r.room, a).goalBonus, prize + 6 * gameData().balance.bonusSpinUnit);
  room = r.room;
  assert.throws(() => act(room, { type: 'spin', characterId: a }), { status: 409 });
  // b reaches the goal → game over
  r = act(room, { type: 'spin', characterId: b }, [10]);
  assert.ok(types(r.events).includes('gameOver'));
  assert.equal(r.room.status, 'finished');
  const ranking = r.room.result.ranking;
  assert.equal(ranking.length, 2);
  assert.ok(ranking[0].total >= ranking[1].total);
  assert.deepEqual(ranking.map((x) => x.rank), [1, 2]);
  assert.equal(ch(r.room, b).place, 2);
  assert.equal(r.room.turn.phase, 'gameOver');
  assert.throws(() => act(r.room, { type: 'spin', characterId: b }), { status: 409 });
});

test('restore from a JSON snapshot mid-game continues identically (rngState)', () => {
  const play = (room, steps) => {
    for (let i = 0; i < steps && room.status === 'playing'; i++) {
      const p = room.turn.pending;
      const action = p
        ? { type: 'choose', characterId: p.forCharacterIds.find((id) => !Object.hasOwn(p.answers, id)), promptId: p.promptId, optionId: p.options[room.turn.turnNo % p.options.length].id }
        : { type: 'spin', characterId: cur(room) };
      room = applyAction(room, action, { now: i }).room;
    }
    return room;
  };
  const start = started({ chars: [['A', 'A1'], ['B', 'B1'], ['A', 'A2']], seed: 2024 });
  const mid = play(start, 25);
  const restored = JSON.parse(JSON.stringify(mid));
  const endA = play(mid, 40);
  const endB = play(restored, 40);
  assert.deepEqual(endA.characters, endB.characters);
  assert.equal(endA.rngState, endB.rngState);
  assert.notEqual(mid.rngState, start.rngState);
  // and the whole game is reproducible from the seed
  assert.deepEqual(play(start, 65).characters, endA.characters);
});
