// Stage 9 — pure placement of the 3D 시상대 pawns (no three / DOM; node-tested).
// Steps: 1 centre (x 0), 2 left (x −2.3), 3 right (x +2.3); tied characters share a step side by side. Everyone else
// stands on the stage floor in two flanks beside the podium (alternating left / right, stepping outwards and back).

export const STEP_X = { 1: 0, 2: -2.3, 3: 2.3 };
const STEP_W = 2.2;

/**
 * @param {number[]} steps  per character: 1 | 2 | 3 (podium step) or 0 (others), in ranking order
 * @returns {{x: number, z: number, step: number, face: number}[]}
 */
export function podiumSlots(steps = []) {
  const out = new Array(steps.length);
  for (const s of [1, 2, 3]) {
    const idx = steps.map((v, i) => (v === s ? i : -1)).filter((i) => i >= 0);
    const k = idx.length;
    const gap = k > 1 ? Math.min(0.75, (STEP_W - 0.5) / (k - 1)) : 0;
    idx.forEach((i, j) => {
      out[i] = { x: +(STEP_X[s] + (j - (k - 1) / 2) * gap).toFixed(3), z: k > 1 ? (j % 2 ? -0.25 : 0.2) : 0, step: s, face: 0 };
    });
  }
  let n = 0;
  steps.forEach((v, i) => {
    if (out[i]) return;
    const side = n % 2 ? 1 : -1;
    const ring = Math.floor(n / 2);
    // outer rings stand further back (they stay inside the camera's view)
    out[i] = { x: +(side * (3.9 + ring * 0.75)).toFixed(3), z: +(0.6 - ring * 1.0).toFixed(3), step: 0, face: +(-side * 0.35).toFixed(3) };
    n++;
  });
  return out;
}
