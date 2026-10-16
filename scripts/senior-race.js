#!/usr/bin/env node
// Senior race (노년 골인 경주) report over the pure engine — decisions, comebacks, 한방역전섬 outcomes, item use.
//   node scripts/senior-race.js --games 200 --seed 1 [--chars 8] [--policy casual|random|expert] [--cpus 0]
//                               [--world real|chiikawa] [--mode lifetime|adult]
// Every character plays the human proxy `--policy` (scripts/cpu-game.js `humanAction`) unless `--cpus N` of them are
// real CPUs (owner 'cpu', the handicap applies). Seats rotate per game. Report:
//   - senior turns (a character's turn in the final race) with a decision (a prompt for that character or a card it
//     played) and with a visible item effect, decisions per character, the longest run of consecutive senior turns
//     without any decision (game order);
//   - spins per character in the final race, goal prizes / bonus spins as a share of the final totals;
//   - comebacks: the standing (true total incl. treasures) right after the transition into the final race vs the final
//     ranking — last place → top 2, 1st place → still 1st, mean |rank change|;
//   - items bought per era, items held at the transition, 한방역전섬 / 인생역전 choices and outcomes.
// Importable: `playSeniorGame(opts)`, `seniorReport(opts)`.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getRoster } from '../server/data/index.js';
import { dataForWorld, roomData } from '../server/game/world.js';
import { validateRoomConfig } from '../server/game/config.js';
import { applyAction, startGame } from '../server/game/engine.js';
import { addCharacter, addCpuCharacter, joinRoom } from '../server/game/lobby.js';
import { cpuDecide, isCpu } from '../server/game/cpu.js';
import { computeRanking } from '../server/game/result.js';
import { createRng } from '../server/game/rng.js';
import { humanAction, seatPlan } from './cpu-game.js';

const ROSTER_IDS = getRoster().characters.map((x) => x.id);
const MAX_ACTIONS = 30000;

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

/**
 * One game; `decide(room, charId, rng, data)` overrides the policy for some characters (duels) — return null to
 * fall back to the policy. @returns {{room, events, start}} (`start` = ranking right after the final-race transition)
 */
export function playSeniorGame({ chars = 8, cpus = 0, policy = 'casual', world = 'real', mode = 'lifetime', seed = 1, seat = 0, decide = null, finalLength } = {}) {
  const data = dataForWorld(world);
  const meta = createRng(seed * 2654435761 + 17);
  const v = validateRoomConfig({ mode, maxCharacters: chars, turnOrder: 'index', world, ...(finalLength ? { finalLength } : {}) });
  if (!v.ok) throw new Error(v.errors.join(' '));
  let room = { id: `sr${seed}`, code: 'SENIOR', status: 'lobby', config: { ...v.config, allowCpu: true }, players: [], characters: [], turn: null, log: [], seed: meta.int(0, 2 ** 32 - 1), version: 1, nextPlayerSeq: 0, nextCharSeq: 0, createdAt: 0 };
  const humans = chars - cpus;
  const seats = seatPlan(chars, humans, seat);
  const sessions = Math.max(1, Math.min(4, humans));
  for (let s = 0; s < sessions; s++) room = joinRoom(room, `h${s + 1}`, `사람${s + 1}`, 0).room;
  let hi = 0;
  for (const kind of seats) {
    const r = kind === 'cpu' ? addCpuCharacter(room, {}, 0) : addCharacter(room, `h${(hi++ % sessions) + 1}`, { name: `사람${hi}`, avatar: { character: ROSTER_IDS[Math.floor(meta.next() * ROSTER_IDS.length)] } }, 0);
    if (!r.ok) throw new Error(r.error);
    room = r.room;
  }
  let now = 1_000_000;
  const started = startGame(room, { now, data });
  if (!started.ok) throw new Error(started.error);
  room = started.room;
  const events = [...(started.events ?? [])];
  let start = null;
  let actions = 0;
  while (room.status === 'playing') {
    if (++actions > MAX_ACTIONS) throw new Error(`senior game ${seed} stuck`);
    const p = room.turn.pending;
    const id = p ? p.forCharacterIds.find((x) => !Object.hasOwn(p.answers, x)) : room.turn.order[room.turn.currentIndex];
    const c = room.characters.find((x) => x.id === id);
    let action = decide?.(room, id, meta, data) ?? null;
    if (!action) action = isCpu(c) ? cpuDecide(room, id, data) : humanAction(policy, room, id, meta, data);
    now += 1000;
    const res = applyAction(room, action, { now, data });
    room = res.room;
    room.log = [];
    for (const e of res.events) {
      events.push(e);
      if (e.type === 'eraTransition' && e.final) start = computeRanking(room, { data: roomData(room, data), reveal: true });
    }
  }
  return { room, events, start };
}

