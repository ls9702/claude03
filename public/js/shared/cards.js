// Stage 7 client helpers (pure: no DOM, no Node) — cards, items, trades, gifts, holiday / lotto results.
// Shared by game2d.js, cutin2d.js, cutinMap.js, the 3D board glue and node tests (test/client-cards.test.js).
//
//   cardDefs(meta) / cardInfo(id, meta) / itemInfo(id, meta)   → /api/meta.cards|items (+ built-in fallback names)
//   handOf(character, meta) / cardPlayability(...) / sabotageTargets(...)  → hand row + detail sheet
//   validateTrade(form, ctx) / validateGift(form, ctx) / tradeSideText / tradeLists  → 🤝 거래 · 🎁 선물
//   spinModBadges(spinMods) / handLayout(n, width)               → pawn / side-row badges, card row sizing
//   holidayRows(event, ctx) / lottoRows(event, ctx)               → 명절 정산 / 전국 로또 cut-in rows
//
// Everything is feature-detected: characters / rooms / meta without the Stage 7 fields render as before.

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** Card kinds → label + frame colours (instant blue, passive green, sabotage red). */

/** 「이름은/는」 (local mirror of format.josa — this module has no imports). */
function josaTopic(name) {
  const w = String(name ?? '');
  const code = w.replace(/[\u2066-\u2069]/g, '').trim().slice(-1).charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return `${w}${(code - 0xac00) % 28 ? '은' : '는'}`;
  const ch = w.trim().slice(-1);
  if (/[0-9]/.test(ch)) return `${w}${'013678'.includes(ch) ? '은' : '는'}`;
  return `${w}은(는)`;
}

export const CARD_KINDS = Object.freeze({
  instant: { label: '즉시', color: '#3b82f6', dark: '#1d4ed8', soft: '#dbeafe' },
  passive: { label: '자동', color: '#22a55a', dark: '#15803d', soft: '#dcfce7' },
  sabotage: { label: '뒤통수', color: '#e2504c', dark: '#b91c1c', soft: '#fee2e2' },
});

/** Contract fallback (names / icons / kinds) when `/api/meta.cards` is missing or doesn't know an id. */
export const DEFAULT_CARDS = Object.freeze({
  study: { name: '벼락치기', icon: '📖', kind: 'instant', desc: '지력 +1' },
  insider: { name: '인싸력', icon: '😎', kind: 'instant', desc: '매력 +1' },
  energy: { name: '에너지 드링크', icon: '⚡', kind: 'instant', desc: '이번 룰렛 +2칸' },
  taxi: { name: '택시', icon: '🚕', kind: 'instant', desc: '룰렛을 2번 돌려 큰 값으로 이동' },
  pledge: { name: '공약', icon: '🗳️', kind: 'instant', desc: '국회의원 전용: 모두에게서 후원금', jobOnly: 'politician' },
  bonus: { name: '보너스', icon: '💰', kind: 'passive', desc: '다음 월급 2배' },
  insurance: { name: '보험', icon: '☂️', kind: 'passive', desc: '다음 손실 절반' },
  amulet: { name: '건강 부적', icon: '🧿', kind: 'passive', desc: '다음 부상·나쁜 일 1번 무효' },
  lotto: { name: '로또', icon: '🎱', kind: 'passive', desc: '전국 로또 추첨 참가권' },
  coupon: { name: '할인 쿠폰', icon: '🎟️', kind: 'passive', desc: '상점 50% 할인' },
  lawyer: { name: '변호사', icon: '⚖️', kind: 'passive', desc: '뒤통수 카드 1번 자동 방어' },
  cut_line: { name: '새치기', icon: '✂️', kind: 'sabotage', desc: '대상의 다음 룰렛 −3칸 (최소 1)' },
  noise: { name: '층간소음', icon: '📢', kind: 'sabotage', desc: '대상의 다음 룰렛 2번 중 작은 값' },
  tax_audit: { name: '세무조사', icon: '🧾', kind: 'sabotage', desc: '대상 현금 10% 추징' },
  complaint: { name: '민원', icon: '📮', kind: 'sabotage', desc: '직장인 경험치 −2, 아니면 벌금' },
  gossip: { name: '뒷담화', icon: '🗣️', kind: 'sabotage', desc: '대상 매력 −1' },
});

