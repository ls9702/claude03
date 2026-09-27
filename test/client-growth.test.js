// Stage 6-B client pure modules: growth outfits (effectiveAvatar), stat / job formatting helpers, Stage 6 cut-in
// planning (stat / salary chips, news attached to the studio) and the cut-in policy for job / news events.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_ERA_OUTFITS,
  characterEra,
  displayCharacters,
  educationLabel,
  effectiveAvatar,
  jobBadge,
  jobInfo,
  militaryLabel,
  optionExtras,
  optionLabel,
  rankStars,
  requirementBadges,
  salaryChip,
  statCap,
  statChip,
  statPct,
  statRows,
} from '../public/js/shared/growth.js';
import { planCutins, tagLabel } from '../public/js/ui/cutinMap.js';
import { classifyGroup, isBigGroup, mergeGroups } from '../public/js/ui/cutinPolicy.js';

const avatars = JSON.parse(readFileSync(new URL('../server/data/avatars.json', import.meta.url), 'utf8'));
const ERAS = ['baby', 'elem', 'middle', 'high', 'young', 'middle_age', 'senior'];
const board = { eras: ERAS.map((id) => ({ id, name: id, tiles: [] })) };
const jobs = {
  jobs: [
    { id: 'doctor', name: '의사', icon: '🩺', hidden: false, outfit: 'doctor', requires: { int: 7, education: 'college' }, ranks: [{ name: '인턴', salary: 300 }, { name: '전문의', salary: 500 }, { name: '과장', salary: 700 }] },
    { id: 'idol', name: '아이돌', icon: '🎤', hidden: false, outfit: 'idol', requires: { stats: { charm: 6 } }, ranks: [{ name: '연습생', salary: 100 }, { name: '데뷔', salary: 300 }] },
    { id: 'astronaut', name: '우주비행사', icon: '🚀', hidden: true, outfit: 'suit', ranks: [{ name: '후보', salary: 600 }] },
  ],
  partTime: { id: 'parttime', name: '알바', icon: '🧾', ranks: [{ name: '알바', salary: 80 }], outfit: 'apron' },
};
const room = (extra = {}) => ({ status: 'playing', config: {}, board, ...extra });
const girl = { ...avatars.default, body: 'girl', outfit: 'dress', outfitColor: 'pink' };
const boy = { ...avatars.default, body: 'boy', outfit: 'hoodie', outfitColor: 'green' };
const at = (avatar, eraIndex, extra = {}) => ({ id: 'c1', avatar, position: { eraIndex, route: 'main', index: 0 }, ...extra });
const ctx = (r = room()) => ({ room: r, avatars, jobs });

test('eraOutfits contract: every costume exists in avatars.json', () => {
  const ids = new Set(avatars.parts.outfit.map((o) => o.id));
  for (const entry of Object.values(DEFAULT_ERA_OUTFITS)) for (const [k, v] of Object.entries(entry)) if (k !== 'job') assert.ok(ids.has(v), v);
  for (const j of [...jobs.jobs, jobs.partTime]) assert.ok(ids.has(j.outfit), j.outfit);
});

test('effectiveAvatar: era costumes (any / body-specific), senior hanbok', () => {
  assert.equal(effectiveAvatar(at(boy, 0), ctx()).outfit, 'dino');
  assert.equal(effectiveAvatar(at(girl, 1), ctx()).outfit, 'tracksuit');
  assert.equal(effectiveAvatar(at(boy, 2), ctx()).outfit, 'uniform');
  assert.equal(effectiveAvatar(at(girl, 2), ctx()).outfit, 'sailor');
  assert.equal(effectiveAvatar(at(girl, 3), ctx()).outfit, 'sailor');
  assert.equal(effectiveAvatar(at(boy, 3), ctx()).outfit, 'uniform');
  assert.equal(effectiveAvatar(at(girl, 6), ctx()).outfit, 'hanbokTrad');
  // `character.era` wins over the position
  assert.equal(effectiveAvatar({ ...at(boy, 0), era: 'senior' }, ctx()).outfit, 'hanbokTrad');
  // other parts and the player's colour stay
  const a = effectiveAvatar(at(girl, 1), ctx());
  assert.equal(a.outfitColor, 'pink');
  assert.equal(a.hair, girl.hair);
  assert.equal(a.body, 'girl');
});

