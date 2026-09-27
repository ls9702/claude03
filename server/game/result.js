// Final settlement (pure): 보물 감정 → 특별상 → 칭호 → 총자산 순위 → MVP 투표.
// total = money − debt + items (Stage 7) + house (Stage 8) + treasures + award bonuses (Stage 9).
import { gameData } from '../data/index.js';
import { EngineError, emit, netWorth } from './effects.js';
import { itemsValue } from './cards.js';
import { houseValue } from './houses.js';
import { revealTreasures, treasureValue } from './treasures.js';
import { awardBonusByChar, computeAwards, computeTitles } from './awards.js';
import { topHighlights } from './highlights.js';

/**
 * @param {object} room
 * @param {{data?, reveal?: boolean, awards?: {[charId]: number}}} opts  `reveal` = count the (hidden) treasure
 *   appraisal values — only for the final result; mid-game callers (CPU heuristics) leave it off.
 * @returns {{rank, charId, name, money, debt, goalBonus, items, house, treasures, awards, total, place}[]} best
 *   first. Ties on total are broken by goal arrival order, then creation order.
 */
export function computeRanking(room, { data = gameData(), reveal = false, awards = null } = {}) {
  const rows = room.characters.map((c) => {
    const items = itemsValue(data, c);
    const house = houseValue(c);
    const treasures = reveal ? treasureValue(room, c) : 0;
    const bonus = awards?.[c.id] ?? 0;
    return {
      charId: c.id,
      name: c.name,
      seq: c.seq ?? 0,
      money: c.money ?? 0,
      debt: c.debt ?? 0,
      goalBonus: c.goalBonus ?? 0,
      items,
      house,
      treasures,
      awards: bonus,
      total: netWorth(c) + items + house + treasures + bonus,
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

/** Players who may vote for the MVP (role player; spectators and CPUs never vote). */
export const mvpVoters = (room) => (room.players ?? []).filter((p) => p.role !== 'spectator');

/**
 * Build the full result (mutates a cloned room): status finished, `room.result = {ranking, treasures, awards,
 * titles, highlights, mvp, finishedAt, forced}`. Without eligible voters the MVP is decided at once (1st place).
 * @returns the ranking
 */
export function applyResult(room, now, { forced = false, data = gameData() } = {}) {
  const awards = computeAwards(room, data);
  const ranking = computeRanking(room, { data, reveal: true, awards: awardBonusByChar(awards) });
  // award rows carry the recipients' names for the result screen
  const titles = computeTitles(room, data, { ranking });
  const voteMs = data.balance.result?.mvpVoteMs ?? 60000;
  room.status = 'finished';
  room.finishedAt = now;
  room.result = {
    ranking,
    treasures: revealTreasures(room),
    awards,
    titles,
    highlights: topHighlights(room.highlights, data.balance.result?.highlights?.show ?? 5),
    mvp: { votes: {}, winner: null, closesAt: now + voteMs, closed: false },
    finishedAt: now,
    forced,
  };
  if (!mvpVoters(room).length) decideMvp(room, now, { note: 'noVoters' });
  if (room.turn) {
    room.turn.phase = 'gameOver';
    room.turn.pending = null;
  }
  return ranking;
}

/** Vote counts {charId: n}. */
export function mvpCounts(votes) {
  const out = {};
  for (const id of Object.values(votes ?? {})) out[id] = (out[id] ?? 0) + 1;
  return out;
}

/**
 * Close the vote: most votes wins; ties → the higher final total (ranking order); no votes → 1st place with
 * `note: 'noVotes'`. Mutates room.result.mvp. @returns the mvp record
 */
export function decideMvp(room, now, { note = null } = {}) {
  const mvp = room.result.mvp;
  const counts = mvpCounts(mvp.votes);
  const order = room.result.ranking.map((r) => r.charId);
  let winner = null;
  const best = Math.max(0, ...Object.values(counts));
  if (best > 0) winner = order.find((id) => counts[id] === best) ?? null;
  const why = winner ? null : note ?? 'noVotes';
  if (!winner) winner = order[0] ?? null;
  Object.assign(mvp, { winner, counts, closed: true, closedAt: now, ...(why ? { note: why } : {}) });
  return mvp;
}

const fail = (status, message) => {
  throw new EngineError(status, message);
};

/**
 * MVP vote (after gameOver, status finished). actor {sessionId} = a player of the room (spectators 403); a trusted
 * caller (no actor) passes `voterId` (player id). One vote per player, changeable until the vote closes. Own
 * characters are refused unless every character is the voter's. When every eligible player has voted the vote
 * closes `mvpSettleMs` later (still changeable until then).
 */
export function castVote(tx, action) {
  const room = tx.room;
  const mvp = room.result?.mvp;
  if (!mvp) fail(409, 'MVP 투표가 없어요.');
  if (mvp.closed) fail(409, 'MVP 투표가 이미 끝났어요.');
  const actor = action.actor;
  if (actor?.admin || actor?.system) fail(403, '플레이어만 투표할 수 있어요.');
  const voter = actor ? room.players.find((p) => p.sessionId === actor.sessionId) : room.players.find((p) => p.id === action.voterId);
  if (!voter) fail(403, '이 방의 참가자가 아닙니다.');
  if (voter.role === 'spectator') fail(403, '관전자는 투표할 수 없어요.');
  const target = room.characters.find((c) => c.id === action.targetId);
  if (!target) fail(404, '캐릭터를 찾을 수 없습니다.');
  const allMine = room.characters.every((c) => c.ownerSessionId === voter.sessionId);
  if (target.ownerSessionId === voter.sessionId && !allMine) fail(409, '내 캐릭터에게는 투표할 수 없어요.');
  const changed = Object.hasOwn(mvp.votes, voter.id) && mvp.votes[voter.id] !== target.id;
  mvp.votes[voter.id] = target.id;
  emit(tx, 'mvpVoted', { playerId: voter.id, charId: target.id, changed, count: Object.keys(mvp.votes).length, tone: 'result', emotion: 'joy' });
  const settle = tx.data.balance.result?.mvpSettleMs ?? 5000;
  if (mvpVoters(room).every((p) => Object.hasOwn(mvp.votes, p.id))) mvp.closesAt = Math.min(mvp.closesAt, tx.now + settle);
}

/**
 * Close the vote: the runner's timer (system, only once `closesAt` passed) or the admin (any time).
 * Emits `mvpDecided {charId, votes: {charId: n}, note?}`.
 */
export function closeVote(tx, action) {
  const room = tx.room;
  const mvp = room.result?.mvp;
  if (!mvp) fail(409, 'MVP 투표가 없어요.');
  if (mvp.closed) fail(409, 'MVP 투표가 이미 끝났어요.');
  const actor = action.actor;
  if (actor && !actor.admin && !actor.system) fail(403, '관리자만 투표를 마감할 수 있어요.');
  if (actor?.system && tx.now < mvp.closesAt) fail(409, '아직 투표 시간이 남았어요.');
  emitMvpDecided(tx, decideMvp(room, tx.now));
}

export function emitMvpDecided(tx, mvp) {
  const name = tx.room.characters.find((c) => c.id === mvp.winner)?.name ?? '';
  emit(tx, 'mvpDecided', { charId: mvp.winner, votes: { ...mvp.counts }, ...(mvp.note ? { note: mvp.note } : {}), tone: 'result', emotion: 'joy' });
  return name;
}
