// Avatar parts (server/data/avatars.json ids) → low-poly primitive specs for the 3D pawn.
// Pure (no three.js) so the mapping is unit-testable; pawn.js turns specs into one merged mesh.
//
// spec: { shape: 'sphere'|'cyl'|'box'|'cone'|'torus', args: [...three.js geometry args],
//         pos: [x,y,z], rot?: [x,y,z], scale?: [x,y,z], color: '#rrggbb' }
// The pawn faces +z, stands on y=0 and is ~1.6 units tall (head center y≈1.12).

/** Fallback colors (same values as avatars.json) when defs are not loaded. */
export const PAWN_COLORS = {
  skin: { porcelain: '#fff0e4', fair: '#fde3cf', light: '#f6cfae', olive: '#d9b48a', tan: '#dca77e', deep: '#a86f4c' },
  hairColor: {
    black: '#2b2222', brown: '#6b4226', blonde: '#e8c15a', red: '#a8452f', pink: '#f28bb3', blue: '#4d7fd6',
    silver: '#c9ccd6', green: '#4fa86b', purple: '#8a5cc9',
  },
  outfitColor: {
    red: '#e25b5b', orange: '#f39a3d', yellow: '#f2cf4a', green: '#5cb87a', blue: '#4f8ee0', purple: '#9a6ad6',
    black: '#3a3a42', white: '#f4f4f2', pink: '#f29ac0',
  },
};
/** Build → body width (avatars.json `build[].scaleX` wins when defs are loaded). */
export const PAWN_BUILD_SCALE = { slim: 0.9, normal: 1, chubby: 1.14 };
export const PAWN_DEFAULT = {
  body: 'boy', build: 'normal', skin: 'light', face: 'slim', eyes: 'round', mouth: 'smile', cheek: 'none',
  hair: 'short', hairColor: 'black', outfit: 'tshirt', outfitColor: 'blue', accessory: 'none',
};

const DARK = '#2b2530';
const PANTS = '#3f4a5e';
const SHOE = '#5a4032';
const WHITE = '#fbf8f2';
const MOUTH = '#c65a57';
const CHEEK = '#ff9fae';

function partColor(defs, part, id) {
  const fromDefs = defs?.parts?.[part]?.find((p) => p.id === id)?.color;
  return fromDefs ?? PAWN_COLORS[part]?.[id] ?? null;
}

/** Hex '#rrggbb' scaled toward black (f<1) or white (f>1). */
export function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => (f <= 1 ? c * f : c + (255 - c) * (f - 1)));
  return `#${ch.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`;
}

/** Normalized avatar (unknown ids → defaults) + resolved colors. */
export function resolveAvatar(avatar = {}, defs = null) {
  const base = { ...PAWN_DEFAULT, ...(defs?.default ?? {}) };
  const a = {};
  for (const key of Object.keys(PAWN_DEFAULT)) {
    const v = avatar?.[key];
    const known = defs?.parts?.[key] ? defs.parts[key].some((p) => p.id === v) : typeof v === 'string';
    a[key] = known ? v : base[key];
  }
  const colors = {
    skin: partColor(defs, 'skin', a.skin) ?? PAWN_COLORS.skin.light,
    hair: partColor(defs, 'hairColor', a.hairColor) ?? PAWN_COLORS.hairColor.black,
    outfit: partColor(defs, 'outfitColor', a.outfitColor) ?? PAWN_COLORS.outfitColor.blue,
  };
  return { avatar: a, colors };
}

const S = (shape, args, pos, color, extra = {}) => ({ shape, args, pos, color, ...extra });

const GOLD = '#f2c94c';
const FLOWER = '#ff8fb1';
const FRECKLE = '#a86442';

/** Tie / ribbon color that contrasts with the outfit color. */
function accentFor(outfitColorId) {
  return ['red', 'pink', 'orange'].includes(outfitColorId) ? '#34467a' : '#d8434a';
}

/** Body width factor for the build option. */
export function buildScale(build, defs = null) {
  const fromDefs = Number(defs?.parts?.build?.find((p) => p.id === build)?.scaleX);
  return fromDefs || PAWN_BUILD_SCALE[build] || 1;
}

