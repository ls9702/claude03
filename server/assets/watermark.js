// Gemini-app watermark removal (manual imports, scripts/import-assets.js).
//
// The Gemini app stamps a faint white 4-point sparkle ✦ near the bottom-right corner as an alpha overlay of white:
//   observed = original × (1 − a) + 255 × a        (a ≤ ~0.31 at the sparkle's core)
// `watermark-alpha.png` (64×64, value = a × 255) is the sparkle's alpha measured on flat-magenta originals at 1024×1024
// (16 images averaged, G channel). Placement rule, verified at 1024×1024, 1024×687 and 1024×572 (±1 px):
//   scale s = √(w·h) / 1024 · centre = (w − 120.5·s, h − 120.5·s) · template centre (31.5, 31.5) → image pixel
//   (x, y) sees a((x − cx)/s + 31.5, (y − cy)/s + 31.5) (area-averaged over the pixel footprint).
// `removeWatermark` searches around the predicted spot (integer offsets, then sub-pixel offsets × scale), scores a
// candidate with a matched filter on luminance gradients (see scoreCandidate / findWatermark), reverses the blend
// (orig = (obs − 255a)/(1 − a), clamped; a ≥ 0.9 is inpainted from neighbours) and is a no-op when no candidate
// clearly improves the image (images without a watermark are returned untouched).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

export const WATERMARK_TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'watermark-alpha.png');
/** Placement at 1024×1024: distance from the right / bottom edge to the sparkle centre; template centre. */
export const WATERMARK_RULE = Object.freeze({ ref: 1024, margin: 120.5, center: 31.5, radius: 36 });

let template = null;

/** The alpha template {size, a: Float32Array} (a in 0..1), loaded once. */
export async function loadWatermarkTemplate(file = WATERMARK_TEMPLATE) {
  if (template && file === WATERMARK_TEMPLATE) return template;
  const { data, info } = await sharp(readFileSync(file)).raw().toBuffer({ resolveWithObject: true });
  const a = new Float32Array(info.width * info.height);
  for (let i = 0; i < a.length; i++) a[i] = data[i * info.channels] / 255;
  const t = { size: info.width, a };
  if (file === WATERMARK_TEMPLATE) template = t;
  return t;
}

/** Predicted scale and centre of the sparkle in a w×h image. */
export function predictWatermark(w, h, rule = WATERMARK_RULE) {
  const s = Math.sqrt(w * h) / rule.ref;
  return { s, cx: w - rule.margin * s, cy: h - rule.margin * s };
}

function sampleT(t, u, v) {
  const S = t.size;
  if (u < 0 || v < 0 || u > S - 1 || v > S - 1) return 0;
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const x1 = Math.min(S - 1, x0 + 1);
  const y1 = Math.min(S - 1, y0 + 1);
  const fx = u - x0;
  const fy = v - y0;
  const a = t.a;
  return (a[y0 * S + x0] * (1 - fx) + a[y0 * S + x1] * fx) * (1 - fy) + (a[y1 * S + x0] * (1 - fx) + a[y1 * S + x1] * fx) * fy;
}

/**
 * Alpha raster of a sparkle at scale `s`, centre (cx, cy), over the box [bx, bx + bw) × [by, by + bh); a downscaled
 * sparkle averages 3×3 samples over the extra pixel footprint (anti-aliased, not point-sampled).
 */
export function watermarkAlpha(t, { s, cx, cy }, bx, by, bw, bh, rule = WATERMARK_RULE) {
  const out = new Float32Array(bw * bh);
  // the template pixels are already area-integrated at scale 1 → only the extra footprint of a downscaled pixel
  // (1/s − 1 template px) is averaged; upscaled sparkles are sampled bilinearly
  const spread = Math.max(0, 1 / s - 1);
  const k = spread > 0.05 ? 3 : 1;
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      let sum = 0;
      const u0 = (bx + x - cx) / s + rule.center;
      const v0 = (by + y - cy) / s + rule.center;
      for (let j = 0; j < k; j++) {
        for (let i = 0; i < k; i++) {
          const du = k > 1 ? ((i + 0.5) / k - 0.5) * spread : 0;
          const dv = k > 1 ? ((j + 0.5) / k - 0.5) * spread : 0;
          sum += sampleT(t, u0 + du, v0 + dv);
        }
      }
      out[y * bw + x] = sum / (k * k);
    }
  }
  return out;
}

const lum = (d, i) => d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;

