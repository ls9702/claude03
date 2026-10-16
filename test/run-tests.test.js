// scripts/run-tests.js (`npm test`): file patterns, shard planning (longest first onto the least loaded shard) and the
// first-run weight guess that keeps the image / server / engine files apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { expandPatterns, guessMs, isolationFlag, planShards } from '../scripts/run-tests.js';

const ROOT = path.resolve(import.meta.dirname, '..');

test('expandPatterns: dir/*.test.js globs and plain paths, sorted, de-duplicated', () => {
  const all = expandPatterns(['test/*.test.js'], ROOT);
  assert.ok(all.length > 40);
  assert.ok(all.every((f) => f.startsWith(path.join(ROOT, 'test') + path.sep) && f.endsWith('.test.js')));
  assert.deepEqual(all, [...all].sort());
  assert.ok(!all.some((f) => f.includes(`${path.sep}legacy${path.sep}`)), 'the legacy suite is opt-in');
  const two = expandPatterns(['test/rng.test.js', 'test/r*.test.js'], ROOT);
  assert.equal(two.filter((f) => f.endsWith('rng.test.js')).length, 1);
  assert.deepEqual(expandPatterns(['nope/*.test.js'], ROOT), []);
});

test('planShards: heaviest files first onto the least loaded shard; every file exactly once', () => {
  const w = { a: 9, b: 7, c: 5, d: 4, e: 3, f: 2, g: 1 };
  const shards = planShards(Object.keys(w), 3, (f) => w[f]);
  assert.deepEqual(shards.map((s) => s.files.join('')), ['af', 'be', 'cdg']);
  assert.deepEqual(shards.map((s) => s.load), [11, 10, 10]);
  assert.equal(planShards(['x', 'y'], 4, () => 1).length, 2, 'never an empty shard');
});

test('guessMs (no timings yet): image pipeline > HTTP / engine tests > pure client tests; isolation flag probe', () => {
  const g = (f) => guessMs(path.join(ROOT, 'test', f));
  assert.ok(g('chara-pipeline.test.js') > g('stage9-submaps.test.js'));
  assert.ok(g('stage9-submaps.test.js') > g('client-family.test.js'));
  assert.ok(g('server.test.js') > g('client-format.test.js'));
  assert.equal(guessMs(path.join(ROOT, 'test', 'missing.test.js')), 100);
  const flag = isolationFlag();
  assert.ok(flag === null || /^--(experimental-)?test-isolation=none$/.test(flag));
});
