// Game engine: pure reducer `applyAction(room, action, ctx) → { room, events, logs }`.
// Turn state machine: awaitSpin → resolveSpace → (awaitDecision)* → endTurn → next character.
// Never mutates its input; randomness only from ctx.rng (default: restored from room.rngState).
import { gameData } from '../data/index.js';
import { HALT_TYPES, buildBoard, findTile, nextPosition, startPosition, tileAt, tileIdAt, wrapsAt } from './board.js';
import {
  EngineError,
  addLog,
  assertOwner,
  changeMoney,
  charById,
  createTx,
  emit,
  fail,
  josa,
  netWorth,
  turnTimeoutMs,
  won,
} from './effects.js';
import { endGame as lobbyEndGame, startGame as lobbyStartGame } from './lobby.js';
import { applyResult, castVote, closeVote, emitMvpDecided } from './result.js';
import { createRng } from './rng.js';
import { decorateEvents } from './presentation.js';
import { promptComplete, resolvePrompt, resolveTile } from './spaces.js';
import { ensureLife, initLife, lifeStep, preSpinStep, spinSteps } from './growth.js';
import { ROULETTE_INPUTS, isSkillRoom, parseTarget, skillValue } from './roulette.js';
import { militaryPay } from './jobs.js';
import { applyEraNews, drawNews, drawStartNews } from './news.js';
import {
  applySpinMods,
  cancelTrade,
  dropTrades,
  ensureCards,
  ensureRoomCards,
  expireTrades,
  gift,
  itemsValue,
  offerTrade,
  respondTrade,
  useCard,
} from './cards.js';
import { queueEraOpening, runEraOpenings } from './holidays.js';
import { ensureFamily, ensureRoomFamily, growChildrenOnEra, growChildrenOnSpin, initFamily, schoolMeetSummary } from './family.js';
import { drawHousingMarket, houseValue, syncHouseOwners } from './houses.js';
import { ensureRoomTreasures, ensureTreasures } from './treasures.js';
import { ensureRecord, initRecord, recordHighlights, topHighlights, trackRecords } from './highlights.js';
import './submaps.js'; // Stage 9: registers the hometown / temple / jeju / reversal prompts
import { enterPassTile } from './passTile.js'; // loop maps: 찬스 광장
import { finishCharacter } from './finish.js'; // final era: goal order / 조기 은퇴 / 올인 파산

export { finishCharacter };

export { EngineError, turnTimeoutMs };
export const ACTION_TYPES = ['spin', 'choose', 'bet', 'timeout', 'skip', 'useCard', 'offerTrade', 'respondTrade', 'cancelTrade', 'gift', 'expireTrades', 'vote', 'closeVote'];
/** Stage 9: actions of a finished game (MVP vote). */
export const RESULT_ACTIONS = ['vote', 'closeVote'];
export const BET_KINDS = ['oddEven', 'range'];

function makeCtx(room, ctx = {}) {
  return {
    rng: ctx.rng ?? createRng(room.rngState ?? room.seed ?? 0),
    now: ctx.now ?? Date.now(),
    data: ctx.data ?? gameData(),
  };
}

// ---------- start ----------

