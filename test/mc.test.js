// Stage 5.6 — MC NPCs 호야 & 봄이: data schema, line pools, engine attachment (determinism, frequency,
// cooldown), config, manifest items + local photo refs, and the pure SVG renderer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { gameData, loadData } from '../server/data/index.js';
import { applyAction, startGame } from '../server/game/engine.js';
import { addCharacter, joinRoom } from '../server/game/lobby.js';
import { MC_FREQUENCIES, MC_EXPRESSIONS, MC_POSES, attachMc, pickMcLines } from '../server/game/presentation.js';
import { createRng } from '../server/game/rng.js';
import { validateRoomConfig } from '../server/game/config.js';
import { getItem, loadManifest, localRefName, localRefPath, validateItem, validateManifest } from '../server/assets/manifest.js';
import { createStudio } from '../server/assets/studio.js';
import { startServer } from '../server/index.js';
import { mcItems, upsertMcItems } from '../scripts/gen-mc-manifest.js';
import { MC_IDS, mcArt, mcLinesFrom, mcSvg, resultMcFrom } from '../public/js/ui/mc.js';
import { planCutins } from '../public/js/ui/cutinMap.js';
import { mascotSpecs } from '../public/js/scene/mascotParts.js';
import { buildMascotGeometry } from '../public/js/scene/mascots.js';
import { SFX_NAMES } from '../public/js/audio.js';
import { makeRoom, tempDir } from './helpers.js';
import { fakeGeminiFetch, tempManifest } from './assetFixtures.js';

const mc = loadData('mc');
const lines = loadData('lines');
const eras = loadData('eras');
const HEX = /^#[0-9a-f]{6}$/i;

function started({ seed = 5, mode = 'kids', mcFrequency, eraTurns } = {}) {
  let room = makeRoom({ seed });
  const turns = eraTurns ?? (mode === 'adult' ? { young: 4, middle_age: 4, senior: 2 } : { baby: 1, elem: 2, middle: 2, high: 2 });
  room.config = { ...room.config, mode, eraTurns: { ...room.config.eraTurns, ...turns }, ...(mcFrequency ? { mcFrequency } : {}) };
  room = joinRoom(room, 'A', '에이', 0).room;
  room = joinRoom(room, 'B', '비', 0).room;
  for (const [o, n] of [['A', '지우'], ['B', '민준'], ['A', '하은']]) room = addCharacter(room, o, { name: n }, 0).room;
  const r = startGame(room, { now: 0 });
  assert.equal(r.ok, true);
  return r;
}

function playAll(opts = {}) {
  const r = started(opts);
  let room = r.room;
  const batches = [r.events];
  for (let i = 0; i < 400 && room.status === 'playing'; i++) {
    const action = room.turn.pending ? { type: 'timeout', force: true } : { type: 'spin', characterId: room.turn.order[room.turn.currentIndex] };
    const res = applyAction(room, action, { now: 1000 + i });
    room = res.room;
    batches.push(res.events);
  }
  assert.equal(room.status, 'finished');
  return { events: batches.flat(), room };
}

// ---------- data ----------

