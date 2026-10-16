// 세계 설정 art (string builders, no DOM; node-tested in test/client-world.test.js): the four silly-cute chibi chimeras of
// 토벌 (facing left = towards the character on the cut-in stage), the hunt battle card and the 풀뽑기 field card (cut-in
// options and the 2D decision sheet), the 쿠지 box / tickets, the 검정 stamp + grade badge and the SVG scenes of the
// 🐹 치이카와 모드 (풀밭 · 토벌 숲 · 라멘 가게 「郎」 · 쿠지 가게). Generated art wins when accepted:
// `findAsset({kind: 'item', monster: id})` (monster icons), `findAsset({kind: 'bg', scene})` (backgrounds).
import { esc } from '../format.js';
import { KUJI_RANKS, huntPrompt, monsterInfo, weedGrade, weedPrompt, WEED_MAX } from '../shared/worldPlay.js';

/** Scenes drawn here (their own SVG wins over a sceneFallbacks background until the bg art is accepted). */
export const WORLD_SCENES = ['weed-field', 'hunt-forest', 'ramen-shop', 'kuji'];

const LINE = '#3d2b52';
const sw = (w = 5) => `stroke="${LINE}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
const eye = (x, y, r, look = -0.35) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" ${sw(4)}/><circle cx="${x + r * look}" cy="${y + r * 0.1}" r="${r * 0.5}" fill="${LINE}"/><circle cx="${x + r * look - r * 0.18}" cy="${y - r * 0.15}" r="${r * 0.17}" fill="#fff"/>`;
const blush = (x, y, r = 9) => `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 0.6}" fill="#ff8fb1" opacity=".75"/>`;

