// 노년 역전 art (string builders, no DOM; node-tested in test/client-senior.test.js): the 🏝️ 한방역전섬 stake cards and the
// 행운의 숫자 pad, the 🏆 노년 대회 entry card, the 🔨 골동품 경매 lots (cut-in options and the 2D decision sheet), the result
// panels (number wheel, hammer board, trophy) and the SVG scenes 한방역전섬 · 빈곤 농장 · 경매장.
import { esc } from '../format.js';
import { auctionPrompt, contestPrompt, islandPickPrompt, islandPrompt, standingText } from '../shared/seniorPlay.js';

/** Scenes drawn here (their own SVG wins over a sceneFallbacks background until the bg art is accepted). */
export const SENIOR_SCENES = ['island', 'farm', 'auction'];

const attrs = (p, who, o) => `data-choose="${esc(o.id)}" data-prompt="${esc(p.promptId)}" data-char="${esc(who?.id ?? '')}"${o.disabled ? ' disabled' : ''}`;
const whoHead = (p, who) => (who && (p.forCharacterIds?.length > 1 || who.id !== p.charId) ? `<p class="ci-opt-who">${esc(who.name)}의 선택</p>` : '');
const meter = (chance, label) =>
  chance != null
    ? `<span class="sm-chance" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${chance}" aria-label="${esc(label)}"><i style="width:${Math.min(100, chance)}%"></i><b>${chance}%</b></span>`
    : '';

/** Ten number dots: `numbers` lit (the last `lucky` of them green = 🍀). */
export function numberDots(numbers, lucky = 0) {
  const n = Math.max(0, Math.min(10, Math.floor(numbers)));
  const l = Math.max(0, Math.min(n, Math.floor(lucky)));
  return `<span class="isl-dots" aria-label="숫자 ${n}개">${Array.from({ length: 10 }, (_, i) => `<i class="${i < n - l ? 'on' : i < n ? 'on lucky' : ''}"></i>`).join('')}</span>`;
}

/**
 * 한방역전섬 (prompt kind `island`): the standing line, three stake cards (💥 인생 한 방 / 🔥 반반 승부 / 🪙 소소한 재미: stake,
 * the numbers covered, ×mult → the win, 쪽박 warning, risk flames) and 🏖️ 조기 은퇴 / 🍵 욕심 버리기.
 */
export function islandOptionsHtml(p, who, { btnClass = 'ci-opt', won = (n) => `${n}만원` } = {}) {
  const v = islandPrompt(p);
  const stand = standingText(v, won);
  const head = `<div class="isl-head">${stand ? `<span class="isl-stand">📊 ${esc(stand)}</span>` : ''}<span class="isl-cash">💰 현금 ${esc(won(v.cash))}</span>${v.lucky ? `<span class="isl-lucky">🍀 행운의 숫자 +${v.lucky}</span>` : ''}</div>`;
  const cards = v.tiers
    .map((t) => {
      const flames = '🔥'.repeat(Math.max(1, Math.min(3, t.risk)));
      return `<button type="button" class="${esc(btnClass)} isl-tier t-${esc(t.tier)}${t.bust ? ' bust' : ''}${t.disabled ? ' off' : ''}" ${attrs(p, who, t)}>
        <span class="isl-top"><b class="isl-name">${esc(t.icon)} ${esc(t.name)}</b><span class="isl-risk" aria-label="위험도 ${t.risk}">${flames}</span></span>
        <span class="isl-money"><span class="isl-stake">판돈 <b>${esc(won(t.stake))}</b>${t.bust ? ' (전 재산)' : ''}</span><span class="isl-win">맞히면 <b>×${esc(t.mult)}</b> = ${esc(won(t.win))}</span></span>
        <span class="isl-odds"><small class="isl-count">숫자 ${t.numbers}개</small>${numberDots(t.numbers, t.lucky)}${meter(t.chance, '맞힐 확률')}</span>
        <small class="isl-risknote">${t.disabled ? esc(t.reason) : t.bust ? '🌾 틀리면 쪽박 — 빈곤 농장으로' : '틀리면 판돈만 잃어요'}</small>
      </button>`;
    })
    .join('');
  const r = v.retire;
  const ret = r ? `<button type="button" class="${esc(btnClass)} isl-side retire" ${attrs(p, who, r)}><span class="c-icon">🏖️</span><span class="ci-opt-l">조기 은퇴${r.place ? ` · ${r.place}등` : ''}<small class="ci-opt-desc">은퇴 상금 ${esc(won(r.prize))} · 더는 룰렛을 안 돌려요</small></span></button>` : '';
  const ps = v.pass;
  const pass = ps ? `<button type="button" class="${esc(btnClass)} isl-side pass" ${attrs(p, who, ps)}><span class="c-icon">🍵</span><span class="ci-opt-l">욕심 버리기<small class="ci-opt-desc">그냥 지나가요</small></span></button>` : '';
  const others = v.others.map((o) => `<button type="button" class="${esc(btnClass)} isl-side" ${attrs(p, who, o)}><span class="ci-opt-l">${esc(o.label ?? o.id)}</span></button>`).join('');
  return `${whoHead(p, who)}<div class="isl-card">${head}<div class="isl-tiers" role="group" aria-label="판돈">${cards}</div><div class="isl-sides">${ret}${pass}${others}</div></div>`;
}

