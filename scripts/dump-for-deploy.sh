#!/usr/bin/env bash
# 배포용 DB 덤프.
#
# 로컬 DB 전체를 올리지 않는다. raw_cache 는 외부 응답 원문 보관용이라
# 용량의 대부분을 차지하지만, 없으면 다시 받아오면 그만이다.
# fetch_log 도 마찬가지로 로컬 기록이다.
#
# 그 두 테이블은 스키마만 만들어 두고 데이터는 두고 간다.
#
# 사용:  ./scripts/dump-for-deploy.sh > dump.sql
#        turso db shell <db이름> < dump.sql
set -euo pipefail

DB="${1:-apps/api/data/dev.db}"

if [[ ! -f "$DB" ]]; then
  echo "DB 를 찾을 수 없습니다: $DB" >&2
  echo "먼저 시딩하세요: pnpm --filter @fincompare/api seed" >&2
  exit 1
fi

# 데이터까지 옮기는 테이블.
# __drizzle_migrations 를 함께 옮겨야 배포 쪽이 스키마를 이미 맞춘 걸로 인식한다.
WITH_DATA=(companies company_aliases financial_facts prices __drizzle_migrations)

# 스키마만 만드는 테이블 (캐시·로그)
SCHEMA_ONLY=(raw_cache fetch_log fx_rates shares_outstanding)

sqlite3 "$DB" ".dump ${WITH_DATA[*]}"

for table in "${SCHEMA_ONLY[@]}"; do
  sqlite3 "$DB" ".schema $table"
done
