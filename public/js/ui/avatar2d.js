// 2D avatar portrait composed as an SVG string from avatars.json part ids (HUD lists, lobby, fallback),
// plus Stage 5 `renderAvatarLayers` (full-body generated PNG layers for cut-ins, SVG fallback).
// Keep the public API `renderAvatar(parts, { size })` and part ids stable.
import { findAsset } from '../assets.js';
import { avatarPalette, expressionFor, hueFilterFor, layerPlan, recolorPixels } from './cutinMap.js';

const FALLBACK_DEFS = {
  order: ['body', 'skin', 'hair', 'hairColor', 'eyes', 'accessory', 'outfit', 'outfitColor'],
  parts: {
    body: [{ id: 'boy' }, { id: 'girl' }],
    skin: [
      { id: 'fair', color: '#fde3cf' },
      { id: 'light', color: '#f6cfae' },
      { id: 'tan', color: '#dca77e' },
      { id: 'deep', color: '#a86f4c' },
    ],
    hair: ['short', 'bob', 'long', 'ponytail', 'twintail', 'spiky', 'curly', 'bun'].map((id) => ({ id })),
    hairColor: [
      { id: 'black', color: '#2b2222' },
      { id: 'brown', color: '#6b4226' },
      { id: 'blonde', color: '#e8c15a' },
      { id: 'red', color: '#a8452f' },
      { id: 'pink', color: '#f28bb3' },
      { id: 'blue', color: '#4d7fd6' },
    ],
    eyes: ['round', 'smile', 'sparkle', 'sleepy'].map((id) => ({ id })),
    accessory: ['none', 'glasses', 'sunglasses', 'cap', 'ribbon', 'headband'].map((id) => ({ id })),
    outfit: ['tshirt', 'hoodie', 'shirt', 'dress', 'overalls', 'hanbok'].map((id) => ({ id })),
    outfitColor: [
      { id: 'red', color: '#e25b5b' },
      { id: 'orange', color: '#f39a3d' },
      { id: 'yellow', color: '#f2cf4a' },
      { id: 'green', color: '#5cb87a' },
      { id: 'blue', color: '#4f8ee0' },
      { id: 'purple', color: '#9a6ad6' },
    ],
  },
  default: {
    body: 'boy', skin: 'light', hair: 'short', hairColor: 'black',
    eyes: 'round', accessory: 'none', outfit: 'tshirt', outfitColor: 'blue',
  },
};

let DEFS = FALLBACK_DEFS;

/** Install avatars.json (from /api/meta). */
export function setAvatarDefs(defs) {
  if (defs && defs.parts && defs.order) DEFS = defs;
}

export function getAvatarDefs() {
  return DEFS;
}

/** Fill unknown/missing parts with defaults. */
export function normalizeAvatar(parts = {}, defs = DEFS) {
  const out = {};
  for (const key of defs.order) {
    const v = parts?.[key];
    out[key] = defs.parts[key].some((o) => o.id === v) ? v : defs.default[key];
  }
  return out;
}

export function randomAvatar(defs = DEFS, rnd = Math.random) {
  const out = {};
  for (const key of defs.order) {
    const opts = defs.parts[key];
    out[key] = opts[Math.floor(rnd() * opts.length)].id;
  }
  return out;
}

function colorOf(key, id, defs) {
  const opt = defs.parts[key]?.find((o) => o.id === id) ?? defs.parts[key]?.[0];
  return opt?.color ?? '#999';
}

