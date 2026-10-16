# 치이카와 그림 전체 요청 (로컬 Gemini 스킬용) — 1차 본편

테스트 결과가 좋아서 본편을 요청합니다. **95장**, 10장씩 **10묶음**입니다. 한도(5시간에 약 10장)에 맞춰 묶음 순서대로 만들어 주세요.

## 로컬 Claude에게 시킬 일

1. 아래 묶음 1부터 순서대로 만듭니다. 프롬프트는 그대로 복사해서 씁니다(영문). **각 항목 1장씩**만 만듭니다(테스트 때처럼 2장 만들 필요 없음).
2. **참조 이미지**가 적힌 항목은 그 파일을 첨부해 「편집/참조」로 요청합니다. 참조 파일 이름:
   - `ch-chiikawa-base` → 테스트 때 만든 `ch-chiikawa-base.png` (첫 장)
   - `ch-hachiware-base` → 테스트 때 만든 `ch-hachiware-base.png` (첫 장)
   - `bg-park` → 테스트 때 만든 `bg-ch-park-2.png`
   - 그 밖의 id → 이번에 앞에서 만든 `<id>.png`
3. 비율: 캐릭터 **3:4**, 스프라이트 시트 **1:1**, 배경 **16:9** (엔진 옵션 그대로).
4. 결과는 `<id>.png` 이름으로 한 폴더에 모읍니다. 원본 JPG도 같이 넣어 주면 좋습니다(`<id>_original.jpg`).
5. 묶음을 몇 개씩 끝낼 때마다 zip으로 채팅에 보내 주시면 바로 게임에 넣어 보겠습니다. 마지막에 짧은 `REPORT.md`(거절·실패·다시 뽑은 항목)를 같이 주세요.
6. 결과가 이상하면(다른 캐릭터처럼 생김, 위치가 크게 어긋남, 팔이 몸에 붙음) **1번까지 다시 뽑아도 됩니다.** 그래도 이상하면 그대로 보내고 보고서에 적어 주세요.

## 이미 받은 것 (다시 만들지 않음)

치이카와 기본·팔 없음·눈 감음·입 벌림·울음·점프 시트, 하치와레 기본, 펭귄, 공원 배경, 요리사 모자.

> **테스트 그림을 게임에 넣어 보고 알게 된 것 (10-16):** ① 참조 이미지를 붙인 그림은 위치·크기가 그대로 맞아 자동으로
> 배치됩니다. 참조 없이 그린 펭귄 첫 장은 발이 6.6 % 위, 크기 0.81배라 위치만 보정했어요 → **참조 첨부를 꼭 지켜 주세요.**
> ② 편집 그림(팔 없음·눈·입·표정)은 바뀐 곳만 잘라 겹쳐 쓰므로 **팔·몸은 절대 움직이지 않게** (울음 그림은 완벽했어요).
> ③ 점프 시트는 칸마다 크기·발 위치가 달라도 머리 크기 기준으로 맞춰 쓰지만, 웅크린 첫 칸이 앉은 자세로 나와서 프롬프트에
> 「무릎 굽히고 두 발은 바닥에, 앉지 않기」와 「네 칸 모두 머리 크기 같게」를 넣었어요. ④ 파일 이름은 요청 id 그대로
> (`<id>.png`, 원본 `<id>_original.jpg`, 두 번째 장 `<id>-2.png`)면 됩니다.


