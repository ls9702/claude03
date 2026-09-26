import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { RoomStore } from '../server/store/roomStore.js';
import { defaultRoomConfig } from '../server/game/config.js';
import { addCharacter, joinRoom, setConnected } from '../server/game/lobby.js';
import { tempDir } from './helpers.js';

test('save → restore roundtrip (rooms + sessions)', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const a = await new RoomStore({ dataDir: dir, debounceMs: 10 }).load();
    const token = a.createSession();
    let room = a.createRoom(defaultRoomConfig());
    assert.match(room.code, /^[A-Z2-9]{6}$/);
    room = joinRoom(room, token, '철수').room;
    room = addCharacter(room, token, { name: '영희', avatar: { hair: 'bun' } }).room;
    room = setConnected(room, token, true).room;
    a.commit(room);
    await a.close();

    const files = await readdir(path.join(dir, 'saves'));
    assert.deepEqual(files, [`${room.id}.json`]);

    const b = await new RoomStore({ dataDir: dir }).load();
    const restored = b.getRoom(room.id);
    assert.ok(restored);
    assert.equal(restored.code, room.code);
    assert.equal(restored.characters[0].avatar.hair, 'bun');
    assert.equal(restored.players[0].connected, false, 'presence reset on restore');
    assert.equal(restored.version, room.version);
    assert.equal(b.findByCode(room.code.toLowerCase()).id, room.id);
    assert.ok(b.hasSession(token));
    assert.ok(!b.hasSession('nope'));
    await b.close();
  } finally {
    await cleanup();
  }
});

test('debounced saves coalesce and deleteRoom removes the file', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const s = await new RoomStore({ dataDir: dir, debounceMs: 20 }).load();
    const room = s.createRoom(defaultRoomConfig());
    let writes = 0;
    const orig = s.saveNow.bind(s);
    s.saveNow = (id) => {
      writes++;
      return orig(id);
    };
    for (let i = 0; i < 10; i++) s.commit(structuredClone(s.getRoom(room.id)));
    await new Promise((r) => setTimeout(r, 60));
    await s.flush();
    assert.equal(writes, 1);
    const saved = JSON.parse(await readFile(path.join(dir, 'saves', `${room.id}.json`), 'utf8'));
    assert.equal(saved.version, 11);

    assert.equal(await s.deleteRoom(room.id), true);
    assert.deepEqual(await readdir(path.join(dir, 'saves')), []);
    assert.equal(s.getRoom(room.id), null);
    assert.equal(await s.deleteRoom(room.id), false);
    await s.close();
  } finally {
    await cleanup();
  }
});

test('broadcast and per-session state go to subscribers', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const s = await new RoomStore({ dataDir: dir, debounceMs: 5 }).load();
    let room = s.createRoom(defaultRoomConfig());
    room = joinRoom(room, 'tokA', 'A').room;
    room = joinRoom(room, 'tokB', 'B').room;
    s.commit(room);
    const out = { A: '', B: '' };
    const fake = (k) => ({ write: (x) => (out[k] += x), end() {} });
    const unA = s.subscribe(room.id, 'tokA', fake('A'));
    s.subscribe(room.id, 'tokB', fake('B'));
    assert.equal(s.subscriberCount(room.id), 2);
    s.broadcast(room.id, 'reaction', { emoji: '헐' });
    s.broadcastState(room.id);
    assert.match(out.A, /event: reaction\ndata: {"emoji":"헐"}/);
    const stateA = JSON.parse(out.A.split('event: state\ndata: ')[1].split('\n')[0]);
    const stateB = JSON.parse(out.B.split('event: state\ndata: ')[1].split('\n')[0]);
    assert.equal(stateA.me.name, 'A');
    assert.equal(stateB.me.name, 'B');
    unA();
    assert.equal(s.subscriberCount(room.id, 'tokA'), 0);
    await s.close();
  } finally {
    await cleanup();
  }
});
