// Engine transaction helpers (pure w.r.t. the cloned room held in `tx`).
// A tx is { room, rng, now, data, events: [], logs: [] } created per action.
import { LOG_LIMIT } from './lobby.js';

export class EngineError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const fail = (status, message) => {
  throw new EngineError(status, message);
};

export function createTx(room, { rng, now, data }) {
  return { room, rng, now, data, events: [], logs: [] };
}

export function emit(tx, type, payload = {}) {
  const ev = { type, ...payload };
  tx.events.push(ev);
  return ev;
}

/**
 * Append a game log line to room.log (capped) and emit a `log` event. `eventId` (event tiles) rides on the
 * log event so the presentation pass can find the events.json entry (scene / lineTag) of stat-only events.
 */
export function addLog(tx, text, { tone = 'info', charId = null, emotion = null, eventId = null } = {}) {
  const entry = { at: tx.now, type: 'game', text, tone };
  if (charId) entry.charId = charId;
  tx.room.log.push(entry);
  if (tx.room.log.length > LOG_LIMIT) tx.room.log.splice(0, tx.room.log.length - LOG_LIMIT);
  tx.logs.push(entry);
  emit(tx, 'log', { text, tone, charId, emotion, ...(eventId ? { eventId } : {}) });
  return entry;
}

export function charById(room, id) {
  return room.characters.find((c) => c.id === id) || null;
}

/** The character `charId`, owned by `actor` (admin/system/omitted actors may act for anyone). */
export function assertOwner(room, actor, charId) {
  const c = charById(room, charId);
  if (!c) fail(404, '캐릭터를 찾을 수 없습니다.');
  if (actor && !actor.admin && !actor.system && c.ownerSessionId !== actor.sessionId) {
    fail(403, '내 캐릭터가 아닙니다.');
  }
  return c;
}

/** Host tool (room config `turnTimeoutSec`): ms per spin / single-character decision, 0 = off. */
export function turnTimeoutMs(room) {
  const sec = room?.config?.turnTimeoutSec;
  return Number.isInteger(sec) && sec > 0 ? sec * 1000 : 0;
}

/** Net worth used for ranking in Stage 2 (later stages add assets). */
export const netWorth = (c) => (c.money ?? 0) - (c.debt ?? 0);

/**
 * Change a character's money. Gains repay debt first; a loss beyond the cash
 * on hand becomes debt. Emits `moneyChanged` (delta = change of money − debt).
 */
export function changeMoney(tx, c, delta, reason, extra = {}) {
  if (!delta) return 0;
  const debtBefore = c.debt ?? 0;
  if (delta > 0) {
    const repay = Math.min(debtBefore, delta);
    c.debt = debtBefore - repay;
    c.money += delta - repay;
  } else {
    c.money += delta;
    if (c.money < 0) {
      c.debt = debtBefore - c.money;
      c.money = 0;
    }
  }
  emit(tx, 'moneyChanged', { charId: c.id, delta, reason, money: c.money, debt: c.debt, ...extra });
  return c.debt - debtBefore;
}

/** Take a loan (학자금 등): debt grows, cash stays. Emits `moneyChanged` (delta = −amount). */
export function addDebt(tx, c, amount, reason, extra = {}) {
  if (!(amount > 0)) return 0;
  c.debt = (c.debt ?? 0) + amount;
  emit(tx, 'moneyChanged', { charId: c.id, delta: -amount, reason, money: c.money, debt: c.debt, ...extra });
  return amount;
}

// ---------- stats (Stage 6) ----------

/** The four stats: 지력 / 체력 / 매력 / 운. */
export const STAT_KEYS = ['int', 'str', 'charm', 'luck'];
const STAT_NAMES = { int: '지력', str: '체력', charm: '매력', luck: '운' };

export const statCap = (data) => data?.balance?.stats?.cap ?? 10;
export const statName = (data, stat) => data?.balance?.stats?.names?.[stat] ?? STAT_NAMES[stat] ?? stat;

/**
 * Change one stat, clamped to 0..cap. Emits `statChanged {charId, stat, delta, value, reason}` with the ACTUAL
 * change (nothing when clamped away). @returns the actual delta
 */
/** 찬스 광장 「그냥 지나가기」 buff held by a character (`character.chanceBuff.id`, until its next 찬스 광장). */
export const hasBuff = (c, id) => c?.chanceBuff?.id === id;

export function addStat(tx, c, stat, delta, reason, extra = {}) {
  if (!delta || !STAT_KEYS.includes(stat)) return 0;
  if (delta > 0 && hasBuff(c, 'statUp')) delta += 1; // 📈 성장 버프: +1 more on every stat gain
  c.stats ??= { int: 0, str: 0, charm: 0, luck: 0 };
  const before = c.stats[stat] ?? 0;
  const value = Math.max(0, Math.min(statCap(tx.data), before + delta));
  const d = value - before;
  if (!d) return 0;
  c.stats[stat] = value;
  emit(tx, 'statChanged', { charId: c.id, stat, delta: d, value, reason, tone: d > 0 ? 'good' : 'bad', emotion: d > 0 ? 'joy' : 'sweat', ...extra });
  return d;
}

/** Apply a `{int?, str?, charm?, luck?}` delta map; returns [{stat, delta}] actually applied. */
export function addStats(tx, c, deltas, reason, extra = {}) {
  const out = [];
  for (const k of STAT_KEYS) {
    const d = addStat(tx, c, k, deltas?.[k] ?? 0, reason, extra);
    if (d) out.push({ stat: k, delta: d });
  }
  return out;
}

/** "지력 +2, 운 −1" */
export function statText(data, changes) {
  return changes.map(({ stat, delta }) => `${statName(data, stat)} ${delta > 0 ? '+' : '−'}${Math.abs(delta)}`).join(', ');
}

/** Round money to 5만원 steps (≥ 5 for positive amounts). */
export function round5(v) {
  if (!v) return 0;
  const r = Math.round(Math.abs(v) / 5) * 5;
  return Math.sign(v) * Math.max(5, r);
}

// ---------- Korean text helpers ----------
export { josa, particle, hasBatchim } from './korean.js';

/** Money in 만원 units → '1억 2,000만원' / '350만원'. */
export function won(n) {
  const sign = n < 0 ? '-' : '';
  const v = Math.abs(Math.round(n));
  if (v >= 10000) {
    const eok = Math.floor(v / 10000);
    const man = v % 10000;
    return `${sign}${eok}억${man ? ` ${man.toLocaleString('ko-KR')}만` : ''}원`;
  }
  return `${sign}${v.toLocaleString('ko-KR')}만원`;
}
