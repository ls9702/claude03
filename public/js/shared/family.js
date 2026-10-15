// Stage 8 client helpers (pure: no DOM, no Node) — friends & pets (Chiikawa theme, CH-1), real estate.
// Shared by game2d.js, cutin2d.js, ui/familyArt.js, ui/houseArt.js, the 3D board and node tests.
// Event types / field names stay (met, dated, proposed, married, spouse, children, childBorn, childGrew, schoolMeet);
// only the wording changed: 단짝 후보 / 같이 놀기 / 「같이 살자!」 제안 / 단짝 동거 / 반려동물 (FAMILY_WORDS).
//
//   traitInfo / starsText / partnerInfo      → 단짝 후보 · 단짝 cards: 🧠 지력형 ★★☆☆ (+ NPC species 🐼 판다)
//   affectionInfo(love, meta)                → ❤️ 친밀도 bar to `affection.proposeAt`
//   childInfo / childLook / childScale        → pets: stage label (새끼 / 꼬마 / 청소년 / 어른), 🌟 천재 펫, cut-in scale
//   houseInfo / houseOf / marketInfo          → 매물 defs (`/api/meta.houses`), my house + market multiplier
//   familyCast(group, characters, ctx)        → partner / spouse / children entries of a cut-in cast
//   meetOptions / dateOptions / proposeOptions / houseOptions → prompt option view models
//   familyIcons / familySummary               → side-list / result row badges
//
// Everything is feature-detected: characters / rooms / meta without the Stage 8 fields render as before.
import { hashStr, lookKind, npcInfo, npcList, petInfo, petList, petStages } from './roster.js';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

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

/** Chiikawa theme wording (contract §4) — every family label in the client comes from here. */
export const FAMILY_WORDS = Object.freeze({
  route: '💕 단짝·반려 루트',
  routeShort: '단짝·반려',
  routeDesc: '새 친구·단짝 동거·반려동물 이벤트',
  met: '💘 새 친구',
  candidate: '친구 후보',
  partner: '단짝 후보',
  date: '💑 같이 놀기',
  affection: '친밀도',
  propose: '🏡 「같이 살자!」 제안',
  proposeOk: '🏡 「같이 살자!」 성공',
  proposeFail: '💔 「같이 살자!」 실패',
  married: '단짝 동거',
  wedding: '🎉 집들이 파티',
  weddingGift: '집들이 선물',
  spouse: '단짝',
  spouseSalary: '단짝 생활비',
  birth: '🐣 반려동물 입양',
  baby: '새끼',
  children: '반려동물',
  dol: '🎂 입양 파티',
  school: '🎒 펫 훈련 학교',
  exam: '🏆 펫 경연대회',
  job: '⭐ 펫 스타 데뷔',
  allowance: '펫 광고 수입',
  genius: '🌟 천재 펫',
  schoolMeet: '🏫 고교 첫 친구',
  marriageLuck: '단짝운◎',
});

/** Pet growth stages (the old children's stages): label, icon, stage scale (pets.json `stages` win). */
export const CHILD_STAGES = Object.freeze({
  baby: { label: '새끼', icon: '🐣', scale: 0.5, era: 'baby' },
  kid: { label: '꼬마', icon: '🐾', scale: 0.64, era: 'elem' },
  teen: { label: '청소년', icon: '🎒', scale: 0.78, era: 'high' },
  adult: { label: '어른', icon: '⭐', scale: 0.9, era: null },
});
/** Pet figures are drawn smaller than the characters inside the shared full view → the cut-in slot scale is boosted. */
export const PET_SLOT_BOOST = 1.45;
export const MAX_CHILDREN = 4;
/** 💞 = 단짝 (living together), 💕 = 단짝 후보 (becoming friends). */
export const SPOUSE_ICON = '💞';
export const PARTNER_ICON = '💕';

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

/**
 * The NPC look of a 단짝 후보 / 단짝 spec: its `{npc, props}` avatar, else `spec.species`, else (old saves with a human
 * avatar) a species picked from a hash of the spec — never a roster character.
 */
export function npcLook(spec, meta = null) {
  if (!isObj(spec)) return null;
  const a = isObj(spec.avatar) ? spec.avatar : null;
  if (lookKind(a) === 'npc') return a;
  const list = npcList(meta);
  const species = typeof spec.species === 'string' && list.some((x) => x.id === spec.species) ? spec.species : list[hashStr(JSON.stringify(a ?? spec.name ?? spec.id ?? '')) % list.length].id;
  return { npc: species, props: {} };
}

