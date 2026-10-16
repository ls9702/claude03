// Chiikawa art pipeline (CH-2) — asset ids, delivered-file names and aliases (pure, no I/O).
//
// Renderer contract (public/js/ui/chara.js `rasterParts`): `<prefix>-<part>` with prefix `ch-<roster id>`, `npc-<species>`,
// `pet-<species>` and part base | body | arms | eyes-closed | mouth-open | expr-<e> | sheet-<action>; props `prop-<id>`.
// Manifest ids only use [a-z0-9-], so data ids with `_` (bear_cub, guinea_pig, chef_hat) are written with `-`
// (`npc-bear-cub-base`, `prop-chef-hat`); the renderer looks both spellings up.
//
// Delivered files (the user's local Gemini skill): `<id>.png` (lossless copy) and/or `<id>_original.jpg`; `<id>-2.png`
// = a second take. Aliases map the request / test names onto manifest ids:
//   ch-<c>-<expr>           → ch-<c>-expr-<expr>      (ch-chiikawa-cry → ch-chiikawa-expr-cry)
//   ch-<c>-noarms           → ch-<c>-body             (+ ch-<c>-arms derived from base − body)
//   ch-<c>-jump             → ch-<c>-sheet-jump
//   npc-friend-<s>[-base]   → npc-<s>-base,  npc-<s> → npc-<s>-base,  pet-<s> → pet-<s>-base
//   bg-ch-<scene>           → bg-<scene>
//   prop-hat-chef           → prop-chef-hat  (prop-<slotword>-<name> → prop-<name>-<slotword> when that exists)
//   any `_`                 → `-`

/** The style sentence every Chiikawa request prompt starts with (docs/asset-requests/chiikawa-*.json `style`). */
export const CHIIKAWA_STYLE =
  'Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border.';

export const CHARA_EXPRESSIONS = Object.freeze(['joy', 'cry', 'shock', 'angry', 'love', 'sweat']);
/** Parts a roster character can have (renderer contract). `noarms` is only a delivered-file name (→ body). */
export const CHARA_PARTS = Object.freeze(['base', 'body', 'arms', 'eyes-closed', 'mouth-open', ...CHARA_EXPRESSIONS.map((e) => `expr-${e}`), 'sheet-jump', 'sheet-wave', 'sheet-cheer', 'sheet-cry', 'sheet-shock', 'sheet-walk', 'sheet-talk']);
/** Parts generated for every roster character by scripts/gen-chara-manifest.js (what the art request asks for). */
export const ROSTER_ITEM_PARTS = Object.freeze(['base', 'body', 'arms', 'eyes-closed', 'mouth-open', 'expr-joy', 'expr-cry', 'expr-shock', 'sheet-jump']);
export const PART_LABELS = Object.freeze({
  base: '기본',
  body: '몸 (팔 없음)',
  arms: '팔 (자동 추출)',
  'eyes-closed': '눈 감음 (깜빡임)',
  'mouth-open': '입 벌림 (말하기)',
  'expr-joy': '기쁨',
  'expr-cry': '울음',
  'expr-shock': '놀람',
  'expr-angry': '화남',
  'expr-love': '두근',
  'expr-sweat': '진땀',
  'sheet-jump': '점프 4프레임',
});
export const PROP_SLOTS = Object.freeze(['head', 'face', 'neck', 'hand', 'back']);
/** Overlay parts of an MC dog (edits of mc-<dog>-neutral, diffed into overlays). */
export const MC_OVERLAYS = Object.freeze(['eyes-closed', 'mouth-open']);

const ID_SAFE = (s) => String(s).toLowerCase().replace(/_/g, '-');
/** A data id (roster / species / prop, may contain `_`) as used inside an asset id. */
export const assetSlug = ID_SAFE;

/** Asset id of a character / npc / pet part, e.g. charaAssetId('npc', 'bear_cub', 'base') → 'npc-bear-cub-base'. */
export function charaAssetId(group, name, part) {
  return `${group}-${ID_SAFE(name)}-${part}`;
}
export const propAssetId = (propId) => `prop-${ID_SAFE(propId)}`;

/**
 * Role of an asset id: {group: 'ch'|'npc'|'pet', name, part, prefix} for character parts, {group: 'prop', name} for props,
 * {group: 'mc', dog, part} for MC art, {group: 'bg', scene}, else null. `name` is the slug (hyphens).
 */
export function idRole(id) {
  const s = String(id ?? '');
  let m = /^(ch|npc|pet)-([a-z0-9-]+?)-(base|body|arms|noarms|eyes-closed|mouth-open|expr-[a-z]+|sheet-[a-z]+)$/.exec(s);
  if (m) return { group: m[1], name: m[2], part: m[3], prefix: `${m[1]}-${m[2]}` };
  m = /^prop-([a-z0-9-]+)$/.exec(s);
  if (m) return { group: 'prop', name: m[1] };
  m = /^mc-(hoya|bomi)-(.+)$/.exec(s);
  if (m) return { group: 'mc', dog: m[1], part: m[2] };
  if (s === 'mc-duo') return { group: 'mc', dog: 'duo', part: 'duo' };
  m = /^bg-([a-z0-9-]+)$/.exec(s);
  if (m) return { group: 'bg', scene: m[1] };
  return null;
}

