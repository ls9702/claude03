// Emoji / text popups above pawns (engine `emotion` fields, SSE reactions, money floats).
import * as THREE from 'three';
import { glyphTexture, makeTextSprite, disposeSprite } from './sprites.js';
import { easeOutBack, clamp } from './math.js';

export const EMOTION_GLYPH = { joy: '😆', cry: '😭', angry: '😡', sweat: '😅', love: '😍', shock: '😱' };

/**
 * @param {THREE.Scene} scene
 * @param {{ anchor: (charId) => THREE.Vector3|null }} opts  world position above a pawn's head
 */
export function createEmotionLayer(scene, { anchor }) {
  const items = []; // { sprite, charId, t, dur, rise, base, own, kind }

  function stackIndex(charId) {
    return items.filter((i) => i.charId === charId && i.kind === 'pop').length;
  }

  function add(item) {
    items.push(item);
    scene.add(item.sprite);
    if (items.length > 40) remove(items[0]);
  }

  function remove(item) {
    const i = items.indexOf(item);
    if (i >= 0) items.splice(i, 1);
    item.sprite.removeFromParent();
    if (item.own) disposeSprite(item.sprite);
    else item.sprite.material.dispose();
  }

  return {
    /** Emoji bubble (emotion id like 'joy' or any glyph / short text). */
    pop(charId, kindOrGlyph, { dur = 1.8 } = {}) {
      const glyph = EMOTION_GLYPH[kindOrGlyph] ?? kindOrGlyph;
      if (!glyph || !anchor(charId)) return;
      const tex = glyphTexture(String(glyph));
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
      const sprite = new THREE.Sprite(mat);
      sprite.renderOrder = 30;
      const aspect = tex.userData?.aspect ?? 1;
      const n = stackIndex(charId);
      add({ sprite, charId, t: 0, dur, kind: 'pop', w: 0.8 * aspect, h: 0.8, dx: 0.55 + (n % 3) * 0.35, dy: 0.25 + n * 0.3, own: false });
    },
    /** Rising text (e.g. '+50만원'). */
    float(charId, text, color = '#1f7a45') {
      if (!anchor(charId)) return;
      const sprite = makeTextSprite(text, { height: 0.46, size: 44, weight: 900, color, bg: 'rgba(255,255,255,0.9)', pad: 12, renderOrder: 31 });
      add({ sprite, charId, t: 0, dur: 1.6, kind: 'float', w: sprite.scale.x, h: sprite.scale.y, dx: 0, dy: 0.1, own: true });
    },
    update(dt) {
      for (const it of [...items]) {
        it.t += dt;
        const k = it.t / it.dur;
        if (k >= 1) {
          remove(it);
          continue;
        }
        const p = anchor(it.charId);
        if (!p) {
          remove(it);
          continue;
        }
        const grow = it.kind === 'pop' ? easeOutBack(clamp(it.t / 0.25, 0, 1)) : 1;
        const rise = it.kind === 'float' ? k * 1.1 : Math.min(k * 3, 1) * 0.3;
        it.sprite.position.set(p.x + (it.kind === 'pop' ? it.dx * 0.6 : 0), p.y + it.dy + rise, p.z);
        it.sprite.scale.set(it.w * grow, it.h * grow, 1);
        it.sprite.material.opacity = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
      }
    },
    clear() {
      for (const it of [...items]) remove(it);
    },
    get count() {
      return items.length;
    },
  };
}

/** Throttle helper: true when `key` has not fired within `ms` (per-layer memory). */
export function createThrottle(ms = 900, now = () => performance.now()) {
  const last = new Map();
  return (key) => {
    const t = now();
    if (t - (last.get(key) ?? -Infinity) < ms) return false;
    last.set(key, t);
    return true;
  };
}
