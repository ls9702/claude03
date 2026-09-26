// MC NPCs (Stage 5.6): 호야 & 봄이 — the user's two Shih Tzus host the show.
//
//   renderMc('hoya', { expression: 'joy', pose: 'clap', size: 96 })  → <div class="mc"> (generated art when
//       accepted: findAsset({kind:'mc', mc, pose|expression}), else the SVG chibi dog below); el.setState({...})
//   mcSvg('bomi', { expression, pose })  → SVG markup (pure, node-tested)
//   createMcBooth({ ids, size })          → both dogs + one speech bubble; booth.say(line) / booth.clear()
//   playMcScript(booth, lines, { gap })   → shows the lines one after another (Promise, cancellable)
//
// The SVG dogs are drawn after the reference photos: 호야 = almost all white fluffy coat (creamy on top),
// dark brown-black floppy ears with a tan base, light tan around the eyes, pink tongue tip out, orange bandana;
// 봄이 = black head sides/ears and a black mask over both eyes, white forehead blaze, white muzzle/chin/chest,
// black back, black speckles on the white front paws, purple bow tie. Idle motion (tail wag, ear bounce,
// breathing) is CSS (public/css/mc.css) on the `.mc-tail`, `.mc-ear-*`, `.mc-breath`, `.mc-headbob` groups.
import { findAsset } from '../assets.js';

export const MC_IDS = ['hoya', 'bomi'];
export const MC_NAMES = { hoya: '호야', bomi: '봄이' };
export const MC_EXPRESSIONS = ['neutral', 'joy', 'surprise', 'sad', 'angry', 'proud', 'sleepy'];
export const MC_POSES = ['idle', 'wave', 'clap', 'mic'];

const PALETTE = {
  hoya: {
    fur: '#fbf8f3', shade: '#e9ddcc', line: '#b9a792', cream: '#f0d7b6', ear: '#3b2b22', earTan: '#b8875a',
    patch: '#e2bf96', nose: '#1d1716', eye: '#1a1414', tongue: '#f28ca0', mouth: '#7a2e3a', accent: '#ff8a3d', accent2: '#e0621a',
  },
  bomi: {
    fur: '#f7f5f2', shade: '#dcd7d0', line: '#9f978d', black: '#1f1d21', black2: '#37333b', socket: '#48434d', beard: '#e3d8c9',
    nose: '#141214', eye: '#0d0b0e', tongue: '#ee8a9c', mouth: '#5d2430', accent: '#6d5dfc', accent2: '#4c3fd6',
  },
};

let uidSeq = 0;
const f1 = (n) => Math.round(n * 10) / 10;

/** Scalloped ("fluffy") ellipse path. */
function fluff(cx, cy, rx, ry, n = 16, bump = 4, rot = 0) {
  const pt = (a, k = 0) => [f1(cx + (rx + k) * Math.cos(a)), f1(cy + (ry + k) * Math.sin(a))];
  const step = (Math.PI * 2) / n;
  let d = `M${pt(rot).join(' ')}`;
  for (let i = 0; i < n; i++) {
    const a0 = rot + i * step;
    const c = pt(a0 + step / 2, bump * 1.9);
    const p = pt(a0 + step);
    d += `Q${c.join(' ')} ${p.join(' ')}`;
  }
  return `${d}Z`;
}

const mirrorX = (d) => d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (m, x, y) => `${f1(200 - Number(x))} ${y}`);

// ---------- parts ----------

function earPath(side) {
  const d = 'M60 60C38 56 26 84 30 112C33 132 46 142 58 136C68 131 70 116 70 100C70 84 70 68 60 60Z';
  return side === 'l' ? d : mirrorX(d);
}
function earTanPath(side) {
  const d = 'M60 62C50 62 44 70 44 80C46 86 56 88 64 84C68 78 66 66 60 62Z';
  return side === 'l' ? d : mirrorX(d);
}

