// Blue (보유) / red (사용) cards — pure client helpers: colours / tags, hand order + 🏅 stacks, playability (blue / status never,
// 딱 그 칸 value, 월급날 직행 needs a payday ahead), useCard bodies, trades without status cards, spin mods / notes / roll
// constraints for the new kinds, handLayout for six cards on a 390 px phone, requirement badges (missing = red), cardLost
// chips / cut-in groups / banners, markup (frames, tags, stacks).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CARDS,
  cardColor,
  cardEffectText,
  cardInfo,
  cardKindLabel,
  cardLostChips,
  cardLostInfo,
  cardPlayability,
  cardTag,
  exactValue,
  handLayout,
  handOf,
  handStacks,
  heldCards,
  meritCount,
  modRange,
  nextHaltTile,
  paydayAhead,
  rollConstraint,
  sortHand,
  spinModBadges,
  spinNote,
  statusCards,
  tradableCards,
  useCardBody,
  validateGift,
  validateTrade,
} from '../public/js/shared/cards.js';
import { meritNeed, optionBadgeList, optionExtras, requirementBadges, requirementList } from '../public/js/shared/growth.js';
import { planCutins, tagLabel } from '../public/js/ui/cutinMap.js';
import { haltNote } from '../public/js/shared/loop.js';
import { classifyGroup, isBannerGroup } from '../public/js/ui/cutinPolicy.js';
import { cardChipHtml, cardHtml, shopOptionsHtml } from '../public/js/ui/cardArt.js';

// the server's cards.json shape for the new cards (color + kind)
const META = {
  cards: {
    handLimit: 6,
    cards: [
      { id: 'taxi', name: '택시', icon: '🚕', kind: 'instant', color: 'red', desc: '큰 값', price: 40 },
      { id: 'lawyer', name: '변호사 상담권', icon: '⚖️', kind: 'passive', color: 'red', desc: '방어', price: 60 },
      { id: 'cut_line', name: '새치기', icon: '🏃', kind: 'sabotage', color: 'red', desc: '−3칸', price: 40 },
      { id: 'marriage_luck', name: '결혼운◎', icon: '💞', kind: 'held', color: 'blue', desc: '호감도 +5', hold: { until: 'married' } },
      { id: 'research', name: '연구열심', icon: '🔬', kind: 'held', color: 'blue', desc: '의사·연구원', effect: { requirement: true } },
      { id: 'merit', name: '공적 카드', icon: '🏅', kind: 'merit', color: 'blue', desc: '승진' },
      { id: 'big_roll', name: '큰 수 카드', icon: '🔼', kind: 'instant', color: 'red', desc: '6~10', effect: { range: [6, 10] } },
      { id: 'exact_roll', name: '딱 그 칸 카드', icon: '🎯', kind: 'instant', color: 'red', desc: '고른 수', effect: { exact: true } },
      { id: 'payday_rush', name: '월급날 직행', icon: '💨', kind: 'instant', color: 'red', desc: '월급날까지', effect: { rush: 'salary' } },
      // the server marks the injury card blue + kind status: status wins
      { id: 'injury', name: '부상', icon: '🤕', kind: 'status', color: 'blue', desc: '부상 중' },
    ],
  },
  jobs: {
    jobs: [
      { id: 'doctor', name: '의사', icon: '🩺', requires: { stats: { int: 7 }, education: 'college', cards: ['research'] }, ranks: [{ name: '인턴', salary: 60 }, { name: '전문의', salary: 90 }, { name: '과장', salary: 130 }], rankUp: { stat: 'int', merit: 2 } },
      { id: 'politician', name: '국회의원', icon: '🎤', requires: { cards: ['charisma'] }, ranks: [{ name: 'a', salary: 1 }] },
    ],
  },
};

const HAND = [
  { uid: 'k1', id: 'taxi' },
  { uid: 'k2', id: 'merit' },
  { uid: 'k3', id: 'injury' },
  { uid: 'k4', id: 'research' },
  { uid: 'k5', id: 'merit' },
  { uid: 'k6', id: 'lawyer' },
];

