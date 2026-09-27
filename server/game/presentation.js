// Event presentation (Stage 5): pure post-pass that gives every engine event the fields the client needs
// for cut-ins / sound — `tone` (frame theme), `emotion`, `scene` (cut-in background id), `line` (speech
// bubble text from lines.json) and `cutin` (full-screen cut-in vs. stay on the board).
//
// Lines are picked with a sub-RNG seeded from the engine RNG state + event index, so every client shows the
// same text without consuming the gameplay RNG stream (existing seeds keep their outcomes).
import { getBoardData, getCards, getEvents, getHouses, getItems, getJobs, getLines, getMc, getNews, getTones } from '../data/index.js';
import { createRng } from './rng.js';
import { MC_FREQUENCIES } from './config.js';

export const TONES = ['love', 'career', 'treasure', 'good', 'bad', 'holiday', 'result', 'neutral'];
export const SCENES = [
  'school', 'mountain-trail', 'wedding-hall', 'office', 'hospital',
  // Stage 7 (bg assets may still be todo → the client draws tones.json `sceneFallbacks`)
  'stage', 'stadium', 'gym', 'army', 'campus', 'kitchen', 'police', 'lab', 'space', 'shop', 'holiday',
  // Stage 8 (bg todo → tones.json sceneFallbacks: park → mountain-trail, house → office)
  'park', 'house',
  'none',
];
export const EMOTIONS = ['joy', 'cry', 'angry', 'sweat', 'love', 'shock', 'neutral'];

/** Every event type the engine emits (tests assert each one gets a full presentation). */
export const EVENT_TYPES = [
  'gameStarted', 'turnStarted', 'spun', 'moved', 'landed', 'moneyChanged', 'eraChanged', 'routeChosen', 'finished',
  'bonusSpin', 'betPlaced', 'betResolved', 'prompt', 'chose', 'promptResolved', 'gameOver', 'log',
  // Stage 6 — stats, careers, jobs
  'statChanged', 'jobChanged', 'rankUp', 'salary', 'injured', 'hiddenJobUnlocked', 'newsFlash', 'militaryStart',
  'militaryEnd', 'educationChanged',
  // Stage 7 — cards, items, interaction
  'cardGained', 'cardUsed', 'cardBlocked', 'itemBought', 'tradeOffered', 'tradeResolved', 'gift', 'holidayStarted',
  'holidayResult', 'lottoDraw',
  // Stage 8 — romance, family, real estate
  'met', 'dated', 'proposed', 'married', 'schoolMeet', 'childBorn', 'childGrew', 'allowance', 'houseBought', 'houseSold',
  'houseValueChanged',
];

/** Types that always get a full cut-in (landed only for `tones.cutinTiles`). statChanged / salary / militaryEnd are chips. */
export const CUTIN_TYPES = new Set([
  'eraChanged', 'routeChosen', 'finished', 'gameOver', 'prompt', 'promptResolved',
  'jobChanged', 'rankUp', 'hiddenJobUnlocked', 'injured', 'newsFlash', 'militaryStart', 'educationChanged',
  // Stage 7 (cardUsed only for sabotage / 공약 — see isCutinCardUse)
  'cardBlocked', 'itemBought', 'holidayStarted', 'holidayResult', 'lottoDraw',
  // Stage 8 (childGrew only for 돌잔치 / 수능 / 취업 — see isCutinChildGrew; dated / allowance / houseSold are chips)
  'met', 'proposed', 'married', 'schoolMeet', 'childBorn', 'houseBought', 'houseValueChanged',
]);

/** Stage 8: child growth steps with a full cut-in (입학 = a cost chip). */
export const isCutinChildGrew = (ev) => ev?.type === 'childGrew' && ['dol', 'exam', 'job'].includes(ev.kind);

/** Stage 7: a card use that gets a full cut-in (sabotage / 공약); passive triggers and self cards are chips. */
export const isCutinCardUse = (ev) => ev?.type === 'cardUsed' && !ev.auto && (ev.cardKind === 'sabotage' || ev.cardId === 'pledge');

/** Events whose follow-ups (money, stats, logs) belong to them; the scan for followers stops at the next one. */
const BOUNDARY = new Set([
  'turnStarted', 'spun', 'moved', 'landed', 'eraChanged', 'routeChosen', 'finished', 'bonusSpin', 'prompt', 'chose',
  'promptResolved', 'gameOver', 'betPlaced',
  'jobChanged', 'rankUp', 'hiddenJobUnlocked', 'injured', 'newsFlash', 'militaryStart', 'militaryEnd', 'educationChanged',
  'cardBlocked', 'itemBought', 'tradeOffered', 'tradeResolved', 'gift', 'holidayStarted', 'holidayResult', 'lottoDraw',
  'met', 'proposed', 'married', 'schoolMeet', 'childBorn', 'houseBought', 'houseValueChanged',
]);
/**
 * Boundary test (Stage 7: an anchored card use is a boundary, a passive trigger / self card is a follow-up;
 * Stage 8: a cut-in child growth step is one, 입학 / dated / allowance / houseSold are follow-ups).
 */
export const isBoundary = (ev) => BOUNDARY.has(ev.type) || isCutinCardUse(ev) || isCutinChildGrew(ev);
/** Stage 8 anchors that take over a heart / house landing (the landing itself then stays on the board). */
const STAGE8_TAKEOVER = new Set(['met', 'proposed', 'married', 'childBorn', 'houseBought']);

