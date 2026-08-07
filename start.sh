#!/usr/bin/env bash
#
# 개발 서버 두 개를 함께 띄운다.
#
#   ./start.sh
#
# API(3100)와 프론트(5173)는 짝이다. 하나만 떠 있으면
# "사이트에 연결할 수 없음" 이나 "데이터를 불러오지 못했습니다" 가 뜬다.
# Ctrl+C 한 번으로 둘 다 내려간다.

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

# 프론트가 실제로 응답할 때까지 기다렸다가 연다
for _ in $(seq 1 40); do
  if curl -sf -o /dev/null "http://localhost:$WEB_PORT"; then break; fi
  sleep 0.5
done

echo ""
echo "  화면:  http://localhost:$WEB_PORT"
echo "  API :  http://localhost:$API_PORT/api/health"
echo ""
echo "  종료하려면 Ctrl+C"
echo ""

open "http://localhost:$WEB_PORT" 2>/dev/null || true

wait
