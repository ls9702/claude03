// Stage 8 — romance & family (partners.json): 고교 전원 만남, heart tiles (만남 / 데이트 / 프러포즈 / 가족),
// 결혼식 축의금, 맞벌이 급여, 출산, 자녀 성장 (돌잔치 → 입학 → 수능 → 취업) and 용돈 송금. Pure helpers over a tx;
// every random draw comes from tx.rng (seeded).
//
// character.love = {candidates: [partnerSpec], partner: partnerSpec|null, affection, dates}
//   partnerSpec = {id, name, trait, stars, body, avatar}  (candidates = the open 만남 prompt's people, else [])
// character.spouse = partnerSpec + {salary, marriedTurn} | null
// character.children = [{id, name, trait, talent: genius|normal, stage: baby|kid|teen|adult, bornTurn, avatar, body,
//   growth (0..4 steps done), turns (parent spins since the last step)}] (max partners.children.max)
// room.nextPartnerSeq / room.nextChildSeq (ids `pt<n>` / `ch<n>`), room.schoolMeetDone
import { getAvatars } from '../data/index.js';
import { STAT_KEYS, addLog, addStats, changeMoney, charById, emit, josa, round5, won } from './effects.js';
import { effectsFor } from './news.js';
import { openPrompt, registerPrompts } from './prompts.js';
import { sanitizeAvatar } from './avatar.js';
import { affectionBonus, dropHeldCards, popularEffect } from './cards.js';

export const TRAITS = ['int', 'str', 'charm', 'luck'];
export const CHILD_STAGES = ['baby', 'kid', 'teen', 'adult'];
/** Growth steps in order; the stage a child has after each step. */
export const GROWTH_STEPS = [
  { kind: 'dol', stage: 'kid' },
  { kind: 'school', stage: 'teen' },
  { kind: 'exam', stage: 'teen' },
  { kind: 'job', stage: 'adult' },
];
/** childGrew kinds that get a full cut-in (school = a cost chip). */
export const CUTIN_GROWTH = ['dol', 'exam', 'job'];

const cfgOf = (data) => data.partners ?? {};
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const bodyOf = (c) => (c?.avatar?.body === 'girl' ? 'girl' : 'boy');
const scaleOf = (data, era) => cfgOf(data).costs?.scale?.[era] ?? 1;

/** A fresh family record (Stage 8 character fields). */
export function initFamily() {
  return { love: { candidates: [], partner: null, affection: 0, dates: 0 }, spouse: null, children: [], house: null, houseSwaps: 0 };
}

/** Fill Stage 8 fields on characters of games saved before Stage 8. */
export function ensureFamily(c) {
  c.love ??= { candidates: [], partner: null, affection: 0, dates: 0 };
  c.love.candidates ??= [];
  c.love.partner ??= null;
  c.love.affection ??= 0;
  c.love.dates ??= 0;
  c.spouse ??= null;
  c.children ??= [];
  c.house ??= null;
  c.houseSwaps ??= 0;
  return c;
}

/** Fill Stage 8 room fields (an older save that already reached 고등학생 never gets a late 전원 만남). */
export function ensureRoomFamily(room) {
  room.nextPartnerSeq ??= 0;
  room.nextChildSeq ??= 0;
  room.schoolMeetDone ??= (room.erasOpened ?? []).includes('high') || room.characters.some((c) => ['young', 'middle_age', 'senior'].includes(c.era));
  room.housingMarket ??= null;
  return room;
}

/** The character's best stats (ties → several). */
export function topStats(c) {
  const s = c?.stats ?? {};
  const best = Math.max(...STAT_KEYS.map((k) => s[k] ?? 0));
  return STAT_KEYS.filter((k) => (s[k] ?? 0) === best);
}

/** 찰떡궁합: the partner's trait is one of the character's best stats. */
export const traitMatch = (c, trait) => !!trait && topStats(c).includes(trait);

export const traitName = (data, t) => cfgOf(data).traits?.[t]?.name ?? t;
export const traitIcon = (data, t) => cfgOf(data).traits?.[t]?.icon ?? '💗';
export const starsText = (n) => '★'.repeat(Math.max(1, n ?? 1));

/**
 * An affection gain: + 결혼운◎'s `affectionBonus` while the card is held, capped at `affection.max`. `set` = a new
 * relationship's starting affection (meet + match) — the bonus applies to it too. @returns the new affection
 */
export function gainAffection(tx, c, gain, { set = false } = {}) {
  const aff = cfgOf(tx.data).affection ?? {};
  const bonus = gain > 0 ? affectionBonus(tx.data, c) : 0;
  c.love.affection = Math.max(0, Math.min(aff.max ?? 100, (set ? 0 : c.love.affection ?? 0) + gain + bonus));
  return c.love.affection;
}

/**
 * 인기 폭발◎ (blue card) on new candidates: one of them always 찰떡궁합 (the character's best stat as its trait) and
 * each non-school candidate gets ★+1 with `starChance` (≤ the top grade). No card → the list is returned as is.
 */
