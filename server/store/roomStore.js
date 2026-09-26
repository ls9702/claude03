// In-memory room store + debounced JSON snapshots + SSE subscriber registry.
import { randomBytes, randomInt } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { viewFor } from '../game/view.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const ROOM_ID_RE = /^[a-f0-9]{8,32}$/;

export function sseFrame(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export class RoomStore {
  constructor({ dataDir, debounceMs = 300, log = () => {} } = {}) {
    if (!dataDir) throw new Error('dataDir required');
    this.dataDir = dataDir;
    this.savesDir = path.join(dataDir, 'saves');
    this.debounceMs = debounceMs;
    this.log = log;
    this.rooms = new Map();
    this.sessions = new Map(); // token -> { createdAt }
    this.subs = new Map(); // roomId -> Set<{ sessionId, res }>
    this.timers = new Map(); // roomId | '__sessions' -> Timeout
    this.pending = new Set(); // in-flight write promises
  }

  // ---------- boot / persistence ----------
  async load() {
    await mkdir(this.savesDir, { recursive: true });
    try {
      const raw = JSON.parse(await readFile(path.join(this.dataDir, 'sessions.json'), 'utf8'));
      for (const [token, s] of Object.entries(raw)) this.sessions.set(token, s);
    } catch (err) {
      if (err.code !== 'ENOENT') this.log(`세션 복원 실패: ${err.message}`);
    }
    for (const file of await readdir(this.savesDir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const room = JSON.parse(await readFile(path.join(this.savesDir, file), 'utf8'));
        if (!room || !ROOM_ID_RE.test(room.id)) continue;
        for (const p of room.players) p.connected = false;
        this.rooms.set(room.id, room);
      } catch (err) {
        this.log(`방 복원 실패 (${file}): ${err.message}`);
      }
    }
    return this;
  }

  async #writeJson(file, data) {
    const tmp = `${file}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 1));
    await rename(tmp, file);
  }

  #track(promise) {
    const p = promise.catch((err) => this.log(`저장 실패: ${err.message}`)).finally(() => this.pending.delete(p));
    this.pending.add(p);
    return p;
  }

  scheduleSave(roomId) {
    clearTimeout(this.timers.get(roomId));
    this.timers.set(
      roomId,
      setTimeout(() => {
        this.timers.delete(roomId);
        this.saveNow(roomId);
      }, this.debounceMs),
    );
  }

  saveNow(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return Promise.resolve();
    return this.#track(
      mkdir(this.savesDir, { recursive: true }).then(() =>
        this.#writeJson(path.join(this.savesDir, `${roomId}.json`), room),
      ),
    );
  }

  #scheduleSessionsSave() {
    const key = '__sessions';
    clearTimeout(this.timers.get(key));
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        this.#saveSessions();
      }, this.debounceMs),
    );
  }

  #saveSessions() {
    return this.#track(
      mkdir(this.dataDir, { recursive: true }).then(() =>
        this.#writeJson(path.join(this.dataDir, 'sessions.json'), Object.fromEntries(this.sessions)),
      ),
    );
  }

  /** Write everything that has a pending debounce timer, and wait for in-flight writes. */
  async flush() {
    for (const [key, t] of this.timers) {
      clearTimeout(t);
      this.timers.delete(key);
      if (key === '__sessions') this.#saveSessions();
      else this.saveNow(key);
    }
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  // ---------- sessions ----------
  createSession(now = Date.now()) {
    const token = randomBytes(24).toString('base64url');
    this.sessions.set(token, { createdAt: now });
    this.#scheduleSessionsSave();
    return token;
  }

  hasSession(token) {
    return typeof token === 'string' && this.sessions.has(token);
  }

  // ---------- rooms ----------
  #newCode() {
    const used = new Set([...this.rooms.values()].map((r) => r.code));
    for (;;) {
      let code = '';
      for (let i = 0; i < 6; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!used.has(code)) return code;
    }
  }

  createRoom(config, now = Date.now()) {
    let id;
    do id = randomBytes(4).toString('hex');
    while (this.rooms.has(id));
    const room = {
      id,
      code: this.#newCode(),
      status: 'lobby',
      config: structuredClone(config),
      players: [],
      characters: [],
      turn: null,
      log: [{ at: now, type: 'system', text: '방이 생성되었습니다.' }],
      seed: randomInt(2 ** 32 - 1),
      version: 1,
      nextPlayerSeq: 0,
      nextCharSeq: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.rooms.set(id, room);
    this.scheduleSave(id);
    return room;
  }

  getRoom(id) {
    return this.rooms.get(id) || null;
  }

  findByCode(code) {
    if (typeof code !== 'string') return null;
    const c = code.trim().toUpperCase();
    for (const r of this.rooms.values()) if (r.code === c) return r;
    return null;
  }

  listRooms() {
    return [...this.rooms.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Replace a room with its next state (from a pure rule function), persist
   * (debounced), and push `state` (+ `log` entries) to every subscriber.
   */
  commit(room, logs = [], now = Date.now(), events = null) {
    if (!this.rooms.has(room.id)) throw new Error(`unknown room ${room.id}`);
    room.version = (this.rooms.get(room.id).version || 0) + 1;
    room.updatedAt = now;
    this.rooms.set(room.id, room);
    this.scheduleSave(room.id);
    this.broadcastState(room.id);
    for (const entry of logs) this.broadcast(room.id, 'log', entry);
    // Engine events (for animation/audio). Public by construction: engine events never carry secrets.
    if (events?.length) this.broadcast(room.id, 'events', { version: room.version, events });
    return room;
  }

  /**
   * Run a pure rule function against the current room and commit its result.
   * `fn(room) → { ok, room, logs?, events? } | { ok: false, status, error }`. Synchronous, so no
   * other request can interleave between read and write.
   */
  transact(roomId, fn, now = Date.now()) {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, status: 404, error: '방을 찾을 수 없습니다.' };
    const r = fn(room);
    if (!r?.ok) return r;
    this.commit(r.room, r.logs ?? [], now, r.events ?? null);
    return r;
  }

  /** Replace a room silently (persist, no broadcast) — e.g. lastSeen bumps. */
  put(room) {
    if (!this.rooms.has(room.id)) throw new Error(`unknown room ${room.id}`);
    this.rooms.set(room.id, room);
    this.scheduleSave(room.id);
    return room;
  }

  async deleteRoom(id) {
    if (!this.rooms.has(id)) return false;
    this.broadcast(id, 'deleted', { roomId: id });
    for (const sub of this.subs.get(id) ?? []) sub.res.end();
    this.subs.delete(id);
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this.rooms.delete(id);
    await Promise.all([...this.pending]);
    await rm(path.join(this.savesDir, `${id}.json`), { force: true });
    return true;
  }

  // ---------- SSE ----------
  subscribe(roomId, sessionId, res) {
    if (!this.subs.has(roomId)) this.subs.set(roomId, new Set());
    const sub = { sessionId, res };
    this.subs.get(roomId).add(sub);
    return () => {
      const set = this.subs.get(roomId);
      if (!set) return;
      set.delete(sub);
      if (!set.size) this.subs.delete(roomId);
    };
  }

  subscriberCount(roomId, sessionId) {
    const set = this.subs.get(roomId);
    if (!set) return 0;
    let n = 0;
    for (const s of set) if (sessionId === undefined || s.sessionId === sessionId) n++;
    return n;
  }

  /** Same payload to every subscriber of a room. */
  broadcast(roomId, event, payload) {
    const frame = sseFrame(event, payload);
    for (const sub of this.subs.get(roomId) ?? []) sub.res.write(frame);
  }

  /** Per-session masked `state` snapshot to every subscriber. */
  broadcastState(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    for (const sub of this.subs.get(roomId) ?? []) sub.res.write(sseFrame('state', viewFor(room, sub.sessionId)));
  }

  async close() {
    for (const set of this.subs.values()) for (const sub of set) sub.res.end();
    this.subs.clear();
    await this.flush();
  }
}
