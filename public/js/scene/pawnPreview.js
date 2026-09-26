// Lobby 3D preview: the same low-poly pawn the board uses, slowly turning (one small WebGL canvas).
import * as THREE from 'three';
import { buildPawnGeometry } from './pawn.js';

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ defs?: object, size?: number }} opts
 * @returns {{ set(avatar): void, dispose(): void }}
 */
export function createPawnPreview(canvas, { defs = null, size = 140 } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(size, size, false);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9a8a70, 2.2));
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.6);
  sun.position.set(2, 4, 3);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  camera.position.set(0, 1.3, 4.7);
  camera.lookAt(0, 0.78, 0);
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.8, 0.08, 28), new THREE.MeshLambertMaterial({ color: 0xffd9b8 }));
  base.position.y = -0.04;
  scene.add(base);
  let mesh = null;
  let raf = 0;
  let t0 = performance.now();
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    if (!canvas.isConnected) return;
    if (mesh) mesh.rotation.y = Math.sin((now - t0) / 1400) * 0.9;
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);
  return {
    set(avatar) {
      const geo = buildPawnGeometry(avatar, defs);
      if (!mesh) {
        mesh = new THREE.Mesh(geo, material);
        scene.add(mesh);
      } else {
        mesh.geometry = geo; // geometries are cached per avatar (shared with the board)
      }
      t0 = performance.now();
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
