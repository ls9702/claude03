// Quality presets for the 3D board (pure → unit-tested).
//   high: full canvas resolution, particles, orbit controls
//   low:  75% render scale, 30fps cap, fewer props/particles
//   tv:   render at 720p and CSS-upscale, no particles, fixed overhead camera (Raspberry Pi TV)
export const QUALITY_PRESETS = {
  high: { name: 'high', label: '고화질', renderScale: 1, renderHeight: null, maxFps: 60, particles: 1, props: 1, controls: true, fixedCamera: false },
  low: { name: 'low', label: '저사양', renderScale: 0.75, renderHeight: null, maxFps: 30, particles: 0.4, props: 0.55, controls: true, fixedCamera: false },
  tv: { name: 'tv', label: 'TV 모드', renderScale: 1, renderHeight: 720, maxFps: 30, particles: 0, props: 0.8, controls: false, fixedCamera: true },
};
export const QUALITY_NAMES = Object.keys(QUALITY_PRESETS);

/**
 * Pick a preset: URL param > saved choice > device heuristic.
 * @param {{param?:string|null, stored?:string|null, isMobile?:boolean, cores?:number, memory?:number}} env
 */
export function pickQuality({ param = null, stored = null, isMobile = false, cores = 8, memory = 8 } = {}) {
  for (const v of [param, stored]) if (v && QUALITY_PRESETS[v]) return v;
  if ((cores && cores <= 4) || (memory && memory <= 2)) return 'low';
  if (isMobile && cores && cores <= 6) return 'low';
  return 'high';
}

/** Drawing-buffer size for a canvas of cssW×cssH under a preset (pixelRatio is always 1). */
export function renderSize(preset, cssW, cssH) {
  const p = typeof preset === 'string' ? QUALITY_PRESETS[preset] ?? QUALITY_PRESETS.high : preset;
  const w = Math.max(1, Math.round(cssW));
  const h = Math.max(1, Math.round(cssH));
  if (p.renderHeight && h > p.renderHeight) {
    const s = p.renderHeight / h;
    return { width: Math.max(1, Math.round(w * s)), height: p.renderHeight };
  }
  const s = p.renderScale ?? 1;
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

/** Particle count for a burst (0 when particles are off). */
export const particleCount = (preset, base) => Math.round(base * (QUALITY_PRESETS[preset]?.particles ?? 1));

/** Frame-rate probe decision: fall back to 2D when the average over the probe window is below `min`. */
export function shouldFallback(frames, ms, min = 15) {
  if (ms <= 0) return false;
  return (frames * 1000) / ms < min;
}
