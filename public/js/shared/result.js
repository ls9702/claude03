// Stage 9 pure client helpers for the result show (인생 결산 방송) — no DOM, node-tested in test/client-result.test.js.
// Everything is driven by `room.result` (identical for every viewer, no local randomness):
//
//   rankRows(result, characters)        → normalized ranking rows (rank with ties, breakdown fields)
//   breakdown(row) / breakdownBars(rows) → stacked bar segments (현금 · 집 · 아이템 · 보물 · 특별상) + debt
//   podiumLayout(rows)                  → 3 podium steps (ties share a step) + the others
//   appraisalRows / awardCards / titleBadges
//   planResultShow(result, opts)        → show steps with durations (highlights ≤ 60 s budget)
//   mvpState / voteButtons              → MVP vote rules (players only, not my own character when possible, deadline)
//   photoLayout(n) / PHOTO_POSES / photoTitle / photoFileName → 단체 사진
import { treasureInfo, treasureValueText } from './submaps.js';

export const MEDALS = ['🥇', '🥈', '🥉'];
export const medal = (rank) => MEDALS[rank - 1] ?? `${rank}위`;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
/** A ranking field that may be a number or a list of `{value}` / `{bonus}` rows. */
const sumOf = (v, key = 'value') => (Array.isArray(v) ? v.reduce((s, x) => s + num(typeof x === 'object' ? x?.[key] : x), 0) : num(v));

/**
 * Ranking rows (best first). `rank` = the server's rank, else competition ranking by total (ties share a rank).
 * `place` stays the goal arrival order when the server sends `rank` too.
 */
export function rankRows(result, characters = []) {
  const ranking = Array.isArray(result?.ranking) ? result.ranking : [];
  const cmap = new Map((characters ?? []).map((c) => [c.id, c]));
  let prev = null;
  return ranking.map((r, i) => {
    const total = num(r.total);
    const rank = Number(r.rank) > 0 ? Number(r.rank) : prev && prev.total === total ? prev.rank : i + 1;
    prev = { total, rank };
    const char = cmap.get(r.charId) ?? null;
    return {
      charId: r.charId,
      name: r.name ?? char?.name ?? '',
      rank,
      place: r.place ?? null,
      money: num(r.money),
      debt: num(r.debt),
      items: sumOf(r.items),
      house: sumOf(r.house),
      treasures: sumOf(r.treasures),
      awards: sumOf(r.awards, 'bonus'),
      goalBonus: num(r.goalBonus),
      total,
      char,
      raw: r,
    };
  });
}

/** Breakdown parts of the total (stacked bar, legend). */
export const BREAKDOWN = Object.freeze([
  { key: 'cash', label: '현금', icon: '💰', color: '#f2b33d' },
  { key: 'house', label: '집', icon: '🏠', color: '#c7773a' },
  { key: 'items', label: '아이템', icon: '🛍️', color: '#9a6ad6' },
  { key: 'treasures', label: '보물', icon: '💎', color: '#20a39e' },
  { key: 'awards', label: '특별상', icon: '🏅', color: '#e2504c' },
]);

/** One row → positive segments + the negative part (debt beyond cash, a fake-heavy…): Σ segments − negative = total. */
export function breakdown(row) {
  const parts = { cash: num(row?.money) - num(row?.debt), house: num(row?.house), items: num(row?.items), treasures: num(row?.treasures), awards: num(row?.awards) };
  const segments = BREAKDOWN.filter((b) => parts[b.key] > 0).map((b) => ({ ...b, value: parts[b.key] }));
  const negative = Object.values(parts).reduce((s, v) => s + (v < 0 ? -v : 0), 0);
  return { segments, negative, positive: segments.reduce((s, x) => s + x.value, 0) };
}

/** Bars for every row, widths in % of the largest positive sum (the biggest bar is 100 %). */
export function breakdownBars(rows = []) {
  const all = rows.map((r) => breakdown(r));
  const max = Math.max(1, ...all.map((b) => b.positive), ...all.map((b) => b.negative));
  return all.map((b, i) => ({
    charId: rows[i].charId,
    segments: b.segments.map((s) => ({ ...s, pct: Math.round((s.value / max) * 1000) / 10 })),
    negative: b.negative,
    negPct: Math.round((b.negative / max) * 1000) / 10,
  }));
}

