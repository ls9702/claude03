// Stage 9 art (string builders, no DOM; node-tested): submap scenes (시골집 · 산사 · 제주도 · 인생역전 경마장),
// horse race, treasure chest, submap prompt option cards, treasure lists. Generated art wins when accepted:
// `findAsset({kind:'bg', scene})` (cut-in background), `findAsset({kind:'treasure', treasure: id})`.
import { esc } from '../format.js';
import { HORSES, racePlan, submapOptions, treasureInfo } from '../shared/submaps.js';
import { lottoBallHtml } from './cardArt.js';

/** Scenes drawn here (their own SVG wins over a sceneFallbacks background). */
export const SUBMAP_SCENES = ['hometown', 'temple', 'jeju', 'casino'];

/** Body of a submap scene SVG (viewBox 1600×900, drawn over the tone sky by cutin2d). null for other scenes. */
export function submapSceneBody(scene) {
  switch (scene) {
    case 'hometown': {
      // 고향 시골집: 기와집 + 감나무 + 장독대 + 논
      const tiles = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => `<path d="M${470 + i * 60} 330 q30 -18 60 0" fill="none" stroke="#3e4a5c" stroke-width="10"/>`).join('');
      const jars = [0, 1, 2].map((i) => `<ellipse cx="${1180 + i * 90}" cy="660" rx="42" ry="50" fill="#7b4a2a"/><ellipse cx="${1180 + i * 90}" cy="614" rx="30" ry="10" fill="#5d341c"/>`).join('');
      const persimmons = [[300, 330], [350, 290], [260, 280], [390, 350], [230, 360], [330, 380]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="16" fill="#ff7a1a"/>`).join('');
      return `<path d="M0 520 Q400 420 800 500 T1600 480 L1600 900 L0 900 Z" fill="#9ccc65"/><path d="M0 600 Q500 540 1000 610 T1600 600 L1600 900 L0 900 Z" fill="#c5a15a"/>
        ${[0, 1, 2, 3, 4, 5].map((i) => `<path d="M0 ${660 + i * 40} L1600 ${650 + i * 40}" stroke="#a88a44" stroke-width="4" opacity=".6"/>`).join('')}
        <rect x="500" y="360" width="600" height="250" fill="#f3e2c0"/><rect x="560" y="420" width="130" height="150" fill="#b98b5a"/><rect x="760" y="420" width="130" height="150" fill="#e8d4a8" stroke="#8d6e4a" stroke-width="8"/><rect x="940" y="420" width="110" height="110" fill="#e8d4a8" stroke="#8d6e4a" stroke-width="8"/>
        <path d="M420 370 Q800 250 1180 370 L1120 330 Q800 220 480 330 Z" fill="#4a5568"/>${tiles}<rect x="480" y="600" width="640" height="26" fill="#a1887f"/>
        <rect x="286" y="340" width="28" height="300" fill="#6d4c2f"/><circle cx="300" cy="320" r="120" fill="#558b2f"/>${persimmons}
        ${jars}<path d="M1450 200 q30 -20 60 0 q-30 -10 -60 0" fill="#555"/><path d="M1360 160 q24 -16 48 0 q-24 -8 -48 0" fill="#555"/>`;
    }
    case 'temple': {
      // 산사: 겹겹 산 + 오층 석탑 + 종각(범종) + 계단
      const pagoda = [0, 1, 2, 3, 4]
        .map((i) => {
          const w = 150 - i * 22;
          const y = 600 - i * 70;
          return `<rect x="${760 - w / 2 + 20}" y="${y - 44}" width="${w - 40}" height="44" fill="#b0a898"/><path d="M${760 - w / 2 - 14} ${y - 44} L${760 + w / 2 + 14} ${y - 44} L${760 + w / 2 - 4} ${y - 62} L${760 - w / 2 + 4} ${y - 62} Z" fill="#8f8779"/>`;
        })
        .join('');
      return `<path d="M0 520 L260 300 L520 470 L800 250 L1080 460 L1340 290 L1600 470 L1600 900 L0 900 Z" fill="#6f8f9f" opacity=".8"/>
        <path d="M0 620 L300 460 L640 610 L980 470 L1300 600 L1600 500 L1600 900 L0 900 Z" fill="#4e7a52"/>
        <rect y="680" width="1600" height="220" fill="#8d7b62"/>${[0, 1, 2, 3].map((i) => `<rect x="${620 - i * 30}" y="${680 + i * 50}" width="${280 + i * 60}" height="18" fill="#a89478"/>`).join('')}
        <rect x="690" y="600" width="140" height="30" fill="#8f8779"/>${pagoda}<path d="M752 250 L768 250 L760 200 Z" fill="#8f8779"/>
        <rect x="1110" y="360" width="16" height="330" fill="#7b3f1d"/><rect x="1380" y="360" width="16" height="330" fill="#7b3f1d"/>
        <path d="M1060 370 Q1253 290 1446 370 L1420 340 Q1253 260 1086 340 Z" fill="#2f5d50"/><rect x="1090" y="360" width="326" height="18" fill="#c0392b"/>
        <path d="M1253 380 L1253 420" stroke="#5d4037" stroke-width="6"/><g class="sm-bell"><path d="M1200 420 Q1200 400 1253 400 Q1306 400 1306 420 L1318 560 L1188 560 Z" fill="#b7892f"/><rect x="1180" y="552" width="146" height="16" rx="6" fill="#8a6520"/><circle cx="1253" cy="480" r="16" fill="#8a6520"/></g>
        <circle cx="1400" cy="150" r="60" fill="#fff4c2" opacity=".85"/>`;
    }
    case 'jeju': {
      // 제주도: 한라산 + 바다 + 유채꽃 + 돌하르방
      const flowers = [...Array(26).keys()].map((i) => `<circle cx="${40 + i * 60}" cy="${760 + ((i * 37) % 60)}" r="${16 + (i % 3) * 4}" fill="#ffd600"/>`).join('');
      return `<path d="M200 420 Q600 180 1000 420 Z" fill="#6d8f6a"/><path d="M520 250 Q600 200 680 250 Z" fill="#fff" opacity=".7"/>
        <rect y="420" width="1600" height="200" fill="#1e88e5"/><rect y="420" width="1600" height="20" fill="#90caf9"/>
        ${[0, 1, 2, 3].map((i) => `<path d="M${i * 420} ${500 + (i % 2) * 40} q60 -20 120 0 t120 0" fill="none" stroke="#e3f2fd" stroke-width="6"/>`).join('')}
        <path d="M0 620 Q800 560 1600 620 L1600 900 L0 900 Z" fill="#8bc34a"/>${flowers}
        <g><rect x="1210" y="470" width="150" height="300" rx="60" fill="#5f5f66"/><ellipse cx="1285" cy="440" rx="80" ry="40" fill="#4f4f55"/><rect x="1215" y="420" width="140" height="30" rx="14" fill="#4f4f55"/>
        <circle cx="1255" cy="540" r="16" fill="#3a3a40"/><circle cx="1315" cy="540" r="16" fill="#3a3a40"/><path d="M1270 590 Q1285 620 1300 590" stroke="#3a3a40" stroke-width="10" fill="none"/>
        <rect x="1230" y="650" width="110" height="26" rx="12" fill="#48484e"/><rect x="1190" y="770" width="190" height="30" rx="10" fill="#6b6b72"/></g>
        <g><rect x="170" y="560" width="14" height="160" fill="#795548"/><path d="M177 560 q-90 -30 -120 10 M177 560 q90 -40 120 0 M177 560 q-40 -80 -90 -70 M177 560 q50 -80 100 -60" stroke="#2e7d32" stroke-width="16" fill="none" stroke-linecap="round"/></g>`;
    }
    case 'casino': {
      // 인생역전: 경마장 + 전광판 + 조명
      const lights = [...Array(18).keys()].map((i) => `<circle cx="${60 + i * 88}" cy="60" r="12" fill="${i % 2 ? '#ffd23f' : '#ff5c8a'}"/>`).join('');
      const crowd = [...Array(24).keys()].map((i) => `<circle cx="${40 + i * 66}" cy="${330 + (i % 3) * 8}" r="22" fill="${['#e57373', '#64b5f6', '#ffd54f', '#81c784', '#ba68c8'][i % 5]}"/>`).join('');
      return `<rect width="1600" height="900" fill="#2b1d4d"/><rect y="0" width="1600" height="110" fill="#1b1133"/>${lights}
        <rect x="560" y="130" width="480" height="150" rx="16" fill="#111" stroke="#ffd23f" stroke-width="8"/>
        <text x="800" y="222" text-anchor="middle" font-size="64" font-weight="900" fill="#ffd23f" font-family="system-ui,sans-serif">인생역전</text>
        <rect y="300" width="1600" height="80" fill="#3c2a66"/>${crowd}
        <rect y="380" width="1600" height="520" fill="#6aa84f"/><rect y="400" width="1600" height="14" fill="#fff" opacity=".8"/><rect y="860" width="1600" height="14" fill="#fff" opacity=".8"/>
        ${[0, 1, 2].map((i) => `<rect y="${540 + i * 110}" width="1600" height="6" fill="#fff" opacity=".35"/>`).join('')}
        <rect x="1380" y="400" width="16" height="474" fill="#fff"/><rect x="1396" y="400" width="16" height="474" fill="#111"/>`;
    }
    default:
      return null;
  }
}

/** Side-view horse with a jockey (viewBox 0 0 120 80), facing right. */
export function horseSvg(color = '#e2504c', { num = '' } = {}) {
  return `<svg class="horse-svg" viewBox="0 0 120 80" aria-hidden="true"><g class="hs-legs" stroke="#5d4037" stroke-width="6" stroke-linecap="round"><path class="hs-l1" d="M34 50 L28 74"/><path class="hs-l2" d="M44 50 L48 74"/><path class="hs-l3" d="M80 50 L74 74"/><path class="hs-l4" d="M90 48 L96 74"/></g>
    <path d="M22 36 Q6 30 4 50 Q14 40 24 44" fill="#5d4037"/><ellipse cx="60" cy="42" rx="38" ry="15" fill="#8d6e63"/>
    <path d="M88 36 L104 12 Q112 8 116 16 L112 26 Q104 26 98 44 Z" fill="#8d6e63"/><circle cx="108" cy="16" r="2.2" fill="#222"/><path d="M98 12 L102 2 L106 12" fill="#5d4037"/>
    <rect x="46" y="30" width="26" height="16" rx="4" fill="${esc(color)}"/><text x="59" y="43" text-anchor="middle" font-size="11" font-weight="900" fill="#fff" font-family="system-ui,sans-serif">${esc(num)}</text>
    <path d="M58 30 L64 12" stroke="${esc(color)}" stroke-width="10" stroke-linecap="round"/><circle cx="66" cy="8" r="7" fill="#f5c9a0"/><path d="M59 6 Q66 -2 73 6 Z" fill="${esc(color)}"/></svg>`;
}

/**
 * Horse race panel (cut-in window). CSS animates each horse to the finish line at its `finishMs` (winner first);
 * the chosen horse is outlined, the result flag pops after the race.
 */
export function raceHtml(plan, { still = false } = {}) {
  const p = plan?.horses ? plan : racePlan(plan);
  return `<div class="sm-race${still ? ' still' : ''}" style="--race:${p.durationMs}ms">${p.horses
    .map(
      (h) => `<div class="sm-lane${h.chosen ? ' chosen' : ''}${h.winner ? ' winner' : ''}" style="--t:${h.finishMs}ms;--ease:${h.ease}"><span class="sm-odds">×${h.odds}</span><span class="sm-horse">${horseSvg(h.color, { num: h.lane + 1 })}</span>${
        h.chosen ? '<b class="sm-mine">내 말</b>' : ''
      }<span class="sm-place" style="--d:${h.finishMs}ms">${h.place}등</span></div>`,
    )
    .join('')}<i class="sm-finish" aria-hidden="true"></i><div class="sm-flag ${p.won ? 'win' : 'lose'}" style="--d:${p.durationMs}ms">${p.won ? '🏆 적중!' : '💸 꽝…'}</div></div>`;
}

/** Starting gate (reversal prompt window): the three horses with their odds. */
export function raceGateHtml() {
  return `<div class="sm-race gate">${HORSES.map((h) => `<div class="sm-lane"><span class="sm-odds">×${h.odds}</span><span class="sm-horse">${horseSvg(h.color, { num: h.lane + 1 })}</span><b class="sm-hname">${esc(h.name)}</b></div>`).join('')}<i class="sm-finish" aria-hidden="true"></i></div>`;
}

/** Treasure chest (viewBox 0 0 120 100); `open` shows the lid up and a glow. */
export function treasureChestSvg({ open = false } = {}) {
  return `<svg class="chest-svg${open ? ' open' : ''}" viewBox="0 0 120 100" aria-hidden="true">${open ? '<ellipse cx="60" cy="46" rx="46" ry="26" fill="#fff3b0" opacity=".8"/>' : ''}
    <rect x="14" y="48" width="92" height="46" rx="6" fill="#a0522d"/><rect x="14" y="62" width="92" height="8" fill="#d4a017"/><rect x="52" y="56" width="16" height="20" rx="3" fill="#ffd23f" stroke="#8a6520" stroke-width="2"/>
    <g class="chest-lid"${open ? ' transform="rotate(-28 14 48)"' : ''}><path d="M14 48 Q14 20 60 20 Q106 20 106 48 Z" fill="#b5652f"/><path d="M14 44 L106 44" stroke="#d4a017" stroke-width="7"/></g></svg>`;
}

/** Treasure art: accepted image (`art` url) else the definition's emoji. */
export function treasureArtHtml(id, { art = null, meta = null, cls = '' } = {}) {
  const info = treasureInfo(id, meta);
  return `<span class="treasure-art ${esc(cls)}">${art ? `<img src="${esc(art)}" alt="${esc(info.name)}" decoding="async">` : `<span class="ta-emoji" aria-hidden="true">${esc(info.icon)}</span>`}</span>`;
}

/**
 * Submap prompt options → cards (null for other prompt kinds): 산사 수련 = stat chips, 인생역전 = odds cards with the
 * horse + chance / stake / payout and the lotto ball, others = icon cards with desc / cost. Buttons carry
 * `data-choose/data-prompt/data-char` like every prompt option.
 */
export function submapOptionsHtml(p, who, { meta = null, btnClass = 'ci-opt', won = (n) => `${n}만원` } = {}) {
  if (!['hometown', 'temple', 'jeju', 'reversal'].includes(p?.kind)) return null;
  const opts = submapOptions(p, { meta });
  const attrs = (o) => `data-choose="${esc(o.id)}" data-prompt="${esc(p.promptId)}" data-char="${esc(who?.id ?? '')}"${o.disabled ? ' disabled' : ''}`;
  const meter = (o) => (o.chance != null ? `<span class="sm-chance" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${o.chance}" aria-label="확률"><i style="width:${Math.min(100, o.chance)}%"></i><b>${o.chance}%</b></span>` : '');
  const card = (o) => {
    if (o.kind === 'horse') {
      return `<button type="button" class="${esc(btnClass)} sm-opt horse" ${attrs(o)} style="--hc:${esc(o.horse?.color ?? '#8d6e63')}"><span class="sm-opt-art">${horseSvg(o.horse?.color, { num: (o.horse?.lane ?? 0) + 1 })}</span><span class="sm-opt-body"><b>${esc(o.horseName || o.label)} <span class="sm-odds-big">×${esc(o.odds ?? '?')}</span></b>${meter(o)}${
        o.stake ? `<small>판돈 ${esc(won(o.stake))}${o.payout ? ` → 적중 ${esc(won(o.payout))}` : ''}</small>` : o.desc ? `<small class="sm-desc">${esc(o.desc)}</small>` : ''
      }${o.disabled && o.desc ? `<small class="sm-desc">${esc(o.desc)}</small>` : ''}</span></button>`;
    }
    if (o.kind === 'lotto') {
      return `<button type="button" class="${esc(btnClass)} sm-opt lotto" ${attrs(o)}><span class="sm-opt-art sm-balls">${[7, 14, 3].map((n) => lottoBallHtml(n, { small: true })).join('')}</span><span class="sm-opt-body"><b>${esc(o.icon)} ${esc(o.label)}</b>${meter(o)}${
        o.desc ? `<small class="sm-desc">${esc(o.desc)}</small>` : o.cost ? `<small>${esc(won(o.cost))}</small>` : ''
      }</span></button>`;
    }
    if (o.kind === 'train') {
      // the server desc names the gain / cost already; without one, build it
      return `<button type="button" class="${esc(btnClass)} sm-opt train" ${attrs(o)} style="--sc:${esc(o.statColor)}"><span class="sm-stat-ic">${esc(o.icon)}</span><span class="sm-opt-body"><b>${esc(o.label)}</b>${
        o.desc ? `<small class="sm-desc">${esc(o.desc)}</small>` : `${o.gain ? `<small>${esc(o.statLabel)} +${esc(o.gain)}</small>` : ''}${o.cost ? `<small>${esc(won(o.cost))}</small>` : ''}`
      }</span></button>`;
    }
    return `<button type="button" class="${esc(btnClass)} sm-opt ${esc(o.kind)}" ${attrs(o)}><span class="sm-stat-ic">${esc(o.icon)}</span><span class="sm-opt-body"><b>${esc(o.label)}</b>${meter(o)}${
      o.desc ? `<small class="sm-desc">${esc(o.desc)}</small>` : o.cost ? `<small>💸 ${esc(won(o.cost))}</small>` : ''
    }</span></button>`;
  };
  const trains = opts.filter((o) => o.kind === 'train');
  const horses = opts.filter((o) => o.kind === 'horse');
  const rest = opts.filter((o) => o.kind !== 'train' && o.kind !== 'horse');
  const head = who && (p.forCharacterIds?.length > 1 || who.id !== p.charId) ? `<p class="ci-opt-who">${esc(who.name)}의 선택</p>` : '';
  return `${head}${trains.length ? `<div class="sm-opts sm-train-row" role="group" aria-label="수련할 능력치">${trains.map(card).join('')}</div>` : ''}${
    horses.length ? `<div class="sm-opts sm-horse-row" role="group" aria-label="경마">${horses.map(card).join('')}</div>` : ''
  }${rest.length ? `<div class="sm-opts">${rest.map(card).join('')}</div>` : ''}`;
}

/** Detail card list of a character's treasures (value hidden until appraised). */
export function treasureListHtml(list, { values = null, won = (n) => `${n}만원`, artFor = () => null } = {}) {
  if (!list?.length) return '';
  return `<ul class="tr-list">${list
    .map((t) => {
      const v = values?.get?.(t.uid) ?? null;
      const text = v ? v.text : '감정 전 ???';
      return `<li class="tr-item${v?.fake ? ' fake' : ''}">${treasureArtHtml(t.id, { art: artFor('treasure', t.id), cls: 'tr-art' })}<span class="tr-name">${esc(t.info.name)}</span><small class="tr-val${v ? '' : ' unknown'}">${esc(v ? (v.fake ? text : won(v.value)) : text)}</small></li>`;
    })
    .join('')}</ul>`;
}
