// Stage 8 real-estate art (string builders, no DOM — node-tested in test/client-family.test.js):
//
//   houseSvg(id)                  → one of 6 cute flat SVG houses (원룸 전세 / 빌라 / 아파트 / 한옥 / 펜트하우스 / 제주 별장)
//   houseArtHtml(id, {art, size}) → generated art (`findAsset({kind:'house', house: id})`) when accepted, else the SVG
//   houseOptionsHtml(p, who, …)   → 매물 listing cards of the `house` prompt (cut-in + 2D modal)
//   marketChartSvg(mult)          → 부동산 시세 chart (↑ / ↓) for the houseValueChanged cut-in
//   dolTableSvg()                 → 돌잡이 table (childGrew kind dol)
import { esc, won as wonFmt } from '../format.js';
import { houseInfo, houseOptions } from '../shared/family.js';

const svg = (body, { label = '', cls = 'house-svg', view = '0 0 120 100' } = {}) =>
  `<svg class="${cls}" viewBox="${view}" role="img" aria-label="${esc(label)}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

const ground = (c = '#9bd37a') => `<ellipse cx="60" cy="94" rx="56" ry="6" fill="${c}"/>`;

/** Per-house flat illustrations (viewBox 120×100, no ids → safe to repeat on a page). */
const HOUSE_BODIES = {
  // 원룸 전세: a tiny studio with one window, a round sign and a potted plant
  oneroom: () =>
    `${ground()}<rect x="34" y="42" width="52" height="50" rx="3" fill="#f6e3c5" stroke="#8a6a4a" stroke-width="2"/>
    <path d="M28 44 L60 20 L92 44 Z" fill="#e0785a" stroke="#8a4a3a" stroke-width="2" stroke-linejoin="round"/>
    <rect x="42" y="54" width="18" height="16" rx="2" fill="#a8dcf7" stroke="#fff" stroke-width="2"/><path d="M51 54 v16 M42 62 h18" stroke="#fff" stroke-width="1.5"/>
    <rect x="66" y="62" width="13" height="30" rx="2" fill="#5b8bd6"/><circle cx="76" cy="78" r="1.4" fill="#fde68a"/>
    <circle cx="60" cy="33" r="6" fill="#fff" stroke="#8a4a3a" stroke-width="1.5"/><text x="60" y="35.5" font-size="6" text-anchor="middle" font-weight="900" fill="#8a4a3a" font-family="system-ui,sans-serif">1</text>
    <rect x="22" y="80" width="10" height="12" rx="2" fill="#c0703a"/><circle cx="27" cy="76" r="6" fill="#4caf50"/><circle cx="23" cy="72" r="4" fill="#66bb6a"/>`,
  // 빌라: three brick floors with balconies and a flat roof
  villa: () =>
    `${ground()}<rect x="26" y="18" width="68" height="74" rx="2" fill="#d98d6a" stroke="#8b4a32" stroke-width="2"/>
    <rect x="22" y="14" width="76" height="7" rx="2" fill="#7b4a3a"/>
    ${[26, 48, 70]
      .map(
        (y) =>
          `<rect x="33" y="${y}" width="16" height="13" rx="1.5" fill="#bfe6fb" stroke="#fff" stroke-width="1.5"/><rect x="71" y="${y}" width="16" height="13" rx="1.5" fill="#bfe6fb" stroke="#fff" stroke-width="1.5"/><rect x="31" y="${y + 12}" width="20" height="3" fill="#6b7280"/><rect x="69" y="${y + 12}" width="20" height="3" fill="#6b7280"/>`,
      )
      .join('')}
    <rect x="53" y="70" width="14" height="22" rx="2" fill="#6b4a2e"/><rect x="51" y="66" width="18" height="4" rx="1" fill="#374151"/>
    ${[0, 1, 2, 3, 4, 5].map((i) => `<path d="M26 ${24 + i * 12} h4 M90 ${30 + i * 11} h4" stroke="#b86e50" stroke-width="1.2"/>`).join('')}
    <circle cx="36" cy="37" r="2.5" fill="#f472b6"/><circle cx="84" cy="59" r="2.5" fill="#facc15"/>`,
  // 아파트: two white towers with a grid of windows and 「101동」
  apartment: () =>
    `${ground()}<rect x="70" y="20" width="32" height="72" rx="2" fill="#dfe6ee" stroke="#7b8794" stroke-width="2"/>
    <rect x="22" y="8" width="44" height="84" rx="2" fill="#f5f7fa" stroke="#7b8794" stroke-width="2"/>
    <rect x="22" y="8" width="44" height="7" fill="#34a36b"/><rect x="70" y="20" width="32" height="6" fill="#34a36b"/>
    ${Array.from({ length: 7 }, (_, r) => [0, 1, 2].map((k) => `<rect x="${27 + k * 13}" y="${20 + r * 9}" width="8" height="5.5" rx="1" fill="${(r + k) % 4 ? '#a9d6f5' : '#fde68a'}"/>`).join('')).join('')}
    ${Array.from({ length: 6 }, (_, r) => [0, 1].map((k) => `<rect x="${75 + k * 13}" y="${31 + r * 9}" width="8" height="5.5" rx="1" fill="#a9d6f5"/>`).join('')).join('')}
    <rect x="37" y="80" width="14" height="12" rx="1.5" fill="#64748b"/>
    <text x="44" y="14" font-size="5" font-weight="900" text-anchor="middle" fill="#fff" font-family="system-ui,sans-serif">101동</text>
    <circle cx="12" cy="84" r="7" fill="#4caf50"/><rect x="11" y="86" width="2.5" height="8" fill="#7c5a3a"/>`,
  // 한옥: curved tiled roof with upturned eaves, wooden pillars, lattice doors, stone base
  hanok: () =>
    `${ground('#b7d98f')}<rect x="18" y="80" width="84" height="12" rx="2" fill="#b8b2a7" stroke="#7d776d" stroke-width="1.5"/>
    <rect x="26" y="50" width="68" height="31" fill="#fbf4e6" stroke="#7a4b2a" stroke-width="2"/>
    ${[26, 48, 70, 92].map((x) => `<rect x="${x - 2}" y="48" width="5" height="33" fill="#8a5a33"/>`).join('')}
    ${[33, 55, 77].map((x) => `<rect x="${x}" y="56" width="12" height="20" fill="#f3e2c0" stroke="#8a5a33" stroke-width="1.2"/><path d="M${x + 4} 56 v20 M${x + 8} 56 v20 M${x} 63 h12 M${x} 70 h12" stroke="#8a5a33" stroke-width="0.8"/>`).join('')}
    <path d="M6 46 Q20 50 30 38 Q60 26 90 38 Q100 50 114 46 Q104 56 60 54 Q16 56 6 46 Z" fill="#3f4652" stroke="#262b33" stroke-width="2" stroke-linejoin="round"/>
    <path d="M22 44 Q60 34 98 44" fill="none" stroke="#5b6472" stroke-width="2"/><path d="M28 36 Q60 24 92 36" fill="none" stroke="#262b33" stroke-width="3" stroke-linecap="round"/>
    <circle cx="104" cy="74" r="5" fill="#e53935"/><circle cx="104" cy="74" r="2" fill="#fdd835"/>`,
  // 펜트하우스: a glass skyscraper with a glowing golden top floor and a rooftop pool
  penthouse: () =>
    `${ground('#a3c4e0')}<rect x="36" y="30" width="48" height="62" rx="2" fill="#6d8fb8" stroke="#3a5577" stroke-width="2"/>
    ${Array.from({ length: 6 }, (_, r) => `<rect x="40" y="${36 + r * 9}" width="40" height="5" rx="1" fill="${r % 2 ? '#a8c8ec' : '#bcd8f5'}"/>`).join('')}
    <rect x="30" y="14" width="60" height="17" rx="3" fill="#ffd66b" stroke="#b7861b" stroke-width="2"/>
    ${[0, 1, 2, 3].map((k) => `<rect x="${35 + k * 13}" y="17.5" width="10" height="10" rx="1" fill="#fff5cc"/>`).join('')}
    <rect x="28" y="10" width="64" height="5" rx="2" fill="#b7861b"/><rect x="62" y="6" width="22" height="4" rx="2" fill="#5ec8f2"/>
    <path d="M14 18 l2 5 5 1 -4 3 1 5 -4 -3 -4 3 1 -5 -4 -3 5 -1z" fill="#ffd23f"/><path d="M104 8 l1.5 3.5 3.5 .6 -2.6 2.3 .7 3.6 -3.1 -1.8 -3.1 1.8 .7 -3.6 -2.6 -2.3 3.5 -.6z" fill="#ffd23f"/>
    <rect x="54" y="80" width="12" height="12" rx="1.5" fill="#1f2d44"/>`,
  // 제주 별장: an orange-roofed villa by the sea, a palm tree, 돌하르방 and tangerines
  jeju_villa: () =>
    `<rect x="0" y="70" width="120" height="30" fill="#5cc6e8"/><path d="M0 74 q10 -4 20 0 t20 0 t20 0 t20 0 t20 0 t20 0" fill="none" stroke="#fff" stroke-width="2"/>
    <ellipse cx="62" cy="90" rx="50" ry="9" fill="#f4dfa6"/>
    <rect x="40" y="48" width="46" height="36" rx="2" fill="#fffaf0" stroke="#b07a4a" stroke-width="2"/>
    <path d="M34 50 L63 28 L92 50 Z" fill="#f28c38" stroke="#a4521c" stroke-width="2" stroke-linejoin="round"/>
    <rect x="47" y="56" width="14" height="12" rx="2" fill="#a8e1f5" stroke="#fff" stroke-width="1.5"/><rect x="66" y="62" width="12" height="22" rx="2" fill="#2f8fb3"/>
    <path d="M24 88 q-2 -26 4 -40" fill="none" stroke="#8a5a33" stroke-width="3"/><path d="M28 48 q-12 -6 -20 2 M28 48 q-4 -12 -14 -12 M28 48 q6 -12 16 -10 M28 48 q12 -2 16 8" fill="none" stroke="#2e9e4f" stroke-width="3.5" stroke-linecap="round"/>
    <rect x="94" y="72" width="10" height="16" rx="4" fill="#8d8d8d"/><circle cx="99" cy="68" r="6" fill="#9e9e9e"/><rect x="93" y="62" width="12" height="3" rx="1.5" fill="#7a7a7a"/><circle cx="97" cy="68" r="1" fill="#555"/><circle cx="101" cy="68" r="1" fill="#555"/>
    <circle cx="84" cy="90" r="3.2" fill="#ff9f1c"/><circle cx="89" cy="91" r="3" fill="#ffae33"/><path d="M84 87 l1 -2" stroke="#2e9e4f" stroke-width="1.2"/>`,
};

const GENERIC = () =>
  `${ground()}<rect x="34" y="44" width="52" height="48" rx="2" fill="#f1e4cf" stroke="#8a6a4a" stroke-width="2"/><path d="M28 46 L60 20 L92 46 Z" fill="#c7773a" stroke="#7a4b2a" stroke-width="2"/><rect x="54" y="66" width="12" height="26" fill="#7a4b2a"/>`;

/** Flat SVG of a 매물 (unknown ids → a generic house). */
export function houseSvg(id, { label = '' } = {}) {
  const body = (HOUSE_BODIES[id] ?? GENERIC)();
  return svg(body, { label: label || houseInfo(id, null)?.name || '집', cls: `house-svg h-${esc(id ?? 'house')}` });
}

/** House illustration: the accepted asset (img) when present, else the SVG. */
export function houseArtHtml(id, { art = null, label = '', cls = '' } = {}) {
  const inner = art ? `<img src="${esc(art)}" alt="${esc(label)}" decoding="async">` : houseSvg(id, { label });
  return `<span class="house-art${cls ? ` ${cls}` : ''}${art ? ' img' : ''}" data-house="${esc(id ?? '')}">${inner}</span>`;
}

/**
 * 매물 listing cards (`house` prompt): art, name, price, 보상판매 (trade-in), 청약 discount badge, capacity / owners;
 * sold-out / disabled listings are dimmed with the reason. Every card is a `data-choose` button like other options.
 * @param {object} p  pending prompt (kind house)
 * @param {object} who  my character answering
 * @param {{meta?, room?, artFor?: (kind, id) => string|null, btnClass?: string, won?: (n) => string}} opts
 */
export function houseOptionsHtml(p, who, { meta = null, room = null, artFor = () => null, btnClass = 'ci-opt', won = wonFmt } = {}) {
  const { listings, pass } = houseOptions(p, { room, meta, character: who });
  const attrs = (o) => `data-choose="${esc(o.id)}" data-prompt="${esc(p?.promptId ?? '')}" data-char="${esc(who?.id ?? '')}"`;
  const cards = listings
    .map((l) => {
      const h = l.house;
      const cap = h.capacity > 0 ? (h.capacity === 1 ? '1명 한정' : `${h.capacity}명까지`) : '여러 명 가능';
      return `<button type="button" class="${btnClass} house-item${l.disabled ? ' off' : ''}${h.lucky ? ' lucky' : ''}" ${attrs(l.option)}${l.disabled ? ' disabled' : ''}>
        ${l.discount > 0 ? `<span class="hi-disc">🎫 청약 -${esc(won(l.discount))}</span>` : h.lucky ? '<span class="hi-disc gold">✨ 골드 매물</span>' : ''}
        ${houseArtHtml(h.id, { art: artFor('house', h.id), label: h.name, cls: 'hi-art' })}
        <span class="hi-name">${esc(h.icon)} ${esc(h.name)}</span>
        <span class="hi-price"><b>${esc(won(l.price))}</b>${l.tradeIn > 0 ? `<small class="hi-trade">🔁 보상판매 +${esc(won(l.tradeIn))} → 실제 ${esc(won(l.net))}</small>` : ''}</span>
        <span class="hi-cap">👥 ${esc(cap)}${l.owners.length ? ` · 🏠 ${esc(l.owners.join(', '))}` : ''}</span>
        ${h.desc ? `<span class="hi-desc">${esc(h.desc)}</span>` : ''}
        ${l.disabled ? `<span class="hi-off">${esc(l.reason || '살 수 없어요')}</span>` : ''}
      </button>`;
    })
    .join('');
  const passBtn = pass
    ? `<button type="button" class="${btnClass} house-pass" ${attrs(pass)}><span class="c-icon">${esc(pass.icon ?? '🙅')}</span><span class="ci-opt-l">${esc(pass.label ?? '다음에 살게요')}</span></button>`
    : '';
  return `<div class="house-grid" style="--n:${Math.max(1, Math.min(3, listings.length))}">${cards}</div>${passBtn}`;
}

/** 부동산 시세 chart: a line that rises / falls to `mult` with a big arrow and the percentage. */
export function marketChartSvg(mult) {
  const m = Number(mult) || 1;
  const up = m >= 1;
  const pct = Math.round((m - 1) * 100);
  const color = up ? '#e5484d' : '#2f6fdb'; // Korean charts: red = up, blue = down
  const end = up ? 18 : 72;
  const pts = up ? [[8, 70], [26, 62], [40, 66], [56, 50], [72, 54], [88, 34], [104, end]] : [[8, 26], [26, 34], [40, 30], [56, 46], [72, 42], [88, 60], [104, end]];
  const path = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
  return svg(
    `<rect x="2" y="2" width="116" height="96" rx="10" fill="#fff" stroke="#e2e8f0" stroke-width="2"/>
    ${[25, 45, 65].map((y) => `<path d="M8 ${y} H112" stroke="#eef2f7" stroke-width="1.5"/>`).join('')}
    <path d="${path} L104 90 L8 90 Z" fill="${color}" opacity=".12"/><path d="${path}" fill="none" stroke="${color}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="104" cy="${end}" r="5" fill="${color}"/>
    <text x="60" y="${up ? 88 : 22}" text-anchor="middle" font-size="15" font-weight="900" fill="${color}" font-family="system-ui,sans-serif">${up ? '▲' : '▼'} ${pct > 0 ? '+' : ''}${pct}%</text>`,
    { label: `부동산 시세 ${pct > 0 ? '+' : ''}${pct}%`, cls: `market-svg ${up ? 'up' : 'down'}` },
  );
}

/** 돌잡이 table: 상 with 실 / 연필 / 돈 / 마이크 / 청진기 / 판사봉. */
export function dolTableSvg() {
  return svg(
    `<ellipse cx="60" cy="84" rx="54" ry="10" fill="#7b3f1d" opacity=".25"/>
    <rect x="8" y="56" width="104" height="14" rx="5" fill="#b5542c" stroke="#7b3f1d" stroke-width="2"/><rect x="16" y="70" width="8" height="18" fill="#7b3f1d"/><rect x="96" y="70" width="8" height="18" fill="#7b3f1d"/>
    <rect x="18" y="40" width="4" height="18" rx="2" fill="#fbbf24"/><path d="M18 40 l2 -5 2 5z" fill="#1f2937"/>
    <circle cx="36" cy="52" r="6" fill="#fff" stroke="#ef4444" stroke-width="2"/><path d="M31 48 q5 8 10 0" fill="none" stroke="#ef4444" stroke-width="1.5"/>
    <rect x="48" y="44" width="18" height="11" rx="1.5" fill="#86c98a" stroke="#2f7a3a" stroke-width="1.5"/><text x="57" y="52.5" text-anchor="middle" font-size="7" font-weight="900" fill="#1f5a2a" font-family="system-ui,sans-serif">₩</text>
    <rect x="72" y="38" width="5" height="14" rx="2" fill="#4b5563"/><circle cx="74.5" cy="36" r="5" fill="#9ca3af"/>
    <path d="M86 42 q0 10 8 10 q8 0 8 -10" fill="none" stroke="#3b82f6" stroke-width="2"/><circle cx="102" cy="42" r="3" fill="#3b82f6"/>
    <text x="60" y="20" text-anchor="middle" font-size="12" font-weight="900" fill="#b5542c" font-family="system-ui,sans-serif">🎂 돌잡이</text>`,
    { label: '돌잡이 상', cls: 'dol-svg' },
  );
}
