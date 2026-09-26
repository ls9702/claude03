# 인생게임 (HTTP 턴제 멀티플레이)

브라우저로 접속하는 턴제 인생게임 서버. 라즈베리파이 4에서 Node.js 단일 프로세스로 구동합니다.
전체 설계는 [`docs/PLAN.md`](docs/PLAN.md)를 참고하세요. (현재: 2단계 엔진 코어 + 2D 간이 보드)

## 실행

Node.js 20 이상이 필요합니다.

```bash
npm install
ADMIN_PASSWORD=원하는비밀번호 npm start     # 개발 중 자동 재시작: npm run dev
```

- 게임 페이지: `http://<서버주소>:3000/`
- 관리자 페이지: `http://<서버주소>:3000/admin`

| 환경변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `3000` | 서버 포트 |
| `ADMIN_PASSWORD` | `admin` | 관리자 비밀번호 (설정하지 않으면 시작 시 경고) |
| `DATA_DIR` | `./data` | 방 스냅샷(`saves/<roomId>.json`)·세션 저장 폴더 |

## 사용 흐름

1. `/admin`에서 로그인 → 모드·시대별 턴 수·최대 캐릭터·초기 자금을 정해 방 생성 → 6자리 방 코드 확인.
2. 참가자는 `/`에서 방 코드와 이름으로 입장(`/?code=ABC123` 링크도 가능) → 캐릭터를 꾸며 여러 명 생성.
3. 관리자가 캐릭터 2명 이상일 때 게임 시작 → 시드로 시대별 보드가 생성되고 가문 순서로 턴이 돈다.
4. 내 캐릭터 차례에 「룰렛 돌리기」(1~10). 청년·중년 시대 시작의 「인생 갈림길」에서 💕 연애·육아 / 💼 일·커리어 /
   💰 보물·부동산·금전 루트를 고르고, 시대 끝 합류 칸에서 다시 만난다. 고등 시대 첫 칸은 수능(정지칸).
5. 남의 턴(룰렛 전)에는 **훈수 베팅**: 홀/짝(×2) 또는 1~3·4~7·8~10(×3)에 5~20만원. 룰렛이 돌면 마감·정산.
6. 생일 파티 같은 **동시 입력** 이벤트는 모든 대상이 답하거나 제한 시간(20초)이 지나면 기본 선택으로 처리된다.
7. 노년 진입 시 하위 2명(3캐릭터 이상)은 **기초연금**(역전 보정). 골인 순서대로 상금, 골인 후엔 매 턴 보너스 룰렛.
8. 모두 골인하면 결과 발표(현금 − 빚 순위). 관리자는 강제 종료(현재 자산 순위)·선택 강제 시간초과가 가능하다.

규칙 수치는 `server/data/board.json`(칸 풀·가중치·루트 풀·이벤트), `balance.json`(룰렛·베팅·연금·골인 상금),
`eras.json`(시대·기본 턴 수)에서 조정한다.

## 테스트

```bash
npm test                                        # 단위·HTTP 테스트 (node:test)
node scripts/simulate.js --games 200 --seed 1   # 랜덤 결정 풀 게임 시뮬레이션 (예외 0건 확인 + 통계)
```

## 에셋 스튜디오 (3단계, Gemini 이미지 생성)

게임 그래픽(컷인 배경·캐릭터 레이어·키포즈·스프라이트·아이콘·텍스처·프레임)은 Gemini
(`gemini-2.5-flash-image`, "Nano Banana")로 생성해 `public/assets/generated/`에 저장합니다.
에셋이 아직 없으면 게임은 SVG/프리미티브 자리표시자를 그대로 씁니다.

- 키 설정: 환경변수 `GEMINI_API_KEY`(우선) 또는 `/admin/assets`에서 입력 → `data/secrets.json`(권한 600, gitignore).
  키는 브라우저·응답·로그로 절대 나가지 않습니다.
- 관리자 화면 `http://<서버주소>:3000/admin/assets`: 항목 선택 → 프롬프트 수정(선택) → **변형 4장 생성** →
  후보 미리보기 → **채택** / 재생성 / 이미지 **업로드로 교체**. 채택하면 `public/assets/generated/<output>`에
  저장되고 `server/assets/manifest.json`의 상태가 `accepted`로 바뀝니다(둘 다 커밋 대상).
- 순서: 스타일 앵커(`style-anchor`)를 먼저 채택해야 나머지(참조 이미지로 첨부)를 만들 수 있고,
  키포즈·표정·의상은 캐릭터 베이스(`char-schoolgirl-base`) 채택 후 생성됩니다.
- 배치 CLI:

```bash
node scripts/gen-assets.js --only style-anchor --accept-first   # 1장 생성 후 바로 채택
node scripts/gen-assets.js --kind bg --count 2                   # 배경 전부 후보 2장씩
node scripts/gen-assets.js --all --accept-first --dry-run        # 호출 수만 미리 보기
```

| 환경변수 | 기본값 | 설명 |
|---|---|---|
| `GEMINI_API_KEY` | (없음) | Gemini API 키. 없으면 생성 불가(업로드·기존 에셋은 동작) |
| `GEMINI_MODEL` | `gemini-2.5-flash-image` | 이미지 모델 ID (매니페스트 `settings.model`보다 우선) |
| `ASSET_DAILY_CAP` | `300` | 하루(UTC) 최대 생성 호출 수. 사용량은 `data/assets-usage.json` |

안전장치: 동시 요청 2개, 429/5xx 재시도 3회(지수 백오프), 일일 한도, 채택된 에셋은 강제 재생성 전까지 다시 만들지 않음.
후보 이미지는 `data/asset-candidates/<id>/`에 쌓이며 관리자 화면에서 지울 수 있습니다.
