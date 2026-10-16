// Chiikawa conversion (CH-1) — animation framework for the character rigs (ui/chara.js).
//
// Three techniques, one module:
//   1. cut-out rig: `samplePose(action, t)` = pure timing math (node-tested) → per-part transforms (root squash & stretch /
//      hop, head tilt, arms, ears, tail, eyes / mouth) applied to the `[data-rig]` groups of a chara SVG by `createRig`
//      (one shared requestAnimationFrame ticker for every animated figure; the idle breathing / ear twitch / tail wag run
//      as CSS animations on inner groups, blinking on a 2–5 s timer).
//   2. sprite sheets: `spriteFrame` / `spriteBgPos` (pure) + `createSpritePlayer` — `ch-<id>-sheet-<action>` art (meta
//      {grid: [cols, rows], frames, fps, loop}) replaces the rig for that action once it is accepted.
//   3. procedural effects: `squashStretch`, `jelly`, `shakeOffset` / `shakeKeyframes` + `screenShake`, particles
//      (`spawnParticles` → `particlesSvg`: tears / sweat / hearts / sparkles / stars as CSS-animated SVG), parallax
//      (`parallaxOffset`, `parallaxLayers`, `attachParallax` for `bg-<scene>-far|mid|near`; a single bg drifts / zooms).
// Everything respects `prefers-reduced-motion` (`prefersReducedMotion()`): no loops, actions resolve at once on a key pose.
// No DOM access at import time (node imports the pure helpers).

export const ACTIONS = Object.freeze({
  idle: { ms: 2800, loop: true },
  talk: { ms: 1200, loop: true },
  wave: { ms: 1000, loop: true },
  cheer: { ms: 680, loop: true },
  jump: { ms: 1000, loop: false },
  cry: { ms: 900, loop: true },
  shock: { ms: 820, loop: false },
  walk: { ms: 520, loop: true },
});
export const ACTION_IDS = Object.freeze(Object.keys(ACTIONS));
/** Blink timing (contract: every 2–5 s, eyes shut ~130 ms). */
export const BLINK = Object.freeze({ min: 2000, max: 5000, ms: 130 });
/** Mouth flap while talking: one open / closed beat. */
export const TALK_BEAT_MS = 115;

// ---------- math ----------
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);
export const easeInQuad = (t) => t * t;
export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
export const easeOutBack = (t, s = 1.70158) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2;
/** Segment progress of t inside [a, b] → 0..1. */
export const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
/** Damped sine (wobble after an impact): amp · e^(−decay·t/1000) · sin(2π·freq·t/1000). */
export const dampedSine = (tMs, { amp = 1, freq = 4, decay = 5 } = {}) => amp * Math.exp((-decay * tMs) / 1000) * Math.sin((2 * Math.PI * freq * tMs) / 1000);

/** Volume-preserving squash & stretch: amount > 0 = stretch up (taller, thinner), < 0 = squash. */
export function squashStretch(amount) {
  const sy = 1 + amount;
  const sx = 1 / Math.sqrt(Math.max(0.2, sy));
  return { sx, sy };
}

/** Jelly wobble after a landing: scale offsets {sx, sy} that settle to 1. */
export function jelly(tMs, { amp = 0.08, freq = 3.2, decay = 5.5 } = {}) {
  const d = dampedSine(tMs, { amp, freq, decay });
  return squashStretch(-d);
}

/** Screen-shake offset {x, y} in px at t (decays to 0 by `ms`). */
export function shakeOffset(tMs, { amp = 8, ms = 360, freq = 22 } = {}) {
  if (tMs >= ms) return { x: 0, y: 0 };
  const k = 1 - tMs / ms;
  const w = (2 * Math.PI * freq * tMs) / 1000;
  return { x: amp * k * Math.sin(w), y: amp * 0.5 * k * Math.cos(w * 1.3) };
}

/** Web Animations keyframes of a screen shake (n steps). */
export function shakeKeyframes({ amp = 8, ms = 360, n = 9 } = {}) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const o = shakeOffset((i / n) * ms, { amp, ms });
    out.push({ transform: `translate(${o.x.toFixed(1)}px, ${o.y.toFixed(1)}px)` });
  }
  out[out.length - 1] = { transform: 'translate(0px, 0px)' };
  return out;
}