/** Eye pair for an expression. `c` = palette, `dark` = on a black mask (봄이). */
function eyes(expr, c, dark) {
  const ink = c.eye;
  const hl = '#ffffff';
  const xs = [80, 120];
  const y = 90;
  const out = [];
  const socket = dark ? xs.map((x) => `<ellipse cx="${x}" cy="${y}" rx="13" ry="12" fill="${c.socket}"/>`).join('') : '';
  out.push(socket);
  switch (expr) {
    case 'joy':
      for (const x of xs) out.push(`<path d="M${x - 9} ${y + 3}Q${x} ${y - 9} ${x + 9} ${y + 3}" fill="none" stroke="${ink}" stroke-width="4.2" stroke-linecap="round"/>`);
      break;
    case 'proud':
      for (const x of xs) out.push(`<path d="M${x - 9} ${y}Q${x} ${y + 7} ${x + 9} ${y}" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>`);
      break;
    case 'sleepy':
      for (const x of xs) out.push(`<path d="M${x - 9} ${y + 2}Q${x} ${y + 6} ${x + 9} ${y + 2}" fill="none" stroke="${ink}" stroke-width="3.4" stroke-linecap="round"/><path d="M${x - 7} ${y + 7}l-2 3M${x + 7} ${y + 7}l2 3" stroke="${ink}" stroke-width="1.6" stroke-linecap="round"/>`);
      break;
    case 'surprise':
      for (const x of xs) out.push(`<circle cx="${x}" cy="${y - 1}" r="10.5" fill="#fff" stroke="${ink}" stroke-width="2.6"/><circle cx="${x}" cy="${y}" r="3.6" fill="${ink}"/>`);
      break;
    case 'sad':
      for (const x of xs) {
        out.push(`<ellipse cx="${x}" cy="${y + 1}" rx="8.5" ry="9.5" fill="${ink}"/><circle cx="${x - 3}" cy="${y - 3}" r="3.4" fill="${hl}"/><circle cx="${x + 3}" cy="${y + 4}" r="1.8" fill="${hl}"/>`);
        out.push(`<path d="M${x - 8} ${y + 7}Q${x} ${y + 12} ${x + 8} ${y + 7}" fill="none" stroke="#8fd3ff" stroke-width="2.4" stroke-linecap="round" opacity=".9"/>`);
      }
      break;
    case 'angry':
      for (const [i, x] of xs.entries()) {
        const s = i === 0 ? 1 : -1;
        out.push(`<ellipse cx="${x}" cy="${y + 2}" rx="8" ry="8" fill="${ink}"/><circle cx="${x - 2.5}" cy="${y}" r="2.4" fill="${hl}"/>`);
        // slanted lid (fur colour) covering the top of the eye
        out.push(`<path d="M${x - 12} ${y - 12 + (s > 0 ? -2 : 8)}L${x + 12} ${y - 12 + (s > 0 ? 8 : -2)}L${x + 12} ${y - 14}L${x - 12} ${y - 14}Z" fill="${dark ? c.socket : c.patch}"/>`);
        out.push(`<path d="M${x - 11} ${y - 4 + (s > 0 ? -4 : 4)}L${x + 11} ${y - 4 + (s > 0 ? 4 : -4)}" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>`);
      }
      break;
    default: // neutral
      if (dark) {
        // 봄이: calm half-lidded "unimpressed" eyes
        for (const x of xs) {
          out.push(`<ellipse cx="${x}" cy="${y + 1}" rx="9" ry="8.5" fill="${ink}"/><circle cx="${x - 3}" cy="${y + 1}" r="2.6" fill="${hl}"/>`);
          out.push(`<path d="M${x - 11} ${y - 9}L${x + 11} ${y - 9}L${x + 11} ${y - 1}Q${x} ${y - 4} ${x - 11} ${y - 1}Z" fill="${c.socket}"/>`);
          out.push(`<path d="M${x - 10} ${y - 1.5}Q${x} ${y - 4.5} ${x + 10} ${y - 1.5}" fill="none" stroke="#6b6570" stroke-width="1.6"/>`);
        }
      } else {
        // 호야: big round shiny eyes
        for (const x of xs) out.push(`<circle cx="${x}" cy="${y}" r="9.5" fill="${ink}"/><circle cx="${x - 3.2}" cy="${y - 3.4}" r="3.6" fill="${hl}"/><circle cx="${x + 3.4}" cy="${y + 3.2}" r="1.7" fill="${hl}"/>`);
      }
  }
  return out.join('');
}

