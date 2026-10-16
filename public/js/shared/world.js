// 세계 설정 (pure, isomorphic: no imports — the server re-exports it from server/game/world.js, the client imports it
// as /js/shared/world.js). Room config `world: 'chiikawa' | 'real'`: 🐹 치이카와 모드 (the default of NEW rooms) or 🏙️
// 현실 모드 (today's realistic content). Only the CONTENT differs (jobs, items, cards, treasures, events, news, tile
// labels, lines …); the rules, the roster looks and the family rules are the same in both worlds.
//
// The data files ARE the real world. A world is an OVERLAY `{<dataName>: patch}` (server/data/worlds/<world>.json;
// `/api/meta.worldOverlays`) merged over the real data by `worldData(data, world, overlays)`:
//   - an array of objects with `id` patched by `{replace: {id: {fields…}}, add: [entries], remove: [ids]}` — `replace`
//     shallow-merges fields into the entry with that id (a field set to null is deleted), `add` appends new entries
//     (an id that already exists replaces that entry), `remove` drops entries; order remove → replace → add;
//   - plain objects deep-merge (objects merge, arrays and scalars replace); `null` deletes a key;
//   - keys starting with `_` are comments (never merged).
// A room without `config.world` (old saves, engine tests) plays the REAL world (`worldOf`).

export const WORLDS = ['chiikawa', 'real'];
/** New rooms (admin create form, `validateRoomConfig`). */
export const DEFAULT_WORLD = 'chiikawa';
/** A room whose config has no (valid) world: old saves and engine tests keep today's content. */
export const ENGINE_WORLD = 'real';

/** `/api/meta.worlds` (admin form / lobby label). */
export const WORLD_INFO = Object.freeze([
  Object.freeze({ id: 'chiikawa', name: '치이카와 모드', icon: '🐹', desc: '토벌·풀뽑기 검정·쿠지 뽑기! 직업·아이템·카드·보물·이벤트가 치이카와 세상 것으로 바뀌어요' }),
  Object.freeze({ id: 'real', name: '현실 모드', icon: '🏙️', desc: '공무원·의사·회사원 직업, 경차·노트북, 전국 로또 — 현실 세계 그대로의 인생' }),
]);

export const isWorld = (w) => WORLDS.includes(w);

/** The world a room plays (config.world, else the real world). */
export function worldOf(room) {
  const w = room?.config?.world;
  return isWorld(w) ? w : ENGINE_WORLD;
}

/** {id, name, icon, desc} of a world (unknown → the real world). */
export function worldInfo(id) {
  return WORLD_INFO.find((w) => w.id === id) ?? WORLD_INFO.find((w) => w.id === ENGINE_WORLD);
}

/** 「🐹 치이카와 모드」 */
export const worldLabel = (id) => {
  const w = worldInfo(id);
  return `${w.icon} ${w.name}`;
};

// ---------- patch ----------

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const PATCH_KEYS = ['replace', 'add', 'remove'];
/** An `{replace?, add?, remove?}` id-array patch (and nothing else but `_comment` keys). */
const isIdPatch = (p) => isObj(p) && Object.keys(p).some((k) => PATCH_KEYS.includes(k)) && Object.keys(p).every((k) => PATCH_KEYS.includes(k) || k.startsWith('_'));
/** An array of objects that all carry an `id` (items, cards, jobs …). */
const isIdArray = (a) => Array.isArray(a) && a.every((x) => isObj(x) && x.id != null);

/** Shallow-merge `fields` into `entry` (null deletes a field; `_` keys skipped). */
function mergeEntry(entry, fields) {
  const out = { ...entry };
  for (const [k, v] of Object.entries(fields ?? {})) {
    if (k.startsWith('_')) continue;
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out;
}

function patchIdArray(base, p) {
  const remove = new Set(Array.isArray(p.remove) ? p.remove : []);
  let out = base.filter((x) => !remove.has(x.id));
  if (isObj(p.replace)) out = out.map((x) => (Object.hasOwn(p.replace, x.id) ? mergeEntry(x, p.replace[x.id]) : x));
  for (const e of Array.isArray(p.add) ? p.add : []) {
    if (!isObj(e) || e.id == null) continue;
    const clean = mergeEntry({}, e);
    const i = out.findIndex((x) => x.id === e.id);
    if (i >= 0) out[i] = clean;
    else out.push(clean);
  }
  return out;
}

/**
 * Apply an overlay patch to a base value (pure; never mutates; unchanged subtrees are shared with `base`).
 * See the header for the format.
 */
export function applyPatch(base, patch) {
  if (patch === undefined) return base;
  if (isIdPatch(patch) && (isIdArray(base) || base === undefined)) return patchIdArray(base ?? [], patch);
  if (!isObj(patch) || !isObj(base)) return patch;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (k.startsWith('_')) continue;
    if (v === null) delete out[k];
    else out[k] = applyPatch(base[k], v);
  }
  return out;
}

/**
 * Problems of an overlay against its base data (for tests / tools; `applyPatch` itself is lenient): `replace` /
 * `remove` of an id that does not exist, `add` of an id that already exists, an id patch over a non-id value.
 * @returns {string[]}
 */
