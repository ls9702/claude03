// Game page controller: join → lobby → game (game2d.js: 3D board with 2D fallback) → result.
import {
  api,
  connectEvents,
  ensureSession,
  getMeta,
  savedName,
  savedRoomId,
  setSavedName,
  setSavedRoomId,
} from './api.js';
import { NAME_MAX, nameFits, cpuBadgeHtml } from './format.js';
import { bindNameInput } from './ui/nameInput.js';
import { createGameUI } from './game2d.js';
import { hydratePortraits, portraitHtml, setAvatarDefs } from './ui/avatar2d.js';
import { openCustomizer, setPreviewRenderer } from './ui/customize.js';
import { layeredPreviewRenderer } from './ui/avatarCompose.js';
import { MC_NAMES, mcLinesFrom, renderMc } from './ui/mc.js';

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

/** Accept a room view unless it is older than the one we already show (SSE vs. POST response races). */
function acceptRoom(r) {
  const cur = state.room;
  if (cur && r && cur.id === r.id && (r.version ?? 0) < (cur.version ?? 0)) return false;
  state.room = r;
  return true;
}

// ---------- toast / screens ----------
let toastTimer;
function toast(msg, kind = 'info') {
  const el = $('#toast');
  el.textContent = msg;
  el.dataset.kind = kind;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
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
  el.dataset.kind = kind;
  el.textContent = kind === 'ok' ? '● 연결됨' : '● 재연결 중…';
}

// ---------- room lifecycle ----------
function leaveRoom(message) {
  state.closeEvents?.();
  state.closeEvents = null;
  closeCustomizer();
  state.room = null;
  setSavedRoomId(null);
  showScreen('join');
  if (message) toast(message);
}

function enterRoom(room) {
  state.room = room;
  setSavedRoomId(room.id);
  state.closeEvents?.();
  state.closeEvents = connectEvents(room.id, {
    open: () => setConn('ok'),
    state: (r) => {
      if (acceptRoom(r)) render();
    },
    events: (payload) => state.game?.onEvents(payload),
    log: () => {},
    reaction: (r) => floatReaction(r),
    deleted: () => leaveRoom('방이 삭제되었습니다.'),
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
    } else if (state.screen === 'game' && state.game?.isBusy?.()) {
      // let the 3D board finish the last hops / goal confetti before the result screen; controls lock at once
      renderGame(room);
      if (!state.waitingResult) {
        state.waitingResult = true;
        state.game.whenIdle().then(() => {
          state.waitingResult = false;
          render();
        });
      }
    } else {
      showScreen('result');
      renderResult(room);
    }
  }
}

// ---------- lobby ----------
function modeLabel(room) {
  const eras = state.meta?.eras;
  const mode = eras?.modes?.[room.config.mode];
  if (!mode) return room.config.mode;
  const parts = mode.eras.map((id) => {
    const era = eras.eras.find((e) => e.id === id);
    return `${era?.name ?? id} ${room.config.eraTurns[id]}`;
  });
  return `${mode.name} · ${parts.join(' / ')} · 초기 자금 ${room.config.startingMoney.toLocaleString()}만원`;
}

function charCard(c, { mine = false } = {}) {
  return `
    <div class="char-card${c.isMe ? ' mine' : ''}${state.seenChars.has(c.id) ? '' : ' pop'}" data-id="${esc(c.id)}">
      <div class="portrait">${portraitHtml(c, { size: 72, crop: 'bust' })}</div>
      <div class="char-name">${esc(c.name)}</div>
      ${mine ? '' : `<div class="char-owner">${esc(c.ownerName)}${cpuBadgeHtml(c)}${c.isMe ? ' (나)' : ''}</div>`}
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
  const off = (room.config.mcFrequency ?? 'normal') === 'off' || closed === room.id || !state.meta?.mc;
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
  const lines = mcLinesFrom(state.meta.mc, 'gameStart', { duo: true, seed: `${room.id}:${Math.floor(Math.random() * 1e6)}` });
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
  $('#lobby-mode').textContent = modeLabel(room);

  const players = playersOnly(room);
  const spectators = room.players.filter((p) => p.role === 'spectator');
  $('#player-count').textContent = `${players.length}/4${spectators.length ? ` · 👀 ${spectators.length}` : ''}`;
  $('#player-list').innerHTML = players
    .map(
      (p) => `
      <li class="player${p.isMe ? ' me' : ''}">
        <span class="dot ${p.connected ? 'on' : 'off'}" title="${p.connected ? '접속 중' : '오프라인'}"></span>
        <span class="pname">${esc(p.name)}</span>
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
    : '<p class="muted">아직 캐릭터가 없어요.</p>';

  const mine = room.characters.filter((c) => c.isMe);
  $('#my-chars').innerHTML = mine.length
    ? mine.map((c) => charCard(c, { mine: true })).join('')
    : '<p class="muted">내 캐릭터를 만들어 보세요. 여러 명을 조종할 수 있어요!</p>';
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

// Stage 9-C: the host (first joined player) adds / removes CPU characters in rooms created with 「CPU 허용」.
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
        const res =
          btn.dataset.cpu === 'add'
            ? await api('POST', `/api/rooms/${state.room.id}/cpu`, {})
            : await api('DELETE', `/api/rooms/${state.room.id}/cpu/${btn.dataset.cpu}`);
        state.room = res.room;
        render();
      } catch (err) {
        toast(err.message || 'CPU를 바꾸지 못했어요.', 'error');
        btn.disabled = false;
      }
    });
  }
  box.hidden = false;
  const cpus = room.characters.filter((c) => c.ownerId === 'cpu');
  const full = room.characters.length >= room.config.maxCharacters;
  box.innerHTML = `
    ${cpus.map((c) => `<button class="btn tiny ghost" type="button" data-cpu="${esc(c.id)}" title="CPU 빼기">🤖 ${esc(c.name)} ✕</button>`).join(' ')}
    <button class="btn tiny" type="button" data-cpu="add" ${full ? 'disabled' : ''}>🤖 CPU 추가</button>
    <small class="muted">방장만 CPU를 넣고 뺄 수 있어요</small>`;
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
  const ui = openCustomizer($('#customizer-host'), {
    title: existing ? `「${existing.name}」 편집` : '새 캐릭터',
    submitLabel: existing ? '저장' : '만들기',
    initial: existing ? { name: existing.name, avatar: existing.avatar } : {},
    art: existing ? { roomId: room.id, charId: existing.id } : undefined,
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
    if (!c || !confirm(`「${c.name}」을(를) 삭제할까요?`)) return;
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
  let name = form.name.value.replace(/\s+/g, ' ').trim();
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
  $('#result-leave').addEventListener('click', () => leaveRoom());

  try {
    state.meta = await getMeta();
    setAvatarDefs(state.meta.avatars);
    setPreviewRenderer(layeredPreviewRenderer); // paper-doll layers in the customizer (SVG until they load)
    buildReactionBar();
    state.game = createGameUI($('#game-root'), { getMeta: () => state.meta, act, toast, resync });
    await ensureSession();
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
