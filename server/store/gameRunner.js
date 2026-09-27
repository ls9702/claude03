// Side-effect layer around the pure engine: transactions + deadline timers + the start secret.
// - A pending prompt with `deadlineAt` → a timer dispatches a `timeout` action (default answers).
// - Host turn timer (room config `turnTimeoutSec` > 0): `turn.spinDeadlineAt` → a timer dispatches an
//   automatic `spin` for the current character (actor system).
// - Stage 7: the earliest open trade offer's `expiresAt` → `expireTrades` (when it comes before the above).
import { randomBytes } from 'node:crypto';
import { EngineError, applyAction, endGame, startGame } from '../game/engine.js';

/** Random uint32 mixed into the RNG after the (public) board is built, so the board can't reveal spins. */
export const randomSecret = () => randomBytes(4).readUInt32LE(0);

export class GameRunner {
  constructor(store, { log = () => {}, clock = () => Date.now(), secret = randomSecret } = {}) {
    this.store = store;
    this.log = log;
    this.clock = clock;
    this.secret = secret;
    this.timers = new Map(); // roomId -> { timer, key }
  }

  /** Admin start: build board + init characters. */
  start(roomId) {
    const now = this.clock();
    const r = this.store.transact(roomId, (room) => startGame(room, { now, secret: this.secret() }), now);
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

  /**
   * What the room is waiting on with a deadline: a prompt, or (turn timer) the current spin — or, when earlier,
   * the first open trade offer to expire (Stage 7).
   */
  static deadlineOf(room) {
    if (room?.status !== 'playing' || !room.turn) return null;
    let d = null;
    const p = room.turn.pending;
    const t = room.turn;
    if (p) d = p.deadlineAt ? { kind: 'prompt', at: p.deadlineAt, key: `p:${p.promptId}:${p.deadlineAt}`, promptId: p.promptId } : null;
    else if (t.phase === 'awaitSpin' && t.spinDeadlineAt) d = { kind: 'spin', at: t.spinDeadlineAt, key: `s:${t.turnNo}:${t.spinDeadlineAt}`, turnNo: t.turnNo };
    const trade = (room.trades ?? []).reduce((a, x) => (!a || x.expiresAt < a.expiresAt ? x : a), null);
    if (trade && (!d || trade.expiresAt < d.at)) d = { kind: 'trades', at: trade.expiresAt, key: `t:${trade.id}:${trade.expiresAt}` };
    return d;
  }

  /** (Re)arm the deadline timer of a room. */
  schedule(room) {
    if (!room) return;
    const d = GameRunner.deadlineOf(room);
    const cur = this.timers.get(room.id);
    if (cur && d && cur.key === d.key) return;
    this.#clear(room.id);
    if (!d) return;
    const delay = Math.max(0, d.at - this.clock()) + 2;
    const timer = setTimeout(() => {
      this.timers.delete(room.id);
      const live = this.store.getRoom(room.id);
      if (GameRunner.deadlineOf(live)?.key !== d.key) return;
      // Node timers may fire a millisecond before the wall clock reaches the deadline → re-arm.
      if (this.clock() < d.at) return this.schedule(live);
      const action =
        d.kind === 'prompt'
          ? { type: 'timeout', promptId: d.promptId, actor: { system: true } }
          : d.kind === 'trades'
            ? { type: 'expireTrades', actor: { system: true } }
            : { type: 'spin', characterId: live.turn.order[live.turn.currentIndex], auto: true, actor: { system: true } };
      const r = this.dispatch(room.id, action);
      if (!r.ok) this.log(`${{ prompt: '타임아웃', trades: '거래 만료', spin: '자동 룰렛' }[d.kind]} 처리 실패 (${room.id}): ${r.error}`);
    }, delay);
    timer.unref?.();
    this.timers.set(room.id, { timer, key: d.key });
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
