// Stage 7 — manual asset import (scripts/import-assets.js): Gemini-app images from an inbox folder go through the
// item's postprocess with watermark handling, get accepted, and leave the inbox. Temp manifest/output/inbox only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { importAssets } from '../scripts/import-assets.js';
import { getItem, loadManifest } from '../server/assets/manifest.js';
import { chromaKey, clearCornerIslands, whiteToAlpha } from '../server/assets/postprocess.js';
import { addWatermark, cleanEdgeBand, loadWatermarkTemplate, predictWatermark, removeWatermarkDetailed, watermarkAlpha } from '../server/assets/watermark.js';
import { BACKDROP, magentaCharacter, raw, scene, tempManifest, whiteIcon } from './assetFixtures.js';
import { tempDir } from './helpers.js';

const exists = (p) => stat(p).then(() => true, () => false);

/** A light-gray sparkle "watermark" in the bottom-right corner of an image. */
async function withSparkle(buffer) {
  const { width: w, height: h } = await sharp(buffer).metadata();
  const s = Math.max(6, Math.round(Math.min(w, h) * 0.05));
  const cx = w - Math.round(s * 1.2);
  const cy = h - Math.round(s * 1.2);
  const star = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><path d="M${cx} ${cy - s} L${cx + s / 4} ${cy - s / 4} L${cx + s} ${cy} L${cx + s / 4} ${cy + s / 4} L${cx} ${cy + s} L${cx - s / 4} ${cy + s / 4} L${cx - s} ${cy} L${cx - s / 4} ${cy - s / 4} Z" fill="rgb(120,120,130)"/></svg>`;
  return sharp(buffer).composite([{ input: Buffer.from(star) }]).png().toBuffer();
}

async function setup(ids) {
  const t = await tempDir();
  const manifestPath = await tempManifest(path.join(t.dir, 'm'), ids);
  const outputDir = path.join(t.dir, 'out');
  const inbox = path.join(t.dir, 'inbox');
  await mkdir(inbox, { recursive: true });
  const run = (opts = {}) => importAssets({ dir: inbox, manifestPath, outputDir, dataDir: path.join(t.dir, 'data'), log: () => {}, ...opts });
  return { ...t, manifestPath, outputDir, inbox, run };
}

test('import: card / bg / mc files are processed, accepted, written and removed from the inbox', async () => {
  const s = await setup(['style-anchor', 'bg-stage', 'card-study', 'mc-hoya-neutral']);
  try {
    await writeFile(path.join(s.inbox, 'card-study.png'), await withSparkle(await whiteIcon({ size: 160 })));
    // a Gemini-app background: not exactly 16:9, small (chat delivers ~1024 px), webp
    await writeFile(path.join(s.inbox, 'bg-stage.webp'), await sharp(await scene({ w: 640, h: 380 })).webp().toBuffer());
    await writeFile(path.join(s.inbox, 'mc-hoya-neutral.jpg'), await sharp(await magentaCharacter({ w: 300, h: 300, x: 110, top: 40 })).jpeg({ quality: 95 }).toBuffer());
    await writeFile(path.join(s.inbox, 'README.md'), 'not an image');
    const { results, failed } = await s.run();
    assert.equal(failed, 0, JSON.stringify(results));
    assert.deepEqual(results.map((r) => r.id).sort(), ['bg-stage', 'card-study', 'mc-hoya-neutral']);
    const m = await loadManifest(s.manifestPath);
    for (const id of ['bg-stage', 'card-study', 'mc-hoya-neutral']) {
      const item = getItem(m, id);
      assert.equal(item.status, 'accepted', id);
      assert.equal(item.accepted.source, 'upload');
      assert.ok(await exists(path.join(s.outputDir, item.output)), `${id} written`);
    }
    // inbox emptied (except non-images)
    assert.equal(await exists(path.join(s.inbox, 'card-study.png')), false);
    assert.equal(await exists(path.join(s.inbox, 'bg-stage.webp')), false);
    assert.equal(await exists(path.join(s.inbox, 'README.md')), true);
    // bg: cover-cropped to exactly 1920×1080 (upscaled, opaque, note about the small source)
    const bg = await sharp(path.join(s.outputDir, 'bg/stage.webp')).metadata();
    assert.deepEqual([bg.width, bg.height], [1920, 1080]);
    assert.ok(results.find((r) => r.id === 'bg-stage').warnings.some((w) => /작아서/.test(w)));
    // card: 256×256, transparent share reported, the corner sparkle is gone
    const card = results.find((r) => r.id === 'card-study');
    assert.ok(card.transparent > 0.2 && card.transparent < 0.97, String(card.transparent));
    const cr = await raw(await readFile(path.join(s.outputDir, 'cards/study.png')));
    assert.deepEqual([cr.w, cr.h], [256, 256]);
    // mc: keyed, square
    const mc = await sharp(path.join(s.outputDir, 'mc/hoya/neutral.png')).metadata();
    assert.deepEqual([mc.width, mc.height], [1024, 1024]);
  } finally {
    await s.cleanup();
  }
});

test('import: unknown ids and parts are skipped (kept in the inbox, reported as failures); dry run writes nothing', async () => {
  const s = await setup(['style-anchor', 'part-mannequin-girl-normal', 'card-lotto']);
  try {
    await writeFile(path.join(s.inbox, 'nope-not-an-id.png'), await whiteIcon());
    await writeFile(path.join(s.inbox, 'part-mannequin-girl-normal.png'), await magentaCharacter());
    await writeFile(path.join(s.inbox, 'card-lotto.png'), await whiteIcon());
    const dry = await s.run({ dryRun: true });
    assert.equal(dry.failed, 2);
    assert.equal(getItem(await loadManifest(s.manifestPath), 'card-lotto').status, 'todo');
    assert.equal(await exists(path.join(s.inbox, 'card-lotto.png')), true);
    const r = await s.run({ only: ['card-lotto', 'nope-not-an-id', 'part-mannequin-girl-normal'], keep: true });
    assert.equal(r.failed, 2);
    const byId = Object.fromEntries(r.results.map((x) => [x.id, x]));
    assert.equal(byId['nope-not-an-id'].skipped, true);
    assert.match(byId['part-mannequin-girl-normal'].error, /파츠/);
    assert.equal(byId['card-lotto'].ok, true);
    assert.equal(await exists(path.join(s.inbox, 'card-lotto.png')), true, '--keep leaves the source');
    assert.equal(await exists(path.join(s.inbox, 'part-mannequin-girl-normal.png')), true);
    assert.equal(getItem(await loadManifest(s.manifestPath), 'card-lotto').status, 'accepted');
  } finally {
    await s.cleanup();
  }
});

test('watermark keying: 3-corner backdrop sample + the isolated bottom-right sparkle is cleared (default keeps it)', async () => {
  const icon = await withSparkle(await whiteIcon({ size: 200 }));
  const corner = async (buf) => {
    const r = await raw(buf);
    let n = 0;
    for (let y = Math.floor(r.h * 0.84); y < r.h; y++) for (let x = Math.floor(r.w * 0.84); x < r.w; x++) if (r.alphaAt(x, y) > 0) n++;
    return n;
  };
  assert.ok((await corner(await whiteToAlpha(icon))) > 0, 'default whiteToAlpha keeps the sparkle');
  assert.equal(await corner(await whiteToAlpha(icon, { watermark: true })), 0);
  const ch = await withSparkle(await magentaCharacter({ w: 300, h: 300, x: 100, top: 40 }));
  assert.ok((await corner(await chromaKey(ch))) > 0);
  assert.equal(await corner(await chromaKey(ch, { watermark: true })), 0);
  // a subject reaching into the corner survives
  const data = new Uint8ClampedArray(100 * 100 * 4);
  for (let y = 40; y < 100; y++) for (let x = 40; x < 100; x++) data[(y * 100 + x) * 4 + 3] = 255;
  assert.equal(clearCornerIslands(data, 100, 100), 0);
  assert.equal(BACKDROP.r, 213);
});

/** A textured opaque scene: sky gradient, a band and dark line art crossing the bottom-right corner. */
function linedScene(w, h) {
  const lines = [0.78, 0.8, 0.86, 0.9].map((f, i) => `<path d="M0 ${h * (f - 0.25)} Q ${w * 0.6} ${h * (f - 0.1)} ${w} ${h * f}" stroke="${i % 2 ? '#2a2440' : '#7d7fd0'}" stroke-width="${i % 2 ? 2 : 9}" fill="none"/>`);
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9fb8ff"/><stop offset="1" stop-color="#f6e7e0"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>${lines.join('')}</svg>`)).png().toBuffer();
}

