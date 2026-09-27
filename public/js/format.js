// Shared client formatting helpers.

/** Money in 만원 units → '1억 2,000만원' / '350만원' (same as server effects.won). */
export function won(n) {
  const sign = n < 0 ? '-' : '';
  const v = Math.abs(Math.round(n ?? 0));
  if (v >= 10000) {
    const eok = Math.floor(v / 10000);
    const man = v % 10000;
    return `${sign}${eok}억${man ? ` ${man.toLocaleString('ko-KR')}만` : ''}원`;
  }
  return `${sign}${v.toLocaleString('ko-KR')}만원`;
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- bidi safety (post-simulation fixes, A10) ----------
/**
 * Bidi control characters (embeddings / overrides U+202A–202E, isolates U+2066–2069, marks U+200E/200F/061C): a name
 * with U+202E used to flip every following character of the HUD / toasts / cut-ins. The client strips them from every
 * server payload (api.js) and from names typed into the forms; names are also isolated (<bdi>) where interpolated.
 */
export const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/g;
/** JSON text escapes of the same characters (`\u202e`) — stripped from raw payload text before JSON.parse. */
const BIDI_ESCAPES = /\\u(?:202[a-eA-E]|206[6-9]|200[eEfF]|061[cC])/g;
export const stripBidi = (s) => String(s ?? '').replace(BIDI_CONTROLS, '');
/** Raw JSON text → the same text without bidi controls (literal or `\uXXXX`-escaped). */
export const stripBidiJson = (text) => String(text ?? '').replace(BIDI_CONTROLS, '').replace(BIDI_ESCAPES, '');
/** Escaped name markup isolated from the surrounding text (`<bdi>`): RTL letters never reorder the sentence. */
export const nameHtml = (name) => `<bdi>${esc(stripBidi(name))}</bdi>`;
/** Plain-text isolate (FSI … PDI) for textContent / toasts / canvas labels. */
export const isoName = (name) => `\u2068${stripBidi(name)}\u2069`;

// ---------- Korean particles (mirror of server/game/effects.js josa) ----------
const ISOLATES = /[\u2066-\u2069]/g;
function hasBatchim(word) {
  const ch = String(word ?? '').replace(ISOLATES, '').trim().slice(-1);
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  if (/[0-9]/.test(ch)) return '013678'.includes(ch);
  return null;
}
/**
 * josa('철수', '이/가') → '철수가', josa('뚱이', '이/가') → '뚱이가' (never 「뚱이이(가)」); unknown final (latin, emoji)
 * → '철수이(가)'. '으로/로' after ㄹ → '로'. Same rules as the server's `effects.josa`.
 */
export function josa(word, pair) {
  const [a, b] = String(pair).split('/');
  const w = String(word ?? '');
  if (a === '으로') {
    const code = w.replace(ISOLATES, '').trim().slice(-1).charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 === 8) return `${w}${b}`;
  }
  const f = hasBatchim(w);
  if (f === null) return `${w}${a}(${b})`;
  return `${w}${f ? a : b}`;
}

// ---------- names: grapheme-aware length (the server's NAME_MAX = 12) ----------
export const NAME_MAX = 12;

