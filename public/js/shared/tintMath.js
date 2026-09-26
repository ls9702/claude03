// Pure pixel math for tinting neutral paper-doll layers (Stage 5.5-B). No sharp, no DOM, no Node APIs:
// operates on RGBA Uint8Array / Uint8ClampedArray buffers so the browser composer can import or copy it
// verbatim (ImageData.data works as-is). Served as /js/shared/tintMath.js; server/assets/tintMath.js re-exports it.
//
// Contract
// - Every tintable layer is generated in ONE neutral reference colour, recorded in its manifest
//   `meta.tintRef` (hex, measured median of the layer's fill pixels). Hair ≈ #4a4440, outfits ≈ #c8c8c8,
//   skin (mannequin / face overlay) ≈ the mannequin's measured skin median.
// - `tintPixels(data, meta.tintRef, targetHex, {mode})` rewrites each pixel so its luminance RELATIVE to the
//   reference is kept: a pixel exactly as bright as the reference becomes the target colour, darker pixels
//   (shading, line art) become proportionally darker shades of the target, brighter pixels (highlights) go
//   brighter and, once a channel would clip, blend toward white so the luminance ratio still holds.
//   Line art (very dark) therefore stays dark; highlights stay highlights.
// - mode 'full'      : every pixel is tinted (hair, outfits — generated fully neutral).
//   mode 'selective' : only pixels whose hue is close to the reference hue are tinted, weighted
//                      (mannequin skin: the pale-cyan underwear, eye whites etc. keep their colours).
// - Alpha is never changed.

/** '#rgb' / '#rrggbb' → {r,g,b}. */
export function hexToRgb(hex) {
  let s = String(hex).trim().replace(/^#/, '');
  if (s.length === 3) s = [...s].map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(s)) throw new Error(`bad colour: ${hex}`);
  const n = Number.parseInt(s, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }) {
  const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Perceptual-ish luma (Rec. 601 weights on sRGB values, 0..255). */
export const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Hue in degrees (0..360) and chroma (max − min, 0..255). */
export function hueChroma(r, g, b) {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  if (!d) return [0, 0];
  let h;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [(h * 60 + 360) % 360, d];
}

/**
 * Shade of `target` at relative luminance k (k = pixelLuma / refLuma): k ≤ 1 → target × k;
 * k > 1 → target × k with clipped channels blended toward white so luma(result) = luma(target) × k.
 * Returns [r, g, b] (floats, 0..255).
 */
export function shade(target, k) {
  const t = target;
  if (k <= 1) return [t.r * k, t.g * k, t.b * k];
  const want = Math.min(255, luma(t.r, t.g, t.b) * k);
  let r = t.r * k;
  let g = t.g * k;
  let b = t.b * k;
  const mx = Math.max(r, g, b);
  if (mx <= 255) return [r, g, b];
  r = (r * 255) / mx;
  g = (g * 255) / mx;
  b = (b * 255) / mx;
  const l = luma(r, g, b);
  const f = l >= 255 ? 1 : Math.max(0, Math.min(1, (want - l) / (255 - l)));
  return [r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f];
}

/** Weight (0..1) of a pixel for selective tinting: hue near the reference hue, not grey. */
export function selectiveWeight(r, g, b, refHue, { hueTol = 26, hueSoft = 22, minChroma = 10, chromaSoft = 12 } = {}) {
  const [h, c] = hueChroma(r, g, b);
  if (c < minChroma) return 0;
  const cw = Math.min(1, (c - minChroma) / chromaSoft);
  const hd = Math.min(Math.abs(h - refHue), 360 - Math.abs(h - refHue));
  const hw = hd <= hueTol ? 1 : hd >= hueTol + hueSoft ? 0 : 1 - (hd - hueTol) / hueSoft;
  return cw * hw;
}

/**
 * Tint RGBA pixels in place.
 * @param {Uint8Array|Uint8ClampedArray} data  RGBA
 * @param {string} refHex     neutral colour the layer was generated in (manifest meta.tintRef)
 * @param {string} targetHex  wanted colour (avatars.json option `color`)
 * @param {{mode?: 'full'|'selective', hueTol?: number}} [opts]
 * @returns the same array
 */
export function tintPixels(data, refHex, targetHex, { mode = 'full', ...sel } = {}) {
  const ref = hexToRgb(refHex);
  const target = hexToRgb(targetHex);
  const refL = Math.max(1, luma(ref.r, ref.g, ref.b));
  const [refHue] = hueChroma(ref.r, ref.g, ref.b);
  const selective = mode === 'selective';
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const w = selective ? selectiveWeight(r, g, b, refHue, sel) : 1;
    if (w <= 0) continue;
    const [tr, tg, tb] = shade(target, luma(r, g, b) / refL);
    data[i] = Math.round(r + (tr - r) * w);
    data[i + 1] = Math.round(g + (tg - g) * w);
    data[i + 2] = Math.round(b + (tb - b) * w);
  }
  return data;
}

/**
 * Median colour of a layer's "fill" pixels (opaque, not line art, not highlights) → hex.
 * Used when accepting a layer to record `meta.tintRef`. For 'selective' layers pass `hueNear`
 * (reference hue guess) so only matching pixels count.
 */
export function measureFill(data, { minAlpha = 250, minLuma = 30, maxLuma = 245, hueNear, hueTol = 30, minChroma = 12 } = {}) {
  const rs = [];
  const gs = [];
  const bs = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < minAlpha) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const l = luma(r, g, b);
    if (l < minLuma || l > maxLuma) continue;
    if (hueNear !== undefined) {
      const [h, c] = hueChroma(r, g, b);
      const hd = Math.min(Math.abs(h - hueNear), 360 - Math.abs(h - hueNear));
      if (c < minChroma || hd > hueTol) continue;
    }
    rs.push(r);
    gs.push(g);
    bs.push(b);
  }
  if (!rs.length) return null;
  const med = (a) => a.sort((x, y) => x - y)[a.length >> 1];
  return rgbToHex({ r: med(rs), g: med(gs), b: med(bs) });
}
