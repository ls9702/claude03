// 노년 역전 client helpers (pure: no DOM, no Node; node-tested in test/client-senior.test.js) — the final race's 🏝️
// 한방역전섬 (prompts `island` → `islandPick`, event `islandResult`), 🏆 노년 대회 (`contest` → `contestResult`), 🔨 골동품
// 경매 (`auction` → `auctionResult`) and the items' 노년 활용 (`seniorItem` chips, items.json `senior` / `seniorDesc`).
// Names come from the room's world meta (theme / item / treasure names of 🐹 치이카와 모드); the DEFAULT_* fallbacks keep a
// missing meta drawable.
import { STAT_INFO } from './growth.js';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const pct = (p) => (p == null || !Number.isFinite(Number(p)) ? null : Math.round(Number(p) * (Number(p) <= 1 ? 100 : 1)));

/** Tile types of the senior race (board.json `tileTypes` wins; 2D / 3D fallback before the meta knows them). */
export const SENIOR_TILE_TYPES = Object.freeze({
  island: Object.freeze({ name: '한방역전섬', icon: '🏝️', color: '#ff6b3d' }),
  contest: Object.freeze({ name: '노년 대회', icon: '🏆', color: '#e6a817' }),
  auction: Object.freeze({ name: '골동품 경매', icon: '🔨', color: '#8e6b4a' }),
});

/** Island stake tiers (balance.senior.island.tiers fallback; the prompt options carry the live numbers). */
export const ISLAND_TIERS = Object.freeze({
  all: Object.freeze({ name: '인생 한 방', icon: '💥', risk: 3, note: '전 재산 · 틀리면 쪽박' }),
  half: Object.freeze({ name: '반반 승부', icon: '🔥', risk: 2, note: '현금 절반' }),
  little: Object.freeze({ name: '소소한 재미', icon: '🪙', risk: 1, note: '현금 조금' }),
});
/** islandResult `result` → label / icon. */
export const ISLAND_RESULTS = Object.freeze({
  jackpot: Object.freeze({ label: '대박!', icon: '💥' }),
  win: Object.freeze({ label: '적중!', icon: '🎯' }),
  lose: Object.freeze({ label: '꽝…', icon: '💸' }),
  bust: Object.freeze({ label: '쪽박…', icon: '🌾' }),
  retire: Object.freeze({ label: '조기 은퇴', icon: '🏖️' }),
});

/** 노년 대회 themes (balance.senior.contest.themes fallback). */
export const DEFAULT_THEMES = Object.freeze([
  Object.freeze({ id: 'sing', name: '노래자랑', icon: '🎤', stat: 'charm' }),
  Object.freeze({ id: 'baduk', name: '바둑 대회', icon: '♟️', stat: 'int' }),
  Object.freeze({ id: 'gateball', name: '게이트볼 대회', icon: '🏑', stat: 'str' }),
  Object.freeze({ id: 'raffle', name: '경품 추첨', icon: '🎁', stat: 'luck' }),
  Object.freeze({ id: 'rally', name: '실버 드라이브 랠리', icon: '🚗', stat: 'luck' }),
]);

/** Item 노년 활용 kinds (items.json `senior.use`). */
export const SENIOR_USES = Object.freeze({
  dodge: Object.freeze({ icon: '🚗', label: '위기 탈출' }),
  royalty: Object.freeze({ icon: '📖', label: '자서전 인세' }),
  health: Object.freeze({ icon: '💪', label: '건강 체질' }),
  premium: Object.freeze({ icon: '💎', label: '명품 프리미엄' }),
  lucky: Object.freeze({ icon: '🍀', label: '행운의 숫자' }),
  pension: Object.freeze({ icon: '♨️', label: '건강 보너스' }),
  guard: Object.freeze({ icon: '🛡️', label: '지출 막기' }),
  busking: Object.freeze({ icon: '🎸', label: '노년 버스킹' }),
});
/** items.json `senior` fallback (both worlds' ids). */
export const DEFAULT_ITEM_SENIOR = Object.freeze({
  car: Object.freeze({ use: 'dodge', theme: 'rally', desc: '지출 칸에 멈추면 한 칸 더 달려서 피해요' }),
  laptop: Object.freeze({ use: 'royalty', theme: 'baduk', desc: '골인하면 자서전 인세 (지력 × 15만원)' }),
  gym_pass: Object.freeze({ use: 'health', theme: 'gateball', desc: '지출 칸 손해 절반' }),
  designer_bag: Object.freeze({ use: 'premium', theme: 'sing', desc: '골동품 경매에 내놓으면 명품 프리미엄 ×1.5' }),
  lucky_cat: Object.freeze({ use: 'lucky', theme: 'raffle', desc: '한방역전섬에서 행운의 숫자 +1개' }),
  massage_chair: Object.freeze({ use: 'pension', theme: 'gateball', desc: '노년 월급날마다 건강 보너스 · 부상 회복' }),
  armor: Object.freeze({ use: 'guard', theme: 'gateball', desc: '노년 경주 지출 칸 손해를 한 번 막아요' }),
  guitar: Object.freeze({ use: 'busking', theme: 'sing', desc: '노년 월급날마다 버스킹 수입 (매력 × 6만원)' }),
});

