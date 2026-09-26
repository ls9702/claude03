import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PLAYERS,
  addCharacter,
  endGame,
  joinRoom,
  removeCharacter,
  setReady,
  startGame,
  updateCharacter,
} from '../server/game/lobby.js';
import { makeRoom } from './helpers.js';

function joined(...sessions) {
  let room = makeRoom();
  for (const s of sessions) {
    const r = joinRoom(room, s, `이름${s}`);
    assert.equal(r.ok, true);
    room = r.room;
  }
  return room;
}

test('join creates players with ids; rules are pure (input untouched)', () => {
  const room = makeRoom();
  const r = joinRoom(room, 'A', '  철수  ');
  assert.equal(r.ok, true);
  assert.equal(room.players.length, 0, 'original room not mutated');
  assert.equal(r.room.players[0].name, '철수');
  assert.equal(r.room.players[0].id, 'p1');
  assert.equal(r.room.players[0].connected, false);
  assert.equal(r.logs.length, 1);
});

test('rejoin with same session does not duplicate; rename allowed', () => {
  let room = joined('A');
  const r = joinRoom(room, 'A', '새이름');
  assert.equal(r.ok, true);
  assert.equal(r.rejoined, true);
  assert.equal(r.room.players.length, 1);
  assert.equal(r.room.players[0].name, '새이름');
});

test('name validation and player cap', () => {
  assert.equal(joinRoom(makeRoom(), 'A', '').ok, false);
  assert.equal(joinRoom(makeRoom(), 'A', 'a'.repeat(13)).ok, false);
  assert.equal(joinRoom(makeRoom(), 'A', 42).ok, false);
  const full = joined(...Array.from({ length: MAX_PLAYERS }, (_, i) => `S${i}`));
  const r = joinRoom(full, 'late', '지각');
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
});

test('cannot newly join a started room, but existing player can rejoin', () => {
  const room = { ...joined('A'), status: 'playing' };
  assert.equal(joinRoom(room, 'B', '비').ok, false);
  assert.equal(joinRoom(room, 'A', '이름A').ok, true);
});

test('character limit is total maxCharacters; one session may own several', () => {
  let room = joined('A', 'B');
  room.config.maxCharacters = 8;
  for (let i = 0; i < 4; i++) room = addCharacter(room, 'A', { name: `A${i}` }).room;
  for (let i = 0; i < 4; i++) room = addCharacter(room, 'B', { name: `B${i}` }).room;
  assert.equal(room.characters.length, 8);
  assert.equal(room.characters.filter((c) => c.ownerSessionId === 'A').length, 4);
  const over = addCharacter(room, 'A', { name: '초과' });
  assert.equal(over.ok, false);
  assert.equal(over.status, 409);
  // ids are unique and stable
  assert.equal(new Set(room.characters.map((c) => c.id)).size, 8);
});

test('smaller maxCharacters enforced', () => {
  let room = joined('A');
  room.config.maxCharacters = 2;
  room = addCharacter(room, 'A', { name: '1' }).room;
  room = addCharacter(room, 'A', { name: '2' }).room;
  assert.equal(addCharacter(room, 'A', { name: '3' }).ok, false);
});

test('non-player cannot add; name required; avatar sanitized', () => {
  const room = joined('A');
  assert.equal(addCharacter(room, 'X', { name: '누구' }).status, 403);
  assert.equal(addCharacter(room, 'A', { name: '' }).status, 400);
  const r = addCharacter(room, 'A', { name: '민지', avatar: { hair: 'long', skin: 'bogus', evil: '<script>' } });
  const av = r.character.avatar;
  assert.equal(av.hair, 'long');
  assert.equal(av.skin, 'light'); // default
  assert.equal(av.evil, undefined);
  assert.deepEqual(Object.keys(av).sort(), ['accessory', 'body', 'build', 'cheek', 'eyes', 'face', 'hair', 'hairColor', 'mouth', 'outfit', 'outfitColor', 'skin']);
});

test('old saved avatars (8 keys) migrate: new categories get defaults', () => {
  const room = joined('A');
  const old = { body: 'girl', skin: 'tan', hair: 'bun', hairColor: 'pink', eyes: 'sleepy', accessory: 'cap', outfit: 'hanbok', outfitColor: 'green' };
  const av = addCharacter(room, 'A', { name: '예전', avatar: old }).character.avatar;
  for (const [k, v] of Object.entries(old)) assert.equal(av[k], v);
  assert.equal(av.build, 'normal');
  assert.equal(av.face, 'slim');
  assert.equal(av.mouth, 'smile');
  assert.equal(av.cheek, 'none');
});

test('ownership: only owner can update/delete', () => {
  let room = joined('A', 'B');
  const r = addCharacter(room, 'A', { name: '에이' });
  room = r.room;
  const id = r.character.id;
  assert.equal(removeCharacter(room, 'B', id).status, 403);
  assert.equal(updateCharacter(room, 'B', id, { name: '해킹' }).status, 403);
  assert.equal(removeCharacter(room, 'A', 'c999').status, 404);
  const up = updateCharacter(room, 'A', id, { name: '에이2', avatar: { hair: 'bun' } });
  assert.equal(up.ok, true);
  assert.equal(up.character.name, '에이2');
  assert.equal(up.character.avatar.hair, 'bun');
  const del = removeCharacter(up.room, 'A', id);
  assert.equal(del.ok, true);
  assert.equal(del.room.characters.length, 0);
});

test('ready toggles; adding a character resets ready', () => {
  let room = joined('A');
  room = setReady(room, 'A', true).room;
  assert.equal(room.players[0].ready, true);
  assert.equal(setReady(room, 'A', 'yes').ok, false);
  room = addCharacter(room, 'A', { name: '가' }).room;
  assert.equal(room.players[0].ready, false);
});

test('start requires ≥2 characters and sets family-order turn skeleton', () => {
  let room = joined('A', 'B');
  room = addCharacter(room, 'A', { name: 'A1' }).room;
  assert.equal(startGame(room).ok, false);
  room = addCharacter(room, 'B', { name: 'B1' }).room;
  room = addCharacter(room, 'A', { name: 'A2' }).room;
  const r = startGame(room);
  assert.equal(r.ok, true);
  assert.equal(r.room.status, 'playing');
  assert.deepEqual(r.room.turn, { order: ['c1', 'c3', 'c2'], currentIndex: 0, phase: 'awaitSpin', pending: null });
  // lobby-only operations now refused
  assert.equal(addCharacter(r.room, 'A', { name: 'late' }).status, 409);
  assert.equal(removeCharacter(r.room, 'A', 'c1').status, 409);
  assert.equal(startGame(r.room).ok, false);
  const ended = endGame(r.room);
  assert.equal(ended.room.status, 'finished');
  assert.equal(endGame(ended.room).ok, false);
});

test('index turnOrder config respected at start', () => {
  let room = joined('A', 'B');
  room.config.turnOrder = 'index';
  room = addCharacter(room, 'A', { name: 'A1' }).room;
  room = addCharacter(room, 'B', { name: 'B1' }).room;
  room = addCharacter(room, 'A', { name: 'A2' }).room;
  assert.deepEqual(startGame(room).room.turn.order, ['c1', 'c2', 'c3']);
});
