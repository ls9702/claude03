// Stage 7 client helpers (pure: no DOM, no Node) — cards, items, trades, gifts, holiday / lotto results.
// Shared by game2d.js, cutin2d.js, cutinMap.js, the 3D board glue and node tests (test/client-cards.test.js).
//
//   cardDefs(meta) / cardInfo(id, meta) / itemInfo(id, meta)   → /api/meta.cards|items (+ built-in fallback names)
//   handOf(character, meta) / cardPlayability(...) / sabotageTargets(...)  → hand row + detail sheet
//   validateTrade(form, ctx) / validateGift(form, ctx) / tradeSideText / tradeLists  → 🤝 거래 · 🎁 선물
//   spinModBadges(spinMods) / handLayout(n, width)               → pawn / side-row badges, card row sizing
//   cardColor / cardTag / sortHand / handStacks / heldCards / meritCount / statusCards  → 파랑(보유) · 빨강(사용) · 부상 cards
//   rollConstraint(spinMods) / useCardBody / paydayAhead / tradableCards → 큰 수·작은 수·딱 그 칸·월급날 직행, trades
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

/**
 * Card colours (원작식 파랑 / 빨강): blue = 보유 효과 (works while in the hand), red = 사용 효과 (played before the spin, or
 * 「자동」 one-shots), status = the 🤕 부상 card (unusable, occupies a slot). `cards.json color` wins, else derived from `kind`.
 */
export const CARD_COLORS = Object.freeze({
  blue: { label: '보유', color: '#2f6fe0', dark: '#1e4fb8', soft: '#dbeafe' },
  red: { label: '사용', color: '#e2504c', dark: '#b91c1c', soft: '#fee2e2' },
  status: { label: '부상', color: '#8b919c', dark: '#4b5563', soft: '#e5e7eb' },
});

/**
 * Card kinds (engine behaviour) → label + frame colours of their colour. instant / sabotage / passive = red (passive shows
 * 「자동」), held / merit = blue, status = grey (부상).
 */
export const CARD_KINDS = Object.freeze({
  instant: { label: '사용', color: CARD_COLORS.red.color, dark: CARD_COLORS.red.dark, soft: CARD_COLORS.red.soft, colorId: 'red' },
  sabotage: { label: '뒤통수', color: '#c2410c', dark: '#9a3412', soft: '#ffedd5', colorId: 'red' },
  passive: { label: '자동', color: CARD_COLORS.red.color, dark: CARD_COLORS.red.dark, soft: '#fde8e8', colorId: 'red' },
  held: { label: '보유', color: CARD_COLORS.blue.color, dark: CARD_COLORS.blue.dark, soft: CARD_COLORS.blue.soft, colorId: 'blue' },
  merit: { label: '공적', color: CARD_COLORS.blue.color, dark: CARD_COLORS.blue.dark, soft: '#e0e7ff', colorId: 'blue' },
  status: { label: '부상', color: CARD_COLORS.status.color, dark: CARD_COLORS.status.dark, soft: CARD_COLORS.status.soft, colorId: 'status' },
});

/** Hand order: status first, then blue (held → merit), then red (instant → sabotage → auto). */
const KIND_ORDER = { status: 0, held: 1, merit: 2, instant: 3, sabotage: 4, passive: 5 };

