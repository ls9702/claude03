import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../server/data/index.js';
import {
  BASE_PALETTE,
  POSES,
  autoAdvanceMs,
  avatarPalette,
  expressionFor,
  hueFilterFor,
  isBigWin,
  layerPlan,
  planCutins,
  poseFor,
  recolorPixels,
  rgbToHsl,
  sfxForEvent,
  tagLabel,
} from '../public/js/ui/cutinMap.js';
import { createAnimator, planSteps } from '../public/js/scene/animator.js';

const defs = loadData('avatars');
const tones = loadData('tones');

test('expressionFor: emotion → expression layer + procedural overlay', () => {
  assert.deepEqual(expressionFor('joy'), { layer: 'joy', overlay: null });
  assert.deepEqual(expressionFor('cry'), { layer: 'cry', overlay: 'tears' });
  assert.deepEqual(expressionFor('shock'), { layer: 'shock', overlay: null });
  assert.deepEqual(expressionFor('angry'), { layer: 'angry', overlay: null });
  assert.deepEqual(expressionFor('love'), { layer: null, overlay: 'heart' });
  assert.deepEqual(expressionFor('sweat'), { layer: null, overlay: 'sweat' });
  assert.deepEqual(expressionFor('neutral'), { layer: null, overlay: null });
  assert.deepEqual(expressionFor(undefined), { layer: null, overlay: null });
});

test('poseFor: event type / tone / emotion → keypose', () => {
  assert.equal(poseFor({ type: 'spun' }), 'wave');
  assert.equal(poseFor({ type: 'moved' }), 'wave');
  assert.equal(poseFor({ type: 'finished', place: 2 }), 'cheer');
  assert.equal(poseFor({ type: 'gameOver' }), 'cheer');
  assert.equal(poseFor({ type: 'landed', tone: 'bad', emotion: 'cry' }, { delta: -20 }), 'cry');
  assert.equal(poseFor({ type: 'landed', tone: 'bad', emotion: 'neutral' }, { delta: -20 }), 'cry');
  assert.equal(poseFor({ type: 'landed', tone: 'bad', emotion: 'shock' }, { delta: -90 }), 'shock');
  assert.equal(poseFor({ type: 'landed', tone: 'bad', emotion: 'sweat' }, { delta: -2 }), 'idle'); // sweat overlay instead
  assert.equal(poseFor({ type: 'landed', tone: 'good', emotion: 'joy' }, { delta: 30 }), 'jump');
  assert.equal(poseFor({ type: 'landed', tone: 'treasure', emotion: 'joy' }, { delta: 30 }), 'jump');
  assert.equal(poseFor({ type: 'eraChanged', tone: 'good', emotion: 'joy' }), 'wave');
  assert.equal(poseFor({ type: 'routeChosen', tone: 'love', emotion: 'joy' }), 'cheer');
  assert.equal(poseFor({ type: 'landed', tone: 'love', emotion: 'love' }), 'idle');
  assert.equal(poseFor(null), 'idle');
  for (const t of ['turnStarted', 'spun', 'moved', 'landed', 'eraChanged', 'routeChosen', 'finished', 'prompt', 'promptResolved', 'gameOver']) {
    assert.ok(POSES.includes(poseFor({ type: t })), t);
  }
  assert.equal(isBigWin({ type: 'landed' }, 150), true);
  assert.equal(isBigWin({ type: 'landed' }, 20), false);
  assert.equal(isBigWin({ type: 'finished', place: 1 }, 0), true);
});