const itemDefOf = (id, meta) => (meta?.items?.items ?? []).find((x) => x?.id === id) ?? null;

/** {use, theme, desc, icon, label} of an item's 노년 활용 (meta items.json wins), or null. */
export function itemSenior(itemId, meta = null) {
  const d = itemDefOf(itemId, meta);
  const fb = DEFAULT_ITEM_SENIOR[itemId] ?? null;
  const use = d?.senior?.use ?? fb?.use ?? null;
  if (!use) return null;
  const u = SENIOR_USES[use] ?? { icon: '👴', label: '노년 활용' };
  return { use, theme: d?.senior?.theme ?? fb?.theme ?? null, desc: d?.seniorDesc ?? fb?.desc ?? '', icon: u.icon, label: u.label };
}

/** 「👴 노년: …」 text of an item ('' without one). */
export const seniorDescOf = (itemId, meta = null) => itemSenior(itemId, meta)?.desc ?? '';

/** A character's items with a 노년 활용: [{id, name, icon, senior}] (inventory order). */
export function seniorItemsOf(c, meta = null) {
  return (Array.isArray(c?.items) ? c.items : [])
    .map((id) => {
      const s = itemSenior(id, meta);
      const d = itemDefOf(id, meta);
      return s ? { id, name: d?.name ?? id, icon: d?.icon ?? '🎁', senior: s } : null;
    })
    .filter(Boolean);
}

/** A 노년 대회 theme {id, name, icon, stat, statLabel, statIcon} (meta wins). */
export function themeInfo(id, meta = null) {
  const list = meta?.balance?.senior?.contest?.themes;
  const t = (Array.isArray(list) ? list : []).find((x) => x?.id === id) ?? DEFAULT_THEMES.find((x) => x.id === id) ?? { id, name: '노년 대회', icon: '🏆', stat: null };
  const si = STAT_INFO[t.stat] ?? null;
  return { ...t, statLabel: si?.label ?? '', statIcon: si?.icon ?? '' };
}

// ---------- 🏝️ 한방역전섬 ----------

/**
 * Island prompt → view model: cash, the standing (rank / gap), lucky numbers, the stake tiers (stake, numbers, ×mult,
 * chance %, the win, 쪽박 for 인생 한 방, disabled + reason), 조기 은퇴 (place, prize) and 지나가기.
 */
