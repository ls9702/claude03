// Paper-doll compositor (Stage 5.5-C): turns an avatar (avatars.json part ids) into a canvas from the accepted
// `part-*` layers, exactly like scripts/part-sheets.js does with sharp.
//
//   const cv = await composeAvatar(avatar, { expression: 'joy', blink: false, size: 220, crop: 'bust' });
//   // → HTMLCanvasElement (a fresh copy you may insert anywhere) | null (layers missing → keep the SVG)
//   peekAvatar(avatar, opts)   // synchronous copy when that exact result is cached, else null (no flicker)
//   preloadAvatar(avatar)      // warm image + tint caches (neutral + blink)
//
// Pipeline: partStack.layerStack() (order / tint / erase) → per layer: image (cached by URL, alpha bbox measured
// once) → "prepared" canvas when it needs a tint (shared tintMath.tintPixels) or an erase mask (destination-out),
// cached by src+tint+erase+level and cropped to the layer's bbox → drawn in Z_ORDER into the crop box, scaled.
// Composed results are kept in an LRU (COMPOSE_CACHE_MAX) keyed by `composeKey()`.
import { CROP, EXPRESSIONS, layerStack } from '../shared/partStack.js';
import { tintPixels } from '../shared/tintMath.js';
import { assetInfo, loadAssetIndex } from '../assets.js';
import { getAvatarDefs, normalizeAvatar, outfitTintable } from './avatar2d.js';

/** Crop boxes in 1024×1536 canvas units. full = union of every layer (partStack.CROP). */
export const COMPOSE_CROPS = {
  full: { ...CROP },
  bust: { x: 142, y: 150, w: 740, h: 740 },
  face: { x: 212, y: 196, w: 600, h: 600 },
};

/**
 * Where the figure sits inside the full crop (canvas y of the hairline … feet) — cut-ins scale the canvas so this
 * span fills the character slot (big hair / hats overflow upward, like the old generated layers did).
 */
export const FIGURE_SPAN = { top: 200, bottom: 1360 };

/** Working resolutions (fraction of canvas units) of prepared (tinted / erased) layers. */
export const LEVELS = [0.25, 0.5, 0.75, 1];
export const COMPOSE_CACHE_MAX = 40;
const PREP_CACHE_MAX = 90;

/** Customizer / cut-in expression id → part expression layer (null = neutral face). */
export function partExpression(id) {
  return id && EXPRESSIONS.includes(id) ? id : null;
}

/** Smallest working level whose resolution covers the requested output scale. */
export function levelFor(scale) {
  return LEVELS.find((l) => l >= scale - 1e-6) ?? 1;
}

function cropBox(crop) {
  if (crop && typeof crop === 'object') return crop;
  return COMPOSE_CROPS[crop] ?? COMPOSE_CROPS.full;
}

const devicePR = () => Math.min(2, Math.max(1, Number(globalThis.devicePixelRatio) || 1));

/**
 * Output geometry for a compose request (pure).
 * @returns {{box, scale, level, width, height}} width/height in device pixels; scale = device px per canvas unit
 */
export function composeGeometry({ size = 220, crop = 'full', dpr = devicePR() } = {}) {
  const box = cropBox(crop);
  const px = Math.max(8, Math.round(size * dpr));
  const scale = px / Math.max(box.w, box.h);
  return { box, scale, level: levelFor(scale), width: Math.max(1, Math.round(box.w * scale)), height: Math.max(1, Math.round(box.h * scale)) };
}

/**
 * Cache key of a composed result (pure, stable): normalized avatar in avatars.json `order` + expression + blink +
 * size + crop + dpr. Keys don't depend on property order or on parts equal to their defaults being omitted.
 */
export function composeKey(avatar, { expression = null, blink = false, size = 220, crop = 'full', dpr = devicePR() } = {}, defs = getAvatarDefs()) {
  const a = normalizeAvatar(avatar ?? {}, defs);
  const expr = partExpression(expression);
  const c = typeof crop === 'object' ? `${crop.x},${crop.y},${crop.w},${crop.h}` : COMPOSE_CROPS[crop] ? crop : 'full';
  return `${defs.order.map((k) => a[k]).join('.')}|${expr ?? '-'}|${expr ? 0 : blink ? 1 : 0}|${Math.round(size)}|${c}|${dpr}`;
}

