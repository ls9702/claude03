// Generated-asset lookup for the game client (fallback contract).
//
//   await loadAssetIndex();                       // once at startup; never throws
//   const url = assetUrl('bg-wedding-hall');      // '/assets/generated/bg/wedding-hall.webp?v=…' or null
//   const bg = assetUrl('bg-school', fallbackSvgUrl);
//   findAsset({ kind: 'bg', scene: 'office' });   // match by kind + meta fields
//
// Everything returns null (or the given fallback) when an asset has not been generated/accepted yet,
// so callers keep drawing their SVG / primitive placeholders.

let index = {};
let loading = null;

/** Fetch GET /api/assets once (cached). Resolves to the id → entry map; `{}` on any failure. */
export function loadAssetIndex({ force = false, fetchImpl = globalThis.fetch } = {}) {
  if (loading && !force) return loading;
  loading = (async () => {
    try {
      const res = await fetchImpl('/api/assets', { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      index = data && typeof data.assets === 'object' && data.assets ? data.assets : {};
    } catch {
      index = {};
    }
    return index;
  })();
  return loading;
}

/** URL of an accepted asset, or `fallback` (default null). */
export function assetUrl(id, fallback = null) {
  return index[id]?.url ?? fallback;
}

/** Full entry: {url, kind, width, height, meta, anchor?, sheet?, anim?} or null. */
export function assetInfo(id) {
  return index[id] ?? null;
}

/** First accepted asset whose kind and meta fields all match, e.g. {kind:'frame', tone:'love'}. */
export function findAsset({ kind, ...meta } = {}) {
  for (const [id, a] of Object.entries(index)) {
    if (kind && a.kind !== kind) continue;
    if (Object.entries(meta).every(([k, v]) => a.meta?.[k] === v)) return { id, ...a };
  }
  return null;
}

export function hasAsset(id) {
  return Boolean(index[id]);
}

/** Test/SSR hook: replace the in-memory index. */
export function setAssetIndex(assets) {
  index = assets ?? {};
  loading = Promise.resolve(index);
}
