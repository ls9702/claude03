#!/usr/bin/env node
// Batch asset generation from the manifest (same studio module as the admin page).
//
//   node scripts/gen-assets.js --only style-anchor --accept-first
//   node scripts/gen-assets.js --kind bg --count 2
//   node scripts/gen-assets.js --all --accept-first --dry-run
//
// Options: --only id[,id]  --kind <kind>  --all  --count N  --accept-first  --force  --dry-run  --parallel N
// (--parallel runs up to N items at once; an item starts only after the items it depends on succeeded)
// Key: env GEMINI_API_KEY or DATA_DIR/secrets.json. Exit code 1 if anything failed.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DATA_DIR } from '../server/config.js';
import { KINDS, depsOf } from '../server/assets/manifest.js';
import { createStudio } from '../server/assets/studio.js';

export function parseArgs(argv) {
  const opts = { only: null, kind: null, all: false, count: null, acceptFirst: false, force: false, dryRun: false, parallel: 1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i];
      if (v === undefined) throw new Error(`${a} 값이 필요합니다.`);
      return v;
    };
    const name = a.split('=')[0];
    if (name === '--only') opts.only = val().split(',').map((s) => s.trim()).filter(Boolean);
    else if (name === '--kind') opts.kind = val();
    else if (name === '--count') opts.count = Number(val());
    else if (name === '--parallel') opts.parallel = Number(val());
    else if (a === '--all') opts.all = true;
    else if (a === '--accept-first') opts.acceptFirst = true;
    else if (a === '--force') opts.force = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else throw new Error(`알 수 없는 옵션: ${a}`);
  }
  if (opts.kind && !KINDS.includes(opts.kind)) throw new Error(`kind는 ${KINDS.join('|')} 중 하나여야 합니다.`);
  if (opts.count !== null && (!Number.isInteger(opts.count) || opts.count < 1 || opts.count > 8)) throw new Error('--count는 1~8이어야 합니다.');
  if (!Number.isInteger(opts.parallel) || opts.parallel < 1 || opts.parallel > 8) throw new Error('--parallel은 1~8이어야 합니다.');
  return opts;
}

const HELP = `사용법: node scripts/gen-assets.js (--only id[,id] | --kind <kind> | --all) [--count N] [--accept-first] [--force] [--dry-run] [--parallel N]`;

export async function run(argv, { studio, out = console.log, err = console.error } = {}) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    err(e.message);
    err(HELP);
    return 2;
  }
  if (opts.help || (!opts.only && !opts.kind && !opts.all)) {
    out(HELP);
    return opts.help ? 0 : 2;
  }
  const st = studio ?? createStudio({ dataDir: DATA_DIR, log: (m) => err(m) });
  const items = await st.select(opts);
  const hasKey = await st.client.hasKey();
  const usage = await st.client.getUsage();
  // With --accept-first a single candidate per item is enough unless --count says otherwise.
  const count = opts.count ?? (opts.acceptFirst ? 1 : undefined);

  out(`에셋 ${items.length}개 · 모델 ${st.client.model} · API 키 ${hasKey ? '있음' : '없음'} · 오늘 사용 ${usage.count}/${usage.cap}`);
  let calls = 0;
  for (const it of items) {
    const skip = it.status === 'accepted' && !opts.force;
    const n = count ?? it.candidates ?? 4;
    if (!skip) calls += n * it.calls;
    out(`  ${skip ? '·' : '→'} ${it.id.padEnd(34)} ${it.kind.padEnd(9)} ${it.status.padEnd(9)} ${skip ? '(채택됨, 건너뜀)' : `${n}장×${it.calls}회`}${it.refs.length ? `  refs: ${it.refs.join(', ')}` : ''}`);
  }
  out(`예상 API 호출: ${calls}회`);
  if (opts.dryRun) return 0;
  if (!hasKey && calls > 0) {
    err('GEMINI_API_KEY 환경변수나 관리자 페이지에서 키를 먼저 설정하세요.');
    return 1;
  }

  let failed = 0;
  let stop = false;
  const todo = items.filter((it) => !(it.status === 'accepted' && !opts.force));
  const inRun = new Map(todo.map((it) => [it.id, null])); // id → Promise<boolean> once started
  const one = async (it) => {
    // Dependencies generated in this same run must succeed first.
    for (const d of depsOf(it)) {
      if (!inRun.has(d)) continue;
      while (!inRun.get(d)) await new Promise((r) => setTimeout(r, 50));
      if (!(await inRun.get(d))) {
        failed++;
        err(`✘ ${it.id}: 의존 항목 ${d} 실패로 건너뜀`);
        return false;
      }
    }
    if (stop) return false;
    const t0 = Date.now();
    try {
      const r = await st.generateCandidates(it.id, { count, force: opts.force });
      const ns = r.candidates.map((c) => c.n);
      let msg = `✔ ${it.id}: 후보 ${ns.join(', ')} (${((Date.now() - t0) / 1000).toFixed(1)}s)`;
      if (r.errors.length) msg += ` · 일부 실패 ${r.errors.length}건: ${r.errors[0]}`;
      if (opts.acceptFirst) {
        const accepted = await st.accept(it.id, ns[0]);
        msg += ` → 채택: public${accepted.url.split('?')[0]}`;
      }
      out(msg);
      return true;
    } catch (e) {
      failed++;
      err(`✘ ${it.id}: ${e.message}`);
      if (e.code === 'DAILY_CAP' || e.code === 'NO_KEY' || /HTTP 402/.test(e.message)) stop = true; // cap / billing exhausted
      return false;
    }
  };
  // Workers pick items in (dependency) order; a worker waiting on a dependency holds its slot.
  let next = 0;
  const worker = async () => {
    while (next < todo.length && !stop) {
      const it = todo[next++];
      const p = one(it);
      inRun.set(it.id, p);
      await p;
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.parallel, Math.max(1, todo.length)) }, worker));
  out(failed ? `실패 ${failed}건` : '완료');
  return failed ? 1 : 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e.message);
      process.exit(1);
    },
  );
}
