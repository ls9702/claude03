# 호야·봄이 치이카와 그림체 요청 (로컬 Gemini 스킬용)

MC 강아지 호야(오빠, 남자아이)·봄이(동생, 여자아이)를 치이카와 그림체로 다시 그립니다. **25장**, 3묶음입니다. 본편(`chiikawa-full.md`)과 따로 돌려도 되고, 사이사이에 끼워도 됩니다.

## 로컬 Claude에게 시킬 일

1. 묶음 1의 **첫 두 장(`mc-hoya-neutral`, `mc-bomi-neutral`)이 기준 그림**입니다. 여기에는 참조를 여러 장 첨부합니다.
   - **그 강아지 실제 사진 1~2장**(사용자 PC에 있는 호야·봄이 사진)
   - 테스트 때 만든 `ch-chiikawa-base.png`(그림체 기준)
   - 여러 장 첨부가 안 되면 `ch-chiikawa-base.png`만 첨부하고, 그 사실을 보고서에 적습니다. 프롬프트에 무늬 설명이 다 들어 있습니다.
2. 이 두 장이 마음에 들 때까지 다시 뽑아도 됩니다. 나머지는 전부 이 두 장을 참조로 쓰는 편집이라, 기준 그림이 제일 중요합니다.
   - 호야: 거의 흰색, 귀만 진한 갈색, 눈가 연한 갈색, 혀 끝이 살짝 나옴, 주황 반다나
   - 봄이: 검정·흰색, 이마 가운데 흰 줄, 눈 주변 검정, 보라 나비넥타이
3. 비율: 1:1 (마지막 `mc-duo`만 16:9). 마젠타 배경입니다.
4. 결과는 `<id>.png` 이름으로 저장하고 zip으로 채팅에 보내 주세요. 짧은 `REPORT.md`(다시 뽑은 항목, 문제)도 같이 주세요.

## 그림체 문장 (프롬프트에 이미 들어 있음)

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border.
```

## 묶음 1 (10장)

### `mc-hoya-neutral` — 호야 기본

- 비율 1:1 · 참조: hoya 사진 1~2장, `ch-chiikawa-base`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. Redraw this real dog as a character of the Chiikawa world: the same round chubby chibi body shape, simple shapes, line style and dot eyes as the attached Chiikawa image, but keep the dog's own fur markings, colours and accessory exactly as described. HOYA, a boy Shih Tzu dog, the older brother, as a cute chibi TV-show mascot. Coat: almost entirely white and very fluffy, with a slightly creamy beige tint on top of the head; floppy ears that are dark brown-black with a warm tan patch where they join the head; light tan / caramel fur around both eyes; big round shiny dark eyes; small black button nose; short white beard; slight underbite with the pink tip of the tongue peeking out; goofy, cheerful, slightly derpy face. Wears a small orange bandana scarf around the neck. Huge round fluffy head, small round body, short legs, white fluffy plume tail. Default face: open happy eyes, mouth slightly open with the tongue tip out, relaxed sitting pose. Square 1:1. ONE character, full body, sitting upright facing the viewer, centred with generous margin on every side, bottom of the body at about 85 % of the height. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

### `mc-bomi-neutral` — 봄이 기본

- 비율 1:1 · 참조: bomi 사진 1~2장, `ch-chiikawa-base`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. Redraw this real dog as a character of the Chiikawa world: the same round chubby chibi body shape, simple shapes, line style and dot eyes as the attached Chiikawa image, but keep the dog's own fur markings, colours and accessory exactly as described. BOMI, a girl Shih Tzu dog, the younger sister, as a cute chibi TV-show mascot with a black-and-white coat: the sides of the head, both long floppy ears and a large mask around BOTH eyes are black; a clear white blaze stripe runs from between the eyes up the middle of the forehead to the top of the head; white muzzle with a slightly grey-beige beard and chin; white chest and white front legs; black back and shoulders; small black speckles on the white front paws; big round dark eyes; black nose; calm, serious, slightly grumpy "unimpressed" face. Wears a small purple bow tie. Huge round head, small round body, short legs, fluffy tail. Default face: calm half-lidded unimpressed eyes, mouth closed, relaxed dignified sitting pose. Square 1:1. ONE character, full body, sitting upright facing the viewer, centred with generous margin on every side, bottom of the body at about 85 % of the height. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

### `mc-hoya-eyes-closed` — 호야 눈 감음(깜빡임)

- 비율 1:1 · 참조: `mc-hoya-neutral`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same dog, same markings, same position, same size, same colours, same accessory, same magenta background, same framing) and ONLY change the eyes to closed eyes (two small gentle downward-curved lines).
```