/** Contract fallback (names / icons / kinds) when `/api/meta.cards` is missing or doesn't know an id. */
export const DEFAULT_CARDS = Object.freeze({
  study: { name: '벼락치기', icon: '📖', kind: 'instant', color: 'red', desc: '지력 +1' },
  insider: { name: '인싸력', icon: '😎', kind: 'instant', color: 'red', desc: '매력 +1' },
  energy: { name: '에너지 드링크', icon: '⚡', kind: 'instant', color: 'red', desc: '이번 룰렛 +2칸' },
  taxi: { name: '택시', icon: '🚕', kind: 'instant', color: 'red', desc: '룰렛을 2번 돌려 큰 값으로 이동' },
  pledge: { name: '공약', icon: '🗳️', kind: 'instant', color: 'red', desc: '국회의원 전용: 모두에게서 후원금', jobOnly: 'politician' },
  bonus: { name: '보너스', icon: '💰', kind: 'passive', color: 'red', desc: '다음 월급 2배' },
  insurance: { name: '보험', icon: '☂️', kind: 'passive', color: 'red', desc: '다음 손실 절반' },
  amulet: { name: '건강 부적', icon: '🧧', kind: 'passive', color: 'red', desc: '다음 부상·나쁜 일 1번 무효' },
  lotto: { name: '로또', icon: '🎱', kind: 'passive', color: 'red', desc: '전국 로또 추첨 참가권' },
  coupon: { name: '할인 쿠폰', icon: '🎟️', kind: 'passive', color: 'red', desc: '상점 50% 할인' },
  lawyer: { name: '변호사', icon: '⚖️', kind: 'passive', color: 'red', desc: '뒤통수 카드 1번 자동 방어' },
  cut_line: { name: '새치기', icon: '✂️', kind: 'sabotage', color: 'red', desc: '대상의 다음 룰렛 −3칸 (최소 1)' },
  noise: { name: '층간소음', icon: '📢', kind: 'sabotage', color: 'red', desc: '대상의 다음 룰렛 2번 중 작은 값' },
  tax_audit: { name: '세무조사', icon: '🧾', kind: 'sabotage', color: 'red', desc: '대상 현금 10% 추징' },
  complaint: { name: '민원', icon: '📮', kind: 'sabotage', color: 'red', desc: '직장인 경험치 −2, 아니면 벌금' },
  gossip: { name: '뒷담화', icon: '🗣️', kind: 'sabotage', color: 'red', desc: '대상 매력 −1' },
  // blue (보유 효과)
  marriage_luck: { name: '결혼운◎', icon: '💞', kind: 'held', color: 'blue', desc: '가지고 있는 동안 호감도가 더 많이 올라요', hold: { until: 'married' } },
  popular: { name: '인기 폭발◎', icon: '🌟', kind: 'held', color: 'blue', desc: '만남 후보의 ★이 오르고 데이트 호감도 +2' },
  research: { name: '연구열심', icon: '🔬', kind: 'held', color: 'blue', desc: '의사·연구원이 되려면 필요해요', requirement: true },
  charisma: { name: '카리스마◎', icon: '🎤', kind: 'held', color: 'blue', desc: '국회의원·아이돌·국민 MC가 되려면 필요해요', requirement: true },
  tongue: { name: '절대미각', icon: '👅', kind: 'held', color: 'blue', desc: '셰프가 되려면 필요해요', requirement: true },
  iron_body: { name: '강철 체력', icon: '🦾', kind: 'held', color: 'blue', desc: '운동선수가 되려면 필요해요', requirement: true },
  health_charm: { name: '건강기원 부적', icon: '🧿', kind: 'held', color: 'blue', desc: '가지고 있는 동안 다치지 않아요' },
  salary_charm: { name: '월급 부적', icon: '💴', kind: 'held', color: 'blue', desc: '가지고 있는 동안 월급 +10%' },
  merit: { name: '공적 카드', icon: '🏅', kind: 'merit', color: 'blue', desc: '승진 조건 · 여러 장 쌓을 수 있어요' },
  // red (사용 효과) — roulette cards
  big_roll: { name: '큰 수 카드', icon: '🔼', kind: 'instant', color: 'red', desc: '이번 룰렛은 6~10만 나와요', effect: { range: [6, 10] } },
  small_roll: { name: '작은 수 카드', icon: '🔽', kind: 'instant', color: 'red', desc: '이번 룰렛은 1~5만 나와요', effect: { range: [1, 5] } },
  exact_roll: { name: '딱 그 칸 카드', icon: '🎯', kind: 'instant', color: 'red', desc: '1~10 중 원하는 숫자만큼 이동해요', effect: { exact: true } },
  payday_rush: { name: '월급날 직행', icon: '💨', kind: 'instant', color: 'red', desc: '앞의 💵 월급날 칸으로 바로 가요 (지나가는 칸은 무시)', effect: { rush: true } },
  // status
  injury: { name: '부상', icon: '🤕', kind: 'status', color: 'status', desc: '쓸 수도, 줄 수도 없어요 · 부상이 나으면 사라져요' },
});

