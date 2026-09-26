#!/usr/bin/env node
// Automated QA for the paper-doll layers (Stage 5.5-B).
//
//   node scripts/part-qa.js                  # check every accepted part, print outliers
//   node scripts/part-qa.js --reprocess      # first re-run the extractor on the accepted candidates (no API)
//   node scripts/part-qa.js --fix [--rounds 2] [--only id,id]   # regenerate outliers (1 candidate/round)
//   node scripts/part-qa.js --json out.json  # write the full report
//
// Checks: non-empty alpha; layer position vs the mannequin head (eyes/mouth/expression centred, in the right
// band); hair covers the top of the skull; outfits cover the mannequin underwear; mannequin head boxes align.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DATA_DIR } from '../server/config.js';
import { loadManifest } from '../server/assets/manifest.js';
import { alphaBBox, detectFigure, toRaw, underwearMask } from '../server/assets/postprocess.js';
import { GENERATED_DIR, createStudio } from '../server/assets/studio.js';

export const MIN_OPAQUE = { mannequin: 50000, hair: 6000, face: 300, eyes: 1500, eyesClosed: 300, mouth: 60, cheek: 120, expression: 2000, accessory: 500, outfit: 15000 };

const opaqueCount = (data, thr = 128) => {
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > thr) n++;
  return n;
};

/**
 * Pure-ish QA of one part layer set (raw RGBA arrays, same w×h as the base).
 * @param {object} item     manifest item
 * @param {{main, front?, erase?, hat?}} layers  raw RGBA data
 * @param {{data, w, h}} base  keyed diff base (mannequin base / src) — for mannequins: the item's own base
 * @param {object} [refHead]  head box of the reference mannequin (mannequin alignment check)
 */
export function qaPart(item, layers, base, refHead) {
  const { w, h } = base;
  const slot = item.meta.slot;
  const issues = [];
  const metrics = {};
  const main = layers.main;
  metrics.opaque = opaqueCount(main);
  if (metrics.opaque < (MIN_OPAQUE[slot] ?? 100)) issues.push(`too few opaque pixels (${metrics.opaque})`);
  const fig = detectFigure(base.data, w, h);
  if (!fig) return { ok: false, issues: ['base has no figure'], metrics };
  const H = fig.head;
  const cx = (H.left + H.right) / 2;
  const box = alphaBBox(main, w, h, 128);
  metrics.bbox = box;
  if (slot === 'mannequin') {
    if (refHead) {
      metrics.headDelta = { top: H.top - refHead.top, cx: Math.round(cx - (refHead.left + refHead.right) / 2), width: H.width - refHead.width };
      if (Math.abs(metrics.headDelta.top) > 6 || Math.abs(metrics.headDelta.cx) > 6 || Math.abs(metrics.headDelta.width) > refHead.width * 0.03) issues.push(`head misaligned ${JSON.stringify(metrics.headDelta)}`);
    }
    return { ok: !issues.length, issues, metrics };
  }
  if (!box) return { ok: false, issues: [...issues, 'empty layer'], metrics };
  const bcx = box.left + box.width / 2;
  const bcy = box.top + box.height / 2;
  const relY = (bcy - H.top) / H.height;
  metrics.center = { dx: Math.round(bcx - cx), relY: Math.round(relY * 100) / 100 };
  const centred = (tol) => {
    if (Math.abs(bcx - cx) > H.width * tol) issues.push(`off-centre by ${Math.round(bcx - cx)}px`);
  };
  if (slot === 'eyes' || slot === 'eyesClosed') {
    centred(0.08);
    if (relY < 0.35 || relY > 0.85) issues.push(`eyes at relY ${metrics.center.relY}`);
    if (box.width < H.width * 0.3) issues.push('eyes too narrow (one eye missing?)');
  } else if (slot === 'mouth') {
    centred(0.1);
    if (relY < 0.6 || relY > 1.0) issues.push(`mouth at relY ${metrics.center.relY}`);
  } else if (slot === 'expression') {
    centred(0.12);
    if (relY < 0.3 || relY > 0.95) issues.push(`expression at relY ${metrics.center.relY}`);
  } else if (slot === 'cheek' || slot === 'face') {
    centred(0.12);
  } else if (slot === 'accessory') {
    if (!['ribbon', 'hairpin'].includes(item.meta.option)) centred(0.25);
    if (box.top > H.bottom) issues.push('accessory below the head');
  } else if (slot === 'hair') {
    // The front layer must cover most of the skull top (a bald dome = the model drew no hair on the head).
    const src = layers.front ?? main;
    let inside = 0;
    let covered = 0;
    const y1 = H.top + Math.round(H.height * 0.18);
    for (let y = H.top; y < y1; y++) {
      for (let x = H.left; x <= H.right; x++) {
        const p = (y * w + x) * 4;
        if (base.data[p + 3] < 200) continue;
        inside++;
        if (src[p + 3] > 128) covered++;
      }
    }
    metrics.skullCover = inside ? Math.round((covered / inside) * 100) / 100 : 0;
    if (metrics.skullCover < 0.5) issues.push(`hair covers only ${metrics.skullCover} of the skull top`);
  } else if (slot === 'outfit') {
    const under = underwearMask(base.data, w, h);
    let n = 0;
    let covered = 0;
    for (let p = 0; p < w * h; p++) {
      if (!under[p]) continue;
      n++;
      const i = p * 4 + 3;
      if (main[i] > 128 || layers.hat?.[i] > 128 || layers.erase?.[i] > 128) covered++;
    }
    metrics.underwearCover = n ? Math.round((covered / n) * 1000) / 1000 : 1;
    if (metrics.underwearCover < 0.9) issues.push(`underwear only ${Math.round(metrics.underwearCover * 100)}% covered`);
    if (box.top < H.top - H.height * 0.1 && !layers.hat) issues.push('outfit reaches above the head');
  }
  return { ok: !issues.length, issues, metrics };
}

