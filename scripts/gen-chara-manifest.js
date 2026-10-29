#!/usr/bin/env node
// CH-2: upsert the Chiikawa art items into server/assets/manifest.json (idempotent, like gen-mc-manifest.js).
//
//   node scripts/gen-chara-manifest.js            # write
//   node scripts/gen-chara-manifest.js --dry-run  # only report
//
// Items (ids follow the renderer contract of public/js/ui/chara.js, `_` → `-`):
//   kind chara  ch-<roster id>-{base, body, arms, eyes-closed, mouth-open, expr-joy, expr-cry, expr-shock, sheet-jump}
//               npc-<species>-base, pet-<species>-base   (roster.json / npcs.json / pets.json)
//   kind prop   prop-<props.json id>                    (every prop; white background, meta.anchor / scale at import)
//   kind mc     mc-<dog>-eyes-closed / mc-<dog>-mouth-open (NEW overlays of mc-<dog>-neutral)
// The existing bg-* and mc-* items (ids / outputs unchanged) are re-accepted with the Chiikawa art when it is imported;
// their manifest prompts stay (API generation is off — the prompts that matter are in docs/asset-requests/).
// Prompts + refs come from docs/asset-requests/chiikawa-full.json, chiikawa-test.json and chiikawa-mc.json (what the user's
// local Gemini skill really runs); `-body` uses the `-noarms` request, `-arms` is derived (no request). Existing items keep
// status / accepted / output and every meta field the importer measured (rect, anchors, pivots, sheet timing …).
// Nothing here calls the Gemini API (it is off in this repo); art arrives as files → node scripts/import-assets.js --dir <folder>.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadData } from '../server/data/index.js';
import { MANIFEST_PATH, loadManifest, saveManifest, validateManifest } from '../server/assets/manifest.js';
import { CHIIKAWA_STYLE, MC_OVERLAYS, PART_LABELS, ROSTER_ITEM_PARTS, aliasCandidates, assetSlug, charaAssetId, propAssetId } from '../server/assets/charaIds.js';
import { CANVAS, CHARA_RES } from '../server/assets/charaPipeline.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REQUEST_FILES = ['docs/asset-requests/remaining-all.json', 'docs/asset-requests/chiikawa-full.json', 'docs/asset-requests/chiikawa-test.json', 'docs/asset-requests/chiikawa-mc.json'];

const CHARA_SIZE = { w: Math.round(CANVAS.w * CHARA_RES), h: Math.round(CANVAS.h * CHARA_RES) };
const STYLE_FALLBACK = CHIIKAWA_STYLE;
const PROP_CANVAS = 'Square 1:1. One object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text.';
const SLOT_LABEL = { head: '머리', face: '얼굴', neck: '목', hand: '손', back: '등' };

/** Every request item of the Chiikawa request files: [{id, prompt, refs, aspect, label, file}]. */
export function loadRequests(root = ROOT, files = REQUEST_FILES) {
  const out = [];
  for (const f of files) {
    let j;
    try {
      j = JSON.parse(readFileSync(path.join(root, f), 'utf8'));
    } catch {
      continue;
    }
    const style = j.style ?? STYLE_FALLBACK;
    const items = [...(j.items ?? []), ...(j.batches ?? []).flatMap((b) => b.items ?? [])];
    for (const it of items) {
      let prompt = String(it.prompt ?? '');
      if (j.common && it.canvas) prompt = prompt.replace('{{canvas}}', j.common[it.canvas] ?? it.canvas);
      prompt = prompt.replace('{{style}}', style).replace('{{canvas}}', '').replace(/\s+/g, ' ').trim();
      out.push({ id: it.id, prompt, refs: it.refs ?? [], aspect: it.aspect ?? null, label: it.label ?? null, file: f });
    }
  }
  return out;
}

/** Request entry for a manifest id (aliases resolved; the full request wins over the test). */
function requestIndex(requests, knownIds) {
  const map = new Map();
  for (const r of requests) {
    const id = aliasCandidates(r.id).find((c) => knownIds.has(c));
    if (id && !map.has(id)) map.set(id, r);
  }
  return map;
}

/** Request refs → manifest ids (photo references like "hoya 사진 1~2장" are dropped). */
const mapRefs = (refs, knownIds, self) => [...new Set(refs.map((r) => aliasCandidates(String(r)).find((c) => knownIds.has(c))).filter((r) => r && r !== self))];

