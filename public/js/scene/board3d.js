// Three.js board scene (Stage 4): town + track + route ribbons, pawns, roulette overlay, event animations.
// Loop maps (원작식 순환 맵): only the current shared era's loop is built (`setBoard(board, {eraIndex})`); an
// `eraTransition` event fades out, rebuilds the static board for the new era (the old geometry is disposed), puts every
// pawn on the start tile and tours the new loop with the camera. Hops follow wraps (last tile → start), route branches,
// the pass pause (`moved.halted: 'pass'` then a second `moved {resumed: true}`) and forced stops (payday / fork).
//
//   const b3 = createBoard3D(canvas, { quality: 'high'|'low'|'tv', meta, hooks });
//   b3.setBoard(room.board, {eraIndex}); b3.setCharacters(room.characters); b3.setCurrent(charId, {mine, subtitle});
//   await b3.playEvents(events);   // SSE `events` → animator queue (returns when the queue drains)
//   b3.onIdle(cb) / b3.isBusy()    // the 2D UI shows decision modals only after animations finish
//   b3.animator.pause()/resume()/enqueue(fn)  // Stage 5 cut-ins take over the screen between steps
//
// Budget (docs/PLAN.md): ≤100 draw calls, ≤50k triangles, no shadows / postprocessing / AA,
// pixelRatio 1, HemisphereLight + 1 DirectionalLight, MeshLambertMaterial + vertex colors.
// Throws when WebGL is unavailable (the caller falls back to the 2D board).
import * as THREE from 'three';
import { layoutBoard, planProps, slotOffset, eraSweepPoints, ROUTE_ORDER, ROUTE_COLORS, themeFor, boundsOf } from './layout.js';
import { haltNote, tileIdForPosition as loopTileId } from '../shared/loop.js';
import { QUALITY_PRESETS, renderSize, particleCount } from './quality.js';
import { createMascots } from './mascots.js';
import { createAnimator } from './animator.js';
import { createPawn, loadPawnTemplate } from './pawn.js';
import { createRoulette3D } from './roulette3d.js';
import { createEmotionLayer, createThrottle } from './emotion.js';
import { createParticles, BURST_FOR_TILE } from './particles.js';
import { createOrbitControls } from './controls.js';
import { buildProps } from './props.js';
import { stripGeometry, mergeColored, colored, mat4 } from './geo.js';
import { makeTextSprite, disposeSprite, canvasHasEmoji, canvasTexture, FONT_STACK } from './sprites.js';
import { clamp, lerp, hopHeight, easeInOutCubic, catmullRom, arcLengths, pointAt, rouletteRegion } from './math.js';
import { loadAssetIndex, findAsset } from '../assets.js';
import { won } from '../format.js';
import { cardLostInfo, modRange, spinNote } from '../shared/cards.js';
import { aimShort, aimText } from '../ui/rouletteSkill.js';

