// Fix-B2 (E2E round 4, pages): pure helpers of the lobby / admin asset page / picker 3D preview.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { modeSummary, scrollCue } from '../public/js/ui/lobbyText.js';
import { acceptedCaption, shortDate } from '../public/js/ui/assetText.js';
import { previewFrame } from '../public/js/scene/pawnPreview.js';
import { buildPawnGeometry } from '../public/js/scene/pawn.js';
import { pawnLook } from '../public/js/scene/pawnParts.js';

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../server/data/${f}`, import.meta.url)));
const eras = read('eras.json');

test('modeSummary: bold mode name, extras, era list with the final goal race', () => {
  const room = {
    config: { mode: 'lifetime', eraTurns: { baby: 3, elem: 3, middle: 3, high: 3, young: 15, middle_age: 15 }, finalLength: 40, startingMoney: 1000, rouletteMode: 'skill', world: 'chiikawa' },
  };
  const m = modeSummary(room, { eras });
  assert.equal(m.title, eras.modes.lifetime.name);
  assert.deepEqual(m.extras, ['초기 자금 1,000만원', '🎯 룰렛 실력 모드']);
  assert.equal(m.eras.length, eras.modes.lifetime.eras.length);
  assert.match(m.eras.at(-1), /🏁 40칸$/);
  assert.match(m.eras[0], /3턴$/);
  // the world is NOT part of the mode line (the lobby has its own world line)
  assert.ok(!JSON.stringify(m).includes('치이카와'));
  // random roulette → no skill extra; kids mode → no goal race
  const kids = modeSummary({ config: { mode: 'kids', eraTurns: { baby: 2 }, startingMoney: 500 } }, { eras });
  assert.deepEqual(kids.extras, ['초기 자금 500만원']);
  assert.ok(kids.eras.every((e) => !e.includes('🏁')));
  assert.ok(kids.eras.some((e) => e.endsWith('-턴')), 'an era without a turn count shows 「-턴」');
  // unknown mode / no meta → the raw id, no eras
  assert.deepEqual(modeSummary({ config: { mode: 'weird', startingMoney: 0 } }, null), { title: 'weird', extras: ['초기 자금 0만원'], eras: [] });
});

test('scrollCue: which edge of a horizontal scroller hides content', () => {
  assert.equal(scrollCue({ scrollLeft: 0, scrollWidth: 300, clientWidth: 300 }), '');
  assert.equal(scrollCue({ scrollLeft: 0, scrollWidth: 442, clientWidth: 306 }), 'right');
  assert.equal(scrollCue({ scrollLeft: 60, scrollWidth: 442, clientWidth: 306 }), 'both');
  assert.equal(scrollCue({ scrollLeft: 136, scrollWidth: 442, clientWidth: 306 }), 'left');
  assert.equal(scrollCue({ scrollLeft: 135.5, scrollWidth: 442, clientWidth: 306 }), 'left', 'sub-pixel end counts as the end');
  assert.equal(scrollCue(), '');
});

test('acceptedCaption: generated / upload / import (no 「후보 #undefined」)', () => {
  const at = '2026-10-16T05:26:47.000Z';
  const gen = acceptedCaption({ source: 'generated', candidate: 1, model: 'gemini-2.5-flash-image', acceptedAt: at, width: 1920, height: 1080 });
  assert.equal(gen[0], '후보 #1');
  assert.equal(gen[1], 'gemini-2.5-flash-image');
  assert.match(gen[2], /^\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}$/);
  assert.equal(gen[3], '1920×1080');
  assert.deepEqual(acceptedCaption({ source: 'upload', model: 'upload', acceptedAt: at }).slice(0, 1), ['업로드']);
  const imp = acceptedCaption({ source: 'import', model: 'import', from: 'assets-inbox/test/ch-chiikawa-base.png', acceptedAt: at, width: 559, height: 667 });
  assert.equal(imp[0], '가져오기 (ch-chiikawa-base.png)');
  assert.ok(!imp.join(' ').includes('undefined') && !imp.includes('import'));
  assert.equal(acceptedCaption({ source: 'import' })[0], '가져오기');
  // an old record without a candidate number
  assert.equal(acceptedCaption({ model: 'gemini' })[0], '생성');
  assert.deepEqual(acceptedCaption(null), []);
  assert.equal(shortDate('nope'), '');
});

test('previewFrame: the turning pawn (and its stand) stays inside the circular preview', () => {
  const meta = { roster: read('roster.json'), props: read('props.json') };
  const fov = 30;
  const fits = (positions) => {
    const f = previewFrame(positions, { fov });
    const [, cy] = f.target;
    const dist = Math.hypot(f.position[1] - cy, f.position[2]);
    const half = dist * Math.tan((fov * Math.PI) / 360); // inscribed circle radius at the target depth
    let worst = 0;
    for (let i = 0; i + 2 < positions.length; i += 3) worst = Math.max(worst, Math.hypot(Math.hypot(positions[i], positions[i + 2]), positions[i + 1] - cy));
    return { f, half, worst, dist };
  };
  const plain = fits(buildPawnGeometry(pawnLook({ character: 'chiikawa', props: {} }, meta), meta).attributes.position.array);
  assert.ok(plain.worst <= plain.half / 1.05, 'every vertex inside the circle with a margin');
  assert.ok(plain.half >= 0.8 * 1.05, 'the round stand fits too');
  for (const [character, props] of [['chiikawa', { hand: 'fishing_rod' }], ['rakko', { hand: 'balloon' }], ['momonga', { back: 'wings' }], ['usagi', { head: 'chef_hat' }]]) {
    const r = fits(buildPawnGeometry(pawnLook({ character, props }, meta), meta).attributes.position.array);
    assert.ok(r.worst <= r.half / 1.05, `${character} + ${JSON.stringify(props)} inside the circle`);
  }
  const rod = fits(buildPawnGeometry(pawnLook({ character: 'chiikawa', props: { hand: 'fishing_rod' } }, meta), meta).attributes.position.array);
  assert.ok(rod.dist > plain.dist, 'a long hand item moves the camera back');
  // no geometry yet → the stand alone frames a sane default
  const empty = previewFrame([]);
  assert.ok(empty.radius > 0.8 && empty.position[2] > 3);
});
