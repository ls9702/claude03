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
- `server/index.js` — `createApp({store, runner, adminPassword, heartbeatMs, assets, log, rate})` /
  `startServer({port, dataDir, adminPassword, heartbeatMs, debounceMs, log, assets, rate})` (port 0 = ephemeral,
  used by tests; `rate = {session?, login?: {windowMs, max}}` overrides the limits). Runs as main when executed
  directly; on Linux main first re-execs itself once (`process.execve`, Node ≥ 22.15) with `MALLOC_ENV`
  (`MALLOC_ARENA_MAX=2`, `MALLOC_MMAP_THRESHOLD_=131072`; skipped under `--watch`, when already set or with
  `JINSEI_NO_MALLOC_TUNING`) and `configureSharpForServer()` (`sharp.cache(false)`, concurrency 1) — RSS after 3 AI
  art jobs 418 → ~158 MB.
- `server/config.js` — `PORT`, `ADMIN_PASSWORD` (null when unset), `DATA_DIR` from env. `resolveAdminPassword(dataDir,
  explicit)`: explicit/env wins, else `DATA_DIR/admin-password` (random 10 chars, mode 600, created on first boot and
  printed once via `log` in Korean; later boots only say where the file is). There is no default "admin" password.
- `server/store/roomStore.js` — in-memory rooms + sessions, debounced JSON snapshots to `DATA_DIR/saves/<id>.json`
  and `DATA_DIR/sessions.json`, restore on `load()`. SSE registry: `subscribe`, `broadcast(roomId, event, payload)`,
  `broadcastState(roomId)` (per-session `viewFor`). Mutations go through `store.commit(nextRoom, logs)`
  (bump version, save, broadcast `state` + `log`); silent updates via `store.put(room)`. Snapshot writes are chained
  per file (serialized at call time, written after the previous write of that file) → an older snapshot can never
  overwrite a newer one; nothing is scheduled after `close()`. Sessions `{createdAt, lastSeenAt}` (`hasSession`
  refreshes lastSeenAt, persisted at most hourly); `pruneSessions()` drops sessions unused for `SESSION_TTL_MS`
  (7 days) that are not a player of any room — at `load()` and hourly (`startPruning()`, started by `startServer`).
  `subscribe` caps SSE streams at `MAX_STREAMS_PER_SESSION` (3) per session per room: the oldest is ended.
- `server/game/lobby.js` — pure lobby rules (join, characters, ready, presence, start, end). Each returns
  `{ok:true, room, logs}` or `{ok:false, status, error}` and never mutates its input.
- `server/game/config.js` — room config validation. `server/game/order.js` — `buildTurnOrder`.
- `server/game/view.js` — `viewFor(room, sessionId)`: **the single place for masking** state sent to clients.
  Session tokens never leave the server: players are exposed as `p1..`, characters carry `ownerId`/`ownerName`/`isMe`.
  Add future secret-info masking (hands, bets, hidden jobs) here.
- `server/routes/{api,sse,admin}.js` — HTTP layer. Player auth = `X-Session-Token` header (`?token=` for SSE).
  Admin auth = HttpOnly cookie `jinsei_admin` (Path=/admin, Max-Age 7 days); `createAdminSessions` keeps
  sha256(token) → expiresAt in `DATA_DIR/admin-sessions.json` (mode 600) so a restart keeps the admin logged in.
  Rate limits (`routes/common.js` `createRateLimiter`, sliding window, self-pruning, per `clientIp(req)`):
  `POST /admin/api/login` `LOGIN_RATE` 10/min/IP → 429 "로그인 시도가 너무 많아요…", `POST /api/session`
  `SESSION_RATE` 30/min/IP → 429, reactions 5 per 2 s per session.
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
- `server/game/spaces.js` — tile resolution (`resolveTile`) + the `routeChoice` / `groupGift` prompts; the `PROMPTS`
  registry lives in `prompts.js` (`registerPrompts`, each kind `{build(tx, c, extra) → spec, resolve(tx, pending)}`; Stage 6
  kinds in `growth.js` / `jobs.js`). Add new decisions/minigames by registering a kind.
- `server/game/effects.js` — tx helpers: `emit`, `addLog` (room.log cap 500 + `log` event), `changeMoney`
  (gains repay debt first; losses beyond cash become debt), `netWorth`, `josa`, `won` (만원 units).
- `server/game/result.js` — `computeRanking` (money − debt; later stages add assets/awards), `applyResult`.
- `server/store/gameRunner.js` — side-effect layer: `start/end/dispatch` via `store.transact` (commit = `state` +
  `log` + `events` SSE), one deadline timer per room (`GameRunner.deadlineOf`: `pending.deadlineAt` → `timeout`, else
  `turn.spinDeadlineAt` in awaitSpin → `{type:'spin', auto:true, actor:{system:true}}`), re-armed on every dispatch
  and on boot. `start` passes `ctx.secret` = crypto random uint32 (option `secret` for tests).
- RNG secrecy: the board is public and built from `room.seed`, so `startGame` mixes `ctx.secret` into the RNG after
  `buildBoard` (`mixSecret(state, secret)`); tests/simulator omit it (or inject one) and stay deterministic. Note the
  mulberry32 state is still 32-bit.
