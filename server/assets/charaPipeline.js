// Chiikawa art pipeline (CH-2) — image steps for the hand-delivered character / prop / MC art (no Gemini API here).
//
//   keyBackdrop(raw)                    flat magenta → alpha: backdrop sampled from the corners (never exactly #FF00FF,
//                                       G 26–65 measured), flood-filled from the border so outlined interiors (a purple bow
//                                       tie, pink blush) stay opaque; enclosed backdrop holes are cleared by distance only
//   figureStats(raw)                    bbox, feet line, feet-band centre
//   familyFrom(stats, w, h)             ONE placement per reference family (normalised by the image height, so 896×1200 and
//                                       848×1264 takes map the same way): head-top → y 420 … feet → y 1303, centred on x 512
//   transformFor(family, w, h, stats)   that transform for one image (+ a translation correction when its own feet / centre
//                                       deviate by more than 2 % / 3 % of the image height — logged by the importer)
//   placeOnCanvas(raw, t, {res})        → the 1024×1536 logical canvas stored at `res` (0.75 → 768×1152)
//   extractArms(base, body)             base − noarms diff → both arms in one layer + pivots (shoulder joints) + hand tips
//   extractOverlay(edit, base, {box})   edit − base diff inside a box (registered ±4 px, opened, dilated, holes filled):
//                                       the edit's own pixels, so they cover the old eyes / mouth; + changed-pixel stats
//   measureAnchors(raw, {arms})         head top / eye line / chin / hands / back → prop anchors in logical coordinates
//   normalizeSheet(raw, {grid, targetHeight})  2×2 sheet → frames keyed, uniformly scaled (median frame height = the
//                                       character's base height), feet bottom-aligned on y 1303, centred — every cell is the
//                                       whole logical canvas, so a frame drops in for the base figure
//   normalizeProp(buffer, {slot})       white → alpha, trim, ≤ 384 px, anchor (attach point) + scale per slot
import sharp from 'sharp';
import { alphaBBox, estimateShift, removeSmallComponents, sampleBackground, toRaw, trim, whiteToAlpha } from './postprocess.js';

/** The shared character canvas (public/js/shared/roster.js CANVAS + roster anchors of the reference character). */
export const CANVAS = Object.freeze({ w: 1024, h: 1536, cx: 512, feetY: 1303, headTop: 420 });
/** Stored resolution of character images relative to the logical canvas (768×1152 ≈ the source figure's own size). */
export const CHARA_RES = 0.75;
/** Stored resolution of sprite-sheet cells (shown only for a second → smaller). */
export const SHEET_RES = 0.5;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r1 = (v) => Math.round(v * 10) / 10;
const r4 = (v) => Math.round(v * 10000) / 10000;

function hueSat(r, g, b) {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  if (!d) return [0, 0];
  let h;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [(h * 60 + 360) % 360, d / mx];
}

export const rawOf = async (buffer) => toRaw(buffer);
export const rawToSharp = ({ data, w, h }) => sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width: w, height: h, channels: 4 } });
export const rawToPng = (raw) => rawToSharp(raw).png().toBuffer();
export const emptyRaw = (w, h) => ({ data: Buffer.alloc(w * h * 4), w, h });

// ---------- keying ----------

/**
 * Magenta backdrop → alpha (returns a new raw). Backdrop = median of the four corners.
 * @param {{data, w, h}} src
 * @param {{hard?, soft?, hueKill?, hueSoft?, minSat?, minArea?, bg?}} opts
 */
