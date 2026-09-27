#!/usr/bin/env node
// Headless CPU games over the pure engine (no timers, no server).
//   node scripts/cpu-game.js --cpus 4 --mode lifetime --seed 1 [--games N] [--random R] [--verbose]
// `--cpus N` CPU characters (owner 'cpu', server/game/cpu.js decisions); `--random R` extra characters that play a
// random policy (random enabled options, a random playable card half of the time; no bets / trades / gifts) —
// CPU and random characters alternate in creation order and the turn order is `index`, so neither side gets the
// better seats. Prints each game (winner, routes, jobs, net worth) for ≤ 5 games or with --verbose, and a
// summary: CPU win share / average rank vs random, by personality, jobs, routes, education.
// `--roulette skill` = 룰렛 실력 모드 rooms (CPUs aim with `cpuSkillTarget`, random characters at a uniformly random
// number — an average human).
// Importable: `playCpuGame({cpus, randoms, mode, seed, eraTurns, holidays, roulette, data})`, `cpuVsRandom({games, seed, ...})`.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gameData } from '../server/data/index.js';
import { validateRoomConfig } from '../server/game/config.js';
import { applyAction, startGame } from '../server/game/engine.js';
import { addCharacter, addCpuCharacter, joinRoom } from '../server/game/lobby.js';
import { cpuDecide, cpuPersonality, isCpu } from '../server/game/cpu.js';
import { jobDef } from '../server/game/jobs.js';
import { createRng } from '../server/game/rng.js';
import { cardBlockReason, cardDef } from '../server/game/cards.js';

const MAX_ACTIONS = 20000;

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

/** Random policy: a random enabled option; before a spin, a random playable card half of the time. */
function randomAction(room, charId, rng, data) {
  const p = room.turn.pending;
  if (p) {
    const opts = p.options.filter((o) => !o.disabled);
    return { type: 'choose', characterId: charId, promptId: p.promptId, optionId: rng.pick(opts.length ? opts : p.options).id };
  }
  const c = room.characters.find((x) => x.id === charId);
  if (!room.turn.cardUsed && rng.next() < 0.5) {
    const round = room.turn.round;
    const playable = (c.cards ?? [])
      .map((k) => ({ k, def: cardDef(data, k.id) }))
      .filter(({ def }) => def && !cardBlockReason(room, c, def, data)); // blue / status / passive, job-only, no payday ahead
    const targets = room.characters.filter((t) => t.id !== c.id && !t.finished && !((t.lastTargetedBy?.[c.id] ?? -Infinity) >= round - 1));
    const ok = playable.filter(({ def }) => def.kind !== 'sabotage' || targets.length);
    if (ok.length) {
      const { k, def } = rng.pick(ok);
      return {
        type: 'useCard',
        characterId: c.id,
        cardUid: k.uid,
        ...(def.kind === 'sabotage' ? { targetId: rng.pick(targets).id } : {}),
        ...(def.effect?.exact ? { value: rng.int(data.balance.spin.min, data.balance.spin.max) } : {}),
      };
    }
  }
  // 룰렛 실력 모드: an average human aims at a random number
  return room.config?.rouletteMode === 'skill' ? { type: 'spin', characterId: charId, target: rng.int(1, 10), input: 'gauge' } : { type: 'spin', characterId: charId };
}

/**
 * One headless game. CPU characters (owner 'cpu') use `cpuDecide`; `randoms` characters (owner session 'rand')
 * play randomly. @returns {{room, ranking, actions}}
 */