/** 행운의 숫자 (prompt kind `islandPick`): the bet summary + a 5 × 2 pad; each number shows the numbers it covers. */
export function islandPickHtml(p, who, { btnClass = 'ci-opt', won = (n) => `${n}만원` } = {}) {
  const v = islandPickPrompt(p);
  const head = `<div class="isl-head"><span class="isl-stand">${esc(v.icon)} ${esc(v.name)} · 판돈 ${esc(won(v.stake))}</span><span class="isl-win">숫자 ${v.numbers}개${v.lucky ? ` (🍀 +${v.lucky})` : ''} → ×${esc(v.mult)} = <b>${esc(won(v.win))}</b></span>${v.bust ? '<span class="isl-warn">🌾 틀리면 쪽박</span>' : ''}</div>`;
  const pad = v.options
    .map((o) => `<button type="button" class="${esc(btnClass)} isl-num" ${attrs(p, who, o)} aria-label="${esc(o.covers.join(', '))}"><b>${o.number}</b>${o.covers.length > 1 ? `<small>${esc(o.covers.join('·'))}</small>` : ''}</button>`)
    .join('');
  return `${whoHead(p, who)}<div class="isl-card pick"><div class="isl-pad" role="group" aria-label="행운의 숫자">${pad}</div>${head}</div>`;
}

/**
 * 노년 대회 (prompt kind `contest`): the theme (icon, name, the stat it uses, a helping item), the win chance, two entry tiers
 * (fee → 우승 / 입상 prizes) and 👀 구경.
 */
export function contestOptionsHtml(p, who, { btnClass = 'ci-opt', won = (n) => `${n}만원`, meta = null } = {}) {
  const v = contestPrompt(p, { meta });
  const t = v.theme;
  const head = `<div class="ct-head"><span class="ct-theme"><i aria-hidden="true">${esc(t.icon)}</i><b>${esc(t.name)}</b></span>${t.statLabel ? `<span class="ct-stat">${esc(t.statIcon)} ${esc(t.statLabel)} ${v.statValue}</span>` : ''}${
    v.item ? `<span class="ct-item">${esc(v.item.icon)} ${esc(v.item.name)} 효과!</span>` : ''
  }</div><div class="ct-odds">${meter(v.chance, '우승 확률')}${v.secondChance != null ? `<small>입상 ${v.secondChance}%</small>` : ''}</div>`;
  const tiers = v.tiers
    .map(
      (x) => `<button type="button" class="${esc(btnClass)} ct-opt t-${esc(x.tier)}${x.disabled ? ' off' : ''}" ${attrs(p, who, x)}><span class="c-icon">${esc(x.icon)}</span><span class="ci-opt-l">${esc(String(x.label).replace(/^\S+\s/, ''))} <span class="ct-fee">참가비 ${esc(won(x.fee))}</span><small class="ci-opt-desc">${
        x.disabled ? esc(x.reason) : `🏆 우승 ${esc(won(x.prize))} · 🥈 입상 ${esc(won(x.second))}`
      }</small></span></button>`,
    )
    .join('');
  const w = v.watch;
  const watch = w ? `<button type="button" class="${esc(btnClass)} ct-opt watch" ${attrs(p, who, w)}><span class="c-icon">👀</span><span class="ci-opt-l">구경만 하기<small class="ci-opt-desc">참가비 없이 박수만 쳐요</small></span></button>` : '';
  return `${whoHead(p, who)}<div class="ct-card">${head}<div class="ct-opts" role="group" aria-label="노년 대회">${tiers}${watch}</div></div>`;
}