export function keyBackdrop(src, { hard = 26, soft = 66, hueKill = 12, hueSoft = 20, minSat = 0.45, minArea = 30, bg = null } = {}) {
  const { w, h } = src;
  const data = Buffer.from(src.data);
  const b = bg ?? sampleBackground(data, w, h);
  const [bh, bs] = hueSat(b.r, b.g, b.b);
  const useHue = bs > 0.35;
  const n = w * h;
  const dist = new Float32Array(n);
  const hueA = new Float32Array(n).fill(1);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const r = data[i];
    const g = data[i + 1];
    const bl = data[i + 2];
    dist[p] = Math.sqrt((r - b.r) ** 2 + (g - b.g) ** 2 + (bl - b.b) ** 2);
    if (useHue) {
      const [hh, ss] = hueSat(r, g, bl);
      if (ss > minSat) {
        const hd = Math.min(Math.abs(hh - bh), 360 - Math.abs(hh - bh));
        hueA[p] = hd < hueKill ? 0 : hd < hueSoft ? (hd - hueKill) / (hueSoft - hueKill) : 1;
      }
    }
  }
  const bgLike = (p) => dist[p] < soft || hueA[p] < 1;
  const region = new Uint8Array(n);
  const stack = new Int32Array(n);
  let sp = 0;
  const push = (p) => {
    if (!region[p] && bgLike(p)) {
      region[p] = 1;
      stack[sp++] = p;
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (sp) {
    const p = stack[--sp];
    const x = p % w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (p >= w) push(p - w);
    if (p < n - w) push(p + w);
  }
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    let a;
    const d = dist[p];
    if (region[p]) a = Math.min(d <= hard ? 0 : d >= soft ? 1 : (d - hard) / (soft - hard), hueA[p]);
    else a = d <= hard ? 0 : 1; // enclosed backdrop holes (between an arm and the body) vs. the character
    a = Math.min(a, data[i + 3] / 255);
    if (a > 0 && a < 1) {
      const g = data[i + 1];
      data[i] = Math.round(data[i] * a + g * (1 - a));
      data[i + 2] = Math.round(data[i + 2] * a + g * (1 - a));
    }
    data[i + 3] = Math.round(a * 255);
  }
  removeSmallComponents(data, w, h, minArea);
  return { data, w, h, bg: b };
}

// ---------- measurement ----------

/** Figure bbox, feet line (bbox bottom + 1) and the centre of the feet band (bottom 10 % of the figure). */
export function figureStats(raw, thr = 128) {
  const { data, w, h } = raw;
  const bbox = alphaBBox(data, w, h, thr);
  if (!bbox) return null;
  const band = Math.max(3, Math.round(bbox.height * 0.1));
  let minX = w;
  let maxX = -1;
  for (let y = bbox.bottom - band; y <= bbox.bottom; y++) {
    for (let x = bbox.left; x <= bbox.right; x++) {
      if (data[(y * w + x) * 4 + 3] > thr) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
  }
  return { bbox, top: bbox.top, feetY: bbox.bottom + 1, cx: (minX + maxX + 1) / 2, height: bbox.height, width: bbox.width };
}

/**
 * Normalised placement of a reference family from its base image: `unit` = logical units per source image height,
 * `cx` = feet centre offset from the image centre (in image heights), `feet` = feet line (fraction of the height).
 */
export function familyFrom(stats, w, h, canvas = CANVAS) {
  return { unit: r4(((canvas.feetY - canvas.headTop) * h) / stats.height), cx: r4((stats.cx - w / 2) / h), feet: r4(stats.feetY / h) };
}

/**
 * The family transform for one image (w × h): logical = C + (src − a) · k. With `stats` (the image's own figure),
 * the anchor is moved onto the image's own feet / centre when they deviate by more than tolY / tolX image heights.
 * @returns {{k, ax, ay, dev: {x, y}, corrected: {x: boolean, y: boolean}}}
 */
export function transformFor(family, w, h, stats = null, { tolX = 0.03, tolY = 0.02 } = {}) {
  const k = family.unit / h;
  let ax = w / 2 + family.cx * h;
  let ay = family.feet * h;
  const dev = { x: 0, y: 0 };
  const corrected = { x: false, y: false };
  if (stats) {
    dev.x = r4((stats.cx - ax) / h);
    dev.y = r4((stats.feetY - ay) / h);
    if (Math.abs(dev.x) > tolX) {
      ax = stats.cx;
      corrected.x = true;
    }
    if (Math.abs(dev.y) > tolY) {
      ay = stats.feetY;
      corrected.y = true;
    }
  }
  return { k, ax, ay, dev, corrected };
}

/** The family actually applied by a transform (stored on a base so its edits reuse it). */
export const familyOfTransform = (t, w, h) => ({ unit: r4(t.k * h), cx: r4((t.ax - w / 2) / h), feet: r4(t.ay / h) });

/** Blit `src` (raw) at integer (left, top) into a new W×H raw, clipping overflow. */
export function blit(src, W, H, left, top) {
  const out = Buffer.alloc(W * H * 4);
  const sx = Math.max(0, -left);
  const sy = Math.max(0, -top);
  const dx = Math.max(0, left);
  const dy = Math.max(0, top);
  const vw = Math.min(src.w - sx, W - dx);
  const vh = Math.min(src.h - sy, H - dy);
  for (let y = 0; y < vh; y++) {
    const s0 = ((sy + y) * src.w + sx) * 4;
    src.data.copy ? src.data.copy(out, ((dy + y) * W + dx) * 4, s0, s0 + vw * 4) : out.set(src.data.subarray(s0, s0 + vw * 4), ((dy + y) * W + dx) * 4);
  }
  return { data: out, w: W, h: H };
}

/** Resize a raw image (sharp, premultiplied alpha). */
export async function resizeRaw(raw, w, h) {
  const { data, info } = await rawToSharp(raw).resize(Math.max(1, w), Math.max(1, h), { kernel: 'lanczos3', fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

/** Place a keyed source on the logical canvas (stored at `res`). */
export async function placeOnCanvas(raw, t, { res = CHARA_RES, canvas = CANVAS } = {}) {
  const s = t.k * res;
  const scaled = await resizeRaw(raw, Math.round(raw.w * s), Math.round(raw.h * s));
  const W = Math.round(canvas.w * res);
  const H = Math.round(canvas.h * res);
  return blit(scaled, W, H, Math.round(canvas.cx * res - t.ax * s), Math.round(canvas.feetY * res - t.ay * s));
}

// ---------- binary masks ----------

/** Square (2r+1)² max (dilate) / min (erode) filter, separable. */
export function morph(mask, w, h, r, dilate) {
  if (r <= 0) return mask;
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  const want = dilate ? 1 : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = dilate ? 0 : 1;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) {
        if (mask[y * w + k] === want) {
          v = want;
          break;
        }
      }
      tmp[y * w + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = dilate ? 0 : 1;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) {
        if (tmp[k * w + x] === want) {
          v = want;
          break;
        }
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

/** Connected components (8-connectivity) of a mask → {labels, comps: [{id, area, sx, sy, minX, maxX, minY, maxY}]}. */
export function components(mask, w, h) {
  const labels = new Int32Array(w * h);
  const comps = [];
  const stack = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || labels[start]) continue;
    const id = comps.length + 1;
    const c = { id, area: 0, sx: 0, sy: 0, minX: w, maxX: -1, minY: h, maxY: -1 };
    let sp = 0;
    stack[sp++] = start;
    labels[start] = id;
    while (sp) {
      const p = stack[--sp];
      const x = p % w;
      const y = (p - x) / w;
      c.area++;
      c.sx += x;
      c.sy += y;
      if (x < c.minX) c.minX = x;
      if (x > c.maxX) c.maxX = x;
      if (y < c.minY) c.minY = y;
      if (y > c.maxY) c.maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w || (!dx && !dy)) continue;
          const q = yy * w + xx;
          if (mask[q] && !labels[q]) {
            labels[q] = id;
            stack[sp++] = q;
          }
        }
      }
    }
    c.cx = c.sx / c.area;
    c.cy = c.sy / c.area;
    comps.push(c);
  }
  return { labels, comps };
}

