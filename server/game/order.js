// Turn order helpers (pure).

/**
 * Build the character turn order.
 * - 'family': group characters by owner, owners in player join order,
 *   each owner's characters in creation order; owners not in players (e.g. 'cpu') go last.
 * - 'index': plain character creation order.
 * @returns {string[]} character ids
 */
export function buildTurnOrder(characters = [], players = [], mode = 'family') {
  const bySeq = [...characters].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  if (mode === 'index') return bySeq.map((c) => c.id);

  const order = [];
  const used = new Set();
  for (const p of players) {
    for (const c of bySeq) {
      if (c.ownerSessionId === p.sessionId && !used.has(c.id)) {
        order.push(c.id);
        used.add(c.id);
      }
    }
  }
  // Remaining owners (cpu / departed players), grouped by first appearance.
  const rest = bySeq.filter((c) => !used.has(c.id));
  const owners = [...new Set(rest.map((c) => c.ownerSessionId))];
  for (const o of owners) {
    for (const c of rest) if (c.ownerSessionId === o) order.push(c.id);
  }
  return order;
}
