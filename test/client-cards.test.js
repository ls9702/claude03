// Stage 7-B pure client helpers: card playability / targets, trade & gift validation, hand layout, spin-mod badges,
// holiday / lotto rows, planCutins + classifyGroup for the Stage 7 events, scene fallbacks, markup builders.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cardInfo,
  cardPlayability,
  handFull,
  handLayout,
  handOf,
  holidayRows,
  itemInfo,
  lottoRows,
  openTrades,
  sabotageTargets,
  spinModBadges,
  tradeLists,
  tradeSideText,
  validateGift,
  validateTrade,
} from '../public/js/shared/cards.js';
import { planCutins, resolveSceneBg, tagLabel, isCardAnchor, DEFAULT_SCENE_FALLBACKS } from '../public/js/ui/cutinMap.js';
import { classifyGroup, isBigGroup, isOwnGroup, mergeGroups } from '../public/js/ui/cutinPolicy.js';
import { cardHtml, hwatuSvg, lottoBallHtml, shopOptionsHtml } from '../public/js/ui/cardArt.js';

const META = {
  cards: {
    handLimit: 5,
    cards: [
      { id: 'energy', name: '에너지 드링크', icon: '⚡', kind: 'instant', desc: '이번 룰렛 +2칸', price: 30 },
      { id: 'pledge', name: '공약 카드', icon: '🎤', kind: 'instant', desc: '후원금', price: 80, jobOnly: 'politician' },
      { id: 'lawyer', name: '변호사 상담권', icon: '⚖️', kind: 'passive', desc: '방어', price: 60 },
      { id: 'cut_line', name: '새치기', icon: '🏃', kind: 'sabotage', desc: '−3칸', price: 50 },
      { id: 'taxi', name: '택시', icon: '🚕', kind: 'instant', desc: '큰 값', price: 40 },
    ],
  },
  items: { items: [{ id: 'car', name: '경차', icon: '🚗', desc: '1 → 2', price: 300, resale: 0.5 }] },
  jobs: { jobs: [{ id: 'politician', name: '국회의원', icon: '🎤', ranks: [] }] },
};

function room({ cur = 'c1', phase = 'awaitSpin', pending = null, cardUsed = false, round = 3 } = {}) {
  return {
    status: 'playing',
    me: { role: 'player' },
    turn: { order: ['c1', 'c2', 'c3', 'c4'], currentIndex: ['c1', 'c2', 'c3', 'c4'].indexOf(cur), phase, pending, cardUsed, round },
    trades: [],
    characters: [
      { id: 'c1', name: '민수', isMe: true, ownerId: 'p1', money: 100, cards: [{ uid: 'k1', id: 'energy' }, { uid: 'k2', id: 'cut_line' }, { uid: 'k3', id: 'lawyer' }, { uid: 'k4', id: 'pledge' }], items: ['car'], position: { eraIndex: 4 }, job: null },
      { id: 'c2', name: '지영', isMe: true, ownerId: 'p1', money: 50, cards: [], items: [], position: { eraIndex: 4 } },
      { id: 'c3', name: '뚱이', isMe: false, ownerId: 'p2', money: 70, cards: [{ uid: 'k9', id: 'taxi' }], items: [], position: { eraIndex: 4 }, lastTargetedBy: {} },
      { id: 'c4', name: '공주님', isMe: false, ownerId: 'p2', money: 10, cards: [], items: [], position: { eraIndex: 3 }, finished: false },
    ],
  };
}
const card = (r, charId, uid) => handOf(r.characters.find((c) => c.id === charId), META).find((c) => c.uid === uid);

test('card info: meta wins, contract fallback, unknown ids stay renderable', () => {
  assert.equal(cardInfo('energy', META).name, '에너지 드링크');
  assert.equal(cardInfo('gossip', META).kind, 'sabotage'); // not in META → contract fallback
  assert.equal(cardInfo('zzz', META).icon, '🃏');
  assert.equal(cardInfo('zzz', META).kind, 'instant');
  assert.equal(itemInfo('car', META).name, '경차');
  assert.equal(itemInfo('laptop', null).icon, '💻');
  assert.deepEqual(handOf({ cards: ['taxi'] }, META).map((c) => c.id), ['taxi']);
});

