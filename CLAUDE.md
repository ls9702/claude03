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
- Tests: `npm test` = `node scripts/run-tests.js`: `test/*.test.js` in parallel shards — one Node process per CPU core
  (≤ 8), each running its files one after another in that process (`--test-isolation=none`, `--test-force-exit`) →
  ≈ 6–8 s on 4 idle cores (10–15 s while other agents load the machine), ≈ 60 % of the CPU of one process per
  file. Shards are balanced (longest first) on the last runs' per-file times (`node_modules/.cache/
  jinsei-test-times.json`; tracked seed `scripts/test-times.json`, refresh with `TEST_SAVE_TIMES=1 npm test`); each
  shard's output is printed when it ends, then one summary
  (`# tests/pass/fail …`, `# failed:` with file:line). Args: files / `dir/*.test.js` / `--test-name-pattern=…`; env
  `TEST_SHARDS=n`, `TEST_ISOLATION=process`. **Files of a shard share globals**: a top-level `before/after/beforeEach/
  afterEach` is a root hook there (it also wraps the other files' tests of that shard — prefer per-test setup or
  `t.after`), and mock timers / `process.env` / module-level state (e.g. `setAssetIndex`, `setCharaMeta`) must be
  restored by the test that changes them. `npm run test:isolated` = `node --test test/*.test.js` (one process per file,
  ≈ 2× slower; rules out leaks between files — Node 22 no longer accepts a bare directory argument). `npm run
  test:legacy` = `test/legacy/*.test.js` (≈ 5 s): the slow full-size pixel work of LEGACY features (11-step AI art jobs
  + 402 resume + paper-doll reference composition, paper-doll diffExtract / front-back / erase masks + the part studio
  round trip) — not part of `npm test`; their cheap contracts stay in `test/charArt.test.js` / `test/assets-parts.test.js`.
  Use `node:test` + `node:assert/strict`, temp dirs for any disk I/O. Keep `npm test` fast (<10s): share expensive
  fixtures per file, keep full games short (small eraTurns / finalLength), no real sleeps where a mock timer works.
- Never commit secrets; keys via env or `data/secrets.json` (gitignored along with all of `data/`).
- **Gemini API is OFF in this repo's tooling by the user's decision (billing).** Never set a key, never call the API or run
  `scripts/gen-assets.js` / `part-qa.js --fix`. Exception: the user's OWN local Gemini skill (on their PC) may generate images
  for an explicit request file in `docs/asset-requests/*.json` — it saves PNGs to `assets-inbox/` (test batches: `assets-inbox/test/`).
  New art comes from the user's hand-made images: `assets-inbox/<asset id>.png|webp` → `node scripts/import-assets.js` (prompts in `docs/asset-prompts.md`).
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
  overwrite a newer one; nothing is scheduled after `close()`. The debounce has a max wait (`maxWaitMs`, `SAVE_MAX_WAIT_MS`
  2000): a room committing faster than every `debounceMs` is still written at least every 2 s. Sessions `{createdAt, lastSeenAt}` (`hasSession`
  refreshes lastSeenAt, persisted at most hourly); `pruneSessions()` drops sessions unused for `SESSION_TTL_MS`
  (7 days) that are not a player of any room — at `load()` and hourly (`startPruning()`, started by `startServer`).
  `subscribe(roomId, sessionId, res, {state})` caps SSE streams at `MAX_STREAMS_PER_SESSION` (3) per session per room: the
  oldest first gets `event: superseded {roomId, reason: 'tabs', max}`, then is ended (the client stops reconnecting, see
  "E2E round 4 fixes"). Every write goes through `#send`: a stream whose unsent buffer (`res.writableLength`) exceeds
  `maxBufferedBytes` (`SSE_MAX_BUFFERED_BYTES` 1.5 MB — a client that stopped reading) is destroyed + unsubscribed (log
  「느린 SSE 연결을 끊었습니다…」). `state` frames go through `stateFrame(room, sub)`: the static board only when this stream
  has not got that `boardKey` yet (SSE board cache). `load()` skips save files whose players / characters / status are
  malformed (`savedRoomProblem`, Korean log) and fills missing `log` / `config` / `code` (`normalizeSavedRoom`).
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
  omitted = trusted (tests/simulator, no ownership check). Every action copies the whole room with
  `server/game/clone.js` `cloneState` (deep copy of plain objects / arrays, ≈ 5× faster than structuredClone on a
  120 KB lifetime room; other types fall back to structuredClone; like a JSON save → restore, shared references become
  separate copies) — also used by lobby.js and view.js. Room state must stay JSON-like (no cycles).
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
  HELD at bet time (see "Post-simulation fixes (server)"). Any pending spin mod that changes the value bets settle on —
  `cards.BET_VOID_MODS` exact / range / rush AND 택시 max2 / 층간소음 min2 (`betsVoided`, `betVoidReason`) — refuses new bets
  (409 「…카드로 정해져서 / 두 번 돌려서 훈수 베팅을 할 수 없어요.」) and voids + refunds the turn's bets when the card is played
  after them (a visible taxi was +58 % EV).