export function patchProblems(base, patch, at = '') {
  const out = [];
  if (patch === undefined || patch === null) return out;
  if (isIdPatch(patch)) {
    if (!isIdArray(base ?? [])) return [`${at}: id patch over a value that is not an array of {id} objects`];
    const ids = new Set((base ?? []).map((x) => x.id));
    for (const id of patch.remove ?? []) if (!ids.has(id)) out.push(`${at}: remove of unknown id ${id}`);
    const removed = new Set(patch.remove ?? []);
    for (const id of Object.keys(patch.replace ?? {})) if (!ids.has(id) || removed.has(id)) out.push(`${at}: replace of unknown id ${id}`);
    const added = new Set();
    for (const e of patch.add ?? []) {
      if (!isObj(e) || e.id == null) out.push(`${at}: add entry without id`);
      else if ((ids.has(e.id) && !removed.has(e.id)) || added.has(e.id)) out.push(`${at}: add of existing id ${e.id}`);
      else added.add(e.id);
    }
    return out;
  }
  if (isObj(patch) && isObj(base)) {
    for (const [k, v] of Object.entries(patch)) if (!k.startsWith('_')) out.push(...patchProblems(base[k], v, at ? `${at}.${k}` : k));
  }
  return out;
}

function deepFreeze(obj) {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const v of Object.values(obj)) deepFreeze(v);
  }
  return obj;
}

// ---------- world data ----------

/** base data → Map(world → {overlays, data}) (memo) · merged data → {base, world} (so a merged object is never re-patched). */
const MEMO = new WeakMap();
const MERGED = new WeakMap();

/**
 * The game data of a world: the real world = `data` itself; another world = `data` with its overlay
 * (`overlays[world]`, `{<dataName>: patch}`) applied — memoized per (data, world, overlays) and deep-frozen. Passing an
 * already merged object is safe (it is resolved from its base). Unknown worlds / no overlay → `data`.
 * @param {object} data   gameData() on the server, /api/meta on the client
 * @param {string} world
 * @param {object} overlays {world: overlay}
 */
export function worldData(data, world, overlays = null) {
  if (!data || typeof data !== 'object') return data;
  const merged = MERGED.get(data);
  if (merged) {
    if (merged.world === world) return data;
    return worldData(merged.base, world, overlays);
  }
  const overlay = isWorld(world) && world !== ENGINE_WORLD ? overlays?.[world] : null;
  if (!isObj(overlay)) return data;
  let byWorld = MEMO.get(data);
  if (!byWorld) MEMO.set(data, (byWorld = new Map()));
  const hit = byWorld.get(world);
  if (hit && hit.overlays === overlays) return hit.data;
  const out = { ...data };
  for (const [name, patch] of Object.entries(overlay)) {
    if (name.startsWith('_')) continue;
    if (patch === null) delete out[name];
    else out[name] = applyPatch(data[name], patch);
  }
  deepFreeze(out);
  byWorld.set(world, { overlays, data: out });
  MERGED.set(out, { base: data, world });
  return out;
}

/** The world a data object was merged for (`'real'` for base data). */
export const dataWorld = (data) => MERGED.get(data)?.world ?? ENGINE_WORLD;

// ---------- client: the /api/meta of a world ----------

const META_MEMO = new WeakMap(); // merged data → world meta
const META_BASE = new WeakMap(); // world meta → the base /api/meta

/**
 * Client (`/api/meta`): the meta of a room's world — `worldData(meta, world, meta.worldOverlays)` plus the two places
 * where the meta's shape differs from the data files: the overlay's `tones` patch also lands on `meta.presentation`
 * (tones.json is served as `presentation`) and its `lines.mc` pools on `meta.mc.lines` (the real meta keeps the MC
 * pools there; `meta.lines.mc` stays too). The real world (or a meta without overlays) = `meta` itself. Memoized per
 * merged object, deep-frozen; passing a world meta again is safe.
 * @param {object} meta  /api/meta (real world + `worldOverlays`)
 * @param {string} world 'chiikawa' | 'real'
 */
export function worldMeta(meta, world) {
  if (!meta || typeof meta !== 'object') return meta;
  const base = MERGED.get(meta)?.base ?? META_BASE.get(meta) ?? meta;
  const merged = worldData(base, world, base.worldOverlays);
  if (merged === base) return base;
  const hit = META_MEMO.get(merged);
  if (hit) return hit;
  const overlay = base.worldOverlays?.[world] ?? {};
  const out = { ...merged };
  if (isObj(overlay.tones) && isObj(merged.presentation)) out.presentation = applyPatch(merged.presentation, overlay.tones);
  const mcLines = merged.lines?.mc;
  if (isObj(mcLines) && isObj(merged.mc)) out.mc = { ...merged.mc, lines: { ...(merged.mc.lines ?? {}), ...mcLines } };
  deepFreeze(out);
  META_MEMO.set(merged, out);
  META_BASE.set(out, base);
  MERGED.set(out, { base, world });
  return out;
}