export function islandPrompt(p) {
  const opts = Array.isArray(p?.options) ? p.options : [];
  const ctx = isObj(p?.context) ? p.context : {};
  const tiers = opts
    .filter((o) => String(o.id).startsWith('bet:'))
    .map((o) => {
      const id = o.tier ?? String(o.id).slice(4);
      const t = ISLAND_TIERS[id] ?? { name: id, icon: '🎯', risk: 1, note: '' };
      return {
        id: o.id,
        tier: id,
        label: String(o.label ?? `${t.icon} ${t.name}`),
        icon: o.icon ?? t.icon,
        name: t.name,
        risk: t.risk,
        note: t.note,
        stake: num(o.stake),
        numbers: Math.max(1, num(o.numbers, 1)),
        lucky: num(o.lucky),
        mult: num(o.mult, 1),
        chance: pct(o.chance),
        win: num(o.win),
        bust: !!o.bust,
        ev: num(o.ev),
        disabled: !!o.disabled,
        reason: o.disabled ? String(o.desc ?? '걸 돈이 부족해요') : '',
        desc: String(o.desc ?? ''),
      };
    });
  const r = opts.find((o) => o.id === 'retire');
  const ps = opts.find((o) => o.id === 'pass');
  return {
    cash: num(ctx.cash, tiers.find((t) => t.tier === 'all')?.stake ?? 0),
    rank: ctx.rank != null ? num(ctx.rank) : null,
    n: ctx.n != null ? num(ctx.n) : null,
    gap: ctx.gap != null ? num(ctx.gap) : null,
    lucky: num(ctx.lucky, tiers[0]?.lucky ?? 0),
    tiers,
    retire: r ? { id: 'retire', label: r.label ?? '🏖️ 조기 은퇴', icon: '🏖️', place: num(r.place, 0) || null, prize: num(r.prize), disabled: !!r.disabled, desc: String(r.desc ?? '') } : null,
    pass: ps ? { id: 'pass', label: ps.label ?? '🍵 욕심 버리기', icon: '🍵', disabled: !!ps.disabled, desc: String(ps.desc ?? '') } : null,
    others: opts.filter((o) => !String(o.id).startsWith('bet:') && o.id !== 'retire' && o.id !== 'pass'),
  };
}

/** 「지금 3위 · 1위와 120만원 차이」 / 「지금 1위 · 2위보다 80만원 앞」 ('' without a standing). */
export function standingText(v, won = (n) => `${n}만원`) {
  if (!v || v.rank == null) return '';
  if (v.rank === 1) return `지금 1위${v.gap != null ? ` · 2위보다 ${won(Math.max(0, -v.gap))} 앞` : ''}`;
  return `지금 ${v.rank}위${v.n ? `/${v.n}` : ''}${v.gap != null ? ` · 1위와 ${won(Math.max(0, v.gap))} 차이` : ''}`;
}

/** islandPick prompt → {tier, name, icon, stake, numbers, mult, bust, lucky, win, options [{id, number, covers, disabled}]} */
export function islandPickPrompt(p) {
  const ctx = isObj(p?.context) ? p.context : {};
  const opts = (Array.isArray(p?.options) ? p.options : []).map((o) => ({
    id: String(o.id),
    number: num(o.number, num(o.id)),
    covers: Array.isArray(o.covers) && o.covers.length ? o.covers.map((x) => num(x)) : [num(o.number, num(o.id))],
    disabled: !!o.disabled,
  }));
  const tier = ctx.tier ?? null;
  const t = ISLAND_TIERS[tier] ?? null;
  const stake = num(ctx.stake);
  const mult = num(ctx.mult, 1);
  return {
    tier,
    name: ctx.name ?? t?.name ?? '한방 승부',
    icon: ctx.icon ?? t?.icon ?? '🎯',
    stake,
    numbers: Math.max(1, num(ctx.numbers, opts[0]?.covers.length ?? 1)),
    mult,
    bust: !!ctx.bust,
    lucky: num(ctx.lucky),
    win: Math.round((stake * mult) / 5) * 5,
    options: opts,
  };
}

/** islandResult → {result, label, icon, win, jackpot, bust, retire, amount, stake, roll, covers, pick, mult, tier, lucky, place, prize, big} */
export function islandOutcome(e) {
  const result = String(e?.result ?? (e?.win ? 'win' : 'lose'));
  const info = ISLAND_RESULTS[result] ?? ISLAND_RESULTS.lose;
  const amount = num(e?.amount);
  return {
    result,
    label: info.label,
    icon: info.icon,
    win: !!e?.win,
    jackpot: result === 'jackpot',
    bust: result === 'bust',
    retire: result === 'retire',
    amount,
    stake: num(e?.stake),
    roll: e?.roll != null ? num(e.roll) : null,
    covers: Array.isArray(e?.covers) ? e.covers.map((x) => num(x)) : [],
    pick: e?.pick != null ? num(e.pick) : null,
    mult: num(e?.mult, 1),
    tier: e?.tier ?? null,
    lucky: num(e?.lucky),
    place: e?.place != null ? num(e.place) : null,
    prize: num(e?.prize),
    big: result === 'jackpot' || result === 'bust' || (result === 'win' && amount >= 500),
  };
}
/** 대박 / 쪽박 (and big wins) = a big show (full even in 「간단히」). */
export const isIslandBig = (e) => e?.type === 'islandResult' && islandOutcome(e).big;

