import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIT,
  WIN_ASPECT,
  bodyCap,
  boxWidth,
  chipHideOrder,
  chipRowCap,
  chipRows,
  fitStacked,
  minWindowWidth,
  stackedWidth,
  wantsSide,
} from '../public/js/ui/cutinFit.js';
import { BOARD_BEHIND_TURNS, HUD_HOLD_MINE_MS, HUD_HOLD_MS, boardBehind, hudHoldLeft } from '../public/js/ui/cutinPolicy.js';

test('stackedWidth: the window takes the height the rest leaves, clamped to [min, max]', () => {
  // 688 px available, box + tabs + gaps = 300 → window 388 px tall → 689 px wide
  assert.equal(stackedWidth({ availH: 688, otherH: 300, maxW: 1040 }), Math.floor(388 * WIN_ASPECT));
  assert.equal(stackedWidth({ availH: 2000, otherH: 300, maxW: 1040 }), 1040); // plenty of room → the design maximum
  assert.equal(stackedWidth({ availH: 400, otherH: 600, maxW: 1040 }), minWindowWidth(1040)); // never below the minimum
  assert.equal(stackedWidth({ availH: 400, otherH: 600, maxW: 200 }), 200); // a stage narrower than the minimum
});

test('minWindowWidth: half the stage, at least 240 px, never wider than the stage', () => {
  assert.equal(minWindowWidth(1040), 520);
  assert.equal(minWindowWidth(304), 240);
  assert.equal(minWindowWidth(200), 200);
  assert.equal(minWindowWidth(359, { prompt: true, vh: 667 }), 200); // a prompt on a short phone: options first
  assert.equal(minWindowWidth(359, { prompt: true, vh: 844 }), 240);
  assert.equal(minWindowWidth(359, { vh: 667 }), 240);
  assert.ok(FIT.minWinPx >= 200);
});

test('boxWidth: prompts keep the full stage width, events follow the window but stay readable', () => {
  assert.equal(boxWidth({ winW: 500, maxW: 1040, prompt: true }), 1040);
  assert.equal(boxWidth({ winW: 900, maxW: 1040 }), 900);
  assert.equal(boxWidth({ winW: 500, maxW: 1040 }), FIT.eventBoxMinPx);
  assert.equal(boxWidth({ winW: 300, maxW: 374 }), 374); // phone: the box is the stage width
});

test('fitStacked converges when the box grows as it narrows (coupled event box)', () => {
  // box text: 120 000 px² of text → height = 120000 / boxW + 120 (chrome); tabs + gaps 70
  const measure = (winW, boxW) => {
    const winH = winW / WIN_ASPECT;
    return { stageH: winH + 120000 / boxW + 120 + 70, winH };
  };
  const r = fitStacked({ availH: 700, maxW: 1040, measure });
  assert.ok(r.fits, JSON.stringify(r));
  assert.ok(r.passes <= 4);
  assert.ok(r.winW < 1040 && r.winW >= minWindowWidth(1040));
  const m = measure(r.winW, r.boxW);
  assert.ok(m.stageH <= 701, `stage ${m.stageH}`);
  // and as large as fits: 10 px wider would not fit any more
  const m2 = measure(r.winW + 10, boxWidth({ winW: r.winW + 10, maxW: 1040 }));
  assert.ok(m2.stageH > 700 - 6);
});

test('fitStacked: a box that can never fit reports fits = false at the minimum window', () => {
  const measure = (winW) => ({ stageH: winW / WIN_ASPECT + 900, winH: winW / WIN_ASPECT });
  const r = fitStacked({ availH: 700, maxW: 1040, prompt: true, measure });
  assert.equal(r.fits, false);
  assert.equal(r.winW, minWindowWidth(1040));
  assert.equal(r.boxW, 1040);
});

test('wantsSide: only wide landscape screens whose stacked window got too small', () => {
  assert.equal(wantsSide({ winW: 500, maxW: 1040, vw: 1280, vh: 720 }), true);
  assert.equal(wantsSide({ winW: 800, maxW: 1040, vw: 1280, vh: 720 }), false); // big enough stacked
  assert.equal(wantsSide({ winW: 300, maxW: 752, vw: 768, vh: 1024 }), false); // portrait tablet
  assert.equal(wantsSide({ winW: 240, maxW: 374, vw: 390, vh: 844 }), false); // phone
});

test('bodyCap: the last resort keeps a usable scrolling body', () => {
  assert.equal(bodyCap({ bodyH: 500, overflow: 0 }), null);
  assert.equal(bodyCap({ bodyH: 500, overflow: 120 }), 378);
  assert.equal(bodyCap({ bodyH: 150, overflow: 400 }), FIT.minBodyPx);
});

test('chips: rows, fold order (minor first, the first chip and totals stay), row cap', () => {
  assert.equal(chipRows([10, 10, 11, 40, 41, 70]), 3);
  assert.equal(chipRows([]), 0);
  const chips = [{}, {}, { minor: true }, { minor: true }, { minor: true }, { keep: true }];
  const order = chipHideOrder(chips);
  assert.deepEqual(order.slice(0, 3), [4, 3, 2]); // per-guest chips from the end
  assert.ok(!order.includes(0) && !order.includes(5)); // the first chip and the total stay
  assert.deepEqual(order.slice(3), [1]);
  assert.equal(chipRowCap({ vw: 320, vh: 568 }), 2);
  assert.equal(chipRowCap({ vw: 1280, vh: 720 }), 2);
  assert.equal(chipRowCap({ vw: 1920, vh: 1080 }), 3);
});

test('HUD hold: others’ turns / spectators ≤ 3 s, my own turn ≤ 8 s; a board 2 turns behind rushes', () => {
  assert.equal(hudHoldLeft({ heldMs: 0 }), HUD_HOLD_MS);
  assert.equal(hudHoldLeft({ heldMs: 2000 }), HUD_HOLD_MS - 2000);
  assert.equal(hudHoldLeft({ heldMs: 280000 }), 0); // the old 4-minute freeze can't happen
  assert.equal(hudHoldLeft({ heldMs: 4000, mine: true }), HUD_HOLD_MINE_MS - 4000);
  assert.equal(hudHoldLeft({ heldMs: -5 }), HUD_HOLD_MS);
  assert.ok(HUD_HOLD_MS <= 4000 && HUD_HOLD_MINE_MS > HUD_HOLD_MS);
  assert.equal(boardBehind({ stateTurn: 12, boardTurn: 12 }), false);
  assert.equal(boardBehind({ stateTurn: 13, boardTurn: 12 }), false); // one batch behind = normal animation
  assert.equal(boardBehind({ stateTurn: 12 + BOARD_BEHIND_TURNS, boardTurn: 12 }), true);
  assert.equal(boardBehind({ stateTurn: 5, boardTurn: null }), false);
});
