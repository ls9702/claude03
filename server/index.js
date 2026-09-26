// App boot: static files, routes, store.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as config from './config.js';
import { RoomStore } from './store/roomStore.js';
import { GameRunner } from './store/gameRunner.js';
import { createApiRouter } from './routes/api.js';
import { createSseRouter } from './routes/sse.js';
import { createAdminRouter } from './routes/admin.js';
import { UPLOAD_PATH, assetUploadJsonParser, mountAssetRoutes } from './routes/adminAssets.js';
import { createStudio } from './assets/studio.js';
import { createCharArtService } from './assets/charArt.js';
import { FAKE_KEY, createFakeGeminiFetch } from './assets/fakeGemini.js';
import { CharArtRunner } from './store/charArtRunner.js';
import { getAvatars } from './data/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

export function createApp({ store, runner = new GameRunner(store), adminPassword, heartbeatMs = 15000, assets = {} }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(UPLOAD_PATH, assetUploadJsonParser()); // large asset uploads are parsed after admin auth
  app.use(express.json({ limit: '64kb' }));

  // One Gemini client (limiter + daily cap) shared by the asset studio and the AI character art.
  const { studio: givenStudio, studioOptions = {}, charArtOptions = {}, charArtThrottleMs = 1000, log = () => {}, ...assetRest } = assets;
  const studio = givenStudio ?? createStudio({ dataDir: store.dataDir, log, ...studioOptions });
  const artService = createCharArtService({ dataDir: store.dataDir, client: studio.client, avatars: getAvatars(), log, ...charArtOptions });
  const charArt = new CharArtRunner(store, artService, { log, throttleMs: charArtThrottleMs });
  app.locals.charArt = charArt;

  app.use('/api', createSseRouter({ store, heartbeatMs }));
  app.use('/api', createApiRouter({ store, runner, charArt }));
  const adminRouter = createAdminRouter({ store, runner, adminPassword, charArt });
  app.use('/admin/api', adminRouter);
  mountAssetRoutes(app, { requireAdmin: adminRouter.requireAdmin, dataDir: store.dataDir, studio, log, ...assetRest });
  // Optional 3D model drop-ins (public/assets/models/*.glb) — lets the client skip 404 probes.
  app.get('/api/models', (req, res) => {
    let models = [];
    try {
      models = fs.readdirSync(path.join(PUBLIC_DIR, 'assets', 'models')).filter((f) => /\.(glb|gltf)$/i.test(f)).sort();
    } catch {
      /* no models folder */
    }
    res.json({ models });
  });
  // Optional audio drop-ins (public/assets/audio/bgm_<era>.mp3, sfx_<name>.mp3) — listed once, no 404 probes.
  app.get('/api/audio', (req, res) => {
    let files = [];
    try {
      files = fs.readdirSync(path.join(PUBLIC_DIR, 'assets', 'audio')).filter((f) => /^(bgm|sfx)_[a-z0-9_-]+\.(mp3|ogg|m4a|wav)$/i.test(f)).sort();
    } catch {
      /* no audio folder */
    }
    res.json({ files });
  });
  app.use(['/api', '/admin/api'], (req, res) => res.status(404).json({ error: '없는 API입니다.' }));

  app.get(['/admin', '/admin/'], (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
  app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

  // JSON error handler (bad JSON body etc.)
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status === 400 ? '요청 형식이 올바르지 않습니다.' : '서버 오류가 발생했습니다.' });
  });
  return app;
}

/** Boot a server. Used by main entry and tests (port 0 = ephemeral). */
export async function startServer({
  port = config.PORT,
  host,
  dataDir = config.DATA_DIR,
  adminPassword = config.ADMIN_PASSWORD,
  heartbeatMs = 15000,
  debounceMs = 300,
  log = () => {},
  assets,
  charArtFake = config.CHAR_ART_FAKE,
} = {}) {
  const store = new RoomStore({ dataDir, debounceMs, log });
  await store.load();
  const runner = new GameRunner(store, { log });
  runner.restore(); // re-arm prompt deadline timers of restored rooms
  let assetOpts = { log, ...assets };
  if (charArtFake && !assetOpts.studio && !assetOpts.studioOptions?.fetchImpl) {
    // TEST-ONLY (manual smoke): fake Gemini endpoint + fake key; the real API is never called.
    log(`[경고] CHAR_ART_FAKE=${charArtFake}: 가짜 Gemini로 동작합니다 (테스트 전용).`);
    assetOpts = {
      ...assetOpts,
      studioOptions: {
        ...(assetOpts.studioOptions ?? {}),
        fetchImpl: createFakeGeminiFetch({ mode: charArtFake, delayMs: config.CHAR_ART_FAKE_DELAY_MS }),
        env: { ...process.env, GEMINI_API_KEY: FAKE_KEY },
      },
    };
  }
  const app = createApp({ store, runner, adminPassword, heartbeatMs, assets: assetOpts });
  app.locals.charArt.restore(); // AI art jobs do not survive a restart → pending becomes failed
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(port, host, () => resolve(s));
    s.on('error', reject);
  });
  const actualPort = server.address().port;
  const close = async () => {
    runner.stop();
    app.locals.charArt.stop();
    await store.close();
    await new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
  };
  return { app, server, store, runner, port: actualPort, url: `http://localhost:${actualPort}`, close };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  config.warnIfDefaults();
  const { port, store, close } = await startServer({ log: (m) => console.log(m) });
  console.log(`인생게임 서버 실행 중: http://localhost:${port}  (관리자: http://localhost:${port}/admin)`);
  console.log(`데이터 폴더: ${config.DATA_DIR} · 복원된 방 ${store.rooms.size}개`);
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    console.log('종료 중… 저장합니다.');
    await close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
