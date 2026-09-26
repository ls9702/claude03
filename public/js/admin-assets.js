// Asset studio page: key status, usage, manifest items, generate → candidates → accept / upload.
const API = '/admin/api/assets';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const STATUS_LABEL = { todo: '미생성', candidate: '후보 있음', accepted: '채택됨', missing: '없음' };
const KIND_ORDER = ['anchor', 'bg', 'charLayer', 'pose', 'sprite', 'icon', 'texture', 'frame', 'ui', 'part'];

const state = { items: [], kind: '', status: '', selected: null, detail: null, job: null, flipTimer: null };

async function req(method, path, body, { raw = false, contentType } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = contentType || 'application/json';
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
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
  if (!res.ok) throw new Error(data?.error || `요청 실패 (${res.status})`);
  return data;
}

let toastTimer;
function toast(msg, kind = 'info') {
  const el = $('#toast');
  el.textContent = msg;
  el.dataset.kind = kind;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

function showLogin() {
  $('#login-view').hidden = false;
  $('#studio-view').hidden = true;
}

async function showStudio() {
  $('#login-view').hidden = true;
  $('#studio-view').hidden = false;
  await refresh();
}

// ---------- status + list ----------
function renderStatus(d) {
  const ks = $('#key-status');
  if (d.hasKey) {
    ks.innerHTML = `<span class="key-ok">● 키 등록됨</span> <span class="muted">(${d.keySource === 'env' ? '환경변수 GEMINI_API_KEY' : '서버 파일 data/secrets.json'})</span>`;
  } else {
    ks.innerHTML = '<span class="key-missing">● 키 없음</span> <span class="muted">— 생성하려면 키를 등록하세요. 업로드·기존 에셋은 키 없이도 동작합니다.</span>';
  }
  $('#key-clear').hidden = d.keySource !== 'file';
  const u = d.usage;
  const pct = u.cap ? Math.min(100, (u.count / u.cap) * 100) : 100;
  $('#usage-fill').style.width = `${pct}%`;
  $('#usage-fill').classList.toggle('high', pct >= 80);
  $('#usage-text').textContent = `${u.count} / ${u.cap}`;
  $('#model-id').textContent = d.model;
}

async function refresh() {
  const d = await req('GET', API);
  state.items = d.items;
  renderStatus(d);
  $('#accepted-count').textContent = d.items.filter((i) => i.status === 'accepted').length;
  $('#total-count').textContent = d.items.length;
  renderFilters();
  renderList();
  if (state.selected) await loadDetail(state.selected, { keepPrompt: true });
  const running = d.jobs?.find((j) => j.itemId === state.selected);
  if (running && !state.job) pollJob(running.id);
}

function renderFilters() {
  const kinds = KIND_ORDER.filter((k) => state.items.some((i) => i.kind === k));
  const label = (k) => state.items.find((i) => i.kind === k)?.kindLabel ?? k;
  $('#kind-filters').innerHTML = [['', '전체'], ...kinds.map((k) => [k, label(k)])]
    .map(([k, l]) => `<button type="button" class="chip-btn ${state.kind === k ? 'sel' : ''}" data-kind="${esc(k)}">${esc(l)}</button>`)
    .join('');
}

function thumbHtml(item, size = 48) {
  if (item.url) return `<img class="thumb" src="${esc(item.url)}" alt="" width="${size}" height="${size}" loading="lazy">`;
  return `<div class="thumb empty" style="width:${size}px;height:${size}px">·</div>`;
}

function renderList() {
  const items = state.items.filter((i) => (!state.kind || i.kind === state.kind) && (!state.status || i.status === state.status));
  const groups = KIND_ORDER.map((k) => [k, items.filter((i) => i.kind === k)]).filter(([, a]) => a.length);
  $('#item-list').innerHTML = groups.length
    ? groups
        .map(
          ([, arr]) =>
            `<h3>${esc(arr[0].kindLabel)} <span class="muted">(${arr.filter((i) => i.status === 'accepted').length}/${arr.length})</span></h3>` +
            arr
              .map(
                (i) => `<button type="button" class="item ${state.selected === i.id ? 'sel' : ''}" data-id="${esc(i.id)}">
                  ${thumbHtml(i)}
                  <span><div class="name">${esc(i.label)}</div><div class="id">${esc(i.id)}${i.candidateCount ? ` · 후보 ${i.candidateCount}` : ''}</div></span>
                  <span class="st ${esc(i.status)}">${esc(STATUS_LABEL[i.status])}</span>
                </button>`,
              )
              .join(''),
        )
        .join('')
    : '<p class="muted">조건에 맞는 항목이 없습니다.</p>';
}

// ---------- detail ----------
async function loadDetail(id, { keepPrompt = false } = {}) {
  const prevPrompt = keepPrompt && state.selected === id ? $('#prompt')?.value : null;
  state.selected = id;
  state.detail = await req('GET', `${API}/items/${encodeURIComponent(id)}`);
  renderDetail(prevPrompt);
  renderList();
}

/** variant: '' full PNG, 'preview' small WebP thumbnail, 'anim' animated WebP (sprites). */
function candUrl(id, c, variant = '') {
  return `${API}/candidates/${encodeURIComponent(id)}/${c.n}?t=${encodeURIComponent(c.generatedAt)}${variant ? `&${variant}=1` : ''}`;
}

function renderDetail(prevPrompt) {
  clearInterval(state.flipTimer);
  const { item, candidates } = state.detail;
  const running = state.job && state.job.itemId === item.id && state.job.status === 'running';
  const defaultCount = item.candidates || 4;
  const accepted = item.status === 'accepted';
  const isAnimKind = item.kind === 'pose' || item.kind === 'sprite';
  const acc = item.accepted;
  const animUrl = item.kind === 'sprite' && acc ? item.url.replace(/\.png(\?|$)/, '.anim.webp$1') : null;

  $('#detail').innerHTML = `
    <div class="detail-head">
      <h2>${esc(item.label)}</h2>
      <span class="st ${esc(item.status)}">${esc(STATUS_LABEL[item.status])}</span>
      <span class="muted small">${esc(item.kindLabel)} · ${esc(item.aspect)}${item.size ? ` · ${item.size.w}×${item.size.h}` : ''}</span>
    </div>
    <p class="muted small"><code>${esc(item.id)}</code> → <code>public/assets/generated/${esc(item.output)}</code></p>
    ${
      item.refsStatus.length
        ? `<div class="refs">참조: ${item.refsStatus
            .map((r) => `<span class="ref">${esc(r.label)} <span class="st ${esc(r.status)}">${esc(STATUS_LABEL[r.status] ?? r.status)}</span></span>`)
            .join('')}</div>`
        : ''
    }
    ${
      accepted
        ? `<div class="accepted-box">
            <figure>${`<img class="thumb preview" src="${esc(item.url)}" alt="채택된 에셋">`}
              <figcaption>채택: ${esc(acc.source === 'upload' ? '업로드' : `후보 #${acc.candidate} · ${acc.model}`)} · ${esc(new Date(acc.acceptedAt || acc.generatedAt).toLocaleString('ko-KR'))}${acc.width ? ` · ${acc.width}×${acc.height}` : ''}</figcaption></figure>
            ${
              isAnimKind
                ? `<figure>${
                    animUrl
                      ? `<img class="thumb preview" src="${esc(animUrl)}" alt="애니메이션 미리보기">`
                      : `<img class="thumb preview anim" id="flipbook" src="${esc(item.url)}" alt="포즈 미리보기">`
                  }<figcaption>${animUrl ? '애니메이션 WebP' : '키포즈 미리보기 (같은 캐릭터의 채택된 포즈 순환 + 바운스)'}</figcaption></figure>`
                : ''
            }
          </div>`
        : ''
    }
    <label class="field"><span>프롬프트 템플릿 <small class="muted">(수정하면 이번 생성에만 적용 · {{style}} 등 변수 사용 가능)</small></span>
      <textarea id="prompt" class="prompt" spellcheck="false">${esc(prevPrompt ?? item.prompt)}</textarea></label>
    <details class="rendered"><summary>실제 전송 프롬프트 보기</summary><p>${esc(item.promptRendered)}</p></details>
    <div class="gen-row">
      <select id="gen-count" aria-label="생성 장수">${[1, 2, 3, 4, 6, 8].map((n) => `<option value="${n}" ${n === defaultCount ? 'selected' : ''}>${n}장</option>`).join('')}</select>
      <button class="btn primary" id="gen-btn" ${running ? 'disabled' : ''}>${accepted ? '재생성 (강제)' : `변형 ${defaultCount}장 생성`}</button>
      ${item.kind === 'sprite' ? `<span class="muted small">후보 1장 = ${item.frames.length}프레임 = API ${item.frames.length}회</span>` : ''}
    </div>
    <div class="progress" id="progress" ${running ? '' : 'hidden'}><span></span></div>
    <p class="muted small" id="progress-text"></p>
    <div class="list-head"><h3>후보 (${candidates.length})</h3>${
      candidates.length
        ? `<span class="cand-actions"><button class="btn tiny" id="regen-btn" ${running ? 'disabled' : ''}>재생성</button><button class="btn tiny ghost danger" id="cand-clear">후보 모두 삭제</button></span>`
        : ''
    }</div>
    <div class="cand-grid">${
      candidates.length
        ? candidates
            .map(
              (c) => `<div class="cand">
                <a href="${esc(candUrl(item.id, c))}" target="_blank" rel="noopener" title="원본 크기로 보기"><img class="thumb ${item.kind === 'pose' ? 'anim' : ''}" src="${esc(candUrl(item.id, c, c.anim ? 'anim' : 'preview'))}" alt="후보 ${c.n}" loading="lazy"></a>
                ${c.notes?.seamless && !c.notes.seamless.seamless ? `<span class="warn">⚠ 이음새 점수 ${c.notes.seamless.score}</span>` : ''}
                <div class="row"><span>#${c.n} · ${c.width}×${c.height}</span>
                <button class="btn tiny primary" data-accept="${c.n}">채택</button></div>
              </div>`,
            )
            .join('')
        : '<p class="muted small">아직 후보가 없습니다.</p>'
    }</div>
    <div class="upload-row">
      <input type="file" id="upload-file" accept="image/png,image/webp,image/jpeg" ${item.kind === 'sprite' ? 'disabled' : ''}>
      <label class="check"><input type="checkbox" id="upload-process"> 후처리 적용</label>
      <button class="btn small" id="upload-btn" ${item.kind === 'sprite' ? 'disabled' : ''}>업로드로 교체</button>
    </div>`;

  if (running) updateProgress(state.job);
  if (item.kind === 'pose' && accepted) startFlipbook(item);
}

function startFlipbook(item) {
  const img = $('#flipbook');
  if (!img) return;
  const character = item.meta?.character;
  const urls = state.items.filter((i) => i.kind === 'pose' && i.url && i.meta?.character === character).map((i) => i.url);
  if (urls.length < 2) return;
  let k = Math.max(0, urls.indexOf(item.url));
  state.flipTimer = setInterval(() => {
    k = (k + 1) % urls.length;
    img.src = urls[k];
  }, 900);
}

function updateProgress(job) {
  const bar = $('#progress');
  if (!bar) return;
  bar.hidden = job.status !== 'running';
  bar.classList.toggle('indeterminate', !job.total);
  bar.firstElementChild.style.width = job.total ? `${(job.done / job.total) * 100}%` : '';
  $('#progress-text').textContent = job.status === 'running' ? `생성 중… ${job.done}/${job.total || '?'} (장당 5~15초)` : '';
}

async function pollJob(jobId) {
  for (;;) {
    let job;
    try {
      ({ job } = await req('GET', `${API}/jobs/${jobId}`));
    } catch (e) {
      toast(e.message, 'error');
      break;
    }
    state.job = job;
    if (state.selected === job.itemId) updateProgress(job);
    if (job.status !== 'running') {
      if (job.status === 'done') toast(`후보 ${job.candidates.length}장 생성 완료${job.errors.length ? ` (실패 ${job.errors.length}건)` : ''}`);
      else toast(job.error || '생성 실패', 'error');
      state.job = null;
      await refresh();
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// ---------- events ----------
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  f.querySelector('.form-error').textContent = '';
  try {
    await req('POST', '/admin/api/login', { password: f.password.value });
    f.reset();
    await showStudio();
  } catch (err) {
    f.querySelector('.form-error').textContent = err.message;
  }
});

$('#key-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = e.currentTarget.key;
  const key = input.value.trim();
  if (!key) return;
  try {
    const d = await req('POST', `${API}/key`, { key });
    input.value = '';
    renderStatus(d);
    toast('API 키를 저장했습니다.');
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('#key-clear').addEventListener('click', async () => {
  if (!confirm('서버에 저장된 API 키를 삭제할까요?')) return;
  try {
    renderStatus(await req('DELETE', `${API}/key`));
    toast('저장된 키를 삭제했습니다.');
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('#kind-filters').addEventListener('click', (e) => {
  const b = e.target.closest('[data-kind]');
  if (!b) return;
  state.kind = b.dataset.kind;
  renderFilters();
  renderList();
});
$('#status-filter').addEventListener('change', (e) => {
  state.status = e.target.value;
  renderList();
});

$('#item-list').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-id]');
  if (!b) return;
  try {
    await loadDetail(b.dataset.id);
    if (window.matchMedia('(max-width: 959px)').matches) $('#detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('#detail').addEventListener('click', async (e) => {
  const item = state.detail?.item;
  if (!item) return;
  const t = e.target;
  try {
    if (t.id === 'gen-btn' || t.id === 'regen-btn') {
      if (item.status === 'accepted' && !confirm('이미 채택된 에셋입니다. 새 후보를 만들까요? (채택본은 새로 채택할 때까지 유지됩니다)')) return;
      const count = Number($('#gen-count').value);
      const tpl = $('#prompt').value;
      const body = { count, force: item.status === 'accepted' };
      if (tpl.trim() !== item.prompt.trim()) body.prompt = tpl;
      t.disabled = true;
      const { job } = await req('POST', `${API}/generate/${encodeURIComponent(item.id)}`, body);
      state.job = job;
      updateProgress(job);
      pollJob(job.id);
    } else if (t.dataset.accept) {
      await req('POST', `${API}/accept/${encodeURIComponent(item.id)}`, { n: Number(t.dataset.accept) });
      toast(`후보 #${t.dataset.accept}을(를) 채택했습니다.`);
      await refresh();
    } else if (t.id === 'cand-clear') {
      if (!confirm('이 항목의 후보 이미지를 모두 삭제할까요?')) return;
      await req('DELETE', `${API}/candidates/${encodeURIComponent(item.id)}`);
      await refresh();
    } else if (t.id === 'upload-btn') {
      const file = $('#upload-file').files[0];
      if (!file) return toast('업로드할 이미지를 고르세요.', 'error');
      const process = $('#upload-process').checked ? '?process=1' : '';
      await req('POST', `${API}/upload/${encodeURIComponent(item.id)}${process}`, file, { raw: true, contentType: file.type || 'image/png' });
      toast('업로드한 이미지로 교체했습니다.');
      await refresh();
    }
  } catch (err) {
    toast(err.message, 'error');
    if (t.id === 'gen-btn' || t.id === 'regen-btn') t.disabled = false;
  }
});

// ---------- boot ----------
(async () => {
  try {
    const me = await req('GET', '/admin/api/me');
    if (me.admin) await showStudio();
    else showLogin();
  } catch (e) {
    toast(e.message, 'error');
    showLogin();
  }
})();
