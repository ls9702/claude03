#!/usr/bin/env node
// node scripts/gen-asset-guide.js [--out <dir>] [--dry-run]
// Builds docs/asset-requests/remaining-all.{json,md}: every art item the game still needs, in priority order, for the
// user's local image skill (the Gemini API stays OFF in this repo). Items already accepted in the Chiikawa style (imported /
// uploaded from 2026-10-16 on) drop out, so re-running after an import refreshes the guide.
// Reuses the prompts of the earlier request files (chiikawa-full / -mc / -world) for items not delivered yet and
// writes new ones for props / cards / items / treasures / job + tile icons / frames (object descriptions from the manifest
// where they exist, restyled to the Chiikawa template).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const OUT = argv.includes('--out') ? path.resolve(argv[argv.indexOf('--out') + 1]) : path.join(ROOT, 'docs/asset-requests');
const DRY = argv.includes('--dry-run');
const REQ = path.join(ROOT, 'docs/asset-requests');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const manifest = readJson(path.join(ROOT, 'server/assets/manifest.json'));
const M = new Map(manifest.items.map((i) => [i.id, i]));
const props = readJson(path.join(ROOT, 'server/data/props.json'));
const ov = readJson(path.join(ROOT, 'server/data/worlds/chiikawa.json'));

const full = readJson(path.join(REQ, 'chiikawa-full.json'));
const mc = readJson(path.join(REQ, 'chiikawa-mc.json'));
const world = readJson(path.join(REQ, 'chiikawa-world.json'));
const STYLE = full.style;
const reqItems = new Map();
for (const j of [full, mc, world]) for (const b of j.batches) for (const it of b.items) reqItems.set(it.id, it);

// accepted in the Chiikawa style (hand-made art imported from 2026-10-16 on; older uploads are the anime / glossy style)
const accepted = (id) => M.get(id)?.status === 'accepted' && ['import', 'upload'].includes(M.get(id)?.accepted?.source) && String(M.get(id)?.accepted?.acceptedAt ?? '') >= '2026-10-16';
// manifest id for a request id (noarms → body, bear_cub → bear-cub …)
const manifestId = (rid) => rid.replace(/-noarms$/, '-body').replace(/_/g, '-');
const done = (rid) => accepted(manifestId(rid));

// ---------- templates ----------
const ICON_TAIL =
  'Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.';
const icon = (what, desc) => `${STYLE} ${what}: ${desc}. Simple flat pastel colours, soft thin warm-grey outline, cute and round. ${ICON_TAIL}`;
const BG_TAIL =
  'Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text, no letters. Leave open empty ground in the lower centre for characters to stand.';
const bg = (desc) => `${STYLE} ${desc} ${BG_TAIL}`;
const SLOT_VIEW = {
  head: 'Drawn ALONE (no character, no head): front view, exactly as it would sit on top of a small round head, bottom edge gently curved to fit the head.',
  face: 'Drawn ALONE (no character, no face): front view, exactly as it would be worn on the face.',
  neck: 'Drawn ALONE (no character, no body): front view, exactly as it would be worn around a short neck / on the chest.',
  hand: 'Drawn ALONE (no character, no hand): a small item standing upright, as it would be held in one little paw.',
  back: 'Drawn ALONE (no character, no body): front view of the item as worn on the back, so its edges would peek out from behind a small round character.',
};
const prop = (p) => `${STYLE} ${p.promptDesc}, main colour ${p.color}. ${SLOT_VIEW[p.slot]} A small game costume prop with a thin warm-grey outline. ${ICON_TAIL}`;
// object description out of an old (glossy-style) manifest prompt
function oldDesc(id) {
  const pr = M.get(id)?.prompt ?? '';
  const m = pr.match(/(?:icon|illustration icon|badge icon|tile icon): (.+?)\. Centered/);
  return m ? m[1] : null;
}
function frameDesc(id) {
  const pr = M.get(id)?.prompt ?? '';
  const m = pr.match(/frame, (.+?), evenly/);
  return m ? m[1] : null;
}

// ---------- 1. characters ----------
const MOMONGA_STYLE = STYLE.replace('tiny black dot eyes with a small white highlight, ', '');
const MOMONGA_LOOK =
  'Momonga from Chiikawa: a small round white chibi flying squirrel with BIG round glossy dark eyes looking slightly UPWARD (a pleading "please notice me" look, eyes much larger than Chiikawa\'s dot eyes, big white sparkle highlights), large upright ears with pale sky-blue insides, a small pale sky-blue nose, pink blush, a tiny ω-shaped mouth and a BIG fluffy pale sky-blue tail with darker blue stripes rising behind the body on one side. NO wings, NO gliding membrane, the tail is NOT white.';
