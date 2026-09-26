import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { startServer } from '../server/index.js';
import { tempDir } from './helpers.js';
import sharp from 'sharp';
import { fakeGeminiFetch, tempManifest } from './assetFixtures.js';

const KEY = 'AIzaSyROUTE_TEST_KEY_0123456789abcdef';
let srv;
let tmp;
let cookie;
let outputDir;
const logs = [];
const fetchImpl = fakeGeminiFetch();

before(async () => {
  tmp = await tempDir();
  outputDir = path.join(tmp.dir, 'generated');
  const manifestPath = await tempManifest(path.join(tmp.dir, 'm'), ['style-anchor', 'char-schoolgirl-base', 'icon-money']);
  srv = await startServer({
    port: 0,
    host: '127.0.0.1',
    dataDir: path.join(tmp.dir, 'data'),
    adminPassword: 'pw',
    debounceMs: 10,
    log: (m) => logs.push(String(m)),
    assets: { studioOptions: { manifestPath, outputDir, fetchImpl, env: {} } },
  });
});

after(async () => {
  await srv?.close();
  await tmp?.cleanup();
});

async function call(method, p, { body, headers = {}, raw } = {}) {
  const h = { ...headers };
  if (cookie) h.cookie = cookie;
  if (body !== undefined && !raw) h['content-type'] = 'application/json';
  const res = await fetch(srv.url + p, { method, headers: h, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null;
  try {
    json = JSON.parse(buf.toString('utf8'));
  } catch {
    /* binary */
  }
  return { status: res.status, json, text: buf.toString('utf8'), buf, type: res.headers.get('content-type') };
}

async function waitJob(id) {
  for (let i = 0; i < 100; i++) {
    const { json } = await call('GET', `/admin/api/assets/jobs/${id}`);
    if (json.job.status !== 'running') return json.job;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('job did not finish');
}

test('studio API requires the admin cookie (401), public index does not', async () => {
  for (const [m, p] of [
    ['GET', '/admin/api/assets'],
    ['GET', '/admin/api/assets/status'],
    ['POST', '/admin/api/assets/key'],
    ['POST', '/admin/api/assets/generate/style-anchor'],
    ['GET', '/admin/api/assets/candidates/style-anchor/1'],
    ['POST', '/admin/api/assets/accept/style-anchor'],
    ['DELETE', '/admin/api/assets/candidates/style-anchor'],
  ]) {
    const r = await call(m, p, m === 'GET' || m === 'DELETE' ? {} : { body: { key: KEY, n: 1 } });
    assert.equal(r.status, 401, `${m} ${p}`);
  }
  // A large upload body is rejected by auth before it is parsed.
  const big = await call('POST', '/admin/api/assets/upload/style-anchor', { body: { data: 'A'.repeat(200_000) } });
  assert.equal(big.status, 401);
  const pub = await call('GET', '/api/assets');
  assert.equal(pub.status, 200);
  assert.deepEqual(pub.json, { version: 1, assets: {} });
  const page = await call('GET', '/admin/assets');
  assert.equal(page.status, 200);
  assert.match(page.text, /에셋 스튜디오/);
});

test('full studio flow over HTTP; the key never appears in responses or logs', async () => {
  const login = await fetch(`${srv.url}/admin/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'pw' }) });
  cookie = login.headers.get('set-cookie').split(';')[0];

  const list = await call('GET', '/admin/api/assets');
  assert.equal(list.status, 200);
  assert.equal(list.json.hasKey, false);
  assert.equal(list.json.model, 'gemini-2.5-flash-image');
  assert.deepEqual(Object.keys(list.json.usage).sort(), ['cap', 'count', 'date', 'remaining']);
  assert.deepEqual(list.json.items.map((i) => i.id), ['style-anchor', 'char-schoolgirl-base', 'icon-money']);
  const it = list.json.items[0];
  for (const k of ['kind', 'kindLabel', 'label', 'status', 'prompt', 'promptRendered', 'refsStatus', 'candidateCount', 'output']) assert.ok(k in it, k);

  const noKey = await call('POST', '/admin/api/assets/generate/style-anchor', { body: { count: 1 } });
  assert.equal(noKey.status, 202);
  const failed = await waitJob(noKey.json.job.id);
  assert.equal(failed.status, 'error');
  assert.match(failed.error, /키가 설정되지 않았습니다/);

  assert.equal((await call('POST', '/admin/api/assets/key', { body: { key: 'x' } })).status, 400);
  const setKey = await call('POST', '/admin/api/assets/key', { body: { key: KEY } });
  assert.equal(setKey.status, 200);
  assert.equal(setKey.json.hasKey, true);
  assert.equal(setKey.json.keySource, 'file');
  const secrets = path.join(tmp.dir, 'data', 'secrets.json');
  assert.equal((await stat(secrets)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(secrets, 'utf8')).geminiApiKey, KEY);

  const gen = await call('POST', '/admin/api/assets/generate/style-anchor', { body: { count: 2 } });
  assert.equal(gen.status, 202);
  const job = await waitJob(gen.json.job.id);
  assert.equal(job.status, 'done');
  assert.deepEqual(job.candidates, [1, 2]);
  assert.equal(job.total, 2);
  assert.equal(fetchImpl.calls.at(-1).headers['x-goog-api-key'], KEY, 'key only goes to Gemini');
  assert.equal((await call('POST', '/admin/api/assets/generate/nope', { body: {} })).status, 404);

  const png = await call('GET', '/admin/api/assets/candidates/style-anchor/1');
  assert.equal(png.status, 200);
  assert.equal(png.type, 'image/png');
  const prev = await call('GET', '/admin/api/assets/candidates/style-anchor/1?preview=1');
  assert.equal(prev.type, 'image/webp');
  assert.equal((await call('GET', '/admin/api/assets/candidates/style-anchor/7')).status, 404);
  assert.equal((await call('GET', '/admin/api/assets/candidates/style-anchor')).json.candidates.length, 2);

  assert.equal((await call('POST', '/admin/api/assets/accept/style-anchor', { body: {} })).status, 400);
  const acc = await call('POST', '/admin/api/assets/accept/style-anchor', { body: { n: 2 } });
  assert.equal(acc.status, 200);
  assert.equal(acc.json.item.status, 'accepted');
  const again = await call('POST', '/admin/api/assets/generate/style-anchor', { body: { count: 1 } });
  assert.equal((await waitJob(again.json.job.id)).status, 'error', 'accepted item not regenerated without force');

  // Uploads: base64 JSON (bigger than the app-wide 64kb JSON limit) and a raw image body.
  const big = await sharp({ create: { width: 300, height: 300, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 40 } } }).png().toBuffer();
  assert.ok(big.length > 64 * 1024, 'upload body exceeds the 64kb app-wide JSON limit');
  const b64 = await call('POST', '/admin/api/assets/upload/icon-money', { body: { data: `data:image/png;base64,${big.toString('base64')}`, process: false } });
  assert.equal(b64.status, 200, b64.text);
  assert.equal(b64.json.item.accepted.source, 'upload');
  const rawUp = await call('POST', '/admin/api/assets/upload/icon-money?process=1', { raw: big, headers: { 'content-type': 'image/png' } });
  assert.equal(rawUp.status, 200, rawUp.text);
  assert.equal((await call('POST', '/admin/api/assets/upload/icon-money', { body: { data: '!!!' } })).status, 400);
  assert.equal((await call('POST', '/admin/api/assets/upload/icon-money', { raw: 'hello', headers: { 'content-type': 'text/plain' } })).status, 400);

  const del = await call('DELETE', '/admin/api/assets/candidates/style-anchor');
  assert.equal(del.status, 200);
  assert.equal((await call('GET', '/admin/api/assets/candidates/style-anchor')).json.candidates.length, 0);

  // Public index for the game client.
  const pub = await call('GET', '/api/assets');
  assert.equal(pub.status, 200);
  assert.equal(pub.json.version, 1);
  assert.deepEqual(Object.keys(pub.json.assets).sort(), ['icon-money', 'style-anchor']);
  const a = pub.json.assets['style-anchor'];
  assert.equal(a.kind, 'anchor');
  assert.match(a.url, /^\/assets\/generated\/anchor\/style-anchor\.png\?v=\d+$/);
  assert.equal(typeof a.width, 'number');
  assert.equal(pub.json.assets['icon-money'].meta.tile, 'money');

  // Browser helper (public/js/assets.js) against the same endpoint, with placeholder fallback.
  const client = await import('../public/js/assets.js');
  assert.equal(client.assetUrl('style-anchor', 'fallback.svg'), 'fallback.svg', 'before loading → fallback');
  await client.loadAssetIndex({ force: true, fetchImpl: (u, o) => fetch(srv.url + u, o) });
  assert.equal(client.assetUrl('style-anchor'), a.url);
  assert.equal(client.assetUrl('bg-school', 'fallback.svg'), 'fallback.svg');
  assert.equal(client.assetUrl('bg-school'), null);
  assert.equal(client.findAsset({ kind: 'icon', tile: 'money' }).id, 'icon-money');
  assert.equal(client.findAsset({ kind: 'frame', tone: 'love' }), null);
  assert.equal(client.hasAsset('icon-money'), true);
  await client.loadAssetIndex({ force: true, fetchImpl: async () => new Response('x', { status: 500 }) });
  assert.equal(client.assetUrl('style-anchor', 'fb'), 'fb', 'failed index → placeholders');

  const status = await call('GET', '/admin/api/assets/status');
  assert.equal(status.json.usage.count, 2);

  // The key must not leak anywhere we can observe.
  const everything = [list, setKey, gen, acc, status, pub, await call('GET', '/admin/api/assets'), await call('GET', '/admin/api/assets/items/style-anchor')]
    .map((r) => r.text)
    .join('\n');
  assert.ok(!everything.includes(KEY), 'key in an HTTP response');
  assert.ok(!logs.join('\n').includes(KEY), 'key in server logs');
});
