// Stage 9 — submaps (서브맵): single-tile "detour" events with their own prompt (balance.json `submaps`).
//   hometown 고향 시골집 (elem+ main, love route): rest (skip the next spin, str +1, 부모님 용돈) / visit (small money,
//     charm +1)
//   temple 사찰 템플스테이 (middle+ main, money route): train:<stat> (+2, skip the next spin; the weakest and the
//     strongest stat below the cap are offered) / wish (시주 + luck check →
//     luck +1 + money, `c.wishes` += 1 → 산신령) / leave
//   jeju 제주도 여행 (love / money routes): trip (cost, charm +1, luck +1, chance of a treasure) / skip
//   reversal 인생역전 (senior main): lotto (small cost, rare jackpot) / horse:<2|5|10> (bet a share of the cash; EV < 1)
//     / skip
// Landing emits `submapEntered {charId, submap, tileId}` (a follow-up, the prompt takes the stage); the resolution
// emits `submapResult {charId, submap, optionId, result, amount?, stat?, ...}` (a cut-in anchor) followed by its
// moneyChanged / statChanged (+ treasureFound on a lucky 제주 trip).
import { STAT_KEYS, addLog, addStats, changeMoney, charById, emit, josa, round5, statCap, statName, statText, won } from './effects.js';
import { openPrompt, registerPrompts } from './prompts.js';
import { findTreasure } from './treasures.js';

export const SUBMAPS = ['hometown', 'temple', 'jeju', 'reversal'];
export const SUBMAP_NAMES = { hometown: '고향 시골집', temple: '사찰 템플스테이', jeju: '제주도 여행', reversal: '인생역전' };
export const SUBMAP_ICONS = { hometown: '🏡', temple: '🛕', jeju: '🏝️', reversal: '🎰' };
export const HORSE_ODDS = ['2', '5', '10'];

const cfgOf = (data) => data.balance.submaps ?? {};
const scaleOf = (data, era) => cfgOf(data).scale?.[era] ?? 1;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const pct = (p) => Math.round(p * 100);

/** Skip the character's next spin(s) (`skipReason` names the log line: hometown / temple / retake). */
export function skipNext(c, turns, reason) {
  c.skipTurns = (c.skipTurns ?? 0) + turns;
  c.skipReason = reason;
}

/**
 * The two stats a temple stay offers to train: the weakest one (약점 보완) and the strongest one below the cap (강점
 * 강화); ties by STAT_KEYS order. Capped stats are never offered (all capped → none).
 */
export function trainStats(c, data) {
  const cap = statCap(data);
  const open = STAT_KEYS.filter((k) => (c.stats?.[k] ?? 0) < cap);
  if (open.length <= 2) return open;
  const byLow = [...open].sort((a, b) => (c.stats?.[a] ?? 0) - (c.stats?.[b] ?? 0));
  const low = byLow[0];
  const high = [...open].sort((a, b) => (c.stats?.[b] ?? 0) - (c.stats?.[a] ?? 0)).find((k) => k !== low);
  return STAT_KEYS.filter((k) => k === low || k === high);
}

/** 사찰 소원 success chance: base + luck × 운, clamped. */
export function wishChance(c, data) {
  const w = cfgOf(data).temple?.wish ?? {};
  return clamp((w.base ?? 0.35) + (w.luck ?? 0.05) * (c.stats?.luck ?? 0), w.min ?? 0.1, w.max ?? 0.85);
}

/** 제주도 treasure chance: base + luck × 운 (≤ max). */
export function jejuTreasureChance(c, data) {
  const t = cfgOf(data).jeju?.treasure ?? {};
  return clamp((t.base ?? 0.3) + (t.luck ?? 0) * (c.stats?.luck ?? 0), 0, t.max ?? 0.6);
}

/** 경마 stake: `share` of the cash, rounded to 5, within [min, max]. */
export function horseStake(c, data) {
  const h = cfgOf(data).reversal?.horse ?? {};
  const cash = Math.max(0, c.money ?? 0);
  return clamp(round5(cash * (h.share ?? 0.2)), h.min ?? 10, h.max ?? 1500);
}