const PROMPT_TONES = {
  routeChoice: 'good', exam: 'career', groupGift: 'holiday', habit: 'good', career: 'career', military: 'neutral',
  jobOffer: 'career', jobTile: 'career', hiddenJobOffer: 'result', shop: 'treasure', holiday: 'holiday',
  meet: 'love', date: 'love', propose: 'love', house: 'treasure',
};
const PROMPT_TAGS = {
  routeChoice: 'route_choice', exam: 'exam', groupGift: 'gift', habit: 'habit', career: 'career', military: 'military',
  jobOffer: 'job_offer', jobTile: 'job', hiddenJobOffer: 'hidden_job', shop: 'shop', holiday: 'holiday',
  meet: 'heart', date: 'date', propose: 'propose', house: 'house',
};
const PROMPT_EMOTIONS = {
  exam: 'sweat', groupGift: 'love', routeChoice: 'joy', habit: 'joy', career: 'sweat', military: 'sweat', jobOffer: 'joy',
  jobTile: 'neutral', hiddenJobOffer: 'shock', shop: 'joy', holiday: 'joy', meet: 'love', date: 'love', propose: 'love',
  house: 'joy',
};
const PROMPT_SCENES = { shop: 'shop', holiday: 'holiday', meet: 'park', date: 'park', propose: 'park', house: 'house' };
const GROW_TAGS = { dol: 'dol', school: 'child_school', exam: 'child_exam', job: 'child_job' };
const GROW_SCENES = { dol: 'wedding-hall', school: 'school', exam: 'school', job: 'office' };
const JOB_TAGS = { hire: 'hire', change: 'job_change', hidden: 'hidden_job', parttime: 'parttime' };
const JOB_TILE_TAGS = { failed: 'job_fail', blocked: 'injury', overtime: 'overtime', bonus: 'salary', noBonus: 'job_fail', promoted: 'promotion', changed: 'job_change' };
const EXAM_TAGS = { elite: 'exam_elite', college: 'exam_college', fail: 'exam_fail' };
const STAT_LABELS = { int: '지력', str: '체력', charm: '매력', luck: '운' };

/** Job definition (jobs.json or the part-time job) for presentation vars / scenes. */
function jobOf(data, id) {
  const jobs = data?.jobs ?? getJobs();
  if (!id) return null;
  if (id === jobs.partTime?.id) return jobs.partTime;
  return jobs.jobs?.find((j) => j.id === id) ?? null;
}
const cardName = (data, id) => (data?.cards ?? getCards()).cards?.find((k) => k.id === id)?.name ?? '';
const itemName = (data, id) => (data?.items ?? getItems()).items?.find((i) => i.id === id)?.name ?? '';
const holidayName = (data, kind) => data?.holidays?.names?.[kind] ?? { seol: '설날', chuseok: '추석' }[kind] ?? '';
const eventOf = (data, id) => (id ? (data?.events ?? getEvents()).events?.find((e) => e.id === id) ?? null : null);
const newsOf = (data, id) => (id ? (data?.news ?? getNews()).news?.find((n) => n.id === id) ?? null : null);
const houseName = (data, id) => (id ? (data?.houses ?? getHouses()).houses?.find((h) => h.id === id)?.name ?? '' : '');
/** Stage 8: partner / spouse / child names of a character for line vars. */
function familyVars(ev, c) {
  const partner = ev.partner?.name ?? ev.spouse?.name ?? c?.love?.partner?.name ?? c?.spouse?.name ?? '';
  const child = ev.child?.name ?? (ev.childId ? c?.children?.find((k) => k.id === ev.childId)?.name : '') ?? '';
  return { partner, child: child || (ev.childId ? '우리 아이' : '') };
}
const TONE_EMOTION = { good: 'joy', bad: 'cry', love: 'love', result: 'joy', treasure: 'joy', holiday: 'joy', career: 'joy', neutral: 'neutral' };
const BIG_GAIN = 100; // 만원 — money_gain vs big_gain line pool

/** 32-bit FNV-1a over the stringified parts. */
export function hashSeed(...parts) {
  let h = 0x811c9dc5;
  const s = parts.map((p) => String(p ?? '')).join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Fill `{name}` etc.; unknown placeholders are left as-is (lines.json tests forbid them). */
export function fillLine(text, vars = {}) {
  return String(text).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null && vars[k] !== '' ? String(vars[k]) : m));
}

/** Deterministic line for a tag (null when the tag has no pool). */
export function pickLine(lines, tag, seed, vars = {}) {
  const pool = lines?.tags?.[tag];
  if (!tag || !Array.isArray(pool) || !pool.length) return null;
  const rng = createRng(hashSeed(seed, tag));
  return fillLine(pool[rng.int(0, pool.length - 1)], vars);
}

export function normalizeTone(tone, tones = getTones()) {
  const t = tones.toneAliases?.[tone] ?? tone;
  return TONES.includes(t) ? t : null;
}

const explicitTone = (ev, tones) => (ev.tone && ev.tone !== 'info' ? normalizeTone(ev.tone, tones) : null);
const routeTone = (route, tones) => (route ? normalizeTone(route === 'money' ? 'treasure' : route, tones) : null);

function wonText(n) {
  const v = Math.abs(Math.round(n ?? 0));
  if (v >= 10000) {
    const man = v % 10000;
    return `${Math.floor(v / 10000)}억${man ? ` ${man.toLocaleString('ko-KR')}만` : ''}원`;
  }
  return `${v.toLocaleString('ko-KR')}만원`;
}

/** Follow-up events of events[i] (money/log lines…) up to the next boundary event. */
export function followersOf(events, i) {
  const out = [];
  for (let j = i + 1; j < events.length; j++) {
    if (isBoundary(events[j])) return { list: out, next: events[j] };
    out.push(events[j]);
  }
  return { list: out, next: null };
}

/** Outcome summary of a landing / prompt resolution for one character. */
function outcome(list, charId) {
  let delta = 0;
  let debt = false;
  let emotion = null;
  let eventId = null;
  let tone = null;
  let stats = 0;
  for (const e of list) {
    if (e.type === 'moneyChanged' && e.charId === charId) {
      delta += e.delta ?? 0;
      if ((e.debt ?? 0) > 0 && (e.money ?? 0) === 0 && (e.delta ?? 0) < 0) debt = true;
      emotion ??= e.emotion ?? null;
      eventId ??= e.eventId ?? null;
      tone ??= e.tone ?? null;
    } else if (e.type === 'log' && e.charId === charId) {
      emotion ??= e.emotion ?? null;
      eventId ??= e.eventId ?? null;
      if (e.tone && e.tone !== 'info') tone ??= e.tone;
    } else if (e.type === 'statChanged' && e.charId === charId) {
      stats += e.delta ?? 0;
    }
  }
  return { delta, debt, emotion, eventId, tone, stats, gifts: list.filter((e) => e.type === 'moneyChanged' && e.reason === 'gift').length };
}