export function playCpuGame({ cpus = 4, randoms = 0, mode = 'lifetime', seed = 1, eraTurns, holidays = true, roulette = 'random', data = gameData(), fastLog = true } = {}) {
  const meta = createRng(seed * 2654435761);
  const v = validateRoomConfig({ mode, maxCharacters: Math.min(8, Math.max(2, cpus + randoms)), turnOrder: 'index', holidays, rouletteMode: roulette, ...(eraTurns ? { eraTurns } : {}) });
  if (!v.ok) throw new Error(v.errors.join(' '));
  let room = { id: `cpu${seed}`, code: 'CPUCPU', status: 'lobby', config: { ...v.config, allowCpu: true }, players: [], characters: [], turn: null, log: [], seed: meta.int(0, 2 ** 32 - 1), version: 1, nextPlayerSeq: 0, nextCharSeq: 0, createdAt: 0 };
  if (randoms) room = joinRoom(room, 'rand', '랜덤', 0).room;
  let ci = 0;
  let ri = 0;
  while (ci < cpus || ri < randoms) {
    if (ci < cpus && (ci <= ri || ri >= randoms)) {
      const r = addCpuCharacter(room, {}, 0);
      if (!r.ok) throw new Error(r.error);
      room = r.room;
      ci++;
    } else {
      const r = addCharacter(room, 'rand', { name: `랜덤${ri + 1}`, avatar: { body: meta.next() < 0.5 ? 'boy' : 'girl' } }, 0);
      if (!r.ok) throw new Error(r.error);
      room = r.room;
      ri++;
    }
  }
  let now = 1_000_000;
  const started = startGame(room, { now, data });
  if (!started.ok) throw new Error(started.error);
  room = started.room;
  let actions = 0;
  while (room.status === 'playing') {
    if (++actions > MAX_ACTIONS) throw new Error(`cpu game ${seed} stuck after ${actions} actions`);
    const p = room.turn.pending;
    const id = p ? p.forCharacterIds.find((x) => !Object.hasOwn(p.answers, x)) : room.turn.order[room.turn.currentIndex];
    const c = room.characters.find((x) => x.id === id);
    const action = isCpu(c) ? cpuDecide(room, id, data) : randomAction(room, id, meta, data);
    if (!action) throw new Error(`no action for ${id} (game ${seed})`);
    now += 1000;
    room = applyAction(room, action, { now, data }).room;
    if (fastLog) room.log = []; // the engine clones the room per action; the log is irrelevant here
  }
  return { room, ranking: room.result.ranking, actions };
}

/** Many mixed games → CPU vs random summary. */
export function cpuVsRandom({ games = 100, seed = 1, cpus = 4, randoms = 4, mode = 'lifetime', roulette = 'random', data = gameData() } = {}) {
  let cpuWins = 0;
  const rank = { cpu: [0, 0], random: [0, 0] };
  const total = { cpu: [0, 0], random: [0, 0] };
  for (let g = 0; g < games; g++) {
    const { room, ranking } = playCpuGame({ cpus, randoms, mode, roulette, seed: seed * 100003 + g, data });
    const cpuIds = new Set(room.characters.filter(isCpu).map((c) => c.id));
    if (cpuIds.has(ranking[0].charId)) cpuWins++;
    for (const r of ranking) {
      const k = cpuIds.has(r.charId) ? 'cpu' : 'random';
      rank[k][0] += r.rank;
      rank[k][1]++;
      total[k][0] += r.total;
      total[k][1]++;
    }
  }
  const avg = ([s, n]) => (n ? s / n : 0);
  return { games, cpuWinShare: cpuWins / games, avgRank: { cpu: avg(rank.cpu), random: avg(rank.random) }, avgTotal: { cpu: avg(total.cpu), random: avg(total.random) } };
}

