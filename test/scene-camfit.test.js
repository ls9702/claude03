// 3D board camera fit (public/js/scene/camfit.js) and the idle step runner of the era prebuild
// (public/js/scene/chunks.js) — pure modules, no three.js / DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLoopBoard } from './client-loopFixture.js';
import { layoutBoard } from '../public/js/scene/layout.js';
import {
  orbitBasis, cameraPosition, projectPoint, fitPoints, viewPoints, viewExtent, overviewView, zoneView, fogRange, ndcBox,
  defaultOrbit, followRadius, isPortrait, coverInset, OVERVIEW_ALIGN, DEFAULT_ORBIT, TV_ORBIT, OVERVIEW_INSET, BASE_FOG, LOOK_Y, CAMERA_FOV,
} from '../public/js/scene/camfit.js';
import { runSteps, stepStats } from '../public/js/scene/chunks.js';
import { rouletteRegion } from '../public/js/scene/math.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const box = (w, d, h = 0) => {
  const pts = [];
  for (const x of [-w / 2, w / 2]) for (const z of [-d / 2, d / 2]) for (const y of [0, h]) pts.push({ x: x + 3, y, z: z - 2 });
  return pts;
};
/** NDC bounds of points seen by a fitted view. */
function ndcBounds(points, view, o) {
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minDepth: Infinity };
  for (const p of points) {
    const q = projectPoint(p, { ...view, azimuth: o.azimuth, polar: o.polar, aspect: o.aspect, fov: o.fov ?? CAMERA_FOV });
    b.minX = Math.min(b.minX, q.x);
    b.maxX = Math.max(b.maxX, q.x);
    b.minY = Math.min(b.minY, q.y);
    b.maxY = Math.max(b.maxY, q.y);
    b.minDepth = Math.min(b.minDepth, q.depth);
  }
  return b;
}
const windowOf = (inset = OVERVIEW_INSET) => ({ left: -1 + 2 * inset.left, right: 1 - 2 * inset.right, bottom: -1 + 2 * inset.bottom, top: 1 - 2 * inset.top });

test('camfit: orbit basis matches three.js lookAt (orthonormal, right = up × back) and the camera sits above the look point', () => {
  for (const az of [-1.15, -0.3, 0, 0.7, 2.5]) {
    for (const pol of [0.28, 0.62, 0.9, 0.95, 1.32]) {
      const { back, right, up } = orbitBasis(az, pol);
      for (const v of [back, right, up]) assert.ok(near(Math.hypot(v.x, v.y, v.z), 1));
      assert.ok(near(dot(back, right), 0) && near(dot(back, up), 0) && near(dot(right, up), 0));
      assert.equal(right.y, 0); // no roll
      assert.ok(up.y > 0, 'up points up');
      assert.ok(near(back.y, Math.cos(pol)));
      // right-handed: right × up = back
      const cx = right.y * up.z - right.z * up.y;
      const cy = right.z * up.x - right.x * up.z;
      const cz = right.x * up.y - right.y * up.x;
      assert.ok(near(cx, back.x) && near(cy, back.y) && near(cz, back.z));
    }
  }
  const c = cameraPosition({ target: { x: 2, z: -3 }, radius: 10, azimuth: 0, polar: Math.PI / 2 - 1e-9 });
  assert.ok(near(c.x, 2) && near(c.y, LOOK_Y, 1e-6) && near(c.z, 7, 1e-6));
  // the look point projects to the screen centre
  const q = projectPoint({ x: 2, y: LOOK_Y, z: -3 }, { target: { x: 2, z: -3 }, radius: 25, azimuth: -0.3, polar: 0.95, aspect: 1.8 });
  assert.ok(near(q.x, 0) && near(q.y, 0) && near(q.depth, 25));
});

