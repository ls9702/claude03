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
export const nameLength = (s) => graphemes(s).length;
/** Cut to `max` graphemes (never splits an emoji / combined Hangul syllable). */
export function clampName(s, max = NAME_MAX) {
  const g = graphemes(s);
  return g.length > max ? g.slice(0, max).join('') : String(s ?? '');
}
/** Also within the server's code-point count (it counts [...name].length). */
export const nameFits = (s, max = NAME_MAX) => nameLength(s) <= max && [...String(s ?? '')].length <= max;

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
/** Small 「🤖 CPU」 badge markup after an owner name ('' for human players). */
export const cpuBadgeHtml = (c) => (isCpu(c) ? ' <span class="cpu-badge" title="컴퓨터 플레이어">🤖 CPU</span>' : '');