- 기초연금 (`balance.pension`): recipients are decided ONCE at the transition into the pension era — bottom
  `bottomN` characters by FAMILY-average total assets (`pensionRankWorth`: `pensionWorth` = cash − debt + house + items,
  averaged over `pensionFamily` = one player's characters (same owner session); every CPU is its own family; ties → the
  poorer character itself, then creation order; ≥ `minCharacters`) → `room.pension`; each recipient is paid at once (amount
  = base + the gap between the richest family average and the recipient's × gapRatio, ≤ max). Never more than `bottomN`
  payouts. (E2E-4: with per-character worth a player could gift cash between own characters right before the transition to
  make one look poor; the family average can't be moved by own-character transfers.)
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
- Player looks (CH-1): `character.avatar = {character: rosterId, props: {head?, face?, neck?, hand?, back?}}` (roster.json /
  props.json, see "Chiikawa conversion (CH-1) — server"); partners `{npc, props}`, pets `{pet}`. LEGACY: avatar part ids in
  `server/data/avatars.json` (human paper doll) stay stable contracts for the asset pipeline only; `eraOutfits` is legacy.
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
  (`createAnimator` event queue, `planSteps`), `pawnParts.js` (avatar part ids → primitive specs + colors), `camfit.js`
  (camera fit math, see "Camera views" below), `chunks.js` (`runSteps(steps, {schedule, now, sliceMs})` idle step runner →
  `{promise, flush, cancel, done, next, times, slices}`, `stepStats`; `test/scene-camfit.test.js`).
  three-based: `board3d.js` (`createBoard3D(canvas, {quality, meta, hooks:{onStep,onRouletteTap,onViewChange,onError}})` →
  `setBoard/setCharacters/setCurrent/focus/focusEra/resetCamera/setView/view/overview/setViewInsets/prepareEra/playEvents/
  onIdle/isBusy/whenIdle/reaction/resize/setQuality/stats/measureFps/dispose`, `.animator`), `pawn.js` (merged vertex-colored pawn = 1 draw call, name tag;
  `/api/models` lists `public/assets/models/*.glb` → `pawn.glb` drop-in via GLTFLoader), `roulette3d.js` (own scene
  drawn into a scissored viewport of the same renderer), `emotion.js` (emoji/text popups), `particles.js`,
  `controls.js` (orbit: drag/pinch/two-finger pan/wheel, taps), `props.js`, `geo.js`, `sprites.js`,
  `pawnPreview.js` (lobby customizer 3D preview, shares pawn geometry).
- Budget: ≤100 draw calls, ≤50k triangles (8-char lifetime board ≈ 32 calls / 21k tris incl. roulette), no shadows/
  post/AA, pixelRatio 1, Hemisphere + 1 Directional, Lambert + vertex colors; tiles are InstancedMeshes, icons one atlas
  mesh, roads/buildings merged, trees instanced. Keep new scenery inside the era build steps' merges (`eraSteps`).
  Whole-map views measured (SwiftShader): kids eras 30–31 calls / ≈ 13–15k tris, young / middle_age 40–43 calls /
  ≈ 26–29k tris, the final race 31–33 calls / ≈ 13–15k tris.
- Camera views (`camfit.js`, pure): the orbit camera looks at `target + (0, LOOK_Y 0.6, 0)` from `radius · back(az, polar)`;
  `defaultOrbit(w, h)` (landscape az −0.3 / polar 0.95 / r 17, portrait (`w < 0.9 h`) −1.15 / 0.9 / 19), `followRadius`
  (spectators × 0.68). `fitPoints(points, {azimuth, polar, fov 40, aspect, inset, align, avoid})` = exact perspective fit with a
  fixed orientation (the frustum side planes are linear in the camera position → the tightest camera along the view axis in one
  pass, the binding axis touches its inset edge; `align` places the slack (0 = left / bottom … 1 = right / top), `avoid` NDC
  boxes are cleared by sliding along the slack, never zooming; returns `{target, radius, camera, axis, hidden, hiddenKey,
  depth}`). `viewPoints(layout)` = tile footprints (lanes incl.), pawn + name-tag tops, payday / 🎪 / start-flag / goal-gate
  markers, the era sign above the start, route labels (goal points `key: true`); `overviewView(layout, {…, avoid, maxGrow 1.2,
  keyGrow 1.5, points})` = whole-map fit (`OVERVIEW_INSET` top .05 / bottom .1 / sides .03, `OVERVIEW_ALIGN` y .35); when
  sliding can't clear a corner box it tries a farther camera that keeps the map beside it (≤ ×1.2 of the view-axis depth, ≤ ×1.5
  while the final race's goal would be hidden). `coverInset(cover)` (page overlays replace the base inset on their side),
  `zoneView` (route branch look), `fogRange(radius, extent)` (follow view keeps fog 55 → 140 / far 260; far overviews push the
  fog behind the board's far edge), `ndcBox`, `quantizeAngle` (fits cached per ~1°), `projectPoint`, `orbitBasis`.
  board3d: `setView('follow' | 'overview')` (`view` getter, `hooks.onViewChange`; TV quality = always the overview at
  `TV_ORBIT` az 0 / polar 0.62), the overview is refitted on resize / rotation / orbit drags (cached per quantized angle,
  aspect, cover) and stays until switched back (hops don't leave it); `focusEra(i)` = overview, `resetCamera()` = default
  orbit + follow. It always avoids the idle roulette's corner (`rouletteRegion('idle')`) and, via `setViewInsets({top, bottom,
  avoid: [{x, y, w, h} css px]})` from game2d, page overlays over the canvas (the sticky spin dock covers ≈ 30 % of a 1280×720
  board on my turn) and the 🗺️ button. Controls: `state.maxRadius` lifts the zoom-out limit to the whole-map radius × 1.3.
  game2d: 「🗺️ 전체 보기」 / 「🎯 따라가기」 toggle `data-el="viewbtn"` (`.b3-view-btn`, top-left of the canvas, 36 px,
  `aria-pressed`, hidden in TV / 2D; localStorage `jinsei.boardView` = 'overview'), `boardCover()` → `setViewInsets` on
  scroll / resize / render (5 % steps). The quality select now re-runs `applyModeUi` (TV ↔ others).
  E2E (session scratchpad `cam/`: `shots.cjs` every era 1280×720 + 390×844 overview / follow + transition + resize + landscape,
  in-page projection check 0 tiles outside; `tv.cjs`; `measure.cjs` A/B lag; screenshots `cam-*.png`).
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

## Customization UI (Stage 5.5-A) — LEGACY since CH-1 (human paper-doll avatars; player looks are roster characters + props, see "Chiikawa conversion (CH-1)")
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

## Paper-doll layers (Stage 5.5-B) — LEGACY since CH-1 (human paper-doll avatars; player looks are roster characters + props, see "Chiikawa conversion (CH-1)")
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
- Tests: schema / gen-part-manifest / layerStack / tint math in `test/assets-parts.test.js`; the pixel extraction tests and
  the studio round trip in `test/legacy/assets-parts-pixels.test.js` (`npm run test:legacy`).

## AI character art (Stage 5.5-D) — LEGACY since CH-1 (human paper-doll avatars; player looks are roster characters + props, see "Chiikawa conversion (CH-1)")
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
  Tests (`test/charArt*.test.js`) inject `assets.studioOptions.fetchImpl` / `charArtOptions` / `charArtThrottleMs`; the
  full image jobs (11 steps, 402 resume, reference composition) are in `test/legacy/charArt-pipeline.test.js`
  (`npm run test:legacy`).

## Layered avatars (Stage 5.5-C) — LEGACY since CH-1 (human paper-doll avatars; player looks are roster characters + props, see "Chiikawa conversion (CH-1)")
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
  (Re-measured after the camera / lag pass: the longest game-start task ≈ 0.3–0.45 s; see the "Camera views" bullet of "3D board (Stage 4)".)

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
  `retakeSkipTurns`, retake exam → a pass enrolls, a fail goes to work — no second 진로 prompt). 군 (CH-1: no gender —
  `balance.military.mandatory` false / `volunteer` true): everyone with str ≥ `volunteerMinStr` → volunteer prompt, else exempt;
  only with `mandatory: true` (data override) everyone is drafted — enrolled → prompt 지금/졸업 후 (once), otherwise automatic
  after hiring (job kept). Serving: spins move `ceil(value/2)` (`spun.steps`, `halved: true`), military pay
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
  houseSwaps ≥ 3 or penthouse / jeju_villa (loop-map values: 우주비행사 9/9, 국민 MC charm 9, 재벌 총수 net worth ≥ 1,200 (E2E-4;
  was 2,000), 트로트 스타 charm 9 & luck 9, 산신령 wishes ≥ 8 (granted 찬스 광장 소원 count too; 모두를 위한 소원 never), 건물주
  houseSwaps ≥ 3 (E2E-4; was 4)). News: every era transition (loop maps: `eraTransition`, not a first entrant; adult mode draws 청년 at start) → `room.news[era]`, `newsFlash`
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
  (30/45/65/85 만원 per payday since the loop maps; 고교 전원 만남 is always ★1), (`names.boy|girl` and the `avatar` pools were removed
  in CH-1: names / looks come from npcs.json / pets.json), `meetEras`, `affection {meet 30,
  dateGain, matchBonus 8, proposeAt 60, max 100, failDrop 15, steadyGain 10, familyGain 10, eraGain 5, loveRoute 30}`, `propose {base 0.45, perAffection, charm,
  luck, match, min, max, eras}`, `dates[]` (walk 5 / library int 12 / hiking str 12 / concert charm 16 / amusement luck 16: `{cost, gain}`), `costs
  {scale per era, wedding, weddingGift, birth}`, `birth {eras young/middle_age, base 0.6, perAffection, perChild, max, perSpin 0.15}`, `children {max 4,
  genius {base, match, luck}, growTurns 1, dolGift, schoolCost, examGift (genius 60 / college 20), allowance 50, talentMult, allowanceOnEra?}`, `outings[]`.
  `server/data/houses.json` — 6 fixed ids `oneroom villa apartment
  hanok penthouse jeju_villa` `{name, icon, price, value (= price × 1.05; jeju 1500 → 2000), capacity 1 | null (apartment), eras, lucky? (jeju), desc}`, `listings` 3,
  `tradeIn` 0.7, `subscription {houseId apartment, chance, discount}`, `luckyChance {money, other, perLuck}`, `market {era senior,
  min 0.8, max 1.3}`. news.json: `housing_boom` (young/middle_age ×1.3), new `housing_slump` (middle_age/senior ×0.8) and
  `redevelopment` (senior ×1.2) = `housePriceMult`; `birth_bonus.birthBonus` 300 = 출산장려금. Board: `heart` love route 7 (career /
  money 1, high 1, senior 1), `house` money route 6, senior 6, love / career 2; heart / house left `placeholders` (only treasure remains).
  manifest: `bg-park` / `bg-house` (todo; scenes `park` → mountain-trail, `house` → office in `sceneFallbacks`).
- Modules: `server/game/family.js` (init / `ensureFamily` / `ensureRoomFamily`, `topStats` / `traitMatch` (찰떡궁합 = partner trait
  is one of my best stats), `makePartner` (CH-1: an NPC friend, `npcLook`), `schoolMeet`, `resolveHeartTile`, `blindDate`, `loveRouteChosen`, `proposeStep`, `proposeChance`, `birthChance`, `bearChild`, `growChildrenOnEra|OnSpin`,
  `allowanceAmount` / `payAllowances`, `spouseSalary`; prompts meet / date / propose) and `server/game/houses.js` (`houseOwners` /
  `syncHouseOwners`, `houseAvailable`, `priceMult`, `tradeInValue`, `houseListings`, `resolveHouseTile`, `buyHouse`,
  `drawHousingMarket`; prompt house). spaces.js: `heart` / `house` tile cases; routeChoice `love` → `loveRouteChosen`; growth.js `lifeStep` ends with
  `proposeStep`.
- Character (public): `love {candidates [partnerSpec] (the open 만남 prompt's people, else []), partner, affection, dates}`,
  partnerSpec = `{id 'pt<n>', name, trait, stars, species, avatar {npc, props}}` (CH-1: an NPC friend, no body); `spouse` =
  partnerSpec + `{salary, marriedTurn}` | null; `children` (CH-1: pets) `[{id 'ch<n>', name, species, trait, talent genius|normal,
  stage baby|kid|teen|adult, bornTurn, avatar {pet}, growth 0..4, turns}]` (max 4); `house {id, price, value, boughtTurn}` | null; `houseSwaps`. Room: `nextPartnerSeq`,
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
- **CPU 난이도 (room setting `config.cpuLevel`, user decision)**: `config.js` `CPU_LEVELS` easy | normal | hard, `DEFAULT_CPU_LEVEL`
  easy (new rooms; a room without one — old saves — is easy too: `cpuLevelOf(room)`), 400 「CPU 난이도는 쉬움(easy)·보통(normal)·
  어려움(hard) 중 하나여야 해요.」, `CPU_LEVEL_INFO` 😊 쉬움 「사람이 거의 이겨요」 / 🙂 보통 「비슷한 실력」 / 😈 어려움 「예전의 강한 CPU」
  (`/api/meta.cpu.levels` + `defaultLevel`). easy = the weak personality tables + the money handicap (below; `handicapActive` needs
  level easy); normal = no handicap, `balance.cpu.levels.normal` `{hardShare 0.1, cardHardShare 0.1, aimRandom 1}`: each prompt
  answer is the strong heuristic with chance `hardShare` (hashed sub-RNG `normal:answer:<kind>`), else the personality table; the card
  before the spin likewise (`cardHardShare`); skill rooms aim at a liked (uniform) number with chance `aimRandom` (0.5 → 1 after the senior race rework: casual 1 + 3 in skill rooms 16.5 / 20.5 % (real, seeds 1 / 2) and 24.0 / 22.0 / 22.0 % (🐹, seeds 1–3) → 28.0 / 27.5 and 26.5 / 27.5 / 28.0 %), else the best ± noise;
  trades use the strong margin; hard = the strong heuristic alone (`level: 'hard'`), no handicap. `cpu.js` `cpuLevelFor(room, opts)` =
  a valid `opts.level` (scripts / tests / the expert proxy) else the room's — the runner calls `cpuDecide(live, id)` without opts.
  Lobby `setCpuLevel(room, level, now, {by})` (lobby only 409 「로비에서만 CPU 난이도를 바꿀 수 있어요.」, invalid 400, the same effective
  level → `{changed: false}`, log 「🤖 ○○ 님이 CPU 난이도를 😈 어려움으로 바꿨습니다.」); routes `PATCH /api/rooms/:id/cpu-level {level}`
  (host, `canManageCpu`: 「CPU 허용」 rooms only) and `PATCH /admin/api/rooms/:id/cpu-level {level}`. UI: admin create form 「CPU 난이도」
  select (always sent) + hint; admin room detail row 「CPU 난이도」 = `select.cpu-level-sel[data-cpu-level]` in the lobby (PATCH at once)
  else text; lobby host CPU tools: first row `label.cpu-level` + `select[data-cpu-level]` (wraps under the label on narrow screens, ≤ 20em),
  the handicap line only at easy; lobby mode line 「🤖 CPU 😊 쉬움」 when 「CPU 허용」 is on or CPUs joined (`lobbyText.modeSummary`);
  `format.js` `CPU_LEVEL_IDS / CPU_LEVEL_INFO / cpuLevelOf / cpuLevelInfo(id, meta) / cpuLevelOptions / cpuLevelText(room, meta,
  {short})`. Tests `test/cpu-level.test.js`. Measured: see "Measured (CPU 난이도)" below.
- Lobby (pure, `server/game/lobby.js`): `addCpuCharacter(room, {name?, avatar?, personality?}, now, {by})` (lobby only, max
  characters, name = first unused `CPU_NAMES` entry unless given, look = `randomAvatar(seed)` (CH-1: `avatar.randomLook` = roster
  character + 0–2 props) seeded by room seed + id + seq, personality cautious|normal|bold, absent / '' / 'random' → seeded the
  same way, anything else → 400 「CPU 성향은 신중·보통·대담 중 하나여야 해요.」 (`parseCpuPersonality`)),
  `setCpuPersonality(room, charId, personality, now, {by})` (lobby only 409, CPU only 409, unknown 404, invalid / missing 400;
  'random' = a different seeded one; same value → `{changed: false}`; log 「🤖 ○○ 님이 CPU 「…」의 성향을 🔥 대담으로 바꿨습니다.」,
  `CPU_PERSONALITY_LABELS`), `removeCpuCharacter(room, charId, now, {by})` (CPU only → 409, lobby only),
  `roomHost(room)` (= first joined non-spectator), `canManageCpu(room, sessionId)` (409 without `config.allowCpu`, 403
  for non-hosts / spectators). A CPU-only room starts like any other (≥ 2 characters, no ready check) — admin only.
- Routes: admin `POST /admin/api/rooms/:id/cpu {name?, avatar?, personality?}` → 201 `{characterId, room}` (always allowed in
  a lobby), `PATCH /admin/api/rooms/:id/cpu/:charId {personality}` → `{room}`, `DELETE /admin/api/rooms/:id/cpu/:charId`; host
  player `POST /api/rooms/:id/cpu {personality?}` → 201 / `PATCH /api/rooms/:id/cpu/:charId {personality}` / `DELETE
  /api/rooms/:id/cpu/:charId` (only with 「CPU 허용」, `canManageCpu`). `/api/meta.cpu` and `/admin/api/meta.cpu` =
  `cpuHandicap.cpuMeta` `{personalities, levels, defaultLevel, handicap: {startMoneyMult, incomeMult, treasureMult} | null}`. Client (`format.js`):
  `CPU_PERSONALITY_INFO` 🐢 신중 「돈을 아끼고 모험을 피해요」 / 🙂 보통 / 🔥 대담 「도박·투자를 좋아해요」 + `CPU_RANDOM_INFO` 🎲 무작위,
  `cpuPersonalityHtml(c, {short, desc})` (`.cpu-pers.p-<id>` chip), `cpuPersonalityOptions(value, {random})`,
  `cpuHandicapText(meta)`. Admin page: 「CPU 허용」 create checkbox (sent only when on); room detail: a `.cpu-chip` per CPU
  (🤖 name + personality `<select data-cpu-pers>` → PATCH at once + ✕), a 🎲/🐢/🙂/🔥 `<select data-cpu-new>` (kept across the 3 s
  polling; the detail is not re-rendered while a picker has focus) + 「🤖 CPU 추가」, the style hint and the handicap line; detail
  cards show the chip. Lobby (`app.js` `renderCpuTools`, host only when `allowCpu`, `#cpu-tools`): the same chips / pickers
  (re-rendered only when the markup changes); lobby cards 「🤖 CPU 🐢」 (icon chip, 390 px); in game the side row 「🤖 CPU 🔥」 and
  the detail card row 「CPU 성향 🔥 대담 도박·투자를 좋아해요」. E2E: session scratchpad `cpu2/ui.cjs` (`cpu2-*.png`).
- `server/game/cpu.js` (pure; never consumes the game RNG — ties use a sub-RNG hashed from seed/rngState/turn/prompt/char):
  every entry point takes `opts = {level, personality}` (last argument; `level` easy | normal | hard, else the room's CPU 난이도):
  `level: 'hard'` = the strong heuristic below (the expert human proxy, the aim / 찬스 광장 duels and `--bias --aim cpu` of simulate.js,
  hard rooms), 'easy' = the weak real CPUs (see "Weak CPUs" below), 'normal' = the mix (CPU 난이도 above); `personality` overrides the
  character's. `cpuDecide(room, charId, data, opts) → action | null` (order: answer a trade
  offer made to it → answer the pending prompt →
  on its awaitSpin turn `cpuCardAction` or `spin`); `cpuDue(room) → {kind: trade|prompt|spin, charId, key}` (what the
  room waits on from a CPU; the key changes per step, e.g. `s:<turnNo>:<cardUsed>`); `cpuNextAction` (both, headless);
  `cpuAnswer`, `CPU_ANSWERS[kind](ctx, c, pending) → optionId | null` (null / unknown kind / disabled → the prompt default,
  else the first enabled option — every answer is an enabled option); `cpuTradeAccept` (value got ≥ value given ×
  `tradeMargin`; money at face value, cards at `cardValue` = price, job-only cards of another job ×0.1, lotto ×0.45, a
  card pushed out of a full hand counts); `jobScore` (rank salary + odds of the next two ranks − injury), `targetJob`,
  `jobDeficit`; `PERSONALITY` knobs (promotion / retake / propose thresholds, cash reserve, shop multiplier, sabotage
  ratio, trade margin, holiday stake style, route bias). CPUs never bet, offer trades or gift.
- Strong heuristics (level hard): route = max of love (charm ×0.4 + family: single 1.5 (+1 charm ≥ 6, 소개팅), dating 1.5 + affection/proposeAt,
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
- **Weak CPUs (the real CPUs, default level; user decision 「사람이 웬만하면 9할 이상 이기게」)** — all knobs in
  `balance.json` `cpu` (`_comment` / `_knobs` keys explain them): per prompt kind the personality's preference table
  (`cpu.personalities.<p>.prefs.<kind>`, else `cpu.prefs.<kind>`, else `cpu.prefs['*']` = `{best: 3, '*': 1}`) weights every
  ENABLED option — keys: option id, prefix (`"train:"`, `"buy:"`, `"meet:"`, `"date:"`), `"*"` (any), `"best"` (the strong
  heuristic's pick), `"default"`, `"dream"` (leads to the CPU's dream job) — weights add up, one pick by the hashed sub-RNG
  (`easyAnswer`, `prefWeight` exported). Styles: 🐢 cautious = timid (college 1 : job 3, overtime 3 : promotion 1, never buys a
  house, 「조금 더 친하게」 3 : propose 1, rests at home, temple training, 찬스 광장 「그냥 지나가기」 6, retire early, never
  sabotages, aims at a liked number 100 %); 🔥 bold = reckless (재수, job hopping 3, shopping, house swaps, expensive dates,
  propose at once, 소원 / 모두를 위한 소원 at 찬스 광장, jeju trips, favourite-horse bets + lotto — never 전 재산 올인 / 5배 / 10배:
  a jackpot would hand a weak CPU the game); 🙂 normal = a mixture. Shared: random routes (`best` 1 : any 2), birthday gifts 2 : 1,
  hidden jobs accepted. Dream job (`cpuDreamJob`): seeded per CPU (room seed + id) from `dreamJobs` (🐢 stable jobs, 🙂 all with
  doctor / politician / chef / researcher / teacher doubled, 🔥 flashy jobs + doctor / politician / chef) → habits / clubs train its
  missing stats (and the stat whose graduation card it needs, e.g. luck → 절대미각 for chef), 진로 leans to 대학 for degree jobs,
  job offers / 전직 / 이직 / shop requirement cards that lead there weigh `dream`. Cards (`easyCardAction`): a red card with
  `cardPlay` chance (🐢 0.2 / 🙂 0.35 / 🔥 0.5; always with a full hand), sabotage only with `sabotage` chance (0 / 0.3 / 0.5) at a
  RANDOM eligible rival, 딱 그 칸 a random number. Skill rooms: `aimRandom` 1 (a uniformly random target like an average person).
  Trades: accept when value got ≥ value given × `tradeMargin` (1 / 0.85 / 0.7).
- **CPU handicap against people** (`server/game/cpuHandicap.js`, `balance.cpu.handicap`, only at CPU 난이도 easy and only in rooms with
  at least one non-CPU character — CPU-only demo rooms play as before): `startMoneyMult` 0.2 (engine `startGame` → `startMoneyFor`, rounded to
  10만원), `incomeMult` 0.45 (folded into `news.effectsFor` for CPUs: `salaryMult` (salary, 용돈, 단짝 생활비, 알바) and
  `moneyTileMult` × it, plus `incomeMult` that spaces.js applies to POSITIVE event money — amounts are reduced where they are
  computed, before logging, so every number on screen matches), `treasureMult` 0.3 (`treasures.findTreasure` →
  `treasureValueFor`: a CPU's real treasure is appraised × it after the same RNG draws; fakes stay fakes; values are hidden until
  the result show). Losses, prizes, transfers, houses and awards untouched. Why: totals spread ±700만원 (SD) around ≈ 2,500만원, so
  decision-level weakening alone (even extreme tables) left a casual human at 33–42 % vs 3 CPUs; halving every CPU gain gave 81 %;
  starting money (a large common base) and treasures (what lifted most lucky CPUs over people) are the efficient levers. The lobby /
  admin CPU tools print it (`cpuHandicapText`: 「🤖 CPU 핸디캡(사람이 이기기 쉽게): 시작 자금 20% · 월급·돈 칸 수입 45% · 보물 감정가
  30% — CPU끼리만 하는 방은 그대로」).
- Runner (`GameRunner`): sibling CPU timer per room (`cpuTimers`), armed by `schedule(room, events)` from start / dispatch /
  restore with `cpuDue`; delay `cpuDelayMs` (`CPU_DELAY_MS` spin 1000 / prompt 800 / trade 800, + `cutin` 1200 when the
  last batch had an `event.cutin`; a number sets all four — tests pass 0 or `{cutin: 0}`), fires `runCpu(roomId, key)` →
  `cpuDecide` dispatched with actor `{system: true, cpu: true}` (only for `ownerSessionId === 'cpu'`); a refused action
  falls back to the default option / plain spin / reject, then logs. `end()` / `stop()` clear it. Simultaneous prompts:
  each CPU answers on its own timer. `startServer({cpuDelayMs})` passes it through.
- Engine edits: `prompts.js` `openPrompt` no longer pre-answers CPU characters with the default (the runner answers);
  `cards.js` `offerTrade` accepts CPU targets (the runner answers). A system actor may already act for any character.
- Scripts: `node scripts/cpu-game.js --cpus M --humans N --human-policy casual|random|expert [--mode lifetime|adult|kids]
  [--roulette skill] [--cpu-personality cautious|normal|bold|mix|random] [--cpu-level easy|normal|hard] [--games G --seed S]
  [--workers W] [--verbose]` (`--cpu-level` = the room's CPU 난이도 `config.cpuLevel`: easy with the handicap, normal / hard without) —
  human proxies: `random` = a random enabled option + a playable card half the time (worst case),
  `casual` = the prompt default 70 % / a random enabled option 30 % (a random route at forks), a red card ~30 % of its turns
  (random target / number), skill rooms a uniformly random target; `expert` = the strong heuristic (`level: 'hard'`, normal);
  nobody bets / trades / gifts; seats rotate per game (`seatPlan`, turn order `index`); summary = human 1st-place share, CPU 1st
  by personality + a style line (대학 / 단짝 / 집 shares, 소원 / 도박 / 야근 / 승진 / 뒤통수 / 아이템 per CPU), jobs, routes.
  `--matrix` = `TARGETS` (casual1 ≥ 90 %, random1 ≥ 75 %, casual2 / casual4 ≥ 97 %, expert1 ≥ 95 %) in lifetime + casual1 in
  adult / kids / skill + random1 skill + casual1 vs each personality; per level (`levelTargets(level)`): normal = casual1 25–45 % only,
  hard = no target; `--only casual1,random1,expert1` = just those lifetime rows. `--random R` still works (= R random humans). Exports
  `playCpuGame`, `cpuVsHumans` (async; `workers` threads), `cpuVsRandom` (legacy), `targetMatrix`, `levelTargets`, `humanAction`,
  `seatPlan`, `summarize`, `TARGETS`, `HUMAN_POLICIES`. `scripts/simulate.js --policy random|cpu|mixed [--cpu-level easy|normal|hard]` (its
  characters are not owned by 'cpu' → no handicap; mixed prints the 1st-place share per policy).
- Measured (300 games each, seeds 1 / 2, lifetime default config unless noted; before = the old heuristic, `--cpu-level hard`,
  200 games × seed 1): casual 1 + 3 CPU human 1st 15.0 % → 97.0 / 97.7 %; random 1 + 3 10.0 → 90.0 / 88.7 %; casual 2 + 2 28.5 →
  99.7 / 99.0 %; casual 4 + 4 29.0 → 100 / 99.7 %; expert 1 + 3 26.5 → 99.7 / 100 %; adult casual 10.0 → 98.0 / 97.7 %; kids
  casual 25.0 → 100 / 100 % (CPUs ≈ 300 vs 1,220만원: the start money is most of a kids total); skill roulette casual 1.5 → 97.3 /
  98.0 %, random 3.5 → 88.0 / 86.3 %; vs all-🐢 / 🙂 / 🔥 CPUs 14.0 / 9.5 / 11.5 → 99.0 / 97.3 / 98.3 % (seed 2: 97.0 / 97.0 /
  98.7 %). Average totals (casual 1 + 3) human ≈ 2,500 vs CPU ≈ 900 (before 2,579 vs 2,864). Legacy `--cpus 4 --random 4` × 300
  (seed 1): CPU wins 87–92 % → 1.0 %. Without the handicap (decision level only) casual 1 + 3 = 33 % (extreme tables 42 %).
  CPU-only rooms (no handicap, 4 CPUs × 300, seed 9): every game finishes; 1st place 🐢 21.1 / 🙂 26.4 / 🔥 27.8 %; style 🐢
  college 30 % · 단짝 36 % · house 0 % · 0.8 소원 · 2.0 overtime vs 🔥 62 % · 79 % · 78 % · 6.7 · 0.3. Jobs (chef fix): `simulate
  --policy cpu --games 300 --seed 11` chef 0.1 → 1.7 %, top job 의사 11.2 % → 트로트 스타 11.1 % (hidden), every regular job ≥
  0.9 % (국회의원), 알바 0 %; CPU-only harness chef 2.6 %, top 트로트 스타 18.8 %, every regular job ≥ 1.7 %. `simulate --policy
  mixed` (easy decisions, no handicap): CPU-policy characters 64.3 % of 1st places with 54.3 % of the characters (the easy
  tables still beat RANDOM play; the handicap does the rest).
- **Measured (CPU 난이도)** — `cpu-game.js --matrix --only casual1,random1,expert1 --games 200 --cpu-level <level>`, seeds 1 / 2 ×
  real / 치이카와 (human 1st place, 1 human + 3 CPUs, fair 25 %), on a code snapshot taken while the senior-race redesign (G2) was in
  progress — re-check after it lands: easy casual 96.0 / 93.5 · 94.0 / 94.5 %, random 82.5 / 84.0 · 79.5 / 83.0 %, expert 100 / 99.5 ·
  99.5 / 100 %; **normal** (hardShare 0.1) casual 34.0 / 29.0 · 26.0 / 29.5 %, random 15.5 / 16.0 · 17.0 / 15.5 %, expert 70.0 / 65.5 ·
  63.0 / 64.0 % (hardShare 0.15 → casual 25.5–29.5 %, 0.25 → 19.5–24.5 %); **hard** casual 7.5 / 7.5 · 6.5 / 5.0 %, random 5.5 / 3.5 · 7.0
  / 4.0 %, expert 18.0 / 27.5 · 22.0 / 28.0 % (≈ fair: the expert proxy IS the hard heuristic). On the code before the senior-race work
  (real, seed 1): hard casual 16.0 % / random 2.0 % / expert 30.5 %, normal at hardShare 0.25 casual 30.0 %, at 0 (= easy tables without
  the handicap) 36.5 %.
- Tests: `test/cpu.test.js` (lobby rules incl. personality add / change, every registered prompt kind answered with an
  enabled option the engine accepts for every level (easy / normal / hard) × every personality without touching the game RNG — kinds without a
  fixture get a synthetic prompt, strong heuristics (`level: 'hard'`), Stage 8 option fields, sabotage targeting, card legality
  (hard + the real CPUs' red-card play), `prefWeight`, personality styles, dream jobs, the handicap (start money, effect
  multipliers, a money tile's log = its delta, treasure appraisal, CPU-only rooms untouched, off switch, `cpuMeta`), trade
  answers, CPU-only games in 3 modes with no bets / offers / gifts, the harness: proxies / seats / summaries),
  `test/cpu-server.test.js` (delays, mocked-timer pacing incl. the cut-in extra and a trade answer, a CPU-only runner game to the
  end, admin / host routes incl. personality POST / PATCH + permissions + /api/meta.cpu + the handicapped start money, admin start
  of a CPU-only room watched by a spectator). Tests that assert the strong heuristic's exact picks pass `{level: 'hard'}`
  (roulette-skill, cards-bluered, stage9-submaps). E2E: session scratchpad `s9c/e2e.cjs` (`s9c-*.png`), `cpu2/ui.cjs` (`cpu2-*.png`).

## Stage 9 — submaps, treasures, awards, result show (server)
- Data (`gameData().treasures|awards|titles`, `/api/meta.treasures|awards|titles`, `/api/meta.balance.submaps|result`):
  `server/data/treasures.json` (22 `{id, name, icon, desc, min, max, fakeChance, weight, eras?}` + `fake {min 0, max 5}`; since
  E2E-4 every value range × 0.6 with max ≤ 400 (min ≤ max / 2): 5–50 … 200–400 — 「remove the treasures and the winner changes」 was
  27–32 % of casual games, now 17.5–18 %), `awards.json` (10 `{id, name, icon, desc, metric, route?, min, bonus, tie:
  all|split|place|qualify}`; E2E-4: 대가족 집사상 dabok 150 → 100, 인생 만렙 max_level 100 → 50), `titles.json`
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
- CPU (`cpu.js`, strong heuristic = `level: 'hard'`; the real CPUs use the personality tables of "Weak CPUs" in 9-C): hometown = rest only when 체력 helps, the goal is > 12 tiles away and the gift beats a lost landing (bold: visit);
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
  mode line (`ui/lobbyText.js` `modeSummary`) shows 「🎯 룰렛 실력 모드」. `/api/meta.balance.roulette` = `balance.json.roulette` {`skill.jitter`,
  `skill.jitterByTarget`, `cpu.aimNoise`}.
- Pure rules `public/js/shared/roulette.js` (no imports; `server/game/roulette.js` = `export *` re-export): `isSkillRoom`, `parseTarget`
  (int 1..10 or digit string, else null), `jitterFor(t, {jitter, jitterByTarget})` (the target's table: an exact key "7" > a range key
  "1-5" > `jitter` > `DEFAULT_JITTER`), `jitterTable(jitter)` (`{"<|offset|>": share}` → signed offsets 0, −1, +1, −2, +2 … with ± halves,
  normalized; invalid → `DEFAULT_JITTER` 50/40/10), `reflect` (0 → 2, 11 → 9, 12 → 8), `skillValueFor(t, r, skill)` / `skillValue(rng, t,
  skill)` (ONE `rng.next()` whatever the table), `skillDistribution(t, skill)` (exact, CPU + tests + client), `aimRisk(t, skill)` →
  `{hit, spread, shares [{offset, p}] (by |result − t|, bounces included), low, high, mean}` (client hint).
- **「빠를수록 위험」 (user decision: 큰 숫자를 노릴수록 더 크게 빗나가게)**: `balance.roulette.skill.jitterByTarget` — 1–5 = 50 / 40 / 10
  (±2, as before), 6 = 45 / 40 / 15, 7 = 40 / 40 / 15 / 5 (±3), 8 = 30 / 40 / 20 / 10, 9 = 25 / 35 / 20 / 12 / 8 (±4), 10 = 20 / 30 / 20 /
  15 / 10 / 5 (±5); misses past 10 bounce back, so aiming 10 never goes past 10 and falls short instead (mean roll: 10 → 8.2, 9 → 8.3,
  8 → 7.9; was 10 → 9.4). `jitter` (50 / 40 / 10) stays the fallback for a target without an entry.
- **Measured (빠를수록 위험)** — `simulate.js --aim-duel` (8-character lifetime, the hard heuristic decides everything, only the aim
  differs, strategies rotate over the seats, fair 12.5 %), 300 games × seeds 1 / 2 × real / 치이카와, means of the 4 runs, before (one
  50 / 40 / 10 table) → after, same code snapshot (senior-race redesign in progress): cpu 18.9 → 15.4 %, random 11.1 → 11.9, always-10
  12.8 → 11.0, always-8 10.2 → 9.8, always-6 10.2 → 11.3, always-1 12.8 → 16.0, no target 11.7 → 12.1; the hard CPU's aims 10 / 9 / 8 =
  64 / 16 / 5 % → 34 / 39 / 10 %, its mean move 8.42 → 7.48 (always-10 9.29 → 8.13). Every fixed aim stays ≤ fair + 5; always-1 edges
  past the CPU because the in-progress final race pays a slow character more race turns (the CPU's final-race aim still chases the goal —
  `progressWorth`; re-check `--aim-duel` once the senior race lands). The loop eras alone (lifetime without the final race, a data
  override, isolates the rule): cpu 30.8 → 25.1, always-10 22.1 → 19.5, always-8 13.1 → 15.9, always-6 8.3 → 10.9, always-1 1.0 → 0.8,
  none 6.2 → 8.3, random 6.0 → 7.1. On the code before the senior-race work (200 × seeds 1 / 2, before only): cpu 24.6, always-10
  19.5 (16.6–21.4), random 7.2 %. Harness: session scratchpad `g1/` (`aim.mjs` / `snap-aim.mjs` (`LOOPONLY=1`), `summ.mjs`, `avg.mjs`).
- Engine `doSpin`: `spin {characterId, target, input}` — in a skill room, unless the actor is admin (forceSpin) or the system auto spin
  (turn timer), a valid target (ANY number 1..10, every turn) →
  `skillValue` with that target's table (`jitterByTarget`) for the first roll; spin mods / 경차 / military halving apply after it (a taxi / noise SECOND roll stays random; the bonus spin
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
  (The loop maps then made big numbers the strong pick — the hard CPU aimed 10 on 64 % of its spins — hence 「빠를수록 위험」 above.)
- CPU (`cpu.js`): `cpuSpinAction` (skill rooms → `{target: cpuSkillTarget, input: 'cpu'}`; the real CPUs aim at a uniformly random number with
  `cpu.personalities.<p>.aimRandom` (1), the rest below = `level: 'hard'`), `cpuAimScores(room, charId)` = expected worth per
  target under that target's own table (`skillDistribution(t, skill)`): `landingFor` mirrors the engine (plus / minus mods, 경차, military halving, stops / goal halt) × `aimTileWorth`
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
  결과 8」/「… 명중!」/「🎯 목표 10 → 결과 7 (3칸 빗나감)」 for a miss ≥ 2, first roll), `aimShort`, `aimGrade`, `jitterHint(meta, target?)`
  (a target → 「🎯 10 → 명중 20% · ±1 30% · ±2 20% · ±3 15% · ±4 10% · ±5 5%」; none → 「작은 숫자일수록 정확해요 · 🎯1 명중 50% … 🎯10 명중
  20% (±5칸까지)」, or the old 「정확히 50% · ±1 40% · ±2 10%」 when every target shares one table), `aimRiskText(meta, t)` (「🎯 10: 명중 20% ·
  ±5칸까지 빗나갈 수 있어요」), `aimCells(meta, t)` ([{v, p}] for the 10 cells), `load/saveInputPref`, `DEADLINE_WARN_MS` 5000.
- `public/js/ui/skillPanel.js` `createSkillPanel(host, {onAim, getMeta, now})` → `open({charId, name, deadlineAt})`, `close`,
  `update`, `isOpen`, `charId`, `input`: fixed sheet `.skill-panel` (z 23, above cut-ins, under inbox / reaction bar / toasts), tabs 📱 흔들기 /
  👆 버튼으로 (saved), gauge (rAF needle over 10 cells, all always enabled, 「✋ 멈춰!」, Space / Enter via a capture keydown listener
  — not the 700 ms prompt guard), shake (「📱 흔들기 켜기」 once when iOS needs permission, live 1..10 meter, tutorial line, "no sensor"
  hint after 1.5 s without samples), result flash 「🎯 7!」, ⏰ warning under 5 s of the turn timer, Escape /
  ✕ closes. 「빠를수록 위험」: `showRisk(t)` — the odds line `[data-sk="odds"]` (min-height 2 lines) shows `jitterHint(meta, t)` of the cell
  under the needle / the live shake level / the pick (general line before), and every reachable cell gets `.reach` + `--p` (a bar under
  it, height = chance); the 💡 line says 「…자주 만나지만, 더 크게 빗나가요 (빠를수록 위험!)」. Admin form hint: 「실력 모드: 빠를수록
  위험! … (🎯 1~5 명중 50% · ±2칸까지 … 🎯 10 명중 20% · ±5칸까지)」. `body.skill-open` hides the floating spin button. `?debug=1` → `window.__skill`.
- game2d: `spinNow()` (dock button, floating button, 3D roulette tap) opens the panel in skill rooms (else the plain spin); the panel closes
  when it's no longer my roulette, `update` keeps the deadline fresh; dock text 「🎯 ○○ 룰렛 돌리기」 + hint 「🎯 흔들기나 버튼으로 목표 숫자를
  정해요」 / 「…룰렛을 🎯 조준하는 중…」; bet card never opens in skill rooms; last-spin line shows `aimText`; `spun` feedback: side float
  `aimShort` (everyone), my own 2D spins also toast `aimText`; 2D roulette pop shows 「🎯 목표 N」 and the result line (1.7 s). board3d
  `spun`: subtitle 「🎯 ○○의 룰렛! 목표 N」, then `banner(aimText)` + `emotion.pop(aimShort)`; new hook `hooks.onSpinResult(e)` once the
  wheel stopped (or at once when the step is instant) → game2d toasts my own 🎯 result (my prompt cut-in usually covers the board by then). CSS `public/css/roulette.css`.
- Scripts: `simulate.js --roulette skill` (random-policy characters aim at a uniform random number = an average human, CPU policy aims;
  no bets; prints hit / ±1 / ±2 shares + landings per policy), `--bias --roulette skill [--aim random|cpu]` (`simulateBias({roulette,
  aim})`), `--aim-duel --games N --seed S [--strategies cpu,random,…]` (`simulateAim({games, seed, strategies: cpu|random|max 10|high 8|mid 6|
  min 1|none, data})`; prints the mean move per strategy and the CPU's aim histogram), `cpu-game.js
  --roulette skill` (`playCpuGame({roulette})`). Measured (with the former number deck): bias 2000 × seed 1 random aim 12.0–13.1 % (spread −0.06), 1000 × seed 1 CPU aim
  11.4–13.7 % (spread 0.12); `cpu-game` 4 CPU + 4 random × 300 (seed 1): CPU wins 67.7 % random mode → 82.0 % skill mode (random-aiming
  humans; avg total 1651 → 2068 vs 1439 → 1475); `simulate --games 300 --seed 11` random vs skill: route 1st-place shares stay fair
  (young 21.1 / 20.8 / 18.4 → 19.7 / 21.6 / 18.4 %, fair ≈ 20), raw route gaps young 3.3 → 5.7 %, middle_age 12.0 → 10.9 %; lifetime
  78.0 → 78.9 spins. (The `같은 판 평균 대비` relative line is dominated by games whose mean total is near 0 — use the raw gaps / shares.)
- Tests: `test/roulette-skill.test.js` (config, jitter table + reflection + seeded 12k samples per target, 빠를수록 위험 (per-target tables:
  sums, spread / exact share monotone, 10 never past 10, lookup order, seeded samples for 1 / 7 / 10, one draw per spin, 200 engine spins at
  10), no deck helpers / field, engine spins incl.
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
  route and across the wrap; laps that cannot be split use the nearest count: ≤ 27 → 1, 32 → 2); `placePasses` = round(lap / 45)
  (1–3; was 27 / 2–4 before the E2E-4 fixes: 81-tile laps 3 → 2, 18-tile laps 2 → 1) `pass` tiles (찬스 광장), never next to a payday; blocked slots = start, fork ± 1, merge ± 1. Route eras (young /
  middle_age): `fork` (a `stop` with `promptId: 'routeChoice'`) and `rejoin` (`merge`) inside the ring, three equal route tracks
  (≈ 40–50 % of the lap) that carry their paydays / passes at the same indexes. `nextPosition` wraps (`wrapsAt`), `lapPositions`,
  `eraPathLength` = lap (or the final length), `HALT_TYPES` salary / stop / goal. Tile pools: no `salary` / `shop` in pools.
- Final era (lifetime / adult: `eras.json.modes.<mode>.finalEra` senior; `finalEra` absent = no race): `buildFinalTrack` = linear
  `config.finalLength` tiles (20–80, default 40, `/api/meta.finalLength`), start → goal, paydays from the start every 18–25 (the last
  ≥ `paydayTail` 7 before the goal), trouble (`loss` × `troubleScale` 1.5) only at 3 spots (before the last payday, 5 after it, just
  before the goal), 2–3 `reversal` (인생역전섬), events filtered to good ones, no pass / shop. Goal order, `goalPrizes`, bonus spins
  only here; `turn.eraRound/eraTurns` null; the game ends when everyone finished (since the senior rework: or at ⏰ 노년 마감, and the
  pool / island / reversal counts changed — see "Senior race comeback (노년 역전)"). Without a race (kids) places = final ranking
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
  money}` (offering × `passTile.scale[era]`, chance base 0.3 + 0.04 × 운 ∈ [0.1, 0.7] → 운 +1 + money (prize `wish.moneyByEra[era]` 35 in
  the kids eras since E2E-4, else `wish.money` 25, × scale), `wishes` +1), `wishAll {cost,
  price, gift, others}` (offering, every other unfinished character gets `gift` × scale, 운 +1; NOT counted in `wishes` since the
  E2E-4 fixes — only granted wishes unlock 산신령), `buy {price, offers}`
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
- CPU (`cpu.js`, strong heuristic = `level: 'hard'`): `walkFor` / `expectedLanding` follow HALT tiles and pass tiles, `tileWorth` knows salary (`paydayWorth`) / pass
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
  `eraSweepPoints(layout)` = points once around the loop / start → goal (the transition tour is now the whole-map hold). `planProps`: landmark in the middle of the loop when it fits
  (else behind the far side), scatter on both sides (inside = low props only), a park grid inside, a second belt for small loops,
  mountains far behind; tall props never stand where `shadowPoints` (away from the camera for the default azimuths `VIEW_AZIMUTHS`,
  height × 1.45) would hide the track (`PROP_HEIGHT`). `insideRing`, `lapSlots`.
- `board3d.js`: `setBoard(board, {eraIndex, key?})` (a string = old key) — a new board builds at once (`buildEra`); a new era of the
  same board waits for its `eraTransition` animation (`S.wantEra`; switched in `applyCurrent` once idle when no transition plays).
  Era builds are cached entries (`S.eras`: the shown era + a prebuilt next one, `{index, group, layout, labels, viewPts, extent,
  job, built, warm}`) made of idle-sized steps (`eraSteps`: layout · planProps · ground · roads · tiles · markers · icons · props ·
  labels). `prepareEra(i)` (game2d: the next era once `eraClock(room).left ≤ 1`) runs them one by one in `requestIdleCallback`
  slices (timeout 400 ms), then `warmUp` draws the finished group once into a 1×1 scissor before a frame's clear (warm scene
  with the same lights + fog → buffers / textures uploaded, no new programs). Shared by every era (never disposed with one):
  the vertex-colour / tile / ground materials, ONE board-wide icon atlas (`ensureAtlas`, key `glyph|type`), label sprites with
  textures + materials cached per text / style (`labelSprite`), the grass texture loaded once (ground UVs in world units / 9).
  `eraTransition` handler = banner → `switchEra`: `.b3-fade` on → `buildEra` (prebuilt → a swap; else the remaining steps run
  now) → every pawn on the start tile → the camera snaps onto the whole new map behind the fade → fade off → `holdShot` overview
  for 2.4 s (azimuth eases in from +0.16) → back to the view mode (follow glides to the current pawn). The old group is disposed
  in an idle callback after the swap (InstancedMesh buffers too). `stats().build` = `{era, prebuilt, swapMs, switchMs, buildMs,
  maxStepMs, maxStep, slices, warmMs, firstRenderMs, steps}`, `stats().eras / view / shot / radius / cover`; DevTools marks
  `b3:swap` / `b3:build`. Measured (SwiftShader 1280×720, real server board, 8 transitions per variant, A/B interleaved with the
  old file routed in): main-thread work at the swap 17–103 ms (median 57) + first frame 5–19 ms → swap 0.1–0.3 ms, whole switch
  incl. the overview fit 0.4–5.7 ms, first frame 0.4–2 ms; the prebuild costs 15–63 ms in 9 idle slices (longest slice median
  13 ms, max 42), warm-up 2–5 ms; longest main-thread task in the 6 s after the transition 88–155 ms (median 117) → 0–108 ms
  (median 60), max frame gap median 159 → 67 ms — now the same as the SwiftShader per-frame readback baseline of a quiet last
  round (0–136 ms; headless software compositing reads every WebGL frame back on the main thread). The game-start build stays
  synchronous (≈ 70–100 ms + first frame shader compile ≈ 70–110 ms). `eraChanged` = a ✨ pop only. `moved`: hops follow the path ids (wraps, lanes); `hooks.onStep(moved)` after
  the hop; `halted` → pop + banner (💵 / 🎪 / 🔀), 🔁 pop when passing the start; `resumed` subtitle 「이어서 n칸」. Static board per
  era: one ground plane (era tint), ring strip (+ lanes), instanced tiles (payday / pass / fork / start / goal scaled up), one merged
  marker mesh (payday gold coin ring + sign, 🎪 striped tent, start flag, goal gate), atlas icons with ribbons 「월급날」/「찬스 광장」,
  sprites (era sign at the start, fork / merge, payday labels, goal, route names). Measured (SwiftShader): kids eras 29 calls /
  ≈ 11.7k tris, young / middle_age (81 tiles + lanes) 37 calls / ≈ 25.7k tris, final race 19–21 calls / ≈ 7–8k tris.
  `b3.eraIndex`; `focusEra(i)` only for the shown era (= the whole-map view). `finished` banner: 골인 / 🏖️ 조기 은퇴 (`retired: 'early'`) / 🌾 빈곤 농장
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
  detail 「노년 골인 경쟁 N칸」. Lobby mode line: 「… · 청년 15턴 · … · 노년 🏁 40칸」 (small era line). Result rows name 골인 보너스 / n번째 골인 only when
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
  merit|used}` (EVENT_TYPES; chip, never a line; `used` = a 로또 복권 / 쿠지 응모권 spent in an era-opening draw, emitted right
  after its `lottoDraw`). Trades / gifts refuse the injury card (409); blue cards trade / gift like any card.
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
- CPU (strong heuristic = `level: 'hard'`; the real CPUs play a random red card by personality chance): `cardValue(data, c, id, room?)` values blue cards (`blueWorth`: wanted requirement card 130 while jobless, 부적 by injury risk,
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

## Chiikawa conversion (CH-1) — server
Contract: session scratchpad `chiikawa-contract.md` + `chiikawa-deviations.md` (final ids / fields / decisions). Tests:
`test/chiikawa-server.test.js` (+ updated lobby / cpu / stage6 / stage8 / charArt / roomStore / presentation tests). Roadmap row 13 in
`docs/PLAN.md`. Event types / field names / line-tag ids / MC keys of Stage 8 are unchanged — only texts, looks and rules changed.
- Data (`loadData` / `gameData().roster|props|npcs|pets`, `/api/meta.roster|props|npcs|pets`; `/api/meta.avatars` stays, LEGACY):
  `roster.json` (8 fixed ids chiikawa hachiware usagi momonga kurimanju rakko shisa pochette, `default` chiikawa, `canvas`, `earTypes`;
  `{id, name, icon, colors {body, line, blush, accent, extra?}, ears, size 0.8–1.25, traits (display only), desc, promptDesc, anchors
  {head, face, neck, handL, handR, back}}` in the 1024×1536 canvas — data-driven, an entry can be swapped without code), `props.json`
  (`slots` head face neck hand back; `props [{id, slot, name, icon, choice, color, tintable?, promptDesc}]` = 30 `choice: true` player
  props + growth / job props; `eraProps {era: {slot: prop} | {job: true}}`; `jobProps {jobId: {slot: prop}}` = jobs.json job `props`
  (a test keeps them equal; jobs.json `outfit` is gone)), `npcs.json` (10 단짝 후보 species `{id, name, icon, colors, ears,
  promptDesc}`, 28 gender-free `names`, `traitProps` + `traitPropChance` 0.5), `pets.json` (8 반려동물 species `{id, name, icon,
  colors, size, promptDesc}` — no roster duplicates, 28 `names`, `stages` baby 새끼 / kid 꼬마 / teen 청소년 / adult 어른 + scale).
- Avatar model (`server/game/avatar.js`, pure): `character.avatar = {character, props}` (props = only set slots, in slot order,
  `choice` props of that slot). `sanitizeAvatar(input, data?)`: unknown character → roster default; a legacy human avatar →
  `migrateHumanAvatar` (roster pick = `hash32('look', stableJson(old)) % 8`; `ACCESSORY_PROPS` glasses → round_glasses, sunglasses,
  cap → beanie, ribbon, headband, earrings → necklace, hairpin → flower_pin). `randomLook(seed)` (CPU: seeded character + 0–2
  props in distinct slots; lobby `randomAvatar` delegates), `sanitizeNpcLook` → `{npc, props}`, `sanitizePetLook` → `{pet}`,
  `sanitizeHumanAvatar` (LEGACY). Config `growthOutfits` keeps its key (= growth props on / off, 「성장 소품 값은 true/false여야
  합니다.」); the server never applies growth props (the client's `effectiveLook`).
- Migration `migrateRoomLooks(room, data?)` (idempotent, mutates, true when changed): player avatars (human → roster, the human
  AI `art` dropped), `love.candidates` / `love.partner` / `spouse` → NPC friends (species = hash of id + name + old avatar;
  `species`; accessory → props; `body` dropped), `children` → pets (species by hash, `avatar {pet}`, `species`, `body` dropped),
  `room.schoolMeetPairs[].partner`, an open prompt's `options[].partner` / `context.candidates` (copies of one partner migrate the
  same way). Called by `RoomStore.load` (every saved room; the file is rewritten on the next commit), engine `applyAction` (after the
  clone) and engine `startGame`; lobby add / update / CPU sanitize their input the same way.
- No gender: nothing reads `avatar.body` (a test greps server/game for `bodyOf` / `avatar.body` / 'boy' / 'girl').
  `balance.military {mandatory: false, volunteer: true}` (`growth.militaryMandatory/militaryVolunteer`; a legacy array counts as on
  when non-empty): nobody is drafted, everyone with 체력 ≥ `volunteerMinStr` gets the volunteer prompt (else `exempt`), adult mode
  starts `exempt`; the drafted flow (지금 / 졸업 후, service right after hiring) still works with `mandatory: true` (tested through a
  data override). Partners: `family.makePartner` = species `rng.pick(npcs.species)`, trait / ★ as before, name from `npcs.names`,
  `npcLook` (trait prop with `traitPropChance`) → partnerSpec `{id, name, trait, stars, species, avatar {npc, props}}`. Children →
  pets: `bearChild` = species `rng.pick(pets.species)`, name from `pets.names` → `{id, name, species, trait, talent, stage,
  bornTurn, avatar {pet}, growth, turns}`. CPU heuristics unchanged (they read option fields only).
- Wording (contract §4; every server label / log / prompt / line): route love 「단짝·반려」 (board routes + tones love label), 💘 새
  친구 / 🏫 고교 첫 친구 (meet prompt titles; log 「…친구가 됐다!」), 💑 같이 놀기 (date; dates 동네 산책 · 도서관 공부 모임 · 등산
  나들이 · 콘서트 관람 · 놀이공원 나들이), 친밀도, 🏡 「같이 살자!」 제안 (options 「🏡 같이 살자!」 / 「💕 조금 더 친하게 지내기」),
  🎉 집들이 파티 · 집들이 선물 · 단짝 동거 (married), 단짝 생활비 (spouse salary log 「💑 단짝 ○○의 생활비」), 🐣 반려동물 입양,
  🎂 입양 파티 (dol), 🎒 펫 훈련 학교, 🏆 펫 경연대회 (우승 / 입상 / 탈락), ⭐ 펫 스타 데뷔 + 💌 펫 광고 수입 (allowance), 천재 펫,
  🐾 반려동물 입양 지원금 (news `birth_bonus`), card `marriage_luck` 단짝운◎, awards 대가족 집사상 🐾 / 천재 펫 집사상 / 단짝·반려
  루트 메달, titles 영원한 솔로 / 고향 지킴이 / 럭키 스타, love-route tile labels, events (친구 소개 · 우정 팔찌 · 반려동물 훈련비 ·
  단짝운), 명절 잔소리 「단짝은 있니?」. Line pools (heart meet school_meet date propose* wedding birth dol child_* allowance
  route_love + era_high / era_senior / holiday_nagging lines) and MC pools (marriage, birth, proposeFail, schoolMeet; mc.json
  marriage vars + `partner`, birth vars + `child`; the MC dogs' `gender` stays, `relation` text has no 남자/여자) rewritten. Scenes:
  married / childBorn → house, dol → park, child exam / job → stage, route love / love tone / love-route events → park.
  `chiikawa-server` greps server/data (keys `_*` and legacy avatars.json skipped) and server/game strings (comments stripped) for 결혼
  신랑 신부 아내 남편 아들 딸 육아 출산 임신 남자 여자 프러포즈 축의금 돌잔치 배우자 맞벌이 호감도 데이트 자녀 연애 연인 영재 소개팅
  청혼 손주 첫사랑 부케 애인 커플 효자 효녀 신혼.
- LEGACY kept as is: avatars.json, `server/assets/partStack|tintMath|postprocess|charArt` + their tests (human avatars), the
  `/api/char-art` routes (keyed by whatever avatar JSON a character has; still off without a Gemini key).
- Scripts: `simulate.js` / `cpu-game.js` give random characters a random roster look (one meta draw, like the old body roll);
  military stats by status only; Korean report lines use the new wording. Measured after CH-1 (`simulate --games 300 --seed 11`):
  군 복무 exempt 311 / done 144 (volunteers only; was ~50 % drafted), 단짝 동거 53.3 % of adult-mode characters (love route 79–83 %),
  lifetime 65.3 %, 1.65 pets per household, 천재 펫 30.7 %, route 1st-place shares within ±3.3 pt of fair; `cpu-game` 4 CPU + 4 random
  × 100 (seed 1): CPU 87 % of wins (blue / red cards: 90 %); `--bias --games 400 --seed 1`: 10.0–15.0 %, spread −0.09.

## Chiikawa conversion (CH-1) — client (3D)
- Contract: session scratchpad `chiikawa-contract.md` §5 "3D" + `chiikawa-deviations.md` (CH-C notes). Tests:
  `test/client-pawn3d.test.js` (+ squash & stretch math in `test/scene.test.js`). E2E: session scratchpad `chc/` (`lineup.cjs`
  standalone pawn lineup via a routed page, `poses.cjs` hop pose strip, `board.cjs` / `board2.cjs` real 8-character game on the 3D
  board incl. injected heavy props, `preview.cjs` lobby picker 3D preview, `podium.cjs` ranked result → podium + group photo; screenshots
  `chc-*.png`).
- `scene/pawnParts.js` (pure): a look `{character, props}` → primitive specs. Roster data / fallbacks / look normalisation come from
  `shared/roster.js` (`rosterInfo`, `propInfo`, `normalizeLook` — old human avatars map to the same roster pick as the 2D renderer).
  `rosterEntry(id, meta)` → `{id, ears, size (0.8–1.25), mouth small|w|open, feat, colors {body, line, blush, accent, extra, eye}}`;
  `FEATURES_3D` per roster id (same meaning as `ui/chara.js` FEATURES) + ear-type fallbacks + a data entry's own `features` win:
  cap 'hachiware' (blue-grey split cap = per-triangle vertex paint in `accent`, inverted-V white split on the forehead) | 'bun'
  (Kurimanju glazed top in `accent` + shine, small round ears), muzzle (Rakko: lighter-body muzzle + nose, side ears with an accent
  inside, flat accent tail), mane (Shisa: scalloped disc behind the head, `bump {n, amp}`), tail 'plume' / nose 'accent' / eyes
  'pleading' (Momonga, ear type `tall`: tall pointed ears slanting outward with accent insides, big eyes with a glossy accent-tinted
  bottom + two sparkles, a sky-blue accent nose, ω mouth, a big accent plume tail behind the body on +x (round top + curled tip,
  `extra` fur strokes; specs tagged `tag: 'tail' | 'nose'`); no gliding membrane), pouchBag (Pochette: droopy light-accent ears, tilted
  cross-body strap + pouch). Everything is data-driven by
  `ears` + colours + features (a swapped roster entry needs no code). Figure: mochi body + wide head (frame `charaFrame(entry)`:
  head / body ellipsoids, eye line, neck ring, raised right paw `hand`, back, crown), dot eyes with a highlight (`expression: 'joy'` =
  closed ^ ^ eyes, used for the 1st place on the podium), blush ovals, tiny mouth, stubby arms (the right one raised when a hand prop is
  held, not for the soccer ball) and feet; scaled about the feet by `size`.
- Props: `PROP_BUILDERS` has a primitive builder for every props.json id (choosable + era / job props; a test checks props.json,
  `eraProps`, `jobProps`, jobs.json `props` / `partTime.props`); unknown ids → `SLOT_FALLBACK` generic shape per slot. Placed from the
  frame anchors (hats hug the head via `ringAt` / sphere caps, glasses on the eye normals, neck rings from the neck cross-section, hand
  items at the raised paw, back items behind the body). Colour (`propColor`): `tintable: true` → the character's `accent`, else
  props.json `color`, else `PROP_DEFAULT_COLORS`. Growth props are NOT applied in 3D: pawns draw `c.avatar` of game2d's display room
  (= `effectiveLook`, era / job props per slot).
- Spec extras (evaluated by pawn.js): `paint {type: cap|glaze|muzzle|belly|inner|tip|bands|swirl|half|liquid|soccer}` → `paintColor`
  on the LOCAL position (spheres: unit direction) per triangle (crisp low-poly edges), `bump {n, amp}` → `bumpFactor` (lobes around the
  local y axis, normals recomputed), `outline: t` → inverted hull in the line colour (same mesh + material: the part pushed out along its
  normals with reversed winding, only its back faces show), `flip` (reversed winding, cape lining). `specTriangles(spec)` = exact
  three.js triangle counts (hulls included). Orientation helpers `faceRot / axisRot / eulerFromAxes / rotateXYZ` (Euler XYZ).
- LEGACY: `scene/pawnHuman.js` = the old human paper-doll pawn (`humanSpecs`, `resolveAvatar`, `PAWN_COLORS`, …, re-exported by
  pawnParts.js); `pawnSpecs(avatar)` still routes a human avatar there (the legacy avatar tests), game paths call `pawnLook()` first.
- `scene/pawn.js`: `buildPawnGeometry(look, defs, {expression?, outline?})` (one merged non-indexed vertex-coloured geometry = 1 draw
  call; LRU cache of 48 looks keyed by `lookKey` incl. every resolved colour; `userData.triangles / height`), `buildSpecsGeometry`,
  `pawnHeight(look, defs)` (tag height: crown incl. ears / tall hats, not hand items), `PAWN_SCALE` 0.78 (the round heads are wider than
  the old pawns), `createPawn({avatar, defs, name, isMe})` → `{group, holder, baseScale, height, update, …}` (tag at height + 0.36).
  `defs` = the whole `/api/meta` everywhere (board3d passes `meta`); the old avatars defs still work (fallbacks).
- Squash & stretch (pure, `scene/math.js`, volume-preserving `sxz = 1/√sy`, pivot at the feet): `hopPose(k, h)` (anticipation squash
  → stretched take-off → apex → falling stretch → landing squash; `move` = horizontal progress only while airborne, `HOP_SQUASH` 0.16),
  `landPose(s)` (damped settle wobble), `bobPose(t)` (current pawn: hops with a contact squash), `breathePose(t, phase)`. board3d: each
  hop tween uses `hopPose`; after a move `P.settleAt` → 0.28 s `landPose`; idle = current pawn `bobPose`, others `breathePose`
  (desynchronised by order); tv quality / prefers-reduced-motion → no breathing / settle (hops stay).
- `scene/pawnPreview.js` (lobby picker 3D preview, same API): `createPawnPreview(canvas, {meta | defs, size})` → `set(look)` (squashy
  pop on change, camera = pure `previewFrame(positions)`: every vertex + the stand inside the round canvas while it turns —
  wings / fishing rod / balloon no longer cropped), `play('hop' | 'cheer')`, `dispose()`; breathing + slow turn. `scene/podium3d.js`:
  `createPodium3D(canvas, {meta | defs, entries, reducedMotion})` — roster pawns (1st place with `expression: 'joy'`), tag heights per
  look, celebration hops via `hopPose` (others breathe); `snapshot()` unchanged (group photo 🧊 3D style).
- Budgets (measured): per pawn bare 1,072–1,306 triangles, ≤ 1,926 with the heaviest prop in every slot (Pochette), test cap 2,000
  for every roster id × heavy + seeded random full combos; 1 draw call per pawn. Board with 8 pawns (1280 high, SwiftShader): 26–39 draw
  calls, 12–34k rendered triangles; worst case 8 heavy-prop pawns on the young loop = 36.0k scene triangles un-culled (pawns 14.3k) — ≤ 100
  calls / ≤ 50k tris holds. Podium with 8 pawns: 21–24 calls / ≈ 11k triangles.

## Chiikawa conversion (CH-1) — client (2D)
- Contract: session scratchpad `chiikawa-contract.md` §3 / §4 / §5 + `chiikawa-deviations.md` (CH-B notes). Tests:
  `test/client-chara.test.js` (roster / props / looks, renderer distinctness per roster id + species, props at anchors, expressions,
  crops, raster plug-in, rig timing, sprite / particle / parallax math, picker helpers, a §4 wording grep over public/), updated
  `client-family` (pets / NPC friends / wording), `client-growth` (growth props), `client-bluered` / `client-cutinPolicy` /
  `client-result` (wording fixtures). `test/avatarCustomize.test.js` = LEGACY human avatar contracts (modules kept, not called).
  E2E: session scratchpad `chb/` (`gallery.cjs` routed renderer galleries, `lobby.cjs` picker + props 1280 / 390, `inject.cjs` cut-ins
  with actions / family cut-ins / side list / banner, `game.cjs` natural CPU-assisted game → result + group photo; `chb-*.png`).
- LEGACY (no longer called by the game): the human 2D avatar paths of Stage 5.5-A/B/C/D — `ui/avatar2d.js` (renderAvatar,
  renderAvatarLayers, portraits), `ui/avatarCompose.js` (paper-doll compositor), `ui/customize.js` (human customizer + preview hook),
  `ui/charArt.js` (AI art slot), `growth.js` `DEFAULT_ERA_OUTFITS` / `eraOutfitTable` / `jobOutfit`. Modules and their tests stay (asset
  tools, old saves); every 2D drawing now goes through `ui/chara.js`.
- Pure `public/js/shared/roster.js` (no imports): `/api/meta.roster|props|npcs|pets` first, inline fallbacks mirroring the data
  (`DEFAULT_ROSTER` (anchors incl.), `DEFAULT_PROPS` (`choice`, `color`, `tintable`), `DEFAULT_NPCS`, `DEFAULT_PETS` (+ `size`),
  names, `DEFAULT_PET_STAGES`, `DEFAULT_ERA_PROPS`, `DEFAULT_JOB_PROPS`); `CANVAS` (1024×1536, feet y 1303, x 512), `PROP_SLOTS`
  head face neck hand back. `rosterList/rosterInfo/rosterDefault`, `propSlots`, `propList(meta, slot)` (choosable = `choice: true`),
  `propInfo` ({slot, name, icon, color, tintable, choice}), `npcList/npcInfo`, `petList/petInfo/petStages`, `lookKind` (character |
  npc | pet | legacy), `normalizeLook` (sanitize; legacy human avatar → roster pick by FNV hash of its stable JSON + accessory prop
  via `LEGACY_ACCESSORY_PROPS` — the server's migration is authoritative), `sanitizeProps`, `lookKey`, `randomLook`, `lookName`,
  growth: `eraPropsTable`, `lookEra`, `jobProps(jobId, {jobs, props})` (jobs.json `props` > props.json `jobProps` > default),
  `growthProps`, `effectiveLook(character, {room, jobs, props, job?, meta?})` (playing / finished rooms with `growthOutfits !== false`:
  era props, `job: true` eras → job props; each overrides only the chosen prop of the SAME slot; same object when unchanged).
  `growth.js` `effectiveAvatar` / `displayCharacters(room, {props, jobs, meta, overrides})` delegate to it (game2d's display room:
  `avatar` = effective look, `chosenAvatar` = chosen look; the 3D side reads the same `c.avatar`). `militaryLabel(exempt)` = 「미입대」.
- Renderer `public/js/ui/chara.js` (+ `public/css/chara.css`, linked in index.html): SVG drawn in the shared canvas coordinates.
  `chibiGeom(anchors)` derives a mochi head (top = anchors.head, chin below anchors.neck), a squat bell body, stubby arm capsules
  (shoulder pivots), feet; eyes on its own face line (`charaAnchors(look)` = the anchors the SVG rig really uses — glasses sit on the
  eyes, hand items on the right paw; raster art uses the roster `anchors`). Ears by `ears` type (nub, cat/fox, rabbit, tall, squirrel,
  bun, otter, lion, pouch, round, lamb, tuft, frog, none) + `FEATURES` per id with ear-type fallbacks + a data entry's own `features`
  (hachiware split cap, kurimanju bun top, rakko muzzle, shisa mane, momonga (ears `tall`: tall pointed ears with sky-blue `accent`
  insides, `eyes: 'pleading'` = big glossy eyes looking up with two sparkles + a thin upper-lid line, `nose: 'accent'`, `mouth: 'omega'`,
  `tail: 'momonga'` = a big sky-blue plume on the viewer's right with a curled top and `extra` fur strokes, gentler sway (`.ch-tail-i.plume`,
  rig rotations × `data-amp` 0.3); no membrane), pochette pouch bag; NPC: penguin face mask / belly /
  beak, hamster lower face + cheeks, duckling beak + tuft, panda patches + dark limbs, squirrel / fox tails, lamb wool, frog eye bumps,
  bear cub muzzle, owl eye rings + beak + belly marks). Pets have their own body plans (fish, bird, turtle, hedgehog, dog, guinea pig,
  snail; unknown species = a blob with its icon). Faces: `CHARA_EXPRESSIONS` neutral joy cry (squeezed eyes + tear streams) shock angry
  love sweat shy; eyes open `.ch-eo` / closed `.ch-ec` and mouth `.ch-mc` / open `.ch-mo` (closed / open groups carry
  `display="none"` so SVG-as-image renders right; CSS classes `blink` / `mouth-open` on the svg toggle them). Groups with pivots
  (`data-rig` root / shadow / head / earL / earR / armL / armR / tail / propR, `data-px|py`), CSS idle inner groups (`.ch-idle` breathing,
  `.ch-head-i` sway, `.ch-ear-i` twitch, `.ch-tail-i` wag, `.ch-wings`). Props: a painter for every props.json id (`DRAWN_PROPS`; hand
  items ×1.35 inside the right arm, counter-rotated `propR` so they stay upright; back items behind the body + `BACK_FRONT` straps);
  colour = props.json `color`, `tintable` → the character's `colors.accent`; unknown ids → a generic badge with the prop icon. No SVG
  ids (except raster arm clip paths). Line width scales with the rendered size (`size` px) so 26 px tokens keep a line.
  API: `charaSvg(look, {size, crop: full|fit|bust|face|head|{x,y,w,h}, expression, pose (baked key pose), title, flip, meta, shadow,
  cls})` (`FULL_VIEW` is shared → relative sizes show; rakko > chiikawa > momonga), `renderChara(look, opts)` → `.chara` element
  (`setState({expression, pose})`, `play(action, {times, ms})` → Promise, `talk(ms)`, `stop()`, `ready`; idle anim + blink 2–5 s unless
  `motion: false` / reduced motion), `renderCutinFigure(character, {pose, emotion, name, flip})` (drop-in for the old
  renderAvatarLayers: `setState({pose, emotion})`, `playSprite()` = double jump + sparkles), `preloadChara`, portraits
  `portraitHtml / renderPortrait / hydratePortraits` (drop-in names; SVG is complete on insert, hydrate is a no-op), `charaToken`
  (2D board / admin), `charaImage(subject, {expression, pose, height})` → `{img, feet}` (group photo), `setCharaMeta(meta)` (app /
  admin install `/api/meta`), `rasterParts / rasterPrefix`, `chibiGeom`, `scaledAnchors`.
- Raster contract (§3; first art accepted in CH-2 — the plug-in details as of now are in "Chiikawa art pipeline (CH-2)"): `assetInfo('<ch-id|npc-species|pet-species>-<part>')` — `base` (full
  figure, replaces the SVG body / head / arms; root squash / hop still apply), `body` + `arms` (cut-out: the arms image twice, clipped to
  the left / right half and rotated around `meta.pivots.armL|armR`), `eyes-closed` / `mouth-open` overlays (blink / talk),
  `expr-<joy|cry|shock|angry|love|sweat>` (`meta.overlay` false = swap the figure, else an overlay), `sheet-<action>` (meta `{grid,
  frames, fps, loop}` → `rig.sheetDef` → the sprite player replaces the rig for that action); props `prop-<id>` (or `_` → `-`) placed
  so `meta.anchor` sits on the slot anchor (scale `H/450 × meta.scale`). Images are `<image>` elements in the same 1024×1536 space.
- Animation `public/js/ui/rig.js`: pure `ACTIONS` (idle talk wave cheer jump cry shock walk; ms, loop), `samplePose(action, t)`
  (per-part {x, y, sx, sy, r}, eyes / mouth; jump = anticipation squash → stretched take-off → airborne arms up → land squash → jelly
  settle; cry = sob shake + heave + arms to the face; shock = startled hop + decaying tremble; volume-preserving `squashStretch`),
  `keyPose`, `restPose`, `mouthOpenAt`, `blinkDelay` (2–5 s), `partTransform` (SVG transform about a pivot), `dampedSine` / `jelly` /
  `shakeOffset` / `shakeKeyframes`, `spriteFrame` / `spriteBgPos` / `spriteDuration` / `sheetDef`, `spawnParticles` (seeded: tears from
  both eyes, sweat, hearts, sparkles, stars, puffs, notes) → `particlesSvg` (CSS-animated `.ch-pt` with `--dx/--dy`), `parallaxOffset`
  / `parallaxLayers(scene, assetUrl, single)` (`bg-<scene>-far|mid|near`). DOM: `createRig(svg)` (one shared rAF ticker; `play`,
  `loop`, `stop`, `destroy`; drops rigs removed from the page; a group's `data-amp` scales its rotations), `createSpritePlayer`, `screenShake` (WAAPI), `attachParallax`,
  `prefersReducedMotion` (reduced → key poses, no loops / particles motion).
- Cut-ins (`cutin2d`): cast slots `.ci-slot.chara-slot` (aspect 0.78, 80 % height; pets × `childScale`) with `renderCutinFigure`;
  poses → rig loops (wave / cheer / cry) or one-shots (jump / shock), emotions → faces + particles (tears / hearts / sweat /
  sparkles); the speaker's mouth flaps while its bubble shows (`talk`), a shock shakes the window (`screenShake`), big wins double-jump;
  layered parallax backgrounds when `bg-<scene>-far|mid|near` exist (`.ci-plx`). Family looks: married / childBorn → scene house, dol →
  park, proposal → park, 🏡 frame for the 집들이 party.
- Lobby picker `public/js/ui/picker.js` (replaces the customizer in app.js): `openCharaPicker(host, {title, initial, submitLabel, onSave,
  onCancel, meta})` → `{destroy, getAvatar}`; reuses the `.cz-*` dialog shell; 8 roster cards (live idle figures, radiogroup, arrows),
  slot tabs 🎀 머리 · 👓 얼굴 · 🎗️ 목 · 🎈 손 · 🎒 등 (`jinsei.cpSlot`), prop grid (「없음」 + thumbnails of the current character
  with that prop, crop by slot via `propThumbCrop`), 🎲 이 자리만 / 전체 랜덤, live preview (2D rig with 👋 인사 / 🎉 점프 / 🙌 만세 /
  😭 울기 chips, or the 3D pawn via `scene/pawnPreview.js` with `defs: meta`), the name follows the chosen character until typed
  (`autoName`). Saves `{name, avatar: {character, props}}`. Pure helpers `propThumbCrop`, `randomizeSlot`, `autoName`,
  `rosterCardsModel`, `propsSummary`.
- Everything drawn with chara.js: lobby cards (bust), HUD / side list / now-playing / decision sheet / trade dialog / card sheet
  (face), cut-in cast + tabs, banners, result ranking / CSS podium / MVP cards, group photo (`charaImage` with baked poses: v → wave,
  만세 / 점프 → cheer, 하트 → love face; `FIGURE_SCALE` 1.0), 2D board tokens (`charaToken`), admin room detail. NPC friends
  (`{npc, props}`) and pets (`{pet}`) use the same renderer (`family.npcLook / petLook / npcCharacter`).
- Family wording (§4) in the client: `family.js` `FAMILY_WORDS`, `CHILD_STAGES` 새끼 / 꼬마 / 청소년 / 어른 (pets.json stage names win),
  `childScale(stage, {meta, species})` = stage scale × species size × `PET_SLOT_BOOST` 1.45 (0.5..1), `CHILD_GROW` 입양 파티 (park) /
  펫 훈련 학교 / 펫 경연대회 (stage) / 펫 스타 데뷔 (stage), `PET_CONTEST` 우승 / 입상 / 탈락, `familyIcons` 💞 단짝 / 💕 단짝 후보 + pet
  species icons (🌟 천재 펫), `familySummary` 「💞 단짝 ○○(★3) · 반려동물 n마리」, `familyTagBadge` 💞🐾n🏠; partner view models carry
  `species / speciesName / speciesIcon`. familyArt (새 친구 cards 「💘 친구 하기」, 🏠 단짝 생활비, 친밀도 bar, 「같이 살자!」 /
  「조금 더 친해지기」, side detail 단짝 후보 / 단짝 / 반려동물), cutinMap tags + fallback texts, cutin2d chips (집들이 선물, 🐣 입양, 펫 광고
  수입, 단짝 생활비), game2d floats / toasts / result family line, cards.js 단짝운◎, cutinPolicy route desc, houseArt 입양 파티 table,
  admin 「성장 소품」. `client-chara` greps public/ (legacy avatar modules and scene/ excepted) for 결혼 자녀 출산 육아 프러포즈 배우자
  맞벌이 축의금 돌잔치 돌잡이 신랑 신부 남편 아내 아들 남자 여자 임신.

## Chiikawa art pipeline (CH-2)
Hand-delivered Chiikawa-style art (the user's local Gemini skill; the API stays OFF here) → `node scripts/import-assets.js
--dir <folder>` → placed / split / keyed parts in the manifest → the chara.js raster plug-in. Requests: `docs/asset-requests/
chiikawa-full.json|.md` (95 images), `chiikawa-test.json` (the delivered test batch), `chiikawa-mc.json|.md` (25 MC images);
**current: `remaining-all.json|.md`** (2026-10-30, every image still missing — 383, groups A–J by priority, 10 per batch) built by
`node scripts/gen-asset-guide.js [--dry-run] [--out dir]` (drops items accepted in the Chiikawa style — import / upload from
2026-10-16 on; reuses the earlier requests' prompts, restyles the old manifest descriptions of cards / items / treasures / icons;
gen-chara-manifest reads it first). 10-29 batch: usagi + hachiware complete (`ch-hachiware-base-reframed` became the base),
chiikawa joy / shock, kurimanju / rakko / shisa bases; the delivered Momonga was off-model and is NOT imported (redrawn from the
user's own reference as the 2nd ref); `ch-kurimanju-eyes-closed` is not requested (its base already has closed eyes).
Tests: `test/chara-pipeline.test.js` (+ the updated `assets-manifest`, `stage7-import`, `client-chara` expectations). E2E: session
scratchpad `ch2/` (`e2e.cjs` real game 1280 + 390: picker, cut-ins, penguin, chef hat, side list, result, photo; `mc-e2e.cjs`
synthetic MC overlays; screenshots `ch2-*.png`, animated `ch2-cutin-anim.webp`).
- Manifest (`node scripts/gen-chara-manifest.js [--dry-run]`, idempotent upsert; reads roster / npcs / pets / props.json and the
  request JSONs for prompts + refs; keeps status / accepted / output and every importer-measured meta field): kind **`chara`**
  (meta `{character|npc|pet: data id, part}`; `ch-<roster id>-{base, body, arms, eyes-closed, mouth-open, expr-joy, expr-cry,
  expr-shock, expr-angry, expr-love, expr-sweat, sheet-jump}` ×8 (angry / love / sweat added 10-30: without them a drawn character
  keeps its plain face for those emotions), `npc-<species>-base` ×10, `pet-<species>-base` ×8 → `chara/<ch|npc|pet>/<slug>/<part>.webp`), kind
  **`prop`** (meta `{prop, slot}`; `prop-<props.json id>` ×60 → `chara/props/<slug>.webp`), and kind `mc` overlays
  `mc-<dog>-eyes-closed|mouth-open` (meta `{mc, part, base: mc-<dog>-neutral}`, `mc/<dog>/<part>.png`). Ids use `-` for data ids
  with `_` (`npc-bear-cub-base`, `pet-guinea-pig-base`, `prop-chef-hat`); the renderer looks both spellings up. Validation
  (`manifest.js`): chara = exactly one owner field + `CHARA_ITEM_PARTS_RE` part (+ `rect` / `grid` shapes), prop = `PROP_ITEM_SLOTS`
  slot, mc = exactly one of expression / pose / part. `studio.upload` refuses kind chara (placement is import-only); new
  `studio.publish(id, png, {meta, from})` (accepted `source: 'import'`, meta merged, `bytes`) and `studio.patchMeta(id, patch)`.
  The existing `bg-*` / `mc-*` ids / outputs stay — new Chiikawa art simply re-accepts them (old anime-style bg / MC / frame art
  stays live until then).
- Names (`server/assets/charaIds.js`, pure): `<id>.png` beats `<id>_original.jpg`; `<id>-2.png` = a second take, used only with
  `--take 2` (all) / `--take <id>=2[,…]` or when take 1 is missing (the `-<n>` suffix splits off only when the rest is a known id).
  Aliases: `ch-<c>-<joy|cry|shock|…>` → `ch-<c>-expr-<e>`, `ch-<c>-noarms` → `ch-<c>-body`, `ch-<c>-jump` → `ch-<c>-sheet-jump`,
  `npc-friend-<s>` / `npc-<s>` → `npc-<s>-base`, `pet-<s>` → `pet-<s>-base`, `bg-ch-<scene>` → `bg-<scene>`, `prop-hat-chef` →
  `prop-chef-hat` (slot word first → last), `_` → `-`; `--only` / `--take` accept delivered names too. After a successful import
  every file of that id (all takes + originals) leaves the inbox unless `--keep`. Import order = `importRank` (chiikawa base → other
  bases → bodies → overlays → sheets → MC neutral → MC overlays → props → the rest). The run ends with the bytes added.
- Image steps (`server/assets/charaPipeline.js`): `keyBackdrop` = corner-sampled backdrop (measured G 26–65, never #FF00FF),
  distance + magenta-hue ramp, but only on pixels flood-filled from the border (outlined interiors — a purple bow tie, blush — stay
  opaque); enclosed holes cleared by distance; specks < 30 px dropped (shock lines / tear drops survive). **Placement**: ONE
  transform per reference family, normalised by the image height (`familyFrom` → `{unit, cx, feet}`): the accepted
  `ch-chiikawa-base` maps its figure head-top → y 420 … feet → y 1303, feet-band centre → x 512; every image drawn with it as the
  reference (other bases, npc / pet bases) uses that scale, and a family's edits use their base's applied transform
  (`meta.placement`). Per image only a translation correction when its own feet / centre deviate > 2 % / 3 % of the image height
  (logged 「⚠️ 발 위치 보정」; e.g. the test penguin drawn without the reference: −6.6 %, kept 0.81× smaller). Edits are also
  registered ±4 px (`registerEdit`, logged). Stored at **`CHARA_RES` 0.75** (768×1152 logical canvas ≈ the sources' own figure size;
  measured decode of an uncropped canvas 8.5 / 14–17 / 26 ms at 0.5 / 0.75 / 1.0) and **cropped to content** with `meta.rect`
  [x, y, w, h] in logical units (base ≈ 23 KB, eyes overlay 1 KB); the placed base is cached losslessly in `DATA_DIR/chara-src/`
  for edits delivered later (else the published WebP is used).
- Derived parts: `-noarms` → `-body` (placed) + **`-arms`** = base − body (alpha / colour > 64, opened, the largest component per
  side, only pixels OUTSIDE the arm-less body — at rest the body outline shows as a thin crease, raised arms never drag a white
  junction patch over the outline) with `meta.pivots` (centre of each arm's contact with the body) and `meta.hands` (80 % to the
  tip; also written into the base's `meta.anchors.handL|R`). Base meta: `anchors {head (head top between the ears), face (eye line),
  neck (chin), handL, handR, back}`, `eyes`, `headBox`, `headWidth`, `bbox`, `placement`, `source`. **Overlays** (eyes-closed,
  mouth-open, expr-*): placed + registered edit − base inside the face box (expressions: wider — 240 above the figure for shock
  lines, down to 45 % of chin→feet for tears), opened, specks dropped, dilated 4, holes filled → the edit's own pixels (they cover
  the old eyes / mouth), `meta.overlay: true`; an expression that changed more than 2 500 px (at 0.75) or 25 % of its face change
  outside the box (arms moved) is a full swap (`meta.overlay: false`). Test batch: cry = overlay (16 551 px in the face, 0 outside).
  **Sheets** (`sheet-<action>`, 2×2): keyed, sliced, ONE scale = base head width ÷ median frame head width (`headSpan`: widest run
  through the centre column in the top half — the body squashes, the head doesn't), feet on y 1303, feet centre on x 512, every
  cell the same crop of the canvas → meta `{res: 0.5, rect, grid: [2, 2], frames: 4, loop, seq, frameMs}` (jump: seq 0 1 2 1 3 /
  180 150 190 100 230 ms = in step with the rig hop) + `heads` (per-frame head offset from the base's head). **Props**: white →
  alpha (border flood fill), trimmed, ≤ 384 px, `meta.anchor` = slot attach point (head [0.5, 0.84] of the box: a hat sinks into
  the head; face centre; neck top; hand [0.5, 0.62]; back centre) and `meta.scale` = slot width (H units: head 0.78, face 0.66,
  neck 0.5, hand 0.36, back 0.72) × 450 ÷ width. **Backgrounds** keep the old path (cover 1920×1080, upscaled from 1376×768).
  **MC**: keyed the same way and fit into the item size (old PNG paths; the 16:9 `mc-duo` fits into 3:2 with transparent bands);
  `mc-<dog>-eyes-closed|mouth-open` = overlays of the published neutral (box = top 80 % of the figure) with `meta.rect` in the
  1024² square + `meta.size`.
- Renderer plug-in (`public/js/ui/chara.js`, SVG fallback unchanged): `rasterParts` also returns the art's `anchors / eyes / headBox
  / bbox` and looks ids up with `_` → `-`; `rasterGeom` = chibiGeom of the art anchors with the measured head half-width / centre and
  eye spacing → props, crops (face / bust / fit / head) and particles follow the drawing; pets crop to `meta.bbox`. `imgOf` places
  each part at `meta.rect` (`preserveAspectRatio="none"`). Draw order body → expression overlay → blink / talk overlays → arms; blink
  / talk overlays only on the neutral face. The hand item rides in the right arm's rig group (counter-rotated `propR`, at the art's
  hand anchor). Sheets with `rect` play INSIDE the svg right after `.ch-raster` (`createSpritePlayer(host, sheet, {mount, after,
  onFrame})`, a nested `<svg>` whose viewBox walks the cells; `.chara.sheet-on .ch-raster` hidden; head / neck / face / back props
  follow `heads[i]`, hand items hide) while the rig keeps the root hop (`rig.play(action, {squash: 0.2})` — the drawn frames carry
  the squash); a redraw stops a playing sheet; `spriteFrame` / `spriteDuration` / `sheetDef` know `seq` / `frameMs` / `rect` /
  `size` / `heads`. `charaImage` (group photo) composes raster art on a canvas in the FULL_VIEW box (props behind / in front as
  vector-only SVG layers via `charaSvg({only: 'back'|'front'|'hand'})`, raster props via `rasterPropBoxes`, arms + hand item rotated
  by the pose's key pose) → the PNG export never taints. `preloadChara` warms every part.
- MC (`public/js/ui/mc.js`): `mcOverlays(id)` (`findAsset({kind:'mc', mc, part})`), `overlayStyle` (percent box + a transform-origin
  on the art's bottom centre so overlays breathe with it), `mcTalkMs(line)`; `renderMc` adds `.mc-ov` images only on the neutral
  art (`can-blink` / `can-talk`), blinks every 2–5 s (`.mc.blink`), `el.talk(ms)` flaps `.mc.mouth-open` with the rig's talk beat,
  `el.hush()`; `booth.say` flaps for `mcTalkMs(line)` and hushes the other dog; no overlays / reduced motion → the old behaviour.
- Import a delivered zip: unzip into its own folder (e.g. `assets-inbox/<batch>/`), `node scripts/import-assets.js --dir
  assets-inbox/<batch> --dry-run` (mapping, takes, replacements), then without `--dry-run` (add `--take <id>=2` for a preferred
  second take, `--keep` to leave the files). Bases must come first (same run or earlier); an edit without its base fails with
  「기본 그림(…)을 먼저 가져와야 해요」. Re-importing a base warns that its body / overlays / sheet need re-import too. Then
  `npm test` and a look in the game (`?debug=1`, cut-ins via `window.__cutin.show(spec)`).
- Test batch imported (2026-10-16, takes 1 except `ch-chiikawa-sheet-jump` take 2 and `bg-ch-park` take 2): chiikawa base / body /
  arms / eyes-closed / mouth-open / expr-cry / sheet-jump, hachiware base, npc-penguin-base (take 1, no reference → corrected),
  prop-chef-hat, bg-park — 305 KiB of art added (10 chara + prop WebPs 183 KiB, bg 122 KiB); the manifest grew by the 154 items.
- Tile icons (`scripts/gen-world-manifest.js`, todo): `icon-<type>` (kind icon, meta `{tile: type}`, `icons/<type>.png` next to
  `icon-money` …) for start event salary pass hometown temple jeju reversal island contest auction hunt weed merge. Houses: manifest
  kind `house` (meta `{house}`, `house-<slug>` → `houses/<slug>.png`, same white-background pipeline; gen-world-manifest) — houseArt.js
  already asks `findAsset({kind:'house', house})` and keeps its SVG until one is accepted. board3d's atlas
  asks `scene/tileIcons.js` `findTileIcon(type, {glyph, world, find})`: `tileIconCandidates` = 📝 → school, the type's OWN icon, then
  the borrowed one (`ICON_ASSET_TILE` salary → money, pass → shop, heart → love, loss → bad, habit → school …); none accepted → glyph.

## World setting (치이카와 모드 / 현실 모드) — server
Contract: session scratchpad `cworld-contract.md` (FIXED) + `cworld-deviations.md`. Tests: `test/cworld.test.js` (+ updated
`chiikawa-server` (jobProps of both worlds, wording grep over `server/data/worlds/`), `presentation` (sample events, the scene
fallback CHAIN), `assets-manifest` / `chara-pipeline` / `client-chara` counts). Roadmap row 14 in `docs/PLAN.md`.
- Room config `world: 'chiikawa' | 'real'` (`config.js` `WORLDS`, 400 「세계는 치이카와 모드(chiikawa) 또는 현실 모드(real) 중 하나여야
  합니다.」): `defaultRoomConfig()` / `validateRoomConfig({})` = **'chiikawa'** (new rooms); inside the engine a missing / unknown
  `config.world` = **'real'** (`worldOf`) → old saves, `makeRoom` engine tests and every pre-world fixture play today's content.
  Admin create form 「세계」 select (always sent) + hint, room detail 「세계」 line (`worldText`), `adminSummary.world`; the lobby shows
  it on its own world line (`#lobby-world` 「<b>🐹 치이카와 모드</b> · desc」; no longer repeated in the mode line). Only the CONTENT differs (rules, roster looks, family rules are shared).
- Data: the data files ARE the real world. The Chiikawa world = overlay `server/data/worlds/chiikawa.json` `{<dataName>: patch}`
  (loader: `loadData('worlds/<id>')` — one sub-folder allowed — `getWorldOverlays()` = `{chiikawa}`). Pure module
  `public/js/shared/world.js` (no imports; `server/game/world.js` = `export *` + `dataForWorld(world, data?)` / `roomData(room,
  data?)`): `WORLDS`, `DEFAULT_WORLD`, `ENGINE_WORLD` 'real', `WORLD_INFO` [{id, name, icon, desc}], `worldOf`, `worldInfo`,
  `worldLabel`, `applyPatch(base, patch)` (an array of `{id}` objects patched by `{replace: {id: fields}, add: [entries], remove:
  [ids]}` — replace shallow-merges, a null field deletes, add of an existing id replaces it; order remove → replace → add; plain
  objects deep-merge, arrays / scalars replace, `null` deletes a key, `_` keys are comments; unchanged subtrees are shared),
  `patchProblems(base, patch)` (unknown replace / remove ids, duplicate adds — the shipped overlay has none, tested),
  `worldData(data, world, overlays)` (real → `data` itself; else memoized per (data object, world, overlays), deep-frozen; a merged
  object is resolved from its base, never patched twice), `dataWorld(data)`. `gameData()` is now cached (one frozen object, the
  memo key) and adds `hunts`.
- Resolution: engine `makeCtx` (applyAction / startGame / migrateLoopBoard / result actions), `endGame`, `result.computeRanking` /
  `applyResult`, every exported `cpu.js` entry point (`data = roomData(room, data)`), `scripts/*` — so all engine code reads the
  world's jobs, items, cards, events, news, pools, lines, numbers without per-call checks; a test's `ctx.data` override is respected
  (and gets the overlay in a Chiikawa room). `jobs.jobDef` falls back to the real-world job for an id missing in the world (old save).
  presentation reads treasure / house / monster names from `data` (no `getTreasures()` defaults left in the MC paths).
- `/api/meta` = the real meta + `worlds` (WORLD_INFO) + `worldOverlays` ({chiikawa: the overlay as stored}) + `hunts` + `balance.
  lottoMode | kuji | weed`; `/admin/api/meta` + `worlds`. The client resolves `worldData(meta, room.config.world, meta.worldOverlays)`
  (the overlay's `lines.mc` pools land on `meta.lines.mc`; the real meta keeps them under `meta.mc.lines`).
- 치이카와 jobs (overlay `jobs`: remove the 21 human jobs, add 12 + 4 hidden; landlord / mountain_spirit kept; `partTime` 「갑옷씨네
  노동」 🪖 노동 견습 / 반장 / 대장, scene workshop): weeder 풀뽑기 일꾼 (weed ≥ 1, `salaryPerWeedLevel` 0.1, `paydayWeedExam`), hunter
  토벌대 (str 4 + iron_body, merit from rank 3 = `rankUp.meritFrom`, `paydayPatrol` small_chimera, injury 0.12), ramen 「郎」 (str 3 +
  tongue), workshop 갑옷씨 공방 (int 4, merit for 공방장), bookstore 고서점 (int 5 + research), busker 길거리 가수 (charm 4 + charisma,
  merit for the top), pancake, photographer, sento, delivery, fisher, cafe (salaries ≈ 25–55 → 90–170); hidden legend_hunter
  (hunts ≥ 8 & str ≥ 8, patrols too), weed_sage (weed = 5), ramen_owner (max rank ramen & net worth ≥ 1500), armor_san (max rank
  workshop & int ≥ 8). `jobs.js`: `requires.weed` / `requires.hunts`, `unlock.weed` / `unlock.hunts`, `meritNeeded(def, toRank)`,
  news `jobSalaryMult {jobId}`, `PAYDAY_HOOKS` (hunt.js registers the payday patrol / 검정: a patrol win = hunts +1 (log only), a
  payday 검정 pass = `weedResult {action: 'exam', payday: true}`, a fail = tries +1). props.json `jobProps` holds both worlds' jobs
  (tested); `pledge` = busker in the overlay; CPU `dreamJobs` per personality from the world's list; clubs `jobs` re-pointed.
- 토벌 (`server/game/hunt.js`; tile `hunt` ⚔️ in base `board.json.tileTypes`, only the overlay pools have it: young / middle_age
  main 3, career route 3, money route 1; never kids eras / the final race): prompt `hunt` (resultCutin 'auto') — a monster drawn
  when it opens (hunts.json `monsters` small_chimera 꼬마 키메라 p1 / chimera p2 / big_chimera p3 / dekatsuyo 데카츠요 p4 middle_age,
  weighted by era), options `fight {chance, reward [lo, hi], monsterId, armor?, sasumata?}` / `run` (default); context {monsterId,
  monster {id, name, icon, power}, chance, reward, armor, sasumata, era}. chance = base[power−1] (0.85 / 0.65 / 0.45 / 0.28) + 0.03
  × 체력 + 0.015 × 운 (+0.1 사스마타 item `huntBonus`, +0.04 × rank for hunter jobs) ∈ [0.05, 0.95]; reward × eraScale (young 1,
  middle_age 1.4) × news `huntRewardMult` × CPU income handicap. Win → `huntResult {charId, monsterId, chance, armor, sasumata,
  success: true, amount, injured: 0, hunts}` then moneyChanged `hunt`, hunts +1, 체력 +1 at 30 %, a merit card at 35 % for 토벌대.
  Lose → loss int(20..50) × eraScale (갑옷 `huntArmor` halves; 실손 보험 / 액땜 via applyLoss — `amount` = the actual loss) and,
  with a job and no armor, an injury at 0.6 × news `huntInjuryMult` (건강기원 부적 / 건강 부적 prevent; `huntResult.injured` = turns
  + the 🤕 status card, no separate `injured` event). Run → `promptResolved {kind: 'hunt', result: 'run', monsterId}` (cutin false,
  tag hunt_run). Records `huntPrompts / huntRuns / huntLosses`; highlights (데카츠요 win 7+, big wins, a painful defeat).
- 풀뽑기 검정 (hunt.js; tile `weed` 🌿: middle / high main 3 (kids eras: work + free exams), young / middle_age main 2, love route 2):
  `character.weed {level 0..5, tries}` (1 = 5급 … 5 = 1급, `weedGrade`), prompt `weed` options `work {amount}` (default; base 20 ×
  (1 + 0.5 × level) × eraScale (middle 0.5, high 0.6, young 1, middle_age 1.3) × 1.5 for weeder jobs × news `weedMult` × CPU
  handicap; 체력 +1 at 25 %) / `exam {chance, fee, price, level (target), grade}` (fee [5,10,20,30,40] × eraScale, kids eras free;
  disabled at 1급 or when short of cash; chance = base [0.7, 0.55, 0.42, 0.3, 0.2] + 0.025 지력 + 0.02 체력 + 0.01 운 + 0.05 per failed
  try (≤ 0.15) ∈ [0.05, 0.9]). → `weedResult {charId, action: work|exam, level, grade, amount? | success, target, chance, fee?,
  payday?}` (anchor) then moneyChanged `weed` / `weedFee`. `balance.json.weed` (base) holds the knobs.
- 쿠지 (holidays.js `kujiDraw`, `balance.lottoMode` 'numbers' (base) | 'kuji' (overlay)): at the era opening every holder of a
  `lotto` card (🎟️ 쿠지 응모권) draws one ticket (seeded) from `balance.kuji.prizes` (1등 0.02 money 150 + treasure `kuji_plush`
  (overlay add, weight 0, 60–120 since E2E-4 (was 100–200)), 2등 0.06 money 60, 3등 0.15 a random card, 4등 0.27 money 10 + 체력 +1, 꽝 휴지); news `kujiLuck`
  multiplies the chances of `luckRanks` 1–3 (꽝 shrinks; Chiikawa `lotto_fever` 1.25). `lottoDraw {eraId, kuji: true, entries [{charId,
  rank, prize {name, money?, cardId?, treasureId?, stats?}}]}` (no numbers; lines per entry) then moneyChanged `kuji` (CPU handicap),
  statChanged `kuji`, cardGained `{source: 'kuji'}`, treasureFound `{source: 'kuji'}` (`treasures.giveTreasure`). `room.lotto.draws`
  keeps `{eraId, kuji: true, entries, at}`. `kujiExpectedValue(data, {luck})` (money + card at 0.5 × mean price + plush mean) = 14.55
  (17.51 with the fever; 15.75 / 19.01 before the E2E-4 treasure cut) < price 20 (tested). Records count kuji money as `luckWin`; highlights for 1등 / 2등.
- Presentation: `EVENT_TYPES` / `CUTIN_TYPES` / `BOUNDARY` / prompts `ANCHOR_TYPES` + huntResult, weedResult; `SCENES` + weed-field
  hunt-forest ramen-shop workshop sento bookstore cafe kuji (tones.json scenes + `sceneFallbacks` park / mountain-trail / kitchen /
  office / house (→ office chain) / office / kitchen / shop; manifest `bg-<scene>` todo); prompt looks hunt (career, shock,
  hunt-forest) / weed (good, joy, weed-field); tags hunt hunt_win hunt_lose hunt_run weed weed_work weed_pass weed_fail (base lines,
  placeholders + `{monster}` `{grade}`); lottoDraw kuji → scene kuji, best = the best won rank. MC situations (base mc.json + pools):
  huntWin (medium, big for a power-4 monster), huntLose (medium), weedPass (medium, big at 1급) — `mcSituationFor` can promote a
  situation to big per event. Awards metrics `hunts`, `weedLevel`; title facts `hunts huntPrompts huntRuns huntOnlyRan weedLevel`.
- Overlay content (real files untouched): items (킥보드 · 고서점 책 꾸러미 (bookstore / photographer / busker +10 %) · 사스마타
  (`huntBonus`) · 포셰트 · 네잎클로버 · 목욕탕 평생 회수권 + new `armor` 갑옷 250 (`huntArmor`) / `guitar` 하치와레표 기타 200 (charm
  +1, busker +10 %)), cards (names / icons / desc; `texts {block | hit | miss | exp | fine}` re-word 사스마타 방어 / 나쁜 녀석 습격 /
  일거리 뺏기 logs — real logs unchanged), treasures (22 renamed + kuji_plush), events (≈ 40 rewrites + 19 new: pancake_party sento_day
  ramen_bowl chimera_flee usagi_yaha rain_umbrella picnic_day island_trip hachiware_song momonga_tantrum kurimanju_cheers rakko_training
  labor_reward weed_job kuji_miss armor_shop_sale shisa_bakery pochette_fashion chimera_reward), money / loss labels, news (renamed +
  chimera_surge / weed_boom / ramen_price; new effect keys huntRewardMult huntInjuryMult weedMult jobSalaryMult eventMult kujiLuck in
  `NEWS_DEFAULTS`), habits labels, `balance.shop.title` 「🛍️ 갑옷씨 상점」, awards (+hunt_king 토벌왕 hunts ≥ 3 / 40 split, weed_master
  풀뽑기 명인상 level ≥ 3 / 35 all — E2E-4; was 60 / 50), titles (만년 풀뽑기 일꾼, 쿠지 인생, + 사스마타 마스터 hunts ≥ 5, 평화주의자 (≥ 3 hunts, always ran),
  풀뽑기 1급), line pools that named 회사 / 코인 / 로또 … and MC job / lotto (쿠지) pools.
- Props (base props.json, world-independent; the client draws them): sasumata, armor_helmet, guitar, head_towel (choosable → 34),
  weed_basket, ladle, hammer, turner, delivery_box, armor_plate; `shared/roster.js` DEFAULT_PROPS / DEFAULT_JOB_PROPS mirror them.
  Manifest (todo): `prop-<id>` ×10 (`gen-chara-manifest.js`), `bg-<scene>` ×8, `monster-<id>` ×4 (kind item, `meta.monster` — the
  item validator now takes `meta.item` OR `meta.monster`), `item-armor`, `item-guitar`, `treasure-kuji-plush`.
- CPU (`cpu.js`): hard `answerHunt` (EV: chance × (mean reward + pursuit of 전설의 토벌자) − (1 − chance) × (mean loss + injury ≈
  0.6 × salary), cautious margin 20 / bold −10) and `answerWeed` (exam when chance × level value (35 + 120 if the target job needs it
  + 60 for weeders + 50 toward 1급) − fee > the work pay; kids eras → exam); real CPUs: overlay `balance.cpu.prefs.hunt|weed` +
  personality tables (🐢 run 4 : fight 1, work 3 : exam 1; 🔥 fight 4 : run 1, exam 3 : work 1) + `dream` (weed exam toward 풀뽑기
  일꾼, fight toward 토벌대). `jobDeficit` counts missing weed levels / hunts; `tileWorth` hunt 40 / weed 20; shop worth of 사스마타 / 갑옷.
  The handicap covers hunt rewards, weed pay and kuji money (`effectsFor(...).incomeMult`).
- Scripts: `simulate.js --world real|chiikawa` (default real; the header prints the world; block 「세계 설정」: 토벌 visits / fight
  rates per policy / wins per monster / money per visit, 풀뽑기 visits / exam rates / pass rates per grade (검정소) + payday passes /
  final levels, hidden jobs held, the kuji line replaces the lotto line), `cpu-game.js --world` (also `playCpuGame({world})`,
  `targetMatrix({world})`).
- Measured (final data; `simulate --games 300 --seed 11`, real world same harness 200 games in brackets): lifetime spins per
  character random 49.1 / CPU 49.8 (real 49.5 / 50.3); decisions per lifetime character 37.7 / 36.6 (real 36.6 / 36.0; hunt 1.64 /
  1.72, weed 1.55 / 1.51); payday share of income 22.7 / 31.9 % (real 20.5 / 30.1); final jobs random top 섬 낚시꾼 15.4 %, lowest
  regular 풀뽑기 일꾼 1.7 %, CPU top 사진사 / 섬 낚시꾼 12.1 %, lowest 풀뽑기 일꾼 1.5 %, 알바 0 %; hidden held random 5.7 % (전설의
  토벌자 0.2, 풀뽑기 1급 명인 0.3, 갑옷씨 0.5) / CPU 14.5 % (0.6 / 1.0 / 1.4, 산신령 4.8, 건물주 4.0); 토벌: 1.6–1.7 per adult character,
  fight 51 % random / 57 % CPU, win 88–89 %, +39–42만원 per visit (+74–78 per fight), injuries ≈ 3 % of visits; 풀뽑기: 1.5–1.6 per
  character, exam 48 % random / 54 % CPU, 검정소 pass 5급 ≈ 90 % · 4급 86–87 % · 3급 64–77 %, + 71–76 풀뽑기 일꾼 payday passes
  per 300 games, +8.5만원 per visit, final level ≥ 1 ≈ 39 %, 1급 0.8–1.3 %; kuji 9–10만원 cash per ticket (EV
  15.75 incl. card / plush); route 1st-place shares vs fair: random young love / career / money 22.6 / 16.0 / 19.2 (fair 19.2 / 19.4 /
  18.6), middle_age 20.4 / 14.9 / 21.7 (19.8 / 19.0 / 18.6); CPU young 24.2 / 13.6 / 21.5, middle_age 20.8 / 15.2 / 22.3 (the real world
  under the same harness: career −3 to −5 pt as well); all chiikawa titles reached (random). `--bias --world chiikawa --games 400
  --seed 1`: 1st-place share 9.5–15.3 %, first→last average rank spread 0.12. `cpu-game --matrix --world chiikawa --games 200 --seed 1`:
  casual 1 + 3 CPU human 1st 95.5 %, random 1 + 3 86.5 %, casual 2 + 2 99.5 %, casual 4 + 4 100 %, expert 1 + 3 100 %, adult 97.5 %,
  kids 100 %, skill 97.5 / 91.5 %, vs all-🐢 / 🙂 / 🔥 97.0 / 99.5 / 98.5 % (every target ✅).
- Client side: see "World setting — client" below.

## World setting (치이카와 모드 / 현실 모드) — client
Contract: session scratchpad `cworld-contract.md` §0 / §2–§8 + `cworld-deviations.md`. Tests: `test/client-world.test.js` (+ the prop
painter / builder tests of `client-chara` / `client-pawn3d`). E2E: session scratchpad `cwb/` (`inject.cjs` injected state / events in a
🐹 room on the real server: A 1280 3D, B 390 2D, C 390 2D `?cutins=off` (2D sheet), then a 🏙️ room; `game.cjs` natural chiikawa game
with 2 CPUs; `lineup.cjs` 3D pawn lineup; `props2d.mjs` / `art.mjs` sharp contact sheets; screenshots `cwb/cwb-*.png`).
- World meta: `shared/world.js` `worldMeta(meta, world)` = `worldData(meta, world, meta.worldOverlays)` + the two meta-shape aliases
  (the overlay's `tones` patch also lands on `meta.presentation`, its `lines.mc` pools on `meta.mc.lines`), memoized, frozen; the real
  world / no overlay = `meta` itself; a world meta passed again resolves to itself (and `'real'` back to the base). app.js
  `roomMeta(room)` (lobby label + MC greeting, picker, the game UI's `getMeta`); game2d wraps its `getMeta` once more with the shown
  room (`ui.rawRoom`, so injected / switched rooms resolve too) → cut-ins, banners, result show, 3D board (`meta` at creation), side
  list all read the world's cards / items / jobs / treasures / news / awards / titles / scene labels / MC pools. `window.__game.getMeta`
  (debug). Lobby `#lobby-world` line = `worldInfo(world)` icon · name · desc. Admin keeps the real admin meta (+ its world select /
  room-detail line from CW-A). Fallbacks for ids only the 🐹 world has: `growth.WORLD_JOB_FALLBACK` (16 jobs, `jobInfo`),
  cards.js `DEFAULT_ITEMS.armor / guitar`, submaps.js `WORLD_TREASURE_FALLBACK.kuji_plush`; other `DEFAULT_*` stay real-world.
- Pure `shared/worldPlay.js` (imports growth.js only): `WORLD_TILE_TYPES` (hunt ⚔️ #c0392b / weed 🌿 #6ab04c = board.json, tested),
  `DEFAULT_MONSTERS` / `MONSTER_IDS` / `monsterList` / `monsterInfo` (meta.hunts wins), `huntsOf`, `isHuntRun` (promptResolved hunt
  run), `huntPrompt(p)` → {monster, fight {chance %, reward, armor, sasumata, badges}, run, danger easy|mid|hard}, `huntOutcome(e)`,
  `isHuntBig` (a power-4 데카츠요 win), `WEED_MAX` / `weedGrade` (0 무자격, 1 = 5급 … 5 = 1급) / `weedLevelOf`, `worldTags(c)` (🌿 n급 when
  level > 0, ⚔️ 토벌 n회 when hunts > 0), `weedPrompt(p)` → {level, grade, maxed, work {amount}, exam {target, grade, chance %, fee,
  free, disabled, reason}}, `weedOutcome(e)`, `isWeedBig` (1급 pass), `isWeedWork`; kuji: `KUJI_RANKS` (1등 🧸 … 꽝 🧻), `kujiWon`,
  `isKujiDraw` (lottoDraw `kuji: true`; the numbered payload stays `cards.js lottoRows`), `isKujiBig` (a 1등), `kujiRankInfo` (「1등 ·
  …」 → label + title), `kujiRows(e, {characters, meta, won})` (best rank first; chips 💰 / 🃏 card name of the world / plush only when
  the title doesn't name it / stat), `kujiSummary`.
- `ui/worldArt.js` (string builders, no ids): `monsterSvg(id, {mood})` = 4 distinct silly-cute chimeras facing left (꼬마 키메라
  lavender caterpillar, 키메라 purple horned fang grin, 커다란 키메라 orange dino, 데카츠요 three-eyed indigo boss with a horn crown);
  `monsterArtHtml` (accepted `findAsset({kind: 'item', monster})` img wins — cutin2d / game2d `artFor('monster', id)`), `powerStars`,
  `huntOptionsHtml` (battle card: foe art + ★ 위험도 (`art: false` in the cut-in, whose window shows the chimera), 「⚔️ 싸운다」 chance
  meter + 💰 reward range + 🔱 / 🛡️ badges, 「🏃 도망친다」), `weedOptionsHtml` (field card: 지금 자격 + `gradeLadderHtml` 5→1 dots,
  「🌿 풀뽑기 일하기 (+n만원)」, 「📝 n급 검정 응시」 meter + 💸 fee / 🆓 무료 (부모님 찬스) + red disabled reason), `worldOptionsHtml`
  (dispatcher, null for other kinds; used by the cut-in prompt and the 2D sheet `.world-choices`), `passStampHtml` / `gradeBadgeHtml`,
  `kujiBoxSvg` / `kujiTicketHtml` (flip card, `--d` delay) / `kujiPlushHtml`, `worldSceneBody(scene)` + `WORLD_SCENES` (풀밭 with the
  풀뽑기 검정소 sign + basket, 토벌 숲 with 「⚔ 토벌 구역」 + eyes in the bushes, 라멘 가게 「郎」 noren + bowls, 쿠지 가게 prize shelf).
- Cut-ins: cutinMap `WORLD_ANCHORS` huntResult / weedResult (anchors + boundaries), `isHuntRunEvent` → never an anchor, a lone
  (banner) group; a `treasureFound {source: 'kuji'}` folds into its kuji draw (`g.treasure`, no second cut-in); `WORLD_TAGS` 「⚔️ 토벌 ·
  승리 / 패배」「🌿 풀뽑기 검정 · 합격 / 불합격」「🌿 풀뽑기 일하기」「🏃 토벌 · 도망」, lottoDraw 「🎟️ 쿠지 뽑기」 vs 「🎱 전국 로또」;
  fallback texts; `PREFER_SVG_SCENES` / `SVG_SCENES` + the four world scenes, `DEFAULT_SCENE_FALLBACKS` + the 8 world scenes (+ park /
  house, mirroring tones.json). cutin2d: `worldLook` (hunt win cheer / lose cry + 💥/🤕, weed pass jump / fail sweat / work wave),
  `worldExtras` (chips: ⚔️ name 토벌 성공! / 💥 패배, 토벌 n회, 🔱, 🛡️ (손해 절반), 🤕 부상 n턴 (the injury card chip is dropped), 📝 n급
  합격 / 불합격, work pay; `REASON_ICON` hunt ⚔️ / weed 🌿 / weedFee 📝 / kuji 🎟️) → `spec.hunt` / `spec.weed`; `renderWorld`: hunt prompt =
  the chimera on the right of the window (`.ci-foe`, idle bob), weed prompt = grade badge; hunt result = 💥 clash, then (`.after`) the
  chimera poofs away + 💰 coins (win) or gloats while the character tumbles (`.ci-slot.tumble`); weed exam = 「합격!」 / 「불합격…」
  stamp + grade badge (1급: 🌿✨ rising), work = plucked 🌿; `kujiSpec` (lottoDraw kuji → studio with the MCs when the group has lines,
  else kind `kuji`; scene kuji): `.ci-kuji` box + one ticket per holder peeled in turn, rows in the box (rank chip, prize title, chips,
  line), 1등 = `kuji-plush` + confetti + fanfare. `overlay.dataset.world` = hunt-win | hunt-lose | weed-pass | weed-fail | weed-work |
  kuji | hunt-prompt | weed-prompt (E2E hook). Prompt looks hunt (career · hunt-forest) / weed (good · weed-field); the prompt spec
  carries `context` (the monster).
- Policy (cutinPolicy): huntResult big only by `isHuntBig`, weedResult by `isWeedBig`, lottoDraw kuji by `isKujiBig` (the numbered lotto
  stays always big; a studio group is big anyway); a kuji draw with one of my tickets is mine (`isOwnGroup`); other players' plain 풀뽑기
  work (`isWeedWorkGroup`) = a banner in every mode (mine: a short cut-in); running away (`isBannerGroup`) = a banner, also mine; merge
  ranks huntResult 6 / weedResult 4.
- game2d: `CLIENT_TILE_TYPES` + `WORLD_TILE_TYPES`; `WORLD_CUTIN_TYPES` (3D cut-in handlers + MC corner); side rows `gc-tag world weed |
  hunts` (`worldTags`), detail facts 「풀뽑기 검정」「토벌」; 2D sheet `worldOptionsHtml`; floats / toasts (cut-ins off or 「끄기」):
  huntResult (⚔️ 토벌! / 💥 패배, 🤕; the injury card toast is skipped after a hunt injury), weedResult (📝 합격 / 불합격, 🌿 +pay; a payday
  검정 pass always toasts), 토벌 run 🏃, kuji (rank float per holder, a toast for my tickets). Requirement badges (`growth.requirementList`)
  know `weed` (「🌿 풀뽑기 n급 필요」) and `hunts` (「⚔️ 토벌 n회 필요」), checked against the character (red ✗ when missing);
  `growth.meritNeed` honours `rankUp.meritFrom` (no 🏅 need below that rank).
- 3D: animator `ANIMATED_EVENTS` + huntResult / weedResult; board3d pops (⚔️ +n / 💥🤕 + coin / star burst; 📝 n급 합격! + confetti / 🌿 +n),
  kuji `lottoDraw` = a rank pop per holder (`KUJI_POP` 🧸 1등! … 🧻 꽝); tile defaults hunt ⚔️ / 토벌 #c0392b, weed 🌿 / 풀 #6ab04c;
  `buildMarkers` (same one merged marker mesh): hunt = a purple chimera peeking out of a bush + a sasumata stuck in the ground (≈ 250
  tris), weed = a tuft of four weed cones + a basket. particles `BURST_FOR_TILE` hunt / weed star.
- Props (§6): 2D painters in `ui/chara.js` (`DRAWN_PROPS`): armor_helmet (riveted grey dome, brim band, red plume), head_towel (striped
  towel cap + side knot), sasumata (pole + U fork with outward tips), ladle (bowl + rim), hammer (wood handle, grey head), turner (black
  handle, slotted blade), guitar (body beside the right hip, neck up past the head, strap in front), weed_basket (woven basket at the left
  with weeds + a flower, diagonal strap), delivery_box (taped cardboard box at the right shoulder + straps), armor_plate (side plates
  behind + a grey breastplate in front). 3D builders in `scene/pawnParts.js` (`PROP_BUILDERS` + `PROP_DEFAULT_COLORS`): head 122 / 126,
  hand 48–92, back 60–112 triangles (≤ the heaviest prop of each slot → the per-pawn budget 2,000 holds); armor_helmet is a TALL_HAT.
- CSS `public/css/world.css` (linked after chara.css): side tags, chimera moods / foe / clash / coins / tumble, stamp / badge / work
  weeds, kuji box / tickets / plush, battle / field cards (cut-in + 2D sheet; 390 px: one column), lobby world line, reduced motion.
- **World art variants** (`node scripts/gen-world-manifest.js [--dry-run]`, idempotent upsert like gen-chara-manifest; tests
  `test/asset-worlds.test.js`): manifest `meta.world` ('chiikawa' | 'real'; `manifest.js` `WORLD_ART_KINDS` card / item / treasure /
  icon only) marks a world's own picture. 🐹 variants `card-<slug>-chiikawa` ×14 (study insider energy taxi pledge insurance amulet lotto
  coupon lawyer cut_line noise tax_audit complaint), `item-<slug>-chiikawa` ×6 (car laptop gym_pass designer_bag lucky_cat
  massage_chair), `treasure-<slug>-chiikawa` ×16 (the renamed objects; the other cards / treasures keep one shared picture) →
  `cards|items|treasures/chiikawa/<slug>.png` (slug = id with `_` → `-`), plus `icon-job-<slug>` for the 16 jobs the overlay adds
  (`icons/jobs/<slug>.png`, no world field) and the tile icons of CH-2. `assets.js` `findAsset({…, world})`: that world's variant, else
  the shared art (no `meta.world`), never another world's variant; without `world` variants are skipped. Callers pass the room's
  world: game2d `artFor` (`worldOf(ui.rawRoom)`; also handed to resultShow / option builders), cutin2d `artFor` (`dataWorld(getMeta())`),
  board3d tile icons (`setBoard(board, {world})` from sync3D, default `dataWorld(meta)`). Prompts = `CHIIKAWA_STYLE` + an English
  object description (`DESC`) + the overlay's emoji, labels name the overlay object, refs `ch-chiikawa-base` (style only); the
  generator refuses a listed id the overlay doesn't change and an added overlay job without a description.

## E2E round 4 fixes (server)
Source: the E2E-4 tester notes (session scratchpad `e2e4/findings.md`, harnesses `e2e4/t2` / `e2e4/t4`). Tests:
`test/fixes-e2e4-engine.test.js`, `test/fixes-e2e4-server.test.js` (+ updated expectations in `cpu-server`, `loop-board`, `board`,
`engine`, `fixes-playtest`, `fixes-engine`, `stage6-life`, `stage6-jobs`, `cards-bluered`, `presentation`, `cworld`, `assets-routes`,
`chiikawa-server`). Measurement harness (copies of the tester's t4 scripts + `luck/luckvar/hidden/rep/frames/slow.mjs`, a
`base/` copy with the balance edits reverted for "before"): session scratchpad `fixa/`.
- **Bugs / stability**: ① side bets vs 택시 / 층간소음 — see Domain notes (`BET_VOID_MODS`; a played taxi voids + refunds the
  turn's bets, log 「…카드로 두 번 돌려서 이번 훈수 베팅은 무효예요 (판돈 반환)」); every pick's EV ≤ 0 in every mod state is tested by
  exact enumeration. ② RoomStore debounce max wait 2 s (Layout Stage 1). ③ slow SSE consumers dropped past 1.5 MB unsent (checked
  with a real paused TCP client: dropped at ≈ 1.6 MB, presence → offline, server fine). ④ `superseded` before a stream is evicted
  (≥ 4 tabs). ⑤ boot robustness: `RoomStore.load` skips saves with malformed players / characters / status (Korean log) and
  normalizes log / config / code; `GameRunner.restore()` wraps every room — a playing room the engine can't run
  (`playingRoomProblem`: no characters / board eras / turn order / config, or migrateLoopBoard throws) is kept but marked broken
  (`runner.brokenReason(id)`, Korean log 「방 …을(를) 복원하지 못해 멈춰 둡니다…」): no timers, `dispatch` / `end` → 409 「이 방은
  저장 파일이 손상돼서 진행할 수 없어요. 관리자가 삭제해 주세요. (…)」, admin `GET /admin/api/rooms[/:id]` rows carry `broken` (reason |
  null), delete works. `start / end / dispatch` go through `#transact`: an unexpected engine error → logged + `{ok: false, status: 500,
  error: '게임을 처리하다 오류가 났어요. 관리자에게 알려 주세요.'}`; the deadline and CPU timer callbacks are try/catch'd (a bug can't
  crash the process from a timer). ⑥ 기초연금 by family average (Domain notes). ⑦ names: `lobby.cleanName` also drops U+034F, U+17B4–
  17B5, U+180B–180F and lone surrogates; variation selectors (U+FE00–FE0F, U+E0100–E01EF) survive only right after a visible base
  character (❤️, 1️⃣, ideographic variants); a name needs at least one visible base character (not whitespace / a mark / a selector)
  → 「️」, 「឵」, 「᠋͏」 … refused. (Client mirror `format.cleanName` = Fix-B.) ⑧ `studio.upload` decodes the whole
  image inside a try (a truncated PNG passes `metadata()` but fails to decode) → 400 「이미지 파일을 읽을 수 없습니다.」; the app
  error handler answers 413 「요청이 너무 커요.」, other 4xx 「요청 형식이 올바르지 않습니다.」. ⑨ SSE board cache (`boardKey`,
  below). ⑩ 로또 / 쿠지 tickets: `cardLost {reason: 'used'}` per used ticket right after its `lottoDraw` (holidays.js `takeTicket` +
  cards.js `emitLost`, now exported); `gameStarted.laps` = lap per loop era and the final race's length (no nulls; `turns` stays null
  for the final era — no client reads either). ⑪ MC 봄이 「투표 시간은 1분입니다.」 → 「마감 전까지는 투표를 바꿀 수 있습니다.」 /
  「마감 전에 투표해 주세요.」 (time-free; `mvpVoteMs` is 3 min); baby events `doljabi_*` say 「첫 생일 선물 고르기」 (ids kept; the
  CH-1 wording grep now also bans 돌잡이).
- **SSE board cache (item 9)**: the engine sets `room.boardKey` whenever it builds a board (`startGame`, `migrateLoopBoard`; old
  saves get it on their next action) = `view.boardKeyFor(board)` (FNV-1a of the board JSON + its length, base 36; rooms without one
  get the same key computed + WeakMap-cached in `view.boardKeyOf`). `viewFor(room, sid, {board})` always carries `boardKey`
  (null without a board) and leaves `board` out with `board: false`. `roomStore.stateFrame(room, sub)` sends the board only when the
  stream (`sub.boardKey`) has not got that key yet — the first frame of every stream (the SSE route's initial state now goes through
  `store.subscribe(…, {state: true})`), game start, a migration. HTTP responses keep the full board. Measured (8-character lifetime,
  4 casual + 4 CPU, every action's state frame for one client, 3 seeds × both worlds): mean frame 64–66 → 27–30 KB, ≈ 40–42 → 17–19
  MB per client per game (−55…57 %); the largest frame (the one with the board) ≈ 100 → 64 KB.
- **Client network contract (public/js/api.js; UI = Fix-B)**: `connectEvents(roomId, handlers)` — `handlers.state` always gets a
  room WITH `board` (the stream's cached board re-attached by the pure `attachBoard(cache, state)`; a frame whose key the cache
  doesn't hold → the room is fetched over HTTP instead); `room.boardKey` is available (board3d can use it as its `setBoard` key).
  `superseded {roomId, reason: 'tabs', max}` → the EventSource is closed for good (no auto-reconnect ping-pong), then
  `handlers.superseded(payload)` + every `onSuperseded(fn)` listener; `sseSuperseded()` = the payload or null (reset by the next
  `connectEvents`). 「다시 연결」 = call `connectEvents` again (app.js `enterRoom`), which supersedes the oldest other tab instead.
- **CPU pacing (B5)**: `CPU_DELAY_MS` spin 1000 / prompt 800 / trade 800 (+ cut-in 1200), was 1600 / 1200 / 1200 (+ 2500).

## E2E round 4 fixes — client pages (lobby / picker / result / admin; Fix-B2)
Source: session scratchpad `e2e4/findings-la.md` 1–22 + the page items of `findings.md` (T1 / T3). E2E: session scratchpad `fixb2/`
(`measure.cjs <tag> join,lobby,spec,picker,admin,assets` per-item geometry on the real server, `show.cjs` injected rich result
(6 awards, 5 treasures, titles, open MVP vote) through every show step + page + photo, `pick3d.cjs` big props in the 3D preview;
screenshots `fixb2/shots/`). Note: a Playwright full-page screenshot drops the `pointer: coarse` emulation of that page — measure
touch targets before taking one. Tests: `test/client-pages.test.js`.
- Picker (`lobby.css` / `chara.css`): phones — the dialog scrolls and `.cz-body` is `flex: 1 0 auto` (never shrinks under its
  content) → the sticky footer stays at the screen bottom at every scroll position (was mid-screen / off-screen at max scroll);
  sticky title bar (✕ 40 px). Preview box `--pv-w/--pv-h`, the 3D canvas = a square of min(both) (was squashed 198×170). Stage tools:
  2D|3D on its own line, the four action chips in ONE row (`.cp-acts` 4-column grid; 2 columns in landscape). Prop names wrap to two
  lines (keep-all) instead of an ellipsis. Coarse pointers: slot tabs / seg / chips / random / footer ≥ 40 px. Short landscape
  (≥ 769 px wide, ≤ 520 px tall): full-screen dialog, compact bars, stage grid = 132×150 preview beside who / chips / tools, name
  below. `pawnPreview.previewFrame(positions)` (pure): fits every vertex (distance from the turning axis + height from the centre) and
  the stand into the circular canvas.
- Lobby (`lobby.css`, `app.js`, `ui/lobbyText.js`): mode line = `modeSummary(room, meta)` → `<b>모드</b> · 초기 자금 · 🎯` + a small
  era line (`.lm-eras`, every era / extra nowrap); the world appears only on `#lobby-world` (`<b>icon name</b> · desc`). `.player-list`
  one `minmax(0, 1fr)` column (320 px no h-scroll), `.pname` title. Empty hints `.empty-hint` span the grid, centred. 편집/삭제
  `flex: 1 1 0; max-width 64px; nowrap`. My panel: `#my-list-wrap` flex column, `.my-chars` scrolls inside, the two buttons always
  visible (bottom sheet and sidebar); desktop sidebar max-height leaves 60 px for the reaction bar; short landscape → 320 px sidebar,
  buttons side by side. Spectators / TV ≥ 769 px: one centred 880 px column. CPU tools: select / add / ✕ one height (30, coarse 40;
  chips 36 / 46). Reaction bar: coarse 40×40 buttons; when the row doesn't fit it scrolls and the hidden side fades (`data-more`
  left|right|both from `scrollCue`, CSS mask). Join: empty `.form-error` hidden. Top bar on non-game screens (and the admin pages)
  lines up with the 1200 px column ≥ 1232 px. Superseded stream (api.js `superseded`, ≥ 4 tabs of one session): the 연결 badge
  becomes the button 「● 다시 연결」 (`.conn.gone`, coarse 40 px, + a 7 s toast) → `enterRoom` takes the stream back (the server then
  retires the oldest other tab — one tab per click, no ping-pong); the watchdog / `online` handler skip a superseded tab.
- Result show / page (`stage9.css`, `resultShow.js`): the show body scrolls its own content (`.rshow-body` overflow auto, MC booth
  `flex: none` below it — no more MC over award titles / ranking rows); phones with the 「👑 MVP 투표」 pill at the bottom → `.rshow.
  has-vote` padding so the booth sits above it; ≤ 480 px LIVE = a red dot, step dots on their own line, the title may use two lines;
  landscape ≤ 500 px tall = grid (body left, MC booth right, appraisal cards up to five per row). Appraisal cards / award cards: flex
  rows centred (last row too); award cards equal width per row via a container query (`.rs-awards` `container-type`, `--n` 1–4).
  Ranking rows: markup `div.rk-body > div.rk-head (name · owner · 👑)`; ≤ 600 px rows are a grid (medal · face · name · total on line 1,
  titles / bar / career / money full width below; `.rk-body` `display: contents`). Tools left-aligned (same edge as the title),
  nowrap labels, ≤ 480 px two equal columns with short labels (`.rs-tl-long` hidden: 「▶ 다시 보기」「📸 단체 사진」, aria-labels
  keep the full text), coarse 44 px. Legend 10 px below 「▼ 4위부터」. `.rshow` and the 📸 pose / style buttons are
  `user-select: none` + `touch-action: manipulation` (no text selection on a double tap).
- Admin (`admin.html`, `admin.css`, `admin.js`): `a.btn` no underline (inline-flex), ≤ 480 px short logo 「🛠 관리자」 and buttons
  「🎨 에셋」「🎲 게임」 (`.logo-long` / `.tb-long`, `&nbsp;` inside the flex item), era fieldset legend = 「시대 길이(턴)」 + `.era-note`;
  era rows wrap between chips (기본 n턴 · 🗺️ n칸 순환 · 최소 n are nowrap; final row label split into two chips; ≤ 400 px input
  column 72 px); coarse: `.btn.small/.tiny` 40 px, era inputs 44 px. Stale hints fixed: skill roulette (no number deck), 명절 only
  중학생·중년. Asset studio: caption = `ui/assetText.js` `acceptedCaption(acc)` (후보 #n · model | 업로드 | 가져오기 (file); compact
  date; parts nowrap — was 「후보 #undefined · import」), one-figure `.accepted-box` = one column (≤ 520 px figure; `.two` for pose /
  sprite), item rows carry a `title`, coarse chips / selects 40 px.
- **Balance (both worlds; "before" = the repo before these fixes, measured on the `fixa/base/` copy; casual / expert = the
  `cpu-game.js` human proxies; duels = 1 test seat + 3 expert seats, lifetime, seats rotate)**:
  - B1 「모두를 위한 소원」 never counts toward `wishes` (passTile.js; the hard CPU's 산신령 pursuit term left wishAll). Duel 「always
    wishAll」 1st 38.8 → 11.5 % (real, Δ total +254 → −337) / 32.5 → 9.0 % (치이카와) — no longer an exploit (spamming it now forgoes the
    free buff / wishes; a cheaper offering 4 changed nothing, 12 %). 산신령 for 4 experts 10.2 → 0.5 % of characters (threshold 8 kept).
  - B2 routes: `routePools.money.eraOverrides` young `{money: {weight: 3}}` + middle_age `{treasure: {weight: 0.5}, house: {weight:
    2}}`, `routePools.career.eraOverrides.young {money: {scale: 1.6}, loss: {weight: 1}}` (base board.json; the overlay keeps the base
    `eraOverrides`). 4 casual × random routes (1000 games; before 600): real young love / career / money 27.7 / 21.5 / 26.0 → 26.9 /
    23.7 / 24.2, middle_age 24.2 / 22.9 / 27.9 → 26.1 / 24.8 / 24.3; 치이카와 young 27.4 / 22.1 / 25.5 → 27.6 / 24.5 / 22.7, middle_age
    24.5 / 22.0 / 28.7 → 24.8 / 25.5 / 25.0 (fair 25; every route within ±3 pt).
  - B3 `board.json loop.pass` every 45 / min 1 / max 3 (was 27 / 2 / 4; `loopConfig` defaults too). `simulate --games 300 --seed 11`
    (random policy) decisions per character: real lifetime 36.3 → 30.6 (찬스 광장 10.5 → 5.6), adult 20.6 → 18.3, kids 13.9 → 10.6
    (5.6 → 2.9); 치이카와 lifetime 37.8 → 32.1, kids 14.3 → 11.1 (new simulate line 「모드별 캐릭터당 선택」).
  - B4 treasures × 0.6 with max ≤ 400 (Stage 9 data; kuji_plush 60–120); awards dabok 100, max_level 50, 🐹 hunt_king 40 / weed_master
    35. 4 casual × 400 lifetime: the winner changes without treasures real 27.5 → 14.5 %, 치이카와 28.0 → 12.8 % (without awards 16.0 →
    15.3 / 17.0 → 16.5 %); treasure value per character ≈ 190–200 → 90; characters with ≥ 500 in treasures 13 → 1.8 %. (Tried: caps
    500 / 600 alone 26–28 %, × 0.6 alone ≈ 20 %, × 0.5 ≈ 18 %.)
  - B5 CPU pacing above.
  - B6 jobs.json chaebol `netWorth` 1200 (was 2000), landlord `houseSwaps` 3 (was 4; shared by both worlds). Hidden jobs held (300
    games): real casual × 4 12.3 → 11.3 % (chaebol 0 → 0.3, landlord 0.3 → 0.7; trot_star 6.8 → 4.5, astronaut 4.0 → 4.9), casual 1 +
    3 CPU: human 11.7 → 10.3 %, CPU 26.8 → 19.4 % (trot_star 16.3 → 13.9 — the CPUs' own dream-job table; 산신령 5.7 → 0 by B1);
    치이카와 casual 7.2 → 9.8 % (armor_san 5.6 → 6.5, landlord 0.1 → 0.7), CPU 12.2 → 3.8 % (산신령 7.6 → 0).
  - B7 line pools ≥ 20 (≤ 30) for pass_tile, house, card, job, stat_up, route_choice, club, promotion (+ the 🐹 overlay's job /
    promotion pools); tests allow 20–30 for exactly these tags. Shown lines (cut-in anchors + prompts) per 8-character game: pass_tile
    91 → 54 uses at 9.1 → 2.7 per line, house 5.9 → 1.4, card 5.0 → 1.3, job 3.6 → 1.0, promotion / route_choice / club 2.6–3.2 →
    0.8 per line (busiest remaining small pools: date / heart / hunt ≈ 2.3–2.4 per line).
  - B8 생일 파티 답례: `balance.groupGift.thanks {stat: charm, gain: 1, chance: 0.5}` — each giver rolls once (game RNG) → statChanged
    reason `thanks` + log 「💝 ○○의 답례 인사! …」; the gift option carries `desc` 「10만원 선물 · 답례로 매력 +1 (50%)」, `price`, `thanks`
    (`spaces.giftThanks(data)`). Hard CPU `answerGroupGift`: gift when the stat is useful and 0.5 × 60 > 1.5 × the gift. Duel always /
    never gift: real 20.5 / 22.3 → 25.0 / 26.8 %, 치이카와 23.0 / 23.3 → 21.5 / 22.3 % (Δ total within noise both ways).
  - B9 kids: `passTile.wish.moneyByEra {baby, elem, middle, high: 35}` (base prize 25 elsewhere; passTile.js reads `moneyByEra[c.era]`).
    Kids duels (600, current board): real pass_pass / pass_wish / shop_leave / control / shop_buy 29.5 / 27.0 / 26.5 / 24.3 / 23.8 →
    28.0 / 30.2 / 26.0 / 24.0 / 23.5 % (Δ total wish +1 → +13 vs pass +17 → +10); 치이카와 pass 32.5 → 28.8, wish 29.7 → 32.5 (+4 → +18 vs
    +28 → +19) — spending at 찬스 광장 is no longer strictly worse than passing (40 / 50 made wishes dominant). ("current board" =
    after B3; on the old board with 2 찬스 광장 per kids lap: real pass 31.3 / wish 32.3, 치이카와 pass 30.8 / wish 42.5 %.) The kids shop stays −EV
    (adult-priced items, pass_buy 7–10 %).
  - Checks after all changes: `cpu-game --matrix --games 200 --seed 1` — real / 치이카와: casual 1 + 3 CPU human 1st 96.5 / 98.5 %, random 1
    + 3 87.0 / 90.5, casual 2 + 2 100 / 100, casual 4 + 4 100 / 100, expert 1 + 3 99.5 / 100, adult 98.5 / 97.0, kids 100 / 100, skill
    97.5 / 96.0 and random 87.5 / 91.0, vs all-🐢 / 🙂 / 🔥 95.0 / 96.5 / 99.0 and 98.5 / 96.0 / 97.0 % (every target ✅); CPU-only rooms
    (`--cpus 4 --games 100 --seed 9`, both worlds) all finish. `simulate --bias --games 300 --seed 1`: 9.3–14.7 %, spread −0.28; aim
    duel 100 × seed 1: CPU 23.8 · max 16.9 · none 9.4 · random 7.5 · min 5.0 %; pass duel 60: always pass 17.5 · CPU 13.8 · never 6.3 %.

## E2E round 4 fixes — in-game client layout (Fix-B1)
Source: session scratchpad `e2e4/findings-lb.md` (all) + the in-game items of `e2e4/findings.md` T1 / T3. E2E: session scratchpad
`fixb1/lb/` (`fit.cjs` cut-in / prompt fit per viewport 320×568 … 1920×1080, 844×390, 375×667, 1366×768, TV; `layout.cjs` header /
board / dock / hand / sheets / inbox; `hudprobe.cjs` 3D spectator HUD lag; `fu.cjs` Fix-A follow-ups; `launch.mjs` = the real server on
4301 + a unix-socket control hook; shots `fixb1/after/`, frozen-copy baseline `fixb1/before/`). Tests: `test/client-cutinFit.test.js`
(+ a block in `client-bluered`).
- **Cut-in fit** (pure `public/js/ui/cutinFit.js`): the stage is `--ci-wmax` wide (desktop min(1040, 100vw − 32), phones 100vw − 16,
  vertical-reaction-bar screens 100vw − 200, TV min(1080, 100vw / 1.4 − 40)); cutin2d `fit()` (render, prompt updates, resize, a
  `ResizeObserver` on the box → next frame) measures the real stage and sets `--ci-winw` (16:9 window) / `--ci-boxw` (box + tabs):
  `fitStacked` (the window gets the height the box + tabs leave, ≤ 4 passes because a narrower event box gets taller;
  `minWindowWidth` = max(240, ½ stage), prompts on < 700 px tall screens max(200, ½ stage); `boxWidth` = full width for prompts, events
  follow the window but ≥ 680 px), `wantsSide` (≥ 900 px wide, aspect ≥ 1.25, stacked window < 62 % → `.cutin.fit-side` = window left /
  box + tabs right — kept only when the stacked layout didn't fit or the side window is > 10 % bigger; phone landscape ≤ 500 px tall
  always uses that grid), `bodyCap` (last resort: `.cutin.fit-scroll` → the `.ci-body` wrapper (chips / text / extra / options)
  scrolls inside the box with a fade, ▼ and tabs stay on screen; ≥ 96 px). TV zoom: sizes are read as offsetHeight × rect /
  offsetWidth, 2 px spare. Typed text: a hidden ghost (`.ci-text-ghost` grid: the full line + the studio's last 3 lines, stacked) under
  `.ci-text-live` → the box never grows while typing and studio lines never overlap the extra rows. Narrow screens: `.cutin.exit-pad`
  (stage below the 🚪 pill, era label beside it). Phones: compact prompt options (min-height 48; < 700 px tall 44 + 15 px text); 매물
  cards ≤ 480 px hide the desc, art 64 px; hunt / weed cards keep-all.
- Chips: > 3 → `.ci-chips.row` (wrapping row, not the right float); beyond `chipRowCap` (2 rows; 3 on ≥ 760 px tall and ≥ 400 px wide)
  they fold into 「+n ▾」 (`data-ci-act="chips"`, toggles all + 「접기 ▲」, refits): `chipHideOrder` = `minor` chips from the end first
  (per-guest 집들이 / 입양 축하금 chips — short 「💌 이름 +n만원」 when > 2 guests), then the rest from the end; the first chip and `keep` (합계)
  stay. Chip `who` = an ellipsized `<bdi class="ci-chip-n">`.
- Tabs: > 4 characters → compact (others: portrait + 3.4em name; phones / landscape portrait only), the current tab centred after every
  fit, `fade-l` / `fade-r` masks; 🔊 icon-only on phones (aria-label). Contrast: `.ci-era` / `.ci-exit` dark pills. Coarse pointers:
  ▼ 44×40, 🚪 40, 🔊 40×40.
- HUD vs 3D board (spectators / TV / back-to-back CPU turns): cutinPolicy `hudHoldLeft({heldMs, mine})` — the HUD waits for the board at
  most `HUD_HOLD_MS` 3000 (others / spectators) / `HUD_HOLD_MINE_MS` 8000 (my turn); game2d re-renders when it runs out (`ui.hudHeldAt`,
  `ui.hudTimer`); `boardBehind({stateTurn, boardTurn})` (≥ `BOARD_BEHIND_TURNS` 2) → `animator.rush()` (`ui.animTurnNo` = the last
  `turnStarted` the board played, via a wrapped handler). sync3D passes `k:${room.boardKey}` as the `setBoard` key (no JSON key per render).
- Shrink-to-fit centring (a `left: 50%` box is capped at half the screen): `.toast` (base.css) = `left/right + margin-inline: auto +
  width: fit-content`, max min(560, 100vw − 32), keep-all, below the inbox while it shows (`body.has-inbox`); `.news-flash` the same (own
  `nf-show` keyframes); `.roulette-pop` max-content; 월급날 ribbon nowrap.
- Header / board head: chips one height (28 px); ≤ 430 px the turn info shrinks and the header's 「이번 시대 마지막 턴!」 is hidden (the dock
  hint keeps it); the 📰 badge is icon-only when `.g-top` < 300 px (container query). Era tabs on their own row, the current one scrolled
  into view + fades (`scrollHint`); phones (≤ 600 px): left-aligned icon tools (`.tl-l` labels hidden, 「🎬 간단히」 via `narrowTools`).
- 2D track (rules in loop.css — it loads after game.css): centred, uniform rows (`grid-auto-rows` 96 / 88 px ≤ 480), amounts nowrap,
  labels keep-all + break-word, route labels = icon line + name (`.rl-ic` / `.rl-n`); pawns one row: ≥ 3 overlap (`.pawns.crowd`), ≥
  `MAX_TILE_PAWNS` 4 → two + 「+N」.
- Dock: sticky only on screens > 600 px tall (shorter ones use the floating 🎡); the sticky phone dock hides 「최근 룰렛」 and has a 52 px
  dial; `fitHand` caps per breakpoint (sticky phone 44) with min 38 / gap 3 → six cards fit 320 px; the 🏅 「×n」 badge is top-right;
  ≥ 700 px the hand header wraps. `.b3-sub` sits above whatever covers the canvas bottom (`--b3-cover-b` from `boardCover().bottomPx`).
  Sheets: card sheet / trade dialog `.cs-actions` sticky at the sheet bottom. Reaction bar (game): 40×40 on touch, scroll-snap + fades,
  hidden while the skill panel is open. Long names wrap to 2 lines (side list, target picker, inbox); `.gd-fact` top-aligned. Touch hit
  areas: `::after` on `.news-badge` / `.hand-tab`; `#leave-btn`, era tabs, tools, `.td-kind`, inbox buttons, `.sk-close` 40 px. `.mc >
  svg` alone gets `overflow: visible` (Chrome warned on `<img>`). 3D roulette: 6 and 9 underlined. 베팅하기 = primary.
- Fix-A follow-ups: side bets close while the spinner has ANY bet-voiding mod — `shared/cards.js` `BET_VOID_MODS` (= the server's, tested)
  + `betBlockReason(spinMods)` (택시 max2 / 층간소음 min2 too; `rollConstraint` stays for the fixed rolls); `cardLost {reason: 'used'}`
  (로또 복권 / 쿠지 응모권 spent in a draw): `cardLostInfo` → 「🎱 복권 사용」/「🎟️ 응모권 사용」 `quiet` — folded into its lottoDraw group
  (never a lone banner, no float / 3D pop); 생일 파티 답례 `statChanged {reason: 'thanks'}` → chip 「🎁 답례 · 이름 ✨ 매력 +1」, float 「🎁 답례
  ✨매력 +1」, 3D 🎁 float (the gift option's server `desc` shows in the cut-in / 2D list).

## Senior race comeback (노년 역전)
User request: 「노년기때 앞선 시대에서 아이템을 잘 구비해왔으면 역전이 가능한 시나리오가 나오게. 또한 원작의 한방역전섬 같은 것으로 대박
혹은 쪽박이 나올수 있게」. Tests: `test/senior-race.test.js` (server), `test/client-senior.test.js` (client pure parts) + updated board /
loop-board / stage7-cards / stage9-submaps / presentation / assets-manifest expectations. Roadmap row 15 in `docs/PLAN.md`. E2E: session
scratchpad `g2/` (`scen.mjs` real engine prompts / events → `scen-<world>.json`, `inject.cjs` injected into a real room: 1280 3D, 390 2D,
390 `?cutins=off` sheet, TV spectator, fit sweep 320×568 … 1920×1080 + 844×390; screenshots `g2-*.png`).
- Server module `server/game/senior.js` (pure; registers prompts island / islandPick / contest / auction and a `FINISH_HOOKS` entry):
  `SENIOR_TILE_TYPES`, `SENIOR_USES`, `seniorCfg`, `inFinalRace`, `seniorItems / itemWithUse / luckyNumbers`, `standing(room, data, c)`
  (visible ranking: `computeRanking(reveal: false)` → {ranks, totals, n, rank, gap}), `recordSeniorStart` (`room.seniorStart {ranks, totals,
  n, turnNo}` at the transition into the final race), `seniorDodge / seniorLoss / seniorPayday`, `islandTiers / tierStake / coverSet /
  retireOffer / islandOptions / enterIsland`, `contestThemes / themeItem / contestChance`, `hammerTable / hammerEv / itemAuctionBase`,
  `resolveSeniorTile`, the race clock `raceRoundsFor / startRaceClock / tickRaceClock`, CPU worth helpers `tilesAhead / seniorUseWorth /
  itemAuctionEv / treasureGuess / seniorShopWorth`. Data `balance.json` `senior {race, island, contest, auction}` (+ chiikawa overlay
  renames), `/api/meta.balance.senior`.
- **Final race board** (`board.js` `buildFinalTrack`, `board.json.finalTrack`): pool contest 5 · auction 3 · money 3 (×1.5) · event 2 ·
  treasure / house / temple / hometown / heart / job / card 1 (jeju gone), ONE `island` 🏝️ at ≈ 60 % (`finalTrack.island.at`, the free
  tile nearest, never next to specials / paydays), 1–2 `reversal` (`reversal {every 30, min 1, max 2}`, not next to the island); new tile
  types island 🏝️ #ff6b3d / contest 🏆 #e6a817 / auction 🔨 #8e6b4a. `submaps.js`: the final-race 인생역전 prompt offers `allIn` only when
  the era has no island (old saves); title 「🎰 인생역전」.
- **🏝️ 한방역전섬** (engine `walk`: passing it with steps left pauses the move like a 찬스 광장 → `moved {halted: 'island', remaining}`;
  landing opens it too): prompt `island` (resultCutin 'auto'; text names the rank; context {cash, lucky, rank, n, gap}) — options
  `bet:all|half|little {tier, stake, numbers, mult, chance, ev, win, bust, desc, disabled?}` (stake = cash × share, 5-unit, ≥ min /
  `minStake` 10; numbers + 🍀 lucky items), `retire {place, prize}` (조기 은퇴 at the next free place, prize × retirePrizeMult) and `pass`
  (default; promptResolved `{result: 'pass'}`, cutin false → a banner). Tiers: 💥 인생 한 방 all-in share 1 · 1 number · ×8 · bust (EV 0.8),
  🔥 반반 승부 share 0.5 · 3 numbers · ×3 (0.9), 🪙 소소한 재미 share 0.1 · 5 numbers · ×1.8 (0.9); each 🍀 item adds a number (EV of the
  all-in with one = 1.6 — the preparation reward). A tier → prompt `islandPick` (10 options `'1'..'10'` `{number, covers}`; the covered
  numbers run from the pick, 10 wraps to 1; default by turnNo) → ALWAYS a plain random roll (skill rooms too) → `islandResult {charId,
  tier, stake, pick, covers, numbers, lucky, roll, mult, win, amount, result: jackpot|win|lose|bust}` (+ moneyChanged `island`); 쪽박 = cash
  0 + `finished {retired: 'bust'}` (빈곤 농장, last free place, no prize); 은퇴 = `islandResult {result: 'retire', place, prize}` + finished
  `retired: 'early'`. Only the all-in can 쪽박.
- **🏆 노년 대회** (tile contest): prompt `contest` — the theme drawn with the game RNG (themes of the character's items weigh
  `ownThemeWeight` 2): sing 노래자랑 charm / baduk 바둑 int / gateball 게이트볼 str / raffle 경품 추첨 luck / rally 실버 드라이브 랠리 luck
  (🐹: 하치와레 노래자랑 · 고서점 퀴즈 · 토벌대 체력 대회 · 행운 쿠지 추첨 · 씽씽 킥보드 경주); win chance = 0.08 + 0.05 × stat (+0.25 with the
  theme's item) ∈ [0.05, 0.85], 입상 = (1 − chance) × 0.35. Options `join:small {fee 20, prize 90, second 20, chance, secondChance, ev, themeId,
  stat, itemId?}` / `join:big {60, 270, 60}` / `watch` (default = the cheapest affordable tier with EV ≥ 0, else watch; prizes × CPU income
  handicap). → `contestResult {charId, themeId, tier, stat, statValue, itemId, chance, place (1 | 2 | null), fee, prize, amount}` +
  moneyChanged `contest`.
- **🔨 골동품 경매** (tile auction; 🐹 「🔨 벼룩시장 경매」): prompt `auction` — `sell:item:<id> {base = price × resale (× 1.5 명품 premium),
  low, high, ev}`, `sell:treasure:<uid>` (the hidden appraisal is the base; fakes ≈ 0), `sell:junk {base 20}` (default), `leave`; the
  hammer roulette `hammer [0.5, 0.7, 1, 1, 1.2, 1.2, 1.5, 1.8, 2.2, 3]` (EV ≈ 1.41) → `auctionResult {charId, kind, itemId | treasureId,
  uid, fake, base, premium?, roll, mult, amount}` + moneyChanged `auction`; the sold item / treasure leaves the character (and
  `treasureValues / treasureFakes`).
- **아이템 노년 활용** (items.json `senior` + `seniorDesc`, both worlds; the shop desc ends 「· 👴 노년: …」, shop options carry
  `seniorDesc`): car 경차 / 🛴 킥보드 `dodge` (a stop on a 지출 tile drives one tile on: `moved {dodge: true}`), laptop 노트북 / 고서점 책
  `royalty` (지력 × 15 at the goal or early retirement, never on a bust), gym_pass 헬스 / 사스마타 `health` (지출 × 0.5), designer_bag 명품
  가방 / 포셰트 `premium` (auction × 1.5), lucky_cat 복고양이 / 네잎클로버 `lucky` (+1 island number), massage_chair 안마의자 / 목욕탕 회수권
  `pension` (+40 every final-race payday + heals an injury), 🐹 armor 갑옷 `guard` (blocks one 지출, once: `c.seniorUsed.guard`), 🐹 guitar
  기타 `busking` (매력 × 6 every final-race payday); every item also has a contest `theme`. → `seniorItem {charId, itemId, use, amount?,
  saved?, tileId?, healed?}` (+ moneyChanged `seniorItem`). Shops: `balance.shop {cards 1, items 2}`; young / middle_age main pools
  card 4 → card 2 + shop 2 (both worlds).
- **⏰ 노년 마감** (round cap, `balance.senior.race {perTile 0.3, min 8, max 30}` → 40 tiles = 12 rounds; a normal character needs ~7–8):
  the transition into the final era sets `turn.raceRound` 1 / `turn.raceRounds` (also on `turnStarted`); `endTurn` ticks it when the order
  wraps; past the last round everyone still on the track retires (`finished {retired: 'late'}`, the next free places by progress, prize ×
  retirePrizeMult, log 「⏰ 노년 마감! …」, tag `retire_late`) → game over. An older save in the race starts a clock at its next full round.
  Why: the race tiles pay, so crawling (skill roulette aimed at 1) bought ~17 extra landings and won 13.8–21.3 % of 8-way aim duels
  (fair 12.5); with the cap 1.9–5.0 %.
- Comebacks: `awards.comebackOf(room, ranking)` → `{charId, from, n}` when the winner's `seniorStart` rank was in the bottom half (n ≥ 3)
  → `room.result.comeback`, `gameOver.comeback`, a highlight 「🔥 노년 시작 n위에서 대역전 1위!」 (score 9.5), the winner part of the MC
  show = situation `resultComeback` (duo). Titles: comeback_king 「노년 대역전극」, island_jackpot 「인생역전 대박」, jjokbak_master 「쪽박
  장인」 (gambleLosses ≥ 2), contest_star 「노인정 스타」 (🐹 동네 대회 스타; contestWins ≥ 2), antique_dealer 「골동품 큰손」 (🐹 벼룩시장 큰손;
  auctionTotal ≥ 500). Records: islandJackpot, gambleLosses, contestWins, auctions, auctionTotal (+ island money in gambleNet / luckWin).
- Presentation: `EVENT_TYPES` + islandResult contestResult auctionResult seniorItem; `CUTIN_TYPES` / `BOUNDARY` / prompts `ANCHOR_TYPES` +
  the 3 results; scenes island / farm / auction (tones.json, `sceneFallbacks` → jeju / hometown / shop; manifest `bg-island bg-farm
  bg-auction` todo); tags island island_pick island_jackpot island_win island_lose island_bust island_pass contest contest_win contest_second
  contest_lose auction auction_big auction_sold auction_cheap auction_fake senior_item retire_late (+ placeholder `{contest}`); MC situations
  islandJackpot (big duo) / islandBust (big) / islandWin / contestWin / auctionBig / resultComeback (big duo); sfx islandResult /
  islandJackpot / islandBust / contestResult / contestWin / auctionResult / seniorItem.
- CPU (`cpu.js`, additive): `CPU_ANSWERS.island` (hard: an expected-standing utility — the trailing gamble, the leader passes / retires),
  `islandPick` (sub-RNG), `contest` (best EV over a personality margin), `auction` (gain-based; the 명품 premium sells); easy tables
  `balance.cpu.prefs.island|islandPick|contest|auction` + personality rows (never `bet:all`; 🔥 mostly `bet:little`); `tileWorth` contest 35 /
  auction 25 + 25 per item + 15 per treasure / island 20; `shopWorth` + `seniorShopWorth`; `progressWorth` in the final race = the goal
  share − `FINAL_LANDING` 8 / 5.5 per tile (paydays halt there anyway; before: the payday share made the hard CPU rush past paying tiles).
- Client pure `public/js/shared/seniorPlay.js` (`ISLAND_TIERS`, `ISLAND_RESULTS`, `DEFAULT_THEMES`, `DEFAULT_ITEM_SENIOR`, `itemSenior /
  seniorDescOf / seniorItemsOf`, `islandPrompt / standingText / islandPickPrompt / islandOutcome / isIslandBig`, `contestPrompt /
  contestOutcome / isContestBig`, `auctionPrompt / auctionOutcome / isAuctionBig`, `seniorItemText`, `isSeniorPass`), `ui/seniorArt.js`
  (`islandOptionsHtml` stake cards: name + 🔥 risk, 판돈 / 맞히면 ×n = …, 숫자 n개 dots + chance meter, 쪽박 note; side buttons 🏖️ 조기
  은퇴 · n등 / 🍵 욕심 버리기 — `islandPickHtml` 5 × 2 pad with covered numbers, `contestOptionsHtml`, `auctionOptionsHtml` lots + mini hammer
  row, `seniorOptionsHtml` dispatcher (cut-in prompt and the 2D sheet `.senior-choices`), `islandWheelHtml` (`--rot`), `hammerBoardHtml`,
  `trophyHtml`, `seniorSceneBody` island (beach roulette `.sb-wheel`, hidden while the window shows its own wheel) / farm / auction),
  `css/senior.css`. cutinMap `SENIOR_ANCHORS` + `g.senior[]` chips, lone seniorItem / pass groups, tags; cutinPolicy big = jackpot / bust /
  win ≥ 500 / contest win / auction ×2.2+, banners = seniorItem + passes; cutin2d `seniorLook / seniorExtras / renderSenior` (wheel spin +
  confetti / rain + screen shake on 대박, trophy, hammer board at the right of the window; the moneyChanged `seniorItem` chip is dropped —
  the 👴 chip names the amount); `.ci-chips:not(.row):not(:empty) + .ci-text { display: flow-root }` (cutin.css: the live text never runs
  under ≤ 3 floated chips). game2d: 2D sheet, floats / toasts, side tag 👴 n in the final race, detail facts 「👴 노년 활용」, item titles
  with the senior use; HUD chip 「🏁 골인 경쟁 ⏰ 5/12」 + 「노년 마감 턴!」 (`loop.js` eraClock race → `turn.raceRound/raceRounds`,
  `eraClockText` 「노년 · 골인 경쟁 5/12턴」, `lastTurnHint` 「⏰ 노년 마감 턴! …」), finished late 「⏰ 노년 마감」 everywhere (side list, chip,
  fallback text, 3D banner, toast). 3D: tile colours / glyphs, markers (islet + palm + roulette disc, contest cup, auction gavel) in the merged
  marker mesh, pops for the 4 events; animator `ANIMATED_EVENTS` + them; `loop.haltNote` 🏝️ 한방역전섬 (남은 n칸) / 🚗 쌩— 지출 칸 통과!;
  shop cards 「👴 노년: …」 (`cardArt.shopOptionsHtml`).
- Scripts: `node scripts/senior-race.js [--games N --seed S --policy casual|random|expert --cpus M --chars C --world real|chiikawa --mode]`
  (decision-turn share, item-effect turns, decisions per character, longest run without a decision, goal prize / bonus spin shares,
  comebacks, items bought / shop visits per era, island / contest / auction / reversal outcomes, prompt kinds) and `--duel cpu,<strategy>…`
  (`DUEL_STRATEGIES` island:pass|all|half|little|retire, contest:watch|small|big, auction:leave|junk|sell, shop:noItems|items; 4 hard
  CPUs, one seat fixed).
- Measured (before = the senior race before this rework, 20 games; after = `senior-race.js` 100 games × seed 1, real / 🐹): decision turns
  in the final race casual 27.8 → 52.3 / 51.6 %, expert 30.7 → 52.2 / 51.0, random 32.4 → 55.4 / 55.5, casual + 3 CPU 31.3 → 53.3 / 51.7;
  decisions per character casual 2.45 → 4.78 / 4.72 (expert 5.30 / 5.18); longest run without a decision (casual) median 13 / max 25 →
  5 / 14–16; final-race spins per character 8.07 → 7.83 / 7.75 (random 6.8–6.9: more retire / bust); goal prizes 1.7 → 1.6 % of totals;
  comebacks (expert seats) bottom half at the start → 1st 0 → 22 / 30 %, last → top 2 0 → 11 / 11 %, the leader stays 1st 55 → 43 / 40 %
  (casual: 65 → 58 / 63 %); items held at the end casual 0.04 → 0.15 / 0.13 (expert 1.31 / 1.41); ⏰ late retirements 5–11 of 800
  characters. Duels (`--duel`, 200 × seed 1, 4 hard CPUs, fair 25 %): island pass / all / half / little / retire 18.0 / 12.5 / 26.5 /
  18.5 / 14.5 (real), 17.0 / 15.0 / 22.0 / 18.0 (🐹); contest watch / small / big 20.5 / 19.5 / 23.0, auction leave / junk / sell 18.5 /
  17.5 / 19.5, shop noItems / items 15.0 / 23.0 (🐹) — no dominant option, buying items pays. `simulate --aim-duel --games 140` (8 hard CPUs,
  fair 12.5 %), before (cap off, the rushing final-race aim) real cpu 20.0 · min 13.8 %, 🐹 cpu 12.5 · min 16.9 · mid 17.5 % → after seeds
  1 / 2: real cpu 23.1 / 27.5 · random 11.3 / 13.8 · max 9.4 / 10.6 · high 12.5 / 8.1 · mid 15.0 / 13.1 · min 5.0 / 2.5 · none 11.3 / 11.9;
  🐹 cpu 28.8 / 23.1 · random 7.5 / 14.4 · max 15.6 / 15.0 · high 8.1 / 11.3 · mid 13.8 / 10.6 · min 3.8 / 1.9 · none 10.0 / 11.3.
  `cpu-game --matrix --games 200 --seed 1` (easy) real / 🐹: casual 1 + 3 95.5 / 93.5 %, random 1 + 3 83.0 / 83.0, casual 2 + 2 99.5 / 99.5,
  casual 4 + 4 100 / 100, expert 100 / 100, adult 94.5 / 94.0, kids 100 / 100, skill casual 93.0 / 95.5, skill random 81.5 / 79.5 (all ✅;
  E2E-4 reference before the rework 96.5 / 98.5, 87 / 90.5, skill 97.5 / 96, 87.5 / 91 — the island also gives trailing CPUs a chance);
  `--cpu-level normal`: casual 1 + 3 32.0 / 24.5 % (🐹 seeds 2 / 3: 30.0 / 33.5), adult 26.0 / 29.5, kids 33.5 / 35.5, skill 28.0 / 26.5
  (with aimRandom 1; seeds 2 / 3: 27.5 / 27.5, 28.0). `--bias --games 400 --seed 1`: real 10.0–14.5 % (rank spread 0.09), 🐹 9.5–14.0 %
  (0.33). `simulate --games 300 --seed 11` route 1st-place shares vs fair: real young 19.3 / 16.7 / 21.1 (19.5 / 18.8 / 18.9), middle_age
  20.2 / 18.5 / 20.0 (19.3 / 18.5 / 19.5); 🐹 young 20.8 / 18.6 / 17.9 (18.0 / 19.0 / 20.4), middle_age 21.8 / 19.8 / 17.2 (19.5 / 18.8 /
  19.0); lifetime total composition real cash 60.2 · house 23.0 · items 5.0 · treasures 3.4 · awards 8.4 %, 🐹 71.1 · 16.5 · 3.4 · 2.6 · 6.4;
  lifetime spins per character 48.3 / 48.5 (unchanged).