const TILE_SIZE = 1.64;
const TILE_TOP = 0.27;
const NARROW_TAGS_PX = 700; // canvas CSS width below which only current / mine / moving pawns show name tags
/** Asset-studio icon ids (manifest meta.tile) per tile type. */
const ICON_ASSET_TILE = { money: 'money', heart: 'love', job: 'job', house: 'house', treasure: 'treasure', card: 'card', shop: 'shop', stop: 'stop', loss: 'bad', goal: 'goal', habit: 'school', salary: 'money', pass: 'shop' };
const TEXT_ICON = { start: '출발', money: '₩', loss: '−₩', event: '!', heart: '♥', job: '직업', card: '카드', shop: '상점', treasure: '보물', house: '집', stop: '갈림길', merge: '합류', goal: '골', habit: '습관', salary: '월급날', pass: '광장', hometown: '고향', temple: '산사', jeju: '제주', reversal: '역전' };
const DEFAULT_TILE_COLORS = { start: '#9aa5b1', money: '#f2c94c', loss: '#6c7bd1', event: '#5cb87a', heart: '#ff7eb6', job: '#4f8ee0', card: '#9a6ad6', shop: '#f39a3d', treasure: '#d4a017', house: '#c7773a', stop: '#e2504c', merge: '#8d99ae', goal: '#2d2a32', habit: '#20a39e', salary: '#2f9e57', pass: '#ff8a3d', hometown: '#7cb342', temple: '#8d6e63', jeju: '#26a69a', reversal: '#d4a017' };
/** Stage 6 tile glyphs before board.json knows the type (meta icon wins). Loop maps: 💵 월급날, 🎪 찬스 광장. */
const DEFAULT_TILE_GLYPH = { start: '🚩', habit: '📚', salary: '💵', pass: '🎪', job: '💼', card: '🃏', shop: '🛍️', hometown: '🏡', temple: '🛕', jeju: '🌴', reversal: '🎰', treasure: '💎' };
/** Ribbon text drawn under the icon of these tile types (atlas). */
const RIBBON = { salary: '월급날', pass: '찬스 광장' };
/** Loop maps: tiles that stand out (bigger tile + marker): forced-stop paydays, pass tiles, the fork. */
const BIG_TILE = { salary: 1.2, pass: 1.14, stop: 1.12, start: 1.1, goal: 1.3 };
/** Stage 9 board reactions: submap arrival / outcome, treasure find. */
const SUBMAP_POP = { hometown: '🏡', temple: '🛕', jeju: '🌴', reversal: '🎰', casino: '🎰' };
/** Stage 6 board reactions over the pawn (the cut-in follows). */
const STAGE6_POP = { jobChanged: '💼', rankUp: '⭐', hiddenJobUnlocked: '🌟', injured: '🤕', militaryStart: '🪖', militaryEnd: '🎖️', educationChanged: '🎓' };
const STAT_FLOAT = { int: ['🧠', '#2446a8'], str: ['💪', '#a33a14'], charm: ['✨', '#a3276a'], luck: ['🍀', '#1d6b3b'] };

