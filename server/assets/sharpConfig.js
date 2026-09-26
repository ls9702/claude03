// libvips tuning for the long-running server (Raspberry Pi 4). sharp's defaults keep a 50 MB operation
// cache and one worker thread per core; after a few AI art jobs that left RSS at ~420 MB. The server
// processes one image at a time anyway (per-room art queue, studio limiter), so: no cache, 1 thread.
// Scripts (gen-assets, part-qa…) don't call this and keep sharp's defaults.
import sharp from 'sharp';

let applied = false;

export function configureSharpForServer({ concurrency = 1 } = {}) {
  if (applied) return;
  applied = true;
  sharp.cache(false);
  sharp.concurrency(concurrency);
}
