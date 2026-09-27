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
import { renderAvatarLayers, portraitHtml, hydratePortraits, preloadAvatarLayers } from './avatar2d.js';
import { autoAdvanceMs, expressionFor, fallbackText, isBigWin, isCardAnchor, planCutins, poseFor, resolveSceneBg, tagLabel, EMOTION_GLYPH } from './cutinMap.js';
import { CAST_PRELOAD_MS, PREEMPT_KEEP_MS, routeOptionInfo } from './cutinPolicy.js';
import { MC_NAMES, createMcBooth, mcScriptMs, mcSpeakers, playMcScript } from './mc.js';
import { educationLabel, jobInfo, optionExtras, optionLabel, rankName, rankStars, salaryChip, statChip } from '../shared/growth.js';
import { CARD_KINDS, cardInfo, holidayRows, holidayTitle, itemInfo, lottoRows } from '../shared/cards.js';
import { HOLIDAY_OPTION_ICON, hwatuFlipHtml, hwatuSvg, lottoBallHtml, shopOptionsHtml } from './cardArt.js';
import { CHILD_GROW, childInfo, familyCast, houseInfo, marketInfo, npcCharacter, partnerInfo, schoolMeetPairs, weddingGifts } from '../shared/family.js';
import { dolTableSvg, houseArtHtml, houseOptionsHtml, marketChartSvg } from './houseArt.js';
import { familyOptionsHtml } from './familyArt.js';
import { isSubmapBig, parseOptionId, racePlan, submapInfo, submapOf, submapSuccess, treasureInfo } from '../shared/submaps.js';
import { raceGateHtml, raceHtml, submapOptionsHtml, submapSceneBody, treasureArtHtml, treasureChestSvg } from './submapArt.js';

const REASON_ICON = {
  tile: '💰', event: '❗', exam: '📝', gift: '🎁', pension: '👵', goalPrize: '🏁', bonusSpin: '🎰', bet: '🎲', salary: '💵', habit: '📚', tuition: '🎓', military: '🪖',
  // Stage 7
  shop: '🛍️', card: '🃏', sabotage: '💢', tax_audit: '🧾', complaint: '📮', pledge: '🗳️', trade: '🤝', sebae: '🧧', gostop: '🎴', holiday: '🎉', lotto: '🎱',
  // Stage 8
  wedding: '💒', weddingGift: '💌', dolGift: '🎂', date: '💑', house: '🏠', houseSold: '🔁', allowance: '💌', school: '🎒', childExam: '🎓', spouse: '💑', birth: '👶', birthBonus: '🍼', family: '👨‍👩‍👧',
};
/** Stage 6 anchors → presentation defaults (the server's tone / scene / emotion win when set). */
const STAGE6_LOOK = {
  jobChanged: { tone: 'career', scene: 'office', pose: 'cheer', emotion: 'joy', sfx: 'fanfare' },
  rankUp: { tone: 'career', scene: 'office', pose: 'cheer', emotion: 'joy', sfx: 'fanfare', bigWin: true },
  hiddenJobUnlocked: { tone: 'treasure', scene: null, pose: 'cheer', emotion: 'shock', sfx: 'fanfare', bigWin: true, fx: 'gold' },
  injured: { tone: 'bad', scene: 'hospital', pose: 'cry', emotion: 'cry', sfx: 'thud', glyph: '🤕' },
  militaryStart: { tone: 'neutral', scene: 'mountain-trail', pose: 'wave', emotion: 'sweat', sfx: 'whoosh', glyph: '🪖' },
  militaryEnd: { tone: 'good', scene: null, pose: 'cheer', emotion: 'joy', sfx: 'fanfare', glyph: '🎖️' },
  educationChanged: { tone: 'good', scene: 'school', pose: 'cheer', emotion: 'joy', sfx: 'fanfare', glyph: '🎓' },
};
/**
 * Stage 7 anchors → presentation defaults (server tone / scene / emotion win). `target*` = the other character on stage
 * (sabotage victim / defender / gift receiver).
 */
function stage7Look(a) {
  switch (a?.type) {
    case 'cardUsed':
      if (a.cardId === 'pledge') return { tone: 'career', scene: 'stage', pose: 'cheer', emotion: 'joy', sfx: 'fanfare', glyph: '🗳️' };
      if (a.targetId) return { tone: 'bad', scene: null, pose: 'cheer', emotion: 'joy', sfx: 'thud', targetPose: 'shock', targetEmotion: 'shock', targetGlyph: '💢' };
      return { tone: 'good', scene: null, pose: 'wave', emotion: 'joy', sfx: 'pop' };
    case 'cardBlocked':
      return { tone: 'good', scene: null, pose: 'shock', emotion: 'sweat', sfx: 'fanfare', targetPose: 'cheer', targetEmotion: 'joy', targetGlyph: '🛡️' };
    case 'itemBought':
      return { tone: 'treasure', scene: 'shop', pose: 'cheer', emotion: 'joy', sfx: 'coin', glyph: '🛍️' };
    case 'holidayStarted':
    case 'holidayResult':
      return { tone: 'holiday', scene: 'holiday', pose: 'wave', emotion: 'joy', sfx: 'fanfare' };
    case 'lottoDraw':
      return { tone: 'treasure', scene: 'studio', pose: 'idle', emotion: null, sfx: 'fanfare' };
    case 'cardGained':
      return { tone: 'good', scene: null, pose: 'jump', emotion: 'joy', sfx: 'pop', glyph: '🃏' };
    case 'gift':
      return { tone: 'love', scene: null, pose: 'wave', emotion: 'joy', sfx: 'heart', targetPose: 'jump', targetEmotion: 'joy', targetGlyph: '🎁' };
    case 'tradeResolved':
      return a.status === 'accepted'
        ? { tone: 'good', scene: null, pose: 'cheer', emotion: 'joy', sfx: 'coin', targetPose: 'cheer', targetEmotion: 'joy', glyph: '🤝' }
        : { tone: 'neutral', scene: null, pose: 'idle', emotion: 'sweat', sfx: 'pop' };
    default:
      return null;
  }
}
const SLOT_X = { 1: [34], 2: [27, 73], 3: [18, 50, 82] };
/** Max figures in the window (Stage 8: a family may bring the spouse + a child next to the characters). */
const MAX_CAST = 5;

/**
 * Stage 8 anchors → presentation defaults (server tone / scene / emotion win). `fx`: wedding (confetti + 💒 frame),
 * hearts (❤️ burst), heartbreak (💔), house / market / dol panels come from the spec.
 */
function stage8Look(a) {
  switch (a?.type) {
    case 'met':
      return { tone: 'love', scene: null, pose: 'wave', emotion: 'shy', sfx: 'heart', glyph: '💘' };
    case 'dated':
      return { tone: 'love', scene: null, pose: 'cheer', emotion: 'love', sfx: 'heart' };
    case 'proposed':
      return a.success
        ? { tone: 'love', scene: 'wedding-hall', pose: 'jump', emotion: 'love', sfx: 'fanfare', fx: 'hearts', bigWin: true }
        : { tone: 'bad', scene: null, pose: 'cry', emotion: 'cry', sfx: 'thud', fx: 'heartbreak', glyph: '💔' };
    case 'married':
      return { tone: 'love', scene: 'wedding-hall', pose: 'cheer', emotion: 'joy', sfx: 'fanfare', fx: 'wedding', bigWin: true };
    case 'schoolMeet':
      return { tone: 'love', scene: 'school', pose: 'wave', emotion: 'shy', sfx: 'heart' };
    case 'childBorn':
      return { tone: 'love', scene: 'hospital', pose: 'cheer', emotion: 'joy', sfx: 'fanfare', fx: 'hearts' };
    case 'childGrew':
      return { tone: a.kind === 'job' ? 'career' : 'good', scene: CHILD_GROW[a.kind]?.scene ?? null, pose: 'cheer', emotion: 'joy', sfx: 'fanfare' };
    case 'houseBought':
      return { tone: 'treasure', scene: null, pose: 'cheer', emotion: 'joy', sfx: 'fanfare', glyph: '🏠', bigWin: true };
    case 'houseValueChanged':
      return (Number(a.mult) || 1) >= 1 ? { tone: 'treasure', scene: 'studio', pose: 'cheer', emotion: 'joy', sfx: 'fanfare' } : { tone: 'bad', scene: 'studio', pose: 'shock', emotion: 'shock', sfx: 'thud' };
    default:
      return null;
  }
}

/**
 * Stage 9 anchors → presentation defaults (server tone / scene / emotion win): submap results (success → the submap's
 * tone, a loss → bad), treasure finds (treasure tone, 💎). `fx9`: race (경마 animation) / wish (✨ rising) / wishfail /
 * lotto; the submap scene (시골집 · 산사 · 제주도 · 경마장) is the default background.
 */
function stage9Look(a) {
  if (a?.type === 'treasureFound') return { tone: 'treasure', scene: null, pose: 'jump', emotion: 'joy', sfx: 'fanfare', glyph: '💎', bigWin: true };
  if (a?.type !== 'submapResult') return null;
  const info = submapInfo(submapOf(a));
  const ok = submapSuccess(a);
  const kind = parseOptionId(a.optionId).kind;
  const fx9 = kind === 'horse' ? 'race' : kind === 'wish' ? (ok === false ? 'wishfail' : 'wish') : kind === 'lotto' ? 'lotto' : null;
  return {
    tone: ok === false ? 'bad' : ok && (kind === 'horse' || kind === 'lotto') ? 'treasure' : info.tone,
    scene: info.scene,
    pose: ok === false ? 'cry' : ok ? (kind === 'horse' || kind === 'lotto' ? 'jump' : 'cheer') : 'wave',
    emotion: ok === false ? 'cry' : 'joy',
    sfx: ok === false ? 'thud' : ok ? 'fanfare' : 'pop',
    glyph: ok === false ? null : kind === 'wish' ? '🙏' : kind === 'train' ? '🧘' : null,
    fx9,
    bigWin: isSubmapBig(a),
  };
}

/**
 * Horizontal slot centres (%) for a cast: the classic 1–3 slots for full-size figures, else spread by figure width
 * (children are narrower) between 13 % and 87 %.
 */