/**
 * Podium: steps 1–3 (visual order 2 · 1 · 3), tied ranks share a step (a rank that a tie skipped leaves its step empty).
 * @returns {{steps: {place, rows, height}[], order: number[], others: object[]}}
 */
export function podiumLayout(rows = []) {
  const heights = { 1: 1, 2: 0.72, 3: 0.52 };
  const steps = [1, 2, 3].map((place) => ({ place, rows: rows.filter((r) => r.rank === place), height: heights[place] }));
  return { steps, order: [2, 1, 3], others: rows.filter((r) => r.rank > 3) };
}

/**
 * 보물 감정 rows from `result.treasures [{charId, uid, treasureId, value, fake?}]`, cheapest first (the most valuable
 * reveal comes last). Ties → owner rank, then uid.
 */
export function appraisalRows(result, characters = [], { meta = null, won = (n) => `${n}만원` } = {}) {
  const list = Array.isArray(result?.treasures) ? result.treasures : [];
  const cmap = new Map((characters ?? []).map((c) => [c.id, c]));
  const rankOf = new Map(rankRows(result, characters).map((r) => [r.charId, r.rank]));
  return list
    .map((t) => {
      const info = treasureInfo(t.treasureId ?? t.id, meta);
      const v = treasureValueText(t, { won, meta });
      return { charId: t.charId, name: cmap.get(t.charId)?.name ?? '', char: cmap.get(t.charId) ?? null, uid: t.uid ?? '', treasureId: t.treasureId ?? t.id, info, value: v.value ?? 0, fake: v.fake, text: v.text };
    })
    .sort((a, b) => a.value - b.value || (rankOf.get(b.charId) ?? 0) - (rankOf.get(a.charId) ?? 0) || String(a.uid).localeCompare(String(b.uid)));
}

/** Σ appraised value per character. */
export function appraisalTotals(rows = []) {
  const out = {};
  for (const r of rows) out[r.charId] = (out[r.charId] ?? 0) + (r.fake ? 0 : r.value);
  return out;
}

const defsOf = (x, key) => (Array.isArray(x?.[key]) ? x[key] : Array.isArray(x) ? x : []);

/** 특별상 cards: `result.awards [{id, name, charIds, bonus}]` + `/api/meta.awards` (icon, desc). */
export function awardCards(result, characters = [], { meta = null, won = (n) => `${n}만원` } = {}) {
  const defs = defsOf(meta?.awards, 'awards');
  const cmap = new Map((characters ?? []).map((c) => [c.id, c]));
  return (Array.isArray(result?.awards) ? result.awards : []).map((a) => {
    const d = defs.find((x) => x?.id === a.id) ?? {};
    const ids = Array.isArray(a.charIds) ? a.charIds : a.charId ? [a.charId] : [];
    const bonus = num(a.bonus);
    return {
      id: a.id,
      name: a.name ?? d.name ?? a.id,
      icon: a.icon ?? d.icon ?? '🏅',
      desc: a.desc ?? d.desc ?? '',
      winners: ids.map((id) => ({ charId: id, name: cmap.get(id)?.name ?? '', char: cmap.get(id) ?? null })),
      bonus,
      bonusText: bonus > 0 ? `+${won(bonus)}` : '',
      line: typeof a.line === 'string' ? a.line : '', // the winner's acceptance line (server)
    };
  });
}

/** 칭호 badges per character: `result.titles {charId: [titleId]}` + `/api/meta.titles` ({id, name, icon, desc}). */
export function titleBadges(result, { meta = null } = {}) {
  const defs = defsOf(meta?.titles, 'titles');
  const out = {};
  for (const [charId, ids] of Object.entries(result?.titles ?? {})) {
    out[charId] = (Array.isArray(ids) ? ids : [ids]).filter(Boolean).map((t) => {
      const id = typeof t === 'object' ? t.id : t;
      const d = defs.find((x) => x?.id === id) ?? (typeof t === 'object' ? t : {});
      return { id, name: d.name ?? id, icon: d.icon ?? '🎖️', desc: d.desc ?? '' };
    });
  }
  return out;
}

// ---------- the show plan ----------
export const HIGHLIGHT_BUDGET_MS = 60000;
export const SLIDE_MS = 1500;
export const MIN_SLIDE_MS = 1100;
export const PER_CHAR = 3;

