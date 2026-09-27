// Stage 7 — cards, shop items, trades and gifts (cards.json / items.json) + the original-style blue / red cards.
// Pure helpers over a tx.
//
// character.cards = [{uid, id}] (uid = room-unique `k<seq>`, hand limit cards.json `handLimit`)
// character.items = [itemId] (one of each) · character.spinMods = [{kind: plus|minus|max2|min2|range|exact|rush, value?,
//   min?, max?, by?, card}] (applied and cleared at the character's next spin) · character.lastTargetedBy = {attackerId: round}
// room.nextCardSeq · room.trades = [{id, fromId, toId, give, want, createdAt, expiresAt}] · room.nextTradeSeq
// Hands, items and trades are public (cards are open information, like the original board game).
//
// Colours: blue = 보유 효과 (kind held / merit / status: works while in the hand, never played), red = 사용 효과 (kind
// instant / sabotage played before the spin, passive = auto one-shot). Held cards leave the hand only by their
// `hold.until` condition ('married'), the injury status card when the injury heals; a full hand discards the oldest red
// card first, then the oldest blue non-requirement card, then the oldest requirement card — never the status card.
import { HALT_TYPES, nextPosition, tileAt } from './board.js';
import { addLog, addStats, assertOwner, changeMoney, charById, emit, fail, hasBuff, josa, particle, round5, won } from './effects.js';
import { openPrompt, registerPrompts } from './prompts.js';

export const CARD_COLORS = ['blue', 'red'];
export const CARD_KINDS = ['instant', 'passive', 'sabotage', 'held', 'merit', 'status'];
/** Kinds a player plays by hand (before the spin). */
export const PLAYABLE_KINDS = ['instant', 'sabotage'];
export const CARD_IDS = [
  'study', 'insider', 'energy', 'taxi', 'pledge', 'bonus', 'insurance', 'amulet', 'lotto', 'coupon', 'lawyer', 'cut_line', 'noise', 'tax_audit', 'complaint', 'gossip',
  // blue / red cards
  'marriage_luck', 'popular', 'research', 'charisma', 'tongue', 'iron_body', 'health_charm', 'salary_charm', 'merit',
  'big_roll', 'small_roll', 'exact_roll', 'payday_rush', 'injury',
];
/** Job requirement cards (jobs.json `requires.cards`, hidden jobs `unlock.cards`). */
export const REQUIREMENT_CARDS = ['research', 'charisma', 'tongue', 'iron_body'];
/** Red roulette cards (they fix / bound this spin; side bets on the turn are void). */
export const ROLL_CARDS = ['big_roll', 'small_roll', 'exact_roll', 'payday_rush'];
export const MERIT_ID = 'merit';
export const INJURY_ID = 'injury';
export const CARD_LOST_REASONS = ['married', 'healed', 'discarded', 'merit'];
export const ITEM_IDS = ['car', 'laptop', 'gym_pass', 'designer_bag', 'lucky_cat', 'massage_chair'];
export const TRADE_STATUSES = ['accepted', 'rejected', 'expired', 'cancelled'];

export const cardDefs = (data) => data.cards?.cards ?? [];
export const cardDef = (data, id) => cardDefs(data).find((k) => k.id === id) ?? null;
export const itemDefs = (data) => data.items?.items ?? [];
export const itemDef = (data, id) => itemDefs(data).find((i) => i.id === id) ?? null;
export const handLimit = (data) => data.cards?.handLimit ?? 6;
const eraScale = (data, era) => data.cards?.eraScale?.[era] ?? 1;

export const hasCard = (c, id) => !!c?.cards?.some((k) => k.id === id);
export const cardCount = (c, id) => c?.cards?.filter((k) => k.id === id).length ?? 0;
export const hasItem = (c, id) => !!c?.items?.includes(id);
/** Card colour (`color`, else by kind: held / merit / status → blue). */
export const cardColor = (def) => def?.color ?? (['held', 'merit', 'status'].includes(def?.kind) ? 'blue' : 'red');
export const isRequirementCard = (def) => !!def?.effect?.requirement;
/** Can this card leave the hand by trade / gift (everything but the injury status card)? */
export const transferable = (def) => def?.kind !== 'status';
/** Merit cards in a hand. */
export const meritCount = (c) => cardCount(c, MERIT_ID);

/** Fill Stage 7 character fields (games started / saved before Stage 7). */
export function ensureCards(c) {
  c.cards ??= [];
  c.items ??= [];
  c.spinMods ??= [];
  c.lastTargetedBy ??= {};
  return c;
}

/** Fill Stage 7 room fields; eras already reached count as opened (no retroactive holidays / lotto). */
export function ensureRoomCards(room) {
  room.nextCardSeq ??= 0;
  room.nextTradeSeq ??= 0;
  room.trades ??= [];
  room.holidayCount ??= 0;
  room.holidays ??= {};
  room.lotto ??= { draws: [] };
  room.eraQueue ??= [];
  if (!room.erasOpened) {
    const reached = Math.max(0, ...room.characters.map((c) => c.position?.eraIndex ?? 0));
    room.erasOpened = (room.board?.eras ?? []).slice(0, reached + 1).map((e) => e.id);
  }
  return room;
}

// ---------- hand ----------

/**
 * Discard priority of a full hand: the oldest red card, then the oldest blue card that is not a job requirement
 * (held / merit), then the oldest requirement card. The injury status card is never discarded. @returns index | -1
 */
export function discardIndex(data, cards) {
  const rank = (k) => {
    const def = cardDef(data, k.id);
    if (!def || def.kind === 'status') return 9;
    if (cardColor(def) === 'red') return 0;
    return isRequirementCard(def) ? 2 : 1;
  };
  let best = -1;
  for (let i = 0; i < cards.length; i++) if (rank(cards[i]) < 9 && (best < 0 || rank(cards[i]) < rank(cards[best]))) best = i;
  return best;
}

