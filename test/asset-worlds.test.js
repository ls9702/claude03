// 세계 설정 art variants: manifest `meta.world` (cards / items / treasures / icons), the client's findAsset `world`
// preference, the generator scripts/gen-world-manifest.js (🐹 variants, 🐹 job badges, tile icons), the 3D board's tile icon
// fallback order (scene/tileIcons.js) and the importer end to end on a temp manifest copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadData } from '../server/data/index.js';
import { MANIFEST_PATH, WORLD_ART_KINDS, loadManifest, validateItem, validateManifest } from '../server/assets/manifest.js';
import { createStudio } from '../server/assets/studio.js';
import { dataForWorld } from '../server/game/world.js';
import { findAsset, setAssetIndex } from '../public/js/assets.js';
import { ICON_ASSET_TILE, findTileIcon, tileIconCandidates } from '../public/js/scene/tileIcons.js';
import { DESC, TILE_ICON_TYPES, WORLD_VARIANTS, upsertWorldItems, worldArtItems, worldJobIds } from '../scripts/gen-world-manifest.js';
import { importAssets } from '../scripts/import-assets.js';
import { tempManifest, whiteIcon } from './assetFixtures.js';
import { tempDir } from './helpers.js';

const slug = (id) => id.replaceAll('_', '-');
const iconBase = () => ({
  id: 'card-x-chiikawa',
  kind: 'card',
  label: '카드 · 테스트',
  aspect: '1:1',
  prompt: 'a test card icon prompt',
  refs: [],
  output: 'cards/chiikawa/x.png',
  postprocess: ['whiteToAlpha', 'trim', 'resize:256x256'],
  status: 'todo',
  meta: { card: 'x', world: 'chiikawa' },
});

test('manifest: meta.world is allowed on card / item / treasure / icon and must be a known world', () => {
  assert.deepEqual(WORLD_ART_KINDS, ['card', 'item', 'treasure', 'icon']);
  const errs = (patch) => validateItem({ ...iconBase(), ...patch });
  assert.deepEqual(errs({}), []);
  assert.deepEqual(errs({ meta: { card: 'x', world: 'real' } }), []);
  assert.deepEqual(errs({ kind: 'item', meta: { item: 'car', world: 'chiikawa' } }), []);
  assert.deepEqual(errs({ kind: 'treasure', meta: { treasure: 'amber', world: 'chiikawa' } }), []);
  assert.deepEqual(errs({ kind: 'icon', meta: { job: 'weeder', world: 'chiikawa' } }), []);
  assert.ok(errs({ meta: { card: 'x', world: 'mars' } }).some((e) => /meta\.world/.test(e)));
  assert.ok(errs({ meta: { card: 'x', world: '' } }).some((e) => /meta\.world/.test(e)));
  assert.ok(errs({ meta: { card: 'x', world: 1 } }).some((e) => /meta\.world/.test(e)));
  assert.ok(errs({ kind: 'bg', aspect: '16:9', output: 'bg/x.webp', postprocess: ['webp'], meta: { scene: 'x', world: 'chiikawa' } }).some((e) => /meta\.world/.test(e)));
  assert.ok(errs({ kind: 'prop', meta: { prop: 'x', slot: 'head', world: 'chiikawa' } }).some((e) => /meta\.world/.test(e)));
});

test('findAsset: the world variant wins, else the shared art; never another world; no world → shared only', (t) => {
  t.after(() => setAssetIndex({}));
  setAssetIndex({
    'card-taxi-chiikawa': { url: '/c/taxi-chiikawa.png', kind: 'card', meta: { card: 'taxi', world: 'chiikawa' } },
    'card-taxi': { url: '/c/taxi.png', kind: 'card', meta: { card: 'taxi' } },
    'card-noise-real': { url: '/c/noise-real.png', kind: 'card', meta: { card: 'noise', world: 'real' } },
    'card-noise-chiikawa': { url: '/c/noise-chiikawa.png', kind: 'card', meta: { card: 'noise', world: 'chiikawa' } },
    'item-car-chiikawa': { url: '/i/car-chiikawa.png', kind: 'item', meta: { item: 'car', world: 'chiikawa' } },
    'icon-job-doctor': { url: '/j/doctor.png', kind: 'icon', meta: { job: 'doctor' } },
    'icon-salary': { url: '/t/salary.png', kind: 'icon', meta: { tile: 'salary' } },
  });
  const id = (q) => findAsset(q)?.id ?? null;
  // a variant listed BEFORE the shared art is still skipped without a world, and wins in its world
  assert.equal(id({ kind: 'card', card: 'taxi' }), 'card-taxi');
  assert.equal(id({ kind: 'card', card: 'taxi', world: 'chiikawa' }), 'card-taxi-chiikawa');
  assert.equal(id({ kind: 'card', card: 'taxi', world: 'real' }), 'card-taxi');
  assert.equal(id({ kind: 'card', card: 'taxi', world: null }), 'card-taxi');
  // only variants: each world gets its own, no world → nothing
  assert.equal(id({ kind: 'card', card: 'noise', world: 'real' }), 'card-noise-real');
  assert.equal(id({ kind: 'card', card: 'noise', world: 'chiikawa' }), 'card-noise-chiikawa');
  assert.equal(id({ kind: 'card', card: 'noise' }), null);
  // a 🐹-only variant is never shown in a real room
  assert.equal(id({ kind: 'item', item: 'car', world: 'chiikawa' }), 'item-car-chiikawa');
  assert.equal(id({ kind: 'item', item: 'car', world: 'real' }), null);
  assert.equal(id({ kind: 'item', item: 'car' }), null);
  // shared icons serve every world; the entry carries its id + url
  assert.equal(id({ kind: 'icon', job: 'doctor', world: 'chiikawa' }), 'icon-job-doctor');
  assert.deepEqual(findAsset({ kind: 'icon', tile: 'salary', world: 'real' }), { id: 'icon-salary', url: '/t/salary.png', kind: 'icon', meta: { tile: 'salary' } });
  assert.equal(id({ kind: 'icon', tile: 'pass', world: 'chiikawa' }), null);
});

