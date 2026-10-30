# 남은 그림 전체 가이드 (로컬 Gemini 스킬용) — 2026-10-29

게임에 아직 없는 그림이 **이 문서 하나에 전부** 있어요. 모두 **353장**, 10장씩 **38묶음**이에요.
이전 요청 문서 3개(`chiikawa-full`, `chiikawa-mc`, `chiikawa-world`)에서 아직 안 만든 것도 다 여기로 옮겼으니, **이제 이 문서만 보면 됩니다.**
프롬프트 전문은 `remaining-all.json`에도 똑같이 들어 있어요(로컬 Claude가 읽기 편한 형식).

## 10-29에 받은 그림 — 게임에 넣었어요

- 우사기: 기본·팔 없음·눈 감음·입 벌림·기쁨·울음·놀람·점프 시트 (전부 OK)
- 하치와레: **`ch-hachiware-base-reframed`를 새 기본 그림으로** 썼어요(표정 그림들이 이걸 보고 그려졌어요) + 팔 없음·눈 감음·입 벌림·기쁨·울음·놀람·점프 시트
- 치이카와: 기쁨·놀람 / 쿠리만쥬·랏코·시사: 기본 그림
- **모몽가는 넣지 않았어요** — 원작과 달라서(작은 점 눈, 작은 귀, 흰 꼬리, 회색 비막) 처음부터 다시 그립니다. 아래 「모몽가 다시 그리기」를 꼭 봐 주세요.

이미 있는 치이카와 그림체 그림(다시 만들지 않음): 치이카와 전부, 하치와레 전부, 우사기 전부, 쿠리만쥬·랏코·시사 기본, 펭귄, 공원 배경, 요리사 모자.

## 모몽가 다시 그리기 (중요 · 맨 먼저)

받은 모몽가(점 눈·작은 귀·흰 꼬리·비막)도, 게임 안의 임시 그림도 원작과 달랐어요. 그래서 이번에는 글 설명이 아니라 **사용자가 가진 원작 모몽가 그림을 그대로 따라 그리게** 프롬프트를 바꿨어요.

- **참조 2장**: ① `ch-chiikawa-base.png` — 자세·크기·위치만 맞추는 용도 ② **원작 모몽가 그림 1장 — 생김새는 전부 이 그림대로**. 이 그림은 저장소에 올리지 않아요.
- 결과가 그래도 원작과 다르면, **② 원작 그림 하나만 첨부**하고 같은 프롬프트로 다시 뽑아도 돼요(위치·크기는 가져올 때 자동으로 맞춰요).
- **사용자 눈에 「모몽가다!」 싶을 때까지** 다시 뽑아 주세요. 나머지 모몽가 그림(팔 없음·눈 감음·입 벌림·표정·점프)은 전부 이 기본 그림을 고치는 편집이라, 기본 그림이 제일 중요해요.
- 이 그림이 오면 게임의 2D 그림(로비·컷인·결과)은 전부 그 그림으로 바뀌고, 3D 말도 그 그림에 맞춰 다시 만들어요.
- 포셰트도 원작 그림이 있으면 같은 방식으로 두 번째 참조로 붙여 주세요.

## 로컬 Claude에게 시킬 일

1. 묶음 1부터 순서대로 만듭니다. 프롬프트는 **영문 그대로 복사**해서 씁니다. 각 항목 **1장씩**.
2. **참조**가 적힌 항목은 그 파일을 첨부해 「편집/참조」로 요청합니다.
   - `ch-chiikawa-base` → 테스트 때 만든 `ch-chiikawa-base.png`
   - `bg-park` → 테스트 때 만든 `bg-ch-park-2.png`
   - `ch-kurimanju-base`, `ch-rakko-base`, `ch-shisa-base` → 10-29에 보내 준 그 파일
   - 그 밖의 id → 이번에 앞에서 만든 `<id>.png` (예: 모몽가 편집 → 새로 그린 `ch-momonga-base.png`)
   - MC 기준 두 장 → 호야·봄이 실제 사진 1~2장 + `ch-chiikawa-base.png`
3. 비율: 캐릭터·NPC·반려동물 **3:4**, 점프 시트 **1:1**, 배경 **16:9**, MC **1:1**(`mc-duo`만 16:9), 소품·아이콘·카드·보물·무늬 **1:1**.
4. 배경색: 캐릭터·MC·점프 시트는 **마젠타(#FF00FF)**, 소품·카드·아이템·보물·아이콘·키메라는 **흰색(#FFFFFF)**. 흰 물건(날개, 축구공, 마스크…)은 **테두리 선이 끊기지 않게** — 선이 열려 있으면 흰 배경과 같이 지워져요.
5. 파일 이름은 **id 그대로** `<id>.png` (원본은 `<id>_original.jpg`, 다시 뽑은 두 번째 장은 `<id>-2.png`). 한 폴더에 모아 **묶음 몇 개씩 zip**으로 채팅에 보내 주세요.
6. 편집 그림(팔 없음·눈·입·표정)은 바뀐 곳만 잘라 겹쳐 쓰므로 **팔·몸·꼬리는 절대 움직이지 않게**. 이상하면 1번까지 다시 뽑고, 그래도 이상하면 그대로 보내고 보고서에 적어 주세요.
7. 마지막에 짧은 `REPORT.md`(거절·실패·다시 뽑은 항목)를 같이 주세요.
8. 순서가 바뀌어도 괜찮지만, **기본 그림이 그 편집 그림보다 먼저** 와야 해요(같은 zip이면 OK).

## 한눈에 보기

| 묶음 | 내용 | 장수 | 중요도 |
|---|---|---:|:---:|
| 1–4 | **A.** 캐릭터 (모몽가 다시 + 남은 표정·팔·점프) | 36 | ★★★ |
| 5–6 | **B.** 친구(NPC)·반려동물 기본 그림 | 17 | ★★★ |
| 7–10 | **C.** 배경 (치이카와 그림체로) | 32 | ★★★ |
| 11–13 | **D.** MC 호야·봄이 (치이카와 그림체로) | 25 | ★★☆ |
| 14–20 | **E.** 소품 (캐릭터가 쓰는 모자·안경·손에 드는 것·등에 메는 것) | 69 | ★★☆ |
| 21–26 | **F.** 🐹 치이카와 모드 카드·아이템·보물·직업·키메라 | 59 | ★★☆ |
| 27–29 | **G.** 공용 카드 + 새 칸 아이콘 | 30 | ★★☆ |
| 30–36 | **H.** 🏙️ 현실 모드 그림 (카드·아이템·보물·직업) | 65 | ★☆☆ |
| 37–38 | **I.** (선택) 예전 그림체 정리 — 칸 아이콘·테두리 무늬·파티장 | 20 | ☆☆☆ |
| | **합계** | **353** | |

★★★ = 게임에서 제일 자주 보이는 그림. ☆☆☆ = 선택(안 해도 게임은 돌아가요). 묶음 순서 = 추천 순서예요.

## 공통 그림체 문장 (모든 프롬프트 앞에 이미 들어 있음)

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border.
```

모몽가 기본 그림만 이 문장에서 「tiny black dot eyes…」 부분을 뺐어요(큰 눈이 특징이라서).

## A. 캐릭터 (모몽가 다시 + 남은 표정·팔·점프) — 36장 ★★★

모몽가는 처음부터 다시 그립니다 (참조 2장). 쿠리만쥬·랏코·시사는 이번에 받은 기본 그림을 참조로 씁니다. 쿠리만쥬는 원래 눈을 감고 있어서 「눈 감음」은 필요 없어요.

### 묶음 1 (10장)

| id (파일 이름) | 내용 | 비율 | 참조 |
|---|---|:---:|---|
| `ch-momonga-base` | 모몽가 기본 (다시 · 원작 참고 그림이 기준) | 3:4 | `ch-chiikawa-base` + 모몽가 참고 그림(사용자 PC) |
| `ch-momonga-noarms` | 모몽가 팔 없음 | 3:4 | `ch-momonga-base` |
| `ch-momonga-eyes-closed` | 모몽가 눈 감음 | 3:4 | `ch-momonga-base` |
| `ch-momonga-mouth-open` | 모몽가 입 벌림 | 3:4 | `ch-momonga-base` |
| `ch-momonga-expr-joy` | 모몽가 기쁨 | 3:4 | `ch-momonga-base` |
| `ch-momonga-expr-cry` | 모몽가 울음 | 3:4 | `ch-momonga-base` |
| `ch-momonga-expr-shock` | 모몽가 놀람 | 3:4 | `ch-momonga-base` |
| `ch-momonga-sheet-jump` | 모몽가 점프 4프레임 | 1:1 | `ch-momonga-base` |
| `ch-kurimanju-noarms` | 쿠리만쥬 팔 없음 | 3:4 | `ch-kurimanju-base` |
| `ch-kurimanju-mouth-open` | 쿠리만쥬 입 벌림 | 3:4 | `ch-kurimanju-base` |

<details><summary>프롬프트 보기</summary>

**`ch-momonga-base`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. Redraw the character shown in the SECOND attached image — Momonga from the Chiikawa manga — as faithfully as possible: copy its face, the shape and size of its eyes, its ears, nose, mouth, tail, body proportions and colours exactly as drawn there; do not redesign or simplify it, do not turn it into a cat, rabbit or Chiikawa. (In words, in case something is unclear: Momonga from Chiikawa: a small round white chibi flying squirrel with BIG round glossy dark eyes looking slightly UPWARD (a pleading "please notice me" look, eyes much larger than Chiikawa's dot eyes, big white sparkle highlights), large upright ears with pale sky-blue insides, a small pale sky-blue nose, pink blush, a tiny ω-shaped mouth and a BIG fluffy pale sky-blue tail with darker blue stripes rising behind the body on one side. NO wings, NO gliding membrane, the tail is NOT white.) Use the FIRST attached image (the white Chiikawa) ONLY for the canvas: the same standing pose facing the viewer, the same size and exactly the same position in the frame (feet at the same height, centred). Both short arms held slightly away from the body (not touching the body or the tail). Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

**`ch-momonga-noarms`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) and ONLY remove both arms, so the body outline continues smoothly where the arms were. Keep the big blue tail, the ears and the face exactly as they are. Do not move or redraw anything else.
```

**`ch-momonga-eyes-closed`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) and ONLY change the two big eyes to closed eyes (two small gentle downward-curved lines where the eyes were).
```

**`ch-momonga-mouth-open`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) and ONLY change the mouth to a small open mouth, as if talking. Keep the big glossy eyes.
```

**`ch-momonga-expr-joy`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) except the face: change ONLY the face to a very happy face — eyes closed into happy upward arcs (^ ^) and a big open smiling mouth. Ears, blue nose, tail and arms stay exactly where they are.
```

**`ch-momonga-expr-cry`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) except the face: change ONLY the face to Chiikawa's famous crying face — eyes squeezed shut, big wobbly mouth, big tear drops streaming down. Ears, blue nose, tail and arms stay exactly where they are.
```

**`ch-momonga-expr-shock`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) except the face: change ONLY the face to a shocked face — the big eyes wide open with tiny pupils, a small round open mouth, pale cheeks, and three short vertical shock lines just above the head. Ears, tail and arms stay exactly where they are.
```

**`ch-momonga-sheet-jump`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A sprite sheet of the attached character (keep its design exactly). Four animation frames of a happy jump, left to right then top to bottom: 1) crouching down ready to jump (knees bent, both feet flat on the floor, not sitting), 2) springing up with arms raised, 3) at the top of the jump, arms up, very happy, 4) landing, slightly squashed. The character is the SAME size in every cell (the head exactly the same size in all four frames) and stands at the same height position inside each cell. Nothing crosses the cell borders. No text, no numbers. Square 1:1, a 2x2 grid of four equal cells with clear magenta gaps between them; flat solid pure magenta background #FF00FF everywhere.
```

**`ch-kurimanju-noarms`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) and ONLY remove both arms, so the body outline continues smoothly where the arms were. Do not move or redraw anything else.
```

**`ch-kurimanju-mouth-open`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) and ONLY change the mouth to a small open mouth, as if talking.
```

</details>

### 묶음 2 (10장)

| id (파일 이름) | 내용 | 비율 | 참조 |
|---|---|:---:|---|
| `ch-kurimanju-expr-joy` | 쿠리만쥬 기쁨 | 3:4 | `ch-kurimanju-base` |
| `ch-kurimanju-expr-cry` | 쿠리만쥬 울음 | 3:4 | `ch-kurimanju-base` |
| `ch-kurimanju-expr-shock` | 쿠리만쥬 놀람 | 3:4 | `ch-kurimanju-base` |
| `ch-kurimanju-sheet-jump` | 쿠리만쥬 점프 4프레임 | 1:1 | `ch-kurimanju-base` |
| `ch-rakko-noarms` | 랏코 팔 없음 | 3:4 | `ch-rakko-base` |
| `ch-rakko-eyes-closed` | 랏코 눈 감음 | 3:4 | `ch-rakko-base` |
| `ch-rakko-mouth-open` | 랏코 입 벌림 | 3:4 | `ch-rakko-base` |
| `ch-rakko-expr-joy` | 랏코 기쁨 | 3:4 | `ch-rakko-base` |
| `ch-rakko-expr-cry` | 랏코 울음 | 3:4 | `ch-rakko-base` |
| `ch-rakko-expr-shock` | 랏코 놀람 | 3:4 | `ch-rakko-base` |

<details><summary>프롬프트 보기</summary>

**`ch-kurimanju-expr-joy`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) except the face: change ONLY the face to a very happy face — eyes closed into happy upward arcs (^ ^) and a big open smiling mouth. Arms stay exactly where they are.
```

**`ch-kurimanju-expr-cry`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) except the face: change ONLY the face to Chiikawa's famous crying face — eyes squeezed shut, big wobbly mouth, big tear drops streaming down. Arms stay exactly where they are.
```

**`ch-kurimanju-expr-shock`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) except the face: change ONLY the face to a shocked face — small round wide-open eyes, a small round open mouth, pale cheeks, and three short vertical shock lines just above the head. Arms stay exactly where they are.
```

**`ch-kurimanju-sheet-jump`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A sprite sheet of the attached character (keep its design exactly). Four animation frames of a happy jump, left to right then top to bottom: 1) crouching down ready to jump (knees bent, both feet flat on the floor, not sitting), 2) springing up with arms raised, 3) at the top of the jump, arms up, very happy, 4) landing, slightly squashed. The character is the SAME size in every cell (the head exactly the same size in all four frames) and stands at the same height position inside each cell. Nothing crosses the cell borders. No text, no numbers. Square 1:1, a 2x2 grid of four equal cells with clear magenta gaps between them; flat solid pure magenta background #FF00FF everywhere.
```

**`ch-rakko-noarms`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) and ONLY remove both arms, so the body outline continues smoothly where the arms were. Keep the tail. Do not move or redraw anything else.
```

**`ch-rakko-eyes-closed`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) and ONLY change the eyes to closed eyes (two small gentle downward-curved lines).
```

