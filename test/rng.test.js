import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../server/game/rng.js';

test('same seed → same sequence; different seed → different', () => {
  const a = createRng(12345);
  const b = createRng(12345);
  const c = createRng(54321);
  const sa = Array.from({ length: 20 }, () => a.next());
  const sb = Array.from({ length: 20 }, () => b.next());
  const sc = Array.from({ length: 20 }, () => c.next());
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  assert.ok(sa.every((x) => x >= 0 && x < 1));
});

test('state is serializable: restoring continues the exact sequence', () => {
  const a = createRng(7);
  for (let i = 0; i < 13; i++) a.int(1, 10);
  const saved = JSON.parse(JSON.stringify({ s: a.state })).s;
  const b = createRng(saved);
  assert.deepEqual(
    Array.from({ length: 10 }, () => a.int(1, 100)),
    Array.from({ length: 10 }, () => b.int(1, 100)),
  );
});

test('int stays in range and hits both ends', () => {
  const r = createRng(1);
  const seen = new Set();
  for (let i = 0; i < 5000; i++) {
    const v = r.int(1, 10);
    assert.ok(Number.isInteger(v) && v >= 1 && v <= 10);
    seen.add(v);
  }
  assert.equal(seen.size, 10);
});

test('pick and weighted', () => {
  const r = createRng(99);
  const items = [{ id: 'a', weight: 0 }, { id: 'b', weight: 3 }, { id: 'c', weight: 1 }];
  const counts = { a: 0, b: 0, c: 0 };
  for (let i = 0; i < 4000; i++) counts[r.weighted(items).id]++;
  assert.equal(counts.a, 0);
  assert.ok(counts.b > counts.c * 2, JSON.stringify(counts));
  assert.throws(() => r.weighted([{ weight: 0 }]));
  assert.ok(['x', 'y'].includes(r.pick(['x', 'y'])));
  assert.throws(() => r.pick([]));
});
