// Stage 7 markup builders (pure strings, no DOM → node-testable): card frames, item tiles, hwatu (화투) cards for
// the 고스톱 flip, lotto balls, shop product cards. Art comes from the asset index when accepted
// (`findAsset({kind:'card', card})`, `{kind:'item', item}`), else the emoji inside an SVG frame.
import { esc, won as wonFmt } from '../format.js';
import { CARD_KINDS, cardInfo, itemInfo } from '../shared/cards.js';

/** SVG card frame (viewBox 60×84): kind colour border + cream panel + kind ribbon. */
export function cardFrameSvg(kind = 'instant') {
  const k = CARD_KINDS[kind] ?? CARD_KINDS.instant;
  return `<svg class="cf-frame" viewBox="0 0 60 84" preserveAspectRatio="none" aria-hidden="true"><rect x="1" y="1" width="58" height="82" rx="7" fill="${k.color}" stroke="${k.dark}" stroke-width="2"/><rect x="5" y="5" width="50" height="74" rx="4.5" fill="#fffdf7"/><rect x="5" y="5" width="50" height="46" rx="4.5" fill="${k.soft}"/><path d="M5 51 H55" stroke="${k.color}" stroke-width="1.5" stroke-dasharray="2 2"/><circle cx="50" cy="10" r="3" fill="${k.color}"/></svg>`;
}

/**
 * One hand card: frame + art (asset image or emoji) + name (+ 「자동」 for passive cards).
 * @param {{uid?: string, id: string, info?: object}} card
 * @param {{art?: string|null, meta?: object, attrs?: string, cls?: string, tag?: string, disabled?: boolean, note?: string}} opts
 */
export function cardHtml(card, { art = null, meta = null, attrs = '', cls = '', tag = 'button', disabled = false, note = '' } = {}) {
  const info = card.info ?? cardInfo(card.id, meta);
  const kind = info?.kind ?? 'instant';
  const pic = art ? `<img class="cf-art-img" src="${esc(art)}" alt="" loading="lazy" decoding="async">` : `<span class="cf-emoji" aria-hidden="true">${esc(info?.icon ?? '🃏')}</span>`;
  const auto = kind === 'passive' ? '<span class="cf-auto">자동</span>' : '';
  const label = `${info?.name ?? card.id} (${CARD_KINDS[kind]?.label ?? ''} 카드)${note ? ` — ${note}` : ''}`;
  const el = tag === 'button' ? `button type="button"${disabled ? ' aria-disabled="true"' : ''}` : tag;
  return `<${el} class="cardf k-${esc(kind)}${cls ? ` ${cls}` : ''}" ${attrs} title="${esc(label)}" aria-label="${esc(label)}">${cardFrameSvg(kind)}<span class="cf-art">${pic}</span><span class="cf-name">${esc(info?.name ?? card.id)}</span>${auto}</${tag}>`;
}

/** Small inline item icon (asset image or emoji). */
export function itemIconHtml(id, { art = null, meta = null, cls = 'item-ic' } = {}) {
  const info = itemInfo(id, meta);
  const title = `${info.name}${info.desc ? ` — ${info.desc}` : ''}`;
  return art
    ? `<img class="${cls} img" src="${esc(art)}" alt="${esc(info.name)}" title="${esc(title)}" loading="lazy" decoding="async">`
    : `<span class="${cls}" title="${esc(title)}" role="img" aria-label="${esc(info.name)}">${esc(info.icon)}</span>`;
}

// ---------- 화투 (hwatu) for the 고스톱 flip ----------
const HW_MONTH = ['', '송학', '매조', '벚꽃', '흑싸리', '난초', '모란', '홍싸리', '공산', '국화', '단풍'];

