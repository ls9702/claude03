// Client format helpers added by the post-5.6 verification fixes: grapheme-aware name length (server
// NAME_MAX = 12) and the server clock offset used by deadline countdowns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAME_MAX, clampName, clockBounds, graphemes, nameFits, nameLength, secondsLeft } from '../public/js/format.js';

test('nameLength counts graphemes (emoji / Hangul), clampName never splits one', () => {
  assert.equal(NAME_MAX, 12);
  assert.equal(nameLength('가나다라마바사아자차카타'), 12);
  assert.equal(nameLength('🐶🐱🐰'), 3);
  assert.equal(nameLength('👨‍👩‍👧'), 1); // ZWJ family = one grapheme
  assert.equal(nameLength(''), 0);
  assert.equal(nameLength(null), 0);
  assert.deepEqual(graphemes('a🐶b'), ['a', '🐶', 'b']);
  assert.equal(clampName('가나다라마바사아자차카타파하'), '가나다라마바사아자차카타');
  assert.equal(clampName('🐶'.repeat(14)), '🐶'.repeat(12));
  assert.equal(clampName('짧은 이름'), '짧은 이름');
});

test('nameFits = within 12 graphemes AND the server code-point count', () => {
  assert.equal(nameFits('가나다라마바사아자차카타'), true);
  assert.equal(nameFits('열두글자이름입니다아아'), true);
  assert.equal(nameFits('가나다라마바사아자차카타파'), false);
  assert.equal(nameFits('🐶🐱🐰'), true);
  // 4 ZWJ families = 4 graphemes but 20 code points → the server would refuse it
  assert.equal(nameFits('👨‍👩‍👧'.repeat(4)), false);
});

test('clockBounds narrows the server−local offset from HTTP Date headers', () => {
  // server is 5 s ahead; Date header has 1 s resolution
  const server = (local) => local + 5000;
  let b = null;
  for (const [sent, rtt] of [
    [1_000_000, 40],
    [1_003_300, 25],
    [1_007_650, 60],
    [1_009_990, 30],
  ]) {
    const recv = sent + rtt;
    const genLocal = sent + rtt / 2;
    const date = Math.floor(server(genLocal) / 1000) * 1000;
    b = clockBounds(b, { date, sentAt: sent, receivedAt: recv });
  }
  assert.ok(b.lo <= 5000 && b.hi >= 5000, JSON.stringify(b));
  assert.ok(Math.abs(b.offset - 5000) <= 500, JSON.stringify(b));
  // header strings work, garbage keeps the previous bounds
  const s = clockBounds(null, { date: new Date(2_000_000_000_000).toUTCString(), sentAt: 2_000_000_000_000, receivedAt: 2_000_000_000_010 });
  assert.ok(Math.abs(s.offset) <= 1000);
  assert.deepEqual(clockBounds(b, { date: 'nope', sentAt: 1, receivedAt: 2 }), b);
});

test('secondsLeft uses the server offset and never goes negative', () => {
  assert.equal(secondsLeft(10_000, 0), 10);
  assert.equal(secondsLeft(10_000, 0, 4_000), 6); // server is 4 s ahead
  assert.equal(secondsLeft(10_000, 20_000), 0);
  assert.equal(secondsLeft(10_500, 10_000), 1);
});