test('effectiveAvatar: job:true eras → job outfit / part-time / chosen outfit without a job', () => {
  assert.equal(effectiveAvatar(at(boy, 4, { job: { id: 'doctor', rank: 1 } }), ctx()).outfit, 'doctor');
  assert.equal(effectiveAvatar(at(girl, 5, { job: { id: 'idol', rank: 2 } }), ctx()).outfit, 'idol');
  assert.equal(effectiveAvatar(at(boy, 4, { job: { id: 'parttime', rank: 1 } }), ctx()).outfit, 'apron');
  assert.equal(effectiveAvatar(at(boy, 4, { job: null }), ctx()).outfit, 'hoodie');
  assert.equal(effectiveAvatar(at(boy, 4), ctx()).outfit, 'hoodie');
  // unknown job / no jobs meta → chosen outfit
  assert.equal(effectiveAvatar(at(boy, 4, { job: { id: 'mystery' } }), ctx()).outfit, 'hoodie');
  assert.equal(effectiveAvatar(at(boy, 4, { job: { id: 'doctor' } }), { room: room(), avatars, jobs: null }).outfit, 'hoodie');
  // `job` override (a jobChanged cut-in shows the post-event job)
  assert.equal(effectiveAvatar(at(boy, 4, { job: null }), { ...ctx(), job: { id: 'idol' } }).outfit, 'idol');
});

test('effectiveAvatar: growthOutfits off, lobby → the chosen look (same object)', () => {
  const c = at(girl, 0);
  assert.equal(effectiveAvatar(c, ctx(room({ config: { growthOutfits: false } }))), girl);
  assert.equal(effectiveAvatar(c, ctx(room({ status: 'lobby' }))), girl);
  assert.equal(effectiveAvatar(c, { avatars, jobs }), girl);
  assert.equal(effectiveAvatar(c, ctx(room({ status: 'finished' }))).outfit, 'dino');
  // already wearing the era costume → unchanged object
  const dino = { ...girl, outfit: 'dino' };
  assert.equal(effectiveAvatar(at(dino, 0), ctx()), dino);
});

test('effectiveAvatar: fixed-colour job outfit keeps its colour contract, tintable keeps outfitColor', () => {
  const doc = effectiveAvatar(at(boy, 4, { job: { id: 'doctor' } }), ctx());
  assert.equal(doc.outfit, 'doctor');
  assert.equal(doc.outfitColor, 'green'); // renderers ignore it for tintable:false outfits
  const def = avatars.parts.outfit.find((o) => o.id === 'doctor');
  assert.equal(def.tintable, false);
  const idol = effectiveAvatar(at(girl, 4, { job: { id: 'idol' } }), ctx());
  assert.equal(idol.outfitColor, 'pink');
  assert.notEqual(avatars.parts.outfit.find((o) => o.id === 'idol').tintable, false);
});

test('effectiveAvatar: server eraOutfits table wins over the default', () => {
  const defs = { ...avatars, eraOutfits: { baby: { any: 'pajamas' } } };
  assert.equal(effectiveAvatar(at(boy, 0), { room: room(), avatars: defs, jobs }).outfit, 'pajamas');
  assert.equal(effectiveAvatar(at(boy, 1), { room: room(), avatars: defs, jobs }).outfit, 'hoodie');
  // unknown costume ids are ignored
  const bad = { ...avatars, eraOutfits: { baby: { any: 'spacesuit' } } };
  assert.equal(effectiveAvatar(at(boy, 0), { room: room(), avatars: bad, jobs }).outfit, 'hoodie');
});

test('displayCharacters: effective avatar + chosenAvatar; overrides; untouched characters kept', () => {
  const r = room({ characters: [at(boy, 0), { ...at({ ...girl, outfit: 'dino' }, 0), id: 'c2' }, { ...at(boy, 4, { job: null }), id: 'c3' }] });
  const list = displayCharacters(r, { avatars, jobs });
  assert.equal(list[0].avatar.outfit, 'dino');
  assert.equal(list[0].chosenAvatar, r.characters[0].avatar);
  assert.equal(list[1], r.characters[1]);
  assert.equal(list[2], r.characters[2]);
  const o = displayCharacters(r, { avatars, jobs, overrides: { c3: { job: { id: 'doctor' } } } });
  assert.equal(o[2].avatar.outfit, 'doctor');
  assert.equal(characterEra(r.characters[2], r), 'young');
});

