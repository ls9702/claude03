// Synthetic loop boards (contract: loop-map conversion §1) for the client tests and the E2E injection scripts —
// independent of the server's board builder, so the client suite doesn't break while the engine changes.
const TYPES = ['money', 'loss', 'event', 'card', 'habit', 'heart', 'job', 'house', 'treasure', 'temple'];
const NAMES = { baby: '유아', elem: '초등학생', middle: '중학생', high: '고등학생', young: '청년', middle_age: '중년', senior: '노년' };
// ADDENDUM A: kids eras 3 turns each; the final era (senior) is a linear race of `finalLength` tiles (no turn limit)
export const DEFAULT_TURNS = { baby: 3, elem: 3, middle: 3, high: 3, young: 15, middle_age: 15 };
export const FINAL_ERA = 'senior';
export const ROUTE_ERAS = ['young', 'middle_age'];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LABEL = { start: '출발', salary: '월급날', pass: '찬스 광장', stop: '인생 갈림길', merge: '합류 지점', goal: '인생 골인', money: '용돈', loss: '지출', event: '이벤트', card: '카드', habit: '습관', heart: '하트', job: '직업', house: '부동산', treasure: '보물', temple: '사찰', reversal: '인생역전' };
const ICON = { start: '🚩', salary: '💵', pass: '🎪', stop: '🔀', merge: '🔗', goal: '🏁', money: '💰', loss: '💸', event: '❗', card: '🃏', habit: '🎒', heart: '💗', job: '💼', house: '🏠', treasure: '🏺', temple: '🛕', reversal: '🎰' };
let amt = 0;
const tile = (id, type, extra = {}) => ({ id, type, label: LABEL[type] ?? type, icon: ICON[type] ?? '', ...(type === 'money' || type === 'loss' ? { amount: 20 + ((amt += 37) % 90) } : {}), ...extra });

/** Fill a path of `n` slots: payday every ~20, pass tiles between, the rest random. */
function pathTypes(n, rnd, offset = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const k = i + offset;
    if (k > 0 && k % 20 === 0) out.push('salary');
    else if (k % 20 === 10) out.push('pass');
    else out.push(TYPES[Math.floor(rnd() * TYPES.length)]);
  }
  return out;
}

/**
 * @param {{eras?: string[], turns?: object, seed?: number, lapPerTurn?: number, lapMin?: number, lapMax?: number}} o
 */
export function makeLoopBoard({ eras = [...Object.keys(DEFAULT_TURNS), FINAL_ERA], turns = {}, seed = 1, lapPerTurn = 5.4, lapMin = 18, lapMax = 100, finalLength = 40 } = {}) {
  const rnd = rng(seed);
  amt = seed;
  return {
    eras: eras.map((id, k) => {
      if (id === FINAL_ERA && k === eras.length - 1) {
        // linear race to the goal: paydays every 20, reversal islands, 3 trouble spots, goal at the end
        const tiles = [];
        for (let i = 0; i < finalLength; i++) {
          const ty = i === 0 ? 'start' : i === finalLength - 1 ? 'goal' : i % 20 === 0 ? 'salary' : i % 13 === 6 ? 'reversal' : i === finalLength - 2 ? 'loss' : ['money', 'event', 'treasure', 'temple'][Math.floor(rnd() * 4)];
          tiles.push(tile(`${id}:main:${i}`, ty));
        }
        return { id, name: NAMES[id], turns: null, loop: false, final: true, lap: finalLength, tiles };
      }
      const t = turns[id] ?? DEFAULT_TURNS[id] ?? 5;
      const lap = Math.min(lapMax, Math.max(lapMin, Math.round(t * lapPerTurn)));
      const era = { id, name: NAMES[id] ?? id, turns: t, loop: true, lap, tiles: [] };
      if (!ROUTE_ERAS.includes(id)) {
        const types = pathTypes(lap, rnd);
        types[0] = 'start';
        if (!types.includes('salary')) types[Math.floor(lap / 2)] = 'salary';
        era.tiles = types.map((ty, i) => tile(`${id}:main:${i}`, ty));
        return era;
      }
      const R = Math.round(lap * 0.45);
      const M = lap - R;
      const fork = Math.max(2, Math.round(M * 0.3));
      const types = pathTypes(M, rnd);
      types[0] = 'start';
      types[fork] = 'stop';
      types[fork + 1] = 'merge';
      era.tiles = types.map((ty, i) => tile(`${id}:main:${i}`, ty, ty === 'stop' ? { promptId: 'routeChoice' } : {}));
      era.fork = fork;
      era.rejoin = fork + 1;
      era.routes = {};
      for (const key of ['love', 'career', 'money']) {
        const rt = pathTypes(R, rnd, 3);
        era.routes[key] = { tiles: rt.map((ty, j) => ({ ...tile(`${id}:${key}:${j}`, ty), route: key })) };
      }
      return era;
    }),
  };
}

/** A playing room view around a loop board (for pure helpers). */
export function makeLoopRoom({ board = makeLoopBoard(), eraIndex = 0, eraRound = 1, chars = 3 } = {}) {
  const era = board.eras[eraIndex];
  return {
    id: 'r1',
    status: 'playing',
    board,
    eraIndex,
    turn: { order: Array.from({ length: chars }, (_, i) => `c${i + 1}`), currentIndex: 0, phase: 'awaitSpin', pending: null, turnNo: 1, round: 1, eraRound: era.loop === false ? null : eraRound, eraTurns: era.loop === false ? null : era.turns },
    characters: Array.from({ length: chars }, (_, i) => ({ id: `c${i + 1}`, name: `캐릭${i + 1}`, position: { eraIndex, route: 'main', index: 0 }, laps: i, money: 100, debt: 0 })),
  };
}