export const DEFAULT_ITEMS = Object.freeze({
  car: { name: '자동차', icon: '🚗', desc: '룰렛 1이 나오면 2칸' },
  laptop: { name: '노트북', icon: '💻', desc: '지력 +1, 창작·e스포츠 급여 +10%' },
  gym_pass: { name: '헬스 이용권', icon: '🏋️', desc: '체력 +1' },
  designer_bag: { name: '명품 가방', icon: '👜', desc: '매력 +1' },
  lucky_cat: { name: '행운의 고양이', icon: '🐱', desc: '운 +1' },
  massage_chair: { name: '안마의자', icon: '💺', desc: '노년 체력 감소 방지' },
});

export const DEFAULT_HAND_LIMIT = 5;

function listOf(v, key) {
  if (Array.isArray(v)) return v;
  if (Array.isArray(v?.[key])) return v[key];
  return [];
}

/** Normalized `/api/meta.cards` → {handLimit, list, byId}. */
export function cardDefs(meta) {
  const src = meta?.cards;
  const list = listOf(src, 'cards').filter((c) => c?.id);
  const lim = Number(src?.handLimit);
  return { handLimit: Number.isFinite(lim) && lim > 0 ? lim : DEFAULT_HAND_LIMIT, list, byId: new Map(list.map((c) => [c.id, c])) };
}

/** Card definition (meta wins, contract fallback, else a minimal entry) → {id, name, icon, kind, desc, price, jobOnly, …}. */
export function cardInfo(id, meta) {
  if (!id) return null;
  const def = cardDefs(meta).byId.get(id);
  const fb = DEFAULT_CARDS[id];
  const base = { ...(fb ?? {}), ...(def ?? {}) };
  const kind = CARD_KINDS[base.kind] ? base.kind : 'instant';
  return { ...base, id, name: base.name ?? id, icon: base.icon ?? '🃏', kind, desc: base.desc ?? '', jobOnly: base.jobOnly ?? null, known: !!(def || fb) };
}

/** Item definition → {id, name, icon, desc, price, resale, …}. */
export function itemInfo(id, meta) {
  if (!id) return null;
  const def = listOf(meta?.items, 'items').find((i) => i?.id === id);
  const fb = DEFAULT_ITEMS[id];
  const base = { ...(fb ?? {}), ...(def ?? {}) };
  return { ...base, id, name: base.name ?? id, icon: base.icon ?? '🎁', desc: base.desc ?? '', known: !!(def || fb) };
}

/** A character's hand → [{uid, id, info}] (tolerates plain id strings). */
export function handOf(character, meta) {
  const cards = Array.isArray(character?.cards) ? character.cards : [];
  return cards
    .map((c, i) => (typeof c === 'string' ? { uid: `${c}#${i}`, id: c } : c))
    .filter((c) => c?.id)
    .map((c) => ({ uid: String(c.uid ?? c.id), id: c.id, info: cardInfo(c.id, meta) }));
}

/** A character's items → [{id, info}]. */
export function itemsOf(character, meta) {
  const items = Array.isArray(character?.items) ? character.items : [];
  return items.map((it) => (typeof it === 'string' ? it : it?.id)).filter(Boolean).map((id) => ({ id, info: itemInfo(id, meta) }));
}

function currentCharacter(room) {
  const t = room?.turn;
  const id = t?.order?.[t.currentIndex];
  return (room?.characters ?? []).find((c) => c.id === id) ?? null;
}

function jobName(jobId, meta) {
  const jobs = meta?.jobs;
  const list = Array.isArray(jobs) ? jobs : Array.isArray(jobs?.jobs) ? jobs.jobs : [];
  return list.find((j) => j?.id === jobId)?.name ?? (jobId === 'politician' ? '국회의원' : jobId);
}

/**
 * Can `character` play `card` now? (UI only — the server decides.)
 * Rules: playing room, my character, its turn, `awaitSpin` without an open prompt, no card used this turn
 * (`turn.cardUsed`), not a passive card, `jobOnly` matches the current job, a sabotage card needs a valid target.
 * @returns {{playable: boolean, reason: string|null, needsTarget: boolean, kind: string}}
 */