**`ch-rakko-mouth-open`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) and ONLY change the mouth to a small open mouth, as if talking.
```

**`ch-rakko-expr-joy`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) except the face: change ONLY the face to a very happy face — eyes closed into happy upward arcs (^ ^) and a big open smiling mouth. Arms stay exactly where they are.
```

**`ch-rakko-expr-cry`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) except the face: change ONLY the face to Chiikawa's famous crying face — eyes squeezed shut, big wobbly mouth, big tear drops streaming down. Arms stay exactly where they are.
```

**`ch-rakko-expr-shock`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) except the face: change ONLY the face to a shocked face — small round wide-open eyes, a small round open mouth, pale cheeks, and three short vertical shock lines just above the head. Arms stay exactly where they are.
```

</details>

### 묶음 3 (10장)

| id (파일 이름) | 내용 | 비율 | 참조 |
|---|---|:---:|---|
| `ch-rakko-sheet-jump` | 랏코 점프 4프레임 | 1:1 | `ch-rakko-base` |
| `ch-shisa-noarms` | 시사 팔 없음 | 3:4 | `ch-shisa-base` |
| `ch-shisa-eyes-closed` | 시사 눈 감음 | 3:4 | `ch-shisa-base` |
| `ch-shisa-mouth-open` | 시사 입 벌림 | 3:4 | `ch-shisa-base` |
| `ch-shisa-expr-joy` | 시사 기쁨 | 3:4 | `ch-shisa-base` |
| `ch-shisa-expr-cry` | 시사 울음 | 3:4 | `ch-shisa-base` |
| `ch-shisa-expr-shock` | 시사 놀람 | 3:4 | `ch-shisa-base` |
| `ch-shisa-sheet-jump` | 시사 점프 4프레임 | 1:1 | `ch-shisa-base` |
| `ch-pochette-base` | 포셰트 기본 | 3:4 | `ch-chiikawa-base` + (있으면) 포셰트 참고 그림 |
| `ch-pochette-noarms` | 포셰트 팔 없음 | 3:4 | `ch-pochette-base` |

<details><summary>프롬프트 보기</summary>

**`ch-rakko-sheet-jump`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A sprite sheet of the attached character (keep its design exactly). Four animation frames of a happy jump, left to right then top to bottom: 1) crouching down ready to jump (knees bent, both feet flat on the floor, not sitting), 2) springing up with arms raised, 3) at the top of the jump, arms up, very happy, 4) landing, slightly squashed. The character is the SAME size in every cell (the head exactly the same size in all four frames) and stands at the same height position inside each cell. Nothing crosses the cell borders. No text, no numbers. Square 1:1, a 2x2 grid of four equal cells with clear magenta gaps between them; flat solid pure magenta background #FF00FF everywhere.
```

**`ch-shisa-noarms`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) and ONLY remove both arms, so the body outline continues smoothly where the arms were. Keep the mane. Do not move or redraw anything else.
```

**`ch-shisa-eyes-closed`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) and ONLY change the eyes to closed eyes (two small gentle downward-curved lines).
```

**`ch-shisa-mouth-open`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) and ONLY change the mouth to a small open mouth, as if talking.
```

**`ch-shisa-expr-joy`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) except the face: change ONLY the face to a very happy face — eyes closed into happy upward arcs (^ ^) and a big open smiling mouth. Arms stay exactly where they are.
```

**`ch-shisa-expr-cry`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) except the face: change ONLY the face to Chiikawa's famous crying face — eyes squeezed shut, big wobbly mouth, big tear drops streaming down. Arms stay exactly where they are.
```

**`ch-shisa-expr-shock`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) except the face: change ONLY the face to a shocked face — small round wide-open eyes, a small round open mouth, pale cheeks, and three short vertical shock lines just above the head. Arms stay exactly where they are.
```

**`ch-shisa-sheet-jump`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A sprite sheet of the attached character (keep its design exactly). Four animation frames of a happy jump, left to right then top to bottom: 1) crouching down ready to jump (knees bent, both feet flat on the floor, not sitting), 2) springing up with arms raised, 3) at the top of the jump, arms up, very happy, 4) landing, slightly squashed. The character is the SAME size in every cell (the head exactly the same size in all four frames) and stands at the same height position inside each cell. Nothing crosses the cell borders. No text, no numbers. Square 1:1, a 2x2 grid of four equal cells with clear magenta gaps between them; flat solid pure magenta background #FF00FF everywhere.
```

**`ch-pochette-base`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a small lavender chibi creature with soft drooping pouch-shaped ears and a tiny purple pouch bag on a strap, dot eyes, pink blush, Chiikawa style, standing front view with a calm little smile. Both short arms held slightly away from the body (not touching the body) so they are clearly separate shapes. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). Draw this new character instead of the attached one. Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

**`ch-pochette-noarms`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) and ONLY remove both arms, so the body outline continues smoothly where the arms were. Keep the pouch bag and its strap. Do not move or redraw anything else.
```

</details>

### 묶음 4 (6장)

| id (파일 이름) | 내용 | 비율 | 참조 |
|---|---|:---:|---|
| `ch-pochette-eyes-closed` | 포셰트 눈 감음 | 3:4 | `ch-pochette-base` |
| `ch-pochette-mouth-open` | 포셰트 입 벌림 | 3:4 | `ch-pochette-base` |
| `ch-pochette-expr-joy` | 포셰트 기쁨 | 3:4 | `ch-pochette-base` |
| `ch-pochette-expr-cry` | 포셰트 울음 | 3:4 | `ch-pochette-base` |
| `ch-pochette-expr-shock` | 포셰트 놀람 | 3:4 | `ch-pochette-base` |
| `ch-pochette-sheet-jump` | 포셰트 점프 4프레임 | 1:1 | `ch-pochette-base` |

<details><summary>프롬프트 보기</summary>

**`ch-pochette-eyes-closed`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) and ONLY change the eyes to closed eyes (two small gentle downward-curved lines).
```

**`ch-pochette-mouth-open`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) and ONLY change the mouth to a small open mouth, as if talking.
```

**`ch-pochette-expr-joy`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) except the face: change ONLY the face to a very happy face — eyes closed into happy upward arcs (^ ^) and a big open smiling mouth. Arms stay exactly where they are.
```

**`ch-pochette-expr-cry`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) except the face: change ONLY the face to Chiikawa's famous crying face — eyes squeezed shut, big wobbly mouth, big tear drops streaming down. Arms stay exactly where they are.
```

**`ch-pochette-expr-shock`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same character, same position, same size, same colours, same magenta background, same framing) except the face: change ONLY the face to a shocked face — small round wide-open eyes, a small round open mouth, pale cheeks, and three short vertical shock lines just above the head. Arms stay exactly where they are.
```

**`ch-pochette-sheet-jump`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A sprite sheet of the attached character (keep its design exactly). Four animation frames of a happy jump, left to right then top to bottom: 1) crouching down ready to jump (knees bent, both feet flat on the floor, not sitting), 2) springing up with arms raised, 3) at the top of the jump, arms up, very happy, 4) landing, slightly squashed. The character is the SAME size in every cell (the head exactly the same size in all four frames) and stands at the same height position inside each cell. Nothing crosses the cell borders. No text, no numbers. Square 1:1, a 2x2 grid of four equal cells with clear magenta gaps between them; flat solid pure magenta background #FF00FF everywhere.
```

</details>

## B. 친구(NPC)·반려동물 기본 그림 — 17장 ★★★

모두 `ch-chiikawa-base` 참조 (위치·크기 기준).

### 묶음 5 (10장)

| id (파일 이름) | 내용 | 비율 | 참조 |
|---|---|:---:|---|
| `npc-hamster-base` | 단짝 후보 햄스터 | 3:4 | `ch-chiikawa-base` |
| `npc-duckling-base` | 단짝 후보 오리 | 3:4 | `ch-chiikawa-base` |
| `npc-panda-base` | 단짝 후보 판다 | 3:4 | `ch-chiikawa-base` |
| `npc-squirrel-base` | 단짝 후보 다람쥐 | 3:4 | `ch-chiikawa-base` |
| `npc-lamb-base` | 단짝 후보 아기양 | 3:4 | `ch-chiikawa-base` |
| `npc-frog-base` | 단짝 후보 개구리 | 3:4 | `ch-chiikawa-base` |
| `npc-bear_cub-base` | 단짝 후보 아기곰 | 3:4 | `ch-chiikawa-base` |
| `npc-fox-base` | 단짝 후보 여우 | 3:4 | `ch-chiikawa-base` |
| `npc-owl-base` | 단짝 후보 부엉이 | 3:4 | `ch-chiikawa-base` |
| `pet-goldfish-base` | 반려동물 금붕어 | 3:4 | `ch-chiikawa-base` |

<details><summary>프롬프트 보기</summary>

**`npc-hamster-base`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. An ORIGINAL character (not from the manga): a round chibi hamster with golden fur, a white muzzle and belly, tiny round ears and puffy cheeks, Chiikawa-like simple style, standing front view with a friendly smile, short arms (or flippers / wings) held slightly away from the body. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

**`npc-duckling-base`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. An ORIGINAL character (not from the manga): a round chibi yellow duckling with a small orange bill, a little head tuft and tiny wings, Chiikawa-like simple style, standing front view with a friendly smile, short arms (or flippers / wings) held slightly away from the body. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

**`npc-panda-base`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. An ORIGINAL character (not from the manga): a round chibi panda with black round ears, black eye patches and black arms on white fur, Chiikawa-like simple style, standing front view with a friendly smile, short arms (or flippers / wings) held slightly away from the body. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

**`npc-squirrel-base`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. An ORIGINAL character (not from the manga): a round chibi chipmunk squirrel with orange-brown fur, back stripes, a cream belly and a big bushy tail, Chiikawa-like simple style, standing front view with a friendly smile, short arms (or flippers / wings) held slightly away from the body. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

**`npc-lamb-base`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. An ORIGINAL character (not from the manga): a round chibi lamb with a fluffy cloud-like white fleece, small floppy ears and a beige face, Chiikawa-like simple style, standing front view with a friendly smile, short arms (or flippers / wings) held slightly away from the body. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

**`npc-frog-base`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. An ORIGINAL character (not from the manga): a round chibi green frog with big round eyes on top of the head and a pale belly, Chiikawa-like simple style, standing front view with a friendly smile, short arms (or flippers / wings) held slightly away from the body. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

**`npc-bear_cub-base`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. An ORIGINAL character (not from the manga): a round chibi brown bear cub with round ears and a light muzzle, Chiikawa-like simple style, standing front view with a friendly smile, short arms (or flippers / wings) held slightly away from the body. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

**`npc-fox-base`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. An ORIGINAL character (not from the manga): a round chibi orange fox with big pointed ears, a white muzzle and a fluffy white-tipped tail, Chiikawa-like simple style, standing front view with a friendly smile, short arms (or flippers / wings) held slightly away from the body. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

**`npc-owl-base`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. An ORIGINAL character (not from the manga): a round chibi owl with brown feathers, ear tufts, a cream face disc and big round yellow eyes, Chiikawa-like simple style, standing front view with a friendly smile, short arms (or flippers / wings) held slightly away from the body. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

**`pet-goldfish-base`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A small cute ORIGINAL pet animal (not from the manga): a round chibi orange goldfish with a flowing tail fin and big shiny eyes, simple cute style, front view, sitting or standing, happy. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). It may be a little shorter than the attached character but stands on the same floor line. Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

</details>

### 묶음 6 (7장)

| id (파일 이름) | 내용 | 비율 | 참조 |
|---|---|:---:|---|
| `pet-chick-base` | 반려동물 병아리 | 3:4 | `ch-chiikawa-base` |
| `pet-turtle-base` | 반려동물 거북이 | 3:4 | `ch-chiikawa-base` |
| `pet-hedgehog-base` | 반려동물 고슴도치 | 3:4 | `ch-chiikawa-base` |
| `pet-parrot-base` | 반려동물 앵무새 | 3:4 | `ch-chiikawa-base` |
| `pet-guinea_pig-base` | 반려동물 기니피그 | 3:4 | `ch-chiikawa-base` |
| `pet-puppy-base` | 반려동물 강아지 | 3:4 | `ch-chiikawa-base` |
| `pet-snail-base` | 반려동물 달팽이 | 3:4 | `ch-chiikawa-base` |

<details><summary>프롬프트 보기</summary>

**`pet-chick-base`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A small cute ORIGINAL pet animal (not from the manga): a tiny round chibi yellow chick with a small orange beak and stubby wings, simple cute style, front view, sitting or standing, happy. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). It may be a little shorter than the attached character but stands on the same floor line. Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

**`pet-turtle-base`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A small cute ORIGINAL pet animal (not from the manga): a round chibi green turtle with a patterned shell and a friendly smile, simple cute style, front view, sitting or standing, happy. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). It may be a little shorter than the attached character but stands on the same floor line. Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

**`pet-hedgehog-base`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A small cute ORIGINAL pet animal (not from the manga): a round chibi hedgehog with soft brown spines, a cream face and a tiny black nose, simple cute style, front view, sitting or standing, happy. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). It may be a little shorter than the attached character but stands on the same floor line. Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

**`pet-parrot-base`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A small cute ORIGINAL pet animal (not from the manga): a round chibi green parrot with a yellow face, a red head crest and a curved beak, simple cute style, front view, sitting or standing, happy. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). It may be a little shorter than the attached character but stands on the same floor line. Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

**`pet-guinea_pig-base`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A small cute ORIGINAL pet animal (not from the manga): a round chibi guinea pig with tan and white patches, tiny ears and a pink nose, simple cute style, front view, sitting or standing, happy. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). It may be a little shorter than the attached character but stands on the same floor line. Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

**`pet-puppy-base`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A small cute ORIGINAL pet animal (not from the manga): a round chibi cream puppy with floppy brown ears and a wagging tail, simple cute style, front view, sitting or standing, happy. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). It may be a little shorter than the attached character but stands on the same floor line. Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

**`pet-snail-base`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A small cute ORIGINAL pet animal (not from the manga): a round chibi snail with a pink swirl shell, two eye stalks and a sleepy smile, simple cute style, front view, sitting or standing, happy. Use the attached image ONLY as the size, position and style reference: same art style, same standing pose, same scale and exactly the same position in the frame (feet at the same height, centred). It may be a little shorter than the attached character but stands on the same floor line. Portrait 3:4. ONE character, full body, front view, standing on an invisible floor, centred horizontally. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

</details>

## C. 배경 (치이카와 그림체로) — 32장 ★★★

참조는 전부 `bg-park` (= 테스트 때 만든 `bg-ch-park-2.png`). 예전 애니풍 배경 16장도 이 그림으로 바뀝니다.

### 묶음 7 (10장)

| id (파일 이름) | 내용 | 비율 | 참조 |
|---|---|:---:|---|
| `bg-school` | 배경 · 학교 | 16:9 | `bg-park` |
| `bg-mountain-trail` | 배경 · 산길 | 16:9 | `bg-park` |
| `bg-office` | 배경 · 회사 | 16:9 | `bg-park` |
| `bg-hospital` | 배경 · 병원 | 16:9 | `bg-park` |
| `bg-studio` | 배경 · 방송국 스튜디오 | 16:9 | `bg-park` |
| `bg-stage` | 배경 · 무대 | 16:9 | `bg-park` |
| `bg-stadium` | 배경 · 경기장 | 16:9 | `bg-park` |
| `bg-gym` | 배경 · 체육관 | 16:9 | `bg-park` |
| `bg-army` | 배경 · 훈련소 | 16:9 | `bg-park` |
| `bg-campus` | 배경 · 대학 졸업식 | 16:9 | `bg-park` |

<details><summary>프롬프트 보기</summary>

**`bg-school`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a cosy elementary school classroom with small wooden desks, a green chalkboard with doodles, big windows with cherry blossoms outside. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

**`bg-mountain-trail`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a gentle mountain trail with stone steps, round pine trees, wildflowers and soft distant mountains. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

**`bg-office`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a cosy small office with desks, computers, potted plants and a big window with a city view. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

**`bg-hospital`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a clean bright hospital ward with a bed, light green curtains, a small reception counter and a green cross sign. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

**`bg-studio`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a cheerful TV variety show studio with a host desk on the left, colourful stage lights, a big screen with stars and a shiny floor. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

**`bg-stage`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a concert stage with spotlights, red curtains, sparkles and empty audience seats. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

**`bg-stadium`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a sports stadium with a green field, white lines, empty stands and a scoreboard. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

**`bg-gym`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a martial arts gym with soft mats, punching bags, a ring rope and banners. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

**`bg-army`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a military training camp ground with a dirt field, green tents, flags and a small watchtower. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

**`bg-campus`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a university campus on graduation day with a big gate, blooming trees and graduation caps flying in the sky. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

</details>

### 묶음 8 (10장)

| id (파일 이름) | 내용 | 비율 | 참조 |
|---|---|:---:|---|
| `bg-kitchen` | 배경 · 식당 주방 | 16:9 | `bg-park` |
| `bg-police` | 배경 · 경찰서 | 16:9 | `bg-park` |
| `bg-lab` | 배경 · 연구실 | 16:9 | `bg-park` |
| `bg-space` | 배경 · 우주 발사장 | 16:9 | `bg-park` |
| `bg-shop` | 배경 · 동네 마트 | 16:9 | `bg-park` |
| `bg-holiday` | 배경 · 명절 거실 | 16:9 | `bg-park` |
| `bg-house` | 배경 · 우리 집(집들이) | 16:9 | `bg-park` |
| `bg-hometown` | 배경 · 고향 시골집 | 16:9 | `bg-park` |
| `bg-temple` | 배경 · 산사 | 16:9 | `bg-park` |
| `bg-jeju` | 배경 · 제주도 | 16:9 | `bg-park` |

<details><summary>프롬프트 보기</summary>

**`bg-kitchen`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a restaurant kitchen with pots on the stove, hanging ladles, shelves of ingredients and steam. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

**`bg-police`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a small neighbourhood police station with a counter, a map board and a blue-and-white sign. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

**`bg-lab`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a research laboratory with colourful flasks, a microscope, a whiteboard with formulas and shelves. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

**`bg-space`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a rocket launch site at dusk with a white rocket on a gantry, stars appearing in a purple sky. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

**`bg-shop`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a small neighbourhood mart with shelves of snacks and drinks, a counter with a cash register and colourful price tags. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

**`bg-holiday`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a Korean living room on a holiday (Seollal / Chuseok) with a low table full of dishes, a folding screen (byeongpung) and floor cushions. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

**`bg-house`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a cosy small house living room decorated for a housewarming party, with a sofa, a rug, plants, warm lamps, balloons and a garland. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

**`bg-hometown`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a peaceful countryside village with a traditional Korean house (hanok roof), a persimmon tree, fields and a stone wall. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

**`bg-temple`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a quiet Korean mountain temple courtyard with a stone pagoda, colourful lanterns and a big bell pavilion. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

**`bg-jeju`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a Jeju island seaside with dol-hareubang stone statues, yellow canola flowers, a turquoise sea and Hallasan mountain far away. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

</details>

### 묶음 9 (10장)

| id (파일 이름) | 내용 | 비율 | 참조 |
|---|---|:---:|---|
| `bg-casino` | 배경 · 인생역전섬 | 16:9 | `bg-park` |
| `bg-weed-field` | 배경 · 풀밭 (풀뽑기 검정) | 16:9 | `bg-park` |
| `bg-hunt-forest` | 배경 · 토벌 숲 | 16:9 | `bg-park` |
| `bg-ramen-shop` | 배경 · 라멘 가게 「郎」 | 16:9 | `bg-park` |
| `bg-workshop` | 배경 · 갑옷씨 공방 | 16:9 | `bg-park` |
| `bg-sento` | 배경 · 목욕탕 | 16:9 | `bg-park` |
| `bg-bookstore` | 배경 · 고서점 | 16:9 | `bg-park` |
| `bg-cafe` | 배경 · 카페 | 16:9 | `bg-park` |
| `bg-kuji` | 배경 · 쿠지 가게 | 16:9 | `bg-park` |
| `bg-island` | 배경 · 한방역전섬 (노년) | 16:9 | `bg-park` |

<details><summary>프롬프트 보기</summary>

**`bg-casino`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a playful 'life reversal island' fairground with a toy-like horse race track, colourful flags, a big lottery wheel and lights. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text. Leave open empty ground in the lower centre for characters to stand.
```

