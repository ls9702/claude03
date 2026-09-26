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

## Layout (Stage 2 — engine core)
- `server/game/rng.js` — `createRng(seed)` mulberry32: `next/int/pick/weighted`, `.state` (uint32). The room keeps
  `rngState`; the engine resumes from it, so a restored game continues deterministically.
- `server/game/board.js` — `buildBoard(config, rng, data)` from `board.json` + `eras.json`; nav helpers
  (`nextPosition`, `tileAt`, `tileIdAt`, `findTile`, `eraPathLength`, `startPosition`).
- `server/game/engine.js` — `startGame(room, ctx)`, `endGame(room, ctx)`, `applyAction(room, action, ctx) →
  {room, events, logs}`; ctx = `{rng?, now?, data?}` (rng defaults to `createRng(room.rngState)`). Throws
  `EngineError{status}` (400/403/404/409). `action.actor` = `{sessionId}` | `{admin:true}` | `{system:true}`;
  omitted = trusted (tests/simulator, no ownership check).
- `server/game/spaces.js` — tile resolution (`resolveTile`) + `PROMPTS` registry (`routeChoice`, `exam`, `groupGift`):
  each `{build(tx, c, extra) → spec, resolve(tx, pending)}`. Add new decisions/minigames here.
- `server/game/effects.js` — tx helpers: `emit`, `addLog` (room.log cap 500 + `log` event), `changeMoney`
  (gains repay debt first; losses beyond cash become debt), `netWorth`, `josa`, `won` (만원 units).
- `server/game/result.js` — `computeRanking` (money − debt; later stages add assets/awards), `applyResult`.
- `server/store/gameRunner.js` — side-effect layer: `start/end/dispatch` via `store.transact` (commit = `state` +
  `log` + `events` SSE), deadline timers for `pending.deadlineAt` (re-armed on every commit and on boot).
- `POST /api/rooms/:id/actions {type: spin|choose|bet|timeout, characterId, promptId, optionId, kind, pick, amount}`;
  admin `POST /admin/api/rooms/:id/actions {type:'timeout'}` force-resolves the pending prompt.
- `public/js/game2d.js` (`createGameUI(root, {getMeta, act, toast})` → `render/onEvents/renderResult`) +
  `public/css/game.css` — 2D simple board; Stage 4's 3D board replaces only the track part.
- `scripts/simulate.js --games N --seed S` — headless random full games over the pure engine.

## Domain notes
- Room: `{id, code, status: lobby|playing|finished, config, players[], characters[], turn, log[], seed, version,
  nextPlayerSeq, nextCharSeq, createdAt, updatedAt}`.
- Character ids `c<seq>` and player ids `p<seq>` are per-room counters; `seq` = creation order.
- Playing room adds: `board {eras:[{id,name,turns,tiles[],routes?:{love|career|money:{tiles}}}]}`, `rngState`,
  `bets {[turnNo]: {[charId]: {kind,pick,amount,target,resolved,won?,delta?}}}`, `promptSeq`, `result {ranking, forced}`.
- Board: tile ids `${eraId}:${main|love|career|money}:${index}` are stable. Route eras (young/middle_age) have
  `tiles = [routeChoice stop, merge]` and three route tracks of equal length `turns − 2` (path length = turns).
  Fixed stops come from `board.json.fixedStops` (high:0 = 수능). Last tile of the last era = `goal`.
- Character (in game): `money, debt, position {eraIndex, route:'main'|route, index (-1 = start)}, era, route,
  routeHistory[{era, route, completed}], finished, place, goalBonus, pensionGiven`.
- Turn: `{order, currentIndex, phase: awaitSpin|resolveSpace|awaitDecision|endTurn|gameOver, pending, turnNo, round,
  lastSpin}`. `pending = {promptId, kind, charId, title, text, forCharacterIds[], options[], defaultOptionId,
  simultaneous, answers{}, deadlineAt|null, context}`. Multi-character prompts get `balance.prompts.multiTimeoutMs`.
- Events: `turnStarted, spun, moved{path,halted}, landed{tileId,tileType,route}, moneyChanged{delta,reason,money,debt}`,
  `prompt, chose` (optionId omitted for simultaneous prompts), `eraChanged, routeChosen, finished{place,prize},
  bonusSpin, betPlaced, betResolved, gameOver{ranking}, log{text,tone}` with optional `emotion`/`tone`.
  Events are broadcast to everyone → never put secret info in them (masking lives in `viewFor`).
- `viewFor` masks: other sessions' pending answers (exposes `pending.answered[]` instead) and unresolved bets.
- Hooks for later stages: `heart/job/card/shop/treasure/house` tiles are log-only placeholders in `resolveTile`
  (text in `board.json.placeholders`); add jobs/cards/romance/submaps as new tile handlers + `PROMPTS` entries;
  extend `computeRanking` for assets/awards.
- Avatar part ids in `server/data/avatars.json` are stable contracts (generated PNG layers will key off them);
  add new options, don't rename existing ids. `eraOutfits` is reserved for era/job costume mapping.
- Reactions are SSE-only (`reaction` event), never stored in room state.
