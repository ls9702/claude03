import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadData } from '../server/data/index.js';
import { Z_ORDER, layerStack, partId } from '../public/js/shared/partStack.js';
import * as serverPartStack from '../server/assets/partStack.js';
import * as serverTint from '../server/assets/tintMath.js';
import * as sharedTint from '../public/js/shared/tintMath.js';
import {
  COMPOSE_CROPS,
  FIGURE_SPAN,
  LEVELS,
  composeAvatar,
  composeGeometry,
  composeKey,
  levelFor,
  partExpression,
  peekAvatar,
  stackFor,
  stackUsable,
} from '../public/js/ui/avatarCompose.js';

const defs = loadData('avatars');

/** Fake `/api/assets` lookup: every part for girl/normal + boy/chubby mannequins, some variants missing. */
function fakeLookup({ lieAboutFixedOutfits = false } = {}) {
  const assets = {};
  const put = (id, meta, files) => (assets[id] = { url: `/${id}.webp`, meta, ...(files ? { files } : {}) });
  put(partId.mannequin('girl', 'normal'), { slot: 'mannequin', tint: 'skin', tintMode: 'selective', tintRef: '#f6d8bc' });
  put(partId.mannequin('boy', 'chubby'), { slot: 'mannequin', tint: 'skin', tintMode: 'selective', tintRef: '#f6d8bc' });
  put(partId.hair('bob'), { slot: 'hair', tint: 'hair', tintRef: '#6e605a' }, { front: '/bob-front.webp', back: '/bob-back.webp', erase: '/bob-erase.webp' });
  put(partId.hair('short'), { slot: 'hair', tint: 'hair', tintRef: '#4a4440' }, { front: '/short-front.webp', back: '/short-back.webp' });
  put(partId.face('square'), { slot: 'face', tint: 'skin', tintMode: 'selective', tintRef: '#f6d8bc' });
  put(partId.cheek('freckles'), { slot: 'cheek', tint: 'skin', tintMode: 'selective', tintRef: '#c8906c' });
  put(partId.cheek('blush'), { slot: 'cheek', tint: null });
  for (const e of ['round', 'cat']) {
    put(partId.eyes(e), { slot: 'eyes', tint: null });
    put(partId.eyesClosed(e), { slot: 'eyesClosed', tint: null });
  }
  put(partId.mouth('smile'), { slot: 'mouth', tint: null });
  put(partId.expression('joy'), { slot: 'expression', tint: null });
  put(partId.accessory('glasses'), { slot: 'accessory', tint: null });
  put(partId.outfit('hoodie', 'girl', 'normal'), { slot: 'outfit', tint: 'outfit', tintRef: '#c1b9b8' }, { erase: '/hoodie-gn-erase.webp' });
  // boy/chubby hoodie missing → falls back to boy/normal (without its erase mask)
  put(partId.outfit('hoodie', 'boy', 'normal'), { slot: 'outfit', tint: 'outfit', tintRef: '#c1b9b8' }, { erase: '/hoodie-bn-erase.webp' });
  // fixed-colour outfits: natural colours (a stale manifest may still claim an outfit tint)
  put(partId.outfit('police', 'girl', 'normal'), { slot: 'outfit', tint: lieAboutFixedOutfits ? 'outfit' : null, tintRef: '#c8c8c8' }, { hat: '/police-hat.webp' });
  return (id) => assets[id] ?? null;
}

const base = { body: 'girl', build: 'normal', skin: 'deep', face: 'square', eyes: 'round', mouth: 'smile', cheek: 'freckles', hair: 'bob', hairColor: 'pink', outfit: 'hoodie', outfitColor: 'green', accessory: 'glasses' };
const colorOf = (cat, id) => defs.parts[cat].find((o) => o.id === id).color;

test('shared modules: server/assets re-exports the browser copies (one implementation)', () => {
  assert.equal(serverPartStack.layerStack, layerStack);
  assert.equal(serverTint.tintPixels, sharedTint.tintPixels);
  for (const f of ['public/js/shared/partStack.js', 'public/js/shared/tintMath.js']) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /from ['"](node:|sharp|fs|path)/, `${f} must stay browser-safe`);
  }
});

