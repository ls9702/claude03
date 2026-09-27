// 룰렛 실력 모드 — pure client helpers (node-tested in test/client-roulette.test.js; no DOM at import time).
// The input picks a target number 1..10 that goes out with the spin (`spin {characterId, target, input}`); the
// server lands on it 50 % of the time (±1 40 %, ±2 10 %). Any number 1..10 can be aimed at every turn.
//   shake: DeviceMotionEvent (secure context; iOS needs DeviceMotionEvent.requestPermission() from a tap) →
//          smoothed acceleration minus gravity → peak/average → `accelToTarget` (weak → small, strong → big)
//   gauge: a needle sweeping over a 1..10 bar, 「멈춰!」 (or Space / Enter) → `gaugeTarget(position)`
export const INPUT_KEY = 'jinsei.rouletteInput';
export const SKILL_INPUTS = ['shake', 'gauge'];

/** Shake calibration (m/s², ms). `aMin` → 1, `aMax` → 10 along a gamma curve; see `accelToTarget`. */
export const SHAKE = Object.freeze({
  gravity: 9.81,
  alpha: 0.35, // EMA smoothing per sample (~60 Hz)
  start: 3, // smoothed level that starts a shake
  still: 1.8, // below this for `stillMs` = the phone stopped → the result is final
  stillMs: 300,
  maxMs: 1500, // a shake is measured for at most this long
  aMin: 3,
  aMax: 28,
  gamma: 0.8,
  peakWeight: 0.6, // score = peak × 0.6 + average × 0.4
  noSensorMs: 1500, // no devicemotion sample this long after enabling → "no sensor" hint
});

/** Gauge timing: `sweepMs` per left→right sweep; from sweep `speedAfter` on each sweep is `speedup` × shorter. */
export const GAUGE = Object.freeze({ sweepMs: 1100, speedAfter: 3, speedup: 0.9, minSweepMs: 650 });

/** Remaining turn-timer time (ms) under which the panel warns that the server will spin automatically. */
export const DEADLINE_WARN_MS = 5000;

export const isSkillRoom = (room) => room?.config?.rouletteMode === 'skill';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// ---------- availability ----------

/**
 * What the browser offers for the shake input.
 * @param {object} win window-like (globalThis in the browser)
 * @returns {{hasMotion: boolean, secure: boolean, needsPermission: boolean, coarse: boolean}}
 */
export function detectShakeEnv(win = globalThis) {
  const DME = win?.DeviceMotionEvent;
  let coarse = false;
  try {
    coarse = !!win?.matchMedia?.('(pointer: coarse)')?.matches || (Number(win?.navigator?.maxTouchPoints) || 0) > 0;
  } catch {
    coarse = false;
  }
  return {
    hasMotion: typeof DME === 'function',
    secure: win?.isSecureContext === true,
    needsPermission: typeof DME?.requestPermission === 'function',
    coarse,
  };
}

/**
 * Can the player shake now? `permission`: 'granted' | 'denied' | null (not asked yet).
 * @returns {{ok: boolean, needsPermission: boolean, reason: string|null}} `ok` false → `reason` (Korean, shown in
 *   the panel); `needsPermission` → show the one-time 「📱 흔들기 켜기」 button first.
 */
export function shakeSupport(env = {}, permission = null) {
  if (!env.secure) return { ok: false, needsPermission: false, reason: '흔들기는 HTTPS 주소에서만 돼요 · 버튼으로 해요' };
  if (!env.hasMotion) return { ok: false, needsPermission: false, reason: '이 기기는 흔들기를 지원하지 않아요 · 버튼으로 해요' };
  if (permission === 'denied') return { ok: false, needsPermission: false, reason: '흔들기 권한이 거부됐어요 · 버튼으로 해요' };
  if (env.needsPermission && permission !== 'granted') return { ok: true, needsPermission: true, reason: null };
  return { ok: true, needsPermission: false, reason: null };
}

/** The input to open with: the saved preference when usable, else shake on touch devices that support it. */
export function defaultInput(stored, env = {}) {
  const shakeOk = shakeSupport(env, null).ok;
  if (stored === 'gauge') return 'gauge';
  if (stored === 'shake') return shakeOk ? 'shake' : 'gauge';
  return shakeOk && env.coarse ? 'shake' : 'gauge';
}

export function loadInputPref(storage) {
  try {
    const v = storage?.getItem(INPUT_KEY);
    return SKILL_INPUTS.includes(v) ? v : null;
  } catch {
    return null;
  }
}

export function saveInputPref(storage, v) {
  try {
    if (SKILL_INPUTS.includes(v)) storage?.setItem(INPUT_KEY, v);
  } catch {
    /* private mode */
  }
}

// ---------- shake ----------

const vecLen = (v) => (v && [v.x, v.y, v.z].every((n) => Number.isFinite(n)) ? Math.hypot(v.x, v.y, v.z) : null);

/**
 * Acceleration magnitude without gravity (m/s²) of a devicemotion event: `acceleration` when the device gives it,
 * else |accelerationIncludingGravity| − g. null = no usable data.
 */
export function motionMagnitude(ev, gravity = SHAKE.gravity) {
  const a = vecLen(ev?.acceleration);
  if (a != null) return a;
  const g = vecLen(ev?.accelerationIncludingGravity);
  return g == null ? null : Math.abs(g - gravity);
}

/** Shake score (m/s²) → target 1..10: weak → small numbers, strong → big (calibrated gamma curve). */
export function accelToTarget(a, cfg = SHAKE) {
  if (!Number.isFinite(a) || a <= cfg.aMin) return 1;
  const k = clamp((a - cfg.aMin) / (cfg.aMax - cfg.aMin), 0, 1);
  return clamp(1 + Math.round(9 * k ** cfg.gamma), 1, 10);
}

