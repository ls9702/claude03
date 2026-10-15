// CH-1 Chiikawa-style 3D pawns: roster character look {character, props} → low-poly primitive specs.
// Pure (no three.js / DOM) so the mapping is unit-testable; pawn.js turns specs into ONE merged vertex-coloured mesh.
//
// spec: { shape: 'sphere'|'cyl'|'box'|'cone'|'torus', args: [...three.js geometry args], pos: [x,y,z],
//         rot?: [x,y,z] (Euler XYZ), scale?: [x,y,z], color: '#rrggbb', part: 'body'|'face'|'ears'|'prop:<slot>',
//         paint?: {type, ...} (per-triangle colour from the LOCAL geometry position, see `paintColor`),
//         bump?: {n, amp} (scalloped lobes around the local y axis, see `bumpFactor`),
//         outline?: number (inverted-hull outline thickness in the `line` colour), flip?: true (reversed winding) }
// The pawn faces +z, stands on y = 0; a size-1 character is ≈ 1.4 units tall (head centre y ≈ 0.9).
//
// Everything is data-driven from the roster entry (`/api/meta.roster`): `ears` picks the signature parts (nub / cat
// split cap / rabbit / squirrel tail / bun glaze / otter muzzle / lion mane / pouch), `colors {body, line, blush,
// accent?}` colour them, `size` scales the figure. Props (`/api/meta.props`) are primitives at the head / face / neck /
// hand / back anchors; unknown ids get a generic shape per slot.
//
// LEGACY: a human paper-doll avatar (avatars.json parts, no `character`) still maps to the old human pawn
// (pawnHuman.js) — the server migrates every avatar, so the game only sends roster looks.
import { humanSpecs } from './pawnHuman.js';
import { rosterInfo, propInfo, normalizeLook as rosterNormalize, lookKind, PROP_SLOTS } from '../shared/roster.js';

export {
  PAWN_COLORS,
  PAWN_BUILD_SCALE,
  PAWN_DEFAULT,
  FIXED_OUTFIT_COLORS_3D,
  shade,
  resolveAvatar,
  buildScale,
  humanSpecs,
} from './pawnHuman.js';
import { shade } from './pawnHuman.js';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- roster / props data

export { ROSTER_IDS, EAR_TYPES, PROP_SLOTS, DEFAULT_CHARACTER } from '../shared/roster.js';

/**
 * 3D features per roster id (same meaning as the 2D rig's table in ui/chara.js; ear-type fallbacks below, a roster
 * entry's own `features` object wins): cap 'hachiware' | 'bun' (head pattern in `accent`), muzzle (lighter body colour
 * around the mouth), mane / tail / membrane / pouchBag (in `accent`), mouth 'small' | 'w' | 'open', eyes 'big'.
 */
export const FEATURES_3D = {
  chiikawa: { mouth: 'small' },
  hachiware: { cap: 'hachiware', mouth: 'w' },
  usagi: { mouth: 'open' },
  momonga: { eyes: 'big', tail: true, membrane: true, mouth: 'small' },
  kurimanju: { cap: 'bun', mouth: 'small' },
  rakko: { muzzle: true, tail: true, mouth: 'small' },
  shisa: { mane: true, mouth: 'open' },
  pochette: { pouchBag: true, mouth: 'small' },
};
const EAR_FEATURES_3D = { lion: { mane: true }, squirrel: { tail: true }, pouch: { pouchBag: true }, bun: { cap: 'bun' }, otter: { muzzle: true }, rabbit: { mouth: 'open' }, cat: { mouth: 'w' } };
const MOUTHS = { small: 'small', smile: 'small', content: 'small', cat: 'w', w: 'w', grin: 'open', open: 'open', wide: 'open' };
const WHITE = '#ffffff';
const GOLD = '#f2c94c';
const DARK = '#2d2a32';
const HASH_COLORS = ['#ff8fb1', '#7ec8e3', '#ffd23f', '#9be37a', '#c39bff', '#ff9f5a', '#5ccfc0'];

const isHex = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
function strHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
/** `/api/meta`-shaped defs (roster.js reads `meta.roster` / `meta.props`); old avatars.json defs → fallbacks. */
const metaOf = (defs) => (isObj(defs) && (defs.roster || defs.props) ? defs : null);

/**
 * Resolved roster entry for the 3D pawn: `{id, ears, size, mouth, feat, colors {body, line, blush, accent, extra, eye}}`
 * (`/api/meta.roster` first, roster.js fallbacks otherwise).
 */
export function rosterEntry(id, defs = null) {
  const meta = metaOf(defs);
  const info = rosterInfo(id, meta);
  const raw = (Array.isArray(meta?.roster) ? meta.roster : meta?.roster?.characters)?.find?.((c) => c?.id === info.id);
  const feat = { ...(EAR_FEATURES_3D[info.ears] ?? {}), ...(FEATURES_3D[info.id] ?? {}), ...(isObj(raw?.features) ? raw.features : {}) };
  const c = info.colors;
  const line = isHex(c.line) ? c.line : '#5b4a44';
  return {
    id: info.id,
    ears: info.ears,
    size: Math.min(1.25, Math.max(0.8, info.size)),
    mouth: MOUTHS[feat.mouth] ?? 'small',
    feat,
    colors: {
      body: isHex(c.body) ? c.body : '#ffffff',
      line,
      blush: isHex(c.blush) ? c.blush : '#ffb4c2',
      accent: isHex(c.accent) ? c.accent : null,
      extra: isHex(c.extra) ? c.extra : null,
      eye: isHex(c.eye) ? c.eye : shade(line, 0.5),
    },
  };
}

/** A player look `{character, props}` (also an NPC / pet look — drawn as the default roster pawn in 3D). */
export function isRosterLook(a) {
  const k = lookKind(a);
  return k === 'character' || k === 'npc' || k === 'pet' || (isObj(a) && isObj(a.props));
}
/** An old human paper-doll avatar (LEGACY path). */
export function isHumanAvatar(a) {
  return lookKind(a) === 'legacy' || (isObj(a) && !isRosterLook(a) && ['hair', 'hairColor', 'outfit', 'outfitColor', 'skin', 'body', 'build', 'eyes', 'accessory'].some((k) => typeof a[k] === 'string'));
}

/** `{character, props: {slot: id}}`: roster.js normalisation (old human avatars → a roster character by hash), known props only. */
export function normalizeLook(look, defs = null) {
  const meta = metaOf(defs);
  const n = rosterNormalize(isObj(look) ? look : {}, meta);
  const character = n.character ?? rosterInfo(null, meta).id; // npc / pet looks → the default roster figure
  const props = {};
  const src = isObj(n.props) ? n.props : {};
  for (const slot of PROP_SLOTS) if (typeof src[slot] === 'string') props[slot] = src[slot];
  return { character, props };
}
/** Stable cache key of a look + every colour it resolves to (so a data change rebuilds). */
export function lookKey(look, defs = null) {
  if (isHumanAvatar(look) && !isRosterLook(look)) return `h:${JSON.stringify(look)}`;
  const n = normalizeLook(look, defs);
  const e = rosterEntry(n.character, defs);
  const pc = PROP_SLOTS.map((s) => (n.props[s] ? `${n.props[s]}${propColor(n.props[s], defs, e)}` : '')).join(',');
  return `c:${n.character}|${e.ears}|${e.size}|${Object.values(e.colors).join('')}|${JSON.stringify(e.feat)}|${pc}`;
}

function propData(id, defs) {
  const list = metaOf(defs)?.props;
  const arr = Array.isArray(list) ? list : Array.isArray(list?.props) ? list.props : [];
  return arr.find((p) => p?.id === id) ?? null;
}
/**
 * Main colour of a prop on a character: `tintable` props wear the character's `accent`; else props.json `color`;
 * else the builder default (unknown ids → a hashed colour).
 */
export function propColor(id, defs = null, entry = null) {
  const d = propData(id, defs);
  const tint = d ? d.tintable === true : !!propInfo(id, null)?.tintable;
  if (tint && entry?.colors?.accent) return entry.colors.accent;
  if (isHex(d?.color)) return d.color;
  return PROP_DEFAULT_COLORS[id] ?? HASH_COLORS[strHash(String(id)) % HASH_COLORS.length];
}

// ---------------------------------------------------------------- vector / orientation helpers (pure)

const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add3 = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const r4 = (n) => Math.round(n * 1e4) / 1e4;

