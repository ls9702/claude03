// Stage 9-B result show (인생 결산 방송) pure helpers: ranking rows with ties, breakdown bars, podium steps incl. ties,
// appraisal / award / title formatting, the show plan (order, durations, ≤ 60 s of highlights for 8 characters),
// MVP vote rules, the group photo layout for 1–8 characters and the 3D podium slots.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BREAKDOWN,
  FIGURE_ASPECT,
  HIGHLIGHT_BUDGET_MS,
  PHOTO_H,
  PHOTO_POSES,
  PHOTO_W,
  appraisalRows,
  appraisalTotals,
  awardCards,
  breakdown,
  breakdownBars,
  centerOut,
  countdownText,
  fallbackMc,
  highlightSlides,
  mcParts,
  medal,
  mvpState,
  photoFileName,
  photoLayout,
  photoTitle,
  planResultShow,
  podiumLayout,
  poseOffset,
  rankRows,
  titleBadges,
  voteButtons,
} from '../public/js/shared/result.js';
import { podiumSlots } from '../public/js/scene/podiumLayout.js';

const won = (n) => `${n}만원`;
const chars = (n, mineIds = []) =>
  Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, name: `캐릭${i + 1}`, avatar: {}, isMe: mineIds.includes(`c${i + 1}`), ownerId: mineIds.includes(`c${i + 1}`) ? 'p1' : 'p2' }));
const row = (charId, total, extra = {}) => ({ charId, name: charId, money: total, debt: 0, items: 0, house: 0, treasures: 0, awards: 0, total, ...extra });

test('rankRows: server rank wins, else competition ranking by total (ties share a rank)', () => {
  const r = rankRows({ ranking: [row('c1', 900), row('c2', 700), row('c3', 700), row('c4', 100)] }, chars(4));
  assert.deepEqual(r.map((x) => x.rank), [1, 2, 2, 4]);
  assert.equal(r[0].char.id, 'c1');
  assert.deepEqual(rankRows({ ranking: [{ ...row('c1', 5), rank: 1, place: 3 }] }).map((x) => [x.rank, x.place]), [[1, 3]]);
  assert.equal(medal(1), '🥇');
  assert.equal(medal(5), '5위');
  // array-shaped fields are summed
  assert.equal(rankRows({ ranking: [row('c1', 10, { treasures: [{ value: 3 }, { value: 4 }], awards: [{ bonus: 100 }] })] })[0].treasures, 7);
});

test('breakdown: segments (현금 · 집 · 아이템 · 보물 · 특별상) − negative = total; bars scale to the largest', () => {
  const rows = [
    { money: 500, debt: 0, house: 1000, items: 45, treasures: 300, awards: 200, total: 2045 },
    { money: 100, debt: 400, house: 0, items: 0, treasures: 0, awards: 0, total: -300 },
    { money: 50, debt: 0, house: 0, items: 0, treasures: 0, awards: 0, total: 50 },
  ];
  for (const r of rows) {
    const b = breakdown(r);
    assert.equal(b.segments.reduce((s, x) => s + x.value, 0) - b.negative, r.total);
    assert.ok(b.segments.every((s) => s.value > 0 && s.color && s.label));
  }
  assert.deepEqual(breakdown(rows[0]).segments.map((s) => s.key), ['cash', 'house', 'items', 'treasures', 'awards']);
  assert.equal(breakdown(rows[1]).negative, 300);
  const bars = breakdownBars(rows.map((r, i) => ({ ...r, charId: `c${i}` })));
  assert.equal(Math.round(bars[0].segments.reduce((s, x) => s + x.pct, 0)), 100);
  assert.ok(bars[2].segments[0].pct < 5);
  assert.ok(bars[1].negPct > 0 && bars[1].negPct < 100);
  assert.equal(BREAKDOWN.length, 5);
});

test('podiumLayout: steps 2 · 1 · 3, ties share a step, the rest are "others"', () => {
  const rr = (...totals) => rankRows({ ranking: totals.map((t, i) => row(`c${i + 1}`, t)) });
  let p = podiumLayout(rr(900, 800, 700, 600, 500));
  assert.deepEqual(p.order, [2, 1, 3]);
  assert.deepEqual(p.steps.map((s) => s.rows.map((r) => r.charId)), [['c1'], ['c2'], ['c3']]);
  assert.deepEqual(p.others.map((r) => r.charId), ['c4', 'c5']);
  assert.ok(p.steps[0].height > p.steps[1].height && p.steps[1].height > p.steps[2].height);
  p = podiumLayout(rr(900, 900, 700));
  assert.deepEqual(p.steps.map((s) => s.rows.length), [2, 0, 1]); // two 1sts, no 2nd, a 3rd
  p = podiumLayout(rr(900, 800, 800, 800, 100));
  assert.deepEqual(p.steps.map((s) => s.rows.length), [1, 3, 0]);
  assert.deepEqual(p.others.map((r) => r.rank), [5]);
  p = podiumLayout(rr(10));
  assert.deepEqual(p.steps.map((s) => s.rows.length), [1, 0, 0]);
});