/**
 * 골동품 경매 (prompt kind `auction`): one lot card per item / treasure (art, 정산 가치 → 낙찰가 range, 명품 premium, a secret
 * appraisal), 🧺 잡동사니 and 🚶 구경.
 */
export function auctionOptionsHtml(p, who, { btnClass = 'ci-opt', won = (n) => `${n}만원`, artFor = () => null } = {}) {
  const v = auctionPrompt(p);
  const lots = [...v.lots, ...(v.junk ? [v.junk] : [])]
    .map((l) => {
      const art = l.kind === 'item' && l.itemId ? artFor('item', l.itemId) : l.kind === 'treasure' && l.treasureId ? artFor('treasure', l.treasureId) : null;
      const range = l.low != null && l.high != null ? `낙찰 ${won(l.low)}~${won(l.high)}` : '';
      const value = l.kind === 'treasure' ? '🔒 감정가 비공개 · 가짜면 헐값' : l.kind === 'junk' ? '집 안 잡동사니' : l.base != null ? `정산 가치 ${won(l.base)}` : '';
      return `<button type="button" class="${esc(btnClass)} au-lot k-${esc(l.kind)}${l.disabled ? ' off' : ''}" ${attrs(p, who, l)}>
        <span class="au-art">${art ? `<img src="${esc(art)}" alt="" decoding="async">` : `<span aria-hidden="true">${esc(l.icon)}</span>`}</span>
        <b class="au-name">${esc(String(l.label).replace(/^\S+\s/, ''))}</b>
        <small class="au-val">${esc(value)}</small>
        ${range ? `<small class="au-range">🔨 ${esc(range)}</small>` : ''}
        ${l.premium ? `<span class="au-prem">💎 명품 프리미엄 ×${esc(l.premium)}</span>` : ''}
      </button>`;
    })
    .join('');
  const lv = v.leave ? `<button type="button" class="${esc(btnClass)} au-leave" ${attrs(p, who, v.leave)}><span class="c-icon">🚶</span><span class="ci-opt-l">구경만 하기<small class="ci-opt-desc">아무것도 팔지 않아요</small></span></button>` : '';
  const hammer = v.hammer?.length ? `<div class="au-hammer-mini" aria-label="망치 룰렛">${v.hammer.map((m, i) => `<i class="${m >= 2 ? 'hi' : m < 1 ? 'lo' : ''}" title="${i + 1} → ×${m}">×${m}</i>`).join('')}</div>` : '';
  return `${whoHead(p, who)}<div class="au-card">${hammer}<div class="au-lots" style="--n:${Math.max(1, v.lots.length + (v.junk ? 1 : 0))}" role="group" aria-label="경매 물건">${lots}</div>${lv}</div>`;
}

/** Option cards of a 노년 역전 prompt (island / islandPick / contest / auction), null for other kinds. */
export function seniorOptionsHtml(p, who, opts = {}) {
  if (p?.kind === 'island') return islandOptionsHtml(p, who, opts);
  if (p?.kind === 'islandPick') return islandPickHtml(p, who, opts);
  if (p?.kind === 'contest') return contestOptionsHtml(p, who, opts);
  if (p?.kind === 'auction') return auctionOptionsHtml(p, who, opts);
  return null;
}

// ---------- result panels ----------

/**
 * The 한방역전섬 number wheel (viewBox 0 0 220 220): ten wedges, the covered numbers gold, the pointer on top. `spin`
 * class + `--rot` (CSS) turns it so the rolled number stops under the pointer.
 */