function brows(expr, c, dark) {
  const col = dark ? '#6f6975' : c.line;
  if (expr === 'sad') return `<path d="M70 76L86 72M130 76L114 72" stroke="${col}" stroke-width="3" stroke-linecap="round"/>`;
  if (expr === 'surprise') return `<path d="M70 72Q80 66 90 71M110 71Q120 66 130 72" fill="none" stroke="${col}" stroke-width="2.6" stroke-linecap="round"/>`;
  return '';
}

function mouth(id, expr, c) {
  const m = c.mouth;
  const tongue = c.tongue;
  const y = 116;
  switch (expr) {
    case 'joy':
      return `<path d="M88 ${y - 2}Q100 ${y + 20} 112 ${y - 2}Z" fill="${m}"/><path d="M93 ${y + 7}Q100 ${y + 15} 107 ${y + 7}Q100 ${y + 3} 93 ${y + 7}Z" fill="${tongue}"/>`;
    case 'surprise':
      return `<ellipse cx="100" cy="${y + 4}" rx="5" ry="6.5" fill="${m}"/>`;
    case 'sad':
      return `<path d="M91 ${y + 6}Q100 ${y - 1} 109 ${y + 6}" fill="none" stroke="${m}" stroke-width="2.6" stroke-linecap="round"/>`;
    case 'angry':
      return id === 'bomi'
        ? `<path d="M92 ${y + 3}L108 ${y + 3}" stroke="${m}" stroke-width="3" stroke-linecap="round"/><ellipse cx="116" cy="${y}" rx="7" ry="5.5" fill="#fff" opacity=".85"/>`
        : `<path d="M90 ${y + 5}Q95 ${y + 1} 100 ${y + 4}Q105 ${y + 1} 110 ${y + 5}" fill="none" stroke="${m}" stroke-width="2.6" stroke-linecap="round"/>`;
    case 'proud':
      return `<path d="M90 ${y}Q95 ${y + 6} 100 ${y + 1}Q106 ${y + 7} 113 ${y - 3}" fill="none" stroke="${m}" stroke-width="2.6" stroke-linecap="round"/>`;
    case 'sleepy':
      return `<ellipse cx="100" cy="${y + 5}" rx="6.5" ry="8" fill="${m}"/><ellipse cx="100" cy="${y + 9}" rx="4" ry="3" fill="${tongue}"/>`;
    default:
      if (id === 'hoya') {
        // goofy underbite with the tongue tip out
        return `<path d="M91 ${y}Q95.5 ${y + 5} 100 ${y + 1}Q104.5 ${y + 5} 109 ${y}" fill="none" stroke="${m}" stroke-width="2.4" stroke-linecap="round"/><path d="M96 ${y + 3}Q100 ${y + 14} 104 ${y + 3}Z" fill="${tongue}" stroke="#d96b82" stroke-width="1"/>`;
      }
      return `<path d="M92 ${y + 1}Q96 ${y + 4} 100 ${y + 1}Q104 ${y + 4} 108 ${y + 1}" fill="none" stroke="${m}" stroke-width="2.2" stroke-linecap="round"/>`;
  }
}

function fx(expr, c) {
  switch (expr) {
    case 'joy':
      return `<g class="mc-fx"><path d="M160 46l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="#ffd23f"/><path d="M40 58c-4-6 4-10 6-4 2-6 10-2 6 4l-6 6z" fill="#ff7aa2"/></g>`;
    case 'surprise':
      return `<g class="mc-fx" stroke="#ff5b5b" stroke-width="3.4" stroke-linecap="round"><path d="M152 38l8-10M162 50l12-4M146 30l0-12"/></g><path d="M150 84q5 8 0 12q-5-4 0-12z" fill="#8fd3ff"/>`;
    case 'sad':
      return `<path class="mc-fx mc-tear" d="M78 104q5 9 0 13q-5-4 0-13z" fill="#8fd3ff"/>`;
    case 'angry':
      return `<g class="mc-fx" stroke="#ff4d4d" stroke-width="3.4" stroke-linecap="round" fill="none"><path d="M150 40q6 0 6-6M162 40q-6 0-6-6M150 52q6 0 6 6M162 52q-6 0-6 6"/></g><text x="162" y="80" font-size="15" font-weight="900" fill="${c.accent2}" font-family="system-ui,sans-serif">흥</text>`;
    case 'proud':
      return `<g class="mc-fx"><path d="M156 44l3.5 8 8 3.5-8 3.5-3.5 8-3.5-8-8-3.5 8-3.5z" fill="#ffd23f"/><path d="M170 70l2 4 4 2-4 2-2 4-2-4-4-2 4-2z" fill="#ffe98a"/></g>`;
    case 'sleepy':
      return `<g class="mc-fx mc-zz" font-family="system-ui,sans-serif" font-weight="900" fill="#7c8cff"><text x="146" y="50" font-size="18">Z</text><text x="162" y="34" font-size="13">z</text></g>`;
    default:
      return '';
  }
}

