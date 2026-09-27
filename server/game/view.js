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
    role: p.role === 'spectator' ? 'spectator' : 'player',
    isMe: sessionId != null && p.sessionId === sessionId,
  }));
}

/** AI character art (Stage 5.5-D) is public: everyone's cut-ins show it. Only the contract fields go out. */
function publicArt(art) {
  if (!art || typeof art !== 'object') return undefined;
  const out = { key: art.key, status: art.status, progress: art.progress ?? 0 };
  if (art.reason) out.reason = art.reason;
  if (art.files) out.files = structuredClone(art.files);
  return out;
}

function publicCharacters(room, sessionId) {
  return room.characters.map((c) => {
    const { ownerSessionId, art, ...rest } = structuredClone(c);
    const ownerId = ownerSessionId === 'cpu' ? 'cpu' : playerIdOf(room, ownerSessionId);
    const ownerName =
      ownerSessionId === 'cpu' ? 'CPU' : room.players.find((p) => p.sessionId === ownerSessionId)?.name ?? '?';
    const pub = { ...rest, ownerId, ownerName, isMe: sessionId != null && ownerSessionId === sessionId };
    if (art) pub.art = publicArt(art);
    return pub;
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
    eraIndex: room.eraIndex ?? null, // loop maps: the shared era (turn.eraRound / eraTurns = its clock; null in the final race)
    bets: publicBets(room, mine),
    news: structuredClone(room.news ?? {}), // Stage 6: {eraId: newsId} (public, news.json in /api/meta)
    // Stage 7: hands / items (on characters), open trade offers, holidays held and lotto draws are public
    trades: structuredClone(room.trades ?? []),
    holidays: structuredClone(room.holidays ?? {}),
    lotto: structuredClone(room.lotto ?? { draws: [] }),
    // Stage 8: love / spouse / children / house are on the characters (public); owners per house + 노년 시세
    houseOwners: structuredClone(room.houseOwners ?? {}),
    housingMarket: structuredClone(room.housingMarket ?? null),
    // Stage 9: highlights (public; texts never name a hidden value). Treasure appraisal values stay on the
    // server until the game is finished (room.treasureFakes only ever goes out through result.treasures).
    highlights: structuredClone(room.highlights ?? {}),
    treasureValues: room.status === 'finished' ? structuredClone(room.treasureValues ?? {}) : null,
    result: room.result ? structuredClone(room.result) : null,
    log: room.log.slice(-50),
    createdAt: room.createdAt,
    me: me ? { id: me.id, name: me.name, ready: !!me.ready, role: me.role === 'spectator' ? 'spectator' : 'player' } : null,
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
    players: room.players.filter((p) => p.role !== 'spectator').length,
    spectators: room.players.filter((p) => p.role === 'spectator').length,
    connected: room.players.filter((p) => p.connected).length,
    characters: room.characters.length,
    maxCharacters: room.config.maxCharacters,
    createdAt: room.createdAt,
  };
}
