// LEGACY (Stage 5.5-B paper-doll layers, human avatars — unused since CH-1): pixel extraction (diffExtract with
// re-registration, magenta keying, front / back hair split, erase / hat masks) and the studio round trip that publishes
// mannequin + hair layers with a fake Gemini. Slow image work → opt-in suite: `npm run test:legacy` (not part of
// `npm test`). Schema / manifest / layerStack / tint math stay in test/assets-parts.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { MANIFEST_PATH, loadManifest } from '../../server/assets/manifest.js';
import * as pp from '../../server/assets/postprocess.js';
import { partId } from '../../server/assets/partStack.js';
import { createStudio } from '../../server/assets/studio.js';
import { buildPartItems } from '../../scripts/gen-part-manifest.js';
import { tempDir } from '../helpers.js';
import { BACKDROP, jsonResponse, geminiResponse, raw, scene } from '../assetFixtures.js';

const avatars = JSON.parse(await readFile(new URL('../../server/data/avatars.json', import.meta.url), 'utf8'));
const svg = (w, h, body, bg = 'none') =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${bg}"/>${body}</svg>`)).png().toBuffer();

/** A tiny mannequin: skin head (+ears), narrow neck, pale-cyan torso, skin legs. */
const FIG = `
  <circle cx="200" cy="150" r="70" fill="rgb(245,214,185)" stroke="rgb(40,25,20)" stroke-width="3"/>
  <circle cx="126" cy="160" r="12" fill="rgb(245,214,185)"/><circle cx="274" cy="160" r="12" fill="rgb(245,214,185)"/>
  <rect x="185" y="215" width="30" height="25" fill="rgb(245,214,185)"/>
  <rect x="140" y="240" width="120" height="150" fill="rgb(143,216,224)" stroke="rgb(40,25,20)" stroke-width="3"/>
  <rect x="150" y="390" width="35" height="140" fill="rgb(245,214,185)"/><rect x="215" y="390" width="35" height="140" fill="rgb(245,214,185)"/>`;
/** Grey "hair": a cap over the skull + a strand hanging beside the torso (outside the silhouette). */
const HAIR = `
  <path d="M128 150 A72 72 0 0 1 272 150 L272 120 L128 120 Z" fill="rgb(74,68,64)"/>
  <rect x="128" y="75" width="144" height="60" rx="30" fill="rgb(74,68,64)"/>
  <rect x="108" y="140" width="22" height="200" fill="rgb(74,68,64)"/>`;
const mannequin = (bg = 'none') => svg(400, 600, FIG, bg);
const withHair = (dx = 0, dy = 0, bg = 'none') => svg(400, 600, `<g transform="translate(${dx},${dy})">${FIG}${HAIR}</g>`, bg);

test('diffExtract keeps only what the edit added (base + background transparent)', async () => {
  const base = await mannequin();
  const { buffer, info } = await pp.diffExtractDetailed(base, await withHair(), { region: 'hair' });
  const r = await raw(buffer);
  assert.deepEqual([r.w, r.h], [400, 600], 'same canvas as the base');
  assert.equal(r.alphaAt(200, 100), 255, 'hair over the skull');
  assert.equal(r.alphaAt(118, 300), 255, 'strand beside the torso');
  assert.equal(r.alphaAt(200, 180), 0, 'face (unchanged base) transparent');
  assert.equal(r.alphaAt(200, 300), 0, 'torso transparent');
  assert.equal(r.alphaAt(20, 20), 0, 'background transparent');
  assert.equal(r.alphaAt(167, 450), 0, 'legs transparent');
  assert.deepEqual([info.shift.dx, info.shift.dy], [0, 0]);
  assert.ok(info.head.top <= 82 && info.head.bottom >= 200 && info.head.bottom <= 235, JSON.stringify(info.head));
  // The hair colour is the edited image's colour.
  const i = (100 * 400 + 200) * 4;
  assert.deepEqual([r.data[i], r.data[i + 1], r.data[i + 2]], [74, 68, 64]);
});

