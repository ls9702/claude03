import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { loadManifest } from '../server/assets/manifest.js';
import { createStudio } from '../server/assets/studio.js';
import { run as runCli, parseArgs } from '../scripts/gen-assets.js';
import { tempDir } from './helpers.js';
import { fakeGeminiFetch, scene, tempManifest, whiteIcon } from './assetFixtures.js';

const IDS = ['style-anchor', 'char-schoolgirl-base', 'pose-schoolgirl-jump', 'sprite-schoolgirl-jump', 'icon-money', 'tex-grass'];
const KEY = 'AIzaSyTESTKEY_studio_0123456789abcdef';

async function setup(t) {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dataDir = path.join(tmp.dir, 'data');
  const outputDir = path.join(tmp.dir, 'generated');
  const manifestPath = await tempManifest(path.join(tmp.dir, 'm'), IDS);
  const fetchImpl = fakeGeminiFetch();
  const studio = createStudio({ dataDir, manifestPath, outputDir, fetchImpl, env: { GEMINI_API_KEY: KEY } });
  return { tmp, dataDir, outputDir, manifestPath, fetchImpl, studio };
}
const exists = (p) => stat(p).then(() => true, () => false);

test('generate → candidates on disk (+ previews) → accept publishes file and updates the manifest', async (t) => {
  const { dataDir, outputDir, manifestPath, fetchImpl, studio } = await setup(t);
  const progress = [];
  const r = await studio.generateCandidates('style-anchor', { count: 2, onProgress: (p) => progress.push(p) });
  assert.deepEqual(r.candidates.map((c) => c.n), [1, 2]);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(progress.at(-1), { done: 2, total: 2 });
  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(fetchImpl.calls[0].refs, 0, 'the anchor has no refs');
  assert.equal(fetchImpl.calls[0].body.generationConfig.imageConfig.aspectRatio, '16:9');
  const dir = path.join(dataDir, 'asset-candidates', 'style-anchor');
  const files = (await readdir(dir)).sort();
  assert.deepEqual(files, ['1.json', '1.png', '1.preview.webp', '2.json', '2.png', '2.preview.webp']);
  assert.equal((await sharp(path.join(dir, '1.preview.webp')).metadata()).format, 'webp');
  assert.equal((await loadManifest(manifestPath)).items.find((i) => i.id === 'style-anchor').status, 'candidate');
  assert.equal(await studio.candidateFile('style-anchor', 1, 'preview'), path.join(dir, '1.preview.webp'));
  await assert.rejects(studio.candidateFile('style-anchor', 9), { status: 404 });
  await assert.rejects(studio.candidateFile('style-anchor', '../x'), { status: 400 });

  const item = await studio.accept('style-anchor', 2);
  assert.equal(item.status, 'accepted');
  assert.match(item.url, /^\/assets\/generated\/anchor\/style-anchor\.png\?v=\d+$/);
  const published = path.join(outputDir, 'anchor', 'style-anchor.png');
  assert.deepEqual(await readFile(published), await readFile(path.join(dir, '2.png')));
  const saved = (await loadManifest(manifestPath)).items.find((i) => i.id === 'style-anchor');
  assert.equal(saved.status, 'accepted');
  assert.equal(saved.accepted.file, 'anchor/style-anchor.png');
  assert.equal(saved.accepted.model, 'gemini-2.5-flash-image');
  assert.equal(saved.accepted.candidate, 2);
  assert.match(saved.accepted.promptUsed, /Korean anime-inspired/);
  assert.ok(saved.accepted.generatedAt);

  // Accepted items are never regenerated unless forced.
  await assert.rejects(studio.generateCandidates('style-anchor'), { code: 'ACCEPTED', status: 409 });
  const again = await studio.regenerate('style-anchor', { count: 1 });
  assert.deepEqual(again.candidates.map((c) => c.n), [3], 'numbering continues');
  assert.equal((await loadManifest(manifestPath)).items.find((i) => i.id === 'style-anchor').status, 'accepted');
});

