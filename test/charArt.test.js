// AI character art (Stage 5.5-D): prompt builder, cache key, generation job (fake Gemini), runner lifecycle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  ART_STEPS,
  ART_TOTAL,
  MSG,
  artFiles,
  artKey,
  buildArtPrompt,
  buildEditPrompt,
  composeReference,
  createCharArtService,
  describeAvatar,
  partLookup,
} from '../server/assets/charArt.js';
import { createGeminiClient } from '../server/assets/gemini.js';
import { getAvatars } from '../server/data/index.js';
import { updateCharacter } from '../server/game/lobby.js';
import { viewFor } from '../server/game/view.js';
import { RoomStore } from '../server/store/roomStore.js';
import { CharArtRunner } from '../server/store/charArtRunner.js';
import { fakeGeminiFetch, jsonResponse, magentaCharacter, raw } from './assetFixtures.js';
import { makeRoom, tempDir } from './helpers.js';

const KEY = 'AIzaSyCHARART_TEST_KEY_0123456789abcd';
const avatars = getAvatars();
const D = avatars.default;
const ANCHOR = path.join(import.meta.dirname, 'fixtures', 'anchor.jpg');

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

test('prompt builder: every category from promptDesc, style bible, reference, magenta, full body', () => {
  const av = { ...D, body: 'girl', build: 'chubby', skin: 'olive', face: 'round', eyes: 'cat', mouth: 'grin', cheek: 'freckles', hair: 'braid', hairColor: 'silver', outfit: 'hoodie', outfitColor: 'orange', accessory: 'hairpin' };
  const p = buildArtPrompt(av, avatars);
  const opt = (cat) => avatars.parts[cat].find((o) => o.id === av[cat]);
  for (const cat of avatars.order) {
    const o = opt(cat);
    assert.ok(o.promptDesc, `${cat} has a promptDesc`);
    assert.ok(p.includes(o.promptDesc), `${cat}: "${o.promptDesc}" in prompt`);
  }
  assert.ok(p.includes(opt('hairColor').color) && p.includes(opt('outfitColor').color), 'colour hexes');
  assert.match(p, /^Art style: modern Korean anime-inspired/);
  assert.match(p, /match the reference character's design exactly/);
  assert.match(p, /magenta/i);
  assert.match(p, /Full body/);
  assert.match(p, /front view/);
  assert.match(p, /feet/);
  // no reference attached → no "second reference image" wording
  assert.doesNotMatch(buildArtPrompt(av, avatars, { withReference: false }), /second reference/);
  // "none" options add nothing
  const plain = buildArtPrompt({ ...D, cheek: 'none', accessory: 'none' }, avatars);
  assert.doesNotMatch(plain, /accessory:/);
});

test('prompt builder skips the outfit colour for tintable:false outfits', () => {
  const fixed = avatars.parts.outfit.filter((o) => o.tintable === false);
  assert.ok(fixed.length >= 1);
  const orange = avatars.parts.outfitColor.find((o) => o.id === 'orange');
  for (const o of fixed) {
    const p = buildArtPrompt({ ...D, outfit: o.id, outfitColor: 'orange' }, avatars);
    assert.ok(p.includes(o.promptDesc));
    assert.ok(!p.includes(orange.color) && !/\borange\b/.test(p), `${o.id}: no outfit colour`);
    assert.match(describeAvatar({ ...D, outfit: o.id }, avatars).outfit, /standard colors/);
  }
  const tint = buildArtPrompt({ ...D, outfit: 'tshirt', outfitColor: 'orange' }, avatars);
  assert.ok(tint.includes(orange.color));
});

test('edit prompts keep the character and the magenta backdrop', () => {
  for (const step of ART_STEPS.slice(1)) {
    const p = buildEditPrompt(step);
    assert.match(p, /keep EXACTLY the same character/);
    assert.match(p, /magenta/);
    assert.match(p, step.kind === 'pose' ? /Change only the pose/ : /Change ONLY the facial expression/);
  }
  assert.equal(ART_TOTAL, 11);
});

test('cache key: stable for the same avatar (any key order), different for any part change', () => {
  const k = artKey(D);
  assert.match(k, /^[a-f0-9]{24}$/);
  const reversed = Object.fromEntries(Object.entries(D).reverse());
  assert.equal(artKey(reversed), k);
  assert.equal(artKey({ ...D }), k);
  const seen = new Set([k]);
  for (const cat of avatars.order) {
    for (const o of avatars.parts[cat]) {
      if (o.id === D[cat]) continue;
      const k2 = artKey({ ...D, [cat]: o.id });
      assert.notEqual(k2, k, `${cat}=${o.id}`);
      seen.add(k2);
    }
  }
  assert.equal(seen.size, 1 + avatars.order.reduce((n, c) => n + avatars.parts[c].length - 1, 0));
  const f = artFiles(k);
  assert.equal(f.base, `/api/char-art/${k}/base.webp`);
  assert.deepEqual(Object.keys(f.poses), ['idle', 'wave', 'jump', 'cheer', 'cry', 'shock']);
  assert.deepEqual(Object.keys(f.expressions), ['joy', 'cry', 'shock', 'angry']);
});

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

test('a failing step is retried twice, then the job fails with a Korean reason (key scrubbed)', async () => {
  const tmp = await tempDir();
  try {
    let n = 0;
    const noImage = async () => {
      n++;
      return jsonResponse(200, { candidates: [{ content: { parts: [{ text: `no image ${KEY}` }] }, finishReason: 'SAFETY' }] });
    };
    const { svc } = service(tmp.dir, noImage);
    const h = svc.generate(D);
    await assert.rejects(h.promise, (e) => /^AI 일러스트를 만들지 못했어요/.test(e.reasonKo) && !e.reasonKo.includes(KEY));
    assert.equal(n, 3, '1 try + 2 retries');
  } finally {
    await tmp.cleanup();
  }
});

test('viewFor passes art to everyone; editing the avatar resets it; name-only edits keep it', () => {
  const art = { key: 'a'.repeat(24), status: 'ready', progress: 1, files: artFiles('a'.repeat(24)), internal: 'x' };
  const room = makeRoom({
    players: [
      { id: 'p1', sessionId: 'S1', name: 'A' },
      { id: 'p2', sessionId: 'S2', name: 'B' },
    ],
    characters: [{ id: 'c1', seq: 1, name: '철수', avatar: { ...D }, ownerSessionId: 'S1', art }],
  });
  for (const s of ['S1', 'S2', null]) {
    const c = viewFor(room, s).characters[0];
    assert.deepEqual(c.art, { key: art.key, status: 'ready', progress: 1, files: art.files });
  }
  const renamed = updateCharacter(room, 'S1', 'c1', { name: '영희', avatar: { ...D } });
  assert.ok(renamed.ok);
  assert.equal(renamed.room.characters[0].art.status, 'ready');
  const edited = updateCharacter(room, 'S1', 'c1', { avatar: { ...D, hair: 'afro' } });
  assert.ok(edited.ok);
  assert.equal(edited.room.characters[0].art, undefined);
  assert.equal(room.characters[0].art.status, 'ready', 'input untouched');
});

test('runner: pending jobs become failed on restart; edits re-attach a cached set instantly', async () => {
  const tmp = await tempDir();
  try {
    const store = new RoomStore({ dataDir: tmp.dir, debounceMs: 5 });
    await store.load();
    const room = store.createRoom(makeRoom().config);
    const key = artKey(D);
    room.players.push({ id: 'p1', sessionId: 'S1', name: 'A' });
    room.characters.push({ id: 'c1', seq: 1, name: '철수', avatar: { ...D }, ownerSessionId: 'S1', art: { key, status: 'pending', progress: 3 / 11 } });
    const stub = {
      keyFor: artKey,
      cached: (k) => (k === artKey({ ...D, hair: 'bob' }) ? { files: artFiles(k), rev: 0 } : null),
      hasKey: async () => true,
    };
    const runner = new CharArtRunner(store, stub, { throttleMs: 0 });
    runner.restore();
    const c = store.getRoom(room.id).characters[0];
    assert.equal(c.art.status, 'failed');
    assert.equal(c.art.reason, '서버 재시작');
    // edit to a cached look → ready; edit to an unknown look → cleared
    const r1 = updateCharacter(store.getRoom(room.id), 'S1', 'c1', { avatar: { ...D, hair: 'bob' } });
    runner.syncCharacter(r1.room, 'c1');
    assert.equal(r1.room.characters[0].art.status, 'ready');
    assert.equal(r1.room.characters[0].art.files.base, `/api/char-art/${artKey({ ...D, hair: 'bob' })}/base.webp`);
    const r2 = updateCharacter(r1.room, 'S1', 'c1', { avatar: { ...D, hair: 'afro' } });
    runner.syncCharacter(r2.room, 'c1');
    assert.equal(r2.room.characters[0].art, undefined);
    runner.stop();
    await store.close();
  } finally {
    await tmp.cleanup();
  }
});
