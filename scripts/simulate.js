#!/usr/bin/env node
// Headless full-game simulation over the pure engine.
//   node scripts/simulate.js --games 200 --seed 1 [--verbose]
// Random decisions, 2–8 characters (random body) owned by 1–4 sessions, random modes/eraTurns.
// Exits non-zero on any exception or stuck game. Stage 6 report: job distribution, 알바 %, hidden-job unlocks,
// salary share of income, stats by era, final net worth by education / route, prompts per character, spins.
// Stage 7 policy: 50 % chance to play a playable card before a spin (random sabotage target), random shop /
// holiday answers (disabled options skipped), rare random gifts and trade offers (accepted / rejected / left to
// expire). Stage 7 report: cards gained / used per character, sabotage targets by rank, blocks, shop purchase
// rate, items, holiday money flow (고스톱 pot conserved), lotto payout vs EV vs price.
//
//   node scripts/simulate.js --bias --games 2000 --seed 1
// Turn-order bias check: 8-character lifetime games (default eraTurns, index order, random decisions, no
// bets) → share of final 1st places and average final rank per turn position. Also importable:
// `simulateBias({games, seed})` (used by test/balance.test.js).
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gameData } from '../server/data/index.js';
import { minEraTurns, validateRoomConfig } from '../server/game/config.js';
import { applyAction, startGame } from '../server/game/engine.js';
import { addCharacter, joinRoom } from '../server/game/lobby.js';
import { createRng } from '../server/game/rng.js';
import { lottoExpectedValue } from '../server/game/holidays.js';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

const GAMES = Number(arg('games', 200));
const SEED = Number(arg('seed', 1));
const VERBOSE = !!arg('verbose', false);
const BIAS = !!arg('bias', false);
const MAX_ACTIONS = 20000;

const data = gameData();
const MODES = Object.keys(data.eras.modes);
const ERA_IDS = data.eras.eras.map((e) => e.id);
const BET_PICKS = { oddEven: ['odd', 'even'], range: Object.keys(data.balance.bets.ranges) };
const CARD_DEFS = new Map(data.cards.cards.map((d) => [d.id, d]));

/** A random answer among the enabled options. */
const randomOption = (rng, p) => rng.pick(p.options.filter((o) => !o.disabled)).id;

/** Cards the current character may play now: [{card, def, targets|null}]. */
export function playableCards(room, c) {
  if (room.turn.cardUsed || room.turn.phase !== 'awaitSpin' || room.turn.pending) return [];
  const out = [];
  for (const k of c.cards ?? []) {
    const def = CARD_DEFS.get(k.id);
    if (!def || def.kind === 'passive') continue;
    if (def.jobOnly && c.job?.id !== def.jobOnly) continue;
    if (def.kind === 'sabotage') {
      const targets = room.characters.filter((t) => t.id !== c.id && !t.finished && !((t.lastTargetedBy?.[c.id] ?? -Infinity) >= room.turn.round - 1));
      if (targets.length) out.push({ card: k, def, targets });
    } else out.push({ card: k, def, targets: null });
  }
  return out;
}

/** Random card play (50 %) for the current character → a useCard action or null. */
export function randomCardAction(room, c, rng, chance = 0.5) {
  const options = playableCards(room, c);
  if (!options.length || !(rng.next() < chance)) return null;
  const pick = rng.pick(options);
  return { type: 'useCard', characterId: c.id, cardUid: pick.card.uid, ...(pick.targets ? { targetId: rng.pick(pick.targets).id } : {}) };
}

