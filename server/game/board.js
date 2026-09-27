// Board generation (pure) + navigation helpers — loop maps (원작식 순환 맵).
//
// board = { eras: [{ id, name, turns, loop: true, lap, tiles: [...], routes?, fork?, rejoin? }] }
// Every era is its own looping map of `lap` tiles (lap = clamp(round(turns × lapPerTurn), lapMin, lapMax), board.json
// `loop`). `tiles` = the main ring; tiles[0] = `start` (no effect; stepping forward from the last main index wraps to
// index 0 = one more lap).
// Route eras (young / middle_age): the main ring holds the 인생 갈림길 `stop` at index `fork` (promptId routeChoice) and
// the `merge` tile at `rejoin = fork + 1`; three route tracks `routes.{love|career|money}.tiles` of EQUAL length R sit
// between them. Lap path = main[0..fork] → route[0..R-1] → main[rejoin..] → wrap, so every lap (any route) = lap tiles.
// Paydays (`salary` 월급날, forced stop) are placed every `payday.min`–`payday.max` tiles along every lap path (the gap
// across the wrap counts); a route slot gets the same special tile on all three routes, so every route path has the
// same spacing. Pass tiles (`pass` 찬스 광장) ≈ every `pass.every` tiles (min..max per lap), never next to a payday.
// The mode's final era (eras.json `modes.<mode>.finalEra`, senior in lifetime / adult) is NOT a loop: a linear track of
// `config.finalLength` tiles (start … goal) with no turn limit — the goal race. Mostly good tiles (board.json
// `finalTrack.pool`, good events only), paydays every payday.min–max tiles, trouble (loss) only at 3 fixed spots (just
// before / 5 tiles after the last payday, just before the goal), 2–3 인생역전 tiles, no 찬스 광장 / shop.
// Position: { eraIndex, route: 'main'|'love'|'career'|'money', index } — { route: 'main', index: 0 } = the era start.
// Tile ids are stable: `${eraId}:${route|main}:${index}`.
import { erasForMode, gameData } from '../data/index.js';

export const ROUTE_KEYS = ['love', 'career', 'money'];
export const START_ID = 'start';
/** Tile types that end a move (the remaining steps are discarded). */
export const HALT_TYPES = ['salary', 'stop', 'goal'];

/** Loop settings (board.json `loop`, defaults = the contract). */
export function loopConfig(bd = gameData().board) {
  const l = bd?.loop ?? {};
  return {
    lapPerTurn: l.lapPerTurn ?? 5.4,
    lapMin: l.lapMin ?? 18,
    lapMax: l.lapMax ?? 100,
    payday: { min: l.payday?.min ?? 18, max: l.payday?.max ?? 25 },
    pass: { every: l.pass?.every ?? 27, min: l.pass?.min ?? 2, max: l.pass?.max ?? 4 },
    routeShare: l.routeShare ?? 0.45,
    forkAt: l.forkAt ?? 0.3,
  };
}

/** Tiles per lap for an era of `turns` turns. */
export function lapSize(turns, cfg = loopConfig()) {
  return Math.max(cfg.lapMin, Math.min(cfg.lapMax, Math.round(turns * cfg.lapPerTurn)));
}

/**
 * Number of paydays per lap: the count whose even gap is inside [min, max], else the one whose gap is closest to it
 * (e.g. lap 27 → 1 payday (gap 27), lap 32 → 2 (gap 16)); a lap shorter than `min` still gets exactly one.
 */
export function paydayCount(lap, { min, max } = loopConfig().payday) {
  if (lap <= max) return 1;
  let best = 1;
  let bestErr = Infinity;
  for (let n = 1; n <= Math.ceil(lap / Math.max(1, min)) + 1; n++) {
    const g = lap / n;
    const err = g < min ? min - g : g > max ? g - max : 0;
    if (err < bestErr - 1e-9) {
      best = n;
      bestErr = err;
    }
  }
  return best;
}

/** Pass tiles per lap. */
export const passCount = (lap, { every, min, max } = loopConfig().pass) => Math.max(min, Math.min(max, Math.round(lap / every)));

function roundAmount(v) {
  if (v <= 0) return 0;
  return v < 100 ? Math.max(5, Math.round(v / 5) * 5) : Math.round(v / 10) * 10;
}

function makeTile(id, entry, eraDef, labels, bd, rng) {
  const type = entry.type;
  const meta = bd.tileTypes[type] ?? {};
  const tile = { id, type, label: meta.name ?? type, icon: meta.icon ?? '' };
  if (type === 'money' || type === 'loss') {
    const range = eraDef[type];
    tile.amount = roundAmount(rng.int(range.min, range.max) * (entry.scale ?? 1));
    const pool = labels?.[type]?.length ? labels[type] : range.labels;
    if (pool?.length) tile.label = rng.pick(pool);
  }
  return tile;
}

