// Game screen UI. Renders the masked room view from the server: HUD, character panel, log, side bets,
// decision modals, and the board — the Three.js 3D board (Stage 4, scene/board3d.js) when WebGL works
// and the user hasn't chosen 2D, else the 2D simple track (Stage 2). Engine events (SSE `events`) go to
// the 3D animator (which calls back into `feedback` at the right moment) or straight to 2D feedback.
// Stage 5: cut-in-worthy events (`cutin: true`) open the 2D cut-in (ui/cutin2d.js) after the board's own
// animation (3D: animator paused meanwhile), prompts use the cut-in dialogue box, sounds via audio.js.
import { renderAvatar, preloadAvatarLayers, portraitHtml, hydratePortraits } from './ui/avatar2d.js';
import { createCutin } from './ui/cutin2d.js';
import { createBanner } from './ui/banner.js';
import { planCutins, tagLabel } from './ui/cutinMap.js';
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
import { createMcCorner, mcHash, resultMcFrom } from './ui/mc.js';
import { audio } from './audio.js';
import { loadAssetIndex, findAsset, assetUrl } from './assets.js';
import { won, esc, secondsLeft } from './format.js';
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
const CUTIN_TYPES = ['landed', 'eraChanged', 'routeChosen', 'finished', 'promptResolved', ...STAGE6_CUTIN_TYPES];
/** Animated event types that may carry MC lines shown in the board corner (Stage 5.6). */
const MC_CORNER_TYPES = ['turnStarted', 'landed', 'moneyChanged', 'betResolved', 'promptResolved', 'routeChosen', 'finished', 'eraChanged', 'gameOver', ...STAGE6_CUTIN_TYPES, 'salary', 'statChanged'];
/** Stage 6 tile types the server may send before board.json knows them (meta wins). */
const CLIENT_TILE_TYPES = {
  habit: { name: '습관', icon: '📚', color: '#20a39e' },
  salary: { name: '월급', icon: '💵', color: '#3fae5a' },
  job: { name: '직업', icon: '💼', color: '#4f8ee0' },
};
const RESULT_LINES = ['두근두근… 인생 결산 시간!', '누가 제일 잘 살았을까?', '다들 수고했어, 멋진 인생이었어', '결과 발표 갑니다~!'];
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
const MEDAL = ['🥇', '🥈', '🥉'];

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
    resultIntroFor: null,
    gameOverLine: null,
    openChar: null, // Stage 6: character detail card open in the side list
    newsSeen: {}, // Stage 6: eraId → {title, text, tone} from newsFlash events (before meta.news knows it)
    newsOpen: false,
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

  /** A cut-in group, preceded by the MC studio cut-in when it opens an era (Stage 5.6). */
  function showGroup(g) {
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
      tone: anchor?.type === 'gameStarted' ? 'holiday' : 'good',
      title: anchor?.type === 'gameStarted' ? '🎙️ 인생 방송국 · 생방송 시작' : `🎙️ ${era} 시대 개막`,
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
      <span class="now-text"><b>${esc(cur.name)}</b>의 차례 <span class="muted small">(${esc(cur.ownerName)}${cur.isMe ? ' · 나' : ''} · ${phase})</span></span>`;
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
      const steps = Number.isFinite(last.steps) && last.steps !== last.value ? ` <small>(🪖 복무 중 ${last.steps}칸 이동)</small>` : '';
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
            <span class="gc-name">${esc(c.name)} <small class="muted">${esc(c.ownerName)}${c.isMe ? ' · 나' : ''}</small></span>
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
        `<span class="job-badge${jb.partTime ? ' parttime' : ''}${jb.hidden ? ' hidden-job' : ''}" title="${esc(`${jb.name}${jb.rankName ? ` · ${jb.rankName}` : ''} (${jb.rank}/${jb.maxRank})`)}"><span class="jb-ic">${esc(jb.icon)}</span><span class="jb-n">${esc(jb.name)}</span>${
          jb.stars ? `<span class="jb-stars">${esc(jb.stars)}</span>` : ''
        }</span>`,
      );
      if (jb.injured) out.push(`<span class="gc-tag bad" title="부상">🤕 ${jb.injured}턴</span>`);
    }
    const edu = educationLabel(c.education);
    if (edu) out.push(`<span class="gc-tag">🎓 ${esc(edu)}</span>`);
    const mil = militaryLabel(c.military);
    if (mil && c.military?.status === 'serving') out.push(`<span class="gc-tag mil">🪖 ${esc(mil)}</span>`);
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
        `<div class="gd-fact"><span class="gd-k">직업</span><span class="gd-v"><span class="job-badge big${jb.partTime ? ' parttime' : ''}"><span class="jb-ic">${esc(jb.icon)}</span><span class="jb-n">${esc(jb.name)}</span>${
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
    if (!rows.length && !facts.length) facts.push('<p class="muted small">능력치·직업 정보가 아직 없어요.</p>');
    return `<div class="gc-detail" id="gcd-${esc(c.id)}">${rows.join('')}${facts.length ? `<div class="gd-facts">${facts.join('')}</div>` : ''}</div>`;
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
        <div class="choice-list">${p.options
          .map((o) => {
            const x = optionExtras(p, o, { jobs: getMeta()?.jobs });
            const badges = [...(x.salary != null ? [`💵 첫 월급 ${won(x.salary)}`] : []), ...x.badges];
            return `<button type="button" class="btn choice" data-choose="${esc(o.id)}" data-prompt="${esc(p.promptId)}" data-char="${esc(who.id)}">
                <span class="c-icon">${esc(o.icon || x.icon || '')}</span><span class="c-label">${esc(optionLabel({ ...o, icon: o.icon || x.icon }))}${
                  routeOptionInfo(p, o) ? `<small class="c-desc">${esc(routeOptionInfo(p, o))}</small>` : ''
                }${badges.length ? `<span class="c-badges">${badges.map((b) => `<span class="c-badge">${esc(b)}</span>`).join('')}</span>` : ''}</span></button>`;
          })
          .join('')}</div>
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
    renderBets(room, { hold: holdSpin });
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
    b3.setCharacters(chars());
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
        default:
          break;
      }
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

  // ---------- results ----------
  function renderResult(input, host) {
    const room = displayRoom(input);
    const ranking = room.result?.ranking ?? [];
    const cmap = new Map((room.characters ?? []).map((c) => [c.id, c]));
    if (!ranking.length) {
      host.innerHTML = '<p class="muted">순위 정보가 없어요.</p>';
      return;
    }
    const intro = ui.resultIntroFor !== room.id && cutinsOn();
    host.innerHTML = `
      ${room.result.forced ? '<p class="small muted">관리자가 게임을 종료했어요. 현재 자산 기준 순위입니다.</p>' : ''}
      <ol class="ranking${intro ? ' reveal' : ''}">${ranking
        .map((r) => {
          const c = cmap.get(r.charId);
          const routesTxt = (c?.routeHistory ?? []).map((h) => routes()[h.route]?.icon ?? '').join(' ');
          const jb = c ? jobBadge(c, getMeta()?.jobs) : null;
          const edu = educationLabel(c?.education);
          const career = jb || edu
            ? `<span class="rk-career">${jb ? `<span class="job-badge${jb.partTime ? ' parttime' : ''}"><span class="jb-ic">${esc(jb.icon)}</span><span class="jb-n">${esc(jb.name)}</span>${jb.stars ? `<span class="jb-stars">${esc(jb.stars)}</span>` : ''}</span>` : ''}${
                edu ? `<span class="gc-tag">🎓 ${esc(edu)}</span>` : ''
              }</span>`
            : '';
          return `<li class="rank-row${r.rank === 1 ? ' first' : ''}${c?.isMe ? ' me' : ''}">
            <span class="rk">${MEDAL[r.rank - 1] ?? `${r.rank}위`}</span>
            <span class="rk-portrait">${c ? portraitHtml(c, { size: 52 }) : ''}</span>
            <span class="rk-body"><b>${esc(r.name)}</b> <small class="muted">${esc(c?.ownerName ?? '')}</small>${career}
              <span class="small muted">현금 ${won(r.money)}${r.debt ? ` · 빚 ${won(r.debt)}` : ''} · 골인 보너스 ${won(r.goalBonus)}${
                r.place ? ` · ${r.place}번째 골인` : ''
              }${routesTxt ? ` · 루트 ${routesTxt}` : ''}</span></span>
            <span class="rk-total">${won(r.total)}</span>
          </li>`;
        })
        .join('')}</ol>`;
    hydratePortraits(host);
    if (intro) showResultIntro(room, ranking, cmap);
  }

  /** Cut-in style 「결과 발표」 intro (tone result) before the ranking list. */
  function showResultIntro(room, ranking, cmap) {
    ui.resultIntroFor = room.id;
    cutin.closePrompt();
    const top = ranking.slice(0, 3).map((r) => cmap.get(r.charId)).filter(Boolean);
    const first = ranking[0];
    const order = (room.turn?.order ?? []).map((id) => cmap.get(id)).filter(Boolean);
    const line = ui.gameOverLine ?? RESULT_LINES[(room.id.charCodeAt(0) + ranking.length) % RESULT_LINES.length];
    const spec = {
      key: `result:${room.id}`,
      kind: 'result',
      tone: 'result',
      scene: 'mountain-trail',
      tag: tagLabel({ type: 'result', tone: 'result' }, { tones: getMeta()?.presentation?.tones }),
      who: '결과 발표',
      text: [
        `🏆 1등은 ${first?.name ?? ''}! 총자산 ${won(first?.total ?? 0)}`,
        ranking
          .slice(1, 3)
          .map((r) => `${MEDAL[r.rank - 1] ?? `${r.rank}위`} ${r.name} ${won(r.total)}`)
          .join(' · '),
      ].filter(Boolean),
      line,
      speaker: first?.charId ?? null,
      chips: ranking.slice(0, 3).map((r) => ({ text: `${MEDAL[r.rank - 1] ?? ''} ${r.name}`, kind: r.rank === 1 ? 'plus' : '' })),
      cast: top.map((c, i) => ({ char: c, pose: i === 0 ? 'cheer' : 'wave', emotion: i === 0 ? 'joy' : null })),
      bigWin: true,
      currentId: first?.charId ?? null,
      era: '',
      autoMs: 6500,
      characters: order.length ? order : [...cmap.values()],
    };
    const list = document.querySelector('.ranking.reveal');
    // Stage 5.6: MC-hosted — studio intro (봄이 announces, 호야 reacts), then the podium with winner/last lines
    const mc = mcOn() ? room.result?.mc ?? resultMcFrom(getMeta()?.mc, ranking, { seed: mcHash(room.id, 'result'), won }) : [];
    const intro = mc.filter((l) => l.part === 'intro');
    const rest = mc.filter((l) => l.part !== 'intro');
    const jobs = [];
    if (intro.length) jobs.push(cutin.show(cutin.studioSpec(intro, { key: `result:${room.id}`, tone: 'result', title: '🏆 결과 발표', characters: spec.characters })));
    if (rest.length) {
      spec.mc = rest;
      spec.line = null; // the MCs host the podium
    }
    jobs.push(cutin.show(spec));
    Promise.all(jobs).finally(() => list?.classList.add('shown'));
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
      disposeBoard3D();
    },
  };
  if (params.has('debug')) window.__game = gameApi; // E2E: inject rooms / events (?debug=1 only)
  return gameApi;
}
