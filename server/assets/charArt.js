// AI character art (Stage 5.5-D): a personal illustration set per avatar, generated with Gemini.
//
//   base      = full-body illustration (refs: style anchor + the paper-doll composition of the exact avatar)
//   pose-*    = 6 key poses, edits of the base (ref: base)
//   expr-*    = 4 expressions, edits of the base (ref: base)
//
// Every result is chroma-keyed and placed on the shared 1024×1536 canvas with the same convention as the
// schoolgirl layer set (figure bbox height 933, feet on y 1303, centred at x 512) → transparent WebP.
// Files are cached per avatar hash in DATA_DIR/char-art/<key>/ (index.json + <name>.webp), so the same
// look is reused across rooms and games. The Gemini client (limiter, retries, daily cap, key handling) is
// shared with the asset studio; this module never sees or logs the key.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { MANIFEST_PATH, SNIPPETS, STYLE, loadManifest } from './manifest.js';
import { CANVAS, CROP, layerStack } from './partStack.js';
import { chromaKey, composeLayers, normalizeFrames } from './postprocess.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GENERATED_DIR = path.join(ROOT, 'public', 'assets', 'generated');

/** Bump to invalidate every cached set (prompt / pipeline change). Part of the cache key. */
export const ART_VERSION = 1;
export const ART_POSES = ['idle', 'wave', 'jump', 'cheer', 'cry', 'shock'];
export const ART_EXPRESSIONS = ['joy', 'cry', 'shock', 'angry'];
export const ART_URL = '/api/char-art';
export const KEY_RE = /^[a-f0-9]{16,64}$/;
export const FILE_RE = /^[a-z0-9-]+\.webp$/;
/** Figure box of the schoolgirl layer set (bbox y 371..1303) — AI art uses the same placement. */
export const FIGURE_BOX = { top: 371, bottom: 1303, centerX: CANVAS.w / 2 };

export const MSG = {
  credits: 'AI 생성 크레딧이 부족합니다. 관리자에게 문의하세요.',
  badKey: 'AI 생성 키가 올바르지 않습니다. 관리자에게 문의하세요.',
  noKey: 'AI 일러스트 기능이 꺼져 있어요',
  cap: '오늘 AI 생성 한도에 도달했어요. 내일 다시 시도하세요.',
  cancelled: '취소되었습니다.',
  restart: '서버 재시작',
};

const POSE_PROMPTS = {
  idle: 'standing relaxed, arms down at the sides, weight on one leg, gentle smile, open eyes.',
  wave: 'waving happily with the right hand raised high, left hand on the hip, closed happy eyes (> <), big smile.',
  jump: 'jumping for joy, both feet off the ground with knees bent, both arms raised high, big open smile, hair and clothes lifting.',
  cheer: 'cheering with both fists pumped in the air, mouth wide open shouting with joy, sparkling eyes.',
  cry: 'crying loudly, rubbing the eyes with both fists, tears flying, shoulders slumped.',
  shock: 'shocked: leaning back, both hands raised beside the face with open palms, wide round eyes, open mouth.',
};
const EXPRESSION_PROMPTS = {
  joy: 'a big happy open-mouth smile with closed happy eyes (> <) and rosy cheeks',
  cry: 'crying: big tears streaming down, wobbly open mouth, eyebrows raised in the middle',
  shock: 'shocked: wide round eyes with small pupils, open O-shaped mouth, a sweat drop on the forehead',
  angry: 'angry: furrowed eyebrows, puffed red cheeks, clenched teeth, a small anger mark on the head',
};

/** The 11 generation steps in order: base first, then edits of the base. */
export const ART_STEPS = [
  { name: 'base', kind: 'base' },
  ...ART_POSES.map((id) => ({ name: `pose-${id}`, kind: 'pose', id })),
  ...ART_EXPRESSIONS.map((id) => ({ name: `expr-${id}`, kind: 'expression', id })),
];
export const ART_TOTAL = ART_STEPS.length;

// ---------- pure helpers ----------

function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])]));
  return v;
}

/** Cache key of an avatar: sha256(stable JSON of the avatar + ART_VERSION), 24 hex chars. */
export function artKey(avatar, version = ART_VERSION) {
  const json = JSON.stringify({ v: version, avatar: stable(avatar ?? {}) });
  return createHash('sha256').update(json).digest('hex').slice(0, 24);
}