/** Fill holes of a mask (background regions not connected to the image border). */
export function fillHoles(mask, w, h) {
  const out = Uint8Array.from(mask);
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  const push = (p) => {
    if (!seen[p] && !mask[p]) {
      seen[p] = 1;
      stack[sp++] = p;
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (sp) {
    const p = stack[--sp];
    const x = p % w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (p >= w) push(p - w);
    if (p < w * h - w) push(p + w);
  }
  for (let p = 0; p < w * h; p++) if (!mask[p] && !seen[p]) out[p] = 1;
  return out;
}

const colorDist = (a, i, b, j) => Math.sqrt((a[i] - b[j]) ** 2 + (a[i + 1] - b[j + 1]) ** 2 + (a[i + 2] - b[j + 2]) ** 2);

/** Pixels of `src` on `mask` (everything else transparent). */
function pick(src, mask) {
  const out = Buffer.alloc(src.w * src.h * 4);
  for (let p = 0; p < src.w * src.h; p++) {
    if (!mask[p]) continue;
    const i = p * 4;
    out[i] = src.data[i];
    out[i + 1] = src.data[i + 1];
    out[i + 2] = src.data[i + 2];
    out[i + 3] = src.data[i + 3];
  }
  return { data: out, w: src.w, h: src.h };
}

/** Shift a raw image by (dx, dy) so that out(x, y) = src(x + dx, y + dy). */
export function shiftRaw(src, dx, dy) {
  if (!dx && !dy) return src;
  const { w, h } = src;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = y + dy;
    if (sy < 0 || sy >= h) continue;
    for (let x = 0; x < w; x++) {
      const sx = x + dx;
      if (sx < 0 || sx >= w) continue;
      const i = (y * w + x) * 4;
      const j = (sy * w + sx) * 4;
      out[i] = src.data[j];
      out[i + 1] = src.data[j + 1];
      out[i + 2] = src.data[j + 2];
      out[i + 3] = src.data[j + 3];
    }
  }
  return { data: out, w, h };
}

/** Registration of an edit onto its base (small integer shift), only when it clearly helps. */
export function registerEdit(edit, base, { maxShift = 4, exclude = null } = {}) {
  const s = estimateShift(base.data, edit.data, base.w, base.h, exclude, { maxShift });
  const helps = (s.dx || s.dy) && s.cost < s.baseCost * 0.8;
  return helps ? { dx: s.dx, dy: s.dy, gain: s.baseCost - s.cost } : { dx: 0, dy: 0, gain: 0 };
}

// ---------- arms ----------

/**
 * Both arms = base pixels that differ from the arm-less body (alpha or colour), opened to drop 1-px outline jitter; the
 * largest component on each side of the centre is an arm. Pivot = centre of the arm's contact with the body (shoulder
 * joint), hand = 80 % of the way from the pivot to the farthest arm pixel. Coordinates in the image's own pixels.
 * @returns {{arms: raw, pivots: {armL, armR}, hands: {handL, handR}, areas: number[], found: number}}
 */
export function extractArms(base, body, { thr = 64, cx = base.w / 2 } = {}) {
  const { w, h } = base;
  const n = w * h;
  let mask = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const ab = base.data[i + 3];
    const an = body.data[i + 3];
    if (ab > 128 && (an <= 128 || colorDist(base.data, i, body.data, i) > thr)) mask[p] = 1;
    else if (ab > 40 && an < ab - 90) mask[p] = 1;
  }
  mask = morph(morph(mask, w, h, 1, false), w, h, 1, true);
  const { labels, comps } = components(mask, w, h);
  const minArea = Math.max(40, n * 0.0006);
  const big = comps.filter((c) => c.area >= minArea);
  const left = big.filter((c) => c.cx < cx).sort((a, b) => b.area - a.area)[0] ?? null;
  const right = big.filter((c) => c.cx >= cx).sort((a, b) => b.area - a.area)[0] ?? null;
  const keep = new Set([left?.id, right?.id].filter(Boolean));
  let sel = new Uint8Array(n);
  for (let p = 0; p < n; p++) if (keep.has(labels[p])) sel[p] = 1;
  // anti-aliased rim: grow by one pixel inside the base's own alpha
  const grown = morph(sel, w, h, 1, true);
  for (let p = 0; p < n; p++) if (grown[p] && base.data[p * 4 + 3] > 8 && !(body.data[p * 4 + 3] > 200 && colorDist(base.data, p * 4, body.data, p * 4) < 24)) sel[p] = 1;
  // only what sticks out of the arm-less body: at rest the body's own outline shows as a thin crease at the shoulder,
  // and a raised arm never drags a white patch of the junction over the body outline (measured: notches otherwise)
  for (let p = 0; p < n; p++) if (body.data[p * 4 + 3] > 128) sel[p] = 0;
  const arms = pick(base, sel);
  // shoulder contact: arm pixels next to the body (opaque in the arm-less image)
  let bodyMask = new Uint8Array(n);
  for (let p = 0; p < n; p++) bodyMask[p] = body.data[p * 4 + 3] > 128 ? 1 : 0;
  bodyMask = morph(bodyMask, w, h, 2, true);
  const pivots = {};
  const hands = {};
  for (const [side, c] of [['L', left], ['R', right]]) {
    if (!c) continue;
    let sx = 0;
    let sy = 0;
    let k = 0;
    for (let y = c.minY; y <= c.maxY; y++) {
      for (let x = c.minX; x <= c.maxX; x++) {
        const p = y * w + x;
        if (labels[p] === c.id && bodyMask[p]) {
          sx += x;
          sy += y;
          k++;
        }
      }
    }
    // no contact found → the innermost band of the arm
    if (!k) {
      const inner = side === 'L' ? c.maxX : c.minX;
      for (let y = c.minY; y <= c.maxY; y++) {
        for (let x = Math.max(c.minX, inner - 6); x <= Math.min(c.maxX, inner + 6); x++) {
          if (labels[y * w + x] === c.id) {
            sx += x;
            sy += y;
            k++;
          }
        }
      }
    }
    const pv = [sx / k, sy / k];
    let far = pv;
    let best = -1;
    for (let y = c.minY; y <= c.maxY; y++) {
      for (let x = c.minX; x <= c.maxX; x++) {
        if (labels[y * w + x] !== c.id) continue;
        const d = (x - pv[0]) ** 2 + (y - pv[1]) ** 2;
        if (d > best) {
          best = d;
          far = [x, y];
        }
      }
    }
    pivots[`arm${side}`] = pv.map(r1);
    hands[`hand${side}`] = [r1(pv[0] + (far[0] - pv[0]) * 0.8), r1(pv[1] + (far[1] - pv[1]) * 0.8)];
  }
  return { arms, pivots, hands, areas: [left?.area ?? 0, right?.area ?? 0], found: keep.size };
}

