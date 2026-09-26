// Asset manifest: schema validation, prompt templating and file helpers.
// The manifest (server/assets/manifest.json) lists every generated asset: what to ask Gemini for,
// which accepted assets to attach as reference images, how to post-process, and where the
// accepted file lives under public/assets/generated/.
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MANIFEST_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'manifest.json');

export const KINDS = ['anchor', 'bg', 'charLayer', 'pose', 'sprite', 'icon', 'frame', 'texture', 'ui'];
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
};
export const STATUSES = ['todo', 'candidate', 'accepted'];
/** Aspect ratios accepted by gemini-2.5-flash-image `imageConfig.aspectRatio`. */
export const ASPECTS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
export const ANCHORS = ['bottom-center'];
const STEP_RE = /^(chromaKey|whiteToAlpha|trim|resize:\d{1,4}x\d{1,4}|normalizeFrames|sheet|webp|seamless)$/;
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
  if (item.candidates !== undefined && (!Number.isInteger(item.candidates) || item.candidates < 1 || item.candidates > 8))
    errs.push(`${at} candidates는 1~8이어야 합니다.`);
  return errs;
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
    for (const r of byId.get(id)?.refs ?? []) if (byId.has(r)) visit(r, [...trail, id]);
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
