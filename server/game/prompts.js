// Prompt registry + lifecycle (single- and multi-character decisions). Prompt kinds are registered by the
// modules that own them (spaces.js: routeChoice/groupGift, growth.js: habit/exam/career/military, jobs.js:
// jobOffer/jobTile/hiddenJobOffer) so they can share `openPrompt` without import cycles.
import { charById, emit, turnTimeoutMs } from './effects.js';

/**
 * kind → { build(tx, c, extra) → spec, resolve(tx, pending) → extra?, resultCutin?: true|'auto' }.
 * `resultCutin: true` always emits a `promptResolved` anchor (result cut-in); `'auto'` only when the resolution
 * emitted no other cut-in anchor (so stat chips / money of a habit or overtime still get one). The anchor is
 * inserted right after the `chose` events, before the resolution's follow-ups; a plain object returned by
 * `resolve` (e.g. `{result: 'elite'}`) is merged into it.
 */
export const PROMPTS = {};

export function registerPrompts(defs) {
  Object.assign(PROMPTS, defs);
  return PROMPTS;
}

/** Event types that are a cut-in anchor of their own (an 'auto' result cut-in is then skipped). */
export const ANCHOR_TYPES = new Set([
  'landed', 'eraChanged', 'routeChosen', 'finished', 'prompt', 'promptResolved', 'gameOver', 'jobChanged', 'rankUp',
  'injured', 'hiddenJobUnlocked', 'newsFlash', 'militaryStart', 'educationChanged',
]);

/** Open a prompt → turn.pending, phase awaitDecision; CPU characters answer the default at once. */
export function openPrompt(tx, kind, c, extra = {}) {
  const def = PROMPTS[kind];
  if (!def) throw new Error(`unknown prompt kind ${kind}`);
  const spec = def.build(tx, c, extra);
  const room = tx.room;
  room.promptSeq = (room.promptSeq ?? 0) + 1;
  const { multiTimeoutMs, decisionTimeoutMs } = tx.data.balance.prompts;
  const multi = spec.simultaneous || spec.forCharacterIds.length > 1;
  // Single-character decisions: balance default, else the room's host turn timer (0 = no deadline).
  const timeout = multi ? multiTimeoutMs : decisionTimeoutMs || turnTimeoutMs(room) || null;
  const pending = {
    promptId: `pr${room.promptSeq}`,
    kind,
    charId: c.id,
    title: spec.title,
    text: spec.text,
    forCharacterIds: spec.forCharacterIds,
    options: spec.options,
    defaultOptionId: spec.defaultOptionId,
    simultaneous: multi,
    answers: {},
    deadlineAt: timeout ? tx.now + timeout : null,
    context: spec.context ?? {},
  };
  for (const id of pending.forCharacterIds) {
    if (charById(room, id)?.ownerSessionId === 'cpu') pending.answers[id] = pending.defaultOptionId;
  }
  room.turn.pending = pending;
  room.turn.phase = 'awaitDecision';
  emit(tx, 'prompt', {
    promptId: pending.promptId,
    kind,
    charId: c.id,
    forCharacterIds: pending.forCharacterIds,
    options: pending.options,
    title: pending.title,
    deadlineAt: pending.deadlineAt,
    tone: multi ? 'holiday' : 'info',
  });
  return pending;
}

export const promptComplete = (p) => p.forCharacterIds.every((id) => Object.hasOwn(p.answers, id));

/** Apply a completed prompt and clear it (the resolution may open the next prompt). */
export function resolvePrompt(tx) {
  const p = tx.room.turn.pending;
  tx.room.turn.pending = null;
  tx.room.turn.phase = 'resolveSpace';
  const def = PROMPTS[p.kind];
  const at = tx.events.length;
  const extra = def.resolve(tx, p);
  const mode = def.resultCutin;
  const anchored = tx.events.slice(at).some((e) => ANCHOR_TYPES.has(e.type));
  if (mode === true || (mode === 'auto' && !anchored)) {
    // Result cut-in anchor (answers stay out of it: simultaneous prompts were secret until now).
    const payload = extra && typeof extra === 'object' ? extra : {};
    tx.events.splice(at, 0, { ...payload, type: 'promptResolved', promptId: p.promptId, kind: p.kind, charId: p.charId });
  }
}