const fixedTile = (id, type, bd) => ({ id, type, label: bd.tileTypes[type]?.name ?? type, icon: bd.tileTypes[type]?.icon ?? '' });

/**
 * A route's tile pool in one era: `routePools[route].pool`, with `eraOverrides[eraId][type] = {weight?, scale?}`
 * merged into the matching entries (e.g. more / bigger money tiles on the young career route only).
 */
export function routePool(bd, route, eraId) {
  const rp = bd.routePools[route];
  const ov = rp.eraOverrides?.[eraId];
  if (!ov) return rp.pool;
  return rp.pool.map((e) => (ov[e.type] && typeof ov[e.type] === 'object' ? { ...e, ...ov[e.type] } : e));
}

function stopTile(id, stop) {
  return { id, type: 'stop', label: stop.label, icon: stop.icon, promptId: stop.promptId };
}

const cyc = (x, n) => ((x % n) + n) % n;

/**
 * Payday slots on a cyclic lap of `lap` slots: n gaps within [min, max] (widened when the lap cannot be split that
 * way), jittered, then rotated to the first offset (from a random start) where no payday hits a `blocked` slot.
 */
export function placePaydays(lap, blocked, rng, cfg = loopConfig().payday) {
  const n = paydayCount(lap, cfg);
  const lo = Math.min(cfg.min, Math.floor(lap / n));
  const hi = Math.max(cfg.max, Math.ceil(lap / n));
  const gaps = Array.from({ length: n }, (_, i) => Math.floor(lap / n) + (i < lap % n ? 1 : 0));
  for (let k = 0; k < n * 4; k++) {
    const i = rng.int(0, n - 1);
    const j = rng.int(0, n - 1);
    if (i !== j && gaps[i] - 1 >= lo && gaps[j] + 1 <= hi) {
      gaps[i]--;
      gaps[j]++;
    }
  }
  const start = rng.int(0, lap - 1);
  for (let t = 0; t < lap; t++) {
    const off = cyc(start + t, lap);
    const slots = [];
    let at = off;
    for (const g of gaps) {
      slots.push(at);
      at = cyc(at + g, lap);
    }
    if (!slots.some((s) => blocked.has(s))) return slots;
  }
  // no rotation clears every blocked slot (tiny laps): drop the blocked ones (at least one payday stays)
  const any = [...Array(lap).keys()].find((s) => !blocked.has(s));
  return any == null ? [] : [any];
}

/** Pass slots: `count` roughly evenly spaced, never on / next to a payday, never on a blocked slot or another pass. */
export function placePasses(lap, count, blocked, paydays, rng) {
  const bad = new Set(blocked);
  for (const p of paydays) for (const d of [-1, 0, 1]) bad.add(cyc(p + d, lap));
  const out = [];
  const off = rng.int(0, lap - 1);
  for (let k = 0; k < count; k++) {
    const ideal = Math.round(off + (k * lap) / count);
    for (let d = 0; d <= Math.ceil(lap / 2); d++) {
      const cands = d === 0 ? [ideal] : [ideal + d, ideal - d];
      const hit = cands.map((x) => cyc(x, lap)).find((s) => !bad.has(s) && !out.some((o) => Math.abs(cyc(o - s + lap / 2, lap) - lap / 2) <= 1));
      if (hit != null) {
        out.push(hit);
        break;
      }
    }
  }
  return out.sort((a, b) => a - b);
}

/** Length (tiles incl. start and goal) of the final race track. */
export function finalLength(config, data = gameData()) {
  const lim = data.eras.limits?.finalLength ?? { min: 20, max: 80, default: 40 };
  const v = Number.isInteger(config?.finalLength) ? config.finalLength : lim.default ?? 40;
  return Math.max(lim.min ?? 20, Math.min(lim.max ?? 80, v));
}

