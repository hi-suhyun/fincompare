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

for key in "${KEYS[@]}"; do
  # 마지막 정의를 쓴다. 따옴표는 벗긴다.
  value="$(grep -E "^${key}=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')"

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
