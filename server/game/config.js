// Room config validation (pure).
import { defaultEraTurns, eraIds, getEras } from '../data/index.js';

export const TURN_ORDERS = ['family', 'index'];
/** MC NPC (호야 & 봄이) appearance frequency (Stage 5.6). */
export const MC_FREQUENCIES = ['many', 'normal', 'few', 'off'];
export const MAX_CHARACTERS_LIMIT = 8;
export const MIN_CHARACTERS_LIMIT = 2;
export const MAX_STARTING_MONEY = 100000;

export function defaultRoomConfig() {
  return {
    mode: 'lifetime',
    eraTurns: defaultEraTurns(),
    maxCharacters: 8,
    startingMoney: 1000,
    allowCpu: false,
    turnOrder: 'family',
    mcFrequency: 'normal',
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

  if (input.mcFrequency !== undefined) {
    if (!MC_FREQUENCIES.includes(input.mcFrequency)) errors.push('MC 등장 빈도는 많이/보통/적게/끄기(many/normal/few/off) 중 하나여야 합니다.');
    else cfg.mcFrequency = input.mcFrequency;
  }

  return errors.length ? { ok: false, errors } : { ok: true, config: cfg };
}
