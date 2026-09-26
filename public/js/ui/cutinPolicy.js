// Pure cut-in scheduling policy (no DOM) — used by game2d.js / cutin2d.js and node tests.
//
//   classifyGroup(group, ctx)      → 'full' | 'banner' | 'skip' (compact spectator mode, prompt pre-emption,
//                                     spectator backlog cap, game over)
//   mergeGroups(groups, {mine})    → one turn's groups of the same (other) character merged into one cut-in
//   myPendingChars(pending, chars) → my characters that still have to answer the pending prompt
//   routeOptionInfo(pending, opt)  → one-line description for the 인생 갈림길 options
//   betPicks(cfg)                  → side-bet buttons from `/api/meta` balance.bets (ranges from the server)

/** 「관전 컷인」 setting: full cut-ins for everything / small banners for other players' minor events / none. */
export const CUTIN_MODES = ['full', 'compact', 'off'];
export const CUTIN_MODE_LABEL = { full: '전체', compact: '간단히', off: '끄기' };
export const DEFAULT_CUTIN_MODE = 'compact';
/** Max queued full cut-ins of other players' events (older ones become banners). */
export const SPECTATOR_BACKLOG = 2;
/** A pending prompt of mine closes the current cut-in after at most this long on screen. */
export const PREEMPT_KEEP_MS = 1500;
/** 3D: how long my prompt may wait for the board animation (spin → hops) before it opens over the board. */
export const PROMPT_BOARD_WAIT_MS = 1200;
/** Compact banner time on screen. */
export const BANNER_MS = 2200;
/** Cut-in window waits this long for the cast art (then shows the SVG and swaps). */
export const CAST_PRELOAD_MS = 600;

/** Tiles that will become marriage / job events (Stage 6) — always full cut-ins. */
export const BIG_TILE_TYPES = ['heart', 'job'];
const BIG_TYPES = new Set(['finished', 'eraChanged', 'gameOver']);
const BIG_TAG = /marriage|wedding|job|promotion|birth/;

/** Normalize a stored / URL value of the spectator cut-in mode. */
export function normalizeCutinMode(v, fallback = DEFAULT_CUTIN_MODE) {
  return CUTIN_MODES.includes(v) ? v : fallback;
}

/** Big events are always full cut-ins: studio, finished, era change, marriage/job tiles. */
export function isBigGroup(g) {
  const a = g?.anchor;
  if (!a) return false;
  if (g.studio?.length || a.mcStudio) return true;
  if (BIG_TYPES.has(a.type)) return true;
  if (a.type === 'landed' && BIG_TILE_TYPES.includes(a.tileType)) return true;
  if (BIG_TAG.test(String(a.mcKey ?? '')) || BIG_TAG.test(String(a.lineTag ?? ''))) return true;
  return false;
}

/** My group = its main character is mine. */
export const isOwnGroup = (g, mine) => !!g?.charId && toSet(mine).has(g.charId);

function toSet(mine) {
  if (mine instanceof Set) return mine;
  return new Set(Array.isArray(mine) ? mine : []);
}

/**
 * How to present a cut-in group.
 * @param {object} g  planCutins group
 * @param {{mine?: Set<string>|string[], mode?: 'full'|'compact'|'off', promptForMe?: boolean, gameOver?: boolean,
 *          queued?: number, globalOff?: boolean}} ctx
 *   `promptForMe` = a prompt waits for one of my characters (it pre-empts every event cut-in);
 *   `queued` = full cut-ins already shown/queued (spectator backlog cap); `globalOff` = ?cutins=off
 * @returns {'full'|'banner'|'skip'}
 */
export function classifyGroup(g, { mine = [], mode = DEFAULT_CUTIN_MODE, promptForMe = false, gameOver = false, queued = 0, globalOff = false } = {}) {
  if (!g?.anchor || gameOver || g.anchor.type === 'gameOver') return 'skip';
  if (globalOff) return 'skip';
  const own = isOwnGroup(g, mine);
  if (promptForMe) return own || mode !== 'off' ? 'banner' : 'skip';
  if (own) return 'full';
  const m = normalizeCutinMode(mode);
  if (m === 'off') return 'skip';
  const want = m === 'full' || isBigGroup(g) ? 'full' : 'banner';
  if (want === 'full' && queued >= SPECTATOR_BACKLOG) return 'banner';
  return want;
}

