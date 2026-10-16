// 세계 설정 (치이카와 모드 / 현실 모드) — client pure parts: the world meta (shared/world.js `worldMeta`), the 토벌 / 풀뽑기 /
// 쿠지 view models (shared/worldPlay.js), the art builders (ui/worldArt.js: chimeras, battle / field cards, kuji tickets,
// scenes), planCutins / tagLabel / scenes (ui/cutinMap.js), the policy (ui/cutinPolicy.js), requirement badges + merit
// (shared/growth.js), the item / treasure fallbacks. No DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../server/data/index.js';
import { worldMeta, worldOf, worldData } from '../public/js/shared/world.js';
import {
  DEFAULT_MONSTERS,
  KUJI_RANKS,
  MONSTER_IDS,
  WORLD_TILE_TYPES,
  huntOutcome,
  huntPrompt,
  isHuntBig,
  isHuntRun,
  isKujiBig,
  isKujiDraw,
  isWeedBig,
  isWeedWork,
  kujiRankInfo,
  kujiRows,
  kujiSummary,
  monsterInfo,
  weedGrade,
  weedOutcome,
  weedPrompt,
  worldTags,
} from '../public/js/shared/worldPlay.js';
import { WORLD_SCENES, gradeLadderHtml, huntOptionsHtml, kujiBoxSvg, kujiTicketHtml, monsterSvg, passStampHtml, weedOptionsHtml, worldOptionsHtml, worldSceneBody } from '../public/js/ui/worldArt.js';
import { DEFAULT_SCENE_FALLBACKS, PREFER_SVG_SCENES, SVG_SCENES, WORLD_ANCHORS, fallbackText, planCutins, resolveSceneBg, tagLabel } from '../public/js/ui/cutinMap.js';
import { classifyGroup, isBannerGroup, isBigGroup, isWeedWorkGroup, mergeGroups } from '../public/js/ui/cutinPolicy.js';
import { WORLD_JOB_FALLBACK, jobInfo, meritNeed, optionExtras, requirementList } from '../public/js/shared/growth.js';
import { itemInfo, lottoRows } from '../public/js/shared/cards.js';
import { treasureInfo } from '../public/js/shared/submaps.js';

const won = (n) => `${n}만원`;
const noNaN = (s, label) => assert.ok(!/NaN|undefined|Infinity/.test(s), `${label}: NaN/undefined`);
// /api/meta as the server builds it (the parts the client reads) + worldOverlays
const tones = loadData('tones');
const META = {
  jobs: loadData('jobs'),
  items: loadData('items'),
  cards: loadData('cards'),
  treasures: loadData('treasures'),
  news: loadData('news'),
  awards: loadData('awards'),
  titles: loadData('titles'),
  hunts: loadData('hunts'),
  presentation: tones,
  mc: { ...loadData('mc'), lines: loadData('lines').mc ?? {} },
  balance: { lottoMode: 'numbers', shop: loadData('balance').shop, clubs: loadData('balance').clubs },
  board: { tileTypes: loadData('board').tileTypes, routes: loadData('board').routes },
  worldOverlays: { chiikawa: loadData('worlds/chiikawa') },
};
const CW = worldMeta(META, 'chiikawa');

