// Lobby 3D preview: the same Chiikawa-style pawn the board uses (CH-1), slowly turning with idle breathing, a squashy
// pop when the look changes and optional `play('hop' | 'cheer')`. One small WebGL canvas.
import * as THREE from 'three';
import { buildPawnGeometry } from './pawn.js';
import { pawnLook } from './pawnParts.js';
import { hopPose, landPose, breathePose } from './math.js';

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const BASE_R = 0.8; // the round stand under the pawn
const BASE_Y = -0.04;

/**
 * Camera framing of the turning preview pawn (pure, node-tested). The canvas is a CIRCLE (border-radius 50%) and the pawn
 * turns about its y axis, so every vertex is fitted by its distance from the view centre: √(distance from the y axis² +
 * (y − centre)²) — wide back items (wings) and long hand items (fishing rod, balloon, sasumata) stay inside the circle.
 * @param {ArrayLike<number>} positions  xyz triples (the merged pawn geometry)
 * @returns {{target: number[], position: number[], radius: number}}
 */
export function previewFrame(positions, { fov = 30, margin = 1.1, elev = 0.12 } = {}) {
  let minY = BASE_Y - 0.04;
  let maxY = 1.2;
  for (let i = 1; i < positions.length; i += 3) {
    if (positions[i] < minY) minY = positions[i];
    if (positions[i] > maxY) maxY = positions[i];
  }
  const cy = (minY + maxY) / 2;
  let r = Math.hypot(BASE_R, cy - BASE_Y);
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const d = Math.hypot(Math.hypot(positions[i], positions[i + 2]), positions[i + 1] - cy);
    if (d > r) r = d;
  }
  const dist = (r * margin) / Math.tan((fov * Math.PI) / 360);
  return { target: [0, cy, 0], position: [0, cy + dist * Math.sin(elev), dist * Math.cos(elev)], radius: r };
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ meta?: object, defs?: object, size?: number }} opts  meta = `/api/meta` (roster / props; wins over `defs`, which
 *   may also be `/api/meta` or the old avatars defs → inline fallbacks)
 * @returns {{ set(look): void, play(action?: 'hop'|'cheer'): void, dispose(): void }}
 */
export function createPawnPreview(canvas, { defs: defsOpt = null, meta = null, size = 140 } = {}) {
  const defs = meta ?? defsOpt;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(size, size, false);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9a8a70, 2.2));
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.6);
  sun.position.set(2, 4, 3);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(BASE_R - 0.05, BASE_R, 0.08, 28), new THREE.MeshLambertMaterial({ color: 0xffd9b8 }));
  base.position.y = BASE_Y;
  scene.add(base);
  const holder = new THREE.Group(); // squash / hop pivot at the feet
  scene.add(holder);
  const still = reducedMotion();
  let mesh = null;
  let raf = 0;
  let t0 = performance.now();
  let action = null; // {kind, t0}
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    if (!canvas.isConnected) return;
    const t = (now - t0) / 1000;
    if (mesh) holder.rotation.y = still ? 0.35 : Math.sin(t / 1.4) * 0.9;
    let pose = still ? { y: 0, sy: 1, sxz: 1 } : breathePose(now / 1000);
    if (action && !still) {
      const k = (now - action.t0) / 1000;
      if (action.kind === 'pop') pose = k < 0.32 ? landPose(k / 0.32) : pose;
      else if (action.kind === 'hop') pose = k < 0.45 ? hopPose(k / 0.45, 0.45) : k < 0.75 ? landPose((k - 0.45) / 0.3) : pose;
      else if (action.kind === 'cheer') {
        const n = Math.floor(k / 0.36);
        pose = n < 3 ? hopPose((k % 0.36) / 0.36, 0.3) : k < 1.36 ? landPose((k - 1.08) / 0.28) : pose;
      }
      if (k > 1.6) action = null;
    }
    holder.position.y = pose.y;
    holder.scale.set(pose.sxz, pose.sy, pose.sxz);
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);
  /** Frame the whole figure incl. hats, long ears, wings and long hand items (see previewFrame). */
  const frameCamera = (geo) => {
    const f = previewFrame(geo?.attributes?.position?.array ?? []);
    camera.position.set(...f.position);
    camera.lookAt(...f.target);
  };
  frameCamera(null);
  return {
    set(avatar) {
      const look = pawnLook(avatar, defs);
      const geo = buildPawnGeometry(look, defs);
      if (!mesh) {
        mesh = new THREE.Mesh(geo, material);
        holder.add(mesh);
      } else {
        mesh.geometry = geo; // geometries are cached per look (shared with the board)
        action = { kind: 'pop', t0: performance.now() };
      }
      frameCamera(geo);
      t0 = performance.now();
    },
    /** A cosmetic little hop ('hop') or three happy bounces ('cheer'). */
    play(kind = 'hop') {
      action = { kind: kind === 'cheer' ? 'cheer' : 'hop', t0: performance.now() };
    },
    dispose() {
      cancelAnimationFrame(raf);
      base.geometry.dispose();
      base.material.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss(); // free the context right away (the customizer opens often)
    },
  };
}
