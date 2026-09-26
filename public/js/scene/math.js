// Pure math helpers shared by the 3D board (no three.js, no DOM → unit-testable in node).

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
export const easeOutCubic = (t) => 1 - (1 - clamp(t, 0, 1)) ** 3;
export const easeInOutCubic = (t) => {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
};
export const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = clamp(t, 0, 1);
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
};

/** Uniform Catmull-Rom through 2D points [{x,z}] → dense polyline (endpoints included). */
export function catmullRom(points, samplesPerSegment = 12) {
  if (points.length < 2) return points.map((p) => ({ x: p.x, z: p.z }));
  const P = (i) => points[clamp(i, 0, points.length - 1)];
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = P(i - 1);
    const p1 = P(i);
    const p2 = P(i + 1);
    const p3 = P(i + 2);
    for (let s = 0; s < samplesPerSegment; s++) {
      const t = s / samplesPerSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  const last = points.at(-1);
  out.push({ x: last.x, z: last.z });
  return out;
}

/** Cumulative arc lengths of a polyline. */
export function arcLengths(poly) {
  const acc = [0];
  for (let i = 1; i < poly.length; i++) acc.push(acc[i - 1] + Math.hypot(poly[i].x - poly[i - 1].x, poly[i].z - poly[i - 1].z));
  return acc;
}

/**
 * Point + unit tangent at arc length s along a polyline (clamped to the ends).
 * @returns {{x,z,tx,tz}}
 */
export function pointAt(poly, s, acc = arcLengths(poly)) {
  const total = acc.at(-1);
  const d = clamp(s, 0, total);
  let lo = 0;
  let hi = acc.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (acc[mid] <= d) lo = mid;
    else hi = mid;
  }
  const a = poly[lo];
  const b = poly[hi];
  const seg = acc[hi] - acc[lo] || 1;
  const t = (d - acc[lo]) / seg;
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t), tx: (b.x - a.x) / len, tz: (b.z - a.z) / len };
}

/** n points evenly spaced by arc length (first and last included). */
export function resample(poly, n) {
  const acc = arcLengths(poly);
  const total = acc.at(-1);
  if (n <= 1) return [pointAt(poly, 0, acc)];
  return Array.from({ length: n }, (_, i) => pointAt(poly, (total * i) / (n - 1), acc));
}

/** Yaw (rotation.y) that points an object's +z along the tangent (tx, tz). */
export const yawOf = (tx, tz) => Math.atan2(tx, tz);

/** Small deterministic PRNG (mulberry32) for prop placement. */
export function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- roulette ----------
export const ROULETTE_SEGMENTS = 10;
const TAU = Math.PI * 2;
const SEG = TAU / ROULETTE_SEGMENTS;

/** Wheel angle (radians, CCW) at which value v (1..10) sits under the top pointer, in [0, 2π). */
export function rouletteRestAngle(value) {
  const v = clamp(Math.round(value), 1, ROULETTE_SEGMENTS);
  return (((v - 0.5) * SEG) % TAU + TAU) % TAU;
}

/** Value under the pointer for a wheel angle (inverse of rouletteRestAngle). */
export function rouletteValueAt(angle) {
  const a = ((angle % TAU) + TAU) % TAU;
  return (Math.floor(a / SEG) % ROULETTE_SEGMENTS) + 1;
}

/**
 * Final angle for a spin that starts at `current`, turns at least `turns` full rotations and stops
 * with `value` under the pointer. `jitter` ∈ [-1, 1] offsets inside the segment (kept off the edges).
 */
export function rouletteTargetAngle(current, value, turns = 4, jitter = 0) {
  const rest = rouletteRestAngle(value) + clamp(jitter, -1, 1) * SEG * 0.35;
  const base = current + turns * TAU;
  const k = Math.ceil((base - rest) / TAU);
  return rest + k * TAU;
}

/** Parabolic hop: height at t∈[0,1] for a jump of peak height h. */
export const hopHeight = (t, h) => 4 * h * t * (1 - t);