const NEUTRAL = Object.freeze({ x: 0, y: 0, sx: 1, sy: 1, r: 0 });
/** A neutral pose (every part at rest). */
export function restPose() {
  return { root: { ...NEUTRAL }, head: { r: 0, y: 0 }, armL: { r: 0 }, armR: { r: 0 }, earL: { r: 0 }, earR: { r: 0 }, tail: { r: 0 }, shadow: { s: 1 }, eyes: null, mouth: null };
}

/**
 * Pose of an action at t ms (pure, deterministic). Angles in degrees (SVG: + = clockwise), offsets in canvas units
 * (the 1024×1536 character canvas). `armL` = the arm on the left of the canvas (raise = +), `armR` = right (raise = −).
 * `eyes: 'closed'` / `mouth: 'open'` override the face; null = leave it alone. Loops wrap t by the action length.
 * @param {string} action  ACTIONS id
 * @param {number} tMs
 * @param {{intensity?: number}} [opts]
 */
export function samplePose(action, tMs, { intensity = 1 } = {}) {
  const def = ACTIONS[action] ?? ACTIONS.idle;
  const T = def.ms;
  const t = def.loop ? ((tMs % T) + T) % T : clamp(tMs, 0, T);
  const u = t / T;
  const k = intensity;
  const p = restPose();
  const wave = (period, phase = 0) => Math.sin(2 * Math.PI * (t / period + phase));
  switch (action) {
    case 'wave': {
      p.armR.r = -118 * k + 22 * k * wave(T / 2);
      p.armL.r = 6 * k;
      p.root.r = 2.2 * k * wave(T);
      p.head.r = 4 * k * wave(T, 0.15);
      p.earR.r = -6 * k * wave(T / 2);
      p.tail.r = 12 * k * wave(T / 2);
      break;
    }
    case 'cheer': {
      const hop = Math.abs(Math.sin(Math.PI * u));
      p.root.y = -46 * k * hop;
      const ss = squashStretch(0.07 * k * (hop - 0.45) * 1.6);
      p.root.sx = ss.sx;
      p.root.sy = ss.sy;
      p.armL.r = 132 * k + 14 * k * wave(T / 2);
      p.armR.r = -132 * k - 14 * k * wave(T / 2);
      p.head.r = 3 * k * wave(T);
      p.earL.r = -8 * k * hop;
      p.earR.r = 8 * k * hop;
      p.tail.r = 18 * k * wave(T / 2);
      p.shadow.s = 1 - 0.25 * hop;
      p.mouth = 'open';
      break;
    }
    case 'jump': {
      // anticipation squash → stretch launch → airborne (arms up) → land squash → jelly settle
      if (t < 180) {
        const s = easeOutQuad(seg(t, 0, 180));
        Object.assign(p.root, squashStretch(-0.14 * k * s));
        p.armL.r = -10 * k * s;
        p.armR.r = 10 * k * s;
      } else if (t < 620) {
        const a = seg(t, 180, 620);
        const h = Math.sin(Math.PI * a); // up and down
        p.root.y = -230 * k * h;
        const stretch = a < 0.5 ? 0.14 * (1 - a * 2) + 0.03 : 0.05 * (a - 0.5) * 2;
        Object.assign(p.root, squashStretch(stretch * k));
        p.armL.r = 70 * k * Math.min(1, a * 3);
        p.armR.r = -70 * k * Math.min(1, a * 3);
        p.earL.r = 14 * k * h;
        p.earR.r = -14 * k * h;
        p.shadow.s = 1 - 0.5 * h;
        p.mouth = 'open';
      } else {
        const l = t - 620;
        const land = l < 90 ? -0.16 * k * Math.sin((Math.PI * l) / 180) : 0;
        const wob = l >= 90 ? jelly(l - 90, { amp: 0.07 * k }) : squashStretch(land);
        Object.assign(p.root, l < 90 ? squashStretch(land) : wob);
        const back = 1 - seg(l, 0, 260);
        p.armL.r = 30 * k * back;
        p.armR.r = -30 * k * back;
      }
      break;
    }
    case 'cry': {
      // sob: quick shoulder shakes + a slow heave; arms up to the face
      const sob = wave(180);
      const heave = (1 - Math.cos(2 * Math.PI * u)) / 2;
      p.root.x = 5 * k * sob;
      Object.assign(p.root, squashStretch(-0.035 * k * heave));
      p.root.y = 6 * k * heave;
      p.head.r = 3 * k * wave(T / 2);
      p.head.y = 8 * k * heave;
      p.armL.r = 44 * k + 6 * k * sob;
      p.armR.r = -44 * k - 6 * k * sob;
      p.earL.r = 10 * k;
      p.earR.r = -10 * k;
      p.mouth = 'open';
      break;
    }
    case 'shock': {
      // a startled hop (stretch tall, arms out) then a decaying tremble
      if (t < 420) {
        const a = seg(t, 0, 420);
        const h = Math.sin(Math.PI * a);
        p.root.y = -95 * k * h;
        Object.assign(p.root, squashStretch(0.16 * k * (1 - a)));
        p.armL.r = 88 * k * Math.min(1, a * 4);
        p.armR.r = -88 * k * Math.min(1, a * 4);
        p.earL.r = -12 * k;
        p.earR.r = 12 * k;
        p.shadow.s = 1 - 0.3 * h;
      } else {
        const l = t - 420;
        p.root.x = dampedSine(l, { amp: 12 * k, freq: 14, decay: 6 });
        p.armL.r = 88 * k * (1 - seg(l, 0, 400) * 0.6);
        p.armR.r = -88 * k * (1 - seg(l, 0, 400) * 0.6);
      }
      p.mouth = 'open';
      break;
    }
    case 'walk': {
      const hop = Math.abs(Math.sin(Math.PI * u));
      p.root.y = -38 * k * hop;
      Object.assign(p.root, squashStretch(0.05 * k * (hop - 0.5)));
      p.root.r = 3 * k * wave(T);
      p.armL.r = 18 * k * wave(T);
      p.armR.r = 18 * k * wave(T);
      p.tail.r = 14 * k * wave(T / 2);
      p.shadow.s = 1 - 0.2 * hop;
      break;
    }
    case 'talk': {
      p.mouth = mouthOpenAt(t) ? 'open' : 'closed';
      p.head.r = 2.4 * k * wave(T / 2);
      p.root.y = -4 * k * Math.abs(wave(T / 2));
      break;
    }
    default:
      break; // idle: the CSS breathing / ear twitch / blink timer do the work
  }
  return p;
}

