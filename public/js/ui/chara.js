// Chiikawa conversion (CH-1) — the character renderer for every 2D drawing (lobby, HUD, side list, decision sheets,
// cut-ins, banners, result page, group photo, 2D board tokens). Placeholders are simple hand-drawn SVG shapes in code
// (private non-commercial fan use; nothing is fetched or copied): round soft bodies, thin warm outlines, dot eyes, pink
// blush. Raster art (contract §3: `ch-<id>-base|body|arms|eyes-closed|mouth-open|expr-<e>|sheet-<a>`, `npc-<species>-…`,
// `pet-<species>-…`, `prop-<id>`) replaces the SVG parts as soon as it is accepted in /api/assets.
//
// Coordinates = the shared 1024×1536 character canvas (feet on y 1303, centred on x 512); roster `anchors` place the
// props (head / face / neck / handL / handR / back) — the SVG rig derives its proportions from the same anchors, so data,
// placeholders and raster art agree. Parts are groups with pivots (`data-rig` root / head / earL / earR / armL / armR /
// tail / shadow, `data-px|py`) driven by ui/rig.js; eyes open/closed (`.ch-eo` / `.ch-ec`) and mouth closed/open
// (`.ch-mc` / `.ch-mo`) are toggled by classes (`blink`, `mouth-open`).
//
//   charaSvg(look, {size, crop, expression, pose, title, flip, motion, static})  → SVG markup string (sync)
//   renderChara(look, opts) → element `.chara` with setState({expression, pose}), play(action) → Promise, talk(ms), ready
//   portraitHtml / renderPortrait / hydratePortraits                      → round portrait slots (drop-in API)
//   renderCutinFigure(character, {pose, emotion, name, flip})              → cut-in figure (setState / playSprite / play)
//   charaImage(look, {expression, pose, height})                            → Promise<{img, feet}> (group photo)
import { assetInfo } from '../assets.js';
import { CANVAS, PROP_SLOTS, lookKey, lookKind, normalizeLook, npcInfo, petInfo, propInfo, rosterInfo } from '../shared/roster.js';
import { ACTIONS, BLINK, blinkDelay, createRig, createSpritePlayer, keyPose, partTransform, particlesSvg, prefersReducedMotion, sheetDef, spawnParticles } from './rig.js';

