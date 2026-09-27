// Stage 9 — 엔딩 단체 사진 📸. Pose picker (브이 / 만세 / 하트 / 점프) → every character's composed paper-doll art (or AI
// art, else the SVG portrait) drawn into ONE canvas on the studio stage with a title banner ("인생게임 · 방 코드 ·
// 날짜"), names and places → PNG download (`canvas.toBlob` + `<a download>`) or the Web Share API. Works without
// WebGL; in 3D mode a 「🧊 3D 시상대」 style captures the podium scene instead.
import { esc } from '../format.js';
import { renderAvatar } from './avatar2d.js';
import { composeArt, composeAvatar } from './avatarCompose.js';
import { resolveCharacterArt } from './cutinMap.js';
import { MEDALS, PHOTO_H, PHOTO_POSES, PHOTO_W, photoFileName, photoLayout, photoPose, photoTitle, poseOffset } from '../shared/result.js';

const FONT_STACK = '"Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", "Noto Sans CJK KR", "Malgun Gothic", system-ui, sans-serif';
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Where the feet sit inside a full-body figure canvas (fraction of its height). */
const FEET = 0.965;

function loadImage(src) {
  return new Promise((resolve) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = src;
  });
}

/** SVG portrait → image (fallback when the paper-doll layers are missing). */
async function svgImage(avatar, { size = 512, expression = null } = {}) {
  const svg = renderAvatar(avatar ?? {}, { size, expression });
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    return await loadImage(url);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

/** Full-body figure for a character: AI art (pose / expression) > composed layers > SVG portrait ({img, kind}). */
async function figureFor(char, pose, h) {
  const want = resolveCharacterArt(char, { pose: pose.pose, expression: pose.expression });
  if (want.source === 'ai' && want.url) {
    const cv = await composeArt(want.url, { crop: 'full', size: h, dpr: 1 }).catch(() => null);
    if (cv) return { img: cv, kind: 'ai' };
  }
  const cv = await composeAvatar(char?.avatar ?? {}, { expression: want.expression ?? null, crop: 'full', size: h, dpr: 1 }).catch(() => null);
  if (cv) return { img: cv, kind: 'layers' };
  const im = await svgImage(char?.avatar, { size: 512, expression: pose.expression === 'love' ? 'love' : 'joy' });
  return im ? { img: im, kind: 'svg' } : null;
}

function drawStage(g, W, H, bg) {
  if (bg) {
    const s = Math.max(W / bg.width, H / bg.height);
    g.drawImage(bg, (W - bg.width * s) / 2, (H - bg.height * s) / 2, bg.width * s, bg.height * s);
    g.fillStyle = 'rgba(40,20,70,0.18)';
    g.fillRect(0, 0, W, H);
    return;
  }
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#3b2d6e');
  sky.addColorStop(0.62, '#6d4fc2');
  sky.addColorStop(1, '#ffb36b');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  // spotlights
  g.globalAlpha = 0.16;
  g.fillStyle = '#fff6c8';
  for (const [x, d] of [[W * 0.18, 1], [W * 0.5, 0], [W * 0.82, -1]]) {
    g.beginPath();
    g.moveTo(x - 30, 0);
    g.lineTo(x + 30, 0);
    g.lineTo(x + 260 - d * 160, H);
    g.lineTo(x - 260 - d * 160, H);
    g.closePath();
    g.fill();
  }
  g.globalAlpha = 1;
  // stage floor
  g.fillStyle = '#ffcf99';
  g.beginPath();
  g.ellipse(W / 2, H * 0.97, W * 0.62, H * 0.2, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.beginPath();
  g.ellipse(W / 2, H * 0.93, W * 0.4, H * 0.08, 0, 0, Math.PI * 2);
  g.fill();
  // stars
  g.fillStyle = '#ffd23f';
  g.font = `${Math.round(H * 0.04)}px ${FONT_STACK}`;
  for (const [x, y] of [[0.07, 0.3], [0.93, 0.26], [0.12, 0.55], [0.9, 0.58]]) g.fillText('★', W * x, H * y);
}

function drawBanner(g, W, H, title) {
  const bh = H * 0.12;
  g.fillStyle = 'rgba(255,122,47,0.96)';
  roundRect(g, W * 0.12, H * 0.025, W * 0.76, bh, bh / 2);
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = '#ffffff';
  g.stroke();
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `900 ${Math.round(bh * 0.42)}px ${FONT_STACK}`;
  g.fillText(`🏆 ${title}`, W / 2, H * 0.025 + bh / 2 + 2, W * 0.72);
}

function drawLabel(g, text, x, y, { gold = false, fontPx = 30, max = 260 } = {}) {
  g.font = `800 ${fontPx}px ${FONT_STACK}`;
  const w = Math.min(max, g.measureText(text).width + fontPx * 1.1);
  const h = fontPx * 1.55;
  g.fillStyle = gold ? 'rgba(255,210,63,0.97)' : 'rgba(255,255,255,0.94)';
  roundRect(g, x - w / 2, y - h / 2, w, h, h / 2);
  g.fill();
  g.fillStyle = '#2d2a32';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, x, y + 1, w - fontPx * 0.6);
}

/**
 * Render the group photo.
 * @param {{entries: {char, rank}[], poseId?: string, title: string, bgUrl?: string|null, width?: number, height?: number,
 *          snapshot?: HTMLCanvasElement|null}} opts  `snapshot` = the 3D podium capture (3D style)
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderGroupPhoto({ entries = [], poseId = 'v', title = '', bgUrl = null, width = PHOTO_W, height = PHOTO_H, snapshot = null } = {}) {
  const cv = document.createElement('canvas');
  cv.width = width;
  cv.height = height;
  const g = cv.getContext('2d');
  if (snapshot) {
    const s = Math.max(width / snapshot.width, height / snapshot.height);
    g.drawImage(snapshot, (width - snapshot.width * s) / 2, (height - snapshot.height * s) / 2, snapshot.width * s, snapshot.height * s);
    drawBanner(g, width, height, title);
    cv.dataset.kind = '3d';
    return cv;
  }
  const bg = bgUrl ? await loadImage(bgUrl) : null;
  drawStage(g, width, height, bg);
  const pose = photoPose(poseId);
  const list = entries.slice(0, 8);
  const slots = photoLayout(list.length, { width, height });
  const figs = await Promise.all(list.map((e, i) => figureFor(e.char, pose, slots[i].h)));
  const order = list.map((e, i) => i).sort((a, b) => slots[a].z - slots[b].z);
  const kinds = new Set();
  for (const i of order) {
    const s = slots[i];
    const f = figs[i];
    const off = poseOffset(pose.id, i);
    const lift = off.lift * s.h;
    // contact shadow (smaller while jumping)
    g.fillStyle = 'rgba(40,20,60,0.28)';
    g.beginPath();
    g.ellipse(s.x, s.y, s.w * (lift ? 0.3 : 0.4), s.h * 0.025, 0, 0, Math.PI * 2);
    g.fill();
    if (!f) continue;
    kinds.add(f.kind);
    g.save();
    g.translate(s.x, s.y - lift);
    g.rotate(off.tilt);
    if (f.kind === 'svg') {
      const side = s.w * 1.25;
      g.drawImage(f.img, -side / 2, -side, side, side);
    } else {
      const k = s.h / f.img.height;
      const w = f.img.width * k;
      g.drawImage(f.img, -w / 2, -s.h * FEET, w, s.h);
    }
    // pose glyph by the raised hand / over the head
    g.font = `${Math.round(s.h * 0.11)}px ${FONT_STACK}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (pose.id === 'banzai') {
      g.fillText('🙌', 0, -s.h * 1.0);
    } else if (pose.id === 'heart') {
      g.fillText('💕', s.w * 0.36, -s.h * 0.86);
    } else if (pose.id === 'jump') {
      g.fillText('✨', -s.w * 0.4, -s.h * 0.35);
    } else {
      g.fillText('✌️', s.w * 0.4, -s.h * 0.62);
    }
    g.restore();
  }
  // names + places (front labels under the feet, back labels above the heads)
  list.forEach((e, i) => {
    const s = slots[i];
    const rank = Number(e.rank) || i + 1;
    drawLabel(g, `${MEDALS[rank - 1] ?? `${rank}위`} ${e.char?.name ?? ''}`, s.x, s.labelY, { gold: rank === 1, fontPx: s.row === 'back' ? 24 : 28, max: s.row === 'back' ? 230 : 300 });
  });
  drawBanner(g, width, height, title);
  g.font = `700 ${Math.round(height * 0.022)}px ${FONT_STACK}`;
  g.fillStyle = 'rgba(255,255,255,0.8)';
  g.textAlign = 'right';
  g.fillText('🎲 인생게임', width - 18, height - 18);
  cv.dataset.kind = [...kinds].join(',');
  return cv;
}

/** PNG blob of a canvas (null when the browser refuses). */
export const canvasBlob = (cv) => new Promise((resolve) => (cv?.toBlob ? cv.toBlob((b) => resolve(b), 'image/png') : resolve(null)));

/**
 * The 📸 dialog. `entries` in rank order ({char, rank}); `podium` = the 3D podium view (optional 3D style).
 * @returns {{el: HTMLElement, close: () => void}}
 */
export function openPhotoDialog({ entries = [], code = '', findAsset = () => null, podium = null, toast = () => {}, date = new Date() } = {}) {
  const title = photoTitle({ code, date });
  const fileName = photoFileName({ code, date });
  const state = { poseId: 'v', style: 'art', canvas: null, blob: null, seq: 0 };
  const el = document.createElement('div');
  el.className = 'photo-dlg';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', '단체 사진');
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  el.innerHTML = `
    <div class="photo-sheet">
      <div class="photo-head"><h3>📸 단체 사진</h3><button type="button" class="btn tiny ghost" data-photo="close" aria-label="닫기">✕</button></div>
      <div class="photo-poses" role="radiogroup" aria-label="포즈">${PHOTO_POSES.map(
        (p) => `<button type="button" class="photo-pose${p.id === state.poseId ? ' on' : ''}" role="radio" aria-checked="${p.id === state.poseId}" data-pose="${esc(p.id)}"><span>${esc(p.icon)}</span>${esc(p.label)}</button>`,
      ).join('')}</div>
      ${podium?.is3d ? `<div class="photo-style" role="radiogroup" aria-label="사진 스타일"><button type="button" class="photo-pose on" role="radio" aria-checked="true" data-style="art">🎨 일러스트</button><button type="button" class="photo-pose" role="radio" aria-checked="false" data-style="3d">🧊 3D 시상대</button></div>` : ''}
      <div class="photo-preview" data-photo="preview"><span class="photo-wait">📸 찰칵… 사진을 만드는 중</span></div>
      <p class="photo-title muted small">${esc(title)}</p>
      <div class="photo-actions">
        <button type="button" class="btn primary" data-photo="save" disabled>📥 PNG 저장</button>
        ${canShare ? '<button type="button" class="btn" data-photo="share" disabled>📤 공유</button>' : ''}
      </div>
    </div>`;
  document.body.appendChild(el);
  document.body.classList.add('photo-open');
  const $ = (s) => el.querySelector(s);

  async function build() {
    const seq = ++state.seq;
    for (const b of el.querySelectorAll('[data-photo="save"], [data-photo="share"]')) b.disabled = true;
    $('[data-photo="preview"]').innerHTML = '<span class="photo-wait">📸 찰칵… 사진을 만드는 중</span>';
    let cv = null;
    try {
      const snapshot = state.style === '3d' && podium?.snapshot ? podium.snapshot(1600, 1000) : null;
      const bgUrl = findAsset({ kind: 'bg', scene: 'studio' })?.url ?? null;
      cv = await renderGroupPhoto({ entries, poseId: state.poseId, title, bgUrl, snapshot });
    } catch (err) {
      console.warn('[photo]', err);
    }
    if (seq !== state.seq || !el.isConnected) return;
    if (!cv) {
      $('[data-photo="preview"]').innerHTML = '<span class="photo-wait">사진을 만들지 못했어요. 다시 시도해 주세요.</span>';
      return;
    }
    cv.className = 'photo-canvas';
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', `${title} 단체 사진`);
    state.canvas = cv;
    state.blob = null;
    $('[data-photo="preview"]').replaceChildren(cv);
    for (const b of el.querySelectorAll('[data-photo="save"], [data-photo="share"]')) b.disabled = false;
  }

  async function blob() {
    state.blob ??= await canvasBlob(state.canvas);
    return state.blob;
  }

  async function save() {
    const b = await blob();
    if (!b) return toast('사진을 저장하지 못했어요.', 'error');
    const url = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('📥 단체 사진을 저장했어요!');
  }

  async function share() {
    const b = await blob();
    if (!b) return;
    const file = typeof File === 'function' ? new File([b], fileName, { type: 'image/png' }) : null;
    try {
      if (file && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title, text: title });
      else await navigator.share({ title, text: title });
    } catch (err) {
      if (err?.name !== 'AbortError') toast('공유하지 못했어요. PNG로 저장해 주세요.', 'error');
    }
  }

  function close() {
    state.seq++;
    el.remove();
    document.body.classList.remove('photo-open');
    document.removeEventListener('keydown', onKey);
  }
  const onKey = (ev) => ev.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  el.addEventListener('click', (ev) => {
    const t = ev.target;
    if (t === el || t.closest('[data-photo="close"]')) return close();
    const p = t.closest('[data-pose]');
    if (p) {
      state.poseId = p.dataset.pose;
      state.style = 'art';
      for (const b of el.querySelectorAll('[data-pose]')) {
        b.classList.toggle('on', b === p);
        b.setAttribute('aria-checked', String(b === p));
      }
      for (const b of el.querySelectorAll('[data-style]')) {
        b.classList.toggle('on', b.dataset.style === 'art');
        b.setAttribute('aria-checked', String(b.dataset.style === 'art'));
      }
      return build();
    }
    const st = t.closest('[data-style]');
    if (st) {
      state.style = st.dataset.style;
      for (const b of el.querySelectorAll('[data-style]')) {
        b.classList.toggle('on', b === st);
        b.setAttribute('aria-checked', String(b === st));
      }
      return build();
    }
    if (t.closest('[data-photo="save"]')) return save();
    if (t.closest('[data-photo="share"]')) return share();
  });
  build();
  $('[data-pose]')?.focus({ preventScroll: true });
  return { el, close, build, get canvas() { return state.canvas; } };
}