**`bg-weed-field`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a sunny grassy field full of tall weeds, clover and little flowers, a low wooden fence, a small woven basket of pulled weeds, a pale blue sky with fluffy clouds. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text, no letters. Leave open empty ground in the lower centre for characters to stand.
```

**`bg-hunt-forest`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a slightly mysterious but cute forest clearing: tall round dark-green trees, bushes with two little glowing eyes peeking out, red-capped mushrooms, a narrow dirt path, soft light beams through the leaves. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text, no letters. Leave open empty ground in the lower centre for characters to stand.
```

**`bg-ramen-shop`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a cozy small ramen shop interior: a wooden counter with steaming ramen bowls, a short yellow noren curtain at the top, round paper lanterns, a warm dark-brown wall. (If you add the noren, it may show the single kanji 郎; no other text.) Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text, no letters. Leave open empty ground in the lower centre for characters to stand.
```

**`bg-workshop`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a small armor-maker workshop: a wooden workbench with hammers and tongs, a few rounded helmets and armor plates on shelves, a little anvil, warm light from a window. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text, no letters. Leave open empty ground in the lower centre for characters to stand.
```

**`bg-sento`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a traditional public bathhouse (sento) interior: a big tiled bath with steam, a mountain mural painted on the wall, small wooden buckets and stools, pale blue tiles. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text, no letters. Leave open empty ground in the lower centre for characters to stand.
```

**`bg-bookstore`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a quiet old secondhand bookstore: tall wooden shelves packed with books, small piles of old books on the floor, a little counter with a desk lamp, warm cosy light. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text, no letters. Leave open empty ground in the lower centre for characters to stand.
```

**`bg-cafe`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a cute small cafe interior: a counter with a coffee machine and cakes in a glass case, round tables, potted plants, a big window with soft daylight. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text, no letters. Leave open empty ground in the lower centre for characters to stand.
```

**`bg-kuji`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a cheerful prize-draw (kuji) shop counter: a big red box with a hole on top, prize shelves behind it with a giant plush toy, gift boxes, cards and a ramen coupon, a striped awning. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text, no letters. Leave open empty ground in the lower centre for characters to stand.
```

**`bg-island`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a small tropical gamble island under a bright sky: palm trees, a giant colourful roulette wheel standing on the sandy beach, a little wooden pier with a tiny boat, a sparkling sea, paper lanterns and a few confetti pieces in the air. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text, no letters. Leave open empty ground in the lower centre for characters to stand.
```

</details>

### 묶음 10 (2장)

| id (파일 이름) | 내용 | 비율 | 참조 |
|---|---|:---:|---|
| `bg-farm` | 배경 · 빈곤 농장 (쪽박) | 16:9 | `bg-park` |
| `bg-auction` | 배경 · 골동품 경매장 (노년) | 16:9 | `bg-park` |

<details><summary>프롬프트 보기</summary>

**`bg-farm`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a humble but cozy little farm: a small wooden shack, a muddy potato field with a few sprouts, a funny scarecrow, a rusty watering can and a grey drizzly sky — slightly sad but funny. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text, no letters. Leave open empty ground in the lower centre for characters to stand.
```

**`bg-auction`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a warm small antique auction hall: a wooden podium with a gavel, red velvet curtains, a few rows of little chairs, display stands with old vases, clocks and framed paintings, soft spotlights. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text, no letters. Leave open empty ground in the lower centre for characters to stand.
```

</details>

## D. MC 호야·봄이 (치이카와 그림체로) — 25장 ★★☆

첫 두 장이 기준 그림입니다. 호야·봄이 실제 사진(사용자 PC) + `ch-chiikawa-base`를 같이 첨부하세요. 나머지는 그 두 장을 참조로 쓰는 편집이에요.

### 묶음 11 (10장)

| id (파일 이름) | 내용 | 비율 | 참조 |
|---|---|:---:|---|
| `mc-hoya-neutral` | 호야 기본 | 1:1 | `hoya 사진 1~2장` + `ch-chiikawa-base` |
| `mc-bomi-neutral` | 봄이 기본 | 1:1 | `bomi 사진 1~2장` + `ch-chiikawa-base` |
| `mc-hoya-eyes-closed` | 호야 눈 감음(깜빡임) | 1:1 | `mc-hoya-neutral` |
| `mc-hoya-mouth-open` | 호야 입 벌림(말하기) | 1:1 | `mc-hoya-neutral` |
| `mc-hoya-joy` | 호야 기쁨 | 1:1 | `mc-hoya-neutral` |
| `mc-hoya-surprise` | 호야 놀람 | 1:1 | `mc-hoya-neutral` |
| `mc-hoya-sad` | 호야 슬픔 | 1:1 | `mc-hoya-neutral` |
| `mc-hoya-angry` | 호야 화남 | 1:1 | `mc-hoya-neutral` |
| `mc-hoya-proud` | 호야 자신만만 | 1:1 | `mc-hoya-neutral` |
| `mc-hoya-sleepy` | 호야 졸림 | 1:1 | `mc-hoya-neutral` |

<details><summary>프롬프트 보기</summary>

**`mc-hoya-neutral`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. Redraw this real dog as a character of the Chiikawa world: the same round chubby chibi body shape, simple shapes, line style and dot eyes as the attached Chiikawa image, but keep the dog's own fur markings, colours and accessory exactly as described. HOYA, a boy Shih Tzu dog, the older brother, as a cute chibi TV-show mascot. Coat: almost entirely white and very fluffy, with a slightly creamy beige tint on top of the head; floppy ears that are dark brown-black with a warm tan patch where they join the head; light tan / caramel fur around both eyes; big round shiny dark eyes; small black button nose; short white beard; slight underbite with the pink tip of the tongue peeking out; goofy, cheerful, slightly derpy face. Wears a small orange bandana scarf around the neck. Huge round fluffy head, small round body, short legs, white fluffy plume tail. Default face: open happy eyes, mouth slightly open with the tongue tip out, relaxed sitting pose. Square 1:1. ONE character, full body, sitting upright facing the viewer, centred with generous margin on every side, bottom of the body at about 85 % of the height. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

**`mc-bomi-neutral`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. Redraw this real dog as a character of the Chiikawa world: the same round chubby chibi body shape, simple shapes, line style and dot eyes as the attached Chiikawa image, but keep the dog's own fur markings, colours and accessory exactly as described. BOMI, a girl Shih Tzu dog, the younger sister, as a cute chibi TV-show mascot with a black-and-white coat: the sides of the head, both long floppy ears and a large mask around BOTH eyes are black; a clear white blaze stripe runs from between the eyes up the middle of the forehead to the top of the head; white muzzle with a slightly grey-beige beard and chin; white chest and white front legs; black back and shoulders; small black speckles on the white front paws; big round dark eyes; black nose; calm, serious, slightly grumpy "unimpressed" face. Wears a small purple bow tie. Huge round head, small round body, short legs, fluffy tail. Default face: calm half-lidded unimpressed eyes, mouth closed, relaxed dignified sitting pose. Square 1:1. ONE character, full body, sitting upright facing the viewer, centred with generous margin on every side, bottom of the body at about 85 % of the height. Flat solid pure magenta background #FF00FF filling the whole image. No floor, no shadow, no other objects.
```

**`mc-hoya-eyes-closed`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same dog, same markings, same position, same size, same colours, same accessory, same magenta background, same framing) and ONLY change the eyes to closed eyes (two small gentle downward-curved lines).
```

**`mc-hoya-mouth-open`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same dog, same markings, same position, same size, same colours, same accessory, same magenta background, same framing) and ONLY change the mouth to an open mouth, as if talking.
```

**`mc-hoya-joy`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same dog, same markings, same position, same size, same colours, same accessory, same magenta background, same framing) except for this change: Overjoyed: eyes closed in happy upward arcs, wide open smiling mouth, ears lifted, tail wagging. Keep the Chiikawa-style chibi look.
```

**`mc-hoya-surprise`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same dog, same markings, same position, same size, same colours, same accessory, same magenta background, same framing) except for this change: Surprised: eyes wide open with small pupils, round O-shaped mouth, ears flipped up, a small sweat drop. Keep the Chiikawa-style chibi look.
```

**`mc-hoya-sad`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same dog, same markings, same position, same size, same colours, same accessory, same magenta background, same framing) except for this change: Sad: glossy teary eyes with one tear, droopy ears, small frown, head slightly lowered. Keep the Chiikawa-style chibi look.
```

**`mc-hoya-angry`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same dog, same markings, same position, same size, same colours, same accessory, same magenta background, same framing) except for this change: Cute grumpy anger: furrowed brows, puffed cheeks, a small red anger mark, looking sideways with a huff. Keep the Chiikawa-style chibi look.
```

**`mc-hoya-proud`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same dog, same markings, same position, same size, same colours, same accessory, same magenta background, same framing) except for this change: Proud and smug: eyes closed confidently, nose up, chest out, a small sparkle next to the head. Keep the Chiikawa-style chibi look.
```

**`mc-hoya-sleepy`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same dog, same markings, same position, same size, same colours, same accessory, same magenta background, same framing) except for this change: Sleepy: droopy half-closed eyes, a big yawn, slouched, a small "Zz" bubble shape (no letters needed). Keep the Chiikawa-style chibi look.
```

</details>

### 묶음 12 (10장)

