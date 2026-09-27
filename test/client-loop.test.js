// Loop maps (원작식 순환 맵) — client: 3D loop layout per era (public/js/scene/layout.js) and the pure helpers of
// public/js/shared/loop.js (era clock, 2D racetrack model, halt notes, pass tile options, admin estimate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLoopBoard, makeLoopRoom, DEFAULT_TURNS } from './client-loopFixture.js';
import {
  layoutBoard, planProps, eraSweepPoints, eraRing, ERA_SHAPES, ROUTE_SIDE, PROP_RADIUS, TALL_PROPS, insideRing, shadowPoints, lapSlots,
} from '../public/js/scene/layout.js';
import {
  lapSize, loopConfig, currentEraIndex, eraClock, eraClockText, lastTurnHint, forkOf, lapOrder, racetrack, haltNote, passOptionExtras, playEstimate,
  tileIdForPosition, isLoopBoard, LOOP_DEFAULTS, buffText, clubLabel,
} from '../public/js/shared/loop.js';
import { planCutins, tagLabel, fallbackText } from '../public/js/ui/cutinMap.js';
import { classifyGroup, isPaydayGroup, isBannerGroup, involvesMe, mergeGroups } from '../public/js/ui/cutinPolicy.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const board = makeLoopBoard({ seed: 3 });
const allTiles = (era) => [...era.tiles, ...Object.values(era.routes ?? {}).flatMap((r) => r.tiles)];

test('fixture: map sizes follow the contract (15 turns ≈ 81 tiles, lap min 18)', () => {
  const laps = Object.fromEntries(board.eras.map((e) => [e.id, lapSlots(e)]));
  assert.deepEqual(laps, { baby: 18, elem: 18, middle: 18, high: 18, young: 81, middle_age: 81, senior: 40 });
  for (const [id, t] of Object.entries(DEFAULT_TURNS)) assert.equal(lapSize(t), laps[id]);
  assert.equal(lapSize(5), 27);
  assert.equal(lapSize(100), 100);
  assert.equal(lapSize(1, { lapPerTurn: 5, lapMin: 10, lapMax: 50 }), 10);
  assert.deepEqual(loopConfig({ board: { loop: { lapPerTurn: 6 } } }), { ...LOOP_DEFAULTS, lapPerTurn: 6 });
  assert.equal(isLoopBoard(board), true);
  assert.equal(isLoopBoard({ eras: [{ tiles: [] }] }), false);
});

test('layout: each era is a closed loop with evenly spaced tiles, walking counter-clockwise from the near side', () => {
  for (let i = 0; i < board.eras.length; i++) {
    const era = board.eras[i];
    if (era.loop === false) continue; // the final race (below)
    const L = layoutBoard(board, { eraIndex: i });
    assert.equal(L.loop, true);
    assert.equal(L.eraIndex, i);
    assert.equal(L.era.id, era.id);
    // only this era's tiles
    assert.equal(Object.keys(L.tiles).length, allTiles(era).length);
    for (const t of allTiles(era)) assert.ok(L.tiles[t.id], `missing ${t.id}`);
    // one lap (career for route eras) → consecutive tiles one spacing apart, including the wrap back to the start
    const lap = lapOrder(era).map((id) => L.tiles[id]);
    assert.equal(lap.length, lapSlots(era));
    for (let k = 0; k < lap.length; k++) {
      const d = dist(lap[k], lap[(k + 1) % lap.length]);
      assert.ok(Math.abs(d - L.spacing) < 0.2, `${era.id} step ${k}: ${d}`);
    }
    assert.ok(Math.abs(L.perimeter - lap.length * L.spacing) < 1e-6);
    // start on the near side walking +x (left → right on screen)
    const start = L.tiles[L.startId];
    assert.equal(L.startId, era.tiles[0].id);
    const nearZ = Math.max(...L.ring.map((p) => p.z));
    if (!era.routes) {
      assert.ok(nearZ - start.z < 0.05, `${era.id} start near side`);
      assert.ok(Math.sin(start.yaw) > 0.9, `${era.id} start heads +x`);
    }
    assert.ok(Number.isFinite(start.x) && Number.isFinite(start.yaw));
    assert.ok(L.era.bounds.minX < L.era.center.x && L.era.center.x < L.era.bounds.maxX);
  }
});