export const validKey = (key) => typeof key === 'string' && KEY_RE.test(key);
export const validFile = (file) => typeof file === 'string' && FILE_RE.test(file);

/** Public URL of one file (`?v=<rev>` only after an admin forced regeneration, to bust caches). */
export const artUrl = (key, name, rev = 0) => `${ART_URL}/${key}/${name}.webp${rev ? `?v=${rev}` : ''}`;

/** `files` object of the room-state contract: {base, poses:{…}, expressions:{…}} (URLs). */
export function artFiles(key, rev = 0) {
  return {
    base: artUrl(key, 'base', rev),
    poses: Object.fromEntries(ART_POSES.map((p) => [p, artUrl(key, `pose-${p}`, rev)])),
    expressions: Object.fromEntries(ART_EXPRESSIONS.map((e) => [e, artUrl(key, `expr-${e}`, rev)])),
  };
}

const optionOf = (avatars, cat, id) => {
  const opts = avatars?.parts?.[cat] ?? [];
  return opts.find((o) => o.id === id) ?? opts.find((o) => o.id === avatars?.default?.[cat]) ?? null;
};

/**
 * Plain-English description of every chosen option (avatars.json `promptDesc`).
 * Colours carry their hex; `tintable:false` outfits keep their own colours (outfitColor is skipped).
 * @returns {{body, build, skin, face, eyes, mouth, cheek, hair, outfit, accessory}} (empty string = nothing)
 */
export function describeAvatar(avatar, avatars) {
  const a = { ...(avatars?.default ?? {}), ...(avatar ?? {}) };
  const d = (cat) => String(optionOf(avatars, cat, a[cat])?.promptDesc ?? '').trim();
  const hex = (cat) => optionOf(avatars, cat, a[cat])?.color;
  const outfit = optionOf(avatars, 'outfit', a.outfit);
  const hairColor = d('hairColor');
  const outfitColor = d('outfitColor');
  const withHex = (name, cat) => (hex(cat) ? `${name} (${hex(cat)})` : name);
  return {
    body: d('body'),
    build: d('build'),
    skin: withHex(d('skin'), 'skin'),
    face: d('face'),
    eyes: d('eyes'),
    mouth: d('mouth'),
    cheek: d('cheek'),
    hair: `${d('hair')}${hairColor ? `, hair color ${withHex(hairColor, 'hairColor')}` : ''}`,
    outfit:
      outfit?.tintable === false
        ? `${d('outfit')} in its standard colors`
        : `${d('outfit')}${outfitColor ? `, main clothing color ${withHex(outfitColor, 'outfitColor')}` : ''}`,
    accessory: d('accessory'),
  };
}

/**
 * Prompt of the base illustration.
 * @param {object} avatar     avatars.json part ids
 * @param {object} avatars    avatars.json
 * @param {{withReference?: boolean}} [opts]  false when no paper-doll reference image is attached
 */
export function buildArtPrompt(avatar, avatars, { withReference = true } = {}) {
  const x = describeAvatar(avatar, avatars);
  const traits = [
    x.body,
    x.build,
    x.skin,
    x.face,
    x.eyes,
    x.mouth,
    x.cheek,
    x.hair,
    `wearing ${x.outfit}`,
    x.accessory ? `accessory: ${x.accessory}` : '',
  ].filter(Boolean);
  const refs = withReference
    ? 'The first reference image is the style reference: use exactly the same art style, line weight and color palette. ' +
      "The second reference image is the character design: match the reference character's design exactly (hairstyle, " +
      'hair color, face shape, eyes, mouth, cheeks, skin tone, body build, outfit, outfit color and accessory), ' +
      'redrawn as a polished high quality illustration.'
    : SNIPPETS.sameStyle;
  return [
    STYLE,
    refs,
    SNIPPETS.fullBody,
    'Standing straight in a relaxed neutral pose, arms down at the sides, front view, feet visible, gentle smile with open eyes.',
    `The character: ${traits.join(', ')}.`,
    'Only this one character.',
    SNIPPETS.magentaBg,
    'Portrait 2:3.',
  ]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Prompt of one edit step (pose / expression) of the base. */
export function buildEditPrompt(step) {
  const body =
    step.kind === 'pose'
      ? `Change only the pose: ${POSE_PROMPTS[step.id]} Keep the outfit, hairstyle, colors and accessory unchanged.`
      : `Change ONLY the facial expression to ${EXPRESSION_PROMPTS[step.id]}. Keep the pose, outfit, hairstyle and colors unchanged.`;
  return `${STYLE} ${SNIPPETS.keepCharacter} ${SNIPPETS.fullBody} ${body} Portrait 2:3.`.replace(/\s+/g, ' ').trim();
}

/** Korean failure reason for a Gemini/client error, and whether the whole job must stop. */
export function classifyError(e) {
  const status = e?.status;
  if (status === 402) return { reason: MSG.credits, fatal: true };
  if (status === 401 || status === 403) return { reason: MSG.badKey, fatal: true };
  if (e?.code === 'NO_KEY') return { reason: MSG.noKey, fatal: true };
  if (e?.code === 'DAILY_CAP') return { reason: MSG.cap, fatal: true };
  const detail = String(e?.message ?? '')
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '***')
    .slice(0, 120);
  return { reason: `AI 일러스트를 만들지 못했어요.${detail ? ` (${detail})` : ''}`, fatal: false };
}

