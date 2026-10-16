# 치이카와 모드 그림 요청 (로컬 Gemini 스킬용) — 새 장소·키메라·아이템·소품

치이카와 모드에 새로 들어간 것들의 그림이에요. **25장**, 3묶음입니다. 그림이 오기 전까지 게임은 SVG로 그려 두었으니 급하지 않아요. 본편(`chiikawa-full`)·MC(`chiikawa-mc`) 다음에 천천히 만들어 주세요.

## 로컬 Claude에게 시킬 일

1. 묶음 순서대로, 각 항목 **1장씩** 만듭니다. 프롬프트는 그대로 복사(영문).
2. 배경은 **참조 이미지** `bg-park` → 테스트 때 만든 `bg-ch-park-2.png`를 첨부해 같은 그림체로 요청합니다.
3. 비율: 배경 **16:9**, 나머지(키메라·아이템·소품) **1:1**. 키메라·아이템·소품은 **흰 배경**이어야 자동으로 잘라 쓸 수 있어요.
4. 결과는 `<id>.png` 이름으로 한 폴더에 모아 zip으로 보내 주세요(원본 JPG는 `<id>_original.jpg`).
5. 키메라는 **왼쪽을 바라보게**(게임에서 캐릭터와 마주 봄), 무섭지 않고 웃기게.

## 공통 그림체 문장 (프롬프트에 이미 들어 있음)

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border.
```

## 묶음 1 (10장)

### `bg-weed-field` — 배경 · 풀밭 (풀뽑기 검정)

- 비율 16:9 · 참조: `bg-park`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a sunny grassy field full of tall weeds, clover and little flowers, a low wooden fence, a small woven basket of pulled weeds, a pale blue sky with fluffy clouds. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text, no letters. Leave open empty ground in the lower centre for characters to stand.
```

### `bg-hunt-forest` — 배경 · 토벌 숲

- 비율 16:9 · 참조: `bg-park`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a slightly mysterious but cute forest clearing: tall round dark-green trees, bushes with two little glowing eyes peeking out, red-capped mushrooms, a narrow dirt path, soft light beams through the leaves. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text, no letters. Leave open empty ground in the lower centre for characters to stand.
```

### `bg-ramen-shop` — 배경 · 라멘 가게 「郎」

- 비율 16:9 · 참조: `bg-park`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a cozy small ramen shop interior: a wooden counter with steaming ramen bowls, a short yellow noren curtain at the top, round paper lanterns, a warm dark-brown wall. (If you add the noren, it may show the single kanji 郎; no other text.) Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text, no letters. Leave open empty ground in the lower centre for characters to stand.
```

### `bg-workshop` — 배경 · 갑옷씨 공방

- 비율 16:9 · 참조: `bg-park`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a small armor-maker workshop: a wooden workbench with hammers and tongs, a few rounded helmets and armor plates on shelves, a little anvil, warm light from a window. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text, no letters. Leave open empty ground in the lower centre for characters to stand.
```

### `bg-sento` — 배경 · 목욕탕

- 비율 16:9 · 참조: `bg-park`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a traditional public bathhouse (sento) interior: a big tiled bath with steam, a mountain mural painted on the wall, small wooden buckets and stools, pale blue tiles. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text, no letters. Leave open empty ground in the lower centre for characters to stand.
```

### `bg-bookstore` — 배경 · 고서점

- 비율 16:9 · 참조: `bg-park`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a quiet old secondhand bookstore: tall wooden shelves packed with books, small piles of old books on the floor, a little counter with a desk lamp, warm cosy light. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text, no letters. Leave open empty ground in the lower centre for characters to stand.
```

### `bg-cafe` — 배경 · 카페

- 비율 16:9 · 참조: `bg-park`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a cute small cafe interior: a counter with a coffee machine and cakes in a glass case, round tables, potted plants, a big window with soft daylight. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text, no letters. Leave open empty ground in the lower centre for characters to stand.
```

### `bg-kuji` — 배경 · 쿠지 가게

- 비율 16:9 · 참조: `bg-park`

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a cheerful prize-draw (kuji) shop counter: a big red box with a hole on top, prize shelves behind it with a giant plush toy, gift boxes, cards and a ramen coupon, a striped awning. Use exactly the same soft pastel crayon-like art style, colours and line quality as the attached background, but draw this completely different place. Landscape 16:9. Scenery only, no characters, no people, no animals, no text, no letters. Leave open empty ground in the lower centre for characters to stand.
```

### `monster-small-chimera` — 키메라 · 꼬마 키메라

- 비율 1:1

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a tiny purple chimera shaped like a chubby round caterpillar of three or four soft segments, two small yellow horns, big round googly eyes, a tiny fang, little stubby feet. Square 1:1. ONE monster, full body, three-quarter view facing LEFT, centred, filling about 75% of the square, plain pure white background #FFFFFF, no floor, no shadow, no text. It must look silly and cute, never scary or gory.
```

### `monster-chimera` — 키메라 · 키메라