/** Lighten (amt>0) or darken (amt<0) a #rrggbb color. */
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt),
  );
  return `#${ch.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

// ---------- layers ----------

function hairBack(style, c) {
  const d = shade(c, -0.2);
  switch (style) {
    case 'long':
      return `<path d="M24 40 Q20 82 30 92 L70 92 Q80 82 76 40 Z" fill="${d}"/>`;
    case 'bob':
      return `<path d="M24 42 Q22 64 31 67 L69 67 Q78 64 76 42 Z" fill="${d}"/>`;
    case 'ponytail':
      return `<path d="M66 26 Q90 30 84 66 Q80 54 70 46 Z" fill="${d}"/><circle cx="70" cy="30" r="3.5" fill="#f06292"/>`;
    case 'twintail':
      return (
        `<path d="M30 30 Q8 40 16 76 Q22 60 32 46 Z" fill="${d}"/>` +
        `<path d="M70 30 Q92 40 84 76 Q78 60 68 46 Z" fill="${d}"/>` +
        `<circle cx="29" cy="32" r="3.2" fill="#f06292"/><circle cx="71" cy="32" r="3.2" fill="#f06292"/>`
      );
    case 'bun':
      return `<circle cx="50" cy="15" r="9" fill="${d}"/>`;
    case 'curly':
      return [
        [27, 40], [26, 52], [73, 40], [74, 52], [30, 60], [70, 60],
      ].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7" fill="${d}"/>`).join('');
    default:
      return '';
  }
}

function hairFront(style, c) {
  const hi = `<path d="M36 22 Q44 18 52 19" stroke="#fff" stroke-opacity=".35" stroke-width="2" fill="none" stroke-linecap="round"/>`;
  let body;
  switch (style) {
    case 'spiky':
      body = `<path d="M25 44 L21 27 L31 25 L29 12 L41 18 L46 5 L54 16 L63 7 L64 20 L76 17 L72 28 L79 36 L75 44 Q71 31 61 30 L56 35 L50 29 L44 35 L39 30 Q29 31 25 44 Z" fill="${c}"/>`;
      break;
    case 'bob':
      body = `<path d="M24 48 Q22 15 50 14 Q78 15 76 48 L72 48 Q72 35 67 32 L33 32 Q28 35 28 48 Z" fill="${c}"/>`;
      break;
    case 'long':
      body = `<path d="M24 52 Q21 14 50 14 Q79 14 76 52 L71 52 Q70 32 56 26 Q52 31 50 24 Q48 31 44 26 Q30 32 29 52 Z" fill="${c}"/>`;
      break;
    case 'ponytail':
      body = `<path d="M26 43 Q24 15 50 14 Q76 15 74 43 Q72 30 64 28 Q52 37 35 30 Q29 33 26 43 Z" fill="${c}"/>`;
      break;
    case 'twintail':
      body = `<path d="M25 46 Q23 15 50 14 Q77 15 75 46 L72 46 Q71 34 64 31 Q57 34 51 29 L49 29 Q43 34 36 31 Q29 34 28 46 Z" fill="${c}"/>`;
      break;
    case 'curly':
      body =
        `<path d="M26 44 Q24 17 50 16 Q76 17 74 44 Q70 31 50 30 Q30 31 26 44 Z" fill="${c}"/>` +
        [[30, 28], [38, 20], [50, 17], [62, 20], [70, 28], [44, 29], [56, 29], [27, 37], [73, 37]]
          .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7" fill="${c}"/>`).join('');
      break;
    case 'bun':
      body = `<path d="M26 41 Q25 17 50 16 Q75 17 74 41 Q68 28 50 27 Q32 28 26 41 Z" fill="${c}"/>`;
      break;
    case 'short':
    default:
      body = `<path d="M26 42 Q25 16 50 15 Q75 16 74 42 L71 36 Q68 30 60 29 L56 34 L52 29 L46 34 L42 29 Q32 30 29 36 Z" fill="${c}"/>`;
  }
  return body + hi;
}