/** Front paws / arms for a pose (drawn over the body). */
function paws(id, pose, c) {
  const fur = c.fur;
  const stroke = c.shade;
  const specks = (x, y) =>
    id === 'bomi' ? `<circle cx="${x - 4}" cy="${y - 1}" r="1.6" fill="${c.black}"/><circle cx="${x + 2}" cy="${y + 1}" r="1.4" fill="${c.black}"/><circle cx="${x + 5}" cy="${y - 2}" r="1.2" fill="${c.black}"/>` : '';
  const toes = (x, y) => `<path d="M${x - 4} ${y + 1}v3M${x} ${y + 2}v3M${x + 4} ${y + 1}v3" stroke="${c.line}" stroke-width="1.2" stroke-linecap="round"/>`;
  const leg = (x) => `<rect x="${x - 8}" y="160" width="16" height="26" rx="8" fill="${fur}" stroke="${stroke}" stroke-width="1.5"/><ellipse cx="${x}" cy="187" rx="11" ry="7" fill="${fur}" stroke="${stroke}" stroke-width="1.5"/>${toes(x, 185)}${specks(x, 186)}`;
  const arm = (x0, y0, x1, y1, cls = '') =>
    `<g class="${cls}"><path d="M${x0} ${y0}L${x1} ${y1}" stroke="${stroke}" stroke-width="17" stroke-linecap="round"/><path d="M${x0} ${y0}L${x1} ${y1}" stroke="${fur}" stroke-width="14" stroke-linecap="round"/><circle cx="${x1}" cy="${y1}" r="9.5" fill="${fur}" stroke="${stroke}" stroke-width="1.5"/>${specks(x1, y1)}</g>`;
  switch (pose) {
    case 'wave':
      return `${leg(86)}${arm(116, 152, 150, 112, 'mc-wave')}`;
    case 'clap':
      return `${arm(80, 156, 95, 138, 'mc-clap-l')}${arm(120, 156, 105, 138, 'mc-clap-r')}`;
    case 'mic':
      return `${leg(86)}<g class="mc-mic-arm"><rect x="137" y="124" width="7" height="30" rx="3.5" transform="rotate(22 140 139)" fill="#2b2b33"/><circle cx="135" cy="121" r="9" fill="#3a3a44"/><circle cx="135" cy="121" r="9" fill="url(#MID-mesh)"/><rect x="129" y="128" width="13" height="4" rx="2" fill="${c.accent}"/>${arm(114, 156, 141, 148)}</g>`;
    default:
      return `${leg(86)}${leg(114)}`;
  }
}

/**
 * SVG markup of an MC (pure; ids unique per call via `uid`).
 * @param {'hoya'|'bomi'} id
 * @param {{expression?: string, pose?: string, uid?: string|number, title?: string}} opts
 */
