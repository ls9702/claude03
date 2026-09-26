#!/usr/bin/env node
// Headless full-game simulation over the pure engine.
//   node scripts/simulate.js --games 200 --seed 1 [--verbose]
// Random decisions, 2–8 characters (random body) owned by 1–4 sessions, random modes/eraTurns.
// Exits non-zero on any exception or stuck game. Stage 6 report: job distribution, 알바 %, hidden-job unlocks,
// salary share of income, stats by era, final net worth by education / route, prompts per character, spins.
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
      apply({ type: 'choose', characterId: id, promptId: p.promptId, optionId: meta.pick(p.options).id });
      continue;
    }
    const cur = room.characters.find((c) => c.id === room.turn.order[room.turn.currentIndex]);
    for (const c of room.characters) {
      if (c.ownerSessionId === cur.ownerSessionId || c.money < 5 || meta.next() > 0.3) continue;
      const kind = meta.pick(['oddEven', 'range']);
      apply({ type: 'bet', characterId: c.id, kind, pick: meta.pick(BET_PICKS[kind]), amount: meta.int(5, Math.min(20, c.money)) });
      stats.bets.placed++;
    }
    apply({ type: 'spin', characterId: cur.id });
  }
  const mode = room.config.mode;
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

/**
 * Turn-order bias: `games` 8-character lifetime games (default eraTurns, index turn order, 4 sessions × 2
 * characters, random decisions, no bets).
 * @returns {{games, winShare: number[], avgRank: number[], avgGoalPlace: number[]}} per turn position
 */
export function simulateBias({ games = 500, seed = 1, characters = 8, data: simData } = {}) {
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
        action = { type: 'choose', characterId: id, promptId: p.promptId, optionId: meta.pick(p.options).id };
      } else action = { type: 'spin', characterId: room.turn.order[room.turn.currentIndex] };
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
  console.log(`뉴스: ${Object.entries(stats.news).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
  if (errors) process.exit(1);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  if (BIAS) mainBias();
  else mainRandom();
}