### `mc-hoya-mouth-open` — 호야 입 벌림(말하기)

- 비율 1:1 · 참조: `mc-hoya-neutral`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same dog, same markings, same position, same size, same colours, same accessory, same magenta background, same framing) and ONLY change the mouth to an open mouth, as if talking.
```

### `mc-hoya-joy` — 호야 기쁨

- 비율 1:1 · 참조: `mc-hoya-neutral`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same dog, same markings, same position, same size, same colours, same accessory, same magenta background, same framing) except for this change: Overjoyed: eyes closed in happy upward arcs, wide open smiling mouth, ears lifted, tail wagging. Keep the Chiikawa-style chibi look.
```

### `mc-hoya-surprise` — 호야 놀람

- 비율 1:1 · 참조: `mc-hoya-neutral`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same dog, same markings, same position, same size, same colours, same accessory, same magenta background, same framing) except for this change: Surprised: eyes wide open with small pupils, round O-shaped mouth, ears flipped up, a small sweat drop. Keep the Chiikawa-style chibi look.
```

### `mc-hoya-sad` — 호야 슬픔

- 비율 1:1 · 참조: `mc-hoya-neutral`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same dog, same markings, same position, same size, same colours, same accessory, same magenta background, same framing) except for this change: Sad: glossy teary eyes with one tear, droopy ears, small frown, head slightly lowered. Keep the Chiikawa-style chibi look.
```

### `mc-hoya-angry` — 호야 화남

- 비율 1:1 · 참조: `mc-hoya-neutral`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same dog, same markings, same position, same size, same colours, same accessory, same magenta background, same framing) except for this change: Cute grumpy anger: furrowed brows, puffed cheeks, a small red anger mark, looking sideways with a huff. Keep the Chiikawa-style chibi look.
```

### `mc-hoya-proud` — 호야 자신만만

- 비율 1:1 · 참조: `mc-hoya-neutral`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same dog, same markings, same position, same size, same colours, same accessory, same magenta background, same framing) except for this change: Proud and smug: eyes closed confidently, nose up, chest out, a small sparkle next to the head. Keep the Chiikawa-style chibi look.
```

### `mc-hoya-sleepy` — 호야 졸림

- 비율 1:1 · 참조: `mc-hoya-neutral`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same dog, same markings, same position, same size, same colours, same accessory, same magenta background, same framing) except for this change: Sleepy: droopy half-closed eyes, a big yawn, slouched, a small "Zz" bubble shape (no letters needed). Keep the Chiikawa-style chibi look.
```

## 묶음 2 (10장)

### `mc-hoya-pose-wave` — 호야 손 흔들기

- 비율 1:1 · 참조: `mc-hoya-neutral`

```text
Keep exactly the same dog design, markings, colours, accessory, size and position in the frame as the attached image, and the same Chiikawa-style chibi look, but change the pose. Pose: waving one front paw high in greeting, the other paw on the ground, friendly face. Flat solid pure magenta background #FF00FF.
```

### `mc-hoya-pose-clap` — 호야 박수

- 비율 1:1 · 참조: `mc-hoya-neutral`

```text
Keep exactly the same dog design, markings, colours, accessory, size and position in the frame as the attached image, and the same Chiikawa-style chibi look, but change the pose. Pose: sitting up on the hind legs and clapping both front paws together in front of the chest, happy face. Flat solid pure magenta background #FF00FF.
```

### `mc-hoya-pose-mic` — 호야 마이크

- 비율 1:1 · 참조: `mc-hoya-neutral`

```text
Keep exactly the same dog design, markings, colours, accessory, size and position in the frame as the attached image, and the same Chiikawa-style chibi look, but change the pose. Pose: holding a small black handheld microphone with one front paw near the mouth like a TV show host. Flat solid pure magenta background #FF00FF.
```

### `mc-bomi-eyes-closed` — 봄이 눈 감음(깜빡임)

- 비율 1:1 · 참조: `mc-bomi-neutral`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same dog, same markings, same position, same size, same colours, same accessory, same magenta background, same framing) and ONLY change the eyes to closed eyes (two small gentle downward-curved lines).
```

