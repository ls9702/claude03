// Idle-time step runner for the 3D board (pure: the scheduler and clock are injected → node-tested).
//
// The next era's static board is built in small steps (layout, props plan, ground, roads, tiles, markers, icons, props
// mesh, labels) during idle time so the era transition only swaps a finished group in. `flush()` runs whatever is
// left synchronously (a transition that arrives before the prebuild finished), `cancel()` drops the job.
//
//   const job = runSteps([{ name, fn }, …], { schedule: (cb) => requestIdleCallback(cb, { timeout: 500 }) });
//   await job.promise;   // true when every step ran, false when cancelled

/**
 * @param {{name: string, fn: () => void}[]} steps
 * @param {{ schedule?: (cb: (deadline?: {timeRemaining?: () => number, didTimeout?: boolean}) => void) => any,
 *           now?: () => number, sliceMs?: number }} [o]
 *   `schedule` = idle scheduler (requestIdleCallback / setTimeout); `sliceMs` = keep running further steps in the same
 *   idle slice while the deadline still has more than this many ms left (never after a timed-out callback)
 * @returns {{ promise: Promise<boolean>, flush: () => void, cancel: () => void, readonly done: boolean,
 *             readonly cancelled: boolean, readonly next: number, times: {name: string, ms: number}[], slices: number }}
 */
export function runSteps(steps, { schedule = (cb) => setTimeout(() => cb(null), 0), now = () => Date.now(), sliceMs = 12 } = {}) {
  let i = 0;
  let done = false;
  let cancelled = false;
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  const job = {
    promise,
    times: [],
    slices: 0,
    get done() {
      return done;
    },
    get cancelled() {
      return cancelled;
    },
    get next() {
      return i;
    },
    flush() {
      if (done || cancelled) return;
      while (i < steps.length) runOne();
      finish();
    },
    cancel() {
      if (done || cancelled) return;
      cancelled = true;
      resolve(false);
    },
  };
  function runOne() {
    const s = steps[i++];
    const t0 = now();
    s.fn();
    job.times.push({ name: s.name, ms: now() - t0 });
  }
  function finish() {
    if (done) return;
    done = true;
    resolve(true);
  }
  function slice(deadline) {
    if (done || cancelled) return;
    job.slices++;
    runOne();
    while (i < steps.length && deadline && !deadline.didTimeout && typeof deadline.timeRemaining === 'function' && deadline.timeRemaining() > sliceMs) runOne();
    if (i >= steps.length) finish();
    else schedule(slice);
  }
  if (!steps.length) finish();
  else schedule(slice);
  return job;
}

/** Longest single step and the sum of a job's step times (ms). */
export function stepStats(times = []) {
  let total = 0;
  let max = 0;
  let maxName = null;
  for (const t of times) {
    total += t.ms;
    if (t.ms > max) {
      max = t.ms;
      maxName = t.name;
    }
  }
  return { total, max, maxName, steps: times.length };
}