function outfit(style, c, body, skin) {
  const dark = shade(c, -0.25);
  const girl = body === 'girl';
  const torso = girl
    ? 'M30 100 Q31 74 41 68 L59 68 Q69 74 70 100 Z'
    : 'M26 100 Q28 72 40 67 L60 67 Q72 72 74 100 Z';
  const neck = `<rect x="45.5" y="60" width="9" height="10" rx="3" fill="${shade(skin, -0.08)}"/>`;
  switch (style) {
    case 'hoodie':
      return (
        neck +
        `<path d="${torso}" fill="${c}"/>` +
        `<path d="M38 68 Q50 80 62 68 Q58 74 50 75 Q42 74 38 68 Z" fill="${dark}"/>` +
        `<path d="M46 76 L45 86 M54 76 L55 86" stroke="#fff" stroke-width="1.2" stroke-linecap="round"/>` +
        `<rect x="40" y="88" width="20" height="10" rx="3" fill="${dark}" opacity=".6"/>`
      );
    case 'shirt':
      return (
        neck +
        `<path d="${torso}" fill="${c}"/>` +
        `<path d="M42 67 L50 76 L46 80 L40 70 Z M58 67 L50 76 L54 80 L60 70 Z" fill="#fff"/>` +
        `<circle cx="50" cy="84" r="1.2" fill="${dark}"/><circle cx="50" cy="91" r="1.2" fill="${dark}"/><circle cx="50" cy="98" r="1.2" fill="${dark}"/>`
      );
    case 'dress':
      return (
        neck +
        `<path d="M32 100 L37 82 Q35 72 42 67 L58 67 Q65 72 63 82 L68 100 Z" fill="${c}"/>` +
        `<path d="M37 82 Q50 86 63 82" stroke="${dark}" stroke-width="2" fill="none"/>` +
        `<path d="M43 67 Q50 73 57 67 L55 71 Q50 75 45 71 Z" fill="#fff"/>`
      );
    case 'overalls':
      return (
        neck +
        `<path d="${torso}" fill="#f4f1ea"/>` +
        `<path d="M38 80 L62 80 L${girl ? 68 : 71} 100 L${girl ? 32 : 29} 100 Z" fill="${c}"/>` +
        `<path d="M40 68 L40 80 M60 68 L60 80" stroke="${c}" stroke-width="3.5"/>` +
        `<circle cx="40" cy="80" r="1.6" fill="#f2cf4a"/><circle cx="60" cy="80" r="1.6" fill="#f2cf4a"/>` +
        `<rect x="44" y="84" width="12" height="8" rx="1.5" fill="${dark}" opacity=".5"/>`
      );
    case 'hanbok':
      return (
        neck +
        `<path d="${torso}" fill="${c}"/>` +
        `<path d="M41 67 L56 88" stroke="#fff" stroke-width="4" stroke-linecap="round"/>` +
        `<path d="M59 67 L50 78" stroke="#fff" stroke-width="3" stroke-linecap="round"/>` +
        `<path d="M56 86 Q62 83 64 88 Q60 90 56 88 Z M56 88 L60 98 M56 88 L55 99" stroke="#e25b5b" stroke-width="2" fill="#e25b5b" stroke-linecap="round"/>`
      );
    case 'tshirt':
    default:
      return (
        neck +
        `<path d="${torso}" fill="${c}"/>` +
        `<path d="M43 67 Q50 74 57 67" stroke="${dark}" stroke-width="1.8" fill="none"/>` +
        `<path d="M44 86 L56 86" stroke="#fff" stroke-opacity=".5" stroke-width="3" stroke-linecap="round"/>`
      );
  }
}

