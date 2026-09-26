// Track layout for the 3D board (pure: no three.js / DOM → unit-tested in node).
//
// The whole board is one meandering centerline (Catmull-Rom through control points) with tiles every
// `spacing` units of arc length: start, then each era's main tiles in walking order. A route era
// (young / middle_age) occupies stop + L + merge slots on the centerline; its three routes run from the
// stop tile to the merge tile — career on the centerline, love / money bulging out to either side
// (smoothstep ramps) — with L tiles evenly spaced along each ribbon.
//
// Coordinates: ground plane x/z (y is up). The camera looks from +z, so "near" = +normal.
import { catmullRom, arcLengths, pointAt, resample, smoothstep, yawOf, prng, clamp } from './math.js';

export const ROUTE_ORDER = ['love', 'career', 'money'];
export const ROUTE_SIDE = { love: 1, career: 0, money: -1 };
export const ROUTE_COLORS = { love: '#ff6fae', career: '#4f8ee0', money: '#e0a91a' };
export const LAYOUT_DEFAULTS = { spacing: 2.4, routeWidth: 4.6, amplitude: 5, step: 10, freq: 0.95, lead: 2.4 };

/** Visual theme per era id (ground tint + prop mix + landmarks). Unknown eras use `default`. */
export const ERA_THEMES = {
  baby: { ground: '#a4dc8c', landmarks: ['house', 'hospital'], props: [['tree', 5], ['bush', 3], ['house', 2]], sign: '🍼' },
  elem: { ground: '#aadf88', landmarks: ['school'], props: [['tree', 5], ['bush', 2], ['house', 2]], sign: '🎒' },
  middle: { ground: '#a1d882', landmarks: ['school'], props: [['tree', 4], ['house', 2], ['apartment', 2]], sign: '📚' },
  high: { ground: '#98d07d', landmarks: ['school', 'academy'], props: [['tree', 3], ['apartment', 3], ['house', 1]], sign: '📝' },
  young: { ground: '#92cb7a', landmarks: ['campus', 'wedding'], props: [['apartment', 4], ['office', 3], ['tree', 3]], sign: '🌱' },
  middle_age: { ground: '#8cc477', landmarks: ['office', 'wedding'], props: [['apartment', 3], ['office', 3], ['tree', 3], ['house', 1]], sign: '💼' },
  senior: { ground: '#9bc882', landmarks: ['temple', 'hanok'], props: [['hanok', 3], ['pine', 4], ['tree', 2]], sign: '🍵' },
  default: { ground: '#9dd384', landmarks: ['house'], props: [['tree', 5], ['house', 2]], sign: '⭐' },
};
export const themeFor = (eraId) => ERA_THEMES[eraId] ?? ERA_THEMES.default;

/** Footprint radius per prop type (for spacing / collision with the track). */
export const PROP_RADIUS = {
  tree: 0.9, pine: 0.8, bush: 0.6, house: 1.7, apartment: 2.0, office: 1.9, hanok: 1.9,
  school: 3.6, academy: 2.4, campus: 3.8, hospital: 2.6, wedding: 2.6, temple: 3.2, mountain: 7,
};

/** Props that would hide the track when standing between it and the camera. */
export const TALL_PROPS = new Set(['apartment', 'office', 'school', 'academy', 'campus', 'hospital', 'wedding', 'temple', 'hanok', 'house']);

function eraSlotCount(era) {
  return era.routes ? era.tiles.length + era.routes[Object.keys(era.routes)[0]].tiles.length : era.tiles.length;
}

/** Centerline control points (meander along +x), long enough for `length` units of arc. */
export function centerlineControls(length, o = LAYOUT_DEFAULTS) {
  const pts = [];
  let j = 0;
  // Rough upper bound on arc per step; stop once the dense polyline is surely long enough.
  for (;;) {
    pts.push({ x: j * o.step, z: j === 0 ? 0 : o.amplitude * Math.sin(j * o.freq) });
    j++;
    if (j >= 3 && (j - 2) * o.step >= length + o.step) break;
  }
  return pts;
}

/**
 * Lay out a board (room.board) in world space.
 * @returns {{
 *   spacing, routeWidth, centerline: {x,z}[], length,
 *   tiles: Record<string, {id,x,z,yaw,eraIndex,route,index,type,s?}>,
 *   start: {x,z,yaw},
 *   eras: {index,id,name,s0,s1,center:{x,z},bounds:{minX,maxX,minZ,maxZ},tileIds:string[],
 *          routes?: Record<string,{tileIds:string[],ribbon:{x,z}[],label:{x,z},start:{x,z},end:{x,z}}>}[],
 *   bounds:{minX,maxX,minZ,maxZ}
 * }}
 */
