// AI character art (Stage 5.5-D, LEGACY since CH-1): prompt builder, cache key, error handling, view / runner
// lifecycle. The full image jobs (11 steps at 1024×1536, resume after 402, paper-doll reference composition) are
// slow pixel work and live in test/legacy/charArt-pipeline.test.js (`npm run test:legacy`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  ART_STEPS,
  ART_TOTAL,
  MSG,
  artFiles,
  artKey,
  buildArtPrompt,
  buildEditPrompt,
  classifyError,
  createCharArtService,
  describeAvatar,
} from '../server/assets/charArt.js';
import { createGeminiClient } from '../server/assets/gemini.js';
import { getAvatars } from '../server/data/index.js';
import { updateCharacter } from '../server/game/lobby.js';
import { viewFor } from '../server/game/view.js';
import { RoomStore } from '../server/store/roomStore.js';
import { CharArtRunner } from '../server/store/charArtRunner.js';
import { jsonResponse, magentaCharacter } from './assetFixtures.js';
import { makeRoom, tempDir } from './helpers.js';

const KEY = 'AIzaSyCHARART_TEST_KEY_0123456789abcd';
const avatars = getAvatars();
const D = avatars.default;
// CH-1: lobby looks are roster characters + props (the legacy art service is keyed by any avatar JSON)
const LOOK = { character: 'chiikawa', props: {} };
const LOOK_B = { character: 'hachiware', props: { neck: 'scarf' } };
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
  assert.equal(artFiles(k, 2).poses.idle, `/api/char-art/${k}/pose-idle.webp?v=2`, 'admin force busts caches');
});

test('error classification: 402/401/403/no key/daily cap stop the job with Korean reasons', () => {
  assert.deepEqual(classifyError({ status: 402 }), { reason: MSG.credits, fatal: true });
  assert.equal(classifyError({ status: 401 }).fatal, true);
  assert.equal(classifyError({ status: 403 }).reason, MSG.badKey);
  assert.equal(classifyError({ code: 'NO_KEY' }).reason, 'AI 일러스트 기능이 꺼져 있어요');
  assert.equal(classifyError({ code: 'DAILY_CAP' }).fatal, true);
  const other = classifyError({ status: 500, message: `boom ${KEY}` });
  assert.equal(other.fatal, false);
  assert.ok(!other.reason.includes(KEY));
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
    characters: [{ id: 'c1', seq: 1, name: '철수', avatar: { ...LOOK }, ownerSessionId: 'S1', art }],
  });
  for (const s of ['S1', 'S2', null]) {
    const c = viewFor(room, s).characters[0];
    assert.deepEqual(c.art, { key: art.key, status: 'ready', progress: 1, files: art.files });
  }
  const renamed = updateCharacter(room, 'S1', 'c1', { name: '영희', avatar: { ...LOOK } });
  assert.ok(renamed.ok);
  assert.equal(renamed.room.characters[0].art.status, 'ready');
  const edited = updateCharacter(room, 'S1', 'c1', { avatar: { ...LOOK, character: 'shisa' } });
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
    const key = artKey(LOOK);
    room.players.push({ id: 'p1', sessionId: 'S1', name: 'A' });
    room.characters.push({ id: 'c1', seq: 1, name: '철수', avatar: { ...LOOK }, ownerSessionId: 'S1', art: { key, status: 'pending', progress: 3 / 11 } });
    const stub = {
      keyFor: artKey,
      cached: (k) => (k === artKey(LOOK_B) ? { files: artFiles(k), rev: 0 } : null),
      hasKey: async () => true,
    };
    const runner = new CharArtRunner(store, stub, { throttleMs: 0 });
    runner.restore();
    const c = store.getRoom(room.id).characters[0];
    assert.equal(c.art.status, 'failed');
    assert.equal(c.art.reason, '서버 재시작');
    // edit to a cached look → ready; edit to an unknown look → cleared
    const r1 = updateCharacter(store.getRoom(room.id), 'S1', 'c1', { avatar: LOOK_B });
    runner.syncCharacter(r1.room, 'c1');
    assert.equal(r1.room.characters[0].art.status, 'ready');
    assert.equal(r1.room.characters[0].art.files.base, `/api/char-art/${artKey(LOOK_B)}/base.webp`);
    const r2 = updateCharacter(r1.room, 'S1', 'c1', { avatar: { character: 'shisa', props: {} } });
    runner.syncCharacter(r2.room, 'c1');
    assert.equal(r2.room.characters[0].art, undefined);
    runner.stop();
    await store.close();
  } finally {
    await tmp.cleanup();
  }
});