test('card playability: my turn in awaitSpin, once per turn, passive / jobOnly / spectators / prompt', () => {
  const r = room();
  const c1 = r.characters[0];
  assert.equal(cardPlayability(r, c1, card(r, 'c1', 'k1'), { meta: META }).playable, true);
  const passive = cardPlayability(r, c1, card(r, 'c1', 'k3'), { meta: META });
  assert.equal(passive.playable, false);
  assert.match(passive.reason, /자동/);
  const job = cardPlayability(r, c1, card(r, 'c1', 'k4'), { meta: META });
  assert.equal(job.playable, false);
  assert.match(job.reason, /국회의원/);
  c1.job = { id: 'politician', rank: 1 };
  assert.equal(cardPlayability(r, c1, card(r, 'c1', 'k4'), { meta: META }).playable, true);
  const sab = cardPlayability(r, c1, card(r, 'c1', 'k2'), { meta: META });
  assert.equal(sab.playable, true);
  assert.equal(sab.needsTarget, true);
  // not my turn / wrong phase / prompt open / already used / spectator / finished room
  for (const [rr, re] of [
    [room({ cur: 'c3' }), /내 차례/],
    [room({ phase: 'resolveSpace' }), /룰렛을 돌리기 전/],
    [room({ pending: { promptId: 'x' } }), /룰렛을 돌리기 전/],
    [room({ cardUsed: true }), /이미 카드/],
  ]) {
    const res = cardPlayability(rr, rr.characters[0], card(rr, 'c1', 'k1'), { meta: META });
    assert.equal(res.playable, false);
    assert.match(res.reason, re);
  }
  const spec = room();
  assert.equal(cardPlayability(spec, spec.characters[0], card(spec, 'c1', 'k1'), { meta: META, spectator: true }).playable, false);
  const other = room({ cur: 'c3' });
  assert.match(cardPlayability(other, other.characters[2], card(other, 'c3', 'k9'), { meta: META }).reason, /내 캐릭터/);
  const fin = room();
  fin.status = 'finished';
  assert.equal(cardPlayability(fin, fin.characters[0], card(fin, 'c1', 'k1'), { meta: META }).playable, false);
});

test('sabotage targets: others still playing; the same attacker cannot hit one twice in a row', () => {
  const r = room({ round: 5 });
  r.characters[3].finished = true;
  let t = sabotageTargets(r, r.characters[0]);
  assert.deepEqual(t.map((x) => x.char.id), ['c2', 'c3']); // self and finished excluded
  assert.ok(t.every((x) => x.valid));
  r.characters[2].lastTargetedBy = { c1: 4 }; // previous round → still blocked
  t = sabotageTargets(r, r.characters[0]);
  const c3 = t.find((x) => x.char.id === 'c3');
  assert.equal(c3.valid, false);
  assert.match(c3.reason, /연달아/);
  assert.equal(t[0].valid, true); // valid ones first
  r.characters[2].lastTargetedBy = { c1: 3 };
  assert.equal(sabotageTargets(r, r.characters[0]).find((x) => x.char.id === 'c3').valid, true);
  // nobody valid → the sabotage card is not playable
  r.characters[1].finished = true;
  r.characters[2].lastTargetedBy = { c1: 5 };
  const res = cardPlayability(r, r.characters[0], card(r, 'c1', 'k2'), { meta: META });
  assert.equal(res.playable, false);
  assert.match(res.reason, /노릴 수 있는 상대/);
});

