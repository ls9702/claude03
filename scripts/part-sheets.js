#!/usr/bin/env node
// Contact sheets of the accepted paper-doll layers (Stage 5.5-B) for visual review.
//
//   node scripts/part-sheets.js --out <dir> [--sheets avatars,hair,expressions,outfits,builds,skins,parts] [--seed 7]
//
// Composes avatars exactly like the client will: partStack.layerStack() order + tintMath tints + erase masks.
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { loadManifest } from '../server/assets/manifest.js';
import { EXPRESSIONS, layerStack } from '../server/assets/partStack.js';
import { composeLayers } from '../server/assets/postprocess.js';
import { createRng } from '../server/game/rng.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GENERATED = path.join(ROOT, 'public', 'assets', 'generated');
/** Figure crop of the 1024×1536 canvas used for tiles (all mannequins + big hair fit inside). */
export const TILE_CROP = { left: 80, top: 40, width: 864, height: 1392 };
const SCALE = 0.5; // compose at 512×768 for speed

/** Lookup over accepted part items → {url (local path), files, meta}. */
export async function partLookup({ manifest, outputDir = GENERATED } = {}) {
  const m = manifest ?? (await loadManifest());
  const byId = new Map();
  for (const it of m.items) {
    if (it.kind !== 'part' || it.status !== 'accepted' || !it.accepted?.file) continue;
    const files = {};
    for (const [k, rel] of Object.entries(it.accepted.files ?? {})) files[k] = path.join(outputDir, rel);
    byId.set(it.id, { url: path.join(outputDir, it.accepted.file), files, meta: it.meta });
  }
  return (id) => byId.get(id) ?? null;
}

const cache = new Map();
async function load(file) {
  if (!cache.has(file)) {
    cache.set(
      file,
      readFile(file).then((b) => sharp(b).resize(Math.round(1024 * SCALE), Math.round(1536 * SCALE), { fit: 'fill' }).png().toBuffer()),
    );
  }
  return cache.get(file);
}

/** Compose one avatar → PNG buffer cropped to TILE_CROP (at SCALE). */
export async function renderAvatar(avatar, { lookup, avatars, expression = null, blink = false, background = '#ece8e0' }) {
  const stack = layerStack(avatar, { lookup, avatars, expression, blink });
  const layers = [];
  for (const l of stack) layers.push({ buffer: await load(l.src), tint: l.tint, erase: l.erase ? await Promise.all(l.erase.map(load)) : undefined });
  const w = Math.round(1024 * SCALE);
  const h = Math.round(1536 * SCALE);
  const img = await composeLayers(layers, { width: w, height: h, background });
  const c = TILE_CROP;
  return sharp(img)
    .extract({ left: Math.round(c.left * SCALE), top: Math.round(c.top * SCALE), width: Math.round(c.width * SCALE), height: Math.round(c.height * SCALE) })
    .png()
    .toBuffer();
}

