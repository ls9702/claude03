// Board generation (pure) + track navigation helpers.
//
// board = { eras: [{ id, name, turns, tiles: [...], routes?: { love|career|money: { tiles } } }] }
// Single-track era: tiles.length === turns.
// Route era (young / middle_age): tiles = [routeChoice stop (main:0), merge (main:1)] and three
//   route tracks of equal length L = turns - 2 between them, so the path length is still `turns`
//   (for turns < 3 the routes keep a minimum length of 1).
// Position: { eraIndex, route: 'main'|'love'|'career'|'money', index } — index -1 on main of era 0 = start.
// Tile ids are stable: `${eraId}:${route|main}:${index}`.
import { erasForMode, gameData } from '../data/index.js';

export const ROUTE_KEYS = ['love', 'career', 'money'];
export const START_ID = 'start';

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

function stopTile(id, stop) {
  return { id, type: 'stop', label: stop.label, icon: stop.icon, promptId: stop.promptId };
}

/**
 * Build the board for a room config.
 * @param {{mode:string, eraTurns:object}} config
 * @param {{int,pick,weighted}} rng
 */
export function buildBoard(config, rng, data = gameData()) {
  const bd = data.board;
  const eraIdsInMode = data.eras.modes[config.mode]?.eras ?? erasForMode(config.mode);
  if (!eraIdsInMode.length) throw new Error(`unknown mode ${config.mode}`);
  const eras = eraIdsInMode.map((eraId) => {
    const def = data.eras.eras.find((e) => e.id === eraId);
    const eraDef = bd.eras[eraId];
    const turns = Math.max(1, config.eraTurns?.[eraId] ?? def.defaultTurns);
    const era = { id: eraId, name: def.name, turns, tiles: [] };
    if (bd.routeEras.includes(eraId)) {
      const L = Math.max(1, turns - 2);
      era.tiles.push(stopTile(`${eraId}:main:0`, bd.routeStop));
      era.routes = {};
      for (const key of ROUTE_KEYS) {
        const rp = bd.routePools[key];
        const tiles = [];
        for (let i = 0; i < L; i++) {
          const tile = makeTile(`${eraId}:${key}:${i}`, rng.weighted(rp.pool), eraDef, rp.labels, bd, rng);
          tile.route = key;
          tiles.push(tile);
        }
        era.routes[key] = { tiles };
      }
      era.tiles.push({ id: `${eraId}:main:1`, type: 'merge', label: bd.mergeTile.label, icon: bd.mergeTile.icon });
    } else {
      for (let i = 0; i < turns; i++) era.tiles.push(makeTile(`${eraId}:main:${i}`, rng.weighted(eraDef.pool), eraDef, null, bd, rng));
      for (const stop of bd.fixedStops?.[eraId] ?? []) {
        if (stop.index < turns) era.tiles[stop.index] = stopTile(`${eraId}:main:${stop.index}`, stop);
      }
    }
    return era;
  });
  const last = eras.at(-1);
  const goalAt = last.tiles.length - 1;
  last.tiles[goalAt] = { id: last.tiles[goalAt].id, type: 'goal', label: '인생 골인', icon: bd.tileTypes.goal.icon };
  return { eras };
}

/** Number of tiles a pawn walks through in an era (routes count once). */
export function eraPathLength(era) {
  return era.routes ? era.tiles.length + era.routes[ROUTE_KEYS[0]].tiles.length : era.tiles.length;
}

export function startPosition() {
  return { eraIndex: 0, route: 'main', index: -1 };
}

/** Tile at a position (null for the start square). */
export function tileAt(board, pos) {
  if (pos.index < 0) return null;
  const era = board.eras[pos.eraIndex];
  if (!era) return null;
  const track = pos.route === 'main' ? era.tiles : era.routes?.[pos.route]?.tiles;
  return track?.[pos.index] ?? null;
}

export function tileIdAt(board, pos) {
  return tileAt(board, pos)?.id ?? START_ID;
}

/**
 * The position one step ahead, or null past the goal.
 * @param {string|null} route the character's chosen route (used when leaving a routeChoice stop)
 */
export function nextPosition(board, pos, route) {
  const era = board.eras[pos.eraIndex];
  if (pos.route !== 'main') {
    const len = era.routes[pos.route].tiles.length;
    if (pos.index + 1 < len) return { ...pos, index: pos.index + 1 };
    return { eraIndex: pos.eraIndex, route: 'main', index: 1 }; // merge tile
  }
  if (era.routes && pos.index === 0) {
    const key = ROUTE_KEYS.includes(route) ? route : 'career';
    return { eraIndex: pos.eraIndex, route: key, index: 0 };
  }
  if (pos.index + 1 < era.tiles.length) return { ...pos, index: pos.index + 1 };
  if (pos.eraIndex + 1 < board.eras.length) return { eraIndex: pos.eraIndex + 1, route: 'main', index: 0 };
  return null;
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
