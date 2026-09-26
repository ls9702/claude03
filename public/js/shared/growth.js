// Stage 6 client helpers (pure: no DOM, no Node) — growth outfits, stats, jobs, education, military.
// Shared by game2d.js, cutin2d.js, cutinMap.js, the 3D board and node tests.
//
//   effectiveAvatar(character, {room, avatars, jobs})  → the look shown in game (era / job costume)
//   displayCharacters(room, {avatars, jobs, overrides}) → room.characters with `avatar` = effective look
//   STAT_KEYS / STAT_INFO / statCap / statPct / statChip  → 지력·체력·매력·운 bars and cut-in chips
//   jobInfo / jobBadge / rankStars / salaryChip           → job badge (icon · name · ★ rank / max · 부상 · 알바)
//   educationLabel / militaryLabel / optionExtras         → 학력, 군 복무, prompt option badges (jobOffer)
//
// Everything is feature-detected: characters / rooms / meta without the Stage 6 fields render as before.

/** Contract default of `avatars.json.eraOutfits` (used when the server's defs don't have it yet). */
export const DEFAULT_ERA_OUTFITS = Object.freeze({
  baby: { any: 'dino' },
  elem: { any: 'tracksuit' },
  middle: { boy: 'uniform', girl: 'sailor' },
  high: { boy: 'uniform', girl: 'sailor' },
  young: { job: true },
  middle_age: { job: true },
  senior: { any: 'hanbokTrad' },
});

export const PART_TIME_ID = 'parttime';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** `avatars.eraOutfits` when it has entries, else the contract default. */
export function eraOutfitTable(avatars) {
  const t = avatars?.eraOutfits;
  return isObj(t) && Object.keys(t).length ? t : DEFAULT_ERA_OUTFITS;
}

/** Era id of a character in a playing / finished room (`character.era`, else its board position). */
export function characterEra(character, room) {
  if (typeof character?.era === 'string' && character.era) return character.era;
  const eras = room?.board?.eras;
  if (!Array.isArray(eras) || !eras.length) return null;
  const i = Math.min(Math.max(0, character?.position?.eraIndex ?? 0), eras.length - 1);
  return eras[i]?.id ?? null;
}

/** Normalized `/api/meta.jobs` → {list: job[], partTime: job|null}. */
function jobsOf(jobs) {
  if (Array.isArray(jobs)) return { list: jobs, partTime: null };
  return { list: Array.isArray(jobs?.jobs) ? jobs.jobs : [], partTime: isObj(jobs?.partTime) ? jobs.partTime : null };
}

/**
 * Job definition by id (jobs.json job or the part-time job) → {id, name, icon, ranks[], maxRank, hidden, partTime, …}
 * or null when unknown. A missing definition still yields a minimal entry for the part-time id.
 */
export function jobInfo(jobId, jobs) {
  if (!jobId) return null;
  const { list, partTime } = jobsOf(jobs);
  const pt = jobId === PART_TIME_ID || (partTime && partTime.id === jobId);
  const def = pt ? partTime ?? { id: PART_TIME_ID, name: '알바', icon: '🧾' } : list.find((j) => j?.id === jobId);
  if (!def) return null;
  const ranks = Array.isArray(def.ranks) ? def.ranks : [];
  return { ...def, id: def.id ?? jobId, name: def.name ?? jobId, icon: def.icon ?? '💼', ranks, maxRank: Math.max(1, ranks.length), hidden: !!def.hidden, partTime: pt };
}

/** Costume of a job (jobs.json `outfit`), null when unknown. */
export function jobOutfit(job, jobs) {
  const id = typeof job === 'string' ? job : job?.id;
  const info = jobInfo(id, jobs);
  return typeof info?.outfit === 'string' && info.outfit ? info.outfit : null;
}

function outfitExists(id, avatars) {
  const list = avatars?.parts?.outfit;
  if (!Array.isArray(list) || !list.length) return true; // no defs → trust the data
  return list.some((o) => o?.id === id);
}

/**
 * The avatar a character is drawn with in game. Growth outfits (room config `growthOutfits`, default on) swap the
 * chosen outfit for the era costume (`eraOutfits[era][body] ?? .any`) or, in `job: true` eras, the character's job
 * costume (jobs.json / part-time; no job → the chosen outfit). Only in playing / finished rooms — the lobby and the
 * customizer always show the chosen look. The player's `outfitColor` is kept: tintable costumes wear it, fixed-colour
 * ones (doctor/police/chef/taekwondo) ignore it in every renderer.
 * @param {object} character  {avatar, era?, position?, job?}
 * @param {{room?: object, avatars?: object, jobs?: object, job?: object|null}} ctx  `job` overrides character.job
 *   (e.g. a jobChanged cut-in shows the post-event job)
 * @returns {object} avatar (the same object when nothing changes)
 */