test('world meta: real = the meta itself, chiikawa = overlay names + tones → presentation + lines.mc → mc.lines, memoized', () => {
  assert.equal(worldMeta(META, 'real'), META);
  assert.equal(worldMeta(META, 'nope'), META);
  assert.equal(worldOf({ config: { world: 'chiikawa' } }), 'chiikawa');
  assert.equal(worldOf({ config: {} }), 'real');
  assert.equal(worldMeta(META, 'chiikawa'), CW, 'memoized');
  assert.equal(worldMeta(CW, 'chiikawa'), CW, 'a world meta resolves to itself');
  assert.equal(worldMeta(CW, 'real'), META, 'and back to the base');
  assert.equal(worldData(CW, 'real', META.worldOverlays), META);
  assert.ok(Object.isFrozen(CW));
  // jobs / items / cards / treasures / awards of the world
  const ids = CW.jobs.jobs.map((j) => j.id);
  for (const id of ['weeder', 'hunter', 'ramen', 'workshop', 'legend_hunter', 'weed_sage', 'landlord', 'mountain_spirit']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('civil_servant'), 'human jobs removed');
  assert.equal(jobInfo('weeder', CW.jobs).name, '풀뽑기 일꾼');
  assert.equal(jobInfo('civil_servant', META.jobs).name, '공무원', 'the real meta keeps them');
  assert.equal(CW.jobs.partTime.name, '갑옷씨네 노동');
  assert.equal(itemInfo('car', CW).name, '씽씽 킥보드');
  assert.equal(itemInfo('car', META).name, '경차');
  assert.equal(itemInfo('armor', CW).name, '갑옷');
  assert.ok(CW.awards.awards.some((a) => a.id === 'hunt_king') && !META.awards.awards.some((a) => a.id === 'hunt_king'));
  assert.ok(CW.titles.titles.length > META.titles.titles.length);
  assert.equal(treasureInfo('kuji_plush', CW).name, treasureInfo('kuji_plush', null).name);
  // the overlay's tones / MC pools land where the client reads them
  assert.equal(CW.presentation.scenes.shop.label, '갑옷씨 상점');
  assert.notEqual(META.presentation.scenes.shop.label, '갑옷씨 상점');
  assert.ok(Array.isArray(CW.mc.lines.lotto?.hoya) && /쿠지/.test(JSON.stringify(CW.mc.lines.lotto)));
  assert.ok(!/쿠지/.test(JSON.stringify(META.mc.lines.lotto ?? {})));
  assert.deepEqual(Object.keys(CW.mc.lines).sort(), [...new Set([...Object.keys(META.mc.lines), ...Object.keys(CW.lines.mc)])].sort(), 'other MC pools kept');
  assert.equal(CW.balance.lottoMode, 'kuji');
  assert.equal(CW.balance.shop.title, '🛍️ 갑옷씨 상점');
});

test('fallbacks: chiikawa job / item / treasure names without the overlay, real world defaults unchanged', () => {
  assert.equal(jobInfo('hunter', { jobs: [] }).name, '토벌대');
  assert.equal(jobInfo('armor_san', null).hidden, true);
  assert.equal(Object.keys(WORLD_JOB_FALLBACK).length, 16);
  assert.equal(jobInfo('nope', null), null);
  assert.equal(itemInfo('guitar', null).name, '하치와레표 기타');
  assert.equal(itemInfo('car', null).name, '자동차', 'DEFAULT_ITEMS stay real-world');
  assert.equal(treasureInfo('kuji_plush', null).icon, '🧸');
});

test('토벌 view models: prompt card (monster, chance %, reward, badges), outcome, big = 데카츠요 win', () => {
  assert.deepEqual(MONSTER_IDS, ['small_chimera', 'chimera', 'big_chimera', 'dekatsuyo']);
  assert.deepEqual(META.hunts.monsters.map((m) => m.id), MONSTER_IDS, 'fallback ids = hunts.json');
  for (const m of DEFAULT_MONSTERS) assert.equal(monsterInfo(m.id, META).power, m.power);
  assert.equal(monsterInfo('nope').power, 2);
  const p = {
    promptId: 'p1', kind: 'hunt', charId: 'c1', forCharacterIds: ['c1'],
    options: [{ id: 'fight', label: '⚔️ 싸운다', chance: 0.64, reward: [100, 190], monsterId: 'big_chimera', armor: true, sasumata: true }, { id: 'run', label: '🏃 도망친다' }],
    context: { monsterId: 'big_chimera', monster: { id: 'big_chimera', name: '커다란 키메라', icon: '🦖', power: 3 } },
  };
  const v = huntPrompt(p, { meta: META });
  assert.equal(v.monster.id, 'big_chimera');
  assert.equal(v.monster.power, 3);
  assert.equal(v.fight.chance, 64);
  assert.deepEqual(v.fight.reward, [100, 190]);
  assert.deepEqual(v.fight.badges.map((b) => b.text), ['🔱 사스마타', '🛡️ 갑옷']);
  assert.equal(v.run.id, 'run');
  assert.equal(v.danger, 'mid');
  assert.equal(huntPrompt({ ...p, options: [{ id: 'fight', chance: 0.2 }, { id: 'run' }] }).danger, 'hard');
  const win = { type: 'huntResult', charId: 'c1', monsterId: 'dekatsuyo', success: true, amount: 420, injured: 0, hunts: 6, chance: 0.33 };
  const o = huntOutcome(win, { meta: META });
  assert.equal(o.win, true);
  assert.equal(o.big, true);
  assert.equal(o.chance, 33);
  assert.ok(isHuntBig(win));
  assert.ok(!isHuntBig({ ...win, monsterId: 'chimera' }));
  assert.ok(!isHuntBig({ ...win, success: false }));
  const lose = huntOutcome({ type: 'huntResult', monsterId: 'chimera', success: false, amount: -35, injured: 2 }, { meta: META });
  assert.deepEqual([lose.win, lose.amount, lose.injured, lose.big], [false, -35, 2, false]);
  assert.ok(isHuntRun({ type: 'promptResolved', kind: 'hunt', result: 'run' }));
  assert.ok(!isHuntRun({ type: 'promptResolved', kind: 'weed', result: 'run' }));
});