function loopBoard() {
  const main = Array.from({ length: 20 }, (_, i) => ({ id: `young:main:${i}`, type: i === 0 ? 'start' : i === 10 ? 'salary' : 'money' }));
  const final = Array.from({ length: 12 }, (_, i) => ({ id: `senior:main:${i}`, type: i === 0 ? 'start' : i === 4 ? 'salary' : i === 11 ? 'goal' : 'money' }));
  return { eras: [{ id: 'young', loop: true, tiles: main }, { id: 'senior', loop: false, final: true, tiles: final }] };
}

function room({ cards = HAND, cardUsed = false, eraIndex = 0, index = 3, military = null } = {}) {
  return {
    status: 'playing',
    me: { role: 'player' },
    eraIndex,
    board: loopBoard(),
    turn: { order: ['c1', 'c2'], currentIndex: 0, phase: 'awaitSpin', pending: null, cardUsed, round: 2 },
    trades: [],
    characters: [
      { id: 'c1', name: '민수', isMe: true, ownerId: 'p1', money: 100, cards, position: { eraIndex, index }, military, stats: { int: 8 }, education: 'college', job: { id: 'doctor', rank: 1 } },
      { id: 'c2', name: '지영', isMe: false, ownerId: 'p2', money: 80, cards: [{ uid: 'k9', id: 'injury' }, { uid: 'k8', id: 'marriage_luck' }, { uid: 'k7', id: 'merit' }], position: { eraIndex, index: 5 }, lastTargetedBy: {} },
    ],
  };
}
const cardOf = (r, charId, uid) => handOf(r.characters.find((c) => c.id === charId), META).find((c) => c.uid === uid);

test('colours and tags: blue 보유 / red 사용 · 자동 / status 부상 (status wins over a blue colour); fallbacks for every new id', () => {
  const tag = (id) => [cardInfo(id, META).color, cardInfo(id, META).tag];
  assert.deepEqual(tag('taxi'), ['red', '사용']);
  assert.deepEqual(tag('lawyer'), ['red', '자동']);
  assert.deepEqual(tag('cut_line'), ['red', '사용']);
  assert.deepEqual(tag('marriage_luck'), ['blue', '보유']);
  assert.deepEqual(tag('merit'), ['blue', '보유']);
  assert.deepEqual(tag('injury'), ['status', '부상']);
  // without /api/meta.cards the contract fallbacks know every new card
  for (const id of ['marriage_luck', 'popular', 'research', 'charisma', 'tongue', 'iron_body', 'health_charm', 'salary_charm', 'merit', 'big_roll', 'small_roll', 'exact_roll', 'payday_rush', 'injury']) {
    const info = cardInfo(id, null);
    assert.ok(info.known, id);
    assert.ok(DEFAULT_CARDS[id].name && DEFAULT_CARDS[id].icon, id);
  }
  assert.equal(cardInfo('exact_roll', null).needsValue, true);
  assert.equal(cardInfo('payday_rush', null).rush, true);
  assert.equal(cardColor({ kind: 'held' }), 'blue');
  assert.equal(cardColor({ kind: 'instant', color: 'blue' }), 'blue');
  assert.equal(cardTag({ kind: 'passive' }), '자동');
  assert.equal(cardKindLabel(cardInfo('merit', META)), '🏅 공적 카드 · 보유');
  assert.match(cardEffectText(cardInfo('marriage_luck', META)).text, /결혼하면 사라져요/);
  assert.match(cardEffectText(cardInfo('injury', META)).text, /쓸 수도, 주고받을 수도 없어요/);
  // an unknown blue card from a newer server is a held card
  assert.equal(cardInfo('mystery', { cards: { cards: [{ id: 'mystery', color: 'blue', kind: 'weird' }] } }).kind, 'held');
});

