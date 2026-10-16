// 노년 역전 (senior race comeback): the 🏝️ 한방역전섬 (stake tiers, lucky numbers, 대박 / 쪽박, 조기 은퇴, the pause on the
// way), 🏆 노년 대회, 🔨 골동품 경매, the items' 노년 활용 (dodge / health / guard / pension / busking / royalty / lucky /
// premium), comebacks (room.seniorStart → result.comeback, the title / highlight / MC duo), presentation + MC, CPU
// answers (both levels), both worlds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameData } from '../server/data/index.js';
import { dataForWorld } from '../server/game/world.js';
import { applyAction, startGame } from '../server/game/engine.js';
import { addCharacter, addCpuCharacter, joinRoom } from '../server/game/lobby.js';
import { CPU_ANSWERS, cpuAnswer, cpuDecide } from '../server/game/cpu.js';
import { createTx } from '../server/game/effects.js';
import { EVENT_TYPES, CUTIN_TYPES } from '../server/game/presentation.js';
import { ANCHOR_TYPES, openPrompt } from '../server/game/prompts.js';
import { coverSet, hammerEv, islandTiers, itemAuctionBase, raceRoundsFor, seniorUseWorth, tierStake } from '../server/game/senior.js';
import { comebackOf } from '../server/game/awards.js';
import { computeTitles } from '../server/game/awards.js';
import { makeRoom, plainEra, toEra } from './helpers.js';

const data = gameData();
const chiikawa = dataForWorld('chiikawa');

function started({ chars = [['A', 'A1'], ['B', 'B1'], ['A', 'A2'], ['B', 'B2']], seed = 7, config = {} } = {}) {
  let room = makeRoom({ seed });
  room.config = { ...room.config, ...config };
  room = joinRoom(room, 'A', '에이', 0).room;
  room = joinRoom(room, 'B', '비', 0).room;
  for (const [owner, name] of chars) room = addCharacter(room, owner, { name }, 0).room;
  const r = startGame(room, { now: 0 });
  assert.equal(r.ok, true, r.error);
  return r.room;
}
/** RNG stub: int() / next() take queued values (then min / 0.99); pick / weighted take the first item. */
function fixedRng({ ints = [], nexts = [] } = {}) {
  const qi = [...ints];
  const qn = [...nexts];
  return { next: () => (qn.length ? qn.shift() : 0.99), int: (a) => (qi.length ? qi.shift() : a), pick: (arr) => arr[0], weighted: (items) => items[0], get state() { return 99; } };
}
const act = (room, action, rng = {}, now = 1000) => applyAction(room, action, { rng: fixedRng(rng), now });
const cur = (room) => room.turn.order[room.turn.currentIndex];
const ch = (room, id) => room.characters.find((c) => c.id === id);
const types = (events) => events.map((e) => e.type);
const settle = (c) => Object.assign(c, { careerDone: true, military: { status: 'done', turnsLeft: 0 }, job: { id: 'chef', rank: 1, exp: 0, injured: 0 }, clubAsked: true, schoolMet: true });
function setTile(room, index, tile) {
  const era = room.board.eras[room.eraIndex];
  era.tiles[index] = { id: era.tiles[index].id, label: 'test', ...tile };
}
const choose = (room, optionId, rng = {}) => {
  const p = room.turn.pending;
  return act(room, { type: 'choose', characterId: p.forCharacterIds.find((x) => !Object.hasOwn(p.answers, x)), promptId: p.promptId, optionId }, rng);
};
/** A started room on its final race: plain money tiles, everyone settled with `cash`. */
function senior({ cash = 1000, config } = {}) {
  const room = started({ config });
  const last = room.board.eras.length - 1;
  toEra(room, last);
  plainEra(room, last);
  for (const c of room.characters) {
    settle(c);
    Object.assign(c, { money: cash, debt: 0, items: [], treasures: [] });
  }
  return room;
}

// ---------- data ----------

