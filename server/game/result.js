// Final settlement (pure). Stage 2: cash − debt. Later stages add house value,
// treasure appraisal, stat/experience bonuses and awards here.
import { netWorth } from './effects.js';

/**
 * @returns {{rank, charId, name, money, debt, goalBonus, total, place}[]} best first.
 * Ties on total are broken by goal arrival order, then creation order.
 */
export function computeRanking(room) {
  const rows = room.characters.map((c) => ({
    charId: c.id,
    name: c.name,
    seq: c.seq ?? 0,
    money: c.money ?? 0,
    debt: c.debt ?? 0,
    goalBonus: c.goalBonus ?? 0,
    total: netWorth(c),
    place: c.place ?? null,
  }));
  rows.sort((a, b) => b.total - a.total || (a.place ?? 99) - (b.place ?? 99) || a.seq - b.seq);
  let prev = null;
  return rows.map((r, i) => {
    const rank = prev && prev.total === r.total ? prev.rank : i + 1;
    const { seq, ...rest } = r;
    prev = { total: r.total, rank };
    return { rank, ...rest };
  });
}

/** Mutates a cloned room: status finished + result. */
export function applyResult(room, now, { forced = false } = {}) {
  const ranking = computeRanking(room);
  room.status = 'finished';
  room.finishedAt = now;
  room.result = { ranking, finishedAt: now, forced };
  if (room.turn) {
    room.turn.phase = 'gameOver';
    room.turn.pending = null;
  }
  return ranking;
}
