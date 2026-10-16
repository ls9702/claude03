// Lobby rules (pure): each function takes a room and returns a NEW room.
// Result shape: { ok: true, room, logs: [entry], ...extra } | { ok: false, status, error }
import { buildTurnOrder } from './order.js';
import { cloneState } from './clone.js';
import { randomLook, sanitizeAvatar } from './avatar.js';
import { josa, particle } from './korean.js';
import { CPU_LEVELS, CPU_LEVEL_ERROR, CPU_LEVEL_INFO, cpuLevelOf } from './config.js';

export const MAX_PLAYERS = 4;
export const NAME_MAX = 12;
export const LOG_LIMIT = 500;

const fail = (status, error) => ({ ok: false, status, error });

/** Longest accepted name in UTF-16 units (a guard against zalgo / huge ZWJ chains that are 1 grapheme each). */
export const NAME_MAX_UNITS = 64;

// Invisible / direction-changing characters: format controls (Cf: ZWSP, ZWNJ, LRM/RLM, LRE…RLO, LRI…PDI, word
// joiner, BOM, soft hyphen, tag characters…), other controls (Cc) and the Hangul / braille fillers that render blank.
const INVISIBLE_RE = /[\p{Cc}\p{Cf}\u115F\u1160\u3164\uFFA0\u2800]/gu;
const ZWJ = '\u200D';
// Invisible marks that are not format controls: combining grapheme joiner, Khmer inherent vowels, Mongolian free
// variation selectors — dropped everywhere. Variation selectors (VS1–16, VS17–256) survive only right after a visible
// base character (❤️ = U+2764 U+FE0F, 1️⃣, ideographic variants); a name needs at least one visible base character.
const INVISIBLE_MARK_RE = /[\u034F\u17B4\u17B5\u180B-\u180F]/u;
const VARIATION_SELECTOR_RE = /[\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/u;
const LONE_SURROGATE_RE = /[\uD800-\uDFFF]/u;
/** A character that shows something on its own (not whitespace, not a combining / enclosing mark). */
const VISIBLE_BASE_RE = /[^\s\p{M}]/u;
const PICTO_RE = /\p{Extended_Pictographic}/u;
const EMOJI_MOD_RE = /[\uFE0E\uFE0F\u{1F3FB}-\u{1F3FF}]/u; // variation selectors / skin tones inside an emoji

let segmenter = null;
/** User-perceived characters (grapheme clusters), same count as the client's name counter. */
export function graphemeCount(s) {
  try {
    segmenter ??= new Intl.Segmenter('ko', { granularity: 'grapheme' });
    let n = 0;
    for (const _ of segmenter.segment(s)) n++;
    return n;
  } catch {
    return [...s].length;
  }
}

/**
 * Normalize a display name: strip invisible / bidi control characters (a zero-width joiner survives only inside an
 * emoji sequence such as 👨‍👩‍👧), collapse whitespace, trim. @returns the clean name, or null when it is empty or
 * longer than NAME_MAX graphemes.
 */
export function cleanName(name) {
  if (typeof name !== 'string') return null;
  const cps = [...name.normalize('NFC')];
  let out = '';
  let last = ''; // the last kept code point
  for (let i = 0; i < cps.length; i++) {
    const ch = cps[i];
    if (ch.length === 1 && LONE_SURROGATE_RE.test(ch)) continue; // half of a broken surrogate pair
    if (INVISIBLE_MARK_RE.test(ch)) continue;
    if (VARIATION_SELECTOR_RE.test(ch)) {
      // only on a visible base character (not after a space, a mark or another selector)
      if (last && VISIBLE_BASE_RE.test(last) && !VARIATION_SELECTOR_RE.test(last)) {
        out += ch;
        last = ch;
      }
      continue;
    }
    if (ch === ZWJ) {
      const prev = [...out].findLast((x) => !EMOJI_MOD_RE.test(x)) ?? '';
      const next = cps[i + 1] ?? '';
      if (PICTO_RE.test(prev) && PICTO_RE.test(next)) {
        out += ch;
        last = ch;
      }
      continue;
    }
    const kept = ch.replace(INVISIBLE_RE, '');
    if (kept) {
      out += kept;
      last = kept;
    }
  }
  const n = out.replace(/\s+/g, ' ').trim();
  if (!n || n.length > NAME_MAX_UNITS) return null;
  if (!VISIBLE_BASE_RE.test(n.replace(VARIATION_SELECTOR_RE, ''))) return null; // only marks / selectors left
  const len = graphemeCount(n);
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

/** Max spectators per room (they never count toward MAX_PLAYERS). */
export const MAX_SPECTATORS = 20;

export const isSpectator = (player) => player?.role === 'spectator';
/** Players that play (have or may create characters); spectators excluded. */
export const activePlayers = (room) => room.players.filter((p) => !isSpectator(p));

/**
 * Join (or rejoin) a room. `spectator: true` joins as a watcher (`role: 'spectator'`): allowed in lobby,
 * playing and finished rooms, not counted toward MAX_PLAYERS, no characters / actions (reactions only).
 * A session keeps the role it first joined with.
 */
export function joinRoom(room, sessionId, name, now = Date.now(), { spectator = false } = {}) {
  const clean = cleanName(name);
  if (!clean) return fail(400, `이름은 1~${NAME_MAX}자로 입력하세요.`);
  const next = cloneState(room);
  const existing = findPlayer(next, sessionId);
  if (existing) {
    const logs = [];
    if (existing.name !== clean) {
      logs.push(pushLog(next, `${existing.name} 님이 이름을 ${josa(clean, '으로/로')} 바꿨습니다.`, now));
      existing.name = clean;
    }
    existing.lastSeen = now;
    return { ok: true, room: next, logs, player: existing, rejoined: true };
  }
  if (spectator) {
    if (next.players.filter(isSpectator).length >= MAX_SPECTATORS) return fail(409, `관전자가 너무 많아요. (최대 ${MAX_SPECTATORS}명)`);
  } else {
    if (next.status !== 'lobby') return fail(409, '이미 시작된 방에는 새로 들어갈 수 없습니다. 관전으로 들어가 보세요.');
    if (activePlayers(next).length >= MAX_PLAYERS) return fail(409, `방이 가득 찼습니다. (최대 ${MAX_PLAYERS}명) 관전으로 들어갈 수 있어요.`);
  }
  next.nextPlayerSeq = (next.nextPlayerSeq || 0) + 1;
  const player = {
    id: `p${next.nextPlayerSeq}`,
    sessionId,
    name: clean,
    role: spectator ? 'spectator' : 'player',
    connected: false,
    lastSeen: now,
    ready: false,
    joinedAt: now,
  };
  next.players.push(player);
  const logs = [pushLog(next, spectator ? `${clean} 님이 관전하러 왔습니다.` : `${clean} 님이 입장했습니다.`, now, 'join')];
  return { ok: true, room: next, logs, player, rejoined: false };
}

const SPECTATOR_ERROR = '관전자는 캐릭터를 만들거나 게임에 참여할 수 없어요.';
/** Fail result for spectators (routes use it for every game action). */
export const spectatorFail = () => fail(403, SPECTATOR_ERROR);

export function addCharacter(room, sessionId, { name, avatar } = {}, now = Date.now()) {
  if (!findPlayer(room, sessionId)) return fail(403, '이 방의 참가자가 아닙니다.');
  if (isSpectator(findPlayer(room, sessionId))) return spectatorFail();
  if (room.status !== 'lobby') return fail(409, '로비에서만 캐릭터를 만들 수 있습니다.');
  if (room.characters.length >= room.config.maxCharacters) {
    return fail(409, `캐릭터는 최대 ${room.config.maxCharacters}명까지 만들 수 있습니다.`);
  }
  const clean = cleanName(name);
  if (!clean) return fail(400, `캐릭터 이름은 1~${NAME_MAX}자로 입력하세요.`);
  const next = cloneState(room);
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
  const logs = [pushLog(next, `${owner.name} 님이 캐릭터 「${clean}」${particle(clean, '을/를')} 만들었습니다.`, now)];
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
  const next = cloneState(room);
  const c = next.characters.find((x) => x.id === charId);
  if (clean) c.name = clean;
  if (avatar !== undefined) {
    const nextAvatar = sanitizeAvatar(avatar);
    // AI art (Stage 5.5-D) belongs to a look: a changed avatar drops it (the route layer re-attaches a
    // cached set of the new look, see CharArtRunner.syncCharacter).
    if (JSON.stringify(nextAvatar) !== JSON.stringify(c.avatar)) delete c.art;
    c.avatar = nextAvatar;
  }
  return { ok: true, room: next, logs: [], character: c, at: now };
}

export function removeCharacter(room, sessionId, charId, now = Date.now()) {
  if (!findPlayer(room, sessionId)) return fail(403, '이 방의 참가자가 아닙니다.');
  const found = ownCharacter(room, sessionId, charId);
  if (found.error) return found.error;
  const next = cloneState(room);
  next.characters = next.characters.filter((x) => x.id !== charId);
  const owner = findPlayer(next, sessionId);
  const logs = [pushLog(next, `${owner.name} 님이 캐릭터 「${found.c.name}」${particle(found.c.name, '을/를')} 지웠습니다.`, now)];
  return { ok: true, room: next, logs };
}

export function setReady(room, sessionId, ready) {
  if (!findPlayer(room, sessionId)) return fail(403, '이 방의 참가자가 아닙니다.');
  if (isSpectator(findPlayer(room, sessionId))) return spectatorFail();
  if (typeof ready !== 'boolean') return fail(400, 'ready 값은 true/false여야 합니다.');
  if (room.status !== 'lobby') return fail(409, '로비에서만 준비 상태를 바꿀 수 있습니다.');
  const next = cloneState(room);
  findPlayer(next, sessionId).ready = ready;
  return { ok: true, room: next, logs: [] };
}

/** Connection presence (SSE open/close). Not an error if session isn't a player. */
export function setConnected(room, sessionId, connected, now = Date.now()) {
  const p = findPlayer(room, sessionId);
  if (!p) return { ok: true, room, logs: [], changed: false };
  if (p.connected === connected) {
    const next = cloneState(room);
    findPlayer(next, sessionId).lastSeen = now;
    return { ok: true, room: next, logs: [], changed: false };
  }
  const next = cloneState(room);
  const np = findPlayer(next, sessionId);
  np.connected = connected;
  np.lastSeen = now;
  return { ok: true, room: next, logs: [], changed: true };
}

/** Admin: start the game. Real engine setup arrives in Stage 2. */
export function startGame(room, now = Date.now()) {
  if (room.status !== 'lobby') return fail(409, '로비 상태의 방만 시작할 수 있습니다.');
  if (room.characters.length < 2) return fail(400, '캐릭터가 2명 이상이어야 시작할 수 있습니다.');
  const next = cloneState(room);
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
  const next = cloneState(room);
  next.status = 'finished';
  next.finishedAt = now;
  const logs = [pushLog(next, '관리자가 게임을 종료했습니다.', now, 'system')];
  return { ok: true, room: next, logs };
}

// ---------- Stage 9-C: CPU characters (owner 'cpu') ----------

export const CPU_OWNER = 'cpu';
/** Korean CPU name pool (≤ NAME_MAX); the first unused one is taken, then numbered. */
export const CPU_NAMES = ['로봇 철수', 'AI 영희', '알파 민수', '자동 지영', '기계 순자', '봇 덕배', '로보 춘향', '사이보그 길동', '안드로 말순', '컴퓨터 영수', '인공 두식', '칩 미자'];
export const CPU_PERSONALITIES = ['cautious', 'normal', 'bold'];

const isCpuChar = (c) => c.ownerSessionId === CPU_OWNER;

function hash32(...parts) {
  let h = 0x811c9dc5;
  for (const ch of parts.map(String).join('|')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A seeded random look (CH-1: a roster character + 0–2 props), deterministic per room + character seq. */
export function randomAvatar(seed) {
  return randomLook(seed);
}

/** The room's host = the first joined non-spectator player (may add / remove CPU characters when `allowCpu`). */
export const roomHost = (room) => activePlayers(room)[0] ?? null;

/** Host players manage CPU characters only in rooms created with 「CPU 허용」. */
export function canManageCpu(room, sessionId) {
  const p = findPlayer(room, sessionId);
  if (!p) return fail(403, '이 방의 참가자가 아닙니다.');
  if (isSpectator(p)) return spectatorFail();
  if (!room.config?.allowCpu) return fail(409, '이 방은 CPU 참가가 허용되지 않았어요.');
  if (roomHost(room)?.sessionId !== sessionId) return fail(403, '방장만 CPU를 넣거나 뺄 수 있어요.');
  return { ok: true };
}

/** Korean labels of the CPU personalities (logs; the client has its own copy with descriptions). */
export const CPU_PERSONALITY_LABELS = { cautious: '🐢 신중', normal: '🙂 보통', bold: '🔥 대담' };
const PERSONALITY_ERROR = 'CPU 성향은 신중·보통·대담 중 하나여야 해요.';

/**
 * A requested CPU personality: cautious / normal / bold, or absent / '' / 'random' → null (= the seeded pick).
 * @returns {{ok: true, personality: string|null} | {ok: false, status, error}}
 */
export function parseCpuPersonality(value) {
  if (value === undefined || value === null || value === '' || value === 'random') return { ok: true, personality: null };
  if (typeof value === 'string' && CPU_PERSONALITIES.includes(value)) return { ok: true, personality: value };
  return fail(400, PERSONALITY_ERROR);
}

/**
 * Add a CPU character (lobby only, max characters respected). `name` optional (else the first unused pool name),
 * `avatar` optional (else a seeded random look), `personality` cautious / normal / bold (absent / 'random' → seeded
 * per room + seq; anything else → 400). `by` = who added it (log text).
 */
export function addCpuCharacter(room, { name, avatar, personality } = {}, now = Date.now(), { by = '관리자' } = {}) {
  const pers = parseCpuPersonality(personality);
  if (!pers.ok) return pers;
  if (room.status !== 'lobby') return fail(409, '로비에서만 CPU를 넣을 수 있습니다.');
  if (room.characters.length >= room.config.maxCharacters) return fail(409, `캐릭터는 최대 ${room.config.maxCharacters}명까지 만들 수 있습니다.`);
  const seq = (room.nextCharSeq || 0) + 1;
  let clean;
  if (name !== undefined && name !== null && name !== '') {
    clean = cleanName(name);
    if (!clean) return fail(400, `캐릭터 이름은 1~${NAME_MAX}자로 입력하세요.`);
  } else {
    const used = new Set(room.characters.map((c) => c.name));
    clean = CPU_NAMES.find((n) => !used.has(n)) ?? `CPU ${seq}`;
  }
  const next = cloneState(room);
  next.nextCharSeq = seq;
  const character = {
    id: `c${seq}`,
    seq,
    name: clean,
    avatar: avatar && typeof avatar === 'object' ? sanitizeAvatar(avatar) : randomAvatar(`${room.seed ?? 0}:${room.id}:${seq}`),
    ownerSessionId: CPU_OWNER,
    cpuPersonality: pers.personality ?? CPU_PERSONALITIES[hash32(room.seed ?? 0, room.id, seq, 'cpu') % CPU_PERSONALITIES.length],
    createdAt: now,
  };
  next.characters.push(character);
  const logs = [pushLog(next, `🤖 ${by} 님이 CPU 캐릭터 「${clean}」${particle(clean, '을/를')} 넣었습니다.`, now)];
  return { ok: true, room: next, logs, character };
}

/**
 * Change a CPU character's personality (lobby only): cautious / normal / bold, or 'random' → a new seeded pick that
 * differs from the current one when possible (a visible re-roll). `by` = who changed it (log text).
 */
export function setCpuPersonality(room, charId, personality, now = Date.now(), { by = '관리자' } = {}) {
  const pers = parseCpuPersonality(personality);
  if (!pers.ok) return pers;
  if (personality === undefined || personality === null || personality === '') return fail(400, PERSONALITY_ERROR);
  const c = room.characters.find((x) => x.id === charId);
  if (!c) return fail(404, '캐릭터를 찾을 수 없습니다.');
  if (!isCpuChar(c)) return fail(409, 'CPU 캐릭터만 성향을 바꿀 수 있어요.');
  if (room.status !== 'lobby') return fail(409, '로비에서만 CPU 성향을 바꿀 수 있어요.');
  let value = pers.personality;
  if (!value) {
    const others = CPU_PERSONALITIES.filter((p) => p !== c.cpuPersonality);
    value = others[hash32(room.seed ?? 0, room.id, c.seq, 'cpu-reroll', now) % others.length];
  }
  if (value === c.cpuPersonality) return { ok: true, room, logs: [], character: c, changed: false };
  const next = cloneState(room);
  const nc = next.characters.find((x) => x.id === charId);
  nc.cpuPersonality = value;
  const logs = [pushLog(next, `🤖 ${by} 님이 CPU 「${c.name}」의 성향을 ${CPU_PERSONALITY_LABELS[value]}${particle(CPU_PERSONALITY_LABELS[value], '으로/로')} 바꿨습니다.`, now)];
  return { ok: true, room: next, logs, character: nc, changed: true };
}

/**
 * CPU 난이도 of the room (lobby only): easy (the weak CPUs + the money handicap against people) / normal (no handicap,
 * about a casual person's strength) / hard (the old strong CPUs). Same value → `{changed: false}`. `by` = who changed it.
 */
export function setCpuLevel(room, level, now = Date.now(), { by = '관리자' } = {}) {
  if (typeof level !== 'string' || !CPU_LEVELS.includes(level)) return fail(400, CPU_LEVEL_ERROR);
  if (room.status !== 'lobby') return fail(409, '로비에서만 CPU 난이도를 바꿀 수 있어요.');
  if (cpuLevelOf(room) === level) return { ok: true, room, logs: [], changed: false };
  const next = cloneState(room);
  next.config.cpuLevel = level;
  const info = CPU_LEVEL_INFO[level];
  const label = `${info.icon} ${info.name}`;
  const logs = [pushLog(next, `🤖 ${by} 님이 CPU 난이도를 ${label}${particle(info.name, '으로/로')} 바꿨습니다.`, now)];
  return { ok: true, room: next, logs, changed: true };
}

/** Remove a CPU character (lobby only). */
export function removeCpuCharacter(room, charId, now = Date.now(), { by = '관리자' } = {}) {
  const c = room.characters.find((x) => x.id === charId);
  if (!c) return fail(404, '캐릭터를 찾을 수 없습니다.');
  if (!isCpuChar(c)) return fail(409, 'CPU 캐릭터만 여기서 뺄 수 있어요.');
  if (room.status !== 'lobby') return fail(409, '로비에서만 CPU를 뺄 수 있습니다.');
  const next = cloneState(room);
  next.characters = next.characters.filter((x) => x.id !== charId);
  const logs = [pushLog(next, `🤖 ${by} 님이 CPU 캐릭터 「${c.name}」${particle(c.name, '을/를')} 뺐습니다.`, now)];
  return { ok: true, room: next, logs };
}
