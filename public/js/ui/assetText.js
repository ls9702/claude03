// Admin asset studio text helpers (pure, node-tested in test/client-lobbytext.test.js).

const pad = (n) => String(n).padStart(2, '0');

/** 「2026.10.16 05:26」 (local time; compact, one unit that never wraps inside). */
export function shortDate(ms) {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Caption parts of an accepted asset (each part is shown as one unbreakable chunk):
 * generated → 「후보 #n · model」, hand upload → 「업로드」, `scripts/import-assets.js` → 「가져오기 (file)」.
 * @param {object} acc  manifest `accepted` {source, candidate, model, from, acceptedAt, generatedAt, width, height}
 * @returns {string[]}
 */
export function acceptedCaption(acc) {
  if (!acc) return [];
  const parts = [];
  if (acc.source === 'upload') parts.push('업로드');
  else if (acc.source === 'import') parts.push(acc.from ? `가져오기 (${String(acc.from).split(/[\\/]/).pop()})` : '가져오기');
  else {
    const n = Number(acc.candidate);
    parts.push(Number.isInteger(n) && n > 0 ? `후보 #${n}` : '생성');
    if (acc.model && acc.model !== 'upload' && acc.model !== 'import') parts.push(String(acc.model));
  }
  const when = shortDate(Date.parse(acc.acceptedAt || acc.generatedAt || ''));
  if (when) parts.push(when);
  if (acc.width && acc.height) parts.push(`${acc.width}×${acc.height}`);
  return parts;
}
