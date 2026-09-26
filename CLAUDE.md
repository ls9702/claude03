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
  bonusSpin, betPlaced, betResolved, promptResolved{promptId,kind,charId} (exam/groupGift result anchor),
  gameOver{ranking}, log{text,tone}`. Since Stage 5 every event also has `tone, emotion, scene, line, cutin, lineTag`
  (see Stage 5). Events are broadcast to everyone → never put secret info in them (masking lives in `viewFor`).
- `viewFor` masks: other sessions' pending answers (exposes `pending.answered[]` instead) and unresolved bets.
- Hooks for later stages: `heart/job/card/shop/treasure/house` tiles are log-only placeholders in `resolveTile`
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
  on 429/5xx/network, daily cap in `DATA_DIR/assets-usage.json` (env `ASSET_DAILY_CAP`, `GEMINI_MODEL`).
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
  `upload`, `regenerate` (force), `deleteCandidates`, `listItems`, `publicIndex`, `select` (CLI). Refs must be
  accepted first (409 `REF_MISSING`); accepted items are only regenerated with `force`.
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
  base), `avatarPalette`/`recolorPixels` (blonde hair/navy uniform/skin of the shared layer set → avatar colors),
  `tagLabel`, `autoAdvanceMs`, `sfxForEvent`.
- `public/js/ui/cutin2d.js` `createCutin(document.body, {getMeta, assets:{findAsset, assetUrl}, audio})` →
  `show(group|event|spec, {characters, room, onClose}) → Promise` (queued), `queue`, `showPrompt(pending, {characters,
  forMe, room, onChoose})` / `closePrompt(id)` / `promptId`, `hide`, `reaction({emoji,name})`, `busy/busyEvents/
  whenIdle/onIdle`. Overlay z-index 22 (above top bar, below reaction bar 25 and toasts). Spectators auto-advance 4 s,
  owners 7 s, prompts never (deadline). A spec is `{key, kind, tone, scene, tag, who, text[], line, speaker, chips[],
  cast[{char, pose, emotion}], bigWin, currentId, era, autoMs, characters, prompt?}` — later stages can build specs
  directly (e.g. wedding with spouse in `cast`, stat chips in `chips`).
- `avatar2d.renderAvatarLayers(parts, {pose, emotion, expression, outfit, name, flip})` → `.av2` element with
  `setState()`, `playSprite()`, `ready`, `layered`. Every avatar maps to the `schoolgirl` layer set for now
  (`characterBaseFor` prefers a base whose meta matches body/hair once more bases are accepted), recolored on a canvas
  (cropped to `LAYER_CROP` 160,300 704×1056 of the 1024×1536 canvas, 440 px, LRU of 28); SVG portrait fallback.
  Figure box = layer bbox (y 371..1303): cropped layers are 113.3 % tall / −5.7 % bottom, raw full-canvas fallback
  164.8 % / −25 %, sprite frames 176.1 % / −33 %. New layers must stay inside the crop (tests don't check pixels).
  `preloadAvatarLayers` warms the cache.
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
- Stage 6 hooks: stat chips → `spec.chips` (`{text, kind}`); job/era costumes → `layerPlan({outfit})` (outfit layers
  `char-<base>-outfit-<id>`, map job ids → outfit ids, e.g. doctor/suit); new scenes = new `bg-<scene>` items +
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