/**
 * Score a candidate with a matched filter on luminance gradients: the white overlay adds ∇a·(255 − v) to the
 * observed gradient (v = local background). `k` = least-squares gain of that predicted edge pattern in the observed
 * gradients (≈ 1 at the right spot, ≈ 0 without a watermark); pixels whose observed gradient is far above what the
 * overlay could add (line art crossing the sparkle) are skipped, and `minQuadrant` = the lowest k of the four arms.
 * @returns {gain: k, minQuadrant, snr, matched, energy}
 */
function scoreCandidate(data, w, h, ch, alpha, bx, by, bw, bh, cx, cy) {
  const obs = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) obs[y * bw + x] = lum(data, ((by + y) * w + bx + x) * ch);
  const pred = [];
  for (let y = 0; y < bh - 1; y++) {
    for (let x = 0; x < bw - 1; x++) {
      const p = y * bw + x;
      if (!(alpha[p] > 0.004 || alpha[p + 1] > 0.004 || alpha[p + bw] > 0.004)) continue;
      // un-blended background estimate for the edge height
      const a = Math.min(0.9, alpha[p]);
      const v = Math.max(0, Math.min(255, (obs[p] - 255 * a) / (1 - a)));
      const px = (alpha[p + 1] - alpha[p]) * (255 - v);
      const py = (alpha[p + bw] - alpha[p]) * (255 - v);
      pred.push(p, px, py);
    }
  }
  // pixels on line art / texture (observed gradient far above what the overlay could add) carry no evidence
  const qm = [0, 0, 0, 0];
  const qe = [0, 0, 0, 0];
  for (let i = 0; i < pred.length; i += 3) {
    const p = pred[i];
    const ox = obs[p + 1] - obs[p];
    const oy = obs[p + bw] - obs[p];
    const lim = Math.max(10, 2 * Math.hypot(pred[i + 1], pred[i + 2]));
    if (Math.hypot(ox, oy) > lim) continue;
    const x = bx + (p % bw);
    const y = by + Math.floor(p / bw);
    const q = (x >= cx ? 1 : 0) + (y >= cy ? 2 : 0);
    qm[q] += ox * pred[i + 1] + oy * pred[i + 2];
    qe[q] += pred[i + 1] ** 2 + pred[i + 2] ** 2;
  }
  const matched = qm.reduce((a, b) => a + b, 0);
  const energy = qe.reduce((a, b) => a + b, 0);
  const ks = qe.map((e, q) => (e > energy * 0.01 ? qm[q] / e : null)).filter((k) => k != null);
  return {
    gain: energy > 1e-6 ? matched / energy : 0,
    minQuadrant: ks.length ? Math.min(...ks) : 0,
    snr: energy > 1e-6 ? matched / Math.sqrt(energy) : 0, // matched-filter response (scale-fair ranking)
    matched,
    energy,
  };
}

/**
 * Find the sparkle in raw RGB(A) pixels: the candidate with the best matched-filter response, accepted when its gain
 * k is in [minGain, maxGain] and every arm fits (minQuadrant). Measured: Gemini-app images k 1.0–1.15 (min arm
 * 0.62–1.13), clean backgrounds k ≤ 0.25 (min arm ≤ 0.02), synthetic line art k ≤ 0.57 (min arm ≤ 0.1).
 * @returns {s, cx, cy, gain, minQuadrant} or null
 */
