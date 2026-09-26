// Compact spectator banner (「관전 컷인: 간단히」): other players' minor events as a small strip under the top
// bar — portrait + tag + one line + money chips — for ~2 s, without covering the board or taking input.
//
//   const banner = createBanner(document.body);
//   banner.show(spec, { ms });   // spec = cutin.specFromGroup(...) or {tag, who, text[], chips[], cast[], tone, colors}
//   banner.clear(); banner.busy(); banner.destroy();
import { esc } from '../format.js';
import { hydratePortraits, portraitHtml } from './avatar2d.js';
import { BANNER_MS } from './cutinPolicy.js';

const MAX_QUEUE = 2;

export function createBanner(root, { getMeta = () => ({}) } = {}) {
  const host = document.createElement('div');
  host.className = 'ev-banner';
  host.hidden = true;
  host.setAttribute('role', 'status');
  host.setAttribute('aria-live', 'polite');
  root.appendChild(host);
  const q = [];
  let timer = null;
  let showing = false;

  function paint(item) {
    const { spec } = item;
    const tone = getMeta()?.presentation?.tones?.[spec.tone] ?? {};
    const color = spec.color ?? tone.colors?.tag ?? '#ea580c';
    const main = spec.cast?.find((m) => m.char.id === spec.speaker)?.char ?? spec.cast?.[0]?.char ?? null;
    const line = (spec.text ?? []).find(Boolean) ?? spec.line ?? '';
    const chips = (spec.chips ?? []).slice(0, 3);
    host.style.setProperty('--eb-tone', color);
    host.dataset.tone = spec.tone ?? 'neutral';
    host.dataset.key = spec.key ?? '';
    host.innerHTML = `
      ${main ? `<span class="eb-pt">${portraitHtml(main, { size: 38 })}</span>` : ''}
      <span class="eb-body">
        <span class="eb-tag">${esc(spec.tag ?? '')}${main ? ` · <b>${esc(main.name)}</b>` : ''}</span>
        <span class="eb-line">${esc(line)}</span>
      </span>
      ${chips.length ? `<span class="eb-chips">${chips.map((c) => `<span class="eb-chip ${esc(c.kind ?? '')}">${esc(c.text)}</span>`).join('')}</span>` : ''}`;
    hydratePortraits(host);
    host.hidden = false;
    host.classList.remove('leaving');
    host.classList.remove('in');
    void host.offsetWidth;
    host.classList.add('in');
  }

  function next() {
    clearTimeout(timer);
    const item = q.shift();
    if (!item) {
      showing = false;
      host.classList.add('leaving');
      timer = setTimeout(() => {
        if (!showing) host.hidden = true;
      }, 220);
      return;
    }
    showing = true;
    try {
      paint(item);
    } catch (err) {
      console.warn('[banner]', err);
    }
    // a backlog plays faster so the strip keeps up with the game
    const ms = q.length ? Math.min(item.ms, 1400) : item.ms;
    timer = setTimeout(next, ms);
  }

  return {
    element: host,
    /** Queue a banner (backlog capped: the oldest waiting one is dropped). */
    show(spec, { ms = BANNER_MS } = {}) {
      if (!spec) return;
      if (q.length >= MAX_QUEUE) q.shift();
      q.push({ spec, ms });
      if (!showing) next();
    },
    clear() {
      q.length = 0;
      clearTimeout(timer);
      showing = false;
      host.hidden = true;
    },
    busy: () => showing || q.length > 0,
    destroy() {
      clearTimeout(timer);
      q.length = 0;
      host.remove();
    },
  };
}
