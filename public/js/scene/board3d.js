// Three.js board scene (Stage 4): town + track + route ribbons, pawns, roulette overlay, event animations.
// Loop maps (원작식 순환 맵): only the current shared era's loop is shown (`setBoard(board, {eraIndex})`); an
// `eraTransition` event fades out, swaps in the new era's static board (prebuilt in idle time during the era's last
// rounds — `prepareEra(i)` — else built on the spot), puts every pawn on the start tile and shows the whole new loop
// (camera overview) before following the current pawn again. The old era's group is disposed after the fade.
// Hops follow wraps (last tile → start), route branches, the pass pause (`moved.halted: 'pass'` then a second
// `moved {resumed: true}`) and forced stops (payday / fork).
//
// Camera (camfit.js): `setView('follow' | 'overview')` — follow = a close orbit on the current pawn, overview = the
// whole shown era fitted into the canvas (exact perspective fit of tiles + lanes, pawns, signs and labels for the
// canvas aspect and vertical FOV, refitted on resize / rotation). TV quality always shows the overview.
//
//   const b3 = createBoard3D(canvas, { quality: 'high'|'low'|'tv', meta, hooks });
//   b3.setBoard(room.board, {eraIndex}); b3.setCharacters(room.characters); b3.setCurrent(charId, {mine, subtitle});
//   b3.prepareEra(i)               // build era i's static board in idle time (the next era, during the last rounds)
//   b3.setView('overview')         // 🗺️ whole-map view (hooks.onViewChange(mode) reports every change)
//   await b3.playEvents(events);   // SSE `events` → animator queue (returns when the queue drains)
//   b3.onIdle(cb) / b3.isBusy()    // the 2D UI shows decision modals only after animations finish
//   b3.animator.pause()/resume()/enqueue(fn)  // Stage 5 cut-ins take over the screen between steps
//
// Budget (docs/PLAN.md): ≤100 draw calls, ≤50k triangles, no shadows / postprocessing / AA,
// pixelRatio 1, HemisphereLight + 1 DirectionalLight, MeshLambertMaterial + vertex colors.
// Throws when WebGL is unavailable (the caller falls back to the 2D board).
import * as THREE from 'three';
import { layoutBoard, planProps, slotOffset, ROUTE_ORDER, ROUTE_COLORS, themeFor, boundsOf } from './layout.js';
import { overviewView, zoneView, viewPoints, viewExtent, quantizeAngle, fogRange, defaultOrbit as orbitDefaults, followRadius, isPortrait, TV_ORBIT, LOOK_Y, CAMERA_FOV, coverInset, ndcBox } from './camfit.js';
import { runSteps, stepStats } from './chunks.js';
import { haltNote, tileIdForPosition as loopTileId } from '../shared/loop.js';
import { QUALITY_PRESETS, renderSize, particleCount } from './quality.js';
import { createMascots } from './mascots.js';
import { createAnimator } from './animator.js';
import { createPawn, loadPawnTemplate } from './pawn.js';
import { createRoulette3D } from './roulette3d.js';
import { createEmotionLayer, createThrottle } from './emotion.js';
import { createParticles, BURST_FOR_TILE } from './particles.js';
import { createOrbitControls, ORBIT_LIMITS } from './controls.js';
import { buildProps } from './props.js';
import { stripGeometry, mergeColored, colored, mat4 } from './geo.js';
import { textCanvas, canvasHasEmoji, canvasTexture, FONT_STACK } from './sprites.js';
import { clamp, lerp, easeInOutCubic, rouletteRegion, hopPose, landPose, bobPose, breathePose } from './math.js';
import { loadAssetIndex, findAsset } from '../assets.js';
import { won } from '../format.js';
import { cardLostInfo, modRange, spinNote } from '../shared/cards.js';
import { dataWorld } from '../shared/world.js';
import { findTileIcon } from './tileIcons.js';
import { aimShort, aimText } from '../ui/rouletteSkill.js';

const TILE_SIZE = 1.64;
const SETTLE_SEC = 0.28; // CH-1 pawn settle wobble after a move
const REST_POSE = { y: 0, sy: 1, sxz: 1 };
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const TILE_TOP = 0.27;
const NARROW_TAGS_PX = 700; // canvas CSS width below which only current / mine / moving pawns show name tags
const TEXT_ICON = { start: '출발', money: '₩', loss: '−₩', event: '!', heart: '♥', job: '직업', card: '카드', shop: '상점', treasure: '보물', house: '집', stop: '갈림길', merge: '합류', goal: '골', habit: '습관', salary: '월급날', pass: '광장', hometown: '고향', temple: '산사', jeju: '제주', reversal: '역전', hunt: '토벌', weed: '풀', island: '역전섬', contest: '대회', auction: '경매' };
const DEFAULT_TILE_COLORS = { start: '#9aa5b1', money: '#f2c94c', loss: '#6c7bd1', event: '#5cb87a', heart: '#ff7eb6', job: '#4f8ee0', card: '#9a6ad6', shop: '#f39a3d', treasure: '#d4a017', house: '#c7773a', stop: '#e2504c', merge: '#8d99ae', goal: '#2d2a32', habit: '#20a39e', salary: '#2f9e57', pass: '#ff8a3d', hometown: '#7cb342', temple: '#8d6e63', jeju: '#26a69a', reversal: '#d4a017', hunt: '#c0392b', weed: '#6ab04c', island: '#ff6b3d', contest: '#e6a817', auction: '#8e6b4a' };
/** Stage 6 tile glyphs before board.json knows the type (meta icon wins). Loop maps: 💵 월급날, 🎪 찬스 광장. */
const DEFAULT_TILE_GLYPH = { start: '🚩', habit: '📚', salary: '💵', pass: '🎪', job: '💼', card: '🃏', shop: '🛍️', hometown: '🏡', temple: '🛕', jeju: '🌴', reversal: '🎰', treasure: '💎', hunt: '⚔️', weed: '🌿', island: '🏝️', contest: '🏆', auction: '🔨' };
/** Ribbon text drawn under the icon of these tile types (atlas). */
const RIBBON = { salary: '월급날', pass: '찬스 광장' };
/** Loop maps: tiles that stand out (bigger tile + marker): forced-stop paydays, pass tiles, the fork. */
const BIG_TILE = { salary: 1.2, pass: 1.14, stop: 1.12, start: 1.1, goal: 1.3, island: 1.2 };
/** Stage 9 board reactions: submap arrival / outcome, treasure find. */
const SUBMAP_POP = { hometown: '🏡', temple: '🛕', jeju: '🌴', reversal: '🎰', casino: '🎰' };
/** Stage 6 board reactions over the pawn (the cut-in follows). */
const STAGE6_POP = { jobChanged: '💼', rankUp: '⭐', hiddenJobUnlocked: '🌟', injured: '🤕', militaryStart: '🪖', militaryEnd: '🎖️', educationChanged: '🎓' };
const STAT_FLOAT = { int: ['🧠', '#2446a8'], str: ['💪', '#a33a14'], charm: ['✨', '#a3276a'], luck: ['🍀', '#1d6b3b'] };

/** Stage 7 board reactions over the pawn (sabotage / block pop over the target). */
const STAGE7_POP = { cardGained: '🃏', itemBought: '🛍️', gift: '🎁', lottoDraw: '🎱' };
/** 세계 설정: 쿠지 ranks over the holders' pawns. */
const KUJI_POP = { 1: '🧸 1등!', 2: '🎁 2등', 3: '🃏 3등', 4: '🍜 4등', 5: '🧻 꽝' };
/** Red roulette cards: their own pop when used (큰 수 / 작은 수 / 딱 그 칸 / 월급날 직행). */
const ROLL_CARD_POP = { big_roll: '🔼', small_roll: '🔽', exact_roll: '🎯', payday_rush: '💨' };
/** Stage 8 board reactions over the pawn (the cut-in follows). */
const STAGE8_POP = { met: '💘', dated: '💕', married: '💍', childBorn: '👶', allowance: '💌', houseBought: '🏠', houseSold: '🔁' };
const CHILD_GROW_POP = { dol: '🎂', school: '🎒', exam: '📝', job: '💼' };
/** Name tag text: name + Stage 7 roulette-modifier badge (`tagBadge`, e.g. 「✂️−3」). */
const tagName = (c) => (c?.tagBadge ? `${c.name} ${c.tagBadge}` : c?.name ?? '');

/** tile id for a character position (same rule as server board.tileIdAt; loop maps: index < 0 → the start tile). */
export function tileIdForPosition(board, pos) {
  return loopTileId(board, pos) ?? 'start';
}

function createTweens() {
  const list = [];
  const finish = (tw) => {
    const i = list.indexOf(tw);
    if (i < 0) return;
    list.splice(i, 1);
    clearTimeout(tw.safety);
    tw.fn(1);
    tw.resolve();
  };
  return {
    /** Run fn(k) for k∈[0,1] over `sec` seconds (eased). Resolves at the end; a timer guards stalls. */
    add(sec, fn, ease = (x) => x) {
      return new Promise((resolve) => {
        const tw = { t: 0, sec: Math.max(0.001, sec), fn: (k) => fn(ease(k)), resolve };
        tw.safety = setTimeout(() => finish(tw), sec * 1000 + 600);
        list.push(tw);
        tw.fn(0);
      });
    },
    update(dt) {
      for (const tw of [...list]) {
        tw.t += dt;
        if (tw.t >= tw.sec) finish(tw);
        else tw.fn(tw.t / tw.sec);
      }
    },
    finishAll() {
      for (const tw of [...list]) finish(tw);
    },
  };
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ quality?: string, meta?: object, hooks?: {
 *   onStep?: (event) => void,          // engine event reached in the animation (toasts / side panel floats)
 *   onRouletteTap?: () => void,        // tap on the idle roulette (spin shortcut)
 *   onViewChange?: (mode) => void,     // camera view switched ('follow' | 'overview')
 *   onError?: (err) => void }}} opts
 */
