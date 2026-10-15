// CH-1: Chiikawa-style pawn from a roster look (one merged vertex-coloured mesh = 1 draw call) + name tag.
// pawnParts.js gives primitive specs; here they become geometry: per-triangle paint (Hachiware cap, bun glaze, otter
// muzzle, …), scalloped bumps (mane / tail), an inverted-hull outline in the character's line colour (same mesh,
// same material: reversed winding → only the hull's back faces show, around the silhouette) and reversed faces.
// Optional drop-in: when /api/models lists `pawn.glb`, GLTFLoader loads it once and each pawn clones it, tinting
// materials named *skin* / *hair* / *outfit* with the look's colours (body / accent / blush).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { pawnSpecs, pawnLook, lookKey, lineColor, charaHeight, isHumanAvatar, paintColor, bumpFactor, resolveAvatar, rosterEntry, normalizeLook } from './pawnParts.js';
import { makeTextSprite, disposeSprite } from './sprites.js';

export const PAWN_SCALE = 0.78; // CH-1 roster pawns are wider than the old human ones (big round heads)
const HUMAN_HEIGHT = 1.6;
const GEO_CACHE_MAX = 48;

const pawnMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
const geoCache = new Map(); // look key → merged geometry (shared by identical looks; LRU)

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
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3();

/** Reverse the winding of a non-indexed geometry (and flip its normals). */
function flipFaces(g) {
  for (const name of ['position', 'normal', 'color']) {
    const attr = g.attributes[name];
    if (!attr) continue;
    const arr = attr.array;
    for (let i = 0; i < arr.length; i += 9) {
      for (let k = 0; k < 3; k++) {
        const t = arr[i + 3 + k];
        arr[i + 3 + k] = arr[i + 6 + k];
        arr[i + 6 + k] = t;
      }
    }
  }
  const n = g.attributes.normal?.array;
  if (n) for (let i = 0; i < n.length; i++) n[i] = -n[i];
}

function setColors(g, s) {
  const pos = g.attributes.position;
  const n = pos.count;
  const col = new Float32Array(n * 3);
  tmpC.set(s.color);
  const base = [tmpC.r, tmpC.g, tmpC.b];
  const sphere = s.shape === 'sphere';
  const cache = new Map();
  for (let i = 0; i < n; i += 3) {
    let rgb = base;
    if (s.paint) {
      let x = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
      let y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
      let z = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
      if (sphere) {
        const l = Math.hypot(x, y, z) || 1;
        x /= l;
        y /= l;
        z /= l;
      }
      const hex = paintColor(s.paint, x, y, z);
      if (hex) {
        if (!cache.has(hex)) {
          tmpC.set(hex);
          cache.set(hex, [tmpC.r, tmpC.g, tmpC.b]);
        }
        rgb = cache.get(hex);
      }
    }
    col.set(rgb, i * 3);
    col.set(rgb, i * 3 + 3);
    col.set(rgb, i * 3 + 6);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

/** One spec → a transformed, coloured, non-indexed geometry. */
function partGeometry(s) {
  let g = specGeometry(s);
  if (s.bump) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const k = bumpFactor(s.bump, p.getX(i), p.getY(i), p.getZ(i));
      p.setXYZ(i, p.getX(i) * k, p.getY(i), p.getZ(i) * k);
    }
    g.computeVertexNormals();
  }
  if (g.index) {
    const ni = g.toNonIndexed();
    g.dispose();
    g = ni;
  }
  g.deleteAttribute('uv');
  setColors(g, s); // paint uses LOCAL coordinates (before the transform)
  if (s.flip) flipFaces(g);
  tmpE.set(...(s.rot ?? [0, 0, 0]));
  tmpQ.setFromEuler(tmpE);
  tmpM.compose(tmpV.set(...s.pos), tmpQ, tmpS.set(...(s.scale ?? [1, 1, 1])));
  g.applyMatrix4(tmpM);
  return g;
}

/** Inverted hull: the part pushed out along its normals, winding reversed, in the line colour. */
function hullGeometry(g, t, line) {
  const h = g.clone();
  const p = h.attributes.position.array;
  const n = h.attributes.normal.array;
  for (let i = 0; i < p.length; i++) p[i] += n[i] * t;
  tmpC.set(line);
  const col = h.attributes.color.array;
  for (let i = 0; i < col.length; i += 3) {
    col[i] = tmpC.r;
    col[i + 1] = tmpC.g;
    col[i + 2] = tmpC.b;
  }
  flipFaces(h);
  return h;
}

/**
 * Merged geometry of a spec list. `userData.triangles` = triangle count.
 * @param {object[]} specs
 * @param {{line?: string, outline?: boolean}} opts
 */
export function buildSpecsGeometry(specs, { line = '#3b3030', outline = true } = {}) {
  const parts = [];
  for (const s of specs) {
    const g = partGeometry(s);
    parts.push(g);
    if (outline && s.outline > 0) parts.push(hullGeometry(g, s.outline, line));
  }
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  merged.computeBoundingSphere();
  merged.userData.triangles = merged.attributes.position.count / 3;
  return merged;
}

