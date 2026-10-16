// Side-effect layer around the pure engine: transactions + deadline timers + the start secret.
// - A pending prompt with `deadlineAt` → a timer dispatches a `timeout` action (default answers).
// - Host turn timer (room config `turnTimeoutSec` > 0): `turn.spinDeadlineAt` → a timer dispatches an
//   automatic `spin` for the current character (actor system).
// - Stage 7: the earliest open trade offer's `expiresAt` → `expireTrades` (when it comes before the above).
// - Stage 9: a finished game's MVP vote → `closeVote` at `result.mvp.closesAt` (also after an admin force end).
// - Stage 9-C: a sibling timer per room plays CPU characters (`ownerSessionId === 'cpu'`): whatever `cpuDue` says
//   the room waits on (an offer to a CPU, a prompt answer owed by a CPU, a CPU's spin) is acted on after
//   `cpuDelayMs` (spin / prompt / trade) with `cpuDecide` and actor `{system: true, cpu: true}`.
import { randomBytes } from 'node:crypto';
import { EngineError, applyAction, endGame, isLoopBoard, migrateLoopBoard, startGame } from '../game/engine.js';
import { CPU_OWNER, cpuDecide, cpuDue } from '../game/cpu.js';

/**
 * Why a restored PLAYING room cannot be run by the engine (Korean), or null (other statuses: null). Checks the shape
 * every game step relies on: characters, a board with eras and a turn with an order.
 */
export function playingRoomProblem(room) {
  if (room?.status !== 'playing') return null;
  if (!Array.isArray(room.characters) || !room.characters.length) return '캐릭터 정보가 없어요';
  if (!room.board || !Array.isArray(room.board.eras) || !room.board.eras.length) return '게임판 정보가 없어요';
  if (!room.turn || !Array.isArray(room.turn.order) || !room.turn.order.length) return '차례 정보가 없어요';
  if (!room.config || typeof room.config !== 'object') return '방 설정이 없어요';
  return null;
}

/** Random uint32 mixed into the RNG after the (public) board is built, so the board can't reveal spins. */
export const randomSecret = () => randomBytes(4).readUInt32LE(0);

/**
 * CPU pacing (ms): a human-watchable delay before a CPU spins (or plays a card), answers a prompt or an offer;
 * `cutin` is added when the action that led there produced a cut-in (`event.cutin`), so screens can show it first.
 */
export const CPU_DELAY_MS = Object.freeze({ spin: 1000, prompt: 800, trade: 800, cutin: 1200 });

/** `cpuDelayMs` option → {spin, prompt, trade, cutin} (a number sets all four; 0 in tests). */
export function cpuDelays(opt) {
  if (Number.isFinite(opt)) return { spin: opt, prompt: opt, trade: opt, cutin: opt };
  return { ...CPU_DELAY_MS, ...(opt && typeof opt === 'object' ? opt : {}) };
}

export class GameRunner {
  constructor(store, { log = () => {}, clock = () => Date.now(), secret = randomSecret, cpuDelayMs = CPU_DELAY_MS } = {}) {
    this.store = store;
    this.log = log;
    this.clock = clock;
    this.secret = secret;
    this.timers = new Map(); // roomId -> { timer, key }
    this.cpuTimers = new Map(); // roomId -> { timer, key } (Stage 9-C)
    this.cpuDelay = cpuDelays(cpuDelayMs);
    this.broken = new Map(); // roomId -> Korean reason: a restored save the engine cannot run (no timers / actions)
    // a deleted room (admin / TTL prune) drops its deadline + CPU timers
    store.onRoomDeleted?.((roomId) => {
      this.#clear(roomId);
      this.#clearCpu(roomId);
    });
  }

