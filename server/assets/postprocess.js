// Image post-processing for generated assets (sharp + a few raw-pixel passes).
// Gemini never returns an exact #FF00FF backdrop (measured ~rgb(213,37,136)) and sometimes paints a
// ground shadow, so chromaKey samples the corners and also kills pixels in the backdrop's hue family.
import sharp from 'sharp';
import { measureFill, tintPixels } from './tintMath.js';

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

/**
 * Median colour of 5×5 patches at the four corners. `corners: 3` skips the bottom-right corner (the Gemini
 * app paints its sparkle watermark there).
 */
export function sampleBackground(data, w, h, { corners = 4 } = {}) {
  const samples = [[], [], []];
  const patch = Math.max(1, Math.min(5, Math.floor(Math.min(w, h) / 10)));
  const spots = [
    [0, 0],
    [w - patch, 0],
    [0, h - patch],
    [w - patch, h - patch],
  ].slice(0, corners === 3 ? 3 : 4);
  for (const [cx, cy] of spots) {
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

/** Bottom-right watermark box (fractions of the canvas): seed region and the region an island must fit in. */
export const WATERMARK_BOX = { seed: 0.1, fit: 0.16 };

/**
 * Gemini-app watermark cleanup (after keying): clear every foreground island (alpha > 0, 8-connectivity) that
 * touches the bottom-right seed box and lies entirely inside the (slightly larger) fit box — i.e. an isolated
 * sparkle in the corner, never a subject that merely reaches into it. Mutates `data`; returns pixels cleared.
 */
export function clearCornerIslands(data, w, h, { seed = WATERMARK_BOX.seed, fit = WATERMARK_BOX.fit } = {}) {
  const sx = Math.floor(w * (1 - seed));
  const sy = Math.floor(h * (1 - seed));
  const fx = Math.floor(w * (1 - fit));
  const fy = Math.floor(h * (1 - fit));
  const seen = new Uint8Array(w * h);
  const stack = [];
  let cleared = 0;
  for (let y = sy; y < h; y++) {
    for (let x = sx; x < w; x++) {
      const start = y * w + x;
      if (seen[start] || data[start * 4 + 3] === 0) continue;
      const members = [];
      let inside = true;
      stack.push(start);
      seen[start] = 1;
      while (stack.length) {
        const p = stack.pop();
        members.push(p);
        const px = p % w;
        const py = (p - px) / w;
        if (px < fx || py < fy) inside = false;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = py + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = px + dx;
            if (xx < 0 || xx >= w || (!dx && !dy)) continue;
            const q = yy * w + xx;
            if (!seen[q] && data[q * 4 + 3] !== 0) {
              seen[q] = 1;
              stack.push(q);
            }
          }
        }
      }
      if (inside) {
        for (const p of members) data[p * 4 + 3] = 0;
        cleared += members.length;
      }
    }
  }
  return cleared;
}

/**
 * Chroma key: backdrop colour from the corners, soft distance alpha, hue-family kill (catches the
 * darker magenta ground shadow), despill of semi-transparent edges, small-island removal.
 * Returns a PNG with the original canvas size (layers stay aligned). `trim: true` to crop.
 */
export async function chromaKey(buffer, { hard = 22, soft = 60, hueKill = 14, hueSoft = 22, minSat = 0.5, minArea, trim: doTrim = false, watermark = false } = {}) {
  const { data, w, h } = await toRaw(buffer);
  const bg = sampleBackground(data, w, h, { corners: watermark ? 3 : 4 });
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
  if (watermark) clearCornerIslands(data, w, h);
  const png = await fromRaw(data, w, h).png().toBuffer();
  return doTrim ? trim(png) : png;
}

/**
 * Icons on white: flood-fill from the border through near-white pixels only, so white areas
 * *inside* an outlined icon (a card face, a sign) stay opaque. Near-white edge pixels get
 * partial alpha with the white un-mixed out. `watermark: true` (manual Gemini-app imports) also clears an
 * isolated island in the bottom-right corner (the sparkle watermark, which is not white).
 */