test('trade form validation mirrors the server rules', () => {
  const r = room();
  const ok = validateTrade({ fromId: 'c1', toId: 'c3', give: { kind: 'money', money: '30' }, want: { kind: 'card', cardUid: 'k9' } }, { room: r });
  assert.equal(ok.ok, true, ok.error);
  assert.deepEqual(ok.body, { type: 'offerTrade', characterId: 'c1', toId: 'c3', give: { money: 30 }, want: { cardUid: 'k9' } });
  const bad = (form, re) => {
    const res = validateTrade(form, { room: r });
    assert.equal(res.ok, false, JSON.stringify(form));
    assert.match(res.error, re);
  };
  bad({ fromId: 'c1', toId: 'c2', give: { kind: 'money', money: 1 }, want: { kind: 'card', cardUid: 'x' } }, /내 캐릭터끼리/);
  bad({ fromId: 'c3', toId: 'c1', give: { kind: 'money', money: 1 }, want: { kind: 'card', cardUid: 'k1' } }, /내 캐릭터를/);
  bad({ fromId: 'c1', toId: 'c3', give: { kind: 'money', money: 10 }, want: { kind: 'money', money: 10 } }, /돈과 돈/);
  bad({ fromId: 'c1', toId: 'c3', give: { kind: 'money', money: 101 }, want: { kind: 'card', cardUid: 'k9' } }, /현금이 부족/);
  bad({ fromId: 'c1', toId: 'c3', give: { kind: 'money', money: 2.5 }, want: { kind: 'card', cardUid: 'k9' } }, /정수/);
  bad({ fromId: 'c1', toId: 'c3', give: { kind: 'money', money: '' }, want: { kind: 'card', cardUid: 'k9' } }, /금액을/);
  bad({ fromId: 'c1', toId: 'c3', give: { kind: 'card', cardUid: 'k9' }, want: { kind: 'money', money: 5 } }, /손패에 없어요/);
  bad({ fromId: 'c1', toId: 'c3', give: { kind: 'card', cardUid: 'k1' }, want: { kind: 'money', money: 71 } }, /뚱이의 현금이 부족/);
  bad({ fromId: 'c1', toId: 'c3', give: { kind: 'card', cardUid: 'k1' }, want: { kind: 'none' } }, /하나씩/);
  r.characters[2].finished = true;
  bad({ fromId: 'c1', toId: 'c3', give: { kind: 'money', money: 1 }, want: { kind: 'card', cardUid: 'k9' } }, /골인/);
  r.characters[2].finished = false;
  r.trades = [{ id: 't1', fromId: 'c1', toId: 'c4', give: { money: 1 }, want: { money: 1 }, expiresAt: Date.now() + 10_000 }];
  bad({ fromId: 'c1', toId: 'c3', give: { kind: 'money', money: 1 }, want: { kind: 'card', cardUid: 'k9' } }, /기다리는 거래/);
  r.trades[0].expiresAt = Date.now() - 1; // expired offers don't count
  assert.equal(validateTrade({ fromId: 'c1', toId: 'c3', give: { kind: 'money', money: 1 }, want: { kind: 'card', cardUid: 'k9' } }, { room: r }).ok, true);
  const spec = room();
  spec.me.role = 'spectator';
  assert.match(validateTrade({ fromId: 'c1', toId: 'c3', give: { kind: 'money', money: 1 }, want: { kind: 'card', cardUid: 'k9' } }, { room: spec }).error, /관전자/);
});

test('gift validation: money or one card, own characters allowed, full hands only noted', () => {
  const r = room();
  const g = validateGift({ fromId: 'c1', toId: 'c2', kind: 'money', money: '20' }, { room: r });
  assert.equal(g.ok, true, g.error);
  assert.deepEqual(g.body, { type: 'gift', characterId: 'c1', toId: 'c2', money: 20 });
  assert.deepEqual(validateGift({ fromId: 'c1', toId: 'c3', kind: 'card', cardUid: 'k2' }, { room: r }).body, { type: 'gift', characterId: 'c1', toId: 'c3', cardUid: 'k2' });
  assert.match(validateGift({ fromId: 'c1', toId: 'c1', kind: 'money', money: 1 }, { room: r }).error, /선물 받을/);
  assert.match(validateGift({ fromId: 'c1', toId: 'c3', kind: 'money', money: 500 }, { room: r }).error, /현금이 부족/);
  assert.match(validateGift({ fromId: 'c1', toId: 'c3', kind: 'card', cardUid: null }, { room: r }).error, /카드를 고르세요/);
  assert.match(validateGift({ fromId: 'c3', toId: 'c1', kind: 'money', money: 1 }, { room: r }).error, /내 캐릭터를/);
  const full = { cards: [1, 2, 3, 4, 5].map((i) => ({ uid: `u${i}`, id: 'taxi' })) };
  assert.equal(handFull(full, META), true);
  assert.equal(handFull(r.characters[0], META), false);
});

