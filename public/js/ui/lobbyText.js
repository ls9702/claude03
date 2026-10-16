// Lobby / result page text helpers (pure, node-tested in test/client-lobbytext.test.js).
//   modeSummary(room, meta) → {title, extras[], eras[]}  the lobby's mode line: 「인생 전체 · 초기 자금 1,000만원 · 🎯 룰렛 실력 모드」
//                                                         + the era list 「아기 3턴 · … · 노년 🏁 40칸」 (the world has its own line)
//   scrollCue({scrollLeft, scrollWidth, clientWidth}) → '' | 'left' | 'right' | 'both'  (which side of a scroller hides more)

/**
 * @param {object} room  lobby room view (config.mode / eraTurns / finalLength / startingMoney / rouletteMode)
 * @param {object} meta  /api/meta (eras.modes, eras.eras)
 */
export function modeSummary(room, meta) {
  const cfg = room?.config ?? {};
  const eras = meta?.eras;
  const mode = eras?.modes?.[cfg.mode];
  const extras = [];
  if (Number.isFinite(cfg.startingMoney)) extras.push(`초기 자금 ${cfg.startingMoney.toLocaleString('ko-KR')}만원`);
  if (cfg.rouletteMode === 'skill') extras.push('🎯 룰렛 실력 모드');
  if (!mode) return { title: String(cfg.mode ?? ''), extras, eras: [] };
  // loop maps: turns per era; the final 노년 era of lifetime / adult mode is a goal race of `finalLength` tiles
  const list = mode.eras.map((id, i) => {
    const era = eras.eras?.find((e) => e.id === id);
    const name = era?.name ?? id;
    const race = i === mode.eras.length - 1 && id === 'senior' && Number.isInteger(cfg.finalLength);
    return race ? `${name} 🏁 ${cfg.finalLength}칸` : `${name} ${cfg.eraTurns?.[id] ?? '-'}턴`;
  });
  return { title: mode.name, extras, eras: list };
}

/** Which edge of a horizontal scroller still hides content (for an edge fade). */
export function scrollCue({ scrollLeft = 0, scrollWidth = 0, clientWidth = 0 } = {}) {
  if (scrollWidth - clientWidth <= 1) return '';
  const left = scrollLeft > 1;
  const right = scrollLeft + clientWidth < scrollWidth - 1;
  return left && right ? 'both' : left ? 'left' : right ? 'right' : '';
}