/** Talking mouth (open / closed beats with a little variation so it doesn't look mechanical). */
export function mouthOpenAt(tMs) {
  const beat = Math.floor(tMs / TALK_BEAT_MS);
  // every 5th beat holds the mouth shut a bit longer
  return beat % 5 !== 4 && beat % 2 === 0;
}

/** Key pose of an action (reduced motion, the group photo): a representative frame. */
export function keyPose(action) {
  const at = { wave: 250, cheer: 340, jump: 400, cry: 0, shock: 210, walk: 130, talk: 0 }[action];
  return at == null ? restPose() : samplePose(action, at);
}

/** Next blink delay in ms (2–5 s). `rnd` → [0, 1). */
export function blinkDelay(rnd = Math.random) {
  return Math.round(BLINK.min + rnd() * (BLINK.max - BLINK.min));
}

/** SVG transform attribute for a part: rotate/scale/translate about a pivot (px, py). */
export function partTransform(part = {}, [px, py] = [0, 0]) {
  const x = part.x ?? 0;
  const y = part.y ?? 0;
  const r = part.r ?? 0;
  const sx = part.sx ?? 1;
  const sy = part.sy ?? 1;
  const s = part.s;
  if (!x && !y && !r && sx === 1 && sy === 1 && (s == null || s === 1)) return '';
  const f = (n) => (Math.round(n * 1000) / 1000).toString();
  const out = [];
  if (x || y) out.push(`translate(${f(x)} ${f(y)})`);
  if (r) out.push(`rotate(${f(r)} ${f(px)} ${f(py)})`);
  const kx = s ?? sx;
  const ky = s ?? sy;
  if (kx !== 1 || ky !== 1) out.push(`translate(${f(px)} ${f(py)}) scale(${f(kx)} ${f(ky)}) translate(${f(-px)} ${f(-py)})`);
  return out.join(' ');
}

