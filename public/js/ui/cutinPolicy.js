// Pure cut-in scheduling policy (no DOM) — used by game2d.js / cutin2d.js and node tests.
//
//   classifyGroup(group, ctx)      → 'full' | 'banner' | 'skip' (compact spectator mode, prompt pre-emption,
//                                     spectator backlog cap, game over)
//   mergeGroups(groups, {mine})    → one turn's groups of the same (other) character merged into one cut-in
//   myPendingChars(pending, chars) → my characters that still have to answer the pending prompt
//   routeOptionInfo(pending, opt)  → one-line description for the 인생 갈림길 options
//   betPicks(cfg)                  → side-bet buttons from `/api/meta` balance.bets (ranges from the server)
//
// Stage 7: 명절 / 로또 / 뒤통수 on me are big (full even in compact), shop / card tiles and other players' purchases
// or sabotage are minor; lone card / gift / trade events are banners; a lotto draw that arrives while my prompt waits
// is deferred ('defer') until I have answered.
// Stage 8: 결혼식 / 출산 / 고교 첫 만남 / 부동산 시세 are big, a date is minor, 용돈 / 보상판매 / 입학 are chips.
// Loop maps: the shared era transition is ONE big show everyone takes part in; a payday landing (💵 월급날) is a banner
// unless it's big; 찬스 광장 「그냥 지나가기」 results and 찬스 버프 changes are banners.
// Stage 9: a submap result is big for jackpots / big 인생역전 wins / a wish that opens 산신령 (else minor → a banner for
// others in 「간단히」); a treasure find is minor unless it's mine.
import { isCardAnchor } from './cutinMap.js';
import { isSubmapBig, isSubmapPass } from '../shared/submaps.js';

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
/**
 * Post-simulation fixes (waiting time): other players' event cut-ins auto-advance after at most this long (mine keep
 * 7 s). Shows with their own animation (horse race, 명절 정산, lotto, treasure chest, MC studio) keep their length.
 */
export const OTHERS_AUTO_MS = 3000;
/** My turn started while the board / cut-ins still replay older events: catch up after this long (A3). */
export const MY_TURN_CATCHUP_MS = 900;
/** …and with a turn timer, never hold my spin button once fewer than this many ms are left. */
export const DEADLINE_RESERVE_MS = 12000;

/** Tiles that will become marriage / job events (Stage 6) — always full cut-ins. */
export const BIG_TILE_TYPES = ['heart', 'job'];
const BIG_TYPES = new Set(['finished', 'eraChanged', 'eraTransition', 'gameOver', 'jobChanged', 'rankUp', 'hiddenJobUnlocked', 'newsFlash', 'holidayStarted', 'holidayResult', 'lottoDraw',
  // Stage 8: 결혼식, 출산, 고교 첫 만남, 부동산 시세 (full even in 「간단히」)
  'married', 'childBorn', 'schoolMeet', 'houseValueChanged']);
/** Stage 8 minor anchors: never full for other players in 「간단히」 (whatever their line tag says). */
export const MINOR_TYPES = ['dated', 'treasureFound'];
const BIG_TAG = /marriage|wedding|job|promotion|birth/;
/** Stage 6 minor tiles: never full cut-ins for other players (whatever their line tag says). */
export const MINOR_TILE_TYPES = ['habit', 'salary', 'card', 'shop', 'pass'];
/** Loop maps: a payday landing this big (net 만원 for its character) is still a full cut-in for me. */
export const PAYDAY_BIG = 300;
/** A 💵 월급날 landing group (forced stop) — a banner unless big (also for my own characters). */
export function isPaydayGroup(g) {
  const anchors = g?.anchors ?? [g?.anchor];
  return anchors.length > 0 && anchors.every((a) => a?.type === 'landed' && a.tileType === 'salary');
}
/** 찬스 광장: 「그냥 지나가기」 / 나가기 results. */
export const isPassSkip = (a) => a?.type === 'promptResolved' && a.kind === 'passTile' && ['passed', 'left', 'pass', 'skip'].includes(String(a.result ?? ''));
/** Always a small banner (also for my own characters): 전역 (Stage 6); card gained / plain card use / gift / trade (Stage 7). */
export const BANNER_TYPES = ['militaryEnd', 'cardGained', 'gift', 'tradeResolved', 'chanceBuff'];
/** Stage 7: global shows that wait until my pending prompt is answered instead of shrinking to a banner. */
export const DEFER_TYPES = ['lottoDraw', 'holidayResult'];