export function cardPlayability(room, character, card, { meta = null, spectator = false } = {}) {
  const info = card?.info ?? cardInfo(card?.id, meta);
  const kind = info?.kind ?? 'instant';
  const needsTarget = kind === 'sabotage';
  const no = (reason) => ({ playable: false, reason, needsTarget, kind });
  if (!info) return no('알 수 없는 카드예요.');
  if (kind === 'passive') return no('자동으로 발동되는 카드예요.');
  if (spectator || room?.me?.role === 'spectator') return no('관전자는 카드를 쓸 수 없어요.');
  if (room?.status !== 'playing') return no('게임이 진행 중이 아니에요.');
  if (!character?.isMe) return no('내 캐릭터의 카드만 쓸 수 있어요.');
  if (character.finished) return no('골인한 캐릭터는 카드를 쓸 수 없어요.');
  if (info.jobOnly && character.job?.id !== info.jobOnly) return no(`${jobName(info.jobOnly, meta)}만 쓸 수 있는 카드예요.`);
  const cur = currentCharacter(room);
  if (cur?.id !== character.id) return no('내 차례에만 쓸 수 있어요.');
  const t = room.turn;
  if (t.phase !== 'awaitSpin' || t.pending) return no('룰렛을 돌리기 전에만 쓸 수 있어요.');
  if (t.cardUsed) return no('이번 턴에는 이미 카드를 썼어요.');
  if (needsTarget && !sabotageTargets(room, character).some((x) => x.valid)) return no('노릴 수 있는 상대가 없어요.');
  return { playable: true, reason: null, needsTarget, kind };
}

/**
 * Sabotage targets: every other unfinished character; not valid when this attacker already targeted it this round
 * or the previous one (`target.lastTargetedBy = {attackerId: round}`, the server's rule).
 * @returns {{char: object, valid: boolean, reason: string|null}[]}
 */
export function sabotageTargets(room, attacker) {
  const round = Number(room?.turn?.round);
  return (room?.characters ?? [])
    .filter((c) => c.id !== attacker?.id && !c.finished)
    .map((c) => {
      const last = isObj(c.lastTargetedBy) ? Number(c.lastTargetedBy[attacker?.id]) : NaN;
      const reason = Number.isFinite(last) && Number.isFinite(round) && last >= round - 1 ? '같은 캐릭터를 연달아 노릴 수 없어요.' : null;
      return { char: c, valid: !reason, reason };
    })
    .sort((a, b) => Number(b.valid) - Number(a.valid));
}

