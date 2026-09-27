import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gameData, loadData } from '../server/data/index.js';
import { applyAction, startGame } from '../server/game/engine.js';
import { addCharacter, joinRoom } from '../server/game/lobby.js';
import {
  CUTIN_TYPES,
  EMOTIONS,
  EVENT_TYPES,
  SCENES,
  TONES,
  decorateEvents,
  fillLine,
  hashSeed,
  pickLine,
  presentationFor,
} from '../server/game/presentation.js';
import { viewFor } from '../server/game/view.js';
import { SFX_NAMES } from '../public/js/audio.js';
import { makeRoom } from './helpers.js';

const lines = loadData('lines');
const tones = loadData('tones');

function started({ mode = 'kids', seed = 5, eraTurns = { baby: 1, elem: 2, middle: 2, high: 2 } } = {}) {
  let room = makeRoom({ seed });
  room.config = { ...room.config, mode, eraTurns: { ...room.config.eraTurns, ...eraTurns } };
  room = joinRoom(room, 'A', '에이', 0).room;
  room = joinRoom(room, 'B', '비', 0).room;
  for (const [o, n] of [['A', '지우'], ['B', '민준'], ['A', '하은']]) room = addCharacter(room, o, { name: n }, 0).room;
  const r = startGame(room, { now: 0 });
  assert.equal(r.ok, true);
  return r;
}

/** Play a whole game with trusted actions (spin / force timeout); returns every event batch. */
function playAll(seed, mode = 'kids') {
  const r = started({ seed, mode, eraTurns: mode === 'adult' ? { young: 3, middle_age: 3 } : undefined });
  let room = r.room;
  const batches = [r.events];
  for (let i = 0; i < 400 && room.status === 'playing'; i++) {
    const action = room.turn.pending ? { type: 'timeout', force: true } : { type: 'spin', characterId: room.turn.order[room.turn.currentIndex] };
    const res = applyAction(room, action, { now: 1000 + i });
    room = res.room;
    batches.push(res.events);
  }
  assert.equal(room.status, 'finished');
  return { batches, room };
}

test('pickLine: deterministic for the same seed, fills placeholders, null for unknown tags', () => {
  const a = pickLine(lines, 'money_gain', 1234, { name: '지우', amount: '50만원' });
  const b = pickLine(lines, 'money_gain', 1234, { name: '지우', amount: '50만원' });
  assert.equal(a, b);
  assert.ok(lines.tags.money_gain.map((l) => fillLine(l, { name: '지우', amount: '50만원' })).includes(a));
  assert.ok(!/\{name\}|\{amount\}/.test(a));
  const seen = new Set(Array.from({ length: 40 }, (_, i) => pickLine(lines, 'spin', i)));
  assert.ok(seen.size > 3, 'different seeds spread over the pool');
  assert.equal(pickLine(lines, 'no_such_tag', 1), null);
  assert.equal(pickLine(lines, null, 1), null);
  assert.equal(hashSeed(1, 'a'), hashSeed(1, 'a'));
  assert.notEqual(hashSeed(1, 'a'), hashSeed(2, 'a'));
});

test('decorateEvents: same seed → identical presentation (all clients show the same line)', () => {
  const g1 = playAll(11);
  const g2 = playAll(11);
  const strip = (bs) => bs.flat().map((e) => [e.type, e.tone, e.emotion, e.scene, e.line, e.cutin]);
  assert.deepEqual(strip(g1.batches), strip(g2.batches));
  // gameplay stream untouched by line picking: final money matches an undecorated rerun is implied by determinism,
  // and the line sub-RNG never advances the room rngState (ranking is identical run to run)
  assert.deepEqual(g1.room.result.ranking, g2.room.result.ranking);
});

// Bland events never get a speech bubble; plain money / uneventful landings and small money follow-ups rarely do.
const QUIET_TYPES = new Set(['turnStarted', 'spun', 'moved', 'log', 'eraChanged', 'cardLost']);
/** Quiet by rule: per-character eraChanged (the eraTransition speaks), a 찬스 광장 pass / buy / job change result (its
 * follow-up or the buff chip speaks), an expired buff. */
const quietOk = (e) => (e.type === 'promptResolved' && e.kind === 'passTile' && !e.cutin) || (e.type === 'chanceBuff' && e.action === 'expired') || (e.type === 'cardGained' && e.source === 'status');
const MAYBE_QUIET = new Set(['landed', 'moneyChanged']);

