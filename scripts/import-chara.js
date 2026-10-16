// CH-2: import of hand-delivered Chiikawa art (used by scripts/import-assets.js for kinds chara / prop / mc).
//
// One importer per run (`createCharaImporter`) keeps the reference families, the placed bases and the manifest in sync:
//   ch-/npc-/pet- base   keyed (sampled backdrop) → placed with the family transform (chiikawa's base defines it; every
//                        image drawn with it as reference keeps that scale; a per-image translation correction only when
//                        its own feet / centre are off by > 2 % / 3 % of the height) → anchors measured → published
//   body (= -noarms)     placed with its base's transform → arms = base − body (+ pivots, hand anchors on the base)
//   eyes-closed / mouth-open / expr-*   placed, registered, diffed against the base inside the face box → overlay
//                        (meta.overlay true); an expression edit that changed a lot outside the face → full swap
//   sheet-<action>       2×2 grid → frames uniformly scaled to the base, feet aligned, cells cropped (meta.rect, grid,
//                        frames, seq, frameMs, loop)
//   prop-<id>            white → alpha, trimmed, meta.anchor (attach point) + meta.scale
//   mc-<dog>-*           keyed + fit into the item's size (PNG, old paths); eyes-closed / mouth-open → overlays of neutral
// Every image is stored cropped to its content with `meta.rect` = where it sits on the 1024×1536 logical canvas.
// The placed full-resolution bases are cached losslessly in DATA_DIR/chara-src/ (edits delivered later diff against them;
// without the cache the published WebP is used).
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { getItem, loadManifest } from '../server/assets/manifest.js';
import { PART_LABELS, idRole } from '../server/assets/charaIds.js';
import {
  CANVAS,
  CHARA_RES,
  SHEET_RES,
  blit,
  boxAt,
  cropToContent,
  extractArms,
  extractOverlay,
  familyFrom,
  familyOfTransform,
  figureStats,
  headSpan,
  headWidth,
  keyBackdrop,
  measureAnchors,
  normalizeProp,
  normalizeSheet,
  placeOnCanvas,
  rawOf,
  rawToPng,
  rectToLogical,
  resizeRaw,
  transformFor,
  transparentShare,
} from '../server/assets/charaPipeline.js';

/** Frame order / timing of sprite sheets per action (the 2×2 jump: crouch, take-off, apex, take-off again, landing). */
export const SHEET_TIMING = Object.freeze({
  jump: { seq: [0, 1, 2, 1, 3], frameMs: [180, 150, 190, 100, 230], loop: false },
  default: { fps: 8, loop: true },
});
/** An expression edit that changed more than this outside the face box (pixels at the stored res, or share) is a swap. */
export const SWAP_OUTSIDE = { px: 2500, share: 0.25 };

const r1 = (v) => Math.round(v * 10) / 10;
const pct = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
const kb = (n) => `${Math.round(n / 1024)} KB`;

/**
 * @param {{studio, manifestPath, outputDir, dataDir, log?, res?}} ctx
 */