- 비율 1:1

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a medium purple chimera with a round lumpy body, two curved cream horns, a row of orange back spikes, big googly eyes, a wide grin with two little fangs, short stubby legs. Square 1:1. ONE monster, full body, three-quarter view facing LEFT, centred, filling about 75% of the square, plain pure white background #FFFFFF, no floor, no shadow, no text. It must look silly and cute, never scary or gory.
```

## 묶음 2 (10장)

### `monster-big-chimera` — 키메라 · 커다란 키메라

- 비율 1:1

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a big orange dinosaur-like chimera standing upright, a cream belly, teal back spikes, a long curly tail, big googly eyes and a toothy silly grin, tiny arms. Square 1:1. ONE monster, full body, three-quarter view facing LEFT, centred, filling about 75% of the square, plain pure white background #FFFFFF, no floor, no shadow, no text. It must look silly and cute, never scary or gory.
```

### `monster-dekatsuyo` — 키메라 · 데카츠요 (대형 보스)

- 비율 1:1

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a huge dark-purple boss chimera with a big dome-shaped body, three yellow eyes in a row, a wide mouth full of small white triangle teeth, yellow spikes on top, small bat wings, short thick legs — big and strong but still comical. Square 1:1. ONE monster, full body, three-quarter view facing LEFT, centred, filling about 75% of the square, plain pure white background #FFFFFF, no floor, no shadow, no text. It must look silly and cute, never scary or gory.
```

### `item-armor` — 아이템 · 갑옷

- 비율 1:1

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game item icon: a small shiny grey suit of chest armor with a round helmet resting on top, rivets, a little red plume. Square 1:1. One object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

### `item-guitar` — 아이템 · 하치와레표 기타

- 비율 1:1

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game item icon: a cute small acoustic guitar with a warm orange-brown body, a cream sound hole ring and a blue strap. Square 1:1. One object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

### `treasure-kuji-plush` — 보물 · 커다란 치이카와 인형

- 비율 1:1

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. A single game item icon: a big soft plush toy of a small round white bear-like creature with tiny round ears, dot eyes and pink blush, sitting, with a yellow ribbon around its neck (a prize-draw first prize). Square 1:1. One object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

### `prop-sasumata` — 소품 · 사스마타 (손)

- 비율 1:1

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a sasumata: a long wooden pole with a U-shaped metal fork at the top, standing upright. A small game costume prop with a thin warm-grey outline. Square 1:1. One object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

### `prop-armor-helmet` — 소품 · 갑옷 투구 (머리)

- 비율 1:1

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a small rounded grey metal knight helmet without a face visor, with a small red plume on top. A small game costume prop with a thin warm-grey outline. Square 1:1. One object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

### `prop-guitar` — 소품 · 기타 (등)

- 비율 1:1

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a small acoustic guitar with a strap, seen from the back as if worn on the back. A small game costume prop with a thin warm-grey outline. Square 1:1. One object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

### `prop-head-towel` — 소품 · 머리 수건 (머리)

- 비율 1:1

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a white towel tied around as a headband with a knot on the side (like a ramen cook). A small game costume prop with a thin warm-grey outline. Square 1:1. One object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

### `prop-weed-basket` — 소품 · 풀 바구니 (등)

- 비율 1:1

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a small woven straw basket backpack full of pulled green weeds. A small game costume prop with a thin warm-grey outline. Square 1:1. One object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

## 묶음 3 (5장)

### `prop-ladle` — 소품 · 국자 (손)

- 비율 1:1

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a wooden ramen ladle (a small deep metal cup on a long wooden handle), upright. A small game costume prop with a thin warm-grey outline. Square 1:1. One object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

### `prop-hammer` — 소품 · 망치 (손)

- 비율 1:1

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a small wooden hammer with a grey metal head, upright. A small game costume prop with a thin warm-grey outline. Square 1:1. One object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

### `prop-turner` — 소품 · 뒤집개 (손)

- 비율 1:1

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a pancake turner spatula with a wide flat metal blade and a wooden handle, upright. A small game costume prop with a thin warm-grey outline. Square 1:1. One object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

### `prop-delivery-box` — 소품 · 배달 상자 (등)

- 비율 1:1

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a square red delivery box backpack with shoulder straps. A small game costume prop with a thin warm-grey outline. Square 1:1. One object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```

### `prop-armor-plate` — 소품 · 갑옷 등판 (등)

- 비율 1:1

```text
Chiikawa (manga by Nagano) art style: soft thin warm-grey outlines, simple round chubby shapes, flat pastel colours with almost no shading, tiny black dot eyes with a small white highlight, small pink blush ovals on the cheeks, cute and gentle. Clean digital illustration, no text, no watermark, no border. a rounded grey metal back armor plate with leather straps, seen from the back. A small game costume prop with a thin warm-grey outline. Square 1:1. One object centred, filling about 75% of the square, plain pure white background #FFFFFF, no shadow, no text, no letters, no numbers.
```
