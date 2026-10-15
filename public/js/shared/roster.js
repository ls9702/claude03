// Chiikawa conversion (CH-1) — pure roster / props / NPC friends / pets helpers (no imports, no DOM, no Node).
// Shared by the 2D renderer (ui/chara.js), the lobby picker (ui/picker.js), growth.js (display looks), family.js,
// cut-ins, the result screen and node tests. `/api/meta.roster|props|npcs|pets` win; the inline fallbacks below keep
// every screen drawable before the server data exists (same ids as the data files).
//
//   look = {character: rosterId, props: {head?, face?, neck?, hand?, back?}}  — a player character
//        | {npc: speciesId, props?}                                          — a 단짝 후보 / 단짝 (NPC friend)
//        | {pet: speciesId}                                                  — a 반려동물 (the old children)
//   normalizeLook(avatar, meta)  → a valid look (old human avatars → a roster character picked from a hash)
//   effectiveLook(character, {room, jobs, props}) → growth props (era / job) per slot over the chosen props
//   lookKey(look) → stable string (caches); randomLook(meta, rnd) → a roster look with 0–2 props

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' && v ? v : null);

/** Character canvas (raster art + SVG rig share it): 1024×1536, feet on y 1303, centred on x 512. */
export const CANVAS = Object.freeze({ w: 1024, h: 1536, feetY: 1303, cx: 512 });
export const PROP_SLOTS = Object.freeze(['head', 'face', 'neck', 'hand', 'back']);
export const SLOT_NAMES = Object.freeze({ head: '머리', face: '얼굴', neck: '목', hand: '손', back: '등' });
export const SLOT_ICONS = Object.freeze({ head: '🎀', face: '👓', neck: '🎗️', hand: '🎈', back: '🎒' });
export const EAR_TYPES = Object.freeze(['nub', 'cat', 'rabbit', 'squirrel', 'bun', 'otter', 'lion', 'pouch']);

const ch = (id, name, icon, colors, ears, size, desc, anchors) => ({ id, name, icon, colors, ears, size, desc, anchors });
const A = (head, face, neck, hand, back, hx = 330) => ({ head: [512, head], face: [512, face], neck: [512, neck], handL: [hx, hand], handR: [1024 - hx, hand], back: [512, back] });

/** Contract fallback of roster.json (ids fixed; `pochette` is a slot the user may swap — everything is data-driven). */
export const DEFAULT_ROSTER = Object.freeze([
  ch('chiikawa', '치이카와', '🤍', { body: '#ffffff', line: '#5b4a44', blush: '#ffb4c2', accent: '#ff9db5' }, 'nub', 1, '작고 동글동글한 하얀 아이. 잘 울지만 누구보다 열심히 해요.', A(420, 640, 880, 1010, 1000)),
  ch('hachiware', '하치와레', '🐱', { body: '#ffffff', line: '#4a4e5a', blush: '#ffb4c2', accent: '#5f7fa8', extra: '#2f3e57' }, 'cat', 1, '머리에 파란 하치와레 무늬가 있는 고양이 같은 친구. 언제나 밝아요.', A(410, 640, 880, 1010, 1000)),
  ch('usagi', '우사기', '🐰', { body: '#fff3c4', line: '#5e5038', blush: '#ffb08a', accent: '#ffcf5a' }, 'rabbit', 1.1, '기다란 귀의 노란 토끼. 엉뚱하고 에너지가 넘쳐요. 우라!', A(450, 660, 890, 1015, 1005, 326)),
  ch('momonga', '모몽가', '🐿️', { body: '#ffffff', line: '#55505a', blush: '#ffb4c2', accent: '#c9d4ea', extra: '#9aa9c8' }, 'squirrel', 0.85, '커다란 눈망울의 하늘다람쥐. 관심 받는 걸 제일 좋아해요.', A(540, 720, 930, 1040, 1040, 360)),
  ch('kurimanju', '쿠리만쥬', '🌰', { body: '#d9a46c', line: '#5a3b22', blush: '#f19a7a', accent: '#8a5a32' }, 'bun', 0.95, '밤만쥬처럼 동그란 갈색 친구. 맛있는 걸 먹고 "하아…" 하고 감탄해요.', A(460, 660, 890, 1015, 1005, 336)),
  ch('rakko', '랏코', '🦦', { body: '#eadbc4', line: '#5a4a3a', blush: '#f2b3a2', accent: '#a88a66' }, 'otter', 1.2, '키가 크고 듬직한 해달 선배. 토벌 실력이 최고예요.', A(330, 580, 850, 995, 985, 318)),
  ch('shisa', '시사', '🦁', { body: '#f5cf73', line: '#6a4a22', blush: '#ffa98a', accent: '#e2873a' }, 'lion', 1, '갈기가 복슬복슬한 시사. 성실하게 일하는 라멘집 수습생이에요.', A(400, 640, 885, 1010, 1000)),
  ch('pochette', '포셰트', '👛', { body: '#f1e4fb', line: '#5a4a66', blush: '#ffb4d2', accent: '#b98ad8' }, 'pouch', 0.9, '작은 파우치를 늘 메고 다니는 연보라색 친구. 반짝이는 걸 모아요.', A(490, 690, 910, 1025, 1020, 346)),
]);
export const ROSTER_IDS = Object.freeze(DEFAULT_ROSTER.map((c) => c.id));
export const DEFAULT_CHARACTER = 'chiikawa';