test('diffExtract re-registers an edit that drifted a few pixels', async () => {
  const { buffer, info } = await pp.diffExtractDetailed(await mannequin(), await withHair(3, -2), { region: 'hair' });
  assert.deepEqual([info.shift.dx, info.shift.dy], [3, -2]);
  const r = await raw(buffer);
  assert.equal(r.alphaAt(200, 100), 255);
  assert.equal(r.alphaAt(200, 300), 0, 'drifted torso outline is not mistaken for new content');
  assert.equal(r.alphaAt(140, 300), 0, 'torso edge');
});

test('diffExtract works on raw magenta renders (key: true) and small parts use their own region', async () => {
  const bg = `rgb(${BACKDROP.r},${BACKDROP.g},${BACKDROP.b})`;
  const base = await mannequin(bg);
  const eyes = await svg(400, 600, `${FIG}<circle cx="175" cy="160" r="9" fill="rgb(60,35,30)"/><circle cx="225" cy="160" r="9" fill="rgb(60,35,30)"/>`, bg);
  const r = await raw(await pp.diffExtract(base, eyes, { region: 'eyes', key: true }));
  assert.equal(r.alphaAt(175, 160), 255);
  assert.equal(r.alphaAt(225, 160), 255);
  assert.equal(r.alphaAt(200, 130), 0);
  assert.equal(r.alphaAt(5, 5), 0);
});

test('splitFrontBack: over the mannequin silhouette = front, the rest = back', async () => {
  const base = await mannequin();
  const layer = await pp.diffExtract(base, await withHair(), { region: 'hair' });
  const { front, back, info } = await pp.splitFrontBack(layer, base);
  const f = await raw(front);
  const b = await raw(back);
  assert.equal(f.alphaAt(200, 100), 255, 'hair on the skull is in front');
  assert.equal(b.alphaAt(200, 100), 255, 'back keeps the whole hair (no seam at the silhouette)');
  assert.equal(f.alphaAt(115, 300), 0, 'strand beside the torso is behind');
  assert.equal(b.alphaAt(115, 300), 255);
  assert.ok(info.front > 0 && info.back > 0);
  // Back = the whole layer; front ⊆ back.
  const l = await raw(layer);
  for (let p = 3; p < l.data.length; p += 4) {
    assert.equal(b.data[p], l.data[p]);
    if (f.data[p]) assert.ok(l.data[p]);
  }
});

test('hair edits that hide the ears produce an erase mask; outfits split headwear into a hat layer', async () => {
  const base = await mannequin();
  // Hair drawn over the ear area with the ear itself gone (transparent) where the hair is narrower.
  const noEars = await svg(400, 600, FIG.replace(/<circle cx="126"[^>]*\/><circle cx="274"[^>]*\/>/, '') + HAIR);
  const r = await pp.diffExtractDetailed(base, noEars, { region: 'hair', erase: true });
  assert.ok(r.erase, 'erase mask produced');
  const e = await raw(r.erase);
  assert.equal(e.alphaAt(278, 160), 255, 'right ear erased');
  assert.equal(e.alphaAt(200, 300), 0, 'torso never erased');

  const hatLayer = await svg(400, 600, '<rect x="140" y="40" width="120" height="60" fill="rgb(250,250,250)"/><rect x="140" y="250" width="120" height="120" fill="rgb(200,200,200)"/>');
  const split = await pp.splitHat(hatLayer, base, { minPixels: 100 });
  const hat = await raw(split.hat);
  const rest = await raw(split.rest);
  assert.equal(hat.alphaAt(200, 60), 255);
  assert.equal(hat.alphaAt(200, 300), 0);
  assert.equal(rest.alphaAt(200, 60), 0);
  assert.equal(rest.alphaAt(200, 300), 255);
});