/** Euler XYZ (three.js order) of the rotation whose columns are the local axes X, Y, Z (orthonormal, right-handed). */
export function eulerFromAxes(X, Y, Z) {
  const m13 = Z[0];
  const y = Math.asin(Math.max(-1, Math.min(1, m13)));
  if (Math.abs(m13) < 0.9999999) return [Math.atan2(-Z[1], Z[2]), y, Math.atan2(-Y[0], X[0])];
  return [Math.atan2(Y[2], Y[1]), y, 0];
}
/** Rotation turning local +z towards `dir` (local +y as close to `up` as possible), then spun by `spin` about it. */
export function faceRot(dir, up = [0, 1, 0], spin = 0) {
  const Z = norm(dir);
  let X = cross(up, Z);
  if (Math.hypot(...X) < 1e-6) X = [1, 0, 0];
  X = norm(X);
  let Y = cross(Z, X);
  if (spin) {
    const c = Math.cos(spin);
    const s = Math.sin(spin);
    [X, Y] = [add3(X.map((v) => v * c), Y, s), add3(Y.map((v) => v * c), X, -s)];
  }
  return eulerFromAxes(X, Y, Z);
}
/** Rotation turning local +y towards `dir` (local +z as close to `fwd` as possible). */
export function axisRot(dir, fwd = [0, 0, 1]) {
  const Y = norm(dir);
  let X = cross(Y, fwd);
  if (Math.hypot(...X) < 1e-6) X = cross(Y, [1, 0, 0]);
  X = norm(X);
  return eulerFromAxes(X, Y, cross(X, Y));
}
/** Rotate a local vector by an Euler XYZ rotation (R = Rx·Ry·Rz). */
export function rotateXYZ(v, [ax, ay, az]) {
  let [x, y, z] = v;
  let c = Math.cos(az);
  let s = Math.sin(az);
  [x, y] = [x * c - y * s, x * s + y * c];
  c = Math.cos(ay);
  s = Math.sin(ay);
  [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(ax);
  s = Math.sin(ax);
  [y, z] = [y * c - z * s, y * s + z * c];
  return [x, y, z];
}

// ---------------------------------------------------------------- spec helpers

const S = (shape, args, pos, color, extra = {}) => ({ shape, args, pos, color, ...extra });
const sph = (r, w, h, pos, color, extra) => S('sphere', [r, w, h], pos, color, extra);
const cyl = (rt, rb, h, seg, pos, color, extra, open = false) => S('cyl', open ? [rt, rb, h, seg, 1, true] : [rt, rb, h, seg], pos, color, extra);
const cone = (r, h, seg, pos, color, extra) => S('cone', [r, h, seg], pos, color, extra);
const box = (w, h, d, pos, color, extra) => S('box', [w, h, d], pos, color, extra);
const tor = (r, t, rs, ts, pos, color, extra, arc = TAU) => S('torus', arc === TAU ? [r, t, rs, ts] : [r, t, rs, ts, arc], pos, color, extra);
/** A unit sphere cap (top `frac` × π of the polar angle) scaled to radii — hats / hoods hugging the head. */
const cap = (w, h, frac, pos, radii, color, extra = {}) => S('sphere', [1, w, h, 0, TAU, 0, Math.PI * frac], pos, color, { scale: radii, ...extra });
/** A cylinder from p0 to p1. */
function rod(p0, p1, rt, rb, seg, color, extra = {}) {
  const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const len = Math.hypot(...d);
  return cyl(rt, rb, len, seg, [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2], color, { rot: axisRot(d), ...extra });
}

/** Triangle count of a spec (three.js geometry formulas; used for budgets). */
export function specTriangles(s) {
  const a = s.args;
  let n;
  switch (s.shape) {
    case 'sphere': {
      const w = Math.max(3, Math.floor(a[1] ?? 32));
      const h = Math.max(2, Math.floor(a[2] ?? 16));
      const t0 = a[5] ?? 0;
      const t1 = Math.min(Math.PI, t0 + (a[6] ?? Math.PI));
      n = 2 * w * h - (t0 > 0 ? 0 : w) - (t1 < Math.PI ? 0 : w);
      break;
    }
    case 'cyl':
    case 'cone': {
      const [rt, rb, , seg = 32, hs = 1, open = false] = s.shape === 'cone' ? [0, a[0], a[1], a[2], a[3] ?? 1, a[4] ?? false] : a;
      n = 2 * seg * hs - (rt > 0 ? 0 : seg) - (rb > 0 ? 0 : seg);
      if (!open) n += (rt > 0 ? seg : 0) + (rb > 0 ? seg : 0);
      break;
    }
    case 'torus':
      n = 2 * a[2] * a[3];
      break;
    default:
      n = 12;
  }
  return s.outline ? n * 2 : n;
}

// ---------------------------------------------------------------- paint / bump (pure, evaluated by pawn.js)

/**
 * Per-triangle colour from a LOCAL position (spheres: unit direction; other shapes: raw local coords).
 * @returns {string|null} '#rrggbb' or null (= the spec colour)
 */
export function paintColor(p, x, y, z) {
  if (!p) return null;
  switch (p.type) {
    case 'cap': {
      // Hachiware: blue-grey cap over the top of the head with a white inverted-V split on the forehead
      const edge = 0.1 - 0.3 * (1 - z); // front: just above the eyes; sides / back lower
      if (y < edge) return null;
      if (z > 0.15 && Math.abs(x) < 0.44 * (1 - (y - 0.1) / 0.92)) return null;
      return p.color;
    }
    case 'glaze': {
      // Kurimanju: glazed chestnut-bun top with a wavy edge
      const a = Math.atan2(z, x);
      return y > 0.3 + 0.05 * Math.sin(a * 7) ? p.color : null;
    }
    case 'muzzle': // Rakko: light muzzle / face patch
      return z > 0.42 && y < 0.12 && Math.abs(x) < 0.75 ? p.color : null;
    case 'belly':
      return z > 0.45 && y < 0.6 ? p.color : null;
    case 'inner': // rabbit ear: pink strip on the front
      return z > 0.25 && Math.abs(x) < 0.62 && y > -0.85 && y < 0.88 ? p.color : null;
    case 'tip': // tail / brush tip
      return y > (p.at ?? 0.55) ? p.color : null;
    case 'bands': {
      // stripes along the local y axis (party hat): `n` bands over [y0, y1]
      const k = Math.floor(((y - (p.y0 ?? -0.5)) / ((p.y1 ?? 0.5) - (p.y0 ?? -0.5))) * (p.n ?? 3));
      return k % 2 ? p.color : null;
    }
    case 'swirl': {
      // lollipop: angular stripes around the local y axis
      const a = Math.atan2(z, x) + Math.hypot(x, z) * (p.twist ?? 18);
      return Math.floor((a / TAU) * (p.n ?? 4) * 2 + 100) % 2 ? p.color : null;
    }
    case 'half': // bobber: bottom half
      return y < 0 ? p.color : null;
    case 'liquid': // flask: the liquid fills the lower part
      return y < (p.level ?? 0.15) ? p.color : null;
    case 'soccer': {
      // dark patches around 12 icosahedron vertices
      const t = 0.5257;
      const u = 0.8507;
      for (const [vx, vy, vz] of [[0, t, u], [0, -t, u], [0, t, -u], [0, -t, -u], [t, u, 0], [-t, u, 0], [t, -u, 0], [-t, -u, 0], [u, 0, t], [u, 0, -t], [-u, 0, t], [-u, 0, -t]]) {
        if (x * vx + y * vy + z * vz > 0.9) return p.color;
      }
      return null;
    }
    default:
      return null;
  }
}

/** Radial factor of a scalloped shape (`bump {n, amp}`): lobes around the local y axis. */
export function bumpFactor(b, x, y, z) {
  if (!b) return 1;
  const a = Math.atan2(z, x);
  return 1 + b.amp * Math.abs(Math.cos((a * b.n) / 2));
}

// ---------------------------------------------------------------- the figure frame (anchors)

/**
 * Anchors of a roster figure (size 1, before the `size` scale): head / body ellipsoids, eye line, neck ring, the
 * raised right paw (hand items), the back, the head top and the crown (top incl. ears).
 */
export function charaFrame(entry) {
  const bun = entry.feat?.cap === 'bun';
  const head = bun ? { y: 0.86, rx: 0.54, ry: 0.39, rz: 0.47 } : { y: 0.9, rx: 0.5, ry: 0.42, rz: 0.45 };
  const body = entry.ears === 'otter' ? { y: 0.35, rx: 0.35, ry: 0.34, rz: 0.32 } : { y: 0.33, rx: 0.367, ry: 0.313, rz: 0.333 };
  const neckY = head.y - head.ry * 0.86;
  const bodyRAt = (y) => Math.sqrt(Math.max(0, 1 - ((y - body.y) / body.ry) ** 2));
  const headRAt = (y) => Math.sqrt(Math.max(0, 1 - ((y - head.y) / head.ry) ** 2));
  const k = bodyRAt(neckY);
  const neck = { y: neckY, rx: Math.max(body.rx * k, head.rx * headRAt(neckY)) + 0.025, rz: Math.max(body.rz * k, head.rz * headRAt(neckY)) + 0.025 };
  neck.z = neck.rz;
  const earTop = { nub: 0.1, cat: 0.2, rabbit: 0.45, squirrel: 0.1, bun: 0.05, otter: 0, lion: 0.12, pouch: 0.04 }[entry.ears] ?? 0;
  const big = entry.feat?.eyes === 'big';
  return {
    head,
    body,
    top: head.y + head.ry,
    crown: head.y + head.ry + earTop,
    eye: { x: 0.17 * (head.rx / 0.5), y: head.y - 0.03, r: big ? 0.064 : 0.052 },
    mouthY: head.y - 0.135,
    neck,
    hand: [-(body.rx + 0.1), body.y + 0.2, 0.12],
    back: [0, body.y + 0.05, -body.rz],
    bodyRAt,
    headRAt,
  };
}

/** A point on the head ellipsoid front at (x, y) lifted `lift` along the normal, with the normal + a face-out rotation. */
function onHead(f, x, y, lift = 0, spin = 0) {
  const { y: HY, rx, ry, rz } = f.head;
  const dx = x / rx;
  const dy = (y - HY) / ry;
  const z = rz * Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
  const n = norm([x / (rx * rx), (y - HY) / (ry * ry), z / (rz * rz)]);
  return { pos: [x + n[0] * lift, y + n[1] * lift, z + n[2] * lift], n, rot: faceRot(n, [0, 1, 0], spin) };
}
function onBody(f, x, y, lift = 0) {
  const { y: BY, rx, ry, rz } = f.body;
  const dx = x / rx;
  const dy = (y - BY) / ry;
  const z = rz * Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
  const n = norm([x / (rx * rx), (y - BY) / (ry * ry), z / (rz * rz)]);
  return { pos: [x + n[0] * lift, y + n[1] * lift, z + n[2] * lift], n, rot: faceRot(n) };
}
/** Head cross-section {y, r (x radius), kz (z/x ratio)} at `drop` below the head top. */
function ringAt(f, drop) {
  const y = f.top - drop;
  return { y, r: f.head.rx * f.headRAt(y), kz: f.head.rz / f.head.rx };
}

// ---------------------------------------------------------------- the figure

const HEAD_SEG = [14, 10];
const BODY_SEG = [10, 7];
const OUTLINE = { head: 0.024, body: 0.022, ear: 0.016, big: 0.02 };

/** Ears + signature parts per ear type / features (data-driven: ears + colours + features, never the roster id). */
function earSpecs(e, f) {
  const { body, accent, blush } = e.colors;
  const ft = e.feat;
  const HY = f.head.y;
  const out = [];
  const pair = (fn) => {
    for (const s of [-1, 1]) out.push(...fn(s));
  };
  const inner = shade(blush, 1.25);
  switch (e.ears) {
    case 'cat': {
      const capColor = ft.cap === 'hachiware' && accent ? accent : body;
      const innerColor = ft.cap === 'hachiware' && accent ? shade(accent, 1.45) : inner;
      pair((s) => [
        cone(0.125, 0.22, 6, [s * 0.27, HY + 0.37, -0.01], capColor, { rot: [0, 0, -s * 0.42], outline: OUTLINE.ear }),
        cone(0.065, 0.12, 4, [s * 0.272, HY + 0.36, 0.055], innerColor, { rot: [0, 0, -s * 0.42], scale: [1, 1, 0.4] }),
      ]);
      break;
    }
    case 'rabbit':
      pair((s) => [sph(0.085, 6, 6, [s * 0.12, HY + 0.6, -0.03], body, { scale: [0.85, 2.9, 0.62], rot: [0, 0, -s * 0.1], paint: { type: 'inner', color: inner }, outline: OUTLINE.ear })]);
      break;
    case 'squirrel':
      pair((s) => [sph(0.1, 6, 4, [s * 0.3, HY + 0.33, -0.04], body, { scale: [0.9, 1.1, 0.6], rot: [0, 0, -s * 0.15] })]);
      break;
    case 'bun':
      pair((s) => [sph(0.07, 5, 3, [s * 0.27, f.top - 0.03, 0.0], accent ?? body, { scale: [1, 0.85, 0.8] })]);
      break;
    case 'otter':
      pair((s) => [sph(0.075, 5, 3, [s * 0.42, HY + 0.2, -0.04], body, { scale: [1, 0.8, 0.6] }), sph(0.04, 4, 2, [s * 0.44, HY + 0.2, 0.0], accent ? shade(accent, 1.2) : inner, { scale: [1, 0.8, 0.5] })]);
      break;
    case 'lion':
      pair((s) => [sph(0.08, 5, 3, [s * 0.34, HY + 0.33, 0.0], body, { scale: [1, 0.85, 0.7] })]);
      break;
    case 'pouch':
      // soft drooping ears hanging beside the head
      pair((s) => [sph(0.1, 6, 4, [s * 0.46, HY + 0.12, -0.02], accent ? shade(accent, 1.55) : body, { scale: [0.75, 1.7, 0.6], rot: [0, 0, s * 0.5], outline: OUTLINE.ear })]);
      break;
    default: // nub: small round bear-ish ears
      pair((s) => [sph(0.105, 6, 4, [s * 0.27, HY + 0.33, -0.02], body, { scale: [1, 0.88, 0.75] })]);
      break;
  }
  const tagged = out.map((x) => ({ ...x, part: 'ears' }));
  // ---- feature extras (accent colour) ----
  const acc = accent ?? shade(body, 0.85);
  if (ft.mane) {
    // scalloped mane behind the head (lobes around the local y axis = the view axis after the rotation)
    tagged.push(sph(0.62, 21, 3, [0, HY - 0.02, -0.21], acc, { part: 'ears', rot: [Math.PI / 2, 0, 0], scale: [1, 0.5, 0.95], bump: { n: 7, amp: 0.16 }, outline: OUTLINE.big }));
  }
  if (ft.tail && e.ears === 'otter') tagged.push(sph(0.1, 6, 4, [0, 0.1, -0.37], acc, { part: 'ears', scale: [1, 0.45, 2] }));
  else if (ft.tail) {
    // big fluffy tail rising behind the body
    tagged.push(sph(0.2, 8, 6, [0, 0.66, -0.43], acc, { part: 'ears', scale: [0.8, 1.5, 0.7], rot: [0.3, 0, 0], bump: { n: 4, amp: 0.1 }, paint: { type: 'tip', at: 0.6, color: shade(acc, 1.25) }, outline: OUTLINE.big }));
  }
  if (ft.membrane) {
    // gliding membrane flaps between arm and foot
    for (const s of [-1, 1]) tagged.push(sph(0.15, 5, 3, [s * (f.body.rx - 0.02), f.body.y - 0.06, -0.02], acc, { part: 'ears', scale: [0.45, 1.25, 0.9], rot: [0, 0, s * 0.25] }));
  }
  if (ft.cap === 'bun') tagged.push(sph(0.06, 5, 2, [0.16, f.top - 0.035, 0.12], '#fff4dc', { part: 'ears', scale: [1.6, 0.35, 0.8], rot: [0.25, 0, -0.3] })); // glaze shine
  if (ft.pouchBag) {
    const pc = accent ?? '#b98ad8';
    // cross-body strap (ring around the torso, tilted) + the pouch on the front hip
    tagged.push(tor(0.385, 0.018, 3, 12, [0, f.body.y + 0.02, 0], shade(pc, 0.75), { part: 'ears', rot: faceRot([-Math.sin(0.65), Math.cos(0.65), 0], [0, 0, 1]), scale: [1, 0.92, 1] }));
    const hip = onBody(f, 0.17, f.body.y - 0.08, 0.04);
    tagged.push(sph(0.11, 6, 4, hip.pos, pc, { part: 'ears', rot: hip.rot, scale: [1.15, 0.95, 0.55] }));
    const flap = onBody(f, 0.17, f.body.y - 0.03, 0.085);
    tagged.push(sph(0.112, 6, 3, flap.pos, shade(pc, 1.25), { part: 'ears', rot: flap.rot, scale: [1.18, 0.5, 0.3] }));
    tagged.push(sph(0.022, 4, 2, onBody(f, 0.17, f.body.y - 0.06, 0.12).pos, GOLD, { part: 'ears' }));
  }
  return tagged;
}

/** Face: dot eyes with a highlight, blush ovals, a tiny mouth (+ nose for a muzzle / mane). */
function faceSpecs(e, f, expression = null) {
  const { blush, eye, line, body } = e.colors;
  const ft = e.feat;
  const out = [];
  const ex = f.eye.x;
  const ey = f.eye.y;
  const er = f.eye.r;
  const my = f.mouthY;
  if (ft.muzzle) {
    const m = onHead(f, 0, my + 0.02, -0.045);
    out.push(sph(0.15, 7, 4, m.pos, shade(body, 1.35), { part: 'face', rot: m.rot, scale: [1.3, 0.8, 0.4] }));
  }
  for (const s of [-1, 1]) {
    const p = onHead(f, s * ex, ey, -0.012);
    if (expression === 'joy') out.push(tor(er * 0.8, 0.012, 3, 5, onHead(f, s * ex, ey - 0.01, 0.004).pos, eye, { part: 'face', rot: p.rot }, Math.PI));
    else {
      out.push(sph(er, 6, 4, p.pos, eye, { part: 'face', rot: p.rot, scale: [0.82, 1.18, 0.5] }));
      out.push(sph(er * 0.33, 4, 2, onHead(f, s * ex + er * 0.25, ey + er * 0.46, 0.016).pos, WHITE, { part: 'face' }));
    }
    const b = onHead(f, s * (ex + 0.135), ey - 0.085, -0.004);
    out.push(sph(0.062, 6, 3, b.pos, blush, { part: 'face', rot: b.rot, scale: [1.35, 0.72, 0.3] }));
  }
  if (ft.muzzle || ft.mane) {
    const n = onHead(f, 0, my + 0.055, 0.006);
    out.push(sph(0.03, 5, 3, n.pos, line, { part: 'face', rot: n.rot, scale: [1.3, 0.9, 0.7] }));
  }
  if (e.mouth === 'open') {
    const m = onHead(f, 0, my - 0.005, -0.006);
    out.push(sph(0.04, 6, 3, m.pos, '#7a2e3a', { part: 'face', rot: m.rot, scale: [1.05, 0.8, 0.35] }));
    out.push(sph(0.02, 4, 2, onHead(f, 0, my - 0.022, 0.006).pos, '#ff8fa3', { part: 'face', scale: [1.2, 0.6, 0.6] }));
  } else if (e.mouth === 'w') {
    for (const s of [-1, 1]) {
      const m = onHead(f, s * 0.022, my, 0.002, Math.PI);
      out.push(tor(0.022, 0.008, 3, 4, m.pos, line, { part: 'face', rot: m.rot }, Math.PI));
    }
  } else {
    const m = onHead(f, 0, my, 0.002, Math.PI);
    out.push(tor(0.028, 0.009, 3, 5, m.pos, line, { part: 'face', rot: m.rot }, Math.PI));
  }
  return out;
}

/** Body, head, arms, feet (+ vertex-painted head patterns). `raise` lifts the right paw (hand items). */
function figureSpecs(e, f, { raise = false } = {}) {
  const { body, accent } = e.colors;
  const out = [];
  const B = f.body;
  const H = f.head;
  out.push(sph(1, ...BODY_SEG, [0, B.y, 0], body, { part: 'body', scale: [B.rx, B.ry, B.rz], outline: OUTLINE.body }));
  let headPaint;
  if (e.feat.cap === 'hachiware' && accent) headPaint = { type: 'cap', color: accent };
  else if (e.feat.cap === 'bun' && accent) headPaint = { type: 'glaze', color: accent };
  out.push(sph(1, ...HEAD_SEG, [0, H.y, 0], body, { part: 'body', scale: [H.rx, H.ry, H.rz], paint: headPaint, outline: OUTLINE.head }));
  const limb = shade(body, 0.97);
  for (const s of [-1, 1]) {
    // feet
    out.push(sph(0.1, 5, 3, [s * 0.14, 0.045, 0.11], limb, { part: 'body', scale: [1.15, 0.55, 1.3] }));
    // arms: hanging stubs; the right paw (−x) is raised when it holds an item
    if (raise && s === -1) out.push(sph(0.085, 6, 4, [-(B.rx + 0.035), B.y + 0.12, 0.09], limb, { part: 'body', scale: [0.95, 1.45, 0.9], rot: [0.25, 0, 0.95] }));
    else out.push(sph(0.085, 6, 4, [s * (B.rx - 0.01), B.y + 0.01, 0.07], limb, { part: 'body', scale: [0.95, 1.45, 0.9], rot: [0, 0, s * 0.5] }));
  }
  return out;
}

// ---------------------------------------------------------------- props

/** Default main colour per prop id (props.json `color` / the character accent for `tintable` props win). */
export const PROP_DEFAULT_COLORS = {
  ribbon: '#ff5c8a', flower_pin: '#ff8fb1', beanie: '#5b8def', straw_hat: '#f2d27a', crown: GOLD, headband: '#ff7aa8', beret: '#d8434a',
  party_hat: '#9a6ad6', flower_crown: '#ffb3d1', bonnet: '#ffe1ec', yellow_hat: '#ffd23f', school_cap: '#25304f', knit_cap: '#c7774d',
  head_mirror: '#c9ccd4', chef_hat: '#fbfbf8', police_cap: '#2f3f66', baseball_cap: '#e2504c', fighter_headband: '#fbfbf8', headset: DARK,
  space_helmet: '#eef2f8',
  round_glasses: '#3a2f2f', sunglasses: '#1d1d22', star_glasses: '#ffcf3a', mask: '#f7f7f7', heart_sticker: '#ff8fb1', pacifier: '#7fc8ff',
  beard: '#f4f4f0',
  bow_tie: '#d8434a', scarf: '#ff8a3d', bell_collar: '#e2504c', bandana: '#4f8ee0', necklace: '#f3efe6', necktie: '#34467a', stethoscope: '#5a6272',
  sash: '#e2504c', id_card: '#4f8ee0', apron: '#7bc67e',
  balloon: '#ff6b8a', flower: '#ff8fb1', lollipop: '#ff5c8a', wand: '#ffd43b', fishing_rod: '#8b5a2b', book: '#4f8ee0', umbrella: '#7ec8e3',
  cane: '#8b5a2b', mic: '#3a3a42', bat: '#c9965c', soccer_ball: WHITE, camera: '#3a3a42', pen: '#4f8ee0', flask: '#5cd68a', script: '#fbf8f2',
  key_ring: GOLD, sparkle_mic: '#ff7eb6', golden_mic: GOLD,
  backpack: '#ff8a3d', cape: '#d8434a', wings: '#fdfbff', teddy_bag: '#b07a4e', school_backpack: '#d8434a',
};

const hatBeanie = (f, c) => {
  const H = f.head;
  const g = 1.07;
  const frac = 0.42;
  const yEdge = H.y + Math.cos(Math.PI * frac) * H.ry * g;
  const rEdge = Math.sin(Math.PI * frac) * H.rx * g;
  return [
    cap(10, 4, frac, [0, H.y, 0], [H.rx * g, H.ry * g, H.rz * g], c),
    cyl(rEdge * 1.03, rEdge * 1.05, 0.08, 12, [0, yEdge + 0.01, 0], shade(c, 0.82), { scale: [1, 1, H.rz / H.rx] }, true),
    sph(0.07, 5, 3, [0, H.y + H.ry * g + 0.045, 0], shade(c, 1.35)),
  ];
};
const domeCap = (f, c, frac = 0.4, g = 1.06) => {
  const H = f.head;
  return { spec: cap(10, 4, frac, [0, H.y, 0], [H.rx * g, H.ry * g, H.rz * g], c, { rot: [-0.12, 0, 0] }), yEdge: H.y + Math.cos(Math.PI * frac) * H.ry * g, zEdge: Math.sin(Math.PI * frac) * H.rz * g };
};
const lens = (f, s, lift = 0.022) => onHead(f, s * f.eye.x, f.eye.y + 0.005, lift);
/** Euler of R(a)·R(b) (b applied first). */
function rotCompose(a, b) {
  const X = rotateXYZ(rotateXYZ([1, 0, 0], b), a);
  const Y = rotateXYZ(rotateXYZ([0, 1, 0], b), a);
  const Z = rotateXYZ(rotateXYZ([0, 0, 1], b), a);
  return eulerFromAxes(X, Y, Z);
}
/** 5-point star in the local xy plane of `rot` (facing its local +z). */
const starAt = (pos, rot, r, color) => {
  const out = [cyl(r * 0.55, r * 0.55, r * 0.35, 5, pos, color, { rot: rotCompose(rot, [Math.PI / 2, 0, 0]) })];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    const d = rotateXYZ([Math.sin(a), Math.cos(a), 0], rot);
    out.push(cone(r * 0.32, r * 0.62, 3, add3(pos, d, r * 0.62), color, { rot: axisRot(d, rotateXYZ([0, 0, 1], rot)) }));
  }
  return out;
};
const ring = (f, r, t, rs, ts, color, dy = 0, arc = TAU) => tor(f.neck.rx + r, t, rs, ts, [0, f.neck.y + dy, 0], color, { rot: [Math.PI / 2, 0, 0], scale: [1, (f.neck.rz + r) / (f.neck.rx + r), 1] }, arc);
const headBand = (f, c, k = 0.5) => {
  const y = f.head.y + f.head.ry * k;
  return { y, spec: tor(f.head.rx * f.headRAt(y) + 0.012, 0.03, 3, 12, [0, y, 0], c, { rot: [Math.PI / 2, 0, 0], scale: [1, f.head.rz / f.head.rx, 1] }) };
};
const MIC_DIR = [0.35, 0.8, 0.45];
const micSpecs = (f, handle, head, extra = []) => {
  const h = f.hand;
  const d = norm(MIC_DIR);
  const top = add3(h, d, 0.17);
  return [rod(add3(h, [0, -0.02, 0]), top, 0.026, 0.017, 6, handle), sph(0.047, 6, 4, add3(top, d, 0.035), head), ...extra];
};
const flowerHead = (pos, c, r = 0.05, n = 5) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    out.push(sph(r * 0.84, 4, 3, add3(pos, [Math.cos(a) * r, Math.sin(a) * r, 0.0]), c));
  }
  out.push(sph(r * 0.64, 4, 2, add3(pos, [0, 0, 0.025]), GOLD));
  return out;
};

