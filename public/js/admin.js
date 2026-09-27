// Admin page: login, create room (per-era turns), room list, lobby detail, start/end/delete.
import { renderAvatar, setAvatarDefs } from './ui/avatar2d.js';
import { ownerHtml } from './format.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const STATUS = { lobby: '대기 중', playing: '진행 중', finished: '종료' };
const MC_FREQ_LABEL = { many: '많이', normal: '보통', few: '적게', off: '끄기' };
const PHASE_LABEL = { awaitSpin: '룰렛 대기', resolveSpace: '칸 처리 중', awaitDecision: '선택 대기', endTurn: '턴 정리', gameOver: '게임 끝' };
/** Route eras (갈림길 + 합류 + ≥1 route tile) and fixed stops of a mode's last era (kids: 수능 at 고등 index 0). */
const ROUTE_ERAS = ['young', 'middle_age'];
const FIXED_STOPS = { high: [0] };

/** Server `/admin/api/meta` minTurns[mode][era] when present, else a mirror of server/game/config.js minEraTurns. */
function minTurnsFor(eraId, mode) {
  const fromServer = (meta?.minTurns ?? meta?.minEraTurns)?.[mode]?.[eraId];
  if (Number.isInteger(fromServer)) return fromServer;
  let min = meta?.eras?.limits?.minTurns ?? 1;
  if (ROUTE_ERAS.includes(eraId)) min = Math.max(min, 3);
  const last = meta?.eras?.modes?.[mode]?.eras?.at(-1);
  if (eraId === last && FIXED_STOPS[eraId]) min = Math.max(min, Math.max(...FIXED_STOPS[eraId]) + 2);
  return min;
}

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
      const input = row.querySelector('input');
      input.disabled = !on;
      input.min = String(on ? minTurnsFor(row.dataset.era, sel.value) : minTurns);
    }
    checkEraMins();
  };
  sel.addEventListener('change', syncMode);
  $('#era-rows').addEventListener('input', checkEraMins);
  $('#create-form [name=maxCharacters]')?.addEventListener('input', updateEstimate);
  syncMode();
  $('#era-reset').addEventListener('click', () => {
    for (const e of meta.eras.eras) $(`[name="era_${e.id}"]`).value = e.defaultTurns;
    checkEraMins();
  });
  $('#create-form').addEventListener('submit', onCreate);
  // 턴 제한 시간 options from the server when it lists them (0 = 끄기)
  const tSel = $('#create-form [name=turnTimeoutSec]');
  if (Array.isArray(meta.turnTimeouts) && meta.turnTimeouts.length && tSel) {
    tSel.innerHTML = meta.turnTimeouts.map((v) => `<option value="${Number(v)}"${Number(v) === Number(meta.defaults?.turnTimeoutSec ?? 0) ? ' selected' : ''}>${Number(v) ? `${Number(v)}초` : '끄기'}</option>`).join('');
  }
}

/** Hints for the per-era minimums (청년·중년 ≥ 3: 갈림길·합류 칸 / kids 고등 ≥ 2: 수능 칸 + 골인 칸). → problems */
function checkEraMins() {
  const mode = $('#mode-select').value;
  const included = new Set(meta.eras.modes[mode].eras);
  const problems = [];
  for (const e of meta.eras.eras) {
    const row = document.querySelector(`.era-row[data-era="${e.id}"]`);
    if (!row) continue;
    const min = minTurnsFor(e.id, mode);
    const input = row.querySelector('input');
    const v = input.value === '' ? e.defaultTurns : Number(input.value);
    const bad = included.has(e.id) && Number.isFinite(v) && v < min;
    row.classList.toggle('bad', bad);
    let tag = row.querySelector('.min');
    if (included.has(e.id) && min > (meta.eras.limits?.minTurns ?? 1)) {
      if (!tag) {
        tag = document.createElement('span');
        tag.className = 'min';
        row.querySelector('span').append(' ', tag);
      }
      tag.textContent = `최소 ${min}`;
    } else tag?.remove();
    if (bad) {
      problems.push(
        ROUTE_ERAS.includes(e.id)
          ? `${e.name}: 갈림길·합류 칸이 있어 ${min}턴 이상이어야 해요.`
          : `${e.name}: 이 모드에서는 ${min}턴 이상이어야 해요. (수능 칸과 골인 칸이 겹치지 않게)`,
      );
    }
  }
  $('#era-hint').textContent = problems.join(' ');
  updateEstimate();
  return problems;
}