export function mcSvg(id, { expression = 'neutral', pose = 'idle', uid = null, title = null } = {}) {
  const who = MC_IDS.includes(id) ? id : 'hoya';
  const expr = MC_EXPRESSIONS.includes(expression) ? expression : 'neutral';
  const ps = MC_POSES.includes(pose) ? pose : 'idle';
  const c = PALETTE[who];
  const u = `mc${uid ?? ++uidSeq}`;
  const dark = who === 'bomi';
  const tilt = { proud: -6, sleepy: 8, sad: 4, surprise: -2, angry: -3 }[expr] ?? 0;
  const lift = { surprise: -3, sad: 3, sleepy: 3, joy: -1 }[expr] ?? 0;
  const earRot = { surprise: -22, sad: 14, sleepy: 10, joy: -8, angry: 6 }[expr] ?? 0;

  const defs = `<defs>
    <radialGradient id="${u}-fur" cx="40%" cy="30%" r="80%"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="${c.fur}"/><stop offset="1" stop-color="${c.shade}"/></radialGradient>
    <radialGradient id="${u}-blk" cx="40%" cy="30%" r="80%"><stop offset="0" stop-color="${dark ? c.black2 : c.ear}"/><stop offset="1" stop-color="${dark ? c.black : c.ear}"/></radialGradient>
    <pattern id="${u}-mesh" width="3" height="3" patternUnits="userSpaceOnUse"><rect width="3" height="3" fill="#3a3a44"/><circle cx="1.5" cy="1.5" r=".8" fill="#8a8a96"/></pattern>
  </defs>`;
  const furFill = `url(#${u}-fur)`;
  const blkFill = `url(#${u}-blk)`;

  // tail (behind the body)
  const tailD = 'M132 170C150 168 160 150 156 132C153 118 146 108 150 98C138 104 132 118 134 132C135 146 126 156 118 162Z';
  const tail = dark
    ? `<path d="${tailD}" fill="${blkFill}"/><path d="${fluff(150, 103, 10, 9, 8, 2.2)}" fill="${c.fur}"/>`
    : `<path d="${tailD}" fill="${furFill}" stroke="${c.shade}" stroke-width="1.6"/><path d="${fluff(150, 104, 11, 10, 8, 2.4)}" fill="${c.fur}" stroke="${c.shade}" stroke-width="1.2"/>`;

  // body
  const bodyD = fluff(100, 158, 42, 33, 14, 3.2, 0.2);
  const body = dark
    ? `<path d="${bodyD}" fill="${blkFill}"/><path d="${fluff(100, 164, 27, 28, 12, 2.6)}" fill="${furFill}"/>`
    : `<path d="${bodyD}" fill="${furFill}" stroke="${c.shade}" stroke-width="1.6"/>`;
  const hind = [68, 132].map((x) => `<ellipse cx="${x}" cy="186" rx="15" ry="8.5" fill="${c.fur}" stroke="${c.shade}" stroke-width="1.5"/>`).join('');

  // ears
  const ear = (side) => {
    const col = dark ? blkFill : c.ear;
    const tan = dark ? '' : `<path d="${earTanPath(side)}" fill="${c.earTan}"/>`;
    const fringe = `<path d="${side === 'l' ? 'M34 118Q40 128 48 130Q44 136 52 138' : mirrorX('M34 118Q40 128 48 130Q44 136 52 138')}" fill="none" stroke="${dark ? c.black2 : '#5a4232'}" stroke-width="2" stroke-linecap="round"/>`;
    const o = side === 'l' ? '62 64' : '138 64';
    return `<g transform="rotate(${side === 'l' ? earRot : -earRot} ${o})"><g class="mc-ear-${side}"><path d="${earPath(side)}" fill="${col}"/>${tan}${fringe}</g></g>`;
  };

  // head
  const headD = fluff(100, 88, 55, 51, 20, 3.4);
  let face;
  if (dark) {
    face = `<path d="${headD}" fill="${blkFill}"/>
      <path d="M92 90C90 72 90 54 93 38Q100 30 107 38C110 54 110 72 108 90Z" fill="${c.fur}"/>
      <path d="${fluff(100, 118, 40, 22, 14, 2.6)}" fill="${furFill}"/>
      <path d="M78 128Q100 146 122 128Q112 144 100 146Q88 144 78 128Z" fill="${c.beard}"/>`;
  } else {
    face = `<path d="${headD}" fill="${furFill}" stroke="${c.shade}" stroke-width="1.6"/>
      <ellipse cx="100" cy="54" rx="40" ry="20" fill="${c.cream}" opacity=".45"/>
      <path d="${fluff(100, 44, 22, 10, 10, 1.8)}" fill="${c.cream}" opacity=".5"/>
      <ellipse cx="80" cy="90" rx="15" ry="13" fill="${c.patch}" opacity=".85"/><ellipse cx="120" cy="90" rx="15" ry="13" fill="${c.patch}" opacity=".85"/>
      <path d="${fluff(100, 118, 38, 21, 14, 2.4)}" fill="${c.fur}" stroke="${c.shade}" stroke-width="1.2"/>`;
  }
  const nose = `<path d="M92 103Q100 97 108 103Q106 110 100 111Q94 110 92 103Z" fill="${c.nose}"/><ellipse cx="97" cy="102" rx="2.6" ry="1.5" fill="#fff" opacity=".7"/><path d="M100 111V114" stroke="${c.nose}" stroke-width="1.8"/>`;
  const blush = ['joy', 'proud', 'surprise'].includes(expr)
    ? `<ellipse cx="70" cy="110" rx="8" ry="4.5" fill="#ff8fa8" opacity=".55"/><ellipse cx="130" cy="110" rx="8" ry="4.5" fill="#ff8fa8" opacity=".55"/>`
    : '';

  // accessory (under the chin)
  const acc = dark
    ? `<g class="mc-acc"><path d="M100 146L82 137V157Z" fill="${c.accent}"/><path d="M100 146L118 137V157Z" fill="${c.accent}"/><path d="M100 146L82 137V157Z M100 146L118 137V157Z" fill="none" stroke="${c.accent2}" stroke-width="1.6"/><rect x="95" y="140.5" width="10" height="11" rx="3" fill="${c.accent2}"/></g>`
    : `<g class="mc-acc"><path d="M70 138Q100 150 130 138L118 148Q108 170 100 172Q92 170 82 148Z" fill="${c.accent}"/><path d="M70 138Q100 150 130 138" fill="none" stroke="${c.accent2}" stroke-width="3" stroke-linecap="round"/><circle cx="90" cy="156" r="2" fill="#fff" opacity=".85"/><circle cx="104" cy="160" r="2" fill="#fff" opacity=".85"/><circle cx="110" cy="150" r="1.6" fill="#fff" opacity=".85"/></g>`;

  const label = title ?? `${MC_NAMES[who]} (${expr}, ${ps})`;
  return `<svg class="mc-svg" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label}" data-mc="${who}" data-expression="${expr}" data-pose="${ps}">${defs}
  <ellipse cx="100" cy="193" rx="62" ry="6" fill="#000" opacity=".12"/>
  <g class="mc-tail-wrap"><g class="mc-tail">${tail}</g></g>
  <g class="mc-breath">${body}${hind}</g>
  <g transform="translate(0 ${lift}) rotate(${tilt} 100 120)"><g class="mc-headbob">${ear('l')}${ear('r')}${face}${eyes(expr, c, dark)}${brows(expr, c, dark)}${nose}${mouth(who, expr, c)}${blush}</g></g>
  ${acc}
  <g class="mc-paws">${paws(who, ps, c).replaceAll('MID', u)}</g>
  ${fx(expr, c)}
</svg>`;
}

