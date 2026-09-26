// Lightweight orbit controls for the board camera (no three.js dependency).
//   1 finger / left drag: rotate · pinch or wheel: zoom · 2-finger drag / right or shift drag: pan
// A short press without movement is reported as a tap (canvas coords) — used for the roulette; taps
// keep working while orbiting is disabled (tv mode).
import { clamp } from './math.js';

export const ORBIT_LIMITS = { minPolar: 0.28, maxPolar: 1.32, minRadius: 6, maxRadius: 80 };

/**
 * @param {HTMLElement} dom
 * @param {{ state: {azimuth, polar, radius, panX, panZ}, onInput?: (kind) => void, onTap?: (x, y) => void }} opts
 */
export function createOrbitControls(dom, { state, onInput = () => {}, onTap = () => {} }) {
  const pts = new Map();
  let enabled = true;
  let start = null; // { x, y, t, moved }
  let lastPinch = null;

  const rel = (ev) => {
    const r = dom.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };

  /** Finger moved by (dx, dy) px → the ground follows the finger. */
  function pan(dx, dy) {
    const k = state.radius * 0.0022;
    const s = Math.sin(state.azimuth);
    const c = Math.cos(state.azimuth);
    // ground axes seen from the camera: right = (cos az, −sin az), forward = (−sin az, −cos az)
    state.panX += (-c * dx - s * dy) * k;
    state.panZ += (s * dx - c * dy) * k;
    state.panX = clamp(state.panX, -200, 200);
    state.panZ = clamp(state.panZ, -200, 200);
    onInput('pan');
  }

  function down(ev) {
    dom.setPointerCapture?.(ev.pointerId);
    const p = rel(ev);
    pts.set(ev.pointerId, { ...p, button: ev.button, shift: ev.shiftKey });
    if (pts.size === 1) start = { ...p, t: performance.now(), moved: false };
    else start = null;
    lastPinch = null;
  }

  function move(ev) {
    if (!pts.has(ev.pointerId)) return;
    const prev = pts.get(ev.pointerId);
    const p = rel(ev);
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    pts.set(ev.pointerId, { ...prev, ...p });
    if (start && Math.hypot(p.x - start.x, p.y - start.y) > 6) start.moved = true;
    if (!enabled) return;
    if (pts.size === 1) {
      if (start && !start.moved) return;
      if (prev.button === 2 || prev.shift) {
        pan(dx, dy);
      } else {
        state.azimuth -= dx * 0.006;
        state.polar = clamp(state.polar - dy * 0.005, ORBIT_LIMITS.minPolar, ORBIT_LIMITS.maxPolar);
        onInput('rotate');
      }
    } else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (lastPinch) {
        if (dist > 0 && lastPinch.dist > 0) {
          state.radius = clamp(state.radius * (lastPinch.dist / dist), ORBIT_LIMITS.minRadius, ORBIT_LIMITS.maxRadius);
          onInput('zoom');
        }
        pan(mid.x - lastPinch.mid.x, mid.y - lastPinch.mid.y);
      }
      lastPinch = { dist, mid };
    }
  }

  function up(ev) {
    if (!pts.has(ev.pointerId)) return;
    pts.delete(ev.pointerId);
    if (start && !start.moved && pts.size === 0 && performance.now() - start.t < 450) {
      const p = rel(ev);
      onTap(p.x, p.y);
    }
    if (pts.size === 0) start = null;
    lastPinch = null;
  }

  function wheel(ev) {
    if (!enabled) return;
    ev.preventDefault();
    state.radius = clamp(state.radius * Math.exp(ev.deltaY * 0.0012), ORBIT_LIMITS.minRadius, ORBIT_LIMITS.maxRadius);
    onInput('zoom');
  }

  const ctx = (ev) => ev.preventDefault();
  dom.addEventListener('pointerdown', down);
  dom.addEventListener('pointermove', move);
  dom.addEventListener('pointerup', up);
  dom.addEventListener('pointercancel', up);
  dom.addEventListener('wheel', wheel, { passive: false });
  dom.addEventListener('contextmenu', ctx);
  dom.style.touchAction = 'none';

  return {
    set enabled(v) {
      enabled = !!v;
      dom.style.touchAction = enabled ? 'none' : 'pan-y';
    },
    get enabled() {
      return enabled;
    },
    dispose() {
      dom.removeEventListener('pointerdown', down);
      dom.removeEventListener('pointermove', move);
      dom.removeEventListener('pointerup', up);
      dom.removeEventListener('pointercancel', up);
      dom.removeEventListener('wheel', wheel);
      dom.removeEventListener('contextmenu', ctx);
    },
  };
}