/** Mix a secret uint32 into an RNG state (FNV-style avalanche; pure). */
export function mixSecret(state, secret) {
  let h = (state ^ Math.imul(secret >>> 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Admin start: lobby validation + board + character init. Returns lobby-style result. */
export function startGame(room, ctx = {}) {
  const c0 = { ...ctx, rng: ctx.rng ?? createRng(room.seed ?? 0) };
  const { rng: boardRng, now, data } = makeCtx(room, c0);
  const r = lobbyStartGame(room, now);
  if (!r.ok) return r;
  const next = r.room;
  next.board = buildBoard(next.config, boardRng, data);
  const firstEra = next.board.eras[0];
  // Stage 6 life records (stats, education, military, job…). Starting stats are public like the board, so they
  // come from the board RNG before the secret is mixed in. A game without 고등학생 (adult mode) starts grown up.
  const adult = !next.board.eras.some((e) => e.id === EXAM_ERA);
  next.characters = next.characters.map((c) => ({
    ...c,
    money: next.config.startingMoney ?? 0,
    debt: 0,
    position: startPosition(0),
    era: firstEra.id,
    route: null,
    routeHistory: [],
    laps: 0, // loop maps: times this character passed its era's start (cosmetic)
    finished: false, // set for everyone at game over (no goal race)
    place: null, // final rank (game over)
    goalBonus: 0, // kept at 0 for old clients (no goal prizes / bonus spins any more)
    pensionGiven: false,
    ...initLife(c, { rng: boardRng, data, adult }),
    // Stage 7: hand cards, items, pending spin modifiers, sabotage memory (all public)
    cards: [],
    items: [],
    spinMods: [],
    lastTargetedBy: {},
    // Stage 8: love {candidates, partner, affection, dates}, spouse, children, house, houseSwaps (all public)
    ...initFamily(),
    // Stage 9: treasures [{uid, id}] (values hidden in room.treasureValues), 사찰 소원 성취 횟수, life record counters
    treasures: [],
    wishes: 0,
  }));
  for (const c of next.characters) c.record = initRecord(c);
  // The board is public; without a secret, its tiles would reveal the seed and so every future spin.
  // The side-effect layer (GameRunner) passes `ctx.secret` = crypto random uint32; tests/simulator omit it
  // (or inject a fixed one) and stay deterministic. The game continues from `rngState` either way.
  const rng = ctx.secret != null ? createRng(mixSecret(boardRng.state, ctx.secret)) : boardRng;
  // Loop maps: one shared era clock — room.eraIndex, turn.eraRound (1..turns) / turn.eraTurns
  next.eraIndex = 0;
  next.turn = { ...next.turn, turnNo: 1, round: 1, eraRound: 1, eraTurns: firstEra.turns, move: null, spun: false, lastSpin: null, spinDeadlineAt: null };
  next.pension = null;
  next.bets = {};
  next.promptSeq = 0;
  next.result = null;
  next.news = {};
  // Stage 7: card uids, open trades, era openings (lotto / holidays; the first era never opens one)
  Object.assign(next, { nextCardSeq: 0, nextTradeSeq: 0, trades: [], holidayCount: 0, holidays: {}, lotto: { draws: [] }, erasOpened: [firstEra.id], eraQueue: [] });
  // Stage 8: partner / child ids, 고교 전원 만남 (once), house owners, 노년 시세
  Object.assign(next, { nextPartnerSeq: 0, nextChildSeq: 0, schoolMeetDone: false, houseOwners: {}, housingMarket: null });
  // Stage 9: treasure uids + hidden appraisal values, highlights per character
  Object.assign(next, { nextTreasureSeq: 0, treasureValues: {}, treasureFakes: {}, highlights: {}, highlightSeq: 0 });
  const tx = createTx(next, { rng, now, data });
  emit(tx, 'gameStarted', { eras: next.board.eras.map((e) => e.id), turns: next.board.eras.map((e) => e.turns), laps: next.board.eras.map((e) => e.lap) });
  drawStartNews(tx);
  next.turn.announce = true;
  continueTurn(tx); // turnStarted (+ the first character's pre-spin decisions, e.g. adult mode's job offer)
  next.rngState = rng.state;
  decorateEvents(tx.events, { room: next, data, seed: rng.state });
  return { ok: true, room: next, logs: [...r.logs, ...tx.logs], events: tx.events };
}

/** Admin force end (keeps a ranking if a game was in progress). */
export function endGame(room, ctx = {}) {
  const now = ctx.now ?? Date.now();
  const r = lobbyEndGame(room, now);
  if (!r.ok) return r;
  if (r.room.trades) r.room.trades = []; // Stage 7: open offers die with the game
  // Held stakes of bets the roulette never settled go back to their bettors (no events on a force end)
  for (const slot of Object.values(r.room.bets ?? {})) {
    for (const [charId, bet] of Object.entries(slot)) {
      if (bet.resolved || !bet.staked) continue;
      const c = charById(r.room, charId);
      if (c && typeof c.money === 'number') c.money += bet.amount;
      bet.resolved = true;
      bet.refunded = true;
    }
  }
  if (r.room.turn) r.room.turn.move = null;
  if (r.room.board && r.room.characters.every((c) => typeof c.money === 'number')) {
    for (const c of r.room.characters) ensureTreasures(ensureRecord(c));
    ensureRoomTreasures(r.room);
    applyResult(r.room, now, { forced: true, ...(ctx.data ? { data: ctx.data } : {}) });
  }
  return r;
}

// ---------- helpers ----------

/** The era whose last high-school turn holds the 수능 (and whose absence makes a mode start grown up). */
const EXAM_ERA = 'high';

const currentCharId = (room) => room.turn?.order?.[room.turn.currentIndex] ?? null;

/** Is this a loop board (every era its own looping map)? Saves from before are migrated (`migrateLoopBoard`). */
export const isLoopBoard = (board) => !!board?.eras?.length && board.eras.every((e) => e.loop || e.final);

function announceTurn(tx) {
  const room = tx.room;
  const turn = room.turn;
  const c = charById(room, currentCharId(room));
  const limit = turnTimeoutMs(room);
  turn.phase = 'awaitSpin';
  turn.spinDeadlineAt = limit ? tx.now + limit : null;
  turn.cardUsed = false; // Stage 7: one card per turn
  turn.spun = false;
  turn.move = null;
  dropTrades(tx, (t) => t.fromId === c.id, 'expired'); // an offer lasts until the offerer's next turn
  emit(tx, 'turnStarted', { charId: c.id, turnNo: turn.turnNo, round: turn.round, eraRound: turn.eraRound, eraTurns: turn.eraTurns, eraIndex: room.eraIndex });
}

/** Back to the roulette after pre-spin decisions (a fresh turn-timer deadline when a prompt interrupted it). */
function awaitSpin(tx) {
  const turn = tx.room.turn;
  if (turn.phase === 'awaitSpin') return;
  const limit = turnTimeoutMs(tx.room);
  turn.phase = 'awaitSpin';
  turn.spinDeadlineAt = limit ? tx.now + limit : null;
}

/** One character arrives in a new era (part of the shared era transition): era / route reset + `eraChanged`. */
function enterEra(tx, c, eraIndex) {
  const era = tx.room.board.eras[eraIndex];
  const from = c.era;
  c.era = era.id;
  c.route = null;
  c.position = startPosition(eraIndex);
  emit(tx, 'eraChanged', { charId: c.id, era: era.id, eraId: era.id, from, eraName: era.name, tone: 'good', emotion: 'joy' });
}

/**
 * The era's turns ran out (the last character finished the last round): everyone moves together to the start of the
 * next era's map. Order: `eraTransition` → one `eraChanged` per character → openings once for everyone: news →
 * 기초연금 (pension era) → 고교 첫 만남 recap (leaving high) → 노년 시세 (senior) → per-character entry effects (news statBonus,
 * children / birth / 용돈 / affection) → queued lotto + holiday prompt (run by the turn loop before `turnStarted`).
 */
function eraTransition(tx) {
  const room = tx.room;
  const board = room.board;
  const turn = room.turn;
  const fromEra = board.eras[room.eraIndex];
  const toIndex = room.eraIndex + 1;
  const to = board.eras[toIndex];
  room.eraIndex = toIndex;
  // the final era (goal race) has no era clock
  turn.eraRound = to.final ? null : 1;
  turn.eraTurns = to.final ? null : to.turns;
  turn.move = null;
  emit(tx, 'eraTransition', {
    fromEraId: fromEra.id,
    toEraId: to.id,
    eraIndex: toIndex,
    turns: to.turns ?? null,
    lap: to.lap ?? null,
    ...(to.final ? { final: true, length: to.tiles.length } : {}),
    eraName: to.name,
    tone: 'good',
    emotion: 'joy',
  });
  addLog(
    tx,
    to.final
      ? `⏳ ${fromEra.name} 시대 끝! 모두 함께 ${to.name} 시대로 — 이제 턴 제한 없이 ${to.tiles.length - 1}칸 앞 인생 골인까지 경주!`
      : `⏳ ${fromEra.name} 시대 끝! 모두 함께 ${to.name} 시대로 (${to.turns}턴 · 한 바퀴 ${to.lap}칸)`,
    { tone: 'good' },
  );
  const chars = turn.order.map((id) => charById(room, id)).filter(Boolean);
  for (const c of chars) enterEra(tx, c, toIndex);
  drawNews(tx, to.id); // 뉴스 속보 of the new era
  if (to.id === tx.data.balance.pension.era) grantPensions(tx);
  if (fromEra.id === 'high') schoolMeetSummary(tx, { force: true }); // 고교 첫 만남 recap (if not shown yet)
  drawHousingMarket(tx, to.id); // Stage 8: 노년 시세 (senior)
  for (const c of chars) {
    applyEraNews(tx, c, to.id);
    growChildrenOnEra(tx, c);
  }
  queueEraOpening(tx, to.id); // Stage 7: lotto draw + holiday, run by the turn loop before the first turn
}

/**
 * 역전 보정 (기초연금) basis: total assets = cash − debt + house value + item resale (the ranking's total without
 * the hidden treasure values and the end-of-game awards). Cash alone made house owners look poor.
 */
export function pensionWorth(c, data) {
  return netWorth(c) + houseValue(c) + itemsValue(data, c);
}

/**
 * 역전 보정 (기초연금) at the transition into the pension era: the bottom `bottomN` by total assets (`pensionWorth`;
 * games with ≥ `minCharacters`) → `room.pension = {recipients, decidedAt, turnNo}`, each paid at once (amount = base +
 * the asset gap to the richest × gapRatio, ≤ max). Never more than `bottomN` payouts.
 */
function grantPensions(tx) {
  const cfg = tx.data.balance.pension;
  const room = tx.room;
  const chars = room.characters;
  if (chars.length < cfg.minCharacters || room.pension) return;
  const worth = (x) => pensionWorth(x, tx.data);
  const given = chars.filter((x) => x.pensionGiven).map((x) => x.id);
  const sorted = [...chars].filter((x) => !given.includes(x.id)).sort((a, b) => worth(a) - worth(b) || (a.seq ?? 0) - (b.seq ?? 0));
  const recipients = [...given, ...sorted.map((x) => x.id)].slice(0, Math.max(given.length, cfg.bottomN));
  room.pension = { recipients, decidedAt: tx.now, turnNo: room.turn?.turnNo ?? 0 };
  const top = Math.max(...chars.map(worth));
  for (const id of recipients) {
    const c = charById(room, id);
    if (!c || c.pensionGiven) continue;
    const raw = cfg.base + Math.max(0, top - worth(c)) * cfg.gapRatio;
    const amount = Math.min(cfg.max, Math.round(raw / 10) * 10);
    c.pensionGiven = true;
    changeMoney(tx, c, amount, 'pension', { emotion: 'joy', tone: 'good' });
    addLog(tx, `👵 역전 보정! ${josa(c.name, '이/가')} 기초연금 ${won(amount)}을 받았다.`, { tone: 'good', charId: c.id, emotion: 'joy' });
  }
}

/** Is the room in its final era (the goal race: no era clock)? */
const inFinalEra = (room) => !!room.board?.eras?.[room.eraIndex ?? 0]?.final;

/** After the goal: a finished character's turn is an automatic bonus roulette (value × bonusSpinUnit). */
function bonusSpin(tx, c) {
  const { min, max } = tx.data.balance.spin;
  const value = tx.rng.int(min, max);
  const amount = value * (tx.data.balance.bonusSpinUnit ?? 0);
  c.goalBonus = (c.goalBonus ?? 0) + amount;
  emit(tx, 'bonusSpin', { charId: c.id, value, amount, tone: 'result' });
  if (amount) changeMoney(tx, c, amount, 'bonusSpin', { emotion: 'joy', tone: 'result' });
  addLog(tx, `🎰 ${c.name} 골 후 보너스 룰렛 ${value}! +${won(amount)}`, { tone: 'result', charId: c.id });
}

/**
 * Game over: after the final era's goal race (everyone finished) — or, without a final race (kids mode), when the
 * last era's turns ran out (everyone finishes at once, `place` = final rank; result.applyResult).
 */
function gameOver(tx) {
  tx.room.trades = [];
  for (const slot of Object.values(tx.room.bets ?? {})) refundBets(tx, slot); // stakes of bets that never resolved
  tx.room.eraQueue = [];
  if (tx.room.turn) tx.room.turn.move = null;
  tx.tracked = trackRecords(tx.room, tx.events, tx.tracked ?? 0); // the titles read the life records
  const ranking = applyResult(tx.room, tx.now, { data: tx.data });
  const res = tx.room.result;
  // Stage 9: the treasure values are revealed now; awards / titles ride on the event for the result show
  emit(tx, 'gameOver', {
    ranking,
    awards: structuredClone(res.awards),
    titles: structuredClone(res.titles),
    treasures: structuredClone(res.treasures),
    mvpClosesAt: res.mvp.closed ? null : res.mvp.closesAt,
    tone: 'result',
  });
  addLog(tx, `🏆 게임 종료! 1등은 ${ranking[0]?.name} (${won(ranking[0]?.total ?? 0)})`, { tone: 'result' });
  if (res.mvp.closed) emitMvpDecided(tx, res.mvp); // no voters (CPU-only / spectators only)
}

/** Log line of a skipped turn by `character.skipReason` (재수 / Stage 9 고향 휴식 / 사찰 수련). */
const SKIP_LINES = {
  retake: (c) => `📖 ${josa(c.name, '은/는')} 재수 중… 이번 턴은 쉬어요`,
  hometown: (c) => `😴 ${josa(c.name, '은/는')} 고향에서 푹 쉬는 중… 이번 턴은 쉬어요`,
  temple: (c) => `🧘 ${josa(c.name, '은/는')} 템플스테이 수련 중… 이번 턴은 쉬어요`,
};

/**
 * Advance to the next character. A full round of the era (the last character in order done) ticks `eraRound`; past
 * the era's turns everyone moves to the next era (`eraTransition`), past the last era the game is over. Characters
 * with `skipTurns` (재수 / 고향 휴식 / 사찰 수련) sit their turn out — the round still counts. The next turn is
 * announced by the turn loop (`turn.announce`) after queued era openings (lotto / holiday prompt).
 */
function endTurn(tx) {
  const room = tx.room;
  const turn = room.turn;
  turn.pending = null;
  turn.move = null;
  turn.phase = 'endTurn';
  const n = turn.order.length;
  for (let guard = 0; guard < 100000; guard++) {
    if (inFinalEra(room) && room.characters.every((x) => x.finished)) return gameOver(tx);
    turn.currentIndex = (turn.currentIndex + 1) % n;
    if (turn.currentIndex === 0) {
      turn.round += 1;
      if (!inFinalEra(room)) {
        const eraTurns = turn.eraTurns ?? room.board.eras[room.eraIndex ?? 0]?.turns ?? 1;
        if ((turn.eraRound ?? 1) >= eraTurns) {
          if ((room.eraIndex ?? 0) + 1 >= room.board.eras.length) return gameOver(tx);
          eraTransition(tx);
        } else turn.eraRound = (turn.eraRound ?? 1) + 1;
      }
    }
    const c = charById(room, turn.order[turn.currentIndex]);
    if (!c) continue;
    if (c.finished) {
      if (!c.retired) bonusSpin(tx, c); // goal race: finished characters keep a bonus roulette (retired ones rest)
      continue;
    }
    if (c.skipTurns > 0) {
      c.skipTurns -= 1;
      addLog(tx, SKIP_LINES[c.skipReason]?.(c) ?? SKIP_LINES.retake(c), { tone: 'info', charId: c.id, emotion: c.skipReason && c.skipReason !== 'retake' ? 'joy' : 'sweat' });
      if (!c.skipTurns) delete c.skipReason;
      continue;
    }
    turn.turnNo += 1;
    turn.spun = false;
    turn.announce = true;
    pruneBets(tx);
    return;
  }
  gameOver(tx);
}

function pruneBets(tx) {
  const keep = tx.data.balance.bets.keepTurns;
  const bets = tx.room.bets ?? {};
  for (const k of Object.keys(bets)) {
    if (Number(k) > tx.room.turn.turnNo - keep) continue;
    refundBets(tx, bets[k]); // never happens in normal play (skip already voids); older saves may hold one
    delete bets[k];
  }
}

/**
 * The turn loop, run after every action: resolve a completed prompt → resume a paused move (찬스 광장) → queued era
 * openings (lotto / holiday) → announce the next turn → the current character's pre-spin decisions (수능 on the last
 * high-school turn, 진로 / 군 복무 / 취업 on the first adult turn) and the roulette wait → after the move, the turn
 * epilogue (graduation, 갈림길, hidden jobs, 프러포즈) → the next character.
 */
function continueTurn(tx) {
  for (let guard = 0; guard < 256; guard++) {
    if (tx.room.status !== 'playing') return;
    const turn = tx.room.turn;
    const pending = turn.pending;
    if (pending) {
      if (!promptComplete(pending)) return;
      resolvePrompt(tx);
      continue;
    }
    if (turn.move) {
      resumeMove(tx);
      continue;
    }
    if (runEraOpenings(tx)) continue; // Stage 7: lotto + 명절 대잔치 of the era just entered
    if (turn.announce) {
      delete turn.announce;
      announceTurn(tx);
      continue;
    }
    const c = charById(tx.room, currentCharId(tx.room));
    if (!turn.spun) {
      if (c && preSpinStep(tx, c)) continue;
      return awaitSpin(tx);
    }
    if (c && lifeStep(tx, c)) continue;
    endTurn(tx);
  }
  throw new Error('continueTurn: too many chained prompts');
}

// ---------- movement (loop maps) ----------

/**
 * Walk `steps` tiles on the era's loop (or the final track). Paydays (salary), the fork (stop) and the goal end the
 * move; a pass tile (찬스 광장) passed with steps left pauses it (`turn.move = {charId, remaining}`) behind its prompt — the turn loop resumes it
 * (`resumed: true`) once the prompt (and a chained shop) resolved. Wrapping past the start counts a lap.
 */
function walk(tx, c, steps, { resumed = false } = {}) {
  const room = tx.room;
  const board = room.board;
  let pos = c.position;
  const from = tileIdAt(board, pos);
  const path = [];
  let halted = null;
  let remaining = 0;
  let wrapped = 0;
  let pass = null;
  for (let s = 0; s < steps; s++) {
    const np = nextPosition(board, pos, c.route);
    if (!np) break;
    if (wrapsAt(board, pos, np)) {
      wrapped++;
      c.laps = (c.laps ?? 0) + 1;
    }
    pos = np;
    const t = tileAt(board, pos);
    path.push(t.id);
    if (t.type === 'merge') completeRoute(c, board.eras[pos.eraIndex].id);
    if (HALT_TYPES.includes(t.type)) {
      halted = t.type;
      break;
    }
    if (t.type === 'pass' && s < steps - 1) {
      halted = 'pass';
      remaining = steps - 1 - s;
      pass = t;
      break;
    }
  }
  c.position = pos;
  emit(tx, 'moved', {
    charId: c.id,
    from,
    path,
    steps: path.length,
    halted,
    ...(halted === 'pass' ? { remaining } : {}),
    ...(resumed ? { resumed: true } : {}),
    ...(wrapped ? { wrapped: true, laps: wrapped } : {}),
  });
  if (wrapped) addLog(tx, `🔁 ${josa(c.name, '이/가')} 출발점을 지나 한 바퀴를 돌았다! (${c.laps}바퀴째)`, { tone: 'info', charId: c.id });
  if (!resumed) growChildrenOnSpin(tx, c); // Stage 8: children also grow every few parent spins
  if (pass) {
    room.turn.move = { charId: c.id, remaining, tileId: pass.id };
    enterPassTile(tx, c, pass);
    return;
  }
  const tile = tileAt(board, pos);
  if (tile) {
    emit(tx, 'landed', { charId: c.id, tileId: tile.id, tileType: tile.type, route: tile.route ?? null });
    resolveTile(tx, c, tile, { onGoal: (ch) => finishCharacter(tx, ch) });
  }
}

/** Continue a move paused on a pass tile (its prompt resolved). */
function resumeMove(tx) {
  const m = tx.room.turn.move;
  tx.room.turn.move = null;
  const c = charById(tx.room, m.charId);
  if (!c || !(m.remaining > 0)) return;
  walk(tx, c, m.remaining, { resumed: true });
}

/** Reaching the merge tile completes the route of this lap (`routeHistory` entry) and leaves it. */
function completeRoute(c, eraId) {
  const h = c.routeHistory.findLast((x) => x.era === eraId && !x.completed);
  if (h) h.completed = true;
  c.route = null;
}

/**
 * Saves from before the loop maps (linear tracks + goal race): the board is rebuilt from the room seed (public, like
 * any board) and everyone moves to the start of the most advanced character's era, which becomes the shared era
 * (round 1 of it; the final era = the goal race, where characters already at the goal keep their place). Pure; returns
 * the migrated clone + a log.
 */
export function migrateLoopBoard(room, ctx = {}) {
  if (room.status !== 'playing' || !room.board || isLoopBoard(room.board)) return { room, events: [], logs: [], migrated: false };
  const { now, data } = makeCtx(room, ctx);
  const next = structuredClone(room);
  const oldEras = next.board.eras.map((e) => e.id);
  next.board = buildBoard(next.config, createRng(next.seed ?? 0), data);
  const eraIds = next.board.eras.map((e) => e.id);
  const idx = Math.max(0, ...next.characters.map((c) => eraIds.indexOf(c.era ?? oldEras[c.position?.eraIndex ?? 0])));
  const era = next.board.eras[idx];
  next.eraIndex = idx;
  for (const c of next.characters) {
    c.era = era.id;
    c.route = null;
    c.laps ??= 0;
    for (const h of c.routeHistory ?? []) h.completed = true;
    // into the final race: characters already at the goal keep their place; otherwise nobody has finished yet
    if (era.final && c.finished) {
      c.position = { eraIndex: idx, route: 'main', index: era.tiles.length - 1 };
      continue;
    }
    c.position = startPosition(idx);
    c.finished = false;
    c.place = null;
  }
  const turn = next.turn;
  Object.assign(turn, { eraRound: 1, eraTurns: era.turns, move: null });
  if (turn.phase === 'awaitSpin' || turn.phase === 'endTurn') turn.spun = false;
  else turn.spun = true;
  if (turn.pending?.kind === 'routeChoice') {
    turn.pending = null;
    turn.phase = 'awaitSpin';
    turn.spun = false;
  }
  if (turn.phase === 'gameOver') turn.phase = 'awaitSpin';
  next.erasOpened = [...new Set([...(next.erasOpened ?? []), ...eraIds.slice(0, idx + 1)])];
  const tx = createTx(next, { rng: createRng(next.rngState ?? next.seed ?? 0), now, data });
  addLog(tx, `🔄 새 순환 맵으로 옮겼어요! 모두 ${era.name} 시대 출발점에서 다시 시작해요${era.final ? '' : ` (${era.turns}턴)`}`, { tone: 'info' });
  if (era.final) Object.assign(turn, { eraRound: null, eraTurns: null });
  decorateEvents(tx.events, { room: next, data, seed: next.rngState ?? 0 });
  return { room: next, events: tx.events, logs: tx.logs, migrated: true };
}

// ---------- bets (훈수 베팅) ----------

/** Payout multiplier of a bet pick (stake included); `balance.bets.payouts[pick]`. */
export function betPayout(bet, balance) {
  return balance.bets.payouts?.[bet.pick] ?? 0;
}

/** Winnings (stake excluded) of a won bet, rounded down so no pick has a positive expected value. */
export function betWinDelta(bet, balance) {
  return Math.floor(bet.amount * (betPayout(bet, balance) - 1));
}

export function betWins(bet, value, balance) {
  if (bet.kind === 'oddEven') return (value % 2 === 1 ? 'odd' : 'even') === bet.pick;
  const [lo, hi] = balance.bets.ranges[bet.pick] ?? [];
  return value >= lo && value <= hi;
}

function placeBet(tx, action) {
  const room = tx.room;
  const turn = room.turn;
  if (isSkillRoom(room)) fail(409, '실력 모드에서는 훈수 베팅이 없어요.');
  if (turn.phase !== 'awaitSpin' || turn.pending) fail(409, '지금은 베팅할 수 없어요.');
  const bettor = assertOwner(room, action.actor, action.characterId);
  const current = charById(room, currentCharId(room));
  if (bettor.id === current.id) fail(409, '자기 룰렛에는 베팅할 수 없어요.');
  if (bettor.finished) fail(409, '골인한 캐릭터는 훈수 베팅을 할 수 없어요.');
  if (bettor.ownerSessionId === 'cpu') fail(409, 'CPU는 베팅하지 않아요.');
  if (bettor.ownerSessionId === current.ownerSessionId) fail(403, '내 캐릭터의 턴에는 훈수 베팅을 할 수 없어요.');
  const cfg = tx.data.balance.bets;
  const { kind, pick } = action;
  if (!BET_KINDS.includes(kind)) fail(400, '베팅 종류가 올바르지 않습니다.');
  const picks = kind === 'oddEven' ? ['odd', 'even'] : Object.keys(cfg.ranges);
  if (!picks.includes(pick)) fail(400, '베팅 선택이 올바르지 않습니다.');
  const amount = action.amount;
  if (!Number.isInteger(amount) || amount < cfg.minAmount || amount > cfg.maxAmount) {
    fail(400, `베팅 금액은 ${won(cfg.minAmount)}~${won(cfg.maxAmount)}이에요.`);
  }
  room.bets ??= {};
  const slot = (room.bets[turn.turnNo] ??= {});
  const prev = Object.hasOwn(slot, bettor.id) ? slot[bettor.id] : null;
  // The stake is held at bet time (a replaced bet's held stake counts as available), so a lost bet can never
  // turn into debt however the money moves before the roulette.
  const held = prev?.staked ? prev.amount : 0;
  if (amount > bettor.money + held) fail(409, '돈이 부족해요.');
  slot[bettor.id] = { kind, pick, amount, target: current.id, resolved: false, staked: true };
  const net = amount - held;
  if (net) moveStake(tx, bettor, -net, net > 0 ? 'betStake' : 'betRefund');
  emit(tx, 'betPlaced', { charId: bettor.id, turnNo: turn.turnNo, target: current.id });
  if (!prev) addLog(tx, `🎲 ${josa(bettor.name, '이/가')} ${current.name}의 룰렛에 훈수 베팅!`, { charId: bettor.id });
}

/**
 * Move held bet money between a bettor's cash and the stake (never touches debt): −amount holds the stake
 * (`betStake`), +amount gives an unresolved stake back (`betRefund`, void / skipped / pruned / game end).
 */
function moveStake(tx, c, delta, reason) {
  c.money = Math.max(0, (c.money ?? 0) + delta);
  emit(tx, 'moneyChanged', { charId: c.id, delta, reason, money: c.money, debt: c.debt ?? 0, tone: 'neutral' });
}

/** Give back the held stakes of unresolved bets in `slot` (pre-fix saves never held one). @returns count */
function refundBets(tx, slot) {
  let n = 0;
  for (const [charId, bet] of Object.entries(slot ?? {})) {
    if (bet.resolved) continue;
    n++;
    bet.resolved = true;
    bet.refunded = true;
    const c = charById(tx.room, charId);
    if (c && bet.staked && bet.amount > 0) moveStake(tx, c, bet.amount, 'betRefund');
  }
  return n;
}

const PICK_LABEL = { odd: '홀', even: '짝' };

function resolveBets(tx, value) {
  const room = tx.room;
  const slot = room.bets?.[room.turn.turnNo];
  if (!slot) return;
  const results = [];
  for (const [charId, bet] of Object.entries(slot)) {
    if (bet.resolved) continue;
    const c = charById(room, charId);
    if (!c) continue;
    const won_ = betWins(bet, value, tx.data.balance);
    // `delta` = net result (win: winnings without the stake, loss: −stake), as before the stake was held
    const delta = won_ ? betWinDelta(bet, tx.data.balance) : -bet.amount;
    bet.resolved = true;
    bet.won = won_;
    bet.delta = delta;
    bet.value = value;
    // Held stake: a win pays stake + winnings, a loss pays nothing (the stake already left the cash).
    // Bets saved before the stake was held settle the old way (net delta).
    const paid = bet.staked ? (won_ ? bet.amount + delta : 0) : delta;
    if (paid) changeMoney(tx, c, paid, 'bet', { emotion: won_ ? 'joy' : 'sweat', tone: won_ ? 'good' : 'bad' });
    results.push({ charId, kind: bet.kind, pick: bet.pick, amount: bet.amount, won: won_, delta, stake: bet.amount, paid: bet.staked ? paid : Math.max(0, paid) });
    const pickText = PICK_LABEL[bet.pick] ?? bet.pick;
    addLog(tx, `${won_ ? '🤑' : '😅'} ${c.name} 훈수 베팅(${pickText}) ${won_ ? `적중! +${won(delta)}` : `꽝… ${won(delta)}`}`, {
      tone: won_ ? 'good' : 'bad',
      charId,
    });
  }
  if (results.length) emit(tx, 'betResolved', { turnNo: room.turn.turnNo, value, results });
}

// ---------- actions ----------

function doSpin(tx, action) {
  const room = tx.room;
  const turn = room.turn;
  const cur = currentCharId(room);
  const c = assertOwner(room, action.actor, action.characterId);
  if (c.id !== cur) fail(409, `지금은 ${charById(room, cur)?.name ?? '다른 캐릭터'}의 차례예요.`);
  if (turn.phase !== 'awaitSpin' || turn.pending) fail(409, '지금은 룰렛을 돌릴 수 없어요.');
  const actor = action.actor;
  if (action.auto && actor?.system && (turn.spinDeadlineAt == null || tx.now < turn.spinDeadlineAt)) fail(409, '아직 시간이 남았어요.');
  const { min, max } = tx.data.balance.spin;
  // 룰렛 실력 모드: the player's target (shake / gauge / CPU) → t 50 %, t±1 40 %, t±2 10 % (balance.roulette.skill).
  // The turn-timer auto spin and the admin's forceSpin stay random; a missing / invalid target = a random spin.
  const skillCfg = tx.data.balance.roulette?.skill ?? {};
  // Any number 1–10 every turn (the old per-character number deck was removed by user decision; a leftover
  // `character.aimUsed` in an old save is ignored).
  const aimed = isSkillRoom(room) && !(action.auto && actor?.system) && !actor?.admin ? parseTarget(action.target, { min, max }) : null;
  const first = aimed != null ? skillValue(tx.rng, aimed, { jitter: skillCfg.jitter, min, max }) : tx.rng.int(min, max);
  const input = aimed != null && ROULETTE_INPUTS.includes(action.input) ? action.input : null;
  // Stage 7: pending spin modifiers (택시 / 층간소음 second roll, 에너지 +2, 새치기 −3, 경차 1 → 2)
  const mod = applySpinMods(tx, c, first);
  const value = mod.value;
  const serving = c.military?.status === 'serving';
  const steps = spinSteps(tx, c, mod.move); // 군 복무: half the move (rounded up)
  const aim = aimed != null ? { target: aimed, ...(input ? { input } : {}), skill: true } : {};
  turn.lastSpin = { charId: c.id, value, turnNo: turn.turnNo, ...(steps !== value ? { steps } : {}), ...(mod.rolls ? { rolls: mod.rolls } : {}), ...aim };
  turn.phase = 'resolveSpace';
  turn.spinDeadlineAt = null;
  if (action.auto && actor?.system) addLog(tx, `⏰ 시간 초과! ${c.name}의 룰렛을 자동으로 돌렸어요.`, { tone: 'info', charId: c.id });
  else if (actor?.admin) addLog(tx, `🛠️ 관리자가 ${c.name}의 룰렛을 대신 돌렸어요.`, { tone: 'info', charId: c.id });
  emit(tx, 'spun', {
    charId: c.id,
    value,
    ...(steps !== value ? { steps } : {}),
    ...(serving && steps !== mod.move ? { halved: true } : {}),
    ...(mod.rolls ? { rolls: mod.rolls } : {}),
    ...(mod.mods.length ? { mods: mod.mods } : {}),
    ...(mod.car ? { car: true } : {}),
    ...(action.auto && actor?.system ? { auto: true } : {}),
    ...aim, // skill mode: {target, input?, skill: true} — public (everyone sees what was aimed)
  });
  const notes = [];
  if (mod.rolls) notes.push(`두 번 돌려 ${mod.rolls.join('·')} 중 ${value}`);
  if (mod.move !== value && !mod.car) notes.push(`카드 효과로 ${mod.move}칸`);
  if (mod.car) notes.push('경차 덕분에 2칸');
  if (serving && steps !== mod.move) notes.push(`복무 중이라 ${steps}칸만 이동`);
  // skill mode: 「🎯 목표 7 → 결과 8」 (the first roll; a taxi / noise second roll stays random and shows in the notes)
  const shown = aimed != null ? `🎯 목표 ${aimed} → 결과 ${first}${first === aimed ? ' 명중!' : ''}` : String(value);
  addLog(tx, `🎡 ${c.name}의 룰렛: ${shown}${notes.length ? ` (${notes.join(', ')})` : ''}`, { charId: c.id });
  resolveBets(tx, value);
  if (serving) militaryPay(tx, c);

  turn.spun = true;
  walk(tx, c, steps); // loop map: forced stops (payday / fork), 찬스 광장 pauses, laps
  continueTurn(tx);
}

function doChoose(tx, action) {
  const room = tx.room;
  const p = room.turn.pending;
  if (!p || p.promptId !== action.promptId) fail(409, '이미 끝났거나 없는 선택이에요.');
  const c = assertOwner(room, action.actor, action.characterId);
  if (!p.forCharacterIds.includes(c.id)) fail(403, '이 캐릭터가 고를 차례가 아니에요.');
  if (Object.hasOwn(p.answers, c.id)) fail(409, '이미 선택했어요.');
  const opt = p.options.find((o) => o.id === action.optionId);
  if (!opt) fail(400, '없는 선택지예요.');
  if (opt.disabled) fail(409, '지금은 고를 수 없는 선택지예요.');
  p.answers[c.id] = action.optionId;
  // Simultaneous prompts stay secret until resolved (events are broadcast to everyone).
  const secret = !!p.simultaneous || p.forCharacterIds.length > 1;
  emit(tx, 'chose', { charId: c.id, promptId: p.promptId, ...(secret ? {} : { optionId: action.optionId }) });
  continueTurn(tx);
}

function doTimeout(tx, action) {
  const p = tx.room.turn.pending;
  if (!p) fail(409, '대기 중인 선택이 없어요.');
  if (action.promptId && action.promptId !== p.promptId) fail(409, '이미 끝난 선택이에요.');
  const forced = action.force && (action.actor?.admin || action.actor?.system || !action.actor);
  if (!forced && (p.deadlineAt == null || tx.now < p.deadlineAt)) fail(409, '아직 시간이 남았어요.');
  const missing = p.forCharacterIds.filter((id) => !Object.hasOwn(p.answers, id));
  for (const id of missing) {
    p.answers[id] = p.defaultOptionId;
    emit(tx, 'chose', { charId: id, promptId: p.promptId, optionId: p.defaultOptionId, timedOut: true }); // default = public
  }
  if (missing.length) addLog(tx, `⏰ 시간 초과! ${missing.length}명은 기본 선택으로 처리했어요.`, { tone: 'info' });
  continueTurn(tx);
}

/** Host tool: the current character's turn ends without moving (admin/system only, awaitSpin only). */
function doSkip(tx, action) {
  const room = tx.room;
  const turn = room.turn;
  if (action.actor && !action.actor.admin && !action.actor.system) fail(403, '관리자만 턴을 넘길 수 있어요.');
  if (turn.phase !== 'awaitSpin' || turn.pending) fail(409, '룰렛을 기다리는 중에만 턴을 넘길 수 있어요.');
  const c = charById(room, currentCharId(room));
  // Side bets on this turn are void (stakes are only settled when the roulette resolves them).
  const voided = refundBets(tx, room.bets?.[turn.turnNo]);
  if (room.bets) delete room.bets[turn.turnNo];
  turn.spinDeadlineAt = null;
  addLog(tx, `⏭️ 관리자가 ${c?.name ?? '현재 캐릭터'}의 턴을 넘겼어요.${voided ? ' (훈수 베팅은 무효)' : ''}`, { tone: 'info', charId: c?.id ?? null });
  endTurn(tx);
  continueTurn(tx);
}

/** Stage 7: the runner's trade-expiry timer (expiry itself runs before every action). */
function doExpireTrades(tx, action) {
  if (action.actor && !action.actor.admin && !action.actor.system) fail(403, '시스템만 할 수 있어요.');
}

const HANDLERS = Object.assign(Object.create(null), {
  spin: doSpin,
  choose: doChoose,
  bet: placeBet,
  timeout: doTimeout,
  skip: doSkip,
  // Stage 7 — the card one needs the turn; trades / gifts happen any time and never touch the turn state
  useCard: (tx, action) => useCard(tx, action, currentCharId(tx.room)),
  offerTrade,
  respondTrade,
  cancelTrade,
  gift,
  expireTrades: doExpireTrades,
});

/**
 * @param {object} room current room (not mutated)
 * @param {{type:string, characterId?, promptId?, optionId?, kind?, pick?, amount?, force?, auto?, actor?: {sessionId}|{admin:true}|{system:true}}} action
 *   `skip` = admin/system only; `spin` with `auto: true` + system actor = turn-timeout auto spin (needs the
 *   `turn.spinDeadlineAt` to have passed).
 *   Stage 7: `useCard {characterId, cardUid, targetId?}` (current character, awaitSpin, 1 per turn);
 *   `offerTrade {characterId, toId, give, want}` / `respondTrade {characterId, tradeId, accept}` /
 *   `cancelTrade {characterId, tradeId}` / `gift {characterId, toId, money?|cardUid?}` any time (never touch the
 *   turn state); `expireTrades` = system (runner timer). Offers past `expiresAt` expire before every action.
 *   `actor` omitted = trusted caller (tests/simulator): no ownership check.
 * @param {{rng?, now?, data?}} ctx
 * @returns {{room, events, logs}}
 * @throws {EngineError} with .status (400/403/404/409)
 */
export function applyAction(room, action, ctx = {}) {
  if (!action || typeof action !== 'object') fail(400, '잘못된 요청입니다.');
  if (typeof action.type !== 'string') fail(400, '알 수 없는 행동입니다.');
  if (RESULT_ACTIONS.includes(action.type)) return applyResultAction(room, action, ctx);
  // Own keys of a null-prototype table only ('toString' / '__proto__' are unknown actions, not Object methods)
  const handler = Object.hasOwn(HANDLERS, action.type) ? HANDLERS[action.type] : null;
  if (typeof handler !== 'function') fail(400, '알 수 없는 행동입니다.');
  if (room.status !== 'playing' || !room.board) fail(409, '게임이 진행 중이 아니에요.');
  const c = makeCtx(room, ctx);
  // saves from before the loop maps → the loop board at the most advanced era's start (normally done at boot)
  const mig = isLoopBoard(room.board) ? null : migrateLoopBoard(room, { now: c.now, data: c.data });
  const next = mig ? mig.room : structuredClone(room);
  next.eraIndex ??= 0;
  for (const ch of next.characters) {
    ch.laps ??= 0;
    ensureLife(ch, c.data); // games saved before Stage 6
    ensureCards(ch); // … and Stage 7
    ensureFamily(ch); // … and Stage 8
    ensureTreasures(ch); // … and Stage 9
    if (!ch.record) ensureRecord(ch);
  }
  ensureRoomTreasures(next);
  next.highlights ??= {};
  next.news ??= {};
  ensureRoomCards(next);
  ensureRoomFamily(next);
  next.houseOwners ??= {};
  syncHouseOwners(next);
  const tx = createTx(next, c);
  if (mig) {
    tx.events.push(...mig.events);
    tx.logs.push(...mig.logs);
  }
  expireTrades(tx); // pure: offers past `expiresAt` (ctx.now) are dropped before anything else
  handler(tx, action);
  next.rngState = c.rng.state;
  trackRecords(next, tx.events, tx.tracked ?? 0); // Stage 9: life record counters (titles)
  decorateEvents(tx.events, { room: next, data: c.data, seed: c.rng.state });
  recordHighlights(next, tx.events, { data: c.data }); // Stage 9: dramatic moments (after tone / scene)
  if (next.status === 'finished' && next.result) next.result.highlights = topHighlights(next.highlights, c.data.balance.result?.highlights?.show ?? 5);
  return { room: next, events: tx.events, logs: tx.logs };
}

/**
 * Stage 9: actions of a finished game — `vote {targetId}` (a player; actor {sessionId}, or `voterId` for trusted
 * callers) and `closeVote` (runner timer once `result.mvp.closesAt` passed, or the admin any time).
 */
function applyResultAction(room, action, ctx) {
  if (room.status !== 'finished' || !room.result?.mvp) fail(409, '결과 발표 중이 아니에요.');
  const c = makeCtx(room, ctx);
  const next = structuredClone(room);
  const tx = createTx(next, c);
  if (action.type === 'vote') castVote(tx, action);
  else closeVote(tx, action);
  decorateEvents(tx.events, { room: next, data: c.data, seed: hashVote(next) });
  return { room: next, events: tx.events, logs: tx.logs };
}

/** Line seed of result actions (the game RNG is finished; any stable number works). */
const hashVote = (room) => ((room.rngState ?? 0) ^ Object.keys(room.result?.mvp?.votes ?? {}).length * 0x9e3779b1) >>> 0;

// Re-exported for UIs/tests that need board lookups.
export { findTile };