function makeLobbyRoom(meta, gameNo) {
  const eraTurns = {};
  const mode = meta.pick(MODES);
  for (const id of ERA_IDS) {
    const r = meta.next();
    eraTurns[id] = Math.max(minEraTurns(id, mode), r < 0.1 ? meta.int(1, 3) : r < 0.9 ? meta.int(3, 16) : meta.int(16, 40));
  }
  const v = validateRoomConfig({
    mode,
    eraTurns,
    maxCharacters: 8,
    startingMoney: meta.pick([0, 500, 1000, 3000]),
    turnOrder: meta.pick(['family', 'index']),
  });
  if (!v.ok) throw new Error(v.errors.join(' '));
  let room = {
    id: `sim${gameNo}`,
    code: 'SIMSIM',
    status: 'lobby',
    config: v.config,
    players: [],
    characters: [],
    turn: null,
    log: [],
    seed: meta.int(0, 2 ** 32 - 1),
    version: 1,
    nextPlayerSeq: 0,
    nextCharSeq: 0,
    createdAt: 0,
  };
  const sessions = meta.int(1, 4);
  for (let s = 0; s < sessions; s++) room = joinRoom(room, `sess${s}`, `P${s}`, 0).room;
  const chars = meta.int(2, 8);
  for (let i = 0; i < chars; i++) {
    const avatar = { body: meta.next() < 0.5 ? 'boy' : 'girl' };
    room = addCharacter(room, `sess${meta.int(0, sessions - 1)}`, { name: `C${i + 1}`, avatar }, 0).room;
  }
  return room;
}

const stats = {
  games: 0,
  actions: 0,
  turns: [],
  rounds: [],
  finalMoney: [],
  debtors: 0,
  routes: { love: 0, career: 0, money: 0 },
  routeCompleted: 0,
  byMode: {},
  firstFinisherOrderIndex: {},
  bets: { placed: 0, won: 0 },
  pensions: 0,
  prompts: {},
  timeouts: 0,
  bonusSpins: 0,
  winnerWasFirstFinisher: 0,
  placeByOrder: {}, // turn-order position → [sum of goal places, count]
  // Stage 6
  spins: {}, // mode → [spins, games]
  lifePrompts: { chars: 0, total: 0, own: 0, byKind: {} }, // lifetime: decisions per character (own = single-character prompts)
  finalJobs: {}, // jobId|none → count (lifetime + adult)
  jobChars: 0,
  hiddenUnlocked: 0,
  hiddenHeld: 0,
  income: { salary: 0, all: 0 },
  statsAtEra: {}, // era → [sum int, str, charm, luck, n]
  finalStats: [0, 0, 0, 0, 0],
  byEducation: {}, // education → [sum net worth, n] (lifetime + adult)
  byRoute: {}, // `${era}:${route}` → [sum net worth, n] (lifetime + adult)
  examResults: {},
  careerChoice: {},
  military: {},
  finalRank: {},
  news: {},
  rankUps: 0,
  injuries: 0,
  // Stage 7
  s7: {
    chars: 0,
    gained: {}, // source → n
    used: 0, // played by hand
    auto: {}, // passive card → n triggered
    sabotage: 0,
    sabotageByRank: {}, // target's net-worth rank among the characters at the time (1 = richest)
    sabotageByCard: {},
    blocked: 0,
    shopVisits: 0,
    shopBuys: { card: 0, item: 0 },
    items: {}, // itemId → n owned at the end
    itemsPerChar: 0,
    holidays: 0,
    gostopPots: 0,
    gostopNet: 0, // Σ gostop deltas (must be 0)
    sebae: { in: 0, out: 0 },
    lottoTickets: 0,
    lottoPrize: 0,
    lottoWins: {},
    gifts: 0,
    trades: {}, // status → n
    offers: 0,
  },
};
const STAT_ORDER = ['int', 'str', 'charm', 'luck'];

