// Stage 9 pure client helpers (no DOM): submaps (고향 시골집 · 산사 · 제주도 · 인생역전) and treasures (보물).
// Node-tested in test/client-submaps.test.js. Everything feature-detects the server contract: missing fields fall back
// to the contract defaults below, `/api/meta` values win.
//
//   submapInfo(id, meta)            → {id, name, icon, scene, tone, tag}
//   submapOptions(pending, {meta})  → prompt options as cards (train:<stat> chips, horse:<odds> cards, lotto ball…)
//   submapSuccess(event)            → true | false | null (neutral outcome)
//   isSubmapBig(event)              → jackpot / big reversal win / a wish that unlocks 산신령
//   racePlan(event)                 → deterministic horse race (the chosen horse wins or loses as the result says)
//   treasureInfo / treasuresOf / treasureValueText
import { STAT_INFO } from './growth.js';

/** Contract defaults (server `/api/meta.submaps` / presentation win when present). */
export const SUBMAPS = Object.freeze({
  hometown: { id: 'hometown', name: '고향 시골집', icon: '🏡', scene: 'hometown', tone: 'good', color: '#7cb342' },
  temple: { id: 'temple', name: '산사', icon: '🛕', scene: 'temple', tone: 'good', color: '#8d6e63' },
  jeju: { id: 'jeju', name: '제주도', icon: '🌴', scene: 'jeju', tone: 'holiday', color: '#26a69a' },
  reversal: { id: 'reversal', name: '인생역전', icon: '🎰', scene: 'casino', tone: 'treasure', color: '#d4a017' },
});
export const SUBMAP_IDS = Object.keys(SUBMAPS);
/** Prompt kinds that belong to a submap. */
export const SUBMAP_PROMPTS = new Set(SUBMAP_IDS);
/** Client tile types (board.json wins): the 4 submap entrances + the active 보물 tile. */
export const SUBMAP_TILE_TYPES = Object.freeze({
  hometown: { name: '고향', icon: '🏡', color: '#7cb342' },
  temple: { name: '산사', icon: '🛕', color: '#8d6e63' },
  jeju: { name: '제주도', icon: '🌴', color: '#26a69a' },
  reversal: { name: '인생역전', icon: '🎰', color: '#d4a017' },
  treasure: { name: '보물', icon: '💎', color: '#d4a017' },
});
/** A reversal win of at least this much (만원) is a big event (full cut-in for everyone). */
export const BIG_REVERSAL = 500;

/** Horses of the 경마 option (odds 2 / 5 / 10). */
export const HORSES = Object.freeze([
  { odds: 2, name: '번개호', color: '#e2504c', lane: 0 },
  { odds: 5, name: '돌풍호', color: '#4f8ee0', lane: 1 },
  { odds: 10, name: '거북선호', color: '#2f9e58', lane: 2 },
]);
export const RACE_MS = 3400;

const OPTION_LOOK = {
  rest: { icon: '😴', label: '푹 쉬기' },
  visit: { icon: '👵', label: '부모님 찾아뵙기' },
  wish: { icon: '🙏', label: '소원 빌기' },
  leave: { icon: '🚶', label: '그냥 내려가기' },
  trip: { icon: '✈️', label: '제주 여행' },
  skip: { icon: '🚶', label: '지나가기' },
  lotto: { icon: '🎱', label: '로또 한 장' },
  // ADDENDUM A2 (final race 인생역전섬)
  allIn: { icon: '🎯', label: '전 재산 올인' },
  retire: { icon: '🏖️', label: '조기 은퇴' },
};

/** Drop a leading copy of the option icon from its label (「😴 푹 쉬다 가기」 + icon 😴 → 「푹 쉬다 가기」). */
export function stripIcon(label, icon) {
  const l = String(label ?? '').trim();
  if (icon && l.startsWith(icon)) return l.slice(icon.length).trim() || l;
  const m = l.match(/^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)\s+(.+)$/u);
  return m ? m[2] : l;
}

/** Submap of an event / prompt / tile (`submap`, else the prompt kind / tile type). */
export function submapOf(x) {
  const id = x?.submap ?? x?.kind ?? x?.tileType ?? null;
  if (id === 'casino') return 'reversal';
  return SUBMAP_IDS.includes(id) ? id : null;
}

/** Display info of a submap (`meta.submaps[id]` fields win). */
export function submapInfo(id, meta = null) {
  const key = id === 'casino' ? 'reversal' : id;
  const base = SUBMAPS[key] ?? { id: key ?? '', name: key ?? '', icon: '🗺️', scene: 'none', tone: 'neutral', color: '#8d99ae' };
  const m = meta?.submaps?.[key] ?? meta?.submaps?.submaps?.[key] ?? null;
  const out = { ...base, ...(m && typeof m === 'object' ? m : {}) };
  out.tag = `${out.icon} ${out.name}`.trim();
  return out;
}

const pct = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round((n <= 1 ? n * 100 : n) * 10) / 10;
};

