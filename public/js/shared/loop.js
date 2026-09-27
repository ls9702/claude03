// Loop maps (원작식 순환 맵) — pure client helpers (no imports, no DOM; node-tested in test/client-loop.test.js).
//
// Every era is its own looping map; all characters are always in the same era (`room.eraIndex`) and an era lasts a
// fixed number of rounds (`turn.eraRound` / `turn.eraTurns`). Paydays (`salary`, 💵 월급날) are forced stops, pass tiles
// (`pass`, 🎪 찬스 광장) pause the walk for a `passTile` prompt, route eras fork into three equal-length branches.
//
//   loopConfig(meta) / lapSize(turns, cfg)     map size from `meta.board.loop` (fallback 5.4 / 18 / 100)
//   currentEraIndex(room) / eraClock(room)     shared era + round counter (「청년 7/15턴」, last-turn flag)
//   forkOf(era) / lapOrder(era, route)         fork / rejoin indices, one lap's tile ids in walking order
//   racetrack(era)                             2D board model: a hairpin racetrack grid (branch zone = 3 lanes)
//   haltNote(moved)                            「💵 월급날! 멈춤」「🎪 찬스 광장」「🔀 갈림길」 notes for a moved event
//   passOptionExtras(pending, option, {won})   passTile option icon + badges (시주 / 성공 확률 / 상점 / 이직)
//   playEstimate({turns, characters})          admin estimate (Σ turns × characters × ~15 s)
//
// ADDENDUM A: the final era of lifetime / adult mode (senior, `loop: false, final: true`) is a LINEAR race to the goal
// with no turn limit (HUD 「노년 · 골인 경쟁」, goal order / prizes / bonus spins back for that era only).

export const LOOP_DEFAULTS = Object.freeze({ lapPerTurn: 5.4, lapMin: 18, lapMax: 100 });
/** Seconds per character turn on the loop board (admin estimate). */
export const SEC_PER_TURN = 15;
/** A lifetime game this long per character is flagged as long in the admin form. */
export const LONG_GAME_TURNS = 40;
export const PASS_TILE = 'pass';
export const PAYDAY_TILE = 'salary';

const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);

/** `meta.board.loop` {lapPerTurn, lapMin, lapMax} (fallback 5.4 / 18 / 100). */
export function loopConfig(meta) {
  const l = meta?.board?.loop ?? meta?.loop ?? {};
  return {
    lapPerTurn: num(l.lapPerTurn, LOOP_DEFAULTS.lapPerTurn),
    lapMin: num(l.lapMin, LOOP_DEFAULTS.lapMin),
    lapMax: num(l.lapMax, LOOP_DEFAULTS.lapMax),
  };
}

/** Tiles of one lap for an era of `turns` turns: clamp(round(turns × lapPerTurn), lapMin, lapMax). */
export function lapSize(turns, cfg = LOOP_DEFAULTS) {
  const t = Math.max(0, Number(turns) || 0);
  return Math.min(cfg.lapMax, Math.max(cfg.lapMin, Math.round(t * cfg.lapPerTurn)));
}

/** True when the board uses looping eras (server `era.loop`; the final race era is linear). */
export const isLoopBoard = (board) => !!board?.eras?.some((e) => e?.loop === true);
/** The final race era (ADDENDUM A): linear, no turn limit, ends at the goal. */
export const isRaceEra = (era) => !!era && (era.loop === false || era.final === true) && era.loop !== true;

/** The shared era of the room: `room.eraIndex`, else the first unfinished character's era, else 0. */
export function currentEraIndex(room) {
  const n = room?.board?.eras?.length ?? 0;
  const clampI = (i) => Math.max(0, Math.min(Math.max(0, n - 1), i));
  if (Number.isInteger(room?.eraIndex)) return clampI(room.eraIndex);
  const chars = room?.characters ?? [];
  const c = chars.find((x) => !x?.finished && Number.isInteger(x?.position?.eraIndex)) ?? chars.find((x) => Number.isInteger(x?.position?.eraIndex));
  return clampI(c?.position?.eraIndex ?? 0);
}