export function effectiveAvatar(character, { room = null, avatars = null, jobs = null, job } = {}) {
  const avatar = isObj(character?.avatar) ? character.avatar : {};
  if (!room || (room.status !== 'playing' && room.status !== 'finished')) return avatar;
  if (room.config?.growthOutfits === false) return avatar;
  const era = characterEra(character, room);
  const entry = era ? eraOutfitTable(avatars)[era] : null;
  if (!isObj(entry)) return avatar;
  let outfit = null;
  if (entry.job) {
    outfit = jobOutfit(job !== undefined ? job : character?.job, jobs);
  } else {
    const body = avatar.body ?? avatars?.default?.body ?? 'boy';
    outfit = entry[body] ?? entry.any ?? null;
  }
  if (typeof outfit !== 'string' || !outfit || outfit === avatar.outfit || !outfitExists(outfit, avatars)) return avatar;
  return { ...avatar, outfit };
}

/**
 * Characters of a room with `avatar` replaced by the effective look (`chosenAvatar` keeps the original).
 * `overrides` = {[charId]: {job}} (post-event job for a cut-in). Unchanged characters are returned as-is.
 */
export function displayCharacters(room, { avatars = null, jobs = null, overrides = null } = {}) {
  return (room?.characters ?? []).map((c) => {
    const o = overrides?.[c.id];
    const a = effectiveAvatar(c, { room, avatars, jobs, ...(o && 'job' in o ? { job: o.job } : {}) });
    return a === c.avatar ? c : { ...c, avatar: a, chosenAvatar: c.avatar };
  });
}

// ---------- stats ----------
export const STAT_KEYS = ['int', 'str', 'charm', 'luck'];
export const STAT_INFO = Object.freeze({
  int: { label: '지력', icon: '🧠', color: '#4f7be0' },
  str: { label: '체력', icon: '💪', color: '#e0643b' },
  charm: { label: '매력', icon: '✨', color: '#e05aa0' },
  luck: { label: '운', icon: '🍀', color: '#2f9e58' },
});

/** Stat cap: `/api/meta.balance.stats.cap` when present, else 10. */
export function statCap(meta) {
  const cap = Number(meta?.balance?.stats?.cap);
  return Number.isFinite(cap) && cap > 0 ? cap : 10;
}

/** Bar fill 0..100 (%). */
export function statPct(value, cap = 10) {
  const v = Number(value);
  if (!Number.isFinite(v) || cap <= 0) return 0;
  return Math.round((Math.min(cap, Math.max(0, v)) / cap) * 100);
}

/** Stats present on a character → [{key, label, icon, color, value, pct}] (empty when the field is missing). */
export function statRows(character, cap = 10) {
  const s = character?.stats;
  if (!isObj(s)) return [];
  return STAT_KEYS.map((key) => ({ key, ...STAT_INFO[key], value: Number(s[key]) || 0, pct: statPct(s[key], cap) }));
}

/** Cut-in chip for a statChanged follow-up ("🧠 지력 +1"). */
export function statChip({ stat, delta } = {}) {
  const info = STAT_INFO[stat] ?? { label: String(stat ?? ''), icon: '⭐', color: null };
  const d = Number(delta) || 0;
  return { text: `${info.icon} ${info.label} ${d > 0 ? '+' : ''}${d}`, kind: d >= 0 ? `stat stat-${stat} plus` : `stat stat-${stat} minus`, stat, color: info.color };
}

/** Salary chip ("💵 월급 +320만원"); `won` = money formatter. */
export function salaryChip({ amount } = {}, won = (n) => `${n}만원`) {
  const a = Number(amount) || 0;
  return { text: `💵 월급 ${a >= 0 ? '+' : ''}${won(a)}`, kind: 'plus salary' };
}

// ---------- jobs ----------
/** "★★☆☆" (rank 1-based, clamped to max). */
export function rankStars(rank, max = 1) {
  const m = Math.max(1, Math.min(10, Number(max) || 1));
  const r = Math.max(0, Math.min(m, Number(rank) || 0));
  return '★'.repeat(r) + '☆'.repeat(m - r);
}

/** Rank title of a job (ranks[rank-1].name), '' when unknown. */
export function rankName(info, rank) {
  const r = info?.ranks?.[Math.max(0, (Number(rank) || 1) - 1)];
  return typeof r?.name === 'string' ? r.name : '';
}

