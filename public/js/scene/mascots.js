// 3D MC dog mascots (Stage 5.6): 호야 & 봄이 sit beside the track at the start of the current era.
// Per dog 3 merged vertex-coloured meshes (body / head / tail = 3 draw calls, ≤ 1.5k triangles), idle tail wag +
// breathing, `react('hop'|'spin')` on big events, `look(ms)` turns the heads to the camera (emoji reactions).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MASCOT_IDS, MASCOT_PIVOTS, mascotSpecs } from './mascotParts.js';

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpC = new THREE.Color();
const tmpV = new THREE.Vector3();

function primitive(s) {
  const a = s.args;
  switch (s.shape) {
    case 'sphere':
      return new THREE.SphereGeometry(...a);
    case 'cyl':
      return new THREE.CylinderGeometry(...a);
    case 'cone':
      return new THREE.ConeGeometry(...a);
    default:
      return new THREE.BoxGeometry(...a);
  }
}

/** Merged geometry of a spec list (position/normal/color, non-indexed). */
export function buildSpecGeometry(specs) {
  const parts = specs.map((s) => {
    let g = primitive(s);
    if (g.index) {
      const n = g.toNonIndexed();
      g.dispose();
      g = n;
    }
    g.deleteAttribute('uv');
    tmpE.set(...(s.rot ?? [0, 0, 0]));
    tmpQ.setFromEuler(tmpE);
    tmpM.compose(new THREE.Vector3(...s.pos), tmpQ, new THREE.Vector3(...(s.scale ?? [1, 1, 1])));
    g.applyMatrix4(tmpM);
    tmpC.set(s.color);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([tmpC.r, tmpC.g, tmpC.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  });
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  merged.computeBoundingSphere();
  return merged;
}

/** Geometries of one dog: {body, head, tail} (+ triangle count). */
export function buildMascotGeometry(id) {
  const specs = mascotSpecs(id);
  const out = { body: buildSpecGeometry(specs.body), head: buildSpecGeometry(specs.head), tail: buildSpecGeometry(specs.tail) };
  out.triangles = (out.body.attributes.position.count + out.head.attributes.position.count + out.tail.attributes.position.count) / 3;
  return out;
}

/**
 * @param {THREE.Scene} scene
 * @param {{material?: THREE.Material}} opts
 */
export function createMascots(scene, { material = new THREE.MeshLambertMaterial({ vertexColors: true }) } = {}) {
  const group = new THREE.Group();
  group.name = 'mc-mascots';
  group.visible = false;
  scene.add(group);
  const dogs = MASCOT_IDS.map((id, i) => {
    const geo = buildMascotGeometry(id);
    const root = new THREE.Group();
    root.position.x = i === 0 ? -0.5 : 0.5;
    root.rotation.y = i === 0 ? 0.18 : -0.18; // slightly towards each other
    const body = new THREE.Mesh(geo.body, material);
    const head = new THREE.Group();
    head.position.set(...MASCOT_PIVOTS.head);
    head.add(new THREE.Mesh(geo.head, material));
    const tail = new THREE.Group();
    tail.position.set(...MASCOT_PIVOTS.tail);
    tail.add(new THREE.Mesh(geo.tail, material));
    const hop = new THREE.Group(); // jump/spin offset
    hop.add(body, head, tail);
    root.add(hop);
    group.add(root);
    return { id, geo, root, hop, body, head, tail, baseYaw: root.rotation.y, jump: null, phase: i * 1.7 };
  });
  const S = { target: new THREE.Vector3(), yaw: 0, travel: null, lookUntil: 0, time: 0, placed: false };

  function startJump(d, kind, delay = 0) {
    d.jump = { t: -delay, dur: kind === 'spin' ? 0.9 : 0.55, kind, h: kind === 'spin' ? 0.75 : 0.45 };
  }

  const api = {
    group,
    dogs,
    get triangles() {
      return dogs.reduce((n, d) => n + d.geo.triangles, 0);
    },
    setVisible(v) {
      group.visible = !!v && S.placed;
      S.wantVisible = !!v;
    },
    /** Sit at (x, z) facing `yaw`; far moves hop over there (snap = teleport). */
    setTarget(x, z, yaw, snap = false) {
      const far = group.position.distanceTo(tmpV.set(x, 0, z));
      S.target.set(x, 0, z);
      S.yaw = yaw;
      if (snap || !S.placed) {
        group.position.copy(S.target);
        group.rotation.y = yaw;
        S.placed = true;
        group.visible = !!S.wantVisible;
        return;
      }
      if (far > 0.05) S.travel = { from: group.position.clone(), t: 0, dur: Math.min(1.6, 0.5 + far * 0.04) };
    },
    /** Big-event reaction: 'hop' (both hop) or 'spin' (jump + full turn, staggered). */
    react(kind = 'hop') {
      dogs.forEach((d, i) => startJump(d, kind, i * 0.12));
    },
    /** Turn the heads to the camera for `ms`. */
    look(ms = 2200) {
      S.lookUntil = S.time + ms / 1000;
    },
    update(dt, t, camera) {
      S.time = t;
      if (!group.visible) return;
      if (S.travel) {
        const tr = S.travel;
        tr.t += dt;
        const k = Math.min(1, tr.t / tr.dur);
        group.position.lerpVectors(tr.from, S.target, k);
        group.position.y = Math.sin(k * Math.PI) * 0.8;
        if (k >= 1) S.travel = null;
      }
      let dy = S.yaw - group.rotation.y;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      group.rotation.y += dy * (1 - Math.exp(-dt * 4));
      const looking = t < S.lookUntil && camera;
      for (const d of dogs) {
        const hoya = d.id === 'hoya';
        d.tail.rotation.z = Math.sin(t * (hoya ? 11 : 6.5) + d.phase) * (hoya ? 0.55 : 0.35);
        d.tail.rotation.x = -0.35;
        const br = 1 + Math.sin(t * 2.3 + d.phase) * 0.02;
        d.body.scale.set(br, 2 - br, br);
        if (d.jump) {
          const j = d.jump;
          j.t += dt;
          const k = Math.max(0, j.t / j.dur);
          if (k >= 1) {
            d.jump = null;
            d.hop.position.y = 0;
            d.hop.rotation.y = 0;
          } else {
            d.hop.position.y = Math.sin(k * Math.PI) * j.h;
            d.hop.rotation.y = j.kind === 'spin' ? k * Math.PI * 2 : 0;
          }
        }
        // head: idle sway, or look at the camera
        let yaw = Math.sin(t * 0.7 + d.phase) * 0.25;
        let pitch = 0;
        if (looking) {
          d.head.getWorldPosition(tmpV);
          const to = camera.position.clone().sub(tmpV);
          const inv = new THREE.Quaternion();
          d.hop.getWorldQuaternion(inv).invert();
          to.applyQuaternion(inv);
          yaw = Math.max(-1.2, Math.min(1.2, Math.atan2(to.x, to.z)));
          pitch = -Math.max(-0.5, Math.min(0.5, Math.atan2(to.y, Math.hypot(to.x, to.z)))) * 0.6;
        }
        d.head.rotation.y += (yaw - d.head.rotation.y) * (1 - Math.exp(-dt * (looking ? 8 : 2)));
        d.head.rotation.x += (pitch - d.head.rotation.x) * (1 - Math.exp(-dt * 6));
        d.head.rotation.z = hoya ? Math.sin(t * 1.3 + d.phase) * 0.08 : 0.04;
      }
    },
    dispose() {
      for (const d of dogs) {
        d.geo.body.dispose();
        d.geo.head.dispose();
        d.geo.tail.dispose();
      }
      group.removeFromParent();
    },
  };
  return api;
}
