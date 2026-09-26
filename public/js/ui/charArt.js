// "✨ AI 일러스트 만들기" in the customizer footer (Stage 5.5-D). Lives entirely inside `.cz-ai-slot`.
//
// mountArtSlot(slot, { initial, target, getAvatar }) → { update(), destroy() }
//   target  = { roomId, charId } of the character being edited (optional: when omitted it is found in the
//             saved room by name + avatar of `initial`, among my characters). New characters get nothing.
// Visible only when `/api/meta` → features.charArt (a server key is configured). States (character.art):
//   none → button · pending → progress "AI가 그리는 중… 3/11" · ready → thumbnail + "완성!" · failed → reason
//   (+ retry while the character's one generation is unused). While pending, progress comes from the room SSE
//   `charArt {charId, status, progress, reason?}` event; the room is polled once a second only while SSE is down.
import { api, getMeta, onCharArt, savedRoomId, sseConnected } from '../api.js';

const TOTAL = 11;
const POLL_MS = 1000;
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function stable(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])]));
  return v;
}
const same = (a, b) => JSON.stringify(stable(a ?? {})) === JSON.stringify(stable(b ?? {}));

/** Small scoped styles (the footer slot is the only place this UI lives). */
function injectStyle() {
  if (document.getElementById('cza-style')) return;
  const st = document.createElement('style');
  st.id = 'cza-style';
  st.textContent = `
.cza { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 13px; }
.cza-btn { white-space: nowrap; }
.cza-bar { width: 84px; height: 8px; border-radius: 4px; background: rgba(0,0,0,.12); overflow: hidden; flex: none; }
.cza-bar i { display: block; height: 100%; background: linear-gradient(90deg, #ff9fc8, #9f7bff); transition: width .4s; }
.cza-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cza-muted { opacity: .7; font-size: 12px; }
.cza-err { color: #c62828; font-size: 12px; max-width: 220px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.cza-thumb { width: 40px; height: 40px; border-radius: 8px; background: #fff4e0 no-repeat 50% 32% / 250% auto; border: 1px solid rgba(0,0,0,.12); flex: none; }
.cza-done { font-weight: 700; color: #7b3fe4; }
@media (max-width: 520px) { .cza-bar { width: 56px; } .cza-err { max-width: 150px; } }`;
  document.head.append(st);
}