## 공통 그림체 문장 (프롬프트에 이미 들어 있음)

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border.
```

## 묶음 1 (10장)

### `ch-usagi-base` — 우사기 기본

- 비율 3:4 · 참조: `ch-chiikawa-base`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a cream-yellow chibi rabbit-like creature with two long upright rabbit ears, a round head, wide happy dot eyes, a big open mouth, orange-pink blush, energetic pose, Chiikawa style, standing front view with a calm little smile. Both short arms held slightly away from the body (not touching the body) so they are clearly separate shapes. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). Draw this new character instead of the attached one. Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

### `ch-momonga-base` — 모몽가 기본

- 비율 3:4 · 참조: `ch-chiikawa-base`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a small white chibi flying squirrel with big sparkly eyes, small rounded squirrel ears, a fluffy curled tail and a pale blue-grey gliding membrane, pink blush, Chiikawa style, standing front view with a calm little smile. Both short arms held slightly away from the body (not touching the body) so they are clearly separate shapes. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). Draw this new character instead of the attached one. Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

### `ch-kurimanju-base` — 쿠리만쥬 기본

- 비율 3:4 · 참조: `ch-chiikawa-base`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a round chestnut-bun shaped chibi creature with warm brown fur, a darker brown top like a baked chestnut bun, tiny bun-like ears, sleepy content eyes and a small smile, Chiikawa style, standing front view with a calm little smile. Both short arms held slightly away from the body (not touching the body) so they are clearly separate shapes. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). Draw this new character instead of the attached one. Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

### `ch-rakko-base` — 랏코 기본

- 비율 3:4 · 참조: `ch-chiikawa-base`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a tall beige chibi sea otter with small round otter ears low on the head, a light muzzle, calm confident eyes, a slightly longer body, Chiikawa style, standing front view with a calm little smile. Both short arms held slightly away from the body (not touching the body) so they are clearly separate shapes. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). Draw this new character instead of the attached one. Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

### `ch-shisa-base` — 시사 기본

- 비율 3:4 · 참조: `ch-chiikawa-base`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a round golden-yellow chibi shisa lion-dog with a fluffy curly orange mane around the face, small rounded ears, cheerful dot eyes and a wide smile, Chiikawa style, standing front view with a calm little smile. Both short arms held slightly away from the body (not touching the body) so they are clearly separate shapes. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). Draw this new character instead of the attached one. Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

### `ch-chiikawa-expr-joy` — 치이카와 기쁨

- 비율 3:4 · 참조: `ch-chiikawa-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) except the face: change ONLY the face to a very happy face — eyes closed into happy upward arcs (^ ^) and a big open smiling mouth. Arms stay exactly where they are.
```

### `ch-chiikawa-expr-shock` — 치이카와 놀람

- 비율 3:4 · 참조: `ch-chiikawa-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) except the face: change ONLY the face to a shocked face — small round wide-open eyes, a small round open mouth, pale cheeks, and three short vertical shock lines just above the head. Arms stay exactly where they are.
```

### `ch-hachiware-noarms` — 하치와레 팔 없음

- 비율 3:4 · 참조: `ch-hachiware-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) and ONLY remove both arms, so the body outline continues smoothly where the arms were. Do not move or redraw anything else.
```

### `ch-hachiware-eyes-closed` — 하치와레 눈 감음

- 비율 3:4 · 참조: `ch-hachiware-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) and ONLY change the eyes to closed eyes (two small gentle downward-curved lines).
```

### `ch-hachiware-mouth-open` — 하치와레 입 벌림

- 비율 3:4 · 참조: `ch-hachiware-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) and ONLY change the mouth to a small open mouth, as if talking.
```

## 묶음 2 (10장)

### `ch-hachiware-expr-cry` — 하치와레 울음

- 비율 3:4 · 참조: `ch-hachiware-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) except the face: change ONLY the face to Chiikawa's famous crying face — eyes squeezed shut, big wobbly mouth, big tear drops streaming down. Arms stay exactly where they are.
```

### `ch-hachiware-expr-joy` — 하치와레 기쁨

- 비율 3:4 · 참조: `ch-hachiware-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) except the face: change ONLY the face to a very happy face — eyes closed into happy upward arcs (^ ^) and a big open smiling mouth. Arms stay exactly where they are.
```

### `ch-hachiware-expr-shock` — 하치와레 놀람

- 비율 3:4 · 참조: `ch-hachiware-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) except the face: change ONLY the face to a shocked face — small round wide-open eyes, a small round open mouth, pale cheeks, and three short vertical shock lines just above the head. Arms stay exactly where they are.
```

### `ch-hachiware-sheet-jump` — 하치와레 점프 4프레임

- 비율 1:1 · 참조: `ch-hachiware-base`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A sprite sheet of the attached character (keep its design exactly). Four animation frames of a happy jump, left to right then top to bottom: 1) crouching down ready to jump (knees bent, both feet flat on the floor, not sitting), 2) springing up with arms raised, 3) at the top of the jump, arms up, very happy, 4) landing, slightly squashed. The character is the SAME size in every cell (the head exactly the same size in all four frames) and stands at the same height position inside each cell. Nothing crosses the cell borders. No text, no numbers. Square 1:1, a 2x2 grid of four equal cells with clear magenta gaps between them; flat solid pure magenta background #FF00FF everywhere.
```