test('generator: the exact 🐹 variant / job badge / tile icon ids, outputs and metas', () => {
  const items = worldArtItems();
  const ids = (re) => items.filter((i) => re.test(i.id)).map((i) => i.id).sort();
  assert.deepEqual(WORLD_VARIANTS.card, ['study', 'insider', 'energy', 'taxi', 'pledge', 'insurance', 'amulet', 'lotto', 'coupon', 'lawyer', 'cut_line', 'noise', 'tax_audit', 'complaint']);
  assert.deepEqual(WORLD_VARIANTS.item, ['car', 'laptop', 'gym_pass', 'designer_bag', 'lucky_cat', 'massage_chair']);
  assert.deepEqual(WORLD_VARIANTS.treasure, ['celadon', 'white_porcelain', 'idol_goods', 'dino_fossil', 'gold_toad', 'stamp', 'lp_record', 'sneakers', 'calligraphy', 'ginseng', 'retro_console', 'first_edition', 'black_pearl', 'signed_ball', 'amber', 'gold_crown']);
  for (const kind of ['card', 'item', 'treasure']) {
    assert.deepEqual(ids(new RegExp(`^${kind}-.*-chiikawa$`)), WORLD_VARIANTS[kind].map((d) => `${kind}-${slug(d)}-chiikawa`).sort(), kind);
  }
  const jobs = ['weeder', 'hunter', 'ramen', 'workshop', 'bookstore', 'busker', 'pancake', 'photographer', 'sento', 'delivery', 'fisher', 'cafe', 'legend_hunter', 'weed_sage', 'ramen_owner', 'armor_san'];
  assert.deepEqual(worldJobIds(), jobs);
  assert.deepEqual(ids(/^icon-job-/), jobs.map((j) => `icon-job-${slug(j)}`).sort());
  assert.deepEqual(TILE_ICON_TYPES, ['start', 'event', 'salary', 'pass', 'hometown', 'temple', 'jeju', 'reversal', 'island', 'contest', 'auction', 'hunt', 'weed', 'merge']);
  assert.deepEqual(ids(/^icon-(?!job-)/), TILE_ICON_TYPES.map((x) => `icon-${x}`).sort());
  assert.equal(items.length, 14 + 6 + 16 + 16 + 14 + 6); // + one house-<slug> per houses.json id
  assert.deepEqual(ids(/^house-/), loadData('houses').houses.map((h) => `house-${slug(h.id)}`).sort());
  const overlay = loadData('worlds/chiikawa');
  for (const i of items) {
    assert.equal(i.kind === 'card' || i.kind === 'item' || i.kind === 'treasure' || i.kind === 'icon' || i.kind === 'house', true, i.id);
    assert.deepEqual(validateItem(i), [], i.id);
    assert.equal(i.aspect, '1:1');
    assert.deepEqual(i.postprocess, ['whiteToAlpha', 'trim', 'resize:256x256']);
    assert.equal(i.status, 'todo');
    assert.match(i.label, /[가-힣]/);
    assert.doesNotMatch(i.prompt, /[가-힣]/, `${i.id} prompt is English`);
    assert.ok(i.prompt.includes('Chiikawa') && i.prompt.includes('{{whiteBg}}'), i.id);
    if (i.meta.world) {
      const data = i.meta.card ?? i.meta.item ?? i.meta.treasure;
      const kind = i.kind;
      assert.equal(i.meta.world, 'chiikawa');
      assert.equal(i.output, `${kind === 'card' ? 'cards' : kind === 'item' ? 'items' : 'treasures'}/chiikawa/${slug(data)}.png`);
      // the label names the 🐹 object (overlay name) and the prompt carries its emoji
      const w = overlay[`${kind}s`][`${kind}s`].replace[data];
      assert.ok(i.label.includes(w.name) && i.label.includes('치이카와'), i.label);
      assert.ok(i.prompt.includes(w.icon), i.id);
      assert.ok(DESC[kind][data] && i.prompt.includes(DESC[kind][data]), i.id);
    } else if (i.meta.job) assert.equal(i.output, `icons/jobs/${slug(i.meta.job)}.png`);
    else if (i.kind === 'house') {
      assert.equal(i.output, `houses/${slug(i.meta.house)}.png`);
      assert.deepEqual(Object.keys(i.meta), ['house']);
    } else {
      assert.equal(i.output, `icons/${i.meta.tile}.png`);
      assert.deepEqual(Object.keys(i.meta), ['tile']);
    }
  }
});