// ---------- image helpers ----------

const MAGENTA = { r: 255, g: 0, b: 255, alpha: 1 };

/** Place a keyed figure on the canvas at FIGURE_BOX (height 933, feet on 1303, centred). */
export async function placeFigure(buffer) {
  const h = FIGURE_BOX.bottom - FIGURE_BOX.top + 1;
  const w = 400;
  const guide = await sharp({ create: { width: CANVAS.w, height: CANVAS.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: { create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }, left: FIGURE_BOX.centerX - w / 2, top: FIGURE_BOX.top }])
    .png()
    .toBuffer();
  const [, placed] = await normalizeFrames([guide, buffer]);
  return placed;
}

/** Transparent art → flat magenta PNG (edit reference, like the studio's keyed poses). */
export const onMagenta = (buffer) => sharp(buffer).flatten({ background: MAGENTA }).png().toBuffer();

/** Downscale a reference to ≤ max px (long side) as PNG. */
const shrink = (buffer, max = 1024) => sharp(buffer).resize(max, max, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();

/** Lookup over accepted paper-doll part items → {url: local path, files, meta} (for layerStack). */
export async function partLookup({ manifestPath = MANIFEST_PATH, generatedDir = GENERATED_DIR } = {}) {
  const m = await loadManifest(manifestPath);
  const byId = new Map();
  for (const it of m.items) {
    if (it.kind !== 'part' || it.status !== 'accepted' || !it.accepted?.file) continue;
    const files = {};
    for (const [k, rel] of Object.entries(it.accepted.files ?? {})) files[k] = path.join(generatedDir, rel);
    byId.set(it.id, { url: path.join(generatedDir, it.accepted.file), files, meta: it.meta });
  }
  return (id) => byId.get(id) ?? null;
}

/**
 * Paper-doll composition of the exact avatar (the same stack the client draws) on white, cropped to the
 * figure → PNG reference, or null when no part layers are accepted.
 */
export async function composeReference(avatar, { lookup, avatars, scale = 0.5 }) {
  const stack = layerStack(avatar, { lookup, avatars });
  if (!stack.length) return null;
  const W = Math.round(CANVAS.w * scale);
  const H = Math.round(CANVAS.h * scale);
  const load = (f) => readFile(f).then((b) => sharp(b).resize(W, H, { fit: 'fill' }).png().toBuffer());
  const layers = [];
  for (const l of stack) {
    layers.push({ buffer: await load(l.src), tint: l.tint, erase: l.erase ? await Promise.all(l.erase.map(load)) : undefined });
  }
  const img = await composeLayers(layers, { width: W, height: H, background: '#ffffff' });
  return sharp(img)
    .extract({ left: Math.round(CROP.x * scale), top: Math.round(CROP.y * scale), width: Math.round(CROP.w * scale), height: Math.round(CROP.h * scale) })
    .png()
    .toBuffer();
}

// ---------- service ----------

let tmpSeq = 0;
async function writeJsonAtomic(file, obj) {
  const tmp = `${file}.${process.pid}.${Date.now()}.${++tmpSeq}.tmp`;
  await writeFile(tmp, `${JSON.stringify(obj, null, 2)}\n`);
  await rename(tmp, file);
}

export class ArtCancelled extends Error {
  constructor() {
    super(MSG.cancelled);
    this.code = 'CANCELLED';
  }
}

/**
 * @param {object} opts
 * @param {string} opts.dataDir            DATA_DIR (cache in <dataDir>/char-art)
 * @param {object} opts.client             Gemini client (shared with the studio: limiter + daily cap)
 * @param {object} opts.avatars            avatars.json
 * @param {string} [opts.styleAnchorPath]  style anchor image (skipped when missing)
 * @param {Function} [opts.composeRef]     (avatar) → PNG | null; default = paper-doll composition
 * @param {number} [opts.stepRetries]      extra attempts per step (default 2)
 * @param {number} [opts.editConcurrency]  pose/expression edits in parallel (default 2)
 */
export function createCharArtService({
  dataDir,
  client,
  avatars,
  styleAnchorPath = path.join(GENERATED_DIR, 'anchor', 'style-anchor.png'),
  manifestPath = MANIFEST_PATH,
  generatedDir = GENERATED_DIR,
  composeRef,
  stepRetries = 2,
  editConcurrency = 2,
  now = () => new Date(),
  log = () => {},
} = {}) {
  if (!dataDir) throw new Error('dataDir required');
  if (!client) throw new Error('client required');
  const root = path.join(dataDir, 'char-art');
  const jobs = new Map(); // key → job
  let anchorPromise = null;
  let lookupPromise = null;

  const dirOf = (key) => {
    if (!validKey(key)) throw new Error('bad key');
    return path.join(root, key);
  };

  function readIndexSync(key) {
    try {
      return JSON.parse(readFileSync(path.join(dirOf(key), 'index.json'), 'utf8'));
    } catch {
      return null;
    }
  }

  /** Complete cached set → {files, rev} (sync; used inside store transactions), else null. */
  function cached(key) {
    if (!validKey(key)) return null;
    const idx = readIndexSync(key);
    if (!idx?.complete || idx.version !== ART_VERSION) return null;
    const dir = dirOf(key);
    if (!ART_STEPS.every((s) => existsSync(path.join(dir, `${s.name}.webp`)))) return null;
    return { files: artFiles(key, idx.rev ?? 0), rev: idx.rev ?? 0 };
  }

  /** Absolute path of a cached file, or null (strict validation + containment). */
  function filePath(key, file) {
    if (!validKey(key) || !validFile(file)) return null;
    const base = path.resolve(root);
    const p = path.resolve(base, key, file);
    if (!p.startsWith(base + path.sep)) return null;
    return existsSync(p) ? p : null;
  }

  function styleAnchor() {
    anchorPromise ??= readFile(styleAnchorPath).then(
      (b) => shrink(b),
      () => null,
    );
    return anchorPromise;
  }

  async function reference(avatar) {
    if (composeRef) return composeRef(avatar);
    try {
      lookupPromise ??= partLookup({ manifestPath, generatedDir });
      return await composeReference(avatar, { lookup: await lookupPromise, avatars });
    } catch (e) {
      log(`[char-art] 참조 이미지 합성 실패: ${e.message}`);
      return null;
    }
  }

  async function runStep(step, { avatar, baseKeyed, editRef, job }) {
    let prompt;
    let refs;
    if (step.kind === 'base') {
      const [anchor, ref] = await Promise.all([styleAnchor(), reference(avatar)]);
      prompt = buildArtPrompt(avatar, avatars, { withReference: Boolean(ref) });
      refs = [anchor, ref].filter(Boolean).map((buffer) => ({ buffer, mimeType: 'image/png' }));
    } else {
      prompt = buildEditPrompt(step);
      refs = [{ buffer: editRef, mimeType: 'image/png' }];
    }
    let lastErr;
    for (let attempt = 0; attempt <= stepRetries; attempt++) {
      if (job.cancelled) throw new ArtCancelled();
      try {
        const out = await client.generateImage({ prompt, refs, aspectRatio: '2:3' });
        job.model = out.model;
        const keyed = await chromaKey(out.buffer);
        const placed = step.kind === 'base' ? await placeFigure(keyed) : (await normalizeFrames([baseKeyed, keyed]))[1];
        return { placed, prompt };
      } catch (e) {
        lastErr = e;
        const c = classifyError(e);
        if (c.fatal) throw Object.assign(e, { reasonKo: c.reason, fatal: true });
        log(`[char-art] ${step.name} 실패 (${attempt + 1}/${stepRetries + 1}): ${c.reason}`);
      }
    }
    throw Object.assign(lastErr ?? new Error('unknown'), { reasonKo: classifyError(lastErr).reason });
  }

  async function run(job, avatar, { force }) {
    const { key } = job;
    const dir = dirOf(key);
    await mkdir(dir, { recursive: true });
    let idx = readIndexSync(key);
    const rev = force && idx ? (idx.rev ?? 0) + 1 : (idx?.rev ?? 0);
    if (force || !idx || idx.version !== ART_VERSION) {
      idx = { key, version: ART_VERSION, avatar, rev, complete: false, steps: {}, createdAt: now().toISOString() };
    }
    idx.rev = rev;
    let indexChain = Promise.resolve();
    const saveIndex = () => {
      indexChain = indexChain.then(() => writeJsonAtomic(path.join(dir, 'index.json'), { ...idx, updatedAt: now().toISOString() }));
      return indexChain;
    };
    await saveIndex();
    let done = 0;
    const progress = (step) => {
      done++;
      job.emit({ key, done, total: ART_TOTAL, step: step.name, progress: done / ART_TOTAL });
    };
    const isDone = (step) => Boolean(idx.steps[step.name]) && existsSync(path.join(dir, `${step.name}.webp`));
    const make = async (step, ctx) => {
      if (job.cancelled) throw new ArtCancelled();
      const { placed, prompt } = await runStep(step, { avatar, job, ...ctx });
      await writeFile(path.join(dir, `${step.name}.webp`), await sharp(placed).webp({ quality: 88, alphaQuality: 100 }).toBuffer());
      idx.steps[step.name] = { file: `${step.name}.webp`, prompt, model: job.model ?? null, at: now().toISOString() };
      await saveIndex();
      progress(step);
      return placed;
    };

    // 1) base (resumed from disk when a previous job already made it)
    const [baseStep, ...edits] = ART_STEPS;
    let baseKeyed;
    if (isDone(baseStep)) {
      baseKeyed = await sharp(await readFile(path.join(dir, 'base.webp'))).png().toBuffer();
      progress(baseStep);
    } else baseKeyed = await make(baseStep, {});

    // 2) poses + expressions: edits of the base, `editConcurrency` at a time (the shared Gemini limiter
    //    still caps the global number of calls in flight). A fatal error stops scheduling new steps.
    const editRef = await onMagenta(baseKeyed);
    const queue = [];
    for (const step of edits) {
      if (isDone(step)) progress(step);
      else queue.push(step);
    }
    let firstErr = null;
    const worker = async () => {
      while (queue.length && !firstErr) {
        const step = queue.shift();
        try {
          await make(step, { baseKeyed, editRef });
        } catch (e) {
          firstErr ??= e;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, editConcurrency) }, worker));
    if (firstErr) throw firstErr;
    idx.complete = true;
    await saveIndex();
    return { key, rev, files: artFiles(key, rev) };
  }

  /**
   * Start (or join) the generation of an avatar's set.
   * @returns {{key: string, promise: Promise<{key, rev, files}>, detach: () => void, cached: boolean}}
   *   `detach` removes this caller's progress listener; when nobody listens any more the job stops before
   *   its next step (finished files stay cached for a later resume).
   */
  function generate(avatar, { onProgress, force = false } = {}) {
    const key = artKey(avatar);
    const listener = typeof onProgress === 'function' ? onProgress : () => {};
    const hit = !force && cached(key);
    if (hit) return { key, cached: true, promise: Promise.resolve({ key, ...hit }), detach: () => {} };
    let job = jobs.get(key);
    if (!job) {
      job = {
        key,
        listeners: new Set(),
        cancelled: false,
        emit(p) {
          for (const l of this.listeners) {
            try {
              l(p);
            } catch {
              /* listener errors never break the job */
            }
          }
        },
      };
      jobs.set(key, job);
      job.promise = run(job, avatar, { force }).finally(() => jobs.delete(key));
      job.promise.catch(() => {}); // callers handle; avoid unhandled rejections when everyone detached
    }
    job.listeners.add(listener);
    job.cancelled = false; // a new listener revives a job whose previous listeners all detached
    const detach = () => {
      job.listeners.delete(listener);
      if (!job.listeners.size) job.cancelled = true;
    };
    return { key, cached: false, promise: job.promise, detach };
  }

  return {
    root,
    keyFor: (avatar) => artKey(avatar),
    cached,
    filePath,
    generate,
    running: () => [...jobs.keys()],
    hasKey: () => client.hasKey(),
  };
}
