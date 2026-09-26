import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../server/data/index.js';
import {
  AI_EXPRESSIONS,
  PART_EXPRESSIONS,
  POSES,
  autoAdvanceMs,
  expressionFor,
  isBigWin,
  layerPlan,
  planCutins,
  poseFor,
  resolveCharacterArt,
  sfxForEvent,
  tagLabel,
} from '../public/js/ui/cutinMap.js';
import { createAnimator, planSteps } from '../public/js/scene/animator.js';

const defs = loadData('avatars');
const tones = loadData('tones');

test('expressionFor: emotion → AI expression image + paper-doll part expression + procedural overlay', () => {
  assert.deepEqual(expressionFor('joy'), { layer: 'joy', part: 'joy', overlay: null });
  assert.deepEqual(expressionFor('cry'), { layer: 'cry', part: 'cry', overlay: 'tears' });
  assert.deepEqual(expressionFor('shock'), { layer: 'shock', part: 'shock', overlay: null });
  assert.deepEqual(expressionFor('angry'), { layer: 'angry', part: 'angry', overlay: null });
  assert.deepEqual(expressionFor('love'), { layer: null, part: 'love', overlay: 'heart' });
  assert.deepEqual(expressionFor('sweat'), { layer: null, part: 'sweat', overlay: 'sweat' });
  assert.deepEqual(expressionFor('shy'), { layer: null, part: 'shy', overlay: null });
  assert.deepEqual(expressionFor('neutral'), { layer: null, part: null, overlay: null });
  assert.deepEqual(expressionFor(undefined), { layer: null, part: null, overlay: null });
});

test('expressionFor covers every engine emotion with a paper-doll layer that exists', async () => {
  const { EXPRESSIONS } = await import('../public/js/shared/partStack.js');
  assert.deepEqual(PART_EXPRESSIONS, EXPRESSIONS, 'cutinMap mirrors partStack EXPRESSIONS');
  const { EMOTIONS } = await import('../server/game/presentation.js').catch(() => ({}));
  const emotions = EMOTIONS ?? ['joy', 'cry', 'angry', 'sweat', 'love', 'shock', 'neutral'];
  for (const e of emotions) {
    const x = expressionFor(e);
    if (e === 'neutral') assert.equal(x.part, null);
    else assert.ok(EXPRESSIONS.includes(x.part), `${e} → part expression`);
    if (x.layer) assert.ok(AI_EXPRESSIONS.includes(x.layer), `${e} → AI expression file`);
  }
  for (const p of EXPRESSIONS) assert.equal(expressionFor(p).part, p, `part ${p} reachable`);
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

test('resolveCharacterArt: AI art (ready) > paper-doll layers; pose file > expression file > idle > base', () => {
  const files = {
    base: '/api/char-art/k/base.webp',
    poses: { idle: '/i.webp', wave: '/w.webp', jump: '/j.webp', cheer: '/c.webp', cry: '/cr.webp', shock: '/s.webp' },
    expressions: { joy: '/ej.webp', cry: '/ec.webp', shock: '/es.webp', angry: '/ea.webp' },
  };
  const ready = { avatar: {}, art: { key: 'k', status: 'ready', progress: 1, files } };
  const r = (c, want) => resolveCharacterArt(c, want);
  // AI pose images carry their face: a non-idle pose wins over any expression
  assert.deepEqual(r(ready, { pose: 'jump', expression: 'joy' }), { source: 'ai', url: '/j.webp', kind: 'pose', pose: 'jump', expression: null, motion: 'jump' });
  assert.equal(r(ready, { pose: 'cry', expression: 'cry' }).url, '/cr.webp');
  // idle + expression → expression file
  assert.deepEqual(r(ready, { pose: 'idle', expression: 'angry' }), { source: 'ai', url: '/ea.webp', kind: 'expression', pose: 'idle', expression: 'angry', motion: 'idle' });
  // expression without an AI file (love) → idle pose
  assert.equal(r(ready, { pose: 'idle', expression: 'love' }).url, '/i.webp');
  assert.equal(r(ready, {}).url, '/i.webp');
  // missing pose file → expression file (keeps the motion), then idle, then base
  const partial = { art: { status: 'ready', files: { base: '/b.webp', poses: {}, expressions: { joy: '/ej.webp' } } } };
  assert.deepEqual(r(partial, { pose: 'cheer', expression: 'joy' }), { source: 'ai', url: '/ej.webp', kind: 'expression', pose: 'idle', expression: 'joy', motion: 'cheer' });
  assert.deepEqual(r(partial, { pose: 'wave' }), { source: 'ai', url: '/b.webp', kind: 'base', pose: 'idle', expression: null, motion: 'wave' });
  // portraits use the base (bust crop), else the idle pose
  assert.equal(r(ready, { portrait: true, pose: 'jump', expression: 'joy' }).url, '/api/char-art/k/base.webp');
  assert.equal(r({ art: { status: 'ready', files: { poses: { idle: '/i.webp' } } } }, { portrait: true }).url, '/i.webp');
  // not ready / no usable files → paper-doll layers (the caller falls back to SVG when those are missing)
  const layers = (motion, expression) => ({ source: 'layers', url: null, kind: 'layers', pose: 'idle', expression, motion });
  for (const art of [undefined, null, { status: 'pending', progress: 0.4 }, { status: 'failed' }, { status: 'pending', files }, { status: 'ready' }, { status: 'ready', files: {} }, { status: 'ready', files: { poses: { idle: 42 } } }]) {
    assert.deepEqual(r({ avatar: {}, art }, { pose: 'jump', expression: 'joy' }), layers('jump', 'joy'), JSON.stringify(art));
  }
  // layered art: all 7 part expressions pass through, unknown ones are dropped, unknown poses → idle motion
  for (const e of PART_EXPRESSIONS) assert.equal(r({}, { expression: e }).expression, e);
  assert.deepEqual(r({}, { pose: 'dance', expression: 'bored' }), layers('idle', null));
  assert.deepEqual(r(null, { portrait: true, expression: 'joy' }), { ...layers('idle', null) });
  for (const p of POSES) assert.equal(r({}, { pose: p }).motion, p);
});
