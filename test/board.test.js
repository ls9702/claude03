import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultEraTurns, erasForMode, gameData } from '../server/data/index.js';
import { ROUTE_KEYS, buildBoard, eraPathLength, lapPositions, lapSize, loopConfig, nextPosition, paydayCount, startPosition, tileAt, wrapsAt } from '../server/game/board.js';
import { createRng } from '../server/game/rng.js';

const ID_RE = /^[a-z_]+:(main|love|career|money):\d+$/;
const CFG = loopConfig();

test('loop maps: era set follows mode; every loop era is its own ring of lap = clamp(turns × 5.4, 18, 100) tiles', () => {
  const rng = createRng(3);
  for (const mode of ['lifetime', 'kids', 'adult']) {
    for (let k = 0; k < 12; k++) {
      const eraTurns = defaultEraTurns();
      for (const id of Object.keys(eraTurns)) eraTurns[id] = rng.int(3, 25);
      const board = buildBoard({ mode, eraTurns, finalLength: rng.int(20, 80) }, rng);
      assert.deepEqual(board.eras.map((e) => e.id), erasForMode(mode));
      const ids = new Set();
      for (const era of board.eras) {
        const all = [...era.tiles, ...Object.values(era.routes ?? {}).flatMap((r) => r.tiles)];
        for (const t of all) {
          assert.match(t.id, ID_RE);
          assert.ok(!ids.has(t.id), `duplicate ${t.id}`);
          ids.add(t.id);
          if (t.type === 'money' || t.type === 'loss') assert.ok(t.amount > 0);
          assert.notEqual(t.type, 'shop', 'shop tiles are folded into 찬스 광장');
        }
        if (era.final) continue;
        assert.equal(era.loop, true);
        assert.equal(era.turns, eraTurns[era.id]);
        assert.equal(era.lap, lapSize(eraTurns[era.id]));
        assert.equal(eraPathLength(era), era.lap);
        assert.equal(era.tiles[0].type, 'start');
        assert.ok(!all.some((t) => t.type === 'goal'), 'no goal on a loop era');
        if (era.id === 'young' || era.id === 'middle_age') {
          assert.equal(era.tiles[era.fork].type, 'stop');
          assert.equal(era.tiles[era.fork].promptId, 'routeChoice');
          assert.equal(era.rejoin, era.fork + 1);
          assert.equal(era.tiles[era.rejoin].type, 'merge');
          const lens = ROUTE_KEYS.map((key) => era.routes[key].tiles.length);
          assert.ok(lens.every((l) => l === lens[0]), 'equal route lengths');
          assert.equal(era.tiles.length + lens[0], era.lap);
          assert.ok(lens[0] / era.lap > 0.35 && lens[0] / era.lap < 0.55, 'routes ≈ 40–50 % of the lap');
          for (const key of ROUTE_KEYS) assert.equal(era.routes[key].tiles[0].id, `${era.id}:${key}:0`);
        } else {
          assert.equal(era.routes, undefined);
        }
      }
    }
  }
  // the contract's default map sizes (3/3/3/3 kids eras → the 18-tile minimum; 15 turns → 81)
  assert.equal(lapSize(3), 18);
  assert.equal(lapSize(5), 27);
  assert.equal(lapSize(4), 22);
  assert.equal(lapSize(15), 81);
  assert.equal(lapSize(6), 32);
  assert.equal(lapSize(40), 100);
});

test('paydays: every lap path (each route, across the wrap) has a payday every 18–25 tiles; 2–4 pass tiles, never next to one', () => {
  const rng = createRng(7);
  for (let k = 0; k < 60; k++) {
    const eraTurns = defaultEraTurns();
    if (k) for (const id of Object.keys(eraTurns)) eraTurns[id] = rng.int(1, 40);
    const board = buildBoard({ mode: 'lifetime', eraTurns }, rng);
    board.eras.forEach((era, e) => {
      if (era.final) return;
      for (const route of era.routes ? ROUTE_KEYS : ['career']) {
        const types = lapPositions(board, e, route).map((p) => tileAt(board, p).type);
        assert.equal(types.length, era.lap);
        assert.equal(types.at(-1), 'start', 'a lap ends back on the start');
        const pays = types.map((t, i) => (t === 'salary' ? i : -1)).filter((i) => i >= 0);
        assert.equal(pays.length, paydayCount(era.lap), `${era.id} ${route} paydays`);
        const gaps = pays.map((p, i) => (i + 1 < pays.length ? pays[i + 1] - p : pays[0] + era.lap - p));
        if (era.lap >= 36) for (const g of gaps) assert.ok(g >= CFG.payday.min && g <= CFG.payday.max, `${era.id} ${route} gap ${g}`);
        const passes = types.map((t, i) => (t === 'pass' ? i : -1)).filter((i) => i >= 0);
        assert.ok(passes.length >= CFG.pass.min && passes.length <= CFG.pass.max, `${era.id} pass count ${passes.length}`);
        for (const i of passes) {
          assert.notEqual(types[(i + 1) % era.lap], 'salary');
          assert.notEqual(types[(i - 1 + era.lap) % era.lap], 'salary');
        }
      }
    });
  }
  // laps ≤ 25 get exactly one payday; 26–35 the nearest count
  assert.equal(paydayCount(18), 1);
  assert.equal(paydayCount(27), 1);
  assert.equal(paydayCount(32), 2);
  assert.equal(paydayCount(81), 4);
});

