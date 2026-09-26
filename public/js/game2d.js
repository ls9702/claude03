// Game screen UI. Renders the masked room view from the server: HUD, character panel, log, side bets,
// decision modals, and the board — the Three.js 3D board (Stage 4, scene/board3d.js) when WebGL works
// and the user hasn't chosen 2D, else the 2D simple track (Stage 2). Engine events (SSE `events`) go to
// the 3D animator (which calls back into `feedback` at the right moment) or straight to 2D feedback.
// Stage 5: cut-in-worthy events (`cutin: true`) open the 2D cut-in (ui/cutin2d.js) after the board's own
// animation (3D: animator paused meanwhile), prompts use the cut-in dialogue box, sounds via audio.js.
import { renderAvatar, preloadAvatarLayers, portraitHtml, hydratePortraits } from './ui/avatar2d.js';
import { createCutin } from './ui/cutin2d.js';
import { planCutins, tagLabel } from './ui/cutinMap.js';
import { createMcCorner, mcHash, resultMcFrom } from './ui/mc.js';
import { audio } from './audio.js';
import { loadAssetIndex, findAsset, assetUrl } from './assets.js';
import { won, esc } from './format.js';
import { pickQuality, QUALITY_PRESETS, shouldFallback } from './scene/quality.js';

export { won };

const MODE_KEY = 'jinsei.boardMode'; // '2d' | '3d' (explicit choice); absent = auto
const QUALITY_KEY = 'jinsei.quality';
const CUTIN_KEY = 'jinsei.cutins'; // 'off' = board-only (toasts + decision modal)
const CUTIN_TYPES = ['landed', 'eraChanged', 'routeChosen', 'finished', 'promptResolved'];
/** Animated event types that may carry MC lines shown in the board corner (Stage 5.6). */
const MC_CORNER_TYPES = ['turnStarted', 'landed', 'moneyChanged', 'betResolved', 'promptResolved', 'routeChosen', 'finished', 'eraChanged', 'gameOver'];
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
const PICKS = [
  { kind: 'oddEven', pick: 'odd', label: '홀' },
  { kind: 'oddEven', pick: 'even', label: '짝' },
  { kind: 'range', pick: '1-3', label: '1~3' },
  { kind: 'range', pick: '4-7', label: '4~7' },
  { kind: 'range', pick: '8-10', label: '8~10' },
];
const PICK_LABEL = Object.fromEntries(PICKS.map((p) => [p.pick, p.label]));
const MEDAL = ['🥇', '🥈', '🥉'];

function tileIdAt(board, pos) {
  if (!pos || pos.index < 0) return 'start';
  const era = board.eras[pos.eraIndex];
  const track = pos.route === 'main' ? era?.tiles : era?.routes?.[pos.route]?.tiles;
  return track?.[pos.index]?.id ?? 'start';
}

/**
 * @param {HTMLElement} root  container inside #screen-game
 * @param {{ getMeta: () => object, act: (body) => Promise<void>, toast: (msg, kind?) => void }} deps
 */
