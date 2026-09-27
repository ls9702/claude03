// Stage 9-B pure client helpers for submaps + treasures: option cards, outcomes, the deterministic horse race, treasure
// value masking, scene art, planCutins / tagLabel / resolveSceneBg / classifyGroup for the Stage 9 events.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HORSES,
  SUBMAP_TILE_TYPES,
  isSubmapBig,
  isSubmapPass,
  isWishUnlock,
  parseOptionId,
  racePlan,
  stripIcon,
  submapInfo,
  submapOf,
  submapOptions,
  submapSuccess,
  treasureCount,
  treasureInfo,
  treasureValueText,
  treasuresOf,
  wishUnlockAt,
} from '../public/js/shared/submaps.js';
import { SUBMAP_SCENES, raceGateHtml, raceHtml, submapOptionsHtml, submapSceneBody, treasureArtHtml, treasureChestSvg, treasureListHtml } from '../public/js/ui/submapArt.js';
import { PREFER_SVG_SCENES, SVG_SCENES, planCutins, resolveSceneBg, tagLabel, fallbackText } from '../public/js/ui/cutinMap.js';
import { classifyGroup, isBannerGroup, isBigGroup, mergeGroups } from '../public/js/ui/cutinPolicy.js';

const won = (n) => `${n}만원`;
const META = {
  treasures: {
    treasures: [
      { id: 'celadon', name: '고려청자', icon: '🏺', desc: '천 년 전 청자', min: 300, max: 900 },
      { id: 'old_coin', name: '옛날 동전', icon: '🪙', min: 20, max: 150 },
    ],
  },
  jobs: { jobs: [{ id: 'mountain_spirit', unlock: { wishes: 3 } }] },
};

// prompts shaped like 9-A's server/game/submaps.js builds
const templePrompt = {
  promptId: 'q1',
  kind: 'temple',
  charId: 'c1',
  forCharacterIds: ['c1'],
  options: [
    { id: 'train:int', stat: 'int', gain: 2, label: '🧘 지력 수련', icon: '🧘', desc: '지력 +2 · 다음 룰렛 1번 쉬기' },
    { id: 'train:str', stat: 'str', gain: 2, label: '🧘 체력 수련', icon: '🧘', desc: '', disabled: true },
    { id: 'train:charm', stat: 'charm', gain: 2, label: '🧘 매력 수련', icon: '🧘' },
    { id: 'train:luck', stat: 'luck', gain: 2, label: '🧘 운 수련', icon: '🧘' },
    { id: 'wish', label: '🙏 소원 빌기', icon: '🙏', desc: '시주 5만원', chance: 0.45, cost: 5, price: 5, money: 25 },
    { id: 'leave', label: '🚶 합장만 하고 나가기', icon: '🚶', desc: '아무 일도 없어요' },
  ],
};
const reversalPrompt = {
  promptId: 'q2',
  kind: 'reversal',
  charId: 'c1',
  forCharacterIds: ['c1'],
  options: [
    { id: 'lotto', label: '🎟️ 인생역전 로또', icon: '🎟️', desc: '30만원 · 1등 3000만원', cost: 30, price: 30 },
    { id: 'horse:2', label: '🏇 경마 2배', icon: '🏇', odds: 2, chance: 0.47, stake: 100, cost: 100 },
    { id: 'horse:5', label: '🏇 경마 5배', icon: '🏇', odds: 5, chance: 0.188, stake: 100, cost: 100 },
    { id: 'horse:10', label: '🏇 경마 10배', icon: '🏇', odds: 10, chance: 0.094, stake: 100, cost: 100, disabled: true, desc: '100만원 필요 · 돈이 부족해요' },
    { id: 'skip', label: '🍵 욕심 버리기', icon: '🍵', desc: '지금 가진 것에 만족해요' },
  ],
};

