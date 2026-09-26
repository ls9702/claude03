import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addCharacter, joinRoom } from '../server/game/lobby.js';
import { adminSummary, adminView, viewFor } from '../server/game/view.js';
import { makeRoom } from './helpers.js';

const TOKEN_A = 'tokenAAAAAAAAAAAAAAAAAAAA';
const TOKEN_B = 'tokenBBBBBBBBBBBBBBBBBBBB';

function sample() {
  let room = makeRoom({ seed: 987654321 });
  room = joinRoom(room, TOKEN_A, '에이').room;
  room = joinRoom(room, TOKEN_B, '비').room;
  room = addCharacter(room, TOKEN_A, { name: 'A1' }).room;
  room = addCharacter(room, TOKEN_B, { name: 'B1' }).room;
  room = addCharacter(room, TOKEN_A, { name: 'A2' }).room;
  return room;
}

test('isMe flags on players and characters', () => {
  const v = viewFor(sample(), TOKEN_A);
  assert.deepEqual(v.players.map((p) => p.isMe), [true, false]);
  assert.deepEqual(v.characters.map((c) => c.isMe), [true, false, true]);
  assert.deepEqual(v.me, { id: 'p1', name: '에이', ready: false, role: 'player' });
  const vb = viewFor(sample(), TOKEN_B);
  assert.deepEqual(vb.characters.map((c) => c.isMe), [false, true, false]);
});

test('owner exposed as player id/name, never as session token', () => {
  const room = sample();
  const v = viewFor(room, TOKEN_A);
  assert.equal(v.characters[1].ownerId, 'p2');
  assert.equal(v.characters[1].ownerName, '비');
  const json = JSON.stringify(v);
  assert.ok(!json.includes(TOKEN_A));
  assert.ok(!json.includes(TOKEN_B));
  assert.ok(!json.includes('sessionId'));
  assert.ok(!json.includes('ownerSessionId'));
  assert.equal(v.seed, undefined);
});

test('no session → no flags, me null', () => {
  const v = viewFor(sample(), null);
  assert.equal(v.me, null);
  assert.ok(v.players.every((p) => !p.isMe));
  assert.ok(v.characters.every((c) => !c.isMe));
});

test('view is a copy: mutating it does not touch the room', () => {
  const room = sample();
  const v = viewFor(room, TOKEN_A);
  v.characters[0].avatar.hair = 'zzz';
  v.config.maxCharacters = 1;
  assert.notEqual(room.characters[0].avatar.hair, 'zzz');
  assert.equal(room.config.maxCharacters, 8);
});

test('admin view/summary never leak tokens', () => {
  const room = sample();
  const json = JSON.stringify([adminView(room), adminSummary(room)]);
  assert.ok(!json.includes(TOKEN_A));
  assert.equal(adminSummary(room).characters, 3);
  assert.equal(adminView(room).seed, 987654321);
});
