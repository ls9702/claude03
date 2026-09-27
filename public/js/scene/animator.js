// Engine events → sequential animation queue (pure: no three.js / DOM → unit-tested with a fake clock).
//
//   const anim = createAnimator({ handlers: { spun: async (e, ctx) => …, moved, landed, … } });
//   anim.push(events);          // SSE `events` payload; appended while earlier steps still play
//   anim.onIdle(() => …);       // e.g. show the decision modal only after the pawn stopped
//   anim.pause(); anim.resume() // Stage 5: a 2D cut-in takes over the screen between steps
//   anim.enqueue(async () => …) // custom step (cut-in) played in order with the engine events
//
// Handlers get (event, ctx) with ctx = { instant, sleep(ms), step }. A handler may return a Promise
// (blocking step) or nothing (fire-and-forget). `instant` is true when the tab is hidden or the queue
// is backed up, so handlers should snap to their end state.

/** Event types that get their own animation step (in engine order). */
export const ANIMATED_EVENTS = new Set([
  'turnStarted', 'spun', 'betResolved', 'moved', 'eraChanged', 'landed', 'moneyChanged',
  'routeChosen', 'finished', 'bonusSpin', 'gameOver', 'promptResolved',
  // Loop maps: the shared era transition (fade → the new era's map → camera tour)
  'eraTransition',
  // Stage 6: stats / jobs / growth (cut-in anchors play after their board step; stat / salary = floats)
  'statChanged', 'salary', 'jobChanged', 'rankUp', 'hiddenJobUnlocked', 'injured', 'newsFlash', 'militaryStart', 'militaryEnd',
  'educationChanged',
  // Stage 7: cards / items / interaction (pops over the pawn; anchors open their cut-in after the step)
  'cardGained', 'cardUsed', 'cardLost', 'cardBlocked', 'itemBought', 'gift', 'tradeResolved', 'holidayStarted', 'holidayResult', 'lottoDraw',
  // Stage 8: romance / family / real estate (pops over the pawn; anchors open their cut-in after the step)
  'met', 'dated', 'proposed', 'married', 'schoolMeet', 'childBorn', 'childGrew', 'allowance', 'houseBought', 'houseSold', 'houseValueChanged',
  // Stage 9: submaps / treasures (pops over the pawn; anchors open their cut-in after the step)
  'submapEntered', 'submapResult', 'treasureFound',
]);

/**
 * Map an engine event batch to animation steps. Events carrying `emotion` + `charId` also get an
 * `emotion` step right after their own (Stage 5 `neutral` = none); consecutive duplicates (same char + emotion, e.g. a
 * moneyChanged followed by its log line) collapse into one.
 * @returns {{kind:string, event:object}[]}
 */
export function planSteps(events) {
  const steps = [];
  let lastEmotion = null;
  for (const e of events ?? []) {
    if (!e || typeof e.type !== 'string') continue;
    if (ANIMATED_EVENTS.has(e.type)) steps.push({ kind: e.type, event: e });
    if (e.emotion && e.emotion !== 'neutral' && e.charId) {
      const key = `${e.charId}:${e.emotion}`;
      if (key !== lastEmotion) steps.push({ kind: 'emotion', event: e });
      lastEmotion = key;
    } else if (e.type !== 'log') {
      lastEmotion = null;
    }
  }
  return steps;
}

const realClock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
};

/**
 * @param {{
 *   handlers?: Record<string, (event, ctx) => (Promise|void)>,
 *   clock?: {setTimeout, clearTimeout},
 *   maxStepMs?: number,      // safety net: a stuck step is abandoned after this long
 *   maxQueue?: number,       // more queued steps than this → play the backlog instantly
 *   isHidden?: () => boolean,
 *   onError?: (err, step) => void,
 * }} opts
 */