function popularize(tx, c, people, { school = false } = {}) {
  const eff = popularEffect(tx.data, c);
  if (!eff || !people.length) return people;
  const top = Math.max(...Object.keys(cfgOf(tx.data).stars ?? { 4: 1 }).map(Number));
  if (!school && eff.starChance) for (const p of people) if (p.stars < top && tx.rng.next() < eff.starChance) p.stars += 1;
  if (eff.match && !people.some((p) => traitMatch(c, p.trait))) people[0].trait = topStats(c)[0];
  return people;
}

/** Spouse salary per salary tile (★ salary × the job era multiplier). */
export function spouseSalary(tx, c) {
  if (!c?.spouse) return 0;
  const base = cfgOf(tx.data).stars?.[c.spouse.stars]?.salary ?? c.spouse.salary ?? 0;
  return round5(base * (tx.data.balance.jobs?.salaryEraMult?.[c.era] ?? 1) * effectsFor(tx, c).salaryMult);
}

// ---------- people (partners / children) ----------

function usedNames(room) {
  const out = new Set();
  for (const c of room.characters) {
    out.add(c.name);
    for (const p of c.love?.candidates ?? []) out.add(p.name);
    if (c.love?.partner) out.add(c.love.partner.name);
    if (c.spouse) out.add(c.spouse.name);
    for (const k of c.children ?? []) out.add(k.name);
  }
  return out;
}

function pickName(tx, body, taken) {
  const pool = cfgOf(tx.data).names?.[body] ?? ['하늘'];
  const free = pool.filter((n) => !taken.has(n));
  const name = tx.rng.pick(free.length ? free : pool);
  taken.add(name);
  return name;
}

/** A seeded random look for a partner (adult) or a child, sanitized against avatars.json. */
export function randomLook(tx, body, { child = false, trait = null, parents = [] } = {}) {
  const rng = tx.rng;
  const defs = tx.data.avatars ?? getAvatars();
  const look = cfgOf(tx.data).avatar ?? {};
  const any = (key) => {
    const opts = defs.parts?.[key] ?? [];
    return opts.length ? rng.pick(opts).id : undefined;
  };
  const from = (list, key) => (list?.length ? rng.pick(list) : any(key));
  const inherit = (key) => {
    const p = parents.filter((x) => x?.[key]);
    return p.length ? rng.pick(p)[key] : undefined;
  };
  const avatar = {
    body,
    build: child ? 'normal' : any('build'),
    skin: inherit('skin') ?? any('skin'),
    face: any('face'),
    eyes: any('eyes'),
    mouth: any('mouth'),
    cheek: child ? rng.pick(['blush', 'none']) : any('cheek'),
    hair: from(look.hair?.[body], 'hair'),
    hairColor: inherit('hairColor') ?? from(look.hairColor, 'hairColor'),
    outfit: from(child ? look.outfit?.child : look.outfit?.[body], 'outfit'),
    outfitColor: from(look.outfitColor, 'outfitColor'),
    accessory: !child && trait && rng.next() < 0.5 ? look.traitAccessory?.[trait] ?? 'none' : 'none',
  };
  return sanitizeAvatar(avatar);
}

function weightedStars(tx) {
  const stars = cfgOf(tx.data).stars ?? { 1: { weight: 1 } };
  return Number(tx.rng.weighted(Object.entries(stars).map(([id, s]) => ({ id, weight: s.weight ?? 1 }))).id);
}

/** A new partner spec for `c` (opposite body, weighted trait / stars; `stars` fixes the grade). */
export function makePartner(tx, c, { stars = null, taken = usedNames(tx.room) } = {}) {
  const room = tx.room;
  const cfg = cfgOf(tx.data);
  const body = bodyOf(c) === 'girl' ? 'boy' : 'girl';
  const trait = tx.rng.weighted(TRAITS.map((id) => ({ id, weight: cfg.traits?.[id]?.weight ?? 1 }))).id;
  const grade = stars ?? weightedStars(tx);
  room.nextPartnerSeq = (room.nextPartnerSeq ?? 0) + 1;
  return {
    id: `pt${room.nextPartnerSeq}`,
    name: pickName(tx, body, taken),
    trait,
    stars: grade,
    body,
    avatar: randomLook(tx, body, { trait }),
  };
}

/** Public copy of a partner / spouse / child (no internal counters). */
export const personSpec = (p) => (p ? structuredClone(p) : null);

// ---------- 고교 전원 만남 ----------

/**
 * The first character entering `high`: every unfinished character without a partner / spouse gets one ★1 partner
 * (affection = meet, +matchBonus on 찰떡궁합). Emits ONE `schoolMeet {pairs: [{charId, partner}]}` (no prompt).
 */
export function schoolMeet(tx, eraId) {
  const room = tx.room;
  if (room.schoolMeetDone || eraId !== 'high') return null;
  room.schoolMeetDone = true;
  const aff = cfgOf(tx.data).affection ?? {};
  const taken = usedNames(room);
  const pairs = [];
  for (const id of room.turn.order) {
    const c = charById(room, id);
    if (!c || c.finished) continue;
    ensureFamily(c);
    if (c.love.partner || c.spouse) continue;
    const partner = makePartner(tx, c, { stars: 1, taken });
    c.love.partner = partner;
    gainAffection(tx, c, (aff.meet ?? 25) + (traitMatch(c, partner.trait) ? aff.matchBonus ?? 0 : 0), { set: true });
    pairs.push({ charId: c.id, partner: personSpec(partner) });
  }
  if (!pairs.length) return null;
  const ev = emit(tx, 'schoolMeet', { eraId, pairs, tone: 'love', emotion: 'love' });
  const names = pairs.map((p) => `${charById(room, p.charId).name}♥${p.partner.name}`).join(' · ');
  addLog(tx, `🏫 고교 전원 만남! 모두에게 설레는 인연이 생겼다 (${names})`, { tone: 'love' });
  return ev;
}