/**
 * Candidate manifest ids for a delivered stem (most specific first). `known(id)` decides; the first known one wins.
 * @param {string} stem  file name without extension, `_original` and take suffix
 */
export function aliasCandidates(stem) {
  const s = ID_SAFE(stem.trim());
  const out = [s];
  let m;
  if ((m = /^(ch-[a-z0-9-]+?)-(joy|cry|shock|angry|love|sweat)$/.exec(s))) out.push(`${m[1]}-expr-${m[2]}`);
  if ((m = /^(ch-[a-z0-9-]+?)-no-?arms$/.exec(s))) out.push(`${m[1]}-body`);
  if ((m = /^(ch-[a-z0-9-]+?)-(jump|wave|cheer|walk)$/.exec(s))) out.push(`${m[1]}-sheet-${m[2]}`);
  if ((m = /^npc-friend-([a-z0-9-]+?)(?:-base)?$/.exec(s))) out.push(`npc-${m[1]}-base`);
  if ((m = /^(npc|pet)-([a-z0-9-]+)$/.exec(s)) && !/-(base|body|arms|eyes-closed|mouth-open)$/.test(s)) out.push(`${m[1]}-${m[2]}-base`);
  if ((m = /^bg-ch-([a-z0-9-]+)$/.exec(s))) out.push(`bg-${m[1]}`);
  if ((m = /^prop-(hat|glasses|neck|hand|back|bag)-([a-z0-9-]+)$/.exec(s))) out.push(`prop-${m[2]}-${m[1]}`);
  return [...new Set(out)];
}

/** Canonical manifest id of a delivered stem, or null. */
export function canonicalId(stem, known) {
  for (const c of aliasCandidates(stem)) if (known(c)) return c;
  return null;
}

/**
 * Parse a delivered file name: `<stem>[-<take>][_original].<ext>`.
 * The take suffix (`-2` … `-9`) is only split off when the remainder is a known id (after aliases) and the full stem
 * is not — `known` decides (an id that really ends in a digit stays whole).
 * @returns {{name, stem, id: string|null, take: number, original: boolean, ext}}
 */
export function parseDeliveredName(name, known = () => false) {
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();
  let stem = name.slice(0, ext ? -(ext.length + 1) : undefined);
  let original = false;
  if (/_original$/i.test(stem)) {
    original = true;
    stem = stem.replace(/_original$/i, '');
  }
  stem = stem.toLowerCase();
  let id = canonicalId(stem, known);
  let take = 1;
  const t = /^(.*)-([2-9])$/.exec(stem);
  if (!id && t) {
    const base = canonicalId(t[1], known);
    if (base) {
      id = base;
      take = Number(t[2]);
      stem = t[1];
    }
  }
  return { name, stem, id, take, original, ext };
}

/**
 * Pick one file per id from parsed entries: the wanted take (default 1; `takes[id]` or `takeAll`), preferring the
 * lossless `<id>.png` copy over `<id>_original.jpg`; when the wanted take is missing, the lowest other take.
 * @param {{id, take, original, ext, name}[]} entries
 * @param {{takes?: Record<string, number>, takeAll?: number}} opts
 * @returns {Map<string, {entry, fallback: boolean, alternatives: string[]}>}
 */
export function pickTakes(entries, { takes = {}, takeAll = null } = {}) {
  const byId = new Map();
  for (const e of entries) {
    if (!e.id) continue;
    if (!byId.has(e.id)) byId.set(e.id, []);
    byId.get(e.id).push(e);
  }
  const out = new Map();
  const rank = (e) => (e.original ? 1 : 0) + (e.ext === 'png' ? 0 : e.ext === 'webp' ? 0.2 : 0.4);
  for (const [id, list] of byId) {
    const want = takes[id] ?? takeAll ?? 1;
    const wanted = list.filter((e) => e.take === want).sort((a, b) => rank(a) - rank(b));
    const others = list.filter((e) => e.take !== want).sort((a, b) => a.take - b.take || rank(a) - rank(b));
    const entry = wanted[0] ?? others[0];
    out.set(id, { entry, fallback: !wanted.length, alternatives: list.filter((e) => e !== entry).map((e) => e.name) });
  }
  return out;
}

/** Order in which delivered chara / mc ids must be processed (bases before their edits, chiikawa first). */
export function importRank(id) {
  const r = idRole(id);
  if (!r) return 50;
  if (r.group === 'ch' || r.group === 'npc' || r.group === 'pet') {
    const master = r.prefix === 'ch-chiikawa' ? 0 : 1;
    const part = { base: 0, body: 2, noarms: 2, arms: 3 }[r.part] ?? (r.part.startsWith('sheet-') ? 5 : 4);
    return part * 2 + master;
  }
  if (r.group === 'mc') return r.part === 'neutral' ? 20 : MC_OVERLAYS.includes(r.part) ? 22 : 21;
  if (r.group === 'prop') return 30;
  return 40;
}