function eyes(style, body) {
  const ink = '#2b2222';
  const lashes =
    body === 'girl'
      ? `<path d="M36.5 44 L34.5 42.5 M63.5 44 L65.5 42.5" stroke="${ink}" stroke-width="1.3" stroke-linecap="round"/>`
      : '';
  switch (style) {
    case 'smile':
      return `<path d="M37.5 47.5 Q41 43.5 44.5 47.5 M55.5 47.5 Q59 43.5 62.5 47.5" stroke="${ink}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
    case 'sparkle':
      return (
        [41, 59]
          .map(
            (x) =>
              `<ellipse cx="${x}" cy="46" rx="3.6" ry="4.6" fill="${ink}"/>` +
              `<ellipse cx="${x}" cy="47.5" rx="2.4" ry="2.6" fill="#6b8fe0"/>` +
              `<circle cx="${x - 1.2}" cy="44.2" r="1.4" fill="#fff"/><circle cx="${x + 1.3}" cy="48.3" r=".7" fill="#fff"/>`,
          )
          .join('') + lashes
      );
    case 'sleepy':
      return `<path d="M37.5 46 Q41 49 44.5 46 M55.5 46 Q59 49 62.5 46" stroke="${ink}" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M37 44.5 L44.5 44.5 M55.5 44.5 L63 44.5" stroke="${ink}" stroke-width="1" opacity=".5"/>`;
    case 'round':
    default:
      return (
        [41, 59]
          .map((x) => `<ellipse cx="${x}" cy="46" rx="3" ry="3.8" fill="${ink}"/><circle cx="${x - 1}" cy="44.6" r="1.2" fill="#fff"/>`)
          .join('') + lashes
      );
  }
}

function accessory(style, outfitColor) {
  switch (style) {
    case 'glasses':
      return `<g fill="#fff" fill-opacity=".18" stroke="#3a3a4a" stroke-width="1.5"><circle cx="41" cy="46" r="5.5"/><circle cx="59" cy="46" r="5.5"/></g><path d="M46.5 46 Q50 44 53.5 46" stroke="#3a3a4a" stroke-width="1.5" fill="none"/>`;
    case 'sunglasses':
      return `<g fill="#1f2230" stroke="#1f2230" stroke-width="1"><rect x="34.5" y="42" width="13" height="8" rx="3"/><rect x="52.5" y="42" width="13" height="8" rx="3"/></g><path d="M47.5 45 L52.5 45" stroke="#1f2230" stroke-width="1.6"/><path d="M36.5 44 L40 44" stroke="#fff" stroke-opacity=".5" stroke-width="1.2"/>`;
    case 'cap': {
      const cc = shade(outfitColor, -0.1);
      return `<path d="M25 33 Q25 11 50 11 Q75 11 75 33 Z" fill="${cc}"/><path d="M48 31 Q76 27 88 34 Q72 38 48 35 Z" fill="${shade(cc, -0.25)}"/><circle cx="50" cy="12" r="2" fill="${shade(cc, -0.25)}"/>`;
    }
    case 'ribbon':
      return `<g transform="translate(66 21) rotate(18)"><path d="M0 0 L-10 -6 L-10 6 Z M0 0 L10 -6 L10 6 Z" fill="#f06292"/><circle r="2.6" fill="#d94680"/></g>`;
    case 'headband':
      return `<path d="M26 36 Q50 10 74 36" stroke="#ffb74d" stroke-width="4" fill="none" stroke-linecap="round"/>`;
    default:
      return '';
  }
}

/**
 * Compose a chibi portrait.
 * @param {object} parts avatar part ids (see avatars.json)
 * @param {{size?: number, bg?: string|null, title?: string}} opts
 * @returns {string} SVG markup
 */
export function renderAvatar(parts, { size = 96, bg = null, title = '' } = {}) {
  const defs = DEFS;
  const a = normalizeAvatar(parts, defs);
  const skin = colorOf('skin', a.skin, defs);
  const hair = colorOf('hairColor', a.hairColor, defs);
  const cloth = colorOf('outfitColor', a.outfitColor, defs);
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-label="${esc(title || '캐릭터')}">`,
    bg ? `<circle cx="50" cy="50" r="50" fill="${bg}"/>` : '',
    hairBack(a.hair, hair),
    outfit(a.outfit, cloth, a.body, skin),
    `<circle cx="26" cy="47" r="4.5" fill="${skin}"/><circle cx="74" cy="47" r="4.5" fill="${skin}"/>`,
    `<ellipse cx="50" cy="42" rx="24" ry="23" fill="${skin}"/>`,
    `<ellipse cx="35" cy="53" rx="4" ry="2.4" fill="#ff8a9a" opacity=".45"/><ellipse cx="65" cy="53" rx="4" ry="2.4" fill="#ff8a9a" opacity=".45"/>`,
    eyes(a.eyes, a.body),
    `<path d="M46.5 55 Q50 58 53.5 55" stroke="#a0522d" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,
    hairFront(a.hair, hair),
    accessory(a.accessory, cloth),
    '</svg>',
  ].join('');
}