/**
 * Loop maps: 고교 첫 만남 is a choice — each character's first high-school turn opens a `meet` prompt with two ★1
 * classmates (`schoolMeetDue` / `openSchoolMeet`). Once every character had theirs (or when high school ends), ONE
 * `schoolMeet {eraId, pairs, summary: true}` recap event lists the couples (`room.schoolMeetPairs`).
 */
export const schoolMeetDue = (tx, c) => c.era === 'high' && !c.schoolMet && !c.finished;

export function openSchoolMeet(tx, c) {
  ensureFamily(c);
  c.schoolMet = true;
  if (c.love.partner || c.spouse) {
    schoolMeetSummary(tx);
    return false;
  }
  openPrompt(tx, 'meet', c, { school: true });
  return true;
}

/** The 고교 첫 만남 recap (once): when every character had its meeting, or `force` (high school is over). */
export function schoolMeetSummary(tx, { force = false } = {}) {
  const room = tx.room;
  if (room.schoolMeetDone) return null;
  if (!force && !room.characters.every((x) => x.schoolMet || x.finished)) return null;
  room.schoolMeetDone = true;
  const pairs = (room.schoolMeetPairs ?? []).map((p) => ({ ...p, partner: personSpec(p.partner) }));
  if (!pairs.length) return null;
  const ev = emit(tx, 'schoolMeet', { eraId: 'high', pairs, summary: true, tone: 'love', emotion: 'love' });
  const names = pairs.map((p) => `${charById(room, p.charId)?.name}♥${p.partner.name}`).join(' · ');
  addLog(tx, `🏫 고교 첫 만남 결산! 설레는 커플 탄생 (${names})`, { tone: 'love' });
  return ev;
}

// ---------- heart tiles ----------

const inEra = (list, era) => !list || list.includes(era);

/**
 * Heart tile: no partner → 만남 prompt; partner → 데이트 prompt, or 프러포즈 at `proposeAt` (job eras);
 * married → 출산 roll (birth eras, < max children) else a family outing (money / stats, affection +).
 * @returns true when a prompt opened
 */
export function resolveHeartTile(tx, c) {
  ensureFamily(c);
  const cfg = cfgOf(tx.data);
  const aff = cfg.affection ?? {};
  if (c.spouse) {
    const born = tryBirth(tx, c);
    if (!born) familyOuting(tx, c);
    return false;
  }
  if (!c.love.partner) {
    if (!inEra(cfg.meetEras, c.era)) {
      addLog(tx, `💗 ${c.name}: 아직은 친구들이랑 노는 게 더 좋아!`, { tone: 'love', charId: c.id, emotion: 'joy' });
      return false;
    }
    openPrompt(tx, 'meet', c);
    return true;
  }
  if (c.love.affection >= (aff.proposeAt ?? 50) && inEra(cfg.propose?.eras, c.era)) {
    openPrompt(tx, 'propose', c);
    return true;
  }
  openPrompt(tx, 'date', c);
  return true;
}

/**
 * 소개팅: a single character choosing the love route meets someone at once (no prompt — prompts stay on heart / house
 * tiles). Weighted trait / ★ like a heart-tile meeting. Emits `met {charId, partner, affection, match, blindDate: true}`.
 * @returns the partner or null
 */
export function blindDate(tx, c) {
  ensureFamily(c);
  if (c.love.partner || c.spouse || c.finished) return null;
  const aff = cfgOf(tx.data).affection ?? {};
  const [partner] = popularize(tx, c, [makePartner(tx, c)]);
  const match = traitMatch(c, partner.trait);
  c.love.partner = partner;
  gainAffection(tx, c, (aff.meet ?? 25) + (match ? aff.matchBonus ?? 0 : 0), { set: true });
  c.love.dates = 0;
  emit(tx, 'met', { charId: c.id, partner: personSpec(partner), affection: c.love.affection, match, blindDate: true, tone: 'love', emotion: 'love' });
  addLog(tx, `💘 연애 루트에 들어선 ${c.name}, 소개팅에서 ${josa(partner.name, '과/와')} 사귀기 시작! (${traitName(tx.data, partner.trait)} ${starsText(partner.stars)})${match ? ' 찰떡궁합!' : ''}`, { tone: 'love', charId: c.id, emotion: 'love' });
  return partner;
}

/**
 * 연애 루트 선택: a single character meets someone at once (소개팅), a dating one gets `affection.loveRoute` (the couple
 * commits to the love route). @returns the partner or null
 */