test('submap info / ids / tile types (contract defaults, meta wins)', () => {
  assert.equal(submapInfo('hometown').name, '고향 시골집');
  assert.equal(submapInfo('temple').scene, 'temple');
  assert.equal(submapInfo('reversal').scene, 'casino');
  assert.equal(submapInfo('casino').id, 'reversal');
  assert.equal(submapInfo('jeju', { submaps: { jeju: { name: '제주 한 달 살기' } } }).name, '제주 한 달 살기');
  assert.match(submapInfo('jeju').tag, /🌴 제주도/);
  assert.equal(submapOf({ submap: 'temple' }), 'temple');
  assert.equal(submapOf({ kind: 'reversal' }), 'reversal');
  assert.equal(submapOf({ tileType: 'casino' }), 'reversal');
  assert.equal(submapOf({ kind: 'shop' }), null);
  for (const t of ['hometown', 'temple', 'jeju', 'reversal', 'treasure']) assert.ok(SUBMAP_TILE_TYPES[t].icon && SUBMAP_TILE_TYPES[t].name, t);
  assert.deepEqual(parseOptionId('train:luck'), { kind: 'train', stat: 'luck' });
  assert.deepEqual(parseOptionId('horse:10'), { kind: 'horse', odds: 10 });
  assert.equal(parseOptionId('wish').kind, 'wish');
  assert.equal(stripIcon('🧘 지력 수련', '🧘'), '지력 수련');
  assert.equal(stripIcon('✈️ 제주도로 떠나기', '✈️'), '제주도로 떠나기');
  assert.equal(stripIcon('푹 쉬기', '😴'), '푹 쉬기');
});

test('submapOptions: stat chips for 수련, odds cards for 경마 (chance %, stake, payout), lotto, disabled kept', () => {
  const t = submapOptions(templePrompt);
  assert.equal(t.length, 6);
  const int = t.find((o) => o.id === 'train:int');
  assert.equal(int.kind, 'train');
  assert.equal(int.stat, 'int');
  assert.equal(int.statLabel, '지력');
  assert.equal(int.icon, '🧠'); // stat icon beats the generic 🧘
  assert.equal(int.label, '지력 수련');
  assert.equal(int.gain, 2);
  assert.equal(t.find((o) => o.id === 'train:str').disabled, true);
  const wish = t.find((o) => o.id === 'wish');
  assert.equal(wish.chance, 45);
  assert.equal(wish.cost, 5);
  const r = submapOptions(reversalPrompt);
  const h5 = r.find((o) => o.id === 'horse:5');
  assert.equal(h5.kind, 'horse');
  assert.equal(h5.odds, 5);
  assert.equal(h5.chance, 18.8);
  assert.equal(h5.stake, 100);
  assert.equal(h5.payout, 500);
  assert.equal(h5.horse.odds, 5);
  assert.equal(r.find((o) => o.id === 'horse:10').disabled, true);
  assert.equal(r.find((o) => o.id === 'lotto').kind, 'lotto');
  assert.equal(r.find((o) => o.id === 'skip').label, '욕심 버리기');
});

test('submapSuccess / pass / big: 9-A results (wishOk, horseWin, jackpot, skip …)', () => {
  const ev = (o) => ({ type: 'submapResult', charId: 'c1', ...o });
  assert.equal(submapSuccess(ev({ submap: 'temple', optionId: 'wish', result: 'wishOk' })), true);
  assert.equal(submapSuccess(ev({ submap: 'temple', optionId: 'wish', result: 'wishFail' })), false);
  assert.equal(submapSuccess(ev({ submap: 'reversal', optionId: 'horse:5', result: 'horseWin', amount: 400 })), true);
  assert.equal(submapSuccess(ev({ submap: 'reversal', optionId: 'horse:5', result: 'horseLose', amount: -100 })), false);
  assert.equal(submapSuccess(ev({ submap: 'reversal', optionId: 'lotto', result: 'lottoLose', amount: -30 })), false);
  assert.equal(submapSuccess(ev({ submap: 'hometown', optionId: 'rest', result: 'rest' })), null);
  assert.equal(submapSuccess(ev({ submap: 'reversal', optionId: 'horse:2', amount: 50 })), true); // no result → amount
  assert.equal(isSubmapPass(ev({ submap: 'reversal', optionId: 'skip', result: 'skip' })), true);
  assert.equal(isSubmapPass(ev({ submap: 'temple', optionId: 'leave', result: 'leave' })), true);
  assert.equal(isSubmapPass(ev({ submap: 'jeju', optionId: 'trip', result: 'trip', cutin: false })), true);
  assert.equal(isSubmapPass(ev({ submap: 'jeju', optionId: 'trip', result: 'trip' })), false);
  assert.equal(isSubmapBig(ev({ submap: 'reversal', optionId: 'lotto', result: 'jackpot', amount: 2970 })), true);
  assert.equal(isSubmapBig(ev({ submap: 'reversal', optionId: 'horse:10', result: 'horseWin', amount: 900 })), true);
  assert.equal(isSubmapBig(ev({ submap: 'reversal', optionId: 'horse:2', result: 'horseWin', amount: 100 })), false);
  assert.equal(isSubmapBig(ev({ submap: 'reversal', optionId: 'lotto', result: 'lottoWin', amount: 170 })), false);
  assert.equal(wishUnlockAt(META), 3);
  assert.equal(wishUnlockAt({}), 3);
  assert.equal(isWishUnlock(ev({ submap: 'temple', optionId: 'wish', result: 'wishOk', wishes: 3 })), true);
  assert.equal(isSubmapBig(ev({ submap: 'temple', optionId: 'wish', result: 'wishOk', wishes: 3 })), true);
  assert.equal(isSubmapBig(ev({ submap: 'temple', optionId: 'wish', result: 'wishOk', wishes: 2 })), false);
  assert.equal(isSubmapBig(ev({ submap: 'temple', optionId: 'wish', result: 'wishFail', wishes: 5 })), false);
  assert.equal(isSubmapBig({ type: 'landed' }), false);
});

