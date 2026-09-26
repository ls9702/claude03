// 2D avatar portrait composed as an SVG string from avatars.json part ids (HUD lists, lobby, fallback),
// plus Stage 5 `renderAvatarLayers` (full-body generated PNG layers for cut-ins, SVG fallback).
// Keep the public API `renderAvatar(parts, { size, expression?, crop? })` and part ids stable.
import { findAsset } from '../assets.js';
import { avatarPalette, expressionFor, hueFilterFor, layerPlan, recolorPixels } from './cutinMap.js';


// Used until /api/meta installs avatars.json (same ids/colors; names/promptDesc omitted).
const ids = (...list) => list.map((id) => ({ id }));
const colored = (pairs) => pairs.map(([id, color]) => ({ id, color }));
const FALLBACK_DEFS = {
  order: ['body', 'build', 'skin', 'face', 'eyes', 'mouth', 'cheek', 'hair', 'hairColor', 'outfit', 'outfitColor', 'accessory'],
  parts: {
    body: ids('boy', 'girl'),
    build: [
      { id: 'slim', scaleX: 0.9 },
      { id: 'normal', scaleX: 1 },
      { id: 'chubby', scaleX: 1.14 },
    ],
    skin: colored([
      ['porcelain', '#fff0e4'], ['fair', '#fde3cf'], ['light', '#f6cfae'],
      ['olive', '#d9b48a'], ['tan', '#dca77e'], ['deep', '#a86f4c'],
    ]),
    face: ids('slim', 'round', 'square'),
    eyes: ids('round', 'smile', 'sparkle', 'sleepy', 'cat', 'star'),
    mouth: ids('smile', 'neutral', 'grin', 'cat'),
    cheek: ids('none', 'blush', 'freckles'),
    hair: ids('short', 'bob', 'long', 'ponytail', 'twintail', 'spiky', 'curly', 'bun', 'twoblock', 'parted', 'halfup', 'wavy'),
    hairColor: colored([
      ['black', '#2b2222'], ['brown', '#6b4226'], ['blonde', '#e8c15a'], ['red', '#a8452f'], ['pink', '#f28bb3'],
      ['blue', '#4d7fd6'], ['silver', '#c9ccd6'], ['green', '#4fa86b'], ['purple', '#8a5cc9'],
    ]),
    outfit: ids('tshirt', 'hoodie', 'shirt', 'dress', 'overalls', 'hanbok', 'suit', 'uniform', 'tracksuit'),
    outfitColor: colored([
      ['red', '#e25b5b'], ['orange', '#f39a3d'], ['yellow', '#f2cf4a'], ['green', '#5cb87a'], ['blue', '#4f8ee0'],
      ['purple', '#9a6ad6'], ['black', '#3a3a42'], ['white', '#f4f4f2'], ['pink', '#f29ac0'],
    ]),
    accessory: ids('none', 'glasses', 'sunglasses', 'cap', 'ribbon', 'headband', 'earrings', 'hairpin'),
  },
  default: {
    body: 'boy', build: 'normal', skin: 'light', face: 'slim', eyes: 'round', mouth: 'smile', cheek: 'none',
    hair: 'short', hairColor: 'black', outfit: 'tshirt', outfitColor: 'blue', accessory: 'none',
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


// ---------- SVG portrait (Stage 5.5) ----------
// viewBox 0 0 100 100: head center ≈ (50, 42), eyes at y 46 (x 41 / 59), mouth y 56, shoulders y 67–100.
// Every option id in avatars.json has its own shape; colors come from the defs. Gradient ids are unique per call
// (`av<n>-s|h|c|k`) so many portraits can share one document.

const INK = '#2b2222';
const LIP = '#9a4034';
const MOUTH_IN = '#7d2a2a';
const TONGUE = '#ee7b7b';
const WHITE = '#fbfbf8';
const WHITE_LINE = '#c4bdb2';
const GOLD = '#f5cf55';
const GOLD_LINE = '#b58a1d';
const MIRROR = 'matrix(-1 0 0 1 100 0)';
/** Draw a left-side shape and its mirror image (right side). */
const mirror = (s) => `${s}<g transform="${MIRROR}">${s}</g>`;

/** Expressions `renderAvatar(parts, {expression})` understands (neutral = the chosen eyes/mouth). */
export const AVATAR_EXPRESSIONS = ['neutral', 'joy', 'cry', 'shock', 'angry', 'love', 'sweat'];

/** Named viewBoxes for zoomed thumbnails (`renderAvatar(parts, {crop})`). */
export const AVATAR_CROPS = {
  full: '0 0 100 100',
  head: '12 5 76 76',
  face: '22 20 56 56',
  eyes: '28 30 44 44',
  torso: '18 36 64 64',
};

function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}
/** Detail-line color that reads on top of `c` (dark fabrics get light lines). */
const detailOn = (c, k = 0.3) => (lum(c) < 0.3 ? shade(c, 0.42) : shade(c, -k));
/** Outline color for a fill. */
const outlineOf = (c) => (lum(c) < 0.25 ? shade(c, -0.6) : shade(c, -0.42));

const FACE_PATHS = {
  slim: 'M26 41 C26 25 36 18 50 18 C64 18 74 25 74 41 C74 53 67 61 58 64.6 Q50 67.8 42 64.6 C33 61 26 53 26 41 Z',
  round: 'M25 42 C25 25 36 18 50 18 C64 18 75 25 75 42 C75 57.5 65 65.6 50 65.6 C35 65.6 25 57.5 25 42 Z',
  square: 'M26 40 C26 25 36 18 50 18 C64 18 74 25 74 40 L73.6 53 Q73 60 66 62.6 L57 65.2 Q50 66.6 43 65.2 L34 62.6 Q27 60 26.4 53 Z',
};

const TORSO = {
  boy: 'M25 101 Q26 74 38 68.5 Q44 66.5 50 66.5 Q56 66.5 62 68.5 Q74 74 75 101 Z',
  girl: 'M29 101 Q30 75 40 69 Q45 67 50 67 Q55 67 60 69 Q70 75 71 101 Z',
};

function star(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    pts.push(`${(cx + Math.cos(a) * rr).toFixed(2)} ${(cy + Math.sin(a) * rr).toFixed(2)}`);
  }
  return `M${pts.join(' L')} Z`;
}