/** Salary of a job rank (ranks[rank-1].salary), null when unknown. */
export function rankSalary(info, rank = 1) {
  const r = info?.ranks?.[Math.max(0, (Number(rank) || 1) - 1)];
  const s = Number(r?.salary);
  return Number.isFinite(s) ? s : null;
}

/**
 * Job badge data for a character → null without a job.
 * @returns {{id, icon, name, rank, maxRank, stars, rankName, injured: number, partTime: boolean, hidden: boolean, text: string}|null}
 */
export function jobBadge(character, jobs) {
  const j = character?.job;
  if (!isObj(j) || !j.id) return null;
  const info = jobInfo(j.id, jobs) ?? { id: j.id, name: j.id, icon: '💼', ranks: [], maxRank: 1, partTime: j.id === PART_TIME_ID, hidden: false };
  const maxRank = Math.max(info.maxRank, Number(j.rank) || 1);
  const rank = Math.max(1, Number(j.rank) || 1);
  const injured = Number(j.injured) > 0 ? Number(j.injured) : j.injured === true ? 1 : 0;
  const stars = info.partTime && maxRank <= 1 ? '' : rankStars(rank, maxRank);
  return {
    id: info.id,
    icon: info.icon,
    name: info.name,
    rank,
    maxRank,
    stars,
    rankName: rankName(info, rank),
    injured,
    partTime: !!info.partTime,
    hidden: !!info.hidden,
    text: `${info.icon} ${info.name}${stars ? ` ${stars}` : ''}`,
  };
}

// ---------- education / military ----------
export const EDUCATION_LABEL = Object.freeze({ college: '대졸', elite: '명문대졸' });
export function educationLabel(education) {
  return EDUCATION_LABEL[education] ?? '';
}

/** "군필" / "복무 중 (2턴)" / "면제" / '' */
export function militaryLabel(military) {
  if (!isObj(military)) return '';
  switch (military.status) {
    case 'serving': {
      const n = Number(military.turnsLeft);
      return Number.isFinite(n) && n > 0 ? `복무 중 (${n}턴)` : '복무 중';
    }
    case 'done':
      return '군필';
    case 'exempt':
      return '면제';
    default:
      return '';
  }
}

// ---------- prompt options (jobOffer etc.) ----------
const REQ_EDU_LABEL = { college: '대졸', elite: '명문대', none: '' };

/**
 * Requirement badges of a job (`requires` in jobs.json; tolerant of {int: 5}, {stats: {int: 5}}, {education}).
 * @returns {string[]} e.g. ['🧠 5+', '🎓 대졸']
 */
export function requirementBadges(requires) {
  const out = [];
  const walk = (obj) => {
    if (!isObj(obj)) return;
    for (const [k, v] of Object.entries(obj)) {
      if (STAT_INFO[k] && Number.isFinite(Number(v)) && Number(v) > 0) out.push(`${STAT_INFO[k].icon} ${Number(v)}+`);
      else if (k === 'stats' || k === 'minStats') walk(v);
      else if (k === 'education' && REQ_EDU_LABEL[v]) out.push(`🎓 ${REQ_EDU_LABEL[v]}`);
      else if (k === 'military' && (v === true || v === 'done')) out.push('🪖 군필');
    }
  };
  walk(requires);
  return out;
}

/**
 * Extra info for a prompt option: job offers get the job icon, the starting salary (rank 1) and requirement
 * badges from `/api/meta.jobs`. → {icon, salary: number|null, badges: string[], jobId}
 */
export function optionExtras(pending, option, { jobs = null } = {}) {
  const kind = pending?.kind;
  const jobKinds = ['jobOffer', 'jobTile', 'hiddenJobOffer', 'career'];
  const id = option?.jobId ?? (jobKinds.includes(kind) ? option?.id : null);
  const info = id ? jobInfo(id, jobs) : null;
  if (!info) return { icon: option?.icon ?? '', salary: null, badges: [], jobId: null };
  // the server's one-line desc may already name the pay ("… · 첫 월급 90만원") → no second salary badge
  const salary = /월급/.test(String(option?.desc ?? '')) ? null : rankSalary(info, 1);
  return { icon: option?.icon || info.icon, salary, badges: requirementBadges(info.requires), jobId: info.id };
}

/** Option label without a leading copy of its icon ("📹 유튜버" + icon 📹 → "유튜버"). */
export function optionLabel(option) {
  const label = String(option?.label ?? option?.id ?? '');
  const icon = String(option?.icon ?? '');
  return icon && label.startsWith(icon) ? label.slice(icon.length).trim() || label : label;
}
