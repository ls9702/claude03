#!/usr/bin/env node
// Manual asset import: images made by hand in the Gemini app, dropped into assets-inbox/ as `<asset id>.png`
// (.jpg / .jpeg / .webp too), are run through the item's own postprocess (chroma key / white key / trim /
// resize / WebP) with the Gemini-app watermark handling, accepted in the manifest, and removed from the inbox.
//
//   node scripts/import-assets.js [--dir assets-inbox] [--only id[,id]] [--dry-run] [--keep]
//
// No Gemini API call is ever made (the studio gets a client that refuses). Paper-doll parts (kind part) and
// sprites cannot be uploaded (they are multi-layer / multi-frame generations) → skipped with a message.
// Exit code 1 when any file failed or was skipped as unknown.
import { readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { DATA_DIR } from '../server/config.js';
import { MANIFEST_PATH, getItem, loadManifest } from '../server/assets/manifest.js';
import { toRaw } from '../server/assets/postprocess.js';
import { GENERATED_DIR, createStudio } from '../server/assets/studio.js';

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
  manifestPath = MANIFEST_PATH,
  outputDir = GENERATED_DIR,
  dataDir = DATA_DIR,
  studio = null,
  log = console.log,
} = {}) {
  const st = studio ?? createStudio({ dataDir, manifestPath, outputDir, client: noApiClient });
  let names;
  try {
    names = await readdir(dir);
  } catch {
    log(`📂 폴더가 없어요: ${dir}`);
    return { results: [], failed: 0 };
  }
  const manifest = await loadManifest(manifestPath);
  const files = names
    .filter((n) => !n.startsWith('.') && IMPORT_EXTS.includes(path.extname(n).toLowerCase()))
    .sort();
  const results = [];
  for (const name of files) {
    const id = path.basename(name, path.extname(name)).toLowerCase();
    if (only?.length && !only.includes(id)) continue;
    const file = path.join(dir, name);
    const res = { file: name, id, ok: false, warnings: [] };
    results.push(res);
    const item = getItem(manifest, id);
    if (!item) {
      res.skipped = true;
      res.error = '매니페스트에 없는 id예요 (파일 이름 = 에셋 id, 예: bg-stage.png)';
      log(`⏭️  ${name}: ${res.error}`);
      continue;
    }
    res.kind = item.kind;
    if (UNSUPPORTED[item.kind]) {
      res.skipped = true;
      res.error = UNSUPPORTED[item.kind];
      log(`⏭️  ${name}: ${res.error}`);
      continue;
    }
    try {
      const buffer = await readFile(file);
      const meta = await sharp(buffer).metadata();
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
        log(`🔎 ${name} → ${id} (${item.kind}, ${item.output}) 원본 ${meta.width}×${meta.height}${item.status === 'accepted' ? ' · 기존 채택본 교체 예정' : ''}${res.warnings.length ? ` ⚠️ ${res.warnings.join(' / ')}` : ''}`);
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
      if (!keep) await rm(file, { force: true });
      const tr = res.transparent != null ? ` · 투명 ${(res.transparent * 100).toFixed(1)}%` : '';
      log(`✅ ${name} → ${id} (${item.kind}) ${res.output} ${res.width}×${res.height}${tr}${replaced ? ' · 기존 채택본 교체' : ''}${keep ? ' · 원본 유지' : ' · 원본 삭제'}`);
      for (const w of res.warnings) log(`   ⚠️ ${w}`);
    } catch (err) {
      res.error = err.message;
      log(`❌ ${name}: ${err.message}`);
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  const done = results.filter((r) => r.ok).length;
  log(`\n${dryRun ? '점검' : '가져오기'} 완료: 성공 ${done}건 · 실패/건너뜀 ${failed}건${results.length ? '' : ' (가져올 파일이 없어요)'}`);
  return { results, failed };
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
  const { failed } = await importAssets({
    dir: typeof dirArg === 'string' ? path.resolve(dirArg) : undefined,
    only: typeof onlyArg === 'string' ? onlyArg.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : null,
    dryRun: !!arg('dry-run', false),
    keep: !!arg('keep', false),
  });
  process.exit(failed ? 1 : 0);
}
