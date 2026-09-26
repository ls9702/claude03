// Geometry helpers: vertex-colored primitives merged into single meshes (1 draw call per group).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _c = new THREE.Color();

/** Non-indexed copy of `geo` (uv dropped), transformed by `matrix`, painted `color`. */
export function colored(geo, color, matrix = null) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  g.deleteAttribute('uv');
  if (matrix) g.applyMatrix4(matrix);
  _c.set(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = _c.r;
    arr[i * 3 + 1] = _c.g;
    arr[i * 3 + 2] = _c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/** Matrix from position / euler rotation / scale (scale may be a number). */
export function mat4(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) {
  const sc = typeof s === 'number' ? new THREE.Vector3(s, s, s) : new THREE.Vector3(...s);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), sc);
}

/** Merge colored parts (disposes the inputs). */
export function mergeColored(parts) {
  if (!parts.length) return new THREE.BufferGeometry();
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  g.computeBoundingSphere();
  return g;
}

/** Flat strip following a polyline [{x,z}] at height y (triangles, normals up, one color). */
export function stripGeometry(poly, width, y, color) {
  const pos = [];
  const half = width / 2;
  const L = [];
  const R = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[Math.max(0, i - 1)];
    const b = poly[Math.min(poly.length - 1, i + 1)];
    let tx = b.x - a.x;
    let tz = b.z - a.z;
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    L.push([poly[i].x - tz * half, poly[i].z + tx * half]);
    R.push([poly[i].x + tz * half, poly[i].z - tx * half]);
  }
  for (let i = 0; i < poly.length - 1; i++) {
    const [l0, r0, l1, r1] = [L[i], R[i], L[i + 1], R[i + 1]];
    pos.push(l0[0], y, l0[1], r0[0], y, r0[1], l1[0], y, l1[1]);
    pos.push(r0[0], y, r0[1], r1[0], y, r1[1], l1[0], y, l1[1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  // make sure every triangle faces up (winding depends on direction)
  const p = g.attributes.position.array;
  for (let i = 0; i < p.length; i += 9) {
    const ux = p[i + 3] - p[i];
    const uz = p[i + 5] - p[i + 2];
    const vx = p[i + 6] - p[i];
    const vz = p[i + 8] - p[i + 2];
    if (uz * vx - ux * vz < 0) {
      for (let k = 0; k < 3; k++) [p[i + 3 + k], p[i + 6 + k]] = [p[i + 6 + k], p[i + 3 + k]];
    }
  }
  const n = new Float32Array(p.length);
  for (let i = 0; i < n.length; i += 3) n[i + 1] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  return colored(g, color);
}
