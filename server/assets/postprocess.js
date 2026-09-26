// Image post-processing for generated assets (sharp + a few raw-pixel passes).
// Gemini never returns an exact #FF00FF backdrop (measured ~rgb(213,37,136)) and sometimes paints a
// ground shadow, so chromaKey samples the corners and also kills pixels in the backdrop's hue family.
import sharp from 'sharp';

const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };

/** Decode any image to raw RGBA. */
export async function toRaw(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

export function fromRaw(data, w, h) {
  return sharp(data, { raw: { width: w, height: h, channels: 4 } });
}

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

/** Median colour of 5×5 patches at the four corners. */
export function sampleBackground(data, w, h) {
  const samples = [[], [], []];
  const patch = Math.max(1, Math.min(5, Math.floor(Math.min(w, h) / 10)));
  for (const [cx, cy] of [
    [0, 0],
    [w - patch, 0],
    [0, h - patch],
    [w - patch, h - patch],
  ]) {
    for (let y = cy; y < cy + patch; y++) {
      for (let x = cx; x < cx + patch; x++) {
        const i = (y * w + x) * 4;
        samples[0].push(data[i]);
        samples[1].push(data[i + 1]);
        samples[2].push(data[i + 2]);
      }
    }
  }
  const med = (a) => a.sort((x, y) => x - y)[a.length >> 1];
  return { r: med(samples[0]), g: med(samples[1]), b: med(samples[2]) };
}

/**
 * Remove connected foreground islands (alpha > 0, 8-connectivity) smaller than minArea pixels.
 * Mutates `data` in place; returns the number of pixels cleared.
 */
export function removeSmallComponents(data, w, h, minArea) {
  const n = w * h;
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const members = [];
  let cleared = 0;
  for (let start = 0; start < n; start++) {
    if (seen[start] || data[start * 4 + 3] === 0) continue;
    members.length = 0;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    while (sp) {
      const p = stack[--sp];
      members.push(p);
      const x = p % w;
      const y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w || (!dx && !dy)) continue;
          const q = yy * w + xx;
          if (!seen[q] && data[q * 4 + 3] !== 0) {
            seen[q] = 1;
            stack[sp++] = q;
          }
        }
      }
    }
    if (members.length < minArea) {
      for (const p of members) data[p * 4 + 3] = 0;
      cleared += members.length;
    }
  }
  return cleared;
}

/**
 * Chroma key: backdrop colour from the corners, soft distance alpha, hue-family kill (catches the
 * darker magenta ground shadow), despill of semi-transparent edges, small-island removal.
 * Returns a PNG with the original canvas size (layers stay aligned). `trim: true` to crop.
 */
export async function chromaKey(buffer, { hard = 22, soft = 60, hueKill = 14, hueSoft = 22, minSat = 0.5, minArea, trim: doTrim = false } = {}) {
  const { data, w, h } = await toRaw(buffer);
  const bg = sampleBackground(data, w, h);
  const [bh, bs] = hueSat(bg.r, bg.g, bg.b);
  const useHue = bs > 0.35; // only meaningful for a saturated backdrop
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const d = Math.sqrt((r - bg.r) ** 2 + (g - bg.g) ** 2 + (b - bg.b) ** 2);
    let a = d <= hard ? 0 : d >= soft ? 1 : (d - hard) / (soft - hard);
    if (useHue) {
      const [hh, ss] = hueSat(r, g, b);
      const hd = Math.min(Math.abs(hh - bh), 360 - Math.abs(hh - bh));
      if (ss > minSat) {
        if (hd < hueKill) a = 0;
        else if (hd < hueSoft) a = Math.min(a, (hd - hueKill) / (hueSoft - hueKill));
      }
    }
    a = Math.min(a, data[i + 3] / 255);
    if (a < 1 && a > 0) {
      // despill: pull the backdrop tint out of edge pixels (magenta = high R+B, low G)
      data[i] = Math.round(r * a + g * (1 - a));
      data[i + 2] = Math.round(b * a + g * (1 - a));
    }
    data[i + 3] = Math.round(a * 255);
  }
  removeSmallComponents(data, w, h, minArea ?? Math.max(24, Math.round(w * h * 0.0002)));
  const png = await fromRaw(data, w, h).png().toBuffer();
  return doTrim ? trim(png) : png;
}