function playGame(g) {
  const meta = createRng(SEED * 100003 + g);
  const lobby = makeLobbyRoom(meta, g);
  let now = 1_000_000;
  const started = startGame(lobby, { now });
  if (!started.ok) throw new Error(started.error);
  let room = started.room;
  let actions = 0;
  let spins = 0;
  const apply = (action) => {
    now += 1000;
    const before = room;
    const r = applyAction(room, action, { now });
    room = r.room;
    actions++;
    for (const ev of r.events) {
      if (ev.type === 'spun') spins++;
      if (ev.type === 'prompt' && room.config.mode === 'lifetime') {
        const n = ev.forCharacterIds.length;
        stats.lifePrompts.total += n;
        if (!ev.simultaneous && n === 1) stats.lifePrompts.own++;
        stats.lifePrompts.byKind[ev.kind] = (stats.lifePrompts.byKind[ev.kind] ?? 0) + n;
      }
      if (ev.type === 'moneyChanged' && ev.delta > 0 && room.config.mode !== 'kids') {
        stats.income.all += ev.delta;
        if (ev.reason === 'salary') stats.income.salary += ev.delta;
      }
      if (ev.type === 'eraChanged') {
        const c = room.characters.find((x) => x.id === ev.charId);
        const slot = (stats.statsAtEra[ev.era] ??= [0, 0, 0, 0, 0]);
        STAT_ORDER.forEach((k, i) => (slot[i] += c.stats[k]));
        slot[4]++;
      }
      if (ev.type === 'newsFlash') stats.news[ev.newsId] = (stats.news[ev.newsId] ?? 0) + 1;
      if (ev.type === 'rankUp') stats.rankUps++;
      if (ev.type === 'injured') stats.injuries++;
      if (ev.type === 'routeChosen') stats.routes[ev.route]++;
      if (ev.type === 'betResolved') for (const x of ev.results) stats.bets.won += x.won ? 1 : 0;
      if (ev.type === 'moneyChanged' && ev.reason === 'pension') stats.pensions++;
      if (ev.type === 'prompt') stats.prompts[ev.kind] = (stats.prompts[ev.kind] ?? 0) + 1;
      if (ev.type === 'bonusSpin') stats.bonusSpins++;
      // Stage 7
      const s7 = stats.s7;
      if (ev.type === 'cardGained') s7.gained[ev.source] = (s7.gained[ev.source] ?? 0) + 1;
      if (ev.type === 'cardUsed') {
        if (ev.auto) s7.auto[ev.cardId] = (s7.auto[ev.cardId] ?? 0) + 1;
        else s7.used++;
        if (ev.cardKind === 'sabotage' && !ev.auto) {
          s7.sabotage++;
          s7.sabotageByCard[ev.cardId] = (s7.sabotageByCard[ev.cardId] ?? 0) + 1;
          const nw = (x) => x.money - x.debt;
          const target = before.characters.find((x) => x.id === ev.targetId);
          const rank = 1 + before.characters.filter((x) => nw(x) > nw(target)).length;
          s7.sabotageByRank[rank] = (s7.sabotageByRank[rank] ?? 0) + 1;
        }
      }
      if (ev.type === 'cardBlocked') {
        s7.blocked++;
        s7.sabotage++;
      }
      if (ev.type === 'prompt' && ev.kind === 'shop') s7.shopVisits++;
      if (ev.type === 'promptResolved' && ev.kind === 'shop' && ev.result === 'card') s7.shopBuys.card++;
      if (ev.type === 'itemBought') s7.shopBuys.item++;
      if (ev.type === 'holidayResult') {
        s7.holidays++;
        s7.gostopPots += ev.pot;
        for (const r of ev.results) {
          s7.gostopNet += r.won;
          if (r.sebae > 0) s7.sebae.in += r.sebae;
          else s7.sebae.out -= r.sebae;
        }
      }
      if (ev.type === 'lottoDraw') {
        for (const e of ev.entries) {
          s7.lottoTickets++;
          s7.lottoPrize += e.prize;
          s7.lottoWins[e.matches] = (s7.lottoWins[e.matches] ?? 0) + 1;
        }
      }
      if (ev.type === 'gift') s7.gifts++;
      if (ev.type === 'tradeOffered') s7.offers++;
      if (ev.type === 'tradeResolved') s7.trades[ev.status] = (s7.trades[ev.status] ?? 0) + 1;
      if (ev.type === 'finished' && ev.place === 1) {
        const idx = room.turn.order.indexOf(ev.charId);
        stats.firstFinisherOrderIndex[idx] = (stats.firstFinisherOrderIndex[idx] ?? 0) + 1;
      }
    }
  };
  // Occasionally round-trip through JSON (simulates save/restore).
  while (room.status === 'playing') {
    if (actions > MAX_ACTIONS) throw new Error(`game ${g} stuck after ${actions} actions`);
    if (meta.next() < 0.02) room = JSON.parse(JSON.stringify(room));
    const p = room.turn.pending;
    if (p) {
      if (p.deadlineAt && meta.next() < 0.1) {
        now = p.deadlineAt;
        stats.timeouts++;
        apply({ type: 'timeout', promptId: p.promptId });
        continue;
      }
      const id = p.forCharacterIds.find((x) => !Object.hasOwn(p.answers, x));
      apply({ type: 'choose', characterId: id, promptId: p.promptId, optionId: randomOption(meta, p) });
      continue;
    }
    const cur = room.characters.find((c) => c.id === room.turn.order[room.turn.currentIndex]);
    // Stage 7: out-of-turn gifts / trades now and then, a card before the spin half of the time
    interact(() => room, meta, apply);
    const cardAction = randomCardAction(room, room.characters.find((c) => c.id === cur.id), meta);
    if (cardAction) apply(cardAction);
    for (const c of room.characters) {
      if (c.ownerSessionId === cur.ownerSessionId || c.money < 5 || meta.next() > 0.3) continue;
      const kind = meta.pick(['oddEven', 'range']);
      apply({ type: 'bet', characterId: c.id, kind, pick: meta.pick(BET_PICKS[kind]), amount: meta.int(5, Math.min(20, c.money)) });
      stats.bets.placed++;
    }
    apply({ type: 'spin', characterId: cur.id });
  }
  const mode = room.config.mode;
  stats.s7.chars += room.characters.length;
  for (const c of room.characters) {
    stats.s7.itemsPerChar += c.items.length;
    for (const it of c.items) stats.s7.items[it] = (stats.s7.items[it] ?? 0) + 1;
  }
  const sp = (stats.spins[mode] ??= [0, 0]);
  sp[0] += spins;
  sp[1]++;
  if (mode === 'lifetime') stats.lifePrompts.chars += room.characters.length;
  const total = new Map(room.result.ranking.map((r) => [r.charId, r.total]));
  for (const c of room.characters) {
    for (let i = 0; i < 4; i++) stats.finalStats[i] += c.stats[STAT_ORDER[i]];
    stats.finalStats[4]++;
    if (mode === 'kids') {
      stats.examResults[c.examResult ?? 'none'] = (stats.examResults[c.examResult ?? 'none'] ?? 0) + 1;
      continue;
    }
    if (mode === 'lifetime') {
      stats.examResults[c.examResult ?? 'none'] = (stats.examResults[c.examResult ?? 'none'] ?? 0) + 1;
      stats.careerChoice[c.careerChoice ?? 'none'] = (stats.careerChoice[c.careerChoice ?? 'none'] ?? 0) + 1;
      const ms = `${c.avatar.body}:${c.military.status}`;
      stats.military[ms] = (stats.military[ms] ?? 0) + 1;
    }
    stats.jobChars++;
    const jid = c.job?.id ?? 'none';
    stats.finalJobs[jid] = (stats.finalJobs[jid] ?? 0) + 1;
    if (c.job) stats.finalRank[c.job.rank] = (stats.finalRank[c.job.rank] ?? 0) + 1;
    if (c.hiddenUnlocked.length) stats.hiddenUnlocked++;
    if (c.jobHistory.some((h) => data.jobs.jobs.find((j) => j.id === h.id)?.hidden)) stats.hiddenHeld++;
    const nw = total.get(c.id);
    const e = (stats.byEducation[c.education] ??= [0, 0]);
    e[0] += nw;
    e[1]++;
    for (const h of c.routeHistory) {
      const k = `${h.era}:${h.route}`;
      const b = (stats.byRoute[k] ??= [0, 0]);
      b[0] += nw;
      b[1]++;
    }
  }
  const m = (stats.byMode[mode] ??= { games: 0, turns: 0, avgMoney: 0 });
  m.games++;
  m.turns += room.turn.turnNo;
  const ranking = room.result.ranking;
  m.avgMoney += ranking.reduce((s, r) => s + r.total, 0) / ranking.length;
  stats.games++;
  stats.actions += actions;
  stats.turns.push(room.turn.turnNo);
  stats.rounds.push(room.turn.round);
  for (const r of ranking) {
    stats.finalMoney.push(r.total);
    if (r.debt > 0) stats.debtors++;
  }
  for (const c of room.characters) {
    stats.routeCompleted += c.routeHistory.filter((h) => h.completed).length;
    const idx = room.turn.order.indexOf(c.id);
    const slot = (stats.placeByOrder[idx] ??= [0, 0]);
    slot[0] += c.place;
    slot[1]++;
  }
  if (ranking[0].place === 1) stats.winnerWasFirstFinisher++;
  if (VERBOSE) console.log(`#${g} ${mode} chars=${room.characters.length} turns=${room.turn.turnNo} winner=${ranking[0].name} ${ranking[0].total}`);
}

