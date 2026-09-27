// Game engine: pure reducer `applyAction(room, action, ctx) → { room, events, logs }`.
// Turn state machine: awaitSpin → resolveSpace → (awaitDecision)* → endTurn → next character.
// Never mutates its input; randomness only from ctx.rng (default: restored from room.rngState).
import { gameData } from '../data/index.js';
import { buildBoard, findTile, nextPosition, startPosition, tileAt, tileIdAt } from './board.js';
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
import { applyResult } from './result.js';
import { createRng } from './rng.js';
import { decorateEvents } from './presentation.js';
import { promptComplete, resolvePrompt, resolveTile } from './spaces.js';
import { ensureLife, initLife, lifeStep, spinSteps } from './growth.js';
import { militaryPay } from './jobs.js';
import { applyEraNews, drawNews, drawStartNews } from './news.js';

export { EngineError, turnTimeoutMs };
export const ACTION_TYPES = ['spin', 'choose', 'bet', 'timeout', 'skip'];
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
  const firstEra = next.board.eras[0].id;
  // Stage 6 life records (stats, education, military, job…). Starting stats are public like the board, so they
  // come from the board RNG before the secret is mixed in. A game without 수능 (adult mode) starts grown up.
  const adult = !next.board.eras.some((e) => (data.board.fixedStops?.[e.id] ?? []).some((st) => st.promptId === 'exam'));
  next.characters = next.characters.map((c) => ({
    ...c,
    money: next.config.startingMoney ?? 0,
    debt: 0,
    position: startPosition(),
    era: firstEra,
    route: null,
    routeHistory: [],
    finished: false,
    place: null,
    goalBonus: 0,
    pensionGiven: false,
    ...initLife(c, { rng: boardRng, data, adult }),
  }));
  // The board is public; without a secret, its tiles would reveal the seed and so every future spin.
  // The side-effect layer (GameRunner) passes `ctx.secret` = crypto random uint32; tests/simulator omit it
  // (or inject a fixed one) and stay deterministic. The game continues from `rngState` either way.
  const rng = ctx.secret != null ? createRng(mixSecret(boardRng.state, ctx.secret)) : boardRng;
  next.turn = { ...next.turn, turnNo: 1, round: 1, lastSpin: null, spinDeadlineAt: null };
  next.pension = null;
  next.bets = {};
  next.promptSeq = 0;
  next.result = null;
  next.news = {};
  const tx = createTx(next, { rng, now, data });
  emit(tx, 'gameStarted', { eras: next.board.eras.map((e) => e.id) });
  drawStartNews(tx);
  announceTurn(tx);
  next.rngState = rng.state;
  decorateEvents(tx.events, { room: next, data, seed: rng.state });
  return { ok: true, room: next, logs: [...r.logs, ...tx.logs], events: tx.events };
}

/** Admin force end (keeps a ranking if a game was in progress). */
export function endGame(room, ctx = {}) {
  const now = ctx.now ?? Date.now();
  const r = lobbyEndGame(room, now);
  if (!r.ok) return r;
  if (r.room.board && r.room.characters.every((c) => typeof c.money === 'number')) {
    applyResult(r.room, now, { forced: true });
  }
  return r;
}

// ---------- helpers ----------

const currentCharId = (room) => room.turn?.order?.[room.turn.currentIndex] ?? null;

function announceTurn(tx) {
  const c = charById(tx.room, currentCharId(tx.room));
  const limit = turnTimeoutMs(tx.room);
  tx.room.turn.spinDeadlineAt = limit ? tx.now + limit : null;
  emit(tx, 'turnStarted', { charId: c.id, turnNo: tx.room.turn.turnNo, round: tx.room.turn.round });
}

function enterEra(tx, c, eraIndex) {
  const board = tx.room.board;
  const era = board.eras[eraIndex];
  const from = c.era;
  c.era = era.id;
  c.route = null;
  emit(tx, 'eraChanged', { charId: c.id, era: era.id, from, eraName: era.name, tone: 'good', emotion: 'joy' });
  addLog(tx, `🌱 ${josa(c.name, '이/가')} ${era.name} 시대에 들어섰다!`, { tone: 'good', charId: c.id });
  drawNews(tx, era.id); // first character entering the era → 뉴스 속보
  applyEraNews(tx, c, era.id);
  if (era.id === tx.data.balance.pension.era) catchUpBonus(tx, c);
}