test('navigation: the ring wraps to the start (a lap), the fork leads into the chosen route, the route rejoins at the merge', () => {
  const board = buildBoard({ mode: 'lifetime', eraTurns: defaultEraTurns() }, createRng(11));
  const young = board.eras.findIndex((e) => e.id === 'young');
  const era = board.eras[young];
  for (const route of ROUTE_KEYS) {
    let pos = startPosition(young);
    const seen = [];
    let wraps = 0;
    for (let s = 0; s < era.lap * 2; s++) {
      const np = nextPosition(board, pos, route);
      assert.ok(np, 'a loop never ends');
      if (wrapsAt(board, pos, np)) wraps++;
      pos = np;
      seen.push(tileAt(board, pos).id);
    }
    assert.equal(wraps, 2);
    assert.ok(seen.includes(`young:${route}:0`));
    assert.ok(seen.includes(`young:main:${era.rejoin}`));
    assert.ok(!seen.some((id) => ROUTE_KEYS.filter((k) => k !== route).some((k) => id.includes(`:${k}:`))));
    assert.ok(seen.every((id) => id.startsWith('young:')), 'never leaves its era');
  }
  // a non-route era: plain ring
  const baby = board.eras[0];
  let pos = { eraIndex: 0, route: 'main', index: baby.tiles.length - 1 };
  const np = nextPosition(board, pos, null);
  assert.deepEqual(np, startPosition(0));
  assert.ok(wrapsAt(board, pos, np));
});

test('final era (lifetime / adult): a linear goal race of finalLength tiles — mostly good tiles, 3 trouble spots, 인생역전섬', () => {
  const data = gameData();
  for (const [mode, L] of [['lifetime', 40], ['adult', 20], ['lifetime', 80]]) {
    for (let seed = 1; seed <= 20; seed++) {
      const board = buildBoard({ mode, eraTurns: defaultEraTurns(), finalLength: L }, createRng(seed));
      const fin = board.eras.at(-1);
      assert.equal(fin.id, 'senior');
      assert.equal(fin.final, true);
      assert.equal(fin.loop, false);
      assert.equal(fin.tiles.length, L);
      assert.equal(fin.tiles[0].type, 'start');
      assert.equal(fin.tiles.at(-1).type, 'goal');
      const types = fin.tiles.map((t) => t.type);
      assert.ok(!types.includes('pass') && !types.includes('shop'));
      const pays = types.map((t, i) => (t === 'salary' ? i : -1)).filter((i) => i >= 0);
      assert.ok(pays.length >= 1);
      pays.forEach((p, i) => {
        const gap = p - (i ? pays[i - 1] : 0);
        if (L >= 26) assert.ok(gap >= 18 && gap <= 25, `gap ${gap}`);
      });
      const losses = types.map((t, i) => (t === 'loss' ? i : -1)).filter((i) => i >= 0);
      assert.ok(losses.length <= 3, 'trouble only at the fixed spots');
      assert.ok(losses.includes(L - 2), 'trouble just before the goal');
      const rev = types.filter((t) => t === 'reversal').length;
      assert.ok(rev >= 2 && rev <= 3, `인생역전섬 ${rev}`);
      // nextPosition stops at the goal
      assert.equal(nextPosition(board, { eraIndex: board.eras.length - 1, route: 'main', index: L - 1 }, null), null);
    }
  }
  // kids mode has no final race: every era loops
  const kids = buildBoard({ mode: 'kids', eraTurns: defaultEraTurns() }, createRng(1));
  assert.ok(kids.eras.every((e) => e.loop && !e.final));
  assert.ok(data.eras.modes.lifetime.finalEra === 'senior' && !data.eras.modes.kids.finalEra);
});

test('deterministic for the same seed; tiny eraTurns still valid', () => {
  const cfg = { mode: 'lifetime', eraTurns: defaultEraTurns() };
  assert.deepEqual(buildBoard(cfg, createRng(5)), buildBoard(cfg, createRng(5)));
  const tiny = buildBoard({ mode: 'kids', eraTurns: { baby: 1, elem: 1, middle: 1, high: 1 } }, createRng(1));
  for (const era of tiny.eras) {
    assert.equal(era.lap, CFG.lapMin);
    assert.equal(era.tiles.filter((t) => t.type === 'salary').length, 1);
  }
  const adult = buildBoard({ mode: 'adult', eraTurns: { young: 1, middle_age: 3 } }, createRng(1));
  for (const era of adult.eras.filter((e) => e.routes)) {
    const len = era.routes.love.tiles.length;
    for (const key of ROUTE_KEYS) assert.equal(era.routes[key].tiles.length, len);
    assert.equal(era.tiles.length + len, era.lap);
  }
});
