// Stage 9 — result screen + 「인생 결산 방송」 (result show). Driven only by `room.result` (identical for everyone):
//   a. MC studio intro (cut-in)            b. highlights: per character LAST → FIRST, quick cut-in slides (tap = next
//   c. 보물 감정 (flip cards, 💥 가짜!)        character's highlights)    d. 특별상 cards + 칭호 badges
//   e. 최종 순위 (breakdown bars)             f. 시상대 (3D pawns in 3D mode, else an SVG/CSS podium)
// then the static page: podium, 👑 MVP vote (live counts, countdown, mvpDecided), ranking with bars, awards, treasures,
// 📸 단체 사진. Skippable (「건너뛰기」) and re-watchable (「다시 보기」); autoplays once per room per browser session.
//
//   const rs = createResultScreen({ getMeta, cutin, act, toast, … });
//   rs.render(displayRoom, host, { autoplay }); rs.onEvents(events); rs.play(); rs.skip(); rs.reset();
import { esc, won } from '../format.js';
import { hydratePortraits, portraitHtml } from './avatar2d.js';
import { createMcBooth, mcHash, mcScriptMs, playMcScript, resultMcFrom } from './mc.js';
import { poseFor, TONES } from './cutinMap.js';
import {
  BREAKDOWN,
  MEDALS,
  appraisalRows,
  appraisalTotals,
  awardCards,
  breakdownBars,
  countdownText,
  fallbackMc,
  mcParts,
  medal,
  mvpState,
  planResultShow,
  podiumLayout,
  rankRows,
  titleBadges,
  voteButtons,
} from '../shared/result.js';
import { treasureArtHtml } from './submapArt.js';
import { openPhotoDialog } from './groupPhoto.js';

const WATCHED_KEY = 'jinsei.resultShow';
const reduced = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function sGet(k) {
  try {
    return sessionStorage.getItem(k);
  } catch {
    return null;
  }
}
function sSet(k, v) {
  try {
    sessionStorage.setItem(k, v);
  } catch {
    /* storage unavailable */
  }
}


/**
 * @param {{getMeta: () => object, cutin: object, act: (body) => Promise, toast?: Function, rowExtras?: (row, char) => string,
 *   artFor?: (kind, id) => string|null, findAsset?: Function, mcOn?: () => boolean, want3D?: () => boolean,
 *   now?: () => number}} deps  `rowExtras` = extra ranking-row markup (career, items, family); `now` = server clock
 */