// ---------- Stage 5: generated full-body layers ----------

const EXPRESSIONS = ['joy', 'cry', 'shock', 'angry'];
const OUTFITS = ['doctor', 'suit', 'wedding', 'school'];
const POSE_IDS = ['idle', 'wave', 'jump', 'cheer', 'cry', 'shock'];
// Generated layers share a 1024×1536 canvas; the figure spans y 371..1303 → the element box is the figure and the
// image overflows it. Recolored layers are cropped to LAYER_CROP (union bbox of every accepted layer + margin, 2:3):
// height 113.3 %, bottom −5.7 % (CSS .av2-layer); raw full-canvas fallbacks use 164.8 % / −25 % (.av2-layer.full).
// Sprite frames: figure 218/384 px, feet at 312.
const LAYER_CROP = { x: 160, y: 300, w: 704, h: 1056 }; // in 1024×1536 canvas units
const SPRITE_FIT = { height: '176.1%', bottom: '-33%' };
const CACHE_MAX = 28; // recolored canvases kept (≈1.2 MB each at 440 px)

/**
 * Character base for an avatar. Only `schoolgirl` exists so far → every avatar maps to it (recolored);
 * later bases are picked by matching meta (body/hair) when accepted.
 */
export function characterBaseFor(parts = {}) {
  const a = normalizeAvatar(parts);
  const exact = findAsset({ kind: 'charLayer', layer: 'base', body: a.body, hair: a.hair });
  const any = exact ?? findAsset({ kind: 'charLayer', layer: 'base', body: a.body }) ?? findAsset({ kind: 'charLayer', layer: 'base' });
  return any?.meta?.character ?? null;
}

/** URLs of accepted layers for a character base. */
export function layerSet(character) {
  if (!character) return null;
  const url = (q) => findAsset(q)?.url ?? null;
  const set = { base: url({ kind: 'charLayer', character, layer: 'base' }), expressions: {}, outfits: {}, poses: {}, sprite: null };
  for (const e of EXPRESSIONS) set.expressions[e] = url({ kind: 'charLayer', character, layer: 'expression', expression: e });
  for (const o of OUTFITS) set.outfits[o] = url({ kind: 'charLayer', character, layer: 'outfit', outfit: o });
  for (const p of POSE_IDS) set.poses[p] = url({ kind: 'pose', character, pose: p });
  const sprite = findAsset({ kind: 'sprite', character, action: 'jump' });
  set.sheet = sprite?.url && sprite.sheet ? { url: sprite.url, json: sprite.sheet, anim: sprite.anim ?? null } : null;
  return set.base || set.poses.idle ? set : null;
}

const sheetCache = new Map();
function loadSheet(url) {
  if (!sheetCache.has(url)) {
    sheetCache.set(
      url,
      fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    );
  }
  return sheetCache.get(url);
}

const recolorCache = new Map(); // `${url}|${palette.key}|${width}` → Promise<HTMLCanvasElement|null> (LRU order)

/**
 * Recolor a layer for an avatar palette on a canvas (cached). Resolves to the recolored source canvas, or
 * null when the image can't be read (then callers show the raw image with a CSS hue filter). Canvases are
 * copied with drawImage — no PNG encode, which is slow on low-end / software-rendered devices.
 */
