// Stage 9 — 3D 시상대 (result screen): a tiny separate Three.js scene that reuses the board's pawn builder.
// 1st / 2nd / 3rd pawns stand on a 3-step podium (ties share a step), everyone else in a half circle in front;
// confetti bursts + a slow camera orbit. Budget: ≤ 30 draw calls (floor 1 + podium 1 + pawns ≤ 8 + tags ≤ 8 +
// step numbers 3 + confetti ≤ 3), pixelRatio 1, no AA / shadows, Hemisphere + 1 Directional, Lambert + vertex colors.
//
//   const pd = createPodium3D(canvas, { defs, entries: [{char, step: 1|2|3|0, crown?}] });
//   pd.celebrate(); pd.setCrown(charId); pd.snapshot() → 2D canvas copy; pd.stats(); pd.dispose();
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildPawnGeometry } from './pawn.js';
import { makeTextSprite, disposeSprite } from './sprites.js';
import { createParticles } from './particles.js';
import { podiumSlots } from './podiumLayout.js';

const STEP = {
  1: { h: 1.5, color: '#f4c542', x: 0 },
  2: { h: 1.05, color: '#c9d1dc', x: -2.3 },
  3: { h: 0.75, color: '#d08a4f', x: 2.3 },
};
const PAWN_SCALE = 0.9;

function coloredBox(w, h, d, color, x, y, z) {
  let g = new THREE.BoxGeometry(w, h, d);
  g = g.toNonIndexed();
  g.deleteAttribute('uv');
  g.translate(x, y, z);
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{defs?: object, entries: {char: object, step: number, crown?: boolean}[], reducedMotion?: boolean}} opts
 */
