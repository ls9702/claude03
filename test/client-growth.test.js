// Stage 6-B client pure modules: growth props (effectiveAvatar — era / job props over the chosen props since the
// Chiikawa conversion), stat / job formatting helpers, Stage 6 cut-in planning (stat / salary chips, news attached to the
// studio) and the cut-in policy for job / news events.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
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

const ERAS = ['baby', 'elem', 'middle', 'high', 'young', 'middle_age', 'senior'];
const board = { eras: ERAS.map((id) => ({ id, name: id, tiles: [] })) };
// Chiikawa conversion (CH-1): jobs carry growth PROPS (jobs.json `props`), eras props.json `eraProps`
const jobs = {
  jobs: [
    { id: 'doctor', name: '의사', icon: '🩺', hidden: false, props: { head: 'head_mirror', neck: 'stethoscope' }, requires: { int: 7, education: 'college' }, ranks: [{ name: '인턴', salary: 300 }, { name: '전문의', salary: 500 }, { name: '과장', salary: 700 }] },
    { id: 'idol', name: '아이돌', icon: '🎤', hidden: false, props: { hand: 'mic' }, requires: { stats: { charm: 6 } }, ranks: [{ name: '연습생', salary: 100 }, { name: '데뷔', salary: 300 }] },
    { id: 'astronaut', name: '우주비행사', icon: '🚀', hidden: true, props: { head: 'space_helmet' }, ranks: [{ name: '후보', salary: 600 }] },
  ],
  partTime: { id: 'parttime', name: '알바', icon: '🧾', ranks: [{ name: '알바', salary: 80 }], props: { neck: 'apron' } },
};
const props = JSON.parse(readFileSync(new URL('../server/data/props.json', import.meta.url), 'utf8'));
const room = (extra = {}) => ({ status: 'playing', config: {}, board, ...extra });
const usagi = { character: 'usagi', props: { head: 'ribbon', hand: 'balloon' } };
const hachi = { character: 'hachiware', props: { face: 'sunglasses' } };
const at = (avatar, eraIndex, extra = {}) => ({ id: 'c1', avatar, position: { eraIndex, route: 'main', index: 0 }, ...extra });
const ctx = (r = room()) => ({ room: r, props, jobs });

test('growth props contract: every era / job prop exists in props.json in its own slot', () => {
  const byId = new Map(props.props.map((p) => [p.id, p]));
  for (const [era, entry] of Object.entries(props.eraProps)) {
    for (const [slot, id] of Object.entries(entry)) if (slot !== 'job') assert.equal(byId.get(id)?.slot, slot, `${era}.${slot}=${id}`);
  }
  for (const [job, entry] of Object.entries(props.jobProps ?? {})) for (const [slot, id] of Object.entries(entry)) assert.equal(byId.get(id)?.slot, slot, `${job}.${slot}=${id}`);
  for (const j of [...jobs.jobs, jobs.partTime]) for (const [slot, id] of Object.entries(j.props)) assert.equal(byId.get(id)?.slot, slot, id);
});

test('effectiveAvatar: era props override the chosen prop of the SAME slot only', () => {
  // baby: bonnet (head) + pacifier (face) — usagi keeps her balloon (hand)
  assert.deepEqual(effectiveAvatar(at(usagi, 0), ctx()).props, { head: 'bonnet', hand: 'balloon', face: 'pacifier' });
  assert.deepEqual(effectiveAvatar(at(usagi, 1), ctx()).props, { head: 'yellow_hat', hand: 'balloon', back: 'school_backpack' });
  assert.deepEqual(effectiveAvatar(at(hachi, 2), ctx()).props, { face: 'sunglasses', head: 'school_cap', neck: 'necktie' });
  assert.deepEqual(effectiveAvatar(at(hachi, 6), ctx()).props, { face: 'sunglasses', head: 'knit_cap', hand: 'cane' });
  // the body never changes
  assert.equal(effectiveAvatar(at(usagi, 6), ctx()).character, 'usagi');
  // `character.era` wins over the position
  assert.equal(effectiveAvatar({ ...at(usagi, 0), era: 'senior' }, ctx()).props.head, 'knit_cap');
});