// ---------- trades & gifts ----------
const intAmount = (v) => {
  if (v === '' || v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  // digits only: 「1e3」, 「+5」, 「0x10」 are not amounts (Number() would accept them)
  const t = String(v).trim();
  if (!/^\d+$/.test(t)) return t === '' ? null : NaN;
  return Number(t);
};

/** One side of a trade form → payload `{money}` | `{cardUid}` | {} (+ error). */
function sidePayload(side, owner, label, { checkMoney = true } = {}) {
  if (!side || side.kind === 'none' || !side.kind) return { payload: {}, error: null };
  if (side.kind === 'money') {
    const n = intAmount(side.money);
    if (n == null) return { payload: {}, error: `${label} 금액을 입력하세요.` };
    if (Number.isNaN(n)) return { payload: {}, error: `${label} 금액은 숫자로만 입력하세요 (만원 단위).` };
    if (!Number.isInteger(n) || n <= 0) return { payload: {}, error: `${label} 금액은 1만원 이상의 정수여야 해요.` };
    if (checkMoney && n > Math.floor(Number(owner?.money) || 0)) return { payload: {}, error: `${label}: ${owner?.name ?? ''}의 현금이 부족해요.` };
    return { payload: { money: n }, error: null };
  }
  if (side.kind === 'card') {
    if (!side.cardUid) return { payload: {}, error: `${label} 카드를 고르세요.` };
    const has = (owner?.cards ?? []).some((c) => String(c?.uid ?? c) === String(side.cardUid));
    if (!has) return { payload: {}, error: `${label}: 그 카드는 이제 손패에 없어요.` };
    return { payload: { cardUid: side.cardUid }, error: null };
  }
  return { payload: {}, error: null };
}

/**
 * Trade offer form → `{ok, error, body}` (body = the `offerTrade` action).
 * form = {fromId, toId, give: {kind: money|card, money?, cardUid?}, want: {…}}
 * Rules (mirror the server): from is mine, to is someone else's (no trades between my own characters — use a gift),
 * neither has finished, each side is exactly one of money / card, not money ↔ money, money within the holder's cash
 * (both sides), cards still in hand, one open offer per character.
 */
export function validateTrade(form, { room = null } = {}) {
  const chars = room?.characters ?? [];
  const from = chars.find((c) => c.id === form?.fromId);
  const to = chars.find((c) => c.id === form?.toId);
  const fail = (error) => ({ ok: false, error, body: null });
  if (room?.me?.role === 'spectator') return fail('관전자는 거래할 수 없어요.');
  if (room && room.status !== 'playing') return fail('게임 중에만 거래할 수 있어요.');
  if (!from || !from.isMe) return fail('거래를 제안할 내 캐릭터를 고르세요.');
  if (!to) return fail('거래할 상대를 고르세요.');
  if (from.id === to.id || to.isMe || (from.ownerId && from.ownerId === to.ownerId)) return fail('내 캐릭터끼리는 거래할 수 없어요. 선물을 써 보세요.');
  if (from.finished || to.finished) return fail('골인한 캐릭터는 거래할 수 없어요.');
  if (!['money', 'card'].includes(form.give?.kind) || !['money', 'card'].includes(form.want?.kind)) return fail('주고받을 것을 하나씩 고르세요.');
  if (form.give.kind === 'money' && form.want.kind === 'money') return fail('돈과 돈은 바꿀 수 없어요.');
  const g = sidePayload(form.give, from, '줄 것');
  if (g.error) return fail(g.error);
  const w = sidePayload(form.want, to, '받을 것');
  if (w.error) return fail(w.error);
  if (openTradeOf(room, from.id)) return fail(`${josaTopic(from.name)} 이미 답을 기다리는 거래 제안이 있어요.`);
  return { ok: true, error: null, body: { type: 'offerTrade', characterId: from.id, toId: to.id, give: g.payload, want: w.payload } };
}

/**
 * Gift form → `{ok, error, body}`; form = {fromId, toId, kind: money|card, money?, cardUid?} (own characters allowed:
 * 가족 송금). A full hand is fine (the receiver drops its oldest card).
 */
export function validateGift(form, { room = null } = {}) {
  const chars = room?.characters ?? [];
  const from = chars.find((c) => c.id === form?.fromId);
  const to = chars.find((c) => c.id === form?.toId);
  const fail = (error) => ({ ok: false, error, body: null });
  if (room?.me?.role === 'spectator') return fail('관전자는 선물할 수 없어요.');
  if (room && room.status !== 'playing') return fail('게임 중에만 선물할 수 있어요.');
  if (!from || !from.isMe) return fail('선물을 보낼 내 캐릭터를 고르세요.');
  if (!to || to.id === from.id) return fail('선물 받을 캐릭터를 고르세요.');
  const side = sidePayload({ kind: form.kind, money: form.money, cardUid: form.cardUid }, from, '선물');
  if (side.error) return fail(side.error);
  if (!Object.keys(side.payload).length) return fail('보낼 돈이나 카드를 고르세요.');
  return { ok: true, error: null, body: { type: 'gift', characterId: from.id, toId: to.id, ...side.payload } };
}

/** The receiver's hand is full → the oldest card will be dropped (UI note). */
export function handFull(character, meta) {
  return (Array.isArray(character?.cards) ? character.cards.length : 0) >= cardDefs(meta).handLimit;
}

/** Open (not expired) trades of a room at server time `now`. */
export function openTrades(room, now = Date.now()) {
  return (Array.isArray(room?.trades) ? room.trades : []).filter((t) => t && (!t.status || t.status === 'pending') && !(Number(t.expiresAt) > 0 && Number(t.expiresAt) <= now));
}

/** The open offer a character made (one per character), or null. */
export function openTradeOf(room, charId, now = Date.now()) {
  return openTrades(room, now).find((t) => t.fromId === charId) ?? null;
}

/** Split open trades into incoming (to one of my characters) and outgoing (from one of mine). */
export function tradeLists(room, now = Date.now()) {
  const mine = new Set((room?.characters ?? []).filter((c) => c.isMe).map((c) => c.id));
  const open = openTrades(room, now);
  return { incoming: open.filter((t) => mine.has(t.toId) && !mine.has(t.fromId)), outgoing: open.filter((t) => mine.has(t.fromId)) };
}

/**
 * One side of a trade / gift → text ("💰 50만원", "🃏 택시", "없음").
 * `hands` = characters whose cards resolve `cardUid` → card id (the giver's hand).
 */
export function tradeSideText(side, { owner = null, meta = null, won = (n) => `${n}만원` } = {}) {
  if (!isObj(side)) return '없음';
  if (Number(side.money) > 0) return `💰 ${won(Number(side.money))}`;
  const id = side.cardId ?? (side.cardUid ? (owner?.cards ?? []).find((c) => String(c?.uid) === String(side.cardUid))?.id : null);
  if (id) {
    const info = cardInfo(id, meta);
    return `${info.icon} ${info.name}`;
  }
  if (side.cardUid) return '🃏 카드';
  return '없음';
}

/** Trade resolution status → Korean. */
export const TRADE_STATUS = Object.freeze({ accepted: '성사', rejected: '거절', expired: '시간 초과', cancelled: '취소' });

// ---------- spin modifiers (sabotage / energy / taxi) ----------
/**
 * Badges for `character.spinMods [{kind: plus|max2|minus|min2, value?, by?}]` → [{text, kind: good|bad, title}].
 */
export function spinModBadges(spinMods) {
  if (!Array.isArray(spinMods)) return [];
  return spinMods
    .map((m) => {
      const v = Number(m?.value);
      switch (m?.kind) {
        case 'plus':
          return { text: `⚡+${Number.isFinite(v) ? v : 2}`, kind: 'good', title: `다음 룰렛 +${Number.isFinite(v) ? v : 2}칸` };
        case 'max2':
          return { text: '🚕×2', kind: 'good', title: '다음 룰렛: 2번 중 큰 값' };
        case 'minus':
          return { text: `✂️−${Number.isFinite(v) ? v : 3}`, kind: 'bad', title: `다음 룰렛 −${Number.isFinite(v) ? v : 3}칸 (최소 1)` };
        case 'min2':
          return { text: '📢×2↓', kind: 'bad', title: '다음 룰렛: 2번 중 작은 값' };
        default:
          return null;
      }
    })
    .filter(Boolean);
}

const MOD_GLYPH = { plus: '⚡', minus: '✂️', max2: '🚕', min2: '📢' };
/**
 * What a card / item did to a roulette (`spun {value, steps?, rolls?, mods?, car?}`) → "🚕 3·8 → 8칸", "✂️ 2칸",
 * "🚗 2칸" — null when nothing changed it (military halving has its own 🪖 note).
 */
export function spinNote(spun) {
  if (!spun || spun.halved) return null;
  const mods = Array.isArray(spun.mods) ? spun.mods : [];
  const rolls = Array.isArray(spun.rolls) && spun.rolls.length > 1 ? spun.rolls : null;
  const steps = Number.isFinite(Number(spun.steps)) ? Number(spun.steps) : Number(spun.value);
  const moved = Number.isFinite(steps) && steps !== Number(spun.value);
  if (!rolls && !moved && !spun.car) return null;
  const icon = spun.car && !mods.length ? '🚗' : MOD_GLYPH[mods.find((m) => MOD_GLYPH[m?.kind])?.kind] ?? (spun.car ? '🚗' : '🎲');
  return { text: `${icon} ${rolls ? `${rolls.join('·')} → ` : ''}${steps}칸`, steps, icon };
}

/**
 * Card row sizing: cards shrink from `max` to `min` px to fit `width`; below `min` the row scrolls.
 * @returns {{cardW: number, gap: number, scroll: boolean, total: number}}
 */
export function handLayout(count, width, { min = 64, max = 88, gap = 6 } = {}) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const w = Math.max(0, Number(width) || 0);
  if (!n) return { cardW: max, gap, scroll: false, total: 0 };
  const fit = Math.floor((w - gap * (n - 1)) / n);
  const cardW = Math.max(min, Math.min(max, fit));
  const total = cardW * n + gap * (n - 1);
  return { cardW, gap, scroll: total > w, total };
}

