#!/usr/bin/env bash
#
# 처음 설치할 때 한 번 실행합니다.
#
#   ./setup.sh
#
# 필요한 키를 하나씩 물어보며 .env 를 만들고, 기업 목록을 받아옵니다.
# 이미 .env 가 있으면 비어 있는 항목만 채웁니다 — 기존 값은 건드리지 않습니다.
set -euo pipefail
cd "$(dirname "$0")"

BOLD=$'\033[1m'; DIM=$'\033[2m'; RESET=$'\033[0m'
OK=$'\033[32m'; WARN=$'\033[33m'

say() { printf '%s\n' "$*"; }
head2() { printf '\n%s%s%s\n' "$BOLD" "$*" "$RESET"; }

# ─── 사전 확인 ────────────────────────────────────────────────
head2 "설치 환경 확인"

if ! command -v node >/dev/null 2>&1; then
  say "${WARN}Node.js 가 없습니다.${RESET} https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요."
  exit 1
fi

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 20 ]; then
  say "${WARN}Node.js 20 이상이 필요합니다${RESET} (현재 $(node -v))."
  exit 1
fi
say "  Node.js $(node -v) ${OK}OK${RESET}"

if ! command -v pnpm >/dev/null 2>&1; then
  say "  pnpm 이 없어 설치합니다…"
  npm install -g pnpm >/dev/null 2>&1 || {
    say "${WARN}pnpm 설치 실패.${RESET} 직접 설치해 주세요: npm install -g pnpm"
    exit 1
  }
fi
say "  pnpm $(pnpm -v) ${OK}OK${RESET}"

# ─── .env 준비 ────────────────────────────────────────────────
head2 "API 키 설정"

if [ ! -f .env ]; then
  cp .env.example .env
  say "  .env 를 만들었습니다."
fi

# 이미 값이 있으면 건드리지 않는다. 실수로 덮어쓰면 키를 다시 발급받아야 한다.
current() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | tr -d '"' ; }

set_key() {
  local key="$1" value="$2"
  # 값에 / 나 & 가 들어와도 안전하도록 python 으로 치환한다
  KEY="$key" VALUE="$value" python3 - <<'PY'
import os, pathlib, re
key, value = os.environ['KEY'], os.environ['VALUE']
p = pathlib.Path('.env')
s = p.read_text()
if re.search(rf'^{key}=', s, re.M):
    s = re.sub(rf'^{key}=.*$', f'{key}={value}', s, flags=re.M)
else:
    s = s.rstrip('\n') + f'\n{key}={value}\n'
p.write_text(s)
PY
}

# ask <키이름> <표시명> <발급 URL> <필수여부> <없을 때 설명>
ask() {
  local key="$1" label="$2" url="$3" required="$4" note="$5"
  local existing; existing="$(current "$key")"

  if [ -n "$existing" ]; then
    say "  ${label} ${OK}이미 설정됨${RESET}"
    return
  fi

  printf '\n  %s%s%s\n' "$BOLD" "$label" "$RESET"
  printf '    발급: %s\n' "$url"
  printf '    %s%s%s\n' "$DIM" "$note" "$RESET"
  if [ "$required" = "required" ]; then
    printf '    입력: '
  else
    printf '    입력 (건너뛰려면 엔터): '
  fi

  local value; read -r value

  if [ -z "$value" ]; then
    if [ "$required" = "required" ]; then
      say "    ${WARN}필수 항목입니다. 나중에 .env 에 직접 채워 주세요.${RESET}"
    fi
    return
  fi
  set_key "$key" "$value"
  say "    ${OK}저장됨${RESET}"
}

ask DART_API_KEY "DART 인증키 (국내 재무제표 · 필수)" \
  "https://opendart.fss.or.kr/" required \
  "무료·즉시 발급. 없으면 국내 기업을 조회할 수 없습니다."

if [ -z "$(current SEC_USER_AGENT)" ] || [ "$(current SEC_USER_AGENT)" = "FinCompare your-email@example.com" ]; then
  printf '\n  %sSEC User-Agent (미국 재무제표 · 필수)%s\n' "$BOLD" "$RESET"
  printf '    %s발급 절차 없이 이메일만 넣으면 됩니다. SEC 가 요구하는 연락처입니다.%s\n' "$DIM" "$RESET"
  printf '    이메일 입력: '
  read -r email
  if [ -n "$email" ]; then
    set_key SEC_USER_AGENT "\"FinCompare $email\""
    say "    ${OK}저장됨${RESET}"
  fi
else
  say "  SEC User-Agent ${OK}이미 설정됨${RESET}"
fi

ask KRX_AUTH_KEY "KRX 인증키 (국내 주가·PER·PBR · 권장)" \
  "https://openapi.krx.co.kr/" optional \
  "키 발급 후 「서비스 이용 > 주식」에서 유가증권·코스닥 일별매매정보에 각각 이용신청까지 해야 동작합니다."

ask TIINGO_API_KEY "Tiingo 키 (미국 주가·PER·PBR · 선택)" \
  "https://www.tiingo.com/" optional \
  "없으면 미국 밸류에이션만 빠집니다. 재무지표는 정상 동작합니다."

ask FMP_API_KEY "FMP 키 (애널리스트 추정 밴드 · 선택)" \
  "https://site.financialmodelingprep.com/" optional \
  "없으면 추정 밴드만 빠집니다. 하루 250콜 무료."

# ─── 의존성 · 데이터 ──────────────────────────────────────────
head2 "패키지 설치"
pnpm install

head2 "기업 목록 받기"
say "  ${DIM}국내 2,600여 개 + 미국 주요 기업. 몇 분 걸립니다.${RESET}"
pnpm --filter @fincompare/api seed
pnpm --filter @fincompare/api seed:us

if [ -n "$(current KRX_AUTH_KEY)" ]; then
  head2 "국내 주가 받기"
  say "  ${DIM}연말 시세를 시장별로 받습니다. 22번 호출로 전 종목 10년치가 채워집니다.${RESET}"
  pnpm --filter @fincompare/api backfill:kr-prices
fi

head2 "설치 완료"
cat <<'EOF'
  실행:
    ./start.sh

  브라우저에서 http://localhost:5173 이 열립니다.

  기업 재무데이터는 처음 조회할 때 공시에서 받아오고, 그 뒤로는 즉시 나옵니다.
  자주 볼 기업을 미리 받아두려면:

    pnpm --filter @fincompare/api backfill:kr    # 국내 시총 상위 300개
    pnpm --filter @fincompare/api backfill:us    # 미국 주요 기업

EOF
