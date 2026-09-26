// Asset studio HTTP layer.
// - /admin/api/assets/*  admin-only studio API (cookie auth from routes/admin.js)
// - /api/assets          public index of accepted assets for the game client (no auth)
// - /admin/assets        studio page
// The Gemini API key is write-only over HTTP: responses only ever carry `hasKey` / `keySource`.
import express from 'express';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStudio } from '../assets/studio.js';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');
const MAX_JOBS = 50;
const UPLOAD_LIMIT = '25mb';
const JSON_UPLOAD_LIMIT = '34mb'; // base64 of UPLOAD_LIMIT
export const UPLOAD_PATH = '/admin/api/assets/upload';

/** Base64 (optionally a `data:image/...;base64,` URL) → Buffer, or null when malformed. */
export function decodeBase64Image(str) {
  const m = /^data:image\/[a-z0-9.+-]+;base64,(.*)$/is.exec(str.trim());
  const b64 = (m ? m[1] : str).replace(/\s+/g, '');
  if (!b64 || !/^[A-Za-z0-9+/_-]+=*$/.test(b64)) return null;
  return Buffer.from(b64, 'base64');
}

/**
 * Mount at UPLOAD_PATH *before* the app-wide 64kb JSON parser: it marks the body as handled so that
 * parser skips it, and the upload route parses it itself (large limit) only after admin auth.
 */
export const assetUploadJsonParser = () => (req, res, next) => {
  if (!req._body) {
    req._body = true;
    req.assetUploadDeferred = true;
  }
  next();
};
const resumeDeferredBody = (req, res, next) => {
  if (req.assetUploadDeferred) req._body = false;
  next();
};

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function jobView(j) {
  return {
    id: j.id,
    itemId: j.itemId,
    status: j.status,
    done: j.done,
    total: j.total,
    error: j.error ?? null,
    errors: j.errors ?? [],
    candidates: j.candidates ?? [],
    startedAt: j.startedAt,
    finishedAt: j.finishedAt ?? null,
  };
}