export function islandWheelHtml(o) {
  const covers = new Set(o?.covers ?? []);
  const roll = Number(o?.roll) || 1;
  const wedges = Array.from({ length: 10 }, (_, i) => {
    const n = i + 1;
    const a0 = ((i - 0.5) * 36 - 90) * (Math.PI / 180);
    const a1 = ((i + 0.5) * 36 - 90) * (Math.PI / 180);
    const p = (a, r) => `${(110 + Math.cos(a) * r).toFixed(1)} ${(110 + Math.sin(a) * r).toFixed(1)}`;
    const mid = (i * 36 - 90) * (Math.PI / 180);
    const fill = covers.has(n) ? (n === roll ? '#ffd23f' : '#ffe58a') : i % 2 ? '#ff8a6b' : '#7cc4ff';
    return `<path d="M110 110 L${p(a0, 100)} A100 100 0 0 1 ${p(a1, 100)} Z" fill="${fill}" stroke="#3d2b52" stroke-width="3"/><text x="${(110 + Math.cos(mid) * 72).toFixed(1)}" y="${(118 + Math.sin(mid) * 72).toFixed(1)}" text-anchor="middle" font-size="22" font-weight="900" fill="#3d2b52" font-family="system-ui,sans-serif">${n}</text>`;
  }).join('');
  const rot = -((roll - 1) * 36) - 360 * 5;
  return `<div class="isl-wheel ${o?.win ? 'win' : 'lose'}${o?.jackpot ? ' jackpot' : ''}${o?.bust ? ' bust' : ''}" style="--rot:${rot}deg"><svg viewBox="0 0 220 220" aria-hidden="true"><g class="w-rot">${wedges}<circle cx="110" cy="110" r="18" fill="#3d2b52"/></g><path d="M110 4 L98 26 L122 26 Z" fill="#e2504c" stroke="#3d2b52" stroke-width="3"/></svg><b class="w-roll" aria-label="결과 ${roll}">${roll}</b></div>`;
}

/** The hammer board of a 경매 result: the ten multipliers, the rolled one lit. */
export function hammerBoardHtml(o, hammer = []) {
  const list = hammer.length ? hammer : [0.5, 0.7, 1, 1, 1.2, 1.2, 1.5, 1.8, 2.2, 3];
  const roll = Number(o?.roll) || 0;
  return `<div class="au-board${o?.big ? ' big' : ''}${o?.fake ? ' fake' : ''}"><span class="au-gavel" aria-hidden="true">🔨</span><span class="au-cells">${list
    .map((m, i) => `<i class="${i + 1 === roll ? 'hit' : ''}${m >= 2 ? ' hi' : m < 1 ? ' lo' : ''}" style="--i:${i}">×${m}</i>`)
    .join('')}</span><b class="au-price">${o?.fake ? '💥 가짜!' : `×${o?.mult ?? 1}`}</b></div>`;
}

/** 노년 대회 trophy / medal for the window. */
export const trophyHtml = (place) => `<div class="ct-trophy p-${place ?? 0}" aria-hidden="true"><span class="ct-glow"></span><span class="ct-cup">${place === 1 ? '🏆' : place === 2 ? '🥈' : '🎗️'}</span></div>`;

// ---------- scenes (viewBox 1600×900, drawn over the tone sky by cutin2d) ----------