/** Rare random gifts (2 %), trade offers (3 %) and answers to open offers (accept / reject / wait). */
function interact(live, rng, apply) {
  const chars = live().characters;
  if (rng.next() < 0.02) {
    const from = rng.pick(chars);
    const to = rng.pick(chars.filter((x) => x.id !== from.id));
    if (from.cards.length && rng.next() < 0.5) apply({ type: 'gift', characterId: from.id, toId: to.id, cardUid: rng.pick(from.cards).uid });
    else if (from.money >= 10) apply({ type: 'gift', characterId: from.id, toId: to.id, money: rng.int(1, Math.max(1, Math.floor(from.money / 10))) });
  }
  const r = live();
  if (rng.next() < 0.03 && r.status === 'playing') {
    const from = rng.pick(r.characters.filter((x) => !x.finished));
    const others = r.characters.filter((x) => !x.finished && x.ownerSessionId !== from?.ownerSessionId);
    if (from && others.length && !r.trades.some((t) => t.fromId === from.id)) {
      const to = rng.pick(others);
      const side = (c, allowMoney) => (c.cards.length && (!allowMoney || rng.next() < 0.6) ? { cardUid: rng.pick(c.cards).uid } : allowMoney && c.money >= 5 ? { money: rng.int(1, Math.max(1, Math.floor(c.money / 5))) } : null);
      const give = side(from, true);
      const want = give?.money != null ? side(to, false) : side(to, true);
      if (give && want && !(give.money != null && want.money != null) && !(want.money != null && want.money > to.money)) apply({ type: 'offerTrade', characterId: from.id, toId: to.id, give, want });
    }
  }
  for (const t of [...(live().trades ?? [])]) {
    if (live().status !== 'playing' || !live().trades.some((x) => x.id === t.id)) continue;
    const x = rng.next();
    if (x < 0.25) apply({ type: 'respondTrade', characterId: t.toId, tradeId: t.id, accept: rng.next() < 0.6 });
    else if (x < 0.3) apply({ type: 'cancelTrade', characterId: t.fromId, tradeId: t.id });
  }
}