function moneyTag(delta, debt) {
  if (delta > 0) return delta >= BIG_GAIN ? 'big_gain' : 'money_gain';
  if (delta < 0) return debt ? 'debt' : 'money_loss';
  return 'neutral';
}

/**
 * Presentation of one event (does not mutate). `ctx` = { events, index, room, tones, lines, eraOf(charId) }.
 * @returns {{tone, emotion, scene, tag, cutin, charId, vars}}
 */
export function presentationFor(ev, ctx) {
  const { tones, room } = ctx;
  const chars = room?.characters ?? [];
  const charId = ev.charId ?? ev.fromId ?? ev.results?.[0]?.charId ?? ev.entries?.[0]?.charId ?? null;
  const c = charId ? chars.find((x) => x.id === charId) : null;
  const era = ev.type === 'eraChanged' ? ev.era : charId ? ctx.eraOf?.(charId) ?? c?.era ?? null : null;
  const eraName = (id) => room?.board?.eras?.find((e) => e.id === id)?.name ?? ctx.data?.eras?.eras?.find((e) => e.id === id)?.name ?? id ?? '';
  const vars = { name: c?.name ?? '', era: eraName(ev.era ?? era), amount: '', place: ev.place ?? c?.place ?? '', job: '', rank: '', news: '', stat: '', target: '', card: '', item: '', holiday: '', ...familyVars(ev, c), house: houseName(ctx.data, ev.houseId ?? c?.house?.id) };
  const nameOf = (id) => chars.find((x) => x.id === id)?.name ?? '';
  if (ev.targetId || ev.toId) vars.target = nameOf(ev.targetId ?? ev.toId);
  if (ev.cardId) vars.card = cardName(ctx.data, ev.cardId);
  if (ev.itemId) vars.item = itemName(ctx.data, ev.itemId);
  const jobDef = ev.jobId ? jobOf(ctx.data, ev.jobId) : null;
  if (jobDef) vars.job = jobDef.name;
  let tone = explicitTone(ev, tones);
  if (ev.type === 'newsFlash' && ev.tone) tone = normalizeTone(ev.tone, tones);
  let emotion = ev.emotion && EMOTIONS.includes(ev.emotion) ? ev.emotion : null;
  let tag = null;
  let cutin = CUTIN_TYPES.has(ev.type);
  let scene = null;
  let route = c?.route ?? null;

  switch (ev.type) {
    case 'gameStarted':
      tag = 'game_start';
      tone ??= 'good';
      break;
    case 'turnStarted':
      tag = 'turn_start';
      break;
    case 'spun':
      tag = 'spin';
      break;
    case 'moved':
      tag = 'moved';
      break;
    case 'landed': {
      const { list, next } = followersOf(ctx.events, ctx.index);
      const o = outcome(list, charId);
      const promptNext = next?.type === 'prompt' && next.charId === charId ? next : null;
      route = ev.route ?? route;
      const tt = ev.tileType;
      if (promptNext) {
        tag = PROMPT_TAGS[promptNext.kind] ?? 'stop';
        tone ??= explicitTone(promptNext, tones) ?? PROMPT_TONES[promptNext.kind] ?? 'neutral';
      } else if (tt === 'money' || tt === 'loss' || tt === 'event') {
        const eventDef = tt === 'event' ? eventOf(ctx.data, o.eventId) : null;
        const good = o.delta > 0 || (!o.delta && o.stats > 0);
        const bad = o.delta < 0 || (!o.delta && o.stats < 0);
        tag = tt === 'event' ? eventDef?.lineTag ?? (good ? 'generic_good' : bad ? 'generic_bad' : 'neutral') : moneyTag(o.delta, o.debt);
        if (tt === 'money') tone ??= normalizeTone(o.tone, tones) ?? 'good';
        else if (tt === 'loss') tone ??= 'bad';
        else tone ??= (eventDef?.tone && eventDef.tone !== 'neutral' ? normalizeTone(eventDef.tone, tones) : null) ?? (good ? 'good' : bad ? 'bad' : 'neutral');
        if (eventDef?.emotion && EMOTIONS.includes(eventDef.emotion)) emotion ??= eventDef.emotion;
        if (eventDef?.scene) scene = eventDef.scene;
      } else if (tt === 'salary') {
        tag = o.delta > 0 ? 'salary' : 'neutral';
        tone ??= 'career';
      } else {
        tag = ['heart', 'job', 'card', 'shop', 'treasure', 'house', 'stop', 'merge', 'goal'].includes(tt) ? tt : 'neutral';
        tone ??= (tt !== 'goal' && tt !== 'merge' ? routeTone(route, tones) : null) ?? normalizeTone(tones.tileTones?.[tt], tones) ?? 'neutral';
      }
      emotion ??= o.emotion && EMOTIONS.includes(o.emotion) ? o.emotion : null;
      if (o.delta) vars.amount = wonText(o.delta);
      scene ??= (o.eventId && tones.eventScenes?.[o.eventId]) || null;
      // Stage 8: a birth / wedding / purchase right after the landing takes the stage (one cut-in, not two)
      const takeover = next && next.charId === charId && STAGE8_TAKEOVER.has(next.type);
      cutin = (tones.cutinTiles ?? []).includes(tt) && !promptNext && !takeover;
      break;
    }
    case 'moneyChanged': {
      const d = ev.delta ?? 0;
      vars.amount = wonText(d);
      const debt = d < 0 && (ev.debt ?? 0) > 0 && (ev.money ?? 0) === 0;
      tag = { pension: 'pension', gift: 'gift', goalPrize: 'goal', bonusSpin: 'bonus', bet: d > 0 ? 'bet_win' : 'bet_lose' }[ev.reason] ?? moneyTag(d, debt);
      if (ev.reason === 'exam') tag = 'exam_pass';
      tone ??= d > 0 ? 'good' : d < 0 ? 'bad' : 'neutral';
      emotion ??= d > 0 ? 'joy' : d < 0 ? (debt ? 'shock' : 'cry') : null;
      break;
    }
    case 'eraChanged':
      tag = ctx.lines?.tags?.[`era_${ev.era}`] ? `era_${ev.era}` : 'era_change';
      tone ??= 'good';
      route = null;
      break;
    case 'routeChosen':
      route = ev.route;
      tag = `route_${ev.route}`;
      tone ??= routeTone(ev.route, tones) ?? 'good';
      scene = tones.routeScenes?.[ev.route] ?? null;
      break;
    case 'finished':
      tag = ev.place === 1 ? 'goal_first' : 'goal';
      tone ??= 'result';
      if (ev.prize) vars.amount = wonText(ev.prize);
      break;
    case 'bonusSpin':
      tag = 'bonus';
      tone ??= 'result';
      if (ev.amount) vars.amount = wonText(ev.amount);
      break;
    case 'betResolved': {
      const won = (ev.results ?? []).some((r) => r.won);
      tag = won ? 'bet_win' : 'bet_lose';
      tone ??= won ? 'good' : 'bad';
      emotion ??= won ? 'joy' : 'sweat';
      break;
    }
    case 'prompt':
      tag = PROMPT_TAGS[ev.kind] ?? 'prompt_wait';
      if (ev.kind === 'holiday') {
        const pk = room?.turn?.pending?.promptId === ev.promptId ? room.turn.pending.context?.kind : null;
        vars.holiday = (pk ? holidayName(ctx.data, pk) : '') || String(ev.title ?? '').replace(/^\S+\s+/, '').replace(/\s*대잔치$/, '');
      }
      tone ??= PROMPT_TONES[ev.kind] ?? 'neutral';
      emotion ??= PROMPT_EMOTIONS[ev.kind] ?? null;
      scene = PROMPT_SCENES[ev.kind] ?? null;
      break;
    case 'promptResolved': {
      const { list } = followersOf(ctx.events, ctx.index);
      if (ev.kind === 'exam') {
        const o = outcome(list, charId);
        const pass = ev.result ? ev.result !== 'fail' : o.delta > 0;
        tag = EXAM_TAGS[ev.result] ?? (pass ? 'exam_pass' : 'exam_fail');
        tone ??= pass ? 'good' : 'bad';
        emotion ??= pass ? 'joy' : 'sweat';
        if (o.delta) vars.amount = wonText(o.delta);
      } else if (ev.kind === 'habit') {
        const o = outcome(list, charId);
        tag = ev.stat && ctx.lines?.tags?.[`habit_${ev.stat}`] ? `habit_${ev.stat}` : 'habit';
        tone ??= 'good';
        emotion ??= 'joy';
        vars.stat = STAT_LABELS[ev.stat] ?? '';
        if (o.delta) vars.amount = wonText(o.delta);
      } else if (ev.kind === 'jobTile') {
        const o = outcome(list, charId);
        tag = JOB_TILE_TAGS[ev.result] ?? 'job';
        tone ??= ['failed', 'blocked', 'noBonus'].includes(ev.result) ? 'bad' : 'career';
        emotion ??= ['failed', 'noBonus'].includes(ev.result) ? 'sweat' : ev.result === 'blocked' ? 'cry' : ev.result === 'overtime' ? 'sweat' : 'joy';
        if (o.delta) vars.amount = wonText(o.delta);
        if (c?.job) vars.job = jobOf(ctx.data, c.job.id)?.name ?? '';
      } else if (ev.kind === 'shop') {
        tag = ev.result === 'card' ? 'shop_buy' : 'shop';
        tone ??= 'treasure';
        emotion ??= ev.result === 'card' ? 'joy' : ev.result === 'noMoney' ? 'sweat' : 'neutral';
        if (ev.cardId) vars.item = cardName(ctx.data, ev.cardId);
        scene = 'shop';
      } else if (ev.kind === 'date') {
        tag = 'date';
        tone ??= 'love';
        emotion ??= 'love';
        scene = 'park';
      } else if (ev.kind === 'meet' || ev.kind === 'propose') {
        tag = 'heart';
        tone ??= 'love';
        emotion ??= 'neutral';
        scene = 'park';
      } else if (ev.kind === 'house') {
        tag = ev.result === 'bought' ? 'house_buy' : 'house';
        tone ??= 'treasure';
        emotion ??= ev.result === 'noMoney' ? 'sweat' : 'neutral';
        scene = 'house';
      } else if (ev.kind === 'groupGift') {
        const g = outcome(list, charId);
        tag = g.gifts ? 'gift' : 'gift_none';
        tone ??= g.gifts ? 'love' : 'bad';
        emotion ??= g.gifts ? 'love' : 'cry';
        if (g.delta) vars.amount = wonText(g.delta);
      } else {
        tag = 'neutral';
      }
      break;
    }
    case 'chose':
    case 'betPlaced':
      tag = null;
      break;
    // ---------- Stage 6 ----------
    case 'statChanged':
      tag = (ev.delta ?? 0) >= 0 ? 'stat_up' : 'stat_down';
      tone ??= (ev.delta ?? 0) >= 0 ? 'good' : 'bad';
      vars.stat = STAT_LABELS[ev.stat] ?? '';
      break;
    case 'jobChanged':
      tag = JOB_TAGS[ev.reason] ?? 'hire';
      tone ??= normalizeTone(jobDef?.tone ?? 'career', tones) ?? 'career';
      emotion ??= ev.reason === 'parttime' ? 'sweat' : 'joy';
      scene = jobDef?.scene ?? null;
      route = null;
      break;
    case 'rankUp':
      tag = 'promotion';
      tone ??= normalizeTone(jobDef?.tone ?? 'career', tones) ?? 'career';
      emotion ??= 'joy';
      vars.rank = ev.rankName ?? '';
      scene = jobDef?.scene ?? null;
      route = null;
      break;
    case 'salary':
      tag = 'salary';
      tone ??= 'career';
      emotion ??= 'joy';
      if (ev.amount) vars.amount = wonText(ev.amount);
      break;
    case 'injured':
      tag = 'injury';
      tone ??= 'bad';
      emotion ??= 'cry';
      scene = 'hospital';
      break;
    case 'hiddenJobUnlocked':
      tag = 'hidden_job';
      tone ??= 'result';
      emotion ??= 'shock';
      scene = jobDef?.scene ?? null;
      route = null;
      break;
    case 'newsFlash': {
      const n = newsOf(ctx.data, ev.newsId);
      tag = 'news';
      tone ??= normalizeTone(ev.tone ?? n?.tone, tones) ?? 'neutral';
      emotion ??= tone === 'bad' ? 'shock' : 'joy';
      vars.news = ev.title ?? n?.title ?? '';
      break;
    }
    case 'militaryStart':
      tag = 'military';
      tone ??= 'neutral';
      emotion ??= 'sweat';
      route = null;
      break;
    case 'militaryEnd':
      tag = 'military_end';
      tone ??= 'good';
      emotion ??= 'joy';
      break;
    case 'educationChanged':
      tag = 'graduation';
      tone ??= 'good';
      emotion ??= 'joy';
      scene = 'campus';
      break;
    // ---------- Stage 7 ----------
    case 'cardGained':
      tag = 'card';
      tone ??= 'good';
      emotion ??= 'joy';
      break;
    case 'cardUsed':
      cutin = isCutinCardUse(ev);
      if (ev.cardKind === 'sabotage' && !ev.auto) {
        tag = 'sabotage';
        tone ??= 'bad';
        emotion ??= 'angry';
      } else {
        tag = 'card_use';
        tone ??= 'good';
        emotion ??= 'joy';
      }
      break;
    case 'cardBlocked':
      tag = 'blocked';
      tone ??= 'good';
      emotion ??= 'shock';
      break;
    case 'itemBought':
      tag = 'shop_buy';
      tone ??= 'treasure';
      emotion ??= 'joy';
      scene = 'shop';
      if (ev.price) vars.amount = wonText(ev.price);
      break;
    case 'tradeOffered':
      tag = 'trade';
      tone ??= 'neutral';
      break;
    case 'tradeResolved':
      tag = 'trade';
      tone ??= ev.status === 'accepted' ? 'good' : 'neutral';
      emotion ??= ev.status === 'accepted' ? 'joy' : ev.status === 'rejected' ? 'sweat' : 'neutral';
      break;
    case 'gift':
      tag = 'gift_send';
      tone ??= 'love';
      emotion ??= 'love';
      if (ev.money) vars.amount = wonText(ev.money);
      break;
    case 'holidayStarted':
      tag = 'holiday';
      tone = 'holiday';
      emotion ??= 'joy';
      scene = 'holiday';
      vars.holiday = ev.name ?? holidayName(ctx.data, ev.kind);
      break;
    case 'holidayResult': {
      const win = (ev.results ?? []).filter((r) => r.won > 0).sort((a, b) => b.won - a.won)[0];
      const sebae = (ev.results ?? []).find((r) => r.sebae > 0);
      const who = win ?? sebae ?? ev.results?.[0];
      vars.name = nameOf(who?.charId);
      vars.holiday = ev.name ?? holidayName(ctx.data, ev.kind);
      tag = win ? 'gostop_win' : sebae ? 'holiday_sebae' : 'holiday_nagging';
      if (win) vars.amount = wonText(win.won);
      else if (sebae) vars.amount = wonText(sebae.sebae);
      tone = 'holiday';
      emotion ??= 'joy';
      scene = 'holiday';
      break;
    }
    case 'lottoDraw': {
      const best = [...(ev.entries ?? [])].sort((a, b) => (b.prize ?? 0) - (a.prize ?? 0))[0];
      vars.name = nameOf(best?.charId);
      tag = best?.prize > 0 ? 'lotto_win' : 'lotto_lose';
      if (best?.prize > 0) vars.amount = wonText(best.prize);
      tone ??= best?.prize > 0 ? 'treasure' : 'neutral';
      emotion ??= best?.prize > 0 ? 'joy' : 'sweat';
      scene = 'shop';
      break;
    }
    // ---------- Stage 8 ----------
    case 'met':
      tag = 'meet';
      tone ??= 'love';
      emotion ??= 'love';
      scene = 'park';
      break;
    case 'dated':
      tag = 'date';
      tone ??= 'love';
      emotion ??= 'love';
      scene = 'park';
      if (ev.cost) vars.amount = wonText(ev.cost);
      break;
    case 'proposed':
      tag = ev.success ? 'propose_ok' : 'propose_fail';
      tone = ev.success ? 'love' : 'bad';
      emotion ??= ev.success ? 'love' : 'cry';
      scene = 'park';
      break;
    case 'married':
      tag = 'wedding';
      tone ??= 'love';
      emotion ??= 'love';
      scene = 'wedding-hall';
      if (ev.total) vars.amount = wonText(ev.total);
      break;
    case 'schoolMeet': {
      tag = 'school_meet';
      tone ??= 'love';
      emotion ??= 'love';
      scene = 'school';
      break;
    }
    case 'childBorn':
      tag = 'birth';
      tone ??= 'love';
      emotion ??= 'joy';
      scene = 'hospital';
      break;
    case 'childGrew':
      cutin = isCutinChildGrew(ev);
      tag = GROW_TAGS[ev.kind] ?? 'birth';
      if (ev.kind === 'exam') tag = ev.result === 'fail' ? 'child_exam_fail' : 'child_exam';
      tone ??= ev.kind === 'school' ? 'neutral' : ev.kind === 'dol' ? 'love' : 'good';
      emotion ??= ev.kind === 'school' || ev.result === 'fail' ? 'sweat' : 'joy';
      scene = GROW_SCENES[ev.kind] ?? null;
      if (ev.amount) vars.amount = wonText(ev.amount);
      break;
    case 'allowance':
      tag = 'allowance';
      tone ??= 'good';
      emotion ??= 'joy';
      if (ev.amount) vars.amount = wonText(ev.amount);
      break;
    case 'houseBought':
      tag = 'house_buy';
      tone ??= 'treasure';
      emotion ??= 'joy';
      scene = 'house';
      if (ev.price) vars.amount = wonText(ev.price);
      break;
    case 'houseSold':
      tag = 'house_sell';
      tone ??= 'treasure';
      emotion ??= 'neutral';
      scene = 'house';
      if (ev.amount) vars.amount = wonText(ev.amount);
      break;
    case 'houseValueChanged':
      tag = (ev.mult ?? 1) >= 1 ? 'market_up' : 'market_down';
      tone = (ev.mult ?? 1) >= 1 ? 'treasure' : 'bad';
      emotion ??= (ev.mult ?? 1) >= 1 ? 'joy' : 'shock';
      scene = 'house';
      break;
    case 'gameOver': {
      tag = 'game_over';
      tone ??= 'result';
      vars.name = ev.ranking?.[0]?.name ?? '';
      break;
    }
    case 'log':
      tone ??= normalizeTone(ev.tone, tones) ?? 'neutral';
      tag = tone === 'good' || tone === 'result' ? 'generic_good' : tone === 'bad' ? 'generic_bad' : 'neutral';
      if (!charId) tag = 'neutral'; // room-wide lines (game over, news) have no {name} to fill
      emotion ??= null;
      break;
    default:
      tag = null;
  }

  tone ??= 'neutral';
  if (!emotion) {
    const anchor = cutin || ['moneyChanged', 'bonusSpin', 'betResolved'].includes(ev.type);
    emotion = anchor ? TONE_EMOTION[tone] ?? 'neutral' : 'neutral';
  }
  scene ??=
    tones.tagScenes?.[tag] ??
    (route ? tones.routeScenes?.[route] : null) ??
    (era ? tones.eraScenes?.[era] : null) ??
    tones.tones?.[tone]?.scene ??
    'none';
  if (!SCENES.includes(scene)) scene = 'none';
  return { tone, emotion, scene, tag, cutin, charId, vars };
}

