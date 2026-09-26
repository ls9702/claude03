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

/** Append a game log line to room.log (capped) and emit a `log` event. */
export function addLog(tx, text, { tone = 'info', charId = null, emotion = null } = {}) {
  const entry = { at: tx.now, type: 'game', text, tone };
  if (charId) entry.charId = charId;
  tx.room.log.push(entry);
  if (tx.room.log.length > LOG_LIMIT) tx.room.log.splice(0, tx.room.log.length - LOG_LIMIT);
  tx.logs.push(entry);
  emit(tx, 'log', { text, tone, charId, emotion });
  return entry;
}

export function charById(room, id) {
  return room.characters.find((c) => c.id === id) || null;
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

// ---------- Korean text helpers ----------
function hasBatchim(word) {
  const ch = String(word ?? '').trim().slice(-1);
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  if (/[0-9]/.test(ch)) return '013678'.includes(ch);
  return null;
}

/** josa('철수', '이/가') → '철수가'. Unknown final → '철수이(가)'. */
export function josa(word, pair) {
  const [a, b] = pair.split('/');
  const f = hasBatchim(word);
  if (f === null) return `${word}${a}(${b})`;
  return `${word}${f ? a : b}`;
}

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