/**
 * Era clock for the HUD.
 * @returns {{index, id, name, round: number|null, turns: number|null, left: number|null, last: boolean, final: boolean}}
 *   `last` = this round is the era's last one; `final` = … and it's the last era (the game ends after it)
 */
export function eraClock(room) {
  const index = currentEraIndex(room);
  const eras = room?.board?.eras ?? [];
  const era = eras[index] ?? null;
  const turn = room?.turn ?? {};
  const race = isRaceEra(era) && isLoopBoard(room?.board);
  const turns = race ? null : Number.isInteger(turn.eraTurns) ? turn.eraTurns : Number.isInteger(era?.turns) ? era.turns : null;
  const round = race ? null : Number.isInteger(turn.eraRound) ? turn.eraRound : null;
  const left = turns != null && round != null ? Math.max(0, turns - round) : null;
  const last = left === 0 && round != null;
  return { index, id: era?.id ?? null, name: era?.name ?? '', round, turns, left, last, final: last && index === eras.length - 1, race, count: eras.length };
}

/** 「청년 7/15턴」 (final race → 「노년 · 골인 경쟁」; no round known → 「청년 시대」). */
export function eraClockText(clock) {
  if (!clock) return '';
  if (clock.race) return `${clock.name} · 골인 경쟁`;
  if (clock.round == null || clock.turns == null) return `${clock.name} 시대`.trim();
  return `${clock.name} ${Math.min(clock.round, clock.turns)}/${clock.turns}턴`.trim();
}

/** Hint under the spin button / HUD chip on the era's last round. */
export function lastTurnHint(clock) {
  if (!clock?.last) return '';
  return clock.final ? '🏁 마지막 시대의 마지막 턴! 이번 턴이 끝나면 결과 발표' : '⏳ 이번 시대 마지막 턴!';
}

/** fork / rejoin main indices + route length of a route era (server fields, else the stop / merge tiles). */
export function forkOf(era) {
  if (!era?.routes) return null;
  const keys = Object.keys(era.routes);
  const tiles = era.tiles ?? [];
  let fork = Number.isInteger(era.fork) ? era.fork : tiles.findIndex((t) => t?.type === 'stop' && (t.promptId ?? 'routeChoice') === 'routeChoice');
  if (fork < 0) fork = 0;
  const rejoin = Number.isInteger(era.rejoin) ? era.rejoin : (fork + 1) % Math.max(1, tiles.length);
  return { fork, rejoin, R: era.routes[keys[0]]?.tiles?.length ?? 0, keys };
}

/** Tile ids of one lap in walking order from the start tile (route eras: through `route`, default career; the final race: start → goal). */
export function lapOrder(era, route = 'career') {
  const tiles = era?.tiles ?? [];
  const fk = forkOf(era);
  const out = [];
  for (let i = 0; i < tiles.length; i++) {
    out.push(tiles[i].id);
    if (fk && i === fk.fork) {
      const key = era.routes[route] ? route : fk.keys[0];
      for (const t of era.routes[key]?.tiles ?? []) out.push(t.id);
    }
  }
  return out;
}

/** Tile id of a character position (index < 0 → the era's first tile). */
export function tileIdForPosition(board, pos) {
  const era = board?.eras?.[pos?.eraIndex ?? 0];
  if (!era) return null;
  if (!pos || pos.index < 0) return era.tiles?.[0]?.id ?? null;
  const track = pos.route === 'main' || !pos.route ? era.tiles : era.routes?.[pos.route]?.tiles;
  return track?.[pos.index]?.id ?? era.tiles?.[0]?.id ?? null;
}

/**
 * 2D board model: the era's loop as a hairpin racetrack on a CSS grid. The top row runs left → right, a turn cap on
 * the right, the bottom row comes back right → left, a turn cap on the left closes the loop. A route era puts its
 * branch zone in the top row, centred: the fork tile (spanning the three lane rows), a label column, the love /
 * career / money lanes (love above = outside, money below = inside the loop, like the 3D board) and the rejoin tile.
 * Grid columns: 1 = left cap, 2 … cols−1 = tiles, cols = right cap.
 * @returns {{cols, rows, mainRow, backRow, laneRows?: Record<string, number>, cells: {id, row, col, rowSpan?, route, index, dir: 'r'|'l', start?: true}[],
 *   labels: {route, row, col}[], caps: {side: 'left'|'right', col, row, rowSpan}[], road: {row, col, colSpan}|null}}
 */