// ---------- 🏆 노년 대회 ----------

/** Contest prompt → {theme, statValue, item, chance %, secondChance %, tiers [{id, tier, label, icon, fee, prize, second, ev, disabled, reason}], watch} */
export function contestPrompt(p, { meta = null } = {}) {
  const opts = Array.isArray(p?.options) ? p.options : [];
  const ctx = isObj(p?.context) ? p.context : {};
  const themeId = ctx.themeId ?? opts.find((o) => o.themeId)?.themeId ?? null;
  const base = themeInfo(themeId, meta);
  const theme = isObj(ctx.theme) ? { ...base, name: ctx.theme.name ?? base.name, icon: ctx.theme.icon ?? base.icon, stat: ctx.theme.stat ?? base.stat } : base;
  const si = STAT_INFO[theme.stat] ?? null;
  const itemId = ctx.itemId ?? opts.find((o) => o.itemId)?.itemId ?? null;
  const d = itemId ? itemDefOf(itemId, meta) : null;
  const tiers = opts
    .filter((o) => String(o.id).startsWith('join:'))
    .map((o) => ({
      id: o.id,
      tier: o.tier ?? String(o.id).slice(5),
      label: String(o.label ?? o.id),
      icon: o.icon ?? '🙋',
      fee: num(o.fee ?? o.price),
      prize: num(o.prize),
      second: num(o.second),
      ev: num(o.ev),
      chance: pct(o.chance),
      disabled: !!o.disabled,
      reason: o.disabled ? String(o.desc ?? '참가비가 부족해요') : '',
    }));
  const w = opts.find((o) => o.id === 'watch');
  return {
    theme: { ...theme, statLabel: si?.label ?? '', statIcon: si?.icon ?? '' },
    statValue: num(ctx.statValue),
    item: itemId ? { id: itemId, name: d?.name ?? itemId, icon: d?.icon ?? '🎁' } : null,
    chance: pct(ctx.chance ?? tiers[0]?.chance),
    secondChance: pct(ctx.secondChance),
    tiers,
    watch: w ? { id: 'watch', label: w.label ?? '👀 구경만 하기', icon: '👀', disabled: !!w.disabled } : null,
  };
}

/** contestResult → {theme, place, label, icon, prize, fee, net, item, big} */
export function contestOutcome(e, { meta = null } = {}) {
  const theme = themeInfo(e?.themeId, meta);
  const place = e?.place == null ? null : num(e.place);
  const d = e?.itemId ? itemDefOf(e.itemId, meta) : null;
  return {
    theme,
    place,
    label: place === 1 ? '우승' : place === 2 ? '입상' : '탈락',
    icon: place === 1 ? '🏆' : place === 2 ? '🥈' : '😅',
    prize: num(e?.prize),
    fee: num(e?.fee),
    net: num(e?.prize) - num(e?.fee),
    item: e?.itemId ? { id: e.itemId, name: d?.name ?? e.itemId, icon: d?.icon ?? '🎁' } : null,
    big: place === 1 && e?.tier === 'big',
  };
}
export const isContestBig = (e) => e?.type === 'contestResult' && contestOutcome(e).big;

// ---------- 🔨 골동품 경매 ----------

