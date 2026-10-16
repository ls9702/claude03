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

1. **CPU 약화**: 사람(무작위 정책이 아닌 "평범한 사람" 기준)이 CPU를 상대로 9할 이상 이기도록. 측정 `scripts/cpu-game.js`, `scripts/simulate.js --policy mixed`.
2. **CPU 성향 선택**: 관리자 `POST /admin/api/rooms/:id/cpu {personality}`, 방장 `POST /api/rooms/:id/cpu {personality}`, 관리자 화면·로비 CPU 도구에 🐢 신중 / 🙂 보통 / 🔥 대담 (+ 무작위).
3. **테스트 시간** 단축(목표 10초 미만).
4. **3D 개요 카메라**(81칸 순환 맵이 한 화면에 안 들어옴), **시대 전환 렉**, **CPU 셰프 0.1 %**.
5. **통합 E2E**(Sonnet 4명: 실제 멀티플레이 플레이테스트 / 규칙·안정성 퍼징 / UI 몽키 / 밸런스) — 버그만 찾고 수정은 사용자와 협의.
6. 관리자 에셋 페이지 종류 필터에 새 kind(chara, prop) 추가.
7. 10단계: systemd, README(라즈베리파이), 저장 복원 확인, BGM 시대 전환, 치킨 내기 정산표.

## 6. 작업 방식

- 구현은 Opus 서브에이전트, 오케스트레이터(나)가 검증(`npm test`, 시뮬레이션, Playwright 스크린샷)하고 커밋·푸시.
- Playwright: `require('/opt/node22/lib/node_modules/playwright')`, Chromium 인자 `--use-gl=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`. `playwright install` 금지.
- 계약 문서·E2E 스크립트는 세션 스크래치패드(`loop-contract.md`, `cards-contract.md`, `chiikawa-contract.md` 등)에 있다 — 새 세션에서는 사라질 수 있으니 핵심 사실은 CLAUDE.md에 남긴다.