// ---------- sprite sheets ----------

/**
 * Frame index at t for a sheet {frames, fps, loop} — or a timed sequence {seq: [frame…], frameMs: [ms…]} (CH-2 sheets:
 * the 2×2 jump plays crouch → take-off → apex → take-off → landing in step with the rig's hop); −1 once a non-looping
 * sheet has finished.
 */
export function spriteFrame(tMs, { frames = 1, fps = 12, loop = true, seq = null, frameMs = null } = {}) {
  const t = Math.max(0, tMs);
  if (Array.isArray(seq) && Array.isArray(frameMs) && seq.length && seq.length === frameMs.length) {
    const total = frameMs.reduce((a, b) => a + Math.max(1, b), 0);
    if (!loop && t >= total) return -1;
    let u = loop ? t % total : t;
    for (let k = 0; k < seq.length; k++) {
      u -= Math.max(1, frameMs[k]);
      if (u < 0) return seq[k];
    }
    return seq[seq.length - 1];
  }
  const n = Math.max(1, Math.floor(frames));
  const i = Math.floor((t * Math.max(1, fps)) / 1000);
  if (loop) return i % n;
  return i < n ? i : -1;
}

/** Sheet duration in ms (one pass). */
export const spriteDuration = ({ frames = 1, fps = 12, seq = null, frameMs = null } = {}) =>
  Array.isArray(seq) && Array.isArray(frameMs) && seq.length && seq.length === frameMs.length
    ? frameMs.reduce((a, b) => a + Math.max(1, b), 0)
    : Math.round((Math.max(1, frames) * 1000) / Math.max(1, fps));

/** background-position (percent) of frame i on a [cols, rows] grid. */
export function spriteBgPos(i, [cols, rows] = [1, 1]) {
  const c = Math.max(1, cols);
  const r = Math.max(1, rows);
  const x = i % c;
  const y = Math.floor(i / c) % r;
  return { x: c > 1 ? (x / (c - 1)) * 100 : 0, y: r > 1 ? (y / (r - 1)) * 100 : 0 };
}

/**
 * A usable sheet definition from an /api/assets entry (meta {grid, frames, fps, loop, seq?, frameMs?, rect?}) or null.
 * `rect` = [x, y, w, h] where ONE cell sits on the 1024×1536 character canvas (CH-2 sheets: every cell is the same crop
 * of the canvas) → the player draws inside the figure's SVG; `size` = the sheet image's pixel size.
 */
export function sheetDef(info) {
  const m = info?.meta ?? {};
  const grid = Array.isArray(m.grid) && m.grid.length === 2 ? m.grid.map((n) => Math.max(1, Math.floor(Number(n) || 1))) : null;
  if (!info?.url || !grid) return null;
  const frames = Math.max(1, Math.min(grid[0] * grid[1], Math.floor(Number(m.frames) || grid[0] * grid[1])));
  const def = { url: info.url, grid, frames, fps: Math.max(1, Math.min(60, Number(m.fps) || 12)), loop: m.loop !== false };
  const okSeq = Array.isArray(m.seq) && Array.isArray(m.frameMs) && m.seq.length && m.seq.length === m.frameMs.length;
  if (okSeq && m.seq.every((i) => Number.isInteger(i) && i >= 0 && i < frames) && m.frameMs.every((v) => Number.isFinite(v) && v > 0)) {
    def.seq = [...m.seq];
    def.frameMs = [...m.frameMs];
  }
  if (Array.isArray(m.rect) && m.rect.length === 4 && m.rect.every(Number.isFinite) && m.rect[2] > 0 && m.rect[3] > 0) {
    def.rect = [...m.rect];
    if (Number(info.width) > 0 && Number(info.height) > 0) def.size = [Number(info.width), Number(info.height)];
  }
  // per-frame head offset [dx, dy] from the base's head (props follow the head while the sheet plays)
  if (Array.isArray(m.heads) && m.heads.length === frames && m.heads.every((h) => Array.isArray(h) && h.length === 2 && h.every(Number.isFinite))) def.heads = m.heads.map((h) => [...h]);
  return def;
}

