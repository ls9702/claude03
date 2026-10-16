// CPU handicap (pure; balance.json `cpu.handicap`). The game is luck-heavy: final totals spread ±700만원 around
// ≈ 2,500만원, so no choice of decisions alone lets a casual human beat three CPUs 9 times out of 10 (measured with
// scripts/cpu-game.js). The real CPUs therefore also play with a money handicap — only against people: in a room
// without any human character (a CPU-only demo room) nothing changes.
//   - startMoneyMult: CPU starting money = config.startingMoney × this (the lobby / game screens say so);
//   - incomeMult:     CPU income from 월급날 (salary, 용돈, 단짝 생활비), 💰 money tiles and good events × this. It goes
//                     through the per-character effect multipliers (news.js `effectsFor`), i.e. it is applied where
//                     the amount is computed, before it is logged — every number on screen stays consistent;
//   - treasureMult:   a CPU's treasure is appraised at value × this (fakes stay fakes; values are hidden until the
//                     result show, and treasures were what most often lifted a lucky CPU over the people).
// Losses, prizes, transfers between characters, houses and awards are untouched.
// CPU 난이도 (room config `cpuLevel`): the handicap applies only at 'easy' (the default, also for old saves); 'normal' and
// 'hard' rooms play without it.
import { CPU_PERSONALITIES } from './lobby.js';
import { CPU_LEVELS, CPU_LEVEL_INFO, DEFAULT_CPU_LEVEL, cpuLevelOf } from './config.js';

export const CPU_OWNER = 'cpu';

const isCpuChar = (c) => c?.ownerSessionId === CPU_OWNER;

/** Does the handicap apply in this room (CPU 난이도 easy and at least one character played by a person)? */
export const handicapActive = (room) => cpuLevelOf(room) === 'easy' && !!room?.characters?.some((x) => x && !isCpuChar(x));

/** The handicap of character `c` in `room`: `{startMoneyMult, incomeMult, treasureMult}` or null (people / CPU-only rooms / off). */
export function cpuHandicap(room, c, data) {
  if (!isCpuChar(c) || !handicapActive(room)) return null;
  const h = data?.balance?.cpu?.handicap;
  if (!h || h.enabled === false) return null;
  const n = (v) => (Number.isFinite(v) && v >= 0 ? v : 1);
  return { startMoneyMult: n(h.startMoneyMult), incomeMult: n(h.incomeMult), treasureMult: n(h.treasureMult) };
}

/** A treasure's appraised value for `c` (CPU handicap: × treasureMult, rounded to 5, real treasures ≥ 5). */
export function treasureValueFor(room, c, data, value, fake) {
  const h = cpuHandicap(room, c, data);
  if (!h || fake || h.treasureMult === 1) return value;
  return Math.max(5, Math.round((value * h.treasureMult) / 5) * 5);
}

/** Starting money of a character (CPU handicap applied, rounded to 10만원). */
export function startMoneyFor(room, c, data) {
  const base = room?.config?.startingMoney ?? 0;
  const h = cpuHandicap(room, c, data);
  return h ? Math.round((base * h.startMoneyMult) / 10) * 10 : base;
}

/**
 * `/api/meta.cpu` (lobby / admin pickers + the handicap hint): personalities, the difficulty levels `[{id, icon, name,
 * desc}]` (+ `defaultLevel`) and the handicap of the easy level (null when off).
 */
export function cpuMeta(balance) {
  const h = balance?.cpu?.handicap;
  const on = h && h.enabled !== false;
  const n = (v) => (Number.isFinite(v) && v >= 0 ? v : 1);
  return {
    personalities: [...CPU_PERSONALITIES],
    levels: CPU_LEVELS.map((id) => ({ ...CPU_LEVEL_INFO[id] })),
    defaultLevel: DEFAULT_CPU_LEVEL,
    handicap: on ? { startMoneyMult: n(h.startMoneyMult), incomeMult: n(h.incomeMult), treasureMult: n(h.treasureMult) } : null,
  };
}
