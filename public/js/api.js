// fetch + SSE wrapper for the game page.
const TOKEN_KEY = 'jinsei.token';
const ROOM_KEY = 'jinsei.roomId';
const NAME_KEY = 'jinsei.name';

function lsGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

let token = lsGet(TOKEN_KEY);

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
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError('서버에 연결할 수 없습니다.', 0);
  }
  let data = null;
  try {
    data = await res.json();
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

/**
 * Open the room SSE stream.
 * handlers: { state, events, reaction, log, deleted, open, error }
 * @returns {() => void} close function
 */
export function connectEvents(roomId, handlers) {
  const url = `/api/rooms/${encodeURIComponent(roomId)}/events?token=${encodeURIComponent(token)}`;
  const es = new EventSource(url);
  for (const name of ['state', 'events', 'reaction', 'log', 'deleted']) {
    es.addEventListener(name, (ev) => {
      let data = null;
      try {
        data = JSON.parse(ev.data);
      } catch {
        return;
      }
      handlers[name]?.(data);
    });
  }
  es.onopen = () => handlers.open?.();
  es.onerror = () => handlers.error?.(es.readyState === EventSource.CLOSED);
  return () => es.close();
}