/** `cardLost {charId, cardId, uid, reason: married|healed|discarded|merit}` */
function emitLost(tx, c, card, reason) {
  emit(tx, 'cardLost', { charId: c.id, cardId: card.id, uid: card.uid, reason, tone: reason === 'healed' || reason === 'merit' ? 'good' : 'neutral', emotion: reason === 'discarded' ? 'sweat' : 'joy' });
}

/** Put a card object into a hand (hand limit: see `discardIndex`). @returns the discarded card | null */
function putInHand(tx, c, card) {
  ensureCards(c);
  let discarded = null;
  if (c.cards.length >= handLimit(tx.data)) {
    const i = discardIndex(tx.data, c.cards);
    if (i >= 0) {
      [discarded] = c.cards.splice(i, 1);
      const d = cardDef(tx.data, discarded.id);
      addLog(tx, `🗑️ ${c.name}의 손패가 가득 차서 「${d?.icon ?? ''} ${d?.name ?? discarded.id}」 카드를 버렸다`, { charId: c.id });
      emitLost(tx, c, discarded, 'discarded');
    }
  }
  c.cards.push(card);
  return discarded;
}

/**
 * Give a new card (fresh uid). Emits `cardGained {charId, cardId, uid, source, discarded?}`.
 * @param {'tile'|'shop'|'event'|'trade'|'gift'|'club'|'graduation'|'job'|'status'|'start'} source
 */
export function gainCard(tx, c, cardId, source, { log = true } = {}) {
  const def = cardDef(tx.data, cardId);
  if (!def) return null;
  const room = tx.room;
  room.nextCardSeq = (room.nextCardSeq ?? 0) + 1;
  const card = { uid: `k${room.nextCardSeq}`, id: def.id };
  const discarded = putInHand(tx, c, card);
  const bad = def.kind === 'status';
  emit(tx, 'cardGained', { charId: c.id, cardId: def.id, uid: card.uid, source, color: cardColor(def), ...(discarded ? { discarded: discarded.id } : {}), tone: bad ? 'bad' : 'good', emotion: bad ? 'cry' : 'joy' });
  if (log) addLog(tx, `🃏 ${josa(c.name, '이/가')} 「${def.icon} ${def.name}」 카드를 얻었다!`, { tone: 'good', charId: c.id, emotion: 'joy' });
  return card;
}

/** Remove the first card `cardId` (or every one of them with `all`) with a `cardLost` event. @returns cards removed */
export function loseCard(tx, c, cardId, reason, { count = 1, all = false } = {}) {
  let n = 0;
  for (let i = 0; i < (c.cards?.length ?? 0) && (all || n < count); ) {
    if (c.cards[i].id !== cardId) {
      i++;
      continue;
    }
    const [card] = c.cards.splice(i, 1);
    emitLost(tx, c, card, reason);
    n++;
  }
  return n;
}

/** Held (blue) cards whose `hold.until` condition happened (`'married'`) leave the hand. */
export function dropHeldCards(tx, c, until) {
  const ids = [...new Set((c.cards ?? []).map((k) => k.id))].filter((id) => cardDef(tx.data, id)?.hold?.until === until);
  let n = 0;
  for (const id of ids) {
    const def = cardDef(tx.data, id);
    n += loseCard(tx, c, id, until, { all: true });
    addLog(tx, `${def.icon} ${c.name}: 「${def.name}」 카드는 이제 할 일을 다 했다!`, { tone: 'good', charId: c.id, emotion: 'joy' });
  }
  return n;
}

/**
 * The injury status card mirrors `job.injured` (the source of truth): added when an injury starts, removed when it
 * heals / the job changes. Idempotent.
 */
export function syncInjuryCard(tx, c) {
  ensureCards(c);
  const hurt = (c.job?.injured ?? 0) > 0;
  const has = hasCard(c, INJURY_ID);
  if (hurt && !has) gainCard(tx, c, INJURY_ID, 'status', { log: false });
  else if (!hurt && has) {
    loseCard(tx, c, INJURY_ID, 'healed', { all: true });
    addLog(tx, `💪 ${c.name}: 부상이 나아서 🤕 부상 카드가 사라졌다`, { tone: 'good', charId: c.id, emotion: 'joy' });
  }
}

/** 동아리 card chance (`club.card` + `chance`): on joining and on every training payday until held. */
export function clubCardRoll(tx, c, def, chance) {
  const id = def?.card;
  if (!id || !chance || hasCard(c, id) || !cardDef(tx.data, id)) return false;
  if (!(tx.rng.next() < chance)) return false;
  const card = cardDef(tx.data, id);
  gainCard(tx, c, id, 'club', { log: false });
  addLog(tx, `${def.icon} ${c.name}: ${def.name} 활동에서 재능을 인정받아 「${card.icon} ${card.name}」 카드를 얻었다!`, { tone: 'good', charId: c.id, emotion: 'joy' });
  return true;
}

// ---------- blue (held) effects ----------

/** 결혼운◎: +affectionBonus on every affection gain while held. */
export function affectionBonus(data, c) {
  return hasCard(c, 'marriage_luck') ? cardDef(data, 'marriage_luck')?.effect?.affectionBonus ?? 0 : 0;
}

/** 인기 폭발◎ effect (or null when not held): {starChance, match, dateGain}. */
export function popularEffect(data, c) {
  return hasCard(c, 'popular') ? cardDef(data, 'popular')?.effect ?? {} : null;
}

/** 월급 부적: payday salary × (1 + salaryBonus) while held. */
export function salaryCharmMult(data, c) {
  return hasCard(c, 'salary_charm') ? 1 + (cardDef(data, 'salary_charm')?.effect?.salaryBonus ?? 0) : 1;
}

