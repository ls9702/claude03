// fetch + SSE wrapper for the game page.
import { clockBounds, stripBidiJson } from './format.js';

const TOKEN_KEY = 'jinsei.token';
const ROOM_KEY = 'jinsei.roomId';
const NAME_KEY = 'jinsei.name';

// Storage with fallbacks (A15): localStorage → sessionStorage → memory. A browser that blocks site data would otherwise
// create a new session (a ghost player) on every refresh; `storageMode()` tells the UI so it can warn once.
const memory = new Map();
function probe(kind) {
  try {
    const st = kind === 'session' ? window.sessionStorage : window.localStorage;
    const k = '__jinsei_probe';
    st.setItem(k, '1');
    st.removeItem(k);
    return st;
  } catch {
    return null;
  }
}
const stores = typeof window === 'undefined' ? { local: null, session: null } : { local: probe('local'), session: probe('session') };
/** 'local' (normal) | 'session' (lost when the tab closes) | 'memory' (lost on refresh). */
export const storageMode = () => (stores.local ? 'local' : stores.session ? 'session' : 'memory');
function lsGet(key) {
  for (const st of [stores.local, stores.session]) {
    try {
      const v = st?.getItem(key);
      if (v != null) return v;
    } catch {
      /* try the next one */
    }
  }
  return memory.get(key) ?? null;
}
function lsSet(key, value) {
  if (value == null) memory.delete(key);
  else memory.set(key, value);
  const st = stores.local ?? stores.session;
  try {
    if (value == null) st?.removeItem(key);
    else st?.setItem(key, value);
  } catch {
    /* storage unavailable: the memory copy keeps this page working */
  }
}

let token = lsGet(TOKEN_KEY);

// network health (A9): every request that fails at the network level / reaches the server is reported
const netListeners = new Set();
/** fn(ok: boolean) for each HTTP request (false = network failure, true = the server answered). → unsubscribe */
export function onNetwork(fn) {
  netListeners.add(fn);
  return () => netListeners.delete(fn);
}
function notifyNet(ok) {
  for (const fn of [...netListeners]) {
    try {
      fn(ok);
    } catch {
      /* ignore */
    }
  }
}
/** Server − local clock offset (from HTTP Date headers); deadlines (`deadlineAt`) are server ms. */
let clock = null;
export const clockOffset = () => clock?.offset ?? 0;
export const serverNow = () => Date.now() + clockOffset();

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function raw(method, path, body, withToken = true) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (withToken && token) headers['X-Session-Token'] = token;
  let res;
  const sentAt = Date.now();
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    notifyNet(false);
    throw new ApiError('서버에 연결할 수 없습니다.', 0);
  }
  notifyNet(true);
  const date = res.headers?.get?.('Date');
  if (date) clock = clockBounds(clock, { date, sentAt, receivedAt: Date.now() });
  let data = null;
  try {
    // bidi control characters (U+202E …) never reach the UI: a name could flip every following character (A10)
    const text = await res.text();
    data = text ? JSON.parse(stripBidiJson(text)) : null;
  } catch {
    /* empty */
  }
  if (!res.ok) throw new ApiError(data?.error || `요청 실패 (${res.status})`, res.status, data);
  return data;
}

/** Make sure we hold a valid session token (creating one if needed). */
export async function ensureSession() {
  if (token) {
    try {
      await raw('GET', '/api/session');
      return token;
    } catch (err) {
      if (err.status !== 401) throw err;
    }
  }
  const data = await raw('POST', '/api/session', undefined, false);
  token = data.token;
  lsSet(TOKEN_KEY, token);
  return token;
}

/** Call the API; on 401 renew the session once and retry. */
export async function api(method, path, body) {
  try {
    return await raw(method, path, body);
  } catch (err) {
    if (err.status === 401 && err.body?.code === 'NO_SESSION') {
      token = null;
      await ensureSession();
      return raw(method, path, body);
    }
    throw err;
  }
}

export const getMeta = () => raw('GET', '/api/meta', undefined, false);

export const savedRoomId = () => lsGet(ROOM_KEY);
export const setSavedRoomId = (id) => lsSet(ROOM_KEY, id);
export const savedName = () => lsGet(NAME_KEY) || '';
export const setSavedName = (n) => lsSet(NAME_KEY, n);

// ---------- SSE `charArt` fan-out (the customizer's AI slot listens while the room stream is open) ----------
const artListeners = new Set();
let sseOpen = false;
/** Listen to `charArt {charId, status, progress, reason?}` events of the open room stream. → unsubscribe */
export function onCharArt(fn) {
  artListeners.add(fn);
  return () => artListeners.delete(fn);
}
/** True while the room SSE stream is connected (the AI slot polls only when it isn't). */
export const sseConnected = () => sseOpen;
let lastMessageAt = 0;
/** Local ms of the last SSE message (connection watchdog, A9). */
export const lastSseMessageAt = () => lastMessageAt;

