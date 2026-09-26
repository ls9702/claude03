// Client pure modules added by the post-5.6 verification fixes: cut-in policy (pre-emption, compact
// spectator mode, backlog, merging), bet picks from the server config, route descriptions, prompt tags.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CUTIN_MODES,
  DEFAULT_CUTIN_MODE,
  SPECTATOR_BACKLOG,
  betPicks,
  classifyGroup,
  isBigGroup,
  mergeGroups,
  myPendingChars,
  normalizeCutinMode,
  routeOptionInfo,
} from '../public/js/ui/cutinPolicy.js';
import { planCutins, tagLabel } from '../public/js/ui/cutinMap.js';

const g = (anchor, extra = {}) => ({ anchor, charId: anchor.charId ?? null, texts: [], money: [], delta: 0, involved: [anchor.charId].filter(Boolean), mc: null, studio: null, mcEvents: [], ...extra });
const mine = new Set(['c1']);

test('normalizeCutinMode: 전체/간단히/끄기, default 간단히', () => {
  assert.deepEqual(CUTIN_MODES, ['full', 'compact', 'off']);
  assert.equal(DEFAULT_CUTIN_MODE, 'compact');
  assert.equal(normalizeCutinMode('full'), 'full');
  assert.equal(normalizeCutinMode('off'), 'off');
  assert.equal(normalizeCutinMode(null), 'compact');
  assert.equal(normalizeCutinMode('weird'), 'compact');
});

test('isBigGroup: studio, finished, era change, marriage/job tiles', () => {
  assert.equal(isBigGroup(g({ type: 'finished', charId: 'c2' })), true);
  assert.equal(isBigGroup(g({ type: 'eraChanged', charId: 'c2' })), true);
  assert.equal(isBigGroup(g({ type: 'landed', tileType: 'heart', charId: 'c2' })), true);
  assert.equal(isBigGroup(g({ type: 'landed', tileType: 'job', charId: 'c2' })), true);
  assert.equal(isBigGroup(g({ type: 'landed', tileType: 'money', charId: 'c2' })), false);
  assert.equal(isBigGroup(g({ type: 'landed', tileType: 'event', charId: 'c2', mcKey: 'marriage' })), true);
  assert.equal(isBigGroup(g({ type: 'routeChosen', charId: 'c2' })), false);
  assert.equal(isBigGroup(g({ type: 'promptResolved', charId: 'c2' })), false);
  assert.equal(isBigGroup(g({ type: 'eraChanged', charId: 'c2' }, { studio: [{ speaker: 'hoya', line: 'x' }] })), true);
});

test('classifyGroup: my events full, others compact → banner unless big, off → skip', () => {
  const minor = g({ type: 'landed', tileType: 'money', charId: 'c2' });
  const big = g({ type: 'finished', charId: 'c2' });
  const own = g({ type: 'landed', tileType: 'money', charId: 'c1' });
  assert.equal(classifyGroup(own, { mine, mode: 'compact' }), 'full');
  assert.equal(classifyGroup(own, { mine, mode: 'off' }), 'full');
  assert.equal(classifyGroup(minor, { mine, mode: 'compact' }), 'banner');
  assert.equal(classifyGroup(big, { mine, mode: 'compact' }), 'full');
  assert.equal(classifyGroup(minor, { mine, mode: 'full' }), 'full');
  assert.equal(classifyGroup(minor, { mine, mode: 'off' }), 'skip');
  assert.equal(classifyGroup(big, { mine, mode: 'off' }), 'skip');
  // default mode = compact; mine as an array works too
  assert.equal(classifyGroup(minor, { mine: ['c1'] }), 'banner');
});