export function racetrack(era) {
  const main = era?.tiles ?? [];
  const M = main.length;
  const linear = era?.loop === false; // final race: no left cap (the goal ends the bottom row)
  const fk = forkOf(era);
  const route = !!fk && fk.R > 0 && M >= 2;
  const lanes = route ? ['love', 'career', 'money'].filter((k) => era.routes[k]) : [];
  const laneRows = route ? Object.fromEntries(lanes.map((k, i) => [k, i + 1])) : null;
  const mainRow = route ? laneRows.career ?? 2 : 1;
  const backRow = route ? lanes.length + 1 : 2;
  const rows = backRow;
  const cells = [];
  const labels = [];
  let topCols;
  let bottom = [];
  const tileCell = (i, row, col, dir, extra = {}) => ({ id: main[i].id, row, col, route: 'main', index: i, dir, ...(i === 0 ? { start: true } : {}), ...extra });
  if (!route) {
    topCols = Math.max(1, Math.ceil(M / 2));
    for (let k = 0; k < topCols && k < M; k++) cells.push(tileCell(k, mainRow, 2 + k, 'r'));
    for (let i = topCols; i < M; i++) bottom.push(i);
  } else {
    const { fork, R } = fk;
    const rejoin = (fork + 1) % M;
    const zoneCols = R + 3;
    const others = M - 2; // main tiles that are neither the fork nor the rejoin
    const total = M + R + 1;
    topCols = Math.max(Math.ceil(total / 2), zoneCols + Math.min(2, others));
    let side = Math.max(0, Math.min(others, topCols - zoneCols));
    const before = Math.floor(side / 2);
    const after = side - before;
    topCols = zoneCols + before + after;
    let col = 2;
    for (let k = before; k >= 1; k--) cells.push(tileCell((fork - k + M) % M, mainRow, col++, 'r'));
    const span = lanes.length;
    cells.push(tileCell(fork, 1, col, 'r', { rowSpan: span, fork: true }));
    lanes.forEach((key, i) => labels.push({ route: key, row: i + 1, col: col + 1 }));
    lanes.forEach((key, i) => {
      era.routes[key].tiles.forEach((t, j) => cells.push({ id: t.id, row: i + 1, col: col + 2 + j, route: key, index: j, dir: 'r' }));
    });
    cells.push(tileCell(rejoin, 1, col + 2 + R, 'r', { rowSpan: span, rejoin: true }));
    col += R + 3;
    for (let k = 0; k < after; k++) cells.push(tileCell((rejoin + 1 + k) % M, mainRow, col++, 'r'));
    for (let k = 0; k < others - before - after; k++) bottom.push((rejoin + 1 + after + k) % M);
  }
  // bottom row: right → left, starting under the top row's last column
  bottom.forEach((i, k) => cells.push(tileCell(i, backRow, 2 + topCols - 1 - k, 'l')));
  const gap = topCols - bottom.length;
  const road = gap > 0 ? { row: backRow, col: 2, colSpan: gap } : null;
  const cols = topCols + 2;
  const caps = [{ side: 'right', col: cols, row: mainRow, rowSpan: backRow - mainRow + 1 }];
  if (!linear) caps.push({ side: 'left', col: 1, row: mainRow, rowSpan: backRow - mainRow + 1 });
  return { cols, rows, mainRow, backRow, laneRows, cells, labels, caps, road, linear };
}

/** Board note for a `moved` event (halted by a forced stop / paused on a pass tile / a wrap past the start). */
export function haltNote(e) {
  if (!e || e.type !== 'moved') return null;
  if (e.halted === 'salary') return { text: '💵 월급날! 멈춤', kind: 'plus', icon: '💵' };
  if (e.halted === 'pass') return { text: `🎪 찬스 광장${Number(e.remaining) > 0 ? ` (남은 ${Number(e.remaining)}칸)` : ''}`, kind: 'info', icon: '🎪' };
  if (e.halted === 'stop') return { text: '🔀 갈림길! 멈춤', kind: 'info', icon: '🔀' };
  if (e.resumed) return { text: '🚶 이어서 출발!', kind: 'info', icon: '🚶' };
  if (e.wrapped || Number(e.laps) > 0) return { text: '🔁 한 바퀴!', kind: 'plus', icon: '🔁' };
  return null;
}

