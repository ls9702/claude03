// LEGACY (Stage 5.5-D AI character art, off since CH-1 / no Gemini key): the full generation jobs through the real
// image pipeline — 11 chroma-keyed 1024×1536 WebPs per job, resume after a 402, and the paper-doll reference
// composition of real part layers. Slow pixel work → opt-in suite: `npm run test:legacy` (not part of `npm test`).
// The cheap contracts of the same module (prompts, cache key, errors, view / runner) stay in test/charArt.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { ART_STEPS, MSG, artFiles, artKey, composeReference, createCharArtService, partLookup } from '../../server/assets/charArt.js';
import { createGeminiClient } from '../../server/assets/gemini.js';
import { getAvatars } from '../../server/data/index.js';
import { fakeGeminiFetch, jsonResponse, magentaCharacter, raw } from '../assetFixtures.js';
import { tempDir } from '../helpers.js';

const KEY = 'AIzaSyCHARART_TEST_KEY_0123456789abcd';
const avatars = getAvatars();
const D = avatars.default;
const ANCHOR = path.join(import.meta.dirname, '..', 'fixtures', 'anchor.jpg');

function service(dir, fetchImpl, extra = {}) {
  const logs = [];
  const client = createGeminiClient({ dataDir: dir, fetchImpl, env: { GEMINI_API_KEY: KEY }, backoffMs: 0, sleep: async () => {} });
  const svc = createCharArtService({
    dataDir: dir,
    client,
    avatars,
    styleAnchorPath: ANCHOR,
    composeRef: () => magentaCharacter({ w: 120, h: 180, x: 30, top: 20, bodyW: 60, bodyH: 140 }),
    log: (m) => logs.push(m),
    ...extra,
  });
  return { svc, logs, client };
}

/** Fake that fails with `status` on the given call numbers (1-based), else behaves like fakeGeminiFetch. */
function failingFetch(failOn, status = 402) {
  const ok = fakeGeminiFetch();
  let n = 0;
  const f = async (url, init) => {
    n++;
    if (failOn(n)) return jsonResponse(status, { error: { message: `fail ${status}` } });
    return ok(url, init);
  };
  f.count = () => n;
  return f;
}

test('paper-doll reference composition of the exact avatar', async () => {
  const lookup = await partLookup();
  const png = await composeReference({ ...D, hair: 'afro', hairColor: 'pink' }, { lookup, avatars, scale: 0.25 });
  assert.ok(png, 'composed');
  const r = await raw(png);
  assert.equal(r.w, 212);
  let nonWhite = 0;
  for (let i = 0; i < r.data.length; i += 4) if (r.data[i] < 230 || r.data[i + 1] < 230) nonWhite++;
  assert.ok(nonWhite > 1000, 'figure drawn');
  assert.equal(await composeReference(D, { lookup: () => null, avatars }), null, 'no layers → null');
});


test('job: 11 steps (one retried) → 11 transparent 1024×1536 WebPs + index; progress 1..11; cache reuse makes zero calls', async () => {
  const tmp = await tempDir();
  try {
    const fetchImpl = fakeGeminiFetch();
    let first = true;
    const flaky = async (u, i) => {
      if (!first) return fetchImpl(u, i);
      first = false; // one "no image" answer: the step is retried
      return jsonResponse(200, { candidates: [{ content: { parts: [{ text: 'sorry' }] }, finishReason: 'OTHER' }] });
    };
    const { svc, client } = service(tmp.dir, flaky);
    const av = { ...D, hair: 'bob' };
    const seen = [];
    const h = svc.generate(av, { onProgress: (p) => seen.push(p.done) });
    assert.equal(h.cached, false);
    const res = await h.promise;
    assert.equal(fetchImpl.calls.length, 11);
    assert.deepEqual(seen, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    assert.equal(fetchImpl.calls[0].refs, 2, 'base: style anchor + composed reference');
    assert.match(fetchImpl.calls[0].prompt, /match the reference character's design exactly/);
    for (const c of fetchImpl.calls.slice(1)) assert.equal(c.refs, 1, 'edits: the base only');
    assert.deepEqual(res.files, artFiles(artKey(av)));
    const dir = path.join(tmp.dir, 'char-art', h.key);
    const files = (await readdir(dir)).sort();
    assert.deepEqual(files, [...ART_STEPS.map((s) => `${s.name}.webp`), 'index.json'].sort());
    const idx = JSON.parse(await readFile(path.join(dir, 'index.json'), 'utf8'));
    assert.equal(idx.complete, true);
    assert.deepEqual(idx.avatar, av);
    const base = await raw(await readFile(path.join(dir, 'base.webp')));
    assert.equal((await sharp(path.join(dir, 'base.webp')).metadata()).format, 'webp');
    assert.equal(base.w, 1024);
    assert.equal(base.h, 1536);
    assert.equal(base.alphaAt(5, 5), 0, 'transparent backdrop');
    // same placement as the schoolgirl set: feet on y 1303, figure top 371
    const col = (img, y) => [...Array(img.w).keys()].some((x) => img.alphaAt(x, y) > 8);
    assert.ok(col(base, 1303) && !col(base, 1310) && col(base, 371) && !col(base, 365));
    const jump = await raw(await readFile(path.join(dir, 'pose-jump.webp')));
    assert.ok(col(jump, 1303) && !col(jump, 1310), 'poses share the baseline');
    // cached: instant, no calls, across "rooms"
    assert.ok(svc.cached(h.key));
    const again = svc.generate({ ...av }, { onProgress: () => assert.fail('no progress for cache hits') });
    assert.equal(again.cached, true);
    assert.deepEqual((await again.promise).files, res.files);
    assert.equal(fetchImpl.calls.length, 11);
    assert.equal((await client.getUsage()).count, 12, 'shares the daily usage counter (a 200 without image is billed)');
  } finally {
    await tmp.cleanup();
  }
});


test('402 stops immediately with the Korean credits message; a later job resumes the finished steps', async () => {
  const tmp = await tempDir();
  try {
    // calls 1-2 (base, first pose) ok, call 3 → 402: no retry, no further steps, the job fails
    const f402 = failingFetch((n) => n >= 3);
    const { svc, logs } = service(tmp.dir, f402, { editConcurrency: 1 });
    const h = svc.generate(D);
    await assert.rejects(h.promise, (e) => e.reasonKo === MSG.credits && e.fatal === true);
    assert.equal(f402.count(), 3, 'no retries after 402');
    assert.equal(svc.cached(h.key), null);
    assert.ok(!logs.join('\n').includes(KEY));
    // credits back later: the job resumes — the finished base/pose are not generated again
    const again = failingFetch((n) => n >= 2);
    const { svc: svc2 } = service(tmp.dir, again, { editConcurrency: 1 });
    const seen = [];
    await assert.rejects(svc2.generate(D, { onProgress: (p) => seen.push(p.step) }).promise);
    assert.deepEqual(seen, ['base', 'pose-idle', 'pose-wave'], 'resumed steps reported, then one new step');
    assert.equal(again.count(), 2);
  } finally {
    await tmp.cleanup();
  }
});
