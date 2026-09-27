// 찬스 광장 (tile type `pass`, loop maps): triggers when a character passes it with steps left (the move pauses and
// resumes after the decision) or lands on it. One single prompt `passTile`:
//   wish      소원빌기 — pay the era-scaled offering, `wishChance` (base + luck × 운) → 운 +1 + money, `c.wishes` += 1
//             (the same counter as the temple wish → 산신령); disabled without the cash
//   buy       구입 — chains into the shop prompt (the listing drawn here: 2 cards + 1 item) for the same character;
//             disabled when nothing on display is affordable
//   jobChange 이직 — one eligible alternate job (like the job tile's 전직, `option.jobId`); kids eras / students /
//             soldiers / the jobless / no candidate → disabled with the reason
//   wishAll   모두를 위한 소원 — a (cheaper) offering; every other unfinished character gets a small gift, own 운 +1
//             guaranteed, no money prize; counts as a wish
//   pass      그냥 지나가기 (default) — grants the buff rolled when the prompt opened (`option.buff`, balance
//             `chanceBuffs`: 월급 두 배 / 행운 주머니 / 액땜 / 성장 버프) → `character.chanceBuff` until the next 찬스 광장
// Reaching a 찬스 광장 first clears the character's current buff (`chanceBuff {action: 'expired'}`), then the prompt
// always opens (passing is a real choice). Option fields for the CPU / UI: wish / wishAll {cost, price, chance?, money?,
// gift?}, buy {price (cheapest), offers}, jobChange {jobId, salary, requires}, pass {buff}.
import { addLog, addStats, changeMoney, charById, emit, josa, round5, statName, won } from './effects.js';
import { openPrompt, registerPrompts } from './prompts.js';
import { cardDef, itemDef, shopOffers, shopPrice } from './cards.js';
import { PART_TIME_ID, hire, inJobEra, jobDef, offerCandidates } from './jobs.js';

export const PASS_OPTIONS = ['wish', 'wishAll', 'buy', 'jobChange', 'pass'];
/** 「그냥 지나가기」 buffs (balance.chanceBuffs ids). */
export const CHANCE_BUFFS = ['salaryX2', 'moneyX15', 'lossShield', 'statUp'];

const cfgOf = (data) => data.balance.passTile ?? {};
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const pct = (p) => Math.round(p * 100);
const scaleOf = (data, era) => cfgOf(data).scale?.[era] ?? data.balance.submaps?.scale?.[era] ?? 1;

/** 찬스 광장 wish chance: base + luck × 운, clamped. */
export function passWishChance(c, data) {
  const w = cfgOf(data).wish ?? {};
  return clamp((w.base ?? 0.3) + (w.luck ?? 0.03) * (c.stats?.luck ?? 0), w.min ?? 0.1, w.max ?? 0.7);
}

/** Why a character cannot change jobs now (Korean), or null. */
function jobChangeBlock(tx, c) {
  if (!inJobEra(tx.data, c)) return '아직 학생이라 이직은 못 해요';
  if (c.military?.status === 'serving') return '복무 중에는 이직할 수 없어요';
  if (c.school) return '대학생이라 졸업부터 해야 해요';
  if (!c.job) return '지금은 직업이 없어요';
  return null;
}

/** The 「그냥 지나가기」 buff of this visit: a seeded weighted pick of `balance.chanceBuffs` → {id, name, icon, desc}. */
function rollBuff(tx) {
  const list = (tx.data.balance.chanceBuffs ?? []).filter((b) => (b.weight ?? 1) > 0);
  if (!list.length) return null;
  const b = tx.rng.weighted(list);
  return { id: b.id, name: b.name, icon: b.icon, desc: b.desc };
}

/** A 찬스 광장 is reached: the current buff ends (before the new prompt opens). */
export function expireBuff(tx, c) {
  const buff = c.chanceBuff;
  if (!buff) return null;
  c.chanceBuff = null;
  emit(tx, 'chanceBuff', { charId: c.id, buff, action: 'expired', tone: 'neutral', emotion: 'neutral' });
  return buff;
}

/**
 * The prompt spec of a 찬스 광장 for `c` (options + context). Draws the shop listing, the job candidate and the pass
 * buff (seeded), so call it once per visit.
 */
