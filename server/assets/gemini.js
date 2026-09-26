// Gemini image generation client (REST, "Nano Banana" = gemini-2.5-flash-image).
// Security: the API key is only read here, sent only in the x-goog-api-key header, and scrubbed
// from every error message. It is never logged and never returned to callers.
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_MODEL = 'gemini-2.5-flash-image';
export const DEFAULT_DAILY_CAP = 300;
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL_RE = /^[a-z0-9][a-z0-9.\-_]{1,80}$/i;

export class GeminiError extends Error {
  constructor(message, { code = 'GEMINI_ERROR', status, retryable = false } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

/** Small promise semaphore. */
export function createLimiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active--;
        next();
      });
  };
  const run = (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
  run.stats = () => ({ active, queued: queue.length });
  return run;
}

export function sniffMime(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length > 6 && buf.toString('ascii', 0, 3) === 'GIF') return 'image/gif';
  return null;
}

async function writeJsonAtomic(file, obj, mode) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(obj, null, 2)}\n`, mode ? { mode } : undefined);
  if (mode) await chmod(tmp, mode);
  await rename(tmp, file);
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

const sleepDefault = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {object} opts
 * @param {string} opts.dataDir         where secrets.json / assets-usage.json live
 * @param {Function} [opts.fetchImpl]   injectable fetch (tests)
 * @param {object} [opts.env]           env source (GEMINI_API_KEY, GEMINI_MODEL, ASSET_DAILY_CAP)
 * @param {string} [opts.model]         default model id (env GEMINI_MODEL wins)
 * @param {number} [opts.dailyCap]      max successful generations per UTC day (env ASSET_DAILY_CAP wins)
 */
export function createGeminiClient({
  dataDir,
  fetchImpl = globalThis.fetch,
  env = process.env,
  model,
  dailyCap,
  concurrency = 2,
  retries = 3,
  backoffMs = 1500,
  timeoutMs = 120_000,
  sleep = sleepDefault,
  now = () => new Date(),
  log = () => {},
} = {}) {
  if (!dataDir) throw new Error('dataDir required');
  const secretsFile = path.join(dataDir, 'secrets.json');
  const usageFile = path.join(dataDir, 'assets-usage.json');
  const limit = createLimiter(concurrency);
  const envCap = Number(env.ASSET_DAILY_CAP);
  const cap = Number.isInteger(envCap) && envCap >= 0 ? envCap : (dailyCap ?? DEFAULT_DAILY_CAP);
  const defaultModel = env.GEMINI_MODEL || model || DEFAULT_MODEL;
  let inflight = 0;
  let usageChain = Promise.resolve();

  async function fileKey() {
    const s = await readJson(secretsFile, {});
    return typeof s.geminiApiKey === 'string' && s.geminiApiKey ? s.geminiApiKey : null;
  }
  async function resolveKey() {
    if (env.GEMINI_API_KEY) return { key: env.GEMINI_API_KEY, source: 'env' };
    const k = await fileKey();
    return k ? { key: k, source: 'file' } : { key: null, source: null };
  }
  const scrub = (msg, key) => {
    let s = String(msg ?? '');
    if (key) s = s.split(key).join('***');
    return s.replace(/AIza[0-9A-Za-z_-]{20,}/g, '***');
  };

  const today = () => now().toISOString().slice(0, 10);
  async function readUsage() {
    const u = await readJson(usageFile, null);
    const d = today();
    if (!u || u.date !== d || !Number.isInteger(u.count)) return { date: d, count: 0 };
    return { date: u.date, count: u.count };
  }
  function bumpUsage() {
    usageChain = usageChain.then(async () => {
      const u = await readUsage();
      u.count += 1;
      u.updatedAt = now().toISOString();
      await writeJsonAtomic(usageFile, u);
    });
    return usageChain;
  }

  async function callOnce({ key, modelId, body }) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(`${API_BASE}/${encodeURIComponent(modelId)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new GeminiError(`네트워크 오류: ${scrub(e?.message, key)}`, { code: 'NETWORK', retryable: true });
    } finally {
      clearTimeout(timer);
    }
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* non-JSON body */
    }
    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      const detail = scrub(json?.error?.message ?? '', key).slice(0, 300);
      const err = new GeminiError(`Gemini 요청 실패 (HTTP ${res.status})${detail ? `: ${detail}` : ''}`, {
        code: res.status === 429 ? 'RATE_LIMIT' : res.status === 400 || res.status === 403 ? 'BAD_REQUEST' : 'HTTP',
        status: res.status,
        retryable,
      });
      const ra = Number(res.headers?.get?.('retry-after'));
      if (Number.isFinite(ra) && ra > 0) err.retryAfterMs = Math.min(ra * 1000, 60_000);
      throw err;
    }
    // A 200 is billed whether or not it contains an image.
    await bumpUsage();
    const parts = json?.candidates?.[0]?.content?.parts ?? [];
    const img = parts.find((p) => p.inlineData?.data || p.inline_data?.data);
    const text = parts
      .filter((p) => typeof p.text === 'string')
      .map((p) => p.text)
      .join(' ')
      .trim();
    if (!img) {
      const reason = json?.candidates?.[0]?.finishReason || json?.promptFeedback?.blockReason || '';
      throw new GeminiError(`이미지가 생성되지 않았습니다${reason ? ` (${reason})` : ''}${text ? `: ${scrub(text, key).slice(0, 200)}` : ''}`, {
        code: 'NO_IMAGE',
      });
    }
    const data = img.inlineData ?? img.inline_data;
    return { buffer: Buffer.from(data.data, 'base64'), mimeType: data.mimeType || data.mime_type || 'image/png', text };
  }

  /**
   * Generate one image.
   * @param {{prompt: string, refs?: Array<{path?: string, buffer?: Buffer, mimeType?: string}>, aspectRatio?: string, model?: string}} req
   * @returns {Promise<{buffer: Buffer, mimeType: string, text: string, model: string}>}
   */
  async function generateImage({ prompt, refs = [], aspectRatio, model: modelOverride } = {}) {
    if (typeof prompt !== 'string' || !prompt.trim()) throw new GeminiError('프롬프트가 비어 있습니다.', { code: 'BAD_INPUT' });
    const modelId = modelOverride || defaultModel;
    if (!MODEL_RE.test(modelId)) throw new GeminiError('모델 ID 형식이 올바르지 않습니다.', { code: 'BAD_INPUT' });
    const parts = [];
    for (const r of refs) {
      const buffer = r.buffer ?? (await readFile(r.path));
      const mimeType = r.mimeType || sniffMime(buffer) || 'image/png';
      parts.push({ inlineData: { mimeType, data: buffer.toString('base64') } });
    }
    parts.push({ text: prompt });
    const body = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseModalities: ['IMAGE', 'TEXT'],
        ...(aspectRatio ? { imageConfig: { aspectRatio } } : {}),
      },
    };

    return limit(async () => {
      const { key } = await resolveKey();
      if (!key) throw new GeminiError('Gemini API 키가 설정되지 않았습니다.', { code: 'NO_KEY' });
      const u = await readUsage();
      if (u.count + inflight >= cap) {
        throw new GeminiError(`오늘 생성 한도(${cap}장)에 도달했습니다.`, { code: 'DAILY_CAP' });
      }
      inflight++;
      try {
        for (let attempt = 0; ; attempt++) {
          try {
            const out = await callOnce({ key, modelId, body });
            return { ...out, model: modelId };
          } catch (e) {
            if (!e.retryable || attempt >= retries) throw e;
            const wait = e.retryAfterMs ?? backoffMs * 2 ** attempt;
            log(`[assets] Gemini 재시도 ${attempt + 1}/${retries} (${e.status ?? e.code}) ${wait}ms 후`);
            await sleep(wait);
          }
        }
      } finally {
        inflight--;
      }
    });
  }

  async function hasKey() {
    return Boolean((await resolveKey()).key);
  }
  async function keySource() {
    return (await resolveKey()).source;
  }

  /** Store the key in DATA_DIR/secrets.json (mode 600). Other secrets in the file are preserved. */
  async function setKey(key) {
    if (typeof key !== 'string' || !/^[\x21-\x7e]{20,200}$/.test(key.trim())) {
      throw new GeminiError('API 키 형식이 올바르지 않습니다.', { code: 'BAD_INPUT' });
    }
    const s = await readJson(secretsFile, {});
    s.geminiApiKey = key.trim();
    await writeJsonAtomic(secretsFile, s, 0o600);
  }
  async function clearKey() {
    const s = await readJson(secretsFile, {});
    delete s.geminiApiKey;
    await writeJsonAtomic(secretsFile, s, 0o600);
  }

  async function getUsage() {
    const u = await readUsage();
    return { date: u.date, count: u.count, cap, remaining: Math.max(0, cap - u.count) };
  }

  return { generateImage, hasKey, keySource, setKey, clearKey, getUsage, model: defaultModel, cap, stats: () => limit.stats() };
}