export function createResultScreen({ getMeta, cutin, act, toast = () => {}, rowExtras = () => '', artFor = () => null, findAsset = () => null, mcOn = () => true, want3D = () => false, now = () => Date.now() }) {
  const S = {
    key: null,
    host: null,
    room: null,
    rows: [],
    podium: null,
    show: null, // running show token
    keys: {},
    mvpSeen: null,
    tick: null,
  };
  const meta = () => getMeta() ?? {};

  // ---------- show overlay (created once) ----------
  const overlay = document.createElement('div');
  overlay.className = 'rshow';
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', '인생 결산 방송');
  overlay.innerHTML = `
    <div class="rshow-bg" aria-hidden="true"></div>
    <div class="rshow-top"><span class="rshow-live">● LIVE</span><b class="rshow-title" data-rshow="title"></b><span class="rshow-steps" data-rshow="steps" aria-hidden="true"></span></div>
    <div class="rshow-body" data-rshow="body"></div>
    <div class="rshow-mc" data-rshow="mc" aria-live="polite"></div>
    <p class="rshow-hint">화면을 누르면 다음으로 넘어가요</p>`;
  document.body.appendChild(overlay);
  const skipBtn = document.createElement('button');
  skipBtn.type = 'button';
  skipBtn.className = 'rshow-skip';
  skipBtn.hidden = true;
  skipBtn.textContent = '⏭ 건너뛰기';
  skipBtn.setAttribute('aria-label', '결산 방송 건너뛰기');
  document.body.appendChild(skipBtn);
  // the MVP vote runs on the server clock from the game end → while the show plays, a floating 「👑 MVP 투표」 button
  // jumps straight to the vote (players who haven't voted yet)
  const voteBtn = document.createElement('button');
  voteBtn.type = 'button';
  voteBtn.className = 'rshow-vote';
  voteBtn.hidden = true;
  document.body.appendChild(voteBtn);
  const $o = Object.fromEntries([...overlay.querySelectorAll('[data-rshow]')].map((n) => [n.dataset.rshow, n]));
  skipBtn.addEventListener('click', () => skip());
  voteBtn.addEventListener('click', () => {
    skip();
    const box = S.host?.querySelector('[data-rs="mvp"]');
    box?.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
    box?.querySelector('[data-vote]:not([disabled])')?.focus({ preventScroll: true });
  });
  overlay.addEventListener('click', (ev) => {
    if (ev.target.closest('button, a')) return;
    S.show?.next();
  });
  document.addEventListener('keydown', (ev) => {
    if (overlay.hidden || !S.show) return;
    if (ev.key === 'Escape') skip();
    else if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      S.show.next();
    }
  });

  // ---------- data ----------
  const charsOf = (room) => room?.characters ?? [];
  const orderedChars = (room) => {
    const m = new Map(charsOf(room).map((c) => [c.id, c]));
    const order = (room?.turn?.order ?? []).map((id) => m.get(id)).filter(Boolean);
    return order.length ? order : charsOf(room);
  };
  const resultKey = (room) => `${room.id}:${room.result?.finishedAt ?? ''}:${(room.result?.ranking ?? []).length}`;
  const watchedKey = (room) => `${WATCHED_KEY}.${room.id}.${room.result?.finishedAt ?? ''}`;

  /** MC lines of a part: server `result.mc`, else the client pools (intro / winner / last / penalty), else built-ins. */
  function linesFor(room, part, vars = {}) {
    if (!mcOn()) return [];
    const parts = mcParts(room.result);
    if (parts[part]?.length) return parts[part];
    if (['intro', 'winner', 'last', 'penalty'].includes(part)) {
      const ranking = (room.result?.ranking ?? []).map((r) => ({ ...r }));
      return resultMcFrom(meta().mc, ranking, { seed: mcHash(room.id, 'result'), won }).filter((l) => l.part === part);
    }
    return fallbackMc(part, vars);
  }

  // ---------- page ----------
  function render(room, host, { autoplay = true } = {}) {
    if (!host || !room?.result) return;
    S.room = room;
    const key = resultKey(room);
    const rows = rankRows(room.result, charsOf(room));
    S.rows = rows;
    if (!rows.length) {
      host.innerHTML = '<p class="muted">순위 정보가 없어요.</p>';
      S.key = null;
      return;
    }
    if (S.key !== key || S.host !== host || !host.querySelector('.rs')) {
      // A2: the host is known before build() → ranking / awards / treasures are filled in the same pass (spectators,
      // CPU-only rooms and TVs may never get another state push)
      S.key = key;
      S.host = host;
      build(room, host);
      if (autoplay && !sGet(watchedKey(room))) queueMicrotask(() => play());
      return;
    }
    update(room);
  }

  function build(room, host) {
    stopShow(false);
    S.podium?.dispose();
    S.podium = null;
    S.keys = {};
    S.mvpSeen = room.result?.mvp?.winner ?? null;
    host.innerHTML = `
      <div class="rs">
        ${room.result.forced ? '<p class="small muted">관리자가 게임을 종료했어요. 현재 자산 기준 순위입니다.</p>' : ''}
        <div class="rs-tools">
          <button type="button" class="btn small" data-rs="replay">▶ 결산 방송 다시 보기</button>
          <button type="button" class="btn small primary" data-rs="photo">📸 단체 사진 찍기</button>
        </div>
        <section class="rs-sec rs-podium" data-rs="podium" aria-label="시상대"></section>
        <section class="rs-sec rs-mvp" data-rs="mvp" aria-label="MVP 투표" hidden></section>
        <section class="rs-sec" aria-label="최종 순위"><h3>📊 최종 순위</h3><div data-rs="ranking"></div></section>
        <section class="rs-sec" data-rs="awards-sec" aria-label="특별상" hidden><h3>🏅 특별상 · 칭호</h3><div data-rs="awards"></div></section>
        <section class="rs-sec" data-rs="treasures-sec" aria-label="보물 감정" hidden><h3>💎 보물 감정</h3><div data-rs="treasures"></div></section>
      </div>`;
    S.podium = createPodiumView(room);
    host.querySelector('[data-rs="podium"]').appendChild(S.podium.el);
    if (!host.dataset.rsBound) {
      host.dataset.rsBound = '1';
      host.addEventListener('click', (ev) => onHostClick(ev));
    }
    update(room);
    clearInterval(S.tick);
    S.tick = setInterval(tick, 500);
  }

  function update(room) {
    const host = S.host;
    if (!host) return;
    const sec = (k) => host.querySelector(`[data-rs="${k}"]`);
    const rows = S.rows;
    const titles = titleBadges(room.result, { meta: meta() });
    const rankKey = JSON.stringify([room.result.ranking, room.result.titles, room.result.mvp?.winner ?? null]);
    if (S.keys.rank !== rankKey) {
      S.keys.rank = rankKey;
      sec('ranking').innerHTML = rankingHtml(rows, room, { titles, full: true });
      hydratePortraits(sec('ranking'));
    }
    const cards = awardCards(room.result, charsOf(room), { meta: meta(), won });
    const awardsKey = JSON.stringify([room.result.awards, room.result.titles]);
    if (S.keys.awards !== awardsKey) {
      S.keys.awards = awardsKey;
      const has = cards.length || Object.values(titles).some((t) => t.length);
      sec('awards-sec').hidden = !has;
      sec('awards').innerHTML = has ? awardsHtml(cards, titles, rows) : '';
      hydratePortraits(sec('awards'));
    }
    const appr = appraisalRows(room.result, charsOf(room), { meta: meta(), won });
    const trKey = JSON.stringify(room.result.treasures ?? null);
    if (S.keys.treasures !== trKey) {
      S.keys.treasures = trKey;
      sec('treasures-sec').hidden = !appr.length;
      sec('treasures').innerHTML = appr.length ? treasuresHtml(appr, rows) : '';
    }
    renderMvp(room);
  }

  // ---------- ranking ----------
  function rankingHtml(rows, room, { titles = {}, full = false } = {}) {
    const bars = breakdownBars(rows);
    const routes = meta().board?.routes ?? {};
    return `<ol class="ranking rs-ranking${full ? '' : ' show'}${full && S.expanded ? ' expanded' : ''}" style="--n:${rows.length}">${rows
      .map((r, i) => {
        const c = r.char;
        const b = bars[i];
        const ts = titles[r.charId] ?? [];
        const routesTxt = (c?.routeHistory ?? []).map((h) => routes[h.route]?.icon ?? '').join(' ');
        const mvp = room.result?.mvp?.winner === r.charId;
        const parts = [
          `현금 ${won(r.money)}`,
          r.debt ? `빚 ${won(r.debt)}` : '',
          r.items > 0 ? `아이템 ${won(r.items)}` : '',
          r.house > 0 ? `집 ${won(r.house)}` : '',
          r.treasures ? `보물 ${won(r.treasures)}` : '',
          r.awards > 0 ? `특별상 ${won(r.awards)}` : '',
        ].filter(Boolean);
        const extra = full
          ? `${rowExtras(r.raw, c) ?? ''}<span class="small muted">${parts.join(' · ')}${Number(r.goalBonus) ? ` · 골인 보너스 ${won(r.goalBonus)}` : ''}${r.place && Number(r.goalBonus) ? ` · ${r.place}번째 골인` : ''}${routesTxt ? ` · 루트 ${routesTxt}` : ''}</span>`
          : `<span class="small muted">${parts.join(' · ')}</span>`;
        return `<li class="rank-row${r.rank === 1 ? ' first' : ''}${c?.isMe ? ' me' : ''}${mvp ? ' mvp' : ''}${full && i >= 3 ? ' rk-fold' : ''}" style="--k:${rows.length - 1 - i}" data-char="${esc(r.charId)}">
          <span class="rk">${medal(r.rank)}</span>
          <span class="rk-portrait">${c ? portraitHtml(c, { size: 52 }) : ''}</span>
          <span class="rk-body"><b>${esc(r.name)}</b>${mvp ? ' <span class="rs-crown" title="MVP">👑 MVP</span>' : ''} <small class="muted">${c ? ownerName(c) : ''}</small>${
            ts.length ? `<span class="rs-titles">${ts.map((t) => `<span class="rs-title" title="${esc(t.desc)}">${esc(t.icon)} ${esc(t.name)}</span>`).join('')}</span>` : ''
          }
            <span class="rs-bar" role="img" aria-label="${esc(b.segments.map((s) => `${s.label} ${won(s.value)}`).join(', ') || '자산 없음')}">${b.segments
              .map((s) => `<i class="seg" style="--w:${s.pct}%;--c:${s.color}" title="${esc(`${s.icon} ${s.label} ${won(s.value)}`)}"></i>`)
              .join('')}${b.negative ? `<i class="seg neg" style="--w:${b.negPct}%" title="${esc(`빚 -${won(b.negative)}`)}"></i>` : ''}</span>
            ${extra}</span>
          <span class="rk-total">${won(r.total)}</span>
        </li>`;
      })
      .join('')}</ol>${
      full && rows.length > 3
        ? `<button type="button" class="btn tiny ghost rs-more" data-rs="more" aria-expanded="${S.expanded ? 'true' : 'false'}">${S.expanded ? '▲ 4위부터 간단히' : `▼ 4위부터 자세히 (${rows.length - 3}명)`}</button>`
        : ''
    }<div class="rs-legend" aria-hidden="true">${BREAKDOWN.map((b) => `<span><i style="--c:${b.color}"></i>${esc(b.icon)} ${esc(b.label)}</span>`).join('')}<span><i class="neg"></i>빚</span></div>`;
  }
  const ownerName = (c) => (c.ownerId === 'cpu' || c.cpu ? '<span class="cpu-badge" title="컴퓨터 플레이어">🤖 CPU</span>' : esc(c.ownerName ?? ''));

  function awardsHtml(cards, titles, rows) {
    const names = new Map(rows.map((r) => [r.charId, r]));
    const tRows = Object.entries(titles).filter(([, t]) => t.length);
    return `${cards.length ? `<div class="rs-awards">${cards.map((a) => awardCardHtml(a)).join('')}</div>` : ''}${
      tRows.length
        ? `<div class="rs-title-list">${tRows
            .map(([id, ts]) => {
              const r = names.get(id);
              return `<div class="rs-title-row"><span class="rs-tr-av">${r?.char ? portraitHtml(r.char, { size: 28 }) : ''}</span><b>${esc(r?.name ?? '')}</b>${ts
                .map((t) => `<span class="rs-title" title="${esc(t.desc)}">${esc(t.icon)} ${esc(t.name)}</span>`)
                .join('')}</div>`;
            })
            .join('')}</div>`
        : ''
    }`;
  }
  function awardCardHtml(a, { big = false } = {}) {
    return `<div class="rs-award${big ? ' big' : ''}"><span class="rs-aw-ic" aria-hidden="true">${esc(a.icon)}</span><b class="rs-aw-name">${esc(a.name)}</b>${a.desc ? `<small class="rs-aw-desc">${esc(a.desc)}</small>` : ''}<span class="rs-aw-win">${a.winners
      .map((w) => `<span class="rs-aw-who">${w.char ? portraitHtml(w.char, { size: big ? 56 : 32 }) : ''}<b>${esc(w.name)}</b></span>`)
      .join('')}</span>${a.bonusText ? `<span class="rs-aw-bonus">${esc(a.bonusText)}</span>` : ''}${big && a.line ? `<q class="rs-aw-line">${esc(a.line)}</q>` : ''}</div>`;
  }

  function treasuresHtml(appr) {
    const totals = appraisalTotals(appr);
    return `<ul class="rs-tr">${appr
      .map(
        (t) => `<li class="rs-tr-item${t.fake ? ' fake' : ''}">${treasureArtHtml(t.treasureId, { art: artFor('treasure', t.treasureId), meta: meta(), cls: 'rs-tr-art' })}<span class="rs-tr-body"><b>${esc(t.info.name)}</b><small>${esc(t.name)}</small></span><span class="rs-tr-v">${esc(t.text)}</span></li>`,
      )
      .join('')}</ul><p class="small muted rs-tr-sum">${Object.entries(totals)
      .map(([id, v]) => `${esc(appr.find((x) => x.charId === id)?.name ?? '')} ${esc(won(v))}`)
      .join(' · ')}</p>`;
  }

  // ---------- podium ----------
  function podiumEntries(room) {
    return S.rows.map((r) => ({ char: r.char ?? { id: r.charId, name: r.name, avatar: {} }, step: r.rank <= 3 ? r.rank : 0, rank: r.rank, total: r.total, crown: room.result?.mvp?.winner === r.charId }));
  }

  function podium2dHtml(room) {
    const lay = podiumLayout(S.rows);
    const mvp = room.result?.mvp?.winner ?? null;
    const col = (place) => {
      const step = lay.steps.find((s) => s.place === place);
      const k = step.rows.length;
      return `<div class="pd2-col p${place}"><div class="pd2-figs${k > 1 ? ' multi' : ''}">${step.rows
        .map(
          (r) => `<div class="pd2-fig${r.char?.isMe ? ' me' : ''}" data-char="${esc(r.charId)}">${mvp === r.charId ? '<span class="pd2-crown" title="MVP">👑</span>' : ''}<span class="pd2-av">${
            r.char ? portraitHtml(r.char, { size: k > 1 ? (k > 2 ? 40 : 56) : place === 1 ? 104 : 80, crop: 'bust' }) : ''
          }</span><b class="pd2-name">${esc(r.name)}</b><small class="pd2-total">${esc(won(r.total))}</small></div>`,
        )
        .join('')}</div><div class="pd2-block"><span class="pd2-medal">${MEDALS[place - 1]}</span><span class="pd2-num">${place}</span></div></div>`;
    };
    return `<div class="pd2"><div class="pd2-confetti" aria-hidden="true">${Array.from({ length: 18 }, (_, i) => `<i style="--i:${i};--x:${(i * 41) % 100}%"></i>`).join('')}</div><div class="pd2-steps">${lay.order
      .map(col)
      .join('')}</div>${lay.others.length ? `<div class="pd2-others">${lay.others.map((r) => `<span class="pd2-other${r.char?.isMe ? ' me' : ''}">${medal(r.rank)} ${r.char ? portraitHtml(r.char, { size: 24 }) : ''}${esc(r.name)}</span>`).join('')}</div>` : ''}</div>`;
  }

  /** Podium element (moved between the show overlay and the page — a WebGL canvas keeps its context). */
  function createPodiumView(room) {
    const el = document.createElement('div');
    el.className = 'rs-podium-view';
    const view = { el, is3d: false, pd: null };
    const top = S.rows.filter((r) => r.rank <= 3);
    const caption = `<p class="rs-podium-cap">${top.map((r) => `${medal(r.rank)} ${esc(r.name)} ${esc(won(r.total))}`).join(' · ')}</p>`;
    const as2d = () => {
      view.is3d = false;
      el.classList.remove('is3d');
      el.innerHTML = podium2dHtml(room);
      hydratePortraits(el);
    };
    if (want3D()) {
      view.is3d = true;
      el.classList.add('is3d');
      el.innerHTML = `<canvas class="rs-podium-canvas" aria-label="3D 시상대"></canvas>${caption}`;
      import('../scene/podium3d.js')
        .then(({ createPodium3D }) => {
          if (!el.isConnected && !el.parentNode) return;
          view.pd = createPodium3D(el.querySelector('canvas'), { defs: meta().avatars, entries: podiumEntries(room), reducedMotion: reduced() });
          if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug')) globalThis.__podium3d = view.pd;
        })
        .catch((err) => {
          console.warn('[podium3d]', err);
          as2d();
        });
    } else as2d();
    view.celebrate = () => {
      view.pd?.celebrate();
      if (!view.is3d) {
        const c = el.querySelector('.pd2');
        c?.classList.remove('party');
        void c?.offsetWidth;
        c?.classList.add('party');
      }
    };
    view.setCrown = (charId) => {
      view.pd?.setCrown(charId);
      if (!view.is3d) for (const f of el.querySelectorAll('.pd2-fig')) {
        const on = f.dataset.char === charId;
        const has = f.querySelector('.pd2-crown');
        if (on && !has) f.insertAdjacentHTML('afterbegin', '<span class="pd2-crown" title="MVP">👑</span>');
        if (!on && has) has.remove();
      }
    };
    view.snapshot = (w, h) => view.pd?.snapshot(w, h) ?? null;
    view.dispose = () => view.pd?.dispose();
    return view;
  }

  // ---------- MVP ----------
  function renderMvp(room) {
    const box = S.host?.querySelector('[data-rs="mvp"]');
    if (!box) return;
    const t = now();
    const st = mvpState(room, { now: t });
    if (!st) {
      box.hidden = true;
      return;
    }
    const btns = voteButtons(room, { now: t });
    const key = JSON.stringify([room.result.mvp, st.open, room.me?.id ?? null]);
    if (S.keys.mvp === key) return;
    S.keys.mvp = key;
    box.hidden = false;
    const byId = new Map(charsOf(room).map((c) => [c.id, c]));
    const winner = st.winner ? byId.get(st.winner) : null;
    box.classList.toggle('decided', !!winner);
    box.innerHTML = `
      <h3>👑 MVP 투표 ${
        winner ? '<span class="rs-mvp-state done">결과 발표!</span>' : st.open ? `<span class="rs-mvp-state" data-rs-deadline="${st.closesAt ?? ''}">${st.closesAt ? `남은 시간 ${countdownText(st.closesAt - t)}` : '투표 중'}</span>` : '<span class="rs-mvp-state">투표 마감</span>'
      }</h3>
      ${
        winner
          ? `<div class="rs-mvp-win"><span class="rs-mvp-av">${portraitHtml(winner, { size: 72, crop: 'bust' })}</span><span><b>👑 MVP · ${esc(winner.name)}</b><small>${st.counts[winner.id] ?? 0}표 / 총 ${st.total}표${room.result.mvp?.note === 'noVoters' ? ' · 투표할 사람이 없어 1등이 MVP' : room.result.mvp?.note === 'noVotes' ? ' · 표가 없어 1등이 MVP' : ''}</small>${room.result.mvp?.line ? `<q class="rs-mvp-line">${esc(room.result.mvp.line)}</q>` : ''}</span><span class="rs-mvp-mc" data-rs="mvp-mc"></span></div>`
          : `<p class="small muted">${st.spectator ? '👀 관전자는 투표 결과만 볼 수 있어요.' : st.open ? '오늘 가장 빛난 인생에게 한 표! 내 캐릭터에는 투표할 수 없어요. (마감 전까지 바꿀 수 있어요)' : '투표가 마감됐어요. 결과를 기다리는 중…'}</p>`
      }
      <div class="rs-votes">${btns
        .map((b) => {
          const c = byId.get(b.charId);
          const pct = st.total ? Math.round((b.count / st.total) * 100) : 0;
          return `<div class="rs-vote${b.winner ? ' winner' : ''}${b.leader && !winner ? ' leader' : ''}${b.voted ? ' voted' : ''}${b.own ? ' own' : ''}">
            <span class="rs-vote-av">${c ? portraitHtml(c, { size: 40 }) : ''}</span>
            <span class="rs-vote-body"><b>${b.winner ? '👑 ' : ''}${esc(b.name)}</b><span class="rs-vote-bar" role="meter" aria-label="${esc(b.name)} 득표" aria-valuemin="0" aria-valuemax="${st.total}" aria-valuenow="${b.count}"><i style="width:${pct}%"></i></span><small>${b.count}표</small></span>
            ${
              b.showButton && !winner
                ? `<button type="button" class="btn tiny${b.voted ? ' on' : ''}" data-vote="${esc(b.charId)}" ${b.disabled ? 'disabled' : ''} title="${esc(b.reason ?? `${b.name}에게 투표`)}">${b.voted ? '✅ 내 한 표' : b.own ? '내 캐릭터' : '👍 투표'}</button>`
                : ''
            }
          </div>`;
        })
        .join('')}</div>`;
    hydratePortraits(box);
    const invite = !winner && st.open && mcOn() ? mcParts(room.result).mvp ?? [] : [];
    if (invite.length) {
      const l = invite.at(-1);
      const booth = createMcBooth({ ids: [l.speaker], size: 48 });
      booth.say(l);
      booth.el.classList.add('rs-mvp-invite');
      box.querySelector('h3')?.after(booth.el);
    }
    if (winner && S.mvpSeen !== winner.id) {
      S.mvpSeen = winner.id;
      // the state arrives before its events: give mvpDecided (with its MC lines) a moment to land
      setTimeout(() => S.room === room && celebrateMvp(room, winner), 120);
    } else if (winner) {
      const lines = decidedLines(winner);
      const last = lines.at(-1);
      const slot = box.querySelector('[data-rs="mvp-mc"]');
      if (slot && last && mcOn()) {
        const booth = createMcBooth({ ids: [last.speaker], size: 56 });
        booth.say(last);
        slot.replaceChildren(booth.el);
      }
    }
  }

  function celebrateMvp(room, winner) {
    S.podium?.setCrown(winner.id);
    S.podium?.celebrate();
    const lines = decidedLines(winner);
    const slot = S.host?.querySelector('[data-rs="mvp-mc"]');
    if (slot && lines.length && mcOn()) {
      const booth = createMcBooth({ ids: ['hoya', 'bomi'].filter((id) => lines.some((l) => l.speaker === id)), size: 56 });
      slot.replaceChildren(booth.el);
      playMcScript(booth, lines, { gap: 1300, hold: 99999, cancelled: () => !slot.isConnected });
    }
    if (!S.show) toast(`👑 MVP는 ${winner.name}!`);
  }

  /** MC lines of the decided MVP: the mvpDecided event's, else built-ins (result.mc 'mvp' = the vote invitation). */
  function decidedLines(winner) {
    if (!mcOn()) return [];
    return S.mvpLines?.length ? S.mvpLines : fallbackMc('mvp', { name: winner.name });
  }

  function tick() {
    if (!S.host?.isConnected || !S.room) return;
    const t = now();
    for (const d of S.host.querySelectorAll('[data-rs-deadline]')) {
      const at = Number(d.dataset.rsDeadline);
      if (at) d.textContent = `남은 시간 ${countdownText(at - t)}`;
    }
    // the deadline passed locally → the key (with `open`) changes → buttons lock (the server sends mvpDecided)
    renderMvp(S.room);
    const st = mvpState(S.room, { now: t });
    const showVote = !!S.show && !!st?.canVote && !st.myVote;
    voteBtn.hidden = !showVote;
    if (showVote) {
      voteBtn.textContent = `👑 MVP 투표하기${st.closesAt ? ` · ${countdownText(st.closesAt - t)}` : ''}`;
      voteBtn.classList.toggle('urgent', !!st.closesAt && st.closesAt - t < 20000);
    }
  }

  async function onHostClick(ev) {
    const t = ev.target;
    const more = t.closest('[data-rs="more"]');
    if (more) {
      // phones: places 4+ start folded (name + total); this toggles their details
      S.expanded = !S.expanded;
      const ol = S.host.querySelector('.rs-ranking');
      ol?.classList.toggle('expanded', S.expanded);
      more.setAttribute('aria-expanded', String(S.expanded));
      more.textContent = S.expanded ? '▲ 4위부터 간단히' : `▼ 4위부터 자세히 (${Math.max(0, S.rows.length - 3)}명)`;
      return;
    }
    const v = t.closest('[data-vote]');
    if (v && !v.disabled) {
      const box = S.host.querySelector('[data-rs="mvp"]');
      for (const b of box.querySelectorAll('[data-vote]')) b.disabled = true;
      try {
        await act({ type: 'vote', targetId: v.dataset.vote });
        toast(`🗳️ ${S.room?.characters?.find((c) => c.id === v.dataset.vote)?.name ?? ''}에게 투표했어요!`);
      } catch (err) {
        toast(err?.message || '투표하지 못했어요.', 'error');
      } finally {
        S.keys.mvp = null;
        if (S.room) renderMvp(S.room);
      }
      return;
    }
    if (t.closest('[data-rs="replay"]')) return play({ force: true });
    if (t.closest('[data-rs="photo"]')) return openPhoto();
  }

  function openPhoto() {
    const room = S.room;
    if (!room) return;
    openPhotoDialog({
      entries: S.rows.map((r) => ({ char: r.char ?? { id: r.charId, name: r.name, avatar: {} }, rank: r.rank })),
      code: room.code ?? '',
      findAsset,
      podium: S.podium?.is3d && S.podium.pd ? S.podium : null,
      toast,
      date: new Date(room.result?.finishedAt ?? Date.now()),
    });
  }

  function onEvents(events = []) {
    for (const e of events) {
      if (e.type !== 'mvpDecided') continue;
      const room = S.room;
      const c = room?.characters?.find((x) => x.id === e.charId);
      S.mvpLines = e.mc?.length ? e.mc : null;
      if (room && c && S.mvpSeen !== c.id && room.result?.mvp?.winner === c.id) {
        S.keys.mvp = null;
        renderMvp(room);
      } else if (c && S.mvpSeen !== c.id) {
        // the state has not caught up yet → celebrate once it does (renderMvp); meanwhile a toast
        toast(`👑 MVP는 ${c.name}!`);
      }
    }
  }

  // ---------- the show ----------
  function stepDots(steps, i) {
    $o.steps.innerHTML = steps.map((s, k) => `<i class="${k < i ? 'done' : k === i ? 'on' : ''}"></i>`).join('');
  }

  function setStage(title, steps, i) {
    overlay.hidden = false;
    document.body.classList.add('rshow-open');
    $o.title.textContent = title;
    stepDots(steps, i);
    $o.body.innerHTML = '';
    $o.mc.innerHTML = '';
  }

  function makeToken() {
    const tk = { cancelled: false, skipStep: false, skipChar: null, wake: null, step: null };
    tk.next = () => {
      tk.skipStep = true;
      tk.wake?.();
    };
    tk.wait = (ms) =>
      new Promise((resolve) => {
        if (tk.cancelled || tk.skipStep) return resolve();
        const t = setTimeout(done, ms);
        function done() {
          clearTimeout(t);
          tk.wake = null;
          resolve();
        }
        tk.wake = done;
      });
    return tk;
  }

  function sayMc(lines, tk, stepId) {
    if (!lines?.length || !mcOn()) return;
    const ids = ['hoya', 'bomi'].filter((id) => lines.some((l) => l.speaker === id));
    const booth = createMcBooth({ ids, size: 0 });
    $o.mc.replaceChildren(booth.el);
    playMcScript(booth, lines, { delay: 300, gap: 1500, hold: 99999, cancelled: () => tk.cancelled || tk.step !== stepId });
  }

  async function play({ force = false } = {}) {
    const room = S.room;
    if (!room?.result || !S.rows.length) return;
    if (S.show && !force) return;
    stopShow(false);
    sSet(watchedKey(room), '1');
    const tk = makeToken();
    S.show = tk;
    skipBtn.hidden = false;
    const chars = orderedChars(room);
    const intro = linesFor(room, 'intro');
    const plan = planResultShow(room.result, { characters: charsOf(room), meta: meta(), introMs: intro.length ? mcScriptMs(intro, { delay: 350, gap: 1500, hold: 1600 }) : 3000, won });
    try {
      for (let i = 0; i < plan.steps.length && !tk.cancelled; i++) {
        const step = plan.steps[i];
        tk.step = step.id;
        tk.skipStep = false;
        if (step.id === 'intro') await stepIntro(room, intro, chars, tk);
        else if (step.id === 'highlights') await stepHighlights(room, step, chars, tk);
        else if (step.id === 'appraisal') await stepAppraisal(room, step, plan.steps, i, tk);
        else if (step.id === 'awards') await stepAwards(room, step, plan.steps, i, tk);
        else if (step.id === 'ranking') await stepRanking(room, step, plan.steps, i, tk);
        else if (step.id === 'podium') await stepPodium(room, step, plan.steps, i, tk);
      }
    } catch (err) {
      console.warn('[result show]', err);
    }
    if (S.show === tk) stopShow(true);
  }

  async function stepIntro(room, lines, chars, tk) {
    overlay.hidden = true;
    if (lines.length) {
      await cutin.show(cutin.studioSpec(lines, { key: `result:${room.id}`, tone: 'result', title: '🏆 인생 결산 방송', characters: chars }));
      return;
    }
    const first = S.rows[0];
    await cutin.show({
      key: `result:${room.id}`,
      kind: 'result',
      tone: 'result',
      scene: 'studio',
      tag: '🏆 인생 결산 방송',
      who: '결과 발표',
      text: ['인생 결산 방송을 시작합니다!', '누가 제일 잘 살았을까?'],
      line: null,
      speaker: first?.charId ?? null,
      chips: [],
      cast: S.rows.slice(0, 3).map((r) => r.char).filter(Boolean).map((c) => ({ char: c, pose: 'wave', emotion: 'joy' })),
      bigWin: false,
      currentId: null,
      era: '',
      autoMs: 3000,
      characters: chars,
    });
  }

  async function stepHighlights(room, step, chars, tk) {
    overlay.hidden = true;
    const byId = new Map(charsOf(room).map((c) => [c.id, c]));
    for (const sl of step.slides) {
      if (tk.cancelled) return;
      if (tk.skipChar === sl.charId) continue;
      const c = byId.get(sl.charId);
      const tone = TONES.includes(sl.tone) ? sl.tone : 'neutral';
      const amount = sl.amount;
      let auto = false;
      await cutin.show(
        {
          key: `hl:${sl.charId}:${sl.index}`,
          kind: 'highlight',
          tone,
          scene: sl.scene || 'none',
          tag: `🎬 하이라이트 · ${medal(sl.rank)} ${sl.name}`,
          who: `${sl.name}${sl.turnNo ? ` · 턴 ${sl.turnNo}` : ''}`,
          text: [sl.text || '인생의 한 장면'],
          line: sl.line || null,
          speaker: sl.charId,
          chips: amount ? [{ text: `${amount > 0 ? '+' : ''}${won(amount)}`, kind: amount > 0 ? 'plus' : 'minus' }] : [],
          cast: c ? [{ char: c, pose: poseFor({ type: sl.type, tone, emotion: sl.emotion }, { delta: amount ?? 0 }), emotion: sl.emotion && sl.emotion !== 'neutral' ? sl.emotion : tone === 'bad' ? 'cry' : tone === 'love' ? 'love' : 'joy' }] : [],
          bigWin: false,
          currentId: sl.charId,
          era: `${sl.name}의 인생 ${sl.index + 1}/${sl.count}`,
          autoMs: sl.ms,
          characters: chars,
        },
        { onClose: (r) => (auto = r === 'auto') },
      );
      // tapped before the slide ran out → skip the rest of this character's highlights
      if (!auto && !tk.cancelled) tk.skipChar = sl.charId;
    }
  }

  async function stepAppraisal(room, step, steps, i, tk) {
    setStage('💎 보물 감정 결과는?!', steps, i);
    const rows = step.rows;
    $o.body.innerHTML = `<div class="rs-appr"><p class="rs-drum">두구두구두구… 🥁</p><div class="rs-appr-grid" style="--n:${rows.length}">${rows
      .map(
        (t, k) => `<div class="rs-tcard" data-k="${k}"><div class="rs-tcard-in"><div class="rs-tf front">${treasureArtHtml(t.treasureId, { art: artFor('treasure', t.treasureId), meta: meta(), cls: 'rs-tc-art' })}<b>${esc(t.info.name)}</b><small>${esc(t.name)}</small><span class="rs-q">???</span></div><div class="rs-tf back${t.fake ? ' fake' : ''}">${treasureArtHtml(t.treasureId, { art: artFor('treasure', t.treasureId), meta: meta(), cls: 'rs-tc-art' })}<b>${esc(t.info.name)}</b><small>${esc(t.name)}</small><span class="rs-v">${esc(t.text)}</span>${t.line ? `<q class="rs-tline">${esc(t.line)}</q>` : ''}</div></div></div>`,
      )
      .join('')}</div><div class="rs-appr-sum" data-rshow="sum"></div></div>`;
    sayMc(linesFor(room, 'appraisal'), tk, 'appraisal');
    await tk.wait(1600);
    const cards = [...$o.body.querySelectorAll('.rs-tcard')];
    for (const card of cards) {
      if (tk.cancelled) return;
      if (tk.skipStep) break;
      card.classList.add('drum');
      await tk.wait(step.flipMs * 0.55);
      card.classList.remove('drum');
      card.classList.add('flip');
      await tk.wait(step.flipMs * 0.45);
    }
    for (const card of cards) card.classList.add('flip');
    const totals = appraisalTotals(rows);
    const sum = $o.body.querySelector('.rs-appr-sum');
    if (sum) sum.innerHTML = Object.entries(totals).map(([id, v]) => `<span class="ci-chip ${v > 0 ? 'plus' : ''}">💎 ${esc(rows.find((x) => x.charId === id)?.name ?? '')} ${esc(won(v))}</span>`).join('');
    tk.skipStep = false;
    await tk.wait(2400);
  }

  async function stepAwards(room, step, steps, i, tk) {
    setStage('🏅 특별상 시상', steps, i);
    $o.body.innerHTML = '<div class="rs-aw-stage" data-rshow="aw"></div>';
    sayMc(linesFor(room, 'awards'), tk, 'awards');
    const stage = $o.body.querySelector('.rs-aw-stage');
    for (const a of step.cards) {
      if (tk.cancelled || tk.skipStep) break;
      stage.innerHTML = awardCardHtml(a, { big: true });
      hydratePortraits(stage);
      await tk.wait(2200);
    }
    if (tk.cancelled) return;
    // every award at a glance + the titles (칭호) per character
    $o.title.textContent = '🏅 특별상 · 🎖️ 칭호';
    stage.innerHTML = awardsHtml(step.cards, step.titles, S.rows);
    stage.classList.add('all');
    hydratePortraits(stage);
    tk.skipStep = false;
    await tk.wait(Object.values(step.titles).some((t) => t.length) ? 3500 : 1800);
  }

  async function stepRanking(room, step, steps, i, tk) {
    setStage('📊 최종 순위 발표', steps, i);
    const titles = titleBadges(room.result, { meta: meta() });
    $o.body.innerHTML = `<div class="rs-rank-show">${rankingHtml(S.rows, room, { titles })}</div>`;
    hydratePortraits($o.body);
    requestAnimationFrame(() => $o.body.querySelector('.rs-ranking')?.classList.add('go'));
    sayMc([...linesFor(room, 'last'), ...linesFor(room, 'penalty')], tk, 'ranking');
    await tk.wait(step.ms);
  }

  async function stepPodium(room, step, steps, i, tk) {
    setStage('🏆 시상식', steps, i);
    const wrap = document.createElement('div');
    wrap.className = 'rs-podium-stage';
    $o.body.appendChild(wrap);
    if (S.podium) wrap.appendChild(S.podium.el);
    S.podium?.celebrate();
    sayMc(linesFor(room, 'winner'), tk, 'podium');
    await tk.wait(step.ms);
  }

  /** End the show (natural end or skip): the podium goes back into the page. */
  function stopShow(finished) {
    const tk = S.show;
    if (tk) {
      tk.cancelled = true;
      tk.wake?.();
    }
    S.show = null;
    skipBtn.hidden = true;
    voteBtn.hidden = true;
    if (tk) cutin.hide();
    overlay.hidden = true;
    $o.body.innerHTML = '';
    $o.mc.innerHTML = '';
    document.body.classList.remove('rshow-open');
    const slot = S.host?.querySelector('[data-rs="podium"]');
    if (slot && S.podium && S.podium.el.parentNode !== slot) slot.appendChild(S.podium.el);
    if (finished && tk) S.podium?.celebrate();
  }

  function skip() {
    if (!S.show) return;
    stopShow(true);
  }

  return {
    render,
    onEvents,
    play,
    skip,
    get playing() {
      return !!S.show;
    },
    get podium() {
      return S.podium;
    },
    openPhoto,
    /** Leaving the room: stop the show, drop the podium. */
    reset() {
      stopShow(false);
      clearInterval(S.tick);
      S.podium?.dispose();
      S.podium = null;
      S.key = null;
      S.host = null;
      S.room = null;
    },
    destroy() {
      this.reset();
      overlay.remove();
      skipBtn.remove();
      voteBtn.remove();
    },
  };
}