const p = (id, slot, name, icon, extra = {}) => ({ id, slot, name, icon, ...extra });
/** Contract fallback of props.json `props` (same ids / slots / colours as the data; `choice: false` = growth / job only). */
export const DEFAULT_PROPS = Object.freeze([
  p('ribbon', 'head', '리본', '🎀', { choice: true, color: '#ff7eb6', tintable: true }),
  p('flower_pin', 'head', '꽃핀', '🌸', { choice: true, color: '#ff9ec7' }),
  p('beanie', 'head', '비니', '🧶', { choice: true, color: '#7aa7e0', tintable: true }),
  p('straw_hat', 'head', '밀짚모자', '👒', { choice: true, color: '#e8c872' }),
  p('crown', 'head', '왕관', '👑', { choice: true, color: '#f5c542' }),
  p('headband', 'head', '하트 머리띠', '💗', { choice: true, color: '#ff5a7a', tintable: true }),
  p('beret', 'head', '베레모', '🎨', { choice: true, color: '#c0504d', tintable: true }),
  p('party_hat', 'head', '고깔모자', '🥳', { choice: true, color: '#8ad0f0' }),
  p('flower_crown', 'head', '화관', '💐', { choice: true, color: '#ffb3d1' }),
  p('round_glasses', 'face', '동그란 안경', '👓', { choice: true, color: '#5b4a44' }),
  p('sunglasses', 'face', '선글라스', '🕶️', { choice: true, color: '#2a2a2a' }),
  p('star_glasses', 'face', '별 안경', '🤩', { choice: true, color: '#ffd43b' }),
  p('mask', 'face', '마스크', '😷', { choice: true, color: '#f4f6f8' }),
  p('heart_sticker', 'face', '하트 볼스티커', '💕', { choice: true, color: '#ff8fb1' }),
  p('bow_tie', 'neck', '나비넥타이', '🦋', { choice: true, color: '#e2453c', tintable: true }),
  p('scarf', 'neck', '목도리', '🧣', { choice: true, color: '#e86a5a', tintable: true }),
  p('bell_collar', 'neck', '방울 목걸이', '🔔', { choice: true, color: '#f5c542' }),
  p('bandana', 'neck', '반다나', '🧡', { choice: true, color: '#e8743b', tintable: true }),
  p('necklace', 'neck', '진주 목걸이', '📿', { choice: true, color: '#f3efe6' }),
  p('balloon', 'hand', '풍선', '🎈', { choice: true, color: '#ff6b8a', tintable: true }),
  p('flower', 'hand', '꽃 한 송이', '🌷', { choice: true, color: '#ff7aa8' }),
  p('lollipop', 'hand', '막대사탕', '🍭', { choice: true, color: '#ff9ad5' }),
  p('wand', 'hand', '요술봉', '🪄', { choice: true, color: '#ffd43b' }),
  p('fishing_rod', 'hand', '낚싯대', '🎣', { choice: true, color: '#b08a5a' }),
  p('book', 'hand', '책', '📖', { choice: true, color: '#5a8ad8' }),
  p('umbrella', 'hand', '우산', '☂️', { choice: true, color: '#7ec8e3', tintable: true }),
  p('backpack', 'back', '작은 배낭', '🎒', { choice: true, color: '#f2a65a', tintable: true }),
  p('cape', 'back', '망토', '🧥', { choice: true, color: '#d94a6a', tintable: true }),
  p('wings', 'back', '천사 날개', '🪽', { choice: true, color: '#ffffff' }),
  p('teddy_bag', 'back', '곰인형 가방', '🧸', { choice: true, color: '#b07a4e' }),
  p('bonnet', 'head', '아기 보닛', '👶', { choice: false, color: '#fbe3ee' }),
  p('pacifier', 'face', '쪽쪽이', '🍼', { choice: false, color: '#8ad0f0' }),
  p('yellow_hat', 'head', '노란 학교 모자', '🟡', { choice: false, color: '#ffd23f' }),
  p('school_backpack', 'back', '책가방', '🎒', { choice: false, color: '#c0392b' }),
  p('school_cap', 'head', '교모', '🎓', { choice: false, color: '#2c3e66' }),
  p('knit_cap', 'head', '털모자', '🧶', { choice: false, color: '#c0504d' }),
  p('cane', 'hand', '지팡이', '🦯', { choice: false, color: '#8a5a32' }),
  p('necktie', 'neck', '넥타이', '👔', { choice: false, color: '#3b5ba5' }),
  p('id_card', 'neck', '사원증', '🪪', { choice: false, color: '#4a90d9' }),
  p('pen', 'hand', '펜', '🖊️', { choice: false, color: '#333333' }),
  p('sash', 'neck', '어깨띠', '🎗️', { choice: false, color: '#ffffff' }),
  p('baseball_cap', 'head', '야구모자', '🧢', { choice: false, color: '#2f5fb3' }),
  p('bat', 'hand', '야구방망이', '🏏', { choice: false, color: '#c8945a' }),
  p('soccer_ball', 'hand', '축구공', '⚽', { choice: false, color: '#ffffff' }),
  p('headset', 'head', '게이밍 헤드셋', '🎧', { choice: false, color: '#333a44' }),
  p('fighter_headband', 'head', '필승 머리띠', '🥋', { choice: false, color: '#ffffff' }),
  p('script', 'hand', '대본', '📜', { choice: false, color: '#f3e7c9' }),
  p('mic', 'hand', '마이크', '🎤', { choice: false, color: '#ff7eb6' }),
  p('camera', 'hand', '카메라', '📹', { choice: false, color: '#3a3a3a' }),
  p('chef_hat', 'head', '셰프 모자', '🍳', { choice: false, color: '#ffffff' }),
  p('head_mirror', 'head', '이마 반사경', '🔦', { choice: false, color: '#cfd8dc' }),
  p('stethoscope', 'neck', '청진기', '🩺', { choice: false, color: '#4a5a6a' }),
  p('flask', 'hand', '플라스크', '🧪', { choice: false, color: '#7ed957' }),
  p('police_cap', 'head', '경찰 모자', '🚓', { choice: false, color: '#1f3a6b' }),
  p('key_ring', 'hand', '열쇠 꾸러미', '🔑', { choice: false, color: '#d4a017' }),
  p('sparkle_mic', 'hand', '반짝이 마이크', '🎙️', { choice: false, color: '#f5c542' }),
  p('space_helmet', 'head', '우주 헬멧', '🪐', { choice: false, color: '#dfe9f3' }),
  p('beard', 'face', '산신령 수염', '☁️', { choice: false, color: '#ffffff' }),
  p('golden_mic', 'hand', '황금 마이크', '🏆', { choice: false, color: '#d4a017' }),
  p('apron', 'neck', '앞치마', '🧾', { choice: false, color: '#6aa84f' }),
]);