const F = CANVAS.feetY;
const CX = CANVAS.cx;
const n1 = (v) => (Math.round(v * 10) / 10).toString();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Expressions the renderer draws (neutral = the character's own face). */
export const CHARA_EXPRESSIONS = Object.freeze(['neutral', 'joy', 'cry', 'shock', 'angry', 'love', 'sweat', 'shy']);
/** Poses = rig actions a figure can hold (loops) or play once. */
export const CHARA_POSES = Object.freeze(['idle', 'wave', 'jump', 'cheer', 'cry', 'shock', 'walk', 'talk']);
/** Named crops (viewBoxes are computed per figure, except `full` which is the same for everyone → relative sizes show). */
export const CHARA_CROPS = Object.freeze(['full', 'fit', 'bust', 'face', 'head']);
/** The common full-figure view (fits the tallest roster member with a hat; feet near the bottom). */
export const FULL_VIEW = Object.freeze({ x: 32, y: 150, w: 960, h: 1230 });

// ---------- colour helpers ----------
function hexRgb(hex) {
  const h = String(hex ?? '').replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0').slice(0, 6);
  const n = parseInt(v, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** Lighten (amt > 0) / darken (amt < 0) a hex colour. */
export function shade(hex, amt) {
  const ch = hexRgb(hex).map((c) => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt));
  return `#${ch.map((c) => clamp(c, 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

// ---------- geometry ----------
const TEMPLATE_ANCHORS = { head: [512, 420], face: [512, 640], neck: [512, 880], handL: [330, 1010], handR: [694, 1010], back: [512, 1000] };
const pt = (v, fb) => (Array.isArray(v) && v.length >= 2 && Number.isFinite(+v[0]) && Number.isFinite(+v[1]) ? [+v[0], +v[1]] : fb);

/** Roster-style anchors scaled about the feet (NPC friends without anchors). */
export function scaledAnchors(s = 1) {
  const out = {};
  for (const [k, [x, y]] of Object.entries(TEMPLATE_ANCHORS)) out[k] = [CX + (x - CX) * s, F + (y - F) * s];
  return out;
}

/** Rig geometry of a chibi figure (roster characters / NPC friends) from its anchors. */
export function chibiGeom(anchors) {
  const a = {};
  const s = scaledAnchors(1);
  for (const k of Object.keys(TEMPLATE_ANCHORS)) a[k] = pt(anchors?.[k], s[k]);
  const top = a.head[1];
  const neckY = Math.max(a.neck[1], top + 200);
  const bottom = neckY + (neckY - top) * 0.2;
  const H = bottom - top;
  const cy = top + H * 0.5;
  const rx = H * 0.56;
  // a squat round body (Chiikawa proportions: the head is ~60 % of the height), stubby arms just under the chin
  const bw = clamp((F - bottom) * 0.8, H * 0.34, H * 0.5);
  const faceY = top + H * 0.47;
  const shoulderY = bottom - H * 0.02;
  const handY = bottom + H * 0.12;
  const geom = {
    a, top, bottom, H, cy, rx, cx: CX, neckY, faceY, bw,
    bodyTop: neckY - H * 0.1,
    shoulderL: [CX - bw * 0.74, shoulderY],
    shoulderR: [CX + bw * 0.74, shoulderY],
    handL: [CX - bw * 1.08, handY],
    handR: [CX + bw * 1.08, handY],
    armW: H * 0.15,
    ex: rx * 0.38, ey: faceY, er: H * 0.034, ery: H * 0.045,
    mouthY: faceY + H * 0.105,
    blush: { x: rx * 0.66, y: faceY + H * 0.085, rx: H * 0.088, ry: H * 0.05 },
    backY: a.back[1],
  };
  // the anchors the placeholder rig really uses (props sit on its own head / hands)
  geom.anchors = { head: [CX, top], face: [CX, faceY], neck: [CX, Math.min(neckY, bottom - H * 0.02)], handL: geom.handL, handR: geom.handR, back: [CX, (bottom + F) / 2 - H * 0.05] };
  return geom;
}

/**
 * Anchors the SVG placeholder rig attaches props to ({head, face, neck, handL, handR, back}; canvas coordinates). Raster art
 * uses the roster `anchors` from the data instead (the drawn character decides where its hands are).
 */
export function charaAnchors(look, meta = null) {
  const kind = lookKind(look);
  if (kind === 'pet') return scaledAnchors(0.9);
  const info = kind === 'npc' ? npcInfo(look.npc, meta) : rosterInfo(normalizeLook(look, meta).character, meta);
  return chibiGeom(kind === 'npc' ? scaledAnchors(info.size) : info.anchors ?? scaledAnchors(info.size)).anchors;
}

// ---------- tiny SVG builders ----------
/** Outline style attributes. */
const ln = (C, fill, w = C.lw, extra = '') => `fill="${fill}" stroke="${C.line}" stroke-width="${n1(w)}" stroke-linejoin="round" stroke-linecap="round"${extra}`;
const ell = (cx, cy, rx, ry, attrs) => `<ellipse cx="${n1(cx)}" cy="${n1(cy)}" rx="${n1(rx)}" ry="${n1(ry)}" ${attrs}/>`;
const circ = (cx, cy, r, attrs) => `<circle cx="${n1(cx)}" cy="${n1(cy)}" r="${n1(r)}" ${attrs}/>`;
const path = (d, attrs) => `<path d="${d}" ${attrs}/>`;
const P = (...pts) => pts.map((v) => (typeof v === 'number' ? n1(v) : v)).join(' ');
/** Mirror a left-side shape around x = 512. */
const MIRROR = `matrix(-1 0 0 1 ${2 * CX} 0)`;
const mirror = (s) => `${s}<g transform="${MIRROR}">${s}</g>`;

/** Rounded "mochi" head path. */
function headPath(g, { squash = 0 } = {}) {
  const { cx, top, bottom, rx, H } = g;
  const mid = top + H * (0.56 + squash);
  return `M${P(cx - rx, mid)} C${P(cx - rx, top + H * 0.14, cx - rx * 0.6, top, cx, top)} C${P(cx + rx * 0.6, top, cx + rx, top + H * 0.14, cx + rx, mid)} C${P(cx + rx, bottom - H * 0.08, cx + rx * 0.62, bottom, cx, bottom)} C${P(cx - rx * 0.62, bottom, cx - rx, bottom - H * 0.08, cx - rx, mid)}Z`;
}

/** Small bell body from the neck to the feet. */
function bodyPath(g, { wide = 1, belly = 0 } = {}) {
  const { cx, bodyTop, bw: bw0, H } = g;
  const bw = bw0 * wide;
  const w0 = bw * 0.7;
  const yb = F - H * 0.03;
  const k = 1.0 + belly;
  return `M${P(cx - w0, bodyTop)} C${P(cx - bw * k, bodyTop + (yb - bodyTop) * 0.42, cx - bw * (k + 0.1), yb - H * 0.1, cx - bw * 0.9, yb - H * 0.012)} Q${P(cx - bw * 0.8, yb + H * 0.006, cx - bw * 0.5, yb)} L${P(cx + bw * 0.5, yb)} Q${P(cx + bw * 0.8, yb + H * 0.006, cx + bw * 0.9, yb - H * 0.012)} C${P(cx + bw * (k + 0.1), yb - H * 0.1, cx + bw * k, bodyTop + (yb - bodyTop) * 0.42, cx + w0, bodyTop)}Z`;
}

/** A stubby arm (capsule) from the shoulder to the hand. */
function armShape(C, [sx, sy], [hx, hy], w, fill = C.body) {
  const dx = hx - sx;
  const dy = hy - sy;
  const len = Math.hypot(dx, dy) + w * 0.6;
  const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
  const mx = (sx + hx) / 2 + (dx / Math.max(1, Math.hypot(dx, dy))) * w * 0.15;
  const my = (sy + hy) / 2 + (dy / Math.max(1, Math.hypot(dx, dy))) * w * 0.15;
  return `<ellipse cx="${n1(mx)}" cy="${n1(my)}" rx="${n1(len / 2)}" ry="${n1(w / 2)}" transform="rotate(${n1(ang)} ${n1(mx)} ${n1(my)})" ${ln(C, fill)}/>`;
}

// ---------- features per roster id / species (data-driven fallbacks by ear type) ----------
const FEATURES = {
  chiikawa: { mouth: 'small' },
  hachiware: { cap: 'hachiware', mouth: 'cat' },
  usagi: { mouth: 'grin', eyes: 'wide' },
  // Momonga: big glossy eyes looking up (pleading), a pale sky-blue nose, a big fluffy sky-blue plume of a tail; no membrane
  momonga: { eyes: 'pleading', nose: 'accent', tail: 'momonga', mouth: 'omega' },
  kurimanju: { cap: 'bun', eyes: 'content', mouth: 'content' },
  rakko: { muzzle: true, mouth: 'smile', tall: true },
  shisa: { mane: true, mouth: 'grin' },
  pochette: { pouchBag: true, mouth: 'small' },
  // NPC friends (original species; colours from npcs.json: penguin body = dark, accent = white face / belly …)
  penguin: { faceMask: true, beak: 'penguin', belly: true, feetColor: 'extra' },
  hamster: { lowerFace: true, cheeks: true, mouth: 'cat' },
  duckling: { beak: 'duck', tuft: true, feetColor: 'accent', ears: 'none' },
  panda: { patches: true, darkLimbs: true, mouth: 'cat' },
  squirrel: { tail: 'squirrel', tailColor: 'extra', muzzle: 'accent', mouth: 'small' },
  lamb: { wool: true, mouth: 'small' },
  frog: { frogEyes: true, mouth: 'wide', belly: true },
  bear_cub: { muzzle: 'accent', mouth: 'cat' },
  bear: { muzzle: 'accent', mouth: 'cat' },
  fox: { muzzle: 'fox', tail: 'fox', mouth: 'cat' },
  owl: { eyeRings: true, beak: 'owl', bellyMarks: true },
};
const EAR_FEATURES = { lion: { mane: true }, squirrel: { tail: 'fluffy' }, tall: { tail: 'momonga', nose: 'accent' }, pouch: { pouchBag: true }, bun: { cap: 'bun' }, otter: { muzzle: true } };

function featuresOf(id, ears, data) {
  return { ...(EAR_FEATURES[ears] ?? {}), ...(FEATURES[id] ?? {}), ...(isObj(data) ? data : {}) };
}

// ---------- ears ----------
function earsSvg(g, C, type, ft, tf = () => '') {
  const { cx, top, rx, H } = g;
  const inner = shade(C.blush, 0.25);
  const ear = (side, body) => {
    const t = tf(`ear${side}`, [body.px, body.py]);
    return `<g data-rig="ear${side}" data-px="${n1(body.px)}" data-py="${n1(body.py)}"${t ? ` transform="${t}"` : ''}><g class="ch-ear-i${body.droop ? ' droop' : ''}">${body.svg}</g></g>`;
  };
  const pair = (mk) => ear('L', mk(-1)) + ear('R', mk(1));
  switch (type) {
    case 'none':
    case 'frog':
      return '';
    case 'fox':
    case 'cat': {
      const fill = ft.cap === 'hachiware' ? C.accent : C.body;
      return pair((s) => {
        const bx1 = cx + s * rx * 0.3;
        const bx2 = cx + s * rx * 0.9;
        const by = top + H * 0.2;
        const tipx = cx + s * rx * 0.74;
        const tipy = top - H * 0.17;
        const svg =
          path(`M${P(bx1, top + H * 0.06)} Q${P(tipx - s * rx * 0.12, tipy + H * 0.02, tipx, tipy)} Q${P(tipx + s * rx * 0.1, tipy + H * 0.06, bx2, by)}Z`, ln(C, fill)) +
          path(`M${P(cx + s * rx * 0.42, top + H * 0.08)} Q${P(tipx - s * rx * 0.06, tipy + H * 0.12, tipx, tipy + H * 0.09)} Q${P(tipx + s * rx * 0.04, tipy + H * 0.16, cx + s * rx * 0.78, top + H * 0.17)}Z`, `fill="${ft.cap === 'hachiware' ? shade(C.accent, 0.35) : inner}" stroke="none"`) +
          (ft.muzzle === 'fox' || type === 'fox' ? path(`M${P(tipx - s * rx * 0.06, tipy + H * 0.06)} L${P(tipx, tipy)} L${P(tipx + s * rx * 0.07, tipy + H * 0.07)}Z`, `fill="${C.line}" stroke="none"`) : '');
        return { px: cx + s * rx * 0.6, py: top + H * 0.14, svg };
      });
    }
    case 'rabbit':
      return pair((s) => {
        const ecx = cx + s * rx * 0.3;
        const ecy = top - H * 0.17;
        const rot = s * 7;
        const svg =
          `<g transform="rotate(${rot} ${n1(ecx)} ${n1(top + H * 0.1)})">` +
          ell(ecx, ecy, H * 0.105, H * 0.34, ln(C, C.body)) +
          ell(ecx, ecy + H * 0.04, H * 0.045, H * 0.24, `fill="${inner}" stroke="none" opacity=".8"`) +
          '</g>';
        return { px: ecx, py: top + H * 0.1, svg };
      });
    case 'tall':
      // tall pointed ears standing up and slanting a little outward (Momonga), the inside in `accent`
      return pair((s) => {
        const tx = cx + s * rx * 0.68;
        const ty = top - H * 0.31;
        const svg =
          path(`M${P(cx + s * rx * 0.18, top + H * 0.12)} C${P(cx + s * rx * 0.2, top - H * 0.06, tx - s * rx * 0.16, ty + H * 0.05, tx, ty)} C${P(tx + s * rx * 0.13, ty + H * 0.13, cx + s * rx * 0.84, top + H * 0.02, cx + s * rx * 0.76, top + H * 0.2)}Z`, ln(C, C.body)) +
          path(`M${P(cx + s * rx * 0.3, top + H * 0.1)} C${P(cx + s * rx * 0.32, top - H * 0.02, tx - s * rx * 0.1, ty + H * 0.12, tx - s * rx * 0.01, ty + H * 0.1)} C${P(tx + s * rx * 0.07, ty + H * 0.18, cx + s * rx * 0.72, top + H * 0.04, cx + s * rx * 0.66, top + H * 0.15)}Z`, `fill="${C.accent ?? inner}" stroke="none"`);
        return { px: cx + s * rx * 0.46, py: top + H * 0.14, svg };
      });
    case 'squirrel':
      return pair((s) => {
        const ecx = cx + s * rx * 0.6;
        const ecy = top + H * 0.02;
        const svg =
          path(`M${P(ecx - s * H * 0.12, ecy + H * 0.12)} Q${P(ecx - s * H * 0.12, ecy - H * 0.12, ecx + s * H * 0.02, ecy - H * 0.14)} Q${P(ecx + s * H * 0.14, ecy - H * 0.06, ecx + s * H * 0.12, ecy + H * 0.12)}Z`, ln(C, C.body)) +
          ell(ecx, ecy + H * 0.01, H * 0.045, H * 0.06, `fill="${inner}" stroke="none"`);
        return { px: ecx, py: ecy + H * 0.1, svg };
      });
    case 'bun':
      return pair((s) => {
        const ecx = cx + s * rx * 0.52;
        const ecy = top + H * 0.06;
        return { px: ecx, py: ecy + H * 0.05, svg: circ(ecx, ecy, H * 0.07, ln(C, C.accent ?? C.body)) };
      });
    case 'otter':
      return pair((s) => {
        const ecx = cx + s * rx * 0.88;
        const ecy = top + H * 0.17;
        return { px: ecx, py: ecy + H * 0.04, svg: circ(ecx, ecy, H * 0.075, ln(C, C.body)) + circ(ecx + s * H * 0.005, ecy + H * 0.005, H * 0.035, `fill="${shade(C.accent ?? C.body, 0.2)}" stroke="none"`) };
      });
    case 'lion':
      return pair((s) => {
        const ecx = cx + s * rx * 0.58;
        const ecy = top + H * 0.02;
        return { px: ecx, py: ecy + H * 0.06, svg: ell(ecx, ecy, H * 0.08, H * 0.075, ln(C, C.body)) + ell(ecx, ecy + 6, H * 0.04, H * 0.035, `fill="${inner}" stroke="none"`) };
      });
    case 'pouch':
      return pair((s) => {
        // soft drooping ears hanging beside the head (pouch-like)
        const ex0 = cx + s * rx * 0.7;
        const ey0 = top + H * 0.12;
        const svg = path(
          `M${P(ex0 - s * H * 0.08, ey0)} C${P(ex0 + s * H * 0.22, ey0 - H * 0.08, ex0 + s * H * 0.3, ey0 + H * 0.2, ex0 + s * H * 0.2, ey0 + H * 0.36)} C${P(ex0 + s * H * 0.12, ey0 + H * 0.44, ex0 + s * H * 0.02, ey0 + H * 0.3, ex0 + s * H * 0.04, ey0 + H * 0.12)}Z`,
          ln(C, C.accent ? shade(C.accent, 0.55) : C.body),
        );
        return { px: ex0, py: ey0, svg, droop: true };
      });
    case 'lamb':
      return pair((s) => {
        const ecx = cx + s * rx * 0.98;
        const ecy = top + H * 0.36;
        return { px: cx + s * rx * 0.85, py: ecy, svg: ell(ecx, ecy, H * 0.12, H * 0.055, `${ln(C, C.body)} transform="rotate(${s * 22} ${n1(ecx)} ${n1(ecy)})"`), droop: true };
      });
    case 'tuft':
      return pair((s) => {
        const b = cx + s * rx * 0.62;
        return { px: b, py: top + H * 0.1, svg: path(`M${P(b - s * H * 0.08, top + H * 0.1)} L${P(b + s * H * 0.08, top - H * 0.1)} L${P(b + s * H * 0.1, top + H * 0.14)}Z`, ln(C, shade(C.body, -0.12))) };
      });
    default: // nub / round (+ unknown)
      return pair((s) => {
        const ecx = cx + s * rx * (type === 'round' ? 0.66 : 0.62);
        const ecy = top + H * (type === 'round' ? 0.06 : 0.08);
        const fill = ft.patches || ft.darkLimbs ? C.accent : C.body;
        return { px: ecx, py: ecy + H * 0.06, svg: circ(ecx, ecy, H * 0.085, ln(C, fill)) + (ft.patches ? '' : circ(ecx, ecy + 4, H * 0.038, `fill="${inner}" stroke="none" opacity=".75"`)) };
      });
  }
}

// ---------- head decorations ----------
function headDecor(g, C, ft) {
  const { cx, top, H, rx } = g;
  let out = '';
  if (ft.cap === 'hachiware') {
    // the classic split cap: dark top with a white inverted V down the forehead
    out += path(
      `M${P(cx - rx * 0.98, top + H * 0.42)} C${P(cx - rx, top + H * 0.12, cx - rx * 0.6, top, cx, top)} C${P(cx + rx * 0.6, top, cx + rx, top + H * 0.12, cx + rx * 0.98, top + H * 0.42)} C${P(cx + rx * 0.7, top + H * 0.3, cx + rx * 0.3, top + H * 0.28, cx + rx * 0.08, top + H * 0.36)} L${P(cx, top + H * 0.18)} L${P(cx - rx * 0.08, top + H * 0.36)} C${P(cx - rx * 0.3, top + H * 0.28, cx - rx * 0.7, top + H * 0.3, cx - rx * 0.98, top + H * 0.42)}Z`,
      `fill="${C.accent}" stroke="none"`,
    );
  } else if (ft.cap === 'bun') {
    out += path(`M${P(cx - rx * 0.97, top + H * 0.36)} C${P(cx - rx, top + H * 0.1, cx - rx * 0.6, top, cx, top)} C${P(cx + rx * 0.6, top, cx + rx, top + H * 0.1, cx + rx * 0.97, top + H * 0.36)} Q${P(cx + rx * 0.5, top + H * 0.26, cx, top + H * 0.3)} Q${P(cx - rx * 0.5, top + H * 0.26, cx - rx * 0.97, top + H * 0.36)}Z`, `fill="${C.accent}" stroke="none"`);
    out += ell(cx - rx * 0.3, top + H * 0.11, rx * 0.16, H * 0.03, `fill="#fff" fill-opacity=".28" stroke="none"`);
  } else if (ft.faceMask) {
    // a white heart-shaped face on a dark head (penguin)
    out += path(`M${P(cx, top + H * 0.3)} C${P(cx - rx * 0.25, top + H * 0.14, cx - rx * 0.92, top + H * 0.2, cx - rx * 0.88, top + H * 0.62)} C${P(cx - rx * 0.8, g.bottom - H * 0.04, cx - rx * 0.3, g.bottom - H * 0.01, cx, g.bottom - H * 0.01)} C${P(cx + rx * 0.3, g.bottom - H * 0.01, cx + rx * 0.8, g.bottom - H * 0.04, cx + rx * 0.88, top + H * 0.62)} C${P(cx + rx * 0.92, top + H * 0.2, cx + rx * 0.25, top + H * 0.14, cx, top + H * 0.3)}Z`, `fill="${C.accent ?? '#ffffff'}" stroke="none"`);
  } else if (ft.cap === 'penguin') {
    out += path(`M${P(cx - rx * 0.99, top + H * 0.62)} C${P(cx - rx, top + H * 0.1, cx - rx * 0.6, top, cx, top)} C${P(cx + rx * 0.6, top, cx + rx, top + H * 0.1, cx + rx * 0.99, top + H * 0.62)} C${P(cx + rx * 0.75, top + H * 0.3, cx + rx * 0.2, top + H * 0.3, cx, top + H * 0.42)} C${P(cx - rx * 0.2, top + H * 0.3, cx - rx * 0.75, top + H * 0.3, cx - rx * 0.99, top + H * 0.62)}Z`, `fill="${C.accent}" stroke="none"`);
  } else if (ft.cap === 'hamster') {
    out += path(`M${P(cx - rx * 0.98, top + H * 0.46)} C${P(cx - rx, top + H * 0.1, cx - rx * 0.6, top, cx, top)} C${P(cx + rx * 0.6, top, cx + rx, top + H * 0.1, cx + rx * 0.98, top + H * 0.46)} Q${P(cx + rx * 0.5, top + H * 0.3, cx + rx * 0.2, top + H * 0.42)} Q${P(cx, top + H * 0.24, cx - rx * 0.2, top + H * 0.42)} Q${P(cx - rx * 0.5, top + H * 0.3, cx - rx * 0.98, top + H * 0.46)}Z`, `fill="${C.accent}" stroke="none"`);
  }
  if (ft.lowerFace) {
    out += path(`M${P(cx - rx * 0.97, g.cy + H * 0.12)} Q${P(cx - rx * 0.45, g.ey - H * 0.02, cx, g.ey + H * 0.06)} Q${P(cx + rx * 0.45, g.ey - H * 0.02, cx + rx * 0.97, g.cy + H * 0.12)} C${P(cx + rx * 0.9, g.bottom - H * 0.02, cx + rx * 0.4, g.bottom, cx, g.bottom)} C${P(cx - rx * 0.4, g.bottom, cx - rx * 0.9, g.bottom - H * 0.02, cx - rx * 0.97, g.cy + H * 0.12)}Z`, `fill="${C.accent ?? '#ffffff'}" stroke="none"`);
  }
  if (ft.patches) {
    out += mirror(ell(cx - g.ex, g.ey + H * 0.01, H * 0.085, H * 0.11, `fill="${C.accent}" stroke="none" transform="rotate(25 ${n1(cx - g.ex)} ${n1(g.ey)})"`));
  }
  if (ft.muzzle) {
    const fill = (ft.muzzle === 'fox' || ft.muzzle === 'accent') && C.accent ? C.accent : shade(C.body, 0.42);
    if (ft.muzzle === 'fox') {
      out += path(`M${P(cx - rx * 0.98, g.cy + H * 0.12)} Q${P(cx - rx * 0.4, g.ey + H * 0.05, cx, g.mouthY - H * 0.05)} Q${P(cx + rx * 0.4, g.ey + H * 0.05, cx + rx * 0.98, g.cy + H * 0.12)} C${P(cx + rx * 0.9, g.bottom - H * 0.02, cx + rx * 0.4, g.bottom, cx, g.bottom)} C${P(cx - rx * 0.4, g.bottom, cx - rx * 0.9, g.bottom - H * 0.02, cx - rx * 0.98, g.cy + H * 0.12)}Z`, `fill="${fill}" stroke="none"`);
    } else {
      out += ell(cx, g.mouthY + H * 0.015, rx * 0.26, H * 0.075, `fill="${fill}" stroke="none"`);
    }
  }
  if (ft.eyeRings) out += mirror(circ(cx - g.ex, g.ey, H * 0.1, `fill="${C.accent}" stroke="${C.line}" stroke-width="${n1(C.lw * 0.6)}"`));
  if (ft.frogEyes) out += mirror(circ(cx - rx * 0.5, top + H * 0.06, H * 0.13, ln(C, C.body)));
  if (ft.wool) {
    const bumps = [];
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      bumps.push(circ(cx - rx * 0.78 + t * rx * 1.56, top + H * (0.08 + 0.1 * Math.abs(t - 0.5) * 2), H * 0.11, ln(C, C.body, C.lw * 0.8)));
    }
    out += bumps.join('');
  }
  if (ft.tuft) out += path(`M${P(cx - H * 0.02, top + H * 0.02)} Q${P(cx - H * 0.08, top - H * 0.12, cx - H * 0.02, top - H * 0.14)} M${P(cx + H * 0.01, top + H * 0.02)} Q${P(cx + H * 0.06, top - H * 0.1, cx + H * 0.1, top - H * 0.1)}`, ln(C, 'none', C.lw * 1.3));
  if (ft.cheeks) out += mirror(ell(cx - rx * 0.78, g.blush.y + H * 0.04, H * 0.1, H * 0.085, `fill="${shade(C.body, -0.04)}" stroke="none"`));
  return out;
}

function maneSvg(g, C) {
  const { cx, cy, rx, H } = g;
  const n = 14;
  const bumps = [];
  const rr = H * 0.12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    bumps.push(circ(cx + Math.cos(a) * rx * 0.96, cy + Math.sin(a) * H * 0.5, rr, ln(C, C.accent)));
  }
  return `<g class="ch-mane">${bumps.join('')}${ell(cx, cy, rx * 0.96, H * 0.5, `fill="${C.accent}" stroke="none"`)}</g>`;
}

// ---------- faces ----------
const EYE_HL = '#ffffff';

/** Open eyes (style: dot | big | wide | content | penguin-ish handled by colours). */
function eyesOpen(g, C, ft, { look = 0 } = {}) {
  const { cx, ex, ey, er, ery } = g;
  const style = ft.eyes ?? 'dot';
  if (style === 'content') return mirror(path(`M${P(cx - ex - er * 1.6, ey + er * 0.2)} Q${P(cx - ex, ey + er * 2, cx - ex + er * 1.6, ey + er * 0.2)}`, `fill="none" stroke="${C.line}" stroke-width="${n1(C.lw * 1.25)}" stroke-linecap="round"`));
  const eyeFill = ft.patches ? '#2b2522' : C.eye;
  if (style === 'pleading') {
    // Momonga's "please notice me" eyes: big round glossy eyes looking up — the darkest part high in the eye, a glossy
    // lighter bottom, two big sparkles + a tiny one, a thin upper-lid line hugging the top
    const R = er * 2.75;
    const Ry = ery * 2.3;
    const gloss = C.accent ? shade(C.accent, -0.3) : '#8aa0c0';
    const one = (x0) => {
      const x = x0 + look;
      return (
        ell(x, ey, R, Ry, `fill="${eyeFill}"`) +
        ell(x, ey + Ry * 0.5, R * 0.7, Ry * 0.4, `fill="${gloss}" fill-opacity=".55"`) +
        circ(x - R * 0.26, ey - Ry * 0.4, R * 0.44, `fill="${EYE_HL}"`) +
        circ(x + R * 0.4, ey - Ry * 0.08, R * 0.19, `fill="${EYE_HL}"`) +
        circ(x + R * 0.16, ey + Ry * 0.56, R * 0.11, `fill="${EYE_HL}" fill-opacity=".9"`) +
        path(`M${P(x - R * 1.08, ey - Ry * 0.3)} Q${P(x, ey - Ry * 1.78, x + R * 1.08, ey - Ry * 0.3)}`, `fill="none" stroke="${C.line}" stroke-width="${n1(C.lw * 0.7)}" stroke-linecap="round"`)
      );
    };
    return one(cx - ex) + one(cx + ex);
  }
  const k = style === 'big' ? 1.45 : style === 'wide' ? 1.1 : 1;
  const one = (x) =>
    ell(x + look, ey, er * k, ery * k, `fill="${eyeFill}"`) +
    circ(x + look - er * 0.32 * k, ey - ery * 0.38 * k, er * 0.42 * k, `fill="${EYE_HL}"`) +
    (style === 'big' ? circ(x + look + er * 0.35 * k, ey + ery * 0.35 * k, er * 0.2 * k, `fill="${EYE_HL}"`) : '');
  return one(cx - ex) + one(cx + ex);
}

/** Closed eyes (blink): soft arcs. */
function eyesClosed(g, C, { happy = false } = {}) {
  const { cx, ex, ey, er } = g;
  const d = happy ? `M${P(cx - ex - er * 1.5, ey + er * 0.5)} Q${P(cx - ex, ey - er * 1.8, cx - ex + er * 1.5, ey + er * 0.5)}` : `M${P(cx - ex - er * 1.4, ey)} Q${P(cx - ex, ey + er * 1.3, cx - ex + er * 1.4, ey)}`;
  return mirror(path(d, `fill="none" stroke="${C.line}" stroke-width="${n1(C.lw * 1.3)}" stroke-linecap="round"`));
}

function blushSvg(g, C, { strong = false } = {}) {
  const { cx, blush: b } = g;
  const lines = [0, 1, 2]
    .map((i) => {
      const x = cx - b.x - b.rx * 0.45 + i * b.rx * 0.42;
      return `M${P(x, b.y + b.ry * 0.4)} L${P(x + b.rx * 0.22, b.y - b.ry * 0.4)}`;
    })
    .join(' ');
  return mirror(ell(cx - b.x, b.y, b.rx * (strong ? 1.15 : 1), b.ry * (strong ? 1.15 : 1), `fill="${C.blush}" fill-opacity="${strong ? 0.85 : 0.6}"`) + path(lines, `fill="none" stroke="${shade(C.blush, -0.3)}" stroke-width="${n1(C.lw * 0.55)}" stroke-linecap="round" opacity=".7"`));
}

const TONGUE = '#ff8b98';
const MOUTH_IN = '#7a3a3a';

/** Closed / resting mouth by style. */
function mouthClosed(g, C, ft) {
  const { cx, mouthY: my, H } = g;
  const w = H * 0.05;
  const stroke = `fill="none" stroke="${C.line}" stroke-width="${n1(C.lw * 1.05)}" stroke-linecap="round" stroke-linejoin="round"`;
  if (ft.beak) return beakSvg(g, C, ft, false);
  switch (ft.mouth) {
    case 'cat':
      return path(`M${P(cx - w * 1.4, my - w * 0.3)} Q${P(cx - w * 0.7, my + w * 0.9, cx, my - w * 0.1)} Q${P(cx + w * 0.7, my + w * 0.9, cx + w * 1.4, my - w * 0.3)}`, stroke);
    case 'omega': {
      // a tiny ω (Momonga)
      const v = w * 0.62;
      return path(`M${P(cx - v * 1.5, my - v * 0.2)} Q${P(cx - v * 0.75, my + v * 1.3, cx, my - v * 0.1)} Q${P(cx + v * 0.75, my + v * 1.3, cx + v * 1.5, my - v * 0.2)}`, stroke);
    }
    case 'grin':
      return path(`M${P(cx - w * 2.2, my - w * 0.4)} Q${P(cx, my + w * 0.4, cx + w * 2.2, my - w * 0.4)} Q${P(cx + w * 1.6, my + w * 2.8, cx, my + w * 2.8)} Q${P(cx - w * 1.6, my + w * 2.8, cx - w * 2.2, my - w * 0.4)}Z`, `${ln(C, MOUTH_IN, C.lw)}`) + ell(cx, my + w * 1.9, w * 1.1, w * 0.7, `fill="${TONGUE}"`);
    case 'wide':
      return path(`M${P(cx - w * 3, my - w * 0.6)} Q${P(cx, my + w * 1.6, cx + w * 3, my - w * 0.6)}`, stroke);
    case 'content':
      return path(`M${P(cx - w * 0.9, my)} Q${P(cx, my + w * 0.8, cx + w * 0.9, my)}`, stroke);
    case 'smile':
      return path(`M${P(cx - w * 1.3, my - w * 0.2)} Q${P(cx, my + w * 1.3, cx + w * 1.3, my - w * 0.2)}`, stroke);
    default: // small: a tiny open mouth
      return path(`M${P(cx - w * 0.9, my - w * 0.2)} Q${P(cx, my + w * 0.25, cx + w * 0.9, my - w * 0.2)} Q${P(cx + w * 0.5, my + w * 1.35, cx, my + w * 1.35)} Q${P(cx - w * 0.5, my + w * 1.35, cx - w * 0.9, my - w * 0.2)}Z`, ln(C, MOUTH_IN, C.lw * 0.9)) + ell(cx, my + w * 0.95, w * 0.42, w * 0.28, `fill="${TONGUE}"`);
  }
}

/** Open mouth (talking / cheering). */
function mouthOpen(g, C, ft, { big = 1 } = {}) {
  const { cx, mouthY: my, H } = g;
  if (ft.beak) return beakSvg(g, C, ft, true);
  const w = H * 0.05 * big;
  return path(`M${P(cx - w * 1.3, my - w * 0.3)} Q${P(cx, my, cx + w * 1.3, my - w * 0.3)} Q${P(cx + w * 1.1, my + w * 2.1, cx, my + w * 2.1)} Q${P(cx - w * 1.1, my + w * 2.1, cx - w * 1.3, my - w * 0.3)}Z`, ln(C, MOUTH_IN, C.lw * 0.95)) + ell(cx, my + w * 1.45, w * 0.7, w * 0.42, `fill="${TONGUE}"`);
}

function beakSvg(g, C, ft, open) {
  const { cx, mouthY: my, H } = g;
  const col = ft.beak === 'owl' || ft.beak === 'penguin' ? C.extra ?? '#ffb547' : C.accent ?? '#ff9f2e';
  const w = H * (ft.beak === 'duck' ? 0.1 : 0.06);
  if (ft.beak === 'duck') {
    return ell(cx, my - H * 0.01, w, w * 0.45, ln(C, col)) + (open ? ell(cx, my + w * 0.4, w * 0.8, w * 0.35, ln(C, shade(col, -0.15))) : path(`M${P(cx - w * 0.7, my)} L${P(cx + w * 0.7, my)}`, `stroke="${C.line}" stroke-width="${n1(C.lw * 0.7)}"`));
  }
  const tip = open ? w * 1.4 : w * 1.1;
  return path(`M${P(cx - w, my - w * 0.6)} L${P(cx + w, my - w * 0.6)} L${P(cx, my + tip)}Z`, ln(C, col)) + (open ? path(`M${P(cx - w * 0.7, my + w * 0.05)} L${P(cx + w * 0.7, my + w * 0.05)}`, `stroke="${C.line}" stroke-width="${n1(C.lw * 0.7)}"`) : '');
}

/**
 * The face group for an expression: blush, eyes (open `.ch-eo` + closed `.ch-ec`), mouth (closed `.ch-mc` + open
 * `.ch-mo`) and extras (tear streams, sweat drop, shock lines, angry mark, love hearts).
 */
function faceSvg(g, C, ft, expression) {
  const { cx, ex, ey, er, ery, H, rx, top } = g;
  const e = CHARA_EXPRESSIONS.includes(expression) ? expression : 'neutral';
  let eo = eyesOpen(g, C, ft);
  let ec = eyesClosed(g, C);
  let mc = mouthClosed(g, C, ft);
  let mo = mouthOpen(g, C, ft);
  let extra = '';
  let strongBlush = false;
  const stroke = (w = 1) => `fill="none" stroke="${C.line}" stroke-width="${n1(C.lw * w)}" stroke-linecap="round" stroke-linejoin="round"`;
  switch (e) {
    case 'joy':
      eo = ec = eyesClosed(g, C, { happy: true });
      mc = mouthOpen(g, C, ft, { big: 1.25 });
      mo = mouthOpen(g, C, ft, { big: 1.45 });
      break;
    case 'cry': {
      // Chiikawa's crying face: eyes squeezed into wobbly arcs, tears streaming, mouth wobbling open
      const squeeze = (x, s) => `M${P(x - s * er * 1.6, ey - er * 0.4)} L${P(x + s * er * 0.9, ey + er * 0.2)} L${P(x - s * er * 1.4, ey + er * 1.1)}`;
      eo = ec = path(squeeze(cx - ex, 1) + ' ' + squeeze(cx + ex, -1), stroke(1.25));
      const stream = (x, s) => path(`M${P(x - er * 0.4, ey + er * 1.2)} C${P(x - s * er * 0.6, ey + H * 0.14, x + s * er * 0.2, ey + H * 0.22, x - s * er * 0.3, ey + H * 0.3)} L${P(x + s * er * 1.2, ey + H * 0.3)} C${P(x + s * er * 1.4, ey + H * 0.2, x + s * er * 0.5, ey + H * 0.14, x + er * 0.9, ey + er * 1.2)}Z`, `fill="#9fd6ff" fill-opacity=".85" stroke="#5b8fd9" stroke-width="${n1(C.lw * 0.6)}"`);
      extra += stream(cx - ex, -1) + stream(cx + ex, 1);
      const w = H * 0.055;
      const my = g.mouthY + H * 0.01;
      mc = mo = path(`M${P(cx - w * 1.5, my)} Q${P(cx - w * 0.75, my - w * 0.7, cx, my)} Q${P(cx + w * 0.75, my - w * 0.7, cx + w * 1.5, my)} Q${P(cx + w * 1.2, my + w * 2, cx, my + w * 2)} Q${P(cx - w * 1.2, my + w * 2, cx - w * 1.5, my)}Z`, ln(C, MOUTH_IN, C.lw * 0.95));
      strongBlush = true;
      break;
    }
    case 'shock': {
      const one = (x) => circ(x, ey, er * 1.7, `fill="#fff" stroke="${C.line}" stroke-width="${n1(C.lw * 0.9)}"`) + circ(x, ey, er * 0.45, `fill="${C.eye}"`);
      eo = ec = one(cx - ex) + one(cx + ex);
      const w = H * 0.045;
      mc = mo = ell(cx, g.mouthY + w * 0.6, w * 0.9, w * 1.2, ln(C, MOUTH_IN, C.lw * 0.9));
      extra += [-1, 0, 1].map((i) => path(`M${P(cx + i * rx * 0.18, top + H * 0.08 - Math.abs(i) * H * 0.02)} L${P(cx + i * rx * 0.2, top + H * 0.2)}`, `stroke="#6aa6e6" stroke-width="${n1(C.lw * 1.2)}" stroke-linecap="round"`)).join('');
      break;
    }
    case 'angry': {
      extra += mirror(path(`M${P(cx - ex - er * 1.6, ey - ery * 2.1)} L${P(cx - ex + er * 1.4, ey - ery * 1.3)}`, stroke(1.3)));
      const w = H * 0.05;
      mc = path(`M${P(cx - w * 1.3, g.mouthY + w * 0.6)} Q${P(cx, g.mouthY - w * 0.6, cx + w * 1.3, g.mouthY + w * 0.6)}`, stroke(1.05));
      // a little anger mark on the forehead
      const ax = cx + rx * 0.55;
      const ay = top + H * 0.2;
      const r = H * 0.035;
      extra += path(`M${P(ax - r, ay - r * 0.3)} Q${P(ax - r * 0.2, ay - r * 0.2, ax - r * 0.3, ay - r)} M${P(ax + r, ay - r * 0.3)} Q${P(ax + r * 0.2, ay - r * 0.2, ax + r * 0.3, ay - r)} M${P(ax - r, ay + r * 0.3)} Q${P(ax - r * 0.2, ay + r * 0.2, ax - r * 0.3, ay + r)} M${P(ax + r, ay + r * 0.3)} Q${P(ax + r * 0.2, ay + r * 0.2, ax + r * 0.3, ay + r)}`, `fill="none" stroke="#e0485a" stroke-width="${n1(C.lw * 1.1)}" stroke-linecap="round"`);
      break;
    }
    case 'love': {
      const heart = (x) => {
        const s = er * 1.5;
        return path(`M${P(x, ey + s * 0.9)} C${P(x - s * 1.6, ey - s * 0.1, x - s * 0.9, ey - s * 1.3, x, ey - s * 0.4)} C${P(x + s * 0.9, ey - s * 1.3, x + s * 1.6, ey - s * 0.1, x, ey + s * 0.9)}Z`, `fill="#ff5c8a" stroke="${shade('#ff5c8a', -0.35)}" stroke-width="${n1(C.lw * 0.6)}"`);
      };
      eo = ec = heart(cx - ex) + heart(cx + ex);
      mc = mouthOpen(g, C, ft, { big: 1.1 });
      strongBlush = true;
      break;
    }
    case 'sweat': {
      const w = H * 0.05;
      mc = path(`M${P(cx - w * 1.6, g.mouthY + w * 0.3)} Q${P(cx - w * 0.8, g.mouthY - w * 0.5, cx, g.mouthY + w * 0.3)} Q${P(cx + w * 0.8, g.mouthY + w * 1.1, cx + w * 1.6, g.mouthY + w * 0.3)}`, stroke(1.05));
      const sx = cx + rx * 0.78;
      const sy = top + H * 0.26;
      const r = H * 0.05;
      extra += path(`M${P(sx, sy - r * 1.6)} C${P(sx + r, sy - r * 0.2, sx + r, sy + r, sx, sy + r)} C${P(sx - r, sy + r, sx - r, sy - r * 0.2, sx, sy - r * 1.6)}Z`, `fill="#bfe6ff" stroke="#5b8fd9" stroke-width="${n1(C.lw * 0.7)}"`);
      break;
    }
    case 'shy': {
      const down = (x) => path(`M${P(x - er * 1.3, ey + er * 0.3)} Q${P(x, ey + er * 1.4, x + er * 1.3, ey + er * 0.3)}`, stroke(1.2));
      eo = down(cx - ex) + down(cx + ex);
      strongBlush = true;
      break;
    }
    default:
      break;
  }
  // a small oval nose between / below the eyes (`nose: 'accent'` = Momonga's pale sky-blue one)
  const nose = ft.nose ? ell(cx, ey + H * 0.064, H * 0.03, H * 0.02, ln(C, ft.nose === 'accent' && C.accent ? C.accent : C.line, C.lw * 0.6)) : '';
  return `<g class="ch-face">${blushSvg(g, C, { strong: strongBlush })}${nose}<g class="ch-eo">${eo}</g><g class="ch-ec" display="none">${ec}</g><g class="ch-mc">${mc}</g><g class="ch-mo" display="none">${mo}</g>${extra}</g>`;
}

// ---------- props ----------
const PC = {
  red: '#ef5b6b', pink: '#ff8fb8', yellow: '#ffd23f', gold: '#f5c542', navy: '#34477a', blue: '#5b9be8', teal: '#5cc2c4', green: '#6cc070',
  white: '#ffffff', brown: '#a46b3f', black: '#33313a', grey: '#a9adb8', purple: '#a679d8', orange: '#ff9f43', cream: '#fff4d6', straw: '#f2d27a',
};

/** Context for prop painters: anchor points + head metrics. */
function propCtx(g, anchors) {
  const a = anchors ?? g.a;
  return {
    head: pt(a.head, g.a.head),
    face: pt(a.face, g.a.face),
    neck: pt(a.neck, g.a.neck),
    handR: pt(a.handR, g.a.handR),
    handL: pt(a.handL, g.a.handL),
    back: pt(a.back, g.a.back),
    rx: g.rx ?? 260,
    H: g.H ?? 450,
    ex: g.ex ?? 100,
    er: g.er ?? 16,
    bw: g.bw ?? 160,
    mouthY: g.mouthY ?? pt(a.face, g.a.face)[1] + 50,
  };
}

const HEAD_PROPS = {
  ribbon: (C, k, col) => {
    const [x0, y0] = k.head;
    const x = x0 + k.rx * 0.42;
    const y = y0 + k.H * 0.07;
    const s = k.H * 0.12;
    const loop = (d) => path(`M${P(x, y)} C${P(x + d * s * 0.6, y - s * 1.1, x + d * s * 1.6, y - s * 0.7, x + d * s * 1.4, y + s * 0.1)} C${P(x + d * s * 1.3, y + s * 0.8, x + d * s * 0.5, y + s * 0.6, x, y)}Z`, ln(C, col));
    return loop(-1) + loop(1) + path(`M${P(x - s * 0.2, y + s * 0.2)} L${P(x - s * 0.6, y + s * 1.1)} M${P(x + s * 0.2, y + s * 0.2)} L${P(x + s * 0.7, y + s * 1)}`, ln(C, 'none', C.lw * 1.6)) + circ(x, y, s * 0.32, ln(C, shade(col, -0.15)));
  },
  flower_pin: (C, k, col) => {
    const [x0, y0] = k.head;
    const x = x0 + k.rx * 0.5;
    const y = y0 + k.H * 0.12;
    const r = k.H * 0.06;
    const petals = [0, 1, 2, 3, 4].map((i) => {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      return circ(x + Math.cos(a) * r * 1.1, y + Math.sin(a) * r * 1.1, r * 0.85, ln(C, col, C.lw * 0.8));
    });
    return petals.join('') + circ(x, y, r * 0.7, ln(C, PC.orange, C.lw * 0.8));
  },
  beanie: (C, k, col) => cap(C, k, col, { band: shade(col, -0.18), pom: '#ffffff' }),
  knit_cap: (C, k, col) => cap(C, k, col, { band: '#f4d7b0', pom: '#f4d7b0', rib: true }),
  straw_hat: (C, k, col) => {
    const [x, y0] = k.head;
    const y = y0 + k.H * 0.1;
    return ell(x, y, k.rx * 1.22, k.H * 0.09, ln(C, col)) + path(`M${P(x - k.rx * 0.6, y)} C${P(x - k.rx * 0.6, y - k.H * 0.3, x + k.rx * 0.6, y - k.H * 0.3, x + k.rx * 0.6, y)}Z`, ln(C, col)) + path(`M${P(x - k.rx * 0.6, y - k.H * 0.05)} Q${P(x, y - k.H * 0.02, x + k.rx * 0.6, y - k.H * 0.05)} L${P(x + k.rx * 0.6, y)} Q${P(x, y + k.H * 0.03, x - k.rx * 0.6, y)}Z`, `fill="${PC.red}" stroke="none"`);
  },
  crown: (C, k, col) => {
    const [x, y0] = k.head;
    const w = k.rx * 0.55;
    const y = y0 + k.H * 0.06;
    const h = k.H * 0.2;
    return path(`M${P(x - w, y)} L${P(x - w, y - h * 0.8)} L${P(x - w * 0.5, y - h * 0.4)} L${P(x, y - h)} L${P(x + w * 0.5, y - h * 0.4)} L${P(x + w, y - h * 0.8)} L${P(x + w, y)}Z`, ln(C, col)) + circ(x, y - h * 0.32, h * 0.13, ln(C, PC.red, C.lw * 0.7)) + circ(x - w * 0.6, y - h * 0.25, h * 0.09, ln(C, PC.blue, C.lw * 0.6)) + circ(x + w * 0.6, y - h * 0.25, h * 0.09, ln(C, PC.green, C.lw * 0.6));
  },
  headband: (C, k, col) => {
    const [x, y0] = k.head;
    const y = y0 + k.H * 0.16;
    return path(`M${P(x - k.rx * 0.92, y + k.H * 0.16)} Q${P(x, y - k.H * 0.2, x + k.rx * 0.92, y + k.H * 0.16)}`, `fill="none" stroke="${col}" stroke-width="${n1(k.H * 0.06)}" stroke-linecap="round"`) + heartPath(C, x + k.rx * 0.42, y - k.H * 0.03, k.H * 0.075, col);
  },
  flower_crown: (C, k, col) => {
    const [x, y0] = k.head;
    const y = y0 + k.H * 0.12;
    const out = [path(`M${P(x - k.rx * 0.82, y + k.H * 0.1)} Q${P(x, y - k.H * 0.14, x + k.rx * 0.82, y + k.H * 0.1)}`, `fill="none" stroke="${PC.green}" stroke-width="${n1(k.H * 0.025)}"`)];
    const cols = [col, '#fff2a8', '#ffffff', col, '#c9b6ff', col, '#fff2a8'];
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const fx = x - k.rx * 0.75 + t * k.rx * 1.5;
      const fy = y + k.H * 0.1 - Math.sin(t * Math.PI) * k.H * 0.12;
      const r = k.H * 0.035;
      for (let j = 0; j < 5; j++) {
        const a = (j / 5) * Math.PI * 2;
        out.push(circ(fx + Math.cos(a) * r, fy + Math.sin(a) * r, r * 0.85, `fill="${cols[i]}" stroke="${C.line}" stroke-width="${n1(C.lw * 0.45)}"`));
      }
      out.push(circ(fx, fy, r * 0.6, `fill="${PC.yellow}"`));
    }
    return out.join('');
  },
  beret: (C, k, col) => {
    const [x, y0] = k.head;
    const y = y0 + k.H * 0.06;
    return `<g transform="rotate(-12 ${n1(x)} ${n1(y)})">${ell(x - k.rx * 0.1, y, k.rx * 0.72, k.H * 0.1, ln(C, col))}${path(`M${P(x - k.rx * 0.1, y - k.H * 0.1)} l${P(0, -k.H * 0.05)}`, ln(C, 'none', C.lw * 1.6))}</g>`;
  },
  party_hat: (C, k, col) => {
    const [x, y0] = k.head;
    const y = y0 + k.H * 0.08;
    const w = k.rx * 0.36;
    const h = k.H * 0.36;
    return `<g transform="rotate(10 ${n1(x)} ${n1(y)})">${path(`M${P(x - w, y)} L${P(x, y - h)} L${P(x + w, y)}Z`, ln(C, col))}${circ(x - w * 0.3, y - h * 0.3, w * 0.13, `fill="${PC.yellow}"`)}${circ(x + w * 0.25, y - h * 0.15, w * 0.12, `fill="${PC.pink}"`)}${circ(x + w * 0.05, y - h * 0.58, w * 0.1, `fill="${PC.red}"`)}${circ(x, y - h, w * 0.24, ln(C, PC.yellow, C.lw * 0.8))}</g>`;
  },
  bonnet: (C, k, col) => {
    const [x, y0] = k.head;
    const y = y0;
    const frill = [];
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI + (i / 8) * Math.PI;
      frill.push(circ(x + Math.cos(a) * k.rx * 0.9, y + k.H * 0.42 + Math.sin(a) * k.H * 0.4, k.H * 0.05, ln(C, '#ffffff', C.lw * 0.7)));
    }
    return path(`M${P(x - k.rx * 0.95, y + k.H * 0.5)} C${P(x - k.rx, y - k.H * 0.05, x + k.rx, y - k.H * 0.05, x + k.rx * 0.95, y + k.H * 0.5)} Q${P(x, y + k.H * 0.18, x - k.rx * 0.95, y + k.H * 0.5)}Z`, ln(C, col)) + frill.join('') + circ(x + k.rx * 0.92, y + k.H * 0.58, k.H * 0.05, ln(C, PC.pink, C.lw * 0.7));
  },
  yellow_hat: (C, k, col) => {
    const [x, y0] = k.head;
    const y = y0 + k.H * 0.2;
    return ell(x, y, k.rx * 0.98, k.H * 0.08, ln(C, col)) + path(`M${P(x - k.rx * 0.78, y)} C${P(x - k.rx * 0.78, y - k.H * 0.36, x + k.rx * 0.78, y - k.H * 0.36, x + k.rx * 0.78, y)}Z`, ln(C, col)) + path(`M${P(x - k.rx * 0.6, y + k.H * 0.06)} Q${P(x - k.rx * 0.7, y + k.H * 0.28, x - k.rx * 0.5, y + k.H * 0.5)}`, ln(C, 'none', C.lw * 0.8));
  },
  school_cap: (C, k, col) => {
    const [x, y0] = k.head;
    const y = y0 + k.H * 0.16;
    return path(`M${P(x - k.rx * 0.78, y)} C${P(x - k.rx * 0.8, y - k.H * 0.3, x + k.rx * 0.8, y - k.H * 0.3, x + k.rx * 0.78, y)}Z`, ln(C, col)) + path(`M${P(x - k.rx * 0.5, y)} Q${P(x, y + k.H * 0.12, x + k.rx * 0.5, y)}Z`, ln(C, PC.black)) + circ(x, y - k.H * 0.1, k.H * 0.035, ln(C, PC.gold, C.lw * 0.6));
  },
  head_mirror: (C, k) => {
    const [x, y0] = k.head;
    const y = y0 + k.H * 0.2;
    return path(`M${P(x - k.rx * 0.9, y + k.H * 0.1)} Q${P(x, y - k.H * 0.22, x + k.rx * 0.9, y + k.H * 0.1)}`, `fill="none" stroke="${PC.black}" stroke-width="${n1(k.H * 0.025)}"`) + circ(x, y - k.H * 0.04, k.H * 0.09, ln(C, '#dfe6ee')) + circ(x - k.H * 0.025, y - k.H * 0.07, k.H * 0.025, `fill="#fff"`);
  },
  chef_hat: (C, k) => {
    const [x, y0] = k.head;
    const y = y0 + k.H * 0.12;
    const w = k.rx * 0.55;
    return path(`M${P(x - w, y)} L${P(x - w, y - k.H * 0.12)} C${P(x - w * 1.5, y - k.H * 0.2, x - w * 1.1, y - k.H * 0.5, x - w * 0.4, y - k.H * 0.38)} C${P(x - w * 0.3, y - k.H * 0.6, x + w * 0.3, y - k.H * 0.6, x + w * 0.4, y - k.H * 0.38)} C${P(x + w * 1.1, y - k.H * 0.5, x + w * 1.5, y - k.H * 0.2, x + w, y - k.H * 0.12)} L${P(x + w, y)}Z`, ln(C, '#ffffff')) + path(`M${P(x - w, y - k.H * 0.06)} L${P(x + w, y - k.H * 0.06)}`, ln(C, 'none', C.lw * 0.7));
  },
  police_cap: (C, k, col) => {
    const [x, y0] = k.head;
    const y = y0 + k.H * 0.14;
    return path(`M${P(x - k.rx * 0.72, y)} L${P(x - k.rx * 0.8, y - k.H * 0.18)} Q${P(x, y - k.H * 0.34, x + k.rx * 0.8, y - k.H * 0.18)} L${P(x + k.rx * 0.72, y)}Z`, ln(C, col)) + path(`M${P(x - k.rx * 0.55, y)} Q${P(x, y + k.H * 0.1, x + k.rx * 0.55, y)}Z`, ln(C, PC.black)) + path(`M${P(x - k.rx * 0.72, y - k.H * 0.03)} L${P(x + k.rx * 0.72, y - k.H * 0.03)}`, `stroke="${PC.gold}" stroke-width="${n1(k.H * 0.02)}"`) + path(`M${P(x, y - k.H * 0.2)} l${P(k.H * 0.04, k.H * 0.05)} l${P(-k.H * 0.04, k.H * 0.05)} l${P(-k.H * 0.04, -k.H * 0.05)}Z`, ln(C, PC.gold, C.lw * 0.6));
  },
  baseball_cap: (C, k, col) => {
    const [x, y0] = k.head;
    const y = y0 + k.H * 0.16;
    return path(`M${P(x - k.rx * 0.8, y)} C${P(x - k.rx * 0.82, y - k.H * 0.32, x + k.rx * 0.82, y - k.H * 0.32, x + k.rx * 0.8, y)}Z`, ln(C, col)) + path(`M${P(x - k.rx * 0.2, y)} Q${P(x + k.rx * 0.5, y + k.H * 0.1, x + k.rx * 1.05, y - k.H * 0.01)} L${P(x + k.rx * 0.6, y - k.H * 0.04)}Z`, ln(C, shade(col, -0.2))) + circ(x, y - k.H * 0.24, k.H * 0.025, `fill="${shade(col, -0.3)}"`);
  },
  fighter_headband: (C, k) => {
    const [x, y0] = k.head;
    const y = y0 + k.H * 0.2;
    return path(`M${P(x - k.rx * 0.97, y + k.H * 0.08)} Q${P(x, y - k.H * 0.08, x + k.rx * 0.97, y + k.H * 0.08)}`, `fill="none" stroke="#ffffff" stroke-width="${n1(k.H * 0.07)}"`) + path(`M${P(x - k.rx * 0.97, y + k.H * 0.08)} Q${P(x, y - k.H * 0.08, x + k.rx * 0.97, y + k.H * 0.08)}`, `fill="none" stroke="${C.line}" stroke-width="${n1(C.lw * 0.6)}"`) + circ(x, y - k.H * 0.005, k.H * 0.025, `fill="${PC.red}"`) + path(`M${P(x + k.rx * 0.95, y + k.H * 0.08)} l${P(k.H * 0.12, k.H * 0.06)} M${P(x + k.rx * 0.95, y + k.H * 0.08)} l${P(k.H * 0.1, k.H * 0.12)}`, `stroke="#fff" stroke-width="${n1(k.H * 0.035)}" stroke-linecap="round"`);
  },
  headset: (C, k) => {
    const [x, y0] = k.head;
    const y = y0 + k.H * 0.05;
    return path(`M${P(x - k.rx * 0.98, y + k.H * 0.35)} C${P(x - k.rx, y - k.H * 0.15, x + k.rx, y - k.H * 0.15, x + k.rx * 0.98, y + k.H * 0.35)}`, `fill="none" stroke="${PC.black}" stroke-width="${n1(k.H * 0.035)}"`) + mirror(ell(x - k.rx * 0.98, y + k.H * 0.38, k.H * 0.06, k.H * 0.09, ln(C, '#7a5cd6'))) + path(`M${P(x + k.rx * 0.98, y + k.H * 0.42)} Q${P(x + k.rx * 0.7, y + k.H * 0.7, x + k.rx * 0.3, y + k.H * 0.68)}`, `fill="none" stroke="${PC.black}" stroke-width="${n1(k.H * 0.018)}"`) + circ(x + k.rx * 0.3, y + k.H * 0.68, k.H * 0.025, `fill="${PC.black}"`);
  },
  space_helmet: (C, k) => {
    const [x, y0] = k.head;
    const cy = y0 + k.H * 0.5;
    return ell(x, cy, k.rx * 1.12, k.H * 0.62, `fill="#cfefff" fill-opacity=".35" stroke="#8fa3b8" stroke-width="${n1(C.lw * 1.4)}"`) + path(`M${P(x - k.rx * 0.8, cy - k.H * 0.3)} Q${P(x - k.rx * 0.6, cy - k.H * 0.5, x - k.rx * 0.2, cy - k.H * 0.55)}`, `fill="none" stroke="#fff" stroke-width="${n1(C.lw * 1.6)}" stroke-linecap="round" opacity=".9"`) + ell(x, cy + k.H * 0.6, k.rx * 0.75, k.H * 0.07, ln(C, '#e6ebf2'));
  },
  // 세계 설정 (치이카와 모드 jobs): 토벌대 / 갑옷씨 helmet, 라멘 「郎」 / 목욕탕 head towel
  armor_helmet: (C, k, col) => {
    const [x, y0] = k.head;
    const y = y0 + k.H * 0.25;
    const dark = shade(col, -0.25);
    const rivets = [-0.62, -0.31, 0.31, 0.62].map((t) => circ(x + t * k.rx, y - k.H * 0.005 + Math.abs(t) * k.H * 0.01, k.H * 0.016, `fill="${shade(col, 0.45)}" stroke="${dark}" stroke-width="${n1(C.lw * 0.4)}"`)).join('');
    return (
      ell(x, y - k.H * 0.45, k.H * 0.045, k.H * 0.085, ln(C, PC.red, C.lw * 0.8, ` transform="rotate(-12 ${n1(x)} ${n1(y - k.H * 0.45)})"`)) +
      path(`M${P(x - k.rx * 0.96, y)} C${P(x - k.rx * 0.98, y - k.H * 0.47, x + k.rx * 0.98, y - k.H * 0.47, x + k.rx * 0.96, y)}Z`, ln(C, col)) +
      path(`M${P(x, y - k.H * 0.37)} L${P(x, y - k.H * 0.04)}`, `stroke="${dark}" stroke-width="${n1(k.H * 0.03)}" stroke-linecap="round"`) +
      path(`M${P(x - k.rx * 0.99, y - k.H * 0.05)} Q${P(x, y - k.H * 0.13, x + k.rx * 0.99, y - k.H * 0.05)} L${P(x + k.rx * 1.0, y + k.H * 0.05)} Q${P(x, y - k.H * 0.03, x - k.rx * 1.0, y + k.H * 0.05)}Z`, ln(C, dark)) +
      rivets +
      path(`M${P(x - k.rx * 0.7, y - k.H * 0.12)} Q${P(x - k.rx * 0.62, y - k.H * 0.3, x - k.rx * 0.3, y - k.H * 0.36)}`, `fill="none" stroke="#fff" stroke-width="${n1(C.lw * 1.5)}" stroke-linecap="round" opacity=".75"`)
    );
  },
  head_towel: (C, k, col) => {
    const [x, y0] = k.head;
    const y = y0 + k.H * 0.2;
    const stripe = '#7fb0dc';
    const kx = x + k.rx * 0.86;
    const ky = y + k.H * 0.02;
    return (
      path(`M${P(x - k.rx * 0.9, y)} C${P(x - k.rx * 0.9, y - k.H * 0.4, x + k.rx * 0.9, y - k.H * 0.4, x + k.rx * 0.9, y)}Z`, ln(C, col)) +
      path(`M${P(x - k.rx * 0.5, y - k.H * 0.22)} Q${P(x, y - k.H * 0.3, x + k.rx * 0.5, y - k.H * 0.22)}`, `fill="none" stroke="${stripe}" stroke-width="${n1(C.lw * 0.9)}" stroke-dasharray="${n1(k.H * 0.03)} ${n1(k.H * 0.02)}"`) +
      path(`M${P(x - k.rx * 0.98, y - k.H * 0.06)} Q${P(x, y - k.H * 0.16, x + k.rx * 0.98, y - k.H * 0.06)} L${P(x + k.rx * 0.98, y + k.H * 0.07)} Q${P(x, y - k.H * 0.03, x - k.rx * 0.98, y + k.H * 0.07)}Z`, ln(C, shade(col, -0.06))) +
      path(`M${P(x - k.rx * 0.9, y - k.H * 0.01)} Q${P(x, y - k.H * 0.1, x + k.rx * 0.9, y - k.H * 0.01)}`, `fill="none" stroke="${stripe}" stroke-width="${n1(C.lw * 1.1)}"`) +
      path(`M${P(kx, ky)} q${P(k.H * 0.14, -k.H * 0.02, k.H * 0.18, -k.H * 0.13)} q${P(-k.H * 0.02, k.H * 0.12, -k.H * 0.12, k.H * 0.17)}Z`, ln(C, col, C.lw * 0.9)) +
      path(`M${P(kx, ky)} q${P(k.H * 0.12, k.H * 0.04, k.H * 0.13, k.H * 0.17)} q${P(-k.H * 0.08, -k.H * 0.02, -k.H * 0.15, -k.H * 0.1)}Z`, ln(C, col, C.lw * 0.9)) +
      circ(kx, ky, k.H * 0.045, ln(C, shade(col, -0.1), C.lw * 0.9))
    );
  },
};

/** A small heart (stickers, headband). */
function heartPath(C, x, y, s, col) {
  return path(`M${P(x, y + s * 0.9)} C${P(x - s * 1.6, y - s * 0.1, x - s * 0.9, y - s * 1.3, x, y - s * 0.4)} C${P(x + s * 0.9, y - s * 1.3, x + s * 1.6, y - s * 0.1, x, y + s * 0.9)}Z`, `fill="${col}" stroke="${C.line}" stroke-width="${n1(C.lw * 0.6)}" stroke-linejoin="round"`);
}

/** Knit cap / beanie dome over the head top. */
function cap(C, k, color, { band, pom, rib = false } = {}) {
  const [x, y0] = k.head;
  const y = y0 + k.H * 0.22;
  const ribs = rib ? [-2, -1, 0, 1, 2].map((i) => path(`M${P(x + i * k.rx * 0.28, y - k.H * 0.05)} L${P(x + i * k.rx * 0.3, y + k.H * 0.04)}`, `stroke="${shade(band, -0.2)}" stroke-width="${n1(C.lw * 0.6)}"`)).join('') : '';
  return path(`M${P(x - k.rx * 0.9, y)} C${P(x - k.rx * 0.92, y - k.H * 0.42, x + k.rx * 0.92, y - k.H * 0.42, x + k.rx * 0.9, y)}Z`, ln(C, color)) + path(`M${P(x - k.rx * 0.94, y - k.H * 0.05)} Q${P(x, y - k.H * 0.12, x + k.rx * 0.94, y - k.H * 0.05)} L${P(x + k.rx * 0.94, y + k.H * 0.05)} Q${P(x, y - k.H * 0.02, x - k.rx * 0.94, y + k.H * 0.05)}Z`, ln(C, band)) + ribs + circ(x, y - k.H * 0.34, k.H * 0.07, ln(C, pom));
}

const FACE_PROPS = {
  round_glasses: (C, k, col) => {
    const [x, y] = k.face;
    const r = k.er * 2.5;
    return mirror(circ(x - k.ex, y, r, `fill="#ffffff" fill-opacity=".18" stroke="${col}" stroke-width="${n1(C.lw * 1.1)}"`)) + path(`M${P(x - k.ex + r, y)} Q${P(x, y - r * 0.4, x + k.ex - r, y)}`, `fill="none" stroke="${col}" stroke-width="${n1(C.lw * 1.1)}"`);
  },
  sunglasses: (C, k, col) => {
    const [x, y] = k.face;
    const w = k.er * 2.8;
    const h = k.er * 2.1;
    return mirror(path(`M${P(x - k.ex - w, y - h * 0.6)} L${P(x - k.ex + w, y - h * 0.6)} Q${P(x - k.ex + w, y + h, x - k.ex, y + h)} Q${P(x - k.ex - w, y + h, x - k.ex - w, y - h * 0.6)}Z`, `fill="${col}" stroke="${PC.black}" stroke-width="${n1(C.lw)}"`)) + path(`M${P(x - k.ex + w, y - h * 0.4)} L${P(x + k.ex - w, y - h * 0.4)}`, `stroke="${PC.black}" stroke-width="${n1(C.lw * 1.2)}"`) + mirror(path(`M${P(x - k.ex - w * 0.6, y - h * 0.2)} L${P(x - k.ex - w * 0.1, y - h * 0.2)}`, `stroke="#fff" stroke-width="${n1(C.lw * 0.8)}" stroke-linecap="round" opacity=".7"`));
  },
  star_glasses: (C, k, col) => {
    const [x, y] = k.face;
    const star = (sx) => {
      const R = k.er * 2.9;
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 ? R * 0.5 : R;
        pts.push(`${n1(sx + Math.cos(a) * r)} ${n1(y + Math.sin(a) * r)}`);
      }
      return path(`M${pts.join(' L')}Z`, `fill="${col}" fill-opacity=".85" stroke="${PC.pink}" stroke-width="${n1(C.lw)}" stroke-linejoin="round"`);
    };
    return star(x - k.ex) + star(x + k.ex) + path(`M${P(x - k.ex * 0.45, y)} L${P(x + k.ex * 0.45, y)}`, `stroke="${PC.pink}" stroke-width="${n1(C.lw)}"`);
  },
  mask: (C, k, col) => {
    const [x] = k.face;
    const y = k.mouthY + k.H * 0.02;
    const w = k.rx * 0.42;
    const h = k.H * 0.13;
    return mirror(path(`M${P(x - w, y - h * 0.3)} Q${P(x - k.rx * 0.8, y - h * 0.6, x - k.rx * 0.92, y - h * 0.9)}`, `fill="none" stroke="#dfe3ea" stroke-width="${n1(C.lw * 0.8)}"`)) + path(`M${P(x - w, y - h * 0.5)} Q${P(x, y - h * 0.8, x + w, y - h * 0.5)} L${P(x + w * 0.9, y + h * 0.5)} Q${P(x, y + h * 0.9, x - w * 0.9, y + h * 0.5)}Z`, ln(C, col)) + path(`M${P(x - w * 0.8, y - h * 0.1)} L${P(x + w * 0.8, y - h * 0.1)} M${P(x - w * 0.8, y + h * 0.2)} L${P(x + w * 0.8, y + h * 0.2)}`, `stroke="#d8dce4" stroke-width="${n1(C.lw * 0.6)}"`);
  },
  heart_sticker: (C, k, col) => {
    const [x, y] = k.face;
    return heartPath(C, x - k.rx * 0.66, y + k.H * 0.1, k.H * 0.06, col) + heartPath(C, x + k.rx * 0.66, y + k.H * 0.1, k.H * 0.06, col);
  },
  pacifier: (C, k) => {
    const [x] = k.face;
    const y = k.mouthY + k.H * 0.02;
    return ell(x, y, k.H * 0.07, k.H * 0.045, ln(C, '#9fd6ff')) + circ(x, y + k.H * 0.055, k.H * 0.04, `fill="none" stroke="${PC.pink}" stroke-width="${n1(C.lw * 1.3)}"`) + circ(x, y, k.H * 0.018, `fill="${PC.pink}"`);
  },
  beard: (C, k) => {
    const [x] = k.face;
    const y = k.mouthY + k.H * 0.04;
    const w = k.rx * 0.5;
    const bumps = [];
    for (let i = 0; i < 5; i++) bumps.push(circ(x - w * 0.8 + i * w * 0.4, y + k.H * 0.12 + (i % 2) * k.H * 0.04, k.H * 0.08, ln(C, '#ffffff', C.lw * 0.8)));
    return path(`M${P(x - w, y)} Q${P(x, y - k.H * 0.06, x + w, y)} L${P(x + w * 0.8, y + k.H * 0.22)} Q${P(x, y + k.H * 0.34, x - w * 0.8, y + k.H * 0.22)}Z`, ln(C, '#ffffff')) + bumps.join('') + path(`M${P(x - w * 0.5, y - k.H * 0.02)} Q${P(x - w * 0.2, y - k.H * 0.06, x, y - k.H * 0.02)} Q${P(x + w * 0.2, y - k.H * 0.06, x + w * 0.5, y - k.H * 0.02)}`, ln(C, '#ffffff', C.lw * 0.8));
  },
};

const NECK_PROPS = {
  bow_tie: (C, k, col) => {
    const [x, y] = k.neck;
    const s = k.H * 0.09;
    return path(`M${P(x, y)} L${P(x - s * 1.4, y - s * 0.8)} L${P(x - s * 1.4, y + s * 0.8)}Z M${P(x, y)} L${P(x + s * 1.4, y - s * 0.8)} L${P(x + s * 1.4, y + s * 0.8)}Z`, ln(C, col)) + circ(x, y, s * 0.38, ln(C, shade(col, -0.2)));
  },
  scarf: (C, k, col) => {
    const [x, y] = k.neck;
    const w = k.bw * 0.95;
    return path(`M${P(x - w, y - k.H * 0.03)} Q${P(x, y + k.H * 0.06, x + w, y - k.H * 0.03)} L${P(x + w, y + k.H * 0.07)} Q${P(x, y + k.H * 0.17, x - w, y + k.H * 0.07)}Z`, ln(C, col)) + path(`M${P(x + w * 0.3, y + k.H * 0.08)} L${P(x + w * 0.55, y + k.H * 0.34)} L${P(x + w * 0.85, y + k.H * 0.3)} L${P(x + w * 0.7, y + k.H * 0.06)}Z`, ln(C, col)) + path(`M${P(x + w * 0.5, y + k.H * 0.31)} l${P(0, k.H * 0.04)} M${P(x + w * 0.65, y + k.H * 0.3)} l${P(0, k.H * 0.04)} M${P(x + w * 0.8, y + k.H * 0.29)} l${P(0, k.H * 0.04)}`, `stroke="${C.line}" stroke-width="${n1(C.lw * 0.7)}"`);
  },
  bell_collar: (C, k, col) => {
    const [x, y] = k.neck;
    const w = k.bw * 0.85;
    return path(`M${P(x - w, y)} Q${P(x, y + k.H * 0.08, x + w, y)}`, `fill="none" stroke="${PC.red}" stroke-width="${n1(k.H * 0.045)}" stroke-linecap="round"`) + circ(x, y + k.H * 0.09, k.H * 0.055, ln(C, col)) + path(`M${P(x - k.H * 0.035, y + k.H * 0.1)} L${P(x + k.H * 0.035, y + k.H * 0.1)}`, `stroke="${C.line}" stroke-width="${n1(C.lw * 0.7)}"`) + circ(x, y + k.H * 0.125, k.H * 0.01, `fill="${C.line}"`);
  },
  bandana: (C, k, col) => {
    const [x, y] = k.neck;
    const w = k.bw * 0.95;
    const dots = [[-0.4, 0.08], [0.35, 0.07], [0, 0.18], [-0.12, 0.05], [0.2, 0.2]].map(([dx, dy]) => circ(x + dx * w, y + dy * k.H, k.H * 0.014, `fill="#fff"`)).join('');
    return path(`M${P(x - w, y - k.H * 0.02)} Q${P(x, y + k.H * 0.05, x + w, y - k.H * 0.02)} L${P(x, y + k.H * 0.3)}Z`, ln(C, col)) + dots;
  },
  necklace: (C, k, col) => {
    const [x, y] = k.neck;
    const w = k.bw * 0.8;
    const pearls = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      pearls.push(circ(x - w + t * 2 * w, y + Math.sin(t * Math.PI) * k.H * 0.09, k.H * 0.024, `fill="${col}" stroke="${C.line}" stroke-width="${n1(C.lw * 0.5)}"`));
    }
    return pearls.join('');
  },
  necktie: (C, k, col) => {
    const [x, y] = k.neck;
    const s = k.H * 0.05;
    return path(`M${P(x - s, y - s * 0.4)} L${P(x + s, y - s * 0.4)} L${P(x + s * 0.6, y + s * 0.8)} L${P(x - s * 0.6, y + s * 0.8)}Z`, ln(C, col)) + path(`M${P(x - s * 0.6, y + s * 0.8)} L${P(x + s * 0.6, y + s * 0.8)} L${P(x + s * 1.2, y + s * 5)} L${P(x, y + s * 6)} L${P(x - s * 1.2, y + s * 5)}Z`, ln(C, col)) + path(`M${P(x - s * 0.8, y + s * 2)} L${P(x + s * 0.9, y + s * 1.3)} M${P(x - s, y + s * 3.6)} L${P(x + s, y + s * 2.9)}`, `stroke="${PC.yellow}" stroke-width="${n1(C.lw * 0.9)}"`);
  },
  stethoscope: (C, k) => {
    const [x, y] = k.neck;
    const w = k.bw * 0.7;
    return path(`M${P(x - w, y - k.H * 0.02)} Q${P(x - w * 0.9, y + k.H * 0.3, x, y + k.H * 0.3)} Q${P(x + w * 0.9, y + k.H * 0.3, x + w, y - k.H * 0.02)}`, `fill="none" stroke="#6b7385" stroke-width="${n1(k.H * 0.022)}"`) + circ(x, y + k.H * 0.33, k.H * 0.045, ln(C, '#c9d0db'));
  },
  sash: (C, k) => {
    const [x, y] = k.neck;
    return path(`M${P(x - k.bw * 0.75, y + k.H * 0.02)} L${P(x - k.bw * 0.45, y - k.H * 0.02)} L${P(x + k.bw * 0.95, y + k.H * 0.62)} L${P(x + k.bw * 0.7, y + k.H * 0.7)}Z`, ln(C, '#ffffff')) + path(`M${P(x - k.bw * 0.4, y + k.H * 0.12)} L${P(x + k.bw * 0.6, y + k.H * 0.5)}`, `stroke="${PC.red}" stroke-width="${n1(C.lw * 1.6)}"`);
  },
  id_card: (C, k) => {
    const [x, y] = k.neck;
    const cy = y + k.H * 0.3;
    return path(`M${P(x - k.bw * 0.45, y)} L${P(x, cy - k.H * 0.06)} L${P(x + k.bw * 0.45, y)}`, `fill="none" stroke="${PC.blue}" stroke-width="${n1(C.lw * 1.1)}"`) + `<rect x="${n1(x - k.H * 0.07)}" y="${n1(cy - k.H * 0.06)}" width="${n1(k.H * 0.14)}" height="${n1(k.H * 0.17)}" rx="${n1(k.H * 0.02)}" ${ln(C, '#ffffff', C.lw * 0.8)}/>` + circ(x, cy + k.H * 0.01, k.H * 0.03, `fill="${PC.grey}"`) + path(`M${P(x - k.H * 0.04, cy + k.H * 0.07)} L${P(x + k.H * 0.04, cy + k.H * 0.07)}`, `stroke="${PC.grey}" stroke-width="${n1(C.lw * 0.7)}"`);
  },
  apron: (C, k, col) => {
    const [x, y] = k.neck;
    const w = k.bw * 0.62;
    const top = y + k.H * 0.06;
    return path(`M${P(x - w * 0.6, y)} Q${P(x, y - k.H * 0.1, x + w * 0.6, y)}`, `fill="none" stroke="#8a6a4a" stroke-width="${n1(C.lw)}"`) + path(`M${P(x - w * 0.7, top)} L${P(x + w * 0.7, top)} L${P(x + w, top + k.H * 0.5)} Q${P(x, top + k.H * 0.58, x - w, top + k.H * 0.5)}Z`, ln(C, col)) + `<rect x="${n1(x - w * 0.4)}" y="${n1(top + k.H * 0.22)}" width="${n1(w * 0.8)}" height="${n1(k.H * 0.12)}" rx="${n1(k.H * 0.02)}" ${ln(C, shade(col, -0.1), C.lw * 0.7)}/>`;
  },
};

const HAND_PROPS = {
  balloon: (C, k, col) => {
    const [x, y] = k.handR;
    const bx = x + k.H * 0.2;
    const by = y - k.H * 0.74;
    return path(`M${P(x, y)} Q${P(x + k.H * 0.2, y - k.H * 0.4, bx, by + k.H * 0.2)}`, `fill="none" stroke="${C.line}" stroke-width="${n1(C.lw * 0.6)}"`) + ell(bx, by, k.H * 0.16, k.H * 0.2, ln(C, col)) + path(`M${P(bx - k.H * 0.03, by + k.H * 0.19)} L${P(bx + k.H * 0.03, by + k.H * 0.19)} L${P(bx, by + k.H * 0.23)}Z`, ln(C, col, C.lw * 0.7)) + ell(bx - k.H * 0.06, by - k.H * 0.08, k.H * 0.03, k.H * 0.05, `fill="#fff" opacity=".7"`);
  },
  flower: (C, k, col) => {
    const [x, y] = k.handR;
    const fy = y - k.H * 0.36;
    return path(`M${P(x, y)} L${P(x + k.H * 0.02, fy)}`, `stroke="${PC.green}" stroke-width="${n1(C.lw * 1.3)}"`) + ell(x + k.H * 0.06, fy + k.H * 0.16, k.H * 0.05, k.H * 0.025, `fill="${PC.green}" transform="rotate(-30 ${n1(x + k.H * 0.06)} ${n1(fy + k.H * 0.16)})"`) + path(`M${P(x - k.H * 0.07, fy - k.H * 0.02)} L${P(x - k.H * 0.06, fy - k.H * 0.12)} L${P(x - k.H * 0.02, fy - k.H * 0.07)} L${P(x + k.H * 0.02, fy - k.H * 0.13)} L${P(x + k.H * 0.06, fy - k.H * 0.07)} L${P(x + k.H * 0.1, fy - k.H * 0.12)} L${P(x + k.H * 0.11, fy - k.H * 0.02)} Q${P(x + k.H * 0.02, fy + k.H * 0.07, x - k.H * 0.07, fy - k.H * 0.02)}Z`, ln(C, col));
  },
  lollipop: (C, k, col) => {
    const [x, y] = k.handR;
    const cy = y - k.H * 0.34;
    return path(`M${P(x, y)} L${P(x, cy)}`, `stroke="#fff" stroke-width="${n1(C.lw * 1.6)}"`) + path(`M${P(x, y)} L${P(x, cy)}`, `stroke="${C.line}" stroke-width="${n1(C.lw * 0.4)}" opacity=".5"`) + circ(x, cy, k.H * 0.1, ln(C, col)) + path(`M${P(x, cy)} m${P(-k.H * 0.06, 0)} a${P(k.H * 0.06, k.H * 0.06)} 0 1 1 ${n1(k.H * 0.06)} ${n1(k.H * 0.05)}`, `fill="none" stroke="#fff" stroke-width="${n1(C.lw * 1.1)}"`);
  },
  wand: (C, k, col) => {
    const [x, y] = k.handR;
    const sx = x + k.H * 0.16;
    const sy = y - k.H * 0.36;
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? k.H * 0.045 : k.H * 0.1;
      pts.push(`${n1(sx + Math.cos(a) * r)} ${n1(sy + Math.sin(a) * r)}`);
    }
    return path(`M${P(x, y)} L${P(sx, sy)}`, `stroke="${PC.purple}" stroke-width="${n1(C.lw * 1.4)}" stroke-linecap="round"`) + path(`M${pts.join(' L')}Z`, ln(C, col));
  },
  fishing_rod: (C, k, col) => {
    const [x, y] = k.handR;
    const tx = x + k.H * 0.55;
    const ty = y - k.H * 0.7;
    return path(`M${P(x - k.H * 0.05, y + k.H * 0.05)} L${P(tx, ty)}`, `stroke="${col}" stroke-width="${n1(C.lw * 1.4)}" stroke-linecap="round"`) + path(`M${P(tx, ty)} Q${P(tx + k.H * 0.06, ty + k.H * 0.4, tx + k.H * 0.02, ty + k.H * 0.6)}`, `fill="none" stroke="${C.line}" stroke-width="${n1(C.lw * 0.4)}"`) + circ(tx + k.H * 0.02, ty + k.H * 0.62, k.H * 0.03, ln(C, PC.red, C.lw * 0.6));
  },
  book: (C, k, col) => {
    const [x, y] = k.handR;
    const w = k.H * 0.13;
    const h = k.H * 0.17;
    return `<rect x="${n1(x - w * 0.3)}" y="${n1(y - h * 0.8)}" width="${n1(w)}" height="${n1(h)}" rx="${n1(w * 0.12)}" ${ln(C, col)} transform="rotate(-10 ${n1(x)} ${n1(y)})"/>` + path(`M${P(x - w * 0.12, y - h * 0.75)} L${P(x - w * 0.12, y + h * 0.15)}`, `stroke="#fff" stroke-width="${n1(C.lw * 0.8)}" transform="rotate(-10 ${n1(x)} ${n1(y)})"`);
  },
  umbrella: (C, k, col) => {
    const [x, y] = k.handR;
    const cy = y - k.H * 0.62;
    const w = k.H * 0.36;
    const scallop = [0, 1, 2, 3].map((i) => `Q${P(x + w - (i + 0.5) * (w / 2), cy + k.H * 0.07, x + w - (i + 1) * (w / 2), cy)}`).join(' ');
    const canopy = `M${P(x - w, cy)} Q${P(x - w, cy - k.H * 0.3, x, cy - k.H * 0.3)} Q${P(x + w, cy - k.H * 0.3, x + w, cy)} ${scallop}Z`;
    return (
      path(`M${P(x, y + k.H * 0.04)} L${P(x, cy)}`, `stroke="${C.line}" stroke-width="${n1(C.lw * 1.2)}" stroke-linecap="round"`) +
      path(canopy, ln(C, col)) +
      path(`M${P(x, cy - k.H * 0.3)} Q${P(x - w * 0.3, cy - k.H * 0.12, x - w * 0.5, cy + k.H * 0.02)} M${P(x, cy - k.H * 0.3)} Q${P(x + w * 0.3, cy - k.H * 0.12, x + w * 0.5, cy + k.H * 0.02)}`, `fill="none" stroke="${shade(col, -0.25)}" stroke-width="${n1(C.lw * 0.7)}"`) +
      path(`M${P(x, y + k.H * 0.04)} q${P(0, k.H * 0.06, -k.H * 0.05, k.H * 0.06)}`, `fill="none" stroke="${C.line}" stroke-width="${n1(C.lw * 1.2)}" stroke-linecap="round"`)
    );
  },
  cane: (C, k) => {
    const [x, y] = k.handR;
    return path(`M${P(x + k.H * 0.02, F - 6)} L${P(x + k.H * 0.02, y - k.H * 0.04)} Q${P(x + k.H * 0.02, y - k.H * 0.16, x - k.H * 0.08, y - k.H * 0.14)}`, `fill="none" stroke="${PC.brown}" stroke-width="${n1(k.H * 0.035)}" stroke-linecap="round"`);
  },
  mic: (C, k) => mic(C, k, PC.black, '#c9ccd6'),
  sparkle_mic: (C, k) => mic(C, k, PC.pink, '#ffd6ea', true),
  golden_mic: (C, k) => mic(C, k, PC.gold, PC.yellow, true),
  bat: (C, k) => {
    const [x, y] = k.handR;
    return path(`M${P(x - k.H * 0.02, y + k.H * 0.04)} L${P(x + k.H * 0.36, y - k.H * 0.55)}`, `stroke="${shade(PC.straw, -0.1)}" stroke-width="${n1(k.H * 0.05)}" stroke-linecap="round"`) + path(`M${P(x + k.H * 0.2, y - k.H * 0.3)} L${P(x + k.H * 0.38, y - k.H * 0.58)}`, `stroke="${shade(PC.straw, -0.1)}" stroke-width="${n1(k.H * 0.085)}" stroke-linecap="round"`) + path(`M${P(x - k.H * 0.02, y + k.H * 0.04)} L${P(x + k.H * 0.38, y - k.H * 0.58)}`, `fill="none" stroke="${C.line}" stroke-width="${n1(C.lw * 0.5)}" opacity=".4"`);
  },
  soccer_ball: (C, k) => {
    const [x, y] = k.handR;
    const cx = x + k.H * 0.06;
    const cy = y + k.H * 0.02;
    const r = k.H * 0.1;
    return circ(cx, cy, r, ln(C, '#ffffff')) + path(`M${P(cx, cy - r * 0.35)} l${P(r * 0.33, r * 0.24)} l${P(-r * 0.13, r * 0.38)} l${P(-r * 0.4, 0)} l${P(-r * 0.13, -r * 0.38)}Z`, `fill="${PC.black}"`) + path(`M${P(cx, cy - r * 0.35)} L${P(cx, cy - r)} M${P(cx + r * 0.33, cy - r * 0.11)} L${P(cx + r * 0.95, cy - r * 0.3)} M${P(cx - r * 0.33, cy - r * 0.11)} L${P(cx - r * 0.95, cy - r * 0.3)}`, `stroke="${C.line}" stroke-width="${n1(C.lw * 0.6)}"`);
  },
  camera: (C, k) => {
    const [x, y] = k.handR;
    const w = k.H * 0.2;
    const h = k.H * 0.13;
    return `<rect x="${n1(x - w * 0.4)}" y="${n1(y - h * 0.9)}" width="${n1(w)}" height="${n1(h)}" rx="${n1(h * 0.18)}" ${ln(C, '#4a4f5c')}/>` + circ(x + w * 0.1, y - h * 0.35, h * 0.32, ln(C, '#9fc2e8', C.lw * 0.8)) + circ(x + w * 0.1, y - h * 0.35, h * 0.12, `fill="#33313a"`) + circ(x + w * 0.45, y - h * 0.75, h * 0.08, `fill="${PC.red}"`);
  },
  pen: (C, k) => {
    const [x, y] = k.handR;
    return path(`M${P(x - k.H * 0.06, y + k.H * 0.1)} L${P(x + k.H * 0.16, y - k.H * 0.28)}`, `stroke="${PC.blue}" stroke-width="${n1(k.H * 0.04)}" stroke-linecap="round"`) + path(`M${P(x - k.H * 0.06, y + k.H * 0.1)} L${P(x - k.H * 0.09, y + k.H * 0.15)}`, `stroke="${PC.black}" stroke-width="${n1(k.H * 0.02)}" stroke-linecap="round"`);
  },
  flask: (C, k) => {
    const [x, y] = k.handR;
    const t = y - k.H * 0.26;
    return path(`M${P(x - k.H * 0.025, t)} L${P(x - k.H * 0.025, t + k.H * 0.08)} L${P(x - k.H * 0.1, t + k.H * 0.24)} Q${P(x, t + k.H * 0.28, x + k.H * 0.1, t + k.H * 0.24)} L${P(x + k.H * 0.025, t + k.H * 0.08)} L${P(x + k.H * 0.025, t)}Z`, ln(C, '#eaf6ff')) + path(`M${P(x - k.H * 0.075, t + k.H * 0.18)} L${P(x + k.H * 0.075, t + k.H * 0.18)} L${P(x + k.H * 0.095, t + k.H * 0.23)} Q${P(x, t + k.H * 0.265, x - k.H * 0.095, t + k.H * 0.23)}Z`, `fill="#7be08a"`) + circ(x + k.H * 0.02, t - k.H * 0.04, k.H * 0.018, `fill="#bdf0c6"`);
  },
  script: (C, k) => {
    const [x, y] = k.handR;
    const w = k.H * 0.12;
    const h = k.H * 0.18;
    return `<rect x="${n1(x - w * 0.2)}" y="${n1(y - h)}" width="${n1(w)}" height="${n1(h)}" rx="${n1(w * 0.1)}" ${ln(C, '#fff8e6')} transform="rotate(8 ${n1(x)} ${n1(y)})"/>` + path(`M${P(x, y - h * 0.75)} l${P(w * 0.6, 0)} M${P(x, y - h * 0.5)} l${P(w * 0.6, 0)} M${P(x, y - h * 0.25)} l${P(w * 0.4, 0)}`, `stroke="${PC.grey}" stroke-width="${n1(C.lw * 0.6)}" transform="rotate(8 ${n1(x)} ${n1(y)})"`);
  },
  key_ring: (C, k) => {
    const [x, y] = k.handR;
    const r = k.H * 0.05;
    const key = (a) => `<g transform="rotate(${a} ${n1(x)} ${n1(y + r)})">${path(`M${P(x, y + r)} L${P(x, y + r + k.H * 0.12)} M${P(x, y + r + k.H * 0.09)} l${P(k.H * 0.03, 0)} M${P(x, y + r + k.H * 0.12)} l${P(k.H * 0.03, 0)}`, `stroke="${PC.gold}" stroke-width="${n1(C.lw * 1.1)}" stroke-linecap="round"`)}</g>`;
    return circ(x, y, r, `fill="none" stroke="${PC.grey}" stroke-width="${n1(C.lw * 0.9)}"`) + key(-30) + key(0) + key(30);
  },
  // 세계 설정 (치이카와 모드): 사스마타 (토벌), 국자 (라멘), 망치 (공방), 뒤집개 (팬케이크)
  sasumata: (C, k, col) => {
    const [x, y] = k.handR;
    const ty = y - k.H * 0.66;
    const w = k.H * 0.1;
    const metal = '#b9c2cc';
    const fork = `M${P(x - w * 1.25, ty - w * 2.05)} L${P(x - w, ty - w * 1.7)} L${P(x - w, ty - w * 0.5)} Q${P(x - w, ty, x, ty)} Q${P(x + w, ty, x + w, ty - w * 0.5)} L${P(x + w, ty - w * 1.7)} L${P(x + w * 1.25, ty - w * 2.05)}`;
    return (
      `<g transform="rotate(9 ${n1(x)} ${n1(y)})">` +
      path(`M${P(x, y + k.H * 0.16)} L${P(x, ty)}`, `stroke="${C.line}" stroke-width="${n1(k.H * 0.045 + C.lw)}" stroke-linecap="round"`) +
      path(`M${P(x, y + k.H * 0.16)} L${P(x, ty)}`, `stroke="${col}" stroke-width="${n1(k.H * 0.045)}" stroke-linecap="round"`) +
      path(fork, `fill="none" stroke="${C.line}" stroke-width="${n1(k.H * 0.035 + C.lw)}" stroke-linecap="round" stroke-linejoin="round"`) +
      path(fork, `fill="none" stroke="${metal}" stroke-width="${n1(k.H * 0.035)}" stroke-linecap="round" stroke-linejoin="round"`) +
      `<rect x="${n1(x - k.H * 0.035)}" y="${n1(ty - k.H * 0.01)}" width="${n1(k.H * 0.07)}" height="${n1(k.H * 0.06)}" rx="${n1(k.H * 0.012)}" ${ln(C, shade(metal, -0.2), C.lw * 0.7)}/>` +
      `</g>`
    );
  },
  ladle: (C, k, col) => {
    const [x, y] = k.handR;
    const bx = x + k.H * 0.16;
    const by = y - k.H * 0.44;
    const r = k.H * 0.1;
    return (
      path(`M${P(x - k.H * 0.01, y + k.H * 0.08)} L${P(bx - r * 0.95, by + k.H * 0.005)}`, `stroke="${C.line}" stroke-width="${n1(k.H * 0.028 + C.lw)}" stroke-linecap="round"`) +
      path(`M${P(x - k.H * 0.01, y + k.H * 0.08)} L${P(bx - r * 0.95, by + k.H * 0.005)}`, `stroke="${col}" stroke-width="${n1(k.H * 0.028)}" stroke-linecap="round"`) +
      path(`M${P(bx - r, by)} A${P(r, r * 0.95)} 0 0 0 ${P(bx + r, by)}Z`, ln(C, col)) +
      ell(bx, by, r, r * 0.3, ln(C, shade(col, -0.28), C.lw * 0.8)) +
      path(`M${P(bx - r * 0.6, by + r * 0.4)} Q${P(bx - r * 0.3, by + r * 0.75, bx + r * 0.2, by + r * 0.8)}`, `fill="none" stroke="#fff" stroke-width="${n1(C.lw * 0.9)}" stroke-linecap="round" opacity=".8"`)
    );
  },
  hammer: (C, k, col) => {
    const [x, y] = k.handR;
    const hy = y - k.H * 0.38;
    const metal = '#9aa3ae';
    return (
      `<g transform="rotate(12 ${n1(x)} ${n1(y)})">` +
      path(`M${P(x, y + k.H * 0.1)} L${P(x, hy)}`, `stroke="${C.line}" stroke-width="${n1(k.H * 0.045 + C.lw)}" stroke-linecap="round"`) +
      path(`M${P(x, y + k.H * 0.1)} L${P(x, hy)}`, `stroke="${col}" stroke-width="${n1(k.H * 0.045)}" stroke-linecap="round"`) +
      `<rect x="${n1(x - k.H * 0.15)}" y="${n1(hy - k.H * 0.075)}" width="${n1(k.H * 0.3)}" height="${n1(k.H * 0.12)}" rx="${n1(k.H * 0.02)}" ${ln(C, metal)}/>` +
      `<rect x="${n1(x + k.H * 0.1)}" y="${n1(hy - k.H * 0.085)}" width="${n1(k.H * 0.06)}" height="${n1(k.H * 0.14)}" rx="${n1(k.H * 0.015)}" ${ln(C, shade(metal, -0.2), C.lw * 0.8)}/>` +
      path(`M${P(x - k.H * 0.12, hy - k.H * 0.045)} L${P(x + k.H * 0.05, hy - k.H * 0.045)}`, `stroke="#fff" stroke-width="${n1(C.lw * 0.9)}" stroke-linecap="round" opacity=".7"`) +
      `</g>`
    );
  },
  turner: (C, k, col) => {
    const [x, y] = k.handR;
    const ty = y - k.H * 0.3;
    const bw = k.H * 0.17;
    const bh = k.H * 0.19;
    const slots = [-0.25, 0, 0.25].map((t) => path(`M${P(x + t * bw * 1.6, ty - bh * 0.75)} L${P(x + t * bw * 1.6, ty - bh * 0.25)}`, `stroke="${shade(col, -0.4)}" stroke-width="${n1(C.lw * 0.9)}" stroke-linecap="round"`)).join('');
    return (
      `<g transform="rotate(-8 ${n1(x)} ${n1(y)})">` +
      path(`M${P(x, y + k.H * 0.1)} L${P(x, y - k.H * 0.12)}`, `stroke="${PC.black}" stroke-width="${n1(k.H * 0.05)}" stroke-linecap="round"`) +
      path(`M${P(x, y - k.H * 0.12)} L${P(x, ty)}`, `stroke="${shade(col, -0.15)}" stroke-width="${n1(k.H * 0.02)}" stroke-linecap="round"`) +
      path(`M${P(x - bw * 0.5, ty)} L${P(x + bw * 0.5, ty)} L${P(x + bw * 0.6, ty - bh)} Q${P(x, ty - bh * 1.12, x - bw * 0.6, ty - bh)}Z`, ln(C, col)) +
      slots +
      `</g>`
    );
  },
};

function mic(C, k, body, head, sparkle = false) {
  const [x, y] = k.handR;
  const hy = y - k.H * 0.22;
  const sp = sparkle ? ['✦', '✧'].map((s, i) => `<text x="${n1(x + (i ? -1 : 1) * k.H * 0.15)}" y="${n1(hy - k.H * (i ? 0.02 : 0.1))}" font-size="${n1(k.H * 0.08)}" text-anchor="middle" fill="${PC.yellow}">${s}</text>`).join('') : '';
  return path(`M${P(x, y + k.H * 0.04)} L${P(x + k.H * 0.02, hy)}`, `stroke="${body}" stroke-width="${n1(k.H * 0.045)}" stroke-linecap="round"`) + circ(x + k.H * 0.02, hy - k.H * 0.03, k.H * 0.065, ln(C, head)) + sp;
}

const BACK_PROPS = {
  backpack: (C, k, col) => {
    const [x, y] = k.back;
    const w = k.bw * 1.2;
    return `<rect x="${n1(x - w)}" y="${n1(y - k.H * 0.12)}" width="${n1(w * 2)}" height="${n1(k.H * 0.36)}" rx="${n1(k.H * 0.1)}" ${ln(C, col)}/>`;
  },
  school_backpack: (C, k, col) => {
    const [x, y] = k.back;
    const w = k.bw * 1.12;
    return `<rect x="${n1(x - w)}" y="${n1(y - k.H * 0.24)}" width="${n1(w * 2)}" height="${n1(k.H * 0.46)}" rx="${n1(k.H * 0.06)}" ${ln(C, col)}/>` + path(`M${P(x - w, y - k.H * 0.1)} L${P(x + w, y - k.H * 0.1)}`, `stroke="${shade(col, -0.25)}" stroke-width="${n1(C.lw)}"`);
  },
  cape: (C, k, col) => {
    const [x, y] = k.back;
    const top = k.neck[1];
    return path(`M${P(x - k.bw * 0.6, top)} Q${P(x - k.bw * 1.5, y + k.H * 0.2, x - k.bw * 1.35, F - k.H * 0.06)} Q${P(x, F + k.H * 0.02, x + k.bw * 1.35, F - k.H * 0.06)} Q${P(x + k.bw * 1.5, y + k.H * 0.2, x + k.bw * 0.6, top)}Z`, ln(C, col));
  },
  teddy_bag: (C, k, col) => {
    const [x, y] = k.back;
    const bx = x + k.bw * 0.95;
    const by = y - k.H * 0.12;
    const r = k.H * 0.13;
    return circ(bx - r * 0.75, by - r * 0.85, r * 0.38, ln(C, col)) + circ(bx + r * 0.75, by - r * 0.85, r * 0.38, ln(C, col)) + circ(bx, by, r, ln(C, col)) + ell(bx, by + r * 0.3, r * 0.42, r * 0.32, `fill="${shade(col, 0.45)}"`) + circ(bx - r * 0.35, by - r * 0.15, r * 0.09, `fill="${C.line}"`) + circ(bx + r * 0.35, by - r * 0.15, r * 0.09, `fill="${C.line}"`) + circ(bx, by + r * 0.2, r * 0.1, `fill="${C.line}"`);
  },
  wings: (C, k, col) => {
    const [x, y] = k.back;
    const wing = path(`M${P(x - k.bw * 0.4, y - k.H * 0.05)} C${P(x - k.bw * 1.4, y - k.H * 0.5, x - k.bw * 2.1, y - k.H * 0.2, x - k.bw * 1.9, y + k.H * 0.05)} C${P(x - k.bw * 1.7, y + k.H * 0.15, x - k.bw * 1.4, y + k.H * 0.05, x - k.bw * 1.3, y + k.H * 0.18)} C${P(x - k.bw * 1.0, y + k.H * 0.2, x - k.bw * 0.6, y + k.H * 0.1, x - k.bw * 0.4, y - k.H * 0.05)}Z`, ln(C, col));
    return `<g class="ch-wings">${mirror(wing)}</g>`;
  },
  // 세계 설정 (치이카와 모드): 기타 (길거리 가수), 풀 바구니 (풀뽑기), 배달 상자 (배달부), 갑옷 등판 (갑옷씨)
  guitar: (C, k, col) => {
    const [x0, y0] = k.back;
    const gx = x0 + k.bw * 1.02;
    const gy = y0 + k.H * 0.04;
    const H = k.H;
    const neck = shade(col, -0.45);
    const body = `M${P(gx, gy + H * 0.16)} C${P(gx - H * 0.2, gy + H * 0.16, gx - H * 0.19, gy - H * 0.08, gx - H * 0.09, gy - H * 0.1)} C${P(gx - H * 0.16, gy - H * 0.16, gx - H * 0.12, gy - H * 0.32, gx, gy - H * 0.32)} C${P(gx + H * 0.12, gy - H * 0.32, gx + H * 0.16, gy - H * 0.16, gx + H * 0.09, gy - H * 0.1)} C${P(gx + H * 0.19, gy - H * 0.08, gx + H * 0.2, gy + H * 0.16, gx, gy + H * 0.16)}Z`;
    return (
      `<g transform="rotate(24 ${n1(gx)} ${n1(gy)})">` +
      `<rect x="${n1(gx - H * 0.03)}" y="${n1(gy - H * 0.78)}" width="${n1(H * 0.06)}" height="${n1(H * 0.5)}" ${ln(C, neck, C.lw * 0.8)}/>` +
      `<rect x="${n1(gx - H * 0.05)}" y="${n1(gy - H * 0.9)}" width="${n1(H * 0.1)}" height="${n1(H * 0.13)}" rx="${n1(H * 0.02)}" ${ln(C, neck, C.lw * 0.8)}/>` +
      [-1, 1].map((s) => circ(gx + s * H * 0.06, gy - H * 0.86, H * 0.016, `fill="${PC.cream}"`) + circ(gx + s * H * 0.06, gy - H * 0.81, H * 0.016, `fill="${PC.cream}"`)).join('') +
      path(body, ln(C, col)) +
      circ(gx, gy - H * 0.11, H * 0.05, `fill="${shade(col, -0.6)}" stroke="${shade(col, -0.3)}" stroke-width="${n1(C.lw * 0.6)}"`) +
      `<rect x="${n1(gx - H * 0.06)}" y="${n1(gy + H * 0.03)}" width="${n1(H * 0.12)}" height="${n1(H * 0.03)}" rx="${n1(H * 0.01)}" fill="${neck}"/>` +
      path(`M${P(gx - H * 0.012, gy + H * 0.04)} L${P(gx - H * 0.012, gy - H * 0.8)} M${P(gx + H * 0.012, gy + H * 0.04)} L${P(gx + H * 0.012, gy - H * 0.8)}`, `stroke="${PC.cream}" stroke-width="${n1(C.lw * 0.35)}"`) +
      `</g>`
    );
  },
  weed_basket: (C, k, col) => {
    const [x0, y0] = k.back;
    const H = k.H;
    const bx = x0 - k.bw * 0.95 - H * 0.1;
    const by = y0 - k.H * 0.02;
    const top = by - H * 0.16;
    const bot = by + H * 0.16;
    const weed = (dx, h0, lean, c) => {
      const h = h0 * 1.25;
      return path(`M${P(bx + dx, top + H * 0.02)} Q${P(bx + dx + lean * 0.4, top - h * 0.6, bx + dx + lean, top - h)} Q${P(bx + dx + lean * 0.2, top - h * 0.5, bx + dx + H * 0.03, top + H * 0.02)}Z`, `fill="${c}" stroke="${C.line}" stroke-width="${n1(C.lw * 0.6)}" stroke-linejoin="round"`);
    };
    const weave = [0.25, 0.5, 0.75].map((t) => path(`M${P(bx - H * (0.17 - t * 0.04), top + (bot - top) * t)} L${P(bx + H * (0.17 - t * 0.04), top + (bot - top) * t)}`, `stroke="${shade(col, -0.3)}" stroke-width="${n1(C.lw * 0.6)}"`)).join('') + [-0.09, 0, 0.09].map((dx) => path(`M${P(bx + dx * H, top)} L${P(bx + dx * H * 0.8, bot)}`, `stroke="${shade(col, -0.3)}" stroke-width="${n1(C.lw * 0.5)}"`)).join('');
    return (
      weed(-H * 0.12, H * 0.2, -H * 0.08, '#5aa84a') + weed(-H * 0.04, H * 0.27, -H * 0.02, '#6cc070') + weed(H * 0.04, H * 0.22, H * 0.06, '#4f9a40') + weed(H * 0.1, H * 0.16, H * 0.1, '#7bd06a') +
      circ(bx - H * 0.04, top - H * 0.3, H * 0.035, `fill="${PC.yellow}" stroke="${C.line}" stroke-width="${n1(C.lw * 0.5)}"`) +
      path(`M${P(bx - H * 0.2, top)} L${P(bx + H * 0.2, top)} L${P(bx + H * 0.14, bot)} Q${P(bx, bot + H * 0.03, bx - H * 0.14, bot)}Z`, ln(C, col)) +
      weave +
      ell(bx, top, H * 0.2, H * 0.04, ln(C, shade(col, -0.15), C.lw * 0.8))
    );
  },
  delivery_box: (C, k, col) => {
    const [x0, y0] = k.back;
    const H = k.H;
    const w = H * 0.48;
    const h = H * 0.4;
    const cx = x0 + k.bw * 0.95 + H * 0.12;
    const cy = y0 - k.H * 0.12;
    return (
      `<g transform="rotate(7 ${n1(cx)} ${n1(cy)})">` +
      `<rect x="${n1(cx - w / 2)}" y="${n1(cy - h / 2)}" width="${n1(w)}" height="${n1(h)}" rx="${n1(H * 0.015)}" ${ln(C, col)}/>` +
      path(`M${P(cx - w / 2, cy - h / 2 + H * 0.05)} L${P(cx + w / 2, cy - h / 2 + H * 0.05)}`, `stroke="${shade(col, -0.25)}" stroke-width="${n1(C.lw * 0.7)}"`) +
      `<rect x="${n1(cx - H * 0.035)}" y="${n1(cy - h / 2)}" width="${n1(H * 0.07)}" height="${n1(h)}" fill="${shade(col, 0.3)}" stroke="${C.line}" stroke-width="${n1(C.lw * 0.5)}"/>` +
      `<rect x="${n1(cx + w * 0.12)}" y="${n1(cy + h * 0.05)}" width="${n1(w * 0.28)}" height="${n1(h * 0.28)}" rx="${n1(H * 0.008)}" fill="#ffffff" stroke="${C.line}" stroke-width="${n1(C.lw * 0.5)}"/>` +
      path(`M${P(cx + w * 0.17, cy + h * 0.14)} l${P(w * 0.18, 0)} M${P(cx + w * 0.17, cy + h * 0.22)} l${P(w * 0.12, 0)}`, `stroke="${PC.grey}" stroke-width="${n1(C.lw * 0.5)}"`) +
      path(`M${P(cx - w * 0.36, cy + h * 0.1)} l${P(0, h * 0.18)} M${P(cx - w * 0.43, cy + h * 0.18)} l${P(w * 0.07, -h * 0.08)} l${P(w * 0.07, h * 0.08)}`, `fill="none" stroke="${shade(col, -0.4)}" stroke-width="${n1(C.lw * 0.7)}" stroke-linecap="round"`) +
      `</g>`
    );
  },
  armor_plate: (C, k, col) => {
    const [x] = k.back;
    const top = k.neck[1] + k.H * 0.02;
    const bot = F - k.H * 0.2;
    const w = k.bw * 1.18;
    const dark = shade(col, -0.25);
    const rivets = [-1, 1].flatMap((s) => [0.25, 0.55, 0.85].map((t) => circ(x + s * w * 0.93, top + (bot - top) * t, k.H * 0.016, `fill="${shade(col, 0.4)}" stroke="${dark}" stroke-width="${n1(C.lw * 0.4)}"`))).join('');
    return path(`M${P(x - w * 0.8, top)} Q${P(x - w * 1.08, top, x - w, top + k.H * 0.12)} L${P(x - w * 0.96, bot - k.H * 0.06)} Q${P(x - w * 0.9, bot, x - w * 0.6, bot)} L${P(x + w * 0.6, bot)} Q${P(x + w * 0.9, bot, x + w * 0.96, bot - k.H * 0.06)} L${P(x + w, top + k.H * 0.12)} Q${P(x + w * 1.08, top, x + w * 0.8, top)}Z`, ln(C, col)) + path(`M${P(x - w * 0.86, top + k.H * 0.06)} L${P(x - w * 0.84, bot - k.H * 0.06)} M${P(x + w * 0.86, top + k.H * 0.06)} L${P(x + w * 0.84, bot - k.H * 0.06)}`, `stroke="${dark}" stroke-width="${n1(C.lw * 0.8)}"`) + rivets;
  },
};
/** Straps drawn over the body for backpacks (front side). */
const BACK_FRONT = {
  backpack: (C, k, col = '#7cc6e8') => mirror(path(`M${P(k.back[0] - k.bw * 0.55, k.neck[1] + k.H * 0.02)} Q${P(k.back[0] - k.bw * 0.75, k.back[1], k.back[0] - k.bw * 0.6, k.back[1] + k.H * 0.2)}`, `fill="none" stroke="${shade(col, -0.2)}" stroke-width="${n1(k.H * 0.035)}" stroke-linecap="round"`)),
  school_backpack: (C, k, col = '#e0484f') => mirror(path(`M${P(k.back[0] - k.bw * 0.55, k.neck[1] + k.H * 0.02)} Q${P(k.back[0] - k.bw * 0.75, k.back[1], k.back[0] - k.bw * 0.62, k.back[1] + k.H * 0.2)}`, `fill="none" stroke="${shade(col, -0.2)}" stroke-width="${n1(k.H * 0.04)}" stroke-linecap="round"`)),
  cape: (C, k) => circ(k.neck[0], k.neck[1] + k.H * 0.02, k.H * 0.035, ln(C, PC.gold, C.lw * 0.8)),
  teddy_bag: (C, k, col = '#b07a4e') => path(`M${P(k.back[0] - k.bw * 0.5, k.neck[1] + k.H * 0.02)} L${P(k.back[0] + k.bw * 0.7, k.back[1] - k.H * 0.12)}`, `fill="none" stroke="${shade(col, -0.25)}" stroke-width="${n1(k.H * 0.03)}" stroke-linecap="round"`),
  // 세계 설정: guitar strap across the chest, basket / box straps, armor shoulder plates (pauldrons) in front
  guitar: (C, k) => path(`M${P(k.back[0] - k.bw * 0.6, k.neck[1] + k.H * 0.03)} L${P(k.back[0] + k.bw * 0.85, k.back[1] + k.H * 0.08)}`, `fill="none" stroke="#5a3a24" stroke-width="${n1(k.H * 0.032)}" stroke-linecap="round"`) + path(`M${P(k.back[0] - k.bw * 0.6, k.neck[1] + k.H * 0.03)} L${P(k.back[0] + k.bw * 0.85, k.back[1] + k.H * 0.08)}`, `fill="none" stroke="${PC.yellow}" stroke-width="${n1(k.H * 0.008)}" stroke-dasharray="${n1(k.H * 0.02)} ${n1(k.H * 0.025)}"`),
  weed_basket: (C, k, col = '#c8a165') => path(`M${P(k.back[0] + k.bw * 0.5, k.neck[1] + k.H * 0.02)} L${P(k.back[0] - k.bw * 0.8, k.back[1] - k.H * 0.02)}`, `fill="none" stroke="${shade(col, -0.35)}" stroke-width="${n1(k.H * 0.03)}" stroke-linecap="round"`),
  delivery_box: (C, k, col = '#c69c6d') => mirror(path(`M${P(k.back[0] - k.bw * 0.55, k.neck[1] + k.H * 0.02)} Q${P(k.back[0] - k.bw * 0.75, k.back[1], k.back[0] - k.bw * 0.62, k.back[1] + k.H * 0.2)}`, `fill="none" stroke="${shade(col, -0.4)}" stroke-width="${n1(k.H * 0.035)}" stroke-linecap="round"`)),
  armor_plate: (C, k, col = '#9aa5b1') => {
    const [x, by] = k.back;
    const y = by - k.H * 0.24;
    const w = k.bw * 0.55;
    const h = k.H * 0.28;
    const dark = shade(col, -0.25);
    return (
      path(`M${P(x - w, y)} Q${P(x, y + k.H * 0.05, x + w, y)} L${P(x + w * 0.88, y + h * 0.75)} Q${P(x, y + h * 1.1, x - w * 0.88, y + h * 0.75)}Z`, ln(C, col)) +
      path(`M${P(x, y + k.H * 0.04)} L${P(x, y + h * 0.9)}`, `stroke="${dark}" stroke-width="${n1(C.lw * 0.9)}"`) +
      path(`M${P(x - w * 0.6, y + h * 0.25)} Q${P(x - w * 0.5, y + h * 0.55, x - w * 0.2, y + h * 0.7)}`, `fill="none" stroke="#fff" stroke-width="${n1(C.lw * 1.2)}" stroke-linecap="round" opacity=".75"`) +
      [-1, 1].map((s) => circ(x + s * w * 0.7, y + k.H * 0.035, k.H * 0.016, `fill="${shade(col, 0.45)}" stroke="${dark}" stroke-width="${n1(C.lw * 0.4)}"`)).join('')
    );
  },
};

const DEFAULT_PROP_COLOR = { head: '#ff7eb6', face: '#5b4a44', neck: '#e2453c', hand: '#ff6b8a', back: '#f2a65a' };
const PROP_PAINTERS = { head: HEAD_PROPS, face: FACE_PROPS, neck: NECK_PROPS, hand: HAND_PROPS, back: BACK_PROPS };
/** Prop ids the renderer draws with their own shapes (props.json ids outside this list get the generic badge). */
export const DRAWN_PROPS = Object.freeze(Object.fromEntries(PROP_SLOTS.map((s) => [s, Object.keys(PROP_PAINTERS[s])])));

/** Generic prop: a little badge with the prop's icon at the slot anchor. */
function genericProp(slot, C, k, info) {
  const at = slot === 'head' ? [k.head[0] + k.rx * 0.45, k.head[1] + k.H * 0.06] : slot === 'face' ? [k.face[0], k.face[1] + k.H * 0.2] : slot === 'neck' ? k.neck : slot === 'hand' ? k.handR : [k.back[0] + k.bw * 1.1, k.back[1] - k.H * 0.1];
  const r = k.H * 0.085;
  return circ(at[0], at[1], r, ln(C, '#ffffff', C.lw * 0.8)) + `<text x="${n1(at[0])}" y="${n1(at[1] + r * 0.38)}" font-size="${n1(r * 1.15)}" text-anchor="middle">${esc(info?.icon ?? '✨')}</text>`;
}

/** Raster prop image (prop-<id> accepted) positioned so its meta.anchor sits on the slot anchor. */
function rasterProp(id) {
  const a = assetInfo(`prop-${id}`) ?? assetInfo(`prop-${String(id).replace(/_/g, '-')}`);
  return a?.url ? a : null;
}

/** Where a raster prop sits on the canvas: its meta.anchor on the slot anchor, size = image × H/450 × meta.scale. */
function propBox(slot, r, k) {
  const w = r.width || 256;
  const h = r.height || 256;
  const [ax, ay] = Array.isArray(r.meta?.anchor) ? r.meta.anchor : [w / 2, h / 2];
  const at = slot === 'head' ? k.head : slot === 'face' ? k.face : slot === 'neck' ? k.neck : slot === 'hand' ? k.handR : k.back;
  const scale = (k.H / 450) * (Number(r.meta?.scale) || 1);
  return { x: at[0] - ax * scale, y: at[1] - ay * scale, w: w * scale, h: h * scale };
}

function propSvg(slot, id, C, k, meta, { front = false, noRaster = false } = {}) {
  if (!id) return '';
  const r = rasterProp(id);
  if (r && noRaster) return '';
  if (r && !front) {
    const b = propBox(slot, r, k);
    return `<image class="ch-prop-img" href="${esc(r.url)}" x="${n1(b.x)}" y="${n1(b.y)}" width="${n1(b.w)}" height="${n1(b.h)}"/>`;
  }
  const info = propInfo(id, meta);
  // props.json colour; `tintable` props wear the character's accent colour (the avatar has no colour field)
  const col = info?.tintable && C.accent && C.accent !== C.body ? C.accent : info?.color ?? DEFAULT_PROP_COLOR[slot];
  if (front) return BACK_FRONT[id]?.(C, k, col) ?? '';
  const painter = PROP_PAINTERS[slot]?.[id];
  if (painter && slot === 'hand') {
    // hand items read better a bit bigger than life (the stubby hands are small)
    const [hx, hy] = k.handR;
    return `<g data-rig="propR" data-px="${n1(hx)}" data-py="${n1(hy)}"><g class="ch-prop hand" transform="translate(${n1(hx)} ${n1(hy)}) scale(1.35) translate(${n1(-hx)} ${n1(-hy)})">${painter(C, k, col)}</g></g>`;
  }
  if (painter) return painter(C, k, col);
  return genericProp(slot, C, k, info);
}

// ---------- body extras ----------
function tailSvg(g, C, ft) {
  if (!ft.tail) return '';
  if (ft.tail === 'momonga') return plumeTailSvg(g, C);
  const { cx, H, bw } = g;
  const bx = cx + bw * 0.7;
  const by = F - H * 0.18;
  let d;
  let fill = ft.tailColor === 'extra' ? C.extra ?? C.accent ?? C.body : ft.tailColor === 'body' ? C.body : C.accent && ft.tail !== 'fox' ? C.accent : C.body;
  if (ft.tail === 'fox') {
    fill = C.body;
    d = `M${P(bx, by)} C${P(bx + H * 0.5, by - H * 0.05, bx + H * 0.6, by - H * 0.5, bx + H * 0.3, by - H * 0.62)} C${P(bx + H * 0.42, by - H * 0.36, bx + H * 0.2, by - H * 0.12, bx - H * 0.04, by - H * 0.14)}Z`;
  } else {
    d = `M${P(bx - H * 0.05, by + H * 0.06)} C${P(bx + H * 0.46, by + H * 0.06, bx + H * 0.62, by - H * 0.55, bx + H * 0.44, by - H * 0.98)} C${P(bx + H * 0.32, by - H * 1.2, bx + H * 0.04, by - H * 1.1, bx + H * 0.12, by - H * 0.88)} C${P(bx + H * 0.27, by - H * 0.62, bx + H * 0.2, by - H * 0.26, bx - H * 0.06, by - H * 0.2)}Z`;
  }
  const tip = ft.tail === 'fox' ? circ(bx + H * 0.3, by - H * 0.56, H * 0.07, `fill="${C.accent ?? '#fff'}" stroke="none"`) : '';
  return `<g data-rig="tail" data-px="${n1(bx)}" data-py="${n1(by)}"><g class="ch-tail-i">${path(d, ln(C, fill))}${tip}</g></g>`;
}

/**
 * Momonga's tail: a BIG fluffy plume in `accent` rising behind the body on the viewer's right, about as tall as the
 * figure, its top curling outward; a scalloped outer edge, the curl line and a few `extra` fur strokes.
 */
function plumeTailSvg(g, C) {
  const { cx, top, rx, H, bw } = g;
  const fill = C.accent ?? C.body;
  const fur = C.extra ?? shade(fill, -0.25);
  const X = (k) => cx + rx * k;
  const Y = (k) => top + H * k;
  const base = [cx + bw * 0.5, F - H * 0.07];
  // S-shaped plume: a big round top leaning outward, a waist, a fuller lower part; soft tufts on the outer edge
  const edge = [[X(1.47), Y(0.12)], [X(1.4), Y(0.46)], [X(1.5), Y(0.8)], [X(1.4), Y(1.08)], [X(1.2), Y(1.3)], [cx + bw * 1.1, F - H * 0.1]];
  let d =
    `M${P(...base)} C${P(X(0.9), F - H * 0.34, X(0.7), Y(0.72), X(0.86), Y(0.32))}` + // inner edge (hidden behind the body / head)
    ` C${P(X(0.92), Y(-0.1), X(1.36), Y(-0.17), X(1.47), Y(0.12))}`; // the big round top
  for (let i = 1; i < edge.length; i++) {
    const [ax, ay] = edge[i - 1];
    const [bx, by] = edge[i];
    // control point pushed out along the edge normal (dy, −dx): the outside is to the right of the downward edge
    const bulge = i === 1 ? 0.1 : i === edge.length - 1 ? 0.12 : 0.17;
    d += ` Q${P((ax + bx) / 2 + (by - ay) * bulge, (ay + by) / 2 - (bx - ax) * bulge, bx, by)}`;
  }
  d += ` Q${P(cx + bw * 0.85, F - H * 0.02, ...base)}Z`;
  const fs = `fill="none" stroke="${fur}" stroke-width="${n1(C.lw * 1.05)}" stroke-linecap="round"`;
  const strokes =
    // the curl of the tip: a spiral inside the top lobe
    path(`M${P(X(1.47), Y(0.2))} C${P(X(1.38), Y(0.3), X(1.17), Y(0.22), X(1.21), Y(0.07))} C${P(X(1.25), Y(-0.03), X(1.39), Y(0.0), X(1.36), Y(0.1))}`, `fill="none" stroke="${C.line}" stroke-width="${n1(C.lw * 0.8)}" stroke-linecap="round"`) +
    path(`M${P(X(1.22), Y(0.42))} Q${P(X(1.3), Y(0.47), X(1.33), Y(0.57))}`, fs) +
    path(`M${P(X(1.22), Y(0.72))} Q${P(X(1.32), Y(0.78), X(1.36), Y(0.9))}`, fs) +
    path(`M${P(X(1.08), Y(1.04))} Q${P(X(1.18), Y(1.1), X(1.2), Y(1.2))}`, fs);
  const px = cx + bw * 0.7;
  const py = F - H * 0.15;
  return `<g data-rig="tail" data-px="${n1(px)}" data-py="${n1(py)}" data-amp="0.3"><g class="ch-tail-i plume">${path(d, ln(C, fill))}${strokes}</g></g>`;
}

function pouchBagSvg(g, C) {
  const { cx, H, bw, neckY } = g;
  const bx = cx - bw * 0.82;
  const by = F - H * 0.24;
  const col = C.accent ?? '#b98ad8';
  return path(`M${P(cx + bw * 0.55, neckY + H * 0.05)} L${P(bx + H * 0.04, by - H * 0.06)}`, `fill="none" stroke="${shade(col, -0.25)}" stroke-width="${n1(H * 0.025)}" stroke-linecap="round"`) + path(`M${P(bx - H * 0.11, by - H * 0.06)} L${P(bx + H * 0.11, by - H * 0.06)} Q${P(bx + H * 0.14, by + H * 0.13, bx, by + H * 0.13)} Q${P(bx - H * 0.14, by + H * 0.13, bx - H * 0.11, by - H * 0.06)}Z`, ln(C, col)) + path(`M${P(bx - H * 0.11, by - H * 0.06)} Q${P(bx, by + H * 0.04, bx + H * 0.11, by - H * 0.06)}`, ln(C, shade(col, 0.2), C.lw * 0.8)) + circ(bx, by + H * 0.0, H * 0.018, `fill="${PC.yellow}"`);
}

// ---------- pets (smaller body plans; no props) ----------
function petGeom() {
  // a pet figure fills a box ≈ 640 × 600 above the feet line (the cut-in scales it by its growth stage)
  return { cx: CX, base: F - 4, H: 520, w: 330 };
}

function petEyes(C, x1, x2, y, r, { closed = false } = {}) {
  if (closed) return path(`M${P(x1 - r * 1.3, y)} Q${P(x1, y + r * 1.1, x1 + r * 1.3, y)} M${P(x2 - r * 1.3, y)} Q${P(x2, y + r * 1.1, x2 + r * 1.3, y)}`, `fill="none" stroke="${C.line}" stroke-width="${n1(C.lw * 1.2)}" stroke-linecap="round"`);
  const one = (x) => ell(x, y, r, r * 1.25, `fill="${C.eye}"`) + circ(x - r * 0.3, y - r * 0.4, r * 0.4, `fill="#fff"`);
  return one(x1) + one(x2);
}

/** Pet figure parts: {back, body, face(points), tail, pivots}. Each painter returns SVG for the body and face anchors. */
function petSvg(species, C, ft, expression) {
  const g = petGeom();
  const { cx, base } = g;
  const blushAt = (x, y, r) => ell(x, y, r, r * 0.6, `fill="${C.blush}" fill-opacity=".6"`);
  let body = '';
  let tail = '';
  let face = null; // {x1, x2, y, r, mouthY}
  switch (ft.petShape) {
    case 'fish': {
      const y = base - 300;
      tail = path(`M${P(cx + 190, y)} L${P(cx + 330, y - 110)} Q${P(cx + 300, y, cx + 330, y + 110)}Z`, ln(C, C.accent));
      body = ell(cx, y, 230, 170, ln(C, C.body)) + path(`M${P(cx - 40, y - 160)} Q${P(cx + 30, y - 260, cx + 100, y - 150)}Z`, ln(C, C.accent)) + path(`M${P(cx - 20, y + 160)} Q${P(cx + 40, y + 230, cx + 80, y + 150)}Z`, ln(C, C.accent)) + path(`M${P(cx + 60, y - 120)} Q${P(cx + 110, y, cx + 60, y + 120)}`, `fill="none" stroke="${shade(C.body, -0.2)}" stroke-width="${n1(C.lw)}"`) + [0, 1, 2].map((i) => circ(cx - 230 - i * 40, y - 160 - i * 70, 16 + i * 6, `fill="#dff4ff" stroke="#8ec7ea" stroke-width="5"`)).join('');
      face = { x1: cx - 140, x2: cx - 50, y: y - 30, r: 22, mouthY: y + 40, mx: cx - 95 };
      break;
    }
    case 'bird': {
      const y = base - 260;
      const parrot = species === 'parrot';
      tail = parrot ? path(`M${P(cx + 120, y + 120)} L${P(cx + 260, y + 300)} L${P(cx + 200, y + 320)} L${P(cx + 80, y + 170)}Z`, ln(C, C.accent)) : '';
      body = mirror(path(`M${P(cx - 70, base)} l${P(-10, 22)} M${P(cx - 70, base)} l${P(10, 22)}`, `stroke="${C.accent}" stroke-width="${n1(C.lw * 1.4)}" stroke-linecap="round"`)) + ell(cx, y, 230, 250, ln(C, C.body)) + mirror(ell(cx - 215, y + 40, 60, 110, `${ln(C, parrot ? shade(C.body, -0.15) : shade(C.body, -0.05))} transform="rotate(18 ${n1(cx - 215)} ${n1(y + 40)})"`));
      if (parrot) body += path(`M${P(cx - 40, y - 240)} Q${P(cx - 10, y - 330, cx + 60, y - 300)} Q${P(cx + 20, y - 280, cx + 30, y - 240)}Z`, ln(C, C.extra ?? '#ffd34a'));
      else body += path(`M${P(cx - 10, y - 245)} Q${P(cx - 40, y - 320, cx + 10, y - 300)} M${P(cx + 5, y - 245)} Q${P(cx + 30, y - 310, cx + 60, y - 290)}`, ln(C, 'none', C.lw * 1.2));
      face = { x1: cx - 80, x2: cx + 80, y: y - 60, r: 24, mouthY: y + 10, beak: parrot ? C.extra ?? '#ffd34a' : C.accent };
      break;
    }
    case 'turtle': {
      const y = base - 170;
      body = mirror(ell(cx - 190, base - 40, 60, 40, ln(C, C.body))) + ell(cx + 300, y + 40, 50, 30, ln(C, C.body)) + ell(cx - 330, y - 60, 120, 110, ln(C, C.body)) + path(`M${P(cx - 280, y + 60)} C${P(cx - 280, y - 260, cx + 280, y - 260, cx + 280, y + 60)}Z`, ln(C, C.accent)) + path(`M${P(cx - 100, y - 160)} L${P(cx + 100, y - 160)} L${P(cx + 160, y - 40)} L${P(cx + 60, y + 50)} L${P(cx - 60, y + 50)} L${P(cx - 160, y - 40)}Z`, `fill="${shade(C.accent, 0.25)}" stroke="${shade(C.accent, -0.25)}" stroke-width="${n1(C.lw * 0.8)}"`) + path(`M${P(cx - 290, y + 60)} Q${P(cx, y + 110, cx + 290, y + 60)}`, ln(C, 'none'));
      face = { x1: cx - 380, x2: cx - 290, y: y - 80, r: 18, mouthY: y - 20, mx: cx - 340 };
      break;
    }
    case 'hedgehog': {
      const y = base - 200;
      const spikes = [];
      for (let i = 0; i < 13; i++) {
        const a = Math.PI * (1.05 + (i / 12) * 0.95);
        const r1 = 250;
        const r2 = 330;
        const a2 = a + 0.08;
        spikes.push(`L${P(cx + 40 + Math.cos(a) * r2, y + Math.sin(a) * r2 * 0.9)} L${P(cx + 40 + Math.cos(a2) * r1, y + Math.sin(a2) * r1 * 0.9)}`);
      }
      body = mirror(ell(cx - 150, base - 20, 50, 30, ln(C, C.body))) + path(`M${P(cx - 240, y + 120)} ${spikes.join(' ')} L${P(cx + 300, y + 130)}Z`, ln(C, C.accent)) + ell(cx - 130, y + 60, 220, 170, ln(C, C.body)) + circ(cx - 330, y + 70, 22, `fill="${C.line}"`);
      face = { x1: cx - 230, x2: cx - 110, y: y + 20, r: 20, mouthY: y + 110, mx: cx - 190 };
      break;
    }
    case 'dog': {
      const y = base - 330;
      tail = path(`M${P(cx + 160, base - 120)} Q${P(cx + 300, base - 200, cx + 250, base - 320)}`, `fill="none" stroke="${C.line}" stroke-width="${n1(46 + C.lw)}" stroke-linecap="round"`) + path(`M${P(cx + 160, base - 120)} Q${P(cx + 300, base - 200, cx + 250, base - 320)}`, `fill="none" stroke="${C.body}" stroke-width="46" stroke-linecap="round"`);
      body = path(`M${P(cx - 180, base)} C${P(cx - 220, base - 240, cx + 220, base - 240, cx + 180, base)}Z`, ln(C, C.body)) + mirror(ell(cx - 90, base - 10, 60, 32, ln(C, C.body))) + mirror(ell(cx - 225, y - 30, 70, 140, `${ln(C, C.accent)} transform="rotate(14 ${n1(cx - 225)} ${n1(y - 30)})"`)) + ell(cx, y, 230, 200, ln(C, C.body)) + ell(cx, y + 80, 90, 60, `fill="${shade(C.body, -0.03)}" stroke="none"`) + ell(cx, y + 40, 28, 20, `fill="${C.line}"`);
      face = { x1: cx - 95, x2: cx + 95, y: y - 30, r: 24, mouthY: y + 95 };
      break;
    }
    case 'guinea': {
      const y = base - 190;
      body = mirror(ell(cx - 180, base - 14, 50, 28, ln(C, C.body))) + path(`M${P(cx - 320, y + 170)} C${P(cx - 360, y - 200, cx + 340, y - 220, cx + 320, y + 170)}Z`, ln(C, C.body)) + path(`M${P(cx + 20, y - 150)} C${P(cx + 250, y - 160, cx + 330, y, cx + 318, y + 168)} L${P(cx + 60, y + 168)} C${P(cx + 120, y + 40, cx + 40, y - 40, cx + 20, y - 150)}Z`, `fill="${C.accent}" stroke="none"`) + path(`M${P(cx - 320, y + 170)} C${P(cx - 360, y - 200, cx + 340, y - 220, cx + 320, y + 170)}Z`, `fill="none" stroke="${C.line}" stroke-width="${n1(C.lw)}"`) + mirror(ell(cx - 150, y - 120, 50, 36, ln(C, C.accent)));
      face = { x1: cx - 190, x2: cx - 50, y: y - 20, r: 22, mouthY: y + 60, mx: cx - 120 };
      break;
    }
    case 'snail': {
      const y = base - 160;
      body = path(`M${P(cx - 340, base)} Q${P(cx - 380, y - 120, cx - 250, y - 160)} L${P(cx - 160, y - 150)} Q${P(cx - 160, base - 60, cx + 300, base - 20)} Q${P(cx + 320, base, cx + 280, base)}Z`, ln(C, C.body)) + path(`M${P(cx - 270, y - 150)} L${P(cx - 310, y - 300)} M${P(cx - 200, y - 150)} L${P(cx - 190, y - 300)}`, `stroke="${C.line}" stroke-width="${n1(C.lw)}"`) + circ(cx - 310, y - 305, 18, `fill="${C.line}"`) + circ(cx - 190, y - 305, 18, `fill="${C.line}"`) + circ(cx + 80, y - 130, 230, ln(C, C.accent)) + path(`M${P(cx + 80, y - 130)} m${P(-20, 0)} a20 20 0 1 1 40 10 a60 60 0 1 1 -110 -40 a110 110 0 1 1 200 70 a160 160 0 1 1 -290 -90`, `fill="none" stroke="${shade(C.accent, -0.3)}" stroke-width="${n1(C.lw * 1.1)}"`);
      face = { x1: cx - 290, x2: cx - 200, y: y - 90, r: 18, mouthY: y - 30, mx: cx - 245 };
      break;
    }
    default: {
      const y = base - 230;
      body = ell(cx, y, 250, 230, ln(C, C.body)) + `<text x="${n1(cx)}" y="${n1(y + 150)}" font-size="90" text-anchor="middle">${esc(ft.icon ?? '🐾')}</text>`;
      face = { x1: cx - 90, x2: cx + 90, y: y - 40, r: 24, mouthY: y + 40 };
    }
  }
  const mx = face.mx ?? (face.x1 + face.x2) / 2;
  const happy = expression === 'joy' || expression === 'love';
  let eyes = `<g class="ch-eo">${happy ? path(`M${P(face.x1 - face.r * 1.3, face.y + 6)} Q${P(face.x1, face.y - face.r * 1.4, face.x1 + face.r * 1.3, face.y + 6)} M${P(face.x2 - face.r * 1.3, face.y + 6)} Q${P(face.x2, face.y - face.r * 1.4, face.x2 + face.r * 1.3, face.y + 6)}`, `fill="none" stroke="${C.line}" stroke-width="${n1(C.lw * 1.2)}" stroke-linecap="round"`) : petEyes(C, face.x1, face.x2, face.y, face.r)}</g>`;
  eyes += `<g class="ch-ec" display="none">${petEyes(C, face.x1, face.x2, face.y, face.r, { closed: true })}</g>`;
  const w = face.r * 0.9;
  const mouth = face.beak
    ? path(`M${P(mx - w * 1.3, face.mouthY - w)} L${P(mx + w * 1.3, face.mouthY - w)} L${P(mx, face.mouthY + w * 1.2)}Z`, ln(C, face.beak))
    : path(`M${P(mx - w * 1.2, face.mouthY - w * 0.3)} Q${P(mx - w * 0.6, face.mouthY + w * 0.8, mx, face.mouthY)} Q${P(mx + w * 0.6, face.mouthY + w * 0.8, mx + w * 1.2, face.mouthY - w * 0.3)}`, `fill="none" stroke="${C.line}" stroke-width="${n1(C.lw)}" stroke-linecap="round"`);
  const mOpen = face.beak ? mouth : ell(mx, face.mouthY + w * 0.4, w * 0.8, w * 0.9, ln(C, MOUTH_IN, C.lw * 0.8));
  const tears = expression === 'cry' ? [face.x1, face.x2].map((x) => path(`M${P(x - 8, face.y + face.r)} q${P(-10, 50, 4, 80)} l${P(20, 0)} q${P(10, -30, -4, -80)}Z`, `fill="#9fd6ff" stroke="#5b8fd9" stroke-width="4"`)).join('') : '';
  const blush = blushAt(face.x1 - face.r * 1.6, face.y + face.r * 2, face.r * 1.4) + blushAt(face.x2 + face.r * 1.6, face.y + face.r * 2, face.r * 1.4);
  const faceG = `<g class="ch-face">${blush}${eyes}<g class="ch-mc">${mouth}</g><g class="ch-mo" display="none">${mOpen}</g>${tears}</g>`;
  const tailG = tail ? `<g data-rig="tail" data-px="${n1(cx + 160)}" data-py="${n1(base - 120)}"><g class="ch-tail-i">${tail}</g></g>` : '';
  return { svg: `${tailG}<g class="ch-body">${body}</g><g data-rig="head" data-px="${n1(cx)}" data-py="${n1(base - 100)}"><g class="ch-head-i">${faceG}</g></g>`, box: { x: cx - 400, y: base - 600, w: 800, h: 640 }, eyes: [[face.x1, face.y], [face.x2, face.y]] };
}

const PET_SHAPES = { goldfish: 'fish', chick: 'bird', parrot: 'bird', turtle: 'turtle', hedgehog: 'hedgehog', puppy: 'dog', guinea_pig: 'guinea', snail: 'snail' };

// ---------- raster parts (§3) ----------
const RASTER_PARTS = ['base', 'body', 'arms', 'eyes-closed', 'mouth-open'];
const EXPR_RASTER = ['joy', 'cry', 'shock', 'angry', 'love', 'sweat'];

/** Asset id prefix of a look: ch-<id> | npc-<species> | pet-<species>. */
export function rasterPrefix(look, meta = null) {
  const kind = lookKind(look);
  if (kind === 'pet') return `pet-${look.pet}`;
  if (kind === 'npc') return `npc-${look.npc}`;
  return `ch-${normalizeLook(look, meta).character}`;
}

/** Valid anchor set ({head, face, neck, handL, handR, back} of [x, y]) or null. */
function anchorSet(a) {
  if (!isObj(a)) return null;
  const keys = ['head', 'face', 'neck', 'handL', 'handR', 'back'];
  return keys.every((k) => pt(a[k], null)) ? Object.fromEntries(keys.map((k) => [k, pt(a[k], null)])) : null;
}

/**
 * Accepted raster parts of a look: {base, body, arms, eyesClosed, mouthOpen, expr: {e: info}, sheets: {action: sheet},
 * anchors, eyes, headBox, bbox} | null. CH-2 art carries its measured geometry on the base (meta.anchors / eyes / headBox
 * / bbox, logical canvas units) → props, crops and particles follow the drawing instead of the roster's SVG anchors.
 * Ids with `_` (bear_cub, guinea_pig) are also looked up with `-` (manifest ids).
 */
export function rasterParts(look, meta = null) {
  const prefix = rasterPrefix(look, meta);
  const alt = prefix.replace(/_/g, '-');
  const get = (part) => {
    const a = assetInfo(`${prefix}-${part}`) ?? (alt !== prefix ? assetInfo(`${alt}-${part}`) : null);
    return a?.url ? a : null;
  };
  const parts = Object.fromEntries(RASTER_PARTS.map((p) => [p, get(p)]));
  const expr = {};
  for (const e of EXPR_RASTER) {
    const a = get(`expr-${e}`);
    if (a) expr[e] = a;
  }
  const sheets = {};
  for (const action of Object.keys(ACTIONS)) {
    const s = sheetDef(get(`sheet-${action}`));
    if (s) sheets[action] = s;
  }
  if (!parts.base && !parts.body && !Object.keys(sheets).length) return null;
  const art = (parts.base ?? parts.body)?.meta ?? {};
  const bbox = isObj(art.bbox) && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(art.bbox[k])) ? art.bbox : null;
  return {
    base: parts.base,
    body: parts.body,
    arms: parts.arms,
    eyesClosed: parts['eyes-closed'],
    mouthOpen: parts['mouth-open'],
    expr,
    sheets,
    anchors: anchorSet(art.anchors),
    eyes: Array.isArray(art.eyes) && art.eyes.length === 2 && art.eyes.every((e) => pt(e, null)) ? art.eyes : null,
    headBox: isObj(art.headBox) && Number.isFinite(art.headBox.left) && art.headBox.right > art.headBox.left ? art.headBox : null,
    bbox,
  };
}

let clipSeq = 0;
/** A raster part on the canvas: at its `meta.rect` ([x, y, w, h], logical units; CH-2 crops) else the whole canvas. */
const imgOf = (info, cls = '', extra = '') => {
  const r = Array.isArray(info?.meta?.rect) && info.meta.rect.length === 4 && info.meta.rect.every(Number.isFinite) ? info.meta.rect : [0, 0, 1024, 1536];
  return `<image class="${cls}" href="${esc(info.url)}" x="${n1(r[0])}" y="${n1(r[1])}" width="${n1(r[2])}" height="${n1(r[3])}" preserveAspectRatio="none"${extra}/>`;
};

/**
 * Raster figure: body + face overlays + both arms (one image clipped into left / right halves, rotating around their
 * pivots), or the full base. `tf(part, pivot)` bakes a key pose into the arm groups (group photo / reduced motion).
 * Blink (eyes-closed) and talk (mouth-open) overlays only ride on the neutral face; an expression is an overlay
 * (meta.overlay !== false) or a full swap (meta.overlay === false: arms baked in, no rig arms).
 */
function rasterFigure(r, g, expression, tf = () => '', hand = '') {
  const e = EXPR_RASTER.includes(expression) ? expression : null;
  const ex = e ? r.expr[e] : null;
  const swap = ex && ex.meta?.overlay === false ? ex : null;
  const over = ex && ex.meta?.overlay !== false ? ex : null;
  const pivots = (r.arms ?? r.body ?? r.base)?.meta?.pivots ?? {};
  const pL = pt(pivots.armL, g.shoulderL);
  const pR = pt(pivots.armR, g.shoulderR);
  const neutral = !ex;
  const eyesC = r.eyesClosed && neutral ? `<g class="ch-ec" display="none">${imgOf(r.eyesClosed, 'ch-r eyes')}</g>` : '';
  const mouthO = r.mouthOpen && neutral ? `<g class="ch-mo" display="none">${imgOf(r.mouthOpen, 'ch-r mouth')}</g>` : '';
  const face = (over ? imgOf(over, 'ch-r expr') : '') + eyesC + mouthO;
  let fig;
  if (r.body && r.arms && !swap) {
    const id = `chc${(++clipSeq).toString(36)}`;
    const tL = tf('armL', pL);
    const tR = tf('armR', pR);
    fig =
      `<defs><clipPath id="${id}l"><rect x="0" y="0" width="${CX}" height="1536"/></clipPath><clipPath id="${id}r"><rect x="${CX}" y="0" width="${CX}" height="1536"/></clipPath></defs>` +
      imgOf(r.body, 'ch-r body') +
      face +
      `<g data-rig="armL" data-px="${n1(pL[0])}" data-py="${n1(pL[1])}"${tL ? ` transform="${tL}"` : ''}>${imgOf(r.arms, 'ch-r arms', ` clip-path="url(#${id}l)"`)}</g>` +
      `<g data-rig="armR" data-px="${n1(pR[0])}" data-py="${n1(pR[1])}"${tR ? ` transform="${tR}"` : ''}>${imgOf(r.arms, 'ch-r arms', ` clip-path="url(#${id}r)"`)}${hand}</g>`;
  } else {
    fig = imgOf(swap ?? r.base ?? r.body, 'ch-r base') + face + hand;
  }
  return `<g class="ch-raster${eyesC ? ' has-ec' : ''}">${fig}</g>`;
}

/** Rig geometry of raster art: chibiGeom of the art's anchors, head width / centre and eye spacing from the drawing. */
function rasterGeom(raster) {
  const g = chibiGeom(raster.anchors);
  const hb = raster.headBox;
  if (hb) {
    g.rx = (hb.right - hb.left) / 2;
    g.cy = (hb.top + hb.bottom) / 2;
  }
  if (raster.eyes) {
    g.ex = Math.abs(raster.eyes[1][0] - raster.eyes[0][0]) / 2;
    g.ey = g.faceY = (raster.eyes[0][1] + raster.eyes[1][1]) / 2;
  }
  g.anchors = { ...raster.anchors };
  return g;
}

/** Figure geometry used for a look (raster art with measured anchors wins). */
function figureGeom(r, raster) {
  if (r.kind === 'pet') return null;
  return raster && (raster.base || raster.body) && raster.anchors ? rasterGeom(raster) : chibiGeom(r.anchors);
}

/** Raster props of a raster-art look with their canvas boxes, in drawing order (back first): [{slot, url, x, y, w, h}]. */
export function rasterPropBoxes(look, meta = currentMeta) {
  const r = resolveLook(look, meta);
  if (r.kind === 'pet') return [];
  const raster = rasterParts(r.look, meta);
  const artFig = !!(raster && (raster.base || raster.body));
  const g = figureGeom(r, raster);
  const k = propCtx(g, artFig ? raster.anchors ?? r.anchors : g.anchors);
  const out = [];
  for (const slot of ['back', 'neck', 'face', 'head', 'hand']) {
    const id = r.look.props?.[slot];
    const rp = id ? rasterProp(id) : null;
    if (rp) out.push({ slot, url: rp.url, ...propBox(slot, rp, k) });
  }
  return out;
}

// ---------- assembly ----------

/** Colours + line width of a figure. */
function colorsFor(info, lw) {
  const c = info.colors ?? {};
  return { body: c.body ?? '#ffffff', line: c.line ?? '#5b4a44', blush: c.blush ?? '#ffb4c2', accent: c.accent ?? null, extra: c.extra ?? null, eye: shade(c.line ?? '#5b4a44', -0.45), lw };
}

/** Resolve a look into {kind, info, features, anchors}. */
function resolveLook(look, meta) {
  const kind = lookKind(look);
  if (kind === 'pet') {
    const info = petInfo(look.pet, meta);
    return { kind, info, ft: { petShape: PET_SHAPES[look.pet] ?? info.ears ?? null, icon: info.icon }, look: { pet: look.pet } };
  }
  if (kind === 'npc') {
    const info = npcInfo(look.npc, meta);
    const props = normalizeLook(look, meta).props;
    return { kind, info, ft: featuresOf(look.npc, info.ears, null), anchors: scaledAnchors(info.size), look: { npc: look.npc, props } };
  }
  const n = normalizeLook(look, meta);
  const info = rosterInfo(n.character, meta);
  const raw = Array.isArray(meta?.roster?.characters) ? meta.roster.characters.find((x) => x.id === n.character) : null;
  return { kind: 'character', info, ft: featuresOf(n.character, info.ears, raw?.features), anchors: info.anchors ?? scaledAnchors(info.size), look: n };
}

/** viewBox of a crop for a figure geometry. */
function cropBox(crop, g, kind, petBox) {
  if (typeof crop === 'object' && crop && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(crop[k]))) return crop;
  if (crop === 'full') return FULL_VIEW;
  if (kind === 'pet') {
    const b = petBox;
    if (crop === 'fit') return { x: b.x - 20, y: b.y - 40, w: b.w + 40, h: b.h + 60 };
    const side = crop === 'bust' ? Math.max(b.w, b.h) * 1.02 : Math.max(b.w, b.h) * 0.92;
    return { x: CX - side / 2, y: b.y + b.h * (crop === 'bust' ? 0.5 : 0.48) - side / 2, w: side, h: side };
  }
  if (crop === 'fit') {
    // the figure with room for hats / tall ears and side items (tails, wings, hand props)
    const top = g.top - g.H * 0.42;
    return { x: CX - g.rx * 1.6, y: top, w: g.rx * 3.2, h: F + 40 - top };
  }
  if (crop === 'head') {
    // hats / head props: the head with room above it
    const side = g.rx * 2.5;
    const cy = g.top + g.H * 0.32;
    return { x: CX - side / 2, y: cy - side / 2, w: side, h: side };
  }
  if (crop === 'bust') {
    const side = g.rx * 2.8;
    const cy = g.cy + g.H * 0.12;
    return { x: CX - side / 2, y: cy - side / 2, w: side, h: side };
  }
  // face
  const side = g.rx * 2.42;
  const cy = g.cy - g.H * 0.04;
  return { x: CX - side / 2, y: cy - side / 2, w: side, h: side };
}

/**
 * The figure as an SVG string.
 * @param {object} look  {character, props} | {npc, props} | {pet} (old human avatars are mapped by normalizeLook)
 * @param {{size?: number, crop?: 'full'|'fit'|'bust'|'face'|{x,y,w,h}, expression?: string, pose?: string, title?: string,
 *          flip?: boolean, meta?: object, static?: boolean, bg?: string|null, shadow?: boolean, cls?: string}} opts
 *   `pose` bakes that action's key pose into the markup (group photo / reduced motion); `size` = rendered px of the longer
 *   side (sets the outline width so small portraits keep a visible line).
 */
export function charaSvg(look, opts = {}) {
  const { size = 96, crop = 'full', expression = 'neutral', pose = null, title = '', flip = false, meta = currentMeta, bg = null, shadow = crop === 'full' || crop === 'fit', cls = '', only = null } = opts;
  const r = resolveLook(look, meta);
  const isPet = r.kind === 'pet';
  const raster = rasterParts(r.look, meta);
  const artFig = !!(raster && (raster.base || raster.body));
  const g = figureGeom(r, raster);
  // viewBox first (line width depends on it)
  let pet = null;
  const C0 = colorsFor(r.info, 10);
  if (isPet) pet = petSvg(r.look.pet, C0, r.ft, expression);
  const vb = cropBox(crop, g, r.kind, isPet && artFig && raster.bbox ? raster.bbox : pet?.box);
  const px = Math.max(8, Number(size) || 96);
  const lw = clamp((Math.max(vb.w, vb.h) / px) * 1.15, 8, 40);
  const C = colorsFor(r.info, lw);
  if (isPet) pet = petSvg(r.look.pet, C, r.ft, expression);
  const kp = pose ? keyPose(pose) : null;
  const tf = (part, pivot) => (kp ? partTransform(kp[part], pivot) : '');
  const rg = (name, pivot, inner, extra = '') => {
    const t = tf(name, pivot);
    return `<g data-rig="${name}" data-px="${n1(pivot[0])}" data-py="${n1(pivot[1])}"${t ? ` transform="${t}"` : ''}${extra}>${inner}</g>`;
  };
  let figure;
  const props = r.look.props ?? {};
  const k = isPet ? null : propCtx(g, artFig ? raster.anchors ?? r.anchors : g.anchors);
  if (isPet) {
    figure = only ? '' : artFig ? rasterFigure(raster, { shoulderL: [400, 1000], shoulderR: [624, 1000] }, expression, tf) : pet.svg;
  } else if (artFig) {
    const o = { noRaster: !!only }; // canvas compositing draws raster props itself (rasterPropBoxes)
    const back = `<g class="ch-back">${propSvg('back', props.back, C, k, meta, o)}</g>`;
    // the hand item rides in the right arm's rig group (held while waving), counter-rotated like the SVG rig's
    let hand = propSvg('hand', props.hand, C, k, meta, o);
    if (hand && !hand.startsWith('<g data-rig="propR"')) hand = `<g data-rig="propR" data-px="${n1(k.handR[0])}" data-py="${n1(k.handR[1])}">${hand}</g>`;
    if (kp && hand) {
      const t = partTransform({ r: -(kp.armR?.r ?? 0) * 0.85 }, k.handR);
      if (t) hand = hand.replace('<g data-rig="propR"', `<g transform="${t}" data-rig="propR"`);
    }
    const front = (h) => `<g class="ch-props">${propSvg('back', props.back, C, k, meta, { front: true })}${propSvg('neck', props.neck, C, k, meta, o)}${propSvg('face', props.face, C, k, meta, o)}${propSvg('head', props.head, C, k, meta, o)}${h}</g>`;
    // `only` = one layer of a raster figure for canvas compositing (group photo): its props behind / in front / the
    // hand item alone (composeRaster rotates it with the arm; no root transform in that layer)
    const armed = !!(raster.body && raster.arms && !(EXPR_RASTER.includes(expression) && raster.expr[expression]?.meta?.overlay === false));
    figure = only === 'back' ? back : only === 'front' ? front(armed ? '' : hand) : only === 'hand' ? (armed ? hand : '') : back + rasterFigure(raster, g, expression, tf, hand) + front('');
  } else {
    const ft = r.ft;
    const armFill = ft.darkLimbs ? C.accent : C.body;
    const footFill = ft.feetColor === 'extra' ? C.extra ?? C.accent ?? C.body : ft.feetColor === 'accent' ? C.accent ?? C.body : ft.darkLimbs ? C.accent : C.body;
    const feet = mirror(path(`M${P(CX - g.bw * 0.74, F - g.H * 0.03)} Q${P(CX - g.bw * 0.74, F - g.H * 0.1, CX - g.bw * 0.42, F - g.H * 0.1)} Q${P(CX - g.bw * 0.1, F - g.H * 0.1, CX - g.bw * 0.1, F - g.H * 0.03)}`, ln(C, footFill)));
    let body = path(bodyPath(g), ln(C, C.body));
    if (ft.belly) body += path(bodyPath({ ...g, bw: g.bw * 0.62, bodyTop: g.neckY + g.H * 0.05 }), `fill="${C.accent ?? '#ffffff'}" stroke="none"`);
    if (ft.bellyMarks) body += [0, 1, 2].map((i) => path(`M${P(CX - 30 + (i - 1) * 50, g.neckY + g.H * 0.3 + (i % 2) * 30)} l${P(15, 18)} l${P(15, -18)}`, `fill="none" stroke="${shade(C.body, -0.3)}" stroke-width="${n1(C.lw * 0.8)}"`)).join('');
    // a soft shadow under the chin
    body += ell(CX, g.bottom + g.H * 0.02, g.bw * 0.62, g.H * 0.05, `fill="${C.line}" fill-opacity=".07"`);
    const head =
      (ft.mane ? maneSvg(g, C) : '') +
      earsSvg(g, C, ft.ears ?? r.info.ears ?? 'nub', ft, tf) +
      path(headPath(g), ln(C, C.body)) +
      headDecor(g, C, ft) +
      faceSvg(ft.frogEyes ? { ...g, ex: g.rx * 0.5, ey: g.top + g.H * 0.07 } : g, C, ft, expression) +
      propSvg('face', props.face, C, k, meta) +
      propSvg('head', props.head, C, k, meta);
    const armL = armShape(C, g.shoulderL, g.handL, g.armW, armFill);
    let handProp = propSvg('hand', props.hand, C, k, meta);
    if (kp && handProp.startsWith('<g data-rig="propR"')) {
      const t = partTransform({ r: -(kp.armR.r ?? 0) * 0.85 }, k.handR);
      if (t) handProp = handProp.replace('<g data-rig="propR"', `<g transform="${t}" data-rig="propR"`);
    }
    const armR = armShape(C, g.shoulderR, g.handR, g.armW, armFill) + handProp;
    figure =
      tailSvg(g, C, ft) +
      `<g class="ch-back">${propSvg('back', props.back, C, k, meta)}</g>` +
      `<g class="ch-body">${body}${feet}${propSvg('back', props.back, C, k, meta, { front: true })}${ft.pouchBag ? pouchBagSvg(g, C) : ''}</g>` +
      rg('head', [CX, g.bottom], `<g class="ch-head-i">${head}</g>`) +
      `<g class="ch-neck">${propSvg('neck', props.neck, C, k, meta)}</g>` +
      rg('armL', g.shoulderL, armL) +
      rg('armR', g.shoulderR, armR);
  }
  const shadowW = isPet ? 300 : g.bw * 1.35;
  const rootT = only === 'hand' ? '' : tf('root', [CX, F]);
  const shadowSvg = shadow && !only ? rg('shadow', [CX, F], ell(CX, F + 6, shadowW, 26, `fill="#3a2a40" fill-opacity=".14"`)) : '';
  const bgSvg = bg ? `<rect x="${n1(vb.x)}" y="${n1(vb.y)}" width="${n1(vb.w)}" height="${n1(vb.h)}" fill="${esc(bg)}"/>` : '';
  const flipT = flip ? ` transform="${MIRROR}"` : '';
  const label = title || (isPet ? r.info.name : r.kind === 'npc' ? r.info.name : r.info.name);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" class="chara-svg${cls ? ` ${cls}` : ''}" viewBox="${n1(vb.x)} ${n1(vb.y)} ${n1(vb.w)} ${n1(vb.h)}" width="${n1(vb.w >= vb.h ? px : (px * vb.w) / vb.h)}" height="${n1(vb.h >= vb.w ? px : (px * vb.h) / vb.w)}" role="img" aria-label="${esc(label)}" data-chara="${esc(lookKey(r.look))}" data-kind="${r.kind}">`,
    bgSvg,
    `<g${flipT}>`,
    shadowSvg,
    `<g data-rig="root" data-px="${CX}" data-py="${F}"${rootT ? ` transform="${rootT}"` : ''}><g class="ch-idle">${figure}</g></g>`,
    '<g class="ch-fx"></g>',
    '</g></svg>',
  ].join('');
}

// ---------- meta (installed by the app; pure callers pass `meta`) ----------
let currentMeta = null;
/** Install `/api/meta` (roster / props / npcs / pets) for every later render. */
export function setCharaMeta(meta) {
  currentMeta = meta ?? null;
}
export const getCharaMeta = () => currentMeta;

// ---------- live element ----------

const POSE_ACTION = { idle: null, wave: 'wave', cheer: 'cheer', cry: 'cry', walk: 'walk', talk: 'talk', jump: 'jump', shock: 'shock' };
const ONE_SHOT = new Set(['jump', 'shock']);
/** Emotion → particle kind shown around the figure. */
const EMOTION_FX = { cry: 'tear', love: 'heart', sweat: 'sweat', joy: 'sparkle' };

/** Subject (character {avatar, name} or a look) → {look, name}. */
function subjectLook(subject) {
  if (subject && typeof subject === 'object' && subject.avatar && typeof subject.avatar === 'object') return { look: subject.avatar, name: subject.name ?? '' };
  return { look: subject ?? {}, name: '' };
}

/**
 * A live figure element.
 * @param {object} look
 * @param {{size?, crop?, expression?, pose?, motion?: boolean, flip?, title?, meta?, shadow?}} opts  `motion: false` =
 *   a static drawing (portraits); otherwise idle breathing / ear twitch / blink run and `pose` loops.
 * @returns {HTMLElement} `.chara` with setState({expression, pose}), play(action) → Promise<boolean>, talk(ms), stop(), ready
 */
export function renderChara(look, opts = {}) {
  const { size = 160, crop = 'full', flip = false, title = '', meta = null, motion = true } = opts;
  let expression = opts.expression ?? 'neutral';
  let pose = opts.pose ?? 'idle';
  const reduced = prefersReducedMotion();
  const el = document.createElement('div');
  el.className = `chara${motion && !reduced ? ' anim' : ''}`;
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', title || '캐릭터');
  let rig = null;
  let blinkTimer = null;
  let sheet = null;
  const m = meta ?? currentMeta;
  const raster = rasterParts(look, m);

  const draw = () => {
    // a redraw (face change) replaces the svg: a sprite sheet playing in it is over
    if (sheet) {
      sheet.stop();
      sheet = null;
      el.classList.remove('sheet-on');
    }
    el.innerHTML = charaSvg(look, { size, crop, expression, title, flip, meta: m, pose: !motion || reduced ? (pose === 'idle' ? null : pose) : null });
    el.dataset.expression = expression;
    el.dataset.pose = pose;
    el.dataset.source = raster ? 'raster' : 'svg';
    const svg = el.querySelector('svg');
    if (motion && svg) {
      rig?.destroy();
      rig = createRig(svg, { reduced });
      const a = POSE_ACTION[pose];
      if (a && !ONE_SHOT.has(a)) rig.loop(a);
    }
    fx();
  };

  function fx() {
    const layer = el.querySelector('.ch-fx');
    if (!layer) return;
    const kind = pose === 'cry' ? 'tear' : EMOTION_FX[expression] ?? null;
    if (!kind || !motion) {
      layer.innerHTML = '';
      return;
    }
    const r = resolveLook(look, m);
    const g = figureGeom(r, raster);
    const origins = g ? [[CX - g.ex, g.ey], [CX + g.ex, g.ey]] : [[440, 1000], [584, 1000]];
    const top = g ? [[CX, g.top + g.H * 0.2]] : [[CX, 760]];
    const specs = spawnParticles(kind, { n: kind === 'tear' ? 6 : 4, seed: 7, origins: kind === 'tear' ? origins : top, spread: g ? g.rx : 200 });
    layer.innerHTML = particlesSvg(specs);
  }

  function scheduleBlink() {
    clearTimeout(blinkTimer);
    if (!motion || reduced) return;
    blinkTimer = setTimeout(() => {
      if (!el.isConnected && el.dataset.attached) return;
      if (el.isConnected) el.dataset.attached = '1';
      const svg = el.querySelector('svg');
      svg?.classList.add('blink');
      setTimeout(() => svg?.classList.remove('blink'), BLINK.ms);
      scheduleBlink();
    }, blinkDelay());
  }

  draw();
  scheduleBlink();
  el.ready = Promise.resolve(true);
  el.look = look;
  el.setState = (next = {}) => {
    const e = next.expression ?? next.emotion;
    const changedFace = e !== undefined && (e ?? 'neutral') !== expression;
    if (changedFace) expression = e ?? 'neutral';
    const p = next.pose && POSE_ACTION[next.pose] !== undefined ? next.pose : null;
    if (changedFace) draw();
    if (p) {
      pose = p;
      el.dataset.pose = pose;
      const a = POSE_ACTION[p];
      if (!motion) draw();
      else if (a && ONE_SHOT.has(a)) el.play(a);
      else rig?.loop(a);
      fx();
    }
    return Promise.resolve(true);
  };
  /** Play an action once (sprite sheet when accepted, else the cut-out rig). */
  el.play = (action, o = {}) => {
    if (!motion) return Promise.resolve(false);
    const s = raster?.sheets?.[action];
    if (s) {
      sheet?.stop();
      el.classList.add('sheet-on');
      // drawn where the raster figure is (props stay on top and follow the frame's head)
      const fig = el.querySelector('svg .ch-raster');
      const riders = [...el.querySelectorAll('svg .ch-props, svg .ch-back')];
      const onFrame = (i) => {
        const d = s.heads?.[i];
        for (const g of riders) {
          if (d && (d[0] || d[1])) g.setAttribute('transform', `translate(${d[0]} ${d[1]})`);
          else g.removeAttribute('transform');
        }
      };
      const player = createSpritePlayer(el, s, { reduced, mount: fig?.parentNode ?? null, after: fig, onFrame });
      player.done.then(() => riders.forEach((g) => g.removeAttribute('transform')));
      sheet = player;
      // canvas sheets (CH-2) draw their own squash; the rig keeps the hop (root translation) going under them
      const hop = s.rect && rig ? rig.play(action, { squash: 0.2 }) : Promise.resolve(true);
      const shown = player.done.then((ok) => {
        if (sheet === player) el.classList.remove('sheet-on');
        return ok;
      });
      return Promise.all([shown, hop]).then(([ok]) => {
        const a = POSE_ACTION[pose];
        if (ok && a && !ONE_SHOT.has(a)) rig?.loop(a);
        return ok;
      });
    }
    const p = rig ? rig.play(action, o) : Promise.resolve(false);
    return p.then((ok) => {
      const a = POSE_ACTION[pose];
      if (ok && a && !ONE_SHOT.has(a)) rig?.loop(a);
      return ok;
    });
  };
  /** Mouth flaps for `ms` (dialogue reveal). */
  el.talk = (ms = 1200) => el.play('talk', { ms });
  el.stop = () => {
    clearTimeout(blinkTimer);
    rig?.destroy();
    sheet?.stop();
  };
  return el;
}

// ---------- cut-in figure (drop-in for the old renderAvatarLayers) ----------

/** Cut-in pose → rig pose; emotion → expression. */
const EMOTION_EXPR = { joy: 'joy', cry: 'cry', shock: 'shock', angry: 'angry', love: 'love', sweat: 'sweat', shy: 'shy' };

/**
 * Full-body cut-in figure (feet on the slot floor). `setState({pose, emotion})` switches the loop / face; `playSprite()`
 * = the big-win double jump with sparkles; `play(action)` any rig action.
 * @param {object} subject  character ({avatar, name}) or a look
 */
export function renderCutinFigure(subject, { pose = 'idle', emotion = null, name = '', flip = false } = {}) {
  const { look, name: nm } = subjectLook(subject);
  const el = renderChara(look, { size: 420, crop: 'full', pose, expression: EMOTION_EXPR[emotion] ?? 'neutral', flip, title: name || nm, motion: true });
  el.classList.add('ci-chara', 'enter');
  el.source = el.dataset.source;
  el.layered = true;
  const baseSet = el.setState;
  el.setState = (next = {}) => baseSet({ pose: next.pose, expression: next.emotion !== undefined ? EMOTION_EXPR[next.emotion] ?? 'neutral' : undefined });
  el.playSprite = () => {
    const layer = el.querySelector('.ch-fx');
    if (layer) layer.insertAdjacentHTML('beforeend', particlesSvg(spawnParticles('sparkle', { n: 6, seed: 3, origins: [[CX, 700]], spread: 320, loop: false })));
    return el.play('jump').then(() => el.play('jump'));
  };
  return el;
}

/** Cut-in cast preloading (raster art only; SVG placeholders are instant). */
export function preloadChara(subject) {
  const { look } = subjectLook(subject);
  const r = rasterParts(look, currentMeta);
  const urls = r ? [r.base, r.body, r.arms, r.eyesClosed, r.mouthOpen, ...Object.values(r.expr ?? {}), ...Object.values(r.sheets ?? {})].filter(Boolean).map((a) => a.url) : [];
  if (!urls.length || typeof Image === 'undefined') return Promise.resolve();
  return Promise.all(urls.map((u) => new Promise((res) => {
    const im = new Image();
    im.onload = im.onerror = () => res();
    im.src = u;
  }))).then(() => undefined);
}

// ---------- portraits (drop-in API of the old avatar2d portraits) ----------

/** Markup of a round portrait slot (static SVG; nothing to hydrate unless raster art needs a refresh). */
export function portraitHtml(subject, { size = 40, crop = 'face', title = '' } = {}) {
  const { look, name } = subjectLook(subject);
  const c = crop === 'bust' ? 'bust' : crop === 'full' ? 'fit' : 'face';
  return `<span class="av-pt ch-pt ch-${c}" data-look="${esc(lookKey(look))}">${charaSvg(look, { size, crop: c, title: title || name, shadow: false })}</span>`;
}

/** Portrait into an element (replaces its content when the look / size changed). */
export function renderPortrait(el, subject, { size = 40, crop = 'face', title = '' } = {}) {
  if (!el) return;
  const { look, name } = subjectLook(subject);
  const c = crop === 'bust' ? 'bust' : crop === 'full' ? 'fit' : 'face';
  const key = `${lookKey(look)}|${size}|${c}`;
  el.classList.add('av-pt', 'ch-pt', `ch-${c}`);
  if (el.dataset.ptKey === key && el.firstElementChild) return;
  el.dataset.ptKey = key;
  el.innerHTML = charaSvg(look, { size, crop: c, title: title || name, shadow: false });
}

/** Kept for the old call sites: SVG portraits are complete when inserted. */
export function hydratePortraits() {}

/** Tiny static face for 2D board tokens / admin lists (no shadow, face crop). */
export function charaToken(subject, { size = 26, title = '' } = {}) {
  const { look, name } = subjectLook(subject);
  return charaSvg(look, { size, crop: 'face', title: title || name, shadow: false, cls: 'ch-token' });
}

// ---------- group photo ----------

const imageCache = new Map();
function loadImage(src) {
  if (imageCache.has(src)) return imageCache.get(src);
  const p = new Promise((resolve) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = src;
  });
  imageCache.set(src, p);
  p.then((im) => {
    if (!im) imageCache.delete(src);
  });
  return p;
}

