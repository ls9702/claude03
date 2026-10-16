// 노년 역전 (Senior race comeback) — the final era's goal race gets real decisions and rewards what a character
// collected in the earlier eras. Pure helpers over a tx (balance.json `senior`, items.json `senior`).
//
//   🏝️ 한방역전섬 (`island` tile, one per race at ~`finalTrack.island.at` of the track): passing it stops the move like a
//     찬스 광장 (`turn.move` resumes after the prompt, so the race does not get longer). Prompt `island`: three stake tiers
//     (`bet:all` 💥 인생 한 방 = all cash · 1 number · ×8 · a miss = 쪽박 → 빈곤 농장 / `bet:half` 🔥 반반 승부 = half · 3
//     numbers · ×3 / `bet:little` 🪙 소소한 재미 = 10 % · 5 numbers · ×1.8), 🏖️ 조기 은퇴 or 🍵 지나가기 (default). A bet
//     chains `islandPick` (pick the first of the covered numbers 1–10; 🍀 lucky items cover one more) → a plain random
//     roll → `islandResult {charId, tier, stake, pick, covers, numbers, lucky, roll, mult, win, amount, result:
//     jackpot|win|lose|bust}` (+ moneyChanged reason `island`, a bust → finished retired 'bust'); retire →
//     `islandResult {result: 'retire', place, prize}` + finished retired 'early'.
//   🏆 노년 대회 (`contest`): a theme (노래자랑 / 바둑 / 게이트볼 / 경품 추첨 / 드라이브 랠리 → a stat; an item of that theme
//     = +itemBonus win chance) and two entry tiers (`join:small` / `join:big`) or `watch` → `contestResult {charId, themeId,
//     tier, stat, statValue, itemId, chance, place 1|2|null, fee, prize}` (+ moneyChanged reason `contest`).
//   🔨 골동품 경매 (`auction`): sell one item (`sell:item:<id>`, its ranking value × the 명품 premium), one treasure
//     (`sell:treasure:<uid>`, the hidden appraisal) or 잡동사니 (`sell:junk`, the default) → hammer roulette 1–10 →
//     `auctionResult {charId, kind: item|treasure|junk, itemId?, treasureId?, uid?, fake?, base, premium?, roll, mult,
//     amount}` (+ moneyChanged reason `auction`); `leave` = promptResolved.
//   Item 노년 활용 (final race only, `seniorItem {charId, itemId, use, amount?, saved?, tileId?, healed?}` chips):
//     dodge (경차 / 킥보드: a stop on a 지출 tile drives one tile on), health (헬스 회원권 / 사스마타: 지출 × lossMult), guard
//     (갑옷: one 지출 blocked), pension (안마의자 / 목욕탕 회수권: + amount every payday, heals an injury), busking (기타: 매력
//     × perCharm every payday), royalty (노트북 / 책: 지력 × perInt at the goal / early retirement), lucky (복고양이 /
//     네잎클로버: +numbers at the island), premium (명품 가방 / 포셰트: × auctionMult when auctioned).
//   `room.seniorStart = {ranks {charId: rank}, totals {charId: total}, n, turnNo}` (engine-only) = the visible standing
//     right after the transition into the final race (comebacks: result.js).
import { addLog, changeMoney, charById, emit, josa, particle, round5, statName, won } from './effects.js';
import { openPrompt, registerPrompts } from './prompts.js';
import { itemDef, syncInjuryCard } from './cards.js';
import { FINISH_HOOKS, finishCharacter, nextPlace } from './finish.js';
import { treasureDef } from './treasures.js';
import { effectsFor } from './news.js';
import { computeRanking } from './result.js';
import { nextPosition } from './board.js';

export const SENIOR_TILE_TYPES = ['island', 'contest', 'auction'];
export const SENIOR_USES = ['dodge', 'royalty', 'health', 'premium', 'lucky', 'pension', 'guard', 'busking'];

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const pct = (p) => Math.round(p * 100);
const r2 = (x) => Math.round(x * 100) / 100;

export const seniorCfg = (data) => data?.balance?.senior ?? {};

/** Is the character on the final era's goal race? */
export function inFinalRace(room, c) {
  const era = room?.board?.eras?.[c?.position?.eraIndex ?? room?.eraIndex ?? 0];
  return !!era?.final;
}

/** The character's items that have a senior use: [{id, def, senior}] (inventory order). */
export function seniorItems(data, c) {
  return (c?.items ?? []).map((id) => ({ id, def: itemDef(data, id) })).filter((x) => x.def?.senior?.use).map((x) => ({ ...x, senior: x.def.senior }));
}

/** The first item of a senior use, or null. */
export const itemWithUse = (data, c, use) => seniorItems(data, c).find((x) => x.senior.use === use) ?? null;

