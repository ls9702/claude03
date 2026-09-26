// TEST-ONLY fake of the Gemini generateContent endpoint (manual smoke tests without API credits).
// Enabled only by env CHAR_ART_FAKE (see server/index.js); never used in production.
//
//   CHAR_ART_FAKE=1     → every call returns an image: the last reference image (the paper-doll composition
//                         for the base, the base itself for edits) redrawn on a flat magenta backdrop, shifted a
//                         little per call like the real model; without refs the canned test/fixtures/char-magenta.png
//   CHAR_ART_FAKE=402   → every call fails with HTTP 402 (prepaid credits exhausted)
//   CHAR_ART_FAKE_DELAY_MS (default 250) → latency per call, so progress is visible in the UI
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE = path.join(ROOT, 'test', 'fixtures', 'char-magenta.png');
export const FAKE_KEY = 'fake-char-art-key-not-a-real-secret';
const BACKDROP = { r: 213, g: 37, b: 136, alpha: 1 }; // what Gemini paints instead of #FF00FF

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Magenta-backdrop version of a reference: white/transparent backdrop → magenta, figure shifted by `shift`. */
async function redraw(refBuf, shift) {
  const W = 832;
  const H = 1248;
  const { data, info } = await sharp(refBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // White (paper-doll reference) and magenta (edit reference) backdrops become transparent.
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if ((r > 245 && g > 245 && b > 245) || (r > 200 && g < 60 && b > 200)) data[i + 3] = 0;
  }
  const fig = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .resize(Math.round(W * 0.7), Math.round(H * 0.8), { fit: 'inside' })
    .png()
    .toBuffer();
  const m = await sharp(fig).metadata();
  return sharp({ create: { width: W, height: H, channels: 4, background: BACKDROP } })
    .composite([{ input: fig, left: Math.round((W - m.width) / 2 + shift), top: Math.round(H - m.height - 60 - Math.abs(shift)) }])
    .png()
    .toBuffer();
}

export function createFakeGeminiFetch({ mode = '1', delayMs = 250 } = {}) {
  let n = 0;
  const f = async (url, init) => {
    n++;
    await new Promise((r) => setTimeout(r, delayMs));
    if (String(mode) === '402') return json(402, { error: { code: 402, message: 'Prepaid credits exhausted (fake)', status: 'PAYMENT_REQUIRED' } });
    const parts = JSON.parse(init.body).contents?.[0]?.parts ?? [];
    const refs = parts.filter((p) => p.inlineData?.data);
    const last = refs.at(-1);
    const img = last ? await redraw(Buffer.from(last.inlineData.data, 'base64'), ((n % 5) - 2) * 6) : await readFile(FIXTURE);
    return json(200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: img.toString('base64') } }] }, finishReason: 'STOP' }] });
  };
  f.calls = () => n;
  return f;
}