test('classifyGroup: a pending prompt of mine pre-empts every event cut-in (banner, never blocking)', () => {
  const big = g({ type: 'eraChanged', charId: 'c2' });
  const own = g({ type: 'landed', tileType: 'money', charId: 'c1' });
  assert.equal(classifyGroup(big, { mine, mode: 'full', promptForMe: true }), 'banner');
  assert.equal(classifyGroup(own, { mine, mode: 'compact', promptForMe: true }), 'banner');
  assert.equal(classifyGroup(big, { mine, mode: 'off', promptForMe: true }), 'skip');
});

test('classifyGroup: spectator backlog cap, game over, global off', () => {
  const minor = g({ type: 'landed', tileType: 'money', charId: 'c2' });
  const big = g({ type: 'finished', charId: 'c2' });
  assert.ok(SPECTATOR_BACKLOG >= 1 && SPECTATOR_BACKLOG <= 2);
  assert.equal(classifyGroup(minor, { mine, mode: 'full', queued: SPECTATOR_BACKLOG - 1 }), 'full');
  assert.equal(classifyGroup(minor, { mine, mode: 'full', queued: SPECTATOR_BACKLOG }), 'banner');
  assert.equal(classifyGroup(big, { mine, mode: 'compact', queued: 5 }), 'banner');
  // my own events are never demoted by the backlog
  assert.equal(classifyGroup(g({ type: 'finished', charId: 'c1' }), { mine, mode: 'full', queued: 9 }), 'full');
  assert.equal(classifyGroup(big, { mine, mode: 'full', gameOver: true }), 'skip');
  assert.equal(classifyGroup(g({ type: 'gameOver' }), { mine, mode: 'full' }), 'skip');
  assert.equal(classifyGroup(g({ type: 'finished', charId: 'c1' }), { mine, globalOff: true }), 'skip');
  assert.equal(classifyGroup(null, { mine }), 'skip');
});

test('mergeGroups: one turn of another character → one cut-in (biggest anchor, texts + chips combined)', () => {
  const events = [
    { type: 'landed', charId: 'c2', tileType: 'money', cutin: true, tone: 'good' },
    { type: 'moneyChanged', charId: 'c2', delta: 30, reason: 'tile' },
    { type: 'log', text: '용돈 30만원!' },
    { type: 'eraChanged', charId: 'c2', eraName: '초등학생', cutin: true, tone: 'good' },
    { type: 'log', text: '초등학생 시대 시작!' },
    { type: 'landed', charId: 'c1', tileType: 'loss', cutin: true, tone: 'bad' },
    { type: 'moneyChanged', charId: 'c1', delta: -10, reason: 'tile' },
  ];
  const groups = planCutins(events);
  assert.equal(groups.length, 3);
  const merged = mergeGroups(groups, { mine });
  assert.equal(merged.length, 2);
  const [other, own] = merged;
  assert.equal(other.anchor.type, 'eraChanged'); // bigger than a money landing
  assert.deepEqual(other.anchors.map((a) => a.type), ['landed', 'eraChanged']);
  assert.deepEqual(other.texts, ['용돈 30만원!', '초등학생 시대 시작!']);
  assert.equal(other.money.length, 1);
  assert.equal(other.delta, 30);
  assert.equal(own.charId, 'c1');
  assert.deepEqual(own.anchors.map((a) => a.type), ['landed']);
  // my own consecutive groups stay separate
  const two = mergeGroups(planCutins([{ type: 'landed', charId: 'c1', cutin: true }, { type: 'eraChanged', charId: 'c1', cutin: true }]), { mine });
  assert.equal(two.length, 2);
  // a studio opening is never merged into the previous cut-in
  const st = mergeGroups([g({ type: 'landed', charId: 'c2' }), g({ type: 'eraChanged', charId: 'c2' }, { studio: [{ speaker: 'bomi', line: 'x' }] })], { mine });
  assert.equal(st.length, 2);
  assert.deepEqual(mergeGroups([], { mine }), []);
});

