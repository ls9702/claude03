// Lobby rules (pure): each function takes a room and returns a NEW room.
// Result shape: { ok: true, room, logs: [entry], ...extra } | { ok: false, status, error }
import { buildTurnOrder } from './order.js';
import { sanitizeAvatar } from './avatar.js';

export const MAX_PLAYERS = 4;
export const NAME_MAX = 12;
export const LOG_LIMIT = 200;

const fail = (status, error) => ({ ok: false, status, error });

function cleanName(name) {
  if (typeof name !== 'string') return null;
  const n = name.replace(/\s+/g, ' ').trim();
  const len = [...n].length;
  return len >= 1 && len <= NAME_MAX ? n : null;
}

/** Append a log entry to a (cloned) room and return the entry. */
export function pushLog(room, text, now, type = 'info') {
  const entry = { at: now, type, text };
  room.log.push(entry);
  if (room.log.length > LOG_LIMIT) room.log.splice(0, room.log.length - LOG_LIMIT);
  return entry;
}

export function findPlayer(room, sessionId) {
  return room.players.find((p) => p.sessionId === sessionId) || null;
}

export function joinRoom(room, sessionId, name, now = Date.now()) {
  const clean = cleanName(name);
  if (!clean) return fail(400, `이름은 1~${NAME_MAX}자로 입력하세요.`);
  const next = structuredClone(room);
  const existing = findPlayer(next, sessionId);
  if (existing) {
    const logs = [];
    if (existing.name !== clean) {
      logs.push(pushLog(next, `${existing.name} 님이 이름을 ${clean}(으)로 바꿨습니다.`, now));
      existing.name = clean;
    }
    existing.lastSeen = now;
    return { ok: true, room: next, logs, player: existing, rejoined: true };
  }
  if (next.status !== 'lobby') return fail(409, '이미 시작된 방에는 새로 들어갈 수 없습니다.');
  if (next.players.length >= MAX_PLAYERS) return fail(409, `방이 가득 찼습니다. (최대 ${MAX_PLAYERS}명)`);
  next.nextPlayerSeq = (next.nextPlayerSeq || 0) + 1;
  const player = {
    id: `p${next.nextPlayerSeq}`,
    sessionId,
    name: clean,
    connected: false,
    lastSeen: now,
    ready: false,
    joinedAt: now,
  };
  next.players.push(player);
  const logs = [pushLog(next, `${clean} 님이 입장했습니다.`, now, 'join')];
  return { ok: true, room: next, logs, player, rejoined: false };
}

export function addCharacter(room, sessionId, { name, avatar } = {}, now = Date.now()) {
  if (!findPlayer(room, sessionId)) return fail(403, '이 방의 참가자가 아닙니다.');
  if (room.status !== 'lobby') return fail(409, '로비에서만 캐릭터를 만들 수 있습니다.');
  if (room.characters.length >= room.config.maxCharacters) {
    return fail(409, `캐릭터는 최대 ${room.config.maxCharacters}명까지 만들 수 있습니다.`);
  }
  const clean = cleanName(name);
  if (!clean) return fail(400, `캐릭터 이름은 1~${NAME_MAX}자로 입력하세요.`);
  const next = structuredClone(room);
  next.nextCharSeq = (next.nextCharSeq || 0) + 1;
  const character = {
    id: `c${next.nextCharSeq}`,
    seq: next.nextCharSeq,
    name: clean,
    avatar: sanitizeAvatar(avatar),
    ownerSessionId: sessionId,
    createdAt: now,
  };
  next.characters.push(character);
  const owner = findPlayer(next, sessionId);
  owner.ready = false;
  const logs = [pushLog(next, `${owner.name} 님이 캐릭터 「${clean}」을(를) 만들었습니다.`, now)];
  return { ok: true, room: next, logs, character };
}