test('every emitted event carries tone/emotion/scene/cutin (+ line) from the allowed sets', () => {
  const seenTypes = new Set();
  for (const [seed, mode] of [[3, 'kids'], [8, 'adult'], [21, 'kids'], [34, 'adult']]) {
    for (const e of playAll(seed, mode).batches.flat()) {
      seenTypes.add(e.type);
      assert.ok(EVENT_TYPES.includes(e.type), `unknown event type ${e.type}`);
      assert.ok(TONES.includes(e.tone), `${e.type} tone ${e.tone}`);
      assert.ok(EMOTIONS.includes(e.emotion), `${e.type} emotion ${e.emotion}`);
      assert.ok(SCENES.includes(e.scene), `${e.type} scene ${e.scene}`);
      assert.equal(typeof e.cutin, 'boolean');
      if (e.type === 'chose' || e.type === 'betPlaced') assert.equal(e.line, null);
      else {
        assert.ok(lines.tags[e.lineTag], `line tag ${e.lineTag} exists in lines.json`);
        if (QUIET_TYPES.has(e.type)) assert.equal(e.line, null, `${e.type} never speaks`);
        else if (e.line == null) assert.ok(MAYBE_QUIET.has(e.type) || quietOk(e), `${e.type} has a line`);
        else {
          assert.equal(typeof e.line, 'string', `${e.type} has a line`);
          assert.ok(!/\{\w+\}/.test(e.line), `unfilled placeholder in "${e.line}"`);
        }
      }
    }
  }
  for (const t of ['turnStarted', 'spun', 'moved', 'landed', 'moneyChanged', 'eraTransition', 'eraChanged', 'prompt', 'promptResolved', 'chanceBuff', 'finished', 'gameOver', 'log']) {
    assert.ok(seenTypes.has(t), `simulated games emit ${t}`);
  }
});

