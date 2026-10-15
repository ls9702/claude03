// Chiikawa conversion (CH-1) — lobby character picker (replaces the human customizer, ui/customize.js = legacy).
// Pick one of the roster characters (cards with an idle animation; two players may pick the same one) and dress it with
// props in five slots (머리 / 얼굴 / 목 / 손 / 등, 「없음」 + thumbnails), 🎲 random look / slot, a live preview (2D rig with
// action chips; the 3D board pawn via scene/pawnPreview.js when WebGL is available) and the name.
//   openCharaPicker(host, {title, initial: {name, avatar}, submitLabel, onSave({name, avatar}), onCancel, meta})
//     → {destroy, getAvatar}
// Pure helpers (node-tested): propThumbCrop, randomizeSlot, autoName, rosterCardsModel.
import { charaSvg, renderChara } from './chara.js';
import { bindNameInput } from './nameInput.js';
import { NAME_MAX, cleanName, nameFits } from '../format.js';
import { PROP_SLOTS, normalizeLook, propInfo, propList, propSlots, randomLook, rosterInfo, rosterList } from '../shared/roster.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Crop of a prop thumbnail (the slot's region of the current character). */
export function propThumbCrop(slot) {
  return slot === 'head' ? 'head' : slot === 'face' ? 'face' : slot === 'neck' ? 'bust' : 'fit';
}

/** Random prop for one slot (always a change when the slot has ≥ 2 choices incl. 「없음」). */
export function randomizeSlot(look, slot, meta = null, rnd = Math.random) {
  const opts = [null, ...propList(meta, slot).map((p) => p.id)];
  const cur = look.props?.[slot] ?? null;
  const pool = opts.filter((id) => id !== cur);
  const pick = pool.length ? pool[Math.floor(rnd() * pool.length) % pool.length] : cur;
  const props = { ...(look.props ?? {}) };
  if (pick) props[slot] = pick;
  else delete props[slot];
  return { ...look, props };
}

/** The name field follows the chosen character until the player types their own name. */
export function autoName(current, prevLook, nextLook, meta = null) {
  const prev = prevLook ? rosterInfo(normalizeLook(prevLook, meta).character, meta).name : '';
  const cur = String(current ?? '');
  if (cur && cur !== prev) return cur;
  return rosterInfo(normalizeLook(nextLook, meta).character, meta).name;
}

/** Roster cards view model [{id, name, icon, desc, traits, on}]. */
export function rosterCardsModel(look, meta = null) {
  const cur = normalizeLook(look, meta).character;
  return rosterList(meta).map((c) => {
    const info = rosterInfo(c.id, meta);
    return { id: info.id, name: info.name, icon: info.icon, desc: info.desc, traits: info.traits, on: info.id === cur };
  });
}

/** Short description of the chosen props ("🎀 리본 · 🎈 풍선"). */
export function propsSummary(look, meta = null) {
  return PROP_SLOTS.map((s) => look.props?.[s])
    .filter(Boolean)
    .map((id) => propInfo(id, meta))
    .filter(Boolean)
    .map((p) => `${p.icon} ${p.name}`);
}

