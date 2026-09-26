// Stage 5.5-A: SVG portrait covers every avatars.json option, expressions, old-avatar fill, 3D pawn mapping,
// customizer tab definitions. Pure modules only (no DOM / WebGL).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../server/data/index.js';
import {
  AVATAR_CROPS,
  AVATAR_EXPRESSIONS,
  normalizeAvatar,
  renderAvatar,
  setAvatarDefs,
} from '../public/js/ui/avatar2d.js';
import { pawnSpecs, resolveAvatar, buildScale, PAWN_COLORS } from '../public/js/scene/pawnParts.js';
import { buildPawnGeometry } from '../public/js/scene/pawn.js';
import {
  COLOR_PARTS,
  THUMB_CROPS,
  buildTabs,
  defaultPreviewRenderer,
  getPreviewRenderer,
  randomizeParts,
  setPreviewRenderer,
} from '../public/js/ui/customize.js';

const defs = loadData('avatars');
setAvatarDefs(defs);
// gradient/clip ids are unique per call → strip them before comparing markup
const norm = (svg) => svg.replace(/av[0-9a-z]+-/g, 'ID-');

test('portrait: every option renders a distinct SVG within its category', () => {
  for (const part of defs.order) {
    const seen = new Map();
    for (const opt of defs.parts[part]) {
      const svg = renderAvatar({ ...defs.default, [part]: opt.id }, { size: 64 });
      assert.match(svg, /^<svg [^>]*viewBox="0 0 100 100"[^>]*>.*<\/svg>$/s, `${part}=${opt.id}`);
      assert.ok(!/undefined|NaN/.test(svg), `${part}=${opt.id} has undefined/NaN`);
      const key = norm(svg);
      assert.ok(!seen.has(key), `${part}=${opt.id} renders like ${seen.get(key)}`);
      seen.set(key, opt.id);
    }
  }
});

test('portrait: colors of color options are used', () => {
  for (const part of ['skin', 'hairColor', 'outfitColor']) {
    for (const opt of defs.parts[part]) {
      const svg = renderAvatar({ ...defs.default, [part]: opt.id });
      assert.ok(svg.includes(opt.color), `${part}=${opt.id} color ${opt.color} unused`);
    }
  }
});

test('portrait: expressions swap the face, neutral keeps the chosen parts', () => {
  const a = { ...defs.default, body: 'girl', eyes: 'cat', mouth: 'cat' };
  const base = norm(renderAvatar(a));
  assert.equal(norm(renderAvatar(a, { expression: 'neutral' })), base);
  assert.equal(norm(renderAvatar(a, { expression: 'bogus' })), base);
  const seen = new Set([base]);
  for (const e of AVATAR_EXPRESSIONS.filter((x) => x !== 'neutral')) {
    const svg = norm(renderAvatar(a, { expression: e }));
    assert.ok(!seen.has(svg), `expression ${e} looks like another one`);
    seen.add(svg);
  }
  // every expression works with every eye style (sweat keeps the eyes)
  for (const eyes of defs.parts.eyes) {
    for (const e of AVATAR_EXPRESSIONS) assert.ok(!/undefined|NaN/.test(renderAvatar({ ...a, eyes: eyes.id }, { expression: e })));
  }
});

test('portrait: old 8-key avatars render with defaults for the new categories', () => {
  const old = { body: 'girl', skin: 'tan', hair: 'bun', hairColor: 'pink', eyes: 'sparkle', accessory: 'ribbon', outfit: 'hanbok', outfitColor: 'green' };
  const filled = normalizeAvatar(old, defs);
  assert.deepEqual(Object.keys(filled).sort(), [...defs.order].sort());
  for (const k of ['build', 'face', 'mouth', 'cheek']) assert.equal(filled[k], defs.default[k]);
  assert.equal(filled.hair, 'bun');
  assert.equal(norm(renderAvatar(old)), norm(renderAvatar(filled)));
  assert.equal(norm(renderAvatar(null)), norm(renderAvatar(defs.default)));
  assert.equal(norm(renderAvatar({ hair: 'mohawk' })), norm(renderAvatar(defs.default)));
});

test('portrait: crop picks a viewBox, bg clips to a circle', () => {
  assert.match(renderAvatar({}, { crop: 'eyes' }), new RegExp(`viewBox="${AVATAR_CROPS.eyes}"`));
  assert.match(renderAvatar({}, { crop: '10 10 50 50' }), /viewBox="10 10 50 50"/);
  assert.match(renderAvatar({}, { crop: '"><script>' }), /viewBox="0 0 100 100"/);
  assert.match(renderAvatar({}, { bg: '#fff' }), /clip-path="url\(#av[0-9a-z]+-k\)"/);
  const t = renderAvatar({}, { title: '<b>"x"</b>' });
  assert.ok(t.includes('aria-label="&lt;b&gt;&quot;x&quot;&lt;/b&gt;"'));
});

