# naver-commerce-api-docs-cli

Naver Commerce API Center 문서를 스크래핑하고, 정규화된 Markdown으로 변환하고, 조회/검증까지 수행하는 CLI입니다. npm 패키지에는 정규화된 `docs/`가 함께 포함되며, 모든 결과는 JSONL 형식으로 stdout에 출력됩니다.

성공한 명령은 `done` 뒤에 `guide` 이벤트를 추가로 출력합니다. 이 이벤트는 호출한 agent가 다음 단계에서 어떤 후속 명령을 쓰면 되는지 설명합니다.

## 요구 사항

- Node.js 18+
- npm 10+

## 로컬 개발

```bash
npm install
npm run check
npm run build
node dist/cli.js --help
```

Playwright 기반 명령어(`sync --latest`, `scrape --maintainer`, `scrape-api --maintainer`)를 사용할 때만 브라우저 설치가 필요합니다.

```bash
npx playwright install chromium
```

## 명령어

flat 명령은 유지하면서, agent가 쓰기 쉬운 그룹 명령과 최소 alias만 함께 제공합니다. 배포 패키지에는 정규화된 `docs/`가 동봉되므로, 일반적인 `npx` 사용자나 agent는 별도 scrape 없이 바로 조회를 시작하면 됩니다. `sync`, `scrape`, `scrape-api`는 명시 플래그가 있어야만 실행됩니다.

```bash
node dist/cli.js ask smartstore 인증하려면 어떻게 해야해
node dist/cli.js ask --format compact smartstore 인증하려면 어떻게 해야해
node dist/cli.js init
node dist/cli.js init --target codex,claude,cursor,gemini,antigravity
node dist/cli.js api --path /v2/products --method POST
node dist/cli.js api --query "group상품" --limit 5
node dist/cli.js api --doc-id v2-products-post
node dist/cli.js llms
node dist/cli.js transform
node dist/cli.js normalize
node dist/cli.js lint --summary
node dist/cli.js validate
node dist/cli.js lint --fix --src raws/commerce-api/current --dst docs --summary
node dist/cli.js review
node dist/cli.js noise
node dist/cli.js sync --latest
node dist/cli.js scrape --maintainer
node dist/cli.js scrape-api --maintainer
node dist/cli.js scrape-api --maintainer --out raws/commerce-api/current --dst docs
node dist/cli.js scrape-api --maintainer --no-normalize
node dist/cli.js docs api --path /v2/products --method POST
node dist/cli.js docs ask --format compact smartstore 인증하려면 어떻게 해야해
node dist/cli.js source normalize --src raws/commerce-api/current --dst docs
node dist/cli.js source sync --latest
node dist/cli.js check all
node dist/cli.js agent init
node dist/cli.js review --verbose
node dist/cli.js transform --debug
```

권장 구조는 아래처럼 보면 됩니다.

- `docs/*`: 조회와 LLM ingest 산출물 생성
- `source/*`: raw 수집과 정규화
- `check/*`: 검증 파이프라인
- `agent/*`: agent 환경 설치
- 단축 명령: `normalize`, `sync`, `validate`

일반 사용 흐름은 아래 두 단계면 충분합니다.

- 조회: `ask`, `api`
- 최신 동기화가 정말 필요할 때만: `sync --latest`

보수적 실행 가드는 아래와 같습니다.

- `sync`는 `--latest` 없이는 실행되지 않습니다.
- `scrape`, `scrape-api`는 `--maintainer` 없이는 실행되지 않습니다.
- 무플래그 호출 시 네트워크 작업 대신 JSONL `guide`로 `ask -> api -> sync --latest` 순서를 안내합니다.

`scrape`와 `scrape-api`는 기본적으로 raw 문서를 수집한 뒤 `docs/`에 정규화된 경로와 포맷으로 다시 적재합니다. 기존 정규화 산출물(`docs/api`, `docs/schema`, `docs/category`, `docs/guide`, `llms*.txt`)은 새 결과로 동기화되도록 먼저 정리합니다.

