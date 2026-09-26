import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createGeminiClient, createLimiter, DEFAULT_MODEL } from '../server/assets/gemini.js';
import { tempDir } from './helpers.js';
import { geminiResponse, jsonResponse, scene } from './assetFixtures.js';

const KEY = 'AIzaSyTESTKEY_0123456789abcdefghijk';
const noSleep = async () => {};

function client(dir, opts = {}) {
  return createGeminiClient({ dataDir: dir, env: { GEMINI_API_KEY: KEY }, sleep: noSleep, ...opts });
}

test('generateImage posts prompt + inline refs + aspect ratio and returns the image', async (t) => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const img = await scene();
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return jsonResponse(200, geminiResponse(img, 'here you go'));
  };
  const c = client(tmp.dir, { fetchImpl });
  const refPath = path.join(tmp.dir, 'ref.png');
  await writeFile(refPath, img);
  const out = await c.generateImage({ prompt: 'a scene', refs: [{ path: refPath }, { buffer: img }], aspectRatio: '16:9' });
  assert.ok(Buffer.isBuffer(out.buffer));
  assert.deepEqual(out.buffer, img);
  assert.equal(out.mimeType, 'image/png');
  assert.equal(out.text, 'here you go');
  assert.equal(out.model, DEFAULT_MODEL);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /models\/gemini-2\.5-flash-image:generateContent$/);
  assert.equal(calls[0].init.headers['x-goog-api-key'], KEY);
  assert.doesNotMatch(calls[0].url, /key=/, 'key goes in a header, never in the URL');
  const parts = calls[0].body.contents[0].parts;
  assert.equal(parts.filter((p) => p.inlineData).length, 2);
  assert.equal(parts[0].inlineData.mimeType, 'image/png');
  assert.equal(parts.at(-1).text, 'a scene');
  assert.deepEqual(calls[0].body.generationConfig.responseModalities, ['IMAGE', 'TEXT']);
  assert.equal(calls[0].body.generationConfig.imageConfig.aspectRatio, '16:9');
  assert.deepEqual(await c.getUsage().then((u) => [u.count, u.cap]), [1, 300]);
});

test('model id is configurable (option, env GEMINI_MODEL, per call)', async (t) => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const img = await scene();
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return jsonResponse(200, geminiResponse(img));
  };
  const a = client(tmp.dir, { fetchImpl, model: 'model-a' });
  await a.generateImage({ prompt: 'x' });
  await a.generateImage({ prompt: 'x', model: 'model-b' });
  const b = client(tmp.dir, { fetchImpl, env: { GEMINI_API_KEY: KEY, GEMINI_MODEL: 'model-env' } });
  await b.generateImage({ prompt: 'x' });
  assert.deepEqual(urls.map((u) => u.split('/').at(-1)), ['model-a:generateContent', 'model-b:generateContent', 'model-env:generateContent']);
  await assert.rejects(a.generateImage({ prompt: 'x', model: '../../evil' }), { code: 'BAD_INPUT' });
});

test('429 and 5xx are retried with backoff; 4xx is not', async (t) => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const img = await scene();
  const waits = [];
  let n = 0;
  const fetchImpl = async () => {
    n++;
    if (n === 1) return jsonResponse(429, { error: { message: 'quota' } });
    if (n === 2) return jsonResponse(503, { error: { message: 'busy' } });
    return jsonResponse(200, geminiResponse(img));
  };
  const c = client(tmp.dir, { fetchImpl, backoffMs: 100, sleep: async (ms) => waits.push(ms) });
  const out = await c.generateImage({ prompt: 'x' });
  assert.ok(out.buffer.length);
  assert.equal(n, 3);
  assert.deepEqual(waits, [100, 200]);
  assert.equal((await c.getUsage()).count, 1, 'only the successful call is counted');

  // Always 500 → 1 try + 3 retries, then fails.
  let m = 0;
  const always500 = client(tmp.dir, { fetchImpl: async () => (m++, jsonResponse(500, {})) });
  await assert.rejects(always500.generateImage({ prompt: 'x' }), (e) => e.status === 500 && /HTTP 500/.test(e.message));
  assert.equal(m, 4);

  // 400 is final.
  let k = 0;
  const bad = client(tmp.dir, { fetchImpl: async () => (k++, jsonResponse(400, { error: { message: 'bad prompt' } })) });
  await assert.rejects(bad.generateImage({ prompt: 'x' }), { code: 'BAD_REQUEST' });
  assert.equal(k, 1);
});