export function loveRouteChosen(tx, c) {
  ensureFamily(c);
  if (c.spouse || c.finished) return null;
  if (!c.love.partner) return blindDate(tx, c);
  const aff = cfgOf(tx.data).affection ?? {};
  if (aff.loveRoute) {
    gainAffection(tx, c, aff.loveRoute);
    addLog(tx, `💕 ${josa(c.name, '과/와')} ${c.love.partner.name}, 연애 루트에서 사랑이 깊어진다 (호감도 ${c.love.affection})`, { tone: 'love', charId: c.id, emotion: 'love' });
  }
  return c.love.partner;
}

/**
 * Turn epilogue (growth.lifeStep): a dating couple whose affection reached `proposeAt` in a propose era gets ONE
 * 프러포즈 prompt per era (`love.askedEra`), even without a heart tile. @returns true when a prompt opened
 */
export function proposeStep(tx, c) {
  if (!c || c.finished) return false;
  ensureFamily(c);
  const cfg = cfgOf(tx.data);
  if (!c.love.partner || c.spouse || c.love.askedEra === c.era) return false;
  if ((c.love.affection ?? 0) < (cfg.affection?.proposeAt ?? 50) || !inEra(cfg.propose?.eras, c.era)) return false;
  openPrompt(tx, 'propose', c);
  return true;
}

/** 프러포즈 성공 확률. */
export function proposeChance(c, data) {
  const cfg = cfgOf(data);
  const p = cfg.propose ?? {};
  const aff = cfg.affection ?? {};
  const partner = c.love?.partner;
  let x = (p.base ?? 0.4) + ((c.love?.affection ?? 0) - (aff.proposeAt ?? 50)) * (p.perAffection ?? 0);
  x += (p.charm ?? 0) * (c.stats?.charm ?? 0) + (p.luck ?? 0) * (c.stats?.luck ?? 0);
  if (partner && traitMatch(c, partner.trait)) x += p.match ?? 0;
  return clamp(x, p.min ?? 0.05, p.max ?? 0.95);
}

/** 출산 확률 of a married character (0 outside birth eras / at max children). */
export function birthChance(c, data) {
  const cfg = cfgOf(data);
  const b = cfg.birth ?? {};
  if (!c?.spouse || !inEra(b.eras, c.era) || (c.children?.length ?? 0) >= (cfg.children?.max ?? 4)) return 0;
  const x = (b.base ?? 0.3) + (c.love?.affection ?? 0) * (b.perAffection ?? 0) - (c.children?.length ?? 0) * (b.perChild ?? 0);
  return clamp(x, 0, b.max ?? 0.85);
}

/** Wedding: spouse + 축의금 from every other character (era-scaled, capped at their cash) − wedding cost. */
function marry(tx, c) {
  const room = tx.room;
  const cfg = cfgOf(tx.data);
  const scale = scaleOf(tx.data, c.era);
  const partner = c.love.partner;
  const salary = cfg.stars?.[partner.stars]?.salary ?? 0;
  c.spouse = { ...partner, salary, marriedTurn: room.turn?.turnNo ?? 0 };
  c.love.partner = null;
  c.love.candidates = [];
  dropHeldCards(tx, c, 'married'); // 결혼운◎ / 인기 폭발◎ did their job
  const per = round5((cfg.costs?.weddingGift ?? 20) * scale);
  const gifts = [];
  for (const o of room.characters) {
    if (o.id === c.id) continue;
    const amount = Math.min(per, Math.max(0, o.money ?? 0));
    if (amount > 0) gifts.push({ fromId: o.id, amount });
  }
  const total = gifts.reduce((s, g) => s + g.amount, 0);
  const cost = round5((cfg.costs?.wedding ?? 0) * scale);
  emit(tx, 'married', { charId: c.id, spouse: personSpec(c.spouse), gifts, total, cost, tone: 'love', emotion: 'love' });
  addLog(tx, `💒 ${josa(c.name, '과/와')} ${c.spouse.name}의 결혼식! 축의금 ${won(total)}${cost ? ` · 식비 ${won(cost)}` : ''}`, { tone: 'love', charId: c.id, emotion: 'love' });
  for (const g of gifts) {
    const giver = charById(room, g.fromId);
    changeMoney(tx, giver, -g.amount, 'weddingGift', { to: c.id, tone: 'love', emotion: 'love' });
    changeMoney(tx, c, g.amount, 'weddingGift', { from: giver.id, tone: 'love', emotion: 'love' });
  }
  if (cost) changeMoney(tx, c, -Math.min(cost, Math.max(0, c.money)), 'wedding', { tone: 'love', emotion: 'sweat' });
}

/** Birth roll on a married character's heart tile. @returns the child or null */
function tryBirth(tx, c) {
  const p = birthChance(c, tx.data);
  if (!(p > 0) || !(tx.rng.next() < p)) return null;
  return bearChild(tx, c);
}

