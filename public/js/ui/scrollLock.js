// Page scroll lock safety net (post-simulation fixes). Overlays lock the page with a body class while they are open
// (cut-in, result show, photo dialog, customizer). If an owner ever forgets to remove its class (an overlay removed
// by a teardown, a thrown render…), the page stays unscrollable with nothing on screen. `repairScrollLock()` recomputes
// the lock from the overlays that are actually open and drops stale classes.
//
//   staleLocks(classes, isOpen)  → lock classes whose overlay is not open (pure, node-tested)
//   repairScrollLock(doc)        → removes them from <body>; returns the removed class names

/** body class → selector of the overlay that justifies it (open = present and not hidden). */
export const SCROLL_LOCKS = {
  'cutin-open': '.cutin:not([hidden])',
  'rshow-open': '.rshow:not([hidden])',
  'photo-open': '.photo-dlg',
  'cz-open': '.cz-overlay',
};

/** Lock classes (of `classes`) whose overlay is not open. */
export function staleLocks(classes = [], isOpen = () => false) {
  return [...classes].filter((c) => Object.hasOwn(SCROLL_LOCKS, c) && !isOpen(c, SCROLL_LOCKS[c]));
}

/** Drop stale lock classes from <body> (visible overlays keep theirs). */
export function repairScrollLock(doc = globalThis.document) {
  const body = doc?.body;
  if (!body) return [];
  const isOpen = (cls, sel) => [...doc.querySelectorAll(sel)].some((el) => el.isConnected && el.getClientRects().length > 0);
  const stale = staleLocks(body.classList, isOpen);
  for (const c of stale) body.classList.remove(c);
  return stale;
}
