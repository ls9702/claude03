// Space (tile) resolution + the routeChoice / groupGift prompts. Called by the engine inside a tx.
// Stage 6 tiles: habit (kids eras → habit prompt), salary (job pay), job (job-tile decision); Stage 8: heart
// (family.js), house (houses.js); event tiles draw
// from events.json (conditions on job / education / route; money and stat effects).
import { ROUTE_KEYS } from './board.js';
import { addLog, addStats, changeMoney, charById, emit, josa, round5, statText, won } from './effects.js';
import { resolveHabitTile } from './growth.js';
import { PART_TIME_ID, paySalary, resolveJobTile } from './jobs.js';
import { effectsFor } from './news.js';
import { PROMPTS, openPrompt, promptComplete, registerPrompts, resolvePrompt } from './prompts.js';
import { applyLoss, cardDef, gainCard, guardStats, resolveCardTile, resolveShopTile, tryAmulet } from './cards.js';
import { loveRouteChosen, resolveHeartTile } from './family.js';
import { resolveHouseTile } from './houses.js';

export { PROMPTS, openPrompt, promptComplete, resolvePrompt };

const TONE_BY_ROUTE = { love: 'love', career: 'career', money: 'money' };

// ---------- prompts (single- and multi-character decisions) ----------

registerPrompts({
  routeChoice: {
    build(tx, c) {
      const routes = tx.data.board.routes;
      return {
        forCharacterIds: [c.id],
        title: '인생 갈림길',
        text: `${josa(c.name, '은/는')} 어느 길로 갈까요? 시대가 끝나면 다시 합류해요.`,
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
      const others = tx.room.turn.order.filter((id) => id !== c.id);
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
  return true;
}

/** Events that may happen to a character in an era (era filter + conditions). */
export function eventPool(data, eraId, c) {
  const list = data.events?.events ?? [];
  return list.filter((e) => (!e.eras || e.eras.includes(eraId)) && eventConditionsMet(e, c));
}

function runEvent(tx, c, era) {
  const pool = eventPool(tx.data, era.id, c);
  const ev = tx.rng.weighted(pool);
  if (ev.kind === 'groupGift') return openPrompt(tx, 'groupGift', c, { event: ev });
  let delta = 0;
  if (ev.money) {
    const scale = ev.scale ? (tx.data.balance.eventScale[era.id] ?? 1) : 1;
    delta = tx.rng.int(ev.money.min, ev.money.max) * scale * effectsFor(tx, c).eventMoneyMult;
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
  return null;
}

// ---------- tiles ----------

/**
 * Resolve landing on `tile`. May open a prompt (turn.pending); may finish the character.
 * The 인생 갈림길 (routeChoice stop) is opened by the turn epilogue (growth.lifeStep) so 진로 / 취업
 * decisions come first.
 * @returns {'goal'|'prompt'|null}
 */
export function resolveTile(tx, c, tile, { onGoal } = {}) {
  const era = tx.room.board.eras[c.position.eraIndex];
  const routeTone = TONE_BY_ROUTE[tile.route];
  switch (tile.type) {
    case 'money': {
      const tone = routeTone ?? 'good';
      const amount = round5(tile.amount * effectsFor(tx, c).moneyTileMult);
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
    case 'salary':
      paySalary(tx, c);
      return null;
    case 'job':
      return resolveJobTile(tx, c) ? 'prompt' : null;
    case 'card': // Stage 7
      return resolveCardTile(tx, c);
    case 'shop':
      resolveShopTile(tx, c);
      return 'prompt';
    case 'heart': // Stage 8: 만남 / 데이트 / 프로포즈 prompt, or family (출산 / 가족 나들이)
      return resolveHeartTile(tx, c) ? 'prompt' : null;
    case 'house': // Stage 8: 부동산 매물 prompt
      return resolveHouseTile(tx, c, tile) ? 'prompt' : null;
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
    case 'goal':
      onGoal?.(c);
      return 'goal';
    default: {
      // treasure: placeholder (hook for Stage 9).
      const text = tx.data.board.placeholders?.[tile.type] ?? tile.label;
      addLog(tx, `${tile.icon ?? ''} ${c.name}: ${text}`.trim(), { tone: routeTone ?? 'info', charId: c.id });
      return null;
    }
  }
}