test('stat helpers: cap, bar %, rows, chips', () => {
  assert.equal(statCap({}), 10);
  assert.equal(statCap({ balance: { stats: { cap: 12 } } }), 12);
  assert.equal(statPct(5, 10), 50);
  assert.equal(statPct(15, 10), 100);
  assert.equal(statPct(-1, 10), 0);
  assert.equal(statPct(undefined, 10), 0);
  assert.deepEqual(statRows({}), []);
  const rows = statRows({ stats: { int: 3, str: 10, charm: 0, luck: 7 } });
  assert.deepEqual(rows.map((r) => [r.key, r.label, r.icon, r.value, r.pct]), [
    ['int', '지력', '🧠', 3, 30],
    ['str', '체력', '💪', 10, 100],
    ['charm', '매력', '✨', 0, 0],
    ['luck', '운', '🍀', 7, 70],
  ]);
  assert.equal(statChip({ stat: 'int', delta: 1 }).text, '🧠 지력 +1');
  assert.match(statChip({ stat: 'int', delta: 1 }).kind, /stat-int plus/);
  assert.equal(statChip({ stat: 'luck', delta: -2 }).text, '🍀 운 -2');
  assert.equal(salaryChip({ amount: 320 }, (n) => `${n}만원`).text, '💵 월급 +320만원');
});

test('job badge: icon, name, ★ rank / max, injury, part-time, hidden', () => {
  assert.equal(rankStars(2, 4), '★★☆☆');
  assert.equal(rankStars(9, 3), '★★★');
  assert.equal(rankStars(0, 2), '☆☆');
  assert.equal(jobBadge({}, jobs), null);
  assert.equal(jobBadge({ job: null }, jobs), null);
  const b = jobBadge({ job: { id: 'doctor', rank: 2, exp: 1, injured: 0 } }, jobs);
  assert.equal(b.text, '🩺 의사 ★★☆');
  assert.equal(b.rankName, '전문의');
  assert.equal(b.injured, 0);
  assert.equal(jobBadge({ job: { id: 'idol', rank: 1, injured: 2 } }, jobs).injured, 2);
  const pt = jobBadge({ job: { id: 'parttime', rank: 1 } }, jobs);
  assert.equal(pt.partTime, true);
  assert.equal(pt.stars, '');
  assert.equal(pt.name, '알바');
  assert.equal(jobBadge({ job: { id: 'parttime', rank: 1 } }, null).name, '알바'); // before meta.jobs
  assert.equal(jobBadge({ job: { id: 'astronaut', rank: 1 } }, jobs).hidden, true);
  assert.equal(jobBadge({ job: { id: 'unknown', rank: 1 } }, jobs).name, 'unknown');
  assert.equal(jobInfo('doctor', jobs).maxRank, 3);
});

test('education / military labels', () => {
  assert.equal(educationLabel('college'), '대졸');
  assert.equal(educationLabel('elite'), '명문대졸');
  assert.equal(educationLabel('none'), '');
  assert.equal(educationLabel(undefined), '');
  assert.equal(militaryLabel({ status: 'serving', turnsLeft: 2 }), '복무 중 (2턴)');
  assert.equal(militaryLabel({ status: 'done' }), '군필');
  assert.equal(militaryLabel({ status: 'exempt' }), '면제');
  assert.equal(militaryLabel({ status: 'none' }), '');
  assert.equal(militaryLabel(null), '');
});

