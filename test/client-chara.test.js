// Chiikawa conversion (CH-1) — client 2D: roster / props / NPC friends / pets (shared/roster.js), the SVG character
// renderer (ui/chara.js: distinct rigs per roster id / species, parts with pivots, expressions, props at anchors, crops,
// raster parts plugging in from /api/assets), the rig timing math (ui/rig.js), the lobby picker helpers (ui/picker.js) and
// the §4 wording in the client. Pure modules only (no DOM).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { loadData } from '../server/data/index.js';
import {
  CANVAS,
  DEFAULT_NPCS,
  DEFAULT_PETS,
  DEFAULT_PROPS,
  DEFAULT_ROSTER,
  PROP_SLOTS,
  ROSTER_IDS,
  lookKey,
  lookKind,
  normalizeLook,
  npcInfo,
  petInfo,
  petStages,
  propInfo,
  propList,
  randomLook,
  rosterInfo,
  rosterList,
  sanitizeProps,
} from '../public/js/shared/roster.js';
import { CHARA_EXPRESSIONS, DRAWN_PROPS, FULL_VIEW, charaAnchors, charaSvg, chibiGeom, rasterParts, rasterPrefix } from '../public/js/ui/chara.js';
import {
  ACTIONS,
  BLINK,
  blinkDelay,
  keyPose,
  mouthOpenAt,
  parallaxLayers,
  parallaxOffset,
  partTransform,
  particlesSvg,
  restPose,
  samplePose,
  shakeKeyframes,
  sheetDef,
  spawnParticles,
  spriteBgPos,
  spriteDuration,
  spriteFrame,
  squashStretch,
} from '../public/js/ui/rig.js';
import { autoName, propThumbCrop, propsSummary, randomizeSlot, rosterCardsModel } from '../public/js/ui/picker.js';
import { setAssetIndex } from '../public/js/assets.js';

const META = {
  roster: loadData('roster'),
  props: loadData('props'),
  npcs: loadData('npcs'),
  pets: loadData('pets'),
};
const seeded = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const viewBox = (svg) => svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
const noNaN = (svg, label) => assert.ok(!/NaN|undefined|Infinity/.test(svg), `${label} has NaN/undefined`);

test('roster data: fallbacks mirror the server data (ids fixed, ears, sizes; props / NPC / pet ids and slots)', () => {
  assert.deepEqual(ROSTER_IDS, ['chiikawa', 'hachiware', 'usagi', 'momonga', 'kurimanju', 'rakko', 'shisa', 'pochette']);
  assert.deepEqual(META.roster.characters.map((c) => c.id), ROSTER_IDS);
  for (const c of META.roster.characters) {
    const fb = DEFAULT_ROSTER.find((x) => x.id === c.id);
    assert.equal(fb.ears, c.ears, c.id);
    assert.equal(fb.size, c.size, c.id);
    assert.equal(fb.name, c.name, c.id);
  }
  assert.deepEqual(DEFAULT_PROPS.map((p) => [p.id, p.slot, !!p.choice]), META.props.props.map((p) => [p.id, p.slot, !!p.choice]));
  assert.deepEqual(DEFAULT_NPCS.map((s) => s.id), META.npcs.species.map((s) => s.id));
  assert.deepEqual(DEFAULT_PETS.map((s) => s.id), META.pets.species.map((s) => s.id));
  // the meta wins, the fallback keeps every screen drawable before /api/meta arrives
  assert.equal(rosterList(null).length, 8);
  assert.equal(rosterList({ roster: { characters: [{ id: 'mystery', name: '수수께끼', ears: 'cat', size: 1.1 }] } })[0].id, 'mystery');
  assert.deepEqual(rosterInfo('mystery', { roster: { characters: [{ id: 'mystery', ears: 'cat' }] } }).ears, 'cat');
  assert.equal(rosterInfo('nope', META).id, 'chiikawa');
  assert.equal(npcInfo('bear_cub', META).icon, META.npcs.species.find((s) => s.id === 'bear_cub').icon);
  assert.equal(petInfo('goldfish', META).size, 0.8);
  assert.equal(petStages(META).adult.name, '어른');
});

