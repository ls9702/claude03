#!/usr/bin/env node
// `npm test`: runs the test files in parallel shards — one Node process per shard (≈ one per CPU core) that runs its
// files one after another in that process (`--test-isolation=none`), instead of one process per file. Modules (sharp,
// express, the engine) are loaded and JIT-compiled once per shard: the suite needs about 60 % of the CPU time of
// `node --test test/*.test.js` (= `npm run test:isolated`, one process per file — use it to rule out state leaking
// between files).
//
//   node scripts/run-tests.js [file | dir/*.test.js …] [--node-test-flag=value …]
//
// Files default to test/*.test.js; arguments starting with "-" are passed to every `node --test` (e.g.
// --test-name-pattern=…). Shards are balanced (longest first onto the least loaded shard) on the per-file test
// durations of the previous runs (node_modules/.cache/jinsei-test-times.json, measured by scripts/test-times-reporter.js),
// else on the tracked seed scripts/test-times.json, else on a guess from the file's imports. Env: TEST_SHARDS=n
// (default: CPU count, ≤ 8), TEST_ISOLATION=process (plain `node --test`), TEST_SAVE_TIMES=1 (refresh the seed).
// Each shard's output is printed when it finishes, then one summary for the whole run; exit code 1 on any failure.
//
// Files of one shard share globals: a top-level before / after / beforeEach / afterEach hook is a ROOT hook there
// (it also runs around the other files' tests of that shard), and global state (mock timers, process.env, module-level
// caches such as setAssetIndex) must be restored by the test that changes it.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_FILE = path.join(ROOT, 'node_modules', '.cache', 'jinsei-test-times.json');
const SEED_FILE = path.join(ROOT, 'scripts', 'test-times.json'); // tracked starting point for a fresh checkout
const REPORTER = path.join(ROOT, 'scripts', 'test-times-reporter.js');
const DEFAULT_PATTERNS = ['test/*.test.js'];
const MAX_SHARDS = 8; // each shard loads every module its files need (peak RSS ≈ 230–380 MB with 4 shards)
const SUMMARY_KEYS = ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo'];
const SUMMARY_RE = /^(?:#|ℹ) (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) [\d.]+$/;
const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** `dir/*.test.js`-style patterns (one `*` level, no `**`) or plain paths → sorted absolute file list. */
export function expandPatterns(patterns, cwd = process.cwd()) {
  const out = new Set();
  for (const p of patterns) {
    if (!p.includes('*')) {
      out.add(path.resolve(cwd, p));
      continue;
    }
    const dir = path.resolve(cwd, path.dirname(p));
    const re = new RegExp(`^${path.basename(p).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`);
    let names = [];
    try {
      names = readdirSync(dir);
    } catch {
      /* no such directory → nothing */
    }
    for (const n of names) if (re.test(n)) out.add(path.join(dir, n));
  }
  return [...out].sort();
}

/**
 * The `node --test` flag that runs the files in the runner's own process (`--test-isolation=none`, called
 * `--experimental-test-isolation=none` before Node 23.6; Node < 22.8 has neither) or null. Probed: an unknown flag
 * makes `node --version` exit with "bad option".
 */
export function isolationFlag() {
  for (const flag of ['--test-isolation=none', '--experimental-test-isolation=none']) {
    if (spawnSync(process.execPath, [flag, '--version'], { stdio: 'ignore' }).status === 0) return flag;
  }
  return null;
}

/** Rough ms estimate of a test file without measurements: image pipeline / HTTP servers / engine games are slow. */
export function guessMs(file) {
  let src = '';
  try {
    src = readFileSync(file, 'utf8');
  } catch {
    return 100;
  }
  let ms = 20 + src.length / 2000;
  if (/from 'sharp'|assetFixtures|charaPipeline|import-assets/.test(src)) ms += 1500; // image pipeline
  if (/server\/index\.js/.test(src)) ms += 400; // HTTP server + SSE
  if (/game\/engine\.js|scripts\/simulate\.js|game\/cpu\.js/.test(src)) ms += src.length / 40; // engine games
  if (/js\/scene\//.test(src)) ms += 300; // 3D geometry builds
  return ms;
}

/** Longest-processing-time-first: each file (heaviest first) goes to the least loaded shard. */
export function planShards(files, n, weightOf) {
  const shards = Array.from({ length: n }, () => ({ files: [], load: 0 }));
  const sorted = files.map((f) => ({ f, w: weightOf(f) })).sort((a, b) => b.w - a.w || a.f.localeCompare(b.f));
  for (const { f, w } of sorted) {
    const s = shards.reduce((best, x) => (x.load < best.load ? x : best));
    s.files.push(f);
    s.load += w;
  }
  for (const s of shards) s.files.sort();
  return shards.filter((s) => s.files.length);
}

function readTimes(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8')).times ?? {};
  } catch {
    return {};
  }
}

function writeTimes(file, times) {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    const sorted = Object.fromEntries(Object.entries(times).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(file, `${JSON.stringify({ version: 1, times: sorted }, null, 1)}\n`);
  } catch {
    /* the timings are only a hint */
  }
}

function runNode(args, { capture }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      env: capture && process.stdout.isTTY && !process.env.NO_COLOR ? { ...process.env, FORCE_COLOR: process.env.FORCE_COLOR ?? '1' } : process.env,
    });
    const chunks = [];
    if (capture) {
      child.stdout.on('data', (d) => chunks.push(d));
      child.stderr.on('data', (d) => chunks.push(d));
    }
    const stop = () => child.kill('SIGTERM');
    process.once('SIGINT', stop);
    child.on('close', (code, signal) => {
      process.off('SIGINT', stop);
      resolve({ code: code ?? (signal ? 1 : 0), output: Buffer.concat(chunks).toString('utf8') });
    });
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const flags = argv.filter((a) => a.startsWith('-'));
  const patterns = argv.filter((a) => !a.startsWith('-'));
  const files = patterns.length ? expandPatterns(patterns, process.cwd()) : expandPatterns(DEFAULT_PATTERNS, ROOT);
  if (!files.length) {
    console.error(`테스트 파일이 없어요: ${(patterns.length ? patterns : DEFAULT_PATTERNS).join(' ')}`);
    process.exit(1);
  }
  const iso = process.env.TEST_ISOLATION === 'process' ? null : isolationFlag();
  if (!iso) {
    // one process per file (the classic runner)
    const { code } = await runNode(['--test', ...flags, ...files], { capture: false });
    process.exit(code);
  }

  const seed = readTimes(SEED_FILE);
  const cache = { ...seed, ...readTimes(CACHE_FILE) };
  const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');
  const weightOf = (f) => cache[rel(f)] ?? guessMs(f);
  const n = Math.max(1, Math.min(Number(process.env.TEST_SHARDS) || Math.min(os.availableParallelism(), MAX_SHARDS), files.length));
  const shards = planShards(files, n, weightOf);
  const reporter = process.stdout.isTTY ? 'spec' : 'tap';
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'jinsei-tests-'));
  const t0 = performance.now();
  const totals = Object.fromEntries(SUMMARY_KEYS.map((k) => [k, 0]));
  const failed = [];
  let exitCode = 0;
  const measured = {};
  try {
    await Promise.all(
      shards.map(async (s, i) => {
        const timesFile = path.join(tmp, `times-${i + 1}.json`);
        const started = performance.now();
        // --test-force-exit: a handle one file forgot to close must not keep the whole shard alive
        const args = ['--test', iso, '--test-force-exit', `--test-reporter=${reporter}`, '--test-reporter-destination=stdout', `--test-reporter=${REPORTER}`, `--test-reporter-destination=${timesFile}`, ...flags, ...s.files];
        const { code, output } = await runNode(args, { capture: true });
        if (code !== 0) exitCode = 1;
        const lines = output.replace(/\n$/, '').split('\n');
        const seen = new Set();
        const kept = [];
        let lastFailed = -1; // TAP: the YAML block after a top-level "not ok" names the file:line
        for (const line of lines) {
          const plain = line.replace(ANSI_RE, '');
          const m = plain.match(SUMMARY_RE);
          if (m) {
            if (m[1] !== 'duration_ms') {
              totals[m[1]] += Number(plain.split(' ').at(-1));
              seen.add(m[1]);
            }
            continue;
          }
          if (/^1\.\.\d+$/.test(plain)) continue; // TAP plan of the shard
          if (/^not ok \d+ - /.test(plain)) {
            failed.push(plain.replace(/^not ok \d+ - /, ''));
            lastFailed = failed.length - 1;
          } else if (lastFailed >= 0 && /^ {2}location: '/.test(plain)) {
            failed[lastFailed] += ` (${rel(plain.replace(/^ {2}location: '|'$/g, ''))})`;
            lastFailed = -1;
          } else if (/^(not )?ok \d+ - /.test(plain)) lastFailed = -1;
          kept.push(line);
        }
        if (code !== 0 && !seen.has('fail')) failed.push(`shard ${i + 1}: exited with code ${code} before its summary`);
        const secs = ((performance.now() - started) / 1000).toFixed(1);
        process.stdout.write(`# ── shard ${i + 1}/${shards.length} · ${s.files.length} files · ${secs} s ──\n${kept.join('\n')}\n`);
        try {
          Object.assign(measured, JSON.parse(readFileSync(timesFile, 'utf8')));
        } catch {
          /* no timings (crashed shard) */
        }
      }),
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  // remember the per-file times for the next run's balance (not for filtered runs)
  if (!flags.some((f) => /^--test-(name-pattern|skip-pattern|only)/.test(f))) {
    const next = { ...cache };
    for (const [f, ms] of Object.entries(measured)) {
      const prev = cache[rel(f)];
      next[rel(f)] = Math.round(prev == null ? ms : (prev + ms) / 2); // smoothed: one noisy run doesn't flip the plan
    }
    writeTimes(CACHE_FILE, next);
    // TEST_SAVE_TIMES=1 refreshes the tracked seed (only the files that exist)
    if (process.env.TEST_SAVE_TIMES) writeTimes(SEED_FILE, Object.fromEntries(files.map((f) => [rel(f), next[rel(f)]]).filter(([, ms]) => ms != null)));
  }
  const wall = performance.now() - t0;
  const out = SUMMARY_KEYS.map((k) => `# ${k} ${totals[k]}`);
  out.push(`# duration_ms ${wall.toFixed(1)}`);
  out.push(`# shards ${shards.length} (one shared process per shard; npm run test:isolated = one process per file)`);
  if (failed.length) out.push('# failed:', ...failed.map((f) => `#   ${f}`));
  process.stdout.write(`${out.join('\n')}\n`);
  process.exit(exitCode || (totals.fail ? 1 : 0));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