export function layoutBoard(board, opts = {}) {
  const o = { ...LAYOUT_DEFAULTS, ...opts };
  const S = o.spacing;
  const W = o.routeWidth;
  const slotsTotal = 1 + board.eras.reduce((n, e) => n + eraSlotCount(e), 0);
  const needed = o.lead + (slotsTotal - 1) * S + S * 2;
  const centerline = catmullRom(centerlineControls(needed, o), 16);
  const acc = arcLengths(centerline);
  const at = (s) => pointAt(centerline, o.lead + s, acc);
  const tiles = {};
  const put = (tile, p, extra) => {
    tiles[tile.id] = { id: tile.id, x: p.x, z: p.z, yaw: yawOf(p.tx, p.tz), type: tile.type, ...extra };
  };
  const sp = at(0);
  const start = { x: sp.x, z: sp.z, yaw: yawOf(sp.tx, sp.tz) };
  tiles.start = { id: 'start', x: sp.x, z: sp.z, yaw: start.yaw, type: 'start', eraIndex: 0, route: 'main', index: -1, s: 0 };

  let k = 1;
  const eras = board.eras.map((era, eraIndex) => {
    const s0 = k * S;
    const out = { index: eraIndex, id: era.id, name: era.name, s0, s1: s0, tileIds: [] };
    if (!era.routes) {
      era.tiles.forEach((t, index) => {
        const s = k * S;
        put(t, at(s), { eraIndex, route: 'main', index, s });
        out.tileIds.push(t.id);
        k++;
      });
    } else {
      const keys = Object.keys(era.routes);
      const L = era.routes[keys[0]].tiles.length;
      const sStop = k * S;
      const sMerge = (k + L + 1) * S;
      put(era.tiles[0], at(sStop), { eraIndex, route: 'main', index: 0, s: sStop });
      out.tileIds.push(era.tiles[0].id);
      out.routes = {};
      for (const key of keys) {
        const side = ROUTE_SIDE[key] ?? 0;
        const ribbon = routeRibbon(at, sStop, sMerge, side * W, L);
        const pts = resample(ribbon, L + 2);
        const ids = [];
        era.routes[key].tiles.forEach((t, index) => {
          const p = pts[index + 1];
          const prev = pts[index];
          const next = pts[index + 2];
          const tx = next.x - prev.x;
          const tz = next.z - prev.z;
          tiles[t.id] = { id: t.id, x: p.x, z: p.z, yaw: yawOf(tx, tz), type: t.type, eraIndex, route: key, index };
          ids.push(t.id);
        });
        const mid = pointAt(ribbon, arcLengths(ribbon).at(-1) / 2);
        out.routes[key] = {
          tileIds: ids,
          ribbon: ribbon.map((p) => ({ x: p.x, z: p.z })),
          label: { x: mid.x, z: mid.z },
          start: { x: ribbon[0].x, z: ribbon[0].z },
          end: { x: ribbon.at(-1).x, z: ribbon.at(-1).z },
        };
      }
      put(era.tiles[1], at(sMerge), { eraIndex, route: 'main', index: 1, s: sMerge });
      out.tileIds.push(era.tiles[1].id);
      k += L + 2;
    }
    out.s1 = (k - 1) * S;
    return out;
  });

  // Era bounds / centers from their tiles (+ the start square for era 0).
  const margin = 3;
  for (const e of eras) {
    const pts = Object.values(tiles).filter((t) => t.eraIndex === e.index);
    e.bounds = boundsOf(pts, margin);
    e.center = { x: (e.bounds.minX + e.bounds.maxX) / 2, z: (e.bounds.minZ + e.bounds.maxZ) / 2 };
  }
  const bounds = boundsOf(Object.values(tiles), margin);
  return { spacing: S, routeWidth: W, centerline, length: acc.at(-1), tiles, start, eras, bounds, lead: o.lead };
}

/** Dense polyline of a route from the stop (sStop) to the merge (sMerge), bulging `offset` sideways. */
export function routeRibbon(at, sStop, sMerge, offset, L) {
  const n = Math.max(12, (L + 1) * 8);
  const ramp = Math.min(0.35, 1.4 / (L + 1));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const p = at(sStop + u * (sMerge - sStop));
    const d = offset * smoothstep(Math.min(u, 1 - u) / ramp);
    out.push({ x: p.x - p.tz * d, z: p.z + p.tx * d });
  }
  return out;
}

export function boundsOf(pts, margin = 0) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  if (minX === Infinity) return { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  return { minX: minX - margin, maxX: maxX + margin, minZ: minZ - margin, maxZ: maxZ + margin };
}

/** Offset of pawn k among n pawns sharing a tile (small ring, first pawn in front). */
export function slotOffset(k, n, radius = n > 4 ? 0.62 : 0.48) {
  if (n <= 1) return { x: 0, z: 0 };
  const a = (k / n) * Math.PI * 2 + Math.PI / 2;
  return { x: Math.cos(a) * radius, z: Math.sin(a) * radius };
}