test('data: every item has a 노년 활용 (use, theme, seniorDesc) in both worlds; tiers below fair without luck; themes and hammer', () => {
  for (const d of [data, chiikawa]) {
    const themes = new Set(d.balance.senior.contest.themes.map((t) => t.id));
    for (const it of d.items.items) {
      assert.ok(it.senior?.use, `${it.id}: senior use`);
      assert.ok(['dodge', 'royalty', 'health', 'premium', 'lucky', 'pension', 'guard', 'busking'].includes(it.senior.use), it.id);
      assert.ok(themes.has(it.senior.theme), `${it.id}: theme ${it.senior.theme}`);
      assert.ok(it.seniorDesc && /[가-힣]/.test(it.seniorDesc), `${it.id}: seniorDesc`);
    }
    for (const t of d.balance.senior.contest.themes) assert.ok(t.name && t.icon && ['int', 'str', 'charm', 'luck'].includes(t.stat), t.id);
  }
  assert.deepEqual(chiikawa.items.items.map((i) => i.id).sort(), [...data.items.items.map((i) => i.id), 'armor', 'guitar'].sort());
  assert.equal(chiikawa.balance.senior.auction.title, '🔨 벼룩시장 경매');
  assert.equal(chiikawa.balance.senior.contest.themes.find((t) => t.id === 'sing').name, '하치와레 노래자랑');
  assert.match(chiikawa.items.items.find((i) => i.id === 'car').seniorDesc, /킥보드/);
  const tiers = islandTiers(data);
  assert.deepEqual(tiers.map((t) => t.id), ['all', 'half', 'little']);
  for (const t of tiers) assert.ok((t.numbers / 10) * t.mult < 1, `${t.id}: EV ${(t.numbers / 10) * t.mult} < 1`);
  assert.equal(tiers.filter((t) => t.bust).map((t) => t.id).join(), 'all', 'only the all-in tier can go bust');
  assert.ok(hammerEv(data) > 1 && hammerEv(data) < 1.6, `hammer EV ${hammerEv(data)}`);
  assert.equal(data.balance.senior.auction.hammer.length, 10);
  // stakes: all = every 만원 of cash, half / little in 5만원 units with a floor
  assert.equal(tierStake(tiers[0], 1234), 1234);
  assert.equal(tierStake(tiers[1], 1234), 615);
  assert.equal(tierStake(tiers[2], 60), 10);
  assert.deepEqual(coverSet(9, 3), [9, 10, 1]);
  assert.deepEqual(coverSet(4, 1), [4]);
});

test('presentation / prompts registry: the senior events are known, anchors and cut-ins', () => {
  for (const t of ['islandResult', 'contestResult', 'auctionResult', 'seniorItem']) assert.ok(EVENT_TYPES.includes(t), t);
  for (const t of ['islandResult', 'contestResult', 'auctionResult']) {
    assert.ok(CUTIN_TYPES.has(t) && ANCHOR_TYPES.has(t), t);
  }
  assert.ok(!CUTIN_TYPES.has('seniorItem'));
  for (const k of ['island', 'islandPick', 'contest', 'auction']) assert.equal(typeof CPU_ANSWERS[k], 'function', k);
});

// ---------- 🏝️ 한방역전섬 ----------

test('한방역전섬: passing it pauses the move behind its prompt; 「욕심 버리기」 resumes the rest of the move', () => {
  const room = senior();
  setTile(room, 3, { type: 'island', label: '한방역전섬', icon: '🏝️' });
  const id = cur(room);
  const r = act(room, { type: 'spin', characterId: id }, { ints: [6] });
  const moved = r.events.find((e) => e.type === 'moved');
  assert.deepEqual([moved.halted, moved.remaining, moved.path.length], ['island', 3, 3]);
  assert.ok(!r.events.some((e) => e.type === 'landed'));
  const p = r.room.turn.pending;
  assert.equal(p.kind, 'island');
  assert.deepEqual(p.options.map((o) => o.id), ['bet:all', 'bet:half', 'bet:little', 'retire', 'pass']);
  assert.equal(p.defaultOptionId, 'pass');
  assert.match(p.text, /위/); // the standing helps the choice
  const all = p.options.find((o) => o.id === 'bet:all');
  assert.deepEqual([all.stake, all.numbers, all.mult, all.bust, all.win], [1000, 1, 8, true, 8000]);
  const half = p.options.find((o) => o.id === 'bet:half');
  assert.deepEqual([half.stake, half.numbers, half.mult, half.bust], [500, 3, 3, false]);
  assert.equal(r.room.turn.pending.tone, 'treasure');
  const res = choose(r.room, 'pass');
  const pr = res.events.find((e) => e.type === 'promptResolved');
  assert.deepEqual([pr.kind, pr.result, pr.cutin, pr.lineTag], ['island', 'pass', false, 'island_pass']);
  const resumed = res.events.find((e) => e.type === 'moved');
  assert.deepEqual([resumed.resumed, resumed.path.length], [true, 3]);
  assert.equal(ch(res.room, id).position.index, 6);
});