test('pawn parts: every option id maps to valid, distinct primitives', () => {
  const SHAPES = new Set(['sphere', 'cyl', 'box', 'cone', 'torus']);
  const finite = (arr) => Array.isArray(arr) && arr.every((v) => typeof v === 'number' && Number.isFinite(v));
  for (const part of defs.order) {
    const seen = new Map();
    for (const opt of defs.parts[part]) {
      const specs = pawnSpecs({ ...defs.default, [part]: opt.id }, defs);
      for (const s of specs) {
        assert.ok(SHAPES.has(s.shape), `${part}=${opt.id} shape ${s.shape}`);
        assert.match(s.color, /^#[0-9a-f]{6}$/i, `${part}=${opt.id} color ${s.color}`);
        assert.ok(finite(s.args) && finite(s.pos) && s.pos.length === 3, `${part}=${opt.id} args/pos`);
        if (s.rot) assert.ok(finite(s.rot) && s.rot.length === 3);
        if (s.scale) assert.ok(finite(s.scale) && s.scale.length === 3);
      }
      const key = JSON.stringify(specs);
      assert.ok(!seen.has(key), `${part}=${opt.id} looks like ${seen.get(key)}`);
      seen.set(key, opt.id);
    }
  }
  for (const part of ['skin', 'hairColor', 'outfitColor']) {
    for (const opt of defs.parts[part]) assert.equal(PAWN_COLORS[part][opt.id], opt.color, `PAWN_COLORS.${part}.${opt.id}`);
  }
  for (const b of defs.parts.build) assert.equal(buildScale(b.id, defs), b.scaleX);
  assert.equal(resolveAvatar({ body: 'girl' }, defs).avatar.build, defs.default.build);
});

test('pawn geometry: every hair × outfit × accessory stays within ~2k triangles', () => {
  let max = 0;
  for (const hair of defs.parts.hair) {
    for (const outfit of defs.parts.outfit) {
      for (const accessory of defs.parts.accessory) {
        const av = { ...defs.default, hair: hair.id, outfit: outfit.id, accessory: accessory.id, face: 'square', cheek: 'freckles', eyes: 'star', build: 'chubby', body: hair.id.length % 2 ? 'girl' : 'boy' };
        const g = buildPawnGeometry(av, defs);
        max = Math.max(max, g.attributes.position.count / 3);
      }
    }
  }
  assert.ok(max <= 2000, `max ${max} triangles`);
});

test('customizer tabs cover every category exactly once', () => {
  const listed = defs.tabs.flatMap((t) => t.parts);
  assert.deepEqual([...listed].sort(), [...defs.order].sort());
  assert.equal(new Set(listed).size, listed.length);
  assert.equal(defs.tabs.length, 5);
  const tabs = buildTabs(defs);
  assert.deepEqual(tabs.map((t) => t.id), defs.tabs.map((t) => t.id));
  // robustness: missing tabs → one tab with everything; duplicates/unknown dropped; leftovers → 기타
  assert.deepEqual(buildTabs({ ...defs, tabs: undefined }).flatMap((t) => t.parts), defs.order);
  const odd = buildTabs({ ...defs, tabs: [{ id: 'a', name: 'A', parts: ['hair', 'hair', 'nope'] }, { id: 'b', name: 'B', parts: ['hair'] }] });
  assert.deepEqual(odd[0].parts, ['hair']);
  assert.equal(odd.length, 2);
  assert.equal(odd[1].name, '기타');
  assert.equal(odd.flatMap((t) => t.parts).length, defs.order.length);
  // every non-color category has a thumbnail crop; color categories have colors
  for (const part of defs.order) {
    if (COLOR_PARTS.includes(part)) assert.ok(defs.parts[part].every((o) => /^#[0-9a-f]{6}$/i.test(o.color)), part);
    else assert.ok(AVATAR_CROPS[THUMB_CROPS[part]], `crop for ${part}`);
  }
});

test('customizer helpers: tab random only touches its parts; preview renderer hook', () => {
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const a = normalizeAvatar({}, defs);
  for (let i = 0; i < 20; i++) {
    const b = randomizeParts(a, ['hair', 'hairColor'], defs, rnd);
    for (const k of defs.order) if (!['hair', 'hairColor'].includes(k)) assert.equal(b[k], a[k]);
    assert.ok(b.hair !== a.hair || b.hairColor !== a.hairColor);
  }
  assert.equal(getPreviewRenderer(), defaultPreviewRenderer);
  const fn = () => '<svg></svg>';
  setPreviewRenderer(fn);
  assert.equal(getPreviewRenderer(), fn);
  setPreviewRenderer(null);
  assert.equal(getPreviewRenderer(), defaultPreviewRenderer);
  assert.match(defaultPreviewRenderer(a, { expression: 'joy', size: 100 }), /width="100"/);
});