export function createPodium3D(canvas, { defs = null, entries = [], reducedMotion = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'default', preserveDrawingBuffer: false });
  renderer.setPixelRatio(1);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#3b2d6e');
  scene.add(new THREE.HemisphereLight(0xfff6e8, 0x5a4a8a, 2.3));
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.4);
  sun.position.set(3, 8, 6);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 80);

  const lambert = new THREE.MeshLambertMaterial({ vertexColors: true });
  const disposables = [lambert];
  // floor (stage disc + a lighter spot)
  const floorGeo = mergeGeometries([coloredBox(22, 0.2, 14, '#5a4596', 0, -0.1, 1.5), coloredBox(9, 0.02, 5, '#6d58b0', 0, 0.01, 0.5)], false);
  const floor = new THREE.Mesh(floorGeo, lambert);
  scene.add(floor);
  disposables.push(floorGeo);
  // podium: 3 boxes + a white top trim each = one merged mesh
  const parts = [];
  for (const [place, s] of Object.entries(STEP)) {
    parts.push(coloredBox(2.2, s.h, 2, s.color, s.x, s.h / 2, 0));
    parts.push(coloredBox(2.26, 0.08, 2.06, '#ffffff', s.x, s.h + 0.02, 0));
    void place;
  }
  const podiumGeo = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  const podium = new THREE.Mesh(podiumGeo, lambert);
  scene.add(podium);
  disposables.push(podiumGeo);
  // step numbers
  const numbers = Object.entries(STEP).map(([place, s]) => {
    const sp = makeTextSprite(place, { height: 0.62, size: 60, weight: 900, color: '#3b2d6e', bg: 'rgba(255,255,255,0.0)', pad: 4, depthTest: true, renderOrder: 5 });
    sp.position.set(s.x, s.h * 0.5, 1.05);
    scene.add(sp);
    return sp;
  });

  // pawns
  const slots = podiumSlots(entries.map((e) => e.step));
  const pawns = entries.map((e, i) => {
    const slot = slots[i];
    const base = new THREE.Group();
    const holder = new THREE.Group();
    holder.scale.setScalar(PAWN_SCALE);
    base.add(holder);
    const mesh = new THREE.Mesh(buildPawnGeometry(e.char?.avatar ?? {}, defs), lambert);
    holder.add(mesh);
    const y = slot.step ? STEP[slot.step].h + 0.06 : 0;
    base.position.set(slot.x, y, slot.z);
    base.rotation.y = slot.face;
    const tag = makeTextSprite(`${e.crown ? '👑 ' : ''}${e.char?.name ?? ''}`, { height: 0.4, size: 38, color: e.char?.isMe ? '#ffffff' : '#2d2a32', bg: e.char?.isMe ? 'rgba(255,122,47,0.95)' : 'rgba(255,255,255,0.92)', pad: 12, renderOrder: 15 });
    tag.position.set(0, 1.6 * PAWN_SCALE + 0.36, 0);
    base.add(tag);
    scene.add(base);
    return { entry: e, slot, base, holder, tag, phase: i * 0.7 };
  });

  const particles = createParticles(scene);
  const S = { t: 0, last: performance.now(), raf: 0, disposed: false, burstAt: 0, bursts: 0, frames: 0, stats: { calls: 0, triangles: 0 } };

  function size() {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    if (canvas.width !== w || canvas.height !== h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }

  function burst(n = 70) {
    for (const place of [1, 2, 3]) {
      if (!pawns.some((p) => p.slot.step === place)) continue;
      particles.burst('confetti', { x: STEP[place].x, y: STEP[place].h + 1.2, z: 0 }, place === 1 ? n : Math.round(n * 0.5), { up: 5, spread: 2.6, life: 1.4, size: 0.34 });
    }
  }

  function place(t) {
    // slow orbit (±25°) around the podium, a little closer on narrow screens
    const narrow = camera.aspect < 1.1;
    const a = reducedMotion ? 0 : Math.sin(t * 0.22) * 0.44;
    const r = narrow ? 14 : 11.5;
    camera.position.set(Math.sin(a) * r, narrow ? 4.6 : 4.1, Math.cos(a) * r);
    camera.lookAt(0, narrow ? 1.6 : 1.45, 0);
  }

  function frame(now) {
    S.raf = requestAnimationFrame(frame);
    if (S.disposed || !canvas.isConnected || canvas.clientWidth === 0) return;
    const dt = Math.min(0.05, (now - S.last) / 1000);
    S.last = now;
    S.t += dt;
    size();
    place(S.t);
    for (const p of pawns) {
      const k = S.t * (p.slot.step === 1 ? 3.2 : 2.2) + p.phase;
      const hop = reducedMotion ? 0 : Math.max(0, Math.sin(k)) * (p.slot.step === 1 ? 0.32 : p.slot.step ? 0.14 : 0.06);
      p.holder.position.y = hop;
      p.holder.scale.set(PAWN_SCALE * (1 + hop * 0.12), PAWN_SCALE * (1 - hop * 0.08), PAWN_SCALE * (1 + hop * 0.12));
    }
    if (!reducedMotion && S.bursts < 5 && S.t - S.burstAt > 2.6) {
      S.burstAt = S.t;
      S.bursts++;
      burst(S.bursts === 1 ? 90 : 50);
    }
    particles.update(dt);
    renderer.render(scene, camera);
    S.stats = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    S.frames++;
  }
  size();
  place(0);
  S.raf = requestAnimationFrame(frame);

  return {
    canvas,
    /** Confetti again + restart the orbit. */
    celebrate() {
      S.bursts = 0;
      S.burstAt = S.t - 10;
    },
    /** Put 👑 on one character's name tag (MVP). */
    setCrown(charId) {
      for (const p of pawns) {
        const crown = p.entry.char?.id === charId;
        if (!!p.entry.crown === crown) continue;
        p.entry.crown = crown;
        p.base.remove(p.tag);
        disposeSprite(p.tag);
        p.tag = makeTextSprite(`${crown ? '👑 ' : ''}${p.entry.char?.name ?? ''}`, { height: 0.4, size: 38, color: p.entry.char?.isMe ? '#ffffff' : '#2d2a32', bg: crown ? 'rgba(255,210,63,0.97)' : p.entry.char?.isMe ? 'rgba(255,122,47,0.95)' : 'rgba(255,255,255,0.92)', pad: 12, renderOrder: 15 });
        p.tag.position.set(0, 1.6 * PAWN_SCALE + 0.36, 0);
        p.base.add(p.tag);
      }
    },
    /** A 2D copy of the current view (rendered now, so no preserveDrawingBuffer is needed). */
    snapshot(width = 1600, height = 900) {
      if (S.disposed) return null;
      const prev = { w: canvas.width, h: canvas.height, aspect: camera.aspect };
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      place(S.t);
      renderer.render(scene, camera);
      const out = document.createElement('canvas');
      out.width = width;
      out.height = height;
      out.getContext('2d').drawImage(canvas, 0, 0, width, height);
      renderer.setSize(prev.w, prev.h, false);
      camera.aspect = prev.aspect;
      camera.updateProjectionMatrix();
      return out;
    },
    stats: () => ({ ...S.stats, frames: S.frames, pawns: pawns.length, bursts: particles.count }),
    dispose() {
      if (S.disposed) return;
      S.disposed = true;
      cancelAnimationFrame(S.raf);
      particles.clear();
      for (const p of pawns) disposeSprite(p.tag);
      for (const n of numbers) disposeSprite(n);
      for (const d of disposables) d.dispose();
      renderer.dispose();
    },
  };
}