### `ch-usagi-noarms` — 우사기 팔 없음

- 비율 3:4 · 참조: `ch-usagi-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) and ONLY remove both arms, so the body outline continues smoothly where the arms were. Do not move or redraw anything else.
```

### `ch-usagi-eyes-closed` — 우사기 눈 감음

- 비율 3:4 · 참조: `ch-usagi-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) and ONLY change the eyes to closed eyes (two small gentle downward-curved lines).
```

### `ch-usagi-mouth-open` — 우사기 입 벌림

- 비율 3:4 · 참조: `ch-usagi-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) and ONLY change the mouth to a small open mouth, as if talking.
```

### `ch-usagi-expr-cry` — 우사기 울음

- 비율 3:4 · 참조: `ch-usagi-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) except the face: change ONLY the face to Chiikawa's famous crying face — eyes squeezed shut, big wobbly mouth, big tear drops streaming down. Arms stay exactly where they are.
```

### `ch-usagi-expr-joy` — 우사기 기쁨

- 비율 3:4 · 참조: `ch-usagi-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) except the face: change ONLY the face to a very happy face — eyes closed into happy upward arcs (^ ^) and a big open smiling mouth. Arms stay exactly where they are.
```

### `ch-usagi-expr-shock` — 우사기 놀람

- 비율 3:4 · 참조: `ch-usagi-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) except the face: change ONLY the face to a shocked face — small round wide-open eyes, a small round open mouth, pale cheeks, and three short vertical shock lines just above the head. Arms stay exactly where they are.
```

## 묶음 3 (10장)

### `ch-usagi-sheet-jump` — 우사기 점프 4프레임

- 비율 1:1 · 참조: `ch-usagi-base`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A sprite sheet of the attached character (keep its design exactly). Four animation frames of a happy jump, left to right then top to bottom: 1) crouching down ready to jump (knees bent, both feet flat on the floor, not sitting), 2) springing up with arms raised, 3) at the top of the jump, arms up, very happy, 4) landing, slightly squashed. The character is the SAME size in every cell (the head exactly the same size in all four frames) and stands at the same height position inside each cell. Nothing crosses the cell borders. No text, no numbers. Square 1:1, a 2x2 grid of four equal cells with clear magenta gaps between them; flat solid pure magenta background #FF00FF everywhere.
```

### `ch-momonga-noarms` — 모몽가 팔 없음

- 비율 3:4 · 참조: `ch-momonga-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) and ONLY remove both arms, so the body outline continues smoothly where the arms were. Keep the tail and the gliding membrane. Do not move or redraw anything else.
```

### `ch-momonga-eyes-closed` — 모몽가 눈 감음

- 비율 3:4 · 참조: `ch-momonga-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) and ONLY change the eyes to closed eyes (two small gentle downward-curved lines).
```

### `ch-momonga-mouth-open` — 모몽가 입 벌림

- 비율 3:4 · 참조: `ch-momonga-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) and ONLY change the mouth to a small open mouth, as if talking.
```

### `ch-momonga-expr-cry` — 모몽가 울음

- 비율 3:4 · 참조: `ch-momonga-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) except the face: change ONLY the face to Chiikawa's famous crying face — eyes squeezed shut, big wobbly mouth, big tear drops streaming down. Arms stay exactly where they are.
```

### `ch-momonga-expr-joy` — 모몽가 기쁨

- 비율 3:4 · 참조: `ch-momonga-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) except the face: change ONLY the face to a very happy face — eyes closed into happy upward arcs (^ ^) and a big open smiling mouth. Arms stay exactly where they are.
```

### `ch-momonga-expr-shock` — 모몽가 놀람

- 비율 3:4 · 참조: `ch-momonga-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) except the face: change ONLY the face to a shocked face — small round wide-open eyes, a small round open mouth, pale cheeks, and three short vertical shock lines just above the head. Arms stay exactly where they are.
```

### `ch-momonga-sheet-jump` — 모몽가 점프 4프레임

- 비율 1:1 · 참조: `ch-momonga-base`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A sprite sheet of the attached character (keep its design exactly). Four animation frames of a happy jump, left to right then top to bottom: 1) crouching down ready to jump (knees bent, both feet flat on the floor, not sitting), 2) springing up with arms raised, 3) at the top of the jump, arms up, very happy, 4) landing, slightly squashed. The character is the SAME size in every cell (the head exactly the same size in all four frames) and stands at the same height position inside each cell. Nothing crosses the cell borders. No text, no numbers. Square 1:1, a 2x2 grid of four equal cells with clear magenta gaps between them; flat solid pure magenta background #FF00FF everywhere.
```

