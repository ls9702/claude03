// Game page controller: join → lobby → game (game2d.js: 3D board with 2D fallback) → result.
import {
  api,
  connectEvents,
  ensureSession,
  getMeta,
  lastSseMessageAt,
  onNetwork,
  savedName,
  sseConnected,
  sseSuperseded,
  storageMode,
  savedRoomId,
  setSavedName,
  setSavedRoomId,
} from './api.js';
import { NAME_MAX, cleanName, cpuHandicapText, cpuPersonalityHtml, cpuPersonalityOptions, josa, nameFits, ownerHtml } from './format.js';
import { bindNameInput } from './ui/nameInput.js';
import { worldInfo, worldMeta, worldOf } from './shared/world.js';
import { modeSummary, scrollCue } from './ui/lobbyText.js';
import { createGameUI } from './game2d.js';
// Chiikawa conversion (CH-1): roster characters + props (ui/chara.js renderer, ui/picker.js); the human paper-doll /
// AI-art modules (ui/avatar2d.js, avatarCompose.js, customize.js, charArt.js) are legacy and no longer called here.
import { hydratePortraits, portraitHtml, setCharaMeta } from './ui/chara.js';
import { openCharaPicker } from './ui/picker.js';
import { loadAssetIndex } from './assets.js';
import { MC_NAMES, mcLinesFrom, renderMc } from './ui/mc.js';
import { closePhotoDialogs } from './ui/groupPhoto.js';
import { repairScrollLock } from './ui/scrollLock.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const state = {
  meta: null,
  room: null,
  closeEvents: null,
  customizer: null, // { destroy, charId|null }
  screen: null,
  sheetAutoOpened: false,
  seenChars: new Set(), // ids already rendered → no pop-in replay on re-render
  game: null, // 2D board UI (createGameUI)
};

/**
 * 세계 설정: /api/meta of the current room's world (🐹 치이카와 모드 / 🏙️ 현실 모드: jobs, items, cards, treasures, news,
 * tile labels, MC lines …) — lobby, game, cut-ins, result; outside a room the base meta.
 */
const roomMeta = (room = state.room) => (room ? worldMeta(state.meta, worldOf(room)) : state.meta);

/** Accept a room view unless it is older than the one we already show (SSE vs. POST response races). */
function acceptRoom(r) {
  const cur = state.room;
  if (cur && r && cur.id === r.id && (r.version ?? 0) < (cur.version ?? 0)) return false;
  state.room = r;
  return true;
}