test('layerPlan: outfit > pose > expression > base, with overlays', () => {
  const avail = {
    base: 'base.png',
    expressions: { joy: 'joy.png', cry: 'cry.png' },
    outfits: { doctor: 'doctor.png' },
    poses: { idle: 'idle.png', wave: 'wave.png', cry: 'pcry.png' },
  };
  assert.equal(layerPlan(avail, { pose: 'wave', emotion: 'joy', outfit: 'doctor' }).url, 'doctor.png');
  assert.equal(layerPlan(avail, { pose: 'wave', emotion: 'joy' }).url, 'wave.png');
  assert.deepEqual(layerPlan(avail, { pose: 'cry', emotion: 'cry' }), { url: 'pcry.png', source: 'pose', pose: 'cry', overlay: null });
  assert.equal(layerPlan(avail, { pose: 'jump', emotion: 'joy' }).url, 'joy.png'); // no jump pose → expression
  assert.deepEqual(layerPlan(avail, { pose: 'idle', emotion: 'love' }), { url: 'idle.png', source: 'base', pose: 'idle', overlay: 'heart' });
  assert.equal(layerPlan(avail, { pose: 'idle', emotion: 'sweat' }).overlay, 'sweat');
  assert.equal(layerPlan({}, { pose: 'wave' }).url, null);
  assert.equal(layerPlan({ base: 'b.png' }, {}).url, 'b.png');
});

test('planCutins: anchors with cutin:true (not prompts) collect their money/log follow-ups', () => {
  const events = [
    { type: 'spun', charId: 'c1', cutin: false },
    { type: 'moved', charId: 'c1', cutin: false },
    { type: 'eraChanged', charId: 'c1', era: 'elem', eraName: '초등학생', cutin: true, tone: 'good' },
    { type: 'log', text: '🌱 시대 시작', charId: 'c1', cutin: false },
    { type: 'landed', charId: 'c1', tileType: 'event', cutin: true, tone: 'good' },
    { type: 'moneyChanged', charId: 'c1', delta: 150, reason: 'event', cutin: false },
    { type: 'log', text: '❗ 대박', charId: 'c1', cutin: false },
    { type: 'landed', charId: 'c2', tileType: 'money', cutin: false },
    { type: 'moneyChanged', charId: 'c2', delta: 30, reason: 'tile', cutin: false },
    { type: 'prompt', charId: 'c1', kind: 'exam', cutin: true },
    { type: 'promptResolved', charId: 'c3', kind: 'groupGift', cutin: true },
    { type: 'moneyChanged', charId: 'c4', delta: -10, reason: 'gift', cutin: false },
    { type: 'moneyChanged', charId: 'c3', delta: 10, reason: 'gift', cutin: false },
    { type: 'turnStarted', charId: 'c2', cutin: false },
    { type: 'gameOver', ranking: [{ charId: 'c2' }, { charId: 'c1' }], cutin: true },
  ];
  const g = planCutins(events);
  assert.deepEqual(g.map((x) => x.anchor.type), ['eraChanged', 'landed', 'promptResolved', 'gameOver']);
  assert.deepEqual(g[0].texts, ['🌱 시대 시작']);
  assert.deepEqual(g[1].texts, ['❗ 대박']);
  assert.equal(g[1].delta, 150);
  assert.deepEqual(g[1].money, [{ charId: 'c1', delta: 150, reason: 'event' }]);
  assert.deepEqual(g[2].involved, ['c3', 'c4']);
  assert.equal(g[2].delta, 10);
  assert.deepEqual(g[3].involved, ['c2', 'c1']);
  assert.equal(planCutins([]).length, 0);
});

test('tagLabel / autoAdvanceMs / sfxForEvent', () => {
  const tileTypes = loadData('board').tileTypes;
  assert.equal(tagLabel({ type: 'landed', tone: 'love', tileType: 'heart' }, { tones: tones.tones, tileTypes }), '💕 연애·육아 · 하트 칸');
  assert.equal(tagLabel({ type: 'result', tone: 'result' }, { tones: tones.tones }), '🏆 결과 발표');
  assert.equal(autoAdvanceMs({ prompt: true }), 0);
  assert.ok(autoAdvanceMs({ owner: true }) > autoAdvanceMs({ owner: false }));
  assert.equal(autoAdvanceMs({ owner: false }), 4000);
  const sfx = tones.sfx;
  assert.equal(sfxForEvent({ type: 'moneyChanged', delta: 5 }, sfx), 'coin');
  assert.equal(sfxForEvent({ type: 'moneyChanged', delta: -5 }, sfx), 'thud');
  assert.equal(sfxForEvent({ type: 'spun' }, sfx), 'tick');
  assert.equal(sfxForEvent({ type: 'finished' }, sfx), 'fanfare');
  assert.equal(sfxForEvent({ type: 'betResolved', results: [{ won: true }] }, sfx), 'coin');
  assert.equal(sfxForEvent({ type: 'log' }, sfx), null);
});