test('jobOffer options: icon, starting salary (rank 1), requirement badges', () => {
  assert.deepEqual(requirementBadges({ int: 7, education: 'college' }), ['🧠 7+', '🎓 대졸']);
  assert.deepEqual(requirementBadges({ stats: { charm: 6, luck: 0 } }), ['✨ 6+']);
  const x = optionExtras({ kind: 'jobOffer' }, { id: 'doctor', label: '의사' }, { jobs });
  assert.deepEqual({ ...x, reqs: undefined }, { icon: '🩺', salary: 300, badges: ['🧠 7+', '🎓 대졸'], jobId: 'doctor', reqs: undefined });
  assert.deepEqual(x.reqs.map((r) => [r.kind, r.ok]), [['stat', null], ['edu', null]]);
  assert.equal(optionExtras({ kind: 'career' }, { id: 'college', icon: '🎓' }, { jobs }).salary, null);
  assert.equal(optionExtras({ kind: 'habit' }, { id: 'doctor', jobId: 'idol' }, { jobs }).salary, 100);
  assert.equal(optionExtras({ kind: 'jobOffer' }, { id: 'doctor', icon: '👩‍⚕️' }, { jobs }).icon, '👩‍⚕️');
  // the server desc already names the pay → no second salary badge; the label's leading icon is not repeated
  assert.equal(optionExtras({ kind: 'jobOffer' }, { id: 'doctor', desc: '생명을 살려요 · 첫 월급 300만원' }, { jobs }).salary, null);
  assert.equal(optionLabel({ label: '📹 유튜버', icon: '📹' }), '유튜버');
  assert.equal(optionLabel({ label: '의사', icon: '🩺' }), '의사');
  assert.equal(optionLabel({ id: 'x' }), 'x');
});

test('planCutins: statChanged / salary become follow-up chips; Stage 6 anchors always open a group', () => {
  const events = [
    { type: 'landed', charId: 'c1', tileType: 'job', cutin: true },
    { type: 'moneyChanged', charId: 'c1', delta: 320, reason: 'salary' },
    { type: 'salary', charId: 'c1', jobId: 'doctor', rank: 1, amount: 320 },
    { type: 'statChanged', charId: 'c1', stat: 'int', delta: 1, value: 4, reason: 'job' },
    { type: 'rankUp', charId: 'c1', jobId: 'doctor', rank: 2, rankName: '전문의' },
    { type: 'statChanged', charId: 'c1', stat: 'charm', delta: 2, value: 5 },
    { type: 'log', text: '승진!' },
  ];
  const gs = planCutins(events);
  assert.equal(gs.length, 2);
  assert.equal(gs[0].anchor.type, 'landed');
  assert.deepEqual(gs[0].stats, [{ charId: 'c1', stat: 'int', delta: 1, value: 4, reason: 'job' }]);
  assert.deepEqual(gs[0].salary, [{ charId: 'c1', jobId: 'doctor', rank: 1, amount: 320 }]);
  assert.equal(gs[1].anchor.type, 'rankUp'); // no `cutin` flag from the server → still an anchor
  assert.equal(gs[1].stats[0].stat, 'charm');
  assert.deepEqual(gs[1].texts, ['승진!']);
  assert.equal(tagLabel(gs[1].anchor), '🎉 승진');
  assert.equal(tagLabel({ type: 'jobChanged' }), '💼 취업');
  assert.equal(tagLabel({ type: 'jobChanged', fromJobId: 'teacher' }), '💼 전직');
  assert.equal(tagLabel({ type: 'jobChanged', fromJobId: 'parttime' }), '💼 취업');
  assert.equal(tagLabel({ type: 'jobChanged', reason: 'parttime' }), '🧾 알바 시작');
  assert.equal(tagLabel({ type: 'jobChanged', reason: 'change' }), '💼 전직');
  assert.equal(tagLabel({ type: 'jobChanged', reason: 'hire' }), '💼 취업');
  // 전역: a chip of the anchor in front of it, else its own (banner) group
  const withEnd = planCutins([{ type: 'landed', charId: 'c1', tileType: 'event', cutin: true }, { type: 'militaryEnd', charId: 'c1' }, { type: 'statChanged', charId: 'c1', stat: 'str', delta: 2 }]);
  assert.equal(withEnd.length, 1);
  assert.deepEqual(withEnd[0].discharged, ['c1']);
  assert.equal(withEnd[0].stats[0].stat, 'str');
  const orphan = planCutins([{ type: 'moved', charId: 'c1' }, { type: 'militaryEnd', charId: 'c1' }, { type: 'statChanged', charId: 'c1', stat: 'str', delta: 2 }]);
  assert.equal(orphan.length, 1);
  assert.equal(orphan[0].anchor.type, 'militaryEnd');
  assert.equal(orphan[0].stats.length, 1);
  // zero deltas are not chips
  assert.deepEqual(planCutins([{ type: 'injured', charId: 'c1', cutin: true }, { type: 'statChanged', charId: 'c1', stat: 'str', delta: 0 }])[0].stats, []);
});