test('풀뽑기 view models: grade labels, prompt card (work pay, exam chance / fee / free / disabled), outcomes, tags', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(weedGrade), ['무자격', '5급', '4급', '3급', '2급', '1급']);
  const p = (exam, ctx = {}) => ({ promptId: 'p2', kind: 'weed', charId: 'c1', forCharacterIds: ['c1'], options: [{ id: 'work', amount: 30, label: '🌿 풀뽑기 일하기 (+30만원)' }, exam], context: { level: 2, grade: '4급', ...ctx } });
  const v = weedPrompt(p({ id: 'exam', chance: 0.47, fee: 20, level: 3, grade: '3급' }));
  assert.deepEqual([v.level, v.grade, v.work.amount, v.exam.target, v.exam.grade, v.exam.chance, v.exam.fee, v.exam.free, v.exam.disabled], [2, '4급', 30, 3, '3급', 47, 20, false, false]);
  const free = weedPrompt(p({ id: 'exam', chance: 0.7, fee: 0, level: 1 }, { level: 0 }));
  assert.equal(free.exam.free, true);
  const short = weedPrompt(p({ id: 'exam', chance: 0.7, fee: 5, level: 1, disabled: true, desc: '합격 확률 약 70% · 응시료 5만원 · 돈이 부족해요' }, { level: 0 }));
  assert.equal(short.exam.disabled, true);
  assert.equal(short.exam.reason, '응시료가 부족해요');
  const maxed = weedPrompt(p({ id: 'exam', disabled: true, level: 5, desc: '이미 최고 급수(1급)예요!' }, { level: 5, grade: '1급' }));
  assert.equal(maxed.maxed, true);
  assert.match(maxed.exam.reason, /1급/);
  const pass = weedOutcome({ type: 'weedResult', action: 'exam', success: true, level: 5, grade: '1급', target: 5 });
  assert.deepEqual([pass.pass, pass.grade, pass.big], [true, '1급', true]);
  assert.ok(isWeedBig({ type: 'weedResult', action: 'exam', success: true, level: 5 }));
  assert.ok(!isWeedBig({ type: 'weedResult', action: 'exam', success: true, level: 3 }));
  const fail = weedOutcome({ type: 'weedResult', action: 'exam', success: false, level: 2, target: 3 });
  assert.deepEqual([fail.pass, fail.target, fail.big], [false, 3, false]);
  const work = weedOutcome({ type: 'weedResult', action: 'work', level: 2, amount: 30 });
  assert.deepEqual([work.action, work.pass, work.amount], ['work', null, 30]);
  assert.ok(isWeedWork({ type: 'weedResult', action: 'work' }));
  assert.deepEqual(worldTags({ weed: { level: 1 }, hunts: 3 }).map((t) => t.text), ['🌿 5급', '⚔️ 토벌 3회']);
  assert.deepEqual(worldTags({ weed: { level: 0 }, hunts: 0 }), []);
  assert.deepEqual(worldTags({}), [], 'real-world characters: nothing');
  assert.equal(WORLD_TILE_TYPES.hunt.icon, '⚔️');
  assert.equal(WORLD_TILE_TYPES.weed.icon, '🌿');
  assert.deepEqual(META.board.tileTypes.hunt, { ...WORLD_TILE_TYPES.hunt }, 'fallback = board.json');
  assert.deepEqual(META.board.tileTypes.weed, { ...WORLD_TILE_TYPES.weed });
});