/** Walking order points of an era (for camera sweeps): main tiles, routes merged by index. */
export function eraSweepPoints(layout, eraIndex) {
  const e = layout.eras[eraIndex];
  if (!e) return [];
  if (!e.routes) return e.tileIds.map((id) => layout.tiles[id]);
  const [stop, merge] = e.tileIds;
  return [layout.tiles[stop], ...ROUTE_ORDER.filter((k) => e.routes[k]).map((k) => e.routes[k].label), layout.tiles[merge]];
}

/** Index of the era whose centerline span contains arc position s (clamped). */
export function eraIndexAtS(layout, s) {
  for (let i = layout.eras.length - 1; i >= 0; i--) if (s >= layout.eras[i].s0 - layout.spacing / 2) return i;
  return 0;
}

/**
 * Deterministic town props along the track.
 * @returns {{type,x,z,yaw,scale,variant,eraIndex}[]}
 */
export function planProps(layout, { density = 1, seed = 7, mountains = true } = {}) {
  const rnd = prng(seed);
  const props = [];
  const cell = 4;
  const grid = new Map();
  const key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  const addObstacle = (x, z, r) => {
    const k = key(x, z);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push({ x, z, r });
  };
  const free = (x, z, r) => {
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    const span = Math.ceil((r + 4) / cell);
    for (let i = cx - span; i <= cx + span; i++)
      for (let j = cz - span; j <= cz + span; j++)
        for (const ob of grid.get(`${i},${j}`) ?? []) if (Math.hypot(ob.x - x, ob.z - z) < ob.r + r) return false;
    return true;
  };
  // Track obstacles: tiles, the centerline and every route ribbon.
  for (const t of Object.values(layout.tiles)) addObstacle(t.x, t.z, 1.9);
  for (let i = 0; i < layout.centerline.length; i += 2) addObstacle(layout.centerline[i].x, layout.centerline[i].z, 1.6);
  for (const e of layout.eras) for (const r of Object.values(e.routes ?? {})) for (let i = 0; i < r.ribbon.length; i += 2) addObstacle(r.ribbon[i].x, r.ribbon[i].z, 1.8);

  const acc = arcLengths(layout.centerline);
  const at = (s) => pointAt(layout.centerline, layout.lead + s, acc);
  const place = (type, x, z, eraIndex, extra = {}) => {
    const r = PROP_RADIUS[type] ?? 1;
    if (!free(x, z, r)) return false;
    addObstacle(x, z, r);
    props.push({ type, x, z, yaw: extra.yaw ?? rnd() * Math.PI * 2, scale: extra.scale ?? 0.85 + rnd() * 0.35, variant: Math.floor(rnd() * 6), eraIndex });
    return true;
  };

  for (const e of layout.eras) {
    const theme = ERA_THEMES[e.id] ?? ERA_THEMES.default;
    const baseD = e.routes ? layout.routeWidth + 3.2 : 3.4;
    const s0 = e.s0 - layout.spacing / 2;
    const s1 = e.s1 + layout.spacing / 2;
    // Landmarks: on the far side (the camera looks from +normal), facing the road.
    theme.landmarks.forEach((type, i) => {
      const s = s0 + ((i + 1) / (theme.landmarks.length + 1)) * (s1 - s0);
      const p = at(s);
      const side = -1;
      const r = PROP_RADIUS[type] ?? 2;
      for (let tries = 0; tries < 6; tries++) {
        const d = side * (baseD + r + 0.6 + tries * 1.5);
        const x = p.x - p.tz * d;
        const z = p.z + p.tx * d;
        if (place(type, x, z, e.index, { yaw: yawOf(p.tx, p.tz) + (side < 0 ? 0 : Math.PI), scale: 1 })) break;
      }
    });
    // Scatter: weighted picks along both sides.
    const total = theme.props.reduce((n, [, w]) => n + w, 0);
    const pick = () => {
      let r = rnd() * total;
      for (const [type, w] of theme.props) if ((r -= w) < 0) return type;
      return theme.props[0][0];
    };
    for (let s = s0; s < s1; s += 1.6) {
      for (const side of [-1, 1]) {
        if (rnd() > 0.55 * density) continue;
        let type = pick();
        if (side > 0 && TALL_PROPS.has(type)) type = rnd() < 0.5 ? 'tree' : 'bush'; // keep the near side low
        const r = PROP_RADIUS[type] ?? 1;
        const d = side * (baseD + r + rnd() * 10);
        const p = at(s + rnd() * 1.5);
        place(type, p.x - p.tz * d, p.z + p.tx * d, e.index);
      }
    }
    if (mountains) {
      const n = Math.max(1, Math.round(((s1 - s0) / 14) * clamp(density, 0.4, 1)));
      for (let i = 0; i < n; i++) {
        const p = at(s0 + ((i + 0.5) / n) * (s1 - s0));
        const d = -(26 + rnd() * 10);
        place('mountain', p.x - p.tz * d, p.z + p.tx * d, e.index, { scale: 0.8 + rnd() * 0.6 });
      }
    }
  }
  return props;
}