// ---------- overlays ----------

/**
 * Overlay of an edit over its base: changed pixels (alpha flip or colour distance > thr) after registration, opened by
 * `open`, specks < minArea dropped, limited to `box`, dilated by `grow`, holes filled → the edit's pixels on that mask.
 * `changed` counts changed pixels inside / outside the box (the importer turns a body-wide change into a full swap).
 * @param {{data, w, h}} edit
 * @param {{data, w, h}} base
 * @param {{box?: {left, top, right, bottom}, thr?, open?, grow?, minArea?, register?, maxShift?}} opts
 */
export function extractOverlay(edit, base, { box = null, thr = 56, open = 1, grow = 4, minArea = 12, register = true, maxShift = 4 } = {}) {
  const { w, h } = base;
  const n = w * h;
  const shift = register ? registerEdit(edit, base, { maxShift }) : { dx: 0, dy: 0 };
  const e = shiftRaw(edit, shift.dx, shift.dy);
  let changed = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const ae = e.data[i + 3] > 128;
    const ab = base.data[i + 3] > 128;
    if (ae !== ab || (ae && ab && colorDist(e.data, i, base.data, i) > thr)) changed[p] = 1;
  }
  if (open) changed = morph(morph(changed, w, h, open, false), w, h, open, true);
  const { labels, comps } = components(changed, w, h);
  const small = new Set(comps.filter((c) => c.area < minArea).map((c) => c.id));
  const inBox = (x, y) => !box || (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom);
  let inside = 0;
  let outside = 0;
  let mask = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    if (!changed[p] || small.has(labels[p])) continue;
    const x = p % w;
    const y = (p - x) / w;
    if (inBox(x, y)) {
      inside++;
      mask[p] = 1;
    } else outside++;
  }
  mask = fillHoles(morph(mask, w, h, grow, true), w, h);
  for (let p = 0; p < n; p++) if (mask[p] && e.data[p * 4 + 3] === 0 && base.data[p * 4 + 3] === 0) mask[p] = 0;
  return { overlay: pick(e, mask), shift, changed: { inside, outside, total: inside + outside }, edited: e };
}

