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
- **Gemini API is OFF by the user's decision (billing).** Never set a key, never call the API or run `scripts/gen-assets.js` /
  `part-qa.js --fix`. New art comes from the user's hand-made Gemini-app images: `assets-inbox/<asset id>.png|webp` →
  `node scripts/import-assets.js` (prompts in `docs/asset-prompts.md`).
- Do not run git commands; the orchestrator commits.

## Layout (Stage 1)
- `server/index.js` — `createApp({store, runner, adminPassword, heartbeatMs, assets, log, rate, trustProxy})` /
  `startServer({port, dataDir, adminPassword, heartbeatMs, debounceMs, log, assets, rate, trustProxy, finishedRoomTtlMs,
  lobbyRoomTtlMs})` (post-simulation ops options: see "Post-simulation fixes (server)"; port 0 = ephemeral,
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
- `server/game/board.js` — `buildBoard(config, rng, data)` from `board.json` + `eras.json` (loop maps + the final race,
  see "Loop maps (원작식 순환 맵) — server"); nav helpers (`nextPosition` (wraps), `wrapsAt`, `lapPositions`, `tileAt`,
  `tileIdAt`, `findTile`, `eraPathLength` (= lap), `startPosition(eraIndex)`, `lapSize`, `paydayCount`, `passCount`).
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
  turnTimeoutSec` (`TURN_TIMEOUTS` 0 = off (default) | 30 | 60 | 90 | 120), `rouletteMode` random | skill (see "Roulette skill mode"). `minEraTurns(eraId, mode)`: route eras
  (young/middle_age) ≥ 3 ("청년 턴 수는 갈림길·합류 칸이 있어 3 이상이어야 합니다."), every other era ≥ `limits.minTurns` (1);
  checked on the merged config; the mode's final era (goal race) is skipped — `finalLength` (20–80, default 40, "노년 길이는
  20~80칸 사이의 정수여야 합니다.") is validated instead. `minTurnsTable()` → `/api/meta.minTurns` (final era → null).
- Player: `{id, sessionId, name, role: 'player'|'spectator', connected, lastSeen, ready, joinedAt}`. Spectators
  (`POST /api/rooms/join {code, name, spectator: true}`, `joinRoom(..., {spectator})`) may join lobby/playing/finished
  rooms (max `MAX_SPECTATORS` 20), do not count toward `MAX_PLAYERS` (4), cannot create characters / ready / spin /
  bet / choose (403 `spectatorFail()`), can send reactions and open SSE. A session keeps its first role. `viewFor`
  exposes `players[].role` and `me.role`; `adminSummary` has `spectators`.
- Character ids `c<seq>` and player ids `p<seq>` are per-room counters; `seq` = creation order.
- Playing room adds: `board {eras:[{id,name,turns,loop,lap,tiles[],routes?:{love|career|money:{tiles}},fork?,rejoin?} |
  {id,name,turns:null,loop:false,final:true,length,tiles[]}]}`, `eraIndex` (the shared era), `rngState`,
  `bets {[turnNo]: {[charId]: {kind,pick,amount,target,resolved,staked?,won?,delta?,refunded?}}}`, `promptSeq`, `result {ranking, forced}`,
  `pension {recipients[], decidedAt, turnNo} | null`.
- Side bets (`balance.bets`): `ranges {"1-3":[1,3], "4-6":[4,6], "7-10":[7,10]}`, `payouts` per pick (stake
  included) `{odd:2, even:2, "1-3":3, "4-6":3, "7-10":2.5}`; winnings `betWinDelta` = floor(amount × (payout − 1))
  → no pick has a positive expected value (tested for every stake). `/api/meta.balance.bets` carries both. The stake is
  HELD at bet time (see "Post-simulation fixes (server)").
- 기초연금 (`balance.pension`): recipients are decided ONCE at the transition into the pension era — bottom
  `bottomN` by total assets (`pensionWorth` = cash − debt + house + items; ≥ `minCharacters`) → `room.pension`; each
  recipient is paid at once (amount = base + asset gap to the richest × gapRatio, ≤ max). Never more than `bottomN`
  payouts.
- Goal race (final era only since the loop maps): `goalPrizes [60,50,45,40,35,30,25,20]`, `bonusSpinUnit` 2,
  `retirePrizeMult` 0.5 (조기 은퇴).
- Board: tile ids `${eraId}:${main|love|career|money}:${index}` are stable. Every era but the final one is a loop map
  (`tiles[0]` = start; route eras: fork `stop` + `merge` inside the ring, three equal route tracks); the final era is a
  linear goal race ending at `goal` — details in "Loop maps (원작식 순환 맵) — server" (there is no `fixedStops` / 수능
  tile any more).
- Character (in game): `money, debt, position {eraIndex, route:'main'|route, index (0 = the era start)}, era, route
  (the route of the current lap, null off-route), routeHistory[{era, route, completed}] (one per lap), laps, finished,
  place, goalBonus, retired?, pensionGiven, chanceBuff, club`.
- Turn: `{order, currentIndex, phase: awaitSpin|resolveSpace|awaitDecision|endTurn|gameOver, pending, turnNo, round,
  eraRound, eraTurns, move, spun, lastSpin, spinDeadlineAt}` (`eraRound`/`eraTurns` null in the final race; `move` =
  a paused move; `spun` / `announce` are internal). `pending = {promptId, kind, charId, title, text, forCharacterIds[], options[],
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
- Hooks: every tile type has a handler since Stage 9 (`board.json.placeholders` is `{}`; `resolveTile`'s default branch
  stays for future types); add new tiles as handlers + `PROMPTS` entries.
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
- 호야 (`hoya`, boy, the OLDER brother, 리액션, goofy 반말 "~멍!") & 봄이 (`bomi`, girl, his YOUNGER sister, 진행, chic deadpan
  짧은 존댓말 "…그렇습니다"/"흥", teases her brother) — the user's Shih Tzus. 호야 calls her 봄이 / 봄이야 / 동생; 봄이 calls him
  오빠 / 호야 오빠 (never 누나 / 형 / 언니 / 호야 씨 — `test/mc.test.js` checks it). mc.json profiles carry `gender` + `relation`;
  gen-mc-manifest `DOG_DESC` says "a boy … the older brother" / "a girl … the younger sister". Photos live
  ONLY in `DATA_DIR/mc-refs/` (gitignored); never copy them into `public/` or tracked paths.
- Data: `server/data/mc.json` (`getMc()`, in `gameData().mc`): `order`, `expressions` (neutral joy surprise sad angry proud
  sleepy), `poses` (idle wave clap mic), `profiles.<id>` {name, role, personality, speech, looks, colors}, `bigAmount`,
  `frequency.<many|normal|few|off>` {label, medium, minor (chances), cooldown, duoChance}, `situations.<key>` {weight
  big|medium|minor, lead hoya|bomi|any, duo true|false|'chance', vars[], hoya/bomi: {expression, pose}}, `eraSituations`,
  `tileSituations` (tile type → situation; `{}`: treasure is still a placeholder tile, heart/house map real outcomes (Stage 8), and any tile type listed in
  `board.json.placeholders` is skipped anyway — a test guards that placeholders never produce marriage/treasure MC lines;
  Stage 6 maps job outcomes (`jobChanged` hire → job, `rankUp` → promotion …) instead of the job tile). Pools: `lines.json` `mc.<key>.{hoya,bomi}` = string | {t, e?, p?},
  `mc.<key>.duo` = 2–3 line dialogues [{s, t, e?, p?}] (both MCs). Tests: ≥6 per speaker + ≥6 duos per situation,
  ≤48 chars, placeholders ⊂ situation `vars`, every 호야 line has 멍. `birth` = Stage 8 `childBorn`.
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
  (`meta.minTurns[mode][era]`, else client mirror), CPU checkbox removed (back in Stage 9-C as 「CPU 허용」), 390 px layout.
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
- Board (tile pools superseded by "Loop maps" below: `salary` is now the forced-stop 월급날, placed by `placePaydays`, never in a
  pool): new tile types `habit` (kids eras), `salary`, `job` (career route, main pools of the loop eras); `board.json.placeholders` no longer has `job`. tones.json `cutinTiles` + habit,
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
  전역 (turnsLeft 0) → 졸업 (`educationChanged`, int +1) → 진로 prompt (lifetime; since the loop maps it comes BEFORE the spin via `preSpinStep`, see "Loop maps") → 군 복무 decision →
  job offer (`jobOffer`, or 알바 at once when nothing is eligible) → automatic 입대 (mandatory body, not enrolled) →
  `routeChoice` (only when the character stands on its era's fork stop; the stop tile itself never opens it) → hidden-job unlocks (`hiddenJobUnlocked` +
  `hiddenJobOffer`). Loop guard 64. `endTurn` skips characters with `skipTurns` (재수) with a log line.
- Rules: habit prompt (4 options, stat +gain (+1 at `bonusChance`), money cost/roll × era scale × news). 수능: `r = rng.next()`
  vs `examChances` (base + int×지력 + luck×운 + news `examBonus` (+ `retakeBonus`)), the better result is kept. 진로: college
  (tuition as debt, `collegeTurns` of school, then graduation → job offer), 바로 취업, 재수 (not for elite, once: skip
  `retakeSkipTurns`, retake exam → a pass enrolls, a fail goes to work — no second 진로 prompt). 군: mandatory bodies
  (`boy`) — enrolled → prompt 지금/졸업 후 (once), otherwise automatic after hiring (job kept); volunteers (`girl`) with str ≥
  `volunteerMinStr` → prompt; else exempt. Serving: spins move `ceil(value/2)` (`spun.steps`, `halved: true`), military pay
  `military.pay` per spin and on salary tiles (0 since the post-simulation fixes → no pay, a log line on salary tiles), str
  +`strGain` (1) at 전역; school is paused. Jobs: `eligibleJobs` = requirements + news
  (`jobRequireDelta`, `jobDelta`) + education; offers weighted by `offerWeight` (1 + 0.5×(Σreq−3) + 1.5 with a degree), no
  hidden jobs. Salary tile: `ranks[rank-1].salary × salaryEraMult × news salaryMult (× partTimeMult) × (injured ? 0.5)`,
  jobless students = 알바 pay; exp +1 → passive rank-up at `expNeeded`. Rank-up chance = base + perStat×stat +
  luckBonus×luck + educationBonus (+ examBonus on a promotion exam) + news `rankUpBonus`, clamped; success → `rankUp` + the
  job's stat +1; injury blocks. Job tile: `jobTile` prompt 승진 시험 (or 성과급 at max rank) / 전직 (one eligible candidate,
  `option.jobId`) / 야근 (`overtime.salaryShare` 50 % salary, exp `overtime.exp` 0, str −1); students / soldiers only look around; a pending unlocked hidden job
  is offered instead. Injury: `injuryRisk × news injuryMult` after salary / promotion exams → `injured` = 2 turns (+ the 🤕 status card; 🧿 건강기원 부적 blocks it)
  (decremented per spin). Hidden unlocks (data `unlock`, all must hold, job eras only; values since the post-simulation
  fixes): 우주비행사 int 8 & str 8; 국민 MC max rank of 개그맨/배우/유튜버 (now or history) & charm 8; 재벌 총수 max 대기업 &
  net worth ≥ 3,000; 트로트 스타 senior & charm 7 & luck 7; 산신령 (Stage 9) 사찰 소원 성취 `wishes` ≥ 2; 건물주 (Stage 8)
  houseSwaps ≥ 3 or penthouse / jeju_villa (loop-map values: 우주비행사 9/9, 국민 MC charm 9, 재벌 총수 net worth ≥ 2,000, 트로트
  스타 charm 9 & luck 9, 산신령 wishes ≥ 8 (찬스 광장 소원 count too), 건물주 houseSwaps ≥ 4). News: every era transition (loop maps: `eraTransition`, not a first entrant; adult mode draws 청년 at start) → `room.news[era]`, `newsFlash`
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
  almost no / almost all transparency, 워터마크 제거 (x,y) | 없음). Unknown id / kind part / sprite → skipped, exit 1. The
  studio gets a client that refuses API calls. `watermark: true` (upload option, set by the importer): first
  `server/assets/watermark.js` `removeWatermarkDetailed` un-blends the Gemini-app sparkle ✦ (white alpha overlay:
  obs = orig·(1−a) + 255a → orig = (obs − 255a)/(1 − a), a ≥ 0.9 inpainted). Alpha template = tracked
  `server/assets/watermark-alpha.png` (64×64, a×255, max a ≈ 0.31, averaged from 16 flat-magenta 1024² originals);
  placement `WATERMARK_RULE`: s = √(w·h)/1024, centre (w − 120.5·s, h − 120.5·s) (checked at 1024², 1024×687, 1024×572).
  Search ±6 px then sub-pixel × ±6 % scale; matched filter on luminance gradients (line-art pixels skipped), accepted
  when gain k ∈ [0.65, 2.5] and every arm ≥ 0.25 (real marks k 1.0–1.2, clean images ≤ 0.25) → otherwise a no-op; the
  result carries `watermarkRemoved`. `cleanEdgeBand` then removes the compression ring on the outline: band = dilate −
  erode of a > 0.08 (≈ 2 px at source scale); reference = median luma/chroma of nearby non-band pixels; band pixels
  take the reference luma when ≤ 12 off or when a lone 1–2 px speck, reference chroma when ≤ 24 off; inside only lone
  specks; pixels on a line crossing the ring (`crossesBand`: same deviation outside the band on both sides) are kept
  (`edgeCleanup: false` disables). Then bg/anchor are flattened (cover resize, the old 4 % crop is gone); keyed kinds
  keep the 3-corner backdrop sample + `clearCornerIslands` safety net (defaults unchanged for other callers).
  `addWatermark` stamps a synthetic mark (tests).
- Manifest kinds `card` (meta.card = cards.json id) and `item` (meta.item) — icon pipeline (`whiteToAlpha, trim,
  resize:256x256` → png). New ids (status todo): `bg-stage bg-stadium bg-gym bg-army bg-campus bg-kitchen bg-police bg-lab
  bg-space bg-shop bg-holiday` (meta.scene), `card-<id with _→->` ×16 (+14 blue / red cards, see below; `cards/<…>.png`), `item-<…>` ×6 (`items/<…>.png`),
  `icon-job-<…>` ×23 (`icons/jobs/<…>.png`, meta.job). Scenes: presentation `SCENES` + tones.json `scenes` have the 11 new
  scenes; `tones.json.sceneFallbacks` maps each to one of the 5 original scenes (the client draws the fallback until the bg
  is accepted; a test enforces that). jobs.json scenes: stage (idol actor comedian esports trot_star national_mc),
  stadium (baseball soccer), gym (fighter), kitchen (chef), police, lab (researcher), space (astronaut); tagScenes
  military/military_end → army, graduation → campus (educationChanged scene campus).
- Data: `cards.json` `{handLimit (5 → 6, see "Blue / red cards — server"), eraScale, cards[{id, name, icon, color, kind instant|passive|sabotage
  (+ held|merit|status), desc, price, weight, jobOnly?, hold?, effect}]}` (16 Stage 7 ids + 14 blue / red), `items.json` `{items[{id, name, icon, desc, price, resale, stats?, effect}]}` (6),
  `holidays.json` (eras, kinds seol/chuseok, names/icons, sebae ranges per era, nagging, stakes × stakeScale, hwatu 1..10),
  `balance.json` `lotto {pool 20, pick 3, prizes {3:1000, 2:100, 1:10}, keepDraws}`, `shop {cards 2, items 1}`, `trades
  {ttlMs 60000, maxMoney}`; `gameData().cards/items/holidays` (`getCards/getItems/getHolidays`); `/api/meta` adds `cards`,
  `items`, `holidays`, `balance.lotto|shop|trades`. events.json: `card` reward on 6 events. Board: card tiles in the kids
  eras, the loop eras' main pools and every route; `shop` tiles are gone since the loop maps (the 찬스 광장 「🛍️ 쇼핑」 option opens
  the same `shop` prompt with its own `offers`).
- Modules: `server/game/cards.js` (hands, passive helpers, spin mods, `useCard`, card tile, `shop` prompt, trades, gifts),
  `server/game/holidays.js` (era openings, lotto, `holiday` prompt). `assertOwner` moved to effects.js.
- Character (public): `cards [{uid, id}]` (uid `k<seq>` from `room.nextCardSeq`; hand limit → a card is discarded (blue / red discard order) with
  a log, `cardGained.discarded`), `items [itemId]` (one each), `spinMods [{kind: plus|minus|max2|min2, value?, by?, card}]`
  (applied + cleared at the next spin), `lastTargetedBy {attackerId: round}`. Room: `nextCardSeq`, `nextTradeSeq`,
  `trades [{id 't<seq>', fromId, toId, give, want, createdAt, expiresAt}]` (sides `{money}` | `{cardUid, cardId}`),
  `holidayCount`, `holidays {eraId: seol|chuseok}`, `lotto {draws [{eraId, numbers, entries, at}]}`, `erasOpened [eraId]`,
  `eraQueue`; config `holidays` (bool, default true, validated "명절 대잔치 값은 true/false여야 합니다."). `turn.cardUsed`.
  `viewFor` adds `trades`, `holidays`, `lotto` (hands/items/trades are open information; nothing new is masked).
  `ensureCards` / `ensureRoomCards` migrate older saves (eras already reached count as opened).