/** Body art of each chimera (viewBox 0 0 200 180, standing on y ≈ 170, facing left). */
const MONSTER_BODY = {
  // 꼬마 키메라: a little lavender caterpillar-slug with googly eyes and two tiny teeth
  small_chimera: () =>
    `<ellipse cx="104" cy="168" rx="70" ry="8" fill="#000" opacity=".12"/>` +
    [150, 128, 106].map((x, i) => `<circle cx="${x}" cy="${128 - i * 4}" r="${28 - i * 2}" fill="${i % 2 ? '#c9a3ea' : '#b48ad8'}" ${sw()}/>`).join('') +
    `<ellipse cx="80" cy="122" rx="40" ry="38" fill="#b48ad8" ${sw()}/>` +
    `<path d="M70 86 L64 66 L80 82" fill="#ffd23f" ${sw(4)}/><path d="M92 86 L98 68 L104 86" fill="#ffd23f" ${sw(4)}/>` +
    eye(64, 112, 13) + eye(92, 110, 11) + blush(56, 134) +
    `<path d="M50 140 Q62 152 76 141" fill="#7a3b62" ${sw(4)}/><path d="M57 143 l3 6 l3 -5 M66 145 l3 5 l3 -6" fill="#fff" stroke="none"/>` +
    [70, 100, 128, 152].map((x) => `<ellipse cx="${x}" cy="158" rx="9" ry="6" fill="#9a6ec2" ${sw(3.5)}/>`).join(''),
  // 키메라: a round purple chimera with two horns, a fang grin, a back spike row and a curly tail
  chimera: () =>
    `<ellipse cx="100" cy="170" rx="68" ry="8" fill="#000" opacity=".12"/>` +
    `<path d="M150 120 Q190 112 184 84 Q178 66 166 78 Q176 92 156 104" fill="#7c4fa6" ${sw()}/>` +
    [0, 1, 2, 3].map((i) => `<path d="M${118 + i * 16} ${62 + i * 9} l14 -18 l6 22" fill="#ff8a3d" ${sw(4)}/>`).join('') +
    `<ellipse cx="102" cy="114" rx="66" ry="56" fill="#8e5bb5" ${sw()}/><ellipse cx="88" cy="134" rx="36" ry="28" fill="#c7a6e6"/>` +
    `<path d="M66 64 Q52 34 70 40 Q72 54 80 62" fill="#fff4d6" ${sw(4)}/><path d="M104 60 Q110 30 124 42 Q114 50 116 62" fill="#fff4d6" ${sw(4)}/>` +
    eye(66, 96, 15) + eye(102, 92, 13) + blush(52, 122) + blush(118, 116, 7) +
    `<path d="M44 124 Q70 154 100 126 Q72 138 44 124Z" fill="#6b2350" ${sw(4)}/><path d="M54 128 l5 10 l5 -8 M84 130 l5 9 l5 -10" fill="#fff" stroke="none"/>` +
    `<ellipse cx="72" cy="166" rx="16" ry="9" fill="#7c4fa6" ${sw(4)}/><ellipse cx="128" cy="166" rx="16" ry="9" fill="#7c4fa6" ${sw(4)}/>`,
  // 커다란 키메라: a tall orange dino-ish chimera with a spiky back, a big jaw and tiny arms
  big_chimera: () =>
    `<ellipse cx="104" cy="171" rx="76" ry="8" fill="#000" opacity=".14"/>` +
    `<path d="M150 150 Q196 150 192 118 Q170 132 152 128" fill="#c96f34" ${sw()}/>` +
    [0, 1, 2, 3, 4].map((i) => `<path d="M${112 + i * 12} ${22 + i * 22} l20 -6 l-6 20" fill="#2fa38a" ${sw(4)}/>`).join('') +
    `<path d="M60 168 L58 110 Q56 40 104 26 Q150 20 152 80 L156 168 Z" fill="#e08a4b" ${sw()}/><path d="M74 168 L72 112 Q78 82 104 84 Q130 86 134 120 L136 168Z" fill="#ffe0b8"/>` +
    `<path d="M40 78 Q36 56 66 52 L104 54 Q110 72 92 84 Q64 92 40 78Z" fill="#e08a4b" ${sw()}/>` +
    `<path d="M42 78 Q66 98 96 82" fill="#7a2e1a" ${sw(4)}/>${[48, 60, 72, 84].map((x) => `<path d="M${x} 80 l4 8 l4 -7" fill="#fff" stroke="none"/>`).join('')}` +
    eye(70, 46, 12) + eye(96, 42, 11) + blush(56, 66, 7) +
    `<path d="M66 112 q-16 4 -18 16" fill="none" ${sw(8)}/><path d="M66 112 q-16 4 -18 16" fill="none" stroke="#e08a4b" stroke-width="4" stroke-linecap="round"/>` +
    `<ellipse cx="78" cy="168" rx="18" ry="9" fill="#c96f34" ${sw(4)}/><ellipse cx="136" cy="168" rx="18" ry="9" fill="#c96f34" ${sw(4)}/>`,
  // 데카츠요: the giant boss — dark indigo, a crown of horns, three glowing eyes, a huge silly grin, tiny bat wings
  dekatsuyo: () =>
    `<ellipse cx="100" cy="171" rx="86" ry="9" fill="#000" opacity=".18"/>` +
    `<path d="M150 70 Q196 40 196 86 Q182 76 172 92 Q166 80 152 90" fill="#2c2350" ${sw()}/><path d="M50 70 Q18 44 14 82 Q28 74 34 90 Q40 80 50 88" fill="#2c2350" ${sw()}/>` +
    `<path d="M24 168 Q14 70 100 48 Q186 70 176 168 Z" fill="#4a3a6b" ${sw()}/><path d="M56 168 Q56 110 100 104 Q144 110 144 168Z" fill="#6c5a92"/>` +
    [[56, 58, -14], [80, 46, -6], [104, 42, 4], [128, 48, 12], [148, 60, 20]].map(([x, y, r]) => `<path d="M${x - 9} ${y + 8} L${x} ${y - 24} L${x + 9} ${y + 8}Z" fill="#ffd23f" ${sw(4)} transform="rotate(${r} ${x} ${y})"/>`).join('') +
    eye(64, 92, 13, -0.4).replace(/fill="#fff"/, 'fill="#fff3a0"') + eye(100, 84, 15, -0.3).replace(/fill="#fff"/, 'fill="#fff3a0"') + eye(134, 92, 12, -0.3).replace(/fill="#fff"/, 'fill="#fff3a0"') +
    `<path d="M40 116 Q100 168 160 116 Q100 132 40 116Z" fill="#8f1d3a" ${sw(4)}/>${[52, 68, 84, 100, 116, 132, 148].map((x, i) => `<path d="M${x - 6} ${118 + Math.abs(3 - i) * -1.5 + (i === 0 || i === 6 ? -2 : 4)} l6 11 l6 -10" fill="#fff" stroke="none"/>`).join('')}` +
    blush(46, 112, 9) + blush(154, 112, 9) +
    `<ellipse cx="62" cy="168" rx="22" ry="10" fill="#2c2350" ${sw(4)}/><ellipse cx="138" cy="168" rx="22" ry="10" fill="#2c2350" ${sw(4)}/>`,
};