test('layout: the final race era is an open road from the start to the goal', () => {
  const i = board.eras.length - 1;
  const era = board.eras[i];
  const L = layoutBoard(board, { eraIndex: i });
  assert.equal(L.loop, false);
  assert.equal(L.closed, false);
  assert.equal(L.goalId, era.tiles.at(-1).id);
  assert.equal(Object.keys(L.tiles).length, era.tiles.length);
  const pts = era.tiles.map((t) => L.tiles[t.id]);
  for (let k = 1; k < pts.length; k++) assert.ok(Math.abs(dist(pts[k - 1], pts[k]) - L.spacing) < 0.2);
  assert.ok(dist(pts[0], pts.at(-1)) > L.spacing * 10, 'not a loop');
  assert.ok(pts.at(-1).x > pts[0].x, 'left → right');
  const sw = eraSweepPoints(L);
  assert.ok(dist(sw[0], pts[0]) < L.spacing * 2 && dist(sw.at(-1), pts.at(-1)) < L.spacing * 2);
  const props = planProps(L, { seed: 2 });
  assert.ok(props.length > 15);
  for (const p of props.filter((x) => TALL_PROPS.has(x.type))) for (const q of shadowPoints(p, p.type)) for (const t of pts) assert.ok(dist(q, t) > 1.9);
  // the 2D model: a hairpin without the closing cap (the goal ends the bottom row)
  const g = racetrack(era);
  assert.equal(g.linear, true);
  assert.deepEqual(g.caps.map((c) => c.side), ['right']);
  // HUD: 「노년 · 골인 경쟁」, no round counter
  const room = makeLoopRoom({ board, eraIndex: i });
  const c = eraClock(room);
  assert.equal(c.race, true);
  assert.equal(eraClockText(c), '노년 · 골인 경쟁');
  assert.equal(lastTurnHint(c), '');
});

test('layout: distinct closed shape per era id', () => {
  const ids = ['baby', 'elem', 'middle', 'high', 'young', 'middle_age', 'senior'];
  const sigs = ids.map((id) => {
    const { ring } = eraRing(id, 100);
    const xs = ring.map((p) => p.x);
    const zs = ring.map((p) => p.z);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...zs) - Math.min(...zs);
    // aspect + how much of the bounding box the loop fills
    let area = 0;
    for (let i = 1; i < ring.length; i++) area += ring[i - 1].x * ring[i].z - ring[i].x * ring[i - 1].z;
    return `${(w / h).toFixed(2)}:${(Math.abs(area) / 2 / (w * h)).toFixed(2)}`;
  });
  assert.equal(new Set(sigs).size, ids.length, sigs.join(' '));
  for (const id of ids) assert.ok(ERA_SHAPES[id]?.label, id);
  // closed + counter-clockwise on screen (x right, z towards the camera = down): signed area < 0 in x/z
  for (const id of ids) {
    const { ring } = eraRing(id, 60);
    assert.ok(dist(ring[0], ring.at(-1)) < 1e-9);
    let a = 0;
    for (let i = 1; i < ring.length; i++) a += ring[i - 1].x * ring[i].z - ring[i].x * ring[i - 1].z;
    assert.ok(a < 0, id);
  }
});