// ---------- DOM ----------

/** Generated art for an MC state (pose > expression > neutral), or null. */
export function mcArt(id, { expression = 'neutral', pose = 'idle' } = {}, find = findAsset) {
  const base = find({ kind: 'mc', mc: id, expression: 'neutral' });
  if (!base) return null; // no art set yet → SVG everywhere (never mix art and SVG for one dog)
  if (pose && pose !== 'idle') {
    const p = find({ kind: 'mc', mc: id, pose });
    if (p) return p;
  }
  return find({ kind: 'mc', mc: id, expression }) ?? base;
}

/**
 * MC element. `size` = CSS px (square box); null/0 → `--mc-size` inherited from CSS.
 * @returns {HTMLElement & {setState(s: {expression?, pose?}): void, talk(): void}}
 */
export function renderMc(id, { expression = 'neutral', pose = 'idle', size = 96, find = findAsset } = {}) {
  const el = document.createElement('div');
  el.className = `mc mc-${id}`;
  el.dataset.mc = id;
  if (size) el.style.setProperty('--mc-size', `${size}px`); // else inherited from the container's CSS
  let state = { expression, pose };
  let broken = false;
  const paint = () => {
    const art = broken ? null : mcArt(id, state, find);
    el.dataset.expression = state.expression;
    el.dataset.pose = state.pose;
    el.dataset.source = art ? 'art' : 'svg';
    if (art) {
      el.innerHTML = `<img class="mc-img" src="${art.url}" alt="${MC_NAMES[id] ?? ''}" decoding="async" draggable="false">`;
      el.querySelector('img').addEventListener('error', () => {
        broken = true;
        paint();
      });
    } else el.innerHTML = mcSvg(id, state);
  };
  paint();
  el.setState = (s = {}) => {
    const next = { expression: s.expression ?? state.expression, pose: s.pose ?? state.pose };
    if (next.expression === state.expression && next.pose === state.pose) return;
    state = next;
    paint();
  };
  el.talk = () => {
    el.classList.remove('talking');
    void el.offsetWidth;
    el.classList.add('talking');
  };
  return el;
}

