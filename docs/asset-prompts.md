# 에셋 수동 생성 가이드 (Gemini 앱/웹)

API 생성 대신 **Gemini 앱(gemini.google.com)** 에서 직접 그림을 만들어 올리는 방법입니다.
올려 주신 파일은 서버가 배경 제거·크기 맞춤을 해서 게임에 바로 반영합니다.

## 공통 순서

1. Gemini에서 **이미지 만들기**(Nano Banana)를 고릅니다.
2. 항목마다 적힌 **참조 이미지**를 첨부합니다.
   - `style-anchor.png` = 화풍 기준 그림입니다. 채팅으로 보내 드린 파일을 쓰세요.
   - 강아지 사진은 가지고 계신 원본(호야 2장, 봄이 2장, 둘이 같이 1장)을 쓰세요.
3. 아래 **프롬프트(영문)** 를 그대로 붙여넣고 생성합니다. 마음에 들 때까지 다시 생성하면 됩니다.
4. 결과를 다운로드해서 파일 이름을 **에셋 id** 로 바꿉니다(예: `mc-hoya-neutral.png`).
5. GitHub 저장소 `ls9702/claude03` → 브랜치 `claude/admiring-gates-1qlocc` → `assets-inbox/` 폴더 →
   **Add file → Upload files** 로 올리고 Commit 합니다. 여러 장을 한 번에 올려도 됩니다.
6. 올렸다고 채팅으로 알려 주시면 제가 받아서 처리하고, 게임 화면 스크린샷으로 확인해 드립니다.

## 좋은 결과를 고르는 기준