export function recoloredCanvas(url, palette, { width = 440, crop = LAYER_CROP } = {}) {
  if (!url || typeof document === 'undefined') return Promise.resolve(null);
  const key = `${url}|${palette.key}|${width}|${crop ? 'c' : 'f'}`;
  if (recolorCache.has(key)) {
    const hit = recolorCache.get(key);
    recolorCache.delete(key); // LRU: move to the end
    recolorCache.set(key, hit);
    return hit;
  }
  while (recolorCache.size >= CACHE_MAX) recolorCache.delete(recolorCache.keys().next().value);
  recolorCache.set(
    key,
    new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        try {
          const k = img.naturalWidth / 1024; // crop is in 1024-wide canvas units
          const src = crop ? { x: crop.x * k, y: crop.y * k, w: crop.w * k, h: crop.h * k } : { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
          const w = Math.min(width, Math.round(src.w));
          const h = Math.round((src.h * w) / src.w);
          const cv = document.createElement('canvas');
          cv.width = w;
          cv.height = h;
          const g = cv.getContext('2d', { willReadFrequently: true });
          g.drawImage(img, src.x, src.y, src.w, src.h, 0, 0, w, h);
          const d = g.getImageData(0, 0, w, h);
          recolorPixels(d.data, palette);
          g.putImageData(d, 0, 0);
          resolve(cv);
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    }),
  );
  return recolorCache.get(key);
}

function copyCanvas(src, className) {
  const cv = document.createElement('canvas');
  cv.width = src.width;
  cv.height = src.height;
  cv.className = className;
  cv.getContext('2d').drawImage(src, 0, 0);
  return cv;
}

/** Warm the recolor cache for an avatar (e.g. at game start) — cheap no-op without assets. */
export function preloadAvatarLayers(parts, poses = ['idle']) {
  const set = layerSet(characterBaseFor(parts));
  if (!set) return Promise.resolve();
  const pal = avatarPalette(normalizeAvatar(parts), DEFS);
  return poses.reduce((p, pose) => p.then(() => recoloredCanvas(set.poses[pose] ?? set.base, pal)), Promise.resolve()).then(() => {});
}

function overlayHtml(kind) {
  switch (kind) {
    case 'heart':
      return '<span class="av2-p heart h1">💗</span><span class="av2-p heart h2">💕</span><span class="av2-p heart h3">💗</span>';
    case 'sweat':
      return '<span class="av2-p sweat">💦</span>';
    case 'tears':
      return '<span class="av2-p tear t1"></span><span class="av2-p tear t2"></span><span class="av2-p tear t3"></span><span class="av2-p tear t4"></span>';
    default:
      return '';
  }
}

/**
 * Full-body character for cut-ins: generated PNG layers (recolored per avatar) with procedural keypose
 * animation, or the SVG portrait when no layers are accepted.
 * @param {object} parts avatar part ids
 * @param {{expression?, emotion?, outfit?, pose?, name?, flip?: boolean}} opts
 * @returns {HTMLElement} `.av2` element with `.setState({pose, emotion, outfit})`, `.playSprite()` → Promise,
 *   `.ready` (Promise, first image shown) and `.layered` (false = SVG fallback)
 */
