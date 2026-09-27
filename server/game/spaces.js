// Space (tile) resolution + the routeChoice / groupGift prompts. Called by the engine inside a tx.
// Stage 6 tiles: habit (kids eras → habit prompt), salary (job pay), job (job-tile decision); Stage 8: heart
// (family.js), house (houses.js); event tiles draw
// from events.json (conditions on job / education / route; money and stat effects).
import { ROUTE_KEYS } from './board.js';
import { addLog, addStats, changeMoney, charById, emit, hasBuff, josa, round5, statText, won } from './effects.js';
import { resolveHabitTile } from './growth.js';
import { PART_TIME_ID, payday, resolveJobTile } from './jobs.js';
import { effectsFor } from './news.js';
import { PROMPTS, openPrompt, promptComplete, registerPrompts, resolvePrompt } from './prompts.js';
import { applyLoss, cardDef, gainCard, guardStats, resolveCardTile, resolveShopTile, syncInjuryCard, tryAmulet } from './cards.js';
import { loveRouteChosen, resolveHeartTile } from './family.js';
import { resolveHouseTile } from './houses.js';
import { SUBMAPS, resolveSubmapTile } from './submaps.js';
import { resolveTreasureTile } from './treasures.js';
import { resolvePassTile } from './passTile.js';

export { PROMPTS, openPrompt, promptComplete, resolvePrompt };

const TONE_BY_ROUTE = { love: 'love', career: 'career', money: 'money' };

/** Guests of a 생일 파티 (groupGift): every other character still on the board (골인한 캐릭터 never wait / gift). */
export const giftGuests = (room, c) => room.turn.order.filter((id) => id !== c.id && !charById(room, id)?.finished);

// ---------- prompts (single- and multi-character decisions) ----------

registerPrompts({
  routeChoice: {
    build(tx, c) {
      const routes = tx.data.board.routes;
      return {
        forCharacterIds: [c.id],
        title: '인생 갈림길',
        text: `${josa(c.name, '은/는')} 어느 길로 갈까요? 루트 끝의 합류 지점에서 다시 만나요. (한 바퀴마다 다시 골라요)`,
        options: ROUTE_KEYS.map((k) => ({ id: k, label: routes[k].name, icon: routes[k].icon })),
        defaultOptionId: 'career',
      };
    },
    resolve(tx, p) {
      const c = charById(tx.room, p.charId);
      const key = p.answers[c.id];
      const era = tx.room.board.eras[c.position.eraIndex];
      const r = tx.data.board.routes[key];
      c.route = key;
      c.routeHistory.push({ era: era.id, route: key, completed: false });
      emit(tx, 'routeChosen', { charId: c.id, era: era.id, route: key, tone: r.tone, emotion: 'joy' });
      addLog(tx, `${r.icon} ${josa(c.name, '은/는')} ${era.name} 시대에 「${r.name}」 루트를 선택!`, { tone: r.tone, charId: c.id });
      if (key === 'love') loveRouteChosen(tx, c); // Stage 8: 소개팅 when single, affection + when dating
    },
  },

  groupGift: {
    resultCutin: true,
    build(tx, c, { event }) {
      const others = giftGuests(tx.room, c);
      return {
        forCharacterIds: others,
        title: '🎂 생일 파티',
        text: `${event.text.replaceAll('{name}', c.name)} (선물 ${won(event.gift)})`,
        options: [
          { id: 'gift', label: `선물 주기 (${won(event.gift)})`, icon: '🎁' },
          { id: 'skip', label: '모른 척하기', icon: '🙈' },
        ],
        defaultOptionId: 'skip',
        simultaneous: true, // answered by other players → always has a deadline
        context: { gift: event.gift },
      };
    },
    resolve(tx, p) {
      const target = charById(tx.room, p.charId);
      let count = 0;
      for (const id of p.forCharacterIds) {
        if (p.answers[id] !== 'gift') continue;
        const giver = charById(tx.room, id);
        const amount = Math.min(p.context.gift, giver.money);
        if (amount <= 0) continue;
        changeMoney(tx, giver, -amount, 'gift', { to: target.id, emotion: 'love', tone: 'love' });
        changeMoney(tx, target, amount, 'gift', { from: giver.id, emotion: 'love', tone: 'love' });
        addLog(tx, `🎁 ${josa(giver.name, '이/가')} ${target.name}에게 ${won(amount)} 선물!`, { tone: 'love', charId: giver.id });
        count++;
      }
      if (!count) addLog(tx, `🥲 아무도 ${target.name}에게 선물을 주지 않았다…`, { tone: 'bad', charId: target.id, emotion: 'cry' });
    },
  },
});

// ---------- event tiles (events.json) ----------