const DECISION_EVENTS = new Set(['prompt', 'cardUsed']);
const ITEM_EVENTS = new Set(['seniorItem']);

/** Senior-race metrics of one finished game. */
export function seniorStats({ room, events, start }) {
  const finalIdx = room.board.eras.findIndex((e) => e.final);
  const out = { turns: 0, decisionTurns: 0, itemTurns: 0, anyTurns: 0, decisions: 0, longestRun: 0, spins: 0, chars: room.characters.length, prizes: 0, bonus: 0, total: 0, reversal: {}, island: {}, contest: {}, auction: {}, items: {}, kinds: {}, itemsAtStart: 0, comeback: null };
  let inFinal = false;
  let cur = null;
  let run = 0;
  const close = () => {
    if (!cur) return;
    out.turns++;
    if (cur.decision) out.decisionTurns++;
    if (cur.item) out.itemTurns++;
    if (cur.decision || cur.item) out.anyTurns++;
    run = cur.decision ? 0 : run + 1;
    out.longestRun = Math.max(out.longestRun, run);
    cur = null;
  };
  for (const e of events) {
    if (e.type === 'eraTransition') inFinal = !!e.final;
    if (!inFinal) continue;
    if (e.type === 'turnStarted') {
      close();
      cur = { charId: e.charId, decision: false, item: false };
      continue;
    }
    if (e.type === 'gameOver') close();
    if (e.type === 'spun') out.spins++;
    if (e.type === 'prompt') {
      out.decisions += e.forCharacterIds.length;
      if (cur && e.forCharacterIds.includes(cur.charId)) cur.decision = true;
    }
    if (e.type === 'cardUsed' && !e.auto) {
      out.decisions++;
      if (cur && e.charId === cur.charId) cur.decision = true;
    }
    if (ITEM_EVENTS.has(e.type) && cur && e.charId === cur.charId) cur.item = true;
    if (e.type === 'submapResult' && e.submap === 'reversal') out.reversal[e.result] = (out.reversal[e.result] ?? 0) + 1;
    if (e.type === 'islandResult') out.island[`${e.tier ?? e.result}:${e.result}`] = (out.island[`${e.tier ?? e.result}:${e.result}`] ?? 0) + 1;
    if (e.type === 'promptResolved' && e.kind === 'island') out.island[`choice:${e.result}`] = (out.island[`choice:${e.result}`] ?? 0) + 1;
    if (e.type === 'contestResult') out.contest[`${e.tier}:${e.place ?? 'out'}`] = (out.contest[`${e.tier}:${e.place ?? 'out'}`] ?? 0) + 1;
    if (e.type === 'promptResolved' && e.kind === 'contest') out.contest[e.result] = (out.contest[e.result] ?? 0) + 1;
    if (e.type === 'promptResolved' && e.kind === 'auction') out.auction[e.result] = (out.auction[e.result] ?? 0) + 1;
    if (e.type === 'seniorItem') out.items[e.use] = (out.items[e.use] ?? 0) + 1;
    if (e.type === 'prompt') out.kinds[e.kind] = (out.kinds[e.kind] ?? 0) + 1;
    if (e.type === 'auctionResult') out.auction[e.kind] = (out.auction[e.kind] ?? 0) + 1;
    if (e.type === 'finished') out.reversal[`finish:${e.retired ?? 'goal'}`] = (out.reversal[`finish:${e.retired ?? 'goal'}`] ?? 0) + 1;
    if (e.type === 'moneyChanged' && (e.reason === 'goalPrize')) out.prizes += e.delta;
    if (e.type === 'moneyChanged' && (e.reason === 'bonusSpin')) out.bonus += e.delta;
  }
  close();
  const ranking = room.result.ranking;
  out.total = ranking.reduce((s, r) => s + Math.max(0, r.total), 0);
  void finalIdx;
  if (start) {
    const finalRank = new Map(ranking.map((r) => [r.charId, r.rank]));
    const n = start.length;
    const last = start.filter((r) => r.rank === Math.max(...start.map((x) => x.rank)));
    const first = start.filter((r) => r.rank === 1);
    out.comeback = {
      lastTop2: last.some((r) => finalRank.get(r.charId) <= 2) ? 1 : 0,
      lastWin: last.some((r) => finalRank.get(r.charId) === 1) ? 1 : 0,
      firstWins: first.some((r) => finalRank.get(r.charId) === 1) ? 1 : 0,
      bottomHalfWin: start.filter((r) => r.rank > n / 2).some((r) => finalRank.get(r.charId) === 1) ? 1 : 0,
      moved: start.reduce((s, r) => s + Math.abs(finalRank.get(r.charId) - r.rank), 0) / n,
    };
  }
  return out;
}