export const DEFAULT_ITEMS = Object.freeze({
  car: { name: '자동차', icon: '🚗', desc: '룰렛 1이 나오면 2칸' },
  laptop: { name: '노트북', icon: '💻', desc: '지력 +1, 창작·e스포츠 급여 +10%' },
  gym_pass: { name: '헬스 이용권', icon: '🏋️', desc: '체력 +1' },
  designer_bag: { name: '명품 가방', icon: '👜', desc: '매력 +1' },
  lucky_cat: { name: '행운의 고양이', icon: '🐱', desc: '운 +1' },
  massage_chair: { name: '안마의자', icon: '💺', desc: '노년 체력 감소 방지' },
});

export const DEFAULT_HAND_LIMIT = 6;

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

/** A card definition's colour: blue | red | status (`color` wins when valid; status cards are always status). */
export function cardColor(info) {
  if (!info) return 'red';
  if (info.kind === 'status') return 'status';
  if (CARD_COLORS[info.color]) return info.color;
  return CARD_KINDS[info.kind]?.colorId ?? 'red';
}

/** The corner tag of a card face: 보유 (blue) / 사용 (red) / 자동 (red auto) / 부상 (status). */
export function cardTag(info) {
  const color = cardColor(info);
  if (color === 'status') return '부상';
  if (color === 'blue') return '보유';
  return info?.kind === 'passive' ? '자동' : '사용';
}

const exactCard = (info) => !!(info && (info.id === 'exact_roll' || info.effect?.exact || info.needsValue));
const rushCard = (info) => !!(info && (info.id === 'payday_rush' || info.effect?.rush));

/** Card definition (meta wins, contract fallback, else a minimal entry) → {id, name, icon, kind, color, tag, desc, price, jobOnly, …}. */
export function cardInfo(id, meta) {
  if (!id) return null;
  const def = cardDefs(meta).byId.get(id);
  const fb = DEFAULT_CARDS[id];
  const base = { ...(fb ?? {}), ...(def ?? {}) };
  const kind = CARD_KINDS[base.kind] ? base.kind : base.color === 'blue' ? 'held' : 'instant';
  const info = { ...base, id, name: base.name ?? id, icon: base.icon ?? '🃏', kind, desc: base.desc ?? '', jobOnly: base.jobOnly ?? null, known: !!(def || fb) };
  info.color = cardColor(info);
  info.tag = cardTag(info);
  info.auto = kind === 'passive';
  info.needsValue = exactCard(info);
  info.rush = rushCard(info);
  return info;
}

/** Player-facing kind line: 「🔵 보유 카드」「🔴 사용 카드」「🔴 자동 카드」「💢 뒤통수 카드」「🏅 공적 카드」「🤕 부상 카드」. */
export function cardKindLabel(info) {
  switch (info?.kind) {
    case 'status':
      return '🤕 부상 카드';
    case 'merit':
      return '🏅 공적 카드 · 보유';
    case 'held':
      return '🔵 보유 카드';
    case 'sabotage':
      return '🔴 사용 카드 · 💢 뒤통수';
    case 'passive':
      return '🔴 자동 카드';
    default:
      return info?.color === 'blue' ? '🔵 보유 카드' : '🔴 사용 카드';
  }
}

const HOLD_UNTIL = { married: '결혼하면 사라져요', healed: '부상이 나으면 사라져요', job: '직업을 얻으면 사라져요' };

/**
 * How a card works, for the card sheet: {title, text} — 보유 효과 (kept while held + its `hold.until`), 사용 효과, 자동, 부상, 공적.
 */