// Playtest: lifetime mode, default lengths (53 칸), 8 characters ≈ 25 min → ≈ 19.5 s per character turn and a turn
// moves ≈ 5.5 칸 on average (roulette 1–10).
const SEC_PER_TURN = 19.5;
const TILES_PER_TURN = 5.5;
/** 「예상 약 N분」 for the chosen mode / era lengths / max characters. */
function updateEstimate() {
  const out = $('#era-est');
  if (!out) return;
  const mode = $('#mode-select').value;
  const eras = meta.eras.modes[mode]?.eras ?? [];
  let tiles = 0;
  for (const id of eras) {
    const e = meta.eras.eras.find((x) => x.id === id);
    const raw = $(`[name="era_${id}"]`)?.value;
    tiles += raw === '' || raw == null ? e?.defaultTurns ?? 0 : Number(raw) || 0;
  }
  const chars = Math.min(8, Math.max(2, Number($('#create-form [name=maxCharacters]')?.value) || 8));
  const min = Math.round(((tiles / TILES_PER_TURN) * chars * SEC_PER_TURN) / 60);
  out.textContent = tiles ? `총 ${tiles}칸 · 예상 약 ${Math.max(1, min)}분 (캐릭터 ${chars}명 기준)` : '';
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
  const problems = checkEraMins();
  if (problems.length) {
    errEl.innerHTML = problems.map(esc).join('<br>');
    return;
  }
  const body = {
    mode: f.mode.value,
    eraTurns,
    maxCharacters: Number(f.maxCharacters.value),
    startingMoney: Number(f.startingMoney.value),
    turnOrder: f.turnOrder.value,
    mcFrequency: f.mcFrequency.value,
  };
  const timeout = Number(f.turnTimeoutSec?.value ?? 0);
  if (timeout > 0) body.turnTimeoutSec = timeout;
  // Stage 6 「성장 의상」 (default on; only sent when turned off → older servers keep working)
  if (f.growthOutfits && !f.growthOutfits.checked) body.growthOutfits = false;
  // Stage 7 「명절 대잔치」 (default on; only sent when turned off)
  if (f.holidays && !f.holidays.checked) body.holidays = false;
  // 룰렛 실력 모드 (default random; only sent when skill → older servers keep working)
  if (f.rouletteMode?.value === 'skill') body.rouletteMode = 'skill';
  // Stage 9-C 「CPU 허용」 (default off; only sent when on)
  if (f.allowCpu?.checked) body.allowCpu = true;
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
        <td>${r.connected}/${r.players + (r.spectators ?? 0)}${r.spectators ? ` <small class="muted">👀${r.spectators}</small>` : ''}</td>
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
  const players = room.players.filter((p) => p.role !== 'spectator');
  const spectators = room.players.filter((p) => p.role === 'spectator');
  box.hidden = false;
  box.innerHTML = `
    <h2>방 ${esc(room.code)} <span class="status ${esc(room.status)}">${STATUS[room.status]}</span></h2>
    <div class="detail-actions">
      <button class="btn primary small" data-act="start" ${room.status !== 'lobby' || room.characters.length < 2 ? 'disabled' : ''}>게임 시작</button>
      <button class="btn small" data-act="end" ${room.status === 'finished' ? 'disabled' : ''}>강제 종료</button>
      <button class="btn small danger" data-act="delete">삭제</button>
      <button class="btn small ghost" data-act="copy">입장 링크 복사</button>
    </div>
    ${hostTools(room, byId)}
    ${mvpTools(room, byId)}
    <dl class="kv">
      <dt>모드</dt><dd>${esc(eras.modes[room.config.mode].name)}</dd>
      <dt>시대 길이(칸)</dt><dd>${esc(eraText)}</dd>
      <dt>최대 캐릭터</dt><dd>${room.config.maxCharacters}</dd>
      <dt>초기 자금</dt><dd>${room.config.startingMoney.toLocaleString()}만원</dd>
      <dt>턴 순서</dt><dd>${room.config.turnOrder === 'family' ? '가문 순' : '캐릭터 번호 순'}</dd>
      <dt>MC 빈도</dt><dd>${MC_FREQ_LABEL[room.config.mcFrequency ?? 'normal'] ?? '보통'}</dd>
      <dt>턴 제한 시간</dt><dd>${room.config.turnTimeoutSec ? `${room.config.turnTimeoutSec}초` : '끄기'}</dd>
      <dt>성장 의상</dt><dd>${room.config.growthOutfits === false ? '끄기 (로비에서 고른 옷 그대로)' : '켜기 (시대·직업 의상)'}</dd>
      <dt>명절 대잔치</dt><dd>${room.config.holidays === false ? '끄기' : '켜기 (설날·추석 미니게임)'}</dd>
      <dt>룰렛</dt><dd>${room.config.rouletteMode === 'skill' ? '🎯 실력 모드 (흔들기·타이밍, 훈수 베팅 없음)' : '완전 랜덤'}</dd>
      <dt>CPU 허용</dt><dd>${room.config.allowCpu ? '켜기 (방장도 CPU 추가 가능)' : '끄기 (관리자만 추가)'}</dd>
      ${room.turn ? `<dt>턴 순서(실제)</dt><dd>${room.turn.order.map((id) => esc(byId.get(id)?.name ?? id)).join(' → ')}</dd>` : ''}
    </dl>
    <h3>참가자 (${players.length}/4)${spectators.length ? ` <small class="muted">· 👀 관전 ${spectators.length}</small>` : ''}</h3>
    <ul class="detail-players">
      ${spectators.map((p) => `<li><span class="dot ${p.connected ? 'on' : 'off'}"></span>👀 ${esc(p.name)} <small class="muted">관전</small></li>`).join('')}
      ${players.map((p) => `<li><span class="dot ${p.connected ? 'on' : 'off'}"></span>${esc(p.name)} ${p.ready ? '✅' : ''} <small class="muted">캐릭터 ${room.characters.filter((c) => c.ownerId === p.id).length}</small></li>`).join('') || '<li class="muted">없음</li>'}
    </ul>
    <h3>캐릭터 (${room.characters.length}/${room.config.maxCharacters})</h3>
    <div class="detail-chars">
      ${room.characters.map((c) => `<div class="detail-char">${renderAvatar(c.avatar, { size: 56 })}<div><b>${esc(c.name)}</b></div><small class="muted">${ownerHtml(c)}</small></div>`).join('') || '<p class="muted">없음</p>'}
    </div>
    ${cpuTools(room)}
    <details ${openJson ? 'open' : ''}><summary>상태 JSON</summary><pre class="json">${esc(JSON.stringify(room, null, 2))}</pre></details>`;
}

