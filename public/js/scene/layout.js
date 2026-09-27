// Track layout for the 3D board (pure: no three.js / DOM → unit-tested in node).
//
// Loop maps (원작식 순환 맵): every era is its own closed loop and the board shows ONLY the current shared era
// (`room.eraIndex`). `layoutBoard(board, {eraIndex})` lays that era out on a closed curve whose shape depends on
// the era id (ERA_SHAPES: baby round blob, elem schoolyard track, middle bean, high rounded triangle, young wide race
// track, middle_age egg, senior five-lobed hill path). Tiles sit every `spacing` units of arc length; tile 0 (출발)
// is on the near side (towards the camera) and the walk goes left → right there (counter-clockwise on screen).
//
// Route eras (young / middle_age): the main ring holds `fork` (routeChoice stop) and `rejoin` = fork + 1; the three
// equal-length route tracks run between them — career on the ring itself, love bulging outwards (+normal) and money
// inwards (−normal) with smoothstep ramps — so one lap is main + R tiles long whichever route is taken. The branch
// zone is centred on the near side of the loop.
//
// ADDENDUM A: the final era (senior, `loop: false, final: true`) is a LINEAR race to the goal — laid out as an open,
// winding hill road (left → right, gentle S curves) with the goal at its end (`closed: false`).
//
// Coordinates: ground plane x/z (y is up). The camera looks from +z, so "near" = +z; `+normal` (−tz, tx) of the
// counter-clockwise walk points outwards everywhere.
import { arcLengths, pointAt, resample, smoothstep, yawOf, prng, clamp, catmullRom } from './math.js';

export const ROUTE_ORDER = ['love', 'career', 'money'];
/** Sideways offset sign of each route (+ = outwards, − = inside the loop). */
export const ROUTE_SIDE = { love: 1, career: 0, money: -1 };
export const ROUTE_COLORS = { love: '#ff6fae', career: '#4f8ee0', money: '#e0a91a' };
export const LAYOUT_DEFAULTS = { spacing: 2.4, routeWidth: 4.6, samples: 960 };

/** Visual theme per era id (ground tint + prop mix + landmarks). Unknown eras use `default`. */
export const ERA_THEMES = {
  baby: { ground: '#a4dc8c', landmarks: ['hospital', 'house'], props: [['tree', 5], ['bush', 4], ['house', 2]], sign: '🍼' },
  elem: { ground: '#aadf88', landmarks: ['school'], props: [['tree', 5], ['bush', 2], ['house', 2]], sign: '🎒' },
  middle: { ground: '#a1d882', landmarks: ['school'], props: [['tree', 4], ['house', 2], ['apartment', 2]], sign: '📚' },
  high: { ground: '#98d07d', landmarks: ['school', 'academy'], props: [['tree', 3], ['apartment', 3], ['house', 1]], sign: '📝' },
  young: { ground: '#92cb7a', landmarks: ['campus', 'wedding', 'office'], props: [['apartment', 4], ['office', 3], ['tree', 3]], sign: '🌱' },
  middle_age: { ground: '#8cc477', landmarks: ['office', 'wedding', 'hospital'], props: [['apartment', 3], ['office', 3], ['tree', 3], ['house', 1]], sign: '💼' },
  senior: { ground: '#9bc882', landmarks: ['temple', 'hanok'], props: [['hanok', 3], ['pine', 4], ['tree', 2]], sign: '🍵' },
  default: { ground: '#9dd384', landmarks: ['house'], props: [['tree', 5], ['house', 2]], sign: '⭐' },
};
export const themeFor = (eraId) => ERA_THEMES[eraId] ?? ERA_THEMES.default;

/** Footprint radius per prop type (for spacing / collision with the track). */
export const PROP_RADIUS = {
  tree: 0.9, pine: 0.8, bush: 0.6, house: 1.7, apartment: 2.0, office: 1.9, hanok: 1.9,
  school: 3.6, academy: 2.4, campus: 3.8, hospital: 2.6, wedding: 2.6, temple: 3.2, mountain: 7,
};
/** Rough height per prop type (props.js geometry, max variant) — for the "never hides the track" rule. */
export const PROP_HEIGHT = {
  house: 2.4, apartment: 7.6, office: 9.6, hanok: 2.2, school: 4.6, academy: 3.4, campus: 4.2, hospital: 2.8, wedding: 5.1, temple: 3, mountain: 9,
};