/**
 * Layer stack for an avatar (pure): partStack.layerStack() with the avatar normalized against avatars.json and
 * fixed-colour outfits (`tintable: false`) forced untinted, whatever their manifest meta says.
 */
export function stackFor(avatar, { lookup, defs = getAvatarDefs(), expression = null, blink = false } = {}) {
  const a = normalizeAvatar(avatar ?? {}, defs);
  const stack = layerStack(a, { lookup, avatars: defs, expression: partExpression(expression), blink });
  if (!outfitTintable(a.outfit, defs)) for (const l of stack) if (l.slot === 'outfit' || l.slot === 'hat') l.tint = null;
  return stack;
}

/** Layers are usable only when at least the mannequin is accepted. */
export const stackUsable = (stack) => Array.isArray(stack) && stack.some((l) => l.slot === 'mannequin');

// ---------- browser side ----------

const hasDom = () => typeof document !== 'undefined';
const lookupAsset = (id) => assetInfo(id);

function makeCanvas(w, h) {
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w));
  cv.height = Math.max(1, Math.round(h));
  return cv;
}

function lruGet(map, key) {
  if (!map.has(key)) return undefined;
  const v = map.get(key);
  map.delete(key);
  map.set(key, v);
  return v;
}
function lruSet(map, key, value, max) {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) map.delete(map.keys().next().value);
}

// image cache: url → Promise<{img, w, h, k, bbox}|null>; bbox in canvas units (padded), measured once
const images = new Map();
function loadLayer(url) {
  if (!images.has(url)) {
    images.set(
      url,
      new Promise((resolve) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => {
          try {
            const w = img.naturalWidth;
            const h = img.naturalHeight;
            resolve({ img, w, h, k: w / 1024, bbox: alphaBox(img, w, h) });
          } catch {
            resolve(null);
          }
        };
        img.onerror = () => resolve(null);
        img.src = url;
      }),
    );
  }
  return images.get(url);
}

/** Opaque bbox of an image in canvas units, measured on a 1/8 thumbnail (+ 10 unit margin), clipped to CROP. */
function alphaBox(img, w, h) {
  const tw = 128;
  const th = 192;
  const cv = makeCanvas(tw, th);
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h, 0, 0, tw, th);
  const d = g.getImageData(0, 0, tw, th).data;
  let x0 = tw;
  let y0 = th;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      if (d[(y * tw + x) * 4 + 3] > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null; // fully transparent
  const u = 1024 / tw;
  const m = 10;
  const bx0 = Math.max(CROP.x, x0 * u - m);
  const by0 = Math.max(CROP.y, y0 * u - m);
  const bx1 = Math.min(CROP.x + CROP.w, (x1 + 1) * u + m);
  const by1 = Math.min(CROP.y + CROP.h, (y1 + 1) * u + m);
  if (bx1 <= bx0 || by1 <= by0) return null;
  return { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 };
}

// prepared (tinted / erased) layers: key → Promise<{canvas, bbox}|null>
const prepared = new Map();
function prepareLayer(layer, level) {
  const key = `${layer.src}|${layer.tint ? `${layer.tint.color}/${layer.tint.ref}/${layer.tint.mode}` : '-'}|${(layer.erase ?? []).join(',')}|${level}`;
  const hit = lruGet(prepared, key);
  if (hit) return hit;
  const p = (async () => {
    const im = await loadLayer(layer.src);
    if (!im?.bbox) return null;
    const b = im.bbox;
    const cv = makeCanvas(b.w * level, b.h * level);
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingQuality = 'high';
    g.drawImage(im.img, b.x * im.k, b.y * im.k, b.w * im.k, b.h * im.k, 0, 0, cv.width, cv.height);
    if (layer.tint?.color && layer.tint.ref) {
      const d = g.getImageData(0, 0, cv.width, cv.height);
      tintPixels(d.data, layer.tint.ref, layer.tint.color, { mode: layer.tint.mode });
      g.putImageData(d, 0, 0);
    }
    if (layer.erase?.length) {
      const masks = await Promise.all(layer.erase.map(loadLayer));
      g.globalCompositeOperation = 'destination-out';
      for (const mk of masks) if (mk) g.drawImage(mk.img, b.x * mk.k, b.y * mk.k, b.w * mk.k, b.h * mk.k, 0, 0, cv.width, cv.height);
      g.globalCompositeOperation = 'source-over';
    }
    return { canvas: cv, bbox: b };
  })().catch(() => null);
  lruSet(prepared, key, p, PREP_CACHE_MAX);
  return p;
}