/**
 * Turn-order bias: `games` 8-character lifetime games (default eraTurns, index turn order, 4 sessions × 2
 * characters, random decisions, no bets; Stage 7: random card plays unless `cards: false`, holidays on).
 * @returns {{games, winShare: number[], avgRank: number[], avgGoalPlace: number[]}} per turn position
 */
export function simulateBias({ games = 500, seed = 1, characters = 8, data: simData, cards = true } = {}) {
  const wins = Array(characters).fill(0);
  const rankSum = Array(characters).fill(0);
  const placeSum = Array(characters).fill(0);
  for (let g = 0; g < games; g++) {
    const meta = createRng(seed * 7919 + g * 104729 + 1);
    const v = validateRoomConfig({ mode: 'lifetime', maxCharacters: characters, turnOrder: 'index' });
    let room = { id: `bias${g}`, code: 'BIASXX', status: 'lobby', config: v.config, players: [], characters: [], turn: null, log: [], seed: meta.int(0, 2 ** 32 - 1), version: 1, nextPlayerSeq: 0, nextCharSeq: 0, createdAt: 0 };
    for (let s = 0; s < 4; s++) room = joinRoom(room, `sess${s}`, `P${s}`, 0).room;
    for (let i = 0; i < characters; i++) room = addCharacter(room, `sess${i % 4}`, { name: `C${i + 1}` }, 0).room;
    let now = 1_000_000;
    const started = startGame(room, { now, ...(simData ? { data: simData } : {}) });
    if (!started.ok) throw new Error(started.error);
    room = started.room;
    let n = 0;
    while (room.status === 'playing') {
      if (++n > MAX_ACTIONS) throw new Error(`bias game ${g} stuck`);
      now += 1000;
      const p = room.turn.pending;
      let action;
      if (p) {
        const id = p.forCharacterIds.find((x) => !Object.hasOwn(p.answers, x));
        action = { type: 'choose', characterId: id, promptId: p.promptId, optionId: randomOption(meta, p) };
      } else {
        const c = room.characters.find((x) => x.id === room.turn.order[room.turn.currentIndex]);
        action = (cards ? randomCardAction(room, c, meta) : null) ?? { type: 'spin', characterId: c.id };
      }
      room = applyAction(room, action, { now, ...(simData ? { data: simData } : {}) }).room;
      room.log = []; // the engine clones the room per action; the log is irrelevant here (≈10× faster)
    }
    const pos = new Map(room.turn.order.map((id, i) => [id, i]));
    for (const r of room.result.ranking) {
      const i = pos.get(r.charId);
      rankSum[i] += r.rank;
      placeSum[i] += r.place ?? characters;
      if (r.rank === 1) wins[i]++;
    }
  }
  return {
    games,
    winShare: wins.map((w) => w / games),
    avgRank: rankSum.map((x) => x / games),
    avgGoalPlace: placeSum.map((x) => x / games),
  };
}