/** The pet look of a 반려동물 spec: `{pet}` avatar, else `species`, else a hashed species (old saves). */
export function petLook(spec, meta = null) {
  if (!isObj(spec)) return null;
  const a = isObj(spec.avatar) ? spec.avatar : null;
  if (lookKind(a) === 'pet') return a;
  const list = petList(meta);
  const species = typeof spec.species === 'string' && list.some((x) => x.id === spec.species) ? spec.species : list[hashStr(JSON.stringify(a ?? spec.name ?? spec.id ?? '')) % list.length].id;
  return { pet: species };
}

/** Partner / spouse spec → view model {id, name, avatar (NPC look), species, speciesName, speciesIcon, trait…, stars, salary}. */
export function partnerInfo(spec, meta) {
  if (!isObj(spec)) return null;
  const t = traitInfo(spec.trait, meta);
  const stars = Math.max(0, Math.min(MAX_STARS, Math.round(Number(spec.stars) || 0)));
  const look = npcLook(spec, meta);
  const sp = npcInfo(look.npc, meta);
  return {
    id: spec.id ?? spec.partnerId ?? null,
    name: String(spec.name ?? '???'),
    avatar: look,
    species: look.npc,
    speciesName: sp.name,
    speciesIcon: sp.icon,
    trait: spec.trait ?? null,
    traitName: t.name,
    traitIcon: t.icon,
    stars,
    starsText: starsText(stars),
    salary: num(spec.salary),
    marriedTurn: num(spec.marriedTurn),
  };
}

/**
 * A partner / pet as a cut-in / portrait "character" ({id, name, avatar, art: null, npc}). Partners get their NPC look,
 * pets (prefix 'child' / a `{pet}` avatar) their pet look; `avatar` overrides.
 */