export function createBoard3D(canvas, { quality = 'high', meta = null, hooks = {} } = {}) {
  let preset = QUALITY_PRESETS[quality] ?? QUALITY_PRESETS.high;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'default', preserveDrawingBuffer: false });
  renderer.setPixelRatio(1);
  renderer.autoClear = false;
  renderer.info.autoReset = false;

  const wrap = canvas.parentElement;
  const overlay = document.createElement('div');
  overlay.className = 'b3-overlay';
  overlay.innerHTML = '<div class="b3-fade"></div><div class="b3-sub" hidden></div><div class="b3-banner" hidden></div><div class="b3-num" hidden></div>';
  wrap.appendChild(overlay);
  const elSub = overlay.querySelector('.b3-sub');
  const elBanner = overlay.querySelector('.b3-banner');
  const elNum = overlay.querySelector('.b3-num');
  const elFade = overlay.querySelector('.b3-fade');

  const scene = new THREE.Scene();
  const SKY = new THREE.Color('#bfe6ff');
  scene.background = SKY;
  scene.fog = new THREE.Fog(SKY, 55, 140);
  const hemi = new THREE.HemisphereLight(0xf4fbff, 0x7f9a60, 2.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.5);
  sun.position.set(-12, 30, 18);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.5, 260);
  // warm-up scene: same lights + fog (→ the same shader programs) for uploading a prebuilt era off screen
  const warmScene = new THREE.Scene();
  warmScene.fog = scene.fog;
  warmScene.add(hemi.clone(), sun.clone());

  // shared by every era of a board (never disposed with an era's group): vertex-colour / tile / ground materials, the
  // board-wide icon atlas and the cached label textures
  const vcMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const tileMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const groundMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const SHARED = new Set([vcMat, tileMat, groundMat]);
  const shared = { atlas: null, labels: new Map(), grass: null };
  const tweens = createTweens();
  const roulette = createRoulette3D();
  const emotionThrottle = createThrottle(900);

  // ---------- state ----------
  const S = {
    board: null,
    boardKey: null,
    world: dataWorld(meta), // 세계 설정: the room's world (setBoard `world`; tile icon variants), else the meta's
    layout: null,
    eraIndex: 0, // the era whose loop is built
    wantEra: null, // the state's era (switched when the eraTransition animation plays, else once idle)
    staticGroup: null,
    labels: { routes: {}, eras: [] },
    eras: new Map(), // eraIndex → built (or building) era entry of the current board (the shown one + a prebuilt next)
    shown: null, // the shown era entry
    layoutSeq: 0, // bumps on every swap
    extent: 0, // shown era: farthest drawn point from its centre (fog / far plane)
    warmQueue: [], // prebuilt entries waiting for their off-screen upload pass
    lastBuild: null, // timings of the last shown era (stats().build)
    pawns: new Map(), // charId → { pawn, tileId, moving, order, target: Vector3, finished, settleAt? }
    reduced: reducedMotion(), // prefers-reduced-motion: no idle breathing / settle wobble (hops stay)
    chars: [],
    current: null, // state's current char (applied when idle)
    shownCurrent: null, // ring / follow target actually shown
    mine: false,
    subtitle: '',
    animSubtitle: '',
    rouletteMode: 'hidden', // hidden | idle | active
    rouletteIdleWanted: false,
    rouletteK: 0, // 0 idle size → 1 active size
    syncTimer: null,
    template: null,
    frames: 0,
    fps: 0,
    fpsWindow: { t: 0, n: 0 },
    stats: { calls: 0, triangles: 0 },
    disposed: false,
  };

  // camera rig (orbit state mutated by controls; camfit.js has the pure defaults / fit math)
  const defaultOrbit = () => orbitDefaults(canvas.clientWidth || 1, canvas.clientHeight || 1);
  const orbit = defaultOrbit();
  orbit.maxRadius = ORBIT_LIMITS.maxRadius; // raised to the whole-map radius (controls clamp the zoom with it)
  const rig = {
    target: new THREE.Vector3(),
    goal: new THREE.Vector3(),
    follow: null, // charId
    view: 'follow', // 'follow' (current pawn) | 'overview' (the whole shown era)
    hold: null, // timed camera shot: { kind: 'overview' | 'zone', view?, t, sec, swing, resolve }
    ov: null, // the last whole-map fit used
    ovCache: new Map(), // fit key → whole-map fit (a few angles: the transition swing, a drag)
    cover: { top: 0, bottom: 0 }, // canvas fractions hidden under page overlays (sticky spin dock, reaction bar, top bar)
    avoid: [], // canvas CSS-px rects of buttons over the board (🗺️ view toggle) the whole map should stay clear of
    userZoom: false,
    userPan: false,
    userRotate: false,
    portrait: null, // orientation the default orbit was chosen for
  };
  const controls = createOrbitControls(canvas, {
    state: orbit,
    onInput: (kind) => {
      if (kind === 'zoom') rig.userZoom = true;
      if (kind === 'pan') rig.userPan = true;
      if (kind === 'rotate') rig.userRotate = true;
    },
    onTap: (x, y) => {
      if (S.rouletteMode === 'idle' && S.rouletteIdleTappable) {
        const r = rouletteRegion('idle', canvas.clientWidth, canvas.clientHeight);
        if (x >= r.x && x <= r.x + r.size && y >= r.y && y <= r.y + r.size) hooks.onRouletteTap?.();
      }
    },
  });
  controls.enabled = preset.controls;

  // ring for the current character + landing pulse
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.07, 6, 28), new THREE.MeshBasicMaterial({ color: 0xff7a2f }));
  ring.rotation.x = Math.PI / 2;
  ring.visible = false;
  scene.add(ring);
  const pulse = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.95, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  pulse.rotation.x = -Math.PI / 2;
  pulse.visible = false;
  scene.add(pulse);

  const particles = createParticles(scene);
  // Stage 5.6: MC dog mascots (호야 & 봄이) beside the track at the start of the current era (6 draw calls)
  const mascots = createMascots(scene, { material: vcMat });
  const mascotState = { on: false, era: null };

  function mascotSpot() {
    const L = S.layout;
    const t = L?.tiles[L.startId];
    if (!t) return null;
    const dx = Math.sin(t.yaw);
    const dz = Math.cos(t.yaw);
    const nx = -dz; // "near" normal (towards the camera side)
    const nz = dx;
    // behind the era's first tile (pawns walk away from them), slightly on the far side, facing the camera side
    return { x: t.x - dx * 2.5 - nx * 1.1, z: t.z - dz * 2.5 - nz * 1.1, yaw: Math.atan2(nx, nz) };
  }

  function updateMascots(dt, t) {
    if (!mascotState.on || !S.layout) return;
    const era = `${S.boardKey}:${S.eraIndex}`;
    if (era !== mascotState.era) {
      const spot = mascotSpot();
      if (spot) mascots.setTarget(spot.x, spot.z, spot.yaw, mascotState.era == null);
      mascotState.era = era;
      mascots.setVisible(true);
    }
    mascots.update(dt, t, camera);
  }
  const pawnAnchor = (charId) => {
    const P = S.pawns.get(charId);
    if (!P) return null;
    const v = P.pawn.group.position.clone();
    v.y += P.pawn.holder.position.y + P.pawn.height + 0.55;
    return v;
  };
  const emotion = createEmotionLayer(scene, { anchor: pawnAnchor });

  // ---------- board building ----------
  const tileTypes = () => meta?.board?.tileTypes ?? {};
  const routeInfo = (key) => meta?.board?.routes?.[key] ?? { name: key, icon: '' };
  const tileColor = (type) => tileTypes()[type]?.color ?? DEFAULT_TILE_COLORS[type] ?? '#cccccc';

  const startTileId = () => S.layout?.startId ?? 'start';
  function tileWorld(id, out = new THREE.Vector3()) {
    const t = S.layout?.tiles[id] ?? S.layout?.tiles[startTileId()];
    return t ? out.set(t.x, TILE_TOP, t.z) : out.set(0, TILE_TOP, 0);
  }

  // ---------- board building ----------
  // One entry per era of the current board ({index, group, layout, labels, …}): the shown era plus, during the era's
  // last rounds, the next one built step by step in idle time (`prepareEra`) and uploaded off screen (`warmUp`), so the
  // era transition only swaps groups. Materials, the board-wide icon atlas and label textures are shared by every era
  // (no shader recompiles, no texture re-uploads); an era's own geometry is disposed after the transition's fade.
  const eraTilesOf = (era) => [...(era?.tiles ?? []), ...Object.values(era?.routes ?? {}).flatMap((r) => r.tiles ?? [])];
  const idle = (cb) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(cb, { timeout: 400 }) : setTimeout(() => cb(null), 30));

  /** Dispose an era group's own GPU resources (shared materials, the atlas and label textures stay). */
  function disposeGroup(g) {
    if (!g) return;
    g.removeFromParent();
    g.traverse((o) => {
      // sprites share three's internal quad geometry: only their own (uncached) material goes
      if (!o.isSprite) o.geometry?.dispose();
      if (o.isInstancedMesh) o.dispose(); // its instance matrix / colour buffers
      const m = o.material;
      if (m && !SHARED.has(m)) {
        m.map?.dispose();
        m.dispose();
      }
    });
  }

  /** Drop every era build (board / quality change) plus the board-wide atlas and label textures. */
  function clearEras() {
    for (const E of S.eras.values()) {
      E.job?.cancel();
      disposeGroup(E.group);
    }
    S.eras.clear();
    S.warmQueue = [];
    S.shown = null;
    S.staticGroup = null;
    S.labels = { routes: {}, eras: [] };
    if (shared.atlas) {
      shared.atlas.texture.dispose();
      shared.atlas.material.dispose();
      SHARED.delete(shared.atlas.material);
      shared.atlas = null;
    }
    for (const l of shared.labels.values()) {
      l.material.map?.dispose();
      l.material.dispose();
      SHARED.delete(l.material);
    }
    shared.labels.clear();
  }

  function iconKey(t) {
    return t.icon || tileTypes()[t.type]?.icon || DEFAULT_TILE_GLYPH[t.type] || TEXT_ICON[t.type] || '?';
  }

  /** Atlas of tile icons (glyph or accepted asset image) → { texture, cellOf(key) → [u0,v0,u1,v1] }. */
  function buildAtlas(entries) {
    const keys = [...new Set(entries.map((e) => e.key))];
    const CELL = 128;
    const COLS = 8;
    const rows = Math.max(1, Math.ceil(keys.length / COLS));
    const c = document.createElement('canvas');
    c.width = CELL * COLS;
    c.height = CELL * rows;
    const ctx = c.getContext('2d');
    const emoji = canvasHasEmoji();
    const draw = (i, key, type, img = null) => {
      const x = (i % COLS) * CELL;
      const y = Math.floor(i / COLS) * CELL;
      ctx.clearRect(x, y, CELL, CELL);
      ctx.fillStyle = 'rgba(255,255,255,0.93)';
      ctx.beginPath();
      ctx.arc(x + CELL / 2, y + CELL / 2, CELL * 0.44, 0, Math.PI * 2);
      ctx.fill();
      const ribbon = RIBBON[type];
      if (img) {
        const s = CELL * 0.7;
        ctx.drawImage(img, x + (CELL - s) / 2, y + (CELL - s) / 2 - (ribbon ? CELL * 0.06 : 0), s, s);
      } else {
        const glyph = emoji ? key : TEXT_ICON[type] ?? key;
        const size = [...glyph].length <= 1 ? (ribbon ? 56 : 64) : [...glyph].length <= 2 ? 44 : 30;
        ctx.font = `900 ${size}px ${FONT_STACK}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = tileColor(type);
        ctx.fillText(glyph, x + CELL / 2, y + CELL / 2 + (ribbon ? -8 : 4));
      }
      if (ribbon) {
        // 💵 월급날 / 🎪 찬스 광장: a coloured ring + a ribbon in the same atlas cell (no extra draw call)
        ctx.lineWidth = 8;
        ctx.strokeStyle = tileColor(type);
        ctx.beginPath();
        ctx.arc(x + CELL / 2, y + CELL / 2, CELL * 0.4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = tileColor(type);
        ctx.fillRect(x + CELL * 0.12, y + CELL * 0.7, CELL * 0.76, CELL * 0.22);
        ctx.font = `900 ${Math.round(CELL * 0.16)}px ${FONT_STACK}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        ctx.fillText(ribbon, x + CELL / 2, y + CELL * 0.815);
      }
    };
    const info = new Map(entries.map((e) => [e.key, e]));
    keys.forEach((k, i) => draw(i, info.get(k).glyph, info.get(k).type));
    const texture = canvasTexture(c);
    const cellOf = (key) => {
      const i = keys.indexOf(key);
      const u0 = (i % COLS) / COLS;
      const row = Math.floor(i / COLS);
      const v1 = 1 - row / rows;
      return [u0, v1 - 1 / rows, u0 + 1 / COLS, v1];
    };
    // Swap in accepted asset-studio icons when available (keeps the glyph otherwise).
    loadAssetIndex()
      .then(() => {
        keys.forEach((k, i) => {
          const { glyph, type } = info.get(k);
          // the type's own icon (icon-<type>) first, else the borrowed shared one (salary → money …); the room's world variant wins
          const a = findTileIcon(type, { glyph, world: S.world, find: findAsset });
          if (!a?.url) return;
          const img = new Image();
          img.onload = () => {
            if (S.disposed || shared.atlas?.texture !== texture) return;
            draw(i, glyph, type, img);
            texture.needsUpdate = true;
          };
          img.src = a.url;
        });
      })
      .catch(() => {});
    return { texture, cellOf };
  }

  /** The board-wide icon atlas (every era's tile glyphs; one texture + material shared by all eras). */
  function ensureAtlas() {
    if (shared.atlas?.boardKey === S.boardKey && shared.atlas.world === S.world) return shared.atlas;
    const entries = [];
    for (const era of S.board?.eras ?? []) for (const t of eraTilesOf(era)) entries.push({ key: `${iconKey(t)}|${t.type}`, glyph: iconKey(t), type: t.type });
    const atlas = buildAtlas(entries);
    atlas.material = new THREE.MeshBasicMaterial({ map: atlas.texture, transparent: true, depthWrite: false });
    atlas.boardKey = S.boardKey;
    atlas.world = S.world;
    SHARED.add(atlas.material);
    shared.atlas = atlas;
    return atlas;
  }

  /** Billboard label whose texture + material are cached per text / style (identical payday signs share one). */
  function labelSprite(text, { height = 0.6, renderOrder = 20, ...style } = {}) {
    const key = JSON.stringify([text, style]);
    let l = shared.labels.get(key);
    if (!l) {
      const c = textCanvas(text, style);
      const material = new THREE.SpriteMaterial({ map: canvasTexture(c), transparent: true, depthTest: false, depthWrite: false });
      SHARED.add(material);
      l = { material, aspect: c.width / c.height };
      shared.labels.set(key, l);
    }
    const sp = new THREE.Sprite(l.material);
    sp.scale.set(height * l.aspect, height, 1);
    sp.renderOrder = renderOrder;
    sp.userData.aspect = l.aspect;
    sp.userData.baseHeight = height;
    return sp;
  }

  /** Ground vertex colours: the era tint, lightened under the grass texture once it is loaded. */
  function tintGround(geo, eraId) {
    const col = geo.attributes.color;
    const c = new THREE.Color(themeFor(eraId).ground);
    if (shared.grass) c.lerp(new THREE.Color(1, 1, 1), 0.55);
    for (let i = 0; i < col.count; i++) col.setXYZ(i, c.r, c.g, c.b);
    col.needsUpdate = true;
  }

  // the generated grass texture: loaded once, shared by every era's ground (UVs in world units / 9)
  loadAssetIndex()
    .then(() => {
      const a = findAsset({ kind: 'texture', surface: 'grass' });
      if (!a?.url || S.disposed) return;
      const img = new Image();
      img.onload = () => {
        if (S.disposed) return;
        // soften the generated texture (low contrast "detail" layer under the era tint)
        const cv = document.createElement('canvas');
        cv.width = img.naturalWidth || 512;
        cv.height = img.naturalHeight || 512;
        const cx = cv.getContext('2d');
        cx.drawImage(img, 0, 0, cv.width, cv.height);
        cx.fillStyle = 'rgba(196, 222, 170, 0.55)';
        cx.fillRect(0, 0, cv.width, cv.height);
        const tex = canvasTexture(cv);
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        shared.grass = tex;
        groundMat.map = tex;
        groundMat.needsUpdate = true;
        for (const E of S.eras.values()) if (E.ground) tintGround(E.ground, E.eraId);
      };
      img.src = a.url;
    })
    .catch(() => {});

  // ground: one tinted plane under this era's town (vertex colours → the grass texture only shifts the hue)
  function buildGround(E) {
    const pb = boundsOf([...Object.values(E.layout.tiles), ...E.props], 0);
    const margin = 46;
    const W = pb.maxX - pb.minX + margin * 2;
    const D = pb.maxZ - pb.minZ + margin * 2;
    const ground = new THREE.PlaneGeometry(W, D, 1, 1);
    ground.rotateX(-Math.PI / 2);
    ground.translate((pb.minX + pb.maxX) / 2, 0, (pb.minZ + pb.maxZ) / 2);
    const uv = ground.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * W) / 9, (uv.getY(i) * D) / 9); // = repeat (W/9, D/9)
    ground.setAttribute('color', new THREE.BufferAttribute(new Float32Array(ground.attributes.position.count * 3), 3));
    tintGround(ground, E.eraId);
    E.ground = ground;
    E.group.add(new THREE.Mesh(ground, groundMat));
  }

  // roads: the closed ring (curb + sand) and the route ribbons — one merged mesh
  function buildRoads(E) {
    const L = E.layout;
    const ring = [];
    for (let i = 0; i < L.ring.length - 1; i += 2) ring.push(L.ring[i]);
    if (L.closed !== false) ring.push(L.ring[0], L.ring[2] ?? L.ring[0]); // closed: overlap the seam
    else ring.push(L.ring.at(-1));
    const roadParts = [stripGeometry(ring, 2.5, 0.012, '#fffaf0'), stripGeometry(ring, 2.05, 0.02, '#e3d3b4')];
    for (const key of ROUTE_ORDER) {
      const r = L.era.routes?.[key];
      if (!r) continue;
      roadParts.push(stripGeometry(r.ribbon, 2.3, 0.03, '#ffffff'), stripGeometry(r.ribbon, 1.9, 0.038, ROUTE_COLORS[key]));
    }
    E.group.add(new THREE.Mesh(mergeColored(roadParts), vcMat));
  }

  // tiles: instanced base + coloured top (paydays / pass tiles / the fork a bit bigger)
  function buildTiles(E) {
    const list = Object.values(E.layout.tiles);
    const base = new THREE.InstancedMesh(new THREE.BoxGeometry(TILE_SIZE + 0.2, 0.12, TILE_SIZE + 0.2), tileMat, list.length);
    const top = new THREE.InstancedMesh(new THREE.BoxGeometry(TILE_SIZE, 0.16, TILE_SIZE), tileMat, list.length);
    const c = new THREE.Color();
    const white = new THREE.Color('#fffaf0');
    list.forEach((t, i) => {
      const k = BIG_TILE[t.type] ?? 1;
      base.setMatrixAt(i, mat4(t.x, 0.07, t.z, 0, t.yaw, 0, [k, 1, k]));
      top.setMatrixAt(i, mat4(t.x, 0.19, t.z, 0, t.yaw, 0, [k, 1, k]));
      base.setColorAt(i, t.route && t.route !== 'main' ? c.set(ROUTE_COLORS[t.route]).lerp(white, 0.35) : t.type === 'salary' ? c.set('#fff3b0') : white);
      top.setColorAt(i, c.set(tileColor(t.type)));
    });
    for (const m of [base, top]) {
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
      E.group.add(m);
    }
  }

  // markers (one merged mesh): 💵 payday = gold coin ring + sign post, 🎪 pass tile = a little striped tent, ⚔️ 토벌 = a
  // chimera in a bush + a sasumata, 🌿 풀뽑기 = a weed tuft + basket (치이카와 모드 tiles)
  function buildMarkers(E) {
    const L = E.layout;
    const marks = [];
    for (const t of eraTilesOf(S.board.eras[E.index])) {
      const lt = L.tiles[t.id];
      if (!lt) continue;
      const nx = -Math.cos(lt.yaw); // outwards (+normal of the walking direction)
      const nz = Math.sin(lt.yaw);
      if (t.type === 'salary') {
        marks.push(colored(new THREE.TorusGeometry(1.12, 0.09, 5, 22), '#f2c94c', mat4(lt.x, 0.3, lt.z, Math.PI / 2, 0, 0)));
        const px = lt.x + nx * 1.45;
        const pz = lt.z + nz * 1.45;
        marks.push(colored(new THREE.CylinderGeometry(0.06, 0.06, 1.3, 5), '#8a5a3c', mat4(px, 0.65, pz)));
        marks.push(colored(new THREE.BoxGeometry(0.7, 0.42, 0.08), tileColor('salary'), mat4(px, 1.25, pz, 0, lt.yaw + Math.PI / 2, 0)));
      } else if (t.type === 'pass') {
        const px = lt.x + nx * 1.55;
        const pz = lt.z + nz * 1.55;
        marks.push(colored(new THREE.CylinderGeometry(0.55, 0.62, 0.55, 8), '#ffffff', mat4(px, 0.28, pz)));
        marks.push(colored(new THREE.ConeGeometry(0.72, 0.75, 8), '#e2504c', mat4(px, 0.92, pz)));
        marks.push(colored(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 4), '#8a5a3c', mat4(px, 1.5, pz)));
        marks.push(colored(new THREE.BoxGeometry(0.3, 0.18, 0.03), '#ffcf3f', mat4(px + 0.15, 1.66, pz)));
      } else if (t.type === 'goal') {
        // 🏁 finish gate: two posts + a chequered bar
        for (const side of [-1, 1]) marks.push(colored(new THREE.CylinderGeometry(0.08, 0.08, 2.2, 6), '#2d2a32', mat4(lt.x + nx * 1.25 * side, 1.1, lt.z + nz * 1.25 * side)));
        marks.push(colored(new THREE.BoxGeometry(2.7, 0.36, 0.12), '#ffffff', mat4(lt.x, 2.1, lt.z, 0, lt.yaw + Math.PI / 2, 0)));
        marks.push(colored(new THREE.BoxGeometry(2.72, 0.12, 0.14), '#2d2a32', mat4(lt.x, 2.1, lt.z, 0, lt.yaw + Math.PI / 2, 0)));
      } else if (t.type === 'hunt') {
        // ⚔️ 토벌 (치이카와 모드): a little purple chimera peeking out of a bush + a sasumata stuck in the ground
        const px = lt.x + nx * 1.45;
        const pz = lt.z + nz * 1.45;
        marks.push(colored(new THREE.SphereGeometry(0.5, 7, 4), '#4f8a3c', mat4(px, 0.22, pz, 0, 0, 0, [1.25, 0.6, 1.1])));
        marks.push(colored(new THREE.SphereGeometry(0.34, 7, 5), '#8e5bb5', mat4(px, 0.62, pz)));
        for (const s of [-1, 1]) {
          marks.push(colored(new THREE.ConeGeometry(0.08, 0.26, 4), '#f4e6c8', mat4(px + s * 0.17, 0.98, pz, 0, 0, -s * 0.35)));
          marks.push(colored(new THREE.SphereGeometry(0.075, 5, 3), '#ffffff', mat4(px + s * 0.13, 0.7, pz + 0.27)));
          marks.push(colored(new THREE.SphereGeometry(0.04, 4, 2), '#2d2a32', mat4(px + s * 0.13, 0.7, pz + 0.33)));
        }
        const sx = px - nz * 0.75;
        const sz = pz + nx * 0.75;
        marks.push(colored(new THREE.CylinderGeometry(0.04, 0.04, 1.5, 4), '#8a6b4a', mat4(sx, 0.75, sz, 0, 0, 0.12)));
        marks.push(colored(new THREE.TorusGeometry(0.17, 0.035, 3, 6, Math.PI), '#b9c2cc', mat4(sx - 0.09, 1.66, sz, 0, 0, Math.PI + 0.12)));
      } else if (t.type === 'weed') {
        // 🌿 풀뽑기 (치이카와 모드): a tuft of tall weeds + a small basket beside the tile
        const px = lt.x + nx * 1.35;
        const pz = lt.z + nz * 1.35;
        [[-0.18, 0.62, '#5aa84a'], [0.05, 0.8, '#6cc070'], [0.24, 0.55, '#4f9a40'], [-0.02, 0.46, '#7bd06a']].forEach(([dx, h, col], i) => {
          marks.push(colored(new THREE.ConeGeometry(0.11, h, 4), col, mat4(px + dx, h / 2, pz + (i % 2 ? 0.12 : -0.1), (i % 2 ? 0.15 : -0.15), 0, -dx * 0.8)));
        });
        marks.push(colored(new THREE.CylinderGeometry(0.3, 0.22, 0.32, 7), '#c8a165', mat4(px - nz * 0.75, 0.16, pz + nx * 0.75)));
      } else if (t.type === 'island') {
        // 🏝️ 한방역전섬 (노년 역전): a sand islet with a palm and a red-gold roulette disc on a post
        const px = lt.x + nx * 1.6;
        const pz = lt.z + nz * 1.6;
        marks.push(colored(new THREE.CylinderGeometry(0.75, 0.9, 0.18, 9), '#f4d58d', mat4(px, 0.09, pz)));
        marks.push(colored(new THREE.CylinderGeometry(0.06, 0.09, 1.3, 5), '#8a5a3c', mat4(px - 0.3, 0.75, pz, 0, 0, 0.12)));
        for (let k = 0; k < 4; k++) marks.push(colored(new THREE.ConeGeometry(0.16, 0.7, 4), '#2fa35a', mat4(px - 0.38 + Math.cos(k * 1.57) * 0.25, 1.38, pz + Math.sin(k * 1.57) * 0.25, Math.sin(k * 1.57) * 1.2, 0, -Math.cos(k * 1.57) * 1.2)));
        marks.push(colored(new THREE.CylinderGeometry(0.04, 0.04, 1.0, 4), '#5a3f28', mat4(px + 0.35, 0.6, pz)));
        marks.push(colored(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 10), '#ffd23f', mat4(px + 0.35, 1.18, pz, Math.PI / 2, lt.yaw, 0)));
        marks.push(colored(new THREE.CylinderGeometry(0.25, 0.25, 0.1, 10), '#e2504c', mat4(px + 0.35, 1.18, pz, Math.PI / 2, lt.yaw, 0)));
      } else if (t.type === 'contest') {
        // 🏆 노년 대회: a little gold cup on a pedestal
        const px = lt.x + nx * 1.4;
        const pz = lt.z + nz * 1.4;
        marks.push(colored(new THREE.BoxGeometry(0.42, 0.36, 0.42), '#e9e2d0', mat4(px, 0.18, pz)));
        marks.push(colored(new THREE.CylinderGeometry(0.05, 0.08, 0.26, 5), '#e6a817', mat4(px, 0.49, pz)));
        marks.push(colored(new THREE.CylinderGeometry(0.24, 0.1, 0.32, 7), '#ffd23f', mat4(px, 0.78, pz)));
      } else if (t.type === 'auction') {
        // 🔨 골동품 경매: a wooden block with a gavel lying on it
        const px = lt.x + nx * 1.4;
        const pz = lt.z + nz * 1.4;
        marks.push(colored(new THREE.CylinderGeometry(0.3, 0.34, 0.2, 7), '#8e6b4a', mat4(px, 0.1, pz)));
        marks.push(colored(new THREE.CylinderGeometry(0.04, 0.04, 0.7, 4), '#c69c6d', mat4(px, 0.3, pz, 0, lt.yaw, Math.PI / 2)));
        marks.push(colored(new THREE.CylinderGeometry(0.11, 0.11, 0.3, 6), '#5a3f28', mat4(px + Math.sin(lt.yaw) * 0.32, 0.3, pz + Math.cos(lt.yaw) * 0.32, Math.PI / 2, lt.yaw, 0)));
      } else if (t.type === 'start') {
        marks.push(colored(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 5), '#6b6f76', mat4(lt.x - nx * 1.2, 0.8, lt.z - nz * 1.2)));
        marks.push(colored(new THREE.BoxGeometry(0.6, 0.38, 0.04), '#e2504c', mat4(lt.x - nx * 1.2 + 0.3, 1.4, lt.z - nz * 1.2)));
      }
    }
    if (marks.length) E.group.add(new THREE.Mesh(mergeColored(marks), vcMat));
  }

  // icons: one merged quad mesh on the board-wide atlas
  function buildIcons(E) {
    const L = E.layout;
    const atlas = ensureAtlas();
    const pos = [];
    const uv = [];
    for (const t0 of eraTilesOf(S.board.eras[E.index])) {
      const t = L.tiles[t0.id];
      if (!t) continue;
      const Q = 0.58 * (BIG_TILE[t0.type] ?? 1);
      const [u0, v0, u1, v1] = atlas.cellOf(`${iconKey(t0)}|${t0.type}`);
      // world-aligned quads (u → +x, v → −z) so icons read upright from the default camera
      const y = TILE_TOP + 0.005;
      const a = [t.x - Q, y, t.z + Q];
      const b = [t.x + Q, y, t.z + Q];
      const cc = [t.x + Q, y, t.z - Q];
      const d = [t.x - Q, y, t.z - Q];
      pos.push(...a, ...b, ...cc, ...a, ...cc, ...d);
      uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
    }
    const iconGeo = new THREE.BufferGeometry();
    iconGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    iconGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    E.group.add(new THREE.Mesh(iconGeo, atlas.material));
  }

  // labels: era sign at the start, fork / rejoin, paydays, the goal, route names (cached label textures)
  function buildLabels(E) {
    const L = E.layout;
    const st = L.tiles[L.startId];
    if (st) {
      const th = themeFor(E.eraId);
      const sp = labelSprite(`${th.sign} ${L.era.name} 시대 · ${L.closed === false ? '🏁 골인 경쟁' : '🚩 출발'}`, { height: 0.8, size: 44, color: '#ffffff', bg: 'rgba(45,42,50,0.88)', pad: 18, renderOrder: 14 });
      sp.position.set(st.x, 3.4, st.z);
      E.group.add(sp);
      E.labels.eras.push(sp);
    }
    for (const t of eraTilesOf(S.board.eras[E.index])) {
      if (!['stop', 'merge', 'salary', 'goal'].includes(t.type)) continue;
      const lt = L.tiles[t.id];
      if (!lt) continue;
      const kind = t.type;
      const text = kind === 'salary' ? `💵 ${t.label || '월급날'}` : `${t.icon ?? ''} ${t.label}`.trim();
      const sp = labelSprite(text, {
        height: kind === 'merge' ? 0.42 : kind === 'salary' ? 0.46 : kind === 'goal' ? 0.7 : 0.52,
        size: 40,
        color: '#ffffff',
        bg: kind === 'salary' ? 'rgba(47,158,87,0.95)' : kind === 'merge' ? 'rgba(141,153,174,0.95)' : kind === 'goal' ? 'rgba(45,42,50,0.92)' : 'rgba(226,80,76,0.95)',
        pad: 14,
        renderOrder: 13,
      });
      sp.position.set(lt.x, kind === 'merge' ? 1.4 : kind === 'salary' ? 1.9 : kind === 'goal' ? 2.9 : 2.1, lt.z);
      E.group.add(sp);
    }
    for (const key of ROUTE_ORDER) {
      const r = L.era.routes?.[key];
      if (!r) continue;
      const info = routeInfo(key);
      const sp = labelSprite(`${info.icon} ${info.name}`, { height: 0.8, size: 42, color: '#ffffff', bg: ROUTE_COLORS[key], pad: 16, renderOrder: 13, border: '#ffffff' });
      sp.position.set(r.label.x, 2.3, r.label.z);
      E.group.add(sp);
      (E.labels.routes[E.index] ??= {})[key] = sp;
    }
  }

  /** The build of one era as idle-sized steps (each a few ms … ~30 ms in SwiftShader). */
  function eraSteps(E) {
    return [
      {
        name: 'layout',
        fn: () => {
          E.layout = layoutBoard(S.board, { eraIndex: E.index });
          E.viewPts = viewPoints(E.layout); // camera fit points (whole-map view)
          E.extent = viewExtent(E.layout, E.viewPts);
        },
      },
      { name: 'planProps', fn: () => (E.props = planProps(E.layout, { density: preset.props, seed: 11 + E.index })) },
      { name: 'ground', fn: () => buildGround(E) },
      { name: 'roads', fn: () => buildRoads(E) },
      { name: 'tiles', fn: () => buildTiles(E) },
      { name: 'markers', fn: () => buildMarkers(E) },
      { name: 'icons', fn: () => buildIcons(E) },
      { name: 'props', fn: () => E.group.add(buildProps(E.props, vcMat)) },
      { name: 'labels', fn: () => buildLabels(E) },
    ];
  }

  function finishEntry(E) {
    if (E.built || !E.job?.done) return;
    E.built = true;
    E.stats = stepStats(E.job.times);
    E.builtAt = performance.now();
    // a prebuilt era is uploaded off screen next frame (no buffer / texture uploads at the swap)
    if (E !== S.shown && E.mode === 'idle') S.warmQueue.push(E);
  }

  /** Start building era `index` of the current board in idle time (or, with `sync`, finish it now). */
  function prepare(index, { sync = false } = {}) {
    const n = S.board?.eras?.length ?? 0;
    if (!S.board || !Number.isInteger(index) || index < 0 || index >= n) return null;
    let E = S.eras.get(index);
    if (!E) {
      E = { index, eraId: S.board.eras[index]?.id, group: new THREE.Group(), labels: { routes: {}, eras: [] }, layout: null, props: null, ground: null, extent: 0, built: false, warm: false, mode: sync ? 'sync' : 'idle', job: null };
      E.group.name = `era-${index}`;
      S.eras.set(index, E);
      E.job = runSteps(eraSteps(E), { schedule: sync ? () => {} : idle, now: () => performance.now() });
      E.job.promise.then((ok) => ok && !S.disposed && finishEntry(E));
    }
    if (sync && !E.job.done) E.job.flush();
    finishEntry(E);
    return E;
  }

  /** Upload a prebuilt era off screen (1×1 scissor before the frame's clear) so swapping it in costs no uploads. */
  function warmUp(E) {
    if (!E?.built || E.warm || E === S.shown || S.eras.get(E.index) !== E) return;
    const t0 = performance.now();
    warmScene.add(E.group);
    const culled = [];
    E.group.traverse((o) => {
      if (o.frustumCulled) {
        o.frustumCulled = false;
        culled.push(o);
      }
    });
    renderer.setScissorTest(true);
    renderer.setScissor(0, 0, 1, 1);
    renderer.setViewport(0, 0, 1, 1);
    renderer.render(warmScene, camera);
    renderer.setScissorTest(false);
    for (const o of culled) o.frustumCulled = true;
    warmScene.remove(E.group);
    E.warm = true;
    E.warmMs = performance.now() - t0;
  }

  /** Show a built era: its group replaces the shown one (disposed in idle time, after the fade). */
  function showEntry(E) {
    const old = S.shown;
    if (old && old !== E) {
      old.group.removeFromParent();
      old.job?.cancel();
      if (S.eras.get(old.index) === old) S.eras.delete(old.index);
      const g = old.group;
      idle(() => disposeGroup(g));
    }
    // keep only the shown era and a prebuilt next one
    for (const [i, x] of [...S.eras]) {
      if (x === E || i === E.index + 1) continue;
      S.eras.delete(i);
      x.job?.cancel();
      if (x !== old) disposeGroup(x.group);
    }
    S.warmQueue = S.warmQueue.filter((x) => S.eras.get(x.index) === x && x !== E);
    scene.add(E.group);
    S.shown = E;
    S.staticGroup = E.group;
    S.layout = E.layout;
    S.labels = E.labels;
    S.eraIndex = E.index;
    S.extent = E.extent;
    S.viewPts = E.viewPts;
    S.layoutSeq++;
    rig.ovCache.clear();
    rig.ov = null;
  }

  /** Show era `i` of S.board (prebuilt → a swap; else built on the spot); every pawn stands on the start tile. */
  function buildEra(i) {
    const t0 = performance.now();
    const n = S.board?.eras?.length ?? 1;
    const idx = clamp(Number.isInteger(i) ? i : 0, 0, Math.max(0, n - 1));
    S.wantEra = null;
    const before = S.eras.get(idx);
    const prebuilt = !!before?.built;
    const E = prepare(idx, { sync: true });
    if (!E) return;
    showEntry(E);
    mascotState.era = null;
    for (const P of S.pawns.values()) {
      P.moving = false;
      placeAt(P, S.layout.startId, true);
    }
    const st = S.layout.tiles[S.layout.startId] ?? { x: 0, z: 0 };
    rig.target.set(st.x, 0, st.z);
    const t1 = performance.now();
    const steps = Object.fromEntries(E.job.times.map((t) => [t.name, Math.round(t.ms * 10) / 10]));
    // timings (stats().build): `swapMs` = main-thread time of this call; a prebuilt era spent `buildMs` in idle slices
    S.lastBuild = { era: idx, prebuilt, partial: !prebuilt && !!before, warm: !!E.warm, swapMs: t1 - t0, buildMs: E.stats.total, maxStepMs: E.stats.max, maxStep: E.stats.maxName, slices: E.job.slices, warmMs: E.warmMs ?? null, steps };
    S.measureRender = true;
    try {
      performance.measure(prebuilt ? 'b3:swap' : 'b3:build', { start: t0, end: t1 });
    } catch {
      /* old browsers */
    }
  }

  /** Era transition: fade out → swap in the new era → fade in on the whole new map → back to the view mode. */
  async function switchEra(i, { animate = true } = {}) {
    const fade = animate && !document.hidden;
    if (fade) {
      elFade.classList.add('on');
      await new Promise((r) => setTimeout(r, 380));
    }
    if (S.disposed) return;
    const t0 = performance.now();
    buildEra(i);
    reconcile();
    if (!fade) return;
    snapOverview(preset.fixedCamera ? 0 : TOUR_SWING); // behind the fade: no glide across the old map
    if (S.lastBuild) S.lastBuild.switchMs = performance.now() - t0; // swap + pawns + the whole-map fit
    elFade.classList.remove('on');
    if (preset.fixedCamera) return new Promise((r) => setTimeout(r, 900));
    await holdShot({ kind: 'overview', sec: TOUR_SEC, swing: TOUR_SWING });
  }

  // ---------- pawns ----------
  function arrange() {
    const groups = new Map();
    for (const [id, P] of S.pawns) {
      if (P.moving) continue;
      if (!groups.has(P.tileId)) groups.set(P.tileId, []);
      groups.get(P.tileId).push(id);
    }
    for (const [tileId, ids] of groups) {
      ids.sort((a, b) => S.pawns.get(a).order - S.pawns.get(b).order);
      const base = tileWorld(tileId);
      const t = S.layout?.tiles[tileId];
      const crowded = ids.length > 3;
      ids.forEach((id, k) => {
        const off = slotOffset(k, ids.length);
        const P = S.pawns.get(id);
        P.target.set(base.x + off.x, TILE_TOP, base.z + off.z);
        if (t) P.yaw = t.yaw;
        P.crowded = crowded;
      });
    }
  }

  function placeAt(P, tileId, snap = true) {
    P.tileId = S.layout?.tiles[tileId] ? tileId : startTileId();
    arrange();
    if (snap) P.pawn.group.position.copy(P.target);
  }

  // ---------- camera ----------
  // Two view modes (`setView`): 'follow' = a close orbit on the current pawn (spectators get a closer spotlight),
  // 'overview' = the whole shown era fitted exactly into the canvas (camfit.js: tiles + lanes, pawns / name tags, signs,
  // labels; refitted whenever the canvas aspect or the orbit angle changes). TV quality always shows the overview from
  // its fixed overhead angle. Timed shots (`holdShot`) — the era-transition tour on the whole new map, the route-zone
  // look — run on top and then hand back to the mode.
  const TOUR_SEC = 2.4; // era transition: hold on the whole new map …
  const TOUR_SWING = 0.16; // … while the azimuth eases back from this offset (a slow orbit)

  /** Orbit angles in use (TV: the fixed overhead camera). */
  const viewAngles = () => (preset.fixedCamera ? TV_ORBIT : { azimuth: orbit.azimuth, polar: orbit.polar });

  /**
   * Whole-map fit of the shown era for these angles and the canvas (cached per quantized angle / aspect / cover —
   * a drag or the transition swing refits about every degree, not every frame).
   */
  function overviewFor(azimuth, polar) {
    if (!S.layout) return null;
    const az = quantizeAngle(azimuth);
    const pol = quantizeAngle(polar);
    const aspect = camera.aspect || 1.6;
    const cv = rig.cover;
    const w = cssW || canvas.clientWidth || 1;
    const h = cssH || canvas.clientHeight || 1;
    const key = `${az.toFixed(2)}|${pol.toFixed(2)}|${aspect.toFixed(4)}|${camera.fov}|${cv.top}|${cv.bottom}|${w}x${h}|${rig.avoidKey ?? ''}`;
    let ov = rig.ovCache.get(key);
    if (!ov) {
      const inset = coverInset(cv);
      // stay clear of the idle roulette (top-right; always, so the view doesn't move when it shows / hides) and buttons
      const r = rouletteRegion('idle', w, h);
      const avoid = [ndcBox({ x: r.x, y: r.y, w: r.size, h: r.size }, w, h), ...rig.avoid.map((b) => ndcBox(b, w, h))].filter(Boolean);
      ov = overviewView(S.layout, { azimuth: az, polar: pol, aspect, fov: camera.fov, inset, avoid, points: S.viewPts });
      if (rig.ovCache.size >= 8) rig.ovCache.delete(rig.ovCache.keys().next().value);
      rig.ovCache.set(key, ov);
    }
    rig.ov = ov;
    return ov;
  }

  function followChar(charId) {
    rig.follow = charId;
  }

  /** 'follow' | 'overview' — a fresh framing (zoom / pan reset); hooks.onViewChange reports changes. */
  function setView(mode) {
    const next = mode === 'overview' ? 'overview' : 'follow';
    const changed = next !== rig.view;
    rig.view = next;
    rig.userZoom = false;
    rig.userPan = false;
    orbit.panX = orbit.panZ = 0;
    if (changed) hooks.onViewChange?.(next);
  }

  /** Put the camera straight onto the whole-map view (behind the era-transition fade). */
  function snapOverview(swing = 0) {
    const a = viewAngles();
    const ov = overviewFor(a.azimuth + swing, a.polar);
    if (!ov) return;
    rig.target.set(ov.target.x, 0, ov.target.z);
    orbit.radius = ov.radius;
  }

  /** A timed camera shot ({kind: 'overview', swing} | {kind: 'zone', view}); resolves when it ends. */
  function holdShot(shot) {
    rig.hold?.resolve();
    return new Promise((resolve) => {
      const H = { t: 0, swing: 0, ...shot, resolve };
      rig.hold = H;
      setTimeout(() => {
        if (rig.hold === H) {
          rig.hold = null;
          resolve();
        }
      }, shot.sec * 1000 + 800);
    });
  }

  function updateCamera(dt) {
    const ang = viewAngles();
    let az = ang.azimuth;
    const pol = ang.polar;
    const H = rig.hold;
    let desired = null;
    if (H) {
      H.t += dt;
      const k = Math.min(1, H.t / H.sec);
      if (H.kind === 'overview') {
        az += H.swing * (1 - easeInOutCubic(k));
        const ov = overviewFor(az, pol);
        if (ov) {
          desired = rig.goal.set(ov.target.x, 0, ov.target.z);
          orbit.radius = lerp(orbit.radius, ov.radius, 1 - Math.exp(-dt * 8));
        }
      } else if (H.view) {
        desired = rig.goal.set(H.view.target.x, 0, H.view.target.z);
        orbit.radius = lerp(orbit.radius, H.view.radius, 1 - Math.exp(-dt * 3));
      }
      if (desired) rig.target.lerp(desired, 1 - Math.exp(-dt * (H.kind === 'overview' ? 12 : 4)));
      if (H.t >= H.sec) {
        rig.hold = null;
        H.resolve();
      }
    } else if (preset.fixedCamera || rig.view === 'overview') {
      const ov = overviewFor(az, pol);
      if (ov) {
        desired = rig.goal.set(ov.target.x, 0, ov.target.z);
        if (!preset.fixedCamera) {
          desired.x += orbit.panX;
          desired.z += orbit.panZ;
        }
        rig.target.lerp(desired, 1 - Math.exp(-dt * 4.5));
        if (!rig.userZoom || preset.fixedCamera) orbit.radius = lerp(orbit.radius, ov.radius, 1 - Math.exp(-dt * 2.5));
      }
    } else {
      const P = rig.follow ? S.pawns.get(rig.follow) : null;
      if (P) {
        desired = rig.goal.copy(P.pawn.group.position);
        desired.y = 0;
        desired.x += orbit.panX;
        desired.z += orbit.panZ;
        rig.target.lerp(desired, 1 - Math.exp(-dt * 4.5));
      }
      if (!rig.userZoom) orbit.radius = lerp(orbit.radius, followRadius(cssW || canvas.clientWidth, cssH || canvas.clientHeight, { mine: S.mine }), 1 - Math.exp(-dt * 2.5));
    }
    // a far overview: fog behind the board's far edge, far plane beyond it, zoom limit above the whole-map radius
    const fog = fogRange(orbit.radius, S.extent);
    scene.fog.near = fog.near;
    scene.fog.far = fog.far;
    if (Math.abs(camera.far - fog.cameraFar) > 0.5) {
      camera.far = fog.cameraFar;
      camera.updateProjectionMatrix();
    }
    orbit.maxRadius = Math.max(ORBIT_LIMITS.maxRadius, (rig.ov?.radius ?? 0) * 1.3, S.extent * 2.6);
    const r = orbit.radius;
    const sp = Math.sin(pol);
    camera.position.set(rig.target.x + Math.sin(az) * sp * r, rig.target.y + LOOK_Y + Math.cos(pol) * r, rig.target.z + Math.cos(az) * sp * r);
    camera.lookAt(rig.target.x, rig.target.y + LOOK_Y, rig.target.z);
  }

  // ---------- overlays ----------
  let bannerTimer = null;
  function banner(text, ms = 1600) {
    elBanner.textContent = text;
    elBanner.hidden = false;
    elBanner.classList.remove('show');
    void elBanner.offsetWidth;
    elBanner.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => (elBanner.hidden = true), ms);
  }
  function renderSubtitle() {
    const text = S.animSubtitle || S.subtitle;
    elSub.hidden = !text;
    elSub.textContent = text;
    elSub.classList.toggle('mine', S.mine && !S.animSubtitle);
  }
  function showNumber(v) {
    const r = rouletteRegion('active', canvas.clientWidth, canvas.clientHeight);
    elNum.textContent = String(v);
    elNum.style.left = `${r.x + r.size / 2}px`;
    elNum.style.top = `${r.y + r.size / 2}px`;
    elNum.style.fontSize = `${Math.round(r.size * 0.32)}px`;
    elNum.hidden = false;
    elNum.classList.remove('show');
    void elNum.offsetWidth;
    elNum.classList.add('show');
    setTimeout(() => (elNum.hidden = true), 1100);
  }

  function setRouletteMode(mode) {
    S.rouletteMode = mode;
  }

  // ---------- current / sync ----------
  function applyCurrent() {
    const id = S.current;
    if (!animator.busy()) {
      // the state moved on to another era without an eraTransition animation (reload / missed events) → rebuild now
      if (S.wantEra != null && S.wantEra !== S.eraIndex) buildEra(S.wantEra);
      S.shownCurrent = id;
      S.animSubtitle = '';
      renderSubtitle();
      followChar(id); // (the overview view keeps showing the whole map)
      setRouletteMode(S.rouletteIdleWanted ? 'idle' : 'hidden');
      reconcile();
    }
  }

  /** Glide pawns whose shown tile differs from the authoritative state (no pending animation). */
  function reconcile() {
    if (animator.busy()) return;
    let changed = false;
    for (const c of S.chars) {
      const P = S.pawns.get(c.id);
      if (!P || P.moving) continue;
      if ((c.position?.eraIndex ?? S.eraIndex) !== S.eraIndex) continue; // still showing the previous era's map
      const want = tileIdForPosition(S.board, c.position);
      if (P.tileId !== want) {
        P.tileId = S.layout?.tiles[want] ? want : startTileId();
        changed = true;
      }
    }
    if (changed) arrange();
  }

  function scheduleSync() {
    clearTimeout(S.syncTimer);
    S.syncTimer = setTimeout(() => {
      if (!animator.busy()) applyCurrent();
    }, 380);
  }

  // ---------- animation steps ----------
  const cameraOn = (charId) => {
    if (!preset.fixedCamera && !rig.userPan) followChar(charId);
    else rig.follow = charId;
  };

  async function hopPath(e, ctx) {
    const P = S.pawns.get(e.charId);
    if (!P || !S.layout) return;
    clearTimeout(S.syncTimer);
    S.shownCurrent = e.charId;
    cameraOn(e.charId);
    const name = S.chars.find((c) => c.id === e.charId)?.name ?? '';
    S.animSubtitle = e.resumed ? `🚶 ${name} 이어서 ${e.path.length}칸` : `🚶 ${name} ${e.path.length}칸 이동`;
    renderSubtitle();
    if (e.from && S.layout.tiles[e.from] && P.tileId !== e.from) placeAt(P, e.from, true);
    const path = (e.path ?? []).filter((id) => S.layout.tiles[id]);
    if (ctx.instant || !path.length) {
      if (path.length) placeAt(P, path.at(-1), true);
      return;
    }
    const startId = startTileId();
    P.moving = true;
    arrange();
    const hopSec = preset.name === 'high' ? 0.3 : 0.26;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const bs = P.pawn.baseScale ?? 0.82;
    for (const id of path) {
      a.copy(P.pawn.group.position);
      tileWorld(id, b);
      P.yaw = Math.atan2(b.x - a.x, b.z - a.z);
      // CH-1 squash & stretch: anticipation squash → stretched take-off → landing squash (travel only while airborne)
      await tweens.add(hopSec, (k) => {
        const pose = hopPose(k, 0.75);
        P.pawn.group.position.lerpVectors(a, b, pose.move);
        P.pawn.holder.position.y = pose.y;
        P.pawn.holder.scale.set(bs * pose.sxz, bs * pose.sy, bs * pose.sxz);
      });
      P.tileId = id;
      if (id === startId && path.length > 1) emotion.pop(e.charId, '🔁', { dur: 1.1 }); // wrapped past the start
    }
    P.pawn.holder.scale.setScalar(bs);
    P.pawn.holder.position.y = 0;
    P.settleAt = performance.now() / 1000; // settle wobble (frame loop)
    P.moving = false;
    arrange();
  }

  function landedFx(e) {
    const t = S.layout?.tiles[e.tileId];
    if (!t) return;
    pulse.position.set(t.x, TILE_TOP + 0.02, t.z);
    pulse.visible = true;
    pulse.material.color.set(tileColor(e.tileType));
    tweens.add(0.6, (k) => {
      pulse.scale.setScalar(1 + k * 1.3);
      pulse.material.opacity = 0.85 * (1 - k);
      if (k >= 1) pulse.visible = false;
    });
    const kind = BURST_FOR_TILE[e.tileType];
    const n = particleCount(preset.name, kind === 'confetti' ? 60 : 16);
    if (kind && n) particles.burst(kind, { x: t.x, y: TILE_TOP, z: t.z }, n);
  }

  const handlers = {
    turnStarted: () => {},
    spun: async (e, ctx) => {
      hooks.onStep?.(e);
      S.shownCurrent = e.charId;
      cameraOn(e.charId);
      const name = S.chars.find((c) => c.id === e.charId)?.name ?? '';
      // 룰렛 실력 모드: everyone sees what was aimed, then 「🎯 목표 7 → 결과 8」
      S.animSubtitle = e.skill ? `🎯 ${name}의 룰렛! 목표 ${e.target}` : `🎡 ${name}의 룰렛!`;
      // 큰 수 / 작은 수 카드: the range this roulette is limited to (딱 그 칸 / 월급날 직행 say it after the wheel)
      const rng = modRange((Array.isArray(e.mods) ? e.mods : []).find((m) => m?.kind === 'range'));
      if (rng) S.animSubtitle += ` · ${rng.icon} ${rng.text}`;
      renderSubtitle();
      if (ctx.instant) {
        hooks.onSpinResult?.(e);
        return;
      }
      setRouletteMode('active');
      await roulette.spin(e.value, { duration: preset.name === 'high' ? 2.4 : 2.0 });
      showNumber(e.value);
      hooks.onSpinResult?.(e); // the wheel has stopped (no spoiler): game2d toasts my own 🎯 result above cut-ins
      if (e.skill) {
        banner(aimText(e), 1900);
        emotion.pop(e.charId, aimShort(e), { dur: 1.8 });
      }
      // Stage 6: while serving the pawn moves only `steps` (half the roulette)
      if (e.halved && Number.isFinite(e.steps) && e.steps !== e.value) emotion.pop(e.charId, `🪖${e.steps}칸`, { dur: 1.6 });
      else if (spinNote(e)) {
        const note = spinNote(e); // Stage 7 card / item, 큰 수 · 작은 수 · 딱 그 칸 · 월급날 직행
        emotion.pop(e.charId, note.text.replace(' ', ''), { dur: 1.6 });
        if (note.rush) banner(`💨 ${name}, 월급날로 직행!`, 1600);
      }
      await ctx.sleep(750);
      setRouletteMode('hidden');
    },
    betResolved: (e) => hooks.onStep?.(e),
    moved: async (e, ctx) => {
      await hopPath(e, ctx);
      hooks.onStep?.(e); // halted / resumed / wrapped notes (side panel floats)
      if (ctx.instant) return;
      const note = haltNote(e);
      if (!note || !e.halted) return;
      emotion.pop(e.charId, note.icon, { dur: 1.6 });
      banner(e.halted === 'salary' ? (e.rush ? '💨 월급날 직행! 도착' : '💵 월급날! 여기서 멈춰요') : e.halted === 'pass' ? '🎪 찬스 광장! 잠깐 멈춤' : e.halted === 'island' ? '🏝️ 한방역전섬! 인생 한 방?' : '🔀 인생 갈림길!', 1500);
      await ctx.sleep(e.halted === 'pass' || e.halted === 'island' ? 450 : 300);
    },
    // Loop maps: the whole table moves to the next era's map together (one transition per era)
    eraTransition: async (e, ctx) => {
      hooks.onStep?.(e);
      const eras = S.board?.eras ?? [];
      let i = eras.findIndex((x) => x.id === e.toEraId);
      if (i < 0) i = Number.isInteger(e.eraIndex) ? e.eraIndex : S.eraIndex + 1;
      const era = eras[i];
      banner(`${themeFor(era?.id).sign} ${era?.name ?? ''} 시대! 모두 새 지도로`, 2200);
      await switchEra(i, { animate: !ctx.instant });
    },
    eraChanged: (e, ctx) => {
      hooks.onStep?.(e);
      // per-character entries of a transition: a small sparkle (the transition itself tours the new map)
      if (!ctx.instant) emotion.pop(e.charId, '✨', { dur: 1.1 });
    },
    landed: async (e, ctx) => {
      if (ctx.instant) return;
      landedFx(e);
      await ctx.sleep(260);
    },
    moneyChanged: (e, ctx) => {
      hooks.onStep?.(e);
      if (ctx.instant || !e.delta) return;
      emotion.float(e.charId, `${e.delta > 0 ? '+' : ''}${won(e.delta)}`, e.delta > 0 ? '#1f7a45' : '#d6453f');
      return ctx.sleep(160);
    },
    routeChosen: async (e, ctx) => {
      hooks.onStep?.(e);
      const info = routeInfo(e.route);
      banner(`${info.icon} ${info.name} 루트!`);
      if (ctx.instant || !S.layout?.era?.routes) return;
      const labels = S.labels.routes[S.eraIndex] ?? {};
      const chosen = labels[e.route];
      if (chosen) {
        const h = chosen.userData.baseHeight;
        tweens.add(2.4, (k) => {
          const s = 1 + Math.sin(k * Math.PI) * 0.45;
          chosen.scale.set(h * chosen.userData.aspect * s, h * s, 1);
        });
      }
      if (preset.fixedCamera) return ctx.sleep(1400);
      // a quick look over the branch zone: fork → the chosen lane → rejoin
      const L = S.layout;
      const r = L.era.routes[e.route];
      const fork = L.tiles[S.board.eras[S.eraIndex]?.tiles?.[L.era.fork]?.id];
      const rejoin = L.tiles[S.board.eras[S.eraIndex]?.tiles?.[L.era.rejoin]?.id];
      const pts = [fork, rejoin, ...(r?.ribbon ?? [])].filter(Boolean).map((p) => ({ x: p.x, y: 0.3, z: p.z }));
      if (r?.label) pts.push({ x: r.label.x, y: 2.8, z: r.label.z });
      const zone = zoneView(pts, { ...viewAngles(), aspect: camera.aspect || 1.6, fov: camera.fov });
      await holdShot({ kind: 'zone', view: zone, sec: 1.8 });
      followChar(e.charId);
    },
    finished: async (e, ctx) => {
      hooks.onStep?.(e);
      const name = S.chars.find((c) => c.id === e.charId)?.name ?? '';
      // final era (노년 골인 경쟁): goal order is back; 빈곤 농장 / 조기 은퇴 finish without the goal
      banner(e.retired === 'early' ? `🏖️ ${name} 조기 은퇴!` : e.retired === 'late' ? `⏰ 노년 마감 — ${name} ${e.place}등` : e.retired === 'bust' ? `🌾 ${name} 빈곤 농장행…` : `🏁 ${name} ${e.place}등 골인!`, 2000);
      if (ctx.instant) return;
      const P = S.pawns.get(e.charId);
      if (P && preset.particles > 0) {
        const p = P.pawn.group.position;
        particles.burst('confetti', { x: p.x, y: 0.5, z: p.z }, particleCount(preset.name, 90), { up: 5, spread: 3, life: 1.2, size: 0.4 });
      }
      await ctx.sleep(1300);
    },
    bonusSpin: (e, ctx) => {
      hooks.onStep?.(e);
      if (!ctx.instant) emotion.pop(e.charId, `🎰${e.value}`, { dur: 1.4 });
      return ctx.sleep(ctx.instant ? 0 : 300);
    },
    gameOver: async (e, ctx) => {
      hooks.onStep?.(e);
      banner('🏆 게임 종료! 결과 발표', 1800);
      if (!ctx.instant) await ctx.sleep(1500);
    },
    emotion: (e) => {
      if (emotionThrottle(`${e.charId}:${e.emotion}`)) emotion.pop(e.charId, e.emotion);
    },
    // ---------- Stage 6 ----------
    statChanged: (e, ctx) => {
      hooks.onStep?.(e);
      if (ctx.instant || !e.delta) return;
      const [icon, color] = STAT_FLOAT[e.stat] ?? ['⭐', '#1f7a45'];
      emotion.float(e.charId, `${e.reason === 'thanks' ? '🎁' : ''}${icon}${e.delta > 0 ? '+' : ''}${e.delta}`, e.delta > 0 ? color : '#d6453f');
      return ctx.sleep(120);
    },
    salary: (e, ctx) => {
      hooks.onStep?.(e);
      if (ctx.instant) return;
      emotion.pop(e.charId, '💵', { dur: 1.4 });
      return ctx.sleep(120);
    },
    newsFlash: async (e, ctx) => {
      hooks.onStep?.(e);
      if (e.title) banner(`📰 ${e.title}`, 2600);
      if (!ctx.instant) await ctx.sleep(900);
    },
    // ---------- Stage 7 ----------
    cardUsed: async (e, ctx) => {
      hooks.onStep?.(e);
      if (ctx.instant) return;
      if (e.targetId) {
        emotion.pop(e.charId, '🃏', { dur: 1.2 });
        emotion.pop(e.targetId, '💢', { dur: 1.8 });
      } else emotion.pop(e.charId, e.cardId === 'pledge' ? '🗳️' : ROLL_CARD_POP[e.cardId] ?? '✨', { dur: 1.4 });
      await ctx.sleep(420);
    },
    // blue / red cards: a card left the hand (💍 결혼운 소멸 · 🩹 부상 회복 · 🗑️ 버림 · 🏅 공적 사용)
    cardLost: async (e, ctx) => {
      hooks.onStep?.(e);
      if (ctx.instant || !e.charId || e.reason === 'used') return; // 응모권 / 복권 used in a draw: the draw pops say it
      emotion.pop(e.charId, cardLostInfo(e, null).glyph, { dur: 1.3 });
      await ctx.sleep(250);
    },
    cardBlocked: async (e, ctx) => {
      hooks.onStep?.(e);
      if (ctx.instant) return;
      emotion.pop(e.targetId ?? e.charId, '🛡️', { dur: 1.8 });
      if (e.targetId && e.charId) emotion.pop(e.charId, '💦', { dur: 1.2 });
      await ctx.sleep(420);
    },
    holidayStarted: async (e, ctx) => {
      hooks.onStep?.(e);
      banner(e.kind === 'chuseok' ? '🌕 추석 대잔치!' : e.kind === 'seol' ? '🧧 설날 대잔치!' : '🎉 명절 대잔치!', 2000);
      if (!ctx.instant) await ctx.sleep(700);
    },
    holidayResult: async (e, ctx) => {
      hooks.onStep?.(e);
      if (ctx.instant) return;
      for (const r of e.results ?? []) if (r.won) emotion.pop(r.charId, '🎴', { dur: 1.6 });
      await ctx.sleep(300);
    },
    tradeResolved: async (e, ctx) => {
      hooks.onStep?.(e);
      if (ctx.instant || e.status !== 'accepted') return;
      emotion.pop(e.fromId, '🤝', { dur: 1.4 });
      emotion.pop(e.toId, '🤝', { dur: 1.4 });
      await ctx.sleep(200);
    },
    ...Object.fromEntries(
      Object.entries(STAGE7_POP).map(([type, glyph]) => [
        type,
        async (e, ctx) => {
          hooks.onStep?.(e);
          if (ctx.instant) return;
          const id = type === 'gift' ? e.toId : e.charId;
          if (type === 'lottoDraw' && e.kuji) {
            // 세계 설정: 쿠지 뽑기 — every holder pops their rank (1등 🧸 … 꽝 🧻)
            for (const r of e.entries ?? []) emotion.pop(r.charId, KUJI_POP[r.rank] ?? '🎟️', { dur: 1.8 });
          } else if (type === 'lottoDraw') {
            for (const r of e.entries ?? []) if (Number(r.prize) > 0) emotion.pop(r.charId, '🎱', { dur: 1.8 });
          } else if (id) emotion.pop(id, type === 'cardGained' && e.cardId === 'injury' ? '🤕' : glyph, { dur: 1.5 });
          await ctx.sleep(type === 'lottoDraw' ? 300 : 350);
        },
      ]),
    ),
    // ---------- Stage 8 ----------
    ...Object.fromEntries(
      Object.entries(STAGE8_POP).map(([type, glyph]) => [
        type,
        async (e, ctx) => {
          hooks.onStep?.(e);
          if (ctx.instant) return;
          emotion.pop(e.charId, glyph, { dur: type === 'allowance' || type === 'houseSold' ? 1.2 : 1.7 });
          const P = S.pawns.get(e.charId);
          if (P && preset.particles > 0 && (type === 'married' || type === 'childBorn' || type === 'houseBought')) {
            const p = P.pawn.group.position;
            particles.burst('confetti', { x: p.x, y: 0.5, z: p.z }, particleCount(preset.name, type === 'married' ? 60 : 40), { up: 4, spread: 2, life: 1, size: 0.35 });
          }
          await ctx.sleep(type === 'allowance' || type === 'houseSold' || type === 'dated' ? 200 : 450);
        },
      ]),
    ),
    // ---------- Stage 9 ----------
    submapEntered: async (e, ctx) => {
      hooks.onStep?.(e);
      if (ctx.instant) return;
      emotion.pop(e.charId, SUBMAP_POP[e.submap] ?? '🗺️', { dur: 1.5 });
      await ctx.sleep(350);
    },
    submapResult: async (e, ctx) => {
      hooks.onStep?.(e);
      if (ctx.instant) return;
      const amt = Number(e.amount) || 0;
      const r = String(e.result ?? '').toLowerCase();
      const lost = ['lose', 'lost', 'fail', 'failed', 'miss', 'none'].includes(r) || amt < 0;
      emotion.pop(e.charId, lost ? '💸' : amt > 0 ? `💰+${won(amt)}` : '✨', { dur: 1.7 });
      const P = S.pawns.get(e.charId);
      if (P && !lost && amt > 0 && preset.particles > 0) {
        const p = P.pawn.group.position;
        particles.burst('coin', { x: p.x, y: 0.5, z: p.z }, particleCount(preset.name, 30), { up: 4, spread: 1.6, life: 1 });
      }
      await ctx.sleep(420);
    },
    // ---------- 노년 역전 ----------
    islandResult: async (e, ctx) => {
      hooks.onStep?.(e);
      if (ctx.instant) return;
      const amt = Number(e.amount) || 0;
      const r = String(e.result ?? '');
      emotion.pop(e.charId, r === 'jackpot' ? `💥 대박! +${won(amt)}` : r === 'bust' ? '🌾 쪽박…' : r === 'retire' ? '🏖️ 은퇴' : e.win ? `🎯 +${won(amt)}` : `💸 ${won(amt)}`, { dur: r === 'jackpot' ? 2.4 : 1.8 });
      if (r === 'jackpot') banner(`💥 한방역전섬 대박!!! ×${Number(e.mult) || 1}`, 1800);
      else if (r === 'bust') banner('🌾 쪽박… 빈곤 농장으로', 1600);
      const P = S.pawns.get(e.charId);
      if (P && preset.particles > 0 && (e.win || r === 'bust')) {
        const p = P.pawn.group.position;
        particles.burst(r === 'bust' ? 'star' : r === 'jackpot' ? 'confetti' : 'coin', { x: p.x, y: 0.5, z: p.z }, particleCount(preset.name, r === 'jackpot' ? 60 : 24), { up: 4, spread: 1.6, life: 1.1, size: r === 'jackpot' ? 0.3 : undefined });
      }
      await ctx.sleep(r === 'jackpot' ? 650 : 420);
    },
    contestResult: async (e, ctx) => {
      hooks.onStep?.(e);
      if (ctx.instant) return;
      emotion.pop(e.charId, e.place === 1 ? `🏆 우승! +${won(Number(e.prize) || 0)}` : e.place === 2 ? `🥈 +${won(Number(e.prize) || 0)}` : '😅 탈락', { dur: 1.6 });
      const P = S.pawns.get(e.charId);
      if (P && e.place === 1 && preset.particles > 0) {
        const p = P.pawn.group.position;
        particles.burst('confetti', { x: p.x, y: 0.5, z: p.z }, particleCount(preset.name, 28), { up: 4, spread: 1.6, life: 1, size: 0.3 });
      }
      await ctx.sleep(380);
    },
    auctionResult: async (e, ctx) => {
      hooks.onStep?.(e);
      if (ctx.instant) return;
      emotion.pop(e.charId, e.fake ? '💥 가짜!' : `🔨 ×${Number(e.mult) || 1} +${won(Number(e.amount) || 0)}`, { dur: 1.6 });
      const P = S.pawns.get(e.charId);
      if (P && !e.fake && Number(e.mult) >= 2 && preset.particles > 0) {
        const p = P.pawn.group.position;
        particles.burst('coin', { x: p.x, y: 0.5, z: p.z }, particleCount(preset.name, 26), { up: 4, spread: 1.6, life: 1 });
      }
      await ctx.sleep(360);
    },
    seniorItem: async (e, ctx) => {
      hooks.onStep?.(e);
      if (ctx.instant) return;
      const icon = { dodge: '🚗', health: '💪', guard: '🛡️', pension: '♨️', busking: '🎸', royalty: '📖' }[e.use] ?? '👴';
      emotion.pop(e.charId, Number(e.amount) > 0 ? `${icon} +${won(Number(e.amount))}` : `${icon} 👴`, { dur: 1.4 });
      await ctx.sleep(260);
    },
    // ---------- 세계 설정 (🐹 치이카와 모드) ----------
    huntResult: async (e, ctx) => {
      hooks.onStep?.(e);
      if (ctx.instant) return;
      const amt = Number(e.amount) || 0;
      emotion.pop(e.charId, e.success ? `⚔️${amt > 0 ? ` +${won(amt)}` : ''}` : Number(e.injured) > 0 ? '💥🤕' : '💥', { dur: 1.7 });
      const P = S.pawns.get(e.charId);
      if (P && preset.particles > 0) {
        const p = P.pawn.group.position;
        particles.burst(e.success ? 'coin' : 'star', { x: p.x, y: 0.5, z: p.z }, particleCount(preset.name, e.success ? 30 : 14), { up: 4, spread: 1.6, life: 1 });
      }
      await ctx.sleep(420);
    },
    weedResult: async (e, ctx) => {
      hooks.onStep?.(e);
      if (ctx.instant) return;
      const exam = e.action === 'exam';
      emotion.pop(e.charId, exam ? (e.success ? `📝 ${e.grade ?? ''} 합격!` : '📝 불합격…') : `🌿${Number(e.amount) > 0 ? ` +${won(Number(e.amount))}` : ''}`, { dur: 1.6 });
      const P = S.pawns.get(e.charId);
      if (P && exam && e.success && preset.particles > 0) {
        const p = P.pawn.group.position;
        particles.burst('confetti', { x: p.x, y: 0.5, z: p.z }, particleCount(preset.name, Number(e.level) >= 5 ? 50 : 24), { up: 4, spread: 1.6, life: 1, size: 0.3 });
      }
      await ctx.sleep(exam ? 420 : 250);
    },
    treasureFound: async (e, ctx) => {
      hooks.onStep?.(e);
      if (ctx.instant) return;
      emotion.pop(e.charId, '💎', { dur: 1.8 });
      const P = S.pawns.get(e.charId);
      if (P && preset.particles > 0) {
        const p = P.pawn.group.position;
        particles.burst('star', { x: p.x, y: 0.5, z: p.z }, particleCount(preset.name, 28), { up: 4, spread: 1.4, life: 1 });
      }
      await ctx.sleep(420);
    },
    proposed: async (e, ctx) => {
      hooks.onStep?.(e);
      if (ctx.instant) return;
      emotion.pop(e.charId, e.success ? '💍' : '💔', { dur: 1.7 });
      await ctx.sleep(420);
    },
    childGrew: async (e, ctx) => {
      hooks.onStep?.(e);
      if (ctx.instant) return;
      emotion.pop(e.charId, CHILD_GROW_POP[e.kind] ?? '🧒', { dur: 1.5 });
      await ctx.sleep(300);
    },
    schoolMeet: async (e, ctx) => {
      hooks.onStep?.(e);
      banner('🏫 고교 첫 만남!', 1800);
      if (ctx.instant) return;
      for (const pr of e.pairs ?? []) emotion.pop(pr.charId, '💘', { dur: 1.6 });
      await ctx.sleep(500);
    },
    houseValueChanged: async (e, ctx) => {
      hooks.onStep?.(e);
      const m = Number(e.mult) || 1;
      banner(`${m >= 1 ? '📈' : '📉'} 부동산 시세 ${m >= 1 ? '+' : ''}${Math.round((m - 1) * 100)}%`, 2200);
      if (!ctx.instant) await ctx.sleep(600);
    },
    ...Object.fromEntries(
      Object.entries(STAGE6_POP).map(([type, glyph]) => [
        type,
        async (e, ctx) => {
          hooks.onStep?.(e);
          if (ctx.instant) return;
          emotion.pop(e.charId, glyph, { dur: 1.6 });
          const P = S.pawns.get(e.charId);
          if (P && preset.particles > 0 && (type === 'rankUp' || type === 'hiddenJobUnlocked' || type === 'educationChanged')) {
            const p = P.pawn.group.position;
            particles.burst('confetti', { x: p.x, y: 0.5, z: p.z }, particleCount(preset.name, 50), { up: 4, spread: 2, life: 1, size: 0.35 });
          }
          await ctx.sleep(450);
        },
      ]),
    ),
  };

  const animator = createAnimator({
    handlers,
    isHidden: () => typeof document !== 'undefined' && document.hidden,
    onError: (err) => hooks.onError?.(err),
  });
  animator.onIdle(() => {
    S.animSubtitle = '';
    applyCurrent();
    applyOutfits();
  });
  /** Costumes held back during the animation (Stage 6 growth outfits) → put on with a sparkle. */
  function applyOutfits() {
    if (S.disposed) return;
    for (const c of S.chars ?? []) {
      const P = S.pawns.get(c.id);
      if (!P?.pendingAvatar) continue;
      P.pendingAvatar = false;
      P.pawn.update(c.avatar, tagName(c), !!c.isMe);
      P.avatar = c.avatar;
      P.avatarKey = JSON.stringify(c.avatar);
      if (preset.particles > 0 && !document.hidden) emotion.pop(c.id, '✨', { dur: 1.1 });
    }
  }

  // ---------- render loop ----------
  let raf = 0;
  let last = performance.now();
  let lastRender = 0;
  let cssW = 0;
  let cssH = 0;
  const fpsProbes = [];
  const bufSize = new THREE.Vector2();

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    cssW = w;
    cssH = h;
    // pick the default view for the orientation (path runs up the screen on portrait phones); the whole-map fit
    // follows the new aspect by itself (camfit key)
    const portrait = isPortrait(w, h);
    if (portrait !== rig.portrait && !rig.userRotate) {
      rig.portrait = portrait;
      const d = defaultOrbit();
      orbit.azimuth = d.azimuth;
      orbit.polar = d.polar;
      if (!rig.userZoom) orbit.radius = d.radius;
    }
    const size = renderSize(preset, w, h);
    renderer.setSize(size.width, size.height, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
  ro?.observe(canvas);

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!canvas.isConnected || canvas.clientWidth === 0) return;
    if (now - lastRender < 1000 / preset.maxFps - 2) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    lastRender = now;
    if (canvas.clientWidth !== cssW || canvas.clientHeight !== cssH) resize();

    tweens.update(dt);
    roulette.update(dt);
    emotion.update(dt);
    particles.update(dt);
    const t = now / 1000;
    updateMascots(dt, t);
    for (const [id, P] of S.pawns) {
      const grp = P.pawn.group;
      if (!P.moving) {
        grp.position.lerp(P.target, 1 - Math.exp(-dt * 10));
        // CH-1: settle wobble after a move > the current pawn's squashy bounce > gentle breathing for everyone
        const settle = P.settleAt != null ? (t - P.settleAt) / SETTLE_SEC : 2;
        const calm = preset.name === 'tv' || S.reduced;
        const pose = settle < 1 && !calm ? landPose(settle) : id === S.shownCurrent && !animator.busy() ? bobPose(t) : calm ? REST_POSE : breathePose(t, P.order * 1.7);
        const bs = P.pawn.baseScale ?? 0.82;
        const h = P.pawn.holder;
        h.position.y = lerp(h.position.y, pose.y, 0.3);
        h.scale.set(lerp(h.scale.x, bs * pose.sxz, 0.35), lerp(h.scale.y, bs * pose.sy, 0.35), lerp(h.scale.z, bs * pose.sxz, 0.35));
      }
      grp.rotation.y = lerp(grp.rotation.y, P.yaw ?? 0, 1 - Math.exp(-dt * 12));
    }
    // narrow screens (phones): only the current / moving characters (+ mine off crowded tiles) keep their name
    // tag (they overlap otherwise); wider screens: every tag except others' on crowded tiles
    const narrowTags = cssW > 0 && cssW < NARROW_TAGS_PX;
    for (const [id, P] of S.pawns) {
      if (!P.pawn.tag) continue;
      P.pawn.tag.visible = narrowTags
        ? P.moving || id === S.shownCurrent || (P.isMe && !P.crowded)
        : P.moving || !P.crowded || id === S.shownCurrent || P.isMe;
    }
    const cur = S.pawns.get(S.shownCurrent);
    ring.visible = !!cur;
    if (cur) {
      ring.position.set(cur.pawn.group.position.x, TILE_TOP + 0.04, cur.pawn.group.position.z);
      ring.scale.setScalar(1 + Math.sin(t * 4) * 0.08);
    }
    updateCamera(dt);

    // a prebuilt era waiting for its upload: drawn once into a 1×1 scissor before this frame's clear (idle frames only)
    if (S.warmQueue.length && !animator.busy()) warmUp(S.warmQueue.shift());
    const size = renderer.getSize(bufSize);
    renderer.info.reset();
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, size.x, size.y);
    renderer.clear();
    const tr0 = S.measureRender ? performance.now() : 0;
    renderer.render(scene, camera);
    if (S.measureRender) {
      // first frame of a newly shown era (buffer / texture uploads unless it was warmed up)
      S.measureRender = false;
      if (S.lastBuild) S.lastBuild.firstRenderMs = performance.now() - tr0;
    }
    if (S.rouletteMode !== 'hidden') {
      S.rouletteK = lerp(S.rouletteK, S.rouletteMode === 'active' ? 1 : 0, 1 - Math.exp(-dt * 10));
      const a = rouletteRegion('idle', cssW, cssH);
      const b = rouletteRegion('active', cssW, cssH);
      const k = S.rouletteK;
      const ratio = size.x / cssW;
      const rs = lerp(a.size, b.size, k) * ratio;
      const rx = lerp(a.x, b.x, k) * ratio;
      const ry = size.y - (lerp(a.y, b.y, k) * ratio + rs);
      renderer.setScissorTest(true);
      renderer.setScissor(rx, ry, rs, rs);
      renderer.setViewport(rx, ry, rs, rs);
      renderer.clearDepth();
      renderer.render(roulette.scene, roulette.camera);
      renderer.setScissorTest(false);
    } else {
      S.rouletteK = 0;
    }
    S.stats = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, points: renderer.info.render.points };
    S.frames++;
    for (const p of [...fpsProbes]) {
      p.n++;
      if (now - p.t0 >= p.ms) {
        fpsProbes.splice(fpsProbes.indexOf(p), 1);
        p.resolve((p.n * 1000) / (now - p.t0));
      }
    }
    S.fpsWindow.n++;
    if (now - S.fpsWindow.t >= 1000) {
      S.fps = (S.fpsWindow.n * 1000) / (now - S.fpsWindow.t);
      S.fpsWindow = { t: now, n: 0 };
    }
  }
  resize();
  raf = requestAnimationFrame(frame);

  loadPawnTemplate().then((t) => {
    if (!t || S.disposed) return;
    S.template = t;
    for (const P of S.pawns.values()) P.pawn.useTemplate(t);
  });

  // ---------- public API ----------
  const api = {
    renderer,
    scene,
    camera,
    animator,
    get layout() {
      return S.layout;
    },
    get quality() {
      return preset.name;
    },

    /**
     * Build the scene for a board: only the loop of era `eraIndex` (the room's shared era). A new board rebuilds at
     * once; a new era of the same board waits for its `eraTransition` animation (else it switches once idle).
     * @param {object} board  room.board
     * @param {string|{key?: string, eraIndex?: number, world?: string}} opts  (a string = the old `key` argument;
     *   `world` = the room's world → tile icon variants, default the meta's)
     */
    setBoard(board, opts = {}) {
      const o = typeof opts === 'string' ? { key: opts } : opts ?? {};
      const k = o.key ?? JSON.stringify(board.eras.map((e) => [e.id, e.tiles.map((t) => t.type), Object.values(e.routes ?? {}).map((r) => r.tiles.map((t) => t.type))]));
      const era = Number.isInteger(o.eraIndex) ? o.eraIndex : 0;
      const world = typeof o.world === 'string' && o.world ? o.world : S.world;
      if (k !== S.boardKey || world !== S.world) {
        clearEras();
        S.boardKey = k;
        S.world = world;
        S.board = board;
        animator.clear();
        tweens.finishAll();
        buildEra(era);
        return;
      }
      S.board = board;
      if (era !== S.eraIndex) {
        S.wantEra = era;
        if (!animator.busy()) scheduleSync();
      } else S.wantEra = null;
    },
    /** Index of the era whose loop is shown. */
    get eraIndex() {
      return S.eraIndex;
    },

    /** Sync pawns with room.characters (positions glide unless an animation is pending). */
    setCharacters(chars) {
      if (!S.layout) return;
      S.chars = chars;
      const seen = new Set();
      chars.forEach((c, order) => {
        seen.add(c.id);
        let P = S.pawns.get(c.id);
        if (!P) {
          const pawn = createPawn({ avatar: c.avatar, defs: meta, name: tagName(c), isMe: !!c.isMe }); // CH-1: roster / props from /api/meta
          if (S.template) pawn.useTemplate(S.template);
          scene.add(pawn.group);
          P = { pawn, tileId: startTileId(), moving: false, order, target: new THREE.Vector3(), yaw: 0, isMe: !!c.isMe, crowded: false, avatar: c.avatar, avatarKey: JSON.stringify(c.avatar) };
          S.pawns.set(c.id, P);
          placeAt(P, tileIdForPosition(S.board, c.position), true);
        } else {
          // Stage 6 growth outfits: a new costume (era / job) waits until the board has played the events
          // (state arrives before its events → wait out the sync grace, then for the animator to go idle)
          const next = JSON.stringify(c.avatar);
          if (P.avatarKey !== next) {
            P.pawn.update(P.avatar, tagName(c), !!c.isMe);
            P.pendingAvatar = true;
            clearTimeout(S.outfitTimer);
            S.outfitTimer = setTimeout(() => !animator.busy() && applyOutfits(), 420);
          } else {
            P.pawn.update(c.avatar, tagName(c), !!c.isMe);
          }
          P.order = order;
          P.isMe = !!c.isMe;
        }
      });
      for (const [id, P] of S.pawns) {
        if (seen.has(id)) continue;
        P.pawn.dispose();
        S.pawns.delete(id);
      }
      arrange();
      scheduleSync();
    },

    /**
     * Current character from the room state. Applied right away when idle (after a short grace so the
     * matching SSE `events` can arrive first), otherwise once the animation queue drains.
     */
    setCurrent(charId, { mine = false, subtitle = '', rouletteIdle = false, rouletteTappable = false } = {}) {
      S.current = charId;
      S.mine = !!mine;
      S.subtitle = subtitle;
      S.rouletteIdleWanted = !!rouletteIdle;
      S.rouletteIdleTappable = !!rouletteTappable;
      if (!animator.busy()) {
        renderSubtitle();
        if (!S.shownCurrent) applyCurrent();
        else scheduleSync();
      }
    },

    focus(charId) {
      rig.userPan = false;
      orbit.panX = orbit.panZ = 0;
      followChar(charId);
    },

    /** Whole-map view of the shown era (loop maps: other eras aren't built) = setView('overview'). */
    focusEra(eraIndex = S.eraIndex) {
      if (eraIndex !== S.eraIndex || !S.layout) return;
      setView('overview');
    },

    /** Default orbit angle / zoom, back to following the current pawn. */
    resetCamera() {
      const max = orbit.maxRadius;
      Object.assign(orbit, defaultOrbit(), { maxRadius: max });
      rig.userRotate = false;
      setView('follow');
      followChar(S.shownCurrent ?? S.current);
    },

    /**
     * Camera view: 'follow' (close orbit on the current pawn) | 'overview' (the whole shown era fitted to the canvas).
     * The overview stays until switched back (turns / hops don't leave it); TV quality always shows the overview.
     */
    setView,
    get view() {
      return preset.fixedCamera ? 'overview' : rig.view;
    },
    /**
     * Parts of the canvas hidden under page overlays (fractions: the sticky spin dock / reaction bar below, the top bar
     * above) — the whole-map view keeps the loop in the visible part.
     */
    setViewInsets({ top = 0, bottom = 0, avoid = [] } = {}) {
      const f = (v) => clamp(Math.round((Number(v) || 0) * 100) / 100, 0, 0.6);
      rig.cover = { top: f(top), bottom: f(bottom) };
      rig.avoid = (Array.isArray(avoid) ? avoid : []).filter((b) => b && Number.isFinite(b.x) && Number.isFinite(b.y) && b.w > 0 && b.h > 0).map((b) => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) }));
      rig.avoidKey = rig.avoid.map((b) => `${b.x},${b.y},${b.w},${b.h}`).join(';');
    },
    /** Whole-map fit for the current canvas + orbit angle: {target, radius, extent, axis} (debug / tests). */
    overview() {
      const a = viewAngles();
      return overviewFor(a.azimuth, a.polar);
    },

    /**
     * Build era `i`'s static board in idle time (game2d: the next era during the era's last rounds) so its
     * eraTransition is a swap. No-op when it is shown, built or building.
     */
    prepareEra(i) {
      if (!S.board || i === S.eraIndex) return false;
      return !!prepare(i);
    },

    /** Queue engine events for animation; resolves when the queue drains. */
    playEvents(events) {
      return animator.push(events);
    },
    onIdle: (cb) => animator.onIdle(cb),
    /** Board banner (era / route / news flash). */
    showBanner: (text, ms) => banner(String(text ?? ''), ms),
    isBusy: () => animator.busy(),
    whenIdle: () => animator.whenIdle(),

    /** Floating emoji above characters (SSE reactions). */
    reaction(charIds, emoji) {
      for (const id of charIds) emotion.pop(id, emoji, { dur: 2.2 });
      mascots.look(2400); // the MCs look at the camera
    },

    /** Stage 5.6: show/hide the MC dog mascots (room config mcFrequency !== 'off'). */
    setMascots(on) {
      mascotState.on = !!on;
      if (!on) mascots.setVisible(false);
      else if (mascotState.era != null) mascots.setVisible(true);
    },
    /** MC mascots react to a big event: 'hop' | 'spin'. */
    mascotReact(kind = 'hop') {
      if (mascotState.on) mascots.react(kind);
    },
    get mascots() {
      return mascots;
    },

    resize,
    setQuality(q) {
      const next = QUALITY_PRESETS[q];
      if (!next || next.name === preset.name) return;
      preset = next;
      controls.enabled = preset.controls;
      resize();
      if (S.board) {
        const shown = new Map([...S.pawns].map(([id, P]) => [id, P.tileId]));
        const want = S.wantEra;
        clearEras(); // prop density differs per preset
        buildEra(S.eraIndex);
        S.wantEra = want;
        for (const [id, P] of S.pawns) placeAt(P, shown.get(id), true);
      }
    },

    /** renderer.info of the last frame + fps. */
    stats() {
      return { ...S.stats, fps: Math.round(S.fps * 10) / 10, quality: preset.name, popups: emotion.count, bursts: particles.count, busy: animator.busy(),
        mascots: { visible: mascots.group.visible, triangles: mascots.triangles, x: mascots.group.position.x, z: mascots.group.position.z },
        buffer: { width: canvas.width, height: canvas.height }, css: { width: canvas.clientWidth, height: canvas.clientHeight }, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, frames: S.frames, build: S.lastBuild ?? null,
        view: rig.view, shot: rig.hold?.kind ?? null, radius: Math.round(orbit.radius * 10) / 10, cover: { ...rig.cover }, eras: [...S.eras.values()].map((E) => ({ index: E.index, built: E.built, warm: E.warm, next: E.job?.next ?? 0 })) };
    },

    /** Average fps over the next `ms` milliseconds of rendering. */
    measureFps(ms = 3000) {
      return new Promise((resolve) => fpsProbes.push({ t0: performance.now(), ms, n: 0, resolve }));
    },

    dispose() {
      S.disposed = true;
      cancelAnimationFrame(raf);
      clearTimeout(S.syncTimer);
      clearTimeout(S.outfitTimer);
      clearTimeout(bannerTimer);
      ro?.disconnect();
      controls.dispose();
      animator.clear();
      tweens.finishAll();
      emotion.clear();
      particles.clear();
      for (const P of S.pawns.values()) P.pawn.dispose();
      S.pawns.clear();
      clearEras();
      groundMat.dispose();
      shared.grass?.dispose();
      roulette.dispose();
      mascots.dispose();
      renderer.dispose();
      overlay.remove();
    },
  };
  return api;
}