| id (파일 이름) | 내용 | 비율 | 참조 |
|---|---|:---:|---|
| `mc-hoya-pose-wave` | 호야 손 흔들기 | 1:1 | `mc-hoya-neutral` |
| `mc-hoya-pose-clap` | 호야 박수 | 1:1 | `mc-hoya-neutral` |
| `mc-hoya-pose-mic` | 호야 마이크 | 1:1 | `mc-hoya-neutral` |
| `mc-bomi-eyes-closed` | 봄이 눈 감음(깜빡임) | 1:1 | `mc-bomi-neutral` |
| `mc-bomi-mouth-open` | 봄이 입 벌림(말하기) | 1:1 | `mc-bomi-neutral` |
| `mc-bomi-joy` | 봄이 기쁨 | 1:1 | `mc-bomi-neutral` |
| `mc-bomi-surprise` | 봄이 놀람 | 1:1 | `mc-bomi-neutral` |
| `mc-bomi-sad` | 봄이 슬픔 | 1:1 | `mc-bomi-neutral` |
| `mc-bomi-angry` | 봄이 화남 | 1:1 | `mc-bomi-neutral` |
| `mc-bomi-proud` | 봄이 자신만만 | 1:1 | `mc-bomi-neutral` |

<details><summary>프롬프트 보기</summary>

**`mc-hoya-pose-wave`**

```text
Keep exactly the same dog design, markings, colours, accessory, size and position in the frame as the attached image, and the same Chiikawa-style chibi look, but change the pose. Pose: waving one front paw high in greeting, the other paw on the ground, friendly face. Flat solid pure magenta background #FF00FF.
```

**`mc-hoya-pose-clap`**

```text
Keep exactly the same dog design, markings, colours, accessory, size and position in the frame as the attached image, and the same Chiikawa-style chibi look, but change the pose. Pose: sitting up on the hind legs and clapping both front paws together in front of the chest, happy face. Flat solid pure magenta background #FF00FF.
```

**`mc-hoya-pose-mic`**

```text
Keep exactly the same dog design, markings, colours, accessory, size and position in the frame as the attached image, and the same Chiikawa-style chibi look, but change the pose. Pose: holding a small black handheld microphone with one front paw near the mouth like a TV show host. Flat solid pure magenta background #FF00FF.
```

**`mc-bomi-eyes-closed`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same dog, same markings, same position, same size, same colours, same accessory, same magenta background, same framing) and ONLY change the eyes to closed eyes (two small gentle downward-curved lines).
```

**`mc-bomi-mouth-open`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same dog, same markings, same position, same size, same colours, same accessory, same magenta background, same framing) and ONLY change the mouth to an open mouth, as if talking.
```

**`mc-bomi-joy`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same dog, same markings, same position, same size, same colours, same accessory, same magenta background, same framing) except for this change: Overjoyed: eyes closed in happy upward arcs, wide open smiling mouth, ears lifted, tail wagging. Keep the Chiikawa-style chibi look.
```

**`mc-bomi-surprise`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same dog, same markings, same position, same size, same colours, same accessory, same magenta background, same framing) except for this change: Surprised: eyes wide open with small pupils, round O-shaped mouth, ears flipped up, a small sweat drop. Keep the Chiikawa-style chibi look.
```

**`mc-bomi-sad`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same dog, same markings, same position, same size, same colours, same accessory, same magenta background, same framing) except for this change: Sad: glossy teary eyes with one tear, droopy ears, small frown, head slightly lowered. Keep the Chiikawa-style chibi look.
```

**`mc-bomi-angry`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same dog, same markings, same position, same size, same colours, same accessory, same magenta background, same framing) except for this change: Cute grumpy anger: furrowed brows, puffed cheeks, a small red anger mark, looking sideways with a huff. Keep the Chiikawa-style chibi look.
```

**`mc-bomi-proud`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same dog, same markings, same position, same size, same colours, same accessory, same magenta background, same framing) except for this change: Proud and smug: eyes closed confidently, nose up, chest out, a small sparkle next to the head. Keep the Chiikawa-style chibi look.
```

</details>

### 묶음 13 (5장)

| id (파일 이름) | 내용 | 비율 | 참조 |
|---|---|:---:|---|
| `mc-bomi-sleepy` | 봄이 졸림 | 1:1 | `mc-bomi-neutral` |
| `mc-bomi-pose-wave` | 봄이 손 흔들기 | 1:1 | `mc-bomi-neutral` |
| `mc-bomi-pose-clap` | 봄이 박수 | 1:1 | `mc-bomi-neutral` |
| `mc-bomi-pose-mic` | 봄이 마이크 | 1:1 | `mc-bomi-neutral` |
| `mc-duo` | 호야·봄이 같이 | 16:9 | `mc-hoya-neutral` + `mc-bomi-neutral` |

<details><summary>프롬프트 보기</summary>

**`mc-bomi-sleepy`**

```text
Edit the attached image. Keep EVERYTHING exactly the same (same dog, same markings, same position, same size, same colours, same accessory, same magenta background, same framing) except for this change: Sleepy: droopy half-closed eyes, a big yawn, slouched, a small "Zz" bubble shape (no letters needed). Keep the Chiikawa-style chibi look.
```

**`mc-bomi-pose-wave`**

```text
Keep exactly the same dog design, markings, colours, accessory, size and position in the frame as the attached image, and the same Chiikawa-style chibi look, but change the pose. Pose: waving one front paw high in greeting, the other paw on the ground, friendly face. Flat solid pure magenta background #FF00FF.
```

**`mc-bomi-pose-clap`**

```text
Keep exactly the same dog design, markings, colours, accessory, size and position in the frame as the attached image, and the same Chiikawa-style chibi look, but change the pose. Pose: sitting up on the hind legs and clapping both front paws together in front of the chest, happy face. Flat solid pure magenta background #FF00FF.
```

**`mc-bomi-pose-mic`**

```text
Keep exactly the same dog design, markings, colours, accessory, size and position in the frame as the attached image, and the same Chiikawa-style chibi look, but change the pose. Pose: holding a small black handheld microphone with one front paw near the mouth like a TV show host. Flat solid pure magenta background #FF00FF.
```

**`mc-duo`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. The two attached dogs together as TV variety show hosts in the Chiikawa world: on the left HOYA (the older brother, goofy and cheerful, waving), on the right BOMI (the younger sister, calm and slightly unimpressed, holding a small microphone). Keep each dog's design exactly as in the attached images, same size as each other, standing side by side, centred with generous margin on both sides. Landscape 16:9, flat solid pure magenta background #FF00FF, no floor, no shadow, no text.
```

</details>

## E. 소품 (캐릭터가 쓰는 모자·안경·손에 드는 것·등에 메는 것) — 69장 ★★☆

흰 배경, 물건만 따로. 앞쪽 30개가 로비에서 고르는 소품이고, 나머지는 시대·직업 소품이에요.

### 묶음 14 (10장)

| id (파일 이름) | 내용 | 비율 | 참조 |
|---|---|:---:|---|
| `prop-ribbon` | 소품 · 머리 · 리본 | 1:1 | 없음 |
| `prop-flower-pin` | 소품 · 머리 · 꽃핀 | 1:1 | 없음 |
| `prop-beanie` | 소품 · 머리 · 비니 | 1:1 | 없음 |
| `prop-straw-hat` | 소품 · 머리 · 밀짚모자 | 1:1 | 없음 |
| `prop-crown` | 소품 · 머리 · 왕관 | 1:1 | 없음 |
| `prop-headband` | 소품 · 머리 · 하트 머리띠 | 1:1 | 없음 |
| `prop-beret` | 소품 · 머리 · 베레모 | 1:1 | 없음 |
| `prop-party-hat` | 소품 · 머리 · 고깔모자 | 1:1 | 없음 |
| `prop-flower-crown` | 소품 · 머리 · 화관 | 1:1 | 없음 |
| `prop-round-glasses` | 소품 · 얼굴 · 동그란 안경 | 1:1 | 없음 |

<details><summary>프롬프트 보기</summary>

**`prop-ribbon`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a big soft bow ribbon on top of the head, main colour #ff7eb6. Drawn ALONE (no character, no head): front view, exactly as it would sit on top of a small round head, bottom edge gently curved to fit the head. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-flower-pin`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a small pink flower hair pin on one side of the head, main colour #ff9ec7. Drawn ALONE (no character, no head): front view, exactly as it would sit on top of a small round head, bottom edge gently curved to fit the head. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-beanie`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a snug knitted beanie with a little pompom, main colour #7aa7e0. Drawn ALONE (no character, no head): front view, exactly as it would sit on top of a small round head, bottom edge gently curved to fit the head. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-straw-hat`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a round straw sun hat with a red band, main colour #e8c872. Drawn ALONE (no character, no head): front view, exactly as it would sit on top of a small round head, bottom edge gently curved to fit the head. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-crown`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a tiny golden crown with three points and jewels, main colour #f5c542. Drawn ALONE (no character, no head): front view, exactly as it would sit on top of a small round head, bottom edge gently curved to fit the head. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-headband`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a headband with a small red heart on a spring, main colour #ff5a7a. Drawn ALONE (no character, no head): front view, exactly as it would sit on top of a small round head, bottom edge gently curved to fit the head. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-beret`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a soft tilted artist beret, main colour #c0504d. Drawn ALONE (no character, no head): front view, exactly as it would sit on top of a small round head, bottom edge gently curved to fit the head. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-party-hat`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a striped cone party hat with a pompom on top, main colour #8ad0f0. Drawn ALONE (no character, no head): front view, exactly as it would sit on top of a small round head, bottom edge gently curved to fit the head. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-flower-crown`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a ring of small colourful flowers worn like a crown, main colour #ffb3d1. Drawn ALONE (no character, no head): front view, exactly as it would sit on top of a small round head, bottom edge gently curved to fit the head. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-round-glasses`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. round thin-rimmed glasses, main colour #5b4a44. Drawn ALONE (no character, no face): front view, exactly as it would be worn on the face. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

</details>

### 묶음 15 (10장)

| id (파일 이름) | 내용 | 비율 | 참조 |
|---|---|:---:|---|
| `prop-sunglasses` | 소품 · 얼굴 · 선글라스 | 1:1 | 없음 |
| `prop-star-glasses` | 소품 · 얼굴 · 별 안경 | 1:1 | 없음 |
| `prop-mask` | 소품 · 얼굴 · 마스크 | 1:1 | 없음 |
| `prop-heart-sticker` | 소품 · 얼굴 · 하트 볼스티커 | 1:1 | 없음 |
| `prop-bow-tie` | 소품 · 목 · 나비넥타이 | 1:1 | 없음 |
| `prop-scarf` | 소품 · 목 · 목도리 | 1:1 | 없음 |
| `prop-bell-collar` | 소품 · 목 · 방울 목걸이 | 1:1 | 없음 |
| `prop-bandana` | 소품 · 목 · 반다나 | 1:1 | 없음 |
| `prop-necklace` | 소품 · 목 · 진주 목걸이 | 1:1 | 없음 |
| `prop-balloon` | 소품 · 손 · 풍선 | 1:1 | 없음 |

<details><summary>프롬프트 보기</summary>

**`prop-sunglasses`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. small black sunglasses, main colour #2a2a2a. Drawn ALONE (no character, no face): front view, exactly as it would be worn on the face. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-star-glasses`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. yellow star-shaped party glasses, main colour #ffd43b. Drawn ALONE (no character, no face): front view, exactly as it would be worn on the face. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-mask`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a small white face mask over the mouth, main colour #f4f6f8. Drawn ALONE (no character, no face): front view, exactly as it would be worn on the face. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-heart-sticker`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. two little pink heart stickers on the cheeks, main colour #ff8fb1. Drawn ALONE (no character, no face): front view, exactly as it would be worn on the face. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-bow-tie`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a small red bow tie at the neck, main colour #e2453c. Drawn ALONE (no character, no body): front view, exactly as it would be worn around a short neck / on the chest. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-scarf`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a cosy knitted scarf wrapped around the neck, main colour #e86a5a. Drawn ALONE (no character, no body): front view, exactly as it would be worn around a short neck / on the chest. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-bell-collar`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a ribbon collar with a little golden bell, main colour #f5c542. Drawn ALONE (no character, no body): front view, exactly as it would be worn around a short neck / on the chest. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-bandana`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a triangle bandana tied around the neck, main colour #e8743b. Drawn ALONE (no character, no body): front view, exactly as it would be worn around a short neck / on the chest. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-necklace`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a short pearl necklace, main colour #f3efe6. Drawn ALONE (no character, no body): front view, exactly as it would be worn around a short neck / on the chest. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-balloon`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a round balloon on a string held in one hand, main colour #ff6b8a. Drawn ALONE (no character, no hand): a small item standing upright, as it would be held in one little paw. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

</details>

### 묶음 16 (10장)

| id (파일 이름) | 내용 | 비율 | 참조 |
|---|---|:---:|---|
| `prop-flower` | 소품 · 손 · 꽃 한 송이 | 1:1 | 없음 |
| `prop-lollipop` | 소품 · 손 · 막대사탕 | 1:1 | 없음 |
| `prop-wand` | 소품 · 손 · 요술봉 | 1:1 | 없음 |
| `prop-fishing-rod` | 소품 · 손 · 낚싯대 | 1:1 | 없음 |
| `prop-book` | 소품 · 손 · 책 | 1:1 | 없음 |
| `prop-umbrella` | 소품 · 손 · 우산 | 1:1 | 없음 |
| `prop-backpack` | 소품 · 등 · 작은 배낭 | 1:1 | 없음 |
| `prop-cape` | 소품 · 등 · 망토 | 1:1 | 없음 |
| `prop-wings` | 소품 · 등 · 천사 날개 | 1:1 | 없음 |
| `prop-teddy-bag` | 소품 · 등 · 곰인형 가방 | 1:1 | 없음 |

<details><summary>프롬프트 보기</summary>

**`prop-flower`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a single tulip held in one hand, main colour #ff7aa8. Drawn ALONE (no character, no hand): a small item standing upright, as it would be held in one little paw. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-lollipop`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a big swirl lollipop held in one hand, main colour #ff9ad5. Drawn ALONE (no character, no hand): a small item standing upright, as it would be held in one little paw. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-wand`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a toy magic wand with a star tip, main colour #ffd43b. Drawn ALONE (no character, no hand): a small item standing upright, as it would be held in one little paw. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-fishing-rod`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a small bamboo fishing rod, main colour #b08a5a. Drawn ALONE (no character, no hand): a small item standing upright, as it would be held in one little paw. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-book`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a small open book held in one hand, main colour #5a8ad8. Drawn ALONE (no character, no hand): a small item standing upright, as it would be held in one little paw. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-umbrella`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a small round umbrella held over the head, main colour #7ec8e3. Drawn ALONE (no character, no hand): a small item standing upright, as it would be held in one little paw. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-backpack`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a tiny round backpack on the back, main colour #f2a65a. Drawn ALONE (no character, no body): front view of the item as worn on the back, so its edges would peek out from behind a small round character. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-cape`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a short hero cape flowing behind, main colour #d94a6a. Drawn ALONE (no character, no body): front view of the item as worn on the back, so its edges would peek out from behind a small round character. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-wings`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. two small white angel wings on the back, main colour #ffffff. Drawn ALONE (no character, no body): front view of the item as worn on the back, so its edges would peek out from behind a small round character. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-teddy-bag`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a teddy-bear shaped backpack, main colour #b07a4e. Drawn ALONE (no character, no body): front view of the item as worn on the back, so its edges would peek out from behind a small round character. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

