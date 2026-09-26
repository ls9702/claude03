// Synthetic images + a fake Gemini REST endpoint for the asset pipeline tests.
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { MANIFEST_PATH } from '../server/assets/manifest.js';

/** What Gemini actually paints instead of #FF00FF (measured in the live test). */
export const BACKDROP = { r: 213, g: 37, b: 136 };

const svgImage = (w, h, body) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`)).png().toBuffer();
const rgb = ({ r, g, b }) => `rgb(${r},${g},${b})`;

/**
 * A "character" on the magenta backdrop: blue body + skin head, a darker magenta ground shadow
 * under the feet and two tiny stray specks (small components) far from the subject.
 */
export function magentaCharacter({ w = 200, h = 300, x = 60, top = 60, bodyW = 80, bodyH = 190 } = {}) {
  const feet = top + bodyH;
  return svgImage(
    w,
    h,
    `<rect width="100%" height="100%" fill="${rgb(BACKDROP)}"/>
     <ellipse cx="${x + bodyW / 2}" cy="${feet + 6}" rx="${bodyW * 0.7}" ry="7" fill="rgb(150,22,96)"/>
     <rect x="${x}" y="${top + bodyW * 0.55}" width="${bodyW}" height="${bodyH - bodyW * 0.55}" fill="rgb(40,60,160)"/>
     <circle cx="${x + bodyW / 2}" cy="${top + bodyW * 0.3}" r="${bodyW * 0.3}" fill="rgb(250,210,180)"/>
     <rect x="8" y="${h / 2}" width="2" height="2" fill="rgb(30,30,30)"/>
     <rect x="${w - 12}" y="12" width="3" height="2" fill="rgb(30,30,30)"/>`,
  );
}

/** An icon on white: black-outlined card with a white face (must stay opaque) and a red heart. */
export function whiteIcon({ size = 128 } = {}) {
  return svgImage(
    size,
    size,
    `<rect width="100%" height="100%" fill="#ffffff"/>
     <rect x="30" y="20" width="68" height="88" rx="6" fill="#ffffff" stroke="#111" stroke-width="4"/>
     <circle cx="64" cy="64" r="16" fill="rgb(220,30,40)"/>`,
  );
}

/** An opaque scene (no alpha), e.g. the style anchor or a background. */
export function scene({ w = 320, h = 180 } = {}) {
  return svgImage(
    w,
    h,
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fd3ff"/><stop offset="1" stop-color="#6cc46c"/></linearGradient></defs>
     <rect width="100%" height="100%" fill="url(#g)"/><circle cx="${w * 0.8}" cy="${h * 0.25}" r="${h * 0.12}" fill="#ffe066"/>`,
  );
}

/** Plain tileable texture (uniform colour + a pattern that wraps). */
export function tileTexture({ size = 64 } = {}) {
  return svgImage(size, size, `<rect width="100%" height="100%" fill="rgb(90,170,80)"/><rect x="0" y="${size / 2}" width="${size}" height="2" fill="rgb(80,150,70)"/>`);
}

/** Decode to raw RGBA for pixel assertions. */
export async function raw(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaAt = (x, y) => data[(y * info.width + x) * 4 + 3];
  return { data, w: info.width, h: info.height, alphaAt };
}

/** A generateContent JSON response carrying one image. */
export function geminiResponse(buffer, text = '') {
  const parts = [{ inlineData: { mimeType: 'image/png', data: buffer.toString('base64') } }];
  if (text) parts.unshift({ text });
  return { candidates: [{ content: { parts }, finishReason: 'STOP' }] };
}

export function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/**
 * Fake Gemini fetch: picks the kind of picture from the prompt (magenta → character, white → icon,
 * seamless → texture, else scene). Each character call shifts/scales the figure a little, like the
 * real model does between frames. Records every call in `.calls`.
 */
export function fakeGeminiFetch() {
  const calls = [];
  let k = 0;
  const f = async (url, init) => {
    const body = JSON.parse(init.body);
    const parts = body.contents[0].parts;
    const prompt = parts.find((p) => p.text)?.text ?? '';
    calls.push({ url, headers: init.headers, body, prompt, refs: parts.filter((p) => p.inlineData).length });
    let img;
    if (/magenta/i.test(prompt)) {
      k++;
      img = await magentaCharacter({ x: 50 + (k % 3) * 8, top: 50 + (k % 4) * 6, bodyH: 180 + (k % 3) * 10 });
    } else if (/white background/i.test(prompt)) img = await whiteIcon();
    else if (/seamless/i.test(prompt)) img = await tileTexture();
    else img = await scene();
    return jsonResponse(200, geminiResponse(img, 'ok'));
  };
  f.calls = calls;
  return f;
}

/**
 * Copy a subset of the real manifest into `dir` (statuses reset to todo) so studio tests exercise the
 * shipped prompts/postprocess definitions without touching the repo file.
 */
export async function tempManifest(dir, ids) {
  const m = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  m.items = m.items
    .filter((i) => ids.includes(i.id))
    .map((i) => {
      const { accepted, ...rest } = i;
      return { ...rest, status: 'todo' };
    });
  const file = path.join(dir, 'manifest.json');
  await mkdir(dir, { recursive: true });
  await writeFile(file, JSON.stringify(m, null, 2));
  return file;
}

export { copyFile };