// The user's own reference picture (2nd ref) decides the design: the vector stand-in and the first delivered take were
// both judged "not Momonga at all" — so the prompt asks to COPY the reference, the text is only a backup.
const momongaBase =
  `${MOMONGA_STYLE} Redraw the character shown in the SECOND attached image — Momonga from the Chiikawa manga — as faithfully as possible: copy its face, the shape and size of its eyes, its ears, nose, mouth, tail, body proportions and colours exactly as drawn there; do not redesign or simplify it, do not turn it into a cat, rabbit or Chiikawa. (In words, in case something is unclear: ${MOMONGA_LOOK}) ` +
  'Use the FIRST attached image (the white Chiikawa) ONLY for the canvas: the same standing pose facing the viewer, the same size and exactly the same position in the frame (feet at the same height, centred). Both short arms held slightly away from the body (not touching the body or the tail). Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.';
const EDIT_HEAD = 'Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing)';
const momongaEdits = {
  'ch-momonga-noarms': `${EDIT_HEAD} and ONLY remove both arms, so the body outline continues smoothly where the arms were. Keep the big blue tail, the ears and the face exactly as they are. Do not move or redraw anything else.`,
  'ch-momonga-eyes-closed': `${EDIT_HEAD} and ONLY change the two big eyes to closed eyes (two small gentle downward-curved lines where the eyes were).`,
  'ch-momonga-mouth-open': `${EDIT_HEAD} and ONLY change the mouth to a small open mouth, as if talking. Keep the big glossy eyes.`,
  'ch-momonga-expr-cry': `${EDIT_HEAD} except the face: change ONLY the face to Chiikawa's famous crying face — eyes squeezed shut, big wobbly mouth, big tear drops streaming down. Ears, blue nose, tail and arms stay exactly where they are.`,
  'ch-momonga-expr-joy': `${EDIT_HEAD} except the face: change ONLY the face to a very happy face — eyes closed into happy upward arcs (^ ^) and a big open smiling mouth. Ears, blue nose, tail and arms stay exactly where they are.`,
  'ch-momonga-expr-shock': `${EDIT_HEAD} except the face: change ONLY the face to a shocked face — the big eyes wide open with tiny pupils, a small round open mouth, pale cheeks, and three short vertical shock lines just above the head. Ears, tail and arms stay exactly where they are.`,
};
const SKIP = new Set(['ch-kurimanju-eyes-closed']); // its base already has closed content eyes

function fromReq(id, overrides = {}) {
  const r = reqItems.get(id);
  if (!r) throw new Error('no request ' + id);
  return { id, label: r.label, kind: r.kind ?? (id.startsWith('mc-') ? 'mc' : null), aspect: r.aspect, refs: r.refs ?? [], prompt: r.prompt, ...overrides };
}

const chars = [];
chars.push({ id: 'ch-momonga-base', label: '모몽가 기본 (다시 · 원작 참고 그림이 기준)', kind: 'base', aspect: '3:4', refs: ['ch-chiikawa-base', '모몽가 참고 그림(사용자 PC)'], prompt: momongaBase, redo: true });
for (const id of ['ch-momonga-noarms', 'ch-momonga-eyes-closed', 'ch-momonga-mouth-open', 'ch-momonga-expr-joy', 'ch-momonga-expr-cry', 'ch-momonga-expr-shock'])
  chars.push(fromReq(id, { prompt: momongaEdits[id], redo: id !== 'ch-momonga-mouth-open' && !id.includes('expr') }));
chars.push(fromReq('ch-momonga-sheet-jump'));
for (const c of ['kurimanju', 'rakko', 'shisa', 'pochette']) {
  for (const part of ['base', 'noarms', 'eyes-closed', 'mouth-open', 'expr-joy', 'expr-cry', 'expr-shock', 'sheet-jump']) {
    const id = `ch-${c}-${part}`;
    if (SKIP.has(id) || done(id) || !reqItems.has(id)) continue;
    const it = fromReq(id);
    if (id === 'ch-pochette-base') it.refs = ['ch-chiikawa-base', '(있으면) 포셰트 참고 그림'];
    chars.push(it);
  }
}
const npcPet = [...reqItems.keys()].filter((id) => /^(npc|pet)-/.test(id) && !done(id)).map((id) => fromReq(id));

// ---------- 2. MC ----------
const mcItems = mc.batches.flatMap((b) => b.items).map((it) => fromReq(it.id, { kind: 'mc' }));

// ---------- 3. backgrounds ----------
const bgs = [];
for (const it of full.batches.flatMap((b) => b.items).filter((x) => x.id.startsWith('bg-'))) if (!done(it.id)) bgs.push(fromReq(it.id));
for (const it of world.batches.flatMap((b) => b.items).filter((x) => x.id.startsWith('bg-'))) bgs.push(fromReq(it.id));
const NEW_BG = {
  'bg-island': ['배경 · 한방역전섬 (노년)', 'a small tropical gamble island under a bright sky: palm trees, a giant colourful roulette wheel standing on the sandy beach, a little wooden pier with a tiny boat, a sparkling sea, paper lanterns and a few confetti pieces in the air.'],
  'bg-farm': ['배경 · 빈곤 농장 (쪽박)', 'a humble but cozy little farm: a small wooden shack, a muddy potato field with a few sprouts, a funny scarecrow, a rusty watering can and a grey drizzly sky — slightly sad but funny.'],
  'bg-auction': ['배경 · 골동품 경매장 (노년)', 'a warm small antique auction hall: a wooden podium with a gavel, red velvet curtains, a few rows of little chairs, display stands with old vases, clocks and framed paintings, soft spotlights.'],
};
for (const [id, [label, desc]] of Object.entries(NEW_BG)) bgs.push({ id, label, kind: 'bg', aspect: '16:9', refs: ['bg-park'], prompt: bg(desc) });

