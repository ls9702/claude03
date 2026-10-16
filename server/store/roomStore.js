// In-memory room store + debounced JSON snapshots + SSE subscriber registry.
import { randomBytes, randomInt } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { boardKeyOf, viewFor } from '../game/view.js';
import { migrateRoomLooks } from '../game/avatar.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const ROOM_ID_RE = /^[a-f0-9]{8,32}$/;
/** Player sessions unused for this long and not in any room are pruned (boot + hourly). */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_PRUNE_INTERVAL_MS = 60 * 60 * 1000;
/** Open SSE streams per session per room; a new one closes the oldest beyond this (it gets `superseded` first). */
export const MAX_STREAMS_PER_SESSION = 3;
/** A snapshot is written at least this often while commits keep arriving faster than the debounce. */
export const SAVE_MAX_WAIT_MS = 2000;
/** An SSE stream whose unsent buffer grows past this (a client that stopped reading) is dropped. */
export const SSE_MAX_BUFFERED_BYTES = 1.5 * 1024 * 1024;
const TOUCH_SAVE_MS = 60 * 60 * 1000; // persist lastSeenAt at most hourly per session
const DAY_MS = 24 * 60 * 60 * 1000;
/** Finished rooms are deleted (memory + save file) this long after the game ended (env FINISHED_ROOM_TTL_MS). */
export const FINISHED_ROOM_TTL_MS = 3 * DAY_MS;
/** Lobby rooms nobody touched for this long are deleted too (env LOBBY_ROOM_TTL_MS). Playing rooms never expire. */
export const LOBBY_ROOM_TTL_MS = 7 * DAY_MS;

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** Why a saved room file cannot even be listed (Korean), or null. A playing room the engine cannot run is still
 *  listed — GameRunner.restore marks it broken (no timers, the admin can delete it). */
export function savedRoomProblem(room) {
  if (!Array.isArray(room.players) || !room.players.every(isPlainObject)) return '참가자 목록이 올바르지 않아요';
  if (room.characters != null && (!Array.isArray(room.characters) || !room.characters.every(isPlainObject))) return '캐릭터 목록이 올바르지 않아요';
  if (!['lobby', 'playing', 'finished'].includes(room.status)) return '방 상태가 올바르지 않아요';
  return null;
}

/** Fill the fields every view / admin row reads (old or hand-edited saves). Mutates. */
export function normalizeSavedRoom(room) {
  room.characters ??= [];
  if (!Array.isArray(room.log)) room.log = [];
  if (!isPlainObject(room.config)) room.config = {};
  if (typeof room.code !== 'string') room.code = '';
  room.createdAt = Number.isFinite(room.createdAt) ? room.createdAt : 0;
  room.version = Number.isFinite(room.version) ? room.version : 1;
  return room;
}

