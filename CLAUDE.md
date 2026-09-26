# CLAUDE.md — 인생게임 프로젝트 규칙

설계의 기준 문서는 `docs/PLAN.md` (아키텍처, 도메인 모델, 10단계 로드맵). 각 단계는 그 표의 범위만 구현한다.

## Conventions
- ESM everywhere (`"type": "module"`), no build step, no TypeScript, no frontend framework/bundler. Node 20+.
- Identifiers (code, JSON keys, ids) in English; all UI strings / error messages shown to users in Korean.
- Engine code (`server/game/*`) must be pure functions: take state, return new state (+ events). No I/O, timers,
  `Date.now()` defaults are the only allowed impurity (pass `now` explicitly in tests). Side effects only in
  `server/routes/*` and `server/store/*`.
- Rule content lives in `server/data/*.json`; code reads it via the `server/data/index.js` loader (`loadData(name)`,
  cached + deep-frozen). Don't `import` JSON files directly.
- Tests: `npm test` runs `node --test` over `test/*.test.js` (Node 22 no longer accepts a bare directory argument).
  Use `node:test` + `node:assert/strict`, temp dirs for any disk I/O. Keep the whole suite fast (<10s).
- Never commit secrets; keys via env or `data/secrets.json` (gitignored along with all of `data/`).
- Do not run git commands; the orchestrator commits.

## Layout (Stage 1)
- `server/index.js` — `createApp()` / `startServer({port, dataDir, adminPassword, heartbeatMs, debounceMs})`
  (port 0 = ephemeral, used by tests). Runs as main when executed directly.
- `server/config.js` — `PORT`, `ADMIN_PASSWORD`, `DATA_DIR` from env.
- `server/store/roomStore.js` — in-memory rooms + sessions, debounced JSON snapshots to `DATA_DIR/saves/<id>.json`
  and `DATA_DIR/sessions.json`, restore on `load()`. SSE registry: `subscribe`, `broadcast(roomId, event, payload)`,
  `broadcastState(roomId)` (per-session `viewFor`). Mutations go through `store.commit(nextRoom, logs)`
  (bump version, save, broadcast `state` + `log`); silent updates via `store.put(room)`.
- `server/game/lobby.js` — pure lobby rules (join, characters, ready, presence, start, end). Each returns
  `{ok:true, room, logs}` or `{ok:false, status, error}` and never mutates its input.
- `server/game/config.js` — room config validation. `server/game/order.js` — `buildTurnOrder`.
- `server/game/view.js` — `viewFor(room, sessionId)`: **the single place for masking** state sent to clients.
  Session tokens never leave the server: players are exposed as `p1..`, characters carry `ownerId`/`ownerName`/`isMe`.
  Add future secret-info masking (hands, bets, hidden jobs) here.
- `server/routes/{api,sse,admin}.js` — HTTP layer. Player auth = `X-Session-Token` header (`?token=` for SSE).
  Admin auth = HttpOnly cookie `jinsei_admin` (Path=/admin).
- `public/` — `index.html` + `js/app.js` (join → lobby → game → result), `js/api.js` (fetch/SSE),
  `js/ui/avatar2d.js` (`renderAvatar(parts, {size})` → SVG string), `js/ui/customize.js`, `admin.html` + `js/admin.js`.

## Domain notes
- Room: `{id, code, status: lobby|playing|finished, config, players[], characters[], turn, log[], seed, version,
  nextPlayerSeq, nextCharSeq, createdAt, updatedAt}`.
- Character ids `c<seq>` and player ids `p<seq>` are per-room counters; `seq` = creation order.
- Turn skeleton at start: `{order, currentIndex: 0, phase: 'awaitSpin', pending: null}` — Stage 2 engine takes over.
- Avatar part ids in `server/data/avatars.json` are stable contracts (generated PNG layers will key off them);
  add new options, don't rename existing ids. `eraOutfits` is reserved for era/job costume mapping.
- Reactions are SSE-only (`reaction` event), never stored in room state.