`lint --fix`는 지정한 raw source를 기준으로 `docs/`를 다시 정규화한 뒤 lint를 수행합니다. 현재 저장된 `docs/`를 정규화 구조로 재동기화할 때는 `raws/commerce-api/current`를 `--src`로 주면 됩니다.

출력 필터는 다음처럼 사용할 수 있습니다.

- 기본값: 결과 중심 JSONL만 출력
- `--verbose`: 단계별 요약 INFO 이벤트까지 출력
- `--debug`: `--verbose`에 더해 per-file / per-page DEBUG 이벤트까지 출력

## npx 사용 방식

배포 패키지는 `docs/`를 함께 포함하므로, 설치 직후 조회형 명령은 바로 사용할 수 있습니다. 일반적인 agent workflow는 `ask -> api -> implementation`이며, 최신화나 raw crawl은 기본 경로가 아닙니다.

```bash
npx naver-commerce-api-docs-cli --help
npx naver-commerce-api-docs-cli init
npx naver-commerce-api-docs-cli init --target codex,cursor
npx naver-commerce-api-docs-cli ask smartstore 인증하려면 어떻게 해야해
npx naver-commerce-api-docs-cli ask --format compact smartstore 인증하려면 어떻게 해야해
npx naver-commerce-api-docs-cli api --path /v2/products --method POST
npx naver-commerce-api-docs-cli normalize
npx naver-commerce-api-docs-cli validate
npx naver-commerce-api-docs-cli docs api --path /v2/products --method POST
npx naver-commerce-api-docs-cli check all
npx naver-commerce-api-docs-cli api --query "group상품" --limit 3
npx naver-commerce-api-docs-cli review
npx naver-commerce-api-docs-cli noise
npx naver-commerce-api-docs-cli review --verbose
npx naver-commerce-api-docs-cli transform --debug
```

기본 경로 규칙은 아래와 같습니다.

- 자연어 질문 명령(`ask`): guide/api/category/schema를 함께 검색하고 랭킹된 근거 match를 반환합니다.
- 정규화 문서는 frontmatter의 `keywords` 배열을 함께 생성합니다. `ask`와 `api --query`는 제목/설명/본문뿐 아니라 이 `keywords`도 함께 스캔하므로, 동의어와 도메인 별칭을 문서 메타데이터 레벨에서 보강할 수 있습니다.
- 정규화 시 `guide/sitemap.md`도 함께 생성합니다. 이 문서는 카테고리 트리와 API 경로 트리를 담는 구조 인덱스이며, `ask`는 category/guide 문서의 내부 링크를 따라 관련 API 문서에 점수를 일부 전파합니다.
- `ask`는 휴리스틱 검색기입니다. 최종 답변은 이 결과를 호출한 LLM이 스스로 결정해야 합니다. 애매하면 `api --path`, `api --query`, 매치 파일 본문 확인으로 보강해야 합니다.
- `ask --format compact`를 쓰면 `tags`, `description`, `score`, `matched_terms`, `source`를 생략한 짧은 근거만 반환합니다. `--body`를 함께 주면 compact에서도 본문은 포함됩니다.
- 배포 패키지는 정규화된 `docs/`를 함께 동봉합니다. 로컬 `./docs`가 없으면 번들 문서를 바로 사용하므로, 일반적인 조회에는 `sync`가 필요하지 않습니다.
- 조회/검사 명령(`ask`, `api`, `review`, `noise`, `lint`): 현재 작업 디렉터리에서 위로 올라가며 가장 가까운 상위 프로젝트의 정규화된 `docs/`를 먼저 찾고, 없으면 CLI managed cache의 synced `docs/`, 마지막으로 패키지 번들 `docs/`를 사용합니다.
- 단, 아무 `docs/`나 집지 않고 `api/schema/category/guide` 또는 `llms*.txt`가 있는 정규화 corpus만 읽기 대상으로 인정합니다.
- 생성 명령(`llms`, `transform`, `lint --fix`, `scrape`, `scrape-api`): 현재 작업 디렉터리 기준 `./docs`, `./raws/...`를 기본 경로로 사용합니다.
- `sync --latest`: upstream 개발문서가 바뀌었을 때만 raw 수집, 정규화, validate를 한 번에 수행합니다. 기본 출력은 현재 프로젝트가 아니라 CLI managed cache이므로 일반 작업 디렉터리를 오염시키지 않습니다.