function main() {
  const data = gameData();
  const games = Number(arg('games', 1));
  const seed = Number(arg('seed', 1));
  const cpus = Number(arg('cpus', 4));
  const randoms = Number(arg('random', 0));
  const mode = String(arg('mode', 'lifetime'));
  const roulette = String(arg('roulette', 'random'));
  const verbose = !!arg('verbose', false) || games <= 5;
  const jobName = (c) => {
    if (!c.job) return '무직';
    const d = jobDef(data, c.job.id);
    return `${d?.icon ?? ''}${d?.name ?? c.job.id}★${c.job.rank}`;
  };
  const edu = { none: '고졸', college: '대졸', elite: '명문대졸' };
  const sum = { games: 0, cpuWins: 0, byPers: {}, jobs: {}, routes: {}, edu: {}, rank: { cpu: [0, 0], random: [0, 0] }, total: { cpu: [0, 0], random: [0, 0] }, spins: 0, actions: 0 };
  const t0 = performance.now();
  for (let g = 0; g < games; g++) {
    const s = seed * 100003 + g;
    const { room, ranking, actions } = playCpuGame({ cpus, randoms, mode, roulette, seed: s, data });
    sum.games++;
    sum.actions += actions;
    const byId = new Map(room.characters.map((c) => [c.id, c]));
    const winner = byId.get(ranking[0].charId);
    if (isCpu(winner)) sum.cpuWins++;
    for (const r of ranking) {
      const c = byId.get(r.charId);
      const k = isCpu(c) ? 'cpu' : 'random';
      sum.rank[k][0] += r.rank;
      sum.rank[k][1]++;
      sum.total[k][0] += r.total;
      sum.total[k][1]++;
      if (!isCpu(c)) continue;
      const pers = cpuPersonality(c, room);
      const bp = (sum.byPers[pers] ??= { n: 0, wins: 0, total: 0 });
      bp.n++;
      bp.total += r.total;
      if (r.rank === 1) bp.wins++;
      const jn = c.job ? jobDef(data, c.job.id)?.name ?? c.job.id : '무직';
      sum.jobs[jn] = (sum.jobs[jn] ?? 0) + 1;
      sum.edu[c.education] = (sum.edu[c.education] ?? 0) + 1;
      for (const h of c.routeHistory ?? []) sum.routes[`${h.era}:${h.route}`] = (sum.routes[`${h.era}:${h.route}`] ?? 0) + 1;
    }
    if (verbose) {
      console.log(`\n# 게임 ${g + 1} (seed ${s}, ${mode}) · 턴 ${room.turn.turnNo} · 행동 ${actions} · 우승 ${winner.name}${isCpu(winner) ? ' 🤖' : ''}`);
      for (const r of ranking) {
        const c = byId.get(r.charId);
        const who = isCpu(c) ? `🤖 ${cpuPersonality(c, room)}` : '🎲 랜덤';
        const routes = (c.routeHistory ?? []).map((h) => `${h.era}:${h.route}`).join(',') || '-';
        console.log(`  ${r.rank}위 ${c.name.padEnd(8)} ${who.padEnd(12)} ${String(r.total).padStart(6)}만원 · ${jobName(c)} · ${edu[c.education] ?? c.education} · 루트 ${routes} · 골인 ${c.place}등`);
      }
    }
  }
  const avg = ([s, n]) => (n ? (s / n).toFixed(2) : '-');
  const pct = (n, d) => `${d ? ((100 * n) / d).toFixed(1) : '0.0'}%`;
  console.log(`\n=== CPU 게임 ${sum.games}판 · CPU ${cpus} + 랜덤 ${randoms} · ${mode}${roulette === 'skill' ? ' · 룰렛 실력 모드' : ''} · seed ${seed} · ${(performance.now() - t0).toFixed(0)}ms ===`);
  if (randoms) {
    console.log(`CPU 우승 비율 ${pct(sum.cpuWins, sum.games)} (인원 비율 기준 ${pct(cpus, cpus + randoms)}) · 평균 순위 CPU ${avg(sum.rank.cpu)} / 랜덤 ${avg(sum.rank.random)} · 평균 총자산 CPU ${avg(sum.total.cpu)} / 랜덤 ${avg(sum.total.random)}`);
  }
  console.log(`성격별: ${Object.entries(sum.byPers).map(([k, v]) => `${k} ${v.n}명 · 1위 ${pct(v.wins, v.n)} · 평균 ${(v.total / v.n).toFixed(0)}만원`).join(' | ')}`);
  console.log(`CPU 최종 직업: ${Object.entries(sum.jobs).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
  console.log(`CPU 학력: ${JSON.stringify(sum.edu)} · 루트: ${Object.entries(sum.routes).sort().map(([k, n]) => `${k} ${n}`).join(' · ')}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) main();
