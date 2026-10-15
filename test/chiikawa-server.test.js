// CH-1 (Chiikawa conversion) — server: roster / props / npcs / pets data, the avatar model {character, props} + sanitize,
// the deterministic migration of old human avatars (characters, candidates, partners, spouses, children → roster / NPC
// friends / pets) at load / applyAction / lobby, gender-free rules (military, partners), pets, the Korean wording grep
// over server/data + server/game, /api/meta additions and random games with roster looks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gameData, loadData } from '../server/data/index.js';
import {
  ACCESSORY_PROPS,
  PROP_SLOTS,
  isHumanAvatar,
  migrateRoomLooks,
  randomLook,
  sanitizeAvatar,
  sanitizeNpcLook,
  sanitizePetLook,
} from '../server/game/avatar.js';
import { applyAction, startGame } from '../server/game/engine.js';
import { createTx } from '../server/game/effects.js';
import { bearChild, makePartner } from '../server/game/family.js';
import { militaryMandatory, militaryVolunteer } from '../server/game/growth.js';
import { addCharacter, addCpuCharacter, joinRoom } from '../server/game/lobby.js';
import { resolvePrompt } from '../server/game/prompts.js';
import { resolveTile } from '../server/game/spaces.js';
import { createRng } from '../server/game/rng.js';
import { cpuDecide } from '../server/game/cpu.js';
import { RoomStore } from '../server/store/roomStore.js';
import { startServer } from '../server/index.js';
import { httpCall, makeRoom, tempDir } from './helpers.js';

const data = gameData();
const ROSTER_IDS = ['chiikawa', 'hachiware', 'usagi', 'momonga', 'kurimanju', 'rakko', 'shisa', 'pochette'];
const NPC_IDS = data.npcs.species.map((s) => s.id);
const PET_IDS = data.pets.species.map((s) => s.id);
const HEX = /^#[0-9a-f]{6}$/i;
const KOREAN = /^[가-힣]+$/;
const propById = (id) => data.props.props.find((p) => p.id === id);
/** An old (pre-CH-1) human avatar. */
const HUMAN = { body: 'girl', build: 'normal', skin: 'tan', face: 'round', eyes: 'cat', mouth: 'grin', cheek: 'blush', hair: 'bun', hairColor: 'pink', outfit: 'hoodie', outfitColor: 'green', accessory: 'glasses' };
const humanPartner = (over = {}) => ({ id: 'pt7', name: '서연', trait: 'charm', stars: 2, body: 'girl', avatar: { ...HUMAN, accessory: 'hairpin' }, ...over });
const humanChild = (over = {}) => ({ id: 'ch3', name: '하윤', trait: 'int', talent: 'genius', stage: 'kid', bornTurn: 4, avatar: { ...HUMAN, body: 'boy', outfit: 'dino' }, body: 'boy', growth: 1, turns: 2, ...over });
const SHORT = { baby: 1, elem: 1, middle: 1, high: 1, young: 5, middle_age: 4 };

// ---------- data ----------

test('roster.json: the 8 fixed ids (default chiikawa), Korean names, colours, ear types, sizes, anchors inside the canvas', () => {
  const r = data.roster;
  assert.deepEqual(r.characters.map((c) => c.id), ROSTER_IDS);
  assert.deepEqual(r.characters.map((c) => c.name), ['치이카와', '하치와레', '우사기', '모몽가', '쿠리만쥬', '랏코', '시사', '포셰트']);
  assert.equal(r.default, 'chiikawa');
  assert.deepEqual(r.canvas, [1024, 1536]);
  for (const c of r.characters) {
    assert.ok(c.icon && c.desc && c.promptDesc && /^[\x20-\x7e]+$/.test(c.promptDesc), `${c.id}: icon / desc / English promptDesc`);
    for (const k of ['body', 'line', 'blush', 'accent']) assert.match(c.colors[k], HEX, `${c.id}.colors.${k}`);
    if (c.colors.extra) assert.match(c.colors.extra, HEX);
    assert.ok(r.earTypes.includes(c.ears), `${c.id}: ears ${c.ears}`);
    assert.ok(c.size >= 0.8 && c.size <= 1.25, `${c.id}: size`);
    assert.ok(Array.isArray(c.traits) && c.traits.every((t) => typeof t === 'string'));
    assert.deepEqual(Object.keys(c.anchors).sort(), ['back', 'face', 'handL', 'handR', 'head', 'neck']);
    for (const [k, [x, y]] of Object.entries(c.anchors)) assert.ok(x > 0 && x < 1024 && y > 0 && y < 1536, `${c.id}.${k}`);
    assert.ok(c.anchors.head[1] < c.anchors.face[1] && c.anchors.face[1] < c.anchors.neck[1], `${c.id}: head above face above neck`);
  }
  assert.deepEqual([...new Set(r.characters.map((c) => c.ears))].sort(), [...r.earTypes].sort(), 'every ear type is used');
});