test('podiumSlots (3D): tied pawns spread on their step, others in the two flanks', () => {
  const s = podiumSlots([1, 2, 3, 0, 0, 0]);
  assert.deepEqual(s.slice(0, 3).map((x) => [x.x, x.step]), [[0, 1], [-2.3, 2], [2.3, 3]]);
  assert.ok(s[3].x < -3.5 && s[4].x > 3.5 && Math.abs(s[5].x) > Math.abs(s[3].x));
  const t = podiumSlots([1, 1, 3]);
  assert.equal(t[0].step, 1);
  assert.equal(t[1].step, 1);
  assert.ok(Math.abs(t[0].x - t[1].x) >= 0.5 && Math.abs(t[0].x) <= 1.1 && Math.abs(t[1].x) <= 1.1);
  const four = podiumSlots([2, 2, 2, 2]);
  const xs = four.map((x) => x.x).sort((a, b) => a - b);
  assert.ok(xs[0] >= -2.3 - 1.1 && xs[3] <= -2.3 + 1.1, 'stays on the step');
});

test('appraisal rows: cheapest first (biggest reveal last), fakes 💥, totals per owner; awards + titles from meta', () => {
  const meta = {
    treasures: { treasures: [{ id: 'celadon', name: '고려청자', icon: '🏺' }, { id: 'coin', name: '옛날 동전', icon: '🪙' }] },
    awards: { awards: [{ id: 'dabok', name: '다복상', icon: '👨‍👩‍👧‍👦', desc: '자녀가 가장 많은 캐릭터' }] },
    titles: { titles: [{ id: 'landlord', name: '건물주', icon: '🏢', desc: '집 부자' }] },
  };
  const result = {
    ranking: [row('c1', 900), row('c2', 500)],
    treasures: [
      { charId: 'c1', uid: 'tr1', treasureId: 'celadon', value: 800, fake: false },
      { charId: 'c2', uid: 'tr2', treasureId: 'coin', value: 2, fake: true },
      { charId: 'c2', uid: 'tr3', treasureId: 'celadon', value: 350, fake: false },
    ],
    awards: [{ id: 'dabok', name: '다복상', charIds: ['c1', 'c2'], bonus: 200 }, { id: 'x', charIds: [], bonus: 0 }],
    titles: { c1: ['landlord'], c2: ['unknown_title'] },
  };
  const rows = appraisalRows(result, chars(2), { meta, won });
  assert.deepEqual(rows.map((r) => r.uid), ['tr2', 'tr3', 'tr1']);
  assert.equal(rows[0].text, '💥 가짜!');
  assert.equal(rows[2].text, '800만원');
  assert.equal(rows[2].info.name, '고려청자');
  assert.equal(rows[1].name, '캐릭2');
  assert.deepEqual(appraisalTotals(rows), { c2: 350, c1: 800 });
  const cards = awardCards(result, chars(2), { meta, won });
  assert.equal(cards[0].icon, '👨‍👩‍👧‍👦');
  assert.equal(cards[0].desc, '자녀가 가장 많은 캐릭터');
  assert.deepEqual(cards[0].winners.map((w) => w.name), ['캐릭1', '캐릭2']);
  assert.equal(cards[0].bonusText, '+200만원');
  assert.equal(cards[1].bonusText, '');
  const t = titleBadges(result, { meta });
  assert.deepEqual(t.c1, [{ id: 'landlord', name: '건물주', icon: '🏢', desc: '집 부자' }]);
  assert.equal(t.c2[0].name, 'unknown_title');
  assert.deepEqual(appraisalRows({}, []), []);
  assert.deepEqual(awardCards({}, []), []);
});

