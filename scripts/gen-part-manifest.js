#!/usr/bin/env node
// Upsert paper-doll `part` items (Stage 5.5-B) into server/assets/manifest.json from server/data/avatars.json.
//
//   node scripts/gen-part-manifest.js            # write
//   node scripts/gen-part-manifest.js --dry-run  # only report
//
// Idempotent: non-part items are never touched; existing part items keep status/accepted/meta.tintRef
// (and their output path once accepted); part items whose option disappeared are removed unless accepted.
// Then: node scripts/gen-assets.js --kind part --accept-first --parallel 2
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MANIFEST_PATH, loadManifest, saveManifest, validateManifest } from '../server/assets/manifest.js';
import { EXPRESSIONS, NO_LAYER, partId, partOutput } from '../server/assets/partStack.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const AVATARS_PATH = path.join(ROOT, 'server', 'data', 'avatars.json');

/** Neutral colours the tintable layers are generated in (the measured value lands in meta.tintRef). */
export const NEUTRALS = { hair: '#4a4440', outfit: '#c8c8c8', skin: '#e6b48f' };

const SIZE = { w: 1024, h: 1536 };
const STEPS = (tail) => ['chromaKey', `resize:${SIZE.w}x${SIZE.h}`, ...tail];
const MANNEQUIN_BASE = partId.mannequin('girl', 'normal');

/** Categories that get layers (1:1 with avatars.json options minus NO_LAYER). */
export const LAYERED = ['body', 'build', 'face', 'eyes', 'mouth', 'cheek', 'hair', 'outfit', 'accessory'];

const EXPRESSION_DESC = {
  joy: 'joy: closed happy eyes shaped like upside-down U arcs, happy eyebrows, a big open smiling mouth and rosy blush',
  cry: 'crying: sad eyebrows, teary closed eyes with big tears streaming down the cheeks, a wavy wailing open mouth',
  shock: 'shock: wide open eyes with tiny pupils, raised eyebrows, a round open O-shaped mouth and a few blue shock lines on the forehead',
  angry: 'angry: sharply slanted angry eyebrows, glaring eyes, a frowning mouth with gritted teeth and a red cross-shaped anger mark near the forehead',
  love: 'in love: pink heart-shaped eyes, a happy open smile and pink blush',
  sweat: 'nervous: worried eyebrows, awkward eyes, a nervous wobbly smile and a big blue sweat drop on the side of the forehead',
  shy: 'shy: eyes looking away shyly, soft eyebrows, a small wavy embarrassed mouth and strong red blush on both cheeks',
};
const EXPRESSION_LABEL = { joy: '기쁨', cry: '울음', shock: '놀람', angry: '화남', love: '하트', sweat: '땀', shy: '부끄러움' };

/** Accessories drawn over hair are generated on the bob hairstyle; glasses over the round eyes. */
const ACCESSORY_BASE = {
  glasses: partId.eyes('round'),
  sunglasses: partId.eyes('round'),
  cap: partId.hair('bob'),
  ribbon: partId.hair('bob'),
  headband: partId.hair('bob'),
  hairpin: partId.hair('bob'),
};
const ACCESSORY_DESC = {
  glasses: 'round glasses with thin dark frames and clear lenses, worn over the eyes (the eyes stay visible through the lenses)',
  sunglasses: 'dark sunglasses worn over the eyes',
  cap: 'a navy blue baseball cap worn on the head over the hair',
  ribbon: 'a big red hair ribbon bow on the side of the head, on top of the hair',
  headband: 'a pastel pink headband on the hair',
  hairpin: 'a small yellow flower hairpin clipped on the side of the hair',
  earrings: 'small round gold earrings on both earlobes',
};

/** Hair descriptions that need more than promptDesc for the edit (the model otherwise keeps the scalp bald). */
const HAIR_DESC = {
  braid: 'full hair covering the whole scalp with a centre parting, pulled back and gathered into a single long thick braid that hangs over the front of one shoulder',
  buzz: 'a very short buzz cut: a thin even layer of short hair covering the whole scalp',
};