// ---------- toast / screens ----------
let toastTimer;
function toast(msg, kind = 'info', ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.dataset.kind = kind;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/** 👀 관전 (spectator seat, Stage fix): no characters / spin / bet / choose — board, cut-ins, log, reactions. */
const isSpectator = (room = state.room) => room?.me?.role === 'spectator';
const playersOnly = (room) => (room?.players ?? []).filter((p) => p.role !== 'spectator');

function applyRole() {
  const spec = !!state.room && isSpectator();
  document.body.classList.toggle('spectator', spec);
  $('#spec-badge').hidden = !spec || state.screen === 'join';
}

function showScreen(name) {
  if (state.screen === name) return applyRole();
  state.screen = name;
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== `screen-${name}`;
  const inRoom = name !== 'join';
  $('#room-badge').hidden = !inRoom;
  $('#conn').hidden = !inRoom;
  $('#leave-btn').hidden = !inRoom;
  $('#reaction-bar').hidden = !(name === 'lobby' || name === 'game');
  document.body.dataset.screen = name;
  applyRole();
}

function setConn(kind) {
  const el = $('#conn');
  const off = typeof navigator !== 'undefined' && navigator.onLine === false;
  // superseded (≥ 4 tabs of this session in the room): this tab's stream stopped for good until 「다시 연결」
  const gone = kind === 'gone' || (kind !== 'ok' && !!sseSuperseded());
  const k = gone ? 'bad' : kind === 'ok' && off ? 'bad' : kind;
  el.dataset.kind = k;
  el.textContent = gone ? '● 다시 연결' : k === 'ok' ? '● 연결됨' : off ? '● 오프라인 · 재연결 중…' : '● 재연결 중…';
  el.classList.toggle('gone', gone);
  if (gone) {
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    el.title = '다른 탭에서 열려 있어 연결을 멈췄어요 · 눌러서 이 탭으로 다시 연결';
  } else {
    el.removeAttribute('role');
    el.removeAttribute('tabindex');
    el.removeAttribute('title');
  }
}
/** 「다시 연결」: this tab takes the room stream back (the server then retires the oldest other tab of this session). */
function reclaimStream() {
  if (!sseSuperseded() || !state.room) return;
  enterRoom(state.room);
}

// ---------- connection watchdog (A9) ----------
// The server's SSE heartbeat is a comment (invisible to EventSource), so a dead connection (Wi-Fi gone, laptop lid)
// can look open for minutes. After WATCHDOG_QUIET_MS without a message the page probes the server: a network failure
// flips the badge to 「재연결 중…」 and reopens the stream; the browser's offline / online events act at once.
const WATCHDOG_QUIET_MS = 35000;
const WATCHDOG_PROBE_EVERY_MS = 30000;
let lastProbeAt = 0;
async function watchdogTick() {
  if (!state.room || state.screen === 'join' || sseSuperseded()) return;
  if (navigator.onLine === false) return setConn('bad');
  const quiet = Date.now() - Math.max(lastSseMessageAt(), state.connectedAt ?? 0);
  if (quiet < WATCHDOG_QUIET_MS || Date.now() - lastProbeAt < WATCHDOG_PROBE_EVERY_MS) return;
  lastProbeAt = Date.now();
  try {
    await api('GET', '/api/session');
    setConn(sseConnected() ? 'ok' : 'bad');
  } catch (err) {
    if (err.status) return; // the server answered (4xx): the connection itself works
    setConn('bad');
    reconnect();
  }
}
function reconnect() {
  const room = state.room;
  if (!room) return;
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = setTimeout(() => state.room?.id === room.id && enterRoom(state.room), 1500);
}
setInterval(() => watchdogTick(), 5000);
window.addEventListener('offline', () => state.room && setConn('bad'));
// a request that fails at the network level flips the badge at once; the next SSE message / answered probe restores it
onNetwork((ok) => {
  if (!state.room || state.screen === 'join') return;
  if (!ok) setConn('bad');
});
/** Any SSE message proves the stream is alive (clears a 「재연결 중…」 left by a failed request / the watchdog). */
function markAlive() {
  if ($('#conn')?.dataset.kind !== 'ok' && navigator.onLine !== false && sseConnected()) setConn('ok');
}
window.addEventListener('online', () => {
  if (!state.room || sseSuperseded()) return;
  setConn('bad');
  reconnect(); // a fresh stream (its first message is the current state)
});

// ---------- browser back / forward (A: back must not drop a player out of the game) ----------
// In a room the page keeps one extra history entry. The first Back pops it and stays (toast: press again to leave);
// a second Back within BACK_AGAIN_MS really leaves the page — the room is kept (saved id), so returning / reloading
// resumes it. A page restored from the back-forward cache reconnects (its stream was closed) and re-arms the guard.
const BACK_AGAIN_MS = 3000;
let lastBackAt = 0;
function armBackGuard() {
  try {
    if (!history.state?.jinseiRoom) history.pushState({ jinseiRoom: true }, '');
  } catch {
    /* history unavailable */
  }
}
window.addEventListener('popstate', () => {
  if (!state.room || state.screen === 'join') return;
  const now = Date.now();
  if (now - lastBackAt < BACK_AGAIN_MS) {
    lastBackAt = 0;
    history.back(); // second press: leave the page (the room stays saved)
    return;
  }
  lastBackAt = now;
  armBackGuard();
  toast('한 번 더 누르면 페이지를 떠나요. 방은 그대로라 돌아오면 이어서 할 수 있어요. (방을 나가려면 「나가기」)', 'info', BACK_AGAIN_MS);
});
window.addEventListener('pageshow', (ev) => {
  if (!ev.persisted || !state.room) return;
  armBackGuard();
  setConn('bad');
  enterRoom(state.room); // fresh stream: its first message is the current state
});

// ---------- room lifecycle ----------
/** Everything a room put on screen goes away: cut-ins, banners, MC corner, dialogs, the result show (A6). */
function tearDownRoomUi() {
  state.game?.teardown?.();
  state.game?.result?.reset(); // Stage 9: stop the result show, drop the podium
  state.game?.cutin?.setExit?.(null);
  closePhotoDialogs();
  closeCustomizer();
  setSheet(false);
  state.waitingResult = false;
  state.resultWait = null;
  document.body.classList.remove('spin-docked', 'has-inbox', 'spin-fab-on');
  $('#float-layer')?.replaceChildren();
  // the cut-in closes its overlay on the next tick: recompute the scroll lock from what is really open then
  setTimeout(repairScrollLock, 300);
}
// safety net: a scroll-lock class without its overlay (cut-in / result show / photo / customizer) never lingers
setInterval(() => repairScrollLock(), 2000);

function leaveRoom(message) {
  state.closeEvents?.();
  state.closeEvents = null;
  clearTimeout(state.reconnectTimer);
  tearDownRoomUi();
  state.room = null;
  setSavedRoomId(null);
  if (history.state?.jinseiRoom) history.back(); // drop the back-guard entry (popstate is a no-op without a room)
  showScreen('join');
  if (message) toast(message);
}

function enterRoom(room) {
  state.room = room;
  setSavedRoomId(room.id);
  state.closeEvents?.();
  state.connectedAt = Date.now();
  armBackGuard();
  // the top bar (with 나가기) is covered while a cut-in is open → the cut-in has its own exit button
  // (asked first: a tap meant to advance the cut-in must not throw anyone out of the game)
  state.game?.cutin?.setExit?.(() => {
    if (confirm('방에서 나갈까요? 방 코드로 다시 들어올 수 있어요.')) leaveRoom('방에서 나왔어요. 코드로 다시 들어올 수 있어요.');
  });
  state.closeEvents = connectEvents(room.id, {
    open: () => {
      state.connectedAt = Date.now();
      setConn('ok');
    },
    state: (r) => {
      markAlive();
      if (acceptRoom(r)) render();
    },
    events: (payload) => {
      markAlive();
      state.game?.onEvents(payload);
    },
    log: () => {},
    reaction: (r) => floatReaction(r),
    deleted: () => leaveRoom('방이 삭제되었습니다.'),
    superseded: () => {
      setConn('gone');
      toast('이 방이 같은 브라우저의 다른 탭 여러 개에서 열려 있어서 이 탭의 실시간 연결을 멈췄어요. 위의 「● 다시 연결」을 누르면 이 탭에서 이어서 봐요.', 'error', 7000);
    },
    error: async (closed) => {
      setConn('bad');
      if (!closed) return; // EventSource auto-retries
      try {
        const r = await api('GET', `/api/rooms/${room.id}`);
        setTimeout(() => state.room?.id === r.id && enterRoom(r), 2000);
      } catch (err) {
        if (err.status === 403 || err.status === 404) leaveRoom('방에 다시 들어갈 수 없습니다.');
        else setTimeout(() => state.room && enterRoom(state.room), 3000);
      }
    },
  });
  render();
}

function render() {
  const room = state.room;
  if (!room) return showScreen('join');
  $('#room-badge').textContent = `방 ${room.code}`;
  if (room.status === 'lobby') {
    showScreen('lobby');
    renderLobby(room);
  } else {
    closeCustomizer();
    if (room.status === 'playing') {
      showScreen('game');
      renderGame(room);
    } else {
      // game over / forced end: controls lock, prompt cut-ins / dialogs close at once, the 3D backlog rushes (A1, A8)
      state.game?.finish?.();
      if (state.screen === 'game' && state.resultWait !== room.id && state.game?.isBusy?.()) {
        // let the 3D board finish the last hops / goal confetti — at most ~2.5 s — before the result screen
        renderGame(room);
        if (!state.waitingResult) {
          state.waitingResult = true;
          state.game.whenIdle({ maxMs: 2500 }).then(() => {
            state.waitingResult = false;
            state.resultWait = room.id;
            if (state.room?.id === room.id) render();
          });
        }
      } else {
        showScreen('result');
        renderResult(room);
      }
    }
  }
}

// ---------- lobby ----------
/**
 * Lobby mode line (Fix-B2): 「<b>인생 전체</b> · 초기 자금 1,000만원 · 🎯 룰렛 실력 모드」 + a small era line 「아기 3턴 · … · 노년
 * 🏁 40칸」. The world (🐹 치이카와 모드 / 🏙️ 현실 모드) has its own line right below (#lobby-world).
 */
function modeLabelHtml(room) {
  const m = modeSummary(room, roomMeta(room));
  const head = [`<b>${esc(m.title)}</b>`, ...m.extras.map((x) => `<span class="lm-x">${esc(x)}</span>`)].join(' · ');
  const eras = m.eras.length ? `<span class="lm-eras">${m.eras.map((e) => `<span class="lm-era">${esc(e)}</span>`).join(' · ')}</span>` : '';
  return head + eras;
}

function charCard(c, { mine = false } = {}) {
  return `
    <div class="char-card${c.isMe ? ' mine' : ''}${state.seenChars.has(c.id) ? '' : ' pop'}" data-id="${esc(c.id)}">
      <div class="portrait">${portraitHtml(c, { size: 72, crop: 'bust' })}</div>
      <div class="char-name">${esc(c.name)}</div>
      ${mine ? '' : `<div class="char-owner">${ownerHtml(c)}${cpuPersonalityHtml(c) ? ` ${cpuPersonalityHtml(c, { short: true })}` : ''}${c.isMe ? ' (나)' : ''}</div>`}
      ${
        mine
          ? `<div class="char-actions">
              <button class="btn tiny" data-act="edit" data-id="${esc(c.id)}">편집</button>
              <button class="btn tiny danger" data-act="delete" data-id="${esc(c.id)}">삭제</button>
            </div>`
          : ''
      }
    </div>`;
}

// Stage 5.6: 호야 & 봄이 welcome banner (a random greeting dialogue; hidden with mcFrequency off / ✕)
const MC_WELCOME_KEY = 'jinsei.mcWelcomeClosed';
function renderMcWelcome(room) {
  let box = $('#mc-welcome');
  let closed = null;
  try {
    closed = sessionStorage.getItem(MC_WELCOME_KEY);
  } catch {
    /* storage unavailable */
  }
  const off = (room.config.mcFrequency ?? 'normal') === 'off' || closed === room.id || !roomMeta(room)?.mc;
  if (off) {
    if (box) box.hidden = true;
    return;
  }
  if (!box) {
    box = document.createElement('div');
    box.id = 'mc-welcome';
    box.className = 'mc-welcome';
    box.setAttribute('role', 'note');
    box.setAttribute('aria-label', 'MC 호야와 봄이의 인사');
    $('.lobby-main').prepend(box);
  }
  box.hidden = false;
  if (box.dataset.room === room.id) return; // keep the same greeting while the lobby re-renders
  box.dataset.room = room.id;
  const lines = mcLinesFrom(roomMeta(room).mc, 'gameStart', { duo: true, seed: `${room.id}:${Math.floor(Math.random() * 1e6)}` });
  const pair = document.createElement('div');
  pair.className = 'mc-pair';
  pair.append(renderMc('hoya', { expression: 'joy', pose: 'wave', size: 0 }), renderMc('bomi', { expression: 'neutral', pose: 'mic', size: 0 }));
  const say = document.createElement('div');
  say.className = 'mc-say';
  say.innerHTML = lines.map((l) => `<p><b class="${esc(l.speaker)}">${esc(MC_NAMES[l.speaker] ?? '')}</b>${esc(l.line)}</p>`).join('');
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'mc-x';
  x.setAttribute('aria-label', 'MC 인사 닫기');
  x.textContent = '✕';
  x.addEventListener('click', () => {
    box.hidden = true;
    try {
      sessionStorage.setItem(MC_WELCOME_KEY, room.id);
    } catch {
      /* ignore */
    }
  });
  box.replaceChildren(pair, say, x);
}

function renderLobby(room) {
  renderMcWelcome(room);
  $('#lobby-code').textContent = room.code;
  const modeEl = $('#lobby-mode');
  const modeHtml = modeLabelHtml(room);
  if (modeEl.dataset.html !== modeHtml) {
    modeEl.dataset.html = modeHtml;
    modeEl.innerHTML = modeHtml;
  }
  // 세계 설정: one line about the room's world (🐹 치이카와 모드: 토벌·풀뽑기 검정·쿠지 / 🏙️ 현실 모드)
  const wl = $('#lobby-world');
  if (wl) {
    const w = worldInfo(worldOf(room));
    wl.hidden = false;
    wl.dataset.world = w.id;
    wl.innerHTML = `<b>${esc(w.icon)} ${esc(w.name)}</b> · ${esc(w.desc)}`;
  }

  const players = playersOnly(room);
  const spectators = room.players.filter((p) => p.role === 'spectator');
  $('#player-count').textContent = `${players.length}/4${spectators.length ? ` · 👀 ${spectators.length}` : ''}`;
  $('#player-list').innerHTML = players
    .map(
      (p) => `
      <li class="player${p.isMe ? ' me' : ''}">
        <span class="dot ${p.connected ? 'on' : 'off'}" title="${p.connected ? '접속 중' : '오프라인'}"></span>
        <span class="pname" title="${esc(p.name)}">${esc(p.name)}</span>
        ${p.isMe ? '<span class="tag">나</span>' : ''}
        <span class="pchars">${room.characters.filter((c) => c.ownerId === p.id).length}명</span>
        ${p.ready ? '<span class="tag ready">준비</span>' : '<span class="tag wait">대기</span>'}
      </li>`,
    )
    .join('') +
    (spectators.length
      ? `<li class="spec-list">👀 관전: ${spectators.map((p) => `${esc(p.name)}${p.isMe ? ' (나)' : ''}`).join(', ')}</li>`
      : '');

  const max = room.config.maxCharacters;
  $('#char-count').textContent = `${room.characters.length}/${max}`;
  $('#char-grid').innerHTML = room.characters.length
    ? room.characters.map((c) => charCard(c)).join('')
    : '<p class="muted empty-hint">아직 캐릭터가 없어요.</p>';

  const mine = room.characters.filter((c) => c.isMe);
  $('#my-chars').innerHTML = mine.length
    ? mine.map((c) => charCard(c, { mine: true })).join('')
    : '<p class="muted empty-hint">내 캐릭터를 만들어 보세요. 여러 명을 조종할 수 있어요!</p>';
  hydratePortraits($('#char-grid'));
  hydratePortraits($('#my-chars'));
  renderCpuTools(room);
  for (const c of room.characters) state.seenChars.add(c.id);
  $('#sheet-title').textContent = `내 캐릭터 (${mine.length})`;
  // Mobile: open the bottom sheet once when I have no characters yet (players only).
  if (!state.sheetAutoOpened && mine.length === 0 && !isSpectator(room)) {
    state.sheetAutoOpened = true;
    setSheet(true);
  }

  const full = room.characters.length >= max;
  const addBtn = $('#add-char-btn');
  addBtn.disabled = full;
  addBtn.textContent = full ? `캐릭터 슬롯이 가득 찼어요 (${max})` : `+ 캐릭터 만들기 (남은 슬롯 ${max - room.characters.length})`;

  const ready = !!room.me?.ready;
  const readyBtn = $('#ready-btn');
  readyBtn.textContent = ready ? '준비 취소' : '준비 완료';
  readyBtn.classList.toggle('on', ready);
  readyBtn.disabled = mine.length === 0 && !ready;

  $('#log-list').innerHTML = room.log
    .slice(-12)
    .reverse()
    .map((l) => `<li><time>${new Date(l.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</time> ${esc(l.text)}</li>`)
    .join('');

  // Editing a character that no longer exists → close the editor.
  if (state.customizer?.charId && !room.characters.some((c) => c.id === state.customizer.charId)) closeCustomizer();
}

// Stage 9-C: the host (first joined player) adds / removes CPU characters in rooms created with 「CPU 허용」, picks a
// personality for a new one (🎲 무작위 / 🐢 신중 / 🙂 보통 / 🔥 대담) and changes it per CPU chip (lobby only).
function renderCpuTools(room) {
  let box = $('#cpu-tools');
  const host = playersOnly(room)[0];
  const on = room.status === 'lobby' && room.config.allowCpu && !!host?.isMe && !isSpectator(room);
  if (!on) {
    if (box) box.hidden = true;
    return;
  }
  if (!box) {
    box = document.createElement('div');
    box.id = 'cpu-tools';
    box.className = 'cpu-tools';
    $('#char-grid').after(box);
    box.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-cpu]');
      if (!btn || btn.disabled) return;
      btn.disabled = true;
      try {
        const personality = box.querySelector('[data-cpu-new]')?.value ?? 'random';
        const res =
          btn.dataset.cpu === 'add'
            ? await api('POST', `/api/rooms/${state.room.id}/cpu`, { personality })
            : await api('DELETE', `/api/rooms/${state.room.id}/cpu/${btn.dataset.cpu}`);
        state.room = res.room;
        render();
      } catch (err) {
        toast(err.message || 'CPU를 바꾸지 못했어요.', 'error');
        btn.disabled = false;
      }
    });
    box.addEventListener('change', async (ev) => {
      const sel = ev.target.closest('[data-cpu-pers]');
      if (!sel) return; // the new-CPU picker just keeps its value
      sel.disabled = true;
      try {
        const res = await api('PATCH', `/api/rooms/${state.room.id}/cpu/${sel.dataset.cpuPers}`, { personality: sel.value });
        state.room = res.room;
        render();
      } catch (err) {
        toast(err.message || 'CPU 성향을 바꾸지 못했어요.', 'error');
        box.cpuHtml = '';
        render();
      }
    });
  }
  box.hidden = false;
  const cpus = room.characters.filter((c) => c.ownerId === 'cpu');
  const full = room.characters.length >= room.config.maxCharacters;
  const pick = box.querySelector('[data-cpu-new]')?.value ?? 'random';
  const handicap = cpuHandicapText(state.meta);
  const html = `
    ${cpus.length ? `<div class="cpu-list">${cpus.map(cpuChipHtml).join('')}</div>` : ''}
    <div class="cpu-add">
      <select data-cpu-new aria-label="새 CPU 성향" title="새 CPU의 성향">${cpuPersonalityOptions(pick)}</select>
      <button class="btn tiny" type="button" data-cpu="add" ${full ? 'disabled' : ''}>🤖 CPU 추가</button>
    </div>
    <small class="muted cpu-hint">🐢 신중 = 돈을 아끼고 모험을 피해요 · 🙂 보통 · 🔥 대담 = 도박·투자를 좋아해요</small>
    ${handicap ? `<small class="muted cpu-hint">${esc(handicap)}</small>` : ''}
    <small class="muted">방장만 CPU를 넣고 빼거나 성향을 바꿀 수 있어요</small>`;
  // re-render only when something changed (an open picker would close on every lobby update)
  if (box.cpuHtml !== html) {
    box.cpuHtml = html;
    box.innerHTML = html;
  }
}

