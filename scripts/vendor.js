#!/usr/bin/env node
// postinstall: copy browser builds of npm packages into public/vendor/ (served statically, no CDN).
// The Pi may have no internet at runtime, but `npm install` runs this script there, so public/vendor/
// is gitignored and always regenerated from node_modules.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'vendor');

/** [package-relative source, vendor-relative destination] */
export const THREE_FILES = [
  ['build/three.module.js', 'three/three.module.js'],
  ['build/three.core.js', 'three/three.core.js'],
  ['examples/jsm/loaders/GLTFLoader.js', 'three/addons/loaders/GLTFLoader.js'],
  ['examples/jsm/utils/BufferGeometryUtils.js', 'three/addons/utils/BufferGeometryUtils.js'],
  ['examples/jsm/utils/SkeletonUtils.js', 'three/addons/utils/SkeletonUtils.js'],
  ['LICENSE', 'three/LICENSE'],
];

function packageDir(name) {
  const require = createRequire(path.join(ROOT, 'package.json'));
  try {
    return path.dirname(require.resolve(`${name}/package.json`));
  } catch {
    const dir = path.join(ROOT, 'node_modules', name);
    return fs.existsSync(dir) ? dir : null;
  }
}

export function vendor({ out = OUT, log = console.log } = {}) {
  const dir = packageDir('three');
  if (!dir) {
    log('[vendor] three 패키지를 찾을 수 없어 건너뜁니다 (npm install 필요).');
    return 0;
  }
  const version = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
  let n = 0;
  for (const [src, dest] of THREE_FILES) {
    const from = path.join(dir, src);
    if (!fs.existsSync(from)) {
      if (src !== 'LICENSE') log(`[vendor] 없음: three/${src}`);
      continue;
    }
    const to = path.join(out, dest);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    n++;
  }
  fs.mkdirSync(path.join(out, 'three'), { recursive: true });
  fs.writeFileSync(path.join(out, 'three', 'VERSION'), `${version}\n`);
  log(`[vendor] three ${version} → public/vendor/three (${n}개 파일)`);
  return n;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) vendor();