/** Contract fallback of props.json `eraProps` (`job: true` = the job props in that era). */
export const DEFAULT_ERA_PROPS = Object.freeze({
  baby: { head: 'bonnet', face: 'pacifier' },
  elem: { head: 'yellow_hat', back: 'school_backpack' },
  middle: { head: 'school_cap', neck: 'necktie' },
  high: { head: 'school_cap', neck: 'necktie' },
  young: { job: true },
  middle_age: { job: true },
  senior: { head: 'knit_cap', hand: 'cane' },
});

/** Contract fallback of the job props (jobs.json `props` / props.json `jobProps` win). */
export const DEFAULT_JOB_PROPS = Object.freeze({
  doctor: { head: 'head_mirror', neck: 'stethoscope' },
  chef: { head: 'chef_hat' },
  police: { head: 'police_cap' },
  idol: { hand: 'mic' },
  baseball: { head: 'baseball_cap', hand: 'bat' },
  soccer: { hand: 'soccer_ball' },
  fighter: { head: 'fighter_headband' },
  office_worker: { neck: 'necktie' },
  politician: { neck: 'sash' },
  teacher: { face: 'round_glasses', hand: 'book' },
  youtuber: { hand: 'camera' },
  esports: { head: 'headset' },
  webtoonist: { head: 'beret', hand: 'pen' },
  researcher: { face: 'round_glasses', hand: 'flask' },
  comedian: { head: 'party_hat' },
  actor: { head: 'beret', hand: 'script' },
  civil_servant: { neck: 'id_card' },
  landlord: { hand: 'key_ring' },
  trot_star: { hand: 'sparkle_mic' },
  astronaut: { head: 'space_helmet' },
  mountain_spirit: { face: 'beard' },
  chaebol: { head: 'crown' },
  national_mc: { hand: 'golden_mic' },
  parttime: { neck: 'apron' },
});