// ---------- anchors ----------

/**
 * Prop anchors measured on a placed base figure (+ the arms layer when known), in LOGICAL canvas units (÷ res):
 * head = head top on the centre line (between the ears), face = eye line, neck = chin (narrowest row under the widest
 * head row), handL / handR = arm tips, back = middle of the body; plus `eyes`, `headBox` and the figure `bbox`.
 */
export function measureAnchors(raw, { res = CHARA_RES, arms = null, hands = null } = {}) {
  const { data, w, h } = raw;
  const A = (x, y) => data[(y * w + x) * 4 + 3] > 128;
  const st = figureStats(raw);
  if (!st) return null;
  const { bbox } = st;
  const cx = st.cx;
  // head top on the centre column band
  const band = Math.max(2, Math.round(bbox.width * 0.04));
  const tops = [];
  for (let x = Math.round(cx - band); x <= Math.round(cx + band); x++) {
    for (let y = bbox.top; y <= bbox.bottom; y++) {
      if (A(x, y)) {
        tops.push(y);
        break;
      }
    }
  }
  tops.sort((a, b) => a - b);
  const headTop = tops.length ? tops[tops.length >> 1] : bbox.top;
  // width profile (silhouette span) per row
  const span = (y) => {
    let l = -1;
    let r = -1;
    for (let x = bbox.left; x <= bbox.right; x++) {
      if (A(x, y)) {
        if (l < 0) l = x;
        r = x;
      }
    }
    return l < 0 ? null : { l, r, w: r - l + 1 };
  };
  const figH = bbox.bottom - headTop;
  let wide = { y: headTop, w: 0, l: cx, r: cx };
  for (let y = headTop; y <= headTop + figH * 0.55; y++) {
    const s = span(y);
    if (s && s.w > wide.w) wide = { y, ...s };
  }
  // chin: narrowest row below the widest head row before the silhouette widens again (arms / body)
  let neck = { y: Math.round(wide.y + figH * 0.3), w: wide.w };
  let minW = Infinity;
  for (let y = wide.y; y <= bbox.bottom - figH * 0.12; y++) {
    const s = span(y);
    if (!s) continue;
    if (s.w < minW) {
      minW = s.w;
      neck = { y, w: s.w };
    } else if (s.w > minW * 1.18 && minW < wide.w * 0.97) break;
  }
  // eyes: the two largest solid dark blobs inside the face (not touching the silhouette outline) between the head top
  // and the chin — the eyes are only a little darker than the warm-grey outline, so the outline is excluded by contact
  const luma = (i) => data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
  let darkest = 255;
  for (let y = headTop; y < neck.y; y++) for (let x = wide.l; x <= wide.r; x++) if (data[(y * w + x) * 4 + 3] > 200) darkest = Math.min(darkest, luma((y * w + x) * 4));
  const thrL = Math.min(135, darkest + 45);
  const dark = new Uint8Array(w * h);
  for (let y = headTop; y < neck.y; y++) {
    for (let x = wide.l; x <= wide.r; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] > 200 && luma(i) < thrL) dark[y * w + x] = 1;
    }
  }
  const { labels: dl, comps } = components(dark, w, h);
  const touching = new Set();
  for (let y = headTop; y < neck.y; y++) {
    for (let x = wide.l; x <= wide.r; x++) {
      const id = dl[y * w + x];
      if (!id || touching.has(id)) continue;
      for (const [dx, dy] of [[-3, 0], [3, 0], [0, -3], [0, 3]]) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h || data[(yy * w + xx) * 4 + 3] < 128) touching.add(id);
      }
    }
  }
  const minEye = Math.max(6, wide.w * wide.w * 0.0004);
  const blobs = comps
    .filter((c) => !touching.has(c.id) && c.area >= minEye && c.maxY - c.minY < figH * 0.2)
    .filter((c) => {
      const bw = c.maxX - c.minX + 1;
      const bh = c.maxY - c.minY + 1;
      return c.area / (bw * bh) > 0.45 && bw / bh > 0.4 && bw / bh < 2.5;
    })
    .sort((a, b) => b.area - a.area);
  const eL = blobs.find((c) => c.cx < cx);
  const eR = blobs.find((c) => c.cx >= cx);
  const eyes = eL && eR && Math.abs(eL.cy - eR.cy) < figH * 0.06 ? [[eL.cx, eL.cy], [eR.cx, eR.cy]] : null;
  const faceY = eyes ? (eyes[0][1] + eyes[1][1]) / 2 : headTop + (neck.y - headTop) * 0.5;
  // hands: arm tips (from the arms layer) else the outermost silhouette points between the chin and mid-body
  let hl = hands?.handL ?? null;
  let hr = hands?.handR ?? null;
  if (!hl || !hr) {
    let lo = { x: cx, y: neck.y };
    let hi = { x: cx, y: neck.y };
    for (let y = neck.y; y <= neck.y + (bbox.bottom - neck.y) * 0.5; y++) {
      const s = span(y);
      if (!s) continue;
      if (s.l < lo.x) lo = { x: s.l, y };
      if (s.r > hi.x) hi = { x: s.r, y };
    }
    hl ??= [lo.x + (cx - lo.x) * 0.12, lo.y];
    hr ??= [hi.x - (hi.x - cx) * 0.12, hi.y];
  }
  const L = (v) => r1(v / res);
  const P = ([x, y]) => [L(x), L(y)];
  void arms;
  return {
    head: [L(cx), L(headTop)],
    face: [L(cx), L(faceY)],
    neck: [L(cx), L(neck.y)],
    handL: P(hl),
    handR: P(hr),
    back: [L(cx), L((neck.y + bbox.bottom) / 2)],
    eyes: eyes ? eyes.map(P) : null,
    headBox: { left: L(wide.l), right: L(wide.r + 1), top: L(headTop), bottom: L(neck.y), wideY: L(wide.y) },
    bbox: { x: L(bbox.left), y: L(bbox.top), w: L(bbox.width), h: L(bbox.height) },
  };
}

