// Per-session state views. THE single place where room state is masked
// before leaving the server (session tokens, seed, and later secret info).

function playerIdOf(room, sessionId) {
  return room.players.find((p) => p.sessionId === sessionId)?.id ?? null;
}

function publicPlayers(room, sessionId) {
  return room.players.map((p) => ({
    id: p.id,
    name: p.name,
    connected: !!p.connected,
    lastSeen: p.lastSeen,
    ready: !!p.ready,
    isMe: sessionId != null && p.sessionId === sessionId,
  }));
}

function publicCharacters(room, sessionId) {
  return room.characters.map((c) => {
    const { ownerSessionId, ...rest } = structuredClone(c);
    const ownerId = ownerSessionId === 'cpu' ? 'cpu' : playerIdOf(room, ownerSessionId);
    const ownerName =
      ownerSessionId === 'cpu' ? 'CPU' : room.players.find((p) => p.sessionId === ownerSessionId)?.name ?? '?';
    return { ...rest, ownerId, ownerName, isMe: sessionId != null && ownerSessionId === sessionId };
  });
}

function ownedIds(room, sessionId) {
  return new Set(sessionId == null ? [] : room.characters.filter((c) => c.ownerSessionId === sessionId).map((c) => c.id));
}

/** Pending prompt: everyone sees who answered; only my characters' answers are visible. */
function publicTurn(room, mine) {
  if (!room.turn) return null;
  const turn = structuredClone(room.turn);
  const p = turn.pending;
  if (p) {
    p.answered = Object.keys(p.answers);
    p.answers = Object.fromEntries(Object.entries(p.answers).filter(([id]) => mine.has(id)));
  }
  return turn;
}

/** Side bets: other characters' unresolved bets show only that a bet exists. */
function publicBets(room, mine) {
  const out = {};
  for (const [turnNo, slot] of Object.entries(room.bets ?? {})) {
    out[turnNo] = {};
    for (const [charId, bet] of Object.entries(slot)) {
      out[turnNo][charId] = bet.resolved || mine.has(charId) ? { ...bet } : { hidden: true, target: bet.target, resolved: false };
    }
  }
  return out;
}

/** Snapshot for one session (null sessionId = spectator/no flags). */
export function viewFor(room, sessionId = null) {
  const me = sessionId != null ? room.players.find((p) => p.sessionId === sessionId) : null;
  const mine = ownedIds(room, sessionId);
  return {
    id: room.id,
    code: room.code,
    status: room.status,
    version: room.version ?? 0,
    config: structuredClone(room.config),
    players: publicPlayers(room, sessionId),
    characters: publicCharacters(room, sessionId),
    turn: publicTurn(room, mine),
    board: room.board ? structuredClone(room.board) : null, // public; static per game
    bets: publicBets(room, mine),
    result: room.result ? structuredClone(room.result) : null,
    log: room.log.slice(-50),
    createdAt: room.createdAt,
    me: me ? { id: me.id, name: me.name, ready: !!me.ready } : null,
  };
}

/** Full view for the admin page (still never includes session tokens). */
export function adminView(room) {
  return { ...viewFor(room, null), seed: room.seed, log: room.log.slice(), startedAt: room.startedAt ?? null };
}

/** Compact row for the admin room list. */
export function adminSummary(room) {
  return {
    id: room.id,
    code: room.code,
    status: room.status,
    mode: room.config.mode,
    players: room.players.length,
    connected: room.players.filter((p) => p.connected).length,
    characters: room.characters.length,
    maxCharacters: room.config.maxCharacters,
    createdAt: room.createdAt,
  };
}
