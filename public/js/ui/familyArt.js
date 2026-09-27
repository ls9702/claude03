// Stage 8 romance / family markup (string builders, node-tested in test/client-family.test.js). Portraits are
// `portraitHtml` slots → call `hydratePortraits(root)` after inserting the markup (composed art replaces the SVG).
//
//   meetOptionsHtml(p, who, …)    → 만남: two candidate cards (portrait, trait, ★) with 「만나기」 + 「패스」
//   dateOptionsHtml(p, who, …)    → 데이트: options with cost + ❤️ gain
//   proposeOptionsHtml(p, who, …) → 프러포즈: chance % meter + 「프러포즈」 / 「조금 더 기다리기」
//   familyOptionsHtml(p, who, …)  → one of the above by `p.kind` (null for other prompts)
//   partnerCardHtml(info)         → partner / spouse card (portrait · trait · ★ · salary)
//   familyDetailHtml(character)   → side-list detail rows: ❤️ bar, spouse, children, house
import { esc, won as wonFmt } from '../format.js';
import { portraitHtml } from './avatar2d.js';
import { affectionInfo, childLook, dateOptions, familyOf, houseOf, marketInfo, meetOptions, npcCharacter, proposeOptions } from '../shared/family.js';
import { houseArtHtml } from './houseArt.js';
import { optionLabel } from '../shared/growth.js';

const attrs = (p, o, who) => `data-choose="${esc(o.id)}" data-prompt="${esc(p?.promptId ?? '')}" data-char="${esc(who?.id ?? '')}"`;
const passButton = (p, o, who, btnClass, fallback) =>
  o
    ? `<button type="button" class="${btnClass} fam-pass" ${attrs(p, o, who)}><span class="c-icon">${esc(o.icon ?? '🙅')}</span><span class="ci-opt-l">${esc(o.label ? optionLabel(o) : fallback)}${
        o.desc ? `<small class="ci-opt-desc">${esc(o.desc)}</small>` : ''
      }</span></button>`
    : '';

/** Portrait markup of a partner / child spec (SVG → composed on hydrate). */
function npcPortrait(spec, { size = 56, crop = 'bust', avatar = null } = {}) {
  const ch = npcCharacter(spec, { avatar });
  return ch ? portraitHtml(ch, { size, crop, title: ch.name }) : `<span class="fam-noav" style="--s:${size}px">💞</span>`;
}

/** 만남 prompt: candidate cards + pass. */
export function meetOptionsHtml(p, who, { meta = null, btnClass = 'ci-opt' } = {}) {
  const { candidates, pass } = meetOptions(p, { character: who, meta });
  const cards = candidates
    .map(({ option: o, partner: m }) => `<button type="button" class="${btnClass} partner-item" ${attrs(p, o, who)}${o.disabled ? ' disabled' : ''}>
        <span class="pi-portrait">${npcPortrait({ ...m, id: m.id ?? o.partnerId }, { size: 72 })}</span>
        <span class="pi-name">${esc(m.name)}</span>
        <span class="pi-trait">${esc(m.traitIcon)} ${esc(m.traitName)}</span>
        ${m.starsText ? `<span class="pi-stars" aria-label="등급 ${m.stars}">${esc(m.starsText)}</span>` : ''}
        ${o.match || Number(o.salary) > 0 ? `<span class="pi-badges">${o.match ? '<span class="ci-opt-badge heart">💞 찰떡궁합</span>' : ''}${Number(o.salary) > 0 ? `<span class="ci-opt-badge">💼 맞벌이 ${esc(wonFmt(Number(o.salary)))}</span>` : ''}</span>` : ''}
        <span class="pi-go">💘 만나기</span>
      </button>`)
    .join('');
  return `<div class="partner-grid" style="--n:${Math.max(1, Math.min(3, candidates.length))}">${cards}</div>${passButton(p, pass, who, btnClass, '패스')}`;
}

/** 데이트 prompt: cost + ❤️ gain per option. */
export function dateOptionsHtml(p, who, { btnClass = 'ci-opt', won = wonFmt } = {}) {
  const rows = dateOptions(p)
    .map(({ option: o, cost, gain, pass, match }) => {
      const badges = [];
      if (!pass) badges.push(cost > 0 ? `💸 ${won(cost)}` : '💸 무료');
      if (gain != null && gain !== 0) badges.push(`❤️ ${gain > 0 ? '+' : ''}${gain}`);
      if (match) badges.push('🎯 취향 저격!');
      // the server's desc repeats cost / gain → only its extra (disabled reason) is shown next to the badges
      const desc = o.disabled ? (String(o.desc ?? '').split('·').pop().trim() || '지금은 고를 수 없어요') : badges.length ? '' : o.desc ?? '';
      return `<button type="button" class="${btnClass} date-opt${pass ? ' fam-pass' : ''}${o.desc || badges.length ? ' has-desc' : ''}" ${attrs(p, o, who)}${o.disabled ? ' disabled' : ''}>
        <span class="c-icon">${esc(o.icon ?? (pass ? '🙅' : '💑'))}</span><span class="ci-opt-l">${esc(optionLabel(o))}${desc ? `<small class="ci-opt-desc">${esc(desc)}</small>` : ''}${
          badges.length ? `<span class="ci-opt-badges">${badges.map((b) => `<span class="ci-opt-badge${b.startsWith('❤️') || b.startsWith('🎯') ? ' heart' : ''}">${esc(b)}</span>`).join('')}</span>` : ''
        }</span></button>`;
    })
    .join('');
  return `<div class="ci-opt-list date-list">${rows}</div>`;
}