export function createGameUI(root, { getMeta, act, toast }) {
  root.innerHTML = `
    <div class="g-top card">
      <div class="g-era-line"><span class="era-chip" data-el="era"></span><span class="muted small" data-el="turninfo"></span></div>
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
              <button type="button" class="btn tiny ghost tool-toggle" data-el="cutinbtn" aria-pressed="true" title="이벤트 컷인 연출 켜기/끄기">🎬 컷인</button>
              <button type="button" class="btn tiny ghost tool-toggle" data-el="bgmbtn" aria-pressed="true" title="배경음악 켜기/끄기">🎵 BGM</button>
              <button type="button" class="btn tiny ghost tool-toggle" data-el="soundbtn" aria-pressed="false" aria-label="소리 켜기/끄기">🔊</button>
            </div>
          </div>
          <div class="board3d" data-el="wrap3d" hidden><canvas class="board3d-canvas" data-el="canvas3d" aria-label="3D 말판"></canvas></div>
          <div class="track-scroll" data-el="scroll"><div class="track" data-el="track"></div></div>
        </div>
        <div class="card g-action">
          <div class="spin-box">
            <div class="spin-dial" data-el="dial" aria-live="polite">?</div>
            <div class="spin-ctl">
              <button type="button" class="btn primary spin-btn" data-el="spin">🎡 룰렛 돌리기</button>
              <p class="spin-hint" data-el="hint"></p>
            </div>
          </div>
          <div class="bet-panel" data-el="bet" hidden></div>
        </div>
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
    cutinPref: modeParamCutin(params) ?? sGet(CUTIN_KEY), // 'off' | null
    cutinGroups: new WeakMap(), // engine event (animator step) → cut-in group
    mcCornerEvents: new WeakSet(), // 3D: events whose MC lines go to the corner when the animator plays them
    promptTimer: null,
    assetsReady: false,
    preloaded: new Set(),
    resultIntroFor: null,
    gameOverLine: null,
  };

  // ---------- Stage 5: cut-ins + sound ----------
  const cutin = createCutin(document.body, { getMeta, assets: { findAsset, assetUrl }, audio });
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
  audio.onChange(() => applySoundUi());
  const cutinsOn = () => ui.cutinPref !== 'off';
  const hasCutinArt = () => !!(findAsset({ kind: 'frame' }) || findAsset({ kind: 'bg' }));
  /** Prompts use the cut-in dialogue box in 3D, or in 2D once generated art exists; else the modal. */
  const promptCutins = () => cutinsOn() && (!!ui.b3 || hasCutinArt());
  const orderedChars = () => (ui.room?.turn?.order ?? []).map((id) => byId(id)).filter(Boolean);
  const cutinOpts = () => ({ characters: orderedChars(), room: ui.room });

  function applySoundUi() {
    const st = audio.state;
    el.soundbtn.textContent = st.muted ? '🔇' : '🔊';
    el.soundbtn.setAttribute('aria-pressed', String(st.muted));
    el.soundbtn.title = st.muted ? '소리 켜기' : '소리 끄기';
    el.bgmbtn.setAttribute('aria-pressed', String(st.bgm));
    el.bgmbtn.classList.toggle('off', !st.bgm);
    el.cutinbtn.setAttribute('aria-pressed', String(cutinsOn()));
    el.cutinbtn.classList.toggle('off', !cutinsOn());
  }
  queueMicrotask(applySoundUi);

  /** Warm the compositor caches in the background: neutral + blink for everyone, common expressions after. */
  function preloadLayers() {
    if (!ui.assetsReady || !cutinsOn()) return;
    const todo = chars().filter((c) => !ui.preloaded.has(`${c.id}|${c.art?.status ?? ''}`));
    if (!todo.length) return;
    for (const c of todo) ui.preloaded.add(`${c.id}|${c.art?.status ?? ''}`);
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

  /** A cut-in group, preceded by the MC studio cut-in when it opens an era (Stage 5.6). */
  function showGroup(g) {
    const jobs = [];
    if (g.studio && mcOn()) jobs.push(cutin.show(studioSpecFor(g.studio, g.anchor)));
    jobs.push(cutin.show(mcOn() ? g : { ...g, mc: null }, cutinOpts()));
    return Promise.all(jobs);
  }

  function studioSpecFor(lines, anchor) {
    const era = anchor?.type === 'eraChanged' ? anchor.eraName ?? '' : '';
    return cutin.studioSpec(lines, {
      key: `${anchor?.type ?? 'mc'}:${anchor?.era ?? ''}:${anchor?.charId ?? ''}`,
      tone: anchor?.type === 'gameStarted' ? 'holiday' : 'good',
      title: anchor?.type === 'gameStarted' ? '🎙️ 인생 방송국 · 생방송 시작' : `🎙️ ${era} 시대 개막`,
      era: era ? `${era} 시대` : '',
      characters: orderedChars(),
      currentId: anchor?.charId ?? null,
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
  const betCfg = () => getMeta()?.balance?.bets ?? { minAmount: 5, maxAmount: 20, payout: { oddEven: 2, range: 3 } };

  async function run(body) {
    if (ui.busy) return false;
    ui.busy = true;
    root.classList.add('busy');
    try {
      await act(body);
      return true;
    } catch (err) {
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
    return `<div class="pawns">${list
      .map(
        (c) =>
          `<span class="pawn${c.id === curId ? ' cur' : ''}${c.isMe ? ' me' : ''}" title="${esc(c.name)}" data-char="${esc(c.id)}">${renderAvatar(c.avatar, { size: 26, title: c.name })}</span>`,
      )
      .join('')}</div>`;
  }

  function tileHtml(t, pawns, curId, style = '') {
    const meta = getMeta()?.board?.tileTypes?.[t.type] ?? {};
    const amt =
      t.type === 'money' ? `<span class="t-amt plus">+${won(t.amount)}</span>` : t.type === 'loss' ? `<span class="t-amt minus">-${won(t.amount)}</span>` : '';
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
  function renderSpin(room) {
    const cur = currentChar();
    const turn = room.turn;
    const canSpin = !!cur?.isMe && turn.phase === 'awaitSpin' && !turn.pending;
    el.spin.hidden = !canSpin;
    el.spin.disabled = !canSpin; // in-flight requests are blocked via the .busy class
    el.spin.textContent = cur ? `🎡 ${cur.name} 룰렛 돌리기` : '🎡 룰렛 돌리기';
    const last = turn.lastSpin;
    if (!el.dial.classList.contains('rolling')) el.dial.textContent = last ? String(last.value) : '?';
    let hint = '';
    if (turn.pending) {
      const waiting = turn.pending.forCharacterIds.filter((id) => !turn.pending.answered?.includes(id)).map((id) => byId(id)?.name ?? id);
      hint = `⏳ ${esc(turn.pending.title ?? '선택')} — ${esc(waiting.join(', '))} 선택 기다리는 중${deadlineHtml(turn.pending)}`;
    } else if (canSpin) {
      hint = '내 차례예요! 룰렛을 돌리세요.';
    } else if (cur) {
      hint = `${esc(cur.ownerName)}님이 「${esc(cur.name)}」의 룰렛을 돌리기를 기다리는 중…`;
    }
    // 3D: don't spoil the roulette result before the wheel stops (render again on idle)
    const spoiler = ui.b3 && (ui.b3.isBusy() || performance.now() - ui.lastStateAt < 400);
    if (last && !spoiler) {
      const who = byId(last.charId);
      hint = `<span class="last-spin">최근 룰렛: ${esc(who?.name ?? '')} ${last.value}</span><br>${hint}`;
    }
    el.hint.innerHTML = hint;
  }

  function deadlineHtml(p) {
    return p?.deadlineAt ? ` <span class="deadline" data-deadline="${p.deadlineAt}"></span>` : '';
  }

  function renderBets(room) {
    const cur = currentChar();
    const turn = room.turn;
    const mine = chars().filter((c) => c.isMe);
    const open = cur && !cur.isMe && turn.phase === 'awaitSpin' && !turn.pending && mine.length > 0;
    el.bet.hidden = !open;
    if (!open) return;
    const cfg = betCfg();
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
      <div class="bet-picks" role="group" aria-label="베팅 선택">${PICKS.map(
        (p) =>
          `<button type="button" class="bet-pick${p.pick === ui.bet.pick ? ' on' : ''}" data-pick="${p.pick}">${p.label}<small>×${cfg.payout[p.kind]}</small></button>`,
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
    el.chars.innerHTML = order
      .map((c) => {
        const r = c.route ? routes()[c.route] : null;
        const status = c.finished ? `🏁 ${c.place}등 골인` : `${esc(eraName(c))}${r ? ` · ${esc(r.icon)} ${esc(r.name)}` : ''}`;
        return `<li class="g-char${c.id === cur?.id ? ' cur' : ''}${c.isMe ? ' me' : ''}${c.finished ? ' done' : ''}" data-id="${esc(c.id)}">
          <span class="gc-portrait">${portraitHtml(c, { size: 40 })}</span>
          <span class="gc-body">
            <span class="gc-name">${esc(c.name)} <small class="muted">${esc(c.ownerName)}${c.isMe ? ' · 나' : ''}</small></span>
            <span class="gc-status small">${status}</span>
          </span>
          <span class="gc-money"><b>${won(c.money)}</b>${c.debt > 0 ? `<small class="debt">빚 ${won(c.debt)}</small>` : ''}</span>
        </li>`;
      })
      .join('');
    hydratePortraits(el.chars);
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
    const p = room.turn.pending;
    clearTimeout(ui.promptTimer);
    if (!p) return cutin.closePrompt();
    if (cutin.promptId && cutin.promptId !== p.promptId) cutin.closePrompt();
    const answered = new Set(p.answered ?? []);
    const forMe = p.forCharacterIds.map(byId).filter((c) => c?.isMe && !answered.has(c.id));
    if (cutin.promptId !== p.promptId) {
      // open only after the board animation (spin → hops → landing) and earlier cut-ins have played
      const boardBusy = ui.b3 && (ui.b3.isBusy() || performance.now() - ui.lastStateAt < 380);
      if (boardBusy || cutin.busyEvents()) {
        ui.promptTimer = setTimeout(() => ui.room && renderModal(ui.room), 250);
        return;
      }
    }
    cutin.showPrompt(p, {
      characters: orderedChars(),
      forMe,
      room,
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
    const p = room.turn.pending;
    const answered = new Set(p?.answered ?? []);
    const forMe = p ? p.forCharacterIds.map(byId).filter((c) => c?.isMe && !answered.has(c.id)) : [];
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
      const wait = ui.b3.isBusy() ? 250 : 380 - (performance.now() - ui.lastStateAt);
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
          .map(
            (o) =>
              `<button type="button" class="btn choice" data-choose="${esc(o.id)}" data-prompt="${esc(p.promptId)}" data-char="${esc(who.id)}">
                <span class="c-icon">${esc(o.icon ?? '')}</span>${esc(o.label ?? o.id)}</button>`,
          )
          .join('')}</div>
        ${p.deadlineAt ? `<p class="small muted">남은 시간 <span class="deadline" data-deadline="${p.deadlineAt}"></span> — 시간이 지나면 기본 선택으로 처리돼요.</p>` : ''}
      </div>`;
    hydratePortraits(el.modal);
    el.modal.hidden = false;
    el.modal.querySelector('.choice')?.focus();
  }

  function tickDeadlines() {
    for (const d of root.querySelectorAll('[data-deadline]')) {
      const left = Math.max(0, Math.ceil((Number(d.dataset.deadline) - Date.now()) / 1000));
      d.textContent = `${left}초`;
    }
  }
  const ticker = setInterval(tickDeadlines, 250);
  queueMicrotask(() => applyModeUi());

  // ---------- interactions ----------
  root.addEventListener('click', (ev) => {
    const t = ev.target;
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
    if (t.closest('[data-el="cutinbtn"]')) {
      ui.cutinPref = cutinsOn() ? 'off' : 'on';
      sSet(CUTIN_KEY, ui.cutinPref === 'off' ? 'off' : null);
      if (!cutinsOn()) cutin.hide();
      applySoundUi();
      toast(cutinsOn() ? '🎬 이벤트 컷인을 켰어요.' : '이벤트 컷인을 껐어요. (말판 연출만)');
      return render(ui.room);
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
      const p = PICKS.find((x) => x.pick === ui.bet.pick);
      run({ type: 'bet', characterId: ui.bet.bettor, kind: p.kind, pick: p.pick, amount: ui.bet.amount }).then((ok) => ok && toast('훈수 베팅 완료!'));
    }
  });
  root.addEventListener('input', (ev) => {
    if (ev.target.dataset.bet === 'amount') {
      ui.bet.amount = Number(ev.target.value);
      const lbl = el.bet.querySelector('[data-bet="amt-label"]');
      if (lbl) lbl.textContent = won(ui.bet.amount);
      const go = el.bet.querySelector('[data-bet="go"]');
      const p = PICKS.find((x) => x.pick === ui.bet.pick);
      if (go) go.textContent = `${go.textContent.startsWith('베팅 바꾸기') ? '베팅 바꾸기' : '베팅하기'} (${p.label} · ${won(ui.bet.amount)})`;
    }
  });
  root.addEventListener('change', (ev) => {
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

  // ---------- main render ----------
  function render(room) {
    if (!room?.board || !room.turn) return;
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
    }
    if (room.version !== ui.lastVersion) {
      ui.lastVersion = room.version;
      ui.lastStateAt = performance.now();
      // 3D: re-render once the grace window for the matching SSE `events` has passed
      clearTimeout(ui.graceTimer);
      ui.graceTimer = setTimeout(() => ui.room && ui.b3 && !ui.b3.isBusy() && render(ui.room), 420);
    }
    const shown = Math.min(ui.viewEra ?? cur?.position?.eraIndex ?? 0, room.board.eras.length - 1);
    if (!ui.b3 && !ui.b3Loading && !ui.b3Failed && wants3D()) ensureBoard3D();
    // 3D: keep the header / character panel / log on the previous state until the board has played the
    // events (no spoilers while the roulette spins); onIdle and the grace timer render again.
    const holdHud = ui.b3 && ui.hudShown && (ui.b3.isBusy() || cutin.busyEvents() || performance.now() - ui.lastStateAt < 400);
    const bgmEra = room.board.eras[cur?.position?.eraIndex ?? 0]?.id;
    if (bgmEra) audio.setEra(bgmEra);
    preloadLayers();
    if (!holdHud) {
      renderTop(room);
      renderTabs(room, shown);
    }
    if (ui.b3) sync3D(room);
    else renderTrack(room, shown);
    renderSpin(room);
    renderBets(room);
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
        if (ctx.instant || !cutinsOn() || ui.b3 !== b3) return;
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
    if (go) ui.gameOverLine = go.line ?? null;
    // gameOver is shown as the result screen's intro instead of a board cut-in
    const groups = cutinsOn() ? planCutins(events).filter((g) => g.anchor.type !== 'gameOver') : [];
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
      for (const g of groups) ui.cutinGroups.set(g.anchor, g);
      for (const e of corner) ui.mcCornerEvents.add(e);
      ui.b3.playEvents(events);
      return;
    }
    for (const e of events) feedback(e, false);
    if (hidden) return;
    for (const g of groups) {
      if (cutin.size() > 5) break; // backlog → skip (toasts / log still tell the story)
      showGroup(g);
    }
    for (const e of corner) mcFeedback(e);
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
          break;
        case 'moneyChanged':
          floatOn(e.charId, `${EMOTION[e.emotion] ?? ''}${e.delta > 0 ? '+' : ''}${won(e.delta)}`, e.delta > 0 ? 'plus' : 'minus');
          break;
        case 'eraChanged':
          if (c?.isMe && !in3d) toast(`🌱 ${c.name}: ${e.eraName} 시대 시작!`);
          break;
        case 'routeChosen': {
          const r = routes()[e.route];
          toast(`${r?.icon ?? ''} ${c?.name ?? ''} → ${r?.name ?? e.route} 루트`);
          break;
        }
        case 'finished':
          if (!in3d) toast(`🏁 ${c?.name ?? ''} ${e.place}등 골인!`);
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
        case 'gameOver':
          if (!cutinsOn()) toast('🏆 게임 종료! 결과 발표'); // else the result intro cut-in announces it
          break;
        default:
          break;
      }
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
  function renderResult(room, host) {
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
          return `<li class="rank-row${r.rank === 1 ? ' first' : ''}${c?.isMe ? ' me' : ''}">
            <span class="rk">${MEDAL[r.rank - 1] ?? `${r.rank}위`}</span>
            <span class="rk-portrait">${c ? portraitHtml(c, { size: 52 }) : ''}</span>
            <span class="rk-body"><b>${esc(r.name)}</b> <small class="muted">${esc(c?.ownerName ?? '')}</small>
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

  return {
    render,
    onEvents,
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
      disposeBoard3D();
    },
  };
}