test('props.json: 5 slots, ~30 choosable props, era / job props exist in their slots; jobProps = jobs.json props', () => {
  const P = data.props;
  assert.deepEqual(P.slots.map((s) => s.id), PROP_SLOTS);
  for (const s of P.slots) assert.ok(s.name);
  const ids = new Set();
  for (const p of P.props) {
    assert.match(p.id, /^[a-z_]+$/);
    assert.ok(!ids.has(p.id), `duplicate ${p.id}`);
    ids.add(p.id);
    assert.ok(PROP_SLOTS.includes(p.slot), `${p.id}: slot`);
    assert.ok(p.name && p.icon && typeof p.choice === 'boolean' && /^[\x20-\x7e]+$/.test(p.promptDesc), p.id);
    assert.match(p.color, HEX, `${p.id}: color`);
  }
  const choice = P.props.filter((p) => p.choice);
  assert.ok(choice.length >= 28 && choice.length <= 34, `${choice.length} choosable props`);
  for (const slot of PROP_SLOTS) assert.ok(choice.filter((p) => p.slot === slot).length >= 3, `${slot}: ≥ 3 choices`);
  const check = (table, label) => {
    for (const [slot, id] of Object.entries(table)) {
      if (slot === 'job') continue;
      assert.equal(propById(id)?.slot, slot, `${label}: ${slot} ${id}`);
    }
  };
  assert.deepEqual(Object.keys(P.eraProps), loadData('eras').eras.map((e) => e.id));
  for (const [era, table] of Object.entries(P.eraProps)) check(table, `eraProps.${era}`);
  assert.deepEqual([P.eraProps.young, P.eraProps.middle_age], [{ job: true }, { job: true }], 'job eras use job props');
  assert.deepEqual(P.eraProps.baby, { head: 'bonnet', face: 'pacifier' });
  assert.deepEqual(P.eraProps.senior, { head: 'knit_cap', hand: 'cane' });
  const jobs = [...data.jobs.jobs, data.jobs.partTime];
  assert.deepEqual(Object.keys(P.jobProps).sort(), jobs.map((j) => j.id).sort());
  for (const j of jobs) {
    assert.deepEqual(j.props, P.jobProps[j.id], `${j.id}: jobs.json props = props.json jobProps`);
    assert.equal(j.outfit, undefined, `${j.id}: no human outfit`);
    check(j.props, j.id);
  }
});