/** A child is born (talent / trait seeded). Emits `childBorn {charId, child}` + birth cost / 출산장려금. */
export function bearChild(tx, c) {
  const room = tx.room;
  const cfg = cfgOf(tx.data);
  const kc = cfg.children ?? {};
  if ((c.children?.length ?? 0) >= (kc.max ?? 4)) return null;
  const spouse = c.spouse;
  const g = kc.genius ?? {};
  const match = spouse ? traitMatch(c, spouse.trait) : false;
  const geniusP = clamp((g.base ?? 0.15) + (match ? g.match ?? 0 : 0) + (g.luck ?? 0) * (c.stats?.luck ?? 0), 0, 0.95);
  const talent = tx.rng.next() < geniusP ? 'genius' : 'normal';
  const trait = spouse && tx.rng.next() < 0.5 ? spouse.trait : tx.rng.pick(topStats(c));
  const body = tx.rng.next() < 0.5 ? 'boy' : 'girl';
  room.nextChildSeq = (room.nextChildSeq ?? 0) + 1;
  const child = {
    id: `ch${room.nextChildSeq}`,
    name: pickName(tx, body, usedNames(room)),
    trait,
    talent,
    stage: 'baby',
    bornTurn: room.turn?.turnNo ?? 0,
    avatar: randomLook(tx, body, { child: true, parents: [c.avatar, spouse?.avatar] }),
    body,
    growth: 0,
    turns: 0,
  };
  c.children.push(child);
  emit(tx, 'childBorn', { charId: c.id, child: personSpec(child), spouse: personSpec(spouse), tone: 'love', emotion: 'joy' });
  addLog(tx, `👶 ${c.name}네 집에 ${child.name} 탄생!${talent === 'genius' ? ' 눈빛이 예사롭지 않다… 천재?!' : ''}`, { tone: 'love', charId: c.id, emotion: 'joy' });
  const cost = round5((cfg.costs?.birth ?? 0) * scaleOf(tx.data, c.era));
  if (cost) changeMoney(tx, c, -Math.min(cost, Math.max(0, c.money)), 'birth', { tone: 'love', emotion: 'sweat' });
  const bonus = effectsFor(tx, c).birthBonus ?? 0;
  if (bonus > 0) {
    changeMoney(tx, c, bonus, 'birthBonus', { tone: 'good', emotion: 'joy' });
    addLog(tx, `🍼 출산장려금 ${won(bonus)} 지급!`, { tone: 'good', charId: c.id, emotion: 'joy' });
  }
  return child;
}

function familyOuting(tx, c) {
  const cfg = cfgOf(tx.data);
  const list = cfg.outings ?? [];
  const aff = cfg.affection ?? {};
  gainAffection(tx, c, aff.familyGain ?? 0);
  if (!list.length) return;
  const o = tx.rng.pick(list);
  const [lo, hi] = o.money ?? [0, 0];
  let delta = round5(tx.rng.int(lo, hi) * scaleOf(tx.data, c.era));
  if (delta < 0) delta = -Math.min(-delta, Math.max(0, c.money));
  const text = o.text.replaceAll('{name}', c.name);
  addLog(tx, `${text}${delta ? ` (${delta > 0 ? '+' : ''}${won(delta)})` : ''}`, { tone: 'love', charId: c.id, emotion: 'love' });
  if (delta) changeMoney(tx, c, delta, 'family', { tone: delta > 0 ? 'good' : 'love', emotion: 'love', outing: o.id });
  if (o.stats) addStats(tx, c, o.stats, 'family');
}

// ---------- children: growth + allowance ----------

/** One growth step of a child (돌잔치 → 입학 → 수능 → 취업). Emits `childGrew`. */
function growChild(tx, c, child) {
  const room = tx.room;
  const kc = cfgOf(tx.data).children ?? {};
  const step = GROWTH_STEPS[child.growth ?? 0];
  if (!step) return null;
  child.growth = (child.growth ?? 0) + 1;
  child.turns = 0;
  child.stage = step.stage;
  const scale = scaleOf(tx.data, c.era);
  const base = { charId: c.id, childId: child.id, stage: child.stage, kind: step.kind };
  if (step.kind === 'dol') {
    const per = round5((kc.dolGift ?? 10) * scale);
    const gifts = [];
    for (const o of room.characters) {
      if (o.id === c.id) continue;
      const amount = Math.min(per, Math.max(0, o.money ?? 0));
      if (amount > 0) gifts.push({ fromId: o.id, amount });
    }
    const total = gifts.reduce((s, g) => s + g.amount, 0);
    emit(tx, 'childGrew', { ...base, amount: total, gifts, child: personSpec(child), tone: 'love', emotion: 'joy' });
    addLog(tx, `🎂 ${child.name}의 돌잔치! 돌잡이는… ${tx.rng.pick(['연필', '마이크', '돈', '청진기', '공'])}! (축하금 ${won(total)})`, { tone: 'love', charId: c.id, emotion: 'joy' });
    for (const g of gifts) {
      const giver = charById(room, g.fromId);
      changeMoney(tx, giver, -g.amount, 'dolGift', { to: c.id, tone: 'love', emotion: 'love' });
      changeMoney(tx, c, g.amount, 'dolGift', { from: giver.id, tone: 'love', emotion: 'joy' });
    }
  } else if (step.kind === 'school') {
    const cost = round5((kc.schoolCost ?? 40) * scale);
    emit(tx, 'childGrew', { ...base, amount: -cost, child: personSpec(child), tone: 'neutral', emotion: 'sweat' });
    addLog(tx, `🎒 ${child.name} 입학! 학원비가 만만치 않다 (−${won(cost)})`, { tone: 'info', charId: c.id, emotion: 'sweat' });
    changeMoney(tx, c, -cost, 'school', { tone: 'bad', emotion: 'sweat' });
  } else if (step.kind === 'exam') {
    const eg = kc.examGift ?? {};
    const result = child.talent === 'genius' ? 'elite' : tx.rng.next() < (eg.collegeChance ?? 0.5) ? 'college' : 'fail';
    const amount = result === 'elite' ? round5((eg.genius ?? 100) * scale) : result === 'college' ? round5((eg.college ?? 30) * scale) : 0;
    emit(tx, 'childGrew', { ...base, amount, result, child: personSpec(child), tone: result === 'fail' ? 'neutral' : 'good', emotion: result === 'fail' ? 'sweat' : 'joy' });
    const text = { elite: `🎓 ${child.name} 수능 만점! 명문대 합격 축하금 ${won(amount)}`, college: `🎓 ${child.name} 대학 합격! 축하금 ${won(amount)}`, fail: `📖 ${child.name}, 수능은 아쉽지만 인생은 기니까!` }[result];
    addLog(tx, text, { tone: result === 'fail' ? 'info' : 'good', charId: c.id, emotion: result === 'fail' ? 'sweat' : 'joy' });
    if (amount) changeMoney(tx, c, amount, 'childExam', { tone: 'good', emotion: 'joy' });
  } else {
    const amount = allowanceAmount(tx, c, child);
    emit(tx, 'childGrew', { ...base, amount, child: personSpec(child), tone: 'good', emotion: 'joy' });
    addLog(tx, `💼 ${child.name} 취업 성공! 이제 급여 칸마다 용돈 ${won(amount)}을 보내 준대`, { tone: 'good', charId: c.id, emotion: 'joy' });
  }
  return child;
}