// ---------- 4. props ----------
const worldProps = new Set(world.batches.flatMap((b) => b.items).filter((x) => x.id.startsWith('prop-')).map((x) => x.id));
const propItems = [];
const SLOT_KO = { head: '머리', face: '얼굴', neck: '목', hand: '손', back: '등' };
for (const p of props.props) {
  const id = `prop-${p.id.replace(/_/g, '-')}`;
  if (accepted(id)) continue;
  if (worldProps.has(id)) propItems.push(fromReq(id, { kind: 'prop', label: `소품 · ${SLOT_KO[p.slot]} · ${p.name}`, choice: !!p.choice }));
  else propItems.push({ id, label: `소품 · ${SLOT_KO[p.slot]} · ${p.name}`, kind: 'prop', aspect: '1:1', refs: [], prompt: prop(p), choice: !!p.choice });
}
propItems.sort((a, b) => Number(b.choice) - Number(a.choice));

// ---------- 5. 🐹 icons (cards / items / treasures / jobs) ----------
const CK_CARDS = {
  study: ['📖 밤샘 공부', 'an open storybook next to a small glowing desk lamp and a sleepy crescent moon (late-night studying)'],
  insider: ['🎤 노래 연습', 'a small pink karaoke microphone with a few floating music notes'],
  energy: ['🍮 푸딩 파워', 'a wobbly custard pudding with a glossy caramel top and a small yellow lightning sparkle beside it'],
  taxi: ['🐰 우사기 점프 (야하!)', 'a cream-yellow chibi rabbit-like creature with two long ears doing a huge happy jump, arms up, speed lines below its feet'],
  pledge: ['📣 후원 모금', 'a little red megaphone next to a glass donation jar full of coins'],
  insurance: ['🛡️ 갑옷씨 보증서', 'a rolled parchment certificate tied with a ribbon and stamped with a small silver shield seal'],
  amulet: ['🧿 수호 부적', 'a round blue evil-eye charm (blue and white rings) hanging on a red cord'],
  lotto: ['🎟️ 쿠지 응모권', 'a small paper prize-draw ticket with a dotted tear-off line and a round red stamp'],
  coupon: ['🏷️ 갑옷씨 상점 할인권', 'a price-tag shaped discount coupon with a string and a tiny knight-helmet stamp'],
  lawyer: ['🔱 사스마타 방어', 'a sasumata (a wooden pole with a U-shaped metal fork) crossed in front of a small round shield'],
  cut_line: ['🕳️ 함정 파기', 'a small round pit dug in the grass with a little shovel stuck in the dirt pile beside it'],
  noise: ['📢 「우라!」 고함', 'a big jagged yellow shout bubble bursting with sound-wave lines (no letters inside)'],
  tax_audit: ['😈 나쁜 녀석 습격', 'a sneaky little purple shadow creature with a mask running away with a coin bag'],
  complaint: ['🧹 일거리 뺏기', 'a broom and a small work glove being snatched away by a grabbing hand, with a whoosh motion trail'],
};
const CK_ITEMS = {
  car: ['🛴 씽씽 킥보드', 'a small mint-green kick scooter with a little bell'],
  laptop: ['📚 고서점 책 꾸러미', 'a stack of three old books tied together with a string'],
  gym_pass: ['🔱 사스마타', 'a sasumata: a long wooden pole with a U-shaped metal fork at the top, standing upright'],
  designer_bag: ['👜 포셰트', 'a small cute lavender pochette shoulder bag with a round flap and a thin strap'],
  lucky_cat: ['🍀 네잎클로버', 'a bright green four-leaf clover with a tiny sparkle'],
  massage_chair: ['♨️ 목욕탕 평생 회수권', 'a small ticket booklet with a hot-spring steam symbol, next to a wooden bath bucket'],
};
const CK_TREASURES = {
  celadon: ['🏺 고대 항아리', 'an ancient clay jar with simple wave patterns, slightly chipped'],
  white_porcelain: ['🫖 갑옷씨의 은잔', 'a shiny little silver goblet with a tiny engraved shield'],
  idol_goods: ['✨ 레어 스티커', 'a sparkly sheet of rare character stickers with stars and hearts'],
  dino_fossil: ['🐉 키메라 화석', 'a big fossil skull of a horned monster with small fangs'],
  gold_toad: ['🌰 황금 밤', 'a shiny golden chestnut glowing softly'],
  stamp: ['🍀 네잎클로버 책갈피', 'a paper bookmark with a pressed four-leaf clover and a ribbon tassel'],
  lp_record: ['🎸 낡은 기타 줄', 'a coiled old guitar string with a small guitar pick'],
  sneakers: ['👟 랏코의 운동화', 'a pair of well-worn brown sneakers'],
  calligraphy: ['📕 고서점 희귀본', 'a rare old hardcover book with a worn red cover and gold corners'],
  ginseng: ['🍄 거대 버섯', 'a giant red-capped mushroom with white spots'],
  retro_console: ['🪀 옛날 장난감', 'an old wooden spinning top and a yo-yo'],
  first_edition: ['📖 초판 그림책', 'a picture book with a bright cover showing a sun over green hills'],
  black_pearl: ['🦪 진주 조개', 'an open seashell with a glowing pearl inside'],
  signed_ball: ['🍮 푸딩 왕관', 'a tiny golden crown sitting on top of a custard pudding'],
  amber: ['🫧 바다 유리', 'a few smooth round pieces of pale aqua and green sea glass'],
  gold_crown: ['🔱 전설의 사스마타', 'a legendary golden sasumata glowing with little sparkles'],
};
const CK_JOBS = {
  weeder: ['🌿 풀뽑기 일꾼', 'a small woven basket of pulled weeds with a little hand trowel'],
  hunter: ['⚔️ 토벌대', 'a sasumata crossed with a small round shield'],
  ramen: ['🍜 라멘 가게 「郎」', 'a steaming ramen bowl piled high with bean sprouts and pork slices'],
  workshop: ['🛠️ 갑옷씨 공방', 'a small hammer and an anvil with a rounded knight helmet'],
  bookstore: ['📚 고서점 직원', 'a stack of old books with a round magnifying glass'],
  busker: ['🎸 길거리 가수', 'an acoustic guitar with floating music notes'],
  pancake: ['🥞 팬케이크 가게', 'a fluffy stack of pancakes with butter and dripping syrup'],
  photographer: ['📷 사진사', 'a vintage camera with a little flash sparkle'],
  sento: ['♨️ 목욕탕지기', 'a wooden bath bucket with a folded towel and rising steam'],
  delivery: ['📦 배달부', 'a taped cardboard delivery box with a little speed trail'],
  fisher: ['🎣 섬 낚시꾼', 'a fishing rod with a big fish on the line'],
  cafe: ['☕ 카페 점원', 'a coffee cup with heart latte art and a small cake'],
  legend_hunter: ['🗡️ 전설의 토벌자', 'a glowing golden sasumata with a star above it'],
  weed_sage: ['🌾 풀뽑기 1급 명인', 'a golden ear of grass with a first-prize medal ribbon'],
  ramen_owner: ['🍜 「郎」 2호점 사장', 'a ramen bowl wearing a small golden crown'],
  armor_san: ['🛡️ 갑옷씨', 'a shiny knight helmet and chest armor with a golden emblem'],
};
const ck = [];
const slug = (s) => s.replace(/_/g, '-');
for (const [id, [name, d]] of Object.entries(CK_CARDS)) ck.push({ id: `card-${slug(id)}-chiikawa`, label: `🐹 카드 · ${name}`, kind: 'card', aspect: '1:1', refs: [], prompt: icon('A single game card illustration', d), world: 'chiikawa' });
for (const [id, [name, d]] of Object.entries(CK_ITEMS)) ck.push({ id: `item-${slug(id)}-chiikawa`, label: `🐹 아이템 · ${name}`, kind: 'item', aspect: '1:1', refs: [], prompt: icon('A single game item icon', d), world: 'chiikawa' });
for (const id of ['item-armor', 'item-guitar', 'treasure-kuji-plush']) ck.push(fromReq(id, { label: `🐹 ${reqItems.get(id).label}` }));
for (const [id, [name, d]] of Object.entries(CK_TREASURES)) ck.push({ id: `treasure-${slug(id)}-chiikawa`, label: `🐹 보물 · ${name}`, kind: 'treasure', aspect: '1:1', refs: [], prompt: icon('A single treasure item icon', d) + ' Add one tiny sparkle.', world: 'chiikawa' });
for (const [id, [name, d]] of Object.entries(CK_JOBS)) ck.push({ id: `icon-job-${slug(id)}`, label: `🐹 직업 아이콘 · ${name}`, kind: 'icon', aspect: '1:1', refs: [], prompt: icon('A single round job badge icon showing a symbolic object (no character)', d) });
const monsters = world.batches.flatMap((b) => b.items).filter((x) => x.id.startsWith('monster-')).map((x) => fromReq(x.id, { label: `🐹 ${x.label}` }));

