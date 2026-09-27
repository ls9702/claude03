// Stage 8 client helpers (pure: no DOM, no Node) — romance, family, real estate.
// Shared by game2d.js, cutin2d.js, ui/familyArt.js, ui/houseArt.js, the 3D board and node tests.
//
//   traitInfo / starsText / partnerInfo      → partner (연애 상대) · spouse (배우자) cards: 🧠 지력형 ★★☆☆
//   affectionInfo(love, meta)                → ❤️ bar to `affection.proposeAt`
//   childInfo / childLook / childScale        → kids: stage label, 🌟 genius, stage costume, cut-in scale
//   houseInfo / houseOf / marketInfo          → 매물 defs (`/api/meta.houses`), my house + market multiplier
//   familyCast(group, characters, ctx)        → partner / spouse / children entries of a cut-in cast
//   meetOptions / dateOptions / proposeOptions / houseOptions → prompt option view models
//   familyIcons / familySummary               → side-list / result row badges
//
// Everything is feature-detected: characters / rooms / meta without the Stage 8 fields render as before.
import { DEFAULT_ERA_OUTFITS, eraOutfitTable } from './growth.js';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/** Contract fallback of partners.json `traits` (stat keys). */
export const DEFAULT_TRAITS = Object.freeze({
  int: { name: '지력형', icon: '🧠' },
  str: { name: '체력형', icon: '💪' },
  charm: { name: '매력형', icon: '✨' },
  luck: { name: '운형', icon: '🍀' },
});
export const MAX_STARS = 4;

/** Contract fallback of houses.json (ids are stable; prices only for the fallback). */
export const DEFAULT_HOUSES = Object.freeze({
  oneroom: { id: 'oneroom', name: '원룸 전세', icon: '🛏️', capacity: 1 },
  villa: { id: 'villa', name: '빌라', icon: '🏘️', capacity: 1 },
  apartment: { id: 'apartment', name: '아파트', icon: '🏢', capacity: 0 },
  hanok: { id: 'hanok', name: '한옥', icon: '🏯', capacity: 1 },
  penthouse: { id: 'penthouse', name: '펜트하우스', icon: '🌆', capacity: 1 },
  jeju_villa: { id: 'jeju_villa', name: '제주 별장', icon: '🏝️', capacity: 1, lucky: true },
});
export const HOUSE_IDS = Object.freeze(Object.keys(DEFAULT_HOUSES));

export const CHILD_STAGES = Object.freeze({
  baby: { label: '아기', icon: '👶', scale: 0.5, era: 'baby' },
  kid: { label: '어린이', icon: '🧒', scale: 0.64, era: 'elem' },
  teen: { label: '청소년', icon: '🧑‍🎓', scale: 0.78, era: 'high' },
  adult: { label: '어른', icon: '🧑‍💼', scale: 0.9, era: null },
});
export const MAX_CHILDREN = 4;

/** 🧠 지력형 … from `/api/meta.partners.traits` (`{name, icon}`), else the contract default. */
export function traitInfo(trait, meta) {
  const t = meta?.partners?.traits;
  const def = (isObj(t) && isObj(t[trait]) ? t[trait] : null) ?? DEFAULT_TRAITS[trait] ?? null;
  if (!def) return { id: trait ?? null, name: trait ? String(trait) : '', icon: '💞' };
  return { id: trait, name: def.name ?? DEFAULT_TRAITS[trait]?.name ?? String(trait), icon: def.icon ?? DEFAULT_TRAITS[trait]?.icon ?? '💞' };
}

/** "★★☆☆" (1..MAX_STARS). */
export function starsText(stars, max = MAX_STARS) {
  const n = Math.max(0, Math.min(max, Math.round(Number(stars) || 0)));
  if (!n) return '';
  return '★'.repeat(n) + '☆'.repeat(Math.max(0, max - n));
}

/** Partner / spouse spec → view model {id, name, avatar, trait, traitName, traitIcon, stars, starsText, salary, body}. */
export function partnerInfo(spec, meta) {
  if (!isObj(spec)) return null;
  const t = traitInfo(spec.trait, meta);
  const stars = Math.max(0, Math.min(MAX_STARS, Math.round(Number(spec.stars) || 0)));
  return {
    id: spec.id ?? spec.partnerId ?? null,
    name: String(spec.name ?? '???'),
    avatar: isObj(spec.avatar) ? spec.avatar : null,
    body: spec.body ?? spec.avatar?.body ?? null,
    trait: spec.trait ?? null,
    traitName: t.name,
    traitIcon: t.icon,
    stars,
    starsText: starsText(stars),
    salary: num(spec.salary),
    marriedTurn: num(spec.marriedTurn),
  };
}

