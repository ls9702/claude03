// Stage 8-B pure client helpers: partner / child view models, cut-in cast building, house art per id, prompt option
// formatting (meet / date / propose / house), planCutins + classifyGroup for the Stage 8 events, panel helpers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHILD_STAGES,
  DEFAULT_HOUSES,
  HOUSE_IDS,
  affectionInfo,
  chancePct,
  childInfo,
  childLook,
  dateOptions,
  familyCast,
  familyIcons,
  familyOf,
  familySummary,
  familyTagBadge,
  houseInfo,
  houseOf,
  houseOptions,
  houseOwners,
  marketInfo,
  meetOptions,
  partnerInfo,
  proposeOptions,
  schoolMeetPairs,
  starsText,
  traitInfo,
  weddingGifts,
} from '../public/js/shared/family.js';
import { dolTableSvg, houseArtHtml, houseOptionsHtml, houseSvg, marketChartSvg } from '../public/js/ui/houseArt.js';
import { dateOptionsHtml, familyDetailHtml, familyOptionsHtml, meetOptionsHtml, proposeOptionsHtml } from '../public/js/ui/familyArt.js';
import { planCutins, tagLabel, fallbackText } from '../public/js/ui/cutinMap.js';
import { classifyGroup, isBigGroup, mergeGroups } from '../public/js/ui/cutinPolicy.js';
import { slotPositions } from '../public/js/ui/cutin2d.js';
import { cpuBadgeHtml, isCpu, ownerHtml } from '../public/js/format.js';
import { loadData } from '../server/data/index.js';

const AV = (body = 'girl', extra = {}) => ({ body, build: 'normal', skin: 'light', face: 'round', eyes: 'round', mouth: 'smile', cheek: 'none', hair: 'bob', hairColor: 'black', outfit: 'tshirt', outfitColor: 'blue', accessory: 'none', ...extra });
const partner = (id, extra = {}) => ({ id, name: `연인${id}`, trait: 'charm', stars: 3, body: 'girl', avatar: AV('girl'), ...extra });
const kid = (id, stage = 'baby', extra = {}) => ({ id, name: `아이${id}`, trait: 'int', talent: 'normal', stage, bornTurn: 3, body: 'boy', avatar: AV('boy', { outfit: 'hoodie' }), ...extra });
const META = {
  partners: { traits: { int: { name: '지력형', icon: '🧠' }, str: { name: '체력형', icon: '💪' }, charm: { name: '매력형', icon: '✨' }, luck: { name: '운형', icon: '🍀' } }, affection: { proposeAt: 50, max: 100 } },
  houses: {
    houses: [
      { id: 'oneroom', name: '원룸 전세', icon: '🏢', price: 300, value: 300, capacity: 1 },
      { id: 'apartment', name: '아파트', icon: '🏙️', price: 1200, value: 1200, capacity: null },
      { id: 'jeju_villa', name: '제주 별장', icon: '🏝️', price: 1500, value: 2500, capacity: 1, lucky: true },
    ],
  },
};
const chars = [
  { id: 'c1', name: '민수', isMe: true, avatar: AV('boy'), love: { partner: partner('pt1'), affection: 30, dates: 1, candidates: [] }, spouse: null, children: [], house: null },
  { id: 'c2', name: '지영', avatar: AV('girl'), spouse: { ...partner('pt2', { body: 'boy', avatar: AV('boy') }), salary: 100, marriedTurn: 4 }, children: [kid('ch1', 'kid', { talent: 'genius' }), kid('ch2')], house: { id: 'apartment', price: 1200, value: 1500, boughtTurn: 9 }, houseSwaps: 1 },
  { id: 'c3', name: '뚱이', avatar: AV('boy') },
];