// ---------- 6. shared cards (one picture for both worlds) + tile icons ----------
const sharedCards = [];
const cardsData = readJson(path.join(ROOT, 'server/data/cards.json')).cards;
const NEW_CARD_DESC = {
  marriage_luck: 'two small pink hearts linked together with a sparkle',
  popular: 'a big bright yellow star with little hearts popping around it',
  research: 'a microscope next to an open notebook',
  charisma: 'a shining stage microphone with a little crown',
  tongue: 'a tasting spoon over a small steaming pot, with a sparkle',
  iron_body: 'a strong flexed arm with a small band-aid and sparkles',
  health_charm: 'a round blue-and-white protective charm on a red tassel',
  salary_charm: 'a small red lucky pouch charm with a gold coin',
  merit: 'a gold medal with a red ribbon',
  big_roll: 'a big up arrow over a stack of number dice showing high numbers (dots only)',
  small_roll: 'a small down arrow over a single die (dots only)',
  exact_roll: 'a round archery target with an arrow exactly in the centre',
  payday_rush: 'a pay envelope flying fast with wind speed lines',
  injury: 'a white bandage roll and a plaster crossed, with a tiny sweat drop',
  bonus: 'a pink envelope with a heart seal and a few coins peeking out',
  gossip: 'two little whisper speech bubbles with a finger-on-lips sign',
};
for (const c of cardsData) {
  const id = `card-${slug(c.id)}`;
  if (accepted(id)) continue;
  const d = NEW_CARD_DESC[c.id] ?? oldDesc(id);
  if (!d) throw new Error('no desc ' + id);
  const variant = CK_CARDS[c.id];
  sharedCards.push({ id, label: `${variant ? '🏙️' : '🃏'} 카드 · ${c.icon} ${c.name}${variant ? ' (현실 모드용)' : ''}`, kind: 'card', aspect: '1:1', refs: [], prompt: icon('A single game card illustration', d), realOnly: !!variant });
}
const TILE_NEW = {
  start: ['🚩 출발', 'a little red flag on a short pole stuck in the grass'],
  event: ['❗ 이벤트', 'a small surprise gift box popping open with a burst of sparkles'],
  salary: ['💵 월급날', 'a paper pay envelope with a few gold coins and green bills peeking out'],
  pass: ['🎪 찬스 광장', 'a cheerful striped circus tent with a small flag on top'],
  hometown: ['🏡 고향', 'a small countryside house with a persimmon tree beside it'],
  temple: ['🛕 산사', 'a small mountain temple bell hanging under a little wooden roof'],
  jeju: ['🌴 제주', 'a palm tree next to a small round stone statue with a big nose (dol hareubang)'],
  reversal: ['🎰 인생역전', 'a colourful casino roulette wheel with a little ball'],
  island: ['🏝️ 한방역전섬', 'a tiny islet with one palm tree and a small colourful roulette disc on the sand'],
  contest: ['🏆 노년 대회', 'a gold medal and a small trophy with confetti'],
  auction: ['🔨 경매', 'a wooden auction gavel on its round sound block'],
  hunt: ['⚔️ 토벌', 'a sasumata next to a small purple monster horn'],
  weed: ['🌿 풀뽑기', 'a tuft of green weeds with a tiny woven basket'],
  merge: ['🔀 합류', 'three little paths joining into one, with a small signpost (no letters)'],
};
const tiles = [];
for (const [t, [name, d]] of Object.entries(TILE_NEW)) tiles.push({ id: `icon-${t}`, label: `칸 아이콘 · ${name}`, kind: 'icon', aspect: '1:1', refs: [], prompt: icon('A single board-game tile icon', d) });