test('camfit: fitPoints is the exact tightest fit — every point inside the inset window, the binding axis touching its edges', () => {
  const cases = [
    { pts: box(40, 10, 2), aspect: 1.86 },
    { pts: box(40, 10, 2), aspect: 0.89 },
    { pts: box(8, 30), aspect: 1.6 },
    { pts: box(12, 12, 4), aspect: 1 },
  ];
  for (const { pts, aspect } of cases) {
    for (const [azimuth, polar] of [[-0.3, 0.95], [-1.15, 0.9], [0, 0.62], [1.1, 0.5]]) {
      const o = { azimuth, polar, aspect };
      const v = fitPoints(pts, o);
      const w = windowOf();
      const b = ndcBounds(pts, v, o);
      assert.ok(b.minDepth > 0, 'everything in front of the camera');
      assert.ok(b.minX >= w.left - 1e-9 && b.maxX <= w.right + 1e-9 && b.minY >= w.bottom - 1e-9 && b.maxY <= w.top + 1e-9, JSON.stringify({ b, o }));
      if (v.axis === 'width') assert.ok(near(b.minX, w.left, 1e-6) && near(b.maxX, w.right, 1e-6), JSON.stringify(b));
      else assert.ok(near(b.minY, w.bottom, 1e-6) && near(b.maxY, w.top, 1e-6), JSON.stringify(b));
      // the slack axis is split between both edges by default (perspective: halfway between the two edge-touching
      // camera offsets, not exactly the NDC centre)
      if (v.axis === 'width') assert.ok(b.minY > w.bottom + 1e-6 && b.maxY < w.top - 1e-6, JSON.stringify(b));
      else assert.ok(b.minX > w.left + 1e-6 && b.maxX < w.right - 1e-6, JSON.stringify(b));
      assert.ok(near(v.target.y, 0) && Number.isFinite(v.radius) && v.radius > 0);
      assert.equal(v.hidden, 0);
    }
  }
  // a narrower canvas needs a farther camera for a wide board; more inset → farther too
  const wide = box(60, 20);
  const d = (v, o) => Math.hypot(v.camera.x - 3, v.camera.y, v.camera.z + 2);
  const o1 = { azimuth: -0.3, polar: 0.95, aspect: 1.86 };
  const o2 = { ...o1, aspect: 0.89 };
  assert.ok(d(fitPoints(wide, o2), o2) > d(fitPoints(wide, o1), o1) * 1.5);
  assert.ok(fitPoints(wide, { ...o1, inset: { top: 0.2, bottom: 0.3, left: 0.1, right: 0.1 } }).radius > fitPoints(wide, o1).radius);
  // min / max radius clamps, empty input stays finite
  assert.equal(fitPoints(box(1, 1), { ...o1, minRadius: 30 }).radius, 30);
  assert.equal(fitPoints(wide, { ...o1, maxRadius: 10 }).radius, 10);
  assert.ok(Number.isFinite(fitPoints([], o1).radius));
});

test('camfit: align puts the slack at the requested side; avoid boxes slide the content (never zoom) off screen overlays', () => {
  const pts = box(40, 6); // wide and flat → width binds, vertical slack
  const o = { azimuth: -0.3, polar: 0.95, aspect: 1.86, inset: { top: 0, bottom: 0, left: 0, right: 0 } };
  const w = windowOf(o.inset);
  const lowV = fitPoints(pts, { ...o, align: { y: 0 } });
  const highV = fitPoints(pts, { ...o, align: { y: 1 } });
  const low = ndcBounds(pts, lowV, o);
  const high = ndcBounds(pts, highV, o);
  assert.ok(near(low.minY, w.bottom, 1e-6) && near(high.maxY, w.top, 1e-6));
  assert.ok(low.maxY < w.top - 0.1 && high.minY > w.bottom + 0.1);
  // same distance along the view axis (a slide, not a zoom)
  const { back } = orbitBasis(o.azimuth, o.polar);
  const along = (a, b) => (a.camera.x - b.camera.x) * back.x + (a.camera.y - b.camera.y) * back.y + (a.camera.z - b.camera.z) * back.z;
  assert.ok(near(along(lowV, highV), 0, 1e-6), 'same scale');
  // a box over the top-right corner where the centred content would be → moved down, same scale, nothing hidden
  const centred = fitPoints(pts, o);
  const cb = ndcBounds(pts, centred, o);
  const avoid = [{ x0: 0.6, x1: 1, y0: cb.maxY - 0.05, y1: 1 }];
  const moved = fitPoints(pts, { ...o, avoid });
  const mb = ndcBounds(pts, moved, o);
  assert.equal(moved.hidden, 0);
  assert.ok(mb.maxY < cb.maxY, 'slid down');
  assert.ok(near(along(moved, centred), 0, 1e-6), 'no zoom');
  assert.ok(mb.minY >= w.bottom - 1e-6 && mb.maxX <= w.right + 1e-6 && mb.minX >= w.left - 1e-6, 'still inside');
  // no slack → nothing to do (reported as hidden)
  const tight = fitPoints(box(40, 40), { ...o, aspect: 1, avoid: [{ x0: -1, x1: 1, y0: -1, y1: 1 }] });
  assert.ok(tight.hidden > 0);
  // CSS px → NDC
  assert.deepEqual(ndcBox({ x: 0, y: 0, w: 100, h: 50 }, 200, 100, 0), { x0: -1, x1: 0, y0: 0, y1: 1 });
  assert.equal(ndcBox(null, 10, 10), null);
});