test('stackFor: z-order, erase masks on back hair + mannequin, tint channel per slot', () => {
  const s = stackFor(base, { lookup: fakeLookup(), defs });
  assert.deepEqual(s.map((l) => l.slot), ['backHair', 'mannequin', 'face', 'outfit', 'cheek', 'eyes', 'mouth', 'frontHair', 'accessory']);
  const order = s.map((l) => Z_ORDER.indexOf(l.slot));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'drawn in Z_ORDER');
  const by = Object.fromEntries(s.map((l) => [l.slot, l]));
  assert.equal(by.backHair.src, '/bob-back.webp');
  assert.equal(by.frontHair.src, '/bob-front.webp');
  assert.deepEqual(by.backHair.erase, ['/bob-erase.webp', '/hoodie-gn-erase.webp']);
  assert.deepEqual(by.mannequin.erase, ['/bob-erase.webp', '/hoodie-gn-erase.webp']);
  for (const l of s) if (!['backHair', 'mannequin'].includes(l.slot)) assert.equal(l.erase, undefined, `${l.slot} has no erase`);
  // tint channels
  assert.deepEqual(by.backHair.tint, { channel: 'hair', color: colorOf('hairColor', 'pink'), ref: '#6e605a', mode: 'full' });
  assert.deepEqual(by.frontHair.tint, by.backHair.tint);
  assert.deepEqual(by.mannequin.tint, { channel: 'skin', color: colorOf('skin', 'deep'), ref: '#f6d8bc', mode: 'selective' });
  assert.equal(by.face.tint.channel, 'skin');
  assert.equal(by.cheek.tint.channel, 'skin', 'freckles follow the skin');
  assert.deepEqual(by.outfit.tint, { channel: 'outfit', color: colorOf('outfitColor', 'green'), ref: '#c1b9b8', mode: 'full' });
  for (const slot of ['eyes', 'mouth', 'accessory']) assert.equal(by[slot].tint, null, `${slot} keeps natural colours`);
});

test('stackFor: missing build variant falls back to normal without its erase mask; missing layers are skipped', () => {
  const s = stackFor({ ...base, body: 'boy', build: 'chubby', hair: 'short', face: 'slim', cheek: 'none', accessory: 'none', eyes: 'cat' }, { lookup: fakeLookup(), defs });
  const by = Object.fromEntries(s.map((l) => [l.slot, l]));
  assert.equal(by.outfit.id, partId.outfit('hoodie', 'boy', 'normal'));
  assert.equal(by.mannequin.id, partId.mannequin('boy', 'chubby'));
  assert.equal(by.mannequin.erase, undefined, 'no hair erase (short) and the fallback outfit mask is not used');
  assert.ok(!by.face && !by.cheek && !by.accessory, 'NO_LAYER options draw nothing');
  assert.equal(by.eyes.id, partId.eyes('cat'));
  // unknown option ids normalize to defaults; nothing for a body without a mannequin → unusable (SVG fallback)
  assert.equal(stackUsable(stackFor({ body: 'boy', build: 'slim' }, { lookup: fakeLookup(), defs })), false);
  assert.equal(stackUsable(s), true);
  assert.equal(stackUsable([]), false);
});

test('stackFor: fixed-colour outfits (tintable:false) are never tinted, hat layer included', () => {
  for (const lie of [false, true]) {
    const s = stackFor({ ...base, outfit: 'police', outfitColor: 'pink' }, { lookup: fakeLookup({ lieAboutFixedOutfits: lie }), defs });
    const outfit = s.filter((l) => l.slot === 'outfit' || l.slot === 'hat');
    assert.deepEqual(outfit.map((l) => l.slot), ['outfit', 'hat']);
    for (const l of outfit) assert.equal(l.tint, null, `police ${l.slot} untinted (meta lies: ${lie})`);
  }
  // a tintable outfit keeps its tint
  assert.ok(stackFor(base, { lookup: fakeLookup(), defs }).find((l) => l.slot === 'outfit').tint);
});

test('stackFor: expressions replace eyes + mouth, blink swaps eyes; unknown expressions = neutral', () => {
  const lookup = fakeLookup();
  const joy = stackFor(base, { lookup, defs, expression: 'joy' });
  assert.ok(joy.some((l) => l.slot === 'expression') && !joy.some((l) => ['eyes', 'mouth'].includes(l.slot)));
  const blink = stackFor(base, { lookup, defs, blink: true });
  assert.equal(blink.find((l) => l.slot === 'eyesClosed').id, partId.eyesClosed('round'));
  assert.ok(blink.some((l) => l.slot === 'mouth'));
  assert.deepEqual(stackFor(base, { lookup, defs, expression: 'neutral' }), stackFor(base, { lookup, defs }));
  assert.equal(partExpression('neutral'), null);
  assert.equal(partExpression('shy'), 'shy');
  assert.equal(partExpression('bogus'), null);
});