test('쿠지: kuji vs numbered lottoDraw, rows (best rank first, prize chips, no duplicate plush chip), summary, big = 1등', () => {
  const chars = [{ id: 'c1', name: '민수', isMe: true }, { id: 'c2', name: '뚱이' }, { id: 'c3', name: '하늘' }];
  const kuji = {
    type: 'lottoDraw', eraId: 'young', kuji: true,
    entries: [
      { charId: 'c2', rank: 5, prize: { name: '꽝 · 휴지' } },
      { charId: 'c1', rank: 1, prize: { name: '1등 · 커다란 치이카와 인형', money: 150, treasureId: 'kuji_plush' }, line: '야하!' },
      { charId: 'c3', rank: 4, prize: { name: '4등 · 라멘 「郎」 식사권', money: 10, stats: { str: 1 } } },
    ],
  };
  const numbers = { type: 'lottoDraw', eraId: 'baby', numbers: [3, 11, 17], entries: [{ charId: 'c1', numbers: [3, 9, 17], matches: 2, prize: 100 }] };
  assert.ok(isKujiDraw(kuji) && !isKujiDraw(numbers));
  assert.ok(isKujiBig(kuji));
  assert.ok(!isKujiBig({ ...kuji, entries: kuji.entries.filter((e) => e.rank !== 1) }));
  assert.deepEqual(kujiRows(numbers, { characters: chars }), [], 'the numbered payload is not a kuji');
  assert.equal(lottoRows(numbers, { characters: chars }).rows[0].prize, 100, 'old payload: cards.js lottoRows as before');
  assert.equal(lottoRows(kuji, { characters: chars }).numbers.length, 0, 'lottoRows never breaks on a kuji payload');
  const rows = kujiRows(kuji, { characters: chars, meta: CW, won });
  assert.deepEqual(rows.map((r) => [r.name, r.rank, r.label, r.won]), [['민수', 1, '1등', true], ['하늘', 4, '4등', true], ['뚱이', 5, '꽝', false]]);
  assert.equal(rows[0].title, '커다란 치이카와 인형');
  assert.equal(rows[0].icon, KUJI_RANKS[1].icon);
  assert.deepEqual(rows[0].chips.map((c) => c.text), ['💰 +150만원'], 'the plush chip is not repeated next to its title');
  assert.deepEqual(rows[1].chips.map((c) => c.text), ['💰 +10만원', '💪 체력 +1']);
  assert.equal(rows[2].title, '휴지');
  assert.equal(rows[0].line, '야하!');
  assert.match(kujiSummary(rows), /민수 1등/);
  assert.match(kujiSummary(rows.slice(2)), /꽝/);
  assert.match(kujiSummary([]), /응모권/);
  const card = kujiRows({ ...kuji, entries: [{ charId: 'c3', rank: 3, prize: { name: '3등 · 랜덤 카드', cardId: 'taxi' } }] }, { characters: chars, meta: CW, won });
  assert.equal(card[0].chips[0].text, `🃏 ${CW.cards.cards.find((k) => k.id === 'taxi').name} 카드`, 'card names of the world');
  assert.equal(kujiRankInfo(2, { name: '2등 · 갑옷씨 상점 상품권', money: 60 }).title, '갑옷씨 상점 상품권');
});