test('camfit: viewPoints covers tiles, lanes, pawns, signs and route labels of the shown era', () => {
  const board = makeLoopBoard({ seed: 5 });
  const L = layoutBoard(board, { eraIndex: 4 }); // young: 81-tile loop + three lanes
  const pts = viewPoints(L);
  const tiles = Object.values(L.tiles);
  assert.ok(pts.length >= tiles.length * 5);
  for (const t of tiles) assert.ok(pts.some((p) => near(p.x, t.x + 1.05, 1e-9) && near(p.z, t.z + 1.05, 1e-9)), `${t.id} footprint`);
  const st = L.tiles[L.startId];
  assert.ok(pts.some((p) => p.y >= 3.8 && near(p.z, st.z, 1e-9)), 'era sign above the start');
  for (const r of Object.values(L.era.routes)) assert.ok(pts.some((p) => p.y >= 2.5 && near(p.z, r.label.z, 1e-9)), 'route label');
  assert.ok(pts.some((p) => p.y >= 2 && p.y < 3), 'pawn + name tag height');
  const e = viewExtent(L, pts);
  for (const p of pts) assert.ok(Math.hypot(p.x - L.era.center.x, p.z - L.era.center.z) <= e + 1e-9);
});

test('camfit: the whole-map view shows every era (81-tile loops with lanes, the final race road) on desktop, phone and TV canvases', () => {
  const canvases = [
    { name: 'desk 1280×720', w: 778, h: 418 },
    { name: 'phone 390×844', w: 390, h: 439 },
    { name: 'phone landscape', w: 778, h: 300 },
    { name: 'tv', w: 1600, h: 900, tv: true },
  ];
  for (const seed of [1, 7]) {
    const board = makeLoopBoard({ seed, turns: seed === 7 ? { young: 18, middle_age: 12 } : {} });
    for (let i = 0; i < board.eras.length; i++) {
      const L = layoutBoard(board, { eraIndex: i });
      const pts = viewPoints(L);
      for (const c of canvases) {
        const o = c.tv ? { ...TV_ORBIT } : (({ azimuth, polar }) => ({ azimuth, polar }))(defaultOrbit(c.w, c.h));
        const aspect = c.w / c.h;
        const v = overviewView(L, { ...o, aspect });
        const b = ndcBounds(pts, v, { ...o, aspect });
        const w = windowOf();
        const tag = `${L.era.id} ${c.name}`;
        assert.ok(b.minDepth > 0, tag);
        assert.ok(b.minX >= w.left - 1e-6 && b.maxX <= w.right + 1e-6 && b.minY >= w.bottom - 1e-6 && b.maxY <= w.top + 1e-6, `${tag} ${JSON.stringify(b)}`);
        // tight: the binding axis reaches its edges (the loop fills the canvas)
        if (v.axis === 'width') assert.ok(b.maxX - b.minX > w.right - w.left - 1e-6, tag);
        else assert.ok(b.maxY - b.minY > w.top - w.bottom - 1e-6, tag);
        assert.ok(v.radius >= 12 && v.radius < 200, `${tag} r=${v.radius}`);
        // the fog starts behind the farthest drawn point → the whole loop stays clear
        const cam = v.camera;
        const far = Math.max(...pts.map((p) => Math.hypot(p.x - cam.x, (p.y ?? 0) - cam.y, p.z - cam.z)));
        const centre = Math.hypot(L.era.center.x - cam.x, cam.y, L.era.center.z - cam.z);
        const fog = fogRange(centre, v.extent);
        assert.ok(fog.near >= far - 1, `${tag} fog ${fog.near} < ${far}`);
        assert.ok(fog.cameraFar > fog.far && fog.far > fog.near);
      }
    }
  }
});

