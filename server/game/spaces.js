// Space (tile) resolution + prompt definitions. Called by the engine inside a tx.
import { ROUTE_KEYS } from './board.js';
import { addLog, changeMoney, charById, emit, josa, won } from './effects.js';

const TONE_BY_ROUTE = { love: 'love', career: 'career', money: 'money' };

// ---------- prompts (single- and multi-character decisions) ----------

/**
 * Prompt kinds. `build` returns the prompt spec, `resolve` applies the answers.
 * Multi-character prompts (forCharacterIds.length > 1) get a deadline; on
 * timeout missing answers take `defaultOptionId`.
 */
export const PROMPTS = {
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
    },
  },

  exam: {
    build(tx, c) {
      return {
        forCharacterIds: [c.id],
        title: '📝 수능 날',
        text: `${josa(c.name, '이/가')} 수능 시험장에 들어섰다. 어떻게 풀까?`,
        options: [
          { id: 'study', label: '차근차근 푼다', icon: '✏️' },
          { id: 'guess', label: '감으로 찍는다', icon: '🎯' },
        ],
        defaultOptionId: 'study',
      };
    },
    resolve(tx, p) {
      const c = charById(tx.room, p.charId);
      const choice = p.answers[c.id];
      const cfg = tx.data.balance.exam[choice];
      const roll = tx.rng.int(1, 10);
      if (roll >= cfg.threshold) {
        changeMoney(tx, c, cfg.reward, 'exam', { emotion: 'joy', tone: 'good' });
        addLog(tx, `🎉 ${c.name} 수능 대박! 장학금 ${won(cfg.reward)}`, { tone: 'good', charId: c.id, emotion: 'joy' });
      } else {
        addLog(tx, `😵 ${c.name}, 수능이 생각보다 어려웠다… (장학금 없음)`, { tone: 'bad', charId: c.id, emotion: 'sweat' });
      }
    },
  },

  groupGift: {
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
};

/** Open a prompt → turn.pending, phase awaitDecision; CPU characters answer the default at once. */
export function openPrompt(tx, kind, c, extra = {}) {
  const def = PROMPTS[kind];
  const spec = def.build(tx, c, extra);
  const room = tx.room;
  room.promptSeq = (room.promptSeq ?? 0) + 1;
  const { multiTimeoutMs, decisionTimeoutMs } = tx.data.balance.prompts;
  const multi = spec.simultaneous || spec.forCharacterIds.length > 1;
  const timeout = multi ? multiTimeoutMs : decisionTimeoutMs;
  const pending = {
    promptId: `pr${room.promptSeq}`,
    kind,
    charId: c.id,
    title: spec.title,
    text: spec.text,
    forCharacterIds: spec.forCharacterIds,
    options: spec.options,
    defaultOptionId: spec.defaultOptionId,
    answers: {},
    deadlineAt: timeout ? tx.now + timeout : null,
    context: spec.context ?? {},
  };
  for (const id of pending.forCharacterIds) {
    if (charById(room, id)?.ownerSessionId === 'cpu') pending.answers[id] = pending.defaultOptionId;
  }
  room.turn.pending = pending;
  room.turn.phase = 'awaitDecision';
  emit(tx, 'prompt', {
    promptId: pending.promptId,
    kind,
    charId: c.id,
    forCharacterIds: pending.forCharacterIds,
    options: pending.options,
    title: pending.title,
    deadlineAt: pending.deadlineAt,
    tone: multi ? 'holiday' : 'info',
  });
  return pending;
}

export const promptComplete = (p) => p.forCharacterIds.every((id) => Object.hasOwn(p.answers, id));

/** Apply a completed prompt and clear it. */
export function resolvePrompt(tx) {
  const p = tx.room.turn.pending;
  tx.room.turn.pending = null;
  tx.room.turn.phase = 'resolveSpace';
  PROMPTS[p.kind].resolve(tx, p);
}

// ---------- tiles ----------

function runEvent(tx, c, era) {
  const pool = tx.data.board.events.filter((e) => !e.eras || e.eras.includes(era.id));
  const ev = tx.rng.weighted(pool);
  if (ev.kind === 'groupGift') return openPrompt(tx, 'groupGift', c, { event: ev });
  const scale = ev.scale ? (tx.data.balance.eventScale[era.id] ?? 1) : 1;
  const delta = Math.round(tx.rng.int(ev.min, ev.max) * scale);
  const text = ev.text.replaceAll('{name}', c.name);
  const tone = delta > 0 ? 'good' : delta < 0 ? 'bad' : 'info';
  const emotion = ev.emotion ?? (delta > 0 ? 'joy' : delta < 0 ? 'cry' : null);
  if (delta) changeMoney(tx, c, delta, 'event', { emotion, tone, eventId: ev.id });
  addLog(tx, `❗ ${text}${delta ? ` (${delta > 0 ? '+' : ''}${won(delta)})` : ''}`, { tone, charId: c.id, emotion });
  return null;
}

/**
 * Resolve landing on `tile`. May open a prompt (turn.pending); may finish the character.
 * @returns {'goal'|'prompt'|null}
 */
export function resolveTile(tx, c, tile, { onGoal } = {}) {
  const era = tx.room.board.eras[c.position.eraIndex];
  const routeTone = TONE_BY_ROUTE[tile.route];
  switch (tile.type) {
    case 'money': {
      const tone = routeTone ?? 'good';
      changeMoney(tx, c, tile.amount, 'tile', { tileId: tile.id, emotion: 'joy', tone });
      addLog(tx, `💰 ${c.name}: ${tile.label}! +${won(tile.amount)}`, { tone, charId: c.id, emotion: 'joy' });
      return null;
    }
    case 'loss': {
      const newDebt = changeMoney(tx, c, -tile.amount, 'tile', { tileId: tile.id, emotion: 'cry', tone: 'bad' });
      addLog(tx, `💸 ${c.name}: ${tile.label}… -${won(tile.amount)}${newDebt > 0 ? ` (빚 ${won(newDebt)} 발생)` : ''}`, {
        tone: 'bad',
        charId: c.id,
        emotion: newDebt > 0 ? 'shock' : 'cry',
      });
      return null;
    }
    case 'event':
      return runEvent(tx, c, era) ? 'prompt' : null;
    case 'stop':
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
      // heart/job/card/shop/treasure/house: Stage 2 placeholders (hooks for later stages).
      const text = tx.data.board.placeholders?.[tile.type] ?? tile.label;
      addLog(tx, `${tile.icon ?? ''} ${c.name}: ${text}`.trim(), { tone: routeTone ?? 'info', charId: c.id });
      return null;
    }
  }
}
