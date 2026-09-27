// Pure helpers of the 3D board (public/js/scene/*): layout math, quality presets, roulette angles,
// animation queue ordering (fake clock), pawn part mapping. No WebGL here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { slotOffset } from '../public/js/scene/layout.js';
import { pickQuality, renderSize, shouldFallback, particleCount, QUALITY_PRESETS } from '../public/js/scene/quality.js';
import {
  catmullRom, resample, arcLengths, rouletteRestAngle, rouletteTargetAngle, rouletteValueAt, rouletteRegion, hopHeight,
} from '../public/js/scene/math.js';
import { createAnimator, planSteps } from '../public/js/scene/animator.js';
import { pawnSpecs, resolveAvatar, PAWN_DEFAULT } from '../public/js/scene/pawnParts.js';
import { tempDir } from './helpers.js';
import { vendor, THREE_FILES } from '../scripts/vendor.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
// The loop-map layout (one era per board view) is tested in test/client-loop.test.js.

test('layout: pawn slot offsets are distinct and small', () => {
  assert.deepEqual(slotOffset(0, 1), { x: 0, z: 0 });
  for (const n of [2, 4, 8]) {
    const offs = Array.from({ length: n }, (_, k) => slotOffset(k, n));
    for (const o of offs) assert.ok(Math.hypot(o.x, o.z) <= 0.63);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) assert.ok(dist(offs[i], offs[j]) > 0.3);
  }
});

test('quality presets: param > stored > device heuristic; tv renders at 720p', () => {
  assert.equal(pickQuality({ param: 'tv', stored: 'high' }), 'tv');
  assert.equal(pickQuality({ param: 'bogus', stored: 'low' }), 'low');
  assert.equal(pickQuality({ cores: 8, memory: 8 }), 'high');
  assert.equal(pickQuality({ cores: 4, memory: 4 }), 'low'); // Raspberry Pi 4 class
  assert.equal(pickQuality({ isMobile: true, cores: 6 }), 'low');
  assert.equal(pickQuality({ isMobile: true, cores: 8, memory: 6 }), 'high');
  assert.deepEqual(renderSize('tv', 1920, 1080), { width: 1280, height: 720 });
  assert.deepEqual(renderSize('tv', 800, 450), { width: 800, height: 450 });
  assert.deepEqual(renderSize('low', 1000, 600), { width: 750, height: 450 });
  assert.deepEqual(renderSize('high', 390.4, 400), { width: 390, height: 400 });
  assert.equal(particleCount('tv', 20), 0);
  assert.ok(particleCount('low', 20) < particleCount('high', 20));
  assert.equal(QUALITY_PRESETS.tv.fixedCamera, true);
  assert.equal(QUALITY_PRESETS.tv.controls, false);
  assert.equal(shouldFallback(40, 3000), true); // 13.3 fps
  assert.equal(shouldFallback(60, 3000), false);
});

test('math: roulette stops on the server value after ≥ N turns; curve helpers', () => {
  for (let v = 1; v <= 10; v++) {
    assert.equal(rouletteValueAt(rouletteRestAngle(v)), v);
    for (const start of [0, 1.3, -7, 55.5]) {
      for (const jitter of [-1, 0, 1]) {
        const to = rouletteTargetAngle(start, v, 4, jitter);
        assert.equal(rouletteValueAt(to), v);
        assert.ok(to - start >= 4 * Math.PI * 2 && to - start < 5 * Math.PI * 2 + 1e-9);
      }
    }
  }
  const ctrl = [{ x: 0, z: 0 }, { x: 10, z: 4 }, { x: 20, z: -3 }];
  const poly = catmullRom(ctrl, 8);
  assert.deepEqual(poly[0], { x: 0, z: 0 });
  assert.ok(poly.some((p) => dist(p, ctrl[1]) < 1e-9));
  assert.deepEqual(poly.at(-1), { x: 20, z: -3 });
  const pts = resample(poly, 6);
  const d = pts.slice(1).map((p, i) => dist(pts[i], p));
  assert.ok(Math.max(...d) - Math.min(...d) < 0.3);
  assert.ok(Math.abs(arcLengths(poly).at(-1) - d.reduce((a, b) => a + b, 0)) < 0.5);
  assert.equal(hopHeight(0, 1), 0);
  assert.equal(hopHeight(0.5, 1), 1);
  const idle = rouletteRegion('idle', 1280, 720);
  const act = rouletteRegion('active', 1280, 720);
  assert.ok(act.size > idle.size && act.x + act.size <= 1280 && idle.y >= 0);
  const mob = rouletteRegion('active', 390, 440);
  assert.ok(mob.x >= 0 && mob.x + mob.size <= 390 && mob.y + mob.size <= 440);
});

// ---------- animator (fake clock) ----------
function fakeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map();
  const flush = () => new Promise((r) => setImmediate(r));
  return {
    get now() {
      return now;
    },
    setTimeout(fn, ms) {
      const id = ++seq;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        await flush();
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
        if (!due.length) break;
        const [id, t] = due[0];
        timers.delete(id);
        now = t.at;
        t.fn();
      }
      now = end;
      await flush();
    },
  };
}

test('animator: planSteps keeps engine order and collapses duplicate emotions', () => {
  const steps = planSteps([
    { type: 'turnStarted', charId: 'c1' },
    { type: 'spun', charId: 'c1', value: 3 },
    { type: 'log', text: 'x' },
    { type: 'moved', charId: 'c1', path: ['a', 'b', 'c'] },
    { type: 'landed', charId: 'c1', tileId: 'c', tileType: 'money' },
    { type: 'moneyChanged', charId: 'c1', delta: 50, emotion: 'joy' },
    { type: 'log', text: '+50', charId: 'c1', emotion: 'joy' },
    { type: 'prompt', promptId: 'p1' },
    { type: 'eraChanged', charId: 'c1', era: 'elem', eraName: '초등학생', emotion: 'joy' },
  ]);
  assert.deepEqual(steps.map((s) => s.kind), ['turnStarted', 'spun', 'moved', 'landed', 'moneyChanged', 'emotion', 'eraChanged', 'emotion']);
});

