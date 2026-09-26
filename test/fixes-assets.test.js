// Verifier fixes (asset side): candidate path traversal, cached public index, Gemini body timeout,
// AI character art request limits (counted per request; delete/recreate, edit-cancel, failed-job bypasses).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startServer } from '../server/index.js';
import { createStudio } from '../server/assets/studio.js';
import { createGeminiClient } from '../server/assets/gemini.js';
import { artKey } from '../server/assets/charArt.js';
import { CharArtRunner, artLimits } from '../server/store/charArtRunner.js';
import { RoomStore } from '../server/store/roomStore.js';
import { addCharacter, joinRoom, removeCharacter, updateCharacter } from '../server/game/lobby.js';
import { validateRoomConfig } from '../server/game/config.js';
import { getAvatars } from '../server/data/index.js';
import { fakeGeminiFetch, scene, tempManifest } from './assetFixtures.js';
import { httpCall, tempDir } from './helpers.js';

test('studio: candidate paths reject traversal ids (unit + HTTP ..%2Foutside)', async () => {
  const tmp = await tempDir();
  try {
    const dataDir = path.join(tmp.dir, 'data');
    // a lure outside asset-candidates that a traversal would read
    await mkdir(path.join(dataDir, 'outside'), { recursive: true });
    await writeFile(path.join(dataDir, 'outside', '1.json'), JSON.stringify({ secret: 'LEAK' }));
    await writeFile(path.join(dataDir, 'outside', '1.png'), 'LEAK');
    const manifestPath = await tempManifest(path.join(tmp.dir, 'm'), ['style-anchor']);
    const studio = createStudio({ dataDir, manifestPath, outputDir: path.join(tmp.dir, 'gen'), fetchImpl: fakeGeminiFetch(), env: {} });
    for (const id of ['../outside', '..', 'a/../../outside', 'UPPER', '']) {
      await assert.rejects(studio.listCandidates(id), { status: 400 }, id);
      await assert.rejects(studio.candidateFile(id, 1), { status: 400 }, id);
    }
    await assert.rejects(studio.deleteCandidates('../outside'), { status: 404 });
    assert.deepEqual(await studio.listCandidates('style-anchor'), []);

    const srv = await startServer({ port: 0, host: '127.0.0.1', dataDir, adminPassword: 'pw', assets: { studio } });
    try {
      const login = await httpCall(srv.url, 'POST', '/admin/api/login', { body: { password: 'pw' } });
      const cookie = login.headers.get('set-cookie').split(';')[0];
      for (const p of ['/admin/api/assets/candidates/..%2Foutside', '/admin/api/assets/candidates/..%2Foutside/1', '/admin/api/assets/candidates/..%2Foutside/1?preview=1']) {
        const r = await httpCall(srv.url, 'GET', p, { cookie });
        assert.equal(r.status, 400, `${p} → ${r.status}`);
        assert.ok(!r.text.includes('LEAK'));
      }
    } finally {
      await srv.close();
    }
  } finally {
    await tmp.cleanup();
  }
});

test('studio: /api/assets index is cached and invalidated by upload/accept and external manifest edits', async () => {
  const tmp = await tempDir();
  try {
    const manifestPath = await tempManifest(path.join(tmp.dir, 'm'), ['style-anchor', 'icon-money']);
    const studio = createStudio({ dataDir: path.join(tmp.dir, 'data'), manifestPath, outputDir: path.join(tmp.dir, 'gen'), fetchImpl: fakeGeminiFetch(), env: {} });
    const a = await studio.publicIndex();
    assert.deepEqual(a.assets, {});
    assert.equal(await studio.publicIndex(), a, 'second call served from the cache');
    await studio.upload('style-anchor', await scene());
    const b = await studio.publicIndex();
    assert.notEqual(b, a);
    assert.deepEqual(Object.keys(b.assets), ['style-anchor']);
    assert.equal(await studio.publicIndex(), b);
    // a script edits the manifest while the server runs → the file stamp changes → rebuilt
    const m = JSON.parse(await readFile(manifestPath, 'utf8'));
    m.items.find((i) => i.id === 'style-anchor').label = '바뀐 라벨 (외부 수정)';
    m.items = m.items.filter((i) => i.id !== 'icon-money');
    await new Promise((r) => setTimeout(r, 15));
    await writeFile(manifestPath, JSON.stringify(m, null, 2));
    const c = await studio.publicIndex();
    assert.notEqual(c, b);
    // explicit invalidation hook
    studio.invalidateIndex();
    assert.notEqual(await studio.publicIndex(), c);
  } finally {
    await tmp.cleanup();
  }
});