/**
 * Decorate an engine event batch in place (events are fresh objects owned by the transaction).
 * Also copies the prompt presentation onto `room.turn.pending` so a reloaded client can rebuild the
 * prompt cut-in from state alone.
 * @param {object[]} events
 * @param {{room, data?, seed?}} opts  seed = engine RNG state after the action
 */
export function decorateEvents(events, { room, data = {}, seed = 0 } = {}) {
  const tones = data.tones ?? getTones();
  const lines = data.lines ?? getLines();
  // era of each character at each point of the batch (first eraChanged tells the era before it)
  const eras = new Map();
  for (const c of room?.characters ?? []) eras.set(c.id, c.era ?? null);
  const seen = new Set();
  for (const e of events) {
    if (e.type === 'eraChanged' && !seen.has(e.charId)) {
      seen.add(e.charId);
      eras.set(e.charId, e.from ?? null);
    }
  }
  const turnNo = room?.turn?.turnNo ?? 0;
  events.forEach((ev, index) => {
    if (ev.type === 'eraChanged') eras.set(ev.charId, ev.era);
    const p = presentationFor(ev, { events, index, room, tones, lines, data, eraOf: (id) => eras.get(id) ?? null });
    ev.tone = p.tone;
    ev.emotion = p.emotion;
    ev.scene = p.scene;
    ev.line = pickLine(lines, p.tag, hashSeed(seed, turnNo, index, ev.type), p.vars);
    ev.cutin = p.cutin;
    if (p.tag) ev.lineTag = p.tag;
    decorateRows(ev, { lines, room, data, seed: hashSeed(seed, turnNo, index, ev.type), vars: p.vars });
    const pending = room?.turn?.pending;
    if (ev.type === 'prompt' && pending && pending.promptId === ev.promptId) {
      Object.assign(pending, { tone: ev.tone, emotion: ev.emotion, scene: ev.scene, line: ev.line, cutin: true });
    }
  });
  attachMc(events, { room, data, seed, lines });
  return events;
}