test('npcs.json / pets.json: species schemas, gender-free unique Korean name pools, pets never duplicate roster species', () => {
  for (const [file, list] of [['npcs', data.npcs], ['pets', data.pets]]) {
    assert.ok(list.species.length >= 8, file);
    const seen = new Set();
    for (const s of list.species) {
      assert.match(s.id, /^[a-z_]+$/);
      assert.ok(!seen.has(s.id), `${file}: duplicate ${s.id}`);
      seen.add(s.id);
      assert.ok(s.name && s.icon && /^[\x20-\x7e]+$/.test(s.promptDesc), `${file}.${s.id}`);
      for (const k of ['body', 'line', 'accent']) assert.match(s.colors[k], HEX, `${file}.${s.id}.${k}`);
    }
    assert.ok(list.names.length >= 24, `${file}: names`);
    assert.equal(new Set(list.names).size, list.names.length, `${file}: unique names`);
    for (const n of list.names) assert.ok(KOREAN.test(n) && n.length <= 3, n);
  }
  assert.equal(data.npcs.species.length, 10);
  assert.equal(data.pets.species.length, 8);
  // pets and NPC friends never share names (a pet is never mistaken for a friend)
  assert.ok(!data.pets.names.some((n) => data.npcs.names.includes(n)));
  for (const n of [...data.pets.names, ...data.npcs.names]) assert.ok(!['호야', '봄이'].includes(n), 'MC names stay unique');
  for (const s of data.pets.species) assert.ok(!['rabbit', 'otter', 'flying_squirrel', 'shisa', 'kitten', 'cat'].includes(s.id), s.id);
  assert.deepEqual(Object.keys(data.pets.stages), ['baby', 'kid', 'teen', 'adult']);
  assert.deepEqual(Object.values(data.pets.stages).map((s) => s.name), ['새끼', '꼬마', '청소년', '어른']);
  for (const [trait, props] of Object.entries(data.npcs.traitProps)) {
    assert.ok(data.partners.traits[trait], trait);
    for (const [slot, id] of Object.entries(props)) assert.ok(propById(id)?.choice && propById(id).slot === slot, `${trait}: ${id}`);
  }
});

// ---------- avatar model ----------

test('sanitizeAvatar: {character, props} — unknown character → default, wrong-slot / job / unknown props dropped, slot order', () => {
  assert.deepEqual(sanitizeAvatar({ character: 'usagi', props: { back: 'cape', head: 'ribbon' } }), { character: 'usagi', props: { head: 'ribbon', back: 'cape' } });
  assert.deepEqual(Object.keys(sanitizeAvatar({ character: 'usagi', props: { back: 'cape', head: 'ribbon' } }).props), ['head', 'back'], 'slot order');
  assert.deepEqual(sanitizeAvatar({ character: 'pikachu', props: { head: 'chef_hat', face: 'ribbon', hand: 'balloon', tail: 'x' }, body: 'boy' }).props, { hand: 'balloon' });
  assert.equal(sanitizeAvatar({ character: 'pikachu' }).character, 'chiikawa');
  for (const bad of [null, undefined, 'usagi', 42, [], {}]) assert.deepEqual(sanitizeAvatar(bad), { character: 'chiikawa', props: {} }, String(bad));
  for (const id of ROSTER_IDS) assert.equal(sanitizeAvatar({ character: id }).character, id);
  // every choosable prop is accepted in its slot; growth / job props never are
  for (const p of data.props.props) assert.equal(sanitizeAvatar({ character: 'shisa', props: { [p.slot]: p.id } }).props[p.slot], p.choice ? p.id : undefined, p.id);
  // NPC / pet looks
  assert.deepEqual(sanitizeNpcLook({ npc: 'fox', props: { neck: 'scarf', head: 'crown_x' } }), { npc: 'fox', props: { neck: 'scarf' } });
  assert.equal(sanitizeNpcLook({ npc: 'dragon' }, undefined, 'owl').npc, 'owl');
  assert.deepEqual(sanitizePetLook({ pet: 'turtle', props: { head: 'ribbon' } }), { pet: 'turtle' });
  assert.equal(sanitizePetLook({ pet: 'unicorn' }).pet, PET_IDS[0]);
});