/** Extra 한방역전섬 numbers from 🍀 lucky items. */
export function luckyNumbers(data, c) {
  return seniorItems(data, c).filter((x) => x.senior.use === 'lucky').reduce((s, x) => s + (x.senior.numbers ?? 1), 0);
}

/** CPU handicap on gains (cpuHandicap via news.effectsFor). */
const incomeMultOf = (tx, c) => effectsFor(tx, c).incomeMult ?? 1;

function itemEvent(tx, c, item, use, extra = {}, { tone = 'good', emotion = 'joy' } = {}) {
  return emit(tx, 'seniorItem', { charId: c.id, itemId: item.id, use, ...extra, tone, emotion });
}

// ---------- standing (comebacks) ----------

/** The visible standing (no hidden treasure values): {ranks, totals, n, rank, gap (to the best other), leader}. */
export function standing(room, data, c = null) {
  const rows = computeRanking(room, { data, reveal: false });
  const ranks = Object.fromEntries(rows.map((r) => [r.charId, r.rank]));
  const totals = Object.fromEntries(rows.map((r) => [r.charId, r.total]));
  const out = { ranks, totals, n: rows.length };
  if (c) {
    const others = rows.filter((r) => r.charId !== c.id);
    const best = others.length ? Math.max(...others.map((r) => r.total)) : totals[c.id];
    Object.assign(out, { rank: ranks[c.id], gap: best - (totals[c.id] ?? 0) });
  }
  return out;
}

/** Remember the standing at the transition into the final race (`room.seniorStart`). */
export function recordSeniorStart(tx) {
  const s = standing(tx.room, tx.data);
  tx.room.seniorStart = { ranks: s.ranks, totals: s.totals, n: s.n, turnNo: tx.room.turn?.turnNo ?? 0 };
}

// ---------- ⏰ 노년 마감 (the final race's round cap) ----------

/** Rounds the final race lasts at most: clamp(ceil(length × perTile), min, max) (balance.senior.race). */
export function raceRoundsFor(data, length) {
  const cfg = seniorCfg(data).race ?? {};
  const n = Math.ceil((Number(length) || 0) * (cfg.perTile ?? 0.3));
  return Math.max(cfg.min ?? 8, Math.min(cfg.max ?? 30, n));
}

/** Start the final race's clock (`turn.raceRound` 1 / `turn.raceRounds`) — at the transition into the final era. */
export function startRaceClock(tx) {
  const era = tx.room.board?.eras?.[tx.room.eraIndex ?? 0];
  if (!era?.final) return;
  Object.assign(tx.room.turn, { raceRound: 1, raceRounds: raceRoundsFor(tx.data, era.tiles?.length ?? 0) });
}

/**
 * A full round of the final race ended (the turn order wrapped): tick the clock. Past the last round, everyone still on
 * the track retires (⏰ 노년 마감: the next free places by progress, the furthest first; prize × retirePrizeMult like a 조기
 * 은퇴, no bonus spins). An older save in the race without a clock starts one now. @returns true when the race closed
 */
export function tickRaceClock(tx) {
  const turn = tx.room.turn;
  if (!Number.isInteger(turn.raceRounds)) {
    startRaceClock(tx);
    return false;
  }
  if ((turn.raceRound ?? 1) < turn.raceRounds) {
    turn.raceRound = (turn.raceRound ?? 1) + 1;
    return false;
  }
  const left = tx.room.characters.filter((x) => !x.finished);
  if (!left.length) return true;
  const order = turn.order ?? [];
  left.sort((a, b) => (b.position?.index ?? 0) - (a.position?.index ?? 0) || order.indexOf(a.id) - order.indexOf(b.id));
  addLog(tx, `⏰ 노년 마감! 노년 ${turn.raceRounds}턴이 모두 지났어요 — 아직 골인 못 한 ${left.map((x) => x.name).join('·')}${particle(left.at(-1).name, '은/는')} 여기서 은퇴해요`, { tone: 'info' });
  for (const c of left) finishCharacter(tx, c, { retired: 'late' });
  return true;
}

// ---------- item senior uses (passive, visible) ----------

/** 🚗 dodge: the final race, a stop on a 지출 tile with a dodge item → drive one tile on. @returns true → walk 1 more */
export function seniorDodge(tx, c, tile) {
  if (tile?.type !== 'loss' || !inFinalRace(tx.room, c)) return false;
  const item = itemWithUse(tx.data, c, 'dodge');
  if (!item) return false;
  if (!nextPosition(tx.room.board, c.position, c.route)) return false;
  itemEvent(tx, c, item, 'dodge', { tileId: tile.id });
  addLog(tx, `${item.def.icon} ${josa(c.name, '이/가')} ${josa(item.def.name, '으로/로')} 쌩— 「${tile.label}」 칸을 지나쳤다!`, { tone: 'good', charId: c.id, emotion: 'joy' });
  return true;
}