test('hand order status → blue (held, merit) → red (instant, sabotage, auto); 🏅 merit stacks; held icons / counts', () => {
  const c = { cards: [...HAND, { uid: 'k7', id: 'cut_line' }] };
  assert.deepEqual(sortHand(handOf(c, META)).map((h) => h.uid), ['k3', 'k4', 'k2', 'k5', 'k1', 'k7', 'k6']);
  const stacks = handStacks(handOf(c, META));
  assert.deepEqual(stacks.map((s) => [s.id, s.count]), [['injury', 1], ['research', 1], ['merit', 2], ['taxi', 1], ['cut_line', 1], ['lawyer', 1]]);
  assert.deepEqual(stacks[2].uids, ['k2', 'k5']);
  assert.equal(meritCount(c, META), 2);
  assert.equal(statusCards(c, META).length, 1);
  assert.deepEqual(heldCards({ cards: [{ uid: 'a', id: 'research' }, { uid: 'b', id: 'research' }, { uid: 'c', id: 'merit' }] }, META).map((h) => [h.id, h.count]), [['research', 2]]);
});

test('playability: blue / merit / status / auto never; red on my turn; 딱 그 칸 needs a value; 월급날 직행 needs a payday ahead', () => {
  const r = room({ cards: [...HAND, { uid: 'k10', id: 'big_roll' }, { uid: 'k11', id: 'exact_roll' }, { uid: 'k12', id: 'payday_rush' }, { uid: 'k13', id: 'marriage_luck' }] });
  const me = r.characters[0];
  const pl = (uid) => cardPlayability(r, me, cardOf(r, 'c1', uid), { meta: META });
  assert.match(pl('k3').reason, /부상 카드는 쓸 수 없어요/);
  assert.match(pl('k2').reason, /공적 카드/);
  assert.match(pl('k4').reason, /보유 카드/);
  assert.match(pl('k13').reason, /보유 카드/);
  assert.equal(pl('k6').playable, false);
  assert.equal(pl('k1').playable, true);
  assert.equal(pl('k10').playable, true);
  const ex = pl('k11');
  assert.deepEqual([ex.playable, ex.needsValue], [true, true]);
  assert.equal(pl('k12').playable, true); // loop era: the next forced stop ahead is the payday
  // the final race: only a payday AFTER the current index counts
  const fin = room({ cards: [{ uid: 'k12', id: 'payday_rush' }], eraIndex: 1, index: 6 });
  const r2 = cardPlayability(fin, fin.characters[0], cardOf(fin, 'c1', 'k12'), { meta: META });
  assert.equal(r2.playable, false);
  assert.match(r2.reason, /월급날이 없어요/);
  assert.equal(paydayAhead(room({ eraIndex: 1, index: 2 }), { position: { eraIndex: 1, index: 2 } }), true);
  assert.equal(paydayAhead({}, {}), true); // unknown board → the server decides
  // route era: the fork (a stop) comes before any payday → refused; on a route track the route's payday counts
  const routeBoard = { eras: [{ id: 'young', loop: true, fork: 3, rejoin: 4, tiles: ['start', 'money', 'money', 'stop', 'merge', 'money', 'salary', 'money'].map((type, i) => ({ id: `m${i}`, type })), routes: { love: { tiles: ['heart', 'salary', 'heart'].map((type, i) => ({ id: `l${i}`, type })) }, money: { tiles: ['money', 'money', 'money'].map((type, i) => ({ id: `o${i}`, type })) } } }] };
  const at = (position) => paydayAhead({ board: routeBoard }, { position: { eraIndex: 0, ...position } });
  assert.equal(at({ route: 'main', index: 1 }), false); // the fork first
  assert.equal(at({ route: 'main', index: 5 }), true); // m6 salary
  assert.equal(at({ route: 'main', index: 6 }), false); // wraps round to the fork
  assert.equal(at({ route: 'love', index: 0 }), true); // l1 salary
  assert.equal(at({ route: 'money', index: 1 }), true); // rejoin → m6
  assert.equal(nextHaltTile({ board: routeBoard }, { position: { eraIndex: 0, route: 'love', index: 1 } }).id, 'm6');
  const mil = room({ cards: [{ uid: 'k12', id: 'payday_rush' }], military: { status: 'serving' } });
  assert.equal(cardPlayability(mil, mil.characters[0], cardOf(mil, 'c1', 'k12'), { meta: META }).playable, true); // the server allows it while serving
  // once per turn still applies
  const used = room({ cardUsed: true, cards: [{ uid: 'k10', id: 'big_roll' }] });
  assert.match(cardPlayability(used, used.characters[0], cardOf(used, 'c1', 'k10'), { meta: META }).reason, /이미 카드를 썼어요/);
});