export async function whiteToAlpha(buffer, { threshold = 240, soft = 200, maxChroma = 36, minArea, watermark = false } = {}) {
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
  if (watermark) clearCornerIslands(data, w, h);
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
 * - `diffExtract:<region>` (paper-doll parts) diffs the frame against `base` (the keyed diff base) →
 *   `layers.src` (keyed edit) + `layers.erase?`; region `hair` adds `layers.front/back`, region `body`
 *   moves headwear to `layers.hat`.
 * - `alignHead` aligns a mannequin variant to `base` by the head box; `mannequin` keeps the keyed original
 *   as `layers.base` and outputs the display copy (underwear recoloured).
 * - `watermark: true` (manual Gemini-app imports): keyed steps sample the backdrop from 3 corners and clear an
 *   isolated bottom-right island (the sparkle watermark).
 * @returns {Promise<{frames: Buffer[], sheet?: {buffer: Buffer, meta: object}, anim?: Buffer, layers?: Record<string, Buffer>, notes: object}>}
 */
export async function applySteps(frames, steps, { ref, delays, anchor = 'bottom-center', base, diffOptions, watermark = false } = {}) {
  let cur = frames;
  const out = { notes: {} };
  for (const step of steps) {
    if (step === 'chromaKey') cur = await Promise.all(cur.map((b) => chromaKey(b, { watermark })));
    else if (step === 'whiteToAlpha') cur = await Promise.all(cur.map((b) => whiteToAlpha(b, { watermark })));
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
    else if (step.startsWith('diffExtract:')) {
      // Paper-doll part: keep only what the edit added to the base mannequin (`base` = keyed base PNG).
      if (!base) throw new Error('diffExtract needs a base image (meta.base)');
      const region = step.slice('diffExtract:'.length);
      const src = cur[0];
      const r = await diffExtractDetailed(base, src, { region, erase: region === 'hair' || region === 'body', ...(diffOptions ?? {}) });
      out.notes.diff = r.info;
      out.layers = { ...(out.layers ?? {}), src };
      if (r.erase) out.layers.erase = r.erase;
      let layer = r.buffer;
      if (region === 'hair') {
        const split = await splitFrontBack(layer, base);
        out.layers.front = split.front;
        out.layers.back = split.back;
        out.notes.split = split.info;
      } else if (region === 'body') {
        const hat = await splitHat(layer, base);
        if (hat) {
          out.layers.hat = hat.hat;
          layer = hat.rest;
          out.notes.hat = hat.pixels;
        }
      }
      cur = [layer, ...cur.slice(1)];
    } else if (step === 'alignHead') {
      if (!base) throw new Error('alignHead needs a base image (meta.base)');
      const a = await alignToHead(cur[0], base);
      out.notes.align = a.info;
      cur = [a.buffer, ...cur.slice(1)];
    } else if (step === 'mannequin') {
      // Keep the keyed original (pale-cyan underwear) as the `base` file for edits/diffs; publish a display copy.
      const d = await mannequinDisplay(cur[0]);
      out.layers = { ...(out.layers ?? {}), base: cur[0] };
      out.notes.underwear = d.recolored;
      cur = [d.buffer, ...cur.slice(1)];
    } else throw new Error(`unknown postprocess step: ${step}`);
  }
  out.frames = cur;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Paper-doll layers (Stage 5.5-B): every avatar option is a Gemini *edit* of a shared mannequin
// ("keep everything, only add X"). diffExtract keeps only the pixels the edit added/changed inside a
// category region, so every layer lands on the mannequin's 1024×1536 canvas already aligned.
// ---------------------------------------------------------------------------------------------

/**
 * Figure landmarks from a keyed mannequin: silhouette bbox and the head box (top of the skull down to the
 * chin, where the silhouette narrows to the neck; ears included).
 * @returns {{bbox: object, head: {left, top, right, bottom, width, height}} | null}
 */
export function detectFigure(data, w, h, thr = 128) {
  const bbox = alphaBBox(data, w, h, thr);
  if (!bbox) return null;
  const span = (y) => {
    let l = -1;
    let r = -1;
    const row = y * w;
    for (let x = bbox.left; x <= bbox.right; x++) {
      if (data[(row + x) * 4 + 3] > thr) {
        if (l < 0) l = x;
        r = x;
      }
    }
    return l < 0 ? null : [l, r];
  };
  const lim = bbox.top + Math.round(bbox.height * 0.55);
  let maxW = 0;
  let maxY = bbox.top;
  const spans = [];
  for (let y = bbox.top; y <= lim; y++) {
    const s = span(y);
    spans.push(s);
    const wd = s ? s[1] - s[0] + 1 : 0;
    if (wd > maxW) {
      maxW = wd;
      maxY = y;
    }
  }
  let chin = -1;
  for (let y = maxY; y <= lim; y++) {
    const s = spans[y - bbox.top];
    if (!s || s[1] - s[0] + 1 < 0.55 * maxW) {
      chin = y;
      break;
    }
  }
  if (chin < 0) chin = bbox.top + Math.round(bbox.height * 0.4);
  let left = w;
  let right = -1;
  for (let y = bbox.top; y < chin; y++) {
    const s = spans[y - bbox.top];
    if (s) {
      left = Math.min(left, s[0]);
      right = Math.max(right, s[1]);
    }
  }
  const head = { left, top: bbox.top, right, bottom: chin, width: right - left + 1, height: chin - bbox.top };
  return { bbox, head };
}

/** Region names used by `diffExtract:<region>` (manifest postprocess) → part slots. */
export const DIFF_REGIONS = ['hair', 'face', 'eyes', 'mouth', 'cheek', 'expression', 'accessory', 'body'];

/**
 * Category region box (inclusive pixel bounds, clamped) derived from the base figure.
 * head-ish parts use the head box (padded); hair extends up/sideways and down to the knees (long hair);
 * body (outfits) spans neck → below the feet, wider than the silhouette.
 */
export function regionBox(fig, region, w, h, { headwear = false } = {}) {
  const H = fig.head;
  const B = fig.bbox;
  const hw = H.width;
  const hh = H.height;
  const pad = (l, t, r, b) => ({ left: H.left - l * hw, top: H.top - t * hh, right: H.right + r * hw, bottom: H.bottom + b * hh });
  let box;
  switch (region) {
    case 'hair':
      box = { ...pad(0.55, 0.45, 0.55, 0), bottom: B.top + B.height * 0.9 };
      break;
    case 'face':
      box = pad(0.08, 0.08, 0.08, 0.1);
      break;
    case 'eyes':
    case 'mouth':
    case 'cheek':
      box = pad(-0.1, 0.02, -0.1, 0.05); // inside the face: excludes the ears (their inner lines get redrawn)
      break;
    case 'expression':
      box = pad(0.35, 0.35, 0.35, 0.3);
      break;
    case 'accessory':
      box = pad(0.4, 0.5, 0.4, 0.35);
      break;
    case 'body':
      // Outfits with headwear (chef hat, police cap, onesie hood) also own the head area above the skull.
      box = { left: B.left - B.width * 0.18, top: headwear ? H.top - hh * 0.45 : H.bottom - hh * 0.25, right: B.right + B.width * 0.18, bottom: B.bottom + B.height * 0.05 };
      break;
    default:
      throw new Error(`unknown diff region: ${region}`);
  }
  return {
    left: Math.max(0, Math.round(box.left)),
    top: Math.max(0, Math.round(box.top)),
    right: Math.min(w - 1, Math.round(box.right)),
    bottom: Math.min(h - 1, Math.round(box.bottom)),
  };
}

/** Per-region tuning. Faint parts (blush, freckles) need a low threshold and tiny components. */
export const DIFF_DEFAULTS = {
  hair: { threshold: 38, soft: 14, radius: 2, open: 2, close: 4, minComponent: 400, maxChroma: 40 },
  body: { threshold: 36, soft: 14, radius: 2, open: 2, close: 3, minComponent: 400, maxChroma: 40 },
  face: { threshold: 22, soft: 10, radius: 2, close: 1, minComponent: 120, minRelY: 0.45 },
  eyes: { threshold: 30, soft: 12, radius: 2, close: 1, minComponent: 40, edgeBand: 5 },
  mouth: { threshold: 30, soft: 12, radius: 2, close: 1, minComponent: 30, edgeBand: 5 },
  cheek: { threshold: 14, soft: 6, radius: 2, close: 1, minComponent: 12, edgeBand: 5 },
  expression: { threshold: 28, soft: 12, radius: 2, close: 1, minComponent: 40, edgeBand: 4 },
  accessory: { threshold: 34, soft: 14, radius: 2, close: 2, minComponent: 80 },
};

/**
 * Pixel distance between two RGBA pixels: alpha difference + colour distance of the shared coverage.
 * Colour distance is measured in a luma/opponent space with chroma weighted ×2: neutral parts (grey hair,
 * grey outfits) over the chromatic mannequin (skin, pale-cyan underwear) differ mostly in chroma.
 */
function pixDist(a, i, b, j) {
  const aa = a[i + 3] / 255;
  const ba = b[j + 3] / 255;
  const dr = a[i] - b[j];
  const dg = a[i + 1] - b[j + 1];
  const db = a[i + 2] - b[j + 2];
  const dy = 0.299 * dr + 0.587 * dg + 0.114 * db;
  const c1 = dr - dg;
  const c2 = (dr + dg) / 2 - db;
  return Math.abs(aa - ba) * 255 + Math.min(aa, ba) * Math.sqrt(dy * dy + 2 * (c1 * c1 + c2 * c2));
}

/**
 * Global translation of `edited` relative to `base` (both keyed RGBA, same size): minimises silhouette
 * mismatch outside `exclude` (the region the edit is allowed to change). Coarse (step 2) then fine search.
 * @returns {{dx, dy, cost, baseCost}} — sample edited at (x + dx, y + dy) to align it with base.
 */
export function estimateShift(base, edited, w, h, exclude, { maxShift = 16, thr = 128 } = {}) {
  const bb = alphaBBox(base, w, h, thr);
  if (!bb) return { dx: 0, dy: 0, cost: 0, baseCost: 0 };
  // Sample the band around the base silhouette edge (where a shift shows), outside the excluded box.
  const pts = [];
  const band = maxShift + 2;
  const x0 = Math.max(band, bb.left - band);
  const x1 = Math.min(w - band - 1, bb.right + band);
  const y0 = Math.max(band, bb.top - band);
  const y1 = Math.min(h - band - 1, bb.bottom + band);
  const inA = (x, y) => base[(y * w + x) * 4 + 3] > thr;
  const fine = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (exclude && x >= exclude.left && x <= exclude.right && y >= exclude.top && y <= exclude.bottom) continue;
      const a = inA(x, y);
      if (a !== inA(x + 6, y) || a !== inA(x - 6, y) || a !== inA(x, y + 6) || a !== inA(x, y - 6)) {
        fine.push(y * w + x);
        if (!(x & 1) && !(y & 1)) pts.push(y * w + x); // coarse search samples every 2nd pixel
      }
    }
  }
  if (pts.length < 200) return { dx: 0, dy: 0, cost: 0, baseCost: 0, samples: pts.length };
  const cost = (dx, dy, list = pts) => {
    let c = 0;
    for (const p of list) {
      const x = (p % w) + dx;
      const y = ((p - (p % w)) / w) + dy;
      const ea = x >= 0 && y >= 0 && x < w && y < h ? edited[(y * w + x) * 4 + 3] > thr : false;
      if (ea !== base[p * 4 + 3] > thr) c++;
    }
    return c;
  };
  const baseCost = cost(0, 0);
  let best = { dx: 0, dy: 0, cost: baseCost };
  for (let dy = -maxShift; dy <= maxShift; dy += 2) {
    for (let dx = -maxShift; dx <= maxShift; dx += 2) {
      const c = cost(dx, dy);
      if (c < best.cost) best = { dx, dy, cost: c };
    }
  }
  const c0 = best;
  best = { ...c0, cost: cost(c0.dx, c0.dy, fine) };
  for (let dy = c0.dy - 2; dy <= c0.dy + 2; dy++) {
    for (let dx = c0.dx - 2; dx <= c0.dx + 2; dx++) {
      const c = cost(dx, dy, fine);
      if (c < best.cost) best = { dx, dy, cost: c };
    }
  }
  return { ...best, baseCost: cost(0, 0, fine), samples: fine.length };
}