export function npcCharacter(spec, { prefix = 'npc', avatar = null, meta = null } = {}) {
  if (!isObj(spec)) return null;
  const isPet = prefix === 'child' || lookKind(spec.avatar) === 'pet' || lookKind(avatar) === 'pet' || (typeof spec.species === 'string' && petList(meta).some((x) => x.id === spec.species) && !npcList(meta).some((x) => x.id === spec.species));
  const a = avatar ?? (isPet ? petLook(spec, meta) : npcLook(spec, meta));
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

/** Pet (the old child) view model {id, name, species, speciesName, speciesIcon, trait…, stage, stageLabel, stageIcon, genius, scale}. */
export function childInfo(child, meta) {
  if (!isObj(child)) return null;
  const st0 = CHILD_STAGES[child.stage] ?? CHILD_STAGES.baby;
  const ms = petStages(meta)[CHILD_STAGES[child.stage] ? child.stage : 'baby'];
  const st = { ...st0, label: typeof ms?.name === 'string' && ms.name ? ms.name : st0.label };
  const t = child.trait ? traitInfo(child.trait, meta) : null;
  const look = petLook(child, meta);
  const sp = petInfo(look.pet, meta);
  return {
    id: child.id ?? null,
    name: String(child.name ?? sp.name ?? '새끼'),
    species: look.pet,
    speciesName: sp.name,
    speciesIcon: sp.icon,
    stage: CHILD_STAGES[child.stage] ? child.stage : 'baby',
    stageLabel: st.label,
    stageIcon: st.icon,
    genius: child.talent === 'genius',
    trait: child.trait ?? null,
    traitName: t?.name ?? '',
    traitIcon: t?.icon ?? '',
    scale: childScale(child.stage, { meta, species: look.pet }),
    bornTurn: num(child.bornTurn),
  };
}

/**
 * Cut-in slot scale of a pet: stage scale (pets.json `stages`, 새끼 0.5 … 어른 0.9) × species `size` × PET_SLOT_BOOST,
 * clamped to 0.5..1 (a grown-up pet stands as tall as its owner's slot at most).
 */
export function childScale(stage, { meta = null, species = null } = {}) {
  const st = petStages(meta)[stage] ?? petStages(meta).baby;
  const stageScale = Number(st?.scale) > 0 ? Number(st.scale) : (CHILD_STAGES[stage] ?? CHILD_STAGES.baby).scale;
  const size = species ? Number(petInfo(species, meta).size) || 0.85 : 0.85;
  return Math.round(Math.max(0.5, Math.min(1, stageScale * size * PET_SLOT_BOOST)) * 100) / 100;
}

/** The look of a pet: its `{pet}` look (the body never changes — the stage only scales it in cut-ins). */
export function childLook(child, { meta = null } = {}) {
  return isObj(child) ? petLook(child, meta) : null;
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
    capacity: d.capacity === null ? 0 : num(d.capacity) ?? 1, // null / 0 = many owners (아파트)
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

/** Owners (character ids) of a 매물 in the room (`room.houseOwners {houseId: [charId]}` when present, else derived). */
export function houseOwners(room, houseId) {
  const map = room?.houseOwners;
  if (isObj(map) && Array.isArray(map[houseId])) return [...map[houseId]];
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

/** Compact family glyphs for a row ("💞 🐢🐤🌟"): 💞 단짝 / 💕 단짝 후보 + each pet's species icon (🌟 천재 펫). */
export function familyIcons(character, meta = null) {
  const out = [];
  if (isObj(character?.spouse)) out.push(SPOUSE_ICON);
  else if (isObj(character?.love?.partner)) out.push(PARTNER_ICON);
  const kids = Array.isArray(character?.children) ? character.children : [];
  if (kids.length) out.push(kids.filter(isObj).map((k) => `${petInfo(petLook(k, meta).pet, meta).icon}${k?.talent === 'genius' ? '🌟' : ''}`).join(''));
  return out.join(' ');
}

/** One-line family text for a result row ("💞 단짝 몽실(★3) · 반려동물 2마리 (🌟 1)"). */
export function familySummary(character, meta) {
  const f = familyOf(character, meta);
  const parts = [];
  if (f.spouse) parts.push(`${SPOUSE_ICON} 단짝 ${f.spouse.name}${f.spouse.stars ? `(★${f.spouse.stars})` : ''}`);
  if (f.children.length) {
    const g = f.children.filter((k) => k.genius).length;
    parts.push(`반려동물 ${f.children.length}마리${g ? ` (🌟 ${g})` : ''}`);
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
export function familyCast(g, characters = [], { meta = null } = {}) {
  const a = g?.anchor;
  if (!a) return [];
  const c = characters.find((x) => x.id === (g.charId ?? a.charId)) ?? null;
  const out = [];
  const partnerEntry = (spec, role, extra = {}) => {
    const ch = npcCharacter(spec, { prefix: role === 'spouse' ? 'spouse' : 'partner', meta });
    if (ch) out.push({ char: ch, role, scale: 1, pose: 'idle', emotion: null, glyph: null, ...extra });
  };
  const childEntry = (child, stage, extra = {}) => {
    const st = stage ?? child?.stage ?? 'baby';
    const look = childLook(child, { meta });
    const ch = npcCharacter(child, { prefix: 'child', avatar: look, meta });
    if (ch) out.push({ char: ch, role: 'child', stage: st, scale: childScale(st, { meta, species: look?.pet }), pose: 'idle', emotion: null, glyph: st === 'baby' ? '🐣' : null, genius: child?.talent === 'genius', ...extra });
  };
  switch (a.type) {
    case 'met':
      partnerEntry(partnerOfEvent(a, c), 'partner', { pose: 'wave', emotion: 'shy', glyph: '💘' });
      break;
    case 'dated':
      partnerEntry(partnerOfEvent(a, c), 'partner', { pose: 'cheer', emotion: 'love' });
      break;
    case 'proposed':
      partnerEntry(partnerOfEvent(a, c), 'partner', a.success ? { pose: 'jump', emotion: 'love', glyph: '🏡' } : { pose: 'idle', emotion: 'sweat', glyph: '🙅' });
      break;
    case 'married':
      partnerEntry(partnerOfEvent(a, c), 'spouse', { pose: 'cheer', emotion: 'joy', glyph: '🎉' });
      break;
    case 'childBorn':
      partnerEntry(partnerOfEvent(a, c), 'spouse', { pose: 'wave', emotion: 'joy' });
      if (isObj(a.child)) childEntry(a.child, 'baby', { pose: 'jump', emotion: 'joy' });
      break;
    case 'childGrew': {
      // the event's copy first (the state may already be further on)
      const child = (isObj(a.child) ? a.child : null) ?? (Array.isArray(c?.children) ? c.children : []).find((k) => k.id === a.childId) ?? null;
      if (child) childEntry(child, a.stage ?? child.stage, { pose: 'cheer', emotion: 'joy', glyph: CHILD_GROW[a.kind]?.icon ?? null });
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
      return { char, partner, npc: npcCharacter(p.partner, { prefix: 'partner', meta }) };
    })
    .filter(Boolean);
}

/** 💌 집들이 선물 / 입양 파티 gift rows: [{fromId, name, amount}] (+ total). */
export function weddingGifts(a, characters = []) {
  const rows = (Array.isArray(a?.gifts) ? a.gifts : [])
    .filter((g) => Number(g?.amount) > 0)
    .map((g) => ({ fromId: g.fromId, name: characters.find((c) => c.id === g.fromId)?.name ?? '', amount: Number(g.amount) }));
  const total = num(a?.total) ?? rows.reduce((s, r) => s + r.amount, 0);
  return { rows, total };
}

/** childGrew kinds → label / icon / scene (pets: 입양 파티, 펫 훈련 학교, 펫 경연대회, 펫 스타 데뷔). */
export const CHILD_GROW = Object.freeze({
  dol: { label: '입양 파티', icon: '🎂', scene: 'park' },
  school: { label: '펫 훈련 학교', icon: '🎒', scene: 'school' },
  exam: { label: '펫 경연대회', icon: '🏆', scene: 'stage' },
  job: { label: '펫 스타 데뷔', icon: '⭐', scene: 'stage' },
});
/** 펫 경연대회 results (childGrew exam `result`: elite → 우승, college → 입상, fail → 탈락). */
export const PET_CONTEST = Object.freeze({ elite: '🏆 우승!', college: '🥈 입상', fail: '📖 탈락… 다음 기회에' });

// ---------- prompts ----------

/** Percent 0..100 from a 0..1 or 0..100 chance. */
export function chancePct(v) {
  const n = num(v);
  if (n == null) return null;
  return Math.max(0, Math.min(100, Math.round(n <= 1 ? n * 100 : n)));
}

const isPass = (o) => o?.id === 'pass' || o?.id === 'wait' || o?.id === 'leave' || o?.id === 'skip' || o?.id === 'steady';

/**
 * 새 친구 (meet) prompt: candidate cards. The spec comes from the option (`partner` / `avatar`), else `character.love.candidates`
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
    candidates.push({ option: o, partner, npc: npcCharacter(spec, { prefix: 'partner', meta }) });
  }
  return { candidates, pass };
}

/** 같이 놀기 (date) prompt: [{option, cost, gain, free, match}] (cost = `cost ?? price`, gain = `gain ?? affection`). */
export function dateOptions(p) {
  return (p?.options ?? []).map((o) => {
    const cost = num(o.cost ?? o.price) ?? 0;
    const gain = num(o.gain ?? o.affection ?? o.affectionGain);
    return { option: o, cost, gain, free: cost <= 0, pass: isPass(o), match: !!o.match };
  });
}

/** 「같이 살자!」 제안 (propose) prompt: [{option, chance (0..100 | null; only for the propose option), propose}]. */
export function proposeOptions(p) {
  return (p?.options ?? []).map((o) => {
    const propose = o.id === 'propose' || (!isPass(o) && Number(o.chance) > 0);
    return { option: o, chance: propose ? chancePct(o.chance ?? p?.context?.chance) : null, propose };
  });
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
    const base = num(o.basePrice);
    // 청약: `discount` when sent, else basePrice − price of a subscription win
    const discount = num(o.discount) ?? (base != null && base > price && (o.subscription || o.discount == null) ? base - price : 0);
    const lucky = !!(o.lucky ?? house.lucky);
    const capacity = o.capacity === null ? 0 : num(o.capacity) ?? house.capacity;
    const owners = houseOwners(room, houseId)
      .filter((id) => id !== character?.id)
      .map((id) => room?.characters?.find((c) => c.id === id)?.name ?? '');
    const full = capacity > 0 && owners.length >= capacity;
    const net = num(o.cost) ?? Math.max(0, price - tradeIn);
    const reason = o.reason ?? (full ? '이미 팔린 매물이에요' : o.disabled ? (/필요|부족/.test(String(o.desc ?? '')) ? `현금 ${net.toLocaleString('ko-KR')}만원 필요` : '살 수 없어요') : '');
    listings.push({ option: o, house: { ...house, capacity, lucky }, price, basePrice: base, value: num(o.value) ?? house.value, tradeIn, discount, net, owners, full, disabled: !!o.disabled || full, reason });
  }
  return { listings, pass };
}

// ---------- 3D name tag ----------
/** Tiny badge on the 3D name tag: 💞 단짝, 🐾×n 반려동물, 🏠 house owner. */
export function familyTagBadge(character) {
  const out = [];
  if (isObj(character?.spouse)) out.push(SPOUSE_ICON);
  const n = Array.isArray(character?.children) ? character.children.length : 0;
  if (n) out.push(n > 1 ? `🐾${n}` : '🐾');
  if (isObj(character?.house) && character.house.id) out.push('🏠');
  return out.join('');
}
