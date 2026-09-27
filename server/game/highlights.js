// Stage 9 — life records & highlights (인생 결산 방송). Pure post-passes over an engine event batch.
//
// character.record (public counters for the ending titles): {minNet, maxDebt, bankruptcies, inDebt, worstRankPct,
//   luckWin, gambles, gambleNet, sabotage, sabotaged, rankUps, overtime, proposeFails, partners,
//   submaps {hometown, temple, jeju, reversal}} — `trackRecords` updates them from events.
// room.highlights = {charId: [{turnNo, type, text, tone, scene, emotion, amount?, score, eventRef}]} — the most
//   dramatic moments per character (top `balance.result.highlights.keep` by score, kept in chronological order).
//   `eventRef` = a scalar-only copy of the event (type, ids, amounts, line) so the client can rebuild a cut-in.
import { charById, josa, netWorth, won } from './effects.js';

export const ADULT_ERAS = ['young', 'middle_age', 'senior'];
const SUBMAP_KEYS = ['hometown', 'temple', 'jeju', 'reversal'];

export function initRecord(c) {
  return {
    minNet: netWorth(c),
    maxDebt: 0,
    bankruptcies: 0,
    inDebt: false,
    worstRankPct: 0,
    luckWin: 0,
    gambles: 0,
    gambleNet: 0,
    sabotage: 0,
    sabotaged: 0,
    rankUps: 0,
    overtime: 0,
    proposeFails: 0,
    partners: 0,
    submaps: Object.fromEntries(SUBMAP_KEYS.map((k) => [k, 0])),
  };
}

/** Fill Stage 9 character fields (older saves). */
export function ensureRecord(c) {
  const base = initRecord(c);
  c.record = { ...base, ...(c.record ?? {}), submaps: { ...base.submaps, ...(c.record?.submaps ?? {}) } };
  c.wishes ??= 0;
  return c;
}

/** 0 = the richest, 1 = the poorest (net worth; ties share the better rank). */
function rankPct(room, c) {
  const n = room.characters.length;
  if (n < 2) return 0;
  const mine = netWorth(c);
  const above = room.characters.filter((x) => netWorth(x) > mine).length;
  return above / (n - 1);
}

/**
 * Update `character.record` counters from events[from..] (the tx's events so far). Idempotent per event range:
 * the caller passes the index already processed. @returns the new processed index
 */
export function trackRecords(room, events, from = 0) {
  const get = (id) => {
    const c = id ? charById(room, id) : null;
    if (c && !c.record) ensureRecord(c);
    return c;
  };
  for (let i = from; i < events.length; i++) {
    const ev = events[i];
    const c = get(ev.charId);
    switch (ev.type) {
      case 'moneyChanged': {
        if (!c) break;
        const r = c.record;
        const debt = ev.debt ?? 0;
        if (debt > 0 && !r.inDebt) {
          r.inDebt = true;
          // a loss that pushed the character into debt (a 학자금 loan is not a bankruptcy); public event flag
          if (ev.delta < 0 && ev.reason !== 'tuition') {
            r.bankruptcies += 1;
            ev.bankrupt = true;
          }
        } else if (debt <= 0) r.inDebt = false;
        r.maxDebt = Math.max(r.maxDebt, debt);
        if (ev.reason === 'lotto' && ev.delta > 0) r.luckWin += ev.delta;
        if (ev.reason === 'reversal') {
          r.gambleNet += ev.delta;
          if (ev.delta > 0) r.luckWin += ev.delta;
        }
        break;
      }
      case 'submapResult':
        if (!c) break;
        if (!['leave', 'skip'].includes(ev.result)) c.record.submaps[ev.submap] = (c.record.submaps[ev.submap] ?? 0) + 1;
        if (ev.submap === 'reversal' && ev.result !== 'skip') c.record.gambles += 1;
        break;
      case 'cardUsed':
        if (c && ev.cardKind === 'sabotage' && !ev.auto) {
          c.record.sabotage += 1;
          const t = get(ev.targetId);
          if (t) t.record.sabotaged += 1;
        }
        break;
      case 'cardBlocked':
        if (c) c.record.sabotage += 1;
        break;
      case 'rankUp':
        if (c) c.record.rankUps += 1;
        break;
      case 'promptResolved':
        if (c && ev.kind === 'jobTile' && ev.result === 'overtime') c.record.overtime += 1;
        break;
      case 'proposed':
        if (c && !ev.success) c.record.proposeFails += 1;
        break;
      case 'met':
        if (c) c.record.partners += 1;
        break;
      case 'schoolMeet':
        for (const pr of ev.pairs ?? []) {
          const x = get(pr.charId);
          if (x) x.record.partners += 1;
        }
        break;
      case 'eraChanged':
        if (c && ADULT_ERAS.includes(ev.era)) c.record.worstRankPct = Math.max(c.record.worstRankPct, rankPct(room, c));
        break;
      default:
        break;
    }
  }
  for (const c of room.characters) {
    if (!c.record) ensureRecord(c);
    c.record.minNet = Math.min(c.record.minNet ?? netWorth(c), netWorth(c));
    c.record.maxDebt = Math.max(c.record.maxDebt, c.debt ?? 0);
  }
  return events.length;
}