/**
 * Icons on white: flood-fill from the border through near-white pixels only, so white areas
 * *inside* an outlined icon (a card face, a sign) stay opaque. Near-white edge pixels get
 * partial alpha with the white un-mixed out.
 */
export async function whiteToAlpha(buffer, { threshold = 240, soft = 200, maxChroma = 36, minArea } = {}) {
  const { data, w, h } = await toRaw(buffer);
  const n = w * h;
  const whiteness = (p) => {
    const i = p * 4;
    const mn = Math.min(data[i], data[i + 1], data[i + 2]);
    const mx = Math.max(data[i], data[i + 1], data[i + 2]);
    return mx - mn <= maxChroma ? mn : -1;
  };
  const bgMask = new Uint8Array(n);
  const stack = new Int32Array(n);
  let sp = 0;
  const push = (p) => {
    if (!bgMask[p] && whiteness(p) >= soft) {
      bgMask[p] = 1;
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
    if (!bgMask[p]) continue;
    const i = p * 4;
    const wv = whiteness(p);
    const a = wv >= threshold ? 0 : (threshold - wv) / (threshold - soft);
    if (a > 0) {
      for (let c = 0; c < 3; c++) data[i + c] = Math.max(0, Math.min(255, Math.round((data[i + c] - 255 * (1 - a)) / a)));
    }
    data[i + 3] = Math.round(Math.min(a, data[i + 3] / 255) * 255);
  }
  removeSmallComponents(data, w, h, minArea ?? Math.max(16, Math.round(n * 0.0001)));
  return fromRaw(data, w, h).png().toBuffer();
}

/** Bounding box of pixels with alpha > thr, or null when fully transparent. */
export function alphaBBox(data, w, h, thr = 8) {
  let left = w;
  let top = h;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (data[(row + x) * 4 + 3] > thr) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        bottom = y;
      }
    }
  }
  if (right < 0) return null;
  return { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 };
}

/** Crop to the alpha bounding box (transparent images) or sharp's colour trim (opaque ones). */
export async function trim(buffer, { threshold = 8 } = {}) {
  const meta = await sharp(buffer).metadata();
  if (!meta.hasAlpha) return sharp(buffer).trim().png().toBuffer();
  const { data, w, h } = await toRaw(buffer);
  const box = alphaBBox(data, w, h, threshold);
  if (!box) return sharp(buffer).png().toBuffer();
  return sharp(buffer).extract({ left: box.left, top: box.top, width: box.width, height: box.height }).png().toBuffer();
}

/**
 * Resize to exactly w×h. Transparent images are letterboxed (contain, transparent padding) so
 * nothing is cropped; opaque images are cropped to fill (cover).
 */
export async function resize(buffer, w, h, { fit } = {}) {
  const meta = await sharp(buffer).metadata();
  const mode = fit ?? (meta.hasAlpha ? 'contain' : 'cover');
  return sharp(buffer).resize(w, h, { fit: mode, background: CLEAR }).png().toBuffer();
}

/** Composite `img` (bw×bh) at (left, top) on a transparent W×H canvas, clipping overflow. */
async function placeOnCanvas(img, bw, bh, left, top, W, H) {
  const sx = Math.max(0, -left);
  const sy = Math.max(0, -top);
  const dx = Math.max(0, left);
  const dy = Math.max(0, top);
  const vw = Math.min(bw - sx, W - dx);
  const vh = Math.min(bh - sy, H - dy);
  const canvas = sharp({ create: { width: W, height: H, channels: 4, background: CLEAR } });
  if (vw <= 0 || vh <= 0) return canvas.png().toBuffer();
  const part = sx || sy || vw !== bw || vh !== bh ? await sharp(img).extract({ left: sx, top: sy, width: vw, height: vh }).toBuffer() : img;
  return canvas.composite([{ input: part, left: dx, top: dy }]).png().toBuffer();
}

