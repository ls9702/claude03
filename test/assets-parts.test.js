// Paper-doll layers (Stage 5.5-B): diffExtract, front/back split, tint math, part manifest schema,
// gen-part-manifest coverage/idempotency and a studio round trip with a fake Gemini.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { MANIFEST_PATH, loadManifest, outputsFor, topoOrder, validateItem, validateManifest } from '../server/assets/manifest.js';
import * as pp from '../server/assets/postprocess.js';
import { EXPRESSIONS, NO_LAYER, Z_ORDER, layerStack, partId } from '../server/assets/partStack.js';
import { hexToRgb, luma, measureFill, tintPixels } from '../server/assets/tintMath.js';
import { createStudio } from '../server/assets/studio.js';
import { LAYERED, buildPartItems, mergePartItems } from '../scripts/gen-part-manifest.js';
import { tempDir } from './helpers.js';
import { BACKDROP, jsonResponse, geminiResponse, raw, scene } from './assetFixtures.js';

const avatars = JSON.parse(await readFile(new URL('../server/data/avatars.json', import.meta.url), 'utf8'));
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

test('tintMath: neutral grey → target colour, luminance ratio kept, lines stay dark, alpha untouched', () => {
  const ref = '#c8c8c8';
  const px = new Uint8ClampedArray([200, 200, 200, 255, 40, 40, 40, 255, 240, 240, 240, 128, 0, 0, 0, 0]);
  tintPixels(px, ref, '#4f8ee0');
  assert.deepEqual([...px.slice(0, 4)], [79, 142, 224, 255], 'reference grey becomes exactly the target');
  assert.ok(luma(px[4], px[5], px[6]) < 35, 'line art stays dark');
  assert.ok(px[6] > px[4], 'dark pixel keeps the target hue');
  assert.ok(luma(px[8], px[9], px[10]) > luma(79, 142, 224), 'highlight stays brighter than the fill');
  assert.equal(px[11], 128, 'alpha unchanged');
  assert.deepEqual([...px.slice(12)], [0, 0, 0, 0], 'transparent pixels untouched');
  // Clipping highlight on a light target keeps its luminance by blending toward white.
  const hi = new Uint8ClampedArray([255, 255, 255, 255]);
  tintPixels(hi, ref, '#f2cf4a');
  assert.ok(Math.abs(luma(hi[0], hi[1], hi[2]) - Math.min(255, luma(242, 207, 74) * (255 / 200))) < 3);
  // Dark hair reference tinted blonde.
  const hair = new Uint8ClampedArray([74, 68, 64, 255]);
  tintPixels(hair, '#4a4440', '#e8c15a');
  assert.deepEqual([...hair.slice(0, 3)], [232, 193, 90]);
});

test('tintMath selective mode only recolours pixels near the reference hue (skin), not the cyan underwear', () => {
  const skinRef = '#f6d8bc';
  const px = new Uint8ClampedArray([246, 216, 188, 255, 143, 216, 224, 255, 120, 120, 120, 255]);
  tintPixels(px, skinRef, '#a86f4c', { mode: 'selective' });
  assert.deepEqual([...px.slice(0, 3)], [168, 111, 76], 'skin → deep skin');
  assert.deepEqual([...px.slice(4, 7)], [143, 216, 224], 'underwear untouched');
  assert.deepEqual([...px.slice(8, 11)], [120, 120, 120], 'grey untouched');
  const fill = new Uint8ClampedArray([74, 68, 64, 255, 74, 68, 64, 255, 10, 10, 10, 255, 250, 250, 250, 255, 70, 66, 60, 255]);
  assert.equal(measureFill(fill), '#4a4440');
  assert.deepEqual(hexToRgb('#abc'), { r: 170, g: 187, b: 204 });
});

