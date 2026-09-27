// Stage 8 — real estate (houses.json): the `house` tile prompt (2–3 listings, 청약, 럭키 제주 별장), 1인 1채 with a
// trade-in (보상판매 value × tradeIn), 매물당 1명 (capacity), and the 노년 시세 event. Pure helpers over a tx.
//
// character.house = {id, price, value, boughtTurn} | null · character.houseSwaps (buys while owning a house)
// room.houseOwners = {houseId: [charId]} (derived, kept in sync) · room.housingMarket = {eraId, mult} | null
import { addLog, changeMoney, charById, emit, josa, round5, won } from './effects.js';
import { effectsFor, newsEffects } from './news.js';
import { openPrompt, registerPrompts } from './prompts.js';
import { ensureFamily } from './family.js';

export const HOUSE_IDS = ['oneroom', 'villa', 'apartment', 'hanok', 'penthouse', 'jeju_villa'];

const cfgOf = (data) => data.houses ?? {};
export const houseDefs = (data) => cfgOf(data).houses ?? [];
export const houseDef = (data, id) => houseDefs(data).find((h) => h.id === id) ?? null;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/** {houseId: [charId]} from the characters' houses. */
export function houseOwners(room) {
  const out = {};
  for (const c of room.characters ?? []) {
    if (!c.house?.id) continue;
    (out[c.house.id] ??= []).push(c.id);
  }
  return out;
}

export function syncHouseOwners(room) {
  room.houseOwners = houseOwners(room);
  return room.houseOwners;
}

/** Can `c` buy `def` (capacity: others holding it; its own current house does not count)? */
export function houseAvailable(room, def, c = null) {
  if (def.capacity == null) return true;
  const holders = (houseOwners(room)[def.id] ?? []).filter((id) => id !== c?.id);
  return holders.length < def.capacity;
}

/**
 * Price multiplier now for a character: the drawn 노년 시세 once it exists (it already includes that era's news),
 * else the news `housePriceMult` of the character's era.
 */
export function priceMult(tx, c) {
  const m = tx.room.housingMarket;
  if (m && m.eraId === c.era) return m.mult;
  return effectsFor(tx, c).housePriceMult ?? 1;
}

/** Trade-in credit of the character's current house (보상판매). */
export const tradeInValue = (data, c) => (c?.house ? round5(c.house.value * (cfgOf(data).tradeIn ?? 0.7)) : 0);

/** Value of a character's house for the ranking. */
export const houseValue = (c) => c?.house?.value ?? 0;

/**
 * Listings for the house tile: up to `listings` distinct available houses of the era (not the one owned), seeded;
 * a lucky roll (money route `luckyChance.money`, elsewhere `.other`, + luck × perLuck) adds the 제주 별장.
 */
export function houseListings(tx, c, { route = null } = {}) {
  const cfg = cfgOf(tx.data);
  const room = tx.room;
  const pool = houseDefs(tx.data).filter((d) => !d.lucky && (!d.eras || d.eras.includes(c.era)) && d.id !== c.house?.id && houseAvailable(room, d, c));
  const n = Math.min(cfg.listings ?? 3, pool.length);
  const picks = [];
  const left = [...pool];
  while (picks.length < n) {
    const d = tx.rng.pick(left);
    left.splice(left.indexOf(d), 1);
    picks.push(d);
  }
  const lc = cfg.luckyChance ?? {};
  const luckyP = (route === 'money' ? lc.money ?? 0 : lc.other ?? 0) + (lc.perLuck ?? 0) * (c.stats?.luck ?? 0);
  const lucky = houseDefs(tx.data).find((d) => d.lucky && d.id !== c.house?.id && houseAvailable(room, d, c));
  if (lucky && tx.rng.next() < luckyP) {
    if (picks.length >= (cfg.listings ?? 3)) picks.pop();
    picks.push(lucky);
  }
  const sub = cfg.subscription ?? {};
  const won_ = picks.some((d) => d.id === sub.houseId) && tx.rng.next() < (sub.chance ?? 0);
  const mult = priceMult(tx, c);
  return picks
    .map((d) => {
      const basePrice = round5(d.price * mult);
      const value = round5(d.value * mult);
      const subscription = won_ && d.id === sub.houseId;
      const price = subscription ? round5(basePrice * (1 - (sub.discount ?? 0))) : basePrice;
      return { houseId: d.id, price, basePrice, value, subscription, lucky: !!d.lucky };
    })
    .sort((a, b) => a.price - b.price);
}

