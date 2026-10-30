// CH-2 — Chiikawa art pipeline: delivered-file names / aliases / takes, keying, the family placement transform, arms
// (base − noarms) + pivots, face overlays, sprite sheets, props, manifest kinds, the importer end to end (characters,
// props, MC overlays) and the renderer / MC plug-ins. Tiny synthetic images only (temp dirs; nothing large in test/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { aliasCandidates, canonicalId, idRole, importRank, parseDeliveredName, pickTakes } from '../server/assets/charaIds.js';
import {
  CANVAS,
  cropToContent,
  extractArms,
  extractOverlay,
  familyFrom,
  figureStats,
  headSpan,
  keyBackdrop,
  measureAnchors,
  normalizeProp,
  normalizeSheet,
  placeOnCanvas,
  rawOf,
  shiftRaw,
  transformFor,
} from '../server/assets/charaPipeline.js';
import { MANIFEST_PATH, getItem, loadManifest, validateItem, validateManifest } from '../server/assets/manifest.js';
import { charaItems, loadRequests, unmappedRequests, upsertCharaItems } from '../scripts/gen-chara-manifest.js';
import { importAssets, parseTakeArg } from '../scripts/import-assets.js';
import { setAssetIndex } from '../public/js/assets.js';
import { charaSvg, rasterParts } from '../public/js/ui/chara.js';
import { sheetDef, spriteDuration, spriteFrame } from '../public/js/ui/rig.js';
import { mcOverlays, mcTalkMs, overlayStyle } from '../public/js/ui/mc.js';
import { tempDir } from './helpers.js';

