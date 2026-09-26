// App boot: static files, routes, store.
import express from 'express';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as config from './config.js';
import { RoomStore } from './store/roomStore.js';
import { createApiRouter } from './routes/api.js';
import { createSseRouter } from './routes/sse.js';
import { createAdminRouter } from './routes/admin.js';
import { UPLOAD_PATH, assetUploadJsonParser, mountAssetRoutes } from './routes/adminAssets.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

export function createApp({ store, adminPassword, heartbeatMs = 15000, assets = {} }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(UPLOAD_PATH, assetUploadJsonParser()); // large asset uploads are parsed after admin auth
  app.use(express.json({ limit: '64kb' }));

  app.use('/api', createSseRouter({ store, heartbeatMs }));
  app.use('/api', createApiRouter({ store }));
  const adminRouter = createAdminRouter({ store, adminPassword });
  app.use('/admin/api', adminRouter);
  mountAssetRoutes(app, { requireAdmin: adminRouter.requireAdmin, dataDir: store.dataDir, ...assets });
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
} = {}) {
  const store = new RoomStore({ dataDir, debounceMs, log });
  await store.load();
  const app = createApp({ store, adminPassword, heartbeatMs, assets: { log, ...assets } });
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(port, host, () => resolve(s));
    s.on('error', reject);
  });
  const actualPort = server.address().port;
  const close = async () => {
    await store.close();
    await new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
  };
  return { app, server, store, port: actualPort, url: `http://localhost:${actualPort}`, close };
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