const PROP_BUILDERS = {
  // ---- head ----
  ribbon: (f, c) => {
    const p = onHead(f, 0.22, f.top - 0.06, 0.03).pos;
    return [cone(0.08, 0.15, 5, [p[0] - 0.075, p[1], p[2]], c, { rot: [0, 0, Math.PI / 2 + 0.2] }), cone(0.08, 0.15, 5, [p[0] + 0.075, p[1], p[2]], c, { rot: [0, 0, -Math.PI / 2 + 0.2] }), sph(0.04, 5, 3, p, shade(c, 0.85))];
  },
  flower_pin: (f, c) => {
    const p = onHead(f, 0.3, f.head.y + 0.2, 0.02);
    const out = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      out.push(sph(0.042, 4, 3, add3(p.pos, rotateXYZ([Math.cos(a) * 0.05, Math.sin(a) * 0.05, 0], p.rot)), c));
    }
    out.push(sph(0.032, 4, 2, add3(p.pos, p.n, 0.012), GOLD));
    return out;
  },
  flower_crown: (f, c) => {
    const band = headBand(f, '#6cbf5a', 0.62);
    const r = band.spec.args[0];
    const out = [{ ...band.spec, args: [r, 0.02, 3, 10] }];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + Math.PI / 4;
      const pos = [Math.sin(a) * r, band.y + 0.02, Math.cos(a) * r * (f.head.rz / f.head.rx)];
      out.push(sph(0.05, 4, 3, pos, i % 2 ? c : shade(c, 1.3)), sph(0.025, 4, 2, add3(pos, [0, 0.035, 0]), GOLD));
    }
    return out;
  },
  beanie: (f, c) => hatBeanie(f, c),
  knit_cap: (f, c) => hatBeanie(f, c),
  straw_hat: (f, c) => {
    const rg = ringAt(f, 0.08);
    const k = rg.kz;
    return [
      cyl(0.52, 0.52, 0.025, 12, [0, rg.y, 0], c, { scale: [1, 1, k] }),
      cyl(rg.r * 0.92, rg.r + 0.02, 0.17, 10, [0, rg.y + 0.095, 0], c, { scale: [1, 1, k] }),
      cyl(rg.r + 0.025, rg.r + 0.03, 0.05, 10, [0, rg.y + 0.04, 0], '#d8434a', { scale: [1, 1, k] }, true),
    ];
  },
  crown: (f, c) => {
    const y = f.top - 0.02;
    const out = [cyl(0.2, 0.22, 0.12, 10, [0, y + 0.04, 0], c, {}, true)];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      out.push(cone(0.045, 0.1, 4, [Math.sin(a) * 0.2, y + 0.15, Math.cos(a) * 0.2], c));
    }
    out.push(sph(0.03, 4, 3, [0, y + 0.04, 0.215], '#e2504c'), sph(0.025, 4, 2, [0.15, y + 0.04, 0.15], '#4f8ee0'), sph(0.025, 4, 2, [-0.15, y + 0.04, 0.15], '#4f8ee0'));
    return out;
  },
  headband: (f, c) => {
    const band = headBand(f, c, 0.5);
    return [band.spec, ...PROP_BUILDERS.ribbon(f, shade(c, 0.9)).map((s) => ({ ...s, pos: [s.pos[0] - 0.05, s.pos[1] - 0.02, s.pos[2] + 0.02] }))];
  },
  fighter_headband: (f, c) => {
    const band = headBand(f, c, 0.45);
    const front = onHead(f, 0, band.y, 0.035);
    return [
      band.spec,
      cyl(0.055, 0.055, 0.012, 8, front.pos, '#e2504c', { rot: rotCompose(front.rot, [Math.PI / 2, 0, 0]) }),
      box(0.05, 0.2, 0.012, [0.06, band.y - 0.08, -f.head.rz - 0.02], c, { rot: [0.3, 0, 0.35] }),
      box(0.05, 0.18, 0.012, [-0.05, band.y - 0.07, -f.head.rz - 0.02], c, { rot: [0.3, 0, -0.25] }),
    ];
  },
  beret: (f, c) => [
    sph(0.36, 10, 4, [0.04, f.top - 0.02, -0.02], c, { scale: [f.head.rx / 0.5, 0.3, f.head.rz / 0.45], rot: [0, 0, 0.18] }),
    cyl(0.012, 0.016, 0.05, 4, [0.05, f.top + 0.09, -0.02], shade(c, 0.8), { rot: [0, 0, 0.18] }),
  ],
  party_hat: (f, c) => {
    const base = [0.1, f.top + 0.13, 0];
    const rot = [0, 0, -0.25];
    return [S('cyl', [0, 0.15, 0.36, 10, 3], base, c, { rot, paint: { type: 'bands', color: WHITE, n: 3, y0: -0.18, y1: 0.18 } }), sph(0.045, 5, 3, add3(base, rotateXYZ([0, 0.19, 0], rot)), '#ffd23f')];
  },
  bonnet: (f, c) => {
    const H = f.head;
    const g = 1.08;
    const p = onHead(f, 0, H.y - H.ry * 0.78, 0.03);
    return [
      cap(10, 5, 0.6, [0, H.y, 0], [H.rx * g, H.ry * g, H.rz * g], c, { rot: [-0.9, 0, 0] }),
      cone(0.05, 0.09, 4, [p.pos[0] - 0.05, p.pos[1], p.pos[2]], shade(c, 0.85), { rot: [0, 0, Math.PI / 2] }),
      cone(0.05, 0.09, 4, [p.pos[0] + 0.05, p.pos[1], p.pos[2]], shade(c, 0.85), { rot: [0, 0, -Math.PI / 2] }),
    ];
  },
  yellow_hat: (f, c) => {
    const H = f.head;
    const d = domeCap(f, c, 0.42, 1.08);
    const rEdge = Math.sin(Math.PI * 0.42) * H.rx * 1.08;
    return [{ ...d.spec, rot: [0, 0, 0] }, cyl(rEdge, rEdge * 1.32, 0.07, 12, [0, d.yEdge - 0.025, 0], shade(c, 0.95), { scale: [1, 1, H.rz / H.rx] }, true)];
  },
  school_cap: (f, c) => {
    const d = domeCap(f, c, 0.38, 1.06);
    return [d.spec, box(0.3, 0.022, 0.2, [0, d.yEdge + 0.02, d.zEdge + 0.06], shade(c, 0.6), { rot: [0.18, 0, 0] }), sph(0.028, 4, 2, onHead(f, 0, d.yEdge + 0.1, 0.05).pos, GOLD)];
  },
  baseball_cap: (f, c) => {
    const d = domeCap(f, c, 0.4, 1.06);
    return [d.spec, box(0.3, 0.022, 0.24, [0, d.yEdge + 0.02, d.zEdge + 0.08], shade(c, 0.82), { rot: [0.12, 0, 0] }), sph(0.028, 4, 2, [0, f.head.y + f.head.ry * 1.06 + 0.005, -0.04], shade(c, 0.8))];
  },
  police_cap: (f, c) => {
    const rg = ringAt(f, 0.1);
    const k = rg.kz;
    const r = rg.r + 0.015;
    return [
      cyl(r + 0.05, r, 0.15, 12, [0, rg.y + 0.075, 0], c, { scale: [1, 1, k] }),
      box(0.3, 0.022, 0.18, [0, rg.y + 0.01, r * k + 0.06], '#141820', { rot: [0.2, 0, 0] }),
      sph(0.032, 4, 3, [0, rg.y + 0.09, (r + 0.03) * k + 0.01], GOLD),
    ];
  },
  chef_hat: (f, c) => {
    const rg = ringAt(f, 0.09);
    const r = rg.r + 0.01;
    return [cyl(r, r, 0.22, 12, [0, rg.y + 0.11, 0], c, { scale: [1, 1, rg.kz] }, true), sph(0.34, 10, 4, [0, rg.y + 0.26, 0], c, { scale: [1, 0.55, rg.kz] })];
  },
  head_mirror: (f, c) => {
    const band = headBand(f, '#3a3a42', 0.5);
    const front = onHead(f, 0.08, band.y + 0.02, 0.03);
    return [
      { ...band.spec, args: [band.spec.args[0], 0.022, 3, 12] },
      cyl(0.085, 0.085, 0.016, 8, add3(front.pos, front.n, 0.02), c, { rot: rotCompose(front.rot, [Math.PI / 2, 0, 0]) }),
      sph(0.022, 4, 2, add3(front.pos, front.n, 0.032), DARK),
    ];
  },
  headset: (f, c) => {
    const H = f.head;
    const out = [tor(H.rx + 0.03, 0.03, 3, 10, [0, H.y, 0], c, { scale: [1, (H.ry + 0.03) / (H.rx + 0.03), 1] }, Math.PI)];
    for (const s of [-1, 1]) out.push(cyl(0.1, 0.1, 0.07, 6, [s * (H.rx + 0.01), H.y - 0.02, 0], c, { rot: [0, 0, Math.PI / 2] }));
    const a = [-(H.rx + 0.02), H.y - 0.06, 0.06];
    const b = [-(H.rx - 0.12), H.y - 0.17, 0.32];
    out.push(rod(a, b, 0.013, 0.013, 4, c), sph(0.03, 4, 3, b, '#5ce1e6'));
    return out;
  },
  space_helmet: (f, c) => {
    const H = f.head;
    const g = 1.22;
    return [
      S('sphere', [1, 8, 5, Math.PI, Math.PI], [0, H.y, -0.02], c, { scale: [H.rx * g, H.ry * g, H.rz * g] }),
      tor(H.rx * g, 0.05, 3, 12, [0, H.y, 0.02], '#9aa5b1', { scale: [1, H.ry / H.rx, 1] }),
      rod([0.15, H.y + H.ry * g - 0.04, -0.05], [0.2, H.y + H.ry * g + 0.14, -0.05], 0.01, 0.01, 4, '#9aa5b1'),
      sph(0.03, 4, 2, [0.2, H.y + H.ry * g + 0.16, -0.05], '#e2504c'),
    ];
  },
  // ---- face ----
  round_glasses: (f, c) => {
    const out = [];
    for (const s of [-1, 1]) {
      const l = lens(f, s);
      out.push(tor(0.075, 0.012, 3, 8, l.pos, c, { rot: l.rot }));
    }
    out.push(box(2 * (f.eye.x - 0.075) + 0.02, 0.016, 0.016, onHead(f, 0, f.eye.y + 0.015, 0.03).pos, c));
    return out;
  },
  sunglasses: (f, c) => {
    const out = [];
    for (const s of [-1, 1]) {
      const l = lens(f, s, 0.025);
      out.push(box(0.16, 0.09, 0.025, l.pos, c, { rot: l.rot }));
    }
    out.push(box(2 * (f.eye.x - 0.08) + 0.02, 0.02, 0.02, onHead(f, 0, f.eye.y + 0.025, 0.03).pos, c));
    return out;
  },
  star_glasses: (f, c) => {
    const out = [];
    for (const s of [-1, 1]) {
      const l = lens(f, s, 0.03);
      out.push(...starAt(l.pos, l.rot, 0.085, s < 0 ? c : '#ff7eb6'));
    }
    out.push(box(2 * (f.eye.x - 0.08) + 0.02, 0.016, 0.016, onHead(f, 0, f.eye.y + 0.01, 0.035).pos, c));
    return out;
  },
  mask: (f, c) => {
    const m = onHead(f, 0, f.mouthY + 0.005, 0.0);
    return [sph(0.13, 8, 4, m.pos, c, { rot: m.rot, scale: [1.3, 0.78, 0.38] }), ...[-1, 1].map((s) => box(0.11, 0.012, 0.012, onHead(f, s * 0.2, f.mouthY + 0.03, 0.006).pos, c, { rot: [0, s * -0.7, s * -0.15] }))];
  },
  heart_sticker: (f, c) => {
    const p = onHead(f, f.eye.x + 0.15, f.eye.y - 0.05, 0.012);
    const lobe = (dx) => sph(0.032, 5, 3, add3(p.pos, rotateXYZ([dx, 0.015, 0], p.rot)), c, { rot: p.rot, scale: [1, 1, 0.45] });
    return [lobe(-0.024), lobe(0.024), cone(0.05, 0.06, 4, add3(p.pos, rotateXYZ([0, -0.03, 0], p.rot)), c, { rot: rotCompose(p.rot, [Math.PI, 0, 0]), scale: [1, 1, 0.3] })];
  },
  pacifier: (f, c) => {
    const m = onHead(f, 0, f.mouthY, 0.012);
    return [cyl(0.065, 0.065, 0.016, 8, m.pos, c, { rot: rotCompose(m.rot, [Math.PI / 2, 0, 0]) }), tor(0.04, 0.012, 3, 8, add3(add3(m.pos, m.n, 0.03), [0, -0.035, 0]), shade(c, 0.8), { rot: m.rot })];
  },
  beard: (f, c) => {
    const m = onHead(f, 0, f.mouthY - 0.07, 0.04);
    return [
      cone(0.18, 0.34, 8, [0, m.pos[1] - 0.12, m.pos[2] - 0.02], c, { rot: [Math.PI - 0.35, 0, 0], scale: [1, 1, 0.55] }),
      ...[-1, 1].map((s) => sph(0.06, 6, 4, onHead(f, s * 0.05, f.mouthY + 0.03, 0.03).pos, c, { scale: [1.3, 0.7, 0.7], rot: [0, 0, s * 0.3] })),
    ];
  },
  // ---- neck ----
  bow_tie: (f, c) => {
    const y = f.neck.y - 0.03;
    const z = f.neck.z + 0.01;
    return [cone(0.07, 0.12, 5, [-0.07, y, z], c, { rot: [0, 0, Math.PI / 2] }), cone(0.07, 0.12, 5, [0.07, y, z], c, { rot: [0, 0, -Math.PI / 2] }), box(0.05, 0.05, 0.04, [0, y, z + 0.01], shade(c, 0.8))];
  },
  scarf: (f, c) => [ring(f, 0.02, 0.06, 4, 12, c), box(0.1, 0.22, 0.045, [0.13, f.neck.y - 0.13, f.neck.z + 0.04], shade(c, 0.9), { rot: [0.25, 0, 0.12] })],
  bell_collar: (f, c) => [ring(f, 0, 0.032, 3, 12, '#e2504c'), sph(0.055, 6, 4, [0, f.neck.y - 0.06, f.neck.z + 0.04], c)],
  bandana: (f, c) => [ring(f, 0, 0.024, 3, 12, c), cone(0.18, 0.22, 4, [0, f.neck.y - 0.1, f.neck.z + 0.01], c, { rot: axisRot([0, -1, 0.4]), scale: [1.1, 1, 0.45] })],
  necklace: (f, c) => [ring(f, 0.005, 0.014, 3, 12, c, -0.03), sph(0.036, 5, 4, [0, f.neck.y - 0.1, f.neck.z + 0.02], '#ff7eb6')],
  necktie: (f, c) => {
    const mid = onBody(f, 0, f.neck.y - 0.17, 0.016);
    const tip = onBody(f, 0, f.neck.y - 0.3, 0.016);
    return [box(0.065, 0.055, 0.035, [0, f.neck.y - 0.03, f.neck.z + 0.01], shade(c, 0.85)), box(0.075, 0.24, 0.02, mid.pos, c, { rot: mid.rot }), cone(0.053, 0.06, 4, tip.pos, c, { rot: rotCompose(tip.rot, [Math.PI, 0, 0]), scale: [1, 1, 0.4] })];
  },
  stethoscope: (f, c) => {
    const chest = onBody(f, 0.1, f.body.y + 0.07, 0.02);
    return [
      ring(f, 0.005, 0.014, 3, 10, c, -0.02, Math.PI),
      rod([f.neck.rx * 0.7, f.neck.y - 0.03, f.neck.rz * 0.7], chest.pos, 0.012, 0.012, 4, c),
      cyl(0.045, 0.045, 0.02, 8, add3(chest.pos, chest.n, 0.01), '#c9ccd4', { rot: rotCompose(chest.rot, [Math.PI / 2, 0, 0]) }),
    ];
  },
  sash: (f, c) => {
    const a = 0.75;
    return [tor(0.385, 0.035, 3, 12, [0, f.body.y + 0.03, 0], c, { rot: faceRot([-Math.sin(a), Math.cos(a), 0], [0, 0, 1]), scale: [1, 0.93, 1] }), sph(0.05, 5, 4, onBody(f, -0.12, f.body.y + 0.12, 0.04).pos, '#e2504c')];
  },
  id_card: (f, c) => {
    const card = onBody(f, 0, f.body.y + 0.02, 0.02);
    return [
      tor(0.13, 0.01, 3, 10, [0, f.neck.y - 0.02, f.neck.z - 0.02], c, { rot: [-0.45, 0, Math.PI], scale: [1, 1.5, 1] }, Math.PI),
      box(0.12, 0.15, 0.014, card.pos, WHITE, { rot: card.rot }),
      box(0.05, 0.06, 0.016, add3(card.pos, [-0.025, 0.025, 0.002]), c, { rot: card.rot }),
    ];
  },
  apron: (f, c) => {
    const B = f.body;
    const r = B.rx + 0.03;
    return [
      S('cyl', [r * 0.95, r * 1.03, 0.3, 8, 1, true, -0.85, 1.7], [0, B.y - 0.03, 0], c, { scale: [1, 1, (B.rz + 0.03) / r] }),
      tor(0.13, 0.014, 3, 8, add3(onBody(f, 0, B.y + 0.12).pos, [0, 0, 0.02]), c, { rot: [-0.5, 0, 0] }, Math.PI),
      box(0.12, 0.08, 0.02, onBody(f, 0, B.y - 0.06, 0.05).pos, shade(c, 0.85)),
    ];
  },
  // ---- hand (the raised right paw) ----
  balloon: (f, c) => {
    const h = f.hand;
    const b = [h[0] - 0.14, h[1] + 0.78, h[2] - 0.06];
    return [rod(h, [b[0], b[1] - 0.2, b[2]], 0.006, 0.006, 3, '#6b6b6b'), sph(0.17, 8, 6, b, c, { scale: [1, 1.15, 1] }), cone(0.03, 0.04, 4, [b[0], b[1] - 0.2, b[2]], c, { rot: [Math.PI, 0, 0] })];
  },
  flower: (f, c) => {
    const h = f.hand;
    const top = add3(h, norm([-0.15, 1, 0.25]), 0.24);
    return [rod(h, top, 0.012, 0.012, 4, '#5cb87a'), ...flowerHead(add3(top, [0, 0, 0.01]), c)];
  },
  lollipop: (f, c) => {
    const h = f.hand;
    const top = add3(h, [0, 0.26, 0.02]);
    return [rod(h, top, 0.01, 0.01, 4, WHITE), cyl(0.1, 0.1, 0.035, 12, add3(top, [0, 0.08, 0]), WHITE, { rot: [Math.PI / 2, 0, 0], paint: { type: 'swirl', color: c, n: 3, twist: 14 } })];
  },
  wand: (f, c) => {
    const h = f.hand;
    const top = add3(h, norm([-0.2, 1, 0.3]), 0.3);
    return [rod(h, top, 0.012, 0.016, 4, '#ff8fb1'), ...starAt(add3(top, [0, 0.05, 0]), [0, 0, 0], 0.07, c)];
  },
  fishing_rod: (f, c) => {
    const h = f.hand;
    const tip = add3(h, norm([-0.25, 0.8, 0.55]), 0.95);
    const end = add3(tip, [0, -0.45, 0]);
    return [rod(h, tip, 0.008, 0.016, 4, c), rod(tip, end, 0.004, 0.004, 3, '#e8e8e8'), sph(0.035, 6, 4, end, WHITE, { paint: { type: 'half', color: '#e2504c' } })];
  },
  book: (f, c) => {
    const p = add3(f.hand, [0.02, 0.04, 0.05]);
    const rot = [0.15, 0.5, 0.1];
    return [box(0.17, 0.22, 0.05, p, c, { rot }), box(0.155, 0.205, 0.054, add3(p, rotateXYZ([0.012, 0, 0], rot)), WHITE, { rot })];
  },
  umbrella: (f, c) => {
    const h = f.hand;
    const top = add3(h, [0.04, 0.62, -0.02]);
    return [
      rod(add3(h, [0, -0.06, 0]), top, 0.012, 0.012, 4, '#8a6a4a'),
      S('cyl', [0, 0.36, 0.17, 8, 2], add3(top, [0, -0.05, 0]), c, { paint: { type: 'swirl', color: WHITE, n: 4, twist: 0 } }),
      tor(0.035, 0.012, 3, 5, add3(h, [-0.035, -0.07, 0]), '#8a6a4a', { rot: [0, 0, Math.PI] }, Math.PI),
    ];
  },
  cane: (f, c) => {
    const h = f.hand;
    const top = [h[0] - 0.02, h[1] + 0.04, h[2] + 0.02];
    return [rod([h[0] - 0.02, 0.0, h[2] + 0.06], top, 0.018, 0.018, 5, c), tor(0.055, 0.018, 3, 6, [top[0] - 0.055, top[1], top[2]], c, {}, Math.PI)];
  },
  mic: (f, c) => micSpecs(f, c, '#c9ccd4'),
  sparkle_mic: (f, c) => {
    const out = micSpecs(f, c, shade(c, 1.4));
    const h = f.hand;
    for (const [dx, dy] of [[0.12, 0.3], [-0.1, 0.38], [0.02, 0.48]]) {
      const p = add3(h, [dx, dy, 0.1]);
      out.push(cone(0.022, 0.07, 4, p, '#fff3a0'), cone(0.022, 0.07, 4, p, '#fff3a0', { rot: [0, 0, Math.PI / 2] }));
    }
    return out;
  },
  golden_mic: (f, c) => micSpecs(f, c, shade(c, 1.3), [tor(0.03, 0.01, 3, 8, add3(f.hand, norm(MIC_DIR), 0.12), '#e2504c', { rot: faceRot(MIC_DIR) })]),
  bat: (f, c) => [rod(add3(f.hand, [0, -0.04, 0]), add3(f.hand, norm([0.25, 0.85, -0.45]), 0.55), 0.024, 0.045, 6, c)],
  soccer_ball: (f, c) => [sph(0.13, 9, 6, [f.hand[0] + 0.02, 0.13, f.hand[2] + 0.2], c, { paint: { type: 'soccer', color: DARK } })],
  camera: (f, c) => {
    const p = add3(f.hand, [0.03, 0.06, 0.08]);
    const rot = [0, 0.35, 0];
    return [box(0.2, 0.13, 0.1, p, c, { rot }), cyl(0.045, 0.05, 0.08, 8, add3(p, rotateXYZ([0, 0, 0.08], rot)), '#8fb7e8', { rot: rotCompose(rot, [Math.PI / 2, 0, 0]) }), box(0.05, 0.03, 0.04, add3(p, [0.04, 0.08, 0]), shade(c, 1.4))];
  },
  pen: (f, c) => {
    const h = f.hand;
    const d = norm([0.2, 0.9, 0.35]);
    const top = add3(h, d, 0.2);
    return [rod(add3(h, d, -0.03), top, 0.016, 0.016, 5, c), cone(0.016, 0.05, 5, add3(top, d, 0.025), DARK, { rot: axisRot(d) })];
  },
  flask: (f, c) => {
    const p = add3(f.hand, [0, 0.08, 0.06]);
    return [sph(0.075, 8, 5, p, '#e6f6ff', { paint: { type: 'liquid', color: c, level: 0.15 } }), cyl(0.025, 0.03, 0.1, 6, add3(p, [0, 0.11, 0]), '#e6f6ff', {}, true)];
  },
  script: (f, c) => {
    const h = f.hand;
    const d = norm([0.3, 0.9, 0.3]);
    return [rod(add3(h, d, -0.1), add3(h, d, 0.14), 0.04, 0.04, 8, c), cyl(0.043, 0.043, 0.04, 8, add3(h, d, 0.02), '#d8434a', { rot: axisRot(d) }, true)];
  },
  key_ring: (f, c) => {
    const p = add3(f.hand, [0, -0.06, 0.07]);
    const out = [tor(0.055, 0.012, 3, 8, p, c)];
    for (const s of [-1, 1]) {
      const k = add3(p, [s * 0.04, -0.09, 0.01]);
      out.push(cyl(0.026, 0.026, 0.012, 6, add3(k, [0, 0.04, 0]), '#c9ccd4', { rot: [Math.PI / 2, 0, 0] }), box(0.018, 0.08, 0.01, add3(k, [0, -0.02, 0]), '#c9ccd4', { rot: [0, 0, s * 0.2] }));
    }
    return out;
  },
  // ---- back ----
  backpack: (f, c) => {
    const B = f.body;
    const out = [sph(0.21, 7, 4, [0, B.y + 0.07, -B.rz - 0.06], c, { scale: [1.15, 1.2, 0.62] }), sph(0.1, 5, 3, [0, B.y - 0.02, -B.rz - 0.17], shade(c, 0.85), { scale: [1.3, 0.9, 0.5] })];
    for (const s of [-1, 1]) {
      const st = onBody(f, s * 0.16, B.y + 0.13, 0.012);
      out.push(box(0.035, 0.2, 0.02, st.pos, shade(c, 0.75), { rot: st.rot }));
    }
    return out;
  },
  teddy_bag: (f, c) => {
    const B = f.body;
    const z = -B.rz - 0.1;
    const y = B.y + 0.1;
    const out = [sph(0.16, 6, 5, [0, y, z], c, { scale: [1.1, 1, 0.75] }), sph(0.06, 4, 3, [0, y - 0.03, z - 0.12], shade(c, 1.35))];
    for (const s of [-1, 1]) out.push(sph(0.055, 4, 3, [s * 0.13, y + 0.13, z], c));
    for (const s of [-1, 1]) {
      const st = onBody(f, s * 0.16, B.y + 0.13, 0.012);
      out.push(box(0.035, 0.2, 0.02, st.pos, shade(c, 0.7), { rot: st.rot }));
    }
    return out;
  },
  school_backpack: (f, c) => {
    const B = f.body;
    const z = -B.rz - 0.09;
    const out = [box(0.32, 0.36, 0.16, [0, B.y + 0.08, z], c), box(0.33, 0.24, 0.03, [0, B.y + 0.15, z - 0.085], shade(c, 0.85)), box(0.06, 0.04, 0.02, [0, B.y + 0.04, z - 0.1], GOLD)];
    for (const s of [-1, 1]) {
      const st = onBody(f, s * 0.16, B.y + 0.13, 0.012);
      out.push(box(0.035, 0.2, 0.02, st.pos, shade(c, 0.7), { rot: st.rot }));
    }
    return out;
  },
  cape: (f, c) => {
    const B = f.body;
    const t0 = Math.PI / 2 + 0.25;
    const tl = Math.PI - 0.5;
    return [
      S('cyl', [0.33, 0.48, 0.62, 10, 1, true, t0, tl], [0, B.y + 0.1, -0.02], c),
      S('cyl', [0.325, 0.475, 0.62, 10, 1, true, t0, tl], [0, B.y + 0.1, -0.02], shade(c, 0.7), { flip: true }),
      sph(0.035, 4, 3, [0, f.neck.y - 0.02, f.neck.z + 0.01], GOLD),
    ];
  },
  wings: (f, c) => {
    const B = f.body;
    return [-1, 1].map((s) => sph(0.21, 7, 4, [s * 0.22, B.y + 0.24, -B.rz - 0.04], c, { scale: [0.46, 1.1, 0.16], rot: axisRot([s * 0.65, 0.75, -0.15], [0, 0, -1]), paint: { type: 'tip', at: 0.45, color: '#dcecff' } }));
  },
};
/** Generic shape per slot for a prop id without a builder. */
const SLOT_FALLBACK = { head: 'beret', face: 'round_glasses', neck: 'bandana', hand: 'wand', back: 'backpack' };
export const PROP_BUILDER_IDS = Object.keys(PROP_BUILDERS);