function want3dPreview() {
  try {
    if (localStorage.getItem('jinsei.boardMode') === '2d') return false;
  } catch {
    /* storage unavailable */
  }
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

const PREVIEW_ACTIONS = [
  { id: 'wave', label: '👋 인사' },
  { id: 'jump', label: '🎉 점프' },
  { id: 'cheer', label: '🙌 만세' },
  { id: 'cry', label: '😭 울기' },
];
const ACTION_FACE = { wave: 'joy', jump: 'joy', cheer: 'joy', cry: 'cry' };

/**
 * The picker dialog in `host` (full-screen on phones, a centred modal on desktop; reuses the `.cz-*` dialog styles).
 * @returns {{destroy(): void, getAvatar(): object}}
 */
export function openCharaPicker(host, { title = '캐릭터 고르기', initial = {}, submitLabel = '저장', onSave, onCancel, meta = null } = {}) {
  let look = initial.avatar ? normalizeLook(initial.avatar, meta) : randomLook(meta, Math.random, { maxProps: 1 });
  let slot = PROP_SLOTS[0];
  try {
    const saved = localStorage.getItem('jinsei.cpSlot');
    if (PROP_SLOTS.includes(saved)) slot = saved;
  } catch {
    /* ignore */
  }
  let busy = false;
  let destroyed = false;
  let view = '2d';
  let preview3d = null;
  const can3d = want3dPreview();
  const slots = propSlots(meta);

  host.innerHTML = `
    <div class="cz-overlay cp-overlay">
      <form class="customizer cp" novalidate role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <header class="cz-head">
          <h3>${esc(title)}</h3>
          <button type="button" class="cz-close" data-act="cancel" aria-label="닫기">✕</button>
        </header>
        <div class="cz-body">
          <section class="cz-stage">
            <div class="cp-preview" aria-live="polite">
              <div class="cp-2d"></div>
              <canvas class="cz-3d" width="260" height="260" hidden aria-label="3D 미리보기"></canvas>
            </div>
            <p class="cp-who"></p>
            <div class="cp-chosen" aria-label="고른 소품"></div>
            <div class="cz-stage-tools">
              <div class="cz-seg cz-view" role="group" aria-label="미리보기 방식"${can3d ? '' : ' hidden'}>
                <button type="button" data-view="2d" aria-pressed="true">2D</button>
                <button type="button" data-view="3d" aria-pressed="false">3D</button>
              </div>
              <div class="cz-expr cp-acts" role="group" aria-label="동작 미리보기">
                ${PREVIEW_ACTIONS.map((a) => `<button type="button" class="cz-chip" data-action="${a.id}">${esc(a.label)}</button>`).join('')}
              </div>
            </div>
            <label class="field cz-name">
              <span>이름 <span class="name-count" data-name-count aria-live="polite"></span></span>
              <input name="name" maxlength="40" required placeholder="캐릭터 이름 (12자까지)" value="${esc(initial.name ?? '')}" autocomplete="off">
            </label>
          </section>
          <section class="cz-editor">
            <div class="cz-cat-head cp-head"><span class="cz-cat-label" id="cp-lbl-roster">캐릭터</span><span class="cz-cat-value cp-roster-note">같은 캐릭터를 여러 명이 골라도 돼요 · 소품으로 꾸며요</span></div>
            <div class="cp-roster" role="radiogroup" aria-labelledby="cp-lbl-roster"></div>
            <div class="cp-slots" role="tablist" aria-label="소품 자리">
              ${slots.map((s) => `<button type="button" role="tab" id="cp-tab-${s.id}" data-slot="${s.id}" aria-controls="cp-props" aria-selected="false" tabindex="-1">${esc(s.icon)} ${esc(s.name)}</button>`).join('')}
            </div>
            <div class="cp-props" id="cp-props" role="radiogroup" aria-label="소품"></div>
            <div class="cz-randoms cp-randoms">
              <button type="button" class="btn small ghost" data-act="random-slot">🎲 이 자리만 랜덤</button>
              <button type="button" class="btn small ghost" data-act="random">🎲 전체 랜덤</button>
            </div>
          </section>
        </div>
        <p class="form-error" role="alert"></p>
        <footer class="cz-actions">
          <button type="button" class="btn ghost" data-act="cancel">취소</button>
          <button type="submit" class="btn primary">${esc(submitLabel)}</button>
        </footer>
      </form>
    </div>`;

  const form = host.querySelector('form');
  const nameInput = form.elements.name;
  bindNameInput(nameInput, form.querySelector('[data-name-count]'));
  if (!nameInput.value) nameInput.value = rosterInfo(look.character, meta).name;
  const errEl = form.querySelector('.form-error');
  const prev2d = form.querySelector('.cp-2d');
  const canvas3d = form.querySelector('.cz-3d');
  const rosterEl = form.querySelector('.cp-roster');
  const propsEl = form.querySelector('.cp-props');
  document.body.classList.add('cz-open');

  // roster cards: one live (idle) figure each, built once
  rosterEl.innerHTML = rosterCardsModel(look, meta)
    .map((c) => `<button type="button" class="cp-card" role="radio" aria-checked="false" tabindex="-1" data-char="${esc(c.id)}" title="${esc(c.desc)}"><span class="cp-fig"></span><b>${esc(c.name)}</b></button>`)
    .join('');
  for (const card of rosterEl.querySelectorAll('.cp-card')) {
    const fig = renderChara({ character: card.dataset.char, props: {} }, { size: 104, crop: 'fit', meta, title: card.querySelector('b').textContent });
    card.querySelector('.cp-fig').replaceWith(fig);
  }

  let previewEl = null;
  function refreshPreview() {
    previewEl?.stop?.();
    previewEl = renderChara(look, { size: 300, crop: 'fit', meta, title: '미리보기', pose: 'idle' });
    prev2d.replaceChildren(previewEl);
    const info = rosterInfo(look.character, meta);
    form.querySelector('.cp-who').innerHTML = `${esc(info.icon)} ${esc(info.name)}${info.desc ? `<small>${esc(info.desc)}</small>` : ''}`;
    form.querySelector('.cp-chosen').innerHTML = propsSummary(look, meta).map((t) => `<span class="cp-chip">${esc(t)}</span>`).join('') || '<span class="cp-chip">소품 없음</span>';
  }

  function renderProps() {
    const crop = propThumbCrop(slot);
    const opts = propList(meta, slot);
    const cur = look.props?.[slot] ?? null;
    const base = { character: look.character, props: { ...(look.props ?? {}) } };
    const thumb = (id) => {
      const props = { ...base.props };
      if (id) props[slot] = id;
      else delete props[slot];
      return charaSvg({ character: look.character, props }, { size: 64, crop, meta, shadow: false });
    };
    propsEl.innerHTML =
      `<button type="button" class="cp-prop${cur ? '' : ' on'}" role="radio" aria-checked="${!cur}" tabindex="${cur ? -1 : 0}" data-prop=""><span class="cp-thumb"><span class="cp-none">🚫</span></span><span>없음</span></button>` +
      opts
        .map((p) => `<button type="button" class="cp-prop${p.id === cur ? ' on' : ''}" role="radio" aria-checked="${p.id === cur}" tabindex="${p.id === cur ? 0 : -1}" data-prop="${esc(p.id)}" title="${esc(p.name)}"><span class="cp-thumb">${thumb(p.id)}</span><span>${esc(p.icon)} ${esc(p.name)}</span></button>`)
        .join('');
  }

  function syncRoster() {
    for (const card of rosterEl.querySelectorAll('.cp-card')) {
      const on = card.dataset.char === look.character;
      card.classList.toggle('on', on);
      card.setAttribute('aria-checked', String(on));
      if (!rosterEl.contains(document.activeElement)) card.tabIndex = on ? 0 : -1;
    }
  }

  function selectSlot(id, focus = false) {
    slot = id;
    for (const b of form.querySelectorAll('[data-slot]')) {
      const on = b.dataset.slot === id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    }
    try {
      localStorage.setItem('jinsei.cpSlot', id);
    } catch {
      /* ignore */
    }
    renderProps();
  }

  function setLook(next, { keepFocus = null } = {}) {
    const prevLook = look;
    look = normalizeLook(next, meta);
    nameInput.value = autoName(cleanName(nameInput.value), prevLook, look, meta);
    nameInput.dispatchEvent(new Event('input'));
    refreshPreview();
    syncRoster();
    renderProps();
    preview3d?.set(look);
    if (keepFocus) form.querySelector(keepFocus)?.focus();
  }

  function setView(next) {
    view = next === '3d' && can3d ? '3d' : '2d';
    for (const b of form.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
    prev2d.hidden = view !== '2d';
    form.querySelector('.cp-acts').hidden = view !== '2d';
    canvas3d.hidden = view !== '3d' || !preview3d;
    if (view === '3d' && !preview3d) {
      import('../scene/pawnPreview.js')
        .then(({ createPawnPreview }) => {
          if (destroyed) return;
          preview3d = createPawnPreview(canvas3d, { defs: meta, size: 260 }); // CH-C: defs = the whole /api/meta
          preview3d.set(look);
          canvas3d.hidden = view !== '3d';
        })
        .catch(() => {
          setView('2d');
          form.querySelector('.cz-view').hidden = true;
        });
    }
  }

  // ----- events -----
  form.addEventListener('click', (ev) => {
    const card = ev.target.closest('.cp-card');
    if (card) {
      if (card.dataset.char !== look.character) setLook({ ...look, character: card.dataset.char });
      return;
    }
    const prop = ev.target.closest('.cp-prop');
    if (prop) {
      const props = { ...(look.props ?? {}) };
      if (prop.dataset.prop) props[slot] = prop.dataset.prop;
      else delete props[slot];
      setLook({ ...look, props }, { keepFocus: `.cp-prop[data-prop="${CSS.escape(prop.dataset.prop)}"]` });
      return;
    }
    const tab = ev.target.closest('[data-slot]');
    if (tab) return selectSlot(tab.dataset.slot);
    const v = ev.target.closest('[data-view]');
    if (v) return setView(v.dataset.view);
    const a = ev.target.closest('[data-action]');
    if (a && previewEl) {
      const action = a.dataset.action;
      previewEl.setState({ expression: ACTION_FACE[action] ?? 'joy' });
      const done = action === 'cry' ? previewEl.play('cry', { times: 3 }) : action === 'jump' ? previewEl.play('jump') : previewEl.play(action, { times: 2 });
      done.then(() => previewEl?.setState({ expression: 'neutral' }));
      return;
    }
    const act = ev.target.closest('[data-act]')?.dataset.act;
    if (act === 'random') setLook(randomLook(meta));
    else if (act === 'random-slot') setLook(randomizeSlot(look, slot, meta));
    else if (act === 'cancel') onCancel?.();
  });

  form.addEventListener('keydown', (ev) => {
    const tab = ev.target.closest?.('[data-slot]');
    if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) {
      ev.preventDefault();
      const i = PROP_SLOTS.indexOf(tab.dataset.slot);
      const n = PROP_SLOTS.length;
      const j = ev.key === 'Home' ? 0 : ev.key === 'End' ? n - 1 : (i + (ev.key === 'ArrowRight' ? 1 : -1) + n) % n;
      selectSlot(PROP_SLOTS[j], true);
      return;
    }
    const item = ev.target.closest?.('.cp-card, .cp-prop');
    if (item && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(ev.key)) {
      ev.preventDefault();
      const items = [...item.parentElement.children];
      const i = items.indexOf(item);
      const cols = Math.max(1, Math.round(item.parentElement.clientWidth / Math.max(1, item.offsetWidth)));
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[ev.key];
      const j = ev.key === 'Home' ? 0 : ev.key === 'End' ? items.length - 1 : Math.min(items.length - 1, Math.max(0, i + step));
      for (const b of items) b.tabIndex = b === items[j] ? 0 : -1;
      items[j].focus();
      items[j].scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      return;
    }
    if (item && (ev.key === 'Enter' || ev.key === ' ')) {
      ev.preventDefault();
      item.click();
      return;
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      onCancel?.();
    }
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (busy) return;
    const name = cleanName(nameInput.value); // same cleaning as the server (invisible / bidi characters)
    if (!name) {
      errEl.textContent = '이름을 입력하세요.';
      nameInput.focus();
      return;
    }
    if (!nameFits(name)) {
      errEl.textContent = `이름은 ${NAME_MAX}자까지 쓸 수 있어요.`;
      nameInput.focus();
      return;
    }
    busy = true;
    errEl.textContent = '';
    try {
      await onSave?.({ name, avatar: { character: look.character, props: { ...(look.props ?? {}) } } });
    } catch (err) {
      errEl.textContent = err.message || '저장하지 못했습니다.';
    } finally {
      busy = false;
    }
  });

  refreshPreview();
  syncRoster();
  selectSlot(slot);
  setView('2d');
  requestAnimationFrame(() => !destroyed && form.querySelector('.cp-card.on')?.focus({ preventScroll: true }));

  return {
    getAvatar: () => ({ character: look.character, props: { ...(look.props ?? {}) } }),
    destroy() {
      destroyed = true;
      previewEl?.stop?.();
      for (const f of rosterEl.querySelectorAll('.chara')) f.stop?.();
      preview3d?.dispose();
      preview3d = null;
      host.innerHTML = '';
      document.body.classList.remove('cz-open');
    },
  };
}
