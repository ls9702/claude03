// Pure cut-in mapping helpers (no DOM) — shared by cutin2d.js, avatar2d.js, audio.js and node tests.
//
//   planCutins(events)            → cut-in groups (anchor event + its money/log follow-ups)
//   poseFor(event, info)          → keypose id (idle|wave|jump|cheer|cry|shock)
//   expressionFor(emotion)        → { layer: joy|cry|shock|angry|null, overlay: heart|sweat|tears|null }
//   layerPlan(avail, want)        → which generated image of a layer set to show (job/era costumes, Stage 6)
//   resolveCharacterArt(char, want) → AI art (Stage 5.5-D) > paper-doll layers (Stage 5.5-C) for a character

export const TONES = ['love', 'career', 'treasure', 'good', 'bad', 'holiday', 'result', 'neutral'];
export const POSES = ['idle', 'wave', 'jump', 'cheer', 'cry', 'shock'];
export const EMOTION_GLYPH = { joy: '😆', cry: '😭', angry: '😡', sweat: '😅', love: '😍', shock: '😱' };
export const BIG_WIN = 100; // 만원: jump sprite threshold

/**
 * Emotion → `layer` (expression image of a generated / AI layer set: joy cry shock angry), `part` (paper-doll
 * expression layer, partStack EXPRESSIONS: joy cry shock angry love sweat shy) + procedural overlay.
 */
export function expressionFor(emotion) {
  switch (emotion) {
    case 'joy':
      return { layer: 'joy', part: 'joy', overlay: null };
    case 'cry':
      return { layer: 'cry', part: 'cry', overlay: 'tears' };
    case 'shock':
      return { layer: 'shock', part: 'shock', overlay: null };
    case 'angry':
      return { layer: 'angry', part: 'angry', overlay: null };
    case 'love':
      return { layer: null, part: 'love', overlay: 'heart' };
    case 'sweat':
      return { layer: null, part: 'sweat', overlay: 'sweat' };
    case 'shy':
      return { layer: null, part: 'shy', overlay: null };
    default:
      return { layer: null, part: null, overlay: null };
  }
}

/**
 * Keypose for a character in a cut-in.
 * @param {object} event  anchor event (type, tone, emotion, tileType, place…)
 * @param {{delta?: number}} info  net money change of that character in the group
 */
export function poseFor(event, { delta = 0 } = {}) {
  const t = event?.type;
  const emotion = event?.emotion;
  if (t === 'spun' || t === 'moved' || t === 'turnStarted') return 'wave';
  if (t === 'finished' || t === 'gameOver' || event?.lineTag === 'goal' || event?.lineTag === 'goal_first') return 'cheer';
  if (emotion === 'shock') return 'shock';
  if (emotion === 'cry') return 'cry';
  if (delta > 0 && (event?.tone === 'good' || event?.tone === 'treasure' || emotion === 'joy')) return 'jump';
  // an explicit emotion (joy/sweat/angry/love) shows as expression + overlay on the idle stance
  if (event?.tone === 'bad' && (!emotion || emotion === 'neutral')) return 'cry';
  if (t === 'eraChanged') return 'wave';
  if (t === 'routeChosen') return 'cheer';
  return 'idle';
}

/** Big wins get the jump sprite animation. */
export const isBigWin = (event, delta = 0) => delta >= BIG_WIN || (event?.type === 'finished' && event.place === 1);

/**
 * Pick the generated image for a character.
 * Priority: outfit (job/era costume, neutral only) > pose (face baked in) > expression layer > base.
 * @param {{base?, poses?: Record<string,string>, expressions?: Record<string,string>, outfits?: Record<string,string>}} avail
 *   urls of accepted layers for the character base
 * @param {{pose?, emotion?, outfit?}} want
 * @returns {{url: string|null, source: 'outfit'|'pose'|'expression'|'base'|null, pose: string, overlay: string|null}}
 */
