// Post-simulation fixes (client): pure helpers behind the bug fixes and the waiting-time changes.
//   cutinPolicy: ⏩ fast-forward / my-turn banners, repeated shows (2nd+ era entrant, 2nd+ wedding), era banner text
//   format: josa mirror of the server, bidi stripping of payloads, the server's name cleaning (A10, A16)
//   cards: trade / gift amounts are digits only (no 「1e3」)
//   animator: rush() plays the backlog instantly (A3 / A8)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OTHERS_AUTO_MS,
  classifyGroup,
  eraBannerText,
  markRepeats,
  seenFromRoom,
} from '../public/js/ui/cutinPolicy.js';
import { BIDI_CONTROLS, cleanName, josa, nameHtml, nameLength, stripBidi, stripBidiJson } from '../public/js/format.js';
import { validateGift, validateTrade } from '../public/js/shared/cards.js';
import { createAnimator } from '../public/js/scene/animator.js';

const grp = (anchor, extra = {}) => ({ anchor, charId: anchor.charId ?? null, texts: [], money: [], delta: 0, involved: [anchor.charId].filter(Boolean), mc: null, studio: null, mcEvents: [], ...extra });

test('classifyGroup: ⏩ fast-forward and my waiting roulette turn other players\' cut-ins into banners', () => {
  const big = grp({ type: 'married', charId: 'c2' });
  const mine = new Set(['c1']);
  assert.equal(classifyGroup(big, { mine, mode: 'compact' }), 'full');
  assert.equal(classifyGroup(big, { mine, mode: 'compact', fastForward: true }), 'banner');
  assert.equal(classifyGroup(big, { mine, mode: 'full', myTurn: true }), 'banner');
  // my own events are untouched
  const own = grp({ type: 'married', charId: 'c1' });
  assert.equal(classifyGroup(own, { mine, fastForward: true, myTurn: true }), 'full');
  // 「끄기」 stays off
  assert.equal(classifyGroup(big, { mine, mode: 'off', fastForward: true }), 'skip');
  assert.equal(OTHERS_AUTO_MS, 3000);
});

test('markRepeats: only the first entrant of an era / the first wedding of others stays a full cut-in', () => {
  const seen = { eras: new Set(['baby']), weddings: 0 };
  const mine = ['c1'];
  const era = (charId, studio = null) => grp({ type: 'eraChanged', charId, era: 'young', eraName: '청년' }, { studio });
  const groups = [era('c2', [{ speaker: 'hoya', line: '멍!' }]), era('c3'), era('c1'), era('c4')];
  markRepeats(groups, seen, { mine });
  assert.deepEqual(groups.map((g) => !!g.repeat), [false, true, false, true]);
  assert.equal(groups[1].eraId, 'young');
  assert.equal(groups[1].eraName, '청년');
  assert.equal(classifyGroup(groups[1], { mine, mode: 'compact' }), 'banner');
  assert.equal(classifyGroup(groups[1], { mine, mode: 'full' }), 'full'); // 「전체」 keeps everything
  assert.equal(classifyGroup(groups[2], { mine, mode: 'compact' }), 'full'); // mine
  // weddings: the first one of other players is full, the next ones banners; mine never counts
  const w = [grp({ type: 'married', charId: 'c1' }), grp({ type: 'married', charId: 'c2' }), grp({ type: 'married', charId: 'c3' })];
  markRepeats(w, seen, { mine });
  assert.deepEqual(w.map((g) => !!g.repeat), [false, false, true]);
  assert.equal(seen.weddings, 2);
  // a merged group whose biggest anchor is a job change is not an "era repeat"
  const merged = grp({ type: 'jobChanged', charId: 'c5' }, { anchors: [{ type: 'eraChanged', charId: 'c5', era: 'young' }, { type: 'jobChanged', charId: 'c5' }] });
  markRepeats([merged], seen, { mine });
  assert.equal(!!merged.repeat, false);
});