/** 건강기원 부적: no injuries while held. */
export const injuryProof = (c) => hasCard(c, 'health_charm');

/** Cards a character may draw (weight > 0; job-only cards only for that job; never merit / status cards). */
export function drawableCards(data, c) {
  return cardDefs(data).filter((k) => (k.weight ?? 0) > 0 && k.kind !== 'status' && k.kind !== 'merit' && (!k.jobOnly || c?.job?.id === k.jobOnly));
}

/** Seeded weighted card draw. */
export function drawCardId(tx, c) {
  const pool = drawableCards(tx.data, c);
  return pool.length ? tx.rng.weighted(pool).id : null;
}

/** Remove the first card `cardId` from a hand; emits `cardUsed {auto: true}` (passive trigger). */
export function consumeCard(tx, c, cardId, extra = {}) {
  const i = c.cards?.findIndex((k) => k.id === cardId) ?? -1;
  if (i < 0) return false;
  const [card] = c.cards.splice(i, 1);
  const def = cardDef(tx.data, cardId);
  emit(tx, 'cardUsed', { charId: c.id, cardId, uid: card.uid, cardKind: def?.kind ?? 'passive', auto: true, tone: 'good', emotion: 'joy', ...extra });
  return true;
}

// ---------- passive cards (auto) ----------

/**
 * A money loss (loss tile, bad event, tax audit, fine): 실손 보험 halves it once. Never more than the loss.
 * @returns {{amount, debt}} amount actually lost (positive) and the debt it created
 */
export function applyLoss(tx, c, amount, reason, extra = {}) {
  let a = Math.max(0, Math.round(amount));
  if (!a) return { amount: 0, debt: 0 };
  if (hasBuff(c, 'lossShield')) a = round5(a * 0.5); // 🛡️ 액땜 (찬스 광장 buff): losses halved
  if (hasCard(c, 'insurance')) {
    const mult = cardDef(tx.data, 'insurance')?.effect?.lossMult ?? 0.5;
    const before = a;
    a = Math.min(before, round5(before * mult));
    consumeCard(tx, c, 'insurance');
    addLog(tx, `☂️ ${c.name}: 실손 보험 발동! 손실 ${won(before)} → ${won(a)}`, { tone: 'good', charId: c.id, emotion: 'joy' });
  }
  const debt = changeMoney(tx, c, -a, reason, extra);
  return { amount: a, debt };
}

/** 건강 부적: cancels an injury / bad event once. @returns true when it did */
export function tryAmulet(tx, c, what) {
  if (!hasCard(c, 'amulet')) return false;
  consumeCard(tx, c, 'amulet', { cancelled: what });
  addLog(tx, `🧧 ${c.name}: 건강 부적 덕분에 ${what === 'injury' ? '부상을 피했다' : '액땜했다'}!`, { tone: 'good', charId: c.id, emotion: 'joy' });
  return true;
}

/** 성과급 봉투: the next salary × salaryMult (consumed). */
export function salaryCardMult(tx, c) {
  if (!hasCard(c, 'bonus')) return 1;
  consumeCard(tx, c, 'bonus');
  return cardDef(tx.data, 'bonus')?.effect?.salaryMult ?? 2;
}

/** Salary multiplier from items (노트북: +10 % for creative / e-sports jobs). */
export function itemSalaryMult(data, c) {
  let m = 1;
  for (const id of c?.items ?? []) {
    const e = itemDef(data, id)?.effect;
    if (e?.salaryBonus && (!e.jobs || e.jobs.includes(c.job?.id))) m += e.salaryBonus;
  }
  return m;
}

/** 안마의자: no str loss from senior events. Returns the stat delta map to apply. */
export function guardStats(data, c, deltas) {
  if (!deltas || !(deltas.str < 0) || c.era !== 'senior') return deltas;
  if (!(c.items ?? []).some((id) => itemDef(data, id)?.effect?.noSeniorStrLoss)) return deltas;
  const { str, ...rest } = deltas;
  return rest;
}

/** Resale value of a character's items (price × resale, floored) — added to the final ranking. */
export function itemsValue(data, c) {
  return (c?.items ?? []).reduce((s, id) => {
    const d = itemDef(data, id);
    return s + (d ? Math.floor(d.price * (d.resale ?? 0)) : 0);
  }, 0);
}

// ---------- spin modifiers ----------

/**
 * The pending roulette-card mods of a character (red roulette cards played this turn): {exact, range, rush} (each
 * the mod object or null). Read BEFORE the first roll — they decide how it is drawn.
 */
export function rollPlan(c) {
  const mods = c?.spinMods ?? [];
  return {
    exact: mods.find((m) => m.kind === 'exact') ?? null,
    range: mods.find((m) => m.kind === 'range') ?? null,
    rush: mods.find((m) => m.kind === 'rush') ?? null,
  };
}

/** Is this turn's roulette fixed / bounded by a red roulette card (side bets are void / refused then)? */
export const spinFixed = (c) => (c?.spinMods ?? []).some((m) => m.kind === 'exact' || m.kind === 'range' || m.kind === 'rush');

/**
 * Apply (and clear) a character's pending spin modifiers to a roulette result.
 * exact (딱 그 칸) = the chosen number, no second roll; range (큰 수 / 작은 수) bounds a taxi / noise second roll too;
 * max2 (택시) / min2 (층간소음) roll a second time (both → cancel out); plus / minus change the move (≥ 1);
 * 경차 turns a move of 1 into 2; rush (월급날 직행) is handled by the engine's walk (`rush: true`).
 * @returns {{value, move, rolls: number[]|null, mods: object[], car: boolean, rush: boolean}}
 */