// ---------- highlights ----------

const REF_SKIP = new Set(['mc', 'mcWeight', 'mcKey', 'mcStudio', 'cutin']);

/** Scalar-only copy of an event (+ partner / child / spouse names) for `eventRef`. */
export function eventRef(ev) {
  const out = {};
  for (const [k, v] of Object.entries(ev)) {
    if (REF_SKIP.has(k)) continue;
    if (v == null || ['string', 'number', 'boolean'].includes(typeof v)) out[k] = v;
  }
  for (const k of ['partner', 'spouse', 'child']) if (ev[k]?.name) out[`${k}Name`] = ev[k].name;
  return out;
}

const nameOf = (room, id) => charById(room, id)?.name ?? '';

/**
 * Highlight candidates of one event: [{charId, score, text, amount?}] (drama score: bigger = more dramatic).
 * Room-level events (lottoDraw, houseValueChanged, holidayResult) produce one per affected character.
 */
export function highlightsOf(ev, { room, data, events, index }) {
  const big = data?.balance?.result?.highlights?.bigMoney ?? 300;
  const c = ev.charId ? charById(room, ev.charId) : null;
  const n = c?.name ?? '';
  const out = [];
  const add = (charId, score, text, amount) => out.push({ charId, score, text, ...(amount != null ? { amount } : {}) });
  switch (ev.type) {
    case 'married':
      add(ev.charId, 8, `💒 ${josa(ev.spouse?.name ?? '', '과/와')} 결혼!`);
      break;
    case 'childBorn':
      add(ev.charId, ev.child?.talent === 'genius' ? 8 : 6, `👶 ${ev.child?.name ?? '아기'} 탄생!${ev.child?.talent === 'genius' ? ' (천재)' : ''}`);
      break;
    case 'proposed':
      if (!ev.success) add(ev.charId, 4, `💔 ${ev.partner?.name ?? ''}에게 프러포즈했다가 거절당했다`);
      break;
    case 'jobChanged': {
      const def = jobName(data, ev.jobId);
      if (ev.reason === 'hidden') add(ev.charId, 9, `🌟 숨은 직업 「${def}」 등극!`);
      else if (ev.reason === 'hire') add(ev.charId, 3, `💼 ${def} 취업`);
      break;
    }
    case 'rankUp': {
      const def = jobDefOf(data, ev.jobId);
      const top = (def?.ranks?.length ?? 1) <= ev.rank;
      add(ev.charId, top ? 7 : 3, `🎉 ${def?.name ?? ''} 「${ev.rankName ?? ''}」${top ? ' — 최고 직급!' : ' 승진'}`);
      break;
    }
    case 'hiddenJobUnlocked':
      add(ev.charId, 6, `🌟 숨은 직업 「${jobName(data, ev.jobId)}」 해금`);
      break;
    case 'injured':
      add(ev.charId, 3, '🤕 부상으로 쉬어야 했다');
      break;
    case 'treasureFound':
      add(ev.charId, 4, `🏺 보물 「${treasureName(data, ev.treasureId)}」 발견`);
      break;
    case 'submapResult': {
      const amt = ev.amount ?? 0;
      if (ev.submap === 'reversal') {
        if (ev.result === 'jackpot') add(ev.charId, 10 + amt / 500, `💥 인생역전 로또 1등! +${won(ev.prize ?? amt)}`, amt);
        else if (amt > 0) add(ev.charId, 4 + amt / 300, `🏇 인생역전 대성공 +${won(amt)}`, amt);
        else if (amt < 0) add(ev.charId, 2 + -amt / 300, `🏇 인생역전 실패 ${won(amt)}`, amt);
      } else if (ev.submap === 'temple' && ev.result === 'wishOk') add(ev.charId, 4 + (ev.wishes >= 3 ? 3 : 0), `🙏 사찰 소원 성취 (${ev.wishes}번째)`);
      else if (ev.submap === 'jeju' && ev.result === 'trip') add(ev.charId, 2, '🏝️ 제주도 여행');
      else if (ev.submap === 'hometown') add(ev.charId, 1.5, ev.result === 'rest' ? '🏡 고향에서 푹 쉬었다' : '🏡 고향에 안부 인사');
      else if (ev.submap === 'temple' && ev.result === 'train') add(ev.charId, 2, '🧘 템플스테이 수련');
      break;
    }
    case 'houseBought':
      add(ev.charId, ev.lucky ? 7 : 5, `🏠 ${houseName(data, ev.houseId)} ${ev.swap ? '갈아타기' : '내 집 마련'}`, -(ev.price ?? 0));
      break;
    case 'houseValueChanged':
      for (const ch of ev.changes ?? []) {
        const d = (ch.after ?? 0) - (ch.before ?? 0);
        if (Math.abs(d) >= big / 2) add(ch.charId, 3 + Math.abs(d) / 300, `${d >= 0 ? '📈 집값 폭등' : '📉 집값 폭락'} ${d >= 0 ? '+' : ''}${won(d)}`, d);
      }
      break;
    case 'lottoDraw':
      for (const e of ev.entries ?? []) if (e.prize > 0) add(e.charId, 4 + e.prize / 300, `🎱 전국 로또 ${e.matches}개 적중! +${won(e.prize)}`, e.prize);
      break;
    case 'holidayResult':
      for (const r of ev.results ?? []) if (Math.abs(r.won ?? 0) >= 100) add(r.charId, 2 + Math.abs(r.won) / 200, `🎴 고스톱 ${r.won > 0 ? '대박' : '쪽박'} ${r.won > 0 ? '+' : ''}${won(r.won)}`, r.won);
      break;
    case 'cardUsed':
      if (ev.cardKind === 'sabotage' && !ev.auto && ev.targetId) {
        const card = cardName(data, ev.cardId);
        add(ev.targetId, 5, `😱 ${n}의 「${card}」 뒤통수를 맞았다`);
        add(ev.charId, 3, `🗡️ ${nameOf(room, ev.targetId)}에게 「${card}」 뒤통수!`);
      }
      break;
    case 'cardBlocked':
      add(ev.targetId, 4, `⚖️ ${n}의 뒤통수를 변호사 카드로 막았다`);
      break;
    case 'promptResolved':
      if (ev.kind === 'exam' && ev.result === 'elite') add(ev.charId, 5, '📝 수능 대박, 명문대 합격!');
      else if (ev.kind === 'exam' && ev.result === 'fail') add(ev.charId, 3, '📝 수능 불합격…');
      break;
    case 'educationChanged':
      add(ev.charId, 2.5, `🎓 ${ev.education === 'elite' ? '명문대' : '대학'} 졸업`);
      break;
    case 'finished': {
      const last = ev.place === room.characters.length && room.characters.length > 2;
      add(ev.charId, ev.place === 1 ? 8 : last ? 5 : 3, `🏁 ${ev.place}등으로 골인!${ev.place === 1 ? ' 인생 급행열차' : last ? ' 느긋하게 마지막으로' : ''}`, ev.prize ?? 0);
      break;
    }
    case 'moneyChanged': {
      if (!c) break;
      const d = ev.delta ?? 0;
      // a loss that pushed the character into debt (from no debt) = 파산 위기
      if (ev.bankrupt) add(ev.charId, 7, `💸 빚더미에 앉았다 (빚 ${won(ev.debt)})`, d);
      else if (Math.abs(d) >= big && !OWN_HIGHLIGHT_REASONS.has(ev.reason)) add(ev.charId, 3 + Math.abs(d) / 300, `${d > 0 ? '💰 큰돈이 들어왔다' : '💸 큰돈이 나갔다'} ${d > 0 ? '+' : ''}${won(d)}`, d);
      break;
    }
    default:
      break;
  }
  void events;
  void index;
  return out;
}