/** A CPU chip of the host tools: name + personality picker + ✕. */
function cpuChipHtml(c) {
  return `<span class="cpu-chip"><span class="cpu-chip-n">🤖 ${esc(c.name)}</span><select data-cpu-pers="${esc(c.id)}" aria-label="${esc(c.name)} 성향" title="${esc(c.name)}의 성향">${cpuPersonalityOptions(c.cpuPersonality, { random: false })}</select><button class="btn tiny ghost" type="button" data-cpu="${esc(c.id)}" title="CPU 빼기" aria-label="${esc(c.name)} 빼기">✕</button></span>`;
}

function closeCustomizer() {
  state.customizer?.destroy();
  state.customizer = null;
  const wrap = $('#my-list-wrap');
  if (wrap) wrap.hidden = false;
}

function setSheet(open) {
  const panel = $('#my-panel');
  panel.classList.toggle('open', open);
  document.body.classList.toggle('sheet-open', open);
  $('#sheet-toggle').setAttribute('aria-expanded', String(open));
}

function startCustomizer(charId = null) {
  const room = state.room;
  const existing = charId ? room.characters.find((c) => c.id === charId) : null;
  closeCustomizer();
  $('#my-list-wrap').hidden = true;
  setSheet(true);
  const ui = openCharaPicker($('#customizer-host'), {
    title: existing ? `「${existing.name}」 꾸미기` : '새 캐릭터 고르기',
    submitLabel: existing ? '저장' : '만들기',
    initial: existing ? { name: existing.name, avatar: existing.avatar } : {},
    meta: roomMeta(room),
    onSave: async ({ name, avatar }) => {
      const res = existing
        ? await api('PATCH', `/api/rooms/${room.id}/characters/${existing.id}`, { name, avatar })
        : await api('POST', `/api/rooms/${room.id}/characters`, { name, avatar });
      state.room = res.room;
      closeCustomizer();
      render();
      toast(existing ? '캐릭터를 저장했어요.' : `「${name}」 등장!`);
    },
    onCancel: () => closeCustomizer(),
  });
  state.customizer = { ...ui, charId };
}

