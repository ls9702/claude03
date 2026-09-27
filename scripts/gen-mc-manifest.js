#!/usr/bin/env node
// Upsert the MC NPC items (Stage 5.6: 호야 & 봄이, the user's Shih Tzus) into server/assets/manifest.json.
//
//   node scripts/gen-mc-manifest.js            # write
//   node scripts/gen-mc-manifest.js --dry-run  # only report
//
// Items: mc-<dog>-<expression> (7, neutral = base), mc-<dog>-pose-<pose> (wave/clap/mic), mc-duo, bg-studio.
// Each MC item sends the style anchor + the real photos from DATA_DIR/mc-refs (`localRefs`, gitignored, never
// published) as references. Idempotent: other items are untouched; existing MC items keep status/accepted/output.
// Then (Gemini credits needed):
//   node scripts/gen-assets.js --kind mc --accept-first --parallel 2 && node scripts/gen-assets.js --only bg-studio --accept-first
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MANIFEST_PATH, MC_ITEM_EXPRESSIONS, loadManifest, saveManifest, validateManifest } from '../server/assets/manifest.js';

export const MC_DOGS = ['hoya', 'bomi'];
export const MC_ITEM_POSES_GEN = ['wave', 'clap', 'mic'];

/** Exact markings (from the reference photos) — the art must match these. */
export const DOG_DESC = {
  hoya:
    'HOYA, a boy Shih Tzu dog, the older brother, as a cute chibi TV-show mascot. Coat: almost entirely white and very fluffy, with a ' +
    'slightly creamy beige tint on top of the head; floppy ears that are dark brown-black with a warm tan patch where ' +
    'they join the head; light tan / caramel fur around both eyes; big round shiny dark eyes; small black button nose; ' +
    'short white beard; slight underbite with the pink tip of the tongue peeking out; goofy, cheerful, slightly derpy ' +
    'face. Wears a small orange bandana scarf around the neck. Huge round fluffy head, small round body, short legs, ' +
    'white fluffy plume tail.',
  bomi:
    'BOMI, a girl Shih Tzu dog, the younger sister, as a cute chibi TV-show mascot with a black-and-white coat: the sides of the head, ' +
    'both long floppy ears and a large mask around BOTH eyes are black; a clear white blaze stripe runs from between ' +
    'the eyes up the middle of the forehead to the top of the head; white muzzle with a slightly grey-beige beard and ' +
    'chin; white chest and white front legs; black back and shoulders; small black speckles on the white front paws; ' +
    'big round dark eyes; black nose; calm, serious, slightly grumpy "unimpressed" face. Wears a small purple bow tie. ' +
    'Huge round head, small round body, short legs, fluffy tail.',
};

const LABEL = { hoya: '호야', bomi: '봄이' };
const EXPR_LABEL = { neutral: '기본', joy: '기쁨', surprise: '놀람', sad: '슬픔', angry: '화남', proud: '자신만만', sleepy: '졸림' };
const POSE_LABEL = { wave: '손 흔들기', clap: '박수', mic: '마이크 들기' };

export const EXPR_DESC = {
  neutral: {
    hoya: 'Default face: open happy eyes, mouth slightly open with the tongue tip out, relaxed sitting pose.',
    bomi: 'Default face: calm half-lidded unimpressed eyes, mouth closed, relaxed dignified sitting pose.',
  },
  joy: 'Overjoyed: eyes closed in happy upward arcs, wide open smiling mouth, ears lifted, tail wagging.',
  surprise: 'Surprised: eyes wide open with small pupils, round O-shaped mouth, ears flipped up, a small sweat drop.',
  sad: 'Sad: glossy teary eyes with one tear, droopy ears, small frown, head slightly lowered.',
  angry: 'Cute grumpy anger: furrowed brows, puffed cheeks, a small red anger mark, looking sideways with a huff.',
  proud: 'Proud and smug: eyes closed confidently, nose up, chest out, a small sparkle next to the head.',
  sleepy: 'Sleepy: droopy half-closed eyes, a big yawn, slouched, a small "Zz" bubble shape (no letters needed).',
};
export const POSE_DESC = {
  wave: 'Pose: waving one front paw high in greeting, the other paw on the ground, friendly face.',
  clap: 'Pose: sitting up on the hind legs and clapping both front paws together in front of the chest, happy face.',
  mic: 'Pose: holding a small black handheld microphone with one front paw near the mouth like a TV show host.',
};

const COMMON =
  'Draw it as a stylized 2D game illustration (not a photo): sitting upright facing the viewer, full body visible, ' +
  'centered with generous margin on every side, feet near the lower part of the canvas. The photo references show ' +
  'the real dog: match its fur pattern, markings and colors exactly.';
const SAME_DOG = 'Keep exactly the same dog design, markings, colors, accessory and proportions as the MC reference image.';

const MC_STEPS = ['chromaKey', 'resize:1024x1024'];
const photos = (dog, n = 2) => [1, 2].slice(0, n).map((i) => `data/mc-refs/${dog}-${i}.jpg`);

