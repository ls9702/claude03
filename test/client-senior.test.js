// 노년 역전 — client pure parts: view models (shared/seniorPlay.js) built from REAL server prompts / events, the art builders
// (ui/seniorArt.js: stake cards, number pad, contest card, auction lots, wheel, hammer board, scenes), planCutins / tags /
// scenes (ui/cutinMap.js), the policy (ui/cutinPolicy.js), the shop card's 👴 노년 line, haltNote. No DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameData, loadData } from '../server/data/index.js';
import { applyAction, startGame } from '../server/game/engine.js';
import { addCharacter, joinRoom } from '../server/game/lobby.js';
import { worldMeta } from '../public/js/shared/world.js';
import {
  DEFAULT_ITEM_SENIOR,
  SENIOR_TILE_TYPES,
  auctionOutcome,
  auctionPrompt,
  contestOutcome,
  contestPrompt,
  isAuctionBig,
  isIslandBig,
  isSeniorPass,
  islandOutcome,
  islandPickPrompt,
  islandPrompt,
  itemSenior,
  seniorItemText,
  seniorItemsOf,
  standingText,
  themeInfo,
} from '../public/js/shared/seniorPlay.js';
import { SENIOR_SCENES, auctionOptionsHtml, contestOptionsHtml, hammerBoardHtml, islandOptionsHtml, islandPickHtml, islandWheelHtml, seniorOptionsHtml, seniorSceneBody } from '../public/js/ui/seniorArt.js';
import { DEFAULT_SCENE_FALLBACKS, PREFER_SVG_SCENES, SENIOR_ANCHORS, SVG_SCENES, fallbackText, planCutins, tagLabel } from '../public/js/ui/cutinMap.js';
import { classifyGroup, isBannerGroup, isBigGroup } from '../public/js/ui/cutinPolicy.js';
import { eraClock, eraClockText, haltNote, lastTurnHint } from '../public/js/shared/loop.js';
import { makeLoopRoom } from './client-loopFixture.js';
import { itemInfo } from '../public/js/shared/cards.js';
import { shopOptionsHtml } from '../public/js/ui/cardArt.js';
import { makeRoom, plainEra, toEra } from './helpers.js';