test('legacy human avatars migrate deterministically (hash of the JSON) to a roster character + the mapped accessory prop', () => {
  assert.ok(isHumanAvatar(HUMAN));
  assert.ok(isHumanAvatar({ hair: 'bun' }));
  assert.ok(!isHumanAvatar({ character: 'usagi', hair: 'bun' }));
  assert.ok(!isHumanAvatar({}));
  const a = sanitizeAvatar(HUMAN);
  assert.ok(ROSTER_IDS.includes(a.character));
  assert.deepEqual(a.props, { face: 'round_glasses' });
  assert.deepEqual(sanitizeAvatar({ ...HUMAN }), a, 'deterministic');
  // key order does not matter (stable JSON)
  assert.deepEqual(sanitizeAvatar(Object.fromEntries(Object.entries(HUMAN).reverse())), a);
  for (const [acc, props] of Object.entries(ACCESSORY_PROPS)) assert.deepEqual(sanitizeAvatar({ ...HUMAN, accessory: acc }).props, props, acc);
  assert.deepEqual(sanitizeAvatar({ ...HUMAN, accessory: 'none' }).props, {});
  // different human looks spread over the roster
  const seen = new Set();
  for (const hair of loadData('avatars').parts.hair) for (const skin of ['fair', 'tan']) seen.add(sanitizeAvatar({ ...HUMAN, hair: hair.id, skin }).character);
  assert.ok(seen.size >= 6, `${seen.size} roster characters reached`);
});

test('randomLook (CPU looks): a seeded roster character + 0–2 choosable props in distinct slots; every character reachable', () => {
  const chars = new Set();
  const counts = new Set();
  for (let i = 0; i < 200; i++) {
    const look = randomLook(`seed:${i}`);
    assert.deepEqual(sanitizeAvatar(look), look, 'already sanitized');
    chars.add(look.character);
    const n = Object.keys(look.props).length;
    counts.add(n);
    assert.ok(n <= 2);
    assert.deepEqual(randomLook(`seed:${i}`), look, 'seeded');
  }
  assert.deepEqual([...chars].sort(), [...ROSTER_IDS].sort());
  assert.deepEqual([...counts].sort(), [0, 1, 2]);
  const cpu = addCpuCharacter(makeRoom(), {}, 0).character;
  assert.ok(ROSTER_IDS.includes(cpu.avatar.character));
  // a human look passed for a CPU (old admin pages) is migrated as well
  assert.ok(ROSTER_IDS.includes(addCpuCharacter(makeRoom(), { avatar: HUMAN }, 0).character.avatar.character));
});

// ---------- migration ----------

/** A playing room saved before CH-1: human avatars everywhere, a partner, a spouse with children, an open meet prompt. */
function oldPlayingRoom() {
  let room = makeRoom({ seed: 9 });
  room.config = { ...room.config, eraTurns: { ...room.config.eraTurns, ...SHORT }, finalLength: 20 };
  room = joinRoom(room, 'A', '에이', 0).room;
  room = joinRoom(room, 'B', '비', 0).room;
  for (const [o, n] of [['A', '하나'], ['B', '둘'], ['A', '셋']]) room = addCharacter(room, o, { name: n }, 0).room;
  room = startGame(room, { now: 0 }).room;
  const [c1, c2, c3] = room.characters;
  for (const c of room.characters) c.avatar = { ...HUMAN, hair: c.name === '하나' ? 'bob' : 'afro' };
  c1.art = { key: 'a'.repeat(24), status: 'ready', progress: 1 };
  c2.love.partner = humanPartner();
  c3.spouse = { ...humanPartner({ id: 'pt8', name: '민호', body: 'boy' }), salary: 45, marriedTurn: 3 };
  c3.children = [humanChild(), humanChild({ id: 'ch4', name: '하준', talent: 'normal', body: 'girl', avatar: { ...HUMAN, body: 'girl' } })];
  room.schoolMeetPairs = [{ charId: c2.id, partner: humanPartner() }];
  // an open 새 친구 prompt for c1 with two human candidates
  const cands = [humanPartner({ id: 'pt9', name: '지민' }), humanPartner({ id: 'pt10', name: '도윤', body: 'boy', avatar: { ...HUMAN, body: 'boy', accessory: 'sunglasses' } })];
  c1.love.candidates = structuredClone(cands);
  room.turn.currentIndex = room.turn.order.indexOf(c1.id);
  room.turn.phase = 'awaitDecision';
  room.promptSeq = 1;
  room.turn.pending = {
    promptId: 'q1', kind: 'meet', charId: c1.id, title: '💘 운명의 만남', text: '', forCharacterIds: [c1.id], simultaneous: false, answers: {}, deadlineAt: null,
    options: [...cands.map((p) => ({ id: `meet:${p.id}`, partnerId: p.id, label: p.name, trait: p.trait, stars: p.stars, salary: 45, match: false, partner: structuredClone(p) })), { id: 'pass', label: '🙅' }],
    defaultOptionId: 'pass', context: { candidates: structuredClone(cands) },
  };
  return room;
}