/**
 * Align animation frames / key poses: every frame's alpha bbox is scaled so its height matches the
 * first frame's (or `height`), then placed so the bbox bottom sits on the first frame's baseline and
 * its centre on the first frame's bbox centre. All outputs share the first frame's canvas (or `canvas`).
 * The first frame comes out unchanged when no `height`/`canvas` is given.
 */
export async function normalizeFrames(buffers, { anchor = 'bottom-center', height, canvas, scale = true } = {}) {
  if (anchor !== 'bottom-center') throw new Error(`unsupported anchor: ${anchor}`);
  if (!buffers.length) return [];
  const raws = await Promise.all(buffers.map(toRaw));
  const boxes = raws.map((r) => alphaBBox(r.data, r.w, r.h));
  const W = canvas?.w ?? raws[0].w;
  const H = canvas?.h ?? raws[0].h;
  const b0 = boxes[0] ?? { left: 0, top: 0, width: raws[0].w, height: raws[0].h, bottom: raws[0].h - 1 };
  const sx0 = W / raws[0].w;
  const sy0 = H / raws[0].h;
  const targetH = height ?? Math.round(b0.height * sy0);
  const baseline = Math.round((b0.bottom + 1) * sy0); // y just below the feet
  const centerX = Math.round((b0.left + b0.width / 2) * sx0);
  return Promise.all(
    raws.map(async (r, i) => {
      const box = boxes[i];
      if (!box) return sharp({ create: { width: W, height: H, channels: 4, background: CLEAR } }).png().toBuffer();
      const crop = await fromRaw(r.data, r.w, r.h).extract({ left: box.left, top: box.top, width: box.width, height: box.height }).png().toBuffer();
      const s = scale ? targetH / box.height : sy0;
      const bw = Math.max(1, Math.round(box.width * s));
      const bh = Math.max(1, Math.round(box.height * s));
      const scaled = bw === box.width && bh === box.height ? crop : await sharp(crop).resize(bw, bh, { fit: 'fill' }).png().toBuffer();
      return placeOnCanvas(scaled, bw, bh, Math.round(centerX - bw / 2), baseline - bh, W, H);
    }),
  );
}

/** Sprite sheet (row-major grid). Frames are centred in cells of the largest frame size. */
export async function sheet(buffers, { cols } = {}) {
  const metas = await Promise.all(buffers.map((b) => sharp(b).metadata()));
  const fw = Math.max(...metas.map((m) => m.width));
  const fh = Math.max(...metas.map((m) => m.height));
  const c = Math.max(1, Math.min(cols ?? buffers.length, buffers.length));
  const rows = Math.ceil(buffers.length / c);
  const frames = buffers.map((_, i) => ({ x: (i % c) * fw, y: Math.floor(i / c) * fh, w: fw, h: fh }));
  const buffer = await sharp({ create: { width: fw * c, height: fh * rows, channels: 4, background: CLEAR } })
    .composite(
      buffers.map((input, i) => ({
        input,
        left: frames[i].x + Math.floor((fw - metas[i].width) / 2),
        top: frames[i].y + (fh - metas[i].height),
      })),
    )
    .png()
    .toBuffer();
  return { buffer, meta: { frameWidth: fw, frameHeight: fh, cols: c, rows, count: buffers.length, frames } };
}

/** Animated WebP from equally sized frames (others are letterboxed to the first frame's size). */
export async function animatedWebp(buffers, delays = 120, { quality = 88, loop = 0 } = {}) {
  const m0 = await sharp(buffers[0]).metadata();
  const frames = await Promise.all(
    buffers.map(async (b) => {
      const m = await sharp(b).metadata();
      return m.width === m0.width && m.height === m0.height ? b : resize(b, m0.width, m0.height, { fit: 'contain' });
    }),
  );
  const delay = buffers.map((_, i) => (Array.isArray(delays) ? (delays[i] ?? delays[delays.length - 1] ?? 120) : delays));
  return sharp(frames, { join: { animated: true } }).webp({ quality, loop, delay }).toBuffer();
}

