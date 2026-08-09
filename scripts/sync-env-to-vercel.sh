#!/usr/bin/env bash
# 로컬 .env 의 값을 Vercel 프로젝트 환경변수로 옮긴다.
#
# 옮기는 값만 골라 넣는다. PORT 나 VITE_API_BASE_URL 처럼 로컬에서만 의미 있는
# 설정은 배포에 들어가면 오히려 깨진다 (배포는 프론트와 API 가 같은 오리진이다).
#
# 사용:  ./scripts/sync-env-to-vercel.sh production
set -euo pipefail

TARGET="${1:-production}"
ENV_FILE="${2:-.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "$ENV_FILE 이 없습니다." >&2
  exit 1
fi

# 배포에 올릴 키. 여기 없는 건 올리지 않는다.
#
# DATABASE_URL 은 REMOTE_DATABASE_URL 에서 읽는다. 로컬 .env 의 DATABASE_URL 은
# 파일 DB 를 가리켜야 개발이 빠르고, 인터넷 없이도 돌고, 무료 티어 사용량도 안 깎인다.
# 배포용 원격 주소를 다른 이름으로 두면 둘이 안 부딪힌다.
KEYS=(
  DART_API_KEY
  SEC_USER_AGENT
  KRX_AUTH_KEY
  TIINGO_API_KEY
  PRICE_PROVIDER_KR
  PRICE_PROVIDER_US
  DATABASE_URL
  TURSO_AUTH_TOKEN
  ACCESS_PASSWORD
)

# .env 에서 값을 읽는다. 마지막 정의를 쓰고 따옴표는 벗긴다.
#
# grep 은 못 찾으면 1 을 낸다. set -e 아래에서 그대로 두면 키 하나가 없을 때
# 스크립트가 조용히 죽어 절반만 올라간다 — 그게 배포에서 제일 찾기 어려운 상태다.
read_env() {
  grep -E "^${1}=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true
}

for key in "${KEYS[@]}"; do
  if [[ "$key" == DATABASE_URL ]]; then
    value="$(read_env REMOTE_DATABASE_URL)"
    # REMOTE_ 를 안 쓰고 DATABASE_URL 에 원격 주소를 바로 적었을 수도 있다
    if [[ -z "$value" ]]; then
      candidate="$(read_env DATABASE_URL)"
      [[ "$candidate" == libsql://* || "$candidate" == https://* ]] && value="$candidate"
    fi
    if [[ "$value" == file:* ]]; then
      echo "  건너뜀  DATABASE_URL (로컬 파일 경로는 배포에 올리지 않는다)"
      continue
    fi
  else
    value="$(read_env "$key")"
  fi

  if [[ -z "$value" ]]; then
    echo "  건너뜀  $key (비어 있음)"
    continue
  fi

  # 이미 있으면 지우고 다시 넣는다. vercel env add 는 덮어쓰지 않는다.
  vercel env rm "$key" "$TARGET" --yes >/dev/null 2>&1 || true
  printf '%s' "$value" | vercel env add "$key" "$TARGET" >/dev/null
  echo "  넣음    $key"
done

echo
echo "확인:  vercel env ls $TARGET"