/**
 * Stage 7 extras: per-character lines for group results (holidayResult rows, lottoDraw entries) and the
 * victim's reaction (`targetLine`, pool `sabotaged`) on a sabotage card use. Same sub-RNG scheme as `line`.
 */
function decorateRows(ev, { lines, room, data, seed, vars }) {
  const nameOf = (id) => room?.characters?.find((x) => x.id === id)?.name ?? '';
  if (ev.type === 'cardUsed' && ev.cardKind === 'sabotage' && !ev.auto && ev.targetId) {
    ev.targetLine = pickLine(lines, 'sabotaged', hashSeed(seed, 'target'), { ...vars, name: nameOf(ev.charId), target: nameOf(ev.targetId) });
  }
  if (ev.type === 'holidayResult') {
    for (const r of ev.results ?? []) {
      const tag = r.won > 0 ? 'gostop_win' : r.won < 0 ? 'gostop_lose' : r.sebae > 0 ? 'holiday_sebae' : 'holiday_nagging';
      const amount = r.won > 0 ? wonText(r.won) : r.sebae > 0 ? wonText(r.sebae) : '';
      r.lineTag = tag;
      r.line = pickLine(lines, tag, hashSeed(seed, r.charId), { ...vars, name: nameOf(r.charId), amount });
    }
  }
  // Stage 8: one line per pair of the 고교 전원 만남 / per owner of the 노년 시세
  if (ev.type === 'schoolMeet') {
    for (const pr of ev.pairs ?? []) {
      pr.lineTag = 'meet';
      pr.line = pickLine(lines, 'meet', hashSeed(seed, pr.charId), { ...vars, name: nameOf(pr.charId), partner: pr.partner?.name ?? '' });
    }
  }
  if (ev.type === 'houseValueChanged') {
    for (const ch of ev.changes ?? []) {
      const tag = ch.after >= ch.before ? 'market_up' : 'market_down';
      ch.lineTag = tag;
      ch.line = pickLine(lines, tag, hashSeed(seed, ch.charId), { ...vars, name: nameOf(ch.charId), amount: wonText(ch.after - ch.before), house: houseName(data, ch.houseId) });
    }
  }
  if (ev.type === 'lottoDraw') {
    for (const e of ev.entries ?? []) {
      const tag = e.prize > 0 ? 'lotto_win' : 'lotto_lose';
      e.lineTag = tag;
      e.line = pickLine(lines, tag, hashSeed(seed, e.charId), { ...vars, name: nameOf(e.charId), amount: e.prize > 0 ? wonText(e.prize) : '' });
    }
  }
  return data;
}

