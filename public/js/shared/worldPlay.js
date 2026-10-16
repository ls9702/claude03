// 세계 설정 client helpers (pure: no DOM, no Node; node-tested in test/client-world.test.js) — the 🐹 치이카와 모드
// activities: 토벌 (tile / prompt `hunt` → event `huntResult`), 풀뽑기 검정 (tile / prompt `weed` → event `weedResult`) and
// 쿠지 뽑기 (the Chiikawa world's `lottoDraw {kuji: true, entries [{charId, rank, prize}]}`). Names come from the room's
// world meta (`/api/meta.hunts`, cards, treasures via shared/world.js `worldMeta`); the DEFAULT_* fallbacks keep a missing
// meta drawable. The real world never shows a hunt / weed tile and keeps its numbered lotto (`lottoRows` in cards.js).
import { STAT_INFO } from './growth.js';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const pct = (p) => (Number.isFinite(Number(p)) ? Math.round(Number(p) * (Number(p) <= 1 ? 100 : 1)) : null);

/** Tile types of the 치이카와 모드 (board.json `tileTypes` wins; 2D / 3D fallback before the meta knows them). */
export const WORLD_TILE_TYPES = Object.freeze({
  hunt: Object.freeze({ name: '토벌', icon: '⚔️', color: '#c0392b' }),
  weed: Object.freeze({ name: '풀뽑기', icon: '🌿', color: '#6ab04c' }),
});

// ---------- 토벌 ----------

/** Contract fallback of hunts.json `monsters` (ids fixed; power 1..4). */
export const DEFAULT_MONSTERS = Object.freeze([
  Object.freeze({ id: 'small_chimera', name: '꼬마 키메라', icon: '🐛', power: 1, desc: '풀숲에서 꼬물꼬물 기어 나온 작은 키메라' }),
  Object.freeze({ id: 'chimera', name: '키메라', icon: '👾', power: 2, desc: '이빨을 드러내고 으르렁거리는 보통 키메라' }),
  Object.freeze({ id: 'big_chimera', name: '커다란 키메라', icon: '🦖', power: 3, desc: '나무만큼 커다란 키메라!' }),
  Object.freeze({ id: 'dekatsuyo', name: '데카츠요', icon: '👹', power: 4, desc: '숲의 주인이라 불리는 전설의 거대 키메라' }),
]);
export const MONSTER_IDS = DEFAULT_MONSTERS.map((m) => m.id);

/** Monsters of the meta (hunts.json), else the fallback list. */
export function monsterList(meta) {
  const list = meta?.hunts?.monsters;
  return Array.isArray(list) && list.length ? list : DEFAULT_MONSTERS;
}

/** {id, name, icon, desc, power, reward?} of a monster id (unknown → a generic 키메라 of power 2). */
export function monsterInfo(id, meta = null) {
  const m = monsterList(meta).find((x) => x?.id === id) ?? DEFAULT_MONSTERS.find((x) => x.id === id);
  if (m) return { ...m, power: Math.max(1, Math.min(4, num(m.power, 1))) };
  return { id: id ?? 'chimera', name: '키메라', icon: '👾', desc: '', power: 2 };
}

/** 토벌 wins of a character (public `character.hunts`). */
export const huntsOf = (c) => Math.max(0, Math.floor(num(c?.hunts)));

/** A promptResolved of a 토벌 the character ran away from (a banner, never a cut-in). */
export const isHuntRun = (e) => e?.type === 'promptResolved' && e.kind === 'hunt' && String(e.result ?? '') === 'run';

/**
 * Hunt prompt → view model of the battle card: the monster (context / option), 「⚔️ 싸운다」 with chance (%), reward range and
 * the 🔱 사스마타 / 🛡️ 갑옷 badges, 「🏃 도망친다」.
 */
