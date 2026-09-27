// 룰렛 실력 모드 — pure client helpers (public/js/ui/rouletteSkill.js): shake availability, acceleration → target,
// the shake meter, gauge sweep → target, deck info, display texts, input preference.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GAUGE,
  INPUT_KEY,
  SHAKE,
  accelToTarget,
  aimGrade,
  aimShort,
  aimText,
  createShakeMeter,
  deckInfo,
  defaultInput,
  detectShakeEnv,
  gaugePosition,
  gaugeTarget,
  isSkillRoom,
  jitterHint,
  loadInputPref,
  motionMagnitude,
  saveInputPref,
  shakeSupport,
  sweepDuration,
} from '../public/js/ui/rouletteSkill.js';

test('shake availability: secure context + DeviceMotionEvent (+ iOS permission) — reasons in Korean', () => {
  function DME() {}
  const ios = Object.assign(function DMEi() {}, { requestPermission: async () => 'granted' });
  assert.deepEqual(detectShakeEnv({ DeviceMotionEvent: DME, isSecureContext: true, matchMedia: () => ({ matches: true }) }), { hasMotion: true, secure: true, needsPermission: false, coarse: true });
  assert.deepEqual(detectShakeEnv({ isSecureContext: false, navigator: { maxTouchPoints: 0 } }), { hasMotion: false, secure: false, needsPermission: false, coarse: false });
  assert.equal(detectShakeEnv({ DeviceMotionEvent: ios, isSecureContext: true }).needsPermission, true);
  assert.equal(detectShakeEnv({}).hasMotion, false);

  assert.deepEqual(shakeSupport({ hasMotion: true, secure: false }), { ok: false, needsPermission: false, reason: '흔들기는 HTTPS 주소에서만 돼요 · 버튼으로 해요' });
  assert.match(shakeSupport({ hasMotion: false, secure: true }).reason, /지원하지 않아요/);
  assert.deepEqual(shakeSupport({ hasMotion: true, secure: true }), { ok: true, needsPermission: false, reason: null });
  assert.deepEqual(shakeSupport({ hasMotion: true, secure: true, needsPermission: true }), { ok: true, needsPermission: true, reason: null });
  assert.deepEqual(shakeSupport({ hasMotion: true, secure: true, needsPermission: true }, 'granted'), { ok: true, needsPermission: false, reason: null });
  assert.match(shakeSupport({ hasMotion: true, secure: true, needsPermission: true }, 'denied').reason, /거부/);

  const phone = { hasMotion: true, secure: true, coarse: true };
  const desktop = { hasMotion: true, secure: true, coarse: false };
  assert.equal(defaultInput(null, phone), 'shake');
  assert.equal(defaultInput(null, desktop), 'gauge', 'desktops have the API but no sensor → gauge first');
  assert.equal(defaultInput('gauge', phone), 'gauge');
  assert.equal(defaultInput('shake', desktop), 'shake');
  assert.equal(defaultInput('shake', { hasMotion: true, secure: false }), 'gauge', 'http → gauge even when preferred');
});

test('acceleration: magnitude without gravity; weak shake → small, strong → big (monotone, clamped)', () => {
  assert.equal(motionMagnitude({ acceleration: { x: 3, y: 4, z: 0 } }), 5);
  assert.ok(Math.abs(motionMagnitude({ acceleration: { x: null, y: null, z: null }, accelerationIncludingGravity: { x: 0, y: 0, z: 9.81 + 6 } }) - 6) < 1e-9);
  assert.equal(motionMagnitude({}), null);
  assert.equal(accelToTarget(0), 1);
  assert.equal(accelToTarget(SHAKE.aMin), 1);
  assert.equal(accelToTarget(SHAKE.aMax), 10);
  assert.equal(accelToTarget(200), 10);
  assert.equal(accelToTarget(NaN), 1);
  let prev = 0;
  for (let a = 0; a <= 40; a += 0.5) {
    const t = accelToTarget(a);
    assert.ok(t >= prev && t >= 1 && t <= 10, `a=${a}`);
    prev = t;
  }
  assert.ok(accelToTarget(7) <= 3, 'a gentle shake is a small number');
  assert.ok(accelToTarget(22) >= 7, 'a hard shake is a big number');
  const hit = new Set();
  for (let a = 0; a <= 40; a += 0.25) hit.add(accelToTarget(a));
  assert.equal(hit.size, 10, 'every number is reachable');
});