managed cache 기본 경로는 OS별로 아래를 따릅니다.

- Windows: `%LOCALAPPDATA%\naver-commerce-api-docs-cli`
- macOS: `~/Library/Caches/naver-commerce-api-docs-cli`
- Linux: `$XDG_CACHE_HOME/naver-commerce-api-docs-cli` 또는 `~/.cache/naver-commerce-api-docs-cli`

실행 이름은 아래처럼 구분됩니다.

- 패키지명: `naver-commerce-api-docs-cli`
- 기본 실행명: `naver-commerce-api-docs-cli`
- short alias: `ncad`

`npx`로 1회 실행할 때는 패키지명을 써야 합니다. short alias는 설치 후 로컬/전역 bin에서 바로 쓰거나, `npx --package naver-commerce-api-docs-cli ncad ...` 형태로 사용할 수 있습니다.

즉, LLM agent는 조회만 필요하면 바로 다음처럼 사용할 수 있습니다.

```bash
npx naver-commerce-api-docs-cli ask smartstore 인증하려면 어떻게 해야해
npx naver-commerce-api-docs-cli ask --format compact smartstore 인증하려면 어떻게 해야해
npx naver-commerce-api-docs-cli api --path /v2/products --method POST --body
npx naver-commerce-api-docs-cli docs api --path /v2/products --method POST
npx --package naver-commerce-api-docs-cli ncad ask --format compact "smartstore 인증"
```

upstream 문서가 실제로 바뀌어서 로컬 corpus를 갱신해야 할 때만 아래처럼 실행하면 됩니다. 기본적으로 CLI managed cache를 갱신하고, 이후 조회 명령은 프로젝트 상위 경로에서 발견되는 정규화된 `docs/`가 없을 때 그 cache를 자동으로 사용합니다.

```bash
npx naver-commerce-api-docs-cli sync --latest
```

## agent init

`init`은 현재 프로젝트에 LLM agent용 설정 파일을 설치합니다. 모든 타깃에서 `AGENTS.md` managed block을 공통으로 설치하고, target별 전용 파일도 함께 설치합니다. 기존 `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`가 이미 있으면 전체를 덮어쓰지 않고 `naver-commerce-api-docs-cli:init:*` managed block만 append/update 합니다. 이전 `naver-commerce-api-docs:init:*` block도 있으면 새 prefix로 교체합니다.
설치 템플릿 본문은 코드에 직접 넣지 않고 루트 `SKILLS.md`에서 읽어옵니다.
기본 출력도 `start -> file -> done -> guide` 순서의 JSONL을 내보내므로, agent가 어떤 파일이 설치됐는지 별도 코드 분석 없이 바로 알 수 있습니다.

```bash
npx naver-commerce-api-docs-cli init
npx naver-commerce-api-docs-cli init --target codex,claude,cursor,gemini,antigravity
npx naver-commerce-api-docs-cli init --target codex --root ../my-agent-project
```

설치 대상별 생성 경로는 아래와 같습니다.

- `codex`: `.agents/skills/naver-commerce-api-docs-cli/SKILL.md`, `AGENTS.md`
- `claude`: `.claude/skills/naver-commerce-api-docs-cli/SKILL.md`, `CLAUDE.md`, `AGENTS.md`
- `cursor`: `.cursor/rules/naver-commerce-api-docs-cli.mdc`, `AGENTS.md`
- `gemini`: `.gemini/skills/naver-commerce-api-docs-cli/SKILL.md`, `GEMINI.md`, `AGENTS.md`
- `antigravity`: `.agents/skills/naver-commerce-api-docs-cli/SKILL.md`, `AGENTS.md`