export function cardEffectText(info) {
  switch (info?.kind) {
    case 'status':
      return { title: '🤕 부상 카드', text: '쓸 수도, 주고받을 수도 없어요. 손패 한 칸을 차지하고, 부상이 나으면 저절로 사라져요.' };
    case 'merit':
      return { title: '🏅 공적 카드', text: '일에서 세운 공적이에요. 몇몇 직업은 공적 카드가 있어야 승진 시험을 볼 수 있고, 승진하면 그만큼 사용돼요. 선물할 수 있어요.' };
    case 'held': {
      const until = HOLD_UNTIL[info?.hold?.until] ?? (typeof info?.hold?.until === 'string' ? info.hold.until : '');
      return { title: '🔵 보유 효과', text: `손패에 있는 동안 효과가 계속돼요 (따로 쓰지 않아요).${info?.requirement ? ' 직업의 취업 조건이 되기도 해요.' : ''}${until ? ` ${until}.` : ''}` };
    }
    case 'passive':
      return { title: '🔴 자동 사용', text: '조건이 되면 저절로 한 번 발동하고 사라져요.' };
    case 'sabotage':
      return { title: '🔴 사용 효과 · 뒤통수', text: '내 차례, 룰렛을 돌리기 전에 다른 캐릭터에게 써요 (턴당 1장).' };
    default:
      return { title: '🔴 사용 효과', text: '내 차례, 룰렛을 돌리기 전에 써요 (턴당 1장).' };
  }
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

/** Hand sorted for display: status, blue (held → merit), red (instant → sabotage → auto); stable within a group. */
export function sortHand(hand) {
  return (Array.isArray(hand) ? hand : [])
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (KIND_ORDER[a.c.info?.kind] ?? 9) - (KIND_ORDER[b.c.info?.kind] ?? 9) || a.i - b.i)
    .map((x) => x.c);
}

/**
 * Sorted hand with 🏅 merit cards stacked into one entry per id: [{uid, id, info, count, uids}] (count 1 for the rest).
 * The stack's `uid` is its oldest card.
 */
export function handStacks(hand) {
  const out = [];
  const stacks = new Map();
  for (const c of sortHand(hand)) {
    if (c.info?.kind === 'merit') {
      const s = stacks.get(c.id);
      if (s) {
        s.count += 1;
        s.uids.push(c.uid);
        continue;
      }
      const e = { ...c, count: 1, uids: [c.uid] };
      stacks.set(c.id, e);
      out.push(e);
      continue;
    }
    out.push({ ...c, count: 1, uids: [c.uid] });
  }
  return out;
}

/** 🏅 공적 카드 in a hand. */
export function meritCount(character, meta) {
  return handOf(character, meta).filter((c) => c.info.kind === 'merit').length;
}

/** 🤕 status (injury) cards in a hand. */
export function statusCards(character, meta) {
  return handOf(character, meta).filter((c) => c.info.kind === 'status');
}

/**
 * Blue cards whose effect everybody should see (side list icon row): held cards (dedup by id with a count) — merit cards
 * are counted separately (`meritCount`). → [{id, icon, name, desc, count}]
 */
export function heldCards(character, meta) {
  const map = new Map();
  for (const c of sortHand(handOf(character, meta))) {
    if (c.info.kind !== 'held') continue;
    const e = map.get(c.id);
    if (e) e.count += 1;
    else map.set(c.id, { id: c.id, icon: c.info.icon, name: c.info.name, desc: c.info.desc, count: 1, requirement: !!c.info.requirement });
  }
  return [...map.values()];
}

