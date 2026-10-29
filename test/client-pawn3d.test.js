// CH-1 (client 3D): Chiikawa-style roster pawns from primitives — every roster id, props at their anchors, growth props,
// colours from the data, the triangle budget (≤ 2000 per pawn with heavy prop combos) and the legacy human path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ROSTER_IDS, PROP_SLOTS, PROP_BUILDER_IDS, charaSpecs, charaFrame, charaHeight, rosterEntry, propSpecs, propBuilderId,
  propColor, specTriangles, paintColor, bumpFactor, faceRot, axisRot, rotateXYZ, pawnSpecs, pawnLook, isHumanAvatar, lookKey,
} from '../public/js/scene/pawnParts.js';
import { buildPawnGeometry, buildSpecsGeometry, pawnHeight } from '../public/js/scene/pawn.js';
import { effectiveLook, normalizeLook as rosterNormalize } from '../public/js/shared/roster.js';

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../server/data/${f}`, import.meta.url)));
const meta = { roster: read('roster.json'), props: read('props.json'), jobs: read('jobs.json'), avatars: read('avatars.json') };
const PROPS = meta.props.props;
const SHAPES = new Set(['sphere', 'cyl', 'box', 'cone', 'torus']);
const BUDGET = 2000;
const tris = (look, opts) => buildPawnGeometry(look, meta, opts).userData.triangles;
const close = (a, b, eps = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < eps);

test('roster: the data has the 8 fixed ids and every one builds a distinct, valid pawn', () => {
  assert.deepEqual(meta.roster.characters.map((c) => c.id), ROSTER_IDS);
  const seen = new Map();
  for (const id of ROSTER_IDS) {
    for (const defs of [meta, null]) {
      const specs = charaSpecs({ character: id, props: {} }, defs);
      assert.ok(specs.length >= 14 && specs.length < 60, `${id}: ${specs.length} specs`);
      for (const s of specs) {
        assert.ok(SHAPES.has(s.shape), `${id} shape ${s.shape}`);
        assert.match(s.color, /^#[0-9a-f]{6}$/i, `${id} colour ${s.color}`);
        assert.equal(s.pos.length, 3);
        assert.ok(s.pos.every(Number.isFinite) && (s.rot ?? [0, 0, 0]).every(Number.isFinite) && (s.scale ?? [1, 1, 1]).every(Number.isFinite), `${id} finite`);
      }
    }
    const key = JSON.stringify(charaSpecs({ character: id }, meta));
    assert.ok(!seen.has(key), `${id} looks like ${seen.get(key)}`);
    seen.set(key, id);
  }
});

test('roster: colours, ears and size come from the data (a swapped entry needs no code)', () => {
  for (const c of meta.roster.characters) {
    const e = rosterEntry(c.id, meta);
    assert.equal(e.ears, c.ears);
    assert.equal(e.colors.body, c.colors.body);
    const specs = charaSpecs({ character: c.id }, meta);
    assert.ok(specs.some((s) => s.part === 'body' && s.color === c.colors.body), `${c.id} body colour`);
    assert.ok(specs.some((s) => s.color === c.colors.blush), `${c.id} blush`);
    // size scales the figure about the feet
    assert.ok(Math.abs(charaHeight({ character: c.id }, meta) / charaHeight({ character: c.id }, { roster: { characters: [{ ...c, size: 1 }] } }) - c.size) < 0.02, `${c.id} size`);
  }
  // patterns / features in the accent colour
  const acc = (id) => meta.roster.characters.find((c) => c.id === id).colors.accent;
  assert.equal(charaSpecs({ character: 'hachiware' }, meta).find((s) => s.paint?.type === 'cap').paint.color, acc('hachiware'));
  assert.equal(charaSpecs({ character: 'kurimanju' }, meta).find((s) => s.paint?.type === 'glaze').paint.color, acc('kurimanju'));
  for (const id of ['shisa', 'momonga', 'pochette']) assert.ok(charaSpecs({ character: id }, meta).some((s) => s.color === acc(id)), `${id} accent feature`);
  assert.ok(charaSpecs({ character: 'shisa' }, meta).some((s) => s.bump), 'shisa mane is scalloped');
  assert.ok(charaSpecs({ character: 'usagi' }, meta).filter((s) => s.part === 'ears').every((s) => s.scale[1] > 2), 'usagi long ears');
  assert.ok(charaHeight({ character: 'usagi' }, meta) > charaHeight({ character: 'chiikawa' }, meta) + 0.4);
  // a data-swapped roster entry (same id, other ears / colours) changes the pawn without code
  const swapped = { roster: { characters: meta.roster.characters.map((c) => (c.id === 'pochette' ? { ...c, ears: 'rabbit', colors: { ...c.colors, body: '#123456' } } : c)) } };
  const sp = charaSpecs({ character: 'pochette' }, swapped);
  assert.ok(sp.some((s) => s.color === '#123456') && sp.filter((s) => s.part === 'ears' && s.scale?.[1] > 2).length === 2);
  assert.notEqual(lookKey({ character: 'pochette' }, swapped), lookKey({ character: 'pochette' }, meta));
});

test('Momonga: tall ears with sky-blue insides, a sky-blue nose, a big sky-blue plume tail on +x behind, no membrane', () => {
  const c = meta.roster.characters.find((x) => x.id === 'momonga');
  const e = rosterEntry('momonga', meta);
  const f = charaFrame(e);
  assert.equal(e.ears, 'tall');
  assert.ok(!e.feat.membrane, 'no membrane feature');
  assert.equal(e.feat.eyes, 'pleading');
  const specs = charaSpecs({ character: 'momonga' }, meta);
  // no gliding-membrane flaps beside the body (accent shapes at the body sides)
  assert.ok(!specs.some((s) => s.part === 'ears' && s.tag !== 'tail' && s.color === c.colors.accent && Math.abs(s.pos[1] - f.body.y * e.size) < 0.25 && s.pos[2] > -0.15), 'no membrane flaps');
  // the plume: accent-coloured, behind the body, on the +x side, rising from body level to above the head centre
  const tail = specs.filter((s) => s.tag === 'tail');
  assert.ok(tail.length >= 3);
  const main = tail.filter((s) => s.color === c.colors.accent);
  assert.ok(main.length >= 2 && main.every((s) => s.pos[0] > 0.3 * e.size && s.pos[2] < 0), 'tail on +x behind');
  assert.ok(Math.max(...main.map((s) => s.pos[1])) > f.head.y * e.size, 'tail as tall as the figure');
  assert.ok(tail.some((s) => s.color === c.colors.extra), 'fur strokes in extra');
  // nose in the accent colour on the face, between the eyes and the mouth
  const nose = specs.find((s) => s.tag === 'nose');
  assert.ok(nose && nose.color === c.colors.accent && Math.abs(nose.pos[0]) < 1e-6);
  assert.ok(nose.pos[1] < f.eye.y * e.size && nose.pos[1] > f.mouthY * e.size);
  // ears: tall cones with an accent inner cone; the crown sits well above the head top
  const ears = specs.filter((s) => s.part === 'ears' && s.shape === 'cone');
  assert.equal(ears.length, 4);
  assert.equal(ears.filter((s) => s.color === c.colors.accent).length, 2);
  assert.ok(f.crown - f.top > charaFrame(rosterEntry('hachiware', meta)).crown - charaFrame(rosterEntry('hachiware', meta)).top);
  // big eyes (bigger than the dot eyes) with two white sparkles each
  assert.ok(f.eye.r > charaFrame(rosterEntry('chiikawa', meta)).eye.r * 1.5);
  assert.equal(specs.filter((s) => s.part === 'face' && s.color === '#ffffff').length, 4);
});

test('paint patterns: Hachiware split cap, bun glaze, scallops', () => {
  const cap = { type: 'cap', color: '#5f7fa8' };
  const n = (x, y, z) => {
    const l = Math.hypot(x, y, z);
    return [x / l, y / l, z / l];
  };
  assert.equal(paintColor(cap, ...n(0, 0.85, 0.5)), null, 'the split runs up to the crown');
  assert.equal(paintColor(cap, ...n(0, 0.2, -0.9)), '#5f7fa8', 'cap at the back');
  assert.equal(paintColor(cap, ...n(0.5, 0.8, 0.1)), '#5f7fa8', 'cap on the top');
  assert.equal(paintColor(cap, ...n(0.9, 0.3, 0.2)), '#5f7fa8', 'cap on the sides');
  assert.equal(paintColor(cap, ...n(0, 0.35, 0.9)), null, 'white split on the forehead');
  assert.equal(paintColor(cap, ...n(0.6, 0.35, 0.7)), '#5f7fa8', 'cap beside the split');
  assert.equal(paintColor(cap, ...n(0.3, -0.2, 0.93)), null, 'white face');
  assert.equal(paintColor({ type: 'glaze', color: '#8a5a32' }, 0, 1, 0), '#8a5a32');
  assert.equal(paintColor({ type: 'glaze', color: '#8a5a32' }, 0, -0.2, 0.98), null);
  assert.equal(paintColor(null, 0, 1, 0), null);
  const b = { n: 7, amp: 0.16 };
  assert.ok(Math.abs(bumpFactor(b, 1, 0, 0) - 1.16) < 1e-9);
  const lobes = Array.from({ length: 70 }, (_, i) => bumpFactor(b, Math.cos((i / 70) * Math.PI * 2), 0, Math.sin((i / 70) * Math.PI * 2)));
  assert.ok(Math.min(...lobes) < 1.02 && Math.max(...lobes) > 1.15);
});

test('orientation helpers turn local axes onto the requested directions', () => {
  for (const d of [[0, 0, 1], [1, 0, 0], [0.3, -0.5, 0.8], [-0.6, 0.2, 0.1], [0, 1, 0.0001]]) {
    const l = Math.hypot(...d);
    const u = d.map((v) => v / l);
    assert.ok(close(rotateXYZ([0, 0, 1], faceRot(d)), u, 1e-6), `faceRot ${d}`);
    assert.ok(close(rotateXYZ([0, 1, 0], axisRot(d)), u, 1e-6), `axisRot ${d}`);
  }
  // spin keeps the facing direction
  assert.ok(close(rotateXYZ([0, 0, 1], faceRot([0.2, 0.1, 1], [0, 1, 0], Math.PI)), [0.2, 0.1, 1].map((v) => v / Math.hypot(0.2, 0.1, 1)), 1e-6));
});

test('props: every props.json / era / job prop id has its own primitive builder', () => {
  const ids = new Set(PROPS.map((p) => p.id));
  for (const era of Object.values(meta.props.eraProps)) for (const [slot, id] of Object.entries(era)) if (slot !== 'job') ids.add(id);
  for (const job of Object.values(meta.props.jobProps)) for (const id of Object.values(job)) ids.add(id);
  for (const j of meta.jobs.jobs) for (const id of Object.values(j.props ?? {})) ids.add(id);
  for (const id of Object.values(meta.jobs.partTime?.props ?? {})) ids.add(id);
  for (const id of ids) assert.ok(PROP_BUILDER_IDS.includes(id), `no 3D builder for prop ${id}`);
  // unknown ids fall back to a generic shape per slot (never throw)
  for (const slot of PROP_SLOTS) {
    assert.notEqual(propBuilderId('mystery_thing', slot), 'mystery_thing');
    assert.ok(propSpecs('mystery_thing', slot, charaFrame(rosterEntry('chiikawa', meta)), meta).length > 0);
  }
});

test('props: drawn at their slot anchors on every character', () => {
  for (const id of ROSTER_IDS) {
    const e = rosterEntry(id, meta);
    const f = charaFrame(e);
    for (const p of PROPS) {
      const specs = propSpecs(p.id, p.slot, f, meta, e);
      assert.ok(specs.length && specs.every((s) => s.part === `prop:${p.slot}`), `${id}/${p.id}`);
      // centroid of the prop's real geometry (vertex mean)
      const pos = buildSpecsGeometry(specs, { outline: false }).attributes.position;
      const [mx, my, mz] = [0, 1, 2].map((i) => Array.from({ length: pos.count }, (_, k) => pos.array[k * 3 + i]).reduce((a, b) => a + b, 0) / pos.count);
      const at = `${id}/${p.id} (${mx.toFixed(2)}, ${my.toFixed(2)}, ${mz.toFixed(2)})`;
      if (p.slot === 'head') assert.ok(my > f.head.y - 0.05, `head ${at}`);
      if (p.slot === 'face') assert.ok(mz > f.head.rz * 0.6 && Math.abs(my - f.eye.y) < 0.2, `face ${at}`);
      if (p.slot === 'neck') assert.ok(my < f.neck.y + 0.08 && my > f.body.y - 0.2, `neck ${at}`);
      if (p.slot === 'hand') assert.ok(mx < -0.15, `hand ${at}`);
      if (p.slot === 'back') assert.ok(mz < -f.body.rz * 0.35, `back ${at}`);
    }
  }
});

test('props: tintable props wear the character accent, others the data colour', () => {
  for (const id of ROSTER_IDS) {
    const e = rosterEntry(id, meta);
    for (const p of PROPS) {
      const want = p.tintable && e.colors.accent ? e.colors.accent : p.color;
      assert.equal(propColor(p.id, meta, e), want, `${id}/${p.id}`);
      assert.ok(propSpecs(p.id, p.slot, charaFrame(e), meta, e).some((s) => s.color === want || s.paint?.color === want), `${id}/${p.id} uses ${want}`);
    }
  }
});

test('growth props: effectiveLook (roster.js) era / job props show up on the pawn', () => {
  const room = { status: 'playing', config: {}, board: { eras: [{ id: 'baby' }, { id: 'elem' }, { id: 'young' }, { id: 'senior' }] } };
  const base = { avatar: { character: 'hachiware', props: { head: 'ribbon', hand: 'balloon' } } };
  const cases = [
    [{ ...base, era: 'baby' }, { head: 'bonnet', face: 'pacifier', hand: 'balloon' }],
    [{ ...base, era: 'senior' }, { head: 'knit_cap', hand: 'cane' }],
    [{ ...base, era: 'young', job: { id: 'doctor', rank: 1 } }, { head: 'head_mirror', neck: 'stethoscope', hand: 'balloon' }],
    [{ ...base, era: 'young', job: { id: 'astronaut', rank: 1 } }, { head: 'space_helmet' }],
  ];
  for (const [character, want] of cases) {
    const look = effectiveLook(character, { room, jobs: meta.jobs, props: meta.props });
    for (const [slot, pid] of Object.entries(want)) assert.equal(look.props[slot], pid, `${character.era} ${slot}`);
    const specs = charaSpecs(look, meta);
    for (const slot of Object.keys(want)) assert.ok(specs.some((s) => s.part === `prop:${slot}`), `${character.era} draws ${slot}`);
    assert.ok(tris(look) <= BUDGET);
  }
});

test('budget: ≤ 2000 triangles per pawn for every roster id with the heaviest props (and random combos)', () => {
  const bySlot = Object.fromEntries(PROP_SLOTS.map((slot) => [slot, PROPS.filter((p) => p.slot === slot)]));
  const f = charaFrame(rosterEntry('chiikawa', meta));
  const weight = (p) => propSpecs(p.id, p.slot, f, meta).reduce((a, s) => a + specTriangles(s), 0);
  const heavy = Object.fromEntries(PROP_SLOTS.map((slot) => [slot, bySlot[slot].reduce((a, b) => (weight(b) > weight(a) ? b : a)).id]));
  // a few seeded random full combos too
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const combos = [{}, heavy, ...Array.from({ length: 6 }, () => Object.fromEntries(PROP_SLOTS.map((slot) => [slot, bySlot[slot][Math.floor(rnd() * bySlot[slot].length)].id])))];
  let max = 0;
  for (const id of ROSTER_IDS) {
    for (const props of combos) {
      const look = { character: id, props };
      const n = tris(look);
      max = Math.max(max, n);
      assert.ok(n <= BUDGET, `${id} ${JSON.stringify(props)}: ${n} triangles`);
      // the spec estimate matches the real geometry (outline hulls included)
      assert.equal(charaSpecs(look, meta).reduce((a, s) => a + specTriangles(s), 0), n, `${id} estimate`);
    }
    assert.ok(tris({ character: id }) < 1400, `${id} bare`);
  }
  assert.ok(max > 1500, `the heavy combo is really heavy (${max})`);
});

test('geometry: one merged vertex-coloured mesh with an inverted-hull outline in the line colour', () => {
  const look = { character: 'chiikawa', props: { head: 'ribbon' } };
  const g = buildPawnGeometry(look, meta);
  for (const a of ['position', 'normal', 'color']) assert.ok(g.attributes[a], a);
  assert.equal(g.index, null);
  assert.equal(buildPawnGeometry(look, meta), g, 'cached per look');
  const noOutline = buildPawnGeometry(look, meta, { outline: false });
  const hull = charaSpecs(look, meta).filter((s) => s.outline).reduce((a, s) => a + specTriangles(s) / 2, 0);
  assert.equal(g.userData.triangles - noOutline.userData.triangles, hull);
  const line = meta.roster.characters[0].colors.line;
  const c = g.attributes.color;
  const hex = (i) => `#${[c.getX(i), c.getY(i), c.getZ(i)].map((v) => Math.round(Math.min(1, Math.max(0, v ** (1 / 2.2))) * 255).toString(16).padStart(2, '0')).join('')}`;
  let hits = 0;
  for (let i = 0; i < c.count; i += 3) if (hex(i).slice(1, 3) === line.slice(1, 3)) hits++;
  assert.ok(hits > 100, `outline vertices in the line colour (${hits})`);
  // flipped faces (cape inner side) and paint give extra colours without breaking the merge
  const cape = buildSpecsGeometry(charaSpecs({ character: 'hachiware', props: { back: 'cape' } }, meta));
  assert.ok(cape.userData.triangles > 0);
  // heights: the name tag clears ears / hats
  assert.ok(pawnHeight({ character: 'usagi' }, meta) > pawnHeight({ character: 'chiikawa' }, meta));
  assert.ok(pawnHeight({ character: 'chiikawa', props: { head: 'party_hat' } }, meta) > pawnHeight({ character: 'chiikawa' }, meta));
});