/** Stage 9-C: add / remove CPU characters in the lobby (a CPU-only room can be started for demos / TV mode). */
function cpuTools(room) {
  if (room.status !== 'lobby') return '';
  const cpus = room.characters.filter((c) => c.ownerId === 'cpu');
  const full = room.characters.length >= room.config.maxCharacters;
  return `
    <div class="cpu-tools">
      ${cpus.map((c) => `<button class="btn tiny ghost" data-cpu-remove="${esc(c.id)}" title="CPU 빼기">🤖 ${esc(c.name)} ✕</button>`).join(' ')}
      <button class="btn tiny" data-act="addCpu" ${full ? 'disabled' : ''}>🤖 CPU 추가</button>
    </div>`;
}

/** Host tools for a running game: current turn / phase + timeout, spin for, skip turn. */
function hostTools(room, byId) {
  if (room.status !== 'playing' || !room.turn) return '';
  const t = room.turn;
  const cur = byId.get(t.order?.[t.currentIndex]);
  const p = t.pending;
  const now = Date.now();
  const left = (at) => (at ? ` · 남은 ${Math.max(0, Math.ceil((at - now) / 1000))}초` : '');
  const waiting = p ? p.forCharacterIds.filter((id) => !(p.answered ?? []).includes(id)).map((id) => byId.get(id)?.name ?? id) : [];
  const canSpin = t.phase === 'awaitSpin' && !p;
  return `
    <div class="host-box">
      <h3>🎛 진행 도구</h3>
      <p class="host-now">턴 ${t.turnNo} · ${t.round}라운드 · <b>${esc(cur?.name ?? '-')}</b>${cur ? ` <small class="muted">(${esc(cur.ownerName ?? '')})</small>` : ''}
        · <span class="phase">${esc(PHASE_LABEL[t.phase] ?? t.phase)}</span>${canSpin ? left(t.spinDeadlineAt) : ''}
        ${p ? `<br>⏳ ${esc(p.title ?? '선택')} — ${esc(waiting.join(', ') || '없음')} 선택 중${left(p.deadlineAt)}` : ''}</p>
      <div class="host-actions">
        <button class="btn small" data-host="timeout" ${p ? '' : 'disabled'} title="대기 중인 선택을 기본 선택으로 처리해요">⏱ 프롬프트 시간 초과 처리</button>
        <button class="btn small" data-host="forceSpin" ${canSpin ? '' : 'disabled'} title="현재 캐릭터 대신 룰렛을 돌려요">🎡 대신 룰렛 돌리기</button>
        <button class="btn small danger" data-host="skipTurn" ${canSpin ? '' : 'disabled'} title="현재 캐릭터의 이번 턴을 넘겨요">⏭ 이번 턴 건너뛰기</button>
      </div>
      <p class="muted small host-hint">자리를 비운 사람이 있을 때 쓰세요. 결과는 모든 화면에 바로 반영돼요.</p>
    </div>`;
}