/** Parse a submap option id: `train:<stat>`, `horse:<odds>`, plain ids. */
export function parseOptionId(id) {
  const s = String(id ?? '');
  const [kind, arg] = s.includes(':') ? [s.slice(0, s.indexOf(':')), s.slice(s.indexOf(':') + 1)] : [s, null];
  if (kind === 'train') return { kind, stat: arg };
  if (kind === 'horse') return { kind, odds: Number(arg) || null };
  return { kind, arg };
}

/**
 * Prompt options as display cards. Server fields win (`label`, `icon`, `desc`, `chance`, `stake`, `cost`, `odds`,
 * `stat`, `disabled`); the ids give the kind.
 * @returns {{id, kind, icon, label, desc, stat?, statLabel?, statColor?, odds?, chance?, stake?, cost?, horse?, disabled}[]}
 */
export function submapOptions(p, { meta = null } = {}) {
  void meta;
  return (p?.options ?? []).map((o) => {
    const parsed = parseOptionId(o.id);
    const look = OPTION_LOOK[parsed.kind] ?? {};
    const icon0 = o.icon || look.icon || '';
    const out = {
      id: o.id,
      kind: parsed.kind,
      icon: icon0,
      label: stripIcon(o.label || look.label || String(o.id), icon0),
      desc: o.desc ?? '',
      cost: Number.isFinite(Number(o.cost ?? o.price)) && Number(o.cost ?? o.price) > 0 ? Number(o.cost ?? o.price) : null,
      chance: pct(o.chance),
      disabled: !!o.disabled,
    };
    if (parsed.kind === 'train') {
      const stat = o.stat ?? parsed.stat;
      const info = STAT_INFO[stat];
      out.stat = stat;
      out.statLabel = info?.label ?? stat;
      out.statColor = info?.color ?? '#8d99ae';
      out.icon = info?.icon || o.icon || '🧘';
      if (!o.label) out.label = `${info?.label ?? stat} 수련`;
      out.gain = Number(o.gain ?? o.amount) || null;
    }
    if (parsed.kind === 'horse') {
      const odds = Number(o.odds ?? parsed.odds) || null;
      out.odds = odds;
      out.horse = HORSES.find((h) => h.odds === odds) ?? null;
      out.stake = Number(o.stake ?? o.cost) || null;
      out.icon = o.icon || '🏇';
      if (!o.label) out.label = `경마 ${odds ?? '?'}배`;
      out.horseName = out.horse?.name ?? '';
      out.payout = out.stake && odds ? out.stake * odds : null;
    }
    return out;
  });
}

// server results (9-A): rest visit train wishOk wishFail leave trip skip jackpot lottoWin lottoLose horseWin horseLose
const SUCCESS = new Set(['win', 'won', 'success', 'jackpot', 'bigwin', 'big', 'hit', 'ok', 'granted', 'unlock', 'unlocked', 'pass', 'lucky', 'wishok', 'lottowin', 'horsewin', 'allinwin']);
const FAIL = new Set(['lose', 'lost', 'fail', 'failed', 'miss', 'none', 'bust', 'nothing', 'wishfail', 'lottolose', 'horselose', 'allinlose']);
/** Results that are a pass (지나가기 / 그냥 나가기): a banner, never a full cut-in. */
export const PASS_RESULTS = new Set(['skip', 'leave']);
export const isSubmapPass = (e) => e?.type === 'submapResult' && (e.cutin === false || PASS_RESULTS.has(String(e.result ?? '')) || PASS_RESULTS.has(String(e.optionId ?? '')));
/** 산신령 unlock: this many successful wishes (jobs.json `mountain_spirit.unlock.wishes`, else 3). */
export const WISH_UNLOCK = 3;
export function wishUnlockAt(meta = null) {
  const list = Array.isArray(meta?.jobs?.jobs) ? meta.jobs.jobs : [];
  const n = Number(list.find((j) => j?.unlock?.wishes != null)?.unlock?.wishes);
  return Number.isFinite(n) && n > 0 ? n : WISH_UNLOCK;
}

/** Outcome of a submapResult: true (success / win), false (loss / failed wish), null (neutral: rest, trip…). */
export function submapSuccess(e) {
  if (!e) return null;
  if (typeof e.success === 'boolean') return e.success;
  if (typeof e.won === 'boolean') return e.won;
  const r = typeof e.result === 'string' ? e.result.toLowerCase() : e.result;
  if (r === true) return true;
  if (r === false) return false;
  if (SUCCESS.has(r)) return true;
  if (FAIL.has(r)) return false;
  const kind = parseOptionId(e.optionId).kind;
  if (kind === 'horse' || kind === 'lotto') return Number(e.amount) > 0;
  return null;
}

/** A successful wish that reaches the 산신령 unlock count (`wishes` ≥ unlock), or a server flag. */
export const isWishUnlock = (e, meta = null) =>
  parseOptionId(e?.optionId).kind === 'wish' &&
  submapSuccess(e) === true &&
  !!(e.unlock || e.unlocked || e.hiddenJobId || Number(e.wishes) >= wishUnlockAt(meta));