/** 프러포즈 prompt: success chance meter on the propose option. */
export function proposeOptionsHtml(p, who, { btnClass = 'ci-opt' } = {}) {
  const rows = proposeOptions(p)
    .map(({ option: o, chance, propose }) => `<button type="button" class="${btnClass} propose-opt${propose ? ' go' : ' fam-pass'}" ${attrs(p, o, who)}${o.disabled ? ' disabled' : ''}>
        <span class="c-icon">${esc(o.icon ?? (propose ? '💍' : '⏳'))}</span><span class="ci-opt-l">${esc(o.label ? optionLabel(o) : propose ? '프러포즈!' : '조금 더 기다리기')}${o.desc ? `<small class="ci-opt-desc">${esc(chance != null ? String(o.desc).replace(/^성공 확률[^·]*·\s*/, '') : o.desc)}</small>` : ''}${
          chance != null
            ? `<span class="chance-meter" role="meter" aria-label="성공 확률" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${chance}"><i style="width:${chance}%"></i><b>성공 확률 ${chance}%</b></span>`
            : ''
        }</span></button>`)
    .join('');
  return `<div class="ci-opt-list propose-list">${rows}</div>`;
}

/** Romance prompt options by kind (meet / date / propose); null for other kinds. */
export function familyOptionsHtml(p, who, opts = {}) {
  switch (p?.kind) {
    case 'meet':
      return meetOptionsHtml(p, who, opts);
    case 'date':
      return dateOptionsHtml(p, who, opts);
    case 'propose':
      return proposeOptionsHtml(p, who, opts);
    default:
      return null;
  }
}

/** Partner / spouse card (portrait · name · trait · ★ · 맞벌이 salary). */
export function partnerCardHtml(info, { label = '', won = wonFmt, size = 40 } = {}) {
  if (!info) return '';
  return `<span class="fam-card">${npcPortrait(info, { size, crop: 'face' })}<span class="fam-card-b"><span class="fam-card-n">${label ? `${esc(label)} ` : ''}<b>${esc(info.name)}</b></span><span class="fam-card-t"><span class="nw">${esc(info.traitIcon)} ${esc(
    info.traitName,
  )}</span>${info.starsText ? ` <span class="pi-stars nw">${esc(info.starsText)}</span>` : ''}${info.salary != null && info.salary > 0 ? ` <span class="nw">· 💼 맞벌이 ${esc(won(info.salary))}</span>` : ''}</span></span></span>`;
}

/**
 * Side-list detail rows (「연애」「배우자」「자녀」「집」). Empty string when the character has none of the fields.
 * @param {object} c  character
 * @param {{meta?, room?, avatars?, artFor?, won?}} opts
 */
export function familyDetailHtml(c, { meta = null, room = null, avatars = null, artFor = () => null, won = wonFmt } = {}) {
  const f = familyOf(c, meta);
  const facts = [];
  if (f.partner) {
    const aff = f.affection ?? affectionInfo(c.love, meta);
    facts.push(
      `<div class="gd-fact"><span class="gd-k">연애</span><span class="gd-v">${partnerCardHtml(f.partner, { won })}${
        aff
          ? `<span class="aff-bar${aff.ready ? ' ready' : ''}" role="meter" aria-label="호감도" aria-valuemin="0" aria-valuemax="${aff.proposeAt}" aria-valuenow="${aff.value}"><i style="width:${aff.pct}%"></i><b>❤️ ${aff.value}/${aff.proposeAt}${aff.ready ? ' 💍 프러포즈 가능!' : ''}</b></span>`
          : ''
      }</span></div>`,
    );
  } else if (c?.love && !f.spouse && Array.isArray(c.love.candidates) && c.love.candidates.length) {
    facts.push(`<div class="gd-fact"><span class="gd-k">연애</span><span class="gd-v muted">💘 썸 타는 중 (${c.love.candidates.length}명)</span></div>`);
  }
  if (f.spouse) facts.push(`<div class="gd-fact"><span class="gd-k">배우자</span><span class="gd-v">${partnerCardHtml(f.spouse, { label: '💍', won })}</span></div>`);
  if (f.children.length) {
    const kids = (c.children ?? []).filter((k) => k && typeof k === 'object');
    facts.push(
      `<div class="gd-fact"><span class="gd-k">자녀</span><span class="gd-v fam-kids">${f.children
        .map((k, i) => {
          const spec = kids[i];
          const look = childLook(spec, { avatars });
          return `<span class="fam-kid${k.genius ? ' genius' : ''}" title="${esc(`${k.name} · ${k.stageLabel}${k.genius ? ' · 천재' : ''}${k.traitName ? ` · ${k.traitName}` : ''}`)}">${npcPortrait(spec, { size: 30, crop: 'face', avatar: look })}<small>${esc(k.name)}</small><em>${esc(k.stageIcon)} ${esc(k.stageLabel)}</em>${k.genius ? '<i class="kid-genius">🌟 천재</i>' : ''}</span>`;
        })
        .join('')}</span></div>`,
    );
  }
  const h = houseOf(c, meta);
  if (h) {
    const mk = marketInfo(room?.housingMarket);
    facts.push(
      `<div class="gd-fact"><span class="gd-k">집</span><span class="gd-v fam-house">${houseArtHtml(h.id, { art: artFor('house', h.id), label: h.name, cls: 'fh-art' })}<span><b>${esc(h.icon)} ${esc(h.name)}</b><small>가치 ${esc(won(h.value ?? 0))}${
        h.gain ? ` (${h.gain > 0 ? '+' : ''}${esc(won(h.gain))})` : ''
      }${h.swaps ? ` · 🔁 갈아타기 ${h.swaps}회` : ''}</small>${mk ? `<small class="mk ${mk.dir}">${esc(mk.text)}</small>` : ''}</span></span></div>`,
    );
  }
  return facts.join('');
}