const esc = (s) => String(s).replace(/[<>&"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[ch]);

/** Grid of tiles with small captions. */
export async function grid(tiles, { cols, title = '' }) {
  const tw = Math.round(TILE_CROP.width * SCALE);
  const th = Math.round(TILE_CROP.height * SCALE);
  const cap = 22;
  const head = title ? 36 : 0;
  const rows = Math.ceil(tiles.length / cols);
  const W = cols * tw;
  const H = head + rows * (th + cap);
  const parts = [];
  for (const [i, t] of tiles.entries()) {
    const x = (i % cols) * tw;
    const y = head + Math.floor(i / cols) * (th + cap);
    parts.push({ input: t.buffer, left: x, top: y });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tw}" height="${cap}"><rect width="100%" height="100%" fill="#222"/><text x="6" y="16" font-family="sans-serif" font-size="13" fill="#fff">${esc(t.caption ?? '')}</text></svg>`;
    parts.push({ input: Buffer.from(svg), left: x, top: y + th });
  }
  if (title) parts.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${head}"><rect width="100%" height="100%" fill="#111"/><text x="10" y="25" font-family="sans-serif" font-size="20" fill="#fff">${esc(title)}</text></svg>`), left: 0, top: 0 });
  return sharp({ create: { width: W, height: H, channels: 4, background: '#444' } }).composite(parts).png().toBuffer();
}

const ids = (avatars, cat) => (avatars.parts[cat] ?? []).map((o) => o.id);

export async function buildSheets({ outDir, which, seed = 7 }) {
  const avatars = JSON.parse(await readFile(path.join(ROOT, 'server', 'data', 'avatars.json'), 'utf8'));
  const lookup = await partLookup();
  const ctx = { lookup, avatars };
  const D = avatars.default;
  const want = (s) => !which || which.includes(s);
  const written = [];
  const save = async (name, buf) => {
    const f = path.join(outDir, `s55b-sheet-${name}.png`);
    await sharp(buf).png({ compressionLevel: 9 }).toFile(f);
    written.push(f);
  };

  if (want('avatars')) {
    // 24 random avatars; categories cycle through a shuffled option list so every option shows up.
    const rng = createRng(seed);
    const shuffled = {};
    for (const cat of avatars.order) {
      const a = [...ids(avatars, cat)];
      for (let i = a.length - 1; i > 0; i--) {
        const j = rng.int(0, i);
        [a[i], a[j]] = [a[j], a[i]];
      }
      shuffled[cat] = a;
    }
    const tiles = [];
    for (let i = 0; i < 24; i++) {
      const av = {};
      for (const cat of avatars.order) av[cat] = shuffled[cat][i % shuffled[cat].length];
      const expr = i % 6 === 5 ? EXPRESSIONS[(i / 6) | 0] : null;
      tiles.push({ buffer: await renderAvatar(av, { ...ctx, expression: expr }), caption: `${av.body}/${av.build} ${av.hair} ${av.outfit}${expr ? ` :${expr}` : ''}` });
    }
    await save('avatars', await grid(tiles, { cols: 8, title: '24 random avatars (all bodies/builds/hairs/outfits/colours)' }));
  }

  if (want('hair')) {
    const tiles = [];
    for (const colour of ['black', 'blonde', 'pink']) {
      for (const h of ids(avatars, 'hair')) {
        tiles.push({ buffer: await renderAvatar({ ...D, body: 'girl', hair: h, hairColor: colour, outfit: 'tshirt', outfitColor: 'white' }, ctx), caption: `${h} ${colour}` });
      }
    }
    await save('hair', await grid(tiles, { cols: 10, title: 'All hairstyles × 3 colours (girl / normal)' }));
  }

  if (want('expressions')) {
    const tiles = [];
    for (const body of ['girl', 'boy']) {
      const base = { ...D, body, hair: body === 'girl' ? 'bob' : 'short', hairColor: 'brown', outfit: 'hoodie', outfitColor: 'yellow' };
      tiles.push({ buffer: await renderAvatar(base, ctx), caption: `${body} default` });
      tiles.push({ buffer: await renderAvatar(base, { ...ctx, blink: true }), caption: `${body} blink` });
      for (const x of EXPRESSIONS) tiles.push({ buffer: await renderAvatar(base, { ...ctx, expression: x }), caption: `${body} ${x}` });
    }
    await save('expressions', await grid(tiles, { cols: 9, title: 'Default / blink / 7 expressions' }));
  }

  if (want('builds')) {
    const tiles = [];
    for (const o of ids(avatars, 'outfit')) {
      for (const build of ids(avatars, 'build')) {
        tiles.push({ buffer: await renderAvatar({ ...D, body: 'girl', build, hair: 'ponytail', hairColor: 'black', outfit: o, outfitColor: 'blue' }, ctx), caption: `${o} ${build}` });
      }
    }
    await save('outfits-builds-girl', await grid(tiles, { cols: 15, title: 'Outfits × builds (girl)' }));
    const tiles2 = [];
    for (const o of ids(avatars, 'outfit')) {
      for (const build of ids(avatars, 'build')) {
        tiles2.push({ buffer: await renderAvatar({ ...D, body: 'boy', build, hair: 'short', hairColor: 'black', outfit: o, outfitColor: 'green' }, ctx), caption: `${o} ${build}` });
      }
    }
    await save('outfits-builds-boy', await grid(tiles2, { cols: 15, title: 'Outfits × builds (boy)' }));
  }

  if (want('outfits')) {
    const tiles = [];
    for (const o of avatars.parts.outfit) {
      const colours = o.tintable === false ? ['(natural)'] : ['red', 'blue', 'black'];
      for (const c of colours) {
        const oc = c === '(natural)' ? D.outfitColor : c;
        tiles.push({ buffer: await renderAvatar({ ...D, body: 'girl', build: 'normal', hair: 'bob', hairColor: 'brown', outfit: o.id, outfitColor: oc }, ctx), caption: `${o.id} ${c}` });
      }
    }
    await save('outfits', await grid(tiles, { cols: 12, title: 'All outfits (girl / normal), 3 colours for tintable ones' }));
  }

  if (want('skins')) {
    const tiles = [];
    for (const s of ids(avatars, 'skin')) {
      for (const face of ids(avatars, 'face')) {
        tiles.push({ buffer: await renderAvatar({ ...D, body: 'boy', skin: s, face, hair: 'twoblock', hairColor: 'black', outfit: 'shirt', outfitColor: 'white', cheek: face === 'round' ? 'blush' : face === 'square' ? 'freckles' : 'none' }, ctx), caption: `${s} ${face}` });
      }
    }
    await save('skins', await grid(tiles, { cols: 9, title: '6 skin tones × face shapes (round + blush, square + freckles)' }));
  }

  if (want('parts')) {
    const tiles = [];
    const base = { ...D, body: 'girl', hair: 'bob', hairColor: 'brown', outfit: 'tshirt', outfitColor: 'white' };
    for (const e of ids(avatars, 'eyes')) tiles.push({ buffer: await renderAvatar({ ...base, eyes: e }, ctx), caption: `eyes ${e}` });
    for (const e of ids(avatars, 'eyes')) tiles.push({ buffer: await renderAvatar({ ...base, eyes: e }, { ...ctx, blink: true }), caption: `closed ${e}` });
    for (const mo of ids(avatars, 'mouth')) tiles.push({ buffer: await renderAvatar({ ...base, mouth: mo }, ctx), caption: `mouth ${mo}` });
    for (const c of ids(avatars, 'cheek')) tiles.push({ buffer: await renderAvatar({ ...base, cheek: c }, ctx), caption: `cheek ${c}` });
    for (const a of ids(avatars, 'accessory')) tiles.push({ buffer: await renderAvatar({ ...base, accessory: a }, ctx), caption: `acc ${a}` });
    for (const f of ids(avatars, 'face')) tiles.push({ buffer: await renderAvatar({ ...base, face: f }, ctx), caption: `face ${f}` });
    await save('parts', await grid(tiles, { cols: 10, title: 'Eyes / closed eyes / mouths / cheeks / accessories / face shapes' }));
  }
  return written;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const argv = process.argv.slice(2);
  const arg = (n) => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const outDir = path.resolve(arg('--out') ?? '.');
  await mkdir(outDir, { recursive: true });
  const which = arg('--sheets')?.split(',');
  const files = await buildSheets({ outDir, which, seed: Number(arg('--seed') ?? 7) });
  for (const f of files) console.log(f);
}