test('한방역전섬: 인생 한 방 hit = ×8 대박 (jackpot), miss = 쪽박 (cash 0, 빈곤 농장, the move ends); half / little only lose the stake', () => {
  const room = senior({ cash: 800 });
  setTile(room, 2, { type: 'island', label: '한방역전섬' });
  const id = cur(room);
  const r = act(room, { type: 'spin', characterId: id }, { ints: [5] });
  const pick = choose(r.room, 'bet:all');
  const pp = pick.room.turn.pending;
  assert.equal(pp.kind, 'islandPick');
  assert.deepEqual(pp.options.map((o) => o.covers.length), Array(10).fill(1));
  assert.deepEqual(pp.context.stake, 800);
  // hit: roll 7 on pick 7
  const hit = choose(pick.room, '7', { ints: [7] });
  const ev = hit.events.find((e) => e.type === 'islandResult');
  assert.deepEqual([ev.result, ev.win, ev.roll, ev.amount, ev.mult, ev.tier], ['jackpot', true, 7, 5600, 8, 'all']);
  assert.equal(hit.events.find((e) => e.type === 'moneyChanged' && e.reason === 'island').delta, 5600);
  assert.equal(ch(hit.room, id).money, 6400 + 10, '… then the rest of the move lands on a money tile');
  assert.equal(ev.cutin, true);
  assert.equal(ev.lineTag, 'island_jackpot');
  assert.equal(ev.mcKey, 'islandJackpot');
  assert.ok(ev.mc?.length, 'the MCs celebrate a 대박');
  const mv = hit.events.filter((e) => e.type === 'moved');
  assert.equal(mv.at(-1).resumed, true, 'the move goes on after a 대박');
  assert.equal(ch(hit.room, id).record.islandJackpot, 1);
  // miss: 쪽박 → cash 0, finished bust (last place), the paused move is dropped
  const miss = choose(pick.room, '7', { ints: [3] });
  const ev2 = miss.events.find((e) => e.type === 'islandResult');
  assert.deepEqual([ev2.result, ev2.win, ev2.amount], ['bust', false, -800]);
  const fin = miss.events.find((e) => e.type === 'finished');
  assert.deepEqual([fin.retired, fin.place, fin.prize, fin.cutin], ['bust', 4, 0, false]);
  assert.equal(ch(miss.room, id).money, 0);
  assert.equal(ev2.scene, 'farm');
  assert.equal(ev2.mcKey, 'islandBust');
  assert.ok(!miss.events.some((e) => e.type === 'moved' && e.resumed), 'no move after the farm');
  // half: miss → −400, still racing
  const half = choose(choose(r.room, 'bet:half').room, '4', { ints: [9] });
  const ev3 = half.events.find((e) => e.type === 'islandResult');
  assert.deepEqual([ev3.result, ev3.amount, ev3.covers], ['lose', -400, [4, 5, 6]]);
  assert.equal(ch(half.room, id).money, 400 + 10); // (+ the money tile at the end of the resumed move)
  assert.equal(ch(half.room, id).finished, false);
  assert.equal(ch(half.room, id).record.gambleLosses, 1);
  // little: hit (5 numbers 1..5, roll 2) → +stake × 0.8
  const little = choose(choose(r.room, 'bet:little').room, '1', { ints: [2] });
  const ev4 = little.events.find((e) => e.type === 'islandResult');
  assert.deepEqual([ev4.result, ev4.stake, ev4.amount], ['win', 80, 65]);
});

test('한방역전섬: 🍀 lucky items add a number; broke characters cannot bet; 조기 은퇴 = the next place with half the prize', () => {
  const room = senior({ cash: 600 });
  setTile(room, 2, { type: 'island', label: '한방역전섬' });
  const id = cur(room);
  ch(room, id).items = ['lucky_cat'];
  const r = act(room, { type: 'spin', characterId: id }, { ints: [2] });
  const opts = r.room.turn.pending.options;
  assert.deepEqual(opts.filter((o) => o.tier).map((o) => [o.tier, o.numbers, o.lucky]), [['all', 2, 1], ['half', 4, 1], ['little', 6, 1]]);
  const pick = choose(r.room, 'bet:all');
  assert.deepEqual(pick.room.turn.pending.options.find((o) => o.id === '10').covers, [10, 1]);
  const hit = choose(pick.room, '10', { ints: [1] });
  assert.equal(hit.events.find((e) => e.type === 'islandResult').result, 'jackpot');
  // broke: every bet disabled, retire / pass stay
  const poor = senior({ cash: 5 });
  setTile(poor, 2, { type: 'island', label: '한방역전섬' });
  const rp = act(poor, { type: 'spin', characterId: cur(poor) }, { ints: [2] });
  assert.ok(rp.room.turn.pending.options.filter((o) => o.tier).every((o) => o.disabled));
  assert.ok(!rp.room.turn.pending.options.find((o) => o.id === 'retire').disabled);
  // retire → islandResult retire + finished early, place 1, half the prize, no more turns
  const ret = choose(r.room, 'retire');
  const ir = ret.events.find((e) => e.type === 'islandResult');
  const fin = ret.events.find((e) => e.type === 'finished');
  assert.deepEqual([ir.result, ir.place, fin.retired, fin.place], ['retire', 1, 'early', 1]);
  assert.equal(fin.prize, Math.round((data.balance.goalPrizes[0] * data.balance.retirePrizeMult) / 5) * 5);
  assert.equal(ir.lineTag, 'retire_early');
});

