// Character customizer (Stage 5.5): tabs from avatars.json (`tabs`), option grids (color swatches / zoomed
// portrait thumbnails), a big live preview (2D portrait with expression chips | 3D pawn), random buttons.
//
// Part C hook: `setPreviewRenderer(fn)` swaps the renderer of the big 2D preview (default = SVG renderAvatar).
//   fn(avatar, { expression, size, defs, crop }) → string (markup) | HTMLElement | Promise<string|HTMLElement|null>
//   (`crop` = 'bust' | 'full' from the 「전신 보기」 chip; the SVG default ignores it)
//   A Promise keeps the current preview until it resolves; stale results are dropped; null / a throw / a rejection
//   falls back to the SVG portrait. `setPreviewRenderer(null)` restores the default. Open customizers re-render.
import { getAvatarDefs, normalizeAvatar, outfitTintable, randomAvatar, renderAvatar } from './avatar2d.js';
import { mountArtSlot } from './charArt.js';
import { bindNameInput } from './nameInput.js';
import { NAME_MAX, nameFits } from '../format.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const FALLBACK_LABELS = {
  body: '체형', build: '체격', skin: '피부', face: '얼굴형', eyes: '눈', mouth: '입', cheek: '볼',
  hair: '머리 모양', hairColor: '머리색', outfit: '의상', outfitColor: '의상 색', accessory: '액세서리',
};

/** Categories drawn as round color swatches (options carry `color`). */
export const COLOR_PARTS = ['skin', 'hairColor', 'outfitColor'];

/** Zoom region (AVATAR_CROPS key) of each category's thumbnails. */
export const THUMB_CROPS = {
  body: 'full', build: 'full', face: 'face', eyes: 'eyes', mouth: 'eyes', cheek: 'eyes',
  hair: 'head', outfit: 'torso', accessory: 'head',
};

/** Categories with more options than this get a 2-row horizontally scrolling grid on mobile. */
export const MANY_OPTIONS = 10;

/** Expression chips of the 2D preview. */
export const PREVIEW_EXPRESSIONS = [
  { id: 'neutral', name: '기본' },
  { id: 'joy', name: '기쁨' },
  { id: 'cry', name: '울음' },
  { id: 'shock', name: '놀람' },
];

/**
 * Tabs for the customizer: `defs.tabs` filtered to known categories (each category once, first tab wins);
 * categories no tab lists go to a trailing 「기타」 tab. Pure (node-tested).
 * @returns {{id: string, name: string, parts: string[]}[]}
 */
export function buildTabs(defs) {
  const known = new Set(defs.order);
  const seen = new Set();
  const tabs = [];
  for (const t of defs.tabs ?? []) {
    const parts = [];
    for (const p of t.parts ?? []) {
      if (!known.has(p) || seen.has(p)) continue;
      seen.add(p);
      parts.push(p);
    }
    if (parts.length) tabs.push({ id: String(t.id), name: String(t.name ?? t.id), parts });
  }
  const rest = defs.order.filter((p) => !seen.has(p));
  if (rest.length) tabs.push({ id: 'etc', name: tabs.length ? '기타' : '꾸미기', parts: rest });
  return tabs;
}

/** Randomize only `parts` of an avatar (always changes something when possible). */
export function randomizeParts(avatar, parts, defs, rnd = Math.random) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const next = { ...avatar };
    for (const key of parts) {
      const opts = defs.parts[key];
      if (opts?.length) next[key] = opts[Math.floor(rnd() * opts.length)].id;
    }
    // a new outfit color under a fixed-color outfit is invisible → does not count as a change
    const visible = (k) => next[k] !== avatar[k] && !(k === 'outfitColor' && !outfitTintable(next.outfit, defs));
    if (parts.some(visible)) return next;
  }
  return { ...avatar };
}

// ---------- preview renderer hook (part C) ----------

export function defaultPreviewRenderer(avatar, { expression = 'neutral', size = 220 } = {}) {
  return renderAvatar(avatar, { size, bg: '#fff4e0', expression, title: '미리보기' });
}

let previewRenderer = defaultPreviewRenderer;
const openInstances = new Set();

/** Replace the big 2D preview renderer (null → default SVG). See the file header for the contract. */
export function setPreviewRenderer(fn) {
  previewRenderer = typeof fn === 'function' ? fn : defaultPreviewRenderer;
  for (const inst of openInstances) inst.refreshPreview();
}