const partItem = (patch = {}) => ({
  id: 'part-hair-x',
  kind: 'part',
  label: '파츠 · 머리',
  aspect: '2:3',
  prompt: '{{style}} {{keepMannequin}} ONLY add hair.',
  refs: ['part-mannequin-a'],
  output: 'parts/hair/x.webp',
  postprocess: ['chromaKey', 'resize:1024x1536', 'diffExtract:hair'],
  status: 'todo',
  meta: { category: 'hair', option: 'x', slot: 'hair', tint: 'hair', base: 'part-mannequin-a' },
  ...patch,
});
const mannequinItem = {
  id: 'part-mannequin-a',
  kind: 'part',
  label: '파츠 · 마네킹',
  aspect: '2:3',
  prompt: '{{style}} a bald mannequin on magenta',
  refs: [],
  output: 'parts/mannequin/a.webp',
  postprocess: ['chromaKey', 'resize:1024x1536', 'mannequin'],
  status: 'todo',
  meta: { category: 'body', option: 'girl', slot: 'mannequin', tint: 'skin' },
};

test('manifest schema: part kind, meta, diff base refs and outputs', () => {
  assert.deepEqual(validateItem(mannequinItem), []);
  assert.deepEqual(validateItem(partItem()), []);
  const bad = (patch) => validateItem(partItem(patch));
  assert.ok(bad({ meta: undefined }).length, 'meta required');
  assert.ok(bad({ meta: { ...partItem().meta, slot: 'tail' } }).length, 'slot enum');
  assert.ok(bad({ meta: { ...partItem().meta, tint: 'rainbow' } }).length, 'tint enum');
  assert.ok(bad({ meta: { ...partItem().meta, tintRef: 'grey' } }).length, 'tintRef hex');
  assert.ok(bad({ meta: { ...partItem().meta, base: undefined } }).length, 'diffExtract needs meta.base');
  assert.ok(bad({ postprocess: ['chromaKey', 'diffExtract:tail'] }).length, 'unknown region');
  assert.ok(bad({ postprocess: ['chromaKey', 'diffExtract:face'] }).length, 'hair needs diffExtract:hair');
  assert.ok(validateItem({ ...mannequinItem, kind: 'charLayer', output: 'char/x.png' }).length, 'mannequin step only for parts');

  assert.equal(validateManifest({ items: [mannequinItem, partItem()] }).ok, true);
  const missing = validateManifest({ items: [partItem()] });
  assert.equal(missing.ok, false);
  assert.match(missing.errors.join(), /part-mannequin-a/);
  const eyes = partItem({ id: 'part-eyes-x', output: 'parts/eyes/x.webp', postprocess: ['chromaKey', 'diffExtract:eyes'], meta: { category: 'eyes', option: 'x', slot: 'eyes', tint: null, base: 'part-mannequin-a' } });
  const onEyes = partItem({ id: 'part-acc-x', output: 'parts/accessory/x.webp', postprocess: ['diffExtract:accessory'], meta: { category: 'accessory', option: 'x', slot: 'accessory', base: 'part-eyes-x' } });
  assert.equal(validateManifest({ items: [mannequinItem, eyes, onEyes] }).ok, false, 'a base must be a mannequin or keep its src');
  assert.equal(validateManifest({ items: [mannequinItem, { ...eyes, meta: { ...eyes.meta, src: true } }, onEyes] }).ok, true);

  assert.deepEqual(outputsFor(partItem()), ['parts/hair/x.webp', 'parts/hair/x-front.webp', 'parts/hair/x-back.webp', 'parts/hair/x-erase.webp']);
  assert.deepEqual(outputsFor(mannequinItem), ['parts/mannequin/a.webp', 'parts/mannequin/a-base.webp']);
  // meta.base counts as a dependency even when it is not a ref.
  const order = topoOrder([partItem({ refs: [] }), mannequinItem]).map((i) => i.id);
  assert.deepEqual(order, ['part-mannequin-a', 'part-hair-x']);
});

