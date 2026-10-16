#!/usr/bin/env node
// Manual asset import: images made by hand in the Gemini app, dropped into assets-inbox/ as `<asset id>.png`
// (.jpg / .jpeg / .webp too), are run through the item's own postprocess (chroma key / white key / trim /
// resize / WebP) after the Gemini-app sparkle watermark is un-blended (server/assets/watermark.js), accepted in the
// manifest, and removed from the inbox.
//
//   node scripts/import-assets.js [--dir assets-inbox] [--only id[,id]] [--take 2 | --take id=2[,id=2]] [--dry-run] [--keep]
//
// File names (CH-2, the user's local Gemini skill): `<id>.png` / `<id>_original.jpg` (the PNG wins), `<id>-2.png` = a
// second take — used only with `--take 2` (all ids) / `--take <id>=2`, or when take 1 is missing. Aliases (charaIds.js):
// ch-<c>-cry → ch-<c>-expr-cry, ch-<c>-noarms → ch-<c>-body (+ derived ch-<c>-arms), npc-friend-<s> → npc-<s>-base,
// bg-ch-<scene> → bg-<scene>, prop-hat-chef → prop-chef-hat, `_` → `-`. Kinds chara / prop / mc go through
// scripts/import-chara.js (placement, derived parts, overlays, sheets); everything else through the item's postprocess.
// After a successful import every file of that id (all takes, originals) leaves the inbox unless --keep.
//
// No Gemini API call is ever made (the studio gets a client that refuses). Paper-doll parts (kind part) and
// sprites cannot be uploaded (they are multi-layer / multi-frame generations) → skipped with a message.
// Exit code 1 when any file failed or was skipped as unknown.
import { readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { DATA_DIR } from '../server/config.js';
import { MANIFEST_PATH, getItem, loadManifest } from '../server/assets/manifest.js';
import { toRaw } from '../server/assets/postprocess.js';
import { GENERATED_DIR, createStudio } from '../server/assets/studio.js';
import { canonicalId, idRole, importRank, parseDeliveredName, pickTakes } from '../server/assets/charaIds.js';
import { createCharaImporter } from './import-chara.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const IMPORT_EXTS = ['.png', '.jpg', '.jpeg', '.webp'];
const UNSUPPORTED = { part: '아바타 파츠는 여러 레이어를 한 번에 만들어야 해서 가져오기를 지원하지 않아요', sprite: '스프라이트는 여러 프레임이라 가져오기를 지원하지 않아요' };

/** A Gemini client that never calls the API (imports only post-process local files). */
const noApiClient = {
  generateImage: async () => {
    throw new Error('import-assets는 Gemini API를 호출하지 않습니다.');
  },
  hasKey: async () => false,
};

const keyed = (item) => item.postprocess.includes('chromaKey') || item.postprocess.includes('whiteToAlpha');
/** Kinds imported by scripts/import-chara.js (CH-2). */
const CHARA_KINDS = new Set(['chara', 'prop', 'mc']);
const PART_LABEL = { base: '기본', body: '몸', arms: '팔', 'eyes-closed': '눈 감음', 'mouth-open': '입 벌림' };

/** Share of fully transparent pixels (0..1). */
async function transparentShare(file) {
  const { data, w, h } = await toRaw(await readFile(file));
  let n = 0;
  for (let p = 0; p < w * h; p++) if (data[p * 4 + 3] === 0) n++;
  return n / (w * h);
}

/**
 * Import every `<id>.<ext>` file of `dir`.
 * @param {{dir?, only?: string[], dryRun?, keep?, studio?, manifestPath?, outputDir?, dataDir?, log?}} opts
 * @returns {Promise<{results: {file, id, ok, skipped?, error?, kind?, output?, width?, height?, transparent?, warnings: string[]}[], failed: number}>}
 */
export async function importAssets({
  dir = path.join(ROOT, 'assets-inbox'),
  only = null,
  dryRun = false,
  keep = false,
  takes = {},
  takeAll = null,
  manifestPath = MANIFEST_PATH,
  outputDir = GENERATED_DIR,
  dataDir = DATA_DIR,
  studio = null,
  log = console.log,
  charaRes = undefined, // tests: smaller character canvases (default CHARA_RES 0.75)
} = {}) {
  const st = studio ?? createStudio({ dataDir, manifestPath, outputDir, client: noApiClient });
  let names;
  try {
    names = await readdir(dir);
  } catch {
    log(`📂 폴더가 없어요: ${dir}`);
    return { results: [], failed: 0, bytes: 0 };
  }
  const manifest = await loadManifest(manifestPath);
  const known = (id) => !!getItem(manifest, id);
  // --only / --take may use delivered names (aliases)
  if (only?.length) only = only.map((o) => canonicalId(o, known) ?? o);
  takes = Object.fromEntries(Object.entries(takes ?? {}).map(([k, v]) => [canonicalId(k, known) ?? k, v]));
  const parsed = names
    .filter((n) => !n.startsWith('.') && IMPORT_EXTS.includes(path.extname(n).toLowerCase()))
    .sort()
    .map((n) => parseDeliveredName(n, known));
  const results = [];
  for (const p of parsed.filter((x) => !x.id)) {
    const fallbackId = p.stem;
    if (only?.length && !only.includes(fallbackId)) continue;
    const res = { file: p.name, id: fallbackId, ok: false, skipped: true, warnings: [], error: '매니페스트에 없는 id예요 (파일 이름 = 에셋 id, 예: bg-stage.png)' };
    results.push(res);
    log(`⏭️  ${p.name}: ${res.error}`);
  }
  const picks = pickTakes(parsed, { takes, takeAll });
  const ids = [...picks.keys()].filter((id) => !only?.length || only.includes(id)).sort((a, b) => importRank(a) - importRank(b) || a.localeCompare(b));
  const chara = createCharaImporter({ studio: st, manifestPath, outputDir, dataDir, log, ...(charaRes ? { res: charaRes } : {}) });
  const batch = new Set(ids);
  let bytes = 0;
  for (const id of ids) {
    const { entry, fallback, alternatives } = picks.get(id);
    const name = entry.name;
    const file = path.join(dir, name);
    const res = { file: name, id, ok: false, warnings: [], take: entry.take, alternatives };
    results.push(res);
    const item = getItem(await loadManifest(manifestPath), id);
    res.kind = item.kind;
    if (UNSUPPORTED[item.kind]) {
      res.skipped = true;
      res.error = UNSUPPORTED[item.kind];
      log(`⏭️  ${name}: ${res.error}`);
      continue;
    }
    const alias = entry.stem !== id ? ` (이름 ${entry.stem} → ${id})` : '';
    const takeNote = entry.take !== 1 || fallback ? ` · ${entry.take}번째 장${fallback ? ' (요청한 장이 없어 대신 사용)' : ''}` : '';
    if (fallback) res.warnings.push(`요청한 테이크가 없어서 ${name}을(를) 썼어요`);
    try {
      const buffer = await readFile(file);
      const meta = await sharp(buffer).metadata();
      if (CHARA_KINDS.has(item.kind)) {
        if (dryRun) {
          res.ok = true;
          log(`🔎 ${name} → ${id}${alias} (${item.kind}${idRole(id)?.part ? ` · ${PART_LABEL[idRole(id).part] ?? idRole(id).part}` : ''}, ${item.output}) 원본 ${meta.width}×${meta.height}${takeNote}${item.status === 'accepted' ? ' · 기존 채택본 교체 예정' : ''}`);
          continue;
        }
        const replaced = item.status === 'accepted';
        const r = await chara.importOne(id, file, name, { batch });
        Object.assign(res, { ok: true, output: r.output, width: r.width, height: r.height, transparent: r.transparent, derived: r.derived, bytes: r.bytes });
        res.warnings.push(...r.warnings);
        bytes += r.bytes ?? 0;
        const tr = r.transparent != null ? ` · 투명 ${(r.transparent * 100).toFixed(1)}%` : '';
        log(`✅ ${name} → ${id}${alias} ${r.output} ${r.width}×${r.height}${tr} · ${Math.round((r.bytes ?? 0) / 1024)} KB${takeNote}${replaced ? ' · 기존 채택본 교체' : ''}`);
        for (const n of r.notes) log(`   · ${n}`);
        for (const d of r.derived ?? []) log(`   ↳ ${d.id}: ${d.note}`);
      } else {
        const target = item.size ?? null;
        if (target && (meta.width < target.w || meta.height < target.h)) {
          res.warnings.push(`원본이 목표보다 작아서 확대돼요 (${meta.width}×${meta.height} → ${target.w}×${target.h})`);
        }
        if (item.kind === 'bg' && target) {
          const ratio = meta.width / meta.height;
          const want = target.w / target.h;
          if (Math.abs(ratio - want) / want > 0.15) res.warnings.push(`비율이 ${item.aspect}와 많이 달라 가장자리가 잘려요 (${meta.width}×${meta.height})`);
        }
        if (dryRun) {
          res.ok = true;
          log(`🔎 ${name} → ${id}${alias} (${item.kind}, ${item.output}) 원본 ${meta.width}×${meta.height}${takeNote}${item.status === 'accepted' ? ' · 기존 채택본 교체 예정' : ''}${res.warnings.length ? ` ⚠️ ${res.warnings.join(' / ')}` : ''}`);
          continue;
        }
        const replaced = item.status === 'accepted';
        const out = await st.upload(id, buffer, { process: true, watermark: true });
        res.ok = true;
        res.output = out.accepted?.file ?? item.output;
        res.width = out.accepted?.width;
        res.height = out.accepted?.height;
        if (keyed(item)) {
          res.transparent = await transparentShare(path.join(outputDir, res.output));
          if (res.transparent < 0.05) res.warnings.push('투명 영역이 거의 없음 — 배경색 확인 (마젠타/흰색 단색이어야 해요)');
          else if (res.transparent > 0.97) res.warnings.push('거의 전부 투명해졌어요 — 그림이 배경색과 비슷한지 확인');
        }
        res.watermark = out.watermarkRemoved ?? null;
        res.bytes = await stat(path.join(outputDir, res.output)).then((x) => x.size, () => 0);
        bytes += res.bytes;
        const tr = res.transparent != null ? ` · 투명 ${(res.transparent * 100).toFixed(1)}%` : '';
        const wm = res.watermark ? ` · 워터마크 제거 (${Math.round(res.watermark.cx)},${Math.round(res.watermark.cy)})` : ' · 워터마크 없음';
        log(`✅ ${name} → ${id}${alias} (${item.kind}) ${res.output} ${res.width}×${res.height}${tr}${wm} · ${Math.round(res.bytes / 1024)} KB${takeNote}${replaced ? ' · 기존 채택본 교체' : ''}`);
      }
      if (!keep) {
        for (const f of [name, ...alternatives]) await rm(path.join(dir, f), { force: true });
      }
      log(`   ${keep ? '원본 유지' : `원본 삭제${alternatives.length ? ` (다른 장 ${alternatives.length}개 포함)` : ''}`}`);
      for (const w of res.warnings) log(`   ⚠️ ${w}`);
    } catch (err) {
      res.error = err.message;
      log(`❌ ${name}: ${err.message}`);
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  const done = results.filter((r) => r.ok).length;
  log(`\n${dryRun ? '점검' : '가져오기'} 완료: 성공 ${done}건 · 실패/건너뜀 ${failed}건${results.length ? '' : ' (가져올 파일이 없어요)'}${dryRun ? '' : ` · 추가된 파일 ${Math.round(bytes / 1024)} KB`}`);
  return { results, failed, bytes };
}

/** `--take 2` → {takeAll: 2}; `--take id=2,id2=3` → {takes: {...}} (ids canonicalised later by the caller's manifest). */
export function parseTakeArg(v) {
  if (typeof v !== 'string' || !v) return { takes: {}, takeAll: null };
  if (/^[2-9]$/.test(v)) return { takes: {}, takeAll: Number(v) };
  const takes = {};
  for (const part of v.split(',')) {
    const m = /^\s*([a-z0-9_-]+)\s*=\s*([1-9])\s*$/i.exec(part);
    if (m) takes[m[1].toLowerCase().replace(/_/g, '-')] = Number(m[2]);
  }
  return { takes, takeAll: null };
}

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const dirArg = arg('dir', null);
  const onlyArg = arg('only', null);
  const takeArg = arg('take', null);
  const { failed } = await importAssets({
    dir: typeof dirArg === 'string' ? path.resolve(dirArg) : undefined,
    only: typeof onlyArg === 'string' ? onlyArg.split(',').map((s) => s.trim().toLowerCase().replace(/_/g, '-')).filter(Boolean) : null,
    dryRun: !!arg('dry-run', false),
    keep: !!arg('keep', false),
    ...parseTakeArg(typeof takeArg === 'string' ? takeArg : null),
  });
  process.exit(failed ? 1 : 0);
}