export function applySpinMods(tx, c, first) {
  ensureCards(c);
  const mods = c.spinMods;
  c.spinMods = [];
  const { min, max } = tx.data.balance.spin;
  const exact = mods.find((m) => m.kind === 'exact');
  const range = mods.find((m) => m.kind === 'range');
  const hasMax = mods.some((m) => m.kind === 'max2');
  const hasMin = mods.some((m) => m.kind === 'min2');
  let value = first;
  let rolls = null;
  if (!exact && (hasMax || hasMin)) {
    const second = tx.rng.int(range?.min ?? min, range?.max ?? max);
    rolls = [first, second];
    if (hasMax && !hasMin) value = Math.max(first, second);
    else if (hasMin && !hasMax) value = Math.min(first, second);
  }
  let move = value;
  for (const m of mods) {
    if (m.kind === 'plus') move += m.value ?? 0;
    else if (m.kind === 'minus') move -= m.value ?? 0;
  }
  move = Math.max(1, move);
  let car = false;
  if (move === 1) {
    const carMin = (c.items ?? []).map((id) => itemDef(tx.data, id)?.effect?.carMin ?? 0).reduce((a, b) => Math.max(a, b), 0);
    if (carMin > 1) {
      move = carMin;
      car = true;
    }
  }
  return { value, move, rolls, mods: mods.map((m) => ({ ...m })), car, rush: mods.some((m) => m.kind === 'rush') };
}

/**
 * 월급날 직행: tiles to the next payday ahead on the character's path (the loop wraps; the route it is on), or null
 * when another forced stop (the fork / the goal) comes first or there is no payday ahead (the end of the final track).
 */
export function rushDistance(room, c) {
  const board = room?.board;
  if (!board || !c?.position) return null;
  let pos = c.position;
  for (let n = 1; n <= 400; n++) {
    const np = nextPosition(board, pos, c.route);
    if (!np) return null;
    pos = np;
    const t = tileAt(board, pos);
    if (t?.type === 'salary') return n;
    if (HALT_TYPES.includes(t?.type)) return null;
  }
  return null;
}

/**
 * Why a card cannot be played now (null = playable) — the rules of `useCard` minus the turn / phase checks.
 * `value` = the 딱 그 칸 number (checked only when given). Used by the simulators / CPU too.
 */
export function cardBlockReason(room, c, def, data) {
  if (!def) return '알 수 없는 카드예요.';
  if (def.kind === 'status') return '부상 카드는 쓸 수 없어요. 부상이 나으면 사라져요.';
  if (def.kind === 'held' || def.kind === 'merit') return '보유 효과 카드라 손패에 가지고만 있으면 돼요.';
  if (def.kind === 'passive') return '조건이 되면 자동으로 발동하는 카드라 직접 쓸 수 없어요.';
  if (def.jobOnly && c.job?.id !== def.jobOnly) {
    const jn = data.jobs?.jobs?.find((j) => j.id === def.jobOnly)?.name ?? def.jobOnly;
    return `${jn} 전용 카드예요.`;
  }
  if (def.effect?.rush && rushDistance(room, c) == null) return '앞에 바로 갈 수 있는 월급날이 없어요.';
  return null;
}

// ---------- useCard (current character, before the spin) ----------

