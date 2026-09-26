import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function tempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jinsei-test-'));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** A bare lobby room object (no store) for pure rule tests. */
export function makeRoom(overrides = {}) {
  return {
    id: 'abcd1234',
    code: 'ABCDEF',
    status: 'lobby',
    config: {
      mode: 'lifetime',
      eraTurns: { baby: 3, elem: 5, middle: 4, high: 5, young: 15, middle_age: 15, senior: 6 },
      maxCharacters: 8,
      startingMoney: 1000,
      allowCpu: false,
      turnOrder: 'family',
    },
    players: [],
    characters: [],
    turn: null,
    log: [],
    seed: 42,
    version: 1,
    nextPlayerSeq: 0,
    nextCharSeq: 0,
    createdAt: 0,
    ...overrides,
  };
}