test('open trades: expiry by server time, incoming vs outgoing, side texts', () => {
  const r = room();
  const now = 1_000_000;
  r.trades = [
    { id: 't1', fromId: 'c3', toId: 'c1', give: { money: 20 }, want: { cardUid: 'k1', cardId: 'energy' }, expiresAt: now + 5000 },
    { id: 't2', fromId: 'c2', toId: 'c4', give: { cardUid: 'x', cardId: 'taxi' }, want: { money: 5 }, expiresAt: now + 5000 },
    { id: 't3', fromId: 'c4', toId: 'c2', give: { money: 1 }, want: { money: 1 }, expiresAt: now - 1 },
  ];
  assert.deepEqual(openTrades(r, now).map((t) => t.id), ['t1', 't2']);
  const { incoming, outgoing } = tradeLists(r, now);
  assert.deepEqual(incoming.map((t) => t.id), ['t1']);
  assert.deepEqual(outgoing.map((t) => t.id), ['t2']);
  const won = (n) => `${n}만원`;
  assert.equal(tradeSideText({ money: 20 }, { won }), '💰 20만원');
  assert.equal(tradeSideText({ cardUid: 'k1' }, { owner: r.characters[0], meta: META }), '⚡ 에너지 드링크');
  assert.equal(tradeSideText({ cardUid: 'x', cardId: 'taxi' }, { meta: META }), '🚕 택시');
  assert.equal(tradeSideText(null), '없음');
});

test('hand layout shrinks cards to fit, then scrolls; spin-mod badges', () => {
  assert.deepEqual(handLayout(0, 300), { cardW: 88, gap: 6, scroll: false, total: 0 });
  const a = handLayout(3, 358);
  assert.equal(a.cardW, 88);
  assert.equal(a.scroll, false);
  const b = handLayout(5, 358);
  assert.ok(b.cardW < 88 && b.cardW >= 64);
  assert.equal(b.scroll, false);
  const c = handLayout(5, 300);
  assert.equal(c.cardW, 64);
  assert.equal(c.scroll, true);
  assert.deepEqual(
    spinModBadges([{ kind: 'plus', value: 2 }, { kind: 'minus', value: 3 }, { kind: 'max2' }, { kind: 'min2' }, { kind: '??' }]).map((b) => [b.text, b.kind]),
    [['⚡+2', 'good'], ['✂️−3', 'bad'], ['🚕×2', 'good'], ['📢×2↓', 'bad']],
  );
  assert.deepEqual(spinModBadges(null), []);
});

test('holiday rows: 세뱃돈 / 잔소리 / 고스톱 net and winners; lotto rows: hits and prizes, best first', () => {
  const chars = [{ id: 'c1', name: '민수', isMe: true }, { id: 'c2', name: '지영' }, { id: 'c3', name: '뚱이' }];
  const won = (n) => `${n}만원`;
  const rows = holidayRows(
    {
      kind: 'seol',
      winners: ['c2'],
      results: [
        { charId: 'c1', sebae: -40, nagging: { stat: 'charm', delta: -1, line: '애인은 있니?' }, stake: 40, card: 7, won: -40 },
        { charId: 'c2', sebae: 60, nagging: { stat: 'int', delta: 1 }, stake: 120, card: 9, won: 40 },
        { charId: 'c3', sebae: 0, nagging: null, stake: 0, card: null, won: 0 },
      ],
    },
    { characters: chars, won },
  );
  assert.equal(rows[0].sebae.text, '🧧 세뱃돈 -40만원');
  assert.equal(rows[0].sebae.kind, 'minus');
  assert.equal(rows[0].nagging.text, '✨ 매력 -1');
  assert.equal(rows[0].nagging.line, '애인은 있니?');
  assert.equal(rows[0].winText, '−40만원');
  assert.equal(rows[0].winner, false);
  assert.equal(rows[1].winner, true);
  assert.equal(rows[1].winText, '🏆 +40만원');
  assert.equal(rows[1].card, 9);
  assert.equal(rows[2].sebae, null);
  assert.equal(rows[2].stakeText, '구경만');
  assert.equal(rows[2].card, null);
  // boolean `won` (older contract wording) = winner flag
  assert.equal(holidayRows({ results: [{ charId: 'c1', stake: 20, card: 3, won: true }] }, { characters: chars, won })[0].winner, true);
  const lotto = lottoRows(
    { numbers: [3, 11, 17], entries: [{ charId: 'c1', numbers: [5, 6, 7], matches: 0, prize: 0 }, { charId: 'c3', numbers: [3, 11, 20], matches: 2, prize: 100 }] },
    { characters: chars, won },
  );
  assert.deepEqual(lotto.numbers, [3, 11, 17]);
  assert.equal(lotto.rows[0].charId, 'c3');
  assert.deepEqual(lotto.rows[0].numbers.map((x) => x.hit), [true, true, false]);
  assert.equal(lotto.rows[0].prizeText, '🎉 100만원');
  assert.equal(lotto.rows[1].prizeText, '꽝');
  // matches computed when the server leaves it out
  assert.equal(lottoRows({ numbers: [1, 2, 3], entries: [{ charId: 'c1', numbers: [1, 2, 9] }] }).rows[0].matches, 2);
});