export function layerPlan(avail = {}, { pose = 'idle', emotion = null, outfit = null } = {}) {
  const expr = expressionFor(emotion);
  if (outfit && avail.outfits?.[outfit]) return { url: avail.outfits[outfit], source: 'outfit', pose: 'idle', overlay: expr.overlay };
  if (pose && pose !== 'idle' && avail.poses?.[pose]) {
    // pose images carry their own face; the cry pose already has tears
    return { url: avail.poses[pose], source: 'pose', pose, overlay: pose === 'cry' ? null : expr.overlay };
  }
  if (expr.layer && avail.expressions?.[expr.layer]) return { url: avail.expressions[expr.layer], source: 'expression', pose: 'idle', overlay: expr.overlay };
  const idle = avail.poses?.idle ?? avail.base ?? null;
  return { url: idle, source: idle ? 'base' : null, pose: 'idle', overlay: expr.overlay };
}

// ---------- cut-in groups ----------

/** Stage 6 cut-in anchors (always anchors, even from a server that doesn't flag them `cutin`). */
export const STAGE6_ANCHORS = new Set(['jobChanged', 'rankUp', 'hiddenJobUnlocked', 'injured', 'newsFlash', 'militaryStart', 'educationChanged']);

/** Stage 7 cut-in anchors (always anchors): 방어, 쇼핑, 명절, 로또. `cardUsed` is one only for sabotage / 공약. */
export const STAGE7_ANCHORS = new Set(['cardBlocked', 'itemBought', 'holidayStarted', 'holidayResult', 'lottoDraw']);
/** Cards whose use is a cut-in (besides sabotage cards, recognised by their `targetId`). */
export const ANCHOR_CARDS = new Set(['pledge']);
/** Stage 7 events that become their own (banner) group when no anchor covers them. */
export const STAGE7_LONE = new Set(['cardGained', 'gift', 'tradeResolved', 'cardUsed']);

/** `cardUsed` that is a cut-in anchor: sabotage (has a target) or 공약, or flagged by the server. */
export const isCardAnchor = (e) => e?.type === 'cardUsed' && (!!e.targetId || ANCHOR_CARDS.has(e.cardId));
const isAnchor = (e) => !!e && e.type !== 'prompt' && (e.cutin || STAGE6_ANCHORS.has(e.type) || STAGE7_ANCHORS.has(e.type) || isCardAnchor(e));

/** Follow-ups stop at these (they start their own step / group). */
const BOUNDARY = new Set([
  'turnStarted', 'spun', 'moved', 'landed', 'eraChanged', 'routeChosen', 'finished', 'bonusSpin', 'prompt', 'chose',
  'promptResolved', 'gameOver', 'betPlaced', ...STAGE6_ANCHORS, ...STAGE7_ANCHORS, 'tradeOffered', 'tradeResolved',
]);

const newsOf = (e) => ({ eraId: e.eraId, newsId: e.newsId, title: e.title, text: e.text, tone: e.tone });

/**
 * Group an engine batch into cut-ins. Every event with `cutin: true` except `prompt` (prompts are driven
 * by `room.turn.pending`, so a reload can rebuild them) becomes an anchor; its follow-up money/log events
 * (until the next boundary) give the dialogue text and effect chips.
 * Stage 6: statChanged / salary / militaryEnd follow-ups → `stats[]` / `salary[]` / `discharged[]` chips; a militaryEnd
 * with no anchor before it becomes its own group (→ banner). The batch's newsFlash is folded into the era's studio
 * group (`news`, its MC lines appended to `studio`); without a studio group it stays a news cut-in (`news` set when it
 * carries its own studio lines).
 * @returns {{anchor: object, charId: string|null, texts: string[], money: {charId, delta, reason}[], delta: number, involved: string[],
 *   mc: object[]|null, studio: object[]|null, mcEvents: object[], stats: object[], salary: object[], discharged: string[], news?: object}[]}
 */
