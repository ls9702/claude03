// Character looks (pure). CH-1 (Chiikawa conversion): a player character is a roster character + props,
//   character.avatar = {character: rosterId, props: {head?, face?, neck?, hand?, back?}}   (roster.json / props.json)
// NPC friends (단짝 후보 / 단짝) look like {npc: speciesId, props} (npcs.json), pets (반려동물) like {pet: speciesId}
// (pets.json). The human paper-doll avatar (avatars.json) is LEGACY: old saves and old clients are migrated here
// deterministically (a hash of the old avatar JSON picks the roster character / species; the old accessory maps to a prop).
import { getAvatars, getNpcs, getPets, getProps, getRoster } from '../data/index.js';

export const PROP_SLOTS = ['head', 'face', 'neck', 'hand', 'back'];
/** Keys of a legacy human avatar (avatars.json `order`). */
const HUMAN_KEYS = ['body', 'build', 'skin', 'face', 'eyes', 'mouth', 'cheek', 'hair', 'hairColor', 'outfit', 'outfitColor', 'accessory'];
/** Legacy accessory → prop (same slot rules as a player's choice). */
export const ACCESSORY_PROPS = Object.freeze({
  glasses: { face: 'round_glasses' },
  sunglasses: { face: 'sunglasses' },
  cap: { head: 'beanie' },
  ribbon: { head: 'ribbon' },
  headband: { head: 'headband' },
  earrings: { neck: 'necklace' },
  hairpin: { head: 'flower_pin' },
});

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** FNV-1a over the joined parts (uint32). */
export function hash32(...parts) {
  let h = 0x811c9dc5;
  for (const ch of parts.map(String).join('|')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** JSON with sorted object keys (stable across key order). */
export function stableJson(v) {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

const defsOf = (data = {}) => ({
  roster: data.roster ?? getRoster(),
  props: data.props ?? getProps(),
  npcs: data.npcs ?? getNpcs(),
  pets: data.pets ?? getPets(),
});

/** A legacy human avatar (avatars.json parts, no roster / npc / pet id). */
export function isHumanAvatar(a) {
  if (!isObj(a) || 'character' in a || 'npc' in a || 'pet' in a) return false;
  return HUMAN_KEYS.some((k) => typeof a[k] === 'string');
}

/** Choosable props by id (props.json `choice: true`). */
function choiceProp(defs, id) {
  const p = typeof id === 'string' ? defs.props.props.find((x) => x.id === id) : null;
  return p && p.choice ? p : null;
}

/** Valid choosable props, one per slot, in slot order (empty / unknown / wrong-slot ids dropped). */
export function sanitizeProps(input, data) {
  const defs = defsOf(data);
  const src = isObj(input) ? input : {};
  const out = {};
  for (const slot of PROP_SLOTS) {
    const p = choiceProp(defs, src[slot]);
    if (p && p.slot === slot) out[slot] = p.id;
  }
  return out;
}

/** Props of a legacy accessory id (glasses → round glasses, ribbon → ribbon, …; else none). */
export const accessoryProps = (accessory, data) => sanitizeProps(ACCESSORY_PROPS[accessory] ?? {}, data);

/** Old human avatar → a roster character picked by a hash of its JSON + the mapped accessory. */
export function migrateHumanAvatar(human, data) {
  const defs = defsOf(data);
  const ids = defs.roster.characters.map((c) => c.id);
  const character = ids[hash32('look', stableJson(human)) % ids.length];
  return { character, props: accessoryProps(human?.accessory, data) };
}

/**
 * A complete player look `{character, props}`: unknown character → the roster default, props validated per slot
 * (choosable props only). A legacy human avatar is migrated (deterministic).
 */
export function sanitizeAvatar(input, data) {
  if (isHumanAvatar(input)) return migrateHumanAvatar(input, data);
  const defs = defsOf(data);
  const src = isObj(input) ? input : {};
  const known = defs.roster.characters.some((c) => c.id === src.character);
  return { character: known ? src.character : defs.roster.default ?? defs.roster.characters[0].id, props: sanitizeProps(src.props, data) };
}

/** LEGACY: a complete human avatar (avatars.json parts; unknown / missing parts → defaults). Asset pipeline only. */
export function sanitizeHumanAvatar(input) {
  const defs = getAvatars();
  const out = {};
  const src = isObj(input) ? input : {};
  for (const key of defs.order) {
    const options = defs.parts[key];
    const v = src[key];
    out[key] = typeof v === 'string' && options.some((o) => o.id === v) ? v : defs.default[key];
  }
  return out;
}

/** A seeded random player look: roster character + 0–2 choosable props in distinct slots (CPU characters). */
export function randomLook(seed, data) {
  const defs = defsOf(data);
  const chars = defs.roster.characters;
  const character = chars[hash32(seed, 'character') % chars.length].id;
  const n = hash32(seed, 'propCount') % 3;
  const slots = [...PROP_SLOTS].sort((a, b) => hash32(seed, 'slot', a) - hash32(seed, 'slot', b)).slice(0, n);
  const props = {};
  for (const slot of slots) {
    const opts = defs.props.props.filter((p) => p.choice && p.slot === slot);
    if (opts.length) props[slot] = opts[hash32(seed, 'prop', slot) % opts.length].id;
  }
  return sanitizeAvatar({ character, props }, data);
}

// ---------- NPC friends / pets ----------

const speciesIds = (list) => (list?.species ?? []).map((s) => s.id);

/** An NPC friend look `{npc, props}`; unknown species → `fallback` (a species id) or the first species. */
export function sanitizeNpcLook(input, data, fallback) {
  const defs = defsOf(data);
  const ids = speciesIds(defs.npcs);
  const src = isObj(input) ? input : {};
  const npc = ids.includes(src.npc) ? src.npc : ids.includes(fallback) ? fallback : ids[0];
  return { npc, props: sanitizeProps(src.props, data) };
}

/** A pet look `{pet}`; unknown species → `fallback` or the first species. */
export function sanitizePetLook(input, data, fallback) {
  const defs = defsOf(data);
  const ids = speciesIds(defs.pets);
  const src = isObj(input) ? input : {};
  return { pet: ids.includes(src.pet) ? src.pet : ids.includes(fallback) ? fallback : ids[0] };
}

/**
 * A partner / spouse spec of an old save (human avatar, `body`) → an NPC friend: species by a hash of the spec, the old
 * accessory → props, `body` dropped. Already-converted specs are only re-validated. Mutates and returns `p`.
 */
export function migratePartnerSpec(p, data) {
  if (!isObj(p)) return p;
  const defs = defsOf(data);
  const ids = speciesIds(defs.npcs);
  const old = p.avatar;
  if (isObj(old) && ids.includes(old.npc)) {
    p.avatar = sanitizeNpcLook(old, data);
  } else {
    const species = ids.includes(p.species) ? p.species : ids[hash32('npc', p.id ?? '', p.name ?? '', stableJson(old ?? {})) % ids.length];
    p.avatar = { npc: species, props: isHumanAvatar(old) ? accessoryProps(old.accessory, data) : sanitizeProps(old?.props, data) };
  }
  p.species = p.avatar.npc;
  delete p.body;
  return p;
}

/** A child of an old save → a pet (species by hash, `body` dropped). Mutates and returns `k`. */
export function migratePetSpec(k, data) {
  if (!isObj(k)) return k;
  const defs = defsOf(data);
  const ids = speciesIds(defs.pets);
  const old = k.avatar;
  const species = isObj(old) && ids.includes(old.pet) ? old.pet : ids.includes(k.species) ? k.species : ids[hash32('pet', k.id ?? '', k.name ?? '', stableJson(old ?? {})) % ids.length];
  k.avatar = { pet: species };
  k.species = species;
  delete k.body;
  return k;
}

/** Does a look still need the CH-1 migration? (human avatar / partner or child without a species look) */
const needsPartner = (p) => isObj(p) && (!isObj(p.avatar) || typeof p.avatar.npc !== 'string' || 'body' in p || p.species !== p.avatar.npc);
const needsPet = (k) => isObj(k) && (!isObj(k.avatar) || typeof k.avatar.pet !== 'string' || 'body' in k || k.species !== k.avatar.pet);

/**
 * CH-1 migration of a stored room (load / applyAction / engine start): player avatars (human → roster, the old AI art
 * dropped), partners / candidates / spouses (→ NPC friends), children (→ pets), 고교 첫 친구 pairs and an open prompt's
 * candidates. Idempotent; mutates `room`. @returns true when anything changed
 */
export function migrateRoomLooks(room, data) {
  if (!isObj(room)) return false;
  let changed = false;
  const partner = (p) => {
    if (!needsPartner(p)) return p;
    changed = true;
    return migratePartnerSpec(p, data);
  };
  for (const c of room.characters ?? []) {
    if (!isObj(c.avatar) || isHumanAvatar(c.avatar) || typeof c.avatar.character !== 'string') {
      c.avatar = sanitizeAvatar(c.avatar, data);
      delete c.art; // AI art of the human look
      changed = true;
    }
    if (isObj(c.love)) {
      for (const p of c.love.candidates ?? []) partner(p);
      if (c.love.partner) partner(c.love.partner);
    }
    if (c.spouse) partner(c.spouse);
    for (const k of c.children ?? []) {
      if (!needsPet(k)) continue;
      migratePetSpec(k, data);
      changed = true;
    }
  }
  for (const pair of room.schoolMeetPairs ?? []) if (pair?.partner) partner(pair.partner);
  const pending = room.turn?.pending;
  if (isObj(pending)) {
    for (const o of pending.options ?? []) if (o?.partner) partner(o.partner);
    for (const p of pending.context?.candidates ?? []) partner(p);
  }
  return changed;
}