const sp = (id, name, icon, colors, ears, extra = {}) => ({ id, name, icon, colors, ears, ...extra });
/** Contract fallback of npcs.json (original Chiikawa-style NPC friends = 단짝 후보; not manga characters). */
export const DEFAULT_NPCS = Object.freeze([
  sp('penguin', '펭귄', '🐧', { body: '#3d4a5c', line: '#1f2733', blush: '#ffb4c2', accent: '#ffffff', extra: '#ffb347' }, 'none'),
  sp('hamster', '햄스터', '🐹', { body: '#f6d3a0', line: '#6a4a2a', blush: '#ffb4c2', accent: '#ffffff' }, 'nub'),
  sp('duckling', '오리', '🐥', { body: '#ffe36a', line: '#6a5a1a', blush: '#ffb08a', accent: '#ff9f3a' }, 'tuft'),
  sp('panda', '판다', '🐼', { body: '#ffffff', line: '#2a2a2a', blush: '#ffb4c2', accent: '#2f2f33' }, 'round'),
  sp('squirrel', '다람쥐', '🌰', { body: '#d98c4a', line: '#5a3518', blush: '#ffb08a', accent: '#fff1dd', extra: '#7a4a22' }, 'squirrel'),
  sp('lamb', '아기양', '🐑', { body: '#fffaf0', line: '#6a5e50', blush: '#ffb4c2', accent: '#d8c8b4' }, 'lamb'),
  sp('frog', '개구리', '🐸', { body: '#8fd46a', line: '#2f5a22', blush: '#ffb08a', accent: '#e8f8c8' }, 'frog'),
  sp('bear_cub', '아기곰', '🧸', { body: '#b07a4e', line: '#4a2e18', blush: '#ffa98a', accent: '#e8c8a0' }, 'round'),
  sp('fox', '여우', '🦊', { body: '#f08a3a', line: '#5a2e12', blush: '#ffb4c2', accent: '#ffffff' }, 'fox'),
  sp('owl', '부엉이', '🦉', { body: '#a88a6a', line: '#4a3a2a', blush: '#ffb4c2', accent: '#f2e2c8', extra: '#ffcf3a' }, 'tuft'),
]);
export const DEFAULT_NPC_NAMES = Object.freeze(['콩이', '몽이', '보리', '두부', '쿠키', '모찌', '라떼', '구름', '솜이', '호두', '땅콩', '망고', '우유', '꿀떡', '찹쌀', '단비', '별이', '토리', '뭉치', '깨비', '초코', '젤리', '마루', '하루', '푸딩', '루루', '밤톨', '슈슈']);