/** The MC item list (pure). */
export function mcItems() {
  const items = [];
  for (const dog of MC_DOGS) {
    const base = `mc-${dog}-neutral`;
    for (const expr of MC_ITEM_EXPRESSIONS) {
      const isBase = expr === 'neutral';
      const desc = typeof EXPR_DESC[expr] === 'string' ? EXPR_DESC[expr] : EXPR_DESC[expr][dog];
      items.push({
        id: `mc-${dog}-${expr}`,
        kind: 'mc',
        label: `MC ${LABEL[dog]} · ${EXPR_LABEL[expr]}`,
        aspect: '1:1',
        size: { w: 1024, h: 1024 },
        prompt: `{{style}} {{sameStyle}} {{magentaBg}} {{dog}} {{common}}${isBase ? '' : ' {{sameDog}}'} ${desc}`,
        vars: { dog: DOG_DESC[dog], common: COMMON, sameDog: SAME_DOG },
        refs: isBase ? ['style-anchor'] : ['style-anchor', base],
        localRefs: photos(dog, isBase ? 2 : 1),
        output: `mc/${dog}/${expr}.png`,
        postprocess: MC_STEPS,
        status: 'todo',
        candidates: 3,
        meta: { mc: dog, expression: expr },
      });
    }
    for (const pose of MC_ITEM_POSES_GEN) {
      items.push({
        id: `mc-${dog}-pose-${pose}`,
        kind: 'mc',
        label: `MC ${LABEL[dog]} · 포즈 ${POSE_LABEL[pose]}`,
        aspect: '1:1',
        size: { w: 1024, h: 1024 },
        prompt: `{{style}} {{sameStyle}} {{magentaBg}} {{dog}} {{common}} {{sameDog}} ${POSE_DESC[pose]}`,
        vars: { dog: DOG_DESC[dog], common: COMMON, sameDog: SAME_DOG },
        refs: ['style-anchor', base],
        localRefs: photos(dog, 1),
        output: `mc/${dog}/pose-${pose}.png`,
        postprocess: MC_STEPS,
        status: 'todo',
        candidates: 3,
        meta: { mc: dog, pose },
      });
    }
  }
  items.push({
    id: 'mc-duo',
    kind: 'mc',
    label: 'MC 호야 & 봄이 · 듀오',
    aspect: '3:2',
    size: { w: 1536, h: 1024 },
    prompt:
      '{{style}} {{sameStyle}} {{magentaBg}} Two chibi Shih Tzu TV-show host mascots sitting side by side, facing the ' +
      'viewer, full bodies visible with margin. On the LEFT: {{hoya}} On the RIGHT: {{bomi}} Hoya waves happily with ' +
      'one paw, Bomi holds a small handheld microphone and looks calm. Keep both dogs exactly like their MC reference ' +
      'images; the photo reference shows the real pair together.',
    vars: { hoya: DOG_DESC.hoya, bomi: DOG_DESC.bomi },
    refs: ['style-anchor', 'mc-hoya-neutral', 'mc-bomi-neutral'],
    localRefs: ['data/mc-refs/duo.jpg'],
    output: 'mc/duo.png',
    postprocess: ['chromaKey', 'resize:1536x1024'],
    status: 'todo',
    candidates: 3,
    meta: { mc: 'duo' },
  });
  items.push({
    id: 'bg-studio',
    kind: 'bg',
    label: '컷인 배경 · 인생 방송국 스튜디오',
    aspect: '16:9',
    size: { w: 1920, h: 1080 },
    prompt:
      '{{style}} {{sameStyle}} {{noPeople}} Scene: a bright, cheerful Korean TV variety show studio seen from the ' +
      'audience: a curved glossy stage with a low host desk in the center, warm spotlights and colorful stage lights ' +
      'hanging from a truss, big blank screens and a large blank sign board above the stage, star-shaped decorations, ' +
      'pastel orange and purple colors. Wide 16:9 background illustration for a game cut-in, leave open empty space ' +
      'in the lower center for two small mascot hosts to stand. No text, no letters.',
    refs: ['style-anchor'],
    output: 'bg/studio.webp',
    postprocess: ['resize:1920x1080', 'webp'],
    status: 'todo',
    meta: { scene: 'studio' },
  });
  return items;
}

/** Upsert into a manifest object (pure): keeps status/accepted/output of existing items. */
export function upsertMcItems(manifest) {
  const wanted = mcItems();
  const byId = new Map(manifest.items.map((i, k) => [i.id, k]));
  let added = 0;
  let updated = 0;
  for (const it of wanted) {
    const k = byId.get(it.id);
    if (k === undefined) {
      manifest.items.push(it);
      added++;
      continue;
    }
    const old = manifest.items[k];
    const next = { ...it, status: old.status, ...(old.accepted ? { accepted: old.accepted } : {}) };
    if (old.status === 'accepted') next.output = old.output;
    if (JSON.stringify(next) !== JSON.stringify(old)) updated++;
    manifest.items[k] = next;
  }
  return { manifest, added, updated, total: wanted.length };
}

async function main(argv) {
  const dry = argv.includes('--dry-run');
  const m = await loadManifest(MANIFEST_PATH);
  const r = upsertMcItems(m);
  const v = validateManifest(r.manifest);
  if (!v.ok) throw new Error(v.errors.join('\n'));
  console.log(`MC 항목 ${r.total}개: 추가 ${r.added}, 갱신 ${r.updated}${dry ? ' (dry-run)' : ''}`);
  if (!dry) await saveManifest(r.manifest, MANIFEST_PATH);
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? '')).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
