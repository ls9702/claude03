#!/usr/bin/env node
// 세계 설정 art slots: upsert into server/assets/manifest.json (idempotent, like gen-chara-manifest.js / gen-mc-manifest.js).
//
//   node scripts/gen-world-manifest.js            # write
//   node scripts/gen-world-manifest.js --dry-run  # only report
//
// Items (all status todo, white background → whiteToAlpha / trim / resize:256x256, 1:1, Chiikawa-style prompts):
//   🐹 variants  card-<slug>-chiikawa · item-<slug>-chiikawa · treasure-<slug>-chiikawa (meta {card|item|treasure: <data id>,
//                world: 'chiikawa'}) → cards/chiikawa/<slug>.png · items/chiikawa/<slug>.png · treasures/chiikawa/<slug>.png
//                — the cards / items / treasures the 🐹 overlay turns into a different OBJECT (택시 → 우사기 점프 …); the
//                client's findAsset({…, world}) shows them in 🐹 rooms, the shared `card-<slug>` art elsewhere.
//   job icons    icon-job-<slug> (meta {job}) → icons/jobs/<slug>.png for every job the 🐹 overlay ADDS (jobs.jobs.add).
//   tile icons   icon-<type> (meta {tile: type}) → icons/<type>.png (next to icon-money …) for the tile types without one;
//                board3d (scene/tileIcons.js) uses a type's own icon first, else the borrowed one (salary → money …).
//   houses       house-<slug> (kind house, meta {house}) → houses/<slug>.png for every houses.json id (shared by both worlds;
//                houseArt.js draws `findAsset({kind:'house', house})` in the 매물 cards / cut-ins / side list / result, else its SVG).
// `<slug>` = data id with `_` → `-`. Names / icons come from the data (overlay for the 🐹 objects); the English object
// descriptions below are written from them (prompts stay English). Existing items keep status / accepted / output and
// every extra meta field (importer). Nothing here calls the Gemini API (off in this repo): the user draws the art and
// drops `<id>.png` into assets-inbox/ → node scripts/import-assets.js.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadData } from '../server/data/index.js';
import { MANIFEST_PATH, loadManifest, saveManifest, validateManifest } from '../server/assets/manifest.js';
import { CHIIKAWA_STYLE, assetSlug } from '../server/assets/charaIds.js';

export const WORLD = 'chiikawa';
/** Cards / items / treasures whose 🐹 version is a different object (the rest keep one shared picture). */
export const WORLD_VARIANTS = Object.freeze({
  card: Object.freeze(['study', 'insider', 'energy', 'taxi', 'pledge', 'insurance', 'amulet', 'lotto', 'coupon', 'lawyer', 'cut_line', 'noise', 'tax_audit', 'complaint']),
  item: Object.freeze(['car', 'laptop', 'gym_pass', 'designer_bag', 'lucky_cat', 'massage_chair']),
  treasure: Object.freeze([
    'celadon',
    'white_porcelain',
    'idol_goods',
    'dino_fossil',
    'gold_toad',
    'stamp',
    'lp_record',
    'sneakers',
    'calligraphy',
    'ginseng',
    'retro_console',
    'first_edition',
    'black_pearl',
    'signed_ball',
    'amber',
    'gold_crown',
  ]),
});
/** Tile types that get their own icon-<type> (the others have one, or a dedicated alias: heart love, loss bad, habit school). */
export const TILE_ICON_TYPES = Object.freeze(['start', 'event', 'salary', 'pass', 'hometown', 'temple', 'jeju', 'reversal', 'island', 'contest', 'auction', 'hunt', 'weed', 'merge']);

const DATA_FILE = { card: 'cards', item: 'items', treasure: 'treasures' };
const KIND_LABEL = { card: '카드', item: '아이템', treasure: '보물' };
const OUT_DIR = { card: 'cards', item: 'items', treasure: 'treasures' };
const WHAT = { card: 'game card illustration', item: 'game item icon', treasure: 'game treasure icon', job: 'round game badge icon', tile: 'game board tile icon', house: 'game house illustration (the whole building, front three-quarter view)' };
const STEPS = ['whiteToAlpha', 'trim', 'resize:256x256'];
/** Style reference: the accepted Chiikawa base figure (style only). */
const STYLE_REF = 'ch-chiikawa-base';