test('final race board: the island is crossed by everyone exactly once; the engine never stops there twice', () => {
  const room = started();
  const last = room.board.eras.length - 1;
  toEra(room, last);
  for (const c of room.characters) settle(c);
  const era = room.board.eras[last];
  const at = era.tiles.findIndex((t) => t.type === 'island');
  assert.ok(at > 0);
  // land exactly on it, then the next spin leaves it without a second prompt
  for (const c of room.characters) c.position = { eraIndex: last, route: 'main', index: at - 1 };
  plainEra(room, last);
  setTile(room, at, { type: 'island', label: '한방역전섬' });
  const id = cur(room);
  const r = act(room, { type: 'spin', characterId: id }, { ints: [1] });
  assert.equal(r.room.turn.pending?.kind, 'island');
  let g = choose(r.room, 'pass').room;
  while (cur(g) !== id) g = act(g, { type: 'spin', characterId: cur(g) }, { ints: [1] }).room.turn.pending ? choose(act(g, { type: 'spin', characterId: cur(g) }, { ints: [1] }).room, 'pass').room : act(g, { type: 'spin', characterId: cur(g) }, { ints: [1] }).room;
  const again = act(g, { type: 'spin', characterId: id }, { ints: [3] });
  assert.ok(!again.events.some((e) => e.type === 'prompt' && e.kind === 'island'));
});

// ---------- 🏆 노년 대회 ----------

test('노년 대회: a theme (an owned item\'s theme weighs more), win chance by stat + item; 우승 / 입상 / 탈락 / 구경', () => {
  const room = senior({ cash: 500 });
  setTile(room, 2, { type: 'contest', label: '노년 대회', icon: '🏆' });
  const id = cur(room);
  Object.assign(ch(room, id), { stats: { int: 2, str: 2, charm: 6, luck: 2 }, items: ['designer_bag'] });
  const r = act(room, { type: 'spin', characterId: id }, { ints: [2] });
  const p = r.room.turn.pending;
  assert.equal(p.kind, 'contest');
  assert.equal(p.context.themeId, 'sing'); // weighted → the first theme (노래자랑, the bag's theme)
  assert.equal(p.context.itemId, 'designer_bag');
  const cfg = data.balance.senior.contest;
  const chance = Math.min(cfg.max, cfg.base + cfg.perStat * 6 + cfg.itemBonus);
  const small = p.options.find((o) => o.id === 'join:small');
  assert.equal(small.chance, Math.round(chance * 100) / 100);
  assert.deepEqual([small.fee, small.prize], [20, 90]);
  assert.equal(p.defaultOptionId, 'join:small', 'the cheapest tier with a non-negative EV is the default');
  assert.match(p.text, /명품 가방/);
  // win (next 0.1 < chance)
  const win = choose(r.room, 'join:big', { nexts: [0.1] });
  const ev = win.events.find((e) => e.type === 'contestResult');
  assert.deepEqual([ev.place, ev.prize, ev.fee, ev.tier, ev.themeId], [1, 270, 60, 'big', 'sing']);
  assert.equal(ch(win.room, id).money, 500 - 60 + 270);
  assert.equal(ev.mcKey ?? 'contestWin', 'contestWin');
  assert.equal(ev.lineTag, 'contest_win');
  assert.equal(ch(win.room, id).record.contestWins, 1);
  // 입상 (just above the win chance) and 탈락
  const second = choose(r.room, 'join:small', { nexts: [chance + 0.01] });
  assert.equal(second.events.find((e) => e.type === 'contestResult').place, 2);
  const out = choose(r.room, 'join:small', { nexts: [0.999] });
  const evo = out.events.find((e) => e.type === 'contestResult');
  assert.deepEqual([evo.place, evo.prize, evo.lineTag], [null, 0, 'contest_lose']);
  assert.equal(ch(out.room, id).money, 480);
  // 구경 → a banner
  const watch = choose(r.room, 'watch');
  const pr = watch.events.find((e) => e.type === 'promptResolved');
  assert.deepEqual([pr.kind, pr.result, pr.cutin], ['contest', 'watch', false]);
  // a low stat without an item → negative EV → 구경 is the default
  const low = senior({ cash: 500 });
  setTile(low, 2, { type: 'contest', label: '노년 대회' });
  Object.assign(ch(low, cur(low)), { stats: { int: 0, str: 0, charm: 0, luck: 0 } });
  const rl = act(low, { type: 'spin', characterId: cur(low) }, { ints: [2] });
  assert.equal(rl.room.turn.pending.defaultOptionId, 'watch');
});

// ---------- 🔨 골동품 경매 ----------

