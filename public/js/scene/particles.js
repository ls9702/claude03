// Particle bursts (coins / hearts / stars / confetti) as THREE.Points — one draw call per burst.
import * as THREE from 'three';

const TEX = new Map();
function shapeTexture(kind) {
  if (TEX.has(kind)) return TEX.get(kind);
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.translate(32, 32);
  if (kind === 'coin') {
    ctx.fillStyle = '#f5c542';
    ctx.beginPath();
    ctx.arc(0, 0, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#c9901a';
    ctx.stroke();
    ctx.fillStyle = '#b07810';
    ctx.font = '900 30px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('₩', 0, 2);
  } else if (kind === 'heart') {
    ctx.fillStyle = '#ff5c8a';
    ctx.beginPath();
    ctx.moveTo(0, 22);
    ctx.bezierCurveTo(-30, 2, -24, -24, 0, -10);
    ctx.bezierCurveTo(24, -24, 30, 2, 0, 22);
    ctx.fill();
  } else if (kind === 'star') {
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 11 : 27;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'drop') {
    ctx.fillStyle = '#7c8bd6';
    ctx.beginPath();
    ctx.moveTo(0, -26);
    ctx.quadraticCurveTo(22, 6, 0, 24);
    ctx.quadraticCurveTo(-22, 6, 0, -26);
    ctx.fill();
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-20, -12, 40, 24);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  TEX.set(kind, tex);
  return tex;
}

/** Particle kind for a landed tile type. */
export const BURST_FOR_TILE = { money: 'coin', heart: 'heart', loss: 'drop', event: 'star', card: 'star', job: 'star', treasure: 'coin', house: 'coin', shop: 'star', stop: 'star', goal: 'confetti', merge: 'star' };

const CONFETTI_COLORS = ['#ff5c5c', '#ffd23f', '#4f8ee0', '#5cb87a', '#ff7eb6', '#9a6ad6'];

export function createParticles(scene) {
  const bursts = [];
  return {
    /** Burst of `count` sprites of `kind` at world position p. */
    burst(kind, p, count = 18, { up = 3.2, spread = 1.8, life = 1.1, size = 0.42 } = {}) {
      if (count <= 0) return;
      const confetti = kind === 'confetti';
      const pos = new Float32Array(count * 3);
      const vel = new Float32Array(count * 3);
      const col = new Float32Array(count * 3);
      const c = new THREE.Color();
      for (let i = 0; i < count; i++) {
        pos.set([p.x, p.y + 0.4, p.z], i * 3);
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * spread;
        vel.set([Math.cos(a) * r, up * (0.6 + Math.random() * 0.6), Math.sin(a) * r], i * 3);
        c.set(confetti ? CONFETTI_COLORS[i % CONFETTI_COLORS.length] : '#ffffff');
        col.set([c.r, c.g, c.b], i * 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const mat = new THREE.PointsMaterial({
        size: confetti ? size * 0.6 : size,
        map: shapeTexture(confetti ? 'confetti' : kind),
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        alphaTest: 0.1,
      });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      pts.renderOrder = 12;
      scene.add(pts);
      bursts.push({ pts, vel, t: 0, life: confetti ? life * 1.8 : life });
    },
    update(dt) {
      for (const b of [...bursts]) {
        b.t += dt;
        const arr = b.pts.geometry.attributes.position.array;
        for (let i = 0; i < arr.length; i += 3) {
          b.vel[i + 1] -= 7 * dt;
          arr[i] += b.vel[i] * dt;
          arr[i + 1] = Math.max(0.1, arr[i + 1] + b.vel[i + 1] * dt);
          arr[i + 2] += b.vel[i + 2] * dt;
        }
        b.pts.geometry.attributes.position.needsUpdate = true;
        b.pts.material.opacity = Math.max(0, 1 - Math.max(0, b.t / b.life - 0.6) / 0.4);
        if (b.t >= b.life) {
          b.pts.removeFromParent();
          b.pts.geometry.dispose();
          b.pts.material.dispose();
          bursts.splice(bursts.indexOf(b), 1);
        }
      }
    },
    get count() {
      return bursts.length;
    },
    clear() {
      for (const b of bursts) {
        b.pts.removeFromParent();
        b.pts.geometry.dispose();
        b.pts.material.dispose();
      }
      bursts.length = 0;
    },
  };
}