test('generator: lists stay in sync with the overlay (a listed id the overlay does not change is refused)', () => {
  const overlay = structuredClone(loadData('worlds/chiikawa'));
  delete overlay.cards.cards.replace.taxi;
  assert.throws(() => worldArtItems({ overlay }), /taxi/);
  const o2 = structuredClone(loadData('worlds/chiikawa'));
  o2.jobs.jobs.add.push({ id: 'astro_chef', name: '우주 요리사', icon: '👩‍🚀' });
  assert.throws(() => worldArtItems({ overlay: o2 }), /astro_chef/);
});

test('generator: idempotent upsert; existing items keep status / accepted / output / importer meta; the shipped manifest has them all', async () => {
  const shipped = await loadManifest(MANIFEST_PATH);
  const wanted = worldArtItems();
  const byId = new Map(shipped.items.map((i) => [i.id, i]));
  for (const i of wanted) assert.ok(byId.has(i.id), `${i.id} in the shipped manifest`);
  // re-running on the shipped manifest changes nothing
  const again = upsertWorldItems(structuredClone(shipped));
  assert.deepEqual([again.added, again.updated, again.total], [0, 0, wanted.length]);
  // from scratch: adds everything once, then nothing
  const ours = new Set(wanted.map((i) => i.id));
  const bare = { ...structuredClone(shipped), items: shipped.items.filter((i) => !ours.has(i.id)) };
  const first = upsertWorldItems(bare);
  assert.equal(first.added, wanted.length);
  assert.equal(validateManifest(first.manifest).ok, true, validateManifest(first.manifest).errors.join('\n'));
  const second = upsertWorldItems(first.manifest);
  assert.deepEqual([second.added, second.updated], [0, 0]);
  // an accepted variant keeps its file, output and the importer's meta
  const m = structuredClone(first.manifest);
  const it = m.items.find((i) => i.id === 'card-taxi-chiikawa');
  Object.assign(it, { status: 'accepted', output: 'cards/chiikawa/taxi-v2.png', accepted: { file: 'cards/chiikawa/taxi-v2.png', generatedAt: 'x', source: 'upload' }, meta: { ...it.meta, extra: 1 } });
  upsertWorldItems(m);
  const kept = m.items.find((i) => i.id === 'card-taxi-chiikawa');
  assert.equal(kept.status, 'accepted');
  assert.equal(kept.output, 'cards/chiikawa/taxi-v2.png');
  assert.equal(kept.accepted.file, 'cards/chiikawa/taxi-v2.png');
  assert.deepEqual(kept.meta, { card: 'taxi', world: 'chiikawa', extra: 1 });
  // every variant has its shared base art slot; every 🐹 world job has a badge slot
  for (const i of wanted.filter((x) => x.meta.world)) assert.ok(byId.has(i.id.replace(/-chiikawa$/, '')), i.id);
  for (const j of dataForWorld('chiikawa').jobs.jobs) assert.equal(byId.get(`icon-job-${slug(j.id)}`)?.meta.job, j.id, j.id);
});