/**
 * One chimera as an SVG (viewBox 0 0 200 180, facing left). `mood`: idle (bob) | flee (runs off) | poof (vanishes in a puff) |
 * win (gloats) — CSS classes in public/css/world.css. Unknown ids → the 키메라 body (power-sized).
 */
export function monsterSvg(id, { mood = 'idle', cls = '' } = {}) {
  const body = MONSTER_BODY[id] ?? MONSTER_BODY[['small_chimera', 'chimera', 'big_chimera', 'dekatsuyo'][Math.max(0, Math.min(3, monsterInfo(id).power - 1))]];
  const puff = mood === 'poof' ? `<g class="mon-puff">${[[60, 100, 34], [110, 80, 42], [150, 110, 30], [96, 130, 36]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity=".92"/>`).join('')}</g>` : '';
  const sweat = mood === 'flee' ? `<path class="mon-sweat" d="M150 40 q8 14 0 20 q-8 -6 0 -20Z" fill="#7ec8ff" ${sw(3)}/>` : '';
  return `<svg class="monster-svg mon-${esc(id ?? 'chimera')} mood-${esc(mood)} ${esc(cls)}" viewBox="0 0 200 180" aria-hidden="true"><g class="mon-body">${body()}</g>${sweat}${puff}</svg>`;
}

/** Monster art: the accepted `monster-<id>` item icon (`art` url) else the SVG chimera. */
export function monsterArtHtml(id, { art = null, mood = 'idle', cls = '', name = '' } = {}) {
  return art
    ? `<span class="monster-art img mood-${esc(mood)} ${esc(cls)}"><img src="${esc(art)}" alt="${esc(name)}" decoding="async"></span>`
    : `<span class="monster-art ${esc(cls)}">${monsterSvg(id, { mood })}</span>`;
}

/** ★★☆☆ danger of a monster power (1..4). */
export const powerStars = (power) => '★'.repeat(Math.max(1, Math.min(4, power))) + '☆'.repeat(4 - Math.max(1, Math.min(4, power)));

const chanceMeter = (chance, label = '이길 확률') =>
  chance != null
    ? `<span class="sm-chance" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${chance}" aria-label="${esc(label)}"><i style="width:${Math.min(100, chance)}%"></i><b>${chance}%</b></span>`
    : '';
const attrs = (p, who, o) => `data-choose="${esc(o.id)}" data-prompt="${esc(p.promptId)}" data-char="${esc(who?.id ?? '')}"${o.disabled ? ' disabled' : ''}`;
const whoHead = (p, who) => (who && (p.forCharacterIds?.length > 1 || who.id !== p.charId) ? `<p class="ci-opt-who">${esc(who.name)}의 선택</p>` : '');

