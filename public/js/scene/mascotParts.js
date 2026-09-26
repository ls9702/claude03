// Low-poly MC dog mascots (Stage 5.6) as primitive specs (pure → node-tested). Same spec format as
// pawnParts.js: {shape: sphere|cyl|cone|box, args, pos, rot?, scale?, color}. Every dog has three parts that
// become one merged vertex-coloured mesh each (3 draw calls per dog): `body` (torso, legs, paws, accessory),
// `head` (pivot at the neck → looks at the camera) and `tail` (pivot at the base → wag).
//
// 호야: almost all white, creamy top of the head, dark brown ears with a tan base, tan around the eyes, pink
// tongue tip, orange bandana. 봄이: black head/ears/back, white forehead blaze, white muzzle/chest/front legs,
// black speckles on the white front paws, purple bow tie.

export const MASCOT_IDS = ['hoya', 'bomi'];

export const MASCOT_COLORS = {
  hoya: { fur: '#faf6ef', shade: '#eadfcf', cream: '#efd6b4', ear: '#3b2b22', earTan: '#b8875a', patch: '#dcb48a', nose: '#1d1716', eye: '#140f0f', tongue: '#f28ca0', accent: '#ff8a3d' },
  bomi: { fur: '#f6f4f1', shade: '#dedad4', black: '#1f1d21', beard: '#e0d4c3', nose: '#141214', eye: '#050405', glint: '#ffffff', accent: '#6d5dfc' },
};

/** Pivots (dog-local, facing +z, feet on y = 0). */
export const MASCOT_PIVOTS = { head: [0, 0.6, 0.06], tail: [0, 0.34, -0.32] };
export const MASCOT_HEIGHT = 1.02;

const S = (r, w = 8, h = 6) => [r, w, h];

/**
 * @param {'hoya'|'bomi'} id
 * @returns {{body: object[], head: object[], tail: object[]}}  head/tail specs are relative to their pivot
 */