test('refs must be accepted first, then resolve to the accepted files', async (t) => {
  const { fetchImpl, studio, manifestPath } = await setup(t);
  await assert.rejects(studio.generateCandidates('char-schoolgirl-base', { count: 1 }), (e) => e.code === 'REF_MISSING' && e.status === 409 && /style-anchor/.test(e.message));
  assert.equal(fetchImpl.calls.length, 0);
  await studio.upload('style-anchor', await scene());
  const r = await studio.generateCandidates('char-schoolgirl-base', { count: 1 });
  assert.equal(r.candidates.length, 1);
  assert.equal(fetchImpl.calls.at(-1).refs, 1, 'anchor attached as reference image');
  assert.equal(fetchImpl.calls.at(-1).body.generationConfig.imageConfig.aspectRatio, '2:3');
  // Candidate was chroma-keyed and resized to the layer canvas.
  const f = await studio.candidateFile('char-schoolgirl-base', 1);
  const m = await sharp(f).metadata();
  assert.deepEqual([m.width, m.height, m.hasAlpha], [1024, 1536, true]);
  const { data } = await sharp(f).raw().toBuffer({ resolveWithObject: true });
  assert.equal(data[3], 0, 'corner transparent');

  // Prompt override is used for this run only.
  await studio.generateCandidates('char-schoolgirl-base', { count: 1, prompt: '{{style}} {{magentaBg}} custom override prompt' });
  assert.match(fetchImpl.calls.at(-1).prompt, /custom override prompt/);
  assert.match(fetchImpl.calls.at(-1).prompt, /modern Korean anime/);
  await assert.rejects(studio.generateCandidates('char-schoolgirl-base', { prompt: 'short' }), { status: 400 });
  const listed = (await studio.listItems()).items.find((i) => i.id === 'char-schoolgirl-base');
  assert.equal(listed.candidateCount, 2);
  assert.ok(!listed.prompt.includes('custom override'), 'manifest prompt unchanged');
  await assert.rejects(studio.generateCandidates('nope'), { status: 404 });
  assert.equal((await loadManifest(manifestPath)).items.find((i) => i.id === 'char-schoolgirl-base').status, 'candidate');
});

test('sprite: per-frame generation → normalized sheet + json + animated WebP on accept', async (t) => {
  const { outputDir, fetchImpl, studio } = await setup(t);
  await studio.upload('style-anchor', await scene());
  await studio.generateCandidates('char-schoolgirl-base', { count: 1 });
  await studio.accept('char-schoolgirl-base', 1);
  const before = fetchImpl.calls.length;
  const r = await studio.generateCandidates('sprite-schoolgirl-jump', { count: 1 });
  assert.equal(fetchImpl.calls.length - before, 4, 'one call per frame');
  const c = r.candidates[0];
  assert.equal(c.sheet.count, 4);
  assert.deepEqual(c.sheet.frameIds, ['crouch', 'up', 'peak', 'land']);
  assert.equal(c.anim, true);
  await studio.accept('sprite-schoolgirl-jump', c.n);
  const sheetMeta = JSON.parse(await readFile(path.join(outputDir, 'sprites', 'schoolgirl-jump.json'), 'utf8'));
  assert.equal(sheetMeta.count, 4);
  assert.equal(sheetMeta.frameWidth, 256);
  assert.equal(sheetMeta.image, 'schoolgirl-jump.png');
  assert.deepEqual(sheetMeta.delays, [140, 110, 160, 140]);
  const anim = await sharp(path.join(outputDir, 'sprites', 'schoolgirl-jump.anim.webp'), { animated: true }).metadata();
  assert.ok(anim.pages >= 2);
  await assert.rejects(studio.upload('sprite-schoolgirl-jump', await scene()), { status: 400 });

  // Key pose aligned to the accepted base layer.
  const pose = await studio.generateCandidates('pose-schoolgirl-jump', { count: 1 });
  assert.equal(pose.candidates[0].width, 1024);

  const idx = await studio.publicIndex();
  assert.equal(idx.assets['sprite-schoolgirl-jump'].kind, 'sprite');
  assert.match(idx.assets['sprite-schoolgirl-jump'].sheet, /schoolgirl-jump\.json/);
  assert.match(idx.assets['sprite-schoolgirl-jump'].anim, /schoolgirl-jump\.anim\.webp/);
  assert.equal(idx.assets['char-schoolgirl-base'].meta.character, 'schoolgirl');
});

