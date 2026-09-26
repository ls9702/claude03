// Paper-doll layer contract (Stage 5.5-B): ids, slots, z-order and the pure "which layers, in which
// order, with which tint" function. No Node/sharp/DOM imports, so the browser composer can import or copy
// it (the server uses it for contact sheets and QA).
//
// Every layer is a full 1024×1536 transparent image on the shared mannequin canvas, so composing is just
// drawing the stack at (0,0) in order.

export const CANVAS = { w: 1024, h: 1536 };
/**
 * Crop of the canvas that contains every accepted layer (afro, ribbon, chef hat … feet), for display.
 * Landmarks (all 6 mannequins agree within ±2 px): head box x 266..777, y 242..~712 (chin), feet y ≈ 1320..1360.
 */
export const CROP = { x: 96, y: 24, w: 848, h: 1376 };

/**
 * Draw order, bottom → top. `eyes` is taken by eyesClosed (blink) or expression; an expression also
 * suppresses `mouth` (it contains eyes + mouth + effects). `hat` = headwear split off an outfit (chef hat,
 * police cap, onesie hood) so it sits above the front hair. The back hair and the mannequin are drawn with the
 * hair's and the outfit's `erase` masks cut out (destination-out): ears hidden by hair, underwear beside
 * narrow trousers.
 */
export const Z_ORDER = ['backHair', 'mannequin', 'face', 'outfit', 'cheek', 'eyes', 'mouth', 'frontHair', 'hat', 'accessory'];

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

/** Option id → id/path-safe slug (camelCase → kebab: hanbokTrad → hanbok-trad). */
export const slug = (id) => String(id).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export const partId = {
  mannequin: (body, build) => `part-mannequin-${slug(body)}-${slug(build)}`,
  hair: (id) => `part-hair-${slug(id)}`,
  face: (id) => `part-face-${slug(id)}`,
  eyes: (id) => `part-eyes-${slug(id)}`,
  eyesClosed: (id) => `part-eyes-closed-${slug(id)}`,
  mouth: (id) => `part-mouth-${slug(id)}`,
  cheek: (id) => `part-cheek-${slug(id)}`,
  expression: (id) => `part-expr-${slug(id)}`,
  accessory: (id) => `part-acc-${slug(id)}`,
  outfit: (id, body, build) => `part-outfit-${slug(id)}-${slug(body)}-${slug(build)}`,
};

/** Published file (relative to public/assets/generated/) per item; hair adds -front / -back. */
export const partOutput = {
  mannequin: (body, build) => `parts/mannequin/${slug(body)}-${slug(build)}.webp`,
  hair: (id) => `parts/hair/${slug(id)}.webp`,
  face: (id) => `parts/face/${slug(id)}.webp`,
  eyes: (id) => `parts/eyes/${slug(id)}.webp`,
  eyesClosed: (id) => `parts/eyes-closed/${slug(id)}.webp`,
  mouth: (id) => `parts/mouth/${slug(id)}.webp`,
  cheek: (id) => `parts/cheek/${slug(id)}.webp`,
  expression: (id) => `parts/expression/${slug(id)}.webp`,
  accessory: (id) => `parts/accessory/${slug(id)}.webp`,
  outfit: (id, body, build) => `parts/outfit/${slug(body)}-${slug(build)}/${slug(id)}.webp`,
};

/**
 * Extra published files next to `output` (same stem + `-<key>`): hair `front`/`back`/`erase`, outfit
 * `hat`/`erase`, mannequin `base`. Only the ones listed in the asset's `files` exist.
 */
export function extraFile(output, key) {
  const stem = output.replace(/\.(png|webp)$/, '');
  return `${stem}-${key}${output.slice(stem.length)}`;
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
 * @param {(id: string) => ({url: string, files?: {front?, back?, hat?, erase?}, meta?: object} | null)} opts.lookup
 *        resolves an item id to its accepted asset (e.g. `/api/assets` → assets[id]); null → layer skipped
 * @param {object} opts.avatars   avatars.json (colours + defaults)
 * @param {string|null} [opts.expression]  one of EXPRESSIONS (replaces eyes + mouth)
 * @param {boolean} [opts.blink]  closed eyes (ignored when an expression is shown)
 * @returns {Array<{slot: string, id: string, src: string, tint: {channel, color, ref, mode} | null, erase?: string[]}>}
 */
export function layerStack(avatar, { lookup, avatars, expression = null, blink = false } = {}) {
  const a = { ...(avatars?.default ?? {}), ...(avatar ?? {}) };
  const tintFor = (meta) => {
    const channel = meta?.tint ?? null;
    if (!channel || !TINT_CATEGORY[channel]) return null;
    const color = colorOf(avatars, TINT_CATEGORY[channel], a[TINT_CATEGORY[channel]]);
    if (!color || !meta.tintRef) return null;
    return { channel, color, ref: meta.tintRef, mode: meta.tintMode ?? TINT_MODE[channel] };
  };
  const has = (cat) => a[cat] && !(NO_LAYER[cat] ?? []).includes(a[cat]);
  const expr = expression && EXPRESSIONS.includes(expression) ? expression : null;
  const hair = lookup(partId.hair(a.hair));
  // Outfit for this body × build; falls back to the reference build (the layer may then not hug the body
  // exactly, but it beats showing the bare mannequin) while a variant is missing.
  let outfitId = partId.outfit(a.outfit, a.body, a.build);
  let outfit = lookup(outfitId);
  const outfitFallback = !outfit;
  if (!outfit) {
    outfitId = partId.outfit(a.outfit, a.body, 'normal');
    outfit = lookup(outfitId);
  }
  const out = [];
  const push = (slot, id, item, src) => {
    if (item && src) out.push({ slot, id, src, tint: tintFor(item.meta) });
  };
  const one = (slot, id) => push(slot, id, lookup(id), lookup(id)?.url);
  // Erase masks = pixels an edit removed from the mannequin (ears hidden by hair, underwear beside narrow
  // trousers). They cut both layers below the face: the mannequin AND the back hair (which is the whole hair).
  const erase = [hair?.files?.erase, outfitFallback ? null : outfit?.files?.erase].filter(Boolean);
  const withErase = () => {
    const l = out.at(-1);
    if (erase.length && l) l.erase = erase;
  };
  for (const slot of Z_ORDER) {
    if (slot === 'backHair') {
      const n = out.length;
      push(slot, partId.hair(a.hair), hair, hair?.files?.back);
      if (out.length > n) withErase();
    } else if (slot === 'mannequin') {
      const n = out.length;
      one(slot, partId.mannequin(a.body, a.build));
      if (out.length > n) withErase();
    } else if (slot === 'face' && has('face')) one(slot, partId.face(a.face));
    else if (slot === 'outfit') push(slot, outfitId, outfit, outfit?.url);
    else if (slot === 'cheek' && has('cheek')) one(slot, partId.cheek(a.cheek));
    else if (slot === 'eyes') {
      if (expr) one('expression', partId.expression(expr));
      else if (blink) one('eyesClosed', partId.eyesClosed(a.eyes));
      else one('eyes', partId.eyes(a.eyes));
    } else if (slot === 'mouth' && !expr) one(slot, partId.mouth(a.mouth));
    else if (slot === 'frontHair') push(slot, partId.hair(a.hair), hair, hair?.files?.front);
    else if (slot === 'hat') push(slot, outfitId, outfit, outfit?.files?.hat);
    else if (slot === 'accessory' && has('accessory')) one(slot, partId.accessory(a.accessory));
  }
  return out;
}