test('watermark: a synthetic Gemini sparkle is found near the predicted spot and un-blended; clean images are untouched', async () => {
  for (const [w, h, dx, dy] of [[640, 360, 0, 0], [512, 512, 2, -1]]) {
    const clean = await linedScene(w, h);
    const marked = await addWatermark(clean, { dx, dy });
    const p = predictWatermark(w, h);
    const r = await removeWatermarkDetailed(marked);
    assert.ok(r.found, `${w}×${h} found`);
    assert.ok(Math.abs(r.found.cx - (p.cx + dx)) <= 1 && Math.abs(r.found.cy - (p.cy + dy)) <= 1, JSON.stringify(r.found));
    const [a, b, m] = await Promise.all([raw(clean), raw(r.buffer), raw(marked)]);
    let err = 0;
    let before = 0;
    let n = 0;
    let worst = 0;
    const R = Math.ceil(40 * p.s);
    for (let y = Math.round(p.cy) - R; y < Math.round(p.cy) + R; y++) {
      for (let x = Math.round(p.cx) - R; x < Math.round(p.cx) + R; x++) {
        for (let c = 0; c < 3; c++) {
          const i = (y * w + x) * 4 + c;
          const d = Math.abs(a.data[i] - b.data[i]);
          err += d;
          before += Math.abs(a.data[i] - m.data[i]);
          worst = Math.max(worst, d);
          n++;
        }
      }
    }
    assert.ok(before / n > 1, `the synthetic mark is visible (${(before / n).toFixed(2)})`);
    assert.ok(err / n < 1 && err < before * 0.3 && worst <= 40, `${w}×${h}: mean ${(err / n).toFixed(2)} (was ${(before / n).toFixed(2)}), worst ${worst}`);
    // no watermark → no-op (same pixels)
    const none = await removeWatermarkDetailed(clean);
    assert.equal(none.found, null);
    assert.deepEqual((await raw(none.buffer)).data, a.data);
  }
});