test('골동품 경매: items (명품 premium), treasures (the hidden appraisal, a fake) and 잡동사니 under the hammer; leave', () => {
  const room = senior({ cash: 100 });
  setTile(room, 2, { type: 'auction', label: '골동품 경매', icon: '🔨' });
  const id = cur(room);
  const c = ch(room, id);
  c.items = ['designer_bag', 'car'];
  c.treasures = [{ uid: 'tr1', id: 'celadon' }, { uid: 'tr2', id: 'old_coin' }];
  room.treasureValues = { tr1: 200, tr2: 3 };
  room.treasureFakes = { tr2: true };
  const r = act(room, { type: 'spin', characterId: id }, { ints: [2] });
  const p = r.room.turn.pending;
  assert.equal(p.kind, 'auction');
  assert.deepEqual(p.options.map((o) => o.id), ['sell:item:designer_bag', 'sell:item:car', 'sell:treasure:tr1', 'sell:treasure:tr2', 'sell:junk', 'leave']);
  assert.equal(p.defaultOptionId, 'sell:junk');
  const bag = p.options[0];
  assert.equal(bag.base, Math.floor(400 * 0.9 * 1.5));
  assert.equal(bag.premium, 1.5);
  assert.equal(itemAuctionBase(data, 'car'), 150);
  // the bag at hammer 10 (×3)
  const sold = choose(r.room, 'sell:item:designer_bag', { ints: [10] });
  const ev = sold.events.find((e) => e.type === 'auctionResult');
  assert.deepEqual([ev.kind, ev.itemId, ev.base, ev.mult, ev.amount, ev.roll], ['item', 'designer_bag', 540, 3, 1620, 10]);
  assert.deepEqual(ch(sold.room, id).items, ['car']);
  assert.equal(ch(sold.room, id).money, 100 + 1620);
  assert.equal(ev.lineTag, 'auction_big');
  assert.equal(ev.scene, 'auction');
  // a real treasure: its value comes out, the treasure leaves the room's hidden tables
  const tr = choose(r.room, 'sell:treasure:tr1', { ints: [3] });
  const et = tr.events.find((e) => e.type === 'auctionResult');
  assert.deepEqual([et.kind, et.base, et.mult, et.amount, et.fake], ['treasure', 200, 1, 200, false]);
  assert.ok(!ch(tr.room, id).treasures.some((t) => t.uid === 'tr1'));
  assert.ok(!('tr1' in tr.room.treasureValues));
  // a fake
  const fk = choose(r.room, 'sell:treasure:tr2', { ints: [10] });
  const ef = fk.events.find((e) => e.type === 'auctionResult');
  assert.deepEqual([ef.fake, ef.lineTag], [true, 'auction_fake']);
  // 잡동사니 and leave
  const junk = choose(r.room, 'sell:junk', { ints: [1] });
  assert.equal(junk.events.find((e) => e.type === 'auctionResult').amount, 10);
  const lv = choose(r.room, 'leave');
  assert.deepEqual([lv.events.find((e) => e.type === 'promptResolved').result, ch(lv.room, id).items.length], ['leave', 2]);
});

// ---------- items' 노년 활용 ----------

test('노년 활용: 🚗 dodge drives past a 지출 tile, 💪 health halves it, 🛡️ guard blocks one, all only in the final race', () => {
  const room = senior({ cash: 500 });
  setTile(room, 3, { type: 'loss', label: '병원비', amount: 60 });
  const id = cur(room);
  ch(room, id).items = ['car'];
  const r = act(room, { type: 'spin', characterId: id }, { ints: [3] });
  const it = r.events.find((e) => e.type === 'seniorItem');
  assert.deepEqual([it.itemId, it.use, it.cutin], ['car', 'dodge', false]);
  const moves = r.events.filter((e) => e.type === 'moved');
  assert.deepEqual([moves.length, moves[1].dodge, moves[1].path.length], [2, true, 1]);
  assert.equal(ch(r.room, id).position.index, 4);
  assert.ok(!r.events.some((e) => e.type === 'landed' && e.tileType === 'loss'));
  // health: half
  const h = senior({ cash: 500 });
  setTile(h, 3, { type: 'loss', label: '병원비', amount: 60 });
  ch(h, cur(h)).items = ['gym_pass'];
  const rh = act(h, { type: 'spin', characterId: cur(h) }, { ints: [3] });
  assert.equal(rh.events.find((e) => e.type === 'seniorItem').use, 'health');
  assert.equal(rh.events.find((e) => e.type === 'moneyChanged' && e.reason === 'tile').delta, -30);
  // guard (치이카와 갑옷): blocks one 지출 entirely, then never again
  const g = senior({ cash: 500, config: { world: 'chiikawa' } });
  setTile(g, 3, { type: 'loss', label: '수리비', amount: 60 });
  const gid = cur(g);
  ch(g, gid).items = ['armor'];
  const rg = act(g, { type: 'spin', characterId: gid }, { ints: [3] });
  assert.equal(rg.events.find((e) => e.type === 'seniorItem').use, 'guard');
  assert.equal(ch(rg.room, gid).money, 500);
  assert.equal(ch(rg.room, gid).seniorUsed.guard, true);
  // not in a loop era
  const young = started();
  plainEra(young, 0, { type: 'loss', amount: 20, label: 'x' });
  ch(young, cur(young)).items = ['car'];
  const ry = act(young, { type: 'spin', characterId: cur(young) }, { ints: [2] });
  assert.ok(!ry.events.some((e) => e.type === 'seniorItem'));
});