/** Contract fallback of pets.json (반려동물 = the old children; no roster species duplicated; `size` = base scale before the stage scale). */
export const DEFAULT_PETS = Object.freeze([
  sp('goldfish', '금붕어', '🐠', { body: '#ff8a3a', line: '#7a3410', blush: '#ffb4c2', accent: '#ffd0a0' }, null, { size: 0.8 }),
  sp('chick', '병아리', '🐤', { body: '#fff07a', line: '#6a5a1a', blush: '#ffb08a', accent: '#ff9f3a' }, null, { size: 0.75 }),
  sp('turtle', '거북이', '🐢', { body: '#9fd27a', line: '#2f5a22', blush: '#ffb4c2', accent: '#6a8a3a' }, null, { size: 0.85 }),
  sp('hedgehog', '고슴도치', '🦔', { body: '#f2dcc0', line: '#5a4030', blush: '#ffb4c2', accent: '#8a6a4a' }, null, { size: 0.8 }),
  sp('parrot', '앵무새', '🦜', { body: '#5ccf6a', line: '#1f5a2a', blush: '#ffb08a', accent: '#ffcf3a', extra: '#ff5a4a' }, null, { size: 0.85 }),
  sp('guinea_pig', '기니피그', '🐁', { body: '#e8b47a', line: '#5a3a1a', blush: '#ffb4c2', accent: '#ffffff' }, null, { size: 0.85 }),
  sp('puppy', '강아지', '🐶', { body: '#f5e6d0', line: '#5a4430', blush: '#ffb4c2', accent: '#c8945a' }, null, { size: 0.9 }),
  sp('snail', '달팽이', '🐌', { body: '#f5d8b0', line: '#5a4430', blush: '#ffb4c2', accent: '#e08a6a' }, null, { size: 0.75 }),
]);
export const DEFAULT_PET_NAMES = Object.freeze(['방울', '꼬물', '포도', '사과', '자두', '감자', '고구마', '까미', '뽀삐', '도리', '몽실', '꼬꼬', '삐약', '느릿', '통통', '말랑', '보들', '동글', '찰떡', '꿀비', '새싹', '콩떡', '바둑', '치즈', '누룽지', '만두', '꼬마콩', '알콩']);
/** pets.json `stages` fallback: name + cut-in scale of each growth stage. */
export const DEFAULT_PET_STAGES = Object.freeze({baby: {name: '새끼', scale: 0.5}, kid: {name: '꼬마', scale: 0.64}, teen: {name: '청소년', scale: 0.78}, adult: {name: '어른', scale: 0.9}});

// ---------- meta access ----------

const listFrom = (v, ...keys) => {
  if (Array.isArray(v)) return v;
  if (!isObj(v)) return null;
  for (const k of keys) if (Array.isArray(v[k])) return v[k];
  return null;
};

/** roster entries (`/api/meta.roster`, else the fallback). */
export function rosterList(meta) {
  const list = listFrom(meta?.roster, 'characters');
  const ok = list?.filter((c) => isObj(c) && str(c.id));
  return ok?.length ? ok : DEFAULT_ROSTER;
}

export function rosterDefault(meta) {
  const d = str(meta?.roster?.default);
  const list = rosterList(meta);
  return list.some((c) => c.id === d) ? d : list.some((c) => c.id === DEFAULT_CHARACTER) ? DEFAULT_CHARACTER : list[0].id;
}

const colorsOf = (c, fb) => ({ body: '#ffffff', line: '#5b4a44', blush: '#ffb4c2', accent: '#ff9db5', ...(fb?.colors ?? {}), ...(isObj(c?.colors) ? c.colors : {}) });

/** A roster entry with every field filled ({id, name, icon, colors, ears, size, desc, anchors|null, known}). */
export function rosterInfo(id, meta) {
  const list = rosterList(meta);
  const def = list.find((c) => c.id === id);
  const fb = DEFAULT_ROSTER.find((c) => c.id === id) ?? null;
  const c = def ?? fb ?? list.find((x) => x.id === rosterDefault(meta)) ?? DEFAULT_ROSTER[0];
  const size = Number(c.size);
  return {
    id: c.id,
    name: str(c.name) ?? fb?.name ?? c.id,
    icon: str(c.icon) ?? fb?.icon ?? '🤍',
    colors: colorsOf(c, fb),
    ears: EAR_TYPES.includes(c.ears) ? c.ears : fb?.ears ?? 'nub',
    size: Number.isFinite(size) && size > 0 ? Math.max(0.7, Math.min(1.35, size)) : fb?.size ?? 1,
    desc: str(c.desc) ?? fb?.desc ?? '',
    traits: Array.isArray(c.traits) ? c.traits.filter((t) => typeof t === 'string') : [],
    anchors: isObj(c.anchors) ? c.anchors : fb?.anchors ?? null,
    known: !!(def || fb),
  };
}