export function createCharaImporter({ studio, manifestPath, outputDir, dataDir, log = console.log, res = CHARA_RES }) {
  const cacheDir = path.join(dataDir, 'chara-src');
  const placedMem = new Map(); // prefix → placed base raw (full canvas at res)
  let written = 0;

  const manifest = () => loadManifest(manifestPath);

  async function readSource(file) {
    const buf = await readFile(file);
    return rawOf(await sharp(buf).rotate().png().toBuffer());
  }

  async function publish(id, raw, meta, from) {
    const png = await rawToPng(raw);
    const out = await studio.publish(id, png, { meta, from });
    written += out.bytes ?? 0;
    return out;
  }

  /** Published (cropped) canvas image of an item → the full canvas raw at `res` (null when missing). */
  async function publishedCanvas(item) {
    if (item?.status !== 'accepted' || !item.accepted?.file) return null;
    const file = path.join(outputDir, item.accepted.file);
    let raw;
    try {
      raw = await rawOf(await readFile(file));
    } catch {
      return null;
    }
    const r = item.meta?.res ?? res;
    const rect = item.meta?.rect ?? [0, 0, CANVAS.w, CANVAS.h];
    const W = Math.round(CANVAS.w * res);
    const H = Math.round(CANVAS.h * res);
    const w = Math.round(rect[2] * res);
    const h = Math.round(rect[3] * res);
    if (r !== res || raw.w !== w || raw.h !== h) raw = await resizeRaw(raw, w, h);
    return blit(raw, W, H, Math.round(rect[0] * res), Math.round(rect[1] * res));
  }

  /** The placed base of a family (memory → DATA_DIR/chara-src cache → published WebP). */
  async function placedBase(prefix, m) {
    if (placedMem.has(prefix)) return placedMem.get(prefix);
    try {
      const raw = await rawOf(await readFile(path.join(cacheDir, `${prefix}-base.png`)));
      if (raw.w === Math.round(CANVAS.w * res)) {
        placedMem.set(prefix, raw);
        return raw;
      }
    } catch {
      /* no cache */
    }
    const raw = await publishedCanvas(getItem(m, `${prefix}-base`));
    if (raw) placedMem.set(prefix, raw);
    return raw;
  }

  async function cacheBase(prefix, raw) {
    placedMem.set(prefix, raw);
    await mkdir(cacheDir, { recursive: true });
    await writeFile(path.join(cacheDir, `${prefix}-base.png`), await rawToPng(raw));
  }

  /** Place one keyed source with a family; logs a correction. */
  async function place(keyed, family) {
    const st = figureStats(keyed);
    if (!st) throw new Error('그림이 비어 있어요 (배경 제거 후 남은 게 없음)');
    const t = transformFor(family, keyed.w, keyed.h, st);
    const placed = await placeOnCanvas(keyed, t, { res });
    return { placed, t, st };
  }

  const placementNote = (t) => {
    const parts = [];
    if (t.corrected.y) parts.push(`발 위치 보정 ${pct(t.dev.y)}`);
    if (t.corrected.x) parts.push(`가운데 보정 ${pct(t.dev.x)}`);
    return parts.length ? `⚠️ ${parts.join(' · ')} (이 그림만 이동)` : `배치 그대로 (발 ${pct(t.dev.y)} · 가운데 ${pct(t.dev.x)})`;
  };

  /**
   * Import one delivered file for a chara / prop / mc item.
   * @returns {Promise<{ok: true, output, width, height, transparent?, notes: string[], warnings: string[], derived: object[]}>}
   */
  async function importOne(id, file, name, { batch = new Set() } = {}) {
    const m = await manifest();
    const item = getItem(m, id);
    const role = idRole(id);
    const warnings = [];
    const notes = [];
    const derived = [];
    const before = written;
    if (item.kind === 'prop') {
      const p = await normalizeProp(await readFile(file), { slot: item.meta.slot });
      const out = await studio.publish(id, p.buffer, { meta: { anchor: p.anchor, scale: p.scale }, from: name });
      written += out.bytes ?? 0;
      const tr = transparentShare(await rawOf(p.buffer));
      if (tr < 0.05) warnings.push('투명 영역이 거의 없음 — 흰 배경인지 확인');
      notes.push(`붙는 점 (${p.anchor.join(', ')}) · 크기 ×${p.scale}`);
      return { ok: true, output: item.output, width: p.width, height: p.height, transparent: tr, notes, warnings, derived, bytes: written - before };
    }
    if (item.kind === 'mc') return importMc(m, item, file, name, { notes, warnings, before, batch });
    // ----- character / npc / pet parts -----
    const src = await readSource(file);
    const keyed = keyBackdrop(src);
    notes.push(`원본 ${src.w}×${src.h} · 배경 rgb(${keyed.bg.r},${keyed.bg.g},${keyed.bg.b})`);
    const prefix = role.prefix;
    const part = role.part;
    const isMaster = prefix === 'ch-chiikawa';
    if (part === 'base') {
      const master = getItem(m, 'ch-chiikawa-base');
      let family;
      if (isMaster) family = familyFrom(figureStats(keyed), keyed.w, keyed.h);
      else if (master?.status === 'accepted' && master.meta?.placement) family = master.meta.placement;
      else {
        family = familyFrom(figureStats(keyed), keyed.w, keyed.h);
        warnings.push('치이카와 기본 그림(ch-chiikawa-base)이 아직 없어서 이 그림 자체 기준으로 배치했어요');
      }
      const { placed, t } = await place(keyed, family);
      notes.push(placementNote(t));
      const anchors = measureAnchors(placed, { res });
      if (!anchors.eyes) warnings.push('눈을 찾지 못했어요 — 얼굴 소품(안경) 위치는 추정값');
      const crop = cropToContent(placed);
      const mainH = isMaster ? anchors.bbox.h : master?.meta?.bbox?.h ?? null;
      if (mainH) notes.push(`키 = 치이카와 대비 ×${(anchors.bbox.h / mainH).toFixed(2)}`);
      const meta = {
        res,
        rect: rectToLogical(crop.rect, res),
        placement: familyOfTransform(t, keyed.w, keyed.h),
        anchors: { head: anchors.head, face: anchors.face, neck: anchors.neck, handL: anchors.handL, handR: anchors.handR, back: anchors.back },
        eyes: anchors.eyes,
        headBox: anchors.headBox,
        headWidth: r1(headWidth(placed) / res),
        bbox: anchors.bbox,
        source: [src.w, src.h],
      };
      // arms delivered before? keep their measured hands
      const arms = getItem(m, `${prefix}-arms`);
      if (arms?.status === 'accepted' && arms.meta?.hands) Object.assign(meta.anchors, arms.meta.hands);
      await publish(id, crop.raw, meta, name);
      await cacheBase(prefix, placed);
      const stale = ['body', 'arms', 'eyes-closed', 'mouth-open', 'expr-joy', 'expr-cry', 'expr-shock', 'sheet-jump'].filter((p) => getItem(m, `${prefix}-${p}`)?.status === 'accepted' && !batch.has(`${prefix}-${p}`) && !(p === 'arms' && batch.has(`${prefix}-body`)));
      if (stale.length && getItem(m, id)?.status === 'accepted') warnings.push(`기본 그림이 바뀌었어요 — ${stale.join(', ')}도 이 그림으로 다시 만들어 가져오세요`);
      return { ok: true, output: item.output, width: crop.raw.w, height: crop.raw.h, transparent: transparentShare(placed), notes, warnings, derived, bytes: written - before };
    }
    // everything else hangs off the family's base
    const baseItem = getItem(m, `${prefix}-base`);
    const base = await placedBase(prefix, m);
    if (!base || !baseItem?.meta?.placement) throw new Error(`기본 그림(${prefix}-base)을 먼저 가져와야 해요`);
    const family = baseItem.meta.placement;
    const anchors = baseItem.meta;
    if (part.startsWith('sheet-')) {
      const action = part.slice(6);
      const timing = SHEET_TIMING[action] ?? SHEET_TIMING.default;
      const bh = headSpan(base);
      const refHead = bh ? { cx: bh.cx / res, top: bh.top / res } : null;
      const sh = await normalizeSheet(keyed, { grid: [2, 2], targetHeight: anchors.bbox?.h, refHeadWidth: anchors.headWidth ?? (bh ? bh.width / res : null), refHead, res: SHEET_RES });
      const meta = {
        res: SHEET_RES,
        rect: rectToLogical(sh.rect, SHEET_RES),
        grid: [2, 2],
        frames: 4,
        loop: timing.loop,
        ...(timing.seq ? { seq: timing.seq, frameMs: timing.frameMs } : { fps: timing.fps }),
        ...(sh.offsets ? { heads: sh.offsets } : {}),
      };
      const hs = sh.frames.map((f) => Math.round(f.height));
      notes.push(`프레임 키 ${hs.join(' / ')} (기본 ${Math.round(anchors.bbox?.h ?? 0)}) · 머리 폭 기준 ×${sh.scale} · 발 정렬 · 칸 ${sh.cell.join('×')}`);
      const feet = sh.frames.map((f) => f.feet);
      if (Math.max(...feet) - Math.min(...feet) > 0.08) notes.push(`원본 칸마다 발 위치가 달랐어요 (${feet.map((f) => `${Math.round(f * 100)}%`).join(' / ')}) → 맞춤`);
      await publish(id, sh.sheet, meta, name);
      return { ok: true, output: item.output, width: sh.sheet.w, height: sh.sheet.h, notes, warnings, derived, bytes: written - before };
    }
    const { placed, t } = await place(keyed, family);
    notes.push(placementNote(t));
    if (part === 'body') {
      const arms = extractArms(base, placed, { cx: CANVAS.cx * res });
      if (arms.found < 2) warnings.push(`팔을 ${arms.found}개만 찾았어요 — 팔이 몸에 붙어 있으면 몸통과 구분이 안 돼요`);
      const L = (p) => (p ? [r1(p[0] / res), r1(p[1] / res)] : undefined);
      const pivots = { armL: L(arms.pivots.armL), armR: L(arms.pivots.armR) };
      const hands = { handL: L(arms.hands.handL), handR: L(arms.hands.handR) };
      const bodyCrop = cropToContent(placed);
      await publish(id, bodyCrop.raw, { res, rect: rectToLogical(bodyCrop.rect, res), pivots }, name);
      const armsId = `${prefix}-arms`;
      if (arms.found && getItem(m, armsId)) {
        const ac = cropToContent(arms.arms);
        await publish(armsId, ac.raw, { res, rect: rectToLogical(ac.rect, res), pivots, hands }, `${name} (기본 − 팔 없음)`);
        derived.push({ id: armsId, note: `팔 ${arms.found}개 · 축 L(${pivots.armL?.join(',') ?? '-'}) R(${pivots.armR?.join(',') ?? '-'}) · 손 L(${hands.handL?.join(',') ?? '-'}) R(${hands.handR?.join(',') ?? '-'})` });
        await studio.patchMeta(`${prefix}-base`, { anchors: { ...(baseItem.meta.anchors ?? {}), ...(hands.handL ? { handL: hands.handL } : {}), ...(hands.handR ? { handR: hands.handR } : {}) } });
      }
      return { ok: true, output: item.output, width: bodyCrop.raw.w, height: bodyCrop.raw.h, notes, warnings, derived, bytes: written - before };
    }
    // overlays: eyes-closed / mouth-open / expr-*
    const hb = anchors.headBox ?? { left: 200, right: 824, top: 420, bottom: 900 };
    const bb = anchors.bbox ?? { y: 420 };
    const isExpr = part.startsWith('expr-');
    const faceBox = isExpr
      ? { left: hb.left - 60, right: hb.right + 60, top: bb.y - 240, bottom: hb.bottom + (CANVAS.feetY - hb.bottom) * 0.45 }
      : { left: hb.left - 12, right: hb.right + 12, top: hb.top - 8, bottom: hb.bottom + 12 };
    const box = boxAt(faceBox, res, placed.w, placed.h);
    const o = extractOverlay(placed, base, { box });
    if (o.shift.dx || o.shift.dy) notes.push(`기본 그림에 맞춰 (${o.shift.dx}, ${o.shift.dy})px 이동`);
    const { inside, outside } = o.changed;
    if (!inside) throw new Error('기본 그림과 다른 곳이 없어요 (편집이 안 된 그림?)');
    const swap = isExpr && (outside > SWAP_OUTSIDE.px * (res / CHARA_RES) ** 2 || outside > inside * SWAP_OUTSIDE.share);
    if (!isExpr && outside > inside * 0.5) warnings.push(`얼굴 밖도 많이 바뀌었어요 (${outside}px) — 겹침 그림에는 얼굴만 써요`);
    const img = swap ? o.edited : o.overlay;
    const crop = cropToContent(img);
    await publish(id, crop.raw, { res, rect: rectToLogical(crop.rect, res), overlay: !swap }, name);
    notes.push(`${swap ? '통째 교체 (얼굴 밖 변화가 큼)' : '겹침 그림'} · 바뀐 픽셀 얼굴 ${inside} / 밖 ${outside}`);
    return { ok: true, output: item.output, width: crop.raw.w, height: crop.raw.h, notes, warnings, derived, bytes: written - before };
  }

  /** MC art: keyed, fit into the item's size (old PNG paths); eyes-closed / mouth-open → overlays of mc-<dog>-neutral. */
  async function importMc(m, item, file, name, { notes, warnings, before, batch }) {
    const src = await readSource(file);
    const keyed = keyBackdrop(src);
    notes.push(`원본 ${src.w}×${src.h} · 배경 rgb(${keyed.bg.r},${keyed.bg.g},${keyed.bg.b})`);
    const W = item.size?.w ?? 1024;
    const H = item.size?.h ?? 1024;
    const s = Math.min(W / keyed.w, H / keyed.h);
    const fitted = blit(await resizeRaw(keyed, Math.round(keyed.w * s), Math.round(keyed.h * s)), W, H, Math.round((W - keyed.w * s) / 2), Math.round((H - keyed.h * s) / 2));
    if (Math.abs(keyed.w / keyed.h - W / H) > 0.05) notes.push(`비율이 달라 ${W}×${H} 안에 맞춤 (여백 투명)`);
    const part = item.meta?.part;
    if (!part) {
      const out = await studio.publish(item.id, await rawToPng(fitted), { from: name });
      written += out.bytes ?? 0;
      if (item.meta?.expression === 'neutral') {
        const stale = ['eyes-closed', 'mouth-open'].filter((p) => getItem(m, `mc-${item.meta.mc}-${p}`)?.status === 'accepted' && !batch.has(`mc-${item.meta.mc}-${p}`));
        if (stale.length && item.status === 'accepted') warnings.push(`기본 그림이 바뀌었어요 — ${stale.join(', ')}도 다시 가져오세요`);
      }
      return { ok: true, output: item.output, width: W, height: H, transparent: transparentShare(fitted), notes, warnings, derived: [], bytes: written - before };
    }
    const baseItem = getItem(m, item.meta.base);
    if (baseItem?.status !== 'accepted') throw new Error(`기본 그림(${item.meta.base})을 먼저 가져와야 해요`);
    const base = await rawOf(await readFile(path.join(outputDir, baseItem.accepted.file)));
    if (base.w !== W || base.h !== H) throw new Error(`기본 그림 크기가 달라요 (${base.w}×${base.h})`);
    const st = figureStats(base);
    const box = { left: st.bbox.left, right: st.bbox.right, top: Math.max(0, st.bbox.top - 10), bottom: Math.round(st.bbox.top + st.bbox.height * 0.8) };
    const o = extractOverlay(fitted, base, { box });
    if (!o.changed.inside) throw new Error('기본 그림과 다른 곳이 없어요 (편집이 안 된 그림?)');
    if (o.shift.dx || o.shift.dy) notes.push(`기본 그림에 맞춰 (${o.shift.dx}, ${o.shift.dy})px 이동`);
    const crop = cropToContent(o.overlay);
    const out = await studio.publish(item.id, await rawToPng(crop.raw), { meta: { rect: crop.rect, size: [W, H] }, from: name });
    written += out.bytes ?? 0;
    notes.push(`겹침 그림 · 바뀐 픽셀 ${o.changed.inside} (밖 ${o.changed.outside})`);
    return { ok: true, output: item.output, width: crop.raw.w, height: crop.raw.h, notes, warnings, derived: [], bytes: written - before };
  }

  return { importOne, bytesWritten: () => written, label: (id) => PART_LABELS[idRole(id)?.part] ?? '' };
}

/** Size of a file in bytes (0 when missing). */
export const fileSize = (p) => stat(p).then((s) => s.size, () => 0);
export { kb };
