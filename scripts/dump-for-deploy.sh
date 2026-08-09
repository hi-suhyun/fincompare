#!/usr/bin/env bash
# 배포용 DB 덤프.
#
# 로컬 DB 전체를 올리지 않는다. raw_cache 는 외부 응답 원문 보관용이라
# 용량의 대부분을 차지하지만, 없으면 다시 받아오면 그만이다.
# fetch_log 도 마찬가지로 로컬 기록이다.
# 그 두 테이블은 스키마만 만들어 두고 데이터는 두고 간다.
#
# ⚠️ 유료 소스에서 받은 주가는 덤프에서 뺀다. 아래 EXCLUDED_SOURCES 참고.
#
# 사용:  ./scripts/dump-for-deploy.sh > dump.sql
#        DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/push-to-remote-db.mjs dump.sql --reset
set -euo pipefail

DB="${1:-apps/api/data/dev.db}"

if [[ ! -f "$DB" ]]; then
  echo "DB 를 찾을 수 없습니다: $DB" >&2
  echo "먼저 시딩하세요: pnpm --filter @fincompare/api seed" >&2
  exit 1
fi

# 데이터까지 옮기는 테이블.
# __drizzle_migrations 를 함께 옮겨야 배포 쪽이 스키마를 이미 맞춘 걸로 인식한다.
WITH_DATA=(companies company_aliases __drizzle_migrations)

# 스키마만 만드는 테이블 (캐시·로그)
SCHEMA_ONLY=(raw_cache fetch_log fx_rates shares_outstanding)

#
# 재배포가 금지된 소스.
#
# Tiingo 무료 티어는 받은 데이터를 다른 사람에게 보여주거나 공유하는 것을
# 금지한다. 배포판은 여러 명이 같은 링크로 들어오므로, 이 데이터가 실리면
# 키를 안 올려도 그 자체로 위반이다.
#
# 환경변수(TIINGO_API_KEY)만 막는 것으로는 부족했다 — 로컬에서 받아 DB 에
# 저장된 값이 덤프를 타고 그대로 올라갔다. 데이터 쪽에서도 막는다.
#
# KRX 는 공공데이터라 재배포가 허용된다. 여기 넣지 않는다.
EXCLUDED_SOURCES="'TIINGO','TWELVEDATA','NAVER'"

sqlite3 "$DB" ".dump ${WITH_DATA[*]}"

# financial_facts 와 prices 는 소스를 걸러야 하므로 .dump 를 쓸 수 없다.
# 스키마는 .schema 로 만들고, 행은 골라서 INSERT 문으로 뽑는다.
for table in financial_facts prices; do
  sqlite3 "$DB" ".schema $table"
  sqlite3 "$DB" <<SQL
.mode insert $table
SELECT * FROM $table WHERE source NOT IN ($EXCLUDED_SOURCES);
SQL
done

for table in "${SCHEMA_ONLY[@]}"; do
  sqlite3 "$DB" ".schema $table"
done
