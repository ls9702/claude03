// Final settlement (pure). Stage 2: cash − debt. Later stages add house value,
// treasure appraisal, stat/experience bonuses and awards here.
import { gameData } from '../data/index.js';
import { netWorth } from './effects.js';
import { itemsValue } from './cards.js';
import { houseValue } from './houses.js';

/**
 * @returns {{rank, charId, name, money, debt, goalBonus, items, house, total, place}[]} best first.
 * total = money − debt + items (Stage 7: resale value of shop items, Σ price × resale) + house (Stage 8: the
 * house's value, after the 노년 시세).
 * Ties on total are broken by goal arrival order, then creation order.
 */
export function computeRanking(room, { data = gameData() } = {}) {
  const rows = room.characters.map((c) => {
    const items = itemsValue(data, c);
    const house = houseValue(c);
    return {
      charId: c.id,
      name: c.name,
      seq: c.seq ?? 0,
      money: c.money ?? 0,
      debt: c.debt ?? 0,
      goalBonus: c.goalBonus ?? 0,
      items,
      house,
      total: netWorth(c) + items + house,
      place: c.place ?? null,
    };
  });
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
export function applyResult(room, now, { forced = false, data } = {}) {
  const ranking = computeRanking(room, data ? { data } : {});
  room.status = 'finished';
  room.finishedAt = now;
  room.result = { ranking, finishedAt: now, forced };
  if (room.turn) {
    room.turn.phase = 'gameOver';
    room.turn.pending = null;
  }
  return ranking;
}
