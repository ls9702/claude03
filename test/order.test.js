import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTurnOrder } from '../server/game/order.js';

const players = [{ sessionId: 'A' }, { sessionId: 'B' }, { sessionId: 'C' }];
// creation interleaved: A1, B1, A2, C1, B2, A3
const chars = [
  { id: 'c1', seq: 1, ownerSessionId: 'A' },
  { id: 'c2', seq: 2, ownerSessionId: 'B' },
  { id: 'c3', seq: 3, ownerSessionId: 'A' },
  { id: 'c4', seq: 4, ownerSessionId: 'C' },
  { id: 'c5', seq: 5, ownerSessionId: 'B' },
  { id: 'c6', seq: 6, ownerSessionId: 'A' },
];

test('family order groups by owner in player join order', () => {
  assert.deepEqual(buildTurnOrder(chars, players, 'family'), ['c1', 'c3', 'c6', 'c2', 'c5', 'c4']);
});

test('family is the default mode', () => {
  assert.deepEqual(buildTurnOrder(chars, players), buildTurnOrder(chars, players, 'family'));
});

test('player join order, not character order, decides family order', () => {
  const reordered = [{ sessionId: 'C' }, { sessionId: 'A' }, { sessionId: 'B' }];
  assert.deepEqual(buildTurnOrder(chars, reordered, 'family'), ['c4', 'c1', 'c3', 'c6', 'c2', 'c5']);
});

test('index order is creation order regardless of array order', () => {
  const shuffled = [chars[3], chars[0], chars[5], chars[1], chars[4], chars[2]];
  assert.deepEqual(buildTurnOrder(shuffled, players, 'index'), ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
});

test('cpu / unknown owners go last, grouped', () => {
  const withCpu = [
    { id: 'x1', seq: 1, ownerSessionId: 'cpu' },
    ...chars.slice(0, 2),
    { id: 'x2', seq: 9, ownerSessionId: 'cpu' },
  ];
  assert.deepEqual(buildTurnOrder(withCpu, players, 'family'), ['c1', 'c2', 'x1', 'x2']);
});

test('empty input', () => {
  assert.deepEqual(buildTurnOrder([], [], 'family'), []);
  assert.deepEqual(buildTurnOrder([], [], 'index'), []);
});