- Actions (`POST /api/rooms/:id/actions`, spectators 403, owner via actor): `useCard {characterId, cardUid, targetId?}` —
  current character, awaitSpin without a prompt, 1 per turn, passive / blue / status → 409, `jobOnly` (pledge = politician) → 409, sabotage
  needs another unfinished target (400 missing/self, 409 finished) not sabotaged by you this or last round
  (`lastTargetedBy[you] ≥ round − 1` → 409); target's `lawyer` blocks it (both consumed → `cardBlocked`, no `cardUsed`).
  `offerTrade {characterId, toId, give, want}` (one side = exactly one of money (int > 0) | cardUid; not money↔money; own
  characters / finished refused (CPU targets allowed since Stage 9-C); one open offer per character; give cash / both cards checked), `respondTrade
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
- Era openings: every `eraTransition` (loop maps; was: the first entrant of an era) queues it (`queueEraOpening`, after
  news/pension); `continueTurn` runs `runEraOpenings` whenever no prompt is open, before the current character's
  `lifeStep`: ① lotto draw (holders of a `lotto` card use one each; 3 seeded numbers of 1..20 each, 3 drawn → `lottoDraw
  {eraId, numbers, entries [{charId, numbers, matches, prize}]}` + moneyChanged `lotto`; skipped without tickets; exact EV
  `lottoExpectedValue` 8.93 < price 20) ② holiday (holidays.json `eras`: middle / middle_age since the post-simulation fixes, config on, once per era,
  seol/chuseok alternate by `holidayCount`) → `holidayStarted {eraId, kind, name}` + ONE simultaneous prompt `holiday`
  (all unfinished characters, 40 s, options `pass` (default) | `small` | `big` with `stake` = stakes × stakeScale[era]).
  Resolution → `holidayResult {eraId, kind, name, results [{charId, sebae, nagging {stat, delta, line}, stake, card, won,
  line, lineTag}], pot, winners}` then moneyChanged (`sebae`, `gostop`) / statChanged (`nagging`): ① 세뱃돈 roulette
  (kids eras +, adult eras − never into debt) ② 잔소리 (random stat ±1) ③ 고스톱: stakers (stake ≤ cash, ≥ 2 of them) draw
  1..10; each loser pays min(own stake, top winner stake), tied winners split (floor, remainder to the first) → Σ won = 0.
- Events (all in `EVENT_TYPES`): `cardGained {charId, cardId, uid, source: tile|shop|event|trade|gift (+ club|graduation|job|status|start), color, discarded?, from?}`,
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
- Tests: `test/stage7-import.test.js` (importer, watermark keying, synthetic sparkle removal + no-op, edge-ring cleanup keeps lines), `test/stage7-cards.test.js` (data, useCard rules, every
  card effect, spin mods, passive cards, hand limit, shop, items, ranking), `test/stage7-social.test.js` (trades incl.
  expiry / runner deadline / re-validation, gifts, holidays incl. pot conservation / ties / config, lotto EV + draws,
  presentation + MC, a random lifetime game, restore + migration, HTTP). `test/helpers.js` `makeRoom` sets
  `holidays: false` so pre-Stage-7 rule tests keep their flow; Stage 7 tests turn it on.

## Stage 7 — client (cards, items, interaction)
- Pure `public/js/shared/cards.js` (no imports; `test/client-cards.test.js`): `cardDefs/cardInfo/itemInfo` (`/api/meta.cards|items`,
  contract fallback names `DEFAULT_CARDS/DEFAULT_ITEMS`), `CARD_KINDS` (instant blue / passive green / sabotage red), `handOf`,
  `itemsOf`, `cardPlayability(room, char, card, {meta, spectator})` → `{playable, reason, needsTarget}` (mine, its turn,
  awaitSpin without prompt, `!turn.cardUsed`, not passive, `jobOnly` = current job, a sabotage needs a valid target),
  `sabotageTargets` (other unfinished characters; invalid when `target.lastTargetedBy[attacker] >= round − 1`),
  `validateTrade` / `validateGift` (mirror the server: no trades between own characters, both sides exactly one of money /
  card, not money↔money, cash checked on both sides, cards still in hand, one open offer per character; gifts to own
  characters OK) → `{ok, error, body}` (= the action), `openTrades/tradeLists/openTradeOf` (expiry by server clock),
  `tradeSideText`, `TRADE_STATUS`, `spinModBadges` (⚡+2 / ✂️−3 / 🚕×2 / 📢×2↓), `spinNote(spun)` (what cards / 경차 did
  to a roulette: "🚕 3·8 → 8칸" — spin hint, 2D float, 3D pop; military halving keeps its 🪖 note), `handLayout`, `handFull`, `holidayRows`
  (세뱃돈 / 잔소리 stat + line / 고스톱 stake·card·net, `event.winners`), `lottoRows`, `holidayTitle`.
- `public/js/ui/cardArt.js` (string builders, node-tested): `cardHtml` (SVG frame per kind + art `findAsset({kind:'card', card})`
  or emoji + name, 「자동」 tag for passive), `itemIconHtml` (`{kind:'item', item}` or emoji), `hwatuSvg(n)` / `hwatuFlipHtml`
  (화투 1..10 + red back, CSS 3D flip), `lottoBallHtml`, `shopOptionsHtml(p, who, {meta, artFor, btnClass})` (product cards:
  art, kind tag, def desc, price, `basePrice` strike + 🎟️ 쿠폰 할인, disabled → 「돈이 부족해요」; `data-choose` like every option).
- game2d: **hand row** `data-el="hand"` at the top of the spin dock (my current character, else my chosen / first one,
  tabs when I own several; playable cards glow, others dimmed with the reason in the title; ≥ 700 px the hand sits beside
  the spin button, phones shrink it while the dock is sticky; re-rendered only when its markup changes). Tap → **card
  sheet** `data-el="cardsheet"` (desc, kind, jobOnly, sabotage target picker with portraits / reasons, 「사용」 →
  `useCard {characterId, cardUid, targetId?}`). Side rows: spinMods badges, 🃏 hand count, item icons; detail card: hand
  (public), items, next-roulette mods, 「🤝 거래 제안」 (others' characters) / 「🎁 선물」 (any other character when I own one
  that can send) → **trade dialog** `data-el="tradedlg"` (sender select, 💰 money input / 🃏 card chips per side, live
  validation, full-hand note; re-rendered when a card of either hand moves). **Inbox** `data-el="inbox"` (fixed under the top bar, z 24 = over cut-ins): incoming offers
  for my characters with 수락/거절 + ⏳ countdown (`expiresAt`, server clock), my open offers with 취소; the compact
  banner moves below it (`body.has-inbox`, `--inbox-h`). `tradeOffered` → toast for the receiver (not a board event).
  Spectators: no hand / inbox / trade buttons. 409s go through `run()` (silent resync).
- Cut-ins (`cutinMap` / `cutinPolicy` / `cutin2d`): anchors `STAGE7_ANCHORS` (cardBlocked itemBought holidayStarted
  holidayResult lottoDraw) + `cardUsed` when `isCardAnchor` (sabotage / `targetId` / 공약, never `auto`); `cardGained`, plain
  `cardUsed`, `gift` are follow-up chips (`g.cards`, `g.gifts`); lone cardGained / gift / tradeResolved / plain cardUsed →
  own groups → banners (`BANNER_TYPES`, `isBannerGroup`). `g.targetId` (sabotage target / gift & trade receiver) → cast
  (attacker cheer + target shock 💢 + the target's `targetLine` in the text; block: defender cheer 🛡️, attacker sweat), `isOwnGroup` counts a target of mine →
  sabotage on me is full in compact. Big: holidayStarted/Result, lottoDraw; minor tiles + card, shop. `classifyGroup` →
  `'defer'` for lottoDraw / holidayResult while my prompt is open (game2d `ui.deferred`, flushed on render). Tags 💢 뒤통수
  카드 / 🗳️ 공약 카드 / 🛡️ 방어 성공 / 🛍️ 쇼핑 / 🧧 설날·🌕 추석 대잔치·정산 / 🎱 전국 로또 / 🃏 카드 획득 / 🎁 선물 / 🤝 거래.
  cutin2d `stage7Look` (tone/scene/pose defaults), card / item badges (art image when accepted; card badges bottom-centre),
  holidayResult = 화투 flip row in the window + result table in `.ci-extra` (세뱃돈, 잔소리 chip + quote, 판돈 / net, winner
  outlined; generic money / stat chips suppressed), lottoDraw = `lottoSpec` (studio with the MCs when the group has
  `studio`/`mc` lines, else kind `lotto`): balls drop one by one, entries with hit balls + prize chips; holiday prompt =
  3 face-down 화투 + stake icons (🙅/🪙/💰 fallback); shop prompt = product cards (also in the 2D modal). Prompts of kind
  shop / holiday default to scene shop / holiday. Job badges use `findAsset({kind:'icon', job})` when accepted (cut-in
  badge, side rows, result).
- Scene fallbacks: `cutinMap.resolveSceneBg(scene, {presentation, assetUrl, findBg})` → own bg > `sceneFallbacks` chain's bg
  (`DEFAULT_SCENE_FALLBACKS` when the server has none) > SVG of the first drawable scene (`SVG_SCENES`; new SVG scenes
  `shop` 「인생 마트」 and `holiday` 병풍 상차림). `.ci-bg[data-bg-scene]` tells which one was used. The studio draws the CSS
  desk only without a generated `bg-studio` (with art: a soft floor shadow).
- 3D: animator `ANIMATED_EVENTS` + the Stage 7 types; board3d pops 🃏 (cardGained) 🛍️ (itemBought) 🎁 (gift, over the
  receiver) 💢 (sabotage target) 🛡️ (block) 🤝 (trade) 🎱 (lotto winners) 🎴 (gostop winners), 설날/추석 banner;
  `c.tagBadge` (spinMods) is appended to the pawn name tag (`tagName`); `DEFAULT_TILE_GLYPH` card 🃏 / shop 🛍️.
- Result rows: item icons (+ names ≥ 431 px) and 「아이템 N만원」 (ranking `items`). Admin: 「명절 대잔치」 checkbox
  (`holidays`, sent only when off) + room detail. 390 px: the top bar stays one line (spectator badge → title drops to 🎲),
  the game header's era · turn · 📰 line never wraps. CSS in `public/css/cards.css`.
- E2E: session scratchpad `s7b/` (`inject.cjs` injected state/events, `game.cjs` natural 4-client game + 390 spectator on the
  real server; screenshots `s7b-*.png`).

## Stage 8 — romance, family, real estate (server)
- Data (`loadData` / `gameData().partners|houses|avatars`, `/api/meta.partners|houses`): `server/data/partners.json` — `traits`
  (int 지력형 / str 체력형 / charm 매력형 / luck 운형 `{name, icon, desc, weight}`), `stars` 1..4 `{salary, allowanceMult, weight}`
  (30/45/65/85 만원 per payday since the loop maps; 고교 전원 만남 is always ★1), `names.boy|girl` (24 each), `meetEras`, `affection {meet 30,
  dateGain, matchBonus 8, proposeAt 60, max 100, failDrop 15, steadyGain 10, familyGain 10, eraGain 5, loveRoute 30}`, `propose {base 0.45, perAffection, charm,
  luck, match, min, max, eras}`, `dates[]` (walk 5 / library int 12 / hiking str 12 / concert charm 16 / amusement luck 16: `{cost, gain}`), `costs
  {scale per era, wedding, weddingGift, birth}`, `birth {eras young/middle_age, base 0.6, perAffection, perChild, max, perSpin 0.15}`, `children {max 4,
  genius {base, match, luck}, growTurns 1, dolGift, schoolCost, examGift (genius 60 / college 20), allowance 50, talentMult, allowanceOnEra?}`, `outings[]`, `avatar` (hair /
  outfit (boy / girl / child) / colour pools, `traitAccessory`). `server/data/houses.json` — 6 fixed ids `oneroom villa apartment
  hanok penthouse jeju_villa` `{name, icon, price, value (= price × 1.05; jeju 1500 → 2000), capacity 1 | null (apartment), eras, lucky? (jeju), desc}`, `listings` 3,
  `tradeIn` 0.7, `subscription {houseId apartment, chance, discount}`, `luckyChance {money, other, perLuck}`, `market {era senior,
  min 0.8, max 1.3}`. news.json: `housing_boom` (young/middle_age ×1.3), new `housing_slump` (middle_age/senior ×0.8) and
  `redevelopment` (senior ×1.2) = `housePriceMult`; `birth_bonus.birthBonus` 300 = 출산장려금. Board: `heart` love route 7 (career /
  money 1, high 1, senior 1), `house` money route 6, senior 6, love / career 2; heart / house left `placeholders` (only treasure remains).
  manifest: `bg-park` / `bg-house` (todo; scenes `park` → mountain-trail, `house` → office in `sceneFallbacks`).
- Modules: `server/game/family.js` (init / `ensureFamily` / `ensureRoomFamily`, `topStats` / `traitMatch` (찰떡궁합 = partner trait
  is one of my best stats), `makePartner` / `randomLook` (seeded, sanitized full avatars; children inherit a parent's skin / hair
  colour), `schoolMeet`, `resolveHeartTile`, `blindDate`, `loveRouteChosen`, `proposeStep`, `proposeChance`, `birthChance`, `bearChild`, `growChildrenOnEra|OnSpin`,
  `allowanceAmount` / `payAllowances`, `spouseSalary`; prompts meet / date / propose) and `server/game/houses.js` (`houseOwners` /
  `syncHouseOwners`, `houseAvailable`, `priceMult`, `tradeInValue`, `houseListings`, `resolveHouseTile`, `buyHouse`,
  `drawHousingMarket`; prompt house). spaces.js: `heart` / `house` tile cases; routeChoice `love` → `loveRouteChosen`; growth.js `lifeStep` ends with
  `proposeStep`.
- Character (public): `love {candidates [partnerSpec] (the open 만남 prompt's people, else []), partner, affection, dates}`,
  partnerSpec = `{id 'pt<n>', name, trait, stars, body (opposite of the character), avatar}`; `spouse` = partnerSpec + `{salary,
  marriedTurn}` | null; `children [{id 'ch<n>', name, trait, talent genius|normal, stage baby|kid|teen|adult, bornTurn, avatar, body,
  growth 0..4, turns}]` (max 4); `house {id, price, value, boughtTurn}` | null; `houseSwaps`. Room: `nextPartnerSeq`,
  `nextChildSeq`, `schoolMeetDone`, `houseOwners {houseId: [charId]}` (kept in sync), `housingMarket {eraId, mult}` | null — the last
  two in `viewFor`. Older saves migrate in `applyAction` (a save already past 고등학생 never gets a late 전원 만남).
- Rules: 고교 첫 만남 (loop maps, ADDENDUM A3): at each character's FIRST high-school turn (`preSpinStep`) a single character gets a
  `meet` prompt with ★1 school candidates (`context.school`, `met {school: true}`, `c.schoolMet`); once everyone had theirs (or on
  leaving `high`) ONE recap `schoolMeet {eraId: 'high', pairs [{charId, partner}], summary: true}` (`room.schoolMeetPairs`). (Was: the
  first entrant of `high` gave every single a ★1 partner without a prompt.) Heart tile: single →
  `meet` prompt (meetEras: high+, earlier eras only a log); partner → `date` prompt, or `propose` when affection ≥ proposeAt in a
  propose era (young+; a date that reaches it opens the propose prompt at once); married → birth roll (`birthChance`, birth eras,
  < 4 children) else a family outing (outings money × scale, stats, affection + familyGain). Love route (`loveRouteChosen`): single →
  소개팅 = a partner at once (`met {blindDate: true}`, no prompt); dating → affection + `loveRoute`. Era entries (every `eraTransition`) add `eraGain` to a
  dating couple. Epilogue proposal (`proposeStep`, end of `lifeStep`): a dating couple at ≥ proposeAt in a propose era gets ONE
  `propose` prompt per era (`love.askedEra`, set by every propose prompt; heart tiles may still ask again). Proposal: `proposeChance` = base + (affection − proposeAt) ×
  perAffection + charm × 매력 + luck × 운 (+ match), clamped → success = wedding, fail = affection − failDrop. Wedding: spouse (salary = ★
  salary), 축의금 `weddingGift × scale` from EVERY other character capped at their cash (moneyChanged `weddingGift` pairs → Σ
  conserved) − wedding cost (capped at cash). Salary tiles: `salary.spouseAmount` = ★ salary × salaryEraMult × news salaryMult →
  moneyChanged `spouseSalary`; employed children send 용돈 (`allowance` + moneyChanged `allowance`) = allowance × talentMult ×
  spouse ★ allowanceMult × salaryEraMult — also paid at every era entry of the parent (before the children's growth step). Birth (`bearChild`): genius = base + match (spouse trait is my best stat) + luck ×
  genius.luck; trait = spouse's (50 %) or my best stat; moneyChanged `birth` (cost) + `birthBonus` (news). A married parent also
  rolls a birth at every era entry and `birthChance × birth.perSpin` on every spin. Growth steps (`GROWTH_STEPS`): each era entry of the parent + every `growTurns` parent spins
  (no double step on an era-entry spin) → dol (stage kid; 돌잔치 gifts `dolGift × scale` from every other character, capped) →
  school (teen; cost `school`) → exam (teen; genius → elite 축하금, normal → college (chance) small 축하금 / fail) → job (adult;
  용돈 from then on). House tile (job eras): `houseListings` = `listings` distinct available houses of the era (capacity: holders
  other than me; my own house never), seeded; lucky roll (money route `luckyChance.money`, else `.other`, + luck × perLuck) swaps the
  last pick for 제주 별장; 청약 roll discounts the apartment's price (value unchanged); prices / values × `priceMult` (the drawn market
  in its era, else news housePriceMult). Buy = cash only (price − trade-in ≤ cash, else `disabled`), trade-in = value × 0.7 →
  `houseSwaps` +1, one net moneyChanged `house`. Resolve re-checks capacity / cash (→ promptResolved `noMoney`). 노년 시세: the
  transition into senior draws `int(80..150)/100 × senior news housePriceMult`, clamped → every house value × mult →
  `houseValueChanged {eraId, mult, changes [{charId, houseId, before, after}], reason: 'market'}`. Ranking: `house` = value, total =
  money − debt + items + house. 건물주 unlock (jobs.json `unlock.anyOf`): `houseSwaps ≥ 3` or owning penthouse / jeju_villa
  (`unlockMet` also knows `houseSwaps`, `house`, `anyOf`).
- Prompts (CPU-readable fields; defaults): `meet` options `meet:<partnerId>` ×2 `{partnerId, partner (full spec), trait, stars,
  salary, match}` + `pass` (default = 찰떡궁합 / higher ★ candidate; context.candidates), resultCutin 'auto' (`met` anchors, pass →
  promptResolved `{result: 'pass'}`); `date` options `date:<walk|library|hiking|concert|amusement>` `{dateId, trait, cost, price,
  gain, match, disabled?}` (default = matched affordable date, else cheapest), resultCutin true → `promptResolved {result: 'dated',
  dateId, gain, affection, propose}`; `propose` options `propose {chance, partnerId}` (default) / `steady {chance: 0}`; `house`
  options `buy:<houseId> {houseId, price, basePrice, value, tradeIn, cost (net cash), subscription, lucky, capacity, disabled?}` +
  `pass` (default), resultCutin 'auto' (`houseBought` anchors; pass / noMoney → promptResolved).
- Events (all in `EVENT_TYPES`): `met {charId, partner, affection, match, blindDate?}`, `dated {charId, partnerId, partner, dateId,
  trait, cost, gain, affection, match}` (chip; `steady` = 조금 더 사귀기), `proposed {charId, partnerId, partner, success, chance}`,
  `married {charId, spouse, gifts [{fromId, amount}], total, cost}`, `schoolMeet {eraId, pairs [{charId, partner, line, lineTag}]}`,
  `childBorn {charId, child, spouse}`, `childGrew {charId, childId, stage, kind dol|school|exam|job, amount, child, gifts? (dol),
  result? (exam elite|college|fail)}`, `allowance {charId, childId, amount}` (chip), `houseBought {charId, houseId, price, basePrice,
  value, tradeIn, subscription, lucky, swap, fromHouseId}`, `houseSold {charId, houseId, value, amount}` (chip, right after
  houseBought), `houseValueChanged` (rows carry `line` / `lineTag`). `salary.spouseAmount`. moneyChanged reasons: date, wedding,
  weddingGift, birth, birthBonus, family, dolGift, school, childExam, spouseSalary, allowance, house. Anchors (`CUTIN_TYPES` +
  prompts.js `ANCHOR_TYPES`): met proposed married schoolMeet childBorn houseBought houseValueChanged + childGrew dol/exam/job
  (`isCutinChildGrew`, also a boundary via `isBoundary`); a heart / house landing followed by met / proposed / married / childBorn
  / houseBought of the same character has `cutin: false` (the outcome takes the stage). Avatars ride on met.partner /
  dated.partner / proposed.partner / married.spouse / childBorn.child + spouse / childGrew.child / schoolMeet.pairs[].partner.
  Presentation: tags meet, school_meet, date, propose, propose_ok, propose_fail, wedding, birth, dol, child_school, child_exam,
  child_exam_fail, child_job, allowance, house_buy, house_sell, market_up, market_down (+ `heart` / `house` for prompts); new
  placeholders `{partner} {child} {house}`; scenes park (meet / date / propose), wedding-hall (wedding, dol), hospital (birth),
  school (schoolMeet, child school / exam), office (child job), house (houses / market). MC situations: marriage (married, big),
  proposeFail (medium), birth (childBorn, big), house (houseBought, medium), market (houseValueChanged, big, studio), schoolMeet
  (medium); `tileSituations` stays `{}` (never on a heart / house TILE landing).
- Tuning (lifetime mode, seed 11 × 300 `random | --family default | --policy cpu`): married 53.6 / 69.5 / 50.7 % (love-route takers
  79 / 97 / 99 %), children per married 1.16 / 1.42 / 1.31, genius 25 / 25 / 27 %, 용돈 = 4.3 / 4.0 / 4.4 % of parents' income,
  spouse salary = 6.0 / 5.9 / 5.6 % of married characters' income, house at the end 26 / 28 / 36 %; route net worth ±7 % (random /
  default; the CPU policy's ±55 % is route SELECTION: rich CPUs pick the money route); lifetime spins 79.0–79.5, 14.4–14.8
  decisions per lifetime character; bias 2000 × seed 1: 11.5–13.5 %, spread −0.01. The simulate.js Stage 8 block prints a
  `[인생 전체 …명]` line with these. First version (below) for reference.
- Simulation (`scripts/simulate.js` Stage 8 block; `--family default` answers 만남 / 데이트 / 프러포즈 with the prompt default):
  seed 11 × 300 random: lifetime 79.4 spins (Stage 7: 79.0), 13.8 decisions per lifetime character (date 0.65, propose 0.48,
  house 0.24), married 14.7 % (young love route 24 % vs career 12 % / money 10 %); `--family default`: married 27.4 % (love route
  45 %), 0.21 children per character (genius 27 %), love-route net worth within −5..−6 % of the mean (young 1476 vs 1519 / 1647,
  middle_age 1459 vs 1618 / 1575; random policy: young 1506 vs 1495 / 1680, middle_age 1541 vs 1640 / 1514); houses bought on
  37 % of house prompts, 7.5 % own one at the end, 노년 시세 mean ×1.13–1.15. `--bias --games 2000 --seed 1`: 1st-place share
  11.3–13.5 %, first→last average rank spread −0.12.
- Tests: `test/stage8-family.test.js` (data, init / view, schoolMeet once, meet / date / propose seeded success & fail, 축의금
  conservation, spouse salary, birth + max 4 + 출산장려금, child steps + allowance, engine era-entry growth + birth, presentation /
  MC, random lifetime games, restore mid-proposal + pre-Stage-8 migration), `test/stage8-houses.test.js` (houses.json, listings
  capacity / own house / 청약 / lucky jeju / news prices, buy / swap / trade-in / cash / race, market once + news + clamp + engine,
  ranking, 건물주 via swaps / penthouse, HTTP meta + choose).

## Stage 8 — client (romance, family, real estate)
- Pure `public/js/shared/family.js` (imports only `growth.js`; `test/client-family.test.js`): `DEFAULT_TRAITS` / `DEFAULT_HOUSES`
  (contract fallbacks; `/api/meta.partners.traits` / `.houses.houses` win), `HOUSE_IDS` (oneroom villa apartment hanok penthouse
  jeju_villa), `CHILD_STAGES` (baby 0.5 / kid 0.64 / teen 0.78 / adult 0.9 cut-in scale + label + icon), `traitInfo`, `starsText`
  (★★☆☆), `partnerInfo`, `npcCharacter(spec, {prefix, avatar})` (partner / child as a portrait / cut-in "character" `{id:
  '<prefix>:<id>', name, avatar, art: null, npc: true}`), `affectionInfo(love, meta)` (❤️ bar to `affection.proposeAt`), `childInfo`,
  `childLook(child, {stage, avatars})` (stage costume from the era-outfit table: baby → dino, kid → tracksuit, teen → uniform/sailor,
  adult = own), `houseInfo` (capacity null → 0 = many owners), `houseOf`, `houseOwners` (`room.houseOwners` else derived),
  `marketInfo(room.housingMarket | event)`, `familyOf`, `familyIcons` (💕 / 💍 + 👶🧒🧑‍🎓🧑‍💼 + 🌟), `familySummary`, `familyCast(group,
  characters, {avatars})` (met/dated/proposed → partner, married → spouse 💍, childBorn → spouse + baby 👶, childGrew → the
  event's child copy at its stage; entries `{char, role, scale, stage?, pose, emotion, glyph, genius?}`), `schoolMeetPairs`,
  `weddingGifts` (축의금 / 돌잔치 gifts), `CHILD_GROW` (dol/school/exam/job label · icon · scene), `meetOptions` (spec from the option
  `partner`, else `love.candidates` / `context.candidates` by `partnerId`), `dateOptions` (cost, gain, match), `proposeOptions`
  (chance % only on the propose option; `steady` is a pass), `houseOptions` (price, `basePrice` → 청약 discount, trade-in, net =
  `cost`, owners, sold out by capacity, lucky, reason), `familyTagBadge` (💍👶n🏠 for the 3D name tag).
- `public/js/ui/houseArt.js` (string builders): `houseSvg(id)` = 6 distinct flat SVG houses (viewBox 120×100, no ids) + generic
  fallback, `houseArtHtml(id, {art})` (accepted `findAsset({kind:'house', house: id})` img wins), `houseOptionsHtml` (매물 listing
  cards: art, name, price (basePrice struck on 청약), 🔁 보상판매 → 실제, 💎 자산가치 when ≠ price, 👥 capacity + 🏠 owners, 🎫 청약 /
  ✨ 골드 매물 ribbon, sold-out / no-cash reason; pass button), `marketChartSvg(mult)` (red ▲ / blue ▼ line), `dolTableSvg()`.
  `public/js/ui/familyArt.js`: `meetOptionsHtml` (candidate cards: portrait slot, trait, ★, 💞 찰떡궁합, 💼 맞벌이, 「💘 만나기」 +
  pass), `dateOptionsHtml` (💸 cost / ❤️ gain / 🎯 취향 저격 badges; server desc only for the disabled reason), `proposeOptionsHtml`
  (`.chance-meter` role=meter), `familyOptionsHtml(p)` (by kind, null otherwise), `partnerCardHtml`, `familyDetailHtml(c, {meta,
  room, avatars, artFor})` (연애 ❤️ bar · 배우자 portrait/trait/★/salary · 자녀 tiny portraits + stage + 🌟 천재 · 집 art/value/gain/
  swaps + market). Portraits are `portraitHtml` slots → `hydratePortraits` after insertion.
- Cut-ins: `cutinMap.STAGE8_ANCHORS` (met dated proposed married schoolMeet childBorn houseBought houseValueChanged) +
  `childGrew` of `CHILD_GROW_ANCHORS` (dol exam job; `isFamilyAnchor`) are anchors and follow-up boundaries; `allowance` /
  `houseSold` / childGrew school follow-ups → `g.family[]` chips; schoolMeet involves every pair's character. Tags 💘 새로운 만남 /
  💑 데이트 / 💍 프러포즈 성공 · 💔 실패 / 💒 결혼식 / 🏫 고교 첫 만남 / 👶 출산 / 🎂 돌잔치 · 🎒 · 📝 자녀 수능 · 💼 자녀 취업 / 🏠 내 집 마련 ·
  집 갈아타기 / 📈 급등 · 📉 폭락; promptResolved kinds meet/date/propose/house. Policy: married / childBorn / schoolMeet /
  houseValueChanged are big (full in 「간단히」), `MINOR_TYPES` dated (banner for others), a schoolMeet with my character counts as
  mine; merge ranks married 9, childBorn 8, proposed/schoolMeet 7. cutin2d `stage8Look` (love tone; wedding-hall for proposal
  success / wedding, hospital birth, `CHILD_GROW` scenes, studio market; `fx8` wedding = confetti + 💒 + pink frame (`.cutin.wedding`),
  hearts, heartbreak), `stage8Extras` (💌 per-guest 축의금 / 돌잔치 chips replace the weddingGift / dolGift money chips, 💍 spouse chip,
  👶 baby chip, exam result, 💌 future allowance, 🏠 price / 🔁 trade-in / 🎫 청약 / ✨ 골드 매물, ❤️ affection, 용돈 / 보상판매 / 입학
  follow-ups, 💑 맞벌이 = `salary.spouseAmount`), `stage8Badge` (💘 partner trait · ★, 👶 baby), panels `.ci-house` (house art + price)
  / `.ci-dol` / `.ci-pairs` (every pair with portraits in the box) / `.ci-market`; `marketSpec` = studio with the MCs when the group has
  lines, else kind `market` (chart centred), chips `before → after` per owner from `changes`. Cast: family entries join the
  character (up to `MAX_CAST` 5, `slotPositions(scales)` spreads narrower children; `.ci-slot.fam.<role>` with a `.ci-famtag` name,
  height × scale); schoolMeet window = my pair first + one more (4 figures). Prompts (cut-in + 2D modal): meet / date / propose via
  familyArt, house via `houseOptionsHtml` (prompt spec carries `room` for owners); prompt cast: meet → subject + both candidates,
  date / propose → subject + partner; kind looks love / love / wedding-hall / treasure.
- game2d: side rows `gc-tag fam` (💕/💍 + kids) and `gc-tag house` (icon + value); detail card = `familyDetailHtml`; result rows
  `familyLine` (house art + name + value, family icons + summary) and 「집 N만원」 (ranking `house`); floats / toasts (cut-ins off)
  for every Stage 8 event (`stage8Float` / `stage8Toast`); `houseValueChanged` goes through the lotto path of `showGroup` (one
  studio cut-in). 3D: animator `ANIMATED_EVENTS` + met dated proposed married schoolMeet childBorn childGrew allowance houseBought
  houseSold houseValueChanged; board3d pops 💘 💕 💍 (+ confetti) 👶 (+ confetti) 💌 🏠 (+ confetti) 🔁, 💍/💔 proposal, childGrew 🎂🎒📝💼,
  schoolMeet banner + 💘 per pair, market banner 📈/📉; `familyTagBadge` rides on the name tag (`tagBadge`, no extra draw calls).
- CPU players (9-C): `format.isCpu(c)` (`c.cpu` or ownerId 'cpu'), `cpuBadgeHtml(c)`, `ownerHtml(c)` = the escaped owner name, or
  only the 「🤖 CPU」 badge for CPU characters (their ownerName is 'CPU' → never "CPU 🤖 CPU") — side list, now-playing line, result
  rows, lobby cards, admin room detail.
- CSS `public/css/family.css` (linked after cards.css). E2E: session scratchpad `s8b/` (`inject.cjs` injected state / events for
  every cut-in, prompt (cut-in desktop 3D, 390, 2D modal) and the result; `game.cjs` natural game on the real 8-A server;
  screenshots `s8b-*.png`).

## Stage 9 — CPU players (9-C)
- Owner id `'cpu'` (`lobby.CPU_OWNER`, `cpu.CPU_OWNER`): `viewFor` shows `ownerId 'cpu'`, `ownerName 'CPU'`; order.js puts
  CPUs after the players' characters (family order). CPU characters carry `cpuPersonality` cautious|normal|bold (public).
- Lobby (pure, `server/game/lobby.js`): `addCpuCharacter(room, {name?, avatar?}, now, {by})` (lobby only, max characters,
  name = first unused `CPU_NAMES` entry unless given, look = `randomAvatar(seed)` seeded by room seed + id + seq,
  personality seeded the same way), `removeCpuCharacter(room, charId, now, {by})` (CPU only → 409, lobby only),
  `roomHost(room)` (= first joined non-spectator), `canManageCpu(room, sessionId)` (409 without `config.allowCpu`, 403
  for non-hosts / spectators). A CPU-only room starts like any other (≥ 2 characters, no ready check) — admin only.
- Routes: admin `POST /admin/api/rooms/:id/cpu {name?, avatar?}` → 201 `{characterId, room}` (always allowed in a lobby),
  `DELETE /admin/api/rooms/:id/cpu/:charId`; host player `POST /api/rooms/:id/cpu` → 201 / `DELETE /api/rooms/:id/cpu/:charId`
  (only with 「CPU 허용」). Admin page: 「CPU 허용」 create checkbox (sent only when on), room detail 「🤖 CPU 추가」 + one
  「🤖 name ✕」 button per CPU in the lobby. Lobby (`app.js` `renderCpuTools`): the same chips under the character grid
  for the host when `allowCpu` (`#cpu-tools`).
- `server/game/cpu.js` (pure; never consumes the game RNG — ties use a sub-RNG hashed from seed/rngState/turn/prompt/char):
  `cpuDecide(room, charId, data) → action | null` (order: answer a trade offer made to it → answer the pending prompt →
  on its awaitSpin turn `cpuCardAction` or `spin`); `cpuDue(room) → {kind: trade|prompt|spin, charId, key}` (what the
  room waits on from a CPU; the key changes per step, e.g. `s:<turnNo>:<cardUsed>`); `cpuNextAction` (both, headless);
  `cpuAnswer`, `CPU_ANSWERS[kind](ctx, c, pending) → optionId | null` (null / unknown kind / disabled → the prompt default,
  else the first enabled option — every answer is an enabled option); `cpuTradeAccept` (value got ≥ value given ×
  `tradeMargin`; money at face value, cards at `cardValue` = price, job-only cards of another job ×0.1, lotto ×0.45, a
  card pushed out of a full hand counts); `jobScore` (rank salary + odds of the next two ranks − injury), `targetJob`,
  `jobDeficit`; `PERSONALITY` knobs (promotion / retake / propose thresholds, cash reserve, shop multiplier, sabotage
  ratio, trade margin, holiday stake style, route bias). CPUs never bet, offer trades or gift.
- Heuristics: route = max of love (charm ×0.4 + family: single 1.5 (+1 charm ≥ 6, 소개팅), dating 1.5 + affection/proposeAt,
  married 1.5 while < max children else 0.5) / career (1.5 + min(3, regular salary/150) + int ×0.2) / money (min(3, 1.5 ×
  cash / the room's average cash) + luck ×0.2 + 1 without a house) + personality bias (post-simulation fixes); habit → the biggest requirement gap
  of `targetJob`, else int before a degree job, else its rank-up stat; exam = higher `college + elite/2` of study/guess;
  career = college when admitted, 재수 when the retake pass chance ≥ threshold, else job; military = now/volunteer for
  str jobs (전역 체력 +2), else later/skip (bold volunteers); jobOffer = max `jobScore`; jobTile = change when the new job
  scores > 1.15 × the current rank, promotion when `rankUpChance(exam)` ≥ threshold (not injured), max-rank bonus when its
  EV ≥ overtime share, else overtime; hiddenJobOffer accept; shop = best positive (worth × shopMult − price) keeping the
  reserve (items: resale + 90 per useful stat, laptop salary bonus; bonus card = next salary; lotto/coupon ≈ worthless);
  holiday stake by cash multiples; groupGift default; Stage 8 kinds read option fields (meet: ★ + 맞벌이 월급 + 찰떡궁합,
  never pass; date: gain − 0.3 × cost within the reserve; propose when `chance` ≥ threshold else the other option;
  house: value − cash cost − current house + 15 % drift until 노년 시세, keeping half the reserve).
  Cards before the spin (one): 공약 with the job; sabotage vs the richest rival (ranking total, no lawyer in hand, not
  targeted by anyone this / last round) when it is ≥ own total × `sabotage` ratio (tax audit ≥ 300 cash > complaint with a
  job > cut_line > noise > gossip for charm jobs); stat cards for a useful stat; taxi / energy within 12 tiles of the goal
  or when the expected landing (tile worth over rolls 1..10, stops halt) gains ≥ 25; a (nearly) full hand plays anyway.
- Runner (`GameRunner`): sibling CPU timer per room (`cpuTimers`), armed by `schedule(room, events)` from start / dispatch /
  restore with `cpuDue`; delay `cpuDelayMs` (`CPU_DELAY_MS` spin 1600 / prompt 1200 / trade 1200, + `cutin` 2500 when the
  last batch had an `event.cutin`; a number sets all four — tests pass 0 or `{cutin: 0}`), fires `runCpu(roomId, key)` →
  `cpuDecide` dispatched with actor `{system: true, cpu: true}` (only for `ownerSessionId === 'cpu'`); a refused action
  falls back to the default option / plain spin / reject, then logs. `end()` / `stop()` clear it. Simultaneous prompts:
  each CPU answers on its own timer. `startServer({cpuDelayMs})` passes it through.
- Engine edits: `prompts.js` `openPrompt` no longer pre-answers CPU characters with the default (the runner answers);
  `cards.js` `offerTrade` accepts CPU targets (the runner answers). A system actor may already act for any character.
- Scripts: `node scripts/cpu-game.js --cpus 4 [--random R] --mode lifetime --seed S [--games N] [--verbose]` (headless,
  CPU and random characters alternate, `index` order; per game winner / routes / jobs / totals, summary by personality;
  `playCpuGame`, `cpuVsRandom` exported). `scripts/simulate.js --policy random|cpu|mixed` (mixed = odd seq CPU, prints
  1st-place share per policy). Measured (4 CPU + 4 random, lifetime, 300 games): CPU win share 62.3 / 64.3 / 66.3 %
  (seeds 1 / 2 / 3), average rank 4.1 vs 4.9, average total ≈ 1610 vs 1435 만원; `simulate --policy mixed --games 300
  --seed 11`: CPU 66.3 % of wins with 54.6 % of the characters.
- Tests: `test/cpu.test.js` (lobby rules, every registered prompt kind answered with an enabled option the engine
  accepts — kinds without a fixture get a synthetic prompt, heuristics, Stage 8 option fields, sabotage targeting, card
  legality, trade answers, CPU-only games in 3 modes with no bets / offers / gifts), `test/cpu-server.test.js` (delays,
  mocked-timer pacing incl. the cut-in extra and a trade answer, a CPU-only runner game to the end, admin / host routes,
  admin start of a CPU-only room watched by a spectator). E2E: session scratchpad `s9c/e2e.cjs` (`s9c-*.png`).

## Stage 9 — submaps, treasures, awards, result show (server)
- Data (`gameData().treasures|awards|titles`, `/api/meta.treasures|awards|titles`, `/api/meta.balance.submaps|result`):
  `server/data/treasures.json` (22 `{id, name, icon, desc, min, max, fakeChance, weight, eras?}` + `fake {min 0, max 5}`),
  `awards.json` (10 `{id, name, icon, desc, metric, route?, min, bonus, tie: all|split|place|qualify}`), `titles.json`
  (`perCharacter` 2, 25 titles `{id, name, icon, desc, priority, when}` + the `fallback` 평범한 인생), `balance.json` `submaps`
  (era `scale`, hometown / temple / jeju / reversal numbers) and `result` (`mvpVoteMs` 180000 (the result show takes ~60–80 s), `mvpSettleMs` 5000, `highlights
  {keep 8, show 5, bigMoney 300}`). jobs.json 산신령 `unlock {wishes: 8}` (loop maps; 2 after the post-simulation fixes, 3 before) (`unlockMet` knows `wishes`; the Stage 6 interim rule is
  gone). board.json: tile types `hometown 🏡 / temple 🛕 / jeju 🏝️ / reversal 🎰`, pools: hometown elem/middle/high/senior main +
  love route, temple middle 2 / high 2 / senior 4 + money route 3, jeju love / money routes, reversal senior 5, treasure money route
  4 + senior 2; `placeholders` is `{}` (resolveTile's default branch stays for future types).
- Submaps (`server/game/submaps.js`, single-tile detours; `resolveTile` → `resolveSubmapTile`): landing emits `submapEntered
  {charId, submap, tileId}` (a follow-up: the prompt takes the stage, `landed.cutin` false) and opens prompt `<submap>` (single):
  - `hometown` options `rest {money, stats {str:1}, skipTurns 1}` / `visit {money, stats {charm:1}}` (default visit); rest = the next
    turn is skipped (`skipTurns` + `skipReason: 'hometown'`, endTurn logs by reason: retake / hometown / temple).
  - `temple` options `train:<stat> {stat, gain 2, skipTurns 1}` for the weakest and the strongest stat below the cap
    (`trainStats`), `wish {chance, cost = price = offering, money}` (disabled without the 시주), `leave` (default). Wish: offering
    paid, `rng.next() < wishChance` (base 0.5 + 0.05 × 운, [0.1, 0.9]) → 운 +1 + money, `character.wishes` += 1 (public).
  - `jeju` options `trip {cost, price, stats {charm, luck}, treasureChance}` (disabled without cash; default trip when affordable) /
    `skip`; a trip finds a treasure with `jejuTreasureChance` (0.3 + 0.02 × 운 ≤ 0.6) → `treasureFound {source: 'jeju'}`.
  - `reversal` options `lotto {cost 35, prizes [{id jackpot|second|third, chance, amount}], ev}` (EV 30 < 35), `horse:2|5|10 {odds,
    chance 0.47/0.188/0.094, stake = 20 % of cash (10..1500, 5 단위), ev < 1}` (disabled without cash), `skip` (default).
  - Resolution → `submapResult {charId, submap, optionId, result, amount?, ...}` (anchor, emitted BEFORE its moneyChanged
    (reasons hometown / temple / jeju / reversal) / statChanged (reason = submap) follow-ups). `result`: hometown rest|visit ·
    temple train (+stat, gain) | wishOk | wishFail (+chance, wishes) | leave · jeju trip (+treasure bool) | skip · reversal jackpot |
    lottoWin | lottoLose (+prize, rank) | horseWin | horseLose (+odds, stake, chance) | skip. skip / leave results have `cutin: false`.
- Treasures (`server/game/treasures.js`): `treasure` tile → `findTreasure` (weighted pool of the era, `appraise` = fake with
  `fakeChance` → 0..5, else min..max rounded to 5) → character `treasures [{uid 'tr<n>', id}]` (public), `room.treasureValues {uid:
  value}` + `room.treasureFakes {uid: true}` (hidden), `room.nextTreasureSeq`; `treasureFound {charId, uid, treasureId, source:
  tile|jeju}` (anchor; takes over the landing's cut-in like Stage 8 outcomes). `viewFor`: `treasureValues` only when the room is
  finished (else null), `treasureFakes` never (the fake flag goes out in `result.treasures`). Mid-game `computeRanking` never counts
  treasure values (`reveal: false`, so CPU heuristics can't peek).
- Life records + highlights (`server/game/highlights.js`, pure post-passes in `applyAction`): `trackRecords` (before decoration; the
  gameOver path runs it first so titles see the whole batch) keeps `character.record {minNet, maxDebt, bankruptcies, inDebt,
  worstRankPct (net-worth rank at adult era entries, 1 = poorest), luckWin (lotto + reversal gains), gambles, gambleNet, sabotage,
  sabotaged, rankUps, overtime, proposeFails, partners, submaps {hometown, temple, jeju, reversal} (non-pass visits)}` and flags a
  loss that pushed a character into debt with `moneyChanged.bankrupt: true` (학자금 loans never count). `recordHighlights` (after
  `decorateEvents`) → `room.highlights {charId: [{seq, turnNo, type, text (Korean), tone, scene, emotion, era, amount?, score,
  eventRef}]}` (public; top `keep` by score, chronological; `eventRef` = scalar fields of the event + partner/spouse/child names).
  Scores: jackpot 10+, hidden job 9, wedding / 1st goal 8, genius birth 8, max rank / bankruptcy 7, birth 6, sabotaged 5, house 5–7,
  exam elite 5, big money swings 3 + |Δ|/300, …; `topHighlights(n)`. `room.highlightSeq`.
- Result (`result.js` `applyResult`, also on the admin force end): `computeAwards` (awards.js metrics children, geniusChildren,
  careerScore (hidden +100, rank × 10, +5 at max; 알바 0), treasureValue, houseValue, routeMedal (route completed in young AND
  middle_age), allRoutes (love route|married, career route|rank ≥ 2, money route|house|treasure), luckWinnings) → `computeRanking(room,
  {reveal: true, awards})` rows `{rank, charId, name, money, debt, goalBonus, items, house, treasures, awards, total, place}` (total =
  money − debt + items + house + treasures + awards; award bonuses are NOT added to cash) → `computeTitles` (`titleFacts` +
  `conditionMet`) → `room.result = {ranking, treasures [{charId, uid, treasureId, value, fake, line, lineTag}], awards [{id, name,
  icon, desc, charIds, bonus (per winner), value, line, lineTag}], titles {charId: [titleId]}, highlights (top 5 per character),
  mvp {votes {playerId: charId}, winner, closesAt, closed, counts?, closedAt?, note?, line?}, finishedAt, forced, mc?}`. `gameOver`
  event: `{ranking, awards, titles, treasures, mvpClosesAt (null when already decided)}`.
- MVP vote (engine `RESULT_ACTIONS`, status finished only, else 409 "결과 발표 중이 아니에요."): `vote {targetId}` — actor
  `{sessionId}` of a room player (spectators 403 "관전자는 투표할 수 없어요.", admin/system 403, trusted callers pass `voterId`),
  one vote per player (changeable, `mvpVoted {playerId, charId, changed, count}`), own characters 409 unless the voter owns every
  character; when every eligible player voted, `closesAt` = min(closesAt, now + mvpSettleMs). `closeVote` — system only once
  `closesAt` passed (409 "아직 투표 시간이 남았어요."), admin any time → `decideMvp` (most votes; ties → higher final rank; no votes
  → 1st place + `note: 'noVotes'`) → `mvpDecided {charId, votes {charId: n}, note?}`. No eligible voters (CPU-only / spectators) →
  decided inside applyResult (`note: 'noVoters'`) and `mvpDecided` follows `gameOver` in the same batch. CPUs never vote.
  `GameRunner.deadlineOf` returns `{kind: 'vote', at: closesAt}` for a finished room with an open vote → `closeVote` (system);
  `runner.end` re-schedules so a forced result closes too; `restore()` re-arms it. Routes: player `POST /api/rooms/:id/actions
  {type: 'vote', targetId}`; admin `POST /admin/api/rooms/:id/actions {type: 'closeVote'}` (finished rooms).
- Presentation: `EVENT_TYPES` + submapEntered submapResult treasureFound mvpVoted mvpDecided; `CUTIN_TYPES` / prompts.js
  `ANCHOR_TYPES` + submapResult treasureFound mvpDecided (boundaries also mvpVoted); scenes `hometown temple jeju casino`
  (`SUBMAP_SCENES`; tones.json scenes + `sceneFallbacks` → mountain-trail ×3 / office; manifest `bg-hometown bg-temple bg-jeju
  bg-casino` todo), mvpDecided scene stage. Prompt tone / tag / emotion / scene per kind (tags hometown temple jeju reversal).
  Line tags: hometown hometown_rest hometown_visit temple temple_train temple_wish_ok temple_wish_fail temple_leave jeju jeju_trip
  jeju_skip reversal reversal_jackpot reversal_win reversal_lose reversal_skip appraisal_real appraisal_fake award mvp mvp_vote
  (+ placeholders `{treasure} {award}`); `treasureFound` uses tag treasure. gameOver rows: every revealed treasure / award gets a
  `line` (copied onto `room.result`). MC (mc.json + lines.json pools): `temple` (medium; a wish / training), `jeju` (medium; a trip),
  `reversalWin` (big) / `reversalLose` (medium), `treasure` (big, on treasureFound only; vars + treasure), `mvp` (big, studio, on
  mvpDecided), and the result show parts: intro → `appraisal` (best real treasure, else a fake) → `awards` (biggest award) → winner →
  last → penalty → `mvp` (situation `mvpVote`, only while the vote is open). Manifest kind `treasure` (meta.treasure required, icon
  pipeline) with 22 todo items `treasure-<id with _→->` → `treasures/<…>.png`.
- CPU (`cpu.js`): hometown = rest only when 체력 helps, the goal is > 12 tiles away and the gift beats a lost landing (bold: visit);
  temple = wish when already granted one (or bold with ≥ 40 %), else train a useful stat (not bold, goal far), else wish at ≥ 50 %
  within the reserve, else leave; jeju = trip within the reserve (bold looser); reversal = cautious skip, normal lotto only when
  trailing, bold horse:10 when far behind the leader, else horse:2 with ample cash, else lotto. `tileWorth` knows treasure / submaps.
- Balance (`scripts/simulate.js` 9단계 block; seed 11 × 300): lifetime 78.1 spins (Stage 8 79.0), 15.75 decisions per lifetime character
  (temple 0.78, hometown 0.38, reversal 0.22, jeju 0.09); route net worth ±1.1 % (young) / ±4.8 % (middle_age); treasures 0.29 per
  adult character (money route 0.44 vs 0.2), mean value 180 (median 110, 24 % fakes); awards per lifetime game 22.7 % (행운상) …
  84 % (다복상), every bonus ≤ 6.2 % of the average winner total (2421); total composition cash 73.6 % · house 13.9 % · items 0.3 % ·
  treasures 3.2 % · awards 8.9 %; all 26 titles reached (평범한 인생 31 %); 산신령 0 % random (wishes ≥ 2: 0.4 %) — `--policy cpu`
  0.5 % of adult characters / 2.6 % of games, mixed 1.6 % of games; bias 2000 × seed 1: 11.3–13.8 %, spread −0.05; cpu-game 4 CPU +
  4 random × 300 (seed 1): CPU 56.7 % of wins.
- Tests: `test/stage9-submaps.test.js` (data, appraisal, every submap option, skip turns, temple train stats / wish / 산신령 via
  wishes, jeju treasure, reversal EV + outcomes, treasure masking before / after the end, presentation / MC, CPU answers, restore +
  migration, random lifetime games), `test/stage9-result.test.js` (award / title schemas, award ties, metrics, title conditions,
  records, highlight capture + cap, ranking composition + gameOver payload, MVP rules, no-voter games, forced end + runner timer +
  restore, HTTP vote / closeVote / meta).

## Stage 9 — client (submaps, result show, podium, photo)
- Pure `public/js/shared/submaps.js` (imports only growth.js; `test/client-submaps.test.js`): `SUBMAPS` / `submapInfo(id, meta)`
  (hometown 🏡 / temple 🛕 / jeju 🌴 / reversal 🎰 → scene casino; `meta.submaps` wins), `SUBMAP_TILE_TYPES` (+ treasure 💎; board.json
  wins), `submapOf`, `parseOptionId` (`train:<stat>`, `horse:<odds>`), `stripIcon`, `submapOptions(p)` (cards: stat chips, horse odds /
  chance % / stake / payout, lotto, server `desc` wins), `submapSuccess(e)` (9-A results wishOk/lottoWin/horseWin/jackpot → true,
  wishFail/lottoLose/horseLose → false, rest/visit/train/trip → null), `isSubmapPass` (skip / leave / `cutin: false` → banner),
  `isWishUnlock` (wishOk with `wishes` ≥ jobs.json `unlock.wishes`, default 3), `isSubmapBig` (jackpot, reversal win ≥ `BIG_REVERSAL`
  500, 산신령 wish), `racePlan(e)` (deterministic from the event: the chosen horse wins exactly on a win, a lost bet's horse comes in
  last; `winner`/`winnerOdds` honoured; finish times + easing per horse), treasures `treasureInfo/treasuresOf/treasureCount/
  treasureValueText` (「감정 전 ???」 until `result.treasures`, fake → 「💥 가짜!」).
- `public/js/ui/submapArt.js` (string builders, node-tested): `submapSceneBody(scene)` (SVG 시골집 / 산사 pagoda + bell `.sm-bell` /
  제주 돌하르방 + 바다 + 유채꽃 / 경마장, no ids), `horseSvg`, `raceHtml(plan)` (3 lanes, CSS race `.sm-race.go`, `--t` finish times,
  place labels, 🏆 적중 / 💸 꽝 flag), `raceGateHtml` (reversal prompt window), `treasureChestSvg`, `treasureArtHtml` (accepted
  `findAsset({kind:'treasure', treasure})` img, else emoji), `submapOptionsHtml(p, who, {btnClass})` (null for other kinds; used by
  the cut-in prompt AND the 2D modal), `treasureListHtml`.
- cutinMap: `STAGE9_ANCHORS` submapResult / treasureFound (anchors + boundaries), `submapEntered` / `mvpDecided` never anchors
  (the prompt / result screen take the stage); a jeju `treasureFound` right after its trip result folds into that group
  (`g.treasure`, ONE cut-in); tags 「🎰 인생역전 · 경마」「🛕 산사 · 소원」「💎 보물 발견」; `PREFER_SVG_SCENES` (hometown temple
  jeju casino): their own SVG beats a `sceneFallbacks` background (own generated bg still wins). cutinPolicy: treasureFound in
  `MINOR_TYPES` (banner for others in 「간단히」, full when mine), submapResult big only by `isSubmapBig`, passes = banners, merge
  ranks submapResult 6 / treasureFound 5. cutin2d `stage9Look` + `stage9Extras` (race panel, ✨ wish / 🍂 wish-fail fx, 🎟️ lotto
  scratch ticket (jackpot glow), treasure chest → item pop + badge, chips), prompt kind looks (scenes hometown/temple/jeju/casino),
  `overlay.dataset.submap` (temple bell swing). Auto-close now resolves `'auto'` (→ `onClose('auto')` tells a tap from a timeout).
- game2d: `CLIENT_TILE_TYPES` + submap tiles, side-row 💎 n tag, detail card treasure list, floats / toasts for submapEntered /
  submapResult / treasureFound, 2D modal submap cards; 3D: animator + board3d pops (🏡🛕🌴🎰 / 💰+n or 💸 + coins / 💎 + stars), tile
  glyphs/colours. Admin: 「👑 MVP 투표」 box on finished rooms with live counts + 「🗳️ 투표 마감」 (`closeVote`).
- Result show — pure `public/js/shared/result.js` (`test/client-result.test.js`): `rankRows` (server `rank`, else competition ranking),
  `BREAKDOWN` / `breakdown` / `breakdownBars` (현금 − 빚 · 집 · 아이템 · 보물 · 특별상; Σ segments − negative = total), `podiumLayout`
  (steps 2·1·3, ties share a step), `appraisalRows` (cheapest first, fake 💥, per-treasure `line`) / `appraisalTotals`, `awardCards`
  (+ acceptance `line`) / `titleBadges` (meta.awards / meta.titles), `highlightSlides` (LAST → FIRST place, ≤ 3 per character spread
  over the lifetime, `HIGHLIGHT_BUDGET_MS` 60 s: fewer per character, then slides 1500 → ≥ 1100 ms), `planResultShow` (intro →
  highlights → appraisal → awards → ranking → podium; empty steps dropped), `mcParts`, `FALLBACK_MC` / `fallbackMc` (appraisal /
  awards / decided MVP), `mvpState` / `voteButtons` (players only, own characters refused unless all are mine, `closed` / deadline /
  winner, my vote = ✅ and still changeable to another), `countdownText`, `photoLayout(n)` (1–8, ≤ 4 in one row, else back row
  smaller / higher / between, rank 1 front centre, `centerOut`), `PHOTO_POSES` 브이/만세/하트/점프, `poseOffset`, `photoTitle` /
  `photoFileName` (`jinsei-<code>-<yyyymmdd>.png`). `public/js/scene/podiumLayout.js` `podiumSlots(steps)` (pure).
- `public/js/ui/resultShow.js` `createResultScreen({getMeta, cutin, act, toast, rowExtras, artFor, findAsset, mcOn, want3D, now})` →
  `render(room, host, {autoplay})` (page built once per result key; later renders only update ranking / awards / treasures / MVP by
  JSON keys), `onEvents` (mvpDecided → MC lines from the event), `play({force})`, `skip`, `reset` (app `leaveRoom`), `podium`,
  `openPhoto`. Show: a/b through `cutin` (studio intro from `result.mc` intro or client pools; highlight slides = cut-in specs with the
  character art, scene, tone, `eventRef.line` bubble, amount chip; a tap before the auto-close skips the rest of that character),
  c–f in the `.rshow` overlay (z 23; 🥁 appraisal flip cards, award cards one by one then all + 칭호 list, ranking with growing bars
  last → first, podium) with an MC booth per step (`result.mc` parts appraisal / awards / last+penalty / winner). Fixed 「⏭ 건너뛰기」
  (z 27) and, while the vote is open and I haven't voted, 「👑 MVP 투표하기 · n초」 (skips to the vote — the server's vote clock runs
  from the game end, ~60 s, shorter than the show). Autoplays once per room per browser session (sessionStorage
  `jinsei.resultShow.<room>.<finishedAt>`); 「▶ 결산 방송 다시 보기」 replays; `?cutins=off` → page only. Page: tools (다시 보기 ·
  📸), podium (3D canvas in 3D mode — the same element moves between the overlay and the page, WebGL context kept — else a CSS
  podium with bust portraits, ties side by side), 👑 MVP section (vote cards with live counts / bars / countdown, MC invitation from
  `result.mc` part mvp, decided → 👑 card + `mvp.line` + event MC lines + crown on the podium / ranking row, note noVotes/noVoters),
  ranking (medal, titles, extras from game2d, stacked bar + legend), awards + titles, treasure appraisal list.
- `public/js/scene/podium3d.js` `createPodium3D(canvas, {defs, entries, reducedMotion})` → `celebrate/setCrown/snapshot(w, h)/stats/
  dispose`: own tiny scene (floor + merged 3-step podium + number sprites + pawns via `buildPawnGeometry` + name tags + confetti
  bursts, slow ±25° orbit, winner hops). Measured 15 draw calls / ~5.6k triangles with 5 pawns. `?debug=1` → `window.__podium3d`,
  `window.__result`.
- `public/js/ui/groupPhoto.js` `renderGroupPhoto({entries, poseId, title, bgUrl, snapshot})` (1600×1000: studio bg
  `findAsset({kind:'bg', scene:'studio'})` else a drawn stage, figures = AI art pose/expression > composed layers (`composeAvatar`
  crop full) > SVG portrait, pose offsets + glyphs, medal name pills, title banner) and `openPhotoDialog` (pose radio, 🎨 일러스트 /
  🧊 3D 시상대 (podium `snapshot`) in 3D mode, 📥 PNG 저장 = `canvas.toBlob` + `<a download>`, 📤 공유 = Web Share API with the file
  when available). Works without WebGL.
- CSS `public/css/stage9.css` (linked after family.css). E2E: session scratchpad `s9b/` (`game.cjs` = natural CPU-assisted game on the
  9-A server: 1280 3D + 390 2D + 3 CPUs → submap prompts / race / wish / treasure, full show, votes (B in the UI during the show, A by
  API) → mvpDecided, 3D podium, photo downloads (PNG 1600×1000 ≈ 1.8 MB), replay, 0 console errors, no 390 overflow; `inject.cjs` =
  every submap prompt (cut-in 1280 / 390, 2D modal), race win / lose, jackpot ticket, wish, rest, jeju + treasure, skip banner, admin
  closeVote, synthetic 8-character result (appraisal of 8 treasures, awards, titles, highlights, tie for 2nd) at 1280 + 390;
  screenshots `s9b-*.png`).

## Post-simulation fixes (client)
- Source: `docs/playtest-report.md` A1–A10, A14–A16, A18 + C (waiting time). E2E in the session scratchpad `fix/` (`inject.cjs`
  targeted checks on the real server with injected state / events, `rtl.cjs`, `dbg-delete.cjs`; screenshots `fix-*.png`) plus the
  sim2 / sim4 repro scripts.
- Pure policy (`public/js/ui/cutinPolicy.js`, `test/client-postsim.test.js`): `classifyGroup(g, {…, fastForward, myTurn})` — other
  players' groups become banners while 「⏩ 빨리 감기」 is on or my roulette waits (`myTurn`), except shared shows I take part in
  (`involvesMe`: 명절 start / 정산 rows, lotto entries, schoolMeet pairs, gifts); `markRepeats(groups, seen, {mine})` marks other players'
  2nd+ entrant of an era (no MC studio) and 2nd+ wedding `repeat: true` → banner in 「간단히」 (「전체」 keeps everything); `seenFromRoom`
  (reload mid-game), `eraBannerText` (「민수·지영 청년 시대 진입」); constants `OTHERS_AUTO_MS` 3000 (other players' plain cut-ins
  auto-advance ≤ 3 s even with MC lines — race / 명절 정산 / treasure / studio shows keep their length; `spec.capMs`, `spec.own`),
  `MY_TURN_CATCHUP_MS` 900, `DEADLINE_RESERVE_MS` 12000.
- My turn (A3, game2d `catchUp`): when my character's awaitSpin starts, after 900 ms other players' queued cut-ins are dropped into
  banners and the one on screen closes ≤ 0.7 s after it appeared (`cutin.preempt({keepMs, keepOwn, onDrop})`; my own / the opening
  studio (`opts.own`) stay), the 3D animator rushes its backlog (`animator.rush()`: queued steps run with `ctx.instant` + `ctx.rushed`
  until the queue drains; a rushed cut-in step of mine still queues its cut-in, others' become banners). `myTurnFree` → the spin button
  and HUD show without waiting for other players' cut-ins; with a turn timer the button is never held once < 12 s are left (also my own
  cut-ins are pre-empted then). `cutin.busyOthers()` = something other than my own / prompt cut-ins.
- ⏩ 빨리 감기 (`data-el="ffbtn"`, localStorage `jinsei.fastForward`): others' cut-ins and prompt waiting screens → banners, the current
  one closes. Banners: `spec.mergeKey` + `spec.merge(prev)` merge into the strip on screen / queued (era entrants); queued banners
  wait while a cut-in is open (`createBanner(root, {blocked})`, default `body.cutin-open`) instead of timing out unseen under it.
- Game over / forced end (A1, A8): app `render()` always calls `game.finish()` for a finished room (idempotent per game: `teardown()` =
  cut-ins, banners, MC corner, decision sheet, card sheet, trade dialog, inbox, floating spin button; 3D animator `rush()` + clear after
  `FINISH_BOARD_MS` 1500) and waits `game.whenIdle({maxMs: 2500})` at most. After game over a stale "playing" view (idle callbacks /
  timers) never renders or reopens a prompt (`render` / `renderModal` guards).
- Leaving (A6): app `tearDownRoomUi()` on 나가기 / room deleted / 403·404 → `game.teardown()` (also forgets the room: `ui.room = null`),
  result show reset, `closePhotoDialogs()`, customizer, sheet, body classes. Cut-ins have their own 「🚪 나가기」 (`.ci-exit`, top-left,
  `cutin.setExit(fn)` set by the app while in a room, asks `confirm` first — a tap meant to advance must not leave; hidden in TV
  mode).
- Side list (A4): `renderChars` is keyed per row (`li[data-id]` kept, portrait / body / money / detail body / detail actions replaced
  only when their markup changes via `setHtml`) → an open detail card never replays `sheet-up`, taps on 「🎁 선물」「🤝 거래 제안」 land.
  `charDetailParts(c)` → `{body, acts}`. Bet panel rebuilt only when its key changes (slider / select keep focus).
- Prompt input guard (A5): options of a new / changed prompt ignore taps for `PROMPT_GUARD_MS` 700 (cutin2d exports it; `.arming`
  fade-in; 2D sheet via `ui.modalAt`). `chose {timedOut: true}` of my character → toast 「⏰ 시간 초과 — ○○(으)로 처리됐어요」 (label from
  the last seen pending, `josa`).
- Floating spin (A7): `data-el="spinfab"` (fixed, bottom centre above the reaction bar, z 19) when it's my turn and the dock's button is
  not really visible (`elementFromPoint` — under the top bar / sticky board / off screen); scroll / resize / IntersectionObserver.
  Desktop ≥ 900 px: the character list and the log scroll inside the side column; the board is sticky when the viewport is ≥ 640 px tall.
- Connection (A9): api.js `lastSseMessageAt()`; app watchdog every 5 s — after 35 s without an SSE message it probes `GET /api/session`
  (≤ every 30 s): a network failure → 「● 재연결 중…」 + stream reopened; `offline` / `online` events act at once (「● 오프라인 · 재연결 중…」).
- Names (A10): api.js strips bidi controls (U+202A–202E, U+2066–2069, U+200E/200F, U+061C; raw and `\uXXXX`-escaped) from every HTTP /
  SSE payload before `JSON.parse` (`format.stripBidiJson`); `format.cleanName` = the server's lobby cleaning (Cc/Cf/fillers removed, ZWJ
  only inside emoji, NFC, whitespace collapsed); `nameLength` = graphemes after cleaning (the n/12 counter = the server's count),
  `nameFits` = ≤ 12 graphemes and ≤ `NAME_MAX_UNITS` 64 UTF-16 units; join / customizer submit the cleaned name. `nameHtml(name)` =
  `<bdi>`; CSS `unicode-bidi: isolate` on name elements (HUD, side rows, banners, cut-in who / tabs, ranking…); 3D `textCanvas` and the
  group photo labels strip bidi controls.
- Korean particles (A16): `format.josa(word, '이/가' | '을/를' | '은/는' | '과/와' | '으로/로')` mirrors the server (isolates ignored);
  every client template uses it (cards.js keeps a local `josaTopic`, it has no imports). A lost side bet / a declined trade → info toast.
- Layout (A14): phone landscape (`orientation: landscape` and height ≤ 500 px) → cut-in grid: illustration left, dialogue / options right
  (options scroll), reaction bar vertical at the right edge; 명절 정산 / lotto rows scroll inside the box (`max-height: min(26vh, 240px)`),
  a 명절 정산 cut-in (`.cutin.holiday-res`) uses a smaller window so ▼ stays on a 1280×720 screen. TV (`?quality=tv` → `body.q-tv`):
  cut-in stage `zoom: 1.4`. Phones: result ranking places 4+ start folded (`.rk-fold`, 「▼ 4위부터 자세히」 `data-rs="more"`).
- Photo dialog (A15): one instance (`openPhotoDialog` returns the open one), Tab focus trap, Escape, focus back to the opener,
  `photo-open` removed only when the last one closes, `closePhotoDialogs()`. Storage (A15): api.js localStorage → sessionStorage → memory
  (`storageMode()`); memory only → a one-time 7 s notice that a refresh will join as a new player.
- A2: `resultShow.render` sets `S.host` before `build()` → ranking / awards / treasures are filled in the first pass (spectators, CPU-only
  rooms, TVs).
- A18: the 인생역전 casino SVG sign sits in the top-right light band (`.sm-sign`), clear of the cast and the race panel.
- Trade dialog: neither hand has a card (money ↔ money is not a trade) → 「🃏 거래할 카드가 없어요」 + 🎁 선물하기; amount inputs are
  text + `inputmode=numeric`, digits only; `cards.js` amounts must be `^\d+$` strings (「1e3」, 「+5」, 「0x10」 → 「금액은 숫자로만…」).
- Monkey flags (follow-up): `public/js/ui/scrollLock.js` — `SCROLL_LOCKS` (body class → overlay selector: cutin-open / rshow-open /
  photo-open / cz-open), pure `staleLocks(classes, isOpen)`, `repairScrollLock(doc)` drops a lock class whose overlay isn't open; the
  app runs it after a room teardown and every 2 s. Connection: api.js `onNetwork(fn(ok))` reports every HTTP request (a network
  failure flips the badge at once), any SSE `state` / `events` message restores 「● 연결됨」 (`markAlive`). Browser back: in a room the
  app keeps one extra history entry (`history.state.jinseiRoom`) — the first Back stays in the game with a toast 「한 번 더 누르면 페이지를
  떠나요…」, a second Back within 3 s leaves (the room stays saved → forward / return resumes); `pageshow` from the bfcache reopens the
  stream; leaving a room drops the guard entry.
- Admin: 「시대 길이(칸)」 (was 시대별 턴 수) + 「총 N칸 · 예상 약 M분 (캐릭터 K명 기준)」 (19.5 s per character turn, 5.5 칸 per turn).

## Post-simulation fixes (server)
Source: `docs/playtest-report.md` (A, B, D). Tests: `test/fixes-playtest.test.js` (+ updated expectations elsewhere, read from
the data files) and the MC sibling test in `test/mc.test.js`.
- **Side bets hold the stake (A11)**: `placeBet` moves the stake out of cash at once (`moneyChanged {reason: 'betStake',
  delta: −amount}`; replacing a bet moves only the difference, `betRefund` when it shrinks; affordability = cash + the held
  stake). Resolution: a win pays stake + winnings (`moneyChanged reason 'bet'`, delta = stake + `betWinDelta`), a loss pays
  nothing (no moneyChanged). `betResolved.results[]` keep `delta` = the NET result (win: winnings, loss: −stake) and add
  `stake`, `paid`. Bets get `staked: true` (saves from before settle the old net way). Void → refund (`betRefund`): admin
  skip, `pruneBets` of an unresolved old slot, `gameOver`, admin force end (`endGame`, silent, `refunded: true`). EV rules
  unchanged. Finished characters cannot bet (409 "골인한 캐릭터는 훈수 베팅을 할 수 없어요.").
- **Finished characters (A12/A13)**: `gift` refuses a finished sender (409 "골인한 캐릭터는 선물을 보낼 수 없어요.") or
  receiver (409 "이미 골인한 캐릭터에게는 선물할 수 없어요."); `groupGift` (생일 파티) invites only unfinished others
  (`giftGuests`) and, with nobody left, never opens a prompt (a log line instead).
- **Action lookup (A17)**: engine `HANDLERS` and prompts `PROMPTS` are null-prototype; a non-string / `toString` /
  `__proto__` action type → 400.
- **Names (A10)**: `lobby.cleanName` (players, characters, CPU names): NFC, strips Cc / Cf (ZWSP…RLM, LRE…RLO, LRI…PDI, word
  joiner, BOM, soft hyphen, tag chars) and the blank Hangul / braille fillers; a ZWJ survives only inside an emoji sequence;
  collapses whitespace; empty → refused; length = grapheme clusters (`graphemeCount`, Intl.Segmenter) ≤ `NAME_MAX` 12, plus a
  `NAME_MAX_UNITS` 64 UTF-16 guard (zalgo). The client counter can count graphemes only.
- **Korean particles (A16)**: `server/game/korean.js` (`hasBatchim`, `particle`, `josa`, `fixParticle`; effects.js re-exports).
  No server text writes 이(가)/을(를)/은(는)/(으)로 after a value (lobby / shop / lawyer / pledge logs use `particle`).
  `presentation.fillLine` fixes the particle written after a placeholder for the inserted value ("{name}이 왔다" → "뚱이가
  왔다", copula "{name}이다" → "뚱이다", "{era}는" → "청년은"); unknown finals (Latin, emoji) keep the template's particle.
  Spelling 「프러포즈」 everywhere (data, code, tests).
- **Line repetition (report C4)**: `presentationFor` returns `bland`: `turnStarted / spun / moved / log`, `moneyChanged` below
  `BIG_GAIN` (100) except pension / gift / goalPrize / bonusSpin / bet / exam, and the betStake / betRefund moves → `line:
  null` ('always'); plain money / loss landings below `BIG_GAIN` and uneventful landings (generic tags) speak only
  `BLAND_LINE_CHANCE` 25 % of the time (sub-RNG, 'rare'). `lineTag` stays set. `pickLine(lines, tag, seed, vars, history)`
  skips a pool entry picked within the room's last `LINE_HISTORY` 20 picks (next unused entry from the seeded start, else the
  least recently used); `room.lineHistory` (`tag#index`, engine-only, never in `viewFor`) is shared by event lines and row
  lines (holiday / lotto / schoolMeet / market / appraisal / award rows).
- **Balance (B1–B10, verified with the sim1 harness in the session scratchpad `sim1/`, `outA|outB|outC/`)** — data:
  houses value = price × 1.05 (315 / 735 / 1260 / 1890 / 3150), 제주 별장 2000, `market.max` 1.3; `goalPrizes [60,50,45,40,35,
  30,25,20]`, `bonusSpinUnit` 2 (global: the lifetime bias stayed in range, no per-mode table needed); holidays only in
  `["middle", "middle_age"]`, kids-era sebae all `[30, 80]`; `partners.birth.perSpin` 0.15, `children.allowance` 50,
  `examGift` genius 60 / college 20, **`costs.weddingGift` 10 and `children.dolGift` 5** (beyond the report: the listed
  B4 changes alone left young love at 29 %); `jobs.salaryEraMult.middle_age` 1.2; military `pay` 0 / `strGain` 1; overtime
  `salaryShare` 0.5 / `exp` 0, `examBonus` 0.2; awards landlord / treasure_king bonus 80; hidden jobs astronaut 8/8,
  national_mc charm 8, trot_star 7/7, mountain_spirit wishes 2. Board: `routePools.<route>.eraOverrides.<era>.<tileType> =
  {weight?, scale?}` merged by `board.routePool(bd, route, eraId)` (used by `buildBoard`): career young money weight 2 /
  scale 1.8, career middle_age salary weight 3, love middle_age salary weight 4 (keys starting with `_` are comments).
  Code: 기초연금 by `engine.pensionWorth(c, data)` (cash − debt + house + item resale); CPU route score (money relative to
  the room's average cash, love = charm + partner / family value, career salary capped) and cautious reserve 300.
  Kids habits never make debt: fees capped at cash (option `cost` = what is charged, `basePrice` when capped, desc 「무료
  (부모님 찬스)」 when broke), 뽑기 losses capped at cash. `scripts/simulate.js` prints route results relative to the same
  game (`byRouteRel`); its random policy never bets / gifts with finished characters.
- **Measured before → after** (4 CPUs unless noted; fair share 25 %): random route assignment (routeRandom4, 2000, seeds 1 /
  2) young love / career / money 30.4 / 19.8 / 25.1 → 26.4 / 24.0 / 24.7 and 26.5 / 24.7 / 23.9, middle_age 24.0 / 27.3 /
  24.0 → 24.3 / 26.0 / 24.8 and 24.1 / 26.0 / 24.9; 1-probe + 3 CPU (600 × seed 3, final CPU) houseNever 14.2 → 16.5 (1200 ×
  seed 4: 19.5), overtimeOnly 28.8 → 24.2, promotionOnly 25.0 → 22.5, routeLove / Career / Money 28.7 / 22.5 / 24.8 → 22.5 /
  24.0 / 24.5, neverMarry 20.3 → 17.5, militaryNow / Avoid 27.0 / 25.7 → 23.5 / 22.3, random 12.0 → 17.7 (±3.4 at 95 %);
  pension recipients who win 29.8 → 16.7 % (8 CPUs 16.4 → 6.7 %, fair 12.5); kids-mode seats 40.2 / 28.3 / 18.9 / 15.2 →
  28.3 / 27.9 / 23.4 / 21.7; lifetime 8-character bias (`--bias --games 2000 --seed 1`) 11.3–13.8 % (spread −0.05) → 11.3–13.2 %
  (spread 0.13); boy / girl 27.4 / 22.6 → 25.2 / 24.8 (8 CPUs 12.4 / 12.6); hidden job held 1.2 → 3.1 % (simulate random
  1.2 → 2.1 %, `--policy cpu` 4.6 → 7.6 %); decisions per character 13.8 → 11.8 (simulate lifetime 15.75 → 13.44, holiday
  3.97 → 2.00); spins per game unchanged (lifetime 78.1 → 78.0); CPU vs random: `cpu-game` 4 + 4 × 300 CPU wins 56.3 → 67.7 %,
  mixed8 CPU / random 14.8 / 10.3 → 15.9 / 9.2 %; CPU young route money / career / love 78 / 13 / 8 → 44 / 17 / 40 %,
  middle_age career 82 → 68 %.
- **Ops (D)**: `RoomStore({finishedRoomTtlMs = FINISHED_ROOM_TTL_MS 3 days, lobbyRoomTtlMs = LOBBY_ROOM_TTL_MS 7 days})`
  (≤ 0 = keep; env `FINISHED_ROOM_TTL_MS` / `LOBBY_ROOM_TTL_MS` via `config.envMs`): `roomExpiresAt(room)` (finished:
  `finishedAt` + TTL; lobby: last of updatedAt / createdAt / players' lastSeen + TTL; playing: null), `pruneRooms(now)` (→
  `deleteRoom`, SSE `deleted`, save file removed), `pruneAll` = rooms then sessions (at `load()` and hourly via
  `startPruning`), `onRoomDeleted(fn)` (the GameRunner drops that room's deadline + CPU timers). Admin `GET /admin/api/rooms`
  rows and `GET /admin/api/rooms/:id` carry `expiresAt` (ms | null). `trust proxy`: env `TRUST_PROXY` →
  `config.parseTrustProxy` (off by default; `1`, `loopback`, CIDR list, `true`) → `createApp({trustProxy})` →
  `app.set('trust proxy', …)` so `clientIp(req)` = the forwarded client for the rate limits (README documents it).
- **MC siblings (user correction)**: 호야 = boy, older brother; 봄이 = girl, younger sister (see the MC section). All MC pools
  were rewritten accordingly (no 누나 / 형아 / 호야 씨).

## Roulette skill mode (룰렛 실력 모드)
- Room config `rouletteMode: 'random' | 'skill'` (`ROULETTE_MODES`, default random, 400 "룰렛 방식은 완전 랜덤(random) 또는 실력 모드(skill)
  중 하나여야 합니다."); admin form 「룰렛: 완전 랜덤 / 실력 모드 (흔들기·타이밍)」 (sent only when skill) + room detail line; lobby
  `modeLabel` appends 「🎯 룰렛 실력 모드」. `/api/meta.balance.roulette` = `balance.json.roulette` {`skill.jitter`,
  `cpu.aimNoise`}.
- Pure rules `public/js/shared/roulette.js` (no imports; `server/game/roulette.js` = `export *` re-export): `isSkillRoom`, `parseTarget`
  (int 1..10 or digit string, else null), `jitterTable(jitter)` (`{"<|offset|>": share}` → signed offsets 0, −1, +1, −2, +2 with ± halves,
  normalized; invalid → `DEFAULT_JITTER` 50/40/10), `reflect` (0 → 2, 11 → 9), `skillValueFor(t, r)` / `skillValue(rng, t)` (ONE
  `rng.next()`), `skillDistribution(t)` (exact, CPU + tests).
- Engine `doSpin`: `spin {characterId, target, input}` — in a skill room, unless the actor is admin (forceSpin) or the system auto spin
  (turn timer), a valid target (ANY number 1..10, every turn) →
  `skillValue` for the first roll; spin mods / 경차 / military halving apply after it (a taxi / noise SECOND roll stays random; the bonus spin
  after the goal is random). Missing / invalid target = a plain random spin (old clients), random rooms ignore it (same RNG draw).
  `spun` + `turn.lastSpin` gain `{target, input? ('shake'|'gauge'|'cpu', `ROULETTE_INPUTS`), skill: true}`; log
  「🎡 ○○의 룰렛: 🎯 목표 7 → 결과 8[ 명중!]」 (first roll). `placeBet` → 409 "실력 모드에서는 훈수 베팅이 없어요." before anything else.
  Route `POST /api/rooms/:id/actions` passes `target` + `input` (string).
- Presentation (`spun`): exact hit (first roll) → `lineTag aim_hit` + line, |miss| ≥ 2 → `aim_miss` + line (placeholder `{aim}` added to
  `lines.json.placeholders`), else the bland `spin` tag (no line). No new event types.
- **No number deck (user decision, 「덱모드 삭제」)**: there used to be a per-character number deck (`character.aimUsed`: a used number
  snapped to the nearest free one until all ten were used, `spun.wanted`, greyed cells, `balance.roulette.skill.deck`). It was removed
  completely — any number 1..10 can be aimed at every turn, no used-number tracking; a leftover `aimUsed` in an old save is ignored.
- **Known consequence — low-number aiming was strong (fixed by the loop maps: always-1 11–13 %, see "Loop maps — server")**: every landing pays on average, so aiming small = more tiles stepped on. Measured
  without the deck (`node scripts/simulate.js --aim-duel --games 400`, 8-character lifetime, CPU decisions, only the aim differs, fair
  12.5 %), seeds 1 / 2: **always-1 55.3 / 53.9 %** 1st place (avg rank 1.83 / 1.84, +89 / +82 % total vs the game mean, 33.9 spins vs ~12,
  goal place 7.6 — the game drags for them), CPU aim 5.5 / 7.7 %, random aim 1.1 / 0.3 %, always-10 0.0 / 0.2 % (reaches the goal first,
  1.4th, but poor), no target (plain roulette) 0.8 / 0.6 %. Hit rate 50–52 %. Jitter cannot fix it (it doesn't change the mean); the old
  deck brought always-1 down to ~9 % and CPU aim to ~25 %. The CPU heuristic (expected worth + `aimSpeed`) does not exploit this.
  Jitter stays 50/40/10 (`balance.roulette.skill.jitter`).
- CPU (`cpu.js`): `cpuSpinAction` (skill rooms → `{target: cpuSkillTarget, input: 'cpu'}`), `cpuAimScores(room, charId)` = expected worth per
  target under the jitter: `landingFor` mirrors the engine (plus / minus mods, 경차, military halving, stops / goal halt) × `aimTileWorth`
  (tileWorth + heart / house / shop / jeju / reversal / merge) with losses × `lossAversion` + `aimSpeed` per tile moved (PERSONALITY:
  cautious 1 / 1.5, normal 2 / 1.2, bold 4 / 0.8); best of all ten numbers (ties → bigger), then `balance.roulette.cpu.aimNoise[personality]`
  (cautious 0, normal 0.25, bold 0.5) chance of ±1 from the hashed sub-RNG (`subRng(…, 'aim')`) — the game RNG is never consumed.
- Client pure `public/js/ui/rouletteSkill.js` (node-tested, `test/client-roulette.test.js`): `INPUT_KEY` `jinsei.rouletteInput`,
  `detectShakeEnv(win)` {hasMotion, secure (`isSecureContext`), needsPermission (iOS `DeviceMotionEvent.requestPermission`), coarse},
  `shakeSupport(env, permission)` → {ok, needsPermission, reason} (「흔들기는 HTTPS 주소에서만 돼요 · 버튼으로 해요」 / 「이 기기는 흔들기를 지원하지
  않아요 · 버튼으로 해요」 / 「흔들기 권한이 거부됐어요 · 버튼으로 해요」), `defaultInput(stored, env)` (shake only on coarse-pointer devices
  unless chosen), `motionMagnitude(ev)` (`acceleration`, else |accelerationIncludingGravity| − g), `accelToTarget(a)` (`SHAKE` aMin 3 → 1,
  aMax 28 → 10, gamma 0.8), `createShakeMeter()` (EMA α 0.35, starts at 3 m/s², score = 0.6 peak + 0.4 avg, done after 300 ms still or
  1.5 s), `gaugePosition(ms)` (ping-pong, 1100 ms per sweep, ×0.9 per sweep from the 4th, ≥ 650 ms), `gaugeTarget(pos)`, `aimText` (「🎯 목표 7 →
  결과 8」/「… 명중!」, first roll), `aimShort`, `aimGrade`, `jitterHint`, `load/saveInputPref`, `DEADLINE_WARN_MS` 5000.
- `public/js/ui/skillPanel.js` `createSkillPanel(host, {onAim, getMeta, now})` → `open({charId, name, deadlineAt})`, `close`,
  `update`, `isOpen`, `charId`, `input`: fixed sheet `.skill-panel` (z 23, above cut-ins, under inbox / reaction bar / toasts), tabs 📱 흔들기 /
  👆 버튼으로 (saved), gauge (rAF needle over 10 cells, all always enabled, 「✋ 멈춰!」, Space / Enter via a capture keydown listener
  — not the 700 ms prompt guard), shake (「📱 흔들기 켜기」 once when iOS needs permission, live 1..10 meter, tutorial line, "no sensor"
  hint after 1.5 s without samples), result flash 「🎯 7!」, ⏰ warning under 5 s of the turn timer, Escape /
  ✕ closes. `body.skill-open` hides the floating spin button. `?debug=1` → `window.__skill`.
- game2d: `spinNow()` (dock button, floating button, 3D roulette tap) opens the panel in skill rooms (else the plain spin); the panel closes
  when it's no longer my roulette, `update` keeps the deadline fresh; dock text 「🎯 ○○ 룰렛 돌리기」 + hint 「🎯 흔들기나 버튼으로 목표 숫자를
  정해요」 / 「…룰렛을 🎯 조준하는 중…」; bet card never opens in skill rooms; last-spin line shows `aimText`; `spun` feedback: side float
  `aimShort` (everyone), my own 2D spins also toast `aimText`; 2D roulette pop shows 「🎯 목표 N」 and the result line (1.7 s). board3d
  `spun`: subtitle 「🎯 ○○의 룰렛! 목표 N」, then `banner(aimText)` + `emotion.pop(aimShort)`; new hook `hooks.onSpinResult(e)` once the
  wheel stopped (or at once when the step is instant) → game2d toasts my own 🎯 result (my prompt cut-in usually covers the board by then). CSS `public/css/roulette.css`.
- Scripts: `simulate.js --roulette skill` (random-policy characters aim at a uniform random number = an average human, CPU policy aims;
  no bets; prints hit / ±1 / ±2 shares + landings per policy), `--bias --roulette skill [--aim random|cpu]` (`simulateBias({roulette,
  aim})`), `--aim-duel --games N --seed S` (`simulateAim({games, seed, strategies: cpu|random|max|min|none, data})`), `cpu-game.js
  --roulette skill` (`playCpuGame({roulette})`). Measured (with the former number deck): bias 2000 × seed 1 random aim 12.0–13.1 % (spread −0.06), 1000 × seed 1 CPU aim
  11.4–13.7 % (spread 0.12); `cpu-game` 4 CPU + 4 random × 300 (seed 1): CPU wins 67.7 % random mode → 82.0 % skill mode (random-aiming
  humans; avg total 1651 → 2068 vs 1439 → 1475); `simulate --games 300 --seed 11` random vs skill: route 1st-place shares stay fair
  (young 21.1 / 20.8 / 18.4 → 19.7 / 21.6 / 18.4 %, fair ≈ 20), raw route gaps young 3.3 → 5.7 %, middle_age 12.0 → 10.9 %; lifetime
  78.0 → 78.9 spins. (The `같은 판 평균 대비` relative line is dominated by games whose mean total is near 0 — use the raw gaps / shares.)
- Tests: `test/roulette-skill.test.js` (config, jitter table + reflection + seeded 12k samples per target, no deck helpers / field, engine spins incl.
  the same target twice in a row / leftover `aimUsed` ignored / log / lastSpin, 160 seeded spins through applyAction, invalid / random / auto / admin, bets 409, presentation tags, CPU target on a
  crafted board + legality + RNG untouched, HTTP spin + meta + admin), `test/client-roulette.test.js`. E2E: session scratchpad
  `skill/e2e.cjs` (screenshots `skill-*.png`); deck removal check `nodeck/e2e.cjs` (2D desktop, 3 own turns: all 10 cells enabled, the same target kept, 0 console errors).

## Loop maps (원작식 순환 맵) — server
Contract: session scratchpad `loop-contract.md` (+ ADDENDUM A, which wins); deviations in `loop-deviations.md`. Tests:
`test/loop-board.test.js` (+ rewritten `test/board.test.js`, era / goal-race cases in `test/engine.test.js`). Roadmap row 11 in
`docs/PLAN.md`.
- Eras are turn-limited: every character spins `era.turns` times per era (defaults `eras.json` baby / elem / middle / high 3,
  young / middle_age 15, senior 6 — the final era's turns are ignored), then EVERYONE moves together (`room.eraIndex`,
  `turn.eraRound` 1..`turn.eraTurns`). `endTurn`: when the order wraps and `eraRound ≥ eraTurns` → `eraTransition` (or
  `gameOver` after the last era of a mode without a final race, i.e. kids). Skipped turns (재수 / 고향 휴식 / 산사 수련) still
  consume rounds.
- Map (`board.js`): `loopConfig()` = `board.json.loop`; `lapSize(turns)` = clamp(round(turns × 5.4), 18, 100) (15 turns → 81, 3 → 18);
  `tiles[0]` = `start`; `paydayCount(lap)` / `placePaydays` = forced-stop `salary` tiles every 18–25 tiles on every lap path (each
  route and across the wrap; laps that cannot be split use the nearest count: ≤ 27 → 1, 32 → 2); `placePasses` = round(lap / 27)
  (2–4) `pass` tiles (찬스 광장), never next to a payday; blocked slots = start, fork ± 1, merge ± 1. Route eras (young /
  middle_age): `fork` (a `stop` with `promptId: 'routeChoice'`) and `rejoin` (`merge`) inside the ring, three equal route tracks
  (≈ 40–50 % of the lap) that carry their paydays / passes at the same indexes. `nextPosition` wraps (`wrapsAt`), `lapPositions`,
  `eraPathLength` = lap (or the final length), `HALT_TYPES` salary / stop / goal. Tile pools: no `salary` / `shop` in pools.
- Final era (lifetime / adult: `eras.json.modes.<mode>.finalEra` senior; `finalEra` absent = no race): `buildFinalTrack` = linear
  `config.finalLength` tiles (20–80, default 40, `/api/meta.finalLength`), start → goal, paydays from the start every 18–25 (the last
  ≥ `paydayTail` 7 before the goal), trouble (`loss` × `troubleScale` 1.5) only at 3 spots (before the last payday, 5 after it, just
  before the goal), 2–3 `reversal` (인생역전섬), events filtered to good ones, no pass / shop. Goal order, `goalPrizes`, bonus spins
  only here; `turn.eraRound/eraTurns` null; the game ends when everyone finished. Without a race (kids) places = final ranking
  (`result.hasGoalRace`, awards / titles skip goal-place facts).
- Turn loop (`continueTurn`): pending prompt → resume a paused move (`turn.move`) → era openings (lotto / 명절) → `announceTurn`
  (`turnStarted {eraRound, eraTurns, eraIndex}`) → `preSpinStep` (중학생 `club` on the first middle turn, 고교 첫 만남 `meet` on the
  first high turn, 수능 on the last high turn (`examDue`), `careerStep` = 전역 / 졸업 / 진로 / 군 / 취업) → roulette → `walk` →
  `lifeStep` (careerStep, a missed 수능, `routeChoice` when standing on the fork, hidden jobs, 프러포즈) → `endTurn`. Internal flags
  `turn.announce`, `turn.spun`.
- `walk`: counts laps (`c.laps`, `moved.wrapped/laps`, log), reaching the merge ends the route (`c.route = null`, routeHistory
  completed), stops on HALT tiles; passing a `pass` with steps left pauses the move (`turn.move = {charId, remaining, tileId}`, the
  prompt opens, then `moved {resumed: true}` continues). Landing: `resolveTile(tx, c, tile, {onGoal})` — `salary` → `jobs.payday`
  (job salary + spouse + 용돈; kids = `balance.salary.pocketMoney[era]` → `salary {jobId: null, rank: 0, pocket: true}` + 동아리
  training), `start` nothing, `pass` → the 찬스 광장 prompt too.
- 찬스 광장 (`passTile.js`, prompt `passTile`, resultCutin true; always opens — landing or passing): options `wish {cost, price, chance,
  money}` (offering × `passTile.scale[era]`, chance base 0.3 + 0.04 × 운 ∈ [0.1, 0.7] → 운 +1 + money, `wishes` +1), `wishAll {cost,
  price, gift, others}` (offering, every other unfinished character gets `gift` × scale, 운 +1, `wishes` +1), `buy {price, offers}`
  (→ the `shop` prompt with those offers; disabled when nothing is affordable), `jobChange {jobId, salary, requires}` (one eligible
  other job, adult job eras; disabled with a Korean reason otherwise) and `pass {buff}` (default). The buff is rolled when the prompt
  opens (`balance.chanceBuffs` weights salaryX2 4 / moneyX15 3 / lossShield 3 / statUp 2) and becomes `character.chanceBuff` until the
  next 찬스 광장 (expired first: `chanceBuff {charId, buff, action: 'expired'}`, gained: `action: 'gained'`). Effects via
  `effects.hasBuff`: paydays ×2 (`salary.buff`), money tiles / good events ×1.5, `applyLoss` halves, stat gains +1.
- Final race 인생역전섬: `reversal` adds `allIn` (→ prompt `allIn`, options '1'..'10', ALWAYS a plain random draw, hit → cash ×
  `submaps.reversal.allIn.mult` 7, miss → cash 0 + retired bust = the last free place, no prize) and `retire` (→ the next free place,
  prize × `retirePrizeMult` 0.5, no more turns / bonus spins). `finish.js` `nextPlace` / `finishCharacter(tx, c, {retired})` →
  `finished {place, prize, retired?: 'early' | 'bust'}` (`character.retired`).
- Era transition (`eraTransition`): `eraTransition {fromEraId, toEraId, eraIndex, turns, lap, final?, length?, eraName}` (cut-in anchor,
  MC studio `eraSituations`) → `eraChanged {era, eraId, from}` per character (`cutin: false`, bland) → news → 기초연금 (all bottomN at
  once, `grantPensions`) → 고교 첫 만남 recap (leaving high) → 노년 시세 → per character news statBonus + children / 용돈 / affection →
  queued lotto + 명절. Positions reset to `startPosition(eraIndex)` (index 0), `c.route = null`.
- Kids eras (A3): `balance.clubs` (5 clubs: joining stat +1, a training stat +1 on middle / high paydays, related jobs × `jobBonus` 1.5
  in `offerWeight`), events `school_trip` / `sports_day`, 고교 첫 만남 = per-character `meet` prompt (★1 school candidates,
  `met {school: true}`), then one `schoolMeet {summary: true}` recap.
- Migration: `migrateLoopBoard(room)` (called by `applyAction` and `GameRunner.restore()` for playing rooms whose board isn't
  loop-shaped): board rebuilt from `room.seed` with the room's eraTurns / finalLength, `eraIndex` = the most advanced character's era,
  everyone at its start (finished characters stay finished / at the goal), `eraRound` 1, a pending `routeChoice` dropped, log
  「🔄 새 순환 맵으로 옮겼어요!…」. Lobby / finished rooms need nothing.
- Balance (data): salaries ≈ ×0.17 of the pre-loop values (jobs.json, e.g. 공무원 30/40/55/75; `jobs.expNeededMult` 3), partner ★
  salaries 30/45/65/85, tile money ×0.3 (kids) / ≈ ×0.18 (adult eras: young 20–70, middle_age 25–110, senior 20–90); route pools
  love heart 6 / money 4 ×1.2 (middle_age ×1.5 via `eraOverrides`), career job 3 / money 2 ×1.0 / loss 2, money route unchanged; `submaps.scale` / event scale adult ×0.5 / ×0.4, `partners.children.growTurns` 6, `birth.perSpin` 0.03,
  `military.turns` 4, `career.collegeTurns` 3; hidden unlocks raised (see Stage 6); titles thresholds + 「여유로운 은퇴러」 / 「빈곤 농장
  주인」 (retired / bust).
- CPU (`cpu.js`): `walkFor` / `expectedLanding` follow HALT tiles and pass tiles, `tileWorth` knows salary (`paydayWorth`) / pass
  (`PASS_WORTH` 35) / goal / start, `progressWorth` in aim scores (final race only); `answerPassTile` (`cpuPassScores`: wish EV,
  wishAll, shop EV, job change by `jobScore`, pass = buff worth), `answerClub` (the target job's stat), `answerAllIn` (any number),
  reversal: `retire` when comfortably ahead of the runner-up (not bold), `allIn` only when far behind the leader within 25 tiles
  of the goal.
- `scripts/simulate.js`: random eraTurns around the defaults (±30 %) + random finalLength; loop block (rounds, laps, paydays per
  character, halt reasons, 찬스 광장 choices per policy, buffs, clubs, allIn / retire, payday share, money flow per reason);
  `--pass-duel` (`simulatePass`, `PASS_STRATEGIES` cpu / always / never / random); aim duel types include pass.
- Measured (final data; old = before the loop maps): spins per lifetime character ≈ 49.6 (game ≈ 258 spins, 53 rounds; old ≈ 15 per
  character / 78 per game), kids 12.9. Decisions per lifetime character 34.1 CPU / 37.2 random (old 13.2 / 13.4; 찬스 광장 10.5 of
  them). Lifetime mean total (seed 11) random 2160 (old 1619), CPU 3178 (old 1713), kids 1168 (old 1159); composition CPU cash 55.0 %
  · house 29.1 · items 2.5 · treasures 5.6 · awards 7.9 (old 67.4 / 19.7 / 0.2 / 3.0 / 9.7). Payday share of income (salary + spouse
  + 용돈) CPU 41.9 %, random 24.2 % excluding side bets (random answers take 찬스 광장 wishes / job changes 75 % of the time and
  land lower jobs). Random route assignment, 4 CPUs × 300 × seeds 1 / 2 (fair 25): young love / career / money 24.8 / 27.4 /
  23.2 and 25.9 / 24.0 / 25.5, middle_age 23.3 / 24.5 / 27.5 and 24.4 / 23.2 / 27.8. `--bias --games 400 --seed 1`: 10.5–14.0 %
  (spread −0.33). Aim duel 150 × seeds 1 / 2: CPU 24.2 / 20.4, random 5.8 / 6.7, always-10 15.0 / 11.7, always-1 11.3 / 13.3,
  none 6.3 / 10.4 (the old always-1 55 % exploit is gone: paydays halt everyone and the era clock caps the spins). `--pass-duel
  --games 80`: CPU 13.1, always pass 14.5, never pass 9.9 %. CPU 찬스 광장 picks: pass 80 %, wish 11 %, buy 6.7 %, wishAll 2.1 %,
  job change 0.1 %. `cpu-game` 4 CPU + 4 random × 100 (seed 1): CPU 87 % of wins (old 67.7 %; more decisions per game).

## Loop maps (원작식 순환 맵) — client
- Contract: session scratchpad `loop-contract.md` (+ ADDENDUM A) / `loop-deviations.md`. The board shows ONLY the shared era
  (`room.eraIndex`); eras are turn-limited (`turn.eraRound` / `turn.eraTurns`); the final 노년 era of lifetime / adult mode is a
  LINEAR goal race (`loop: false, final: true`, no clock, goal order / prizes / bonus spins / `finished` back for that era).
- Pure `public/js/shared/loop.js` (no imports; `test/client-loop.test.js`, fixture `test/client-loopFixture.js` = synthetic loop
  boards, also used by E2E scripts): `loopConfig(meta)` (`meta.board.loop`, fallback 5.4 / 18 / 100) + `lapSize`, `isLoopBoard`,
  `isRaceEra`, `currentEraIndex(room)` (`room.eraIndex`, else the characters' era), `eraClock(room)` → `{index, name, round, turns,
  left, last, final, race}` + `eraClockText` (「청년 7/15턴」 / 「노년 · 골인 경쟁」) + `lastTurnHint`, `forkOf(era)` (server `fork` /
  `rejoin`, else the routeChoice stop), `lapOrder(era, route)`, `tileIdForPosition` (index < 0 → the era's first tile),
  `racetrack(era)` (2D model below), `haltNote(moved)` (💵 월급날! 멈춤 / 🎪 찬스 광장 (남은 n칸) / 🔀 갈림길 / 🚶 이어서 / 🔁 한 바퀴),
  `lapsOf`, `buffText`, `passOptionExtras(pending, option)` (passTile icons; wish badges only without a server `desc`; 「그냥 지나가기」
  shows `option.buff` unless the desc names it), `clubLabel(club, meta)`, `playEstimate` (`SEC_PER_TURN` 15, `LONG_GAME_TURNS` 40).
- 3D layout (`public/js/scene/layout.js`, pure): `layoutBoard(board, {eraIndex})` lays out ONE era. Loop eras: a closed curve per
  era id (`ERA_SHAPES`: baby round blob, elem schoolyard track (superellipse), middle bean, high rounded triangle, young wide race
  track, middle_age egg, senior five-lobed; `eraRing(id, length)` scales the unit shape to lap × spacing), tile 0 on the near side
  walking counter-clockwise on screen (+normal = outwards). Route eras centre the branch zone on the near side: career on the ring,
  love outside (+routeWidth), money inside, equal lengths (ribbons between fork and rejoin). `era.loop === false` → `layoutLinear`
  (open winding road, `closed: false`, `goalId`). Result `{loop, closed, eraIndex, ring (closed dense polyline or the road), origin,
  perimeter, tiles, startId, start, era {id, shape, lap, fork, rejoin, center, bounds, tileIds, routes?}, eras: [era], bounds}`.
  `eraSweepPoints(layout)` = camera tour (once around / start → goal). `planProps`: landmark in the middle of the loop when it fits
  (else behind the far side), scatter on both sides (inside = low props only), a park grid inside, a second belt for small loops,
  mountains far behind; tall props never stand where `shadowPoints` (away from the camera for the default azimuths `VIEW_AZIMUTHS`,
  height × 1.45) would hide the track (`PROP_HEIGHT`). `insideRing`, `lapSlots`.
- `board3d.js`: `setBoard(board, {eraIndex, key?})` (a string = old key) — a new board builds at once (`buildEra`); a new era of the
  same board waits for its `eraTransition` animation (`S.wantEra`; switched in `applyCurrent` once idle when no transition plays).
  `eraTransition` handler = banner → `switchEra`: `.b3-fade` on → dispose + rebuild the static group → every pawn on the start tile →
  fade off → camera tour. `eraChanged` = a ✨ pop only. `moved`: hops follow the path ids (wraps, lanes); `hooks.onStep(moved)` after
  the hop; `halted` → pop + banner (💵 / 🎪 / 🔀), 🔁 pop when passing the start; `resumed` subtitle 「이어서 n칸」. Static board per
  era: one ground plane (era tint), ring strip (+ lanes), instanced tiles (payday / pass / fork / start / goal scaled up), one merged
  marker mesh (payday gold coin ring + sign, 🎪 striped tent, start flag, goal gate), atlas icons with ribbons 「월급날」/「찬스 광장」,
  sprites (era sign at the start, fork / merge, payday labels, goal, route names). Measured (SwiftShader): kids eras 29 calls /
  ≈ 11.7k tris, young / middle_age (81 tiles + lanes) 37 calls / ≈ 25.7k tris, final race 19–21 calls / ≈ 7–8k tris.
  `b3.eraIndex`; `focusEra(i)` only for the shown era. `finished` banner: 골인 / 🏖️ 조기 은퇴 (`retired: 'early'`) / 🌾 빈곤 농장
  (`'bust'`); `bonusSpin` kept for the final race.
- 2D (`game2d.js` `renderTrack` + `public/css/loop.css`): `racetrack(era)` → a hairpin racetrack on a CSS grid (top row →, right
  turn cap, bottom row ←, left cap back to 🚩; a route era puts [fork (3 rows) | 💕/💼/💰 labels | three lanes | rejoin] centred
  in the top row — love above = outside, money below = inside; the final race has no left cap: the goal ends the bottom row).
  Horizontal scroll follows the current pawn; 56–66 px tiles, no page overflow at 390 px. Tabs = life progress (past ✓, current
  「7/15」 or 🏁, later dashed); 2D tabs preview another era's map, 3D only the current one (toast).
- HUD: header `⏳ 7/15턴` chip (+ 「이번 시대 마지막 턴!」 on the last round; the final race 「🏁 골인 경쟁」), spin hint + 3D subtitle
  also warn on the last round; side rows 「🔁 n바퀴」 (lifetime `character.laps`; 0 → 「🚶 첫 바퀴」), 🏁 n등 골인 / 🏖️ / 🌾 in the final
  race, `chanceBuff` badge (`gc-tag buff`, also on the 3D name tag), `club` tag while jobless; detail card 찬스 버프 / 동아리 / 바퀴 수.
- Cut-ins: `planCutins` → ONE `eraTransition` group (anchor always; boundary) with the batch's per-character `eraChanged` (cutin
  false) + their money / stat / log follow-ups folded in (`entrants`, `eraId`, `eraName`); the batch's newsFlash joins its studio.
  game2d: studio (MCs) = the transition cut-in (no second event cut-in), else an era cut-in (cast = entrants, chips ⏳ n턴 · 🗺️ n칸);
  banner 「모두 함께 ○○ 시대로!」. Policy: `eraTransition` big + `involvesMe` for everyone; `isPaydayGroup` (landed salary) → banner
  unless mine and `delta ≥ PAYDAY_BIG` 300; `isPassSkip` (promptResolved passTile passed/left) + `chanceBuff` (lone → banner, else
  `g.buffs` chips) are banners; `pass` in `MINOR_TILE_TYPES`. Prompt looks: passTile (good · shop scene), club (school), allIn
  (casino). passTile options = the generic option list + `passOptionExtras` badges (cut-in and 2D modal); `allIn` (10 number options)
  = a 5 × 2 number pad (`submapArt.allInOptionsHtml`, via `submapOptionsHtml`); reversal `allIn` / `retire` options use the generic
  submap cards (`OPTION_LOOK`), results allInWin / allInLose (big) / retire. Floats: `moved` notes, 💵 용돈날 (`salary.pocket`), buffs.
- Admin: 「시대 길이(턴)」 rows with 「🗺️ n칸 순환」 per era (`lapSize`), 「🏁 노년 길이(칸)」 row (`finalLength`, eras.json
  `limits.finalLength` / `meta.defaults.finalLength`, fallback 20–80 / 40) instead of senior turns in race modes (senior turns not
  sent); estimate = Σ turns + final race (length ÷ 5.5 × 1.3) × characters × 15 s with a ⚠️ long-game note (≥ 40 turns); room
  detail 「노년 골인 경쟁 N칸」. Lobby mode label: 「청년 15턴 / … / 노년 🏁 40칸」. Result rows name 골인 보너스 / n번째 골인 only when
  there was a goal prize. Skill panel: 「💡 큰 숫자일수록 멀리 가서 💵 월급날·🎪 찬스 광장을 더 자주 만나요.」
- E2E (session scratchpad `loopb/`): `inject.cjs` (synthetic loop board injected into a real room: every era in 3D 1280 + 2D 390,
  young last round with lane pawns, wrap + pass pause + passTile prompt + resume + payday stop, the era transition, final race,
  admin form) and `game.cjs` (natural lifetime game on the loop engine: 1280 3D + 390 2D + 2 CPUs through every era, pass prompts,
  paydays, forks, the goal race and the result; 0 console errors, no 390 overflow). Screenshots `loopb-*.png`.

## Blue / red cards — server
Contract: session scratchpad `cards-contract.md` (FIXED CONTRACT) + `cards-deviations.md`. Tests: `test/cards-bluered.test.js`
(+ updated stage6-jobs / stage7-cards / stage7-social / presentation / cpu-server / assets-manifest). Roadmap row 12 in `docs/PLAN.md`.
- Data: every `cards.json` card has `color` blue | red; kinds `instant` / `sabotage` / `passive` (red; passive = auto one-shot) +
  `held` / `merit` / `status` (blue). `handLimit` 6. New ids: held `marriage_luck` 결혼운◎ (`affectionBonus` 5, `hold.until: 'married'`),
  `popular` 인기 폭발◎ (`starChance` 0.5 / `match` / `dateGain` 2, until married), requirement cards `research` 🔬 / `charisma` 🎤 /
  `tongue` 👅 / `iron_body` 🦾 (`effect.requirement`), `health_charm` 🧿 (`noInjury`), `salary_charm` 💴 (`salaryBonus` 0.1), `merit` 🏅
  (weight 0), red `big_roll` [6,10] / `small_roll` [1,5] (`effect.range`), `exact_roll` (`exact`), `payday_rush` (`rush: 'salary'`),
  status `injury` 🤕 (color blue, price / weight 0). Manifest `card-<id>` items for all of them (todo).
- `cards.js`: `CARD_COLORS`, `CARD_KINDS`, `PLAYABLE_KINDS`, `REQUIREMENT_CARDS`, `ROLL_CARDS`, `cardColor`, `cardCount`, `meritCount`,
  `transferable` (all but status), `discardIndex` (full hand: oldest red → oldest non-requirement blue → oldest requirement card; never
  the injury card; `cardLost {reason: 'discarded'}` + the old `cardGained.discarded`), `loseCard(tx, c, id, reason, {count, all})`,
  `dropHeldCards(tx, c, 'married')` (called by family `marry`), `syncInjuryCard` (the 🤕 card mirrors `job.injured`: rollInjury adds it,
  `spinSteps` removes it when the countdown hits 0, `hire` / the `heal` event clear it; `applyAction` silently adds it to old saves),
  `clubCardRoll`, `affectionBonus` / `popularEffect` / `salaryCharmMult` / `injuryProof`, `drawableCards` (weight > 0, no merit /
  status), `rollPlan` / `spinFixed`, `rushDistance(room, c)` (tiles to the next payday on the path; null when the fork / goal comes
  first or no payday is left), `cardBlockReason(room, c, def, data)` (shared by useCard, simulators, CPU). `cardGained` gains `color`
  and sources `club | graduation | job | status | start`; new event `cardLost {charId, cardId, uid, reason: married|healed|discarded|
  merit}` (EVENT_TYPES; chip, never a line). Trades / gifts refuse the injury card (409); blue cards trade / gift like any card.
- useCard: blue / merit / status → 409; `exact_roll` needs `value` 1..10 (digit string OK; route passes `body.value`) → 400; roulette
  cards push spin mods `{kind: 'range', min, max}` / `{kind: 'exact', value}` / `{kind: 'rush'}`; a card-fixed spin refunds side bets
  already placed on the turn and refuses new ones (409). doSpin: exact = the number (no draw, no aim, no taxi / noise second roll),
  range = `rng.int(lo, hi)` (skill rooms: the aimed result clamped; a second roll stays in range), rush = `walk(…, {rush})` straight to
  the payday (no military halving, 찬스 광장 not paused), `spun.rush` / `moved.rush`, log notes.
- Held effects: 결혼운◎ via family `gainAffection(tx, c, gain, {set})` (every affection gain incl. the starting one; date options show
  the card bonuses in `gain`), 인기 폭발◎ `popularize` (meet prompt / 소개팅 candidates: ★+1 chance for non-school candidates, one
  찰떡궁합 guaranteed), 월급 부적 in `salaryAmount`, 건강기원 부적 cancels an injury roll (log only; the one-shot 🧧 amulet stays).
- Requirement cards (mandatory): `jobs.json requires.cards` (doctor / researcher research, politician / idol charisma, chef tongue,
  baseball / soccer / fighter iron_body) checked by `meetsRequirements` (hiring, job tile / 찬스 광장 job change), national_mc
  `unlock.cards`; `missingJobCards`, `jobCardRequirements`. Sources: graduation (`growth.grantSkillCard`: best stat →
  `balance.cardSources.statCards`, next best when held), adult-mode graduates at the start (source 'start'), clubs (`clubs.options[].card`
  + `clubs.cardChance` join 0.5 / train 0.35), events (`card` + `conditions.lacksCard`), card tiles / shop / 찬스 광장 buy (weight 3).
  Offer weight +`offerWeight.card` 2 for (eligible) card jobs.
- Merit: `rankUp.merit` (doctor 1, politician 2, idol 1, actor 1, office_worker 1) — `tryRankUp` returns `'noMerit'` without enough 🏅
  cards, consumes them on success (`cardLost merit`); jobTile `promotion` is `disabled` + `merit` / `merits` fields then (default = first
  enabled option). Earned only at those jobs (`balance.jobs.merit`: paydayChance 0.2, overtimeChance 0.35, +1 on a passed promotion exam
  below max rank; bonus off) and from events (`project_win` for merit jobs, `crisis_save` any job).
- Events.json: `conditions.injured`, `conditions.lacksCard`, `heal: true` (`rehab`); 14 new events (card rewards, merit, heal).
  `/api/meta.balance` adds `cardSources` and `merit`.
- CPU: `cardValue(data, c, id, room?)` values blue cards (`blueWorth`: wanted requirement card 130 while jobless, 부적 by injury risk,
  월급 부적 by salary, romance cards while unmarried, merit for merit jobs); `jobDeficit` +2 per missing requirement card; plays only
  red cards (`cardBlockReason`); `rollCardChoice` = expected landing worth (tile + 찬스 광장 + aimSpeed × progress, losses ×
  lossAversion) of 딱 그 칸 (best number) / 큰 수 / 작은 수 / 월급날 직행 vs the plain roulette (skill rooms: its aim), thresholds 40 /
  20 / 30; trade answers use the discard slot of `discardIndex`.
- Simulator block 「파랑/빨강 카드」. Measured (seed 11 × 300; before → after): random policy — requirement-card jobs doctor 2.7 → 1.8 %,
  researcher 2.6 → 2.4, politician 2.3 → 1.4, idol 6.8 → 3.8, chef 4.8 → 1.6, baseball 5.0 → 2.2, soccer 4.0 → 3.3, fighter 3.7 → 2.2,
  national_mc 0.9 → 0.1; top job 8.9 → 11.1 % (e스포츠), 알바 0 %; CPU policy top job 의사 8.9 → 11.2 %, chef 2.0 → 0.1 %. Cards gained
  per character random 3.41 → 4.98 (blue 2.16 / red 2.72), CPU 2.73 → 4.34 (2.10 / 2.17); end-of-game hand blue 1.52 · merit 0.26 · red
  0.44. Roulette cards (random / CPU uses): big 153 / 112, small 150 / 20, exact 60 / 34, rush 40 / 54 per 300 games; payday arrival
  plain 21 % · big 36 / 30 % · small 17 / 25 % · exact 27 / 21 % · rush 100 %. Injury cards 154 (random) / 128 (CPU) (injuries before
  221 / 194 — 건강기원 부적), 0–1.9 % of injuries hit a full hand. Merit gained / spent random 620 / 154, CPU 1074 / 560. First hires
  holding a requirement card 70 % (CPU 74 %). 1st place among adult-era characters holding a requirement card 20.5 % (fair 19.1) vs
  without 15.0 % (fair 19.2); CPU 19.8 vs 15.7. Aim duel 150 × seed 1: CPU 24.2 → 23.8, random 5.8 → 6.7, max 15.0 → 14.6, min 11.3 →
  10.8, none 6.3 → 7.1. Pass duel 80: cpu 13.1 → 11.7, always 14.5 → 13.6, never 9.9 → 12.2. Bias 400 × seed 1: 10.5–14.0 % (spread
  −0.33) → 9.5–14.5 % (0.04). `cpu-game` 4 + 4 × 100: CPU wins 87 → 90 %; mixed 86.7 → 84.7 %. Lifetime spins unchanged (49.0).

## Blue / red cards — client
- Contract: session scratchpad `cards-contract.md` (FIXED CONTRACT) + `cards-deviations.md`. Tests: `test/client-bluered.test.js`
  (+ updated `client-cards` / `client-growth`). E2E: session scratchpad `cardsb/` (`inject.cjs`, `game.cjs`; screenshots `cardsb-*.png`).
- Pure `public/js/shared/cards.js`: `CARD_COLORS` blue 「보유」 / red 「사용」 / status 「부상」; `CARD_KINDS` instant · sabotage · passive (red,
  passive = 「자동」) · held · merit (blue) · status (grey) with `colorId`. `cardInfo` adds `color` (`cardColor`: kind status always
  status — the server sends the injury card `color: 'blue'`), `tag` (`cardTag`), `auto`, `needsValue` (딱 그 칸), `rush` (월급날
  직행); `DEFAULT_CARDS` knows every new id (fallback names / icons); `DEFAULT_HAND_LIMIT` 6. `cardKindLabel`, `cardEffectText`
  (보유 효과 · `hold.until` / 사용 효과 / 자동 / 부상 / 공적 text for the sheet). Hand: `sortHand` (status → held → merit → instant →
  sabotage → auto), `handStacks` (🏅 merit cards of one id → one entry `{count, uids}`), `heldCards` (side-list icon row),
  `meritCount`, `statusCards`, `hasCard`. `cardPlayability` → `{playable, reason, needsTarget, needsValue, kind, color}`: blue /
  merit / status / auto never; 월급날 직행 refused when `paydayAhead` is false (= `nextHaltTile` — the next
  salary / stop / goal on the path: route track → rejoin → ring (wraps), the final race stops at the goal — is not a payday, the
  server's 409). `useCardBody(char, card, {targetId, value})` → the `useCard` action (`value` 1..10 via `exactValue`).
  `tradableCards` = every card but the status card (blue held + 🏅 merit trade and gift; server deviation); `validateTrade` /
  `validateGift` take `{meta}` and refuse the injury card. Spin mods: `modRange` (`{min, max}` | `range: [a, b]` | `card` /
  `value` big|small), `modExact`; `spinModBadges` + 🔼6–10 / 🔽1–5 / 🎯n / 💨월급날; `rollConstraint(spinMods)` → `{min, max, exact,
  rush, text, short}` (rush > exact > range) for the dock hint / skill panel / bet card; `spinNote` knows `range` (「🔼 8칸
  (6~10)」), `exact` (「🎯 딱 3칸」), `rush` / `spun.rush` (「💨 월급날 직행 11칸」). `handLayout(n, w, {min 46, max, gap 6,
  minGap 4})` (six cards fit a 390 px row). `cardLostInfo(e)` / `cardLostChips(events)` (💍 결혼운◎ 소멸 · 🩹 부상 회복 · 🗑️ 버림 ·
  🏅 공적 카드 n장 사용, merged per character + reason + card).
- `public/js/shared/growth.js`: `requirementList(requires, {character, cards})` → `[{text, kind: stat|edu|military|card, id, need,
  ok}]` (card badges 「🔬 연구열심 필요」, names from `meta.cards` else `REQUIREMENT_CARDS`; `ok` null without a character),
  `requirementBadges` = its texts, `meritNeed(character, jobs)` (`rankUp.merit` for the next rank → `{need, have, ok}`),
  `optionExtras(p, o, {jobs, character, cards})` adds `reqs` (the option's own `requires` wins — 찬스 광장 이직; jobTile 승진 option
  `merit` / `merits` → a 🏅 badge), `optionBadgeList(x, extra)` → `[{text, miss, card}]`: the cut-in list and the 2D modal render
  missing requirements red (`.ci-opt-badge.miss` / `.c-badge.miss`, 「✗ 」 prefix), requirement cards blue. Disabled options of the
  generic cut-in list are now disabled buttons (`.ci-opt.off`).
- `ui/cardArt.js`: `cardFrameSvg(kind, color)` (blue double ring, red, sabotage orange-red, status grey with hand-clipped diagonal
  stripes — no SVG ids), `cardHtml(card, {count})` → classes `k-<kind> c-<color>` (+ `stacked`), corner `.cf-tag t-<color>` 보유 / 사용
  / 자동 (`cf-auto`) / 부상, `.cf-stack` 「×n」; `cardChipHtml(id, {count})` (detail hand list); shop cards tag 🔵 보유 / 🔴 사용.
- game2d: hand row = `handStacks` (status card is a non-clickable `div.cardf.status`; blue cards `held` — never dimmed, open the sheet;
  red `can` / `dim`), `n/limit` red when full, hints about 🔴 / 🔵; `fitHand()` sets `--hand-cw` / `--hand-gap` from `handLayout` (also
  on resize; CSS caps per breakpoint: 62 / 54 phones / 56 desktop dock (hand column `minmax(300px, 44%)`) / 44 sticky phone dock).
  Card sheet: kind line, 🔵 / 🔴 effect box, requirement jobs (「🔑 취업 조건: …」), 🏅 count + next-promotion need, 「사용」 only for red
  non-auto cards, sabotage targets, 딱 그 칸 5 × 2 number pad (`data-card-value`, button 「🎯 n칸 가기」) → `useCard {…, value}`. Trade
  dialog lists `tradableCards`. Side rows: 🤕 (job injury turns or the status card), 🔵 held-card icons (`gc-tag held`, requirement
  cards underlined), 🏅×n; detail: colour chips for the hand, 「직업 카드」 row (requirement cards ✓ / ✗ + 「🏅 다음 승진에 공적 n장 ·
  보유 m」). Spin: dock hint `.roll-lim` (mine: full text; others: 「이름 · 🔼 6–10」), `spinNow` spins plainly (no aim panel) under
  딱 그 칸 / 월급날 직행; skill panel `open/update({limit})` shades out-of-range cells (`.sk-cell.out`) + `.sk-lim` line; the bet card
  closes while the current character has a red roulette card mod; the 2D roulette pop shows 「🔼 6~10만!」 and 🎯 / 💨 notes. Floats /
  toasts: `cardLost` (discard toast for mine), injury card gained, `cardUsed.value`.
- Cut-ins: `cardLost` is a follow-up chip (`g.cards[].reason`) and a lone banner group (`STAGE7_LONE`, `BANNER_TYPES`, merge rank 0,
  tag 🩹 부상 회복 / 💍 카드 소멸 / 🏅 공적 사용 / 🗑️ 카드 버림); cutin2d `gainedChip` (🔵 / 🔴 dot, 🤕 injury card = minus chip),
  `cardLostChips` chips (a lone healed banner skips its own chip), injury `cardGained` / `cardLost` looks, card badges use
  `cardKindLabel` + `c-<color>`. 3D (board3d): `cardLost` pop (animator `ANIMATED_EVENTS`), injury card gained 🤕, 🔼 / 🔽 / 🎯 / 💨 pops on
  `cardUsed`, `spun` subtitle 「· 🔼 6~10」, rush banner 「💨 ○○, 월급날로 직행!」, name-tag badges via `spinModBadges`.
- CSS: end of `public/css/cards.css` (colour chips / tags / stack / status stripes / number pad / requirement badges / roll hints).