/** `useCard {characterId, cardUid, targetId?, value?}` — see CLAUDE.md "Stage 7" / "Blue / red cards". */
export function useCard(tx, action, currentId) {
  const room = tx.room;
  const turn = room.turn;
  const c = assertOwner(room, action.actor, action.characterId);
  ensureCards(c);
  if (c.id !== currentId) fail(409, '내 차례에만 카드를 쓸 수 있어요.');
  if (turn.phase !== 'awaitSpin' || turn.pending) fail(409, '룰렛을 돌리기 전에만 카드를 쓸 수 있어요.');
  if (turn.cardUsed) fail(409, '카드는 한 턴에 한 장만 쓸 수 있어요.');
  const idx = c.cards.findIndex((k) => k.uid === action.cardUid);
  if (idx < 0) fail(404, '손패에 없는 카드예요.');
  const def = cardDef(tx.data, c.cards[idx].id);
  if (!def) fail(400, '알 수 없는 카드예요.');
  const blocked = cardBlockReason(room, c, def, tx.data);
  if (blocked) fail(409, blocked);
  const { min, max } = tx.data.balance.spin;
  let exact = null;
  if (def.effect?.exact) {
    exact = typeof action.value === 'string' && /^\d+$/.test(action.value) ? Number(action.value) : action.value;
    if (!Number.isInteger(exact) || exact < min || exact > max) fail(400, `${min}~${max} 사이의 숫자를 골라 주세요.`);
  }
  let target = null;
  if (def.kind === 'sabotage') {
    if (typeof action.targetId !== 'string' || !action.targetId) fail(400, '뒤통수 카드는 대상을 골라야 해요.');
    target = charById(room, action.targetId);
    if (!target) fail(404, '대상 캐릭터를 찾을 수 없어요.');
    if (target.id === c.id) fail(400, '자기 자신에게는 쓸 수 없어요.');
    if (target.finished) fail(409, '이미 골인한 캐릭터는 노릴 수 없어요.');
    ensureCards(target);
    const last = target.lastTargetedBy[c.id];
    if (last != null && last >= turn.round - 1) fail(409, '같은 캐릭터를 연달아 노릴 수 없어요.');
  }
  const [card] = c.cards.splice(idx, 1);
  turn.cardUsed = true;
  if (target) {
    target.lastTargetedBy[c.id] = turn.round;
    if (hasCard(target, 'lawyer')) {
      const li = target.cards.findIndex((k) => k.id === 'lawyer');
      const [lawyer] = target.cards.splice(li, 1);
      emit(tx, 'cardBlocked', { charId: c.id, targetId: target.id, cardId: def.id, uid: card.uid, lawyerUid: lawyer.uid, tone: 'good', emotion: 'shock' });
      addLog(tx, `⚖️ ${target.name}의 변호사가 ${c.name}의 「${def.icon} ${def.name}」${particle(def.name, '을/를')} 막아냈다!`, { tone: 'good', charId: target.id, emotion: 'joy' });
      return;
    }
  }
  emit(tx, 'cardUsed', {
    charId: c.id,
    cardId: def.id,
    uid: card.uid,
    cardKind: def.kind,
    ...(target ? { targetId: target.id } : {}),
    ...(exact != null ? { value: exact } : {}),
    tone: def.kind === 'sabotage' ? 'bad' : 'good',
    emotion: def.kind === 'sabotage' ? 'angry' : 'joy',
  });
  const e = def.effect ?? {};
  const head = `${def.icon} ${josa(c.name, '이/가')} 「${def.name}」 카드를 썼다!`;
  switch (def.id) {
    case 'energy':
      c.spinMods.push({ kind: 'plus', value: e.steps ?? 2, card: def.id });
      addLog(tx, `${head} 이번 룰렛 +${e.steps ?? 2}칸`, { tone: 'good', charId: c.id, emotion: 'joy' });
      return;
    case 'taxi':
      c.spinMods.push({ kind: 'max2', card: def.id });
      addLog(tx, `${head} 룰렛을 두 번 돌려 큰 값으로 간다`, { tone: 'good', charId: c.id, emotion: 'joy' });
      return;
    case 'big_roll':
    case 'small_roll': {
      const [lo, hi] = e.range ?? [min, max];
      c.spinMods.push({ kind: 'range', min: lo, max: hi, card: def.id });
      addLog(tx, `${head} 이번 룰렛은 ${lo}~${hi}만 나온다`, { tone: 'good', charId: c.id, emotion: 'joy' });
      return;
    }
    case 'exact_roll':
      c.spinMods.push({ kind: 'exact', value: exact, card: def.id });
      addLog(tx, `${head} 이번 룰렛은 딱 ${exact}!`, { tone: 'good', charId: c.id, emotion: 'joy' });
      return;
    case 'payday_rush':
      c.spinMods.push({ kind: 'rush', card: def.id });
      addLog(tx, `${head} 다음 월급날까지 곧장 달려간다 (${rushDistance(room, c)}칸)`, { tone: 'good', charId: c.id, emotion: 'joy' });
      return;
    case 'pledge': {
      const amount = round5((e.donation ?? 30) * eraScale(tx.data, c.era));
      let total = 0;
      for (const id of room.turn.order) {
        const o = charById(room, id);
        if (!o || o.id === c.id || o.finished) continue;
        const pay = Math.min(amount, Math.max(0, o.money));
        if (pay <= 0) continue;
        changeMoney(tx, o, -pay, 'donation', { to: c.id, tone: 'bad', emotion: 'sweat' });
        changeMoney(tx, c, pay, 'donation', { from: o.id, tone: 'good', emotion: 'joy' });
        total += pay;
      }
      addLog(tx, `${head} 후원금 ${won(total)}${particle(won(total), '이/가')} 모였다`, { tone: 'good', charId: c.id, emotion: 'joy' });
      return;
    }
    case 'cut_line':
      target.spinMods.push({ kind: 'minus', value: e.minus ?? 3, by: c.id, card: def.id });
      addLog(tx, `${def.icon} 뒤통수! ${josa(c.name, '이/가')} ${target.name}에게 「${def.name}」! 다음 룰렛 −${e.minus ?? 3}칸`, { tone: 'bad', charId: c.id, emotion: 'angry' });
      return;
    case 'noise':
      target.spinMods.push({ kind: 'min2', by: c.id, card: def.id });
      addLog(tx, `${def.icon} 뒤통수! ${josa(c.name, '이/가')} ${target.name}에게 「${def.name}」! 다음 룰렛은 두 번 중 작은 값`, { tone: 'bad', charId: c.id, emotion: 'angry' });
      return;
    case 'tax_audit': {
      const want = Math.min(e.max ?? 300, round5(Math.max(0, target.money) * (e.rate ?? 0.1)));
      const amount = target.money >= 5 ? Math.min(want, target.money) : 0;
      addLog(tx, `${def.icon} 뒤통수! ${josa(c.name, '이/가')} ${target.name}에게 「${def.name}」!`, { tone: 'bad', charId: c.id, emotion: 'angry' });
      if (amount > 0) {
        const r = applyLoss(tx, target, amount, 'tax', { by: c.id, tone: 'bad', emotion: 'cry' });
        addLog(tx, `🔍 ${target.name}: 세금 ${won(r.amount)} 추징…`, { tone: 'bad', charId: target.id, emotion: 'cry' });
      } else addLog(tx, `🔍 ${target.name}: 털어도 먼지 한 톨 안 나왔다`, { tone: 'info', charId: target.id });
      return;
    }
    case 'complaint': {
      addLog(tx, `${def.icon} 뒤통수! ${josa(c.name, '이/가')} ${target.name}에게 「${def.name}」!`, { tone: 'bad', charId: c.id, emotion: 'angry' });
      if (target.job) {
        const before = target.job.exp ?? 0;
        target.job.exp = Math.max(0, before - (e.exp ?? 2));
        addLog(tx, `📢 ${target.name}: 민원 때문에 경험치 −${before - target.job.exp}`, { tone: 'bad', charId: target.id, emotion: 'angry' });
      } else {
        const fine = round5((e.fine ?? 30) * eraScale(tx.data, target.era));
        const r = applyLoss(tx, target, fine, 'fine', { by: c.id, tone: 'bad', emotion: 'cry' });
        addLog(tx, `📢 ${target.name}: 벌금 ${won(r.amount)}…`, { tone: 'bad', charId: target.id, emotion: 'cry' });
      }
      return;
    }
    default: {
      // stat cards (study / insider on me, gossip on the target)
      const who = target ?? c;
      const changes = addStats(tx, who, e.stats ?? {}, target ? 'sabotage' : 'card', { cardId: def.id });
      const txt = changes.map(({ stat, delta }) => `${tx.data.balance.stats?.names?.[stat] ?? stat} ${delta > 0 ? '+' : '−'}${Math.abs(delta)}`).join(', ');
      if (target) addLog(tx, `${def.icon} 뒤통수! ${josa(c.name, '이/가')} ${target.name}에게 「${def.name}」!${txt ? ` (${txt})` : ''}`, { tone: 'bad', charId: c.id, emotion: 'angry' });
      else addLog(tx, `${head}${txt ? ` ${txt}` : ' (이미 최고치)'}`, { tone: 'good', charId: c.id, emotion: 'joy' });
    }
  }
}