test('daily cap is enforced, persisted in assets-usage.json and resets the next UTC day', async (t) => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const img = await scene();
  let calls = 0;
  const fetchImpl = async () => (calls++, jsonResponse(200, geminiResponse(img)));
  let day = '2026-09-26T10:00:00Z';
  const c = client(tmp.dir, { fetchImpl, dailyCap: 2, now: () => new Date(day) });
  await c.generateImage({ prompt: 'x' });
  await c.generateImage({ prompt: 'x' });
  await assert.rejects(c.generateImage({ prompt: 'x' }), { code: 'DAILY_CAP' });
  assert.equal(calls, 2, 'no request is sent once the cap is reached');
  const usage = JSON.parse(await readFile(path.join(tmp.dir, 'assets-usage.json'), 'utf8'));
  assert.equal(usage.date, '2026-09-26');
  assert.equal(usage.count, 2);
  // A fresh client (server restart) sees the persisted count.
  const c2 = client(tmp.dir, { fetchImpl, dailyCap: 2, now: () => new Date(day) });
  assert.deepEqual(await c2.getUsage(), { date: '2026-09-26', count: 2, cap: 2, remaining: 0 });
  day = '2026-09-27T00:00:01Z';
  await c2.generateImage({ prompt: 'x' });
  assert.equal((await c2.getUsage()).count, 1);
  // env ASSET_DAILY_CAP wins over the option.
  const c3 = createGeminiClient({ dataDir: tmp.dir, env: { GEMINI_API_KEY: KEY, ASSET_DAILY_CAP: '7' }, dailyCap: 2 });
  assert.equal(c3.cap, 7);
});

test('at most 2 requests run concurrently', async (t) => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const img = await scene();
  let active = 0;
  let peak = 0;
  const fetchImpl = async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 15));
    active--;
    return jsonResponse(200, geminiResponse(img));
  };
  const c = client(tmp.dir, { fetchImpl });
  await Promise.all(Array.from({ length: 6 }, () => c.generateImage({ prompt: 'x' })));
  assert.equal(peak, 2);
  const run = createLimiter(1);
  const order = [];
  await Promise.all([1, 2, 3].map((i) => run(async () => order.push(i))));
  assert.deepEqual(order, [1, 2, 3]);
});

test('key: env first, then secrets.json (mode 0600); never leaks via errors or logs', async (t) => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const logs = [];
  const fetchImpl = async () =>
    jsonResponse(503, { error: { message: `API key ${KEY} is overloaded; other AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` } });
  const c = createGeminiClient({ dataDir: tmp.dir, env: {}, fetchImpl, sleep: noSleep, log: (m) => logs.push(m) });
  assert.equal(await c.hasKey(), false);
  await assert.rejects(c.generateImage({ prompt: 'x' }), { code: 'NO_KEY' });
  await assert.rejects(c.setKey('short'), { code: 'BAD_INPUT' });
  await c.setKey(KEY);
  assert.equal(await c.hasKey(), true);
  assert.equal(await c.keySource(), 'file');
  const file = path.join(tmp.dir, 'secrets.json');
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).geminiApiKey, KEY);

  const err = await c.generateImage({ prompt: 'x' }).catch((e) => e);
  assert.ok(err instanceof Error);
  assert.ok(!err.message.includes(KEY), 'key scrubbed from error');
  assert.doesNotMatch(err.message, /AIza/);
  assert.ok(logs.length >= 1, 'retries are logged');
  assert.ok(!logs.join('\n').includes(KEY));
  // Nothing the client exposes carries the key.
  const exposed = JSON.stringify({ usage: await c.getUsage(), model: c.model, cap: c.cap, stats: c.stats() });
  assert.ok(!exposed.includes(KEY));

  const envClient = createGeminiClient({ dataDir: tmp.dir, env: { GEMINI_API_KEY: 'AIzaEnvKey_zzzzzzzzzzzzzzzzzzzzzz' } });
  assert.equal(await envClient.keySource(), 'env');
  await c.clearKey();
  assert.equal(await c.hasKey(), false);
});

test('a 200 without an image part is an error (and still counted)', async (t) => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const fetchImpl = async () => jsonResponse(200, { candidates: [{ content: { parts: [{ text: 'I cannot draw that' }] }, finishReason: 'SAFETY' }] });
  const c = client(tmp.dir, { fetchImpl });
  await assert.rejects(c.generateImage({ prompt: 'x' }), (e) => e.code === 'NO_IMAGE' && /SAFETY/.test(e.message));
  assert.equal((await c.getUsage()).count, 1);
  await assert.rejects(c.generateImage({ prompt: '  ' }), { code: 'BAD_INPUT' });
});