test('mc.json: two profiles with the PLAN roles, colours, expressions/poses, frequency table, situations', () => {
  assert.deepEqual(mc.order, ['hoya', 'bomi']);
  assert.deepEqual(mc.expressions, MC_EXPRESSIONS);
  assert.deepEqual(mc.poses, MC_POSES);
  assert.deepEqual(mc.expressions, ['neutral', 'joy', 'surprise', 'sad', 'angry', 'proud', 'sleepy']);
  assert.deepEqual(mc.poses, ['idle', 'wave', 'clap', 'mic']);
  assert.equal(mc.profiles.hoya.name, '호야');
  assert.equal(mc.profiles.bomi.name, '봄이');
  assert.match(mc.profiles.hoya.role, /리액션/);
  assert.match(mc.profiles.bomi.role, /진행/);
  for (const id of mc.order) {
    const p = mc.profiles[id];
    assert.equal(p.id, id);
    for (const k of ['name', 'role', 'personality', 'speech', 'looks']) assert.ok(typeof p[k] === 'string' && p[k].length > 1, `${id}.${k}`);
    for (const [k, v] of Object.entries(p.colors)) assert.match(v, HEX, `${id}.colors.${k}`);
  }
  assert.deepEqual(Object.keys(mc.frequency).sort(), [...MC_FREQUENCIES].sort());
  for (const [k, f] of Object.entries(mc.frequency)) {
    assert.ok(f.label && f.medium >= 0 && f.medium <= 1 && f.minor >= 0 && f.minor <= 1 && Number.isInteger(f.cooldown), k);
  }
  assert.ok(mc.frequency.many.medium >= mc.frequency.normal.medium && mc.frequency.normal.medium >= mc.frequency.few.medium);
  assert.equal(mc.frequency.off.medium + mc.frequency.off.minor, 0);
  const placeholders = new Set(lines.placeholders);
  for (const [key, s] of Object.entries(mc.situations)) {
    assert.ok(['big', 'medium', 'minor'].includes(s.weight), key);
    assert.ok(['hoya', 'bomi', 'any'].includes(s.lead), key);
    assert.ok([true, false, 'chance'].includes(s.duo), key);
    for (const v of s.vars) assert.ok(placeholders.has(v), `${key}: var ${v}`);
    for (const id of mc.order) {
      assert.ok(MC_EXPRESSIONS.includes(s[id].expression), `${key}.${id}.expression`);
      assert.ok(MC_POSES.includes(s[id].pose), `${key}.${id}.pose`);
    }
  }
  for (const e of eras.eras) assert.ok(mc.situations[mc.eraSituations[e.id]], `era ${e.id}`);
  for (const k of Object.values(mc.tileSituations)) assert.ok(mc.situations[k], k);
  for (const k of ['gameStart', 'firstSpin', 'routeChoice', 'marriage', 'birth', 'job', 'bankrupt', 'treasure', 'bigWin', 'bigLoss', 'goalFirst', 'goalLast', 'betWin', 'pension', 'resultIntro', 'resultWinner', 'resultLast', 'penalty']) {
    assert.ok(mc.situations[k], `situation ${k}`);
  }
});