test('seenFromRoom: eras already reached and weddings already held (reload mid-game)', () => {
  const room = {
    board: { eras: [{ id: 'baby' }, { id: 'elem' }, { id: 'middle' }, { id: 'high' }] },
    characters: [
      { id: 'c1', isMe: true, position: { eraIndex: 2 }, spouse: { name: 'x' } },
      { id: 'c2', position: { eraIndex: 1 }, spouse: { name: 'y' } },
      { id: 'c3', position: { eraIndex: 0 } },
    ],
  };
  const s = seenFromRoom(room, { mine: ['c1'] });
  assert.deepEqual([...s.eras], ['baby', 'elem', 'middle']);
  assert.equal(s.weddings, 1);
  assert.deepEqual([...seenFromRoom(null).eras], []);
});

test('eraBannerText merges entrants of one era', () => {
  assert.equal(eraBannerText(['민수', '지영'], '청년'), '민수·지영 청년 시대 진입');
  assert.equal(eraBannerText(['민수', '민수'], '청년'), '민수 청년 시대 진입');
  assert.equal(eraBannerText(['a', 'b', 'c', 'd', 'e'], '중년'), 'a·b·c 외 2명 중년 시대 진입');
  assert.equal(eraBannerText([], ''), '새 시대 진입');
});

test('josa mirrors the server (A16: never 「뚱이이(가)」)', () => {
  assert.equal(josa('뚱이', '이/가'), '뚱이가');
  assert.equal(josa('철민', '이/가'), '철민이');
  assert.equal(josa('지영', '을/를'), '지영을');
  assert.equal(josa('하늘', '으로/로'), '하늘로'); // ㄹ받침 → 로
  assert.equal(josa('학자금 대출', '으로/로'), '학자금 대출로');
  assert.equal(josa('기본 선택', '으로/로'), '기본 선택으로');
  assert.equal(josa('3', '이/가'), '3이');
  assert.equal(josa('Tom', '이/가'), 'Tom이(가)');
  assert.equal(josa('⁨민수⁩', '은/는'), '⁨민수⁩는'); // isolates are ignored
  assert.equal(josa('상대', '과/와'), '상대와');
});

test('bidi controls never reach the UI (A10)', () => {
  const evil = '‮RTL글자';
  assert.equal(stripBidi(evil), 'RTL글자');
  assert.equal(JSON.parse(stripBidiJson(JSON.stringify({ name: evil }))).name, 'RTL글자');
  assert.equal(JSON.parse(stripBidiJson('{"name":"\\u202eab\\u2066c"}')).name, 'abc');
  assert.equal(nameHtml(`<b>${evil}</b>`), '<bdi>&lt;b&gt;RTL글자&lt;/b&gt;</bdi>');
  assert.equal('a‏b؜'.replace(BIDI_CONTROLS, ''), 'ab');
  // the server's name cleaning: invisible characters vanish, ZWJ only inside emoji
  assert.equal(cleanName('  ​민‍수  '), '민수');
  assert.equal(cleanName('👨‍👩‍👧'), '👨‍👩‍👧');
  assert.equal(nameLength('​​'), 0);
  assert.equal(nameLength(evil), 5);
});

test('trade / gift amounts are digits only (no scientific notation)', () => {
  const room = {
    status: 'playing',
    characters: [
      { id: 'c1', isMe: true, ownerId: 'p1', money: 5000, cards: [] },
      { id: 'c2', isMe: true, ownerId: 'p1', money: 100, cards: [] },
      { id: 'c3', ownerId: 'p2', money: 100, cards: [{ uid: 'k1', id: 'boost' }] },
    ],
    trades: [],
  };
  for (const bad of ['1e3', '+5', '0x10', '3.5', '-5', ' 1 0 ']) {
    const r = validateGift({ fromId: 'c1', toId: 'c2', kind: 'money', money: bad }, { room });
    assert.equal(r.ok, false, bad);
  }
  assert.match(validateGift({ fromId: 'c1', toId: 'c2', kind: 'money', money: '1e3' }, { room }).error, /숫자로만/);
  assert.equal(validateGift({ fromId: 'c1', toId: 'c2', kind: 'money', money: '1000' }, { room }).ok, true);
  assert.equal(validateGift({ fromId: 'c1', toId: 'c2', kind: 'money', money: 10 }, { room }).ok, true);
  assert.equal(validateTrade({ fromId: 'c1', toId: 'c3', give: { kind: 'money', money: '2e1' }, want: { kind: 'card', cardUid: 'k1' } }, { room }).ok, false);
  assert.equal(validateTrade({ fromId: 'c1', toId: 'c3', give: { kind: 'money', money: '20' }, want: { kind: 'card', cardUid: 'k1' } }, { room }).ok, true);
});

