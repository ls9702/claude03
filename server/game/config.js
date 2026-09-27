// Room config validation (pure).
import { defaultEraTurns, eraIds, getBoardData, getEras } from '../data/index.js';

export const TURN_ORDERS = ['family', 'index'];
/** MC NPC (호야 & 봄이) appearance frequency (Stage 5.6). */
export const MC_FREQUENCIES = ['many', 'normal', 'few', 'off'];
export const MAX_CHARACTERS_LIMIT = 8;
export const MIN_CHARACTERS_LIMIT = 2;
export const MAX_STARTING_MONEY = 100000;
/** Host tool: seconds per spin / single-character decision before the server acts (0 = off). */
export const TURN_TIMEOUTS = [0, 30, 60, 90, 120];
/** Route eras need a 갈림길 stop + merge + ≥1 route tile. */
export const ROUTE_ERA_MIN_TURNS = 3;

/**
 * Minimum turns of an era in a mode: route eras ≥ 3; the mode's last era must keep its fixed stops
 * (e.g. 수능 at index 0 of 고등학생 in kids mode) apart from the goal tile.
 */
export function minEraTurns(eraId, mode) {
  const { limits, modes } = getEras();
  const board = getBoardData();
  let min = limits.minTurns;
  if (board.routeEras.includes(eraId)) min = Math.max(min, ROUTE_ERA_MIN_TURNS);
  const last = modes[mode]?.eras?.at(-1);
  if (eraId === last) {
    const stops = board.fixedStops?.[eraId] ?? [];
    if (stops.length) min = Math.max(min, Math.max(...stops.map((st) => st.index)) + 2);
  }
  return min;
}

export function defaultRoomConfig() {
  return {
    mode: 'lifetime',
    eraTurns: defaultEraTurns(),
    maxCharacters: 8,
    startingMoney: 1000,
    allowCpu: false,
    turnOrder: 'family',
    mcFrequency: 'normal',
    turnTimeoutSec: 0,
    growthOutfits: true, // Stage 6: era / job costumes in game (client `effectiveAvatar`)
    holidays: true, // Stage 7: 명절 대잔치 when middle / young / middle_age / senior first open
  };
}

/**
 * Validate & normalize admin room config input. Missing fields take defaults;
 * eraTurns may be partial (merged over eras.json defaults).
 * @returns {{ok: true, config: object} | {ok: false, errors: string[]}}
 */
export function validateRoomConfig(input = {}) {
  const errors = [];
  const cfg = defaultRoomConfig();
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['설정 형식이 올바르지 않습니다.'] };
  }
  const { modes, limits, eras } = getEras();

  if (input.mode !== undefined) {
    if (typeof input.mode !== 'string' || !Object.hasOwn(modes, input.mode)) {
      errors.push(`모드는 ${Object.keys(modes).join('/')} 중 하나여야 합니다.`);
    } else cfg.mode = input.mode;
  }

  if (input.eraTurns !== undefined) {
    if (input.eraTurns === null || typeof input.eraTurns !== 'object' || Array.isArray(input.eraTurns)) {
      errors.push('시대별 턴 수 형식이 올바르지 않습니다.');
    } else {
      const known = new Set(eraIds());
      for (const [key, value] of Object.entries(input.eraTurns)) {
        if (!known.has(key)) {
          errors.push(`알 수 없는 시대: ${key}`);
          continue;
        }
        const name = eras.find((e) => e.id === key)?.name ?? key;
        if (!Number.isInteger(value) || value < limits.minTurns || value > limits.maxTurns) {
          errors.push(`${name} 턴 수는 ${limits.minTurns}~${limits.maxTurns} 사이의 정수여야 합니다.`);
        } else cfg.eraTurns[key] = value;
      }
    }
  }

  if (input.maxCharacters !== undefined) {
    const v = input.maxCharacters;
    if (!Number.isInteger(v) || v < MIN_CHARACTERS_LIMIT || v > MAX_CHARACTERS_LIMIT) {
      errors.push(`최대 캐릭터 수는 ${MIN_CHARACTERS_LIMIT}~${MAX_CHARACTERS_LIMIT} 사이의 정수여야 합니다.`);
    } else cfg.maxCharacters = v;
  }

  if (input.startingMoney !== undefined) {
    const v = input.startingMoney;
    if (!Number.isInteger(v) || v < 0 || v > MAX_STARTING_MONEY) {
      errors.push(`초기 자금은 0~${MAX_STARTING_MONEY} 사이의 정수(만원)여야 합니다.`);
    } else cfg.startingMoney = v;
  }

  if (input.allowCpu !== undefined) {
    if (typeof input.allowCpu !== 'boolean') errors.push('CPU 허용 값은 true/false여야 합니다.');
    else cfg.allowCpu = input.allowCpu;
  }

  if (input.turnOrder !== undefined) {
    if (!TURN_ORDERS.includes(input.turnOrder)) errors.push('턴 순서는 family 또는 index여야 합니다.');
    else cfg.turnOrder = input.turnOrder;
  }

  if (input.turnTimeoutSec !== undefined) {
    if (!TURN_TIMEOUTS.includes(input.turnTimeoutSec)) errors.push('턴 제한 시간은 끄기(0)/30/60/90/120초 중 하나여야 합니다.');
    else cfg.turnTimeoutSec = input.turnTimeoutSec;
  }

  // Per-era minimums depend on the mode (checked on the merged config, so defaults are covered too).
  for (const eraId of getEras().modes[cfg.mode]?.eras ?? []) {
    const min = minEraTurns(eraId, cfg.mode);
    const v = cfg.eraTurns[eraId];
    if (Number.isInteger(v) && v < min) {
      const name = eras.find((e) => e.id === eraId)?.name ?? eraId;
      errors.push(
        getBoardData().routeEras.includes(eraId)
          ? `${name} 턴 수는 갈림길·합류 칸이 있어 ${min} 이상이어야 합니다.`
          : `${name} 턴 수는 이 모드에서 ${min} 이상이어야 합니다. (수능 칸과 골인 칸이 겹치지 않게)`,
      );
    }
  }

  if (input.growthOutfits !== undefined) {
    if (typeof input.growthOutfits !== 'boolean') errors.push('성장 의상 값은 true/false여야 합니다.');
    else cfg.growthOutfits = input.growthOutfits;
  }

  if (input.holidays !== undefined) {
    if (typeof input.holidays !== 'boolean') errors.push('명절 대잔치 값은 true/false여야 합니다.');
    else cfg.holidays = input.holidays;
  }

  if (input.mcFrequency !== undefined) {
    if (!MC_FREQUENCIES.includes(input.mcFrequency)) errors.push('MC 등장 빈도는 많이/보통/적게/끄기(many/normal/few/off) 중 하나여야 합니다.');
    else cfg.mcFrequency = input.mcFrequency;
  }

  return errors.length ? { ok: false, errors } : { ok: true, config: cfg };
}
