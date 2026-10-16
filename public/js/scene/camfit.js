// Camera fit math for the 3D board (pure: no three.js / DOM → node-tested in test/scene-camfit.test.js).
//
// The board camera is an orbit rig: it looks at `look = target + (0, LOOK_Y, 0)` from `look + radius · back(az, polar)`
// (`back` = unit vector from the look point to the camera). With the orientation fixed (azimuth / polar), fitting a
// point set into the perspective frustum is linear in the camera position: each frustum side plane gives one bound per
// point, so the tightest camera along the view axis — and the centring on the slack axis — is found exactly in one pass
// (no iteration). `fitPoints` does that for any canvas aspect / vertical FOV with screen insets (the subtitle pill at
// the bottom, the era sign at the top), `viewPoints` lists what the shown era draws (tiles + lanes, pawns / name tags,
// payday signs, the start flag and the era sign, route labels, the goal gate) and `overviewView` combines both.
import { clamp } from './math.js';

/** Vertical field of view of the board camera (degrees). */
export const CAMERA_FOV = 40;
/** The camera looks this far above the orbit target (pawns stand on the tiles). */
export const LOOK_Y = 0.6;
/** Screen insets (fractions of the canvas) kept free in the whole-map view: subtitle pill below, era sign above. */
export const OVERVIEW_INSET = { top: 0.05, bottom: 0.1, left: 0.03, right: 0.03 };
/**
 * Insets for a canvas partly hidden under page overlays (`cover` = fractions: the sticky spin dock / reaction bar
 * below, the top bar above). The overlay replaces the base inset on its side (the subtitle pill is under it too).
 */
export function coverInset(cover = {}, base = OVERVIEW_INSET) {
  const side = (k) => (cover[k] > 0 ? Math.max(base[k], cover[k] + 0.02) : base[k]);
  return { ...base, top: side('top'), bottom: side('bottom') };
}

/** Whole-map view: spare room goes to the top (the idle roulette and the view button sit in the top corners). */
export const OVERVIEW_ALIGN = { x: 0.5, y: 0.35 };
/** Default orbit per canvas orientation (portrait phones look along the loop's long axis). */
export const DEFAULT_ORBIT = {
  landscape: { azimuth: -0.3, polar: 0.95, radius: 17 },
  portrait: { azimuth: -1.15, polar: 0.9, radius: 19 },
};
/** TV mode: fixed overhead camera on the whole map. */
export const TV_ORBIT = { azimuth: 0, polar: 0.62 };
/** Fog of the follow view (kept for small boards / close cameras). */
export const BASE_FOG = { near: 55, far: 140, cameraFar: 260 };

export const isPortrait = (w, h) => w > 0 && h > 0 && w < h * 0.9;

/** Default orbit {azimuth, polar, radius, panX, panZ} for a canvas of w×h CSS px. */
export function defaultOrbit(w, h) {
  const d = isPortrait(w || 1, h || 1) ? DEFAULT_ORBIT.portrait : DEFAULT_ORBIT.landscape;
  return { azimuth: d.azimuth, polar: d.polar, radius: d.radius, panX: 0, panZ: 0 };
}

/** Follow-camera radius: a comfortable close view of the current pawn (spectators get a closer spotlight). */
export function followRadius(w, h, { mine = true } = {}) {
  const r = defaultOrbit(w, h).radius;
  return mine ? r : r * 0.68;
}

const dot = (p, v) => p.x * v.x + (p.y ?? 0) * v.y + p.z * v.z;

/**
 * Camera basis for an orbit angle (three.js `lookAt` convention): `back` = look point → camera, `right` = up × back,
 * `up` = back × right. polar ∈ (0, π/2) = angle from straight down.
 */
export function orbitBasis(azimuth, polar) {
  const sp = Math.sin(polar);
  const back = { x: Math.sin(azimuth) * sp, y: Math.cos(polar), z: Math.cos(azimuth) * sp };
  let rx = back.z;
  let rz = -back.x;
  const rl = Math.hypot(rx, rz);
  if (rl < 1e-9) {
    rx = Math.cos(azimuth);
    rz = -Math.sin(azimuth);
  } else {
    rx /= rl;
    rz /= rl;
  }
  const right = { x: rx, y: 0, z: rz };
  const up = { x: back.y * rz, y: back.z * rx - back.x * rz, z: -back.y * rx };
  return { back, right, up };
}

/** Camera world position of an orbit view. */
export function cameraPosition({ target, radius, azimuth, polar, lookY = LOOK_Y }) {
  const { back } = orbitBasis(azimuth, polar);
  return { x: target.x + back.x * radius, y: (target.y ?? 0) + lookY + back.y * radius, z: target.z + back.z * radius };
}

/**
 * Normalised device coordinates of a world point seen by an orbit view (x right, y up, both −1..1 on screen).
 * `depth` = distance in front of the camera (> 0 = visible side).
 */
