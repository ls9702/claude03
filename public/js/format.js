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