/**
 * Both MCs side by side + one speech bubble above whoever speaks.
 * @param {{ids?: string[], size?: number, className?: string}} opts
 */
export function createMcBooth({ ids = MC_IDS, size = 72, className = '' } = {}) {
  const el = document.createElement('div');
  el.className = `mc-booth ${className}`.trim();
  el.classList.toggle('duo', ids.length > 1);
  if (size) el.style.setProperty('--mc-size', `${size}px`); // 0/null → size from the container's CSS
  const bubble = document.createElement('div');
  bubble.className = 'mc-bubble';
  bubble.hidden = true;
  bubble.innerHTML = '<b class="mc-bubble-name"></b><span class="mc-bubble-text"></span>';
  const row = document.createElement('div');
  row.className = 'mc-row';
  const dogs = {};
  for (const id of ids) {
    const d = renderMc(id, { size: null });
    dogs[id] = d;
    row.appendChild(d);
  }
  el.append(bubble, row);
  const booth = {
    el,
    dogs,
    say({ speaker, line, expression, pose } = {}) {
      const d = dogs[speaker];
      if (!d) return false;
      d.setState({ expression: expression ?? 'neutral', pose: pose ?? 'idle' });
      d.talk();
      for (const [k, o] of Object.entries(dogs)) o.classList.toggle('speaking', k === speaker);
      bubble.hidden = false;
      bubble.dataset.speaker = speaker;
      bubble.classList.toggle('right', ids.indexOf(speaker) > 0 && ids.length > 1);
      bubble.querySelector('.mc-bubble-name').textContent = MC_NAMES[speaker] ?? '';
      bubble.querySelector('.mc-bubble-text').textContent = line ?? '';
      bubble.classList.remove('pop');
      void bubble.offsetWidth;
      bubble.classList.add('pop');
      return true;
    },
    clear() {
      bubble.hidden = true;
      for (const o of Object.values(dogs)) o.classList.remove('speaking');
    },
  };
  return booth;
}

/** Speakers used by a script, in MC order (a single-line script shows only that dog). */
export const mcSpeakers = (lines = []) => MC_IDS.filter((id) => lines.some((l) => l?.speaker === id));

/**
 * Play MC lines one after another on a booth. Resolves after the last line has been shown for `hold` ms
 * (or right away when `cancelled()` turns true). `onLine(line, i)` fires per line (sound, text box…).
 */
export function playMcScript(booth, lines = [], { gap = 1200, hold = 1400, delay = 0, onLine, cancelled = () => false, perChar = 45 } = {}) {
  return new Promise((resolve) => {
    let i = 0;
    const step = () => {
      if (cancelled()) return resolve(false);
      const l = lines[i];
      if (!l) return setTimeout(() => resolve(!cancelled()), hold);
      booth.say(l);
      onLine?.(l, i);
      i++;
      // longer lines stay up a little longer
      setTimeout(step, Math.max(gap, Math.min(3200, (l.line?.length ?? 0) * perChar)));
    };
    setTimeout(step, delay);
  });
}

/** Duration estimate of a script (ms) — used to stretch cut-in auto-advance. */
export function mcScriptMs(lines = [], { gap = 1200, hold = 1400, delay = 0, perChar = 45 } = {}) {
  return delay + hold + lines.reduce((s, l) => s + Math.max(gap, Math.min(3200, (l?.line?.length ?? 0) * perChar)), 0);
}

// ---------- client-side line picking (lobby greeting, result fallback when the state has no `result.mc`) ----------