/** A partner / child as a cut-in / portrait "character" ({id, name, avatar, art: null, npc}). */
export function npcCharacter(spec, { prefix = 'npc', avatar = null } = {}) {
  if (!isObj(spec)) return null;
  const a = avatar ?? (isObj(spec.avatar) ? spec.avatar : null);
  if (!a) return null;
  return { id: `${prefix}:${spec.id ?? spec.name ?? ''}`, name: String(spec.name ?? ''), avatar: a, art: null, npc: true };
}

/** ❤️ affection bar: value / proposeAt (`/api/meta.partners.affection`), capped at max. */
export function affectionInfo(love, meta) {
  if (!isObj(love)) return null;
  const cfg = meta?.partners?.affection ?? {};
  const proposeAt = num(cfg.proposeAt) ?? num(love.proposeAt) ?? 5;
  const max = num(cfg.max) ?? Math.max(proposeAt, 10);
  const value = Math.max(0, Math.min(max, num(love.affection) ?? 0));
  return { value, proposeAt, max, pct: proposeAt > 0 ? Math.min(100, Math.round((value / proposeAt) * 100)) : 0, ready: value >= proposeAt, dates: num(love.dates) ?? 0 };
}

/** Child view model {id, name, trait…, stage, stageLabel, stageIcon, genius, scale}. */
export function childInfo(child, meta) {
  if (!isObj(child)) return null;
  const st = CHILD_STAGES[child.stage] ?? CHILD_STAGES.baby;
  const t = child.trait ? traitInfo(child.trait, meta) : null;
  return {
    id: child.id ?? null,
    name: String(child.name ?? '아기'),
    stage: CHILD_STAGES[child.stage] ? child.stage : 'baby',
    stageLabel: st.label,
    stageIcon: st.icon,
    genius: child.talent === 'genius',
    trait: child.trait ?? null,
    traitName: t?.name ?? '',
    traitIcon: t?.icon ?? '',
    scale: st.scale,
    bornTurn: num(child.bornTurn),
  };
}

/** Cut-in scale of a child figure (baby 0.5 … adult 0.9). */
export const childScale = (stage) => (CHILD_STAGES[stage] ?? CHILD_STAGES.baby).scale;

/**
 * The look of a child at a stage: its avatar with the stage costume of the era table (baby → dino onesie, kid → tracksuit,
 * teen → school uniform by body); adults keep their own outfit. Unknown outfits (not in the defs) are ignored.
 */
export function childLook(child, { stage = null, avatars = null } = {}) {
  const avatar = isObj(child?.avatar) ? child.avatar : null;
  if (!avatar) return null;
  const st = CHILD_STAGES[stage ?? child.stage] ?? CHILD_STAGES.baby;
  if (!st.era) return avatar;
  const entry = (eraOutfitTable(avatars) ?? DEFAULT_ERA_OUTFITS)[st.era];
  if (!isObj(entry)) return avatar;
  const body = avatar.body ?? child.body ?? 'boy';
  const outfit = entry[body] ?? entry.any ?? null;
  const list = avatars?.parts?.outfit;
  if (!outfit || outfit === avatar.outfit || (Array.isArray(list) && list.length && !list.some((o) => o?.id === outfit))) return avatar;
  return { ...avatar, outfit };
}

// ---------- houses ----------

function houseDefs(meta) {
  const h = meta?.houses;
  const list = Array.isArray(h) ? h : Array.isArray(h?.houses) ? h.houses : [];
  return list.filter((x) => isObj(x) && x.id);
}

/** 매물 definition (`/api/meta.houses.houses[]`, contract fallback names / icons) or a minimal entry. */
export function houseInfo(id, meta) {
  if (!id) return null;
  const def = houseDefs(meta).find((x) => x.id === id);
  const fb = DEFAULT_HOUSES[id];
  if (!def && !fb) return { id, name: String(id), icon: '🏠', price: null, value: null, capacity: 1, lucky: false, desc: '', known: false };
  const d = { ...(fb ?? {}), ...(def ?? {}) };
  return {
    id,
    name: d.name ?? String(id),
    icon: d.icon ?? '🏠',
    price: num(d.price),
    value: num(d.value),
    capacity: num(d.capacity) ?? 1,
    lucky: !!d.lucky,
    desc: d.desc ?? '',
    known: !!def,
  };
}