export function slotPositions(scales = []) {
  const n = scales.length;
  if (!n) return [];
  if (n <= 3 && scales.every((x) => (x ?? 1) >= 1)) return SLOT_X[n];
  const w = scales.map((x) => Math.max(0.35, x ?? 1));
  const total = w.reduce((a, b) => a + b, 0);
  const lo = n === 2 ? 24 : 13;
  const hi = n === 2 ? 76 : 87;
  let acc = 0;
  return w.map((x) => {
    const c = (acc + x / 2) / total;
    acc += x;
    return Math.round(lo + c * (hi - lo));
  });
}

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
    case 'studio': {
      // 「인생 방송국」 TV studio (Stage 5.6 MC cut-in): truss lights, screens, sign, stage
      const beams = [220, 560, 1040, 1380]
        .map((x, i) => `<path d="M${x} 70 L${x + (i < 2 ? 160 : -160)} 900 L${x + (i < 2 ? -40 : 40)} 900 Z" fill="#fff6c8" opacity=".16"/>`)
        .join('');
      const lamps = [220, 560, 1040, 1380].map((x) => `<rect x="${x - 26}" y="54" width="52" height="40" rx="10" fill="#3b3350"/><circle cx="${x}" cy="94" r="16" fill="#fff3b0"/>`).join('');
      const stars = [[150, 330], [1450, 300], [300, 520], [1300, 540], [800, 110]]
        .map(([x, y]) => `<path d="M${x} ${y - 26}l8 18 20 3-15 13 4 20-17-10-17 10 4-20-15-13 20-3z" fill="#ffd23f" opacity=".85"/>`)
        .join('');
      body = `<rect width="1600" height="900" fill="#3a2d6b"/><rect y="0" width="1600" height="420" fill="#4b3a8c"/>
        <rect x="0" y="40" width="1600" height="26" fill="#2a2240"/>${lamps}${beams}
        <rect x="120" y="170" width="300" height="200" rx="18" fill="#6d5dfc" stroke="#b8b0ff" stroke-width="8"/><rect x="1180" y="170" width="300" height="200" rx="18" fill="#ff8a3d" stroke="#ffd0ad" stroke-width="8"/>
        <rect x="520" y="140" width="560" height="130" rx="30" fill="#ff8a3d" stroke="#fff" stroke-width="10"/>
        <text x="800" y="228" text-anchor="middle" font-size="74" font-weight="900" fill="#fff" font-family="system-ui,sans-serif">인생 방송국</text>
        <rect x="730" y="92" width="140" height="36" rx="18" fill="#ff4d4d"/><circle cx="752" cy="110" r="7" fill="#fff"/><text x="766" y="118" font-size="22" font-weight="900" fill="#fff" font-family="system-ui,sans-serif">ON AIR</text>
        ${stars}
        <ellipse cx="800" cy="860" rx="760" ry="170" fill="#ffb36b"/><ellipse cx="800" cy="840" rx="640" ry="120" fill="#ffd2a3"/>
        <ellipse cx="800" cy="830" rx="420" ry="60" fill="#fff0de" opacity=".7"/>`;
      break;
    }
    case 'shop': {
      // 동네 마트 (Stage 7 shop prompt / purchases)
      const shelf = (y, colors) => `<rect x="80" y="${y}" width="1440" height="16" fill="#b7793f"/>${colors.map((c, i) => `<rect x="${110 + i * 118}" y="${y - 78}" width="84" height="78" rx="10" fill="${c}"/>`).join('')}`;
      body = `<rect width="1600" height="900" fill="#fff5e6"/><rect y="0" width="1600" height="120" fill="#ff8a3d"/>${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<path d="M${i * 200} 120 q100 70 200 0" fill="${i % 2 ? '#fff' : '#ffd2a3'}"/>`).join('')}
        <text x="800" y="84" text-anchor="middle" font-size="64" font-weight="900" fill="#fff" font-family="system-ui,sans-serif">인생 마트</text>
        ${shelf(330, ['#f87171', '#fbbf24', '#34d399', '#60a5fa', '#a78bfa', '#f472b6', '#f87171', '#fbbf24', '#34d399', '#60a5fa', '#a78bfa', '#f472b6'])}
        ${shelf(500, ['#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#f87171', '#a78bfa', '#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#f87171', '#a78bfa'])}
        <rect y="640" width="1600" height="260" fill="#e9d8c0"/>${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<rect x="${i * 200}" y="640" width="100" height="260" fill="#dfc9ab"/>`).join('')}`;
      break;
    }
    case 'holiday': {
      // 명절 상차림 거실: 병풍 + 상 + 전등
      const panels = [0, 1, 2, 3, 4, 5].map((i) => `<rect x="${260 + i * 180}" y="150" width="170" height="420" fill="${i % 2 ? '#f7e3c0' : '#fbecd2'}" stroke="#a0522d" stroke-width="8"/><circle cx="${345 + i * 180}" cy="300" r="46" fill="${['#e53935', '#fb8c00', '#43a047', '#1e88e5', '#8e24aa', '#e53935'][i]}" opacity=".55"/>`).join('');
      body = `<rect width="1600" height="900" fill="#f3d9b1"/><rect y="600" width="1600" height="300" fill="#c98b4f"/>${panels}
        <rect x="360" y="610" width="880" height="60" rx="12" fill="#7b3f1d"/><rect x="400" y="670" width="40" height="140" fill="#5d2e14"/><rect x="1160" y="670" width="40" height="140" fill="#5d2e14"/>
        ${[0, 1, 2, 3, 4].map((i) => `<ellipse cx="${470 + i * 165}" cy="600" rx="62" ry="22" fill="#fff"/><ellipse cx="${470 + i * 165}" cy="585" rx="44" ry="24" fill="${['#ffb74d', '#e57373', '#aed581', '#fff176', '#f48fb1'][i]}"/>`).join('')}
        <path d="M150 0 v90 M1450 0 v90" stroke="#8d6e63" stroke-width="6"/><ellipse cx="150" cy="120" rx="46" ry="34" fill="#e53935"/><ellipse cx="1450" cy="120" rx="46" ry="34" fill="#e53935"/>`;
      break;
    }
    default:
      body = submapSceneBody(scene) ?? `<g fill="#fff" opacity=".7"><ellipse cx="300" cy="180" rx="140" ry="44"/><ellipse cx="1200" cy="140" rx="120" ry="38"/></g><rect y="700" width="1600" height="200" fill="#8ccf7e"/>`;
  }
  return `<svg class="ci-bg-svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${base}${body}</svg>`;
}

/**
 * @param {HTMLElement} root  where the overlay is mounted (document.body)
 * @param {{ getMeta: () => object, assets?: {findAsset, assetUrl}, audio?: object, reducedMotion?: () => boolean,
 *           now?: () => number }} deps  `now` = server clock estimate for `deadlineAt` countdowns
 */