/** A lone banner group (no cut-in anchor): 전역, card gained, plain card use, gift, trade result. */
export function isBannerGroup(g) {
  const a = g?.anchor;
  if (!a) return false;
  if (isSubmapPass(a)) return true; // Stage 9: 지나가기 / 그냥 나가기 at a submap
  if (isPassSkip(a)) return true; // loop maps: 찬스 광장 그냥 지나가기
  if (a.type === 'cardUsed') return !isCardAnchor(a);
  return BANNER_TYPES.includes(a.type);
}

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
  if (MINOR_TYPES.includes(a.type)) return false;
  if (a.type === 'submapResult') return isSubmapBig(a);
  if (a.type === 'landed' && BIG_TILE_TYPES.includes(a.tileType)) return true;
  if (a.type === 'landed' && MINOR_TILE_TYPES.includes(a.tileType)) return false;
  if (BIG_TAG.test(String(a.mcKey ?? '')) || BIG_TAG.test(String(a.lineTag ?? ''))) return true;
  return false;
}

/**
 * My group = its main character is mine; Stage 7: also a sabotage / block aimed at my character and a gift or trade
 * that reaches one of mine.
 */
export function isOwnGroup(g, mine) {
  const set = toSet(mine);
  if (g?.charId && set.has(g.charId)) return true;
  const t = g?.anchor?.type;
  // Stage 8: a 고교 첫 만남 with one of my characters in it, a wedding I paid a gift for
  if (t === 'schoolMeet' && (g.anchor.pairs ?? []).some((p) => set.has(p?.charId))) return true;
  const target = g?.targetId ?? g?.anchor?.targetId ?? g?.anchor?.toId ?? null;
  return !!target && ['cardUsed', 'cardBlocked', 'gift', 'tradeResolved'].includes(t) && set.has(target);
}
/** Stage 7: a sabotage card / block aimed at one of my characters. */
export const isSabotageOnMe = (g, mine) =>
  (g?.anchor?.type === 'cardUsed' || g?.anchor?.type === 'cardBlocked') && !!g.anchor.targetId && toSet(mine).has(g.anchor.targetId);

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
 * @returns {'full'|'banner'|'skip'|'defer'}  'defer' = show it (again through this policy) once my prompt is answered
 */
export function classifyGroup(g, { mine = [], mode = DEFAULT_CUTIN_MODE, promptForMe = false, gameOver = false, queued = 0, globalOff = false, fastForward = false, myTurn = false } = {}) {
  if (!g?.anchor || gameOver || g.anchor.type === 'gameOver') return 'skip';
  if (globalOff) return 'skip';
  const own = isOwnGroup(g, mine);
  if (promptForMe && DEFER_TYPES.includes(g.anchor.type)) return 'defer';
  if (promptForMe) return own || mode !== 'off' ? 'banner' : 'skip';
  if (isBannerGroup(g) && !g.studio?.length) return own || normalizeCutinMode(mode) !== 'off' ? 'banner' : 'skip';
  // 💵 월급날: the board shows the pay (float / banner); only a big payday of mine takes the screen
  if (isPaydayGroup(g) && !(own && Number(g.delta) >= PAYDAY_BIG)) return own || normalizeCutinMode(mode) !== 'off' ? 'banner' : 'skip';
  if (own) return 'full';
  const m = normalizeCutinMode(mode);
  if (m === 'off') return 'skip';
  // ⏩ 빨리 감기 / my roulette is waiting: other players' events never take over the screen (A3, waiting time);
  // shared shows my characters take part in (명절 정산, 로또 with my ticket, 고교 첫 만남 pair) stay full
  if ((fastForward || myTurn) && !involvesMe(g, mine)) return 'banner';
  // repeated shows of other players (2nd+ entrant of an era, 2nd+ wedding) → one small banner in 「간단히」
  if (g.repeat && m === 'compact') return 'banner';
  const want = m === 'full' || isBigGroup(g) ? 'full' : 'banner';
  if (want === 'full' && queued >= SPECTATOR_BACKLOG) return 'banner';
  return want;
}

/** A shared show one of my characters takes part in (명절 start / 정산 rows, lotto entries, schoolMeet pairs, gifts). */
export function involvesMe(g, mine) {
  const set = toSet(mine);
  const a = g?.anchor;
  if (!a) return false;
  if (a.type === 'holidayStarted' || a.type === 'eraTransition') return true; // everyone's holiday / the shared new era
  const ids = [g.charId, g.targetId, a.charId, a.targetId, a.toId, ...(a.results ?? []), ...(a.entries ?? []), ...(a.winners ?? []), ...(a.pairs ?? []), ...(a.gifts ?? [])]
    .map((x) => (x && typeof x === 'object' ? x.charId ?? x.fromId ?? null : x))
    .filter(Boolean);
  return ids.some((id) => set.has(id));
}