function heart(x, y, s = 1) {
  return `M${x} ${y + 2.8 * s} C${x - 4.6 * s} ${y - 0.6 * s} ${x - 2.6 * s} ${y - 4.4 * s} ${x} ${y - 1.5 * s} C${x + 2.6 * s} ${y - 4.4 * s} ${x + 4.6 * s} ${y - 0.6 * s} ${x} ${y + 2.8 * s} Z`;
}

// ----- hair -----

function hairBack(style, c) {
  const fill = shade(c.hair, -0.2);
  const st = `fill="${fill}" stroke="${c.hairLine}" stroke-width="1.1" stroke-linejoin="round"`;
  const tie = (x, y) => `<circle cx="${x}" cy="${y}" r="3.2" fill="#f06292" stroke="#c2185b" stroke-width=".6"/>`;
  switch (style) {
    case 'long':
      return `<path d="M24 40 Q20 82 30 93 L70 93 Q80 82 76 40 Z" ${st}/>`;
    case 'wavy':
      return `<path d="M24 40 C17 55 27 62 21 74 C17 84 27 91 32 94 L68 94 C73 91 83 84 79 74 C73 62 83 55 76 40 Z" ${st}/>`;
    case 'halfup':
      return (
        `<path d="M24.5 40 Q21.5 78 30 88 L70 88 Q78.5 78 75.5 40 Z" ${st}/>` +
        `<path d="M44 16 Q50 8 56 16 Q50 19 44 16 Z" ${st}/>` +
        `<path d="M45 17.5 L55 17.5" stroke="#8d6e63" stroke-width="2" stroke-linecap="round"/>`
      );
    case 'bob':
      return `<path d="M24 42 Q22 64 31 68 L69 68 Q78 64 76 42 Z" ${st}/>`;
    case 'parted':
      return `<path d="M25 42 Q22.5 57 27.5 61.5 L72.5 61.5 Q77.5 57 75 42 Z" ${st}/>`;
    case 'ponytail':
      return `<path d="M66 26 Q91 30 85 68 Q80 55 70 47 Z" ${st}/>${tie(70, 30)}`;
    case 'twintail':
      return (
        `<path d="M30 30 Q7 40 15 78 Q21 61 32 46 Z" ${st}/>` +
        `<path d="M70 30 Q93 40 85 78 Q79 61 68 46 Z" ${st}/>` +
        tie(29, 32) +
        tie(71, 32)
      );
    case 'bun':
      return `<circle cx="50" cy="14.5" r="9.5" ${st}/><path d="M44 12 Q50 8 56 12" stroke="#fff" stroke-opacity=".3" stroke-width="1.6" fill="none"/>`;
    case 'curly':
      return [[27, 40], [25.5, 52], [73, 40], [74.5, 52], [29.5, 61], [70.5, 61]]
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7.2" ${st}/>`)
        .join('');
    default:
      return '';
  }
}

const HAIR_FRONT = {
  short: 'M26 42 Q25 15 50 14.5 Q75 15 74 42 L71 36 Q68 30 60 29 L56 34 L52 29 L46 34 L42 29 Q32 30 29 36 Z',
  spiky:
    'M25 44 L21 27 L31 25 L29 12 L41 18 L46 5 L54 16 L63 7 L64 20 L76 17 L72 28 L79 36 L75 44 Q71 31 61 30 L56 35 L50 29 L44 35 L39 30 Q29 31 25 44 Z',
  bob: 'M24 49 Q22 14.5 50 14 Q78 14.5 76 49 L72 49 Q72 35 67 32 L33 32 Q28 35 28 49 Z',
  long: 'M24 53 Q21 14 50 14 Q79 14 76 53 L71 53 Q70 32 56 26 Q52 31 50 24 Q48 31 44 26 Q30 32 29 53 Z',
  halfup: 'M24.5 52 Q21.5 14.5 50 14 Q78.5 14.5 75.5 52 L71.5 52 Q71 34 63 29 Q56 33 50 27.5 Q44 33 37 29 Q29 34 28.5 52 Z',
  ponytail: 'M26 43 Q24 15 50 14 Q76 15 74 43 Q72 30 64 28 Q52 37 35 30 Q29 33 26 43 Z',
  twintail: 'M25 46 Q23 15 50 14 Q77 15 75 46 L72 46 Q71 34 64 31 Q57 34 51 29 L49 29 Q43 34 36 31 Q29 34 28 46 Z',
  bun: 'M26 41 Q25 17 50 16 Q75 17 74 41 Q68 28 50 27 Q32 28 26 41 Z',
  twoblock:
    'M27.5 35 Q25 13 50 12.5 Q76 13 72.5 35 Q70 30.5 65.5 30.5 Q63.5 36.5 58 35 Q55 38.8 50 36.6 Q45 38.8 42 35 Q36.5 36.5 34.5 30.5 Q30 30.5 27.5 35 Z',
  parted:
    'M25 46 Q23 14.5 50 14 Q77 14.5 75 46 L72 46 Q71 33 62 28.5 Q52 36.5 36.5 38.5 Q41.5 32 40 24.5 Q34 30 29.5 36.5 Q27.5 40.5 28 46 Z',
  wavy:
    'M24 55 C20.5 47 24 37 25 30 Q27 14.5 50 14 Q73 14.5 75 30 C76 37 79.5 47 76 55 C73 50 74.5 44 71 40 Q70 32 62 28 Q56 34 50 30 Q44 34 38 28 Q30 32 29 40 C25.5 44 27 50 24 55 Z',
};