const P = (s) => s.replace(/\s+/g, ' ').trim();
const nameOf = (avatars, cat, id) => avatars.parts[cat]?.find((o) => o.id === id)?.name ?? id;
const descOf = (avatars, cat, id) => avatars.parts[cat]?.find((o) => o.id === id)?.promptDesc || id;

function item({ id, label, prompt, refs, output, postprocess, meta }) {
  return { id, kind: 'part', label, aspect: '2:3', size: SIZE, prompt: P(prompt), refs, output, postprocess, candidates: 2, status: 'todo', meta };
}

/** Pure: every part item for an avatars.json document, in generation order. */
export function buildPartItems(avatars) {
  const opts = (cat) => (avatars.parts[cat] ?? []).map((o) => o.id).filter((id) => !(NO_LAYER[cat] ?? []).includes(id));
  const bodies = opts('body');
  const builds = opts('build');
  const items = [];
  const bodyName = (b) => nameOf(avatars, 'body', b);
  const buildName = (b) => nameOf(avatars, 'build', b);

  // 1. Mannequins: girl/normal from the style anchor; everything else is an edit aligned by the head box.
  const refBody = bodies.includes('girl') ? 'girl' : bodies[0];
  const refBuild = builds.includes('normal') ? 'normal' : builds[0];
  const mannequinPrompt = (body) =>
    `{{style}} {{sameStyle}} Character-creator base mannequin: a chibi young ${body === 'boy' ? 'boy' : 'girl'}, full body, front view,
     perfectly symmetric neutral standing pose, arms held slightly away from the body with open hands, legs straight with feet
     slightly apart, feet fully visible, centered with generous margin on every side. Completely bald smooth round head with NO hair
     at all and simple ears. {{blankFace}} Only smooth skin inside a slim oval face outline. Medium neutral skin tone (${NEUTRALS.skin})
     everywhere on the skin. Wearing only a plain simple pale cyan (#8fd8e0) sleeveless tank top and plain pale cyan shorts, no
     patterns, no logos. Barefoot. {{magentaBg}} Portrait 2:3.`;
  const mannequinOrder = [[refBody, refBuild], ...bodies.filter((b) => b !== refBody).map((b) => [b, refBuild])];
  for (const b of bodies) for (const bl of builds) if (bl !== refBuild) mannequinOrder.push([b, bl]);
  for (const [body, build] of mannequinOrder) {
    const id = partId.mannequin(body, build);
    const meta = { category: 'body', option: body, body, build, slot: 'mannequin', tint: 'skin', tintMode: 'selective', neutral: NEUTRALS.skin };
    let prompt;
    let refs;
    let steps;
    if (body === refBody && build === refBuild) {
      prompt = mannequinPrompt(body);
      refs = ['style-anchor'];
      steps = STEPS(['mannequin']);
    } else if (build === refBuild) {
      prompt = `{{style}} {{keepMannequin}} ONLY change the body into a ${descOf(avatars, 'body', body).replace(/^an? /, '')}'s body of the same
        height: ${body === 'boy' ? 'slightly broader shoulders, a straighter waist and hips, boyish arms and legs' : 'a girlish figure'}. Keep the
        head EXACTLY identical in size, shape and position (still bald, same ears). {{blankFace}} Same pose and hand positions, the same
        plain pale cyan (#8fd8e0) tank top and shorts, barefoot. Portrait 2:3.`;
      refs = [MANNEQUIN_BASE];
      meta.base = MANNEQUIN_BASE;
      steps = STEPS(['alignHead', 'mannequin']);
    } else {
      const from = partId.mannequin(body, refBuild);
      prompt = `{{style}} {{keepMannequin}} ONLY change the body build to ${descOf(avatars, 'build', build)}${
        build === 'slim' ? ' (thinner torso, arms and legs)' : build === 'chubby' ? ' (rounder tummy, fuller torso, thicker arms and legs)' : ''
      }. Keep the head EXACTLY identical in size, shape and position (still bald, same ears). {{blankFace}} Same height, same pose and
        hand positions, the same plain pale cyan (#8fd8e0) tank top and shorts fitted to the new build, barefoot. Portrait 2:3.`;
      refs = [from];
      meta.base = from;
      steps = STEPS(['alignHead', 'mannequin']);
    }
    items.push(item({ id, label: `파츠 · 마네킹 (${bodyName(body)}·${buildName(build)})`, prompt, refs, output: partOutput.mannequin(body, build), postprocess: steps, meta }));
  }

  const onBase = (base = MANNEQUIN_BASE) => ({ refs: [base], base });
  const edit = (what) => `{{style}} {{keepMannequin}} ONLY add ${what} Portrait 2:3.`;

  // 2. Hair (body-independent, on the reference mannequin) → front/back (+ erase for hidden ears).
  for (const h of opts('hair')) {
    const { refs, base } = onBase();
    items.push(
      item({
        id: partId.hair(h),
        label: `파츠 · 머리 ${nameOf(avatars, 'hair', h)}`,
        prompt: edit(`hair: ${HAIR_DESC[h] ?? descOf(avatars, 'hair', h)}, {{neutralHair}}. The hair grows from the scalp and covers the top and sides of
          the head — the head is no longer bald (keep the ears where the style shows them). {{blankFace}}`),
        refs,
        output: partOutput.hair(h),
        postprocess: STEPS(['diffExtract:hair']),
        meta: { category: 'hair', option: h, slot: 'hair', tint: 'hair', neutral: NEUTRALS.hair, base, ...(h === 'bob' ? { src: true } : {}) },
      }),
    );
  }

  // 3. Face-shape overlays (slim = the mannequin itself).
  const FACE = {
    round: 'a round face with fuller, chubby cheeks and a round jaw line (slightly wider lower face)',
    square: 'a clearly square face: a noticeably broader lower face with a flat, angular square jaw line and defined jaw corners',
  };
  for (const f of opts('face')) {
    const { refs, base } = onBase();
    items.push(
      item({
        id: partId.face(f),
        label: `파츠 · 얼굴형 ${nameOf(avatars, 'face', f)}`,
        prompt: `{{style}} {{keepMannequin}} ONLY change the face shape to ${FACE[f] ?? descOf(avatars, 'face', f)}, with the same skin color,
          the same head top, ears and position. {{blankFace}} Portrait 2:3.`,
        refs,
        output: partOutput.face(f),
        postprocess: STEPS(['diffExtract:face']),
        meta: { category: 'face', option: f, slot: 'face', tint: 'skin', tintMode: 'selective', neutral: NEUTRALS.skin, base },
      }),
    );
  }

  // 4. Eyes (+ closed/blink variants drawn from the open eyes), mouths, cheeks, expressions.
  for (const e of opts('eyes')) {
    const { refs, base } = onBase();
    items.push(
      item({
        id: partId.eyes(e),
        label: `파츠 · 눈 ${nameOf(avatars, 'eyes', e)}`,
        prompt: edit(`eyes and eyebrows on the blank face at the usual position in the middle of the face: ${descOf(avatars, 'eyes', e)},
          dark brown irises with white highlights, simple thin dark brown eyebrows. No mouth, no nose, no blush. Still bald.`),
        refs,
        output: partOutput.eyes(e),
        postprocess: STEPS(['diffExtract:eyes']),
        meta: { category: 'eyes', option: e, slot: 'eyes', tint: null, base, src: true },
      }),
    );
  }
  for (const e of opts('eyes')) {
    items.push(
      item({
        id: partId.eyesClosed(e),
        label: `파츠 · 감은 눈 ${nameOf(avatars, 'eyes', e)}`,
        prompt: `{{style}} Edit the reference image. Keep EVERYTHING else pixel-identical: the same character, the same eyebrows, bald
          head, body, pose, position, size and scale on the canvas, same line weight, same flat magenta background. ONLY close the eyes:
          replace each open eye with gently closed eyelids drawn as a curved line with eyelashes, exactly where the eyes are now and at the
          same width. No mouth. Portrait 2:3.`,
        refs: [partId.eyes(e)],
        output: partOutput.eyesClosed(e),
        postprocess: STEPS(['diffExtract:eyes']),
        meta: { category: 'eyes', option: e, slot: 'eyesClosed', tint: null, base: MANNEQUIN_BASE },
      }),
    );
  }
  for (const mo of opts('mouth')) {
    const { refs, base } = onBase();
    items.push(
      item({
        id: partId.mouth(mo),
        label: `파츠 · 입 ${nameOf(avatars, 'mouth', mo)}`,
        prompt: edit(`a mouth on the blank face at the usual position in the lower middle of the face: ${descOf(avatars, 'mouth', mo)},
          small and cute. No eyes, no eyebrows, no nose. Still bald.`),
        refs,
        output: partOutput.mouth(mo),
        postprocess: STEPS(['diffExtract:mouth']),
        meta: { category: 'mouth', option: mo, slot: 'mouth', tint: null, base },
      }),
    );
  }
  const CHEEK = { blush: 'clearly visible soft pink blush ovals on both cheeks', freckles: 'a few small light-brown freckles on both cheeks and across the nose bridge area' };
  for (const c of opts('cheek')) {
    const { refs, base } = onBase();
    items.push(
      item({
        id: partId.cheek(c),
        label: `파츠 · 볼 ${nameOf(avatars, 'cheek', c)}`,
        prompt: edit(`${CHEEK[c] ?? descOf(avatars, 'cheek', c)}. No eyes, no mouth, no nose. Still bald.`),
        refs,
        output: partOutput.cheek(c),
        postprocess: STEPS(['diffExtract:cheek']),
        // Freckle edits also repaint a little cheek skin: tint the layer like skin (dots become darker skin shades).
        meta: { category: 'cheek', option: c, slot: 'cheek', ...(c === 'freckles' ? { tint: 'skin', tintMode: 'selective', neutral: NEUTRALS.skin } : { tint: null }), base },
      }),
    );
  }
  for (const x of EXPRESSIONS) {
    const { refs, base } = onBase();
    items.push(
      item({
        id: partId.expression(x),
        label: `파츠 · 표정 ${EXPRESSION_LABEL[x] ?? x}`,
        prompt: edit(`a full facial expression on the blank face — ${EXPRESSION_DESC[x] ?? x}. Draw the complete eyes, eyebrows and mouth (and
          any effects) at the usual positions, large enough to fully cover the normal eye and mouth area. Still bald, nothing else changes.`),
        refs,
        output: partOutput.expression(x),
        postprocess: STEPS(['diffExtract:expression']),
        meta: { category: 'expression', option: x, slot: 'expression', expression: x, tint: null, base },
      }),
    );
  }

  // 5. Accessories (natural colours).
  for (const a of opts('accessory')) {
    const { refs, base } = onBase(ACCESSORY_BASE[a] ?? MANNEQUIN_BASE);
    const keep = base === MANNEQUIN_BASE ? '{{keepMannequin}}' : `Edit the reference image. Keep EVERYTHING else pixel-identical: the same character, ${
      base.startsWith('part-hair') ? 'the same hair, ' : 'the same eyes and eyebrows, '
    }bald parts, body, pose, position, size and scale on the canvas, same line weight, same flat magenta background. Do not move, redraw or recolor anything that is not part of the change.`;
    items.push(
      item({
        id: partId.accessory(a),
        label: `파츠 · 액세서리 ${nameOf(avatars, 'accessory', a)}`,
        prompt: `{{style}} ${keep} ONLY add ${ACCESSORY_DESC[a] ?? descOf(avatars, 'accessory', a)}. Nothing else changes. Portrait 2:3.`,
        refs,
        output: partOutput.accessory(a),
        postprocess: STEPS(['diffExtract:accessory']),
        meta: { category: 'accessory', option: a, slot: 'accessory', tint: null, base },
      }),
    );
  }

  // 6. Outfits: reference build first (both bodies), then the other builds reusing the reference design.
  const outfits = avatars.parts.outfit ?? [];
  const outfitItem = (o, body, build) => {
    const tintable = o.tintable !== false;
    const colours = tintable ? '{{neutralOutfit}}' : 'In their natural real-world colors';
    const mannequin = partId.mannequin(body, build);
    const design = partId.outfit(o.id, body, refBuild);
    const first = build === refBuild;
    const prompt = first
      ? `{{style}} {{keepMannequin}} ONLY dress the character in: ${o.promptDesc || o.id}, with matching shoes. {{fullyDressed}} ${colours}. Keep the head, face, hands and body shape unchanged (still bald). {{blankFace}} Portrait 2:3.`
      : `{{style}} Edit the FIRST reference image (the bald mannequin): keep its head, face, body build, pose, position, size and scale on the
         canvas pixel-identical and keep the flat magenta background. ONLY dress it in exactly the same outfit as shown in the SECOND
         reference image (${o.promptDesc || o.id}): same design, same details, same colors, fitted naturally to this ${descOf(avatars, 'build', build)},
         with matching shoes. {{fullyDressed}} ${colours}. Still bald. {{blankFace}} Portrait 2:3.`;
    return item({
      id: partId.outfit(o.id, body, build),
      label: `파츠 · 의상 ${o.name ?? o.id} (${bodyName(body)}·${buildName(build)})`,
      prompt,
      refs: first ? [mannequin] : [mannequin, design],
      output: partOutput.outfit(o.id, body, build),
      postprocess: STEPS(['diffExtract:body']),
      meta: {
        category: 'outfit',
        option: o.id,
        body,
        build,
        slot: 'outfit',
        tint: tintable ? 'outfit' : null,
        ...(tintable ? { neutral: NEUTRALS.outfit } : {}),
        base: mannequin,
        ...(/\b(hat|cap|hood)\b/i.test(o.promptDesc ?? '') ? { diff: { headwear: true } } : {}),
      },
    });
  };
  for (const body of bodies) for (const o of outfits) items.push(outfitItem(o, body, refBuild));
  for (const build of builds.filter((b) => b !== refBuild)) for (const body of bodies) for (const o of outfits) items.push(outfitItem(o, body, build));
  return items;
}