export function projectPoint(p, { target, radius, azimuth, polar, fov = CAMERA_FOV, aspect = 1.6, lookY = LOOK_Y }) {
  const B = orbitBasis(azimuth, polar);
  const c = cameraPosition({ target, radius, azimuth, polar, lookY });
  const rel = { x: p.x - c.x, y: (p.y ?? 0) - c.y, z: p.z - c.z };
  const depth = -dot(rel, B.back);
  const tV = Math.tan((fov * Math.PI) / 360);
  return { x: dot(rel, B.right) / (depth * tV * aspect), y: dot(rel, B.up) / (depth * tV), depth };
}

/**
 * Tightest orbit view (fixed azimuth / polar) that shows every point inside the canvas minus `inset`.
 * Exact for a perspective camera: the binding axis touches its inset edge; on the axis with slack the content sits at
 * `align` (0 = left / bottom edge, 0.5 = centred, 1 = right / top edge) — moved, never zoomed, off the `avoid` boxes
 * (screen overlays such as the idle roulette in the top-right corner) when the slack allows it.
 * @param {{x, y?, z}[]} points  world points (y defaults to 0)
 * @param {{azimuth, polar, fov?, aspect?, inset?: {top, bottom, left, right}, lookY?, minRadius?, maxRadius?,
 *          align?: {x?: number, y?: number}, avoid?: {x0, x1, y0, y1}[]}} o  `avoid` boxes in NDC (−1..1, y up)
 * @returns {{target: {x, y: 0, z}, radius, camera: {x, y, z}, axis: 'width'|'height', hidden: number, hiddenKey: number, depth: number}}
 *   `hidden` / `hiddenKey` = points (key points: `{key: true}`, weighted first) left inside an avoid box, `depth` = mean distance of the points along the view axis (the zoom:
 *   sliding keeps it, a farther camera grows it — the orbit `radius` also changes with a vertical slide)
 */