test('useCard bodies: value 1..10 for 딱 그 칸, target for sabotage, plain otherwise', () => {
  const r = room({ cards: [{ uid: 'k11', id: 'exact_roll' }, { uid: 'k7', id: 'cut_line' }, { uid: 'k10', id: 'big_roll' }] });
  const me = r.characters[0];
  assert.equal(useCardBody(me, cardOf(r, 'c1', 'k11'), { meta: META }).ok, false);
  assert.match(useCardBody(me, cardOf(r, 'c1', 'k11'), { value: 11, meta: META }).error, /1~10/);
  assert.deepEqual(useCardBody(me, cardOf(r, 'c1', 'k11'), { value: 7, meta: META }).body, { type: 'useCard', characterId: 'c1', cardUid: 'k11', value: 7 });
  assert.deepEqual(useCardBody(me, cardOf(r, 'c1', 'k7'), { targetId: 'c2', meta: META }).body, { type: 'useCard', characterId: 'c1', cardUid: 'k7', targetId: 'c2' });
  assert.deepEqual(useCardBody(me, cardOf(r, 'c1', 'k10'), { meta: META }).body, { type: 'useCard', characterId: 'c1', cardUid: 'k10' });
  assert.equal(exactValue('3'), 3);
  assert.equal(exactValue('3.5'), null);
  assert.equal(exactValue(0), null);
});

test('trades / gifts: the 🤕 status card never moves; blue held and 🏅 merit cards trade', () => {
  const r = room();
  const opts = { room: r, meta: META };
  const give = (cardUid) => validateTrade({ fromId: 'c1', toId: 'c2', give: { kind: 'card', cardUid }, want: { kind: 'money', money: '10' } }, opts);
  assert.match(give('k3').error, /부상 카드/);
  assert.equal(give('k2').ok, true); // 🏅 merit cards trade too (server deviation)
  assert.equal(give('k4').ok, true); // 연구열심 (blue) can be traded
  const want = validateTrade({ fromId: 'c1', toId: 'c2', give: { kind: 'money', money: '10' }, want: { kind: 'card', cardUid: 'k9' } }, opts);
  assert.match(want.error, /부상 카드/);
  assert.equal(validateGift({ fromId: 'c1', toId: 'c2', kind: 'card', cardUid: 'k2' }, opts).ok, true);
  assert.match(validateGift({ fromId: 'c1', toId: 'c2', kind: 'card', cardUid: 'k3' }, opts).error, /부상 카드/);
  assert.deepEqual(tradableCards(r.characters[0], META).map((c) => c.id), ['research', 'merit', 'merit', 'taxi', 'lawyer']);
});

test('spin mods: 🔼 / 🔽 ranges, 🎯 exact, 💨 rush → badges, notes, roll constraints', () => {
  assert.deepEqual(
    spinModBadges([{ kind: 'range', min: 6, max: 10 }, { kind: 'range', range: [1, 5] }, { kind: 'range', card: 'big_roll' }, { kind: 'exact', value: 7 }, { kind: 'rush' }]).map((b) => b.text),
    ['🔼6–10', '🔽1–5', '🔼6–10', '🎯7', '💨월급날'],
  );
  assert.deepEqual(modRange({ kind: 'range', value: 'small' }), { min: 1, max: 5, big: false, icon: '🔽', text: '1~5' });
  assert.equal(modRange({ kind: 'range' }), null);
  assert.equal(spinNote({ value: 8, mods: [{ kind: 'range', min: 6, max: 10 }] }).text, '🔼 8칸 (6~10)');
  assert.equal(spinNote({ value: 3, mods: [{ kind: 'exact', value: 3 }] }).text, '🎯 딱 3칸');
  const rush = spinNote({ value: 2, steps: 11, mods: [{ kind: 'rush' }] });
  assert.deepEqual([rush.text, rush.rush], ['💨 월급날 직행 11칸', true]);
  assert.equal(spinNote({ value: 4, rush: true, steps: 9 }).text, '💨 월급날 직행 9칸');
  assert.equal(haltNote({ type: 'moved', halted: 'salary', rush: true }).text, '💨 월급날 직행! 도착');
  assert.equal(haltNote({ type: 'moved', halted: 'salary' }).text, '💵 월급날! 멈춤');
  // the old kinds are unchanged
  assert.equal(spinNote({ value: 3, steps: 8, rolls: [3, 8], mods: [{ kind: 'max2' }] }).text, '🚕 3·8 → 8칸');
  assert.equal(spinNote({ value: 5 }), null);
  assert.equal(rollConstraint([]), null);
  assert.deepEqual(rollConstraint([{ kind: 'range', min: 6, max: 10 }]).short, '🔼 6–10');
  assert.equal(rollConstraint([{ kind: 'range', min: 6, max: 10 }, { kind: 'exact', value: 2 }]).exact, 2);
  assert.equal(rollConstraint([{ kind: 'exact', value: 2 }, { kind: 'rush' }]).rush, true);
});