test('props: choosable list per slot (growth / job props hidden), info with colour / tintable, 30 choices', () => {
  assert.equal(propList(META).length, 30);
  for (const slot of PROP_SLOTS) assert.ok(propList(META, slot).length >= 4, slot);
  assert.ok(!propList(META).some((p) => p.id === 'bonnet' || p.id === 'stethoscope'));
  assert.deepEqual(propInfo('beanie', META).slot, 'head');
  assert.equal(propInfo('beanie', META).tintable, true);
  assert.match(propInfo('beanie', META).color, /^#[0-9a-f]{6}$/i);
  assert.equal(propInfo('cane', META).choice, false);
  assert.equal(propInfo('nope', META), null);
  // every prop of the data has its own painter in the 2D renderer (no generic badge needed for the shipped ids)
  for (const p of META.props.props) assert.ok(DRAWN_PROPS[p.slot].includes(p.id), `${p.slot}.${p.id} drawn`);
});

test('looks: normalize / sanitize / migrate old human avatars / lookKey / randomLook', () => {
  assert.deepEqual(normalizeLook({ character: 'usagi', props: { head: 'ribbon', face: 'crown', hand: 'nope' } }, META), { character: 'usagi', props: { head: 'ribbon' } });
  assert.deepEqual(normalizeLook({ character: 'zzz' }, META), { character: 'chiikawa', props: {} });
  assert.deepEqual(normalizeLook(null, META), { character: 'chiikawa', props: {} });
  assert.deepEqual(sanitizeProps({ head: 'crown', back: 'wings', neck: 'wings' }, META), { head: 'crown', back: 'wings' });
  // old human avatars → a roster character picked by a hash (deterministic) + the accessory as a prop
  const human = { body: 'boy', build: 'normal', hair: 'short', outfit: 'hoodie', accessory: 'glasses' };
  const a = normalizeLook(human, META);
  assert.ok(ROSTER_IDS.includes(a.character));
  assert.deepEqual(a.props, { face: 'round_glasses' });
  assert.deepEqual(normalizeLook({ ...human }, META), a);
  const spread = new Set(Array.from({ length: 40 }, (_, i) => normalizeLook({ ...human, hair: `h${i}` }, META).character));
  assert.ok(spread.size >= 5, `hash spreads over the roster (${spread.size})`);
  assert.equal(lookKind(human), 'legacy');
  assert.equal(lookKind({ npc: 'panda' }), 'npc');
  assert.equal(lookKind({ pet: 'chick' }), 'pet');
  assert.deepEqual(normalizeLook({ npc: 'panda', props: { head: 'ribbon' } }, META), { npc: 'panda', props: { head: 'ribbon' } });
  assert.deepEqual(normalizeLook({ pet: 'snail' }, META), { pet: 'snail' });
  assert.equal(lookKey({ character: 'usagi', props: { hand: 'balloon', head: 'ribbon' } }), 'c:usagi|head=ribbon|hand=balloon');
  assert.equal(lookKey({ pet: 'chick' }), 'p:chick');
  const rnd = seeded(7);
  for (let i = 0; i < 50; i++) {
    const l = randomLook(META, rnd);
    assert.ok(ROSTER_IDS.includes(l.character));
    assert.ok(Object.keys(l.props).length <= 2);
    assert.deepEqual(normalizeLook(l, META), l);
  }
});

test('renderer: every roster character has its own rig (distinct markup), parts with pivots, no NaN', () => {
  const seen = new Map();
  for (const id of ROSTER_IDS) {
    const svg = charaSvg({ character: id, props: {} }, { size: 200, meta: META });
    noNaN(svg, id);
    assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" class="chara-svg"/);
    assert.doesNotMatch(svg, / id="/, `${id}: no ids (many figures share a page)`);
    for (const part of ['root', 'head', 'armL', 'armR', 'earL', 'earR', 'shadow']) {
      if ((part === 'earL' || part === 'earR') && META.roster.characters.find((c) => c.id === id).ears === 'none') continue;
      assert.match(svg, new RegExp(`data-rig="${part}" data-px="[\\d.]+" data-py="[\\d.]+"`), `${id} ${part}`);
    }
    assert.match(svg, /class="ch-eo"/);
    assert.match(svg, /class="ch-ec" display="none"/); // closed eyes hidden without page CSS (group photo images)
    assert.match(svg, /class="ch-mo" display="none"/);
    const info = rosterInfo(id, META);
    assert.ok(svg.includes(info.colors.body) && svg.includes(info.colors.line), `${id} colours`);
    assert.ok(!seen.has(svg), `${id} looks like ${seen.get(svg)}`);
    seen.set(svg, id);
  }
  // signature features: hachiware cap, usagi long ears, momonga / squirrel tails, shisa mane, pochette pouch
  assert.match(charaSvg({ character: 'momonga' }, { meta: META }), /data-rig="tail"/);
  assert.match(charaSvg({ character: 'shisa' }, { meta: META }), /class="ch-mane"/);
  assert.doesNotMatch(charaSvg({ character: 'chiikawa' }, { meta: META }), /data-rig="tail"|ch-mane/);
  // relative sizes: rakko (1.2) stands taller than momonga (0.85) in the shared full view
  const top = (id) => chibiGeom(rosterInfo(id, META).anchors).top;
  assert.ok(top('rakko') < top('chiikawa') && top('chiikawa') < top('momonga'));
  for (const id of ROSTER_IDS) assert.deepEqual(viewBox(charaSvg({ character: id }, { crop: 'full', meta: META })), [FULL_VIEW.x, FULL_VIEW.y, FULL_VIEW.w, FULL_VIEW.h]);
});

test('renderer: NPC friends and pets have their own distinct drawings; unknown species still draw', () => {
  const npc = new Set(META.npcs.species.map((s) => charaSvg({ npc: s.id, props: {} }, { meta: META })));
  assert.equal(npc.size, META.npcs.species.length);
  const pets = new Set(META.pets.species.map((s) => charaSvg({ pet: s.id }, { meta: META })));
  assert.equal(pets.size, META.pets.species.length);
  for (const svg of [...npc, ...pets]) noNaN(svg, 'species');
  assert.match(charaSvg({ pet: 'goldfish' }, { meta: META }), /data-kind="pet"/);
  assert.match(charaSvg({ npc: 'panda', props: { head: 'flower_pin' } }, { meta: META }), /data-chara="n:panda\|head=flower_pin"/);
  noNaN(charaSvg({ pet: 'dragon' }, { meta: META }), 'unknown pet');
  noNaN(charaSvg({ npc: 'dragon' }, { meta: META }), 'unknown npc');
});

test('renderer: expressions swap the face (neutral keeps it), poses bake key poses, line width follows the size', () => {
  for (const id of ['chiikawa', 'usagi', 'kurimanju']) {
    const neutral = charaSvg({ character: id }, { meta: META });
    const faces = new Set([neutral]);
    for (const e of CHARA_EXPRESSIONS.slice(1)) {
      const s = charaSvg({ character: id }, { expression: e, meta: META });
      noNaN(s, `${id} ${e}`);
      faces.add(s);
    }
    assert.equal(faces.size, CHARA_EXPRESSIONS.length, `${id} expressions distinct`);
    assert.equal(charaSvg({ character: id }, { expression: 'bogus', meta: META }), neutral);
  }
  // Chiikawa's crying face: tear streams
  assert.match(charaSvg({ character: 'chiikawa' }, { expression: 'cry', meta: META }), /#9fd6ff/);
  // a baked cheer pose raises both arms (rotations around the shoulders)
  const cheer = charaSvg({ character: 'hachiware' }, { pose: 'cheer', meta: META });
  assert.match(cheer, /data-rig="armL"[^>]*transform="rotate\(1\d\d/);
  assert.match(cheer, /data-rig="armR"[^>]*transform="rotate\(-1\d\d/);
  // small portraits get a thicker line in canvas units (still visible at 26 px)
  const lw = (svg) => Math.max(...[...svg.matchAll(/stroke-width="([\d.]+)"/g)].map((m) => Number(m[1])));
  assert.ok(lw(charaSvg({ character: 'chiikawa' }, { size: 26, crop: 'face', meta: META })) > lw(charaSvg({ character: 'chiikawa' }, { size: 400, meta: META })));
  // crops: face ⊂ bust ⊂ full (square portraits)
  const [fx, fy, fw, fh] = viewBox(charaSvg({ character: 'usagi' }, { crop: 'face', meta: META }));
  const [, , bw] = viewBox(charaSvg({ character: 'usagi' }, { crop: 'bust', meta: META }));
  assert.equal(fw, fh);
  assert.ok(fw < bw && bw < FULL_VIEW.w);
  assert.ok(fx > FULL_VIEW.x && fy > FULL_VIEW.y);
});

test('props sit at the rig anchors: glasses on the eyes, bow tie on the neck, hand items in the right hand, distinct per slot', () => {
  for (const id of ['chiikawa', 'rakko', 'momonga']) {
    const a = charaAnchors({ character: id }, META);
    const glasses = charaSvg({ character: id, props: { face: 'round_glasses' } }, { meta: META });
    const lens = glasses.match(/<circle cx="([\d.]+)" cy="([\d.]+)" r="[\d.]+" fill="#ffffff" fill-opacity=".18"/);
    assert.ok(lens, id);
    assert.ok(Math.abs(Number(lens[2]) - a.face[1]) < 1, `${id} glasses at the eyes`);
    const g = chibiGeom(rosterInfo(id, META).anchors);
    assert.ok(Math.abs(Number(lens[1]) - (CANVAS.cx - g.ex)) < 1);
    const hand = charaSvg({ character: id, props: { hand: 'balloon' } }, { meta: META });
    const pv = hand.match(/data-rig="propR" data-px="([\d.]+)" data-py="([\d.]+)"/);
    assert.ok(Math.abs(Number(pv[1]) - a.handR[0]) < 1 && Math.abs(Number(pv[2]) - a.handR[1]) < 1, `${id} hand prop at handR`);
    // the held item lives inside the right arm group (it swings with the arm)
    assert.ok(hand.indexOf('data-rig="armR"') < hand.indexOf('data-rig="propR"'));
    const bow = charaSvg({ character: id, props: { neck: 'bow_tie' } }, { meta: META });
    const knot = bow.match(/<g class="ch-neck"><path d="M([\d.]+) ([\d.]+)/);
    assert.ok(Math.abs(Number(knot[1]) - a.neck[0]) < 1 && Math.abs(Number(knot[2]) - a.neck[1]) < 1, `${id} bow tie at the neck`);
    // head props ride on the head group (tilt with the head)
    const hat = charaSvg({ character: id, props: { head: 'crown' } }, { meta: META });
    assert.ok(hat.indexOf('data-rig="head"') < hat.indexOf('#f5c542') && hat.indexOf('#f5c542') < hat.indexOf('class="ch-neck"'));
  }
  const base = charaSvg({ character: 'chiikawa', props: {} }, { meta: META });
  for (const slot of PROP_SLOTS) {
    const set = new Set([base]);
    for (const p of META.props.props.filter((x) => x.slot === slot)) {
      const s = charaSvg({ character: 'chiikawa', props: { [slot]: p.id } }, { meta: META });
      noNaN(s, p.id);
      set.add(s);
    }
    assert.equal(set.size, META.props.props.filter((x) => x.slot === slot).length + 1, `${slot} props distinct`);
  }
  // tintable props wear the character's accent colour, others their own colour
  assert.ok(charaSvg({ character: 'hachiware', props: { head: 'beanie' } }, { meta: META }).includes(rosterInfo('hachiware', META).colors.accent));
  assert.ok(charaSvg({ character: 'hachiware', props: { head: 'straw_hat' } }, { meta: META }).includes(propInfo('straw_hat', META).color));
  // an unknown prop id from a newer server: a generic badge with its icon
  const meta2 = { ...META, props: { ...META.props, props: [...META.props.props, { id: 'kite', slot: 'hand', name: '연', icon: '🪁', choice: true }] } };
  assert.match(charaSvg({ character: 'chiikawa', props: { hand: 'kite' } }, { meta: meta2 }), /🪁/);
});

test('raster art plugs in: ch-<id>-base replaces the SVG figure, body + arms keep separate arm pivots, sheets / props', () => {
  try {
    setAssetIndex({
      'ch-usagi-base': { url: '/g/ch/usagi-base.webp', kind: 'chara', meta: { character: 'usagi', part: 'base' } },
      'ch-usagi-eyes-closed': { url: '/g/ch/usagi-eyes-closed.webp', kind: 'chara', meta: { character: 'usagi', part: 'eyes-closed' } },
      'ch-usagi-sheet-jump': { url: '/g/ch/usagi-jump.webp', kind: 'chara', meta: { character: 'usagi', part: 'sheet-jump', grid: [4, 2], frames: 8, fps: 16, loop: false } },
      'ch-hachiware-body': { url: '/g/ch/h-body.webp', kind: 'chara', meta: { character: 'hachiware', part: 'body' } },
      'ch-hachiware-arms': { url: '/g/ch/h-arms.webp', kind: 'chara', meta: { character: 'hachiware', part: 'arms', pivots: { armL: [380, 930], armR: [644, 930] } } },
      'prop-ribbon': { url: '/g/props/ribbon.png', kind: 'prop', width: 256, height: 256, meta: { prop: 'ribbon', slot: 'head', anchor: [128, 200] } },
      'pet-chick-base': { url: '/g/pet/chick.webp', kind: 'chara', meta: { pet: 'chick', part: 'base' } },
    });
    const u = charaSvg({ character: 'usagi', props: { head: 'ribbon' } }, { meta: META });
    assert.match(u, /<image class="ch-r base" href="\/g\/ch\/usagi-base.webp" x="0" y="0" width="1024" height="1536"\/>/);
    assert.match(u, /class="ch-ec" display="none"><image class="ch-r eyes"/);
    assert.match(u, /<image class="ch-prop-img" href="\/g\/props\/ribbon.png"/); // raster prop at the data anchor
    assert.doesNotMatch(u, /class="ch-head-i"/); // the SVG head is gone
    const r = rasterParts({ character: 'usagi' }, META);
    assert.deepEqual(r.sheets.jump, { url: '/g/ch/usagi-jump.webp', grid: [4, 2], frames: 8, fps: 16, loop: false });
    const h = charaSvg({ character: 'hachiware' }, { meta: META });
    assert.match(h, /data-rig="armL" data-px="380" data-py="930"><image class="ch-r arms"[^>]*clip-path="url\(#chc[0-9a-z]+l\)"/);
    assert.match(h, /data-rig="armR" data-px="644" data-py="930"/);
    assert.match(charaSvg({ pet: 'chick' }, { meta: META }), /href="\/g\/pet\/chick.webp"/);
    assert.equal(rasterPrefix({ npc: 'owl' }), 'npc-owl');
    // nothing accepted for chiikawa → the SVG rig
    assert.equal(rasterParts({ character: 'chiikawa' }, META), null);
  } finally {
    setAssetIndex({});
  }
});

test('rig timing: jump = anticipation squash → stretch + airborne → land squash → settle; loops wrap; key poses', () => {
  const t = (ms) => samplePose('jump', ms);
  assert.ok(t(160).root.sy < 0.92 && t(160).root.y === 0, 'anticipation squash on the ground');
  assert.ok(t(250).root.sy > 1.03 && t(250).root.y < 0, 'stretch on take-off');
  assert.ok(t(400).root.y < -200, 'airborne');
  assert.ok(t(400).armL.r > 0 && t(400).armR.r < 0, 'arms up in the air');
  assert.ok(t(665).root.sy < 0.9, 'land squash');
  assert.ok(Math.abs(t(1000).root.sy - 1) < 0.03 && t(1000).root.y === 0, 'settled');
  for (const ms of [0, 160, 250, 400, 665, 800, 1000]) {
    const { sx, sy } = t(ms).root;
    assert.ok(Math.abs(sx * sx * sy - 1) < 1e-9, `volume kept at ${ms}`); // squash & stretch keeps the volume
  }
  for (const a of ['wave', 'cheer', 'cry', 'walk', 'talk']) assert.deepEqual(samplePose(a, 123), samplePose(a, 123 + ACTIONS[a].ms * 3), a);
  assert.ok(samplePose('wave', 250).armR.r < -90, 'wave raises the right arm');
  assert.ok(samplePose('cry', 0).armL.r > 30 && samplePose('cry', 0).mouth === 'open');
  assert.ok(samplePose('shock', 200).root.y < 0 && samplePose('shock', 700).root.y === 0);
  assert.deepEqual(samplePose('idle', 500), restPose());
  assert.deepEqual(keyPose('cheer'), samplePose('cheer', 340));
  const { sx, sy } = squashStretch(0.2);
  assert.ok(sy > 1 && sx < 1);
  // talking: the mouth flaps open / shut
  const beats = Array.from({ length: 10 }, (_, i) => mouthOpenAt(i * 115 + 10));
  assert.ok(beats.includes(true) && beats.includes(false));
  // blink every 2–5 s
  for (const r of [0, 0.5, 0.999]) {
    const d = blinkDelay(() => r);
    assert.ok(d >= BLINK.min && d <= BLINK.max);
  }
  assert.equal(partTransform({}, [1, 2]), '');
  assert.equal(partTransform({ r: 10 }, [512, 1303]), 'rotate(10 512 1303)');
  assert.equal(partTransform({ x: 0, y: -5, sx: 1.1, sy: 0.9 }, [512, 1303]), 'translate(0 -5) translate(512 1303) scale(1.1 0.9) translate(-512 -1303)');
});

test('sprite sheets, particles, shake and parallax helpers', () => {
  const sheet = { frames: 8, fps: 16, loop: false };
  assert.equal(spriteFrame(0, sheet), 0);
  assert.equal(spriteFrame(130, sheet), 2);
  assert.equal(spriteFrame(600, sheet), -1); // finished
  assert.equal(spriteFrame(600, { ...sheet, loop: true }), 1);
  assert.equal(spriteDuration(sheet), 500);
  assert.deepEqual(spriteBgPos(0, [4, 2]), { x: 0, y: 0 });
  assert.deepEqual(spriteBgPos(5, [4, 2]), { x: (1 / 3) * 100, y: 100 });
  assert.equal(sheetDef({ url: '/x', meta: {} }), null);
  assert.deepEqual(sheetDef({ url: '/x', meta: { grid: [3, 1] } }), { url: '/x', grid: [3, 1], frames: 3, fps: 12, loop: true });
  // tears fall from both eyes, deterministic per seed
  const tears = spawnParticles('tear', { n: 6, seed: 4, origins: [[400, 680], [624, 680]] });
  assert.equal(tears.length, 6);
  assert.ok(tears.every((p) => p.dy > 0));
  assert.ok(tears.some((p) => p.x < 512) && tears.some((p) => p.x > 512));
  assert.deepEqual(spawnParticles('tear', { n: 6, seed: 4, origins: [[400, 680], [624, 680]] }), tears);
  assert.ok(spawnParticles('heart', { n: 4 }).every((p) => p.dy < 0));
  const svg = particlesSvg(tears);
  assert.equal((svg.match(/class="ch-pt tear"/g) ?? []).length, 6);
  assert.match(svg, /--dy:[\d.]+px/);
  const kf = shakeKeyframes({ amp: 8, ms: 300 });
  assert.equal(kf.at(-1).transform, 'translate(0px, 0px)');
  for (const d of [0, 0.6, 1]) {
    const o = parallaxOffset(d, 4321);
    assert.ok(Math.abs(o.x) <= 1.6 * d + 1e-9 && o.scale >= 1.04);
  }
  assert.deepEqual(parallaxLayers('office', (id) => (id === 'bg-office-far' || id === 'bg-office-near' ? `/${id}.webp` : null)).map((l) => l.layer), ['far', 'near']);
  assert.deepEqual(parallaxLayers('office', () => null, '/bg.webp').map((l) => l.layer), ['single']);
  assert.deepEqual(parallaxLayers('office', () => null), []);
});

test('picker helpers: prop thumbnail crops, slot random, the name follows the character until typed, cards', () => {
  assert.equal(propThumbCrop('head'), 'head');
  assert.equal(propThumbCrop('face'), 'face');
  assert.equal(propThumbCrop('neck'), 'bust');
  assert.equal(propThumbCrop('hand'), 'fit');
  const look = { character: 'usagi', props: { head: 'ribbon', hand: 'balloon' } };
  const rnd = seeded(11);
  for (let i = 0; i < 30; i++) {
    const next = randomizeSlot(look, 'head', META, rnd);
    assert.equal(next.props.hand, 'balloon');
    assert.notEqual(next.props.head ?? null, 'ribbon');
    if (next.props.head) assert.equal(propInfo(next.props.head, META).slot, 'head');
  }
  assert.equal(autoName('', null, look, META), '우사기');
  assert.equal(autoName('우사기', look, { character: 'shisa' }, META), '시사'); // untouched auto name follows
  assert.equal(autoName('토끼왕', look, { character: 'shisa' }, META), '토끼왕'); // typed name stays
  const cards = rosterCardsModel(look, META);
  assert.equal(cards.length, 8);
  assert.deepEqual(cards.filter((c) => c.on).map((c) => c.id), ['usagi']);
  assert.deepEqual(propsSummary(look, META), ['🎀 리본', '🎈 풍선']);
});

test('client wording (§4): no human-family words left in the client code / markup (legacy human-avatar modules excepted)', () => {
  const OLD = /결혼|자녀|출산|육아|프러포즈|배우자|맞벌이|축의금|돌잔치|돌잡이|신랑|신부|남편|아내|아들|남자|여자|임신/;
  const LEGACY = new Set(['avatar2d.js', 'avatarCompose.js', 'customize.js', 'charArt.js']);
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (e.name !== 'scene' && e.name !== 'vendor' && e.name !== 'assets') walk(`${dir}${e.name}/`);
      } else if (/\.(js|html|css)$/.test(e.name) && !LEGACY.has(e.name)) files.push(`${dir}${e.name}`);
    }
  };
  walk('../public/');
  assert.ok(files.length > 30);
  for (const f of files) {
    const text = readFileSync(new URL(f, import.meta.url), 'utf8');
    const m = text.match(OLD);
    assert.ok(!m, `${f}: 「${m?.[0]}」`);
  }
});