test('lines.json mc pools: ≥6 lines per speaker and ≥6 duo dialogues (2–3 lines, both MCs) per situation', () => {
  assert.deepEqual(Object.keys(lines.mc).sort(), Object.keys(mc.situations).sort());
  const text = (e) => (typeof e === 'string' ? e : e.t);
  const check = (key, e, speaker) => {
    const t = text(e);
    assert.equal(typeof t, 'string');
    assert.ok(t.trim().length > 0 && t.length <= 48, `${key}: "${t}"`);
    for (const [, k] of t.matchAll(/\{(\w+)\}/g)) assert.ok(mc.situations[key].vars.includes(k), `${key}: {${k}} not in vars`);
    assert.ok(!/[{}]/.test(t.replace(/\{\w+\}/g, '')), `${key}: stray brace`);
    if (typeof e === 'object') {
      if (e.e !== undefined) assert.ok(MC_EXPRESSIONS.includes(e.e), `${key}: expression ${e.e}`);
      if (e.p !== undefined) assert.ok(MC_POSES.includes(e.p), `${key}: pose ${e.p}`);
      if (speaker) assert.equal(e.s ?? speaker, speaker);
    }
  };
  for (const [key, pool] of Object.entries(lines.mc)) {
    for (const id of MC_IDS) {
      assert.ok(pool[id].length >= 6, `${key}.${id}: ${pool[id].length}`);
      for (const e of pool[id]) check(key, e);
    }
    // voices: 호야 barks "~멍", 봄이 never does
    for (const e of pool.hoya) assert.match(text(e), /멍/, `${key} hoya: "${text(e)}"`);
    for (const e of pool.bomi) assert.doesNotMatch(text(e).replace(/'[^']*'/g, ''), /멍[!~]/, `${key} bomi: "${text(e)}"`); // quotes aside
    assert.ok(pool.duo.length >= 6, `${key}.duo: ${pool.duo.length}`);
    for (const d of pool.duo) {
      assert.ok(Array.isArray(d) && d.length >= 2 && d.length <= 3, `${key}: duo length`);
      assert.deepEqual([...new Set(d.map((l) => l.s))].sort(), ['bomi', 'hoya'], `${key}: duo has both MCs`);
      for (const l of d) check(key, l, l.s);
    }
  }
});

// ---------- engine ----------

test('MC attachment is deterministic and never touches the gameplay RNG', () => {
  const strip = (evs) => evs.map((e) => [e.type, e.mcKey ?? null, JSON.stringify(e.mc ?? null)]);
  const a = playAll({ seed: 11 });
  const b = playAll({ seed: 11 });
  assert.deepEqual(strip(a.events), strip(b.events));
  const off = playAll({ seed: 11, mcFrequency: 'off' });
  const many = playAll({ seed: 11, mcFrequency: 'many' });
  // same outcome whatever the MC setting (sub-RNG only)
  assert.deepEqual(off.room.result.ranking, a.room.result.ranking);
  assert.deepEqual(many.room.result.ranking, a.room.result.ranking);
  assert.equal(off.room.rngState, many.room.rngState);
  assert.deepEqual(off.events.map((e) => e.line), many.events.map((e) => e.line));
});

test('MC lines: valid shape, no unfilled placeholders; big moments always hosted; off = none', () => {
  for (const [seed, mode] of [[3, 'kids'], [8, 'adult'], [21, 'kids']]) {
    for (const f of ['few', 'normal', 'many']) {
      const { events, room } = playAll({ seed, mode, mcFrequency: f });
      for (const e of events.filter((x) => x.mc)) {
        assert.ok(e.mc.length >= 1 && e.mc.length <= (e.type === 'gameOver' ? 16 : 8), `${e.type} mc length`); // Stage 9: the result show has up to 7 parts
        assert.ok(['big', 'medium', 'minor'].includes(e.mcWeight));
        for (const l of e.mc) {
          assert.ok(MC_IDS.includes(l.speaker));
          assert.ok(MC_EXPRESSIONS.includes(l.expression) && MC_POSES.includes(l.pose), JSON.stringify(l));
          assert.ok(l.line && !/\{\w+\}/.test(l.line), `unfilled "${l.line}"`);
        }
      }
      const start = events.find((e) => e.type === 'gameStarted');
      assert.ok(start.mc?.length >= 2 && start.mcStudio, `${f}: game start studio duo`);
      assert.equal(events.find((e) => e.type === 'turnStarted').mcKey, 'firstSpin');
      const first = events.find((e) => e.type === 'finished' && e.place === 1);
      assert.equal(first.mcKey, 'goalFirst');
      // every era after the first opens with a studio cut-in exactly once
      const studios = events.filter((e) => e.type === 'eraChanged' && e.mcStudio).map((e) => e.era);
      assert.deepEqual(studios, room.board.eras.slice(1).map((x) => x.id));
      const go = events.find((e) => e.type === 'gameOver');
      // Stage 9: 보물 감정 / 특별상 parts when there is something to show, the MVP call while the vote is open
      const parts = [...new Set(go.mc.map((l) => l.part))];
      const want = ['intro', ...(go.treasures?.length ? ['appraisal'] : []), ...(go.awards?.length ? ['awards'] : []), 'winner', 'last', 'penalty', ...(go.mvpClosesAt != null ? ['mvp'] : [])];
      assert.deepEqual(parts, want);
      assert.deepEqual(room.result.mc, go.mc, 'result show is reload-safe');
    }
    const off = playAll({ seed, mode, mcFrequency: 'off' });
    assert.equal(off.events.filter((e) => e.mc || e.mcStudio).length, 0);
    assert.equal(off.room.result.mc, undefined);
  }
});

test('MC frequency: many ≥ normal ≥ few for optional appearances; cooldown skips consecutive minor events', () => {
  const count = (f) => {
    let n = 0;
    for (const seed of [2, 4, 6, 9]) n += playAll({ seed, mode: 'adult', mcFrequency: f }).events.filter((e) => e.mc && e.mcWeight !== 'big').length;
    return n;
  };
  const many = count('many');
  const normal = count('normal');
  const few = count('few');
  assert.ok(many >= normal && normal >= few, `many ${many} normal ${normal} few ${few}`);
  assert.ok(many > few);

  // synthetic: a long run of small money landings (minor) → never two MC appearances in a row
  const r = started({ mcFrequency: 'many' });
  const room = structuredClone(r.room);
  room.mcState = { cool: 0, eras: ['baby'], firstSpin: true };
  const c = room.characters[0].id;
  const events = [];
  for (let i = 0; i < 40; i++) events.push({ type: 'landed', charId: c, tileType: 'money', tileId: `x${i}` }, { type: 'moneyChanged', charId: c, delta: 10, reason: 'tile', money: 100, debt: 0 });
  attachMc(events, { room, data: gameData(), seed: 77 });
  const hits = events.map((e, i) => (e.mc ? i : -1)).filter((i) => i >= 0);
  assert.ok(hits.length >= 3, `some minor appearances (${hits.length})`);
  for (let k = 1; k < hits.length; k++) assert.ok(hits[k] - hits[k - 1] > 2, 'cooldown: never on consecutive minor events');
  for (const i of hits) assert.equal(events[i].mcKey, 'smallWin');
  // a big event right after is still hosted (cooldown only applies to optional ones)
  const big = [
    { type: 'landed', charId: c, tileType: 'money', tileId: 't' },
    { type: 'moneyChanged', charId: c, delta: 500, reason: 'tile', money: 900, debt: 0 },
  ];
  room.mcState.cool = 5;
  attachMc(big, { room, data: gameData(), seed: 1 });
  assert.equal(big[0].mcKey, 'bigWin');
  assert.ok(big[0].mc.length >= 1);
});

test('MC guard: placeholder tiles never produce marriage/treasure celebrations; job MC only on real hires', () => {
  const r = started({ mcFrequency: 'many' });
  const placeholders = Object.keys(gameData().board.placeholders);
  assert.ok(!placeholders.includes('treasure'), 'Stage 9: treasure tiles are live');
  assert.ok(!placeholders.includes('job'), 'Stage 6: job tiles are live');
  assert.ok(!placeholders.includes('heart') && !placeholders.includes('house'), 'Stage 8: heart / house tiles are live');
  const c = r.room.characters[0].id;
  // even if tileSituations maps them again later, a tile type still listed as a placeholder stays quiet
  const data = { ...gameData(), mc: { ...mc, tileSituations: { heart: 'marriage', treasure: 'treasure' } } };
  for (const seed of [1, 2, 3, 4, 5]) {
    for (const tileType of [...placeholders, 'treasure', 'job', 'heart', 'house']) {
      const room = structuredClone(r.room);
      room.mcState = { cool: 0, eras: ['baby'], firstSpin: true };
      const events = [{ type: 'landed', charId: c, tileType, tileId: `x-${tileType}` }, { type: 'log', text: '준비 중', tone: 'info', charId: c }];
      attachMc(events, { room, data: placeholders.includes(tileType) ? data : gameData(), seed });
      assert.ok(!['marriage', 'job', 'treasure', 'birth', 'promotion', 'house', 'market'].includes(events[0].mcKey), `${tileType} → ${events[0].mcKey}`);
    }
  }
  // full games: treasure MC only on a real find (Stage 9); 'job' only on a real hire; Stage 8 MC only on real outcomes
  for (const seed of [2, 4]) {
    const events = playAll({ seed, mode: 'adult', mcFrequency: 'many' }).events;
    const origin = {
      marriage: 'married', birth: 'childBorn', house: 'houseBought', market: 'houseValueChanged', proposeFail: 'proposed', schoolMeet: 'schoolMeet',
      treasure: 'treasureFound', temple: 'submapResult', jeju: 'submapResult', reversalWin: 'submapResult', reversalLose: 'submapResult', mvp: 'mvpDecided',
    };
    for (const e of events.filter((x) => origin[x.mcKey])) assert.equal(e.type, origin[e.mcKey], e.mcKey);
    for (const e of events.filter((x) => x.mcKey === 'job')) assert.deepEqual([e.type, e.reason], ['jobChanged', 'hire']);
    for (const e of events.filter((x) => x.mcKey === 'promotion')) assert.equal(e.type, 'rankUp');
  }
});

test('pickMcLines: duo keeps speaker order; singles follow the lead; per-line expression overrides', () => {
  const data = { lines, mc };
  const duo = pickMcLines(data, 'gameStart', createRng(5), { duo: true });
  assert.ok(duo.length >= 2 && new Set(duo.map((l) => l.speaker)).size === 2);
  const single = pickMcLines(data, 'firstSpin', createRng(9), { vars: { name: '지우' } });
  assert.equal(single.length, 1);
  assert.equal(single[0].speaker, 'bomi'); // lead
  assert.ok(!single[0].line.includes('{'));
  assert.equal(pickMcLines(data, 'nope', createRng(1)).length, 0);
});

test('config: mcFrequency many|normal|few|off (default normal)', () => {
  assert.equal(validateRoomConfig({}).config.mcFrequency, 'normal');
  for (const f of ['many', 'normal', 'few', 'off']) assert.equal(validateRoomConfig({ mcFrequency: f }).config.mcFrequency, f);
  for (const bad of ['always', '', 3, null]) {
    const r = validateRoomConfig({ mcFrequency: bad });
    assert.equal(r.ok, false);
    assert.match(r.errors[0], /MC 등장 빈도/);
  }
});

// ---------- client pure bits ----------

test('planCutins carries MC lines (studio anchors vs. small corner lines)', () => {
  const l = [{ speaker: 'bomi', line: 'x', expression: 'neutral', pose: 'mic' }];
  const g = planCutins([
    { type: 'eraChanged', charId: 'c1', era: 'senior', cutin: true, mc: l, mcStudio: true },
    { type: 'moneyChanged', charId: 'c1', delta: 200, reason: 'pension', mc: [{ ...l[0], line: 'y' }] },
    { type: 'landed', charId: 'c2', tileType: 'job', cutin: true, mc: l },
  ]);
  assert.equal(g[0].studio, l);
  assert.equal(g[0].mc[0].line, 'y');
  assert.equal(g[0].mcEvents.length, 2);
  assert.equal(g[1].mc, l);
  assert.equal(g[1].studio, null);
});

test('client line picking (lobby greeting / result fallback) mirrors the pools', () => {
  const meta = { ...mc, lines: lines.mc };
  const a = mcLinesFrom(meta, 'gameStart', { duo: true, seed: 'room1' });
  assert.deepEqual(a, mcLinesFrom(meta, 'gameStart', { duo: true, seed: 'room1' }));
  assert.ok(a.length >= 2);
  const r = resultMcFrom(meta, [{ name: '지우', total: 900 }, { name: '민준', total: 100 }], { seed: 3 });
  assert.deepEqual([...new Set(r.map((x) => x.part))], ['intro', 'winner', 'last', 'penalty']);
  assert.ok(r.every((x) => !/\{\w+\}/.test(x.line)));
});

test('SVG dogs: distinct markup for every expression and pose, per dog; art only when a set is accepted', () => {
  const norm = (s) => s.replace(/mc\d+-/g, 'ID-').replace(/data-(expression|pose)="\w+"/g, '').replace(/aria-label="[^"]*"/, '');
  for (const id of MC_IDS) {
    const seen = new Map();
    for (const expression of MC_EXPRESSIONS) {
      const svg = mcSvg(id, { expression, uid: 1 });
      assert.match(svg, /^<svg class="mc-svg"/);
      assert.match(svg, /class="mc-tail"/);
      assert.match(svg, /class="mc-ear-l"/);
      const k = norm(svg);
      assert.ok(!seen.has(k), `${id}: ${expression} looks like ${seen.get(k)}`);
      seen.set(k, expression);
    }
    for (const pose of MC_POSES.filter((p) => p !== 'idle')) {
      const k = norm(mcSvg(id, { pose, uid: 1 }));
      assert.ok(!seen.has(k), `${id}: pose ${pose} looks like ${seen.get(k)}`);
      seen.set(k, pose);
    }
  }
  assert.notEqual(norm(mcSvg('hoya', { uid: 1 })), norm(mcSvg('bomi', { uid: 1 })));
  // markings: 봄이 has the white blaze + black mask, 호야 the tongue tip and tan eye patches
  assert.match(mcSvg('bomi', { uid: 1 }), /#1f1d21/);
  assert.match(mcSvg('hoya', { uid: 1 }), /#f28ca0/);
  assert.notEqual(mcSvg('hoya').match(/id="(mc\d+)-fur"/)[1], mcSvg('hoya').match(/id="(mc\d+)-fur"/)[1], 'unique gradient ids per call');
  // generated art: none accepted → null; neutral accepted → pose > expression > neutral
  const idx = {
    n: { kind: 'mc', meta: { mc: 'hoya', expression: 'neutral' }, url: '/n' },
    j: { kind: 'mc', meta: { mc: 'hoya', expression: 'joy' }, url: '/j' },
    w: { kind: 'mc', meta: { mc: 'hoya', pose: 'wave' }, url: '/w' },
  };
  const find = ({ kind, ...meta }) => Object.values(idx).find((a) => a.kind === kind && Object.entries(meta).every(([k, v]) => a.meta[k] === v)) ?? null;
  assert.equal(mcArt('bomi', { expression: 'joy' }, find), null);
  assert.equal(mcArt('hoya', { expression: 'joy', pose: 'wave' }, find).url, '/w');
  assert.equal(mcArt('hoya', { expression: 'joy' }, find).url, '/j');
  assert.equal(mcArt('hoya', { expression: 'sad', pose: 'clap' }, find).url, '/n');
});

test('3D mascots: ≤1.5k triangles per dog, markings as vertex colours, 3 meshes each', () => {
  for (const id of MC_IDS) {
    const g = buildMascotGeometry(id);
    assert.ok(g.triangles <= 1500, `${id}: ${g.triangles} triangles`);
    const s = mascotSpecs(id);
    assert.ok(s.body.length && s.head.length && s.tail.length);
    for (const p of [...s.body, ...s.head, ...s.tail]) assert.match(p.color, HEX);
  }
  const colors = (id) => new Set(Object.values(mascotSpecs(id)).flat().map((p) => p.color));
  assert.ok(colors('bomi').has('#1f1d21') && !colors('hoya').has('#1f1d21'));
  assert.ok(SFX_NAMES.includes('bark'));
});

// ---------- assets ----------

test('manifest: mc kind items for both dogs (7 expressions + 3 poses), duo, studio bg; local refs validated', async () => {
  const m = await loadManifest();
  assert.equal(validateManifest(m).ok, true);
  for (const dog of ['hoya', 'bomi']) {
    for (const e of MC_EXPRESSIONS) {
      const it = getItem(m, `mc-${dog}-${e}`);
      assert.equal(it?.kind, 'mc', `mc-${dog}-${e}`);
      assert.deepEqual(it.meta, { mc: dog, expression: e });
      assert.ok(it.refs.includes('style-anchor'));
      assert.ok(it.localRefs.length >= 1 && it.localRefs.every((r) => r.startsWith(`data/mc-refs/${dog}-`)));
      assert.ok(it.postprocess.includes('chromaKey'));
    }
    for (const p of ['wave', 'clap', 'mic']) assert.deepEqual(getItem(m, `mc-${dog}-pose-${p}`)?.meta, { mc: dog, pose: p });
  }
  assert.deepEqual(getItem(m, 'mc-duo').meta, { mc: 'duo' });
  assert.equal(getItem(m, 'bg-studio').meta.scene, 'studio');
  assert.match(getItem(m, 'mc-bomi-neutral').vars.dog, /white blaze/);
  assert.match(getItem(m, 'mc-hoya-neutral').vars.dog, /tongue/);
  // the generator is idempotent
  const again = upsertMcItems(structuredClone(m));
  assert.equal(again.added, 0);
  assert.equal(again.updated, 0);
  assert.equal(mcItems().length, 22);

  const base = getItem(m, 'mc-hoya-joy');
  for (const bad of ['../secrets.json', 'data/mc-refs/../secrets.json', 'mc-refs/sub/x.jpg', '/etc/passwd', 'data/mc-refs/x.txt', 'data/other/x.jpg', 'mc-refs\\x.jpg']) {
    assert.equal(localRefName(bad), null, bad);
    assert.ok(validateItem({ ...base, localRefs: [bad] }).some((e) => /localRefs/.test(e)), bad);
    assert.throws(() => localRefPath('/tmp/d', bad));
  }
  assert.equal(localRefPath('/tmp/d', 'data/mc-refs/hoya-1.jpg'), path.join('/tmp/d', 'mc-refs', 'hoya-1.jpg'));
  assert.ok(validateItem({ ...base, meta: { mc: 'hoya', expression: 'joy', pose: 'wave' } }).length > 0, 'expression xor pose');
  assert.ok(validateItem({ ...base, meta: { mc: 'cat', expression: 'joy' } }).length > 0);
});

test('studio: localRefs are read from DATA_DIR/mc-refs at generation time (contained), never published', async (t) => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dataDir = path.join(tmp.dir, 'data');
  const outputDir = path.join(tmp.dir, 'generated');
  const manifestPath = await tempManifest(path.join(tmp.dir, 'm'), ['style-anchor', 'mc-hoya-neutral', 'mc-bomi-neutral']);
  const fetchImpl = fakeGeminiFetch();
  const studio = createStudio({ dataDir, manifestPath, outputDir, fetchImpl, env: { GEMINI_API_KEY: 'AIzaSyTESTKEY_mc_0123456789abcdef' } });
  await studio.generateCandidates('style-anchor', { count: 1 });
  await studio.accept('style-anchor', 1);
  // photos missing → 409 before any API call
  const before = fetchImpl.calls.length;
  await assert.rejects(studio.generateCandidates('mc-hoya-neutral', { count: 1 }), { status: 409, code: 'LOCAL_REF_MISSING' });
  assert.equal(fetchImpl.calls.length, before);
  const refsDir = path.join(dataDir, 'mc-refs');
  await mkdir(refsDir, { recursive: true });
  const photo = await sharp({ create: { width: 64, height: 80, channels: 3, background: '#f4efe6' } }).jpeg().toBuffer();
  await writeFile(path.join(refsDir, 'hoya-1.jpg'), photo);
  await writeFile(path.join(refsDir, 'hoya-2.jpg'), photo);
  const r = await studio.generateCandidates('mc-hoya-neutral', { count: 1 });
  assert.deepEqual(r.errors, []);
  const call = fetchImpl.calls.at(-1);
  assert.equal(call.refs, 3, 'style anchor + 2 photos');
  assert.ok(call.body.contents[0].parts.filter((p) => p.inlineData?.mimeType === 'image/jpeg').length === 2);
  // a symlink pointing outside mc-refs is refused
  await writeFile(path.join(tmp.dir, 'secret.jpg'), photo);
  await symlink(path.join(tmp.dir, 'secret.jpg'), path.join(refsDir, 'bomi-1.jpg'));
  await writeFile(path.join(refsDir, 'bomi-2.jpg'), photo);
  await assert.rejects(studio.generateCandidates('mc-bomi-neutral', { count: 1 }), { code: 'LOCAL_REF_INVALID' });
  // published index never mentions the photos
  await studio.accept('mc-hoya-neutral', 1);
  const idx = await studio.publicIndex();
  assert.ok(idx.assets['mc-hoya-neutral'].url.startsWith('/assets/generated/mc/hoya/neutral.png'));
  assert.doesNotMatch(JSON.stringify(idx), /mc-refs|hoya-1\.jpg/);

  // and the HTTP server never serves DATA_DIR (photos stay private)
  const srv = await startServer({ port: 0, host: '127.0.0.1', dataDir, adminPassword: 'pw', debounceMs: 10, log: () => {} });
  t.after(() => srv.close());
  for (const p of ['/mc-refs/hoya-1.jpg', '/data/mc-refs/hoya-1.jpg', '/assets/generated/../../data/mc-refs/hoya-1.jpg', '/assets/%2e%2e/%2e%2e/data/mc-refs/hoya-1.jpg']) {
    const res = await fetch(srv.url + p);
    const body = Buffer.from(await res.arrayBuffer());
    assert.ok(res.status === 404 || !body.equals(photo), `${p} → ${res.status}`);
    assert.ok(!body.equals(photo), `${p} leaked the photo`);
  }
});
