#!/usr/bin/env bash
#
# 개발 서버 두 개를 함께 띄운다.
#
#   ./start.sh
#
# ⚠️ 이 창을 닫거나 Ctrl+C 를 누르면 서버가 함께 내려간다.
#    보고 있는 동안은 터미널 창을 그대로 두어야 한다.
#
# API(3100)와 프론트(5173)는 짝이다. 하나만 떠 있으면
#   프론트만 → 화면은 뜨는데 "데이터를 불러오지 못했습니다"
#   API만    → ERR_CONNECTION_REFUSED

set -euo pipefail
cd "$(dirname "$0")"

API_PORT=3100
WEB_PORT=5173

# 이미 떠 있으면 끄고 다시 띄운다. 옛 코드가 물려 있으면 헷갈린다.
for port in "$API_PORT" "$WEB_PORT"; do
  pid=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)
  if [ -n "$pid" ]; then
    echo "포트 $port 를 쓰던 프로세스($pid)를 정리합니다"
    kill "$pid" 2>/dev/null || true
    sleep 1
  fi
done

cleanup() {
  echo ""
  echo "서버를 내립니다…"
  # 자식 프로세스 그룹 전체를 종료한다. pnpm 이 중간에 껴 있어 kill %1 만으로는 안 죽는다
  pkill -P $$ 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "API 서버 시작 (:$API_PORT)"
pnpm --filter @fincompare/api dev &

echo "프론트 서버 시작 (:$WEB_PORT)"
pnpm --filter @fincompare/web dev &

# 둘 다 실제로 응답할 때까지 기다린다. 하나라도 안 뜨면 이유를 알려준다.
wait_for() {
  local url=$1 name=$2
  for _ in $(seq 1 60); do
    if curl -sf -o /dev/null "$url"; then return 0; fi
    sleep 0.5
  done
  echo "❌ $name 이(가) 30초 안에 응답하지 않았습니다. 위 로그를 확인하세요."
  return 1
}

api_ok=0
web_ok=0
wait_for "http://localhost:$API_PORT/api/health" "API 서버" && api_ok=1
wait_for "http://localhost:$WEB_PORT" "프론트 서버" && web_ok=1

echo ""
if [ "$api_ok" = 1 ] && [ "$web_ok" = 1 ]; then
  echo "  ✅ 준비 완료"
  echo ""
  echo "     화면:  http://localhost:$WEB_PORT"
  echo "     API :  http://localhost:$API_PORT/api/health"
  echo ""
  echo "  ⚠️  이 창을 닫으면 서버가 꺼집니다. 보시는 동안 열어 두세요."
  open "http://localhost:$WEB_PORT" 2>/dev/null || true
else
  echo "  ❌ 서버를 다 띄우지 못했습니다."
fi
echo ""

wait