// ---------- card tile / shop ----------

/** Card tile: draw one card (weighted). */
export function resolveCardTile(tx, c) {
  const id = drawCardId(tx, c);
  if (!id) return null;
  const def = cardDef(tx.data, id);
  gainCard(tx, c, id, 'tile', { log: false });
  addLog(tx, `🃏 ${c.name}: 「${def.icon} ${def.name}」 카드를 주웠다! (${def.desc})`, { tone: 'good', charId: c.id, emotion: 'joy' });
  return null;
}

/** Shop offers: `balance.shop.cards` distinct cards + `items` items not owned (seeded, weighted). */
export function shopOffers(tx, c) {
  const cfg = tx.data.balance.shop ?? { cards: 2, items: 1 };
  const out = [];
  const cardPool = drawableCards(tx.data, c).map((d) => ({ id: d.id, weight: d.weight ?? 1 }));
  const take = (pool) => {
    const pick = tx.rng.weighted(pool);
    pool.splice(pool.indexOf(pick), 1);
    return pick.id;
  };
  for (let i = 0; i < cfg.cards && cardPool.length; i++) out.push({ kind: 'card', id: take(cardPool) });
  const itemPool = itemDefs(tx.data).filter((d) => !hasItem(c, d.id)).map((d) => ({ id: d.id, weight: d.weight ?? 1 }));
  for (let i = 0; i < cfg.items; i++) {
    if (itemPool.length) out.push({ kind: 'item', id: take(itemPool) });
    else if (cardPool.length) out.push({ kind: 'card', id: take(cardPool) });
  }
  return out;
}

/** Shop price after the coupon discount. */
export function shopPrice(tx, c, basePrice) {
  if (!hasCard(c, 'coupon')) return basePrice;
  const d = cardDef(tx.data, 'coupon')?.effect?.discount ?? 0.5;
  return round5(basePrice * (1 - d));
}

registerPrompts({
  /** Shop tile: 2 cards + 1 item on display; buy one (`buy:<n>`) or leave. Options over budget are `disabled`. */
  shop: {
    resultCutin: 'auto', // an item purchase anchors on itemBought; a card purchase / leaving gets promptResolved
    build(tx, c, { offers: listed = null } = {}) {
      const coupon = hasCard(c, 'coupon');
      // loop maps: the 찬스 광장 「구입」 hands over the listing it showed (else a fresh one is drawn)
      const offers = (Array.isArray(listed) && listed.length ? listed.map(({ kind, id }) => ({ kind, id })) : shopOffers(tx, c)).map((o) => {
        const def = o.kind === 'card' ? cardDef(tx.data, o.id) : itemDef(tx.data, o.id);
        return { ...o, basePrice: def.price, price: shopPrice(tx, c, def.price) };
      });
      const options = offers.map((o, n) => {
        const def = o.kind === 'card' ? cardDef(tx.data, o.id) : itemDef(tx.data, o.id);
        const short = o.price > c.money;
        return {
          id: `buy:${n}`,
          label: `${def.icon} ${def.name}`,
          icon: def.icon,
          desc: `${o.kind === 'card' ? '카드' : '아이템'} · ${def.desc} · ${won(o.price)}${o.price !== o.basePrice ? ` (쿠폰 할인, 원래 ${won(o.basePrice)})` : ''}${short ? ' · 돈이 부족해요' : ''}`,
          price: o.price,
          basePrice: o.basePrice,
          ...(o.kind === 'card' ? { cardId: o.id } : { itemId: o.id }),
          ...(short ? { disabled: true } : {}),
        };
      });
      options.push({ id: 'leave', label: '🚶 그냥 나가기', icon: '🚶', desc: '구경만 하고 나간다' });
      return {
        forCharacterIds: [c.id],
        title: '🛍️ 동네 마트',
        text: `${josa(c.name, '은/는')} 뭘 살까? (현금 ${won(c.money)}${coupon ? ' · 🎟️ 할인 쿠폰 적용' : ''})`,
        options,
        defaultOptionId: 'leave',
        context: { offers, coupon },
      };
    },
    resolve(tx, p) {
      const c = charById(tx.room, p.charId);
      const answer = p.answers[c.id];
      const n = /^buy:(\d+)$/.exec(answer ?? '')?.[1];
      const offer = n != null ? p.context?.offers?.[Number(n)] : null;
      if (!offer) {
        addLog(tx, `🚶 ${c.name}: 가게를 한 바퀴 구경만 하고 나왔다`, { charId: c.id });
        return { result: 'left' };
      }
      const def = offer.kind === 'card' ? cardDef(tx.data, offer.id) : itemDef(tx.data, offer.id);
      if (offer.kind === 'item' && hasItem(c, offer.id)) {
        addLog(tx, `🙅 ${c.name}: 「${def.name}」${particle(def.name, '은/는')} 이미 가지고 있다`, { charId: c.id });
        return { result: 'left' };
      }
      // the price is re-checked now: cash or the coupon may have changed hands (trades / gifts) since the display
      const price = shopPrice(tx, c, offer.basePrice);
      if (c.money < price) {
        addLog(tx, `😅 ${c.name}: 돈이 모자라서 「${def.name}」${particle(def.name, '을/를')} 못 샀다`, { tone: 'bad', charId: c.id, emotion: 'sweat' });
        return { result: 'noMoney' };
      }
      const couponUsed = price !== offer.basePrice;
      if (offer.kind === 'item') {
        c.items.push(offer.id);
        emit(tx, 'itemBought', { charId: c.id, itemId: offer.id, price, tone: 'treasure', emotion: 'joy' });
      }
      if (couponUsed) consumeCard(tx, c, 'coupon');
      changeMoney(tx, c, -price, 'shop', { tone: 'treasure', emotion: 'joy', ...(offer.kind === 'item' ? { itemId: offer.id } : { cardId: offer.id }) });
      if (offer.kind === 'card') gainCard(tx, c, offer.id, 'shop', { log: false });
      else addStats(tx, c, def.stats ?? {}, 'item', { itemId: offer.id });
      addLog(tx, `🛍️ ${josa(c.name, '이/가')} 「${def.icon} ${def.name}」${particle(def.name, '을/를')} ${won(price)}에 샀다!${couponUsed ? ' (쿠폰 50%)' : ''}`, { tone: 'good', charId: c.id, emotion: 'joy' });
      return offer.kind === 'card' ? { result: 'card', cardId: offer.id } : { result: 'item', itemId: offer.id };
    },
  },
});