// composed results: key → Promise<HTMLCanvasElement|null> (master copies; callers get copies)
const composed = new Map();
const settled = new Map(); // key → canvas (resolved masters, for the synchronous peek)
const stats = { composes: 0, drawMs: 0, hits: 0 };

function copyOf(src) {
  const cv = makeCanvas(src.width, src.height);
  cv.getContext('2d').drawImage(src, 0, 0);
  cv.className = 'av-cmp';
  cv.dataset.crop = src.dataset.crop ?? '';
  return cv;
}

async function composeMaster(avatar, opts, geo) {
  await loadAssetIndex();
  const stack = stackFor(avatar, { lookup: lookupAsset, expression: opts.expression, blink: opts.blink });
  if (!stackUsable(stack)) return null;
  const layers = await Promise.all(stack.map((l) => (l.tint || l.erase?.length ? prepareLayer(l, geo.level) : loadLayer(l.src).then((im) => (im?.bbox ? { im, bbox: im.bbox } : null)))));
  const t0 = performance.now();
  const out = makeCanvas(geo.width, geo.height);
  const g = out.getContext('2d');
  g.imageSmoothingQuality = 'high';
  const { box, scale } = geo;
  for (const l of layers) {
    if (!l) continue;
    const b = l.bbox;
    const dx = (b.x - box.x) * scale;
    const dy = (b.y - box.y) * scale;
    const dw = b.w * scale;
    const dh = b.h * scale;
    if (dx >= out.width || dy >= out.height || dx + dw <= 0 || dy + dh <= 0) continue;
    if (l.canvas) g.drawImage(l.canvas, 0, 0, l.canvas.width, l.canvas.height, dx, dy, dw, dh);
    else g.drawImage(l.im.img, b.x * l.im.k, b.y * l.im.k, b.w * l.im.k, b.h * l.im.k, dx, dy, dw, dh);
  }
  out.dataset.crop = typeof opts.crop === 'string' ? opts.crop : 'custom';
  stats.composes++;
  stats.drawMs = performance.now() - t0;
  return out;
}

/**
 * Compose an avatar from paper-doll layers.
 * @param {object} avatar  avatars.json part ids (missing → defaults)
 * @param {{expression?: string|null, blink?: boolean, size?: number, crop?: 'full'|'bust'|'face'|{x,y,w,h}, dpr?: number}} [opts]
 *   `size` = CSS px of the longer side (the canvas has size×dpr device pixels)
 * @returns {Promise<HTMLCanvasElement|null>} a fresh canvas (class `av-cmp`), or null when the layers are missing
 */
export async function composeAvatar(avatar, opts = {}) {
  if (!hasDom()) return null;
  const o = { expression: null, blink: false, size: 220, crop: 'full', dpr: devicePR(), ...opts };
  const key = composeKey(avatar, o);
  let p = lruGet(composed, key);
  if (p) stats.hits++;
  else {
    p = composeMaster(avatar, o, composeGeometry(o)).catch(() => null);
    lruSet(composed, key, p, COMPOSE_CACHE_MAX);
    p.then((cv) => {
      if (cv && composed.get(key) === p) settled.set(key, cv);
      else composed.delete(key); // don't cache failures (assets may arrive later)
    });
  }
  const master = await p;
  // keep the synchronous peek map in step with the LRU
  for (const k of settled.keys()) if (!composed.has(k)) settled.delete(k);
  return master ? copyOf(master) : null;
}

/** Synchronous copy of a cached composed result (null when not composed yet). */
export function peekAvatar(avatar, opts = {}) {
  if (!hasDom()) return null;
  const o = { expression: null, blink: false, size: 220, crop: 'full', dpr: devicePR(), ...opts };
  const key = composeKey(avatar, o);
  const cv = composed.has(key) ? settled.get(key) : null;
  return cv ? copyOf(cv) : null;
}