/**
 * 역전 보정 (기초연금): the recipients are decided ONCE, when the first character enters the pension era —
 * the bottom `bottomN` by net worth (games with ≥ `minCharacters`) — and stored in `room.pension =
 * {recipients, decidedAt, turnNo}`. Each recipient is paid on their own entry (the amount uses the gap to
 * the richest character at that moment), so later entries can never add more recipients.
 */
function catchUpBonus(tx, c) {
  const cfg = tx.data.balance.pension;
  const room = tx.room;
  const chars = room.characters;
  if (chars.length < cfg.minCharacters) return;
  if (!room.pension) {
    // Saves from before the fixed rule: pensions already paid count as recipients.
    const given = chars.filter((x) => x.pensionGiven).map((x) => x.id);
    const sorted = [...chars].filter((x) => !given.includes(x.id)).sort((a, b) => netWorth(a) - netWorth(b) || (a.seq ?? 0) - (b.seq ?? 0));
    const recipients = [...given, ...sorted.map((x) => x.id)].slice(0, Math.max(given.length, cfg.bottomN));
    room.pension = { recipients, decidedAt: tx.now, turnNo: room.turn?.turnNo ?? 0 };
  }
  // Pay the entering character and any recipient already in the era (e.g. restored older saves).
  const due = room.pension.recipients
    .map((id) => charById(room, id))
    .filter((x) => x && !x.pensionGiven && (x.id === c.id || x.era === cfg.era));
  for (const x of due) payPension(tx, x);
}

function payPension(tx, c) {
  const cfg = tx.data.balance.pension;
  const top = Math.max(...tx.room.characters.map(netWorth));
  const raw = cfg.base + Math.max(0, top - netWorth(c)) * cfg.gapRatio;
  const amount = Math.min(cfg.max, Math.round(raw / 10) * 10);
  c.pensionGiven = true;
  changeMoney(tx, c, amount, 'pension', { emotion: 'joy', tone: 'good' });
  addLog(tx, `👵 역전 보정! ${josa(c.name, '이/가')} 기초연금 ${won(amount)}을 받았다.`, { tone: 'good', charId: c.id, emotion: 'joy' });
}

function finishCharacter(tx, c) {
  const room = tx.room;
  const place = room.characters.filter((x) => x.finished).length + 1;
  c.finished = true;
  c.place = place;
  const prize = tx.data.balance.goalPrizes[place - 1] ?? 0;
  if (prize) changeMoney(tx, c, prize, 'goalPrize', { emotion: 'joy', tone: 'result' });
  c.goalBonus += prize;
  emit(tx, 'finished', { charId: c.id, place, prize, tone: 'result', emotion: 'joy' });
  addLog(tx, `🏁 ${c.name} ${place}등으로 골인!${prize ? ` 골인 상금 ${won(prize)}` : ''}`, { tone: 'result', charId: c.id, emotion: 'joy' });
}

function bonusSpin(tx, c) {
  const { min, max } = tx.data.balance.spin;
  const value = tx.rng.int(min, max);
  const amount = value * tx.data.balance.bonusSpinUnit;
  c.goalBonus += amount;
  emit(tx, 'bonusSpin', { charId: c.id, value, amount, tone: 'result' });
  changeMoney(tx, c, amount, 'bonusSpin', { emotion: 'joy', tone: 'result' });
  addLog(tx, `🎰 ${c.name} 골 후 보너스 룰렛 ${value}! +${won(amount)}`, { tone: 'result', charId: c.id });
}

function gameOver(tx) {
  const ranking = applyResult(tx.room, tx.now);
  emit(tx, 'gameOver', { ranking, tone: 'result' });
  addLog(tx, `🏆 게임 종료! 1등은 ${ranking[0]?.name} (${won(ranking[0]?.total ?? 0)})`, { tone: 'result' });
}

/**
 * Advance to the next unfinished character; finished ones auto-take a bonus spin, characters with
 * `skipTurns` (재수) sit this turn out.
 */