/** Builder id used for a prop (its own, else the slot's generic shape). */
export function propBuilderId(id, slot) {
  if (Object.prototype.hasOwnProperty.call(PROP_BUILDERS, id)) return id;
  return SLOT_FALLBACK[slot] ?? 'wand';
}
/** Specs of one prop on a figure frame (tagged `part: 'prop:<slot>'`). `entry` = the wearer (tintable colour). */
export function propSpecs(id, slot, f, defs = null, entry = null) {
  const bid = propBuilderId(id, slot);
  return PROP_BUILDERS[bid](f, propColor(id, defs, entry)).map((s) => ({ ...s, part: `prop:${slot}` }));
}

/** Uniformly scale specs about the feet (y = 0) — the roster `size`. */
function scaleSpecs(specs, k) {
  if (k === 1) return specs;
  for (const s of specs) {
    s.pos = s.pos.map((v) => v * k);
    s.scale = (s.scale ?? [1, 1, 1]).map((v) => v * k);
    if (s.outline) s.outline *= k;
  }
  return specs;
}

/**
 * Specs of a roster look `{character, props}` (NPC / pet looks → the default roster figure).
 * @param {{expression?: 'joy'}} opts  'joy' = closed happy eyes (podium winner)
 */
export function charaSpecs(look, defs = null, opts = {}) {
  const n = normalizeLook(look, defs);
  const e = rosterEntry(n.character, defs);
  const f = charaFrame(e);
  const raise = !!n.props.hand && propBuilderId(n.props.hand, 'hand') !== 'soccer_ball';
  const specs = [...figureSpecs(e, f, { raise }), ...earSpecs(e, f), ...faceSpecs(e, f, opts.expression)];
  for (const slot of PROP_SLOTS) if (n.props[slot]) specs.push(...propSpecs(n.props[slot], slot, f, defs, e));
  for (const s of specs) {
    s.pos = s.pos.map(r4);
    if (s.rot) s.rot = s.rot.map(r4);
  }
  return scaleSpecs(specs, e.size);
}

