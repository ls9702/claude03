// Era news flashes (Stage 6, news.json): one news per era, drawn when the first character enters it (the first
// era of adult mode at game start; never baby) → `room.news[eraId] = newsId` + a `newsFlash` event. Its effects
// apply to every character while it is in that era.
import { addLog, addStats, charById, emit } from './effects.js';

/**
 * Neutral effects (no news / unknown keys). Stage 8: `housePriceMult` = house listing prices / values of the era (the
 * senior one also scales the 노년 시세 draw), `birthBonus` = 출산장려금 (만원) per child born in the era.
 */
export const NEWS_DEFAULTS = Object.freeze({
  jobRequireDelta: 0,
  jobDelta: {},
  salaryMult: 1,
  partTimeMult: 1,
  eventMoneyMult: 1,
  moneyTileMult: 1,
  lossMult: 1,
  examBonus: 0,
  statBonus: {},
  habitCostMult: 1,
  rankUpBonus: 0,
  injuryMult: 1,
  tuitionMult: 1,
  housePriceMult: 1,
  birthBonus: 0,
});

export const newsById = (data, id) => data.news?.news?.find((n) => n.id === id) ?? null;

/** Effects of the news of an era (defaults filled in). */
export function newsEffects(room, eraId, data) {
  const n = eraId ? newsById(data, room?.news?.[eraId]) : null;
  return { ...NEWS_DEFAULTS, ...(n?.effects ?? {}) };
}

/** Effects for a character (the news of its current era). */
export const effectsFor = (tx, c) => newsEffects(tx.room, c?.era, tx.data);

/** News that can be drawn for an era (`eras` omitted = every era but baby). */
export function newsPool(data, eraId) {
  if (eraId === 'baby') return [];
  return (data.news?.news ?? []).filter((n) => !n.eras || n.eras.includes(eraId));
}

/**
 * Draw the news of an era once (no-op when already drawn / baby / empty pool). Emits `newsFlash {eraId,
 * newsId, title, text, tone}` (global, no charId) + a log line. @returns the news or null
 */
export function drawNews(tx, eraId) {
  const room = tx.room;
  room.news ??= {};
  if (Object.hasOwn(room.news, eraId)) return null;
  const pool = newsPool(tx.data, eraId);
  if (!pool.length) return null;
  const n = tx.rng.weighted(pool);
  room.news[eraId] = n.id;
  emit(tx, 'newsFlash', { eraId, newsId: n.id, title: n.title, text: n.text, tone: n.tone ?? 'neutral' });
  addLog(tx, `📰 [뉴스 속보] ${n.title} — ${n.text}`, { tone: n.tone ?? 'info' });
  return n;
}

/** One-shot news effects for a character entering an era (statBonus). */
export function applyEraNews(tx, c, eraId) {
  const eff = newsEffects(tx.room, eraId, tx.data);
  const keys = Object.keys(eff.statBonus ?? {});
  if (!keys.length) return [];
  return addStats(tx, c, eff.statBonus, 'news', { newsId: tx.room.news?.[eraId] });
}

/** Adult mode: the first era's news is drawn at game start and applies to everyone already in it. */
export function drawStartNews(tx) {
  const first = tx.room.board?.eras?.[0]?.id;
  const n = first ? drawNews(tx, first) : null;
  if (!n) return;
  for (const id of tx.room.turn.order) {
    const c = charById(tx.room, id);
    if (c) applyEraNews(tx, c, first);
  }
}