const asList = (v) => (v == null ? null : Array.isArray(v) ? v : [v]);

/** Does an events.json entry's `conditions` hold for a character? */
export function eventConditionsMet(ev, c) {
  const cond = ev.conditions;
  if (!cond) return true;
  const jobs = asList(cond.job);
  if (jobs) {
    const id = c.job?.id ?? null;
    const ok = jobs.some((j) => (j === 'any' ? id && id !== PART_TIME_ID : j === 'none' ? !id : j === 'parttime' ? id === PART_TIME_ID : id === j));
    if (!ok) return false;
  }
  const edu = asList(cond.education);
  if (edu && !edu.includes(c.education ?? 'none')) return false;
  const routes = asList(cond.route);
  if (routes && !routes.includes(c.route)) return false;
  if (cond.injured != null && (c.job?.injured > 0) !== !!cond.injured) return false; // 병원 치료 (heal) events
  const lacks = asList(cond.lacksCard); // card-reward events only for characters without that card
  if (lacks && lacks.some((id) => c.cards?.some((k) => k.id === id))) return false;
  return true;
}

/** Events that may happen to a character in an era (era filter + conditions). */
export function eventPool(data, eraId, c) {
  const list = data.events?.events ?? [];
  return list.filter((e) => (!e.eras || e.eras.includes(eraId)) && eventConditionsMet(e, c));
}

/** A good (never harmful) event — the final race's event tiles draw only these. */
const goodEvent = (e) => e.kind !== 'groupGift' && e.tone !== 'bad' && !(e.money && e.money.min < 0) && !Object.values(e.stats ?? {}).some((v) => v < 0);

function runEvent(tx, c, era) {
  let pool = eventPool(tx.data, era.id, c);
  if (era.final) pool = pool.filter(goodEvent).length ? pool.filter(goodEvent) : pool; // the goal race: good things only
  const ev = tx.rng.weighted(pool);
  if (ev.kind === 'groupGift') {
    // Nobody left to invite → the party resolves at once, no prompt / wait
    if (!giftGuests(tx.room, c).length) {
      addLog(tx, `🎂 ${c.name}의 생일! 초대할 사람이 없어 혼자 조용히 케이크를 먹었다`, { tone: 'info', charId: c.id, emotion: 'sweat', eventId: ev.id });
      return null;
    }
    return openPrompt(tx, 'groupGift', c, { event: ev });
  }
  let delta = 0;
  if (ev.money) {
    const scale = ev.scale ? (tx.data.balance.eventScale[era.id] ?? 1) : 1;
    delta = tx.rng.int(ev.money.min, ev.money.max) * scale * effectsFor(tx, c).eventMoneyMult;
    if (delta > 0 && hasBuff(c, 'moneyX15')) delta *= 1.5; // 💰 행운 주머니 (찬스 광장 buff)
    delta = Math.abs(delta) < 5 ? Math.round(delta) : round5(delta);
  }
  const text = ev.text.replaceAll('{name}', c.name);
  const tone = ev.tone && ev.tone !== 'neutral' ? ev.tone : delta > 0 ? 'good' : delta < 0 ? 'bad' : 'info';
  const emotion = ev.emotion ?? (delta > 0 ? 'joy' : delta < 0 ? 'cry' : null);
  // Stage 7: 건강 부적 cancels a bad event once (nothing happens, not counted as bad luck)
  if ((delta < 0 || tone === 'bad') && tryAmulet(tx, c, 'badEvent')) {
    addLog(tx, `❗ ${text} … 였지만 부적이 막아 줬다!`, { tone: 'good', charId: c.id, emotion: 'joy', eventId: ev.id });
    return null;
  }
  if (delta > 0) changeMoney(tx, c, delta, 'event', { emotion, tone: tone === 'bad' ? 'good' : tone, eventId: ev.id });
  else if (delta < 0) delta = -applyLoss(tx, c, -delta, 'event', { emotion, tone: 'bad', eventId: ev.id }).amount; // 실손 보험
  const stats = guardStats(tx.data, c, ev.stats); // 안마의자: no str loss in senior events
  const changes = stats ? addStats(tx, c, stats, 'event', { eventId: ev.id }) : [];
  if (delta < 0 || tone === 'bad') c.badEvents = (c.badEvents ?? 0) + 1;
  const extras = [delta ? `${delta > 0 ? '+' : ''}${won(delta)}` : '', changes.length ? statText(tx.data, changes) : ''].filter(Boolean);
  addLog(tx, `❗ ${text}${extras.length ? ` (${extras.join(', ')})` : ''}`, { tone, charId: c.id, emotion, eventId: ev.id });
  if (ev.card && cardDef(tx.data, ev.card)) gainCard(tx, c, ev.card, 'event'); // Stage 7: card rewards
  if (ev.heal && c.job?.injured > 0) {
    c.job.injured = 0; // 병원 치료: the injury heals at once (the 🤕 card leaves the hand)
    syncInjuryCard(tx, c);
  }
  return null;
}

