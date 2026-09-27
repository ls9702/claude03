// Korean particle (조사) helpers shared by every server text (engine logs, lobby logs, presentation lines).
// Pure, no imports (lobby.js uses it too, and effects.js imports lobby.js).

/** true = the last syllable has a final consonant (받침), false = none, null = unknown (Latin, emoji…). */
export function hasBatchim(word) {
  const ch = String(word ?? '').trim().slice(-1);
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  if (/[0-9]/.test(ch)) return '013678'.includes(ch);
  return null;
}

/** Only the particle: particle('철수', '이/가') → '가'. Unknown final → '이(가)'. '으로/로' after ㄹ → '로'. */
export function particle(word, pair) {
  const [a, b] = pair.split('/');
  if (a === '으로') {
    const code = String(word ?? '').trim().slice(-1).charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 === 8) return b;
  }
  const f = hasBatchim(word);
  if (f === null) return `${a}(${b})`;
  return f ? a : b;
}

/** josa('철수', '이/가') → '철수가'. Unknown final → '철수이(가)'. '으로/로' after ㄹ → '로'. */
export const josa = (word, pair) => `${word}${particle(word, pair)}`;

// Particles a line template may put right after a placeholder ("{name}이 …"): [batchim form, vowel form].
const PAIRS = [
  ['으로', '로'],
  ['이', '가'],
  ['은', '는'],
  ['을', '를'],
  ['과', '와'],
];
const COPULA = /^이(?=[다야지라란랑나네든며에었여요군구죠잖])/; // 이다 / 이야 / 이라니 / 이나 … (vowel → dropped)

/**
 * Fix the particle written right after an inserted `value` in `rest` (the text that follows it): "{name}이 왔다"
 * with 뚱이 → "뚱이가 왔다", "{name}이다" → "뚱이다", "{era}는" with 청년 → "청년은". Unknown finals keep the
 * template's particle. @returns the corrected `rest`
 */
export function fixParticle(value, rest) {
  const f = hasBatchim(value);
  if (f === null || !rest) return rest;
  // copula 이 (이다 / 이야 / 이라니 / 이나…): kept after a final consonant, dropped after a vowel
  if (COPULA.test(rest)) return f ? rest : rest.slice(1);
  const lastRieul = (() => {
    const code = String(value).trim().slice(-1).charCodeAt(0);
    return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 === 8;
  })();
  for (const [withB, noB] of PAIRS) {
    for (const form of [withB, noB]) {
      if (!rest.startsWith(form)) continue;
      const after = rest.slice(form.length);
      if (/^[가-힣]/.test(after)) continue; // part of a longer word (e.g. "가게", "는데"), not a lone particle
      const want = withB === '으로' ? (f && !lastRieul ? withB : noB) : f ? withB : noB;
      return want + after;
    }
  }
  return rest;
}
