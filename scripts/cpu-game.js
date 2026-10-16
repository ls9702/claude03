#!/usr/bin/env node
// Headless CPU games over the pure engine (no timers, no server).
//   node scripts/cpu-game.js --cpus 3 --humans 1 --human-policy casual --mode lifetime --seed 1 --games 300
//   node scripts/cpu-game.js --cpus 4 --random 4 --games 100          (legacy: = --humans 4 --human-policy random)
//   node scripts/cpu-game.js --matrix --games 300 --seed 1 [--workers 4] (every CPU-strength target, see TARGETS)
// `--cpus M` CPU characters (owner 'cpu', server/game/cpu.js decisions at the real CPU level); `--humans N` human
// proxies (`--human-policy`):
//   - random  = a random enabled option for every prompt, a random playable card half of its turns (the worst case);
//   - casual  = a casual human: the prompt's default 70 % / a random enabled option 30 %, a random route at forks,
//               a playable red card ~30 % of its turns (random valid target / value); skill rooms: a uniformly random
//               target (random rooms: a plain spin);
//   - expert  = the strong CPU heuristic (`cpuDecide(..., {level: 'hard', personality: 'normal'})`) — what the CPUs
//               played like before they were weakened.
// Nobody bets, offers trades or gives gifts (CPUs never do; the proxies don't either). Humans and CPUs are spread
// over the seats and the seats ROTATE from game to game (turn order `index`), so nobody keeps the better seat.
// `--cpu-personality cautious|normal|bold|mix|random` (default random = the seeded pick of a real room; mix =
// cautious / normal / bold rotated over the CPU slots), `--cpu-level easy|normal|hard` = the room's CPU 난이도 (config
// `cpuLevel`; default easy = the real CPUs + the money handicap, normal / hard = no handicap),
// `--roulette skill`, `--mode lifetime|adult|kids`, `--workers N` (worker threads; same results as 1),
// `--world real|chiikawa` (세계 설정; default real so the older numbers stay comparable).
// Prints ≤ 5 games in detail (or with --verbose) and a summary: human 1st-place share, CPU 1st-place share by
// personality, average rank / total per side, CPU jobs / routes / education.
// Importable: `playCpuGame(opts)`, `cpuVsHumans(opts)`, `cpuVsRandom(opts)` (legacy), `targetMatrix(opts)`,
// `humanAction(policy, room, charId, rng, data)`, `HUMAN_POLICIES`, `TARGETS`, `levelTargets(level)`. `--matrix --only casual1,random1,expert1` = only those rows.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getRoster } from '../server/data/index.js';
import { WORLDS, dataForWorld, roomData } from '../server/game/world.js';
import { validateRoomConfig } from '../server/game/config.js';
import { applyAction, startGame } from '../server/game/engine.js';
import { addCharacter, addCpuCharacter, joinRoom } from '../server/game/lobby.js';
import { PERSONALITIES, cpuDecide, cpuPersonality, isCpu } from '../server/game/cpu.js';
import { jobDef } from '../server/game/jobs.js';
import { createRng } from '../server/game/rng.js';
import { cardBlockReason, cardColor, cardDef } from '../server/game/cards.js';

/** CH-1: player looks are roster characters (no gender); a random one per character. */
const ROSTER_IDS = getRoster().characters.map((x) => x.id);

const MAX_ACTIONS = 20000;
export const HUMAN_POLICIES = ['casual', 'random', 'expert'];

// ---------- human proxies ----------

/** Sabotage targets the engine accepts for `c` now (not targeted by `c` this / last round). */
const targetsFor = (room, c) => room.characters.filter((t) => t.id !== c.id && !t.finished && !((t.lastTargetedBy?.[c.id] ?? -Infinity) >= room.turn.round - 1));

