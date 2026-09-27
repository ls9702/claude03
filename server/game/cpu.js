// Stage 9-C — CPU players (pure). `cpuDecide(room, charId, data) → action | null` picks the next engine action of a
// CPU-owned character (`ownerSessionId === 'cpu'`) from the room state alone: trade answers, prompt answers and
// the spin (+ at most one card before it). Deterministic: the only randomness is a sub-RNG hashed from the room
// (seed, rngState, turn, prompt, character) — the game RNG is never consumed. The side-effect layer
// (store/gameRunner.js) schedules these actions with a delay; scripts/cpu-game.js plays whole games with it.
//
// Heuristics (docs/PLAN.md "CPU"): route by stats / cash (charm → love, int → career, cash → money), jobs that fit
// the stats (salary × rank-up odds), habits toward the best reachable job, 수능 study vs guess by the odds, promotion
// exam when the chance is good, shop / house only with money to spare, sabotage against the richest rival, trade
// offers accepted when what the CPU gets is worth at least what it gives. CPUs never bet, never offer trades and
// never give gifts. Each CPU has a personality (cautious / normal / bold) that nudges the thresholds.
import { gameData } from '../data/index.js';
import { nextPosition, tileAt } from './board.js';
import { STAT_KEYS, statCap } from './effects.js';
import { examChances } from './growth.js';
import { PART_TIME_ID, jobDef, jobRequirements, rankUpChance, regularJobs, salaryAmount } from './jobs.js';
import { effectsFor } from './news.js';
import { cardDef, handLimit, itemDef } from './cards.js';
import { computeRanking } from './result.js';
import { createRng } from './rng.js';

export const CPU_OWNER = 'cpu';
export const PERSONALITIES = ['cautious', 'normal', 'bold'];

/** Personality knobs: thresholds / reserves / margins (money in 만원). */
export const PERSONALITY = {
  cautious: { promotion: 0.6, retake: 0.6, propose: 0.6, reserve: 300, shopMult: 0.85, sabotage: 1.15, tradeMargin: 1.15, stake: 'low', routeBias: { career: 1 } },
  normal: { promotion: 0.5, retake: 0.5, propose: 0.45, reserve: 300, shopMult: 1, sabotage: 0.95, tradeMargin: 1, stake: 'mid', routeBias: {} },
  bold: { promotion: 0.4, retake: 0.4, propose: 0.3, reserve: 150, shopMult: 1.2, sabotage: 0.8, tradeMargin: 0.9, stake: 'high', routeBias: { money: 1 } },
};

export const isCpu = (c) => c?.ownerSessionId === CPU_OWNER;

// ---------- deterministic hashing ----------