/** User-perceived characters (Intl.Segmenter graphemes; code points as a fallback). */
export function graphemes(s) {
  const str = String(s ?? '');
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) return [...new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(str)].map((x) => x.segment);
  } catch {
    /* fall through */
  }
  return [...str];
}
/** Longest accepted name in UTF-16 units (server `NAME_MAX_UNITS`: zalgo / huge ZWJ chains are 1 grapheme each). */
export const NAME_MAX_UNITS = 64;
// Same cleaning as the server's lobby `cleanName`: invisible / bidi format controls (Cf), other controls (Cc) and the
// Hangul / braille fillers are dropped; a zero-width joiner survives only inside an emoji sequence (👨‍👩‍👧).
const INVISIBLE_RE = /[\p{Cc}\p{Cf}\u115F\u1160\u3164\uFFA0\u2800]/gu;
const ZWJ = '\u200D';
const PICTO_RE = /\p{Extended_Pictographic}/u;
const EMOJI_MOD_RE = /[\uFE0E\uFE0F\u{1F3FB}-\u{1F3FF}]/u;
/** A typed name as the server will store it (NFC, invisible characters removed, whitespace collapsed, trimmed). */
export function cleanName(name) {
  const cps = [...String(name ?? '').normalize('NFC')];
  let out = '';
  for (let i = 0; i < cps.length; i++) {
    const ch = cps[i];
    if (ch === ZWJ) {
      const prev = [...out].reverse().find((x) => !EMOJI_MOD_RE.test(x)) ?? '';
      if (PICTO_RE.test(prev) && PICTO_RE.test(cps[i + 1] ?? '')) out += ch;
      continue;
    }
    out += ch.replace(INVISIBLE_RE, '');
  }
  return out.replace(/\s+/g, ' ').trim();
}
/** Graphemes the server counts (after its cleaning): the n/12 counter shows exactly this (A10). */
export const nameLength = (s) => graphemes(cleanName(s)).length;
/** Cut to `max` graphemes (never splits an emoji / combined Hangul syllable). */
export function clampName(s, max = NAME_MAX) {
  const g = graphemes(s);
  return g.length > max ? g.slice(0, max).join('') : String(s ?? '');
}
/** Accepted by the server: 1..12 graphemes after cleaning and ≤ NAME_MAX_UNITS UTF-16 units. */
export const nameFits = (s, max = NAME_MAX) => {
  const n = cleanName(s);
  return graphemes(n).length <= max && n.length <= NAME_MAX_UNITS;
};

// ---------- server clock (countdowns use the server's `deadlineAt`) ----------
/**
 * Narrow the server−local clock offset from an HTTP `Date` header (1 s resolution) seen between `sentAt` and
 * `receivedAt` (local ms). Returns new bounds {lo, hi, offset}; offset = best estimate (0 until known).
 */
export function clockBounds(prev, { date, sentAt, receivedAt }) {
  const d = typeof date === 'number' ? date : Date.parse(date);
  if (!Number.isFinite(d) || !Number.isFinite(sentAt) || !Number.isFinite(receivedAt)) return prev ?? { lo: -Infinity, hi: Infinity, offset: 0 };
  const lo = d - receivedAt;
  const hi = d + 1000 - sentAt;
  let nlo = Math.max(prev?.lo ?? -Infinity, lo);
  let nhi = Math.min(prev?.hi ?? Infinity, hi);
  if (nlo > nhi) {
    // the local clock jumped (or the server's) → start over from this sample
    nlo = lo;
    nhi = hi;
  }
  return { lo: nlo, hi: nhi, offset: Math.round((nlo + nhi) / 2) };
}

/** Whole seconds left until a server deadline (ms epoch). */
export const secondsLeft = (deadlineAt, now = Date.now(), offset = 0) => Math.max(0, Math.ceil((Number(deadlineAt) - (now + offset)) / 1000));

// ---------- CPU players (Stage 9-C, feature-detected) ----------
/** A CPU-controlled character (`character.cpu` or owner id 'cpu'). */
export const isCpu = (c) => !!c && (c.cpu === true || (c.cpu && typeof c.cpu === 'object') || c.ownerId === 'cpu');
/** Small 「🤖 CPU」 badge markup ('' for human players). */
export const cpuBadgeHtml = (c) => (isCpu(c) ? '<span class="cpu-badge" title="컴퓨터 플레이어">🤖 CPU</span>' : '');
/** Owner label markup: the escaped owner name, or only the 「🤖 CPU」 badge for CPU characters (their owner name is 'CPU'). */
export const ownerHtml = (c) => (isCpu(c) ? cpuBadgeHtml(c) : esc(c?.ownerName ?? ''));