test('camfit: the whole map keeps clear of the idle roulette (top-right) by sliding, or a camera ≤ 20 % farther', () => {
  const board = makeLoopBoard({ seed: 4 });
  for (const [w, h, cover] of [[778, 418, 0.3], [778, 418, 0], [390, 439, 0.05]]) {
    const o = (({ azimuth, polar }) => ({ azimuth, polar }))(defaultOrbit(w, h));
    const aspect = w / h;
    const r = rouletteRegion('idle', w, h);
    const avoid = [ndcBox({ x: r.x, y: r.y, w: r.size, h: r.size }, w, h)];
    const inset = coverInset({ bottom: cover });
    for (let i = 0; i < board.eras.length; i++) {
      const L = layoutBoard(board, { eraIndex: i });
      const plain = overviewView(L, { ...o, aspect, inset });
      const v = overviewView(L, { ...o, aspect, inset, avoid });
      const tag = `${L.era.id} ${w}×${h}`;
      assert.ok(v.hidden <= plain.hidden || plain.hidden === 0, tag);
      // sliding first; a farther camera only up to ×1.2 (×1.5 while the goal would be hidden)
      const slid = fitPoints(viewPoints(L), { ...o, aspect, inset, avoid, align: OVERVIEW_ALIGN, minRadius: 12, maxRadius: 400 });
      assert.ok(near(slid.depth, plain.depth, 1e-6), `${tag}: sliding never zooms`);
      assert.ok(v.depth <= plain.depth * (slid.hiddenKey ? 1.5 : 1.2) + 1e-9, `${tag} ${v.depth} vs ${plain.depth}`);
      assert.equal(v.hiddenKey, 0, `${tag}: the goal under the roulette`);
      const b = ndcBounds(viewPoints(L), v, { ...o, aspect });
      const win = windowOf(inset);
      assert.ok(b.minX >= win.left - 1e-6 && b.maxX <= win.right + 1e-6 && b.minY >= win.bottom - 1e-6 && b.maxY <= win.top + 1e-6, tag);
    }
    // the final race: the goal at the far end is never under the roulette
    const fin = board.eras.length - 1;
    const L = layoutBoard(board, { eraIndex: fin });
    const v = overviewView(L, { ...o, aspect, inset, avoid });
    const goal = L.tiles[L.goalId];
    const q = projectPoint({ x: goal.x, y: 0.3, z: goal.z }, { ...v, ...o, aspect });
    assert.ok(!(q.x > avoid[0].x0 && q.x < avoid[0].x1 && q.y > avoid[0].y0 && q.y < avoid[0].y1), `goal under the roulette at ${w}×${h}`);
  }
});

test('camfit: page overlays covering the canvas shrink the window the loop is fitted into', () => {
  const board = makeLoopBoard({ seed: 2 });
  const L = layoutBoard(board, { eraIndex: 5 });
  const o = { azimuth: -0.3, polar: 0.95, aspect: 778 / 418 };
  const inset = coverInset({ bottom: 0.3 }); // the sticky spin dock over the lower third
  assert.deepEqual(inset, { ...OVERVIEW_INSET, bottom: 0.32 });
  assert.deepEqual(coverInset({ top: 0, bottom: 0 }), OVERVIEW_INSET);
  assert.deepEqual(coverInset({ bottom: 0.05 }), OVERVIEW_INSET); // under the base inset (subtitle pill) anyway
  const v = overviewView(L, { ...o, inset });
  const b = ndcBounds(viewPoints(L), v, o);
  assert.ok(b.minY >= -1 + 2 * inset.bottom - 1e-6, JSON.stringify(b));
  assert.ok(v.radius > overviewView(L, o).radius * 0.9);
});