/** House tile → house prompt (job eras only; kids only look around). @returns true when a prompt opened */
export function resolveHouseTile(tx, c, tile) {
  ensureFamily(c);
  const eras = [...new Set(houseDefs(tx.data).flatMap((d) => d.eras ?? []))];
  if (eras.length && !eras.includes(c.era)) {
    addLog(tx, `🏠 ${c.name}: 모델하우스 구경만 했다`, { tone: 'money', charId: c.id });
    return false;
  }
  const listings = houseListings(tx, c, { route: tile?.route ?? null });
  if (!listings.length) {
    addLog(tx, `🏠 ${c.name}: 나온 매물이 없다…`, { tone: 'info', charId: c.id });
    return false;
  }
  openPrompt(tx, 'house', c, { listings });
  return true;
}

function listingOption(tx, c, l) {
  const def = houseDef(tx.data, l.houseId);
  const tradeIn = tradeInValue(tx.data, c);
  const cost = Math.max(0, l.price - tradeIn);
  const extras = [];
  if (l.subscription) extras.push(`🎉 청약 당첨! ${won(l.basePrice)} → ${won(l.price)}`);
  if (l.lucky) extras.push('✨ 골드 매물');
  if (tradeIn) extras.push(`지금 집 보상판매 ${won(tradeIn)}`);
  extras.push(`자산가치 ${won(l.value)}`);
  const opt = {
    id: `buy:${l.houseId}`,
    houseId: l.houseId,
    label: `${def.icon} ${def.name} ${won(l.price)}`,
    icon: def.icon,
    price: l.price,
    basePrice: l.basePrice,
    value: l.value,
    tradeIn,
    cost,
    subscription: l.subscription,
    lucky: l.lucky,
    capacity: def.capacity ?? null,
    desc: extras.join(' · '),
  };
  if (cost > (c.money ?? 0)) Object.assign(opt, { disabled: true, desc: `${opt.desc} · 현금 ${won(cost)} 필요` });
  return opt;
}

/** Buy a house (trade-in of the current one). Emits `houseBought` (+ `houseSold`) and ONE net moneyChanged. */
export function buyHouse(tx, c, l) {
  const def = houseDef(tx.data, l.houseId);
  const room = tx.room;
  const old = c.house;
  const tradeIn = tradeInValue(tx.data, c);
  const cost = Math.max(0, l.price - tradeIn);
  c.house = { id: def.id, price: l.price, value: l.value, boughtTurn: room.turn?.turnNo ?? 0 };
  if (old) c.houseSwaps = (c.houseSwaps ?? 0) + 1;
  syncHouseOwners(room);
  emit(tx, 'houseBought', {
    charId: c.id,
    houseId: def.id,
    price: l.price,
    basePrice: l.basePrice,
    value: l.value,
    tradeIn,
    subscription: !!l.subscription,
    lucky: !!l.lucky,
    swap: !!old,
    fromHouseId: old?.id ?? null,
    tone: 'treasure',
    emotion: 'joy',
  });
  if (old) {
    const odef = houseDef(tx.data, old.id);
    emit(tx, 'houseSold', { charId: c.id, houseId: old.id, value: old.value, amount: tradeIn, tone: 'treasure', emotion: 'neutral' });
    addLog(tx, `🔁 ${c.name}: ${odef?.name ?? old.id} 보상판매 ${won(tradeIn)}`, { tone: 'money', charId: c.id });
  }
  const extra = l.subscription ? ' (청약 당첨!)' : l.lucky ? ' (골드 매물!)' : '';
  addLog(tx, `${def.icon} ${josa(c.name, '이/가')} ${josa(def.name, '을/를')} ${won(l.price)}에 샀다!${extra}`, { tone: 'money', charId: c.id, emotion: 'joy' });
  if (cost) changeMoney(tx, c, -cost, 'house', { houseId: def.id, tradeIn, tone: 'treasure', emotion: 'joy' });
  return c.house;
}