/** Binary max (dilate) / min (erode) filter with a (2r+1)² square kernel, separable. */
function morph(mask, w, h, r, dilate) {
  if (r <= 0) return mask;
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  const want = dilate ? 1 : 0;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let v = dilate ? 0 : 1;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) {
        if (mask[row + k] === want) {
          v = want;
          break;
        }
      }
      tmp[row + x] = v;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
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

/** Holes of `mask` (0-components not touching the border) smaller than maxArea → 1. In place. */
function fillHoles(mask, w, h, maxArea) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const members = [];
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || mask[s]) continue;
    members.length = 0;
    let border = false;
    let sp = 0;
    stack[sp++] = s;
    seen[s] = 1;
    while (sp) {
      const p = stack[--sp];
      members.push(p);
      const x = p % w;
      const y = (p - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      if (x > 0 && !seen[p - 1] && !mask[p - 1]) (seen[p - 1] = 1), (stack[sp++] = p - 1);
      if (x < w - 1 && !seen[p + 1] && !mask[p + 1]) (seen[p + 1] = 1), (stack[sp++] = p + 1);
      if (y > 0 && !seen[p - w] && !mask[p - w]) (seen[p - w] = 1), (stack[sp++] = p - w);
      if (y < h - 1 && !seen[p + w] && !mask[p + w]) (seen[p + w] = 1), (stack[sp++] = p + w);
    }
    if (!border && members.length <= maxArea) for (const p of members) mask[p] = 1;
  }
  return mask;
}