/** Stage 9: the MVP vote of a finished game (live counts, 「투표 마감」 → mvpDecided at once). */
function mvpTools(room, byId) {
  const mvp = room.status === 'finished' ? room.result?.mvp : null;
  if (!mvp) return '';
  const counts = {};
  for (const id of Object.values(mvp.votes ?? {})) counts[id] = (counts[id] ?? 0) + 1;
  const list = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => `${esc(byId.get(id)?.name ?? id)} ${n}표`)
    .join(' · ');
  const left = mvp.closesAt ? Math.max(0, Math.ceil((mvp.closesAt - Date.now()) / 1000)) : null;
  const winner = mvp.winner ? byId.get(mvp.winner)?.name ?? mvp.winner : null;
  return `
    <div class="host-box">
      <h3>👑 MVP 투표</h3>
      <p class="host-now">${winner ? `MVP: <b>${esc(winner)}</b>` : `진행 중${left != null ? ` · 남은 ${left}초` : ''}`} · ${list || '아직 표가 없어요'}</p>
      <div class="host-actions">
        <button class="btn small" data-host="closeVote" ${mvp.closed || mvp.winner ? 'disabled' : ''} title="지금까지의 표로 MVP를 정해요">🗳️ 투표 마감</button>
      </div>
    </div>`;
}

const HOST_DONE = { timeout: '선택을 기본값으로 처리했어요.', forceSpin: '대신 룰렛을 돌렸어요.', skipTurn: '이번 턴을 건너뛰었어요.', closeVote: 'MVP 투표를 마감했어요.' };

async function onDetailClick(ev) {
  const host = ev.target.closest('[data-host]')?.dataset.host;
  if (host && selectedId) {
    if (host === 'skipTurn' && !confirm('현재 캐릭터의 이번 턴을 건너뛸까요?')) return;
    try {
      await req('POST', `/admin/api/rooms/${selectedId}/actions`, { type: host });
      toast(HOST_DONE[host] ?? '처리했어요.');
    } catch (err) {
      toast(err.message || '처리하지 못했어요.', 'error');
    }
    await refresh().catch(() => {});
    return;
  }
  const cpuRemove = ev.target.closest('[data-cpu-remove]')?.dataset.cpuRemove;
  if (cpuRemove && selectedId) {
    try {
      await req('DELETE', `/admin/api/rooms/${selectedId}/cpu/${cpuRemove}`);
      toast('CPU를 뺐어요.');
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }
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
    } else if (act === 'addCpu') {
      const { room } = await req('POST', `/admin/api/rooms/${selectedId}/cpu`, {});
      toast(`🤖 ${room.characters.at(-1)?.name ?? 'CPU'} 참가!`);
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