const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)} %` : '–');
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '–');

/** Run `games` games and aggregate. */
export function seniorReport({ games = 100, seed = 1, chars = 8, cpus = 0, policy = 'casual', world = 'real', mode = 'lifetime', finalLength } = {}) {
  const agg = { games: 0, turns: 0, decisionTurns: 0, itemTurns: 0, anyTurns: 0, decisions: 0, chars: 0, longest: [], spins: 0, prizes: 0, bonus: 0, total: 0, reversal: {}, island: {}, contest: {}, auction: {}, items: {}, kinds: {}, shop: {}, cb: { lastTop2: 0, lastWin: 0, firstWins: 0, bottomHalfWin: 0, moved: 0, n: 0 }, bought: {}, held: 0 };
  for (let g = 0; g < games; g++) {
    const game = playSeniorGame({ chars, cpus, policy, world, mode, seed: seed * 1000 + g, seat: g, finalLength });
    const s = seniorStats(game);
    agg.games++;
    for (const k of ['turns', 'decisionTurns', 'itemTurns', 'anyTurns', 'decisions', 'chars', 'spins', 'prizes', 'bonus', 'total']) agg[k] += s[k];
    agg.longest.push(s.longestRun);
    for (const key of ['reversal', 'island', 'contest', 'auction', 'items', 'kinds']) for (const [k, v] of Object.entries(s[key])) agg[key][k] = (agg[key][k] ?? 0) + v;
    if (s.comeback) {
      for (const k of ['lastTop2', 'lastWin', 'firstWins', 'bottomHalfWin', 'moved']) agg.cb[k] += s.comeback[k];
      agg.cb.n++;
    }
    // items bought per era (the buyer's era at the end of that action is close enough: one action = one era)
    let era = game.room.board.eras[0].id;
    for (const e of game.events) {
      if (e.type === 'eraTransition') era = e.toEraId;
      if (e.type === 'itemBought') agg.bought[era] = (agg.bought[era] ?? 0) + 1;
      if (e.type === 'prompt' && e.kind === 'shop') agg.shop[era] = (agg.shop[era] ?? 0) + 1;
    }
    agg.held += game.room.characters.reduce((s2, c) => s2 + (c.items?.length ?? 0), 0);
  }
  agg.longest.sort((a, b) => a - b);
  return agg;
}

export function printReport(agg, label = '') {
  const L = agg.longest;
  console.log(`\n=== 노년 골인 경주 ${label} (${agg.games}판, 캐릭터 ${agg.chars}) ===`);
  console.log(`노년 턴 ${agg.turns} (캐릭터당 ${f2(agg.turns / agg.chars)}) · 룰렛 ${f2(agg.spins / agg.chars)} / 캐릭터`);
  console.log(`선택이 있는 턴 ${pct(agg.decisionTurns, agg.turns)} · 아이템 효과가 보인 턴 ${pct(agg.itemTurns, agg.turns)} · 둘 중 하나 ${pct(agg.anyTurns, agg.turns)}`);
  console.log(`캐릭터당 노년 선택 ${f2(agg.decisions / agg.chars)} · 선택 없는 연속 턴 최장: 중앙값 ${L[Math.floor(L.length / 2)]} · 90 % ${L[Math.floor(L.length * 0.9)]} · 최대 ${L.at(-1)}`);
  console.log(`골인 상금 ${pct(agg.prizes, agg.total)} · 보너스 룰렛 ${pct(agg.bonus, agg.total)} (총자산 대비)`);
  const cb = agg.cb;
  console.log(`역전: 노년 시작 꼴찌 → 최종 2위 이내 ${pct(cb.lastTop2, cb.n)} (1위 ${pct(cb.lastWin, cb.n)}) · 하위 절반 → 1위 ${pct(cb.bottomHalfWin, cb.n)} · 노년 시작 1위 → 최종 1위 ${pct(cb.firstWins, cb.n)} · 평균 순위 변동 ${f2(cb.moved / cb.n)}`);
  console.log(`아이템 구입 (시대별, 캐릭터당): ${Object.entries(agg.bought).map(([k, v]) => `${k} ${f2(v / agg.chars)}`).join(' · ') || '없음'} · 끝에 가진 아이템 ${f2(agg.held / agg.chars)}`);
  console.log(`인생역전 결과: ${JSON.stringify(agg.reversal)}`);
  if (Object.keys(agg.island).length) console.log(`한방역전섬: ${JSON.stringify(agg.island)}`);
  if (Object.keys(agg.contest).length) console.log(`노년 대회: ${JSON.stringify(agg.contest)}`);
  if (Object.keys(agg.auction).length) console.log(`경매: ${JSON.stringify(agg.auction)}`);
  if (Object.keys(agg.items).length) console.log(`아이템 노년 활용: ${JSON.stringify(agg.items)}`);
  console.log(`상점 방문 (시대별, 캐릭터당): ${Object.entries(agg.shop).map(([k, v]) => `${k} ${f2(v / agg.chars)}`).join(' · ') || '없음'}`);
  console.log(`노년 선택 종류 (캐릭터당): ${Object.entries(agg.kinds).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${f2(v / agg.chars)}`).join(' · ')}`);
}

