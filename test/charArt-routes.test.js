// AI character art routes (Stage 5.5-D): auth, lobby-only, feature flag, SSE progress, static files,
// edit/delete lifecycle, admin force. Fake Gemini only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { startServer } from '../server/index.js';
import { MSG, artKey } from '../server/assets/charArt.js';
import { getAvatars } from '../server/data/index.js';
import { fakeGeminiFetch, jsonResponse, magentaCharacter, tempManifest } from './assetFixtures.js';
import { httpCall, sseReader, tempDir } from './helpers.js';

const KEY = 'AIzaSyROUTES_CHARART_KEY_0123456789ab';
const D = getAvatars().default;
const AV = { ...D, hair: 'curly', hairColor: 'red' };
const ANCHOR = path.join(import.meta.dirname, 'fixtures', 'anchor.jpg');
const ctl = { mode: 'ok', delayMs: 0 };
const ok = fakeGeminiFetch();
const fetchImpl = async (u, i) => {
  if (ctl.delayMs) await new Promise((r) => setTimeout(r, ctl.delayMs));
  if (ctl.mode === '402') return jsonResponse(402, { error: { message: 'credits' } });
  return ok(u, i);
};
const texts = []; // every response body, checked for the key at the end
const logs = [];
let srv; // with a key
let off; // without a key
let tmp;
let A;
let B;
let cookie;
let roomId;
let code;

const call = async (s, method, p, opts) => {
  const r = await httpCall(s.url, method, p, opts);
  texts.push(r.text);
  return r;
};

async function boot(name, env) {
  const manifestPath = await tempManifest(path.join(tmp.dir, `${name}-m`), ['style-anchor']);
  return startServer({
    port: 0,
    host: '127.0.0.1',
    dataDir: path.join(tmp.dir, name),
    adminPassword: 'pw',
    debounceMs: 5,
    log: (m) => logs.push(String(m)),
    charArtFake: '',
    assets: {
      studioOptions: { manifestPath, outputDir: path.join(tmp.dir, `${name}-gen`), fetchImpl, env },
      charArtOptions: { styleAnchorPath: ANCHOR, composeRef: () => magentaCharacter({ w: 120, h: 180, x: 30, top: 20, bodyW: 60, bodyH: 140 }) },
      charArtThrottleMs: 0,
    },
  });
}