/**
 * A character entered a new era: employed children send 용돈 (`allowance.eras`), every child grows one step, a dating
 * couple's affection deepens (`affection.eraGain`), and a married parent rolls for a birth (birth eras).
 */
export function growChildrenOnEra(tx, c) {
  ensureFamily(c);
  const cfg = cfgOf(tx.data);
  if (cfg.children?.allowanceOnEra !== false) payAllowances(tx, c);
  for (const child of c.children ?? []) growChild(tx, c, child);
  const aff = cfg.affection ?? {};
  if (c.love.partner && !c.spouse && aff.eraGain) gainAffection(tx, c, aff.eraGain);
  if (c.spouse) tryBirth(tx, c);
}

/**
 * Per parent spin: count up; a child grows after `growTurns` spins without a step. A married parent also rolls
 * `birthChance × birth.perSpin` for a birth.
 */
export function growChildrenOnSpin(tx, c) {
  ensureFamily(c);
  const cfg = cfgOf(tx.data);
  const every = cfg.children?.growTurns ?? 2;
  for (const child of c.children ?? []) {
    if ((child.growth ?? 0) >= GROWTH_STEPS.length) continue;
    child.turns = (child.turns ?? 0) + 1;
    if (child.turns >= every) growChild(tx, c, child);
  }
  const per = cfg.birth?.perSpin ?? 0;
  if (c.spouse && per > 0) {
    const p = birthChance(c, tx.data) * per;
    if (p > 0 && tx.rng.next() < p) bearChild(tx, c);
  }
}

/** 용돈 of an employed child per salary tile: allowance × talent × spouse ★ allowanceMult × job-era multiplier. */
export function allowanceAmount(tx, c, child) {
  const cfg = cfgOf(tx.data);
  const kc = cfg.children ?? {};
  const talent = kc.talentMult?.[child.talent] ?? 1;
  const stars = cfg.stars?.[c.spouse?.stars]?.allowanceMult ?? 1;
  const era = tx.data.balance.jobs?.salaryEraMult?.[c.era] ?? 1;
  return round5((kc.allowance ?? 30) * talent * stars * era);
}

/** Salary tile: every employed child sends 용돈 → `allowance {charId, childId, amount}` + moneyChanged. */
export function payAllowances(tx, c) {
  let total = 0;
  for (const child of c.children ?? []) {
    if ((child.growth ?? 0) < GROWTH_STEPS.length) continue;
    const amount = allowanceAmount(tx, c, child);
    if (!amount) continue;
    emit(tx, 'allowance', { charId: c.id, childId: child.id, amount, tone: 'good', emotion: 'joy' });
    changeMoney(tx, c, amount, 'allowance', { childId: child.id, tone: 'good', emotion: 'joy' });
    addLog(tx, `💌 ${child.name}의 용돈 송금 +${won(amount)}`, { tone: 'good', charId: c.id, emotion: 'joy' });
    total += amount;
  }
  return total;
}

// ---------- prompts ----------