function endTurn(tx) {
  const room = tx.room;
  const turn = room.turn;
  turn.pending = null;
  turn.phase = 'endTurn';
  if (room.characters.every((c) => c.finished)) return gameOver(tx);
  const n = turn.order.length;
  for (let i = 0; i < n * 3; i++) {
    turn.currentIndex = (turn.currentIndex + 1) % n;
    if (turn.currentIndex === 0) turn.round += 1;
    const c = charById(room, turn.order[turn.currentIndex]);
    if (!c) continue;
    if (c.finished) {
      bonusSpin(tx, c);
      continue;
    }
    if (c.skipTurns > 0) {
      c.skipTurns -= 1;
      addLog(tx, `📖 ${josa(c.name, '은/는')} 재수 중… 이번 턴은 쉬어요`, { tone: 'info', charId: c.id, emotion: 'sweat' });
      continue;
    }
    turn.turnNo += 1;
    turn.phase = 'awaitSpin';
    pruneBets(tx);
    announceTurn(tx);
    return;
  }
  gameOver(tx);
}

function pruneBets(tx) {
  const keep = tx.data.balance.bets.keepTurns;
  const bets = tx.room.bets ?? {};
  for (const k of Object.keys(bets)) if (Number(k) <= tx.room.turn.turnNo - keep) delete bets[k];
}

/**
 * After a space resolves (or a prompt resolves): wait for a decision, run the current character's life
 * step (discharge / graduation → 진로 → 군 복무 → 취업 → 갈림길 → 숨은 직업), or end the turn.
 */
function continueTurn(tx) {
  for (let guard = 0; guard < 64; guard++) {
    if (tx.room.status !== 'playing') return;
    const pending = tx.room.turn.pending;
    if (pending) {
      if (!promptComplete(pending)) return;
      resolvePrompt(tx);
      continue;
    }
    const c = charById(tx.room, currentCharId(tx.room));
    if (c && lifeStep(tx, c)) continue;
    return endTurn(tx);
  }
  throw new Error('continueTurn: too many chained prompts');
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
  if (turn.phase !== 'awaitSpin' || turn.pending) fail(409, '지금은 베팅할 수 없어요.');
  const bettor = assertOwner(room, action.actor, action.characterId);
  const current = charById(room, currentCharId(room));
  if (bettor.id === current.id) fail(409, '자기 룰렛에는 베팅할 수 없어요.');
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
  if (amount > bettor.money) fail(409, '돈이 부족해요.');
  room.bets ??= {};
  const slot = (room.bets[turn.turnNo] ??= {});
  const replaced = Object.hasOwn(slot, bettor.id);
  slot[bettor.id] = { kind, pick, amount, target: current.id, resolved: false };
  emit(tx, 'betPlaced', { charId: bettor.id, turnNo: turn.turnNo, target: current.id });
  if (!replaced) addLog(tx, `🎲 ${josa(bettor.name, '이/가')} ${current.name}의 룰렛에 훈수 베팅!`, { charId: bettor.id });
}

const PICK_LABEL = { odd: '홀', even: '짝' };