test('layout: route eras — three equal-length branches from the fork to the rejoin, love outside, money inside', () => {
  for (const i of board.eras.map((e, k) => (e.routes ? k : -1)).filter((k) => k >= 0)) {
    const era = board.eras[i];
    const L = layoutBoard(board, { eraIndex: i });
    const fk = forkOf(era);
    const fork = L.tiles[era.tiles[fk.fork].id];
    const rejoin = L.tiles[era.tiles[fk.rejoin].id];
    const lens = [];
    for (const key of ['love', 'career', 'money']) {
      const r = L.era.routes[key];
      assert.equal(r.tileIds.length, era.routes[key].tiles.length);
      lens.push(r.tileIds.length);
      assert.ok(dist(r.start, fork) < 1e-9 && dist(r.end, rejoin) < 1e-9, key);
      const mid = L.tiles[r.tileIds[Math.floor(r.tileIds.length / 2)]];
      const inside = insideRing(L.ring, mid.x, mid.z);
      const off = Math.min(...L.ring.map((p) => dist(p, mid)));
      if (ROUTE_SIDE[key] === 0) assert.ok(off < 0.3, `career on the ring ${off}`);
      else {
        assert.ok(off > L.routeWidth * 0.85, `${key} offset ${off}`);
        assert.equal(inside, ROUTE_SIDE[key] < 0, `${key} side`);
      }
      // a lap through this route: every step about one spacing (outer lane a bit longer, inner shorter)
      const lap = lapOrder(era, key).map((id) => L.tiles[id]);
      for (let k = 0; k < lap.length; k++) {
        const d = dist(lap[k], lap[(k + 1) % lap.length]);
        assert.ok(d > 1.75 && d < 3.6, `${era.id}/${key} step ${k}: ${d}`);
      }
    }
    assert.equal(new Set(lens).size, 1);
    // the branch zone is centred on the near side (towards the camera)
    const mids = L.era.routes.career.label;
    assert.ok(mids.z > L.era.center.z, 'zone on the near side');
  }
});

test('layout: no overlapping tiles, deterministic, finite for small and big eras', () => {
  const boards = [board, makeLoopBoard({ seed: 9, turns: { young: 3, middle_age: 20, baby: 1, senior: 40 } })];
  for (const b of boards) {
    for (let i = 0; i < b.eras.length; i++) {
      const L = layoutBoard(b, { eraIndex: i });
      const tiles = Object.values(L.tiles);
      for (const t of tiles) assert.ok(Number.isFinite(t.x) && Number.isFinite(t.z) && Number.isFinite(t.yaw));
      for (let a = 0; a < tiles.length; a++) for (let c = a + 1; c < tiles.length; c++) assert.ok(dist(tiles[a], tiles[c]) > 1.7, `${tiles[a].id} vs ${tiles[c].id}`);
      assert.deepEqual(layoutBoard(b, { eraIndex: i }), L);
    }
  }
  // out-of-range era index clamps; an old linear route era (tiles = [stop, merge]) still lays out as a loop
  assert.equal(layoutBoard(board, { eraIndex: 99 }).eraIndex, board.eras.length - 1);
  const old = { eras: [{ id: 'young', name: '청년', tiles: [{ id: 'y:main:0', type: 'stop', promptId: 'routeChoice' }, { id: 'y:main:1', type: 'merge' }], routes: { love: { tiles: [{ id: 'y:love:0', type: 'money' }] }, career: { tiles: [{ id: 'y:career:0', type: 'money' }] }, money: { tiles: [{ id: 'y:money:0', type: 'money' }] } } }] };
  const Lo = layoutBoard(old);
  assert.equal(Object.keys(Lo.tiles).length, 5);
});

test('layout: camera tour goes once around the loop from the start', () => {
  const L = layoutBoard(board, { eraIndex: 4 });
  const pts = eraSweepPoints(L);
  assert.equal(pts.length, 9);
  assert.ok(dist(pts[0], pts.at(-1)) < 1e-6);
  assert.ok(dist(pts[0], L.tiles[L.startId]) < L.spacing * 20);
  const xs = pts.map((p) => p.x);
  assert.ok(Math.max(...xs) - Math.min(...xs) > (L.era.bounds.maxX - L.era.bounds.minX) * 0.6);
});

test('props: deterministic, off the track, tall ones never hide the track, a landmark per era', () => {
  for (let i = 0; i < board.eras.length; i++) {
    const L = layoutBoard(board, { eraIndex: i });
    const a = planProps(L, { seed: 3 });
    assert.deepEqual(planProps(L, { seed: 3 }), a);
    assert.ok(a.length > 15, `${board.eras[i].id}: ${a.length} props`);
    const tiles = Object.values(L.tiles);
    for (const p of a) {
      const r = PROP_RADIUS[p.type] ?? 1;
      for (const t of tiles) assert.ok(dist(p, t) >= r + 1.9 - 1e-9, `${p.type} too close to ${t.id}`);
    }
    for (const p of a.filter((x) => TALL_PROPS.has(x.type))) {
      for (const q of shadowPoints(p, p.type)) for (const t of tiles) assert.ok(dist(q, t) > 1.9, `${board.eras[i].id}: ${p.type} hides ${t.id}`);
    }
    const low = planProps(L, { seed: 3, density: 0.4 });
    assert.ok(low.length < a.length);
    const theme = { baby: 'hospital', elem: 'school', middle: 'school', high: 'school', young: 'campus', middle_age: 'office', senior: 'temple' }[board.eras[i].id];
    assert.ok(a.some((p) => p.type === theme), `${board.eras[i].id} landmark ${theme}`);
  }
  // a park inside the loop (low props only)
  const L = layoutBoard(board, { eraIndex: 4 });
  const inner = planProps(L, { seed: 11 }).filter((p) => insideRing(L.ring, p.x, p.z));
  assert.ok(inner.length > 10 && inner.every((p) => !TALL_PROPS.has(p.type) || shadowPoints(p, p.type).length));
});

