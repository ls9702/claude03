// Low-poly pawn from avatar parts (one merged vertex-colored mesh = 1 draw call) + name tag.
// Optional drop-in: when /api/models lists `pawn.glb`, GLTFLoader loads it once and each pawn clones
// it, tinting materials named *skin* / *hair* / *outfit* with the avatar colors.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { pawnSpecs, resolveAvatar } from './pawnParts.js';
import { makeTextSprite, disposeSprite } from './sprites.js';

const pawnMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
const geoCache = new Map(); // avatar key → merged geometry (shared by identical avatars)

function specGeometry(s) {
  const a = s.args;
  switch (s.shape) {
    case 'sphere':
      return new THREE.SphereGeometry(...a);
    case 'cyl':
      return new THREE.CylinderGeometry(...a);
    case 'box':
      return new THREE.BoxGeometry(...a);
    case 'cone':
      return new THREE.ConeGeometry(...a);
    case 'torus':
      return new THREE.TorusGeometry(...a);
    default:
      return new THREE.BoxGeometry(0.1, 0.1, 0.1);
  }
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpC = new THREE.Color();

/** Merged BufferGeometry (position/normal/color) for an avatar. */
export function buildPawnGeometry(avatar, defs) {
  const key = JSON.stringify(resolveAvatar(avatar, defs).avatar);
  if (geoCache.has(key)) return geoCache.get(key);
  const parts = pawnSpecs(avatar, defs).map((s) => {
    let g = specGeometry(s);
    if (g.index) g = g.toNonIndexed();
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
  geoCache.set(key, merged);
  return merged;
}

let templatePromise = null;
/** Load the optional glTF pawn once (null when not provided). Never throws. */
export function loadPawnTemplate() {
  if (templatePromise) return templatePromise;
  templatePromise = (async () => {
    try {
      const res = await fetch('/api/models', { cache: 'no-cache' });
      if (!res.ok) return null;
      const { models = [] } = await res.json();
      if (!models.includes('pawn.glb')) return null;
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const gltf = await new GLTFLoader().loadAsync('/assets/models/pawn.glb');
      const root = gltf.scene;
      const box = new THREE.Box3().setFromObject(root);
      const h = box.max.y - box.min.y || 1;
      root.scale.setScalar(1.6 / h);
      root.position.y = -box.min.y * (1.6 / h);
      return root;
    } catch {
      return null;
    }
  })();
  return templatePromise;
}

async function cloneTemplate(template, colors) {
  const { clone } = await import('three/addons/utils/SkeletonUtils.js');
  const obj = clone(template);
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    o.material = mats.map((m) => {
      const name = (m.name || '').toLowerCase();
      const key = ['skin', 'hair', 'outfit'].find((k) => name.includes(k));
      if (!key) return m;
      const mm = m.clone();
      mm.color?.set(colors[key]);
      return mm;
    });
    if (o.material.length === 1) o.material = o.material[0];
  });
  return obj;
}

const PAWN_SCALE = 0.82;

/**
 * @returns {{group, body, tag, height, update(avatar,name,isMe), setTemplate(t), dispose()}}
 */
export function createPawn({ avatar, defs, name, isMe = false }) {
  const group = new THREE.Group();
  const holder = new THREE.Group(); // hop/squash transforms live here; group = tile position
  holder.scale.setScalar(PAWN_SCALE);
  group.add(holder);
  let body = new THREE.Mesh(buildPawnGeometry(avatar, defs), pawnMaterial);
  holder.add(body);
  let tag = null;
  let key = '';
  const pawn = {
    group,
    holder,
    get body() {
      return body;
    },
    get tag() {
      return tag;
    },
    height: 1.6 * PAWN_SCALE,
    update(nextAvatar, nextName, nextIsMe) {
      const k = `${JSON.stringify(nextAvatar)}|${nextName}|${nextIsMe}`;
      if (k === key) return;
      const avatarChanged = key && JSON.stringify(nextAvatar) !== JSON.stringify(avatar);
      key = k;
      if (avatarChanged && body.isMesh) {
        avatar = nextAvatar;
        body.geometry = buildPawnGeometry(avatar, defs);
      }
      if (tag) {
        group.remove(tag);
        disposeSprite(tag);
      }
      tag = makeTextSprite(`${nextIsMe ? '★ ' : ''}${nextName}`, {
        height: 0.42,
        size: 40,
        color: nextIsMe ? '#ffffff' : '#2d2a32',
        bg: nextIsMe ? 'rgba(255,122,47,0.95)' : 'rgba(255,255,255,0.92)',
        pad: 14,
        renderOrder: 15,
      });
      tag.position.y = pawn.height + 0.42;
      group.add(tag);
    },
    async useTemplate(template) {
      if (!template) return;
      const obj = await cloneTemplate(template, resolveAvatar(avatar, defs).colors);
      holder.remove(body);
      body = obj;
      holder.add(obj);
    },
    dispose() {
      if (tag) disposeSprite(tag);
      group.removeFromParent();
    },
  };
  pawn.update(avatar, name, isMe);
  return pawn;
}