test('racePlan: deterministic from the event; the chosen horse wins exactly when the result is a win', () => {
  const win = { type: 'submapResult', charId: 'c2', turnNo: 40, submap: 'reversal', optionId: 'horse:5', result: 'horseWin', amount: 400, odds: 5 };
  const lose = { ...win, result: 'horseLose', amount: -100 };
  const a = racePlan(win);
  assert.deepEqual(racePlan(win), a); // same for every viewer
  assert.equal(a.won, true);
  assert.equal(a.chosen, 5);
  assert.equal(a.winner, 5);
  assert.equal(a.horses.length, 3);
  assert.deepEqual(a.horses.map((h) => h.place).sort(), [1, 2, 3]);
  const first = a.horses.find((h) => h.place === 1);
  assert.equal(first.odds, 5);
  assert.ok(first.chosen && first.winner);
  assert.ok(a.horses.every((h) => h.finishMs <= a.durationMs));
  assert.ok(a.horses.every((h) => h.place === 1 || h.finishMs > first.finishMs), 'the winner crosses the line first');
  for (let t = 0; t < 30; t++) {
    const p = racePlan({ ...lose, turnNo: t, charId: `c${t % 5}` });
    assert.equal(p.won, false);
    assert.notEqual(p.winner, 5, 'a lost bet never shows the chosen horse winning');
    assert.equal(p.horses.find((h) => h.chosen).odds, 5);
    assert.notEqual(p.horses.find((h) => h.chosen).place, 1);
  }
  assert.equal(racePlan({ ...lose, winnerOdds: 10 }).winner, 10); // the server may name the winner
  assert.deepEqual(HORSES.map((h) => h.odds), [2, 5, 10]);
});

test('treasures: info from /api/meta, per character list, value hidden until the appraisal, fakes', () => {
  assert.equal(treasureInfo('celadon', META).name, '고려청자');
  assert.equal(treasureInfo('celadon', META).icon, '🏺');
  assert.equal(treasureInfo('mystery', META).icon, '💎');
  const c = { id: 'c1', treasures: [{ uid: 'tr1', id: 'celadon' }, { uid: 'tr2', id: 'old_coin' }] };
  assert.equal(treasureCount(c), 2);
  assert.equal(treasureCount({}), 0);
  assert.deepEqual(treasuresOf(c, META).map((t) => [t.uid, t.info.name]), [['tr1', '고려청자'], ['tr2', '옛날 동전']]);
  assert.deepEqual(treasureValueText(null), { text: '감정 전 ???', fake: false, appraised: false, value: null });
  assert.equal(treasureValueText({ uid: 'tr1', treasureId: 'celadon', value: 650, fake: false }, { won }).text, '650만원');
  assert.equal(treasureValueText({ uid: 'tr2', treasureId: 'old_coin', value: 3, fake: true }, { won }).text, '💥 가짜!');
  assert.equal(treasureValueText({ uid: 'tr2', treasureId: 'old_coin', value: 0 }, { won }).fake, true); // no flag: 0 = fake
});

