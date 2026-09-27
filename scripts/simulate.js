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
// Stage 8 policy: random enabled options (만남 / 데이트 / 프러포즈 / 부동산). Report: meets / dates / proposals, marriage
// rate by route, children per character, genius share, spouse salary + allowance share of income, houses by type,
// swaps, 청약 / lucky, the 노년 시세 draw and its effect, 건물주. `--family default` answers 만남 / 데이트 / 프러포즈 with
// the prompt default (best candidate, matched date, propose) instead of randomly.
//
// Stage 9 report: submap visits / choices, treasures (count, appraisal values, fakes), special awards (share of
// lifetime games, bonus vs the average winner total), titles (every one reached?), 산신령 unlocks, the composition
// of the final totals (cash / house / items / treasures / awards), highlights per character and a random MVP vote.
//
// Post-simulation fixes: the route block also prints each route relative to the SAME game (mean total vs the game's
// mean, 1st-place share vs fair) — raw averages mix games with different start money / length.
//
// Stage 9-C: `--policy cpu` plays every character with the CPU heuristics (server/game/cpu.js `cpuDecide`), `--policy
// mixed` only the odd-numbered ones (the rest stay random) and prints the 1st-place share per policy. CPU-policy
// characters never bet, offer trades or gift (they still answer offers). `scripts/cpu-game.js` has the fixed
// 4 CPU + 4 random comparison.
//
// 룰렛 실력 모드: `--roulette skill` plays skill-mode rooms (random-policy characters aim at a uniformly random target
// = an average human, CPU-policy ones use `cpuSkillTarget`; no side bets) and prints the 룰렛 block (hit / ±1 / ±2
// shares, landings by tile type per policy). `--bias --roulette skill [--aim random|cpu]` = the turn-order bias with
// aimed spins. `--aim-duel --games N --seed S` = 8-character lifetime games (CPU decisions for everyone) where each
// seat aims with a strategy (cpu / random / max 10 / min 1 / none = a plain random roulette), rotated over the seats:
// 1st-place share, rank, total, goal place and landings per strategy (`simulateAim` is importable).
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
import { cpuDecide, cpuPassScores, cpuSkillTarget, cpuTradeAccept } from '../server/game/cpu.js';
import { ROULETTE_MODES } from '../server/game/roulette.js';

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
const POLICY = String(arg('policy', 'random')); // random | cpu | mixed (Stage 9-C)
if (!['random', 'cpu', 'mixed'].includes(POLICY)) throw new Error(`--policy random|cpu|mixed (got ${POLICY})`);
/** Does this character play by the CPU heuristics? */
const cpuPolicy = (c) => POLICY === 'cpu' || (POLICY === 'mixed' && (c?.seq ?? 0) % 2 === 1);
const ROULETTE = String(arg('roulette', 'random')); // random | skill (룰렛 실력 모드)
if (!ROULETTE_MODES.includes(ROULETTE)) throw new Error(`--roulette random|skill (got ${ROULETTE})`);
const AIM = String(arg('aim', 'random')); // --bias --roulette skill: random | cpu target per spin
const AIM_DUEL = !!arg('aim-duel', false);
const PASS_DUEL = !!arg('pass-duel', false);
const MAX_ACTIONS = 20000;

const data = gameData();
const MODES = Object.keys(data.eras.modes);
const ERA_IDS = data.eras.eras.map((e) => e.id);
const BET_PICKS = { oddEven: ['odd', 'even'], range: Object.keys(data.balance.bets.ranges) };
const CARD_DEFS = new Map(data.cards.cards.map((d) => [d.id, d]));