/** An SVG string as an image (blob URL; vector only → never taints a canvas). */
async function svgImage(svg) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const im = await new Promise((resolve) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => resolve(null);
      i.src = url;
    });
    return im;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

/**
 * Raster art composed on a canvas (the FULL_VIEW box, like the SVG path): props behind (SVG layer), body + face overlay
 * + arms rotated by the pose's key pose (or the base / an expression swap), raster props, props in front (SVG layer).
 * Same-origin images + vector-only SVG layers → the group photo canvas stays exportable.
 */
async function composeRaster(look, r, { expression, pose, height, title }) {
  const vb = FULL_VIEW;
  const H = Math.max(64, Math.round(height));
  const W = Math.round((H * vb.w) / vb.h);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const e = EXPR_RASTER.includes(expression) ? expression : null;
  const ex = e ? r.expr[e] : null;
  const swap = ex && ex.meta?.overlay === false ? ex : null;
  const over = ex && ex.meta?.overlay !== false ? ex : null;
  const kp = pose ? keyPose(pose) : null;
  const rectOf = (info) => (Array.isArray(info?.meta?.rect) && info.meta.rect.length === 4 ? info.meta.rect : [0, 0, 1024, 1536]);
  const props = rasterPropBoxes(look);
  const urls = [...[swap ?? null, r.body, r.arms, r.base, over].filter(Boolean).map((a) => a.url), ...props.map((p) => p.url)];
  const imgs = new Map(await Promise.all(urls.map(async (u) => [u, await loadImage(u)])));
  const drawProps = (front) => {
    for (const p of props) {
      if ((p.slot === 'back') === front) continue;
      const im = imgs.get(p.url);
      if (im) ctx.drawImage(im, p.x, p.y, p.w, p.h);
    }
  };
  const layer = async (only) => svgImage(charaSvg(look, { size: H, crop: 'full', expression, pose, title, shadow: false, only }));
  const armed = !!(r.body && r.arms && !swap);
  const [backL, frontL, handL] = await Promise.all([layer('back'), layer('front'), armed && look?.props?.hand ? layer('hand') : null]);
  const k = H / vb.h;
  const draw = (info, extra) => {
    const im = imgs.get(info?.url);
    if (!im) return false;
    const [x, y, w, h] = rectOf(info);
    if (extra) extra();
    ctx.drawImage(im, x, y, w, h);
    return true;
  };
  if (backL) ctx.drawImage(backL, 0, 0, W, H);
  ctx.save();
  ctx.scale(k, k);
  ctx.translate(-vb.x, -vb.y);
  // the root key pose (hop / lean) about the feet
  const root = kp?.root;
  if (root) {
    ctx.translate(root.x ?? 0, root.y ?? 0);
    ctx.translate(CX, F);
    if (root.r) ctx.rotate(((root.r ?? 0) * Math.PI) / 180);
    ctx.scale(root.sx ?? 1, root.sy ?? 1);
    ctx.translate(-CX, -F);
  }
  drawProps(false);
  let ok;
  if (r.body && r.arms && !swap) {
    ok = draw(r.body);
    if (over) draw(over);
    const pivots = r.arms.meta?.pivots ?? r.body.meta?.pivots ?? {};
    for (const [side, part, x0, x1] of [['armL', 'armL', 0, CX], ['armR', 'armR', CX, 1024]]) {
      const p = pt(pivots[side], null);
      ctx.save();
      if (p && kp?.[part]?.r) {
        ctx.translate(p[0], p[1]);
        ctx.rotate((kp[part].r * Math.PI) / 180);
        ctx.translate(-p[0], -p[1]);
      }
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, 0, x1 - x0, 1536);
      ctx.clip();
      draw(r.arms);
      ctx.restore();
      // the held item rides with the right arm (its layer carries the upright counter-rotation)
      if (side === 'armR' && handL) ctx.drawImage(handL, vb.x, vb.y, vb.w, vb.h);
      ctx.restore();
    }
  } else {
    ok = draw(swap ?? r.base ?? r.body);
    if (over) draw(over);
  }
  ctx.restore();
  if (!ok) return null;
  if (frontL) ctx.drawImage(frontL, 0, 0, W, H);
  // raster props in front (same root pose as the figure)
  ctx.save();
  ctx.scale(k, k);
  ctx.translate(-vb.x, -vb.y);
  if (root) {
    ctx.translate(root.x ?? 0, root.y ?? 0);
    ctx.translate(CX, F);
    if (root.r) ctx.rotate((root.r * Math.PI) / 180);
    ctx.scale(root.sx ?? 1, root.sy ?? 1);
    ctx.translate(-CX, -F);
  }
  drawProps(true);
  ctx.restore();
  return canvas;
}

/**
 * The figure as an image for canvas drawing: `{img, feet}` (feet = fraction of the image height where the feet sit).
 * Raster art is composed on a canvas (pose + expression + props, same box as the SVG); else the SVG (with the pose baked
 * in) as an image.
 */
export async function charaImage(subject, { expression = 'joy', pose = null, height = 512 } = {}) {
  const { look, name } = subjectLook(subject);
  const vb = FULL_VIEW;
  const feet = (F - vb.y) / vb.h;
  const r = rasterParts(look, currentMeta);
  if (r && (r.base || r.body)) {
    const c = await composeRaster(look, r, { expression, pose, height, title: name }).catch(() => null);
    if (c) return { img: c, feet, kind: 'raster' };
  }
  const svg = charaSvg(look, { size: height, crop: 'full', expression, pose, title: name, shadow: false });
  const im = await svgImage(svg);
  return im ? { img: im, feet, kind: 'svg' } : null;
}
