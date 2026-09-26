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
import { createGameUI } from './game2d.js';
import { hydratePortraits, portraitHtml, setAvatarDefs } from './ui/avatar2d.js';
import { openCustomizer, setPreviewRenderer } from './ui/customize.js';
import { layeredPreviewRenderer } from './ui/avatarCompose.js';

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

function showScreen(name) {
  if (state.screen === name) return;
  state.screen = name;
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== `screen-${name}`;
  const inRoom = name !== 'join';
  $('#room-badge').hidden = !inRoom;
  $('#conn').hidden = !inRoom;
  $('#leave-btn').hidden = !inRoom;
  $('#reaction-bar').hidden = !(name === 'lobby' || name === 'game');
  document.body.dataset.screen = name;
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
      // let the 3D board finish the last hops / goal confetti before the result screen
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
      ${mine ? '' : `<div class="char-owner">${esc(c.ownerName)}${c.isMe ? ' (나)' : ''}</div>`}
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

function renderLobby(room) {
  $('#lobby-code').textContent = room.code;
  $('#lobby-mode').textContent = modeLabel(room);

  $('#player-count').textContent = `${room.players.length}/4`;
  $('#player-list').innerHTML = room.players
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
    .join('');

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
  for (const c of room.characters) state.seenChars.add(c.id);
  $('#sheet-title').textContent = `내 캐릭터 (${mine.length})`;
  // Mobile: open the bottom sheet once when I have no characters yet.
  if (!state.sheetAutoOpened && mine.length === 0) {
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

function renderGame(room) {
  state.game.render(room);
}

function renderResult(room) {
  state.game.renderResult(room, $('#result-root'));
}

// ---------- reactions ----------
function buildReactionBar() {
  const bar = $('#reaction-bar');
  bar.innerHTML = (state.meta?.reactions ?? []).map((e) => `<button type="button" class="react" data-emoji="${esc(e)}">${esc(e)}</button>`).join('');
  bar.addEventListener('click', async (ev) => {
    const b = ev.target.closest('.react');
    if (!b || !state.room) return;
    try {
      await api('POST', `/api/rooms/${state.room.id}/reactions`, { emoji: b.dataset.emoji });
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function floatReaction(r) {
  state.game?.onReaction?.(r); // 3D: emoji above that player's pawns
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
  const code = form.code.value.trim().toUpperCase();
  const name = form.name.value.trim();
  errEl.textContent = '';
  if (code.length !== 6) return (errEl.textContent = '방 코드는 6자리예요.');
  if (!name) return (errEl.textContent = '이름을 입력하세요.');
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const res = await api('POST', '/api/rooms/join', { code, name });
    setSavedName(name);
    enterRoom(res.room);
  } catch (err) {
    errEl.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

// ---------- boot ----------
async function boot() {
  $('#join-form').addEventListener('submit', onJoin);
  $('#join-form').code.addEventListener('input', (e) => (e.target.value = e.target.value.toUpperCase()));
  $('#join-form').name.value = savedName();
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
    state.game = createGameUI($('#game-root'), { getMeta: () => state.meta, act, toast });
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