const FAMILY_POLICY = arg('family', 'random'); // Stage 8: 'default' = 만남 / 데이트 / 프러포즈 take the prompt's default
const FAMILY_KINDS = new Set(['meet', 'date', 'propose']);
/** A random answer among the enabled options. */
const randomOption = (rng, p) =>
  FAMILY_POLICY === 'default' && FAMILY_KINDS.has(p.kind) ? p.defaultOptionId : rng.pick(p.options.filter((o) => !o.disabled)).id;

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
  // loop maps: mostly the default era lengths (±30 %), sometimes very short or long eras
  const defaults = Object.fromEntries(data.eras.eras.map((e) => [e.id, e.defaultTurns]));
  for (const id of ERA_IDS) {
    const r = meta.next();
    const d = defaults[id];
    eraTurns[id] = Math.max(minEraTurns(id, mode), r < 0.1 ? meta.int(1, 3) : r < 0.9 ? meta.int(Math.max(1, Math.round(d * 0.7)), Math.round(d * 1.3)) : meta.int(d, d + 10));
  }
  const fl = data.eras.limits.finalLength;
  const v = validateRoomConfig({
    mode,
    eraTurns,
    finalLength: meta.next() < 0.7 ? fl.default : meta.int(fl.min, fl.max),
    maxCharacters: 8,
    startingMoney: meta.pick([0, 500, 1000, 3000]),
    turnOrder: meta.pick(['family', 'index']),
    rouletteMode: ROULETTE,
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
  byRouteRel: {}, // `${era}:${route}` → [Σ (total / same game's mean − 1), n, 1st places, Σ fair share]
  examResults: {},
  careerChoice: {},
  military: {},
  finalRank: {},
  policyWins: { cpu: 0, random: 0, games: 0, chars: { cpu: 0, random: 0 } }, // Stage 9-C (--policy mixed)
  // 룰렛 실력 모드 (--roulette skill): |value − target| → n, landings by policy → tileType → n
  aim: { spins: 0, off: {}, landings: { cpu: {}, random: {} } },
  // Stage 9
  s9: {
    submaps: {}, // `${submap}:${choice}` → n
    visits: {}, // submap → prompts
    treasures: { tile: 0, jeju: 0 },
    values: [], // appraisal values (all modes)
    fakes: 0,
    treasureByRoute: {}, // `${era}:${route}` → [treasures, n]
    spiritUnlocked: 0,
    wishes: {}, // final c.wishes → characters (lifetime + adult)
    spiritGames: 0,
    lifeGames: 0,
    lifeChars: 0,
    awardGames: {}, // awardId → lifetime games where it was given
    awardBonus: {}, // awardId → [Σ bonus per winner, winners]
    winnerTotal: 0,
    composition: { money: 0, debt: 0, house: 0, items: 0, treasures: 0, awards: 0, total: 0 },
    titles: {}, // titleId → characters (all modes)
    titleChars: 0,
    highlights: 0,
    highlightChars: 0,
    mvp: { games: 0, first: 0, noVotes: 0 },
  },
  news: {},
  // loop maps
  loop: { paydays: {}, pocket: 0, laps: 0, halts: {}, passChoices: {}, buffs: {}, clubs: {}, final: {}, byMode: {}, lifeIncome: { all: 0, payday: 0, noBet: 0 }, byReason: {} },
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
  // Stage 8
  s8: {
    chars: 0, // lifetime + adult characters
    schoolMeets: 0,
    met: 0,
    dates: 0,
    proposals: 0,
    proposeOk: 0,
    married: 0,
    marriedByRoute: {}, // `${era}:${route}` → [married, n]
    weddingGifts: 0,
    children: 0,
    genius: 0,
    grew: {}, // kind → n
    income: { spouse: 0, allowance: 0, weddingGift: 0, dolGift: 0, childExam: 0, birthBonus: 0 },
    houseVisits: 0,
    houseBuys: 0,
    swaps: 0,
    subscription: 0,
    lucky: 0,
    finalHouses: {}, // houseId → n
    houseValue: 0,
    markets: [], // mult
    marketDelta: 0, // Σ (after − before)
    landlord: 0,
    // lifetime-mode family summary (the tuning targets)
    life: { chars: 0, married: 0, loveTakers: 0, loveMarried: 0, children: 0, genius: 0, maxKids: 0, parents: 0, houses: 0,
      marriedInc: { all: 0, spouse: 0 }, parentInc: { all: 0, allowance: 0 } },
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
  const charIncome = new Map(); // charId → {all, spouse, allowance} (positive money changes)
  const apply = (action) => {
    now += 1000;
    const before = room;
    const r = applyAction(room, action, { now });
    room = r.room;
    room.log = []; // the engine clones the room per action; the log is not needed here (much faster)
    actions++;
    for (const ev of r.events) {
      // loop maps: paydays, 찬스 광장 choices, buffs, laps, clubs, the final race's 인생역전섬
      const L = stats.loop;
      if (ev.type === 'salary') {
        L.paydays[room.config.mode] = (L.paydays[room.config.mode] ?? 0) + 1;
        if (ev.pocket) L.pocket++;
      }
      if (ev.type === 'moved' && ev.wrapped) L.laps += ev.laps ?? 1;
      if (ev.type === 'moved' && ev.halted) L.halts[ev.halted] = (L.halts[ev.halted] ?? 0) + 1;
      if (ev.type === 'promptResolved' && ev.kind === 'passTile') {
        const who = cpuPolicy(room.characters.find((x) => x.id === ev.charId)) ? 'cpu' : 'random';
        const row = (L.passChoices[who] ??= {});
        row[ev.result] = (row[ev.result] ?? 0) + 1;
        if (ev.buff) L.buffs[ev.buff] = (L.buffs[ev.buff] ?? 0) + 1;
      }
      if (ev.type === 'promptResolved' && ev.kind === 'club') L.clubs[ev.clubId] = (L.clubs[ev.clubId] ?? 0) + 1;
      if (ev.type === 'submapResult' && ['allIn', 'retire'].includes(ev.optionId)) L.final[ev.result] = (L.final[ev.result] ?? 0) + 1;
      if (ev.type === 'moneyChanged' && room.config.mode === 'lifetime') {
        const k = ev.reason === 'tile' ? (ev.delta > 0 ? 'tile+' : 'tile-') : ev.reason;
        L.byReason[k] = (L.byReason[k] ?? 0) + ev.delta;
      }
      if (ev.type === 'moneyChanged' && ev.delta > 0 && room.config.mode === 'lifetime') {
        L.lifeIncome.all += ev.delta;
        if (ev.reason !== 'bet' && ev.reason !== 'betRefund') L.lifeIncome.noBet += ev.delta; // side-bet payouts return the held stake
        if (ev.reason === 'salary' || ev.reason === 'spouseSalary' || ev.reason === 'allowance') L.lifeIncome.payday += ev.delta;
      }
      if (ev.type === 'moneyChanged' && ev.delta > 0) {
        const ci = charIncome.get(ev.charId) ?? { all: 0, spouse: 0, allowance: 0 };
        ci.all += ev.delta;
        if (ev.reason === 'spouseSalary') ci.spouse += ev.delta;
        if (ev.reason === 'allowance') ci.allowance += ev.delta;
        charIncome.set(ev.charId, ci);
      }
      if (ev.type === 'spun') {
        spins++;
        if (ev.skill) {
          stats.aim.spins++;
          const off = Math.abs((ev.rolls?.[0] ?? ev.value) - ev.target);
          stats.aim.off[off] = (stats.aim.off[off] ?? 0) + 1;
        }
      }
      if (ev.type === 'landed' && ROULETTE === 'skill') {
        const who = cpuPolicy(room.characters.find((x) => x.id === ev.charId)) ? 'cpu' : 'random';
        stats.aim.landings[who][ev.tileType] = (stats.aim.landings[who][ev.tileType] ?? 0) + 1;
      }
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
      // Stage 8
      const s8 = stats.s8;
      if (room.config.mode !== 'kids') {
        if (ev.type === 'moneyChanged' && ev.delta > 0) {
          const key = { spouseSalary: 'spouse', allowance: 'allowance', weddingGift: 'weddingGift', dolGift: 'dolGift', childExam: 'childExam', birthBonus: 'birthBonus' }[ev.reason];
          if (key) s8.income[key] += ev.delta;
        }
        if (ev.type === 'schoolMeet') s8.schoolMeets++;
        if (ev.type === 'met') s8.met++;
        if (ev.type === 'dated') s8.dates++;
        if (ev.type === 'proposed') {
          s8.proposals++;
          if (ev.success) s8.proposeOk++;
        }
        if (ev.type === 'married') s8.weddingGifts += ev.total;
        if (ev.type === 'childGrew') s8.grew[ev.kind] = (s8.grew[ev.kind] ?? 0) + 1;
        if (ev.type === 'prompt' && ev.kind === 'house') s8.houseVisits++;
        if (ev.type === 'houseBought') {
          s8.houseBuys++;
          if (ev.swap) s8.swaps++;
          if (ev.subscription) s8.subscription++;
          if (ev.lucky) s8.lucky++;
        }
        if (ev.type === 'houseValueChanged') {
          s8.markets.push(ev.mult);
          for (const ch of ev.changes) s8.marketDelta += ch.after - ch.before;
        }
      }
      if (ev.type === 'tradeOffered') s7.offers++;
      // Stage 9
      const s9 = stats.s9;
      if (ev.type === 'prompt' && ['hometown', 'temple', 'jeju', 'reversal'].includes(ev.kind)) s9.visits[ev.kind] = (s9.visits[ev.kind] ?? 0) + 1;
      if (ev.type === 'submapResult') {
        const k = `${ev.submap}:${String(ev.optionId).startsWith('train:') ? 'train' : ev.optionId}`;
        s9.submaps[k] = (s9.submaps[k] ?? 0) + 1;
      }
      if (ev.type === 'treasureFound') s9.treasures[ev.source] = (s9.treasures[ev.source] ?? 0) + 1;
      if (ev.type === 'hiddenJobUnlocked' && ev.jobId === 'mountain_spirit') s9.spiritUnlocked++;
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
      if (cpuPolicy(room.characters.find((c) => c.id === id))) apply(cpuDecide(room, id, data));
      else apply({ type: 'choose', characterId: id, promptId: p.promptId, optionId: randomOption(meta, p) });
      continue;
    }
    const cur = room.characters.find((c) => c.id === room.turn.order[room.turn.currentIndex]);
    // Stage 7: out-of-turn gifts / trades now and then, a card before the spin half of the time
    interact(() => room, meta, apply);
    if (room.status !== 'playing') break;
    if (cpuPolicy(cur)) {
      // Stage 9-C: the CPU heuristics play a card (maybe) and spin
      let a = cpuDecide(room, cur.id, data);
      while (a && a.type !== 'spin' && room.status === 'playing') {
        apply(a);
        a = room.turn.pending ? null : cpuDecide(room, cur.id, data);
      }
      if (a) apply(a);
      continue;
    }
    const cardAction = randomCardAction(room, room.characters.find((c) => c.id === cur.id), meta);
    if (cardAction) apply(cardAction);
    for (const c of room.characters) {
      if (ROULETTE === 'skill') break; // no side bets in skill mode (the server refuses them)
      if (cpuPolicy(c) || c.finished) continue; // CPU-policy / finished characters never bet
      if (c.ownerSessionId === cur.ownerSessionId || c.money < 5 || meta.next() > 0.3) continue;
      const kind = meta.pick(['oddEven', 'range']);
      apply({ type: 'bet', characterId: c.id, kind, pick: meta.pick(BET_PICKS[kind]), amount: meta.int(5, Math.min(20, c.money)) });
      stats.bets.placed++;
    }
    // skill mode: a random-policy player aims at a uniformly random number (an average human)
    apply({ type: 'spin', characterId: cur.id, ...(ROULETTE === 'skill' ? { target: meta.int(1, 10), input: 'gauge' } : {}) });
  }
  const mode = room.config.mode;
  // Stage 9: result (treasures, awards, titles, composition) + a random MVP vote closed at once
  {
    const s9 = stats.s9;
    const res = room.result;
    for (const t of res.treasures) {
      s9.values.push(t.value);
      if (t.fake) s9.fakes++;
    }
    for (const ids of Object.values(res.titles)) for (const id of ids) s9.titles[id] = (s9.titles[id] ?? 0) + 1;
    s9.titleChars += room.characters.length;
    for (const list of Object.values(room.highlights ?? {})) s9.highlights += list.length;
    s9.highlightChars += room.characters.length;
    if (mode !== 'kids') {
      if (room.characters.some((c) => c.hiddenUnlocked.includes('mountain_spirit'))) s9.spiritGames++;
      for (const c of room.characters) {
        s9.wishes[c.wishes ?? 0] = (s9.wishes[c.wishes ?? 0] ?? 0) + 1;
        for (const h of c.routeHistory) {
          const b = (s9.treasureByRoute[`${h.era}:${h.route}`] ??= [0, 0]);
          b[0] += c.treasures.length;
          b[1]++;
        }
      }
    }
    if (mode === 'lifetime') {
      s9.lifeGames++;
      s9.lifeChars += room.characters.length;
      for (const a of res.awards) {
        s9.awardGames[a.id] = (s9.awardGames[a.id] ?? 0) + 1;
        const b = (s9.awardBonus[a.id] ??= [0, 0]);
        b[0] += a.bonus * a.charIds.length;
        b[1] += a.charIds.length;
      }
      s9.winnerTotal += res.ranking[0].total;
      const cmp = s9.composition;
      for (const r of res.ranking) {
        cmp.money += r.money;
        cmp.debt += r.debt;
        cmp.house += r.house;
        cmp.items += r.items;
        cmp.treasures += r.treasures;
        cmp.awards += r.awards;
        cmp.total += r.total;
      }
    }
    if (res.mvp && !res.mvp.closed) {
      for (const p of room.players) {
        if (meta.next() < 0.2) continue; // some players never vote
        const targets = room.characters.filter((c) => c.ownerSessionId !== p.sessionId);
        const pick = targets.length ? meta.pick(targets) : meta.pick(room.characters);
        room = applyAction(room, { type: 'vote', voterId: p.id, targetId: pick.id }, { now: now + 1000 }).room;
      }
      room = applyAction(room, { type: 'closeVote' }, { now: now + 2000 }).room;
    }
    s9.mvp.games++;
    if (room.result.mvp.winner === res.ranking[0].charId) s9.mvp.first++;
    if (room.result.mvp.note) s9.mvp.noVotes++;
  }
  stats.s7.chars += room.characters.length;
  for (const c of room.characters) {
    stats.s7.itemsPerChar += c.items.length;
    for (const it of c.items) stats.s7.items[it] = (stats.s7.items[it] ?? 0) + 1;
  }
  const sp = (stats.spins[mode] ??= [0, 0, 0]);
  sp[0] += spins;
  sp[1]++;
  sp[2] += room.characters.length;
  const lm = (stats.loop.byMode[mode] ??= { games: 0, chars: 0, rounds: 0, laps: 0, finalRounds: 0 });
  lm.games++;
  lm.chars += room.characters.length;
  lm.rounds += room.turn.round;
  lm.laps += room.characters.reduce((a, c) => a + (c.laps ?? 0), 0);
  if (mode === 'lifetime') stats.lifePrompts.chars += room.characters.length;
  const total = new Map(room.result.ranking.map((r) => [r.charId, r.total]));
  // route metrics relative to the SAME game (start money / game length differ a lot between games)
  const gameMean = room.result.ranking.reduce((a, r) => a + r.total, 0) / Math.max(1, room.result.ranking.length);
  const winners = new Set(room.result.ranking.filter((r) => r.rank === 1).map((r) => r.charId));
  if (mode !== 'kids') {
    const s8 = stats.s8;
    for (const c of room.characters) {
      s8.chars++;
      if (c.spouse) s8.married++;
      s8.children += c.children.length;
      s8.genius += c.children.filter((k) => k.talent === 'genius').length;
      if (c.house) {
        s8.finalHouses[c.house.id] = (s8.finalHouses[c.house.id] ?? 0) + 1;
        s8.houseValue += c.house.value;
      }
      if (c.jobHistory.some((h) => h.id === 'landlord') || c.hiddenUnlocked.includes('landlord')) s8.landlord++;
      if (mode === 'lifetime') {
        const L = s8.life;
        const ci = charIncome.get(c.id) ?? { all: 0, spouse: 0, allowance: 0 };
        L.chars++;
        if (c.house) L.houses++;
        const love = c.routeHistory.some((h) => h.route === 'love');
        if (love) L.loveTakers++;
        if (c.spouse) {
          L.married++;
          if (love) L.loveMarried++;
          L.children += c.children.length;
          L.marriedInc.all += ci.all;
          L.marriedInc.spouse += ci.spouse;
        }
        L.genius += c.children.filter((k) => k.talent === 'genius').length;
        L.maxKids = Math.max(L.maxKids, c.children.length);
        if (c.children.length) {
          L.parents++;
          L.parentInc.all += ci.all;
          L.parentInc.allowance += ci.allowance;
        }
      }
      for (const h of c.routeHistory) {
        const b = (s8.marriedByRoute[`${h.era}:${h.route}`] ??= [0, 0]);
        if (c.spouse) b[0]++;
        b[1]++;
      }
    }
  }
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
      const rr = (stats.byRouteRel[k] ??= [0, 0, 0, 0]); // Σ(total / game mean − 1), n, wins, Σ 1/characters
      rr[0] += gameMean ? nw / gameMean - 1 : 0;
      rr[1]++;
      if (winners.has(c.id)) rr[2]++;
      rr[3] += 1 / room.characters.length;
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
  if (POLICY === 'mixed') {
    const pw = stats.policyWins;
    const winner = room.characters.find((c) => c.id === ranking[0].charId);
    pw[cpuPolicy(winner) ? 'cpu' : 'random']++;
    pw.games++;
    for (const c of room.characters) pw.chars[cpuPolicy(c) ? 'cpu' : 'random']++;
  }
  if (VERBOSE) console.log(`#${g} ${mode} chars=${room.characters.length} turns=${room.turn.turnNo} winner=${ranking[0].name} ${ranking[0].total}`);
}

/** Rare random gifts (2 %), trade offers (3 %) and answers to open offers (accept / reject / wait). */
function interact(live, rng, apply) {
  const chars = live().characters;
  if (rng.next() < 0.02) {
    const from = rng.pick(chars);
    if (cpuPolicy(from)) return interactAnswers(live, rng, apply);
    const tos = chars.filter((x) => x.id !== from.id && !x.finished); // finished characters never gift / receive
    if (from.finished || !tos.length) return interactAnswers(live, rng, apply);
    const to = rng.pick(tos);
    if (from.cards.length && rng.next() < 0.5) apply({ type: 'gift', characterId: from.id, toId: to.id, cardUid: rng.pick(from.cards).uid });
    else if (from.money >= 10) apply({ type: 'gift', characterId: from.id, toId: to.id, money: rng.int(1, Math.max(1, Math.floor(from.money / 10))) });
  }
  const r = live();
  if (rng.next() < 0.03 && r.status === 'playing') {
    const from = rng.pick(r.characters.filter((x) => !x.finished));
    if (cpuPolicy(from)) return interactAnswers(live, rng, apply);
    const others = r.characters.filter((x) => !x.finished && x.ownerSessionId !== from?.ownerSessionId);
    if (from && others.length && !r.trades.some((t) => t.fromId === from.id)) {
      const to = rng.pick(others);
      const side = (c, allowMoney) => (c.cards.length && (!allowMoney || rng.next() < 0.6) ? { cardUid: rng.pick(c.cards).uid } : allowMoney && c.money >= 5 ? { money: rng.int(1, Math.max(1, Math.floor(c.money / 5))) } : null);
      const give = side(from, true);
      const want = give?.money != null ? side(to, false) : side(to, true);
      if (give && want && !(give.money != null && want.money != null) && !(want.money != null && want.money > to.money)) apply({ type: 'offerTrade', characterId: from.id, toId: to.id, give, want });
    }
  }
  interactAnswers(live, rng, apply);
}

/** Answers to open trade offers: CPU-policy targets decide by value at once, random ones accept / reject / wait. */
function interactAnswers(live, rng, apply) {
  for (const t of [...(live().trades ?? [])]) {
    if (live().status !== 'playing' || !live().trades.some((x) => x.id === t.id)) continue;
    if (cpuPolicy(live().characters.find((c) => c.id === t.toId))) {
      apply({ type: 'respondTrade', characterId: t.toId, tradeId: t.id, accept: cpuTradeAccept(live(), t, data) });
      continue;
    }
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
export function simulateBias({ games = 500, seed = 1, characters = 8, data: simData, cards = true, onGame = null, roulette = 'random', aim = 'random', eraTurns = undefined, finalLength = undefined } = {}) {
  const wins = Array(characters).fill(0);
  const rankSum = Array(characters).fill(0);
  const placeSum = Array(characters).fill(0);
  for (let g = 0; g < games; g++) {
    const meta = createRng(seed * 7919 + g * 104729 + 1);
    const v = validateRoomConfig({ mode: 'lifetime', maxCharacters: characters, turnOrder: 'index', rouletteMode: roulette, ...(eraTurns ? { eraTurns } : {}), ...(finalLength ? { finalLength } : {}) });
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
        if (action.type === 'spin' && roulette === 'skill') action.target = aim === 'cpu' ? cpuSkillTarget(room, c.id, simData ?? data) : meta.int(1, 10);
      }
      room = applyAction(room, action, { now, ...(simData ? { data: simData } : {}) }).room;
      room.log = []; // the engine clones the room per action; the log is irrelevant here (≈10× faster)
    }
    onGame?.(room, g);
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

/** Spin target of an aim strategy (null = no target → a plain random roulette, like a timeout auto spin). */
export const AIM_STRATEGIES = {
  cpu: (room, c, rng, d) => cpuSkillTarget(room, c.id, d),
  random: (room, c, rng) => rng.int(1, 10),
  max: () => 10,
  min: () => 1,
  none: () => null,
};

/**
 * 룰렛 실력 모드 exploit check: `games` skill-mode lifetime games with `characters` characters (index order,
 * 4 sessions); every decision / card uses the CPU heuristics, only the spin target differs: seat i of game g aims
 * with `strategies[(i + g) % strategies.length]`. @returns {{games, rows: {[strategy]: {n, wins, rankSum, totalSum,
 * placeSum, landings: {tileType: n}, spins, hits, goalFirst}}}}
 */
export function simulateAim({ games = 200, seed = 1, characters = 8, strategies = ['cpu', 'random', 'max', 'min', 'none'], data: simData = data, mode = 'lifetime' } = {}) {
  const rows = Object.fromEntries(strategies.map((k) => [k, { n: 0, wins: 0, rankSum: 0, totalSum: 0, relSum: 0, placeSum: 0, landings: {}, spins: 0, hits: 0, salary: 0 }]));
  for (let g = 0; g < games; g++) {
    const meta = createRng(seed * 15485863 + g * 7919 + 3);
    const v = validateRoomConfig({ mode, maxCharacters: characters, turnOrder: 'index', rouletteMode: 'skill' });
    let room = { id: `aim${g}`, code: 'AIMAIM', status: 'lobby', config: v.config, players: [], characters: [], turn: null, log: [], seed: meta.int(0, 2 ** 32 - 1), version: 1, nextPlayerSeq: 0, nextCharSeq: 0, createdAt: 0 };
    for (let s = 0; s < 4; s++) room = joinRoom(room, `sess${s}`, `P${s}`, 0).room;
    for (let i = 0; i < characters; i++) room = addCharacter(room, `sess${i % 4}`, { name: `C${i + 1}`, avatar: { body: meta.next() < 0.5 ? 'boy' : 'girl' } }, 0).room;
    const strat = new Map(room.characters.map((c, i) => [c.id, strategies[(i + g) % strategies.length]]));
    let now = 1_000_000;
    const started = startGame(room, { now, data: simData });
    if (!started.ok) throw new Error(started.error);
    room = started.room;
    let n = 0;
    while (room.status === 'playing') {
      if (++n > MAX_ACTIONS) throw new Error(`aim game ${g} stuck`);
      now += 1000;
      const p = room.turn.pending;
      let action;
      if (p) {
        const id = p.forCharacterIds.find((x) => !Object.hasOwn(p.answers, x));
        action = cpuDecide(room, id, simData);
      } else {
        const c = room.characters.find((x) => x.id === room.turn.order[room.turn.currentIndex]);
        action = cpuDecide(room, c.id, simData);
        if (action?.type === 'spin') {
          const t = AIM_STRATEGIES[strat.get(c.id)](room, c, meta, simData);
          action = { type: 'spin', characterId: c.id, ...(t != null ? { target: t, input: 'cpu' } : {}) };
        }
      }
      const r = applyAction(room, action, { now, data: simData });
      room = r.room;
      room.log = [];
      for (const ev of r.events) {
        const row = rows[strat.get(ev.charId)];
        if (!row) continue;
        if (ev.type === 'landed') row.landings[ev.tileType] = (row.landings[ev.tileType] ?? 0) + 1;
        if (ev.type === 'spun') {
          row.spins++;
          if (ev.skill && (ev.rolls?.[0] ?? ev.value) === ev.target) row.hits++;
        }
        if (ev.type === 'moneyChanged' && ev.reason === 'salary') row.salary += ev.delta;
      }
    }
    const mean = room.result.ranking.reduce((a, x) => a + x.total, 0) / room.result.ranking.length;
    for (const r of room.result.ranking) {
      const row = rows[strat.get(r.charId)];
      row.n++;
      row.rankSum += r.rank;
      row.totalSum += r.total;
      row.relSum += mean ? r.total / mean - 1 : 0;
      row.placeSum += r.place ?? characters;
      if (r.rank === 1) row.wins++;
    }
  }
  return { games, characters, rows };
}

/** 찬스 광장 strategies: the CPU's pick, always 「그냥 지나가기」 (the buff), never (the best other enabled option). */
export const PASS_STRATEGIES = {
  cpu: (room, c, p, d) => cpuDecide(room, c.id, d)?.optionId,
  always: () => 'pass',
  never: (room, c, p, d) => {
    const scores = cpuPassScores(room, c.id, d).filter((x) => x.id !== 'pass');
    const best = scores.sort((a, b) => b.v - a.v)[0]?.id;
    return best ?? p.options.find((o) => o.id !== 'pass' && !o.disabled)?.id ?? 'pass';
  },
};

/**
 * 찬스 광장 fixed-strategy check: 8-character lifetime games, CPU decisions everywhere except the 찬스 광장 answer,
 * which follows the seat's strategy (rotated over the seats). @returns {{games, rows: {[strategy]: {n, wins, rankSum,
 * totalSum, relSum, passes}}}}
 */
export function simulatePass({ games = 200, seed = 1, characters = 8, strategies = ['cpu', 'always', 'never'], data: simData = data, eraTurns = undefined } = {}) {
  const rows = Object.fromEntries(strategies.map((k) => [k, { n: 0, wins: 0, rankSum: 0, totalSum: 0, relSum: 0, passes: 0 }]));
  for (let g = 0; g < games; g++) {
    const meta = createRng(seed * 32452843 + g * 7919 + 5);
    const v = validateRoomConfig({ mode: 'lifetime', maxCharacters: characters, turnOrder: 'index', ...(eraTurns ? { eraTurns } : {}) });
    let room = { id: `pass${g}`, code: 'PASSPS', status: 'lobby', config: v.config, players: [], characters: [], turn: null, log: [], seed: meta.int(0, 2 ** 32 - 1), version: 1, nextPlayerSeq: 0, nextCharSeq: 0, createdAt: 0 };
    for (let s = 0; s < 4; s++) room = joinRoom(room, `sess${s}`, `P${s}`, 0).room;
    for (let i = 0; i < characters; i++) room = addCharacter(room, `sess${i % 4}`, { name: `C${i + 1}`, avatar: { body: meta.next() < 0.5 ? 'boy' : 'girl' } }, 0).room;
    const strat = new Map(room.characters.map((c, i) => [c.id, strategies[(i + g) % strategies.length]]));
    let now = 1_000_000;
    room = startGame(room, { now, data: simData }).room;
    let n = 0;
    while (room.status === 'playing') {
      if (++n > MAX_ACTIONS) throw new Error(`pass game ${g} stuck`);
      now += 1000;
      const p = room.turn.pending;
      const id = p ? p.forCharacterIds.find((x) => !Object.hasOwn(p.answers, x)) : room.turn.order[room.turn.currentIndex];
      let action = cpuDecide(room, id, simData);
      if (p?.kind === 'passTile') {
        const c = room.characters.find((x) => x.id === id);
        action = { type: 'choose', characterId: id, promptId: p.promptId, optionId: PASS_STRATEGIES[strat.get(id)](room, c, p, simData) };
        rows[strat.get(id)].passes++;
      }
      room = applyAction(room, action, { now, data: simData }).room;
      room.log = [];
    }
    const mean = room.result.ranking.reduce((a, x) => a + x.total, 0) / room.result.ranking.length;
    for (const r of room.result.ranking) {
      const row = rows[strat.get(r.charId)];
      row.n++;
      row.rankSum += r.rank;
      row.totalSum += r.total;
      row.relSum += mean ? r.total / mean - 1 : 0;
      if (r.rank === 1) row.wins++;
    }
  }
  return { games, characters, rows };
}

function mainPass() {
  const t0 = performance.now();
  const r = simulatePass({ games: GAMES, seed: SEED });
  const pct = (n, d) => `${d ? ((100 * n) / d).toFixed(1) : '0.0'}%`;
  console.log(`\n=== 찬스 광장 전략 대결 (${r.characters}캐릭터 인생 전체, CPU 결정 + 찬스 광장 답만 다름) ${r.games}판 · seed ${SEED} · ${(performance.now() - t0).toFixed(0)}ms ===`);
  console.log(`공정 1위 비율 ${pct(1, r.characters)}`);
  for (const [k, x] of Object.entries(r.rows)) {
    console.log(`${k.padEnd(7)} ${String(x.n).padStart(5)}명 · 1위 ${pct(x.wins, x.n).padStart(6)} · 평균 순위 ${(x.rankSum / x.n).toFixed(2)} · 총자산 ${(x.totalSum / x.n).toFixed(0)} (판 평균 대비 ${(100 * (x.relSum / x.n)).toFixed(1)}%) · 찬스 광장 ${(x.passes / x.n).toFixed(1)}회`);
  }
}

function mainAim() {
  const t0 = performance.now();
  const r = simulateAim({ games: GAMES, seed: SEED });
  const pct = (n, d) => `${d ? ((100 * n) / d).toFixed(1) : '0.0'}%`;
  console.log(`\n=== 룰렛 실력 모드 전략 대결 (${r.characters}캐릭터 인생 전체, CPU 결정 + 조준 전략만 다름) ${r.games}판 · seed ${SEED} · ${(performance.now() - t0).toFixed(0)}ms ===`);
  console.log(`공정 1위 비율 ${pct(1, r.characters)}`);
  const TYPES = ['salary', 'pass', 'money', 'loss', 'job', 'event', 'card', 'heart', 'house', 'treasure', 'stop', 'goal'];
  for (const [k, x] of Object.entries(r.rows)) {
    const land = Object.values(x.landings).reduce((a, b) => a + b, 0);
    console.log(
      `${k.padEnd(6)} ${String(x.n).padStart(5)}명 · 1위 ${pct(x.wins, x.n).padStart(6)} · 평균 순위 ${(x.rankSum / x.n).toFixed(2)} · 총자산 ${(x.totalSum / x.n).toFixed(0)} (판 평균 대비 ${(100 * (x.relSum / x.n)).toFixed(1)}%) · 골인 ${(x.placeSum / x.n).toFixed(2)}등 · 룰렛 ${(x.spins / x.n).toFixed(1)}회 · 명중 ${pct(x.hits, x.spins)} · 월급 ${(x.salary / x.n).toFixed(0)}`,
    );
    console.log(`       착지 ${land}회: ${TYPES.map((t) => `${t} ${pct(x.landings[t] ?? 0, land)}`).join(' · ')}`);
  }
}

function mainBias() {
  const t0 = performance.now();
  const r = simulateBias({ games: GAMES, seed: SEED, roulette: ROULETTE, aim: AIM });
  const spread = r.avgRank[0] - r.avgRank.at(-1);
  console.log(`\n=== 턴 순서 편향 (8캐릭터 인생 전체, index 순서${ROULETTE === 'skill' ? `, 룰렛 실력 모드 · 조준 ${AIM}` : ''}) ${r.games}판 · seed ${SEED} · ${(performance.now() - t0).toFixed(0)}ms ===`);
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
  if (POLICY !== 'random') console.log(`정책: ${POLICY}${POLICY === 'mixed' ? ` · 1위 비율 CPU ${pct(stats.policyWins.cpu, stats.policyWins.games)} / 랜덤 ${pct(stats.policyWins.random, stats.policyWins.games)} (캐릭터 수 비율 CPU ${pct(stats.policyWins.chars.cpu, stats.policyWins.chars.cpu + stats.policyWins.chars.random)})` : ''}`);

  if (ROULETTE === 'skill') {
    const a = stats.aim;
    const TYPES = ['salary', 'money', 'loss', 'job', 'event', 'heart', 'house', 'treasure', 'goal'];
    console.log(`룰렛 실력 모드: 조준 룰렛 ${a.spins}회 · 차이 ${Object.entries(a.off).sort().map(([k, n]) => `${k} ${pct(n, a.spins)}`).join(' · ')}`);
    for (const who of ['cpu', 'random']) {
      const l = a.landings[who];
      const tot = Object.values(l).reduce((x, y) => x + y, 0);
      if (tot) console.log(`  착지(${who === 'cpu' ? 'CPU 조준' : '랜덤 조준'}) ${tot}회: ${TYPES.map((t) => `${t} ${pct(l[t] ?? 0, tot)}`).join(' · ')}`);
    }
  }

  // ---------- loop maps ----------
  {
    const L = stats.loop;
    console.log(`\n--- 순환 맵 (원작식): 시대 턴 수 제한 · 월급날 · 찬스 광장 ---`);
    for (const [mode, m] of Object.entries(L.byMode)) {
      console.log(`  ${mode.padEnd(8)} 판당 라운드 ${(m.rounds / m.games).toFixed(1)} · 캐릭터당 한 바퀴 ${(m.laps / Math.max(1, m.chars)).toFixed(2)}회 · 월급날 캐릭터당 ${((L.paydays[mode] ?? 0) / Math.max(1, m.chars)).toFixed(2)}회`);
    }
    console.log(`이동이 멈춘 이유: ${JSON.stringify(L.halts)} · 용돈 ${L.pocket}회`);
    for (const [who, row] of Object.entries(L.passChoices)) {
      const tot = Object.values(row).reduce((a, b) => a + b, 0);
      console.log(`찬스 광장 선택 (${who === 'cpu' ? 'CPU' : '랜덤'} ${tot}회): ${Object.entries(row).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${pct(n, tot)}`).join(' · ')}`);
    }
    console.log(`지나가기 버프: ${JSON.stringify(L.buffs)} · 동아리: ${JSON.stringify(L.clubs)} · 인생역전섬 올인/은퇴: ${JSON.stringify(L.final)}`);
    console.log(`인생 전체 수입 중 월급날(급여 + 맞벌이, 용돈 포함) 비중 ${pct(L.lifeIncome.payday, L.lifeIncome.all)} · 훈수 베팅 제외 ${pct(L.lifeIncome.payday, L.lifeIncome.noBet)}`);
    const lifeChars = L.byMode.lifetime?.chars ?? 0;
    if (lifeChars) console.log(`인생 전체 캐릭터당 돈 흐름(사유별): ${Object.entries(L.byReason).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([k, v]) => `${k} ${(v / lifeChars).toFixed(0)}`).join(' · ')}`);
  }

  // ---------- Stage 6 ----------
  console.log(`\n--- 6단계: 능력치·직업·성장 ---`);
  console.log(`평균 룰렛 횟수(판당 · 캐릭터당): ${Object.entries(stats.spins).map(([m, [s, n, c]]) => `${m} ${(s / n).toFixed(1)} · ${(s / Math.max(1, c)).toFixed(1)}`).join(' | ')}`);
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
    // same-game relative (no start-money / game-length confound): mean total vs the game's mean, 1st-place share vs fair
    const rel = ['love', 'career', 'money'].map((r) => [r, stats.byRouteRel[`${era}:${r}`] ?? [0, 0, 0, 0]]);
    console.log(`${era} 루트별 (같은 판 평균 대비): ${rel.map(([r, [d, n, w, f]]) => `${r} ${n ? (d / n >= 0 ? '+' : '') + ((100 * d) / n).toFixed(1) : '0.0'}% · 1위 ${pct(w, n)} (공정 ${pct(f, n)})`).join(' | ')}`);
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
  const s8 = stats.s8;
  const per8 = (n) => (n / Math.max(1, s8.chars)).toFixed(2);
  console.log(`\n--- 8단계: 연애·가족·부동산 (청년 이후 모드 ${s8.chars}명) ---`);
  console.log(`고교 전원 만남 ${s8.schoolMeets}회 · 만남 ${per8(s8.met)} · 데이트 ${per8(s8.dates)} · 프러포즈 ${per8(s8.proposals)} (성공 ${pct(s8.proposeOk, s8.proposals)}) · 결혼 ${pct(s8.married, s8.chars)} · 축의금 결혼당 ${(s8.weddingGifts / Math.max(1, s8.proposeOk)).toFixed(0)}만원`);
  for (const era of ['young', 'middle_age']) {
    console.log(`${era} 루트별 결혼율: ${['love', 'career', 'money'].map((r) => { const [m, n] = s8.marriedByRoute[`${era}:${r}`] ?? [0, 0]; return `${r} ${pct(m, n)}`; }).join(' · ')}`);
  }
  console.log(`자녀 캐릭터당 ${per8(s8.children)}명 · 천재 ${pct(s8.genius, s8.children)} · 성장 ${JSON.stringify(s8.grew)}`);
  const inc = s8.income;
  console.log(`수입 비중: 맞벌이 ${pct(inc.spouse, stats.income.all)} · 용돈 ${pct(inc.allowance, stats.income.all)} · 축의금 ${pct(inc.weddingGift, stats.income.all)} · 돌잔치 ${pct(inc.dolGift, stats.income.all)} · 자녀 수능 ${pct(inc.childExam, stats.income.all)} · 출산장려금 ${pct(inc.birthBonus, stats.income.all)}`);
  console.log(`부동산 칸 ${s8.houseVisits}회 · 구매 ${s8.houseBuys} (${pct(s8.houseBuys, s8.houseVisits)}) · 갈아타기 ${s8.swaps} · 청약 ${s8.subscription} · 골드 매물 ${s8.lucky} · 최종 보유 ${pct(Object.values(s8.finalHouses).reduce((a, b) => a + b, 0), s8.chars)} ${JSON.stringify(s8.finalHouses)} · 평균 집값 ${(s8.houseValue / Math.max(1, Object.values(s8.finalHouses).reduce((a, b) => a + b, 0))).toFixed(0)}`);
  const mk = s8.markets;
  console.log(`노년 시세 ${mk.length}회 · 평균 ×${(mk.reduce((a, b) => a + b, 0) / Math.max(1, mk.length)).toFixed(2)} (최소 ${Math.min(...mk).toFixed(2)} · 최대 ${Math.max(...mk).toFixed(2)}) · 집값 변동 합 ${s8.marketDelta}만원 · 건물주 해금/취임 ${pct(s8.landlord, s8.chars)}`);
  const L = s8.life;
  console.log(
    `[인생 전체 ${L.chars}명] 결혼 ${pct(L.married, L.chars)} · 연애 루트 선택자 결혼 ${pct(L.loveMarried, L.loveTakers)} (${L.loveTakers}명) · 기혼자당 자녀 ${(L.children / Math.max(1, L.married)).toFixed(2)} (최대 ${L.maxKids}) · 천재 ${pct(L.genius, L.children)} · 부모 수입 중 용돈 ${pct(L.parentInc.allowance, L.parentInc.all)} · 기혼자 수입 중 맞벌이 ${pct(L.marriedInc.spouse, L.marriedInc.all)} · 집 보유 ${pct(L.houses, L.chars)}`,
  );
  // ---------- Stage 9 ----------
  const s9 = stats.s9;
  console.log(`\n--- 9단계: 서브맵·보물·결과발표 ---`);
  const lpc = (n) => (n / Math.max(1, stats.lifePrompts.chars)).toFixed(2);
  console.log(`서브맵 방문(인생 전체 캐릭터당): ${['hometown', 'temple', 'jeju', 'reversal'].map((k) => `${k} ${lpc(stats.lifePrompts.byKind[k] ?? 0)}`).join(' · ')} · 전체 방문 ${JSON.stringify(s9.visits)}`);
  const choiceRows = ['hometown', 'temple', 'jeju', 'reversal'].map((sm) => {
    const rows = Object.entries(s9.submaps).filter(([k]) => k.startsWith(`${sm}:`));
    const tot = rows.reduce((a, [, n]) => a + n, 0);
    return `${sm} ${rows.map(([k, n]) => `${k.split(':')[1]} ${pct(n, tot)}`).join('/')}`;
  });
  console.log(`서브맵 선택: ${choiceRows.join(' · ')}`);
  const vals = [...s9.values].sort((a, b) => a - b);
  const vmean = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
  console.log(`보물 ${vals.length}개 (보물 칸 ${s9.treasures.tile} · 제주 ${s9.treasures.jeju}) · 청년 이후 캐릭터당 ${(vals.length / Math.max(1, s8.chars)).toFixed(2)}개 · 감정가 평균 ${vmean.toFixed(0)} · 중앙값 ${vals[vals.length >> 1] ?? 0} · 최대 ${vals.at(-1) ?? 0} · 가짜 ${pct(s9.fakes, vals.length)}`);
  for (const era of ['young', 'middle_age']) {
    console.log(`${era} 루트별 보유 보물(캐릭터당): ${['love', 'career', 'money'].map((r) => { const [t, n] = s9.treasureByRoute[`${era}:${r}`] ?? [0, 0]; return `${r} ${(t / Math.max(1, n)).toFixed(2)}`; }).join(' · ')}`);
  }
  const avgWin = s9.winnerTotal / Math.max(1, s9.lifeGames);
  console.log(`특별상 (인생 전체 ${s9.lifeGames}판, 평균 1위 총자산 ${avgWin.toFixed(0)}): ${data.awards.awards.map((a) => { const [b, w] = s9.awardBonus[a.id] ?? [0, 0]; return `${a.name} ${pct(s9.awardGames[a.id] ?? 0, s9.lifeGames)} (상금 ${w ? (b / w).toFixed(0) : 0} = 1위의 ${((100 * (w ? b / w : 0)) / Math.max(1, avgWin)).toFixed(1)}%)`; }).join(' · ')}`);
  const cmp = s9.composition;
  console.log(`총자산 구성(인생 전체): 현금−빚 ${pct(cmp.money - cmp.debt, cmp.total)} · 집 ${pct(cmp.house, cmp.total)} · 아이템 ${pct(cmp.items, cmp.total)} · 보물 ${pct(cmp.treasures, cmp.total)} · 특별상 ${pct(cmp.awards, cmp.total)}`);
  const titleRows = data.titles.titles.map((t) => [t, s9.titles[t.id] ?? 0]);
  console.log(`칭호 (${s9.titleChars}명): ${titleRows.map(([t, n]) => `${t.name} ${pct(n, s9.titleChars)}`).join(' · ')}`);
  const missing = titleRows.filter(([, n]) => !n).map(([t]) => t.name);
  console.log(`못 받은 칭호: ${missing.length ? missing.join(', ') : '없음 (전부 등장)'} · 하이라이트 캐릭터당 ${(s9.highlights / Math.max(1, s9.highlightChars)).toFixed(2)}개`);
  console.log(`사찰 소원 성취 횟수 분포(청년 이후 캐릭터): ${JSON.stringify(s9.wishes)}`);
  console.log(`산신령 해금: 청년 이후 캐릭터 ${pct(s9.spiritUnlocked, s8.chars)} · 게임 ${pct(s9.spiritGames, stats.games - (stats.byMode.kids?.games ?? 0))} · MVP = 최종 1위 ${pct(s9.mvp.first, s9.mvp.games)} (무투표 ${s9.mvp.noVotes}판)`);
  console.log(`뉴스: ${Object.entries(stats.news).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
  if (errors) process.exit(1);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  if (AIM_DUEL) mainAim();
  else if (PASS_DUEL) mainPass();
  else if (BIAS) mainBias();
  else mainRandom();
}
