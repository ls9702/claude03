// Side-effect layer around the pure engine: transactions + deadline timers.
// When a pending prompt has `deadlineAt`, a timer dispatches a `timeout` action.
import { EngineError, applyAction, endGame, startGame } from '../game/engine.js';

export class GameRunner {
  constructor(store, { log = () => {}, clock = () => Date.now() } = {}) {
    this.store = store;
    this.log = log;
    this.clock = clock;
    this.timers = new Map(); // roomId -> { timer, promptId }
  }

  /** Admin start: build board + init characters. */
  start(roomId) {
    const now = this.clock();
    const r = this.store.transact(roomId, (room) => startGame(room, { now }), now);
    if (r.ok) this.schedule(r.room);
    return r;
  }

  /** Admin force end (keeps a ranking). */
  end(roomId) {
    const now = this.clock();
    const r = this.store.transact(roomId, (room) => endGame(room, { now }), now);
    if (r.ok) this.#clear(roomId);
    return r;
  }

  /**
   * Run one engine action inside a store transaction.
   * @returns {{ok:true, room, events} | {ok:false, status, error}}
   */
  dispatch(roomId, action) {
    const now = this.clock();
    const r = this.store.transact(
      roomId,
      (room) => {
        try {
          return { ok: true, ...applyAction(room, action, { now }) };
        } catch (err) {
          if (err instanceof EngineError) return { ok: false, status: err.status, error: err.message };
          throw err;
        }
      },
      now,
    );
    if (r.ok) this.schedule(r.room);
    return r;
  }

  /** (Re)arm the deadline timer for a room's pending prompt. */
  schedule(room) {
    const p = room?.status === 'playing' ? room.turn?.pending : null;
    const cur = this.timers.get(room.id);
    if (cur && p && cur.promptId === p.promptId && cur.deadlineAt === p.deadlineAt) return;
    this.#clear(room.id);
    if (!p?.deadlineAt) return;
    const delay = Math.max(0, p.deadlineAt - this.clock()) + 2;
    const timer = setTimeout(() => {
      this.timers.delete(room.id);
      const live = this.store.getRoom(room.id);
      if (live?.status !== 'playing' || live.turn?.pending?.promptId !== p.promptId) return;
      // Node timers may fire a millisecond before the wall clock reaches deadlineAt → re-arm.
      if (this.clock() < p.deadlineAt) return this.schedule(live);
      const r = this.dispatch(room.id, { type: 'timeout', promptId: p.promptId, actor: { system: true } });
      if (!r.ok) this.log(`타임아웃 처리 실패 (${room.id}): ${r.error}`);
    }, delay);
    timer.unref?.();
    this.timers.set(room.id, { timer, promptId: p.promptId, deadlineAt: p.deadlineAt });
  }

  /** Re-arm timers for every restored room (boot). */
  restore() {
    for (const room of this.store.listRooms()) this.schedule(room);
  }

  #clear(roomId) {
    const cur = this.timers.get(roomId);
    if (cur) clearTimeout(cur.timer);
    this.timers.delete(roomId);
  }

  stop() {
    for (const id of [...this.timers.keys()]) this.#clear(id);
  }
}