export function fitPoints(points, { azimuth, polar, fov = CAMERA_FOV, aspect = 1.6, inset = OVERVIEW_INSET, lookY = LOOK_Y, minRadius = 0, maxRadius = Infinity, align = null, avoid = null } = {}) {
  const B = orbitBasis(azimuth, polar);
  const tV = Math.tan((fov * Math.PI) / 360);
  const tH = tV * (aspect > 0 ? aspect : 1);
  const ins = { top: 0, bottom: 0, left: 0, right: 0, ...inset };
  // usable screen window as tangents: x/depth ∈ [kl, kr], y/depth ∈ [kb, kt]
  const kl = (-1 + 2 * ins.left) * tH;
  const kr = (1 - 2 * ins.right) * tH;
  const kb = (-1 + 2 * ins.bottom) * tV;
  const kt = (1 - 2 * ins.top) * tV;
  let A = -Infinity; // max(x − kr·z)
  let Bm = -Infinity; // max(kl·z − x)
  let C = -Infinity; // max(y − kt·z)
  let D = -Infinity; // max(kb·z − y)
  let n = 0;
  const X = [];
  const Y = [];
  const Z = [];
  const K = [];
  for (const p of points) {
    if (!Number.isFinite(p?.x) || !Number.isFinite(p?.z)) continue;
    const x = dot(p, B.right);
    const y = dot(p, B.up);
    const z = -dot(p, B.back); // depth along the view direction
    A = Math.max(A, x - kr * z);
    Bm = Math.max(Bm, kl * z - x);
    C = Math.max(C, y - kt * z);
    D = Math.max(D, kb * z - y);
    X.push(x);
    Y.push(y);
    Z.push(z);
    K.push(!!p.key);
    n++;
  }
  if (!n) return { target: { x: 0, y: 0, z: 0 }, radius: clamp(minRadius || 20, minRadius, maxRadius), camera: cameraPosition({ target: { x: 0, z: 0 }, radius: minRadius || 20, azimuth, polar, lookY }), axis: 'height', hidden: 0, hiddenKey: 0, depth: minRadius || 20 };
  // camera depth coordinate c (along the view direction): every point must satisfy kl ≤ (x − a)/(z − c) ≤ kr (and the
  // same vertically) → c ≤ −(A + Bm)/(kr − kl) and c ≤ −(C + D)/(kt − kb); the smaller one binds
  const cw = -(A + Bm) / (kr - kl);
  const ch = -(C + D) / (kt - kb);
  const c = Math.min(cw, ch);
  // feasible camera offsets: a ∈ [content at the right edge, content at the left edge], b ∈ [at the top, at the bottom]
  const aR = kr * c + A;
  const aL = kl * c - Bm;
  const bT = kt * c + C;
  const bB = kb * c - D;
  const at = (ax, ay) => ({ a: aR + (1 - ax) * (aL - aR), b: bT + (1 - ay) * (bB - bT) });
  const ax0 = clamp(align?.x ?? 0.5, 0, 1);
  const ay0 = clamp(align?.y ?? 0.5, 0, 1);
  const boxes = (avoid ?? []).filter((r) => r && r.x1 > r.x0 && r.y1 > r.y0);
  // hidden points under the avoid boxes as a score: key points (the goal) weigh 1000
  const hiddenAt = ({ a, b }, limit = Infinity) => {
    if (!boxes.length) return 0;
    let k = 0;
    for (let i = 0; i < n && k <= limit; i++) {
      const d = Z[i] - c;
      const sx = (X[i] - a) / (d * tH);
      const sy = (Y[i] - b) / (d * tV);
      for (const r of boxes) {
        if (sx > r.x0 && sx < r.x1 && sy > r.y0 && sy < r.y1) {
          k += K[i] ? 1000 : 1;
          break;
        }
      }
    }
    return k;
  };
  let best = { ...at(ax0, ay0), cost: 0 };
  best.hidden = hiddenAt(best);
  if (best.hidden) {
    // slide along the slack (never zoom): the fewest hidden points, then the smallest move from `align`
    const steps = (v0) => [...new Set([v0, v0 / 2, 0, (v0 + 1) / 2, 1].map((v) => +v.toFixed(4)))];
    for (const ax of steps(ax0)) {
      for (const ay of steps(ay0)) {
        if (!best.hidden) break;
        const cost = Math.abs(ax - ax0) + Math.abs(ay - ay0);
        if (cost === 0) continue; // the default, already scored
        const cand = at(ax, ay);
        const hidden = hiddenAt(cand, best.hidden);
        if (hidden < best.hidden || (hidden === best.hidden && cost < best.cost)) best = { ...cand, hidden, cost };
      }
    }
  }
  const { a, b } = best;
  // camera world position = a·right + b·up − c·back; the orbit target is where the view axis meets y = 0
  const cam = {
    x: a * B.right.x + b * B.up.x - c * B.back.x,
    y: a * B.right.y + b * B.up.y - c * B.back.y,
    z: a * B.right.z + b * B.up.z - c * B.back.z,
  };
  const by = B.back.y > 1e-6 ? B.back.y : 1e-6;
  let radius = (cam.y - lookY) / by;
  const target = { x: cam.x - B.back.x * radius, y: 0, z: cam.z - B.back.z * radius };
  radius = clamp(radius, minRadius, maxRadius);
  let zs = 0;
  for (let i = 0; i < n; i++) zs += Z[i] - c;
  return { target, radius, camera: cameraPosition({ target, radius, azimuth, polar, lookY }), axis: cw <= ch ? 'width' : 'height', hidden: best.hidden % 1000, hiddenKey: Math.floor(best.hidden / 1000), depth: zs / n };
}

/** NDC box (−1..1, y up) of a CSS-pixel rectangle {x, y, w, h} (y down) inside a w×h canvas, grown by `pad` px. */
export function ndcBox(rect, width, height, pad = 4) {
  if (!rect || !(width > 0) || !(height > 0)) return null;
  const x0 = rect.x - pad;
  const x1 = rect.x + rect.w + pad;
  const y0 = rect.y - pad;
  const y1 = rect.y + rect.h + pad;
  return { x0: (2 * x0) / width - 1, x1: (2 * x1) / width - 1, y0: 1 - (2 * y1) / height, y1: 1 - (2 * y0) / height };
}

/** Tile normal (outwards = +normal of the walking direction) from its yaw. */
const normalOf = (t) => ({ x: -Math.cos(t.yaw ?? 0), z: Math.sin(t.yaw ?? 0) });
/** Tiles the whole-map view must never hide under a corner overlay (the final race's goal). */
const KEY_TILES = new Set(['goal']);
/** Drawn height above a tile: pawn + name tag, taller signs on paydays / the fork / the goal gate. */
const TILE_TOP_Y = { salary: 2.4, stop: 2.6, merge: 1.9, goal: 3.3 };

/**
 * World points that must be visible in the whole-map view of a layout (`layoutBoard` result): tile footprints (lanes
 * included), pawns standing on every tile with their name tags, payday signs / 🎪 tents / the start flag beside their
 * tiles, the era sign above the start, route labels and the goal gate. The goal's points carry `key: true`.
 */