/** Market multiplier of the room (`room.housingMarket {eraId, mult}`) → {mult, pct, dir: up|down|flat, text}. */
export function marketInfo(market) {
  const mult = num(market?.mult ?? market);
  if (mult == null || mult <= 0) return null;
  const pct = Math.round((mult - 1) * 100);
  const dir = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
  return { mult, pct, dir, eraId: market?.eraId ?? null, text: `${dir === 'up' ? '📈' : dir === 'down' ? '📉' : '➖'} 시세 ×${mult.toFixed(2).replace(/\.?0+$/, '')}${pct ? ` (${pct > 0 ? '+' : ''}${pct}%)` : ''}` };
}

/** A character's house → {id, name, icon, price, value, boughtTurn, swaps, gain} | null. */
export function houseOf(character, meta) {
  const h = character?.house;
  if (!isObj(h) || !h.id) return null;
  const info = houseInfo(h.id, meta);
  const price = num(h.price) ?? info.price;
  const value = num(h.value) ?? price;
  return { ...info, price, value, boughtTurn: num(h.boughtTurn), swaps: num(character.houseSwaps) ?? 0, gain: price != null && value != null ? value - price : 0 };
}

/** Owners (character ids) of a 매물 in the room. */
export function houseOwners(room, houseId) {
  return (room?.characters ?? []).filter((c) => c?.house?.id === houseId).map((c) => c.id);
}

// ---------- side list / result ----------

/** Family members of a character: {partner, spouse, children[]} as view models (empty when fields are missing). */
export function familyOf(character, meta) {
  const love = isObj(character?.love) ? character.love : null;
  const spouse = partnerInfo(character?.spouse, meta);
  const partner = spouse ? null : partnerInfo(love?.partner, meta);
  const children = (Array.isArray(character?.children) ? character.children : []).map((k) => childInfo(k, meta)).filter(Boolean);
  return { partner, spouse, children, affection: partner ? affectionInfo(love, meta) : null };
}

/** Compact family glyphs for a row ("💍 👶🧒🌟"). */
export function familyIcons(character) {
  const out = [];
  if (isObj(character?.spouse)) out.push('💍');
  else if (isObj(character?.love?.partner)) out.push('💕');
  const kids = Array.isArray(character?.children) ? character.children : [];
  if (kids.length) out.push(kids.map((k) => `${(CHILD_STAGES[k?.stage] ?? CHILD_STAGES.baby).icon}${k?.talent === 'genius' ? '🌟' : ''}`).join(''));
  return out.join(' ');
}

/** One-line family text for a result row ("💍 민지(★3) · 자녀 2명 (🌟 1)"). */
export function familySummary(character, meta) {
  const f = familyOf(character, meta);
  const parts = [];
  if (f.spouse) parts.push(`💍 ${f.spouse.name}${f.spouse.stars ? `(★${f.spouse.stars})` : ''}`);
  if (f.children.length) {
    const g = f.children.filter((k) => k.genius).length;
    parts.push(`자녀 ${f.children.length}명${g ? ` (🌟 ${g})` : ''}`);
  }
  return parts.join(' · ');
}

// ---------- cut-in cast ----------

/** The partner spec an event is about (event field first, then the character's state). */
function partnerOfEvent(a, c) {
  if (isObj(a?.spouse)) return a.spouse;
  if (isObj(a?.partner)) return a.partner;
  if (a?.type === 'married' || a?.type === 'childBorn' || a?.type === 'childGrew') return c?.spouse ?? c?.love?.partner ?? null;
  return c?.love?.partner ?? c?.spouse ?? null;
}

/**
 * Extra cut-in cast of a Stage 8 group: the partner / spouse / child next to the character (layered compositor → SVG).
 * Entries: {char: npcCharacter, role: 'partner'|'spouse'|'child', scale, pose, emotion, glyph, flip?}.
 * @param {object} g  planCutins group
 * @param {object[]} characters  room characters (display look)
 * @param {{avatars?: object}} ctx
 */
