import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultEraTurns, erasForMode } from '../server/data/index.js';
import { ROUTE_KEYS, buildBoard, eraPathLength, nextPosition, startPosition, tileAt } from '../server/game/board.js';
import { createRng } from '../server/game/rng.js';

const ID_RE = /^[a-z_]+:(main|love|career|money):\d+$/;

test('era set follows mode; lengths follow eraTurns; stop/merge/goal fixed', () => {
  const rng = createRng(3);
  for (const mode of ['lifetime', 'kids', 'adult']) {
    for (let k = 0; k < 20; k++) {
      const eraTurns = defaultEraTurns();
      for (const id of Object.keys(eraTurns)) eraTurns[id] = rng.int(3, 25);
      const board = buildBoard({ mode, eraTurns }, rng);
      assert.deepEqual(board.eras.map((e) => e.id), erasForMode(mode));
      const ids = new Set();
      for (const era of board.eras) {
        assert.equal(eraPathLength(era), eraTurns[era.id], `${mode} ${era.id}`);
        const all = [...era.tiles, ...Object.values(era.routes ?? {}).flatMap((r) => r.tiles)];
        for (const t of all) {
          assert.match(t.id, ID_RE);
          assert.ok(!ids.has(t.id), `duplicate ${t.id}`);
          ids.add(t.id);
          if (t.type === 'money' || t.type === 'loss') assert.ok(t.amount > 0);
        }
        if (era.id === 'young' || era.id === 'middle_age') {
          assert.equal(era.tiles.length, 2);
          assert.equal(era.tiles[0].type, 'stop');
          assert.equal(era.tiles[0].promptId, 'routeChoice');
          assert.equal(era.tiles[0].id, `${era.id}:main:0`);
          assert.equal(era.tiles[1].type, 'merge');
          const lens = ROUTE_KEYS.map((key) => era.routes[key].tiles.length);
          assert.ok(lens.every((l) => l === lens[0] && l === eraTurns[era.id] - 2));
          for (const key of ROUTE_KEYS) assert.equal(era.routes[key].tiles[0].id, `${era.id}:${key}:0`);
        } else {
          assert.equal(era.routes, undefined);
        }
        if (era.id === 'high') assert.equal(era.tiles[0].promptId, 'exam');
      }
      const last = board.eras.at(-1).tiles.at(-1);
      assert.equal(last.type, 'goal');
      assert.equal(board.eras.flatMap((e) => e.tiles).filter((t) => t.type === 'goal').length, 1);
    }
  }
});

test('walking from start reaches goal in exactly Σ eraTurns steps, via each route, through merges', () => {
  const eraTurns = defaultEraTurns();
  const board = buildBoard({ mode: 'lifetime', eraTurns }, createRng(11));
  const total = Object.values(eraTurns).reduce((a, b) => a + b, 0);
  for (const route of ROUTE_KEYS) {
    let pos = startPosition();
    let steps = 0;
    const seen = [];
    for (;;) {
      const np = nextPosition(board, pos, route);
      if (!np) break;
      pos = np;
      steps++;
      seen.push(tileAt(board, pos).id);
    }
    assert.equal(steps, total);
    assert.equal(tileAt(board, pos).type, 'goal');
    assert.ok(seen.includes(`young:${route}:0`));
    assert.ok(seen.includes('young:main:1') && seen.includes('middle_age:main:1'));
    assert.ok(!seen.some((id) => ROUTE_KEYS.filter((k) => k !== route).some((k) => id.includes(`:${k}:`))));
  }
});

test('deterministic for the same seed; tiny eraTurns still valid', () => {
  const cfg = { mode: 'lifetime', eraTurns: defaultEraTurns() };
  assert.deepEqual(buildBoard(cfg, createRng(5)), buildBoard(cfg, createRng(5)));
  const tiny = buildBoard({ mode: 'kids', eraTurns: { baby: 1, elem: 1, middle: 1, high: 1 } }, createRng(1));
  assert.equal(tiny.eras.at(-1).tiles[0].type, 'goal');
  const adult = buildBoard({ mode: 'adult', eraTurns: { young: 1, middle_age: 2, senior: 1 } }, createRng(1));
  for (const era of adult.eras.filter((e) => e.routes)) {
    for (const key of ROUTE_KEYS) assert.equal(era.routes[key].tiles.length, 1);
  }
});