// ---------- particles ----------

/** Seeded PRNG (mulberry32) for particle layouts that are the same on every client. */
export function seeded(seed = 1) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const PARTICLE_KINDS = Object.freeze(['tear', 'sweat', 'heart', 'sparkle', 'star', 'puff', 'note']);

/**
 * Particle specs (pure): [{kind, x, y, dx, dy, size, delay, dur, rot}] in canvas units relative to `origin`.
 * tears fall from both eyes (`origins` = the two eye points), sweat slides down, hearts / sparkles / notes float up.
 */
export function spawnParticles(kind, { n = 6, seed = 1, origins = [[512, 640]], spread = 120, loop = true } = {}) {
  const rnd = seeded(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const [ox, oy] = origins[i % origins.length];
    const side = origins.length > 1 ? (ox < 512 ? -1 : 1) : rnd() < 0.5 ? -1 : 1;
    const base = { kind, delay: Math.round((i / n) * (kind === 'tear' ? 900 : 1300) + rnd() * 120), rot: Math.round((rnd() - 0.5) * 40), loop };
    switch (kind) {
      case 'tear':
        out.push({ ...base, x: ox + side * (10 + rnd() * 30), y: oy + 20, dx: side * (20 + rnd() * 60), dy: 260 + rnd() * 140, size: 26 + rnd() * 14, dur: 820 + Math.round(rnd() * 260) });
        break;
      case 'sweat':
        out.push({ ...base, x: ox + spread * 0.6 + rnd() * 40, y: oy - spread * 0.4, dx: 10, dy: 120 + rnd() * 60, size: 40 + rnd() * 12, dur: 1300 });
        break;
      case 'puff':
        out.push({ ...base, x: ox + (rnd() - 0.5) * spread * 2, y: oy, dx: (rnd() - 0.5) * 120, dy: -40 - rnd() * 60, size: 40 + rnd() * 30, dur: 700 });
        break;
      default: // heart / sparkle / star / note: float up and fade
        out.push({ ...base, x: ox + (rnd() - 0.5) * spread * 2, y: oy - rnd() * spread * 0.6, dx: (rnd() - 0.5) * 80, dy: -(160 + rnd() * 160), size: 44 + rnd() * 30, dur: 1400 + Math.round(rnd() * 500) });
    }
  }
  return out;
}

const PARTICLE_GLYPH = { heart: '💗', sparkle: '✨', star: '⭐', note: '🎵' };
const pf = (n) => (Math.round(n * 10) / 10).toString();

/** SVG markup of particle specs (CSS-animated via custom properties; see chara.css `.ch-pt`). */
export function particlesSvg(specs = [], { line = '#5b8fd9' } = {}) {
  return specs
    .map((s) => {
      const style = `--dx:${pf(s.dx)}px;--dy:${pf(s.dy)}px;--rot:${s.rot}deg;animation-delay:${s.delay}ms;animation-duration:${s.dur}ms${s.loop ? '' : ';animation-iteration-count:1'}`;
      if (s.kind === 'tear' || s.kind === 'sweat') {
        const r = s.size / 2;
        const fill = s.kind === 'tear' ? '#8fd0ff' : '#bfe6ff';
        return `<path class="ch-pt ${s.kind}" style="${style}" d="M${pf(s.x)} ${pf(s.y - r * 1.5)} C${pf(s.x + r)} ${pf(s.y - r * 0.2)} ${pf(s.x + r)} ${pf(s.y + r)} ${pf(s.x)} ${pf(s.y + r)} C${pf(s.x - r)} ${pf(s.y + r)} ${pf(s.x - r)} ${pf(s.y - r * 0.2)} ${pf(s.x)} ${pf(s.y - r * 1.5)}Z" fill="${fill}" stroke="${line}" stroke-width="5"/>`;
      }
      if (s.kind === 'puff') return `<circle class="ch-pt puff" style="${style}" cx="${pf(s.x)}" cy="${pf(s.y)}" r="${pf(s.size / 2)}" fill="#fff" fill-opacity=".85"/>`;
      return `<text class="ch-pt ${s.kind}" style="${style}" x="${pf(s.x)}" y="${pf(s.y)}" font-size="${pf(s.size)}" text-anchor="middle">${PARTICLE_GLYPH[s.kind] ?? '✨'}</text>`;
    })
    .join('');
}