export function mascotSpecs(id) {
  const c = MASCOT_COLORS[id] ?? MASCOT_COLORS.hoya;
  const bomi = id === 'bomi';
  const coat = bomi ? c.black : c.fur;
  const white = c.fur;
  const body = [
    { shape: 'sphere', args: S(0.33, 9, 7), pos: [0, 0.31, -0.03], scale: [1, 0.95, 1.08], color: coat },
    { shape: 'sphere', args: S(0.23, 8, 6), pos: [0, 0.33, 0.15], scale: [1, 1.12, 0.62], color: white }, // chest
    { shape: 'sphere', args: S(0.14, 7, 5), pos: [-0.2, 0.1, -0.04], scale: [1, 0.7, 1.35], color: white }, // hind legs
    { shape: 'sphere', args: S(0.14, 7, 5), pos: [0.2, 0.1, -0.04], scale: [1, 0.7, 1.35], color: white },
    { shape: 'cyl', args: [0.07, 0.08, 0.24, 6, 1, true], pos: [-0.11, 0.14, 0.19], color: white }, // front legs
    { shape: 'cyl', args: [0.07, 0.08, 0.24, 6, 1, true], pos: [0.11, 0.14, 0.19], color: white },
    { shape: 'sphere', args: S(0.085, 6, 4), pos: [-0.11, 0.035, 0.23], scale: [1, 0.6, 1.3], color: white }, // paws
    { shape: 'sphere', args: S(0.085, 6, 4), pos: [0.11, 0.035, 0.23], scale: [1, 0.6, 1.3], color: white },
  ];
  if (bomi) {
    for (const x of [-0.11, 0.11]) {
      body.push({ shape: 'box', args: [0.03, 0.02, 0.03], pos: [x - 0.03, 0.06, 0.3], color: c.black });
      body.push({ shape: 'box', args: [0.025, 0.02, 0.025], pos: [x + 0.03, 0.055, 0.29], color: c.black });
    }
    // bow tie
    body.push({ shape: 'cone', args: [0.07, 0.11, 4], pos: [-0.07, 0.56, 0.21], rot: [0, 0, Math.PI / 2], color: c.accent });
    body.push({ shape: 'cone', args: [0.07, 0.11, 4], pos: [0.07, 0.56, 0.21], rot: [0, 0, -Math.PI / 2], color: c.accent });
    body.push({ shape: 'box', args: [0.05, 0.05, 0.04], pos: [0, 0.56, 0.23], color: '#4c3fd6' });
  } else {
    // bandana (downward triangle under the chin)
    body.push({ shape: 'cone', args: [0.2, 0.2, 6], pos: [0, 0.47, 0.17], rot: [Math.PI + 0.35, 0, 0], scale: [1.1, 1, 0.5], color: c.accent });
  }

  const head = [
    { shape: 'sphere', args: S(0.35, 11, 8), pos: [0, 0.2, 0], scale: [1.05, 0.95, 0.95], color: coat },
    { shape: 'sphere', args: S(0.19, 8, 6), pos: [0, 0.07, 0.22], scale: [1.3, 0.85, 0.85], color: white }, // muzzle
    { shape: 'sphere', args: S(0.055, 6, 4), pos: [0, 0.13, 0.38], scale: [1.2, 0.9, 1], color: c.nose },
    { shape: 'sphere', args: S(0.055, 6, 4), pos: [-0.13, 0.22, 0.29], color: c.eye },
    { shape: 'sphere', args: S(0.055, 6, 4), pos: [0.13, 0.22, 0.29], color: c.eye },
    // ears (long, floppy)
    { shape: 'sphere', args: S(0.15, 7, 5), pos: [-0.32, 0.06, -0.02], rot: [0, 0, 0.28], scale: [0.5, 1.3, 0.85], color: bomi ? c.black : c.ear },
    { shape: 'sphere', args: S(0.15, 7, 5), pos: [0.32, 0.06, -0.02], rot: [0, 0, -0.28], scale: [0.5, 1.3, 0.85], color: bomi ? c.black : c.ear },
  ];
  if (bomi) {
    head.push({ shape: 'sphere', args: S(0.07, 6, 4), pos: [0, 0.35, 0.27], rot: [-0.55, 0, 0], scale: [0.8, 2.3, 0.5], color: white }); // blaze
    head.push({ shape: 'sphere', args: S(0.16, 7, 5), pos: [0, -0.02, 0.2], scale: [1.35, 0.7, 0.9], color: c.beard }); // beard
    head.push({ shape: 'box', args: [0.025, 0.025, 0.02], pos: [-0.115, 0.245, 0.335], color: c.glint });
    head.push({ shape: 'box', args: [0.025, 0.025, 0.02], pos: [0.145, 0.245, 0.335], color: c.glint });
  } else {
    head.push({ shape: 'sphere', args: S(0.22, 8, 5), pos: [0, 0.4, -0.02], scale: [1.25, 0.5, 1.1], color: c.cream }); // creamy top
    head.push({ shape: 'sphere', args: S(0.09, 6, 4), pos: [-0.13, 0.22, 0.25], scale: [1.1, 1, 0.55], color: c.patch }); // tan around eyes
    head.push({ shape: 'sphere', args: S(0.09, 6, 4), pos: [0.13, 0.22, 0.25], scale: [1.1, 1, 0.55], color: c.patch });
    head.push({ shape: 'sphere', args: S(0.07, 5, 4), pos: [-0.29, 0.2, 0.02], scale: [0.7, 1, 0.8], color: c.earTan });
    head.push({ shape: 'sphere', args: S(0.07, 5, 4), pos: [0.29, 0.2, 0.02], scale: [0.7, 1, 0.8], color: c.earTan });
    head.push({ shape: 'sphere', args: S(0.05, 5, 4), pos: [0, -0.03, 0.36], scale: [1, 0.6, 0.5], color: c.tongue });
  }

  const tail = [
    { shape: 'sphere', args: S(0.12, 7, 5), pos: [0, 0.12, -0.04], scale: [0.8, 1.45, 0.8], color: coat },
    { shape: 'sphere', args: S(0.1, 6, 5), pos: [0, 0.28, 0.03], color: bomi ? white : c.fur },
  ];
  return { body, head, tail };
}