export function createCutin(root, { getMeta = () => ({}), assets = {}, audio = null, reducedMotion, now = () => Date.now() } = {}) {
  const findAsset = assets.findAsset ?? (() => null);
  const isReduced = reducedMotion ?? (() => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const q = [];
  let cur = null; // { spec, resolve, el, timers[] }
  const idle = new Set();
  const pres = () => getMeta()?.presentation ?? {};
  /** Stage 7 art: card / item illustrations and job badges (`{kind:'icon', job}`) when accepted, else null. */
  const artFor = (kind, id) => {
    if (!id) return null;
    try {
      return (kind === 'job' ? findAsset({ kind: 'icon', job: id }) : findAsset({ kind, [kind]: id }))?.url ?? null;
    } catch {
      return null;
    }
  };

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
        <div class="ci-extra" data-ci="extra"></div>
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
    if (a.type === 'newsFlash') return newsSpec(g, { characters });
    if (a.type === 'lottoDraw') return lottoSpec(g, { characters });
    if (a.type === 'houseValueChanged') return marketSpec(g, { characters });
    const look = STAGE6_LOOK[a.type] ?? stage7Look(a) ?? stage8Look(a) ?? stage9Look(a) ?? null;
    const meta = getMeta();
    const main = characters.find((c) => c.id === g.charId) ?? null;
    const name = main?.name ?? '';
    const chips = [];
    // Stage 6: pay day replaces its own money chip; stat changes get coloured chips
    const salary = g.salary ?? [];
    const salaryHidden = new Set();
    for (const s of salary) {
      const i = g.money.findIndex((m, k) => !salaryHidden.has(k) && m.charId === s.charId && (m.reason === 'salary' || m.delta === s.amount));
      if (i >= 0) salaryHidden.add(i);
      const who = s.charId !== g.charId ? `${nameOf(characters, s.charId)} ` : '';
      const c = salaryChip(s, won);
      chips.push({ ...c, text: who ? c.text.replace('월급', `${who}월급`) : c.text });
    }
    // Stage 8: 축의금 / 돌잔치 축하금 transfers are listed per guest (💌 chips) instead of one money chip per side
    const giftReasons = Array.isArray(a.gifts) && (a.type === 'married' || a.type === 'childGrew') ? new Set(['weddingGift', 'dolGift']) : null;
    // a 입학 follow-up chip names the child and the 학원비 → its own money chip is dropped
    const schoolChip = (g.family ?? []).some((f) => f.type === 'childGrew' && f.kind === 'school' && Number(f.amount));
    g.money.forEach((m, k) => {
      if (salaryHidden.has(k)) return;
      if (giftReasons?.has(m.reason)) return;
      if (schoolChip && m.reason === 'school') return;
      const who = m.charId !== g.charId ? `${nameOf(characters, m.charId)} ` : '';
      chips.push({ text: `${REASON_ICON[m.reason] ?? '💰'} ${who}${m.delta > 0 ? '+' : ''}${won(m.delta)}`, kind: m.delta > 0 ? 'plus' : 'minus' });
    });
    for (const st of g.stats ?? []) {
      const c = statChip(st);
      const who = st.charId && st.charId !== g.charId ? `${nameOf(characters, st.charId)} ` : '';
      chips.push({ ...c, text: who ? `${who}${c.text}` : c.text });
    }
    for (const id of g.discharged ?? []) chips.push({ text: `🎖️ ${id !== g.charId ? `${nameOf(characters, id)} ` : ''}전역!`, kind: 'plus' });
    // Stage 7: cards gained / used, gifts, a purchase without its own money chip
    for (const cd of g.cards ?? []) {
      if (a.type === 'gift' && cd.type === 'cardGained' && cd.source === 'gift') continue; // the 🎁 chip names the card
      const info = cardInfo(cd.cardId, meta);
      const who = cd.charId && cd.charId !== g.charId ? `${nameOf(characters, cd.charId)} ` : '';
      chips.push(cd.type === 'cardGained' ? { text: `🃏 ${who}${info.name} 카드 +1`, kind: `card k-${info.kind}` } : { text: `${info.icon} ${who}${info.name} 사용`, kind: `card k-${info.kind}` });
    }
    for (const gf of g.gifts ?? []) chips.push({ text: `🎁 ${nameOf(characters, gf.fromId)} → ${nameOf(characters, gf.toId)} ${giftWhat(gf, meta)}`, kind: 'plus' });
    if (a.type === 'gift') chips.unshift({ text: `🎁 ${giftWhat(a, meta)}`, kind: 'plus' });
    if (a.type === 'cardGained') {
      const info = cardInfo(a.cardId, meta);
      chips.unshift({ text: `🃏 ${info.name} 카드 +1`, kind: `card k-${info.kind}` });
    }
    if (a.type === 'itemBought' && Number(a.price) > 0 && !g.money.some((m) => m.charId === a.charId && m.delta < 0)) chips.push({ text: `🛍️ -${won(Number(a.price))}`, kind: 'minus' });
    if (a.type === 'cardUsed' && isCardAnchor(a) && a.targetId) {
      const info = cardInfo(a.cardId, meta);
      chips.unshift({ text: `💢 ${nameOf(characters, a.targetId)} ← ${info.icon} ${info.name}`, kind: 'minus' });
    }
    if (a.type === 'cardBlocked') chips.unshift({ text: `🛡️ ${nameOf(characters, a.targetId)} 방어 성공`, kind: 'plus' });
    if (a.type === 'holidayStarted') chips.push({ text: '🧧 세배 룰렛', kind: '' }, { text: '🗣️ 잔소리 룰렛', kind: '' }, { text: '🎴 고스톱 한 판', kind: '' });
    if (a.type === 'finished') chips.unshift({ text: `🏁 ${a.place}등 골인`, kind: 'plus' });
    const fam = stage8Extras(g, { characters, chips, meta });
    const s9 = stage9Extras(g, { chips, meta });
    const badge = jobBadgeFor(a) ?? stage7Badge(a, meta) ?? stage8Badge(a, g, { characters, meta }) ?? s9.badge;
    if (a.type === 'educationChanged' && educationLabel(a.education)) chips.unshift({ text: `🎓 ${educationLabel(a.education)}`, kind: 'plus' });
    if (a.type === 'militaryStart' && a.turns) chips.unshift({ text: `🪖 복무 ${a.turns}턴`, kind: '' });
    if (a.type === 'injured' && a.turns) chips.unshift({ text: `🤕 ${a.turns}턴 부상`, kind: 'minus' });
    const castIds = a.type === 'holidayResult'
      ? []
      : a.type === 'holidayStarted' && !g.involved.length
        ? characters.slice(0, 3).map((c) => c.id)
        : a.type === 'married' || a.type === 'childBorn' || a.type === 'childGrew' || a.type === 'dated' || a.type === 'met' || a.type === 'proposed'
          ? [g.charId].filter(Boolean) // the partner / spouse / child joins below (wedding guests: the chips)
          : a.type === 'schoolMeet'
            ? fam.pairCast.map((x) => x.char.id)
            : g.involved;
    const cast = castIds
      .map((id) => characters.find((c) => c.id === id))
      .filter(Boolean)
      .map((c, i) => {
        const isMain = c.id === g.charId;
        const isTarget = !isMain && !!look?.targetPose && c.id === g.targetId;
        const delta = g.money.filter((m) => m.charId === c.id).reduce((s, m) => s + m.delta, 0);
        let pose = isMain ? (look?.pose ?? poseFor(a, { delta })) : isTarget ? look.targetPose : delta > 0 ? 'jump' : delta < 0 ? 'idle' : 'wave';
        let emotion = isMain
          ? a.emotion && a.emotion !== 'neutral' && !look?.targetPose ? a.emotion : look?.emotion ?? a.emotion
          : isTarget ? look.targetEmotion : delta > 0 ? 'joy' : delta < 0 ? 'love' : null;
        if (a.type === 'gameOver') {
          pose = i === 0 ? 'cheer' : 'wave';
          emotion = i === 0 ? 'joy' : null;
        }
        if (a.type === 'holidayStarted') {
          pose = 'wave';
          emotion = 'joy';
        }
        if (a.type === 'schoolMeet') {
          pose = 'wave';
          emotion = 'shy';
        }
        return { char: c, pose, emotion: emotion === 'neutral' ? null : emotion, glyph: isMain ? look?.glyph ?? null : isTarget ? look.targetGlyph ?? null : null };
      });
    // Stage 8: partner / spouse / child next to the character (schoolMeet: each character with their match)
    if (a.type === 'schoolMeet') {
      const out = [];
      for (const m of cast) {
        out.push(m);
        const pc = fam.pairCast.find((x) => x.char.id === m.char.id);
        if (pc?.npc) out.push({ char: pc.npc, role: 'partner', scale: 1, pose: 'wave', emotion: 'shy', glyph: null });
      }
      cast.splice(0, cast.length, ...out.slice(0, 4));
    } else if (fam.cast.length) {
      if (cast[0] && look?.glyph && fam.cast.some((m) => m.glyph === look.glyph)) cast[0].glyph = null; // one 💍 is enough
      cast.push(...fam.cast);
    }
    const ownerChar = characters.find((c) => c.id === g.charId);
    const scene = a.scene && a.scene !== 'none' ? a.scene : look?.scene ?? a.scene ?? 'none';
    const holiday = a.type === 'holidayResult' ? { kind: a.kind ?? null, rows: holidayRows(a, { characters, won }) } : null;
    const mineInvolved = characters.some((c) => c.isMe && (c.id === g.charId || c.id === g.targetId || holiday?.rows.some((r) => r.charId === c.id)));
    let autoMs = autoAdvanceMs({ owner: !!ownerChar?.isMe || mineInvolved, reduced: isReduced() });
    if (holiday) autoMs = Math.max(autoMs, 5200 + holiday.rows.length * 450);
    if (s9.race) autoMs = Math.max(autoMs, s9.race.durationMs + 2600);
    if (s9.treasure) autoMs = Math.max(autoMs, 4600);
    const texts = g.texts.length ? g.texts.slice(0, 3) : [fallbackText(a, name)];
    // sabotage: the victim's reaction line (server `targetLine`, pool `sabotaged`)
    if (a.type === 'cardUsed' && a.targetId && a.targetLine) texts.splice(2, texts.length, `${nameOf(characters, a.targetId)}: “${a.targetLine}”`);
    if (holiday) {
      chips.length = 0; // the result table carries 세뱃돈 / 잔소리 / 고스톱 per character
      if (Number(a.pot) > 0) chips.push({ text: `🎴 판돈 ${won(Number(a.pot))}`, kind: 'plus' });
      const win = holiday.rows.filter((r) => r.winner);
      const played = holiday.rows.some((r) => r.card != null);
      texts.splice(0, texts.length, win.length ? `🎴 고스톱 승자: ${win.map((r) => r.name).join(', ')}! ${win.map((r) => r.winText).filter(Boolean).join(' ')}` : played ? '🎴 고스톱은 무승부!' : '🎴 이번 명절 고스톱은 쉬어 갔어요');
    }
    return {
      key: `${a.type}:${a.charId ?? ''}:${a.tileId ?? a.era ?? a.eraId ?? a.route ?? a.promptId ?? a.jobId ?? a.cardId ?? a.itemId ?? a.tradeId ?? ''}`,
      tone: look && (!a.tone || a.tone === 'neutral') ? look.tone : a.tone ?? 'neutral',
      scene,
      tag: tagLabel(a, { tones: pres().tones, tileTypes: getMeta()?.board?.tileTypes, routes: getMeta()?.board?.routes }),
      who: name ? `${name}${sceneLabel(scene) ? ` · ${sceneLabel(scene)}` : ''}` : sceneLabel(scene),
      text: texts,
      line: holiday ? null : a.line ?? null, // 명절 정산: nobody on stage (the 화투 row fills the window)
      speaker: g.charId ?? cast[0]?.char.id ?? null,
      chips,
      cast,
      badge,
      fx: look?.fx === 'gold' ? 'gold' : null,
      sfx: look?.sfx ?? null,
      bigWin: isBigWin(a, g.delta) || !!look?.bigWin,
      currentId: g.charId,
      era: a.type === 'eraChanged' ? `${a.eraName ?? ''} 시대` : '', // board state may already be ahead → no turn/era spoilers
      autoMs,
      holiday, // Stage 7: 고스톱 flip row + result table
      house: fam.house, // Stage 8: 🏠 illustration panel (houseBought)
      dol: fam.dol, // 돌잡이 table
      pairs: fam.pairs, // 고교 첫 만남: every pair in the box
      gifts: fam.gifts, // 💌 축의금 list
      fx8: look?.fx && ['wedding', 'hearts', 'heartbreak'].includes(look.fx) ? look.fx : null,
      fx9: look?.fx9 ?? null, // Stage 9: race / wish / wishfail / lotto
      race: s9.race, // 경마: deterministic race panel
      treasure: s9.treasure, // 보물: chest → item
      lottoNums: s9.lottoNums,
      ticket: s9.ticket, // 인생역전 로또 긁기

      submap: a.type === 'submapResult' ? submapOf(a) : null,
      characters,
      mc: g.mc ?? null, // Stage 5.6: small MC corner lines
    };
  }

  /** Stage 6: job badge in the window for job / rank-up / hidden-job cut-ins ({icon, title, stars, sub}). */
  function jobBadgeFor(a) {
    if (!['jobChanged', 'rankUp', 'hiddenJobUnlocked'].includes(a?.type) || !a.jobId) return null;
    const info = jobInfo(a.jobId, getMeta()?.jobs);
    const rank = Number(a.rank) || 1;
    const max = Math.max(info?.maxRank ?? 1, rank);
    const title = info?.name ?? a.jobName ?? a.jobId;
    const rn = a.rankName ?? rankName(info, rank);
    const img = artFor('job', a.jobId);
    if (a.type === 'hiddenJobUnlocked') return { icon: info?.icon ?? '🌟', img, title, stars: '', sub: '숨은 직업 해금!', kind: 'hiddenjob' };
    return { icon: info?.icon ?? '💼', img, title, stars: info?.partTime && max <= 1 ? '' : rankStars(rank, max), sub: rn, kind: a.type === 'rankUp' ? 'rankup' : 'job' };
  }

  /** Stage 7: card art badge (sabotage / 공약 / block / card gained) or item badge (purchase). */
  function stage7Badge(a, meta) {
    if ((a?.type === 'cardUsed' && isCardAnchor(a)) || a?.type === 'cardBlocked' || a?.type === 'cardGained') {
      const info = cardInfo(a.cardId, meta);
      if (!info) return null;
      const sub = a.type === 'cardBlocked' ? '🛡️ 변호사가 막았다!' : `${CARD_KINDS[info.kind]?.label ?? ''} 카드${a.type === 'cardGained' ? ' 획득' : ''}`;
      return { icon: info.icon, img: artFor('card', a.cardId), title: info.name, stars: '', sub, kind: `card k-${info.kind}${a.type === 'cardBlocked' ? ' blocked' : ''}` };
    }
    if (a?.type === 'itemBought') {
      const info = itemInfo(a.itemId, meta);
      return { icon: info.icon, img: artFor('item', a.itemId), title: info.name, stars: '', sub: info.desc || '새 아이템!', kind: 'item' };
    }
    return null;
  }

  /**
   * Stage 8 chips / panels of a group (mutates `chips`): 💌 축의금 per guest + total, 👶 birth, 🎂 / 📝 / 💼 child events,
   * 🏠 purchase (price, 🔁 보상판매, 🎫 청약), 용돈 / 보상판매 / 입학 follow-ups, 💑 맞벌이 on pay day. → {cast, house, dol, pairs,
   * pairCast, gifts}
   */
  function stage8Extras(g, { characters, chips, meta }) {
    const a = g.anchor;
    const out = { cast: [], house: null, dol: null, pairs: null, pairCast: [], gifts: null };
    const who = (id) => (id && id !== g.charId ? `${nameOf(characters, id)} ` : '');
    const main = characters.find((c) => c.id === g.charId) ?? null;
    const kidName = (charId, childId) => (characters.find((c) => c.id === charId)?.children ?? []).find((k) => k.id === childId)?.name ?? '';
    try {
      out.cast = familyCast(g, characters, { avatars: meta?.avatars });
    } catch {
      out.cast = [];
    }
    switch (a.type) {
      case 'married': {
        const gifts = weddingGifts(a, characters);
        out.gifts = gifts;
        const sp = partnerInfo(a.spouse ?? main?.spouse, meta);
        if (sp) chips.unshift({ text: `💍 ${sp.name} ${sp.traitIcon}${sp.starsText ? ` ${sp.starsText}` : ''}`, kind: 'plus love' });
        for (const r of gifts.rows) chips.push({ text: `💌 ${r.name} 축의금 +${won(r.amount)}`, kind: 'plus' });
        if (!gifts.rows.length) chips.push({ text: '💌 축의금은 마음만…', kind: '' });
        if (gifts.total > 0 && gifts.rows.length > 1) chips.push({ text: `💒 축의금 합계 +${won(gifts.total)}`, kind: 'plus' });
        break;
      }
      case 'childBorn': {
        const k = childInfo(a.child, meta);
        if (k) chips.unshift({ text: `👶 ${k.name}${k.genius ? ' 🌟 천재' : ''}${k.traitName ? ` · ${k.traitIcon} ${k.traitName}` : ''}`, kind: 'plus love' });
        break;
      }
      case 'childGrew': {
        const info = CHILD_GROW[a.kind];
        const name = kidName(g.charId, a.childId);
        if (info) chips.unshift({ text: `${info.icon} ${name ? `${name} ` : ''}${info.label}`, kind: '' });
        if (a.kind === 'exam' && a.result) chips.push({ text: { elite: '🎓 명문대 합격!', college: '🎓 대학 합격', fail: '📖 다음 기회에' }[a.result] ?? '📝 수능', kind: a.result === 'fail' ? '' : 'plus' });
        if (a.kind === 'dol') {
          out.dol = true;
          const gifts = weddingGifts(a, characters);
          out.gifts = gifts;
          for (const r of gifts.rows) chips.push({ text: `💌 ${r.name} 축하금 +${won(r.amount)}`, kind: 'plus' });
        } else if (a.kind === 'job' && Number(a.amount) > 0) chips.push({ text: `💌 앞으로 용돈 +${won(Number(a.amount))}`, kind: 'plus' });
        else if (Number(a.amount) && !g.money.some((m) => m.charId === g.charId)) chips.push({ text: `${info?.icon ?? '💰'} ${Number(a.amount) > 0 ? '+' : ''}${won(Number(a.amount))}`, kind: Number(a.amount) > 0 ? 'plus' : 'minus' });
        break;
      }
      case 'houseBought': {
        const h = houseInfo(a.houseId, meta);
        const discount = Number(a.discount) || (a.subscription && Number(a.basePrice) > Number(a.price) ? Number(a.basePrice) - Number(a.price) : 0);
        out.house = { id: a.houseId, name: h?.name ?? a.houseId, icon: h?.icon ?? '🏠', price: Number(a.price) || null, value: Number(a.value) || null, tradeIn: Number(a.tradeIn) || 0, discount, lucky: !!a.lucky, art: artFor('house', a.houseId) };
        if (Number(a.price) > 0 && !g.money.some((m) => m.charId === a.charId && m.delta < 0)) chips.push({ text: `🏠 -${won(Number(a.price))}`, kind: 'minus' });
        // the houseSold follow-up names the old house → its chip replaces this one
        if (Number(a.tradeIn) > 0 && !(g.family ?? []).some((f) => f.type === 'houseSold' && f.charId === a.charId)) chips.push({ text: `🔁 보상판매 +${won(Number(a.tradeIn))}`, kind: 'plus' });
        if (discount > 0) chips.push({ text: `🎫 청약 당첨 -${won(discount)}`, kind: 'plus' });
        if (a.lucky) chips.push({ text: `✨ 골드 매물${Number(a.value) > Number(a.price) ? ` (자산가치 ${won(Number(a.value))})` : ''}`, kind: 'plus' });
        break;
      }
      case 'schoolMeet': {
        const pairs = schoolMeetPairs(a, characters, meta);
        out.pairs = pairs;
        // the window: my pair first, then the others (2 pairs = 4 figures at most)
        const mine = pairs.filter((p) => p.char.isMe);
        out.pairCast = [...mine, ...pairs.filter((p) => !p.char.isMe)].slice(0, 2);
        break;
      }
      case 'met': {
        const pi = partnerInfo(a.partner ?? main?.love?.partner, meta);
        if (pi) chips.unshift({ text: `💘 ${pi.name} · ${pi.traitIcon} ${pi.traitName}${pi.starsText ? ` ${pi.starsText}` : ''}`, kind: 'plus love' });
        if (a.match) chips.push({ text: '💞 찰떡궁합!', kind: 'plus love' });
        if (Number(a.affection) > 0) chips.push({ text: `❤️ 호감도 ${Number(a.affection)}`, kind: 'love' });
        break;
      }
      case 'dated': {
        const gain = Number(a.gain);
        if (gain > 0) chips.push({ text: `❤️ 호감도 +${gain}${Number(a.affection) > 0 ? ` (${Number(a.affection)})` : ''}`, kind: 'plus love' });
        if (a.match) chips.push({ text: '🎯 취향 저격!', kind: 'plus love' });
        break;
      }
      case 'proposed':
        chips.unshift(a.success ? { text: '💍 프러포즈 성공!', kind: 'plus love' } : { text: '💔 거절…', kind: 'minus' });
        break;
      default:
        break;
    }
    // follow-ups: 용돈 / 집 보상판매 / 입학 (학원비)
    for (const f of g.family ?? []) {
      if (f.type === 'allowance') chips.push({ text: `💌 ${who(f.charId)}${kidName(f.charId, f.childId) || '자녀'} 용돈 +${won(Number(f.amount) || 0)}`, kind: 'plus' });
      else if (f.type === 'houseSold') chips.push({ text: `🔁 ${who(f.charId)}${houseInfo(f.houseId, meta)?.name ?? '집'} 보상판매${Number(f.amount) ? ` +${won(Number(f.amount))}` : ''}`, kind: 'plus' });
      else if (f.type === 'childGrew') {
        const info = CHILD_GROW[f.kind];
        chips.push({ text: `${info?.icon ?? '🧒'} ${who(f.charId)}${kidName(f.charId, f.childId)} ${info?.label ?? '성장'}${Number(f.amount) ? ` ${Number(f.amount) > 0 ? '+' : ''}${won(Number(f.amount))}` : ''}`, kind: Number(f.amount) < 0 ? 'minus' : '' });
      }
    }
    // 💑 맞벌이: the spouse's share of a pay day
    for (const s of g.salary ?? []) if (Number(s.spouseAmount) > 0) chips.push({ text: `💑 ${who(s.charId)}맞벌이 +${won(Number(s.spouseAmount))}`, kind: 'salary' });
    return out;
  }

  /** Stage 8 badges: 💘 the new partner (trait · ★), 👶 the baby. */
  function stage8Badge(a, g, { characters, meta }) {
    if (a?.type === 'met') {
      const c = characters.find((x) => x.id === g.charId);
      const pi = partnerInfo(a.partner ?? c?.love?.partner, meta);
      if (pi) return { icon: pi.traitIcon, img: null, title: pi.name, stars: pi.starsText, sub: pi.traitName, kind: 'partner' };
    }
    if (a?.type === 'childBorn') {
      const k = childInfo(a.child, meta);
      if (k) return { icon: '👶', img: null, title: k.name, stars: '', sub: `${k.genius ? '🌟 천재 · ' : ''}${k.traitName || '건강하게 태어났어요'}`, kind: `baby${k.genius ? ' genius' : ''}` };
    }
    return null;
  }

  /**
   * Stage 9 chips / panels (mutates `chips`): the submap outcome (💰 amount when no money follow-up names it, 🎟️ odds,
   * stat), the treasure badge + chest panel. → {badge, race, treasure, lottoNums}
   */
  function stage9Extras(g, { chips, meta }) {
    const a = g.anchor;
    const out = { badge: null, race: null, treasure: null, lottoNums: null, ticket: null };
    if (a.type === 'treasureFound') {
      const info = treasureInfo(a.treasureId ?? a.id, meta);
      const art = artFor('treasure', info.id);
      out.treasure = { id: info.id, name: info.name, icon: info.icon, art };
      out.badge = { icon: info.icon, img: art, title: info.name, stars: '', sub: '💎 감정은 게임이 끝나면!', kind: 'treasure' };
      chips.unshift({ text: `💎 ${info.name} 획득`, kind: 'plus' });
      return out;
    }
    if (a.type !== 'submapResult') return out;
    const opt = parseOptionId(a.optionId);
    const ok = submapSuccess(a);
    if (opt.kind === 'horse') {
      out.race = racePlan(a);
      chips.unshift({ text: `🐎 ×${out.race.chosen ?? '?'} ${ok ? '적중!' : '꽝'}`, kind: ok ? 'plus' : 'minus' });
    }
    if (opt.kind === 'lotto' && Array.isArray(a.numbers)) out.lottoNums = a.numbers.slice(0, 6);
    if (opt.kind === 'lotto') out.ticket = { rank: a.rank ?? null, prize: Number(a.prize) || 0, win: ok === true, jackpot: String(a.result) === 'jackpot' || a.rank === 'jackpot' };
    if (opt.kind === 'wish') chips.unshift(ok === false ? { text: '🙏 소원… 다음 기회에', kind: '' } : { text: '✨ 소원 성취!', kind: 'plus' });
    const amt = Number(a.amount);
    if (amt && !g.money.some((m) => m.charId === g.charId)) chips.push({ text: `${amt > 0 ? '💰 +' : '💸 '}${won(amt)}`, kind: amt > 0 ? 'plus' : 'minus' });
    if (a.stat && !(g.stats ?? []).some((st) => st.charId === g.charId && st.stat === a.stat)) {
      const c = statChip({ stat: a.stat, delta: Number(a.delta ?? a.gain) || 1 });
      chips.push(c);
    }
    return out;
  }

  /**
   * Stage 8: 부동산 시세 → studio cut-in (MCs when the group has lines) with the market chart and every owner's new value.
   */
  function marketSpec(g, { characters = [] } = {}) {
    const a = g.anchor;
    const mk = marketInfo(a) ?? { mult: 1, pct: 0, dir: 'flat', text: '' };
    const meta = getMeta();
    const up = mk.mult >= 1;
    // owners at the time of the event (`changes`), else the current state
    const owners = Array.isArray(a.changes)
      ? a.changes.map((x) => ({ char: characters.find((c) => c.id === x.charId), house: houseInfo(x.houseId, meta), value: Number(x.after) || 0 })).filter((o) => o.char)
      : characters.filter((c) => c.house?.id).map((c) => ({ char: c, house: houseInfo(c.house.id, meta), value: Number(c.house.value) || 0 }));
    const text = [fallbackText(a), owners.length ? `집주인 ${owners.length}명의 자산가치가 ${up ? '올랐어요' : '내렸어요'}!` : '아직 집을 가진 사람이 없어요.'];
    const lines = g.studio?.length ? g.studio : g.mc?.length ? g.mc : null;
    const base = {
      key: `market:${a.eraId ?? ''}:${mk.mult}`,
      tone: up ? 'treasure' : 'bad',
      scene: 'studio',
      tag: tagLabel(a, { tones: pres().tones }),
      who: '🏠 부동산 시세 속보',
      text,
      line: null,
      speaker: null,
      chips: [
        { text: mk.text, kind: up ? 'plus' : 'minus' },
        ...(Array.isArray(a.changes) ? a.changes : []).map((x) => ({
          text: `${houseInfo(x.houseId, meta)?.icon ?? '🏠'} ${nameOf(characters, x.charId)} ${won(Number(x.before) || 0)} → ${won(Number(x.after) || 0)}`,
          kind: Number(x.after) >= Number(x.before) ? 'plus' : 'minus',
        })),
      ],
      cast: [],
      bigWin: false,
      currentId: null,
      era: '',
      characters,
      market: { mult: mk.mult, dir: mk.dir },
      sfx: up ? 'fanfare' : 'thud',
    };
    if (lines) {
      const spec = studioSpec(lines, { key: base.key, tone: base.tone, title: base.tag, characters });
      return { ...spec, ...base, kind: 'mc', mcScript: lines, text: [], marketText: text, autoMs: Math.max(spec.autoMs, 5200) };
    }
    return { ...base, kind: 'market', autoMs: autoAdvanceMs({ owner: owners.some((o) => o.char.isMe), reduced: isReduced() }) + 1200 };
  }

  /** 🎁 what a gift / trade side carries ("50만원" / "택시 카드"). */
  function giftWhat(x, meta) {
    if (Number(x?.money) > 0) return won(Number(x.money));
    if (x?.cardId) return `${cardInfo(x.cardId, meta).name} 카드`;
    return '';
  }

  /**
   * Stage 7: 전국 로또 → studio cut-in (MCs when they have lines) with the ball draw on the screen and the entries in
   * the dialogue box. `g.studio` / `g.mc` = 봄이·호야 lines (`lotto`).
   */
  function lottoSpec(g, { characters = [] } = {}) {
    const a = g.anchor;
    const lotto = lottoRows(a, { characters, won });
    const lines = g.studio?.length ? g.studio : g.mc?.length ? g.mc : null;
    const best = lotto.rows[0];
    const text = !lotto.rows.length ? ['로또 카드를 가진 사람이 없어 추첨만 했어요.'] : best?.prize > 0 ? [`🎉 ${best.name} ${best.matches}개 일치! ${won(best.prize)} 당첨!`] : ['아쉽게도 이번 회차 당첨자는 없어요…'];
    const mine = lotto.rows.some((r) => r.char?.isMe);
    const drawMs = 900 + lotto.numbers.length * 900;
    const base = {
      key: `lotto:${a.eraId ?? ''}:${lotto.numbers.join('-')}`,
      tone: 'treasure',
      scene: 'studio',
      tag: tagLabel(a, { tones: pres().tones }),
      who: '🎱 전국 로또 추첨',
      text,
      line: null,
      speaker: null,
      chips: lotto.rows.filter((r) => r.prize > 0).map((r) => ({ text: `🎱 ${r.name} +${won(r.prize)}`, kind: 'plus' })),
      cast: [],
      bigWin: false,
      currentId: null,
      era: '',
      characters,
      lotto,
      sfx: 'fanfare',
    };
    if (lines) {
      const spec = studioSpec(lines, { key: base.key, tone: 'treasure', title: base.tag, characters });
      return { ...spec, ...base, kind: 'mc', mcScript: lines, text: [], lottoText: text, autoMs: Math.max(spec.autoMs, drawMs + 3500) + (mine ? 1500 : 0) };
    }
    return { ...base, kind: 'lotto', autoMs: drawMs + (mine ? 6000 : 4200) };
  }

  /** Stage 6: a news flash on its own (no MC studio in the batch / MCs off) → 📰 속보 cut-in in the studio. */
  function newsSpec(g, { characters = [] } = {}) {
    const a = g.anchor;
    const news = g.news ?? { title: a.title, text: a.text, tone: a.tone };
    return {
      key: `news:${a.eraId ?? ''}:${a.newsId ?? ''}`,
      kind: 'news',
      tone: news.tone && news.tone !== 'neutral' ? news.tone : 'neutral',
      scene: 'studio',
      tag: '📰 뉴스 속보',
      who: '📰 인생 뉴스',
      text: [news.title, news.text].filter(Boolean),
      line: null,
      speaker: null,
      chips: [],
      cast: [],
      news,
      bigWin: false,
      currentId: null,
      era: '',
      autoMs: autoAdvanceMs({ owner: false, reduced: isReduced() }) + 1500,
      characters,
      mc: g.mc ?? null,
    };
  }

  /**
   * Studio MC cut-in (Stage 5.6): 호야 & 봄이 center stage on the TV-studio background, dialogue in the box.
   * @param {object[]} lines  [{speaker, line, expression, pose}]
   */
  function studioSpec(lines, { key = 'mc', tone = 'good', title = '', era = '', characters = [], currentId = null, news = null } = {}) {
    return {
      key: `mc:${key}`,
      kind: 'mc',
      tone,
      scene: 'studio',
      tag: title || '🎙️ 인생 방송국',
      who: '🎙️ 인생 방송국 · 호야 & 봄이',
      text: [],
      line: null,
      speaker: null,
      chips: [],
      cast: [],
      bigWin: false,
      currentId,
      era,
      autoMs: mcScriptMs(lines, { delay: 350, gap: 1500, hold: 1600 }) + 400,
      characters,
      mcScript: lines,
      news, // Stage 6: the era's news flash (headline strip on the studio screen)
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

  /**
   * Background: the scene's generated bg, else (Stage 7) the `sceneFallbacks` chain's first generated bg
   * (shop → office, holiday → wedding-hall, …), else the SVG scene.
   */
  function renderBg(scene, tone) {
    const r = resolveSceneBg(scene, {
      presentation: pres(),
      assetUrl: (id) => assets.assetUrl?.(id) ?? null,
      findBg: (sc) => findAsset({ kind: 'bg', scene: sc })?.url ?? null,
    });
    $.bg.dataset.scene = scene ?? 'none';
    $.bg.dataset.bgScene = r.url ? r.scene : r.svgScene;
    $.bg.innerHTML = r.url ? `<img class="ci-bg-img" src="${esc(r.url)}" alt="" decoding="async">` : sceneSvg(r.svgScene, tone);
    $.win.classList.toggle('generated', !!r.url);
  }

  function renderCast(spec) {
    $.cast.innerHTML = '';
    $.fx.innerHTML = '';
    // Stage 8: family members (partner / spouse / children) may add figures; the characters alone stay ≤ 3
    const list = spec.cast.some((m) => m.role) ? spec.cast.slice(0, MAX_CAST) : spec.cast.slice(0, 3);
    const n = list.length;
    const xs = slotPositions(list.map((m) => m.scale ?? 1));
    const els = [];
    list.forEach((m, i) => {
      const slot = document.createElement('div');
      slot.className = `ci-slot${m.role ? ` fam ${m.role}` : ''}${m.stage ? ` st-${m.stage}` : ''}${m.genius ? ' genius' : ''}`;
      slot.style.left = `${xs[i]}%`;
      if ((m.scale ?? 1) !== 1) slot.style.height = `${(86 * m.scale).toFixed(1)}%`;
      slot.classList.toggle('right', xs[i] > 50);
      slot.dataset.char = m.char.id;
      // first pose is a neutral stand; the target pose cross-fades in (keypose + procedural motion)
      const av = renderAvatarLayers(m.char.avatar, { pose: 'idle', emotion: null, name: m.char.name, flip: n > 1 && xs[i] > 50, art: m.char.art ?? null });
      if (m.role && m.char.name) {
        const tag = document.createElement('span');
        tag.className = 'ci-famtag';
        tag.textContent = `${m.role === 'spouse' ? '💍 ' : m.role === 'partner' ? '💕 ' : m.genius ? '🌟 ' : ''}${m.char.name}`;
        slot.appendChild(tag);
      }
      slot.appendChild(av);
      const glyph = m.glyph ?? EMOTION_GLYPH[m.emotion] ?? null;
      if (glyph) {
        const g = document.createElement('span');
        g.className = `ci-emo${m.glyph ? ' badge' : ''}`;
        g.textContent = glyph;
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

  // ---------- Stage 6: job badge, gold sparkle, news strip ----------
  function renderStage6(spec) {
    overlay.classList.toggle('gold', spec.fx === 'gold');
    if (spec.badge) {
      const b = spec.badge;
      const el = document.createElement('div');
      el.className = `ci-badge ${b.kind ?? ''}`;
      el.innerHTML = `<span class="ci-badge-ic">${b.img ? `<img src="${esc(b.img)}" alt="" decoding="async">` : esc(b.icon)}</span><span class="ci-badge-body"><b class="ci-badge-t">${esc(b.title)}</b>${
        b.stars ? `<span class="ci-badge-stars" aria-label="랭크">${esc(b.stars)}</span>` : ''
      }${b.sub ? `<small class="ci-badge-sub">${esc(b.sub)}</small>` : ''}</span>`;
      $.fx.appendChild(el);
    }
    if (spec.fx === 'gold') {
      const g = document.createElement('div');
      g.className = 'ci-goldfx';
      g.innerHTML = Array.from({ length: 14 }, (_, i) => `<i style="--i:${i};--y:${12 + ((i * 37) % 70)}%">${i % 3 ? '✨' : '🌟'}</i>`).join('');
      $.fx.appendChild(g);
    }
    if (spec.news?.title) {
      const n = document.createElement('div');
      n.className = 'ci-news';
      n.innerHTML = `<span class="ci-news-tag">📰 속보</span><span class="ci-news-t">${esc(spec.news.title)}</span>`;
      $.fx.appendChild(n);
    }
  }

  // ---------- Stage 7: 명절 정산 (hwatu flip), 로또 추첨, holiday prompt deck ----------
  function renderStage7(item) {
    const { spec } = item;
    $.extra.innerHTML = '';
    if (spec.holiday) renderHoliday(item);
    if (spec.lotto) renderLotto(item);
    if (spec.prompt?.kind === 'holiday') {
      const deck = document.createElement('div');
      deck.className = 'ci-hw-deck';
      deck.innerHTML = [0, 1, 2].map((i) => `<span class="hw-deal" style="--i:${i}">${hwatuSvg(0, { back: true })}</span>`).join('');
      $.fx.appendChild(deck);
    }
  }

  /** Window: every staker's 화투 face-down → flips one by one, the winner glows; box: 세뱃돈 / 잔소리 / 판돈 table. */
  function renderHoliday(item) {
    const { rows, kind } = item.spec.holiday;
    const players = rows.filter((r) => r.card != null);
    const row = document.createElement('div');
    row.className = 'ci-hwrow';
    row.style.setProperty('--n', String(Math.max(1, players.length)));
    row.innerHTML = `<div class="ci-hw-title">${esc(holidayTitle(kind))} · 🎴 고스톱</div><div class="ci-hw-cards">${players
      .map((r, i) => `<span class="ci-hw-slot${r.winner ? ' win' : ''}">${hwatuFlipHtml(r.card, { delay: 500 + i * 420, win: r.winner })}<b class="ci-hw-name">${r.winner ? '👑 ' : ''}${esc(r.name)}</b><small class="ci-hw-k">${r.card}끗</small></span>`)
      .join('')}${players.length ? '' : '<span class="ci-hw-none">이번 고스톱은 모두 구경만 했어요</span>'}</div>`;
    $.fx.appendChild(row);
    const flipAll = () => cur === item && row.querySelectorAll('.hw').forEach((h) => h.classList.add('flip'));
    if (isReduced()) flipAll();
    else item.timers.push(setTimeout(() => cur === item && row.classList.add('go'), 60));
    const table = document.createElement('div');
    table.className = 'ci-hres';
    table.innerHTML = rows
      .map(
        (r) => `<div class="ci-hres-row${r.winner ? ' win' : ''}${r.char?.isMe ? ' me' : ''}"><span class="ci-hres-n">${esc(r.name)}</span>${r.sebae ? `<span class="ci-chip ${r.sebae.kind}">${esc(r.sebae.text)}</span>` : ''}${
          r.nagging ? `<span class="ci-chip stat stat-${esc(r.nagging.stat)} ${r.nagging.kind}">${esc(r.nagging.text)}</span>` : ''
        }<span class="ci-chip ${r.winner ? 'plus' : r.net < 0 ? 'minus' : ''}">🎴 ${esc(r.stakeText)}${r.winText ? ` · ${esc(r.winText)}` : ''}</span>${
          r.nagging?.line ? `<small class="ci-hres-q">“${esc(r.nagging.line)}”</small>` : ''
        }</div>`,
      )
      .join('');
    $.extra.appendChild(table);
  }

  /** Lotto machine on the studio screen: balls drop one by one; entries (their numbers, hits, prize) in the box. */
  function renderLotto(item) {
    const { numbers, rows } = item.spec.lotto;
    const panel = document.createElement('div');
    panel.className = 'ci-lotto';
    panel.innerHTML = `<div class="ci-lotto-t">🎱 전국 로또 당첨 번호</div><div class="ci-lotto-balls">${numbers.map((n, i) => lottoBallHtml(n, { delay: 700 + i * 900 })).join('')}</div>`;
    $.fx.appendChild(panel);
    if (item.spec.lottoText?.length) {
      const p = document.createElement('p');
      p.className = 'ci-lotto-sum';
      p.textContent = item.spec.lottoText.join(' ');
      $.extra.appendChild(p);
    }
    if (rows.length) {
      const list = document.createElement('div');
      list.className = 'ci-lotto-rows';
      list.innerHTML = rows
        .map(
          (r, i) => `<div class="ci-lotto-row${r.prize > 0 ? ' won' : ''}${r.char?.isMe ? ' me' : ''}" style="--d:${900 + numbers.length * 900 + i * 250}ms"><span class="ci-hres-n">${esc(r.name)}</span><span class="ci-lotto-mine">${r.numbers
            .map((x) => lottoBallHtml(x.n, { hit: x.hit, small: true }))
            .join('')}</span><span class="ci-chip ${r.prize > 0 ? 'plus' : ''}">${r.matches}개 일치 · ${esc(r.prizeText)}</span></div>`,
        )
        .join('');
      $.extra.appendChild(list);
    }
  }

  // ---------- Stage 8: wedding / hearts / heartbreak fx, house panel, market chart, 돌잡이, 고교 첫 만남 pairs ----------
  function renderStage8(item) {
    const { spec } = item;
    if (spec.prompt?.kind === 'house') {
      // 매물 prompt: the listed houses stand on the right side of the window (「매물」 signs)
      const ids = (spec.prompt.options ?? []).map((o) => o.houseId ?? (String(o.id).startsWith('buy:') ? String(o.id).slice(4) : null)).filter(Boolean).slice(0, 3);
      if (ids.length) {
        const row = document.createElement('div');
        row.className = 'ci-houserow';
        row.innerHTML = ids.map((id, i) => `<span class="ci-hr-item" style="--i:${i}">${houseArtHtml(id, { art: artFor('house', id), label: houseInfo(id, getMeta())?.name ?? id })}<i>매물</i></span>`).join('');
        $.fx.appendChild(row);
      }
    }
    overlay.classList.toggle('wedding', spec.fx8 === 'wedding');
    if (spec.fx8) {
      const fx = document.createElement('div');
      fx.className = `ci-famfx ${spec.fx8}`;
      const glyphs = spec.fx8 === 'wedding' ? ['🎊', '💐', '🎉', '💖', '✨', '🎊', '🌸'] : spec.fx8 === 'hearts' ? ['💗', '💕', '💖', '❤️', '💞'] : ['💔', '💧', '💔'];
      const n = spec.fx8 === 'heartbreak' ? 5 : 16;
      fx.innerHTML = `${spec.fx8 === 'wedding' ? '<span class="ci-wedframe" aria-hidden="true">💒</span>' : ''}${Array.from(
        { length: n },
        (_, i) => `<i style="--i:${i};--x:${(i * 61) % 100}%;--d:${((i * 37) % 17) / 10}s">${glyphs[i % glyphs.length]}</i>`,
      ).join('')}`;
      $.fx.appendChild(fx);
    }
    if (spec.house) {
      const h = spec.house;
      const panel = document.createElement('div');
      panel.className = 'ci-house';
      panel.innerHTML = `${houseArtHtml(h.id, { art: h.art, label: h.name, cls: 'ci-house-art' })}<div class="ci-house-cap"><b>${esc(h.icon)} ${esc(h.name)}</b>${h.price ? `<small>${esc(won(h.price))}</small>` : ''}${
        h.tradeIn ? `<small class="trade">🔁 보상판매 +${esc(won(h.tradeIn))}</small>` : ''
      }${h.discount ? `<small class="disc">🎫 청약 -${esc(won(h.discount))}</small>` : ''}${h.value && h.value !== h.price ? `<small class="disc">💎 자산가치 ${esc(won(h.value))}</small>` : ''}</div>`;
      $.fx.appendChild(panel);
    }
    if (spec.market) {
      const panel = document.createElement('div');
      panel.className = `ci-market ${spec.market.dir}`;
      panel.innerHTML = `<div class="ci-market-t">🏠 부동산 시세</div>${marketChartSvg(spec.market.mult)}`;
      $.fx.appendChild(panel);
      if (spec.marketText?.length) {
        const p = document.createElement('p');
        p.className = 'ci-lotto-sum';
        p.textContent = spec.marketText.join(' ');
        $.extra.appendChild(p);
      }
    }
    if (spec.dol) {
      const panel = document.createElement('div');
      panel.className = 'ci-dol';
      panel.innerHTML = dolTableSvg();
      $.fx.appendChild(panel);
    }
    if (spec.pairs?.length) {
      const list = document.createElement('div');
      list.className = 'ci-pairs';
      list.innerHTML = spec.pairs
        .map(
          (pr, i) => `<div class="ci-pair${pr.char.isMe ? ' me' : ''}" style="--d:${300 + i * 220}ms"><span class="ci-pair-av">${portraitHtml(pr.char, { size: 30 })}</span><b>${esc(pr.char.name)}</b><span class="ci-pair-h">💘</span><span class="ci-pair-av">${
            pr.npc ? portraitHtml(pr.npc, { size: 30 }) : '💞'
          }</span><b>${esc(pr.partner.name)}</b><span class="ci-chip love">${esc(pr.partner.traitIcon)} ${esc(pr.partner.traitName)}${pr.partner.starsText ? ` ${esc(pr.partner.starsText)}` : ''}</span></div>`,
        )
        .join('');
      $.extra.appendChild(list);
      hydratePortraits(list);
    }
  }

  // ---------- Stage 9: horse race, wish sparkles, treasure chest, submap prompt props ----------
  function renderStage9(item) {
    const { spec } = item;
    overlay.dataset.submap = spec.submap ?? spec.prompt?.kind ?? '';
    if (spec.race) {
      const panel = document.createElement('div');
      panel.className = 'ci-race';
      panel.innerHTML = raceHtml(spec.race, { still: isReduced() });
      $.fx.appendChild(panel);
      // start after the entry squash; the plan decides who wins (same for every viewer)
      item.timers.push(setTimeout(() => cur === item && panel.firstElementChild?.classList.add('go'), isReduced() ? 0 : 450));
    }
    if (spec.fx9 === 'wish' || spec.fx9 === 'wishfail') {
      const fx = document.createElement('div');
      fx.className = `ci-wishfx ${spec.fx9}`;
      const glyphs = spec.fx9 === 'wish' ? ['✨', '🌟', '✨', '💫'] : ['🍂', '💧'];
      fx.innerHTML = Array.from({ length: spec.fx9 === 'wish' ? 14 : 5 }, (_, i) => `<i style="--i:${i};--x:${(i * 53) % 100}%">${glyphs[i % glyphs.length]}</i>`).join('');
      $.fx.appendChild(fx);
    }
    if (spec.lottoNums?.length) {
      const panel = document.createElement('div');
      panel.className = 'ci-lotto small9';
      panel.innerHTML = `<div class="ci-lotto-balls">${spec.lottoNums.map((n, i) => lottoBallHtml(n, { delay: 500 + i * 500 })).join('')}</div>`;
      $.fx.appendChild(panel);
    }
    if (spec.ticket) {
      const tk = spec.ticket;
      const rankText = { jackpot: '1등', second: '2등', third: '3등' }[tk.rank] ?? (tk.win ? '당첨' : '');
      const panel = document.createElement('div');
      panel.className = `ci-ticket${tk.win ? ' win' : ''}${tk.jackpot ? ' jackpot' : ''}`;
      panel.innerHTML = `<span class="ci-tk-head">🎟️ 인생역전 로또</span><span class="ci-tk-scratch" aria-hidden="true"></span><b class="ci-tk-res">${tk.win ? `🎉 ${esc(rankText)} ${tk.prize ? esc(won(tk.prize)) : ''}` : '꽝… 다음 기회에'}</b>`;
      $.fx.appendChild(panel);
      item.timers.push(setTimeout(() => cur === item && panel.classList.add('scratched'), isReduced() ? 0 : 900));
    }
    if (spec.treasure) {
      const t = spec.treasure;
      const panel = document.createElement('div');
      panel.className = 'ci-treasure';
      panel.innerHTML = `<span class="ci-chest">${treasureChestSvg()}</span><span class="ci-chest open">${treasureChestSvg({ open: true })}</span>${treasureArtHtml(t.id, { art: t.art, meta: getMeta(), cls: 'ci-tr-item' })}<b class="ci-tr-name">${esc(t.name)}</b>`;
      $.fx.appendChild(panel);
      item.timers.push(setTimeout(() => cur === item && panel.classList.add('opened'), isReduced() ? 0 : 900));
    }
    if (spec.prompt?.kind === 'reversal' && (spec.prompt.options ?? []).some((o) => String(o.id).startsWith('horse:'))) {
      const gate = document.createElement('div');
      gate.className = 'ci-race gate';
      gate.innerHTML = raceGateHtml();
      $.fx.appendChild(gate);
    }
  }

  // ---------- MCs (Stage 5.6) ----------
  const mcSound = (l) => audio?.play('bark', { mc: l.speaker, force: true });

  /** Two MCs center stage; each line → bubble above the dog + a line in the dialogue box. */
  function renderStudio(item) {
    const lines = item.spec.mcScript ?? [];
    const stage = document.createElement('div');
    stage.className = 'ci-studio';
    const booth = createMcBooth({ ids: ['hoya', 'bomi'], size: 0 });
    // the generated studio background has its own host desk → only the SVG studio gets the CSS desk bar
    const studioArt = !!findAsset({ kind: 'bg', scene: 'studio' });
    stage.classList.toggle('art', studioArt);
    stage.innerHTML = studioArt ? '<i class="mc-floor" aria-hidden="true"></i>' : '<i class="mc-desk" aria-hidden="true"></i>';
    stage.appendChild(booth.el);
    $.fx.appendChild(stage);
    const shown = [];
    playMcScript(booth, lines, {
      delay: isReduced() ? 0 : 350,
      gap: 1500,
      hold: 1600,
      cancelled: () => cur !== item,
      onLine: (l) => {
        mcSound(l);
        shown.push(`<span class="mc-line-who ${esc(l.speaker)}">${esc(MC_NAMES[l.speaker] ?? '')}</span>${esc(l.line)}`);
        $.text.innerHTML = shown.slice(-3).join('<br>');
        cur && (cur.typing = null);
      },
    });
  }

  /** Small MC(s) at the bottom-right of the illustration window, after the character's own line. */
  function renderSmallMc(item) {
    const lines = item.spec.mc;
    const box = document.createElement('div');
    box.className = 'ci-mc';
    const booth = createMcBooth({ ids: mcSpeakers(lines), size: 0 });
    box.appendChild(booth.el);
    box.hidden = true;
    $.fx.appendChild(box);
    const delay = isReduced() ? 0 : item.spec.line ? 1100 : 500;
    item.timers.push(setTimeout(() => cur === item && (box.hidden = false), delay));
    playMcScript(booth, lines, { delay, gap: 1200, hold: 99999, cancelled: () => cur !== item, onLine: mcSound });
  }

  function renderTabs(spec) {
    const chars = spec.characters ?? [];
    const state = audio?.state;
    $.tabs.innerHTML = `<div class="ci-tabs-l">${chars
      .map(
        (c, i) =>
          `<span class="ci-tab${c.id === spec.currentId ? ' on' : ''}${c.isMe ? ' me' : ''}"><span class="ci-tab-av">${portraitHtml(c, { size: 22 })}</span><span class="ci-tab-n">${i + 1}</span><span class="ci-tab-name">${esc(c.name)}</span>${c.id === spec.currentId ? '<span class="ci-tab-cur">▶</span>' : ''}</span>`,
      )
      .join('')}</div>${
      audio
        ? `<div class="ci-tabs-r"><button type="button" class="ci-tab btn-sound" data-ci-act="mute" aria-pressed="${state?.muted ? 'true' : 'false'}">${state?.muted ? '🔇 소리 꺼짐' : '🔊 소리'}</button></div>`
        : ''
    }`;
    hydratePortraits($.tabs);
    // one scrollable row: keep the current character's tab in view
    const row = $.tabs.querySelector('.ci-tabs-l');
    const on = row?.querySelector('.ci-tab.on');
    if (row && on && row.scrollWidth > row.clientWidth) row.scrollLeft = Math.max(0, on.offsetLeft - row.offsetLeft - (row.clientWidth - on.offsetWidth) / 2);
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
    overlay.classList.toggle('lotto', !!spec.lotto);
    overlay.classList.toggle('market', !!spec.market);
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
    renderStage6(spec);
    renderStage7(item);
    renderStage8(item);
    renderStage9(item);
    if (spec.kind === 'mc') renderStudio(item);
    else if (spec.mc?.length) renderSmallMc(item);
    audio?.play(spec.sfx ?? pres().tones?.[spec.tone]?.sfx ?? 'pop');
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
    if (spec.autoMs && spec.kind !== 'mc' && spec.mc?.length) spec.autoMs = Math.max(spec.autoMs, (spec.line ? 1100 : 500) + mcScriptMs(spec.mc, { gap: 1200, hold: 1500 }));
    if (spec.autoMs) {
      item.timers.push(setTimeout(() => cur === item && close('auto'), spec.autoMs)); // 'auto' → onClose tells auto from tap
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
    $.wait.innerHTML = '';
    // keep the option buttons when only the answered list changed (others answering a group prompt):
    // rebuilding them would swallow a click that's in flight
    const optKey = p?.forMe?.length ? `${p.promptId}|${p.forMe[0].id}|${p.forMe.length}` : '';
    if (!optKey || $.options.dataset.key !== optKey) {
      $.options.innerHTML = '';
      $.options.dataset.key = optKey;
    }
    if (!p) return;
    const famHtml = p.forMe?.length && !$.options.childElementCount ? stage8OptionsHtml(p) : null;
    if (famHtml) {
      $.options.innerHTML = famHtml;
      hydratePortraits($.options);
    } else if (p.forMe?.length && !$.options.childElementCount && p.kind === 'shop') {
      // Stage 7 상점: three product cards (art, name, price, effect, coupon, disabled) + 지나가기
      const who = p.forMe[0];
      $.options.innerHTML = `${
        p.forMe.length > 1 || who.id !== p.charId ? `<p class="ci-opt-who">${esc(who.name)}의 선택</p>` : ''
      }${shopOptionsHtml(p, who, { meta: getMeta(), artFor, btnClass: 'ci-opt' })}`;
    } else if (p.forMe?.length && !$.options.childElementCount) {
      const who = p.forMe[0];
      $.options.innerHTML = `${
        p.forMe.length > 1 || who.id !== p.charId ? `<p class="ci-opt-who">${esc(who.name)}의 선택${p.forMe.length > 1 ? ` <small>(내 캐릭터 ${p.forMe.length}명 남음)</small>` : ''}</p>` : ''
      }<div class="ci-opt-list">${p.options
        .map(
          (o) =>
            `<button type="button" class="ci-opt${o.desc || o.badges?.length ? ' has-desc' : ''}" data-choose="${esc(o.id)}" data-prompt="${esc(p.promptId)}" data-char="${esc(who.id)}"><span class="c-icon">${esc(o.icon ?? '')}</span><span class="ci-opt-l">${esc(o.label ?? o.id)}${
              o.desc ? `<small class="ci-opt-desc">${esc(o.desc)}</small>` : ''
            }${o.badges?.length ? `<span class="ci-opt-badges">${o.badges.map((b) => `<span class="ci-opt-badge">${esc(b)}</span>`).join('')}</span>` : ''}</span></button>`,
        )
        .join('')}</div>`;
    }
    const waiting = p.waitingNames ?? [];
    if (!p.forMe?.length && waiting.length) $.wait.innerHTML = `⏳ ${esc(waiting.join(', '))}의 선택을 기다리는 중…`;
    if (p.deadlineAt) $.wait.innerHTML += ` <span class="ci-deadline" data-deadline="${p.deadlineAt}"></span>`;
    tickDeadline();
  }

  /** Stage 8 prompts: 만남 candidate cards, 데이트 cost / ❤️, 프러포즈 chance meter, 매물 listing cards. */
  function stage8OptionsHtml(p) {
    const who = p.forMe[0];
    const sm = submapOptionsHtml(p, who, { meta: getMeta(), btnClass: 'ci-opt', won }); // Stage 9 submaps
    if (sm != null) return sm;
    const head = p.forMe.length > 1 || who.id !== p.charId ? `<p class="ci-opt-who">${esc(who.name)}의 선택</p>` : '';
    if (p.kind === 'house') return `${head}${houseOptionsHtml(p, who, { meta: getMeta(), room: p.room ?? null, artFor, btnClass: 'ci-opt' })}`;
    const html = familyOptionsHtml(p, who, { meta: getMeta(), btnClass: 'ci-opt' });
    return html == null ? null : `${head}${html}`;
  }

  function tickDeadline() {
    for (const d of overlay.querySelectorAll('[data-deadline]')) {
      const left = Math.max(0, Math.ceil((Number(d.dataset.deadline) - now()) / 1000));
      d.textContent = `남은 시간 ${left}초`;
      d.classList.toggle('urgent', left <= 5);
    }
  }
  const ticker = setInterval(tickDeadline, 250);

  // ---------- queue ----------
  /** Warm the cast's composed art so the window opens with the characters in place (capped wait). */
  function preloadCast(spec) {
    const cast = (spec.cast ?? []).slice(0, (spec.cast ?? []).some((m) => m.role) ? MAX_CAST : 3);
    if (!cast.length) return Promise.resolve();
    const jobs = cast.map((m) => {
      const part = expressionFor(m.emotion).part;
      return preloadAvatarLayers(m.char, { expressions: part ? [part] : [] }).catch(() => {});
    });
    const cap = spec.prompt ? Math.min(300, CAST_PRELOAD_MS) : CAST_PRELOAD_MS;
    return Promise.race([Promise.all(jobs), new Promise((r) => setTimeout(r, cap))]);
  }

  function pump() {
    if (cur || !q.length) {
      if (!cur && !q.length) {
        overlay.hidden = true;
        document.body?.classList.remove('cutin-open');
        for (const cb of [...idle]) cb();
      }
      return;
    }
    const it = q.shift();
    cur = it;
    cur.timers = [];
    cur.loading = true;
    const start = () => {
      if (cur !== it) return; // closed / pre-empted while the cast was loading
      it.loading = false;
      it.shownAt = Date.now();
      document.body?.classList.add('cutin-open');
      try {
        render(it);
        if (it.closeBy != null) it.timers.push(setTimeout(() => cur === it && close(), Math.max(0, it.closeBy - Date.now())));
      } catch (err) {
        console.warn('[cutin]', err);
        cur = null;
        it.resolve(false);
        pump();
      }
    };
    let pre = null;
    try {
      pre = isReduced() ? null : preloadCast(it.spec);
    } catch {
      pre = null;
    }
    if (pre) pre.then(start, start);
    else start();
  }

  function close(result = true) {
    const it = cur;
    if (!it) return;
    for (const t of it.timers) clearTimeout(t);
    cur = null;
    if (!it.loading) overlay.classList.add('leaving');
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
    // Stage 7: 상점 / 명절 prompts default to their own scene + tone when the server leaves them neutral
    const kindLook =
      {
        shop: { tone: 'treasure', scene: 'shop' },
        holiday: { tone: 'holiday', scene: 'holiday' },
        // Stage 8
        meet: { tone: 'love', scene: 'none' },
        date: { tone: 'love', scene: 'none' },
        propose: { tone: 'love', scene: 'wedding-hall' },
        house: { tone: 'treasure', scene: 'none' },
        // Stage 9 submaps
        hometown: { tone: 'good', scene: 'hometown' },
        temple: { tone: 'good', scene: 'temple' },
        jeju: { tone: 'holiday', scene: 'jeju' },
        reversal: { tone: 'treasure', scene: 'casino' },
      }[p.kind] ?? null;
    // Stage 8: the partner (date / propose) or the candidates (meet) stand next to the character
    if (subject && cast.length && ['meet', 'date', 'propose'].includes(p.kind)) {
      const extra = [];
      if (p.kind === 'meet') {
        for (const o of p.options ?? []) {
          const spec = o.partner ?? (subject.love?.candidates ?? []).find((x) => x?.id === o.partnerId) ?? (p.context?.candidates ?? []).find((x) => x?.id === o.partnerId);
          const npc = npcCharacter(spec, { prefix: 'partner' });
          if (npc) extra.push({ char: npc, role: 'partner', scale: 1, pose: 'wave', emotion: 'shy', glyph: null });
        }
      } else {
        const npc = npcCharacter(subject.love?.partner ?? subject.spouse, { prefix: 'partner' });
        if (npc) extra.push({ char: npc, role: 'partner', scale: 1, pose: p.kind === 'propose' ? 'idle' : 'wave', emotion: p.kind === 'propose' ? 'shy' : 'love', glyph: null });
      }
      if (extra.length) cast.splice(1, cast.length, ...extra.slice(0, 2));
    }
    const tone = p.tone && (p.tone !== 'neutral' || !kindLook) ? p.tone : kindLook?.tone ?? 'neutral';
    const scene = p.scene && (p.scene !== 'none' || !kindLook) ? p.scene : kindLook?.scene ?? 'none';
    const anchor = { type: 'prompt', tone, title: p.title, kind: p.kind };
    return {
      key: `prompt:${p.promptId}`,
      kind: 'prompt',
      tone,
      scene,
      tag: tagLabel(anchor, { tones: pres().tones }),
      who: `${p.kind === 'holiday' && !forMe.length ? '' : subject?.name ?? ''}${sceneLabel(scene) ? ` · ${sceneLabel(scene)}` : ''}`.replace(/^ · /, ''),
      text: [p.text || p.title].filter(Boolean), // the title is the tag above the window (no repeat)
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
        kind: p.kind,
        options: (p.options ?? []).map((o) => {
          const x = optionExtras(p, o, { jobs: getMeta()?.jobs });
          const desc = routeOptionInfo(p, o);
          const icon = o.icon || x.icon || (p.kind === 'holiday' ? HOLIDAY_OPTION_ICON[o.id] ?? '' : '');
          return { ...o, icon, label: optionLabel({ ...o, icon }), desc, badges: [...(x.salary != null ? [`💵 첫 월급 ${won(x.salary)}`] : []), ...x.badges] };
        }),
        forMe,
        room, // Stage 8 house listings: owners / capacity
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
    studioSpec,
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
        if (opts.urgent) q.unshift(item); // my prompt jumps the queue (see preempt)
        else q.push(item);
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
    /**
     * A prompt of mine is waiting: drop every queued event cut-in (their promises resolve false) and close the
     * one on screen after at most `keepMs` in total. The prompt cut-in itself is kept. → number dropped
     */
    preempt({ keepMs = PREEMPT_KEEP_MS } = {}) {
      let dropped = 0;
      for (let i = q.length - 1; i >= 0; i--) {
        const it = q[i];
        if (it === promptItem?.item) continue;
        q.splice(i, 1);
        it.resolve(false);
        dropped++;
      }
      if (cur && cur !== promptItem?.item) {
        const it = cur;
        if (it.loading) {
          close(false);
          dropped++;
        } else {
          const by = (it.shownAt ?? Date.now()) + keepMs;
          if (it.closeBy == null || by < it.closeBy) {
            it.closeBy = by;
            it.timers.push(setTimeout(() => cur === it && close(false), Math.max(0, by - Date.now())));
          }
        }
      }
      return dropped;
    },
    /** Drop queued (not yet shown) event cut-ins, e.g. at game over. */
    clearQueue() {
      for (let i = q.length - 1; i >= 0; i--) {
        const it = q[i];
        if (it === promptItem?.item) continue;
        q.splice(i, 1);
        it.resolve(false);
      }
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
      while ($.reacts.childElementCount > 3) $.reacts.firstElementChild.remove();
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