/** Warm the image / tint caches for an avatar (neutral + blink at the given size). Never rejects. */
export function preloadAvatar(avatar, { size = 480, crop = 'full', expressions = [] } = {}) {
  if (!hasDom()) return Promise.resolve();
  const jobs = [composeAvatar(avatar, { size, crop }), composeAvatar(avatar, { size, crop, blink: true })];
  for (const e of expressions) jobs.push(composeAvatar(avatar, { size, crop, expression: e }));
  return Promise.all(jobs).then(
    () => {},
    () => {},
  );
}

/**
 * Customizer preview renderer (customize.js `setPreviewRenderer`): the composed avatar in the round preview
 * (bust) or the whole figure (`crop: 'full'`, 「전신 보기」). null → the customizer keeps the SVG portrait.
 */
export function layeredPreviewRenderer(avatar, { expression = 'neutral', size = 220, crop = 'bust' } = {}) {
  return composeAvatar(avatar, { expression: partExpression(expression), size: Math.max(size, 260), crop: crop === 'full' ? 'full' : 'bust' }).then((cv) => {
    if (!cv) return null;
    cv.classList.add('cz-cmp');
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', '미리보기');
    return cv;
  });
}

// ---------- AI art (Stage 5.5-D files: 1024×1536, same canvas as the old generated poses) ----------

/** Crops of AI art images (canvas units; the figure spans y 371..1303 like the schoolgirl poses). */
export const AI_CROPS = {
  full: { x: 160, y: 300, w: 704, h: 1056 },
  bust: { x: 195, y: 350, w: 560, h: 560 },
  face: { x: 225, y: 360, w: 500, h: 500 },
};

const artCache = new Map(); // `${url}|${crop}|${size}|${dpr}` → Promise<canvas|null>
const artSettled = new Map();
const artKey = (url, { size = 96, crop = 'bust', dpr = devicePR() } = {}) => `${url}|${crop}|${Math.round(size)}|${dpr}`;

/** An AI art image cropped (AI_CROPS) and scaled to `size` CSS px (longer side) → fresh canvas | null. */
export async function composeArt(url, opts = {}) {
  if (!hasDom() || !url) return null;
  const o = { size: 96, crop: 'bust', dpr: devicePR(), ...opts };
  const key = artKey(url, o);
  let p = lruGet(artCache, key);
  if (!p) {
    p = loadLayer(url).then((im) => {
      if (!im) return null;
      const box = AI_CROPS[o.crop] ?? AI_CROPS.bust;
      const s = (o.size * o.dpr) / Math.max(box.w, box.h);
      const cv = makeCanvas(box.w * s, box.h * s);
      const g = cv.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(im.img, box.x * im.k, box.y * im.k, box.w * im.k, box.h * im.k, 0, 0, cv.width, cv.height);
      cv.dataset.crop = `ai-${o.crop}`;
      return cv;
    });
    lruSet(artCache, key, p, COMPOSE_CACHE_MAX);
    p.then((cv) => {
      if (cv && artCache.get(key) === p) artSettled.set(key, cv);
      else artCache.delete(key);
      for (const k of artSettled.keys()) if (!artCache.has(k)) artSettled.delete(k);
    });
  }
  const cv = await p;
  return cv ? copyOf(cv) : null;
}

/** Synchronous copy of a cached composeArt() result, else null. */
export function peekArt(url, opts = {}) {
  if (!hasDom() || !url) return null;
  const key = artKey(url, { size: 96, crop: 'bust', dpr: devicePR(), ...opts });
  const cv = artCache.has(key) ? artSettled.get(key) : null;
  return cv ? copyOf(cv) : null;
}

/** Debug / E2E: cache sizes and the last compose's final draw time (ms, excluding image loading and tinting). */
export function composeStats() {
  return { ...stats, composed: composed.size, prepared: prepared.size, images: images.size };
}

/** Test hook: drop every cache. */
export function clearComposeCache() {
  composed.clear();
  settled.clear();
  artCache.clear();
  artSettled.clear();
  prepared.clear();
  images.clear();
}