/** Line (outline) colour of a look. */
export function lineColor(look, defs = null) {
  return rosterEntry(normalizeLook(look, defs).character, defs).colors.line;
}
const TALL_HATS = new Set(['party_hat', 'chef_hat', 'crown', 'space_helmet', 'straw_hat', 'police_cap']);
/** Name-tag height of a look (head top incl. ears / hats, not hand items) in pawn units before the board scale. */
export function charaHeight(look, defs = null) {
  const n = normalizeLook(look, defs);
  const e = rosterEntry(n.character, defs);
  const f = charaFrame(e);
  const hat = n.props.head ? (TALL_HATS.has(propBuilderId(n.props.head, 'head')) ? 0.2 : 0.06) : 0;
  return (Math.max(f.crown, f.top + hat) + 0.02) * e.size;
}

/** Legacy avatars.json defs inside `defs` (the whole meta or the avatars defs themselves). */
const avatarDefs = (defs) => (defs?.parts ? defs : defs?.avatars?.parts ? defs.avatars : null);

/**
 * Primitive specs for a character look: a roster look → the Chiikawa-style pawn; an old human avatar → LEGACY human
 * pawn (kept for the legacy avatar tests; game code normalises looks first, see `pawnLook`); anything else → the
 * default roster character.
 */
export function pawnSpecs(avatar, defs = null, opts = {}) {
  if (isHumanAvatar(avatar)) return humanSpecs(avatar, avatarDefs(defs));
  return charaSpecs(avatar ?? {}, defs, opts);
}

/** The look the game draws for any avatar value (old human avatars → the same roster pick as the 2D renderer). */
export function pawnLook(avatar, defs = null) {
  return normalizeLook(avatar, defs);
}