/** Shop tile → shop prompt. */
export const resolveShopTile = (tx, c) => openPrompt(tx, 'shop', c);

// ---------- trades & gifts (any time while playing; never touch the turn state machine) ----------

const describe = (tx, side) => {
  if (side.money != null) return won(side.money);
  const d = cardDef(tx.data, side.cardId);
  return `「${d?.icon ?? ''} ${d?.name ?? side.cardId}」`;
};

/**
 * Validate one side of an offer / gift: exactly one of `money` (positive integer) or `cardUid` (in `owner`'s
 * hand). `checkCash` = the owner must hold that much cash now.
 * @returns {{money: number} | {cardUid: string, cardId: string}}
 */
function normalizeSide(tx, side, owner, { mine }) {
  if (!side || typeof side !== 'object' || Array.isArray(side)) fail(400, '거래 내용이 올바르지 않아요.');
  const hasMoney = side.money !== undefined && side.money !== null;
  const hasCardUid = side.cardUid !== undefined && side.cardUid !== null;
  if (hasMoney === hasCardUid) fail(400, '돈이나 카드 중 하나만 정해 주세요.');
  if (hasMoney) {
    const max = tx.data.balance.trades?.maxMoney ?? 100000;
    if (!Number.isInteger(side.money) || side.money <= 0 || side.money > max) fail(400, '금액은 1만원 이상의 정수(만원)여야 해요.');
    if (side.money > owner.money) fail(409, mine ? '돈이 부족해요.' : `${owner.name}의 돈이 부족해요.`);
    return { money: side.money };
  }
  const card = typeof side.cardUid === 'string' ? owner.cards?.find((k) => k.uid === side.cardUid) : null;
  if (!card) fail(409, mine ? '내 손패에 없는 카드예요.' : `${owner.name}의 손패에 없는 카드예요.`);
  if (!transferable(cardDef(tx.data, card.id))) fail(409, '부상 카드는 주고받을 수 없어요.');
  return { cardUid: card.uid, cardId: card.id };
}

/** Is a stored side still deliverable by `owner`? */
function sideValid(side, owner) {
  if (side.money != null) return owner.money >= side.money;
  return !!owner.cards?.some((k) => k.uid === side.cardUid);
}

/** Move one side from `giver` to `receiver`. */
function transfer(tx, giver, receiver, side, reason) {
  if (side.money != null) {
    changeMoney(tx, giver, -side.money, reason, { to: receiver.id, tone: 'love', emotion: 'love' });
    changeMoney(tx, receiver, side.money, reason, { from: giver.id, tone: 'love', emotion: 'joy' });
    return;
  }
  const i = giver.cards.findIndex((k) => k.uid === side.cardUid);
  const [card] = giver.cards.splice(i, 1);
  const discarded = putInHand(tx, receiver, card);
  emit(tx, 'cardGained', { charId: receiver.id, cardId: card.id, uid: card.uid, source: reason, from: giver.id, ...(discarded ? { discarded: discarded.id } : {}), tone: 'good', emotion: 'joy' });
}

/** Drop open trades matching `pred` with a `tradeResolved` event. */
export function dropTrades(tx, pred, status, reason = null) {
  const room = tx.room;
  const keep = [];
  for (const t of room.trades ?? []) {
    if (!pred(t)) {
      keep.push(t);
      continue;
    }
    emit(tx, 'tradeResolved', { tradeId: t.id, fromId: t.fromId, toId: t.toId, status, ...(reason ? { reason } : {}), tone: 'neutral' });
    const from = charById(room, t.fromId);
    const to = charById(room, t.toId);
    if (status === 'expired') addLog(tx, `⌛ ${from?.name ?? '?'} → ${to?.name ?? '?'} 거래 제안이 만료됐어요`, { charId: t.fromId });
  }
  room.trades = keep;
}

/** Expire offers whose `expiresAt` passed (runs before every action and as the runner's `expireTrades`). */
export function expireTrades(tx) {
  dropTrades(tx, (t) => tx.now >= t.expiresAt, 'expired');
}