export function familyCast(g, characters = [], { avatars = null } = {}) {
  const a = g?.anchor;
  if (!a) return [];
  const c = characters.find((x) => x.id === (g.charId ?? a.charId)) ?? null;
  const out = [];
  const partnerEntry = (spec, role, extra = {}) => {
    const ch = npcCharacter(spec, { prefix: role === 'spouse' ? 'spouse' : 'partner' });
    if (ch) out.push({ char: ch, role, scale: 1, pose: 'idle', emotion: null, glyph: null, ...extra });
  };
  const childEntry = (child, stage, extra = {}) => {
    const st = stage ?? child?.stage ?? 'baby';
    const ch = npcCharacter(child, { prefix: 'child', avatar: childLook(child, { stage: st, avatars }) });
    if (ch) out.push({ char: ch, role: 'child', stage: st, scale: childScale(st), pose: 'idle', emotion: null, glyph: st === 'baby' ? '👶' : null, genius: child?.talent === 'genius', ...extra });
  };
  switch (a.type) {
    case 'met':
      partnerEntry(partnerOfEvent(a, c), 'partner', { pose: 'wave', emotion: 'shy', glyph: '💘' });
      break;
    case 'dated':
      partnerEntry(partnerOfEvent(a, c), 'partner', { pose: 'cheer', emotion: 'love' });
      break;
    case 'proposed':
      partnerEntry(partnerOfEvent(a, c), 'partner', a.success ? { pose: 'jump', emotion: 'love', glyph: '💍' } : { pose: 'idle', emotion: 'sweat', glyph: '🙅' });
      break;
    case 'married':
      partnerEntry(partnerOfEvent(a, c), 'spouse', { pose: 'cheer', emotion: 'joy', glyph: '💍' });
      break;
    case 'childBorn':
      partnerEntry(partnerOfEvent(a, c), 'spouse', { pose: 'wave', emotion: 'joy' });
      if (isObj(a.child)) childEntry(a.child, 'baby', { pose: 'jump', emotion: 'joy' });
      break;
    case 'childGrew': {
      const child = (Array.isArray(c?.children) ? c.children : []).find((k) => k.id === a.childId) ?? (isObj(a.child) ? a.child : null);
      if (child) childEntry(child, a.stage ?? child.stage, { pose: 'cheer', emotion: 'joy', glyph: a.kind === 'dol' ? '🎂' : a.kind === 'exam' ? '📝' : a.kind === 'job' ? '💼' : null });
      break;
    }
    case 'allowance': {
      const child = (Array.isArray(c?.children) ? c.children : []).find((k) => k.id === a.childId);
      if (child) childEntry(child, child.stage, { pose: 'wave', emotion: 'joy', glyph: '💌' });
      break;
    }
    default:
      break;
  }
  return out;
}

/** schoolMeet pairs → [{char, partner: partnerInfo, npc}] (characters that are gone are skipped). */
export function schoolMeetPairs(a, characters = [], meta = null) {
  return (Array.isArray(a?.pairs) ? a.pairs : [])
    .map((p) => {
      const char = characters.find((c) => c.id === p?.charId);
      const partner = partnerInfo(p?.partner, meta);
      if (!char || !partner) return null;
      return { char, partner, npc: npcCharacter(p.partner, { prefix: 'partner' }) };
    })
    .filter(Boolean);
}

/** 💌 wedding gift rows: [{fromId, name, amount}] (+ total). */
export function weddingGifts(a, characters = []) {
  const rows = (Array.isArray(a?.gifts) ? a.gifts : [])
    .filter((g) => Number(g?.amount) > 0)
    .map((g) => ({ fromId: g.fromId, name: characters.find((c) => c.id === g.fromId)?.name ?? '', amount: Number(g.amount) }));
  const total = num(a?.total) ?? rows.reduce((s, r) => s + r.amount, 0);
  return { rows, total };
}

/** childGrew kinds → label / icon / scene. */
export const CHILD_GROW = Object.freeze({
  dol: { label: '돌잔치', icon: '🎂', scene: 'wedding-hall' },
  school: { label: '초등 입학', icon: '🎒', scene: 'school' },
  exam: { label: '자녀 수능', icon: '📝', scene: 'school' },
  job: { label: '자녀 취업', icon: '💼', scene: 'office' },
});

// ---------- prompts ----------

