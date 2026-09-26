import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import * as pp from '../server/assets/postprocess.js';
import { BACKDROP, magentaCharacter, raw, scene, whiteIcon } from './assetFixtures.js';

const fixture = (name) => readFile(new URL(`./fixtures/${name}`, import.meta.url));

/** Opaque pixels whose colour is still in the backdrop's hue family (leftover magenta). */
function magentaLeft({ data, w, h }) {
  let n = 0;
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (data[i + 3] < 200) continue;
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    if (r > 120 && b > 80 && g < 0.45 * Math.min(r, b)) n++;
  }
  return n;
}

test('chromaKey removes an off-magenta backdrop, its ground shadow and stray specks', async () => {
  const src = await magentaCharacter({ w: 200, h: 300, x: 60, top: 60, bodyW: 80, bodyH: 190 });
  const keyed = await pp.chromaKey(src);
  const k = await raw(keyed);
  assert.deepEqual([k.w, k.h], [200, 300], 'canvas kept (layers stay aligned)');
  for (const [x, y] of [[0, 0], [199, 0], [0, 299], [199, 299]]) assert.equal(k.alphaAt(x, y), 0, `corner ${x},${y}`);
  assert.equal(k.alphaAt(100, 200), 255, 'body opaque');
  assert.equal(k.alphaAt(100, 84), 255, 'head opaque');
  assert.equal(k.alphaAt(100 - 50, 256), 0, 'ground shadow keyed out (hue kill)');
  assert.equal(k.alphaAt(8, 150), 0, 'stray speck removed (small component)');
  assert.equal(k.alphaAt(189, 12), 0, 'stray speck removed (small component)');
  assert.equal(magentaLeft(k), 0);
  const bg = pp.sampleBackground((await raw(src)).data, 200, 300);
  assert.deepEqual(bg, BACKDROP);

  const trimmed = await pp.chromaKey(src, { trim: true });
  const t = await sharp(trimmed).metadata();
  assert.ok(t.width < 200 && t.height < 300, `trimmed smaller (${t.width}x${t.height})`);
  assert.ok(Math.abs(t.width - 80) <= 2 && Math.abs(t.height - 190) <= 3, `bbox matches subject (${t.width}x${t.height})`);
});

test('chromaKey on a real generated character (fixture)', async () => {
  const src = await fixture('char-magenta.png');
  const k = await raw(await pp.chromaKey(src));
  for (const [x, y] of [[0, 0], [k.w - 1, 0], [0, k.h - 1], [k.w - 1, k.h - 1]]) assert.equal(k.alphaAt(x, y), 0);
  const box = pp.alphaBBox(k.data, k.w, k.h);
  assert.ok(box.width < k.w && box.height < k.h);
  assert.equal(k.alphaAt(Math.round(box.left + box.width / 2), Math.round(box.top + box.height * 0.6)), 255, 'subject opaque');
  let opaque = 0;
  for (let p = 0; p < k.w * k.h; p++) if (k.data[p * 4 + 3] > 200) opaque++;
  const frac = opaque / (k.w * k.h);
  assert.ok(frac > 0.15 && frac < 0.6, `opaque fraction ${frac}`);
  assert.ok(magentaLeft(k) < opaque * 0.002, 'no magenta left on the subject / ground');
  const trimmed = await sharp(await pp.trim(await pp.chromaKey(src))).metadata();
  assert.ok(trimmed.width < k.w && trimmed.height < k.h);
});

test('whiteToAlpha clears the outer white but keeps enclosed white areas', async () => {
  const k = await raw(await pp.whiteToAlpha(await whiteIcon({ size: 128 })));
  assert.equal(k.alphaAt(0, 0), 0);
  assert.equal(k.alphaAt(10, 64), 0, 'outside the card');
  assert.equal(k.alphaAt(40, 30), 255, 'white card face inside the outline stays');
  assert.equal(k.alphaAt(64, 64), 255, 'red heart');
  assert.equal(k.alphaAt(30, 64), 255, 'outline');
});

test('trim and resize', async () => {
  const keyed = await pp.chromaKey(await magentaCharacter());
  const t = await sharp(await pp.trim(keyed)).metadata();
  assert.ok(t.width < 200);
  const r = await sharp(await pp.resize(keyed, 100, 100)).metadata();
  assert.deepEqual([r.width, r.height, r.hasAlpha], [100, 100, true]);
  const opaque = await sharp(await pp.resize(await scene({ w: 320, h: 180 }), 64, 64)).metadata();
  assert.deepEqual([opaque.width, opaque.height], [64, 64]);
  // An opaque image trims by colour and still returns a PNG.
  assert.equal((await sharp(await pp.trim(await scene())).metadata()).format, 'png');
});