export function sseFrame(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * The `state` frame for one SSE stream (`sub` = {sessionId, boardKey}). The static board goes out only when this stream
 * has not got that `boardKey` yet (first frame, game start, a board migration); otherwise the payload has `boardKey`
 * but no `board` key and the client re-attaches its cached board (public/js/api.js `attachBoard`). Updates
 * `sub.boardKey`.
 */
export function stateFrame(room, sub) {
  const key = boardKeyOf(room);
  const withBoard = key == null || sub.boardKey !== key;
  const view = viewFor(room, sub.sessionId, { board: withBoard });
  sub.boardKey = key;
  return sseFrame('state', view);
}

export class RoomStore {
  constructor({
    dataDir,
    debounceMs = 300,
    maxWaitMs = SAVE_MAX_WAIT_MS,
    maxBufferedBytes = SSE_MAX_BUFFERED_BYTES,
    log = () => {},
    sessionTtlMs = SESSION_TTL_MS,
    maxStreamsPerSession = MAX_STREAMS_PER_SESSION,
    clock = () => Date.now(),
    finishedRoomTtlMs = FINISHED_ROOM_TTL_MS,
    lobbyRoomTtlMs = LOBBY_ROOM_TTL_MS,
  } = {}) {
    if (!dataDir) throw new Error('dataDir required');
    this.dataDir = dataDir;
    this.savesDir = path.join(dataDir, 'saves');
    this.debounceMs = debounceMs;
    this.maxWaitMs = maxWaitMs; // ≤ 0 / null = no max wait (pure debounce)
    this.maxBufferedBytes = maxBufferedBytes; // ≤ 0 / null = never drop slow SSE streams
    this.firstScheduled = new Map(); // key -> clock() of the first unsaved change (max-wait anchor)
    this.log = log;
    this.sessionTtlMs = sessionTtlMs;
    this.maxStreamsPerSession = maxStreamsPerSession;
    this.clock = clock;
    this.rooms = new Map();
    this.sessions = new Map(); // token -> { createdAt, lastSeenAt }
    this.subs = new Map(); // roomId -> Set<{ sessionId, res, at }>
    this.timers = new Map(); // roomId | '__sessions' -> Timeout
    this.pending = new Set(); // in-flight write promises
    this.chains = new Map(); // file -> Promise (writes to one file are strictly ordered)
    this.pruneTimer = null;
    this.finishedRoomTtlMs = finishedRoomTtlMs; // ≤ 0 / null = keep forever
    this.lobbyRoomTtlMs = lobbyRoomTtlMs;
    this.deleteListeners = new Set(); // (roomId) => void — e.g. the game runner drops its timers
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
        if (!room || typeof room !== 'object' || !ROOM_ID_RE.test(room.id)) continue;
        const problem = savedRoomProblem(room);
        if (problem) {
          this.log(`방 복원 실패 (${file}): ${problem} — 이 저장 파일은 건너뜁니다.`);
          continue;
        }
        normalizeSavedRoom(room);
        for (const p of room.players) p.connected = false;
        migrateRoomLooks(room); // CH-1: human avatars → roster characters, partners → NPC friends, children → pets
        this.rooms.set(room.id, room);
      } catch (err) {
        this.log(`방 복원 실패 (${file}): ${err.message}`);
      }
    }
    const rooms = await this.pruneRooms();
    if (rooms) this.log(`기한이 지난 방 ${rooms}개를 정리했습니다.`);
    const pruned = this.pruneSessions();
    if (pruned) this.log(`오래된 세션 ${pruned}개를 정리했습니다.`);
    return this;
  }

  /**
   * Atomic JSON write, chained per file: the snapshot is serialized NOW and written after every earlier
   * write of the same file finished, so an older snapshot can never overwrite a newer one.
   */
  #writeJson(file, data) {
    const body = JSON.stringify(data, null, 1);
    const prev = this.chains.get(file) ?? Promise.resolve();
    const run = prev
      .catch(() => {})
      .then(async () => {
        await mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`;
        await writeFile(tmp, body);
        await rename(tmp, file);
      });
    const tail = run.catch(() => {});
    this.chains.set(file, tail);
    tail.then(() => {
      if (this.chains.get(file) === tail) this.chains.delete(file);
    });
    return run;
  }

  #track(promise) {
    const p = promise.catch((err) => this.log(`저장 실패: ${err.message}`)).finally(() => this.pending.delete(p));
    this.pending.add(p);
    return p;
  }

  /**
   * Debounce `save` under `key`: it runs `debounceMs` after the last call, but at most `maxWaitMs` after the first
   * unsaved one — a room committing faster than the debounce (fast CPU turns) is still written every couple of seconds.
   */
  #debounce(key, save) {
    if (this.closed) return; // shutdown: late presence updates (SSE closing) are not persisted
    clearTimeout(this.timers.get(key));
    const now = this.clock();
    if (!this.firstScheduled.has(key)) this.firstScheduled.set(key, now);
    let delay = this.debounceMs;
    if (Number.isFinite(this.maxWaitMs) && this.maxWaitMs > 0) delay = Math.max(0, Math.min(delay, this.firstScheduled.get(key) + this.maxWaitMs - now));
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        this.firstScheduled.delete(key);
        save();
      }, delay),
    );
  }

  scheduleSave(roomId) {
    this.#debounce(roomId, () => this.saveNow(roomId));
  }

  saveNow(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return Promise.resolve();
    return this.#track(this.#writeJson(path.join(this.savesDir, `${roomId}.json`), room));
  }

  #scheduleSessionsSave() {
    this.#debounce('__sessions', () => this.#saveSessions());
  }

  #saveSessions() {
    return this.#track(this.#writeJson(path.join(this.dataDir, 'sessions.json'), Object.fromEntries(this.sessions)));
  }

  /** Write everything that has a pending debounce timer, and wait for in-flight writes. */
  async flush() {
    for (const [key, t] of this.timers) {
      clearTimeout(t);
      this.timers.delete(key);
      this.firstScheduled.delete(key);
      if (key === '__sessions') this.#saveSessions();
      else this.saveNow(key);
    }
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  // ---------- sessions ----------
  createSession(now = this.clock()) {
    const token = randomBytes(24).toString('base64url');
    this.sessions.set(token, { createdAt: now, lastSeenAt: now });
    this.#scheduleSessionsSave();
    return token;
  }

  /** Valid token? Also bumps its lastSeenAt (persisted at most hourly). */
  hasSession(token, now = this.clock()) {
    if (typeof token !== 'string') return false;
    const s = this.sessions.get(token);
    if (!s) return false;
    const last = s.lastSeenAt ?? s.createdAt ?? 0;
    if (now - last >= TOUCH_SAVE_MS) {
      s.lastSeenAt = now;
      this.#scheduleSessionsSave();
    } else if (now > last) s.lastSeenAt = now;
    return true;
  }

  /** Drop sessions unused for `sessionTtlMs` that are not a player of any room. Returns the count. */
  pruneSessions(now = this.clock()) {
    const members = new Set();
    for (const r of this.rooms.values()) for (const p of r.players) members.add(p.sessionId);
    let n = 0;
    for (const [token, s] of this.sessions) {
      const last = s?.lastSeenAt ?? s?.createdAt ?? 0;
      if (now - last >= this.sessionTtlMs && !members.has(token)) {
        this.sessions.delete(token);
        n++;
      }
    }
    if (n) this.#scheduleSessionsSave();
    return n;
  }

  /** Prune expired rooms, then sessions, every `intervalMs` (unref'd; stopped by close()). */
  startPruning(intervalMs = SESSION_PRUNE_INTERVAL_MS) {
    clearInterval(this.pruneTimer);
    this.pruneTimer = setInterval(() => this.pruneAll(), intervalMs);
    this.pruneTimer.unref?.();
  }

  /** One hourly pass: expired rooms (memory + save file), then unused sessions. @returns {rooms, sessions} */
  async pruneAll(now = this.clock()) {
    const rooms = await this.pruneRooms(now);
    if (rooms) this.log(`기한이 지난 방 ${rooms}개를 정리했습니다.`);
    const sessions = this.pruneSessions(now);
    if (sessions) this.log(`오래된 세션 ${sessions}개를 정리했습니다.`);
    return { rooms, sessions };
  }

  /**
   * When a room will be deleted by the prune (ms epoch), or null: finished rooms `finishedRoomTtlMs` after the
   * game ended, lobby rooms `lobbyRoomTtlMs` after their last activity (room update / player seen); playing rooms
   * never.
   */
  roomExpiresAt(room) {
    if (!room) return null;
    const ttlOf = (ms) => (Number.isFinite(ms) && ms > 0 ? ms : null);
    if (room.status === 'finished') {
      const ttl = ttlOf(this.finishedRoomTtlMs);
      const endedAt = room.finishedAt ?? room.result?.finishedAt ?? room.updatedAt ?? room.createdAt ?? 0;
      return ttl ? endedAt + ttl : null;
    }
    if (room.status === 'lobby') {
      const ttl = ttlOf(this.lobbyRoomTtlMs);
      const seen = Math.max(room.updatedAt ?? 0, room.createdAt ?? 0, ...(room.players ?? []).map((p) => p.lastSeen ?? 0));
      return ttl ? seen + ttl : null;
    }
    return null;
  }

  /** Delete every room past `roomExpiresAt` (subscribers get `deleted`). @returns the count */
  async pruneRooms(now = this.clock()) {
    const expired = [...this.rooms.values()].filter((r) => {
      const at = this.roomExpiresAt(r);
      return at != null && at <= now;
    });
    for (const r of expired) await this.deleteRoom(r.id);
    return expired.length;
  }

  /** Listen for room deletions (admin delete / TTL prune). @returns unsubscribe */
  onRoomDeleted(fn) {
    this.deleteListeners.add(fn);
    return () => this.deleteListeners.delete(fn);
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
    this.firstScheduled.delete(id);
    this.rooms.delete(id);
    for (const fn of this.deleteListeners) {
      try {
        fn(id);
      } catch (err) {
        this.log(`방 삭제 알림 실패: ${err.message}`);
      }
    }
    await Promise.all([...this.pending]);
    await rm(path.join(this.savesDir, `${id}.json`), { force: true });
    return true;
  }

  // ---------- SSE ----------
  /**
   * Register an SSE response for a room. `opts.state` = write the current `state` first (through `stateFrame`, so the
   * stream's board cache starts here). Streams beyond `maxStreamsPerSession` for this session: the oldest gets
   * `superseded {roomId, reason: 'tabs', max}` and is ended (the client must not auto-reconnect — public/js/api.js
   * stops its EventSource on that event; reconnecting would evict the next tab, a ping-pong).
   * @returns {() => void} unsubscribe
   */
  subscribe(roomId, sessionId, res, opts = {}) {
    if (!this.subs.has(roomId)) this.subs.set(roomId, new Set());
    const set = this.subs.get(roomId);
    // Cap streams per session per room: close the oldest (tabs left open, reconnect storms).
    const mine = [...set].filter((s) => s.sessionId === sessionId);
    for (const old of mine.slice(0, Math.max(0, mine.length - this.maxStreamsPerSession + 1))) {
      set.delete(old);
      try {
        old.res.write(sseFrame('superseded', { roomId, reason: 'tabs', max: this.maxStreamsPerSession }));
        old.res.end();
      } catch {
        /* already closed */
      }
    }
    const sub = { sessionId, res, boardKey: undefined };
    set.add(sub);
    if (opts.state) {
      const room = this.rooms.get(roomId);
      if (room) this.#send(roomId, sub, stateFrame(room, sub));
    }
    return () => {
      const set = this.subs.get(roomId);
      if (!set) return;
      set.delete(sub);
      if (!set.size) this.subs.delete(roomId);
    };
  }

  /**
   * Write one frame to a subscriber. A client that stopped reading (frozen tab, dead link that still looks open) makes
   * Node buffer every frame in memory: past `maxBufferedBytes` unsent the stream is dropped (destroyed; the route's
   * close handler unsubscribes and updates presence). A live client's EventSource reconnects and gets a fresh state.
   * @returns {boolean} false when the stream was dropped
   */
  #send(roomId, sub, frame) {
    try {
      sub.res.write(frame);
    } catch {
      /* closed under us */
    }
    const limit = this.maxBufferedBytes;
    if (!(Number.isFinite(limit) && limit > 0) || !((sub.res.writableLength ?? 0) > limit)) return true;
    this.subs.get(roomId)?.delete(sub);
    if (this.subs.get(roomId)?.size === 0) this.subs.delete(roomId);
    this.log(`느린 SSE 연결을 끊었습니다 (방 ${roomId}, 밀린 데이터 ${Math.round(sub.res.writableLength / 1024)}KB).`);
    try {
      if (typeof sub.res.destroy === 'function') sub.res.destroy();
      else sub.res.end();
    } catch {
      /* already gone */
    }
    return false;
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
    for (const sub of [...(this.subs.get(roomId) ?? [])]) this.#send(roomId, sub, frame);
  }

  /** Per-session masked `state` snapshot to every subscriber (the board only to streams without its key). */
  broadcastState(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    for (const sub of [...(this.subs.get(roomId) ?? [])]) this.#send(roomId, sub, stateFrame(room, sub));
  }

  async close() {
    this.closed = true;
    clearInterval(this.pruneTimer);
    this.pruneTimer = null;
    for (const set of this.subs.values()) for (const sub of set) sub.res.end();
    this.subs.clear();
    await this.flush();
  }
}
