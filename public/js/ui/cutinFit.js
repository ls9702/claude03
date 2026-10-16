// Cut-in fit math (pure: no DOM; node-tested in test/client-cutinFit.test.js).
//
// The cut-in stage (16:9 illustration window + dialogue box + character tabs) must fit the viewport above the
// reaction bar at every size (320×568 … 1920×1080, phone landscape, TV): the window takes what the box and the tabs
// leave, between a minimum and the design maximum. When even the minimum window doesn't leave room, a wide screen
// puts the window beside the box (`side`), else the box body (chips / text / options) scrolls inside the box with ▼
// and the tabs still on screen (`scroll`, last resort).
// cutin2d.js measures the DOM (stage / window / box heights) and applies the plan as CSS variables:
//   --ci-winw (window width), --ci-boxw (box / tabs width), --ci-body-max (body cap in `scroll` mode).

export const WIN_ASPECT = 16 / 9;
export const FIT = Object.freeze({
  minWinPx: 240, // the window never gets narrower than this (or the stage width when that is smaller)
  minWinFrac: 0.5, // … nor than this share of the widest window
  minPromptPx: 200, // prompts on short screens (< shortVh)
  shortVh: 700,
  sideBelowFrac: 0.62, // a stacked window narrower than this share of the widest one → try the side-by-side layout
  sideMinVw: 900, // side-by-side only on wide screens (phones in landscape use it through their own media query)
  sideMinAspect: 1.25, // … that are clearly landscape (vw / vh)
  eventBoxMinPx: 680, // event cut-ins: the dialogue box is as wide as the window, but never narrower than this
  minBodyPx: 96, // `scroll` mode: the scrolling body keeps at least this height
});

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Narrowest window width for a stage of `maxW` (px). Prompts on short screens (< 700 px high) may go down to
 * `minPromptPx`: their options matter more than the picture (375×667 찬스 광장).
 */
export function minWindowWidth(maxW, { prompt = false, vh = Infinity } = {}) {
  const floor = prompt && vh < FIT.shortVh ? FIT.minPromptPx : FIT.minWinPx;
  return Math.round(Math.min(maxW, Math.max(floor, maxW * FIT.minWinFrac)));
}

/**
 * Window width that makes a stacked stage fit `availH`: the window gets `availH − otherH` of height (everything but
 * the window = box + tabs + gaps), clamped to [minW, maxW].
 */
export function stackedWidth({ availH, otherH, maxW, minW = minWindowWidth(maxW), aspect = WIN_ASPECT }) {
  const w = Math.floor((availH - otherH) * aspect);
  return Math.round(clamp(Number.isFinite(w) ? w : maxW, Math.min(minW, maxW), maxW));
}

/**
 * Dialogue box width for a window of `winW`: prompts keep the full stage width (their option cards need it),
 * events match the window but stay at least `eventBoxMinPx` wide (a narrow window with a narrow box would only
 * get taller).
 */
export function boxWidth({ winW, maxW, prompt = false }) {
  if (prompt) return Math.round(maxW);
  return Math.round(Math.min(maxW, Math.max(winW, FIT.eventBoxMinPx)));
}

/** Should a stacked window this narrow give way to the side-by-side layout? */
export function wantsSide({ winW, maxW, vw, vh }) {
  if (!(vw >= FIT.sideMinVw) || !(vw >= vh * FIT.sideMinAspect)) return false;
  return winW < maxW * FIT.sideBelowFrac;
}

/**
 * Last resort: cap the scrolling body so the stage loses `overflow` px; never below `minBodyPx`.
 * @returns {number|null} max-height in px for the body, or null when nothing overflows.
 */
export function bodyCap({ bodyH, overflow }) {
  if (!(overflow > 0.5)) return null;
  return Math.max(FIT.minBodyPx, Math.floor(bodyH - overflow - 2));
}

/**
 * Iterate a stacked fit: `measure(winW, boxW)` lays the stage out and returns its `{stageH, winH}`; converges in
 * ≤ 4 passes (the box gets taller as it narrows, so the window shrinks a little more).
 * @returns {{winW:number, boxW:number, stageH:number, fits:boolean, passes:number}}
 */
export function fitStacked({ availH, maxW, prompt = false, measure, minW = minWindowWidth(maxW) }) {
  let winW = Math.round(maxW);
  let boxW = boxWidth({ winW, maxW, prompt });
  let m = measure(winW, boxW);
  let passes = 1;
  while (passes < 4) {
    const otherH = m.stageH - m.winH;
    const next = stackedWidth({ availH, otherH, maxW, minW });
    if (Math.abs(next - winW) < 2) break;
    winW = next;
    boxW = boxWidth({ winW, maxW, prompt });
    m = measure(winW, boxW);
    passes++;
  }
  return { winW, boxW, stageH: m.stageH, fits: m.stageH <= availH + 1, passes };
}

/** Distinct rows of laid-out chips (`tops` = their offsetTop, ±3 px is one row). */
export function chipRows(tops) {
  const rows = [];
  for (const t of tops) if (!rows.some((r) => Math.abs(r - t) <= 3)) rows.push(t);
  return rows.length;
}

/**
 * Chips beyond the row cap fold into a 「+n」 toggle chip: the order in which to hide them — minor chips (e.g.
 * per-guest 💌 gifts) from the end first, then the others from the end; the first chip and chips flagged `keep`
 * (a total) always stay. `chips` = [{minor?, keep?}] in DOM order → indexes.
 */
export function chipHideOrder(chips) {
  const idx = chips.map((c, i) => i);
  return [
    ...idx.filter((i) => i > 0 && chips[i].minor && !chips[i].keep).reverse(),
    ...idx.filter((i) => i > 0 && !chips[i].minor && !chips[i].keep).reverse(),
  ];
}

/** Row cap for the chips in the dialogue box: short screens get fewer rows. */
export function chipRowCap({ vh, vw }) {
  if (vh < 500 || vw < 400) return 2;
  return vh < 760 ? 2 : 3;
}