/** Props that would hide the track when standing between it and the camera. */
export const TALL_PROPS = new Set(['apartment', 'office', 'school', 'academy', 'campus', 'hospital', 'wedding', 'temple', 'hanok', 'house']);
/** Default camera azimuths (landscape / portrait, board3d `defaultOrbit`) and the tangent of the default polar angle. */
export const VIEW_AZIMUTHS = [-0.3, -1.15];
const VIEW_TAN = 1.45;

// ---------- era shapes ----------
const polar = (sx, sz, f) => (t) => {
  const r = f(t);
  return { x: sx * r * Math.cos(t), z: sz * r * Math.sin(t) };
};
const superellipse = (a, b, n) => (t) => {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return { x: a * Math.sign(c) * Math.abs(c) ** (2 / n), z: b * Math.sign(s) * Math.abs(s) ** (2 / n) };
};
/**
 * Closed-loop shape per era id: a parametric curve t ∈ [0, 2π) on a unit-ish scale (scaled to the lap length).
 * Every shape is star-shaped around the origin (no self-intersection) with gentle curvature.
 */
export const ERA_SHAPES = {
  baby: { label: '둥근 놀이터', fn: polar(1.15, 0.92, (t) => 1 + 0.1 * Math.sin(3 * t + 0.4)) },
  elem: { label: '학교 운동장 트랙', fn: superellipse(1.45, 0.85, 4) },
  middle: { label: '강낭콩 산책로', fn: (t) => ({ x: 1.35 * Math.cos(t), z: 0.8 * Math.sin(t) + 0.2 * Math.cos(2 * t) }) },
  high: { label: '삼각 등굣길', fn: polar(1.2, 0.95, (t) => 1 + 0.12 * Math.sin(3 * t)) },
  young: { label: '청춘 레이스 트랙', fn: superellipse(1.7, 0.85, 2.6) },
  middle_age: { label: '달걀 순환로', fn: polar(1.5, 0.95, (t) => 1 + 0.16 * Math.cos(t) - 0.06 * Math.cos(2 * t)) },
  senior: { label: '꽃잎 산책길', fn: polar(1.1, 0.95, (t) => 1 + 0.07 * Math.cos(5 * t)) },
  default: { label: '순환 코스', fn: polar(1.2, 0.9, () => 1) },
};
export const shapeFor = (eraId) => ERA_SHAPES[eraId] ?? ERA_SHAPES.default;

/** Number of main-ring slots + route slots of one lap. */
export function lapSlots(era) {
  const R = era?.routes ? era.routes[Object.keys(era.routes)[0]]?.tiles.length ?? 0 : 0;
  return (era?.tiles?.length ?? 0) + R;
}

/** fork / rejoin main indices of a route era (server fields, else the stop / merge tiles, else 0 / 1). */
export function forkOf(era) {
  if (!era?.routes) return null;
  const tiles = era.tiles ?? [];
  let fork = Number.isInteger(era.fork) ? era.fork : tiles.findIndex((t) => t.type === 'stop' && (t.promptId ?? 'routeChoice') === 'routeChoice');
  if (fork < 0) fork = 0;
  const rejoin = Number.isInteger(era.rejoin) ? era.rejoin : (fork + 1) % Math.max(1, tiles.length);
  return { fork, rejoin, R: era.routes[Object.keys(era.routes)[0]]?.tiles.length ?? 0 };
}

/**
 * Closed dense polyline of an era's shape, counter-clockwise on screen, scaled so its length is `length`.
 * @returns {{ring: {x,z}[] (first point repeated at the end), acc: number[], perimeter: number, near: number}}
 *   `near` = arc position of the point closest to the camera (max z)
 */