export function huntPrompt(p, { meta = null } = {}) {
  const opts = Array.isArray(p?.options) ? p.options : [];
  const ctx = isObj(p?.context) ? p.context : {};
  const fightOpt = opts.find((o) => o.id === 'fight') ?? null;
  const runOpt = opts.find((o) => o.id === 'run') ?? null;
  const monsterId = ctx.monsterId ?? fightOpt?.monsterId ?? ctx.monster?.id ?? null;
  const info = monsterInfo(monsterId, meta);
  const monster = { ...info, ...(isObj(ctx.monster) ? { name: ctx.monster.name ?? info.name, icon: ctx.monster.icon ?? info.icon, power: Math.max(1, Math.min(4, num(ctx.monster.power, info.power))) } : {}) };
  const reward = Array.isArray(fightOpt?.reward) ? fightOpt.reward : Array.isArray(ctx.reward) ? ctx.reward : null;
  const chance = pct(fightOpt?.chance ?? ctx.chance);
  const armor = !!(fightOpt?.armor ?? ctx.armor);
  const sasumata = !!(fightOpt?.sasumata ?? ctx.sasumata);
  const badges = [];
  if (sasumata) badges.push({ text: '🔱 사스마타', kind: 'plus' });
  if (armor) badges.push({ text: '🛡️ 갑옷', kind: 'plus' });
  const fight = fightOpt
    ? { id: 'fight', label: fightOpt.label ?? '⚔️ 싸운다', icon: '⚔️', chance, reward: reward ? [num(reward[0]), num(reward[1], num(reward[0]))] : null, armor, sasumata, badges, disabled: !!fightOpt.disabled, desc: fightOpt.desc ?? '' }
    : null;
  const run = runOpt ? { id: 'run', label: runOpt.label ?? '🏃 도망친다', icon: '🏃', disabled: !!runOpt.disabled, desc: runOpt.desc ?? '' } : null;
  const others = opts.filter((o) => o.id !== 'fight' && o.id !== 'run');
  return { monster, fight, run, others, danger: chance == null ? 'mid' : chance >= 70 ? 'easy' : chance >= 45 ? 'mid' : 'hard' };
}

/** huntResult → {monster, win, amount, injured, hunts, armor, sasumata, chance (%), big} */
export function huntOutcome(e, { meta = null } = {}) {
  const monster = monsterInfo(e?.monsterId, meta);
  const win = !!e?.success;
  return {
    monster,
    win,
    amount: num(e?.amount),
    injured: Math.max(0, num(e?.injured)),
    hunts: Number.isFinite(Number(e?.hunts)) ? Number(e.hunts) : null,
    armor: !!e?.armor,
    sasumata: !!e?.sasumata,
    chance: pct(e?.chance),
    big: win && monster.power >= 4,
  };
}
/** A 데카츠요 (power 4) beaten = a big show (full even in 「간단히」). */
export const isHuntBig = (e, meta = null) => e?.type === 'huntResult' && !!e.success && monsterInfo(e.monsterId, meta).power >= 4;

// ---------- 풀뽑기 검정 ----------

export const WEED_MAX = 5;
/** 검정 level → grade label (1 = 5급 … 5 = 1급, 0 = 무자격). */
export const weedGrade = (level) => {
  const l = Math.max(0, Math.min(WEED_MAX, Math.floor(num(level))));
  return l > 0 ? `${WEED_MAX + 1 - l}급` : '무자격';
};
/** 풀뽑기 검정 level of a character (public `character.weed.level`). */
export const weedLevelOf = (c) => Math.max(0, Math.min(WEED_MAX, Math.floor(num(c?.weed?.level))));

/** Side-list / detail tags: 「🌿 5급」 (level > 0), 「⚔️ 토벌 3회」 (hunts > 0). */
export function worldTags(c) {
  const out = [];
  const lv = weedLevelOf(c);
  if (lv > 0) out.push({ key: 'weed', text: `🌿 ${weedGrade(lv)}`, title: `풀뽑기 검정 ${weedGrade(lv)}${lv >= WEED_MAX ? ' (최고 급수)' : ''}` });
  const h = huntsOf(c);
  if (h > 0) out.push({ key: 'hunts', text: `⚔️ 토벌 ${h}회`, title: `키메라 토벌 성공 ${h}회` });
  return out;
}

/**
 * Weed prompt → view model of the field card: current grade, 「🌿 풀뽑기 일하기 (+n만원)」 and 「📝 검정 응시」 (target grade,
 * chance %, fee or free, disabled reason).
 */