// ---------- duels: one seat plays a fixed strategy for one prompt kind, everyone else the strong heuristic ----------

/** Strategy → the option it picks (null = no override → the expert heuristic). */
export const DUEL_STRATEGIES = {
  'island:pass': (p) => (p.kind === 'island' ? 'pass' : null),
  'island:all': (p) => (p.kind === 'island' ? 'bet:all' : null),
  'island:half': (p) => (p.kind === 'island' ? 'bet:half' : null),
  'island:little': (p) => (p.kind === 'island' ? 'bet:little' : null),
  'island:retire': (p) => (p.kind === 'island' ? 'retire' : null),
  'contest:watch': (p) => (p.kind === 'contest' ? 'watch' : null),
  'contest:small': (p) => (p.kind === 'contest' ? 'join:small' : null),
  'contest:big': (p) => (p.kind === 'contest' ? 'join:big' : null),
  'auction:leave': (p) => (p.kind === 'auction' ? 'leave' : null),
  'auction:junk': (p) => (p.kind === 'auction' ? 'sell:junk' : null),
  'auction:sell': (p) => (p.kind === 'auction' ? p.options.find((o) => !o.disabled && o.kind === 'item')?.id ?? p.options.find((o) => !o.disabled && o.kind === 'treasure')?.id ?? 'sell:junk' : null),
  'shop:noItems': (p) => (p.kind === 'shop' ? (p.options.find((o) => o.id === 'leave' ? false : !o.disabled && o.cardId)?.id ?? 'leave') : null),
  'shop:items': (p) => (p.kind === 'shop' ? [...p.options].filter((o) => !o.disabled && o.itemId).sort((a, b) => b.price - a.price)[0]?.id ?? null : null),
};