`antigravity`는 공식 스킬 경로 문서를 확인하지 못해 `.agents/skills` + `AGENTS.md` 호환 모드로 설치합니다.

설치되는 skill/rule 안내문도 동일한 정책을 따릅니다.

- 기본 조회는 `project docs -> synced cache docs -> bundled docs` 순서로 `ask`, `api`
- `sync --latest`는 upstream 개발문서 변경 시에만 요청하고, 기본적으로 managed cache를 갱신
- agent는 `node_modules/naver-commerce-api-docs-cli/` 내부 파일을 직접 근거로 읽지 말고, 항상 `npx naver-commerce-api-docs-cli ...` subprocess 출력(JSONL)을 우선 근거로 사용

## demo

`demo/`는 이제 추적 대상이 아니라, 반복 검증 때 매번 새로 생성되는 scratch workspace입니다. 현재 세션에서 하던 `demo 초기화 -> agent init -> Codex 자식 프로세스 실행 -> 로그 수집 -> 종료 후 재시작` 전체는 [scripts/demo-codex-loop.ps1](./scripts/demo-codex-loop.ps1)로 자동화합니다.

```bash
pwsh -File ./scripts/demo-codex-loop.ps1 -Action run
npm run demo:status
npm run demo:stop
```

기본 동작은 다음과 같습니다.

- `demo/`를 매 회차 완전히 비움
- [scripts/demo-template/package.json](./scripts/demo-template/package.json), [scripts/demo-template/CODEX_TASK.md](./scripts/demo-template/CODEX_TASK.md)로 scratch project 재생성
- 현재 repo를 `demo/node_modules/naver-commerce-api-docs-cli`로 링크해서, 별도 `npm install` 없이 `npx naver-commerce-api-docs-cli ...`가 동작하게 준비
- `init`과 `validate`를 먼저 실행
- Codex 자식 프로세스를 백그라운드로 띄워 `CODEX_TASK.md`를 끝까지 수행
- 이벤트 로그와 산출물을 `.cache/codex-demo-loop/runs/<timestamp-run>/`에 아카이브
- 기본값으로 무한 반복. `-MaxRuns 1`이면 1회만 실행

유용한 옵션:

- `-MaxRuns 0`: 무한 반복, 기본값
- `-RunTimeoutMinutes 10`: 한 회차 최대 실행 시간
- `-RestartDelaySeconds 3`: 다음 회차 시작 전 대기
- `-SkipValidate`: 매 회차의 `validate` 생략

## npm 배포

```bash
npm run check
npm run build
npm pack --dry-run
npm publish --access public
```

필수 조건:

- `npm login` 또는 `npm whoami`가 정상 동작해야 합니다.
- `package.json`의 `name`이 npm registry에서 사용 가능한 이름이어야 합니다.
- `package-lock.json`은 npm 기준으로 함께 관리합니다.

## GitHub Actions 배포

기본 배포 경로는 GitHub Actions입니다. `v*` 형식 태그를 push하면 [publish.yml](.github/workflows/publish.yml)이 아래를 순서대로 수행합니다.

- `npm ci`
- `npm run check`
- `npm run test:cli`
- `npm run build`
- `npm publish --access public`
- `gh release create`로 GitHub Release 생성 또는 재실행 시 asset 갱신
- `npm pack`으로 만든 `*.tgz` tarball을 Release asset으로 업로드

필수 준비:

- GitHub repository secret `NPM_TOKEN`
- npm registry에서 사용 가능한 패키지명
- 배포 버전에 해당하는 git tag push

예시:

```bash
git tag v1.0.0
git push origin v1.0.0
```

## 패키지 구성

- CLI 엔트리포인트: `src/cli.ts`
- 배포 산출물: `dist/**`, `docs/**`
- agent installer 템플릿: `SKILLS.md`
- 저장소 raw 원본: `raws/**`
- 저장소 정규화 문서: `docs/api/**`, `docs/schema/**`, `docs/category/**`, `docs/guide/**`, `docs/llms*.txt`