test('highlights: LAST → FIRST, ≤ 3 per character, ≤ 60 s for 8 characters (shorter slides / fewer highlights)', () => {
  const cs = chars(8);
  const ranking = cs.map((c, i) => row(c.id, 1000 - i * 100));
  const highlights = Object.fromEntries(cs.map((c) => [c.id, Array.from({ length: 5 }, (_, k) => ({ turnNo: 10 * k + 1, type: 'landed', text: `${c.name} 장면 ${k}`, tone: 'good', scene: 'office', amount: 100 * k }))]));
  const slides = highlightSlides({ ranking, highlights }, cs);
  const total = slides.reduce((s, x) => s + x.ms, 0);
  assert.ok(total <= HIGHLIGHT_BUDGET_MS, `${total} ms`);
  assert.equal(slides[0].charId, 'c8'); // the last place opens
  assert.equal(slides.at(-1).charId, 'c1'); // the winner closes
  const order = [...new Set(slides.map((s) => s.charId))];
  assert.deepEqual(order, cs.map((c) => c.id).reverse());
  for (const id of order) assert.ok(slides.filter((s) => s.charId === id).length <= 3);
  assert.ok(slides.every((s) => s.ms >= 1100 && s.ms <= 1500));
  // spread over the lifetime: the first and the last of 5 are kept
  const mine = slides.filter((s) => s.charId === 'c1');
  assert.equal(mine[0].turnNo, 1);
  assert.equal(mine.at(-1).turnNo, 41);
  // a tight budget → fewer per character, still last → first
  const tight = highlightSlides({ ranking, highlights }, cs, { budgetMs: 12000 });
  assert.ok(tight.reduce((s, x) => s + x.ms, 0) <= 12000);
  assert.equal(tight[0].charId, 'c8');
  // characters without highlights are skipped
  assert.equal(highlightSlides({ ranking, highlights: { c3: highlights.c3 } }, cs).length, 3);
});

test('planResultShow: intro → highlights → 보물 감정 → 특별상 → 순위 → 시상대; steps without data are left out', () => {
  const cs = chars(8);
  const ranking = cs.map((c, i) => row(c.id, 1000 - i * 100));
  const highlights = Object.fromEntries(cs.map((c) => [c.id, Array.from({ length: 4 }, (_, k) => ({ turnNo: k, text: 'x' }))]));
  const full = planResultShow(
    { ranking, highlights, treasures: cs.map((c, i) => ({ charId: c.id, uid: `t${i}`, treasureId: 'a', value: i * 10 })), awards: [{ id: 'a', charIds: ['c1'], bonus: 100 }], titles: { c1: ['t'] } },
    { characters: cs, introMs: 8000 },
  );
  assert.deepEqual(full.steps.map((s) => s.id), ['intro', 'highlights', 'appraisal', 'awards', 'ranking', 'podium']);
  assert.ok(full.steps.every((s) => s.ms > 0));
  assert.ok(full.steps.find((s) => s.id === 'highlights').ms <= 60000);
  assert.ok(full.totalMs <= 150000, `${full.totalMs}`);
  assert.equal(full.steps.find((s) => s.id === 'appraisal').rows.length, 8);
  const bare = planResultShow({ ranking }, { characters: cs });
  assert.deepEqual(bare.steps.map((s) => s.id), ['intro', 'ranking', 'podium']);
  // lots of treasures stay within ~20 s
  const many = planResultShow({ ranking, treasures: Array.from({ length: 40 }, (_, i) => ({ charId: 'c1', uid: `u${i}`, treasureId: 'a', value: i })) }, { characters: cs });
  assert.ok(many.steps.find((s) => s.id === 'appraisal').ms <= 24000);
  assert.deepEqual(mcParts({ mc: [{ part: 'intro', line: 'a' }, { part: 'mvp', line: 'b' }, { line: 'c' }] }).intro.length, 2);
  const f = fallbackMc('mvp', { name: '지영' });
  assert.ok(f.every((l) => l.part === 'mvp' && !l.line.includes('{')));
  assert.ok(f.filter((l) => l.speaker === 'hoya').every((l) => l.line.includes('멍')));
});