/**
 * Highlight slides: characters in final place order LAST → FIRST, ≤ `perChar` highlights each (turn order), all within
 * `budgetMs` (fewer highlights per character first, then shorter slides down to `minSlideMs`).
 */
export function highlightSlides(result, characters = [], { perChar = PER_CHAR, slideMs = SLIDE_MS, minSlideMs = MIN_SLIDE_MS, budgetMs = HIGHLIGHT_BUDGET_MS } = {}) {
  const rows = rankRows(result, characters).slice().reverse();
  const all = rows.map((r) => {
    const list = Array.isArray(result?.highlights?.[r.charId]) ? result.highlights[r.charId] : [];
    return { row: r, list: list.filter((h) => h && (h.text || h.type)).slice().sort((a, b) => num(a.turnNo) - num(b.turnNo)) };
  });
  let per = Math.max(1, perChar);
  const count = (p) => all.reduce((s, x) => s + Math.min(p, x.list.length), 0);
  while (per > 1 && count(per) * slideMs > budgetMs) per--;
  const n = count(per);
  const ms = n ? Math.max(minSlideMs, Math.min(slideMs, Math.floor(budgetMs / n))) : slideMs;
  const maxSlides = Math.floor(budgetMs / ms);
  const slides = [];
  for (const { row, list } of all) {
    const picked = pickHighlights(list, per);
    picked.forEach((h, i) => {
      if (slides.length >= maxSlides) return;
      slides.push({
        charId: row.charId,
        name: row.name,
        rank: row.rank,
        index: i,
        count: picked.length,
        turnNo: h.turnNo ?? null,
        type: h.type ?? 'log',
        text: String(h.text ?? ''),
        tone: h.tone ?? 'neutral',
        scene: h.scene ?? 'none',
        amount: Number.isFinite(Number(h.amount)) ? Number(h.amount) : null,
        emotion: h.emotion ?? null,
        line: h.eventRef?.line ?? h.line ?? null, // the character's speech bubble of that moment
        era: h.era ?? null,
        ms,
      });
    });
  }
  return slides;
}

/** Keep the server order (turn order) but spread the picks over the lifetime when there are more than `n`. */
function pickHighlights(list, n) {
  if (list.length <= n) return list;
  if (n === 1) return [list[list.length - 1]];
  const out = [];
  for (let i = 0; i < n; i++) out.push(list[Math.round((i * (list.length - 1)) / (n - 1))]);
  return out.filter((h, i, a) => a.indexOf(h) === i);
}

/**
 * Show steps in order: intro (MC studio) → highlights → 보물 감정 → 특별상 (+ 칭호) → 최종 순위 → 시상대. Steps without data
 * are left out (no treasures → no appraisal). `ms` = the planned duration (the UI may run shorter when skipped).
 * @returns {{steps: {id, ms, slides?, rows?, cards?, titles?}[], totalMs: number}}
 */
export function planResultShow(result, { characters = [], meta = null, introMs = 6000, won = (n) => `${n}만원`, budgetMs = HIGHLIGHT_BUDGET_MS } = {}) {
  const steps = [{ id: 'intro', ms: Math.max(2500, introMs) }];
  const slides = highlightSlides(result, characters, { budgetMs });
  if (slides.length) steps.push({ id: 'highlights', slides, ms: slides.reduce((s, x) => s + x.ms, 0) });
  const rows = appraisalRows(result, characters, { meta, won });
  if (rows.length) steps.push({ id: 'appraisal', rows, flipMs: appraisalFlipMs(rows.length), ms: 2200 + rows.length * appraisalFlipMs(rows.length) + 2400 });
  const cards = awardCards(result, characters, { meta, won });
  const titles = titleBadges(result, { meta });
  const nTitles = Object.values(titles).reduce((s, x) => s + x.length, 0);
  if (cards.length || nTitles) steps.push({ id: 'awards', cards, titles, ms: 1500 + cards.length * 2200 + (nTitles ? 3500 : 0) });
  const nRows = rankRows(result, characters).length;
  steps.push({ id: 'ranking', ms: 2500 + nRows * 450 + 2500 });
  steps.push({ id: 'podium', ms: 6000 });
  return { steps, totalMs: steps.reduce((s, x) => s + x.ms, 0) };
}
/** Time per treasure flip: 1 s, shorter with many treasures (the step stays ≤ ~20 s). */
export const appraisalFlipMs = (n) => Math.max(450, Math.min(1000, Math.floor(15000 / Math.max(1, n))));