### `ch-kurimanju-noarms` — 쿠리만쥬 팔 없음

- 비율 3:4 · 참조: `ch-kurimanju-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) and ONLY remove both arms, so the body outline continues smoothly where the arms were. Do not move or redraw anything else.
```

### `ch-kurimanju-eyes-closed` — 쿠리만쥬 눈 감음

- 비율 3:4 · 참조: `ch-kurimanju-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) and ONLY change the eyes to closed eyes (two small gentle downward-curved lines).
```

## 묶음 4 (10장)

### `ch-kurimanju-mouth-open` — 쿠리만쥬 입 벌림

- 비율 3:4 · 참조: `ch-kurimanju-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) and ONLY change the mouth to a small open mouth, as if talking.
```

### `ch-kurimanju-expr-cry` — 쿠리만쥬 울음

- 비율 3:4 · 참조: `ch-kurimanju-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) except the face: change ONLY the face to Chiikawa's famous crying face — eyes squeezed shut, big wobbly mouth, big tear drops streaming down. Arms stay exactly where they are.
```

### `ch-kurimanju-expr-joy` — 쿠리만쥬 기쁨

- 비율 3:4 · 참조: `ch-kurimanju-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) except the face: change ONLY the face to a very happy face — eyes closed into happy upward arcs (^ ^) and a big open smiling mouth. Arms stay exactly where they are.
```

### `ch-kurimanju-expr-shock` — 쿠리만쥬 놀람

- 비율 3:4 · 참조: `ch-kurimanju-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) except the face: change ONLY the face to a shocked face — small round wide-open eyes, a small round open mouth, pale cheeks, and three short vertical shock lines just above the head. Arms stay exactly where they are.
```

### `ch-kurimanju-sheet-jump` — 쿠리만쥬 점프 4프레임

- 비율 1:1 · 참조: `ch-kurimanju-base`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A sprite sheet of the attached character (keep its design exactly). Four animation frames of a happy jump, left to right then top to bottom: 1) crouching down ready to jump (knees bent, both feet flat on the floor, not sitting), 2) springing up with arms raised, 3) at the top of the jump, arms up, very happy, 4) landing, slightly squashed. The character is the SAME size in every cell (the head exactly the same size in all four frames) and stands at the same height position inside each cell. Nothing crosses the cell borders. No text, no numbers. Square 1:1, a 2x2 grid of four equal cells with clear magenta gaps between them; flat solid pure magenta background #FF00FF everywhere.
```

### `ch-rakko-noarms` — 랏코 팔 없음

- 비율 3:4 · 참조: `ch-rakko-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) and ONLY remove both arms, so the body outline continues smoothly where the arms were. Keep the tail. Do not move or redraw anything else.
```

### `ch-rakko-eyes-closed` — 랏코 눈 감음

- 비율 3:4 · 참조: `ch-rakko-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) and ONLY change the eyes to closed eyes (two small gentle downward-curved lines).
```

### `ch-rakko-mouth-open` — 랏코 입 벌림

- 비율 3:4 · 참조: `ch-rakko-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) and ONLY change the mouth to a small open mouth, as if talking.
```

### `ch-rakko-expr-cry` — 랏코 울음

- 비율 3:4 · 참조: `ch-rakko-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) except the face: change ONLY the face to Chiikawa's famous crying face — eyes squeezed shut, big wobbly mouth, big tear drops streaming down. Arms stay exactly where they are.
```

### `ch-rakko-expr-joy` — 랏코 기쁨

- 비율 3:4 · 참조: `ch-rakko-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) except the face: change ONLY the face to a very happy face — eyes closed into happy upward arcs (^ ^) and a big open smiling mouth. Arms stay exactly where they are.
```

## 묶음 5 (10장)

### `ch-rakko-expr-shock` — 랏코 놀람

- 비율 3:4 · 참조: `ch-rakko-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) except the face: change ONLY the face to a shocked face — small round wide-open eyes, a small round open mouth, pale cheeks, and three short vertical shock lines just above the head. Arms stay exactly where they are.
```

### `ch-rakko-sheet-jump` — 랏코 점프 4프레임

- 비율 1:1 · 참조: `ch-rakko-base`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A sprite sheet of the attached character (keep its design exactly). Four animation frames of a happy jump, left to right then top to bottom: 1) crouching down ready to jump (knees bent, both feet flat on the floor, not sitting), 2) springing up with arms raised, 3) at the top of the jump, arms up, very happy, 4) landing, slightly squashed. The character is the SAME size in every cell (the head exactly the same size in all four frames) and stands at the same height position inside each cell. Nothing crosses the cell borders. No text, no numbers. Square 1:1, a 2x2 grid of four equal cells with clear magenta gaps between them; flat solid pure magenta background #FF00FF everywhere.
```