const won = (n) => `${n}만원`;
const noNaN = (s, label) => assert.ok(!/NaN|undefined|Infinity|\[object/.test(s), `${label}: NaN/undefined`);
const tones = loadData('tones');
const bal = loadData('balance');
const META = {
  items: loadData('items'),
  cards: loadData('cards'),
  treasures: loadData('treasures'),
  presentation: tones,
  balance: { shop: bal.shop, senior: bal.senior },
  board: { tileTypes: loadData('board').tileTypes },
  worldOverlays: { chiikawa: loadData('worlds/chiikawa') },
};
const CW = worldMeta(META, 'chiikawa');

// ---------- a real final race to build prompts / events from ----------
function fixedRng({ ints = [], nexts = [] } = {}) {
  const qi = [...ints];
  const qn = [...nexts];
  return { next: () => (qn.length ? qn.shift() : 0.99), int: (a) => (qi.length ? qi.shift() : a), pick: (arr) => arr[0], weighted: (items) => items[0], get state() { return 99; } };
}
const act = (room, action, rng = {}) => applyAction(room, action, { rng: fixedRng(rng), now: 1000 });
const cur = (room) => room.turn.order[room.turn.currentIndex];
const choose = (room, optionId, rng = {}) => {
  const p = room.turn.pending;
  return act(room, { type: 'choose', characterId: p.forCharacterIds[0], promptId: p.promptId, optionId }, rng);
};
function senior(tile, { cash = 800, items = [], world } = {}) {
  let room = makeRoom({ seed: 5 });
  if (world) room.config = { ...room.config, world };
  room = joinRoom(room, 'A', '에이', 0).room;
  room = joinRoom(room, 'B', '비', 0).room;
  for (const [o, n] of [['A', '하나'], ['B', '둘'], ['A', '셋']]) room = addCharacter(room, o, { name: n }, 0).room;
  room = startGame(room, { now: 0 }).room;
  const last = room.board.eras.length - 1;
  toEra(room, last);
  plainEra(room, last);
  for (const c of room.characters) Object.assign(c, { careerDone: true, military: { status: 'done', turnsLeft: 0 }, job: { id: 'chef', rank: 1, exp: 0, injured: 0 }, money: cash, debt: 0, items: [], treasures: [], stats: { int: 4, str: 4, charm: 6, luck: 4 } });
  const era = room.board.eras[last];
  era.tiles[2] = { id: era.tiles[2].id, label: 't', ...tile };
  room.characters.find((c) => c.id === cur(room)).items = items;
  return act(room, { type: 'spin', characterId: cur(room) }, { ints: [2] });
}

test('data mirrors: tile types, item senior fallbacks, theme names (both worlds), scenes', () => {
  const board = loadData('board').tileTypes;
  for (const [id, t] of Object.entries(SENIOR_TILE_TYPES)) assert.deepEqual({ name: board[id].name, icon: board[id].icon, color: board[id].color }, { ...t }, id);
  for (const it of [...loadData('items').items, ...CW.items.items]) {
    assert.equal(DEFAULT_ITEM_SENIOR[it.id]?.use, it.senior.use, it.id);
    assert.equal(DEFAULT_ITEM_SENIOR[it.id]?.theme, it.senior.theme, it.id);
  }
  assert.equal(itemSenior('car', META).desc, loadData('items').items.find((i) => i.id === 'car').seniorDesc);
  assert.match(itemSenior('car', CW).desc, /킥보드/);
  assert.equal(themeInfo('sing', CW).name, '하치와레 노래자랑');
  assert.equal(themeInfo('sing', META).name, '노래자랑');
  assert.equal(themeInfo('baduk', META).statLabel, '지력');
  assert.ok(itemInfo('lucky_cat', null).seniorDesc && itemInfo('lucky_cat', CW).seniorDesc.includes('행운의 숫자'));
  for (const s of SENIOR_SCENES) {
    assert.ok(SVG_SCENES.has(s) && PREFER_SVG_SCENES.has(s), s);
    assert.equal(DEFAULT_SCENE_FALLBACKS[s], tones.sceneFallbacks[s], s);
    const body = seniorSceneBody(s);
    assert.ok(body && body.length > 200 && !/id="/.test(body), s);
    noNaN(body, s);
  }
  assert.equal(seniorSceneBody('office'), null);
});

test('한방역전섬 view model + stake cards + 행운의 숫자 pad from a real prompt (🍀 lucky item)', () => {
  const r = senior({ type: 'island', label: '한방역전섬' }, { items: ['lucky_cat'] });
  const p = r.room.turn.pending;
  const v = islandPrompt(p);
  assert.deepEqual(v.tiers.map((t) => [t.tier, t.numbers, t.lucky, t.mult, t.bust]), [['all', 2, 1, 8, true], ['half', 4, 1, 3, false], ['little', 6, 1, 1.8, false]]);
  assert.equal(v.tiers[0].stake, 800);
  assert.equal(v.tiers[0].chance, 20);
  assert.ok(v.retire?.place && v.pass);
  assert.equal(v.rank, p.context.rank);
  assert.match(standingText(v, won), /위/);
  const html = islandOptionsHtml(p, { id: p.charId, name: '하나' }, { won });
  noNaN(html, 'island');
  assert.equal((html.match(/data-choose=/g) ?? []).length, 5);
  assert.match(html, /🌾 틀리면 쪽박/);
  assert.match(html, /🍀 행운의 숫자 \+1/);
  assert.equal((html.match(/<i class="on lucky">/g) ?? []).length, 3, 'one green dot per tier');
  assert.equal(seniorOptionsHtml(p, { id: p.charId }, { won }), islandOptionsHtml(p, { id: p.charId }, { won }));
  // the pad
  const pick = choose(r.room, 'bet:half').room.turn.pending;
  const pv = islandPickPrompt(pick);
  assert.deepEqual([pv.tier, pv.numbers, pv.mult, pv.stake, pv.options.length], ['half', 4, 3, 400, 10]);
  assert.deepEqual(pv.options.find((o) => o.id === '9').covers, [9, 10, 1, 2]);
  const pad = islandPickHtml(pick, { id: pick.charId }, { won });
  noNaN(pad, 'pad');
  assert.equal((pad.match(/class="ci-opt isl-num"/g) ?? []).length, 10);
  assert.match(pad, /9·10·1·2/);
  // a disabled tier shows its reason
  const poor = senior({ type: 'island', label: '한방역전섬' }, { cash: 5 }).room.turn.pending;
  const ph = islandOptionsHtml(poor, { id: poor.charId }, { won });
  assert.equal((ph.match(/ disabled/g) ?? []).length, 3);
  assert.match(ph, /걸 돈이 부족/);
});

test('islandResult → outcome, wheel, chips / tags; big = 대박 / 쪽박; a pass is a banner', () => {
  const r = senior({ type: 'island', label: '한방역전섬' });
  const hitR = choose(choose(r.room, 'bet:all').room, '7', { ints: [7] });
  const ev = hitR.events.find((e) => e.type === 'islandResult');
  const o = islandOutcome(ev);
  assert.deepEqual([o.result, o.jackpot, o.amount, o.roll, o.covers], ['jackpot', true, 5600, 7, [7]]);
  assert.ok(isIslandBig(ev));
  const wheel = islandWheelHtml(o);
  noNaN(wheel, 'wheel');
  assert.match(wheel, /--rot:-2016deg/); // 6 wedges back + 5 turns
  assert.equal((wheel.match(/<path d="M110 110/g) ?? []).length, 10);
  const groups = planCutins(hitR.events);
  const g = groups.find((x) => x.anchor.type === 'islandResult');
  assert.ok(g, 'an islandResult cut-in');
  assert.equal(tagLabel(g.anchor), '🏝️ 한방역전섬 · 대박!');
  assert.match(fallbackText(g.anchor, '하나'), /대박/);
  assert.equal(classifyGroup(g, { mine: [], mode: 'compact' }), 'full', 'a 대박 is a show for everyone');
  assert.ok(SENIOR_ANCHORS.has('islandResult'));
  // 쪽박
  const bust = choose(choose(r.room, 'bet:all').room, '7', { ints: [2] });
  const be = bust.events.find((e) => e.type === 'islandResult');
  assert.ok(isIslandBig(be) && islandOutcome(be).bust);
  assert.equal(tagLabel(be), '🏝️ 한방역전섬 · 쪽박');
  // a small loss of someone else → banner in 「간단히」
  const lose = choose(choose(r.room, 'bet:little').room, '1', { ints: [9] });
  const lg = planCutins(lose.events).find((x) => x.anchor.type === 'islandResult');
  assert.equal(isBigGroup(lg), false);
  assert.equal(classifyGroup(lg, { mine: [], mode: 'compact' }), 'banner');
  // 「욕심 버리기」 → a lone banner group
  const pass = choose(r.room, 'pass');
  const pr = pass.events.find((e) => e.type === 'promptResolved');
  assert.ok(isSeniorPass(pr));
  const pg = planCutins(pass.events).find((x) => x.anchor === pr);
  assert.ok(pg && isBannerGroup(pg));
  assert.equal(tagLabel(pr), '🍵 한방역전섬 · 지나가기');
  // the pause note
  const mv = r.events.find((e) => e.type === 'moved');
  assert.equal(haltNote(mv)?.icon ?? null, mv.halted === 'island' ? '🏝️' : null);
  assert.deepEqual(haltNote({ type: 'moved', halted: 'island', remaining: 2 }), { text: '🏝️ 한방역전섬 (남은 2칸)', kind: 'info', icon: '🏝️' });
});

test('노년 대회 view model + card from a real prompt; contestResult outcome / tag', () => {
  const r = senior({ type: 'contest', label: '노년 대회' }, { items: ['designer_bag'] });
  const p = r.room.turn.pending;
  const v = contestPrompt(p, { meta: META });
  assert.equal(v.theme.id, 'sing');
  assert.equal(v.theme.statLabel, '매력');
  assert.equal(v.item?.id, 'designer_bag');
  assert.deepEqual(v.tiers.map((t) => t.tier), ['small', 'big']);
  assert.ok(v.chance > 50);
  const html = contestOptionsHtml(p, { id: p.charId }, { won, meta: META });
  noNaN(html, 'contest');
  assert.match(html, /명품 가방 효과/);
  assert.equal((html.match(/data-choose=/g) ?? []).length, 3);
  const w = choose(r.room, 'join:big', { nexts: [0.05] });
  const ev = w.events.find((e) => e.type === 'contestResult');
  const o = contestOutcome(ev, { meta: META });
  assert.deepEqual([o.place, o.label, o.prize, o.big], [1, '우승', 270, true]);
  assert.equal(tagLabel(ev), '🏆 노년 대회 · 우승');
  // chiikawa names
  assert.equal(contestOutcome(ev, { meta: CW }).theme.name, '하치와레 노래자랑');
});

test('골동품 경매 view model + lots from a real prompt; auctionResult outcome / hammer board', () => {
  const r = senior({ type: 'auction', label: '경매' }, { items: ['designer_bag', 'car'] });
  const p = r.room.turn.pending;
  const v = auctionPrompt(p);
  assert.deepEqual(v.lots.map((l) => [l.kind, l.itemId, l.premium]), [['item', 'designer_bag', 1.5], ['item', 'car', null]]);
  assert.ok(v.junk && v.leave && v.hammer.length === 10);
  const html = auctionOptionsHtml(p, { id: p.charId }, { won, artFor: () => null });
  noNaN(html, 'auction');
  assert.match(html, /💎 명품 프리미엄 ×1.5/);
  assert.equal((html.match(/data-choose=/g) ?? []).length, 4);
  const sold = choose(r.room, 'sell:item:designer_bag', { ints: [10] });
  const ev = sold.events.find((e) => e.type === 'auctionResult');
  const o = auctionOutcome(ev, { meta: META });
  assert.deepEqual([o.kind, o.name, o.mult, o.big, o.cheap], ['item', '명품 가방', 3, true, false]);
  assert.ok(isAuctionBig(ev));
  const board = hammerBoardHtml(o, v.hammer);
  noNaN(board, 'board');
  assert.equal((board.match(/class="hit/g) ?? []).length, 1);
  assert.equal(tagLabel(ev), '🔨 경매 · 낙찰 ×3');
});

test('item 노년 활용: seniorItem chips fold into their anchor, alone a banner; texts; detail list; shop card line', () => {
  const r = senior({ type: 'loss', label: '병원비', amount: 60 }, { items: ['car'] });
  const it = r.events.find((e) => e.type === 'seniorItem');
  assert.equal(it.use, 'dodge');
  assert.equal(seniorItemText(it, { meta: META, won }).text, '🚗 경차 덕분에 지출 칸 통과!');
  assert.equal(seniorItemText(it, { meta: CW, won }).text, '🛴 씽씽 킥보드 덕분에 지출 칸 통과!');
  const g = planCutins(r.events).find((x) => x.anchor === it);
  assert.ok(g && isBannerGroup(g), 'alone: a banner');
  assert.equal(seniorItemText({ use: 'pension', itemId: 'massage_chair', amount: 40, healed: true }, { meta: META, won }).text, '💺 안마의자 건강 보너스 +40만원 · 부상 회복');
  assert.deepEqual(seniorItemsOf({ items: ['car', 'nope', 'laptop'] }, META).map((x) => x.id), ['car', 'laptop']);
  // the shop card shows the 👴 line
  const shopP = { promptId: 'pr1', charId: 'c1', kind: 'shop', options: [{ id: 'buy:0', itemId: 'lucky_cat', price: 150, basePrice: 150, seniorDesc: '한방역전섬에서 행운의 숫자 +1개' }, { id: 'leave', label: '그냥 나가기' }] };
  const html = shopOptionsHtml(shopP, { id: 'c1' }, { meta: META });
  assert.match(html, /class="si-senior"[^>]*>👴 노년: 한방역전섬에서 행운의 숫자 \+1개/);
});

test('⏰ 노년 마감 clock in the HUD: 「노년 · 골인 경쟁 3/12턴」, the last round warns; no clock → the old text', () => {
  const room = makeLoopRoom({});
  room.eraIndex = room.board.eras.length - 1;
  for (const c of room.characters) c.position = { eraIndex: room.eraIndex, route: 'main', index: 0 };
  Object.assign(room.turn, { eraRound: null, eraTurns: null });
  assert.equal(eraClockText(eraClock(room)), '노년 · 골인 경쟁');
  Object.assign(room.turn, { raceRound: 3, raceRounds: 12 });
  const c = eraClock(room);
  assert.deepEqual([c.race, c.round, c.turns, c.left, c.last], [true, 3, 12, 9, false]);
  assert.equal(eraClockText(c), '노년 · 골인 경쟁 3/12턴');
  assert.equal(lastTurnHint(c), '');
  room.turn.raceRound = 12;
  assert.match(lastTurnHint(eraClock(room)), /노년 마감/);
});