export function findWatermark(data, w, h, ch, t, { minGain = 0.65, maxGain = 2.5, minQuadrant = 0.25, search = 6, rule = WATERMARK_RULE } = {}) {
  const p = predictWatermark(w, h, rule);
  if (p.s < 0.2) return null;
  const R = Math.ceil(rule.radius * p.s * 1.12) + search + 2;
  const bx = Math.max(0, Math.round(p.cx) - R);
  const by = Math.max(0, Math.round(p.cy) - R);
  const bw = Math.min(w, Math.round(p.cx) + R) - bx;
  const bh = Math.min(h, Math.round(p.cy) + R) - by;
  if (bw < 8 || bh < 8) return null;
  const tryAt = (s, cx, cy) => ({ s, cx, cy, ...scoreCandidate(data, w, h, ch, watermarkAlpha(t, { s, cx, cy }, bx, by, bw, bh, rule), bx, by, bw, bh, cx, cy) });
  // rank by how well the whole shape fits (overall gain + worst arm, each capped): robust to line art crossing one arm
  const rank = (c) => Math.min(c.gain, 1.3) + Math.min(c.minQuadrant, 1.3);
  const better = (c, b) => !b || rank(c) > rank(b);
  let best = null;
  for (let dy = -search; dy <= search; dy++) {
    for (let dx = -search; dx <= search; dx++) {
      const c = tryAt(p.s, p.cx + dx, p.cy + dy);
      if (better(c, best)) best = c;
    }
  }
  // refine: sub-pixel offsets × ±6 % scale around the best integer offset
  const base = best;
  for (const ks of [0.94, 0.97, 1, 1.03, 1.06]) {
    for (let dy = -0.75; dy <= 0.75; dy += 0.25) {
      for (let dx = -0.75; dx <= 0.75; dx += 0.25) {
        if (ks === 1 && !dx && !dy) continue;
        const c = tryAt(p.s * ks, base.cx + dx, base.cy + dy);
        if (better(c, best)) best = c;
      }
    }
  }
  if (!(best.gain >= minGain && best.gain <= maxGain && best.minQuadrant >= minQuadrant)) return null;
  return { s: best.s, cx: best.cx, cy: best.cy, gain: best.gain, minQuadrant: best.minQuadrant, box: { x: bx, y: by, w: bw, h: bh } };
}

/**
 * Remove the Gemini-app sparkle from an image buffer (any format sharp reads). Returns a PNG buffer (unchanged
 * pixels when no watermark was found) and what was done.
 * @returns {Promise<{buffer: Buffer, found: null | {s, cx, cy, gain}}>}
 */
export async function removeWatermarkDetailed(buffer, opts = {}) {
  const t = await loadWatermarkTemplate(opts.template);
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: ch } = info;
  const found = findWatermark(data, w, h, ch, t, opts);
  if (!found) return { buffer: await sharp(buffer).png().toBuffer(), found: null };
  const { x: bx, y: by, w: bw, h: bh } = found.box;
  const alpha = watermarkAlpha(t, found, bx, by, bw, bh);
  const out = Buffer.from(data);
  const hard = [];
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const a = alpha[y * bw + x];
      if (!(a > 0.002)) continue;
      const i = ((by + y) * w + bx + x) * ch;
      if (a >= 0.9) {
        hard.push([bx + x, by + y]);
        continue;
      }
      for (let c = 0; c < 3; c++) out[i + c] = Math.max(0, Math.min(255, Math.round((data[i + c] - 255 * a) / (1 - a))));
    }
  }
  // (nearly) opaque sparkle pixels carry no original colour → mean of the recovered 8-neighbours
  for (const [x, y] of hard) {
    const i = (y * w + x) * ch;
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      let n = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h || (!dx && !dy)) continue;
          const u = xx - bx;
          const v = yy - by;
          if (u >= 0 && v >= 0 && u < bw && v < bh && alpha[v * bw + u] >= 0.9) continue;
          sum += out[(yy * w + xx) * ch + c];
          n++;
        }
      }
      if (n) out[i + c] = Math.round(sum / n);
    }
  }
  const png = await sharp(out, { raw: { width: w, height: h, channels: ch } }).png().toBuffer();
  const { box, ...rest } = found;
  return { buffer: png, found: rest };
}

/** `removeWatermarkDetailed(...).buffer`. */
export async function removeWatermark(buffer, opts = {}) {
  return (await removeWatermarkDetailed(buffer, opts)).buffer;
}

/**
 * Stamp a synthetic sparkle (tests): observed = orig × (1 − a) + 255 × a at the predicted spot (+ offset).
 * @returns {Promise<Buffer>} PNG
 */
export async function addWatermark(buffer, { dx = 0, dy = 0, gain = 1 } = {}) {
  const t = await loadWatermarkTemplate();
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: ch } = info;
  const p = predictWatermark(w, h);
  const cand = { s: p.s, cx: p.cx + dx, cy: p.cy + dy };
  const alpha = watermarkAlpha(t, cand, 0, 0, w, h);
  const out = Buffer.from(data);
  for (let q = 0; q < w * h; q++) {
    const a = Math.min(1, alpha[q] * gain);
    if (!a) continue;
    for (let c = 0; c < 3; c++) out[q * ch + c] = Math.round(data[q * ch + c] * (1 - a) + 255 * a);
  }
  return sharp(out, { raw: { width: w, height: h, channels: ch } }).png().toBuffer();
}
