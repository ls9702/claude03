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

/**
 * Open the room SSE stream.
 * handlers: { state, events, reaction, log, deleted, charArt, open, error }
 * @returns {() => void} close function
 */
export function connectEvents(roomId, handlers) {
  const url = `/api/rooms/${encodeURIComponent(roomId)}/events?token=${encodeURIComponent(token)}`;
  const es = new EventSource(url);
  for (const name of ['state', 'events', 'reaction', 'log', 'deleted', 'charArt']) {
    es.addEventListener(name, (ev) => {
      let data = null;
      try {
        data = JSON.parse(stripBidiJson(ev.data));
      } catch {
        return;
      }
      lastMessageAt = Date.now();
      handlers[name]?.(data);
      if (name === 'charArt') for (const fn of [...artListeners]) fn(data);
    });
  }
  es.onopen = () => {
    sseOpen = true;
    lastMessageAt = Date.now();
    handlers.open?.();
    for (const fn of [...artListeners]) fn({ reconnected: true });
  };
  es.onerror = () => {
    sseOpen = false;
    handlers.error?.(es.readyState === EventSource.CLOSED);
  };
  return () => {
    sseOpen = false;
    es.close();
  };
}
