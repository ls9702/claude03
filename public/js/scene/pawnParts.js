// Avatar parts (server/data/avatars.json ids) → low-poly primitive specs for the 3D pawn.
// Pure (no three.js) so the mapping is unit-testable; pawn.js turns specs into one merged mesh.
//
// spec: { shape: 'sphere'|'cyl'|'box'|'cone'|'torus', args: [...three.js geometry args],
//         pos: [x,y,z], rot?: [x,y,z], scale?: [x,y,z], color: '#rrggbb' }
// The pawn faces +z, stands on y=0 and is ~1.6 units tall (head center y≈1.12).

/** Fallback colors (same values as avatars.json) when defs are not loaded. */
export const PAWN_COLORS = {
  skin: { fair: '#fde3cf', light: '#f6cfae', tan: '#dca77e', deep: '#a86f4c' },
  hairColor: { black: '#2b2222', brown: '#6b4226', blonde: '#e8c15a', red: '#a8452f', pink: '#f28bb3', blue: '#4d7fd6' },
  outfitColor: { red: '#e25b5b', orange: '#f39a3d', yellow: '#f2cf4a', green: '#5cb87a', blue: '#4f8ee0', purple: '#9a6ad6' },
};
export const PAWN_DEFAULT = { body: 'boy', skin: 'light', hair: 'short', hairColor: 'black', eyes: 'round', accessory: 'none', outfit: 'tshirt', outfitColor: 'blue' };

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

/** Primitive specs for an avatar. */
export function pawnSpecs(avatar, defs = null) {
  const { avatar: a, colors } = resolveAvatar(avatar, defs);
  const { skin, hair, outfit } = colors;
  const girl = a.body === 'girl';
  const specs = [];
  const add = (...s) => specs.push(...s);

  // legs + shoes
  const legColor = a.outfit === 'dress' ? skin : a.outfit === 'overalls' ? outfit : a.outfit === 'hanbok' ? shade(outfit, 1.45) : PANTS;
  for (const x of [-0.11, 0.11]) {
    add(S('cyl', [0.075, 0.085, 0.34, 6], [x, 0.19, 0], legColor));
    add(S('box', [0.15, 0.08, 0.22], [x, 0.04, 0.03], SHOE));
  }

  // torso by outfit
  const torso = (color, h = 0.5, y = 0.6) => S('cyl', [girl ? 0.23 : 0.25, girl ? 0.27 : 0.29, h, 10], [0, y, 0], color);
  let sleeves = skin;
  switch (a.outfit) {
    case 'hoodie':
      add(torso(outfit), S('sphere', [0.2, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2], [0, 0.84, -0.13], shade(outfit, 0.8), { rot: [-0.5, 0, 0] }));
      add(S('box', [0.26, 0.1, 0.03], [0, 0.46, 0.27], shade(outfit, 0.85)));
      sleeves = outfit;
      break;
    case 'shirt':
      add(torso(outfit), S('cone', [0.13, 0.12, 4], [0, 0.82, 0.12], WHITE, { rot: [Math.PI, Math.PI / 4, 0] }));
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
    default: // tshirt
      add(torso(outfit));
      break;
  }

  // arms + hands
  for (const side of [-1, 1]) {
    add(S('cyl', [0.06, 0.066, 0.42, 6], [side * 0.33, 0.6, 0], sleeves, { rot: [0, 0, side * 0.2] }));
    add(S('sphere', [0.075, 6, 4], [side * 0.37, 0.37, 0], skin));
  }

  // head
  const HY = 1.12;
  add(S('sphere', [0.34, 14, 10], [0, HY, 0], skin));
  add(S('box', [0.08, 0.02, 0.02], [0, HY - 0.13, 0.325], MOUTH));
  if (girl || a.eyes === 'smile') for (const x of [-0.19, 0.19]) add(S('sphere', [0.05, 6, 4], [x, HY - 0.07, 0.28], CHEEK, { scale: [1, 0.55, 0.5] }));

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
      default:
        add(S('sphere', [0.045, 8, 6], p, DARK));
        break;
    }
  }

  // hair
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
    default: // short
      add(cap(0.48));
      break;
  }

  // accessory
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
      add(S('cyl', [0.37, 0.37, 0.14, 12], [0, HY + 0.25, -0.01], '#e2504c'), S('box', [0.36, 0.03, 0.28], [0, HY + 0.2, 0.33], '#e2504c'));
      break;
    case 'ribbon':
      for (const x of [-0.11, 0.11]) add(S('cone', [0.09, 0.2, 4], [x, HY + 0.36, -0.06], '#ff5c8a', { rot: [0, 0, x > 0 ? -Math.PI / 2 : Math.PI / 2] }));
      add(S('sphere', [0.05, 6, 4], [0, HY + 0.36, -0.06], '#ff5c8a'));
      break;
    case 'headband':
      add(S('torus', [0.35, 0.03, 4, 16], [0, HY + 0.17, -0.03], shade(outfit, 0.9), { rot: [Math.PI / 2 - 0.35, 0, 0] }));
      break;
    default:
      break;
  }
  return specs;
}
