// Side-effect layer of the AI character art (Stage 5.5-D): per-room job queue, room-state updates and SSE.
//
// Room state: character.art = {key, status: 'pending'|'ready'|'failed', progress: 0..1, reason?, files?}
// (see server/assets/charArt.js for the files contract) and character.artGenerations (successful player
// requests). Request limits count every non-cached generation REQUEST at request time (a cancelled, edited
// away or failed job still counts): `room.artRequests = {[sessionId]: n}` (survives character delete /
// recreate), `character.artRequests` and `room.artRequestTotal` (room cap). Admins bypass the per-session /
// per-character limits; `force` also bypasses the room cap. Progress is committed at most once per
// `throttleMs` per room (SSE `state`), and every step also sends a lightweight SSE `charArt {charId, status,
// progress}`.
import { MSG } from '../assets/charArt.js';
import { getBalance } from '../data/index.js';

/** Request limits (balance.json `charArt`): counted per REQUEST (not per success), cancelled/failed included. */
export const ART_LIMIT_DEFAULTS = { perSession: 2, perCharacter: 1, perRoom: 8 };
export function artLimits(balance = getBalance()) {
  return { ...ART_LIMIT_DEFAULTS, ...(balance?.charArt ?? {}) };
}

const clone = (x) => structuredClone(x);

export class CharArtRunner {
  /**
   * @param {import('./roomStore.js').RoomStore} store
   * @param {ReturnType<import('../assets/charArt.js').createCharArtService>} service
   */
  constructor(store, service, { log = () => {}, throttleMs = 1000, limits = null } = {}) {
    this.store = store;
    this.limitOverrides = limits; // tests; default = balance.json charArt
    this.service = service;
    this.log = log;
    this.throttleMs = throttleMs;
    this.queues = new Map(); // roomId → Promise chain (max 1 running job per room)
    this.active = new Map(); // `${roomId}/${charId}` → {key, detach}
    this.patches = new Map(); // roomId → Map<charId, art>
    this.lastCommit = new Map(); // roomId → ms
    this.timers = new Map(); // roomId → Timeout
    this.stopped = false;
  }

  /** Feature flag: a Gemini key is configured. */
  async enabled() {
    try {
      return Boolean(await this.service.hasKey());
    } catch {
      return false;
    }
  }

  /** Boot: jobs do not survive a restart → pending becomes failed (no auto-resume). */
  restore() {
    for (const room of this.store.listRooms()) {
      if (!room.characters.some((c) => c.art?.status === 'pending')) continue;
      const next = clone(room);
      for (const c of next.characters) if (c.art?.status === 'pending') c.art = { key: c.art.key, status: 'failed', progress: c.art.progress ?? 0, reason: MSG.restart };
      this.store.put(next);
    }
  }

  /**
   * Reconcile a character's art with its (possibly changed) avatar inside a room about to be committed
   * (mutates `room`, which must be a fresh clone): an unchanged avatar keeps its art; a changed one cancels
   * the running job and becomes `ready` instantly when the new look is cached, else art is cleared.
   */
  syncCharacter(room, charId) {
    const c = room.characters.find((x) => x.id === charId);
    if (!c) return this.cancel(room.id, charId);
    const key = this.service.keyFor(c.avatar);
    if (c.art?.key === key) return;
    this.cancel(room.id, charId);
    const hit = this.service.cached(key);
    if (hit) c.art = { key, status: 'ready', progress: 1, files: hit.files };
    else delete c.art;
  }

  /** Stop listening to a character's job (deleted / edited character). Unshared jobs stop after the step. */
  cancel(roomId, charId) {
    const id = `${roomId}/${charId}`;
    const a = this.active.get(id);
    if (!a) return;
    this.active.delete(id);
    a.detach();
    this.patches.get(roomId)?.delete(charId);
  }

