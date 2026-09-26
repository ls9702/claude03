// Asset manifest: schema validation, prompt templating and file helpers.
// The manifest (server/assets/manifest.json) lists every generated asset: what to ask Gemini for,
// which accepted assets to attach as reference images, how to post-process, and where the
// accepted file lives under public/assets/generated/.
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MANIFEST_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'manifest.json');

export const KINDS = ['anchor', 'bg', 'charLayer', 'pose', 'sprite', 'icon', 'frame', 'texture', 'ui', 'part'];
export const KIND_LABELS = {
  anchor: '스타일 앵커',
  bg: '컷인 배경',
  charLayer: '캐릭터 레이어',
  pose: '키포즈',
  sprite: '스프라이트',
  icon: '아이콘',
  frame: '프레임 테마',
  texture: '텍스처',
  ui: 'UI',
  part: '아바타 파츠',
};
export const STATUSES = ['todo', 'candidate', 'accepted'];
/** Aspect ratios accepted by gemini-2.5-flash-image `imageConfig.aspectRatio`. */
export const ASPECTS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
export const ANCHORS = ['bottom-center'];
const STEP_RE =
  /^(chromaKey|whiteToAlpha|trim|resize:\d{1,4}x\d{1,4}|normalizeFrames|sheet|webp|seamless|diffExtract:(hair|face|eyes|mouth|cheek|expression|accessory|body)|alignHead|mannequin)$/;
/** Paper-doll part slots (meta.slot) and tint channels — see server/assets/partStack.js. */
export const PART_SLOTS = ['mannequin', 'hair', 'face', 'outfit', 'cheek', 'eyes', 'eyesClosed', 'mouth', 'expression', 'accessory'];
export const PART_TINTS = ['skin', 'hair', 'outfit'];
const HEX_RE = /^#[0-9a-f]{6}$/i;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const OUTPUT_RE = /^[a-z0-9][a-z0-9_\-/]*\.(png|webp)$/;

/**
 * Style bible: prepended (via {{style}}) to every prompt so all assets share one look.
 * Proven in the Stage 0 live test (scratchpad/mock/gen-test.js).
 */
export const STYLE =
  'Art style: modern Korean anime-inspired game illustration, clean cel shading, soft gradients, ' +
  'bright saturated but harmonious colors, thick-and-thin clean line art, chibi proportions ' +
  '(head about 1/3 of body height), friendly and cheerful, high quality 2D game asset, ' +
  'consistent lighting from upper left, no text, no watermark, no signature.';

/** Built-in template snippets. Items may add their own via `vars`. */
export const SNIPPETS = {
  style: STYLE,
  sameStyle: 'Use exactly the same art style, line weight and color palette as the reference image.',
  magentaBg:
    'Flat solid pure magenta background color #FF00FF filling the whole canvas, no gradient, ' +
    'no shadow on the ground, no floor, no other objects.',
  whiteBg: 'Plain pure white background #FFFFFF, no shadow, no border, no frame, no other objects.',
  keepCharacter:
    'Edit the reference character: keep EXACTLY the same character (face, hair, proportions, body size, ' +
    'position on the canvas, camera distance and scale), same art style and line weight, ' +
    'same flat solid magenta background #FF00FF, no ground shadow, no other objects.',
  fullBody: 'Full body chibi character, front view, feet fully visible, centered with some margin on every side.',
  seamless:
    'Seamless tileable texture: the left edge continues the right edge and the top edge continues the bottom edge, ' +
    'even density everywhere, no vignette, no border, no focal object.',
  noPeople: 'Scene only, NO people, no characters, no animals in the foreground.',
  keepMannequin:
    'Edit the reference image. Keep EVERYTHING else pixel-identical: the same character, same bald head shape, ' +
    'same blank face, same body, same pose, same position, size and scale on the canvas, same line weight, ' +
    'same flat magenta background. Do not move, redraw or recolor anything that is not part of the change.',
  blankFace: 'The face stays blank: no eyes, no eyebrows, no nose, no mouth.',
  neutralHair:
    'drawn in a single neutral dark gray-brown color (#4a4440) with simple darker cel shading and a soft highlight; ' +
    'any hair ties in the same gray-brown, no other colors',
  fullyDressed:
    'Fully dressed: the tank top and shorts must be completely hidden. If a jacket, coat or cardigan is open at the ' +
    'front, draw an inner shirt under it, and always draw full bottoms (trousers, shorts or a skirt) over the shorts.',
  neutralOutfit:
    'All clothes and shoes are in a neutral light gray (#c8c8c8) with darker gray details, seams and shading; ' +
    'no other colors, no patterns in other colors, no logos, no text',
};