function dateOptions(tx, c) {
  const cfg = cfgOf(tx.data);
  const partner = c.love.partner;
  const scale = scaleOf(tx.data, c.era);
  const bonus = cfg.affection?.matchBonus ?? 0;
  // blue cards: 결혼운◎ (+affectionBonus on every gain) and 인기 폭발◎ (+dateGain) — shown in the option's gain
  const cardBonus = affectionBonus(tx.data, c) + (popularEffect(tx.data, c)?.dateGain ?? 0);
  return (cfg.dates ?? []).map((d) => {
    const cost = d.cost ? round5(d.cost * scale) : 0;
    const match = !!d.trait && d.trait === partner.trait;
    const gain = (d.gain ?? 0) + (match ? bonus : 0) + cardBonus;
    const opt = {
      id: `date:${d.id}`,
      dateId: d.id,
      label: `${d.icon} ${d.name}`,
      icon: d.icon,
      trait: d.trait ?? null,
      cost,
      price: cost,
      gain,
      match,
      desc: `호감도 +${gain}${match ? ` (${partner.name} 취향 저격!)` : ''}${cost ? ` · ${won(cost)}` : ' · 무료'}`,
    };
    if (cost > (c.money ?? 0)) Object.assign(opt, { disabled: true, desc: `${opt.desc} · 돈이 부족해요` });
    return opt;
  });
}