// ---------- tiles ----------

/**
 * Resolve landing on `tile`. May open a prompt (turn.pending).
 * The 인생 갈림길 (routeChoice stop) is opened by the turn epilogue (growth.lifeStep) so life decisions come first.
 * Loop maps: `start` does nothing, `salary` = 월급날 (payday: 용돈 in kids eras, the job salary in adult eras),
 * `pass` = 찬스 광장 (landing exactly on it opens its prompt; passing it is handled by the engine's walk).
 * Final era: `goal` → `onGoal` (goal order, prizes).
 * @returns {'prompt'|null}
 */
export function resolveTile(tx, c, tile, { onGoal } = {}) {
  const era = tx.room.board.eras[c.position.eraIndex];
  const routeTone = TONE_BY_ROUTE[tile.route];
  switch (tile.type) {
    case 'money': {
      const tone = routeTone ?? 'good';
      const amount = round5(tile.amount * effectsFor(tx, c).moneyTileMult * (hasBuff(c, 'moneyX15') ? 1.5 : 1)); // 💰 행운 주머니
      changeMoney(tx, c, amount, 'tile', { tileId: tile.id, emotion: 'joy', tone });
      addLog(tx, `💰 ${c.name}: ${tile.label}! +${won(amount)}`, { tone, charId: c.id, emotion: 'joy' });
      return null;
    }
    case 'loss': {
      const { amount, debt: newDebt } = applyLoss(tx, c, round5(tile.amount * effectsFor(tx, c).lossMult), 'tile', { tileId: tile.id, emotion: 'cry', tone: 'bad' });
      c.badEvents = (c.badEvents ?? 0) + 1;
      addLog(tx, `💸 ${c.name}: ${tile.label}… -${won(amount)}${newDebt > 0 ? ` (빚 ${won(newDebt)} 발생)` : ''}`, {
        tone: 'bad',
        charId: c.id,
        emotion: newDebt > 0 ? 'shock' : 'cry',
      });
      return null;
    }
    case 'event':
      return runEvent(tx, c, era) ? 'prompt' : null;
    case 'habit':
      resolveHabitTile(tx, c);
      return 'prompt';
    case 'salary': // loop maps: 월급날 (a forced stop)
      payday(tx, c);
      return null;
    case 'pass': // loop maps: 찬스 광장
      return resolvePassTile(tx, c, tile) ? 'prompt' : null;
    case 'start':
      return null;
    case 'job':
      return resolveJobTile(tx, c) ? 'prompt' : null;
    case 'card': // Stage 7
      return resolveCardTile(tx, c);
    case 'shop':
      resolveShopTile(tx, c);
      return 'prompt';
    case 'heart': // Stage 8: 만남 / 데이트 / 프러포즈 prompt, or family (출산 / 가족 나들이)
      return resolveHeartTile(tx, c) ? 'prompt' : null;
    case 'house': // Stage 8: 부동산 매물 prompt
      return resolveHouseTile(tx, c, tile) ? 'prompt' : null;
    case 'treasure': // Stage 9: a treasure with a hidden appraisal value
      return resolveTreasureTile(tx, c);
    case 'hometown': // Stage 9: submaps (고향 / 사찰 / 제주도 / 인생역전)
    case 'temple':
    case 'jeju':
    case 'reversal':
      return resolveSubmapTile(tx, c, tile) ? 'prompt' : null;
    case 'stop':
      if (tile.promptId === 'routeChoice') return null; // opened by the turn epilogue after life decisions
      if (PROMPTS[tile.promptId]) {
        openPrompt(tx, tile.promptId, c, { tile });
        return 'prompt';
      }
      addLog(tx, `🛑 ${c.name}: ${tile.label}`, { charId: c.id });
      return null;
    case 'merge':
      addLog(tx, `🔗 ${josa(c.name, '이/가')} 합류 지점에 도착했다.`, { charId: c.id });
      return null;
    case 'goal': // final era: the goal race
      onGoal?.(c);
      return null;
    default: {
      // a tile type listed in board.json `placeholders` (none since Stage 9) only logs its text
      if (SUBMAPS.includes(tile.type)) return null;
      const text = tx.data.board.placeholders?.[tile.type] ?? tile.label;
      addLog(tx, `${tile.icon ?? ''} ${c.name}: ${text}`.trim(), { tone: routeTone ?? 'info', charId: c.id });
      return null;
    }
  }
}