/**
 * A 지출 tile's loss in the final race: 🛡️ guard blocks one (once per game), 💪 health multiplies it. Emits the item
 * chip; @returns the amount still to pay.
 */
export function seniorLoss(tx, c, amount) {
  if (!(amount > 0) || !inFinalRace(tx.room, c)) return amount;
  const guard = itemWithUse(tx.data, c, 'guard');
  if (guard && !c.seniorUsed?.guard) {
    c.seniorUsed = { ...(c.seniorUsed ?? {}), guard: true };
    itemEvent(tx, c, guard, 'guard', { saved: amount });
    addLog(tx, `${guard.def.icon} ${c.name}: ${guard.def.name} 덕분에 지출 ${won(amount)}을 막았다!`, { tone: 'good', charId: c.id, emotion: 'joy' });
    return 0;
  }
  const health = itemWithUse(tx.data, c, 'health');
  if (health) {
    const after = round5(amount * (health.senior.lossMult ?? 0.5));
    if (after < amount) {
      itemEvent(tx, c, health, 'health', { saved: amount - after });
      addLog(tx, `${health.def.icon} ${c.name}: ${health.def.name} 덕분에 건강 체질! 지출 ${won(amount)} → ${won(after)}`, { tone: 'good', charId: c.id, emotion: 'joy' });
      return after;
    }
  }
  return amount;
}

/** Payday in the final race: ♨️ pension (+ amount, heals an injury) / 🎸 busking (매력 × perCharm). */
export function seniorPayday(tx, c) {
  if (!inFinalRace(tx.room, c)) return 0;
  let total = 0;
  for (const item of seniorItems(tx.data, c)) {
    const s = item.senior;
    let amount = 0;
    if (s.use === 'pension') amount = s.amount ?? 40;
    else if (s.use === 'busking') amount = (c.stats?.charm ?? 0) * (s.perCharm ?? 6);
    else continue;
    amount = round5(amount * incomeMultOf(tx, c));
    const healed = s.use === 'pension' && s.heal && c.job?.injured > 0;
    if (healed) {
      c.job.injured = 0;
      syncInjuryCard(tx, c);
    }
    if (!(amount > 0) && !healed) continue;
    itemEvent(tx, c, item, s.use, { amount, ...(healed ? { healed: true } : {}) });
    if (amount > 0) changeMoney(tx, c, amount, 'seniorItem', { itemId: item.id, tone: 'good', emotion: 'joy' });
    addLog(
      tx,
      s.use === 'pension'
        ? `${item.def.icon} ${c.name}: ${item.def.name} 건강 보너스 +${won(amount)}${healed ? ' · 부상도 다 나았다!' : ''}`
        : `${item.def.icon} ${c.name}의 노년 버스킹! ${item.def.name} 연주로 +${won(amount)}`,
      { tone: 'good', charId: c.id, emotion: 'joy' },
    );
    total += amount;
  }
  return total;
}

/** Finish hook: 📖 royalty (지력 × perInt) at the goal or an early retirement (never a bust). */
function seniorFinish(tx, c, { retired = null } = {}) {
  if (retired === 'bust') return;
  for (const item of seniorItems(tx.data, c).filter((x) => x.senior.use === 'royalty')) {
    const amount = round5((c.stats?.int ?? 0) * (item.senior.perInt ?? 15) * incomeMultOf(tx, c));
    if (!(amount > 0)) continue;
    itemEvent(tx, c, item, 'royalty', { amount });
    changeMoney(tx, c, amount, 'seniorItem', { itemId: item.id, tone: 'good', emotion: 'joy' });
    addLog(tx, `${item.def.icon} ${c.name}의 자서전 출간! ${item.def.name} 덕분에 인세 +${won(amount)} (${statName(tx.data, 'int')} ${c.stats?.int ?? 0})`, { tone: 'good', charId: c.id, emotion: 'joy' });
  }
}
FINISH_HOOKS.push(seniorFinish);

// ---------- 🏝️ 한방역전섬 ----------

/** Island stake tiers (balance.senior.island.tiers). */
export const islandTiers = (data) => seniorCfg(data).island?.tiers ?? [];

/** The stake of a tier for a cash amount (5만원 units; all-in = the whole cash). */
export function tierStake(tier, cash) {
  const c = Math.max(0, Math.floor(cash ?? 0));
  if ((tier.share ?? 1) >= 1) return c;
  return Math.min(c, Math.max(tier.min ?? 0, round5(c * tier.share)));
}

/** The numbers covered from `pick` (1–10, wrapping 10 → 1). */
export function coverSet(pick, numbers, { min = 1, max = 10 } = {}) {
  const span = max - min + 1;
  const n = clamp(Math.floor(numbers), 1, span);
  return Array.from({ length: n }, (_, i) => min + ((pick - min + i) % span));
}