- `POST /api/rooms/:id/actions {type: spin|choose|bet|timeout, characterId, promptId, optionId, kind, pick, amount}`
  (spectators → 403 "관전자는 …"); admin `POST /admin/api/rooms/:id/actions {type}` — `timeout` (force-resolve the
  pending prompt), `forceSpin` (spin for the current character now, admin log line), `skipTurn` (engine `skip`: the
  current turn ends without moving, this turn's side bets are void). Not playing → 409 "게임이 진행 중이 아니에요.";
  forceSpin/skipTurn outside awaitSpin (or with a prompt open) → 409 "룰렛을 기다리는 중에만 대신 돌리기/턴 넘기기를
  할 수 있어요."; unknown type → 400. Response `{room: adminView, events}`.
- `public/js/game2d.js` (`createGameUI(root, {getMeta, act, toast})` → `render/onEvents/renderResult`) +
  `public/css/game.css` — 2D simple board; Stage 4's 3D board replaces only the track part.
- `scripts/simulate.js --games N --seed S` — headless random full games over the pure engine (random eraTurns are
  clamped to `minEraTurns`). `--bias --games N --seed S` = turn-order bias check (8-character lifetime, index order):
  final 1st-place share + average rank per turn position; `simulateBias({games, seed, data?})` is importable.

## Domain notes
- Room: `{id, code, status: lobby|playing|finished, config, players[], characters[], turn, log[], seed, version,
  nextPlayerSeq, nextCharSeq, createdAt, updatedAt}` (+ `artRequests {[sessionId]: n}`, `artRequestTotal` — never
  sent to clients). Config: `mode, eraTurns, maxCharacters, startingMoney, allowCpu, turnOrder, mcFrequency,
  turnTimeoutSec` (`TURN_TIMEOUTS` 0 = off (default) | 30 | 60 | 90 | 120). `minEraTurns(eraId, mode)`: route eras
  (young/middle_age) ≥ 3 ("청년 턴 수는 갈림길·합류 칸이 있어 3 이상이어야 합니다."), the mode's last era ≥ its last fixed
  stop index + 2 (kids 고등학생 ≥ 2 so 수능 and the goal never share a tile); checked on the merged config.
- Player: `{id, sessionId, name, role: 'player'|'spectator', connected, lastSeen, ready, joinedAt}`. Spectators
  (`POST /api/rooms/join {code, name, spectator: true}`, `joinRoom(..., {spectator})`) may join lobby/playing/finished
  rooms (max `MAX_SPECTATORS` 20), do not count toward `MAX_PLAYERS` (4), cannot create characters / ready / spin /
  bet / choose (403 `spectatorFail()`), can send reactions and open SSE. A session keeps its first role. `viewFor`
  exposes `players[].role` and `me.role`; `adminSummary` has `spectators`.
- Character ids `c<seq>` and player ids `p<seq>` are per-room counters; `seq` = creation order.
- Playing room adds: `board {eras:[{id,name,turns,tiles[],routes?:{love|career|money:{tiles}}}]}`, `rngState`,
  `bets {[turnNo]: {[charId]: {kind,pick,amount,target,resolved,won?,delta?}}}`, `promptSeq`, `result {ranking, forced}`,
  `pension {recipients[], decidedAt, turnNo} | null`.
- Side bets (`balance.bets`): `ranges {"1-3":[1,3], "4-6":[4,6], "7-10":[7,10]}`, `payouts` per pick (stake
  included) `{odd:2, even:2, "1-3":3, "4-6":3, "7-10":2.5}`; winnings `betWinDelta` = floor(amount × (payout − 1))
  → no pick has a positive expected value (tested for every stake). `/api/meta.balance.bets` carries both.
- 기초연금 (`balance.pension`): recipients are decided ONCE when the first character enters the pension era — bottom
  `bottomN` by net worth (≥ `minCharacters`) → `room.pension`; each recipient is paid on their own entry (amount =
  base + gap to the richest × gapRatio, ≤ max). Never more than `bottomN` payouts.
- Turn-order balance (tuned with `--bias`, 2000 games × 4 seeds): `goalPrizes [200,150,120,90,60,40,20,10]`,
  `bonusSpinUnit` 5 → 1st-place share 11–14 % per position, first→last average rank spread ≈ 0.2–0.35 (before:
  500/300/…, unit 10 → 10.2–14.8 %, spread 0.5–0.6).
- Board: tile ids `${eraId}:${main|love|career|money}:${index}` are stable. Route eras (young/middle_age) have
  `tiles = [routeChoice stop, merge]` and three route tracks of equal length `turns − 2` (path length = turns; config
  validation keeps route eras ≥ 3 turns — `buildBoard` itself still clamps routes to ≥ 1 tile for direct callers).
  Fixed stops come from `board.json.fixedStops` (high:0 = 수능). Last tile of the last era = `goal`.
- Character (in game): `money, debt, position {eraIndex, route:'main'|route, index (-1 = start)}, era, route,
  routeHistory[{era, route, completed}], finished, place, goalBonus, pensionGiven`.
- Turn: `{order, currentIndex, phase: awaitSpin|resolveSpace|awaitDecision|endTurn|gameOver, pending, turnNo, round,
  lastSpin, spinDeadlineAt}`. `pending = {promptId, kind, charId, title, text, forCharacterIds[], options[],
  defaultOptionId, simultaneous, answers{}, deadlineAt|null, context}`. Multi-character prompts get
  `balance.prompts.multiTimeoutMs` (40000); single-character ones `decisionTimeoutMs` (null) else the room's turn
  timer. Host turn timer (`config.turnTimeoutSec` > 0): every `turnStarted` sets `turn.spinDeadlineAt = now +
  sec×1000` (ms epoch; null when off / after the spin); the runner auto-spins (log "⏰ 시간 초과! …자동으로 돌렸어요.",
  `spun.auto: true`) and single prompts time out to their default. Engine `spin` with `auto` needs a system actor and a
  passed deadline (409 "아직 시간이 남았어요.").
- Events: `turnStarted, spun, moved{path,halted}, landed{tileId,tileType,route}, moneyChanged{delta,reason,money,debt}`,
  `prompt, chose` (optionId omitted for simultaneous prompts), `eraChanged, routeChosen, finished{place,prize},
  bonusSpin, betPlaced, betResolved, promptResolved{promptId,kind,charId} (exam/groupGift result anchor),
  gameOver{ranking}, log{text,tone}`. Since Stage 5 every event also has `tone, emotion, scene, line, cutin, lineTag`
  (see Stage 5). Events are broadcast to everyone → never put secret info in them (masking lives in `viewFor`).
- `viewFor` masks: other sessions' pending answers (exposes `pending.answered[]` instead) and unresolved bets.
- Hooks for later stages: `heart/card/shop/treasure/house` tiles are log-only placeholders in `resolveTile`
  (text in `board.json.placeholders`); add jobs/cards/romance/submaps as new tile handlers + `PROMPTS` entries;
  extend `computeRanking` for assets/awards.
- Avatar part ids in `server/data/avatars.json` are stable contracts (generated PNG layers will key off them);
  add new options, don't rename existing ids. `eraOutfits` is reserved for era/job costume mapping.
- Reactions are SSE-only (`reaction` event), never stored in room state.

## Asset studio (Stage 3)
- `server/assets/gemini.js` — `createGeminiClient({dataDir, fetchImpl, env, model, dailyCap, sleep, now, log})` →
  `generateImage({prompt, refs:[{path|buffer}], aspectRatio, model})` → `{buffer, mimeType, text, model}` over plain
  REST (`x-goog-api-key` header). Key: env `GEMINI_API_KEY` → `DATA_DIR/secrets.json` (`setKey` writes mode 0600).
  The key is scrubbed from errors and must never appear in responses/logs (tests grep for it). Limiter 2, 3 retries
  on 429/5xx/network, daily cap in `DATA_DIR/assets-usage.json` (env `ASSET_DAILY_CAP`, `GEMINI_MODEL`). The
  `timeoutMs` (120 s) abort timer stays armed until the response body is fully read (stalled body → retryable
  `NETWORK` "응답 시간이 초과되었습니다").
- `server/assets/manifest.json` + `manifest.js` — items `{id, kind, label(KO), aspect, size?, prompt(EN template with
  {{style}}/{{sameStyle}}/{{magentaBg}}/{{whiteBg}}/{{keepCharacter}}/{{fullBody}}/{{seamless}}/{{noPeople}} + item
  vars), refs[], output (relative to public/assets/generated/), postprocess[], status todo|candidate|accepted,
  accepted{file, model, promptUsed, generatedAt,...}, meta{}}`; sprites add `frames[{id,prompt}]`, `frameDelays`,
  `anchor`. `validateManifest` checks ids/outputs/refs/cycles; `saveManifest` validates + writes atomically.
  Add items by editing the JSON; never rename existing ids/outputs (the game keys off them).
- `server/assets/postprocess.js` (sharp) — `chromaKey` (corner-sampled backdrop + hue kill + despill + small
  component removal, keeps canvas size), `whiteToAlpha` (border flood fill), `trim`, `resize`, `normalizeFrames`
  (bottom-center baseline + bbox height), `sheet` → `{buffer, meta}`, `animatedWebp`, `isSeamless`, `applySteps`.
- `server/assets/studio.js` — `createStudio({dataDir, manifestPath, outputDir, client|fetchImpl, env})`:
  `generateCandidates` (→ `DATA_DIR/asset-candidates/<id>/<n>.png|.preview.webp|.json[|.anim.webp]`), `accept`,
  `upload`, `regenerate` (force), `deleteCandidates`, `listItems`, `publicIndex`, `invalidateIndex`, `select` (CLI).
  Refs must be accepted first (409 `REF_MISSING`); accepted items are only regenerated with `force`. Every candidate
  path goes through `candDir(id)` (`ITEM_ID_RE` + containment → 400 `BAD_ID`; `..%2Foutside` is decoded by Express).
  `publicIndex()` is cached, keyed by the manifest file's mtime+size and invalidated by every manifest save /
  `writeOutput` (accept, upload).
- Routes (`server/routes/adminAssets.js`): `/admin/api/assets/*` behind the admin cookie (`GET /`, `/status`,
  `/items/:id`, `POST|DELETE /key`, `POST /generate/:id` → 202 job, `GET /jobs/:jobId`, `GET /candidates/:id[/:n]`
  (`?preview=1`, `?anim=1`), `DELETE /candidates/:id`, `POST /accept/:id {n}`, `POST /upload/:id` raw `image/*` or
  JSON `{data: base64, process}` — parsed only after auth). Public `GET /api/assets` →
  `{version, assets: {<id>: {url, kind, width, height, meta, anchor?, sheet?, anim?}}}`. Page `/admin/assets`.
- Client contract for later stages: `public/js/assets.js` — `await loadAssetIndex()` once, then `assetUrl(id, fallback)`,
  `assetInfo(id)`, `findAsset({kind, ...meta})` (e.g. `{kind:'frame', tone:'love'}`, `{kind:'bg', scene:'office'}`,
  `{kind:'icon', tile:'money'}`, `{kind:'pose', character:'schoolgirl', pose:'jump'}`); all return null/fallback when
  an asset is not accepted yet, so keep the SVG placeholders as the default path.
- Tests use `test/assetFixtures.js` (synthetic magenta/white images, fake Gemini fetch, temp manifest copy) and small
  real samples in `test/fixtures/`. Never hit the real API in tests.

## 3D board (Stage 4)
- Three.js is an npm dependency; `postinstall` → `scripts/vendor.js` copies `three.module.js` + `three.core.js` and the
  addons we use (GLTFLoader, BufferGeometryUtils, SkeletonUtils) into `public/vendor/three/` (gitignored, rebuilt by
  `npm install`). `index.html` has the import map (`three`, `three/addons/`). No CDN.
- `public/js/scene/` — pure (node-testable, no three/DOM): `math.js` (Catmull-Rom, arc-length resample, easing,
  `rouletteTargetAngle/ValueAt/Region`), `layout.js` (`layoutBoard(board)` → world tile positions: one meandering
  centerline, route eras fork love(+normal, near camera)/career(centerline)/money(−normal) between stop and merge;
  `planProps` deterministic town props, tall ones only behind the track; `slotOffset`, `eraSweepPoints`, `ERA_THEMES`),
  `quality.js` (`QUALITY_PRESETS` high|low|tv, `pickQuality`, `renderSize`, `shouldFallback`), `animator.js`
  (`createAnimator` event queue, `planSteps`), `pawnParts.js` (avatar part ids → primitive specs + colors).
  three-based: `board3d.js` (`createBoard3D(canvas, {quality, meta, hooks:{onStep,onRouletteTap,onError}})` →
  `setBoard/setCharacters/setCurrent/focus/focusEra/resetCamera/playEvents/onIdle/isBusy/whenIdle/reaction/resize/
  setQuality/stats/measureFps/dispose`, `.animator`), `pawn.js` (merged vertex-colored pawn = 1 draw call, name tag;
  `/api/models` lists `public/assets/models/*.glb` → `pawn.glb` drop-in via GLTFLoader), `roulette3d.js` (own scene
  drawn into a scissored viewport of the same renderer), `emotion.js` (emoji/text popups), `particles.js`,
  `controls.js` (orbit: drag/pinch/two-finger pan/wheel, taps), `props.js`, `geo.js`, `sprites.js`,
  `pawnPreview.js` (lobby customizer 3D preview, shares pawn geometry).
- Budget: ≤100 draw calls, ≤50k triangles (8-char lifetime board ≈ 32 calls / 21k tris incl. roulette), no shadows/
  post/AA, pixelRatio 1, Hemisphere + 1 Directional, Lambert + vertex colors; tiles are InstancedMeshes, icons one atlas
  mesh, roads/buildings merged, trees instanced. Keep new scenery inside `buildStatic` merges.
- Sync model: SSE `state` arrives before its `events`. `setCharacters` never teleports a pawn while an animation may
  follow — pawns glide to the authoritative tile only when the animator is idle (380 ms grace). `moved` hops from
  `event.from` along `event.path`. `setCurrent` is applied when idle. game2d opens decision modals only when
  `b3.isBusy()` is false (+ grace) and hides the roulette spoiler text meanwhile; app.js delays the result screen
  until `whenIdle()`.
- `game2d.js` owns mode selection: `?board=2d|3d` > localStorage `jinsei.boardMode` (explicit toggle) > auto
  (WebGL probe; auto mode falls back to 2D with a toast when the first 3 s average < 15 fps, remembered in
  sessionStorage `jinsei.board3dFallback`). Quality: `?quality=high|low|tv` > localStorage `jinsei.quality` > device
  heuristic. `?debug=1` exposes `window.__board3d` (stats: calls/triangles/fps) and `&fpsMin=` for fallback tests.
- Engine events stay the only animation input; add a new animation = handler in `board3d.js` `handlers` (+ the type
  in `ANIMATED_EVENTS`). Toasts/side-panel floats go through `hooks.onStep` → `game2d.feedback(e, true)`.
- Stage 5 hooks: `gameUI.animator` (null in 2D) → `pause()/resume()` between steps, `enqueue(fn)` a custom step
  (a 2D cut-in that takes over the screen and resolves when closed), `setHandler(type, fn)` to replace/extend an
  event's animation (e.g. play a cut-in on `landed` of event tiles). A handler returning a Promise blocks the queue
  (safety timeout 12 s per step; pass `maxMs` to `enqueue` for longer cut-ins).

## Cut-ins & sound (Stage 5)
- `server/game/presentation.js` — pure post-pass `decorateEvents(events, {room, data, seed})`, called at the end of
  `applyAction`/`startGame`: every event gets `tone` (love|career|treasure|good|bad|holiday|result|neutral; aliases
  money→treasure, info→neutral), `emotion` (joy|cry|angry|sweat|love|shock|neutral), `scene` (school|mountain-trail|
  wedding-hall|office|hospital|none), `line` (speech bubble; null for chose/betPlaced), `lineTag`, `cutin` (bool).
  Explicit `tone`/`emotion` set at emit sites win. `landed` looks at its follow-ups (money/log/prompt) for the outcome.
  Lines come from a sub-RNG `createRng(hashSeed(engineRngState, turnNo, index, type))` → identical for all clients
  and the gameplay RNG stream is not consumed. The prompt presentation is copied onto `turn.pending` (`tone, emotion,
  scene, line, cutin`) so a reloaded client rebuilds the prompt cut-in from state. `EVENT_TYPES`/`CUTIN_TYPES` list
  what the tests enforce — a new event type must be added there (and get a mapping).
- `cutin: true`: `landed` on `tones.cutinTiles` (event/heart/job/card/shop/treasure/house/stop, but not when a prompt
  follows — the prompt cut-in replaces it), `eraChanged, routeChosen, finished, prompt, promptResolved, gameOver`.
  money/loss tiles and `moneyChanged` stay on the board (floating text).
- Data: `server/data/lines.json` (`tags.<tag>` = 5–10 반말 lines, placeholders `{name} {era} {amount} {place}`),
  `server/data/tones.json` (tone → frame asset id | null, colors, sfx, default scene; `scenes` → bg asset id;
  `eraScenes/routeScenes/tagScenes/eventScenes`, `cutinTiles`, `tileTones`, `sfx` event map). Both are in `gameData()`;
  `/api/meta.presentation` = tones.json. `PROMPTS[kind].resultCutin` → `promptResolved` anchor.
- Client pure module `public/js/ui/cutinMap.js` (node-tested): `planCutins(events)` (anchor + money/log follow-ups;
  prompts excluded — they are state-driven), `poseFor`, `expressionFor`, `layerPlan` (outfit > pose > expression >
  base; kept for Stage 6 costume sets), `resolveCharacterArt` (see Stage 5.5-C), `tagLabel`, `autoAdvanceMs`,
  `sfxForEvent`.
- `public/js/ui/cutin2d.js` `createCutin(document.body, {getMeta, assets:{findAsset, assetUrl}, audio})` →
  `show(group|event|spec, {characters, room, onClose}) → Promise` (queued), `queue`, `showPrompt(pending, {characters,
  forMe, room, onChoose})` / `closePrompt(id)` / `promptId`, `hide`, `reaction({emoji,name})`, `busy/busyEvents/
  whenIdle/onIdle`. Overlay z-index 22 (above top bar, below reaction bar 25 and toasts). Spectators auto-advance 4 s,
  owners 7 s, prompts never (deadline). A spec is `{key, kind, tone, scene, tag, who, text[], line, speaker, chips[],
  cast[{char, pose, emotion}], bigWin, currentId, era, autoMs, characters, prompt?}` — later stages can build specs
  directly (e.g. wedding with spouse in `cast`, stat chips in `chips`).
- `avatar2d.renderAvatarLayers(parts, {pose, emotion, name, flip, art})` → `.av2` element with `setState()`,
  `playSprite()`, `ready`: AI art > composed paper-doll layers > SVG — the current contract is in "Layered avatars
  (Stage 5.5-C)" (the old single schoolgirl recolor path is gone). `preloadAvatarLayers` warms the cache.
- game2d: 3D → wraps animator handlers (`getHandler`/`setHandler`) for `landed, eraChanged, routeChosen, finished,
  promptResolved`: after the board animation it pauses the animator, shows the cut-in, resumes on close. 2D → cut-ins
  are queued straight from `onEvents`. Prompts: cut-in dialogue options when `promptCutins()` (3D, or 2D with
  generated frame/bg art), else the old modal. `gameOver` is not a board cut-in: `renderResult` plays a 「결과 발표」
  intro cut-in once per room, then reveals the ranking. `isBusy/whenIdle` include event cut-ins. Toolbar: 🎬 cut-ins
  (localStorage `jinsei.cutins`, `?cutins=off`), 🎵 BGM, 🔊/🔇. `?debug=1` also exposes `window.__cutin`.
- `public/js/audio.js` — `audio` singleton: `install()` (unlocks AudioContext on first pointer/touch/key; nothing is
  created before), `play(name)` (`SFX_NAMES`: tick coin thud fanfare heart whoosh pop tears babble), `rouletteTicks(ms)`,
  `playEvent(e)` (tones.json sfx map), `setEra(era)` (BGM `bgm_<era>.mp3` drop-in else a generated pad loop),
  `setMuted/toggleMuted/setBgm/setVolume/onChange/state`; localStorage `jinsei.muted|bgm|volume`. Drop-ins are
  listed once by `GET /api/audio` (`public/assets/audio/(bgm|sfx)_*.mp3|ogg|m4a|wav`) — no 404 probes.
- Stage 6 hooks: stat chips → `spec.chips` (`{text, kind}`); job/era costumes → paper-doll outfit option ids
  (`avatars.json` `eraOutfits`, e.g. doctor/suit) via `layerPlan({outfit})`; new scenes = new `bg-<scene>` items +
  `tones.json.scenes` (+ `SCENES` in presentation.js); new line tags just need a pool in lines.json.

## Customization UI (Stage 5.5-A)
- `avatar2d.renderAvatar(parts, {size, bg, title, expression?, crop?, hat?})` — SVG head-and-shoulders portrait for every
  avatars.json option (build = torso `scaleX` group, face = head path, 20 hairs, 30 outfits via the `OUTFIT_PAINTERS`
  table + `OUTFIT_HATS`/`OUTFIT_BACKS` for police cap/chef toque/dino hood/idol headset). Gradient/clip ids are unique per
  call (`av<n>-s|h|c|k|t`; strip them when comparing markup). `expression` ∈ `AVATAR_EXPRESSIONS` (neutral joy cry shock
  angry love sweat) swaps brows/eyes/mouth + fx. `crop` = `AVATAR_CROPS` key or "x y w h". `hat:false` hides outfit
  headwear (thumbnails). `tintable:false` outfits (doctor/police/chef/taekwondo) use `FIXED_OUTFIT_COLORS` and ignore
  `outfitColor` (`outfitTintable(id)`). A new option = a new branch/table entry here and in `pawnParts.js`; the
  distinctness tests in `test/avatarCustomize.test.js` fail until both render it differently.
- `pawnParts.js`: build → body x/z scale, face → head scale (+ jaw box for square), `OUTFITS_3D` table (painters return
  `{sleeves, legs}`), `HATS_3D`, `FIXED_OUTFIT_COLORS_3D`. Budget ≤ 2000 triangles per pawn (tested on heavy combos).
- `customize.js` — `openCustomizer(host, {title, initial, submitLabel, onSave, onCancel}) → {destroy, getAvatar}`:
  fixed overlay dialog (`body.cz-open`), tabs from `buildTabs(defs)` (avatars.json `tabs`, leftovers → 기타), swatch
  grids for `COLOR_PARTS`, cached zoomed thumbnails (`THUMB_CROPS`, only the active tab re-renders), 2-row horizontal
  scroll on mobile for > `MANY_OPTIONS`, radiogroup keyboard nav (arrows move focus, Enter selects), outfit color locked
  for fixed-color outfits, 🎲 전체/이 탭만 (`randomizeParts`), 2D|3D preview (3D lazily via `pawnPreview`, hidden in
  2D board mode / no WebGL), expression chips 기본/기쁨/울음/놀람, empty `.cz-ai-slot` in the footer (Stage 5.5-D).
- Preview hook: `setPreviewRenderer(fn|null)`; `fn(avatar, {expression, size, defs})` → markup string | Node |
  Promise of either (stale results dropped; null/throw → SVG fallback). Open customizers re-render immediately.

## Paper-doll layers (Stage 5.5-B)
- Every avatar option is a transparent layer on ONE shared 1024×1536 canvas, same front-facing pose, so composing =
  drawing the stack at (0,0). Made by Gemini *edits* of a bald, blank-faced mannequin ("keep everything, ONLY add X")
  + `diffExtract` (edit − base inside a category region). Neutral colours are tinted in the browser.
- Pure contract `server/assets/partStack.js` (no Node/DOM; part C imports/copies it): `CANVAS`, `CROP {x:96,y:24,
  w:848,h:1376}` (union of all layers), `Z_ORDER = backHair, mannequin, face, outfit, cheek, eyes, mouth, frontHair,
  hat, accessory` (eyes slot = eyesClosed when blinking / expression, which also drops mouth), `partId.*` /
  `partOutput.*` (option ids slugged camel→kebab: `hanbokTrad` → `hanbok-trad`), `NO_LAYER` (face slim, cheek none,
  accessory none), `EXPRESSIONS` (joy cry shock angry love sweat shy), `layerStack(avatar, {lookup, avatars,
  expression, blink})` → `[{slot, id, src, tint:{channel,color,ref,mode}|null, erase?:[urls]}]`. `lookup(id)` =
  `/api/assets` entry `{url, files?, meta}`. Missing layers are skipped; a missing outfit build variant falls back to
  the `normal` build (without its erase mask).
- Ids / files (under `public/assets/generated/`, WebP; extras = same stem + `-<key>`, listed in `accepted.files` and
  in `/api/assets` `files` minus generation-only `base`/`src`): `part-mannequin-<body>-<build>` →
  `parts/mannequin/<body>-<build>.webp` (display: underwear recoloured dark) + `-base` (keyed original with pale-cyan
  underwear = edit ref/diff base); `part-hair-<id>` → `parts/hair/<id>.webp` (whole layer) + `-front` + `-back`
  (= whole hair, drawn under the mannequin) + `-erase?`; `part-face-<id>`, `part-eyes-<id>`, `part-eyes-closed-<id>`,
  `part-mouth-<id>`, `part-cheek-<id>`, `part-expr-<id>`, `part-acc-<id>` → `parts/<face|eyes|eyes-closed|mouth|
  cheek|expression|accessory>/<id>.webp`; `part-outfit-<id>-<body>-<build>` → `parts/outfit/<body>-<build>/<id>.webp`
  (+ `-hat` headwear drawn above front hair, + `-erase`). `meta.src: true` items (eyes, hair bob) also publish
  `-src` (keyed edit) used as ref/base by glasses / closed eyes / hair accessories.
- `erase` masks (alpha = cut) = pixels an edit removed from the mannequin (ears hidden by hair, underwear beside
  narrow trousers); apply destination-out to backHair AND mannequin.
- Tint contract (`server/assets/tintMath.js`, pure RGBA): `tintPixels(data, meta.tintRef, colorHex, {mode})` keeps
  luminance relative to the reference (ref-bright pixel → exactly the target, darker → target×k, brighter → blend to
  white). `meta.tint`: `skin` (mannequin, face overlays, freckles; mode `selective` = only skin-hued pixels) → avatars
  `skin[].color`; `hair` → `hairColor[].color`; `outfit` → `outfitColor[].color`; `null` = natural colours (eyes,
  mouths, expressions, accessories, `tintable:false` outfits). `meta.tintRef` = measured neutral median at accept;
  `meta.neutral` = the colour asked for (hair #4a4440, outfits #c8c8c8, skin #e6b48f).
- Pipeline: manifest kind `part`, meta `{category, option, body?, build?, slot, tint, tintMode?, tintRef?, base,
  src?, expression?, diff?}`; steps `chromaKey, resize:1024x1536` then `mannequin` (+`alignHead` for variants, aligned
  by head box) or `diffExtract:<hair|face|eyes|mouth|cheek|expression|accessory|body>` (needs `meta.base`, a
  dependency in `topoOrder`). `postprocess.js`: `detectFigure`, `regionBox`, `diffExtract[Detailed|Pixels]` (global
  shift registration, luma/opponent distance with chroma ×2, wider search for line art, neutral-only chroma veto for
  hair/outfits, close → open, hole fill, silhouette hug, edge band for inner-face parts), `splitFrontBack`,
  `splitHat`, `mannequinDisplay`, `alignToHead`, `tintLayer`, `composeLayers`. Studio: candidates hold
  `<n>.<layer>.png`; `accept` publishes all layers; `reprocess(id, n)` re-runs extraction from `<n>.src.png` (no API).
- Add an option: add it to `server/data/avatars.json` (+ promptDesc) → `node scripts/gen-part-manifest.js`
  (idempotent upsert, keeps accepted) → `node scripts/gen-assets.js --kind part --accept-first --parallel 2` →
  `node scripts/part-qa.js [--fix]` (alignment/coverage QA, regenerates outliers) → `node scripts/part-sheets.js --out
  <dir>` (contact sheets) for a visual check.

## AI character art (Stage 5.5-D)
- Optional per-character illustration set generated with Gemini that matches the customization exactly. Room state:
  `character.art = {key, status: 'pending'|'ready'|'failed', progress: 0..1, reason?, files?: {base, poses: {idle, wave,
  jump, cheer, cry, shock}, expressions: {joy, cry, shock, angry}}}` + `character.artGenerations` (successful player
  requests) + `character.artRequests` (player requests made). URLs `/api/char-art/<key>/<name>.webp` (`base`, `pose-<id>`, `expr-<id>`; `?v=<rev>` only after an admin
  force). Transparent WebP, 1024×1536, schoolgirl placement (bbox y 371..1303, feet on 1303, centred x 512).
  `viewFor` passes `art` to everyone (contract fields only).
- `server/assets/charArt.js` — pure: `artKey(avatar)` (sha256 of stable JSON + `ART_VERSION`, 24 hex), `ART_STEPS`
  (base + 6 poses + 4 expressions = 11), `artFiles(key, rev)`, `describeAvatar`/`buildArtPrompt` (STYLE bible +
  promptDesc of every category, hex colours, outfitColor skipped for `tintable:false`, "match the reference character's
  design exactly", magenta, full body, front view), `buildEditPrompt(step)`, `classifyError` (402 → "AI 생성 크레딧이
  부족합니다. 관리자에게 문의하세요.", 401/403/NO_KEY/DAILY_CAP fatal). Service `createCharArtService({dataDir, client,
  avatars, composeRef?, styleAnchorPath?, stepRetries=2, editConcurrency=2})`: `generate(avatar, {onProgress, force})`
  → `{key, cached, promise, detach}` (jobs deduped per key across rooms; detach of the last listener cancels before
  the next step), `cached(key)` (sync), `filePath(key, file)` (regex + containment). Base refs = style anchor +
  `composeReference` (paper-doll `layerStack` + `composeLayers` of the exact avatar on white); edits ref = base on
  flat magenta. Each result → `chromaKey` → `placeFigure` (base) / `normalizeFrames([base, frame])` → WebP. Cache
  `DATA_DIR/char-art/<key>/{index.json, *.webp}`; index lists finished steps, so a failed/cancelled job resumes.
  Uses the studio's Gemini client (same limiter, retries and daily cap).
- `server/store/charArtRunner.js` — `CharArtRunner(store, service, {throttleMs=1000, limits?})`: `request(roomId, charId,
  {admin, force, sessionId})` (409 without key / already pending / limit; cached look → ready at once, not counted).
  Limits (`balance.json` `charArt` → `artLimits()`: `perSession` 2, `perCharacter` 1, `perRoom` 8) count REQUESTS at
  request time — a failed, cancelled (delete) or edited-away job still counts: `character.artRequests`,
  `room.artRequests[sessionId]` (survives delete/recreate), `room.artRequestTotal`. Admin requests skip the
  per-session/per-character limits but count toward and respect the room cap unless `force`. Per-room queue (max 1
  running job per room), progress committed ≤ 1/s per room + SSE `charArt {charId, status, progress, done?, total?,
  reason?}`, `syncCharacter(room, charId)` (called by add/edit routes: unchanged look keeps art, changed look → cached
  set or cleared; lobby `updateCharacter` itself drops `art` on an avatar change), `cancel` (delete), `restore()`
  (boot: pending → failed "서버 재시작"), `enabled()` (key present). `createApp` exposes it as `app.locals.charArt`.
- Routes: `POST /api/rooms/:id/characters/:charId/art` (owner 403, lobby 409, feature off 409 "AI 일러스트 기능이 꺼져
  있어요", limits above → 409 Korean, → 202 pending | 200 cached), admin `POST /admin/api/rooms/:id/characters/:charId/art?force=1`,
  `GET /api/char-art/:key/:file` (key `/^[a-f0-9]{16,64}$/`, file `/^[a-z0-9-]+\.webp$/` → 400; `max-age=604800`),
  `GET /api/meta` → `features.charArt`.
- Client: `public/js/ui/charArt.js` `mountArtSlot(slot, {initial, target, getAvatar})` renders into the customizer's
  `.cz-ai-slot` (button → "AI가 그리는 중… n/11" → thumbnail + "완성!", failed → reason + 다시 시도); `openCustomizer`
  accepts `art: {roomId, charId}` (else it finds the edited character in the saved room by name + avatar). Polls the
  room once a second while pending. Hidden when `features.charArt` is false or the look is unsaved.
- TEST-ONLY smoke hook: env `CHAR_ART_FAKE=1` (fake Gemini echoing the reference on magenta; `402` = credits
  exhausted; `CHAR_ART_FAKE_DELAY_MS`, default 250) → `server/assets/fakeGemini.js`. Never set it in production.
  Tests (`test/charArt*.test.js`) inject `assets.studioOptions.fetchImpl` / `charArtOptions` / `charArtThrottleMs`.

## Layered avatars (Stage 5.5-C)
- Shared pure modules: `public/js/shared/partStack.js` + `public/js/shared/tintMath.js` are the ONLY implementations
  (served as `/js/shared/*`); `server/assets/partStack.js` / `tintMath.js` are `export *` re-exports, so server code,
  scripts and tests keep their imports. Keep both files free of Node/DOM imports (a test greps for it).
- `public/js/ui/avatarCompose.js` — browser compositor, pixel-identical to `scripts/part-sheets.js` (mean abs diff
  < 0.3/255). `composeAvatar(avatar, {expression, blink, size, crop: 'full'|'bust'|'face'|{x,y,w,h}, dpr})` →
  `Promise<canvas|null>` (a fresh copy, class `av-cmp`; null = layers missing → keep the SVG). `size` = CSS px of
  the longer side, canvas = size × dpr (≤ 2). `peekAvatar(...)` = synchronous copy when cached (no SVG flicker),
  `preloadAvatar`, `composeKey` (pure, normalized avatar in `defs.order` + expr + blink + size + crop + dpr),
  `stackFor` (= `layerStack` + fixed-colour outfits forced untinted), `COMPOSE_CROPS`, `FIGURE_SPAN` (hairline 200 …
  feet 1360: the cut-in figure box), `composeGeometry/levelFor`, `layeredPreviewRenderer` (customizer hook,
  registered in app.js). Caches: images by URL (+ alpha bbox measured once on a 128×192 thumb), prepared layers
  (tint via `tintPixels` / erase via destination-out, cropped to the bbox, at working level 0.25|0.5|0.75|1; LRU 90),
  composed results (LRU `COMPOSE_CACHE_MAX` 40). AI art: `AI_CROPS` (schoolgirl placement), `composeArt(url, {size,
  crop})` / `peekArt`. `composeStats()` for debugging.
- Source priority = pure `cutinMap.resolveCharacterArt(character, {pose, expression, portrait})`: `art.status ===
  'ready'` → AI file (non-idle pose file > expression file (joy/cry/shock/angry) > idle pose > base; portraits: base >
  idle) > paper-doll layers (`motion` = requested pose, `expression` ∈ `PART_EXPRESSIONS`) > SVG (compose → null).
  `expressionFor(emotion)` now also returns `part` (joy cry shock angry love sweat shy).
- `avatar2d.renderAvatarLayers(parts, {pose, emotion, name, flip, art})` (cut-ins; `cutin2d` passes `char.art`):
  AI → `<img class="av2-layer full ai">` (broken file → layers from then on); layers → composed canvas
  `.av2-layer.cmp.main` sized from `FIGURE_SPAN` (inline height/bottom) + a `.blink` canvas toggled every 3–6 s
  (`.av2.blinking`); SVG last. `el.dataset.source` = ai|layers|svg. Layered art has only the front pose: poses are
  CSS motion (`data-pose`: jump hop, cheer bounce + ✨ overlay, wave sway (`.av2.cmp`), cry sob, shock shake);
  `playSprite()` = procedural double hop (`.av2.bigjump`). The old schoolgirl recolor path (`avatarPalette`,
  `recolorPixels`, `hueFilterFor`, `characterBaseFor`, `layerSet`, `recoloredCanvas`) is gone; `layerPlan` stays
  for Stage 6 costume sets. `preloadAvatarLayers(characterOrAvatar, {expressions})`.
- Portraits: `renderPortrait(el, characterOrAvatar, {size, crop: 'face'|'bust', title})` (SVG first, composed/AI
  canvas `canvas.av-pt-img` when ready; AI art uses the bust of `files.base`), and for HTML templates
  `portraitHtml(subject, opts)` + `hydratePortraits(root)` right after `innerHTML` (synchronous when cached). Used by
  lobby cards (bust), HUD panel / now-playing / decision sheet / ranking (face), cut-in tabs. 2D board pawns (26 px)
  and admin stay SVG.
- Customizer: preview = `layeredPreviewRenderer` (bust in the circle; 「전신 보기」 chip `[data-crop-toggle]` passes
  `crop: 'full'` → `.cz-preview.full` tall card); expression chips → part expressions.
- Measured (SwiftShader headless, desktop dpr 1): first compose with images cached 15–45 ms (≤ 105 ms at dpr 2 /
  level 0.75), cached < 0.5 ms, cold incl. image loading ≈ 180–370 ms. E2E: `s55c` scripts in the session scratchpad.

## MC NPCs (Stage 5.6)
- 호야 (`hoya`, 리액션, 반말 "~멍!") & 봄이 (`bomi`, 진행, 짧은 존댓말 "…그렇습니다"/"흥") — the user's Shih Tzus. Photos live
  ONLY in `DATA_DIR/mc-refs/` (gitignored); never copy them into `public/` or tracked paths.
- Data: `server/data/mc.json` (`getMc()`, in `gameData().mc`): `order`, `expressions` (neutral joy surprise sad angry proud
  sleepy), `poses` (idle wave clap mic), `profiles.<id>` {name, role, personality, speech, looks, colors}, `bigAmount`,
  `frequency.<many|normal|few|off>` {label, medium, minor (chances), cooldown, duoChance}, `situations.<key>` {weight
  big|medium|minor, lead hoya|bomi|any, duo true|false|'chance', vars[], hoya/bomi: {expression, pose}}, `eraSituations`,
  `tileSituations` (tile type → situation; `{}`: heart/treasure are still placeholder tiles, and any tile type listed in
  `board.json.placeholders` is skipped anyway — a test guards that placeholders never produce marriage/treasure MC lines;
  Stage 6 maps job outcomes (`jobChanged` hire → job, `rankUp` → promotion …) instead of the job tile). Pools: `lines.json` `mc.<key>.{hoya,bomi}` = string | {t, e?, p?},
  `mc.<key>.duo` = 2–3 line dialogues [{s, t, e?, p?}] (both MCs). Tests: ≥6 per speaker + ≥6 duos per situation,
  ≤48 chars, placeholders ⊂ situation `vars`, every 호야 line has 멍. `birth` is reserved (no engine event yet — Stage 6).
- Engine: `presentation.js` `attachMc` (end of `decorateEvents`) → qualifying events get `mc: [{speaker, line, expression,
  pose, part?}]`, `mcWeight`, `mcKey`, `mcStudio` (game start + first character entering each era after the first).
  Situations: gameStarted→gameStart, first turnStarted→firstSpin, eraChanged→era<Era>|eraChange, routeChosen→routeChoice,
  landed→tile situation | bankrupt/bigWin/bigLoss/smallWin/smallLoss (skipped when a prompt follows), moneyChanged
  pension, exam promptResolved→examPass/Fail, finished→goalFirst/goalLast/goal, betResolved win→betWin, gameOver→result
  show (parts intro/winner/last/penalty, also copied to `room.result.mc` for reloads). Sub-RNG `hashSeed(seed, turnNo,
  index, type, 'mc')`; big = always (unless off), medium/minor roll `frequency` and respect `room.mcState.cool`
  (`{cool, eras[], firstSpin}`, engine-only). Room config `mcFrequency` many|normal|few|off (default normal;
  `server/game/config.js` `MC_FREQUENCIES`, admin form 많이/보통/적게/끄기). `/api/meta.mc` = mc.json + `lines` (mc pools).
- Client `public/js/ui/mc.js`: `mcSvg(id, {expression, pose, uid})` pure SVG chibi dog (markings per photos; groups
  `.mc-tail/.mc-ear-l|r/.mc-breath/.mc-headbob/.mc-wave/.mc-clap-*` animated by `public/css/mc.css`), `renderMc` (generated
  art via `mcArt`: only once `mc-<id>-neutral` is accepted, then pose > expression > neutral; never mixes art + SVG),
  `createMcBooth` / `playMcScript` / `mcScriptMs` / `mcSpeakers`, `createMcCorner` (fixed bottom-right booth for lines outside
  cut-ins, waits for `cutin.whenIdle()`), `mcLinesFrom` / `resultMcFrom` (client picking for the lobby greeting and the
  result fallback after an admin force-end). Sizes come from `--mc-size` (cut-ins use `cqw`).
- Cut-ins: `planCutins` groups carry `mc` (anchor's lines, else the first follow-up's), `studio` (anchor lines of an
  `mcStudio` event) and `mcEvents`. `cutin2d`: `spec.mc` → `.ci-mc` small booth bottom-right of the window after the
  character line (1.2 s apart, auto-advance stretched, never blocks ▼); `cutin.studioSpec(lines, {key, tone, title, era,
  characters})` → spec `kind: 'mc'` (TV studio bg `findAsset({kind:'bg', scene:'studio'})` else the SVG 「인생 방송국」 scene;
  `.ci-studio` two MCs + desk, lines accumulate in the box). game2d: `showGroup` = studio (if any) then the event cut-in;
  gameStarted studio from `onEvents`; other `mc` events → corner (3D: after their animator step via `MC_CORNER_TYPES`
  wrappers). Result intro = studio (`part: 'intro'`) → podium cut-in with the other parts as `spec.mc`. `mcFrequency: off`
  hides everything client-side too. Sound: `audio.play('bark', {mc})` (`SFX_NAMES` has `bark`).
- 3D: `scene/mascotParts.js` (pure specs: body/head/tail per dog, pivots) + `scene/mascots.js` (`createMascots(scene,
  {material})`: 3 merged meshes per dog = 6 draw calls, ~1.2k tris each (test ≤1.5k), tail wag/breathing, `react('hop'|
  'spin')`, `look(ms)`). board3d places them behind the first tile of the shown character's era (hop over on era change);
  API `setMascots(on)`, `mascotReact(kind)`, `mascots`; `reaction()` makes them look at the camera; `stats().mascots`.
- Assets: manifest kind `mc` (meta `{mc: hoya|bomi|duo, expression | pose}`), items `mc-<dog>-<expression>` (7),
  `mc-<dog>-pose-<wave|clap|mic>`, `mc-duo`, plus `bg-studio` (kind bg, meta.scene studio — NOT in tones.json scenes).
  `localRefs: ['data/mc-refs/<file>']` (validated by `localRefName`; plain file names only) are read by the studio from
  `DATA_DIR/mc-refs` at generation time (realpath containment, 409 `LOCAL_REF_MISSING`, 400 `LOCAL_REF_INVALID`), sent as
  JPEG refs, never published. `scripts/gen-mc-manifest.js` = idempotent upsert of the 22 items (prompts describe the
  markings). Generate: `node scripts/gen-assets.js --kind mc --accept-first --parallel 2` + `--only bg-studio`.
- Tests: `test/mc.test.js`. E2E (session scratchpad `s56/e2e.cjs`, screenshots `s56-*.png`).

## Host tools & hardening (post-5.6 fixes)
- Contract for the client (details above in Stage 1/2 + Domain notes): room config `turnTimeoutSec` (0|30|60|90|120),
  state `turn.spinDeadlineAt` (ms epoch | null) + `pending.deadlineAt`; admin actions `timeout | forceSpin | skipTurn`;
  spectators via `POST /api/rooms/join {code, name, spectator: true}` → `players[].role`, `me.role`; bets
  `balance.bets.payouts[pick]` with ranges 1-3 / 4-6 / 7-10; group prompts 40 s.
- Tests: `test/fixes-engine.test.js` (pension, bet EV, turn timer, skip/force spin, RNG secret, era minimums,
  spectators, small bias simulation), `test/fixes-server.test.js` (admin password file, persistent admin sessions,
  rate limits, host tools + spectators over HTTP, SSE cap, session TTL, ordered writes, runner auto spin with mocked
  timers), `test/fixes-assets.test.js` (candidate traversal, index cache, Gemini body timeout, AI art request limits).
- sharp ≥ 0.35.4 (npm audit clean).

## Verification fixes — client (post-5.6)
- Pure policy `public/js/ui/cutinPolicy.js` (node-tested, `test/client-cutinPolicy.test.js`): `classifyGroup(g, {mine, mode,
  promptForMe, gameOver, queued, globalOff})` → `full|banner|skip` (my events full; 「관전 컷인」 `full|compact|off`, default
  `compact` = other players' minor events as banners, big ones full: studio / finished / eraChanged / heart·job tiles /
  marriage·job mcKey·lineTag; a pending prompt of mine turns every event cut-in into a banner; others' full cut-ins beyond
  `SPECTATOR_BACKLOG` = 2 queued become banners), `mergeGroups` (one batch's consecutive groups of the same OTHER character
  → one cut-in, biggest anchor wins, `anchors[]`; 3D attaches it to the last anchor), `myPendingChars`, `ROUTE_INFO` /
  `routeOptionInfo` (server `option.desc` wins), `betPicks(balance.bets)` (odd/even + server `ranges`, `payouts[pick]`).
  Constants: `PREEMPT_KEEP_MS` 1500, `PROMPT_BOARD_WAIT_MS` 1200, `BANNER_MS` 2200, `CAST_PRELOAD_MS` 600.
- game2d: every group goes through `presentGroup` (3D animator handlers classify at play time; `full` pauses the animator,
  banners never do). My prompt (single or group): `cutin.preempt()` (drops queued event cut-ins, current one closes ≤1.5 s
  after it appeared) + `showPrompt(p, {urgent})` (front of the queue); 3D waits ≤1.2 s for the board, then opens over it.
  Others' prompts: 「전체」 = old waiting cut-in, else one banner (the spin dock shows who's choosing + countdown). After I
  answered a group prompt in compact/off the cut-in closes. `finish()` on gameOver/finished state: hides cut-ins, banners,
  MC corner, locks controls → result screen right away (2D ≈ 0.2–0.7 s after gameOver). Toolbar select
  `data-el="cutinmode"` (localStorage `jinsei.spectatorCutins`, `?spectatorCutins=`; legacy `jinsei.cutins=off` → off;
  `?cutins=off` still = board only incl. prompts → modal).
- `public/js/ui/banner.js` `createBanner(root, {getMeta})` → `show(spec, {ms})` (spec = `cutin.specFromGroup`), `clear`,
  `busy`; fixed strip under the top bar (z 21, no pointer events, hidden while a cut-in is open), backlog 2.
- cutin2d: `preempt({keepMs})`, `clearQueue()`, `showPrompt(..., {urgent})`, `createCutin(..., {now})` (server clock for
  countdowns); the cast is preloaded before a window opens (`preloadAvatarLayers`, cap 600 ms / 300 ms for prompts);
  `renderAvatarLayers` places a cached composition synchronously, else the SVG until it's composed (no empty slot).
  Prompt options keep their buttons while only `answered` changes (no swallowed clicks); route options show a description
  line; prompt tag = its title (`🔀 인생 갈림길`, `📝 수능 날`), route tags drop the repeated tone label.
- Spin dock (`data-el="dock"`, `.spin-dock.can-spin` = sticky above the reaction bar); bets are their own card
  (`data-el="bet"`). Spin/bet are held (hidden) while the 3D HUD is held, while event cut-ins play and for
  `TURN_GRACE_MS` 700 after a turn change (no "지영의 차례" + "민수 룰렛" mismatch, no clicks under an arriving cut-in).
  Countdowns: `turn.spinDeadlineAt` (⏱) and `pending.deadlineAt` via `format.secondsLeft` + `api.clockOffset()` (HTTP
  `Date` header bounds, `format.clockBounds`). `run()`: a 409 after the state moved on → silent resync (app `resync`),
  no toast. `spun.auto` → toast.
- Spectators (`me.role === 'spectator'`): join button 「👀 관전으로 입장」 (`POST /api/rooms/join {spectator:true}`, empty
  name → 관전자), `body.spectator` hides the lobby panel, `.game.spectator` hides spin/bet; top-bar 👀 관전 badge; lobby
  lists spectators separately. Names: `format.graphemes/nameLength/clampName/nameFits` + `ui/nameInput.js`
  `bindNameInput(input, counter)` (n/12 counter, IME-safe cut; `maxlength` 40 in markup).
- `api.js`: `onCharArt(fn)` / `sseConnected()`; `charArt` SSE events drive the customizer AI slot (reload until the
  committed state shows ready/failed; 1 s polling only while SSE is down).
- Admin: host box (turn/phase/deadline + 「프롬프트 시간 초과 처리」「대신 룰렛 돌리기」「이번 턴 건너뛰기」 → `POST
  /admin/api/rooms/:id/actions`), 「턴 제한 시간」 select (`meta.turnTimeouts` when present), era minimum hints
  (`meta.minTurns[mode][era]`, else client mirror), CPU checkbox removed, 390 px layout.
- CSS: long-name truncation (lobby cards 2-line clamp, HUD/side list/ranking ellipsis, `minmax(0,1fr)` grids — grid items
  need `min-width: 0` or a nowrap child widens the page), crowded 2D tiles (3 overlapping pawns + "+N"), 3D name tags on
  < 700 px canvases = current / moving (+ mine off crowded tiles), roulette pop z 21 (under cut-ins), single-row cut-in
  tabs, reaction bar compact row + client pacing (4 per 2 s, no toast on 429), no floating emoji while a cut-in is open,
  inputs ≥ 16 px on touch devices, narrow top bar.
- E2E (session scratchpad `fixb/*.cjs`, screenshots `fixb-*.png`): `widths.cjs` (max-length names 390/1280, lobby/game/
  cut-in/result), `game.cjs` (natural-pace 4-client game, `BOARDS=`, `SPECTATE=1`), `prompts.cjs` (API spin spam +
  reactions; prompt visibility per owner), `misc.cjs` (routes, admin host tools, TV spectator, CTA), `probe2.cjs`, `art.cjs`.
  Note: in SwiftShader the 3D board build blocks the main thread ≈ 8 s at game start (prompts in that window show late).

## Stage 6 — stats, careers, jobs (server)
- Data: `server/data/jobs.json` (`jobs[]` 17 regular + 6 hidden `{id, name, icon, hidden, desc, requires: {stats?, education?},
  ranks: [{name, salary}], rankUp: {stat, base, perStat, expNeeded}, injuryRisk, outfit, scene, tone, unlock?}` + `partTime`
  (id `parttime` 알바, 3 ranks)), `news.json` (29 era news `{id, eras?, title, text, tone, effects}`), `events.json` (79 life
  events, replaces `board.json.events`: `{id, eras?, text {name}, money?{min,max}, scale?, stats?, tone, scene?, emotion,
  lineTag?, conditions?{job: id|'any'|'parttime'|'none', education, route}, weight?, kind?: 'groupGift', gift?}`), all via
  `gameData()` (`getJobs/getNews/getEvents`) and `/api/meta.jobs|news` (+ `balance.stats|military|career`).
  `balance.json`: `stats` (cap 10, start 2 + 1 seeded point; adult mode +5), `habits`, `exam` (probability table), `career`
  (tuition, collegeTurns, 재수), `military`, `jobs` (offer count/weights, salary era mult, rank-up/education/exam bonuses,
  injury, overtime, max-rank 성과급). `avatars.json.eraOutfits` = contract table (client `effectiveAvatar`).
- Board: new tile types `habit` (kids eras, weight 3), `salary` (routes: career 4 / love 3 / money 2, senior main 3),
  `job` (career route 3, senior 1); `board.json.placeholders` no longer has `job`. tones.json `cutinTiles` + habit,
  `tileTones` salary→career / habit→good, new `tagScenes` and `sfx` keys (rankUp, salary, newsFlash…).
- Modules: `prompts.js` (registry `PROMPTS` + `registerPrompts`, `openPrompt`, `resolvePrompt`; `resultCutin: true` always
  emits a `promptResolved` anchor, `'auto'` only when the resolution emitted no other anchor (`ANCHOR_TYPES`); a plain object
  returned by `resolve` is merged into it, e.g. exam `{result}`, habit `{result, stat}`, jobTile `{result}`); `growth.js`
  (`initLife`, `ensureLife` (pre-Stage-6 saves), `examChances/examOutcome`, habit/exam/career/military prompts,
  `spinSteps`, `startMilitary/endMilitary/graduate`, **`lifeStep(tx, c)`**); `jobs.js` (`jobDef`, `eligibleJobs`,
  `offerWeight/offerCandidates/offerJob`, `hire`, `salaryAmount/paySalary`, `rankUpChance/tryRankUp`, `rollInjury`,
  `unlockMet/checkHiddenUnlocks`, `resolveJobTile`, jobOffer/jobTile/hiddenJobOffer prompts); `news.js` (`NEWS_DEFAULTS`,
  `newsEffects/effectsFor`, `drawNews`, `applyEraNews`, `drawStartNews`); `spaces.js` keeps tiles + routeChoice/groupGift
  (+ `eventConditionsMet/eventPool`). `effects.js`: `addStat/addStats` (clamp 0..cap, `statChanged` with the actual delta),
  `addDebt` (loans), `round5`, `statName/statText`; `josa(word, '으로/로')` handles ㄹ.
- Character (public): `stats {int,str,charm,luck}`, `education none|college|elite`, `examResult elite|college|fail|null`,
  `military {status none|serving|done|exempt, turnsLeft, deferred?}`, `job {id, rank, exp, injured} | null`, `jobHistory
  [{id, rank (highest), era (hired in)}]` (every job incl. the current one), `hiddenUnlocked [jobId]`; additive: `school
  {tier, turnsLeft} | null` (enrolled), `careerDone`, `careerChoice college|job|retake`, `retook`, `skipTurns`, `badEvents`.
  Room: `news {eraId: newsId}` (in `viewFor`), config `growthOutfits` (bool, default true).
- Turn flow: `continueTurn` resolves prompts, then runs `lifeStep` for the current character until it opens nothing:
  전역 (turnsLeft 0) → 졸업 (`educationChanged`, int +1) → 진로 prompt (lifetime, on the 청년 갈림길) → 군 복무 decision →
  job offer (`jobOffer`, or 알바 at once when nothing is eligible) → automatic 입대 (mandatory body, not enrolled) →
  `routeChoice` (the 갈림길 stop no longer opens it in `resolveTile`) → hidden-job unlocks (`hiddenJobUnlocked` +
  `hiddenJobOffer`). Loop guard 64. `endTurn` skips characters with `skipTurns` (재수) with a log line.
- Rules: habit prompt (4 options, stat +gain (+1 at `bonusChance`), money cost/roll × era scale × news). 수능: `r = rng.next()`
  vs `examChances` (base + int×지력 + luck×운 + news `examBonus` (+ `retakeBonus`)), the better result is kept. 진로: college
  (tuition as debt, `collegeTurns` of school, then graduation → job offer), 바로 취업, 재수 (not for elite, once: skip
  `retakeSkipTurns`, retake exam → a pass enrolls, a fail goes to work — no second 진로 prompt). 군: mandatory bodies
  (`boy`) — enrolled → prompt 지금/졸업 후 (once), otherwise automatic after hiring (job kept); volunteers (`girl`) with str ≥
  `volunteerMinStr` → prompt; else exempt. Serving: spins move `ceil(value/2)` (`spun.steps`, `halved: true`), military pay
  per spin and on salary tiles, str +2 at 전역; school is paused. Jobs: `eligibleJobs` = requirements + news
  (`jobRequireDelta`, `jobDelta`) + education; offers weighted by `offerWeight` (1 + 0.5×(Σreq−3) + 1.5 with a degree), no
  hidden jobs. Salary tile: `ranks[rank-1].salary × salaryEraMult × news salaryMult (× partTimeMult) × (injured ? 0.5)`,
  jobless students = 알바 pay; exp +1 → passive rank-up at `expNeeded`. Rank-up chance = base + perStat×stat +
  luckBonus×luck + educationBonus (+ examBonus on a promotion exam) + news `rankUpBonus`, clamped; success → `rankUp` + the
  job's stat +1; injury blocks. Job tile: `jobTile` prompt 승진 시험 (or 성과급 at max rank) / 전직 (one eligible candidate,
  `option.jobId`) / 야근 (60 % salary, exp +2, str −1); students / soldiers only look around; a pending unlocked hidden job
  is offered instead. Injury: `injuryRisk × news injuryMult` after salary / promotion exams → `injured` = 2 turns
  (decremented per spin). Hidden unlocks (data `unlock`, all must hold, job eras only): 우주비행사 int 9 & str 9; 국민 MC max
  rank of 개그맨/배우/유튜버 (now or history) & charm 9; 재벌 총수 max 대기업 & net worth ≥ 3,000; 트로트 스타 senior & charm 8 &
  luck 8; **interim until Stages 7/8**: 산신령 luck 9 & `badEvents` ≥ 3 (loss tiles, bad events, injuries), 건물주 middle_age
  & cash ≥ 4,000. News: first entrant of an era (not baby; adult mode draws 청년 at start) → `room.news[era]`, `newsFlash`
  (global, no charId; MC studio `news`), `statBonus` for every entrant; effects via `effectsFor(tx, c)` (character's era).
- Events: `statChanged {charId, stat, delta, value, reason}` (habit/event/news/military/graduation/rankUp/overtime),
  `jobChanged {charId, jobId, fromJobId, rank, reason: hire|change|hidden|parttime}`, `rankUp {charId, jobId, rank, rankName}`,
  `salary {charId, jobId, rank, amount}` (+ `moneyChanged` reason salary), `injured {charId, jobId, turns}`,
  `hiddenJobUnlocked {charId, jobId}`, `newsFlash {eraId, newsId, title, text, tone}`, `militaryStart {charId, turns}`,
  `militaryEnd {charId}`, `educationChanged {charId, education}`; moneyChanged reasons tuition (debt), military, habit,
  overtime, bonus. Presentation: all in `EVENT_TYPES`; `CUTIN_TYPES` + jobChanged rankUp hiddenJobUnlocked injured newsFlash
  militaryStart educationChanged (statChanged / salary / militaryEnd are follow-ups; militaryEnd is a boundary); job events
  use the job's `scene`/`tone`; event tiles use events.json `lineTag`/`scene`/`tone` (eventId rides on the log event);
  character-less logs use the `neutral` pool. New line tags (5–10 each) + placeholders `{job} {rank} {news} {stat}`.
  MC situations `job` (hire only), `promotion`, `hiddenJob`, `injury`, `military`, `news` (studio) — never a job-tile landing.
- Balance (`scripts/simulate.js` prints the Stage 6 block: spins per mode, lifetime decisions per character by kind, final
  job distribution, 알바/무직/hidden %, final ranks, salary share of income, stats at era entry, exam / career / military
  splits, net worth by education and by route per era, news counts). Seed 11 × 300: max job 12.5 %, 알바 0.2 %, hidden held
  1.2 % (unlocked 3.5 %), salary 23.5 % of income, route gaps ≤ 14.2 % (≤ ±7.1 % of the mean), lifetime 78.8 spins
  (was 76.8), ≈ 8.7 decisions per character (7.8 own + others' birthday gifts; random play retakes 36 %).
- Tests: `test/stage6-life.test.js` (init, stat caps, habits, exam table, 진로 branches incl. 재수 once, 군 복무, news,
  migration, restore mid-career), `test/stage6-jobs.test.js` (data schemas, offers, salary, rank-ups, injury, job tile, all
  6 hidden unlocks, presentation/MC mapping, random lifetime games, growthOutfits, `/api/meta`).

## Stage 6 — client (stats, jobs, growth outfits)
- Pure `public/js/shared/growth.js` (no imports; node-tested in `test/client-growth.test.js`): `effectiveAvatar(character,
  {room, avatars, jobs, job?})` = the look drawn in game — only in playing/finished rooms with `config.growthOutfits !==
  false`: `eraOutfits[era][body] ?? .any`, `job: true` eras → jobs.json / partTime `outfit` of `character.job` (no job /
  unknown → chosen outfit); unknown costume ids ignored; `outfitColor` kept (fixed-colour outfits ignore it in every
  renderer). Table = `avatars.eraOutfits` when non-empty, else `DEFAULT_ERA_OUTFITS` (same contract). `characterEra` =
  `character.era` else board position. `displayCharacters(room, {avatars, jobs, overrides: {[id]: {job}}})` → characters
  with `avatar` = effective look + `chosenAvatar`. Also `STAT_KEYS/STAT_INFO` (지력 🧠 / 체력 💪 / 매력 ✨ / 운 🍀 + colours),
  `statCap(meta)` (`balance.stats.cap`, else 10), `statPct`, `statRows`, `statChip`, `salaryChip`, `jobInfo`, `jobBadge`
  (icon · name · ★ rank/max · rankName · injured · partTime · hidden), `rankStars`, `rankSalary`, `educationLabel`
  (대졸/명문대졸), `militaryLabel` (복무 중 (n턴)/군필/면제), `requirementBadges` (`requires` {stats:{…}} / flat / education),
  `optionExtras(pending, option, {jobs})` (job prompts: icon, rank-1 salary, requirement badges; `option.jobId` wins).
- game2d draws a **display room**: `render(room)` → `displayRoom()` (WeakMap display → raw, so internal `render(ui.room)`
  calls are safe); `ui.rawRoom` = server view. Everything that reads `c.avatar` (portraits, cut-in cast, banners, tabs,
  2D pawns, 3D pawns, result) gets the costume; lobby / customizer keep using `state.room` (chosen look). Portrait /
  compositor / pawn caches key off the avatar JSON, so an era / job change re-renders. AI art (`art.status === 'ready'`)
  still wins in cut-ins/portraits. `cutinOpts(g)`: a `jobChanged` cut-in shows its character in the event's job costume.
- Side list rows (`.gc-row` button, `data-char-detail`): job badge, 🤕 n턴, 🎓 학력, 🪖 복무 중, mini 4-stat strip; tap →
  inline detail card `.gc-detail` (stat bars `role=meter`, 직업 + rank name, 학력, 군 복무, 직업 이력, 숨은 직업); one open at a
  time (`ui.openChar`). Result rows: final job badge + 학력 (`.rk-career`). Everything hides when the fields are absent.
- News: top-bar `data-el="news"` badge (📰 title of the shown character's era: `room.news[eraId]` → `/api/meta.news.news`,
  else the last `newsFlash` payload; tap → `data-el="newspop"`). `newsFlash` → 2D strip `data-el="newsflash"` / 3D
  `b3.showBanner('📰 …')`. `planCutins` folds the batch's newsFlash into the era's studio group (`g.news`, its own MC
  lines appended to `g.studio`, no separate cut-in); without a studio group (adult mode: after gameStarted) it keeps its
  own studio lines + `news`; studio spec `news` → `.ci-news` 「📰 속보」 strip; MCs off / no lines → `kind: 'news'` cut-in.
- Cut-ins: `cutinMap.STAGE6_ANCHORS` (jobChanged rankUp hiddenJobUnlocked injured newsFlash militaryStart
  educationChanged) are anchors even without `cutin: true` and are follow-up boundaries; `statChanged`/`salary`/`militaryEnd`
  follow-ups → `g.stats[]`/`g.salary[]`/`g.discharged[]` → chips (`ci-chip stat stat-<key>`, `salary`, 🎖️ 전역; a salary
  chip replaces its moneyChanged chip); a militaryEnd with no anchor before it = its own group → banner.
  `spun.halved`/`steps` (serving): 2D float / 3D pop 「🪖 n칸」, spin hint 「(🪖 복무 중 n칸 이동)」.
  `tagLabel`: 💼 취업/전직 (reason hire/change), 🧾 알바 시작 (parttime), 🌟 숨은 직업 전직 (hidden), 🎉 승진, 🌟 숨은 직업 해금, 🤕 부상, 🪖 입대/전역, 🎓 졸업, 📰 뉴스 속보. `cutin2d` `STAGE6_LOOK`
  (tone/scene/pose/emotion/sfx defaults; server values win), `spec.badge` → `.ci-badge` (job icon, name, ★, rank name),
  `spec.fx: 'gold'` (hidden job: gold frame + sparkles), cast `glyph` (🤕 🪖 🎖️ 🎓), `spec.sfx` ('fanfare' for hire /
  rank-up / graduation). Prompt options get `badges` (💵 첫 월급, requirement badges) in the cut-in and the 2D modal.
- Policy: `isBigGroup` adds jobChanged/rankUp/hiddenJobUnlocked/newsFlash (full even in compact); `MINOR_TILE_TYPES`
  habit/salary never count as big; `BANNER_TYPES` militaryEnd = banner (also mine). Option labels drop a leading copy of the
  option icon (`optionLabel`); no 💵 badge when the server desc already names the pay. Merge ranks: hidden 9, job/rankUp 8.
- 3D: animator `ANIMATED_EVENTS` + statChanged, salary and the Stage 6 anchors; board3d handlers float stat changes
  (stat colour), 💵 over the pawn, pop 💼⭐🌟🤕🪖🎖️🎓 (+ confetti for rank-up / hidden / graduation), newsFlash banner.
  Tile colours / glyphs for habit (📚, asset icon `tile: 'school'`) / salary (💵, money icon asset + green ring and 「월급」
  ribbon in the same atlas cell). Pawn costume changes wait for the sync grace (420 ms) / animator idle, then ✨.
  `CLIENT_TILE_TYPES` (game2d) / `DEFAULT_TILE_GLYPH` (board3d) cover habit/salary until board.json has them (meta wins).
- Admin: 「성장 의상」 checkbox (`growthOutfits`, sent only when off) + hint; room detail shows it.
- Debug (`?debug=1`): `window.__game` = the game UI (`render`, `onEvents`, `renderResult`, `room` = display room).
- E2E: session scratchpad `s6b/` (`inject.cjs` injected Stage 6 state, `SHIM=1` fakes `/api/meta.jobs/news` for a server
  without them; screenshots `s6b-*.png`).

## Stage 7 — cards, items, interaction (server)
- Manual asset import (the user draws in the Gemini app, no API): `assets-inbox/<asset id>.png|jpg|jpeg|webp` (gitignored
  except its README) → `node scripts/import-assets.js [--dir assets-inbox] [--only id[,id]] [--dry-run] [--keep]` =
  `importAssets({dir, only, dryRun, keep, manifestPath, outputDir, dataDir, studio, log})` → `studio.upload(id, buf,
  {process: true, watermark: true})` (item postprocess, accepted `source: 'upload'`), inbox file deleted unless `--keep`,
  Korean summary per file (output size, % transparent for keyed kinds, warnings: small source upscaled, aspect far off,
  almost no / almost all transparency). Unknown id / kind part / sprite → skipped, exit 1. The studio gets a client that
  refuses API calls. `watermark: true`: kind bg/anchor are flattened (never letterboxed) and cropped ~4 % right+bottom
  (`cropWatermark`) before the cover resize; `chromaKey`/`whiteToAlpha({watermark})` sample the backdrop from 3 corners
  (`sampleBackground({corners: 3})`) and `clearCornerIslands` removes an isolated island inside the bottom-right box
  (`WATERMARK_BOX` seed 10 % / fit 16 %; defaults unchanged for every other caller).
- Manifest kinds `card` (meta.card = cards.json id) and `item` (meta.item) — icon pipeline (`whiteToAlpha, trim,
  resize:256x256` → png). New ids (status todo): `bg-stage bg-stadium bg-gym bg-army bg-campus bg-kitchen bg-police bg-lab
  bg-space bg-shop bg-holiday` (meta.scene), `card-<id with _→->` ×16 (`cards/<…>.png`), `item-<…>` ×6 (`items/<…>.png`),
  `icon-job-<…>` ×23 (`icons/jobs/<…>.png`, meta.job). Scenes: presentation `SCENES` + tones.json `scenes` have the 11 new
  scenes; `tones.json.sceneFallbacks` maps each to one of the 5 original scenes (the client draws the fallback until the bg
  is accepted; a test enforces that). jobs.json scenes: stage (idol actor comedian esports trot_star national_mc),
  stadium (baseball soccer), gym (fighter), kitchen (chef), police, lab (researcher), space (astronaut); tagScenes
  military/military_end → army, graduation → campus (educationChanged scene campus).
- Data: `cards.json` `{handLimit 5, eraScale, cards[{id, name, icon, kind instant|passive|sabotage, desc, price, weight,
  jobOnly?, effect}]}` (16 fixed ids), `items.json` `{items[{id, name, icon, desc, price, resale, stats?, effect}]}` (6),
  `holidays.json` (eras, kinds seol/chuseok, names/icons, sebae ranges per era, nagging, stakes × stakeScale, hwatu 1..10),
  `balance.json` `lotto {pool 20, pick 3, prizes {3:1000, 2:100, 1:10}, keepDraws}`, `shop {cards 2, items 1}`, `trades
  {ttlMs 60000, maxMoney}`; `gameData().cards/items/holidays` (`getCards/getItems/getHolidays`); `/api/meta` adds `cards`,
  `items`, `holidays`, `balance.lotto|shop|trades`. events.json: `card` reward on 6 events. Board: card tiles in elem/
  middle/high (habit 2 / card 2), every route (career 2), senior (card 2, shop 1); shop on the money route (2); card/shop
  left `placeholders`.
- Modules: `server/game/cards.js` (hands, passive helpers, spin mods, `useCard`, card tile, `shop` prompt, trades, gifts),
  `server/game/holidays.js` (era openings, lotto, `holiday` prompt). `assertOwner` moved to effects.js.
- Character (public): `cards [{uid, id}]` (uid `k<seq>` from `room.nextCardSeq`; hand limit → the oldest is discarded with
  a log, `cardGained.discarded`), `items [itemId]` (one each), `spinMods [{kind: plus|minus|max2|min2, value?, by?, card}]`
  (applied + cleared at the next spin), `lastTargetedBy {attackerId: round}`. Room: `nextCardSeq`, `nextTradeSeq`,
  `trades [{id 't<seq>', fromId, toId, give, want, createdAt, expiresAt}]` (sides `{money}` | `{cardUid, cardId}`),
  `holidayCount`, `holidays {eraId: seol|chuseok}`, `lotto {draws [{eraId, numbers, entries, at}]}`, `erasOpened [eraId]`,
  `eraQueue`; config `holidays` (bool, default true, validated "명절 대잔치 값은 true/false여야 합니다."). `turn.cardUsed`.
  `viewFor` adds `trades`, `holidays`, `lotto` (hands/items/trades are open information; nothing new is masked).
  `ensureCards` / `ensureRoomCards` migrate older saves (eras already reached count as opened).
- Actions (`POST /api/rooms/:id/actions`, spectators 403, owner via actor): `useCard {characterId, cardUid, targetId?}` —
  current character, awaitSpin without a prompt, 1 per turn, passive → 409, `jobOnly` (pledge = politician) → 409, sabotage
  needs another unfinished target (400 missing/self, 409 finished) not sabotaged by you this or last round
  (`lastTargetedBy[you] ≥ round − 1` → 409); target's `lawyer` blocks it (both consumed → `cardBlocked`, no `cardUsed`).
  `offerTrade {characterId, toId, give, want}` (one side = exactly one of money (int > 0) | cardUid; not money↔money; own
  characters / CPU / finished refused; one open offer per character; give cash / both cards checked), `respondTrade
  {characterId (target), tradeId, accept: bool}` (re-validated → `tradeResolved {status: 'cancelled', reason: 'invalid'}`
  when a side is gone), `cancelTrade {characterId (offerer), tradeId}`, `gift {characterId, toId, money? | cardUid?}`
  (immediate, own characters allowed → `gift.family`), `expireTrades` (system/admin; runner). Offers expire before every
  action at `now ≥ expiresAt` (60 s), when the offerer's turn starts and when either side finishes (`tradeResolved expired`);
  game end clears them. Trades/gifts never change phase/pending. `GameRunner.deadlineOf` returns `{kind: 'trades'}` when
  the earliest `expiresAt` comes before the prompt/spin deadline → dispatches `expireTrades`. `choose` refuses an option
  with `disabled: true` (409 "지금은 고를 수 없는 선택지예요.").
- Card effects: study int+1, insider charm+1, energy `plus 2`, taxi `max2` (second roll, keep the higher), pledge = every
  other unfinished character pays `donation × eraScale[era]` (≤ their cash); passive (auto, `cardUsed {auto: true}`):
  bonus (next salary ×2 in `paySalary`), insurance (`applyLoss`: loss tiles, bad events, tax, fines → halved once),
  amulet (`tryAmulet`: cancels an injury roll or a bad event tile, `cancelled: 'injury'|'badEvent'`), lotto (ticket),
  coupon (next shop purchase 50 %), lawyer (blocks one sabotage); sabotage: cut_line `minus 3` (move ≥ 1), noise `min2`,
  tax_audit 10 % of cash ≤ 300 (via applyLoss), complaint (job → exp −2, else fine 30 × eraScale), gossip charm −1.
  Spin: `applySpinMods` → `spun {value (roulette result, bets resolve on it), steps? (move when ≠ value), rolls? [a, b],
  mods? [...], car?, halved? (military only)}`; 경차 turns a move of 1 into 2.
- Tiles: `card` → one weighted card (`drawableCards`: job-only cards only for that job) → `cardGained {source: 'tile'}`;
  `shop` → prompt `shop` (single): options `buy:0..2` (2 cards + 1 unowned item; `{price, basePrice, cardId|itemId,
  disabled?}`, desc names the coupon / shortage) + `leave` (default); item → `itemBought {charId, itemId, price}` (anchor,
  stats via addStats reason 'item'), card → `cardGained {source: 'shop'}` + `promptResolved {result: 'card', cardId}`,
  leave → `promptResolved {result: 'left'|'noMoney'}` (resultCutin 'auto'). Items: car (move 1 → 2), laptop (int +1,
  +10 % salary for webtoonist/youtuber/esports via `itemSalaryMult`), gym_pass str +1, designer_bag charm +1 (resale 0.9),
  lucky_cat luck +1, massage_chair (`guardStats`: no str loss from senior events). `computeRanking(room, {data})` rows add
  `items` (Σ floor(price × resale)) and `total = money − debt + items`.
- Era openings: the first entrant of an era (not the mode's first) queues it (`queueEraOpening` in `enterEra`, after
  news/pension); `continueTurn` runs `runEraOpenings` whenever no prompt is open, before the current character's
  `lifeStep`: ① lotto draw (holders of a `lotto` card use one each; 3 seeded numbers of 1..20 each, 3 drawn → `lottoDraw
  {eraId, numbers, entries [{charId, numbers, matches, prize}]}` + moneyChanged `lotto`; skipped without tickets; exact EV
  `lottoExpectedValue` 8.93 < price 20) ② holiday (eras middle/young/middle_age/senior, config on, once per era,
  seol/chuseok alternate by `holidayCount`) → `holidayStarted {eraId, kind, name}` + ONE simultaneous prompt `holiday`
  (all unfinished characters, 40 s, options `pass` (default) | `small` | `big` with `stake` = stakes × stakeScale[era]).
  Resolution → `holidayResult {eraId, kind, name, results [{charId, sebae, nagging {stat, delta, line}, stake, card, won,
  line, lineTag}], pot, winners}` then moneyChanged (`sebae`, `gostop`) / statChanged (`nagging`): ① 세뱃돈 roulette
  (kids eras +, adult eras − never into debt) ② 잔소리 (random stat ±1) ③ 고스톱: stakers (stake ≤ cash, ≥ 2 of them) draw
  1..10; each loser pays min(own stake, top winner stake), tied winners split (floor, remainder to the first) → Σ won = 0.
- Events (all in `EVENT_TYPES`): `cardGained {charId, cardId, uid, source: tile|shop|event|trade|gift, discarded?, from?}`,
  `cardUsed {charId, cardId, uid, cardKind, targetId?, auto?, cancelled?}` (+ `targetLine` from pool `sabotaged` on
  sabotage), `cardBlocked {charId (attacker), targetId, cardId, uid, lawyerUid}`, `itemBought`, `tradeOffered {tradeId,
  fromId, toId, give, want, expiresAt}`, `tradeResolved {tradeId, fromId, toId, status: accepted|rejected|expired|
  cancelled, reason?, give?, want?}`, `gift {fromId, toId, charId (= fromId), money? | cardId + uid, family}`,
  `holidayStarted`, `holidayResult`, `lottoDraw`. Cut-in anchors: `cardBlocked itemBought holidayStarted holidayResult
  lottoDraw` + `cardUsed` only for sabotage / pledge (`isCutinCardUse`; also a follow-up boundary via `isBoundary`);
  cardGained / passive cardUsed are chips, gift / trade* banners. Line tags: card, card_use, sabotage, sabotaged, blocked,
  shop, shop_buy, holiday, holiday_sebae, holiday_nagging, gostop_win, gostop_lose, lotto_win, lotto_lose, gift,
  gift_send, trade (placeholders + `{target} {card} {item} {holiday}`). Scenes: shop/itemBought/lotto → shop, holiday* →
  holiday. MC situations (mc.json + lines.json pools): sabotage, blocked, shopping (minor), holiday (big, studio on
  holidayStarted), lotto (big, studio on lottoDraw), gift (minor); passive triggers stay quiet.
- Simulation (`scripts/simulate.js`, exports `playableCards`, `randomCardAction`; `simulateBias({cards = true})`): random
  card play 50 %, random enabled options, rare gifts / trade offers; prints the Stage 7 block (cards per character by
  source, hand vs auto, sabotage count / target net-worth rank / blocks, shop purchase rate, items, holiday pot + Σ won,
  sebae flow, lotto payout vs EV vs price, gifts, trade outcomes). Seed 11 × 300: lifetime 79.0 spins (Stage 6: 78.8),
  12.5 decisions per lifetime character (holiday 3.98 of them; own decisions 7.8), 1.15 cards gained / 0.58 played per
  character, 1.33 sabotages per game (4.8 % blocked; targets by net-worth rank 1st 16.8 % … 8th 2.4 %), shop purchase
  rate 69.8 %, 고스톱 Σ won = 0, lotto 6.5 paid per ticket (EV 8.93 < 20). `--bias --games 2000 --seed 1`: 1st-place
  share 11.3–13.7 %, first→last average rank spread −0.25.
- Tests: `test/stage7-import.test.js` (importer, watermark keying), `test/stage7-cards.test.js` (data, useCard rules, every
  card effect, spin mods, passive cards, hand limit, shop, items, ranking), `test/stage7-social.test.js` (trades incl.
  expiry / runner deadline / re-validation, gifts, holidays incl. pot conservation / ties / config, lotto EV + draws,
  presentation + MC, a random lifetime game, restore + migration, HTTP). `test/helpers.js` `makeRoom` sets
  `holidays: false` so pre-Stage-7 rule tests keep their flow; Stage 7 tests turn it on.
