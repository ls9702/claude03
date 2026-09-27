// Game screen UI. Renders the masked room view from the server: HUD, character panel, log, side bets,
// decision modals, and the board — the Three.js 3D board (Stage 4, scene/board3d.js) when WebGL works
// and the user hasn't chosen 2D, else the 2D simple track (Stage 2). Engine events (SSE `events`) go to
// the 3D animator (which calls back into `feedback` at the right moment) or straight to 2D feedback.
// Stage 5: cut-in-worthy events (`cutin: true`) open the 2D cut-in (ui/cutin2d.js) after the board's own
// animation (3D: animator paused meanwhile), prompts use the cut-in dialogue box, sounds via audio.js.
import { renderAvatar, preloadAvatarLayers, portraitHtml, hydratePortraits } from './ui/avatar2d.js';
import { createCutin } from './ui/cutin2d.js';
import { createBanner } from './ui/banner.js';
import { planCutins } from './ui/cutinMap.js';
import {
  CUTIN_MODES,
  CUTIN_MODE_LABEL,
  PROMPT_BOARD_WAIT_MS,
  betPicks,
  classifyGroup,
  mergeGroups,
  myPendingChars,
  normalizeCutinMode,
  routeOptionInfo,
} from './ui/cutinPolicy.js';
import { clockOffset } from './api.js';
import {
  CARD_KINDS,
  TRADE_STATUS,
  cardDefs,
  cardInfo,
  cardPlayability,
  handOf,
  itemInfo,
  itemsOf,
  sabotageTargets,
  spinModBadges,
  tradeLists,
  tradeSideText,
  validateGift,
  validateTrade,
  holidayTitle,
  handFull,
  spinNote,
} from './shared/cards.js';
import { HOLIDAY_OPTION_ICON, cardHtml, itemIconHtml, shopOptionsHtml } from './ui/cardArt.js';
import { familyIcons, familySummary, familyTagBadge, houseInfo, houseOf, marketInfo } from './shared/family.js';
import { houseArtHtml, houseOptionsHtml } from './ui/houseArt.js';
import { familyDetailHtml, familyOptionsHtml } from './ui/familyArt.js';
import { createMcCorner } from './ui/mc.js';
import { SUBMAP_TILE_TYPES, submapInfo, submapOf, submapSuccess, treasureCount, treasureInfo, treasuresOf } from './shared/submaps.js';
import { submapOptionsHtml, treasureListHtml } from './ui/submapArt.js';
import { createResultScreen } from './ui/resultShow.js';
import { audio } from './audio.js';
import { loadAssetIndex, findAsset, assetUrl } from './assets.js';
import { won, esc, secondsLeft, ownerHtml } from './format.js';
import { pickQuality, QUALITY_PRESETS, shouldFallback } from './scene/quality.js';
import {
  STAT_INFO,
  characterEra,
  displayCharacters,
  educationLabel,
  jobBadge,
  jobInfo,
  militaryLabel,
  optionExtras,
  optionLabel,
  rankStars,
  statCap,
  statRows,
} from './shared/growth.js';

export { won };

const MODE_KEY = 'jinsei.boardMode'; // '2d' | '3d' (explicit choice); absent = auto
const QUALITY_KEY = 'jinsei.quality';
const CUTIN_KEY = 'jinsei.cutins'; // legacy 'off' (→ spectator mode off); `?cutins=off` = every cut-in off
const SPECTATOR_KEY = 'jinsei.spectatorCutins'; // 「관전 컷인」 full | compact | off (default compact)
/** Stage 6 cut-in anchors (3D: shown after their board step). */
const STAGE6_CUTIN_TYPES = ['jobChanged', 'rankUp', 'hiddenJobUnlocked', 'injured', 'newsFlash', 'militaryStart', 'militaryEnd', 'educationChanged'];
/** Stage 7 cut-in anchors / lone banner events (3D: shown after their board step). */
const STAGE7_CUTIN_TYPES = ['cardUsed', 'cardBlocked', 'itemBought', 'holidayStarted', 'holidayResult', 'lottoDraw', 'cardGained', 'gift', 'tradeResolved'];
/** Stage 8 cut-in anchors (3D: shown after their board step). */
const STAGE8_CUTIN_TYPES = ['met', 'dated', 'proposed', 'married', 'schoolMeet', 'childBorn', 'childGrew', 'houseBought', 'houseValueChanged'];
/** Stage 9 cut-in anchors (3D: shown after their board step). */
const STAGE9_CUTIN_TYPES = ['submapResult', 'treasureFound'];
const CUTIN_TYPES = ['landed', 'eraChanged', 'routeChosen', 'finished', 'promptResolved', ...STAGE6_CUTIN_TYPES, ...STAGE7_CUTIN_TYPES, ...STAGE8_CUTIN_TYPES, ...STAGE9_CUTIN_TYPES];
/** Animated event types that may carry MC lines shown in the board corner (Stage 5.6). */
const MC_CORNER_TYPES = ['turnStarted', 'landed', 'moneyChanged', 'betResolved', 'promptResolved', 'routeChosen', 'finished', 'eraChanged', 'gameOver', ...STAGE6_CUTIN_TYPES, 'salary', 'statChanged', ...STAGE7_CUTIN_TYPES, ...STAGE8_CUTIN_TYPES, 'allowance', 'houseSold', ...STAGE9_CUTIN_TYPES, 'submapEntered'];
/** Stage 6 tile types the server may send before board.json knows them (meta wins). */
const CLIENT_TILE_TYPES = {
  habit: { name: '습관', icon: '📚', color: '#20a39e' },
  salary: { name: '월급', icon: '💵', color: '#3fae5a' },
  job: { name: '직업', icon: '💼', color: '#4f8ee0' },
  card: { name: '카드', icon: '🃏', color: '#9a6ad6' },
  shop: { name: '상점', icon: '🛍️', color: '#f39a3d' },
  ...SUBMAP_TILE_TYPES, // Stage 9: 고향 · 산사 · 제주도 · 인생역전 · 보물
};
const FALLBACK_KEY = 'jinsei.board3dFallback'; // sessionStorage: auto-fallback happened this session
const FPS_MIN = 15;
const FPS_PROBE_MS = 3000;

