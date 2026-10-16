# assets-inbox

Gemini 앱 / 로컬 Gemini 스킬에서 만든 그림을 이 폴더에 올려 주세요.

- 파일 이름 = 에셋 id + 확장자 (예: `mc-hoya-neutral.png`, `bg-stage.png`, `card-taxi.png`, `ch-usagi-base.png`)
- 같은 그림의 원본 JPG는 `<id>_original.jpg`, 두 번째 장은 `<id>-2.png` 로 두면 돼요 (PNG 첫 장을 먼저 써요.
  두 번째 장은 `--take 2` 또는 `--take <id>=2` 일 때, 또는 첫 장이 없을 때만 써요).
- 요청서 이름도 그대로 받아요: `ch-<캐릭터>-noarms` → 몸 + 팔 자동 추출, `ch-<캐릭터>-cry` → 울음 표정,
  `npc-friend-<종>` → 단짝 후보, `bg-ch-<장면>` → 배경, `prop-hat-chef` → 셰프 모자.
- 치이카와 그림 요청서는 `docs/asset-requests/chiikawa-*.md`, 예전 프롬프트는 `docs/asset-prompts.md`
- 올린 뒤 채팅으로 알려 주면 `node scripts/import-assets.js`로 배경 제거·배치·파츠 추출 후 게임에 반영하고, 처리한
  원본은 (다른 장까지) 이 폴더에서 지웁니다. zip은 `assets-inbox/<묶음 이름>/`에 풀고 `--dir`로 가리켜도 돼요.
