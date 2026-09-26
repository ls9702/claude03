// Avatar part validation (pure). Part ids are stable across stages.
import { getAvatars } from '../data/index.js';

/** Return a complete avatar, replacing unknown/missing parts with defaults. */
export function sanitizeAvatar(input) {
  const defs = getAvatars();
  const out = {};
  const src = input && typeof input === 'object' ? input : {};
  for (const key of defs.order) {
    const options = defs.parts[key];
    const v = src[key];
    out[key] = typeof v === 'string' && options.some((o) => o.id === v) ? v : defs.default[key];
  }
  return out;
}