test('gemini: the abort timer also covers a stalled response body', async () => {
  const tmp = await tempDir();
  try {
    const fetchImpl = async (url, init) => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"candidates": [')); // …and nothing more
          init.signal.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const c = createGeminiClient({ dataDir: tmp.dir, env: { GEMINI_API_KEY: 'AIzaSyTIMEOUT_TEST_KEY_0123456789abcd' }, fetchImpl, timeoutMs: 60, retries: 1, sleep: async () => {} });
    const t0 = Date.now();
    await assert.rejects(c.generateImage({ prompt: 'x' }), (e) => e.code === 'NETWORK' && e.retryable === true && /시간이 초과/.test(e.message));
    assert.ok(Date.now() - t0 < 2000, 'did not hang');
    assert.equal((await c.getUsage()).count, 0, 'a timed-out call is not counted as billed');
  } finally {
    await tmp.cleanup();
  }
});

// ---------- AI art request limits ----------

function fakeArtService() {
  const jobs = [];
  return {
    jobs,
    hasKey: async () => true,
    keyFor: (avatar) => artKey(avatar),
    cached: () => null,
    generate(avatar) {
      let resolve;
      let reject;
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      promise.catch(() => {});
      const job = { key: artKey(avatar), resolve, reject, detached: false };
      jobs.push(job);
      return { key: job.key, cached: false, promise, detach: () => (job.detached = true) };
    },
    filePath: () => null,
  };
}

const D = getAvatars().default;
const tick = () => new Promise((r) => setImmediate(r));

test('AI art limits: counted per request — failed, edit-cancelled and delete/recreate cannot bypass; room cap; admin force', async () => {
  assert.deepEqual(artLimits(), { perSession: 2, perCharacter: 1, perRoom: 8 });
  const tmp = await tempDir();
  const store = new RoomStore({ dataDir: tmp.dir, debounceMs: 1 });
  await store.load();
  const service = fakeArtService();
  const runner = new CharArtRunner(store, service, { throttleMs: 0, limits: { perRoom: 4 } });
  try {
    let room = store.createRoom(validateRoomConfig({}).config);
    room = joinRoom(room, 'A', '에이').room;
    room = joinRoom(room, 'B', '비').room;
    const add = (sess, name, hair) => {
      const r = addCharacter(store.getRoom(room.id), sess, { name, avatar: { ...D, hair } });
      store.put(r.room);
      return r.character.id;
    };
    store.put(room);
    const c1 = add('A', '하나', 'bob');
    const c2 = add('A', '둘', 'curly');

    // 1) a failed job still used the character's request
    assert.equal((await runner.request(room.id, c1, { sessionId: 'A' })).ok, true);
    await tick();
    service.jobs.at(-1).reject(Object.assign(new Error('boom'), { reasonKo: '실패' }));
    await runner.idle();
    assert.equal(store.getRoom(room.id).characters.find((c) => c.id === c1).art.status, 'failed');
    const retry = await runner.request(room.id, c1, { sessionId: 'A' });
    assert.deepEqual([retry.ok, retry.status], [false, 409]);
    assert.match(retry.error, /한 번만/);

    // 2) edit → the running job is cancelled, but the request stays counted on the character
    assert.equal((await runner.request(room.id, c2, { sessionId: 'A' })).ok, true);
    const edited = updateCharacter(store.getRoom(room.id), 'A', c2, { avatar: { ...D, hair: 'long' } });
    runner.syncCharacter(edited.room, c2);
    store.commit(edited.room);
    await tick();
    const again = await runner.request(room.id, c2, { sessionId: 'A' });
    assert.deepEqual([again.ok, again.status], [false, 409], 'edit-cancel does not refund');

    // 3) delete + recreate → per-session limit (2) still applies
    const del = removeCharacter(store.getRoom(room.id), 'A', c2);
    runner.cancel(room.id, c2);
    store.commit(del.room);
    const c3 = add('A', '셋', 'ponytail');
    const fresh = await runner.request(room.id, c3, { sessionId: 'A' });
    assert.deepEqual([fresh.ok, fresh.status], [false, 409]);
    assert.match(fresh.error, /한 사람당 이 방에서 2번/);
    assert.equal(store.getRoom(room.id).artRequests.A, 2);

    // 4) room cap (4 here): B uses 1 → 3 total; the admin (bypasses per-player limits) makes it 4
    const b1 = add('B', '비하나', 'bun');
    assert.equal((await runner.request(room.id, b1, { sessionId: 'B' })).ok, true);
    assert.equal((await runner.request(room.id, c3, { admin: true })).ok, true);
    assert.equal(store.getRoom(room.id).artRequestTotal, 4);
    const b2 = add('B', '비둘', 'twintail');
    const capped = await runner.request(room.id, b2, { sessionId: 'B' });
    assert.deepEqual([capped.ok, capped.status], [false, 409]);
    assert.match(capped.error, /이 방의 AI 일러스트 생성 한도\(4번\)/);
    assert.equal((await runner.request(room.id, b2, { admin: true })).ok, false, 'admin without force respects the room cap');
    assert.equal((await runner.request(room.id, b2, { admin: true, force: true })).ok, true, 'admin force overrides');
    // session tokens never leak through the view
    const { viewFor } = await import('../server/game/view.js');
    assert.ok(!JSON.stringify(viewFor(store.getRoom(room.id), 'B')).includes('"A"'));
  } finally {
    runner.stop();
    for (const j of service.jobs) j.reject(new Error('stop'));
    await store.close();
    await tmp.cleanup();
  }
});