test('노년 활용: ♨️ pension / 🎸 busking on final-race paydays (+ heal), 📖 royalty at the goal or retirement, never on a bust', () => {
  const room = senior({ cash: 100, config: { world: 'chiikawa' } });
  setTile(room, 2, { type: 'salary', label: '월급날' });
  const id = cur(room);
  Object.assign(ch(room, id), { items: ['massage_chair', 'guitar'], stats: { int: 5, str: 3, charm: 4, luck: 2 } });
  ch(room, id).job.injured = 2;
  const r = act(room, { type: 'spin', characterId: id }, { ints: [2] });
  const uses = r.events.filter((e) => e.type === 'seniorItem');
  assert.deepEqual(uses.map((e) => [e.use, e.amount]), [['pension', 40], ['busking', 25]]); // 매력 4 × 6 → 5만원 units
  assert.equal(uses[0].healed, true);
  assert.equal(ch(r.room, id).job.injured, 0);
  assert.equal(r.events.filter((e) => e.type === 'moneyChanged' && e.reason === 'seniorItem').length, 2);
  // royalty at the goal
  const g = senior({ cash: 100 });
  const gid = cur(g);
  Object.assign(ch(g, gid), { items: ['laptop'], stats: { int: 6, str: 2, charm: 2, luck: 2 } });
  const L = g.board.eras[g.eraIndex].tiles.length;
  ch(g, gid).position.index = L - 3;
  const rg = act(g, { type: 'spin', characterId: gid }, { ints: [5] });
  const roy = rg.events.find((e) => e.type === 'seniorItem');
  assert.deepEqual([roy.use, roy.amount], ['royalty', 90]);
  assert.ok(types(rg.events).indexOf('finished') < types(rg.events).indexOf('seniorItem'));
  // a bust pays no royalty
  const b = senior({ cash: 100 });
  setTile(b, 2, { type: 'island', label: '한방역전섬' });
  const bid = cur(b);
  Object.assign(ch(b, bid), { items: ['laptop'], stats: { int: 6, str: 2, charm: 2, luck: 2 } });
  const rb = choose(choose(act(b, { type: 'spin', characterId: bid }, { ints: [2] }).room, 'bet:all').room, '1', { ints: [5] });
  assert.equal(rb.events.find((e) => e.type === 'finished').retired, 'bust');
  assert.ok(!rb.events.some((e) => e.type === 'seniorItem'));
});

test('shop cards carry the 노년 활용 (seniorDesc) in both worlds', () => {
  for (const world of ['real', 'chiikawa']) {
    const room = started({ config: { world } });
    const c = room.characters[0];
    c.money = 5000;
    const d = world === 'real' ? data : chiikawa;
    const tx = createTx(room, { rng: fixedRng(), now: 0, data: d });
    const p = openPrompt(tx, 'shop', c);
    const items = p.options.filter((o) => o.itemId);
    assert.equal(items.length, 2);
    for (const o of items) assert.ok(o.seniorDesc && o.desc.includes('👴 노년'), `${world} ${o.itemId}`);
  }
});

// ---------- comebacks, records, titles ----------

test('comebacks: room.seniorStart at the final transition; a bottom-half winner → result.comeback, the title, a highlight, the MC duo', () => {
  const room = started();
  const ids = room.characters.map((c) => c.id);
  room.seniorStart = { ranks: { [ids[0]]: 4, [ids[1]]: 1, [ids[2]]: 2, [ids[3]]: 3 }, totals: {}, n: 4, turnNo: 9 };
  const ranking = ids.map((charId, i) => ({ charId, rank: i + 1, total: 1000 - i }));
  assert.deepEqual(comebackOf(room, ranking), { charId: ids[0], from: 4, n: 4 });
  assert.equal(comebackOf(room, [...ranking.slice(1), ranking[0]].map((r, i) => ({ ...r, rank: i + 1 }))), null, 'the top half winning is no comeback');
  for (const c of room.characters) c.record = { ...(c.record ?? {}), islandJackpot: c.id === ids[1] ? 1 : 0, gambleLosses: c.id === ids[2] ? 3 : 0 };
  const titles = computeTitles(room, data, { ranking });
  assert.ok(titles[ids[0]].includes('comeback_king'));
  assert.ok(titles[ids[1]].includes('island_jackpot'));
  assert.ok(titles[ids[2]].includes('jjokbak_master'));
  // the engine records the standing when the final race starts
  const g = started();
  const last = g.board.eras.length - 1;
  toEra(g, last - 1);
  g.turn.eraRound = g.turn.eraTurns;
  g.turn.currentIndex = g.turn.order.length - 1;
  for (const c of g.characters) settle(c);
  const r = act(g, { type: 'spin', characterId: cur(g) }, { ints: [1] });
  let next = r.room;
  while (next.turn.pending) next = choose(next, next.turn.pending.defaultOptionId).room;
  assert.equal(next.eraIndex, last);
  assert.equal(next.seniorStart.n, 4);
  assert.deepEqual(Object.keys(next.seniorStart.ranks).sort(), ids.sort());
  // ⏰ 노년 마감: the race clock starts with the final era
  assert.deepEqual([next.turn.raceRound, next.turn.raceRounds], [1, raceRoundsFor(data, next.board.eras[last].tiles.length)]);
});