// ---------- MC NPCs (Stage 5.6): 호야 & 봄이 ----------
//
// Qualifying events get `mc: [{speaker: 'hoya'|'bomi', line, expression, pose, part?}]` (1 line, or a 2–3 line
// duo dialogue), `mcWeight` (big|medium|minor) and `mcStudio: true` for the full-screen MC cut-in (game start,
// first character entering an era). Big events always get the MCs (unless the room's `config.mcFrequency` is
// 'off'); medium/minor ones roll a chance and respect a cooldown (`room.mcState.cool` = candidates to skip after
// any appearance) so the MCs never talk over consecutive minor events. Picked with a separate sub-RNG → the
// gameplay stream is untouched and every client sees the same lines.

export const MC_IDS = ['hoya', 'bomi'];
export { MC_FREQUENCIES };
export const MC_EXPRESSIONS = ['neutral', 'joy', 'surprise', 'sad', 'angry', 'proud', 'sleepy'];
export const MC_POSES = ['idle', 'wave', 'clap', 'mic'];

/** Normalize a line-pool entry (string | {t, e?, p?} | {s, t, e?, p?}) into an MC line. */
export function mcEntry(entry, speaker, situation, vars = {}) {
  const e = typeof entry === 'string' ? { t: entry } : entry ?? {};
  const who = e.s ?? speaker;
  const def = situation?.[who] ?? {};
  return {
    speaker: who,
    line: fillLine(e.t ?? '', vars),
    expression: MC_EXPRESSIONS.includes(e.e) ? e.e : def.expression ?? 'neutral',
    pose: MC_POSES.includes(e.p) ? e.p : def.pose ?? 'idle',
  };
}