/** A random playable card action for the current character (red cards only when `redOnly`), or null. */
function randomCard(room, c, rng, data, { redOnly = false } = {}) {
  const targets = targetsFor(room, c);
  const ok = (c.cards ?? [])
    .map((k) => ({ k, def: cardDef(data, k.id) }))
    .filter(({ def }) => def && !cardBlockReason(room, c, def, data)) // blue / status / passive, job-only, no payday ahead
    .filter(({ def }) => (!redOnly || cardColor(def) === 'red') && (def.kind !== 'sabotage' || targets.length));
  if (!ok.length) return null;
  const { k, def } = rng.pick(ok);
  return {
    type: 'useCard',
    characterId: c.id,
    cardUid: k.uid,
    ...(def.kind === 'sabotage' ? { targetId: rng.pick(targets).id } : {}),
    ...(def.effect?.exact ? { value: rng.int(data.balance.spin.min, data.balance.spin.max) } : {}),
  };
}

/** The spin of a human proxy: skill rooms aim at a uniformly random number (an average human), else a plain spin. */
const humanSpin = (room, charId, rng) => (room.config?.rouletteMode === 'skill' ? { type: 'spin', characterId: charId, target: rng.int(1, 10), input: 'gauge' } : { type: 'spin', characterId: charId });

/**
 * The next action of a human proxy (`policy` ∈ HUMAN_POLICIES) for character `charId` — answering the pending prompt,
 * or a card (maybe) / the spin on its turn. `rng` = the harness RNG (never the game RNG).
 */
export function humanAction(policy, room, charId, rng, data = null) {
  data = roomData(room, data);
  if (policy === 'expert') return cpuDecide(room, charId, data, { level: 'hard', personality: 'normal' });
  const p = room.turn.pending;
  const c = room.characters.find((x) => x.id === charId);
  if (p) {
    const opts = p.options.filter((o) => !o.disabled);
    const pool = opts.length ? opts : p.options;
    let id = rng.pick(pool).id;
    if (policy === 'casual' && p.kind !== 'routeChoice' && rng.next() < 0.7 && opts.some((o) => o.id === p.defaultOptionId)) id = p.defaultOptionId;
    return { type: 'choose', characterId: charId, promptId: p.promptId, optionId: id };
  }
  if (!room.turn.cardUsed) {
    const chance = policy === 'casual' ? 0.3 : 0.5;
    if (rng.next() < chance) {
      const a = randomCard(room, c, rng, data, { redOnly: policy === 'casual' });
      if (a) return a;
    }
  }
  return humanSpin(room, charId, rng);
}

// ---------- one game ----------

/** Seat kinds for `n` seats with `humans` humans spread evenly, rotated by `shift`: ['human' | 'cpu', …]. */
export function seatPlan(n, humans, shift = 0) {
  const seats = Array(n).fill('cpu');
  for (let i = 0; i < humans; i++) seats[(Math.floor((i * n) / humans) + shift) % n] = 'human';
  return seats;
}

/**
 * One headless game. CPU characters (owner 'cpu') use `cpuDecide` at the room's CPU 난이도 (`cpuLevel` → room config
 * `cpuLevel`, default easy = the real CPUs + handicap); `humans`
 * characters (sessions h1…) play `humanPolicy`. `randoms` (legacy) = extra random-policy humans. `seat` rotates the
 * seats (default 0: humans first). `cpuPersonality`: a personality for every CPU, 'mix' (rotated over the CPU
 * slots and `seat`) or undefined / 'random' (the lobby's seeded pick).
 * @returns {{room, ranking, actions}}
 */