test('effectiveAvatar: job eras → the job props (part-time apron); no job → the chosen props', () => {
  assert.deepEqual(effectiveAvatar(at(usagi, 4, { job: { id: 'doctor', rank: 1 } }), ctx()).props, { head: 'head_mirror', hand: 'balloon', neck: 'stethoscope' });
  assert.deepEqual(effectiveAvatar(at(hachi, 5, { job: { id: 'idol', rank: 2 } }), ctx()).props, { face: 'sunglasses', hand: 'mic' });
  assert.equal(effectiveAvatar(at(hachi, 4, { job: { id: 'parttime', rank: 1 } }), ctx()).props.neck, 'apron');
  assert.equal(effectiveAvatar(at(usagi, 4, { job: null }), ctx()), usagi);
  assert.equal(effectiveAvatar(at(usagi, 4), ctx()), usagi);
  // unknown job → chosen props; props.json jobProps / the contract default when jobs.json has no `props`
  assert.equal(effectiveAvatar(at(usagi, 4, { job: { id: 'mystery' } }), ctx()), usagi);
  assert.equal(effectiveAvatar(at(usagi, 4, { job: { id: 'chef' } }), { room: room(), props, jobs: null }).props.head, 'chef_hat');
  assert.equal(effectiveAvatar(at(usagi, 4, { job: { id: 'chef' } }), { room: room() }).props.head, 'chef_hat');
  // `job` override (a jobChanged cut-in shows the post-event job)
  assert.equal(effectiveAvatar(at(usagi, 4, { job: null }), { ...ctx(), job: { id: 'idol' } }).props.hand, 'mic');
});

test('effectiveAvatar: growthOutfits off, lobby → the chosen look (same object); old human avatars → a roster look', () => {
  const c = at(usagi, 0);
  assert.equal(effectiveAvatar(c, ctx(room({ config: { growthOutfits: false } }))), usagi);
  assert.equal(effectiveAvatar(c, ctx(room({ status: 'lobby' }))), usagi);
  assert.equal(effectiveAvatar(c, { props, jobs }), usagi);
  assert.equal(effectiveAvatar(c, ctx(room({ status: 'finished' }))).props.head, 'bonnet');
  // already wearing the era props → unchanged object
  const baby = { character: 'chiikawa', props: { head: 'bonnet', face: 'pacifier' } };
  assert.equal(effectiveAvatar(at(baby, 0), ctx()), baby);
  // a pre-conversion human avatar is drawn as a roster character (deterministic)
  const human = { body: 'girl', hair: 'bob', outfit: 'dress', accessory: 'glasses' };
  const look = effectiveAvatar(at(human, 3), ctx(room({ status: 'lobby' })));
  assert.ok(look.character, JSON.stringify(look));
  assert.equal(look.props.face, 'round_glasses');
  assert.deepEqual(effectiveAvatar(at(human, 3), ctx(room({ status: 'lobby' }))), look);
});

test('effectiveAvatar: the server eraProps table wins; unknown prop ids are ignored', () => {
  const p2 = { ...props, eraProps: { baby: { head: 'crown' } } };
  assert.deepEqual(effectiveAvatar(at(usagi, 0), { room: room(), props: p2, jobs }).props, { head: 'crown', hand: 'balloon' });
  assert.equal(effectiveAvatar(at(usagi, 1), { room: room(), props: p2, jobs }), usagi);
  const bad = { ...props, eraProps: { baby: { head: 'spacesuit' } } };
  assert.equal(effectiveAvatar(at(usagi, 0), { room: room(), props: bad, jobs }), usagi);
});

test('displayCharacters: effective look + chosenAvatar; overrides; untouched characters kept', () => {
  const baby = { character: 'chiikawa', props: { head: 'bonnet', face: 'pacifier' } };
  const r = room({ characters: [at(usagi, 0), { ...at(baby, 0), id: 'c2' }, { ...at(hachi, 4, { job: null }), id: 'c3' }] });
  const list = displayCharacters(r, { props, jobs });
  assert.equal(list[0].avatar.props.head, 'bonnet');
  assert.equal(list[0].chosenAvatar, r.characters[0].avatar);
  assert.equal(list[1], r.characters[1]);
  assert.equal(list[2], r.characters[2]);
  const o = displayCharacters(r, { props, jobs, overrides: { c3: { job: { id: 'doctor' } } } });
  assert.equal(o[2].avatar.props.head, 'head_mirror');
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
  assert.equal(militaryLabel({ status: 'exempt' }), '미입대'); // optional service for everyone (CH-1)
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
