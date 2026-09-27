import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  KINDS,
  MANIFEST_PATH,
  STYLE,
  loadManifest,
  outputsFor,
  renderPrompt,
  topoOrder,
  validateItem,
  validateManifest,
} from '../server/assets/manifest.js';

const HANGUL = /[가-힣]/;
const base = () => ({
  id: 'x-item',
  kind: 'bg',
  label: '테스트',
  aspect: '16:9',
  prompt: '{{style}} a test scene prompt',
  refs: [],
  output: 'bg/x.webp',
  postprocess: ['webp'],
  status: 'todo',
});

test('shipped manifest validates and holds the Stage 3 seed set', async () => {
  const m = await loadManifest();
  assert.equal(validateManifest(m).ok, true);
  const count = (k) => m.items.filter((i) => i.kind === k).length;
  assert.equal(count('anchor'), 1);
  assert.equal(count('bg'), 19); // 5 event scenes + the MC studio (Stage 5.6) + 11 Stage 7 scenes (stage … holiday) + Stage 8 park / house
  assert.equal(count('charLayer'), 8); // base + 4 expressions + 3 outfits
  assert.equal(count('pose'), 6);
  assert.ok(count('sprite') >= 1);
  assert.equal(count('icon'), 12 + 23); // tile icons + Stage 7 job badges (icon-job-<id>)
  assert.equal(count('card'), 16);
  assert.equal(count('item'), 6);
  assert.equal(count('texture'), 2);
  assert.equal(count('frame'), 7);
  for (const scene of ['school', 'mountain-trail', 'wedding-hall', 'office', 'hospital']) {
    assert.ok(m.items.some((i) => i.kind === 'bg' && i.meta?.scene === scene), scene);
  }
  for (const pose of ['idle', 'wave', 'jump', 'cheer', 'cry', 'shock']) {
    assert.ok(m.items.some((i) => i.kind === 'pose' && i.meta?.pose === pose), pose);
  }
  assert.equal(topoOrder(m.items)[0].id, 'style-anchor');
  for (const i of m.items) {
    assert.ok(KINDS.includes(i.kind));
    assert.match(i.label, HANGUL, `${i.id} label should be Korean`);
    const p = renderPrompt(i.kind === 'sprite' ? { ...i, vars: { ...i.vars, frame: i.frames[0].prompt } } : i);
    assert.doesNotMatch(p, HANGUL, `${i.id} prompt should be English`);
    assert.doesNotMatch(p, /\{\{/, `${i.id} has unexpanded template vars`);
    if (i.kind !== 'texture') assert.ok(p.includes(STYLE), `${i.id} uses the style bible`);
    if (i.kind === 'icon' || i.kind === 'card' || i.kind === 'item') {
      assert.equal(i.aspect, '1:1');
      assert.ok(i.postprocess.includes('whiteToAlpha'));
    }
    if (i.kind === 'charLayer' || i.kind === 'pose') assert.ok(i.postprocess.includes('chromaKey'));
    if (i.kind !== 'anchor') assert.ok(i.refs.length || ['texture', 'frame'].includes(i.kind), `${i.id} refs`);
  }
  // The shipped file must be committed with no accepted secrets/paths outside generated/.
  const text = await readFile(MANIFEST_PATH, 'utf8');
  assert.doesNotMatch(text, /AIza/);
});

test('sprite items expand the per-frame prompt and publish sheet + json + anim', async () => {
  const m = await loadManifest();
  const sp = m.items.find((i) => i.kind === 'sprite');
  assert.ok(sp.frames.length >= 2);
  const outs = outputsFor(sp);
  assert.equal(outs.length, 3);
  assert.ok(outs[1].endsWith('.json') && outs[2].endsWith('.anim.webp'));
  const p = renderPrompt({ ...sp, vars: { frame: sp.frames[0].prompt } });
  assert.ok(p.includes(sp.frames[0].prompt));
});

test('validateItem rejects malformed items', () => {
  assert.deepEqual(validateItem(base()), []);
  const bad = (patch) => validateItem({ ...base(), ...patch });
  assert.ok(bad({ kind: 'movie' }).length);
  assert.ok(bad({ id: 'Bad Id!' }).length);
  assert.ok(bad({ aspect: '7:3' }).length);
  assert.ok(bad({ output: '../../etc/passwd.png' }).length);
  assert.ok(bad({ output: '/abs/x.png' }).length);
  assert.ok(bad({ output: 'bg/x.gif' }).length);
  assert.ok(bad({ postprocess: ['rm -rf'] }).length);
  assert.ok(bad({ status: 'done' }).length);
  assert.ok(bad({ status: 'accepted' }).length, 'accepted needs accepted.file');
  assert.equal(bad({ status: 'accepted', accepted: { file: 'bg/x.webp', generatedAt: 'now' } }).length, 0);
  assert.ok(bad({ prompt: '{{nope}} unknown template variable' }).length);
  assert.ok(bad({ refs: ['x-item'] }).length, 'self reference');
  assert.ok(bad({ frames: [{ id: 'a', prompt: 'x' }] }).length, 'frames only for sprites');
  assert.ok(bad({ kind: 'sprite', frames: [{ id: 'a', prompt: 'x' }] }).length, 'sprite needs >= 2 frames');
});

test('validateManifest checks duplicates, unknown refs and cycles', () => {
  const a = { ...base(), id: 'a', output: 'a.png' };
  const b = { ...base(), id: 'b', output: 'b.png', refs: ['a'] };
  assert.equal(validateManifest({ items: [a, b] }).ok, true);
  assert.equal(validateManifest({ items: [a, { ...a }] }).ok, false);
  assert.equal(validateManifest({ items: [a, { ...b, output: 'a.png' }] }).ok, false);
  const missing = validateManifest({ items: [a, { ...b, refs: ['zzz'] }] });
  assert.equal(missing.ok, false);
  assert.match(missing.errors.join(), /zzz/);
  const cyc = validateManifest({ items: [{ ...a, refs: ['b'] }, b] });
  assert.equal(cyc.ok, false);
  assert.match(cyc.errors.join(), /순환/);
  assert.equal(validateManifest({}).ok, false);
});

test('topoOrder places refs first', () => {
  const items = [
    { id: 'c', refs: ['b'] },
    { id: 'b', refs: ['a'] },
    { id: 'a', refs: [] },
  ];
  assert.deepEqual(topoOrder(items).map((i) => i.id), ['a', 'b', 'c']);
});