test('partner / child view models: trait + ★ from meta (contract fallback), affection bar, stage scale', () => {
  assert.deepEqual(traitInfo('int', META), { id: 'int', name: '지력형', icon: '🧠' });
  assert.equal(traitInfo('luck', null).name, '운형'); // contract default
  assert.equal(starsText(2), '★★☆☆');
  assert.equal(starsText(0), '');
  const p = partnerInfo({ ...partner('pt9'), salary: 70 }, META);
  assert.equal(p.traitIcon, '✨');
  assert.equal(p.starsText, '★★★☆');
  assert.equal(p.salary, 70);
  assert.equal(partnerInfo(null), null);
  const aff = affectionInfo({ affection: 30 }, META);
  assert.deepEqual([aff.value, aff.proposeAt, aff.pct, aff.ready], [30, 50, 60, false]);
  assert.equal(affectionInfo({ affection: 70 }, META).ready, true);
  assert.equal(affectionInfo({ affection: 70 }, META).pct, 100);
  const k = childInfo(kid('x', 'teen', { talent: 'genius' }), META);
  assert.equal(k.genius, true);
  assert.equal(k.stageLabel, '청소년');
  assert.ok(CHILD_STAGES.baby.scale < CHILD_STAGES.kid.scale && CHILD_STAGES.kid.scale < CHILD_STAGES.adult.scale);
  assert.equal(CHILD_STAGES.baby.scale, 0.5);
});

test('child look: stage costume from the era table (baby dino, kid tracksuit, teen uniform by body), adults keep theirs', () => {
  const avatars = loadData('avatars');
  const c = kid('k');
  assert.equal(childLook(c, { stage: 'baby', avatars }).outfit, 'dino');
  assert.equal(childLook(c, { stage: 'kid', avatars }).outfit, 'tracksuit');
  assert.equal(childLook(c, { stage: 'teen', avatars }).outfit, 'uniform');
  assert.equal(childLook({ ...c, avatar: AV('girl') }, { stage: 'teen', avatars }).outfit, 'sailor');
  assert.equal(childLook(c, { stage: 'adult', avatars }).outfit, 'hoodie');
  assert.equal(childLook({ id: 'x' }), null);
});

test('cut-in cast: partner / spouse / child entries from specs (children smaller, 👶 for babies)', () => {
  const g = (anchor) => ({ anchor, charId: anchor.charId, involved: [anchor.charId] });
  const met = familyCast(g({ type: 'met', charId: 'c1', partner: partner('pt5') }), chars);
  assert.equal(met.length, 1);
  assert.equal(met[0].role, 'partner');
  assert.equal(met[0].char.name, '연인pt5');
  assert.deepEqual(met[0].char.avatar, AV('girl'));
  assert.equal(met[0].char.npc, true);
  // married: the event's spouse spec
  const wed = familyCast(g({ type: 'married', charId: 'c1', spouse: partner('pt1') }), chars);
  assert.deepEqual(wed.map((m) => [m.role, m.scale, m.glyph]), [['spouse', 1, '💍']]);
  // birth: spouse (from the character) + the baby at half size with 👶
  const born = familyCast(g({ type: 'childBorn', charId: 'c2', child: kid('ch3') }), chars);
  assert.deepEqual(born.map((m) => m.role), ['spouse', 'child']);
  assert.equal(born[1].scale, 0.5);
  assert.equal(born[1].glyph, '👶');
  assert.equal(born[1].char.avatar.outfit, 'dino'); // baby costume (contract default table)
  // childGrew: the event's child copy at the new stage (+ genius flag)
  const grew = familyCast(g({ type: 'childGrew', charId: 'c2', childId: 'ch1', kind: 'exam', stage: 'teen', child: kid('ch1', 'teen', { talent: 'genius' }) }), chars);
  assert.equal(grew.length, 1);
  assert.equal(grew[0].stage, 'teen');
  assert.equal(grew[0].genius, true);
  assert.equal(grew[0].glyph, '📝');
  assert.ok(grew[0].scale > 0.5 && grew[0].scale < 1);
  // failed proposal: partner in a sweat, 🙅
  const fail = familyCast(g({ type: 'proposed', charId: 'c1', success: false, partner: partner('pt1') }), chars);
  assert.equal(fail[0].glyph, '🙅');
  // no spec / no avatar → nothing
  assert.deepEqual(familyCast(g({ type: 'met', charId: 'c3' }), chars), []);
  assert.deepEqual(familyCast(g({ type: 'landed', charId: 'c1' }), chars), []);
  // schoolMeet pairs: gone characters skipped
  const pairs = schoolMeetPairs({ pairs: [{ charId: 'c1', partner: partner('a') }, { charId: 'zz', partner: partner('b') }] }, chars, META);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].partner.traitName, '매력형');
  assert.equal(pairs[0].npc.avatar.body, 'girl');
  // wedding gifts: names, total
  const gifts = weddingGifts({ gifts: [{ fromId: 'c2', amount: 40 }, { fromId: 'c3', amount: 0 }], total: 40 }, chars);
  assert.deepEqual(gifts, { rows: [{ fromId: 'c2', name: '지영', amount: 40 }], total: 40 });
});