test('presentationFor: every event type maps to a tone, scene and emotion (synthetic events)', () => {
  const r = started();
  const room = r.room;
  const c = room.characters[0];
  const samples = {
    gameStarted: {},
    turnStarted: { charId: c.id },
    spun: { charId: c.id, value: 3 },
    moved: { charId: c.id, path: [] },
    landed: { charId: c.id, tileType: 'heart', route: null },
    moneyChanged: { charId: c.id, delta: -30, reason: 'tile', money: 0, debt: 30 },
    eraChanged: { charId: c.id, era: 'elem', eraName: '초등학생' },
    routeChosen: { charId: c.id, route: 'money' },
    finished: { charId: c.id, place: 1, prize: 500 },
    bonusSpin: { charId: c.id, value: 4, amount: 40 },
    betPlaced: { charId: c.id },
    betResolved: { results: [{ charId: c.id, won: false, delta: -10 }] },
    prompt: { charId: c.id, kind: 'groupGift', promptId: 'pr9' },
    chose: { charId: c.id, promptId: 'pr9' },
    promptResolved: { charId: c.id, kind: 'exam', promptId: 'pr9' },
    gameOver: { ranking: [{ charId: c.id, name: c.name }] },
    log: { text: 'x', tone: 'bad', charId: c.id },
    statChanged: { charId: c.id, stat: 'int', delta: 2, value: 5, reason: 'habit' },
    jobChanged: { charId: c.id, jobId: 'doctor', fromJobId: null, rank: 1, reason: 'hire' },
    rankUp: { charId: c.id, jobId: 'doctor', rank: 2, rankName: '레지던트' },
    salary: { charId: c.id, jobId: 'doctor', rank: 2, amount: 300 },
    injured: { charId: c.id, jobId: 'soccer', turns: 2 },
    hiddenJobUnlocked: { charId: c.id, jobId: 'astronaut' },
    newsFlash: { eraId: 'young', newsId: 'job_freeze', title: '취업 한파', text: '…', tone: 'bad' },
    militaryStart: { charId: c.id, turns: 2 },
    militaryEnd: { charId: c.id },
    educationChanged: { charId: c.id, education: 'college' },
    // Stage 7
    cardGained: { charId: c.id, cardId: 'study', uid: 'k1', source: 'tile' },
    cardLost: { charId: c.id, cardId: 'marriage_luck', uid: 'k3', reason: 'married' },
    cardUsed: { charId: c.id, cardId: 'noise', uid: 'k2', cardKind: 'sabotage', targetId: room.characters[1].id },
    cardBlocked: { charId: c.id, targetId: room.characters[1].id, cardId: 'tax_audit', uid: 'k3' },
    itemBought: { charId: c.id, itemId: 'car', price: 300 },
    tradeOffered: { tradeId: 't1', fromId: c.id, toId: room.characters[1].id, give: { money: 10 }, want: { cardUid: 'k4', cardId: 'taxi' } },
    tradeResolved: { tradeId: 't1', fromId: c.id, toId: room.characters[1].id, status: 'accepted' },
    gift: { fromId: c.id, toId: room.characters[1].id, money: 20 },
    holidayStarted: { eraId: 'young', kind: 'seol', name: '설날' },
    holidayResult: { eraId: 'young', kind: 'seol', results: [{ charId: c.id, sebae: 30, nagging: { stat: 'int', delta: 1 }, stake: 0, card: null, won: 0 }], pot: 0, winners: [] },
    lottoDraw: { eraId: 'young', numbers: [1, 2, 3], entries: [{ charId: c.id, numbers: [1, 5, 9], matches: 1, prize: 10 }] },
    // Stage 8
    met: { charId: c.id, partner: { id: 'pt1', name: '서연', trait: 'int', stars: 2, body: 'girl' }, affection: 25, match: false },
    dated: { charId: c.id, partnerId: 'pt1', dateId: 'library', trait: 'int', cost: 20, gain: 30, affection: 55, match: true },
    proposed: { charId: c.id, partnerId: 'pt1', success: false, chance: 0.5 },
    married: { charId: c.id, spouse: { id: 'pt1', name: '서연', trait: 'int', stars: 2, body: 'girl', salary: 70, marriedTurn: 9 }, gifts: [], total: 0 },
    schoolMeet: { eraId: 'high', pairs: [{ charId: c.id, partner: { id: 'pt2', name: '민호' } }] },
    childBorn: { charId: c.id, child: { id: 'ch1', name: '하윤', talent: 'genius', stage: 'baby' } },
    childGrew: { charId: c.id, childId: 'ch1', stage: 'kid', kind: 'dol', amount: 40 },
    allowance: { charId: c.id, childId: 'ch1', amount: 60 },
    houseBought: { charId: c.id, houseId: 'villa', price: 700, tradeIn: 0 },
    houseSold: { charId: c.id, houseId: 'oneroom', value: 300, amount: 210 },
    houseValueChanged: { eraId: 'senior', mult: 1.2, changes: [] },
    // Stage 9
    submapEntered: { charId: c.id, submap: 'temple', tileId: 'senior:main:2' },
    submapResult: { charId: c.id, submap: 'reversal', optionId: 'horse:5', result: 'horseWin', amount: 400 },
    treasureFound: { charId: c.id, uid: 'tr1', treasureId: 'celadon', source: 'tile' },
    mvpVoted: { playerId: 'p1', charId: c.id, changed: false, count: 1 },
    mvpDecided: { charId: c.id, votes: { [c.id]: 2 } },
    // loop maps
    eraTransition: { fromEraId: 'baby', toEraId: 'elem', eraIndex: 1, turns: 3, lap: 18, eraName: '초등학생' },
    chanceBuff: { charId: c.id, buff: { id: 'salaryX2', name: '월급 두 배', icon: '💵', desc: '' }, action: 'gained' },
  };
  assert.deepEqual(Object.keys(samples).sort(), [...EVENT_TYPES].sort());
  for (const type of EVENT_TYPES) {
    const ev = { type, ...samples[type] };
    const p = presentationFor(ev, { events: [ev], index: 0, room, tones, lines, eraOf: () => 'high' });
    assert.ok(TONES.includes(p.tone), type);
    assert.ok(SCENES.includes(p.scene), type);
    assert.ok(EMOTIONS.includes(p.emotion), type);
  }
  const pf = (ev, events = [ev]) => presentationFor(ev, { events, index: 0, room, tones, lines, eraOf: () => 'young' });
  assert.equal(pf({ type: 'routeChosen', charId: c.id, route: 'money' }).tone, 'treasure');
  assert.equal(pf({ type: 'routeChosen', charId: c.id, route: 'love' }).scene, 'wedding-hall');
  assert.equal(pf({ type: 'moneyChanged', charId: c.id, delta: -30, reason: 'tile', money: 0, debt: 30 }).tag, 'debt');
  assert.equal(pf({ type: 'moneyChanged', charId: c.id, delta: 20, reason: 'bet' }).tag, 'bet_win');
  assert.equal(pf({ type: 'eraChanged', charId: c.id, era: 'senior' }).scene, 'mountain-trail');
  assert.equal(pf({ type: 'turnStarted', charId: c.id }).scene, 'office'); // era scene (young)
  assert.equal(pf({ type: 'moneyChanged', charId: c.id, delta: 5, tone: 'money' }).tone, 'treasure'); // alias
  assert.equal(pf({ type: 'log', text: 'x', tone: 'info' }).tone, 'neutral');
});