function store(kind) {
  try {
    return kind === 'session' ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}
function sGet(key, kind = 'local') {
  try {
    return store(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function sSet(key, value, kind = 'local') {
  try {
    if (value == null) store(kind)?.removeItem(key);
    else store(kind)?.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

function modeParamCutin(params) {
  const v = params.get('cutins');
  return v === 'off' ? 'off' : v === 'on' ? 'on' : null;
}

/** Cheap WebGL capability probe (the real renderer may still fail → fallback). */
function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

const EMOTION = { joy: '😆', cry: '😭', angry: '😡', sweat: '😅', love: '😍', shock: '😱' };
const MAX_TILE_PAWNS = 4;
const FINISH_BOARD_MS = 4000; // 3D at game over: the board may animate this long before the result screen
const TURN_GRACE_MS = 700; // new turn → spin/bet controls wait for the previous turn's events (cut-ins) // 2D tile: more pawns overlap + "+N"

function tileIdAt(board, pos) {
  if (!pos || pos.index < 0) return 'start';
  const era = board.eras[pos.eraIndex];
  const track = pos.route === 'main' ? era?.tiles : era?.routes?.[pos.route]?.tiles;
  return track?.[pos.index]?.id ?? 'start';
}

/**
 * @param {HTMLElement} root  container inside #screen-game
 * @param {{ getMeta: () => object, act: (body) => Promise<void>, toast: (msg, kind?) => void,
 *           resync?: () => Promise<object|null> }} deps  `resync` = fetch + apply the latest room (stale actions)
 */
export function createGameUI(root, { getMeta, act, toast, resync = null }) {
  root.innerHTML = `
    <div class="g-top card">
      <div class="g-era-line"><span class="era-chip" data-el="era"></span><span class="muted small" data-el="turninfo"></span>
        <button type="button" class="news-badge" data-el="news" hidden aria-expanded="false"></button></div>
      <div class="news-pop" data-el="newspop" hidden role="note"></div>
      <div class="g-now" data-el="now"></div>
    </div>
    <div class="g-layout">
      <div class="g-main">
        <div class="card g-board">
          <div class="board-head">
            <div class="era-tabs" data-el="tabs" role="tablist" aria-label="시대"></div>
            <div class="board-tools">
              <button type="button" class="btn tiny ghost" data-el="camreset" hidden title="카메라를 현재 캐릭터로 되돌려요">🎥 카메라 리셋</button>
              <select class="quality-select" data-el="quality" hidden aria-label="그래픽 품질">${Object.values(QUALITY_PRESETS)
                .map((q) => `<option value="${q.name}">${q.label}</option>`)
                .join('')}</select>
              <button type="button" class="btn tiny" data-el="modebtn" aria-pressed="false">2D 보기</button>
              <select class="quality-select cutin-select" data-el="cutinmode" aria-label="관전 컷인" title="다른 사람 이벤트의 컷인 연출 (내 이벤트는 항상 전체)">${CUTIN_MODES.map(
                (m) => `<option value="${m}">🎬 관전 컷인: ${CUTIN_MODE_LABEL[m]}</option>`,
              ).join('')}</select>
              <button type="button" class="btn tiny ghost tool-toggle" data-el="bgmbtn" aria-pressed="true" title="배경음악 켜기/끄기">🎵 BGM</button>
              <button type="button" class="btn tiny ghost tool-toggle" data-el="soundbtn" aria-pressed="false" aria-label="소리 켜기/끄기">🔊</button>
            </div>
          </div>
          <div class="news-flash" data-el="newsflash" hidden aria-live="polite"></div>
          <div class="board3d" data-el="wrap3d" hidden><canvas class="board3d-canvas" data-el="canvas3d" aria-label="3D 말판"></canvas></div>
          <div class="track-scroll" data-el="scroll"><div class="track" data-el="track"></div></div>
        </div>
        <div class="card g-action spin-dock" data-el="dock">
          <div class="hand" data-el="hand" hidden></div>
          <div class="spin-box">
            <div class="spin-dial" data-el="dial" aria-live="polite">?</div>
            <div class="spin-ctl">
              <button type="button" class="btn primary spin-btn" data-el="spin">🎡 룰렛 돌리기</button>
              <p class="spin-hint" data-el="hint"></p>
            </div>
          </div>
        </div>
        <div class="card g-bet bet-panel" data-el="bet" hidden></div>
      </div>
      <div class="g-side">
        <div class="card"><h3>캐릭터</h3><ul class="g-chars" data-el="chars"></ul></div>
        <div class="card"><h3>이벤트 로그</h3><ul class="g-log" data-el="log"></ul></div>
      </div>
    </div>
    <div class="g-modal" data-el="modal" hidden role="dialog" aria-modal="true"></div>
    <div class="g-modal card-sheet-wrap" data-el="cardsheet" hidden role="dialog" aria-modal="true" aria-label="카드"></div>
    <div class="g-modal trade-wrap" data-el="tradedlg" hidden role="dialog" aria-modal="true" aria-label="거래·선물"></div>
    <div class="trade-inbox" data-el="inbox" hidden aria-live="polite"></div>
    <div class="roulette-pop" data-el="pop" hidden></div>`;

  const el = Object.fromEntries([...root.querySelectorAll('[data-el]')].map((n) => [n.dataset.el, n]));
  const params = new URLSearchParams(location.search);
  const modeParam = params.get('board');
  // debug-only knob for testing the automatic 2D fallback (e.g. ?debug=1&fpsMin=1000)
  const fpsMin = params.has('debug') && Number(params.get('fpsMin')) > 0 ? Number(params.get('fpsMin')) : FPS_MIN;
  const ui = {
    room: null,
    pref: modeParam === '2d' || modeParam === '3d' ? modeParam : sGet(MODE_KEY), // explicit 2d/3d or null (auto)
    quality: pickQuality({
      param: params.get('quality'),
      stored: sGet(QUALITY_KEY),
      isMobile: window.matchMedia?.('(pointer: coarse)').matches,
      cores: navigator.hardwareConcurrency,
      memory: navigator.deviceMemory,
    }),
    b3: null, // 3D board instance
    b3Loading: null,
    b3Failed: false,
    lastVersion: null,
    lastStateAt: 0,
    modalTimer: null,
    lastFocusEra: null,
    viewEra: null, // era index being shown; null = follow the current character
    followKey: null,
    busy: false,
    modalKey: null,
    bet: { bettor: null, pick: 'odd', amount: null },
    lastScrollKey: null,
    globalOff: modeParamCutin(params) === 'off', // ?cutins=off: board only (toasts + decision modal)
    // 「관전 컷인」: other players' events → full / compact banners / off (my own events are always full)
    cutinMode: normalizeCutinMode(params.get('spectatorCutins') ?? sGet(SPECTATOR_KEY) ?? (sGet(CUTIN_KEY) === 'off' ? 'off' : null)),
    gameOver: false,
    promptSeen: { id: null, at: 0, bannered: null },
    cutinGroups: new WeakMap(), // engine event (animator step) → cut-in group
    mcCornerEvents: new WeakSet(), // 3D: events whose MC lines go to the corner when the animator plays them
    promptTimer: null,
    assetsReady: false,
    preloaded: new Set(),
    gameOverLine: null,
    openChar: null, // Stage 6: character detail card open in the side list
    newsSeen: {}, // Stage 6: eraId → {title, text, tone} from newsFlash events (before meta.news knows it)
    newsOpen: false,
    // Stage 7
    handFor: null, // my character whose hand the dock shows (default: current if mine, else first)
    cardSheet: null, // {charId, uid, targetId}
    trade: null, // trade / gift dialog state
    inboxKey: '',
    deferred: [], // lotto / holiday results that arrived while my prompt was open
  };

  // ---------- Stage 5: cut-ins + sound ----------
  const cutin = createCutin(document.body, { getMeta, assets: { findAsset, assetUrl }, audio, now: () => Date.now() + clockOffset() });
  const banner = createBanner(document.body, { getMeta });
  audio.install();
  audio.setSfxMap(getMeta()?.presentation?.sfx);
  loadAssetIndex().then(() => {
    ui.assetsReady = true;
    if (ui.room?.status === 'playing') render(ui.room);
  });
  cutin.onIdle(() => ui.room?.status === 'playing' && render(ui.room));
  // Stage 5.6 MCs: lines outside cut-ins go to a small booth in the board corner (after cut-ins close)
  const mcCorner = createMcCorner(document.body, {
    whenFree: () => cutin.whenIdle(),
    onLine: (l) => audio.play('bark', { mc: l.speaker, force: true }),
  });
  /** Room setting 「MC 등장 빈도」 (off hides the MCs everywhere). */
  const mcOn = () => (ui.room?.config?.mcFrequency ?? 'normal') !== 'off';
  if (params.has('debug')) window.__mcCorner = mcCorner;
  if (params.has('debug')) window.__cutin = cutin;
  if (params.has('debug')) window.__banner = banner;
  audio.onChange(() => applySoundUi());
  /** Cut-ins at all (`?cutins=off` = board only). Other players' events also follow `ui.cutinMode`. */
  const cutinsOn = () => !ui.globalOff;
  const myIds = () => new Set(chars().filter((c) => c.isMe).map((c) => c.id));
  const isSpectator = () => ui.room?.me?.role === 'spectator';
  /** A prompt waits for one of my characters → it pre-empts every event cut-in. */
  const promptForMe = () => ui.room?.status === 'playing' && myPendingChars(ui.room?.turn?.pending, chars()).length > 0;
  const hasCutinArt = () => !!(findAsset({ kind: 'frame' }) || findAsset({ kind: 'bg' }));
  /** Prompts use the cut-in dialogue box in 3D, or in 2D once generated art exists; else the modal. */
  const promptCutins = () => cutinsOn() && (!!ui.b3 || hasCutinArt());
  const orderedChars = () => (ui.room?.turn?.order ?? []).map((id) => byId(id)).filter(Boolean);
  /**
   * Cut-in characters. Stage 6: a job-change cut-in shows the character in the costume of the event's job (the
   * state may already be further on); everyone else wears their current effective look.
   */
  const cutinOpts = (g = null) => {
    const a = g?.anchor;
    if (a?.type === 'jobChanged' && a.charId && a.jobId && ui.rawRoom) {
      const overrides = { [a.charId]: { job: { id: a.jobId, rank: a.rank ?? 1 } } };
      const list = displayCharacters(ui.rawRoom, { avatars: getMeta()?.avatars, jobs: getMeta()?.jobs, overrides });
      const m = new Map(list.map((c) => [c.id, c]));
      return { characters: (ui.room?.turn?.order ?? []).map((id) => m.get(id)).filter(Boolean), room: ui.room };
    }
    return { characters: orderedChars(), room: ui.room };
  };
  /** Stage 6 growth outfits: the room as drawn (characters' `avatar` = era / job costume, `chosenAvatar` = own look). */
  function displayRoom(room) {
    if (!Array.isArray(room?.characters)) return room;
    const meta = getMeta();
    const raw = rawOf.get(room) ?? room;
    const characters = displayCharacters(raw, { avatars: meta?.avatars, jobs: meta?.jobs });
    if (characters.every((c, i) => c === raw.characters[i])) return raw;
    const out = { ...raw, characters };
    rawOf.set(out, raw);
    return out;
  }
  const rawOf = new WeakMap(); // display room → server room
  const tileTypeMeta = (type) => getMeta()?.board?.tileTypes?.[type] ?? CLIENT_TILE_TYPES[type] ?? {};

  function applySoundUi() {
    const st = audio.state;
    el.soundbtn.textContent = st.muted ? '🔇' : '🔊';
    el.soundbtn.setAttribute('aria-pressed', String(st.muted));
    el.soundbtn.title = st.muted ? '소리 켜기' : '소리 끄기';
    el.bgmbtn.setAttribute('aria-pressed', String(st.bgm));
    el.bgmbtn.classList.toggle('off', !st.bgm);
    el.cutinmode.value = ui.cutinMode;
    el.cutinmode.disabled = !cutinsOn();
  }
  queueMicrotask(applySoundUi);

  /** Warm the compositor caches in the background: neutral + blink for everyone, common expressions after. */
  function preloadLayers() {
    if (!ui.assetsReady || !cutinsOn()) return;
    // the key includes the effective outfit (Stage 6 growth outfits): an era / job change warms the new look
    const pk = (c) => `${c.id}|${c.art?.status ?? ''}|${c.avatar?.outfit ?? ''}`;
    const todo = chars().filter((c) => !ui.preloaded.has(pk(c)));
    if (!todo.length) return;
    for (const c of todo) ui.preloaded.add(pk(c));
    const jobs = [
      ...todo.map((c) => [c, []]),
      ...todo.slice(0, 4).map((c) => [c, ['joy', 'cry']]), // the rest compose on demand (LRU-capped cache)
    ];
    let i = 0;
    const next = () => {
      const job = jobs[i++];
      if (!job) return;
      preloadAvatarLayers(job[0], { expressions: job[1] }).finally(() => setTimeout(next, 60));
    };
    setTimeout(next, 200);
  }

  /**
   * Present one cut-in group by policy (cutinPolicy.classifyGroup): full cut-in (my events, big events, 「전체」),
   * compact banner (other players' minor events, anything while my prompt waits) or nothing.
   * @returns {Promise} resolves when a full cut-in closes (right away for banners / skips)
   */
  function presentGroup(g) {
    const kind = classifyGroup(g, {
      mine: myIds(),
      mode: ui.cutinMode,
      promptForMe: promptForMe(),
      gameOver: ui.gameOver,
      queued: cutin.size(),
      globalOff: !cutinsOn(),
    });
    if (kind === 'full') return showGroup(g);
    if (kind === 'defer') {
      // Stage 7: a lotto draw / holiday result waits until my prompt is answered (flushDeferred on render)
      if (!ui.deferred.includes(g)) ui.deferred.push(g);
      return Promise.resolve(false);
    }
    if (kind === 'banner') {
      try {
        banner.show(cutin.specFromGroup(g, cutinOpts(g)));
      } catch (err) {
        console.warn('[banner]', err);
      }
      if (g.mc?.length) mcFeedback({ mc: g.mc });
    }
    return Promise.resolve(false);
  }

  /** Deferred groups (Stage 7) once no prompt of mine is open any more. */
  function flushDeferred() {
    if (!ui.deferred.length || promptForMe() || ui.gameOver) return;
    const list = ui.deferred.splice(0);
    for (const g of list) presentGroup(g);
  }

  /** A cut-in group, preceded by the MC studio cut-in when it opens an era (Stage 5.6). */
  function showGroup(g) {
    // Stage 7 lotto: one studio cut-in (MCs + ball draw) built by cutin2d from the group
    if (g.anchor?.type === 'lottoDraw' || g.anchor?.type === 'houseValueChanged') return cutin.show(mcOn() ? g : { ...g, mc: null, studio: null }, cutinOpts(g));
    const jobs = [];
    if (g.news) noteNews(g.news);
    if (g.studio && mcOn()) jobs.push(cutin.show(studioSpecFor(g.studio, g.anchor, g.news)));
    else if (g.news && g.anchor?.type !== 'newsFlash') jobs.push(cutin.show({ anchor: { type: 'newsFlash', ...g.news, cutin: true }, charId: null, texts: [], money: [], delta: 0, involved: [], mc: null, studio: null, mcEvents: [], news: g.news }, cutinOpts()));
    // a news flash that opened its own studio cut-in is not repeated as a news cut-in
    if (!(g.anchor?.type === 'newsFlash' && g.studio && mcOn())) jobs.push(cutin.show(mcOn() ? g : { ...g, mc: null }, cutinOpts(g)));
    return Promise.all(jobs);
  }

  function studioSpecFor(lines, anchor, news = null) {
    const era = anchor?.type === 'eraChanged' ? anchor.eraName ?? '' : '';
    return cutin.studioSpec(lines, {
      key: `${anchor?.type ?? 'mc'}:${anchor?.era ?? ''}:${anchor?.charId ?? ''}`,
      tone: anchor?.type === 'gameStarted' || anchor?.type === 'holidayStarted' || anchor?.type === 'holidayResult' ? 'holiday' : 'good',
      title:
        anchor?.type === 'gameStarted'
          ? '🎙️ 인생 방송국 · 생방송 시작'
          : anchor?.type === 'holidayStarted' || anchor?.type === 'holidayResult'
            ? `🎙️ ${holidayTitle(anchor.kind)}`
            : era
              ? `🎙️ ${era} 시대 개막`
              : '🎙️ 인생 방송국',
      era: era ? `${era} 시대` : '',
      characters: orderedChars(),
      currentId: anchor?.charId ?? null,
      news,
    });
  }

  /** MC lines on the board (corner booth). */
  function mcFeedback(e) {
    if (!mcOn() || !e?.mc?.length) return;
    mcCorner.say(e.mc);
  }

  // ---------- helpers ----------
  const chars = () => ui.room?.characters ?? [];
  const byId = (id) => chars().find((c) => c.id === id);
  const currentChar = () => byId(ui.room?.turn?.order?.[ui.room.turn.currentIndex]);
  const routes = () => getMeta()?.board?.routes ?? {};
  const betCfg = () => getMeta()?.balance?.bets ?? { minAmount: 5, maxAmount: 20 }; // ranges / payouts[pick] from /api/meta

  async function run(body) {
    if (ui.busy) return false;
    if (ui.room?.status !== 'playing') return false;
    ui.busy = true;
    root.classList.add('busy');
    const v0 = ui.room?.version;
    try {
      await act(body);
      return true;
    } catch (err) {
      // 409 on a spin/bet/choice the game already moved past (turn changed, prompt resolved, game over):
      // quietly catch up with the latest state instead of a confusing toast
      if (err.status === 409 && resync) {
        const fresh = await resync().catch(() => null);
        if (!fresh || fresh.version !== v0 || fresh.status !== 'playing') return false;
      }
      toast(err.message, 'error');
      return false;
    } finally {
      ui.busy = false;
      root.classList.remove('busy');
    }
  }

  // ---------- header ----------
  function renderTop(room) {
    const cur = currentChar();
    const era = room.board.eras[cur?.position?.eraIndex ?? 0];
    el.era.textContent = `${era?.name ?? ''} 시대`;
    el.turninfo.textContent = `턴 ${room.turn.turnNo} · ${room.turn.round}라운드`;
    renderNews(room, era?.id);
    if (!cur) {
      el.now.textContent = '';
      return;
    }
    const phase = room.turn.pending ? '선택 중' : '룰렛 대기';
    el.now.innerHTML = `
      <span class="now-portrait">${portraitHtml(cur, { size: 40 })}</span>
      <span class="now-text"><b>${esc(cur.name)}</b>의 차례 <span class="muted small">(${ownerHtml(cur)}${cur.isMe ? ' · 나' : ''} · ${phase})</span></span>`;
    hydratePortraits(el.now);
    el.now.classList.toggle('mine', !!cur.isMe);
  }

  // ---------- Stage 6: era news badge ----------
  /** News of an era: `room.news[eraId]` → `/api/meta.news`, else what a newsFlash event told us. */
  function newsFor(room, eraId) {
    if (!eraId) return null;
    const id = room?.news?.[eraId];
    const list = getMeta()?.news?.news ?? (Array.isArray(getMeta()?.news) ? getMeta().news : []);
    const def = id ? list.find((n) => n?.id === id) : null;
    if (def) return { title: def.title, text: def.text, tone: def.tone };
    const seen = ui.newsSeen[eraId];
    if (seen && (!id || seen.newsId === id || !seen.newsId)) return seen;
    return id ? { title: '이번 시대 뉴스', text: '', tone: 'neutral' } : null;
  }
  function noteNews(n) {
    if (n?.eraId && n.title) ui.newsSeen[n.eraId] = { newsId: n.newsId ?? null, title: n.title, text: n.text ?? '', tone: n.tone ?? 'neutral' };
  }
  function renderNews(room, eraId) {
    const n = newsFor(room, eraId);
    el.news.hidden = !n;
    if (!n) {
      el.newspop.hidden = true;
      ui.newsOpen = false;
      return;
    }
    const key = `${eraId}|${n.title}`;
    if (el.news.dataset.key !== key) {
      el.news.dataset.key = key;
      el.news.innerHTML = `<span class="nb-ic" aria-hidden="true">📰</span><span class="nb-t">${esc(n.title)}</span>`;
      el.news.title = `이번 시대 뉴스: ${n.title}`;
      el.news.dataset.tone = n.tone ?? 'neutral';
      el.newspop.innerHTML = `<b>📰 ${esc(n.title)}</b>${n.text ? `<p>${esc(n.text)}</p>` : ''}<small class="muted">이 시대 동안 모두에게 적용돼요.</small>`;
    }
    el.newspop.hidden = !ui.newsOpen;
    el.news.setAttribute('aria-expanded', String(ui.newsOpen));
  }
  /** Board strip (2D) / 3D banner when an era's news breaks. */
  function flashNews(n) {
    if (!n?.title) return;
    if (ui.b3?.showBanner) return; // the 3D board shows it in its own era banner
    el.newsflash.innerHTML = `<span class="nf-tag">📰 속보</span><span class="nf-t">${esc(n.title)}</span>`;
    el.newsflash.hidden = false;
    el.newsflash.classList.remove('show');
    void el.newsflash.offsetWidth;
    el.newsflash.classList.add('show');
    clearTimeout(ui.newsFlashTimer);
    ui.newsFlashTimer = setTimeout(() => (el.newsflash.hidden = true), 3200);
  }

  // ---------- board ----------
  function renderTabs(room, shownEra) {
    const counts = room.board.eras.map(() => 0);
    for (const c of chars()) if (!c.finished) counts[c.position?.eraIndex ?? 0]++;
    el.tabs.innerHTML = room.board.eras
      .map(
        (e, i) => `<button type="button" role="tab" class="era-tab${i === shownEra ? ' on' : ''}" data-era="${i}" aria-selected="${i === shownEra}">
          ${esc(e.name)}${counts[i] ? `<span class="era-count">${counts[i]}</span>` : ''}</button>`,
      )
      .join('');
  }

  function pawnsHtml(list, curId) {
    if (!list?.length) return '';
    // crowded tile (e.g. 7–8 on the start tile): overlapping row, current + mine first, the rest as "+N"
    const many = list.length > MAX_TILE_PAWNS;
    const sorted = many ? [...list].sort((a, b) => (b.id === curId) - (a.id === curId) || !!b.isMe - !!a.isMe) : list;
    const shown = many ? sorted.slice(0, MAX_TILE_PAWNS - 1) : sorted;
    const rest = list.length - shown.length;
    return `<div class="pawns${many ? ' many' : ''}">${shown
      .map(
        (c) =>
          `<span class="pawn${c.id === curId ? ' cur' : ''}${c.isMe ? ' me' : ''}" title="${esc(c.name)}" data-char="${esc(c.id)}">${renderAvatar(c.avatar, { size: 26, title: c.name })}</span>`,
      )
      .join('')}${rest > 0 ? `<span class="pawn-more" title="${esc(sorted.slice(MAX_TILE_PAWNS - 1).map((c) => c.name).join(', '))}">+${rest}</span>` : ''}</div>`;
  }

  function tileHtml(t, pawns, curId, style = '') {
    const meta = tileTypeMeta(t.type);
    const amt =
      t.type === 'money'
        ? `<span class="t-amt plus">+${won(t.amount)}</span>`
        : t.type === 'loss'
          ? `<span class="t-amt minus">-${won(t.amount)}</span>`
          : t.type === 'salary'
            ? '<span class="t-amt plus">월급날</span>'
            : '';
    return `<div class="tile t-${esc(t.type)}${t.route ? ` r-${esc(t.route)}` : ''}${pawns?.length ? ' occupied' : ''}" data-tile="${esc(t.id)}" style="--tc:${esc(meta.color ?? '#ccc')};${style}" title="${esc(t.label)}">
      <span class="t-icon">${esc(t.icon ?? meta.icon ?? '')}</span>
      <span class="t-label">${esc(t.label)}</span>${amt}${pawnsHtml(pawns, curId)}</div>`;
  }

  function renderTrack(room, e) {
    const era = room.board.eras[e];
    const cur = currentChar();
    const at = new Map();
    for (const c of chars()) {
      if ((c.position?.eraIndex ?? 0) !== e) continue;
      const id = tileIdAt(room.board, c.position);
      if (!at.has(id)) at.set(id, []);
      at.get(id).push(c);
    }
    const curId = cur?.id;
    if (!era.routes) {
      const start = e === 0 ? tileHtml({ id: 'start', type: 'start', label: '출발', icon: '🚩' }, at.get('start'), curId) : '';
      el.track.className = 'track lane';
      el.track.style.removeProperty('--cols');
      el.track.innerHTML = start + era.tiles.map((t) => tileHtml(t, at.get(t.id), curId)).join('');
      return;
    }
    const keys = Object.keys(era.routes);
    const L = era.routes[keys[0]].tiles.length;
    el.track.className = 'track routes';
    el.track.style.setProperty('--cols', String(L));
    const rows = keys.length;
    let html = tileHtml(era.tiles[0], at.get(era.tiles[0].id), curId, `grid-column:1;grid-row:1 / span ${rows}`);
    keys.forEach((key, r) => {
      const info = routes()[key] ?? { name: key, icon: '' };
      html += `<div class="route-label r-${esc(key)}" style="grid-column:2;grid-row:${r + 1}">${esc(info.icon)} ${esc(info.name)}</div>`;
      era.routes[key].tiles.forEach((t, i) => {
        html += tileHtml(t, at.get(t.id), curId, `grid-column:${i + 3};grid-row:${r + 1}`);
      });
    });
    html += tileHtml(era.tiles[1], at.get(era.tiles[1].id), curId, `grid-column:${L + 3};grid-row:1 / span ${rows}`);
    el.track.innerHTML = html;
  }

  function scrollToCurrent(room) {
    const cur = currentChar();
    if (!cur) return;
    const key = `${room.turn.turnNo}:${tileIdAt(room.board, cur.position)}:${ui.viewEra}`;
    if (key === ui.lastScrollKey) return;
    ui.lastScrollKey = key;
    const tile = el.track.querySelector(`[data-tile="${CSS.escape(tileIdAt(room.board, cur.position))}"]`);
    if (!tile) return;
    const left = tile.offsetLeft - el.scroll.clientWidth / 2 + tile.offsetWidth / 2;
    el.scroll.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }

  // ---------- spin + bets ----------
  /**
   * Spin dock. `hold` (3D board still animating the previous state): the HUD shows the old turn, so the button
   * is hidden (never "지영의 차례" above a "민수 룰렛 돌리기" button) until the board is idle again.
   */
  function renderSpin(room, { hold = false } = {}) {
    const cur = currentChar();
    const turn = room.turn;
    const canSpin = room.status === 'playing' && !!cur?.isMe && turn.phase === 'awaitSpin' && !turn.pending && !hold;
    el.spin.hidden = !canSpin;
    el.spin.disabled = !canSpin; // in-flight requests are blocked via the .busy class
    el.dock.classList.toggle('can-spin', canSpin);
    document.body.classList.toggle('spin-docked', canSpin); // the MC corner moves above the sticky dock
    if (!hold) el.spin.textContent = cur ? `🎡 ${cur.name} 룰렛 돌리기` : '🎡 룰렛 돌리기';
    const last = turn.lastSpin;
    if (!el.dial.classList.contains('rolling') && !hold) el.dial.textContent = last ? String(last.value) : '?';
    if (hold) {
      el.hint.innerHTML = ui.b3 ? '🎲 말이 움직이는 중…' : '⏳ 이벤트 진행 중…';
      return;
    }
    let hint = '';
    if (room.status !== 'playing') {
      hint = '🏁 게임 종료! 결과를 준비하는 중…';
    } else if (turn.pending) {
      const waiting = turn.pending.forCharacterIds.filter((id) => !turn.pending.answered?.includes(id)).map((id) => byId(id)?.name ?? id);
      hint = `⏳ ${esc(turn.pending.title ?? '선택')} — ${esc(waiting.join(', '))} 선택 기다리는 중${deadlineHtml(turn.pending.deadlineAt)}`;
    } else if (canSpin) {
      hint = `내 차례예요! 룰렛을 돌리세요.${deadlineHtml(turn.spinDeadlineAt, '⏱')}`;
    } else if (cur) {
      hint = `${esc(cur.ownerName)}님이 「${esc(cur.name)}」의 룰렛을 돌리기를 기다리는 중…${deadlineHtml(turn.spinDeadlineAt, '⏱')}`;
    }
    // 3D: don't spoil the roulette result before the wheel stops (render again on idle)
    const spoiler = ui.b3 && (ui.b3.isBusy() || performance.now() - ui.lastStateAt < 400);
    if (last && !spoiler) {
      const who = byId(last.charId);
      // Stage 6: while serving, the pawn moves `steps` (half), not the roulette value
      const note = spinNote(last);
      const steps = last.halved && Number.isFinite(last.steps) && last.steps !== last.value ? ` <small>(🪖 복무 중 ${last.steps}칸 이동)</small>` : note ? ` <small>(${esc(note.text)} 이동)</small>` : '';
      hint = `<span class="last-spin">최근 룰렛: ${esc(who?.name ?? '')} ${last.value}${steps}</span><br>${hint}`;
    }
    el.hint.innerHTML = hint;
  }

  /** Countdown to a server deadline (ms epoch; `turn.spinDeadlineAt` / `pending.deadlineAt`). */
  function deadlineHtml(at, icon = '') {
    return at ? ` <span class="deadline" data-deadline="${Number(at)}" data-icon="${esc(icon)}"></span>` : '';
  }

  function renderBets(room, { hold = false } = {}) {
    const cur = currentChar();
    const turn = room.turn;
    // betting on another family's roulette only (the server refuses my own family's turn)
    const mine = chars().filter((c) => c.isMe && c.ownerId !== cur?.ownerId);
    const open = room.status === 'playing' && !hold && cur && !cur.isMe && turn.phase === 'awaitSpin' && !turn.pending && mine.length > 0;
    el.bet.hidden = !open;
    if (!open) {
      el.bet.innerHTML = '';
      ui.bet.turnKey = null;
      return;
    }
    const cfg = betCfg();
    const PICKS = betPicks(cfg);
    const PICK_LABEL = Object.fromEntries(PICKS.map((p) => [p.pick, p.label]));
    if (!PICKS.some((p) => p.pick === ui.bet.pick)) ui.bet.pick = PICKS[0].pick;
    ui.bet.turnKey = `${turn.turnNo}:${cur.id}`;
    const slot = room.bets?.[turn.turnNo] ?? {};
    if (!mine.some((c) => c.id === ui.bet.bettor)) ui.bet.bettor = mine[0].id;
    const bettor = byId(ui.bet.bettor);
    const maxAmt = Math.min(cfg.maxAmount, Math.floor(bettor.money));
    const canAfford = maxAmt >= cfg.minAmount;
    if (ui.bet.amount == null || ui.bet.amount > maxAmt) ui.bet.amount = Math.max(cfg.minAmount, Math.min(10, maxAmt));
    if (ui.bet.amount < cfg.minAmount) ui.bet.amount = cfg.minAmount;
    const placed = slot[bettor.id];
    const others = Object.entries(slot).filter(([id]) => !byId(id)?.isMe).length;
    const pickObj = PICKS.find((p) => p.pick === ui.bet.pick) ?? PICKS[0];
    el.bet.innerHTML = `
      <h3>🎲 훈수 베팅 <span class="muted small">— ${esc(cur.name)}의 룰렛 결과 맞히기</span></h3>
      ${
        mine.length > 1
          ? `<label class="bet-row">베팅할 캐릭터
              <select data-bet="bettor">${mine
                .map((c) => `<option value="${esc(c.id)}"${c.id === bettor.id ? ' selected' : ''}>${esc(c.name)} (${won(c.money)})</option>`)
                .join('')}</select></label>`
          : `<p class="small muted">베팅: ${esc(bettor.name)} (보유 ${won(bettor.money)})</p>`
      }
      <div class="bet-picks" role="group" aria-label="베팅 선택" style="--n:${PICKS.length}">${PICKS.map(
        (p) =>
          `<button type="button" class="bet-pick${p.pick === ui.bet.pick ? ' on' : ''}" data-pick="${esc(p.pick)}" data-kind="${esc(p.kind)}">${esc(p.label)}${
            p.payout != null ? `<small>×${esc(p.payout)}</small>` : ''
          }</button>`,
      ).join('')}</div>
      <label class="bet-row">금액 <b data-bet="amt-label">${won(ui.bet.amount)}</b>
        <input type="range" data-bet="amount" min="${cfg.minAmount}" max="${Math.max(cfg.minAmount, maxAmt)}" step="1" value="${ui.bet.amount}" ${canAfford ? '' : 'disabled'}>
      </label>
      <button type="button" class="btn small bet-go" data-bet="go" ${canAfford ? '' : 'disabled'}>${placed ? '베팅 바꾸기' : '베팅하기'} (${esc(pickObj.label)} · ${won(ui.bet.amount)})</button>
      <p class="small muted bet-status">${
        placed ? `✅ ${esc(bettor.name)}: ${esc(PICK_LABEL[placed.pick] ?? placed.pick)}에 ${won(placed.amount)} 베팅함` : canAfford ? '룰렛이 돌기 전까지 베팅할 수 있어요.' : '돈이 부족해 베팅할 수 없어요.'
      }${others ? ` · 다른 가문 ${others}명 베팅 중` : ''}</p>`;
  }

  // ---------- Stage 7: hand, card sheet, trade / gift, inbox ----------
  const hasCards = () => chars().some((c) => Array.isArray(c.cards));
  const artFor = (kind, id) => {
    if (!id || !ui.assetsReady) return null;
    return (kind === 'job' ? findAsset({ kind: 'icon', job: id }) : findAsset({ kind, [kind]: id }))?.url ?? null;
  };
  /** Job badge icon: generated badge art (`{kind:'icon', job}`) when accepted, else the emoji. */
  const jbIcon = (jb) => {
    const url = artFor('job', jb?.id);
    return url ? `<img class="jb-img" src="${esc(url)}" alt="" decoding="async">` : esc(jb?.icon ?? '💼');
  };
  const serverNow = () => Date.now() + clockOffset();

  /** Whose hand the dock shows: the current character when it's mine, else my chosen / first character. */
  function handChar() {
    const mine = chars().filter((c) => c.isMe);
    if (!mine.length) return null;
    const cur = currentChar();
    if (cur?.isMe && !cur.finished) return cur;
    return mine.find((c) => c.id === ui.handFor) ?? mine.find((c) => !c.finished) ?? mine[0];
  }

  function renderHand(room, { hold = false } = {}) {
    const who = room.status === 'playing' && !isSpectator() && hasCards() ? handChar() : null;
    el.hand.hidden = !who;
    if (!who) {
      el.hand.innerHTML = '';
      return;
    }
    const meta = getMeta();
    const hand = handOf(who, meta);
    const lim = cardDefs(meta).handLimit;
    const mine = chars().filter((c) => c.isMe);
    const cur = currentChar();
    const myTurn = cur?.id === who.id;
    const cards = hand
      .map((card) => {
        const pl = hold ? { playable: false, reason: '이벤트 진행 중이에요.', kind: card.info.kind } : cardPlayability(room, who, card, { meta });
        const cls = [pl.playable ? 'can' : 'dim', card.info.kind === 'passive' ? 'passive' : ''].filter(Boolean).join(' ');
        return cardHtml(card, { art: artFor('card', card.id), meta, cls, attrs: `data-card-uid="${esc(card.uid)}" data-card-char="${esc(who.id)}"`, note: pl.reason ?? '' });
      })
      .join('');
    let hint;
    if (!hand.length) hint = '카드가 없어요 · 🃏 카드 칸이나 🛍️ 상점에서 얻어요';
    else if (myTurn && room.turn.cardUsed) hint = '✅ 이번 턴 카드 사용 완료';
    else if (myTurn && room.turn.phase === 'awaitSpin' && !room.turn.pending) hint = '룰렛 전에 1장 쓸 수 있어요 · 카드를 눌러 보세요';
    else hint = '내 차례에 룰렛을 돌리기 전 1장 쓸 수 있어요';
    const tabs =
      mine.length > 1 && !(cur?.isMe && !cur.finished)
        ? `<span class="hand-tabs" role="group" aria-label="손패 볼 캐릭터">${mine
            .map((c) => `<button type="button" class="hand-tab${c.id === who.id ? ' on' : ''}" data-hand-for="${esc(c.id)}" aria-pressed="${c.id === who.id}">${esc(c.name)}</button>`)
            .join('')}</span>`
        : '';
    const html = `<div class="hand-head"><span class="hand-t">🃏 <b>${esc(who.name)}</b>의 손패 <small>${hand.length}/${lim}</small></span>${tabs}<span class="hand-hint">${esc(hint)}</span></div>
      <div class="hand-row" role="list">${cards}</div>`;
    if (el.hand.dataset.html === html) return; // unchanged: keep the DOM (focus, scroll position, hover)
    const scroll = el.hand.querySelector('.hand-row')?.scrollLeft ?? 0;
    el.hand.innerHTML = html;
    el.hand.dataset.html = html;
    const row = el.hand.querySelector('.hand-row');
    if (row && scroll) row.scrollLeft = scroll;
  }

  function openCardSheet(charId, uid) {
    ui.cardSheet = { charId, uid, targetId: null };
    renderCardSheet();
    el.cardsheet.querySelector('[data-card-use], [data-sheet-close]')?.focus({ preventScroll: true });
  }
  function closeCardSheet() {
    ui.cardSheet = null;
    el.cardsheet.hidden = true;
    el.cardsheet.innerHTML = '';
    el.cardsheet.dataset.html = '';
  }

  /** Card detail sheet: art, kind, effect, 「사용」 (+ target picker for sabotage cards). Re-rendered on state changes. */
  function renderCardSheet() {
    const cs = ui.cardSheet;
    const room = ui.room;
    const who = cs ? byId(cs.charId) : null;
    const meta = getMeta();
    const card = who ? handOf(who, meta).find((c) => c.uid === cs.uid) : null;
    if (!cs || !card || room?.status !== 'playing') {
      if (cs) closeCardSheet();
      return;
    }
    const info = card.info;
    const pl = cardPlayability(room, who, card, { meta, spectator: isSpectator() });
    const kind = CARD_KINDS[info.kind] ?? CARD_KINDS.instant;
    let targets = '';
    if (pl.needsTarget) {
      const list = sabotageTargets(room, who);
      if (cs.targetId && !list.some((x) => x.valid && x.char.id === cs.targetId)) cs.targetId = null;
      targets = `<h3 class="cs-sub">누구에게 쓸까요?</h3><div class="cs-targets" role="radiogroup" aria-label="대상">${
        list.length
          ? list
              .map(
                (x) => `<button type="button" class="cs-target${x.char.id === cs.targetId ? ' on' : ''}" data-card-target="${esc(x.char.id)}" role="radio" aria-checked="${x.char.id === cs.targetId}"${x.valid ? '' : ' disabled'}>
                  <span class="cs-tp">${portraitHtml(x.char, { size: 36 })}</span><span class="cs-tn"><b>${esc(x.char.name)}</b><small>${esc(x.char.ownerName ?? '')}${x.char.isMe ? ' · 나' : ''} · ${esc(room.board?.eras?.[x.char.position?.eraIndex ?? 0]?.name ?? '')}</small>${
                    x.reason ? `<small class="cs-why">${esc(x.reason)}</small>` : ''
                  }</span></button>`,
              )
              .join('')
          : '<p class="muted small">노릴 수 있는 캐릭터가 없어요.</p>'
      }</div>`;
    }
    const ready = pl.playable && (!pl.needsTarget || !!cs.targetId);
    const reason = pl.reason ?? (pl.needsTarget && !cs.targetId ? '대상을 고르세요.' : '');
    const html = `<div class="g-sheet card-sheet k-${esc(info.kind)}">
      <div class="cs-top">${cardHtml(card, { art: artFor('card', card.id), meta, tag: 'div', cls: 'big' })}
        <div class="cs-info"><span class="cs-kind" style="--kc:${kind.color}">${esc(kind.label)} 카드</span><h2>${esc(info.icon)} ${esc(info.name)}</h2><p>${esc(info.desc)}</p>${
          info.jobOnly ? `<p class="small muted">💼 ${esc(jobInfo(info.jobOnly, meta?.jobs)?.name ?? info.jobOnly)} 전용</p>` : ''
        }<p class="small muted">${esc(who.name)}의 카드</p></div></div>
      ${targets}
      ${reason ? `<p class="cs-reason${pl.playable ? '' : ' no'}">${esc(reason)}</p>` : ''}
      <div class="cs-actions"><button type="button" class="btn ghost" data-sheet-close>닫기</button>${
        info.kind === 'passive' ? '' : `<button type="button" class="btn primary" data-card-use${ready ? '' : ' disabled'}>${info.kind === 'sabotage' ? '💢 뒤통수 치기' : '✨ 사용'}</button>`
      }</div></div>`;
    el.cardsheet.hidden = false;
    if (el.cardsheet.dataset.html === html) return; // unchanged → keep focus / portraits
    el.cardsheet.innerHTML = html;
    el.cardsheet.dataset.html = html;
    hydratePortraits(el.cardsheet);
  }

  async function useCard() {
    const cs = ui.cardSheet;
    const who = cs ? byId(cs.charId) : null;
    const card = who ? handOf(who, getMeta()).find((c) => c.uid === cs.uid) : null;
    if (!card) return closeCardSheet();
    const body = { type: 'useCard', characterId: who.id, cardUid: card.uid };
    if (card.info.kind === 'sabotage') body.targetId = cs.targetId;
    const ok = await run(body);
    if (ok) {
      closeCardSheet();
      if (card.info.kind !== 'sabotage' && card.id !== 'pledge') toast(`${card.info.icon} ${card.info.name} 카드를 썼어요!`);
    }
  }

  // --- trade / gift dialog ---
  function openTrade(mode, toId) {
    const mine = chars().filter((c) => c.isMe && c.id !== toId && !(mode === 'trade' && c.ownerId && c.ownerId === byId(toId)?.ownerId));
    if (!mine.length) return;
    const cur = currentChar();
    const from = mine.find((c) => c.id === cur?.id) ?? mine.find((c) => !c.finished) ?? mine[0];
    const to = byId(toId);
    // default: my money for one of their cards (money ↔ money is not a trade)
    const giveKind = mode === 'trade' && !to?.cards?.length && from.cards?.length ? 'card' : 'money';
    const wantKind = giveKind === 'card' ? 'money' : 'card';
    ui.trade = { mode, toId, fromId: from.id, give: { kind: giveKind, money: '', cardUid: null }, want: { kind: wantKind, money: '', cardUid: null } };
    renderTradeDlg();
    el.tradedlg.querySelector('input, button')?.focus({ preventScroll: true });
  }
  function closeTrade() {
    ui.trade = null;
    el.tradedlg.hidden = true;
    el.tradedlg.innerHTML = '';
  }
  function tradeCheck() {
    const t = ui.trade;
    if (!t) return { ok: false, error: '' };
    if (t.mode === 'gift') return validateGift({ fromId: t.fromId, toId: t.toId, kind: t.give.kind, money: t.give.money, cardUid: t.give.cardUid }, { room: ui.room, meta: getMeta() });
    return validateTrade({ fromId: t.fromId, toId: t.toId, give: t.give, want: t.want }, { room: ui.room, meta: getMeta() });
  }
  function sideHtml(side, key, owner, { label }) {
    const meta = getMeta();
    const hand = handOf(owner, meta);
    const kinds = [['money', '💰 돈'], ['card', '🃏 카드']];
    return `<fieldset class="td-side"><legend>${esc(label)}</legend>
      <div class="td-kinds" role="radiogroup">${kinds
        .map(([k, l]) => `<button type="button" class="td-kind${side.kind === k ? ' on' : ''}" data-td-side="${key}" data-td-kind="${k}" role="radio" aria-checked="${side.kind === k}"${k === 'card' && !hand.length ? ' disabled' : ''}>${l}</button>`)
        .join('')}</div>
      ${
        side.kind === 'money'
          ? `<label class="td-money"><input type="number" inputmode="numeric" min="1" step="1" ${key === 'give' ? `max="${Math.max(0, Math.floor(owner.money))}"` : ''} placeholder="금액 (만원)" value="${esc(side.money)}" data-td-money="${key}"><span>만원</span>${
              key === 'give' ? `<small class="muted">보유 ${won(owner.money)}</small>` : `<small class="muted">${esc(owner.name)} 보유 ${won(owner.money)}</small>`
            }</label>`
          : ''
      }
      ${
        side.kind === 'card'
          ? `<div class="td-cards">${hand
              .map((c) => cardHtml(c, { art: artFor('card', c.id), meta, cls: `mini${String(side.cardUid) === c.uid ? ' on' : ''}`, attrs: `data-td-card="${esc(c.uid)}" data-td-side="${key}" aria-pressed="${String(side.cardUid) === c.uid}"` }))
              .join('')}</div>`
          : ''
      }</fieldset>`;
  }
  function renderTradeDlg() {
    const t = ui.trade;
    const to = t ? byId(t.toId) : null;
    if (!t || !to || ui.room?.status !== 'playing') return closeTrade();
    const mine = chars().filter((c) => c.isMe && c.id !== to.id && !(t.mode === 'trade' && c.ownerId && c.ownerId === to.ownerId));
    if (!mine.some((c) => c.id === t.fromId)) t.fromId = mine[0]?.id ?? null;
    const from = byId(t.fromId);
    if (!from) return closeTrade();
    const check = tradeCheck();
    const fromSel =
      mine.length > 1
        ? `<label class="td-from">보내는 캐릭터 <select data-td-from>${mine.map((c) => `<option value="${esc(c.id)}"${c.id === from.id ? ' selected' : ''}>${esc(c.name)} (${won(c.money)})</option>`).join('')}</select></label>`
        : `<p class="small muted td-from">보내는 캐릭터: <b>${esc(from.name)}</b> (${won(from.money)})</p>`;
    el.tradedlg.innerHTML = `<div class="g-sheet trade-sheet">
      <div class="sheet-who">${portraitHtml(to, { size: 48 })}<div><h2>${t.mode === 'gift' ? '🎁 선물하기' : '🤝 거래 제안'}</h2><p class="small muted">받는 사람: <b>${esc(to.name)}</b> (${esc(to.ownerName ?? '')}${to.isMe ? ' · 내 캐릭터' : ''})</p></div></div>
      ${fromSel}
      ${
        t.mode === 'gift'
          ? sideHtml(t.give, 'give', from, { label: '보낼 것' })
          : `${sideHtml(t.give, 'give', from, { label: `줄 것 (${from.name})` })}${sideHtml(t.want, 'want', to, { label: `받고 싶은 것 (${to.name})` })}<p class="small muted">상대가 수락하면 바로 교환돼요. 60초 안에 답이 없으면 없던 일이 돼요.</p>`
      }
      ${handFull(t.give.kind === 'card' ? to : null, getMeta()) ? `<p class="small muted">✋ ${esc(to.name)}의 손패가 가득 차서 가장 오래된 카드 한 장이 버려져요.</p>` : ''}
      <p class="td-error" data-td-error role="alert">${check.ok ? '' : esc(check.error ?? '')}</p>
      <div class="cs-actions"><button type="button" class="btn ghost" data-td-close>닫기</button><button type="button" class="btn primary" data-td-send${check.ok ? '' : ' disabled'}>${t.mode === 'gift' ? '🎁 보내기' : '🤝 제안하기'}</button></div>
    </div>`;
    hydratePortraits(el.tradedlg);
    el.tradedlg.hidden = false;
  }
  function refreshTradeCheck() {
    const check = tradeCheck();
    const err = el.tradedlg.querySelector('[data-td-error]');
    if (err) err.textContent = check.ok ? '' : check.error ?? '';
    const go = el.tradedlg.querySelector('[data-td-send]');
    if (go) go.disabled = !check.ok;
  }
  async function sendTrade() {
    const t = ui.trade;
    const check = tradeCheck();
    if (!t || !check.ok) return refreshTradeCheck();
    const to = byId(t.toId);
    const ok = await run(check.body);
    if (ok) {
      closeTrade();
      toast(t.mode === 'gift' ? `🎁 ${to?.name ?? ''}에게 선물을 보냈어요!` : `🤝 ${to?.name ?? ''}에게 거래를 제안했어요.`);
    }
  }

  /** Persistent strip: incoming offers (수락 / 거절 + countdown) and my open offers (취소). */
  function renderInbox(room) {
    const show = room?.status === 'playing' && !isSpectator() && Array.isArray(room.trades);
    const lists = show ? tradeLists(room, serverNow()) : { incoming: [], outgoing: [] };
    const key = [...lists.incoming, ...lists.outgoing].map((t) => `${t.id}:${t.expiresAt}`).join('|') + `|${chars().map((c) => (c.cards ?? []).length).join(',')}`;
    if (key === ui.inboxKey) return;
    ui.inboxKey = key;
    const meta = getMeta();
    const n = (id) => byId(id)?.name ?? '';
    const sides = (t) => {
      const from = byId(t.fromId);
      const to = byId(t.toId);
      return { give: tradeSideText(t.give, { owner: from, meta, won }), want: tradeSideText(t.want, { owner: to, meta, won }) };
    };
    const rows = [
      ...lists.incoming.map((t) => {
        const s2 = sides(t);
        return `<div class="ti-row in" data-trade="${esc(t.id)}"><span class="ti-t"><span class="ti-tt">🤝 <b>${esc(n(t.fromId))}</b> → <b>${esc(n(t.toId))}</b> 거래 제안</span>${
          t.expiresAt ? `<span class="deadline" data-deadline="${Number(t.expiresAt)}" data-icon="⏳"></span>` : ''
        }</span><span class="ti-d">줄게 <b>${esc(s2.give)}</b> · 원해 <b>${esc(s2.want)}</b></span><span class="ti-a"><button type="button" class="btn tiny primary" data-trade-accept="${esc(t.id)}" data-char="${esc(t.toId)}">수락</button><button type="button" class="btn tiny" data-trade-reject="${esc(t.id)}" data-char="${esc(t.toId)}">거절</button></span></div>`;
      }),
      ...lists.outgoing.map((t) => {
        const s2 = sides(t);
        return `<div class="ti-row out" data-trade="${esc(t.id)}"><span class="ti-t"><span class="ti-tt">⏳ <b>${esc(n(t.fromId))}</b> → ${esc(n(t.toId))}에게 제안 중</span>${
          t.expiresAt ? `<span class="deadline" data-deadline="${Number(t.expiresAt)}"></span>` : ''
        }</span><span class="ti-d">줄게 ${esc(s2.give)} · 원해 ${esc(s2.want)}</span><span class="ti-a"><button type="button" class="btn tiny ghost" data-trade-cancel="${esc(t.id)}" data-char="${esc(t.fromId)}">취소</button></span></div>`;
      }),
    ];
    el.inbox.hidden = !rows.length;
    el.inbox.innerHTML = rows.join('');
    document.body.classList.toggle('has-inbox', rows.length > 0);
    document.body.style.setProperty('--inbox-h', rows.length ? `${el.inbox.offsetHeight + 8}px` : '0px');
    tickDeadlines();
  }

  // ---------- character panel / log ----------
  function renderChars(room) {
    const cur = currentChar();
    const order = room.turn.order.map(byId).filter(Boolean);
    const eraName = (c) => room.board.eras[c.position?.eraIndex ?? 0]?.name ?? '';
    const jobs = getMeta()?.jobs;
    const cap = statCap(getMeta());
    if (ui.openChar && !order.some((c) => c.id === ui.openChar)) ui.openChar = null;
    el.chars.innerHTML = order
      .map((c) => {
        const r = c.route ? routes()[c.route] : null;
        const status = c.finished ? `🏁 ${c.place}등 골인` : `${esc(eraName(c))}${r ? ` · ${esc(r.icon)} ${esc(r.name)}` : ''}`;
        const open = ui.openChar === c.id;
        const stats = statRows(c, cap);
        const tags = charTagsHtml(c, jobs);
        return `<li class="g-char${c.id === cur?.id ? ' cur' : ''}${c.isMe ? ' me' : ''}${c.finished ? ' done' : ''}${open ? ' open' : ''}" data-id="${esc(c.id)}">
          <button type="button" class="gc-row" data-char-detail="${esc(c.id)}" aria-expanded="${open}" aria-controls="gcd-${esc(c.id)}" title="능력치·직업 자세히 보기">
          <span class="gc-portrait">${portraitHtml(c, { size: 40 })}</span>
          <span class="gc-body">
            <span class="gc-name">${esc(c.name)} <small class="muted">${ownerHtml(c)}${c.isMe ? ' · 나' : ''}</small></span>
            <span class="gc-status small">${status}</span>
            ${tags ? `<span class="gc-tags">${tags}</span>` : ''}
            ${stats.length ? `<span class="gc-mini" aria-hidden="true">${stats.map((st) => `<i style="--p:${st.pct}%;--c:${st.color}" title="${esc(st.label)} ${st.value}"></i>`).join('')}</span>` : ''}
          </span>
          <span class="gc-money"><b>${won(c.money)}</b>${c.debt > 0 ? `<small class="debt">빚 ${won(c.debt)}</small>` : ''}</span>
          </button>
          ${open ? charDetailHtml(c, { jobs, cap }) : ''}
        </li>`;
      })
      .join('');
    hydratePortraits(el.chars);
  }

  /** Compact tags of a side-list row: job badge (icon · name · ★), 부상, 학력, 군 복무. */
  function charTagsHtml(c, jobs) {
    const out = [];
    const jb = jobBadge(c, jobs);
    if (jb) {
      out.push(
        `<span class="job-badge${jb.partTime ? ' parttime' : ''}${jb.hidden ? ' hidden-job' : ''}" title="${esc(`${jb.name}${jb.rankName ? ` · ${jb.rankName}` : ''} (${jb.rank}/${jb.maxRank})`)}"><span class="jb-ic">${jbIcon(jb)}</span><span class="jb-n">${esc(jb.name)}</span>${
          jb.stars ? `<span class="jb-stars">${esc(jb.stars)}</span>` : ''
        }</span>`,
      );
      if (jb.injured) out.push(`<span class="gc-tag bad" title="부상">🤕 ${jb.injured}턴</span>`);
    }
    const edu = educationLabel(c.education);
    if (edu) out.push(`<span class="gc-tag">🎓 ${esc(edu)}</span>`);
    const mil = militaryLabel(c.military);
    if (mil && c.military?.status === 'serving') out.push(`<span class="gc-tag mil">🪖 ${esc(mil)}</span>`);
    // Stage 8: 💕 partner / 💍 spouse + children, 🏠 house
    const fam = familyIcons(c);
    if (fam) out.push(`<span class="gc-tag fam" title="${esc(familySummary(c, getMeta()) || '연애 중')}">${esc(fam)}</span>`);
    const house = houseOf(c, getMeta());
    if (house) out.push(`<span class="gc-tag house" title="${esc(`${house.name} · ${won(house.value ?? 0)}`)}">${esc(house.icon)} ${esc(won(house.value ?? 0))}</span>`);
    // Stage 9: 💎 treasures (values stay hidden until the appraisal)
    const nTr = treasureCount(c);
    if (nTr) out.push(`<span class="gc-tag treasure" title="${esc(`보물 ${nTr}개 · ${treasuresOf(c, getMeta()).map((t) => t.info.name).join(', ')}`)}">💎 ${nTr}</span>`);
    // Stage 7: roulette modifiers (⚡+2 / ✂️−3 …), hand size, item icons
    for (const b of spinModBadges(c.spinMods)) out.push(`<span class="gc-tag mod ${b.kind}" title="${esc(b.title)}">${esc(b.text)}</span>`);
    if (Array.isArray(c.cards)) out.push(`<span class="gc-tag hand-n" title="손패 ${c.cards.length}장">🃏 ${c.cards.length}</span>`);
    const items = itemsOf(c, getMeta());
    if (items.length) {
      out.push(
        `<span class="gc-items" title="${esc(items.map((i) => i.info.name).join(', '))}">${items
          .slice(0, 4)
          .map((i) => itemIconHtml(i.id, { art: artFor('item', i.id), meta: getMeta() }))
          .join('')}${items.length > 4 ? `<small>+${items.length - 4}</small>` : ''}</span>`,
      );
    }
    return out.join('');
  }

  /** Detail card (tap on a row): stat bars, job + history, education, military, unlocked hidden jobs. */
  function charDetailHtml(c, { jobs, cap }) {
    const stats = statRows(c, cap);
    const jb = jobBadge(c, jobs);
    const edu = educationLabel(c.education);
    const mil = militaryLabel(c.military);
    const hist = Array.isArray(c.jobHistory) ? c.jobHistory : [];
    const hidden = Array.isArray(c.hiddenUnlocked) ? c.hiddenUnlocked : [];
    const eraName = (id) => ui.room?.board?.eras?.find((e) => e.id === id)?.name ?? id ?? '';
    const rows = [];
    if (stats.length) {
      rows.push(
        `<div class="stat-bars">${stats
          .map(
            (st) =>
              `<div class="stat-row" style="--c:${st.color}"><span class="st-l">${st.icon} ${esc(st.label)}</span><span class="st-bar" role="meter" aria-label="${esc(st.label)}" aria-valuemin="0" aria-valuemax="${cap}" aria-valuenow="${st.value}"><i style="width:${st.pct}%"></i></span><b class="st-v">${st.value}<small>/${cap}</small></b></div>`,
          )
          .join('')}</div>`,
      );
    }
    const facts = [];
    if (jb) {
      facts.push(
        `<div class="gd-fact"><span class="gd-k">직업</span><span class="gd-v"><span class="job-badge big${jb.partTime ? ' parttime' : ''}"><span class="jb-ic">${jbIcon(jb)}</span><span class="jb-n">${esc(jb.name)}</span>${
          jb.stars ? `<span class="jb-stars">${esc(jb.stars)}</span>` : ''
        }</span>${jb.rankName ? ` <small>${esc(jb.rankName)} (${jb.rank}/${jb.maxRank})</small>` : ''}${jb.injured ? ` <span class="gc-tag bad">🤕 부상 ${jb.injured}턴</span>` : ''}</span></div>`,
      );
    } else if ('job' in c) facts.push('<div class="gd-fact"><span class="gd-k">직업</span><span class="gd-v muted">아직 없음</span></div>');
    if ('education' in c) facts.push(`<div class="gd-fact"><span class="gd-k">학력</span><span class="gd-v">${edu ? `🎓 ${esc(edu)}` : '<span class="muted">-</span>'}</span></div>`);
    if (mil) facts.push(`<div class="gd-fact"><span class="gd-k">군 복무</span><span class="gd-v">🪖 ${esc(mil)}</span></div>`);
    if (hist.length) {
      facts.push(
        `<div class="gd-fact"><span class="gd-k">직업 이력</span><span class="gd-v gd-hist">${hist
          .map((h) => {
            const info = jobInfo(h.id, jobs);
            return `<span class="gd-h">${esc(info?.icon ?? '💼')} ${esc(info?.name ?? h.id)}${h.rank ? ` ${esc(rankStars(h.rank, Math.max(info?.maxRank ?? 1, h.rank)))}` : ''}${h.era ? ` <small>${esc(eraName(h.era))}</small>` : ''}</span>`;
          })
          .join('')}</span></div>`,
      );
    }
    if (hidden.length) {
      facts.push(
        `<div class="gd-fact"><span class="gd-k">숨은 직업</span><span class="gd-v">${hidden
          .map((id) => {
            const info = jobInfo(id, jobs);
            return `<span class="gc-tag gold">🌟 ${esc(info?.icon ?? '')} ${esc(info?.name ?? id)}</span>`;
          })
          .join(' ')}</span></div>`,
      );
    }
    // Stage 7: hand (public), items, 🤝 거래 제안 / 🎁 선물
    const meta = getMeta();
    if (Array.isArray(c.cards)) {
      const hand = handOf(c, meta);
      facts.push(
        `<div class="gd-fact"><span class="gd-k">손패</span><span class="gd-v gd-cards">${
          hand.length ? hand.map((h) => `<span class="gd-card k-${esc(h.info.kind)}" title="${esc(h.info.desc)}">${esc(h.info.icon)} ${esc(h.info.name)}</span>`).join('') : '<span class="muted">없음</span>'
        }</span></div>`,
      );
    }
    const items = itemsOf(c, meta);
    if (items.length) {
      facts.push(
        `<div class="gd-fact"><span class="gd-k">아이템</span><span class="gd-v gd-items">${items
          .map((i) => `<span class="gd-item">${itemIconHtml(i.id, { art: artFor('item', i.id), meta })} ${esc(i.info.name)}</span>`)
          .join('')}</span></div>`,
      );
    }
    // Stage 9: treasures (감정 전 ??? until the result appraisal)
    const trs = treasuresOf(c, meta);
    if (trs.length) {
      const values = new Map((ui.room?.result?.treasures ?? []).filter((t) => t.charId === c.id).map((t) => [t.uid, { value: Number(t.value) || 0, fake: !!t.fake, text: '' }]));
      facts.push(`<div class="gd-fact"><span class="gd-k">보물</span><span class="gd-v">${treasureListHtml(trs, { values, won, artFor })}</span></div>`);
    }
    // Stage 8: love (❤️ bar), spouse, children, house
    const famHtml = familyDetailHtml(c, { meta, room: ui.room, avatars: meta?.avatars, artFor, won });
    if (famHtml) facts.push(famHtml);
    const mods = spinModBadges(c.spinMods);
    if (mods.length) facts.push(`<div class="gd-fact"><span class="gd-k">다음 룰렛</span><span class="gd-v">${mods.map((b) => `<span class="gc-tag mod ${b.kind}">${esc(b.text)} ${esc(b.title)}</span>`).join(' ')}</span></div>`);
    const acts = [];
    if (ui.room?.status === 'playing' && !isSpectator() && Array.isArray(c.cards)) {
      const mine = chars().filter((x) => x.isMe);
      const others = mine.filter((x) => x.id !== c.id);
      if (!c.isMe && mine.some((x) => !x.ownerId || x.ownerId !== c.ownerId)) acts.push(`<button type="button" class="btn tiny" data-trade-open="${esc(c.id)}">🤝 거래 제안</button>`);
      if (others.length) acts.push(`<button type="button" class="btn tiny" data-gift-open="${esc(c.id)}">🎁 선물</button>`);
    }
    if (!rows.length && !facts.length) facts.push('<p class="muted small">능력치·직업 정보가 아직 없어요.</p>');
    return `<div class="gc-detail" id="gcd-${esc(c.id)}">${rows.join('')}${facts.length ? `<div class="gd-facts">${facts.join('')}</div>` : ''}${acts.length ? `<div class="gd-acts">${acts.join('')}</div>` : ''}</div>`;
  }

  function renderLog(room) {
    el.log.innerHTML = room.log
      .slice(-40)
      .reverse()
      .map((l) => `<li class="tone-${esc(l.tone ?? 'info')}">${esc(l.text)}</li>`)
      .join('');
  }

  // ---------- decision modal ----------
  /** Prompt as a cut-in: options for my characters, a waiting screen for everyone else. */
  function renderPromptCutin(room) {
    const p = room.status === 'playing' ? room.turn.pending : null;
    clearTimeout(ui.promptTimer);
    if (!p) return cutin.closePrompt();
    if (cutin.promptId && cutin.promptId !== p.promptId) cutin.closePrompt();
    const forMe = myPendingChars(p, chars());
    const seenAt = promptSeenAt(p.promptId);
    let urgent = false;
    if (cutin.promptId !== p.promptId) {
      if (forMe.length) {
        // mine: pre-empt queued spectator cut-ins at once (the current one closes within 1.5 s); in 3D give the
        // board a moment for the roulette / hops, then open over it while it keeps animating
        const boardBusy = ui.b3 && (ui.b3.isBusy() || performance.now() - ui.lastStateAt < 380);
        cutin.preempt();
        banner.clear();
        if (boardBusy && performance.now() - seenAt < PROMPT_BOARD_WAIT_MS) {
          ui.promptTimer = setTimeout(() => ui.room && renderModal(ui.room), 150);
          return;
        }
        urgent = true;
      } else {
        // someone else's decision: 「간단히」/「끄기」 → a small banner (the spin dock shows who is choosing)
        if (ui.cutinMode !== 'full') {
          if (ui.promptSeen.bannered !== p.promptId && ui.cutinMode === 'compact') {
            ui.promptSeen.bannered = p.promptId;
            const who = byId(p.charId);
            const names = p.forCharacterIds.map((id) => byId(id)?.name).filter(Boolean);
            banner.show({
              key: `prompt:${p.promptId}`,
              tone: p.tone ?? 'neutral',
              tag: `⏳ ${p.title ?? '선택'}`,
              text: [`${names.length > 2 ? `${names.length}명` : names.join(', ')}의 선택을 기다리는 중…`],
              chips: [],
              cast: who ? [{ char: who }] : [],
              speaker: who?.id ?? null,
            });
          }
          return;
        }
        // 「전체」: the waiting screen after the board animation and earlier cut-ins have played
        const boardBusy = ui.b3 && (ui.b3.isBusy() || performance.now() - ui.lastStateAt < 380);
        if (boardBusy || cutin.busyEvents()) {
          ui.promptTimer = setTimeout(() => ui.room && renderModal(ui.room), 250);
          return;
        }
      }
    }
    if (!forMe.length && ui.cutinMode !== 'full' && cutin.promptId === p.promptId) {
      // I've answered (group prompt): 「간단히」/「끄기」 go back to the board; the dock shows who's still choosing
      if (!ui.promptCloseTimer) {
        ui.promptCloseTimer = setTimeout(() => {
          ui.promptCloseTimer = null;
          if (ui.room?.turn?.pending?.promptId === p.promptId && !myPendingChars(ui.room.turn.pending, chars()).length) cutin.closePrompt(p.promptId);
        }, 700);
      }
      return;
    }
    cutin.showPrompt(p, {
      characters: orderedChars(),
      forMe,
      room,
      urgent,
      onChoose: (b) => run({ type: 'choose', ...b }),
    });
  }

  function renderModal(room) {
    if (promptCutins()) {
      el.modal.hidden = true;
      ui.modalKey = null;
      return renderPromptCutin(room);
    }
    cutin.closePrompt();
    const p = room.status === 'playing' ? room.turn.pending : null;
    const forMe = myPendingChars(p, chars());
    if (forMe.length) cutin.preempt(); // queued spectator cut-ins must not keep playing under my decision
    if (!forMe.length) {
      el.modal.hidden = true;
      ui.modalKey = null;
      return;
    }
    const who = forMe[0];
    const key = `${p.promptId}:${who.id}`;
    if (key === ui.modalKey && !el.modal.hidden) return;
    // 3D: open a new decision only after the board animation (spin → hops → landing) has played.
    // (Switching to my next character within an already open prompt happens right away.)
    const samePrompt = !el.modal.hidden && ui.modalKey?.startsWith(`${p.promptId}:`);
    if (ui.b3 && !samePrompt) {
      // …but never longer than PROMPT_BOARD_WAIT_MS: my prompt opens over a still-animating board
      const age = performance.now() - promptSeenAt(p.promptId);
      const wait = age >= PROMPT_BOARD_WAIT_MS ? 0 : ui.b3.isBusy() ? 150 : 380 - (performance.now() - ui.lastStateAt);
      if (wait > 0) {
        el.modal.hidden = true; // never leave a stale prompt clickable meanwhile
        ui.modalKey = null;
        clearTimeout(ui.modalTimer);
        ui.modalTimer = setTimeout(() => ui.room && renderModal(ui.room), wait);
        return;
      }
    }
    ui.modalKey = key;
    const subject = byId(p.charId);
    el.modal.innerHTML = `
      <div class="g-sheet">
        <div class="sheet-who">${portraitHtml(who, { size: 56 })}<div><b>${esc(who.name)}</b>의 선택${
          forMe.length > 1 ? ` <span class="muted small">(내 캐릭터 ${forMe.length}명 남음)</span>` : ''
        }</div></div>
        <h2>${esc(p.title ?? '선택')}</h2>
        <p>${esc(p.text ?? '')}</p>
        ${subject && subject.id !== who.id ? `<p class="small muted">대상: ${esc(subject.name)}</p>` : ''}
        ${
          submapOptionsHtml(p, who, { meta: getMeta(), btnClass: 'btn choice', won }) != null
            ? `<div class="choice-list sm-choices">${submapOptionsHtml(p, who, { meta: getMeta(), btnClass: 'btn choice', won })}</div>`
            : p.kind === 'shop'
            ? `<div class="choice-list shop-choices">${shopOptionsHtml(p, who, { meta: getMeta(), artFor, btnClass: 'btn choice' })}</div>`
            : p.kind === 'house'
              ? `<div class="choice-list house-choices">${houseOptionsHtml(p, who, { meta: getMeta(), room, artFor, btnClass: 'btn choice' })}</div>`
              : familyOptionsHtml(p, who, { meta: getMeta(), btnClass: 'btn choice' }) != null
                ? `<div class="choice-list fam-choices">${familyOptionsHtml(p, who, { meta: getMeta(), btnClass: 'btn choice' })}</div>`
                : `<div class="choice-list">${p.options
          .map((o) => {
            const x = optionExtras(p, o, { jobs: getMeta()?.jobs });
            const badges = [...(x.salary != null ? [`💵 첫 월급 ${won(x.salary)}`] : []), ...x.badges];
            const icon = o.icon || x.icon || (p.kind === 'holiday' ? HOLIDAY_OPTION_ICON[o.id] ?? '' : '');
            return `<button type="button" class="btn choice" data-choose="${esc(o.id)}" data-prompt="${esc(p.promptId)}" data-char="${esc(who.id)}"${o.disabled ? ' disabled' : ''}>
                <span class="c-icon">${esc(icon)}</span><span class="c-label">${esc(optionLabel({ ...o, icon }))}${
                  routeOptionInfo(p, o) ? `<small class="c-desc">${esc(routeOptionInfo(p, o))}</small>` : ''
                }${badges.length ? `<span class="c-badges">${badges.map((b) => `<span class="c-badge">${esc(b)}</span>`).join('')}</span>` : ''}</span></button>`;
          })
          .join('')}</div>`
        }
        ${p.deadlineAt ? `<p class="small muted">남은 시간${deadlineHtml(p.deadlineAt)} — 시간이 지나면 기본 선택으로 처리돼요.</p>` : ''}
      </div>`;
    hydratePortraits(el.modal);
    el.modal.hidden = false;
    el.modal.querySelector('.choice')?.focus();
  }

  function tickDeadlines() {
    const off = clockOffset();
    for (const d of root.querySelectorAll('[data-deadline]')) {
      const left = secondsLeft(d.dataset.deadline, Date.now(), off);
      d.textContent = `${d.dataset.icon ? `${d.dataset.icon} ` : ''}${left}초`;
      d.classList.toggle('urgent', left <= 5);
    }
    // Stage 7: an offer ran out → drop it from the inbox
    if (!el.inbox.hidden && ui.room?.trades?.some((t) => Number(t.expiresAt) > 0 && Number(t.expiresAt) <= serverNow())) renderInbox(ui.room);
  }
  /** When this client first saw a prompt (3D: my prompt waits ≤ PROMPT_BOARD_WAIT_MS for the board). */
  function promptSeenAt(promptId) {
    if (ui.promptSeen.id !== promptId) ui.promptSeen = { id: promptId, at: performance.now(), bannered: null };
    return ui.promptSeen.at;
  }
  const ticker = setInterval(tickDeadlines, 250);
  queueMicrotask(() => applyModeUi());

  // ---------- interactions ----------
  root.addEventListener('click', (ev) => {
    const t = ev.target;
    if (stage7Click(t, ev)) return;
    const detail = t.closest('[data-char-detail]');
    if (detail) {
      const id = detail.dataset.charDetail;
      ui.openChar = ui.openChar === id ? null : id;
      if (ui.room) renderChars(ui.room);
      root.querySelector(`[data-char-detail="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
      return;
    }
    if (t.closest('[data-el="news"]')) {
      ui.newsOpen = !ui.newsOpen;
      el.newspop.hidden = !ui.newsOpen;
      el.news.setAttribute('aria-expanded', String(ui.newsOpen));
      return;
    }
    if (ui.newsOpen && !t.closest('[data-el="newspop"]')) {
      ui.newsOpen = false;
      el.newspop.hidden = true;
      el.news.setAttribute('aria-expanded', 'false');
    }
    const tab = t.closest('[data-era]');
    if (tab) {
      const i = Number(tab.dataset.era);
      const cur = currentChar();
      ui.viewEra = i === (cur?.position?.eraIndex ?? 0) ? null : i;
      ui.lastScrollKey = null;
      if (ui.b3) {
        if (ui.viewEra == null) ui.b3.resetCamera();
        else ui.b3.focusEra(i);
      }
      return render(ui.room);
    }
    if (t.closest('[data-el="modebtn"]')) {
      setBoardMode(ui.b3 || ui.b3Loading ? '2d' : '3d', { explicit: true });
      return;
    }
    if (t.closest('[data-el="soundbtn"]')) {
      audio.toggleMuted();
      return;
    }
    if (t.closest('[data-el="bgmbtn"]')) {
      audio.setBgm(!audio.state.bgm);
      return;
    }
    if (t.closest('[data-el="camreset"]')) {
      ui.viewEra = null;
      ui.b3?.resetCamera();
      return render(ui.room);
    }
    if (t.closest('[data-el="spin"]')) {
      const cur = currentChar();
      if (cur) run({ type: 'spin', characterId: cur.id });
      return;
    }
    const choice = t.closest('[data-choose]');
    if (choice) {
      run({ type: 'choose', characterId: choice.dataset.char, promptId: choice.dataset.prompt, optionId: choice.dataset.choose });
      return;
    }
    const pick = t.closest('[data-pick]');
    if (pick) {
      ui.bet.pick = pick.dataset.pick;
      return renderBets(ui.room);
    }
    if (t.closest('[data-bet="go"]')) {
      const p = betPicks(betCfg()).find((x) => x.pick === ui.bet.pick);
      if (!p || !ui.bet.turnKey) return;
      run({ type: 'bet', characterId: ui.bet.bettor, kind: p.kind, pick: p.pick, amount: ui.bet.amount }).then((ok) => ok && toast('훈수 베팅 완료!'));
    }
  });
  root.addEventListener('input', (ev) => {
    if (ev.target.dataset.tdMoney && ui.trade) {
      const side = ev.target.dataset.tdMoney;
      ui.trade[side].money = ev.target.value;
      refreshTradeCheck();
      return;
    }
    if (ev.target.dataset.bet === 'amount') {
      ui.bet.amount = Number(ev.target.value);
      const lbl = el.bet.querySelector('[data-bet="amt-label"]');
      if (lbl) lbl.textContent = won(ui.bet.amount);
      const go = el.bet.querySelector('[data-bet="go"]');
      const p = betPicks(betCfg()).find((x) => x.pick === ui.bet.pick) ?? { label: '' };
      if (go) go.textContent = `${go.textContent.startsWith('베팅 바꾸기') ? '베팅 바꾸기' : '베팅하기'} (${p.label} · ${won(ui.bet.amount)})`;
    }
  });
  root.addEventListener('change', (ev) => {
    if ('tdFrom' in ev.target.dataset && ui.trade) {
      ui.trade.fromId = ev.target.value;
      ui.trade.give.cardUid = null;
      renderTradeDlg();
      return;
    }
    if (ev.target.dataset.el === 'cutinmode') {
      setCutinMode(ev.target.value);
      return;
    }
    if (ev.target.dataset.el === 'quality') {
      ui.quality = ev.target.value;
      sSet(QUALITY_KEY, ui.quality);
      ui.b3?.setQuality(ui.quality);
      return;
    }
    if (ev.target.dataset.bet === 'bettor') {
      ui.bet.bettor = ev.target.value;
      renderBets(ui.room);
    }
  });

  /** Stage 7 clicks: hand cards, card sheet, trade / gift dialog, inbox. → true when handled. */
  function stage7Click(t, ev) {
    const cardBtn = t.closest('[data-card-uid]');
    if (cardBtn && el.hand.contains(cardBtn)) {
      openCardSheet(cardBtn.dataset.cardChar, cardBtn.dataset.cardUid);
      return true;
    }
    const handFor = t.closest('[data-hand-for]');
    if (handFor) {
      ui.handFor = handFor.dataset.handFor;
      renderHand(ui.room);
      return true;
    }
    if (el.cardsheet.contains(t)) {
      if (t === el.cardsheet || t.closest('[data-sheet-close]')) closeCardSheet();
      else if (t.closest('[data-card-target]') && ui.cardSheet) {
        const b = t.closest('[data-card-target]');
        if (!b.disabled) {
          ui.cardSheet.targetId = b.dataset.cardTarget;
          renderCardSheet();
        }
      } else if (t.closest('[data-card-use]')) useCard();
      return true;
    }
    const tOpen = t.closest('[data-trade-open]');
    if (tOpen) {
      openTrade('trade', tOpen.dataset.tradeOpen);
      return true;
    }
    const gOpen = t.closest('[data-gift-open]');
    if (gOpen) {
      openTrade('gift', gOpen.dataset.giftOpen);
      return true;
    }
    if (el.tradedlg.contains(t)) {
      const tr = ui.trade;
      if (t === el.tradedlg || t.closest('[data-td-close]')) closeTrade();
      else if (t.closest('[data-td-send]')) sendTrade();
      else if (tr && t.closest('[data-td-kind]')) {
        const b = t.closest('[data-td-kind]');
        const side = tr[b.dataset.tdSide];
        side.kind = b.dataset.tdKind;
        if (side.kind !== 'card') side.cardUid = null;
        renderTradeDlg();
        el.tradedlg.querySelector(`[data-td-money="${b.dataset.tdSide}"]`)?.focus({ preventScroll: true });
      } else if (tr && t.closest('[data-td-card]')) {
        const b = t.closest('[data-td-card]');
        tr[b.dataset.tdSide].cardUid = b.dataset.tdCard;
        renderTradeDlg();
      }
      return true;
    }
    const acc = t.closest('[data-trade-accept], [data-trade-reject]');
    if (acc) {
      const accept = 'tradeAccept' in acc.dataset;
      const tradeId = acc.dataset.tradeAccept ?? acc.dataset.tradeReject;
      for (const b of el.inbox.querySelectorAll(`[data-trade="${CSS.escape(tradeId)}"] button`)) b.disabled = true;
      run({ type: 'respondTrade', characterId: acc.dataset.char, tradeId, accept }).then((ok) => {
        if (!ok) {
          ui.inboxKey = '';
          renderInbox(ui.room);
        } else if (!accept) toast('🤝 거래를 거절했어요.');
      });
      return true;
    }
    const cancel = t.closest('[data-trade-cancel]');
    if (cancel) {
      cancel.disabled = true;
      run({ type: 'cancelTrade', characterId: cancel.dataset.char, tradeId: cancel.dataset.tradeCancel }).then((ok) => {
        if (ok) toast('🤝 거래 제안을 취소했어요.');
        else {
          ui.inboxKey = '';
          renderInbox(ui.room);
        }
      });
      return true;
    }
    void ev;
    return false;
  }

  /** 「관전 컷인」 전체 / 간단히 / 끄기 (remembered per device). */
  function setCutinMode(mode) {
    ui.cutinMode = normalizeCutinMode(mode);
    sSet(SPECTATOR_KEY, ui.cutinMode);
    sSet(CUTIN_KEY, null); // the legacy on/off switch is replaced by this setting
    if (ui.cutinMode !== 'full') cutin.clearQueue();
    if (ui.cutinMode === 'off') banner.clear();
    applySoundUi();
    toast(`🎬 관전 컷인: ${CUTIN_MODE_LABEL[ui.cutinMode]}${ui.cutinMode === 'compact' ? ' (큰 이벤트만 컷인, 나머지는 작은 알림)' : ''}`);
    if (ui.room) render(ui.room);
  }

  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (ui.cardSheet) closeCardSheet();
    else if (ui.trade) closeTrade();
  });

  // ---------- main render ----------
  function render(input) {
    if (!input?.board || !input.turn) return;
    // Stage 6: everything below draws the effective look (era / job costume); `rawRoom` keeps the server view
    const raw = rawOf.get(input) ?? input;
    const room = raw === ui.rawRoom && ui.room ? ui.room : displayRoom(raw);
    ui.rawRoom = raw;
    ui.room = room;
    const cur = currentChar();
    const followKey = `${room.turn.turnNo}`;
    if (followKey !== ui.followKey) {
      ui.followKey = followKey;
      ui.viewEra = null; // new turn → follow the current character again
    }
    if (room.id !== ui.roomId) {
      ui.roomId = room.id;
      ui.hudShown = false;
      ui.gameOver = false;
    }
    if (room.status !== 'playing') finish();
    if (room.version !== ui.lastVersion) {
      ui.lastVersion = room.version;
      ui.lastStateAt = performance.now();
      // 3D: re-render once the grace window for the matching SSE `events` has passed
      clearTimeout(ui.graceTimer);
      ui.graceTimer = setTimeout(() => ui.room && ui.b3 && !ui.b3.isBusy() && render(ui.room), 420);
    }
    // a new turn: the previous turn's events / cut-ins are still on their way → the spin button waits for
    // them (2D: TURN_GRACE_MS or until the event cut-ins close) instead of popping up under a cut-in
    const turnKey = `${room.turn.turnNo}:${room.turn.currentIndex}`;
    if (turnKey !== ui.turnKey) {
      ui.turnKey = turnKey;
      ui.turnAt = performance.now();
      clearTimeout(ui.turnTimer);
      ui.turnTimer = setTimeout(() => ui.room?.status === 'playing' && render(ui.room), TURN_GRACE_MS + 20);
    }
    const shown = Math.min(ui.viewEra ?? cur?.position?.eraIndex ?? 0, room.board.eras.length - 1);
    if (!ui.b3 && !ui.b3Loading && !ui.b3Failed && wants3D()) ensureBoard3D();
    // 3D: keep the header / character panel / log on the previous state until the board has played the
    // events (no spoilers while the roulette spins); onIdle and the grace timer render again.
    const holdHud = ui.b3 && ui.hudShown && (ui.b3.isBusy() || cutin.busyEvents() || performance.now() - ui.lastStateAt < 400);
    const bgmEra = room.board.eras[cur?.position?.eraIndex ?? 0]?.id;
    if (bgmEra) audio.setEra(bgmEra);
    preloadLayers();
    root.classList.toggle('spectator', isSpectator());
    if (!holdHud) {
      renderTop(room);
      renderTabs(room, shown);
    }
    if (ui.b3) sync3D(room);
    else renderTrack(room, shown);
    const holdSpin = !!holdHud || cutin.busyEvents() || performance.now() - (ui.turnAt ?? 0) < TURN_GRACE_MS;
    renderSpin(room, { hold: holdSpin });
    renderHand(room, { hold: holdSpin });
    renderBets(room, { hold: holdSpin });
    if (ui.cardSheet) renderCardSheet();
    if (ui.trade) {
      const handsKey = [ui.trade.fromId, ui.trade.toId].map((id) => (byId(id)?.cards ?? []).map((k) => k.uid).join(',')).join('|');
      if (room.status !== 'playing' || !byId(ui.trade.toId)) closeTrade();
      else if (ui.trade.handsKey != null && ui.trade.handsKey !== handsKey) {
        ui.trade.handsKey = handsKey;
        renderTradeDlg(); // a card moved → fresh card lists (the check names a card that's gone)
      } else {
        ui.trade.handsKey = handsKey;
        refreshTradeCheck();
      }
    }
    renderInbox(room);
    flushDeferred();
    if (!holdHud) {
      renderChars(room);
      renderLog(room);
      ui.hudShown = true;
    }
    renderModal(room);
    tickDeadlines();
    if (!ui.b3) requestAnimationFrame(() => scrollToCurrent(room));
  }

  // ---------- 3D board ----------
  function wants3D() {
    if (ui.pref === '2d') return false;
    if (ui.pref === '3d') return true;
    return !sGet(FALLBACK_KEY, 'session') && webglAvailable();
  }

  function applyModeUi() {
    const on = !!(ui.b3 || ui.b3Loading);
    root.classList.toggle('is3d', on);
    root.dataset.quality = ui.quality;
    el.wrap3d.hidden = !on;
    el.scroll.hidden = on;
    el.camreset.hidden = !on || !QUALITY_PRESETS[ui.quality]?.controls;
    el.quality.hidden = !on;
    el.quality.value = ui.quality;
    el.modebtn.textContent = on ? '2D 보기' : '3D 보기';
    el.modebtn.setAttribute('aria-pressed', String(!on));
  }

  function fallback2D(message) {
    disposeBoard3D();
    ui.b3Failed = true;
    applyModeUi();
    if (ui.room) render(ui.room);
    if (message) toast(message, 'error');
  }

  function disposeBoard3D() {
    try {
      ui.b3?.dispose();
    } catch {
      /* ignore */
    }
    if (ui.b3 && window.__board3d === ui.b3) window.__board3d = null;
    ui.b3 = null;
    ui.b3Loading = null;
    ui.lastFocusEra = null;
    if (!el.canvas3d.isConnected) return;
    // a disposed WebGL canvas cannot get a fresh context reliably → swap in a new element
    const fresh = el.canvas3d.cloneNode(false);
    el.canvas3d.replaceWith(fresh);
    el.canvas3d = fresh;
  }

  function ensureBoard3D() {
    if (ui.b3 || ui.b3Loading) return ui.b3Loading;
    const auto = ui.pref !== '3d';
    ui.b3Loading = (async () => {
      applyModeUi();
      try {
        const { createBoard3D } = await import('./scene/board3d.js');
        if (!ui.b3Loading) return; // switched back to 2D meanwhile
        const b3 = createBoard3D(el.canvas3d, {
          quality: ui.quality,
          meta: getMeta(),
          hooks: {
            onStep: (e) => feedback(e, true),
            onRouletteTap: () => {
              const cur = currentChar();
              if (cur?.isMe && ui.room?.turn?.phase === 'awaitSpin' && !ui.room.turn.pending) run({ type: 'spin', characterId: cur.id });
            },
            onError: (err) => console.warn('[board3d]', err),
          },
        });
        ui.b3 = b3;
        installCutinHandlers(b3);
        b3.onIdle(() => ui.room && ui.room.status === 'playing' && render(ui.room));
        if (typeof window !== 'undefined' && params.has('debug')) window.__board3d = b3;
        applyModeUi();
        if (ui.room) render(ui.room);
        if (auto) {
          const fps = await b3.measureFps(FPS_PROBE_MS);
          if (ui.b3 === b3 && shouldFallback(fps, 1000, fpsMin)) {
            sSet(FALLBACK_KEY, '1', 'session');
            fallback2D(`3D 화면이 느려서(${fps.toFixed(0)}fps) 2D 보드로 바꿨어요. 「3D 보기」로 다시 켤 수 있어요.`);
          }
        }
      } catch (err) {
        console.warn('[board3d] init failed', err);
        fallback2D('이 기기에서는 3D 보드를 켤 수 없어 2D 보드로 보여 드려요.');
      } finally {
        if (ui.b3Loading && !ui.b3) ui.b3Loading = null;
      }
    })();
    return ui.b3Loading;
  }

  /**
   * 3D: after the board's own animation of a cut-in-worthy event, pause the animator, show the cut-in and
   * resume on close. Also hooks hop/landing sounds.
   */
  function installCutinHandlers(b3) {
    const anim = b3.animator;
    for (const type of CUTIN_TYPES) {
      const orig = anim.getHandler(type);
      anim.setHandler(type, async (e, ctx) => {
        if (type === 'landed' && !ctx.instant) audio.play('pop');
        if (type === 'promptResolved') feedback(e, true);
        if (orig) await orig(e, ctx);
        const g = ui.cutinGroups.get(e);
        if (!g) return;
        ui.cutinGroups.delete(e);
        if (ctx.instant || !cutinsOn() || ui.b3 !== b3 || ui.gameOver) return;
        // policy decides at play time (my prompt may have arrived meanwhile → banner, no pause)
        const kind = classifyGroup(g, { mine: myIds(), mode: ui.cutinMode, promptForMe: promptForMe(), gameOver: ui.gameOver, queued: cutin.size(), globalOff: !cutinsOn() });
        if (kind !== 'full') {
          // 'defer' (Stage 7 lotto / holiday result under my prompt) is queued by presentGroup
          presentGroup(g);
          return;
        }
        anim.pause();
        showGroup(g).finally(() => anim.resume());
      });
    }
    // Stage 5.6: MC corner lines + mascot reactions once the event's own animation has played
    for (const type of MC_CORNER_TYPES) {
      const orig = anim.getHandler(type);
      anim.setHandler(type, async (e, ctx) => {
        if (!ctx.instant && e?.mc?.length && mcOn()) b3.mascotReact?.(e.mcWeight === 'big' ? 'spin' : 'hop');
        if (orig) await orig(e, ctx);
        if (ui.mcCornerEvents.has(e)) {
          ui.mcCornerEvents.delete(e);
          if (!ctx.instant) mcFeedback(e);
        }
      });
    }
    const moved = anim.getHandler('moved');
    anim.setHandler('moved', (e, ctx) => {
      if (!ctx.instant) audio.play('whoosh');
      return moved?.(e, ctx);
    });
  }

  function setBoardMode(mode, { explicit = false } = {}) {
    if (explicit) {
      ui.pref = mode;
      sSet(MODE_KEY, mode);
      if (mode === '3d') sSet(FALLBACK_KEY, null, 'session');
    }
    if (mode === '2d') {
      disposeBoard3D();
      applyModeUi();
      ui.lastScrollKey = null;
      if (ui.room) render(ui.room);
    } else {
      ui.b3Failed = false;
      ensureBoard3D();
    }
  }

  function subtitleFor(room, cur) {
    if (!cur) return '';
    const p = room.turn.pending;
    if (cur.finished) return `🏁 ${cur.name} 골인 · 보너스 룰렛`;
    if (p) {
      const waiting = p.forCharacterIds.filter((id) => !p.answered?.includes(id)).map((id) => byId(id)?.name ?? id);
      return `${cur.isMe ? '내 차례' : `${cur.name}의 차례`} · ${p.title ?? '선택'} (${waiting.join(', ')} 선택 중)`;
    }
    if (cur.isMe) return `⭐ 내 차례! ${cur.name}의 룰렛을 돌리세요`;
    return `${cur.name}의 차례 · 룰렛 대기 중`;
  }

  function sync3D(room) {
    const b3 = ui.b3;
    const cur = currentChar();
    b3.setBoard(room.board);
    // Stage 7: roulette modifiers ride on the pawn's name tag (「✂️−3」「⚡+2」)
    // Stage 8: 💍 / 👶n / 🏠 ride on it too (no extra draw calls: the name tag is one sprite)
    b3.setCharacters(
      chars().map((c) => {
        const badge = [...spinModBadges(c.spinMods).map((b) => b.text), familyTagBadge(c)].filter(Boolean).join(' ');
        return badge ? { ...c, tagBadge: badge } : c;
      }),
    );
    const canSpin = !!cur?.isMe && room.turn.phase === 'awaitSpin' && !room.turn.pending;
    b3.setCurrent(cur?.id ?? null, {
      mine: !!cur?.isMe,
      subtitle: subtitleFor(room, cur),
      rouletteIdle: room.turn.phase === 'awaitSpin' && !room.turn.pending && !cur?.finished,
      rouletteTappable: canSpin,
    });
    b3.setMascots?.(mcOn());
    if (ui.viewEra == null && ui.lastFocusEra != null) b3.resetCamera();
    ui.lastFocusEra = ui.viewEra;
  }

  // ---------- engine events → feedback ----------
  function floatOn(charId, text, kind) {
    const row = el.chars.querySelector(`[data-id="${CSS.escape(charId)}"]`);
    if (!row) return;
    const f = document.createElement('span');
    f.className = `gc-float ${kind}`;
    f.textContent = text;
    row.appendChild(f);
    f.addEventListener('animationend', () => f.remove());
  }

  function showRoulette(value, name) {
    const pop = el.pop;
    pop.hidden = false;
    pop.innerHTML = `<div class="rp-name">${esc(name)}의 룰렛</div><div class="rp-num">?</div>`;
    const num = pop.querySelector('.rp-num');
    el.dial.classList.add('rolling');
    let n = 0;
    const iv = setInterval(() => {
      n++;
      const v = n < 10 ? 1 + ((n * 7) % 10) : value;
      num.textContent = String(v);
      el.dial.textContent = String(v);
      if (n >= 10) {
        clearInterval(iv);
        num.classList.add('final');
        el.dial.classList.remove('rolling');
        setTimeout(() => (pop.hidden = true), 900);
      }
    }, 60);
  }

  function onEvents(payload) {
    const events = payload?.events ?? [];
    // Stage 9: 👑 MVP decided (finished room → the result screen)
    if (events.some((e) => e.type === 'mvpDecided')) resultScreen.onEvents(events);
    // Stage 7: trade offers are not board events → notify the receiver right away (the inbox has the buttons)
    for (const e of events) {
      if (e.type !== 'tradeOffered') continue;
      const to = byId(e.toId);
      if (to?.isMe && !byId(e.fromId)?.isMe) {
        audio.play('pop');
        toast(`🤝 ${byId(e.fromId)?.name ?? ''}이(가) ${to.name}에게 거래를 제안했어요!`);
      }
      ui.inboxKey = '';
    }
    const go = events.find((e) => e.type === 'gameOver');
    if (go) {
      ui.gameOverLine = go.line ?? null;
      finish(); // straight to the MC result intro: no more spectator cut-ins / banners
    }
    // gameOver is shown as the result screen's intro instead of a board cut-in; one turn's events of another
    // character merge into a single cut-in (e.g. landing + era change)
    const groups = cutinsOn() && !ui.gameOver ? mergeGroups(planCutins(events).filter((g) => g.anchor.type !== 'gameOver'), { mine: myIds() }) : [];
    // Stage 5.6 MCs: game start → studio cut-in; lines not shown inside a cut-in → board corner booth
    const covered = new Set(groups.flatMap((g) => g.mcEvents ?? []));
    const start = events.find((e) => e.type === 'gameStarted' && e.mc?.length);
    const corner = events.filter((e) => e.mc?.length && e.type !== 'gameStarted' && e.type !== 'gameOver' && !covered.has(e));
    const hidden = typeof document !== 'undefined' && document.hidden;
    if (start && mcOn() && !hidden) {
      if (cutinsOn() && start.mcStudio) cutin.show(studioSpecFor(start.mc, start));
      else mcFeedback(start);
      ui.b3?.mascotReact?.('spin');
    }
    if (ui.b3) {
      // the merged cut-in plays after the last merged anchor's board animation
      for (const g of groups) ui.cutinGroups.set(g.anchors?.at(-1) ?? g.anchor, g);
      for (const e of corner) ui.mcCornerEvents.add(e);
      ui.b3.playEvents(events);
      return;
    }
    for (const e of events) feedback(e, false);
    if (hidden || ui.gameOver) return;
    for (const g of groups) presentGroup(g); // full / banner / skip (spectator backlog capped by policy)
    for (const e of corner) mcFeedback(e);
  }

  /** Game over / finished room: drop every pending cut-in, banner and MC line; controls are locked. */
  function finish() {
    if (ui.gameOver) return;
    ui.gameOver = true;
    clearTimeout(ui.promptTimer);
    cutin.hide();
    banner.clear();
    mcCorner.clear();
    el.spin.hidden = true;
    el.spin.disabled = true;
    el.dock.classList.remove('can-spin');
    document.body.classList.remove('spin-docked');
    el.bet.hidden = true;
    el.modal.hidden = true;
    ui.modalKey = null;
    el.hand.hidden = true;
    closeCardSheet();
    closeTrade();
    el.inbox.hidden = true;
    document.body.classList.remove('has-inbox');
    ui.deferred.length = 0;
    // 3D: the last turn's hops may still play, but the result screen follows within ~FINISH_BOARD_MS
    if (ui.b3) {
      const anim = ui.b3.animator;
      anim.resume();
      clearTimeout(ui.finishTimer);
      ui.finishTimer = setTimeout(() => {
        anim.clear();
        anim.resume();
      }, FINISH_BOARD_MS);
    }
  }

  /** Per-event feedback (toasts / side-panel floats); in 3D it is called by the animator in sync. */
  function feedback(e, in3d) {
    const c = e.charId ? byId(e.charId) : null;
    if (e.type === 'spun') audio.rouletteTicks(in3d ? 2300 : 650);
    else if (!in3d && (e.type === 'moved' || e.type === 'landed')) audio.play(e.type === 'moved' ? 'whoosh' : 'pop');
    else audio.playEvent(e);
    {
      switch (e.type) {
        case 'spun':
          if (!in3d) showRoulette(e.value, c?.name ?? '');
          if (e.halved && Number.isFinite(e.steps) && e.steps !== e.value) floatOn(e.charId, `🪖 ${e.steps}칸만 이동`, 'minus');
          else if (spinNote(e)) floatOn(e.charId, spinNote(e).text, spinNote(e).steps < e.value ? 'minus' : 'plus');
          if (e.auto) toast(`⏰ 시간 초과! ${c?.name ?? ''}의 룰렛을 자동으로 돌렸어요.`);
          break;
        case 'moneyChanged':
          floatOn(e.charId, `${EMOTION[e.emotion] ?? ''}${e.delta > 0 ? '+' : ''}${won(e.delta)}`, e.delta > 0 ? 'plus' : 'minus');
          break;
        case 'eraChanged':
          if (c?.isMe && !in3d && !cutinsOn()) toast(`🌱 ${c.name}: ${e.eraName} 시대 시작!`);
          break;
        case 'routeChosen': {
          const r = routes()[e.route];
          if (!cutinsOn() || ui.cutinMode === 'off') toast(`${r?.icon ?? ''} ${c?.name ?? ''} → ${r?.name ?? e.route} 루트`);
          break;
        }
        case 'finished':
          if (!in3d && !cutinsOn()) toast(`🏁 ${c?.name ?? ''} ${e.place}등 골인!`);
          break;
        case 'betResolved':
          for (const r of e.results) {
            const b = byId(r.charId);
            if (b?.isMe) toast(`${r.won ? '🤑 훈수 적중!' : '😅 훈수 꽝…'} ${b.name} ${r.delta > 0 ? '+' : ''}${won(r.delta)}`, r.won ? 'info' : 'error');
          }
          break;
        case 'bonusSpin':
          floatOn(e.charId, `🎰 ${e.value}`, 'plus');
          break;
        // ---------- Stage 6 ----------
        case 'statChanged': {
          const info = STAT_INFO[e.stat];
          if (info && e.delta) floatOn(e.charId, `${info.icon}${info.label} ${e.delta > 0 ? '+' : ''}${e.delta}`, e.delta > 0 ? 'plus stat' : 'minus stat');
          break;
        }
        case 'salary':
          floatOn(e.charId, '💵 월급날!', 'plus');
          break;
        case 'newsFlash':
          noteNews(e);
          flashNews(e);
          if (ui.room) renderNews(ui.room, characterEra(currentChar(), ui.room));
          break;
        case 'jobChanged':
        case 'rankUp':
        case 'hiddenJobUnlocked':
        case 'injured':
        case 'militaryStart':
        case 'militaryEnd':
        case 'educationChanged':
          if (!cutinsOn() || (!c?.isMe && ui.cutinMode === 'off')) toast(stage6Toast(e, c));
          break;
        case 'gameOver':
          if (!cutinsOn()) toast('🏆 게임 종료! 결과 발표'); // else the result intro cut-in announces it
          break;
        // ---------- Stage 7 ----------
        case 'cardGained': {
          const info = cardInfo(e.cardId, getMeta());
          floatOn(e.charId, `🃏 ${info.name}`, 'plus');
          if (c?.isMe && (!cutinsOn() || e.source === 'gift' || e.source === 'trade')) toast(`🃏 ${c.name}: ${info.icon} ${info.name} 카드를 얻었어요!`);
          break;
        }
        case 'cardUsed': {
          const info = cardInfo(e.cardId, getMeta());
          if (e.targetId) {
            floatOn(e.targetId, `💢 ${info.name}`, 'minus');
            const tgt = byId(e.targetId);
            if (tgt?.isMe && (!cutinsOn() || ui.cutinMode === 'off')) toast(`💢 ${c?.name ?? ''}이(가) ${tgt.name}에게 「${info.name}」 카드를 썼어요!`, 'error');
          } else floatOn(e.charId, `${info.icon} ${info.name}`, 'plus');
          break;
        }
        case 'cardBlocked':
          floatOn(e.targetId ?? e.charId, '🛡️ 방어!', 'plus');
          if (!cutinsOn()) toast(`🛡️ ${byId(e.targetId)?.name ?? ''}의 변호사가 뒤통수를 막았어요!`);
          break;
        case 'itemBought': {
          const info = itemInfo(e.itemId, getMeta());
          floatOn(e.charId, `🛍️ ${info.name}`, 'plus');
          if (!cutinsOn() && c?.isMe) toast(`🛍️ ${c.name}: ${info.icon} ${info.name} 구매!`);
          break;
        }
        case 'gift': {
          const what = Number(e.money) > 0 ? won(e.money) : e.cardId ? cardInfo(e.cardId, getMeta()).name : '';
          floatOn(e.toId, `🎁 ${what}`, 'plus');
          if (byId(e.toId)?.isMe && !byId(e.fromId)?.isMe) toast(`🎁 ${byId(e.fromId)?.name ?? ''} → ${byId(e.toId)?.name ?? ''}: ${what} 선물!`);
          break;
        }
        case 'tradeResolved': {
          if (e.status === 'accepted') {
            floatOn(e.fromId, '🤝 거래 성사', 'plus');
            floatOn(e.toId, '🤝 거래 성사', 'plus');
          }
          const from = byId(e.fromId);
          if (from?.isMe && e.status !== 'accepted') toast(`🤝 ${byId(e.toId)?.name ?? ''}와의 거래가 ${TRADE_STATUS[e.status] ?? '끝'}됐어요.`, e.status === 'rejected' ? 'error' : 'info');
          else if ((from?.isMe || byId(e.toId)?.isMe) && e.status === 'accepted') toast('🤝 거래 성사!');
          ui.inboxKey = '';
          break;
        }
        case 'holidayStarted':
          if (!cutinsOn()) toast(`${holidayTitle(e.kind)} 시작!`);
          break;
        case 'lottoDraw':
          if (!cutinsOn()) {
            const hit = (e.entries ?? []).filter((x) => Number(x.prize) > 0 && byId(x.charId)?.isMe);
            toast(hit.length ? `🎱 로또 당첨! ${hit.map((x) => `${byId(x.charId)?.name ?? ''} ${won(x.prize)}`).join(', ')}` : `🎱 전국 로또 추첨: ${(e.numbers ?? []).join(', ')}`);
          }
          break;
        // ---------- Stage 8 ----------
        case 'met':
        case 'dated':
        case 'proposed':
        case 'married':
        case 'childBorn':
        case 'childGrew':
        case 'houseBought': {
          const t = stage8Float(e);
          if (t) floatOn(e.charId, t.text, t.kind);
          if (c?.isMe && (!cutinsOn() || (e.type === 'dated' && ui.cutinMode === 'off'))) toast(stage8Toast(e, c));
          else if (!c?.isMe && ui.cutinMode === 'off' && ['married', 'childBorn', 'houseBought'].includes(e.type)) toast(stage8Toast(e, c));
          break;
        }
        case 'allowance':
          floatOn(e.charId, `💌 용돈 +${won(Number(e.amount) || 0)}`, 'plus');
          break;
        case 'houseSold':
          floatOn(e.charId, `🔁 보상판매${Number(e.amount ?? e.price) ? ` +${won(Number(e.amount ?? e.price))}` : ''}`, 'plus');
          break;
        case 'schoolMeet':
          for (const pr of e.pairs ?? []) floatOn(pr.charId, `💘 ${pr.partner?.name ?? ''}`, 'plus');
          if (!cutinsOn()) toast('🏫 고등학교에서 운명의 첫 만남!');
          break;
        // ---------- Stage 9 ----------
        case 'submapEntered': {
          const info = submapInfo(submapOf(e), getMeta());
          floatOn(e.charId, `${info.icon} ${info.name}`, 'plus');
          if (c?.isMe && !cutinsOn()) toast(`${info.icon} ${c.name}: ${info.name} 도착!`);
          break;
        }
        case 'submapResult': {
          const info = submapInfo(submapOf(e), getMeta());
          const ok = submapSuccess(e);
          const amt = Number(e.amount);
          floatOn(e.charId, `${info.icon} ${amt ? `${amt > 0 ? '+' : ''}${won(amt)}` : ok === false ? '꽝' : ok ? '성공!' : info.name}`, ok === false || amt < 0 ? 'minus' : 'plus');
          if (c?.isMe && !cutinsOn()) toast(`${info.icon} ${c.name}: ${info.name} ${ok === false ? '결과는 꽝…' : ok ? '대성공!' : '다녀왔어요'}`);
          break;
        }
        case 'treasureFound': {
          const t = treasureInfo(e.treasureId, getMeta());
          floatOn(e.charId, `💎 ${t.name}`, 'plus');
          if (c?.isMe && (!cutinsOn() || ui.cutinMode === 'off')) toast(`💎 ${c.name}: ${t.icon} ${t.name} 발견! 감정은 게임이 끝나면…`);
          break;
        }
        case 'houseValueChanged': {
          const mk = marketInfo(e);
          if (mk && (!cutinsOn() || ui.cutinMode === 'off')) toast(`🏠 부동산 ${mk.text}`, mk.dir === 'down' ? 'error' : 'info');
          break;
        }
        default:
          break;
      }
    }
  }

  /** Stage 8 side-list floats. */
  function stage8Float(e) {
    switch (e.type) {
      case 'met':
        return { text: `💘 ${e.partner?.name ?? '새 인연'}`, kind: 'plus' };
      case 'dated':
        return { text: '💑 데이트', kind: 'plus' };
      case 'proposed':
        return e.success ? { text: '💍 프러포즈 성공!', kind: 'plus' } : { text: '💔 거절…', kind: 'minus' };
      case 'married':
        return { text: '💒 결혼!', kind: 'plus' };
      case 'childBorn':
        return { text: `👶 ${e.child?.name ?? '아기'} 탄생`, kind: 'plus' };
      case 'childGrew':
        return { text: `${{ dol: '🎂 돌잔치', school: '🎒 입학', exam: '📝 자녀 수능', job: '💼 자녀 취업' }[e.kind] ?? '🧒 성장'}`, kind: Number(e.amount) < 0 ? 'minus' : 'plus' };
      case 'houseBought':
        return { text: `🏠 ${houseInfo(e.houseId, getMeta())?.name ?? '집'}`, kind: 'plus' };
      default:
        return null;
    }
  }

  function stage8Toast(e, c) {
    const name = c?.name ?? '';
    switch (e.type) {
      case 'met':
        return `💘 ${name}: ${e.partner?.name ?? '새로운 인연'}을(를) 만났어요!`;
      case 'dated':
        return `💑 ${name}의 데이트!`;
      case 'proposed':
        return e.success ? `💍 ${name} 프러포즈 성공!` : `💔 ${name} 프러포즈 실패…`;
      case 'married':
        return `💒 ${name} 결혼! 축의금 ${won(Number(e.total) || 0)}`;
      case 'childBorn':
        return `👶 ${name}네 아기 ${e.child?.name ?? ''} 탄생!`;
      case 'childGrew':
        return `${stage8Float(e)?.text ?? '🧒'} — ${name}네 아이`;
      case 'houseBought':
        return `🏠 ${name}: ${houseInfo(e.houseId, getMeta())?.name ?? '집'} 구매!`;
      default:
        return '';
    }
  }

  function stage6Toast(e, c) {
    const name = c?.name ?? '';
    const info = e.jobId ? jobInfo(e.jobId, getMeta()?.jobs) : null;
    const job = info ? `${info.icon} ${info.name}` : '';
    switch (e.type) {
      case 'jobChanged':
        return `💼 ${name} → ${job || '새 직업'}`;
      case 'rankUp':
        return `🎉 ${name} 승진! ${job}${e.rankName ? ` ${e.rankName}` : ''}`;
      case 'hiddenJobUnlocked':
        return `🌟 ${name}: 숨은 직업 ${job} 해금!`;
      case 'injured':
        return `🤕 ${name} 부상${e.turns ? ` (${e.turns}턴)` : ''}`;
      case 'militaryStart':
        return `🪖 ${name} 입대!${e.turns ? ` ${e.turns}턴 복무` : ''}`;
      case 'militaryEnd':
        return `🎖️ ${name} 전역!`;
      case 'educationChanged':
        return `🎓 ${name} ${educationLabel(e.education) || '졸업'}!`;
      default:
        return '';
    }
  }

  /** SSE reaction → floating emoji above that player's pawns (3D only). */
  function onReaction(r) {
    audio.play('pop');
    cutin.reaction(r); // chip under the cut-in window (spectators react to the current event)
    if (!ui.b3 || !r?.playerId) return false;
    const ids = chars()
      .filter((c) => c.ownerId === r.playerId)
      .map((c) => c.id);
    if (ids.length) ui.b3.reaction(ids, r.emoji);
    return ids.length > 0;
  }

  // ---------- results (Stage 9: 인생 결산 방송 + podium + MVP + 단체 사진 — ui/resultShow.js) ----------
  const resultScreen = createResultScreen({
    getMeta,
    cutin,
    act,
    toast,
    artFor,
    findAsset,
    mcOn,
    want3D: () => wants3D(),
    now: () => Date.now() + clockOffset(),
    // ranking-row extras: final job + education, items, house / family
    rowExtras: (r, c) => {
      const jb = c ? jobBadge(c, getMeta()?.jobs) : null;
      const edu = educationLabel(c?.education);
      const career = jb || edu
        ? `<span class="rk-career">${jb ? `<span class="job-badge${jb.partTime ? ' parttime' : ''}"><span class="jb-ic">${jbIcon(jb)}</span><span class="jb-n">${esc(jb.name)}</span>${jb.stars ? `<span class="jb-stars">${esc(jb.stars)}</span>` : ''}</span>` : ''}${
            edu ? `<span class="gc-tag">🎓 ${esc(edu)}</span>` : ''
          }</span>`
        : '';
      return `${career}${itemsLine(r, c)}${familyLine(r, c)}`;
    },
  });
  if (params.has('debug')) window.__result = resultScreen;

  function renderResult(input, host) {
    const room = displayRoom(input);
    resultScreen.render(room, host, { autoplay: cutinsOn() });
  }

  /** Stage 7 result row: item icons (resale value is in the money line). */
  function itemsLine(r, c) {
    const items = itemsOf(c, getMeta());
    if (!items.length) return '';
    return `<span class="rk-items" title="아이템 되팔기 가치${Number(r.items) > 0 ? ` ${won(r.items)}` : ''}">${items
      .map((i) => `<span class="rk-item">${itemIconHtml(i.id, { art: artFor('item', i.id), meta: getMeta() })}<small>${esc(i.info.name)}</small></span>`)
      .join('')}</span>`;
  }

  /** Stage 8 result row: 🏠 house (art · name · value) + family (💍 spouse, children, 🌟 genius). */
  function familyLine(r, c) {
    const meta = getMeta();
    const h = c ? houseOf(c, meta) : null;
    const value = Number(r.house) > 0 ? Number(r.house) : h?.value ?? 0;
    const icons = c ? familyIcons(c) : '';
    const fam = c ? familySummary(c, meta).replace(/^💍 /, '') : ''; // the icons already show the 💍
    if (!h && !icons) return '';
    return `<span class="rk-family">${
      h ? `<span class="rk-house" title="${esc(`${h.name} · 자산가치 ${won(value)}`)}">${houseArtHtml(h.id, { art: artFor('house', h.id), label: h.name, cls: 'rk-house-art' })}<small>${esc(h.name)} ${esc(won(value))}</small></span>` : ''
    }${icons ? `<span class="rk-kids" title="${esc(fam)}"><span class="rk-ic">${esc(icons)}</span>${fam ? `<small>${esc(fam)}</small>` : ''}</span>` : ''}</span>`;
  }

  const gameApi = {
    render,
    onEvents,
    /** The room as drawn (Stage 6: characters wear their effective era / job costume). */
    get room() {
      return ui.room;
    },
    onReaction,
    renderResult,
    /** Stage 9: the result screen / show (play, skip, reset on leave). */
    result: resultScreen,
    /** True while the 3D board is still animating events (result screen waits for it). */
    isBusy: () => !!ui.b3?.isBusy() || cutin.busyEvents(),
    /** Resolves once the board animation and the event cut-ins have finished (prompt cut-ins are closed). */
    async whenIdle() {
      cutin.closePrompt();
      for (let i = 0; i < 20; i++) {
        await (ui.b3?.whenIdle() ?? Promise.resolve());
        if (cutin.busy()) await cutin.whenIdle();
        if (!ui.b3?.isBusy() && !cutin.busy()) return;
      }
    },
    /** Stage 5: the cut-in controller (show/queue/showPrompt/reaction…). */
    cutin,
    audio,
    /** Stage 5 hook: the animator (pause/resume/enqueue) of the 3D board, or null in 2D. */
    get animator() {
      return ui.b3?.animator ?? null;
    },
    get board3d() {
      return ui.b3;
    },
    setBoardMode,
    destroy() {
      clearInterval(ticker);
      clearTimeout(ui.modalTimer);
      clearTimeout(ui.promptTimer);
      cutin.destroy();
      mcCorner.destroy();
      clearTimeout(ui.graceTimer);
      clearTimeout(ui.finishTimer);
      clearTimeout(ui.turnTimer);
      banner.destroy();
      resultScreen.destroy();
      disposeBoard3D();
    },
  };
  if (params.has('debug')) window.__game = gameApi; // E2E: inject rooms / events (?debug=1 only)
  return gameApi;
}