test('looks: legacy human avatars keep the old pawn in pawnSpecs; game paths normalise like the 2D renderer', () => {
  const human = { ...meta.avatars.default, hair: 'bob', accessory: 'glasses' };
  assert.equal(isHumanAvatar(human), true);
  assert.equal(isHumanAvatar({ character: 'usagi', props: {} }), false);
  const legacy = pawnSpecs(human, meta.avatars);
  assert.ok(legacy.every((s) => !s.part), 'legacy human specs');
  assert.deepEqual(pawnLook(human, meta), rosterNormalize(human, meta));
  assert.equal(pawnLook(human, meta).props.face, 'round_glasses');
  // unknown character → default; npc / pet looks → a roster figure; null → default
  assert.equal(pawnLook({ character: 'nope' }, meta).character, meta.roster.default);
  assert.ok(ROSTER_IDS.includes(pawnLook({ npc: 'panda' }, meta).character));
  assert.equal(pawnLook(null, meta).character, meta.roster.default);
  assert.ok(pawnSpecs(null, meta).some((s) => s.part === 'body'));
  // the old avatars.json defs still work as defs (fallbacks)
  assert.ok(buildPawnGeometry({ character: 'shisa', props: { head: 'crown' } }, meta.avatars).userData.triangles > 500);
});