/**
 * Raw-pixel core of diffExtract. `base`/`edited` are keyed RGBA arrays of the same w×h.
 * @returns {{data: Uint8Array, info: object}} RGBA of the edited colours with the diff alpha.
 */
export function diffExtractPixels(base, edited, w, h, opts = {}) {
  const region = opts.region ?? 'face';
  const d = { ...(DIFF_DEFAULTS[region] ?? DIFF_DEFAULTS.face), ...opts };
  const { threshold, soft, radius, close, open = 0, feather = 1, maxShift = 16, register = true, maxChroma, chromaSoft = 16, lineLuma = 90 } = d;
  const lineRadius = d.lineRadius ?? radius + 3;
  const minComponent = d.minComponent ?? 120;
  const fig = detectFigure(base, w, h);
  if (!fig) throw new Error('diffExtract: the base image has no figure');
  const box = opts.box ?? regionBox(fig, region, w, h, d);
  const shift = register ? estimateShift(base, edited, w, h, box, { maxShift }) : { dx: 0, dy: 0 };
  const { dx, dy } = shift;
  const bw = box.right - box.left + 1;
  const bh = box.bottom - box.top + 1;
  const ramp = new Float32Array(bw * bh);
  const veto = new Uint8Array(bw * bh); // never filled by closing / hole filling
  const lo = threshold - soft;
  const hi = threshold + soft;
  for (let y = box.top; y <= box.bottom; y++) {
    for (let x = box.left; x <= box.right; x++) {
      const sx = x + dx;
      const sy = y + dy;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      const ei = (sy * w + sx) * 4;
      if (edited[ei + 3] < 8) continue;
      let best = Infinity;
      let aMin = 255;
      let aMax = 0;
      // Line art jitters more than fills between edits: dark pixels search a wider neighbourhood.
      const er = edited[ei];
      const eg = edited[ei + 1];
      const eb = edited[ei + 2];
      const rad = 0.299 * er + 0.587 * eg + 0.114 * eb < lineLuma ? lineRadius : radius;
      for (let ny = Math.max(0, y - rad); ny <= Math.min(h - 1, y + rad) && best > lo; ny++) {
        for (let nx = Math.max(0, x - rad); nx <= Math.min(w - 1, x + rad); nx++) {
          const bi = (ny * w + nx) * 4;
          const dd = pixDist(edited, ei, base, bi);
          if (dd < best) best = dd;
          if (base[bi + 3] < aMin) aMin = base[bi + 3];
          if (base[bi + 3] > aMax) aMax = base[bi + 3];
        }
      }
      // Anti-aliased fringe of the edited silhouette right on the base silhouette edge = re-rendered outline.
      if (edited[ei + 3] < 217 && aMin < 128 && aMax >= 128) best = 0;
      let v = best <= lo ? 0 : best >= hi ? 1 : (best - lo) / (hi - lo);
      // Neutral-only parts (grey hair / outfits): chromatic pixels (skin, underwear) are base redraws.
      if (maxChroma !== undefined) {
        const c = Math.max(er, eg, eb) - Math.min(er, eg, eb);
        if (c > maxChroma) {
          v *= Math.max(0, 1 - (c - maxChroma) / chromaSoft);
          if (c > maxChroma + chromaSoft / 2) veto[(y - box.top) * bw + (x - box.left)] = 1;
        }
      }
      ramp[(y - box.top) * bw + (x - box.left)] = v;
    }
  }
  // Binary mask → closing (bridges lines the part shares with the base) → fill enclosed holes (eye whites).
  let mask = new Uint8Array(bw * bh);
  for (let p = 0; p < mask.length; p++) mask[p] = ramp[p] >= 0.5 ? 1 : 0;
  // Inner-face parts never live on the head outline: drop the re-drawn silhouette edge band.
  if (d.edgeBand > 0) {
    let sil = new Uint8Array(bw * bh);
    for (let y = box.top; y <= box.bottom; y++) for (let x = box.left; x <= box.right; x++) sil[(y - box.top) * bw + (x - box.left)] = base[(y * w + x) * 4 + 3] > 128 ? 1 : 0;
    const outer = morph(sil, bw, bh, d.edgeBand, true);
    const inner = morph(sil, bw, bh, d.edgeBand, false);
    for (let p = 0; p < mask.length; p++) if (outer[p] && !inner[p]) mask[p] = 0;
    sil = null;
  }
  // Face-shape overlays only change the lower face (cheeks/jaw).
  if (d.minRelY !== undefined) {
    const y0 = fig.head.top + fig.head.height * d.minRelY;
    for (let y = box.top; y < Math.min(box.bottom + 1, y0); y++) mask.fill(0, (y - box.top) * bw, (y - box.top + 1) * bw);
  }
  // Closing first (joins a part drawn right over base lines, e.g. hair over the ear outline), then opening
  // removes thin re-rendered outlines of the body that hair/outfit edits redraw next to the part.
  if (close > 0) mask = morph(morph(mask, bw, bh, close, true), bw, bh, close, false);
  if (open > 0) mask = morph(morph(mask, bw, bh, open, false), bw, bh, open, true);
  fillHoles(mask, bw, bh, d.maxHole ?? Math.round(bw * bh * 0.02));
  // Next to the part, anything the edit painted where the base is fully transparent is new content even when
  // it resembles a nearby base outline (hair right behind the face outline). Without this the back hair
  // leaves a thin see-through gap around the mannequin silhouette.
  const nearMask = morph(mask, bw, bh, d.hug ?? 6, true);
  for (let y = box.top; y <= box.bottom; y++) {
    for (let x = box.left; x <= box.right; x++) {
      const p = (y - box.top) * bw + (x - box.left);
      if (mask[p] || !nearMask[p]) continue;
      const sx = x + dx;
      const sy = y + dy;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      if (base[(y * w + x) * 4 + 3] < 40 && edited[(sy * w + sx) * 4 + 3] > 128) mask[p] = 1;
    }
  }
  for (let p = 0; p < mask.length; p++) if (veto[p]) mask[p] = 0;
  // Alpha = mask, softened by a small box feather on its inner edge (the edited image's own alpha keeps
  // the anti-aliasing against the backdrop). Nothing outside the mask: partial ramps there are re-drawn
  // base outlines (e.g. the body outline next to long hair) and would show as ghost lines.
  const hard = new Float32Array(bw * bh);
  for (let p = 0; p < hard.length; p++) hard[p] = mask[p];
  let alpha = hard;
  if (feather > 0) {
    const f = feather;
    alpha = new Float32Array(hard.length);
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        let s = 0;
        let n = 0;
        for (let yy = Math.max(0, y - f); yy <= Math.min(bh - 1, y + f); yy++) {
          for (let xx = Math.max(0, x - f); xx <= Math.min(bw - 1, x + f); xx++) {
            s += hard[yy * bw + xx];
            n++;
          }
        }
        const p = y * bw + x;
        alpha[p] = mask[p] ? (hard[p] + s / n) / 2 : Math.min(hard[p], s / n);
      }
    }
  }
  const out = new Uint8Array(w * h * 4);
  let opaque = 0;
  for (let y = box.top; y <= box.bottom; y++) {
    for (let x = box.left; x <= box.right; x++) {
      const a = Math.min(1, alpha[(y - box.top) * bw + (x - box.left)]);
      if (a <= 0.02) continue;
      const sx = x + dx;
      const sy = y + dy;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      const ei = (sy * w + sx) * 4;
      const oi = (y * w + x) * 4;
      out[oi] = edited[ei];
      out[oi + 1] = edited[ei + 1];
      out[oi + 2] = edited[ei + 2];
      out[oi + 3] = Math.round(a * edited[ei + 3]);
      if (out[oi + 3] > 128) opaque++;
    }
  }
  const removed = removeSmallComponents(out, w, h, minComponent);
  for (let i = 0; i < out.length; i += 4) if (!out[i + 3]) out[i] = out[i + 1] = out[i + 2] = 0;
  const bboxOut = alphaBBox(out, w, h, 128);
  const erase = d.erase ? eraseMask(base, edited, out, w, h, { region, box, fig, dx, dy }) : null;
  return {
    data: out,
    erase: erase?.data ?? null,
    info: {
      region,
      box,
      head: fig.head,
      figure: fig.bbox,
      shift: { dx, dy, cost: shift.cost, baseCost: shift.baseCost },
      opaque: opaque - removed,
      removed,
      bbox: bboxOut,
      ...(erase ? { erased: erase.count } : {}),
    },
  };
}