export function eraRing(eraId, length, samples = LAYOUT_DEFAULTS.samples) {
  const fn = shapeFor(eraId).fn;
  const raw = [];
  for (let k = 0; k < samples; k++) raw.push(fn(-(2 * Math.PI * k) / samples)); // decreasing t → counter-clockwise on screen
  raw.push({ ...raw[0] });
  const acc0 = arcLengths(raw);
  const sc = length / acc0.at(-1);
  const ring = raw.map((p) => ({ x: p.x * sc, z: p.z * sc }));
  const acc = acc0.map((a) => a * sc);
  let bi = 0;
  for (let i = 1; i < samples; i++) if (ring[i].z > ring[bi].z) bi = i;
  return { ring, acc, perimeter: acc.at(-1), near: acc[bi] };
}

/**
 * Lay out ONE era of a (loop) board in world space.
 * @param {{eras: object[]}} board  room.board
 * @param {{eraIndex?: number, spacing?: number, routeWidth?: number}} opts
 * @returns {{
 *   loop: true, eraIndex, spacing, routeWidth, ring: {x,z}[], perimeter,
 *   tiles: Record<string, {id,x,z,yaw,type,eraIndex,route,index,s?}>,
 *   startId: string, start: {x,z,yaw},
 *   era: {index,id,name,shape,lap,fork,rejoin,center:{x,z},bounds,tileIds:string[],
 *         routes?: Record<string,{tileIds:string[],ribbon:{x,z}[],label:{x,z},start:{x,z},end:{x,z}}>},
 *   eras: object[] (= [era]), bounds
 * }}
 */