</details>

### 묶음 17 (10장)

| id (파일 이름) | 내용 | 비율 | 참조 |
|---|---|:---:|---|
| `prop-sasumata` | 소품 · 손 · 사스마타 | 1:1 | 없음 |
| `prop-armor-helmet` | 소품 · 머리 · 갑옷 투구 | 1:1 | 없음 |
| `prop-guitar` | 소품 · 등 · 기타 | 1:1 | 없음 |
| `prop-head-towel` | 소품 · 머리 · 머리 수건 | 1:1 | 없음 |
| `prop-bonnet` | 소품 · 머리 · 아기 보닛 | 1:1 | 없음 |
| `prop-pacifier` | 소품 · 얼굴 · 쪽쪽이 | 1:1 | 없음 |
| `prop-yellow-hat` | 소품 · 머리 · 노란 학교 모자 | 1:1 | 없음 |
| `prop-school-backpack` | 소품 · 등 · 책가방 | 1:1 | 없음 |
| `prop-school-cap` | 소품 · 머리 · 교모 | 1:1 | 없음 |
| `prop-knit-cap` | 소품 · 머리 · 털모자 | 1:1 | 없음 |

<details><summary>프롬프트 보기</summary>

**`prop-sasumata`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a sasumata: a long wooden pole with a U-shaped metal fork at the top, standing upright. A small game costume prop with a thin warm-grey outline. Square 1:1. One object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-armor-helmet`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a small rounded grey metal knight helmet without a face visor, with a small red plume on top. A small game costume prop with a thin warm-grey outline. Square 1:1. One object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-guitar`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a small acoustic guitar with a strap, seen from the back as if worn on the back. A small game costume prop with a thin warm-grey outline. Square 1:1. One object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-head-towel`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a white towel tied around as a headband with a knot on the side (like a ramen cook). A small game costume prop with a thin warm-grey outline. Square 1:1. One object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-bonnet`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a frilly baby bonnet tied under the chin, main colour #fbe3ee. Drawn ALONE (no character, no head): front view, exactly as it would sit on top of a small round head, bottom edge gently curved to fit the head. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-pacifier`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a baby pacifier in the mouth, main colour #8ad0f0. Drawn ALONE (no character, no face): front view, exactly as it would be worn on the face. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-yellow-hat`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a yellow elementary-school safety cap, main colour #ffd23f. Drawn ALONE (no character, no head): front view, exactly as it would sit on top of a small round head, bottom edge gently curved to fit the head. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-school-backpack`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a boxy school backpack (randoseru style), main colour #c0392b. Drawn ALONE (no character, no body): front view of the item as worn on the back, so its edges would peek out from behind a small round character. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-school-cap`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a navy school uniform cap with a badge, main colour #2c3e66. Drawn ALONE (no character, no head): front view, exactly as it would sit on top of a small round head, bottom edge gently curved to fit the head. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-knit-cap`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a warm knitted cap with ear flaps, main colour #c0504d. Drawn ALONE (no character, no head): front view, exactly as it would sit on top of a small round head, bottom edge gently curved to fit the head. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

</details>

### 묶음 18 (10장)

| id (파일 이름) | 내용 | 비율 | 참조 |
|---|---|:---:|---|
| `prop-cane` | 소품 · 손 · 지팡이 | 1:1 | 없음 |
| `prop-necktie` | 소품 · 목 · 넥타이 | 1:1 | 없음 |
| `prop-id-card` | 소품 · 목 · 사원증 | 1:1 | 없음 |
| `prop-pen` | 소품 · 손 · 펜 | 1:1 | 없음 |
| `prop-sash` | 소품 · 목 · 어깨띠 | 1:1 | 없음 |
| `prop-baseball-cap` | 소품 · 머리 · 야구모자 | 1:1 | 없음 |
| `prop-bat` | 소품 · 손 · 야구방망이 | 1:1 | 없음 |
| `prop-soccer-ball` | 소품 · 손 · 축구공 | 1:1 | 없음 |
| `prop-headset` | 소품 · 머리 · 게이밍 헤드셋 | 1:1 | 없음 |
| `prop-fighter-headband` | 소품 · 머리 · 필승 머리띠 | 1:1 | 없음 |

<details><summary>프롬프트 보기</summary>

**`prop-cane`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a short wooden walking cane, main colour #8a5a32. Drawn ALONE (no character, no hand): a small item standing upright, as it would be held in one little paw. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-necktie`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a neat office necktie, main colour #3b5ba5. Drawn ALONE (no character, no body): front view, exactly as it would be worn around a short neck / on the chest. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-id-card`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. an ID card on a lanyard around the neck, main colour #4a90d9. Drawn ALONE (no character, no body): front view, exactly as it would be worn around a short neck / on the chest. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-pen`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a drawing pen, main colour #333333. Drawn ALONE (no character, no hand): a small item standing upright, as it would be held in one little paw. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-sash`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a white election sash across the body, main colour #ffffff. Drawn ALONE (no character, no body): front view, exactly as it would be worn around a short neck / on the chest. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-baseball-cap`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a baseball cap, main colour #2f5fb3. Drawn ALONE (no character, no head): front view, exactly as it would sit on top of a small round head, bottom edge gently curved to fit the head. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-bat`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a wooden baseball bat, main colour #c8945a. Drawn ALONE (no character, no hand): a small item standing upright, as it would be held in one little paw. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-soccer-ball`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a soccer ball held in one arm, main colour #ffffff. Drawn ALONE (no character, no hand): a small item standing upright, as it would be held in one little paw. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-headset`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a gaming headset with a mic, main colour #333a44. Drawn ALONE (no character, no head): front view, exactly as it would sit on top of a small round head, bottom edge gently curved to fit the head. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-fighter-headband`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a white fighting headband with a red circle, main colour #ffffff. Drawn ALONE (no character, no head): front view, exactly as it would sit on top of a small round head, bottom edge gently curved to fit the head. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

</details>

### 묶음 19 (10장)

| id (파일 이름) | 내용 | 비율 | 참조 |
|---|---|:---:|---|
| `prop-script` | 소품 · 손 · 대본 | 1:1 | 없음 |
| `prop-mic` | 소품 · 손 · 마이크 | 1:1 | 없음 |
| `prop-camera` | 소품 · 손 · 카메라 | 1:1 | 없음 |
| `prop-head-mirror` | 소품 · 머리 · 이마 반사경 | 1:1 | 없음 |
| `prop-stethoscope` | 소품 · 목 · 청진기 | 1:1 | 없음 |
| `prop-flask` | 소품 · 손 · 플라스크 | 1:1 | 없음 |
| `prop-police-cap` | 소품 · 머리 · 경찰 모자 | 1:1 | 없음 |
| `prop-key-ring` | 소품 · 손 · 열쇠 꾸러미 | 1:1 | 없음 |
| `prop-sparkle-mic` | 소품 · 손 · 반짝이 마이크 | 1:1 | 없음 |
| `prop-space-helmet` | 소품 · 머리 · 우주 헬멧 | 1:1 | 없음 |

<details><summary>프롬프트 보기</summary>

**`prop-script`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a rolled film script, main colour #f3e7c9. Drawn ALONE (no character, no hand): a small item standing upright, as it would be held in one little paw. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-mic`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a pink idol microphone, main colour #ff7eb6. Drawn ALONE (no character, no hand): a small item standing upright, as it would be held in one little paw. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-camera`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a small video camera, main colour #3a3a3a. Drawn ALONE (no character, no hand): a small item standing upright, as it would be held in one little paw. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-head-mirror`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a doctor head mirror on a band, main colour #cfd8dc. Drawn ALONE (no character, no head): front view, exactly as it would sit on top of a small round head, bottom edge gently curved to fit the head. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-stethoscope`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a stethoscope around the neck, main colour #4a5a6a. Drawn ALONE (no character, no body): front view, exactly as it would be worn around a short neck / on the chest. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-flask`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a glass lab flask with green liquid, main colour #7ed957. Drawn ALONE (no character, no hand): a small item standing upright, as it would be held in one little paw. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-police-cap`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a navy police cap with a badge, main colour #1f3a6b. Drawn ALONE (no character, no head): front view, exactly as it would sit on top of a small round head, bottom edge gently curved to fit the head. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-key-ring`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a big ring of building keys, main colour #d4a017. Drawn ALONE (no character, no hand): a small item standing upright, as it would be held in one little paw. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-sparkle-mic`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a glittering gold-and-pink stage microphone, main colour #f5c542. Drawn ALONE (no character, no hand): a small item standing upright, as it would be held in one little paw. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-space-helmet`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a round glass astronaut helmet, main colour #dfe9f3. Drawn ALONE (no character, no head): front view, exactly as it would sit on top of a small round head, bottom edge gently curved to fit the head. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

</details>

### 묶음 20 (9장)

| id (파일 이름) | 내용 | 비율 | 참조 |
|---|---|:---:|---|
| `prop-beard` | 소품 · 얼굴 · 산신령 수염 | 1:1 | 없음 |
| `prop-golden-mic` | 소품 · 손 · 황금 마이크 | 1:1 | 없음 |
| `prop-apron` | 소품 · 목 · 앞치마 | 1:1 | 없음 |
| `prop-weed-basket` | 소품 · 등 · 풀 바구니 | 1:1 | 없음 |
| `prop-ladle` | 소품 · 손 · 국자 | 1:1 | 없음 |
| `prop-hammer` | 소품 · 손 · 망치 | 1:1 | 없음 |
| `prop-turner` | 소품 · 손 · 뒤집개 | 1:1 | 없음 |
| `prop-delivery-box` | 소품 · 등 · 배달 상자 | 1:1 | 없음 |
| `prop-armor-plate` | 소품 · 등 · 갑옷 등판 | 1:1 | 없음 |

<details><summary>프롬프트 보기</summary>

**`prop-beard`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a long fluffy white mountain-spirit beard, main colour #ffffff. Drawn ALONE (no character, no face): front view, exactly as it would be worn on the face. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-golden-mic`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a shiny golden broadcast microphone, main colour #d4a017. Drawn ALONE (no character, no hand): a small item standing upright, as it would be held in one little paw. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-apron`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a small work apron, main colour #6aa84f. Drawn ALONE (no character, no body): front view, exactly as it would be worn around a short neck / on the chest. A small game costume prop with a thin warm-grey outline. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-weed-basket`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a small woven straw basket backpack full of pulled green weeds. A small game costume prop with a thin warm-grey outline. Square 1:1. One object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-ladle`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a wooden ramen ladle (a small deep metal cup on a long wooden handle), upright. A small game costume prop with a thin warm-grey outline. Square 1:1. One object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-hammer`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a small wooden hammer with a grey metal head, upright. A small game costume prop with a thin warm-grey outline. Square 1:1. One object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-turner`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a pancake turner spatula with a wide flat metal blade and a wooden handle, upright. A small game costume prop with a thin warm-grey outline. Square 1:1. One object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-delivery-box`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a square red delivery box backpack with shoulder straps. A small game costume prop with a thin warm-grey outline. Square 1:1. One object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`prop-armor-plate`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a rounded grey metal back armor plate with leather straps, seen from the back. A small game costume prop with a thin warm-grey outline. Square 1:1. One object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

</details>

## F. 🐹 치이카와 모드 카드·아이템·보물·직업·키메라 — 59장 ★★☆

흰 배경 아이콘. `-chiikawa`로 끝나는 id는 치이카와 모드에서만 쓰는 그림이에요 (같은 카드의 현실 모드 그림은 G묶음).

### 묶음 21 (10장)

| id (파일 이름) | 내용 | 비율 | 참조 |
|---|---|:---:|---|
| `card-study-chiikawa` | 🐹 카드 · 📖 밤샘 공부 | 1:1 | 없음 |
| `card-insider-chiikawa` | 🐹 카드 · 🎤 노래 연습 | 1:1 | 없음 |
| `card-energy-chiikawa` | 🐹 카드 · 🍮 푸딩 파워 | 1:1 | 없음 |
| `card-taxi-chiikawa` | 🐹 카드 · 🐰 우사기 점프 (야하!) | 1:1 | 없음 |
| `card-pledge-chiikawa` | 🐹 카드 · 📣 후원 모금 | 1:1 | 없음 |
| `card-insurance-chiikawa` | 🐹 카드 · 🛡️ 갑옷씨 보증서 | 1:1 | 없음 |
| `card-amulet-chiikawa` | 🐹 카드 · 🧿 수호 부적 | 1:1 | 없음 |
| `card-lotto-chiikawa` | 🐹 카드 · 🎟️ 쿠지 응모권 | 1:1 | 없음 |
| `card-coupon-chiikawa` | 🐹 카드 · 🏷️ 갑옷씨 상점 할인권 | 1:1 | 없음 |
| `card-lawyer-chiikawa` | 🐹 카드 · 🔱 사스마타 방어 | 1:1 | 없음 |

<details><summary>프롬프트 보기</summary>

**`card-study-chiikawa`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: an open storybook next to a small glowing desk lamp and a sleepy crescent moon (late-night studying). Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`card-insider-chiikawa`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: a small pink karaoke microphone with a few floating music notes. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`card-energy-chiikawa`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: a wobbly custard pudding with a glossy caramel top and a small yellow lightning sparkle beside it. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`card-taxi-chiikawa`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: a cream-yellow chibi rabbit-like creature with two long ears doing a huge happy jump, arms up, speed lines below its feet. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`card-pledge-chiikawa`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: a little red megaphone next to a glass donation jar full of coins. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`card-insurance-chiikawa`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: a rolled parchment certificate tied with a ribbon and stamped with a small silver shield seal. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`card-amulet-chiikawa`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: a round blue evil-eye charm (blue and white rings) hanging on a red cord. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`card-lotto-chiikawa`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: a small paper prize-draw ticket with a dotted tear-off line and a round red stamp. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`card-coupon-chiikawa`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: a price-tag shaped discount coupon with a string and a tiny knight-helmet stamp. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`card-lawyer-chiikawa`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: a sasumata (a wooden pole with a U-shaped metal fork) crossed in front of a small round shield. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

</details>

### 묶음 22 (10장)