- **배경색**
  - 캐릭터·강아지: 단색 **마젠타(진분홍, #FF00FF)**
  - 카드·아이템·배지: **흰색**
  - 배경 그림: 장면 전체
  - 그림자, 바닥, 테두리가 생기면 다시 생성하세요.
- **글자**: 글자·숫자·간판 문구가 들어가면 다시 생성하세요. 게임이 글자를 따로 얹습니다.
- **여백**: 캐릭터·강아지는 몸 전체가 잘리지 않고 가장자리에 여백이 있어야 합니다.
- **비율**: 가로 16:9, 정사각형 1:1 같은 비율은 대략만 맞으면 됩니다. 서버가 맞춰 자릅니다.
- **워터마크**: 오른쪽 아래의 작은 반짝이 워터마크는 서버가 지웁니다.

## 만드는 순서 (추천)

| 순서 | 묶음 | 장수 | 첨부 |
|---|---|---|---|
| 1 | 방송국 스튜디오 배경 | 1 | style-anchor |
| 2 | 호야·봄이 기본 → 둘이 같이 | 3 | style-anchor + 강아지 사진 |
| 3 | 호야·봄이 표정·포즈 | 18 | style-anchor + 내가 만든 기본 그림 + 사진 1장 |
| 4 | 직업·이벤트 배경 | 9 | style-anchor |
| 5 | 상점·명절 배경 | 2 | style-anchor |
| 6 | 카드 | 16 | style-anchor |
| 7 | 아이템 | 6 | style-anchor |
| 8 | 직업 배지(나중에) | 23 | style-anchor |

1~3번(MC)은 게임에 이미 연결돼 있어서, 올리는 즉시 컷인에 나옵니다.

---

## 1. 방송국 스튜디오 배경

### `bg-studio` — 인생 방송국 스튜디오 (호야·봄이가 진행하는 무대)
첨부: `style-anchor.png`
```
Art style: modern Korean anime-inspired game illustration, clean cel shading, soft gradients, bright saturated but harmonious colors, thick-and-thin clean line art, chibi proportions (head about 1/3 of body height), friendly and cheerful, high quality 2D game asset, consistent lighting from upper left, no text, no watermark, no signature. Use exactly the same art style, line weight and color palette as the reference image. Scene only, NO people, no characters, no animals in the foreground. Scene: a bright, cheerful Korean TV variety show studio seen from the audience: a curved glossy stage with a low host desk in the center, warm spotlights and colorful stage lights hanging from a truss, big blank screens and a large blank sign board above the stage, star-shaped decorations, pastel orange and purple colors. Wide 16:9 background illustration for a game cut-in, leave open empty space in the lower center for two small mascot hosts to stand. No text, no letters.
```

---

## 2. 호야·봄이 기본 그림

### `mc-hoya-neutral` — 호야 기본 표정
첨부: `style-anchor.png` + 호야 사진 2장
```
Art style: modern Korean anime-inspired game illustration, clean cel shading, soft gradients, bright saturated but harmonious colors, thick-and-thin clean line art, chibi proportions (head about 1/3 of body height), friendly and cheerful, high quality 2D game asset, consistent lighting from upper left, no text, no watermark, no signature. Use exactly the same art style, line weight and color palette as the first reference image. Flat solid pure magenta background color #FF00FF filling the whole canvas, no gradient, no shadow on the ground, no floor, no other objects. HOYA, a young Shih Tzu dog as a cute chibi TV-show mascot. Coat: almost entirely white and very fluffy, with a slightly creamy beige tint on top of the head; floppy ears that are dark brown-black with a warm tan patch where they join the head; light tan / caramel fur around both eyes; big round shiny dark eyes; small black button nose; short white beard; slight underbite with the pink tip of the tongue peeking out; goofy, cheerful, slightly derpy face. Wears a small orange bandana scarf around the neck. Huge round fluffy head, small round body, short legs, white fluffy plume tail. Draw it as a stylized 2D game illustration (not a photo): sitting upright facing the viewer, full body visible, centered with generous margin on every side, feet near the lower part of the canvas. The photo references show the real dog: match its fur pattern, markings and colors exactly. Default face: open happy eyes, mouth slightly open with the tongue tip out, relaxed sitting pose. Square 1:1.
```

### `mc-bomi-neutral` — 봄이 기본 표정
첨부: `style-anchor.png` + 봄이 사진 2장
```
Art style: modern Korean anime-inspired game illustration, clean cel shading, soft gradients, bright saturated but harmonious colors, thick-and-thin clean line art, chibi proportions (head about 1/3 of body height), friendly and cheerful, high quality 2D game asset, consistent lighting from upper left, no text, no watermark, no signature. Use exactly the same art style, line weight and color palette as the first reference image. Flat solid pure magenta background color #FF00FF filling the whole canvas, no gradient, no shadow on the ground, no floor, no other objects. BOMI, an adult Shih Tzu dog as a cute chibi TV-show mascot with a black-and-white coat: the sides of the head, both long floppy ears and a large mask around BOTH eyes are black; a clear white blaze stripe runs from between the eyes up the middle of the forehead to the top of the head; white muzzle with a slightly grey-beige beard and chin; white chest and white front legs; black back and shoulders; small black speckles on the white front paws; big round dark eyes; black nose; calm, serious, slightly grumpy "unimpressed" face. Wears a small purple bow tie. Huge round head, small round body, short legs, fluffy tail. Draw it as a stylized 2D game illustration (not a photo): sitting upright facing the viewer, full body visible, centered with generous margin on every side, feet near the lower part of the canvas. The photo references show the real dog: match its fur pattern, markings and colors exactly. Default face: calm half-lidded unimpressed eyes, mouth closed, relaxed dignified sitting pose. Square 1:1.
```

### `mc-duo` — 호야와 봄이 같이 (가로 3:2)
첨부: `style-anchor.png` + 내가 만든 `mc-hoya-neutral` + `mc-bomi-neutral` + 둘이 같이 찍은 사진
```
Art style: modern Korean anime-inspired game illustration, clean cel shading, soft gradients, bright saturated but harmonious colors, thick-and-thin clean line art, chibi proportions (head about 1/3 of body height), friendly and cheerful, high quality 2D game asset, consistent lighting from upper left, no text, no watermark, no signature. Use exactly the same art style, line weight and color palette as the reference images. Flat solid pure magenta background color #FF00FF filling the whole canvas, no gradient, no shadow on the ground, no floor, no other objects. Two chibi Shih Tzu TV-show host mascots sitting side by side, facing the viewer, full bodies visible with margin. On the LEFT: HOYA, the mostly white fluffy Shih Tzu with dark brown-black floppy ears, tan fur around the eyes, tongue tip out and a small orange bandana. On the RIGHT: BOMI, the black-and-white Shih Tzu with black ears and a black eye mask, a white blaze stripe up the forehead, a white muzzle and a small purple bow tie. Hoya waves happily with one paw, Bomi holds a small handheld microphone and looks calm. Keep both dogs exactly like their MC reference images; the photo reference shows the real pair together. Wide 3:2.
```

---

## 3. 호야·봄이 표정·포즈 (18장)

**첨부**: `style-anchor.png` + 해당 강아지의 기본 그림(내가 만든 `mc-hoya-neutral` 또는 `mc-bomi-neutral`) + 그 강아지 사진 1장

**만드는 법**
1. 아래 **공통 앞부분**을 붙여넣습니다.
2. 그 뒤에 표 오른쪽 칸의 **한 줄**을 이어 붙입니다.
3. 파일 이름은 표의 id입니다. 호야는 `mc-hoya-…`, 봄이는 `mc-bomi-…`로 바꾸세요.

공통 앞부분(호야용). 봄이는 `HOYA` → `BOMI`로 바꾸세요.
```
Art style: modern Korean anime-inspired game illustration, clean cel shading, soft gradients, bright saturated but harmonious colors, thick-and-thin clean line art, chibi proportions (head about 1/3 of body height), friendly and cheerful, high quality 2D game asset, consistent lighting from upper left, no text, no watermark, no signature. Use exactly the same art style, line weight and color palette as the reference image. Flat solid pure magenta background color #FF00FF filling the whole canvas, no gradient, no shadow on the ground, no floor, no other objects. Draw HOYA, the chibi Shih Tzu TV-show mascot from the MC reference image, as a stylized 2D game illustration (not a photo): facing the viewer, full body visible, centered with generous margin on every side, feet near the lower part of the canvas. Keep exactly the same dog design, markings, colors, accessory and proportions as the MC reference image. Square 1:1.
```

| id (호야 / 봄이) | 이어 붙일 한 줄 |
|---|---|
| `mc-hoya-joy` / `mc-bomi-joy` 기쁨 | `Overjoyed: eyes closed in happy upward arcs, wide open smiling mouth, ears lifted, tail wagging.` |
| `mc-hoya-surprise` / `mc-bomi-surprise` 놀람 | `Surprised: eyes wide open with small pupils, round O-shaped mouth, ears flipped up, a small sweat drop.` |
| `mc-hoya-sad` / `mc-bomi-sad` 슬픔 | `Sad: glossy teary eyes with one tear, droopy ears, small frown, head slightly lowered.` |
| `mc-hoya-angry` / `mc-bomi-angry` 화남 | `Cute grumpy anger: furrowed brows, puffed cheeks, a small red anger mark, looking sideways with a huff.` |
| `mc-hoya-proud` / `mc-bomi-proud` 자신만만 | `Proud and smug: eyes closed confidently, nose up, chest out, a small sparkle next to the head.` |
| `mc-hoya-sleepy` / `mc-bomi-sleepy` 졸림 | `Sleepy: droopy half-closed eyes, a big yawn, slouched, a small "Zz" bubble shape (no letters needed).` |
| `mc-hoya-pose-wave` / `mc-bomi-pose-wave` 손 흔들기 | `Pose: waving one front paw high in greeting, the other paw on the ground, friendly face.` |
| `mc-hoya-pose-clap` / `mc-bomi-pose-clap` 박수 | `Pose: sitting up on the hind legs and clapping both front paws together in front of the chest, happy face.` |
| `mc-hoya-pose-mic` / `mc-bomi-pose-mic` 마이크 | `Pose: holding a small black handheld microphone with one front paw near the mouth like a TV show host.` |

---

## 4~5. 배경 그림 (11장)

**첨부**: `style-anchor.png`

**만드는 법**
1. 아래 **공통 앞부분**을 붙여넣습니다.
2. 그 뒤에 표의 `Scene:` 문장을 이어 붙입니다.
3. 마지막에 **공통 뒷부분**을 붙입니다.

아직 이 그림들이 없는 동안에는 게임이 기존 배경 5장 중 비슷한 것으로 대신 보여 줍니다.

공통 앞부분
```
Art style: modern Korean anime-inspired game illustration, clean cel shading, soft gradients, bright saturated but harmonious colors, thick-and-thin clean line art, chibi proportions (head about 1/3 of body height), friendly and cheerful, high quality 2D game asset, consistent lighting from upper left, no text, no watermark, no signature. Use exactly the same art style, line weight and color palette as the reference image. Scene only, NO people, no characters, no animals in the foreground.
```
공통 뒷부분
```
Wide 16:9 background illustration for a game event cut-in, leave open empty space in the lower center for characters to stand. No text, no letters, no signs with writing.
```

| id | 쓰이는 곳 | Scene 문장 |
|---|---|---|
| `bg-stage` | 아이돌·배우·개그맨·트로트·국민 MC | `Scene: a dazzling K-pop concert stage seen from the front row: glossy stage floor, colorful spotlights and laser beams, LED screen panels showing abstract shapes, confetti in the air, a sea of blurred glow sticks at the very bottom edge.` |
| `bg-stadium` | 야구·축구선수 | `Scene: a sunny Korean sports stadium seen from the field: green grass with white lines, packed colorful stands with a blurred crowd, a big blank scoreboard, stadium light towers, blue sky with fluffy clouds.` |
| `bg-gym` | 격투기 선수 | `Scene: a martial arts gym: an octagon cage ring with a blue mat in the middle, punching bags hanging on the side, stacked training mats, a small wall of trophies, dramatic overhead lights.` |
| `bg-army` | 군 입대·전역 | `Scene: a Korean army boot camp parade ground on a clear day: a wide sandy field, a low beige barracks building with green roof, a flagpole with a plain green flag, mountains behind, a row of young trees.` |
| `bg-campus` | 대학 입학·졸업 | `Scene: a Korean university campus on graduation day: a grand old stone main building, cherry blossom trees, a wide plaza with a fountain, a few graduation caps flying in the blue sky.` |
| `bg-kitchen` | 셰프 | `Scene: a busy but tidy restaurant kitchen: shiny steel counters, flames under woks and pots, hanging ladles and pans, fresh vegetables on a cutting board, warm lighting.` |
| `bg-police` | 경찰관 | `Scene: a friendly neighborhood police station in Korea: blue and white interior, a front desk, a bulletin board with blank papers, a patrol car visible through the big window, potted plant.` |
| `bg-lab` | 연구원 | `Scene: a bright modern science laboratory: white benches with glass flasks and colorful liquids, a microscope, computer monitors with graphs (no numbers), big windows with daylight.` |
| `bg-space` | 우주비행사(숨은 직업) | `Scene: a rocket launch site at dawn: a tall white rocket on the launch pad with steam around its base, gantry tower, a sky turning from purple to orange with a few stars, distant sea.` |
| `bg-shop` | 상점 칸 | `Scene: a cheerful Korean neighborhood mart / convenience store interior: colorful snack shelves, a drink fridge with glowing doors, a checkout counter with a small register, hanging paper decorations.` |
| `bg-holiday` | 명절 대잔치(설·추석) | `Scene: a warm traditional Korean living room during a holiday (Seollal / Chuseok): a low wooden table full of holiday food (songpyeon rice cakes, jeon pancakes, fruits, a bowl of tteokguk), floor cushions, a folding screen with painted plum blossoms, sliding paper doors with warm light.` |

---

## 6. 카드 (16장, 정사각형, 흰 배경)

**첨부**: `style-anchor.png`

**만드는 법**
1. 아래 **공통 앞부분**을 붙여넣습니다.
2. 그 뒤에 표의 영문 문장을 이어 붙입니다.
3. 마지막에 **공통 뒷부분**을 붙입니다.

카드 틀과 이름은 게임이 따로 그리니까 **그림(아이콘)만** 만들면 됩니다.

공통 앞부분
```
Art style: modern Korean anime-inspired game illustration, clean cel shading, soft gradients, bright saturated but harmonious colors, thick-and-thin clean line art, friendly and cheerful, high quality 2D game asset, consistent lighting from upper left, no text, no watermark, no signature. Use exactly the same art style, line weight and color palette as the reference image. A single glossy game card illustration icon:
```
공통 뒷부분
```
Centered, fills about 80% of the square, thick dark outline, slight top-left highlight. Plain pure white background #FFFFFF, no shadow, no border, no frame, no other objects. No text, no letters, no numbers. Square 1:1.
```

| id | 카드 | 이어 붙일 문장 |
|---|---|---|
| `card-study` | 스터디 모임 | `an open notebook with a pencil on top of a small stack of books and a glowing idea light bulb above them.` |
| `card-insider` | 인싸력 | `a smartphone with heart and star reaction bubbles and sparkles bursting out of the screen.` |
| `card-energy` | 에너지 드링크 | `a bright can of energy drink with a big yellow lightning bolt on it, fizzing bubbles around it.` |
| `card-taxi` | 택시 | `a cute round orange Korean taxi car with a roof light, speed lines behind it.` |
| `card-pledge` | 공약 카드 | `a campaign speech podium with a microphone and a big red rosette ribbon, small confetti.` |
| `card-bonus` | 성과급 봉투 | `a white envelope overflowing with green paper money bills, tied with a golden ribbon.` |
| `card-insurance` | 실손 보험 | `a blue shield with a white plus sign, sheltered under a small red umbrella.` |
| `card-amulet` | 건강 부적 | `a traditional Korean yellow talisman paper with abstract red swirl patterns (no readable letters), tied with a red string and a small tassel.` |
| `card-lotto` | 로또 복권 | `a lottery ticket card with five colorful glossy lottery balls (plain, no numbers) bouncing out of it.` |
| `card-coupon` | 할인 쿠폰 | `a pink discount coupon ticket with a dotted cut line, small scissors and a big percent symbol.` |
| `card-lawyer` | 변호사 상담권 | `a golden balance scale next to a wooden judge's gavel.` |
| `card-cut-line` | 새치기 | `a cheeky sneaker leaping over a queue line of small orange traffic cones, with a curved jump arrow.` |
| `card-noise` | 층간소음 | `a stomping foot above a ceiling with jagged red sound waves and a shaking lamp below.` |
| `card-tax-audit` | 세무조사 | `a big magnifying glass over a pile of gold coins and a red official stamp.` |
| `card-complaint` | 갑질 민원 | `an angry red megaphone blasting jagged shout lines, with a small red anger mark.` |
| `card-gossip` | 소문내기 | `two whispering speech bubbles next to a hand cupped beside a sly smiling mouth.` |

---

## 7. 아이템 (6장, 정사각형, 흰 배경)

카드와 **같은 공통 앞부분·뒷부분**을 쓰세요. 앞부분의 `game card illustration icon` 만 `game item icon` 으로 바꾸면 됩니다.

| id | 아이템 | 이어 붙일 문장 |
|---|---|---|
| `item-car` | 경차 | `a small cute mint-green compact car, front three-quarter view.` |
| `item-laptop` | 노트북 | `an open silver laptop with a glowing screen showing abstract colorful shapes.` |
| `item-gym-pass` | 헬스 회원권 | `a membership card leaning on a blue dumbbell.` |
| `item-designer-bag` | 명품 가방 | `an elegant beige leather handbag with a gold clasp, sparkles around it.` |
| `item-lucky-cat` | 복고양이 | `a cute golden lucky cat figurine raising one paw, a small red bell collar.` |
| `item-massage-chair` | 안마의자 | `a big comfy brown massage chair with soft cushions and a small remote control.` |

---

## 8. 직업 배지 (나중에, 23장, 정사각형, 흰 배경)

지금은 이모지로 표시하고 있어서 나중에 해도 됩니다. 카드와 **같은 공통 앞부분·뒷부분**을 쓰고, `game card illustration icon` 을 `round game badge icon` 으로 바꾸세요.

| id | 직업 | 이어 붙일 문장 |
|---|---|---|
| `icon-job-civil-servant` | 공무원 | `a neat folder with an official red stamp and a name badge lanyard.` |
| `icon-job-office-worker` | 대기업 회사원 | `a black briefcase with a blue necktie draped over it.` |
| `icon-job-webtoonist` | 웹툰 작가 | `a drawing tablet with a stylus and colorful comic panel shapes.` |
| `icon-job-politician` | 국회의원 | `a gold lapel badge next to a microphone.` |
| `icon-job-baseball` | 야구선수 | `a baseball with a wooden bat and a glove.` |
| `icon-job-soccer` | 축구선수 | `a black-and-white soccer ball with a small goal net behind it.` |
| `icon-job-esports` | e스포츠 선수 | `a gaming headset resting on a glowing RGB keyboard.` |
| `icon-job-fighter` | 격투기 선수 | `a pair of red boxing gloves with a champion belt.` |
| `icon-job-actor` | 배우 | `a film clapperboard (blank) with a small golden star.` |
| `icon-job-idol` | 아이돌 | `a sparkly stage microphone with a pink glow stick and music notes.` |
| `icon-job-youtuber` | 유튜버 | `a red play-button shaped sign with a small camera and a ring light.` |
| `icon-job-chef` | 셰프 | `a white chef hat over a frying pan with a sizzling egg.` |
| `icon-job-doctor` | 의사 | `a stethoscope around a white medical cross.` |
| `icon-job-researcher` | 연구원 | `a glass flask with bubbling green liquid and a small microscope.` |
| `icon-job-police` | 경찰관 | `a police cap with a gold emblem and a whistle.` |
| `icon-job-comedian` | 개그맨 | `a funny red clown nose with a laughing mask.` |
| `icon-job-teacher` | 교사 | `a green chalkboard (blank) with an apple and a piece of chalk.` |
| `icon-job-landlord` | 건물주 | `a tall shiny building with a golden key in front of it.` |
| `icon-job-trot-star` | 트로트 스타 | `a golden microphone with a sparkly sequin bow tie.` |
| `icon-job-astronaut` | 우주비행사 | `a white astronaut helmet with a small rocket and stars.` |
| `icon-job-mountain-spirit` | 산신령 | `a wooden staff with a white cloud and a mountain peak behind it.` |
| `icon-job-chaebol` | 재벌 총수 | `a golden crown sitting on a stack of gold bars.` |
| `icon-job-national-mc` | 국민 MC | `a golden trophy shaped like a microphone with confetti.` |