/** Laps a character has walked in the current era map (`character.laps`). */
export const lapsOf = (c) => Math.max(0, Math.floor(Number(c?.laps) || 0));

const PASS_ICON = { wish: '🙏', wishAll: '🙏', buy: '🛍️', jobChange: '💼', pass: '🚶' };
/** 찬스 버프 (ADDENDUM A1) as a short badge: 「💵 월급 두 배」. */
export const buffText = (b) => (b ? `${b.icon ?? '🎪'} ${b.name ?? b.id ?? '찬스 버프'}`.trim() : '');
/**
 * passTile option extras (the job change option also gets the job badges from growth.optionExtras via `jobId`).
 * The server's one-line `desc` already names cost / chance for the wishes → badges only when it doesn't; 「그냥 지나가기」
 * shows the 찬스 버프 it would grant (`option.buff`, rolled when the prompt opened).
 * @returns {{icon: string, badges: string[]}}
 */
export function passOptionExtras(pending, option, { won = (v) => `${v}만원` } = {}) {
  if (pending?.kind !== 'passTile' || !option) return { icon: option?.icon ?? '', badges: [] };
  const id = String(option.id ?? '');
  const icon = option.icon || PASS_ICON[id] || '';
  const badges = [];
  if ((id === 'wish' || id === 'wishAll') && !option.desc) {
    const cost = Number(option.cost ?? option.price);
    if (cost > 0) badges.push(`🙏 시주 ${won(cost)}`);
    const ch = Number(option.chance);
    if (ch > 0) badges.push(`✨ 성공 ${Math.round(ch <= 1 ? ch * 100 : ch)}%`);
    if (Number(option.money) > 0) badges.push(`💰 성공 시 +${won(Number(option.money))}`);
    badges.push(id === 'wishAll' ? '🎁 모두에게 선물' : '🍀 운 +1');
  } else if (id === 'pass' && option.buff && !String(option.desc ?? '').includes(option.buff.name ?? '\u0000')) {
    const t = buffText(option.buff);
    badges.push(/버프$/.test(t) ? t : `${t} 버프`); // the server desc usually names it already
  }
  return { icon, badges };
}

const CLUB_FALLBACK = { study: '📚 공부 동아리', sports: '⚽ 운동부', band: '🎸 밴드부', boardgame: '🎲 보드게임부', broadcast: '🎙️ 방송부' };
/**
 * 중학교 동아리 (ADDENDUM A3, `character.club`): an object {name, icon} or an id looked up in `meta.clubs` /
 * `meta.balance.clubs` (array or map), else a small fallback table, else the raw id.
 */
export function clubLabel(club, meta = null) {
  if (!club) return '';
  if (typeof club === 'object') return `${club.icon ?? ''} ${club.name ?? club.id ?? ''}`.trim();
  const id = String(club);
  const src = meta?.clubs ?? meta?.balance?.clubs ?? null;
  const list = Array.isArray(src)
    ? src
    : Array.isArray(src?.options) // balance.json `clubs.options`
      ? src.options
      : Array.isArray(src?.clubs)
        ? src.clubs
        : src && typeof src === 'object'
          ? Object.entries(src).filter(([, v]) => v && typeof v === 'object').map(([k, v]) => ({ id: k, ...v }))
          : [];
  const def = list.find((x) => x?.id === id);
  if (def?.name) return `${def.icon ?? ''} ${def.name}`.trim();
  return CLUB_FALLBACK[id] ?? id;
}

/**
 * Admin estimate: Σ era turns × characters × SEC_PER_TURN.
 * @returns {{turns: number, minutes: number, long: boolean}}
 */
export function playEstimate({ turns = 0, characters = 8, secPerTurn = SEC_PER_TURN } = {}) {
  const t = Math.max(0, Number(turns) || 0);
  const n = Math.max(1, Number(characters) || 1);
  return { turns: t, minutes: Math.max(1, Math.round((t * n * secPerTurn) / 60)), long: t >= LONG_GAME_TURNS };
}