/** Slot list [{id, name, icon}] (props.json `slots` names win). */
export function propSlots(meta) {
  const list = listFrom(meta?.props, 'slots') ?? [];
  return PROP_SLOTS.map((id) => {
    const s = list.find((x) => isObj(x) && x.id === id);
    return { id, name: str(s?.name) ?? SLOT_NAMES[id], icon: str(s?.icon) ?? SLOT_ICONS[id] };
  });
}

function allProps(meta) {
  const list = listFrom(meta?.props, 'props');
  const ok = list?.filter((x) => isObj(x) && str(x.id) && PROP_SLOTS.includes(x.slot));
  return ok?.length ? ok : DEFAULT_PROPS;
}

/** A prop the player may choose (props.json `choice: true`; growth / job props are `choice: false`). */
export const isChoiceProp = (x) => (x?.choice === undefined ? !x?.growth && !x?.hidden : x.choice === true);

/** Player-choosable props (growth / job props excluded), optionally of one slot. */
export function propList(meta, slot = null) {
  return allProps(meta).filter((x) => isChoiceProp(x) && (!slot || x.slot === slot));
}

/**
 * Prop definition (any prop incl. growth ones) → {id, slot, name, icon, color, tintable, choice, growth, known} | null.
 * `tintable` props are drawn in the character's `colors.accent`, others in their own `color`.
 */
export function propInfo(id, meta) {
  if (!str(id)) return null;
  const def = allProps(meta).find((x) => x.id === id) ?? DEFAULT_PROPS.find((x) => x.id === id) ?? null;
  if (!def) return null;
  const fb = DEFAULT_PROPS.find((x) => x.id === id);
  const color = str(def.color) ?? fb?.color ?? null;
  return { id, slot: def.slot, name: str(def.name) ?? id, icon: str(def.icon) ?? SLOT_ICONS[def.slot], color, tintable: !!def.tintable, choice: isChoiceProp(def), growth: !isChoiceProp(def), known: true };
}

function speciesList(v, fallback) {
  const list = listFrom(v, 'species', 'npcs', 'pets', 'list');
  const ok = list?.filter((x) => isObj(x) && str(x.id));
  return ok?.length ? ok : fallback;
}
export const npcList = (meta) => speciesList(meta?.npcs, DEFAULT_NPCS);
export const petList = (meta) => speciesList(meta?.pets, DEFAULT_PETS);

function speciesInfo(id, list, fallback, kind) {
  const def = list.find((x) => x.id === id);
  const fb = fallback.find((x) => x.id === id) ?? null;
  const c = def ?? fb ?? null;
  if (!c) return { id: id ?? null, name: String(id ?? ''), icon: kind === 'pet' ? '🐾' : '💞', colors: colorsOf(null, fallback[0]), ears: 'nub', size: 1, known: false, kind };
  const size = Number(c.size);
  return {
    id: c.id,
    name: str(c.name) ?? fb?.name ?? c.id,
    icon: str(c.icon) ?? fb?.icon ?? (kind === 'pet' ? '🐾' : '💞'),
    colors: colorsOf(c, fb),
    ears: str(c.ears) ?? str(c.shape) ?? fb?.ears ?? 'nub',
    size: Number.isFinite(size) && size > 0 ? Math.max(0.6, Math.min(1.3, size)) : 1,
    known: true,
    kind,
  };
}
export const npcInfo = (id, meta) => speciesInfo(id, npcList(meta), DEFAULT_NPCS, 'npc');
export const petInfo = (id, meta) => speciesInfo(id, petList(meta), DEFAULT_PETS, 'pet');

/** Name pools (npcs.json / pets.json `names`, else the fallback). */
/** Pet growth stages {baby|kid|teen|adult: {name, scale}} (pets.json `stages`, else the fallback). */
export function petStages(meta) {
  const st = meta?.pets?.stages;
  return isObj(st) && Object.keys(st).length ? { ...DEFAULT_PET_STAGES, ...st } : DEFAULT_PET_STAGES;
}

export const npcNames = (meta) => (Array.isArray(meta?.npcs?.names) && meta.npcs.names.length ? meta.npcs.names : DEFAULT_NPC_NAMES);
export const petNames = (meta) => (Array.isArray(meta?.pets?.names) && meta.pets.names.length ? meta.pets.names : DEFAULT_PET_NAMES);

// ---------- looks ----------

