// Stage 9 — special awards (awards.json, bonus money) and ending titles (titles.json, no money). Pure; computed
// once when the game is over (result.js), after the treasure appraisal.
//
// Award: {id, name, icon, desc, metric, route?, min, bonus, tie: all|split|place|qualify}. The metric registry
// below turns a character into a number; the best value ≥ min wins (qualify: everyone ≥ min). Ties: all = every
// tied character gets the full bonus, split = the bonus is shared (floor), place = the earliest goal arrival
// (then creation order) wins alone.
// Title: {id, name, icon, desc, priority, when?, fallback?}; `when` = {fact, min?, max?, eq?} | {all: [...]} |
// {any: [...]} | {not: cond} over `titleFacts`. Each character gets up to `perCharacter` titles by priority, the
// fallback title when none applies.
import { STAT_KEYS, netWorth } from './effects.js';
import { treasureValue } from './treasures.js';
import { houseValue } from './houses.js';
import { itemsValue } from './cards.js';
import { ADULT_ERAS } from './highlights.js';

const ROUTE_ERAS = ['young', 'middle_age'];

export const awardDefs = (data) => data.awards?.awards ?? [];
export const titleDefs = (data) => data.titles?.titles ?? [];

function jobDefOf(data, id) {
  if (!id) return null;
  if (id === data?.jobs?.partTime?.id) return data.jobs.partTime;
  return data?.jobs?.jobs?.find((j) => j.id === id) ?? null;
}

/** Career score: best job held (hidden jobs +100), rank × 10, +5 at its top rank; 알바 = 0. */
export function careerScore(data, c) {
  const held = [...(c.jobHistory ?? [])];
  if (c.job && !held.some((h) => h.id === c.job.id)) held.push({ id: c.job.id, rank: c.job.rank });
  let best = 0;
  for (const h of held) {
    const def = jobDefOf(data, h.id);
    if (!def || h.id === data?.jobs?.partTime?.id) continue;
    const rank = Math.max(h.rank ?? 1, c.job?.id === h.id ? c.job.rank : 0);
    const s = (def.hidden ? 100 : 0) + rank * 10 + (rank >= (def.ranks?.length ?? 1) ? 5 : 0);
    best = Math.max(best, s);
  }
  return best;
}

/** Did the character complete `route` in both route eras (young and middle_age)? */
export function routeMedal(c, route) {
  const done = (era) => (c.routeHistory ?? []).some((h) => h.era === era && h.route === route && h.completed);
  return ROUTE_ERAS.every(done);
}

/** Experienced areas (0..3): love (love route or married), career (career route or a promotion), money (money route, a house or a treasure). */
export function routesExperienced(c) {
  const took = (r) => (c.routeHistory ?? []).some((h) => h.route === r);
  const love = took('love') || !!c.spouse;
  const career = took('career') || (c.job?.rank ?? 1) >= 2 || (c.jobHistory ?? []).some((h) => (h.rank ?? 1) >= 2);
  const money = took('money') || !!c.house || (c.treasures?.length ?? 0) > 0;
  return (love ? 1 : 0) + (career ? 1 : 0) + (money ? 1 : 0);
}

/** metric → (ctx, c) → number. ctx = {room, data}. */
export const AWARD_METRICS = {
  children: (ctx, c) => c.children?.length ?? 0,
  geniusChildren: (ctx, c) => (c.children ?? []).filter((k) => k.talent === 'genius').length,
  careerScore: (ctx, c) => careerScore(ctx.data, c),
  treasureValue: (ctx, c) => treasureValue(ctx.room, c),
  houseValue: (ctx, c) => houseValue(c),
  routeMedal: (ctx, c, def) => (routeMedal(c, def.route) ? 1 : 0),
  allRoutes: (ctx, c) => routesExperienced(c),
  luckWinnings: (ctx, c) => c.record?.luckWin ?? 0,
};

/** Tie-break: earlier goal arrival (the final race), then more assets (net worth + house + items), then creation order. */
const assets = (data, c) => netWorth(c) + houseValue(c) + itemsValue(data, c);

/**
 * Compute the special awards of a finished game.
 * @returns {{id, name, icon, desc, charIds, bonus, value}[]} (only awards someone won; `bonus` = per winner)
 */
export function computeAwards(room, data) {
  const ctx = { room, data };
  const byPlace = (a, b) => (a.place ?? 99) - (b.place ?? 99) || assets(data, b) - assets(data, a) || (a.seq ?? 0) - (b.seq ?? 0);
  const out = [];
  for (const def of awardDefs(data)) {
    const metric = AWARD_METRICS[def.metric];
    if (!metric) continue;
    const rows = room.characters.map((c) => ({ c, v: metric(ctx, c, def) })).filter((r) => r.v >= (def.min ?? 1) && r.v > 0);
    if (!rows.length) continue;
    let winners;
    let bonus = def.bonus ?? 0;
    let value;
    if (def.tie === 'qualify') {
      winners = rows.map((r) => r.c).sort(byPlace);
      value = Math.max(...rows.map((r) => r.v));
    } else {
      value = Math.max(...rows.map((r) => r.v));
      const top = rows.filter((r) => r.v === value).map((r) => r.c).sort(byPlace);
      if (def.tie === 'place') winners = top.slice(0, 1);
      else winners = top;
      if (def.tie === 'split' && winners.length > 1) bonus = Math.floor(bonus / winners.length);
    }
    out.push({ id: def.id, name: def.name, icon: def.icon ?? '', desc: def.desc ?? '', charIds: winners.map((c) => c.id), bonus, value });
  }
  return out;
}