/** Pale-cyan underwear of the mannequin (hue 150..215°, chromatic — some build edits paint it quite pale —, light). */
export function underwearMask(data, w, h) {
  const m = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (data[i + 3] < 128) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const [hue, sat] = hueSat(r, g, b);
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    if (hue >= 150 && hue <= 215 && chroma > 14 && sat > 0.07 && 0.299 * r + 0.587 * g + 0.114 * b > 110) m[p] = 1;
  }
  return m;
}

/**
 * Pixels the edit REMOVED from the base (base opaque, edited transparent, not part of the layer):
 * ears hidden behind hair, underwear/legs sticking out beside narrow trousers. The composer cuts them out
 * of the mannequin (destination-out). Restricted to the ears (hair) / the underwear surroundings (outfits)
 * so drifting hands or arms are never erased. Returns RGBA (black, alpha = erase) or null when negligible.
 */
function eraseMask(base, edited, layer, w, h, { region, fig, dx, dy }) {
  let allow;
  const H = fig.head;
  if (region === 'hair') {
    allow = (x, y) => y >= H.top && y <= H.bottom && x >= H.left - 4 && x <= H.right + 4;
  } else if (region === 'body') {
    const under = morph(underwearMask(base, w, h), w, h, 5, true);
    allow = (x, y) => under[y * w + x] === 1;
  } else return null;
  let m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (base[p * 4 + 3] < 200 || layer[p * 4 + 3] > 0 || !allow(x, y)) continue;
      const sx = x + dx;
      const sy = y + dy;
      const ea = sx >= 0 && sy >= 0 && sx < w && sy < h ? edited[(sy * w + sx) * 4 + 3] : 0;
      if (ea <= 40) m[p] = 1;
    }
  }
  m = morph(morph(m, w, h, 2, false), w, h, 2, true); // drop 1–4 px slivers (registration jitter)
  // Grow into the anti-aliased rim of the erased shape (else a faint outline of the ear stays).
  const grown = morph(m, w, h, 3, true);
  for (let p = 0; p < w * h; p++) {
    if (m[p] || !grown[p] || !base[p * 4 + 3] || layer[p * 4 + 3] > 0) continue;
    const x = p % w;
    const y = (p - x) / w;
    const sx = x + dx;
    const sy = y + dy;
    const ea = sx >= 0 && sy >= 0 && sx < w && sy < h ? edited[(sy * w + sx) * 4 + 3] : 0;
    if (ea <= 60) m[p] = 2;
  }
  const data = new Uint8Array(w * h * 4);
  let count = 0;
  for (let p = 0; p < w * h; p++) {
    if (m[p] === 2 || (m[p] && base[p * 4 + 3] >= 200)) {
      data[p * 4 + 3] = 255;
      count++;
    }
  }
  if (count) count -= removeSmallComponents(data, w, h, 150);
  return count >= 200 ? { data, count } : null;
}

