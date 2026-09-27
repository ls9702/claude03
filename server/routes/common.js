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

/**
 * Sliding-window rate limiter keyed by string (IP, session). `hit(key)` records an attempt and returns
 * false once `max` attempts happened within `windowMs`. Stale keys are pruned as it goes, so the map
 * never grows without bound.
 */
export function createRateLimiter({ windowMs, max, clock = () => Date.now(), maxKeys = 10000 }) {
  const hits = new Map(); // key -> timestamps (ascending)
  let lastPrune = 0;
  const prune = (now) => {
    for (const [k, ts] of hits) if (!ts.length || now - ts.at(-1) >= windowMs) hits.delete(k);
    lastPrune = now;
  };
  return {
    hit(key) {
      const now = clock();
      if (now - lastPrune >= windowMs || hits.size > maxKeys) prune(now);
      const ts = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (ts.length >= max) {
        hits.set(key, ts);
        return false;
      }
      ts.push(now);
      hits.set(key, ts);
      return true;
    },
    size: () => hits.size,
    prune: () => prune(clock()),
  };
}

/** Client IP for rate limits: the socket address, or the forwarded client when env TRUST_PROXY sets Express `trust proxy`. */
export const clientIp = (req) => req.ip || req.socket?.remoteAddress || 'unknown';