// ---------- holiday / lotto results ----------
const statLabel = { int: '지력', str: '체력', charm: '매력', luck: '운' };
const statIcon = { int: '🧠', str: '💪', charm: '✨', luck: '🍀' };

export const HOLIDAY_NAMES = Object.freeze({ seol: { name: '설날', icon: '🧧', title: '🧧 설날 대잔치' }, chuseok: { name: '추석', icon: '🌕', title: '🌕 추석 대잔치' } });
export function holidayTitle(kind) {
  return HOLIDAY_NAMES[kind]?.title ?? '🎉 명절 대잔치';
}

/**
 * `holidayResult.results` → display rows (name, 세뱃돈 ±, 잔소리 stat chip + line, 고스톱 stake / card / net, winner).
 * `won` = net 고스톱 money (+ winner, − loser); a boolean is read as the winner flag. `event.winners` (ids) wins.
 */
export function holidayRows(event, { characters = [], won = (n) => `${n}만원` } = {}) {
  const results = Array.isArray(event?.results) ? event.results : [];
  const winners = new Set(Array.isArray(event?.winners) ? event.winners : []);
  return results.map((r) => {
    const c = characters.find((x) => x.id === r.charId);
    const sebae = Number(r.sebae) || 0;
    const nag = isObj(r.nagging) ? r.nagging : null;
    const nd = Number(nag?.delta) || 0;
    const stake = Number(r.stake) || 0;
    const net = typeof r.won === 'number' ? r.won : 0;
    const card = Number(r.card);
    const winner = winners.has(r.charId) || r.won === true || net > 0;
    return {
      charId: r.charId,
      name: c?.name ?? r.charId ?? '',
      char: c ?? null,
      sebae: sebae ? { text: `🧧 세뱃돈 ${sebae > 0 ? '+' : ''}${won(sebae)}`, kind: sebae > 0 ? 'plus' : 'minus', value: sebae } : null,
      nagging: nag && nd ? { text: `${statIcon[nag.stat] ?? '⭐'} ${statLabel[nag.stat] ?? nag.stat} ${nd > 0 ? '+' : ''}${nd}`, kind: nd > 0 ? 'plus' : 'minus', stat: nag.stat, value: nd, line: typeof nag.line === 'string' ? nag.line : '' } : null,
      stake,
      stakeText: stake > 0 ? `판돈 ${won(stake)}` : '구경만',
      card: Number.isFinite(card) && card > 0 ? card : null,
      winner,
      net,
      winText: net > 0 ? `🏆 +${won(net)}` : net < 0 ? `−${won(-net)}` : winner ? '🏆 승리' : '',
    };
  });
}

