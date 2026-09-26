// Pure cut-in mapping helpers (no DOM) — shared by cutin2d.js, avatar2d.js, audio.js and node tests.
//
//   planCutins(events)            → cut-in groups (anchor event + its money/log follow-ups)
//   poseFor(event, info)          → keypose id (idle|wave|jump|cheer|cry|shock)
//   expressionFor(emotion)        → { layer: joy|cry|shock|angry|null, overlay: heart|sweat|tears|null }
//   layerPlan(avail, want)        → which generated image to show for a character
//   avatarPalette / recolorPixels → per-avatar recolor of the shared `schoolgirl` layer set

export const TONES = ['love', 'career', 'treasure', 'good', 'bad', 'holiday', 'result', 'neutral'];
export const POSES = ['idle', 'wave', 'jump', 'cheer', 'cry', 'shock'];
export const EMOTION_GLYPH = { joy: '😆', cry: '😭', angry: '😡', sweat: '😅', love: '😍', shock: '😱' };
export const BIG_WIN = 100; // 만원: jump sprite threshold

/** Emotion → expression layer (generated `expr-*`) + procedural overlay. */
export function expressionFor(emotion) {
  switch (emotion) {
    case 'joy':
      return { layer: 'joy', overlay: null };
    case 'cry':
      return { layer: 'cry', overlay: 'tears' };
    case 'shock':
      return { layer: 'shock', overlay: null };
    case 'angry':
      return { layer: 'angry', overlay: null };
    case 'love':
      return { layer: null, overlay: 'heart' };
    case 'sweat':
      return { layer: null, overlay: 'sweat' };
    default:
      return { layer: null, overlay: null };
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

/** Follow-ups stop at these (they start their own step / group). */
const BOUNDARY = new Set([
  'turnStarted', 'spun', 'moved', 'landed', 'eraChanged', 'routeChosen', 'finished', 'bonusSpin', 'prompt', 'chose',
  'promptResolved', 'gameOver', 'betPlaced',
]);

/**
 * Group an engine batch into cut-ins. Every event with `cutin: true` except `prompt` (prompts are driven
 * by `room.turn.pending`, so a reload can rebuild them) becomes an anchor; its follow-up money/log events
 * (until the next boundary) give the dialogue text and effect chips.
 * @returns {{anchor: object, charId: string|null, texts: string[], money: {charId, delta, reason}[], delta: number, involved: string[]}[]}
 */
export function planCutins(events = []) {
  const groups = [];
  for (let i = 0; i < events.length; i++) {
    const a = events[i];
    if (!a || !a.cutin || a.type === 'prompt') continue;
    const follow = [];
    for (let j = i + 1; j < events.length && !BOUNDARY.has(events[j].type); j++) follow.push(events[j]);
    const charId = a.charId ?? null;
    const texts = follow.filter((e) => e.type === 'log' && e.text).map((e) => e.text);
    const money = follow.filter((e) => e.type === 'moneyChanged' && e.delta).map((e) => ({ charId: e.charId, delta: e.delta, reason: e.reason }));
    const delta = money.filter((m) => m.charId === charId).reduce((s, m) => s + m.delta, 0);
    const involved = [];
    const add = (id) => id && !involved.includes(id) && involved.push(id);
    add(charId);
    for (const m of money) add(m.charId);
    if (a.type === 'gameOver') for (const r of (a.ranking ?? []).slice(0, 3)) add(r.charId);
    groups.push({ anchor: a, charId, texts, money, delta, involved: involved.slice(0, 3) });
  }
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
  else if (anchor?.type === 'prompt') place = anchor.title ?? '선택';
  else if (anchor?.type === 'promptResolved') place = { exam: '수능 결과', groupGift: '생일 파티' }[anchor.kind] ?? '결과';
  return `${tone.icon ?? ''} ${tone.label ?? ''}${place ? ` · ${place}` : ''}`.trim();
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

// ---------- per-avatar recolor of the shared layer set ----------

function hexToRgb(hex) {
  const n = parseInt(String(hex ?? '#888888').slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

export function hslToRgb(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const f = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255];
}

const colorOf = (defs, key, id) => defs?.parts?.[key]?.find((o) => o.id === id)?.color ?? null;

/** Source palette of the generated `schoolgirl` set: blonde hair, navy uniform, light skin. */
export const BASE_PALETTE = { hair: '#e8c15a', outfit: '#1f2a52', skin: '#f6cfae' };

/**
 * Target colors for an avatar. `skin` is null for fair/light (the layers already have light skin).
 * @returns {{hair: string, outfit: string, skin: string|null, key: string}}
 */
export function avatarPalette(avatar = {}, defs = null) {
  const hair = colorOf(defs, 'hairColor', avatar.hairColor) ?? BASE_PALETTE.hair;
  const outfit = colorOf(defs, 'outfitColor', avatar.outfitColor) ?? '#4f8ee0';
  const skin = avatar.skin === 'tan' || avatar.skin === 'deep' ? colorOf(defs, 'skin', avatar.skin) : null;
  return { hair, outfit, skin, key: `${hair}|${outfit}|${skin ?? '-'}` };
}

/**
 * Recolor RGBA pixels in place: blonde hair → hair color, navy uniform → outfit color, skin (optional).
 * Pure (typed array in, same array out) so node tests can check it; the browser runs it on a canvas.
 */
export function recolorPixels(data, { hair, outfit, skin = null } = {}) {
  const H = hair ? rgbToHsl(...hexToRgb(hair)) : null;
  const O = outfit ? rgbToHsl(...hexToRgb(outfit)) : null;
  const SK = skin ? rgbToHsl(...hexToRgb(skin)) : null;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 8) continue;
    const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    let out = null;
    if (H && ((h >= 36 && h <= 64 && s > 0.28 && l > 0.2 && l < 0.93) || (h >= 30 && h < 36 && s > 0.3 && l > 0.2 && l < 0.55))) {
      out = hslToRgb(H[0], Math.min(1, H[1] * (0.6 + s * 0.5)), clamp(H[2] + (l - 0.62) * 0.9, 0.03, 0.95));
    } else if (O && h >= 195 && h <= 260 && s > 0.12 && l < 0.6) {
      out = hslToRgb(O[0], Math.min(1, O[1] * (0.5 + s * 0.8)), clamp(O[2] * 0.72 + (l - 0.25) * 1.1, 0.03, 0.95));
    } else if (SK && h >= 4 && h < 36 && s > 0.12 && l > 0.55) {
      out = hslToRgb(SK[0], SK[1], clamp(SK[2] + (l - 0.84) * 1.2, 0.05, 0.97));
    }
    if (out) {
      data[i] = out[0];
      data[i + 1] = out[1];
      data[i + 2] = out[2];
    }
  }
  return data;
}

/** CSS fallback when canvas recolor is unavailable: rotate the navy uniform hue toward the outfit color. */
export function hueFilterFor(avatar = {}, defs = null) {
  const { outfit } = avatarPalette(avatar, defs);
  const [h] = rgbToHsl(...hexToRgb(outfit));
  const rot = Math.round((((h - 225) % 360) + 360) % 360);
  return rot ? `hue-rotate(${rot}deg) saturate(1.1)` : 'none';
}