async function waitArt(s, token, charId, pred, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    const { json } = await call(s, 'GET', `/api/rooms/${roomId}`, { token });
    const c = json.characters.find((x) => x.id === charId);
    if (pred(c?.art, c)) return c;
    if (Date.now() > end) throw new Error(`art not reached: ${JSON.stringify(c?.art)}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

before(async () => {
  tmp = await tempDir();
  srv = await boot('on', { GEMINI_API_KEY: KEY });
  off = await boot('off', {});
  A = (await call(srv, 'POST', '/api/session')).json.token;
  B = (await call(srv, 'POST', '/api/session')).json.token;
  const login = await call(srv, 'POST', '/admin/api/login', { body: { password: 'pw' } });
  cookie = login.headers.get('set-cookie').split(';')[0];
  const room = await call(srv, 'POST', '/admin/api/rooms', { body: {}, cookie });
  roomId = room.json.room.id;
  code = room.json.room.code;
  await call(srv, 'POST', '/api/rooms/join', { token: A, body: { code, name: '에이' } });
  await call(srv, 'POST', '/api/rooms/join', { token: B, body: { code, name: '비' } });
});

after(async () => {
  await srv?.close();
  await off?.close();
  await tmp?.cleanup();
});

test('meta.features.charArt reflects the server key; without a key the route is 409', async () => {
  assert.equal((await call(srv, 'GET', '/api/meta')).json.features.charArt, true);
  assert.equal((await call(off, 'GET', '/api/meta')).json.features.charArt, false);
  const t = (await call(off, 'POST', '/api/session')).json.token;
  const lg = await call(off, 'POST', '/admin/api/login', { body: { password: 'pw' } });
  const ck = lg.headers.get('set-cookie').split(';')[0];
  const room = (await call(off, 'POST', '/admin/api/rooms', { body: {}, cookie: ck })).json.room;
  await call(off, 'POST', '/api/rooms/join', { token: t, body: { code: room.code, name: '씨' } });
  const c = await call(off, 'POST', `/api/rooms/${room.id}/characters`, { token: t, body: { name: '무키', avatar: D } });
  const r = await call(off, 'POST', `/api/rooms/${room.id}/characters/${c.json.characterId}/art`, { token: t });
  assert.equal(r.status, 409);
  assert.equal(r.json.error, 'AI 일러스트 기능이 꺼져 있어요');
});

test('owner-only; SSE progress 0→11/11 then ready; files served; 1 per character; admin force; edit/restore', async () => {
  const c1 = (await call(srv, 'POST', `/api/rooms/${roomId}/characters`, { token: A, body: { name: '곱슬', avatar: AV } })).json.characterId;
  const url = `/api/rooms/${roomId}/characters/${c1}/art`;
  assert.equal((await call(srv, 'POST', url, { token: B })).status, 403, 'not the owner');
  assert.equal((await call(srv, 'POST', `/api/rooms/${roomId}/characters/c999/art`, { token: A })).status, 404);

  const ac = new AbortController();
  const es = await fetch(`${srv.url}/api/rooms/${roomId}/events?token=${B}`, { signal: ac.signal });
  const until = sseReader(es.body);
  await until((f) => f.event === 'state');

  const r = await call(srv, 'POST', url, { token: A });
  assert.equal(r.status, 202);
  assert.deepEqual(r.json.art, { key: artKey(AV), status: 'pending', progress: 0 });
  assert.equal(r.json.room.characters.find((c) => c.id === c1).art.status, 'pending');
  const again = await call(srv, 'POST', url, { token: A });
  assert.equal(again.status, 409, 'already generating');

  // lightweight charArt events for everyone in the room + state snapshots carrying the art
  const progress = [];
  let ready;
  let art;
  while (!ready || art?.status !== 'ready') {
    const f = await until((x) => x.event === 'charArt' || x.event === 'state', 8000);
    if (f.event === 'state') {
      art = f.data.characters.find((c) => c.id === c1)?.art;
      continue;
    }
    assert.equal(f.data.charId, c1);
    if (f.data.status === 'ready') ready = f.data;
    else {
      assert.equal(f.data.status, 'pending');
      progress.push(f.data.progress);
    }
  }
  assert.equal(progress[0], 0);
  assert.equal(progress.at(-1), 1);
  assert.equal(progress.length, 12);
  for (let i = 1; i < progress.length; i++) assert.ok(progress[i] > progress[i - 1]);
  assert.equal(ready.progress, 1);
  const key = artKey(AV);
  assert.equal(art.key, key);
  assert.equal(art.progress, 1);
  assert.equal(art.files.base, `/api/char-art/${key}/base.webp`);
  assert.equal(art.files.poses.jump, `/api/char-art/${key}/pose-jump.webp`);
  assert.equal(art.files.expressions.angry, `/api/char-art/${key}/expr-angry.webp`);
  ac.abort();

  const img = await fetch(srv.url + art.files.poses.cheer);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/webp');
  assert.match(img.headers.get('cache-control'), /max-age=\d{6,}/);
  assert.equal(Buffer.from(await img.arrayBuffer()).toString('ascii', 8, 12), 'WEBP');

  // a changed look drops the art; the player's one generation is used up
  const e1 = await call(srv, 'PATCH', `/api/rooms/${roomId}/characters/${c1}`, { token: A, body: { avatar: { ...AV, hair: 'afro' } } });
  assert.equal(e1.json.room.characters.find((c) => c.id === c1).art, undefined);
  const again2 = await call(srv, 'POST', url, { token: A });
  assert.equal(again2.status, 409);
  assert.match(again2.json.error, /한 번만/);
  // back to the generated look → ready instantly from the cache (no calls)
  const calls = ok.calls.length;
  const e2 = await call(srv, 'PATCH', `/api/rooms/${roomId}/characters/${c1}`, { token: A, body: { avatar: AV } });
  assert.equal(e2.json.room.characters.find((c) => c.id === c1).art.status, 'ready');
  // another character with the same look (any room) reuses the set
  const c2 = (await call(srv, 'POST', `/api/rooms/${roomId}/characters`, { token: B, body: { name: '쌍둥이', avatar: AV } })).json;
  assert.equal(c2.room.characters.find((c) => c.id === c2.characterId).art.status, 'ready');
  assert.equal(ok.calls.length, calls);

  // admin: auth required; force regenerates (cache-busting ?v=1 URLs)
  assert.equal((await call(srv, 'POST', `/admin/api/rooms/${roomId}/characters/${c1}/art?force=1`)).status, 401);
  const f = await call(srv, 'POST', `/admin/api/rooms/${roomId}/characters/${c1}/art?force=1`, { cookie });
  assert.equal(f.status, 202);
  const done = await waitArt(srv, A, c1, (a) => a?.status === 'ready' && a.files.base.endsWith('?v=1'), 8000);
  assert.equal(done.art.progress, 1);
  assert.equal(ok.calls.length, calls + 11);
});

test('402 → failed with the Korean credits reason; delete cancels a running job', async () => {
  const c3 = (await call(srv, 'POST', `/api/rooms/${roomId}/characters`, { token: A, body: { name: '크레딧', avatar: { ...D, hair: 'bun' } } })).json.characterId;
  ctl.mode = '402';
  const r = await call(srv, 'POST', `/api/rooms/${roomId}/characters/${c3}/art`, { token: A });
  assert.equal(r.status, 202);
  const c = await waitArt(srv, A, c3, (a) => a?.status === 'failed');
  assert.equal(c.art.reason, MSG.credits);
  assert.equal(c.art.reason, 'AI 생성 크레딧이 부족합니다. 관리자에게 문의하세요.');
  assert.ok(!c.artGenerations, 'a failed job does not use up the generation');

  // slow fake: start, then delete the character → the job stops after its current step
  ctl.mode = 'ok';
  ctl.delayMs = 60;
  const before = ok.calls.length;
  const r2 = await call(srv, 'POST', `/api/rooms/${roomId}/characters/${c3}/art`, { token: A });
  assert.equal(r2.status, 202, 'retry after a failure is allowed');
  await new Promise((res) => setTimeout(res, 90));
  const del = await call(srv, 'DELETE', `/api/rooms/${roomId}/characters/${c3}`, { token: A });
  assert.equal(del.status, 200);
  await new Promise((res) => setTimeout(res, 400));
  const made = ok.calls.length - before;
  assert.ok(made >= 1 && made <= 4, `stopped early (${made} calls)`);
  ctl.delayMs = 0;
});

test('lobby only; strict file validation (traversal → 400/404); the key never leaks', async () => {
  const cA = (await call(srv, 'GET', `/api/rooms/${roomId}`, { token: A })).json.characters.find((c) => c.isMe).id;
  const start = await call(srv, 'POST', `/admin/api/rooms/${roomId}/start`, { cookie });
  assert.equal(start.status, 200, start.text);
  const r = await call(srv, 'POST', `/api/rooms/${roomId}/characters/${cA}/art`, { token: A });
  assert.equal(r.status, 409);
  assert.match(r.json.error, /로비/);

  const key = artKey(AV);
  for (const [p, codes] of [
    [`/api/char-art/${key}/index.json`, [400]],
    [`/api/char-art/${key}/..%2Findex.json`, [400]],
    [`/api/char-art/${key}/..%2F..%2Fsecrets.webp`, [400]],
    [`/api/char-art/..%2F..%2Fsaves/base.webp`, [400]],
    [`/api/char-art/%2e%2e/base.webp`, [400]],
    [`/api/char-art/${key.toUpperCase()}/base.webp`, [400]],
    [`/api/char-art/abc/base.webp`, [400]],
    [`/api/char-art/${key}/BASE.webp`, [400]],
    [`/api/char-art/${'0'.repeat(24)}/base.webp`, [404]],
    [`/api/char-art/${key}/nope.webp`, [404]],
    [`/api/char-art/${key}/../../secrets.json`, [400, 404]],
  ]) {
    const res = await fetch(srv.url + p);
    assert.ok(codes.includes(res.status), `${p} → ${res.status}`);
    texts.push(await res.text());
  }
  const all = texts.join('\n') + logs.join('\n');
  assert.ok(!all.includes(KEY), 'key never in responses or logs');
});