test('era clock: shared era, 「청년 7/15턴」, last-turn hint', () => {
  const room = makeLoopRoom({ board, eraIndex: 4, eraRound: 7 });
  assert.equal(currentEraIndex(room), 4);
  const c = eraClock(room);
  assert.deepEqual([c.id, c.round, c.turns, c.left, c.last], ['young', 7, 15, 8, false]);
  assert.equal(eraClockText(c), '청년 7/15턴');
  assert.equal(lastTurnHint(c), '');
  const last = eraClock(makeLoopRoom({ board, eraIndex: 4, eraRound: 15 }));
  assert.equal(last.last, true);
  assert.match(lastTurnHint(last), /이번 시대 마지막 턴/);
  const kids = makeLoopBoard({ eras: ['baby', 'elem', 'middle', 'high'] });
  const fin = eraClock(makeLoopRoom({ board: kids, eraIndex: 3, eraRound: 3 }));
  assert.equal(fin.final, true);
  assert.match(lastTurnHint(fin), /결과 발표/);
  // older views: no eraIndex → the characters' era; no round → 「청년 시대」
  const old = makeLoopRoom({ board, eraIndex: 4 });
  delete old.eraIndex;
  delete old.turn.eraRound;
  assert.equal(currentEraIndex(old), 4);
  assert.equal(eraClockText(eraClock(old)), '청년 시대');
  assert.equal(tileIdForPosition(board, { eraIndex: 4, route: 'love', index: 2 }), 'young:love:2');
  assert.equal(tileIdForPosition(board, { eraIndex: 0, route: 'main', index: -1 }), 'baby:main:0');
});

test('2D racetrack: every tile once, no overlap, lap neighbours adjacent, branch zone in the top row', () => {
  for (const era of [...board.eras, ...makeLoopBoard({ seed: 5, turns: { young: 3, middle_age: 30, baby: 1 } }).eras]) {
    const g = racetrack(era);
    const ids = g.cells.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length, `${era.id} duplicates`);
    assert.deepEqual([...ids].sort(), allTiles(era).map((t) => t.id).sort(), era.id);
    const used = new Set();
    const mark = (row, col, rs = 1, cs = 1, what = '') => {
      for (let r = row; r < row + rs; r++)
        for (let c = col; c < col + cs; c++) {
          const k = `${r},${c}`;
          assert.ok(!used.has(k), `${era.id}: ${what} overlaps at ${k}`);
          assert.ok(r >= 1 && r <= g.rows && c >= 1 && c <= g.cols, `${era.id}: ${k} outside`);
          used.add(k);
        }
    };
    for (const c of g.cells) mark(c.row, c.col, c.rowSpan ?? 1, 1, c.id);
    for (const l of g.labels) mark(l.row, l.col, 1, 1, `label ${l.route}`);
    for (const c of g.caps) mark(c.row, c.col, c.rowSpan, 1, `cap ${c.side}`);
    if (g.road) mark(g.road.row, g.road.col, 1, g.road.colSpan, 'road');
    // walking neighbours are adjacent on the grid, except the two turns (caps) and the road gap
    for (const route of era.routes ? ['love', 'career', 'money'] : ['career']) {
      const lap = lapOrder(era, route).map((id) => g.cells.find((c) => c.id === id));
      let jumps = 0;
      for (let k = 0; k < lap.length; k++) {
        const a = lap[k];
        const b = lap[(k + 1) % lap.length];
        const rowsA = [a.row, a.row + (a.rowSpan ?? 1) - 1];
        const rowsB = [b.row, b.row + (b.rowSpan ?? 1) - 1];
        const rowOverlap = rowsA[0] <= rowsB[1] && rowsB[0] <= rowsA[1];
        const adjacent = rowOverlap && Math.abs(a.col - b.col) <= 2; // the label column sits between the fork and the lanes
        if (!adjacent) jumps++;
      }
      assert.ok(jumps <= 2, `${era.id}/${route}: ${jumps} jumps`);
    }
    if (era.routes) {
      const fork = g.cells.find((c) => c.fork);
      assert.equal(fork.row, 1);
      assert.equal(fork.rowSpan, 3);
      assert.deepEqual(g.labels.map((l) => l.route), ['love', 'career', 'money']);
      assert.equal(g.rows, 4);
    } else assert.equal(g.rows, 2);
    assert.ok(g.cells.find((c) => c.start));
  }
  // an 81-tile route era fits in ≈ 42 columns (both rows about the same length)
  const g = racetrack(board.eras[4]);
  assert.ok(g.cols <= 44, `${g.cols} columns`);
});