async function onMyCharsClick(ev) {
  const btn = ev.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.act === 'edit') startCustomizer(id);
  if (btn.dataset.act === 'delete') {
    const c = state.room.characters.find((x) => x.id === id);
    if (!c || !confirm(`「${c.name}」${josa(c.name, '을/를').slice(c.name.length)} 삭제할까요?`)) return;
    try {
      const res = await api('DELETE', `/api/rooms/${state.room.id}/characters/${id}`);
      state.room = res.room;
      render();
    } catch (err) {
      toast(err.message, 'error');
    }
  }
}

// ---------- game / result ----------
async function act(body) {
  const room = state.room;
  const res = await api('POST', `/api/rooms/${room.id}/actions`, body);
  if (acceptRoom(res.room)) render();
}

/** Fetch the latest room view (stale actions: the game moved on) and show it. */
async function resync() {
  if (!state.room) return null;
  const r = await api('GET', `/api/rooms/${state.room.id}`);
  if (acceptRoom(r)) render();
  return state.room;
}

function renderGame(room) {
  state.game.render(room);
}

function renderResult(room) {
  state.game.renderResult(room, $('#result-root'));
}

// ---------- reactions ----------
const REACTION_WINDOW_MS = 2000;
const REACTION_MAX = 4;
function buildReactionBar() {
  const bar = $('#reaction-bar');
  bar.innerHTML = (state.meta?.reactions ?? []).map((e) => `<button type="button" class="react" data-emoji="${esc(e)}">${esc(e)}</button>`).join('');
  // a row that doesn't fit scrolls; the hidden side fades out (data-more → CSS mask) so the last emoji isn't just cut
  const cue = () => {
    const more = scrollCue(bar);
    if ((bar.dataset.more ?? '') !== more) {
      if (more) bar.dataset.more = more;
      else delete bar.dataset.more;
    }
  };
  bar.addEventListener('scroll', cue, { passive: true });
  window.addEventListener('resize', cue);
  if (typeof ResizeObserver === 'function') new ResizeObserver(cue).observe(bar);
  requestAnimationFrame(cue);
  // client-side pacing below the server limit (5 per 2 s per session): extra taps just wiggle the button
  const sent = [];
  bar.addEventListener('click', async (ev) => {
    const b = ev.target.closest('.react');
    if (!b || !state.room) return;
    const now = Date.now();
    while (sent.length && now - sent[0] > REACTION_WINDOW_MS) sent.shift();
    if (sent.length >= REACTION_MAX) {
      b.classList.remove('wiggle');
      void b.offsetWidth;
      b.classList.add('wiggle');
      return;
    }
    sent.push(now);
    try {
      await api('POST', `/api/rooms/${state.room.id}/reactions`, { emoji: b.dataset.emoji });
    } catch (err) {
      if (err.status !== 429) toast(err.message, 'error');
    }
  });
}

