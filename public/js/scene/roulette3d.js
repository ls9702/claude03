// Big roulette overlay (original-game style): 10 colored numbered segments, a pull-ball at the bottom,
// eased spin that stops on the server-provided value, then a number pop (DOM, drawn by board3d).
// Rendered by the board's renderer into a scissored viewport (one WebGL context, ~6 draw calls).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { colored, mat4 as M } from './geo.js';
import { FONT_STACK, canvasTexture } from './sprites.js';
import { ROULETTE_SEGMENTS, rouletteTargetAngle, rouletteRestAngle, easeOutCubic, easeOutBack, clamp } from './math.js';

export const ROULETTE_COLORS = ['#ef4444', '#f97316', '#facc15', '#22c55e', '#14b8a6', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#f59e0b'];

function faceTexture() {
  const N = 512;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d');
  const cx = N / 2;
  const R = N / 2 - 2;
  const seg = (Math.PI * 2) / ROULETTE_SEGMENTS;
  // Segment v covers local angles [π/2 − v·seg, π/2 − (v−1)·seg] (world CCW, y up) → canvas angle = −a.
  for (let v = 1; v <= ROULETTE_SEGMENTS; v++) {
    const a1 = Math.PI / 2 - v * seg;
    const a2 = Math.PI / 2 - (v - 1) * seg;
    ctx.beginPath();
    ctx.moveTo(cx, cx);
    ctx.arc(cx, cx, R, -a2, -a1);
    ctx.closePath();
    ctx.fillStyle = ROULETTE_COLORS[v - 1];
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.stroke();
    const am = (a1 + a2) / 2;
    ctx.save();
    ctx.translate(cx + Math.cos(am) * R * 0.7, cx - Math.sin(am) * R * 0.7);
    ctx.rotate(Math.PI / 2 - am);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 8;
    ctx.font = `900 ${Math.round(N * 0.13)}px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeText(String(v), 0, 0);
    ctx.fillText(String(v), 0, 0);
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(cx, cx, R * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = '#fff6e0';
  ctx.fill();
  return canvasTexture(c);
}

export function createRoulette3D() {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8888aa, 2.0));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(2, 3, 6);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, -0.18, 8.6);
  camera.lookAt(0, -0.18, 0);

  const vc = new THREE.MeshLambertMaterial({ vertexColors: true });
  const backdrop = new THREE.Mesh(new THREE.CircleGeometry(2.3, 40), new THREE.MeshBasicMaterial({ color: 0x2d2a32, transparent: true, opacity: 0.5, depthWrite: false }));
  backdrop.position.set(0, -0.18, -0.4);
  scene.add(backdrop);

  const wheel = new THREE.Group();
  scene.add(wheel);
  const seg = (Math.PI * 2) / ROULETTE_SEGMENTS;
  const rimParts = [colored(new THREE.CylinderGeometry(1.62, 1.62, 0.24, 40), '#fff1cc', M(0, 0, 0, Math.PI / 2))];
  for (let i = 0; i < ROULETTE_SEGMENTS; i++) {
    const a = Math.PI / 2 - i * seg;
    rimParts.push(colored(new THREE.SphereGeometry(0.06, 6, 4), '#e0a91a', M(Math.cos(a) * 1.52, Math.sin(a) * 1.52, 0.16)));
  }
  rimParts.push(colored(new THREE.SphereGeometry(0.2, 10, 6), '#e0a91a', M(0, 0, 0.14)));
  wheel.add(new THREE.Mesh(mergeGeometries(rimParts), vc));
  const face = new THREE.Mesh(new THREE.CircleGeometry(1.5, 40), new THREE.MeshBasicMaterial({ map: faceTexture() }));
  face.position.z = 0.125;
  wheel.add(face);

  const frame = new THREE.Mesh(
    mergeGeometries([
      colored(new THREE.TorusGeometry(1.66, 0.08, 6, 40), '#e0a91a', M(0, 0, 0.06)),
      colored(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 5), '#5a4032', M(0, -1.78, 0.2)),
    ]),
    vc,
  );
  scene.add(frame);
  const pointer = new THREE.Mesh(colored(new THREE.ConeGeometry(0.2, 0.5, 3), '#e2504c', M(0, 0, 0, 0, 0, Math.PI)), vc);
  pointer.position.set(0, 1.8, 0.3);
  scene.add(pointer);
  const ball = new THREE.Mesh(
    mergeGeometries([
      colored(new THREE.SphereGeometry(0.2, 12, 8), '#e2504c', M(0, 0, 0)),
      colored(new THREE.SphereGeometry(0.07, 6, 4), '#ffffff', M(-0.07, 0.08, 0.15)),
    ]),
    vc,
  );
  const BALL_Y = -2.05;
  ball.position.set(0, BALL_Y, 0.2);
  scene.add(ball);

  let angle = rouletteRestAngle(1);
  wheel.rotation.z = angle;
  let anim = null; // { t, from, to, dur, pull, resolve }
  let idleT = 0;

  function finish() {
    if (!anim) return;
    angle = anim.to;
    wheel.rotation.z = angle;
    ball.position.y = BALL_Y;
    pointer.rotation.z = 0;
    const r = anim.resolve;
    anim = null;
    r();
  }

  return {
    scene,
    camera,
    get spinning() {
      return !!anim;
    },
    /** Spin to `value`; resolves when the wheel stops (immediately when instant). */
    spin(value, { instant = false, duration = 2.6, turns = 4 } = {}) {
      if (anim) finish();
      const to = rouletteTargetAngle(angle, value, turns, Math.random() * 2 - 1);
      if (instant) {
        angle = to;
        wheel.rotation.z = angle;
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        anim = { t: 0, from: angle, to, dur: duration, pull: 0.32, resolve };
        setTimeout(() => anim?.resolve === resolve && finish(), (duration + 0.32 + 1.5) * 1000);
      });
    },
    update(dt) {
      if (!anim) {
        idleT += dt;
        ball.position.y = BALL_Y - Math.max(0, Math.sin(idleT * 2.4)) * 0.06;
        return;
      }
      anim.t += dt;
      const t = anim.t;
      if (t < anim.pull) {
        ball.position.y = BALL_Y - (t / anim.pull) * 0.4;
        return;
      }
      const k = clamp((t - anim.pull) / anim.dur, 0, 1);
      ball.position.y = BALL_Y - 0.4 * (1 - easeOutBack(clamp((t - anim.pull) / 0.35, 0, 1)));
      angle = anim.from + (anim.to - anim.from) * easeOutCubic(k);
      wheel.rotation.z = angle;
      // pointer flick when a peg passes
      const frac = (((angle % seg) + seg) % seg) / seg;
      const speed = 1 - k;
      pointer.rotation.z = frac < 0.2 ? (0.2 - frac) * 2.2 * speed : 0;
      if (k >= 1) finish();
    },
    dispose() {
      scene.traverse((o) => {
        o.geometry?.dispose();
        o.material?.map?.dispose();
        o.material?.dispose();
      });
    },
  };
}