/**
 * Deterministic MC lines for a situation.
 * @param {{lines, mc}} data  lines.json + mc.json
 * @param {string} key        situation key (lines.mc.<key>)
 * @param {{next, int}} rng
 * @param {{duo?: boolean, speaker?: string, vars?: object}} opts
 */
export function pickMcLines({ lines, mc }, key, rng, { duo = false, speaker = null, vars = {} } = {}) {
  const pool = lines?.mc?.[key];
  const sit = mc?.situations?.[key];
  if (!pool || !sit) return [];
  if (duo && pool.duo?.length) return pool.duo[rng.int(0, pool.duo.length - 1)].map((d) => mcEntry(d, d.s, sit, vars));
  const who = MC_IDS.includes(speaker) ? speaker : sit.lead === 'any' || !MC_IDS.includes(sit.lead) ? MC_IDS[rng.int(0, 1)] : sit.lead;
  const list = pool[who] ?? [];
  if (!list.length) return [];
  return [mcEntry(list[rng.int(0, list.length - 1)], who, sit, vars)];
}

export function mcFrequencyOf(room) {
  const f = room?.config?.mcFrequency;
  return MC_FREQUENCIES.includes(f) ? f : 'normal';
}

/** Which MC situation an event is (null = MCs stay quiet). Pure; `state` is read, not written. */
export function mcSituationFor(ev, { events, index, room, mc, state, eraName, placeholders = {}, jobs = getJobs(), cards = getCards(), items = getItems() }) {
  const chars = room?.characters ?? [];
  const c = ev.charId ? chars.find((x) => x.id === ev.charId) : null;
  const vars = { name: c?.name ?? '', era: '', amount: '', place: '', job: '', rank: '', news: '', target: '', card: '', item: '', holiday: '', partner: '', child: '', house: '' };
  const nameOf = (id) => chars.find((x) => x.id === id)?.name ?? '';
  if (ev.jobId) vars.job = (ev.jobId === jobs.partTime?.id ? jobs.partTime : jobs.jobs?.find((j) => j.id === ev.jobId))?.name ?? '';
  const big = mc?.bigAmount ?? BIG_GAIN;
  const money = (delta, debt) => {
    vars.amount = wonText(delta);
    if (debt) return 'bankrupt';
    if (delta >= big) return 'bigWin';
    if (delta <= -big) return 'bigLoss';
    return delta > 0 ? 'smallWin' : delta < 0 ? 'smallLoss' : null;
  };
  let key = null;
  let studio = false;
  switch (ev.type) {
    case 'gameStarted':
      key = 'gameStart';
      studio = true;
      break;
    case 'turnStarted':
      if (!state.firstSpin && c) key = 'firstSpin';
      break;
    case 'eraChanged':
      vars.era = ev.eraName ?? eraName(ev.era);
      if (!state.eras.includes(ev.era) && mc?.eraSituations?.[ev.era]) {
        key = mc.eraSituations[ev.era];
        studio = true;
      } else key = 'eraChange';
      break;
    case 'routeChosen':
      key = 'routeChoice';
      break;
    case 'landed': {
      const { list, next } = followersOf(events, index);
      if (next?.type === 'prompt' && next.charId === ev.charId) break; // the prompt takes the stage
      // Placeholder tiles (board.json `placeholders`: heart/job/treasure… before their stage exists) only
      // log a "coming soon" line → never a marriage / job / treasure celebration.
      const tileKey = Object.hasOwn(placeholders ?? {}, ev.tileType) ? null : mc?.tileSituations?.[ev.tileType];
      const o = outcome(list, ev.charId);
      if (tileKey) {
        key = tileKey;
        if (o.delta) vars.amount = wonText(o.delta);
      } else key = money(o.delta, o.debt);
      break;
    }
    case 'moneyChanged':
      if (ev.reason === 'pension') {
        key = 'pension';
        vars.amount = wonText(ev.delta);
      }
      break;
    case 'promptResolved':
      if (ev.kind === 'exam') {
        const o = outcome(followersOf(events, index).list, ev.charId);
        key = (ev.result ? ev.result !== 'fail' : o.delta > 0) ? 'examPass' : 'examFail';
      }
      break;
    // Stage 6: only real outcomes (never the job TILE landing itself)
    case 'jobChanged':
      if (ev.reason === 'hire') key = 'job';
      break;
    case 'rankUp':
      key = 'promotion';
      vars.rank = ev.rankName ?? '';
      break;
    case 'hiddenJobUnlocked':
      key = 'hiddenJob';
      break;
    case 'injured':
      key = 'injury';
      break;
    case 'militaryStart':
      key = 'military';
      break;
    case 'newsFlash':
      key = 'news';
      vars.news = ev.title ?? '';
      studio = true;
      break;
    case 'finished': {
      vars.place = ev.place ?? '';
      if (ev.prize) vars.amount = wonText(ev.prize);
      key = ev.place === 1 ? 'goalFirst' : ev.place === chars.length ? 'goalLast' : 'goal';
      break;
    }
    case 'betResolved': {
      const w = (ev.results ?? []).find((r) => r.won);
      if (w) {
        key = 'betWin';
        vars.name = chars.find((x) => x.id === w.charId)?.name ?? '';
      }
      break;
    }
    case 'gameOver':
      key = 'resultIntro';
      break;
    // Stage 7
    case 'cardUsed':
      if (ev.cardKind === 'sabotage' && !ev.auto) {
        key = 'sabotage';
        vars.target = nameOf(ev.targetId);
        vars.card = (cards?.cards ?? []).find((k) => k.id === ev.cardId)?.name ?? '';
      }
      break;
    case 'cardBlocked':
      key = 'blocked';
      vars.target = nameOf(ev.targetId);
      vars.card = (cards?.cards ?? []).find((k) => k.id === ev.cardId)?.name ?? '';
      break;
    case 'itemBought':
      key = 'shopping';
      vars.item = (items?.items ?? []).find((i) => i.id === ev.itemId)?.name ?? '';
      break;
    case 'holidayStarted':
      key = 'holiday';
      vars.holiday = ev.name ?? '';
      studio = true;
      break;
    case 'lottoDraw': {
      key = 'lotto';
      const best = [...(ev.entries ?? [])].sort((a, b) => (b.prize ?? 0) - (a.prize ?? 0))[0];
      vars.name = nameOf(best?.charId);
      studio = true;
      break;
    }
    case 'gift':
      key = 'gift';
      vars.name = nameOf(ev.fromId);
      vars.target = nameOf(ev.toId);
      break;
    // Stage 8: only real outcomes (never a heart / house TILE landing itself)
    case 'married':
      key = 'marriage';
      vars.partner = ev.spouse?.name ?? '';
      break;
    case 'proposed':
      if (!ev.success) {
        key = 'proposeFail';
        vars.partner = ev.partner?.name ?? '';
      }
      break;
    case 'childBorn':
      key = 'birth';
      vars.child = ev.child?.name ?? '';
      break;
    case 'schoolMeet':
      key = 'schoolMeet';
      break;
    case 'houseBought':
      key = 'house';
      vars.house = houseName(null, ev.houseId);
      break;
    case 'houseValueChanged':
      key = 'market';
      studio = true;
      break;
    default:
      break;
  }
  if (!key || !mc?.situations?.[key]) return null;
  return { key, weight: mc.situations[key].weight, studio, vars };
}