function floatReaction(r) {
  state.game?.onReaction?.(r); // 3D: emoji above that player's pawns
  // a cut-in is open → its reaction chip row shows it; no floating emoji over the dialogue / options
  if (document.body.classList.contains('cutin-open')) return;
  const { emoji, name } = r;
  const layer = $('#float-layer');
  const el = document.createElement('div');
  el.className = 'floating';
  el.style.left = `${10 + Math.random() * 80}%`;
  el.innerHTML = `<span class="f-emoji">${esc(emoji)}</span><span class="f-name">${esc(name)}</span>`;
  layer.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
  if (layer.childElementCount > 30) layer.firstElementChild.remove();
}

// ---------- join ----------
async function onJoin(ev) {
  ev.preventDefault();
  const form = ev.currentTarget;
  const errEl = form.querySelector('.form-error');
  const spectator = ev.submitter?.value === 'spectator';
  const code = form.code.value.trim().toUpperCase();
  let name = cleanName(form.name.value); // same cleaning as the server: invisible / bidi characters vanish (A10)
  errEl.textContent = '';
  if (code.length !== 6) return (errEl.textContent = '방 코드는 6자리예요.');
  if (!name && spectator) name = '관전자';
  if (!name) return (errEl.textContent = '이름을 입력하세요.');
  if (!nameFits(name)) return (errEl.textContent = `이름은 ${NAME_MAX}자까지 쓸 수 있어요.`);
  const btns = [...form.querySelectorAll('button[type=submit]')];
  for (const b of btns) b.disabled = true;
  try {
    const res = await api('POST', '/api/rooms/join', spectator ? { code, name, spectator: true } : { code, name });
    if (!spectator || name !== '관전자') setSavedName(name);
    if (spectator && res.room?.me && res.room.me.role !== 'spectator') toast('이 서버는 관전 입장을 지원하지 않아 참가자로 들어왔어요.', 'error');
    enterRoom(res.room);
  } catch (err) {
    errEl.textContent = err.message;
  } finally {
    for (const b of btns) b.disabled = false;
  }
}