/** Motif of month n (1..10) inside a 60×96 card. */
function hwMotif(n) {
  switch (n) {
    case 1: // pine + crane + red sun
      return '<circle cx="42" cy="26" r="11" fill="#e53935"/><path d="M8 70 Q20 44 30 62 Q40 40 52 66" fill="#1b5e20"/><path d="M14 58 l8-6 8 6z M30 52 l8-6 8 6z" fill="#2e7d32"/><path d="M20 40 q8-8 16 0 q-6 2-8 8z" fill="#fff" stroke="#222" stroke-width="1"/>';
    case 2: // plum blossoms + bird
      return '<path d="M10 80 Q26 50 50 30" stroke="#4e342e" stroke-width="3" fill="none"/>' + [[22, 58], [32, 46], [44, 36], [16, 68]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5" fill="#ec407a"/><circle cx="${x}" cy="${y}" r="1.6" fill="#fff59d"/>`).join('') + '<ellipse cx="40" cy="62" rx="7" ry="4" fill="#fdd835"/>';
    case 3: // cherry blossom curtain
      return '<rect x="8" y="50" width="44" height="30" fill="#e53935"/><path d="M8 50 h44" stroke="#fff" stroke-width="2"/>' + [[16, 26], [30, 20], [44, 28], [22, 38], [38, 40]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="6" fill="#f8bbd0"/>`).join('');
    case 4: // black bush clover
      return [0, 1, 2, 3].map((i) => `<path d="M${12 + i * 11} 84 Q${16 + i * 11} 50 ${10 + i * 12} 16" stroke="#212121" stroke-width="3" fill="none"/>`).join('') + '<circle cx="40" cy="30" r="4" fill="#c62828"/>';
    case 5: // iris
      return '<path d="M10 84 L22 30 M30 84 L30 26 M50 84 L38 30" stroke="#2e7d32" stroke-width="4"/>' + [[22, 28], [30, 22], [38, 28]].map(([x, y]) => `<path d="M${x} ${y} l-5 -8 l5 3 l5 -3z" fill="#5e35b1"/>`).join('') + '<rect x="8" y="70" width="44" height="6" fill="#8d6e63"/>';
    case 6: // peony
      return '<circle cx="30" cy="40" r="15" fill="#d81b60"/><circle cx="30" cy="40" r="9" fill="#f06292"/><circle cx="30" cy="40" r="3" fill="#fdd835"/><path d="M12 70 q10-16 18-10 q8-8 18 8" fill="#2e7d32"/>';
    case 7: // red bush clover + boar
      return [0, 1, 2].map((i) => `<path d="M${14 + i * 14} 84 Q${20 + i * 12} 50 ${14 + i * 14} 16" stroke="#6d4c41" stroke-width="2" fill="none"/>`).join('') + [[18, 30], [30, 24], [42, 32], [24, 44], [38, 48]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" fill="#e53935"/>`).join('') + '<ellipse cx="32" cy="70" rx="12" ry="7" fill="#795548"/>';
    case 8: // pampas + full moon
      return '<rect x="5" y="5" width="50" height="45" fill="#ff7043"/><circle cx="30" cy="28" r="14" fill="#fff8e1"/><path d="M5 50 Q30 40 55 50 V91 H5z" fill="#263238"/>';
    case 9: // chrysanthemum + sake cup
      return '<circle cx="30" cy="34" r="13" fill="#fdd835"/>' + Array.from({ length: 10 }, (_, i) => `<ellipse cx="30" cy="22" rx="3" ry="8" fill="#fbc02d" transform="rotate(${i * 36} 30 34)"/>`).join('') + '<circle cx="30" cy="34" r="5" fill="#f57f17"/><path d="M20 66 h20 l-4 12 h-12z" fill="#c62828"/>';
    case 10: // maple + deer
      return [[18, 28], [40, 24], [28, 44], [44, 50]].map(([x, y]) => `<path d="M${x} ${y - 8} l3 6 6-2-3 6 5 3-6 1 1 6-6-4-6 4 1-6-6-1 5-3-3-6 6 2z" fill="#e53935"/>`).join('') + '<ellipse cx="30" cy="72" rx="12" ry="6" fill="#8d6e63"/>';
    default:
      return '';
  }
}

/**
 * A 화투 card (60×96 SVG). `n` = 끗수 1..10 (month); `back: true` draws the red back.
 */
export function hwatuSvg(n, { back = false, cls = '' } = {}) {
  if (back) {
    return `<svg class="hw-svg back ${cls}" viewBox="0 0 60 96" aria-hidden="true"><rect x="1" y="1" width="58" height="94" rx="5" fill="#b71c1c" stroke="#3e0000" stroke-width="2"/><rect x="6" y="6" width="48" height="84" rx="3" fill="none" stroke="#ffcdd2" stroke-width="1.5" stroke-dasharray="3 3"/><circle cx="30" cy="48" r="12" fill="none" stroke="#ffcdd2" stroke-width="2"/><path d="M30 38 v20 M20 48 h20" stroke="#ffcdd2" stroke-width="2"/></svg>`;
  }
  const m = Math.max(1, Math.min(10, Math.round(Number(n) || 1)));
  return `<svg class="hw-svg face ${cls}" viewBox="0 0 60 96" role="img" aria-label="${m}끗 ${HW_MONTH[m]}"><rect x="1" y="1" width="58" height="94" rx="5" fill="#1a1a1a"/><rect x="4" y="4" width="52" height="88" rx="3" fill="#fff8e7"/><g>${hwMotif(m)}</g><rect x="4" y="4" width="18" height="18" rx="3" fill="#b71c1c"/><text x="13" y="17.5" text-anchor="middle" font-size="13" font-weight="900" fill="#fff" font-family="system-ui,sans-serif">${m}</text></svg>`;
}

/** Flippable hwatu (CSS 3D flip; `data-flip` is set by the caller after `delay` ms). */
export function hwatuFlipHtml(n, { delay = 0, win = false } = {}) {
  return `<span class="hw${win ? ' win' : ''}" style="--hw-delay:${Math.max(0, Number(delay) || 0)}ms"><span class="hw-in"><span class="hw-side hw-back">${hwatuSvg(0, { back: true })}</span><span class="hw-side hw-face">${hwatuSvg(n)}</span></span></span>`;
}

/** Lotto ball (colour by range like the Korean lotto: 1-10 yellow, 11-20 blue). */
export function lottoBallHtml(n, { hit = false, delay = null, small = false } = {}) {
  const color = n <= 10 ? '#fbc400' : n <= 20 ? '#69c8f2' : n <= 30 ? '#ff7272' : '#aaa';
  const style = `--ball:${color}${delay != null ? `;--ball-delay:${delay}ms` : ''}`;
  return `<span class="lotto-ball${hit ? ' hit' : ''}${small ? ' small' : ''}${delay != null ? ' drop' : ''}" style="${style}">${esc(n)}</span>`;
}

/**
 * Shop prompt options → product cards (card / item art, name, price, effect, coupon note, disabled look) + 「지나가기」.
 * Buttons carry `data-choose/data-prompt/data-char` like every prompt option.
 * @param {object} p  pending prompt (kind 'shop')
 * @param {object} who  my character answering
 * @param {{meta?, artFor?: (kind, id) => string|null, btnClass?: string, won?: (n) => string}} opts
 */
export function shopOptionsHtml(p, who, { meta = null, artFor = () => null, btnClass = 'ci-opt', won = wonFmt } = {}) {
  const products = [];
  let leave = null;
  for (const o of p?.options ?? []) {
    if (o.id === 'leave' || (!o.cardId && !o.itemId && !/^buy/.test(String(o.id)))) {
      leave = o;
      continue;
    }
    products.push(o);
  }
  const attrs = (o) => `data-choose="${esc(o.id)}" data-prompt="${esc(p.promptId)}" data-char="${esc(who?.id ?? '')}"`;
  const cardsHtml = products
    .map((o) => {
      const isCard = !!o.cardId;
      const info = isCard ? cardInfo(o.cardId, meta) : o.itemId ? itemInfo(o.itemId, meta) : null;
      const art = isCard ? artFor('card', o.cardId) : o.itemId ? artFor('item', o.itemId) : null;
      const kind = isCard ? info?.kind ?? 'instant' : 'item';
      const name = info?.name ?? o.label ?? o.id;
      const base = Number(o.basePrice ?? info?.price);
      const price = Number(o.price);
      const discounted = Number.isFinite(base) && Number.isFinite(price) && price < base;
      // the definition's effect line (the server's option desc repeats kind · price · coupon)
      const desc = info?.known ? info.desc : o.desc || info?.desc || '';
      const disabled = !!o.disabled;
      const tagText = isCard ? `${CARD_KINDS[kind]?.label ?? ''} 카드` : '아이템';
      return `<button type="button" class="${btnClass} shop-item k-${esc(kind)}${disabled ? ' off' : ''}" ${attrs(o)}${disabled ? ' disabled' : ''}>
        <span class="si-tag">${esc(tagText)}</span>
        <span class="si-art">${art ? `<img src="${esc(art)}" alt="" decoding="async">` : `<span class="si-emoji" aria-hidden="true">${esc(info?.icon ?? o.icon ?? '🛍️')}</span>`}</span>
        <span class="si-name">${esc(name)}</span>
        <span class="si-desc">${esc(desc)}</span>
        <span class="si-price">${Number.isFinite(price) ? `${discounted ? `<s>${esc(won(base))}</s>` : ''}<b>${esc(won(price))}</b>` : ''}${discounted ? '<span class="si-coupon">🎟️ 쿠폰 할인</span>' : ''}</span>
        ${disabled ? `<span class="si-off">${esc(o.reason ?? (/부족/.test(String(o.desc ?? '')) ? '돈이 부족해요' : '살 수 없어요'))}</span>` : ''}
      </button>`;
    })
    .join('');
  const leaveBtn = leave
    ? `<button type="button" class="${btnClass} shop-leave" ${attrs(leave)}><span class="c-icon">${esc(leave.icon ?? '👋')}</span><span class="ci-opt-l">${esc(leave.label ?? '그냥 지나가기')}</span></button>`
    : '';
  return `<div class="shop-grid" style="--n:${Math.max(1, products.length)}">${cardsHtml}</div>${leaveBtn}`;
}

/** Default icons of the holiday prompt stakes (pass / small / big). */
export const HOLIDAY_OPTION_ICON = { pass: '🙅', small: '🪙', big: '💰' };