test('normalizeFrames aligns baselines, centres and bbox heights', async () => {
  const frames = await Promise.all(
    [
      { x: 60, top: 60, bodyH: 190 },
      { x: 30, top: 20, bodyH: 150 },
      { x: 90, top: 70, bodyH: 210 },
    ].map((o) => magentaCharacter({ w: 200, h: 300, ...o }).then((b) => pp.chromaKey(b))),
  );
  const out = await pp.normalizeFrames(frames, { anchor: 'bottom-center' });
  assert.equal(out.length, 3);
  const boxes = [];
  for (const b of out) {
    const r = await raw(b);
    assert.deepEqual([r.w, r.h], [200, 300]);
    boxes.push(pp.alphaBBox(r.data, r.w, r.h));
  }
  const b0 = boxes[0];
  for (const b of boxes) {
    assert.ok(Math.abs(b.bottom - b0.bottom) <= 1, `baseline ${b.bottom} vs ${b0.bottom}`);
    assert.ok(Math.abs(b.height - b0.height) <= 2, `height ${b.height} vs ${b0.height}`);
    assert.ok(Math.abs(b.left + b.width / 2 - (b0.left + b0.width / 2)) <= 1.5, 'centre');
  }
  await assert.rejects(pp.normalizeFrames(frames, { anchor: 'top-left' }));
  assert.deepEqual(await pp.normalizeFrames([]), []);
});

test('normalizeFrames on the real jump frames keeps a common baseline', async () => {
  const keyed = await Promise.all(['01', '02', '03', '04'].map(async (n) => pp.chromaKey(await fixture(`jump-${n}.png`))));
  const out = await pp.normalizeFrames(keyed);
  const bottoms = [];
  for (const b of out) {
    const r = await raw(b);
    bottoms.push(pp.alphaBBox(r.data, r.w, r.h).bottom);
  }
  assert.ok(Math.max(...bottoms) - Math.min(...bottoms) <= 1, `bottoms ${bottoms}`);
});

test('sheet assembles a grid and returns frame metadata', async () => {
  const f = await Promise.all([40, 60, 50].map((h) => sharp({ create: { width: 30, height: h, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer()));
  const { buffer, meta } = await pp.sheet(f, { cols: 2 });
  assert.deepEqual(
    { fw: meta.frameWidth, fh: meta.frameHeight, cols: meta.cols, rows: meta.rows, count: meta.count },
    { fw: 30, fh: 60, cols: 2, rows: 2, count: 3 },
  );
  assert.deepEqual(meta.frames[2], { x: 0, y: 60, w: 30, h: 60 });
  const m = await sharp(buffer).metadata();
  assert.deepEqual([m.width, m.height, m.format], [60, 120, 'png']);
  // Shorter frames sit on the cell's bottom edge.
  const r = await raw(buffer);
  assert.equal(r.alphaAt(5, 5), 0);
  assert.equal(r.alphaAt(5, 59), 255);
});

test('animatedWebp joins frames with per-frame delays', async () => {
  const f = await Promise.all(['red', 'blue', 'green'].map((c) => sharp({ create: { width: 40, height: 40, channels: 4, background: c } }).png().toBuffer()));
  const anim = await pp.animatedWebp(f, [100, 200, 300]);
  const m = await sharp(anim, { animated: true }).metadata();
  assert.equal(m.format, 'webp');
  assert.equal(m.pages, 3);
  assert.deepEqual(m.delay, [100, 200, 300]);
  assert.equal(m.pageHeight, 40);
});

test('isSeamless: tileable grass passes, an illustration does not', async () => {
  assert.equal((await pp.isSeamless(await fixture('grass.png'))).seamless, true);
  assert.equal((await pp.isSeamless(await fixture('anchor.jpg'))).seamless, false);
  const gradient = await scene({ w: 128, h: 128 });
  assert.equal((await pp.isSeamless(gradient)).seamless, false);
});

test('applySteps runs a sprite pipeline to sheet + animated WebP', async () => {
  // Different widths: identical frames would be merged by the WebP encoder.
  const frames = await Promise.all([0, 1, 2].map((i) => magentaCharacter({ x: 50 + i * 10, top: 50 + i * 5, bodyW: 60 + i * 20 })));
  const out = await pp.applySteps(frames, ['chromaKey', 'normalizeFrames', 'resize:64x96', 'sheet', 'webp'], { delays: [100, 120, 140] });
  assert.equal(out.frames.length, 3);
  assert.equal(out.sheet.meta.count, 3);
  assert.equal(out.sheet.meta.frameWidth, 64);
  assert.equal((await sharp(out.anim, { animated: true }).metadata()).pages, 3);
  // Single pose aligned to a reference (base layer).
  const ref = await pp.chromaKey(frames[0]);
  const pose = await pp.applySteps([frames[2]], ['chromaKey', 'normalizeFrames'], { ref });
  const [a, b] = await Promise.all([raw(ref), raw(pose.frames[0])]);
  assert.ok(Math.abs(pp.alphaBBox(a.data, a.w, a.h).bottom - pp.alphaBBox(b.data, b.w, b.h).bottom) <= 1);
  const seam = await pp.applySteps([await fixture('grass.png')], ['seamless']);
  assert.equal(seam.notes.seamless.seamless, true);
  await assert.rejects(pp.applySteps(frames, ['explode']));
});