test('migrateRoomLooks: players, candidates, partner, spouse, children, schoolMeet pairs and an open prompt; idempotent', () => {
  const room = oldPlayingRoom();
  const before = structuredClone(room);
  assert.equal(migrateRoomLooks(room), true);
  const [c1, c2, c3] = room.characters;
  for (const c of room.characters) {
    assert.deepEqual(Object.keys(c.avatar), ['character', 'props']);
    assert.ok(ROSTER_IDS.includes(c.avatar.character));
    assert.deepEqual(c.avatar.props, { face: 'round_glasses' }, 'glasses → round glasses');
  }
  assert.equal(c1.art, undefined, 'the human AI art is dropped');
  const npcOk = (p) => {
    assert.ok(NPC_IDS.includes(p.species), p.name);
    assert.deepEqual(Object.keys(p.avatar), ['npc', 'props']);
    assert.equal(p.avatar.npc, p.species);
    assert.equal(p.body, undefined);
  };
  for (const p of [c2.love.partner, c3.spouse, ...c1.love.candidates, room.schoolMeetPairs[0].partner, ...room.turn.pending.context.candidates]) npcOk(p);
  for (const o of room.turn.pending.options.filter((x) => x.partner)) npcOk(o.partner);
  assert.deepEqual(c2.love.partner.avatar.props, { head: 'flower_pin' }, 'hairpin → flower pin');
  assert.deepEqual(room.turn.pending.options[1].partner.avatar.props, { face: 'sunglasses' });
  // the same partner (copies in several places) migrates to the same species
  assert.deepEqual(c2.love.partner, room.schoolMeetPairs[0].partner);
  assert.deepEqual(room.turn.pending.options[0].partner, room.turn.pending.context.candidates[0]);
  assert.deepEqual(c1.love.candidates[1], room.turn.pending.context.candidates[1]);
  assert.equal(c3.spouse.salary, 45, 'other fields kept');
  for (const k of c3.children) {
    assert.ok(PET_IDS.includes(k.species));
    assert.deepEqual(k.avatar, { pet: k.species });
    assert.equal(k.body, undefined);
  }
  assert.deepEqual([c3.children[0].name, c3.children[0].talent, c3.children[0].growth], ['하윤', 'genius', 1], 'pets keep their record');
  // deterministic + idempotent
  const again = structuredClone(before);
  migrateRoomLooks(again);
  assert.deepEqual(again, room);
  assert.equal(migrateRoomLooks(room), false, 'nothing left to migrate');
});

test('RoomStore.load migrates an old save; applyAction migrates a playing room and resolves an old meet prompt', async () => {
  const tmp = await tempDir();
  try {
    const old = oldPlayingRoom();
    old.id = 'a1b2c3d4';
    old.code = 'OLDSAV';
    await mkdir(path.join(tmp.dir, 'saves'), { recursive: true });
    await writeFile(path.join(tmp.dir, 'saves', 'a1b2c3d4.json'), JSON.stringify(old));
    const store = await new RoomStore({ dataDir: tmp.dir }).load();
    const loaded = store.getRoom('a1b2c3d4');
    assert.ok(loaded.characters.every((c) => ROSTER_IDS.includes(c.avatar.character)));
    assert.ok(NPC_IDS.includes(loaded.characters[2].spouse.species));
    assert.ok(loaded.characters[2].children.every((k) => PET_IDS.includes(k.avatar.pet)));
    await store.close();
    assert.deepEqual(await readdir(path.join(tmp.dir, 'saves')), ['a1b2c3d4.json']);
    assert.match(await readFile(path.join(tmp.dir, 'saves', 'a1b2c3d4.json'), 'utf8'), /"body"/, 'the file itself is only rewritten on the next commit');
  } finally {
    await tmp.cleanup();
  }
  // applyAction on the unmigrated room: the old meet prompt resolves into an NPC friend
  const room = oldPlayingRoom();
  const c1 = room.characters[0];
  const r = applyAction(room, { type: 'choose', characterId: c1.id, promptId: 'q1', optionId: 'meet:pt9' }, { now: 5 });
  const met = r.events.find((e) => e.type === 'met');
  assert.ok(met, 'met');
  assert.equal(met.partner.name, '지민');
  assert.ok(NPC_IDS.includes(met.partner.species) && met.partner.avatar.npc === met.partner.species);
  assert.ok(r.room.characters.every((c) => !isHumanAvatar(c.avatar)));
  assert.ok(!JSON.stringify(r.room.characters).includes('"body"'), 'no body field left in characters');
});