export function planCutins(events = []) {
  const groups = [];
  const covered = new Set();
  const build = (i, a) => {
    const follow = [];
    for (let j = i + 1; j < events.length && !BOUNDARY.has(events[j].type); j++) {
      follow.push(events[j]);
      covered.add(j);
    }
    const charId = a.charId ?? (a.type === 'gift' || a.type === 'tradeResolved' ? a.fromId ?? null : null);
    const texts = follow.filter((e) => e.type === 'log' && e.text).map((e) => e.text);
    const money = follow.filter((e) => e.type === 'moneyChanged' && e.delta).map((e) => ({ charId: e.charId, delta: e.delta, reason: e.reason }));
    const delta = money.filter((m) => m.charId === charId).reduce((s, m) => s + m.delta, 0);
    // Stage 6 follow-ups → effect chips: stat changes ("지력 +1"), pay days ("월급 +320만원"), 전역
    const stats = follow.filter((e) => e.type === 'statChanged' && e.delta).map((e) => ({ charId: e.charId, stat: e.stat, delta: e.delta, value: e.value, reason: e.reason }));
    const salary = follow.filter((e) => e.type === 'salary').map((e) => ({ charId: e.charId, jobId: e.jobId, rank: e.rank, amount: e.amount }));
    const discharged = follow.filter((e) => e.type === 'militaryEnd' && e.charId).map((e) => e.charId);
    // Stage 7 follow-ups → chips: cards gained / used (non-anchor), gifts
    const cards = follow.filter((e) => e.type === 'cardGained' || (e.type === 'cardUsed' && !isCardAnchor(e))).map((e) => ({ type: e.type, charId: e.charId, cardId: e.cardId, source: e.source ?? null }));
    const gifts = follow.filter((e) => e.type === 'gift').map((e) => ({ fromId: e.fromId, toId: e.toId, money: e.money ?? null, cardId: e.cardId ?? null }));
    const involved = [];
    const add = (id) => id && !involved.includes(id) && involved.push(id);
    add(charId);
    // sabotage / block: attacker + target on stage (the target second → right side)
    if (a.type === 'cardUsed' || a.type === 'cardBlocked') add(a.targetId);
    if (a.type === 'gift') add(a.toId);
    if (a.type === 'tradeResolved') add(a.toId);
    for (const m of money) add(m.charId);
    if (a.type === 'gameOver') for (const r of (a.ranking ?? []).slice(0, 3)) add(r.charId);
    if (a.type === 'holidayResult') for (const r of a.results ?? []) add(r.charId);
    if (a.type === 'lottoDraw') for (const r of a.entries ?? a.winners ?? []) add(r.charId);
    // Stage 5.6 MCs: a studio anchor (game start / first entry into an era) opens its own MC cut-in (`studio`);
    // the small MC corner of the event cut-in takes the anchor's lines, else the first follow-up's (e.g. pension).
    const mcFollow = follow.find((e) => e.mc?.length);
    const mc = (!a.mcStudio && a.mc?.length ? a.mc : null) ?? mcFollow?.mc ?? null;
    const mcEvents = [a.mc?.length ? a : null, mcFollow ?? null].filter(Boolean);
    const studio = a.mcStudio && a.mc?.length ? a.mc : null;
    const targetId = a.targetId ?? a.toId ?? null;
    return { anchor: a, charId, targetId, texts, money, delta, involved: involved.slice(0, 3), mc, studio, mcEvents, stats, salary, discharged, cards, gifts, _i: i };
  };
  for (let i = 0; i < events.length; i++) {
    const a = events[i];
    if (!isAnchor(a)) continue;
    groups.push(build(i, a));
  }
  // 전역 / Stage 7 card · gift · trade events without an anchor in front of them → their own (banner) group
  events.forEach((e, i) => {
    if (covered.has(i) || isAnchor(e)) return;
    if (e?.type === 'militaryEnd' || STAGE7_LONE.has(e?.type)) groups.push(build(i, e));
  });
  groups.sort((x, y) => x._i - y._i);
  // Stage 6 news: fold into the era studio group of the batch (one MC studio cut-in with the 📰 strip)
  const studioGroup = groups.find((g) => g.studio && g.anchor.type !== 'newsFlash');
  for (const g of [...groups]) {
    if (g.anchor.type !== 'newsFlash') continue;
    if (studioGroup) {
      studioGroup.news ??= newsOf(g.anchor);
      if (g.anchor.mc?.length) {
        studioGroup.studio = [...studioGroup.studio, ...g.anchor.mc];
        studioGroup.mcEvents = [...studioGroup.mcEvents, g.anchor];
      }
      groups.splice(groups.indexOf(g), 1);
    } else {
      g.news = newsOf(g.anchor);
      if (g.anchor.mc?.length && !g.studio) g.studio = g.anchor.mc; // its own studio lines (봄이 reads the headline)
    }
  }
  for (const g of groups) delete g._i;
  return groups;
}

