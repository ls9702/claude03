// Deep copy of JSON-like game state (plain objects, arrays, primitives) for the pure engine / lobby / view steps.
// About 5× faster than structuredClone on a playing room (≈ 0.3 vs 1.8 ms for a 120 KB lifetime room), which
// matters because every action copies the whole room. Anything that is not a plain object or array (Date, Map,
// typed arrays, …) falls back to structuredClone. Like a JSON save → restore, shared references come out as
// separate copies; cycles are not supported (room state is JSON-serialisable by contract).
const OBJECT_PROTO = Object.prototype;

export function cloneState(v) {
  if (typeof v !== 'object' || v === null) return v;
  if (Array.isArray(v)) {
    const n = v.length;
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = cloneState(v[i]);
    return out;
  }
  const proto = Object.getPrototypeOf(v);
  if (proto !== OBJECT_PROTO && proto !== null) return structuredClone(v);
  const out = {};
  for (const k of Object.keys(v)) {
    // an own "__proto__" key (JSON.parse can make one) stays a plain property, never a prototype swap
    if (k === '__proto__') Object.defineProperty(out, k, { value: cloneState(v[k]), enumerable: true, writable: true, configurable: true });
    else out[k] = cloneState(v[k]);
  }
  return out;
}