test('animator.rush(): the backlog plays instantly until the queue drains (A3 / A8)', async () => {
  const seen = [];
  let release;
  const anim = createAnimator({
    handlers: {
      spun: (e, ctx) => {
        seen.push(['spun', ctx.instant, ctx.rushed]);
        if (!ctx.instant) return new Promise((r) => (release = r));
      },
      moved: (e, ctx) => seen.push(['moved', ctx.instant, ctx.rushed]),
      landed: (e, ctx) => seen.push(['landed', ctx.instant, ctx.rushed]),
    },
  });
  assert.equal(anim.rush(), 0); // idle: nothing to do
  const done = anim.push([{ type: 'spun' }, { type: 'moved' }, { type: 'landed' }]);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(anim.rush(), 2);
  assert.equal(anim.rushing, true);
  release();
  await done;
  assert.deepEqual(seen, [
    ['spun', false, false],
    ['moved', true, true],
    ['landed', true, true],
  ]);
  assert.equal(anim.rushing, false); // cleared once idle
  seen.length = 0;
  await anim.push([{ type: 'moved' }]);
  assert.deepEqual(seen, [['moved', false, false]]);
  // a paused animator resumes when rushed
  anim.pause();
  const p = anim.push([{ type: 'moved' }, { type: 'landed' }]);
  anim.rush();
  await p;
  assert.equal(seen.length, 3);
});

test('my turn / fast-forward keep shared shows I take part in (명절 정산 with my row)', async () => {
  const { involvesMe } = await import('../public/js/ui/cutinPolicy.js');
  const mine = new Set(['c1']);
  const holiday = { anchor: { type: 'holidayResult', results: [{ charId: 'c2' }, { charId: 'c1' }] }, charId: null };
  const lottoOthers = { anchor: { type: 'lottoDraw', entries: [{ charId: 'c2' }] }, charId: null };
  assert.equal(involvesMe(holiday, mine), true);
  assert.equal(involvesMe(lottoOthers, mine), false);
  assert.equal(classifyGroup(holiday, { mine, myTurn: true }), 'full');
  assert.equal(classifyGroup(lottoOthers, { mine, myTurn: true }), 'banner');
  assert.equal(classifyGroup({ anchor: { type: 'holidayStarted' } }, { mine, fastForward: true }), 'full');
});

test('scroll lock: a lock class without its open overlay is stale (result page never stays unscrollable)', async () => {
  const { SCROLL_LOCKS, staleLocks, repairScrollLock } = await import('../public/js/ui/scrollLock.js');
  assert.deepEqual(Object.keys(SCROLL_LOCKS).sort(), ['cutin-open', 'cz-open', 'photo-open', 'rshow-open']);
  const open = new Set(['photo-open']);
  assert.deepEqual(staleLocks(['photo-open', 'rshow-open', 'cutin-open', 'spectator', 'cz-open'], (c) => open.has(c)), ['rshow-open', 'cutin-open', 'cz-open']);
  assert.deepEqual(staleLocks([], () => false), []);
  // DOM-less fake document
  const classes = new Set(['rshow-open', 'photo-open', 'spectator']);
  const body = { classList: { [Symbol.iterator]: () => classes.values(), remove: (c) => classes.delete(c) } };
  const doc = { body, querySelectorAll: (sel) => (sel === '.photo-dlg' ? [{ isConnected: true, getClientRects: () => [1] }] : [{ isConnected: true, getClientRects: () => [] }]) };
  assert.deepEqual(repairScrollLock(doc), ['rshow-open']);
  assert.deepEqual([...classes].sort(), ['photo-open', 'spectator']);
});