const ANCHOR_RANK = { finished: 6, eraChanged: 5, routeChosen: 3, promptResolved: 2, landed: 1 };
const rankOf = (a) => (a?.type === 'landed' && BIG_TILE_TYPES.includes(a.tileType) ? 4 : ANCHOR_RANK[a?.type] ?? 0);

/**
 * Merge one batch's consecutive groups of the same other character into a single cut-in (e.g. landed + era
 * change + finished). The biggest anchor gives tone/tag/scene; texts, money chips and MC lines are combined.
 * `anchors` lists every merged anchor (3D attaches the merged cut-in to the last one). My own groups and
 * studio openings are never merged.
 */
export function mergeGroups(groups = [], { mine = [] } = {}) {
  const out = [];
  const own = toSet(mine);
  for (const g of groups) {
    const prev = out.at(-1);
    const mergeable =
      prev && g.charId && prev.charId === g.charId && !own.has(g.charId) && !g.studio?.length && g.anchor?.type !== 'gameOver' && prev.anchor?.type !== 'gameOver';
    if (!mergeable) {
      out.push({ ...g, anchors: [g.anchor] });
      continue;
    }
    const anchor = rankOf(g.anchor) > rankOf(prev.anchor) ? g.anchor : prev.anchor;
    const texts = [...prev.texts, ...g.texts].filter((t, i, a) => a.indexOf(t) === i);
    const involved = [...prev.involved, ...g.involved].filter((id, i, a) => a.indexOf(id) === i).slice(0, 3);
    out[out.length - 1] = {
      ...prev,
      anchor,
      anchors: [...prev.anchors, g.anchor],
      texts,
      money: [...prev.money, ...g.money],
      delta: prev.delta + g.delta,
      involved,
      mc: prev.mc ?? g.mc ?? null,
      mcEvents: [...(prev.mcEvents ?? []), ...(g.mcEvents ?? [])],
    };
  }
  return out;
}

/** My characters that still have to answer `pending` (empty for spectators / answered / resolved). */
export function myPendingChars(pending, characters = []) {
  if (!pending) return [];
  const answered = new Set(pending.answered ?? []);
  const byId = new Map(characters.map((c) => [c.id, c]));
  return (pending.forCharacterIds ?? []).map((id) => byId.get(id)).filter((c) => c?.isMe && !answered.has(c.id));
}

/** One-line route summaries for the 인생 갈림길 prompt (server `option.desc` wins when present). */
export const ROUTE_INFO = {
  love: { icon: '💕', desc: '만남·결혼·육아 이벤트' },
  career: { icon: '💼', desc: '급여·승진·직업' },
  money: { icon: '💰', desc: '보물·집·투자, 리스크 있음' },
};

/** Description line for a prompt option (route choice: ROUTE_INFO; any prompt: `option.desc`). */
export function routeOptionInfo(pending, option) {
  if (option?.desc) return String(option.desc);
  if (pending?.kind !== 'routeChoice') return '';
  return ROUTE_INFO[option?.id]?.desc ?? '';
}

/**
 * Side-bet buttons from `balance.bets`: odd/even + the server's ranges (e.g. 1-3 / 4-6 / 7-10) with payouts
 * from `payouts[pick]` (new) or `payout[kind]` (old). Never hardcodes the ranges.
 * @returns {{kind: 'oddEven'|'range', pick: string, label: string, payout: number|null}[]}
 */
export function betPicks(cfg = {}) {
  const pay = (kind, pick) => cfg.payouts?.[pick] ?? cfg.payout?.[kind] ?? null;
  const picks = [
    { kind: 'oddEven', pick: 'odd', label: '홀', payout: pay('oddEven', 'odd') },
    { kind: 'oddEven', pick: 'even', label: '짝', payout: pay('oddEven', 'even') },
  ];
  const ranges = cfg.ranges && typeof cfg.ranges === 'object' ? cfg.ranges : { '1-3': [1, 3], '4-7': [4, 7], '8-10': [8, 10] };
  const entries = Object.entries(ranges).sort((a, b) => (a[1]?.[0] ?? 0) - (b[1]?.[0] ?? 0));
  for (const [pick, r] of entries) {
    const [lo, hi] = Array.isArray(r) ? r : String(pick).split('-').map(Number);
    picks.push({ kind: 'range', pick, label: lo === hi ? `${lo}` : `${lo}~${hi}`, payout: pay('range', pick) });
  }
  return picks;
}
