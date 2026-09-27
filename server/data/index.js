// Rule-content loader. All server/data/*.json reads go through here.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DATA_DIR = path.dirname(fileURLToPath(import.meta.url));
const cache = new Map();

function deepFreeze(obj) {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const v of Object.values(obj)) deepFreeze(v);
  }
  return obj;
}

/** Load server/data/<name>.json once (cached, deep-frozen). */
export function loadData(name) {
  if (!/^[a-z0-9_-]+$/i.test(name)) throw new Error(`invalid data name: ${name}`);
  if (!cache.has(name)) {
    const raw = readFileSync(path.join(DATA_DIR, `${name}.json`), 'utf8');
    cache.set(name, deepFreeze(JSON.parse(raw)));
  }
  return cache.get(name);
}

/** Drop the cache (e.g. future admin "reload rules"). */
export function clearDataCache() {
  cache.clear();
}

export const getEras = () => loadData('eras');
export const getAvatars = () => loadData('avatars');

/** { baby: 3, elem: 5, ... } from eras.json */
export function defaultEraTurns() {
  const out = {};
  for (const era of getEras().eras) out[era.id] = era.defaultTurns;
  return out;
}

export function eraIds() {
  return getEras().eras.map((e) => e.id);
}

/** Era ids included in a mode, in board order. */
export function erasForMode(mode) {
  const m = getEras().modes[mode];
  return m ? [...m.eras] : [];
}

export const getBoardData = () => loadData('board');
export const getBalance = () => loadData('balance');
export const getLines = () => loadData('lines');
export const getTones = () => loadData('tones');
export const getMc = () => loadData('mc');
/** Stage 6: jobs (17 regular + 6 hidden + part-time), era news flashes, life events (event tiles). */
export const getJobs = () => loadData('jobs');
export const getNews = () => loadData('news');
export const getEvents = () => loadData('events');
/** Stage 7: cards (hand cards), shop items, holidays (명절 대잔치). */
export const getCards = () => loadData('cards');
export const getItems = () => loadData('items');
export const getHolidays = () => loadData('holidays');
/** Stage 8: partners / spouses / children (연애·가족) and houses (부동산). */
export const getPartners = () => loadData('partners');
export const getHouses = () => loadData('houses');
/** Stage 9: treasures (보물 감정), special awards (특별상) and ending titles (칭호). */
export const getTreasures = () => loadData('treasures');
export const getAwards = () => loadData('awards');
export const getTitles = () => loadData('titles');

/** Everything the engine reads, as one object (tests may pass overrides). */
export function gameData() {
  return {
    eras: getEras(),
    board: getBoardData(),
    balance: getBalance(),
    lines: getLines(),
    tones: getTones(),
    mc: getMc(),
    jobs: getJobs(),
    news: getNews(),
    events: getEvents(),
    cards: getCards(),
    items: getItems(),
    holidays: getHolidays(),
    partners: getPartners(),
    houses: getHouses(),
    avatars: getAvatars(),
    treasures: getTreasures(),
    awards: getAwards(),
    titles: getTitles(),
  };
}