/** MC lines of the result by part (`result.mc` = [{speaker, line, …, part}]). */
export function mcParts(result) {
  const out = {};
  for (const l of Array.isArray(result?.mc) ? result.mc : []) (out[l.part ?? 'intro'] ??= []).push(l);
  return out;
}

/** Built-in MC lines for the Stage 9 parts when the server has none (호야 always says 멍). */
export const FALLBACK_MC = Object.freeze({
  appraisal: [
    { speaker: 'bomi', line: '지금부터 보물 감정 결과를 공개하겠습니다.', expression: 'neutral', pose: 'mic' },
    { speaker: 'hoya', line: '두근두근! 진짜일까 가짜일까 멍?', expression: 'surprise', pose: 'clap' },
  ],
  awards: [
    { speaker: 'bomi', line: '이어서 특별상 시상이 있겠습니다.', expression: 'proud', pose: 'mic' },
    { speaker: 'hoya', line: '상금도 준대 멍! 부럽다 멍!', expression: 'joy', pose: 'clap' },
  ],
  mvp: [
    { speaker: 'hoya', line: '{name} MVP 축하한다 멍! 최고다 멍!', expression: 'joy', pose: 'clap' },
    { speaker: 'bomi', line: '오늘의 MVP는 {name}입니다. 흥, 인정합니다.', expression: 'proud', pose: 'mic' },
  ],
});
export function fallbackMc(part, vars = {}) {
  return (FALLBACK_MC[part] ?? []).map((l) => ({ ...l, part, line: l.line.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)) }));
}

// ---------- MVP vote ----------

/**
 * MVP vote state of a finished room (`result.mvp {votes {playerId: charId}, winner?, closesAt}`); null = no vote.
 * Spectators (and viewers without a seat) only see the results.
 */
export function mvpState(room, { now = Date.now() } = {}) {
  const mvp = room?.result?.mvp;
  if (!mvp || typeof mvp !== 'object') return null;
  const votes = mvp.votes && typeof mvp.votes === 'object' ? mvp.votes : {};
  const counts = {};
  for (const t of Object.values(votes)) if (t) counts[t] = (counts[t] ?? 0) + 1;
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  const closesAt = Number(mvp.closesAt) || null;
  const winner = mvp.winner ?? null;
  const open = room.status === 'finished' && !winner && !mvp.closed && (!closesAt || now < closesAt);
  const me = room.me ?? null;
  const spectator = !me || me.role === 'spectator';
  const max = Math.max(0, ...Object.values(counts));
  return {
    open,
    decided: !!winner,
    winner,
    closesAt,
    counts,
    total,
    myVote: me && !spectator ? votes[me.id] ?? null : null,
    spectator,
    canVote: open && !spectator,
    leaders: max > 0 ? Object.keys(counts).filter((id) => counts[id] === max) : [],
  };
}

/**
 * Vote buttons per character: players vote once (changeable while open) for anyone but their own characters — unless
 * every character is theirs. `disabled` + Korean `reason`; `voted` = my current vote.
 */
export function voteButtons(room, { now = Date.now() } = {}) {
  const st = mvpState(room, { now });
  if (!st) return [];
  const chars = room.characters ?? [];
  const allMine = chars.length > 0 && chars.every((c) => c.isMe);
  return chars.map((c) => {
    const own = !!c.isMe && !allMine;
    let reason = null;
    if (st.spectator) reason = '관전자는 결과만 볼 수 있어요';
    else if (st.decided) reason = 'MVP가 정해졌어요';
    else if (!st.open) reason = '투표가 마감됐어요';
    else if (own) reason = '내 캐릭터에는 투표할 수 없어요';
    const voted = st.myVote === c.id;
    return {
      charId: c.id,
      name: c.name,
      count: st.counts[c.id] ?? 0,
      voted,
      own: !!c.isMe,
      disabled: !!reason || voted,
      reason: reason ?? (voted ? '이미 이 캐릭터에 투표했어요' : null),
      showButton: !st.spectator,
      winner: st.winner === c.id,
      leader: st.leaders.includes(c.id),
    };
  });
}