// ---------- parallax ----------

export const PARALLAX_LAYERS = Object.freeze(['far', 'mid', 'near']);
const DEPTH = { far: 0.25, mid: 0.6, near: 1 };

/** Gentle drift of a background layer at t: {x, y (percent), scale}. depth 0 (far) … 1 (near). */
export function parallaxOffset(depth, tMs, { amp = 1.6, period = 9000 } = {}) {
  const d = clamp(Number(depth) || 0, 0, 1.5);
  const w = (2 * Math.PI * tMs) / period;
  return { x: amp * d * Math.sin(w), y: amp * 0.35 * d * Math.cos(w * 0.7), scale: 1.04 + 0.03 * d };
}

/**
 * Background layers of a scene: `bg-<scene>-far|mid|near` when any is accepted ({id, url, depth}[] far → near),
 * else the single bg (depth 0.4: a slow drift / zoom). `assetUrl(id)` → url | null.
 */
export function parallaxLayers(scene, assetUrl = () => null, single = null) {
  const layers = PARALLAX_LAYERS.map((l) => ({ id: `bg-${scene}-${l}`, layer: l, depth: DEPTH[l] })).map((x) => ({ ...x, url: assetUrl(x.id) })).filter((x) => x.url);
  if (layers.length) return layers;
  return single ? [{ id: `bg-${scene}`, layer: 'single', depth: 0.4, url: single }] : [];
}

// ---------- DOM (browser only) ----------

