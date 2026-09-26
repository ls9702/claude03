// Event presentation (Stage 5): pure post-pass that gives every engine event the fields the client needs
// for cut-ins / sound — `tone` (frame theme), `emotion`, `scene` (cut-in background id), `line` (speech
// bubble text from lines.json) and `cutin` (full-screen cut-in vs. stay on the board).
//
// Lines are picked with a sub-RNG seeded from the engine RNG state + event index, so every client shows the
// same text without consuming the gameplay RNG stream (existing seeds keep their outcomes).
import { getBoardData, getLines, getMc, getTones } from '../data/index.js';
import { createRng } from './rng.js';
import { MC_FREQUENCIES } from './config.js';

export const TONES = ['love', 'career', 'treasure', 'good', 'bad', 'holiday', 'result', 'neutral'];
export const SCENES = ['school', 'mountain-trail', 'wedding-hall', 'office', 'hospital', 'none'];
export const EMOTIONS = ['joy', 'cry', 'angry', 'sweat', 'love', 'shock', 'neutral'];

/** Every event type the engine emits (tests assert each one gets a full presentation). */
export const EVENT_TYPES = [
  'gameStarted', 'turnStarted', 'spun', 'moved', 'landed', 'moneyChanged', 'eraChanged', 'routeChosen', 'finished',
  'bonusSpin', 'betPlaced', 'betResolved', 'prompt', 'chose', 'promptResolved', 'gameOver', 'log',
];

/** Types that always get a full cut-in (landed only for `tones.cutinTiles`). */
export const CUTIN_TYPES = new Set(['eraChanged', 'routeChosen', 'finished', 'gameOver', 'prompt', 'promptResolved']);

/** Events whose follow-ups (money, logs) belong to them; the scan for followers stops at the next one. */
const BOUNDARY = new Set([
  'turnStarted', 'spun', 'moved', 'landed', 'eraChanged', 'routeChosen', 'finished', 'bonusSpin', 'prompt', 'chose',
  'promptResolved', 'gameOver', 'betPlaced',
]);

const PROMPT_TONES = { routeChoice: 'good', exam: 'career', groupGift: 'holiday' };
const PROMPT_TAGS = { routeChoice: 'route_choice', exam: 'exam', groupGift: 'gift' };
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
    if (BOUNDARY.has(events[j].type)) return { list: out, next: events[j] };
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
  for (const e of list) {
    if (e.type === 'moneyChanged' && e.charId === charId) {
      delta += e.delta ?? 0;
      if ((e.debt ?? 0) > 0 && (e.money ?? 0) === 0 && (e.delta ?? 0) < 0) debt = true;
      emotion ??= e.emotion ?? null;
      eventId ??= e.eventId ?? null;
      tone ??= e.tone ?? null;
    } else if (e.type === 'log' && e.charId === charId) {
      emotion ??= e.emotion ?? null;
      if (e.tone && e.tone !== 'info') tone ??= e.tone;
    }
  }
  return { delta, debt, emotion, eventId, tone, gifts: list.filter((e) => e.type === 'moneyChanged' && e.reason === 'gift').length };
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
  const charId = ev.charId ?? ev.results?.[0]?.charId ?? null;
  const c = charId ? chars.find((x) => x.id === charId) : null;
  const era = ev.type === 'eraChanged' ? ev.era : charId ? ctx.eraOf?.(charId) ?? c?.era ?? null : null;
  const eraName = (id) => room?.board?.eras?.find((e) => e.id === id)?.name ?? ctx.data?.eras?.eras?.find((e) => e.id === id)?.name ?? id ?? '';
  const vars = { name: c?.name ?? '', era: eraName(ev.era ?? era), amount: '', place: ev.place ?? c?.place ?? '' };
  let tone = explicitTone(ev, tones);
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
        tag = tt === 'event' ? (o.delta > 0 ? 'generic_good' : o.delta < 0 ? 'generic_bad' : 'neutral') : moneyTag(o.delta, o.debt);
        if (tt === 'money') tone ??= normalizeTone(o.tone, tones) ?? 'good';
        else if (tt === 'loss') tone ??= 'bad';
        else tone ??= o.delta > 0 ? 'good' : o.delta < 0 ? 'bad' : 'neutral';
      } else {
        tag = ['heart', 'job', 'card', 'shop', 'treasure', 'house', 'stop', 'merge', 'goal'].includes(tt) ? tt : 'neutral';
        tone ??= (tt !== 'goal' && tt !== 'merge' ? routeTone(route, tones) : null) ?? normalizeTone(tones.tileTones?.[tt], tones) ?? 'neutral';
      }
      emotion ??= o.emotion && EMOTIONS.includes(o.emotion) ? o.emotion : null;
      if (o.delta) vars.amount = wonText(o.delta);
      scene = (o.eventId && tones.eventScenes?.[o.eventId]) || null;
      cutin = (tones.cutinTiles ?? []).includes(tt) && !promptNext;
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
      tone ??= PROMPT_TONES[ev.kind] ?? 'neutral';
      emotion ??= { exam: 'sweat', groupGift: 'love', routeChoice: 'joy' }[ev.kind] ?? null;
      break;
    case 'promptResolved': {
      const { list } = followersOf(ctx.events, ctx.index);
      if (ev.kind === 'exam') {
        const o = outcome(list, charId);
        tag = o.delta > 0 ? 'exam_pass' : 'exam_fail';
        tone ??= o.delta > 0 ? 'good' : 'bad';
        emotion ??= o.delta > 0 ? 'joy' : 'sweat';
        if (o.delta) vars.amount = wonText(o.delta);
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
    case 'gameOver': {
      tag = 'game_over';
      tone ??= 'result';
      vars.name = ev.ranking?.[0]?.name ?? '';
      break;
    }
    case 'log':
      tone ??= normalizeTone(ev.tone, tones) ?? 'neutral';
      tag = tone === 'good' || tone === 'result' ? 'generic_good' : tone === 'bad' ? 'generic_bad' : 'neutral';
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
    const pending = room?.turn?.pending;
    if (ev.type === 'prompt' && pending && pending.promptId === ev.promptId) {
      Object.assign(pending, { tone: ev.tone, emotion: ev.emotion, scene: ev.scene, line: ev.line, cutin: true });
    }
  });
  attachMc(events, { room, data, seed, lines });
  return events;
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
export function mcSituationFor(ev, { events, index, room, mc, state, eraName, placeholders = {} }) {
  const chars = room?.characters ?? [];
  const c = ev.charId ? chars.find((x) => x.id === ev.charId) : null;
  const vars = { name: c?.name ?? '', era: '', amount: '', place: '' };
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
        key = o.delta > 0 ? 'examPass' : 'examFail';
      }
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
  const freq = mc.frequency?.[freqKey] ?? mc.frequency?.normal ?? { medium: 0.7, minor: 0.3, cooldown: 2, duoChance: 0.35 };
  const src = { lines, mc };
  const state = room.mcState ?? { cool: 0, eras: room.board?.eras?.[0] ? [room.board.eras[0].id] : [], firstSpin: false };
  room.mcState = state;
  const turnNo = room.turn?.turnNo ?? 0;
  const eraName = (id) => room.board?.eras?.find((e) => e.id === id)?.name ?? data.eras?.eras?.find((e) => e.id === id)?.name ?? id ?? '';
  const placeholders = (data.board ?? getBoardData()).placeholders ?? {};
  events.forEach((ev, index) => {
    const sit = mcSituationFor(ev, { events, index, room, mc, state, eraName, placeholders });
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