### `mc-bomi-mouth-open` — 봄이 입 벌림(말하기)

- 비율 1:1 · 참조: `mc-bomi-neutral`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same dog, same markings, same position, same size, same colours, same accessory, same magenta background, same framing) and ONLY change the mouth to an open mouth, as if talking.
```

### `mc-bomi-joy` — 봄이 기쁨

- 비율 1:1 · 참조: `mc-bomi-neutral`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same dog, same markings, same position, same size, same colours, same accessory, same magenta background, same framing) except for this change: Overjoyed: eyes closed in happy upward arcs, wide open smiling mouth, ears lifted, tail wagging. Keep the Chiikawa-style chibi look.
```

### `mc-bomi-surprise` — 봄이 놀람

- 비율 1:1 · 참조: `mc-bomi-neutral`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same dog, same markings, same position, same size, same colours, same accessory, same magenta background, same framing) except for this change: Surprised: eyes wide open with small pupils, round O-shaped mouth, ears flipped up, a small sweat drop. Keep the Chiikawa-style chibi look.
```

### `mc-bomi-sad` — 봄이 슬픔

- 비율 1:1 · 참조: `mc-bomi-neutral`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same dog, same markings, same position, same size, same colours, same accessory, same magenta background, same framing) except for this change: Sad: glossy teary eyes with one tear, droopy ears, small frown, head slightly lowered. Keep the Chiikawa-style chibi look.
```

### `mc-bomi-angry` — 봄이 화남

- 비율 1:1 · 참조: `mc-bomi-neutral`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same dog, same markings, same position, same size, same colours, same accessory, same magenta background, same framing) except for this change: Cute grumpy anger: furrowed brows, puffed cheeks, a small red anger mark, looking sideways with a huff. Keep the Chiikawa-style chibi look.
```

### `mc-bomi-proud` — 봄이 자신만만

- 비율 1:1 · 참조: `mc-bomi-neutral`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same dog, same markings, same position, same size, same colours, same accessory, same magenta background, same framing) except for this change: Proud and smug: eyes closed confidently, nose up, chest out, a small sparkle next to the head. Keep the Chiikawa-style chibi look.
```

## 묶음 3 (5장)

### `mc-bomi-sleepy` — 봄이 졸림

- 비율 1:1 · 참조: `mc-bomi-neutral`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same dog, same markings, same position, same size, same colours, same accessory, same magenta background, same framing) except for this change: Sleepy: droopy half-closed eyes, a big yawn, slouched, a small "Zz" bubble shape (no letters needed). Keep the Chiikawa-style chibi look.
```

### `mc-bomi-pose-wave` — 봄이 손 흔들기

- 비율 1:1 · 참조: `mc-bomi-neutral`

```text
Keep exactly the same dog design, markings, colours, accessory, size and position in the frame as the attached image, and the same Chiikawa-style chibi look, but change the pose. Pose: waving one front paw high in greeting, the other paw on the ground, friendly face. Flat solid pure magenta background #FF00FF.
```

### `mc-bomi-pose-clap` — 봄이 박수

- 비율 1:1 · 참조: `mc-bomi-neutral`

```text
Keep exactly the same dog design, markings, colours, accessory, size and position in the frame as the attached image, and the same Chiikawa-style chibi look, but change the pose. Pose: sitting up on the hind legs and clapping both front paws together in front of the chest, happy face. Flat solid pure magenta background #FF00FF.
```

### `mc-bomi-pose-mic` — 봄이 마이크

- 비율 1:1 · 참조: `mc-bomi-neutral`

```text
Keep exactly the same dog design, markings, colours, accessory, size and position in the frame as the attached image, and the same Chiikawa-style chibi look, but change the pose. Pose: holding a small black handheld microphone with one front paw near the mouth like a TV show host. Flat solid pure magenta background #FF00FF.
```

### `mc-duo` — 호야·봄이 같이

- 비율 16:9 · 참조: `mc-hoya-neutral`, `mc-bomi-neutral`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. The two attached dogs together as TV variety show hosts in the Chiikawa world: on the left HOYA (the older brother, goofy and cheerful, waving), on the right BOMI (the younger sister, calm and slightly unimpressed, holding a small microphone). Keep each dog's design exactly as in the attached images, same size as each other, standing side by side, centred with generous margin on both sides. Landscape 16:9, flat solid pure magenta background #FF00FF, no floor, no shadow, no text.
```