/** The result show (gameOver): intro duo → winner duo → last place → penalty. */
function resultMc(ev, data, rng) {
  const ranking = ev.ranking ?? [];
  const out = [];
  const add = (part, list) => out.push(...list.map((l) => ({ ...l, part })));
  add('intro', pickMcLines(data, 'resultIntro', rng, { duo: true }));
  const first = ranking[0];
  if (first) add('winner', pickMcLines(data, 'resultWinner', rng, { duo: true, vars: { name: first.name, amount: wonText(first.total) } }));
  const last = ranking.length > 1 ? ranking.at(-1) : null;
  if (last) {
    add('last', pickMcLines(data, 'resultLast', rng, { vars: { name: last.name } }));
    add('penalty', pickMcLines(data, 'penalty', rng, { speaker: 'bomi', vars: { name: last.name } }));
  }
  return out;
}

/**
 * Attach MC lines to a decorated batch (in place) and advance `room.mcState`.
 * @param {object[]} events
 * @param {{room, data?, seed?, lines?}} opts
 */
export function attachMc(events, { room, data = {}, seed = 0, lines = data.lines ?? getLines() } = {}) {
  const freqKey = mcFrequencyOf(room);
  if (freqKey === 'off' || !room) return events;
  const mc = data.mc ?? getMc();
  const jobs = data.jobs ?? getJobs();
  const freq = mc.frequency?.[freqKey] ?? mc.frequency?.normal ?? { medium: 0.7, minor: 0.3, cooldown: 2, duoChance: 0.35 };
  const src = { lines, mc };
  const state = room.mcState ?? { cool: 0, eras: room.board?.eras?.[0] ? [room.board.eras[0].id] : [], firstSpin: false };
  room.mcState = state;
  const turnNo = room.turn?.turnNo ?? 0;
  const eraName = (id) => room.board?.eras?.find((e) => e.id === id)?.name ?? data.eras?.eras?.find((e) => e.id === id)?.name ?? id ?? '';
  const placeholders = (data.board ?? getBoardData()).placeholders ?? {};
  events.forEach((ev, index) => {
    const sit = mcSituationFor(ev, { events, index, room, mc, state, eraName, placeholders, jobs, cards: data.cards ?? getCards(), items: data.items ?? getItems() });
    if (!sit) return;
    const rng = createRng(hashSeed(seed, turnNo, index, ev.type, 'mc'));
    if (sit.weight !== 'big') {
      if (state.cool > 0) {
        state.cool--;
        return;
      }
      const chance = freq[sit.weight] ?? 0;
      if (!(rng.next() < chance)) return;
    }
    const meta = mc.situations[sit.key];
    let list;
    if (ev.type === 'gameOver') list = resultMc(ev, src, rng);
    else {
      const duo = meta.duo === true || (meta.duo === 'chance' && rng.next() < (freq.duoChance ?? 0));
      list = pickMcLines(src, sit.key, rng, { duo, vars: sit.vars });
    }
    if (!list.length) return;
    ev.mc = list;
    ev.mcWeight = sit.weight;
    ev.mcKey = sit.key;
    if (sit.studio) ev.mcStudio = true;
    state.cool = freq.cooldown ?? 0;
    if (ev.type === 'turnStarted') state.firstSpin = true;
    if (ev.type === 'eraChanged' && !state.eras.includes(ev.era)) state.eras.push(ev.era);
    if (ev.type === 'gameOver' && room.result) room.result.mc = list;
  });
  return events;
}