async function rawOrNull(file) {
  try {
    return (await toRaw(await readFile(file))).data;
  } catch {
    return null;
  }
}

/** Load a layer set from candidate files (`<dir>/<n>.png`, `<n>.front.png`, …) or published files. */
async function candidateLayers(dir, n) {
  const out = { main: await rawOrNull(path.join(dir, `${n}.png`)) };
  for (const k of ['front', 'back', 'erase', 'hat']) {
    const d = await rawOrNull(path.join(dir, `${n}.${k}.png`));
    if (d) out[k] = d;
  }
  return out;
}

export async function run(argv = [], { out = console.log } = {}) {
  const arg = (n) => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const only = arg('--only')?.split(',');
  const rounds = Number(arg('--rounds') ?? 2);
  const studio = createStudio({ dataDir: DATA_DIR, log: (m) => console.error(m) });
  const candRoot = path.join(DATA_DIR, 'asset-candidates');
  const G = GENERATED_DIR;

  if (argv.includes('--reprocess')) {
    const m = await loadManifest();
    const parts = m.items.filter((i) => i.kind === 'part' && i.status === 'accepted' && (!only || only.includes(i.id)));
    // Order: mannequins, then anything used as a base (src items), then the rest.
    const rank = (i) => (i.meta.slot === 'mannequin' ? 0 : i.meta.src ? 1 : 2);
    parts.sort((a, b) => rank(a) - rank(b));
    for (const it of parts) {
      await studio.reprocess(it.id, it.accepted.candidate);
    }
    out(`재처리 ${parts.length}개`);
  }

  const baseCache = new Map();
  const baseRaw = async (m, item) => {
    const id = item.meta.slot === 'mannequin' ? item.id : item.meta.base;
    if (!baseCache.has(id)) {
      const b = m.items.find((i) => i.id === id);
      const rel = b.accepted.files?.base ?? b.accepted.files?.src ?? b.accepted.file;
      baseCache.set(id, await toRaw(await readFile(path.join(G, rel))));
    }
    return baseCache.get(id);
  };

  const check = async (m, item, n = item.accepted.candidate) => {
    const base = await baseRaw(m, item);
    const refItem = m.items.find((i) => i.kind === 'part' && i.meta.slot === 'mannequin' && !i.meta.base);
    const refHead = refItem ? detectFigure((await baseRaw(m, refItem)).data, base.w, base.h)?.head : null;
    let layers = await candidateLayers(path.join(candRoot, item.id), n);
    if (!layers.main) {
      layers = { main: (await toRaw(await readFile(path.join(G, item.accepted.file)))).data };
      for (const [k, rel] of Object.entries(item.accepted.files ?? {})) if (['front', 'erase', 'hat'].includes(k)) layers[k] = (await toRaw(await readFile(path.join(G, rel)))).data;
    }
    return qaPart(item, layers, base, refHead);
  };

  let m = await loadManifest();
  const report = {};
  const failing = [];
  for (const it of m.items) {
    if (it.kind !== 'part' || it.status !== 'accepted' || (only && !only.includes(it.id))) continue;
    const r = await check(m, it);
    report[it.id] = r;
    if (!r.ok) failing.push(it.id);
  }
  const total = Object.keys(report).length;
  out(`QA: ${total - failing.length}/${total} 통과`);
  for (const id of failing) out(`  ✘ ${id}: ${report[id].issues.join('; ')}`);

  if (argv.includes('--fix') && failing.length) {
    for (let round = 1; round <= rounds; round++) {
      const still = [];
      m = await loadManifest();
      for (const id of failing) {
        const it = m.items.find((i) => i.id === id);
        try {
          const r = await studio.regenerate(id, { count: 1 });
          const n = r.candidates[0].n;
          const q = await check(m, it, n);
          if (q.ok || q.issues.length < report[id].issues.length) {
            await studio.accept(id, n);
            report[id] = { ...q, candidate: n, round };
          }
          out(`  ${q.ok ? '✔' : '…'} [${round}] ${id} 후보 ${n}: ${q.ok ? '통과' : q.issues.join('; ')}`);
          if (!report[id].ok) still.push(id);
        } catch (e) {
          out(`  ✘ [${round}] ${id}: ${e.message}`);
          still.push(id);
          if (e.code === 'DAILY_CAP') return { report, failing: still };
        }
      }
      failing.splice(0, failing.length, ...still);
      if (!failing.length) break;
    }
    out(`수정 후 남은 실패 ${failing.length}건${failing.length ? `: ${failing.join(', ')}` : ''}`);
  }
  const jsonOut = arg('--json');
  if (jsonOut) await writeFile(jsonOut, JSON.stringify(report, null, 2));
  return { report, failing };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  run(process.argv.slice(2)).then(
    ({ failing }) => process.exit(failing.length ? 1 : 0),
    (e) => {
      console.error(e.stack ?? e.message);
      process.exit(2);
    },
  );
}