test('tile icons: own icon first, then the borrowed one; every board tile type has an icon slot', async () => {
  assert.deepEqual(tileIconCandidates('salary'), ['salary', 'money']);
  assert.deepEqual(tileIconCandidates('pass'), ['pass', 'shop']);
  assert.deepEqual(tileIconCandidates('heart'), ['heart', 'love']);
  assert.deepEqual(tileIconCandidates('loss'), ['loss', 'bad']);
  assert.deepEqual(tileIconCandidates('habit'), ['habit', 'school']);
  assert.deepEqual(tileIconCandidates('money'), ['money']);
  assert.deepEqual(tileIconCandidates('hunt'), ['hunt']);
  assert.deepEqual(tileIconCandidates('stop', '📝'), ['school', 'stop']);
  assert.deepEqual(tileIconCandidates(''), []);
  const index = { 'icon-money': { url: '/m.png' }, 'icon-salary': { url: null } };
  const calls = [];
  const find = (q) => {
    calls.push(q);
    return index[`icon-${q.tile}`] ?? null;
  };
  // salary's own icon has no url yet → the money icon
  assert.equal(findTileIcon('salary', { find })?.url, '/m.png');
  assert.deepEqual(calls, [{ kind: 'icon', tile: 'salary' }, { kind: 'icon', tile: 'money' }]);
  calls.length = 0;
  assert.equal(findTileIcon('pass', { find, world: 'chiikawa' }), null);
  assert.deepEqual(calls, [{ kind: 'icon', tile: 'pass', world: 'chiikawa' }, { kind: 'icon', tile: 'shop', world: 'chiikawa' }]);
  assert.equal(findTileIcon('pass', {}), null);
  // the shipped manifest: every board.json tile type resolves to at least one icon item (own or borrowed)
  const m = await loadManifest(MANIFEST_PATH);
  const tiles = new Set(m.items.filter((i) => i.kind === 'icon' && i.meta?.tile).map((i) => i.meta.tile));
  for (const type of Object.keys(loadData('board').tileTypes)) {
    assert.ok(tiles.has(type) || tiles.has(ICON_ASSET_TILE[type]), `${type} has a tile icon slot`);
  }
  for (const type of TILE_ICON_TYPES) assert.ok(tiles.has(type), type);
});

test('import: 🐹 variants / job badges / tile icons import like any icon; the public index serves each world its art', async (t) => {
  t.after(() => setAssetIndex({}));
  const tmp = await tempDir();
  t.after(() => tmp.cleanup());
  const ids = ['card-taxi', 'card-taxi-chiikawa', 'item-car-chiikawa', 'icon-job-weeder', 'icon-salary', 'icon-money'];
  const manifestPath = await tempManifest(path.join(tmp.dir, 'm'), ids);
  const inbox = path.join(tmp.dir, 'inbox');
  const outputDir = path.join(tmp.dir, 'out');
  const dataDir = path.join(tmp.dir, 'data');
  await mkdir(inbox, { recursive: true });
  for (const id of ['card-taxi', 'card-taxi-chiikawa', 'item-car-chiikawa', 'icon-job-weeder', 'icon-salary']) await writeFile(path.join(inbox, `${id}.png`), await whiteIcon({ size: 128 }));
  const run = await importAssets({ dir: inbox, manifestPath, outputDir, dataDir, log: () => {} });
  assert.equal(run.failed, 0, JSON.stringify(run.results));
  const byId = new Map(run.results.map((r) => [r.id, r]));
  assert.equal(byId.get('card-taxi-chiikawa').output, 'cards/chiikawa/taxi.png');
  assert.equal(byId.get('item-car-chiikawa').output, 'items/chiikawa/car.png');
  assert.equal(byId.get('icon-job-weeder').output, 'icons/jobs/weeder.png');
  assert.equal(byId.get('icon-salary').output, 'icons/salary.png');
  for (const r of run.results) {
    assert.deepEqual([r.width, r.height], [256, 256], r.id);
    assert.ok(r.transparent > 0.2 && r.transparent < 0.97, `${r.id} keyed`);
  }
  const studio = createStudio({ dataDir, manifestPath, outputDir, client: { generateImage: async () => assert.fail('no API'), hasKey: async () => false } });
  const { assets } = await studio.publicIndex();
  assert.deepEqual(assets['card-taxi-chiikawa'].meta, { card: 'taxi', world: 'chiikawa' });
  setAssetIndex(assets);
  assert.equal(findAsset({ kind: 'card', card: 'taxi', world: 'chiikawa' }).id, 'card-taxi-chiikawa');
  assert.equal(findAsset({ kind: 'card', card: 'taxi', world: 'real' }).id, 'card-taxi');
  assert.equal(findAsset({ kind: 'card', card: 'taxi' }).id, 'card-taxi');
  assert.equal(findAsset({ kind: 'item', item: 'car', world: 'real' }), null);
  assert.equal(findAsset({ kind: 'icon', job: 'weeder', world: 'chiikawa' }).id, 'icon-job-weeder');
  // salary's own icon wins over the (not accepted here) money icon
  assert.equal(findTileIcon('salary', { find: findAsset, world: 'chiikawa' }).id, 'icon-salary');
  assert.equal(findTileIcon('money', { find: findAsset }), null);
});