test('planCutins: Stage 7 anchors, follow-up chips, lone banners; sabotage involves the target', () => {
  const ev = [
    { type: 'turnStarted', charId: 'c3' },
    { type: 'cardUsed', charId: 'c3', cardId: 'cut_line', cardKind: 'sabotage', targetId: 'c1', tone: 'bad' },
    { type: 'log', text: '뚱이가 민수에게 새치기!' },
    { type: 'spun', charId: 'c3', value: 4 },
    { type: 'landed', charId: 'c3', tileType: 'card', cutin: true },
    { type: 'cardGained', charId: 'c3', cardId: 'taxi', source: 'tile' },
    { type: 'cardUsed', charId: 'c3', cardId: 'bonus', cardKind: 'passive', auto: true },
    { type: 'itemBought', charId: 'c3', itemId: 'car', price: 300 },
    { type: 'moneyChanged', charId: 'c3', delta: -300, reason: 'shop' },
    { type: 'gift', fromId: 'c1', toId: 'c2', charId: 'c1', money: 30 },
    { type: 'holidayStarted', eraId: 'young', kind: 'seol', tone: 'holiday' },
    { type: 'holidayResult', eraId: 'young', kind: 'seol', results: [{ charId: 'c1' }, { charId: 'c2' }] },
    { type: 'lottoDraw', eraId: 'young', numbers: [1, 2, 3], entries: [{ charId: 'c3', numbers: [1, 5, 6] }], mc: [{ speaker: 'bomi', line: '추첨!' }], mcStudio: true },
    { type: 'tradeOffered', tradeId: 't1', fromId: 'c1', toId: 'c3' },
    { type: 'tradeResolved', tradeId: 't1', fromId: 'c1', toId: 'c3', status: 'accepted' },
  ];
  const groups = planCutins(ev);
  assert.deepEqual(
    groups.map((g) => g.anchor.type),
    ['cardUsed', 'landed', 'itemBought', 'holidayStarted', 'holidayResult', 'lottoDraw', 'tradeResolved'],
  );
  const [sab, landed, item, , hres, lotto, trade] = groups;
  assert.equal(sab.targetId, 'c1');
  assert.deepEqual(sab.involved, ['c3', 'c1']);
  assert.deepEqual(sab.texts, ['뚱이가 민수에게 새치기!']);
  // card gained + the automatic passive use ride on the landing as chips
  assert.deepEqual(landed.cards.map((c) => [c.type, c.cardId]), [['cardGained', 'taxi'], ['cardUsed', 'bonus']]);
  // the purchase keeps its money follow-up; the gift after it is a chip there too
  assert.equal(item.money[0].delta, -300);
  assert.deepEqual(item.gifts, [{ fromId: 'c1', toId: 'c2', money: 30, cardId: null }]);
  assert.deepEqual(hres.involved, ['c1', 'c2']);
  assert.deepEqual(lotto.studio, [{ speaker: 'bomi', line: '추첨!' }]);
  assert.equal(trade.charId, 'c1');
  assert.equal(trade.targetId, 'c3');
  assert.equal(isCardAnchor({ type: 'cardUsed', cardId: 'pledge' }), true);
  assert.equal(isCardAnchor({ type: 'cardUsed', cardId: 'energy', cardKind: 'instant' }), false);
  assert.equal(isCardAnchor({ type: 'cardUsed', cardId: 'lawyer', auto: true, targetId: 'x' }), false);
  // lone gift (server order: gift, then the card moves) → its own group with the card chip
  const lone = planCutins([{ type: 'gift', fromId: 'c1', toId: 'c2', charId: 'c1', cardId: 'taxi' }, { type: 'cardGained', charId: 'c2', cardId: 'taxi', source: 'gift' }]);
  assert.deepEqual(lone.map((g) => g.anchor.type), ['gift']);
  assert.equal(lone[0].targetId, 'c2');
  assert.deepEqual(lone[0].cards.map((c) => c.charId), ['c2']);
  assert.deepEqual(planCutins([{ type: 'cardGained', charId: 'c2', cardId: 'taxi', source: 'tile' }]).map((g) => g.anchor.type), ['cardGained']);
  // tags
  assert.equal(tagLabel({ type: 'cardUsed', cardId: 'cut_line', targetId: 'c1' }), '💢 뒤통수 카드');
  assert.equal(tagLabel({ type: 'cardBlocked' }), '🛡️ 방어 성공');
  assert.equal(tagLabel({ type: 'holidayStarted', kind: 'chuseok' }), '🌕 추석 대잔치');
  assert.equal(tagLabel({ type: 'lottoDraw' }), '🎱 전국 로또');
});