async function sameSizeRaw(buffer, w, h) {
  const m = await sharp(buffer).metadata();
  if (m.width === w && m.height === h) return toRaw(buffer);
  return toRaw(await sharp(buffer).resize(w, h, { fit: 'fill' }).png().toBuffer());
}

/**
 * Keep only what `edited` added to `base` inside a category region.
 * Both images are expected to be chroma-keyed already (pass `key: true` to key raw magenta renders);
 * the edited image is resized to the base canvas and re-registered (global shift) before diffing.
 * @param {{region?: string, box?: object, threshold?: number, soft?: number, radius?: number, close?: number,
 *          feather?: number, minComponent?: number, register?: boolean, key?: boolean}} opts
 * @returns {Promise<{buffer: Buffer, info: object}>}
 */
export async function diffExtractDetailed(baseBuf, editedBuf, opts = {}) {
  const b = opts.key ? await chromaKey(baseBuf) : baseBuf;
  const e = opts.key ? await chromaKey(editedBuf) : editedBuf;
  const base = await toRaw(b);
  const edited = await sameSizeRaw(e, base.w, base.h);
  const r = diffExtractPixels(base.data, edited.data, base.w, base.h, opts);
  return {
    buffer: await fromRaw(r.data, base.w, base.h).png().toBuffer(),
    erase: r.erase ? await fromRaw(r.erase, base.w, base.h).png().toBuffer() : null,
    info: r.info,
  };
}