/**
 * Seamless-tiling heuristic: compare the wrap-around seam (last column vs first column, last row vs
 * first row) with the average difference between neighbouring interior columns/rows.
 * A ratio near 1 means the seam looks like any other pixel step.
 */
export async function isSeamless(buffer, { maxRatio = 2, sample = 256 } = {}) {
  const { data, info } = await sharp(buffer).resize(sample, sample, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const ch = info.channels;
  const px = (x, y, c) => data[(y * w + x) * ch + c];
  const diff = (x1, y1, x2, y2) => {
    let s = 0;
    for (let c = 0; c < 3; c++) s += Math.abs(px(x1, y1, c) - px(x2, y2, c));
    return s;
  };
  let seamX = 0;
  let seamY = 0;
  let innerX = 0;
  let innerY = 0;
  for (let y = 0; y < h; y++) {
    seamX += diff(w - 1, y, 0, y);
    for (let x = 0; x < w - 1; x++) innerX += diff(x, y, x + 1, y);
  }
  for (let x = 0; x < w; x++) {
    seamY += diff(x, h - 1, x, 0);
    for (let y = 0; y < h - 1; y++) innerY += diff(x, y, x, y + 1);
  }
  const ratioX = seamX / h / Math.max(1e-6, innerX / (h * (w - 1)));
  const ratioY = seamY / w / Math.max(1e-6, innerY / (w * (h - 1)));
  const score = Math.max(ratioX, ratioY);
  return { seamless: score <= maxRatio, score: Math.round(score * 100) / 100, ratioX: Math.round(ratioX * 100) / 100, ratioY: Math.round(ratioY * 100) / 100 };
}

export const toWebp = (buffer, { quality = 88 } = {}) => sharp(buffer).webp({ quality }).toBuffer();
export const toPng = (buffer) => sharp(buffer).png().toBuffer();

/**
 * Run a manifest `postprocess` list over one or more frames.
 * - `normalizeFrames` with a single frame and a `ref` aligns it to the ref (key poses vs. the base).
 * - `sheet` / `webp` on multiple frames produce a sprite sheet and an animated WebP.
 * - `webp` on a single frame only marks the result for WebP encoding (the output extension decides).
 * @returns {Promise<{frames: Buffer[], sheet?: {buffer: Buffer, meta: object}, anim?: Buffer, notes: object}>}
 */
export async function applySteps(frames, steps, { ref, delays, anchor = 'bottom-center' } = {}) {
  let cur = frames;
  const out = { notes: {} };
  for (const step of steps) {
    if (step === 'chromaKey') cur = await Promise.all(cur.map((b) => chromaKey(b)));
    else if (step === 'whiteToAlpha') cur = await Promise.all(cur.map((b) => whiteToAlpha(b)));
    else if (step === 'trim') cur = await Promise.all(cur.map((b) => trim(b)));
    else if (step.startsWith('resize:')) {
      const [w, h] = step.slice(7).split('x').map(Number);
      cur = await Promise.all(cur.map((b) => resize(b, w, h)));
    } else if (step === 'normalizeFrames') {
      if (ref && cur.length === 1) cur = (await normalizeFrames([ref, cur[0]], { anchor })).slice(1);
      else if (cur.length > 1) cur = await normalizeFrames(cur, { anchor });
    } else if (step === 'sheet') out.sheet = await sheet(cur, { cols: Math.min(cur.length, 8) });
    else if (step === 'webp') {
      if (cur.length > 1) out.anim = await animatedWebp(cur, delays ?? 120);
    } else if (step === 'seamless') out.notes.seamless = await isSeamless(cur[0]);
    else throw new Error(`unknown postprocess step: ${step}`);
  }
  out.frames = cur;
  return out;
}