// ---------- 7. real-world only (🏙️ 현실 모드) ----------
const real = [];
const itemsData = readJson(path.join(ROOT, 'server/data/items.json')).items;
for (const it of itemsData) real.push({ id: `item-${slug(it.id)}`, label: `🏙️ 아이템 · ${it.icon} ${it.name}`, kind: 'item', aspect: '1:1', refs: [], prompt: icon('A single game item icon', oldDesc(`item-${slug(it.id)}`)) });
const treasData = readJson(path.join(ROOT, 'server/data/treasures.json')).treasures;
for (const t of treasData) {
  const id = `treasure-${slug(t.id)}`;
  const shared = !CK_TREASURES[t.id];
  real.push({ id, label: `${shared ? '💎 보물 (두 세계 공용)' : '🏙️ 보물'} · ${t.icon} ${t.name}`, kind: 'treasure', aspect: '1:1', refs: [], prompt: icon('A single treasure item icon', oldDesc(id)) + ' Add one tiny sparkle.', sharedTreasure: shared });
}
const jobsData = readJson(path.join(ROOT, 'server/data/jobs.json')).jobs;
for (const j of jobsData) {
  const id = `icon-job-${slug(j.id)}`;
  const shared = ['landlord', 'mountain_spirit'].includes(j.id);
  real.push({ id, label: `${shared ? '💼 직업 아이콘 (두 세계 공용)' : '🏙️ 직업 아이콘'} · ${j.icon} ${j.name}`, kind: 'icon', aspect: '1:1', refs: [], prompt: icon('A single round job badge icon showing a symbolic object (no character)', oldDesc(id)) });
}

// ---------- 8. optional restyle (old glossy art still in the game) ----------
const restyle = [];
for (const id of ['icon-money', 'icon-love', 'icon-job', 'icon-house', 'icon-treasure', 'icon-card', 'icon-shop', 'icon-stop', 'icon-bad', 'icon-goal', 'icon-school', 'icon-lottery'])
  restyle.push({ id, label: `${M.get(id).label ?? id} (치이카와 풍으로 다시)`, kind: 'icon', aspect: '1:1', refs: [], prompt: icon('A single board-game tile icon', oldDesc(id)), restyle: true });