/** Primitive specs for an avatar. */
export function pawnSpecs(avatar, defs = null) {
  const { avatar: a, colors } = resolveAvatar(avatar, defs);
  const { skin, hair, outfit } = colors;
  const girl = a.body === 'girl';
  const accent = accentFor(a.outfitColor);
  const specs = [];
  const add = (...s) => specs.push(...s);

  // ---- body (legs, torso, arms): widened/narrowed by the build afterwards ----
  const legColor =
    a.outfit === 'dress' || (a.outfit === 'uniform' && girl)
      ? skin
      : a.outfit === 'overalls' || a.outfit === 'tracksuit'
        ? outfit
        : a.outfit === 'suit'
          ? shade(outfit, 0.72)
          : a.outfit === 'hanbok'
            ? shade(outfit, 1.45)
            : PANTS;
  for (const x of [-0.11, 0.11]) {
    add(S('cyl', [0.075, 0.085, 0.34, 6], [x, 0.19, 0], legColor));
    add(S('box', [0.15, 0.08, 0.22], [x, 0.04, 0.03], SHOE));
  }

  const torso = (color, h = 0.5, y = 0.6) => S('cyl', [girl ? 0.23 : 0.25, girl ? 0.27 : 0.29, h, 10], [0, y, 0], color);
  const vNeck = (color = WHITE) => S('cone', [0.13, 0.12, 4], [0, 0.82, 0.12], color, { rot: [Math.PI, Math.PI / 4, 0] });
  let sleeves = skin;
  switch (a.outfit) {
    case 'hoodie':
      add(torso(outfit), S('sphere', [0.2, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2], [0, 0.84, -0.13], shade(outfit, 0.8), { rot: [-0.5, 0, 0] }));
      add(S('box', [0.26, 0.1, 0.03], [0, 0.46, 0.27], shade(outfit, 0.85)));
      sleeves = outfit;
      break;
    case 'shirt':
      add(torso(outfit), vNeck());
      add(S('box', [0.03, 0.34, 0.02], [0, 0.6, 0.28], shade(outfit, 0.8)));
      sleeves = outfit;
      break;
    case 'dress':
      add(S('cyl', [0.2, 0.43, 0.64, 10], [0, 0.54, 0], outfit));
      add(S('torus', [0.2, 0.025, 4, 12], [0, 0.72, 0], WHITE, { rot: [Math.PI / 2, 0, 0] }));
      break;
    case 'overalls':
      add(torso(WHITE));
      add(S('box', [0.3, 0.26, 0.05], [0, 0.58, 0.26], outfit), S('cyl', [0.29, 0.29, 0.14, 10], [0, 0.4, 0], outfit));
      for (const x of [-0.12, 0.12]) add(S('box', [0.05, 0.3, 0.04], [x, 0.74, 0.25], outfit));
      break;
    case 'hanbok':
      add(S('cyl', [0.24, 0.3, 0.34, 10], [0, 0.69, 0], outfit));
      add(S('box', [0.05, 0.2, 0.02], [0.06, 0.64, 0.3], '#d8413f', { rot: [0, 0, 0.3] }));
      add(S('cone', [0.1, 0.12, 4], [0, 0.83, 0.13], WHITE, { rot: [Math.PI, Math.PI / 4, 0] }));
      if (girl) add(S('cyl', [0.24, 0.45, 0.48, 10], [0, 0.3, 0], shade(outfit, 1.45)));
      sleeves = outfit;
      break;
    case 'suit':
      add(torso(outfit), vNeck());
      add(S('box', [0.05, 0.26, 0.02], [0, 0.66, 0.285], accent)); // tie
      for (const side of [-1, 1]) add(S('box', [0.05, 0.24, 0.02], [side * 0.075, 0.7, 0.27], shade(outfit, 0.82), { rot: [0, 0, side * 0.35] }));
      sleeves = outfit;
      break;
    case 'uniform':
      add(torso(outfit), vNeck());
      if (girl) {
        for (const x of [-0.05, 0.05]) add(S('cone', [0.045, 0.1, 4], [x, 0.79, 0.25], accent, { rot: [0, 0, x > 0 ? -Math.PI / 2 : Math.PI / 2] }));
        add(S('cyl', [0.25, 0.36, 0.26, 10], [0, 0.34, 0], shade(outfit, 0.7))); // pleated skirt
      } else {
        add(S('box', [0.045, 0.2, 0.02], [0, 0.7, 0.285], accent));
      }
      add(S('box', [0.07, 0.07, 0.02], [0.13, 0.62, 0.26], GOLD)); // emblem
      sleeves = outfit;
      break;
    case 'tracksuit': {
      add(torso(outfit));
      add(S('cyl', [0.17, 0.2, 0.08, 10], [0, 0.86, 0], shade(outfit, 0.88))); // high collar
      add(S('box', [0.018, 0.4, 0.02], [0, 0.62, 0.285], shade(outfit, 0.7))); // zipper
      const stripe = a.outfitColor === 'white' ? accent : WHITE;
      for (const side of [-1, 1]) add(S('box', [0.03, 0.46, 0.03], [side * 0.26, 0.6, 0.02], stripe, { rot: [0, 0, side * 0.08] }));
      sleeves = outfit;
      break;
    }
    default: // tshirt
      add(torso(outfit));
      break;
  }

  for (const side of [-1, 1]) {
    add(S('cyl', [0.06, 0.066, 0.42, 6], [side * 0.33, 0.6, 0], sleeves, { rot: [0, 0, side * 0.2] }));
    add(S('sphere', [0.075, 6, 4], [side * 0.37, 0.37, 0], skin));
  }

  // build: scale body width (x) and a bit of depth; arm/leg positions follow
  const sx = buildScale(a.build, defs);
  if (sx !== 1) {
    const sz = 1 + (sx - 1) * 0.8;
    for (const s of specs) {
      const sc = s.scale ?? [1, 1, 1];
      const rotated = s.rot && (s.rot[0] || s.rot[1] || s.rot[2]);
      // rotated parts (arms, collars) only move outwards; axis-aligned parts widen
      s.scale = rotated ? sc : [sc[0] * sx, sc[1], sc[2] * sz];
      s.pos = [s.pos[0] * sx, s.pos[1], s.pos[2] * sz];
    }
  }

  // ---- head ----
  const HY = 1.12;
  const headScale = a.face === 'round' ? [1.08, 0.97, 1] : a.face === 'square' ? [1.04, 0.98, 1] : [0.94, 1.04, 0.98];
  add(S('sphere', [0.34, 14, 10], [0, HY, 0], skin, { scale: headScale }));
  if (a.face === 'square') add(S('box', [0.5, 0.2, 0.44], [0, HY - 0.15, 0.02], skin)); // squared jaw

  // mouth
  const MZ = 0.325;
  switch (a.mouth) {
    case 'neutral':
      add(S('box', [0.07, 0.014, 0.02], [0, HY - 0.13, MZ], MOUTH));
      break;
    case 'grin':
      add(S('sphere', [0.055, 8, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2], [0, HY - 0.11, MZ - 0.02], '#7d2a2a', { scale: [1, 1, 0.5] }));
      break;
    case 'cat':
      for (const x of [-0.03, 0.03]) add(S('torus', [0.03, 0.01, 3, 6, Math.PI], [x, HY - 0.12, MZ], MOUTH, { rot: [0, 0, Math.PI] }));
      break;
    default: // smile
      add(S('torus', [0.05, 0.012, 3, 8, Math.PI], [0, HY - 0.1, MZ], MOUTH, { rot: [0, 0, Math.PI] }));
      break;
  }

  // cheeks
  if (a.cheek === 'blush') for (const x of [-0.19, 0.19]) add(S('sphere', [0.05, 6, 4], [x, HY - 0.07, 0.28], CHEEK, { scale: [1, 0.55, 0.5] }));
  if (a.cheek === 'freckles') {
    for (const x of [-1, 1]) {
      for (const [dx, dy] of [[0.16, -0.05], [0.2, -0.08], [0.23, -0.04]]) add(S('sphere', [0.012, 4, 3], [x * dx, HY + dy, 0.3 - (dx - 0.16) * 0.6], FRECKLE));
    }
  }

  // eyes
  for (const x of [-0.12, 0.12]) {
    const p = [x, HY + 0.02, 0.305];
    switch (a.eyes) {
      case 'sparkle':
        add(S('sphere', [0.06, 8, 6], p, DARK), S('sphere', [0.022, 4, 3], [x + 0.02, HY + 0.05, 0.36], WHITE));
        break;
      case 'smile':
        add(S('torus', [0.045, 0.014, 3, 8, Math.PI], [x, HY + 0.0, 0.32], DARK));
        break;
      case 'sleepy':
        add(S('box', [0.1, 0.02, 0.02], [x, HY + 0.01, 0.325], DARK));
        break;
      case 'cat':
        add(S('sphere', [0.05, 8, 6], p, DARK, { scale: [1.3, 0.7, 1], rot: [0, 0, x < 0 ? -0.35 : 0.35] }));
        add(S('box', [0.012, 0.05, 0.02], [x, HY + 0.02, 0.35], '#d9a13a'));
        break;
      case 'star':
        add(S('sphere', [0.055, 8, 6], p, DARK), S('cone', [0.026, 0.01, 5], [x, HY + 0.03, 0.355], '#fff7c2', { rot: [Math.PI / 2, 0, 0] }));
        break;
      default:
        add(S('sphere', [0.045, 8, 6], p, DARK));
        break;
    }
  }

  // ---- hair ----
  const cap = (len = 0.5, tilt = -0.22) => S('sphere', [0.365, 14, 8, 0, Math.PI * 2, 0, Math.PI * len], [0, HY + 0.03, -0.01], hair, { rot: [tilt, 0, 0] });
  switch (a.hair) {
    case 'bob':
      add(S('sphere', [0.38, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.66], [0, HY + 0.01, -0.03], hair, { rot: [-0.35, 0, 0] }));
      break;
    case 'long':
      add(cap(0.52), S('box', [0.64, 0.66, 0.16], [0, HY - 0.26, -0.2], hair));
      break;
    case 'ponytail':
      add(cap(), S('sphere', [0.1, 6, 5], [0, HY + 0.1, -0.36], hair), S('cyl', [0.08, 0.03, 0.42, 6], [0, HY - 0.14, -0.43], hair, { rot: [0.35, 0, 0] }));
      break;
    case 'twintail':
      add(cap());
      for (const x of [-0.37, 0.37]) add(S('cyl', [0.09, 0.035, 0.48, 6], [x, HY - 0.17, -0.06], hair, { rot: [0, 0, x > 0 ? 0.15 : -0.15] }));
      break;
    case 'spiky':
      add(cap());
      for (let i = 0; i < 5; i++) {
        const ang = (i / 5) * Math.PI * 2;
        add(S('cone', [0.1, 0.3, 5], [Math.sin(ang) * 0.17, HY + 0.34, Math.cos(ang) * 0.17 - 0.03], hair, { rot: [Math.cos(ang) * 0.5, 0, -Math.sin(ang) * 0.5] }));
      }
      break;
    case 'curly':
      add(cap(0.52));
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2 + 0.4;
        add(S('sphere', [0.13, 6, 5], [Math.sin(ang) * 0.3, HY + 0.2, Math.cos(ang) * 0.3 - 0.04], hair));
      }
      break;
    case 'bun':
      add(cap(), S('sphere', [0.15, 8, 6], [0, HY + 0.4, -0.06], hair));
      break;
    case 'twoblock':
      // short sides + a fuller top that overhangs the forehead
      add(cap(0.4), S('sphere', [0.33, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2], [0, HY + 0.12, 0.02], hair, { scale: [1.05, 0.75, 1.1], rot: [-0.12, 0, 0] }));
      break;
    case 'parted':
      add(cap(0.55), S('sphere', [0.2, 8, 6], [-0.13, HY + 0.22, 0.2], hair, { scale: [1.3, 0.55, 0.8], rot: [0, 0, 0.35] }));
      break;
    case 'halfup':
      add(cap(0.52), S('box', [0.6, 0.5, 0.14], [0, HY - 0.2, -0.22], hair), S('sphere', [0.1, 6, 5], [0, HY + 0.22, -0.32], hair));
      break;
    case 'wavy':
      add(cap(0.54));
      for (const x of [-1, 1]) {
        for (let i = 0; i < 3; i++) add(S('sphere', [0.12, 6, 5], [x * (0.26 + (i % 2) * 0.05), HY - 0.1 - i * 0.17, -0.16], hair));
      }
      break;
    default: // short
      add(cap(0.48));
      break;
  }

  // ---- accessory ----
  switch (a.accessory) {
    case 'glasses':
      for (const x of [-0.12, 0.12]) add(S('torus', [0.065, 0.013, 4, 12], [x, HY + 0.02, 0.33], DARK));
      add(S('box', [0.1, 0.015, 0.015], [0, HY + 0.03, 0.34], DARK));
      break;
    case 'sunglasses':
      for (const x of [-0.11, 0.11]) add(S('box', [0.14, 0.085, 0.03], [x, HY + 0.02, 0.33], '#141414'));
      add(S('box', [0.1, 0.02, 0.02], [0, HY + 0.04, 0.34], '#141414'));
      break;
    case 'cap':
      add(S('cyl', [0.37, 0.37, 0.14, 12], [0, HY + 0.25, -0.01], shade(outfit, 0.9)), S('box', [0.36, 0.03, 0.28], [0, HY + 0.2, 0.33], shade(outfit, 0.75)));
      break;
    case 'ribbon':
      for (const x of [-0.11, 0.11]) add(S('cone', [0.09, 0.2, 4], [x, HY + 0.36, -0.06], '#ff5c8a', { rot: [0, 0, x > 0 ? -Math.PI / 2 : Math.PI / 2] }));
      add(S('sphere', [0.05, 6, 4], [0, HY + 0.36, -0.06], '#ff5c8a'));
      break;
    case 'headband':
      add(S('torus', [0.35, 0.03, 4, 16], [0, HY + 0.17, -0.03], shade(outfit, 0.9), { rot: [Math.PI / 2 - 0.35, 0, 0] }));
      break;
    case 'earrings':
      for (const x of [-0.345, 0.345]) add(S('sphere', [0.035, 6, 4], [x, HY - 0.12, 0.02], GOLD));
      break;
    case 'hairpin':
      for (let i = 0; i < 5; i++) {
        const ang = (i / 5) * Math.PI * 2;
        add(S('sphere', [0.035, 5, 4], [0.2 + Math.cos(ang) * 0.04, HY + 0.24 + Math.sin(ang) * 0.04, 0.26], FLOWER));
      }
      add(S('sphere', [0.025, 5, 4], [0.2, HY + 0.24, 0.285], GOLD));
      break;
    default:
      break;
  }
  return specs;
}