test('halt notes, pass tile options, admin estimate', () => {
  assert.equal(haltNote({ type: 'moved', halted: 'salary' }).text, '💵 월급날! 멈춤');
  assert.match(haltNote({ type: 'moved', halted: 'pass', remaining: 3 }).text, /찬스 광장 \(남은 3칸\)/);
  assert.equal(haltNote({ type: 'moved', halted: 'stop' }).icon, '🔀');
  assert.equal(haltNote({ type: 'moved', resumed: true }).icon, '🚶');
  assert.equal(haltNote({ type: 'moved', wrapped: true }).icon, '🔁');
  assert.equal(haltNote({ type: 'moved', path: ['a'] }), null);
  assert.equal(haltNote({ type: 'landed' }), null);
  const p = { kind: 'passTile', options: [] };
  const wish = passOptionExtras(p, { id: 'wish', cost: 20, chance: 0.55, money: 100 });
  assert.equal(wish.icon, '🙏');
  assert.deepEqual(wish.badges, ['🙏 시주 20만원', '✨ 성공 55%', '💰 성공 시 +100만원', '🍀 운 +1']);
  assert.deepEqual(passOptionExtras(p, { id: 'wish', cost: 20, desc: '시주 20만원 · 확률 55%' }).badges, []); // the server desc says it
  assert.deepEqual(passOptionExtras(p, { id: 'pass', buff: { id: 'salaryX2', name: '월급 두 배', icon: '💵' } }).badges, ['💵 월급 두 배 버프']);
  assert.deepEqual(passOptionExtras(p, { id: 'pass', buff: { name: '성장 버프', icon: '📈' } }).badges, ['📈 성장 버프']);
  assert.deepEqual(passOptionExtras(p, { id: 'pass', desc: '📈 성장 버프: 능력치 +1 더', buff: { name: '성장 버프', icon: '📈' } }).badges, []);
  assert.equal(buffText({ name: '액땜', icon: '🛡️' }), '🛡️ 액땜');
  assert.equal(passOptionExtras(p, { id: 'jobChange', jobId: 'chef' }).icon, '💼');
  assert.equal(passOptionExtras(p, { id: 'pass' }).badges.length, 0);
  assert.deepEqual(passOptionExtras({ kind: 'shop' }, { id: 'x', icon: '⭐' }), { icon: '⭐', badges: [] });
  assert.equal(clubLabel('band', { balance: { clubs: { options: [{ id: 'band', name: '밴드부', icon: '🎸' }] } } }), '🎸 밴드부');
  assert.equal(clubLabel({ name: '운동부', icon: '⚽' }), '⚽ 운동부');
  assert.equal(clubLabel('study'), '📚 공부 동아리');
  const est = playEstimate({ turns: 53, characters: 8 });
  assert.equal(est.minutes, 106);
  assert.equal(est.long, true);
  assert.equal(playEstimate({ turns: 10, characters: 2 }).long, false);
});

// ---------- cut-ins / policy ----------