test('handLayout: six cards fit a 390 px phone row, ten scroll', () => {
  const phone = handLayout(6, 330, { max: 62 });
  assert.ok(phone.cardW >= 46 && !phone.scroll, JSON.stringify(phone));
  assert.equal(handLayout(6, 300, { max: 62 }).scroll, false);
  assert.equal(handLayout(10, 330, { max: 62 }).scroll, true);
  assert.equal(handLayout(6, 600, { max: 62 }).cardW, 62);
});

test('requirement badges: 🔬 card badges, checked against a character (missing = red), 🏅 merit for the next rank', () => {
  const doc = META.jobs.jobs[0];
  assert.deepEqual(requirementBadges(doc.requires, { cards: META.cards }), ['🧠 7+', '🎓 대졸', '🔬 연구열심 필요']);
  assert.deepEqual(requirementBadges({ cards: ['iron_body'] }), ['🦾 강철 체력 필요']); // fallback names
  const has = { stats: { int: 8 }, education: 'elite', cards: [{ uid: 'a', id: 'research' }] };
  assert.deepEqual(requirementList(doc.requires, { character: has }).map((r) => r.ok), [true, true, true]);
  const lacks = { stats: { int: 5 }, education: 'none', cards: [] };
  assert.deepEqual(requirementList(doc.requires, { character: lacks }).map((r) => r.ok), [false, false, false]);
  const x = optionExtras({ kind: 'jobOffer' }, { id: 'doctor' }, { jobs: META.jobs, character: lacks, cards: META.cards });
  const list = optionBadgeList(x, ['🎪 extra'], { won: (n) => `${n}만원` });
  assert.deepEqual(list.map((b) => [b.text, b.miss]), [['💵 첫 월급 60만원', false], ['🧠 7+', true], ['🎓 대졸', true], ['🔬 연구열심 필요', true], ['🎪 extra', false]]);
  assert.equal(list[3].card, true);
  // 찬스 광장 이직 option carries its own `requires`
  const pass = optionExtras({ kind: 'passTile' }, { id: 'jobChange', jobId: 'politician', requires: { cards: ['charisma'] } }, { jobs: META.jobs, character: has });
  assert.deepEqual(pass.reqs.map((r) => [r.text, r.ok]), [['🎤 카리스마◎ 필요', false]]);
  // jobTile 승진 시험 option with merit fields
  const promo = optionExtras({ kind: 'jobTile' }, { id: 'promotion', merit: 2, merits: 1, disabled: true }, { jobs: META.jobs });
  assert.deepEqual(promo.reqs.map((r) => [r.text, r.ok]), [['🏅 공적 카드 2장 (보유 1)', false]]);
  // 🏅 공적 카드 for the next rank
  const c = { job: { id: 'doctor', rank: 1 }, cards: [{ uid: 'm1', id: 'merit' }] };
  assert.deepEqual(meritNeed(c, META.jobs), { need: 2, have: 1, ok: false });
  assert.equal(meritNeed({ job: { id: 'doctor', rank: 3 } }, META.jobs), null); // max rank
  assert.equal(meritNeed({ job: { id: 'politician', rank: 1 } }, META.jobs), null);
});