function ownCharacter(room, sessionId, charId) {
  const c = room.characters.find((x) => x.id === charId);
  if (!c) return { error: fail(404, '캐릭터를 찾을 수 없습니다.') };
  if (c.ownerSessionId !== sessionId) return { error: fail(403, '내 캐릭터만 수정·삭제할 수 있습니다.') };
  if (room.status !== 'lobby') return { error: fail(409, '로비에서만 캐릭터를 바꿀 수 있습니다.') };
  return { c };
}

export function updateCharacter(room, sessionId, charId, { name, avatar } = {}, now = Date.now()) {
  if (!findPlayer(room, sessionId)) return fail(403, '이 방의 참가자가 아닙니다.');
  const found = ownCharacter(room, sessionId, charId);
  if (found.error) return found.error;
  let clean;
  if (name !== undefined) {
    clean = cleanName(name);
    if (!clean) return fail(400, `캐릭터 이름은 1~${NAME_MAX}자로 입력하세요.`);
  }
  const next = structuredClone(room);
  const c = next.characters.find((x) => x.id === charId);
  if (clean) c.name = clean;
  if (avatar !== undefined) c.avatar = sanitizeAvatar(avatar);
  return { ok: true, room: next, logs: [], character: c, at: now };
}

export function removeCharacter(room, sessionId, charId, now = Date.now()) {
  if (!findPlayer(room, sessionId)) return fail(403, '이 방의 참가자가 아닙니다.');
  const found = ownCharacter(room, sessionId, charId);
  if (found.error) return found.error;
  const next = structuredClone(room);
  next.characters = next.characters.filter((x) => x.id !== charId);
  const owner = findPlayer(next, sessionId);
  const logs = [pushLog(next, `${owner.name} 님이 캐릭터 「${found.c.name}」을(를) 지웠습니다.`, now)];
  return { ok: true, room: next, logs };
}

export function setReady(room, sessionId, ready) {
  if (!findPlayer(room, sessionId)) return fail(403, '이 방의 참가자가 아닙니다.');
  if (typeof ready !== 'boolean') return fail(400, 'ready 값은 true/false여야 합니다.');
  if (room.status !== 'lobby') return fail(409, '로비에서만 준비 상태를 바꿀 수 있습니다.');
  const next = structuredClone(room);
  findPlayer(next, sessionId).ready = ready;
  return { ok: true, room: next, logs: [] };
}

/** Connection presence (SSE open/close). Not an error if session isn't a player. */
export function setConnected(room, sessionId, connected, now = Date.now()) {
  const p = findPlayer(room, sessionId);
  if (!p) return { ok: true, room, logs: [], changed: false };
  if (p.connected === connected) {
    const next = structuredClone(room);
    findPlayer(next, sessionId).lastSeen = now;
    return { ok: true, room: next, logs: [], changed: false };
  }
  const next = structuredClone(room);
  const np = findPlayer(next, sessionId);
  np.connected = connected;
  np.lastSeen = now;
  return { ok: true, room: next, logs: [], changed: true };
}

/** Admin: start the game. Real engine setup arrives in Stage 2. */
export function startGame(room, now = Date.now()) {
  if (room.status !== 'lobby') return fail(409, '로비 상태의 방만 시작할 수 있습니다.');
  if (room.characters.length < 2) return fail(400, '캐릭터가 2명 이상이어야 시작할 수 있습니다.');
  const next = structuredClone(room);
  next.status = 'playing';
  next.startedAt = now;
  next.turn = {
    order: buildTurnOrder(next.characters, next.players, next.config.turnOrder),
    currentIndex: 0,
    phase: 'awaitSpin',
    pending: null,
  };
  const logs = [pushLog(next, '게임이 시작되었습니다!', now, 'system')];
  return { ok: true, room: next, logs };
}

/** Admin: force end. */
export function endGame(room, now = Date.now()) {
  if (room.status === 'finished') return fail(409, '이미 종료된 방입니다.');
  const next = structuredClone(room);
  next.status = 'finished';
  next.finishedAt = now;
  const logs = [pushLog(next, '관리자가 게임을 종료했습니다.', now, 'system')];
  return { ok: true, room: next, logs };
}