restyle.push({ id: 'bg-wedding-hall', label: '배경 · 파티장 (예전 웨딩홀 자리)', kind: 'bg', aspect: '16:9', refs: ['bg-park'], prompt: bg('a bright cute party hall: a small stage with a flower arch, pastel balloons, ribbon garlands, a long table with a cake, a soft pink carpet.'), restyle: true });
for (const id of ['frame-love', 'frame-career', 'frame-treasure', 'frame-good', 'frame-bad', 'frame-holiday', 'frame-result'])
  restyle.push({
    id,
    label: `컷인 테두리 무늬 · ${{ love: '단짝', career: '직업', treasure: '보물·돈', good: '좋은 일', bad: '나쁜 일', holiday: '명절', result: '결과 발표' }[id.slice(6)]}`,
    kind: 'frame',
    aspect: '1:1',
    refs: [],
    prompt: `${STYLE} A cute flat seamless repeating pattern tile (the left/right and top/bottom edges must continue into each other), ${frameDesc(id)}, small simple motifs evenly scattered on a soft solid pastel background, low contrast so text on top stays readable. Square 1:1, pattern only, no text, no border.`,
    restyle: true,
  });

// ---------- groups → batches ----------
const GROUPS = [
  { key: 'A', title: '캐릭터 (모몽가 다시 + 남은 표정·팔·점프)', stars: '★★★', items: chars, note: '모몽가는 처음부터 다시 그립니다 (참조 2장). 쿠리만쥬·랏코·시사는 이번에 받은 기본 그림을 참조로 씁니다. 쿠리만쥬는 원래 눈을 감고 있어서 「눈 감음」은 필요 없어요.' },
  { key: 'B', title: '친구(NPC)·반려동물 기본 그림', stars: '★★★', items: npcPet, note: '모두 `ch-chiikawa-base` 참조 (위치·크기 기준).' },
  { key: 'C', title: '배경 (치이카와 그림체로)', stars: '★★★', items: bgs, note: '참조는 전부 `bg-park` (= 테스트 때 만든 `bg-ch-park-2.png`). 예전 애니풍 배경 16장도 이 그림으로 바뀝니다.' },
  { key: 'D', title: 'MC 호야·봄이 (치이카와 그림체로)', stars: '★★☆', items: mcItems, note: '첫 두 장이 기준 그림입니다. 호야·봄이 실제 사진(사용자 PC) + `ch-chiikawa-base`를 같이 첨부하세요. 나머지는 그 두 장을 참조로 쓰는 편집이에요.' },
  { key: 'E', title: '소품 (캐릭터가 쓰는 모자·안경·손에 드는 것·등에 메는 것)', stars: '★★☆', items: propItems, note: '흰 배경, 물건만 따로. 앞쪽 30개가 로비에서 고르는 소품이고, 나머지는 시대·직업 소품이에요.' },
  { key: 'F', title: '🐹 치이카와 모드 카드·아이템·보물·직업·키메라', stars: '★★☆', items: [...ck, ...monsters], note: '흰 배경 아이콘. `-chiikawa`로 끝나는 id는 치이카와 모드에서만 쓰는 그림이에요 (같은 카드의 현실 모드 그림은 G묶음).' },
  { key: 'G', title: '공용 카드 + 새 칸 아이콘', stars: '★★☆', items: [...sharedCards.filter((c) => !c.realOnly), ...tiles], note: '두 세계가 같이 쓰는 카드 그림과, 아직 그림이 없는 보드 칸 아이콘.' },
  { key: 'H', title: '🏙️ 현실 모드 그림 (카드·아이템·보물·직업)', stars: '★☆☆', items: [...sharedCards.filter((c) => c.realOnly), ...real], note: '현실 모드에서 보이는 그림이에요. 보물 중 「두 세계 공용」과 직업 중 건물주·산신령은 치이카와 모드에서도 써요.' },
  { key: 'I', title: '(선택) 예전 그림체 정리 — 칸 아이콘·테두리 무늬·파티장', stars: '☆☆☆', items: restyle, note: '지금 게임에 들어 있는 반짝이는 게임풍 그림을 치이카와 풍으로 바꾸는 것. 안 해도 게임은 돌아가요.' },
];

let n = 0;
const batches = [];
for (const g of GROUPS) {
  g.batches = [];
  for (let i = 0; i < g.items.length; i += 10) {
    const b = { n: ++n, group: g.key, items: g.items.slice(i, i + 10) };
    g.batches.push(b);
    batches.push(b);
  }
}
const total = GROUPS.reduce((s, g) => s + g.items.length, 0);

// sanity: every id must be a manifest id (or a variant the other agent adds) unless it is a request alias
const unknown = [];
for (const g of GROUPS) for (const it of g.items) if (!M.has(manifestId(it.id)) && !M.has(it.id)) unknown.push(it.id);