### `ch-shisa-noarms` — 시사 팔 없음

- 비율 3:4 · 참조: `ch-shisa-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) and ONLY remove both arms, so the body outline continues smoothly where the arms were. Keep the mane. Do not move or redraw anything else.
```

### `ch-shisa-eyes-closed` — 시사 눈 감음

- 비율 3:4 · 참조: `ch-shisa-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) and ONLY change the eyes to closed eyes (two small gentle downward-curved lines).
```

### `ch-shisa-mouth-open` — 시사 입 벌림

- 비율 3:4 · 참조: `ch-shisa-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) and ONLY change the mouth to a small open mouth, as if talking.
```

### `ch-shisa-expr-cry` — 시사 울음

- 비율 3:4 · 참조: `ch-shisa-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) except the face: change ONLY the face to Chiikawa's famous crying face — eyes squeezed shut, big wobbly mouth, big tear drops streaming down. Arms stay exactly where they are.
```

### `ch-shisa-expr-joy` — 시사 기쁨

- 비율 3:4 · 참조: `ch-shisa-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) except the face: change ONLY the face to a very happy face — eyes closed into happy upward arcs (^ ^) and a big open smiling mouth. Arms stay exactly where they are.
```

### `ch-shisa-expr-shock` — 시사 놀람

- 비율 3:4 · 참조: `ch-shisa-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) except the face: change ONLY the face to a shocked face — small round wide-open eyes, a small round open mouth, pale cheeks, and three short vertical shock lines just above the head. Arms stay exactly where they are.
```

### `ch-shisa-sheet-jump` — 시사 점프 4프레임

- 비율 1:1 · 참조: `ch-shisa-base`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A sprite sheet of the attached character (keep its design exactly). Four animation frames of a happy jump, left to right then top to bottom: 1) crouching down ready to jump (knees bent, both feet flat on the floor, not sitting), 2) springing up with arms raised, 3) at the top of the jump, arms up, very happy, 4) landing, slightly squashed. The character is the SAME size in every cell (the head exactly the same size in all four frames) and stands at the same height position inside each cell. Nothing crosses the cell borders. No text, no numbers. Square 1:1, a 2x2 grid of four equal cells with clear magenta gaps between them; flat solid pure magenta background #FF00FF everywhere.
```

### `ch-pochette-base` — 포셰트 기본

- 비율 3:4 · 참조: `ch-chiikawa-base`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a small lavender chibi creature with soft drooping pouch-shaped ears and a tiny purple pouch bag on a strap, dot eyes, pink blush, Chiikawa style, standing front view with a calm little smile. Both short arms held slightly away from the body (not touching the body) so they are clearly separate shapes. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). Draw this new character instead of the attached one. Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

## 묶음 6 (10장)

### `ch-pochette-noarms` — 포셰트 팔 없음

- 비율 3:4 · 참조: `ch-pochette-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) and ONLY remove both arms, so the body outline continues smoothly where the arms were. Keep the pouch bag and its strap. Do not move or redraw anything else.
```

### `ch-pochette-eyes-closed` — 포셰트 눈 감음

- 비율 3:4 · 참조: `ch-pochette-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) and ONLY change the eyes to closed eyes (two small gentle downward-curved lines).
```

### `ch-pochette-mouth-open` — 포셰트 입 벌림

- 비율 3:4 · 참조: `ch-pochette-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) and ONLY change the mouth to a small open mouth, as if talking.
```

### `ch-pochette-expr-cry` — 포셰트 울음

- 비율 3:4 · 참조: `ch-pochette-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) except the face: change ONLY the face to Chiikawa's famous crying face — eyes squeezed shut, big wobbly mouth, big tear drops streaming down. Arms stay exactly where they are.
```

### `ch-pochette-expr-joy` — 포셰트 기쁨

- 비율 3:4 · 참조: `ch-pochette-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) except the face: change ONLY the face to a very happy face — eyes closed into happy upward arcs (^ ^) and a big open smiling mouth. Arms stay exactly where they are.
```

### `ch-pochette-expr-shock` — 포셰트 놀람

- 비율 3:4 · 참조: `ch-pochette-base`

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) except the face: change ONLY the face to a shocked face — small round wide-open eyes, a small round open mouth, pale cheeks, and three short vertical shock lines just above the head. Arms stay exactly where they are.
```