test('art: four distinct chimeras (no NaN / ids), battle + field cards (data-choose, meter, badges, disabled), scenes, tickets', () => {
  const svgs = MONSTER_IDS.map((id) => monsterSvg(id));
  assert.equal(new Set(svgs).size, 4);
  for (const [i, s] of svgs.entries()) {
    noNaN(s, MONSTER_IDS[i]);
    assert.ok(!/\sid="/.test(s), 'no SVG ids');
    assert.match(s, /viewBox="0 0 200 180"/);
  }
  assert.match(monsterSvg('dekatsuyo', { mood: 'poof' }), /mon-puff/);
  assert.match(monsterSvg('mystery'), /monster-svg/, 'unknown ids still draw');
  const p = { promptId: 'p1', kind: 'hunt', charId: 'c1', forCharacterIds: ['c1'], options: [{ id: 'fight', chance: 0.64, reward: [100, 190], monsterId: 'big_chimera', sasumata: true }, { id: 'run' }], context: { monsterId: 'big_chimera' } };
  const who = { id: 'c1', name: '민수' };
  const hunt = huntOptionsHtml(p, who, { meta: META, won });
  noNaN(hunt, 'hunt card');
  assert.match(hunt, /data-choose="fight" data-prompt="p1" data-char="c1"/);
  assert.match(hunt, /data-choose="run"/);
  assert.match(hunt, /aria-valuenow="64"/);
  assert.match(hunt, /100만원~190만원/);
  assert.match(hunt, /🔱 사스마타/);
  assert.match(hunt, /monster-svg mon-big_chimera/);
  assert.ok(!/monster-svg/.test(huntOptionsHtml(p, who, { meta: META, art: false })), 'cut-in: the window shows the chimera');
  assert.match(huntOptionsHtml(p, who, { meta: META, artFor: () => '/a/monster.png' }), /<img src="\/a\/monster.png"/);
  const w = { promptId: 'p2', kind: 'weed', charId: 'c1', forCharacterIds: ['c1'], options: [{ id: 'work', amount: 30 }, { id: 'exam', chance: 0.7, fee: 5, level: 1, disabled: true, desc: '… · 돈이 부족해요' }], context: { level: 0 } };
  const weed = weedOptionsHtml(w, who, { won });
  noNaN(weed, 'weed card');
  assert.match(weed, /풀뽑기 일하기 \(\+30만원\)/);
  assert.match(weed, /data-choose="exam"[^>]*disabled/);
  assert.match(weed, /응시료가 부족해요/);
  assert.match(weed, /지금 자격: <b>무자격<\/b>/);
  assert.equal(worldOptionsHtml({ kind: 'shop' }, who), null);
  assert.equal(worldOptionsHtml(p, who, { meta: META }), huntOptionsHtml(p, who, { meta: META }));
  assert.equal((gradeLadderHtml(2).match(/class="on/g) ?? []).length, 2);
  assert.match(passStampHtml(true, { grade: '3급' }), /합격!/);
  assert.match(passStampHtml(false), /불합격/);
  assert.match(kujiTicketHtml({ rank: 1, jackpot: true, won: true, label: '1등', icon: '🧸' }, { delay: 900 }), /jackpot.*--d:900ms/);
  assert.match(kujiBoxSvg(), /쿠지/);
  assert.deepEqual(WORLD_SCENES, ['weed-field', 'hunt-forest', 'ramen-shop', 'kuji']);
  for (const s of WORLD_SCENES) {
    const body = worldSceneBody(s);
    assert.ok(body && body.length > 200, s);
    noNaN(body, s);
    assert.ok(!/\sid="/.test(body), `${s}: no ids`);
  }
  assert.match(worldSceneBody('ramen-shop'), /郎/);
  assert.equal(worldSceneBody('office'), null);
});

test('cut-ins: huntResult / weedResult anchors, 토벌 run = a lone banner group, kuji plush folds into the draw, tags, scenes', () => {
  assert.deepEqual([...WORLD_ANCHORS], ['huntResult', 'weedResult']);
  const ev = [
    { type: 'huntResult', charId: 'c1', monsterId: 'chimera', success: true, amount: 80, hunts: 1 },
    { type: 'moneyChanged', charId: 'c1', delta: 80, reason: 'hunt' },
    { type: 'statChanged', charId: 'c1', stat: 'str', delta: 1, value: 5 },
    { type: 'log', text: '⚔️ 토벌 성공', charId: 'c1' },
    { type: 'weedResult', charId: 'c2', action: 'work', amount: 30, level: 0 },
    { type: 'moneyChanged', charId: 'c2', delta: 30, reason: 'weed' },
    { type: 'promptResolved', kind: 'hunt', charId: 'c3', result: 'run', cutin: false },
    { type: 'log', text: '🏃 도망', charId: 'c3' },
  ];
  const g = planCutins(ev);
  assert.deepEqual(g.map((x) => x.anchor.type), ['huntResult', 'weedResult', 'promptResolved']);
  assert.deepEqual(g[0].money, [{ charId: 'c1', delta: 80, reason: 'hunt' }]);
  assert.equal(g[0].stats.length, 1);
  assert.deepEqual(g[2].texts, ['🏃 도망']);
  assert.equal(tagLabel(g[0].anchor), '⚔️ 토벌 · 승리');
  assert.equal(tagLabel({ type: 'huntResult', success: false }), '⚔️ 토벌 · 패배');
  assert.equal(tagLabel({ type: 'weedResult', action: 'exam', success: true }), '🌿 풀뽑기 검정 · 합격');
  assert.equal(tagLabel({ type: 'weedResult', action: 'exam', success: false }), '🌿 풀뽑기 검정 · 불합격');
  assert.equal(tagLabel(g[1].anchor), '🌿 풀뽑기 일하기');
  assert.equal(tagLabel(g[2].anchor), '🏃 토벌 · 도망');
  assert.equal(tagLabel({ type: 'lottoDraw', kuji: true }), '🎟️ 쿠지 뽑기');
  assert.equal(tagLabel({ type: 'lottoDraw', numbers: [1] }), '🎱 전국 로또');
  assert.match(fallbackText({ type: 'huntResult', success: true }, '민수'), /토벌 성공/);
  assert.match(fallbackText({ type: 'weedResult', action: 'exam', success: true, grade: '3급' }, '민수'), /3급 검정 합격/);
  assert.match(fallbackText({ type: 'lottoDraw', kuji: true }), /쿠지/);
  // kuji: the 1등 plush treasureFound is part of the draw's show
  const kg = planCutins([
    { type: 'lottoDraw', kuji: true, eraId: 'young', entries: [{ charId: 'c1', rank: 1, prize: { name: '1등', money: 150, treasureId: 'kuji_plush' } }] },
    { type: 'moneyChanged', charId: 'c1', delta: 150, reason: 'kuji' },
    { type: 'treasureFound', charId: 'c1', uid: 'tr1', treasureId: 'kuji_plush', source: 'kuji' },
  ]);
  assert.equal(kg.length, 1);
  assert.equal(kg[0].treasure.treasureId, 'kuji_plush');
  // a tile treasure stays its own cut-in
  assert.equal(planCutins([{ type: 'treasureFound', charId: 'c1', treasureId: 'gold_crown', source: 'tile' }]).length, 1);
  // scenes: the 치이카와 SVG scenes beat the fallback chain until their bg art is accepted; the defaults mirror tones.json
  for (const s of WORLD_SCENES) {
    assert.ok(SVG_SCENES.has(s) && PREFER_SVG_SCENES.has(s), s);
    assert.deepEqual(resolveSceneBg(s, { presentation: tones }), { scene: s, url: null, svgScene: s, via: [s] });
  }
  for (const k of [...WORLD_SCENES, 'workshop', 'sento', 'bookstore', 'cafe', 'park', 'house']) assert.equal(DEFAULT_SCENE_FALLBACKS[k], tones.sceneFallbacks[k], k);
  assert.equal(resolveSceneBg('sento', { presentation: tones }).svgScene, 'office', 'sento → house → office');
  assert.equal(resolveSceneBg('weed-field', { presentation: tones, findBg: (s) => (s === 'weed-field' ? '/bg/weed.webp' : null) }).url, '/bg/weed.webp', 'accepted art wins');
});

test('policy: 데카츠요 / 1급 / 쿠지 1등 big, others banners in 「간단히」, plain 풀뽑기 work + running away = banners, my ticket = mine', () => {
  const grp = (events) => mergeGroups(planCutins(events), { mine: [] });
  const mine = ['c1'];
  const big = grp([{ type: 'huntResult', charId: 'c2', monsterId: 'dekatsuyo', success: true, amount: 400 }])[0];
  const small = grp([{ type: 'huntResult', charId: 'c2', monsterId: 'chimera', success: true, amount: 60 }])[0];
  const lose = grp([{ type: 'huntResult', charId: 'c2', monsterId: 'chimera', success: false, amount: -30, injured: 2 }])[0];
  assert.ok(isBigGroup(big) && !isBigGroup(small) && !isBigGroup(lose));
  assert.equal(classifyGroup(big, { mine, mode: 'compact' }), 'full');
  assert.equal(classifyGroup(small, { mine, mode: 'compact' }), 'banner');
  assert.equal(classifyGroup(small, { mine, mode: 'full' }), 'full');
  assert.equal(classifyGroup(small, { mine: ['c2'], mode: 'compact' }), 'full', 'mine');
  const pass1 = grp([{ type: 'weedResult', charId: 'c2', action: 'exam', success: true, level: 5, grade: '1급' }])[0];
  const pass3 = grp([{ type: 'weedResult', charId: 'c2', action: 'exam', success: true, level: 3, grade: '3급' }])[0];
  assert.equal(classifyGroup(pass1, { mine, mode: 'compact' }), 'full');
  assert.equal(classifyGroup(pass3, { mine, mode: 'compact' }), 'banner');
  const work = grp([{ type: 'weedResult', charId: 'c2', action: 'work', amount: 30 }])[0];
  assert.ok(isWeedWorkGroup(work));
  assert.equal(classifyGroup(work, { mine, mode: 'full' }), 'banner', 'others: a banner even in 「전체」');
  assert.equal(classifyGroup(work, { mine, mode: 'off' }), 'skip');
  assert.equal(classifyGroup(work, { mine: ['c2'], mode: 'compact' }), 'full', 'my own work: a (short) cut-in');
  const run = grp([{ type: 'promptResolved', kind: 'hunt', charId: 'c2', result: 'run', cutin: false }])[0];
  assert.ok(isBannerGroup(run));
  assert.equal(classifyGroup(run, { mine: ['c2'], mode: 'full' }), 'banner', 'running away: a banner, also mine');
  const entries = (rank1) => [{ charId: 'c2', rank: rank1 ? 1 : 4, prize: { name: 'x', money: 10 } }, { charId: 'c3', rank: 5, prize: { name: '꽝' } }];
  const k = (rank1, extra = []) => grp([{ type: 'lottoDraw', kuji: true, entries: [...entries(rank1), ...extra] }])[0];
  assert.equal(classifyGroup(k(false), { mine, mode: 'compact' }), 'banner', 'no 1등, not mine');
  assert.equal(classifyGroup(k(true), { mine, mode: 'compact' }), 'full', '1등');
  assert.equal(classifyGroup(k(false, [{ charId: 'c1', rank: 5, prize: { name: '꽝' } }]), { mine, mode: 'compact' }), 'full', 'my ticket');
  assert.equal(classifyGroup(grp([{ type: 'lottoDraw', numbers: [1, 2, 3], entries: [] }])[0], { mine, mode: 'compact' }), 'full', 'the numbered lotto stays a show');
  assert.equal(classifyGroup(k(false, [{ charId: 'c1', rank: 5, prize: {} }]), { mine, mode: 'compact', promptForMe: true }), 'defer');
});

test('requirements + merit: 🌿 풀뽑기 n급 / ⚔️ 토벌 n회 badges (checked against the character), meritFrom', () => {
  const reqs = requirementList({ weed: 1, hunts: 8, stats: { str: 8 } }, { character: { weed: { level: 1 }, hunts: 3, stats: { str: 9 } } });
  assert.deepEqual(reqs.map((r) => [r.text, r.ok]), [['🌿 풀뽑기 5급 필요', true], ['⚔️ 토벌 8회 필요', false], ['💪 8+', true]]);
  assert.equal(requirementList({ weed: 5 })[0].text, '🌿 풀뽑기 1급 필요');
  assert.equal(requirementList({ weed: 5 })[0].ok, null, 'no character → unknown');
  // a job offer option of the world: weeder needs 5급
  const x = optionExtras({ kind: 'jobOffer' }, { id: 'weeder', jobId: 'weeder' }, { jobs: CW.jobs, character: { weed: { level: 0 }, stats: {} } });
  assert.ok(x.reqs.some((r) => r.kind === 'weed' && r.ok === false));
  // 토벌대: merit only for ranks ≥ meritFrom (3)
  const hunter = CW.jobs.jobs.find((j) => j.id === 'hunter');
  assert.equal(hunter.rankUp.meritFrom, 3);
  assert.equal(meritNeed({ job: { id: 'hunter', rank: 1 }, cards: [] }, CW.jobs), null, '1 → 2: no merit');
  assert.deepEqual(meritNeed({ job: { id: 'hunter', rank: 2 }, cards: [{ id: 'merit' }] }, CW.jobs), { need: 1, have: 1, ok: true }, '2 → 3');
  // real-world merit jobs unchanged (no meritFrom)
  const doc = META.jobs.jobs.find((j) => j.rankUp?.merit);
  assert.ok(meritNeed({ job: { id: doc.id, rank: 1 }, cards: [] }, META.jobs));
});
