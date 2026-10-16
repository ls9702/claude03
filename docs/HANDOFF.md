# 인계 문서 (HANDOFF) — 2026-10-16

이 문서는 대화 맥락이 압축될 때 작업을 이어받기 위한 요약이다. 세부 규칙·계약은 `CLAUDE.md`(구현 사실)와 `docs/PLAN.md`(설계·로드맵)가 기준이다.

## 1. 현재 상태

- 브랜치 `claude/admiring-gates-1qlocc` (저장소 `ls9702/claude03`, **공개 저장소** — 비공개 전환은 사용자 작업).
- 최근 커밋: `48f79bb` 순환 맵 → `4406ac3` 파랑/빨강 카드 → `fa60ac2` 치이카와 전환 CH-1 → `9b7e5a3` CH-2 그림 가져오기 파이프라인 + 테스트 그림. 전부 푸시됨.
- `npm test` 522건 통과, 약 17초(4코어 머신; 목표 10초 미만은 아직 미달).
- 로드맵: 1~9단계 + 5.5/5.6 + 시뮬레이션 수정 + 룰렛 실력 모드 + 순환 맵(11) + 파랑/빨강 카드(12) + 치이카와(13) 완료. **10단계(배포·마무리)는 미착수.**

## 2. 사용자 결정 (유지)

- 게임 길이: 8캐릭터 기준 약 100분, 캐릭터당 결정 약 34회 — **적당함(그대로)**.
- **CPU 승률을 낮춰서 사람이 웬만하면 9할 이상 이기게.**
- **CPU 추가 시 성향(신중/보통/대담) 선택 가능.**
- 테스트 시간·3D 개요 카메라·전환 렉·CPU 셰프 0.1 % 문제: 오케스트레이터 재량.
- 사운드 에셋: 뒤로 미룸(계획만 있음: 효과음 약 90 + 캐릭터 음성, 사용자가 직접 자른 유튜브 클립은 git에 넣지 않음, Suno BGM, ffmpeg 가져오기 도구).
- 그림: 사용자가 로컬 Gemini 스킬로 천천히 만들어 zip으로 전달 → `node scripts/import-assets.js --dir assets-inbox/<batch> [--dry-run] [--take <id>=2]`.
- TV + 휴대폰 컨트롤러 모드: 10단계 이후.
- 비상업 개인용. 공식 치이카와 이미지는 가져오지 않는다.

## 3. 절대 규칙

- **Gemini API 사용 금지**(과금): 키 설정·API 호출·`scripts/gen-assets.js`·`part-qa.js --fix` 실행 금지. 그림은 사용자 로컬 스킬이 `docs/asset-requests/*.json` 요청서대로 생성.
- 비밀(키) 커밋 금지. 강아지 사진은 `DATA_DIR/mc-refs`(gitignore)에만. 저작권 음원은 저장소에 넣지 않음.
- 작업·푸시는 이 브랜치만, PR은 요청 시에만. 커밋 메시지 끝에 Co-Authored-By / Claude-Session 줄, 그 밖의 곳에 모델 이름 금지.
- 사용자에게는 **항상 한국어**로 설명.

## 4. 그림(에셋) 요청 현황

| 요청서 | 내용 | 상태 |
|---|---|---|
| `docs/asset-requests/chiikawa-test.json` | 테스트 10장 | 가져오기 완료(치이카와 기본·몸·팔·눈감음·입벌림·울음·점프 시트, 하치와레 기본, 펭귄, 셰프 모자, 공원 배경) |
| `docs/asset-requests/chiikawa-full.json` / `.md` | 본편 95장(10묶음: 캐릭터 6종 + 치이카와/하치와레 나머지, NPC 10, 반려동물 8, 배경 21) | 사용자 생성 대기 |
| `docs/asset-requests/chiikawa-mc.json` / `.md` | 호야·봄이 치이카와풍 25장 | 사용자 생성 대기 |
| 소품 60종 요청서 | 아직 미작성(후순위) | — |

그림이 없는 항목은 SVG 리그(`ui/chara.js`)·기존 그림으로 동작한다. 그림이 들어오면 화풍이 섞이는 기간이 있다(소품 59/60 벡터, 옛 애니풍 배경·프레임·MC).

## 5. 남은 일 (이 문서 작성 시점)

