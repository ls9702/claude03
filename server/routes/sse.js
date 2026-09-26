// GET /api/rooms/:id/events?token= — Server-Sent Events channel per room.
import express from 'express';
import { findPlayer, setConnected } from '../game/lobby.js';
import { viewFor } from '../game/view.js';
import { sseFrame } from '../store/roomStore.js';
import { sessionMiddleware } from './common.js';

export function createSseRouter({ store, heartbeatMs = 15000 }) {
  const router = express.Router();

  router.get('/rooms/:id/events', sessionMiddleware(store, { allowQuery: true }), (req, res) => {
    const roomId = req.params.id;
    const sessionId = req.sessionId;
    const room = store.getRoom(roomId);
    if (!room) return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
    if (!findPlayer(room, sessionId)) return res.status(403).json({ error: '이 방의 참가자가 아닙니다.' });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    res.write(sseFrame('state', viewFor(room, sessionId)));

    const unsubscribe = store.subscribe(roomId, sessionId, res);
    const presence = (connected) => {
      const current = store.getRoom(roomId);
      if (!current) return;
      const r = setConnected(current, sessionId, connected);
      if (r.changed) store.commit(r.room);
      else store.put(r.room); // lastSeen only; no broadcast needed
    };
    presence(true);

    const heartbeat = setInterval(() => res.write(': ping\n\n'), heartbeatMs);
    heartbeat.unref?.();

    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      if (store.subscriberCount(roomId, sessionId) === 0) presence(false);
    };
    req.on('close', cleanup);
    res.on('close', cleanup);
  });

  return router;
}