  /**
   * `store.transact` that never throws: an unexpected engine error (a bug, a damaged save) is logged and answered
   * with 500 — it must not escape into a timer callback (CPU / deadline), where it would take the server down.
   */
  #transact(roomId, label, fn, now) {
    try {
      return this.store.transact(roomId, fn, now);
    } catch (err) {
      this.log(`게임 처리 중 오류 (방 ${roomId}, ${label}): ${err?.stack ?? err}`);
      return { ok: false, status: 500, error: '게임을 처리하다 오류가 났어요. 관리자에게 알려 주세요.' };
    }
  }

  /** A broken restored room (see `restore`) refuses every game step with this result. */
  #brokenFail(roomId) {
    return { ok: false, status: 409, error: `이 방은 저장 파일이 손상돼서 진행할 수 없어요. 관리자가 삭제해 주세요. (${this.broken.get(roomId)})` };
  }

  /** Why a restored room cannot run (Korean), or null. */
  brokenReason(roomId) {
    return this.broken.get(roomId) ?? null;
  }

  /** Admin start: build board + init characters. */
  start(roomId) {
    const now = this.clock();
    const r = this.#transact(roomId, 'start', (room) => startGame(room, { now, secret: this.secret() }), now);
    if (r.ok) {
      this.broken.delete(roomId);
      this.schedule(r.room, r.events);
    }
    return r;
  }

  /** Admin force end (keeps a ranking). A broken room cannot be ranked: the admin deletes it instead. */
  end(roomId) {
    if (this.broken.has(roomId)) return this.#brokenFail(roomId);
    const now = this.clock();
    const r = this.#transact(roomId, 'end', (room) => endGame(room, { now }), now);
    if (r.ok) {
      this.#clear(roomId);
      this.#clearCpu(roomId);
      this.schedule(r.room); // Stage 9: the MVP vote of the forced result closes on its timer
    }
    return r;
  }

  /**
   * Run one engine action inside a store transaction.
   * @returns {{ok:true, room, events} | {ok:false, status, error}}
   */
  dispatch(roomId, action) {
    if (this.broken.has(roomId)) return this.#brokenFail(roomId);
    const now = this.clock();
    const r = this.#transact(
      roomId,
      String(action?.type),
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
    if (r.ok) this.schedule(r.room, r.events);
    return r;
  }

  /**
   * What the room is waiting on with a deadline: a prompt, or (turn timer) the current spin — or, when earlier,
   * the first open trade offer to expire (Stage 7).
   */
  static deadlineOf(room) {
    // Stage 9: a finished game waits on its MVP vote (closesAt → `closeVote`)
    const mvp = room?.status === 'finished' ? room.result?.mvp : null;
    if (mvp && !mvp.closed && mvp.closesAt) return { kind: 'vote', at: mvp.closesAt, key: `v:${mvp.closesAt}` };
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
  schedule(room, events = null) {
    if (!room || this.broken.has(room.id)) return;
    this.scheduleCpu(room, events);
    const d = GameRunner.deadlineOf(room);
    const cur = this.timers.get(room.id);
    if (cur && d && cur.key === d.key) return;
    this.#clear(room.id);
    if (!d) return;
    const delay = Math.max(0, d.at - this.clock()) + 2;
    const timer = setTimeout(() => {
      this.timers.delete(room.id);
      try {
        this.#fireDeadline(room.id, d);
      } catch (err) {
        this.log(`시간 제한 처리 중 오류 (방 ${room.id}): ${err?.stack ?? err}`); // never escapes the timer
      }
    }, delay);
    timer.unref?.();
    this.timers.set(room.id, { timer, key: d.key });
  }

  #fireDeadline(roomId, d) {
    const live = this.store.getRoom(roomId);
    if (GameRunner.deadlineOf(live)?.key !== d.key) return;
    // Node timers may fire a millisecond before the wall clock reaches the deadline → re-arm.
    if (this.clock() < d.at) return this.schedule(live);
    const action =
      d.kind === 'prompt'
        ? { type: 'timeout', promptId: d.promptId, actor: { system: true } }
        : d.kind === 'vote'
          ? { type: 'closeVote', actor: { system: true } }
          : d.kind === 'trades'
            ? { type: 'expireTrades', actor: { system: true } }
            : { type: 'spin', characterId: live.turn.order[live.turn.currentIndex], auto: true, actor: { system: true } };
    const r = this.dispatch(roomId, action);
    if (!r.ok) this.log(`${{ prompt: '타임아웃', trades: '거래 만료', spin: '자동 룰렛', vote: 'MVP 투표 마감' }[d.kind]} 처리 실패 (${roomId}): ${r.error}`);
  }

  /** (Re)arm the CPU timer of a room: act for the CPU the room waits on after the pacing delay. */
  scheduleCpu(room, events = null) {
    if (!room || this.broken.has(room.id)) return;
    const due = cpuDue(room);
    const cur = this.cpuTimers.get(room.id);
    if (cur && due && cur.key === due.key) return;
    this.#clearCpu(room.id);
    if (!due) return;
    const extra = events?.some((e) => e.cutin) ? this.cpuDelay.cutin ?? 0 : 0;
    const timer = setTimeout(() => {
      this.cpuTimers.delete(room.id);
      this.runCpu(room.id, due.key);
    }, Math.max(0, (this.cpuDelay[due.kind] ?? 0) + extra));
    timer.unref?.();
    this.cpuTimers.set(room.id, { timer, key: due.key });
  }

  /**
   * Play the awaited CPU step now (if `key` is given, only while the room still waits on it). A refused
   * heuristic action falls back to a safe one (the prompt default / a plain spin / reject) so a CPU never stalls.
   * @returns the dispatch result | null
   */
  runCpu(roomId, key = null) {
    try {
      return this.#runCpu(roomId, key);
    } catch (err) {
      // a heuristic bug must never escape into the timer callback (it would stop the server)
      this.log(`CPU 처리 중 오류 (방 ${roomId}): ${err?.stack ?? err}`);
      return null;
    }
  }

  #runCpu(roomId, key) {
    const live = this.store.getRoom(roomId);
    const due = cpuDue(live);
    if (!due || (key && due.key !== key)) {
      if (live) this.scheduleCpu(live);
      return null;
    }
    const c = live.characters.find((x) => x.id === due.charId);
    if (c?.ownerSessionId !== CPU_OWNER) return null;
    const actor = { system: true, cpu: true };
    const action = cpuDecide(live, due.charId);
    let r = action ? this.dispatch(roomId, { ...action, actor }) : null;
    if (r?.ok) return r;
    const fallback = this.#cpuFallback(live, due);
    if (fallback) r = this.dispatch(roomId, { ...fallback, actor });
    if (!r?.ok) this.log(`CPU 행동 실패 (${roomId}, ${due.charId}): ${r?.error ?? '행동 없음'}`);
    return r;
  }

  #cpuFallback(room, due) {
    if (due.kind === 'trade') {
      const t = room.trades.find((x) => x.toId === due.charId);
      return t ? { type: 'respondTrade', characterId: due.charId, tradeId: t.id, accept: false } : null;
    }
    if (due.kind === 'prompt') {
      const p = room.turn.pending;
      const opt = p.options.find((o) => o.id === p.defaultOptionId && !o.disabled) ?? p.options.find((o) => !o.disabled);
      return { type: 'choose', characterId: due.charId, promptId: p.promptId, optionId: opt?.id ?? p.defaultOptionId };
    }
    return { type: 'spin', characterId: due.charId };
  }

  /**
   * Re-arm timers for every restored room (boot). Games saved before the loop maps (linear board) are migrated first
   * (engine `migrateLoopBoard`: rebuilt loop board, everyone at the most advanced era's start).
   */
  restore() {
    for (const room of this.store.listRooms()) {
      try {
        const problem = playingRoomProblem(room);
        if (problem) throw new Error(problem);
        if (room.status === 'playing' && !isLoopBoard(room.board)) {
          const now = this.clock();
          const r = this.store.transact(room.id, (live) => ({ ok: true, ...migrateLoopBoard(live, { now }) }), now);
          if (r.ok) this.log(`순환 맵으로 옮긴 방: ${room.id}`);
        }
        this.schedule(this.store.getRoom(room.id) ?? room);
      } catch (err) {
        // one damaged save must not stop the server from booting: the room stays listed (the admin can delete it)
        // but gets no timers and refuses game actions
        const reason = String(err?.message ?? err).slice(0, 200);
        this.broken.set(room.id, reason);
        this.#clear(room.id);
        this.#clearCpu(room.id);
        this.log(`방 ${room.id}을(를) 복원하지 못해 멈춰 둡니다 (관리자 화면에서 삭제할 수 있어요): ${reason}`);
      }
    }
  }

  #clear(roomId) {
    const cur = this.timers.get(roomId);
    if (cur) clearTimeout(cur.timer);
    this.timers.delete(roomId);
  }

  #clearCpu(roomId) {
    const cur = this.cpuTimers.get(roomId);
    if (cur) clearTimeout(cur.timer);
    this.cpuTimers.delete(roomId);
  }

  stop() {
    for (const id of [...this.timers.keys()]) this.#clear(id);
    for (const id of [...this.cpuTimers.keys()]) this.#clearCpu(id);
  }
}