function mainBias() {
  const t0 = performance.now();
  const r = simulateBias({ games: GAMES, seed: SEED });
  const spread = r.avgRank[0] - r.avgRank.at(-1);
  console.log(`\n=== 턴 순서 편향 (8캐릭터 인생 전체, index 순서) ${r.games}판 · seed ${SEED} · ${(performance.now() - t0).toFixed(0)}ms ===`);
  console.log(`최종 1위 비율: ${r.winShare.map((x, i) => `${i + 1}번째 ${(x * 100).toFixed(1)}%`).join(' · ')}`);
  console.log(`평균 최종 순위: ${r.avgRank.map((x, i) => `${i + 1}번째 ${x.toFixed(2)}`).join(' · ')}`);
  console.log(`평균 골인 등수: ${r.avgGoalPlace.map((x, i) => `${i + 1}번째 ${x.toFixed(2)}`).join(' · ')}`);
  console.log(`1위 비율 범위 ${(Math.min(...r.winShare) * 100).toFixed(1)}~${(Math.max(...r.winShare) * 100).toFixed(1)}% · 첫째−마지막 평균 순위 차 ${spread.toFixed(2)}`);
}

function mainRandom() {
  const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  const pct = (n, d) => `${d ? ((100 * n) / d).toFixed(1) : '0.0'}%`;

  const t0 = performance.now();
  let errors = 0;
  for (let g = 0; g < GAMES; g++) {
    try {
      playGame(g);
    } catch (err) {
      errors++;
      console.error(`게임 #${g} 예외:`, err.stack || err);
    }
  }
  const ms = performance.now() - t0;
  const sortedMoney = [...stats.finalMoney].sort((a, b) => a - b);
  const routeTotal = stats.routes.love + stats.routes.career + stats.routes.money;

  console.log(`\n=== 시뮬레이션 ${stats.games}/${GAMES}판 (seed ${SEED}) · ${ms.toFixed(0)}ms · 예외 ${errors}건 ===`);
  console.log(`행동 수 ${stats.actions} · 평균 턴 ${avg(stats.turns).toFixed(1)} · 평균 라운드 ${avg(stats.rounds).toFixed(1)}`);
  console.log(
    `최종 순자산(만원) 평균 ${avg(stats.finalMoney).toFixed(0)} · 중앙값 ${sortedMoney[sortedMoney.length >> 1] ?? 0} · 최소 ${sortedMoney[0] ?? 0} · 최대 ${sortedMoney.at(-1) ?? 0} · 빚 보유 ${pct(stats.debtors, stats.finalMoney.length)}`,
  );
  for (const [mode, m] of Object.entries(stats.byMode)) {
    console.log(`  ${mode.padEnd(8)} ${String(m.games).padStart(4)}판 · 평균 턴 ${(m.turns / m.games).toFixed(1)} · 평균 순자산 ${(m.avgMoney / m.games).toFixed(0)}`);
  }
  console.log(
    `루트 선택: 연애 ${pct(stats.routes.love, routeTotal)} / 커리어 ${pct(stats.routes.career, routeTotal)} / 금전 ${pct(stats.routes.money, routeTotal)} (총 ${routeTotal}, 완주 ${stats.routeCompleted})`,
  );
  console.log(`1등 골인자의 턴 순서 위치: ${JSON.stringify(stats.firstFinisherOrderIndex)} · 1등 골인자가 최종 1위 ${pct(stats.winnerWasFirstFinisher, stats.games)}`);
  console.log(
    `골인 순서(턴 순서 위치별 평균 골인 등수): ${Object.entries(stats.placeByOrder)
      .map(([i, [sum, n]]) => `${Number(i) + 1}번째 ${(sum / n).toFixed(2)}`)
      .join(' · ')}`,
  );
  console.log(`훈수 베팅 ${stats.bets.placed}건, 적중 ${pct(stats.bets.won, stats.bets.placed)} · 기초연금 ${stats.pensions}회 · 보너스 룰렛 ${stats.bonusSpins}회`);
  console.log(`프롬프트 ${JSON.stringify(stats.prompts)} · 타임아웃 ${stats.timeouts}회`);

  // ---------- Stage 6 ----------
  console.log(`\n--- 6단계: 능력치·직업·성장 ---`);
  console.log(`평균 룰렛 횟수: ${Object.entries(stats.spins).map(([m, [s, n]]) => `${m} ${(s / n).toFixed(1)}`).join(' · ')}`);
  const lp = stats.lifePrompts;
  console.log(
    `인생 전체 캐릭터당 선택 ${(lp.total / Math.max(1, lp.chars)).toFixed(2)}회 (자기 선택 ${(lp.own / Math.max(1, lp.chars)).toFixed(2)} + 남의 생일 등 동시 선택): ${Object.entries(lp.byKind)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k} ${(n / lp.chars).toFixed(2)}`)
      .join(' · ')}`,
  );
  const jobRows = Object.entries(stats.finalJobs).sort((a, b) => b[1] - a[1]);
  const nameOf = (id) => (id === 'none' ? '무직' : id === 'parttime' ? '알바' : data.jobs.jobs.find((j) => j.id === id)?.name ?? id);
  console.log(`최종 직업 분포 (청년 이후 모드 ${stats.jobChars}명): ${jobRows.map(([id, n]) => `${nameOf(id)} ${pct(n, stats.jobChars)}`).join(' · ')}`);
  const regular = jobRows.filter(([id]) => id !== 'parttime' && id !== 'none');
  console.log(
    `최다 직업 ${nameOf(regular[0]?.[0])} ${pct(regular[0]?.[1] ?? 0, stats.jobChars)} · 알바 ${pct(stats.finalJobs.parttime ?? 0, stats.jobChars)} · 무직 ${pct(stats.finalJobs.none ?? 0, stats.jobChars)} · 숨은 직업 해금 ${pct(stats.hiddenUnlocked, stats.jobChars)} / 취임 ${pct(stats.hiddenHeld, stats.jobChars)}`,
  );
  console.log(`최종 직급: ${JSON.stringify(stats.finalRank)} · 승진 ${stats.rankUps}회 · 부상 ${stats.injuries}회`);
  console.log(`수입 중 급여 비중 (청년 이후 모드): ${pct(stats.income.salary, stats.income.all)}`);
  const statRow = (slot) => STAT_ORDER.map((k, i) => `${k} ${(slot[i] / Math.max(1, slot[4])).toFixed(1)}`).join('/');
  console.log(`시대 진입 시 평균 능력치: ${ERA_IDS.filter((e) => stats.statsAtEra[e]).map((e) => `${e} ${statRow(stats.statsAtEra[e])}`).join(' · ')} · 최종 ${statRow(stats.finalStats)}`);
  console.log(`수능 결과: ${JSON.stringify(stats.examResults)} · 진로: ${JSON.stringify(stats.careerChoice)} · 군 복무: ${JSON.stringify(stats.military)}`);
  const avgOf = ([s, n]) => (n ? s / n : 0);
  console.log(`학력별 최종 순자산: ${Object.entries(stats.byEducation).map(([k, v]) => `${k} ${avgOf(v).toFixed(0)} (${v[1]}명)`).join(' · ')}`);
  for (const era of ['young', 'middle_age']) {
    const rows = ['love', 'career', 'money'].map((r) => [r, stats.byRoute[`${era}:${r}`] ?? [0, 0]]);
    const avgs = rows.map(([, v]) => avgOf(v));
    const mean = avgs.reduce((a, b) => a + b, 0) / avgs.length;
    const gap = mean ? ((Math.max(...avgs) - Math.min(...avgs)) / mean) * 100 : 0;
    console.log(`${era} 루트별 최종 순자산: ${rows.map(([r, v]) => `${r} ${avgOf(v).toFixed(0)} (${v[1]})`).join(' · ')} · 격차 ${gap.toFixed(1)}% (평균 대비 ±${(gap / 2).toFixed(1)}%)`);
  }
  const s7 = stats.s7;
  const perChar = (n) => (n / Math.max(1, s7.chars)).toFixed(2);
  const gainedTotal = Object.values(s7.gained).reduce((a, b) => a + b, 0);
  const autoTotal = Object.values(s7.auto).reduce((a, b) => a + b, 0);
  console.log(`\n--- 7단계: 카드·아이템·상호작용 ---`);
  console.log(`카드 획득 캐릭터당 ${perChar(gainedTotal)}장 (${Object.entries(s7.gained).map(([k, n]) => `${k} ${n}`).join(' · ')}) · 직접 사용 ${perChar(s7.used)} · 자동 발동 ${perChar(autoTotal)} (${Object.entries(s7.auto).map(([k, n]) => `${k} ${n}`).join(' · ')})`);
  const sabRanks = Object.entries(s7.sabotageByRank).sort((a, b) => a[0] - b[0]);
  console.log(`뒤통수 ${s7.sabotage}회 (게임당 ${(s7.sabotage / Math.max(1, stats.games)).toFixed(2)}) · 방어 ${s7.blocked}회 (${pct(s7.blocked, s7.sabotage)}) · 카드별 ${JSON.stringify(s7.sabotageByCard)}`);
  console.log(`뒤통수 대상의 순자산 순위(1 = 1위): ${sabRanks.map(([r, n]) => `${r}위 ${pct(n, s7.sabotage - s7.blocked)}`).join(' · ')}`);
  console.log(`상점 방문 ${s7.shopVisits}회 · 구매율 ${pct(s7.shopBuys.card + s7.shopBuys.item, s7.shopVisits)} (카드 ${s7.shopBuys.card} · 아이템 ${s7.shopBuys.item}) · 최종 아이템 캐릭터당 ${perChar(s7.itemsPerChar)}개 ${JSON.stringify(s7.items)}`);
  console.log(`명절 ${s7.holidays}회 · 고스톱 판돈 합 ${s7.gostopPots}만원 · 고스톱 순이동 합계 ${s7.gostopNet} (0이어야 보존) · 세뱃돈 받음 ${s7.sebae.in} / 줌 ${s7.sebae.out}`);
  const ev = lottoExpectedValue(data.balance.lotto);
  const price = data.cards.cards.find((k) => k.id === 'lotto')?.price;
  console.log(`로또 ${s7.lottoTickets}장 · 평균 당첨금 ${(s7.lottoPrize / Math.max(1, s7.lottoTickets)).toFixed(2)}만원 (기대값 ${ev.toFixed(2)} < 카드 가격 ${price}) · 맞춘 개수 ${JSON.stringify(s7.lottoWins)}`);
  console.log(`선물 ${s7.gifts}회 · 거래 제안 ${s7.offers}건 → ${JSON.stringify(s7.trades)}`);
  console.log(`뉴스: ${Object.entries(stats.news).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
  if (errors) process.exit(1);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  if (BIAS) mainBias();
  else mainRandom();
}