/**
 * Split an outfit layer: pixels above the chin inside the (padded) head box are headwear (chef hat,
 * police cap, onesie hood) and go to a `hat` layer drawn above the front hair. Null when negligible.
 */
export async function splitHat(layerBuf, baseBuf, { minPixels = 1500 } = {}) {
  const layer = await toRaw(layerBuf);
  const base = await sameSizeRaw(baseBuf, layer.w, layer.h);
  const { w, h } = layer;
  const fig = detectFigure(base.data, w, h);
  if (!fig) return null;
  const H = fig.head;
  const cut = H.bottom - Math.round(H.height * 0.06);
  const left = H.left - Math.round(H.width * 0.25);
  const right = H.right + Math.round(H.width * 0.25);
  const hat = new Uint8Array(w * h * 4);
  const rest = new Uint8Array(layer.data);
  let n = 0;
  for (let y = 0; y < Math.min(cut, h); y++) {
    for (let x = Math.max(0, left); x <= Math.min(w - 1, right); x++) {
      const i = (y * w + x) * 4;
      if (!layer.data[i + 3]) continue;
      hat.set(layer.data.subarray(i, i + 4), i);
      rest.fill(0, i, i + 4);
      n++;
    }
  }
  if (n < minPixels) return null;
  return { hat: await fromRaw(hat, w, h).png().toBuffer(), rest: await fromRaw(rest, w, h).png().toBuffer(), pixels: n };
}

/**
 * Display version of a keyed mannequin: the pale-cyan underwear (kept in the `base` file because it makes
 * diffs easy) is recoloured to a dark neutral, so where an outfit leaves a gap it reads as an outline/shadow.
 */
export async function mannequinDisplay(buf, { color = '#4a4446' } = {}) {
  const { data, w, h } = await toRaw(buf);
  const m = underwearMask(data, w, h);
  let sum = 0;
  let n = 0;
  for (let p = 0; p < w * h; p++) {
    if (!m[p]) continue;
    const i = p * 4;
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    n++;
  }
  if (!n) return { buffer: await fromRaw(data, w, h).png().toBuffer(), recolored: 0 };
  const refL = sum / n;
  const t = hexToRgbLocal(color);
  const grown = morph(m, w, h, 1, true); // include the anti-aliased rim against the outline
  let recolored = 0;
  for (let p = 0; p < w * h; p++) {
    if (!grown[p]) continue;
    const i = p * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const [hue] = hueSat(r, g, b);
    if (!m[p] && !(hue >= 140 && hue <= 225)) continue;
    const k = Math.min(1.4, (0.299 * r + 0.587 * g + 0.114 * b) / refL);
    data[i] = Math.round(Math.min(255, t.r * k));
    data[i + 1] = Math.round(Math.min(255, t.g * k));
    data[i + 2] = Math.round(Math.min(255, t.b * k));
    recolored++;
  }
  // Light greyish rim pixels (cyan blended into skin) would read as pale lines once the skin is tinted.
  const rim = morph(m, w, h, 3, true);
  for (let p = 0; p < w * h; p++) {
    if (!rim[p] || m[p]) continue;
    const i = p * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const c = Math.max(r, g, b) - Math.min(r, g, b);
    if (data[i + 3] > 128 && c < 30 && 0.299 * r + 0.587 * g + 0.114 * b > 90) {
      data[i] = t.r;
      data[i + 1] = t.g;
      data[i + 2] = t.b;
      recolored++;
    }
  }
  return { buffer: await fromRaw(data, w, h).png().toBuffer(), recolored };
}