| id (파일 이름) | 내용 | 비율 | 참조 |
|---|---|:---:|---|
| `card-cut-line-chiikawa` | 🐹 카드 · 🕳️ 함정 파기 | 1:1 | 없음 |
| `card-noise-chiikawa` | 🐹 카드 · 📢 「우라!」 고함 | 1:1 | 없음 |
| `card-tax-audit-chiikawa` | 🐹 카드 · 😈 나쁜 녀석 습격 | 1:1 | 없음 |
| `card-complaint-chiikawa` | 🐹 카드 · 🧹 일거리 뺏기 | 1:1 | 없음 |
| `item-car-chiikawa` | 🐹 아이템 · 🛴 씽씽 킥보드 | 1:1 | 없음 |
| `item-laptop-chiikawa` | 🐹 아이템 · 📚 고서점 책 꾸러미 | 1:1 | 없음 |
| `item-gym-pass-chiikawa` | 🐹 아이템 · 🔱 사스마타 | 1:1 | 없음 |
| `item-designer-bag-chiikawa` | 🐹 아이템 · 👜 포셰트 | 1:1 | 없음 |
| `item-lucky-cat-chiikawa` | 🐹 아이템 · 🍀 네잎클로버 | 1:1 | 없음 |
| `item-massage-chair-chiikawa` | 🐹 아이템 · ♨️ 목욕탕 평생 회수권 | 1:1 | 없음 |

<details><summary>프롬프트 보기</summary>

**`card-cut-line-chiikawa`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: a small round pit dug in the grass with a little shovel stuck in the dirt pile beside it. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`card-noise-chiikawa`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: a big jagged yellow shout bubble bursting with sound-wave lines (no letters inside). Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`card-tax-audit-chiikawa`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: a sneaky little purple shadow creature with a mask running away with a coin bag. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`card-complaint-chiikawa`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: a broom and a small work glove being snatched away by a grabbing hand, with a whoosh motion trail. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`item-car-chiikawa`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game item icon: a small mint-green kick scooter with a little bell. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`item-laptop-chiikawa`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game item icon: a stack of three old books tied together with a string. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`item-gym-pass-chiikawa`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game item icon: a sasumata: a long wooden pole with a U-shaped metal fork at the top, standing upright. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`item-designer-bag-chiikawa`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game item icon: a small cute lavender pochette shoulder bag with a round flap and a thin strap. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`item-lucky-cat-chiikawa`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game item icon: a bright green four-leaf clover with a tiny sparkle. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`item-massage-chair-chiikawa`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game item icon: a small ticket booklet with a hot-spring steam symbol, next to a wooden bath bucket. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

</details>

### 묶음 23 (10장)

| id (파일 이름) | 내용 | 비율 | 참조 |
|---|---|:---:|---|
| `item-armor` | 🐹 아이템 · 갑옷 | 1:1 | 없음 |
| `item-guitar` | 🐹 아이템 · 하치와레표 기타 | 1:1 | 없음 |
| `treasure-kuji-plush` | 🐹 보물 · 커다란 치이카와 인형 | 1:1 | 없음 |
| `treasure-celadon-chiikawa` | 🐹 보물 · 🏺 고대 항아리 | 1:1 | 없음 |
| `treasure-white-porcelain-chiikawa` | 🐹 보물 · 🫖 갑옷씨의 은잔 | 1:1 | 없음 |
| `treasure-idol-goods-chiikawa` | 🐹 보물 · ✨ 레어 스티커 | 1:1 | 없음 |
| `treasure-dino-fossil-chiikawa` | 🐹 보물 · 🐉 키메라 화석 | 1:1 | 없음 |
| `treasure-gold-toad-chiikawa` | 🐹 보물 · 🌰 황금 밤 | 1:1 | 없음 |
| `treasure-stamp-chiikawa` | 🐹 보물 · 🍀 네잎클로버 책갈피 | 1:1 | 없음 |
| `treasure-lp-record-chiikawa` | 🐹 보물 · 🎸 낡은 기타 줄 | 1:1 | 없음 |

<details><summary>프롬프트 보기</summary>

**`item-armor`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game item icon: a small shiny grey suit of chest armor with a round helmet resting on top, rivets, a little red plume. Square 1:1. One object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`item-guitar`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game item icon: a cute small acoustic guitar with a warm orange-brown body, a cream sound hole ring and a blue strap. Square 1:1. One object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`treasure-kuji-plush`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game item icon: a big soft plush toy of a small round white bear-like creature with tiny round ears, dot eyes and pink blush, sitting, with a yellow ribbon around its neck (a prize-draw first prize). Square 1:1. One object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`treasure-celadon-chiikawa`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single treasure item icon: an ancient clay jar with simple wave patterns, slightly chipped. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers. Add one tiny sparkle.
```

**`treasure-white-porcelain-chiikawa`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single treasure item icon: a shiny little silver goblet with a tiny engraved shield. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers. Add one tiny sparkle.
```

**`treasure-idol-goods-chiikawa`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single treasure item icon: a sparkly sheet of rare character stickers with stars and hearts. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers. Add one tiny sparkle.
```

**`treasure-dino-fossil-chiikawa`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single treasure item icon: a big fossil skull of a horned monster with small fangs. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers. Add one tiny sparkle.
```

**`treasure-gold-toad-chiikawa`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single treasure item icon: a shiny golden chestnut glowing softly. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers. Add one tiny sparkle.
```

**`treasure-stamp-chiikawa`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single treasure item icon: a paper bookmark with a pressed four-leaf clover and a ribbon tassel. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers. Add one tiny sparkle.
```

**`treasure-lp-record-chiikawa`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single treasure item icon: a coiled old guitar string with a small guitar pick. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers. Add one tiny sparkle.
```

</details>

### 묶음 24 (10장)

| id (파일 이름) | 내용 | 비율 | 참조 |
|---|---|:---:|---|
| `treasure-sneakers-chiikawa` | 🐹 보물 · 👟 랏코의 운동화 | 1:1 | 없음 |
| `treasure-calligraphy-chiikawa` | 🐹 보물 · 📕 고서점 희귀본 | 1:1 | 없음 |
| `treasure-ginseng-chiikawa` | 🐹 보물 · 🍄 거대 버섯 | 1:1 | 없음 |
| `treasure-retro-console-chiikawa` | 🐹 보물 · 🪀 옛날 장난감 | 1:1 | 없음 |
| `treasure-first-edition-chiikawa` | 🐹 보물 · 📖 초판 그림책 | 1:1 | 없음 |
| `treasure-black-pearl-chiikawa` | 🐹 보물 · 🦪 진주 조개 | 1:1 | 없음 |
| `treasure-signed-ball-chiikawa` | 🐹 보물 · 🍮 푸딩 왕관 | 1:1 | 없음 |
| `treasure-amber-chiikawa` | 🐹 보물 · 🫧 바다 유리 | 1:1 | 없음 |
| `treasure-gold-crown-chiikawa` | 🐹 보물 · 🔱 전설의 사스마타 | 1:1 | 없음 |
| `icon-job-weeder` | 🐹 직업 아이콘 · 🌿 풀뽑기 일꾼 | 1:1 | 없음 |

<details><summary>프롬프트 보기</summary>

**`treasure-sneakers-chiikawa`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single treasure item icon: a pair of well-worn brown sneakers. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers. Add one tiny sparkle.
```

**`treasure-calligraphy-chiikawa`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single treasure item icon: a rare old hardcover book with a worn red cover and gold corners. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers. Add one tiny sparkle.
```

**`treasure-ginseng-chiikawa`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single treasure item icon: a giant red-capped mushroom with white spots. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers. Add one tiny sparkle.
```

**`treasure-retro-console-chiikawa`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single treasure item icon: an old wooden spinning top and a yo-yo. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers. Add one tiny sparkle.
```

**`treasure-first-edition-chiikawa`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single treasure item icon: a picture book with a bright cover showing a sun over green hills. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers. Add one tiny sparkle.
```

**`treasure-black-pearl-chiikawa`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single treasure item icon: an open seashell with a glowing pearl inside. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers. Add one tiny sparkle.
```

**`treasure-signed-ball-chiikawa`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single treasure item icon: a tiny golden crown sitting on top of a custard pudding. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers. Add one tiny sparkle.
```

**`treasure-amber-chiikawa`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single treasure item icon: a few smooth round pieces of pale aqua and green sea glass. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers. Add one tiny sparkle.
```

**`treasure-gold-crown-chiikawa`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single treasure item icon: a legendary golden sasumata glowing with little sparkles. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers. Add one tiny sparkle.
```

**`icon-job-weeder`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single round job badge icon showing a symbolic object (no character): a small woven basket of pulled weeds with a little hand trowel. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

</details>

### 묶음 25 (10장)

| id (파일 이름) | 내용 | 비율 | 참조 |
|---|---|:---:|---|
| `icon-job-hunter` | 🐹 직업 아이콘 · ⚔️ 토벌대 | 1:1 | 없음 |
| `icon-job-ramen` | 🐹 직업 아이콘 · 🍜 라멘 가게 「郎」 | 1:1 | 없음 |
| `icon-job-workshop` | 🐹 직업 아이콘 · 🛠️ 갑옷씨 공방 | 1:1 | 없음 |
| `icon-job-bookstore` | 🐹 직업 아이콘 · 📚 고서점 직원 | 1:1 | 없음 |
| `icon-job-busker` | 🐹 직업 아이콘 · 🎸 길거리 가수 | 1:1 | 없음 |
| `icon-job-pancake` | 🐹 직업 아이콘 · 🥞 팬케이크 가게 | 1:1 | 없음 |
| `icon-job-photographer` | 🐹 직업 아이콘 · 📷 사진사 | 1:1 | 없음 |
| `icon-job-sento` | 🐹 직업 아이콘 · ♨️ 목욕탕지기 | 1:1 | 없음 |
| `icon-job-delivery` | 🐹 직업 아이콘 · 📦 배달부 | 1:1 | 없음 |
| `icon-job-fisher` | 🐹 직업 아이콘 · 🎣 섬 낚시꾼 | 1:1 | 없음 |

<details><summary>프롬프트 보기</summary>

**`icon-job-hunter`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single round job badge icon showing a symbolic object (no character): a sasumata crossed with a small round shield. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-job-ramen`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single round job badge icon showing a symbolic object (no character): a steaming ramen bowl piled high with bean sprouts and pork slices. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-job-workshop`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single round job badge icon showing a symbolic object (no character): a small hammer and an anvil with a rounded knight helmet. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-job-bookstore`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single round job badge icon showing a symbolic object (no character): a stack of old books with a round magnifying glass. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-job-busker`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single round job badge icon showing a symbolic object (no character): an acoustic guitar with floating music notes. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-job-pancake`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single round job badge icon showing a symbolic object (no character): a fluffy stack of pancakes with butter and dripping syrup. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-job-photographer`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single round job badge icon showing a symbolic object (no character): a vintage camera with a little flash sparkle. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-job-sento`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single round job badge icon showing a symbolic object (no character): a wooden bath bucket with a folded towel and rising steam. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-job-delivery`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single round job badge icon showing a symbolic object (no character): a taped cardboard delivery box with a little speed trail. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-job-fisher`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single round job badge icon showing a symbolic object (no character): a fishing rod with a big fish on the line. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

</details>

### 묶음 26 (9장)

| id (파일 이름) | 내용 | 비율 | 참조 |
|---|---|:---:|---|
| `icon-job-cafe` | 🐹 직업 아이콘 · ☕ 카페 점원 | 1:1 | 없음 |
| `icon-job-legend-hunter` | 🐹 직업 아이콘 · 🗡️ 전설의 토벌자 | 1:1 | 없음 |
| `icon-job-weed-sage` | 🐹 직업 아이콘 · 🌾 풀뽑기 1급 명인 | 1:1 | 없음 |
| `icon-job-ramen-owner` | 🐹 직업 아이콘 · 🍜 「郎」 2호점 사장 | 1:1 | 없음 |
| `icon-job-armor-san` | 🐹 직업 아이콘 · 🛡️ 갑옷씨 | 1:1 | 없음 |
| `monster-small-chimera` | 🐹 키메라 · 꼬마 키메라 | 1:1 | 없음 |
| `monster-chimera` | 🐹 키메라 · 키메라 | 1:1 | 없음 |
| `monster-big-chimera` | 🐹 키메라 · 커다란 키메라 | 1:1 | 없음 |
| `monster-dekatsuyo` | 🐹 키메라 · 데카츠요 (대형 보스) | 1:1 | 없음 |

<details><summary>프롬프트 보기</summary>

**`icon-job-cafe`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single round job badge icon showing a symbolic object (no character): a coffee cup with heart latte art and a small cake. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-job-legend-hunter`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single round job badge icon showing a symbolic object (no character): a glowing golden sasumata with a star above it. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-job-weed-sage`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single round job badge icon showing a symbolic object (no character): a golden ear of grass with a first-prize medal ribbon. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-job-ramen-owner`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single round job badge icon showing a symbolic object (no character): a ramen bowl wearing a small golden crown. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-job-armor-san`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single round job badge icon showing a symbolic object (no character): a shiny knight helmet and chest armor with a golden emblem. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`monster-small-chimera`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a tiny purple chimera shaped like a chubby round caterpillar of three or four soft segments, two small yellow horns, big round googly eyes, a tiny fang, little stubby feet. Square 1:1. ONE monster, full body, three-quarter view facing LEFT, centred, filling about 75% of the square, plain pure white background #FFFFFF, no floor, no shadow, no text. It must look silly and cute, never scary or gory.
```

**`monster-chimera`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a medium purple chimera with a round lumpy body, two curved cream horns, a row of orange back spikes, big googly eyes, a wide grin with two little fangs, short stubby legs. Square 1:1. ONE monster, full body, three-quarter view facing LEFT, centred, filling about 75% of the square, plain pure white background #FFFFFF, no floor, no shadow, no text. It must look silly and cute, never scary or gory.
```

**`monster-big-chimera`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a big orange dinosaur-like chimera standing upright, a cream belly, teal back spikes, a long curly tail, big googly eyes and a toothy silly grin, tiny arms. Square 1:1. ONE monster, full body, three-quarter view facing LEFT, centred, filling about 75% of the square, plain pure white background #FFFFFF, no floor, no shadow, no text. It must look silly and cute, never scary or gory.
```