export function viewPoints(layout, { pad = 1.05, pawnTop = 2.1, signTop = 4.0, signHalf = 2.4 } = {}) {
  const pts = [];
  for (const t of Object.values(layout?.tiles ?? {})) {
    if (!Number.isFinite(t.x) || !Number.isFinite(t.z)) continue;
    const key = KEY_TILES.has(t.type);
    for (const [dx, dz] of [[-pad, -pad], [pad, -pad], [pad, pad], [-pad, pad]]) pts.push({ x: t.x + dx, y: 0.3, z: t.z + dz, key });
    pts.push({ x: t.x, y: TILE_TOP_Y[t.type] ?? pawnTop, z: t.z, key });
    if (t.type === 'salary' || t.type === 'pass' || t.type === 'start' || t.type === 'goal') {
      const n = normalOf(t);
      for (const s of [-1.65, 1.65]) pts.push({ x: t.x + n.x * s, y: 1.8, z: t.z + n.z * s });
    }
  }
  const st = layout?.tiles?.[layout?.startId];
  if (st) for (const s of [-signHalf, signHalf]) pts.push({ x: st.x + s, y: signTop, z: st.z });
  for (const r of Object.values(layout?.era?.routes ?? {})) {
    if (!r?.label) continue;
    for (const s of [-1.7, 1.7]) pts.push({ x: r.label.x + s, y: 2.8, z: r.label.z });
  }
  return pts;
}

/** Horizontal distance from the era centre to its farthest drawn point (fog / far plane sizing). */
export function viewExtent(layout, pts = viewPoints(layout)) {
  const c = layout?.era?.center ?? { x: 0, z: 0 };
  let e = 0;
  for (const p of pts) e = Math.max(e, Math.hypot(p.x - c.x, p.z - c.z));
  return e;
}

/**
 * Whole-map view of the shown era for a canvas aspect and orbit angle.
 * @returns {{target, radius, camera, axis, extent}}
 */
export function overviewView(layout, { azimuth, polar, aspect = 1.6, fov = CAMERA_FOV, inset = OVERVIEW_INSET, minRadius = 12, maxRadius = 400, align = OVERVIEW_ALIGN, avoid = null, maxGrow = 1.2, keyGrow = 1.5, points = null } = {}) {
  const pts = points ?? viewPoints(layout);
  const o = { azimuth, polar, aspect, fov, minRadius, maxRadius, align, avoid };
  let fit = fitPoints(pts, { ...o, inset });
  const score = (f) => f.hiddenKey * 1000 + f.hidden;
  // sliding alone can't clear a corner overlay → allow a slightly farther camera that keeps the loop beside it
  // (≤ maxGrow; ≤ keyGrow while the goal would be hidden)
  if (fit.hidden + fit.hiddenKey && avoid?.length && maxGrow > 1) {
    const base = fit;
    const grow = base.hiddenKey ? Math.max(maxGrow, keyGrow) : maxGrow;
    for (const r of avoid) {
      const alts = [];
      if (r.y1 > 0.9) alts.push({ ...inset, top: Math.max(inset.top, (1 - r.y0) / 2 + 0.01) }); // below a top box
      if (r.y0 < -0.9) alts.push({ ...inset, bottom: Math.max(inset.bottom, (r.y1 + 1) / 2 + 0.01) }); // above a bottom box
      if (r.x1 > 0.9) alts.push({ ...inset, right: Math.max(inset.right, (1 - r.x0) / 2 + 0.01) }); // left of a right box
      if (r.x0 < -0.9) alts.push({ ...inset, left: Math.max(inset.left, (r.x1 + 1) / 2 + 0.01) }); // right of a left box
      for (const ins of alts) {
        if (ins.top + ins.bottom >= 0.9 || ins.left + ins.right >= 0.9) continue;
        const f = fitPoints(pts, { ...o, inset: ins });
        if (f.depth <= base.depth * grow && (score(f) < score(fit) || (score(f) === score(fit) && f.depth < fit.depth))) fit = f;
      }
    }
  }
  return { ...fit, extent: viewExtent(layout, pts) };
}

/** Orbit angle rounded for the whole-map fit cache (a drag / the transition swing refits every ~1°, not every frame). */
export const quantizeAngle = (a, step = 0.02) => Math.round(a / step) * step;

/** View of a few world points (route branch zone etc.) — same fit, a bit more margin. */
export function zoneView(points, { azimuth, polar, aspect = 1.6, fov = CAMERA_FOV, minRadius = 12, maxRadius = 400 } = {}) {
  return fitPoints(points, { azimuth, polar, aspect, fov, inset: { top: 0.12, bottom: 0.14, left: 0.08, right: 0.08 }, minRadius, maxRadius });
}

/**
 * Fog + far plane for a camera `radius` away from the board centre whose drawn points reach `extent`: the follow view
 * keeps the base fog (55 → 140); a far overview pushes the fog behind the board's far edge so the whole loop stays clear.
 */
export function fogRange(radius, extent = 0) {
  const near = Math.max(BASE_FOG.near, radius + extent * 0.85);
  const far = Math.max(BASE_FOG.far, near + 85);
  return { near, far, cameraFar: Math.max(BASE_FOG.cameraFar, far + 40) };
}
