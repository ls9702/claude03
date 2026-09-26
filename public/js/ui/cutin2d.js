// 2D event cut-in (Stage 5, 원작 방식): tone frame → 16:9 illustration window (generated background +
// layered characters) → yellow-bordered dialogue box (▼ to advance / prompt options) → character tabs.
//
//   const cutin = createCutin(document.body, { getMeta, assets, audio });
//   await cutin.show(groupOrEvent, { characters, onClose });   // queued; resolves when closed
//   cutin.queue([...groups], { characters });                   // several in order
//   cutin.showPrompt(pending, { characters, forMe, onChoose }); // state-driven prompt (options or waiting)
//   cutin.closePrompt(promptId); cutin.hide(); cutin.reaction({emoji, name}); cutin.busy(); cutin.whenIdle()
//
// Pure HTML/CSS (no WebGL) → identical on low-end / TV mode. Every asset is optional: the frame falls back to
// a CSS pattern, the background to an SVG scene, characters to the SVG portrait.
import { won, esc } from '../format.js';
import { renderAvatarLayers, portraitHtml, hydratePortraits } from './avatar2d.js';
import { autoAdvanceMs, fallbackText, isBigWin, planCutins, poseFor, tagLabel, EMOTION_GLYPH } from './cutinMap.js';

const REASON_ICON = { tile: '💰', event: '❗', exam: '📝', gift: '🎁', pension: '👵', goalPrize: '🏁', bonusSpin: '🎰', bet: '🎲' };
const SLOT_X = { 1: [34], 2: [27, 73], 3: [18, 50, 82] };

/** Fallback SVG scenes (viewBox 1600×900) when a generated background is missing. */
function sceneSvg(scene, tone) {
  const sky = { bad: ['#5b6cc9', '#aab4ea'], result: ['#a78bfa', '#ede9fe'], love: ['#f9a8d4', '#fde7f3'] }[tone] ?? ['#7cc4ff', '#dff3ff'];
  const base = `<defs><linearGradient id="ci-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset="1" stop-color="${sky[1]}"/></linearGradient></defs><rect width="1600" height="900" fill="url(#ci-sky)"/>`;
  let body;
  switch (scene) {
    case 'school':
      body = `<rect y="620" width="1600" height="280" fill="#c9a36a"/><rect x="300" y="250" width="1000" height="380" fill="#f3e3c3"/><rect x="300" y="230" width="1000" height="40" fill="#b5553c"/>${[0, 1, 2, 3, 4].map((i) => `<rect x="${360 + i * 190}" y="320" width="120" height="100" fill="#9ed2f5" stroke="#fff" stroke-width="8"/><rect x="${360 + i * 190}" y="470" width="120" height="100" fill="#9ed2f5" stroke="#fff" stroke-width="8"/>`).join('')}<rect x="740" y="180" width="120" height="80" fill="#f3e3c3"/><circle cx="800" cy="215" r="28" fill="#fff" stroke="#555" stroke-width="5"/>`;
      break;
    case 'office':
      body = `<rect width="1600" height="900" fill="#e7edf5"/><rect y="640" width="1600" height="260" fill="#b9c4d4"/>${[0, 1, 2].map((i) => `<rect x="${120 + i * 480}" y="120" width="360" height="300" fill="#bfe0ff" stroke="#fff" stroke-width="14"/>`).join('')}<rect x="200" y="560" width="1200" height="40" fill="#8b6b4a"/><rect x="330" y="470" width="160" height="100" fill="#334155"/><rect x="1100" y="470" width="160" height="100" fill="#334155"/>`;
      break;
    case 'hospital':
      body = `<rect width="1600" height="900" fill="#eef6f6"/><rect y="660" width="1600" height="240" fill="#cfe3e0"/><rect x="620" y="140" width="360" height="360" rx="30" fill="#fff" stroke="#9cc" stroke-width="10"/><rect x="770" y="200" width="60" height="240" fill="#ef4444"/><rect x="680" y="290" width="240" height="60" fill="#ef4444"/><rect x="160" y="520" width="380" height="120" rx="20" fill="#dbeafe"/>`;
      break;
    case 'wedding-hall':
      body = `<rect width="1600" height="900" fill="#fbe7ef"/><rect x="700" y="400" width="200" height="500" fill="#ef4444"/><path d="M520 700 Q520 180 800 160 Q1080 180 1080 700" fill="none" stroke="#f9a8d4" stroke-width="60"/>${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<circle cx="${560 + i * 70}" cy="${220 + Math.abs(3.5 - i) * 70}" r="30" fill="#fff" stroke="#f9a8d4" stroke-width="6"/>`).join('')}`;
      break;
    case 'mountain-trail':
      body = `<path d="M0 560 L240 320 L460 520 L700 260 L960 520 L1200 300 L1600 540 L1600 900 L0 900 Z" fill="#8fb7d9"/><path d="M0 640 L200 520 L420 630 L640 500 L860 640 L1080 520 L1320 640 L1600 540 L1600 900 L0 900 Z" fill="#5f9a6e"/><rect y="700" width="1600" height="200" fill="#4d8a4d"/><path d="M700 700 L900 700 L1120 900 L480 900 Z" fill="#d9c39a"/>`;
      break;
    default:
      body = `<g fill="#fff" opacity=".7"><ellipse cx="300" cy="180" rx="140" ry="44"/><ellipse cx="1200" cy="140" rx="120" ry="38"/></g><rect y="700" width="1600" height="200" fill="#8ccf7e"/>`;
  }
  return `<svg class="ci-bg-svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${base}${body}</svg>`;
}