test('watermark edge cleanup: a faint ring on the outline goes, a line crossing it survives', async () => {
  const t = await loadWatermarkTemplate();
  const w = 96;
  const h = 96;
  const found = { s: 1, cx: 48, cy: 48 };
  const alpha = watermarkAlpha(t, found, 0, 0, w, h);
  const base = (x, y) => (Math.abs(x - y) <= 1 ? [30, 26, 46] : [63, 120, 184]); // blue floor + a dark diagonal line
  const out = Buffer.alloc(w * h * 3);
  let ring = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const px = base(x, y);
      // the compression ring: pixels where the alpha changes get ±9 levels
      const a = alpha[y * w + x];
      const edge = Math.abs((alpha[y * w + Math.min(w - 1, x + 1)] ?? a) - a) + Math.abs((alpha[Math.min(h - 1, y + 1) * w + x] ?? a) - a) > 0.05;
      const bump = edge && px[0] > 50 ? ((x + y) % 2 ? 9 : -9) : 0;
      if (bump) ring++;
      for (let c = 0; c < 3; c++) out[i + c] = px[c] + bump;
    }
  }
  assert.ok(ring > 40);
  cleanEdgeBand(out, w, h, 3, alpha, { x: 0, y: 0, w, h }, found.s);
  let err = 0;
  let lineErr = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = base(x, y);
      const d = Math.max(...[0, 1, 2].map((c) => Math.abs(out[(y * w + x) * 3 + c] - px[c])));
      if (px[0] < 50) lineErr = Math.max(lineErr, d);
      else err += d;
    }
  }
  assert.ok(err / ring < 2, `ring left: ${(err / ring).toFixed(2)} per ring pixel (was 9)`);
  assert.ok(lineErr <= 4, `line kept (max change ${lineErr})`);
});