/**
 * Mark other players' repeated shows (post-simulation fixes, waiting time): an era entry after the era's first entrant
 * (the server gives the first one the MC studio), and every wedding of other players after the first one.
 * `seen = {eras: Set<eraId>, weddings: number}` is updated in order; my own groups are never marked.
 * @returns the same groups (with `repeat: true` / `eraId` on the marked ones)
 */
export function markRepeats(groups = [], seen = { eras: new Set(), weddings: 0 }, { mine = [] } = {}) {
  const own = toSet(mine);
  for (const g of groups) {
    const anchors = g.anchors ?? [g.anchor];
    const era = anchors.find((a) => a?.type === 'eraChanged');
    const wedding = anchors.find((a) => a?.type === 'married');
    const mineG = isOwnGroup(g, own);
    if (era?.era) {
      const first = !seen.eras.has(era.era);
      seen.eras.add(era.era);
      if (!mineG && !first && !g.studio?.length && g.anchor?.type === 'eraChanged') {
        g.repeat = true;
        g.eraId = era.era;
        g.eraName = era.eraName ?? '';
      }
    }
    if (wedding && !mineG) {
      if (seen.weddings > 0 && g.anchor?.type === 'married') g.repeat = true;
      seen.weddings++;
    }
  }
  return groups;
}

/** Seen-state for `markRepeats` from a room view (a reload mid-game: eras already reached, weddings already held). */
export function seenFromRoom(room, { mine = [] } = {}) {
  const own = toSet(mine);
  const eras = new Set();
  const list = room?.board?.eras ?? [];
  for (const c of room?.characters ?? []) {
    const idx = c?.position?.eraIndex ?? 0;
    for (let i = 0; i <= idx && i < list.length; i++) if (list[i]?.id) eras.add(list[i].id);
    if (c?.finished) for (const e of list) if (e?.id) eras.add(e.id);
  }
  const weddings = (room?.characters ?? []).filter((c) => c?.spouse && !own.has(c.id)).length;
  return { eras, weddings };
}

/** 「민수·지영 청년 시대 진입」 (more than 3 names → 「민수·지영·하늘 외 2명」). */
export function eraBannerText(names = [], eraName = '') {
  const list = names.filter(Boolean).filter((n, i, a) => a.indexOf(n) === i);
  const who = list.length > 3 ? `${list.slice(0, 3).join('·')} 외 ${list.length - 3}명` : list.join('·');
  return `${who}${who ? ' ' : ''}${eraName ? `${eraName} 시대` : '새 시대'} 진입`;
}

const ANCHOR_RANK = {
  hiddenJobUnlocked: 9, jobChanged: 8, rankUp: 8, finished: 6, eraTransition: 9, eraChanged: 5, militaryStart: 4, educationChanged: 4,
  injured: 3, routeChosen: 3, promptResolved: 2, landed: 1, militaryEnd: 0,
  cardBlocked: 6, cardUsed: 5, itemBought: 3, gift: 0, cardGained: 0, tradeResolved: 0,
  // Stage 8
  married: 9, childBorn: 8, proposed: 7, schoolMeet: 7, houseValueChanged: 6, childGrew: 5, houseBought: 5, met: 4, dated: 2,
  // Stage 9
  submapResult: 6, treasureFound: 5,
};
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
      prev && g.charId && prev.charId === g.charId && !own.has(g.charId) && !g.studio?.length && g.anchor?.type !== 'gameOver' && prev.anchor?.type !== 'gameOver' &&
      !isOwnGroup(g, own) && !isOwnGroup(prev, own) && !isBannerGroup(g) && !isBannerGroup(prev);
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
      stats: [...(prev.stats ?? []), ...(g.stats ?? [])],
      salary: [...(prev.salary ?? []), ...(g.salary ?? [])],
      discharged: [...(prev.discharged ?? []), ...(g.discharged ?? [])],
      cards: [...(prev.cards ?? []), ...(g.cards ?? [])],
      gifts: [...(prev.gifts ?? []), ...(g.gifts ?? [])],
      family: [...(prev.family ?? []), ...(g.family ?? [])],
      targetId: anchor === g.anchor ? g.targetId ?? null : prev.targetId ?? null,
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