/** Does the hand hold card `cardId`? */
export function hasCard(character, cardId) {
  return (Array.isArray(character?.cards) ? character.cards : []).some((c) => (typeof c === 'string' ? c : c?.id) === cardId);
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

const HALT_TYPES = new Set(['salary', 'stop', 'goal']);

/**
 * The next forced stop ahead of a character (the server's HALT tiles: 💵 salary, the 🔀 fork `stop`, the 🏁 goal) on its path:
 * a route track runs into the rejoin tile and on along the ring; loops wrap; the final race ends at the goal. → tile | null
 */
export function nextHaltTile(room, character) {
  const pos = character?.position ?? {};
  const eras = room?.board?.eras;
  const era = Array.isArray(eras) ? eras[Number.isInteger(pos.eraIndex) ? pos.eraIndex : Number(room?.eraIndex) || 0] : null;
  const tiles = Array.isArray(era?.tiles) ? era.tiles : null;
  if (!tiles?.length) return null;
  const linear = era.loop === false || !!era.final;
  const idx = Number.isFinite(Number(pos.index)) ? Number(pos.index) : -1;
  const route = pos.route && pos.route !== 'main' ? era.routes?.[pos.route]?.tiles : null;
  let mainFrom = idx + 1;
  if (route) {
    for (let j = Math.max(0, idx + 1); j < route.length; j++) if (HALT_TYPES.has(route[j]?.type)) return route[j];
    const fork = Number.isInteger(era.fork) ? era.fork : tiles.findIndex((t) => t?.type === 'stop');
    mainFrom = Number.isInteger(era.rejoin) ? era.rejoin : fork + 1;
  }
  const n = tiles.length;
  for (let k = 0; k < n; k++) {
    const i = mainFrom + k;
    if (linear && i >= n) break;
    const t = tiles[((i % n) + n) % n];
    if (HALT_TYPES.has(t?.type)) return t;
  }
  return null;
}

/**
 * Can 월급날 직행 run? The server moves to the next forced stop ahead and refuses when that stop is not a 💵 payday (the fork /
 * the goal first, or no payday left on the final track). Unknown boards → true (the server decides).
 */
export function paydayAhead(room, character) {
  const pos = character?.position ?? {};
  const eras = room?.board?.eras;
  const era = Array.isArray(eras) ? eras[Number.isInteger(pos.eraIndex) ? pos.eraIndex : Number(room?.eraIndex) || 0] : null;
  if (!era || !Array.isArray(era.tiles) || !era.tiles.length) return true;
  return nextHaltTile(room, character)?.type === 'salary';
}

/**
 * Can `character` play `card` now? (UI only — the server decides.)
 * Rules: playing room, my character, its turn, `awaitSpin` without an open prompt, no card used this turn
 * (`turn.cardUsed`), a red card that isn't 「자동」 (blue held / merit and the 🤕 status card are never played), `jobOnly` matches
 * the current job, a sabotage card needs a valid target, 딱 그 칸 needs a number (`needsValue` → `useCard {value}`),
 * 월급날 직행 needs a payday ahead.
 * @returns {{playable: boolean, reason: string|null, needsTarget: boolean, needsValue: boolean, kind: string, color: string}}
 */
export function cardPlayability(room, character, card, { meta = null, spectator = false } = {}) {
  const info = card?.info ?? cardInfo(card?.id, meta);
  const kind = info?.kind ?? 'instant';
  const color = info?.color ?? 'red';
  const needsTarget = kind === 'sabotage';
  const needsValue = !!info?.needsValue;
  const no = (reason) => ({ playable: false, reason, needsTarget, needsValue, kind, color });
  if (!info) return no('알 수 없는 카드예요.');
  if (kind === 'status') return no('부상 카드는 쓸 수 없어요 · 부상이 나으면 사라져요.');
  if (kind === 'merit') return no('공적 카드는 승진할 때 쓰여요 · 가지고만 있으면 돼요.');
  if (kind === 'held' || color === 'blue') return no('보유 카드예요 · 가지고만 있어도 효과가 있어요.');
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
  if (info.rush) {
    if (!paydayAhead(room, character)) return no('앞에 바로 갈 수 있는 💵 월급날이 없어요 (갈림길·골인이 먼저예요).');
  }
  return { playable: true, reason: null, needsTarget, needsValue, kind, color };
}

/** 딱 그 칸 카드: a valid chosen number (1..10) or null. */
export function exactValue(v) {
  const n = typeof v === 'number' ? v : /^\d+$/.test(String(v ?? '').trim()) ? Number(String(v).trim()) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : null;
}

/**
 * The `useCard` action for a card sheet → `{ok, error, body}` (target for sabotage, `value` 1..10 for 딱 그 칸).
 */
export function useCardBody(character, card, { targetId = null, value = null, meta = null } = {}) {
  const info = card?.info ?? cardInfo(card?.id, meta);
  if (!character || !card || !info) return { ok: false, error: '카드를 찾을 수 없어요.', body: null };
  const body = { type: 'useCard', characterId: character.id, cardUid: card.uid };
  if (info.kind === 'sabotage') {
    if (!targetId) return { ok: false, error: '대상을 고르세요.', body: null };
    body.targetId = targetId;
  }
  if (info.needsValue) {
    const v = exactValue(value);
    if (v == null) return { ok: false, error: '이동할 숫자(1~10)를 고르세요.', body: null };
    body.value = v;
  }
  return { ok: true, error: null, body };
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
function sidePayload(side, owner, label, { checkMoney = true, meta = null } = {}) {
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
    const card = (owner?.cards ?? []).find((c) => String(c?.uid ?? c) === String(side.cardUid));
    if (!card) return { payload: {}, error: `${label}: 그 카드는 이제 손패에 없어요.` };
    const info = cardInfo(typeof card === 'string' ? card : card.id, meta);
    if (info?.kind === 'status') return { payload: {}, error: '🤕 부상 카드는 주고받을 수 없어요.' };
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
export function validateTrade(form, { room = null, meta = null } = {}) {
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
  const g = sidePayload(form.give, from, '줄 것', { meta });
  if (g.error) return fail(g.error);
  const w = sidePayload(form.want, to, '받을 것', { meta });
  if (w.error) return fail(w.error);
  if (openTradeOf(room, from.id)) return fail(`${josaTopic(from.name)} 이미 답을 기다리는 거래 제안이 있어요.`);
  return { ok: true, error: null, body: { type: 'offerTrade', characterId: from.id, toId: to.id, give: g.payload, want: w.payload } };
}

/**
 * Gift form → `{ok, error, body}`; form = {fromId, toId, kind: money|card, money?, cardUid?} (own characters allowed:
 * 가족 송금). A full hand is fine (the receiver drops its oldest card).
 */
export function validateGift(form, { room = null, meta = null } = {}) {
  const chars = room?.characters ?? [];
  const from = chars.find((c) => c.id === form?.fromId);
  const to = chars.find((c) => c.id === form?.toId);
  const fail = (error) => ({ ok: false, error, body: null });
  if (room?.me?.role === 'spectator') return fail('관전자는 선물할 수 없어요.');
  if (room && room.status !== 'playing') return fail('게임 중에만 선물할 수 있어요.');
  if (!from || !from.isMe) return fail('선물을 보낼 내 캐릭터를 고르세요.');
  if (!to || to.id === from.id) return fail('선물 받을 캐릭터를 고르세요.');
  const side = sidePayload({ kind: form.kind, money: form.money, cardUid: form.cardUid }, from, '선물', { meta });
  if (side.error) return fail(side.error);
  if (!Object.keys(side.payload).length) return fail('보낼 돈이나 카드를 고르세요.');
  return { ok: true, error: null, body: { type: 'gift', characterId: from.id, toId: to.id, ...side.payload } };
}

/**
 * Cards of `owner` that can go into a trade / gift: every card but the 🤕 status card (blue held and 🏅 merit cards move too).
 * → [{uid, id, info}] (sorted like the hand)
 */
export function tradableCards(owner, meta) {
  return sortHand(handOf(owner, meta)).filter((c) => c.info.kind !== 'status');
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

// ---------- spin modifiers (sabotage / energy / taxi / 큰 수 · 작은 수 · 딱 그 칸 · 월급날 직행) ----------
const BIG_MIN = 6;

/** A `range` mod's bounds (tolerant: `{min, max}`, `range: [a, b]`, `card: big_roll|small_roll`, `value: 'big'|'small'`). */
export function modRange(m) {
  if (!m) return null;
  const pair = Array.isArray(m.range) ? m.range : Array.isArray(m.value) ? m.value : null;
  let min = Number(m.min ?? pair?.[0]);
  let max = Number(m.max ?? pair?.[1]);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    const big = m.card === 'big_roll' || m.value === 'big' || m.dir === 'big';
    const small = m.card === 'small_roll' || m.value === 'small' || m.dir === 'small';
    if (!big && !small) return null;
    [min, max] = big ? [BIG_MIN, 10] : [1, BIG_MIN - 1];
  }
  const lo = Math.max(1, Math.min(min, max));
  const hi = Math.min(10, Math.max(min, max));
  return { min: lo, max: hi, big: lo >= BIG_MIN, icon: lo >= BIG_MIN ? '🔼' : '🔽', text: `${lo}~${hi}` };
}

/** The chosen number of an `exact` mod (1..10) or null. */
export function modExact(m) {
  const v = Number(m?.value ?? m?.target ?? m?.exact);
  return Number.isInteger(v) && v >= 1 && v <= 10 ? v : null;
}

/**
 * Badges for `character.spinMods [{kind: plus|max2|minus|min2|range|exact|rush, value?, min?, max?, by?}]`
 * → [{text, kind: good|bad, title}].
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
        case 'range': {
          const r = modRange(m);
          return r ? { text: `${r.icon}${r.min}–${r.max}`, kind: 'good', title: `다음 룰렛은 ${r.text}만 나와요 (${r.big ? '큰 수' : '작은 수'} 카드)` } : null;
        }
        case 'exact': {
          const x = modExact(m);
          return { text: `🎯${x ?? ''}`, kind: 'good', title: x ? `다음 룰렛: 딱 ${x}칸 이동` : '다음 룰렛: 고른 숫자만큼 이동' };
        }
        case 'rush':
          return { text: '💨월급날', kind: 'good', title: '다음 룰렛: 앞의 💵 월급날 칸으로 바로 이동' };
        default:
          return null;
      }
    })
    .filter(Boolean);
}

/**
 * What the next roulette of a character is bound to (dock hint, skill panel shading, 2D roulette pop):
 * `{min, max, exact, rush, text, short}` or null when nothing constrains it. Order: 월급날 직행 > 딱 그 칸 > 큰 / 작은 수.
 */
export function rollConstraint(spinMods) {
  const mods = Array.isArray(spinMods) ? spinMods : [];
  if (mods.some((m) => m?.kind === 'rush')) return { min: 1, max: 10, exact: null, rush: true, text: '💨 월급날 직행 카드: 룰렛 결과와 상관없이 앞의 💵 월급날로 가요', short: '💨 월급날 직행' };
  const ex = mods.find((m) => m?.kind === 'exact');
  if (ex) {
    const v = modExact(ex);
    return { min: v ?? 1, max: v ?? 10, exact: v, rush: false, text: `🎯 딱 그 칸 카드: ${v ? `딱 ${v}칸` : '고른 칸만큼'} 가요`, short: `🎯 ${v ?? ''}` };
  }
  const r = modRange(mods.find((m) => m?.kind === 'range'));
  if (r) return { min: r.min, max: r.max, exact: null, rush: false, text: `${r.icon} ${r.big ? '큰' : '작은'} 수 카드: 이번 룰렛은 ${r.text}만 나와요`, short: `${r.icon} ${r.min}–${r.max}` };
  return null;
}

const MOD_GLYPH = { plus: '⚡', minus: '✂️', max2: '🚕', min2: '📢', range: '🔼', exact: '🎯', rush: '💨' };
/**
 * What a card / item did to a roulette (`spun {value, steps?, rolls?, mods?, car?, rush?}`) → "🚕 3·8 → 8칸", "✂️ 2칸",
 * "🚗 2칸", "🔼 7칸 (6~10)", "🎯 딱 7칸", "💨 월급날 직행 12칸" — null when nothing changed it (military halving has its own 🪖 note).
 */
export function spinNote(spun) {
  if (!spun || spun.halved) return null;
  const mods = Array.isArray(spun.mods) ? spun.mods : [];
  const rolls = Array.isArray(spun.rolls) && spun.rolls.length > 1 ? spun.rolls : null;
  const steps = Number.isFinite(Number(spun.steps)) ? Number(spun.steps) : Number(spun.value);
  const rush = spun.rush || mods.some((m) => m?.kind === 'rush');
  if (rush) return { text: `💨 월급날 직행${Number.isFinite(steps) ? ` ${steps}칸` : ''}`, steps, icon: '💨', rush: true };
  const ex = mods.find((m) => m?.kind === 'exact');
  if (ex || spun.exact) return { text: `🎯 딱 ${Number.isFinite(steps) ? steps : modExact(ex) ?? ''}칸`, steps, icon: '🎯' };
  const r = modRange(mods.find((m) => m?.kind === 'range'));
  if (r && !rolls) return { text: `${r.icon} ${Number.isFinite(steps) ? steps : spun.value}칸 (${r.text})`, steps, icon: r.icon };
  const moved = Number.isFinite(steps) && steps !== Number(spun.value);
  if (!rolls && !moved && !spun.car) return null;
  const k = mods.find((m) => MOD_GLYPH[m?.kind])?.kind;
  const icon = spun.car && !mods.length ? '🚗' : k === 'range' ? r?.icon ?? '🔼' : MOD_GLYPH[k] ?? (spun.car ? '🚗' : '🎲');
  return { text: `${icon} ${rolls ? `${rolls.join('·')} → ` : ''}${steps}칸`, steps, icon };
}

/**
 * Card row sizing: cards shrink from `max` to `min` px to fit `width` (the gap tightens to `minGap` first when needed);
 * below `min` the row scrolls. Six cards fit a 390 px phone (row ≈ 330 px → 51 px cards).
 * @returns {{cardW: number, gap: number, scroll: boolean, total: number}}
 */
export function handLayout(count, width, { min = 46, max = 88, gap = 6, minGap = 4 } = {}) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const w = Math.max(0, Number(width) || 0);
  if (!n) return { cardW: max, gap, scroll: false, total: 0 };
  let g = gap;
  let fit = Math.floor((w - g * (n - 1)) / n);
  if (fit < min && minGap < gap) {
    g = minGap;
    fit = Math.floor((w - g * (n - 1)) / n);
  }
  const cardW = Math.max(min, Math.min(max, fit));
  const total = cardW * n + g * (n - 1);
  return { cardW, gap: g, scroll: total > w, total };
}

// ---------- cards leaving a hand (`cardLost {charId, cardId, uid, reason}`) ----------
const LOST = {
  married: { glyph: '💍', verb: '소멸', note: '결혼했어요' },
  healed: { glyph: '🩹', verb: '회복', note: '부상이 나았어요' },
  discarded: { glyph: '🗑️', verb: '버림', note: '손패가 가득 찼어요' },
  merit: { glyph: '🏅', verb: '사용', note: '승진에 썼어요' },
};

/**
 * `cardLost` → {glyph, text (chip / banner / float), reason, info, count}. `events` = several cardLost of one character
 * (🏅 공적 카드 ×n) merged: pass an array.
 */
export function cardLostInfo(event, meta, { count = 1 } = {}) {
  const e = event ?? {};
  const info = cardInfo(e.cardId, meta) ?? { name: '카드', icon: '🃏' };
  const r = LOST[e.reason] ?? { glyph: '💨', verb: '사라짐', note: '' };
  const n = Math.max(1, Number(count) || 1);
  let text;
  if (e.reason === 'healed' || info.kind === 'status') text = `🩹 부상 회복 · ${info.icon} 부상 카드 사라짐`;
  else if (e.reason === 'married') text = `💍 ${info.icon} ${info.name} 소멸`;
  else if (e.reason === 'merit') text = `🏅 공적 카드 ${n}장 사용`;
  else if (e.reason === 'discarded') text = `🗑️ ${info.icon} ${info.name}${n > 1 ? ` ×${n}` : ''} 버림`;
  else text = `${info.icon} ${info.name} ${r.verb}`;
  return { glyph: r.glyph, text, reason: e.reason ?? null, note: r.note, info, count: n };
}

/** Merge a character's cardLost events into chips (🏅 ×n counted once per reason + card). */
export function cardLostChips(events, meta) {
  const map = new Map();
  for (const e of Array.isArray(events) ? events : []) {
    if (e?.type && e.type !== 'cardLost') continue;
    const key = `${e.charId}|${e.reason}|${e.cardId}`;
    const m = map.get(key);
    if (m) m.count += 1;
    else map.set(key, { e, count: 1 });
  }
  return [...map.values()].map(({ e, count }) => ({ charId: e.charId, ...cardLostInfo(e, meta, { count }) }));
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
