// 룰렛 실력 모드 (pure, isomorphic: no imports — the server re-exports it from server/game/roulette.js, the
// client imports it as /js/shared/roulette.js). Room config `rouletteMode: 'random' | 'skill'`. In skill mode the spinning player aims at a
// target number t (shake strength or a timing gauge on the client) and the server lands near it.
// 「빠를수록 위험」 (user decision): the miss grows with the target — `balance.roulette.skill.jitterByTarget` = {"<t>" or
// "<a>-<b>": {"<|offset|>": share}} per target (small numbers are precise, 9 / 10 can miss by 3–4); a target without an
// entry uses `skill.jitter` (default 0: 50 %, 1: 40 %, 2: 10 %). Each non-zero share is split evenly between −offset and
// +offset, reflected at the edges (0 → 2, 11 → 9, 12 → 8 …): aiming 10 never goes past 10, it falls short instead.
// The engine draws ONE `rng.next()` per skill spin (seeded, deterministic).

export const ROULETTE_MODES = ['random', 'skill'];
/** How the target was chosen (shown to everyone; 'cpu' = CPU heuristics). */
export const ROULETTE_INPUTS = ['shake', 'gauge', 'cpu'];
export const DEFAULT_JITTER = Object.freeze({ 0: 0.5, 1: 0.4, 2: 0.1 });

export const isSkillRoom = (room) => room?.config?.rouletteMode === 'skill';

/** A target number within [min, max], or null (missing / not an integer / out of range → a random spin). */
export function parseTarget(x, { min = 1, max = 10 } = {}) {
  const n = typeof x === 'string' && /^\d{1,2}$/.test(x.trim()) ? Number(x.trim()) : x;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** Mirror a value into [min, max] (min − 1 → min + 1, max + 1 → max − 1). */
export function reflect(v, min, max) {
  if (max <= min) return min;
  let x = v;
  for (let i = 0; i < 8 && (x < min || x > max); i++) x = x < min ? 2 * min - x : 2 * max - x;
  return Math.max(min, Math.min(max, x));
}

/** A usable jitter table (an object with at least one positive share)? */
const validJitter = (j) => !!j && typeof j === 'object' && !Array.isArray(j) && Object.values(j).some((w) => Number(w) > 0);

/**
 * The jitter table {"<|offset|>": share} of target `t`: the `jitterByTarget` entry whose key is `t` ("7") or a range
 * holding it ("9-10"; an exact key wins), else `jitter`, else DEFAULT_JITTER.
 */
export function jitterFor(t, { jitter, jitterByTarget } = {}) {
  if (jitterByTarget && typeof jitterByTarget === 'object') {
    const exact = jitterByTarget[String(t)];
    if (validJitter(exact)) return exact;
    for (const [k, j] of Object.entries(jitterByTarget)) {
      const m = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(k);
      if (m && t >= Number(m[1]) && t <= Number(m[2]) && validJitter(j)) return j;
    }
  }
  return validJitter(jitter) ? jitter : DEFAULT_JITTER;
}

/**
 * Signed offsets with their probability, in draw order: [{offset, p}] (0, −1, +1, −2, +2, …). Invalid / empty
 * jitter → the default table; shares are normalized to sum 1.
 */
export function jitterTable(jitter = DEFAULT_JITTER) {
  const entries = Object.entries(jitter && typeof jitter === 'object' ? jitter : DEFAULT_JITTER)
    .map(([k, w]) => [Math.abs(Math.trunc(Number(k))), Number(w)])
    .filter(([k, w]) => Number.isFinite(k) && Number.isFinite(w) && w > 0)
    .sort((a, b) => a[0] - b[0]);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  if (!entries.length || !(total > 0)) return jitterTable(DEFAULT_JITTER);
  const out = [];
  for (const [k, w] of entries) {
    if (k === 0) out.push({ offset: 0, p: w / total });
    else out.push({ offset: -k, p: w / total / 2 }, { offset: k, p: w / total / 2 });
  }
  return out;
}

/** The roulette value for target `t` and a uniform draw `r` ∈ [0, 1) (`opts` = the skill config + min / max). */
export function skillValueFor(t, r, { jitter, jitterByTarget, min = 1, max = 10 } = {}) {
  const table = jitterTable(jitterFor(t, { jitter, jitterByTarget }));
  let acc = 0;
  for (const { offset, p } of table) {
    acc += p;
    if (r < acc) return reflect(t + offset, min, max);
  }
  return reflect(t + table.at(-1).offset, min, max);
}

/** One skill spin with the game RNG (consumes exactly one `rng.next()`). */
export function skillValue(rng, t, opts = {}) {
  return skillValueFor(t, rng.next(), opts);
}

/** Exact outcome distribution of target `t`: {value: probability} (CPU aim, tests, the client hint). */
export function skillDistribution(t, { jitter, jitterByTarget, min = 1, max = 10 } = {}) {
  const dist = {};
  for (const { offset, p } of jitterTable(jitterFor(t, { jitter, jitterByTarget }))) {
    const v = reflect(t + offset, min, max);
    dist[v] = (dist[v] ?? 0) + p;
  }
  return dist;
}

/**
 * What aiming at `t` risks (the client hint), from the result distribution (edge bounces included): `{target, hit
 * (P(result = t)), spread (the farthest result), shares [{offset 0..spread, p}] (P(|result − t| = offset)), low, high
 * (the range of results), mean}`.
 */
export function aimRisk(t, { jitter, jitterByTarget, min = 1, max = 10 } = {}) {
  const dist = skillDistribution(t, { jitter, jitterByTarget, min, max });
  const values = Object.keys(dist).map(Number);
  const shares = [];
  for (const v of values) {
    const k = Math.abs(v - t);
    const row = shares.find((x) => x.offset === k);
    if (row) row.p += dist[v];
    else shares.push({ offset: k, p: dist[v] });
  }
  return {
    target: t,
    hit: dist[t] ?? 0,
    spread: Math.max(0, ...shares.map((x) => x.offset)),
    shares: shares.sort((a, b) => a.offset - b.offset),
    low: Math.min(...values),
    high: Math.max(...values),
    mean: values.reduce((sum, v) => sum + v * dist[v], 0),
  };
}