/**
 * Head width of a figure: the widest run of opaque pixels that contains the figure's centre column, over the top
 * `frac` of the figure (raised arms beside the head are separate runs; the arms of a standing pose sit lower).
 */
export function headWidth(raw, opts = {}) {
  return headSpan(raw, opts)?.width ?? 0;
}

/**
 * The head of a figure: widest run containing the centre column over the top `frac` (see headWidth) → {width, cx (run
 * centre), top (first opaque row of that column band = head top between the ears), row}. Null when empty.
 */
export function headSpan(raw, { frac = 0.5, thr = 128 } = {}) {
  const st = figureStats(raw, thr);
  if (!st) return null;
  const { data, w } = raw;
  const A = (x, y) => data[(y * w + x) * 4 + 3] > thr;
  const c = Math.round(st.bbox.left + st.bbox.width / 2);
  let best = { width: 0, cx: c, row: st.bbox.top };
  for (let y = st.bbox.top; y <= st.bbox.top + st.bbox.height * frac; y++) {
    if (!A(c, y)) continue;
    let l = c;
    let r = c;
    while (l > st.bbox.left && A(l - 1, y)) l--;
    while (r < st.bbox.right && A(r + 1, y)) r++;
    if (r - l + 1 > best.width) best = { width: r - l + 1, cx: (l + r + 1) / 2, row: y };
  }
  let top = st.bbox.top;
  for (let y = st.bbox.top; y <= best.row; y++) {
    if (A(Math.round(best.cx), y)) {
      top = y;
      break;
    }
  }
  return { ...best, top };
}