/**
 * @param {HTMLElement} root  where the overlay is mounted (document.body)
 * @param {{ getMeta: () => object, assets?: {findAsset, assetUrl}, audio?: object, reducedMotion?: () => boolean }} deps
 */
export function createCutin(root, { getMeta = () => ({}), assets = {}, audio = null, reducedMotion } = {}) {
  const findAsset = assets.findAsset ?? (() => null);
  const isReduced = reducedMotion ?? (() => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const q = [];
  let cur = null; // { spec, resolve, el, timers[] }
  const idle = new Set();
  const pres = () => getMeta()?.presentation ?? {};

  const overlay = document.createElement('div');
  overlay.className = 'cutin';
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `
    <div class="ci-frame" aria-hidden="true"></div>
    <div class="ci-stage">
      <div class="ci-top"><span class="ci-era" data-ci="era"></span></div>
      <div class="ci-win" data-ci="win">
        <div class="ci-bg" data-ci="bg"></div>
        <div class="ci-cast" data-ci="cast"></div>
        <div class="ci-tag" data-ci="tag"></div>
        <div class="ci-fx" data-ci="fx" aria-hidden="true"></div>
      </div>
      <div class="ci-reacts" data-ci="reacts" aria-live="polite"></div>
      <div class="ci-box" data-ci="box">
        <div class="ci-who" data-ci="who"></div>
        <div class="ci-chips" data-ci="chips"></div>
        <div class="ci-text" data-ci="text" aria-live="polite"></div>
        <div class="ci-options" data-ci="options"></div>
        <div class="ci-foot"><span class="ci-wait" data-ci="wait"></span><button type="button" class="ci-next" data-ci="next" aria-label="다음">▼</button></div>
        <i class="ci-progress" data-ci="progress" aria-hidden="true"></i>
      </div>
      <div class="ci-tabs" data-ci="tabs"></div>
    </div>`;
  root.appendChild(overlay);
  const $ = Object.fromEntries([...overlay.querySelectorAll('[data-ci]')].map((n) => [n.dataset.ci, n]));

  // ---------- spec building ----------
  const nameOf = (chars, id) => chars.find((c) => c.id === id)?.name ?? '';

  /** Engine group (planCutins) → display spec. */
  function specFromGroup(g, { characters = [], room = null } = {}) {
    const a = g.anchor;
    const main = characters.find((c) => c.id === g.charId) ?? null;
    const name = main?.name ?? '';
    const chips = [];
    for (const m of g.money) {
      const who = m.charId !== g.charId ? `${nameOf(characters, m.charId)} ` : '';
      chips.push({ text: `${REASON_ICON[m.reason] ?? '💰'} ${who}${m.delta > 0 ? '+' : ''}${won(m.delta)}`, kind: m.delta > 0 ? 'plus' : 'minus' });
    }
    if (a.type === 'finished') chips.unshift({ text: `🏁 ${a.place}등 골인`, kind: 'plus' });
    const cast = g.involved
      .map((id) => characters.find((c) => c.id === id))
      .filter(Boolean)
      .map((c, i) => {
        const isMain = c.id === g.charId;
        const delta = g.money.filter((m) => m.charId === c.id).reduce((s, m) => s + m.delta, 0);
        let pose = isMain ? poseFor(a, { delta }) : delta > 0 ? 'jump' : delta < 0 ? 'idle' : 'wave';
        let emotion = isMain ? a.emotion : delta > 0 ? 'joy' : delta < 0 ? 'love' : null;
        if (a.type === 'gameOver') {
          pose = i === 0 ? 'cheer' : 'wave';
          emotion = i === 0 ? 'joy' : null;
        }
        return { char: c, pose, emotion: emotion === 'neutral' ? null : emotion };
      });
    const ownerChar = characters.find((c) => c.id === g.charId);
    return {
      key: `${a.type}:${a.charId ?? ''}:${a.tileId ?? a.era ?? a.route ?? a.promptId ?? ''}`,
      tone: a.tone ?? 'neutral',
      scene: a.scene ?? 'none',
      tag: tagLabel(a, { tones: pres().tones, tileTypes: getMeta()?.board?.tileTypes, routes: getMeta()?.board?.routes }),
      who: name ? `${name}${sceneLabel(a.scene) ? ` · ${sceneLabel(a.scene)}` : ''}` : sceneLabel(a.scene),
      text: g.texts.length ? g.texts.slice(0, 3) : [fallbackText(a, name)],
      line: a.line ?? null,
      speaker: g.charId ?? cast[0]?.char.id ?? null,
      chips,
      cast,
      bigWin: isBigWin(a, g.delta),
      currentId: g.charId,
      era: a.type === 'eraChanged' ? `${a.eraName ?? ''} 시대` : '', // board state may already be ahead → no turn/era spoilers
      autoMs: autoAdvanceMs({ owner: !!ownerChar?.isMe, reduced: isReduced() }),
      characters,
    };
  }

  function sceneLabel(scene) {
    return pres().scenes?.[scene]?.label ?? '';
  }

  function eraLabel(room, c) {
    if (!room?.board) return '';
    const era = room.board.eras[c?.position?.eraIndex ?? 0];
    return `${era?.name ?? ''} 시대 · 턴 ${room.turn?.turnNo ?? ''}`;
  }

  // ---------- rendering ----------
  function applyTheme(tone) {
    const t = pres().tones?.[tone] ?? pres().tones?.neutral ?? {};
    overlay.dataset.tone = tone;
    const colors = t.colors ?? {};
    for (const [k, v] of Object.entries(colors)) overlay.style.setProperty(`--ci-${k}`, v);
    const frame = t.frame ? findAsset({ kind: 'frame', tone }) : null;
    overlay.querySelector('.ci-frame').style.backgroundImage = frame ? `url("${frame.url}")` : '';
    overlay.classList.toggle('has-frame', !!frame);
  }

  function renderBg(scene, tone) {
    const bgId = pres().scenes?.[scene]?.bg;
    const bg = scene && scene !== 'none' ? (bgId && assets.assetUrl?.(bgId)) || findAsset({ kind: 'bg', scene })?.url : null;
    $.bg.dataset.scene = scene ?? 'none';
    $.bg.innerHTML = bg ? `<img class="ci-bg-img" src="${esc(bg)}" alt="" decoding="async">` : sceneSvg(scene, tone);
    $.win.classList.toggle('generated', !!bg);
  }

  function renderCast(spec) {
    $.cast.innerHTML = '';
    $.fx.innerHTML = '';
    const n = Math.min(3, spec.cast.length) || 0;
    const xs = SLOT_X[n] ?? [];
    const els = [];
    spec.cast.slice(0, 3).forEach((m, i) => {
      const slot = document.createElement('div');
      slot.className = 'ci-slot';
      slot.style.left = `${xs[i]}%`;
      slot.classList.toggle('right', xs[i] > 50);
      slot.dataset.char = m.char.id;
      // first pose is a neutral stand; the target pose cross-fades in (keypose + procedural motion)
      const av = renderAvatarLayers(m.char.avatar, { pose: 'idle', emotion: null, name: m.char.name, flip: n > 1 && xs[i] > 50, art: m.char.art ?? null });
      slot.appendChild(av);
      if (m.emotion && EMOTION_GLYPH[m.emotion]) {
        const g = document.createElement('span');
        g.className = 'ci-emo';
        g.textContent = EMOTION_GLYPH[m.emotion];
        slot.appendChild(g);
      }
      $.cast.appendChild(slot);
      els.push({ m, av, slot, x: xs[i] });
    });
    return els;
  }

  function renderBubble(spec, els) {
    if (!spec.line) return;
    const who = els.find((e) => e.m.char.id === spec.speaker) ?? els[0];
    const b = document.createElement('div');
    b.className = 'ci-bubble';
    // beside the speaker's head (right of it for left-side characters, left of it otherwise)
    const x = who ? who.x : 30;
    b.classList.toggle('right', x > 50);
    b.style.left = x > 50 ? '' : `${Math.min(58, x + 9)}%`;
    b.style.right = x > 50 ? `${Math.min(58, 100 - x + 9)}%` : '';
    b.textContent = spec.line;
    $.fx.appendChild(b);
  }

  function renderTabs(spec) {
    const chars = spec.characters ?? [];
    const state = audio?.state;
    $.tabs.innerHTML = `<div class="ci-tabs-l">${chars
      .map(
        (c, i) =>
          `<span class="ci-tab${c.id === spec.currentId ? ' on' : ''}${c.isMe ? ' me' : ''}"><span class="ci-tab-av">${portraitHtml(c, { size: 22 })}</span>${i + 1} ${esc(c.name)}${c.id === spec.currentId ? ' ▶' : ''}</span>`,
      )
      .join('')}</div>${
      audio
        ? `<div class="ci-tabs-r"><button type="button" class="ci-tab btn-sound" data-ci-act="mute" aria-pressed="${state?.muted ? 'true' : 'false'}">${state?.muted ? '🔇 소리 꺼짐' : '🔊 소리'}</button></div>`
        : ''
    }`;
    hydratePortraits($.tabs);
  }

  function typeText(lines, done) {
    $.text.innerHTML = '';
    const full = lines.map((l) => esc(l)).join('<br>');
    if (isReduced()) {
      $.text.innerHTML = full;
      return done?.();
    }
    const plain = lines.join('\n');
    let i = 0;
    const step = () => {
      if (!cur || cur.typing !== step) return;
      i = Math.min(plain.length, i + 2);
      $.text.innerHTML = esc(plain.slice(0, i)).replaceAll('\n', '<br>');
      if (i < plain.length) cur.timers.push(setTimeout(step, 24));
      else {
        cur.typing = null;
        done?.();
      }
    };
    cur.typing = step;
    cur.full = full;
    step();
  }

  function render(item) {
    const { spec } = item;
    overlay.hidden = false;
    overlay.classList.remove('leaving');
    overlay.classList.toggle('prompt', !!spec.prompt);
    overlay.classList.toggle('minimized', false);
    overlay.dataset.kind = spec.prompt ? 'prompt' : spec.kind ?? 'event';
    overlay.dataset.key = spec.key ?? '';
    overlay.setAttribute('aria-label', spec.tag || '이벤트');
    applyTheme(spec.tone);
    renderBg(spec.scene, spec.tone);
    $.tag.textContent = spec.tag ?? '';
    $.era.textContent = spec.era ?? '';
    $.who.textContent = spec.who ?? '';
    $.who.hidden = !spec.who;
    $.chips.innerHTML = (spec.chips ?? []).map((c) => `<span class="ci-chip ${c.kind ?? ''}">${esc(c.text)}</span>`).join('');
    $.reacts.innerHTML = '';
    renderTabs(spec);
    renderOptions(spec);
    // restart the entry animation
    overlay.classList.remove('enter');
    void overlay.offsetWidth;
    overlay.classList.add('enter');
    const els = renderCast(spec);
    item.els = els;
    audio?.play(pres().tones?.[spec.tone]?.sfx ?? 'pop');
    typeText(spec.text ?? [], null);
    // keyposes after the entry squash: cross-fade to the target pose, speech bubble pops, big win → jump sprite
    item.timers.push(
      setTimeout(() => {
        for (const e of els) e.av.setState({ pose: e.m.pose, emotion: e.m.emotion });
        renderBubble(spec, els);
        if (spec.line) audio?.play('babble', { seed: spec.line.length, count: Math.min(6, 2 + Math.floor(spec.line.length / 6)) });
        const main = els.find((e) => e.m.char.id === spec.speaker) ?? els[0];
        if (main?.m.emotion === 'cry') audio?.play('tears');
        if (spec.bigWin && main && !isReduced()) {
          item.timers.push(
            setTimeout(() => {
              if (cur === item) main.av.playSprite?.();
            }, 450),
          );
        }
      }, isReduced() ? 0 : 320),
    );
    $.progress.classList.remove('run');
    if (spec.autoMs) {
      item.timers.push(setTimeout(() => cur === item && close(), spec.autoMs));
      $.progress.style.setProperty('--ci-auto', `${spec.autoMs}ms`);
      void $.progress.offsetWidth;
      $.progress.classList.add('run');
    }
    $.next.hidden = !!(spec.prompt && spec.prompt.forMe?.length);
    requestAnimationFrame(() => {
      if (cur !== item) return;
      const b = overlay.querySelector('.ci-opt') ?? (!$.next.hidden ? $.next : null);
      b?.focus({ preventScroll: true });
    });
  }

  function renderOptions(spec) {
    const p = spec.prompt;
    $.options.innerHTML = '';
    $.wait.innerHTML = '';
    if (!p) return;
    if (p.forMe?.length) {
      const who = p.forMe[0];
      $.options.innerHTML = `${
        p.forMe.length > 1 || who.id !== p.charId ? `<p class="ci-opt-who">${esc(who.name)}의 선택${p.forMe.length > 1 ? ` <small>(내 캐릭터 ${p.forMe.length}명 남음)</small>` : ''}</p>` : ''
      }<div class="ci-opt-list">${p.options
        .map(
          (o) =>
            `<button type="button" class="ci-opt" data-choose="${esc(o.id)}" data-prompt="${esc(p.promptId)}" data-char="${esc(who.id)}"><span class="c-icon">${esc(o.icon ?? '')}</span>${esc(o.label ?? o.id)}</button>`,
        )
        .join('')}</div>`;
    }
    const waiting = p.waitingNames ?? [];
    if (!p.forMe?.length && waiting.length) $.wait.innerHTML = `⏳ ${esc(waiting.join(', '))}의 선택을 기다리는 중…`;
    if (p.deadlineAt) $.wait.innerHTML += ` <span class="ci-deadline" data-deadline="${p.deadlineAt}"></span>`;
    tickDeadline();
  }

  function tickDeadline() {
    for (const d of overlay.querySelectorAll('[data-deadline]')) {
      const left = Math.max(0, Math.ceil((Number(d.dataset.deadline) - Date.now()) / 1000));
      d.textContent = `남은 시간 ${left}초`;
    }
  }
  const ticker = setInterval(tickDeadline, 250);

  // ---------- queue ----------
  function pump() {
    if (cur || !q.length) {
      if (!cur && !q.length) {
        overlay.hidden = true;
        document.body?.classList.remove('cutin-open');
        for (const cb of [...idle]) cb();
      }
      return;
    }
    cur = q.shift();
    cur.timers = [];
    document.body?.classList.add('cutin-open');
    try {
      render(cur);
    } catch (err) {
      console.warn('[cutin]', err);
      const it = cur;
      cur = null;
      it.resolve(false);
      pump();
    }
  }

  function close(result = true) {
    const it = cur;
    if (!it) return;
    for (const t of it.timers) clearTimeout(t);
    cur = null;
    overlay.classList.add('leaving');
    try {
      it.opts?.onClose?.(result);
    } catch (err) {
      console.warn('[cutin] onClose', err);
    }
    it.resolve(result);
    setTimeout(pump, isReduced() ? 0 : 140);
  }

  function enqueue(spec, opts = {}) {
    return new Promise((resolve) => {
      q.push({ spec, opts, resolve, timers: [] });
      if (!cur) pump();
    });
  }

  function toSpecs(input, opts) {
    if (!input) return [];
    if (input.anchor) return [specFromGroup(input, opts)];
    if (input.tone && input.text && input.cast) return [input]; // prebuilt spec
    if (input.type) {
      const gs = planCutins([{ ...input, cutin: true }]);
      return gs.map((g) => specFromGroup(g, opts));
    }
    return [];
  }

  // ---------- interaction ----------
  function advance() {
    if (!cur) return;
    if (cur.typing) {
      cur.typing = null;
      $.text.innerHTML = cur.full ?? $.text.innerHTML;
      return;
    }
    if (cur.spec.prompt?.forMe?.length) return; // must choose
    if (cur.spec.prompt) {
      // spectator: minimize the waiting cut-in (it closes for good when the prompt resolves)
      cur.dismissed = true;
      overlay.classList.add('minimized');
      return close(false);
    }
    close(true);
  }

  overlay.addEventListener('click', (ev) => {
    const opt = ev.target.closest('[data-choose]');
    if (opt && cur?.opts?.onChoose) {
      for (const b of overlay.querySelectorAll('.ci-opt')) b.disabled = true;
      opt.classList.add('picked');
      audio?.play('pop');
      Promise.resolve(cur.opts.onChoose({ characterId: opt.dataset.char, promptId: opt.dataset.prompt, optionId: opt.dataset.choose })).then((ok) => {
        if (ok === false) for (const b of overlay.querySelectorAll('.ci-opt')) b.disabled = false;
      });
      return;
    }
    if (ev.target.closest('[data-ci-act="mute"]')) {
      audio?.toggleMuted();
      if (cur) renderTabs(cur.spec);
      return;
    }
    if (ev.target.closest('.ci-tabs')) return;
    advance();
  });
  document.addEventListener('keydown', (ev) => {
    if (overlay.hidden || !cur) return;
    if (ev.target.closest?.('input, textarea, select')) return;
    if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
      // buttons inside the cut-in (▼, options, sound) activate natively → click handler; don't advance twice
      if (ev.target.closest?.('button') && overlay.contains(ev.target)) return;
      ev.preventDefault(); // keep Enter/Space from pressing board buttons hidden behind the overlay
      advance();
    } else if (ev.key === 'Escape' && !cur.spec.prompt?.forMe?.length) {
      advance();
    }
  });

  // ---------- prompts ----------
  let promptItem = null;
  const dismissedPrompts = new Set();

  function promptSpec(p, { characters = [], forMe = [], room = null } = {}) {
    const subject = characters.find((c) => c.id === p.charId);
    const answered = new Set(p.answered ?? []);
    const waitingIds = p.forCharacterIds.filter((id) => !answered.has(id));
    const castIds = [p.charId, ...forMe.map((c) => c.id), ...waitingIds].filter((id, i, a) => id && a.indexOf(id) === i).slice(0, 3);
    const cast = castIds
      .map((id) => characters.find((c) => c.id === id))
      .filter(Boolean)
      .map((c) => ({ char: c, pose: c.id === p.charId ? (p.kind === 'routeChoice' ? 'wave' : 'idle') : 'idle', emotion: c.id === p.charId && p.emotion !== 'neutral' ? p.emotion : null }));
    const anchor = { type: 'prompt', tone: p.tone ?? 'neutral', title: p.title };
    return {
      key: `prompt:${p.promptId}`,
      kind: 'prompt',
      tone: p.tone ?? 'neutral',
      scene: p.scene ?? 'none',
      tag: tagLabel(anchor, { tones: pres().tones }),
      who: `${subject?.name ?? ''}${sceneLabel(p.scene) ? ` · ${sceneLabel(p.scene)}` : ''}`,
      text: [p.title, p.text].filter(Boolean),
      line: p.line ?? null,
      speaker: p.charId,
      chips: [],
      cast,
      bigWin: false,
      currentId: p.charId,
      era: eraLabel(room, subject),
      autoMs: 0,
      characters,
      prompt: {
        promptId: p.promptId,
        charId: p.charId,
        options: p.options,
        forMe,
        deadlineAt: p.deadlineAt,
        waitingNames: waitingIds.map((id) => characters.find((c) => c.id === id)?.name ?? id),
      },
    };
  }

  const api = {
    /** Show (queued) one cut-in: a planCutins group, an engine event, or a prebuilt spec. */
    show(input, opts = {}) {
      const specs = toSpecs(input, opts);
      if (!specs.length) return Promise.resolve(false);
      return Promise.all(specs.map((s) => enqueue(s, opts))).then((r) => r.every(Boolean));
    },
    /** Queue several groups/events. */
    queue(list, opts = {}) {
      return Promise.all((list ?? []).map((g) => api.show(g, opts)));
    },
    specFromGroup,
    /**
     * Prompt cut-in from `room.turn.pending`: options for my characters, a waiting screen for others.
     * Re-calling with the same prompt updates it in place (e.g. my next character, answered list).
     */
    showPrompt(p, opts = {}) {
      if (!p) return;
      const forMe = opts.forMe ?? [];
      const key = `${p.promptId}:${forMe[0]?.id ?? '-'}:${(p.answered ?? []).length}`;
      if (!forMe.length && dismissedPrompts.has(p.promptId)) return;
      if (promptItem && promptItem.promptId === p.promptId) {
        if (promptItem.key === key) return;
        promptItem.key = key;
        const spec = promptSpec(p, opts);
        if (cur && cur === promptItem.item) {
          cur.spec = spec;
          renderOptions(spec);
          $.next.hidden = !!forMe.length;
          renderTabs(spec);
          overlay.querySelector('.ci-opt')?.focus({ preventScroll: true });
        } else promptItem.item.spec = spec;
        return;
      }
      api.closePrompt();
      const spec = promptSpec(p, opts);
      const item = { spec, opts: { onChoose: opts.onChoose }, timers: [] };
      promptItem = { promptId: p.promptId, key, item };
      new Promise((resolve) => {
        item.resolve = resolve;
        q.push(item);
        if (!cur) pump();
      }).then((r) => {
        if (r === false && promptItem?.item === item && !forMe.length) dismissedPrompts.add(p.promptId);
        if (promptItem?.item === item) promptItem = null;
      });
    },
    /** Close the prompt cut-in (resolved / no longer mine). */
    closePrompt(promptId) {
      if (!promptItem || (promptId && promptItem.promptId !== promptId)) return;
      const { item } = promptItem;
      promptItem = null;
      if (cur === item) close(true);
      else {
        const i = q.indexOf(item);
        if (i >= 0) q.splice(i, 1);
        item.resolve?.(true);
      }
    },
    get promptId() {
      return promptItem?.promptId ?? null;
    },
    /** Close everything. */
    hide() {
      for (const it of q.splice(0)) it.resolve(false);
      promptItem = null;
      close(false);
    },
    /** Emoji reaction chip under the illustration window. */
    reaction({ emoji, name } = {}) {
      if (overlay.hidden || !emoji) return false;
      const chip = document.createElement('span');
      chip.className = 'ci-react';
      chip.textContent = `${emoji} ${name ?? ''}`.trim();
      $.reacts.appendChild(chip);
      while ($.reacts.childElementCount > 6) $.reacts.firstElementChild.remove();
      setTimeout(() => chip.remove(), 4000);
      return true;
    },
    /** True while a cut-in is shown or queued (prompt waiting screens included). */
    busy: () => !!cur || q.length > 0,
    /** Busy with something other than a (persistent) prompt cut-in. */
    busyEvents: () => (!!cur && cur !== promptItem?.item) || q.some((it) => it !== promptItem?.item),
    size: () => q.length + (cur ? 1 : 0),
    current: () => cur?.spec ?? null,
    whenIdle() {
      if (!api.busy()) return Promise.resolve();
      return new Promise((resolve) => {
        const cb = () => {
          idle.delete(cb);
          resolve();
        };
        idle.add(cb);
      });
    },
    onIdle(cb) {
      idle.add(cb);
      return () => idle.delete(cb);
    },
    element: overlay,
    destroy() {
      clearInterval(ticker);
      api.hide();
      overlay.remove();
    },
  };
  return api;
}