/**
 * 토벌 battle card (prompt kind `hunt`): the monster (art + name + ★ danger; `art: false` in the cut-in, whose window shows it),
 * 「⚔️ 싸운다」 (chance meter, reward range, 🔱 / 🛡️ badges) and 「🏃 도망친다」.
 */
export function huntOptionsHtml(p, who, { meta = null, btnClass = 'ci-opt', won = (n) => `${n}만원`, art = true, artFor = () => null } = {}) {
  const v = huntPrompt(p, { meta });
  const m = v.monster;
  const foe = `<div class="hw-foe${art ? '' : ' mini'} danger-${esc(v.danger)}">${art ? monsterArtHtml(m.id, { art: artFor('monster', m.id), name: m.name, cls: 'hw-foe-art' }) : ''}<span class="hw-foe-txt"><b>${esc(m.icon)} ${esc(m.name)}</b><small class="hw-stars" title="위험도">위험도 ${powerStars(m.power)}</small></span></div>`;
  const f = v.fight;
  const fight = f
    ? `<button type="button" class="${esc(btnClass)} hw-opt fight" ${attrs(p, who, f)}><span class="hw-ic" aria-hidden="true">⚔️</span><span class="hw-body"><b>⚔️ 싸운다</b>${chanceMeter(f.chance)}${
        f.reward ? `<small class="hw-reward">💰 이기면 ${esc(won(f.reward[0]))}~${esc(won(f.reward[1]))}</small>` : ''
      }${f.badges.length ? `<span class="hw-badges">${f.badges.map((b) => `<span class="hw-badge">${esc(b.text)}</span>`).join('')}</span>` : ''}${f.disabled && f.desc ? `<small class="sm-desc">${esc(f.desc)}</small>` : ''}</span></button>`
    : '';
  const r = v.run;
  const run = r ? `<button type="button" class="${esc(btnClass)} hw-opt run" ${attrs(p, who, r)}><span class="hw-ic" aria-hidden="true">🏃</span><span class="hw-body"><b>🏃 도망친다</b><small class="sm-desc">${esc(r.desc || '아무 일 없이 도망쳐요')}</small></span></button>` : '';
  const others = v.others.map((o) => `<button type="button" class="${esc(btnClass)} hw-opt" ${attrs(p, who, o)}><span class="hw-body"><b>${esc(o.label ?? o.id)}</b>${o.desc ? `<small class="sm-desc">${esc(o.desc)}</small>` : ''}</span></button>`).join('');
  return `${whoHead(p, who)}<div class="hw-card">${foe}<div class="hw-opts" role="group" aria-label="토벌">${fight}${run}${others}</div></div>`;
}

/** 풀뽑기 검정 ladder: 5급 … 1급 dots (passed = filled). */
export function gradeLadderHtml(level) {
  return `<span class="wd-ladder" aria-label="풀뽑기 검정 ${esc(weedGrade(level))}">${[1, 2, 3, 4, 5]
    .map((l) => `<i class="${l <= level ? 'on' : ''}${l === level + 1 ? ' next' : ''}" title="${WEED_MAX + 1 - l}급">${WEED_MAX + 1 - l}</i>`)
    .join('')}</span>`;
}