test('studio: mannequin + hair part round trip (fake Gemini) publishes base / front / back files', async (t) => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dataDir = path.join(tmp.dir, 'data');
  const outputDir = path.join(tmp.dir, 'generated');
  const manifestPath = path.join(tmp.dir, 'manifest.json');
  const shipped = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  const anchor = { ...shipped.items.find((i) => i.id === 'style-anchor'), status: 'todo' };
  delete anchor.accepted;
  // Same definitions as shipped, on a smaller canvas to keep the suite fast.
  const items = buildPartItems(avatars)
    .filter((i) => [partId.mannequin('girl', 'normal'), partId.hair('long')].includes(i.id))
    .map((i) => ({ ...i, size: { w: 400, h: 600 }, postprocess: i.postprocess.map((st) => (st.startsWith('resize:') ? 'resize:400x600' : st)) }));
  await (await import('node:fs/promises')).writeFile(manifestPath, JSON.stringify({ version: 1, settings: {}, items: [anchor, ...items] }));
  const bg = `rgb(${BACKDROP.r},${BACKDROP.g},${BACKDROP.b})`;
  const calls = [];
  const fetchImpl = async (url, init) => {
    const prompt = JSON.parse(init.body).contents[0].parts.find((p) => p.text).text;
    calls.push(prompt);
    const img = /ONLY add hair/.test(prompt) ? await withHair(0, 0, bg) : await mannequin(bg);
    return jsonResponse(200, geminiResponse(img));
  };
  const studio = createStudio({ dataDir, manifestPath, outputDir, fetchImpl, env: { GEMINI_API_KEY: 'AIzaSyTESTKEY_parts_0123456789abcdef' } });
  await studio.upload('style-anchor', await scene());
  await assert.rejects(studio.generateCandidates(partId.hair('long'), { count: 1 }), { code: 'REF_MISSING' });

  const mq = await studio.generateCandidates(partId.mannequin('girl', 'normal'), { count: 1 });
  assert.deepEqual(mq.candidates[0].layers, ['base']);
  const accM = await studio.accept(partId.mannequin('girl', 'normal'), 1);
  assert.deepEqual(Object.keys(accM.accepted.files).sort(), ['base', 'main']);
  const mBase = await raw(await readFile(path.join(outputDir, accM.accepted.files.base)));
  const mMain = await raw(await readFile(path.join(outputDir, accM.accepted.files.main)));
  // base keeps the pale-cyan underwear; the display copy recolours it dark.
  const px = (r, x, y) => {
    const i = (y * r.w + x) * 4;
    return [r.data[i], r.data[i + 1], r.data[i + 2]];
  };
  assert.ok(px(mBase, 200, 300)[2] > 180, 'base torso is cyan');
  assert.ok(px(mMain, 200, 300)[2] < 120, 'display torso is dark');
  assert.match((await loadManifest(manifestPath)).items.find((i) => i.id === partId.mannequin('girl', 'normal')).meta.tintRef, /^#[0-9a-f]{6}$/);

  const r = await studio.generateCandidates(partId.hair('long'), { count: 1 });
  assert.ok(r.candidates[0].layers.includes('front') && r.candidates[0].layers.includes('back'));
  const acc = await studio.accept(partId.hair('long'), 1);
  const files = acc.accepted.files;
  assert.equal(files.main, 'parts/hair/long.webp');
  assert.equal(files.front, 'parts/hair/long-front.webp');
  assert.equal(files.back, 'parts/hair/long-back.webp');
  assert.equal(files.src, undefined, 'src is only published for items marked meta.src');
  for (const f of Object.values(files)) assert.ok((await stat(path.join(outputDir, f))).size > 0, f);
  const front = await raw(await readFile(path.join(outputDir, files.front)));
  const back = await raw(await readFile(path.join(outputDir, files.back)));
  assert.equal(front.alphaAt(200, 100), 255, 'front hair on the skull');
  assert.equal(back.alphaAt(115, 300), 255, 'back strand');
  const saved = (await loadManifest(manifestPath)).items.find((i) => i.id === partId.hair('long'));
  assert.match(saved.meta.tintRef, /^#[0-9a-f]{6}$/);
  // The hair edit was sent with the mannequin's keyed base as the only reference.
  assert.match(calls.at(-1), /ONLY add hair/);

  const idx = await studio.publicIndex();
  const entry = idx.assets[partId.hair('long')];
  assert.match(entry.files.front, /^\/assets\/generated\/parts\/hair\/long-front\.webp\?v=\d+$/);
  assert.ok(entry.files.back && !('base' in entry.files) && !('src' in entry.files));
  assert.equal(entry.meta.slot, 'hair');
  assert.equal(idx.assets[partId.mannequin('girl', 'normal')].files, undefined, 'generation-only base file is not exposed');
  // Reprocessing (no API call) keeps the published layers.
  const before = calls.length;
  await studio.reprocess(partId.hair('long'), 1);
  assert.equal(calls.length, before);
  assert.ok((await stat(path.join(outputDir, files.front))).size > 0);
});