test('camfit: defaults — orientation picks the orbit, the follow view stays close, base fog for the follow view', () => {
  assert.equal(isPortrait(390, 439), true);
  assert.equal(isPortrait(778, 418), false);
  assert.deepEqual(defaultOrbit(390, 439), { ...DEFAULT_ORBIT.portrait, panX: 0, panZ: 0 });
  assert.deepEqual(defaultOrbit(778, 418), { ...DEFAULT_ORBIT.landscape, panX: 0, panZ: 0 });
  assert.equal(followRadius(778, 418), 17);
  assert.equal(followRadius(390, 439), 19);
  assert.ok(near(followRadius(778, 418, { mine: false }), 17 * 0.68));
  // follow camera: the fog of the old board (55 → 140, far plane 260) for small eras, ≈ the same for the big loops
  assert.deepEqual(fogRange(17, 12), { near: BASE_FOG.near, far: BASE_FOG.far, cameraFar: BASE_FOG.cameraFar });
  const young = layoutBoard(makeLoopBoard({ seed: 3 }), { eraIndex: 4 });
  const f = fogRange(17, viewExtent(young));
  assert.ok(f.near < 60 && f.far < 146, JSON.stringify(f));
  // a zone view (route branch) fits its points with a margin
  const pts = Object.values(young.era.routes.love.tileIds).map((id) => young.tiles[id]);
  const z = zoneView(pts, { azimuth: -0.3, polar: 0.95, aspect: 1.8 });
  const zb = ndcBounds(pts, z, { azimuth: -0.3, polar: 0.95, aspect: 1.8 });
  assert.ok(zb.maxX <= 0.84 + 1e-6 && zb.minX >= -0.84 - 1e-6 && zb.maxY <= 0.76 + 1e-6);
});

test('chunks: idle steps run one per timed-out slice, several per roomy idle slice; flush finishes in order; cancel stops', async () => {
  const queue = [];
  const schedule = (cb) => queue.push(cb);
  let clock = 0;
  const now = () => clock;
  const log = [];
  const steps = ['a', 'b', 'c', 'd', 'e'].map((name) => ({ name, fn: () => { log.push(name); clock += 5; } }));
  const job = runSteps(steps, { schedule, now, sliceMs: 8 });
  assert.equal(queue.length, 1);
  assert.deepEqual(log, []); // nothing runs synchronously
  queue.shift()({ didTimeout: true, timeRemaining: () => 0 }); // a timed-out idle callback → exactly one step
  assert.deepEqual(log, ['a']);
  let left = 20;
  queue.shift()({ didTimeout: false, timeRemaining: () => (left -= 6) }); // 14 > 8 → second step, 8 → stop
  assert.deepEqual(log, ['a', 'b', 'c']);
  assert.equal(job.next, 3);
  assert.equal(job.done, false);
  job.flush(); // the transition arrived: the rest right now, in order
  assert.deepEqual(log, ['a', 'b', 'c', 'd', 'e']);
  assert.equal(job.done, true);
  assert.equal(await job.promise, true);
  queue.shift()?.(null); // a stale slice is a no-op
  assert.equal(log.length, 5);
  assert.deepEqual(job.times.map((t) => t.name), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(stepStats(job.times), { total: 25, max: 5, maxName: 'a', steps: 5 });
  // setTimeout-style scheduler (no deadline) → one step per slice
  const q2 = [];
  const j2 = runSteps(steps.slice(0, 3), { schedule: (cb) => q2.push(cb), now });
  q2.shift()(null);
  assert.equal(j2.next, 1);
  j2.cancel();
  assert.equal(await j2.promise, false);
  q2.shift()?.(null);
  assert.equal(j2.next, 1);
  assert.equal(j2.cancelled, true);
  j2.flush(); // cancelled jobs never resume
  assert.equal(j2.next, 1);
  // empty → done at once; the default scheduler (setTimeout) finishes on its own
  assert.equal(runSteps([]).done, true);
  const ran = [];
  assert.equal(await runSteps([{ name: 'x', fn: () => ran.push(1) }, { name: 'y', fn: () => ran.push(2) }]).promise, true);
  assert.deepEqual(ran, [1, 2]);
});