test('cardLost: chips (💍 소멸 · 🩹 회복 · 🗑️ 버림 · 🏅 ×n), follow-up chips + lone banners, tags', () => {
  assert.equal(cardLostInfo({ cardId: 'marriage_luck', reason: 'married' }, META).text, '💍 💞 결혼운◎ 소멸');
  assert.equal(cardLostInfo({ cardId: 'injury', reason: 'healed' }, META).text, '🩹 부상 회복 · 🤕 부상 카드 사라짐');
  assert.equal(cardLostInfo({ cardId: 'taxi', reason: 'discarded' }, META).text, '🗑️ 🚕 택시 버림');
  const chips = cardLostChips(
    [
      { type: 'cardLost', charId: 'c1', cardId: 'merit', uid: 'a', reason: 'merit' },
      { type: 'cardLost', charId: 'c1', cardId: 'merit', uid: 'b', reason: 'merit' },
    ],
    META,
  );
  assert.deepEqual(chips.map((c) => c.text), ['🏅 공적 카드 2장 사용']);
  // a rank-up with its merit cards spent → chips on the rank-up cut-in; a lone cardLost → its own banner group
  const events = [
    { type: 'rankUp', charId: 'c1', jobId: 'doctor', rank: 2, cutin: true },
    { type: 'cardLost', charId: 'c1', cardId: 'merit', uid: 'a', reason: 'merit' },
    { type: 'cardLost', charId: 'c1', cardId: 'merit', uid: 'b', reason: 'merit' },
    { type: 'turnStarted', charId: 'c2' },
    { type: 'cardLost', charId: 'c2', cardId: 'injury', uid: 'x', reason: 'healed' },
  ];
  const groups = planCutins(events);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].cards.map((c) => [c.type, c.reason]), [['cardLost', 'merit'], ['cardLost', 'merit']]);
  assert.equal(groups[1].anchor.type, 'cardLost');
  assert.equal(isBannerGroup(groups[1]), true);
  assert.equal(classifyGroup(groups[1], { mine: ['c2'], mode: 'full' }), 'banner');
  assert.equal(tagLabel(groups[1].anchor), '🩹 부상 회복');
});

test('markup: colour frames, 보유 / 사용 / 자동 / 부상 tags, 🏅 ×n stack, chips, shop tags', () => {
  const blue = cardHtml({ uid: 'k4', id: 'research' }, { meta: META });
  assert.match(blue, /class="cardf k-held c-blue"/);
  assert.match(blue, /cf-tag t-blue">보유/);
  assert.match(blue, /fill="#2f6fe0"/);
  const st = cardHtml({ id: 'injury' }, { meta: META, tag: 'div', cls: 'status' });
  assert.match(st, /^<div class="cardf k-status c-status status"/);
  assert.match(st, /cf-tag t-status">부상/);
  assert.match(st, /stroke="#c4c8cf"/); // stripes
  assert.match(cardHtml({ id: 'lawyer' }, { meta: META }), /cf-tag t-red cf-auto">자동/);
  assert.match(cardHtml({ id: 'big_roll' }, { meta: META }), /cf-tag t-red">사용/);
  const stack = cardHtml({ id: 'merit', count: 3 }, { meta: META });
  assert.match(stack, /cf-stack" aria-hidden="true">×3/);
  assert.match(stack, /class="cardf k-merit c-blue stacked"/);
  assert.match(stack, /공적 카드 3장/);
  assert.equal((cardHtml({ id: 'merit' }, { meta: META }).match(/cf-stack/g) ?? []).length, 0);
  assert.match(cardChipHtml('research', { meta: META }), /gd-card k-held c-blue/);
  assert.match(cardChipHtml('merit', { meta: META, count: 2 }), /🏅 공적 카드 ×2/);
  const shop = shopOptionsHtml({ promptId: 'p', options: [{ id: 'buy:0', cardId: 'research', price: 60 }, { id: 'buy:1', cardId: 'big_roll', price: 40 }, { id: 'leave' }] }, { id: 'c1' }, { meta: META, won: (n) => `${n}만원` });
  assert.match(shop, /shop-item k-held c-blue/);
  assert.match(shop, /🔵 보유 카드/);
  assert.match(shop, /🔴 사용 카드/);
});