// ---------- gender-free rules ----------

test('gender-free rules: no body / boy / girl in server/game; partners do not depend on the roster look; military flags', async () => {
  const dir = path.join(import.meta.dirname, '..', 'server', 'game');
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  for (const f of (await readdir(dir)).filter((x) => x.endsWith('.js'))) {
    const src = strip(await readFile(path.join(dir, f), 'utf8'));
    assert.doesNotMatch(src, /bodyOf|avatar\??\.body|['"](boy|girl)['"]/, `${f} reads a body / gender`);
  }
  // the same seed gives the same partner whatever roster character asks
  const partnerFor = (character) => {
    const room = structuredClone(oldPlayingRoom());
    migrateRoomLooks(room);
    room.characters[0].avatar = { character, props: {} };
    const tx = createTx(room, { rng: createRng(5), now: 0, data });
    return makePartner(tx, room.characters[0]);
  };
  const base = partnerFor('chiikawa');
  for (const id of ROSTER_IDS) assert.deepEqual(partnerFor(id), base, id);
  assert.deepEqual(Object.keys(base).sort(), ['avatar', 'id', 'name', 'species', 'stars', 'trait']);
  assert.ok(data.npcs.names.includes(base.name));
  // many seeds → every NPC species / many names
  const species = new Set();
  const names = new Set();
  for (let s = 0; s < 120; s++) {
    const room = structuredClone(oldPlayingRoom());
    migrateRoomLooks(room);
    const p = makePartner(createTx(room, { rng: createRng(s), now: 0, data }), room.characters[0]);
    species.add(p.species);
    names.add(p.name);
  }
  assert.deepEqual([...species].sort(), [...NPC_IDS].sort());
  assert.ok(names.size >= 20);
  // military: nobody drafted, everyone may volunteer
  assert.deepEqual([militaryMandatory(data), militaryVolunteer(data)], [false, true]);
  const legacy = { ...data, balance: { ...data.balance, military: { ...data.balance.military, mandatory: ['boy'], volunteer: [] } } };
  assert.deepEqual([militaryMandatory(legacy), militaryVolunteer(legacy)], [true, false], 'legacy arrays: non-empty = on');
});

// ---------- pets / wording of prompts ----------

/** Every character grown up in `era` with a job and cash; a tx over a clone (deterministic rng). */
function sandbox({ era = 'young', seed = 3 } = {}) {
  const room = structuredClone(oldPlayingRoom());
  migrateRoomLooks(room);
  room.turn.pending = null;
  room.turn.phase = 'awaitSpin';
  room.schoolMeetDone = true;
  for (const c of room.characters) {
    Object.assign(c, { era, money: 1000, careerDone: true, military: { status: 'done', turnsLeft: 0 }, job: { id: 'office_worker', rank: 1, exp: 0, injured: 0 } });
    c.love = { candidates: [], partner: null, affection: 0, dates: 0 };
    c.spouse = null;
    c.children = [];
  }
  const tx = createTx(room, { rng: createRng(seed), now: 0, data });
  return { room, tx, c: room.characters[0] };
}
const heart = (tx, c) => resolveTile(tx, c, { id: 'young:love:3', type: 'heart', route: 'love' });
const answer = (tx, c, optionId) => {
  tx.room.turn.pending.answers[c.id] = optionId;
  resolvePrompt(tx);
};

test('friends & pets: prompt titles / options in the new wording; adoption makes a pet (species, name, {pet} look)', () => {
  const s = sandbox();
  heart(s.tx, s.c);
  let p = s.tx.room.turn.pending;
  assert.deepEqual([p.kind, p.title], ['meet', '💘 새 친구']);
  assert.ok(p.options.filter((o) => o.partner).every((o) => /단짝 생활비/.test(o.desc) && NPC_IDS.includes(o.partner.species)));
  answer(s.tx, s.c, p.options[0].id);
  assert.match(s.tx.logs.at(-1)?.text ?? s.room.log.at(-1).text, /친구가 됐다/);
  s.c.love.affection = 10;
  heart(s.tx, s.c);
  p = s.tx.room.turn.pending;
  assert.deepEqual([p.kind, p.title], ['date', '💑 같이 놀기']);
  assert.ok(p.options.every((o) => /친밀도 \+\d+/.test(o.desc)));
  answer(s.tx, s.c, p.defaultOptionId);
  s.c.love.affection = 95;
  heart(s.tx, s.c);
  p = s.tx.room.turn.pending;
  assert.deepEqual([p.kind, p.title], ['propose', '🏡 「같이 살자!」 제안']);
  assert.deepEqual(p.options.map((o) => o.label), ['🏡 같이 살자!', '💕 조금 더 친하게 지내기']);
  s.tx.rng = { ...createRng(1), next: () => 0 };
  answer(s.tx, s.c, 'propose');
  assert.ok(s.c.spouse && NPC_IDS.includes(s.c.spouse.species), '단짝 동거');
  const logs = s.room.log.map((l) => l.text).join('\n');
  assert.match(logs, /「같이 살자!」 제안 대성공/);
  assert.match(logs, /집들이 파티! 오늘부터 단짝 동거 시작/);
  // adoption: a pet from pets.json
  s.tx.rng = createRng(4);
  const pet = bearChild(s.tx, s.c);
  assert.ok(PET_IDS.includes(pet.species));
  assert.deepEqual(pet.avatar, { pet: pet.species });
  assert.ok(data.pets.names.includes(pet.name));
  assert.equal(pet.body, undefined);
  const born = s.tx.events.findLast((e) => e.type === 'childBorn');
  assert.equal(born.child.species, pet.species);
  assert.match(s.room.log.at(-1).text, /입양/);
  // school meeting prompt
  const h = sandbox({ era: 'high' });
  h.room.schoolMeetDone = false;
  h.c.schoolMet = false;
  h.room.turn.currentIndex = h.room.turn.order.length - 1;
  const r = applyAction(h.room, { type: 'skip' }, { rng: createRng(2), now: 9 });
  if (r.room.turn.pending?.kind === 'meet') assert.equal(r.room.turn.pending.title, '🏫 고교 첫 친구');
});

test('wording: no marriage / birth / gender words in server/data (legacy avatars.json aside) or server/game strings', async () => {
  const BANNED = /결혼|신랑|신부|아내|남편|아들|딸(?!랑)|육아|출산|임신|남자|여자|프러포즈|축의금|돌잔치|배우자|맞벌이|호감도|데이트|자녀|연애|연인|영재|소개팅|청혼|손주|첫사랑|부케|애인|커플|효자|효녀|신혼/;
  const hits = [];
  const walk = (v, where) => {
    if (typeof v === 'string') {
      if (BANNED.test(v)) hits.push(`${where}: ${v}`);
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${where}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!k.startsWith('_')) walk(x, `${where}.${k}`);
  };
  const dataDir = path.join(import.meta.dirname, '..', 'server', 'data');
  for (const f of (await readdir(dataDir)).filter((x) => x.endsWith('.json') && x !== 'avatars.json')) walk(JSON.parse(await readFile(path.join(dataDir, f), 'utf8')), f);
  const gameDir = path.join(import.meta.dirname, '..', 'server', 'game');
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  for (const f of (await readdir(gameDir)).filter((x) => x.endsWith('.js'))) {
    strip(await readFile(path.join(gameDir, f), 'utf8')).split('\n').forEach((l, i) => {
      if (BANNED.test(l)) hits.push(`${f}:${i + 1}: ${l.trim()}`);
    });
  }
  assert.deepEqual(hits, []);
  // the new names from the wording table
  assert.equal(data.board.routes.love.name, '단짝·반려');
  assert.equal(data.tones.tones.love.label, '단짝·반려');
  assert.equal(data.cards.cards.find((k) => k.id === 'marriage_luck').name, '단짝운◎');
  const award = (id) => data.awards.awards.find((a) => a.id === id).name;
  assert.deepEqual([award('dabok'), award('genius_parent')], ['대가족 집사상', '천재 펫 집사상']);
  assert.equal(data.news.news.find((n) => n.id === 'birth_bonus').title, '반려동물 입양 지원금 확대');
  // MC situations of the theme keep their keys, with the new vars
  assert.deepEqual(data.mc.situations.marriage.vars, ['name', 'partner']);
  assert.deepEqual(data.mc.situations.birth.vars, ['name', 'child']);
  for (const key of ['marriage', 'birth', 'proposeFail', 'schoolMeet']) assert.ok(data.lines.mc[key].duo.length >= 6, key);
});

// ---------- meta / random games ----------

test('/api/meta exposes roster, props, npcs, pets (+ legacy avatars)', async () => {
  const tmp = await tempDir();
  const srv = await startServer({ port: 0, host: '127.0.0.1', dataDir: tmp.dir, adminPassword: 'pw', log: () => {} });
  try {
    const meta = (await httpCall(srv.url, 'GET', '/api/meta')).json;
    assert.deepEqual(meta.roster, data.roster);
    assert.deepEqual(meta.props, data.props);
    assert.deepEqual(meta.npcs, data.npcs);
    assert.deepEqual(meta.pets, data.pets);
    assert.ok(meta.avatars?.parts, 'legacy human options stay');
    assert.equal(meta.board.routes.love.name, '단짝·반려');
  } finally {
    await srv.close();
    await tmp.cleanup();
  }
});

test('random games with roster looks: CPU-only lifetime games finish; partners / pets carry species looks', () => {
  let friends = 0;
  let pets = 0;
  for (const seed of [3, 8]) {
    let room = makeRoom({ seed, config: { ...makeRoom().config, eraTurns: { ...makeRoom().config.eraTurns, ...SHORT }, finalLength: 20, allowCpu: true, holidays: true } });
    for (let i = 0; i < 4; i++) room = addCpuCharacter(room, {}, 0).room;
    room = startGame(room, { now: 0 }).room;
    for (let i = 0; i < 5000 && room.status === 'playing'; i++) {
      const p = room.turn.pending;
      const id = p ? p.forCharacterIds.find((x) => !Object.hasOwn(p.answers, x)) : room.turn.order[room.turn.currentIndex];
      const r = applyAction(room, cpuDecide(room, id, data), { now: 1000 + i });
      room = r.room;
      room.log = [];
      for (const e of r.events) {
        if (e.type === 'met') {
          friends++;
          assert.ok(NPC_IDS.includes(e.partner.avatar.npc) && e.partner.body === undefined);
        }
        if (e.type === 'childBorn') {
          pets++;
          assert.ok(PET_IDS.includes(e.child.avatar.pet) && e.child.body === undefined);
        }
        assert.ok(!/\{\w+\}/.test(e.line ?? ''), `${e.type}: ${e.line}`);
      }
    }
    assert.equal(room.status, 'finished', `seed ${seed}`);
    assert.ok(room.characters.every((c) => ROSTER_IDS.includes(c.avatar.character)));
    assert.ok(room.characters.every((c) => c.military.status !== 'serving'));
  }
  assert.ok(friends >= 2, `friends ${friends}`);
  assert.ok(pets >= 1, `pets ${pets}`);
});