export class ManifestError extends Error {
  constructor(errors) {
    super(`매니페스트 오류: ${errors.join(' / ')}`);
    this.errors = errors;
  }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function templateVars(tpl) {
  return [...String(tpl).matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((m) => m[1]);
}

/** Validate one item (without cross-item checks). Returns an array of error strings. */
export function validateItem(item) {
  const errs = [];
  if (!isObj(item)) return ['항목이 객체가 아닙니다.'];
  const at = `[${item.id ?? '?'}]`;
  if (typeof item.id !== 'string' || !ID_RE.test(item.id)) errs.push(`${at} id 형식이 올바르지 않습니다.`);
  if (!KINDS.includes(item.kind)) errs.push(`${at} kind가 올바르지 않습니다: ${item.kind}`);
  if (typeof item.label !== 'string' || !item.label.trim()) errs.push(`${at} label이 필요합니다.`);
  if (!ASPECTS.includes(item.aspect)) errs.push(`${at} aspect가 올바르지 않습니다: ${item.aspect}`);
  if (item.size !== undefined) {
    if (!isObj(item.size) || !Number.isInteger(item.size.w) || !Number.isInteger(item.size.h) || item.size.w < 1 || item.size.h < 1)
      errs.push(`${at} size는 {w, h} 정수여야 합니다.`);
  }
  if (typeof item.prompt !== 'string' || item.prompt.trim().length < 10) errs.push(`${at} prompt가 너무 짧습니다.`);
  const vars = item.vars ?? {};
  if (!isObj(vars) || Object.values(vars).some((v) => typeof v !== 'string')) errs.push(`${at} vars는 문자열 맵이어야 합니다.`);
  for (const v of templateVars(item.prompt ?? '')) {
    const spriteFrame = v === 'frame' && item.kind === 'sprite'; // filled per frame by the studio
    if (!(v in SNIPPETS) && !(isObj(vars) && v in vars) && !spriteFrame) errs.push(`${at} 알 수 없는 템플릿 변수: {{${v}}}`);
  }
  if (!Array.isArray(item.refs) || item.refs.some((r) => typeof r !== 'string')) errs.push(`${at} refs는 id 배열이어야 합니다.`);
  else if (item.refs.includes(item.id)) errs.push(`${at} 자기 자신을 참조할 수 없습니다.`);
  if (typeof item.output !== 'string' || !OUTPUT_RE.test(item.output) || item.output.includes('..') || item.output.includes('//'))
    errs.push(`${at} output 경로가 올바르지 않습니다: ${item.output}`);
  if (!Array.isArray(item.postprocess) || item.postprocess.some((s) => typeof s !== 'string' || !STEP_RE.test(s)))
    errs.push(`${at} postprocess 단계가 올바르지 않습니다.`);
  if (!STATUSES.includes(item.status)) errs.push(`${at} status가 올바르지 않습니다: ${item.status}`);
  if (item.status === 'accepted') {
    const a = item.accepted;
    if (!isObj(a) || typeof a.file !== 'string' || typeof a.generatedAt !== 'string')
      errs.push(`${at} accepted 항목에는 accepted.{file, generatedAt}이 필요합니다.`);
  }
  if (item.anchor !== undefined && !ANCHORS.includes(item.anchor)) errs.push(`${at} anchor가 올바르지 않습니다.`);
  if (item.kind === 'sprite') {
    if (!Array.isArray(item.frames) || item.frames.length < 2 || item.frames.some((f) => !isObj(f) || typeof f.prompt !== 'string'))
      errs.push(`${at} sprite에는 frames[{id, prompt}]가 2개 이상 필요합니다.`);
    if (item.frameDelays !== undefined && (!Array.isArray(item.frameDelays) || item.frameDelays.some((d) => !Number.isInteger(d) || d < 10)))
      errs.push(`${at} frameDelays는 ms 정수 배열이어야 합니다.`);
  } else if (item.frames !== undefined) errs.push(`${at} frames는 sprite에만 쓸 수 있습니다.`);
  if (item.meta !== undefined && !isObj(item.meta)) errs.push(`${at} meta는 객체여야 합니다.`);
  if (item.kind === 'part') errs.push(...validatePartMeta(item, at));
  else if (item.postprocess?.some?.((st) => typeof st === 'string' && /^(diffExtract:|alignHead$|mannequin$)/.test(st)))
    errs.push(`${at} diffExtract/alignHead/mannequin 단계는 part에만 쓸 수 있습니다.`);
  if (item.candidates !== undefined && (!Number.isInteger(item.candidates) || item.candidates < 1 || item.candidates > 8))
    errs.push(`${at} candidates는 1~8이어야 합니다.`);
  return errs;
}

function validatePartMeta(item, at) {
  const errs = [];
  const m = item.meta;
  if (!isObj(m)) return [`${at} part에는 meta가 필요합니다.`];
  if (typeof m.category !== 'string' || !m.category) errs.push(`${at} meta.category가 필요합니다.`);
  if (typeof m.option !== 'string' || !m.option) errs.push(`${at} meta.option이 필요합니다.`);
  if (!PART_SLOTS.includes(m.slot)) errs.push(`${at} meta.slot이 올바르지 않습니다: ${m.slot}`);
  if (m.tint !== null && m.tint !== undefined && !PART_TINTS.includes(m.tint)) errs.push(`${at} meta.tint가 올바르지 않습니다: ${m.tint}`);
  if (m.tintRef !== undefined && !(typeof m.tintRef === 'string' && HEX_RE.test(m.tintRef))) errs.push(`${at} meta.tintRef는 #rrggbb여야 합니다.`);
  const steps = Array.isArray(item.postprocess) ? item.postprocess : [];
  const needsBase = steps.some((st) => typeof st === 'string' && (st.startsWith('diffExtract:') || st === 'alignHead'));
  if (needsBase && (typeof m.base !== 'string' || !m.base)) errs.push(`${at} diffExtract/alignHead에는 meta.base(기준 파츠 id)가 필요합니다.`);
  if (m.base !== undefined && m.base === item.id) errs.push(`${at} meta.base가 자기 자신입니다.`);
  if (m.slot === 'mannequin' && !steps.includes('mannequin')) errs.push(`${at} 마네킹에는 mannequin 단계가 필요합니다.`);
  if (m.slot !== 'mannequin' && steps.includes('mannequin')) errs.push(`${at} mannequin 단계는 마네킹에만 쓸 수 있습니다.`);
  if (m.slot === 'hair' && !steps.includes('diffExtract:hair')) errs.push(`${at} 머리 파츠에는 diffExtract:hair 단계가 필요합니다.`);
  return errs;
}

/**
 * Every file a part item may publish, keyed by layer: `main` (= output) plus
 * mannequin → `base` (keyed original, the edit/diff base); hair → `front`, `back`, `erase`;
 * outfit → `hat`, `erase`; meta.src → `src` (keyed edit, used as ref/base by other parts).
 * Optional layers (erase, hat) are only written when the candidate produced them (see accepted.files).
 */
export function partFiles(item) {
  const out = item.output;
  const stem = out.replace(/\.(png|webp)$/, '');
  const ext = out.slice(stem.length);
  const f = (k) => `${stem}-${k}${ext}`;
  const files = { main: out };
  const slot = item.meta?.slot;
  if (slot === 'mannequin') files.base = f('base');
  if (slot === 'hair') Object.assign(files, { front: f('front'), back: f('back'), erase: f('erase') });
  if (slot === 'outfit') Object.assign(files, { hat: f('hat'), erase: f('erase') });
  if (item.meta?.src) files.src = f('src');
  return files;
}

/** Ids an item depends on: its refs plus a part's diff/align base. */
export function depsOf(item) {
  const deps = [...(Array.isArray(item?.refs) ? item.refs : [])];
  if (item?.kind === 'part' && typeof item.meta?.base === 'string' && !deps.includes(item.meta.base)) deps.push(item.meta.base);
  return deps;
}

/** Validate the whole manifest: items, unique ids/outputs, known refs, no ref cycles. */
export function validateManifest(m) {
  if (!isObj(m) || !Array.isArray(m.items)) return { ok: false, errors: ['items 배열이 필요합니다.'] };
  const errors = [];
  if (m.settings !== undefined && !isObj(m.settings)) errors.push('settings는 객체여야 합니다.');
  const ids = new Set();
  const outputs = new Set();
  for (const item of m.items) {
    errors.push(...validateItem(item));
    if (ids.has(item?.id)) errors.push(`[${item.id}] id가 중복됩니다.`);
    ids.add(item?.id);
    const outs = outputsFor(item);
    for (const o of outs) {
      if (outputs.has(o)) errors.push(`[${item?.id}] output이 중복됩니다: ${o}`);
      outputs.add(o);
    }
  }
  const byId = new Map(m.items.map((i) => [i?.id, i]));
  for (const item of m.items) {
    for (const r of Array.isArray(item?.refs) ? item.refs : []) {
      if (!byId.has(r)) errors.push(`[${item.id}] 없는 참조: ${r}`);
    }
    if (item?.kind === 'part' && typeof item.meta?.base === 'string') {
      const b = byId.get(item.meta.base);
      if (!b) errors.push(`[${item.id}] 없는 기준 파츠(meta.base): ${item.meta.base}`);
      else if (b.kind !== 'part' || !(b.meta?.slot === 'mannequin' || b.meta?.src)) errors.push(`[${item.id}] meta.base는 마네킹이나 src를 남기는 파츠여야 합니다: ${item.meta.base}`);
    }
  }
  if (!errors.length) {
    try {
      topoOrder(m.items);
    } catch (e) {
      errors.push(e.message);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
}

/** All published files an item writes (sprites also write sheet JSON + animated WebP). */
export function outputsFor(item) {
  if (!item || typeof item.output !== 'string') return [];
  if (item.kind === 'part') return Object.values(partFiles(item));
  if (item.kind !== 'sprite') return [item.output];
  const base = item.output.replace(/\.(png|webp)$/, '');
  return [item.output, `${base}.json`, `${base}.anim.webp`];
}

/** Items ordered so every item comes after its refs. Throws on cycles. */
export function topoOrder(items) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out = [];
  const state = new Map(); // 1 = visiting, 2 = done
  const visit = (id, trail) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) throw new Error(`참조 순환: ${[...trail, id].join(' → ')}`);
    state.set(id, 1);
    for (const r of depsOf(byId.get(id))) if (byId.has(r)) visit(r, [...trail, id]);
    state.set(id, 2);
    out.push(byId.get(id));
  };
  for (const i of items) visit(i.id, []);
  return out;
}

/** Expand {{var}} placeholders (item vars override snippets). Unknown vars are left as-is. */
export function renderPrompt(item, template = item.prompt) {
  const vars = { ...SNIPPETS, ...(item.vars ?? {}) };
  const once = (s) => s.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, k) => (k in vars ? vars[k] : m));
  // vars may reference snippets ({{style}} inside a var), so expand twice.
  return once(once(String(template))).replace(/\s+/g, ' ').trim();
}

export async function loadManifest(file = MANIFEST_PATH) {
  const m = JSON.parse(await readFile(file, 'utf8'));
  const v = validateManifest(m);
  if (!v.ok) throw new ManifestError(v.errors);
  return m;
}

/** Validate and write atomically (tmp + rename) with stable 2-space formatting. */
export async function saveManifest(m, file = MANIFEST_PATH) {
  const v = validateManifest(m);
  if (!v.ok) throw new ManifestError(v.errors);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(m, null, 2)}\n`);
  await rename(tmp, file);
}

export function getItem(m, id) {
  return m.items.find((i) => i.id === id) ?? null;
}