/** Fallback dialogue text when a group has no log line. */
export function fallbackText(anchor, name = '') {
  switch (anchor?.type) {
    case 'eraChanged':
      return `${name} — ${anchor.eraName ?? ''} 시대 시작!`;
    case 'routeChosen':
      return `${name}의 새 루트!`;
    case 'finished':
      return `${name} ${anchor.place}등으로 골인!`;
    case 'gameOver':
      return '게임 종료! 결과 발표';
    case 'rankUp':
      return `${name} 승진!${anchor.rankName ? ` 이제 ${anchor.rankName}!` : ''}`;
    case 'jobChanged':
      return `${name}의 새 직업!`;
    case 'hiddenJobUnlocked':
      return `${name}, 숨은 직업의 문이 열렸다!`;
    case 'injured':
      return `${name} 부상…${anchor.turns ? ` ${anchor.turns}턴 동안 쉬어야 해요.` : ''}`;
    case 'militaryStart':
      return `${name} 입대! 충성!${anchor.turns ? ` (${anchor.turns}턴 복무)` : ''}`;
    case 'militaryEnd':
      return `${name} 전역! 수고했어요.`;
    case 'educationChanged':
      return `${name} 졸업 축하해요! 🎓`;
    case 'newsFlash':
      return anchor.title ?? '뉴스 속보';
    case 'cardUsed':
      return anchor.targetId ? `${name}의 뒤통수 카드 발동!` : `${name} 카드 사용!`;
    case 'cardBlocked':
      return '변호사가 막아 냈다! 뒤통수 실패!';
    case 'itemBought':
      return `${name} 쇼핑 성공!`;
    case 'holidayStarted':
      return anchor.kind === 'chuseok' ? '추석 대잔치가 열렸어요! 🌕' : anchor.kind === 'seol' ? '설날 대잔치가 열렸어요! 🧧' : '명절 대잔치가 열렸어요!';
    case 'holidayResult':
      return '명절 정산 결과!';
    case 'lottoDraw':
      return '전국 로또 추첨!';
    case 'cardGained':
      return `${name} 카드 획득!`;
    case 'gift':
      return `${name}의 선물!`;
    case 'tradeResolved':
      return anchor.status === 'accepted' ? '거래 성사!' : '거래 불발…';
    default:
      return anchor?.line ?? '';
  }
}

/** Tag chip text for the illustration window ("💕 연애·육아 · 하트 칸"). */
export function tagLabel(anchor, { tones = {}, tileTypes = {}, routes = {} } = {}) {
  const tone = tones[anchor?.tone] ?? tones.neutral ?? { icon: '', label: '' };
  let place = '';
  if (anchor?.type === 'landed') place = `${tileTypes[anchor.tileType]?.name ?? ''} 칸`;
  else if (anchor?.type === 'eraChanged') place = `${anchor.eraName ?? ''} 시대`;
  else if (anchor?.type === 'routeChosen') place = `${routes[anchor.route]?.name ?? anchor.route} 루트`;
  else if (anchor?.type === 'finished') place = '골인';
  else if ((anchor?.type === 'gameOver' || anchor?.type === 'result') && anchor?.tone !== 'result') place = '결과 발표';
  else if (anchor?.type === 'prompt') return promptTag(anchor, tone);
  else if (anchor?.type === 'promptResolved') place = { exam: '수능 결과', groupGift: '생일 파티', habit: '습관', jobTile: '직업 칸', career: '진로', military: '군 복무', shop: '상점', holiday: '명절' }[anchor.kind] ?? '결과';
  else if (STAGE6_TAGS[anchor?.type]) return STAGE6_TAGS[anchor.type](anchor);
  else if (STAGE7_TAGS[anchor?.type]) return STAGE7_TAGS[anchor.type](anchor);
  // the tone label repeats the route name for routes ("💕 연애·육아 · 연애·육아 루트") → keep just the place
  if (place && tone.label && place.startsWith(tone.label)) return `${tone.icon ?? ''} ${place}`.trim();
  return `${tone.icon ?? ''} ${tone.label ?? ''}${place ? ` · ${place}` : ''}`.trim();
}

