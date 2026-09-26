// Admin page: login, create room (per-era turns), room list, lobby detail, start/end/delete.
import { renderAvatar, setAvatarDefs } from './ui/avatar2d.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const STATUS = { lobby: '대기 중', playing: '진행 중', finished: '종료' };

let meta = null;
let selectedId = null;
let pollTimer = null;

async function req(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty */
  }
  if (res.status === 401 && !path.endsWith('/login')) {
    showLogin();
    throw new Error(data?.error || '로그인이 필요합니다.');
  }
  if (!res.ok) {
    const err = new Error(data?.error || `요청 실패 (${res.status})`);
    err.data = data;
    throw err;
  }
  return data;
}

let toastTimer;
function toast(msg, kind = 'info') {
  const el = $('#toast');
  el.textContent = msg;
  el.dataset.kind = kind;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function showLogin() {
  clearInterval(pollTimer);
  $('#login-view').hidden = false;
  $('#admin-view').hidden = true;
  $('#logout-btn').hidden = true;
}

async function showAdmin() {
  $('#login-view').hidden = true;
  $('#admin-view').hidden = false;
  $('#logout-btn').hidden = false;
  if (!meta) {
    meta = await req('GET', '/admin/api/meta');
    try {
      const pub = await (await fetch('/api/meta')).json();
      setAvatarDefs(pub.avatars);
    } catch {
      /* fallback defs */
    }
    buildCreateForm();
  }
  await refresh();
  clearInterval(pollTimer);
  pollTimer = setInterval(() => refresh().catch(() => {}), 3000);
}

// ---------- create form ----------
function buildCreateForm() {
  const sel = $('#mode-select');
  sel.innerHTML = Object.entries(meta.eras.modes)
    .map(([id, m]) => `<option value="${esc(id)}">${esc(m.name)} (${m.eras.length}시대)</option>`)
    .join('');
  const { minTurns, maxTurns } = meta.eras.limits;
  $('#era-rows').innerHTML = meta.eras.eras
    .map(
      (e) => `
      <label class="era-row" data-era="${esc(e.id)}">
        <span>${esc(e.name)} <span class="def">기본 ${e.defaultTurns}</span></span>
        <input type="number" name="era_${esc(e.id)}" min="${minTurns}" max="${maxTurns}" step="1" value="${e.defaultTurns}">
      </label>`,
    )
    .join('');
  const syncMode = () => {
    const included = new Set(meta.eras.modes[sel.value].eras);
    for (const row of document.querySelectorAll('.era-row')) {
      const on = included.has(row.dataset.era);
      row.classList.toggle('off', !on);
      row.querySelector('input').disabled = !on;
    }
  };
  sel.addEventListener('change', syncMode);
  syncMode();
  $('#era-reset').addEventListener('click', () => {
    for (const e of meta.eras.eras) $(`[name="era_${e.id}"]`).value = e.defaultTurns;
  });
  $('#create-form').addEventListener('submit', onCreate);
}

async function onCreate(ev) {
  ev.preventDefault();
  const f = ev.currentTarget;
  const errEl = f.querySelector('.form-error');
  errEl.textContent = '';
  const included = new Set(meta.eras.modes[f.mode.value].eras);
  const eraTurns = {};
  for (const e of meta.eras.eras) {
    if (!included.has(e.id)) continue;
    const raw = f[`era_${e.id}`].value;
    eraTurns[e.id] = raw === '' ? e.defaultTurns : Number(raw);
  }
  const body = {
    mode: f.mode.value,
    eraTurns,
    maxCharacters: Number(f.maxCharacters.value),
    startingMoney: Number(f.startingMoney.value),
    turnOrder: f.turnOrder.value,
    allowCpu: f.allowCpu.checked,
  };
  try {
    const { room } = await req('POST', '/admin/api/rooms', body);
    toast(`방을 만들었습니다. 코드: ${room.code}`);
    selectedId = room.id;
    await refresh();
  } catch (err) {
    errEl.innerHTML = (err.data?.errors ?? [err.message]).map(esc).join('<br>');
  }
}

// ---------- list & detail ----------
async function refresh() {
  const { rooms } = await req('GET', '/admin/api/rooms');
  const modes = meta.eras.modes;
  $('#no-rooms').hidden = rooms.length > 0;
  $('#room-rows').innerHTML = rooms
    .map(
      (r) => `
      <tr data-id="${esc(r.id)}" class="${r.id === selectedId ? 'sel' : ''}">
        <td class="code">${esc(r.code)}</td>
        <td>${esc(modes[r.mode]?.name ?? r.mode)}</td>
        <td><span class="status ${esc(r.status)}">${STATUS[r.status] ?? esc(r.status)}</span></td>
        <td>${r.connected}/${r.players}</td>
        <td>${r.characters}/${r.maxCharacters}</td>
        <td>${new Date(r.createdAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
        <td><button class="btn tiny" data-open="${esc(r.id)}">상세</button></td>
      </tr>`,
    )
    .join('');
  if (selectedId && !rooms.some((r) => r.id === selectedId)) selectedId = null;
  await renderDetail();
}

async function renderDetail() {
  const box = $('#detail');
  if (!selectedId) {
    box.hidden = true;
    return;
  }
  let room;
  try {
    ({ room } = await req('GET', `/admin/api/rooms/${selectedId}`));
  } catch {
    box.hidden = true;
    return;
  }
  // Don't clobber an open <details> while polling.
  const openJson = box.querySelector('details')?.open ?? false;
  const eras = meta.eras;
  const included = eras.modes[room.config.mode].eras;
  const eraText = included
    .map((id) => `${eras.eras.find((e) => e.id === id)?.name ?? id} ${room.config.eraTurns[id]}`)
    .join(' · ');
  const byId = new Map(room.characters.map((c) => [c.id, c]));
  box.hidden = false;
  box.innerHTML = `
    <h2>방 ${esc(room.code)} <span class="status ${esc(room.status)}">${STATUS[room.status]}</span></h2>
    <div class="detail-actions">
      <button class="btn primary small" data-act="start" ${room.status !== 'lobby' || room.characters.length < 2 ? 'disabled' : ''}>게임 시작</button>
      <button class="btn small" data-act="end" ${room.status === 'finished' ? 'disabled' : ''}>강제 종료</button>
      <button class="btn small danger" data-act="delete">삭제</button>
      <button class="btn small ghost" data-act="copy">입장 링크 복사</button>
    </div>
    <dl class="kv">
      <dt>모드</dt><dd>${esc(eras.modes[room.config.mode].name)}</dd>
      <dt>시대별 턴</dt><dd>${esc(eraText)}</dd>
      <dt>최대 캐릭터</dt><dd>${room.config.maxCharacters}</dd>
      <dt>초기 자금</dt><dd>${room.config.startingMoney.toLocaleString()}만원</dd>
      <dt>턴 순서</dt><dd>${room.config.turnOrder === 'family' ? '가문 순' : '캐릭터 번호 순'}</dd>
      <dt>CPU</dt><dd>${room.config.allowCpu ? '허용' : '없음'}</dd>
      ${room.turn ? `<dt>턴 순서(실제)</dt><dd>${room.turn.order.map((id) => esc(byId.get(id)?.name ?? id)).join(' → ')}</dd>` : ''}
    </dl>
    <h3>참가자 (${room.players.length}/4)</h3>
    <ul class="detail-players">
      ${room.players.map((p) => `<li><span class="dot ${p.connected ? 'on' : 'off'}"></span>${esc(p.name)} ${p.ready ? '✅' : ''} <small class="muted">캐릭터 ${room.characters.filter((c) => c.ownerId === p.id).length}</small></li>`).join('') || '<li class="muted">없음</li>'}
    </ul>
    <h3>캐릭터 (${room.characters.length}/${room.config.maxCharacters})</h3>
    <div class="detail-chars">
      ${room.characters.map((c) => `<div class="detail-char">${renderAvatar(c.avatar, { size: 56 })}<div><b>${esc(c.name)}</b></div><small class="muted">${esc(c.ownerName)}</small></div>`).join('') || '<p class="muted">없음</p>'}
    </div>
    <details ${openJson ? 'open' : ''}><summary>상태 JSON</summary><pre class="json">${esc(JSON.stringify(room, null, 2))}</pre></details>`;
}

async function onDetailClick(ev) {
  const act = ev.target.closest('[data-act]')?.dataset.act;
  if (!act || !selectedId) return;
  try {
    if (act === 'start') {
      await req('POST', `/admin/api/rooms/${selectedId}/start`);
      toast('게임을 시작했습니다.');
    } else if (act === 'end') {
      if (!confirm('이 방의 게임을 종료할까요?')) return;
      await req('POST', `/admin/api/rooms/${selectedId}/end`);
      toast('게임을 종료했습니다.');
    } else if (act === 'delete') {
      if (!confirm('이 방을 삭제할까요? 되돌릴 수 없습니다.')) return;
      await req('DELETE', `/admin/api/rooms/${selectedId}`);
      selectedId = null;
      toast('방을 삭제했습니다.');
    } else if (act === 'copy') {
      const code = $('#detail h2').textContent.match(/방 (\w+)/)?.[1];
      const url = `${location.origin}/?code=${code}`;
      await navigator.clipboard?.writeText(url).catch(() => {});
      toast(`복사됨: ${url}`);
      return;
    }
    await refresh();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------- boot ----------
$('#login-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.currentTarget;
  const errEl = f.querySelector('.form-error');
  errEl.textContent = '';
  try {
    await req('POST', '/admin/api/login', { password: f.password.value });
    f.password.value = '';
    await showAdmin();
  } catch (err) {
    errEl.textContent = err.message;
  }
});
$('#logout-btn').addEventListener('click', async () => {
  await req('POST', '/admin/api/logout').catch(() => {});
  showLogin();
});
$('#refresh-btn').addEventListener('click', () => refresh().catch((e) => toast(e.message, 'error')));
$('#room-rows').addEventListener('click', (ev) => {
  const tr = ev.target.closest('tr[data-id]');
  if (!tr) return;
  selectedId = tr.dataset.id;
  for (const row of document.querySelectorAll('#room-rows tr')) row.classList.toggle('sel', row === tr);
  renderDetail();
});
$('#detail').addEventListener('click', onDetailClick);

(async () => {
  try {
    const { admin } = await req('GET', '/admin/api/me');
    if (admin) await showAdmin();
    else showLogin();
  } catch {
    showLogin();
  }
})();
