// 룰렛 실력 모드 — the aim panel (DOM). Opens instead of a direct spin for my current character in a skill-mode
// room (spin dock button, floating spin button, 3D roulette tap): 📱 흔들기 (DeviceMotion) or 👆 버튼으로 (a sweeping
// gauge + 「멈춰!」 / Space / Enter) → a target 1..10 → `onAim(target, input)` sends the spin. The chosen input is
// remembered (localStorage `jinsei.rouletteInput`). Pure helpers live in rouletteSkill.js.
import {
  DEADLINE_WARN_MS,
  SHAKE,
  accelToTarget,
  createShakeMeter,
  defaultInput,
  detectShakeEnv,
  gaugePosition,
  gaugeTarget,
  jitterHint,
  loadInputPref,
  motionMagnitude,
  saveInputPref,
  shakeSupport,
} from './rouletteSkill.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/** iOS motion permission for this page (asked once from a tap). */
let motionPermission = null;

/**
 * @param {HTMLElement} host  where the panel element is appended
 * @param {{onAim: (target: number, input: 'shake'|'gauge') => Promise<boolean>|boolean, getMeta?: () => object,
 *   now?: () => number, win?: Window}} deps  `now` = server clock (turn deadline); `onAim` → true = spun
 */
export function createSkillPanel(host, { onAim, getMeta = () => null, now = () => Date.now(), win = window } = {}) {
  const el = document.createElement('div');
  el.className = 'skill-panel';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', '실력 룰렛');
  el.dataset.el = 'skillpanel';
  host.appendChild(el);

  const S = {
    open: false,
    charId: null,
    name: '',
    input: 'gauge',
    deadlineAt: null,
    sending: false,
    // gauge
    gaugeT0: 0,
    stopped: false,
    raf: 0,
    // shake
    meter: createShakeMeter(),
    listening: false,
    lastSample: 0,
    enabledAt: 0,
    tick: 0,
    env: detectShakeEnv(win),
  };

  function support() {
    return shakeSupport(S.env, motionPermission);
  }

  // ---------- markup ----------
  function cellsHtml(kind) {
    let out = '';
    for (let v = 1; v <= 10; v++) out += `<span class="sk-cell" data-v="${v}">${v}</span>`;
    return `<div class="sk-cells ${kind}">${out}</div>`;
  }

  function render() {
    const sup = support();
    const body =
      S.input === 'gauge'
        ? `<div class="sk-gauge" data-sk="gauge">${cellsHtml('gauge')}<div class="sk-needle" data-sk="needle"></div></div>
           <button type="button" class="btn primary sk-stop" data-sk="stop">✋ 멈춰!</button>
           <p class="small muted sk-tip">바늘이 원하는 숫자 위에 올 때 누르세요 · Space / Enter도 돼요</p>`
        : sup.ok && !sup.needsPermission
          ? `<div class="sk-meter" data-sk="meter">${cellsHtml('meter')}</div>
             <p class="sk-status" data-sk="status" aria-live="polite">📱 휴대폰을 흔들어 주세요!</p>
             <p class="small muted sk-tip">약하게 흔들면 작은 수, 세게 흔들면 큰 수</p>`
          : sup.needsPermission
            ? `<p class="sk-status">흔들기를 쓰려면 한 번만 허락해 주세요.</p>
               <button type="button" class="btn primary sk-enable" data-sk="enable">📱 흔들기 켜기</button>
               <p class="small muted sk-tip">약하게 흔들면 작은 수, 세게 흔들면 큰 수</p>`
            : `<p class="sk-status sk-na">${esc(sup.reason)}</p>
               <button type="button" class="btn sk-to-gauge" data-sk="to-gauge">👆 버튼으로 하기</button>`;
    el.innerHTML = `
      <div class="sk-box">
        <div class="sk-head">
          <b class="sk-title">🎯 실력 룰렛 · <bdi>${esc(S.name)}</bdi></b>
          <button type="button" class="btn tiny ghost sk-close" data-sk="close" aria-label="닫기">✕</button>
        </div>
        <div class="sk-tabs" role="tablist" aria-label="입력 방식">
          <button type="button" role="tab" class="sk-tab${S.input === 'shake' ? ' on' : ''}" data-sk-input="shake" aria-selected="${S.input === 'shake'}">📱 흔들기</button>
          <button type="button" role="tab" class="sk-tab${S.input === 'gauge' ? ' on' : ''}" data-sk-input="gauge" aria-selected="${S.input === 'gauge'}">👆 버튼으로</button>
        </div>
        <div class="sk-body" data-sk="body">${body}</div>
        <p class="sk-result" data-sk="result" aria-live="assertive" hidden></p>
        <p class="small muted sk-odds">목표 숫자 → ${esc(jitterHint(getMeta()))}</p>
        <p class="sk-warn" data-sk="warn" hidden>⏰ 곧 자동으로 돌아가요! 서둘러요</p>
      </div>`;
    if (S.input === 'gauge') startGauge();
    else stopGauge();
    if (S.input === 'shake' && sup.ok && !sup.needsPermission) listen(true);
    else listen(false);
    tickWarn();
  }

  // ---------- gauge ----------
  function startGauge() {
    stopGauge();
    S.stopped = false;
    S.gaugeT0 = performance.now();
    const needle = el.querySelector('[data-sk="needle"]');
    const cells = [...el.querySelectorAll('.sk-cells.gauge .sk-cell')];
    let lastCell = 0;
    const frame = () => {
      if (!S.open || S.stopped || S.input !== 'gauge') return;
      const { pos } = gaugePosition(performance.now() - S.gaugeT0);
      if (needle) needle.style.left = `${(pos * 100).toFixed(2)}%`;
      const v = gaugeTarget(pos);
      if (v !== lastCell) {
        cells[lastCell - 1]?.classList.remove('hot');
        cells[v - 1]?.classList.add('hot');
        lastCell = v;
      }
      S.raf = requestAnimationFrame(frame);
    };
    S.raf = requestAnimationFrame(frame);
  }
  function stopGauge() {
    if (S.raf) cancelAnimationFrame(S.raf);
    S.raf = 0;
  }
  function stopNeedle() {
    if (!S.open || S.input !== 'gauge' || S.stopped || S.sending) return;
    S.stopped = true;
    stopGauge();
    const { pos } = gaugePosition(performance.now() - S.gaugeT0);
    const needle = el.querySelector('[data-sk="needle"]');
    if (needle) needle.style.left = `${(pos * 100).toFixed(2)}%`;
    submit(gaugeTarget(pos), 'gauge');
  }

  // ---------- shake ----------
  function onMotion(ev) {
    if (!S.open || S.input !== 'shake' || S.sending) return;
    const mag = motionMagnitude(ev);
    if (mag == null) return;
    const t = performance.now();
    S.lastSample = t;
    const st = S.meter.feed(mag, t);
    const meterCells = el.querySelectorAll('.sk-cells.meter .sk-cell');
    const live = st.phase === 'wait' ? accelToTarget(st.level) : st.target;
    meterCells.forEach((c, i) => c.classList.toggle('lit', i < live));
    const status = el.querySelector('[data-sk="status"]');
    if (status && st.phase === 'shaking') status.textContent = `🔥 ${st.target}! 멈추면 결정돼요`;
    if (st.phase === 'done') submit(st.target, 'shake');
  }
  function listen(on) {
    if (on && !S.listening) {
      S.meter.reset();
      S.enabledAt = performance.now();
      S.lastSample = 0;
      win.addEventListener('devicemotion', onMotion);
      S.listening = true;
    } else if (!on && S.listening) {
      win.removeEventListener('devicemotion', onMotion);
      S.listening = false;
    }
  }
  async function enableMotion() {
    try {
      const r = await win.DeviceMotionEvent.requestPermission();
      motionPermission = r === 'granted' ? 'granted' : 'denied';
    } catch {
      motionPermission = 'denied';
    }
    if (motionPermission === 'denied') {
      S.input = 'gauge';
      saveInputPref(storage(), 'gauge');
    }
    if (S.open) render();
  }

  // ---------- result ----------
  async function submit(target, input) {
    if (S.sending) return;
    S.sending = true;
    listen(false);
    const t = target;
    const res = el.querySelector('[data-sk="result"]');
    if (res) {
      res.hidden = false;
      res.innerHTML = `🎯 <b>${t}</b>!`;
    }
    el.querySelector(`.sk-cells .sk-cell[data-v="${t}"]`)?.classList.add('pick');
    el.classList.add('picked');
    await new Promise((r) => setTimeout(r, 450));
    let ok = false;
    try {
      ok = !!(await onAim(t, input));
    } catch {
      ok = false;
    }
    S.sending = false;
    el.classList.remove('picked');
    if (ok || !S.open) close();
    else render(); // refused (state moved on / network) → try again or close
  }

  // ---------- deadline / sensor watchdog ----------
  function tickWarn() {
    const warn = el.querySelector('[data-sk="warn"]');
    if (warn) {
      const left = S.deadlineAt ? Number(S.deadlineAt) - now() : Infinity;
      warn.hidden = !(left < DEADLINE_WARN_MS);
      if (left < DEADLINE_WARN_MS) warn.textContent = `⏰ ${Math.max(0, Math.ceil(left / 1000))}초 뒤 자동으로 돌아가요! 서둘러요`;
    }
    if (S.listening && !S.lastSample && performance.now() - S.enabledAt > SHAKE.noSensorMs) {
      const status = el.querySelector('[data-sk="status"]');
      if (status && !status.dataset.nosensor) {
        status.dataset.nosensor = '1';
        status.innerHTML = '📱 흔들어 주세요! <small class="muted">(센서 신호가 없으면 「👆 버튼으로」를 눌러요)</small>';
      }
    }
  }

  // ---------- events ----------
  el.addEventListener('click', (ev) => {
    const t = ev.target;
    const tab = t.closest('[data-sk-input]');
    if (tab) {
      if (S.sending) return;
      S.input = tab.dataset.skInput;
      saveInputPref(storage(), S.input);
      render();
      return;
    }
    const act = t.closest('[data-sk]')?.dataset.sk;
    if (act === 'close') close();
    else if (act === 'stop') stopNeedle();
    else if (act === 'enable') enableMotion();
    else if (act === 'to-gauge') {
      S.input = 'gauge';
      saveInputPref(storage(), 'gauge');
      render();
    }
  });
  const onKey = (ev) => {
    if (!S.open) return;
    if (ev.key === 'Escape') {
      close();
      return;
    }
    if (S.input !== 'gauge' || (ev.key !== ' ' && ev.key !== 'Enter')) return;
    const tag = ev.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (ev.target?.closest?.('[data-sk-input], [data-sk="close"]')) return; // Enter on a tab / ✕ keeps its own meaning
    ev.preventDefault();
    stopNeedle();
  };

  function open({ charId, name, deadlineAt = null } = {}) {
    const same = S.open && S.charId === charId;
    S.charId = charId;
    S.name = name ?? '';
    S.deadlineAt = deadlineAt;
    if (same) return;
    S.env = detectShakeEnv(win);
    S.input = defaultInput(loadInputPref(storage()), S.env);
    S.open = true;
    S.sending = false;
    el.hidden = false;
    document.body.classList.add('skill-open');
    document.addEventListener('keydown', onKey, true);
    clearInterval(S.tick);
    S.tick = setInterval(tickWarn, 250);
    render();
    el.querySelector('[data-sk="stop"]')?.focus({ preventScroll: true });
  }

  function close() {
    if (!S.open) return;
    S.open = false;
    stopGauge();
    listen(false);
    clearInterval(S.tick);
    document.removeEventListener('keydown', onKey, true);
    el.hidden = true;
    el.innerHTML = '';
    document.body.classList.remove('skill-open');
  }

  return {
    open,
    close,
    /** Keep the deadline fresh while open (state updates). */
    update({ deadlineAt } = {}) {
      if (!S.open) return;
      if (deadlineAt !== undefined) S.deadlineAt = deadlineAt;
    },
    get isOpen() {
      return S.open;
    },
    get charId() {
      return S.charId;
    },
    get input() {
      return S.input;
    },
    el,
  };
}
