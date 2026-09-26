// Low-poly town props (vertex colors). Buildings merge into one mesh; trees / pines are InstancedMeshes.
import * as THREE from 'three';
import { colored, mat4, mergeColored } from './geo.js';

const WALLS = ['#fff4dc', '#ffe1e1', '#e3f4ea', '#e6ecff', '#fff0c9', '#f3e4ff'];
const ROOFS = ['#e2604c', '#4f7fd0', '#8a5a3c', '#3f9d6a', '#d98a2b', '#7d5cc4'];
const GREENS = ['#4caf50', '#5cb85c', '#3f9d4a', '#66bb6a', '#4e9a47', '#72c05f'];
const TOWER = ['#f5f1ea', '#e9eef5', '#fdf6e8', '#eef3f6', '#f2ece4', '#e8f0f2'];
const GLASS = ['#9cc3e6', '#a7d0e0', '#8fb3dc', '#b4c9e8', '#9ec6d6', '#a0b8e0'];
const BAND = '#6f8fb3';

const box = (w, h, d, color, x = 0, y = 0, z = 0, ry = 0) => colored(new THREE.BoxGeometry(w, h, d), color, mat4(x, y, z, 0, ry, 0));
const cyl = (rt, rb, h, seg, color, x = 0, y = 0, z = 0, rx = 0, rz = 0) => colored(new THREE.CylinderGeometry(rt, rb, h, seg), color, mat4(x, y, z, rx, 0, rz));
const roof4 = (r, h, color, y, sx = 1, sz = 1) => colored(new THREE.ConeGeometry(r, h, 4), color, mat4(0, y, 0, 0, Math.PI / 4, 0, [sx, 1, sz]));
const bands = (w, d, h0, h1, step, color) => {
  const out = [];
  for (let y = h0; y < h1; y += step) out.push(box(w + 0.04, 0.16, d + 0.04, color, 0, y));
  return out;
};

/** Parts (local coords, facing +z) for one building-like prop. */
export function propParts(type, v = 0) {
  const wall = WALLS[v % WALLS.length];
  const roof = ROOFS[v % ROOFS.length];
  switch (type) {
    case 'house':
      return [box(2.2, 1.4, 1.8, wall, 0, 0.7), roof4(1.75, 0.95, roof, 1.87, 1.05, 0.85), box(0.45, 0.75, 0.05, '#7a5234', 0, 0.38, 0.92), box(0.45, 0.4, 0.05, '#bfe3ff', 0.65, 0.9, 0.92)];
    case 'apartment': {
      const h = 4.2 + (v % 3) * 1.6;
      return [box(2.6, h, 2.2, TOWER[v % TOWER.length], 0, h / 2), ...bands(2.6, 2.2, 0.8, h - 0.3, 0.9, BAND), box(2.7, 0.25, 2.3, '#c9c2b8', 0, h + 0.12)];
    }
    case 'office': {
      const h = 6 + (v % 3) * 1.4;
      return [box(2.4, h, 2.4, GLASS[v % GLASS.length], 0, h / 2), ...bands(2.4, 2.4, 1, h, 1.2, '#e9f1f8'), box(1.2, 0.8, 1.2, '#dde3ea', 0, h + 0.4)];
    }
    case 'school':
      return [
        box(6, 2.4, 2.2, '#f3e6c4', 0, 1.2), box(6.2, 0.22, 2.4, '#b86b4b', 0, 2.5), ...bands(6, 2.2, 0.8, 2.3, 0.9, '#8fb6d8'),
        box(1.3, 3.8, 1.3, '#f7edd3', 0, 1.9, 0.1), cyl(0.38, 0.38, 0.08, 12, '#ffffff', 0, 3.1, 0.8, Math.PI / 2), roof4(1.1, 0.8, '#b86b4b', 4.2),
        cyl(0.04, 0.04, 3.6, 4, '#999999', 3.6, 1.8, 1.2), box(0.8, 0.5, 0.04, '#e2504c', 4.0, 3.3, 1.2),
      ];
    case 'academy':
      return [box(2.6, 3.4, 2.1, '#f2f0ea', 0, 1.7), ...bands(2.6, 2.1, 0.9, 3.2, 1, '#9fb8cf'), box(2.3, 0.6, 0.12, '#ffcf3f', 0, 3.0, 1.1)];
    case 'campus':
      return [
        box(6.4, 3, 2.8, '#efe6d6', 0, 1.5), colored(new THREE.CylinderGeometry(0.01, 2.2, 1.2, 3), '#d9cbb0', mat4(0, 3.5, 1.2, 0, 0, 0, [1.45, 1, 0.3])),
        ...[-1.8, -0.6, 0.6, 1.8].map((x) => cyl(0.18, 0.18, 2.6, 6, '#ffffff', x, 1.3, 1.55)), box(6.8, 0.3, 3.4, '#cfc4b2', 0, 0.15),
      ];
    case 'hospital':
      return [box(3.4, 2.8, 2.4, '#fbfbfb', 0, 1.4), ...bands(3.4, 2.4, 0.9, 2.6, 0.9, '#a9cbe8'), box(0.9, 0.28, 0.06, '#e2504c', 0, 2.4, 1.24), box(0.28, 0.9, 0.06, '#e2504c', 0, 2.4, 1.24)];
    case 'wedding':
      return [
        box(3, 2.4, 2.4, '#ffd6e5', 0, 1.2), roof4(2.3, 1.2, '#ffffff', 3.0, 1, 1), cyl(0.45, 0.45, 2, 8, '#fff0f6', 1.2, 3.2, 0.6), colored(new THREE.ConeGeometry(0.55, 0.9, 8), '#ff8fb8', mat4(1.2, 4.6, 0.6)),
        box(0.7, 1.2, 0.05, '#c96b8c', 0, 0.6, 1.22),
      ];
    case 'temple':
      return [
        box(4.4, 0.45, 3.2, '#b9b2a6', 0, 0.22), box(3.2, 1.5, 2.1, '#a8452f', 0, 1.2), ...[-1.3, -0.45, 0.45, 1.3].map((x) => cyl(0.1, 0.1, 1.5, 5, '#6b2d1f', x, 1.2, 1.1)),
        roof4(2.9, 1.1, '#4b5563', 2.45, 1.35, 0.95), box(3.4, 0.14, 0.2, '#2f6b4f', 0, 2.0, 1.2),
      ];
    case 'hanok':
      return [box(2.4, 1.2, 1.8, '#f3ead7', 0, 0.75), box(2.6, 0.3, 2.0, '#b9b2a6', 0, 0.15), roof4(2.0, 0.85, '#4b5563', 1.75, 1.35, 0.95), box(0.5, 0.8, 0.05, '#8a5a3c', 0, 0.7, 0.92)];
    case 'mountain':
      return [colored(new THREE.ConeGeometry(7, 8, 7), ['#6b8f6a', '#5e8360', '#557a59', '#7a9c78'][v % 4], mat4(0, 3.6, 0)), colored(new THREE.ConeGeometry(2.4, 2.6, 7), '#f4f7f8', mat4(0, 6.4, 0))];
    case 'bush':
      return [colored(new THREE.IcosahedronGeometry(0.55, 0), GREENS[v % GREENS.length], mat4(0, 0.3, 0, 0, 0, 0, [1, 0.7, 1]))];
    default:
      return [];
  }
}