/** Percent 0..100 from a 0..1 or 0..100 chance. */
export function chancePct(v) {
  const n = num(v);
  if (n == null) return null;
  return Math.max(0, Math.min(100, Math.round(n <= 1 ? n * 100 : n)));
}

const isPass = (o) => o?.id === 'pass' || o?.id === 'wait' || o?.id === 'leave' || o?.id === 'skip';

/**
 * 만남 prompt: candidate cards. The spec comes from the option (`partner` / `avatar`), else `character.love.candidates`
 * / `pending.context.candidates` by `partnerId`.
 * @returns {{candidates: {option, partner}[], pass: object|null}}
 */
export function meetOptions(p, { character = null, meta = null } = {}) {
  const pool = [
    ...(Array.isArray(p?.context?.candidates) ? p.context.candidates : []),
    ...(Array.isArray(character?.love?.candidates) ? character.love.candidates : []),
  ];
  const candidates = [];
  let pass = null;
  for (const o of p?.options ?? []) {
    if (isPass(o) || (!o.partnerId && !o.partner && !o.trait)) {
      pass ??= o;
      continue;
    }
    const spec = (isObj(o.partner) ? o.partner : null) ?? pool.find((x) => x?.id != null && x.id === o.partnerId) ?? { id: o.partnerId, name: o.name ?? o.label, trait: o.trait, stars: o.stars, avatar: o.avatar };
    const partner = partnerInfo({ ...spec, trait: spec.trait ?? o.trait, stars: spec.stars ?? o.stars, name: spec.name ?? o.name ?? o.label }, meta);
    candidates.push({ option: o, partner, npc: npcCharacter(spec, { prefix: 'partner' }) });
  }
  return { candidates, pass };
}

/** 데이트 prompt: [{option, cost, gain, free}] (cost = `cost ?? price`, gain = `gain ?? affection`). */
export function dateOptions(p) {
  return (p?.options ?? []).map((o) => {
    const cost = num(o.cost ?? o.price) ?? 0;
    const gain = num(o.gain ?? o.affection ?? o.affectionGain);
    return { option: o, cost, gain, free: cost <= 0, pass: isPass(o) };
  });
}

/** 프러포즈 prompt: [{option, chance (0..100 | null), propose}]. */
export function proposeOptions(p) {
  return (p?.options ?? []).map((o) => ({ option: o, chance: chancePct(o.chance), propose: o.id === 'propose' || (!isPass(o) && o.chance != null) }));
}

/**
 * 매물 prompt listing cards: [{option, house, price, tradeIn, discount, net, owners, full, disabled, reason}] + pass.
 * `net` = price − tradeIn (what the purchase costs in cash); `owners` = names of characters that own it now.
 */
export function houseOptions(p, { room = null, meta = null, character = null } = {}) {
  const listings = [];
  let pass = null;
  for (const o of p?.options ?? []) {
    const houseId = o.houseId ?? (String(o.id).startsWith('buy:') ? String(o.id).slice(4) : null);
    if (!houseId || isPass(o)) {
      pass ??= o;
      continue;
    }
    const house = houseInfo(houseId, meta);
    const price = num(o.price) ?? house.price ?? 0;
    const tradeIn = num(o.tradeIn) ?? 0;
    const discount = num(o.discount) ?? 0;
    const owners = houseOwners(room, houseId)
      .filter((id) => id !== character?.id)
      .map((id) => room?.characters?.find((c) => c.id === id)?.name ?? '');
    const full = house.capacity > 0 && owners.length >= house.capacity;
    listings.push({ option: o, house, price, tradeIn, discount, net: Math.max(0, price - tradeIn), owners, full, disabled: !!o.disabled || full, reason: o.reason ?? (full ? '이미 팔린 매물이에요' : o.disabled ? o.desc || '살 수 없어요' : '') });
  }
  return { listings, pass };
}

// ---------- 3D name tag ----------
/** Tiny badge on the 3D name tag: 💍 married, 👶×n children, 🏠 house owner. */
export function familyTagBadge(character) {
  const out = [];
  if (isObj(character?.spouse)) out.push('💍');
  const n = Array.isArray(character?.children) ? character.children.length : 0;
  if (n) out.push(n > 1 ? `👶${n}` : '👶');
  if (isObj(character?.house) && character.house.id) out.push('🏠');
  return out.join('');
}
