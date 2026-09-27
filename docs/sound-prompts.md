# 사운드 에셋 가이드

소리 파일이 하나도 없어도 게임은 돌아갑니다. 효과음과 배경음을 브라우저에서 즉석으로 만들어 냅니다.
아래 이름으로 파일을 넣으면 그 파일이 우선 재생됩니다. 필요한 것만 골라 넣어도 됩니다.

## 전달 방법

1. 파일을 구하거나 만듭니다. 형식은 mp3, ogg, m4a, wav 중 하나이고, 파일 하나에 10MB 이하로 맞춥니다.
2. 파일 이름을 아래 표의 **이름**으로 바꿉니다(예: `bgm_baby.mp3`).
3. GitHub의 `assets-inbox/` 폴더에 올리거나 채팅으로 보내 주시면 됩니다.
   - 채팅 첨부가 소리 파일을 지원하지 않으면 GitHub 방법을 쓰세요.
4. 제가 게임에 넣고, 음량과 반복 재생 구간을 확인합니다.

## 어디서 구하나

**배경음악(BGM)**
- **Suno**(suno.com)나 **Udio**에서 아래 프롬프트를 넣고 만들면 됩니다.
- 가사 없는 연주곡(Instrumental)을 켜세요.
- 1~2분 길이로, 처음과 끝이 자연스럽게 이어지는 곡이 좋습니다.

**효과음**
- **Pixabay 효과음**(pixabay.com/sound-effects)이나 **freesound.org**에서 아래 검색어로 찾아 받으면 됩니다.
- 짧은 것(0.2~2초)을 고르세요.

**호야·봄이 짖는 소리**
- 실제 호야·봄이 소리를 휴대폰으로 녹음해 주시면 가장 좋습니다.
- 한 번 짖는 소리만 1초 안쪽으로 잘라 주세요.

## 1. 배경음악 (반복 재생, 1~2분)

| 이름 | 쓰이는 곳 | Suno 프롬프트(영문) |
|---|---|---|
| `bgm_title.mp3` | 로비·대기실 | `cheerful Korean board game lobby music, playful marimba and ukulele, light percussion, warm and welcoming, instrumental, seamless loop` |
| `bgm_baby.mp3` | 아기 시대 | `gentle music box lullaby, glockenspiel and soft pizzicato strings, cute and warm, slow tempo, instrumental, seamless loop` |
| `bgm_elem.mp3` | 초등학생 | `bouncy elementary school recess music, recorder, xylophone and hand claps, happy and silly, instrumental, seamless loop` |
| `bgm_middle.mp3` | 중학생 | `upbeat pop-rock for a teen school life anime, acoustic guitar and light drums, energetic but light, instrumental, seamless loop` |
| `bgm_high.mp3` | 고등학생 | `youthful Korean drama high school theme, piano and strings with soft beat, hopeful and slightly nostalgic, instrumental, seamless loop` |
| `bgm_young.mp3` | 청년 | `bright city-pop inspired track, funky bass, electric piano and synth, confident and fun, instrumental, seamless loop` |
| `bgm_middle_age.mp3` | 중년 | `warm jazzy lounge music, brushed drums, upright bass, saxophone, relaxed and mature, instrumental, seamless loop` |
| `bgm_senior.mp3` | 노년 | `peaceful Korean traditional fusion, gayageum and daegeum with soft piano, calm and heartwarming, instrumental, seamless loop` |
| `bgm_holiday.mp3` | 명절 대잔치 | `festive Korean folk fusion for Lunar New Year, janggu drums, kkwaenggwari and cheerful brass, lively celebration, instrumental, seamless loop` |
| `bgm_studio.mp3` | 호야·봄이 방송국 | `goofy TV variety show background music, pizzicato, kazoo and bongo, comedic and bouncy, instrumental, seamless loop` |
| `bgm_result.mp3` | 결과 발표 | `grand award ceremony music, orchestral fanfare build-up, drum roll into triumphant brass, instrumental` |

## 2. 짧은 징글 (2~5초, 한 번만 재생)

Suno로 만들 때는 짧게 만든 뒤 앞부분만 잘라 쓰세요.

| 이름 | 쓰이는 곳 | 프롬프트 / 검색어 |
|---|---|---|
| `jingle_wedding.mp3` | 결혼 | `short wedding bells jingle, church bells and harp glissando, joyful, 4 seconds` |
| `jingle_birth.mp3` | 출산 | `short cute baby celebration jingle, music box and sparkle chimes, 3 seconds` |
| `jingle_rankup.mp3` | 승진·취업 | `short level up fanfare, brass and cymbal, triumphant, 3 seconds` |
| `jingle_hidden_job.mp3` | 숨은 직업 해금 | `short magical secret unlock jingle, harp sweep and bells, mysterious then triumphant, 4 seconds` |
| `jingle_goal.mp3` | 골인 | `short victory fanfare, trumpets and timpani, 4 seconds` |
| `jingle_bad.mp3` | 나쁜 일·파산 | `short comedic sad trombone wah-wah, 2 seconds` |
| `jingle_era.mp3` | 새 시대 시작 | `short page turn transition sting, whoosh and bright chime, 2 seconds` |
| `jingle_lotto.mp3` | 로또 당첨 | `short jackpot slot machine win jingle, coins and bells, 3 seconds` |
| `jingle_holiday.mp3` | 명절 시작 | `short Korean traditional drum and gong festive sting, 3 seconds` |

## 3. 효과음 (0.2~2초)

| 이름 | 쓰이는 곳 | 검색어(Pixabay/freesound) |
|---|---|---|
| `sfx_tick.mp3` | 룰렛 돌아가는 틱 | `roulette tick`, `wheel click` |
| `sfx_coin.mp3` | 돈 받음 | `coin pickup`, `coins` |
| `sfx_thud.mp3` | 돈 잃음·나쁜 칸 | `cartoon thud`, `bonk` |
| `sfx_fanfare.mp3` | 좋은 일 | `short fanfare`, `success` |
| `sfx_heart.mp3` | 연애·하트 | `cute pop heart`, `romantic chime` |
| `sfx_whoosh.mp3` | 컷인 전환 | `whoosh transition` |
| `sfx_pop.mp3` | 버튼·말 이동 | `bubble pop`, `ui pop` |
| `sfx_tears.mp3` | 슬픈 일 | `sad violin short`, `cartoon cry` |
| `sfx_babble.mp3` | 캐릭터 대사 | `cartoon gibberish`, `animal crossing voice` |
| `sfx_bark.mp3` | 호야·봄이 공용 | `small dog bark` (또는 실제 녹음) |
| `sfx_bark_hoya.mp3` | 호야 전용 | 호야 녹음(높고 짧게 두 번) |
| `sfx_bark_bomi.mp3` | 봄이 전용 | 봄이 녹음(낮게 한 번) |
| `sfx_card.mp3` | 카드 뽑기·사용 | `card flip`, `card shuffle` |
| `sfx_register.mp3` | 상점 구매 | `cash register` |
| `sfx_camera.mp3` | 단체 사진 | `camera shutter` |
| `sfx_drumroll.mp3` | 결과 발표 직전 | `drum roll` |
| `sfx_applause.mp3` | 시상·박수 | `applause short` |