export function passTileSpec(tx, c, tile = null) {
  const cfg = cfgOf(tx.data);
  const scale = scaleOf(tx.data, c.era);
  const cash = Math.max(0, c.money ?? 0);
  const options = [];

  // 소원빌기
  const offering = round5((cfg.wish?.offering ?? 10) * scale);
  const wishMoney = round5((cfg.wish?.money ?? 20) * scale);
  const chance = passWishChance(c, tx.data);
  const wish = {
    id: 'wish',
    label: '🙏 나를 위한 소원',
    icon: '🙏',
    desc: `시주 ${won(offering)} · 이뤄질 확률 약 ${pct(chance)}% → 운 +${cfg.wish?.luckGain ?? 1} · ${won(wishMoney)}`,
    cost: offering,
    price: offering,
    chance,
    money: wishMoney,
  };
  if (offering > cash) Object.assign(wish, { disabled: true, desc: `${wish.desc} · 시주할 돈이 부족해요` });
  options.push(wish);

  // 모두를 위한 소원 (every other unfinished character gets a small gift; 운 +1 guaranteed; counts as a wish)
  const allOffering = round5((cfg.wishAll?.offering ?? 5) * scale);
  const gift = round5((cfg.wishAll?.gift ?? 5) * scale);
  const others = tx.room.characters.filter((x) => x.id !== c.id && !x.finished).length;
  const wishAll = {
    id: 'wishAll',
    label: '🙏 모두를 위한 소원',
    icon: '🙏',
    desc: `시주 ${won(allOffering)} · 다른 ${others}명에게 ${won(gift)}씩 선물 · 내 ${statName(tx.data, 'luck')} +${cfg.wishAll?.luckGain ?? 1} (반드시)`,
    cost: allOffering,
    price: allOffering,
    gift,
    others,
  };
  if (allOffering > cash) Object.assign(wishAll, { disabled: true, desc: `${wishAll.desc} · 시주할 돈이 부족해요` });
  options.push(wishAll);

  // 구입 (the shop listing is drawn now and handed to the chained shop prompt)
  const offers = shopOffers(tx, c).map((o) => {
    const def = o.kind === 'card' ? cardDef(tx.data, o.id) : itemDef(tx.data, o.id);
    return { ...o, name: def?.name ?? o.id, icon: def?.icon ?? '', basePrice: def?.price ?? 0, price: shopPrice(tx, c, def?.price ?? 0) };
  });
  const affordable = offers.filter((o) => o.price <= cash);
  const listing = offers.map((o) => `${o.icon}${o.name}`).join(' · ');
  const buy = {
    id: 'buy',
    label: '🛍️ 구입',
    icon: '🛍️',
    desc: offers.length ? `진열: ${listing} (${won(Math.min(...offers.map((o) => o.price)))}부터)` : '진열된 물건이 없어요',
    price: affordable.length ? Math.min(...affordable.map((o) => o.price)) : offers.length ? Math.min(...offers.map((o) => o.price)) : 0,
    offers: offers.map(({ kind, id, price, basePrice }) => ({ kind, id, price, basePrice })),
  };
  if (!affordable.length) Object.assign(buy, { disabled: true, desc: offers.length ? `${buy.desc} · 살 수 있는 물건이 없어요 (돈이 부족해요)` : buy.desc });
  options.push(buy);

  // 이직
  const block = jobChangeBlock(tx, c);
  const [cand] = block ? [] : offerCandidates(tx, c, { exclude: [c.job.id], count: 1 });
  if (cand) {
    const nd = jobDef(tx.data, cand);
    const first = nd.ranks[0];
    options.push({
      id: 'jobChange',
      jobId: cand,
      label: `🔄 이직: ${nd.name}`,
      icon: nd.icon,
      desc: `${c.job.id === PART_TIME_ID ? '정규직 도전! ' : ''}${first.name}부터 새 출발 · 첫 월급 ${won(first.salary)}`,
      salary: first.salary,
      requires: structuredClone(nd.requires ?? {}),
    });
  } else options.push({ id: 'jobChange', label: '🔄 이직', icon: '🔄', desc: block ?? '옮길 만한 직업이 없어요', disabled: true });

  // 그냥 지나가기 → the buff rolled now (shown before choosing)
  const buff = rollBuff(tx);
  options.push({
    id: 'pass',
    label: '🚶 그냥 지나가기',
    icon: '🚶',
    desc: buff ? `${buff.icon} ${buff.name}: ${buff.desc} (다음 찬스 광장까지)` : '아무 일도 없이 지나가요',
    ...(buff ? { buff } : {}),
  });
  return {
    forCharacterIds: [c.id],
    title: '🎪 찬스 광장',
    text: `${josa(c.name, '이/가')} 찬스 광장에 들어섰다! 무엇을 할까?`,
    options,
    defaultOptionId: 'pass',
    context: { tileId: tile?.id ?? null, offering, wishMoney, chance, allOffering, gift, offers, candidate: cand ?? null, buff },
  };
}