test('cut-in flags: event-ish tiles, era/route/goal/prompt → cut-in; money/loss tiles stay on the board', () => {
  const r = started();
  const room = r.room;
  const c = room.characters[0];
  const landed = (tileType, extra = []) => {
    const events = [{ type: 'landed', charId: c.id, tileType, tileId: 'x' }, ...extra];
    decorateEvents(events, { room, data: gameData(), seed: 1 });
    return events;
  };
  assert.equal(landed('money', [{ type: 'moneyChanged', charId: c.id, delta: 30, reason: 'tile' }])[0].cutin, false);
  const loss = landed('loss', [{ type: 'moneyChanged', charId: c.id, delta: -30, reason: 'tile', money: 5, debt: 0 }]);
  assert.equal(loss[0].cutin, false);
  assert.equal(loss[0].tone, 'bad');
  assert.equal(loss[1].cutin, false);
  const ev = landed('event', [{ type: 'moneyChanged', charId: c.id, delta: 20, reason: 'event', eventId: 'lucky' }, { type: 'log', text: 'lucky', charId: c.id }]);
  assert.equal(ev[0].cutin, true);
  assert.equal(ev[0].tone, 'good');
  assert.equal(ev[0].scene, tones.eventScenes.lucky);
  for (const t of tones.cutinTiles) if (t !== 'event') assert.equal(landed(t)[0].cutin, true, t);
  // stop tile that opens a prompt: the prompt cut-in replaces the landing one
  const stop = landed('stop', [{ type: 'prompt', charId: c.id, kind: 'exam', promptId: 'p1' }]);
  assert.equal(stop[0].cutin, false);
  assert.equal(stop[1].cutin, true);
  assert.equal(stop[0].scene, 'school');
  for (const type of CUTIN_TYPES) {
    const e = [{ type, charId: c.id, era: 'elem', route: 'love', kind: 'exam', ranking: [] }];
    decorateEvents(e, { room, data: gameData(), seed: 2 });
    assert.equal(e[0].cutin, true, type);
  }
});

test('prompt presentation is copied onto turn.pending (reload-safe) and survives viewFor', () => {
  let room = started({ mode: 'kids', seed: 9, eraTurns: { baby: 1, elem: 1, middle: 1, high: 3 } }).room;
  let prompt = null;
  for (let i = 0; i < 60 && !prompt; i++) {
    const pend = room.turn.pending; // habit tiles / 찬스 광장 / 동아리 open prompts on the way — answer them
    const action = pend
      ? { type: 'choose', characterId: pend.forCharacterIds.find((id) => !Object.hasOwn(pend.answers, id)), promptId: pend.promptId, optionId: pend.options.find((o) => !o.disabled).id }
      : { type: 'spin', characterId: room.turn.order[room.turn.currentIndex] };
    const res = applyAction(room, action, { now: i });
    room = res.room;
    prompt = res.events.find((e) => e.type === 'prompt' && e.kind === 'exam');
  }
  assert.ok(prompt, 'the last high-school turn opens the 수능 prompt');
  const p = room.turn.pending;
  assert.equal(p.promptId, prompt.promptId);
  assert.deepEqual([p.tone, p.scene, p.line, p.cutin], [prompt.tone, prompt.scene, prompt.line, true]);
  assert.equal(p.scene, 'school');
  const v = viewFor(room, 'B').turn.pending;
  assert.equal(v.line, prompt.line);
  // resolution: promptResolved anchor (exam) with pass/fail tone
  const res = applyAction(room, { type: 'choose', characterId: p.charId, promptId: p.promptId, optionId: 'study' }, { now: 99 });
  const pr = res.events.find((e) => e.type === 'promptResolved');
  assert.ok(pr);
  assert.equal(pr.cutin, true);
  assert.ok(['good', 'bad'].includes(pr.tone));
  assert.ok(['exam_elite', 'exam_college', 'exam_fail'].includes(pr.lineTag), pr.lineTag);
  assert.ok(['elite', 'college', 'fail'].includes(pr.result), 'exam result rides on promptResolved');
});