**`monster-dekatsuyo`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a huge dark-purple boss chimera with a big dome-shaped body, three yellow eyes in a row, a wide mouth full of small white triangle teeth, yellow spikes on top, small bat wings, short thick legs — big and strong but still comical. Square 1:1. ONE monster, full body, three-quarter view facing LEFT, centred, filling about 75% of the square, plain pure white background #FFFFFF, no floor, no shadow, no text. It must look silly and cute, never scary or gory.
```

</details>

## G. 공용 카드 + 새 칸 아이콘 — 30장 ★★☆

두 세계가 같이 쓰는 카드 그림과, 아직 그림이 없는 보드 칸 아이콘.

### 묶음 27 (10장)

| id (파일 이름) | 내용 | 비율 | 참조 |
|---|---|:---:|---|
| `card-bonus` | 🃏 카드 · 💌 성과급 봉투 | 1:1 | 없음 |
| `card-gossip` | 🃏 카드 · 🤫 소문내기 | 1:1 | 없음 |
| `card-marriage-luck` | 🃏 카드 · 💞 단짝운◎ | 1:1 | 없음 |
| `card-popular` | 🃏 카드 · 🌟 인기 폭발◎ | 1:1 | 없음 |
| `card-research` | 🃏 카드 · 🔬 연구열심 | 1:1 | 없음 |
| `card-charisma` | 🃏 카드 · 🎤 카리스마◎ | 1:1 | 없음 |
| `card-tongue` | 🃏 카드 · 👅 절대미각 | 1:1 | 없음 |
| `card-iron-body` | 🃏 카드 · 🦾 강철 체력 | 1:1 | 없음 |
| `card-health-charm` | 🃏 카드 · 🧿 건강기원 부적 | 1:1 | 없음 |
| `card-salary-charm` | 🃏 카드 · 💴 월급 부적 | 1:1 | 없음 |

<details><summary>프롬프트 보기</summary>

**`card-bonus`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: a pink envelope with a heart seal and a few coins peeking out. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`card-gossip`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: two little whisper speech bubbles with a finger-on-lips sign. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`card-marriage-luck`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: two small pink hearts linked together with a sparkle. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`card-popular`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: a big bright yellow star with little hearts popping around it. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`card-research`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: a microscope next to an open notebook. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`card-charisma`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: a shining stage microphone with a little crown. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`card-tongue`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: a tasting spoon over a small steaming pot, with a sparkle. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`card-iron-body`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: a strong flexed arm with a small band-aid and sparkles. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`card-health-charm`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: a round blue-and-white protective charm on a red tassel. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`card-salary-charm`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: a small red lucky pouch charm with a gold coin. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

</details>

### 묶음 28 (10장)

| id (파일 이름) | 내용 | 비율 | 참조 |
|---|---|:---:|---|
| `card-merit` | 🃏 카드 · 🏅 공적 카드 | 1:1 | 없음 |
| `card-big-roll` | 🃏 카드 · 🔼 큰 수 카드 | 1:1 | 없음 |
| `card-small-roll` | 🃏 카드 · 🔽 작은 수 카드 | 1:1 | 없음 |
| `card-exact-roll` | 🃏 카드 · 🎯 딱 그 칸 카드 | 1:1 | 없음 |
| `card-payday-rush` | 🃏 카드 · 💨 월급날 직행 | 1:1 | 없음 |
| `card-injury` | 🃏 카드 · 🤕 부상 | 1:1 | 없음 |
| `icon-start` | 칸 아이콘 · 🚩 출발 | 1:1 | 없음 |
| `icon-event` | 칸 아이콘 · ❗ 이벤트 | 1:1 | 없음 |
| `icon-salary` | 칸 아이콘 · 💵 월급날 | 1:1 | 없음 |
| `icon-pass` | 칸 아이콘 · 🎪 찬스 광장 | 1:1 | 없음 |

<details><summary>프롬프트 보기</summary>

**`card-merit`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: a gold medal with a red ribbon. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`card-big-roll`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: a big up arrow over a stack of number dice showing high numbers (dots only). Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`card-small-roll`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: a small down arrow over a single die (dots only). Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`card-exact-roll`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: a round archery target with an arrow exactly in the centre. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`card-payday-rush`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: a pay envelope flying fast with wind speed lines. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`card-injury`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: a white bandage roll and a plaster crossed, with a tiny sweat drop. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-start`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single board-game tile icon: a little red flag on a short pole stuck in the grass. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-event`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single board-game tile icon: a small surprise gift box popping open with a burst of sparkles. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-salary`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single board-game tile icon: a paper pay envelope with a few gold coins and green bills peeking out. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-pass`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single board-game tile icon: a cheerful striped circus tent with a small flag on top. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

</details>

### 묶음 29 (10장)

| id (파일 이름) | 내용 | 비율 | 참조 |
|---|---|:---:|---|
| `icon-hometown` | 칸 아이콘 · 🏡 고향 | 1:1 | 없음 |
| `icon-temple` | 칸 아이콘 · 🛕 산사 | 1:1 | 없음 |
| `icon-jeju` | 칸 아이콘 · 🌴 제주 | 1:1 | 없음 |
| `icon-reversal` | 칸 아이콘 · 🎰 인생역전 | 1:1 | 없음 |
| `icon-island` | 칸 아이콘 · 🏝️ 한방역전섬 | 1:1 | 없음 |
| `icon-contest` | 칸 아이콘 · 🏆 노년 대회 | 1:1 | 없음 |
| `icon-auction` | 칸 아이콘 · 🔨 경매 | 1:1 | 없음 |
| `icon-hunt` | 칸 아이콘 · ⚔️ 토벌 | 1:1 | 없음 |
| `icon-weed` | 칸 아이콘 · 🌿 풀뽑기 | 1:1 | 없음 |
| `icon-merge` | 칸 아이콘 · 🔀 합류 | 1:1 | 없음 |

<details><summary>프롬프트 보기</summary>

**`icon-hometown`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single board-game tile icon: a small countryside house with a persimmon tree beside it. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-temple`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single board-game tile icon: a small mountain temple bell hanging under a little wooden roof. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-jeju`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single board-game tile icon: a palm tree next to a small round stone statue with a big nose (dol hareubang). Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-reversal`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single board-game tile icon: a colourful casino roulette wheel with a little ball. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-island`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single board-game tile icon: a tiny islet with one palm tree and a small colourful roulette disc on the sand. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-contest`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single board-game tile icon: a gold medal and a small trophy with confetti. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-auction`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single board-game tile icon: a wooden auction gavel on its round sound block. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-hunt`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single board-game tile icon: a sasumata next to a small purple monster horn. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-weed`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single board-game tile icon: a tuft of green weeds with a tiny woven basket. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-merge`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single board-game tile icon: three little paths joining into one, with a small signpost (no letters). Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

</details>

## H. 🏙️ 현실 모드 그림 (카드·아이템·보물·직업) — 65장 ★☆☆

현실 모드에서 보이는 그림이에요. 보물 중 「두 세계 공용」과 직업 중 건물주·산신령은 치이카와 모드에서도 써요.

### 묶음 30 (10장)

| id (파일 이름) | 내용 | 비율 | 참조 |
|---|---|:---:|---|
| `card-study` | 🏙️ 카드 · 📚 스터디 모임 (현실 모드용) | 1:1 | 없음 |
| `card-insider` | 🏙️ 카드 · 🤳 인싸력 (현실 모드용) | 1:1 | 없음 |
| `card-energy` | 🏙️ 카드 · ⚡ 에너지 드링크 (현실 모드용) | 1:1 | 없음 |
| `card-taxi` | 🏙️ 카드 · 🚕 택시 (현실 모드용) | 1:1 | 없음 |
| `card-pledge` | 🏙️ 카드 · 🎤 공약 카드 (현실 모드용) | 1:1 | 없음 |
| `card-insurance` | 🏙️ 카드 · ☂️ 실손 보험 (현실 모드용) | 1:1 | 없음 |
| `card-amulet` | 🏙️ 카드 · 🧧 건강 부적 (현실 모드용) | 1:1 | 없음 |
| `card-lotto` | 🏙️ 카드 · 🎱 로또 복권 (현실 모드용) | 1:1 | 없음 |
| `card-coupon` | 🏙️ 카드 · 🎟️ 할인 쿠폰 (현실 모드용) | 1:1 | 없음 |
| `card-lawyer` | 🏙️ 카드 · ⚖️ 변호사 상담권 (현실 모드용) | 1:1 | 없음 |

<details><summary>프롬프트 보기</summary>

**`card-study`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: an open notebook with a pencil on top of a small stack of books and a glowing idea light bulb above them. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`card-insider`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: a smartphone with heart and star reaction bubbles and sparkles bursting out of the screen. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`card-energy`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: a bright can of energy drink with a big yellow lightning bolt on it, fizzing bubbles around it. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`card-taxi`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: a cute round orange Korean taxi car with a roof light, speed lines behind it. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`card-pledge`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: a campaign speech podium with a microphone and a big red rosette ribbon, small confetti. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`card-insurance`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: a blue shield with a white plus sign, sheltered under a small red umbrella. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`card-amulet`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: a traditional Korean yellow talisman paper with abstract red swirl patterns (no readable letters), tied with a red string and a small tassel. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`card-lotto`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: a lottery ticket card with five colorful glossy lottery balls (plain, no numbers) bouncing out of it. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`card-coupon`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: a pink discount coupon ticket with a dotted cut line, small scissors and a big percent symbol. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`card-lawyer`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: a golden balance scale next to a wooden judge's gavel. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

</details>

### 묶음 31 (10장)

| id (파일 이름) | 내용 | 비율 | 참조 |
|---|---|:---:|---|
| `card-cut-line` | 🏙️ 카드 · 🏃 새치기 (현실 모드용) | 1:1 | 없음 |
| `card-noise` | 🏙️ 카드 · 🔨 층간소음 (현실 모드용) | 1:1 | 없음 |
| `card-tax-audit` | 🏙️ 카드 · 🔍 세무조사 (현실 모드용) | 1:1 | 없음 |
| `card-complaint` | 🏙️ 카드 · 📢 갑질 민원 (현실 모드용) | 1:1 | 없음 |
| `item-car` | 🏙️ 아이템 · 🚗 경차 | 1:1 | 없음 |
| `item-laptop` | 🏙️ 아이템 · 💻 노트북 | 1:1 | 없음 |
| `item-gym-pass` | 🏙️ 아이템 · 🏋️ 헬스 회원권 | 1:1 | 없음 |
| `item-designer-bag` | 🏙️ 아이템 · 👜 명품 가방 | 1:1 | 없음 |
| `item-lucky-cat` | 🏙️ 아이템 · 🐱 복고양이 | 1:1 | 없음 |
| `item-massage-chair` | 🏙️ 아이템 · 💺 안마의자 | 1:1 | 없음 |

<details><summary>프롬프트 보기</summary>

**`card-cut-line`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: a cheeky sneaker leaping over a queue line of small orange traffic cones, with a curved jump arrow. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`card-noise`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: a stomping foot above a ceiling with jagged red sound waves and a shaking lamp below. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`card-tax-audit`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: a big magnifying glass over a pile of gold coins and a red official stamp. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`card-complaint`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game card illustration: an angry red megaphone blasting jagged shout lines, with a small red anger mark. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`item-car`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game item icon: a small cute mint-green compact car, front three-quarter view. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`item-laptop`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game item icon: an open silver laptop with a glowing screen showing abstract colorful shapes. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`item-gym-pass`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game item icon: a membership card leaning on a blue dumbbell. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`item-designer-bag`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game item icon: an elegant beige leather handbag with a gold clasp, sparkles around it. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`item-lucky-cat`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game item icon: a cute golden lucky cat figurine raising one paw, a small red bell collar. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`item-massage-chair`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game item icon: a big comfy brown massage chair with soft cushions and a small remote control. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

</details>

### 묶음 32 (10장)

| id (파일 이름) | 내용 | 비율 | 참조 |
|---|---|:---:|---|
| `treasure-celadon` | 🏙️ 보물 · 🏺 고려청자 | 1:1 | 없음 |
| `treasure-white-porcelain` | 🏙️ 보물 · 🫖 조선백자 | 1:1 | 없음 |
| `treasure-old-coin` | 💎 보물 (두 세계 공용) · 🪙 옛날 동전 | 1:1 | 없음 |
| `treasure-idol-goods` | 🏙️ 보물 · 💿 아이돌 굿즈 | 1:1 | 없음 |
| `treasure-dino-fossil` | 🏙️ 보물 · 🦴 공룡 화석 | 1:1 | 없음 |
| `treasure-gold-toad` | 🏙️ 보물 · 🐸 금두꺼비 | 1:1 | 없음 |
| `treasure-stamp` | 🏙️ 보물 · 📮 희귀 우표 | 1:1 | 없음 |
| `treasure-lp-record` | 🏙️ 보물 · 💽 LP판 | 1:1 | 없음 |
| `treasure-sneakers` | 🏙️ 보물 · 👟 한정판 운동화 | 1:1 | 없음 |
| `treasure-fake-painting` | 💎 보물 (두 세계 공용) · 🖼️ 가짜 명화 | 1:1 | 없음 |

<details><summary>프롬프트 보기</summary>

**`treasure-celadon`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single treasure item icon: an elegant jade-green Goryeo celadon vase with inlaid white cranes and clouds. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers. Add one tiny sparkle.
```

**`treasure-white-porcelain`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single treasure item icon: a round snow-white Joseon moon jar porcelain. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers. Add one tiny sparkle.
```

**`treasure-old-coin`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single treasure item icon: a few old round Korean brass coins with square holes, slightly rusty. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers. Add one tiny sparkle.
```

**`treasure-idol-goods`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single treasure item icon: a K-pop idol fan goods set: a signed photocard and a lightstick. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers. Add one tiny sparkle.
```

**`treasure-dino-fossil`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single treasure item icon: a big dinosaur fossil bone and a fossil skull on sand. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers. Add one tiny sparkle.
```

**`treasure-gold-toad`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single treasure item icon: a shiny solid gold toad figurine holding a coin in its mouth. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers. Add one tiny sparkle.
```

**`treasure-stamp`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single treasure item icon: a rare vintage postage stamp with a printing error, with a magnifying glass. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers. Add one tiny sparkle.
```

**`treasure-lp-record`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single treasure item icon: a vintage vinyl LP record sliding out of a retro album sleeve. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers. Add one tiny sparkle.
```

**`treasure-sneakers`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single treasure item icon: a pair of colorful limited edition sneakers in a box. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers. Add one tiny sparkle.
```

**`treasure-fake-painting`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single treasure item icon: a famous-looking framed oil painting of a smiling woman with a suspicious crooked frame. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers. Add one tiny sparkle.
```

</details>

### 묶음 33 (10장)

| id (파일 이름) | 내용 | 비율 | 참조 |
|---|---|:---:|---|
| `treasure-antique-clock` | 💎 보물 (두 세계 공용) · 🕰️ 골동품 괘종시계 | 1:1 | 없음 |
| `treasure-calligraphy` | 🏙️ 보물 · 📜 명필 서예 족자 | 1:1 | 없음 |
| `treasure-meteorite` | 💎 보물 (두 세계 공용) · ☄️ 운석 조각 | 1:1 | 없음 |
| `treasure-ginseng` | 🏙️ 보물 · 🌿 백년 산삼 | 1:1 | 없음 |
| `treasure-retro-console` | 🏙️ 보물 · 🕹️ 레트로 게임기 | 1:1 | 없음 |
| `treasure-first-edition` | 🏙️ 보물 · 📚 초판 만화책 | 1:1 | 없음 |
| `treasure-black-pearl` | 🏙️ 보물 · 📿 흑진주 목걸이 | 1:1 | 없음 |
| `treasure-vintage-camera` | 💎 보물 (두 세계 공용) · 📷 빈티지 필름 카메라 | 1:1 | 없음 |
| `treasure-signed-ball` | 🏙️ 보물 · ⚾ 홈런 사인볼 | 1:1 | 없음 |
| `treasure-amber` | 🏙️ 보물 · 🟠 호박 속 모기 | 1:1 | 없음 |

<details><summary>프롬프트 보기</summary>

