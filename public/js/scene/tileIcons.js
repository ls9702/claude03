// Tile icons of the 3D board atlas (pure, node-tested in test/asset-worlds.test.js): which asset-studio icon
// (manifest kind `icon`, `meta.tile`) draws a tile type. A type first uses its OWN icon (`icon-<type>`, meta.tile = the
// type: salary, pass, start, hunt …); until that is accepted it borrows an older shared one (salary → money, pass →
// shop, heart → love, loss → bad, habit → school …); with neither the atlas keeps the glyph.

/** Older shared tile icons (meta.tile) a type borrows while its own icon is not accepted yet. */
export const ICON_ASSET_TILE = Object.freeze({
  money: 'money',
  heart: 'love',
  job: 'job',
  house: 'house',
  treasure: 'treasure',
  card: 'card',
  shop: 'shop',
  stop: 'stop',
  loss: 'bad',
  goal: 'goal',
  habit: 'school',
  salary: 'money',
  pass: 'shop',
});

/**
 * `meta.tile` values to look up for a tile, in order: 📝 glyph → school (the old 수능 stop), the type's own icon, the
 * borrowed one. Duplicates removed.
 * @param {string} type  tile type
 * @param {string} [glyph] the tile's glyph (atlas key)
 * @returns {string[]}
 */
export function tileIconCandidates(type, glyph = null) {
  const out = [];
  const add = (t) => {
    if (typeof t === 'string' && t && !out.includes(t)) out.push(t);
  };
  if (glyph === '📝') add('school');
  add(type);
  add(ICON_ASSET_TILE[type]);
  return out;
}

/**
 * First accepted tile icon for a tile (`find` = assets.js `findAsset`; `world` = the room's world → a world variant
 * of the icon wins over the shared one), else null.
 * @param {string} type
 * @param {{glyph?: string, world?: string|null, find: (q: object) => object|null}} opts
 */
export function findTileIcon(type, { glyph = null, world = null, find } = {}) {
  if (typeof find !== 'function') return null;
  for (const tile of tileIconCandidates(type, glyph)) {
    const a = find({ kind: 'icon', tile, ...(world ? { world } : {}) });
    if (a?.url) return a;
  }
  return null;
}