### `ch-pochette-sheet-jump` — 포셰트 점프 4프레임

- 비율 1:1 · 참조: `ch-pochette-base`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A sprite sheet of the attached character (keep its design exactly). Four animation frames of a happy jump, left to right then top to bottom: 1) crouching down ready to jump (knees bent, both feet flat on the floor, not sitting), 2) springing up with arms raised, 3) at the top of the jump, arms up, very happy, 4) landing, slightly squashed. The character is the SAME size in every cell (the head exactly the same size in all four frames) and stands at the same height position inside each cell. Nothing crosses the cell borders. No text, no numbers. Square 1:1, a 2x2 grid of four equal cells with clear magenta gaps between them; flat solid pure magenta background #FF00FF everywhere.
```

### `npc-hamster-base` — 단짝 후보 햄스터

- 비율 3:4 · 참조: `ch-chiikawa-base`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. An ORIGINAL character (not from the manga): a round chibi hamster with golden fur, a white muzzle and belly, tiny round ears and puffy cheeks, Chiikawa-like simple style, standing front view with a friendly smile, short arms (or flippers / wings) held slightly away from the body. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

### `npc-duckling-base` — 단짝 후보 오리

- 비율 3:4 · 참조: `ch-chiikawa-base`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. An ORIGINAL character (not from the manga): a round chibi yellow duckling with a small orange bill, a little head tuft and tiny wings, Chiikawa-like simple style, standing front view with a friendly smile, short arms (or flippers / wings) held slightly away from the body. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

### `npc-panda-base` — 단짝 후보 판다

- 비율 3:4 · 참조: `ch-chiikawa-base`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. An ORIGINAL character (not from the manga): a round chibi panda with black round ears, black eye patches and black arms on white fur, Chiikawa-like simple style, standing front view with a friendly smile, short arms (or flippers / wings) held slightly away from the body. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

## 묶음 7 (10장)

### `npc-squirrel-base` — 단짝 후보 다람쥐

- 비율 3:4 · 참조: `ch-chiikawa-base`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. An ORIGINAL character (not from the manga): a round chibi chipmunk squirrel with orange-brown fur, back stripes, a cream belly and a big bushy tail, Chiikawa-like simple style, standing front view with a friendly smile, short arms (or flippers / wings) held slightly away from the body. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

### `npc-lamb-base` — 단짝 후보 아기양

- 비율 3:4 · 참조: `ch-chiikawa-base`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. An ORIGINAL character (not from the manga): a round chibi lamb with a fluffy cloud-like white fleece, small floppy ears and a beige face, Chiikawa-like simple style, standing front view with a friendly smile, short arms (or flippers / wings) held slightly away from the body. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

### `npc-frog-base` — 단짝 후보 개구리

- 비율 3:4 · 참조: `ch-chiikawa-base`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. An ORIGINAL character (not from the manga): a round chibi green frog with big round eyes on top of the head and a pale belly, Chiikawa-like simple style, standing front view with a friendly smile, short arms (or flippers / wings) held slightly away from the body. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

### `npc-bear_cub-base` — 단짝 후보 아기곰

- 비율 3:4 · 참조: `ch-chiikawa-base`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. An ORIGINAL character (not from the manga): a round chibi brown bear cub with round ears and a light muzzle, Chiikawa-like simple style, standing front view with a friendly smile, short arms (or flippers / wings) held slightly away from the body. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

### `npc-fox-base` — 단짝 후보 여우

- 비율 3:4 · 참조: `ch-chiikawa-base`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. An ORIGINAL character (not from the manga): a round chibi orange fox with big pointed ears, a white muzzle and a fluffy white-tipped tail, Chiikawa-like simple style, standing front view with a friendly smile, short arms (or flippers / wings) held slightly away from the body. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

### `npc-owl-base` — 단짝 후보 부엉이

- 비율 3:4 · 참조: `ch-chiikawa-base`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. An ORIGINAL character (not from the manga): a round chibi owl with brown feathers, ear tufts, a cream face disc and big round yellow eyes, Chiikawa-like simple style, standing front view with a friendly smile, short arms (or flippers / wings) held slightly away from the body. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

### `pet-goldfish-base` — 반려동물 금붕어

- 비율 3:4 · 참조: `ch-chiikawa-base`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A small cute ORIGINAL pet animal (not from the manga): a round chibi orange goldfish with a flowing tail fin and big shiny eyes, simple cute style, front view, sitting or standing, happy. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). It may be a little shorter than the attached character but stands on the same floor line. Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

### `pet-chick-base` — 반려동물 병아리

- 비율 3:4 · 참조: `ch-chiikawa-base`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A small cute ORIGINAL pet animal (not from the manga): a tiny round chibi yellow chick with a small orange beak and stubby wings, simple cute style, front view, sitting or standing, happy. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). It may be a little shorter than the attached character but stands on the same floor line. Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

### `pet-turtle-base` — 반려동물 거북이

- 비율 3:4 · 참조: `ch-chiikawa-base`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A small cute ORIGINAL pet animal (not from the manga): a round chibi green turtle with a patterned shell and a friendly smile, simple cute style, front view, sitting or standing, happy. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). It may be a little shorter than the attached character but stands on the same floor line. Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

### `pet-hedgehog-base` — 반려동물 고슴도치

- 비율 3:4 · 참조: `ch-chiikawa-base`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A small cute ORIGINAL pet animal (not from the manga): a round chibi hedgehog with soft brown spines, a cream face and a tiny black nose, simple cute style, front view, sitting or standing, happy. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). It may be a little shorter than the attached character but stands on the same floor line. Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

## 묶음 8 (10장)

### `pet-parrot-base` — 반려동물 앵무새

- 비율 3:4 · 참조: `ch-chiikawa-base`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A small cute ORIGINAL pet animal (not from the manga): a round chibi green parrot with a yellow face, a red head crest and a curved beak, simple cute style, front view, sitting or standing, happy. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). It may be a little shorter than the attached character but stands on the same floor line. Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

### `pet-guinea_pig-base` — 반려동물 기니피그

- 비율 3:4 · 참조: `ch-chiikawa-base`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A small cute ORIGINAL pet animal (not from the manga): a round chibi guinea pig with tan and white patches, tiny ears and a pink nose, simple cute style, front view, sitting or standing, happy. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). It may be a little shorter than the attached character but stands on the same floor line. Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

### `pet-puppy-base` — 반려동물 강아지

- 비율 3:4 · 참조: `ch-chiikawa-base`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A small cute ORIGINAL pet animal (not from the manga): a round chibi cream puppy with floppy brown ears and a wagging tail, simple cute style, front view, sitting or standing, happy. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). It may be a little shorter than the attached character but stands on the same floor line. Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

### `pet-snail-base` — 반려동물 달팽이

- 비율 3:4 · 참조: `ch-chiikawa-base`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A small cute ORIGINAL pet animal (not from the manga): a round chibi snail with a pink swirl shell, two eye stalks and a sleepy smile, simple cute style, front view, sitting or standing, happy. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). It may be a little shorter than the attached character but stands on the same floor line. Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

### `bg-school` — 배경 · 학교

- 비율 16:9 · 참조: `bg-park`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a cosy elementary school classroom with small wooden desks, a green chalkboard with doodles, big windows with cherry blossoms outside. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

### `bg-mountain-trail` — 배경 · 산길

- 비율 16:9 · 참조: `bg-park`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a gentle mountain trail with stone steps, round pine trees, wildflowers and soft distant mountains. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

### `bg-office` — 배경 · 회사

- 비율 16:9 · 참조: `bg-park`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a cosy small office with desks, computers, potted plants and a big window with a city view. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

### `bg-hospital` — 배경 · 병원

- 비율 16:9 · 참조: `bg-park`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a clean bright hospital ward with a bed, light green curtains, a small reception counter and a green cross sign. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

### `bg-studio` — 배경 · 방송국 스튜디오

- 비율 16:9 · 참조: `bg-park`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a cheerful TV variety show studio with a host desk on the left, colourful stage lights, a big screen with stars and a shiny floor. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

### `bg-stage` — 배경 · 무대

- 비율 16:9 · 참조: `bg-park`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a concert stage with spotlights, red curtains, sparkles and empty audience seats. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

## 묶음 9 (10장)

### `bg-stadium` — 배경 · 경기장

- 비율 16:9 · 참조: `bg-park`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a sports stadium with a green field, white lines, empty stands and a scoreboard. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

### `bg-gym` — 배경 · 체육관

- 비율 16:9 · 참조: `bg-park`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a martial arts gym with soft mats, punching bags, a ring rope and banners. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

### `bg-army` — 배경 · 훈련소

- 비율 16:9 · 참조: `bg-park`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a military training camp ground with a dirt field, green tents, flags and a small watchtower. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

### `bg-campus` — 배경 · 대학 졸업식

- 비율 16:9 · 참조: `bg-park`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a university campus on graduation day with a big gate, blooming trees and graduation caps flying in the sky. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

### `bg-kitchen` — 배경 · 식당 주방

- 비율 16:9 · 참조: `bg-park`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a restaurant kitchen with pots on the stove, hanging ladles, shelves of ingredients and steam. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

### `bg-police` — 배경 · 경찰서

- 비율 16:9 · 참조: `bg-park`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a small neighbourhood police station with a counter, a map board and a blue-and-white sign. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

### `bg-lab` — 배경 · 연구실

- 비율 16:9 · 참조: `bg-park`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a research laboratory with colourful flasks, a microscope, a whiteboard with formulas and shelves. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

### `bg-space` — 배경 · 우주 발사장

- 비율 16:9 · 참조: `bg-park`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a rocket launch site at dusk with a white rocket on a gantry, stars appearing in a purple sky. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

### `bg-shop` — 배경 · 동네 마트

- 비율 16:9 · 참조: `bg-park`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a small neighbourhood mart with shelves of snacks and drinks, a counter with a cash register and colourful price tags. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

### `bg-holiday` — 배경 · 명절 거실

- 비율 16:9 · 참조: `bg-park`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a Korean living room on a holiday (Seollal / Chuseok) with a low table full of dishes, a folding screen (byeongpung) and floor cushions. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

## 묶음 10 (5장)

### `bg-house` — 배경 · 우리 집(집들이)

- 비율 16:9 · 참조: `bg-park`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a cosy small house living room decorated for a housewarming party, with a sofa, a rug, plants, warm lamps, balloons and a garland. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

### `bg-hometown` — 배경 · 고향 시골집

- 비율 16:9 · 참조: `bg-park`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a peaceful countryside village with a traditional Korean house (hanok roof), a persimmon tree, fields and a stone wall. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

### `bg-temple` — 배경 · 산사

- 비율 16:9 · 참조: `bg-park`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a quiet Korean mountain temple courtyard with a stone pagoda, colourful lanterns and a big bell pavilion. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

### `bg-jeju` — 배경 · 제주도

- 비율 16:9 · 참조: `bg-park`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a Jeju island seaside with dol-hareubang stone statues, yellow canola flowers, a turquoise sea and Hallasan mountain far away. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

### `bg-casino` — 배경 · 인생역전섬

- 비율 16:9 · 참조: `bg-park`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a playful 'life reversal island' fairground with a toy-like horse race track, colourful flags, a big lottery wheel and lights. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```