test('avatarPalette + recolorPixels: blonde hair / navy uniform / skin recolored, rest untouched', () => {
  const pal = avatarPalette({ hairColor: 'black', outfitColor: 'red', skin: 'deep' }, defs);
  assert.equal(pal.hair, '#2b2222');
  assert.equal(pal.outfit, '#e25b5b');
  assert.equal(pal.skin, '#a86f4c');
  assert.equal(avatarPalette({ skin: 'light' }, defs).skin, null);
  const keys = new Set();
  for (const h of defs.parts.hairColor) for (const o of defs.parts.outfitColor) keys.add(avatarPalette({ hairColor: h.id, outfitColor: o.id }, defs).key);
  assert.equal(keys.size, defs.parts.hairColor.length * defs.parts.outfitColor.length);

  const px = (r, g, b, a = 255) => [r, g, b, a];
  const data = new Uint8ClampedArray([
    ...px(232, 193, 90), // blonde hair
    ...px(31, 42, 82), // navy uniform
    ...px(246, 207, 174), // skin
    ...px(220, 38, 38), // red bow (kept)
    ...px(232, 193, 90, 0), // transparent (kept)
  ]);
  const before = [...data];
  recolorPixels(data, pal);
  const hue = (i) => rgbToHsl(data[i], data[i + 1], data[i + 2]);
  assert.ok(hue(0)[2] < 0.3, 'hair darkened toward black');
  const [oh] = hue(4);
  assert.ok(oh < 20 || oh > 340, `uniform hue → red (${oh})`);
  assert.ok(hue(8)[2] < rgbToHsl(246, 207, 174)[2], 'skin darkened for deep');
  assert.deepEqual([...data.slice(12, 20)], before.slice(12, 20));
  // light skin palette leaves skin alone
  const d2 = new Uint8ClampedArray(px(246, 207, 174));
  recolorPixels(d2, avatarPalette({ hairColor: 'pink', outfitColor: 'green', skin: 'light' }, defs));
  assert.deepEqual([...d2], px(246, 207, 174));
  assert.equal(BASE_PALETTE.hair, '#e8c15a');
  assert.match(hueFilterFor({ outfitColor: 'red' }, defs), /^hue-rotate\(\d+deg\)/);
});

test('animator: neutral emotions get no popup step; getHandler exposes handlers for wrapping', async () => {
  const steps = planSteps([
    { type: 'spun', charId: 'c1', emotion: 'neutral' },
    { type: 'landed', charId: 'c1', emotion: 'joy' },
    { type: 'promptResolved', charId: 'c1', emotion: 'neutral' },
  ]);
  assert.deepEqual(steps.map((s) => s.kind), ['spun', 'landed', 'emotion', 'promptResolved']);
  const seen = [];
  const anim = createAnimator({ handlers: { landed: (e) => seen.push(`orig:${e.tileType}`) } });
  const orig = anim.getHandler('landed');
  anim.setHandler('landed', async (e, ctx) => {
    await orig(e, ctx);
    seen.push('cutin');
  });
  assert.equal(anim.getHandler('nope'), null);
  await anim.push([{ type: 'landed', charId: 'c1', tileType: 'event' }]);
  assert.deepEqual(seen, ['orig:event', 'cutin']);
});