function hexToRgbLocal(hex) {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * Align a mannequin variant (build / body edit) to the reference mannequin by its head box: uniform scale
 * so the head widths match (only when they differ by > 1.5 %), then translate so the head tops and
 * centres coincide. Keeps every layer generated on either mannequin aligned.
 */
export async function alignToHead(buf, refBuf) {
  const a = await toRaw(buf);
  const r = await sameSizeRaw(refBuf, a.w, a.h);
  const fa = detectFigure(a.data, a.w, a.h);
  const fr = detectFigure(r.data, r.w, r.h);
  if (!fa || !fr) return { buffer: buf, info: { aligned: false } };
  let s = fr.head.width / fa.head.width;
  if (Math.abs(1 - s) <= 0.015) s = 1;
  const cxA = (fa.head.left + fa.head.right) / 2;
  const cxR = (fr.head.left + fr.head.right) / 2;
  const W = a.w;
  const H = a.h;
  let img = await fromRaw(a.data, W, H).png().toBuffer();
  let sw = W;
  let sh = H;
  if (s !== 1) {
    sw = Math.max(1, Math.round(W * s));
    sh = Math.max(1, Math.round(H * s));
    img = await sharp(img).resize(sw, sh, { fit: 'fill' }).png().toBuffer();
  }
  const left = Math.round(cxR - cxA * s);
  const top = Math.round(fr.head.top - fa.head.top * s);
  const out = await placeOnCanvas(img, sw, sh, left, top, W, H);
  return { buffer: out, info: { aligned: true, scale: Math.round(s * 1000) / 1000, dx: left, dy: top } };
}

/** diffExtract → PNG buffer (same canvas as the base). See diffExtractDetailed. */
export async function diffExtract(baseBuf, editedBuf, opts = {}) {
  return (await diffExtractDetailed(baseBuf, editedBuf, opts)).buffer;
}

/**
 * Split a hair layer into front/back: pixels over the (slightly grown) mannequin silhouette are drawn
 * in front of the body/outfit; the back layer is the whole hair (volume around the skull, long hair beside
 * the torso) drawn behind the mannequin. info.front/back count front pixels vs. back-only pixels.
 * @returns {Promise<{front: Buffer, back: Buffer, info: {front: number, back: number}}>}
 */
export async function splitFrontBack(layerBuf, baseBuf, { grow = 4, thr = 128, islandMax = 4000 } = {}) {
  const layer = await toRaw(layerBuf);
  const base = await sameSizeRaw(baseBuf, layer.w, layer.h);
  const { w, h } = layer;
  let sil = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) sil[p] = base.data[p * 4 + 3] > thr ? 1 : 0;
  sil = morph(sil, w, h, grow, true);
  const front = new Uint8Array(layer.data);
  const back = new Uint8Array(layer.data);
  let nf = 0;
  let nb = 0;
  for (let p = 0; p < w * h; p++) {
    if (!layer.data[p * 4 + 3]) continue;
    // The back layer keeps the WHOLE hair (drawn under the mannequin it only shows outside the body), so
    // there is no seam where front and back meet along the silhouette. Cleared pixels get RGB 0 too.
    if (sil[p]) {
      nf++;
    } else {
      front.fill(0, p * 4, p * 4 + 4);
      nb++;
    }
  }
  // Small front islands below the chin (hair tips resting on the shoulders, cut off from the rest of the front
  // hair by the neck) would float on top of a wide outfit as dark marks: send them to the back.
  const fig = detectFigure(base.data, w, h);
  let moved = 0;
  if (fig) {
    const seen = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    const members = [];
    for (let s = 0; s < w * h; s++) {
      if (seen[s] || !front[s * 4 + 3]) continue;
      members.length = 0;
      let sp = 0;
      let top = h;
      stack[sp++] = s;
      seen[s] = 1;
      while (sp) {
        const p = stack[--sp];
        members.push(p);
        const x = p % w;
        const y = (p - x) / w;
        if (y < top) top = y;
        for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
          if (q >= 0 && q < w * h && !seen[q] && front[q * 4 + 3]) {
            seen[q] = 1;
            stack[sp++] = q;
          }
        }
      }
      if (top > fig.head.bottom && members.length < islandMax) {
        for (const p of members) front.fill(0, p * 4, p * 4 + 4);
        moved += members.length;
      }
    }
  }
  return {
    front: await fromRaw(front, w, h).png().toBuffer(),
    back: await fromRaw(back, w, h).png().toBuffer(),
    info: { front: nf - moved, back: nb + moved, moved },
  };
}

/**
 * Tint a neutral layer (see server/assets/tintMath.js for the contract).
 * @param {Buffer} buf  PNG layer
 * @param {string} hex  target colour
 * @param {{mode?: 'full'|'selective', ref?: string}} opts  ref = the layer's meta.tintRef
 */
export async function tintLayer(buf, hex, { mode = 'full', ref } = {}) {
  const { data, w, h } = await toRaw(buf);
  const refHex = ref ?? measureFill(data) ?? '#808080';
  tintPixels(data, refHex, hex, { mode });
  return fromRaw(data, w, h).png().toBuffer();
}

/**
 * Stack layers bottom→top on one canvas (all layers share the mannequin canvas). `erase` masks are cut
 * out of their layer (destination-out) after tinting — the mannequin under hair/outfit erase masks.
 * @param {Array<{buffer: Buffer, tint?: {color: string, ref?: string, mode?: string} | null, erase?: Buffer[]}>} layers
 * @param {{width?: number, height?: number, background?: string}} [opts]
 */
export async function composeLayers(layers, { width = 1024, height = 1536, background } = {}) {
  const inputs = [];
  for (const l of layers) {
    let buf = l.buffer;
    const m = await sharp(buf).metadata();
    if (m.width !== width || m.height !== height) buf = await sharp(buf).resize(width, height, { fit: 'fill' }).png().toBuffer();
    if (l.tint?.color) buf = await tintLayer(buf, l.tint.color, { mode: l.tint.mode, ref: l.tint.ref });
    if (l.erase?.length) {
      const masks = await Promise.all(l.erase.map((e) => sharp(e).resize(width, height, { fit: 'fill' }).png().toBuffer()));
      buf = await sharp(buf).composite(masks.map((input) => ({ input, blend: 'dest-out' }))).png().toBuffer();
    }
    inputs.push({ input: buf });
  }
  const bg = background ? sharp({ create: { width, height, channels: 4, background } }) : sharp({ create: { width, height, channels: 4, background: CLEAR } });
  return bg.composite(inputs).png().toBuffer();
}