export function mountArtSlot(slot, { initial = {}, target = null, getAvatar = () => initial.avatar } = {}) {
  if (!slot) return { update() {}, destroy() {} };
  let destroyed = false;
  let enabled = false;
  let ids = target?.roomId && target?.charId ? { roomId: target.roomId, charId: target.charId } : null;
  let char = null; // latest public character view
  let busy = false;
  let error = '';
  let pollTimer = null;

  async function findTarget() {
    if (ids || !initial.avatar) return ids;
    const roomId = savedRoomId();
    if (!roomId) return null;
    const room = await api('GET', `/api/rooms/${encodeURIComponent(roomId)}`);
    const c = room.characters?.find((x) => x.isMe && x.name === initial.name && same(x.avatar, initial.avatar));
    if (!c) return null;
    char = c;
    ids = { roomId, charId: c.id };
    return ids;
  }

  async function reload() {
    if (!ids) return;
    const room = await api('GET', `/api/rooms/${encodeURIComponent(ids.roomId)}`);
    char = room.characters?.find((x) => x.id === ids.charId) ?? null;
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    if (destroyed || char?.art?.status !== 'pending') return;
    // SSE up → progress arrives as `charArt` events (a reconnect reloads once); poll only while it's down
    pollTimer = setTimeout(async () => {
      if (sseConnected()) return schedulePoll();
      try {
        await reload();
      } catch {
        /* transient; keep polling */
      }
      render();
      schedulePoll();
    }, POLL_MS);
  }

  /** SSE `charArt` event → progress in place; ready/failed → reload once for files / reason. */
  async function onArtEvent(ev) {
    if (destroyed || !ids) return;
    if (ev?.reconnected) {
      if (char?.art?.status === 'pending') {
        await reload().catch(() => {});
        render();
        schedulePoll();
      }
      return;
    }
    if (ev?.charId !== ids.charId || !char) return;
    const status = ev.status ?? char.art?.status;
    char = { ...char, art: { ...(char.art ?? {}), status, progress: ev.progress ?? char.art?.progress ?? 0, ...(ev.reason ? { reason: ev.reason } : {}) } };
    if (status !== 'pending') {
      clearTimeout(pollTimer);
      // the room state (files / reason) is committed a moment after the event (throttled) → reload until it shows
      for (let i = 0; i < 12 && !destroyed; i++) {
        await reload().catch(() => {});
        if (char?.art?.status === status) break;
        char = char ? { ...char, art: { ...(char.art ?? {}), status: 'pending', progress: 1 } } : char;
        render();
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    render();
    schedulePoll();
  }
  const offArt = onCharArt(onArtEvent);

  async function request() {
    if (busy || !ids) return;
    busy = true;
    error = '';
    render();
    try {
      const res = await api('POST', `/api/rooms/${encodeURIComponent(ids.roomId)}/characters/${encodeURIComponent(ids.charId)}/art`);
      char = res.room?.characters?.find((x) => x.id === ids.charId) ?? char;
      if (char && res.art) char = { ...char, art: res.art };
    } catch (err) {
      error = err.message || 'AI 일러스트를 요청하지 못했어요.';
    } finally {
      busy = false;
    }
    render();
    schedulePoll();
  }

  function render() {
    if (destroyed) return;
    if (!enabled || !ids || !char) {
      slot.replaceChildren();
      return;
    }
    const edited = !same(getAvatar(), char.avatar);
    const art = edited ? null : char.art;
    const used = (char.artGenerations ?? 0) >= 1;
    let html;
    if (edited) {
      html = '<span class="cza-muted">저장하면 AI 일러스트를 만들 수 있어요</span>';
    } else if (art?.status === 'pending') {
      const done = Math.round((art.progress ?? 0) * TOTAL);
      html = `<span class="cza-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${TOTAL}" aria-valuenow="${done}"><i style="width:${Math.round((art.progress ?? 0) * 100)}%"></i></span>
        <span class="cza-text">AI가 그리는 중… ${done}/${TOTAL}</span>`;
    } else if (art?.status === 'ready' && art.files?.base) {
      // zoomed on the face of the 1024×1536 canvas (figure box y 371..1303)
      html = `<span class="cza-thumb" role="img" aria-label="AI 일러스트" style="background-image:url('${esc(art.files.base)}')"></span><span class="cza-done">완성!</span>`;
    } else if (art?.status === 'failed') {
      html = `<span class="cza-err" title="${esc(art.reason)}">⚠ ${esc(art.reason || 'AI 일러스트를 만들지 못했어요.')}</span>${
        used ? '' : '<button type="button" class="btn small ghost cza-btn" data-cza="go">다시 시도</button>'
      }`;
    } else if (used) {
      html = '<span class="cza-muted">AI 일러스트는 캐릭터마다 한 번만 만들 수 있어요</span>';
    } else {
      html = `<button type="button" class="btn small cza-btn" data-cza="go"${busy ? ' disabled' : ''}>✨ AI 일러스트 만들기</button>`;
    }
    if (error) html += `<span class="cza-err" role="alert">${esc(error)}</span>`;
    const box = document.createElement('div');
    box.className = 'cza';
    box.setAttribute('aria-live', 'polite');
    box.innerHTML = html;
    slot.replaceChildren(box);
  }

  const onClick = (ev) => {
    if (ev.target.closest('[data-cza="go"]')) {
      ev.preventDefault();
      request();
    }
  };
  slot.addEventListener('click', onClick);

  (async () => {
    try {
      const meta = await getMeta(); // fresh: the admin may have added / removed the key meanwhile
      enabled = Boolean(meta?.features?.charArt);
      if (!enabled || destroyed) return;
      injectStyle();
      await findTarget();
      if (ids && !char) await reload();
    } catch {
      enabled = false;
    }
    render();
    schedulePoll();
  })();

  return {
    /** Re-render (the edited avatar changed). */
    update: () => render(),
    destroy() {
      destroyed = true;
      offArt();
      clearTimeout(pollTimer);
      slot.removeEventListener('click', onClick);
      slot.replaceChildren();
    },
  };
}
