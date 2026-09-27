// Canvas-text sprites / glyph textures shared by the 3D board modules.
import * as THREE from 'three';

// Emoji fonts are left to the browser's per-glyph fallback (listing them here would make them supply
// the space glyph too, which spreads Korean text apart).
export const FONT_STACK = '"Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", "Noto Sans CJK KR", "Malgun Gothic", system-ui, sans-serif';

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Canvas text never carries bidi controls (a name with U+202E would mirror the tag, A10). */
const BIDI = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/g;
/** Pill-shaped text label on a canvas. */
export function textCanvas(rawText, { size = 40, weight = 800, color = '#2d2a32', bg = 'rgba(255,255,255,0.94)', pad = 16, border = null, borderWidth = 5 } = {}) {
  const text = String(rawText ?? '').replace(BIDI, '');
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = `${weight} ${size}px ${FONT_STACK}`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  const h = Math.ceil(size * 1.5) + pad;
  c.width = w;
  c.height = h;
  ctx.font = font;
  if (bg) {
    ctx.fillStyle = bg;
    roundRect(ctx, 0, 0, w, h, h / 2);
    ctx.fill();
  }
  if (border) {
    ctx.lineWidth = borderWidth;
    ctx.strokeStyle = border;
    roundRect(ctx, borderWidth / 2, borderWidth / 2, w - borderWidth, h - borderWidth, h / 2);
    ctx.stroke();
  }
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + size * 0.05);
  return c;
}

export function canvasTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

/**
 * Billboard text sprite. `height` = world height of the label.
 * Always drawn on top (no depth test) so name tags / signs stay readable.
 */
export function makeTextSprite(text, { height = 0.6, depthTest = false, renderOrder = 20, ...opts } = {}) {
  const c = textCanvas(text, opts);
  const tex = canvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest, depthWrite: false });
  const sp = new THREE.Sprite(mat);
  sp.scale.set((height * c.width) / c.height, height, 1);
  sp.renderOrder = renderOrder;
  sp.userData.aspect = c.width / c.height;
  sp.userData.baseHeight = height;
  return sp;
}

export function disposeSprite(sp) {
  sp.material.map?.dispose();
  sp.material.dispose();
}

/** Cached square texture with a glyph (emoji or short text) in a white bubble. */
const glyphCache = new Map();
export function glyphTexture(glyph, { bubble = true } = {}) {
  const key = `${glyph}|${bubble}`;
  if (glyphCache.has(key)) return glyphCache.get(key);
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const short = [...glyph].length <= 2;
  const size = short ? 84 : 46;
  ctx.font = `900 ${size}px ${FONT_STACK}`;
  const tw = ctx.measureText(glyph).width;
  const W = Math.max(128, Math.ceil(tw + 48));
  c.width = W;
  c.height = 128;
  ctx.font = `900 ${size}px ${FONT_STACK}`;
  if (bubble) {
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    roundRect(ctx, 4, 4, W - 8, 112, 56);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(W / 2 - 12, 110);
    ctx.lineTo(W / 2, 126);
    ctx.lineTo(W / 2 + 12, 110);
    ctx.fill();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e2504c';
  ctx.fillText(glyph, W / 2, 62);
  const tex = canvasTexture(c);
  tex.userData = { aspect: W / 128 };
  glyphCache.set(key, tex);
  return tex;
}

/** Does this browser draw color emoji on canvas? (else icon atlases fall back to text) */
let emojiOk = null;
export function canvasHasEmoji() {
  if (emojiOk != null) return emojiOk;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.font = `28px ${FONT_STACK}`;
    ctx.textBaseline = 'middle';
    ctx.fillText('💰', 2, 16);
    const d = ctx.getImageData(0, 0, 32, 32).data;
    emojiOk = false;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 0 && (Math.abs(d[i] - d[i + 1]) > 30 || Math.abs(d[i + 1] - d[i + 2]) > 30)) {
        emojiOk = true;
        break;
      }
    }
  } catch {
    emojiOk = false;
  }
  return emojiOk;
}