export function weedPrompt(p) {
  const opts = Array.isArray(p?.options) ? p.options : [];
  const ctx = isObj(p?.context) ? p.context : {};
  const workOpt = opts.find((o) => o.id === 'work') ?? null;
  const examOpt = opts.find((o) => o.id === 'exam') ?? null;
  const level = Math.max(0, Math.min(WEED_MAX, Math.floor(num(ctx.level))));
  const maxed = level >= WEED_MAX || (examOpt?.disabled && num(examOpt.level) >= WEED_MAX && examOpt.chance == null);
  const target = examOpt ? Math.max(1, Math.min(WEED_MAX, Math.floor(num(examOpt.level, level + 1)))) : null;
  const fee = examOpt ? num(examOpt.fee ?? examOpt.price) : 0;
  const reason = examOpt?.disabled ? (maxed ? '이미 최고 급수(1급)예요!' : /부족/.test(String(examOpt.desc ?? '')) ? '응시료가 부족해요' : String(examOpt.desc ?? '지금은 응시할 수 없어요')) : '';
  return {
    level,
    grade: ctx.grade ?? weedGrade(level),
    maxed: !!maxed,
    work: workOpt ? { id: 'work', label: workOpt.label ?? '🌿 풀뽑기 일하기', icon: '🌿', amount: num(workOpt.amount ?? ctx.amount), disabled: !!workOpt.disabled, desc: workOpt.desc ?? '' } : null,
    exam: examOpt
      ? { id: 'exam', label: examOpt.label ?? '📝 검정 응시', icon: '📝', target, grade: examOpt.grade ?? weedGrade(target), chance: pct(examOpt.chance), fee, free: !fee, disabled: !!examOpt.disabled, reason, desc: examOpt.desc ?? '' }
      : null,
    others: opts.filter((o) => o.id !== 'work' && o.id !== 'exam'),
  };
}

/** weedResult → {action, pass (true / false; null for work), level, grade, amount, fee, payday, chance (%), big} */
export function weedOutcome(e) {
  const exam = e?.action === 'exam';
  const level = Math.max(0, Math.min(WEED_MAX, Math.floor(num(e?.level))));
  return {
    action: exam ? 'exam' : 'work',
    pass: exam ? !!e.success : null,
    level,
    grade: e?.grade ?? weedGrade(level),
    target: exam ? Math.max(1, Math.min(WEED_MAX, Math.floor(num(e?.target, level + (e?.success ? 0 : 1))))) : null,
    amount: num(e?.amount),
    fee: num(e?.fee),
    payday: !!e?.payday,
    chance: pct(e?.chance),
    big: exam && !!e?.success && level >= WEED_MAX,
  };
}
/** 1급 (the top grade) passed = a big show. */
export const isWeedBig = (e) => e?.type === 'weedResult' && e.action === 'exam' && !!e.success && num(e.level) >= WEED_MAX;
/** Plain 풀뽑기 work = a minor event (other players: a banner). */
export const isWeedWork = (e) => e?.type === 'weedResult' && e.action !== 'exam';

// ---------- 쿠지 뽑기 ----------

/** Rank looks of the kuji box (1등 인형 … 꽝 휴지); the prize name comes from the event. */
export const KUJI_RANKS = Object.freeze({
  1: Object.freeze({ label: '1등', icon: '🧸', color: '#ff5c8a' }),
  2: Object.freeze({ label: '2등', icon: '🎁', color: '#ff9f43' }),
  3: Object.freeze({ label: '3등', icon: '🃏', color: '#9a6ad6' }),
  4: Object.freeze({ label: '4등', icon: '🍜', color: '#20a39e' }),
  5: Object.freeze({ label: '꽝', icon: '🧻', color: '#9aa5b1' }),
});

/** Did a drawn prize bring anything (money / card / treasure / stats)? */
export const kujiWon = (prize) => !!(num(prize?.money) || prize?.cardId || prize?.treasureId || (isObj(prize?.stats) && Object.keys(prize.stats).length));