export function renderAvatarLayers(parts, { expression = null, emotion = null, outfit = null, pose = 'idle', name = '', flip = false } = {}) {
  const a = normalizeAvatar(parts);
  const set = layerSet(characterBaseFor(a));
  const el = document.createElement('div');
  el.className = 'av2 enter';
  el.dataset.pose = pose;
  if (flip) el.classList.add('flip');
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', name || '캐릭터');
  el.innerHTML = '<div class="av2-body"><div class="av2-stack"></div></div><div class="av2-fx" aria-hidden="true"></div>';
  const body = el.querySelector('.av2-body');
  const stack = el.querySelector('.av2-stack');
  const fx = el.querySelector('.av2-fx');
  el.layered = !!set;
  const pal = avatarPalette(a, DEFS);
  let token = 0;
  const emo = () => emotion ?? (expression && EXPRESSIONS.includes(expression) ? expression : null);

  function setOverlay(kind) {
    fx.dataset.kind = kind ?? '';
    fx.innerHTML = overlayHtml(kind);
  }

  if (!set) {
    el.classList.add('svg');
    stack.innerHTML = renderAvatar(a, { size: 200, title: name });
    setOverlay(expressionFor(emo()).overlay);
    el.ready = Promise.resolve();
    el.setState = (next = {}) => {
      if (next.emotion !== undefined) emotion = next.emotion;
      if (next.pose) el.dataset.pose = next.pose;
      setOverlay(expressionFor(emo()).overlay);
    };
    el.playSprite = () => Promise.resolve(false);
    return el;
  }

  function show(want) {
    const plan = layerPlan(set, want);
    const my = ++token;
    el.dataset.pose = plan.pose;
    setOverlay(plan.overlay);
    if (!plan.url) return Promise.resolve();
    return recoloredCanvas(plan.url, pal).then(async (src) => {
      const prev = [...stack.querySelectorAll('.av2-layer')];
      // a newer state was requested meanwhile: drop this one unless nothing is on screen yet
      if (my !== token && prev.length) return;
      if (prev.length && prev.at(-1).dataset.src === plan.url) return;
      let layer;
      if (src) layer = copyCanvas(src, 'av2-layer');
      else {
        layer = new Image();
        layer.className = 'av2-layer full';
        layer.alt = '';
        layer.style.filter = hueFilterFor(a, DEFS); // recolor unavailable → CSS hue fallback
        layer.src = plan.url;
        await (layer.decode?.() ?? Promise.resolve()).catch(() => {});
      }
      layer.dataset.src = plan.url;
      stack.appendChild(layer);
      requestAnimationFrame(() => layer.classList.add('on')); // 150 ms cross-fade (CSS)
      setTimeout(() => {
        for (const p of prev) p.remove();
      }, 220);
    });
  }

  el.ready = show({ pose, emotion: emo(), outfit });
  el.setState = (next = {}) => {
    if (next.emotion !== undefined) emotion = next.emotion;
    if (next.outfit !== undefined) outfit = next.outfit;
    if (next.pose) pose = next.pose;
    return show({ pose, emotion: emo(), outfit });
  };
  /** Play the jump sprite (recolored sheet frames with the sheet's delays), then return to the pose. */
  el.playSprite = async (loops = 2) => {
    const sheet = set.sheet ? await loadSheet(set.sheet.json) : null;
    if (!sheet?.frames?.length) return false;
    const src = await recoloredCanvas(set.sheet.url, pal, { width: sheet.frameWidth * sheet.cols, crop: null });
    if (!src) return false;
    const k = src.width / (sheet.frameWidth * sheet.cols);
    const sp = document.createElement('canvas');
    sp.className = 'av2-sprite';
    sp.width = Math.round(sheet.frameWidth * k);
    sp.height = Math.round(sheet.frameHeight * k);
    sp.style.height = SPRITE_FIT.height;
    sp.style.bottom = SPRITE_FIT.bottom;
    const g = sp.getContext('2d');
    body.appendChild(sp);
    el.classList.add('sprite-on');
    const n = sheet.frames.length;
    for (let step = 0; step < n * loops; step++) {
      const i = step % n;
      const f = sheet.frames[i];
      g.clearRect(0, 0, sp.width, sp.height);
      g.drawImage(src, f.x * k, f.y * k, f.w * k, f.h * k, 0, 0, sp.width, sp.height);
      sp.dataset.frame = sheet.frameIds?.[i] ?? String(i);
      await new Promise((r) => setTimeout(r, sheet.delays?.[i] ?? 120));
    }
    el.classList.remove('sprite-on');
    sp.remove();
    return true;
  };
  return el;
}