// ---------- boot ----------
async function boot() {
  $('#join-form').addEventListener('submit', onJoin);
  $('#join-form').code.addEventListener('input', (e) => (e.target.value = e.target.value.toUpperCase()));
  $('#join-form').name.value = savedName();
  bindNameInput($('#join-form').name, $('#join-form [data-name-count]'));
  const params = new URLSearchParams(location.search);
  if (params.get('code')) $('#join-form').code.value = params.get('code').toUpperCase().slice(0, 6);

  $('#my-chars').addEventListener('click', onMyCharsClick);
  $('#add-char-btn').addEventListener('click', () => startCustomizer(null));
  $('#ready-btn').addEventListener('click', async () => {
    try {
      const res = await api('POST', `/api/rooms/${state.room.id}/ready`, { ready: !state.room.me?.ready });
      state.room = res.room;
      render();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  $('#sheet-toggle').addEventListener('click', () => setSheet(!$('#my-panel').classList.contains('open')));
  $('#leave-btn').addEventListener('click', () => leaveRoom('방에서 나왔어요. 코드로 다시 들어올 수 있어요.'));
  $('#conn').addEventListener('click', reclaimStream);
  $('#conn').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      reclaimStream();
    }
  });
  $('#result-leave').addEventListener('click', () => leaveRoom());

  try {
    state.meta = await getMeta();
    setCharaMeta(state.meta); // roster / props / NPC friends / pets for every character drawing
    loadAssetIndex(); // raster character art (ch-<id>-…) replaces the SVG rigs once accepted
    buildReactionBar();
    state.game = createGameUI($('#game-root'), { getMeta: () => roomMeta(), act, toast, resync });
    await ensureSession();
    // A15: no site storage → every refresh would join as a new player; say so once
    if (storageMode() === 'memory') toast('⚠️ 이 브라우저는 저장소가 막혀 있어서 새로고침하면 새 참가자로 들어가요. 새로고침하지 말고 이 화면을 계속 써 주세요.', 'error', 7000);
  } catch (err) {
    showScreen('join');
    toast(err.message || '서버에 연결할 수 없습니다.', 'error');
    return;
  }

  const saved = savedRoomId();
  if (saved) {
    try {
      const room = await api('GET', `/api/rooms/${saved}`);
      return enterRoom(room);
    } catch {
      setSavedRoomId(null);
    }
  }
  showScreen('join');
}

boot();
