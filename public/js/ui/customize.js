// Character customizer: ◀ ▶ per part, random button, name input, 2D portrait + 3D pawn preview.
import { getAvatarDefs, normalizeAvatar, randomAvatar, renderAvatar } from './avatar2d.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

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

const FALLBACK_LABELS = {
  body: '체형', skin: '피부', hair: '머리 모양', hairColor: '머리색',
  eyes: '눈', accessory: '액세서리', outfit: '의상', outfitColor: '의상 색',
};

/**
 * Render a customizer into `host`.
 * @param {HTMLElement} host
 * @param {{title?: string, initial?: {name?: string, avatar?: object}, submitLabel?: string,
 *          onSave: (v: {name: string, avatar: object}) => Promise<void>|void, onCancel?: () => void}} opts
 * @returns {{destroy: () => void}}
 */
export function openCustomizer(host, { title = '캐릭터 만들기', initial = {}, submitLabel = '저장', onSave, onCancel }) {
  const defs = getAvatarDefs();
  const labels = defs.labels || FALLBACK_LABELS;
  let avatar = initial.avatar ? normalizeAvatar(initial.avatar, defs) : randomAvatar(defs);
  let busy = false;

  host.innerHTML = `
    <form class="customizer card" novalidate>
      <div class="customizer-head">
        <h3>${esc(title)}</h3>
        <button type="button" class="btn small ghost" data-act="random" title="랜덤">🎲 랜덤</button>
      </div>
      <div class="customizer-preview" aria-live="polite"><span class="cz-2d"></span><canvas class="cz-3d" width="140" height="140" hidden aria-label="3D 미리보기"></canvas></div>
      <label class="field">
        <span>이름</span>
        <input name="name" maxlength="12" required placeholder="캐릭터 이름" value="${esc(initial.name ?? '')}" autocomplete="off">
      </label>
      <div class="part-rows">
        ${defs.order
          .map(
            (key) => `
          <div class="part-row" data-part="${key}">
            <span class="part-label">${esc(labels[key] ?? key)}</span>
            <button type="button" class="arrow" data-dir="-1" aria-label="${esc(labels[key] ?? key)} 이전">◀</button>
            <span class="part-value"></span>
            <button type="button" class="arrow" data-dir="1" aria-label="${esc(labels[key] ?? key)} 다음">▶</button>
          </div>`,
          )
          .join('')}
      </div>
      <p class="form-error" role="alert"></p>
      <div class="customizer-actions">
        <button type="button" class="btn ghost" data-act="cancel">취소</button>
        <button type="submit" class="btn primary">${esc(submitLabel)}</button>
      </div>
    </form>`;

  const form = host.querySelector('form');
  const preview = form.querySelector('.customizer-preview');
  const errEl = form.querySelector('.form-error');

  const preview2d = preview.querySelector('.cz-2d');
  const canvas3d = preview.querySelector('.cz-3d');
  let preview3d = null;
  let destroyed = false;

  const refresh = () => {
    preview2d.innerHTML = renderAvatar(avatar, { size: 140, bg: '#fff4e0' });
    preview3d?.set(avatar);
    for (const row of form.querySelectorAll('.part-row')) {
      const key = row.dataset.part;
      const opts = defs.parts[key];
      const idx = opts.findIndex((o) => o.id === avatar[key]);
      const opt = opts[idx];
      const swatch = opt.color ? `<i class="swatch" style="background:${esc(opt.color)}"></i>` : '';
      row.querySelector('.part-value').innerHTML = `${swatch}${esc(opt.name ?? opt.id)} <small>${idx + 1}/${opts.length}</small>`;
    }
  };

  form.addEventListener('click', (ev) => {
    const arrow = ev.target.closest('.arrow');
    if (arrow) {
      const key = arrow.closest('.part-row').dataset.part;
      const opts = defs.parts[key];
      const idx = opts.findIndex((o) => o.id === avatar[key]);
      const next = (idx + Number(arrow.dataset.dir) + opts.length) % opts.length;
      avatar = { ...avatar, [key]: opts[next].id };
      refresh();
      return;
    }
    const act = ev.target.closest('[data-act]')?.dataset.act;
    if (act === 'random') {
      avatar = randomAvatar(defs);
      refresh();
    } else if (act === 'cancel') {
      onCancel?.();
    }
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (busy) return;
    const name = form.name.value.trim();
    if (!name) {
      errEl.textContent = '이름을 입력하세요.';
      form.name.focus();
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

  refresh();
  // 3D preview = the board pawn (Stage 4); skipped when the player chose the 2D board or WebGL fails.
  if (want3dPreview()) {
    import('../scene/pawnPreview.js')
      .then(({ createPawnPreview }) => {
        if (destroyed) return;
        preview3d = createPawnPreview(canvas3d, { defs });
        preview3d.set(avatar);
        canvas3d.hidden = false;
      })
      .catch(() => {});
  }
  return {
    destroy() {
      destroyed = true;
      preview3d?.dispose();
      preview3d = null;
      host.innerHTML = '';
    },
  };
}
