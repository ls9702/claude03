// Asset studio: generate candidates → review → accept / upload, driven by the manifest.
// Used by the admin routes (server/routes/adminAssets.js) and the CLI (scripts/gen-assets.js).
import { readFileSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createGeminiClient } from './gemini.js';
import { KIND_LABELS, MANIFEST_PATH, getItem, loadManifest, outputsFor, renderPrompt, saveManifest, topoOrder } from './manifest.js';
import { applySteps } from './postprocess.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const GENERATED_DIR = path.join(ROOT, 'public', 'assets', 'generated');
export const GENERATED_URL = '/assets/generated';
const REF_MAX_PX = 1024;
const UPLOAD_MAX_PX = 4096;
const PREVIEW_PX = 384;

export class StudioError extends Error {
  constructor(message, { status = 400, code = 'STUDIO_ERROR' } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function readSettings(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8')).settings ?? {};
  } catch {
    return {};
  }
}

const exists = (p) =>
  stat(p).then(
    () => true,
    () => false,
  );

/**
 * @param {object} opts
 * @param {string} opts.dataDir          DATA_DIR (candidates, secrets, usage)
 * @param {string} [opts.manifestPath]   manifest JSON (default server/assets/manifest.json)
 * @param {string} [opts.outputDir]      accepted files root (default public/assets/generated)
 * @param {object} [opts.client]         Gemini client (default: createGeminiClient)
 */
export function createStudio({ dataDir, manifestPath = MANIFEST_PATH, outputDir = GENERATED_DIR, client, fetchImpl, env, log = () => {} } = {}) {
  if (!dataDir) throw new Error('dataDir required');
  const settings = readSettings(manifestPath);
  const gemini =
    client ??
    createGeminiClient({ dataDir, fetchImpl, env, model: settings.model, dailyCap: settings.dailyCap, log });
  const candRoot = path.join(dataDir, 'asset-candidates');
  let lock = Promise.resolve();
  const busy = new Set();

  /** Serialize manifest read-modify-write. */
  function withManifest(mutate) {
    const run = lock.then(async () => {
      const m = await loadManifest(manifestPath);
      const result = await mutate(m);
      await saveManifest(m, manifestPath);
      return result;
    });
    lock = run.catch(() => {});
    return run;
  }

  async function mustItem(id) {
    const m = await loadManifest(manifestPath);
    const item = getItem(m, id);
    if (!item) throw new StudioError(`없는 에셋 항목입니다: ${id}`, { status: 404, code: 'NOT_FOUND' });
    return { m, item };
  }

  const candDir = (id) => path.join(candRoot, id);
  const outPath = (rel) => {
    const p = path.resolve(outputDir, rel);
    if (!p.startsWith(path.resolve(outputDir) + path.sep)) throw new StudioError('잘못된 출력 경로입니다.');
    return p;
  };

  async function listCandidates(id) {
    let files = [];
    try {
      files = await readdir(candDir(id));
    } catch {
      return [];
    }
    const out = [];
    for (const f of files) {
      const mm = /^(\d+)\.json$/.exec(f);
      if (!mm) continue;
      try {
        const meta = JSON.parse(await readFile(path.join(candDir(id), f), 'utf8'));
        out.push({ ...meta, n: Number(mm[1]) });
      } catch {
        /* half-written candidate */
      }
    }
    return out.sort((a, b) => a.n - b.n);
  }

  /**
   * Absolute path of a candidate file: `png` full post-processed image, `preview` small WebP
   * thumbnail (falls back to the PNG), `anim` animated WebP (sprites).
   */
  async function candidateFile(id, n, variant = 'png') {
    if (!/^\d+$/.test(String(n))) throw new StudioError('후보 번호가 올바르지 않습니다.');
    const name = { anim: `${n}.anim.webp`, preview: `${n}.preview.webp` }[variant] ?? `${n}.png`;
    const f = path.join(candDir(id), name);
    if (!(await exists(f))) {
      if (variant === 'preview') return candidateFile(id, n, 'png');
      throw new StudioError('후보 이미지가 없습니다.', { status: 404, code: 'NOT_FOUND' });
    }
    return f;
  }

  /** Reference images for an item: accepted files of its refs (error if any is missing). */
  async function resolveRefs(m, item) {
    const flatten = item.postprocess.includes('chromaKey') ? '#ff00ff' : '#ffffff';
    const refs = [];
    for (const rid of item.refs) {
      const r = getItem(m, rid);
      const file = r?.status === 'accepted' && r.accepted?.file ? outPath(r.accepted.file) : null;
      if (!file || !(await exists(file))) {
        throw new StudioError(`참조 에셋 "${r?.label ?? rid}"(${rid})이(가) 아직 채택되지 않았습니다. 먼저 생성·채택하세요.`, {
          status: 409,
          code: 'REF_MISSING',
        });
      }
      const raw = await readFile(file);
      // Transparent layers are flattened onto the backdrop the model is asked to paint on.
      const buffer = await sharp(raw)
        .resize(REF_MAX_PX, REF_MAX_PX, { fit: 'inside', withoutEnlargement: true })
        .flatten({ background: flatten })
        .png()
        .toBuffer();
      refs.push({ id: rid, kind: r.kind, file, raw, buffer, mimeType: 'image/png' });
    }
    return refs;
  }

  function framePrompts(item, override) {
    const tpl = override ?? item.prompt;
    if (item.kind !== 'sprite') return [renderPrompt(item, tpl)];
    return item.frames.map((f) => renderPrompt({ ...item, vars: { ...(item.vars ?? {}), frame: f.prompt } }, tpl));
  }

  async function nextNumbers(id, count) {
    const existing = await listCandidates(id);
    let files = [];
    try {
      files = await readdir(candDir(id));
    } catch {
      /* none yet */
    }
    const used = new Set([...existing.map((c) => c.n), ...files.map((f) => Number.parseInt(f, 10)).filter(Number.isFinite)]);
    const out = [];
    for (let n = 1; out.length < count; n++) if (!used.has(n)) out.push(n);
    return out;
  }

  /**
   * Generate `count` post-processed candidates for an item.
   * Accepted items are only regenerated with `force`. Candidates are appended (numbering continues).
   * @returns {Promise<{id, candidates: object[], errors: string[]}>}
   */
  async function generateCandidates(id, { count, force = false, prompt, onProgress = () => {} } = {}) {
    const { m, item } = await mustItem(id);
    if (item.status === 'accepted' && !force) {
      throw new StudioError('이미 채택된 에셋입니다. 다시 만들려면 강제 재생성을 사용하세요.', { status: 409, code: 'ACCEPTED' });
    }
    if (busy.has(id)) throw new StudioError('이 항목은 이미 생성 중입니다.', { status: 409, code: 'BUSY' });
    if (prompt !== undefined && (typeof prompt !== 'string' || prompt.trim().length < 10 || prompt.length > 4000)) {
      throw new StudioError('프롬프트는 10~4000자여야 합니다.');
    }
    const n = Math.max(1, Math.min(8, Number(count) || item.candidates || m.settings?.defaultCandidates || 4));
    busy.add(id);
    try {
      const refs = await resolveRefs(m, item);
      const normalizeRef = item.kind === 'pose' ? refs.find((r) => r.kind === 'charLayer')?.raw : undefined;
      const prompts = framePrompts(item, prompt);
      const numbers = await nextNumbers(id, n);
      const total = n * prompts.length;
      let done = 0;
      onProgress({ done, total });
      await mkdir(candDir(id), { recursive: true });

      const one = async (num) => {
        const results = await Promise.all(
          prompts.map(async (p) => {
            const r = await gemini.generateImage({ prompt: p, refs, aspectRatio: item.aspect, model: item.model });
            onProgress({ done: ++done, total });
            return r;
          }),
        );
        const pp = await applySteps(
          results.map((r) => r.buffer),
          item.postprocess,
          { ref: normalizeRef, delays: item.frameDelays, anchor: item.anchor },
        );
        const dir = candDir(id);
        const image = pp.sheet ? pp.sheet.buffer : pp.frames[0];
        await writeFile(path.join(dir, `${num}.png`), await sharp(image).png().toBuffer());
        await sharp(image)
          .resize(PREVIEW_PX, PREVIEW_PX, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 80 })
          .toFile(path.join(dir, `${num}.preview.webp`));
        if (pp.anim) await writeFile(path.join(dir, `${num}.anim.webp`), pp.anim);
        const im = await sharp(image).metadata();
        const meta = {
          n: num,
          model: results[0].model,
          promptUsed: prompts.length === 1 ? prompts[0] : prompts,
          generatedAt: new Date().toISOString(),
          text: results.map((r) => r.text).filter(Boolean).join(' ').slice(0, 500) || undefined,
          width: im.width,
          height: im.height,
          notes: Object.keys(pp.notes).length ? pp.notes : undefined,
          sheet: pp.sheet ? { ...pp.sheet.meta, delays: item.frameDelays, frameIds: item.frames.map((f) => f.id) } : undefined,
          anim: Boolean(pp.anim),
        };
        await writeFile(path.join(dir, `${num}.json`), `${JSON.stringify(meta, null, 2)}\n`);
        return meta;
      };

      const settled = await Promise.allSettled(numbers.map(one));
      const candidates = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);
      const failures = settled.filter((s) => s.status === 'rejected').map((s) => s.reason);
      if (!candidates.length) {
        const e = failures[0] ?? new Error('생성 실패');
        const status = { DAILY_CAP: 429, NO_KEY: 400, BAD_INPUT: 400 }[e.code] ?? 502;
        throw new StudioError(e.message, { status, code: e.code ?? 'GENERATE_FAILED' });
      }
      if (item.status === 'todo') {
        await withManifest((mm) => {
          const it = getItem(mm, id);
          if (it && it.status === 'todo') it.status = 'candidate';
        });
      }
      return { id, candidates, errors: failures.map((e) => e.message) };
    } finally {
      busy.delete(id);
    }
  }

  const regenerate = (id, opts = {}) => generateCandidates(id, { ...opts, force: true });

  async function writeOutput(item, pngBuffer) {
    const dest = outPath(item.output);
    await mkdir(path.dirname(dest), { recursive: true });
    const img = sharp(pngBuffer);
    await (item.output.endsWith('.webp') ? img.webp({ quality: 88 }) : img.png()).toFile(dest);
    return dest;
  }

  /** Publish candidate n to public/assets/generated/<output> and mark the item accepted. */
  async function accept(id, n) {
    const { item } = await mustItem(id);
    const file = await candidateFile(id, n);
    const meta = (await listCandidates(id)).find((c) => c.n === Number(n));
    if (!meta) throw new StudioError('후보 정보가 없습니다.', { status: 404, code: 'NOT_FOUND' });
    await writeOutput(item, await readFile(file));
    if (item.kind === 'sprite') {
      const [, jsonOut, animOut] = outputsFor(item);
      await writeFile(outPath(jsonOut), `${JSON.stringify({ id, image: path.posix.basename(item.output), ...meta.sheet }, null, 2)}\n`);
      if (meta.anim) await copyFile(await candidateFile(id, n, 'anim'), outPath(animOut));
    }
    return withManifest((m) => {
      const it = getItem(m, id);
      it.status = 'accepted';
      it.accepted = {
        file: it.output,
        model: meta.model,
        promptUsed: meta.promptUsed,
        generatedAt: meta.generatedAt,
        acceptedAt: new Date().toISOString(),
        source: 'generated',
        candidate: Number(n),
        width: meta.width,
        height: meta.height,
        ...(meta.sheet ? { frames: meta.sheet.count } : {}),
      };
      return summarize(m, it);
    });
  }

  /** Replace an asset with an uploaded image (optionally run the item's postprocess steps). */
  async function upload(id, buffer, { process = false } = {}) {
    const { m, item } = await mustItem(id);
    if (item.kind === 'sprite') throw new StudioError('스프라이트는 업로드를 지원하지 않습니다. 생성 후 채택하세요.');
    let meta;
    try {
      meta = await sharp(buffer).metadata();
    } catch {
      throw new StudioError('이미지 파일을 읽을 수 없습니다.');
    }
    if (!meta.width || !meta.height || meta.width > UPLOAD_MAX_PX || meta.height > UPLOAD_MAX_PX) {
      throw new StudioError(`이미지 크기는 ${UPLOAD_MAX_PX}px 이하여야 합니다.`);
    }
    let png = await sharp(buffer).png().toBuffer();
    if (process) {
      let ref;
      if (item.kind === 'pose') ref = (await resolveRefs(m, item).catch(() => [])).find((r) => r.kind === 'charLayer')?.raw;
      const steps = ref ? item.postprocess : item.postprocess.filter((s) => s !== 'normalizeFrames');
      png = (await applySteps([png], steps, { ref, anchor: item.anchor })).frames[0];
    }
    await writeOutput(item, png);
    const out = await sharp(png).metadata();
    return withManifest((mm) => {
      const it = getItem(mm, id);
      it.status = 'accepted';
      const now = new Date().toISOString();
      it.accepted = { file: it.output, model: 'upload', promptUsed: null, generatedAt: now, acceptedAt: now, source: 'upload', width: out.width, height: out.height };
      return summarize(mm, it);
    });
  }

  async function deleteCandidates(id) {
    await mustItem(id);
    if (busy.has(id)) throw new StudioError('생성 중에는 후보를 지울 수 없습니다.', { status: 409, code: 'BUSY' });
    await rm(candDir(id), { recursive: true, force: true });
    await withManifest((m) => {
      const it = getItem(m, id);
      if (it.status === 'candidate') it.status = 'todo';
    });
  }

  function summarize(m, item) {
    return {
      ...item,
      kindLabel: KIND_LABELS[item.kind],
      promptRendered: framePrompts(item)[0],
      refsStatus: item.refs.map((r) => {
        const ri = getItem(m, r);
        return { id: r, label: ri?.label ?? r, status: ri?.status ?? 'missing' };
      }),
      url: item.status === 'accepted' ? publicUrl(item) : null,
      busy: busy.has(item.id),
    };
  }

  function publicUrl(item, file = item.accepted?.file ?? item.output) {
    const v = encodeURIComponent((item.accepted?.acceptedAt ?? item.accepted?.generatedAt ?? '').replace(/\D/g, '').slice(0, 14));
    return `${GENERATED_URL}/${file}${v ? `?v=${v}` : ''}`;
  }

  /** Admin listing: every item with rendered prompt, ref status and candidate count. */
  async function listItems() {
    const m = await loadManifest(manifestPath);
    const items = [];
    for (const item of m.items) items.push({ ...summarize(m, item), candidateCount: (await listCandidates(item.id)).length });
    return { settings: m.settings ?? {}, items };
  }

  async function getItemDetail(id) {
    const { m, item } = await mustItem(id);
    return { item: summarize(m, item), candidates: await listCandidates(id) };
  }

  /** Public index for the game client: accepted assets whose files exist, keyed by id. */
  async function publicIndex() {
    const m = await loadManifest(manifestPath);
    const assets = {};
    for (const item of m.items) {
      if (item.status !== 'accepted' || !item.accepted?.file) continue;
      if (!(await exists(outPath(item.accepted.file)))) continue;
      const entry = { url: publicUrl(item), kind: item.kind, width: item.accepted.width ?? null, height: item.accepted.height ?? null, meta: item.meta ?? {} };
      if (item.kind === 'sprite') {
        const [, jsonOut, animOut] = outputsFor(item);
        entry.sheet = publicUrl(item, jsonOut);
        if (await exists(outPath(animOut))) entry.anim = publicUrl(item, animOut);
      }
      if (item.anchor) entry.anchor = item.anchor;
      assets[item.id] = entry;
    }
    return { version: m.version ?? 1, assets };
  }

  /** Select items for batch runs, in dependency order. */
  async function select({ only, kind, all } = {}) {
    const m = await loadManifest(manifestPath);
    let items = topoOrder(m.items);
    if (only?.length) {
      const missing = only.filter((id) => !getItem(m, id));
      if (missing.length) throw new StudioError(`없는 항목: ${missing.join(', ')}`, { status: 404, code: 'NOT_FOUND' });
      items = items.filter((i) => only.includes(i.id));
    } else if (kind) items = items.filter((i) => i.kind === kind);
    else if (!all) items = [];
    return items.map((i) => ({ ...summarize(m, i), calls: (i.kind === 'sprite' ? i.frames.length : 1) }));
  }

  return {
    client: gemini,
    generateCandidates,
    regenerate,
    accept,
    upload,
    deleteCandidates,
    listCandidates,
    candidateFile,
    listItems,
    getItemDetail,
    publicIndex,
    select,
    isBusy: (id) => busy.has(id),
  };
}
