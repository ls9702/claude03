// Shared route helpers.

/** Resolve the session token from header (or ?token= for EventSource). */
export function sessionMiddleware(store, { allowQuery = false } = {}) {
  return (req, res, next) => {
    const token = req.get('x-session-token') || (allowQuery ? req.query.token : undefined);
    if (!store.hasSession(token)) {
      return res.status(401).json({ error: '세션이 만료되었습니다. 새로고침 해주세요.', code: 'NO_SESSION' });
    }
    req.sessionId = token;
    next();
  };
}

/** Send a failed rule result as JSON. */
export function sendFail(res, result) {
  return res.status(result.status || 400).json({ error: result.error });
}