test('⏰ 노년 마감: the final race lasts at most raceRoundsFor(length) rounds; the rest retire by progress at half prize', () => {
  assert.deepEqual([10, 20, 40, 41, 80, 200].map((n) => raceRoundsFor(data, n)), [8, 8, 12, 13, 24, 30]);
  const room = senior();
  const order = room.turn.order;
  const [a, b, c, d] = order.map((id) => ch(room, id));
  Object.assign(room.turn, { raceRound: 11, raceRounds: 12, currentIndex: order.length - 1 });
  // a full round that is not the last one ticks the clock
  let r = act(room, { type: 'spin', characterId: cur(room) }, { ints: [1] });
  while (r.room.turn.pending) r = choose(r.room, r.room.turn.pending.defaultOptionId);
  assert.equal(r.room.turn.raceRound, 12);
  assert.equal(r.room.status, 'playing');
  // the last round: a finished, b far ahead of c, d (the last mover) behind
  const g = r.room;
  Object.assign(ch(g, a.id), { finished: true, place: 1 });
  ch(g, b.id).position.index = 20;
  ch(g, c.id).position.index = 6;
  ch(g, d.id).position.index = 2;
  Object.assign(g.turn, { currentIndex: order.length - 1, phase: 'awaitSpin', spun: false, pending: null });
  r = act(g, { type: 'spin', characterId: d.id }, { ints: [1] });
  while (r.room.turn.pending) r = choose(r.room, r.room.turn.pending.defaultOptionId);
  const fin = r.events.filter((e) => e.type === 'finished');
  assert.deepEqual(fin.map((e) => [e.charId, e.place, e.retired]), [[b.id, 2, 'late'], [c.id, 3, 'late'], [d.id, 4, 'late']]);
  const half = (p) => Math.round((data.balance.goalPrizes[p - 1] * data.balance.retirePrizeMult) / 5) * 5;
  assert.deepEqual(fin.map((e) => e.prize), [half(2), half(3), half(4)]);
  assert.ok(fin.every((e) => e.lineTag === 'retire_late' && e.cutin === false));
  assert.equal(r.room.status, 'finished');
  assert.ok(r.events.some((e) => e.type === 'log' && /노년 마감/.test(e.text)));
  // an older save in the race without a clock starts one at its next full round
  const old = senior();
  delete old.turn.raceRound;
  delete old.turn.raceRounds;
  old.turn.currentIndex = old.turn.order.length - 1;
  let o = act(old, { type: 'spin', characterId: cur(old) }, { ints: [1] });
  while (o.room.turn.pending) o = choose(o.room, o.room.turn.pending.defaultOptionId);
  assert.deepEqual([o.room.turn.raceRound, o.room.turn.raceRounds], [1, raceRoundsFor(data, o.room.board.eras[o.room.eraIndex].tiles.length)]);
});

test('comeback at game over: gameOver carries it, the result keeps it, the winner part of the MC show is the comeback duo', () => {
  const room = senior({ cash: 100 });
  const ids = room.turn.order;
  room.seniorStart = { ranks: Object.fromEntries(ids.map((id, i) => [id, i === 0 ? 4 : i])), totals: {}, n: 4, turnNo: 1 };
  // everyone but the current character already finished; the current one gets rich and reaches the goal
  const id = cur(room);
  for (const c of room.characters) if (c.id !== id) Object.assign(c, { finished: true, place: 1 + room.characters.indexOf(c), money: 200 });
  Object.assign(ch(room, id), { money: 5000 });
  room.seniorStart.ranks[id] = 4;
  for (const c of room.characters) if (c.id !== id) room.seniorStart.ranks[c.id] = 1;
  const L = room.board.eras[room.eraIndex].tiles.length;
  ch(room, id).position.index = L - 2;
  const r = act(room, { type: 'spin', characterId: id }, { ints: [3] });
  const go = r.events.find((e) => e.type === 'gameOver');
  assert.ok(go, 'game over');
  assert.deepEqual(go.comeback, { charId: id, from: 4, n: 4 });
  assert.deepEqual(r.room.result.comeback, go.comeback);
  assert.ok(r.room.result.highlights[id].some((h) => h.type === 'comeback'));
  const winner = (r.room.result.mc ?? []).filter((l) => l.part === 'winner');
  assert.ok(winner.length >= 2, 'the comeback duo');
});

// ---------- CPU ----------