/** 32-bit FNV-1a (same as the server's hashSeed). */
export function mcHash(...parts) {
  let h = 0x811c9dc5;
  const s = parts.map((p) => String(p ?? '')).join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const fill = (t, vars) => String(t ?? '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null && vars[k] !== '' ? String(vars[k]) : m));

/**
 * Lines of a situation from `/api/meta.mc` ({situations, lines}) — mirrors the server's pickMcLines.
 * @param {{situations: object, lines: object}} mc
 * @returns {{speaker, line, expression, pose}[]}
 */
export function mcLinesFrom(mc, key, { duo = false, speaker = null, vars = {}, seed = 0 } = {}) {
  const pool = mc?.lines?.[key];
  const sit = mc?.situations?.[key];
  if (!pool || !sit) return [];
  let r = mcHash(seed, key, duo ? 'duo' : speaker ?? '');
  const pick = (n) => {
    r = mcHash(r, n);
    return n ? r % n : 0;
  };
  const entry = (e, who) => {
    const x = typeof e === 'string' ? { t: e } : e ?? {};
    const s = x.s ?? who;
    const def = sit[s] ?? {};
    return {
      speaker: s,
      line: fill(x.t, vars),
      expression: MC_EXPRESSIONS.includes(x.e) ? x.e : def.expression ?? 'neutral',
      pose: MC_POSES.includes(x.p) ? x.p : def.pose ?? 'idle',
    };
  };
  if (duo && pool.duo?.length) return pool.duo[pick(pool.duo.length)].map((d) => entry(d, d.s));
  const who = MC_IDS.includes(speaker) ? speaker : MC_IDS.includes(sit.lead) ? sit.lead : MC_IDS[pick(2)];
  const list = pool[who] ?? [];
  return list.length ? [entry(list[pick(list.length)], who)] : [];
}

/** Result show lines (intro → winner → last → penalty), like the server's gameOver `mc`. */
export function resultMcFrom(mc, ranking = [], { seed = 0, won = (n) => `${n}만원` } = {}) {
  const out = [];
  const add = (part, list) => out.push(...list.map((l) => ({ ...l, part })));
  add('intro', mcLinesFrom(mc, 'resultIntro', { duo: true, seed }));
  const first = ranking[0];
  if (first) add('winner', mcLinesFrom(mc, 'resultWinner', { duo: true, seed, vars: { name: first.name, amount: won(first.total ?? 0) } }));
  const last = ranking.length > 1 ? ranking.at(-1) : null;
  if (last) {
    add('last', mcLinesFrom(mc, 'resultLast', { seed, vars: { name: last.name } }));
    add('penalty', mcLinesFrom(mc, 'penalty', { seed, speaker: 'bomi', vars: { name: last.name } }));
  }
  return out;
}

// ---------- board corner: MC lines that are not part of a cut-in ----------

/**
 * Small MC booth fixed at the bottom-right of the game screen. `say(lines)` queues a script; each one waits for
 * `whenFree()` (e.g. cut-ins idle) and never blocks the game. `onLine(line)` for sound.
 */
export function createMcCorner(root, { whenFree = () => Promise.resolve(), onLine = null, maxQueue = 3 } = {}) {
  const host = document.createElement('div');
  host.className = 'mc-corner';
  host.hidden = true;
  host.setAttribute('aria-live', 'polite');
  root.appendChild(host);
  const q = [];
  let running = false;
  let destroyed = false;
  async function pump() {
    if (running) return;
    running = true;
    while (q.length && !destroyed) {
      const lines = q.shift();
      await whenFree();
      if (destroyed) break;
      const booth = createMcBooth({ ids: mcSpeakers(lines), size: 0 }); // size from CSS (.mc-corner)
      host.replaceChildren(booth.el);
      host.classList.remove('leaving');
      host.hidden = false;
      await playMcScript(booth, lines, { gap: 1300, hold: 1500, onLine, cancelled: () => destroyed });
      host.classList.add('leaving');
      await new Promise((r) => setTimeout(r, 300));
      host.hidden = true;
    }
    running = false;
  }
  return {
    element: host,
    say(lines) {
      if (!lines?.length || destroyed) return;
      if (q.length >= maxQueue) q.shift(); // backlog → drop the oldest
      q.push(lines);
      pump();
    },
    busy: () => running || q.length > 0,
    clear() {
      q.length = 0;
    },
    destroy() {
      destroyed = true;
      q.length = 0;
      host.remove();
    },
  };
}
