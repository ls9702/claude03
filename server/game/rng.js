// Seeded RNG (mulberry32). The whole generator state is one uint32, so it is
// stored in the room (`room.rngState`) and a restored room continues the exact
// same sequence.

const toUint32 = (n) => (Number.isFinite(n) ? Math.floor(Math.abs(n)) >>> 0 : 0);

/**
 * @param {number} seed uint32 state (room.seed at game start, room.rngState afterwards)
 */
export function createRng(seed = 0) {
  let a = toUint32(seed);
  const rng = {
    /** Float in [0, 1). */
    next() {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    /** Integer in [min, max] (inclusive). */
    int(min, max) {
      const lo = Math.ceil(Math.min(min, max));
      const hi = Math.floor(Math.max(min, max));
      return lo + Math.floor(rng.next() * (hi - lo + 1));
    },
    /** Uniform element of a non-empty array. */
    pick(arr) {
      if (!arr?.length) throw new Error('pick: empty array');
      return arr[Math.floor(rng.next() * arr.length)];
    },
    /** Element chosen by `weight` (default 1; weights ≤0 are never picked). */
    weighted(items) {
      const w = (it) => (typeof it?.weight === 'number' ? Math.max(0, it.weight) : 1);
      const total = items.reduce((s, it) => s + w(it), 0);
      if (!(total > 0)) throw new Error('weighted: no positive weights');
      let r = rng.next() * total;
      for (const it of items) {
        r -= w(it);
        if (r < 0 && w(it) > 0) return it;
      }
      return [...items].reverse().find((it) => w(it) > 0);
    },
    /** Serializable state (uint32). */
    get state() {
      return a >>> 0;
    },
  };
  return rng;
}