/** English object descriptions (written from the 🐹 overlay's names / desc / icons; data ids as keys). */
export const DESC = Object.freeze({
  card: {
    study: 'an open picture book on a tiny desk under a glowing desk lamp, a mug of cocoa and a small crescent moon — studying all night',
    insider: 'a cute pastel microphone with floating music notes — singing practice',
    energy: 'a wobbly custard pudding with a glossy caramel top and a cherry, with little sparkles and bouncy energy lines',
    taxi: 'a cream-yellow rabbit-like creature with two long upright ears leaping high into the air with both arms up and a wide happy open mouth, springy speed lines below',
    pledge: 'an open guitar case filled with coins and little paper hearts tossed in by fans, a small megaphone beside it',
    insurance: 'a rolled-up warranty certificate tied with a ribbon and stamped with a grey armor-helmet seal, a small round shield behind it',
    amulet: 'a small cloth protective charm pouch on a red string with a blue eye-bead charm, softly glowing',
    lotto: 'a pastel raffle ticket with a tear-off edge and a star pattern peeking out of a small cardboard prize-draw box',
    coupon: 'a pastel shop discount tag on a string with a small helmet emblem and a dashed scissor-cut coupon edge',
    lawyer: 'a sasumata (a long pole with a U-shaped fork at the top) standing upright in front of a small round shield, blocking an attack',
    cut_line: 'a small pit trap dug in the grass and hidden under leaves and twigs, a little shovel stuck in the dirt beside it',
    noise: 'a megaphone blasting jagged shout waves and tiny burst shapes — a loud battle cry',
    tax_audit: 'a sneaky little dark-purple troublemaker creature with a mischievous grin running off with a coin pouch',
    complaint: 'a broom and a woven work basket being snatched away by a mischievous little paw, with a swoosh line',
  },
  item: {
    car: 'a small pastel kick scooter with round wheels and a handlebar, with motion lines',
    laptop: 'a bundle of old antique books tied together with twine, with a ribbon bookmark',
    gym_pass: 'a sasumata: a long wooden pole with a curved U-shaped metal fork at the top',
    designer_bag: 'a small cute round cross-body pochette bag with a long strap and a little bow',
    lucky_cat: 'a bright green four-leaf clover with a tiny sparkle',
    massage_chair: 'a bundle of bathhouse tickets tied with a ribbon next to a small wooden bath bucket with a folded towel and hot-spring steam swirls',
  },
  treasure: {
    celadon: 'an ancient earthen clay jar with a cracked glaze and a bit of moss, as if found in a forest cave',
    white_porcelain: 'a shiny little silver goblet with a tiny engraved helmet emblem, sparkling',
    idol_goods: 'a sheet of shiny holographic rare stickers of round cute critters, with sparkles',
    dino_fossil: 'a fossil of a funny chimera monster imprinted in a rock slab, a mix of horns, fangs and a curly tail',
    gold_toad: 'a glowing golden chestnut with a shiny highlight',
    stamp: 'a pressed four-leaf clover bookmark laminated in a clear card with a ribbon tassel',
    lp_record: 'a coiled old guitar string with a worn guitar pick, tied with a little tag',
    sneakers: 'a pair of worn sporty sneakers in beige and brown with a sweatband — the shoes of a strong sea otter',
    calligraphy: 'a rare old red leather-bound book with gold corner fittings and a ribbon bookmark',
    ginseng: 'a giant forest mushroom with a big red cap with white spots',
    retro_console: 'an old wooden yo-yo and a spinning top in their worn cardboard toy box',
    first_edition: 'a first-edition picture book with a pastel illustrated cover (no letters) and a small gold seal',
    black_pearl: 'an open seashell clam holding a glossy round pearl',
    signed_ball: 'a cute golden crown shaped like a custard pudding with caramel drips and a cherry on top',
    amber: 'a few smooth rounded pieces of pastel sea glass, translucent aqua and green, with bubble sparkles',
    gold_crown: 'a legendary golden sasumata (a long pole with a U-shaped fork at the top) with a glowing aura and a ribbon',
  },
  job: {
    weeder: 'a tuft of pulled-up weeds with their roots beside a small woven weeding basket',
    hunter: 'a sasumata (a long pole with a U-shaped fork) crossed with a wooden sword over a small round shield',
    ramen: 'a huge bowl of ramen with a mountain of bean sprouts piled on top and chopsticks',
    workshop: 'a small hammer and a grey armor helmet resting on an anvil',
    bookstore: 'a stack of old books with a magnifying glass',
    busker: 'a small acoustic guitar with floating music notes',
    pancake: 'a fluffy stack of pancakes with melting butter, syrup and a spatula',
    photographer: 'a cute vintage camera with a flash sparkle',
    sento: 'a wooden bath bucket with a folded towel and hot-spring steam swirls',
    delivery: 'a taped cardboard delivery box with little speed lines',
    fisher: 'a fishing rod with a big fish on the line over a tiny island with a palm tree',
    cafe: 'a cup of latte with heart latte art and a coffee bean',
    legend_hunter: 'a golden sword crossed with a golden sasumata over a star-studded shield, glowing, with a gold rim — a legendary badge',
    weed_sage: 'a golden sheaf of grass with a first-place rosette ribbon (no numbers), with a gold rim — a legendary badge',
    ramen_owner: 'a steaming ramen bowl under a small shop entrance curtain (noren, no letters) with a golden star, with a gold rim — a legendary badge',
    armor_san: 'a gleaming full suit of armor with a round helmet and a golden hammer, with a gold rim — a legendary badge',
  },
  tile: {
    start: 'a small red start flag on a short pole planted in a tuft of grass',
    event: 'a round pastel surprise bubble with a bold exclamation-mark symbol and little sparkles',
    salary: 'a pay envelope stuffed with banknotes and a small gold coin — payday',
    pass: 'a striped circus tent with a little flag on top — the chance plaza',
    hometown: 'a small cosy countryside house with a thatched roof and a persimmon tree',
    temple: 'a small mountain temple pavilion with a curved roof and a hanging bronze bell',
    jeju: 'a small island with a palm tree, a wave and a round stone grandfather statue',
    reversal: 'a slot machine showing three lucky stars with a shower of coins',
    island: 'a tiny tropical island with a big colourful roulette wheel standing on the beach next to a palm tree',
    contest: 'a shiny gold trophy cup with a ribbon',
    auction: 'a wooden auction gavel striking its sound block, a small antique vase beside it',
    hunt: 'a sasumata crossed with a wooden sword in front of a bush with two glowing grumpy eyes peeking out',
    weed: 'a tuft of green weeds being pulled up with their roots beside a small woven basket',
    merge: 'two winding pastel paths joining into one, with a small wooden signpost (no letters)',
  },
  house: {
    oneroom: 'a tiny cute one-room studio: a small pastel box-shaped building with one window, a little door and a potted plant',
    villa: 'a cosy two-storey pastel villa in a quiet alley with a small balcony and flower boxes under the windows',
    apartment: 'a friendly pastel apartment block with rows of small windows and balconies and a little entrance',
    hanok: 'a traditional Korean hanok house with a curved grey tiled roof, wooden pillars and a low courtyard wall',
    penthouse: 'a tall shiny city tower with a glass penthouse and a tiny rooftop garden on the top floor, a few sparkles',
    jeju_villa: 'a seaside villa with a palm tree, a low wall of round black lava stones and the blue sea behind it, a golden sparkle',
  },
});

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The 🐹 overlay's patch of a data file's id array (`{replace, add, remove}`) or {}. */
function idPatch(overlay, name) {
  const p = overlay?.[name];
  if (!isObj(p)) return {};
  const key = Object.keys(p).find((k) => !k.startsWith('_') && isObj(p[k]));
  return key ? p[key] : {};
}