// ---------- 노년 시세 ----------

/**
 * First character entering the market era (senior): draw the market multiplier (min..max × that era's news
 * housePriceMult, clamped) → every owned house's value × mult. Emits `houseValueChanged {mult, eraId, changes}`.
 */
export function drawHousingMarket(tx, eraId) {
  const room = tx.room;
  const m = cfgOf(tx.data).market ?? {};
  if (room.housingMarket || eraId !== (m.era ?? 'senior')) return null;
  const lo = m.min ?? 0.8;
  const hi = m.max ?? 1.5;
  const raw = tx.rng.int(Math.round(lo * 100), Math.round(hi * 100)) / 100;
  const news = newsEffects(room, eraId, tx.data).housePriceMult ?? 1;
  const mult = Math.round(clamp(raw * news, lo, hi) * 100) / 100;
  room.housingMarket = { eraId, mult };
  const changes = [];
  for (const c of room.characters) {
    if (!c.house) continue;
    const before = c.house.value;
    c.house.value = round5(before * mult);
    changes.push({ charId: c.id, houseId: c.house.id, before, after: c.house.value });
  }
  const up = mult >= 1;
  emit(tx, 'houseValueChanged', { eraId, mult, changes, reason: 'market', tone: up ? 'treasure' : 'bad', emotion: up ? 'joy' : 'shock' });
  const pct = Math.round((mult - 1) * 100);
  addLog(tx, `📈 부동산 시세 발표! 집값 ${pct >= 0 ? '+' : ''}${pct}% (×${mult})${changes.length ? ` · 집주인 ${changes.length}명` : ''}`, { tone: up ? 'money' : 'bad' });
  return room.housingMarket;
}

registerPrompts({
  /** 부동산 칸: buy one listing (swap = trade in the current house) or pass. */
  house: {
    resultCutin: 'auto',
    build(tx, c, { listings }) {
      const options = listings.map((l) => listingOption(tx, c, l));
      options.push({ id: 'pass', label: '🙅 다음에 살게요', icon: '🙅', desc: c.house ? `지금 집(${houseDef(tx.data, c.house.id)?.name}) 그대로` : '아직은 월세살이로' });
      const cur = c.house ? houseDef(tx.data, c.house.id) : null;
      return {
        forCharacterIds: [c.id],
        title: '🏠 부동산 매물',
        text: cur
          ? `${josa(c.name, '은/는')} 지금 ${cur.name}에 살아요. 갈아탈까요? (1인 1채 · 지금 집은 ${won(tradeInValue(tx.data, c))}에 보상판매)`
          : `${josa(c.name, '이/가')} 부동산에 들렀다! 내 집 마련할까요? (1인 1채)`,
        options,
        defaultOptionId: 'pass',
        context: { listings },
      };
    },
    resolve(tx, p) {
      const c = charById(tx.room, p.charId);
      const answer = p.answers[c.id];
      const l = (p.context?.listings ?? []).find((x) => `buy:${x.houseId}` === answer);
      if (!l) {
        addLog(tx, `🙅 ${josa(c.name, '은/는')} 이번엔 집을 사지 않았다`, { tone: 'info', charId: c.id });
        return { result: 'pass' };
      }
      const def = houseDef(tx.data, l.houseId);
      const cost = Math.max(0, l.price - tradeInValue(tx.data, c));
      if (!def || !houseAvailable(tx.room, def, c) || cost > (c.money ?? 0)) {
        addLog(tx, `😅 ${c.name}: 계약 직전에 틀어졌다… (돈이 부족하거나 이미 팔린 매물)`, { tone: 'bad', charId: c.id, emotion: 'sweat' });
        return { result: 'noMoney' };
      }
      buyHouse(tx, c, l);
      return { result: 'bought', houseId: l.houseId };
    },
  },
});