test('animator: plays steps sequentially, appends mid-animation, fires idle once drained', async () => {
  const clock = fakeClock();
  const log = [];
  const handlers = {
    spun: async (e, ctx) => {
      log.push(`spun+${clock.now}`);
      await ctx.sleep(2000);
      log.push(`spun-${clock.now}`);
    },
    moved: async (e, ctx) => {
      log.push(`moved+${clock.now}`);
      for (const _ of e.path) await ctx.sleep(300);
      log.push(`moved-${clock.now}`);
    },
    landed: (e) => log.push(`landed@${clock.now}:${e.tileId}`), // fire-and-forget
    moneyChanged: (e, ctx) => ctx.sleep(100),
  };
  const anim = createAnimator({ handlers, clock });
  let idle = 0;
  anim.onIdle(() => idle++);
  anim.push([
    { type: 'spun', charId: 'c1', value: 2 },
    { type: 'moved', charId: 'c1', path: ['a', 'b'] },
    { type: 'landed', charId: 'c1', tileId: 'b' },
  ]);
  assert.equal(anim.busy(), true);
  await clock.advance(1000);
  // a new state/events batch arrives while the roulette still spins → queued behind
  const done = anim.push([
    { type: 'spun', charId: 'c2', value: 1 },
    { type: 'moved', charId: 'c2', path: ['x'] },
    { type: 'landed', charId: 'c2', tileId: 'x' },
  ]);
  await clock.advance(1600);
  assert.deepEqual(log, ['spun+0', 'spun-2000', 'moved+2000', 'moved-2600', 'landed@2600:b', 'spun+2600']);
  assert.equal(idle, 0);
  await clock.advance(5000);
  await done;
  assert.deepEqual(log.slice(6), ['spun-4600', 'moved+4600', 'moved-4900', 'landed@4900:x']);
  assert.equal(idle, 1);
  assert.equal(anim.busy(), false);
});

test('animator: pause/resume between steps, custom steps, stuck-step timeout, instant when hidden', async () => {
  const clock = fakeClock();
  const seen = [];
  let hidden = false;
  const anim = createAnimator({
    clock,
    maxStepMs: 5000,
    isHidden: () => hidden,
    handlers: {
      spun: async (e, ctx) => {
        seen.push(`spun:${ctx.instant}`);
        if (!ctx.instant) await ctx.sleep(1000);
      },
      landed: () => new Promise(() => {}), // never resolves → abandoned after maxStepMs
      finished: () => seen.push('finished'),
    },
  });
  anim.push([{ type: 'spun', charId: 'c1', value: 1 }]);
  anim.pause();
  anim.enqueue(async (e, ctx) => {
    seen.push('cutin');
    await ctx.sleep(500);
  });
  await clock.advance(3000);
  assert.deepEqual(seen, ['spun:false']); // paused after the current step
  assert.equal(anim.busy(), true);
  anim.resume();
  await clock.advance(600);
  assert.deepEqual(seen, ['spun:false', 'cutin']);
  anim.push([{ type: 'landed', charId: 'c1', tileId: 't' }, { type: 'finished', charId: 'c1', place: 1 }]);
  await clock.advance(4000);
  assert.deepEqual(seen, ['spun:false', 'cutin']);
  await clock.advance(1500);
  assert.deepEqual(seen, ['spun:false', 'cutin', 'finished']);
  hidden = true;
  anim.push([{ type: 'spun', charId: 'c1', value: 4 }]);
  await clock.advance(1);
  assert.equal(seen.at(-1), 'spun:true');
  assert.equal(anim.busy(), false);
  await anim.whenIdle();
});

test('pawn parts: every avatar option maps to primitives with the avatar colors', () => {
  const defs = JSON.parse(fs.readFileSync(new URL('../server/data/avatars.json', import.meta.url)));
  const SHAPES = new Set(['sphere', 'cyl', 'box', 'cone', 'torus']);
  for (const part of defs.order) {
    for (const opt of defs.parts[part]) {
      const avatar = { ...defs.default, [part]: opt.id };
      const specs = pawnSpecs(avatar, defs);
      assert.ok(specs.length >= 12 && specs.length < 60, `${part}=${opt.id}: ${specs.length}`);
      for (const s of specs) {
        assert.ok(SHAPES.has(s.shape));
        assert.match(s.color, /^#[0-9a-f]{6}$/i);
        assert.equal(s.pos.length, 3);
      }
      if (opt.color) assert.ok(specs.some((s) => s.color.toLowerCase() === opt.color.toLowerCase()), `${part}=${opt.id} color unused`);
    }
  }
  const r = resolveAvatar({ hair: 'mohawk', skin: 'tan' }, defs);
  assert.equal(r.avatar.hair, defs.default.hair);
  assert.equal(r.colors.skin, '#dca77e');
  assert.deepEqual(resolveAvatar(null).avatar, PAWN_DEFAULT);
});

test('vendor script copies three.js browser builds', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const n = vendor({ out: dir, log: () => {} });
    assert.ok(n >= THREE_FILES.length - 1);
    for (const f of ['three/three.module.js', 'three/three.core.js', 'three/addons/loaders/GLTFLoader.js', 'three/addons/utils/BufferGeometryUtils.js']) {
      assert.ok(fs.existsSync(path.join(dir, f)), f);
    }
  } finally {
    await cleanup();
  }
});