const out = {
  batch: 'remaining-all',
  created: '2026-10-29',
  note: '남은 그림 전부. ids = 저장 파일 이름 (<id>.png). refs = 앞에서 만든 그림(또는 테스트 그림)을 참조로 첨부.',
  supersedes: ['chiikawa-full', 'chiikawa-mc', 'chiikawa-world'],
  style: STYLE,
  refFiles: { 'ch-chiikawa-base': 'ch-chiikawa-base.png (테스트, 1번)', 'bg-park': 'bg-ch-park-2.png (테스트, 2번)', '모몽가 참고 그림(사용자 PC)': '사용자가 가진 원작 모몽가 그림 1장' },
  total,
  groups: GROUPS.map((g) => ({ key: g.key, title: g.title, priority: g.stars, note: g.note, count: g.items.length, batches: g.batches.map((b) => b.n) })),
  batches: batches.map((b) => ({ n: b.n, group: b.group, items: b.items.map(({ id, label, kind, aspect, refs, prompt }) => ({ id, label, kind, aspect, refs, prompt })) })),
};
console.log(`총 ${total}장 · ${batches.length}묶음 · ${GROUPS.map((g) => `${g.key} ${g.items.length}`).join(' · ')}`);
if (unknown.length) console.log(`⚠️ manifest에 없는 id ${unknown.length}개: ${unknown.join(' ')}`);
const md = guideMarkdown(out, GROUPS);
if (DRY) process.exit(0);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'remaining-all.json'), JSON.stringify(out, null, 2) + '\n');
fs.writeFileSync(path.join(OUT, 'remaining-all.md'), md);
console.log(`→ ${path.relative(ROOT, path.join(OUT, 'remaining-all.md'))} · .json`);