export function createAnimator({ handlers = {}, clock = realClock, maxStepMs = 12000, maxQueue = 40, isHidden = () => false, onError = () => {} } = {}) {
  const queue = [];
  const idleListeners = new Set();
  let running = false;
  let paused = false;
  let resumeWaiters = [];
  let current = null;
  let rushing = false; // rush(): the backlog plays instantly until the queue drains (my turn / game over)

  const sleep = (ms) => new Promise((resolve) => clock.setTimeout(resolve, Math.max(0, ms)));

  function withTimeout(promise, ms) {
    let id;
    const timeout = new Promise((resolve) => {
      id = clock.setTimeout(() => resolve('timeout'), ms);
    });
    return Promise.race([promise.then(() => 'done'), timeout]).finally(() => clock.clearTimeout(id));
  }

  async function runStep(step) {
    const fn = step.run ?? handlers[step.kind];
    if (typeof fn !== 'function') return;
    const ctx = { instant: rushing || isHidden() || queue.length > maxQueue, rushed: rushing, sleep, step };
    try {
      const r = fn(step.event, ctx);
      if (r && typeof r.then === 'function') await withTimeout(Promise.resolve(r), step.maxMs ?? maxStepMs);
    } catch (err) {
      onError(err, step);
    }
  }

  async function loop() {
    if (running) return;
    running = true;
    try {
      for (;;) {
        if (paused) await new Promise((resolve) => resumeWaiters.push(resolve));
        const step = queue.shift();
        if (!step) break;
        current = step;
        await runStep(step);
        current = null;
      }
    } finally {
      running = false;
      current = null;
      rushing = false;
    }
    for (const cb of [...idleListeners]) {
      try {
        cb();
      } catch (err) {
        onError(err, null);
      }
    }
  }

  const api = {
    /** Append an engine event batch. */
    push(events) {
      const steps = planSteps(events);
      if (!steps.length) return api.whenIdle();
      queue.push(...steps);
      loop();
      return api.whenIdle();
    },
    /** Append a custom step (e.g. a Stage 5 cut-in). `fn(event, ctx)` may return a Promise. */
    enqueue(fn, { label = 'custom', event = null, maxMs } = {}) {
      queue.push({ kind: label, event, run: fn, maxMs });
      loop();
      return api.whenIdle();
    },
    /** Stop after the current step (queued steps wait). */
    pause() {
      paused = true;
    },
    resume() {
      if (!paused) return;
      paused = false;
      const w = resumeWaiters;
      resumeWaiters = [];
      for (const r of w) r();
    },
    get paused() {
      return paused;
    },
    /**
     * Catch up: every queued step (and every step pushed before the queue drains) plays instantly (`ctx.instant`,
     * `ctx.rushed`); a paused animator resumes. The step on screen finishes normally. → steps rushed
     */
    rush() {
      if (!running && !queue.length) return 0;
      rushing = true;
      api.resume();
      return queue.length;
    },
    get rushing() {
      return rushing;
    },
    /** Drop queued (not yet started) steps. */
    clear() {
      queue.length = 0;
    },
    busy() {
      return running || queue.length > 0;
    },
    /** Queued steps (not counting the one playing). */
    size() {
      return queue.length;
    },
    current() {
      return current;
    },
    /** Persistent idle listener; returns an unsubscribe function. */
    onIdle(cb) {
      idleListeners.add(cb);
      return () => idleListeners.delete(cb);
    },
    /** Promise resolved the next time the queue drains (immediately when idle). */
    whenIdle() {
      if (!api.busy()) return Promise.resolve();
      return new Promise((resolve) => {
        const off = api.onIdle(() => {
          off();
          resolve();
        });
      });
    },
    setHandler(kind, fn) {
      handlers[kind] = fn;
    },
    /** Current handler of a step kind (wrap it: `const orig = getHandler('landed'); setHandler('landed', …)`). */
    getHandler(kind) {
      return handlers[kind] ?? null;
    },
    sleep,
  };
  return api;
}