test('classifyGroup: 명절 / 로또 / 뒤통수 on me are big; shop / card tiles minor; banners; lotto deferred under my prompt', () => {
  const mine = new Set(['c1']);
  const g = (anchor, extra = {}) => ({ anchor, charId: anchor.charId ?? null, targetId: anchor.targetId ?? anchor.toId ?? null, texts: [], money: [], involved: [], ...extra });
  const compact = { mine, mode: 'compact' };
  // sabotage on me → full; between others → banner; by me → full
  assert.equal(classifyGroup(g({ type: 'cardUsed', charId: 'c3', cardId: 'cut_line', targetId: 'c1' }), compact), 'full');
  assert.equal(classifyGroup(g({ type: 'cardUsed', charId: 'c3', cardId: 'cut_line', targetId: 'c2' }), compact), 'banner');
  assert.equal(classifyGroup(g({ type: 'cardBlocked', charId: 'c3', cardId: 'gossip', targetId: 'c1' }), compact), 'full');
  assert.equal(isOwnGroup(g({ type: 'cardUsed', charId: 'c3', targetId: 'c1' }), mine), true);
  // holiday + lotto: big for everyone
  for (const type of ['holidayStarted', 'holidayResult', 'lottoDraw']) {
    assert.equal(isBigGroup(g({ type })), true, type);
    assert.equal(classifyGroup(g({ type }), compact), 'full', type);
  }
  // other players' shop / card tiles and purchases → banners; mine → full
  assert.equal(classifyGroup(g({ type: 'landed', charId: 'c3', tileType: 'shop', lineTag: 'job_offer' }), compact), 'banner');
  assert.equal(classifyGroup(g({ type: 'landed', charId: 'c3', tileType: 'card' }), compact), 'banner');
  assert.equal(classifyGroup(g({ type: 'landed', charId: 'c1', tileType: 'card' }), compact), 'full');
  assert.equal(classifyGroup(g({ type: 'itemBought', charId: 'c3', itemId: 'car' }), compact), 'banner');
  assert.equal(classifyGroup(g({ type: 'itemBought', charId: 'c3', itemId: 'car' }), { mine, mode: 'full' }), 'full');
  // lone card / gift / trade events: always banners (also mine), off → skip unless mine
  assert.equal(classifyGroup(g({ type: 'cardGained', charId: 'c1', cardId: 'taxi' }), { mine, mode: 'full' }), 'banner');
  assert.equal(classifyGroup(g({ type: 'gift', charId: 'c3', fromId: 'c3', toId: 'c1' }), { mine, mode: 'off' }), 'banner');
  assert.equal(classifyGroup(g({ type: 'tradeResolved', fromId: 'c3', toId: 'c4' }, { charId: 'c3' }), { mine, mode: 'off' }), 'skip');
  assert.equal(classifyGroup(g({ type: 'cardUsed', charId: 'c3', cardId: 'energy', cardKind: 'instant' }), compact), 'banner');
  // my prompt open: the lotto draw / holiday result wait, the rest shrink to banners
  assert.equal(classifyGroup(g({ type: 'lottoDraw' }), { ...compact, promptForMe: true }), 'defer');
  assert.equal(classifyGroup(g({ type: 'holidayResult' }), { ...compact, promptForMe: true }), 'defer');
  assert.equal(classifyGroup(g({ type: 'holidayStarted' }), { ...compact, promptForMe: true }), 'banner');
  // merge: sabotage groups / banner groups are never merged
  const merged = mergeGroups([g({ type: 'landed', charId: 'c3', tileType: 'money' }), g({ type: 'cardUsed', charId: 'c3', cardId: 'cut_line', targetId: 'c1' })], { mine });
  assert.equal(merged.length, 2);
  const merged2 = mergeGroups([g({ type: 'landed', charId: 'c3', tileType: 'shop' }), g({ type: 'itemBought', charId: 'c3', itemId: 'car' })], { mine });
  assert.equal(merged2.length, 1);
  assert.equal(merged2[0].anchor.type, 'itemBought');
});