1. ~~**CPU 약화**~~ **완료**: 진짜 CPU = 성향별 선호표(`balance.json` `cpu`, 🐢 소심·🔥 무모) + 사람 상대 핸디캡(시작 자금 20 %·월급/돈 칸 수입 45 %·보물 감정가 30 %, CPU끼리만 하는 방은 그대로). `node scripts/cpu-game.js --matrix --games 300` (300판 × seed 1/2): 평범한 사람 1 + CPU 3 사람 1위 15 → 97.0/97.7 %, 무작위 사람 1 + 3 10 → 90.0/88.7 %, 평범 2 + 2 → 99.7/99.0 %, 평범 4 + 4 → 100/99.7 %, 고수(옛 CPU 휴리스틱) 1 + 3 → 99.7/100 %. CPU 셰프 0.1 → 1.7 % (꿈의 직업). 옛 강한 휴리스틱은 `level: 'hard'`로 남김.
2. ~~**CPU 성향 선택**~~ **완료**: 관리자 `POST|PATCH /admin/api/rooms/:id/cpu[/:charId] {personality}`, 방장 `POST|PATCH /api/rooms/:id/cpu[/:charId]`, 관리자 화면·로비 CPU 도구에 🎲 무작위 / 🐢 신중 / 🙂 보통 / 🔥 대담 선택 + CPU 칩마다 성향 변경, 로비 카드·게임 옆 목록·상세 카드에 성향 표시.
3. **테스트 시간** 단축(목표 10초 미만).
   - ✅ 완료 (2026-10-16): `npm test` = `scripts/run-tests.js` (CPU 코어 수만큼 병렬 샤드, 샤드마다 한 프로세스에서 파일을 이어서 실행) + 엔진 방 복사 `cloneState`(structuredClone 대비 ≈ 5배) + 워터마크 탐색 최적화(결과 동일) + 무거운 LEGACY 픽셀 테스트를 `npm run test:legacy`로 분리. 측정(531개 통과): 한가할 때 6.3 / 6.8 / 8.1 초, 다른 에이전트 부하(load 9–13) 중 10.2 / 10.4 / 11.1 초(같은 부하에서 예전 방식 `node --test` 26 초). CPU 합계 ≈ 45 → 21 초. 파일별 프로세스 방식은 `npm run test:isolated`.
4. **3D 개요 카메라**(81칸 순환 맵이 한 화면에 안 들어옴), **시대 전환 렉**, ~~CPU 셰프 0.1 %~~ (1.7 %, 위 1번).
   - ✅ **카메라·렉 완료**(2026-10-16): 「🗺️ 전체 보기 ↔ 🎯 따라가기」 버튼(캔버스 좌상단, `jinsei.boardView` 기억) + 순수 카메라 맞춤 계산 `scene/camfit.js`(캔버스 비율·세로 FOV로 정확히 맞춤, 스핀 독·룰렛·버튼 피함, 크기 변경·회전 시 다시 맞춤) — 1280×720·390×844·가로·TV 모든 시대에서 칸이 화면 밖으로 0개. 시대 전환은 다음 시대 지도를 마지막 라운드에 유휴 시간 조각으로 미리 만들고(`prepareEra`, `scene/chunks.js`) 화면 밖에서 업로드해 두어 전환 때는 교체만(본 스레드 17–103 ms → 0.1–0.3 ms, 전환 6초 안 가장 긴 작업 중앙값 117 → 60 ms, SwiftShader). 재료·아이콘 아틀라스·글자 텍스처는 시대끼리 공유. 자세한 내용은 CLAUDE.md "3D board (Stage 4)" / "Loop maps — client".
5. **통합 E2E**(Sonnet 4명: 실제 멀티플레이 플레이테스트 / 규칙·안정성 퍼징 / UI 몽키 / 밸런스) — 버그만 찾고 수정은 사용자와 협의.
6. 관리자 에셋 페이지 종류 필터에 새 kind(chara, prop) 추가.
7. 10단계: systemd, README(라즈베리파이), 저장 복원 확인, BGM 시대 전환, 치킨 내기 정산표.
8. **세계 설정(14단계)**: 서버(CW-A) 완료 — 방 설정 `world` 🐹 치이카와 모드(새 방 기본) / 🏙️ 현실 모드, 오버레이 `server/data/worlds/chiikawa.json` + 순수 모듈 `public/js/shared/world.js`(`worldData`), 토벌·풀뽑기 검정·쿠지 규칙, 치이카와 직업·아이템·카드·보물·이벤트·뉴스·대사, CPU, `simulate.js` / `cpu-game.js --world`. 클라이언트(CW-B) 완료: 방의 세계 메타(`worldMeta`), 토벌 전투 카드·풀뽑기 검정소 카드(컷인 + 2D 시트), 토벌·풀뽑기·쿠지 컷인(키메라 4종 SVG, 합격 도장, 쿠지 상자·티켓·1등 인형), 풀밭·토벌 숲·라멘 「郎」·쿠지 가게 SVG 배경, ⚔️/🌿 타일(2D 글리프, 3D 마커), 사이드 목록 🌿 n급·⚔️ 토벌 n회, 요구 조건 배지, 새 소품 10종 2D/3D 그림, 로비 세계 안내 줄. 계약: 세션 스크래치패드 `cworld-contract.md` / `cworld-deviations.md`, 사실은 CLAUDE.md "World setting".

## 6. 작업 방식

- 구현은 Opus 서브에이전트, 오케스트레이터(나)가 검증(`npm test`, 시뮬레이션, Playwright 스크린샷)하고 커밋·푸시.
- Playwright: `require('/opt/node22/lib/node_modules/playwright')`, Chromium 인자 `--use-gl=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`. `playwright install` 금지.
- 계약 문서·E2E 스크립트는 세션 스크래치패드(`loop-contract.md`, `cards-contract.md`, `chiikawa-contract.md` 등)에 있다 — 새 세션에서는 사라질 수 있으니 핵심 사실은 CLAUDE.md에 남긴다.