// ---------- sprite sheets ----------

/**
 * Normalise a keyed grid sheet: cells sliced evenly, every frame scaled by ONE factor (median frame head width →
 * `refHeadWidth` logical units, the base's head; else median frame height → `targetHeight`), feet on y 1303, feet centre
 * on x 512. All cells are the same crop of the logical canvas (`rect`, stored pixels at `res`). Returns the sheet raw +
 * per-frame stats (+ `heads`, the measured head widths in source pixels; with `refHead` {cx, top} (logical, the base's
 * head) `offsets` = each frame's head offset [dx, dy] in logical units).
 */
export async function normalizeSheet(keyed, { grid = [2, 2], targetHeight = CANVAS.feetY - CANVAS.headTop, refHeadWidth = null, refHead = null, res = SHEET_RES, canvas = CANVAS, minArea = null } = {}) {
  const [cols, rows] = grid;
  const cw = Math.floor(keyed.w / cols);
  const ch = Math.floor(keyed.h / rows);
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = { data: Buffer.alloc(cw * ch * 4), w: cw, h: ch };
      for (let y = 0; y < ch; y++) {
        const s0 = ((r * ch + y) * keyed.w + c * cw) * 4;
        keyed.data.copy(cell.data, y * cw * 4, s0, s0 + cw * 4);
      }
      removeSmallComponents(cell.data, cw, ch, minArea ?? Math.max(30, Math.round(cw * ch * 0.0004)));
      cells.push(cell);
    }
  }
  const stats = cells.map((c) => figureStats(c));
  if (stats.some((s) => !s)) throw new Error('빈 칸이 있어요 (시트의 칸마다 캐릭터가 있어야 해요)');
  // ONE scale for every frame: the head is the rigid part (the body squashes / stretches, the arms move), so the median
  // frame head width → the base's head width; without it the median frame height → the base's height
  const median = (a) => {
    const v = [...a].sort((x, y) => x - y);
    return v.length % 2 ? v[v.length >> 1] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  };
  const cellHeads = cells.map((c) => headWidth(c));
  const k = refHeadWidth && cellHeads.every((x) => x > 0) ? refHeadWidth / median(cellHeads) : targetHeight / median(stats.map((s) => s.height));
  const W = Math.round(canvas.w * res);
  const H = Math.round(canvas.h * res);
  const placed = [];
  const frames = [];
  for (let i = 0; i < cells.length; i++) {
    const st = stats[i];
    const s = k * res;
    const scaled = await resizeRaw(cells[i], Math.round(cw * s), Math.round(ch * s));
    placed.push(blit(scaled, W, H, Math.round(canvas.cx * res - st.cx * s), Math.round(canvas.feetY * res - st.feetY * s)));
    frames.push({ height: r1(st.height * k), feet: r4(st.feetY / ch), cx: r4(st.cx / cw) });
  }
  // where each frame's head is relative to the base's head (props ride along while the sheet plays), logical units
  const heads = refHead
    ? placed.map((p) => {
        const hs = headSpan(p);
        return hs ? [r1((hs.cx - refHead.cx * res) / res), r1((hs.top - refHead.top * res) / res)] : [0, 0];
      })
    : null;
  // every cell = the same crop of the canvas (union of the frames' content) → meta.rect places it
  let x0 = W;
  let y0 = H;
  let x1 = 0;
  let y1 = 0;
  for (const p of placed) {
    const b = alphaBBox(p.data, W, H, 0);
    if (!b) continue;
    x0 = Math.min(x0, b.left);
    y0 = Math.min(y0, b.top);
    x1 = Math.max(x1, b.right + 1);
    y1 = Math.max(y1, b.bottom + 1);
  }
  x0 = Math.max(0, x0 - 2);
  y0 = Math.max(0, y0 - 2);
  x1 = Math.min(W, x1 + 2);
  y1 = Math.min(H, y1 + 2);
  const CW = x1 - x0;
  const CH = y1 - y0;
  const sheet = Buffer.alloc(CW * cols * CH * rows * 4);
  placed.forEach((p, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    for (let y = 0; y < CH; y++) p.data.copy(sheet, ((r * CH + y) * CW * cols + c * CW) * 4, ((y0 + y) * W + x0) * 4, ((y0 + y) * W + x1) * 4);
  });
  return { sheet: { data: sheet, w: CW * cols, h: CH * rows }, frames, scale: r4(k), cell: [CW, CH], rect: [x0, y0, CW, CH], heads: cellHeads, offsets: heads };
}