/** FNV-1a over the stringified parts → uint32. */
export function cpuHash(...parts) {
  let h = 0x811c9dc5;
  for (const ch of parts.map(String).join('|')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A character's CPU personality: the stored one, else seeded from the room seed + character id. */
export function cpuPersonality(c, room = null) {
  if (PERSONALITIES.includes(c?.cpuPersonality)) return c.cpuPersonality;
  return PERSONALITIES[cpuHash(room?.seed ?? 0, c?.id ?? '') % PERSONALITIES.length];
}

const knobs = (c, room) => PERSONALITY[cpuPersonality(c, room)];

/** Sub-RNG for small tie-breaks: identical for identical states, independent of the game RNG. */
function subRng(room, c, salt = '') {
  const t = room.turn ?? {};
  return createRng(cpuHash(room.seed ?? 0, room.rngState ?? 0, t.turnNo ?? 0, room.promptSeq ?? 0, c.id, salt));
}

// ---------- evaluation helpers ----------

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
/** Read-only context for engine helpers that take a tx (they only read `room` and `data`). */
const view = (room, data) => ({ room, data, now: 0, events: [], logs: [] });
const statOf = (c, k) => c.stats?.[k] ?? 0;

/**
 * Worth of a job for a character (만원 per salary tile, roughly): current rank salary + the odds of reaching the
 * next two ranks with its rank-up stat, minus injury risk. Hidden jobs included (their ranks pay more).
 */
export function jobScore(ctx, c, def, { rank = 1, stats = c.stats } = {}) {
  if (!def?.ranks?.length) return 0;
  const sal = def.ranks.map((r) => r.salary);
  const i = clamp(rank - 1, 0, sal.length - 1);
  const now = sal[i];
  const next = sal[i + 1] ?? now;
  const next2 = sal[i + 2] ?? next;
  const cfg = ctx.data.balance.jobs ?? {};
  const ru = def.rankUp;
  const p = ru
    ? clamp(
        ru.base + ru.perStat * (stats?.[ru.stat] ?? 0) + (cfg.luckBonus ?? 0) * (stats?.luck ?? 0) + (cfg.educationBonus?.[c.education] ?? 0),
        cfg.minChance ?? 0.05,
        cfg.maxChance ?? 0.9,
      )
    : 0;
  const v = now + p * (next - now) + p * p * 0.7 * (next2 - next);
  return v * (1 - 1.5 * (def.injuryRisk ?? 0));
}

/** Stat points still missing for a job's requirements (news applied) + 1 per missing degree level. */
export function jobDeficit(ctx, c, def) {
  const req = jobRequirements(def, effectsFor(ctx, c));
  let d = 0;
  for (const [k, v] of Object.entries(req)) d += Math.max(0, v - statOf(c, k));
  const edu = def.requires?.education;
  const rank = { none: 0, college: 1, elite: 2 };
  const enrolled = rank[c.school?.tier] ?? 0; // graduates later with that degree
  if (edu && Math.max(rank[c.education] ?? 0, enrolled) < (rank[edu] ?? 0)) d += c.careerDone ? 99 : statOf(c, 'int') >= 6 ? 1 : 3;
  return d;
}

/** The regular job a character should aim for: best score, discounted by how far its requirements are. */
export function targetJob(ctx, c) {
  let best = null;
  for (const def of regularJobs(ctx.data)) {
    const d = jobDeficit(ctx, c, def);
    if (d >= 99) continue;
    const req = jobRequirements(def, effectsFor(ctx, c));
    const stats = { ...c.stats };
    for (const [k, v] of Object.entries(req)) stats[k] = Math.max(stats[k] ?? 0, v);
    const s = jobScore(ctx, c, def, { stats }) / (1 + 0.35 * d);
    if (!best || s > best.score) best = { def, score: s, deficit: d };
  }
  return best?.def ?? null;
}

/** The stat that matters most to a character now (current job's rank-up stat, else its target job). */
function keyStat(ctx, c) {
  const cur = c.job && c.job.id !== PART_TIME_ID ? jobDef(ctx.data, c.job.id) : null;
  if (cur?.rankUp?.stat) return cur.rankUp.stat;
  return targetJob(ctx, c)?.rankUp?.stat ?? 'int';
}

/** Is +1 of `stat` useful to this character (job rank-up stat, a missing requirement, 수능 지력)? */
function statUseful(ctx, c, stat) {
  if (statOf(c, stat) >= statCap(ctx.data)) return false;
  if (keyStat(ctx, c) === stat) return true;
  const t = targetJob(ctx, c);
  if (t && !c.job) {
    const req = jobRequirements(t, effectsFor(ctx, c));
    if ((req[stat] ?? 0) > statOf(c, stat)) return true;
  }
  return stat === 'int' && !c.careerDone && c.examResult == null;
}

/** Final-ranking totals by character id (whatever `computeRanking` counts: cash − debt + items + later assets). */
function totals(room, data) {
  try {
    return new Map(computeRanking(room, { data }).map((r) => [r.charId, r.total]));
  } catch {
    return new Map(room.characters.map((c) => [c.id, (c.money ?? 0) - (c.debt ?? 0)]));
  }
}

/** Value (만원) of a card to a character — shop price, adjusted for cards it cannot use / negative-EV lotto. */
export function cardValue(data, c, cardId) {
  const def = cardDef(data, cardId);
  if (!def) return 0;
  if (def.jobOnly) return c.job?.id === def.jobOnly ? def.price * 1.5 : def.price * 0.1;
  if (def.id === 'lotto') return def.price * 0.45; // EV 8.93 < 20
  return def.price ?? 0;
}

// ---------- prompt answers ----------

const enabled = (p) => p.options.filter((o) => !o.disabled);

/** `id` when it is an enabled option of the prompt, else the default (if enabled), else the first enabled one. */
function safeOption(p, id) {
  const ok = enabled(p);
  if (id && ok.some((o) => o.id === id)) return id;
  if (ok.some((o) => o.id === p.defaultOptionId)) return p.defaultOptionId;
  return ok[0]?.id ?? p.defaultOptionId;
}

const byMax = (list, f) => list.reduce((best, x) => (best == null || f(x) > f(best) ? x : best), null);

const ROUTES = ['love', 'career', 'money'];

/**
 * 갈림길: charm / a partner / a family → love (소개팅, dates → 프러포즈 → 맞벌이, births → 용돈), a well-paid job / int →
 * career (salary + job tiles), cash / luck → money (money tiles × 1.8, houses, treasures) — plus the personality bias
 * (cautious career, bold money). Cash counts RELATIVE to the room's average (rich rooms are not all money rooms).
 */
function answerRoute(ctx, c, p) {
  const k = knobs(c, ctx.room);
  const regular = c.job && c.job.id !== PART_TIME_ID;
  const P = ctx.data.partners ?? {};
  const proposeAt = P.affection?.proposeAt ?? 60;
  const maxKids = P.children?.max ?? 4;
  const others = ctx.room.characters.filter((x) => !x.finished || x.id === c.id);
  const avgCash = others.reduce((a, x) => a + Math.max(0, x.money ?? 0), 0) / Math.max(1, others.length);
  const relCash = Math.max(0, c.money ?? 0) / Math.max(50, avgCash);
  const charm = statOf(c, 'charm');
  const partner = !c.spouse && c.love?.partner;
  let family = 0;
  if (c.spouse) family = (c.children?.length ?? 0) < maxKids ? 1.5 : 0.5; // births (용돈 later) / outings
  else if (partner) family = 1.5 + Math.min(1, (c.love?.affection ?? 0) / proposeAt); // dates → 프러포즈 → 맞벌이
  else family = 1.5 + (charm >= 6 ? 1 : 0); // 소개팅: a partner right away
  const scores = {
    love: charm * 0.4 + family,
    career: 1.5 + (regular ? Math.min(3, salaryAmount(ctx, c) / 150) : 0) + statOf(c, 'int') * 0.2,
    money: Math.min(3, relCash * 1.5) + statOf(c, 'luck') * 0.2 + (c.house ? 0 : 1),
  };
  for (const [r, b] of Object.entries(k.routeBias)) scores[r] += b;
  const opts = enabled(p).filter((o) => ROUTES.includes(o.id));
  return byMax(opts, (o) => scores[o.id])?.id;
}

function answerHabit(ctx, c, p) {
  const opts = enabled(p);
  const withStat = opts.filter((o) => o.stat);
  if (!withStat.length) return null;
  const t = targetJob(ctx, c);
  const cap = statCap(ctx.data);
  let want = null;
  if (t) {
    const req = jobRequirements(t, effectsFor(ctx, c));
    const gaps = Object.entries(req).map(([k, v]) => [k, v - statOf(c, k)]).filter(([, g]) => g > 0);
    if (gaps.length) want = gaps.sort((a, b) => b[1] - a[1])[0][0];
    else if (t.requires?.education && statOf(c, 'int') < 7) want = 'int';
    else if (t.rankUp?.stat && statOf(c, t.rankUp.stat) < cap) want = t.rankUp.stat;
  }
  if (!want || statOf(c, want) >= cap) want = [...STAT_KEYS].sort((a, b) => statOf(c, a) - statOf(c, b))[0];
  return (withStat.find((o) => o.stat === want) ?? withStat[0]).id;
}

function answerExam(ctx, c, p) {
  const eff = effectsFor(ctx, c);
  const retake = !!p.context?.retake;
  const score = (choice) => {
    const ch = examChances(c, choice, ctx.data, { examBonus: eff.examBonus, retake });
    return ch.college + ch.elite * 0.5;
  };
  return score('guess') > score('study') ? 'guess' : 'study';
}

function answerCareer(ctx, c, p) {
  const ids = enabled(p).map((o) => o.id);
  if (ids.includes('college')) return 'college';
  if (ids.includes('retake')) {
    const eff = effectsFor(ctx, c);
    const best = Math.max(...['study', 'guess'].map((ch) => examChances(c, ch, ctx.data, { examBonus: eff.examBonus, retake: true }).college));
    if (best >= knobs(c, ctx.room).retake) return 'retake';
  }
  return 'job';
}

function answerMilitary(ctx, c, p) {
  const ids = enabled(p).map((o) => o.id);
  const strJob = keyStat(ctx, c) === 'str';
  if (ids.includes('later')) return strJob ? 'now' : 'later'; // 전역 체력 +2 before the job offer helps str jobs
  if (ids.includes('volunteer')) return strJob || cpuPersonality(c, ctx.room) === 'bold' ? 'volunteer' : 'skip';
  return null;
}

function answerJobOffer(ctx, c, p) {
  const opts = enabled(p).filter((o) => jobDef(ctx.data, o.jobId ?? o.id));
  return byMax(opts, (o) => jobScore(ctx, c, jobDef(ctx.data, o.jobId ?? o.id)))?.id;
}

function answerJobTile(ctx, c, p) {
  const k = knobs(c, ctx.room);
  const ids = new Set(enabled(p).map((o) => o.id));
  const cur = jobDef(ctx.data, c.job?.id);
  const change = enabled(p).find((o) => o.id === 'change' && o.jobId);
  if (change && cur) {
    const nd = jobDef(ctx.data, change.jobId);
    const curScore = c.job.id === PART_TIME_ID ? 0 : jobScore(ctx, c, cur, { rank: c.job.rank });
    if (nd && jobScore(ctx, c, nd) > curScore * 1.15) return 'change';
  }
  if (ids.has('promotion') && !(c.job?.injured > 0)) {
    const chance = rankUpChance(ctx, c, { exam: true });
    if (chance >= k.promotion) return 'promotion';
  }
  if (ids.has('bonus')) {
    const b = ctx.data.balance.jobs.maxRankBonus ?? { chance: 0.5, luck: 0, salaryShare: 1 };
    const share = ctx.data.balance.jobs.overtime?.salaryShare ?? 0.6;
    const ev = clamp(b.chance + b.luck * statOf(c, 'luck'), 0, 0.95) * (b.salaryShare ?? 1);
    if (ev >= share || cpuPersonality(c, ctx.room) === 'bold') return 'bonus';
  }
  if (ids.has('overtime')) return 'overtime';
  return null;
}

/** Expected worth of a shop offer to the character (compared with its price). */
function shopWorth(ctx, c, o, leaderGap) {
  if (o.itemId) {
    const def = itemDef(ctx.data, o.itemId);
    if (!def) return 0;
    let v = def.price * (def.resale ?? 0);
    for (const st of Object.keys(def.stats ?? {})) v += statUseful(ctx, c, st) ? 90 : 15;
    const e = def.effect ?? {};
    if (e.salaryBonus && (!e.jobs || e.jobs.includes(c.job?.id))) v += e.salaryBonus * salaryAmount(ctx, c) * 5;
    return v;
  }
  const def = cardDef(ctx.data, o.cardId);
  if (!def) return 0;
  switch (def.id) {
    case 'bonus':
      return c.job ? salaryAmount(ctx, c) : 20;
    case 'study':
      return statUseful(ctx, c, 'int') ? 80 : 20;
    case 'insider':
      return statUseful(ctx, c, 'charm') ? 80 : 20;
    case 'lawyer':
      return leaderGap >= 0 ? 70 : 20;
    case 'pledge':
      return c.job?.id === def.jobOnly ? 150 : 0;
    case 'insurance':
    case 'amulet':
      return 40;
    case 'tax_audit':
    case 'cut_line':
    case 'noise':
    case 'complaint':
    case 'gossip':
      return leaderGap < 0 ? 45 : 15;
    default:
      return 10; // lotto (EV < price), coupon, energy, taxi
  }
}

function answerShop(ctx, c, p) {
  const k = knobs(c, ctx.room);
  const tot = totals(ctx.room, ctx.data);
  const mine = tot.get(c.id) ?? 0;
  const rival = Math.max(...ctx.room.characters.filter((x) => x.id !== c.id).map((x) => tot.get(x.id) ?? 0), -Infinity);
  const leaderGap = mine - rival;
  const cash = c.money ?? 0;
  const buys = enabled(p)
    .filter((o) => typeof o.price === 'number' && (o.cardId || o.itemId))
    .filter((o) => cash - o.price >= k.reserve)
    .map((o) => ({ o, gain: shopWorth(ctx, c, o, leaderGap) * k.shopMult - o.price }))
    .filter((x) => x.gain > 0);
  const best = byMax(buys, (x) => x.gain);
  return best ? best.o.id : enabled(p).find((o) => o.id === 'leave')?.id ?? null;
}

function answerHoliday(ctx, c, p) {
  const opts = enabled(p);
  const stake = (id) => opts.find((o) => o.id === id)?.stake ?? Infinity;
  const cash = c.money ?? 0;
  const style = knobs(c, ctx.room).stake;
  const has = (id) => opts.some((o) => o.id === id);
  if (style === 'high') {
    if (has('big') && cash >= 8 * stake('big')) return 'big';
    if (has('small') && cash >= 4 * stake('small')) return 'small';
  } else if (style === 'mid') {
    if (has('big') && cash >= 20 * stake('big')) return 'big';
    if (has('small') && cash >= 8 * stake('small')) return 'small';
  } else if (has('small') && cash >= 15 * stake('small')) return 'small';
  return has('pass') ? 'pass' : null;
}

// Stage 8 kinds (romance / family / real estate): read the machine-readable option fields when present
// (feature-detected, so older / newer option shapes fall back to the prompt default).
const hasField = (o, f) => o[f] !== undefined && o[f] !== null;
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const priceOf = (o) => num(o.cost ?? o.price);

function affordable(ctx, c, o, reserveShare = 0.5) {
  if (!hasField(o, 'price') && !hasField(o, 'cost')) return true;
  return (c.money ?? 0) - priceOf(o) >= knobs(c, ctx.room).reserve * reserveShare;
}

/** 만남: the best candidate (★, 맞벌이 월급, 찰떡궁합) — a CPU never passes on love. */
function answerMeet(ctx, c, p) {
  const people = enabled(p).filter((o) => hasField(o, 'partnerId') || hasField(o, 'stars'));
  if (!people.length) return null;
  const rng = subRng(ctx.room, c, 'meet');
  return byMax(people, (o) => num(o.stars) + num(o.salary) / 100 + (o.match ? 1.5 : 0) + rng.next() * 0.01)?.id;
}

/** 데이트: most affection for the money (호감도 gain − cost), within the reserve; else the cheapest. */
function answerDate(ctx, c, p) {
  const opts = enabled(p);
  const ok = opts.filter((o) => affordable(ctx, c, o));
  const scored = (ok.length ? ok : opts).map((o) => ({ o, s: num(o.gain) + num(o.chance) * 50 - priceOf(o) * 0.3 }));
  return byMax(scored, (x) => x.s)?.o.id ?? null;
}

/** 프러포즈: when the success chance clears the personality threshold, else the safer option (lowest chance). */
function answerPropose(ctx, c, p) {
  const opts = enabled(p);
  const chancy = opts.filter((o) => hasField(o, 'chance'));
  const best = byMax(chancy.filter((o) => num(o.chance) > 0 && affordable(ctx, c, o)), (o) => num(o.chance));
  if (best && num(best.chance) >= knobs(c, ctx.room).propose) return best.id;
  const safe = opts.filter((o) => o !== best);
  return (byMax(safe, (o) => -num(o.chance)) ?? null)?.id ?? null;
}

/**
 * 부동산: buy / swap to the listing that adds the most to the final total — value − cash cost − the current house
 * (trade-in) + the expected 노년 시세 gain (+15 % of the value difference until the market is drawn) — keeping a
 * cash reserve; else pass.
 */
function answerHouse(ctx, c, p) {
  const k = knobs(c, ctx.room);
  const opts = enabled(p);
  const drift = ctx.room.housingMarket ? 0 : 0.15;
  const cur = c.house?.value ?? 0;
  const houses = opts
    .filter((o) => hasField(o, 'houseId') && hasField(o, 'price'))
    .map((o) => {
      const value = num(o.value, num(o.price));
      const cost = hasField(o, 'cost') ? num(o.cost) : num(o.price) - num(o.tradeIn);
      return { o, cost, gain: value - cost - cur + drift * (value - cur) };
    })
    .filter((x) => x.gain > 0 && (c.money ?? 0) - x.cost >= k.reserve * 0.5);
  if (houses.length) return byMax(houses, (x) => x.gain).o.id;
  return opts.find((o) => !hasField(o, 'houseId'))?.id ?? null;
}

// Stage 9 submaps: skipping a spin costs roughly one landing (never near the goal); bold CPUs gamble more.

/** Rough worth (만원) of one landing for a character — what a skipped spin gives up. */
function spinWorth(ctx, c) {
  try {
    return Math.max(40, expectedLanding(ctx, c, 'plain'));
  } catch {
    return 60;
  }
}

/** 고향: rest (skip a spin, 체력 + a bigger 용돈) only when 체력 helps and the goal is far; else a visit. */
function answerHometown(ctx, c, p) {
  const opts = enabled(p);
  const rest = opts.find((o) => o.id === 'rest');
  const visit = opts.find((o) => o.id === 'visit');
  if (!rest || !visit) return null;
  if (cpuPersonality(c, ctx.room) === 'bold' || stepsToGoal(ctx.room, c) <= 12) return 'visit';
  const statGain = (o) => Object.entries(o.stats ?? {}).reduce((s, [k, v]) => s + (v > 0 ? (statUseful(ctx, c, k) ? 60 : 15) * v : 0), 0);
  const restScore = num(rest.money) + statGain(rest) - spinWorth(ctx, c) * num(rest.skipTurns, 1);
  const visitScore = num(visit.money) + statGain(visit);
  return restScore > visitScore ? 'rest' : 'visit';
}

/**
 * 사찰: a wish when the CPU is on its way to 산신령 (a wish already granted) or the odds are good for a bold one;
 * else training a useful stat (not near the goal, not bold); else a wish at ≥ 50 % within the reserve; else leave.
 */
function answerTemple(ctx, c, p) {
  const k = knobs(c, ctx.room);
  const opts = enabled(p);
  const wish = opts.find((o) => o.id === 'wish');
  const wishOk = wish && (c.money ?? 0) - priceOf(wish) >= k.reserve * 0.3;
  const bold = cpuPersonality(c, ctx.room) === 'bold';
  if (wishOk && ((c.wishes ?? 0) >= 1 || (bold && num(wish.chance) >= 0.4))) return 'wish';
  if (!bold && stepsToGoal(ctx.room, c) > 12) {
    const trains = opts.filter((o) => o.id.startsWith('train:') && o.stat && statUseful(ctx, c, o.stat));
    const best = byMax(trains, (o) => (o.stat === keyStat(ctx, c) ? 2 : 1) - statOf(c, o.stat) * 0.01);
    if (best) return best.id;
  }
  if (wishOk && num(wish.chance) >= 0.5) return 'wish';
  return opts.find((o) => o.id === 'leave')?.id ?? null;
}

/** 제주도: a trip within the reserve (bold: always when affordable; others when 매력 / 운 help or cash is ample). */
function answerJeju(ctx, c, p) {
  const k = knobs(c, ctx.room);
  const trip = enabled(p).find((o) => o.id === 'trip');
  if (!trip) return 'skip';
  const left = (c.money ?? 0) - priceOf(trip);
  if (cpuPersonality(c, ctx.room) === 'bold' && left >= k.reserve * 0.5) return 'trip';
  const useful = Object.keys(trip.stats ?? {}).some((st) => statUseful(ctx, c, st));
  if (left >= k.reserve * (useful ? 1 : 2)) return 'trip';
  return 'skip';
}

/**
 * 인생역전: cautious CPUs pass; normal ones buy a lotto ticket only when trailing the leader with cash to spare;
 * bold ones bet on horses — 10배 when far behind the leader (a catch-up gamble), else 2배 with ample cash, else
 * the lotto.
 */
function answerReversal(ctx, c, p) {
  const k = knobs(c, ctx.room);
  const opts = enabled(p);
  const has = (id) => opts.some((o) => o.id === id);
  const persona = cpuPersonality(c, ctx.room);
  if (persona === 'cautious') return 'skip';
  const tot = totals(ctx.room, ctx.data);
  const mine = tot.get(c.id) ?? 0;
  const leader = Math.max(...ctx.room.characters.map((x) => tot.get(x.id) ?? 0));
  const gap = leader - mine;
  const cash = c.money ?? 0;
  if (persona === 'bold') {
    const h10 = opts.find((o) => o.id === 'horse:10');
    if (h10 && gap > num(h10.stake) * 4) return 'horse:10';
    if (has('horse:2') && cash >= k.reserve * 2) return 'horse:2';
    if (has('lotto')) return 'lotto';
    return 'skip';
  }
  if (has('lotto') && gap > 0 && cash >= k.reserve) return 'lotto';
  return 'skip';
}

/** kind → (ctx, c, pending) → optionId | null (null = the prompt's default). Unknown kinds use the default. */
export const CPU_ANSWERS = {
  routeChoice: answerRoute,
  groupGift: () => null, // default (모른 척하기): gifts only move money away
  habit: answerHabit,
  exam: answerExam,
  career: answerCareer,
  military: answerMilitary,
  jobOffer: answerJobOffer,
  jobTile: answerJobTile,
  hiddenJobOffer: (ctx, c, p) => (enabled(p).some((o) => o.id === 'accept') ? 'accept' : null),
  shop: answerShop,
  holiday: answerHoliday,
  meet: answerMeet,
  date: answerDate,
  propose: answerPropose,
  house: answerHouse,
  // Stage 9 submaps
  hometown: answerHometown,
  temple: answerTemple,
  jeju: answerJeju,
  reversal: answerReversal,
};

/** The option a CPU character picks for the pending prompt (always an enabled option id). */
export function cpuAnswer(room, charId, data = gameData()) {
  const p = room.turn?.pending;
  const c = room.characters.find((x) => x.id === charId);
  if (!p || !c) return null;
  const ctx = view(room, data);
  let id = null;
  try {
    id = CPU_ANSWERS[p.kind]?.(ctx, c, p) ?? null;
  } catch {
    id = null; // a heuristic must never block the game: fall back to the default
  }
  return safeOption(p, id);
}

// ---------- trades ----------

/** Accept an offer when what the CPU receives is worth at least what it gives (× personality margin). */
export function cpuTradeAccept(room, trade, data = gameData()) {
  const to = room.characters.find((x) => x.id === trade.toId);
  if (!to) return false;
  const worth = (side, owner) => (side?.money != null ? side.money : cardValue(data, owner, side?.cardId));
  const get = worth(trade.give, to);
  let give = worth(trade.want, to);
  if (trade.want?.money != null && trade.want.money > (to.money ?? 0)) return false;
  if (trade.want?.cardUid && !to.cards?.some((k) => k.uid === trade.want.cardUid)) return false;
  // a card received into a full hand pushes out the oldest one (unless that is the card given away)
  if (trade.give?.cardId && trade.want?.cardUid == null && (to.cards?.length ?? 0) >= handLimit(data)) give += cardValue(data, to, to.cards[0].id);
  return get > 0 && get >= give * knobs(to, room).tradeMargin;
}

// ---------- cards & spin ----------

/** Rough worth of landing on a tile (for the energy / taxi decision). */
function tileWorth(ctx, c, tile) {
  if (!tile) return 0;
  switch (tile.type) {
    case 'salary':
      return c.military?.status === 'serving' ? 30 : salaryAmount(ctx, c);
    case 'money':
      return tile.amount ?? 50;
    case 'loss':
      return -(tile.amount ?? 50);
    case 'job':
      return c.job ? 60 : 10;
    case 'card':
      return 40;
    case 'treasure': // Stage 9: an average appraisal (hidden)
      return 120;
    case 'hometown':
    case 'temple':
      return 30;
    case 'goal':
      return 150;
    case 'event':
    case 'habit':
      return 20;
    default:
      return 10;
  }
}

/** Expected tile worth of the next spin (`kind`: plain | plus2 | max2), stops / goal halt the walk. */
function expectedLanding(ctx, c, kind) {
  const board = ctx.room.board;
  const { min, max } = ctx.data.balance.spin;
  const serving = c.military?.status === 'serving';
  const landing = (move) => {
    const steps = serving ? Math.max(1, Math.ceil(move / 2)) : move;
    let pos = c.position;
    for (let s = 0; s < steps; s++) {
      const np = nextPosition(board, pos, c.route);
      if (!np) break;
      pos = np;
      const t = tileAt(board, pos);
      if (t?.type === 'stop' || t?.type === 'goal') break;
    }
    return tileWorth(ctx, c, tileAt(board, pos));
  };
  const vals = [];
  for (let v = min; v <= max; v++) vals.push(v);
  if (kind === 'max2') {
    let sum = 0;
    for (const a of vals) for (const b of vals) sum += landing(Math.max(a, b));
    return sum / (vals.length * vals.length);
  }
  const add = kind === 'plus2' ? 2 : 0;
  return vals.reduce((s, v) => s + landing(v + add), 0) / vals.length;
}

/** Tiles left to the goal (following the chosen / default route). */
function stepsToGoal(room, c) {
  let pos = c.position;
  let n = 0;
  for (; n < 200; n++) {
    const np = nextPosition(room.board, pos, c.route);
    if (!np) break;
    pos = np;
  }
  return n;
}

/** Other unfinished characters `c` may sabotage now (engine rule: not the same target this or last round). */
export function sabotageTargets(room, c) {
  const round = room.turn?.round ?? 0;
  return room.characters.filter((t) => t.id !== c.id && !t.finished && !((t.lastTargetedBy?.[c.id] ?? -Infinity) >= round - 1));
}

/**
 * The card a CPU plays before its spin (or null): 공약 when it has the job, a sabotage against the richest rival
 * (no lawyer card in hand, not targeted by anyone this / last round) when that rival is ahead, a stat card for a
 * stat that matters, energy / taxi when the expected landing improves or the goal is near. A full hand plays its
 * best card anyway.
 */
export function cpuCardAction(room, charId, data = gameData()) {
  const t = room.turn;
  const c = room.characters.find((x) => x.id === charId);
  if (!c || !t || t.cardUsed || t.phase !== 'awaitSpin' || t.pending) return null;
  if (t.order?.[t.currentIndex] !== c.id) return null;
  const ctx = view(room, data);
  const hand = (c.cards ?? []).map((k) => ({ k, def: cardDef(data, k.id) })).filter((x) => x.def && x.def.kind !== 'passive' && (!x.def.jobOnly || c.job?.id === x.def.jobOnly));
  if (!hand.length) return null;
  const full = (c.cards?.length ?? 0) >= handLimit(data) - 1;
  const use = (x, targetId) => ({ type: 'useCard', characterId: c.id, cardUid: x.k.uid, ...(targetId ? { targetId } : {}) });
  const find = (id) => hand.find((x) => x.def.id === id);

  const pledge = find('pledge');
  if (pledge) return use(pledge);

  const sabotage = hand.filter((x) => x.def.kind === 'sabotage');
  if (sabotage.length) {
    const tot = totals(room, data);
    const round = t.round ?? 0;
    const fresh = (x) => !Object.values(x.lastTargetedBy ?? {}).some((r) => r >= round - 1);
    const targets = sabotageTargets(room, c)
      .filter((x) => !x.cards?.some((k) => k.id === 'lawyer') && fresh(x))
      .sort((a, b) => (tot.get(b.id) ?? 0) - (tot.get(a.id) ?? 0) || (a.seq ?? 0) - (b.seq ?? 0));
    const target = targets[0];
    const mine = tot.get(c.id) ?? 0;
    if (target && ((tot.get(target.id) ?? 0) >= mine * knobs(c, room).sabotage || full)) {
      const pick =
        (target.money >= 300 && find('tax_audit')) ||
        (target.job && find('complaint')) ||
        find('cut_line') ||
        find('noise') ||
        (keyStat(ctx, target) === 'charm' && find('gossip')) ||
        (full ? sabotage.find((x) => x.def.id !== 'tax_audit' || target.money >= 50) : null);
      if (pick) return use(pick, target.id);
    }
  }

  for (const x of hand) {
    const st = Object.keys(x.def.effect?.stats ?? {}).find((k) => x.def.effect.stats[k] > 0);
    if (x.def.kind === 'instant' && st && (statUseful(ctx, c, st) || (full && statOf(c, st) < statCap(data)))) return use(x);
  }

  const near = stepsToGoal(room, c) <= 12;
  const base = expectedLanding(ctx, c, 'plain');
  for (const [id, kind] of [['taxi', 'max2'], ['energy', 'plus2']]) {
    const x = find(id);
    if (!x) continue;
    if (near || full || expectedLanding(ctx, c, kind) - base >= 25) return use(x);
  }
  return null;
}

// ---------- the next action ----------

const unanswered = (p, id) => p.forCharacterIds.includes(id) && !Object.hasOwn(p.answers ?? {}, id);

/**
 * The next action of CPU-policy character `charId` (the caller decides who plays by this policy — the runner
 * only asks for `ownerSessionId === 'cpu'`): answer an offer made to it, answer the pending prompt, or play a
 * card / spin on its turn. Never bets, never offers trades, never gifts.
 * @returns {object|null} an engine action without `actor`
 */
export function cpuDecide(room, charId, data = gameData()) {
  if (room?.status !== 'playing' || !room.turn) return null;
  const c = room.characters.find((x) => x.id === charId);
  if (!c) return null;
  const trade = (room.trades ?? []).find((x) => x.toId === c.id);
  if (trade) return { type: 'respondTrade', characterId: c.id, tradeId: trade.id, accept: cpuTradeAccept(room, trade, data) };
  const p = room.turn.pending;
  if (p) {
    if (!unanswered(p, c.id)) return null;
    return { type: 'choose', characterId: c.id, promptId: p.promptId, optionId: cpuAnswer(room, c.id, data) };
  }
  if (room.turn.phase !== 'awaitSpin' || room.turn.order?.[room.turn.currentIndex] !== c.id || c.finished) return null;
  return cpuCardAction(room, c.id, data) ?? { type: 'spin', characterId: c.id };
}

/**
 * What the room waits on from a CPU (for the runner's timer): `{kind: 'trade'|'prompt'|'spin', charId, key}` or
 * null. Offers to a CPU first, then the pending prompt's first unanswered CPU, then a CPU's spin. The key
 * changes whenever the awaited step changes (a card played before the spin → a new key).
 */
export function cpuDue(room, { isCpuChar = isCpu } = {}) {
  if (room?.status !== 'playing' || !room.turn) return null;
  const byId = new Map(room.characters.map((c) => [c.id, c]));
  const trade = (room.trades ?? []).find((t) => isCpuChar(byId.get(t.toId)));
  if (trade) return { kind: 'trade', charId: trade.toId, key: `t:${trade.id}` };
  const t = room.turn;
  const p = t.pending;
  if (p) {
    const id = p.forCharacterIds.find((x) => unanswered(p, x) && isCpuChar(byId.get(x)));
    return id ? { kind: 'prompt', charId: id, key: `p:${p.promptId}:${id}` } : null;
  }
  const cur = byId.get(t.order?.[t.currentIndex]);
  if (t.phase === 'awaitSpin' && isCpuChar(cur) && !cur.finished) return { kind: 'spin', charId: cur.id, key: `s:${t.turnNo}:${t.cardUsed ? 1 : 0}` };
  return null;
}

/** `cpuDue` + `cpuDecide` in one call (headless games): `{charId, kind, action}` | null. */
export function cpuNextAction(room, data = gameData(), opts = {}) {
  const due = cpuDue(room, opts);
  if (!due) return null;
  const action = cpuDecide(room, due.charId, data);
  return action ? { ...due, action } : null;
}