/** Ids of the jobs the 🐹 overlay adds (jobs.jobs.add). */
export function worldJobIds(overlay = loadData(`worlds/${WORLD}`)) {
  return (overlay?.jobs?.jobs?.add ?? []).map((j) => j.id).filter((id) => typeof id === 'string' && id);
}

function prompt(what, desc, icon) {
  return (
    `${CHIIKAWA_STYLE} Use the reference image only as a style guide (soft Chiikawa line art and pastel colours); do not draw that character unless described. ` +
    `A single cute ${WHAT[what]}: ${desc}${icon ? ` (in-game emoji: ${icon})` : ''}. ` +
    'Centered, fills about 80% of the square, soft thin warm-grey outline, flat pastel colours, almost no shading. {{whiteBg}} No text, no letters, no numbers. Square 1:1.'
  );
}

function iconItem({ id, kind, label, what, desc, icon, output, meta }) {
  return { id, kind, label, aspect: '1:1', size: { w: 256, h: 256 }, prompt: prompt(what, desc, icon), refs: [STYLE_REF], output, postprocess: [...STEPS], status: 'todo', meta };
}

/**
 * The generated item list (pure, given the data). Throws when a listed id is missing from the overlay / data or has no
 * English description (keeps the lists, the overlay and DESC in sync).
 */
