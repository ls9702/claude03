// Re-export of the isomorphic 세계 설정 rules (public/js/shared/world.js) + the server's world data resolution.
// `roomData(room, data?)` = the game data of the room's world: gameData() (or `data`, e.g. a test override) with the
// world's overlay (server/data/worlds/<world>.json) merged — every engine entry point (applyAction / startGame /
// endGame / migrateLoopBoard), the result, the CPU and the scripts read world-correct jobs, items, cards, lines …
// without per-call checks. A room without `config.world` plays the real world (= the data as is).
import { gameData, getWorldOverlays } from '../data/index.js';
import { worldData, worldOf } from '../../public/js/shared/world.js';

export * from '../../public/js/shared/world.js';

/** Game data of `world` (gameData() or `data` with the world's overlay; memoized, deep-frozen). */
export const dataForWorld = (world, data = null) => worldData(data ?? gameData(), world, getWorldOverlays());

/** Game data of a room's world. */
export const roomData = (room, data = null) => dataForWorld(worldOf(room), data);