/** Countdown text: 「1:05」 from a minute on, else 「9초」. */
export function countdownText(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}초`;
}

// ---------- 단체 사진 ----------
export const PHOTO_W = 1600;
export const PHOTO_H = 1000;
/** Figure aspect (width / height) of a full-body composed avatar (partStack CROP 848 × 1376). */
export const FIGURE_ASPECT = 848 / 1376;
export const PHOTO_POSES = Object.freeze([
  { id: 'v', label: '브이', icon: '✌️', expression: 'joy', pose: 'wave', glyph: '✌️' },
  { id: 'banzai', label: '만세', icon: '🙌', expression: 'joy', pose: 'cheer', glyph: '🙌' },
  { id: 'heart', label: '하트', icon: '🫶', expression: 'love', pose: 'idle', glyph: '💕' },
  { id: 'jump', label: '점프', icon: '🦘', expression: 'joy', pose: 'jump', glyph: '✨' },
]);
export const photoPose = (id) => PHOTO_POSES.find((p) => p.id === id) ?? PHOTO_POSES[0];

/** Slot indices from the centre outwards (rank 1 in the middle, 2 left of it, 3 right, …). */
export function centerOut(n) {
  const out = [];
  if (n <= 0) return out;
  const mid = (n - 1) / 2;
  const idx = [...Array(n).keys()].sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b);
  for (const i of idx) out.push(i);
  return out;
}

/**
 * Figure positions for 1–8 characters given in rank order: one row up to 4, else the top half in the front row and the
 * rest behind (smaller, higher, between the front figures). `x` = centre, `y` = feet, `h` / `w` = figure box; `z` =
 * draw order (back row first); `labelY` = name label centre (under the feet in front, above the head in the back).
 */
export function photoLayout(n, { width = PHOTO_W, height = PHOTO_H } = {}) {
  const count = Math.max(0, Math.min(8, Math.floor(n)));
  if (!count) return [];
  const ground = height * 0.86;
  const frontN = count <= 4 ? count : Math.ceil(count / 2);
  const backN = count - frontN;
  const frontH = Math.min(height * 0.64, ((width * 0.92) / frontN / FIGURE_ASPECT) * 0.98);
  const out = new Array(count);
  const front = centerOut(frontN);
  for (let k = 0; k < frontN; k++) {
    const slot = front[k];
    const x = (width * (slot + 0.5)) / frontN;
    out[k] = { x: Math.round(x), y: Math.round(ground), h: Math.round(frontH), w: Math.round(frontH * FIGURE_ASPECT), row: 'front', z: 10 + k, labelY: Math.round(ground + height * 0.065) };
  }
  if (backN) {
    const backH = frontH * 0.84;
    const backY = ground - height * 0.12;
    const back = centerOut(backN);
    for (let k = 0; k < backN; k++) {
      const slot = back[k];
      const x = (width * (slot + 1)) / (backN + 1);
      out[frontN + k] = { x: Math.round(x), y: Math.round(backY), h: Math.round(backH), w: Math.round(backH * FIGURE_ASPECT), row: 'back', z: k, labelY: Math.round(backY - backH * 0.93) };
    }
  }
  return out;
}

/** Per-figure pose offsets (fraction of the figure height / radians), deterministic: 점프 alternates heights. */
export function poseOffset(poseId, i) {
  switch (poseId) {
    case 'jump':
      return { lift: i % 2 ? 0.07 : 0.12, tilt: i % 2 ? -0.05 : 0.05 };
    case 'banzai':
      return { lift: 0.02, tilt: 0 };
    case 'heart':
      return { lift: 0, tilt: i % 2 ? 0.06 : -0.06 };
    default:
      return { lift: 0, tilt: i % 2 ? -0.03 : 0.03 };
  }
}

const pad = (n) => String(n).padStart(2, '0');
/** 「인생게임 · 방 ABC123 · 2026. 9. 27.」 */
export function photoTitle({ code = '', date = new Date() } = {}) {
  const d = date instanceof Date ? date : new Date(date);
  return `인생게임 · 방 ${code} · ${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}
export function photoFileName({ code = '', date = new Date() } = {}) {
  const d = date instanceof Date ? date : new Date(date);
  return `jinsei-${String(code).replace(/[^A-Za-z0-9]/g, '') || 'room'}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.png`;
}