registerPrompts({
  /** 만남 (heart tile, no partner): 2 candidates (weighted trait / ★) or pass. */
  meet: {
    resultCutin: 'auto',
    build(tx, c, { school = false } = {}) {
      const cfg = cfgOf(tx.data);
      const taken = usedNames(tx.room);
      // 고교 첫 만남 (loop maps: the first high-school turn): two ★1 classmates
      const stars = school ? 1 : null;
      const candidates = popularize(tx, c, [makePartner(tx, c, { taken, stars }), makePartner(tx, c, { taken, stars })], { school });
      c.love.candidates = candidates.map(personSpec);
      const bonus = cfg.affection?.matchBonus ?? 0;
      const options = candidates.map((p) => {
        const match = traitMatch(c, p.trait);
        const salary = cfg.stars?.[p.stars]?.salary ?? 0;
        return {
          id: `meet:${p.id}`,
          partnerId: p.id,
          label: `${traitIcon(tx.data, p.trait)} ${p.name} ${starsText(p.stars)}`,
          icon: '💘',
          trait: p.trait,
          stars: p.stars,
          salary,
          match,
          partner: personSpec(p),
          desc: `${traitName(tx.data, p.trait)} · 맞벌이 월급 ${won(salary)}${match ? ` · 찰떡궁합! 호감도 +${bonus}` : ''}`,
        };
      });
      const best = [...options].sort((a, b) => Number(b.match) - Number(a.match) || b.stars - a.stars)[0];
      options.push({ id: 'pass', label: '🙅 다음 기회에', icon: '🙅', desc: '이번 만남은 그냥 지나쳐요' });
      return {
        forCharacterIds: [c.id],
        title: school ? '🏫 고교 첫 만남' : '💘 운명의 만남',
        text: school ? `고등학생이 된 ${josa(c.name, '이/가')} 설레는 두 친구를 만났다! 누구와 사귀어 볼까?` : `${josa(c.name, '이/가')} 설레는 두 사람을 만났다! 누구와 사귀어 볼까?`,
        options,
        defaultOptionId: best.id,
        context: { candidates: candidates.map(personSpec), ...(school ? { school: true } : {}) },
      };
    },
    resolve(tx, p) {
      const c = charById(tx.room, p.charId);
      const aff = cfgOf(tx.data).affection ?? {};
      const answer = p.answers[c.id];
      const partner = (p.context?.candidates ?? []).find((x) => `meet:${x.id}` === answer);
      c.love.candidates = [];
      const school = !!p.context?.school;
      if (!partner || c.love.partner || c.spouse) {
        addLog(tx, `🙅 ${josa(c.name, '은/는')} 이번 인연은 그냥 보내기로 했다`, { tone: 'info', charId: c.id, emotion: 'neutral' });
        if (school) schoolMeetSummary(tx);
        return { result: 'pass', ...(school ? { school: true } : {}) };
      }
      const match = traitMatch(c, partner.trait);
      c.love.partner = personSpec(partner);
      gainAffection(tx, c, (aff.meet ?? 25) + (match ? aff.matchBonus ?? 0 : 0), { set: true });
      c.love.dates = 0;
      emit(tx, 'met', { charId: c.id, partner: personSpec(partner), affection: c.love.affection, match, ...(school ? { school: true } : {}), tone: 'love', emotion: 'love' });
      addLog(tx, `${school ? '🏫' : '💘'} ${josa(c.name, '과/와')} ${partner.name}(${traitName(tx.data, partner.trait)} ${starsText(partner.stars)}) 사귀기 시작!${match ? ' 찰떡궁합!' : ''}`, { tone: 'love', charId: c.id, emotion: 'love' });
      if (school) {
        (tx.room.schoolMeetPairs ??= []).push({ charId: c.id, partner: personSpec(partner) });
        schoolMeetSummary(tx);
      }
      return { result: 'met' };
    },
  },

  /**
   * 데이트 (heart tile, partner): trait-matched dates give more affection; cost × era scale. Reaching `proposeAt`
   * in a propose era opens the 프러포즈 prompt right away (same heart tile).
   */
  date: {
    resultCutin: true,
    build(tx, c) {
      const partner = c.love.partner;
      const options = dateOptions(tx, c);
      const enabled = options.filter((o) => !o.disabled);
      const def = enabled.find((o) => o.match) ?? [...enabled].sort((a, b) => a.cost - b.cost || b.gain - a.gain)[0] ?? options[0];
      return {
        forCharacterIds: [c.id],
        title: '💕 데이트',
        text: `${c.name}♥${partner.name} (호감도 ${c.love.affection}) — 어디로 갈까? ${traitName(tx.data, partner.trait)}인 ${partner.name}의 취향을 맞추면 호감도가 더 올라요`,
        options,
        defaultOptionId: def.id,
        context: { partnerId: partner.id },
      };
    },
    resolve(tx, p) {
      const c = charById(tx.room, p.charId);
      const aff = cfgOf(tx.data).affection ?? {};
      const partner = c.love.partner;
      if (!partner) return { result: 'none' };
      const opt = dateOptions(tx, c).find((o) => o.id === p.answers[c.id] && !o.disabled) ?? dateOptions(tx, c)[0];
      if (opt.cost > 0) changeMoney(tx, c, -Math.min(opt.cost, Math.max(0, c.money)), 'date', { tone: 'love', emotion: 'love' });
      c.love.affection = Math.min(aff.max ?? 100, (c.love.affection ?? 0) + opt.gain); // opt.gain includes the card bonuses
      c.love.dates = (c.love.dates ?? 0) + 1;
      emit(tx, 'dated', { charId: c.id, partnerId: partner.id, partner: personSpec(partner), dateId: opt.dateId, trait: opt.trait, cost: opt.cost, gain: opt.gain, affection: c.love.affection, match: opt.match, tone: 'love', emotion: 'love' });
      addLog(tx, `${opt.icon} ${josa(c.name, '과/와')} ${partner.name}의 ${opt.label.replace(/^\S+\s/, '')}! 호감도 +${opt.gain} (${c.love.affection})${opt.match ? ' 취향 저격!' : ''}`, { tone: 'love', charId: c.id, emotion: 'love' });
      const cfg = cfgOf(tx.data);
      const propose = c.love.affection >= (aff.proposeAt ?? 50) && inEra(cfg.propose?.eras, c.era);
      if (propose) openPrompt(tx, 'propose', c);
      return { result: 'dated', dateId: opt.dateId, partnerId: partner.id, gain: opt.gain, affection: c.love.affection, propose };
    },
  },

  /** 프러포즈 (heart tile, affection ≥ proposeAt, job eras): success → wedding, fail → affection drop. */
  propose: {
    build(tx, c) {
      const partner = c.love.partner;
      const chance = proposeChance(c, tx.data);
      const steady = cfgOf(tx.data).affection?.steadyGain ?? 10;
      c.love.askedEra = c.era; // at most one epilogue proposal per era (heart tiles may still ask again)
      return {
        forCharacterIds: [c.id],
        title: '💍 프러포즈',
        text: `${josa(partner.name, '과/와')}의 호감도 ${c.love.affection}! ${josa(c.name, '은/는')} 오늘 반지를 꺼낼까?`,
        options: [
          { id: 'propose', label: '💍 프러포즈!', icon: '💍', chance, partnerId: partner.id, desc: `성공 확률 약 ${Math.round(chance * 100)}% · 성공하면 결혼식 (축의금·맞벌이)` },
          { id: 'steady', label: '💕 조금 더 사귀기', icon: '💕', chance: 0, partnerId: partner.id, desc: `호감도 +${steady} (무료) · 다음 하트 칸에서 다시` },
        ],
        defaultOptionId: 'propose',
        context: { partnerId: partner.id, chance },
      };
    },
    resolve(tx, p) {
      const c = charById(tx.room, p.charId);
      const aff = cfgOf(tx.data).affection ?? {};
      const partner = c.love.partner;
      if (!partner) return null;
      if (p.answers[c.id] === 'steady') {
        const before = c.love.affection ?? 0;
        const gain = gainAffection(tx, c, aff.steadyGain ?? 10) - before;
        c.love.dates = (c.love.dates ?? 0) + 1;
        emit(tx, 'dated', { charId: c.id, partnerId: partner.id, partner: personSpec(partner), dateId: 'steady', trait: null, cost: 0, gain, affection: c.love.affection, match: false, tone: 'love', emotion: 'love' });
        addLog(tx, `💕 ${josa(c.name, '은/는')} ${josa(partner.name, '과/와')} 조금 더 천천히 사귀기로 했다 (호감도 ${c.love.affection})`, { tone: 'love', charId: c.id, emotion: 'love' });
        return null;
      }
      const chance = proposeChance(c, tx.data);
      const success = tx.rng.next() < chance;
      emit(tx, 'proposed', { charId: c.id, partnerId: partner.id, partner: personSpec(partner), success, chance, tone: success ? 'love' : 'bad', emotion: success ? 'love' : 'cry' });
      if (success) {
        addLog(tx, `💍 ${c.name}의 프러포즈 대성공! ${partner.name}: "좋아!"`, { tone: 'love', charId: c.id, emotion: 'love' });
        marry(tx, c);
      } else {
        c.love.affection = Math.max(0, c.love.affection - (aff.failDrop ?? 15));
        addLog(tx, `💔 ${c.name}의 프러포즈 실패… ${partner.name}: "아직은 좀…" (호감도 ${c.love.affection})`, { tone: 'bad', charId: c.id, emotion: 'cry' });
      }
      return null;
    },
  },
});