test('lines.json schema: 5–10 반말 lines per tag, valid placeholders, era tags for every era', () => {
  const allowed = new Set(lines.placeholders);
  const tags = Object.entries(lines.tags);
  assert.ok(tags.length >= 20);
  for (const [tag, pool] of tags) {
    assert.match(tag, /^[a-z0-9_]+$/);
    assert.ok(Array.isArray(pool) && pool.length >= 5 && pool.length <= 10, `${tag}: ${pool.length} lines`);
    for (const l of pool) {
      assert.equal(typeof l, 'string');
      assert.ok(l.trim().length > 0 && l.length <= 40, `${tag}: "${l}"`);
      for (const [, k] of l.matchAll(/\{(\w+)\}/g)) assert.ok(allowed.has(k), `${tag}: unknown placeholder {${k}}`);
      assert.ok(!/[{}]/.test(l.replace(/\{\w+\}/g, '')), `${tag}: stray brace in "${l}"`);
    }
  }
  for (const era of loadData('eras').eras) assert.ok(lines.tags[`era_${era.id}`], `era_${era.id}`);
  for (const t of ['spin', 'moved', 'money_gain', 'money_loss', 'era_change', 'route_love', 'route_career', 'route_money', 'goal', 'bonus', 'bet_win', 'bet_lose', 'exam', 'gift', 'pension', 'generic_good', 'generic_bad']) {
    assert.ok(lines.tags[t], `required tag ${t}`);
  }
});

test('tones.json: 8 tones, frames/backgrounds are accepted manifest assets (or CSS/SVG fallbacks), valid sfx', () => {
  const manifest = JSON.parse(readFileSync(new URL('../server/assets/manifest.json', import.meta.url), 'utf8'));
  const accepted = new Map(manifest.items.filter((i) => i.status === 'accepted').map((i) => [i.id, i]));
  assert.deepEqual(Object.keys(tones.tones).sort(), [...TONES].sort());
  for (const [tone, t] of Object.entries(tones.tones)) {
    if (t.frame !== null) {
      const item = accepted.get(t.frame);
      assert.ok(item, `${tone}: frame ${t.frame} is accepted`);
      assert.equal(item.kind, 'frame');
      assert.equal(item.meta.tone, tone);
    }
    for (const k of ['f1', 'f2', 'f3', 'tag', 'chipBg', 'chipInk']) assert.match(t.colors[k], /^#[0-9a-f]{6}$/i, `${tone}.${k}`);
    assert.ok(SFX_NAMES.includes(t.sfx), `${tone}: sfx ${t.sfx}`);
    assert.ok(t.scene === null || SCENES.includes(t.scene));
    assert.ok(t.label && t.icon);
  }
  assert.deepEqual(Object.keys(tones.scenes).sort(), [...SCENES].sort());
  const items = new Map(manifest.items.map((i) => [i.id, i]));
  for (const [scene, s] of Object.entries(tones.scenes)) {
    if (s.bg === null) continue;
    // every scene's bg is a manifest bg item; one that is not accepted yet (Stage 7: drawn by hand, imported
    // later) must have a fallback scene whose bg is accepted
    assert.equal(items.get(s.bg)?.kind, 'bg', `${scene}: ${s.bg}`);
    assert.equal(items.get(s.bg).meta.scene, scene);
    if (!accepted.has(s.bg)) {
      const fb = tones.sceneFallbacks?.[scene];
      assert.ok(fb && accepted.get(tones.scenes[fb]?.bg)?.kind === 'bg', `${scene}: fallback ${fb} is accepted`);
    }
  }
  for (const [scene, fb] of Object.entries(tones.sceneFallbacks ?? {})) assert.ok(SCENES.includes(scene) && SCENES.includes(fb), `${scene} → ${fb}`);
  for (const map of ['eraScenes', 'routeScenes', 'tagScenes', 'eventScenes']) {
    for (const v of Object.values(tones[map])) assert.ok(SCENES.includes(v), `${map}: ${v}`);
  }
  for (const era of loadData('eras').eras) assert.ok(tones.eraScenes[era.id], `eraScenes.${era.id}`);
  for (const k of Object.keys(tones.tagScenes)) assert.ok(lines.tags[k], `tagScenes key ${k} is a line tag`);
  const eventIds = new Set(loadData('events').events.map((e) => e.id));
  for (const k of Object.keys(tones.eventScenes)) assert.ok(eventIds.has(k), `eventScenes.${k}`);
  for (const v of Object.values(tones.sfx)) assert.ok(SFX_NAMES.includes(v), `sfx ${v}`);
  for (const v of Object.values(tones.tileTones)) assert.ok(TONES.includes(v));
});