/** Stage 6 anchors: own tag (the tone label would repeat / contradict it). */
const STAGE6_TAGS = {
  jobChanged: (a) =>
    a.reason === 'parttime' ? '🧾 알바 시작' : a.reason === 'hidden' ? '🌟 숨은 직업 전직' : a.reason === 'change' || (a.fromJobId && a.fromJobId !== 'parttime') ? '💼 전직' : '💼 취업',
  rankUp: () => '🎉 승진',
  hiddenJobUnlocked: () => '🌟 숨은 직업 해금',
  injured: () => '🤕 부상',
  newsFlash: () => '📰 뉴스 속보',
  militaryStart: () => '🪖 입대',
  militaryEnd: () => '🪖 전역',
  educationChanged: () => '🎓 졸업',
};

/** Stage 7 anchors / lone groups: own tag. */
const STAGE7_TAGS = {
  cardUsed: (a) => (a.cardId === 'pledge' ? '🗳️ 공약 카드' : a.targetId ? '💢 뒤통수 카드' : '🃏 카드 사용'),
  cardBlocked: () => '🛡️ 방어 성공',
  itemBought: () => '🛍️ 쇼핑',
  holidayStarted: (a) => (a.kind === 'chuseok' ? '🌕 추석 대잔치' : a.kind === 'seol' ? '🧧 설날 대잔치' : '🎉 명절 대잔치'),
  holidayResult: (a) => (a.kind === 'chuseok' ? '🌕 추석 정산' : a.kind === 'seol' ? '🧧 설날 정산' : '🎴 명절 정산'),
  lottoDraw: () => '🎱 전국 로또',
  cardGained: () => '🃏 카드 획득',
  gift: () => '🎁 선물',
  tradeResolved: (a) => (a.status === 'accepted' ? '🤝 거래 성사' : '🤝 거래 불발'),
};

/** Prompt tag = its title only (the tone label would repeat / contradict it: "💼 일·커리어 · 📝 수능 날"). */
function promptTag(anchor, tone) {
  const title = String(anchor?.title ?? '선택').trim();
  if (anchor?.kind === 'routeChoice' && !/^\p{Extended_Pictographic}/u.test(title)) return `🔀 ${title}`;
  return /^\p{Extended_Pictographic}/u.test(title) ? title : `${tone?.icon ?? '❓'} ${title}`.trim();
}

/** Spectators' cut-ins auto-advance; the owner gets longer; prompts never (deadline handles them). */
export function autoAdvanceMs({ owner = false, prompt = false, reduced = false } = {}) {
  if (prompt) return 0;
  return owner ? 7000 : reduced ? 3000 : 4000;
}

/** Sound effect for an engine event (tones.json `sfx` map; null = silent). */
export function sfxForEvent(e, sfx = {}) {
  if (!e) return null;
  switch (e.type) {
    case 'moneyChanged':
      return e.delta > 0 ? sfx.moneyGain ?? 'coin' : e.delta < 0 ? sfx.moneyLoss ?? 'thud' : null;
    case 'betResolved':
      return (e.results ?? []).some((r) => r.won) ? sfx.betWin ?? 'coin' : sfx.betLose ?? 'thud';
    case 'log':
    case 'turnStarted':
    case 'chose':
    case 'betPlaced':
    case 'gameStarted':
      return null;
    default:
      return sfx[e.type] ?? null;
  }
}

// ---------- character art source (Stage 5.5-C) ----------

/** Part expression layers of the paper-doll compositor (mirrors shared/partStack.js EXPRESSIONS). */
export const PART_EXPRESSIONS = ['joy', 'cry', 'shock', 'angry', 'love', 'sweat', 'shy'];
/** Expression files of a character's AI art (Stage 5.5-D). */
export const AI_EXPRESSIONS = ['joy', 'cry', 'shock', 'angry'];