/** The generated item list (pure, given the data + request entries). */
export function charaItems({ roster = loadData('roster'), npcs = loadData('npcs'), pets = loadData('pets'), props = loadData('props'), requests = loadRequests() } = {}) {
  const items = [];
  const chara = (group, owner, name, part, label) => {
    const id = charaAssetId(group, name, part);
    const sheet = part.startsWith('sheet-');
    items.push({
      id,
      kind: 'chara',
      label,
      aspect: sheet ? '1:1' : '3:4',
      ...(sheet ? {} : { size: CHARA_SIZE }),
      prompt: '',
      refs: [],
      output: `chara/${group}/${assetSlug(name)}/${part}.webp`,
      postprocess: [],
      status: 'todo',
      meta: { [owner]: name, part },
    });
  };
  for (const c of roster.characters ?? []) {
    for (const part of ROSTER_ITEM_PARTS) chara('ch', 'character', c.id, part, `캐릭터 · ${c.name} · ${PART_LABELS[part] ?? part}`);
  }
  for (const s of npcs.species ?? []) chara('npc', 'npc', s.id, 'base', `단짝 후보 · ${s.name}`);
  for (const s of pets.species ?? []) chara('pet', 'pet', s.id, 'base', `반려동물 · ${s.name}`);
  for (const p of props.props ?? []) {
    items.push({
      id: propAssetId(p.id),
      kind: 'prop',
      label: `소품 · ${SLOT_LABEL[p.slot] ?? p.slot} · ${p.name}`,
      aspect: '1:1',
      prompt: `${STYLE_FALLBACK} ${p.promptDesc ?? p.name}, as a small game costume prop with a thin warm-grey outline. ${PROP_CANVAS}`,
      refs: [],
      output: `chara/props/${assetSlug(p.id)}.webp`,
      postprocess: [],
      status: 'todo',
      meta: { prop: p.id, slot: p.slot },
    });
  }
  for (const dog of ['hoya', 'bomi']) {
    for (const part of MC_OVERLAYS) {
      items.push({
        id: `mc-${dog}-${part}`,
        kind: 'mc',
        label: `MC ${dog === 'hoya' ? '호야' : '봄이'} · ${part === 'eyes-closed' ? '눈 감음 (깜빡임)' : '입 벌림 (말하기)'}`,
        aspect: '1:1',
        size: { w: 1024, h: 1024 },
        prompt: '',
        refs: [`mc-${dog}-neutral`],
        output: `mc/${dog}/${part}.png`,
        postprocess: [],
        status: 'todo',
        meta: { mc: dog, part, base: `mc-${dog}-neutral` },
      });
    }
  }
  // prompts / refs from the requests
  const known = new Set(items.map((i) => i.id));
  const idx = requestIndex(requests, known);
  for (const it of items) {
    const role = it.meta.part;
    let req = idx.get(it.id);
    if (it.kind === 'chara' && role === 'body') req = requests.find((r) => aliasCandidates(r.id).includes(it.id)) ?? req;
    if (req) {
      it.prompt = req.prompt;
      it.refs = req.refs;
    } else if (it.kind === 'chara' && role === 'arms') {
      it.prompt = 'Derived at import (no image request): base minus the arm-less body (-noarms) = both arms, with shoulder pivots.';
    } else if (!it.prompt) {
      it.prompt = `Delivered by hand as a file (see docs/asset-requests): ${it.id}.`;
    }
  }
  return items;
}

/**
 * Upsert into a manifest object (pure): new items are added; existing ones keep status / accepted / output and the
 * importer-measured meta (generated identity fields win). Refs are mapped onto manifest ids (unknown refs dropped).
 */
export function upsertCharaItems(manifest, opts = {}) {
  const requests = opts.requests ?? loadRequests();
  const wanted = charaItems({ ...opts, requests });
  const byId = new Map(manifest.items.map((i, k) => [i.id, k]));
  const before = new Map(manifest.items.map((i) => [i.id, JSON.stringify(i)]));
  let added = 0;
  for (const it of wanted) {
    const k = byId.get(it.id);
    if (k === undefined) {
      manifest.items.push(it);
      byId.set(it.id, manifest.items.length - 1);
      added++;
      continue;
    }
    const old = manifest.items[k];
    const next = { ...it, status: old.status, meta: { ...(old.meta ?? {}), ...it.meta }, ...(old.accepted ? { accepted: old.accepted } : {}) };
    if (old.status === 'accepted') next.output = old.output;
    manifest.items[k] = next;
  }
  const known = new Set(manifest.items.map((i) => i.id));
  const ours = new Set(wanted.map((i) => i.id));
  // our items: refs mapped onto manifest ids (after every item exists); arms depend on base + body
  for (const item of manifest.items) {
    if (!ours.has(item.id)) continue;
    item.refs = mapRefs(item.refs, known, item.id);
    if (item.kind === 'chara' && item.meta?.part === 'arms') {
      const prefix = item.id.replace(/-arms$/, '');
      item.refs = [`${prefix}-base`, `${prefix}-body`].filter((r) => known.has(r));
    }
  }
  const updated = manifest.items.filter((i) => before.has(i.id) && before.get(i.id) !== JSON.stringify(i)).length;
  return { manifest, added, updated, total: wanted.length };
}

/** Request ids that resolve to no manifest item (should be none). */
export function unmappedRequests(manifest, requests = loadRequests()) {
  const known = new Set(manifest.items.map((i) => i.id));
  return requests.filter((r) => !aliasCandidates(r.id).some((c) => known.has(c))).map((r) => r.id);
}

async function main(argv) {
  const dry = argv.includes('--dry-run');
  const m = await loadManifest(MANIFEST_PATH);
  const r = upsertCharaItems(m);
  const v = validateManifest(r.manifest);
  if (!v.ok) throw new Error(v.errors.join('\n'));
  const miss = unmappedRequests(r.manifest);
  console.log(`치이카와 항목 ${r.total}개: 추가 ${r.added}, 갱신 ${r.updated}${dry ? ' (dry-run)' : ''}${miss.length ? ` · ⚠️ 매니페스트에 없는 요청 id: ${miss.join(', ')}` : ''}`);
  if (!dry) await saveManifest(r.manifest, MANIFEST_PATH);
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? '')).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