// ---------- props ----------

/** Attach point inside a prop image (fractions of its trimmed box) per slot: a hat sinks a little into the head. */
export const PROP_ANCHORS = Object.freeze({ head: [0.5, 0.84], face: [0.5, 0.5], neck: [0.5, 0.25], hand: [0.5, 0.62], back: [0.5, 0.45] });
/** Drawn prop width in units of the figure's rig height H (renderer: width × H/450 × meta.scale). */
export const PROP_WIDTH_H = Object.freeze({ head: 0.78, face: 0.66, neck: 0.5, hand: 0.36, back: 0.72 });

/**
 * A prop on white: white → alpha (border flood fill, outlined white interiors stay), trimmed, ≤ maxSide px.
 * @returns {Promise<{buffer: Buffer (PNG), width, height, anchor: [x, y], scale}>}
 */
export async function normalizeProp(buffer, { slot = 'head', maxSide = 384 } = {}) {
  const keyed = await trim(await whiteToAlpha(await sharp(buffer).png().toBuffer()));
  const png = await sharp(keyed).resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  const meta = await sharp(png).metadata();
  const [fx, fy] = PROP_ANCHORS[slot] ?? PROP_ANCHORS.head;
  return {
    buffer: png,
    width: meta.width,
    height: meta.height,
    anchor: [r1(meta.width * fx), r1(meta.height * fy)],
    scale: r4(((PROP_WIDTH_H[slot] ?? 0.6) * 450) / meta.width),
  };
}

/** Share of fully transparent pixels. */
export function transparentShare(raw) {
  let k = 0;
  for (let p = 0; p < raw.w * raw.h; p++) if (raw.data[p * 4 + 3] === 0) k++;
  return k / (raw.w * raw.h);
}

/** Expand a logical box (canvas units) to stored pixels at `res`, clamped to the image. */
export function boxAt(box, res, w, h) {
  return {
    left: clamp(Math.floor(box.left * res), 0, w - 1),
    top: clamp(Math.floor(box.top * res), 0, h - 1),
    right: clamp(Math.ceil(box.right * res), 0, w - 1),
    bottom: clamp(Math.ceil(box.bottom * res), 0, h - 1),
  };
}

/**
 * Crop a stored canvas image to its content (alpha > 0) + `pad` px. Returns the cropped raw and `rect` [x, y, w, h] in
 * stored pixels (null when empty). The renderer draws the image at `meta.rect` (logical units) on the canvas.
 */
export function cropToContent(raw, { pad = 2 } = {}) {
  const b = alphaBBox(raw.data, raw.w, raw.h, 0);
  if (!b) return { raw: null, rect: null };
  const x0 = Math.max(0, b.left - pad);
  const y0 = Math.max(0, b.top - pad);
  const x1 = Math.min(raw.w, b.right + 1 + pad);
  const y1 = Math.min(raw.h, b.bottom + 1 + pad);
  const w = x1 - x0;
  const h = y1 - y0;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) raw.data.copy(out, y * w * 4, ((y0 + y) * raw.w + x0) * 4, ((y0 + y) * raw.w + x1) * 4);
  return { raw: { data: out, w, h }, rect: [x0, y0, w, h] };
}

/** A stored-pixel rect → logical canvas units. */
export const rectToLogical = (rect, res) => rect.map((v) => r1(v / res));