test('myPendingChars: my unanswered characters of the pending prompt', () => {
  const chars = [
    { id: 'c1', isMe: true },
    { id: 'c2', isMe: false },
    { id: 'c3', isMe: true },
  ];
  const pending = { promptId: 'pr1', forCharacterIds: ['c1', 'c2', 'c3'], answered: ['c3'] };
  assert.deepEqual(myPendingChars(pending, chars).map((c) => c.id), ['c1']);
  assert.deepEqual(myPendingChars({ ...pending, answered: ['c1', 'c3'] }, chars), []);
  assert.deepEqual(myPendingChars(null, chars), []);
  // spectator: no characters of mine
  assert.deepEqual(myPendingChars(pending, chars.map((c) => ({ ...c, isMe: false }))), []);
});

test('routeOptionInfo: one-line route descriptions (server desc wins)', () => {
  const p = { kind: 'routeChoice' };
  assert.match(routeOptionInfo(p, { id: 'love' }), /만남·결혼·육아/);
  assert.match(routeOptionInfo(p, { id: 'career' }), /급여·승진·직업/);
  assert.match(routeOptionInfo(p, { id: 'money' }), /리스크/);
  assert.equal(routeOptionInfo(p, { id: 'love', desc: '서버 설명' }), '서버 설명');
  assert.equal(routeOptionInfo({ kind: 'exam' }, { id: 'study' }), '');
});

test('betPicks: ranges and payouts come from the server config (no hardcoded 4-7)', () => {
  const next = betPicks({ payouts: { odd: 2, even: 2, '1-3': 3, '4-6': 3, '7-10': 2.5 }, ranges: { '7-10': [7, 10], '1-3': [1, 3], '4-6': [4, 6] } });
  assert.deepEqual(next.map((p) => p.label), ['홀', '짝', '1~3', '4~6', '7~10']);
  assert.deepEqual(next.map((p) => p.payout), [2, 2, 3, 3, 2.5]);
  assert.deepEqual(next.map((p) => p.kind), ['oddEven', 'oddEven', 'range', 'range', 'range']);
  const old = betPicks({ payout: { oddEven: 2, range: 3 }, ranges: { '1-3': [1, 3], '4-7': [4, 7], '8-10': [8, 10] } });
  assert.deepEqual(old.map((p) => `${p.label}×${p.payout}`), ['홀×2', '짝×2', '1~3×3', '4~7×3', '8~10×3']);
});

test('tagLabel: prompt tags are the title only (no "일·커리어 · 📝 수능 날" duplication)', () => {
  const tones = { career: { icon: '💼', label: '일·커리어' }, neutral: { icon: '📖', label: '인생 이야기' } };
  assert.equal(tagLabel({ type: 'prompt', tone: 'career', title: '📝 수능 날' }, { tones }), '📝 수능 날');
  assert.equal(tagLabel({ type: 'prompt', tone: 'career', title: '인생 갈림길', kind: 'routeChoice' }, { tones }), '🔀 인생 갈림길');
  assert.equal(tagLabel({ type: 'prompt', tone: 'career', title: '선택' }, { tones }), '💼 선택');
});

test('tagLabel: route tags do not repeat the route name (연애·육아 · 연애·육아 루트)', () => {
  const tones = { love: { icon: '💕', label: '연애·육아' }, treasure: { icon: '💰', label: '보물·금전' }, good: { icon: '✨', label: '좋은 일' } };
  const routes = { love: { name: '연애·육아' }, money: { name: '보물·부동산·금전' } };
  assert.equal(tagLabel({ type: 'routeChosen', tone: 'love', route: 'love' }, { tones, routes }), '💕 연애·육아 루트');
  assert.equal(tagLabel({ type: 'routeChosen', tone: 'treasure', route: 'money' }, { tones, routes }), '💰 보물·금전 · 보물·부동산·금전 루트');
  assert.equal(tagLabel({ type: 'landed', tone: 'good', tileType: 'money' }, { tones, tileTypes: { money: { name: '돈' } } }), '✨ 좋은 일 · 돈 칸');
});