/** The Chiikawa world's lottoDraw payload (`kuji: true`, entries with a rank + prize object; no numbers). */
export const isKujiDraw = (e) => e?.type === 'lottoDraw' && (e.kuji === true || (!Array.isArray(e.numbers) && (e.entries ?? []).some((x) => x?.rank != null && isObj(x?.prize))));
/** A 1등 in the box = a big show. */
export const isKujiBig = (e) => isKujiDraw(e) && (e.entries ?? []).some((x) => num(x?.rank) === 1);

/** 「1등 · 커다란 치이카와 인형」 → {label: '1등', title: '커다란 치이카와 인형'} (rank fallback labels). */
export function kujiRankInfo(rank, prize = null) {
  const r = KUJI_RANKS[num(rank)] ?? (kujiWon(prize) ? { label: `${num(rank) || '?'}등`, icon: '🎟️', color: '#ff9f43' } : KUJI_RANKS[5]);
  const name = String(prize?.name ?? '').trim();
  const m = name.match(/^(\d+등|꽝)\s*[·:-]\s*(.+)$/);
  return { ...r, label: m ? m[1] : r.label, title: m ? m[2] : name || (num(rank) === 5 || !kujiWon(prize) ? '휴지' : r.label) };
}

const cardName = (id, meta) => (meta?.cards?.cards ?? []).find((k) => k.id === id) ?? null;
const treasureName = (id, meta) => (meta?.treasures?.treasures ?? []).find((t) => t.id === id) ?? null;

/**
 * kuji lottoDraw → display rows (best rank first, then draw order): {charId, name, char, rank, label, icon, title, won, jackpot,
 * chips [{text, kind}], line}. Old numbered payloads → [] (use cards.js `lottoRows`).
 */
export function kujiRows(event, { characters = [], meta = null, won = (n) => `${n}만원` } = {}) {
  if (!isKujiDraw(event)) return [];
  const rows = (Array.isArray(event.entries) ? event.entries : []).map((e, i) => {
    const prize = isObj(e.prize) ? e.prize : {};
    const c = characters.find((x) => x.id === e.charId) ?? null;
    const info = kujiRankInfo(e.rank, prize);
    const chips = [];
    if (num(prize.money) > 0) chips.push({ text: `💰 +${won(num(prize.money))}`, kind: 'plus' });
    if (prize.cardId) {
      const k = cardName(prize.cardId, meta);
      chips.push({ text: `🃏 ${k?.name ?? '카드'} 카드`, kind: 'plus card' });
    }
    if (prize.treasureId) {
      const t = treasureName(prize.treasureId, meta);
      const tn = t?.name ?? '커다란 인형';
      if (!String(prize.name ?? '').includes(tn)) chips.push({ text: `${t?.icon ?? '🧸'} ${tn}`, kind: 'plus' }); // the prize title names it already
    }
    for (const [stat, d] of Object.entries(isObj(prize.stats) ? prize.stats : {})) {
      const si = STAT_INFO[stat];
      if (num(d)) chips.push({ text: `${si?.icon ?? '⭐'} ${si?.label ?? stat} ${num(d) > 0 ? '+' : ''}${num(d)}`, kind: `stat stat-${stat} ${num(d) > 0 ? 'plus' : 'minus'}` });
    }
    const wonIt = kujiWon(prize);
    return { charId: e.charId, name: c?.name ?? e.charId ?? '', char: c, rank: num(e.rank, 5), label: info.label, icon: info.icon, color: info.color, title: info.title, won: wonIt, jackpot: num(e.rank) === 1, chips, line: typeof e.line === 'string' ? e.line : '', order: i };
  });
  return rows.sort((a, b) => a.rank - b.rank || a.order - b.order);
}

/** One summary line of a kuji draw. */
export function kujiSummary(rows = []) {
  if (!rows.length) return '응모권을 가진 사람이 없어 쿠지 상자만 흔들었어요.';
  const best = rows[0];
  if (!best.won) return rows.length > 1 ? '모두 꽝… 휴지만 잔뜩 받았어요 🧻' : `${best.name}, 꽝… 휴지 한 장 🧻`;
  return best.jackpot ? `🎉 ${best.name} 1등 당첨! ${best.title}!` : `🎉 ${best.name} ${best.label} 당첨! ${best.title}`;
}