/**
 * Duel: `chars` expert seats (strong CPU heuristic for everyone); the seat `g % chars` overrides one prompt kind with
 * `strategy` (a DUEL_STRATEGIES key; 'cpu' = no override = the control). @returns {wins, games, rankSum, totalSum}
 */
export function seniorDuel({ strategy, games = 100, seed = 1, chars = 4, world = 'real', mode = 'lifetime' } = {}) {
  const pick = DUEL_STRATEGIES[strategy] ?? (() => null);
  const out = { strategy, games: 0, wins: 0, rankSum: 0, totalSum: 0, meanSum: 0 };
  for (let g = 0; g < games; g++) {
    const testSeat = g % chars;
    let testId = null;
    const decide = (room, id) => {
      testId ??= room.characters[testSeat]?.id;
      const p = room.turn.pending;
      if (id !== testId || !p) return null;
      const opt = pick(p);
      return opt && p.options.some((o) => o.id === opt && !o.disabled) ? { type: 'choose', characterId: id, promptId: p.promptId, optionId: opt } : null;
    };
    const game = playSeniorGame({ chars, policy: 'expert', world, mode, seed: seed * 7919 + g, seat: 0, decide });
    const r = game.room.result.ranking;
    const row = r.find((x) => x.charId === testId);
    out.games++;
    if (row.rank === 1) out.wins++;
    out.rankSum += row.rank;
    out.totalSum += row.total;
    out.meanSum += r.reduce((s, x) => s + x.total, 0) / r.length;
  }
  return out;
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? '')).href && arg('duel', null)) {
  const list = String(arg('duel')).split(',');
  const games = Number(arg('games', 100));
  const seed = Number(arg('seed', 1));
  const chars = Number(arg('chars', 4));
  const world = String(arg('world', 'real'));
  console.log(`=== 노년 결투 (${world}, ${chars}명 고수 CPU, 한 자리만 전략 고정, ${games}판, 공정 ${(100 / chars).toFixed(1)} %) ===`);
  for (const strategy of list) {
    const d = seniorDuel({ strategy, games, seed, chars, world });
    console.log(`${strategy.padEnd(16)} 1위 ${((100 * d.wins) / d.games).toFixed(1)} % · 평균 순위 ${(d.rankSum / d.games).toFixed(2)} · 총자산 ${(d.totalSum / d.games).toFixed(0)} (판 평균 ${(d.meanSum / d.games).toFixed(0)})`);
  }
  process.exit(0);
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? '')).href) {
  const opts = { games: Number(arg('games', 100)), seed: Number(arg('seed', 1)), chars: Number(arg('chars', 8)), cpus: Number(arg('cpus', 0)), policy: String(arg('policy', 'casual')), world: String(arg('world', 'real')), mode: String(arg('mode', 'lifetime')) };
  const t0 = Date.now();
  const agg = seniorReport(opts);
  printReport(agg, `${opts.world} · ${opts.policy}${opts.cpus ? ` + CPU ${opts.cpus}` : ''} · ${opts.mode}`);
  console.log(`(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