export function layoutBoard(board, opts = {}) {
  const o = { ...LAYOUT_DEFAULTS, ...opts };
  const S = o.spacing;
  const W = o.routeWidth;
  const eras = board?.eras ?? [];
  const eraIndex = clamp(Math.floor(Number(o.eraIndex) || 0), 0, Math.max(0, eras.length - 1));
  const era = eras[eraIndex] ?? { id: 'default', name: '', tiles: [] };
  if (era.loop === false) return layoutLinear(era, eraIndex, o);
  const main = era.tiles ?? [];
  const fk = forkOf(era);
  const R = fk?.R ?? 0;
  const slots = Math.max(3, main.length + R);
  const { ring, acc, perimeter, near } = eraRing(era.id, slots * S, o.samples);
  const P = perimeter;
  const wrap = (s) => ((s % P) + P) % P;
  const at = (s) => pointAt(ring, wrap(s), acc);
  // origin (arc position of main tile 0): start on the near side; a route era centres its branch zone there instead
  const origin = fk ? near - (fk.fork * S + ((R + 1) * S) / 2) : near;
  const mainArc = (i) => origin + (fk && i > fk.fork ? i + R : i) * S;

  const tiles = {};
  const put = (tile, p, extra) => {
    tiles[tile.id] = { id: tile.id, x: p.x, z: p.z, yaw: yawOf(p.tx, p.tz), type: tile.type, eraIndex, ...extra };
  };
  const out = { index: eraIndex, id: era.id, name: era.name ?? '', shape: shapeFor(era.id).label, lap: slots, fork: fk?.fork ?? null, rejoin: fk?.rejoin ?? null, tileIds: [] };
  main.forEach((t, index) => {
    const s = mainArc(index);
    put(t, at(s), { route: 'main', index, s: wrap(s - origin) });
    out.tileIds.push(t.id);
  });
  if (fk) {
    const sStop = mainArc(fk.fork);
    const sMerge = sStop + (R + 1) * S;
    out.routes = {};
    for (const key of Object.keys(era.routes)) {
      const side = ROUTE_SIDE[key] ?? 0;
      const ribbon = routeRibbon(at, sStop, sMerge, side * W, R);
      const pts = resample(ribbon, R + 2);
      const ids = [];
      era.routes[key].tiles.forEach((t, index) => {
        const p = pts[index + 1];
        const prev = pts[index];
        const next = pts[index + 2];
        tiles[t.id] = { id: t.id, x: p.x, z: p.z, yaw: yawOf(next.x - prev.x, next.z - prev.z), type: t.type, eraIndex, route: key, index };
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
  }
  const all = [...Object.values(tiles), ...Object.values(out.routes ?? {}).flatMap((r) => r.ribbon)];
  out.bounds = boundsOf(all, 3);
  out.center = { x: (out.bounds.minX + out.bounds.maxX) / 2, z: (out.bounds.minZ + out.bounds.maxZ) / 2 };
  const startId = main[0]?.id ?? null;
  const st = startId ? tiles[startId] : { x: 0, z: 0, yaw: 0 };
  return {
    loop: true,
    closed: true,
    eraIndex,
    spacing: S,
    routeWidth: W,
    ring,
    perimeter: P,
    origin: wrap(origin),
    tiles,
    startId,
    start: { x: st.x, z: st.z, yaw: st.yaw },
    era: out,
    eras: [out],
    bounds: out.bounds,
  };
}

/** Winding open road for a linear (final) era: control points meandering along +x, long enough for `length`. */
export function linearPath(length, { step = 10, amplitude = 5, freq = 0.95 } = {}) {
  const pts = [];
  for (let j = 0; ; j++) {
    pts.push({ x: j * step, z: j === 0 ? 0 : amplitude * Math.sin(j * freq) });
    if (j >= 2 && (j - 1) * step >= length + step) break;
  }
  return catmullRom(pts, 16);
}

/** Final era (ADDENDUM A): an open road from the start to the goal (no loop, no routes). */
function layoutLinear(era, eraIndex, o) {
  const S = o.spacing;
  const main = era.tiles ?? [];
  const lead = S;
  const path = linearPath(lead + Math.max(1, main.length) * S + S);
  const acc = arcLengths(path);
  const tiles = {};
  const out = { index: eraIndex, id: era.id, name: era.name ?? '', shape: '골인 언덕길', lap: main.length, fork: null, rejoin: null, tileIds: [], final: true };
  main.forEach((t, index) => {
    const p = pointAt(path, lead + index * S, acc);
    tiles[t.id] = { id: t.id, x: p.x, z: p.z, yaw: yawOf(p.tx, p.tz), type: t.type, eraIndex, route: 'main', index, s: index * S };
    out.tileIds.push(t.id);
  });
  // the drawn road: from a bit before the start to a bit after the goal
  const road = [];
  const end = lead + (main.length - 1) * S + S * 0.8;
  for (let s = lead - S * 0.8; s <= end; s += 0.4) {
    const p = pointAt(path, s, acc);
    road.push({ x: p.x, z: p.z });
  }
  out.bounds = boundsOf([...Object.values(tiles), ...road], 3);
  out.center = { x: (out.bounds.minX + out.bounds.maxX) / 2, z: (out.bounds.minZ + out.bounds.maxZ) / 2 };
  const startId = main[0]?.id ?? null;
  const st = startId ? tiles[startId] : { x: 0, z: 0, yaw: 0 };
  return {
    loop: false,
    closed: false,
    eraIndex,
    spacing: S,
    routeWidth: o.routeWidth,
    ring: road,
    perimeter: arcLengths(road).at(-1),
    origin: 0,
    tiles,
    startId,
    goalId: main.at(-1)?.id ?? null,
    start: { x: st.x, z: st.z, yaw: st.yaw },
    era: out,
    eras: [out],
    bounds: out.bounds,
  };
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

/**
 * Camera tour of the shown era (era transition): once around the loop from the start tile back to it; the branch
 * zone of a route era passes over the route labels.
 */
export function eraSweepPoints(layout, n = 8) {
  if (!layout?.ring?.length) return [];
  const acc = arcLengths(layout.ring);
  const P = acc.at(-1);
  const pts = [];
  for (let k = 0; k <= n; k++) {
    // loop: once around from the start; linear (final era): start → goal
    const s = layout.closed === false ? (k * P) / n : (((layout.origin + (k * P) / n) % P) + P) % P;
    const p = pointAt(layout.ring, s, acc);
    pts.push({ x: p.x, z: p.z });
  }
  return pts;
}

/** Ray-casting point-in-polygon test (closed polyline). */
export function insideRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z || 1e-9) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Points of the "shadow" a prop casts away from the camera for the default views: a tall prop there would hide
 * the track behind it. Pure; used by planProps and the tests.
 */
export function shadowPoints(p, type) {
  const h = PROP_HEIGHT[type] ?? 0;
  if (!h || !TALL_PROPS.has(type)) return [];
  const r = PROP_RADIUS[type] ?? 1;
  const len = r + h * VIEW_TAN;
  const out = [];
  for (const az of VIEW_AZIMUTHS) {
    const dx = -Math.sin(az);
    const dz = -Math.cos(az);
    for (let t = 0; t <= len; t += 0.8) out.push({ x: p.x + dx * t, z: p.z + dz * t });
  }
  return out;
}

/**
 * Deterministic town props around the shown loop: landmarks (the first one in the middle of the loop when it fits,
 * else behind the far side), scatter on both sides of the ring (inside = park), a sprinkle of trees inside and
 * mountains far behind. Tall props never stand where they would hide the track from the default camera views.
 * @returns {{type,x,z,yaw,scale,variant,eraIndex}[]}
 */
export function planProps(layout, { density = 1, seed = 7, mountains = true } = {}) {
  const rnd = prng(seed);
  const props = [];
  const cell = 4;
  const grid = new Map(); // everything (collision)
  const trackGrid = new Map(); // the track only (shadow test)
  const add = (map, x, z, r) => {
    const k = `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push({ x, z, r });
  };
  const hits = (map, x, z, r) => {
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    const span = Math.ceil((r + 4) / cell);
    for (let i = cx - span; i <= cx + span; i++)
      for (let j = cz - span; j <= cz + span; j++) for (const ob of map.get(`${i},${j}`) ?? []) if (Math.hypot(ob.x - x, ob.z - z) < ob.r + r) return true;
    return false;
  };
  const addTrack = (x, z, r) => {
    add(grid, x, z, r);
    add(trackGrid, x, z, r);
  };
  for (const t of Object.values(layout.tiles)) addTrack(t.x, t.z, 1.9);
  for (let i = 0; i < layout.ring.length; i += 3) addTrack(layout.ring[i].x, layout.ring[i].z, 1.6);
  for (const r of Object.values(layout.era.routes ?? {})) for (let i = 0; i < r.ribbon.length; i += 2) addTrack(r.ribbon[i].x, r.ribbon[i].z, 1.8);

  const shadowFree = (type, x, z) => shadowPoints({ x, z }, type).every((q) => !hits(trackGrid, q.x, q.z, 0.2));
  const nearestTrack = (x, z) => {
    let best = null;
    let bd = Infinity;
    for (const t of Object.values(layout.tiles)) {
      const d = Math.hypot(t.x - x, t.z - z);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  };
  const eraIndex = layout.eraIndex ?? 0;
  const place = (type, x, z, extra = {}) => {
    const r = PROP_RADIUS[type] ?? 1;
    if (hits(grid, x, z, r)) return false;
    if (!shadowFree(type, x, z)) return false;
    add(grid, x, z, r);
    props.push({ type, x, z, yaw: extra.yaw ?? rnd() * Math.PI * 2, scale: extra.scale ?? 0.85 + rnd() * 0.35, variant: Math.floor(rnd() * 6), eraIndex });
    return true;
  };
  const facing = (x, z) => {
    const t = nearestTrack(x, z);
    return t ? Math.atan2(t.x - x, t.z - z) : 0;
  };

  const e = layout.era;
  const theme = themeFor(e.id);
  const ring = layout.ring;
  const closed = layout.closed !== false;
  const inside = (x, z) => closed && insideRing(ring, x, z);
  const acc = arcLengths(ring);
  const P = acc.at(-1);
  const at = (s) => pointAt(ring, closed ? ((s % P) + P) % P : clamp(s, 0, P), acc);
  const baseD = e.routes ? layout.routeWidth + 3.2 : 3.4;
  // Landmarks: the first one in the middle of the loop (schoolyard!) when it fits, the rest behind the far side.
  theme.landmarks.forEach((type, i) => {
    if (i === 0 && inside(e.center.x, e.center.z) && place(type, e.center.x, e.center.z, { yaw: 0, scale: 1 })) return;
    if (!closed) {
      // linear road: behind it (−normal = away from the camera), spread along the way
      const r = PROP_RADIUS[type] ?? 2;
      for (let tries = 0; tries < 8; tries++) {
        const p = at(((i + 1) / (theme.landmarks.length + 1)) * P + tries * 1.3);
        const d = -(baseD + r + 0.6 + tries * 1.4);
        const x = p.x - p.tz * d;
        const z = p.z + p.tx * d;
        if (place(type, x, z, { yaw: facing(x, z), scale: 1 })) break;
      }
      return;
    }
    const r = PROP_RADIUS[type] ?? 2;
    const k = theme.landmarks.length;
    // far side = arc positions opposite the near point (origin side) → spread over the back half
    for (let tries = 0; tries < 8; tries++) {
      const s = layout.origin + P / 2 + (((i + 0.5) / k - 0.5) * P) / 2.2 + tries * 0.9;
      const p = at(s);
      const d = baseD + r + 0.6 + tries * 1.4; // outwards (+normal)
      const x = p.x - p.tz * d;
      const z = p.z + p.tx * d;
      if (place(type, x, z, { yaw: facing(x, z), scale: 1 })) break;
    }
  });
  // Scatter along both sides of the ring (inside only when the point is really inside the loop).
  const total = theme.props.reduce((n, [, w]) => n + w, 0);
  const pick = () => {
    let r = rnd() * total;
    for (const [type, w] of theme.props) if ((r -= w) < 0) return type;
    return theme.props[0][0];
  };
  // small loops (kids eras) get a second, wider belt of town so they don't look empty
  const belts = P < 90 ? [0, 9] : [0];
  for (const extra of belts) for (let s = 0; s < P; s += 1.7) {
    for (const side of [1, -1]) {
      if (rnd() > 0.55 * density) continue;
      if (extra && side < 0) continue;
      let type = pick();
      const r = PROP_RADIUS[type] ?? 1;
      const d = side * (baseD + extra + r + rnd() * (side > 0 ? 10 : 5));
      const p = at(s + rnd() * 1.5);
      const x = p.x - p.tz * d;
      const z = p.z + p.tx * d;
      if (closed && side < 0 && !inside(x, z)) continue;
      // keep the view clear: no towers inside the loop (a park with houses at most), none that would hide the track
      if (TALL_PROPS.has(type) && ((closed && side < 0 && type !== 'house') || !shadowFree(type, x, z))) type = rnd() < 0.6 ? 'tree' : 'bush';
      place(type, x, z, TALL_PROPS.has(type) ? { yaw: facing(x, z) } : {});
    }
  }
  // A park inside the loop: trees / bushes on a jittered grid.
  const b = e.bounds;
  for (let x = b.minX + 2; x < b.maxX - 2; x += 5.5) {
    for (let z = b.minZ + 2; z < b.maxZ - 2; z += 5.5) {
      if (rnd() > 0.4 * density) continue;
      const px = x + (rnd() - 0.5) * 3;
      const pz = z + (rnd() - 0.5) * 3;
      if (!inside(px, pz)) continue;
      place(e.id === 'senior' && rnd() < 0.5 ? 'pine' : rnd() < 0.7 ? 'tree' : 'bush', px, pz);
    }
  }
  if (mountains) {
    const n = Math.max(2, Math.round(((b.maxX - b.minX) / 16) * clamp(density, 0.4, 1)));
    for (let i = 0; i < n; i++) {
      const x = b.minX + ((i + 0.5) / n) * (b.maxX - b.minX) + (rnd() - 0.5) * 6;
      place('mountain', x, b.minZ - 14 - rnd() * 10, { scale: 0.8 + rnd() * 0.6 });
    }
  }
  return props;
}