test('MVP vote: players only, not my own character (unless every character is mine), deadline, decided, my vote', () => {
  const now = 1_000_000;
  const base = (mvp, { me = { id: 'p1', role: 'player' }, mine = ['c1'], n = 3, status = 'finished' } = {}) => ({
    status,
    me,
    characters: chars(n, mine),
    result: { ranking: [], mvp },
  });
  assert.equal(mvpState(base(undefined)), null);
  assert.deepEqual(voteButtons(base(undefined)), []);
  let room = base({ votes: { p2: 'c1', p3: 'c1', p4: 'c2' }, closesAt: now + 30000 });
  let st = mvpState(room, { now });
  assert.equal(st.open, true);
  assert.equal(st.total, 3);
  assert.deepEqual(st.counts, { c1: 2, c2: 1 });
  assert.deepEqual(st.leaders, ['c1']);
  let b = voteButtons(room, { now });
  assert.equal(b.find((x) => x.charId === 'c1').disabled, true);
  assert.equal(b.find((x) => x.charId === 'c1').reason, '내 캐릭터에는 투표할 수 없어요');
  assert.equal(b.find((x) => x.charId === 'c2').disabled, false);
  assert.equal(b.find((x) => x.charId === 'c1').count, 2);
  // my vote → that button is "voted" (disabled), the others stay changeable
  room = base({ votes: { p1: 'c2' }, closesAt: now + 30000 });
  b = voteButtons(room, { now });
  assert.equal(b.find((x) => x.charId === 'c2').voted, true);
  assert.equal(b.find((x) => x.charId === 'c2').disabled, true);
  assert.equal(b.find((x) => x.charId === 'c3').disabled, false);
  // every character mine → my own are votable
  b = voteButtons(base({ votes: {}, closesAt: now + 5000 }, { mine: ['c1', 'c2', 'c3'] }), { now });
  assert.ok(b.every((x) => !x.disabled));
  // past the deadline / closed / decided
  assert.equal(mvpState(base({ votes: {}, closesAt: now - 1 }), { now }).open, false);
  assert.ok(voteButtons(base({ votes: {}, closesAt: now - 1 }), { now }).every((x) => x.disabled && x.reason === '투표가 마감됐어요'));
  assert.equal(mvpState(base({ votes: {}, closesAt: now + 9999, closed: true }), { now }).open, false);
  const dec = base({ votes: { p2: 'c3' }, closesAt: now - 1, winner: 'c3', closed: true });
  assert.equal(mvpState(dec, { now }).decided, true);
  assert.ok(voteButtons(dec, { now }).find((x) => x.charId === 'c3').winner);
  assert.ok(voteButtons(dec, { now }).every((x) => x.reason === 'MVP가 정해졌어요'));
  // spectators (and viewers without a seat) see results only
  const spec = voteButtons(base({ votes: { p2: 'c1' }, closesAt: now + 1000 }, { me: { id: 'p9', role: 'spectator' }, mine: [] }), { now });
  assert.ok(spec.every((x) => !x.showButton && x.disabled));
  assert.equal(mvpState(base({ votes: {}, closesAt: now + 1000 }, { me: null }), { now }).canVote, false);
  assert.equal(mvpState(base({ votes: {}, closesAt: now + 1000 }, { status: 'playing' }), { now }).open, false);
  assert.equal(countdownText(65000), '1:05');
  assert.equal(countdownText(9001), '10초');
  assert.equal(countdownText(-5), '0초');
});

test('photo layout: 1–8 characters inside the frame, rank 1 front and centre, back row behind; poses; title', () => {
  for (let n = 1; n <= 8; n++) {
    const s = photoLayout(n);
    assert.equal(s.length, n);
    for (const p of s) {
      assert.ok(p.x - p.w / 2 >= 0 && p.x + p.w / 2 <= PHOTO_W, `n=${n} x`);
      assert.ok(p.y <= PHOTO_H && p.y - p.h >= PHOTO_H * 0.12, `n=${n} y (below the banner)`);
      assert.ok(p.labelY > 0 && p.labelY < PHOTO_H, `n=${n} label`);
      assert.ok(Math.abs(p.w / p.h - FIGURE_ASPECT) < 0.01);
    }
    assert.equal(s[0].row, 'front');
    const front = s.filter((p) => p.row === 'front');
    const centre = PHOTO_W / 2;
    assert.ok(front.every((p) => Math.abs(s[0].x - centre) <= Math.abs(p.x - centre) + 1), `n=${n}: 1st closest to the centre`);
    // same-row figures don't overlap much (labels stay readable)
    for (const row of ['front', 'back']) {
      const xs = s.filter((p) => p.row === row).map((p) => p.x).sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= 250, `n=${n} ${row} spacing`);
    }
    if (n > 4) {
      const back = s.filter((p) => p.row === 'back');
      assert.equal(back.length, Math.floor(n / 2));
      assert.ok(back.every((p) => p.z < front[0].z && p.y < front[0].y && p.h < front[0].h));
    } else assert.ok(s.every((p) => p.row === 'front'));
  }
  assert.deepEqual(photoLayout(0), []);
  assert.equal(photoLayout(12).length, 8);
  assert.deepEqual(centerOut(5), [2, 1, 3, 0, 4]);
  assert.deepEqual(centerOut(4), [1, 2, 0, 3]);
  assert.deepEqual(PHOTO_POSES.map((p) => p.label), ['브이', '만세', '하트', '점프']);
  assert.notDeepEqual(poseOffset('jump', 0), poseOffset('jump', 1));
  assert.ok(poseOffset('jump', 0).lift > 0 && poseOffset('v', 0).lift === 0);
  const d = new Date(2026, 8, 27);
  assert.equal(photoTitle({ code: 'AB3DEF', date: d }), '인생게임 · 방 AB3DEF · 2026. 9. 27.');
  assert.equal(photoFileName({ code: 'AB3DEF', date: d }), 'jinsei-AB3DEF-20260927.png');
  assert.equal(photoFileName({ code: '../x', date: d }), 'jinsei-x-20260927.png');
});