/** moneyChanged reasons whose own event already makes the highlight (house purchase, lotto, gambling, goal…). */
const OWN_HIGHLIGHT_REASONS = new Set(['house', 'lotto', 'reversal', 'goalPrize', 'bonusSpin', 'gostop']);

function jobDefOf(data, id) {
  if (!id) return null;
  if (id === data?.jobs?.partTime?.id) return data.jobs.partTime;
  return data?.jobs?.jobs?.find((j) => j.id === id) ?? null;
}
const jobName = (data, id) => jobDefOf(data, id)?.name ?? '';
const treasureName = (data, id) => data?.treasures?.treasures?.find((t) => t.id === id)?.name ?? '보물';
const houseName = (data, id) => data?.houses?.houses?.find((h) => h.id === id)?.name ?? '집';
const cardName = (data, id) => data?.cards?.cards?.find((k) => k.id === id)?.name ?? '카드';

/**
 * Record the batch's highlights into `room.highlights` (after the presentation pass, so tone / scene / line are
 * set). Keeps the top `keep` per character by score (ties → the earlier one), stored in chronological order.
 */
export function recordHighlights(room, events, { data } = {}) {
  if (!room || !events?.length) return room?.highlights;
  const keep = data?.balance?.result?.highlights?.keep ?? 8;
  room.highlights ??= {};
  // the batch may span a turn change: count back from the room's turn number, follow turnStarted events
  let turnNo = (room.turn?.turnNo ?? 0) - events.filter((e) => e.type === 'turnStarted').length;
  events.forEach((ev, index) => {
    if (ev.type === 'turnStarted') turnNo = ev.turnNo ?? turnNo + 1;
    for (const h of highlightsOf(ev, { room, data, events, index })) {
      if (!h.charId || !charById(room, h.charId)) continue;
      const list = (room.highlights[h.charId] ??= []);
      const seq = (room.highlightSeq = (room.highlightSeq ?? 0) + 1);
      list.push({
        seq,
        turnNo,
        type: ev.type,
        text: h.text,
        tone: ev.tone ?? 'neutral',
        scene: ev.scene ?? 'none',
        emotion: ev.emotion ?? 'neutral',
        era: charById(room, h.charId)?.era ?? null,
        ...(h.amount != null ? { amount: h.amount } : {}),
        score: Math.round(h.score * 100) / 100,
        eventRef: eventRef(ev),
      });
      if (list.length > keep) {
        const drop = list.reduce((w, x, i) => (w < 0 || x.score < list[w].score || (x.score === list[w].score && x.seq > list[w].seq) ? i : w), -1);
        list.splice(drop, 1);
      }
    }
  });
  return room.highlights;
}

/** The best `n` highlights per character (by score, ties → earlier), in chronological order. */
export function topHighlights(highlights, n = 5) {
  const out = {};
  for (const [id, list] of Object.entries(highlights ?? {})) {
    out[id] = [...list]
      .sort((a, b) => b.score - a.score || a.seq - b.seq)
      .slice(0, n)
      .sort((a, b) => a.seq - b.seq);
  }
  return out;
}