test('submap art: 4 distinct scene SVGs, race / gate / chest / option cards / treasure list markup', () => {
  const bodies = SUBMAP_SCENES.map((s) => submapSceneBody(s));
  assert.equal(new Set(bodies).size, 4);
  for (const b of bodies) assert.ok(b.length > 300 && !/ id="/.test(b), 'no ids (the cut-in has one SVG gradient id)');
  assert.match(submapSceneBody('temple'), /sm-bell/);
  assert.equal(submapSceneBody('office'), null);
  const race = raceHtml(racePlan({ charId: 'c1', optionId: 'horse:2', result: 'horseWin', amount: 100 }));
  assert.equal((race.match(/class="sm-lane/g) ?? []).length, 3);
  assert.equal((race.match(/sm-lane chosen winner/g) ?? []).length, 1);
  assert.match(race, /🏆 적중!/);
  assert.match(raceHtml(racePlan({ charId: 'c1', optionId: 'horse:10', result: 'horseLose' })), /💸 꽝/);
  assert.equal((raceGateHtml().match(/class="sm-lane/g) ?? []).length, 3);
  assert.match(treasureChestSvg({ open: true }), /chest-svg open/);
  assert.match(treasureArtHtml('celadon', { meta: META }), /🏺/);
  assert.match(treasureArtHtml('celadon', { meta: META, art: '/a/t.png' }), /<img src="\/a\/t.png"/);
  const who = { id: 'c1', name: '지영' };
  assert.equal(submapOptionsHtml({ kind: 'shop', options: [] }, who), null);
  const html = submapOptionsHtml(templePrompt, who, { won });
  assert.equal((html.match(/data-choose=/g) ?? []).length, 6);
  assert.match(html, /data-choose="train:str"[^>]*disabled/);
  assert.match(html, /sm-train-row/);
  const rh = submapOptionsHtml(reversalPrompt, who, { won });
  assert.equal((rh.match(/sm-opt horse/g) ?? []).length, 3);
  assert.match(rh, /×5/);
  assert.match(rh, /aria-valuenow="18.8"/);
  assert.match(rh, /lotto-ball/);
  assert.match(rh, /data-choose="horse:10"[^>]*disabled/);
  const list = treasuresOf({ treasures: [{ uid: 'tr1', id: 'celadon' }] }, META);
  assert.match(treasureListHtml(list), /감정 전 \?\?\?/);
  assert.match(treasureListHtml(list, { values: new Map([['tr1', { value: 500, fake: false }]]), won }), /500만원/);
  assert.match(treasureListHtml(list, { values: new Map([['tr1', { value: 0, fake: true, text: '💥 가짜!' }]]), won }), /💥 가짜!/);
});

test('planCutins: submapEntered is never an anchor (the prompt follows); submapResult / treasureFound are, with follow-ups', () => {
  const events = [
    { type: 'landed', charId: 'c1', tileType: 'reversal', cutin: false },
    { type: 'submapEntered', charId: 'c1', submap: 'reversal', cutin: true },
    { type: 'prompt', charId: 'c1', kind: 'reversal', cutin: true },
  ];
  assert.equal(planCutins(events).length, 0);
  const res = [
    { type: 'chose', charId: 'c1' },
    { type: 'submapResult', charId: 'c1', submap: 'reversal', optionId: 'horse:5', result: 'horseWin', amount: 400, odds: 5, cutin: true },
    { type: 'moneyChanged', charId: 'c1', delta: 400, reason: 'reversal' },
    { type: 'log', text: '🏇 지영의 말이 1등!' },
    { type: 'treasureFound', charId: 'c1', uid: 'tr1', treasureId: 'celadon', source: 'jeju' },
    { type: 'log', text: '🏺 고려청자 발견' },
  ];
  const g = planCutins(res);
  assert.deepEqual(g.map((x) => x.anchor.type), ['submapResult', 'treasureFound']);
  assert.deepEqual(g[0].money, [{ charId: 'c1', delta: 400, reason: 'reversal' }]);
  assert.deepEqual(g[0].texts, ['🏇 지영의 말이 1등!']);
  assert.deepEqual(g[1].texts, ['🏺 고려청자 발견']);
  assert.equal(tagLabel(g[0].anchor), '🎰 인생역전 · 경마');
  assert.equal(tagLabel({ type: 'submapResult', submap: 'temple', optionId: 'wish' }), '🛕 산사 · 소원');
  assert.equal(tagLabel(g[1].anchor), '💎 보물 발견');
  assert.match(tagLabel({ type: 'promptResolved', kind: 'jeju', tone: 'love' }, { tones: { love: { icon: '💕', label: '연애' } } }), /제주도/);
  assert.match(fallbackText({ type: 'submapResult', optionId: 'horse:2', result: 'horseLose' }, '민수'), /민수의 말/);
  assert.match(fallbackText({ type: 'treasureFound' }, '민수'), /보물 발견/);
  // mvpDecided never becomes a board cut-in
  assert.equal(planCutins([{ type: 'mvpDecided', charId: 'c1', cutin: true }]).length, 0);
});

test('resolveSceneBg: submap scenes draw their own SVG before a fallback background; generated art wins', () => {
  for (const s of ['hometown', 'temple', 'jeju', 'casino']) {
    assert.ok(SVG_SCENES.has(s));
    assert.ok(PREFER_SVG_SCENES.has(s));
  }
  const presentation = { scenes: { temple: { bg: 'bg-temple' }, 'mountain-trail': { bg: 'bg-mountain' } }, sceneFallbacks: { temple: 'mountain-trail', casino: 'office' } };
  const only = (ids) => (id) => (ids.includes(id) ? `/a/${id}.webp` : null);
  const r = resolveSceneBg('temple', { presentation, assetUrl: only(['bg-mountain']) });
  assert.equal(r.url, null);
  assert.equal(r.svgScene, 'temple');
  assert.equal(resolveSceneBg('temple', { presentation, assetUrl: only(['bg-temple', 'bg-mountain']) }).url, '/a/bg-temple.webp');
  assert.equal(resolveSceneBg('casino', { presentation, findBg: (s) => (s === 'office' ? '/o.webp' : null) }).svgScene, 'casino');
  // Stage 7 behaviour unchanged: shop still borrows the office background
  assert.equal(resolveSceneBg('shop', { presentation: { sceneFallbacks: { shop: 'office' } }, findBg: (s) => (s === 'office' ? '/o.webp' : null) }).url, '/o.webp');
});

test('policy: treasure finds minor unless mine; jackpots / big wins / 산신령 wishes big; passes are banners', () => {
  const mine = new Set(['c1']);
  const tf = planCutins([{ type: 'treasureFound', charId: 'c2', uid: 'tr1', treasureId: 'celadon' }])[0];
  assert.equal(classifyGroup(tf, { mine, mode: 'compact' }), 'banner');
  assert.equal(classifyGroup(tf, { mine, mode: 'full' }), 'full');
  assert.equal(classifyGroup({ ...tf, charId: 'c1' }, { mine, mode: 'compact' }), 'full');
  const sr = (o) => planCutins([{ type: 'submapResult', charId: 'c2', cutin: true, ...o }])[0];
  const jackpot = sr({ submap: 'reversal', optionId: 'lotto', result: 'jackpot', amount: 2970 });
  assert.equal(isBigGroup(jackpot), true);
  assert.equal(classifyGroup(jackpot, { mine, mode: 'compact' }), 'full');
  assert.equal(classifyGroup(sr({ submap: 'reversal', optionId: 'horse:2', result: 'horseWin', amount: 100 }), { mine, mode: 'compact' }), 'banner');
  assert.equal(classifyGroup(sr({ submap: 'temple', optionId: 'wish', result: 'wishOk', wishes: 3 }), { mine, mode: 'compact' }), 'full');
  assert.equal(classifyGroup(sr({ submap: 'temple', optionId: 'wish', result: 'wishOk', wishes: 1 }), { mine, mode: 'compact' }), 'banner');
  const skip = sr({ submap: 'reversal', optionId: 'skip', result: 'skip', cutin: false });
  assert.equal(isBannerGroup(skip), true);
  assert.equal(classifyGroup({ ...skip, charId: 'c1' }, { mine, mode: 'full' }), 'banner');
  assert.equal(classifyGroup(skip, { mine, mode: 'off' }), 'skip');
  // merge: a treasure found on a 제주 trip joins the trip cut-in of another player (the bigger anchor leads)
  const merged = mergeGroups(planCutins([
    { type: 'submapResult', charId: 'c2', submap: 'jeju', optionId: 'trip', result: 'trip', amount: -30, cutin: true },
    { type: 'treasureFound', charId: 'c2', uid: 'tr3', treasureId: 'celadon', source: 'jeju' },
  ]), { mine });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].anchor.type, 'submapResult');
  assert.deepEqual(merged[0].anchors.map((a) => a.type), ['submapResult', 'treasureFound']);
});