/**
 * Merged BufferGeometry (position/normal/color) for a character look (roster look; an old human avatar → the legacy
 * human pawn). Cached per look (LRU, shared by the board, the lobby preview and the podium).
 * @param {object} avatar  `{character, props}` (or a legacy human avatar)
 * @param {object} defs    `/api/meta` (roster / props), or the old avatars.json defs
 * @param {{expression?: 'joy', outline?: boolean}} opts
 */
export function buildPawnGeometry(avatar, defs, opts = {}) {
  const human = isHumanAvatar(avatar);
  const outline = opts.outline !== false;
  const key = human ? `h:${JSON.stringify(resolveAvatar(avatar, defs?.parts ? defs : defs?.avatars).avatar)}` : `${lookKey(avatar, defs)}|${opts.expression ?? ''}|${outline ? 1 : 0}`;
  const hit = geoCache.get(key);
  if (hit) {
    geoCache.delete(key);
    geoCache.set(key, hit);
    return hit;
  }
  const specs = pawnSpecs(avatar, defs, opts);
  const geo = buildSpecsGeometry(specs, { line: human ? '#2b2530' : lineColor(avatar, defs), outline: outline && !human });
  geo.userData.height = human ? HUMAN_HEIGHT : charaHeight(avatar, defs);
  geoCache.set(key, geo);
  while (geoCache.size > GEO_CACHE_MAX) {
    const [k, g] = geoCache.entries().next().value;
    geoCache.delete(k);
    g.dispose(); // safe even when a mesh still uses it: three.js re-uploads on the next render
  }
  return geo;
}

/** Unscaled pawn height of a look (name tag / emotion anchor). */
export function pawnHeight(avatar, defs) {
  return isHumanAvatar(avatar) ? HUMAN_HEIGHT : charaHeight(avatar, defs);
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
      root.scale.setScalar(1.4 / h);
      root.position.y = -box.min.y * (1.4 / h);
      return root;
    } catch {
      return null;
    }
  })();
  return templatePromise;
}

function templateColors(avatar, defs) {
  if (isHumanAvatar(avatar)) return resolveAvatar(avatar, defs?.parts ? defs : defs?.avatars).colors;
  const e = rosterEntry(normalizeLook(avatar, defs).character, defs);
  return { skin: e.colors.body, hair: e.colors.accent ?? e.colors.body, outfit: e.colors.blush };
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

/**
 * A board pawn. `avatar` = the look to draw (the display room's effective look `{character, props}`; any other value
 * is normalised like the 2D renderer does). `defs` = `/api/meta`.
 * @returns {{group, holder, body, tag, height, baseScale, update(avatar,name,isMe), useTemplate(t), dispose()}}
 * `group` = tile position + yaw; `holder` = hop / squash transforms (its origin is the feet, scale baseScale).
 */
export function createPawn({ avatar: rawAvatar, defs, name, isMe = false }) {
  let avatar = pawnLook(rawAvatar, defs);
  const group = new THREE.Group();
  const holder = new THREE.Group(); // hop/squash transforms live here; group = tile position
  holder.scale.setScalar(PAWN_SCALE);
  group.add(holder);
  let body = new THREE.Mesh(buildPawnGeometry(avatar, defs), pawnMaterial);
  holder.add(body);
  let tag = null;
  let key = '';
  let label = '';
  const placeTag = () => {
    if (tag) tag.position.y = pawn.height + 0.36;
  };
  const pawn = {
    group,
    holder,
    baseScale: PAWN_SCALE,
    get body() {
      return body;
    },
    get tag() {
      return tag;
    },
    height: pawnHeight(avatar, defs) * PAWN_SCALE,
    update(nextRaw, nextName, nextIsMe) {
      const nextAvatar = pawnLook(nextRaw, defs);
      const k = `${JSON.stringify(nextAvatar)}|${nextName}|${nextIsMe}`;
      if (k === key) return;
      const avatarChanged = key && JSON.stringify(nextAvatar) !== JSON.stringify(avatar);
      key = k;
      if (avatarChanged) {
        avatar = nextAvatar;
        pawn.height = pawnHeight(avatar, defs) * PAWN_SCALE;
        if (body.isMesh) body.geometry = buildPawnGeometry(avatar, defs);
      }
      const nextLabel = `${nextIsMe ? '★ ' : ''}${nextName}|${nextIsMe}`;
      if (tag && nextLabel === label) {
        placeTag();
        return;
      }
      label = nextLabel;
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
      group.add(tag);
      placeTag();
    },
    async useTemplate(template) {
      if (!template) return;
      const obj = await cloneTemplate(template, templateColors(avatar, defs));
      holder.remove(body);
      body = obj;
      holder.add(obj);
    },
    dispose() {
      if (tag) disposeSprite(tag);
      group.removeFromParent();
    },
  };
  pawn.update(rawAvatar, name, isMe);
  return pawn;
}
