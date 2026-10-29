// Generated-asset lookup for the game client (fallback contract).
//
//   await loadAssetIndex();                       // once at startup; never throws
//   const url = assetUrl('bg-wedding-hall');      // '/assets/generated/bg/wedding-hall.webp?v=…' or null
//   const bg = assetUrl('bg-school', fallbackSvgUrl);
//   findAsset({ kind: 'bg', scene: 'office' });   // match by kind + meta fields
//   findAsset({ kind: 'card', card: 'taxi', world: 'chiikawa' }); // 세계 설정: the world's variant, else the shared art
//
// Everything returns null (or the given fallback) when an asset has not been generated/accepted yet,
// so callers keep drawing their SVG / primitive placeholders.

let index = {};
let entries = []; // Object.entries(index), kept with the index (findAsset scans it per call)
let loading = null;

function setIndex(assets) {
  index = assets && typeof assets === 'object' ? assets : {};
  entries = Object.entries(index);
}

/** Fetch GET /api/assets once (cached). Resolves to the id → entry map; `{}` on any failure. */
export function loadAssetIndex({ force = false, fetchImpl = globalThis.fetch } = {}) {
  if (loading && !force) return loading;
  loading = (async () => {
    try {
      const res = await fetchImpl('/api/assets', { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setIndex(data && typeof data.assets === 'object' && data.assets ? data.assets : {});
    } catch {
      setIndex({});
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

/**
 * First accepted asset whose kind and meta fields all match, e.g. {kind:'frame', tone:'love'}.
 * 세계 설정 (`world`, optional): world variants carry `meta.world` ('chiikawa' | 'real'; cards / items / treasures / icons,
 * e.g. `card-taxi-chiikawa`). With `world` the variant of that world wins, else the shared art (no `meta.world`); a
 * variant of ANOTHER world is never returned. Without `world` only shared art matches (variants are skipped).
 */
export function findAsset({ kind, world = null, ...meta } = {}) {
  const want = Object.entries(meta);
  let shared = null;
  for (const [id, a] of entries) {
    if (kind && a.kind !== kind) continue;
    if (!want.every(([k, v]) => a.meta?.[k] === v)) continue;
    const w = a.meta?.world ?? null;
    if (w == null) {
      if (!world) return { id, ...a };
      shared ??= { id, ...a };
    } else if (world && w === world) return { id, ...a };
  }
  return shared;
}

export function hasAsset(id) {
  return Boolean(index[id]);
}

/** Test/SSR hook: replace the in-memory index. */
export function setAssetIndex(assets) {
  setIndex(assets ?? {});
  loading = Promise.resolve(index);
}