export function worldArtItems({ overlay = loadData(`worlds/${WORLD}`), cards = loadData('cards'), items = loadData('items'), treasures = loadData('treasures'), board = loadData('board'), houses = loadData('houses') } = {}) {
  const base = { card: cards.cards ?? [], item: items.items ?? [], treasure: treasures.treasures ?? [] };
  const out = [];
  const problems = [];
  for (const [kind, ids] of Object.entries(WORLD_VARIANTS)) {
    const replace = idPatch(overlay, DATA_FILE[kind]).replace ?? {};
    for (const id of ids) {
      const def = base[kind].find((x) => x.id === id);
      const w = replace[id];
      if (!def) problems.push(`${kind} ${id}: 데이터에 없어요`);
      if (!w) problems.push(`${kind} ${id}: 치이카와 오버레이에 바뀐 내용이 없어요`);
      if (!DESC[kind][id]) problems.push(`${kind} ${id}: 영어 설명이 없어요`);
      if (!def || !w || !DESC[kind][id]) continue;
      const slug = assetSlug(id);
      out.push(
        iconItem({
          id: `${kind}-${slug}-${WORLD}`,
          kind,
          label: `${KIND_LABEL[kind]} · ${w.name ?? def.name} (치이카와 모드)`,
          what: kind,
          desc: DESC[kind][id],
          icon: w.icon ?? def.icon,
          output: `${OUT_DIR[kind]}/${WORLD}/${slug}.png`,
          meta: { [kind]: id, world: WORLD },
        }),
      );
    }
  }
  for (const j of overlay?.jobs?.jobs?.add ?? []) {
    if (!DESC.job[j.id]) {
      problems.push(`job ${j.id}: 영어 설명이 없어요`);
      continue;
    }
    const slug = assetSlug(j.id);
    out.push(iconItem({ id: `icon-job-${slug}`, kind: 'icon', label: `직업 배지 · ${j.name}`, what: 'job', desc: DESC.job[j.id], icon: j.icon, output: `icons/jobs/${slug}.png`, meta: { job: j.id } }));
  }
  const types = board?.tileTypes ?? {};
  for (const type of TILE_ICON_TYPES) {
    const t = types[type];
    if (!t) problems.push(`tile ${type}: board.json tileTypes에 없어요`);
    if (!DESC.tile[type]) problems.push(`tile ${type}: 영어 설명이 없어요`);
    if (!t || !DESC.tile[type]) continue;
    out.push(iconItem({ id: `icon-${type}`, kind: 'icon', label: `칸 아이콘 · ${t.name ?? type}`, what: 'tile', desc: DESC.tile[type], icon: t.icon, output: `icons/${type}.png`, meta: { tile: type } }));
  }
  for (const h of houses?.houses ?? []) {
    if (!DESC.house[h.id]) {
      problems.push(`house ${h.id}: 영어 설명이 없어요`);
      continue;
    }
    const slug = assetSlug(h.id);
    out.push(iconItem({ id: `house-${slug}`, kind: 'house', label: `집 · ${h.name}`, what: 'house', desc: DESC.house[h.id], icon: h.icon, output: `houses/${slug}.png`, meta: { house: h.id } }));
  }
  if (problems.length) throw new Error(`세계 설정 그림 목록 오류: ${problems.join(' / ')}`);
  return out;
}

/**
 * Upsert into a manifest object (pure): new items are added; existing ones keep status / accepted / output (accepted)
 * and every extra meta field (generated identity fields win).
 */
export function upsertWorldItems(manifest, opts = {}) {
  const wanted = worldArtItems(opts);
  const byId = new Map(manifest.items.map((i, k) => [i.id, k]));
  let added = 0;
  let updated = 0;
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
    if (JSON.stringify(next) !== JSON.stringify(old)) updated++;
    manifest.items[k] = next;
  }
  return { manifest, added, updated, total: wanted.length };
}

async function main(argv) {
  const dry = argv.includes('--dry-run');
  const m = await loadManifest(MANIFEST_PATH);
  const r = upsertWorldItems(m);
  const v = validateManifest(r.manifest);
  if (!v.ok) throw new Error(v.errors.join('\n'));
  const count = (re) => r.manifest.items.filter((i) => re.test(i.id) && i.meta).length;
  console.log(
    `세계 설정 그림 칸 ${r.total}개: 추가 ${r.added}, 갱신 ${r.updated}${dry ? ' (dry-run)' : ''} · 🐹 카드 ${count(/^card-.*-chiikawa$/)} · 아이템 ${count(/^item-.*-chiikawa$/)} · 보물 ${count(
      /^treasure-.*-chiikawa$/,
    )} · 직업 배지 ${worldJobIds().length} · 칸 아이콘 ${TILE_ICON_TYPES.length} · 집 ${count(/^house-/)}`,
  );
  if (!dry) await saveManifest(r.manifest, MANIFEST_PATH);
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? '')).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