/** 풀뽑기 field card (prompt kind `weed`): current grade + ladder, 「🌿 일하기 (+n만원)」 and 「📝 n급 검정 응시」 (chance, fee). */
export function weedOptionsHtml(p, who, { btnClass = 'ci-opt', won = (n) => `${n}만원` } = {}) {
  const v = weedPrompt(p);
  const head = `<div class="wd-head"><span class="wd-cur">🌿 지금 자격: <b>${esc(v.grade)}</b></span>${gradeLadderHtml(v.level)}</div>`;
  const w = v.work;
  const work = w
    ? `<button type="button" class="${esc(btnClass)} wd-opt work" ${attrs(p, who, w)}><span class="hw-ic" aria-hidden="true">🌿</span><span class="hw-body"><b>🌿 풀뽑기 일하기${w.amount ? ` (+${esc(won(w.amount))})` : ''}</b><small class="sm-desc">${esc(w.desc || '풀을 쏙쏙 뽑고 보수를 받아요')}</small></span></button>`
    : '';
  const x = v.exam;
  const exam = x
    ? `<button type="button" class="${esc(btnClass)} wd-opt exam" ${attrs(p, who, x)}><span class="hw-ic" aria-hidden="true">📝</span><span class="hw-body"><b>📝 ${v.maxed ? '검정 응시' : `${esc(x.grade)} 검정 응시`}</b>${v.maxed ? '' : chanceMeter(x.chance, '합격 확률')}${
        v.maxed ? '' : `<small class="wd-fee">${x.free ? '🆓 응시료 무료 (부모님 찬스)' : `💸 응시료 ${esc(won(x.fee))}`}</small>`
      }${x.disabled && x.reason ? `<small class="sm-desc wd-why">${esc(x.reason)}</small>` : ''}</span></button>`
    : '';
  const others = v.others.map((o) => `<button type="button" class="${esc(btnClass)} wd-opt" ${attrs(p, who, o)}><span class="hw-body"><b>${esc(o.label ?? o.id)}</b></span></button>`).join('');
  return `${whoHead(p, who)}<div class="wd-card">${head}<div class="hw-opts" role="group" aria-label="풀뽑기 검정소">${work}${exam}${others}</div></div>`;
}

/** Option cards of a 세계 설정 prompt (hunt / weed), null for other kinds. */
export function worldOptionsHtml(p, who, opts = {}) {
  if (p?.kind === 'hunt') return huntOptionsHtml(p, who, opts);
  if (p?.kind === 'weed') return weedOptionsHtml(p, who, opts);
  return null;
}

/** 검정 stamp: 「합격!」 (red ring) / 「불합격…」 (grey). */
export function passStampHtml(pass, { grade = '' } = {}) {
  return `<span class="wd-stamp ${pass ? 'pass' : 'fail'}" aria-hidden="true"><b>${pass ? '합격!' : '불합격…'}</b>${grade ? `<small>${esc(grade)}</small>` : ''}</span>`;
}

/** Grade badge 「🌿 풀뽑기 4급」 (level 0 = 무자격). */
export function gradeBadgeHtml(level) {
  return `<span class="wd-badge lv-${Math.max(0, Math.min(WEED_MAX, level))}">🌿 풀뽑기 <b>${esc(weedGrade(level))}</b></span>`;
}

/** The kuji ticket box (viewBox 0 0 220 170): a red box with a hand hole and a 「쿠지」 label. */
export function kujiBoxSvg() {
  return `<svg class="kuji-box-svg" viewBox="0 0 220 170" aria-hidden="true"><ellipse cx="110" cy="162" rx="96" ry="7" fill="#000" opacity=".15"/>
    <path d="M24 56 L196 56 L188 158 L32 158 Z" fill="#e2504c" ${sw()}/><path d="M24 56 L50 26 L170 26 L196 56 Z" fill="#ff7a6e" ${sw()}/>
    <ellipse cx="110" cy="40" rx="30" ry="9" fill="#5a1f2b" ${sw(4)}/>
    ${[[70, 34, -18], [146, 30, 14], [96, 22, 6]].map(([x, y, r]) => `<rect x="${x - 9}" y="${y - 14}" width="18" height="22" rx="3" fill="#fff4d6" ${sw(3)} transform="rotate(${r} ${x} ${y})"/>`).join('')}
    <rect x="56" y="84" width="108" height="46" rx="12" fill="#fff4d6" ${sw(4)}/><text x="110" y="118" text-anchor="middle" font-size="30" font-weight="900" fill="#e2504c" font-family="system-ui,sans-serif">쿠지</text>
    ${[40, 180].map((x) => `<circle cx="${x}" cy="108" r="7" fill="#ffd23f" ${sw(3)}/>`).join('')}</svg>`;
}