// ---------- markdown (Korean, for the user) ----------
function guideMarkdown(j, groups) {
  const L = [];
  const p = (s = '') => L.push(s);
  const refText = (refs) =>
    refs.length ? refs.map((r) => (/^[a-z]/.test(r) ? `\`${r}\`` : r)).join(' + ') : '없음';

  p('# 남은 그림 전체 가이드 (로컬 Gemini 스킬용) — 2026-10-29');
  p();
  p(`게임에 아직 없는 그림이 **이 문서 하나에 전부** 있어요. 모두 **${j.total}장**, 10장씩 **${j.batches.length}묶음**이에요.`);
  p('이전 요청 문서 3개(`chiikawa-full`, `chiikawa-mc`, `chiikawa-world`)에서 아직 안 만든 것도 다 여기로 옮겼으니, **이제 이 문서만 보면 됩니다.**');
  p('프롬프트 전문은 `remaining-all.json`에도 똑같이 들어 있어요(로컬 Claude가 읽기 편한 형식).');
  p();
  p('## 10-29에 받은 그림 — 게임에 넣었어요');
  p();
  p('- 우사기: 기본·팔 없음·눈 감음·입 벌림·기쁨·울음·놀람·점프 시트 (전부 OK)');
  p('- 하치와레: **`ch-hachiware-base-reframed`를 새 기본 그림으로** 썼어요(표정 그림들이 이걸 보고 그려졌어요) + 팔 없음·눈 감음·입 벌림·기쁨·울음·놀람·점프 시트');
  p('- 치이카와: 기쁨·놀람 / 쿠리만쥬·랏코·시사: 기본 그림');
  p('- **모몽가는 넣지 않았어요** — 원작과 달라서(작은 점 눈, 작은 귀, 흰 꼬리, 회색 비막) 처음부터 다시 그립니다. 아래 「모몽가 다시 그리기」를 꼭 봐 주세요.');
  p();
  p('이미 있는 치이카와 그림체 그림(다시 만들지 않음): 치이카와 전부, 하치와레 전부, 우사기 전부, 쿠리만쥬·랏코·시사 기본, 펭귄, 공원 배경, 요리사 모자.');
  p();
  p('## 모몽가 다시 그리기 (중요 · 맨 먼저)');
  p();
  p('받은 모몽가(점 눈·작은 귀·흰 꼬리·비막)도, 게임 안의 임시 그림도 원작과 달랐어요. 그래서 이번에는 글 설명이 아니라 **사용자가 가진 원작 모몽가 그림을 그대로 따라 그리게** 프롬프트를 바꿨어요.');
  p();
  p('- **참조 2장**: ① `ch-chiikawa-base.png` — 자세·크기·위치만 맞추는 용도 ② **원작 모몽가 그림 1장 — 생김새는 전부 이 그림대로**. 이 그림은 저장소에 올리지 않아요.');
  p('- 결과가 그래도 원작과 다르면, **② 원작 그림 하나만 첨부**하고 같은 프롬프트로 다시 뽑아도 돼요(위치·크기는 가져올 때 자동으로 맞춰요).');
  p('- **사용자 눈에 「모몽가다!」 싶을 때까지** 다시 뽑아 주세요. 나머지 모몽가 그림(팔 없음·눈 감음·입 벌림·표정·점프)은 전부 이 기본 그림을 고치는 편집이라, 기본 그림이 제일 중요해요.');
  p('- 이 그림이 오면 게임의 2D 그림(로비·컷인·결과)은 전부 그 그림으로 바뀌고, 3D 말도 그 그림에 맞춰 다시 만들어요.');
  p('- 포셰트도 원작 그림이 있으면 같은 방식으로 두 번째 참조로 붙여 주세요.');
  p();
  p('## 로컬 Claude에게 시킬 일');
  p();
  p('1. 묶음 1부터 순서대로 만듭니다. 프롬프트는 **영문 그대로 복사**해서 씁니다. 각 항목 **1장씩**.');
  p('2. **참조**가 적힌 항목은 그 파일을 첨부해 「편집/참조」로 요청합니다.');
  p('   - `ch-chiikawa-base` → 테스트 때 만든 `ch-chiikawa-base.png`');
  p('   - `bg-park` → 테스트 때 만든 `bg-ch-park-2.png`');
  p('   - `ch-kurimanju-base`, `ch-rakko-base`, `ch-shisa-base` → 10-29에 보내 준 그 파일');
  p('   - 그 밖의 id → 이번에 앞에서 만든 `<id>.png` (예: 모몽가 편집 → 새로 그린 `ch-momonga-base.png`)');
  p('   - MC 기준 두 장 → 호야·봄이 실제 사진 1~2장 + `ch-chiikawa-base.png`');
  p('3. 비율: 캐릭터·NPC·반려동물 **3:4**, 점프 시트 **1:1**, 배경 **16:9**, MC **1:1**(`mc-duo`만 16:9), 소품·아이콘·카드·보물·무늬 **1:1**.');
  p('4. 배경색: 캐릭터·MC·점프 시트는 **마젠타(#FF00FF)**, 소품·카드·아이템·보물·아이콘·키메라는 **흰색(#FFFFFF)**. 흰 물건(날개, 축구공, 마스크…)은 **테두리 선이 끊기지 않게** — 선이 열려 있으면 흰 배경과 같이 지워져요.');
  p('5. 파일 이름은 **id 그대로** `<id>.png` (원본은 `<id>_original.jpg`, 다시 뽑은 두 번째 장은 `<id>-2.png`). 한 폴더에 모아 **묶음 몇 개씩 zip**으로 채팅에 보내 주세요.');
  p('6. 편집 그림(팔 없음·눈·입·표정)은 바뀐 곳만 잘라 겹쳐 쓰므로 **팔·몸·꼬리는 절대 움직이지 않게**. 이상하면 1번까지 다시 뽑고, 그래도 이상하면 그대로 보내고 보고서에 적어 주세요.');
  p('7. 마지막에 짧은 `REPORT.md`(거절·실패·다시 뽑은 항목)를 같이 주세요.');
  p('8. 순서가 바뀌어도 괜찮지만, **기본 그림이 그 편집 그림보다 먼저** 와야 해요(같은 zip이면 OK).');
  p();
  p('## 한눈에 보기');
  p();
  p('| 묶음 | 내용 | 장수 | 중요도 |');
  p('|---|---|---:|:---:|');
  for (const g of j.groups) {
    const b = g.batches;
    p(`| ${b.length > 1 ? `${b[0]}–${b[b.length - 1]}` : b[0]} | **${g.key}.** ${g.title} | ${g.count} | ${g.priority} |`);
  }
  p(`| | **합계** | **${j.total}** | |`);
  p();
  p('★★★ = 게임에서 제일 자주 보이는 그림. ☆☆☆ = 선택(안 해도 게임은 돌아가요). 묶음 순서 = 추천 순서예요.');
  p();
  p('## 공통 그림체 문장 (모든 프롬프트 앞에 이미 들어 있음)');
  p();
  p('```text');
  p(j.style);
  p('```');
  p();
  p('모몽가 기본 그림만 이 문장에서 「tiny black dot eyes…」 부분을 뺐어요(큰 눈이 특징이라서).');
  p();

  for (const g of groups) {
    const gj = j.groups.find((x) => x.key === g.key);
    p(`## ${g.key}. ${g.title} — ${gj.count}장 ${gj.priority}`);
    p();
    p(g.note);
    p();
    for (const bn of gj.batches) {
      const b = j.batches.find((x) => x.n === bn);
      p(`### 묶음 ${bn} (${b.items.length}장)`);
      p();
      p('| id (파일 이름) | 내용 | 비율 | 참조 |');
      p('|---|---|:---:|---|');
      for (const it of b.items) p(`| \`${it.id}\` | ${it.label} | ${it.aspect} | ${refText(it.refs)} |`);
      p();
      p('<details><summary>프롬프트 보기</summary>');
      p();
      for (const it of b.items) {
        p(`**\`${it.id}\`**`);
        p();
        p('```text');
        p(it.prompt);
        p('```');
        p();
      }
      p('</details>');
      p();
    }
  }

  p('## 받은 뒤에 (이쪽에서 할 일)');
  p();
  p('zip을 받으면 `node scripts/import-assets.js --dir <폴더> --dry-run`으로 이름·짝을 확인하고 바로 가져와요. 캐릭터는 자동으로 위치를 맞추고, 팔·눈·입·표정 조각을 잘라 애니메이션에 씁니다. 결과는 게임 화면 캡처로 보여 드릴게요.');
  return L.join('\n') + '\n';
}