test('planCutins: the news flash rides on the era studio cut-in, else it is its own cut-in', () => {
  const studio = [{ speaker: 'bomi', line: '속보입니다' }];
  const withStudio = planCutins([
    { type: 'eraChanged', charId: 'c1', era: 'young', cutin: true, mcStudio: true, mc: studio },
    { type: 'newsFlash', eraId: 'young', newsId: 'coin', title: '코인 열풍', text: '이벤트 금액 ×1.5', tone: 'treasure', cutin: true },
  ]);
  assert.equal(withStudio.length, 1);
  assert.deepEqual(withStudio[0].news, { eraId: 'young', newsId: 'coin', title: '코인 열풍', text: '이벤트 금액 ×1.5', tone: 'treasure' });
  // the flash's own studio lines (봄이 reads the headline) join the era studio
  const withLines = planCutins([
    { type: 'eraChanged', charId: 'c1', era: 'young', cutin: true, mcStudio: true, mc: studio },
    { type: 'newsFlash', eraId: 'young', newsId: 'coin', title: '코인 열풍', cutin: true, mcStudio: true, mc: [{ speaker: 'bomi', line: '뉴스' }] },
  ]);
  assert.equal(withLines.length, 1);
  assert.equal(withLines[0].studio.length, 2);
  assert.equal(withLines[0].mcEvents.length, 2);
  // game start studio isn't an anchor → the flash keeps its own studio cut-in with the headline
  const adult = planCutins([
    { type: 'gameStarted', mcStudio: true, mc: studio },
    { type: 'newsFlash', eraId: 'young', newsId: 'coin', title: '코인 열풍', cutin: true, mcStudio: true, mc: [{ speaker: 'bomi', line: '뉴스' }] },
  ]);
  assert.equal(adult.length, 1);
  assert.equal(adult[0].news.title, '코인 열풍');
  assert.equal(adult[0].studio.length, 1);
  const alone = planCutins([{ type: 'newsFlash', eraId: 'young', newsId: 'coin', title: '코인 열풍', cutin: true }]);
  assert.equal(alone.length, 1);
  assert.equal(alone[0].anchor.type, 'newsFlash');
  assert.equal(alone[0].charId, null);
});

test('classifyGroup: hire / rank-up / hidden job / news are big; habit & salary tiles minor; 전역 = banner', () => {
  const g = (anchor, extra = {}) => ({ anchor, charId: anchor.charId ?? null, texts: [], money: [], delta: 0, involved: [anchor.charId].filter(Boolean), mc: null, studio: null, mcEvents: [], ...extra });
  const mine = new Set(['c1']);
  for (const type of ['jobChanged', 'rankUp', 'hiddenJobUnlocked']) {
    assert.equal(isBigGroup(g({ type, charId: 'c2' })), true, type);
    assert.equal(classifyGroup(g({ type, charId: 'c2' }), { mine, mode: 'compact' }), 'full', type);
  }
  assert.equal(classifyGroup(g({ type: 'newsFlash' }), { mine, mode: 'compact' }), 'full');
  assert.equal(classifyGroup(g({ type: 'newsFlash' }), { mine, mode: 'off' }), 'skip');
  assert.equal(classifyGroup(g({ type: 'landed', tileType: 'habit', charId: 'c2', lineTag: 'job_habit' }), { mine, mode: 'compact' }), 'banner');
  assert.equal(classifyGroup(g({ type: 'landed', tileType: 'salary', charId: 'c2', mcKey: 'job' }), { mine, mode: 'compact' }), 'banner');
  assert.equal(classifyGroup(g({ type: 'injured', charId: 'c2' }), { mine, mode: 'compact' }), 'banner');
  assert.equal(classifyGroup(g({ type: 'injured', charId: 'c1' }), { mine, mode: 'compact' }), 'full');
  assert.equal(classifyGroup(g({ type: 'militaryEnd', charId: 'c1' }), { mine, mode: 'compact' }), 'banner');
  assert.equal(classifyGroup(g({ type: 'militaryEnd', charId: 'c2' }), { mine, mode: 'off' }), 'skip');
  // merged: the job change wins over a landing of the same character
  const merged = mergeGroups([g({ type: 'landed', tileType: 'job', charId: 'c2' }), g({ type: 'jobChanged', charId: 'c2' }, { stats: [{ stat: 'int', delta: 1 }] })], { mine });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].anchor.type, 'jobChanged');
  assert.equal(merged[0].stats.length, 1);
});