export function createAdminAssetsRouter({ requireAdmin, studio, log = () => {} }) {
  const router = express.Router();
  const jobs = new Map();
  router.use(requireAdmin);

  const status = async () => {
    const [usage, hasKey, keySource] = await Promise.all([studio.client.getUsage(), studio.client.hasKey(), studio.client.keySource()]);
    return { usage, hasKey, keySource, model: studio.client.model };
  };

  router.get(
    '/',
    wrap(async (req, res) => {
      const [list, st] = await Promise.all([studio.listItems(), status()]);
      const running = [...jobs.values()].filter((j) => j.status === 'running').map(jobView);
      res.json({ ...list, ...st, jobs: running });
    }),
  );

  router.get(
    '/status',
    wrap(async (req, res) => res.json(await status())),
  );

  router.get(
    '/items/:id',
    wrap(async (req, res) => res.json(await studio.getItemDetail(req.params.id))),
  );

  router.post(
    '/key',
    wrap(async (req, res) => {
      await studio.client.setKey(req.body?.key);
      log('[assets] Gemini API 키가 저장되었습니다.');
      res.json({ ok: true, ...(await status()) });
    }),
  );

  router.delete(
    '/key',
    wrap(async (req, res) => {
      await studio.client.clearKey();
      res.json({ ok: true, ...(await status()) });
    }),
  );

  router.post(
    '/generate/:id',
    wrap(async (req, res) => {
      const itemId = req.params.id;
      const { count, force, prompt } = req.body ?? {};
      await studio.getItemDetail(itemId); // 404 early
      if ([...jobs.values()].some((j) => j.itemId === itemId && j.status === 'running')) {
        return res.status(409).json({ error: '이 항목은 이미 생성 중입니다.' });
      }
      const job = { id: randomBytes(6).toString('hex'), itemId, status: 'running', done: 0, total: 0, startedAt: new Date().toISOString() };
      jobs.set(job.id, job);
      if (jobs.size > MAX_JOBS) jobs.delete(jobs.keys().next().value);
      studio
        .generateCandidates(itemId, {
          count,
          force: Boolean(force),
          prompt: typeof prompt === 'string' && prompt.trim() ? prompt : undefined,
          onProgress: ({ done, total }) => Object.assign(job, { done, total }),
        })
        .then((r) => Object.assign(job, { status: 'done', candidates: r.candidates.map((c) => c.n), errors: r.errors }))
        .catch((e) => Object.assign(job, { status: 'error', error: e.message }))
        .finally(() => {
          job.finishedAt = new Date().toISOString();
          if (job.status === 'error') log(`[assets] ${itemId} 생성 실패: ${job.error}`);
        });
      res.status(202).json({ job: jobView(job) });
    }),
  );

  router.get('/jobs/:jobId', (req, res) => {
    const j = jobs.get(req.params.jobId);
    if (!j) return res.status(404).json({ error: '작업을 찾을 수 없습니다.' });
    res.json({ job: jobView(j) });
  });

  router.get(
    '/candidates/:id',
    wrap(async (req, res) => res.json({ candidates: await studio.listCandidates(req.params.id) })),
  );

  router.get(
    '/candidates/:id/:n',
    wrap(async (req, res) => {
      const variant = req.query.anim ? 'anim' : req.query.preview ? 'preview' : 'png';
      const file = await studio.candidateFile(req.params.id, req.params.n, variant);
      res.setHeader('Cache-Control', 'no-store');
      res.sendFile(file);
    }),
  );

  router.delete(
    '/candidates/:id',
    wrap(async (req, res) => {
      await studio.deleteCandidates(req.params.id);
      res.json({ ok: true });
    }),
  );

  router.post(
    '/accept/:id',
    wrap(async (req, res) => {
      const n = req.body?.n;
      if (!Number.isInteger(n) || n < 1) return res.status(400).json({ error: '채택할 후보 번호가 필요합니다.' });
      res.json({ item: await studio.accept(req.params.id, n) });
    }),
  );

  // Body: raw image (Content-Type: image/*) or JSON {data: base64 | data URL, process?}.
  // JSON bodies are parsed by assetUploadJsonParser (mounted before the app's 64kb JSON parser).
  router.post(
    '/upload/:id',
    resumeDeferredBody,
    express.raw({ type: 'image/*', limit: UPLOAD_LIMIT }),
    express.json({ limit: JSON_UPLOAD_LIMIT }),
    wrap(async (req, res) => {
      const flag = (v) => v === true || v === 1 || v === '1' || v === 'true';
      let buffer = null;
      let process = flag(req.query.process);
      if (Buffer.isBuffer(req.body)) buffer = req.body;
      else if (req.body && typeof req.body.data === 'string') {
        buffer = decodeBase64Image(req.body.data);
        process = process || flag(req.body.process);
      }
      if (!buffer?.length) {
        return res.status(400).json({ error: '이미지 파일(Content-Type: image/*) 또는 {"data": base64} JSON을 보내주세요.' });
      }
      res.json({ item: await studio.upload(req.params.id, buffer, { process }) });
    }),
  );

  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => {
    const st = err.status || err.statusCode || (err.code === 'BAD_INPUT' ? 400 : 500);
    if (err.type === 'entity.too.large') return res.status(413).json({ error: '업로드 파일이 너무 큽니다. (최대 25MB)' });
    if (err.type) return res.status(st).json({ error: '요청 형식이 올바르지 않습니다.' }); // body-parser errors
    if (st >= 500) log(`[assets] 오류: ${err.message}`);
    res.status(st).json({ error: st >= 500 && !err.code ? '서버 오류가 발생했습니다.' : err.message, code: err.code });
  });

  return router;
}

export function createPublicAssetsRouter({ studio }) {
  const router = express.Router();
  router.get(
    '/',
    wrap(async (req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.json(await studio.publicIndex());
    }),
  );
  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => res.status(500).json({ error: '에셋 목록을 읽을 수 없습니다.', assets: {} }));
  return router;
}

/**
 * Mount everything asset-related. Call before the `/api` 404 fallback.
 * @returns the studio instance
 */
export function mountAssetRoutes(app, { requireAdmin, dataDir, studio, studioOptions = {}, log = () => {} }) {
  const st = studio ?? createStudio({ dataDir, log, ...studioOptions });
  app.use('/api/assets', createPublicAssetsRouter({ studio: st }));
  app.use('/admin/api/assets', createAdminAssetsRouter({ requireAdmin, studio: st, log }));
  app.get(['/admin/assets', '/admin/assets/'], (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin-assets.html')));
  return st;
}