test('shake meter: waits for motion, measures ≤ 1.5 s, final when the phone is still', () => {
  const run = (mag, ms) => {
    const m = createShakeMeter();
    let st;
    let t = 0;
    for (let i = 0; i < 5; i++) st = m.feed(0.2, (t += 16)); // resting
    assert.equal(st.phase, 'wait');
    while (t < ms) st = m.feed(mag, (t += 16));
    for (let i = 0; i < 60 && st.phase !== 'done'; i++) st = m.feed(0.1, (t += 16)); // stop
    return st;
  };
  const weak = run(6, 700);
  const strong = run(30, 700);
  assert.equal(weak.phase, 'done');
  assert.equal(strong.phase, 'done');
  assert.ok(weak.target < strong.target, `${weak.target} < ${strong.target}`);
  assert.ok(weak.target <= 4 && strong.target >= 8);
  // never longer than maxMs of shaking
  const m = createShakeMeter();
  let st;
  let t = 0;
  for (; t < 5000 && st?.phase !== 'done'; ) st = m.feed(20, (t += 16));
  assert.equal(st.phase, 'done');
  assert.ok(st.elapsed >= SHAKE.maxMs && st.elapsed < SHAKE.maxMs + 40);
  assert.equal(m.feed(40, t + 16).target, st.target, 'final once done');
  m.reset();
  assert.equal(m.state.phase, 'wait');
});

test('gauge: ping-pong sweep, faster after 3 sweeps (bounded), position → cell 1..10', () => {
  assert.equal(sweepDuration(0), GAUGE.sweepMs);
  assert.equal(sweepDuration(2), GAUGE.sweepMs);
  assert.ok(sweepDuration(3) < GAUGE.sweepMs);
  assert.equal(sweepDuration(100), GAUGE.minSweepMs);
  assert.deepEqual(gaugePosition(0), { pos: 0, sweep: 0, dir: 1 });
  assert.ok(Math.abs(gaugePosition(GAUGE.sweepMs / 2).pos - 0.5) < 1e-9);
  const back = gaugePosition(GAUGE.sweepMs * 1.25);
  assert.equal(back.dir, -1);
  assert.ok(Math.abs(back.pos - 0.75) < 1e-9);
  assert.equal(gaugePosition(GAUGE.sweepMs * 3 + 1).sweep, 3);
  for (let ms = 0; ms < 20000; ms += 37) {
    const { pos } = gaugePosition(ms);
    assert.ok(pos >= 0 && pos <= 1);
  }
  assert.deepEqual([0, 0.05, 0.0999, 0.1, 0.5, 0.95, 0.999, 1, -1, 2].map((p) => gaugeTarget(p)), [1, 1, 1, 2, 6, 10, 10, 10, 1, 10]);
});

test('display + deck + preference helpers', () => {
  assert.equal(isSkillRoom({ config: { rouletteMode: 'skill' } }), true);
  assert.equal(isSkillRoom({ config: {} }), false);
  assert.equal(aimText({ skill: true, target: 7, value: 8 }), '🎯 목표 7 → 결과 8');
  assert.equal(aimText({ skill: true, target: 7, value: 7 }), '🎯 목표 7 → 결과 7 명중!');
  assert.equal(aimText({ skill: true, target: 7, value: 9, rolls: [7, 9] }), '🎯 목표 7 → 결과 7 명중!', 'the first roll (taxi second roll is random)');
  assert.equal(aimText({ value: 7 }), null);
  assert.equal(aimShort({ skill: true, target: 3, value: 5 }), '🎯3→5');
  assert.deepEqual(['hit', 'near', 'miss', null], [aimGrade({ skill: true, target: 4, value: 4 }), aimGrade({ skill: true, target: 4, value: 5 }), aimGrade({ skill: true, target: 4, value: 6 }), aimGrade({ value: 1 })]);
  assert.deepEqual(deckInfo({ aimUsed: [2, 5] }), { deck: true, used: [2, 5], free: [1, 3, 4, 6, 7, 8, 9, 10] });
  assert.deepEqual(deckInfo({ aimUsed: [2] }, { balance: { roulette: { skill: { deck: false } } } }).free.length, 10);
  assert.equal(jitterHint(null), '정확히 50% · ±1 40% · ±2 10%');
  assert.equal(jitterHint({ balance: { roulette: { skill: { jitter: { 0: 0.4, 1: 0.4, 2: 0.2 } } } } }), '정확히 40% · ±1 40% · ±2 20%');
  const mem = new Map();
  const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.equal(loadInputPref(store), null);
  saveInputPref(store, 'shake');
  assert.equal(mem.get(INPUT_KEY), 'shake');
  saveInputPref(store, 'nope');
  assert.equal(loadInputPref(store), 'shake');
  assert.equal(loadInputPref({ getItem: () => { throw new Error('blocked'); } }), null);
  assert.equal(INPUT_KEY, 'jinsei.rouletteInput');
});

test('shared roulette module stays isomorphic (no imports) and the server re-exports it', () => {
  const src = readFileSync(new URL('../public/js/shared/roulette.js', import.meta.url), 'utf8');
  assert.ok(!/^\s*import\s/m.test(src), 'no imports in the shared module');
  const re = readFileSync(new URL('../server/game/roulette.js', import.meta.url), 'utf8');
  assert.match(re, /export \* from '\.\.\/\.\.\/public\/js\/shared\/roulette\.js'/);
});