/** Retirement now: {place, prize}. */
export function retireOffer(tx) {
  const place = nextPlace(tx.room);
  const bal = tx.data.balance;
  const prize = Math.round(((bal.goalPrizes?.[place - 1] ?? 0) * (bal.retirePrizeMult ?? 0.5)) / 5) * 5;
  return { place, prize };
}

/** The options of the 한방역전섬 for `c` (bet tiers, 조기 은퇴, 지나가기). */
export function islandOptions(tx, c) {
  const cfg = seniorCfg(tx.data).island ?? {};
  const cash = Math.max(0, c.money ?? 0);
  const lucky = luckyNumbers(tx.data, c);
  const { max } = tx.data.balance.spin;
  const options = islandTiers(tx.data).map((t) => {
    const stake = tierStake(t, cash);
    const numbers = Math.min(max - 1, (t.numbers ?? 1) + lucky);
    const chance = numbers / max;
    const win = round5(stake * t.mult);
    const opt = {
      id: `bet:${t.id}`,
      tier: t.id,
      label: `${t.icon} ${t.name}`,
      icon: t.icon,
      stake,
      cost: stake,
      price: stake,
      numbers,
      baseNumbers: t.numbers ?? 1,
      lucky,
      mult: t.mult,
      chance: r2(chance),
      ev: r2(chance * t.mult),
      win,
      bust: !!t.bust,
      desc: `${t.bust ? '현금 전부' : `현금 ${pct(t.share ?? 1)}%`} ${won(stake)} · 숫자 ${numbers}개${lucky ? ` (🍀 +${lucky})` : ''} 중 하나면 ×${t.mult} → ${won(win)} · ${t.bust ? '틀리면 쪽박 (빈곤 농장)' : '틀리면 건 돈만 잃어요'}`,
    };
    if (stake < (cfg.minStake ?? 10) || stake <= 0) Object.assign(opt, { disabled: true, desc: `걸 돈이 부족해요 (현금 ${won(cash)})` });
    return opt;
  });
  const { place, prize } = retireOffer(tx);
  options.push({ id: 'retire', label: '🏖️ 조기 은퇴', icon: '🏖️', place, prize, desc: `지금 ${place}등으로 인생 마무리 · 은퇴 상금 ${won(prize)} · 더는 룰렛을 돌리지 않아요` });
  options.push({ id: 'pass', label: '🍵 욕심 버리기', icon: '🍵', desc: '지금 가진 것에 만족하고 골인을 향해 가요' });
  return options;
}

/** Reach the 한방역전섬 (landing on it or passing it — the move resumes afterwards). @returns the pending prompt */
export function enterIsland(tx, c, tile) {
  return openPrompt(tx, 'island', c, { tile });
}

// ---------- 🏆 노년 대회 ----------

export const contestThemes = (data) => seniorCfg(data).contest?.themes ?? [];

/** The item of `c` that helps in a contest theme (items.json senior.theme), or null. */
export const themeItem = (data, c, themeId) => seniorItems(data, c).find((x) => x.senior.theme === themeId) ?? null;

/** Win chance in a theme: base + perStat × stat (+ itemBonus), clamped. */
export function contestChance(data, c, theme, { item = themeItem(data, c, theme.id) } = {}) {
  const cfg = seniorCfg(data).contest ?? {};
  const stat = c.stats?.[theme.stat] ?? 0;
  return clamp((cfg.base ?? 0.08) + (cfg.perStat ?? 0.05) * stat + (item ? (cfg.itemBonus ?? 0.25) : 0), cfg.min ?? 0.05, cfg.max ?? 0.85);
}

/** Draw a theme (game RNG): themes of the character's items weigh `ownThemeWeight`. */
function drawTheme(tx, c) {
  const cfg = seniorCfg(tx.data).contest ?? {};
  const themes = contestThemes(tx.data);
  if (!themes.length) return null;
  const own = new Set(seniorItems(tx.data, c).map((x) => x.senior.theme));
  return tx.rng.weighted(themes.map((t) => ({ ...t, weight: own.has(t.id) ? cfg.ownThemeWeight ?? 2 : 1 })));
}

// ---------- 🔨 골동품 경매 ----------

/** Hammer table (multiplier per roulette 1–10). */
export const hammerTable = (data) => seniorCfg(data).auction?.hammer ?? [0.5, 0.7, 1, 1, 1.2, 1.2, 1.5, 1.8, 2.2, 3];
export const hammerEv = (data) => {
  const h = hammerTable(data);
  return h.reduce((s, x) => s + x, 0) / h.length;
};

/** Auction value of an item: its ranking value (price × resale) × the 명품 premium of that item. */
export function itemAuctionBase(data, id) {
  const d = itemDef(data, id);
  if (!d) return 0;
  const premium = d.senior?.use === 'premium' ? d.senior.auctionMult ?? 1.5 : 1;
  return Math.floor(d.price * (d.resale ?? 0) * premium);
}