test('gen-part-manifest: 1:1 coverage of avatars.json options, valid, idempotent, preserves accepted items', async () => {
  const items = buildPartItems(avatars);
  const opts = (cat) => avatars.parts[cat].map((o) => o.id).filter((id) => !(NO_LAYER[cat] ?? []).includes(id));
  const has = (pred) => items.some(pred);
  for (const cat of LAYERED) {
    for (const opt of opts(cat)) {
      if (cat === 'body' || cat === 'build') {
        assert.ok(has((i) => i.meta.slot === 'mannequin' && i.meta[cat] === opt), `mannequin for ${cat}=${opt}`);
      } else if (cat === 'outfit') {
        for (const body of opts('body')) for (const build of opts('build')) assert.ok(has((i) => i.id === partId.outfit(opt, body, build)), `${opt} ${body} ${build}`);
      } else {
        assert.ok(has((i) => i.meta.category === cat && i.meta.option === opt && i.meta.slot !== 'eyesClosed'), `${cat}=${opt}`);
      }
    }
  }
  for (const e of opts('eyes')) assert.ok(has((i) => i.id === partId.eyesClosed(e)), `closed ${e}`);
  for (const x of EXPRESSIONS) assert.ok(has((i) => i.id === partId.expression(x)));
  assert.ok(!has((i) => i.meta.option === 'none'), 'no layer for none');
  assert.ok(!has((i) => i.meta.category === 'face' && i.meta.option === 'slim'), 'slim face = mannequin');
  const count = (slot) => items.filter((i) => i.meta.slot === slot).length;
  assert.equal(count('mannequin'), opts('body').length * opts('build').length);
  assert.equal(count('outfit'), avatars.parts.outfit.length * opts('body').length * opts('build').length);
  assert.equal(count('hair'), avatars.parts.hair.length);
  // Non-tintable outfits keep natural colours; the rest are generated neutral.
  for (const o of avatars.parts.outfit) {
    const it = items.find((i) => i.id === partId.outfit(o.id, 'girl', 'normal'));
    assert.equal(it.meta.tint, o.tintable === false ? null : 'outfit', o.id);
  }
  // Every item comes after what it depends on; mannequins first.
  const order = topoOrder([{ id: 'style-anchor', refs: [] }, ...items]).map((i) => i.id);
  assert.equal(order[1], partId.mannequin('girl', 'normal'));

  const shipped = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  const nonPart = shipped.items.filter((i) => i.kind !== 'part');
  const first = mergePartItems({ ...shipped, items: nonPart }, items);
  assert.equal(validateManifest(first.manifest).ok, true, validateManifest(first.manifest).errors.join('\n'));
  assert.equal(first.added.length, items.length);
  assert.deepEqual(first.manifest.items.slice(0, nonPart.length), nonPart, 'non-part items untouched and first');
  const again = mergePartItems(first.manifest, buildPartItems(avatars));
  assert.deepEqual([again.added.length, again.updated.length, again.removed.length], [0, 0, 0], 'idempotent');
  assert.deepEqual(again.manifest, first.manifest);

  // Accepted items keep status/accepted/tintRef; stale options vanish unless accepted.
  const acc = first.manifest.items.map((i) =>
    i.id === partId.hair('bob') ? { ...i, status: 'accepted', accepted: { file: i.output, generatedAt: 'x' }, meta: { ...i.meta, tintRef: '#4a4440' } } : i,
  );
  const stale = { ...items.find((i) => i.id === partId.hair('long')), id: 'part-hair-gone', output: 'parts/hair/gone.webp' };
  const staleAcc = { ...stale, id: 'part-hair-kept', output: 'parts/hair/kept.webp', status: 'accepted', accepted: { file: 'parts/hair/kept.webp', generatedAt: 'x' } };
  const r = mergePartItems({ ...first.manifest, items: [...acc, stale, staleAcc] }, buildPartItems(avatars));
  const bob = r.manifest.items.find((i) => i.id === partId.hair('bob'));
  assert.equal(bob.status, 'accepted');
  assert.equal(bob.meta.tintRef, '#4a4440');
  assert.deepEqual(r.removed, ['part-hair-gone']);
  assert.deepEqual(r.kept, ['part-hair-kept']);
});