test('scene fallbacks: own bg > sceneFallbacks chain bg > SVG of the first drawable scene', () => {
  const presentation = { scenes: { office: { bg: 'bg-office' }, shop: { bg: 'bg-shop' }, stage: { bg: 'bg-stage' }, 'wedding-hall': { bg: 'bg-wedding-hall' } }, sceneFallbacks: { shop: 'office', stage: 'wedding-hall', lab: 'hospital' } };
  const have = new Set(['bg-office']);
  const assetUrl = (id) => (have.has(id) ? `/a/${id}.webp` : null);
  assert.deepEqual(resolveSceneBg('shop', { presentation, assetUrl }).url, '/a/bg-office.webp');
  assert.equal(resolveSceneBg('shop', { presentation, assetUrl }).scene, 'office');
  have.add('bg-shop');
  assert.equal(resolveSceneBg('shop', { presentation, assetUrl }).url, '/a/bg-shop.webp');
  // nothing generated: SVG of the first scene in the chain the cut-in can draw
  const none = resolveSceneBg('stage', { presentation, assetUrl: () => null });
  assert.equal(none.url, null);
  assert.equal(none.svgScene, 'wedding-hall');
  assert.equal(resolveSceneBg('shop', { presentation, assetUrl: () => null }).svgScene, 'shop'); // own SVG
  // findAsset({kind:'bg', scene}) lookup also counts
  assert.equal(resolveSceneBg('lab', { presentation, findBg: (s) => (s === 'hospital' ? '/h.webp' : null) }).url, '/h.webp');
  // cycles / none
  assert.equal(resolveSceneBg('a', { presentation: { sceneFallbacks: { a: 'b', b: 'a' } } }).url, null);
  assert.equal(resolveSceneBg('none', { presentation }).svgScene, 'none');
  // without server fallbacks the contract default applies
  assert.equal(resolveSceneBg('campus', { presentation: {}, assetUrl: () => null }).svgScene, 'school');
  assert.equal(DEFAULT_SCENE_FALLBACKS.holiday, 'wedding-hall');
});

test('markup builders: card frame by kind, hwatu 1..10, lotto balls, shop product cards', () => {
  const h = cardHtml({ uid: 'k1', id: 'cut_line' }, { meta: META, attrs: 'data-x="1"', cls: 'can' });
  assert.match(h, /class="cardf k-sabotage can"/);
  assert.match(h, /data-x="1"/);
  assert.match(h, /새치기/);
  assert.match(cardHtml({ id: 'lawyer' }, { meta: META }), /cf-auto">자동/);
  assert.match(cardHtml({ id: 'energy' }, { meta: META, art: '/a/card.webp' }), /<img class="cf-art-img" src="\/a\/card.webp"/);
  for (let n = 1; n <= 10; n++) assert.match(hwatuSvg(n), new RegExp(`aria-label="${n}끗`));
  assert.match(hwatuSvg(0, { back: true }), /class="hw-svg back/);
  assert.match(lottoBallHtml(7, { hit: true }), /lotto-ball hit/);
  const p = {
    promptId: 'p1',
    kind: 'shop',
    options: [
      { id: 'buy:0', cardId: 'taxi', price: 20, basePrice: 40, desc: '카드 · 큰 값 · 20만원 (쿠폰 할인, 원래 40만원)' },
      { id: 'buy:1', itemId: 'car', price: 300, disabled: true, desc: '아이템 · 1 → 2 · 300만원 · 돈이 부족해요' },
      { id: 'leave', label: '🚶 그냥 나가기', icon: '🚶' },
    ],
  };
  const html = shopOptionsHtml(p, { id: 'c1' }, { meta: META, won: (n) => `${n}만원` });
  assert.equal((html.match(/class="ci-opt shop-item/g) ?? []).length, 2);
  assert.match(html, /<s>40만원<\/s><b>20만원<\/b>/);
  assert.match(html, /쿠폰 할인/);
  assert.match(html, /data-choose="buy:1"[^>]*disabled/);
  assert.match(html, /돈이 부족해요/);
  assert.match(html, /class="ci-opt shop-leave" data-choose="leave" data-prompt="p1" data-char="c1"/);
});