/** Expected value (만원) of one 로또 ticket (prizes × chances). */
export function reversalLottoEv(data) {
  return (cfgOf(data).reversal?.lotto?.prizes ?? []).reduce((s, p) => s + p.chance * p.amount, 0);
}

/** Land on a submap tile → `submapEntered` + the submap prompt. @returns true (a prompt opened) */
export function resolveSubmapTile(tx, c, tile) {
  const submap = tile.type;
  emit(tx, 'submapEntered', { charId: c.id, submap, tileId: tile.id, tone: submap === 'reversal' ? 'treasure' : 'good', emotion: 'joy' });
  openPrompt(tx, submap, c, { tile });
  return true;
}

function result(tx, c, submap, optionId, res, extra = {}, { tone = 'good', emotion = 'joy' } = {}) {
  return emit(tx, 'submapResult', { charId: c.id, submap, optionId, result: res, ...extra, tone, emotion });
}

// ---------- prompts ----------

registerPrompts({
  /** 고향 시골집: 푹 쉬기 (다음 룰렛 1번 쉼 · 체력 · 부모님 용돈) / 안부 인사 (작은 용돈 · 매력). */
  hometown: {
    build(tx, c) {
      const cfg = cfgOf(tx.data).hometown ?? {};
      const scale = scaleOf(tx.data, c.era);
      const rest = round5((cfg.restGift ?? 30) * scale);
      const visit = round5((cfg.visitGift ?? 10) * scale);
      const skip = cfg.skipTurns ?? 1;
      return {
        forCharacterIds: [c.id],
        title: '🏡 고향 시골집',
        text: `${josa(c.name, '이/가')} 고향 시골집에 들렀다. 할머니가 버선발로 뛰어나오신다!`,
        options: [
          { id: 'rest', label: '😴 푹 쉬다 가기', icon: '😴', desc: `다음 룰렛 ${skip}번 쉬기 · ${statText(tx.data, Object.entries(cfg.restStats ?? {}).map(([stat, delta]) => ({ stat, delta })))} · 부모님 용돈 ${won(rest)}`, money: rest, stats: { ...(cfg.restStats ?? {}) }, skipTurns: skip },
          { id: 'visit', label: '👋 안부만 전하기', icon: '👋', desc: `${statText(tx.data, Object.entries(cfg.visitStats ?? {}).map(([stat, delta]) => ({ stat, delta })))} · 용돈 ${won(visit)}`, money: visit, stats: { ...(cfg.visitStats ?? {}) }, skipTurns: 0 },
        ],
        defaultOptionId: 'visit',
        context: { rest, visit },
      };
    },
    resolve(tx, p) {
      const c = charById(tx.room, p.charId);
      const cfg = cfgOf(tx.data).hometown ?? {};
      const rest = p.answers[c.id] === 'rest';
      const amount = rest ? p.context.rest : p.context.visit;
      const changes = [];
      if (rest) skipNext(c, cfg.skipTurns ?? 1, 'hometown');
      result(tx, c, 'hometown', rest ? 'rest' : 'visit', rest ? 'rest' : 'visit', { amount }, { tone: 'good', emotion: rest ? 'joy' : 'love' });
      changeMoney(tx, c, amount, 'hometown', { tone: 'good', emotion: 'joy' });
      changes.push(...addStats(tx, c, rest ? cfg.restStats ?? {} : cfg.visitStats ?? {}, 'hometown'));
      const stat = changes.length ? ` (${statText(tx.data, changes)})` : '';
      addLog(
        tx,
        rest
          ? `😴 ${josa(c.name, '은/는')} 고향에서 푹 쉬었다. 부모님 용돈 +${won(amount)}${stat} · 다음 룰렛은 쉬어요`
          : `👋 ${josa(c.name, '이/가')} 부모님께 안부를 전했다. 용돈 +${won(amount)}${stat}`,
        { tone: 'good', charId: c.id, emotion: 'joy' },
      );
    },
  },

  /** 사찰 템플스테이: 능력치 수련 (+2, 한 턴 쉼) / 소원 빌기 (운 판정) / 그냥 나가기. */
  temple: {
    build(tx, c) {
      const cfg = cfgOf(tx.data).temple ?? {};
      const scale = scaleOf(tx.data, c.era);
      const gain = cfg.trainGain ?? 2;
      const offering = round5((cfg.offering ?? 5) * scale);
      const wishMoney = round5((cfg.wish?.money ?? 25) * scale);
      const chance = wishChance(c, tx.data);
      const skip = cfg.skipTurns ?? 1;
      const options = trainStats(c, tx.data).map((stat) => ({ id: `train:${stat}`, stat, gain, skipTurns: skip, label: `🧘 ${statName(tx.data, stat)} 수련`, icon: '🧘', desc: `${statName(tx.data, stat)} +${gain} · 다음 룰렛 ${skip}번 쉬기` }));
      const wish = { id: 'wish', label: '🙏 소원 빌기', icon: '🙏', desc: `시주 ${won(offering)} · 이뤄질 확률 약 ${pct(chance)}% → 운 +${cfg.wish?.luckGain ?? 1} · ${won(wishMoney)}`, chance, cost: offering, price: offering, money: wishMoney };
      if (offering > (c.money ?? 0)) Object.assign(wish, { disabled: true, desc: `${wish.desc} · 시주할 돈이 부족해요` });
      options.push(wish, { id: 'leave', label: '🚶 합장만 하고 나가기', icon: '🚶', desc: '아무 일도 없어요' });
      return {
        forCharacterIds: [c.id],
        title: '🛕 사찰 템플스테이',
        text: `${josa(c.name, '이/가')} 산속 사찰에 도착했다. 풍경 소리가 들린다… 무엇을 할까?`,
        options,
        defaultOptionId: 'leave',
        context: { offering, wishMoney, chance },
      };
    },
    resolve(tx, p) {
      const c = charById(tx.room, p.charId);
      const cfg = cfgOf(tx.data).temple ?? {};
      const answer = p.answers[c.id];
      if (answer?.startsWith('train:')) {
        const stat = answer.slice(6);
        skipNext(c, cfg.skipTurns ?? 1, 'temple');
        result(tx, c, 'temple', answer, 'train', { stat, gain: cfg.trainGain ?? 2 }, { tone: 'good', emotion: 'joy' });
        const changes = addStats(tx, c, { [stat]: cfg.trainGain ?? 2 }, 'temple');
        addLog(tx, `🧘 ${c.name} 템플스테이 수련! ${changes.length ? statText(tx.data, changes) : '이미 최고치'} · 다음 룰렛은 쉬어요`, { tone: 'good', charId: c.id, emotion: 'joy' });
        return;
      }
      if (answer === 'wish') {
        const offering = Math.min(p.context.offering, Math.max(0, c.money ?? 0));
        const chance = wishChance(c, tx.data);
        const ok = tx.rng.next() < chance;
        const amount = ok ? p.context.wishMoney - offering : -offering;
        if (ok) c.wishes = (c.wishes ?? 0) + 1;
        result(tx, c, 'temple', 'wish', ok ? 'wishOk' : 'wishFail', { amount, chance, wishes: c.wishes ?? 0, ...(ok ? { stat: 'luck' } : {}) }, { tone: ok ? 'good' : 'neutral', emotion: ok ? 'joy' : 'sweat' });
        if (offering) changeMoney(tx, c, -offering, 'temple', { tone: 'neutral', emotion: 'neutral' });
        if (ok) {
          changeMoney(tx, c, p.context.wishMoney, 'temple', { tone: 'good', emotion: 'joy' });
          addStats(tx, c, { luck: cfg.wish?.luckGain ?? 1 }, 'temple');
          addLog(tx, `🙏 ${c.name}의 소원이 이루어졌다! (+${won(p.context.wishMoney)}, 소원 성취 ${c.wishes}번)`, { tone: 'good', charId: c.id, emotion: 'joy' });
        } else addLog(tx, `🙏 ${c.name}, 정성껏 빌었지만 아직은 때가 아닌가 보다…`, { tone: 'info', charId: c.id, emotion: 'sweat' });
        return;
      }
      result(tx, c, 'temple', 'leave', 'leave', {}, { tone: 'neutral', emotion: 'neutral' });
      addLog(tx, `🚶 ${josa(c.name, '은/는')} 합장만 하고 조용히 내려왔다`, { tone: 'info', charId: c.id });
    },
  },

  /** 제주도 여행: 떠나기 (비용 · 매력·운 +1 · 보물 확률) / 다음에. */
  jeju: {
    build(tx, c) {
      const cfg = cfgOf(tx.data).jeju ?? {};
      const cost = round5((cfg.cost ?? 30) * scaleOf(tx.data, c.era));
      const chance = jejuTreasureChance(c, tx.data);
      const statsDesc = statText(tx.data, Object.entries(cfg.stats ?? {}).map(([stat, delta]) => ({ stat, delta })));
      const trip = { id: 'trip', label: '✈️ 제주도로 떠나기', icon: '✈️', desc: `${won(cost)} · ${statsDesc} · 보물 발견 확률 약 ${pct(chance)}%`, cost, price: cost, stats: { ...(cfg.stats ?? {}) }, treasureChance: chance };
      if (cost > (c.money ?? 0)) Object.assign(trip, { disabled: true, desc: `${trip.desc} · 여행비가 부족해요` });
      return {
        forCharacterIds: [c.id],
        title: '🏝️ 제주도 여행',
        text: `${c.name}에게 제주도 특가 항공권 문자가 왔다! 떠나 볼까?`,
        options: [trip, { id: 'skip', label: '🏠 다음에 갈래', icon: '🏠', desc: '돈을 아껴요' }],
        defaultOptionId: trip.disabled ? 'skip' : 'trip',
        context: { cost },
      };
    },
    resolve(tx, p) {
      const c = charById(tx.room, p.charId);
      const cfg = cfgOf(tx.data).jeju ?? {};
      if (p.answers[c.id] !== 'trip' || p.context.cost > (c.money ?? 0)) {
        result(tx, c, 'jeju', 'skip', 'skip', {}, { tone: 'neutral', emotion: 'neutral' });
        addLog(tx, `🏠 ${josa(c.name, '은/는')} 제주도 여행을 다음으로 미뤘다`, { tone: 'info', charId: c.id });
        return;
      }
      const found = tx.rng.next() < jejuTreasureChance(c, tx.data);
      result(tx, c, 'jeju', 'trip', 'trip', { amount: -p.context.cost, treasure: found }, { tone: 'love', emotion: 'joy' });
      changeMoney(tx, c, -p.context.cost, 'jeju', { tone: 'neutral', emotion: 'joy' });
      const changes = addStats(tx, c, cfg.stats ?? {}, 'jeju');
      addLog(tx, `🏝️ ${josa(c.name, '이/가')} 제주도 여행을 떠났다! (−${won(p.context.cost)}${changes.length ? `, ${statText(tx.data, changes)}` : ''})`, { tone: 'love', charId: c.id, emotion: 'joy' });
      if (found) findTreasure(tx, c, 'jeju');
    },
  },

  /** 인생역전 (노년): 로또 한 장 / 경마 (배당 2·5·10배) / 그냥 지나가기. */
  reversal: {
    build(tx, c) {
      const cfg = cfgOf(tx.data).reversal ?? {};
      const cash = Math.max(0, c.money ?? 0);
      const lcost = cfg.lotto?.cost ?? 35;
      const top = (cfg.lotto?.prizes ?? []).reduce((m, x) => Math.max(m, x.amount), 0);
      const lotto = { id: 'lotto', label: '🎟️ 인생역전 로또', icon: '🎟️', desc: `${won(lcost)} · 1등 ${won(top)} (아주 희박)`, cost: lcost, price: lcost, prizes: (cfg.lotto?.prizes ?? []).map((x) => ({ ...x })), ev: Math.round(reversalLottoEv(tx.data) * 10) / 10 };
      if (lcost > cash) Object.assign(lotto, { disabled: true, desc: `${lotto.desc} · 돈이 부족해요` });
      const stake = horseStake(c, tx.data);
      const horses = HORSE_ODDS.filter((o) => cfg.horse?.odds?.[o] != null).map((o) => {
        const chance = cfg.horse.odds[o];
        const opt = { id: `horse:${o}`, label: `🏇 경마 ${o}배`, icon: '🏇', desc: `${won(stake)} 걸기 · 적중 약 ${pct(chance)}% → +${won(stake * (Number(o) - 1))}`, odds: Number(o), chance, stake, cost: stake, price: stake, ev: Math.round(chance * Number(o) * 100) / 100 };
        if (stake > cash) Object.assign(opt, { disabled: true, desc: `${won(stake)} 필요 · 돈이 부족해요` });
        return opt;
      });
      return {
        forCharacterIds: [c.id],
        title: '🎰 인생역전',
        text: `노년의 ${josa(c.name, '이/가')} 인생역전 한 방을 노려 볼까?`,
        options: [lotto, ...horses, { id: 'skip', label: '🍵 욕심 버리기', icon: '🍵', desc: '지금 가진 것에 만족해요' }],
        defaultOptionId: 'skip',
        context: { stake },
      };
    },
    resolve(tx, p) {
      const c = charById(tx.room, p.charId);
      const cfg = cfgOf(tx.data).reversal ?? {};
      const answer = p.answers[c.id];
      const cash = Math.max(0, c.money ?? 0);
      if (answer === 'lotto' && (cfg.lotto?.cost ?? 35) <= cash) {
        const cost = cfg.lotto?.cost ?? 35;
        let r = tx.rng.next();
        let prize = null;
        for (const x of cfg.lotto?.prizes ?? []) {
          if (r < x.chance) {
            prize = x;
            break;
          }
          r -= x.chance;
        }
        const res = prize ? (prize.id === 'jackpot' ? 'jackpot' : 'lottoWin') : 'lottoLose';
        const amount = (prize?.amount ?? 0) - cost;
        result(tx, c, 'reversal', 'lotto', res, { amount, prize: prize?.amount ?? 0, rank: prize?.id ?? null }, prize ? { tone: 'treasure', emotion: prize.id === 'jackpot' ? 'shock' : 'joy' } : { tone: 'bad', emotion: 'sweat' });
        changeMoney(tx, c, -cost, 'reversal', { tone: 'neutral', emotion: 'neutral' });
        if (prize) {
          changeMoney(tx, c, prize.amount, 'reversal', { tone: 'treasure', emotion: 'joy' });
          addLog(tx, `${prize.id === 'jackpot' ? '💥 인생역전 1등!!!' : '🎟️ 로또 당첨!'} ${c.name} +${won(prize.amount)}`, { tone: 'money', charId: c.id, emotion: prize.id === 'jackpot' ? 'shock' : 'joy' });
        } else addLog(tx, `🎟️ ${c.name}: 로또 꽝… (−${won(cost)})`, { tone: 'bad', charId: c.id, emotion: 'sweat' });
        return;
      }
      if (answer?.startsWith('horse:')) {
        const odds = Number(answer.slice(6));
        const chance = cfg.horse?.odds?.[String(odds)] ?? 0;
        const stake = Math.min(p.context.stake, cash);
        if (stake > 0 && chance > 0) {
          const win = tx.rng.next() < chance;
          const amount = win ? stake * (odds - 1) : -stake;
          result(tx, c, 'reversal', answer, win ? 'horseWin' : 'horseLose', { amount, odds, stake, chance }, win ? { tone: 'treasure', emotion: odds >= 5 ? 'shock' : 'joy' } : { tone: 'bad', emotion: 'cry' });
          changeMoney(tx, c, amount, 'reversal', win ? { tone: 'treasure', emotion: 'joy' } : { tone: 'bad', emotion: 'cry' });
          addLog(tx, win ? `🏇 ${c.name}의 말이 1등! 배당 ${odds}배 +${won(amount)}` : `🏇 ${c.name}의 말이 꼴찌로 들어왔다… −${won(stake)}`, { tone: win ? 'money' : 'bad', charId: c.id, emotion: win ? 'joy' : 'cry' });
          return;
        }
      }
      result(tx, c, 'reversal', 'skip', 'skip', {}, { tone: 'neutral', emotion: 'neutral' });
      addLog(tx, `🍵 ${josa(c.name, '은/는')} 욕심을 버리고 차 한 잔을 마셨다`, { tone: 'info', charId: c.id });
    },
  },
});