/** prefers-reduced-motion (false outside a browser). */
export function prefersReducedMotion() {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

const rigs = new Set();
let raf = 0;
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function tick() {
  raf = 0;
  const now = nowMs();
  for (const r of [...rigs]) r._frame(now);
  if (rigs.size) raf = requestAnimationFrame(tick);
}
function ensureTicker() {
  if (!raf && rigs.size && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(tick);
}

/** Pivot [x, y] stored on a rig group (data-px / data-py). */
const pivotOf = (g) => [Number(g.dataset.px) || 0, Number(g.dataset.py) || 0];

/**
 * Drive the `[data-rig]` groups of one chara SVG.
 * @param {SVGSVGElement} svg
 * @param {{reduced?: boolean, onFace?: (state: {eyes, mouth}) => void}} opts
 * @returns {{play(action, opts?): Promise<boolean>, loop(action|null): void, stop(): void, destroy(): void, current: string|null}}
 *   `play` runs a one-shot action (or one cycle of a loop when `{times}` is given) and resolves when it ends (true) or is
 *   replaced (false); `loop(action)` keeps a looping action going until another loop / null.
 */
export function createRig(svg, { reduced = prefersReducedMotion(), onFace = null } = {}) {
  const parts = {};
  for (const g of svg.querySelectorAll('[data-rig]')) parts[g.dataset.rig] = { g, pivot: pivotOf(g) };
  let loopAction = null;
  let loopStart = 0;
  let shot = null; // {action, start, ms, resolve}
  let lastFace = '';
  let attached = false;

  function apply(pose, opts = null) {
    // a held item stays (almost) upright while its arm swings
    pose.propR = { r: -(pose.armR?.r ?? 0) * 0.85 };
    // `squash` (0..1) scales the root's squash & stretch (a sprite sheet draws its own squash; the hop stays)
    if (opts?.squash != null && pose.root) {
      const k = Math.max(0, Math.min(1, opts.squash));
      pose.root.sx = 1 + ((pose.root.sx ?? 1) - 1) * k;
      pose.root.sy = 1 + ((pose.root.sy ?? 1) - 1) * k;
    }
    for (const name of ['root', 'head', 'armL', 'armR', 'earL', 'earR', 'tail', 'shadow', 'propR']) {
      const part = parts[name];
      if (!part) continue;
      const tf = partTransform(pose[name], part.pivot);
      if (part.last !== tf) {
        part.last = tf;
        if (tf) part.g.setAttribute('transform', tf);
        else part.g.removeAttribute('transform');
      }
    }
    const face = `${pose.eyes ?? ''}|${pose.mouth ?? ''}`;
    if (face !== lastFace) {
      lastFace = face;
      svg.classList.toggle('mouth-open', pose.mouth === 'open');
      onFace?.({ eyes: pose.eyes, mouth: pose.mouth });
    }
  }

  const api = {
    current: null,
    _frame(now) {
      if (svg.isConnected) attached = true;
      else if (attached) return api.destroy(); // removed from the page
      if (shot) {
        const t = now - shot.start;
        if (t >= shot.ms) {
          const done = shot;
          shot = null;
          done.resolve(true);
        } else if (shot.action === 'talk' && loopAction && loopAction !== 'idle') {
          // talking while cheering / waving / crying: the loop keeps going, only the mouth (and a nod) come from `talk`
          const pose = samplePose(loopAction, now - loopStart);
          pose.mouth = samplePose('talk', t).mouth;
          apply(pose);
          return;
        } else {
          apply(samplePose(shot.action, t, shot.opts), shot.opts);
          return;
        }
      }
      if (loopAction && loopAction !== 'idle') apply(samplePose(loopAction, now - loopStart));
      else {
        apply(restPose());
        rigs.delete(api);
      }
    },
    play(action, opts = {}) {
      const def = ACTIONS[action];
      if (!def) return Promise.resolve(false);
      if (shot) shot.resolve(false);
      if (reduced) {
        // no motion: hold the key pose briefly, then back to the current loop's key pose / rest
        apply(keyPose(action));
        return new Promise((resolve) =>
          setTimeout(() => {
            apply(loopAction ? keyPose(loopAction) : restPose());
            resolve(true);
          }, Math.min(400, def.ms)),
        );
      }
      const ms = def.loop ? def.ms * Math.max(1, opts.times ?? 1) : def.ms;
      return new Promise((resolve) => {
        shot = { action, start: nowMs(), ms: opts.ms ?? ms, resolve, opts };
        api.current = action;
        rigs.add(api);
        ensureTicker();
      });
    },
    loop(action) {
      loopAction = ACTIONS[action]?.loop ? action : null;
      loopStart = nowMs();
      api.current = loopAction;
      if (reduced) {
        apply(loopAction ? keyPose(loopAction) : restPose());
        return;
      }
      rigs.add(api);
      ensureTicker();
    },
    stop() {
      loopAction = null;
      if (shot) shot.resolve(false);
      shot = null;
      apply(restPose());
      rigs.delete(api);
    },
    destroy() {
      if (shot) shot.resolve(false);
      shot = null;
      loopAction = null;
      rigs.delete(api);
    },
  };
  return api;
}

/** Number of rigs the shared ticker drives right now (debug / tests). */
export const activeRigs = () => rigs.size;

/**
 * Sprite-sheet player in `host` (a `.chara` element).
 * Sheets with `rect` (CH-2: every cell = the same crop of the 1024×1536 character canvas) are drawn INSIDE the figure's
 * SVG, in the root rig group next to the figure (so the root hop, flip and crop apply; `.chara.sheet-on` hides the
 * figure); the frame is picked by moving a nested <svg>'s viewBox over the sheet image. `mount` / `after` put it at a
 * given place in the figure (chara.js: right after the raster figure, under the props); `onFrame(i)` fires per frame
 * change. Older sheets without `rect` cover the element box as a CSS background (`sheet-div`).
 * @param {HTMLElement} host
 * @param {{url, grid, frames, fps, loop, seq?, frameMs?, rect?, size?}} sheet  (see sheetDef)
 * @returns {{done: Promise<boolean>, stop(): void, el: Element}}
 */
export function createSpritePlayer(host, sheet, { reduced = prefersReducedMotion(), loopMs = null, mount = null, after = null, onFrame = null } = {}) {
  const [cols, rows] = sheet.grid;
  const root = sheet.rect ? mount ?? host.querySelector?.('svg [data-rig="root"]') : null;
  let el;
  let show;
  if (root) {
    const NS = 'http://www.w3.org/2000/svg';
    const [x, y, w, h] = sheet.rect;
    const [sw, sh] = sheet.size ?? [cols * w, rows * h];
    const cw = sw / cols;
    const ch = sh / rows;
    el = document.createElementNS(NS, 'svg');
    el.setAttribute('class', 'ch-sheet-svg');
    for (const [k, v] of Object.entries({ x, y, width: w, height: h, preserveAspectRatio: 'none', overflow: 'hidden' })) el.setAttribute(k, String(v));
    const im = document.createElementNS(NS, 'image');
    im.setAttribute('href', sheet.url);
    im.setAttribute('width', String(sw));
    im.setAttribute('height', String(sh));
    el.appendChild(im);
    if (after && after.parentNode === root) after.after(el);
    else root.appendChild(el);
    let last = -1;
    show = (i) => {
      el.setAttribute('viewBox', `${(i % cols) * cw} ${(Math.floor(i / cols) % rows) * ch} ${cw} ${ch}`);
      if (i !== last) onFrame?.(i);
      last = i;
    };
  } else {
    el = document.createElement('div');
    el.className = 'ch-sheet';
    el.style.backgroundImage = `url("${String(sheet.url).replace(/"/g, '%22')}")`;
    el.style.backgroundSize = `${cols * 100}% ${rows * 100}%`;
    host.appendChild(el);
    host.classList?.add('sheet-div');
    show = (i) => {
      const pos = spriteBgPos(i, sheet.grid);
      el.style.backgroundPosition = `${pos.x}% ${pos.y}%`;
    };
  }
  let stopped = false;
  let resolveDone;
  const done = new Promise((r) => (resolveDone = r));
  const start = nowMs();
  const finish = (ok) => {
    if (stopped) return;
    stopped = true;
    el.remove();
    host.classList?.remove('sheet-div');
    resolveDone(ok);
  };
  if (reduced) {
    show(sheet.seq ? sheet.seq[Math.floor(sheet.seq.length / 2)] : Math.floor(sheet.frames / 2));
    setTimeout(() => finish(true), 400);
  } else {
    const frame = () => {
      if (stopped) return;
      const t = nowMs() - start;
      const i = spriteFrame(t, sheet);
      if (i < 0 || (loopMs != null && t >= loopMs)) return finish(true);
      show(i);
      requestAnimationFrame(frame);
    };
    frame();
  }
  return { el, done, stop: () => finish(false) };
}

/** Shake an element (cut-in window on a shock / sabotage); no-op with reduced motion. */
export function screenShake(el, { amp = 8, ms = 360 } = {}) {
  if (!el?.animate || prefersReducedMotion()) return null;
  return el.animate(shakeKeyframes({ amp, ms }), { duration: ms, easing: 'linear' });
}

/**
 * Parallax background: layered images in `host` drifting by depth (rAF; stops when `host` leaves the page).
 * @param {HTMLElement} host
 * @param {{url, depth, layer}[]} layers  (parallaxLayers)
 * @returns {{stop(): void}}
 */
export function attachParallax(host, layers = [], { reduced = prefersReducedMotion() } = {}) {
  const imgs = layers.map((l) => {
    const im = document.createElement('img');
    im.className = `ci-bg-img ci-plx ${l.layer}`;
    im.alt = '';
    im.decoding = 'async';
    im.src = l.url;
    host.appendChild(im);
    return { im, depth: l.depth };
  });
  let stopped = false;
  let attached = false;
  const t0 = nowMs();
  const frame = () => {
    if (stopped) return;
    if (host.isConnected) attached = true;
    else if (attached) return;
    const t = nowMs() - t0;
    for (const { im, depth } of imgs) {
      const o = parallaxOffset(depth, t);
      im.style.transform = `translate(${o.x.toFixed(2)}%, ${o.y.toFixed(2)}%) scale(${o.scale.toFixed(3)})`;
    }
    requestAnimationFrame(frame);
  };
  if (!reduced && typeof requestAnimationFrame === 'function') frame();
  return { stop: () => (stopped = true) };
}