test('stackFor with the shipped manifest: every body × build × outfit composes (mannequin + outfit layer)', () => {
  const manifest = JSON.parse(readFileSync(new URL('../server/assets/manifest.json', import.meta.url), 'utf8'));
  const items = new Map(manifest.items.filter((i) => i.kind === 'part' && i.status === 'accepted').map((i) => [i.id, { url: `/assets/generated/${i.accepted.file}`, meta: i.meta, files: i.accepted.files }]));
  const lookup = (id) => items.get(id) ?? null;
  for (const body of defs.parts.body) {
    for (const build of defs.parts.build) {
      for (const outfit of defs.parts.outfit) {
        const s = stackFor({ ...base, body: body.id, build: build.id, outfit: outfit.id }, { lookup, defs });
        assert.ok(stackUsable(s), `${body.id}/${build.id}`);
        assert.ok(s.some((l) => l.slot === 'outfit'), `${outfit.id} ${body.id}/${build.id} has an outfit layer`);
        if (outfit.tintable === false) assert.ok(s.filter((l) => l.slot === 'outfit' || l.slot === 'hat').every((l) => !l.tint));
      }
    }
  }
  for (const hair of defs.parts.hair) {
    const s = stackFor({ ...base, hair: hair.id }, { lookup, defs });
    assert.ok(s.some((l) => l.slot === 'frontHair') || s.some((l) => l.slot === 'backHair'), `hair ${hair.id}`);
  }
});

test('composeKey: stable across property order / omitted defaults; changes with every option', () => {
  const opts = { size: 220, crop: 'bust', dpr: 1 };
  const k = composeKey(base, opts, defs);
  const reordered = Object.fromEntries(Object.entries(base).reverse());
  assert.equal(composeKey(reordered, opts, defs), k);
  const withDefaults = { ...defs.default };
  const sparse = { body: defs.default.body };
  assert.equal(composeKey(sparse, opts, defs), composeKey(withDefaults, opts, defs), 'missing parts = defaults');
  assert.equal(composeKey({ ...base, bogus: 1, hair: 'no-such-hair' }, opts, defs), composeKey({ ...base, hair: defs.default.hair }, opts, defs));
  const keys = new Set([k]);
  for (const cat of defs.order) {
    const other = defs.parts[cat].find((o) => o.id !== base[cat]);
    keys.add(composeKey({ ...base, [cat]: other.id }, opts, defs));
  }
  assert.equal(keys.size, defs.order.length + 1, 'every category is part of the key');
  const variants = [
    { ...opts, expression: 'joy' },
    { ...opts, blink: true },
    { ...opts, size: 221 },
    { ...opts, crop: 'full' },
    { ...opts, crop: 'face' },
    { ...opts, dpr: 2 },
  ];
  for (const v of variants) keys.add(composeKey(base, v, defs));
  assert.equal(keys.size, defs.order.length + 1 + variants.length);
  // neutral / unknown expressions share the neutral key; blink is irrelevant under an expression
  assert.equal(composeKey(base, { ...opts, expression: 'neutral' }, defs), k);
  assert.equal(composeKey(base, { ...opts, expression: 'bogus' }, defs), k);
  assert.equal(composeKey(base, { ...opts, expression: 'joy', blink: true }, defs), composeKey(base, { ...opts, expression: 'joy' }, defs));
  assert.equal(composeKey(base, { ...opts, crop: 'nope' }, defs), composeKey(base, { ...opts, crop: 'full' }, defs));
  assert.equal(composeKey(base, { ...opts, size: 220.2 }, defs), k, 'size rounded');
});

test('compose geometry: crops inside the layer union, working level covers the output, figure span inside full', () => {
  const full = COMPOSE_CROPS.full;
  for (const [name, c] of Object.entries(COMPOSE_CROPS)) {
    assert.ok(c.x >= full.x && c.y >= full.y && c.x + c.w <= full.x + full.w && c.y + c.h <= full.y + full.h, `${name} inside CROP`);
  }
  assert.ok(FIGURE_SPAN.top > full.y && FIGURE_SPAN.bottom < full.y + full.h);
  assert.equal(levelFor(0.1), 0.25);
  assert.equal(levelFor(0.25), 0.25);
  assert.equal(levelFor(0.3), 0.5);
  assert.equal(levelFor(0.7), 0.75);
  assert.equal(levelFor(1.8), 1);
  assert.deepEqual(LEVELS, [...LEVELS].sort((a, b) => a - b));
  const g = composeGeometry({ size: 40, crop: 'face', dpr: 2 });
  assert.deepEqual([g.width, g.height, g.level], [80, 80, 0.25]);
  const f = composeGeometry({ size: 460, crop: 'full', dpr: 1 });
  assert.equal(f.height, 460);
  assert.equal(f.width, Math.round((full.w * 460) / full.h));
  assert.equal(f.level, 0.5);
  assert.ok(f.level >= f.scale);
});

test('composeAvatar / peekAvatar without a DOM resolve to null (callers keep the SVG)', async () => {
  assert.equal(await composeAvatar(base), null);
  assert.equal(peekAvatar(base), null);
});