test('shipped manifest: part items match avatars.json and accepted layers list their files', async () => {
  const m = await loadManifest();
  const parts = m.items.filter((i) => i.kind === 'part');
  assert.equal(parts.length, buildPartItems(avatars).length);
  for (const it of parts.filter((i) => i.status === 'accepted')) {
    assert.ok(it.accepted.files?.main, it.id);
    if (it.meta.slot === 'hair') assert.ok(it.accepted.files.front && it.accepted.files.back, `${it.id} front/back`);
    if (it.meta.slot === 'mannequin') assert.ok(it.accepted.files.base, `${it.id} base`);
    if (it.meta.tint) assert.match(it.meta.tintRef ?? '', /^#[0-9a-f]{6}$/, `${it.id} tintRef`);
  }
});

test('layerStack: z-order, tints, expression/blink swaps, erase masks and outfit fallback', () => {
  const assets = {};
  const put = (id, meta, files) => (assets[id] = { url: `/${id}.webp`, meta, ...(files ? { files } : {}) });
  put(partId.mannequin('girl', 'slim'), { slot: 'mannequin', tint: 'skin', tintRef: '#f6d8bc' });
  put(partId.hair('long'), { slot: 'hair', tint: 'hair', tintRef: '#4a4440' }, { front: '/hf.webp', back: '/hb.webp', erase: '/he.webp' });
  put(partId.face('round'), { slot: 'face', tint: 'skin', tintRef: '#f6d8bc', tintMode: 'selective' });
  put(partId.outfit('chef', 'girl', 'normal'), { slot: 'outfit', tint: null }, { hat: '/hat.webp', erase: '/oe.webp' });
  put(partId.eyes('round'), { slot: 'eyes' });
  put(partId.eyesClosed('round'), { slot: 'eyesClosed' });
  put(partId.mouth('smile'), { slot: 'mouth' });
  put(partId.cheek('blush'), { slot: 'cheek' });
  put(partId.expression('joy'), { slot: 'expression' });
  put(partId.accessory('cap'), { slot: 'accessory' });
  const lookup = (id) => assets[id] ?? null;
  const av = { body: 'girl', build: 'slim', skin: 'deep', face: 'round', eyes: 'round', mouth: 'smile', cheek: 'blush', hair: 'long', hairColor: 'blonde', outfit: 'chef', outfitColor: 'red', accessory: 'cap' };
  const s = layerStack(av, { lookup, avatars });
  assert.deepEqual(s.map((l) => l.slot), ['backHair', 'mannequin', 'face', 'outfit', 'cheek', 'eyes', 'mouth', 'frontHair', 'hat', 'accessory']);
  assert.deepEqual(Z_ORDER, ['backHair', 'mannequin', 'face', 'outfit', 'cheek', 'eyes', 'mouth', 'frontHair', 'hat', 'accessory']);
  assert.equal(s[0].src, '/hb.webp');
  assert.deepEqual(s[0].tint, { channel: 'hair', color: '#e8c15a', ref: '#4a4440', mode: 'full' });
  assert.deepEqual(s[1].tint, { channel: 'skin', color: '#a86f4c', ref: '#f6d8bc', mode: 'selective' });
  assert.deepEqual(s[1].erase, ['/he.webp'], 'fallback outfit (normal build) does not erase the slim mannequin');
  assert.deepEqual(s[0].erase, ['/he.webp'], 'erase masks also cut the back hair');
  assert.equal(s[3].id, partId.outfit('chef', 'girl', 'normal'), 'missing build variant falls back to normal');
  assert.equal(s[3].tint, null, 'non-tintable outfit');
  const joy = layerStack(av, { lookup, avatars, expression: 'joy' });
  assert.ok(joy.some((l) => l.slot === 'expression') && !joy.some((l) => l.slot === 'eyes' || l.slot === 'mouth'));
  const blink = layerStack(av, { lookup, avatars, blink: true });
  assert.ok(blink.some((l) => l.slot === 'eyesClosed') && !blink.some((l) => l.slot === 'eyes'));
  const plain = layerStack({ ...av, face: 'slim', cheek: 'none', accessory: 'none' }, { lookup, avatars });
  assert.ok(!plain.some((l) => ['face', 'cheek', 'accessory'].includes(l.slot)));
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