/** The final era's linear race track (see the header). */
function buildFinalTrack(era, eraDef, L, bd, cfg, rng) {
  const ft = bd.finalTrack ?? {};
  const goal = L - 1;
  const special = new Map([[0, 'start'], [goal, 'goal']]);
  const paydays = [];
  for (let at = 0; ; ) {
    at += rng.int(cfg.payday.min, cfg.payday.max);
    if (at > goal - (ft.paydayTail ?? 7)) break;
    paydays.push(at);
  }
  if (!paydays.length) paydays.push(Math.max(1, Math.round(goal / 2)));
  for (const p of paydays) special.set(p, 'salary');
  const last = paydays.at(-1);
  const trouble = [last - 1, last + (ft.troubleAfterPayday ?? 5), goal - 1];
  for (const t of trouble) if (t > 0 && t < goal && !special.has(t)) special.set(t, 'loss');
  const nearPay = (i) => paydays.some((p) => Math.abs(p - i) <= 1);
  const rev = Math.max(ft.reversal?.min ?? 2, Math.min(ft.reversal?.max ?? 3, Math.round(L / (ft.reversal?.every ?? 16))));
  const free = [...Array(L).keys()].filter((i) => i > 1 && !special.has(i) && !nearPay(i));
  for (let k = 0; k < rev && free.length; k++) {
    const i = free.splice(rng.int(0, free.length - 1), 1)[0];
    special.set(i, 'reversal');
  }
  for (let i = 0; i < L; i++) {
    const id = `${era.id}:main:${i}`;
    const type = special.get(i);
    if (type === 'goal') era.tiles.push({ id, type: 'goal', label: '인생 골인', icon: bd.tileTypes.goal?.icon ?? '🏁' });
    else if (type === 'loss') era.tiles.push(makeTile(id, { type: 'loss', scale: ft.troubleScale ?? 1 }, eraDef, null, bd, rng));
    else if (type) era.tiles.push(fixedTile(id, type, bd));
    else era.tiles.push(makeTile(id, rng.weighted(ft.pool ?? eraDef.pool), eraDef, null, bd, rng));
  }
  return era;
}

/**
 * Build the board for a room config.
 * @param {{mode:string, eraTurns:object}} config
 * @param {{int,pick,weighted}} rng
 */
export function buildBoard(config, rng, data = gameData()) {
  const bd = data.board;
  const cfg = loopConfig(bd);
  const eraIdsInMode = data.eras.modes[config.mode]?.eras ?? erasForMode(config.mode);
  if (!eraIdsInMode.length) throw new Error(`unknown mode ${config.mode}`);
  const eras = eraIdsInMode.map((eraId) => {
    const def = data.eras.eras.find((e) => e.id === eraId);
    const eraDef = bd.eras[eraId];
    if (data.eras.modes[config.mode]?.finalEra === eraId) {
      const L = finalLength(config, data);
      return buildFinalTrack({ id: eraId, name: def.name, turns: null, loop: false, final: true, length: L, tiles: [] }, eraDef, L, bd, cfg, rng);
    }
    const turns = Math.max(1, config.eraTurns?.[eraId] ?? def.defaultTurns);
    const lap = lapSize(turns, cfg);
    const era = { id: eraId, name: def.name, turns, loop: true, lap, tiles: [] };
    const routed = bd.routeEras.includes(eraId);
    // lap slots: 0..fork = main[0..fork], fork+1..fork+R = route[0..R-1], fork+R+1.. = main[fork+1..]
    const R = routed ? Math.max(3, Math.round(lap * cfg.routeShare)) : 0;
    const M = lap - R;
    const fork = routed ? Math.max(2, Math.min(M - 3, Math.round(M * cfg.forkAt))) : -1;
    const slotOf = (s) => (!routed || s <= fork ? { route: 'main', index: s } : s <= fork + R ? { route: 'route', index: s - fork - 1 } : { route: 'main', index: s - R });
    const blocked = new Set([0]);
    if (routed) for (const s of [fork - 1, fork, fork + 1, fork + R, fork + R + 1, fork + R + 2]) blocked.add(cyc(s, lap));
    const paydays = placePaydays(lap, blocked, rng, cfg.payday);
    const passBlocked = new Set([0, ...(routed ? [fork, fork + R + 1] : [])]);
    const passes = placePasses(lap, passCount(lap, cfg.pass), passBlocked, paydays, rng);
    const special = new Map([...paydays.map((s) => [s, 'salary']), ...passes.map((s) => [s, 'pass'])]);
    const mainSpecial = new Map();
    const routeSpecial = new Map();
    for (const [s, type] of special) {
      const at = slotOf(s);
      (at.route === 'main' ? mainSpecial : routeSpecial).set(at.index, type);
    }
    for (let i = 0; i < M; i++) {
      const id = `${eraId}:main:${i}`;
      if (i === 0) era.tiles.push(fixedTile(id, 'start', bd));
      else if (routed && i === fork) era.tiles.push(stopTile(id, bd.routeStop));
      else if (routed && i === fork + 1) era.tiles.push({ id, type: 'merge', label: bd.mergeTile.label, icon: bd.mergeTile.icon });
      else if (mainSpecial.has(i)) era.tiles.push(fixedTile(id, mainSpecial.get(i), bd));
      else era.tiles.push(makeTile(id, rng.weighted(eraDef.pool), eraDef, null, bd, rng));
    }
    if (routed) {
      era.fork = fork;
      era.rejoin = fork + 1;
      era.routes = {};
      for (const key of ROUTE_KEYS) {
        const rp = bd.routePools[key];
        const pool = routePool(bd, key, eraId);
        const tiles = [];
        for (let i = 0; i < R; i++) {
          const id = `${eraId}:${key}:${i}`;
          const tile = routeSpecial.has(i) ? fixedTile(id, routeSpecial.get(i), bd) : makeTile(id, rng.weighted(pool), eraDef, rp.labels, bd, rng);
          tile.route = key;
          tiles.push(tile);
        }
        era.routes[key] = { tiles };
      }
    }
    return era;
  });
  return { eras };
}