function resolveBets(tx, value) {
  const room = tx.room;
  const slot = room.bets?.[room.turn.turnNo];
  if (!slot) return;
  const cfg = tx.data.balance.bets;
  const results = [];
  for (const [charId, bet] of Object.entries(slot)) {
    if (bet.resolved) continue;
    const c = charById(room, charId);
    if (!c) continue;
    const won_ = betWins(bet, value, tx.data.balance);
    const delta = won_ ? betWinDelta(bet, tx.data.balance) : -bet.amount;
    bet.resolved = true;
    bet.won = won_;
    bet.delta = delta;
    bet.value = value;
    changeMoney(tx, c, delta, 'bet', { emotion: won_ ? 'joy' : 'sweat', tone: won_ ? 'good' : 'bad' });
    results.push({ charId, kind: bet.kind, pick: bet.pick, amount: bet.amount, won: won_, delta });
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
  const value = tx.rng.int(min, max);
  const serving = c.military?.status === 'serving';
  const steps = spinSteps(tx, c, value); // 군 복무: half the move (rounded up)
  turn.lastSpin = { charId: c.id, value, turnNo: turn.turnNo, ...(steps !== value ? { steps } : {}) };
  turn.phase = 'resolveSpace';
  turn.spinDeadlineAt = null;
  if (action.auto && actor?.system) addLog(tx, `⏰ 시간 초과! ${c.name}의 룰렛을 자동으로 돌렸어요.`, { tone: 'info', charId: c.id });
  else if (actor?.admin) addLog(tx, `🛠️ 관리자가 ${c.name}의 룰렛을 대신 돌렸어요.`, { tone: 'info', charId: c.id });
  emit(tx, 'spun', { charId: c.id, value, ...(steps !== value ? { steps, halved: true } : {}), ...(action.auto && actor?.system ? { auto: true } : {}) });
  addLog(tx, `🎡 ${c.name}의 룰렛: ${value}${steps !== value ? ` (복무 중이라 ${steps}칸만 이동)` : ''}`, { charId: c.id });
  resolveBets(tx, value);
  if (serving) militaryPay(tx, c);

  // move tile by tile
  const board = room.board;
  let pos = c.position;
  const from = tileIdAt(board, pos);
  const path = [];
  const eraSteps = [];
  let halted = null;
  for (let s = 0; s < steps; s++) {
    const np = nextPosition(board, pos, c.route);
    if (!np) break;
    if (np.eraIndex !== pos.eraIndex) eraSteps.push(np.eraIndex);
    pos = np;
    const t = tileAt(board, pos);
    path.push(t.id);
    if (t.type === 'merge') completeRoute(c, board.eras[pos.eraIndex].id);
    if (t.type === 'stop' || t.type === 'goal') {
      halted = t.type;
      break;
    }
  }
  c.position = pos;
  emit(tx, 'moved', { charId: c.id, from, path, steps: path.length, halted });
  for (const eraIndex of eraSteps) enterEra(tx, c, eraIndex);
  const tile = tileAt(board, pos);
  if (tile) {
    emit(tx, 'landed', { charId: c.id, tileId: tile.id, tileType: tile.type, route: tile.route ?? null });
    resolveTile(tx, c, tile, { onGoal: (ch) => finishCharacter(tx, ch) });
  }
  continueTurn(tx);
}

function completeRoute(c, eraId) {
  const h = c.routeHistory.findLast((x) => x.era === eraId);
  if (h) h.completed = true;
}

function doChoose(tx, action) {
  const room = tx.room;
  const p = room.turn.pending;
  if (!p || p.promptId !== action.promptId) fail(409, '이미 끝났거나 없는 선택이에요.');
  const c = assertOwner(room, action.actor, action.characterId);
  if (!p.forCharacterIds.includes(c.id)) fail(403, '이 캐릭터가 고를 차례가 아니에요.');
  if (Object.hasOwn(p.answers, c.id)) fail(409, '이미 선택했어요.');
  if (!p.options.some((o) => o.id === action.optionId)) fail(400, '없는 선택지예요.');
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
  const voided = Object.keys(room.bets?.[turn.turnNo] ?? {}).length;
  if (room.bets) delete room.bets[turn.turnNo];
  turn.spinDeadlineAt = null;
  addLog(tx, `⏭️ 관리자가 ${c?.name ?? '현재 캐릭터'}의 턴을 넘겼어요.${voided ? ' (훈수 베팅은 무효)' : ''}`, { tone: 'info', charId: c?.id ?? null });
  endTurn(tx);
}

const HANDLERS = { spin: doSpin, choose: doChoose, bet: placeBet, timeout: doTimeout, skip: doSkip };

/**
 * @param {object} room current room (not mutated)
 * @param {{type:string, characterId?, promptId?, optionId?, kind?, pick?, amount?, force?, auto?, actor?: {sessionId}|{admin:true}|{system:true}}} action
 *   `skip` = admin/system only; `spin` with `auto: true` + system actor = turn-timeout auto spin (needs the
 *   `turn.spinDeadlineAt` to have passed).
 *   `actor` omitted = trusted caller (tests/simulator): no ownership check.
 * @param {{rng?, now?, data?}} ctx
 * @returns {{room, events, logs}}
 * @throws {EngineError} with .status (400/403/404/409)
 */
export function applyAction(room, action, ctx = {}) {
  if (!action || typeof action !== 'object') fail(400, '잘못된 요청입니다.');
  const handler = HANDLERS[action.type];
  if (!handler) fail(400, '알 수 없는 행동입니다.');
  if (room.status !== 'playing' || !room.board) fail(409, '게임이 진행 중이 아니에요.');
  const c = makeCtx(room, ctx);
  const next = structuredClone(room);
  for (const ch of next.characters) ensureLife(ch, c.data); // games saved before Stage 6
  next.news ??= {};
  const tx = createTx(next, c);
  handler(tx, action);
  next.rngState = c.rng.state;
  decorateEvents(tx.events, { room: next, data: c.data, seed: c.rng.state });
  return { room: next, events: tx.events, logs: tx.logs };
}

// Re-exported for UIs/tests that need board lookups.
export { findTile };