export function getPreviewRenderer() {
  return previewRenderer;
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

const THUMB_CACHE_MAX = 400;
const thumbCache = new Map(); // `${part}|${avatar json}` → svg string

/** Avatar used for a thumbnail of `part = id`: glasses/caps and outfit headwear would hide eyes/hair. */
export function thumbVariant(avatar, part, id) {
  const v = { ...avatar, [part]: id };
  if (part !== 'accessory') v.accessory = 'none';
  return v;
}

function thumbSvg(part, avatar) {
  const key = `${part}|${JSON.stringify(avatar)}`;
  let svg = thumbCache.get(key);
  if (!svg) {
    svg = renderAvatar(avatar, { size: 56, crop: THUMB_CROPS[part] ?? 'full', hat: ['outfit', 'body', 'build'].includes(part) });
    if (thumbCache.size >= THUMB_CACHE_MAX) thumbCache.delete(thumbCache.keys().next().value);
    thumbCache.set(key, svg);
  }
  return svg;
}

/**
 * Arrow-key target in a grid of buttons laid out in any flow (wrapping rows, or 2-row column flow on mobile):
 * the nearest item in that direction on the same row/column, else the previous/next item (wrapping).
 */
function nextInGrid(items, i, key) {
  const rect = (el) => el.getBoundingClientRect();
  const r0 = rect(items[i]);
  const cx = r0.left + r0.width / 2;
  const cy = r0.top + r0.height / 2;
  const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
  const sign = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : -1;
  let best = -1;
  let bestD = Infinity;
  items.forEach((el, k) => {
    if (k === i) return;
    const r = rect(el);
    const dx = r.left + r.width / 2 - cx;
    const dy = r.top + r.height / 2 - cy;
    const along = horizontal ? dx : dy;
    const across = horizontal ? dy : dx;
    if (along * sign <= 1 || Math.abs(across) > (horizontal ? r0.height : r0.width) / 2) return;
    if (Math.abs(along) < bestD) {
      bestD = Math.abs(along);
      best = k;
    }
  });
  if (best >= 0) return best;
  return (i + sign + items.length) % items.length;
}

/**
 * Render a customizer into `host` (a full-screen dialog on mobile, a centered modal on desktop).
 * @param {HTMLElement} host
 * @param {{title?: string, initial?: {name?: string, avatar?: object}, submitLabel?: string,
 *          onSave: (v: {name: string, avatar: object}) => Promise<void>|void, onCancel?: () => void,
 *          art?: {roomId: string, charId: string}}} opts
 *   `art` = the saved character being edited (Stage 5.5-D "✨ AI 일러스트 만들기" in `.cz-ai-slot`); when omitted
 *   while editing (`initial.avatar`), the character is looked up in the saved room by name + avatar.
 * @returns {{destroy: () => void, getAvatar: () => object}}
 */
export function openCustomizer(host, { title = '캐릭터 만들기', initial = {}, submitLabel = '저장', onSave, onCancel, art = null }) {
  const defs = getAvatarDefs();
  const labels = { ...FALLBACK_LABELS, ...(defs.labels ?? {}) };
  const tabs = buildTabs(defs);
  let avatar = initial.avatar ? normalizeAvatar(initial.avatar, defs) : randomAvatar(defs);
  let activeTab = tabs[0]?.id;
  let expression = 'neutral';
  let previewCrop = 'bust'; // 'bust' (round preview) | 'full' (「전신 보기」, layered renderer only)
  let view = '2d';
  let busy = false;
  let destroyed = false;
  const can3d = want3dPreview();
  const thumbState = new Map(); // tab id → avatar json its thumbnails were drawn with

  const optionButton = (part, opt) => {
    const isColor = COLOR_PARTS.includes(part) && opt.color;
    const name = opt.name ?? opt.id;
    return `<button type="button" class="cz-opt${isColor ? ' cz-swatch' : ''}" role="radio" aria-checked="false" tabindex="-1"
      data-part="${esc(part)}" data-id="${esc(opt.id)}" title="${esc(name)}" aria-label="${esc(name)}">${
        isColor ? `<i style="background:${esc(opt.color)}"></i>` : '<span class="cz-thumb"></span>'
      }${isColor ? '' : `<span class="cz-opt-name">${esc(name)}</span>`}</button>`;
  };

  host.innerHTML = `
    <div class="cz-overlay">
      <form class="customizer" novalidate role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <header class="cz-head">
          <h3>${esc(title)}</h3>
          <button type="button" class="cz-close" data-act="cancel" aria-label="닫기">✕</button>
        </header>
        <div class="cz-body">
          <section class="cz-stage">
            <div class="cz-preview" aria-live="polite">
              <div class="cz-2d"></div>
              <canvas class="cz-3d" width="260" height="260" hidden aria-label="3D 미리보기"></canvas>
            </div>
            <div class="cz-stage-tools">
              <div class="cz-seg cz-view" role="group" aria-label="미리보기 방식"${can3d ? '' : ' hidden'}>
                <button type="button" data-view="2d" aria-pressed="true">2D</button>
                <button type="button" data-view="3d" aria-pressed="false">3D</button>
              </div>
              <div class="cz-expr" role="group" aria-label="표정 미리보기">
                ${PREVIEW_EXPRESSIONS.map((e) => `<button type="button" class="cz-chip" data-expr="${e.id}" aria-pressed="${e.id === 'neutral'}">${esc(e.name)}</button>`).join('')}
                <button type="button" class="cz-chip cz-full" data-crop-toggle aria-pressed="false">전신 보기</button>
              </div>
            </div>
            <label class="field cz-name">
              <span>이름 <span class="name-count" data-name-count aria-live="polite"></span></span>
              <input name="name" maxlength="40" required placeholder="캐릭터 이름 (12자까지)" value="${esc(initial.name ?? '')}" autocomplete="off">
            </label>
          </section>
          <section class="cz-editor">
            <div class="cz-tabs" role="tablist" aria-label="꾸미기 항목">
              ${tabs.map((t) => `<button type="button" role="tab" id="cz-tab-${esc(t.id)}" data-tab="${esc(t.id)}" aria-controls="cz-panel-${esc(t.id)}" aria-selected="false" tabindex="-1">${esc(t.name)}</button>`).join('')}
            </div>
            <div class="cz-panels">
              ${tabs
                .map(
                  (t) => `
                <div class="cz-panel" role="tabpanel" id="cz-panel-${esc(t.id)}" data-tab="${esc(t.id)}" aria-labelledby="cz-tab-${esc(t.id)}" hidden>
                  ${t.parts
                    .map(
                      (part) => `
                    <div class="cz-cat" data-part="${esc(part)}">
                      <div class="cz-cat-head"><span class="cz-cat-label" id="cz-lbl-${esc(part)}">${esc(labels[part] ?? part)}</span><span class="cz-cat-value"></span>${defs.parts[part].length > MANY_OPTIONS ? `<span class="cz-cat-count">${defs.parts[part].length}가지</span>` : ''}</div>
                      <div class="cz-grid${COLOR_PARTS.includes(part) ? ' colors' : ''}${defs.parts[part].length > MANY_OPTIONS ? ' many' : ''}" role="radiogroup" aria-labelledby="cz-lbl-${esc(part)}">
                        ${defs.parts[part].map((o) => optionButton(part, o)).join('')}
                      </div>
                    </div>`,
                    )
                    .join('')}
                </div>`,
                )
                .join('')}
            </div>
            <div class="cz-randoms">
              <button type="button" class="btn small ghost" data-act="random-tab">🎲 이 탭만 랜덤</button>
              <button type="button" class="btn small ghost" data-act="random">🎲 전체 랜덤</button>
            </div>
          </section>
        </div>
        <p class="form-error" role="alert"></p>
        <footer class="cz-actions">
          <div class="cz-ai-slot"></div>
          <button type="button" class="btn ghost" data-act="cancel">취소</button>
          <button type="submit" class="btn primary">${esc(submitLabel)}</button>
        </footer>
      </form>
    </div>`;

  const form = host.querySelector('form');
  bindNameInput(form.elements.name, form.querySelector('[data-name-count]'));
  const errEl = form.querySelector('.form-error');
  const preview2d = form.querySelector('.cz-2d');
  const canvas3d = form.querySelector('.cz-3d');
  const exprBar = form.querySelector('.cz-expr');
  let preview3d = null;
  let previewSeq = 0;
  document.body.classList.add('cz-open');

  // ----- preview -----
  const PREVIEW_SIZE = 220;
  function placePreview(content) {
    if (content == null || content === '') return false;
    if (typeof content === 'string') preview2d.innerHTML = content;
    else if (typeof Node !== 'undefined' && content instanceof Node) preview2d.replaceChildren(content);
    else return false;
    return true;
  }
  function refreshPreview() {
    if (destroyed) return;
    const my = ++previewSeq;
    const opts = { expression, size: PREVIEW_SIZE, defs, crop: previewCrop };
    const fallback = () => my === previewSeq && !destroyed && placePreview(defaultPreviewRenderer(avatar, opts));
    let out;
    try {
      out = previewRenderer(avatar, opts);
    } catch {
      fallback();
      return;
    }
    if (out && typeof out.then === 'function') {
      if (!preview2d.firstChild) fallback(); // nothing on screen yet → show the SVG meanwhile
      out.then(
        (res) => {
          if (my !== previewSeq || destroyed) return;
          if (!placePreview(res)) fallback();
        },
        fallback,
      );
    } else if (!placePreview(out)) fallback();
  }

  // ----- grids -----
  function renderThumbs(tabId, force = false) {
    const key = JSON.stringify(avatar);
    if (!force && thumbState.get(tabId) === key) return;
    thumbState.set(tabId, key);
    const panel = form.querySelector(`.cz-panel[data-tab="${CSS.escape(tabId)}"]`);
    if (!panel) return;
    for (const btn of panel.querySelectorAll('.cz-opt')) {
      const slot = btn.querySelector('.cz-thumb');
      if (!slot) continue;
      const part = btn.dataset.part;
      const svg = thumbSvg(part, thumbVariant(avatar, part, btn.dataset.id));
      if (slot.dataset.svg !== svg) {
        slot.innerHTML = svg;
        slot.dataset.svg = svg;
      }
    }
  }

  function syncSelection() {
    const tintable = outfitTintable(avatar.outfit, defs);
    for (const cat of form.querySelectorAll('.cz-cat')) {
      const part = cat.dataset.part;
      const opt = defs.parts[part].find((o) => o.id === avatar[part]);
      const locked = part === 'outfitColor' && !tintable;
      cat.classList.toggle('locked', locked);
      cat.querySelector('.cz-grid').setAttribute('aria-disabled', String(locked));
      cat.querySelector('.cz-cat-value').textContent = locked ? '이 의상은 색을 바꿀 수 없어요' : (opt?.name ?? opt?.id ?? '');
      const focused = cat.contains(document.activeElement) ? document.activeElement : null;
      for (const btn of cat.querySelectorAll('.cz-opt')) {
        const on = btn.dataset.id === avatar[part];
        btn.setAttribute('aria-checked', String(on));
        btn.classList.toggle('on', on);
        if (!focused) btn.tabIndex = on ? 0 : -1;
      }
    }
  }

  function refresh() {
    artSlot?.update(); // Stage 5.5-D: the AI art button only applies to the saved look
    refreshPreview();
    preview3d?.set(avatar);
    syncSelection();
    renderThumbs(activeTab);
  }

  function selectTab(id, focus = false) {
    activeTab = id;
    for (const b of form.querySelectorAll('[role=tab]')) {
      const on = b.dataset.tab === id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    }
    for (const p of form.querySelectorAll('.cz-panel')) p.hidden = p.dataset.tab !== id;
    renderThumbs(id);
    try {
      localStorage.setItem('jinsei.czTab', id);
    } catch {
      /* ignore */
    }
  }

  function setPart(part, id) {
    if (avatar[part] === id) return;
    avatar = { ...avatar, [part]: id };
    refresh();
  }

  function setView(next) {
    view = next === '3d' && can3d ? '3d' : '2d';
    for (const b of form.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
    preview2d.hidden = view !== '2d';
    exprBar.hidden = view !== '2d';
    canvas3d.hidden = view !== '3d' || !preview3d;
    if (view === '3d' && !preview3d) {
      // 3D preview = the board pawn (Stage 4); created lazily on first use.
      import('../scene/pawnPreview.js')
        .then(({ createPawnPreview }) => {
          if (destroyed) return;
          preview3d = createPawnPreview(canvas3d, { defs, size: 260 });
          preview3d.set(avatar);
          canvas3d.hidden = view !== '3d';
        })
        .catch(() => {
          setView('2d');
          form.querySelector('.cz-view').hidden = true;
        });
    }
  }

  function setPreviewCrop(next) {
    previewCrop = next === 'full' ? 'full' : 'bust';
    form.querySelector('[data-crop-toggle]')?.setAttribute('aria-pressed', String(previewCrop === 'full'));
    form.querySelector('.cz-preview').classList.toggle('full', previewCrop === 'full');
    refreshPreview();
  }

  function setExpression(next) {
    expression = next;
    for (const b of exprBar.querySelectorAll('[data-expr]')) b.setAttribute('aria-pressed', String(b.dataset.expr === expression));
    refreshPreview();
  }

  // ----- events -----
  form.addEventListener('click', (ev) => {
    const opt = ev.target.closest('.cz-opt');
    if (opt) {
      if (opt.closest('.cz-cat.locked')) return;
      setPart(opt.dataset.part, opt.dataset.id);
      for (const b of opt.parentElement.children) b.tabIndex = b === opt ? 0 : -1;
      return;
    }
    const tab = ev.target.closest('[role=tab]');
    if (tab) return selectTab(tab.dataset.tab);
    const v = ev.target.closest('[data-view]');
    if (v) return setView(v.dataset.view);
    const e = ev.target.closest('[data-expr]');
    if (e) return setExpression(e.dataset.expr);
    if (ev.target.closest('[data-crop-toggle]')) return setPreviewCrop(previewCrop === 'full' ? 'bust' : 'full');
    const act = ev.target.closest('[data-act]')?.dataset.act;
    if (act === 'random') {
      avatar = randomizeParts(avatar, defs.order, defs);
      refresh();
    } else if (act === 'random-tab') {
      const t = tabs.find((x) => x.id === activeTab);
      if (t) {
        avatar = randomizeParts(avatar, t.parts, defs);
        refresh();
      }
    } else if (act === 'cancel') {
      onCancel?.();
    }
  });

  form.addEventListener('keydown', (ev) => {
    const tab = ev.target.closest?.('[role=tab]');
    if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) {
      ev.preventDefault();
      const i = tabs.findIndex((t) => t.id === tab.dataset.tab);
      const n = tabs.length;
      const j = ev.key === 'Home' ? 0 : ev.key === 'End' ? n - 1 : (i + (ev.key === 'ArrowRight' ? 1 : -1) + n) % n;
      selectTab(tabs[j].id, true);
      return;
    }
    const opt = ev.target.closest?.('.cz-opt');
    if (opt && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(ev.key)) {
      ev.preventDefault();
      const items = [...opt.parentElement.querySelectorAll('.cz-opt')];
      const i = items.indexOf(opt);
      const j = ev.key === 'Home' ? 0 : ev.key === 'End' ? items.length - 1 : nextInGrid(items, i, ev.key);
      for (const b of items) b.tabIndex = b === items[j] ? 0 : -1;
      items[j].focus();
      items[j].scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
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
    const name = form.elements.name.value.replace(/\s+/g, ' ').trim();
    if (!name) {
      errEl.textContent = '이름을 입력하세요.';
      form.elements.name.focus();
      return;
    }
    if (!nameFits(name)) {
      errEl.textContent = `이름은 ${NAME_MAX}자까지 쓸 수 있어요.`;
      form.elements.name.focus();
      return;
    }
    busy = true;
    errEl.textContent = '';
    try {
      await onSave({ name, avatar });
    } catch (err) {
      errEl.textContent = err.message || '저장하지 못했습니다.';
    } finally {
      busy = false;
    }
  });

  // Stage 5.5-D: AI illustration button / progress in the footer slot (editing a saved character only).
  const artSlot = initial.avatar ? mountArtSlot(form.querySelector('.cz-ai-slot'), { initial, target: art, getAvatar: () => avatar }) : null;

  let savedTab = null;
  try {
    savedTab = localStorage.getItem('jinsei.czTab');
  } catch {
    /* ignore */
  }
  selectTab(tabs.some((t) => t.id === savedTab) ? savedTab : activeTab);
  refresh();
  setView('2d');

  const inst = { refreshPreview };
  openInstances.add(inst);
  return {
    getAvatar: () => ({ ...avatar }),
    destroy() {
      destroyed = true;
      artSlot?.destroy();
      openInstances.delete(inst);
      preview3d?.dispose();
      preview3d = null;
      host.innerHTML = '';
      document.body.classList.remove('cz-open');
    },
  };
}