// ---------- tiles ----------

/** Resolve a senior tile (island / contest / auction). @returns true when a prompt opened */
export function resolveSeniorTile(tx, c, tile) {
  if (tile.type === 'island') {
    enterIsland(tx, c, tile);
    return true;
  }
  if (tile.type === 'contest') {
    if (!contestThemes(tx.data).length) return false;
    openPrompt(tx, 'contest', c, { tile });
    return true;
  }
  if (tile.type === 'auction') {
    openPrompt(tx, 'auction', c, { tile });
    return true;
  }
  return false;
}

// ---------- prompts ----------

registerPrompts({
  /** 🏝️ 한방역전섬: stake tier → islandPick, 조기 은퇴, or pass (promptResolved {result: 'pass'}, a banner). */
  island: {
    resultCutin: 'auto',
    build(tx, c) {
      const cfg = seniorCfg(tx.data).island ?? {};
      const st = standing(tx.room, tx.data, c);
      const cash = Math.max(0, c.money ?? 0);
      const where = `지금 ${st.rank}위`;
      return {
        forCharacterIds: [c.id],
        title: cfg.title ?? '🏝️ 한방역전섬',
        text: `${josa(c.name, '이/가')} 한방역전섬에 도착했다! ${where} — 인생 한 방을 노려 볼까?`,
        options: islandOptions(tx, c),
        defaultOptionId: 'pass',
        context: { cash, lucky: luckyNumbers(tx.data, c), rank: st.rank, n: st.n, gap: st.gap },
      };
    },
    resolve(tx, p) {
      const c = charById(tx.room, p.charId);
      const answer = p.answers[c.id];
      if (c.finished) return { result: 'pass' };
      const opt = p.options.find((o) => o.id === answer);
      if (opt?.tier && !opt.disabled) {
        const tier = islandTiers(tx.data).find((t) => t.id === opt.tier);
        const cash = Math.max(0, c.money ?? 0);
        const stake = tier ? tierStake(tier, cash) : 0;
        if (tier && stake >= (seniorCfg(tx.data).island?.minStake ?? 10)) {
          openPrompt(tx, 'islandPick', c, { tier, stake, lucky: luckyNumbers(tx.data, c) });
          return { result: 'bet', tier: tier.id };
        }
      }
      if (answer === 'retire') {
        const { place, prize } = retireOffer(tx);
        emit(tx, 'islandResult', { charId: c.id, result: 'retire', place, prize, tone: 'result', emotion: 'joy' });
        finishCharacter(tx, c, { retired: 'early' });
        return { result: 'retire' };
      }
      addLog(tx, `🍵 ${josa(c.name, '은/는')} 한방역전섬에서 차 한 잔만 마시고 떠났다`, { tone: 'info', charId: c.id });
      return { result: 'pass' };
    },
  },

  /** 🎯 행운의 숫자: pick the first covered number; a plain random roll decides 대박 / 쪽박. */
  islandPick: {
    build(tx, c, { tier, stake, lucky = 0 }) {
      const { min, max } = tx.data.balance.spin;
      const numbers = Math.min(max - min, (tier.numbers ?? 1) + lucky);
      const options = Array.from({ length: max - min + 1 }, (_, i) => {
        const n = min + i;
        const covers = coverSet(n, numbers, { min, max });
        return { id: String(n), number: n, covers, label: covers.join('·'), icon: '🎯', desc: `${covers.join('·')} 중 하나가 나오면 ×${tier.mult}` };
      });
      return {
        forCharacterIds: [c.id],
        title: `${tier.icon} ${tier.name}`,
        text: `${c.name}, 숫자를 골라요! 룰렛이 ${numbers > 1 ? `고른 숫자부터 ${numbers}칸 중 하나에` : '그 숫자에'} 멈추면 ×${tier.mult}${tier.bust ? ', 아니면 쪽박!' : '!'}`,
        options,
        defaultOptionId: String(min + ((tx.room.turn?.turnNo ?? 0) % (max - min + 1))),
        context: { tier: tier.id, name: tier.name, icon: tier.icon, stake, numbers, mult: tier.mult, bust: !!tier.bust, lucky },
      };
    },
    resolve(tx, p) {
      const c = charById(tx.room, p.charId);
      const ctx = p.context ?? {};
      const { min, max } = tx.data.balance.spin;
      const pick = clamp(Number(p.answers[c.id]) || min, min, max);
      const covers = coverSet(pick, ctx.numbers ?? 1, { min, max });
      const roll = tx.rng.int(min, max); // always a plain random roll (skill rooms too)
      const cash = Math.max(0, c.money ?? 0);
      const stake = ctx.bust ? cash : Math.min(ctx.stake ?? 0, cash);
      if (c.finished || stake <= 0) {
        addLog(tx, `🏝️ ${c.name}: 걸 돈이 없어서 한 방은 다음 기회에…`, { tone: 'info', charId: c.id });
        return;
      }
      const base = { charId: c.id, tier: ctx.tier, stake, pick, covers, numbers: covers.length, lucky: ctx.lucky ?? 0, roll, mult: ctx.mult };
      if (covers.includes(roll)) {
        const amount = round5(stake * (ctx.mult - 1));
        const jackpot = !!ctx.bust;
        emit(tx, 'islandResult', { ...base, win: true, amount, result: jackpot ? 'jackpot' : 'win', tone: 'treasure', emotion: jackpot ? 'shock' : 'joy' });
        changeMoney(tx, c, amount, 'island', { tone: 'treasure', emotion: 'joy' });
        addLog(tx, `${jackpot ? '💥🏝️ 인생역전 대박!!!' : '🏝️ 한 방 성공!'} ${c.name} ${roll} 적중 → ×${ctx.mult} +${won(amount)}`, { tone: 'money', charId: c.id, emotion: jackpot ? 'shock' : 'joy' });
        return;
      }
      emit(tx, 'islandResult', { ...base, win: false, amount: -stake, result: ctx.bust ? 'bust' : 'lose', tone: 'bad', emotion: 'cry' });
      changeMoney(tx, c, -stake, 'island', { tone: 'bad', emotion: 'cry' });
      addLog(tx, `🏝️ ${c.name} ${covers.join('·')}을 골랐지만 ${roll}… ${ctx.bust ? '쪽박! 전 재산을 잃었다' : `−${won(stake)}`}`, { tone: 'bad', charId: c.id, emotion: 'cry' });
      if (ctx.bust) finishCharacter(tx, c, { retired: 'bust' });
    },
  },

  /** 🏆 노년 대회: a theme (stat + item), two entry tiers or 구경. */
  contest: {
    resultCutin: 'auto',
    build(tx, c) {
      const cfg = seniorCfg(tx.data).contest ?? {};
      const theme = drawTheme(tx, c);
      const item = themeItem(tx.data, c, theme.id);
      const chance = contestChance(tx.data, c, theme, { item });
      const second = (1 - chance) * (cfg.secondShare ?? 0.35);
      const scale = cfg.scale ?? 1;
      const income = incomeMultOf(tx, c);
      const cash = Math.max(0, c.money ?? 0);
      const statValue = c.stats?.[theme.stat] ?? 0;
      const options = (cfg.tiers ?? []).map((t) => {
        const prize = round5(t.prize * scale * income);
        const prize2 = round5(t.second * scale * income);
        const fee = round5(t.fee * scale);
        const ev = Math.round(chance * prize + second * prize2 - fee);
        const opt = { id: `join:${t.id}`, tier: t.id, label: `${t.icon} ${t.name}`, icon: t.icon, fee, cost: fee, price: fee, prize, second: prize2, chance: r2(chance), secondChance: r2(second), ev, themeId: theme.id, stat: theme.stat, ...(item ? { itemId: item.id } : {}), desc: `참가비 ${won(fee)} · 우승 ${pct(chance)}% → ${won(prize)} · 입상 ${pct(second)}% → ${won(prize2)}` };
        if (fee > cash) Object.assign(opt, { disabled: true, desc: `참가비 ${won(fee)}이 부족해요` });
        return opt;
      });
      options.push({ id: 'watch', label: '👀 구경만 하기', icon: '👀', desc: '참가비 없이 박수만 쳐요' });
      const def = options.find((o) => o.tier && !o.disabled && o.ev >= 0)?.id ?? 'watch';
      return {
        forCharacterIds: [c.id],
        title: `${theme.icon} ${theme.name}`,
        text: `${josa(c.name, '이/가')} 「${theme.name}」에 초대받았다!${item ? ` ${item.def.icon} ${item.def.name} 덕분에 유리해` : ''} — 나가 볼까?`,
        options,
        defaultOptionId: def,
        context: { themeId: theme.id, theme: { id: theme.id, name: theme.name, icon: theme.icon, stat: theme.stat }, statValue, itemId: item?.id ?? null, chance: r2(chance), secondChance: r2(second) },
      };
    },
    resolve(tx, p) {
      const c = charById(tx.room, p.charId);
      const ctx = p.context ?? {};
      const opt = p.options.find((o) => o.id === p.answers[c.id]);
      if (!opt?.tier || opt.fee > (c.money ?? 0)) {
        addLog(tx, `👀 ${josa(c.name, '은/는')} 「${ctx.theme?.name ?? '노년 대회'}」를 구경하며 박수만 쳤다`, { tone: 'info', charId: c.id });
        return { result: 'watch', themeId: ctx.themeId };
      }
      const r = tx.rng.next();
      const place = r < opt.chance ? 1 : r < opt.chance + opt.secondChance ? 2 : null;
      const prize = place === 1 ? opt.prize : place === 2 ? opt.second : 0;
      emit(tx, 'contestResult', { charId: c.id, themeId: ctx.themeId, tier: opt.tier, stat: ctx.theme?.stat ?? null, statValue: ctx.statValue ?? 0, itemId: ctx.itemId ?? null, chance: opt.chance, place, fee: opt.fee, prize, amount: prize - opt.fee, tone: place === 1 ? 'result' : place ? 'good' : 'neutral', emotion: place === 1 ? 'joy' : place ? 'joy' : 'sweat' });
      changeMoney(tx, c, -opt.fee, 'contest', { tone: 'neutral', emotion: 'neutral' });
      if (prize) changeMoney(tx, c, prize, 'contest', { tone: 'result', emotion: 'joy' });
      const theme = ctx.theme?.name ?? '노년 대회';
      addLog(tx, place === 1 ? `🏆 ${c.name} 「${theme}」 우승! 상금 +${won(prize)}` : place === 2 ? `🥈 ${c.name} 「${theme}」 입상! +${won(prize)}` : `😅 ${c.name} 「${theme}」 예선 탈락… (참가비 −${won(opt.fee)})`, { tone: place ? 'good' : 'info', charId: c.id, emotion: place ? 'joy' : 'sweat' });
      return null;
    },
  },

  /** 🔨 골동품 경매: put one item / treasure / 잡동사니 under the hammer (or leave). */
  auction: {
    resultCutin: 'auto',
    build(tx, c) {
      const cfg = seniorCfg(tx.data).auction ?? {};
      const ev = hammerEv(tx.data);
      const h = hammerTable(tx.data);
      const top = Math.max(...h);
      const low = Math.min(...h);
      const options = [];
      for (const id of c.items ?? []) {
        const d = itemDef(tx.data, id);
        if (!d) continue;
        const base = itemAuctionBase(tx.data, id);
        const premium = d.senior?.use === 'premium';
        options.push({ id: `sell:item:${id}`, kind: 'item', itemId: id, label: `${d.icon} ${d.name}`, icon: d.icon, base, ...(premium ? { premium: d.senior.auctionMult ?? 1.5 } : {}), low: round5(base * low), high: round5(base * top), ev: round5(base * ev), desc: `정산 가치 ${won(base)}${premium ? ' (명품 프리미엄)' : ''} → 낙찰 ${won(round5(base * low))}~${won(round5(base * top))}` });
      }
      for (const t of c.treasures ?? []) {
        const d = treasureDef(tx.data, t.id);
        options.push({ id: `sell:treasure:${t.uid}`, kind: 'treasure', uid: t.uid, treasureId: t.id, label: `${d?.icon ?? '🏺'} ${d?.name ?? '보물'}`, icon: d?.icon ?? '🏺', desc: '감정가는 경매장에서 공개! 가짜면 헐값…' });
      }
      const junk = round5((cfg.junk ?? 20) * (seniorCfg(tx.data).contest?.scale ?? 1));
      options.push({ id: 'sell:junk', kind: 'junk', label: '🧺 잡동사니 내놓기', icon: '🧺', base: junk, low: round5(junk * low), high: round5(junk * top), ev: round5(junk * ev), desc: `집 안 잡동사니 → 낙찰 ${won(round5(junk * low))}~${won(round5(junk * top))}` });
      options.push({ id: 'leave', label: '🚶 구경만 하기', icon: '🚶', desc: '아무것도 팔지 않아요' });
      const n = options.length - 2;
      return {
        forCharacterIds: [c.id],
        title: cfg.title ?? '🔨 골동품 경매',
        text: n ? `${josa(c.name, '이/가')} 경매장에 들렀다! 모아 온 물건 ${n}개 중 하나를 내놓아 볼까?` : `${josa(c.name, '이/가')} 경매장에 들렀다! 내놓을 아이템·보물이 없어 잡동사니뿐…`,
        options,
        defaultOptionId: 'sell:junk',
        context: { hammer: h },
      };
    },
    resolve(tx, p) {
      const c = charById(tx.room, p.charId);
      const answer = p.answers[c.id] ?? '';
      const opt = p.options.find((o) => o.id === answer);
      if (!opt || answer === 'leave') {
        addLog(tx, `🚶 ${josa(c.name, '은/는')} 경매장을 한 바퀴 구경만 했다`, { tone: 'info', charId: c.id });
        return { result: 'leave' };
      }
      const h = hammerTable(tx.data);
      const roll = tx.rng.int(1, h.length);
      const mult = h[roll - 1];
      let base = 0;
      let extra = {};
      let label = opt.label;
      if (opt.kind === 'item') {
        if (!c.items?.includes(opt.itemId)) return { result: 'leave' };
        base = itemAuctionBase(tx.data, opt.itemId);
        c.items = c.items.filter((id) => id !== opt.itemId);
        extra = { itemId: opt.itemId, ...(opt.premium ? { premium: opt.premium } : {}) };
      } else if (opt.kind === 'treasure') {
        const t = c.treasures?.find((x) => x.uid === opt.uid);
        if (!t) return { result: 'leave' };
        const room = tx.room;
        base = room.treasureValues?.[t.uid] ?? 0;
        const fake = !!room.treasureFakes?.[t.uid];
        c.treasures = c.treasures.filter((x) => x.uid !== t.uid);
        if (room.treasureValues) delete room.treasureValues[t.uid];
        if (room.treasureFakes) delete room.treasureFakes[t.uid];
        extra = { treasureId: t.id, uid: t.uid, fake };
      } else base = opt.base ?? 0;
      const amount = round5(base * mult);
      const tone = mult >= 2 ? 'treasure' : mult >= 1 ? 'good' : 'neutral';
      emit(tx, 'auctionResult', { charId: c.id, kind: opt.kind, ...extra, base, roll, mult, amount, tone, emotion: extra.fake ? 'shock' : mult >= 2 ? 'joy' : mult < 1 ? 'sweat' : 'joy' });
      if (amount > 0) changeMoney(tx, c, amount, 'auction', { tone: 'good', emotion: 'joy' });
      addLog(tx, `🔨 ${c.name}: ${label} ${extra.fake ? '— 가짜였다! ' : ''}낙찰! ×${mult} → +${won(amount)}`, { tone: mult >= 1 ? 'good' : 'info', charId: c.id, emotion: mult >= 2 ? 'joy' : 'neutral' });
      return null;
    },
  },
});