/** Number of tiles one lap of an era takes (routes count once); the final track's length. */
export function eraPathLength(era) {
  if (era.lap) return era.lap;
  if (era.final) return era.tiles.length;
  return era.routes ? era.tiles.length + era.routes[ROUTE_KEYS[0]].tiles.length : era.tiles.length;
}

/** The start of an era's map (every era starts on its `start` tile). */
export function startPosition(eraIndex = 0) {
  return { eraIndex, route: 'main', index: 0 };
}

/** Tile at a position (null for an off-board / legacy start square). */
export function tileAt(board, pos) {
  if (!pos || pos.index < 0) return null;
  const era = board.eras[pos.eraIndex];
  if (!era) return null;
  const track = pos.route === 'main' ? era.tiles : era.routes?.[pos.route]?.tiles;
  return track?.[pos.index] ?? null;
}

export function tileIdAt(board, pos) {
  return tileAt(board, pos)?.id ?? START_ID;
}

/**
 * The position one step ahead on the era's loop (never null for a loop board; wraps to the era start). Legacy
 * linear boards (no `loop`) keep the old behaviour (null past the goal).
 * @param {string|null} route the character's chosen route (used when leaving the fork; default career)
 */
export function nextPosition(board, pos, route) {
  const era = board.eras[pos.eraIndex];
  if (pos.route !== 'main') {
    const len = era.routes[pos.route].tiles.length;
    if (pos.index + 1 < len) return { ...pos, index: pos.index + 1 };
    return { eraIndex: pos.eraIndex, route: 'main', index: era.rejoin ?? 1 }; // merge tile
  }
  const fork = era.fork ?? (era.routes ? 0 : -1);
  if (era.routes && pos.index === fork) {
    const key = ROUTE_KEYS.includes(route) ? route : 'career';
    return { eraIndex: pos.eraIndex, route: key, index: 0 };
  }
  if (pos.index + 1 < era.tiles.length) return { ...pos, index: pos.index + 1 };
  if (era.loop) return { eraIndex: pos.eraIndex, route: 'main', index: 0 };
  if (pos.eraIndex + 1 < board.eras.length) return { eraIndex: pos.eraIndex + 1, route: 'main', index: 0 };
  return null;
}

/** Does a step from `pos` to `np` wrap around the era's start (one more lap)? */
export const wrapsAt = (board, pos, np) => np.route === 'main' && np.index === 0 && pos.route === 'main' && pos.index > 0 && !!board.eras[pos.eraIndex]?.loop;

/** The positions of one full lap from the start along `route` (the start excluded, the start of the next lap last). */
export function lapPositions(board, eraIndex, route = 'career') {
  const out = [];
  let pos = startPosition(eraIndex);
  const lap = eraPathLength(board.eras[eraIndex]);
  for (let s = 0; s < lap; s++) {
    pos = nextPosition(board, pos, route);
    out.push(pos);
  }
  return out;
}

/** Find a tile by id → { tile, pos } | null. */
export function findTile(board, tileId) {
  for (let e = 0; e < board.eras.length; e++) {
    const era = board.eras[e];
    const i = era.tiles.findIndex((t) => t.id === tileId);
    if (i >= 0) return { tile: era.tiles[i], pos: { eraIndex: e, route: 'main', index: i } };
    for (const key of Object.keys(era.routes ?? {})) {
      const j = era.routes[key].tiles.findIndex((t) => t.id === tileId);
      if (j >= 0) return { tile: era.routes[key].tiles[j], pos: { eraIndex: e, route: key, index: j } };
    }
  }
  return null;
}