  /**
   * Request the art for a character (route layer checks auth: owner / admin).
   * @returns {Promise<{ok: true, room, art} | {ok: false, status, error}>}
   */
  async request(roomId, charId, { admin = false, force = false, sessionId = null } = {}) {
    if (!(await this.enabled())) return { ok: false, status: 409, error: MSG.noKey };
    const room = this.store.getRoom(roomId);
    if (!room) return { ok: false, status: 404, error: '방을 찾을 수 없습니다.' };
    const c = room.characters.find((x) => x.id === charId);
    if (!c) return { ok: false, status: 404, error: '캐릭터를 찾을 수 없습니다.' };
    const key = this.service.keyFor(c.avatar);
    if (c.art?.status === 'pending' && c.art.key === key && this.active.has(`${roomId}/${charId}`)) {
      return { ok: false, status: 409, error: '이미 AI 일러스트를 만드는 중이에요.' };
    }
    const hit = !force && this.service.cached(key);
    if (hit) {
      const art = { key, status: 'ready', progress: 1, files: hit.files };
      return { ok: true, room: this.#setArt(roomId, charId, art, { now: true }), art };
    }
    const limits = { ...artLimits(), ...(this.limitOverrides ?? {}) };
    const owner = sessionId ?? c.ownerSessionId;
    if (!admin) {
      if ((c.artRequests ?? 0) >= limits.perCharacter || (c.artGenerations ?? 0) >= limits.perCharacter) {
        return { ok: false, status: 409, error: 'AI 일러스트는 캐릭터마다 한 번만 만들 수 있어요. 다시 만들려면 관리자에게 문의하세요.' };
      }
      if ((room.artRequests?.[owner] ?? 0) >= limits.perSession) {
        return { ok: false, status: 409, error: `AI 일러스트는 한 사람당 이 방에서 ${limits.perSession}번까지 만들 수 있어요. 더 필요하면 관리자에게 문의하세요.` };
      }
    }
    if (!force && (room.artRequestTotal ?? 0) >= limits.perRoom) {
      return { ok: false, status: 409, error: `이 방의 AI 일러스트 생성 한도(${limits.perRoom}번)를 다 썼어요. 관리자에게 문의하세요.` };
    }
    const art = { key, status: 'pending', progress: 0 };
    const next = this.#setArt(roomId, charId, art, { now: true, count: admin ? { room: true } : { room: true, session: owner } });
    const id = `${roomId}/${charId}`;
    const slot = { key, detach: () => {}, cancelled: false };
    this.active.set(id, slot);
    slot.detach = () => {
      slot.cancelled = true;
    };
    const prev = this.queues.get(roomId) ?? Promise.resolve();
    const run = prev.then(() => this.#run(roomId, charId, key, slot, { admin, force }));
    const tail = run.catch(() => {});
    this.queues.set(roomId, tail);
    tail.then(() => {
      if (this.queues.get(roomId) === tail) this.queues.delete(roomId);
    });
    this.store.broadcast(roomId, 'charArt', { charId, status: 'pending', progress: 0 });
    return { ok: true, room: next, art };
  }

  /** Wait for every queued job (tests / shutdown). */
  async idle() {
    while (this.queues.size) await Promise.all([...this.queues.values()]);
    for (const roomId of [...this.timers.keys()]) this.#flush(roomId);
  }

  stop() {
    this.stopped = true;
    for (const a of this.active.values()) a.detach();
    this.active.clear();
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  // ---------- internals ----------

  async #run(roomId, charId, key, slot, { admin, force }) {
    const id = `${roomId}/${charId}`;
    const current = () => {
      const c = this.store.getRoom(roomId)?.characters.find((x) => x.id === charId);
      return c && c.art?.key === key && this.active.get(id) === slot ? c : null;
    };
    if (slot.cancelled || this.stopped || !current()) return;
    const c = current();
    const handle = this.service.generate(c.avatar, {
      force,
      onProgress: (p) => {
        if (!current()) return slot.detach(); // room / character gone without a cancel → stop listening
        const art = { key, status: 'pending', progress: p.progress };
        this.store.broadcast(roomId, 'charArt', { charId, status: 'pending', progress: p.progress, done: p.done, total: p.total });
        this.#setArt(roomId, charId, art);
      },
    });
    slot.detach = () => {
      slot.cancelled = true;
      handle.detach();
    };
    if (slot.cancelled) handle.detach();
    try {
      const res = await handle.promise;
      if (!current()) return;
      const art = { key, status: 'ready', progress: 1, files: res.files };
      this.#setArt(roomId, charId, art, { bump: !admin && !handle.cached });
      this.store.broadcast(roomId, 'charArt', { charId, status: 'ready', progress: 1 });
      this.log(`[char-art] ${roomId}/${charId} 완성 (${key})`);
    } catch (e) {
      if (!current()) return;
      const reason = e.reasonKo ?? e.message ?? '알 수 없는 오류';
      const progress = this.store.getRoom(roomId)?.characters.find((x) => x.id === charId)?.art?.progress ?? 0;
      this.#setArt(roomId, charId, { key, status: 'failed', progress, reason });
      this.store.broadcast(roomId, 'charArt', { charId, status: 'failed', progress, reason });
      this.log(`[char-art] ${roomId}/${charId} 실패: ${reason}`);
    } finally {
      if (this.active.get(id) === slot) this.active.delete(id);
    }
  }

  /**
   * Queue an art change for a character. Changes the user caused commit right away (`now`); job progress and
   * results are throttled to one commit per `throttleMs` per room (trailing). Returns the room.
   */
  #setArt(roomId, charId, art, { now = false, bump = false, count = null } = {}) {
    if (!this.patches.has(roomId)) this.patches.set(roomId, new Map());
    const map = this.patches.get(roomId);
    const prev = map.get(charId);
    map.set(charId, { art, bump: bump || Boolean(prev?.bump), req: now || Boolean(prev?.req), count: count ?? prev?.count ?? null });
    const wait = this.throttleMs - (Date.now() - (this.lastCommit.get(roomId) ?? 0));
    if (now || wait <= 0) return this.#flush(roomId);
    if (!this.timers.has(roomId)) this.timers.set(roomId, setTimeout(() => this.#flush(roomId), wait));
    return this.store.getRoom(roomId);
  }

  #flush(roomId) {
    clearTimeout(this.timers.get(roomId));
    this.timers.delete(roomId);
    const patches = this.patches.get(roomId);
    this.patches.delete(roomId);
    const room = this.store.getRoom(roomId);
    if (!room || !patches?.size) return room;
    const next = clone(room);
    let changed = false;
    for (const [charId, { art, bump, req, count }] of patches) {
      const c = next.characters.find((x) => x.id === charId);
      // Job updates only apply while the character still shows that job's look (not deleted / edited).
      if (!c || (!req && c.art?.key !== art.key)) continue;
      c.art = art;
      if (bump) c.artGenerations = (c.artGenerations ?? 0) + 1;
      if (count) {
        // Requests are counted when made (a later cancel / failure never refunds them).
        next.artRequestTotal = (next.artRequestTotal ?? 0) + 1;
        if (count.session) {
          c.artRequests = (c.artRequests ?? 0) + 1;
          next.artRequests = { ...(next.artRequests ?? {}), [count.session]: (next.artRequests?.[count.session] ?? 0) + 1 };
        }
      }
      changed = true;
    }
    if (!changed) return room;
    this.lastCommit.set(roomId, Date.now());
    return this.store.commit(next, []);
  }
}