// ---------- CPU helpers (cpu.js reads these; pure, never touch the game RNG) ----------

/** Tiles still ahead of `c` on the final race (empty off the final race). */
export function tilesAhead(room, c) {
  const era = room?.board?.eras?.[c?.position?.eraIndex ?? 0];
  if (!era?.final) return [];
  return era.tiles.slice((c.position?.index ?? 0) + 1);
}

/**
 * Worth (만원) of keeping an item's 노년 활용 for the rest of the game: off the final race a flat estimate per use
 * (what a shopper weighs years ahead), on it the tiles still ahead (지출 spots, paydays, the island, the goal).
 */
export function seniorUseWorth(data, room, c, itemId) {
  const s = itemDef(data, itemId)?.senior;
  if (!s?.use) return 0;
  const ahead = inFinalRace(room, c) ? tilesAhead(room, c) : null;
  const count = (type) => (ahead ? ahead.filter((t) => t.type === type).length : null);
  const loss = ahead ? ahead.filter((t) => t.type === 'loss').reduce((sum, t) => sum + (t.amount ?? 50), 0) / 5.5 : 45;
  const contest = (count('contest') ?? 5) / 5.5 * 25 * 0.6; // ~ landings × the item's win-chance bonus × a prize
  switch (s.use) {
    case 'dodge':
      return loss + contest;
    case 'health':
      return loss * (1 - (s.lossMult ?? 0.5)) + contest;
    case 'guard':
      return Math.min(loss, 60) + contest;
    case 'royalty':
      return (c.stats?.int ?? 0) * (s.perInt ?? 15) + contest;
    case 'pension':
      return (ahead ? count('salary') : 1.2) * (s.amount ?? 40) + contest;
    case 'busking':
      return (ahead ? count('salary') : 1.2) * (c.stats?.charm ?? 0) * (s.perCharm ?? 6) + contest;
    case 'lucky':
      return (ahead ? count('island') : 1) * 40 + contest;
    case 'premium': // the 명품 premium only pays when it is auctioned (counted by the auction answer itself)
      return contest;
    default:
      return 0;
  }
}

/** Expected auction proceeds of an item (its base × the hammer's mean multiplier). */
export const itemAuctionEv = (data, id) => round5(itemAuctionBase(data, id) * hammerEv(data));

/** An unknown treasure's expected appraisal (mean of its range × (1 − fakeChance)). */
export function treasureGuess(data, treasureId) {
  const d = treasureDef(data, treasureId);
  if (!d) return 0;
  return ((d.min + d.max) / 2) * (1 - (d.fakeChance ?? 0));
}

/** Shop worth of an item's old-age side (cpu.js shopWorth): its 노년 활용 + the chance of a 골동품 경매 gain. */
export function seniorShopWorth(data, room, c, itemId) {
  const base = itemAuctionBase(data, itemId);
  return seniorUseWorth(data, room, c, itemId) + 0.45 * Math.max(0, itemAuctionEv(data, itemId) - base);
}