export function playCpuGame({ cpus = 4, humans = 0, humanPolicy = 'random', randoms = 0, mode = 'lifetime', seed = 1, eraTurns, holidays = true, roulette = 'random', world = 'real', data = null, fastLog = true, seat = null, cpuPersonality: persona, cpuLevel } = {}) {
  data = dataForWorld(world, data);
  if (randoms && !humans) {
    humans = randoms;
    humanPolicy = 'random';
  }
  if (!HUMAN_POLICIES.includes(humanPolicy)) throw new Error(`--human-policy ${HUMAN_POLICIES.join('|')} (got ${humanPolicy})`);
  const meta = createRng(seed * 2654435761);
  const n = cpus + humans;
  const v = validateRoomConfig({ mode, maxCharacters: Math.min(8, Math.max(2, n)), turnOrder: 'index', holidays, rouletteMode: roulette, world, ...(cpuLevel ? { cpuLevel } : {}), ...(eraTurns ? { eraTurns } : {}) });
  if (!v.ok) throw new Error(v.errors.join(' '));
  let room = { id: `cpu${seed}`, code: 'CPUCPU', status: 'lobby', config: { ...v.config, allowCpu: true }, players: [], characters: [], turn: null, log: [], seed: meta.int(0, 2 ** 32 - 1), version: 1, nextPlayerSeq: 0, nextCharSeq: 0, createdAt: 0 };
  // legacy layout (seat null, random humans): CPU and human alternate, CPU first — as before
  const seats = seat == null ? (randoms ? altSeats(cpus, humans) : seatPlan(n, humans, 0)) : seatPlan(n, humans, seat);
  const sessions = Math.min(4, humans);
  for (let s = 0; s < sessions; s++) room = joinRoom(room, `h${s + 1}`, `사람${s + 1}`, 0).room;
  let hi = 0;
  let ci = 0;
  for (const kind of seats) {
    if (kind === 'cpu') {
      const p = persona === 'mix' ? PERSONALITIES[(ci + (seat ?? 0)) % PERSONALITIES.length] : persona && persona !== 'random' ? persona : undefined;
      const r = addCpuCharacter(room, p ? { personality: p } : {}, 0);
      if (!r.ok) throw new Error(r.error);
      room = r.room;
      ci++;
    } else {
      const r = addCharacter(room, `h${(hi % sessions) + 1}`, { name: `사람${hi + 1}`, avatar: { character: ROSTER_IDS[Math.min(ROSTER_IDS.length - 1, Math.floor(meta.next() * ROSTER_IDS.length))] } }, 0); // CH-1 roster look
      if (!r.ok) throw new Error(r.error);
      room = r.room;
      hi++;
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
    const action = isCpu(c) ? cpuDecide(room, id, data) : humanAction(humanPolicy, room, id, meta, data); // the room's CPU 난이도
    if (!action) throw new Error(`no action for ${id} (game ${seed})`);
    now += 1000;
    room = applyAction(room, action, { now, data }).room;
    if (fastLog) room.log = []; // the engine clones the room per action; the log is irrelevant here
  }
  return { room, ranking: room.result.ranking, actions };
}

/** Legacy seat layout: CPU and human alternate (CPU first), the rest at the end. */
function altSeats(cpus, humans) {
  const out = [];
  let ci = 0;
  let hi = 0;
  while (ci < cpus || hi < humans) {
    if (ci < cpus && (ci <= hi || hi >= humans)) {
      out.push('cpu');
      ci++;
    } else {
      out.push('human');
      hi++;
    }
  }
  return out;
}

/** Plain per-game record (what the summaries need; workers post these). */
function gameRecord(room, ranking, actions) {
  const byId = new Map(room.characters.map((c) => [c.id, c]));
  return {
    actions,
    chars: ranking.map((r) => {
      const c = byId.get(r.charId);
      return {
        rank: r.rank,
        total: r.total,
        cpu: isCpu(c),
        personality: isCpu(c) ? cpuPersonality(c, room) : null,
        name: c.name,
        job: c.job?.id ?? null,
        jobRank: c.job?.rank ?? 0,
        education: c.education,
        routes: (c.routeHistory ?? []).map((h) => `${h.era}:${h.route}`),
        place: c.place,
        married: !!c.spouse,
        house: c.house?.id ?? null,
        wishes: c.wishes ?? 0,
        gambles: c.record?.gambles ?? 0,
        overtime: c.record?.overtime ?? 0,
        rankUps: c.record?.rankUps ?? 0,
        sabotage: c.record?.sabotage ?? 0,
        items: c.items?.length ?? 0,
      };
    }),
  };
}

// ---------- many games ----------

/** Game seeds: `seed * 100003 + g`; the seat rotates with g. */
const gameSeed = (seed, g) => seed * 100003 + g;

function playRange(opts, from, to) {
  const out = [];
  const n = (opts.cpus ?? 3) + (opts.humans ?? 0);
  for (let g = from; g < to; g++) {
    const { room, ranking, actions } = playCpuGame({ ...opts, seed: gameSeed(opts.seed ?? 1, g), seat: opts.rotate === false ? null : g % n });
    out.push(gameRecord(room, ranking, actions));
  }
  return out;
}

/** Runs `games` games (in `workers` threads when > 1) → per-game records. */
async function playMany(opts) {
  const games = opts.games ?? 100;
  const workers = Math.max(1, Math.min(opts.workers ?? 1, games));
  if (workers === 1) return playRange(opts, 0, games);
  const { Worker } = await import('node:worker_threads');
  const self = fileURLToPath(import.meta.url);
  const chunks = [];
  const per = Math.ceil(games / workers);
  for (let w = 0; w < workers; w++) {
    const from = w * per;
    const to = Math.min(games, from + per);
    if (from >= to) continue;
    const { data, ...plain } = opts; // gameData() is loaded in the worker
    chunks.push(
      new Promise((resolve, reject) => {
        const wk = new Worker(self, { workerData: { cpuGameWorker: true, opts: plain, from, to } });
        wk.once('message', resolve);
        wk.once('error', reject);
      }),
    );
  }
  return (await Promise.all(chunks)).flat();
}

/** Summary of per-game records. */
export function summarize(records) {
  const s = { games: records.length, humanWins: 0, cpuWins: 0, rank: { human: [0, 0], cpu: [0, 0] }, total: { human: [0, 0], cpu: [0, 0] }, byPers: {}, jobs: {}, routes: {}, edu: {}, married: [0, 0], houses: [0, 0], actions: 0 };
  for (const r of records) {
    s.actions += r.actions;
    const win = r.chars.find((c) => c.rank === 1);
    if (win?.cpu) s.cpuWins++;
    else s.humanWins++;
    for (const c of r.chars) {
      const k = c.cpu ? 'cpu' : 'human';
      s.rank[k][0] += c.rank;
      s.rank[k][1]++;
      s.total[k][0] += c.total;
      s.total[k][1]++;
      if (!c.cpu) continue;
      const bp = (s.byPers[c.personality] ??= { n: 0, wins: 0, total: 0, rank: 0, college: 0, married: 0, house: 0, wishes: 0, gambles: 0, overtime: 0, rankUps: 0, sabotage: 0, items: 0 });
      bp.n++;
      bp.total += c.total;
      bp.rank += c.rank;
      if (c.rank === 1) bp.wins++;
      if (c.education && c.education !== 'none') bp.college++;
      if (c.married) bp.married++;
      if (c.house) bp.house++;
      for (const k of ['wishes', 'gambles', 'overtime', 'rankUps', 'sabotage', 'items']) bp[k] += c[k] ?? 0;
      s.jobs[c.job ?? 'none'] = (s.jobs[c.job ?? 'none'] ?? 0) + 1;
      s.edu[c.education] = (s.edu[c.education] ?? 0) + 1;
      for (const h of c.routes) s.routes[h] = (s.routes[h] ?? 0) + 1;
      s.married[0] += c.married ? 1 : 0;
      s.married[1]++;
      s.houses[0] += c.house ? 1 : 0;
      s.houses[1]++;
    }
  }
  const avg = ([a, n]) => (n ? a / n : 0);
  s.humanWinShare = s.games ? s.humanWins / s.games : 0;
  s.avgRank = { human: avg(s.rank.human), cpu: avg(s.rank.cpu) };
  s.avgTotal = { human: avg(s.total.human), cpu: avg(s.total.cpu) };
  return s;
}

/** Many games of `cpus` CPUs + `humans` human proxies → summary (`summarize`). */
export async function cpuVsHumans(opts = {}) {
  const records = await playMany({ games: 100, seed: 1, cpus: 3, humans: 1, humanPolicy: 'casual', mode: 'lifetime', roulette: 'random', ...opts });
  return summarize(records);
}

/** Legacy: many mixed CPU vs random games (synchronous, old seat layout) → CPU win share / rank / total. */
export function cpuVsRandom({ games = 100, seed = 1, cpus = 4, randoms = 4, mode = 'lifetime', roulette = 'random', eraTurns, world = 'real', data = null } = {}) {
  const records = [];
  for (let g = 0; g < games; g++) {
    const { room, ranking, actions } = playCpuGame({ cpus, randoms, mode, roulette, eraTurns, world, seed: gameSeed(seed, g), data });
    records.push(gameRecord(room, ranking, actions));
  }
  const s = summarize(records);
  return { games, cpuWinShare: s.cpuWins / games, avgRank: { cpu: s.avgRank.cpu, random: s.avgRank.human }, avgTotal: { cpu: s.avgTotal.cpu, random: s.avgTotal.human } };
}

/** The CPU-strength targets of the easy level (docs/HANDOFF.md 5-1): human 1st-place share ≥ `min`. */
export const TARGETS = [
  { key: 'casual1', label: '평범한 사람 1 + CPU 3', humans: 1, cpus: 3, humanPolicy: 'casual', min: 0.9 },
  { key: 'random1', label: '무작위 사람 1 + CPU 3', humans: 1, cpus: 3, humanPolicy: 'random', min: 0.75 },
  { key: 'casual2', label: '평범한 사람 2 + CPU 2', humans: 2, cpus: 2, humanPolicy: 'casual', min: 0.97 },
  { key: 'casual4', label: '평범한 사람 4 + CPU 4', humans: 4, cpus: 4, humanPolicy: 'casual', min: 0.97 },
  { key: 'expert1', label: '고수 1 + CPU 3', humans: 1, cpus: 3, humanPolicy: 'expert', min: 0.95 },
];

/**
 * The targets of a CPU 난이도: easy = TARGETS (people win ≥ 90 % …); normal = 「비슷한 실력」: a casual person 1 + 3 CPUs
 * wins 25–45 % (fair 25 %), the rest are reported without a target; hard = no target (the old strong CPUs: people lose
 * most games).
 */
export function levelTargets(level = 'easy') {
  if (level === 'normal') return TARGETS.map((t) => (t.key === 'casual1' ? { ...t, min: 0.25, max: 0.45 } : { ...t, min: undefined }));
  if (level === 'hard') return TARGETS.map((t) => ({ ...t, min: undefined }));
  return TARGETS;
}

/**
 * Every target in lifetime mode, the casual 1 + 3 case in adult / kids / skill-roulette rooms and against each CPU
 * personality alone (`only` = target keys → just those lifetime rows, no extras). @returns [{label, mode, roulette,
 * personality, min?, max?, summary}]
 */
export async function targetMatrix({ games = 300, seed = 1, workers = 1, cpuLevel, extra = true, world = 'real', only = null } = {}) {
  const rows = [];
  const targets = levelTargets(cpuLevel ?? 'easy');
  const run = async (row) => rows.push({ ...row, summary: await cpuVsHumans({ games, seed, workers, cpuLevel, world, ...row }) });
  for (const t of targets) if (!only || only.includes(t.key)) await run({ ...t, mode: 'lifetime', roulette: 'random' });
  if (extra && !only) {
    const casual = targets[0];
    for (const mode of ['adult', 'kids']) await run({ ...casual, mode, roulette: 'random' });
    await run({ ...casual, mode: 'lifetime', roulette: 'skill' });
    await run({ ...targets[1], mode: 'lifetime', roulette: 'skill' });
    for (const p of PERSONALITIES) await run({ ...casual, mode: 'lifetime', roulette: 'random', cpuPersonality: p, min: undefined, max: undefined });
  }
  return rows;
}

// ---------- CLI ----------

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

const pct = (x) => `${(100 * x).toFixed(1)}%`;
const PERS_KO = { cautious: '🐢 신중', normal: '🙂 보통', bold: '🔥 대담' };

function printSummary(s, { cpus, humans, humanPolicy, mode, roulette, seed, ms, world = 'real' }) {
  const per = (k) => s.byPers[k];
  console.log(`\n=== ${s.games}판 · CPU ${cpus} + 사람(${humanPolicy}) ${humans} · ${mode}${roulette === 'skill' ? ' · 룰렛 실력 모드' : ''} · 세계 ${world} · seed ${seed}${ms != null ? ` · ${ms.toFixed(0)}ms` : ''} ===`);
  if (humans) console.log(`사람 1위 ${pct(s.humanWinShare)} (인원 비율 ${pct(humans / (cpus + humans))}) · 평균 순위 사람 ${s.avgRank.human.toFixed(2)} / CPU ${s.avgRank.cpu.toFixed(2)} · 평균 총자산 사람 ${s.avgTotal.human.toFixed(0)} / CPU ${s.avgTotal.cpu.toFixed(0)}만원`);
  console.log(`CPU 성향별: ${PERSONALITIES.filter(per).map((k) => `${PERS_KO[k]} ${per(k).n}명 · 1위 ${pct(per(k).wins / per(k).n)} · 평균 순위 ${(per(k).rank / per(k).n).toFixed(2)} · 평균 ${(per(k).total / per(k).n).toFixed(0)}만원`).join(' | ')}`);
  // style per personality: 대학 / 단짝 동거 / 집 (share of CPUs), 소원 · 인생역전 도박 · 야근 · 승진 · 뒤통수 · 아이템 (per CPU)
  const style = (k) => {
    const b = per(k);
    const r = (x) => (x / b.n).toFixed(1);
    return `${PERS_KO[k]} 대학 ${pct(b.college / b.n)} · 단짝 ${pct(b.married / b.n)} · 집 ${pct(b.house / b.n)} · 소원 ${r(b.wishes)} · 도박 ${r(b.gambles)} · 야근 ${r(b.overtime)} · 승진 ${r(b.rankUps)} · 뒤통수 ${r(b.sabotage)} · 아이템 ${r(b.items)}`;
  };
  console.log(`CPU 성향별 스타일: ${PERSONALITIES.filter(per).map(style).join(' | ')}`);
  const data = dataForWorld(world);
  const jobs = Object.entries(s.jobs).sort((a, b) => b[1] - a[1]);
  const nCpu = s.married[1] || 1;
  console.log(`CPU 최종 직업: ${jobs.map(([k, n]) => `${k === 'none' ? '무직' : jobDef(data, k)?.name ?? k} ${pct(n / nCpu)}`).join(' · ')}`);
  console.log(`CPU 학력: ${JSON.stringify(s.edu)} · 단짝 동거 ${pct(s.married[0] / nCpu)} · 집 ${pct(s.houses[0] / nCpu)} · 루트: ${Object.entries(s.routes).sort().map(([k, n]) => `${k} ${n}`).join(' · ')}`);
}

async function main() {
  const world = String(arg('world', 'real'));
  if (!WORLDS.includes(world)) throw new Error(`--world ${WORLDS.join('|')} (got ${world})`);
  const data = dataForWorld(world);
  const games = Number(arg('games', 1));
  const seed = Number(arg('seed', 1));
  const workers = Number(arg('workers', 1)) || 1;
  const cpuLevel = arg('cpu-level', undefined);
  if (arg('matrix', false)) {
    const t0 = performance.now();
    const only = typeof arg('only', null) === 'string' ? String(arg('only')).split(',') : null; // e.g. --only casual1,random1,expert1
    const rows = await targetMatrix({ games: Number(arg('games', 300)), seed, workers, cpuLevel, world, only });
    console.log(`\n=== CPU 세기 목표 (${Number(arg('games', 300))}판 × seed ${seed} · 세계 ${world}${cpuLevel ? ` · CPU ${cpuLevel}` : ''} · ${((performance.now() - t0) / 1000).toFixed(0)}초) ===`);
    for (const r of rows) {
      const s = r.summary;
      const ok = r.min == null ? '  ' : s.humanWinShare >= r.min && (r.max == null || s.humanWinShare <= r.max) ? '✅' : '❌';
      const tag = `${r.label} · ${r.mode}${r.roulette === 'skill' ? ' · 실력 룰렛' : ''}${r.cpuPersonality ? ` · CPU 전원 ${PERS_KO[r.cpuPersonality]}` : ''}`;
      console.log(`${ok} ${tag.padEnd(44)} 사람 1위 ${pct(s.humanWinShare).padStart(6)}${r.min != null ? ` (목표 ${r.max != null ? `${pct(r.min)}~${pct(r.max)}` : `≥ ${pct(r.min)}`})` : ''} · 평균 순위 사람 ${s.avgRank.human.toFixed(2)} / CPU ${s.avgRank.cpu.toFixed(2)} · 총자산 사람 ${s.avgTotal.human.toFixed(0)} / CPU ${s.avgTotal.cpu.toFixed(0)}`);
    }
    return;
  }
  const cpus = Number(arg('cpus', 4));
  const legacyRandom = Number(arg('random', 0));
  const humans = legacyRandom || Number(arg('humans', 0));
  const humanPolicy = legacyRandom ? 'random' : String(arg('human-policy', 'casual'));
  const mode = String(arg('mode', 'lifetime'));
  const roulette = String(arg('roulette', 'random'));
  const persona = arg('cpu-personality', undefined);
  const verbose = !!arg('verbose', false) || games <= 5;
  const opts = { cpus, humans, humanPolicy, mode, roulette, seed, cpuPersonality: persona, cpuLevel, workers, world };
  const t0 = performance.now();
  if (verbose) {
    const edu = { none: '고졸', college: '대졸', elite: '명문대졸' };
    const jobName = (id, rank) => (id ? `${jobDef(data, id)?.icon ?? ''}${jobDef(data, id)?.name ?? id}★${rank}` : '무직');
    const records = [];
    for (let g = 0; g < games; g++) {
      const s = gameSeed(seed, g);
      const { room, ranking, actions } = playCpuGame({ ...opts, seed: s, seat: g % (cpus + humans), data });
      const rec = gameRecord(room, ranking, actions);
      records.push(rec);
      const win = rec.chars[0];
      console.log(`\n# 게임 ${g + 1} (seed ${s}, ${mode}) · 턴 ${room.turn.turnNo} · 행동 ${actions} · 우승 ${win.name}${win.cpu ? ' 🤖' : ''}`);
      for (const c of rec.chars) {
        const who = c.cpu ? `🤖 ${PERS_KO[c.personality]}` : `🙋 ${humanPolicy}`;
        console.log(`  ${c.rank}위 ${c.name.padEnd(8)} ${who.padEnd(10)} ${String(c.total).padStart(6)}만원 · ${jobName(c.job, c.jobRank)} · ${edu[c.education] ?? c.education} · 루트 ${c.routes.join(',') || '-'}${c.married ? ' · 💞' : ''}${c.house ? ` · 🏠${c.house}` : ''} · 골인 ${c.place ?? '-'}등`);
      }
    }
    printSummary(summarize(records), { ...opts, ms: performance.now() - t0 });
    return;
  }
  const records = await playMany({ ...opts, games });
  printSummary(summarize(records), { ...opts, ms: performance.now() - t0 });
}

// worker thread: play a slice of games and post the records back
const { isMainThread, parentPort, workerData } = await import('node:worker_threads');
if (!isMainThread && workerData?.cpuGameWorker === true && parentPort) {
  parentPort.postMessage(playRange(workerData.opts, workerData.from, workerData.to));
} else {
  const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
  if (isMain) main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