/** Auction prompt → {lots [{id, kind, label, icon, base, low, high, ev, premium, itemId, treasureId}], junk, leave, hammer} */
export function auctionPrompt(p) {
  const opts = Array.isArray(p?.options) ? p.options : [];
  const lot = (o) => ({
    id: o.id,
    kind: o.kind ?? 'item',
    label: String(o.label ?? o.id),
    icon: o.icon ?? '📦',
    base: o.base != null ? num(o.base) : null,
    low: o.low != null ? num(o.low) : null,
    high: o.high != null ? num(o.high) : null,
    ev: o.ev != null ? num(o.ev) : null,
    premium: o.premium != null ? num(o.premium) : null,
    itemId: o.itemId ?? null,
    treasureId: o.treasureId ?? null,
    disabled: !!o.disabled,
    desc: String(o.desc ?? ''),
  });
  const lots = opts.filter((o) => o.kind === 'item' || o.kind === 'treasure').map(lot);
  const junk = opts.find((o) => o.kind === 'junk' || o.id === 'sell:junk');
  const leave = opts.find((o) => o.id === 'leave');
  const hammer = Array.isArray(p?.context?.hammer) ? p.context.hammer.map((x) => num(x)) : null;
  return { lots, junk: junk ? lot(junk) : null, leave: leave ? { id: 'leave', label: leave.label ?? '🚶 구경만 하기', icon: '🚶', disabled: !!leave.disabled } : null, hammer };
}

/** auctionResult → {kind, name, icon, base, mult, roll, amount, fake, premium, big, cheap} */
export function auctionOutcome(e, { meta = null } = {}) {
  const kind = e?.kind ?? 'junk';
  const d = kind === 'item' ? itemDefOf(e?.itemId, meta) : null;
  const t = kind === 'treasure' ? (meta?.treasures?.treasures ?? []).find((x) => x?.id === e?.treasureId) ?? null : null;
  const mult = num(e?.mult, 1);
  return {
    kind,
    name: kind === 'item' ? d?.name ?? e?.itemId ?? '아이템' : kind === 'treasure' ? t?.name ?? '보물' : '잡동사니',
    icon: kind === 'item' ? d?.icon ?? '📦' : kind === 'treasure' ? t?.icon ?? '🏺' : '🧺',
    base: num(e?.base),
    mult,
    roll: e?.roll != null ? num(e.roll) : null,
    amount: num(e?.amount),
    fake: !!e?.fake,
    premium: e?.premium != null ? num(e.premium) : null,
    big: !e?.fake && mult >= 2.2,
    cheap: !!e?.fake || mult < 1,
  };
}
export const isAuctionBig = (e) => e?.type === 'auctionResult' && auctionOutcome(e).big;

// ---------- item 노년 활용 chips ----------

/** seniorItem → {text, kind, icon} for a chip / float / toast (「🚗 경차 덕분에 지출 칸 통과!」). */
export function seniorItemText(e, { meta = null, won = (n) => `${n}만원` } = {}) {
  const d = itemDefOf(e?.itemId, meta);
  const name = d?.name ?? (e?.itemId ? String(e.itemId) : '아이템');
  const u = SENIOR_USES[e?.use] ?? { icon: '👴', label: '노년 활용' };
  const icon = d?.icon ?? u.icon;
  const amt = num(e?.amount);
  switch (e?.use) {
    case 'dodge':
      return { icon, kind: 'plus', text: `${icon} ${name} 덕분에 지출 칸 통과!` };
    case 'health':
      return { icon, kind: 'plus', text: `${icon} ${name} · 지출 ${won(num(e?.saved))} 절약` };
    case 'guard':
      return { icon, kind: 'plus', text: `${icon} ${name} · 지출 ${won(num(e?.saved))} 막음` };
    case 'pension':
      return { icon, kind: 'plus', text: `${icon} ${name} 건강 보너스${amt ? ` +${won(amt)}` : ''}${e?.healed ? ' · 부상 회복' : ''}` };
    case 'busking':
      return { icon, kind: 'plus', text: `${icon} 노년 버스킹 +${won(amt)}` };
    case 'royalty':
      return { icon, kind: 'plus', text: `${icon} 자서전 인세 +${won(amt)}` };
    default:
      return { icon, kind: 'plus', text: `${icon} ${name} · ${u.label}${amt ? ` +${won(amt)}` : ''}` };
  }
}

/** 「욕심 버리기」 at the island / 구경 at a contest / 경매 구경 → a banner (never a cut-in). */
export const isSeniorPass = (e) =>
  e?.type === 'promptResolved' && ((e.kind === 'island' && e.result === 'pass') || (e.kind === 'contest' && e.result === 'watch') || (e.kind === 'auction' && e.result === 'leave'));