/**
 * Pure merge: non-part items untouched (and first), part items in generation order. Existing part items keep
 * status/accepted/meta.tintRef (and their output once accepted); stale part items are dropped unless accepted.
 * @returns {{manifest, added: string[], updated: string[], removed: string[], kept: string[]}}
 */
export function mergePartItems(manifest, parts) {
  const others = manifest.items.filter((i) => i.kind !== 'part');
  const existing = new Map(manifest.items.filter((i) => i.kind === 'part').map((i) => [i.id, i]));
  const wanted = new Set(parts.map((p) => p.id));
  const added = [];
  const updated = [];
  const merged = parts.map((p) => {
    const old = existing.get(p.id);
    if (!old) {
      added.push(p.id);
      return p;
    }
    const next = { ...p, status: old.status, ...(old.accepted ? { accepted: old.accepted } : {}) };
    if (old.meta?.tintRef && p.meta.tint) next.meta = { ...p.meta, tintRef: old.meta.tintRef };
    if (old.status === 'accepted') next.output = old.output;
    if (JSON.stringify(next) !== JSON.stringify(old)) updated.push(p.id);
    return next;
  });
  const removed = [];
  const kept = [];
  for (const [id, old] of existing) {
    if (wanted.has(id)) continue;
    if (old.status === 'accepted') {
      kept.push(id);
      merged.push(old);
    } else removed.push(id);
  }
  return { manifest: { ...manifest, items: [...others, ...merged] }, added, updated, removed, kept };
}

export async function run(argv = [], { manifestPath = MANIFEST_PATH, avatarsPath = AVATARS_PATH, out = console.log } = {}) {
  const dry = argv.includes('--dry-run');
  const avatars = JSON.parse(await readFile(avatarsPath, 'utf8'));
  const manifest = await loadManifest(manifestPath);
  const r = mergePartItems(manifest, buildPartItems(avatars));
  const v = validateManifest(r.manifest);
  if (!v.ok) throw new Error(v.errors.join('\n'));
  const parts = r.manifest.items.filter((i) => i.kind === 'part');
  out(`part 항목 ${parts.length}개 (신규 ${r.added.length}, 갱신 ${r.updated.length}, 삭제 ${r.removed.length}, 채택돼 유지 ${r.kept.length})`);
  if (!dry) await saveManifest(r.manifest, manifestPath);
  return r;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  run(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