/** {charId: Σ award bonus} */
export function awardBonusByChar(awards) {
  const out = {};
  for (const a of awards) for (const id of a.charIds) out[id] = (out[id] ?? 0) + a.bonus;
  return out;
}

// ---------- titles ----------

/**
 * Facts about one character at game end (titles.json conditions). `ranking` = the final ranking rows.
 */
export function titleFacts(room, c, { data, ranking = [] } = {}) {
  const n = room.characters.length;
  const row = ranking.find((r) => r.charId === c.id);
  const rec = c.record ?? {};
  const stats = STAT_KEYS.map((k) => c.stats?.[k] ?? 0);
  const held = new Set((c.jobHistory ?? []).map((h) => h.id));
  if (c.job) held.add(c.job.id);
  const hidden = [...held].some((id) => jobDefOf(data, id)?.hidden);
  // goal order facts only exist with a goal race (kids mode: place = final rank → no 급행열차 / 거북이 titles)
  const goalRace = !!room.board?.eras?.at(-1)?.final || !room.board?.eras?.at(-1)?.loop;
  const place = goalRace ? c.place ?? null : null;
  const lastPlace = place != null && place === n && c.retired !== 'bust';
  return {
    characters: n,
    finalRank: row?.rank ?? null,
    rankPct: row && n > 1 ? (row.rank - 1) / (n - 1) : 0,
    total: row?.total ?? netWorth(c),
    place,
    lastPlace: lastPlace ? 1 : 0,
    retired: c.retired === 'early' ? 1 : 0,
    bust: c.retired === 'bust' ? 1 : 0,
    worstRankPct: rec.worstRankPct ?? 0,
    minNet: rec.minNet ?? netWorth(c),
    maxDebt: rec.maxDebt ?? 0,
    bankruptcies: rec.bankruptcies ?? 0,
    married: c.spouse ? 1 : 0,
    children: c.children?.length ?? 0,
    geniusChildren: (c.children ?? []).filter((k) => k.talent === 'genius').length,
    proposeFails: rec.proposeFails ?? 0,
    partners: rec.partners ?? 0,
    houseValue: houseValue(c),
    houseSwaps: c.houseSwaps ?? 0,
    treasures: c.treasures?.length ?? 0,
    treasureValue: treasureValue(room, c),
    fakes: (c.treasures ?? []).filter((t) => room.treasureFakes?.[t.uid]).length,
    luckWinnings: rec.luckWin ?? 0,
    gambles: rec.gambles ?? 0,
    job: c.job?.id ?? null,
    jobRank: c.job?.rank ?? 0,
    jobChanges: c.jobHistory?.length ?? 0,
    hiddenJob: hidden ? 1 : 0,
    rankUps: rec.rankUps ?? 0,
    overtime: rec.overtime ?? 0,
    sabotage: rec.sabotage ?? 0,
    sabotaged: rec.sabotaged ?? 0,
    ...Object.fromEntries(STAT_KEYS.map((k, i) => [k, stats[i]])),
    statMin: Math.min(...stats),
    statSum: stats.reduce((a, b) => a + b, 0),
    education: c.education ?? 'none',
    hometown: rec.submaps?.hometown ?? 0,
    temple: rec.submaps?.temple ?? 0,
    jeju: rec.submaps?.jeju ?? 0,
    wishes: c.wishes ?? 0,
    adultLife: ADULT_ERAS.includes(c.era) ? 1 : 0,
  };
}

/** Evaluate a titles.json condition against facts (a missing / null fact fails its test). */
export function conditionMet(cond, facts) {
  if (!cond) return true;
  if (Array.isArray(cond.all)) return cond.all.every((x) => conditionMet(x, facts));
  if (Array.isArray(cond.any)) return cond.any.some((x) => conditionMet(x, facts));
  if (cond.not) return !conditionMet(cond.not, facts);
  const v = facts[cond.fact];
  if (v == null) return false;
  if (cond.eq !== undefined && v !== cond.eq) return false;
  if (cond.min !== undefined && !(v >= cond.min)) return false;
  if (cond.max !== undefined && !(v <= cond.max)) return false;
  return true;
}

/** {charId: [titleId]} — up to `perCharacter` titles per character (priority order), else the fallback. */
export function computeTitles(room, data, { ranking = [] } = {}) {
  const defs = [...titleDefs(data)].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  const per = data.titles?.perCharacter ?? 2;
  const fallback = defs.find((d) => d.fallback);
  const out = {};
  for (const c of room.characters) {
    const facts = titleFacts(room, c, { data, ranking });
    const got = defs.filter((d) => !d.fallback && d.when && conditionMet(d.when, facts)).slice(0, per).map((d) => d.id);
    out[c.id] = got.length ? got : fallback ? [fallback.id] : [];
  }
  return out;
}