test('CPU: every senior prompt answered with an enabled option (hard + every personality); easy CPUs never go all-in', () => {
  const room = senior({ cash: 900 });
  setTile(room, 2, { type: 'island', label: '한방역전섬' });
  const id = cur(room);
  const r = act(room, { type: 'spin', characterId: id }, { ints: [2] });
  const rngBefore = r.room.rngState;
  for (const level of ['hard', 'easy', 'normal']) {
    for (const personality of ['cautious', 'normal', 'bold']) {
      const a = cpuAnswer(r.room, id, data, { level, personality });
      assert.ok(r.room.turn.pending.options.some((o) => o.id === a && !o.disabled), `${level}/${personality}: ${a}`);
      if (level === 'easy') assert.notEqual(a, 'bet:all', `${personality} easy CPU never 인생 한 방`);
    }
  }
  assert.equal(r.room.rngState, rngBefore, 'the game RNG is untouched');
  const pick = choose(r.room, 'bet:half').room;
  assert.match(cpuAnswer(pick, id, data, { level: 'hard' }), /^(10|[1-9])$/);
  // contest / auction
  const c2 = senior({ cash: 900 });
  setTile(c2, 2, { type: 'contest', label: '노년 대회' });
  Object.assign(ch(c2, cur(c2)), { stats: { int: 8, str: 8, charm: 8, luck: 8 } });
  const rc = act(c2, { type: 'spin', characterId: cur(c2) }, { ints: [2] });
  assert.match(cpuAnswer(rc.room, cur(c2), data, { level: 'hard', personality: 'normal' }), /^join:/, 'a strong character enters');
  const a2 = senior({ cash: 900 });
  setTile(a2, 2, { type: 'auction', label: '경매' });
  ch(a2, cur(a2)).items = ['designer_bag'];
  const ra = act(a2, { type: 'spin', characterId: cur(a2) }, { ints: [2] });
  assert.equal(cpuAnswer(ra.room, cur(a2), data, { level: 'hard', personality: 'normal' }), 'sell:item:designer_bag', 'the 명품 premium sells');
});

test('CPU (hard): the trailing character gambles at the island, the leader passes or retires', () => {
  const room = senior({ cash: 300 });
  setTile(room, 2, { type: 'island', label: '한방역전섬' });
  const id = cur(room);
  for (const c of room.characters) if (c.id !== id) c.money = 2500;
  const r = act(room, { type: 'spin', characterId: id }, { ints: [2] });
  assert.match(cpuAnswer(r.room, id, data, { level: 'hard', personality: 'normal' }), /^bet:/, 'last place far behind → a bet');
  const lead = senior({ cash: 4000 });
  setTile(lead, 2, { type: 'island', label: '한방역전섬' });
  const lid = cur(lead);
  for (const c of lead.characters) if (c.id !== lid) c.money = 800;
  const rl = act(lead, { type: 'spin', characterId: lid }, { ints: [2] });
  assert.match(cpuAnswer(rl.room, lid, data, { level: 'hard', personality: 'normal' }), /^(pass|retire)$/);
  // the item worth helpers know what is ahead
  assert.ok(seniorUseWorth(data, rl.room, ch(rl.room, lid), 'laptop') > 0);
});

// ---------- whole games ----------

test('random lifetime games in both worlds: senior tiles / items / island happen; lines filled; every event known', () => {
  for (const world of ['real', 'chiikawa']) {
    const seen = new Set();
    for (const seed of [3, 8]) {
      let room = makeRoom({ seed });
      room.config = { ...room.config, world, eraTurns: { baby: 1, elem: 1, middle: 1, high: 1, young: 3, middle_age: 3 }, finalLength: 40, allowCpu: true };
      room = joinRoom(room, 'A', '에이', 0).room;
      room = addCharacter(room, 'A', { name: '사람' }, 0).room;
      for (let i = 0; i < 3; i++) room = addCpuCharacter(room, { personality: ['cautious', 'normal', 'bold'][i] }, 0).room;
      room = startGame(room, { now: 0 }).room;
      for (let i = 0; i < 6000 && room.status === 'playing'; i++) {
        const p = room.turn.pending;
        const id = p ? p.forCharacterIds.find((x) => !Object.hasOwn(p.answers, x)) : room.turn.order[room.turn.currentIndex];
        const c = ch(room, id);
        // the human seat gambles at the island (to see the bet path), the CPUs decide (hard level)
        let action = cpuDecide(room, id, null, { level: 'hard' });
        if (c.ownerSessionId !== 'cpu' && p?.kind === 'island') action = { type: 'choose', characterId: id, promptId: p.promptId, optionId: p.options.find((o) => o.id === 'bet:half' && !o.disabled)?.id ?? 'pass' };
        const r = applyAction(room, action, { now: i });
        room = r.room;
        room.log = [];
        for (const e of r.events) {
          seen.add(e.type === 'prompt' ? `prompt:${e.kind}` : e.type);
          assert.ok(EVENT_TYPES.includes(e.type), e.type);
          assert.ok(!/\{\w+\}/.test(e.line ?? ''), `${e.type}: "${e.line}"`);
          for (const l of e.mc ?? []) assert.ok(!/\{\w+\}/.test(l.line), `${e.type} mc: "${l.line}"`);
        }
      }
      assert.equal(room.status, 'finished', `${world} seed ${seed}`);
    }
    for (const t of ['prompt:island', 'prompt:islandPick', 'islandResult']) assert.ok(seen.has(t), `${world}: ${t}`);
    assert.ok(seen.has('prompt:contest') || seen.has('prompt:auction'), `${world}: a decision tile`);
  }
});