function hairFront(style, c) {
  const d = HAIR_FRONT[style] ?? HAIR_FRONT.short;
  let extra = '';
  if (style === 'curly') {
    extra = [[30, 28], [38, 20.5], [50, 17.5], [62, 20.5], [70, 28], [44, 29], [56, 29], [27, 37], [73, 37]]
      .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7" fill="url(#${c.id}-h)" stroke="${c.hairLine}" stroke-width="1.1"/>`)
      .join('');
    // hide the inner outlines where the curls overlap
    extra += `<path d="M31 31 Q50 20 69 31 Q50 27 31 31 Z" fill="${c.hair}"/>`;
  }
  let pre = '';
  if (style === 'twoblock') {
    // shaved sides: short fade between the hair and skin color above the ears
    const fade = mixHex(c.hair, c.skin, 0.55);
    pre = mirror(`<path d="M26.4 47 Q25.4 38.5 27.6 33 L32 32.5 L31.4 47 Z" fill="${fade}"/>`);
  }
  const hi = `<path d="M35 22.5 Q42 18.2 50 18.4" stroke="#fff" stroke-opacity=".38" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
  const partLine = style === 'parted' ? `<path d="M40 15.5 Q41 20 40 24.5" stroke="${c.hairLine}" stroke-width=".9" fill="none" stroke-linecap="round"/>` : '';
  const strands =
    style === 'wavy'
      ? `<path d="M31 33 Q29 38 31.5 42 M69 33 Q71 38 68.5 42" stroke="${c.hairLine}" stroke-width=".8" fill="none" opacity=".6"/>`
      : '';
  return (
    pre +
    `<path d="${d}" fill="url(#${c.id}-h)" stroke="${c.hairLine}" stroke-width="1.1" stroke-linejoin="round"/>` +
    extra +
    strands +
    partLine +
    hi
  );
}

function mixHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = [16, 8, 0].map((s) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t));
  return `#${ch.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

// ----- outfits (drawn inside the build scale group) -----

function outfit(style, c) {
  const T = TORSO[c.body] ?? TORSO.boy;
  const girl = c.body === 'girl';
  const line = c.clothLine;
  const det = c.detail;
  const grad = `url(#${c.id}-c)`;
  const base = (fill = grad, stroke = line) => `<path d="${T}" fill="${fill}" stroke="${stroke}" stroke-width="1.1" stroke-linejoin="round"/>`;
  const neckHole = `<path d="M42.8 67.2 Q50 73.6 57.2 67.2 Z" fill="${shade(c.skin, -0.16)}"/>`;
  const white = (d) => `<path d="${d}" fill="${WHITE}" stroke="${WHITE_LINE}" stroke-width=".8" stroke-linejoin="round"/>`;
  const shirtV = (bottom = 81) => white(`M43.5 66.8 L50 ${bottom} L56.5 66.8 Z`);
  switch (style) {
    case 'hoodie':
      return (
        `<path d="M34 72 Q34 61.5 50 61 Q66 61.5 66 72 Q58 68 50 68 Q42 68 34 72 Z" fill="${shade(c.cloth, -0.18)}" stroke="${line}" stroke-width="1"/>` +
        base() +
        `<path d="M40 67 Q50 79.5 60 67 Q55 71.5 50 72 Q45 71.5 40 67 Z" fill="${shade(c.cloth, -0.2)}" stroke="${line}" stroke-width=".8"/>` +
        `<path d="M46.5 74 L46 84 M53.5 74 L54 84" stroke="${WHITE}" stroke-width="1.2" stroke-linecap="round"/>` +
        `<circle cx="46" cy="85" r="1" fill="${WHITE}"/><circle cx="54" cy="85" r="1" fill="${WHITE}"/>` +
        `<path d="M39 101 L40 90 Q41 87 44 87 L56 87 Q59 87 60 90 L61 101 Z" fill="${shade(c.cloth, -0.1)}" stroke="${det}" stroke-width=".8"/>`
      );
    case 'shirt':
      return (
        base() +
        mirror(white('M41.5 66.4 L50 75 L45.6 79 L38.6 70 Z')) +
        `<path d="M50 75 L50 101" stroke="${det}" stroke-width=".9"/>` +
        [82, 89, 96].map((y) => `<circle cx="51.6" cy="${y}" r="1.1" fill="${det}"/>`).join('') +
        `<path d="M56 81 L62.5 81 L62.5 87 Q59.2 88.6 56 87 Z" stroke="${det}" stroke-width=".8" fill="none"/>`
      );
    case 'dress':
      return (
        `<path d="M31 101 L36.5 83 Q34.5 73 40 68.5 Q45 66.8 50 66.8 Q55 66.8 60 68.5 Q65.5 73 63.5 83 L69 101 Z" fill="${grad}" stroke="${line}" stroke-width="1.1" stroke-linejoin="round"/>` +
        neckHole +
        `<path d="M36.5 83 Q50 87 63.5 83" stroke="${det}" stroke-width="1.6" fill="none"/>` +
        `<path d="M43 89 L41 101 M50 89.5 L50 101 M57 89 L59 101" stroke="${det}" stroke-width=".7" opacity=".6"/>` +
        mirror(white('M50 71 Q44 76 40.4 69.6 Q44.4 66.8 50 67.4 Z'))
      );
    case 'overalls':
      return (
        base('#f7f4ee', WHITE_LINE) +
        neckHole +
        `<path d="M42.8 67.2 Q50 73.6 57.2 67.2" stroke="${WHITE_LINE}" stroke-width="1.2" fill="none"/>` +
        `<path d="M38 79 L62 79 L63 88 Q${girl ? 69 : 71} 92 ${girl ? 70 : 73} 101 L${girl ? 30 : 27} 101 Q${girl ? 31 : 29} 92 37 88 Z" fill="${grad}" stroke="${line}" stroke-width="1" stroke-linejoin="round"/>` +
        mirror(`<path d="M38 79.5 L39.2 67.3 L42.6 67.8 L41.8 79.5 Z" fill="${c.cloth}" stroke="${line}" stroke-width=".8"/>`) +
        mirror(`<circle cx="40.1" cy="79.6" r="1.6" fill="${GOLD}" stroke="${GOLD_LINE}" stroke-width=".5"/>`) +
        `<path d="M45 83 L55 83 L55 89 Q50 91 45 89 Z" fill="${shade(c.cloth, -0.1)}" stroke="${det}" stroke-width=".8"/>`
      );
    case 'hanbok':
      return (
        base() +
        neckHole +
        white('M58.2 66.8 L60.6 69 L52.6 79.6 L50.4 77.6 Z') +
        white('M41 67.4 L57.6 88 L54.6 90.2 L38.4 69.6 Z') +
        `<path d="M56 88 Q62.5 84 64.8 88.6 Q60 90.8 56 88 Z" fill="${c.accent}" stroke="${shade(c.accent, -0.35)}" stroke-width=".6"/>` +
        `<path d="M56 88 L60.6 99.6 M56 88 L54 100.4" stroke="${c.accent}" stroke-width="2.4" stroke-linecap="round"/>`
      );
    case 'suit':
      return (
        base() +
        shirtV(81) +
        `<path d="M48.7 69.4 L51.3 69.4 L52 72.2 L51.3 72.8 L52.6 86 L50 89.6 L47.4 86 L48.7 72.8 L48 72.2 Z" fill="${c.accent}" stroke="${shade(c.accent, -0.35)}" stroke-width=".7" stroke-linejoin="round"/>` +
        mirror(`<path d="M43.5 66.8 L50 81 L46.6 83.6 L40.4 72 L43 70.4 L40 68.4 Z" fill="${shade(c.cloth, -0.12)}" stroke="${line}" stroke-width=".9" stroke-linejoin="round"/>`) +
        [90, 96].map((y) => `<circle cx="50" cy="${y}" r="1.2" fill="${det}"/>`).join('') +
        `<path d="M58 79 L62.4 78.4 L62 80.2 Z" fill="${WHITE}"/>`
      );
    case 'uniform': {
      const neckwear = girl
        ? `<path d="M50 71 L43.8 67.6 L44.2 74.2 Z M50 71 L56.2 67.6 L55.8 74.2 Z" fill="${c.accent}" stroke="${shade(c.accent, -0.35)}" stroke-width=".6" stroke-linejoin="round"/>` +
          `<path d="M49 71.5 L46.8 79 M51 71.5 L53.2 79" stroke="${c.accent}" stroke-width="1.8" stroke-linecap="round"/>` +
          `<circle cx="50" cy="71" r="1.5" fill="${shade(c.accent, -0.2)}"/>`
        : `<path d="M48.8 69 L51.2 69 L51.8 71.6 L52.2 79 L50 81.6 L47.8 79 L48.2 71.6 Z" fill="${c.accent}" stroke="${shade(c.accent, -0.35)}" stroke-width=".6"/>` +
          `<path d="M48.2 73.6 L51.8 71.8 M48 77.2 L52 75.2" stroke="${WHITE}" stroke-width=".7" opacity=".85"/>`;
      return (
        base() +
        shirtV(78) +
        neckwear +
        mirror(`<path d="M44 66.8 L50 78 L47.6 80.6 L41.4 71 Z" fill="${shade(c.cloth, -0.12)}" stroke="${line}" stroke-width=".9" stroke-linejoin="round"/>`) +
        `<path d="M57.6 81 L63 81 L63 84.2 Q60.3 87 57.6 84.2 Z" fill="${GOLD}" stroke="${GOLD_LINE}" stroke-width=".6"/>` +
        [86, 93].map((y) => `<circle cx="50" cy="${y}" r="1.2" fill="${GOLD}" stroke="${GOLD_LINE}" stroke-width=".4"/>`).join('')
      );
    }
    case 'tracksuit': {
      const stripe = lum(c.cloth) > 0.8 ? c.accent : WHITE;
      return (
        base() +
        mirror(`<path d="M35.4 71.2 Q31 82 30.2 101 M37.8 70.2 Q33.6 82 33 101" stroke="${stripe}" stroke-width="1.5" fill="none"/>`) +
        `<path d="M41.4 65 L41.8 70.6 Q50 73.6 58.2 70.6 L58.6 65 Q50 68 41.4 65 Z" fill="${shade(c.cloth, -0.08)}" stroke="${line}" stroke-width=".9" stroke-linejoin="round"/>` +
        `<path d="M50 70.6 L50 101" stroke="${det}" stroke-width="1.1"/>` +
        `<rect x="49" y="73.6" width="2" height="3.4" rx=".6" fill="#dadada" stroke="#8a8a8a" stroke-width=".4"/>`
      );
    }
    case 'tshirt':
    default:
      return (
        base() +
        neckHole +
        `<path d="M42.8 67.2 Q50 73.6 57.2 67.2" stroke="${det}" stroke-width="1.6" fill="none"/>` +
        mirror(`<path d="M34.2 73 Q37 80 35.6 90" stroke="${det}" stroke-width=".9" fill="none" opacity=".6"/>`) +
        `<path d="M43.5 85 L56.5 85" stroke="${WHITE}" stroke-opacity=".5" stroke-width="3" stroke-linecap="round"/>`
      );
  }
}

// ----- face -----

const BROWS = {
  base: 'M36.2 39.6 Q40.5 37.6 45 38.8',
  worried: 'M36.4 38.4 Q41 38.8 45 36.6',
  angry: 'M36 36.8 L45.2 40.2',
  raised: 'M36.2 37 Q40.5 34.8 45 36.2',
};

function brows(kind, c) {
  return mirror(
    `<path d="${BROWS[kind] ?? BROWS.base}" stroke="${c.brow}" stroke-width="${kind === 'angry' ? 1.9 : 1.5}" fill="none" stroke-linecap="round"/>`,
  );
}

function eyes(style, c) {
  const lashes = c.body === 'girl' ? mirror(`<path d="M37.6 43.2 L35.4 41.6" stroke="${INK}" stroke-width="1.2" stroke-linecap="round"/>`) : '';
  const both = (fn) => [41, 59].map(fn).join('');
  switch (style) {
    case 'smile':
      return mirror(`<path d="M37.5 47.5 Q41 43.2 44.5 47.5" stroke="${INK}" stroke-width="2.1" fill="none" stroke-linecap="round"/>`) + lashes;
    case 'sparkle':
      return (
        both(
          (x) =>
            `<ellipse cx="${x}" cy="46" rx="3.7" ry="4.7" fill="${INK}"/>` +
            `<ellipse cx="${x}" cy="47.6" rx="2.6" ry="2.7" fill="#5b82dd"/>` +
            `<circle cx="${x - 1.3}" cy="44.2" r="1.55" fill="#fff"/><circle cx="${x + 1.4}" cy="48.4" r=".8" fill="#fff"/><circle cx="${x + 1.6}" cy="44.4" r=".45" fill="#fff"/>`,
        ) + lashes
      );
    case 'sleepy':
      return (
        mirror(`<path d="M37.4 45.6 Q41 44.9 44.6 45.6 Q44.2 49.4 41 49.4 Q37.8 49.4 37.4 45.6 Z" fill="${INK}"/>`) +
        mirror(`<path d="M36.8 45.4 Q41 44.2 45.2 45.4" stroke="${INK}" stroke-width="1.4" fill="none" stroke-linecap="round"/>`) +
        both((x) => `<circle cx="${x - 1}" cy="47.3" r=".6" fill="#fff"/>`)
      );
    case 'cat':
      return (
        mirror(
          `<path d="M36.2 43.6 Q41 42.2 45 46 Q43.8 48.8 40.6 48.8 Q37.4 48.6 36.2 43.6 Z" fill="${INK}"/>` +
            `<ellipse cx="41" cy="46.2" rx="2" ry="2.3" fill="#d9a13a"/><ellipse cx="41.1" cy="46.2" rx=".55" ry="1.9" fill="${INK}"/>` +
            `<path d="M36.4 43.7 L34.2 42.2" stroke="${INK}" stroke-width="1.2" stroke-linecap="round"/>`,
        ) + both((x) => `<circle cx="${x - 0.8}" cy="44.9" r=".75" fill="#fff"/>`)
      );
    case 'star':
      return (
        both(
          (x) =>
            `<ellipse cx="${x}" cy="46" rx="3.4" ry="4.3" fill="${INK}"/>` +
            `<ellipse cx="${x}" cy="47.4" rx="2.4" ry="2.5" fill="#4a6fd0"/>` +
            `<path d="${star(x, 45.9, 2.3)}" fill="#fff7c2"/>`,
        ) + lashes
      );
    case 'round':
    default:
      return (
        both(
          (x) =>
            `<ellipse cx="${x}" cy="46" rx="3.1" ry="3.9" fill="${INK}"/><ellipse cx="${x}" cy="47.4" rx="2.1" ry="2" fill="#6b4a3a"/>` +
            `<circle cx="${x - 1}" cy="44.6" r="1.25" fill="#fff"/><circle cx="${x + 1}" cy="48" r=".55" fill="#fff"/>`,
        ) + lashes
      );
  }
}

function mouth(style) {
  switch (style) {
    case 'neutral':
      return `<path d="M47.4 56.6 L52.6 56.6" stroke="${LIP}" stroke-width="1.5" stroke-linecap="round"/>`;
    case 'grin':
      return (
        `<path d="M44.8 54.4 Q50 55.6 55.2 54.4 Q54.6 60.8 50 60.8 Q45.4 60.8 44.8 54.4 Z" fill="${MOUTH_IN}" stroke="${LIP}" stroke-width=".8" stroke-linejoin="round"/>` +
        `<path d="M45.4 55 Q50 56.1 54.6 55 L54.4 56.3 Q50 57.2 45.6 56.3 Z" fill="#fff"/>` +
        `<path d="M46.9 59.2 Q50 57.2 53.1 59.2 Q51.6 60.7 50 60.7 Q48.4 60.7 46.9 59.2 Z" fill="${TONGUE}"/>`
      );
    case 'cat':
      return `<path d="M45.4 55 Q47.7 58.2 50 55.6 Q52.3 58.2 54.6 55" stroke="${LIP}" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    case 'smile':
    default:
      return `<path d="M46 55 Q50 58.8 54 55" stroke="${LIP}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;
  }
}

function cheeks(style) {
  switch (style) {
    case 'blush':
      return mirror(
        `<ellipse cx="34.5" cy="53" rx="4.4" ry="2.5" fill="#ff7f96" opacity=".42"/>` +
          `<path d="M32.6 53.8 L33.7 52.2 M34.9 53.8 L36 52.2 M37.2 53.8 L38.3 52.2" stroke="#ff6f88" stroke-width=".6" opacity=".75" stroke-linecap="round"/>`,
      );
    case 'freckles':
      return mirror(
        [[32.4, 52.2], [35, 53.4], [33.4, 54.8], [36.6, 51.8], [37.4, 54.2]]
          .map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".55" fill="#a86442" opacity=".7"/>`)
          .join(''),
      );
    default:
      return '';
  }
}

/** Eyes + mouth + brows (+ effects) for an expression; neutral keeps the avatar's own parts. */
function faceFeatures(a, c, expression) {
  switch (expression) {
    case 'joy':
      return {
        brows: brows('base', c),
        eyes: mirror(`<path d="M37.4 47.8 Q41 42.8 44.6 47.8" stroke="${INK}" stroke-width="2.3" fill="none" stroke-linecap="round"/>`),
        mouth: mouth('grin'),
        fx: '',
      };
    case 'cry':
      return {
        brows: brows('worried', c),
        eyes: mirror(`<path d="M37.4 45.8 Q41 48.8 44.6 45.8" stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round"/>`),
        mouth: `<path d="M45 58.6 Q47.5 55 50 57 Q52.5 55 55 58.6 Q50 61.2 45 58.6 Z" fill="${MOUTH_IN}" stroke="${LIP}" stroke-width=".8" stroke-linejoin="round"/>`,
        fx: mirror(
          `<path d="M39.6 48.6 Q37.8 54.5 39 61" stroke="#8fd3ff" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".9"/>` +
            `<path d="M38.2 62 Q39.6 64.6 38.6 66 Q37.2 66.4 37 65 Q37 63.6 38.2 62 Z" fill="#8fd3ff"/>`,
        ),
      };
    case 'shock':
      return {
        brows: brows('raised', c),
        eyes: [41, 59].map((x) => `<circle cx="${x}" cy="46" r="3.9" fill="#fff" stroke="${INK}" stroke-width="1.2"/><circle cx="${x}" cy="46.3" r="1.4" fill="${INK}"/>`).join(''),
        mouth: `<ellipse cx="50" cy="58" rx="2.6" ry="3.4" fill="${MOUTH_IN}" stroke="${LIP}" stroke-width=".8"/>`,
        fx: `<path d="M40 22 L40 28 M44 21 L44 27.5 M48 20.6 L48 27" stroke="#6b8fe0" stroke-width="1" opacity=".55" stroke-linecap="round"/>`,
      };
    case 'angry':
      return {
        brows: brows('angry', c),
        eyes: mirror(`<path d="M37.8 44.4 L44.2 46 Q44.2 49.6 41 49.6 Q37.8 49.6 37.8 44.4 Z" fill="${INK}"/>`) +
          [41, 59].map((x) => `<circle cx="${x - 1}" cy="47.2" r=".7" fill="#fff"/>`).join(''),
        mouth: `<path d="M46 58.2 Q50 55.2 54 58.2" stroke="${LIP}" stroke-width="1.7" fill="none" stroke-linecap="round"/>`,
        fx: `<g transform="translate(69 26.5)" stroke="#e2504c" stroke-width="1.6" fill="none" stroke-linecap="round"><path d="M-3.6 -1 Q-1 -1 -1 -3.6 M1 -3.6 Q1 -1 3.6 -1 M3.6 1 Q1 1 1 3.6 M-1 3.6 Q-1 1 -3.6 1"/></g>`,
      };
    case 'love':
      return {
        brows: brows('base', c),
        eyes: [41, 59]
          .map((x) => `<path d="${heart(x, 46.2, 1.05)}" fill="#ff4f7b" stroke="#c2185b" stroke-width=".6"/><circle cx="${x - 1.4}" cy="44.6" r=".7" fill="#fff"/>`)
          .join(''),
        mouth: mouth('smile'),
        fx: a.cheek === 'blush' ? '' : cheeks('blush'),
      };
    case 'sweat':
      return {
        brows: brows('worried', c),
        eyes: eyes(a.eyes, c),
        mouth: `<path d="M45.5 57.2 Q47.75 55.4 50 57.2 Q52.25 59 54.5 57.2" stroke="${LIP}" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,
        fx: `<path d="M71 28.6 Q74.8 33.8 73.4 36 Q71 38.4 68.6 36 Q67.2 33.8 71 28.6 Z" fill="#9fdcff" stroke="#4aa3df" stroke-width=".7"/><path d="M69.8 34.2 Q69.8 32.8 70.8 31.6" stroke="#fff" stroke-width=".8" fill="none" stroke-linecap="round"/>`,
      };
    default:
      return { brows: brows('base', c), eyes: eyes(a.eyes, c), mouth: mouth(a.mouth), fx: '' };
  }
}

// ----- accessories -----

function accessory(style, c) {
  switch (style) {
    case 'glasses':
      return (
        mirror(`<path d="M35.6 45 L27.6 43.8" stroke="#3a3a4a" stroke-width="1.2"/>`) +
        `<g fill="#fff" fill-opacity=".2" stroke="#3a3a4a" stroke-width="1.5"><circle cx="41" cy="46" r="5.5"/><circle cx="59" cy="46" r="5.5"/></g>` +
        `<path d="M46.5 46 Q50 44 53.5 46" stroke="#3a3a4a" stroke-width="1.5" fill="none"/>` +
        `<path d="M38 43.6 L40 42.6 M56 43.6 L58 42.6" stroke="#fff" stroke-width=".9" stroke-linecap="round" opacity=".8"/>`
      );
    case 'sunglasses':
      return (
        mirror(`<path d="M34.6 45 L27.6 43.8" stroke="#1f2230" stroke-width="1.3"/>`) +
        `<g fill="#1f2230" stroke="#1f2230" stroke-width="1"><rect x="34.5" y="42" width="13" height="8" rx="3"/><rect x="52.5" y="42" width="13" height="8" rx="3"/></g>` +
        `<path d="M47.5 45 L52.5 45" stroke="#1f2230" stroke-width="1.6"/>` +
        `<path d="M36.5 44 L40 44 M54.5 44 L58 44" stroke="#fff" stroke-opacity=".5" stroke-width="1.2"/>`
      );
    case 'cap': {
      const cc = shade(c.cloth, -0.1);
      const cl = outlineOf(cc);
      return (
        `<path d="M25 33 Q25 10.5 50 10.5 Q75 10.5 75 33 Z" fill="${cc}" stroke="${cl}" stroke-width="1.1" stroke-linejoin="round"/>` +
        `<path d="M50 11 L50 33 M37 13.5 Q35 22 36 33 M63 13.5 Q65 22 64 33" stroke="${cl}" stroke-width=".7" fill="none" opacity=".6"/>` +
        `<path d="M47 31 Q76 27 89 34 Q72 38.6 47 35 Z" fill="${shade(cc, -0.25)}" stroke="${cl}" stroke-width="1" stroke-linejoin="round"/>` +
        `<circle cx="50" cy="11.5" r="2" fill="${shade(cc, -0.25)}"/>`
      );
    }
    case 'ribbon':
      return `<g transform="translate(66 21) rotate(18)"><path d="M0 0 L-10 -6.4 Q-12 0 -10 6.4 Z M0 0 L10 -6.4 Q12 0 10 6.4 Z" fill="#f06292" stroke="#c2185b" stroke-width=".7" stroke-linejoin="round"/><circle r="2.6" fill="#d94680" stroke="#c2185b" stroke-width=".6"/></g>`;
    case 'headband':
      return (
        `<path d="M26 36 Q50 9.5 74 36" stroke="#c98a2a" stroke-width="5.4" fill="none" stroke-linecap="round"/>` +
        `<path d="M26 36 Q50 9.5 74 36" stroke="#ffb74d" stroke-width="3.8" fill="none" stroke-linecap="round"/>`
      );
    case 'earrings':
      return mirror(
        `<path d="M26.2 51.6 L26.2 54.6" stroke="${GOLD_LINE}" stroke-width=".6"/>` +
          `<circle cx="26.2" cy="51.6" r="1.1" fill="${GOLD}" stroke="${GOLD_LINE}" stroke-width=".5"/>` +
          `<path d="M26.2 54.2 Q28.2 56.8 26.2 58.4 Q24.2 56.8 26.2 54.2 Z" fill="${GOLD}" stroke="${GOLD_LINE}" stroke-width=".5"/>`,
      );
    case 'hairpin': {
      const petals = [0, 1, 2, 3, 4]
        .map((i) => {
          const ang = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
          return `<circle cx="${(Math.cos(ang) * 2.4).toFixed(2)}" cy="${(Math.sin(ang) * 2.4).toFixed(2)}" r="2.3"/>`;
        })
        .join('');
      return (
        `<g transform="translate(64 25) rotate(12)"><path d="M-6 3 L2 -1" stroke="#b0b6c4" stroke-width="1.4" stroke-linecap="round"/>` +
        `<g fill="#ff9cc0" stroke="#e0679a" stroke-width=".5">${petals}</g><circle r="1.5" fill="#ffd54f" stroke="#e0a526" stroke-width=".4"/></g>`
      );
    }
    default:
      return '';
  }
}

let portraitSeq = 0;

/**
 * Compose a chibi head-and-shoulders portrait.
 * @param {object} parts avatar part ids (see avatars.json; missing/unknown ids → defaults)
 * @param {{size?: number, bg?: string|null, title?: string, expression?: string|null, crop?: string}} opts
 *   `expression`: one of AVATAR_EXPRESSIONS (swaps eyes/mouth/brows, adds tears/sweat/…);
 *   `crop`: a key of AVATAR_CROPS or an explicit "x y w h" viewBox (thumbnails).
 * @returns {string} SVG markup
 */
export function renderAvatar(parts, { size = 96, bg = null, title = '', expression = null, crop = null } = {}) {
  const defs = DEFS;
  const a = normalizeAvatar(parts, defs);
  const skin = colorOf('skin', a.skin, defs);
  const hair = colorOf('hairColor', a.hairColor, defs);
  const cloth = colorOf('outfitColor', a.outfitColor, defs);
  const sx = Number(defs.parts.build?.find((o) => o.id === a.build)?.scaleX) || 1;
  const id = `av${(++portraitSeq).toString(36)}`;
  const c = {
    id,
    body: a.body,
    skin,
    skinLine: shade(skin, -0.38),
    hair,
    hairLine: outlineOf(hair),
    brow: lum(hair) > 0.55 ? shade(hair, -0.45) : shade(hair, -0.15),
    cloth,
    clothLine: outlineOf(cloth),
    detail: detailOn(cloth),
    accent: ['red', 'pink', 'orange'].includes(a.outfitColor) ? '#34467a' : '#d8434a',
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  const viewBox = AVATAR_CROPS[crop] ?? (typeof crop === 'string' && /^[\d.\s-]+$/.test(crop) ? crop : AVATAR_CROPS.full);
  const f = faceFeatures(a, c, AVATAR_EXPRESSIONS.includes(expression) ? expression : 'neutral');
  const build = sx === 1 ? '' : ` transform="matrix(${sx} 0 0 1 ${+(50 - 50 * sx).toFixed(3)} 0)"`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${size}" height="${size}" role="img" aria-label="${esc(title || '캐릭터')}">`,
    '<defs>',
    `<radialGradient id="${id}-s" cx=".42" cy=".36" r=".75"><stop offset="0" stop-color="${shade(skin, 0.16)}"/><stop offset=".65" stop-color="${skin}"/><stop offset="1" stop-color="${shade(skin, -0.08)}"/></radialGradient>`,
    `<linearGradient id="${id}-h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(hair, 0.22)}"/><stop offset=".55" stop-color="${hair}"/><stop offset="1" stop-color="${shade(hair, -0.16)}"/></linearGradient>`,
    `<linearGradient id="${id}-c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(cloth, 0.12)}"/><stop offset="1" stop-color="${shade(cloth, -0.1)}"/></linearGradient>`,
    bg ? `<clipPath id="${id}-k"><circle cx="50" cy="50" r="50"/></clipPath>` : '',
    '</defs>',
    bg ? `<g clip-path="url(#${id}-k)"><circle cx="50" cy="50" r="50" fill="${esc(bg)}"/>` : '',
    hairBack(a.hair, c),
    `<g class="av-torso"${build}>`,
    `<path d="M45 57 L45 69 Q50 71.2 55 69 L55 57 Z" fill="${shade(skin, -0.12)}"/>`,
    outfit(a.outfit, c),
    '</g>',
    mirror(
      `<ellipse cx="26.6" cy="46.6" rx="4.2" ry="5" fill="${skin}" stroke="${c.skinLine}" stroke-width="1"/>` +
        `<path d="M25.6 44.6 Q24.1 46.6 25.9 48.9" stroke="${c.skinLine}" stroke-width=".8" fill="none" opacity=".6"/>`,
    ),
    `<path d="${FACE_PATHS[a.face] ?? FACE_PATHS.slim}" fill="url(#${id}-s)" stroke="${c.skinLine}" stroke-width="1.1" stroke-linejoin="round"/>`,
    `<path d="M49.2 51.2 Q50 52 50.8 51.2" stroke="${c.skinLine}" stroke-width=".9" fill="none" stroke-linecap="round" opacity=".7"/>`,
    cheeks(a.cheek),
    f.brows,
    f.eyes,
    f.mouth,
    hairFront(a.hair, c),
    accessory(a.accessory, c),
    f.fx,
    bg ? '</g>' : '',
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