/**
 * One drawn ticket (flip card): back = folded ticket, front = the rank (1등 … 꽝) with its icon. `delay` (ms) staggers the peel.
 */
export function kujiTicketHtml(row, { delay = 0 } = {}) {
  const r = KUJI_RANKS[row?.rank] ?? KUJI_RANKS[5];
  return `<span class="kuji-ticket rank-${esc(row?.rank ?? 5)}${row?.jackpot ? ' jackpot' : ''}${row?.won ? ' won' : ''}" style="--d:${Math.max(0, Math.round(delay))}ms;--kc:${esc(row?.color ?? r.color)}"><span class="kt-in"><span class="kt-back">🎟️</span><span class="kt-front"><i>${esc(row?.icon ?? r.icon)}</i><b>${esc(row?.label ?? r.label)}</b></span></span></span>`;
}

/** Big 1등 prize (the plush) for the window: 🧸 + ✨. */
export const kujiPlushHtml = (title = '커다란 치이카와 인형') => `<div class="kuji-plush" aria-hidden="true"><span class="kp-glow"></span><span class="kp-toy">🧸</span><b class="kp-name">${esc(title)}</b></div>`;

// ---------- scenes (viewBox 1600×900, drawn over the tone sky by cutin2d) ----------

/** Body of a 치이카와 모드 scene SVG; null for other scenes. */
export function worldSceneBody(scene) {
  switch (scene) {
    case 'weed-field': {
      // 풀밭: rolling meadow, a wooden fence, tufts of weeds, a basket and a little 검정소 sign
      const tufts = [...Array(22).keys()].map((i) => {
        const x = 40 + ((i * 173) % 1540);
        const y = 640 + ((i * 59) % 220);
        const s = 0.7 + (i % 4) * 0.18;
        return `<path d="M${x} ${y} q${-14 * s} ${-40 * s} ${-26 * s} ${-52 * s} q${20 * s} ${12 * s} ${26 * s} ${40 * s} q${4 * s} ${-36 * s} ${18 * s} ${-58 * s} q${2 * s} ${30 * s} ${-6 * s} ${58 * s} q${18 * s} ${-26 * s} ${38 * s} ${-34 * s} q${-16 * s} ${18 * s} ${-24 * s} ${46 * s}Z" fill="${i % 3 ? '#4f9a40' : '#6cc070'}"/>`;
      }).join('');
      const fence = [...Array(14).keys()].map((i) => `<rect x="${60 + i * 120}" y="470" width="22" height="110" rx="6" fill="#c69c6d" stroke="#8a6b4a" stroke-width="4"/>`).join('');
      return `<path d="M0 470 Q400 400 800 450 T1600 430 L1600 900 L0 900 Z" fill="#a5d672"/><path d="M0 560 Q500 500 1000 560 T1600 540 L1600 900 L0 900 Z" fill="#8cc35a"/>
        <rect x="0" y="500" width="1600" height="16" fill="#c69c6d"/><rect x="0" y="546" width="1600" height="14" fill="#c69c6d"/>${fence}${tufts}
        <g><rect x="1260" y="300" width="18" height="230" fill="#8a6b4a"/><rect x="1110" y="250" width="320" height="96" rx="14" fill="#fff4d6" stroke="#8a6b4a" stroke-width="8"/>
        <text x="1270" y="312" text-anchor="middle" font-size="44" font-weight="900" fill="#4f9a40" font-family="system-ui,sans-serif">풀뽑기 검정소</text></g>
        <g><path d="M300 690 L420 690 L404 790 L316 790Z" fill="#d9b27a" stroke="#8a6b4a" stroke-width="6"/>${[715, 740, 765].map((y) => `<path d="M306 ${y} L414 ${y}" stroke="#a8814f" stroke-width="5"/>`).join('')}
        <path d="M330 690 q-10 -50 -30 -64 M360 690 q0 -60 10 -76 M392 690 q14 -46 34 -56" stroke="#4f9a40" stroke-width="10" fill="none" stroke-linecap="round"/></g>
        <circle cx="1450" cy="130" r="70" fill="#fff3a0"/>`;
    }
    case 'hunt-forest': {
      // 토벌 숲: deep green forest, tall trunks, mushrooms, glowing eyes in the bushes, a 「토벌 구역」 sign
      const trunks = [[120, 70], [360, 90], [620, 60], [1000, 84], [1260, 70], [1480, 96]].map(([x, w]) => `<rect x="${x}" y="120" width="${w}" height="640" fill="#5b3b25"/><circle cx="${x + w / 2}" cy="160" r="${w * 2.1}" fill="#2f6b3a"/><circle cx="${x + w / 2 - w}" cy="220" r="${w * 1.5}" fill="#3c7d45"/>`).join('');
      const bushes = [[200, 700], [560, 730], [880, 690], [1180, 720], [1500, 700]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="150" ry="80" fill="#2e6436"/>`).join('');
      const eyes = [[540, 712], [1170, 704]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="11" fill="#fff3a0"/><circle cx="${x + 34}" cy="${y - 2}" r="11" fill="#fff3a0"/>`).join('');
      const shrooms = [[300, 790], [760, 812], [1360, 800]].map(([x, y]) => `<rect x="${x - 8}" y="${y - 30}" width="16" height="34" fill="#f4e6c8"/><path d="M${x - 34} ${y - 26} Q${x} ${y - 70} ${x + 34} ${y - 26}Z" fill="#e2504c"/><circle cx="${x - 10}" cy="${y - 44}" r="6" fill="#fff"/><circle cx="${x + 12}" cy="${y - 38}" r="5" fill="#fff"/>`).join('');
      return `<rect width="1600" height="900" fill="#9ccf9a" opacity=".55"/><rect y="0" width="1600" height="420" fill="#cfe9c8" opacity=".5"/>${trunks}
        <rect y="720" width="1600" height="180" fill="#5f8f4a"/><path d="M640 900 L760 720 L860 720 L980 900Z" fill="#c9a36a"/>${bushes}${eyes}${shrooms}
        <g><rect x="140" y="560" width="16" height="190" fill="#8a6b4a"/><rect x="30" y="520" width="250" height="80" rx="10" fill="#fff4d6" stroke="#8a6b4a" stroke-width="7"/>
        <text x="155" y="574" text-anchor="middle" font-size="36" font-weight="900" fill="#c0392b" font-family="system-ui,sans-serif">⚔ 토벌 구역</text></g>`;
    }
    case 'ramen-shop': {
      // 라멘 가게 「郎」: yellow noren curtains with 郎, a wooden counter, steaming bowls
      const noren = [0, 1, 2, 3].map((i) => `<path d="M${470 + i * 165} 140 L${625 + i * 165} 140 L${625 + i * 165} 360 Q${590 + i * 165} 344 ${547 + i * 165} 360 Q${505 + i * 165} 344 ${470 + i * 165} 360Z" fill="#ffd23f" stroke="#7a5a12" stroke-width="6"/><text x="${547 + i * 165}" y="292" text-anchor="middle" font-size="108" font-weight="900" fill="#2d2a32" font-family="'Noto Serif CJK JP','Noto Sans CJK JP',serif">郎</text>`).join('');
      const bowls = [520, 800, 1080].map((x) => `<ellipse cx="${x}" cy="640" rx="96" ry="26" fill="#fff"/><path d="M${x - 96} 640 Q${x - 90} 720 ${x} 724 Q${x + 90} 720 ${x + 96} 640Z" fill="#e2504c"/><ellipse cx="${x}" cy="642" rx="84" ry="18" fill="#f4d58d"/><path d="M${x - 30} 600 q-14 -30 4 -60 M${x + 6} 596 q-14 -34 6 -68 M${x + 40} 600 q-12 -30 6 -58" stroke="#fff" stroke-width="10" fill="none" stroke-linecap="round" opacity=".8"/>`).join('');
      return `<rect width="1600" height="900" fill="#f6e2c2"/><rect y="0" width="1600" height="130" fill="#3b2a1c"/><rect x="420" y="110" width="760" height="40" rx="8" fill="#7a5a12"/>${noren}
        ${[0, 1, 2, 3, 4].map((i) => `<circle cx="${180 + i * 310}" cy="70" r="26" fill="#ff7a5c"/><rect x="${174 + i * 310}" y="20" width="12" height="30" fill="#2d2a32"/>`).join('')}
        <rect y="600" width="1600" height="300" fill="#a0522d"/><rect y="580" width="1600" height="40" fill="#c97b4a"/>${bowls}
        <rect x="120" y="420" width="220" height="160" rx="10" fill="#fff4d6" stroke="#7a5a12" stroke-width="6"/><text x="230" y="500" text-anchor="middle" font-size="38" font-weight="900" fill="#c0392b" font-family="system-ui,sans-serif">라멘</text><text x="230" y="550" text-anchor="middle" font-size="30" font-weight="800" fill="#7a5a12" font-family="system-ui,sans-serif">곱빼기!</text>`;
    }
    case 'kuji': {
      // 쿠지 가게: a striped awning, the prize shelf (the 1등 plush on top, prizes 2–4) and the counter; the ticket box
      // itself is drawn by the cut-in panel (kujiBoxSvg) — the upper middle stays calm for it
      const prizes = [['🧸', 1], ['🎁', 2], ['🃏', 3], ['🍜', 4]].map(([ic, r], i) => {
        const x = 130 + i * 380;
        const big = r === 1;
        return `<g><rect x="${x}" y="${big ? 470 : 500}" width="${big ? 240 : 200}" height="${big ? 210 : 180}" rx="16" fill="#fff" stroke="#e2504c" stroke-width="6"/><text x="${x + (big ? 120 : 100)}" y="${big ? 610 : 620}" text-anchor="middle" font-size="${big ? 140 : 100}" font-family="system-ui,sans-serif">${ic}</text><rect x="${x + (big ? 70 : 50)}" y="660" width="100" height="40" rx="10" fill="#e2504c"/><text x="${x + (big ? 120 : 100)}" y="690" text-anchor="middle" font-size="28" font-weight="900" fill="#fff" font-family="system-ui,sans-serif">${r}등</text></g>`;
      }).join('');
      return `<rect width="1600" height="900" fill="#fff1e6"/><rect y="0" width="1600" height="110" fill="#e2504c"/>${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<path d="M${i * 200} 110 q100 64 200 0" fill="${i % 2 ? '#fff' : '#ffc2b8'}"/>`).join('')}
        <text x="800" y="80" text-anchor="middle" font-size="62" font-weight="900" fill="#fff" font-family="system-ui,sans-serif">쿠지 가게</text>
        ${[0, 1, 2, 3, 4, 5].map((i) => `<circle cx="${150 + i * 260}" cy="${230 + (i % 2) * 40}" r="16" fill="${['#ffd23f', '#ff8fb1', '#7ec8e3'][i % 3]}" opacity=".7"/>`).join('')}
        <rect x="80" y="700" width="1440" height="20" fill="#b7793f"/>${prizes}
        <rect y="760" width="1600" height="140" fill="#e9c79a"/><rect y="740" width="1600" height="26" fill="#c98b4f"/>`;
    }
    default:
      return null;
  }
}