/** Tree / pine geometries for InstancedMesh (unit scale). */
export function treeGeometry() {
  return mergeColored([
    colored(new THREE.CylinderGeometry(0.12, 0.17, 0.8, 5), '#8a5a3c', mat4(0, 0.4, 0)),
    colored(new THREE.IcosahedronGeometry(0.8, 0), '#4caf50', mat4(0, 1.35, 0)),
    colored(new THREE.IcosahedronGeometry(0.5, 0), '#66bb6a', mat4(0.25, 1.85, 0.1)),
  ]);
}
export function pineGeometry() {
  return mergeColored([
    colored(new THREE.CylinderGeometry(0.1, 0.14, 0.7, 5), '#7c4a2d', mat4(0, 0.35, 0)),
    colored(new THREE.ConeGeometry(0.75, 1.3, 6), '#2f7d4a', mat4(0, 1.2, 0)),
    colored(new THREE.ConeGeometry(0.52, 1.0, 6), '#3f9d5a', mat4(0, 1.85, 0)),
  ]);
}

/**
 * Build prop meshes for planned props → { group, dispose }.
 * @param {{type,x,z,yaw,scale,variant}[]} props
 */
export function buildProps(props, material) {
  const group = new THREE.Group();
  const parts = [];
  const trees = [];
  const pines = [];
  for (const p of props) {
    if (p.type === 'tree') trees.push(p);
    else if (p.type === 'pine') pines.push(p);
    else {
      const m = mat4(p.x, 0, p.z, 0, p.yaw, 0, p.type === 'mountain' ? p.scale : p.scale ?? 1);
      for (const g of propParts(p.type, p.variant ?? 0)) {
        g.applyMatrix4(m);
        parts.push(g);
      }
    }
  }
  if (parts.length) group.add(new THREE.Mesh(mergeColored(parts), material));
  const tint = new THREE.Color();
  for (const [list, geo] of [
    [trees, treeGeometry()],
    [pines, pineGeometry()],
  ]) {
    if (!list.length) {
      geo.dispose();
      continue;
    }
    const inst = new THREE.InstancedMesh(geo, material, list.length);
    list.forEach((p, i) => {
      inst.setMatrixAt(i, mat4(p.x, 0, p.z, 0, p.yaw, 0, p.scale));
      tint.set(GREENS[p.variant % GREENS.length]).lerp(new THREE.Color('#ffffff'), 0.55);
      inst.setColorAt(i, tint);
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    group.add(inst);
  }
  return group;
}