/** Big submap outcomes (full cut-in for everyone in 「간단히」): jackpots, big reversal wins, 산신령 wishes. */
export function isSubmapBig(e, meta = null) {
  if (e?.type !== 'submapResult') return false;
  if (e.big === true) return true;
  const r = String(e.result ?? '').toLowerCase();
  if (r === 'jackpot' || r === 'bigwin' || r === 'allinwin' || r === 'allinlose') return true; // 올인: a show either way
  if (isWishUnlock(e, meta)) return true;
  return submapOf(e) === 'reversal' && submapSuccess(e) === true && Number(e.amount) >= BIG_REVERSAL;
}

/** 32-bit FNV-1a of the parts (deterministic "randomness" for animations every client shares). */
export function hashParts(...parts) {
  let h = 0x811c9dc5;
  const s = parts.map((p) => String(p ?? '')).join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Horse race of a reversal `horse:<odds>` result. Deterministic from the event: the chosen horse wins when the result is
 * a win, else the event's `winner` / `winnerOdds` (or a hashed other horse) wins. Finish order: winner first, the rest
 * hashed — a lost bet's horse always last. `finishMs` = when each horse crosses the line; `ease` differs per horse (the winner comes from behind).
 * @returns {{chosen: number|null, winner: number, won: boolean, durationMs: number, horses: {odds, name, color, lane,
 *   place, finishMs, ease, chosen, winner}[]}}
 */
export function racePlan(e) {
  const chosen = Number(e?.odds ?? parseOptionId(e?.optionId).odds) || null;
  const won = submapSuccess(e) === true;
  const seed = hashParts(e?.charId, e?.turnNo, e?.optionId, e?.amount, e?.result);
  const given = Number(e?.winner ?? e?.winnerOdds) || null;
  let winner;
  if (won && chosen) winner = chosen;
  else if (given && HORSES.some((h) => h.odds === given) && given !== chosen) winner = given;
  else {
    const others = HORSES.filter((h) => h.odds !== chosen);
    winner = others[seed % others.length].odds;
  }
  const rest = HORSES.filter((h) => h.odds !== winner);
  if (seed & 16) rest.reverse();
  // a lost bet: the chosen horse comes in last (the server's log says 꼴찌)
  if (!won && chosen && rest.some((h) => h.odds === chosen)) rest.sort((x, y) => (x.odds === chosen) - (y.odds === chosen));
  const order = [HORSES.find((h) => h.odds === winner), ...rest];
  const horses = HORSES.map((h) => {
    const place = order.indexOf(h) + 1;
    return {
      ...h,
      place,
      finishMs: 2300 + (place - 1) * 330 + ((seed >> (place * 3)) & 3) * 40,
      ease: place === 1 ? 'cubic-bezier(.62,0,.3,1)' : place === 2 ? 'cubic-bezier(.2,.45,.5,1)' : 'cubic-bezier(.25,.6,.6,1)',
      chosen: h.odds === chosen,
      winner: h.odds === winner,
    };
  });
  return { chosen, winner, won, durationMs: RACE_MS, horses };
}

// ---------- treasures ----------

/** Treasure definition (`/api/meta.treasures.treasures`), else a generic 💎. */
export function treasureInfo(id, meta = null) {
  const list = Array.isArray(meta?.treasures?.treasures) ? meta.treasures.treasures : Array.isArray(meta?.treasures) ? meta.treasures : [];
  const t = list.find((x) => x?.id === id);
  return {
    id,
    name: t?.name ?? (id ? String(id) : '보물'),
    icon: t?.icon ?? '💎',
    desc: t?.desc ?? '',
    min: Number.isFinite(Number(t?.min)) ? Number(t.min) : null,
    max: Number.isFinite(Number(t?.max)) ? Number(t.max) : null,
    fake: !!t?.fake,
  };
}

/** A character's treasures (`character.treasures [{uid, id}]`) with their info. */
export function treasuresOf(c, meta = null) {
  const list = Array.isArray(c?.treasures) ? c.treasures : [];
  return list
    .map((t) => (typeof t === 'string' ? { uid: t, id: t } : t))
    .filter((t) => t && (t.id || t.treasureId))
    .map((t) => ({ uid: t.uid ?? t.id, id: t.id ?? t.treasureId, info: treasureInfo(t.id ?? t.treasureId, meta) }));
}
export const treasureCount = (c) => (Array.isArray(c?.treasures) ? c.treasures.length : 0);

/**
 * Appraised value of one treasure (`room.result.treasures` row) → display text. Before the game ends (no row):
 * 「감정 전 ???」. A fake (row.fake, or a fake definition / value ≤ 0) → 「💥 가짜!」.
 */
export function treasureValueText(row, { won = (n) => `${n}만원`, meta = null } = {}) {
  if (!row || row.value == null) return { text: '감정 전 ???', fake: false, appraised: false, value: null };
  const fake = isFakeTreasure(row, meta);
  const value = Number(row.value) || 0;
  return { text: fake ? '💥 가짜!' : won(value), fake, appraised: true, value };
}

export function isFakeTreasure(row, meta = null) {
  if (typeof row?.fake === 'boolean') return row.fake;
  const def = treasureInfo(row?.treasureId ?? row?.id, meta);
  return def.fake || Number(row?.value) <= 0;
}