const exists = (p) => stat(p).then(() => true, () => false);
const BG = 'rgb(250,62,244)'; // a measured-like backdrop: R 254 / G 26–65 / B 247–253, never exactly #FF00FF
const svgPng = (w, h, body, bg = BG) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${bg ? `<rect width="100%" height="100%" fill="${bg}"/>` : ''}${body}</svg>`)).png().toBuffer();
const LINE = 'stroke="#7a6868" stroke-width="3"';

/**
 * A chibi on magenta: head circle + body + two stubby arms sticking out (unless `arms: false`), dark eyes, a mouth.
 * Units scale with `s` (1 = a 224×300 portrait, figure ≈ 55 % of the height, feet at ≈ 79 %).
 */
function chibi({ w = 224, h = 300, dx = 0, dy = 0, s = 1, arms = true, eyes = 'open', tears = false, raised = false, extra = '' } = {}) {
  const cx = 112 + dx;
  const k = (v) => v * s;
  const feet = 237 + dy;
  const headCy = feet - k(108);
  const arm = (side) => {
    const ax = cx + side * k(36);
    const ay = feet - k(52);
    const rot = raised ? side * -60 : side * 25;
    return `<ellipse cx="${ax + side * k(16)}" cy="${ay}" rx="${k(17)}" ry="${k(7)}" fill="#fff" ${LINE} transform="rotate(${rot} ${ax} ${ay})"/>`;
  };
  const eye = (side) =>
    eyes === 'open'
      ? `<circle cx="${cx + side * k(15)}" cy="${headCy + k(2)}" r="${k(5)}" fill="#2a2020"/>`
      : `<path d="M${cx + side * k(15) - k(6)} ${headCy + k(2)} q${k(6)} ${k(5)} ${k(12)} 0" fill="none" stroke="#2a2020" stroke-width="3"/>`;
  return svgPng(
    w,
    h,
    `${arms ? arm(-1) + arm(1) : ''}
     <ellipse cx="${cx}" cy="${feet - k(32)}" rx="${k(34)}" ry="${k(32)}" fill="#fff" ${LINE}/>
     <rect x="${cx - k(22)}" y="${feet - k(8)}" width="${k(12)}" height="${k(8)}" rx="3" fill="#fff" ${LINE}/>
     <rect x="${cx + k(10)}" y="${feet - k(8)}" width="${k(12)}" height="${k(8)}" rx="3" fill="#fff" ${LINE}/>
     <circle cx="${cx}" cy="${headCy}" r="${k(46)}" fill="#fff" ${LINE}/>
     <circle cx="${cx - k(30)}" cy="${headCy - k(42)}" r="${k(9)}" fill="#fff" ${LINE}/>
     <circle cx="${cx + k(30)}" cy="${headCy - k(42)}" r="${k(9)}" fill="#fff" ${LINE}/>
     ${eye(-1)}${eye(1)}
     <path d="M${cx - k(6)} ${headCy + k(16)} q${k(6)} ${k(5)} ${k(12)} 0" fill="none" stroke="#5a4848" stroke-width="2"/>
     ${tears ? `<ellipse cx="${cx - k(15)}" cy="${headCy + k(22)}" rx="${k(4)}" ry="${k(8)}" fill="#7cc6ff"/><ellipse cx="${cx + k(15)}" cy="${headCy + k(22)}" rx="${k(4)}" ry="${k(8)}" fill="#7cc6ff"/>` : ''}
     ${extra}`,
  );
}

// ---------- ids / names / takes ----------

test('ids: aliases, take suffixes, originals and take selection', () => {
  const known = new Set(['ch-chiikawa-base', 'ch-chiikawa-body', 'ch-chiikawa-expr-cry', 'ch-chiikawa-sheet-jump', 'npc-penguin-base', 'npc-bear-cub-base', 'bg-park', 'prop-chef-hat', 'pet-guinea-pig-base']);
  const k = (id) => known.has(id);
  assert.equal(canonicalId('ch-chiikawa-cry', k), 'ch-chiikawa-expr-cry');
  assert.equal(canonicalId('ch-chiikawa-noarms', k), 'ch-chiikawa-body');
  assert.equal(canonicalId('ch-chiikawa-jump', k), 'ch-chiikawa-sheet-jump');
  assert.equal(canonicalId('npc-friend-penguin', k), 'npc-penguin-base');
  assert.equal(canonicalId('npc-bear_cub-base', k), 'npc-bear-cub-base');
  assert.equal(canonicalId('pet-guinea_pig', k), 'pet-guinea-pig-base');
  assert.equal(canonicalId('bg-ch-park', k), 'bg-park');
  assert.equal(canonicalId('prop-hat-chef', k), 'prop-chef-hat');
  assert.equal(canonicalId('nope', k), null);
  assert.ok(aliasCandidates('ch-usagi-shock').includes('ch-usagi-expr-shock'));
  // take suffix only splits when the remainder is a known id; `_original` = the JPEG original
  assert.deepEqual(
    (({ id, take, original, ext }) => ({ id, take, original, ext }))(parseDeliveredName('ch-chiikawa-sheet-jump-2_original.jpg', k)),
    { id: 'ch-chiikawa-sheet-jump', take: 2, original: true, ext: 'jpg' },
  );
  assert.equal(parseDeliveredName('bg-ch-park-2.png', k).id, 'bg-park');
  assert.equal(parseDeliveredName('bg-ch-park-2.png', k).take, 2);
  assert.equal(parseDeliveredName('mystery-2.png', k).id, null);
  const parsed = ['ch-chiikawa-base.png', 'ch-chiikawa-base_original.jpg', 'ch-chiikawa-base-2.png', 'bg-ch-park-2.png', 'bg-ch-park_original.jpg', 'prop-hat-chef-2.png'].map((n) => parseDeliveredName(n, k));
  const def = pickTakes(parsed);
  assert.equal(def.get('ch-chiikawa-base').entry.name, 'ch-chiikawa-base.png'); // PNG over the JPEG original, take 1
  assert.deepEqual(def.get('ch-chiikawa-base').alternatives.sort(), ['ch-chiikawa-base-2.png', 'ch-chiikawa-base_original.jpg']);
  assert.equal(def.get('bg-park').entry.name, 'bg-ch-park_original.jpg'); // take 1 exists only as the original
  assert.equal(def.get('prop-chef-hat').entry.name, 'prop-hat-chef-2.png'); // take 1 missing → take 2
  assert.equal(def.get('prop-chef-hat').fallback, true);
  const two = pickTakes(parsed, { takes: { 'bg-park': 2 } });
  assert.equal(two.get('bg-park').entry.name, 'bg-ch-park-2.png');
  assert.equal(pickTakes(parsed, { takeAll: 2 }).get('ch-chiikawa-base').entry.name, 'ch-chiikawa-base-2.png');
  assert.deepEqual(parseTakeArg('2'), { takes: {}, takeAll: 2 });
  assert.deepEqual(parseTakeArg('bg-ch-park=2,ch-chiikawa-sheet_jump=3'), { takes: { 'bg-ch-park': 2, 'ch-chiikawa-sheet-jump': 3 }, takeAll: null });
  assert.deepEqual(idRole('npc-bear-cub-base'), { group: 'npc', name: 'bear-cub', part: 'base', prefix: 'npc-bear-cub' });
  assert.ok(importRank('ch-chiikawa-base') < importRank('ch-usagi-base'));
  assert.ok(importRank('ch-usagi-base') < importRank('ch-chiikawa-body'));
  assert.ok(importRank('ch-chiikawa-body') < importRank('ch-chiikawa-eyes-closed'));
  assert.ok(importRank('mc-hoya-neutral') < importRank('mc-hoya-eyes-closed'));
});

// ---------- keying ----------

test('keyBackdrop: sampled backdrop (G 65), outlined purple / pink interiors stay, enclosed holes clear, small details survive', async () => {
  const png = await svgPng(
    120,
    120,
    `<rect x="20" y="20" width="80" height="80" fill="#fff" ${LINE}/>
     <rect x="40" y="45" width="40" height="18" fill="rgb(215,70,236)" ${LINE}/>
     <rect x="50" y="75" width="20" height="14" fill="rgb(250,62,244)" ${LINE}/>
     <rect x="20" y="5" width="3" height="10" fill="#7a6868"/><rect x="28" y="5" width="3" height="10" fill="#7a6868"/>`,
  );
  const k = keyBackdrop(await rawOf(png));
  const a = (x, y) => k.data[(y * 120 + x) * 4 + 3];
  assert.deepEqual([k.bg.r, k.bg.g, k.bg.b], [250, 62, 244]);
  assert.equal(a(2, 2), 0);
  assert.equal(a(60, 54), 255, 'a purple bow tie inside an outline stays opaque');
  assert.equal(a(60, 82), 0, 'an enclosed backdrop-coloured hole is cleared');
  assert.ok(a(21, 9) > 200, 'a 3×10 shock line survives (min area 30)');
});

// ---------- placement ----------

test('placement: one family transform (head-top → y 420, feet → y 1303, centred); other image sizes map the same; big deviations are corrected', async () => {
  const res = 0.25;
  const base = keyBackdrop(await rawOf(await chibi()));
  const st = figureStats(base);
  const fam = familyFrom(st, base.w, base.h);
  const placed = await placeOnCanvas(base, transformFor(fam, base.w, base.h, st), { res });
  assert.deepEqual([placed.w, placed.h], [256, 384]);
  const ps = figureStats(placed);
  assert.ok(Math.abs(ps.bbox.top - CANVAS.headTop * res) <= 2, `top ${ps.bbox.top}`);
  assert.ok(Math.abs(ps.feetY - CANVAS.feetY * res) <= 2, `feet ${ps.feetY}`);
  assert.ok(Math.abs(ps.cx - CANVAS.cx * res) <= 2, `cx ${ps.cx}`);
  // a taller take (848×1264-like aspect) drawn with the reference at the same relative place → same canvas placement
  const tall = keyBackdrop(await rawOf(await sharp(await chibi()).resize(212, 316, { fit: 'fill' }).png().toBuffer()));
  const t2 = transformFor(fam, tall.w, tall.h, figureStats(tall));
  assert.equal(t2.corrected.y, false);
  const p2 = figureStats(await placeOnCanvas(tall, t2, { res }));
  assert.ok(Math.abs(p2.feetY - ps.feetY) <= 2 && Math.abs(p2.cx - ps.cx) <= 2);
  // an image drawn without the reference (feet 20 px higher, 6.7 %) → translation correction, same scale kept
  const off = keyBackdrop(await rawOf(await chibi({ dy: -20 })));
  const t3 = transformFor(fam, off.w, off.h, figureStats(off));
  assert.equal(t3.corrected.y, true);
  assert.ok(t3.dev.y < -0.05);
  assert.equal(t3.k, transformFor(fam, off.w, off.h).k);
  assert.ok(Math.abs(figureStats(await placeOnCanvas(off, t3, { res })).feetY - ps.feetY) <= 2);
  // anchors: head top between the ears (below the bbox top), eyes found, chin above the arms, hands outside the body
  const an = measureAnchors(placed, { res });
  assert.ok(an.head[1] > an.bbox.y + 10, 'head top is under the ears');
  assert.ok(an.eyes && Math.abs(an.eyes[0][1] - an.eyes[1][1]) < 4 && an.eyes[0][0] < 512 && an.eyes[1][0] > 512);
  assert.ok(an.neck[1] > an.face[1] && an.neck[1] < CANVAS.feetY);
  assert.ok(an.handL[0] < an.headBox.left + 60 && an.handR[0] > an.headBox.right - 60);
  // crop: stored at its content with the logical rect
  const c = cropToContent(placed);
  assert.ok(c.raw.w < placed.w && c.rect[0] > 0 && c.rect[2] === c.raw.w);
});

// ---------- arms / overlays ----------

test('arms: base − noarms → two arms outside the body, pivots at the shoulders, hands at the tips', async () => {
  const res = 0.25;
  const b = keyBackdrop(await rawOf(await chibi()));
  const fam = familyFrom(figureStats(b), b.w, b.h);
  const place = async (png) => {
    const k = keyBackdrop(await rawOf(png));
    return placeOnCanvas(k, transformFor(fam, k.w, k.h, figureStats(k)), { res });
  };
  const base = await place(await chibi());
  const body = await place(await chibi({ arms: false }));
  const a = extractArms(base, body);
  assert.equal(a.found, 2);
  assert.ok(a.areas.every((n) => n > 30), JSON.stringify(a.areas));
  // nothing of the arm layer lies inside the arm-less body (no white patch dragged over the outline when raised)
  for (let p = 0; p < base.w * base.h; p++) if (body.data[p * 4 + 3] > 128) assert.equal(a.arms.data[p * 4 + 3], 0);
  const { armL, armR } = a.pivots;
  assert.ok(armL[0] < 128 && armR[0] > 128, 'one pivot per side');
  assert.ok(Math.abs(armL[1] - armR[1]) < 4, 'symmetric shoulders');
  assert.ok(a.hands.handL[0] < armL[0] && a.hands.handR[0] > armR[0], 'hands further out than the shoulders');
});

test('overlays: registered edit − base inside the face box covers the old eyes; body-wide changes are counted outside', async () => {
  const res = 0.25;
  const b = keyBackdrop(await rawOf(await chibi()));
  const fam = familyFrom(figureStats(b), b.w, b.h);
  const place = async (png) => {
    const k = keyBackdrop(await rawOf(png));
    return placeOnCanvas(k, transformFor(fam, k.w, k.h), { res });
  };
  const base = await place(await chibi());
  const an = measureAnchors(base, { res });
  const box = { left: Math.floor((an.headBox.left - 10) * res), right: Math.ceil((an.headBox.right + 10) * res), top: Math.floor((an.headBox.top - 10) * res), bottom: Math.ceil((an.headBox.bottom + 10) * res) };
  // eyes closed, delivered 1 px off (edits land within 0–1 px)
  const closed = shiftRaw(await place(await chibi({ eyes: 'closed' })), -1, 0);
  const o = extractOverlay(closed, base, { box });
  assert.deepEqual(o.shift, { dx: 1, dy: 0, gain: o.shift.gain });
  assert.ok(o.changed.inside > 10);
  assert.equal(o.changed.outside, 0);
  // the old (open) eye is covered by opaque edit pixels
  const [ex, ey] = an.eyes[0].map((v) => Math.round(v * res));
  assert.ok(o.overlay.data[(ey * base.w + ex) * 4 + 3] > 200, 'overlay covers the old eye');
  assert.equal(o.overlay.data[(5 * base.w + 5) * 4 + 3], 0);
  // raised arms = a body change → counted outside the face box (the importer makes that expression a full swap)
  const raised = await place(await chibi({ raised: true, eyes: 'closed' }));
  const o2 = extractOverlay(raised, base, { box });
  assert.ok(o2.changed.outside > o2.changed.inside * 0.25, JSON.stringify(o2.changed));
});

// ---------- sheets / props ----------

test('sheets: 2×2 frames keyed, one scale (head width), feet bottom-aligned, same crop per cell, head offsets', async () => {
  const cell = (o) => chibi({ w: 112, h: 112, ...o });
  // frames drawn at different sizes / heights inside their cells (as Gemini does), one crouching lower
  const frames = await Promise.all([
    cell({ s: 0.4, dx: -56, dy: -128 }),
    cell({ s: 0.42, dx: -54, dy: -140, raised: true }),
    cell({ s: 0.41, dx: -56, dy: -150, raised: true }),
    cell({ s: 0.4, dx: -58, dy: -130 }),
  ]);
  const sheetPng = await sharp({ create: { width: 224, height: 224, channels: 3, background: { r: 250, g: 40, b: 246 } } })
    .composite(frames.map((f, i) => ({ input: f, left: (i % 2) * 112, top: Math.floor(i / 2) * 112 })))
    .png()
    .toBuffer();
  const keyed = keyBackdrop(await rawOf(sheetPng));
  const r = await normalizeSheet(keyed, { grid: [2, 2], targetHeight: 880, refHeadWidth: 400, refHead: { cx: 512, top: 500 }, res: 0.25 });
  assert.equal(r.frames.length, 4);
  assert.deepEqual([r.sheet.w, r.sheet.h], [r.cell[0] * 2, r.cell[1] * 2]);
  assert.equal(r.rect[2], r.cell[0]);
  // every frame: feet on the canvas feet line (in the cell crop), centred
  for (let i = 0; i < 4; i++) {
    const c = { data: Buffer.alloc(r.cell[0] * r.cell[1] * 4), w: r.cell[0], h: r.cell[1] };
    for (let y = 0; y < r.cell[1]; y++) r.sheet.data.copy(c.data, y * r.cell[0] * 4, (((Math.floor(i / 2) * r.cell[1] + y) * r.sheet.w + (i % 2) * r.cell[0]) * 4), (((Math.floor(i / 2) * r.cell[1] + y) * r.sheet.w + (i % 2 + 1) * r.cell[0]) * 4));
    const st = figureStats(c);
    assert.ok(Math.abs(st.feetY + r.rect[1] - CANVAS.feetY * 0.25) <= 2, `frame ${i} feet`);
    assert.ok(Math.abs(st.cx + r.rect[0] - CANVAS.cx * 0.25) <= 2, `frame ${i} centre`);
  }
  // one scale for all: the median head width maps onto 400 logical units
  const hw = r.heads.slice().sort((a, b) => a - b);
  assert.ok(Math.abs(((hw[1] + hw[2]) / 2) * r.scale - 400) < 1);
  assert.equal(r.offsets.length, 4);
  assert.ok(r.offsets.every((o) => o.length === 2 && o.every(Number.isFinite)));
});

test('props: white → alpha, trimmed, anchor per slot (a hat sinks into the head), scale from the slot width', async () => {
  const png = await svgPng(200, 200, `<path d="M60 130 L60 80 Q100 20 140 80 L140 130 Z" fill="#fff" ${LINE}/>`, '#ffffff');
  const p = await normalizeProp(png, { slot: 'head' });
  assert.ok(p.width < 200 && p.height < 200);
  assert.ok(p.anchor[1] > p.height * 0.75 && p.anchor[1] < p.height, 'head anchor near the bottom');
  assert.ok(Math.abs(p.anchor[0] - p.width / 2) < 1);
  const raw = await rawOf(p.buffer);
  assert.ok(raw.data[(Math.round(p.height / 2) * p.width + Math.round(p.width / 2)) * 4 + 3] > 200, 'white interior inside the outline stays');
  assert.ok(Math.abs(p.scale * p.width - 0.78 * 450) < 1);
  assert.ok(headSpan(raw) === null || headSpan(raw).width > 0);
});

// ---------- manifest ----------

test('manifest: chara / prop kinds and MC overlay parts validate; the shipped manifest holds every requested id', async () => {
  const ok = { id: 'ch-x-base', kind: 'chara', label: '테스트', aspect: '3:4', prompt: 'Chiikawa test prompt', refs: [], output: 'chara/ch/x/base.webp', postprocess: [], status: 'todo', meta: { character: 'x', part: 'base' } };
  assert.deepEqual(validateItem(ok), []);
  assert.ok(validateItem({ ...ok, meta: { character: 'x', npc: 'y', part: 'base' } }).length);
  assert.ok(validateItem({ ...ok, meta: { character: 'x', part: 'elbow' } }).length);
  assert.ok(validateItem({ ...ok, meta: { pet: 'chick', part: 'sheet-jump', grid: [2, 'x'] } }).length);
  assert.ok(validateItem({ ...ok, meta: { character: 'x', part: 'base', rect: [0, 0, -1, 4] } }).length);
  assert.deepEqual(validateItem({ ...ok, id: 'prop-x', kind: 'prop', output: 'chara/props/x.webp', meta: { prop: 'x', slot: 'hand' } }), []);
  assert.ok(validateItem({ ...ok, id: 'prop-x', kind: 'prop', output: 'chara/props/x.webp', meta: { prop: 'x', slot: 'tail' } }).length);
  const mc = { ...ok, id: 'mc-hoya-eyes-closed', kind: 'mc', output: 'mc/hoya/eyes-closed.png', meta: { mc: 'hoya', part: 'eyes-closed', base: 'mc-hoya-neutral' } };
  assert.deepEqual(validateItem(mc), []);
  assert.ok(validateItem({ ...mc, meta: { mc: 'hoya', part: 'eyes-closed', expression: 'joy' } }).length, 'one of expression / pose / part');
  const m = await loadManifest(MANIFEST_PATH);
  assert.equal(validateManifest(m).ok, true);
  assert.deepEqual(unmappedRequests(m), []);
  assert.equal(m.items.filter((i) => i.kind === 'chara').length, 8 * 12 + 10 + 8); // + expr-angry / love / sweat per roster character
  assert.equal(m.items.filter((i) => i.kind === 'prop').length, 70); // 60 + the 세계 설정 props (사스마타 …)
  for (const dog of ['hoya', 'bomi']) for (const part of ['eyes-closed', 'mouth-open']) assert.equal(getItem(m, `mc-${dog}-${part}`)?.meta.base, `mc-${dog}-neutral`);
  // the generator is idempotent on the shipped manifest; arms are derived from base + body
  const again = upsertCharaItems(structuredClone(m));
  assert.equal(again.added, 0);
  assert.equal(again.updated, 0);
  assert.deepEqual(getItem(m, 'ch-usagi-arms').refs, ['ch-usagi-base', 'ch-usagi-body']);
  assert.ok(charaItems({ requests: loadRequests() }).some((i) => i.id === 'npc-bear-cub-base' && i.meta.npc === 'bear_cub'));
});

// ---------- importer end to end ----------

test('import: characters (aliases, takes, placement, arms, overlay vs swap, sheet), props and MC overlays', async () => {
  const t = await tempDir();
  try {
    const ids = ['ch-chiikawa-base', 'ch-chiikawa-body', 'ch-chiikawa-arms', 'ch-chiikawa-eyes-closed', 'ch-chiikawa-expr-cry', 'ch-chiikawa-expr-shock', 'ch-chiikawa-sheet-jump', 'npc-penguin-base', 'prop-chef-hat', 'mc-hoya-neutral', 'mc-hoya-eyes-closed'];
    const src = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
    src.items = src.items.filter((i) => ids.includes(i.id)).map(({ accepted, ...i }) => ({ ...i, refs: i.refs.filter((r) => ids.includes(r)), status: 'todo' }));
    await mkdir(path.join(t.dir, 'm'), { recursive: true });
    const manifestPath = path.join(t.dir, 'm', 'manifest.json');
    await writeFile(manifestPath, JSON.stringify(src));
    const inbox = path.join(t.dir, 'inbox');
    await mkdir(inbox);
    const put = async (name, buf) => writeFile(path.join(inbox, name), buf);
    await put('ch-chiikawa-base.png', await chibi());
    await put('ch-chiikawa-base-2.png', await chibi({ dy: -30 })); // a second take: ignored without --take
    await put('ch-chiikawa-noarms_original.jpg', await sharp(await chibi({ arms: false })).jpeg({ quality: 95 }).toBuffer());
    await put('ch-chiikawa-eyes-closed.png', await chibi({ eyes: 'closed' }));
    await put('ch-chiikawa-cry.png', await chibi({ eyes: 'closed', tears: true }));
    await put('ch-chiikawa-expr-shock.png', await chibi({ raised: true }));
    const cellPng = (o) => chibi({ w: 112, h: 112, s: 0.4, dx: -56, dy: -130, ...o });
    await put(
      'ch-chiikawa-sheet-jump.png',
      await sharp({ create: { width: 224, height: 224, channels: 3, background: { r: 250, g: 40, b: 246 } } })
        .composite(await Promise.all([{}, { raised: true }, { raised: true, dy: -140 }, {}].map(async (o, i) => ({ input: await cellPng(o), left: (i % 2) * 112, top: Math.floor(i / 2) * 112 }))))
        .png()
        .toBuffer(),
    );
    await put('npc-friend-penguin.png', await chibi({ s: 0.8, dy: -22 })); // drawn without the reference: smaller, feet higher
    await put('prop-hat-chef.png', await svgPng(160, 160, `<path d="M40 120 L40 70 Q80 10 120 70 L120 120 Z" fill="#fff" ${LINE}/>`, '#ffffff'));
    await put('mc-hoya-neutral.png', await chibi({ w: 200, h: 200, s: 0.7, dy: -60, dx: -12 }));
    await put('mc-hoya-eyes-closed.png', await chibi({ w: 200, h: 200, s: 0.7, dy: -60, dx: -12, eyes: 'closed' }));
    const logs = [];
    const run = await importAssets({ dir: inbox, manifestPath, outputDir: path.join(t.dir, 'out'), dataDir: path.join(t.dir, 'data'), log: (l) => logs.push(l), charaRes: 0.25 });
    assert.equal(run.failed, 0, logs.join('\n'));
    assert.ok(run.bytes > 0);
    const m = await loadManifest(manifestPath);
    for (const id of ids) assert.equal(getItem(m, id).status, 'accepted', id);
    const meta = (id) => getItem(m, id).meta;
    // base: rect + anchors + placement; take 1 used, take 2 removed with it
    assert.equal(getItem(m, 'ch-chiikawa-base').accepted.from, 'ch-chiikawa-base.png');
    assert.equal(meta('ch-chiikawa-base').rect.length, 4);
    assert.ok(meta('ch-chiikawa-base').anchors.head && meta('ch-chiikawa-base').placement.unit > 0);
    assert.deepEqual(await readdir(inbox), []);
    // body (from the JPEG -noarms) + derived arms with pivots; the base got the measured hands
    assert.equal(getItem(m, 'ch-chiikawa-body').accepted.from, 'ch-chiikawa-noarms_original.jpg');
    assert.ok(meta('ch-chiikawa-arms').pivots.armL && meta('ch-chiikawa-arms').pivots.armR);
    assert.deepEqual(meta('ch-chiikawa-base').anchors.handR, meta('ch-chiikawa-arms').hands.handR);
    // expressions: the face-only cry is an overlay, raised arms (shock) a full swap
    assert.equal(meta('ch-chiikawa-expr-cry').overlay, true);
    assert.equal(meta('ch-chiikawa-expr-shock').overlay, false);
    assert.equal(meta('ch-chiikawa-eyes-closed').overlay, true);
    assert.ok(meta('ch-chiikawa-eyes-closed').rect[2] < 400, 'overlay cropped to the face');
    // sheet: grid / timing / rect / head offsets for the renderer
    const sh = meta('ch-chiikawa-sheet-jump');
    assert.deepEqual(sh.grid, [2, 2]);
    assert.deepEqual(sh.seq, [0, 1, 2, 1, 3]);
    assert.equal(sh.heads.length, 4);
    assert.ok(sheetDef({ url: '/x', width: 10, height: 10, meta: sh }).rect);
    // penguin: same family scale, translation corrected (logged)
    assert.ok(logs.some((l) => /npc-penguin-base/.test(l)) && logs.some((l) => /발 위치 보정/.test(l)), logs.join('\n'));
    // prop: anchor + scale
    assert.equal(meta('prop-chef-hat').anchor.length, 2);
    // MC: neutral keyed into 1024² (old PNG path), eyes-closed = an overlay with its rect in the square
    const mcOut = path.join(t.dir, 'out', getItem(m, 'mc-hoya-neutral').output);
    assert.deepEqual(Object.values((({ width, height }) => ({ width, height }))(await sharp(mcOut).metadata())), [1024, 1024]);
    const ov = meta('mc-hoya-eyes-closed');
    assert.deepEqual(ov.size, [1024, 1024]);
    assert.ok(ov.rect[2] < 600 && ov.rect[3] < 400, JSON.stringify(ov.rect));
    assert.ok(await exists(path.join(t.dir, 'data', 'chara-src', 'ch-chiikawa-base.png')), 'placed base cached for later edits');
  } finally {
    await t.cleanup();
  }
});

// ---------- renderer / MC plug-ins ----------

test('renderer: art anchors + rects, `_` ids, hand item rides the right arm, expressions drop blink/talk; sheet timing', () => {
  try {
    setAssetIndex({
      'ch-chiikawa-base': { url: '/b.webp', kind: 'chara', meta: { character: 'chiikawa', part: 'base', rect: [140, 420, 740, 883], anchors: { head: [512, 444], face: [512, 700], neck: [512, 917], handL: [165, 994], handR: [859, 996], back: [512, 1109] }, eyes: [[402, 704], [617, 704]], headBox: { left: 167, right: 856, top: 444, bottom: 917 }, bbox: { x: 140, y: 420, w: 740, h: 883 } } },
      'ch-chiikawa-body': { url: '/body.webp', kind: 'chara', meta: { character: 'chiikawa', part: 'body', rect: [160, 420, 700, 883] } },
      'ch-chiikawa-arms': { url: '/arms.webp', kind: 'chara', meta: { character: 'chiikawa', part: 'arms', rect: [140, 916, 745, 113], pivots: { armL: [250, 956], armR: [775, 957] } } },
      'ch-chiikawa-eyes-closed': { url: '/ec.webp', kind: 'chara', meta: { character: 'chiikawa', part: 'eyes-closed', rect: [380, 680, 260, 70], overlay: true } },
      'ch-chiikawa-expr-cry': { url: '/cry.webp', kind: 'chara', meta: { character: 'chiikawa', part: 'expr-cry', rect: [300, 600, 420, 360], overlay: true } },
      'npc-bear-cub-base': { url: '/bear.webp', kind: 'chara', meta: { npc: 'bear_cub', part: 'base' } },
      'prop-balloon': { url: '/balloon.webp', kind: 'prop', width: 100, height: 200, meta: { prop: 'balloon', slot: 'hand', anchor: [50, 180], scale: 1 } },
    });
    const r = rasterParts({ character: 'chiikawa' });
    assert.deepEqual(r.anchors.handR, [859, 996]);
    const svg = charaSvg({ character: 'chiikawa', props: { hand: 'balloon' } }, { crop: 'full' });
    assert.match(svg, /<image class="ch-r body" href="\/body.webp" x="160" y="420" width="700" height="883" preserveAspectRatio="none"\/>/);
    // the balloon is inside the right arm's rig group, at the art's hand anchor (its meta.anchor on [859, 996])
    const armR = svg.slice(svg.indexOf('data-rig="armR"'));
    const m = /data-rig="propR" data-px="859" data-py="996"><image class="ch-prop-img" href="\/balloon.webp" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/.exec(armR.slice(0, armR.indexOf('</g></g>') + 8));
    assert.ok(m, armR.slice(0, 400));
    const [x, y, w, h] = m.slice(1).map(Number);
    assert.ok(Math.abs(x + w * 0.5 - 859) < 0.2 && Math.abs(y + h * 0.9 - 996) < 0.2, 'meta.anchor sits on the hand anchor');
    assert.match(svg, /class="ch-ec" display="none"><image class="ch-r eyes"/);
    // with an expression overlay: the cry face, no blink / talk overlays on top of it
    const cry = charaSvg({ character: 'chiikawa' }, { expression: 'cry' });
    assert.match(cry, /class="ch-r expr" href="\/cry.webp"/);
    assert.doesNotMatch(cry, /ch-ec/);
    // crops follow the drawing (face crop centred on the measured head)
    const face = charaSvg({ character: 'chiikawa' }, { crop: 'face' });
    const [, vy, , vh] = /viewBox="([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+)"/.exec(face).slice(1).map(Number);
    assert.ok(Math.abs(vy + vh / 2 - (444 + 917) / 2) < 60, `face crop centre ${vy + vh / 2}`);
    // npc ids with `_` are found by their manifest spelling (npc-bear-cub-base)
    assert.match(charaSvg({ npc: 'bear_cub', props: {} }), /href="\/bear.webp"/);
  } finally {
    setAssetIndex({});
  }
  const sheet = sheetDef({ url: '/s.webp', width: 800, height: 900, meta: { grid: [2, 2], frames: 4, loop: false, seq: [0, 1, 2, 1, 3], frameMs: [180, 150, 190, 100, 230], rect: [118, 430, 788, 882], heads: [[0, 116], [0, 22], [0, 20], [0, 56]] } });
  assert.deepEqual(sheet.size, [800, 900]);
  assert.equal(sheet.heads.length, 4);
  assert.equal(spriteDuration(sheet), 850);
  assert.deepEqual([0, 179, 180, 329, 330, 519, 520, 619, 620, 849].map((t) => spriteFrame(t, sheet)), [0, 0, 1, 1, 2, 2, 1, 1, 3, 3]);
  assert.equal(spriteFrame(850, sheet), -1);
  assert.equal(spriteFrame(900, { ...sheet, loop: true }), 0);
  assert.equal(sheetDef({ url: '/s', meta: { grid: [2, 2], seq: [0, 9], frameMs: [1, 1] } }).seq, undefined, 'out-of-range frames ignored');
});

test('MC overlays: lookup by meta.part, percent box + breathing origin, talk length', () => {
  const find = ({ kind, mc, part }) => (kind === 'mc' && mc === 'hoya' && part === 'eyes-closed' ? { url: '/e.png', meta: { mc, part, rect: [256, 512, 512, 128], size: [1024, 1024] } } : null);
  const o = mcOverlays('hoya', find);
  assert.equal(o.eyes.url, '/e.png');
  assert.equal(o.mouth, null);
  assert.equal(overlayStyle(o.eyes), 'left:25%;top:50%;width:50%;height:12.5%;transform-origin:50% 400%');
  assert.equal(mcTalkMs(''), 700);
  assert.equal(mcTalkMs('가'.repeat(100)), 2600);
});