/**
 * Live shake measurement. `feed(magnitude, nowMs)` per devicemotion sample → the state:
 * `{phase: 'wait'|'shaking'|'done', level, peak, avg, target, elapsed}`; `target` is live while shaking and final
 * once `phase === 'done'` (the phone was still for `stillMs`, or `maxMs` passed since the shake started).
 */
export function createShakeMeter(cfg = SHAKE) {
  const s = { phase: 'wait', level: 0, peak: 0, sum: 0, n: 0, startAt: 0, stillSince: null, target: 1, elapsed: 0 };
  const score = () => cfg.peakWeight * s.peak + (1 - cfg.peakWeight) * (s.n ? s.sum / s.n : 0);
  const view = () => ({ phase: s.phase, level: s.level, peak: s.peak, avg: s.n ? s.sum / s.n : 0, target: s.target, elapsed: s.elapsed });
  return {
    feed(mag, now) {
      if (s.phase === 'done' || !Number.isFinite(mag)) return view();
      s.level += cfg.alpha * (mag - s.level);
      if (s.phase === 'wait') {
        if (s.level < cfg.start) return view();
        s.phase = 'shaking';
        s.startAt = now;
      }
      s.elapsed = now - s.startAt;
      s.peak = Math.max(s.peak, s.level);
      s.sum += s.level;
      s.n += 1;
      s.target = accelToTarget(score(), cfg);
      if (s.level < cfg.still) s.stillSince ??= now;
      else s.stillSince = null;
      if (s.elapsed >= cfg.maxMs || (s.stillSince != null && now - s.stillSince >= cfg.stillMs)) s.phase = 'done';
      return view();
    },
    get state() {
      return view();
    },
    reset() {
      Object.assign(s, { phase: 'wait', level: 0, peak: 0, sum: 0, n: 0, startAt: 0, stillSince: null, target: 1, elapsed: 0 });
    },
  };
}

// ---------- gauge ----------

/** Duration of sweep `k` (0-based). */
export function sweepDuration(k, cfg = GAUGE) {
  if (k < cfg.speedAfter) return cfg.sweepMs;
  return Math.max(cfg.minSweepMs, cfg.sweepMs * cfg.speedup ** (k - cfg.speedAfter + 1));
}

/**
 * Needle position after `ms` of sweeping: `{pos: 0..1, sweep, dir: 1|-1}` (even sweeps go left → right, odd ones
 * back; from sweep `speedAfter` on each sweep gets a little faster, never below `minSweepMs`).
 */
export function gaugePosition(ms, cfg = GAUGE) {
  let t = Math.max(0, Number(ms) || 0);
  let k = 0;
  for (; k < 10000; k++) {
    const d = sweepDuration(k, cfg);
    if (t < d) {
      const f = t / d;
      return { pos: k % 2 === 0 ? f : 1 - f, sweep: k, dir: k % 2 === 0 ? 1 : -1 };
    }
    t -= d;
  }
  return { pos: 0, sweep: k, dir: 1 };
}

/** Needle position 0..1 → the 1..10 cell under it (ten equal cells). */
export function gaugeTarget(pos, n = 10) {
  const p = clamp(Number(pos) || 0, 0, 1);
  return clamp(1 + Math.floor(p * n), 1, n);
}

// ---------- display ----------

/** First roll of a spun event / lastSpin (a taxi / noise second roll is random and shown by spinNote). */
const firstRoll = (s) => (Array.isArray(s?.rolls) ? s.rolls[0] : s?.value);

/** 「🎯 목표 7 → 결과 8」 / 「🎯 목표 7 → 결과 7 명중!」 for a skill spin (spun event or `turn.lastSpin`), else null. */
export function aimText(s) {
  if (!s?.skill || !Number.isInteger(s.target)) return null;
  const v = firstRoll(s);
  return `🎯 목표 ${s.target} → 결과 ${v}${v === s.target ? ' 명중!' : ''}`;
}

/** Short float for the side list: 「🎯7→8」 / 「🎯7 명중!」. */
export function aimShort(s) {
  if (!s?.skill || !Number.isInteger(s.target)) return null;
  const v = firstRoll(s);
  return v === s.target ? `🎯${s.target} 명중!` : `🎯${s.target}→${v}`;
}

/** How close the roll landed: 'hit' | 'near' (±1) | 'miss' (≥ 2) | null. */
export function aimGrade(s) {
  if (!s?.skill || !Number.isInteger(s.target)) return null;
  const d = Math.abs(firstRoll(s) - s.target);
  return d === 0 ? 'hit' : d === 1 ? 'near' : 'miss';
}

/** Jitter shares for the panel hint (「정확히 50% · ±1 40% · ±2 10%」) from `/api/meta.balance.roulette`. */
export function jitterHint(meta = null) {
  const j = meta?.balance?.roulette?.skill?.jitter ?? { 0: 0.5, 1: 0.4, 2: 0.1 };
  const total = Object.values(j).reduce((a, b) => a + (Number(b) || 0), 0) || 1;
  return Object.entries(j)
    .map(([k, w]) => [Number(k), Math.round((100 * (Number(w) || 0)) / total)])
    .filter(([, p]) => p > 0)
    .sort((a, b) => a[0] - b[0])
    .map(([k, p]) => (k === 0 ? `정확히 ${p}%` : `±${k} ${p}%`))
    .join(' · ');
}
