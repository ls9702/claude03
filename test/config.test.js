import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRoomConfig, defaultRoomConfig } from '../server/game/config.js';
import { defaultEraTurns, erasForMode, getEras } from '../server/data/index.js';

test('eras.json defaults: 7 eras with Korean names and 3/5/4/5/15/15/6', () => {
  assert.deepEqual(defaultEraTurns(), { baby: 3, elem: 5, middle: 4, high: 5, young: 15, middle_age: 15, senior: 6 });
  assert.deepEqual(
    getEras().eras.map((e) => e.name),
    ['아기', '초등학생', '중학생', '고등학생', '청년', '중년', '노년'],
  );
  assert.equal(erasForMode('lifetime').length, 7);
  assert.deepEqual(erasForMode('kids'), ['baby', 'elem', 'middle', 'high']);
  assert.deepEqual(erasForMode('adult'), ['young', 'middle_age', 'senior']);
  assert.deepEqual(erasForMode('nope'), []);
});

test('empty input yields defaults', () => {
  const r = validateRoomConfig({});
  assert.equal(r.ok, true);
  assert.deepEqual(r.config, defaultRoomConfig());
  assert.equal(r.config.maxCharacters, 8);
  assert.equal(r.config.turnOrder, 'family');
});

test('partial eraTurns merges over defaults', () => {
  const r = validateRoomConfig({ mode: 'kids', eraTurns: { baby: 1, high: 40 } });
  assert.equal(r.ok, true);
  assert.equal(r.config.mode, 'kids');
  assert.equal(r.config.eraTurns.baby, 1);
  assert.equal(r.config.eraTurns.high, 40);
  assert.equal(r.config.eraTurns.young, 15);
});

test('eraTurns must be integers 1..40 for known eras', () => {
  for (const bad of [0, 41, 2.5, '5', null, -1]) {
    const r = validateRoomConfig({ eraTurns: { elem: bad } });
    assert.equal(r.ok, false, `value ${bad} should fail`);
    assert.match(r.errors[0], /초등학생/);
  }
  assert.equal(validateRoomConfig({ eraTurns: { unknown: 3 } }).ok, false);
  assert.equal(validateRoomConfig({ eraTurns: [1, 2] }).ok, false);
});

test('maxCharacters 2..8, mode, turnOrder, allowCpu, startingMoney', () => {
  assert.equal(validateRoomConfig({ maxCharacters: 1 }).ok, false);
  assert.equal(validateRoomConfig({ maxCharacters: 9 }).ok, false);
  assert.equal(validateRoomConfig({ maxCharacters: 2 }).ok, true);
  assert.equal(validateRoomConfig({ maxCharacters: 8 }).ok, true);
  assert.equal(validateRoomConfig({ mode: 'hard' }).ok, false);
  assert.equal(validateRoomConfig({ turnOrder: 'random' }).ok, false);
  assert.equal(validateRoomConfig({ turnOrder: 'index' }).config.turnOrder, 'index');
  assert.equal(validateRoomConfig({ allowCpu: 'yes' }).ok, false);
  assert.equal(validateRoomConfig({ startingMoney: -5 }).ok, false);
  assert.equal(validateRoomConfig(null).ok, false);
  const multi = validateRoomConfig({ maxCharacters: 99, mode: 'x' });
  assert.equal(multi.errors.length, 2);
});
