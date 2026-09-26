// Paper-doll layer contract (Stage 5.5-B): ids, slots, z-order and the pure "which layers, in which
// order, with which tint" function. No Node/sharp/DOM imports, so the browser composer can import or copy
// it (the server uses it for contact sheets and QA).
//
// Every layer is a full 1024×1536 transparent image on the shared mannequin canvas, so composing is just
// drawing the stack at (0,0) in order.

export const CANVAS = { w: 1024, h: 1536 };

/**
 * Draw order, bottom → top. `eyes` is taken by eyesClosed (blink) or expression; an expression also
 * suppresses `mouth` (it contains eyes + mouth + effects).
 */
export const Z_ORDER = ['backHair', 'mannequin', 'face', 'outfit', 'cheek', 'eyes', 'mouth', 'frontHair', 'accessory'];

/** Item slots (manifest meta.slot). A `hair` item publishes two layers: backHair + frontHair. */
export const PART_SLOTS = ['mannequin', 'hair', 'face', 'outfit', 'cheek', 'eyes', 'eyesClosed', 'mouth', 'expression', 'accessory'];

/** Tint channel → avatars.json category holding the colour (mirrors avatars.json `tint`). */
export const TINT_CATEGORY = { skin: 'skin', hair: 'hairColor', outfit: 'outfitColor' };
/** Default tint mode per channel (skin = selective: the pale-cyan underwear keeps its colour). */
export const TINT_MODE = { skin: 'selective', hair: 'full', outfit: 'full' };

/** Expression ids with a layer (eyes + mouth + effects). */
export const EXPRESSIONS = ['joy', 'cry', 'shock', 'angry', 'love', 'sweat', 'shy'];

/** Options that have no layer (the mannequin already is the "slim" face; none = nothing drawn). */
export const NO_LAYER = { face: ['slim'], cheek: ['none'], accessory: ['none'] };

export const partId = {
  mannequin: (body, build) => `part-mannequin-${body}-${build}`,
  hair: (id) => `part-hair-${id}`,
  face: (id) => `part-face-${id}`,
  eyes: (id) => `part-eyes-${id}`,
  eyesClosed: (id) => `part-eyes-closed-${id}`,
  mouth: (id) => `part-mouth-${id}`,
  cheek: (id) => `part-cheek-${id}`,
  expression: (id) => `part-expr-${id}`,
  accessory: (id) => `part-acc-${id}`,
  outfit: (id, body, build) => `part-outfit-${id}-${body}-${build}`,
};

/** Published file (relative to public/assets/generated/) per item; hair adds -front / -back. */
export const partOutput = {
  mannequin: (body, build) => `parts/mannequin/${body}-${build}.webp`,
  hair: (id) => `parts/hair/${id}.webp`,
  face: (id) => `parts/face/${id}.webp`,
  eyes: (id) => `parts/eyes/${id}.webp`,
  eyesClosed: (id) => `parts/eyes-closed/${id}.webp`,
  mouth: (id) => `parts/mouth/${id}.webp`,
  cheek: (id) => `parts/cheek/${id}.webp`,
  expression: (id) => `parts/expression/${id}.webp`,
  accessory: (id) => `parts/accessory/${id}.webp`,
  outfit: (id, body, build) => `parts/outfit/${body}-${build}/${id}.webp`,
};

/** `parts/hair/long.webp` → {front: 'parts/hair/long-front.webp', back: 'parts/hair/long-back.webp'}. */
export function hairFiles(output) {
  const base = output.replace(/\.(png|webp)$/, '');
  const ext = output.slice(base.length);
  return { front: `${base}-front${ext}`, back: `${base}-back${ext}` };
}

function colorOf(avatars, category, optionId) {
  const opts = avatars?.parts?.[category] ?? [];
  return (opts.find((o) => o.id === optionId) ?? opts.find((o) => o.id === avatars?.default?.[category]))?.color ?? null;
}

/**
 * Ordered layers for an avatar.
 * @param {object} avatar   avatars.json part ids {body, build, skin, face, eyes, mouth, cheek, hair, hairColor,
 *                          outfit, outfitColor, accessory} (missing keys fall back to avatars.default)
 * @param {object} opts
 * @param {(id: string) => ({src?: string, files?: {front?: string, back?: string}, meta?: object} | null)} opts.lookup
 *        resolves an item id to its accepted layer (null = not available → layer skipped)
 * @param {object} opts.avatars   avatars.json (colours + defaults)
 * @param {string|null} [opts.expression]  one of EXPRESSIONS (replaces eyes + mouth)
 * @param {boolean} [opts.blink]  closed eyes (ignored when an expression is shown)
 * @returns {Array<{slot: string, id: string, src: string, tint: {channel, color, ref, mode} | null}>}
 */
export function layerStack(avatar, { lookup, avatars, expression = null, blink = false } = {}) {
  const a = { ...(avatars?.default ?? {}), ...(avatar ?? {}) };
  const out = [];
  const tintFor = (meta) => {
    const channel = meta?.tint ?? null;
    if (!channel || !TINT_CATEGORY[channel]) return null;
    const color = colorOf(avatars, TINT_CATEGORY[channel], a[TINT_CATEGORY[channel]]);
    if (!color || !meta.tintRef) return null;
    return { channel, color, ref: meta.tintRef, mode: meta.tintMode ?? TINT_MODE[channel] };
  };
  const add = (slot, id, which) => {
    const item = lookup(id);
    if (!item) return;
    const src = which ? item.files?.[which] : item.src;
    if (!src) return;
    out.push({ slot, id, src, tint: tintFor(item.meta) });
  };
  const has = (cat) => a[cat] && !(NO_LAYER[cat] ?? []).includes(a[cat]);
  const expr = expression && EXPRESSIONS.includes(expression) ? expression : null;
  for (const slot of Z_ORDER) {
    if (slot === 'backHair') add(slot, partId.hair(a.hair), 'back');
    else if (slot === 'mannequin') add(slot, partId.mannequin(a.body, a.build));
    else if (slot === 'face' && has('face')) add(slot, partId.face(a.face));
    else if (slot === 'outfit') add(slot, partId.outfit(a.outfit, a.body, a.build));
    else if (slot === 'cheek' && has('cheek')) add(slot, partId.cheek(a.cheek));
    else if (slot === 'eyes') {
      if (expr) add('expression', partId.expression(expr));
      else add(blink ? 'eyesClosed' : 'eyes', blink ? partId.eyesClosed(a.eyes) : partId.eyes(a.eyes));
    } else if (slot === 'mouth' && !expr) add(slot, partId.mouth(a.mouth));
    else if (slot === 'frontHair') add(slot, partId.hair(a.hair), 'front');
    else if (slot === 'accessory' && has('accessory')) add(slot, partId.accessory(a.accessory));
  }
  return out;
}