/** 'character' | 'npc' | 'pet' | 'legacy' (an old human avatar) | null. */
export function lookKind(look) {
  if (!isObj(look)) return null;
  if (str(look.pet)) return 'pet';
  if (str(look.npc)) return 'npc';
  if (str(look.character)) return 'character';
  if (str(look.hair) || str(look.outfit) || str(look.skin) || str(look.body)) return 'legacy';
  return null;
}

/** FNV-1a 32-bit of a string (deterministic picks from old avatars / seeds). */
export function hashStr(s) {
  let h = 0x811c9dc5;
  const t = String(s ?? '');
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Stable JSON (sorted keys) — the hash input of an old avatar. */
function stableJson(v) {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

/** Old human accessory → prop of the same idea (glasses → round glasses, ribbon → ribbon, …). */
export const LEGACY_ACCESSORY_PROPS = Object.freeze({
  glasses: { face: 'round_glasses' },
  sunglasses: { face: 'sunglasses' },
  cap: { head: 'beanie' },
  ribbon: { head: 'ribbon' },
  headband: { head: 'headband' },
  hairpin: { head: 'flower_pin' },
  earrings: { neck: 'necklace' },
});

/** Props of a look, only known props in their own slot (unknown ids dropped). */
export function sanitizeProps(props, meta) {
  const out = {};
  if (!isObj(props)) return out;
  for (const slot of PROP_SLOTS) {
    const id = str(props[slot]);
    const info = id ? propInfo(id, meta) : null;
    if (info && info.slot === slot) out[slot] = id;
  }
  return out;
}

/**
 * A valid look for any avatar value: roster / npc / pet looks are sanitized (unknown ids → default / first species),
 * old human avatars map to a roster character by a hash of their JSON (+ the accessory prop when it maps).
 */
export function normalizeLook(avatar, meta = null) {
  const kind = lookKind(avatar);
  if (kind === 'pet') {
    const list = petList(meta);
    return { pet: list.some((x) => x.id === avatar.pet) || DEFAULT_PETS.some((x) => x.id === avatar.pet) ? avatar.pet : list[hashStr(avatar.pet) % list.length].id };
  }
  if (kind === 'npc') {
    const list = npcList(meta);
    const npc = list.some((x) => x.id === avatar.npc) || DEFAULT_NPCS.some((x) => x.id === avatar.npc) ? avatar.npc : list[hashStr(avatar.npc) % list.length].id;
    return { npc, props: sanitizeProps(avatar.props, meta) };
  }
  if (kind === 'character') {
    const list = rosterList(meta);
    const known = list.some((c) => c.id === avatar.character) || DEFAULT_ROSTER.some((c) => c.id === avatar.character);
    return { character: known ? avatar.character : rosterDefault(meta), props: sanitizeProps(avatar.props, meta) };
  }
  if (kind === 'legacy') {
    const list = rosterList(meta);
    const character = list[hashStr(stableJson(avatar)) % list.length].id;
    return { character, props: sanitizeProps(LEGACY_ACCESSORY_PROPS[avatar.accessory] ?? {}, meta) };
  }
  return { character: rosterDefault(meta), props: {} };
}

/** Stable cache key of a look ("c:usagi|head=ribbon|hand=balloon", "n:panda|…", "p:turtle"). */
export function lookKey(look) {
  const l = isObj(look) ? look : {};
  const props = isObj(l.props) ? PROP_SLOTS.filter((s) => str(l.props[s])).map((s) => `${s}=${l.props[s]}`) : [];
  const head = str(l.pet) ? `p:${l.pet}` : str(l.npc) ? `n:${l.npc}` : `c:${str(l.character) ?? '?'}`;
  return [head, ...props].join('|');
}

/** A random roster look with 0–2 props (lobby 🎲, tests). */
export function randomLook(meta = null, rnd = Math.random, { maxProps = 2 } = {}) {
  const list = rosterList(meta);
  const character = list[Math.floor(rnd() * list.length) % list.length].id;
  const props = {};
  const n = Math.floor(rnd() * (maxProps + 1));
  const slots = [...PROP_SLOTS];
  for (let i = 0; i < n && slots.length; i++) {
    const slot = slots.splice(Math.floor(rnd() * slots.length) % slots.length, 1)[0];
    const opts = propList(meta, slot);
    if (opts.length) props[slot] = opts[Math.floor(rnd() * opts.length) % opts.length].id;
  }
  return { character, props };
}

/** Name of a look's figure ("치이카와", "판다", "금붕어"). */
export function lookName(look, meta) {
  const kind = lookKind(look);
  if (kind === 'pet') return petInfo(look.pet, meta).name;
  if (kind === 'npc') return npcInfo(look.npc, meta).name;
  return rosterInfo(normalizeLook(look, meta).character, meta).name;
}

// ---------- growth props (era / job) ----------

/** props.json `eraProps` when it has entries, else the contract default. */
export function eraPropsTable(meta) {
  const t = meta?.props?.eraProps ?? meta?.eraProps;
  return isObj(t) && Object.keys(t).length ? t : DEFAULT_ERA_PROPS;
}

/** Era id of a character (`character.era`, else its board position, else the room's shared era). */
export function lookEra(character, room) {
  if (str(character?.era)) return character.era;
  const eras = room?.board?.eras;
  if (!Array.isArray(eras) || !eras.length) return null;
  const idx = Number.isInteger(character?.position?.eraIndex) ? character.position.eraIndex : Number.isInteger(room?.eraIndex) ? room.eraIndex : 0;
  return eras[Math.min(Math.max(0, idx), eras.length - 1)]?.id ?? null;
}

function jobDef(jobId, jobs) {
  if (!jobId) return null;
  const list = Array.isArray(jobs) ? jobs : Array.isArray(jobs?.jobs) ? jobs.jobs : [];
  const def = list.find((j) => j?.id === jobId);
  if (def) return def;
  return isObj(jobs?.partTime) && (jobs.partTime.id === jobId || jobId === 'parttime') ? jobs.partTime : null;
}

/** Job props {slot: propId}: jobs.json job `props` > props.json `jobProps` > contract default. */
export function jobProps(jobId, { jobs = null, props = null } = {}) {
  if (!jobId) return {};
  const def = jobDef(jobId, jobs);
  if (isObj(def?.props)) return def.props;
  const t = props?.jobProps;
  if (isObj(t) && isObj(t[jobId])) return t[jobId];
  return DEFAULT_JOB_PROPS[jobId] ?? {};
}

/**
 * Growth props of a character in its era: era props of the era; `job: true` eras → the job's props (no job → none).
 * @returns {{[slot]: propId}}
 */
export function growthProps(character, { room = null, jobs = null, props = null, job } = {}) {
  const era = lookEra(character, room);
  const entry = era ? eraPropsTable(props)[era] : null;
  if (!isObj(entry)) return {};
  const out = {};
  for (const slot of PROP_SLOTS) if (str(entry[slot])) out[slot] = entry[slot];
  if (entry.job) {
    const j = job !== undefined ? job : character?.job;
    const id = typeof j === 'string' ? j : j?.id;
    Object.assign(out, jobProps(id, { jobs, props }));
  }
  return out;
}

/**
 * The look a character is drawn with in game: its chosen look + growth props (era / job), each overriding only the
 * chosen prop of the SAME slot. Only in playing / finished rooms with `config.growthOutfits !== false`; the lobby and the
 * picker show the chosen look. Returns the same object when nothing changes.
 * @param {object} character  {avatar, era?, position?, job?}
 * @param {{room?, jobs?, props?: object (props.json), job?: object|null, meta?}} ctx
 */
export function effectiveLook(character, { room = null, jobs = null, props = null, job, meta = null } = {}) {
  const avatar = isObj(character?.avatar) ? character.avatar : null;
  const pmeta = props ?? meta?.props ?? null;
  const base = lookKind(avatar) === 'character' ? avatar : normalizeLook(avatar, meta ?? (pmeta ? { props: pmeta } : null));
  if (!room || (room.status !== 'playing' && room.status !== 'finished') || room.config?.growthOutfits === false) return base;
  const grow = growthProps(character, { room, jobs: jobs ?? meta?.jobs ?? null, props: pmeta, job });
  const known = {};
  for (const [slot, id] of Object.entries(grow)) {
    const info = propInfo(id, pmeta ? { props: pmeta } : null);
    if (info && info.slot === slot) known[slot] = id;
  }
  const cur = isObj(base.props) ? base.props : {};
  if (Object.entries(known).every(([slot, id]) => cur[slot] === id)) return base;
  return { ...base, props: { ...cur, ...known } };
}