/**
 * Which picture shows a character in a cut-in / portrait. Priority: AI art (`character.art.status === 'ready'`)
 * > paper-doll layers (composed in the browser; the caller falls back to the SVG portrait when they're missing).
 * AI art: the pose file for a non-idle pose (its face is baked in), else the expression file when an expression
 * is asked for, else the idle pose / base. Paper-doll layers only have the neutral standing pose: the pose is
 * played as procedural motion (`motion`) and the expression becomes the part expression layer.
 * @param {{avatar?: object, art?: {status?: string, files?: {base?, poses?: object, expressions?: object}}}} character
 * @param {{pose?: string, expression?: string|null, portrait?: boolean}} want  `portrait` → AI base (bust) first
 * @returns {{source: 'ai'|'layers', url: string|null, kind: 'pose'|'expression'|'base'|'layers', pose: string,
 *            expression: string|null, motion: string}}
 */
export function resolveCharacterArt(character, { pose = 'idle', expression = null, portrait = false } = {}) {
  const motion = POSES.includes(pose) ? pose : 'idle';
  const art = character?.art;
  const files = art?.status === 'ready' && art.files && typeof art.files === 'object' ? art.files : null;
  if (files) {
    const str = (v) => (typeof v === 'string' && v ? v : null);
    const base = str(files.base);
    const idle = str(files.poses?.idle);
    if (portrait) {
      const url = base ?? idle;
      if (url) return { source: 'ai', url, kind: base ? 'base' : 'pose', pose: 'idle', expression: null, motion: 'idle' };
    } else {
      const poseUrl = motion !== 'idle' ? str(files.poses?.[motion]) : null;
      if (poseUrl) return { source: 'ai', url: poseUrl, kind: 'pose', pose: motion, expression: null, motion };
      const exprUrl = AI_EXPRESSIONS.includes(expression) ? str(files.expressions?.[expression]) : null;
      if (exprUrl) return { source: 'ai', url: exprUrl, kind: 'expression', pose: 'idle', expression, motion };
      const url = idle ?? base;
      if (url) return { source: 'ai', url, kind: idle ? 'pose' : 'base', pose: 'idle', expression: null, motion };
    }
  }
  const expr = PART_EXPRESSIONS.includes(expression) ? expression : null;
  return { source: 'layers', url: null, kind: 'layers', pose: 'idle', expression: portrait ? null : expr, motion: portrait ? 'idle' : motion };
}

// ---------- scenes (Stage 7: scene fallbacks) ----------
/**
 * Background of a cut-in scene: the scene's own generated bg (tones.json `scenes[scene].bg`, else
 * `findAsset({kind:'bg', scene})`); when missing, follow `sceneFallbacks` (stage→wedding-hall, shop→office, …) up
 * to 4 hops; else the first scene of that chain the cut-in can draw as SVG (`SVG_SCENES`).
 * @param {string} scene
 * @param {{presentation?: object, assetUrl?: (id) => string|null, findBg?: (scene) => string|null}} ctx
 * @returns {{scene: string, url: string|null, svgScene: string, via: string[]}}
 */
export function resolveSceneBg(scene, { presentation = {}, assetUrl = () => null, findBg = () => null } = {}) {
  const none = { scene: scene ?? 'none', url: null, svgScene: 'none', via: [] };
  if (!scene || scene === 'none') return none;
  const scenes = presentation?.scenes ?? {};
  const fb = presentation?.sceneFallbacks ?? {};
  const via = [];
  for (let s = scene; s && !via.includes(s) && via.length < 5; s = fb[s]) {
    via.push(s);
    const bgId = scenes[s]?.bg;
    const url = (bgId && assetUrl(bgId)) || findBg(s) || null;
    if (url) return { scene: s, url, svgScene: s, via };
  }
  return { scene, url: null, svgScene: via.find((x) => SVG_SCENES.has(x)) ?? scene, via };
}
/** Scenes the cut-in can draw as SVG without a generated background. */
export const SVG_SCENES = new Set(['school', 'office', 'hospital', 'wedding-hall', 'mountain-trail', 'studio', 'shop', 'holiday']);
