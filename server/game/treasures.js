// Stage 9 — treasures (treasures.json): found on treasure tiles (money route, senior) and on 제주도 trips. The
// appraisal value is drawn at pickup and kept SECRET until the game is over (결과 발표 보물 감정).
//
// character.treasures = [{uid, id}] (public: everyone sees WHAT was found)
// room.treasureValues = {uid: value (만원)} · room.treasureFakes = {uid: true} — hidden: `viewFor` sends
//   `treasureValues` only once the room is finished; the fake flags only through `room.result.treasures`.
// room.nextTreasureSeq (uid `tr<n>`)
import { addLog, emit, josa } from './effects.js';

export const treasureDefs = (data) => data.treasures?.treasures ?? [];
export const treasureDef = (data, id) => treasureDefs(data).find((t) => t.id === id) ?? null;

/** Fill Stage 9 treasure fields on older saves. */
export function ensureTreasures(c) {
  c.treasures ??= [];
  return c;
}

export function ensureRoomTreasures(room) {
  room.nextTreasureSeq ??= 0;
  room.treasureValues ??= {};
  room.treasureFakes ??= {};
  return room;
}

/** Treasures that may turn up in an era (eras filter). */
export function treasurePool(data, eraId) {
  return treasureDefs(data).filter((t) => !t.eras || t.eras.includes(eraId));
}

const round5 = (v) => Math.round(v / 5) * 5;

/** Appraisal draw (seeded): fake (fakeChance) → fake.min..fake.max, else min..max rounded to 5. */
export function appraise(rng, def, data) {
  if (rng.next() < (def.fakeChance ?? 0)) {
    const f = data.treasures?.fake ?? { min: 0, max: 5 };
    return { value: rng.int(f.min, f.max), fake: true };
  }
  return { value: Math.max(def.min, round5(rng.int(def.min, def.max))), fake: false };
}

/**
 * Give a character a random treasure (weighted pool of its era). The value stays hidden in the room.
 * Emits `treasureFound {charId, uid, treasureId, source}` (a cut-in anchor). @returns the {uid, id} | null
 */
export function findTreasure(tx, c, source = 'tile') {
  const room = ensureRoomTreasures(tx.room);
  const pool = treasurePool(tx.data, c.era);
  if (!pool.length) return null;
  const def = tx.rng.weighted(pool);
  const { value, fake } = appraise(tx.rng, def, tx.data);
  room.nextTreasureSeq += 1;
  const t = { uid: `tr${room.nextTreasureSeq}`, id: def.id };
  room.treasureValues[t.uid] = value;
  if (fake) room.treasureFakes[t.uid] = true;
  ensureTreasures(c).treasures.push(t);
  emit(tx, 'treasureFound', { charId: c.id, uid: t.uid, treasureId: def.id, source, tone: 'treasure', emotion: 'shock' });
  addLog(tx, `${def.icon} ${josa(c.name, '이/가')} 「${def.name}」${josa(def.name, '을/를').slice(def.name.length)} 발견했다! 감정은 결과 발표에서…`, { tone: 'money', charId: c.id, emotion: 'shock' });
  return t;
}

/** Treasure tile: always finds something (the appraisal decides whether it is worth anything). */
export function resolveTreasureTile(tx, c) {
  if (!findTreasure(tx, c, 'tile')) addLog(tx, `🏺 ${c.name}: 반짝이는 걸 봤는데 그냥 병뚜껑이었다`, { tone: 'info', charId: c.id });
  return null;
}

/** Revealed treasures of a finished game: [{charId, uid, treasureId, value, fake}] (in pickup order per character). */
export function revealTreasures(room) {
  const out = [];
  for (const c of room.characters) {
    for (const t of c.treasures ?? []) {
      out.push({ charId: c.id, uid: t.uid, treasureId: t.id, value: room.treasureValues?.[t.uid] ?? 0, fake: !!room.treasureFakes?.[t.uid] });
    }
  }
  return out;
}

/** Σ appraisal values of a character's treasures (hidden information: only for the final result). */
export function treasureValue(room, c) {
  return (c.treasures ?? []).reduce((s, t) => s + (room.treasureValues?.[t.uid] ?? 0), 0);
}