test('cast slots: classic 1–3 slots for full-size figures, children spread narrower, all inside the window', () => {
  assert.deepEqual(slotPositions([1]), [34]);
  assert.deepEqual(slotPositions([1, 1]), [27, 73]);
  assert.deepEqual(slotPositions([1, 1, 1]), [18, 50, 82]);
  const fam = slotPositions([1, 1, 0.5]);
  assert.equal(fam.length, 3);
  assert.ok(fam[0] < fam[1] && fam[1] < fam[2]);
  assert.ok(fam[2] - fam[1] < fam[1] - fam[0]); // the baby stands closer
  const five = slotPositions([1, 1, 0.64, 0.64, 0.5]);
  assert.equal(five.length, 5);
  assert.ok(five.every((x) => x >= 13 && x <= 87));
});

test('house art: 6 distinct SVG houses (+ generic fallback), asset img when accepted, market chart ↑ / ↓, 돌잡이', () => {
  assert.deepEqual(HOUSE_IDS, ['oneroom', 'villa', 'apartment', 'hanok', 'penthouse', 'jeju_villa']);
  const svgs = HOUSE_IDS.map((id) => houseSvg(id));
  for (const s of svgs) {
    assert.match(s, /^<svg class="house-svg h-[a-z_]+" viewBox="0 0 120 100"/);
    assert.doesNotMatch(s, /id="/); // no ids → safe to repeat on one page
  }
  const bodies = svgs.map((s) => s.replace(/^<svg[^>]*>/, ''));
  assert.equal(new Set(bodies).size, 6);
  const generic = houseSvg('castle').replace(/^<svg[^>]*>/, '');
  assert.ok(!bodies.includes(generic));
  assert.match(houseSvg('hanok'), /aria-label="한옥"/);
  assert.match(houseArtHtml('villa', { art: '/assets/generated/houses/villa.png', label: '빌라' }), /<img src="\/assets\/generated\/houses\/villa.png"/);
  assert.match(houseArtHtml('villa'), /data-house="villa"><svg/);
  assert.match(marketChartSvg(1.3), /class="market-svg up"/);
  assert.match(marketChartSvg(1.3), /\+30%/);
  assert.match(marketChartSvg(0.8), /class="market-svg down"/);
  assert.match(marketChartSvg(0.8), /-20%/);
  assert.match(dolTableSvg(), /돌잡이/);
  // server-side data (8-A) uses the same six ids when present
  let houses = null;
  try {
    houses = loadData('houses');
  } catch {
    houses = null;
  }
  if (houses) assert.deepEqual(houses.houses.map((h) => h.id).sort(), [...HOUSE_IDS].sort());
  assert.deepEqual(Object.keys(DEFAULT_HOUSES), HOUSE_IDS);
});

test('house info / ownership / market: capacity null = many owners, derived owners, market text', () => {
  assert.equal(houseInfo('apartment', META).capacity, 0);
  assert.equal(houseInfo('oneroom', META).capacity, 1);
  assert.equal(houseInfo('hanok', null).name, '한옥'); // contract fallback
  assert.equal(houseInfo('castle', META).icon, '🏠');
  const room = { characters: chars };
  assert.deepEqual(houseOwners(room, 'apartment'), ['c2']);
  assert.deepEqual(houseOwners({ ...room, houseOwners: { apartment: ['c2', 'c3'] } }, 'apartment'), ['c2', 'c3']);
  const h = houseOf(chars[1], META);
  assert.deepEqual([h.name, h.value, h.gain, h.swaps], ['아파트', 1500, 300, 1]);
  assert.equal(houseOf(chars[0], META), null);
  assert.deepEqual([marketInfo({ mult: 1.2 }).dir, marketInfo({ mult: 1.2 }).pct], ['up', 20]);
  assert.match(marketInfo({ mult: 0.85 }).text, /📉 시세 ×0\.85 \(-15%\)/);
  assert.equal(marketInfo(null), null);
});

test('prompt options: meet candidates, date cost / ❤️, propose chance, house listings (trade-in, 청약, sold out)', () => {
  // meet: spec on the option (8-A) / from love.candidates by partnerId; pass
  const meetP = {
    promptId: 'q1',
    kind: 'meet',
    charId: 'c1',
    options: [
      { id: 'meet:pt7', partnerId: 'pt7', trait: 'int', stars: 2, salary: 70, match: true, partner: partner('pt7', { trait: 'int', stars: 2 }) },
      { id: 'meet:pt8', partnerId: 'pt8', trait: 'luck', stars: 1 },
      { id: 'pass', label: '🙅 다음 기회에', icon: '🙅' },
    ],
  };
  const who = { ...chars[0], love: { candidates: [partner('pt8', { trait: 'luck', stars: 1, name: '하윤' })] } };
  const m = meetOptions(meetP, { character: who, meta: META });
  assert.equal(m.candidates.length, 2);
  assert.deepEqual(m.candidates.map((x) => [x.partner.name, x.partner.traitName, x.partner.starsText]), [
    ['연인pt7', '지력형', '★★☆☆'],
    ['하윤', '운형', '★☆☆☆'],
  ]);
  assert.equal(m.pass.id, 'pass');
  const meetHtml = meetOptionsHtml(meetP, who, { meta: META });
  assert.equal((meetHtml.match(/data-choose=/g) ?? []).length, 3);
  assert.match(meetHtml, /data-choose="meet:pt7" data-prompt="q1" data-char="c1"/);
  assert.match(meetHtml, /💞 찰떡궁합/);
  assert.match(meetHtml, /맞벌이 70만원/);
  assert.match(meetHtml, /class="av-pt" data-pt=/); // portraits hydrate later
  assert.match(meetHtml, />다음 기회에</); // icon not repeated in the label
  // date
  const dateP = {
    promptId: 'q2',
    kind: 'date',
    charId: 'c1',
    options: [
      { id: 'date:walk', label: '🚶 동네 산책', icon: '🚶', cost: 0, gain: 5, desc: '호감도 +5 · 무료' },
      { id: 'date:concert', label: '🎤 콘서트 데이트', icon: '🎤', cost: 40, gain: 35, match: true, desc: '호감도 +35 (취향 저격!) · 40만원' },
      { id: 'date:x', label: '🎢 놀이공원', icon: '🎢', cost: 999, gain: 25, disabled: true, desc: '호감도 +25 · 999만원 · 돈이 부족해요' },
    ],
  };
  const d = dateOptions(dateP);
  assert.deepEqual(d.map((x) => [x.cost, x.gain, x.free, x.match]), [[0, 5, true, false], [40, 35, false, true], [999, 25, false, false]]);
  const dateHtml = dateOptionsHtml(dateP, chars[0]);
  assert.match(dateHtml, /💸 무료/);
  assert.match(dateHtml, /💸 40만원/);
  assert.match(dateHtml, /❤️ \+35/);
  assert.match(dateHtml, /🎯 취향 저격!/);
  assert.match(dateHtml, /돈이 부족해요/);
  assert.match(dateHtml, /data-choose="date:x"[^>]*disabled/);
  assert.doesNotMatch(dateHtml, />🚶 동네 산책</);
  // propose: chance on the propose option only (steady carries chance 0)
  const propP = { promptId: 'q3', kind: 'propose', charId: 'c1', options: [{ id: 'propose', label: '💍 프러포즈!', icon: '💍', chance: 0.62, desc: '성공 확률 약 62% · 성공하면 결혼식' }, { id: 'steady', label: '💕 조금 더 사귀기', icon: '💕', chance: 0 }] };
  assert.deepEqual(proposeOptions(propP).map((x) => [x.propose, x.chance]), [[true, 62], [false, null]]);
  assert.equal(chancePct(0.5), 50);
  assert.equal(chancePct(75), 75);
  assert.equal(chancePct(null), null);
  const propHtml = proposeOptionsHtml(propP, chars[0]);
  assert.match(propHtml, /aria-valuenow="62"/);
  assert.match(propHtml, /성공 확률 62%/);
  assert.equal((propHtml.match(/chance-meter/g) ?? []).length, 1);
  assert.match(propHtml, />성공하면 결혼식</);
  // dispatcher
  assert.equal(familyOptionsHtml({ kind: 'shop', options: [] }, chars[0]), null);
  assert.ok(familyOptionsHtml(dateP, chars[0]).includes('date-list'));
  // house: trade-in, subscription, lucky value, sold out (capacity 1 owned by someone else), apartment shared
  const room = { characters: [...chars, { id: 'c4', name: '원룸주인', house: { id: 'oneroom', price: 300, value: 300 } }] };
  const houseP = {
    promptId: 'q4',
    kind: 'house',
    charId: 'c1',
    options: [
      { id: 'buy:oneroom', houseId: 'oneroom', price: 300, value: 300, tradeIn: 0, cost: 300, capacity: 1 },
      { id: 'buy:apartment', houseId: 'apartment', price: 840, basePrice: 1200, value: 1200, tradeIn: 210, cost: 630, subscription: true, capacity: null },
      { id: 'buy:jeju_villa', houseId: 'jeju_villa', price: 1500, value: 2500, tradeIn: 0, cost: 1500, lucky: true, capacity: 1, disabled: true, desc: '✨ 골드 매물 · 현금 1,500만원 필요' },
      { id: 'pass', label: '🙅 다음에 살게요', icon: '🙅' },
    ],
  };
  const hl = houseOptions(houseP, { room, meta: META, character: chars[0] });
  assert.equal(hl.listings.length, 3);
  const [one, apt, jeju] = hl.listings;
  assert.equal(one.full, true);
  assert.equal(one.disabled, true);
  assert.deepEqual(one.owners, ['원룸주인']);
  assert.deepEqual([apt.discount, apt.net, apt.tradeIn, apt.full, apt.house.capacity], [360, 630, 210, false, 0]);
  assert.deepEqual(apt.owners, ['지영']);
  assert.equal(jeju.house.lucky, true);
  assert.equal(jeju.disabled, true);
  assert.match(jeju.reason, /1,500만원 필요/);
  const houseHtml = houseOptionsHtml(houseP, chars[0], { meta: META, room, artFor: (k, id) => (id === 'apartment' ? '/a.png' : null) });
  assert.equal((houseHtml.match(/class="ci-opt house-item/g) ?? []).length, 3);
  assert.match(houseHtml, /🎫 청약 -360만원/);
  assert.match(houseHtml, /🔁 보상판매 \+210만원 → 실제 630만원/);
  assert.match(houseHtml, /💎 자산가치 2,500만원/);
  assert.match(houseHtml, /이미 팔린 매물이에요/);
  assert.match(houseHtml, /여러 명 가능 · 🏠 지영/);
  assert.match(houseHtml, /<img src="\/a.png"/);
  assert.match(houseHtml, /data-choose="pass"/);
});

test('planCutins: Stage 8 anchors, 입학 / 용돈 / 보상판매 chips, schoolMeet involves every pair; tags + fallback texts', () => {
  const events = [
    { type: 'married', charId: 'c1', spouse: partner('pt1'), gifts: [{ fromId: 'c2', amount: 40 }, { fromId: 'c3', amount: 40 }], total: 80, cutin: true },
    { type: 'log', text: '💒 결혼식!' },
    { type: 'moneyChanged', charId: 'c2', delta: -40, reason: 'weddingGift' },
    { type: 'moneyChanged', charId: 'c1', delta: 40, reason: 'weddingGift' },
    { type: 'childGrew', charId: 'c2', childId: 'ch1', kind: 'dol', stage: 'kid', amount: 20, gifts: [] },
    { type: 'childGrew', charId: 'c2', childId: 'ch2', kind: 'school', stage: 'teen', amount: -40 },
    { type: 'moneyChanged', charId: 'c2', delta: -40, reason: 'school' },
    { type: 'houseBought', charId: 'c3', houseId: 'villa', price: 700, tradeIn: 210 },
    { type: 'houseSold', charId: 'c3', houseId: 'oneroom', value: 300, amount: 210 },
    { type: 'allowance', charId: 'c3', childId: 'k9', amount: 30 },
    { type: 'schoolMeet', eraId: 'high', pairs: [{ charId: 'c1', partner: partner('a') }, { charId: 'c3', partner: partner('b') }] },
    { type: 'houseValueChanged', eraId: 'senior', mult: 1.3, changes: [] },
    { type: 'dated', charId: 'c1', gain: 20 },
  ];
  const gs = planCutins(events);
  assert.deepEqual(gs.map((g) => g.anchor.type), ['married', 'childGrew', 'houseBought', 'schoolMeet', 'houseValueChanged', 'dated']);
  assert.equal(gs[0].money.length, 2);
  assert.deepEqual(gs[0].involved, ['c1', 'c2', 'c3']);
  // the dol cut-in carries the 입학 as a chip (school is not an anchor)
  assert.deepEqual(gs[1].family.map((f) => [f.type, f.kind]), [['childGrew', 'school']]);
  assert.deepEqual(gs[2].family.map((f) => f.type), ['houseSold', 'allowance']);
  assert.deepEqual(gs[3].involved, ['c1', 'c3']);
  assert.equal(gs[3].charId, null);
  // tags / fallback text
  const t = (a) => tagLabel(a, {});
  assert.equal(t({ type: 'married' }), '💒 결혼식');
  assert.equal(t({ type: 'proposed', success: false }), '💔 프러포즈 실패');
  assert.equal(t({ type: 'childGrew', kind: 'dol' }), '🎂 돌잔치');
  assert.equal(t({ type: 'houseBought', tradeIn: 100 }), '🏠 집 갈아타기');
  assert.equal(t({ type: 'houseValueChanged', mult: 0.9 }), '📉 부동산 시세 폭락');
  assert.match(t({ type: 'promptResolved', kind: 'house' }), /부동산$/);
  assert.match(fallbackText({ type: 'houseValueChanged', mult: 1.25 }), /25% 올랐어요/);
  assert.match(fallbackText({ type: 'childBorn' }, '지영'), /지영네 집에 아기가/);
});

test('classifyGroup: 결혼 / 출산 / 고교 만남 / 시세 are big, a date is minor, my family events are full', () => {
  const g = (anchor, extra = {}) => ({ anchor, charId: anchor.charId ?? null, texts: [], money: [], delta: 0, involved: [anchor.charId].filter(Boolean), mc: null, studio: null, mcEvents: [], ...extra });
  const mine = new Set(['c1']);
  for (const type of ['married', 'childBorn', 'schoolMeet', 'houseValueChanged']) {
    assert.equal(isBigGroup(g({ type, charId: 'c2' })), true, type);
    assert.equal(classifyGroup(g({ type, charId: 'c2' }), { mine, mode: 'compact' }), 'full', type);
  }
  assert.equal(isBigGroup(g({ type: 'dated', charId: 'c2', lineTag: 'marriage_talk' })), false);
  assert.equal(classifyGroup(g({ type: 'dated', charId: 'c2' }), { mine, mode: 'compact' }), 'banner');
  assert.equal(classifyGroup(g({ type: 'dated', charId: 'c1' }), { mine, mode: 'compact' }), 'full');
  assert.equal(classifyGroup(g({ type: 'houseBought', charId: 'c2' }), { mine, mode: 'compact' }), 'banner');
  assert.equal(classifyGroup(g({ type: 'met', charId: 'c2' }), { mine, mode: 'off' }), 'skip');
  // a 고교 첫 만남 with my character in it counts as mine
  assert.equal(classifyGroup(g({ type: 'schoolMeet', pairs: [{ charId: 'c1' }] }), { mine, mode: 'off' }), 'full');
  // my prompt pre-empts: banner
  assert.equal(classifyGroup(g({ type: 'married', charId: 'c2' }), { mine, mode: 'compact', promptForMe: true }), 'banner');
  // merge: proposal + wedding of another character → one cut-in led by the wedding
  const merged = mergeGroups([g({ type: 'proposed', charId: 'c2', success: true }), g({ type: 'married', charId: 'c2' }, { family: [{ type: 'allowance' }] })], { mine });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].anchor.type, 'married');
  assert.equal(merged[0].family.length, 1);
});

test('panel helpers: family icons / summary / 3D tag badge, detail rows (❤️ bar, spouse, kids, house), CPU badge', () => {
  assert.equal(familyIcons(chars[0]), '💕');
  assert.equal(familyIcons(chars[1]), '💍 🧒🌟👶');
  assert.equal(familyIcons(chars[2]), '');
  assert.equal(familySummary(chars[1], META), '💍 연인pt2(★3) · 자녀 2명 (🌟 1)');
  assert.equal(familyTagBadge(chars[1]), '💍👶2🏠');
  assert.equal(familyTagBadge(chars[2]), '');
  const f = familyOf(chars[0], META);
  assert.equal(f.partner.name, '연인pt1');
  assert.equal(f.affection.pct, 60);
  const d0 = familyDetailHtml(chars[0], { meta: META });
  assert.match(d0, /연애/);
  assert.match(d0, /aria-valuenow="30"/);
  assert.match(d0, /❤️ 30\/50/);
  const d1 = familyDetailHtml(chars[1], { meta: META, room: { housingMarket: { eraId: 'senior', mult: 1.25 } }, avatars: loadData('avatars') });
  assert.match(d1, /배우자/);
  assert.match(d1, /💼 맞벌이 100만원/);
  assert.match(d1, /🌟 천재/);
  assert.match(d1, /어린이/);
  assert.match(d1, /가치 1,500만원 \(\+300만원\)/);
  assert.match(d1, /갈아타기 1회/);
  assert.match(d1, /📈 시세 ×1\.25/);
  assert.equal(familyDetailHtml(chars[2], { meta: META }), '');
  assert.equal(isCpu({ cpu: true }), true);
  assert.equal(isCpu({ ownerId: 'cpu' }), true);
  assert.equal(isCpu({ ownerId: 'p1' }), false);
  assert.match(cpuBadgeHtml({ cpu: true }), /🤖 CPU/);
  assert.equal(ownerHtml({ ownerId: 'cpu', ownerName: 'CPU' }).match(/CPU/g).length, 1); // only the badge, no "CPU 🤖 CPU"
  assert.match(ownerHtml({ ownerId: 'cpu', ownerName: 'CPU' }), /^<span class="cpu-badge"/);
  assert.equal(ownerHtml({ ownerId: 'p1', ownerName: '<철수>' }), '&lt;철수&gt;');
  assert.equal(cpuBadgeHtml({ ownerId: 'p2' }), '');
});