/** Reach a 찬스 광장 (passing with steps left or landing on it): the old buff ends, the prompt opens. */
export function enterPassTile(tx, c, tile) {
  expireBuff(tx, c);
  return openPrompt(tx, 'passTile', c, { spec: passTileSpec(tx, c, tile) });
}

/** Landing exactly on a 찬스 광장: the same prompt (no resume). @returns true (a prompt opened) */
export function resolvePassTile(tx, c, tile) {
  enterPassTile(tx, c, tile);
  return true;
}

registerPrompts({
  passTile: {
    resultCutin: true, // promptResolved {result: wishOk|wishFail|wishAll|buy|changed|passed}
    build(tx, c, { spec } = {}) {
      return spec ?? passTileSpec(tx, c);
    },
    resolve(tx, p) {
      const c = charById(tx.room, p.charId);
      const answer = p.answers[c.id];
      const ctx = p.context ?? {};
      if (answer === 'wish') {
        const cfg = cfgOf(tx.data);
        const offering = Math.min(ctx.offering ?? 0, Math.max(0, c.money ?? 0));
        const chance = passWishChance(c, tx.data);
        const ok = tx.rng.next() < chance;
        if (offering) changeMoney(tx, c, -offering, 'passWish', { tone: 'neutral', emotion: 'neutral' });
        if (!ok) {
          addLog(tx, `🙏 ${c.name}, 찬스 광장에서 소원을 빌었지만 이번엔 꽝…`, { tone: 'info', charId: c.id, emotion: 'sweat' });
          return { result: 'wishFail', amount: -offering, chance, wishes: c.wishes ?? 0 };
        }
        c.wishes = (c.wishes ?? 0) + 1;
        changeMoney(tx, c, ctx.wishMoney ?? 0, 'passWish', { tone: 'good', emotion: 'joy' });
        const gain = cfg.wish?.luckGain ?? 1;
        addStats(tx, c, { luck: gain }, 'passWish');
        addLog(tx, `🌠 ${c.name}의 소원이 이루어졌다! +${won(ctx.wishMoney ?? 0)} · ${statName(tx.data, 'luck')} +${gain} (소원 성취 ${c.wishes}번)`, { tone: 'good', charId: c.id, emotion: 'joy' });
        return { result: 'wishOk', amount: (ctx.wishMoney ?? 0) - offering, chance, wishes: c.wishes, stat: 'luck' };
      }
      if (answer === 'wishAll') {
        const cfg = cfgOf(tx.data);
        const offering = Math.min(ctx.allOffering ?? 0, Math.max(0, c.money ?? 0));
        if (offering) changeMoney(tx, c, -offering, 'passWish', { tone: 'neutral', emotion: 'neutral' });
        const others = tx.room.characters.filter((x) => x.id !== c.id && !x.finished);
        for (const o of others) if (ctx.gift > 0) changeMoney(tx, o, ctx.gift, 'wishGift', { from: c.id, tone: 'love', emotion: 'joy' });
        c.wishes = (c.wishes ?? 0) + 1;
        addStats(tx, c, { luck: cfg.wishAll?.luckGain ?? 1 }, 'passWish');
        addLog(tx, `🙏 ${josa(c.name, '이/가')} 모두를 위해 소원을 빌었다! 다들 ${won(ctx.gift ?? 0)}씩 선물 · 운이 트인다 (소원 ${c.wishes}번)`, { tone: 'good', charId: c.id, emotion: 'joy' });
        return { result: 'wishAll', amount: -offering, gift: ctx.gift ?? 0, others: others.length, wishes: c.wishes, stat: 'luck' };
      }
      if (answer === 'buy') {
        openPrompt(tx, 'shop', c, { offers: ctx.offers });
        return { result: 'buy' };
      }
      if (answer === 'jobChange' && ctx.candidate && jobDef(tx.data, ctx.candidate)) {
        hire(tx, c, ctx.candidate, 'change');
        return { result: 'changed', jobId: ctx.candidate };
      }
      const buff = ctx.buff;
      if (buff) {
        c.chanceBuff = { ...buff, since: tx.room.turn?.turnNo ?? 0 };
        emit(tx, 'chanceBuff', { charId: c.id, buff: { ...buff }, action: 'gained', tone: 'good', emotion: 'joy' });
        addLog(tx, `${buff.icon} ${c.name}: 「${buff.name}」 버프! ${buff.desc} (다음 찬스 광장까지)`, { tone: 'good', charId: c.id, emotion: 'joy' });
      }
      return { result: 'passed', ...(buff ? { buff: buff.id } : {}) };
    },
  },
});