/** Body of a 노년 역전 scene SVG; null for other scenes. */
export function seniorSceneBody(scene) {
  switch (scene) {
    case 'island': {
      // 한방역전섬: a sunset sea, a sandy island with palms, a giant roulette on the beach, a pier with a little boat
      const palms = [[260, 560, 1], [1340, 540, -1], [1460, 600, -1]].map(([x, y, s]) => `<path d="M${x} ${y} q${8 * s} -120 ${-20 * s} -230" stroke="#8a5a3c" stroke-width="22" fill="none" stroke-linecap="round"/>${[-70, -20, 30, 80].map((a) => `<path d="M${x - 20 * s} ${y - 230} q${Math.cos((a * Math.PI) / 180) * 90} ${-40 + Math.sin((a * Math.PI) / 180) * 30} ${Math.cos((a * Math.PI) / 180) * 170} ${40 + Math.sin((a * Math.PI) / 180) * 60}" stroke="#2fa35a" stroke-width="26" fill="none" stroke-linecap="round"/>`).join('')}`).join('');
      const wheel = Array.from({ length: 10 }, (_, i) => {
        const a0 = ((i * 36 - 90) * Math.PI) / 180;
        const a1 = (((i + 1) * 36 - 90) * Math.PI) / 180;
        return `<path d="M800 300 L${(800 + Math.cos(a0) * 170).toFixed(0)} ${(300 + Math.sin(a0) * 170).toFixed(0)} A170 170 0 0 1 ${(800 + Math.cos(a1) * 170).toFixed(0)} ${(300 + Math.sin(a1) * 170).toFixed(0)} Z" fill="${['#ffd23f', '#ff6b3d', '#7cc4ff', '#ff8fb1', '#6cc070'][i % 5]}" stroke="#3d2b52" stroke-width="6"/>`;
      }).join('');
      return `<rect width="1600" height="900" fill="#ffb36b" opacity=".35"/><circle cx="1260" cy="230" r="110" fill="#ffe08a" opacity=".9"/>
        <rect y="520" width="1600" height="380" fill="#3fa9d6"/><path d="M0 560 Q400 530 800 560 T1600 550" stroke="#9fdcf2" stroke-width="10" fill="none" opacity=".7"/>
        <ellipse cx="800" cy="700" rx="760" ry="170" fill="#f4d58d"/><ellipse cx="800" cy="690" rx="640" ry="120" fill="#ffe3a8"/>
        <g class="sb-wheel"><rect x="786" y="300" width="28" height="330" fill="#6b4a33"/>${wheel}<circle cx="800" cy="300" r="26" fill="#3d2b52"/><path d="M800 104 L780 140 L820 140 Z" fill="#e2504c" stroke="#3d2b52" stroke-width="5"/></g>
        ${palms}
        <rect x="40" y="610" width="300" height="24" fill="#a0724a"/>${[60, 140, 220, 300].map((x) => `<rect x="${x}" y="610" width="14" height="90" fill="#7a5233"/>`).join('')}
        <path d="M60 600 L200 600 L180 640 L80 640 Z" fill="#fff" stroke="#3d2b52" stroke-width="5"/><path d="M130 600 L130 520 L190 590 Z" fill="#ff6b3d" stroke="#3d2b52" stroke-width="4"/>
        ${[[480, 160], [1080, 120], [620, 90], [1400, 380]].map(([x, y]) => `<path d="M${x} ${y - 20}l6 14 15 2-11 10 3 15-13-8-13 8 3-15-11-10 15-2z" fill="#fff6c8" opacity=".85"/>`).join('')}`;
    }
    case 'farm': {
      // 빈곤 농장: a grey drizzly sky, a little shack, a muddy potato field with sprouts, a scarecrow and a rusty watering can
      const rows = [0, 1, 2, 3].map((r) => `<path d="M${120 + r * 40} ${640 + r * 60} Q800 ${610 + r * 60} ${1480 - r * 40} ${640 + r * 60}" stroke="#7a5a3c" stroke-width="30" fill="none" stroke-linecap="round"/>${[...Array(9).keys()].map((i) => `<path d="M${260 + i * 130 + (r % 2) * 50} ${628 + r * 60} q-10 -26 -22 -30 M${260 + i * 130 + (r % 2) * 50} ${628 + r * 60} q10 -28 24 -30" stroke="#6cc070" stroke-width="7" fill="none" stroke-linecap="round"/>`).join('')}`).join('');
      const rain = [...Array(26).keys()].map((i) => `<path d="M${(i * 137) % 1600} ${(i * 71) % 520} l-14 34" stroke="#9fb6c9" stroke-width="5" stroke-linecap="round" opacity=".6"/>`).join('');
      return `<rect width="1600" height="900" fill="#9aa5b1" opacity=".55"/>${[[300, 120], [800, 90], [1260, 140]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="210" ry="66" fill="#7d8996"/>`).join('')}
        <rect y="560" width="1600" height="340" fill="#8a6b4a"/>${rows}
        <g><path d="M1130 560 L1130 400 L1260 330 L1390 400 L1390 560 Z" fill="#b08a5a" stroke="#5a3f28" stroke-width="8"/><path d="M1110 410 L1260 320 L1410 410" fill="none" stroke="#6b4a33" stroke-width="22" stroke-linecap="round"/><rect x="1230" y="460" width="60" height="100" fill="#5a3f28"/><rect x="1160" y="430" width="44" height="40" fill="#cfe3f0" stroke="#5a3f28" stroke-width="6"/></g>
        <g><rect x="372" y="380" width="14" height="230" fill="#7a5233"/><rect x="300" y="430" width="160" height="12" fill="#7a5233"/><circle cx="379" cy="368" r="34" fill="#f4d58d" stroke="#7a5233" stroke-width="6"/><path d="M340 350 L418 350 L404 322 L354 322 Z" fill="#c9a06a"/><path d="M364 372 q15 10 30 0" stroke="#5a3f28" stroke-width="5" fill="none"/><path d="M330 446 L430 446 L420 540 L340 540 Z" fill="#8fb7d9" stroke="#5a3f28" stroke-width="5"/></g>
        <g><path d="M620 760 L700 760 L690 820 L630 820 Z" fill="#9aa5b1" stroke="#5a5f66" stroke-width="5"/><path d="M700 770 L760 740" stroke="#5a5f66" stroke-width="8" stroke-linecap="round"/></g>${rain}`;
    }
    case 'auction': {
      // 경매장: velvet curtains, a wooden podium with a gavel, chairs, display stands (a vase, a clock, a painting)
      const chairs = [...Array(10).keys()].map((i) => `<rect x="${110 + i * 145}" y="${760 + (i % 2) * 14}" width="90" height="70" rx="12" fill="#8b2e3c"/>`).join('');
      return `<rect width="1600" height="900" fill="#f6e9d8"/><path d="M0 0 L280 0 Q240 300 290 900 L0 900Z" fill="#9b2335"/><path d="M1600 0 L1320 0 Q1360 300 1310 900 L1600 900Z" fill="#9b2335"/>
        <rect x="280" y="0" width="1040" height="60" fill="#7a1b2a"/>${[0, 1, 2, 3, 4, 5].map((i) => `<path d="M${280 + i * 173} 60 q86 50 173 0" fill="#9b2335"/>`).join('')}
        <rect y="680" width="1600" height="220" fill="#a8774c"/>
        <g><rect x="700" y="470" width="200" height="220" rx="12" fill="#7a5233" stroke="#4a3220" stroke-width="8"/><rect x="680" y="450" width="240" height="40" rx="10" fill="#8f6440"/>
        <rect x="860" y="400" width="80" height="34" rx="10" fill="#5a3f28" transform="rotate(-24 900 417)"/><rect x="826" y="420" width="16" height="70" rx="6" fill="#c69c6d" transform="rotate(-24 834 455)"/></g>
        <g><rect x="360" y="420" width="140" height="260" fill="#fff" stroke="#c9a06a" stroke-width="6"/><path d="M400 420 q-20 -70 30 -110 q50 40 30 110 Z" fill="#5aa0d8" stroke="#2d5f8a" stroke-width="5"/></g>
        <g><rect x="1100" y="420" width="140" height="260" fill="#fff" stroke="#c9a06a" stroke-width="6"/><circle cx="1170" cy="350" r="56" fill="#ffd23f" stroke="#7a5233" stroke-width="6"/><path d="M1170 350 L1170 316 M1170 350 L1196 360" stroke="#3d2b52" stroke-width="6" stroke-linecap="round"/></g>
        <rect x="660" y="120" width="280" height="200" fill="#c9a06a"/><rect x="680" y="140" width="240" height="160" fill="#7cc4ff"/><circle cx="740" cy="210" r="30" fill="#ffd23f"/><path d="M680 300 L780 220 L860 290 L920 240 L920 300 Z" fill="#6cc070"/>
        ${chairs}`;
    }
    default:
      return null;
  }
}