// ---------- SSE board cache (bandwidth) ----------
// A `state` frame carries `boardKey`; the static board itself goes out only on the first frame of a stream and when
// the board changes (game start, a loop-map migration). `attachBoard` keeps the last board per stream and puts it
// back, so everything after api.js still sees `room.board`. HTTP responses always carry the full board.
/**
 * Pure: re-attach the cached board to a `state` payload. `cache` = {key, board} (mutated: a payload with a board
 * refills it). @returns {{state, ok}} — ok false = the frame has no board and the cache holds a different key (the
 * caller refetches the room over HTTP); a payload without `boardKey` (lobby / old server) passes through unchanged.
 */
export function attachBoard(cache, state) {
  if (!state || typeof state !== 'object') return { state, ok: true };
  if (Object.hasOwn(state, 'board')) {
    cache.key = state.boardKey ?? null;
    cache.board = state.board ?? null;
    return { state, ok: true };
  }
  if (state.boardKey == null) return { state: { ...state, board: null }, ok: true };
  if (cache.key === state.boardKey && cache.board) return { state: { ...state, board: cache.board }, ok: true };
  return { state, ok: false };
}

// ---------- superseded streams (≥ 4 tabs of one session in a room) ----------
// The server keeps at most 3 streams per session per room; the oldest gets `superseded {roomId, reason, max}` and is
// closed. EventSource would reconnect on its own and evict the next tab (a ping-pong), so the stream stops for good
// here: `sseSuperseded()` returns the payload, `onSuperseded(fn)` / `handlers.superseded` fire once. The UI offers
// 「다시 연결」 = call `connectEvents` again (app.js `enterRoom`), which supersedes the oldest other tab instead.
const supersededListeners = new Set();
let superseded = null;
/** fn({roomId, reason, max}) when this page's room stream was superseded by newer tabs. → unsubscribe */
export function onSuperseded(fn) {
  supersededListeners.add(fn);
  return () => supersededListeners.delete(fn);
}
/** The `superseded` payload of the current room stream, or null (cleared by the next `connectEvents`). */
export const sseSuperseded = () => superseded;

/**
 * Open the room SSE stream.
 * handlers: { state, events, reaction, log, deleted, charArt, open, error, superseded }
 * `state` always gets a room with `board` (re-attached from the stream's cache; on a cache miss the room is refetched
 * over HTTP first). After `superseded` the stream is closed and does NOT reconnect (see above).
 * @returns {() => void} close function
 */
export function connectEvents(roomId, handlers) {
  const url = `/api/rooms/${encodeURIComponent(roomId)}/events?token=${encodeURIComponent(token)}`;
  const es = new EventSource(url);
  const boardCache = { key: null, board: null };
  let stopped = false;
  superseded = null;
  const deliverState = (data) => {
    const { state, ok } = attachBoard(boardCache, data);
    if (ok) return handlers.state?.(state);
    // a frame without the board this stream never got (should not happen): take the full room over HTTP instead
    api('GET', `/api/rooms/${encodeURIComponent(roomId)}`)
      .then((room) => {
        if (stopped || !room) return;
        attachBoard(boardCache, room);
        handlers.state?.(room);
      })
      .catch(() => {});
  };
  for (const name of ['state', 'events', 'reaction', 'log', 'deleted', 'charArt', 'superseded']) {
    es.addEventListener(name, (ev) => {
      if (stopped) return;
      let data = null;
      try {
        data = JSON.parse(stripBidiJson(ev.data));
      } catch {
        return;
      }
      lastMessageAt = Date.now();
      if (name === 'state') return deliverState(data);
      if (name === 'superseded') {
        stopped = true;
        sseOpen = false;
        es.close(); // no auto-reconnect: that would evict the next tab
        superseded = data ?? { roomId };
        handlers.superseded?.(superseded);
        for (const fn of [...supersededListeners]) fn(superseded);
        return;
      }
      handlers[name]?.(data);
      if (name === 'charArt') for (const fn of [...artListeners]) fn(data);
    });
  }
  es.onopen = () => {
    if (stopped) return;
    sseOpen = true;
    lastMessageAt = Date.now();
    handlers.open?.();
    for (const fn of [...artListeners]) fn({ reconnected: true });
  };
  es.onerror = () => {
    if (stopped) return;
    sseOpen = false;
    handlers.error?.(es.readyState === EventSource.CLOSED);
  };
  return () => {
    stopped = true;
    sseOpen = false;
    es.close();
  };
}