**`treasure-antique-clock`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single treasure item icon: an antique wooden pendulum wall clock. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers. Add one tiny sparkle.
```

**`treasure-calligraphy`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single treasure item icon: a hanging scroll of bold black brush calligraphy with a red seal stamp (abstract strokes, not real letters). Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers. Add one tiny sparkle.
```

**`treasure-meteorite`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single treasure item icon: a dark glittering meteorite rock with a small glowing trail. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers. Add one tiny sparkle.
```

**`treasure-ginseng`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single treasure item icon: a large wild mountain ginseng root with red berries. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers. Add one tiny sparkle.
```

**`treasure-retro-console`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single treasure item icon: a retro handheld game console and a cartridge. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers. Add one tiny sparkle.
```

**`treasure-first-edition`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single treasure item icon: a stack of old first edition comic books. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers. Add one tiny sparkle.
```

**`treasure-black-pearl`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single treasure item icon: a black pearl necklace in an open velvet box. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers. Add one tiny sparkle.
```

**`treasure-vintage-camera`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single treasure item icon: a vintage film camera with a leather strap. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers. Add one tiny sparkle.
```

**`treasure-signed-ball`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single treasure item icon: a signed home run baseball on a small stand. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers. Add one tiny sparkle.
```

**`treasure-amber`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single treasure item icon: a golden amber gem with a tiny mosquito trapped inside. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers. Add one tiny sparkle.
```

</details>

### 묶음 34 (10장)

| id (파일 이름) | 내용 | 비율 | 참조 |
|---|---|:---:|---|
| `treasure-gold-crown` | 🏙️ 보물 · 👑 신라 금관 조각 | 1:1 | 없음 |
| `treasure-treasure-map` | 💎 보물 (두 세계 공용) · 🗺️ 보물 지도 | 1:1 | 없음 |
| `icon-job-civil-servant` | 🏙️ 직업 아이콘 · 🏛️ 공무원 | 1:1 | 없음 |
| `icon-job-office-worker` | 🏙️ 직업 아이콘 · 🏢 대기업 회사원 | 1:1 | 없음 |
| `icon-job-webtoonist` | 🏙️ 직업 아이콘 · 🖊️ 웹툰 작가 | 1:1 | 없음 |
| `icon-job-politician` | 🏙️ 직업 아이콘 · 🎤 국회의원 | 1:1 | 없음 |
| `icon-job-baseball` | 🏙️ 직업 아이콘 · ⚾ 야구선수 | 1:1 | 없음 |
| `icon-job-soccer` | 🏙️ 직업 아이콘 · ⚽ 축구선수 | 1:1 | 없음 |
| `icon-job-esports` | 🏙️ 직업 아이콘 · 🎮 e스포츠 선수 | 1:1 | 없음 |
| `icon-job-fighter` | 🏙️ 직업 아이콘 · 🥊 격투기 선수 | 1:1 | 없음 |

<details><summary>프롬프트 보기</summary>

**`treasure-gold-crown`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single treasure item icon: a golden Silla crown ornament piece with jade comma-shaped gogok beads. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers. Add one tiny sparkle.
```

**`treasure-treasure-map`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single treasure item icon: an old rolled treasure map with a red X mark. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers. Add one tiny sparkle.
```

**`icon-job-civil-servant`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single round job badge icon showing a symbolic object (no character): a neat folder with an official red stamp and a name badge lanyard. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-job-office-worker`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single round job badge icon showing a symbolic object (no character): a black briefcase with a blue necktie draped over it. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-job-webtoonist`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single round job badge icon showing a symbolic object (no character): a drawing tablet with a stylus and colorful comic panel shapes. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-job-politician`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single round job badge icon showing a symbolic object (no character): a gold lapel badge next to a microphone. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-job-baseball`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single round job badge icon showing a symbolic object (no character): a baseball with a wooden bat and a glove. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-job-soccer`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single round job badge icon showing a symbolic object (no character): a black-and-white soccer ball with a small goal net behind it. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-job-esports`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single round job badge icon showing a symbolic object (no character): a gaming headset resting on a glowing RGB keyboard. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-job-fighter`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single round job badge icon showing a symbolic object (no character): a pair of red boxing gloves with a champion belt. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

</details>

### 묶음 35 (10장)

| id (파일 이름) | 내용 | 비율 | 참조 |
|---|---|:---:|---|
| `icon-job-actor` | 🏙️ 직업 아이콘 · 🎬 배우 | 1:1 | 없음 |
| `icon-job-idol` | 🏙️ 직업 아이콘 · 🎤 아이돌 | 1:1 | 없음 |
| `icon-job-youtuber` | 🏙️ 직업 아이콘 · 📹 유튜버 | 1:1 | 없음 |
| `icon-job-chef` | 🏙️ 직업 아이콘 · 👨‍🍳 셰프 | 1:1 | 없음 |
| `icon-job-doctor` | 🏙️ 직업 아이콘 · 🩺 의사 | 1:1 | 없음 |
| `icon-job-researcher` | 🏙️ 직업 아이콘 · 🔬 연구원 | 1:1 | 없음 |
| `icon-job-police` | 🏙️ 직업 아이콘 · 👮 경찰관 | 1:1 | 없음 |
| `icon-job-comedian` | 🏙️ 직업 아이콘 · 🤡 개그맨 | 1:1 | 없음 |
| `icon-job-teacher` | 🏙️ 직업 아이콘 · 📚 교사 | 1:1 | 없음 |
| `icon-job-landlord` | 💼 직업 아이콘 (두 세계 공용) · 🏙️ 건물주 | 1:1 | 없음 |

<details><summary>프롬프트 보기</summary>

**`icon-job-actor`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single round job badge icon showing a symbolic object (no character): a film clapperboard (blank) with a small golden star. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-job-idol`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single round job badge icon showing a symbolic object (no character): a sparkly stage microphone with a pink glow stick and music notes. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-job-youtuber`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single round job badge icon showing a symbolic object (no character): a red play-button shaped sign with a small camera and a ring light. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-job-chef`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single round job badge icon showing a symbolic object (no character): a white chef hat over a frying pan with a sizzling egg. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-job-doctor`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single round job badge icon showing a symbolic object (no character): a stethoscope around a white medical cross. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-job-researcher`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single round job badge icon showing a symbolic object (no character): a glass flask with bubbling green liquid and a small microscope. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-job-police`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single round job badge icon showing a symbolic object (no character): a police cap with a gold emblem and a whistle. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-job-comedian`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single round job badge icon showing a symbolic object (no character): a funny red clown nose with a laughing mask. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-job-teacher`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single round job badge icon showing a symbolic object (no character): a green chalkboard (blank) with an apple and a piece of chalk. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-job-landlord`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single round job badge icon showing a symbolic object (no character): a tall shiny building with a golden key in front of it. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

</details>

### 묶음 36 (5장)

| id (파일 이름) | 내용 | 비율 | 참조 |
|---|---|:---:|---|
| `icon-job-trot-star` | 🏙️ 직업 아이콘 · 🎙️ 트로트 스타 | 1:1 | 없음 |
| `icon-job-astronaut` | 🏙️ 직업 아이콘 · 🚀 우주비행사 | 1:1 | 없음 |
| `icon-job-mountain-spirit` | 💼 직업 아이콘 (두 세계 공용) · 🏔️ 산신령 | 1:1 | 없음 |
| `icon-job-chaebol` | 🏙️ 직업 아이콘 · 👑 재벌 총수 | 1:1 | 없음 |
| `icon-job-national-mc` | 🏙️ 직업 아이콘 · 📺 국민 MC | 1:1 | 없음 |

<details><summary>프롬프트 보기</summary>

**`icon-job-trot-star`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single round job badge icon showing a symbolic object (no character): a golden microphone with a sparkly sequin bow tie. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-job-astronaut`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single round job badge icon showing a symbolic object (no character): a white astronaut helmet with a small rocket and stars. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-job-mountain-spirit`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single round job badge icon showing a symbolic object (no character): a wooden staff with a white cloud and a mountain peak behind it. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-job-chaebol`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single round job badge icon showing a symbolic object (no character): a golden crown sitting on a stack of gold bars. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-job-national-mc`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single round job badge icon showing a symbolic object (no character): a golden trophy shaped like a microphone with confetti. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

</details>

## I. (선택) 예전 그림체 정리 — 칸 아이콘·테두리 무늬·파티장 — 20장 ☆☆☆

지금 게임에 들어 있는 반짝이는 게임풍 그림을 치이카와 풍으로 바꾸는 것. 안 해도 게임은 돌아가요.

### 묶음 37 (10장)

| id (파일 이름) | 내용 | 비율 | 참조 |
|---|---|:---:|---|
| `icon-money` | 칸 아이콘 · 돈 (치이카와 풍으로 다시) | 1:1 | 없음 |
| `icon-love` | 칸 아이콘 · 연애 (치이카와 풍으로 다시) | 1:1 | 없음 |
| `icon-job` | 칸 아이콘 · 직업 (치이카와 풍으로 다시) | 1:1 | 없음 |
| `icon-house` | 칸 아이콘 · 집 (치이카와 풍으로 다시) | 1:1 | 없음 |
| `icon-treasure` | 칸 아이콘 · 보물 (치이카와 풍으로 다시) | 1:1 | 없음 |
| `icon-card` | 칸 아이콘 · 카드 (치이카와 풍으로 다시) | 1:1 | 없음 |
| `icon-shop` | 칸 아이콘 · 쇼핑 (치이카와 풍으로 다시) | 1:1 | 없음 |
| `icon-stop` | 칸 아이콘 · 정지 (치이카와 풍으로 다시) | 1:1 | 없음 |
| `icon-bad` | 칸 아이콘 · 나쁜 일 (치이카와 풍으로 다시) | 1:1 | 없음 |
| `icon-goal` | 칸 아이콘 · 골 (치이카와 풍으로 다시) | 1:1 | 없음 |

<details><summary>프롬프트 보기</summary>

**`icon-money`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single board-game tile icon: a green money bag tied with a string, with a white Korean won sign (₩) on it. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-love`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single board-game tile icon: a glossy red heart. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-job`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single board-game tile icon: a navy blue leather briefcase. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-house`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single board-game tile icon: a small cozy house with a red roof, chimney and a patch of grass. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-treasure`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single board-game tile icon: an open wooden treasure chest overflowing with gold coins and a blue gem. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-card`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single board-game tile icon: a single playing card with a red heart symbol, tilted slightly. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-shop`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single board-game tile icon: a yellow shopping bag with blue handles and a small flower sticking out. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-stop`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single board-game tile icon: a red octagonal stop sign shape without any letters. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-bad`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single board-game tile icon: a yellow triangular warning sign with a black exclamation mark. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-goal`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single board-game tile icon: a shiny golden trophy cup. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

</details>

### 묶음 38 (10장)

| id (파일 이름) | 내용 | 비율 | 참조 |
|---|---|:---:|---|
| `icon-school` | 칸 아이콘 · 학교 (치이카와 풍으로 다시) | 1:1 | 없음 |
| `icon-lottery` | 칸 아이콘 · 로또 (치이카와 풍으로 다시) | 1:1 | 없음 |
| `bg-wedding-hall` | 배경 · 파티장 (예전 웨딩홀 자리) | 16:9 | `bg-park` |
| `frame-love` | 컷인 테두리 무늬 · 단짝 | 1:1 | 없음 |
| `frame-career` | 컷인 테두리 무늬 · 직업 | 1:1 | 없음 |
| `frame-treasure` | 컷인 테두리 무늬 · 보물·돈 | 1:1 | 없음 |
| `frame-good` | 컷인 테두리 무늬 · 좋은 일 | 1:1 | 없음 |
| `frame-bad` | 컷인 테두리 무늬 · 나쁜 일 | 1:1 | 없음 |
| `frame-holiday` | 컷인 테두리 무늬 · 명절 | 1:1 | 없음 |
| `frame-result` | 컷인 테두리 무늬 · 결과 발표 | 1:1 | 없음 |

<details><summary>프롬프트 보기</summary>

**`icon-school`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single board-game tile icon: a black graduation cap with a golden tassel. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`icon-lottery`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single board-game tile icon: a colorful lottery ticket with small circles, no readable text. Simple flat pastel colours, soft thin warm-grey outline, cute and round. Square 1:1. ONE object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

**`bg-wedding-hall`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a bright cute party hall: a small stage with a flower arch, pastel balloons, ribbon garlands, a long table with a cake, a soft pink carpet. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text, no letters. Leave open empty ground in the lower centre for characters to stand.
```

**`frame-love`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A cute flat seamless repeating pattern tile (the left/right and top/bottom edges must continue into each other), colors pastel pink and white, small hearts and ribbons, small simple motifs evenly scattered on a soft solid pastel background, low contrast so text on top stays readable. Square 1:1, pattern only, no text, no border.
```

**`frame-career`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A cute flat seamless repeating pattern tile (the left/right and top/bottom edges must continue into each other), colors sky blue and white, small briefcases, stars and paper planes, small simple motifs evenly scattered on a soft solid pastel background, low contrast so text on top stays readable. Square 1:1, pattern only, no text, no border.
```

**`frame-treasure`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A cute flat seamless repeating pattern tile (the left/right and top/bottom edges must continue into each other), colors warm gold and cream, small coins, gems and tiny houses, small simple motifs evenly scattered on a soft solid pastel background, low contrast so text on top stays readable. Square 1:1, pattern only, no text, no border.
```

**`frame-good`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A cute flat seamless repeating pattern tile (the left/right and top/bottom edges must continue into each other), colors fresh green and white, four-leaf clovers and small sparkles, small simple motifs evenly scattered on a soft solid pastel background, low contrast so text on top stays readable. Square 1:1, pattern only, no text, no border.
```

**`frame-bad`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A cute flat seamless repeating pattern tile (the left/right and top/bottom edges must continue into each other), colors deep navy and slate blue, small rain clouds and raindrops, small simple motifs evenly scattered on a soft solid pastel background, low contrast so text on top stays readable. Square 1:1, pattern only, no text, no border.
```

**`frame-holiday`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A cute flat seamless repeating pattern tile (the left/right and top/bottom edges must continue into each other), colors festive red and gold, traditional Korean cloud patterns and small lucky pouches (bokjumeoni), small simple motifs evenly scattered on a soft solid pastel background, low contrast so text on top stays readable. Square 1:1, pattern only, no text, no border.
```

**`frame-result`**

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A cute flat seamless repeating pattern tile (the left/right and top/bottom edges must continue into each other), colors royal purple and gold, small crowns, trophies and confetti, small simple motifs evenly scattered on a soft solid pastel background, low contrast so text on top stays readable. Square 1:1, pattern only, no text, no border.
```

</details>

## 받은 뒤에 (이쪽에서 할 일)

zip을 받으면 `node scripts/import-assets.js --dir <폴더> --dry-run`으로 이름·짝을 확인하고 바로 가져와요. 캐릭터는 자동으로 위치를 맞추고, 팔·눈·입·표정 조각을 잘라 애니메이션에 씁니다. 결과는 게임 화면 캡처로 보여 드릴게요.