test('upload replaces an asset (optionally post-processed) and deleteCandidates resets status', async (t) => {
  const { outputDir, studio, manifestPath } = await setup(t);
  await studio.upload('style-anchor', await scene());
  const up = await studio.upload('icon-money', await whiteIcon({ size: 300 }), { process: true });
  assert.equal(up.status, 'accepted');
  assert.equal(up.accepted.source, 'upload');
  const out = path.join(outputDir, 'icons', 'money.png');
  const m = await sharp(out).metadata();
  assert.deepEqual([m.width, m.height, m.hasAlpha], [256, 256, true]);
  await assert.rejects(studio.upload('icon-money', Buffer.from('not an image')), { status: 400 });

  await studio.generateCandidates('tex-grass', { count: 1 });
  const cands = await studio.listCandidates('tex-grass');
  assert.equal(typeof cands[0].notes.seamless.seamless, 'boolean');
  await studio.deleteCandidates('tex-grass');
  assert.deepEqual(await studio.listCandidates('tex-grass'), []);
  assert.equal((await loadManifest(manifestPath)).items.find((i) => i.id === 'tex-grass').status, 'todo');
  // .webp outputs are encoded as WebP.
  await studio.upload('tex-grass', await scene({ w: 64, h: 64 }));
  assert.equal((await sharp(path.join(outputDir, 'textures', 'grass.webp')).metadata()).format, 'webp');

  const idx = await studio.publicIndex();
  assert.deepEqual(Object.keys(idx.assets).sort(), ['icon-money', 'style-anchor', 'tex-grass']);
  assert.deepEqual(Object.keys(idx.assets['icon-money']).sort(), ['height', 'kind', 'meta', 'url', 'width']);
  assert.equal(idx.assets['icon-money'].meta.tile, 'money');
  assert.ok(!(await exists(path.join(outputDir, 'bg'))));
});

test('gen-assets CLI: parseArgs, dry run, --accept-first, failure exit code', async (t) => {
  assert.deepEqual(parseArgs(['--only', 'a,b', '--accept-first']).only, ['a', 'b']);
  assert.equal(parseArgs(['--kind=bg']).kind, 'bg');
  assert.throws(() => parseArgs(['--kind', 'movie']));
  assert.throws(() => parseArgs(['--bogus']));

  const { fetchImpl, studio, outputDir, manifestPath } = await setup(t);
  const out = [];
  const err = [];
  const io = { studio, out: (m) => out.push(m), err: (m) => err.push(m) };
  assert.equal(await runCli([], io), 2);
  assert.equal(await runCli(['--bogus'], io), 2);
  assert.equal(await runCli(['--all', '--dry-run'], io), 0);
  assert.equal(fetchImpl.calls.length, 0, 'dry run makes no API calls');
  assert.match(out.join('\n'), /예상 API 호출/);

  assert.equal(await runCli(['--only', 'char-schoolgirl-base', '--accept-first'], io), 1, 'missing ref → failure');
  assert.match(err.join('\n'), /채택되지 않았습니다/);

  assert.equal(await runCli(['--only', 'style-anchor', '--accept-first'], io), 0);
  assert.equal(fetchImpl.calls.length, 1, '--accept-first generates a single candidate');
  assert.ok(await exists(path.join(outputDir, 'anchor', 'style-anchor.png')));
  assert.equal((await loadManifest(manifestPath)).items.find((i) => i.id === 'style-anchor').status, 'accepted');
  // Accepted → skipped without --force.
  assert.equal(await runCli(['--only', 'style-anchor', '--accept-first'], io), 0);
  assert.equal(fetchImpl.calls.length, 1);
  assert.ok(!out.join('\n').includes(KEY) && !err.join('\n').includes(KEY));
});
