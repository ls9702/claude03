// Final era (goal race): finishing — the goal, 조기 은퇴 (retire) and 올인 파산 (빈곤 농장). Shared by the engine (goal
// tile) and the 인생역전섬 submap prompt. Pure helpers over a tx.
import { addLog, changeMoney, emit, josa, won } from './effects.js';
import { dropTrades } from './cards.js';

/** Goal places already taken from the top (goal / 조기 은퇴) and from the bottom (올인 파산 = 빈곤 농장). */
export function nextPlace(room, { bottom = false } = {}) {
  const n = room.characters.length;
  if (bottom) return n - room.characters.filter((x) => x.finished && x.retired === 'bust').length;
  return room.characters.filter((x) => x.finished && x.retired !== 'bust').length + 1;
}

/**
 * Final era: a character reaches the goal (or retires). `retired`: 'early' = 조기 은퇴 (next place, prize × retirePrizeMult,
 * no bonus spins after), 'bust' = 올인 실패 → 빈곤 농장 (the last free place, no prize, no bonus spins).
 */
export function finishCharacter(tx, c, { retired = null } = {}) {
  if (c.finished) return;
  const room = tx.room;
  const place = nextPlace(room, { bottom: retired === 'bust' });
  c.finished = true;
  c.place = place;
  if (retired) c.retired = retired;
  const bal = tx.data.balance;
  const full = bal.goalPrizes?.[place - 1] ?? 0;
  const prize = retired === 'bust' ? 0 : retired === 'early' ? Math.round((full * (bal.retirePrizeMult ?? 0.5)) / 5) * 5 : full;
  if (prize) changeMoney(tx, c, prize, 'goalPrize', { emotion: 'joy', tone: 'result' });
  c.goalBonus = (c.goalBonus ?? 0) + prize;
  emit(tx, 'finished', { charId: c.id, place, prize, ...(retired ? { retired } : {}), tone: retired === 'bust' ? 'bad' : 'result', emotion: retired === 'bust' ? 'cry' : 'joy' });
  dropTrades(tx, (t) => t.fromId === c.id || t.toId === c.id, 'expired');
  const text =
    retired === 'bust'
      ? `🌾 ${josa(c.name, '은/는')} 전 재산을 잃고 빈곤 농장으로… (${place}등)`
      : retired === 'early'
        ? `🏖️ ${c.name} 조기 은퇴! ${place}등으로 인생 마무리${prize ? ` · 은퇴 상금 ${won(prize)}` : ''}`
        : `🏁 ${c.name} ${place}등으로 골인!${prize ? ` 골인 상금 ${won(prize)}` : ''}`;
  addLog(tx, text, { tone: retired === 'bust' ? 'bad' : 'result', charId: c.id, emotion: retired === 'bust' ? 'cry' : 'joy' });
}