/** `offerTrade {characterId (from), toId, give, want}` */
export function offerTrade(tx, action) {
  const room = tx.room;
  const from = assertOwner(room, action.actor, action.characterId);
  const to = charById(room, action.toId);
  if (!to) fail(404, '거래할 캐릭터를 찾을 수 없어요.');
  if (to.id === from.id) fail(400, '자기 자신과는 거래할 수 없어요.');
  if (to.ownerSessionId === from.ownerSessionId) fail(409, '내 캐릭터끼리는 거래할 수 없어요. 선물하기를 써 주세요.');
  if (from.finished || to.finished) fail(409, '골인한 캐릭터는 거래할 수 없어요.');
  ensureCards(from);
  ensureCards(to);
  if (room.trades.some((t) => t.fromId === from.id)) fail(409, '이미 답을 기다리는 거래 제안이 있어요.');
  const give = normalizeSide(tx, action.give, from, { mine: true });
  const want = normalizeSide(tx, action.want, to, { mine: false });
  if (give.money != null && want.money != null) fail(400, '돈과 돈은 바꿀 수 없어요.');
  room.nextTradeSeq = (room.nextTradeSeq ?? 0) + 1;
  const trade = { id: `t${room.nextTradeSeq}`, fromId: from.id, toId: to.id, give, want, createdAt: tx.now, expiresAt: tx.now + (tx.data.balance.trades?.ttlMs ?? 60000) };
  room.trades.push(trade);
  emit(tx, 'tradeOffered', { tradeId: trade.id, fromId: from.id, toId: to.id, give: { ...give }, want: { ...want }, expiresAt: trade.expiresAt, tone: 'neutral' });
  addLog(tx, `🤝 ${josa(from.name, '이/가')} ${to.name}에게 거래 제안: ${describe(tx, give)} ↔ ${describe(tx, want)}`, { charId: from.id });
  return trade;
}

/** `respondTrade {characterId (the target), tradeId, accept}` — re-validated at accept time, swapped atomically. */
export function respondTrade(tx, action) {
  const room = tx.room;
  const to = assertOwner(room, action.actor, action.characterId);
  const trade = room.trades.find((t) => t.id === action.tradeId);
  if (!trade) fail(409, '이미 끝났거나 없는 거래 제안이에요.');
  if (trade.toId !== to.id) fail(403, '이 거래의 상대 캐릭터가 아니에요.');
  if (typeof action.accept !== 'boolean') fail(400, '수락 여부(accept)를 정해 주세요.');
  const from = charById(room, trade.fromId);
  room.trades = room.trades.filter((t) => t.id !== trade.id);
  if (!action.accept) {
    emit(tx, 'tradeResolved', { tradeId: trade.id, fromId: trade.fromId, toId: to.id, status: 'rejected', tone: 'bad' });
    addLog(tx, `🙅 ${josa(to.name, '이/가')} ${from?.name ?? '?'}의 거래 제안을 거절했다`, { charId: to.id });
    return;
  }
  ensureCards(to);
  if (!from || from.finished || to.finished || !sideValid(trade.give, from) || !sideValid(trade.want, to)) {
    emit(tx, 'tradeResolved', { tradeId: trade.id, fromId: trade.fromId, toId: to.id, status: 'cancelled', reason: 'invalid', tone: 'bad' });
    addLog(tx, `💨 조건이 바뀌어서 ${from?.name ?? '?'} ↔ ${to.name} 거래가 무산됐다`, { charId: to.id });
    return;
  }
  emit(tx, 'tradeResolved', { tradeId: trade.id, fromId: from.id, toId: to.id, status: 'accepted', give: { ...trade.give }, want: { ...trade.want }, tone: 'good' });
  transfer(tx, from, to, trade.give, 'trade');
  transfer(tx, to, from, trade.want, 'trade');
  addLog(tx, `🤝 거래 성사! ${from.name} ${describe(tx, trade.give)} ↔ ${to.name} ${describe(tx, trade.want)}`, { tone: 'good', charId: from.id, emotion: 'joy' });
}

/** `cancelTrade {characterId (the offerer), tradeId}` */
export function cancelTrade(tx, action) {
  const room = tx.room;
  const from = assertOwner(room, action.actor, action.characterId);
  const trade = room.trades.find((t) => t.id === action.tradeId);
  if (!trade) fail(409, '이미 끝났거나 없는 거래 제안이에요.');
  if (trade.fromId !== from.id) fail(403, '내가 낸 거래 제안이 아니에요.');
  dropTrades(tx, (t) => t.id === trade.id, 'cancelled');
  addLog(tx, `↩️ ${josa(from.name, '이/가')} 거래 제안을 거뒀다`, { charId: from.id });
}

/** `gift {characterId, toId, money? | cardUid?}` — immediate; own characters allowed (family transfer). */
export function gift(tx, action) {
  const room = tx.room;
  const from = assertOwner(room, action.actor, action.characterId);
  const to = charById(room, action.toId);
  if (!to) fail(404, '선물할 캐릭터를 찾을 수 없어요.');
  if (to.id === from.id) fail(400, '자기 자신에게는 선물할 수 없어요.');
  if (from.finished) fail(409, '골인한 캐릭터는 선물을 보낼 수 없어요.');
  if (to.finished) fail(409, '이미 골인한 캐릭터에게는 선물할 수 없어요.');
  ensureCards(from);
  ensureCards(to);
  const side = normalizeSide(tx, { money: action.money, cardUid: action.cardUid }, from, { mine: true });
  emit(tx, 'gift', { fromId: from.id, toId: to.id, charId: from.id, ...(side.money != null ? { money: side.money } : { cardId: side.cardId, uid: side.cardUid }), family: from.ownerSessionId === to.ownerSessionId, tone: 'love', emotion: 'love' });
  transfer(tx, from, to, side, 'gift');
  const family = from.ownerSessionId === to.ownerSessionId ? ' (가족 송금)' : '';
  addLog(tx, `🎁 ${josa(from.name, '이/가')} ${to.name}에게 ${describe(tx, side)} 선물!${family}`, { tone: 'love', charId: from.id, emotion: 'love' });
}