/**
 * `lottoDraw` → {numbers, rows: [{charId, name, numbers: [{n, hit}], matches, prize, prizeText}]} (best first).
 */
export function lottoRows(event, { characters = [], won = (n) => `${n}만원` } = {}) {
  const numbers = (Array.isArray(event?.numbers) ? event.numbers : []).map(Number).filter(Number.isFinite);
  const drawn = new Set(numbers);
  const entries = Array.isArray(event?.entries) ? event.entries : Array.isArray(event?.winners) ? event.winners : [];
  const rows = entries.map((e) => {
    const nums = (Array.isArray(e.numbers) ? e.numbers : []).map(Number).filter(Number.isFinite);
    const matches = Number.isFinite(Number(e.matches)) ? Number(e.matches) : nums.filter((n) => drawn.has(n)).length;
    const prize = Number(e.prize) || 0;
    const c = characters.find((x) => x.id === e.charId);
    return {
      charId: e.charId,
      name: c?.name ?? e.charId ?? '',
      char: c ?? null,
      numbers: nums.map((n) => ({ n, hit: drawn.has(n) })),
      matches,
      prize,
      prizeText: prize > 0 ? `🎉 ${won(prize)}` : '꽝',
    };
  });
  rows.sort((a, b) => b.prize - a.prize || b.matches - a.matches);
  return { numbers, rows };
}