test('cut-ins: ONE era transition group with every eraChanged of the batch folded in (studio + news)', () => {
  const ev = [
    { type: 'turnStarted', charId: 'c3' },
    { type: 'spun', charId: 'c3', value: 4 },
    { type: 'moved', charId: 'c3', path: ['a'] },
    { type: 'landed', charId: 'c3', tileId: 'a', tileType: 'money', cutin: false },
    { type: 'eraTransition', fromEraId: 'high', toEraId: 'young', eraIndex: 4, turns: 15, lap: 81, mcStudio: true, mc: [{ speaker: 'bomi', line: '청년 시대!' }], cutin: true },
    ...['c1', 'c2', 'c3'].map((id) => ({ type: 'eraChanged', charId: id, era: 'young', eraId: 'young', eraName: '청년', cutin: false })),
    { type: 'moneyChanged', charId: 'c2', delta: 30, reason: 'allowance' },
    { type: 'newsFlash', eraId: 'young', title: '취업 한파', mc: [{ speaker: 'hoya', line: '멍!' }] },
    { type: 'turnStarted', charId: 'c1' },
  ];
  const groups = planCutins(ev);
  const t = groups.filter((g) => g.anchor.type === 'eraTransition');
  assert.equal(t.length, 1);
  assert.equal(groups.filter((g) => g.anchor.type === 'eraChanged').length, 0);
  assert.deepEqual(t[0].entrants, ['c1', 'c2', 'c3']);
  assert.equal(t[0].eraName, '청년');
  assert.equal(t[0].news.title, '취업 한파');
  assert.equal(t[0].studio.length, 2);
  assert.deepEqual(t[0].money, [{ charId: 'c2', delta: 30, reason: 'allowance' }]);
  assert.equal(tagLabel({ type: 'eraTransition', toEraName: '청년' }), '🗺️ 청년 시대 개막');
  assert.match(fallbackText({ type: 'eraTransition', toEraName: '청년', turns: 15 }), /모두 함께 청년 시대로! 이번 시대는 15턴/);
  // big + shared: full for everyone (compact spectators too), never merged into a character's group
  assert.equal(classifyGroup(t[0], { mine: ['c9'], mode: 'compact' }), 'full');
  assert.equal(involvesMe(t[0], ['c9']), true);
  assert.equal(mergeGroups(groups, { mine: [] }).filter((g) => g.anchor.type === 'eraTransition').length, 1);
});

test('policy: 💵 월급날 landings are banners unless big; 찬스 광장 「지나가기」 and buffs are banners', () => {
  const pay = { anchor: { type: 'landed', tileType: 'salary', charId: 'c1' }, charId: 'c1', delta: 120, texts: [], money: [], involved: ['c1'] };
  assert.equal(isPaydayGroup(pay), true);
  assert.equal(classifyGroup(pay, { mine: ['c1'] }), 'banner');
  assert.equal(classifyGroup({ ...pay, delta: 500 }, { mine: ['c1'] }), 'full');
  assert.equal(classifyGroup(pay, { mine: [], mode: 'off' }), 'skip');
  const passed = { anchor: { type: 'promptResolved', kind: 'passTile', result: 'passed', charId: 'c1' }, charId: 'c1' };
  assert.equal(isBannerGroup(passed), true);
  assert.equal(classifyGroup(passed, { mine: ['c1'] }), 'banner');
  const wish = { anchor: { type: 'promptResolved', kind: 'passTile', result: 'wishOk', charId: 'c1', cutin: true }, charId: 'c1' };
  assert.equal(classifyGroup(wish, { mine: ['c1'] }), 'full');
  const buffs = planCutins([{ type: 'chanceBuff', charId: 'c1', buff: { id: 'salaryX2', name: '월급 두 배', icon: '💵' }, action: 'gained' }]);
  assert.equal(buffs.length, 1);
  assert.equal(isBannerGroup(buffs[0]), true);
  // as a follow-up of the pass result → a chip of that group
  const g = planCutins([{ type: 'promptResolved', kind: 'passTile', result: 'passed', charId: 'c1', cutin: true }, { type: 'chanceBuff', charId: 'c1', buff: { name: '액땜', icon: '🛡️' }, action: 'gained' }]);
  assert.equal(g.length, 1);
  assert.equal(g[0].buffs[0].buff.name, '액땜');
});