/** Stage 7 board reactions over the pawn (sabotage / block pop over the target). */
const STAGE7_POP = { cardGained: '🃏', itemBought: '🛍️', gift: '🎁', lottoDraw: '🎱' };
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
  scene.add(new THREE.HemisphereLight(0xf4fbff, 0x7f9a60, 2.1));
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.5);
  sun.position.set(-12, 30, 18);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 260);

  const vcMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const tileMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const tweens = createTweens();
  const roulette = createRoulette3D();
  const emotionThrottle = createThrottle(900);

  // ---------- state ----------
  const S = {
    board: null,
    boardKey: null,
    layout: null,
    eraIndex: 0, // the era whose loop is built
    wantEra: null, // the state's era (switched when the eraTransition animation plays, else once idle)
    staticGroup: null,
    labels: { routes: {}, eras: [] },
    pawns: new Map(), // charId → { pawn, tileId, moving, order, target: Vector3, finished }
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

  // camera rig (orbit state mutated by controls)
  const defaultOrbit = () => {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    const portrait = w < h * 0.9;
    return { azimuth: portrait ? -1.15 : -0.3, polar: portrait ? 0.9 : 0.95, radius: portrait ? 19 : 17, panX: 0, panZ: 0 };
  };
  const orbit = defaultOrbit();
  const rig = {
    target: new THREE.Vector3(),
    goal: new THREE.Vector3(),
    follow: null, // charId
    focus: null, // Vector3 (era focus)
    sweep: null, // { poly, acc, t, sec, resolve, radius }
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

  function disposeStatic() {
    if (!S.staticGroup) return;
    S.staticGroup.traverse((o) => {
      if (o.isSprite) return disposeSprite(o);
      o.geometry?.dispose();
      if (o.material && o.material !== vcMat && o.material !== tileMat) {
        o.material.map?.dispose();
        o.material.dispose();
      }
    });
    S.staticGroup.removeFromParent();
    S.staticGroup = null;
    S.labels = { routes: {}, eras: [] };
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
    const typeOf = new Map(entries.map((e) => [e.key, e.type]));
    keys.forEach((k, i) => draw(i, k, typeOf.get(k)));
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
          const type = typeOf.get(k);
          const tile = k === '📝' ? 'school' : ICON_ASSET_TILE[type];
          const a = tile ? findAsset({ kind: 'icon', tile }) : null;
          if (!a?.url) return;
          const img = new Image();
          img.onload = () => {
            if (S.disposed) return;
            draw(i, k, type, img);
            texture.needsUpdate = true;
          };
          img.src = a.url;
        });
      })
      .catch(() => {});
    return { texture, cellOf };
  }

  function buildStatic() {
    const L = S.layout;
    const g = new THREE.Group();
    const props = planProps(L, { density: preset.props, seed: 11 + S.eraIndex });
    const pb = boundsOf([...Object.values(L.tiles), ...props], 0);
    const eraId = L.era.id;

    // ground: one tinted plane under this era's town (vertex colours → the grass texture only shifts the hue)
    const margin = 46;
    const W = pb.maxX - pb.minX + margin * 2;
    const D = pb.maxZ - pb.minZ + margin * 2;
    const ground = new THREE.PlaneGeometry(W, D, 1, 1);
    ground.rotateX(-Math.PI / 2);
    ground.translate((pb.minX + pb.maxX) / 2, 0, (pb.minZ + pb.maxZ) / 2);
    const gp = ground.attributes.position;
    const gc = new Float32Array(gp.count * 3);
    const tmp = new THREE.Color(themeFor(eraId).ground);
    for (let i = 0; i < gp.count; i++) gc.set([tmp.r, tmp.g, tmp.b], i * 3);
    ground.setAttribute('color', new THREE.BufferAttribute(gc, 3));
    const groundMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const white3 = new THREE.Color(1, 1, 1);
    const groundMesh = new THREE.Mesh(ground, groundMat);
    g.add(groundMesh);
    loadAssetIndex()
      .then(() => {
        const a = findAsset({ kind: 'texture', surface: 'grass' });
        if (!a?.url || S.disposed || S.staticGroup !== g) return;
        const img = new Image();
        img.onload = () => {
          if (S.disposed || S.staticGroup !== g) return;
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
          tex.repeat.set(W / 9, D / 9);
          const col = ground.attributes.color;
          for (let i = 0; i < col.count; i++) {
            tmp.setRGB(col.getX(i), col.getY(i), col.getZ(i)).lerp(white3, 0.55);
            col.setXYZ(i, tmp.r, tmp.g, tmp.b);
          }
          col.needsUpdate = true;
          groundMat.map = tex;
          groundMat.needsUpdate = true;
        };
        img.src = a.url;
      })
      .catch(() => {});

    // roads: the closed ring (curb + sand) and the route ribbons — one merged mesh
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
    g.add(new THREE.Mesh(mergeColored(roadParts), vcMat));

    // tiles: instanced base + coloured top (paydays / pass tiles / the fork a bit bigger)
    const list = Object.values(L.tiles);
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
      g.add(m);
    }

    // markers (one merged mesh): 💵 payday = gold coin ring + sign post, 🎪 pass tile = a little striped tent
    const flat = [...(S.board.eras[S.eraIndex]?.tiles ?? []), ...Object.values(S.board.eras[S.eraIndex]?.routes ?? {}).flatMap((r) => r.tiles)];
    const marks = [];
    for (const t of flat) {
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
      } else if (t.type === 'start') {
        marks.push(colored(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 5), '#6b6f76', mat4(lt.x - nx * 1.2, 0.8, lt.z - nz * 1.2)));
        marks.push(colored(new THREE.BoxGeometry(0.6, 0.38, 0.04), '#e2504c', mat4(lt.x - nx * 1.2 + 0.3, 1.4, lt.z - nz * 1.2)));
      }
    }
    if (marks.length) g.add(new THREE.Mesh(mergeColored(marks), vcMat));

    // icons: one merged quad mesh on an atlas
    const entries = flat.map((t) => ({ id: t.id, key: iconKey(t), type: t.type }));
    const atlas = buildAtlas(entries);
    const pos = [];
    const uv = [];
    for (const e of entries) {
      const t = L.tiles[e.id];
      if (!t) continue;
      const Q = 0.58 * (BIG_TILE[e.type] ?? 1);
      const [u0, v0, u1, v1] = atlas.cellOf(e.key);
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
    g.add(new THREE.Mesh(iconGeo, new THREE.MeshBasicMaterial({ map: atlas.texture, transparent: true, depthWrite: false })));

    // props
    g.add(buildProps(props, vcMat));

    // labels: era sign at the start, fork / rejoin, paydays, route names
    const st = L.tiles[L.startId];
    if (st) {
      const th = themeFor(eraId);
      const sp = makeTextSprite(`${th.sign} ${L.era.name} 시대 · ${L.closed === false ? '🏁 골인 경쟁' : '🚩 출발'}`, { height: 0.8, size: 44, color: '#ffffff', bg: 'rgba(45,42,50,0.88)', pad: 18, renderOrder: 14 });
      sp.position.set(st.x, 3.4, st.z);
      g.add(sp);
      S.labels.eras.push(sp);
    }
    for (const t of flat) {
      if (!['stop', 'merge', 'salary', 'goal'].includes(t.type)) continue;
      const lt = L.tiles[t.id];
      if (!lt) continue;
      const kind = t.type;
      const text = kind === 'salary' ? `💵 ${t.label || '월급날'}` : `${t.icon ?? ''} ${t.label}`.trim();
      const sp = makeTextSprite(text, {
        height: kind === 'merge' ? 0.42 : kind === 'salary' ? 0.46 : kind === 'goal' ? 0.7 : 0.52,
        size: 40,
        color: '#ffffff',
        bg: kind === 'salary' ? 'rgba(47,158,87,0.95)' : kind === 'merge' ? 'rgba(141,153,174,0.95)' : kind === 'goal' ? 'rgba(45,42,50,0.92)' : 'rgba(226,80,76,0.95)',
        pad: 14,
        renderOrder: 13,
      });
      sp.position.set(lt.x, kind === 'merge' ? 1.4 : kind === 'salary' ? 1.9 : kind === 'goal' ? 2.9 : 2.1, lt.z);
      g.add(sp);
    }
    for (const key of ROUTE_ORDER) {
      const r = L.era.routes?.[key];
      if (!r) continue;
      const info = routeInfo(key);
      const sp = makeTextSprite(`${info.icon} ${info.name}`, { height: 0.8, size: 42, color: '#ffffff', bg: ROUTE_COLORS[key], pad: 16, renderOrder: 13, border: '#ffffff' });
      sp.position.set(r.label.x, 2.3, r.label.z);
      g.add(sp);
      (S.labels.routes[S.eraIndex] ??= {})[key] = sp;
    }
    scene.add(g);
    S.staticGroup = g;
  }

  /** (Re)build the static board for era `i` of S.board; every pawn stands on the start tile. */
  function buildEra(i) {
    disposeStatic();
    const n = S.board?.eras?.length ?? 1;
    S.eraIndex = clamp(Number.isInteger(i) ? i : 0, 0, Math.max(0, n - 1));
    S.wantEra = null;
    S.layout = layoutBoard(S.board, { eraIndex: S.eraIndex });
    buildStatic();
    mascotState.era = null;
    for (const P of S.pawns.values()) {
      P.moving = false;
      placeAt(P, S.layout.startId, true);
    }
    const st = S.layout.tiles[S.layout.startId] ?? { x: 0, z: 0 };
    rig.target.set(st.x, 0, st.z);
  }

  /** Era transition: fade out → rebuild for the new era → fade in → camera tour of the new loop. */
  async function switchEra(i, { animate = true } = {}) {
    const fade = animate && !document.hidden;
    if (fade) {
      elFade.classList.add('on');
      await new Promise((r) => setTimeout(r, 380));
    }
    if (S.disposed) return;
    buildEra(i);
    reconcile();
    if (!fade) return;
    elFade.classList.remove('on');
    if (preset.fixedCamera) return new Promise((r) => setTimeout(r, 900));
    await sweep(eraSweepPoints(S.layout), 2.6, clamp(fitRadius(S.layout.era.bounds) * 0.62, 18, 46));
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
  function fitRadius(bounds) {
    const w = bounds.maxX - bounds.minX;
    const d = bounds.maxZ - bounds.minZ;
    const aspect = camera.aspect || 1.6;
    const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const needW = w / 2 / (half * aspect);
    const needD = (d * 1.2) / 2 / half;
    return clamp(Math.max(needW, needD) * 1.05, 12, 90);
  }

  /** Loop maps: every character is in the shown era. */
  const eraBounds = () => S.layout?.era?.bounds ?? { minX: -10, maxX: 10, minZ: -6, maxZ: 6 };

  function followChar(charId) {
    rig.follow = charId;
    rig.focus = null;
  }

  function autoRadius() {
    if (preset.fixedCamera) return Math.max(24, fitRadius(eraBounds()));
    if (rig.focus) return rig.focusRadius ?? 24;
    const base = defaultOrbit().radius;
    return S.mine ? base : base * 0.68; // spectator spotlight: close-up on the current pawn
  }

  function updateCamera(dt) {
    let desired;
    if (rig.sweep) {
      const sw = rig.sweep;
      sw.t += dt;
      const k = easeInOutCubic(Math.min(1, sw.t / sw.sec));
      const p = pointAt(sw.poly, k * sw.acc.at(-1), sw.acc);
      desired = rig.goal.set(p.x, 0, p.z);
      rig.target.lerp(desired, 1 - Math.exp(-dt * 9));
      orbit.radius = lerp(orbit.radius, sw.radius, 1 - Math.exp(-dt * 3));
      if (sw.t >= sw.sec) {
        rig.sweep = null;
        sw.resolve();
      }
    } else {
      if (preset.fixedCamera) {
        const e = S.layout?.era;
        desired = e ? rig.goal.set(e.center.x, 0, e.center.z) : rig.goal.set(0, 0, 0);
      } else if (rig.focus) {
        desired = rig.goal.copy(rig.focus);
      } else if (rig.follow && S.pawns.get(rig.follow)) {
        desired = rig.goal.copy(S.pawns.get(rig.follow).pawn.group.position);
        desired.y = 0;
      } else {
        desired = rig.goal.copy(rig.target);
      }
      desired.x += orbit.panX;
      desired.z += orbit.panZ;
      rig.target.lerp(desired, 1 - Math.exp(-dt * 4.5));
      if (!rig.userZoom || preset.fixedCamera) orbit.radius = lerp(orbit.radius, autoRadius(), 1 - Math.exp(-dt * 2.5));
    }
    const az = preset.fixedCamera ? 0 : orbit.azimuth;
    const pol = preset.fixedCamera ? 0.62 : orbit.polar;
    const r = orbit.radius;
    camera.position.set(rig.target.x + Math.sin(az) * Math.sin(pol) * r, rig.target.y + Math.cos(pol) * r, rig.target.z + Math.cos(az) * Math.sin(pol) * r);
    camera.lookAt(rig.target.x, rig.target.y + 0.6, rig.target.z);
  }

  /** Camera flies along world points [{x,z}] over `sec` seconds, then resumes following. */
  function sweep(points, sec, radius) {
    if (!points.length) return Promise.resolve();
    rig.sweep?.resolve();
    const poly = points.length > 1 ? catmullRom(points.map((p) => ({ x: p.x, z: p.z })), 10) : [points[0], points[0]];
    return new Promise((resolve) => {
      rig.sweep = { poly, acc: arcLengths(poly), t: 0, sec, radius, resolve };
      setTimeout(() => {
        if (rig.sweep?.resolve === resolve) {
          rig.sweep = null;
          resolve();
        }
      }, sec * 1000 + 800);
    });
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
      if (rig.focus) rig.follow = id; // user is browsing an era (tabs) → keep that view
      else followChar(id);
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
    for (const id of path) {
      a.copy(P.pawn.group.position);
      tileWorld(id, b);
      P.yaw = Math.atan2(b.x - a.x, b.z - a.z);
      await tweens.add(hopSec, (k) => {
        P.pawn.group.position.lerpVectors(a, b, k);
        P.pawn.holder.position.y = hopHeight(k, 0.75);
        const sq = k > 0.85 ? 1 - (k - 0.85) * 1.2 : 1;
        P.pawn.holder.scale.set(0.82 / Math.sqrt(sq), 0.82 * sq, 0.82 / Math.sqrt(sq));
      });
      P.tileId = id;
      if (id === startId && path.length > 1) emotion.pop(e.charId, '🔁', { dur: 1.1 }); // wrapped past the start
    }
    P.pawn.holder.scale.setScalar(0.82);
    P.pawn.holder.position.y = 0;
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
      banner(e.halted === 'salary' ? (e.rush ? '💨 월급날 직행! 도착' : '💵 월급날! 여기서 멈춰요') : e.halted === 'pass' ? '🎪 찬스 광장! 잠깐 멈춤' : '🔀 인생 갈림길!', 1500);
      await ctx.sleep(e.halted === 'pass' ? 450 : 300);
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
      const pts = [fork, r?.label, rejoin].filter(Boolean);
      await sweep(pts, 1.8, clamp(fitRadius(L.era.bounds) * 0.4, 16, 30));
      followChar(e.charId);
    },
    finished: async (e, ctx) => {
      hooks.onStep?.(e);
      const name = S.chars.find((c) => c.id === e.charId)?.name ?? '';
      // final era (노년 골인 경쟁): goal order is back; 빈곤 농장 / 조기 은퇴 finish without the goal
      banner(e.retired === 'early' ? `🏖️ ${name} 조기 은퇴!` : e.retired === 'bust' ? `🌾 ${name} 빈곤 농장행…` : `🏁 ${name} ${e.place}등 골인!`, 2000);
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
      emotion.float(e.charId, `${icon}${e.delta > 0 ? '+' : ''}${e.delta}`, e.delta > 0 ? color : '#d6453f');
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
      if (ctx.instant || !e.charId) return;
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
          if (type === 'lottoDraw') {
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
    // pick the default view for the orientation (path runs up the screen on portrait phones)
    const portrait = w < h * 0.9;
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
        const bob = id === S.shownCurrent && !animator.busy() ? Math.abs(Math.sin(t * 3.2)) * 0.14 : 0;
        P.pawn.holder.position.y = lerp(P.pawn.holder.position.y, bob, 0.3);
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

    const size = renderer.getSize(bufSize);
    renderer.info.reset();
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, size.x, size.y);
    renderer.clear();
    renderer.render(scene, camera);
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
     * @param {string|{key?: string, eraIndex?: number}} opts  (a string = the old `key` argument)
     */
    setBoard(board, opts = {}) {
      const o = typeof opts === 'string' ? { key: opts } : opts ?? {};
      const k = o.key ?? JSON.stringify(board.eras.map((e) => [e.id, e.tiles.map((t) => t.type), Object.values(e.routes ?? {}).map((r) => r.tiles.map((t) => t.type))]));
      const era = Number.isInteger(o.eraIndex) ? o.eraIndex : 0;
      if (k !== S.boardKey) {
        S.boardKey = k;
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
          const pawn = createPawn({ avatar: c.avatar, defs: meta?.avatars, name: tagName(c), isMe: !!c.isMe });
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

    /** Look at the whole shown era (loop maps: other eras aren't built). The next turn / reset returns to following. */
    focusEra(eraIndex = S.eraIndex) {
      const e = eraIndex === S.eraIndex ? S.layout?.era : null;
      if (!e) return;
      rig.follow = null;
      rig.focus = new THREE.Vector3(e.center.x, 0, e.center.z);
      rig.focusRadius = clamp(fitRadius(e.bounds) * 0.8, 14, 60);
      rig.userZoom = false;
      orbit.panX = orbit.panZ = 0;
    },

    resetCamera() {
      Object.assign(orbit, defaultOrbit());
      rig.userZoom = false;
      rig.userPan = false;
      rig.userRotate = false;
      rig.focus = null;
      followChar(S.shownCurrent ?? S.current);
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
        const board = S.board;
        const shown = new Map([...S.pawns].map(([id, P]) => [id, P.tileId]));
        const want = S.wantEra;
        S.board = board;
        buildEra(S.eraIndex);
        S.wantEra = want;
        for (const [id, P] of S.pawns) placeAt(P, shown.get(id), true);
      }
    },

    /** renderer.info of the last frame + fps. */
    stats() {
      return { ...S.stats, fps: Math.round(S.fps * 10) / 10, quality: preset.name, popups: emotion.count, bursts: particles.count, busy: animator.busy(),
        mascots: { visible: mascots.group.visible, triangles: mascots.triangles, x: mascots.group.position.x, z: mascots.group.position.z },
        buffer: { width: canvas.width, height: canvas.height }, css: { width: canvas.clientWidth, height: canvas.clientHeight }, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, frames: S.frames };
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
      disposeStatic();
      roulette.dispose();
      mascots.dispose();
      renderer.dispose();
      overlay.remove();
    },
  };
  return api;
}
