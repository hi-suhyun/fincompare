# Phase 0 — 프로젝트 구조 제안

> ⚠️ 판단이 갈리는 지점에서는 [`03-user-context.md`](./03-user-context.md)가 이 문서보다 우선한다.
> 실사용자는 개발자 본인이 아니라 30년 경력 투자자인 할아버지다.

## 1. 스택 결정

| 영역 | 선택 | 이유 |
|---|---|---|
| 프론트 | Vite + React 19 + TypeScript | 프롬프트 지정 |
| 백엔드 | **Express + TypeScript (별도 앱)** | 프롬프트가 Vite를 지정했으므로 Next.js와 병존시키면 빌드 파이프라인이 둘로 갈라진다. Express 단독이 단순 |
| 모노레포 | pnpm workspaces | 계산식·스키마를 프론트/백이 공유해야 함 |
| 차트 | **Recharts** | 1차. 호버 동기화는 `<Tooltip>` 대신 커스텀 훅으로 구현 → 3장 |
| 데이터 페칭 | TanStack Query v5 | 프롬프트 지정 |
| 스타일 | Tailwind CSS v4 | 프롬프트 지정 |
| DB | SQLite (better-sqlite3) → Postgres | 프롬프트 지정 |
| ORM/마이그레이션 | **Drizzle ORM** | SQLite↔Postgres 방언 전환이 스키마 재작성 없이 됨 |
| 검증 | Zod v4 | 프롬프트 지정 |
| 테스트 | Vitest | Vite와 동일 설정 재사용 |

### Recharts vs ECharts

프롬프트의 요구 중 이중 Y축 금지·small multiples는 Recharts로 충분하다.
문제는 **차트 간 호버 동기화**인데, Recharts는 공식 동기화 기능(`syncId`)이 있지만
툴팁 내용을 "전 차트·전 기업 값"으로 합치는 건 지원하지 않는다.

→ **Recharts + 커스텀 호버 상태**로 간다:
- `syncId`로 세로 기준선(`<ReferenceLine>`)만 동기화
- 각 차트의 기본 `<Tooltip>`은 끄고, 차트 스택 바깥에 **단일 통합 툴팁**을 띄운다
- 호버 중인 `periodEnd`를 React context 하나에 담아 전 차트가 구독

이 구조면 지표를 4개까지 늘려도 툴팁은 항상 하나다. ECharts 전환은
"지표 8개 이상" 같은 요구가 생길 때 재검토.

---

## 2. 디렉터리 구조

```
재무지표-비교/
├─ package.json                    # pnpm workspaces 루트
├─ pnpm-workspace.yaml
├─ .env.example
├─ docs/
│  ├─ 00-data-sources.md
│  ├─ 01-account-mapping.md
│  └─ 02-architecture.md
│
├─ packages/
│  └─ shared/                      # 프론트·백 공용. 외부 의존성 최소
│     └─ src/
│        ├─ schema/
│        │  ├─ company.ts          # Company, Market, MarketBadge
│        │  ├─ financial.ts        # FinancialDataPoint, MetricId, PeriodType
│        │  └─ api.ts              # 백엔드 응답 계약 (Zod)
│        ├─ metrics/
│        │  ├─ formulas.ts         # 순수 계산식 (null 전파 포함)
│        │  ├─ ttm.ts
│        │  ├─ normalize.ts        # 시작=100 정규화
│        │  └─ __tests__/
│        ├─ period/
│        │  ├─ align.ts            # alignedYear 계산 (결산월 정렬)
│        │  └─ __tests__/
│        └─ mapping/
│           ├─ kifrs.ts            # DART account_id → MetricId
│           ├─ usgaap.ts           # XBRL 태그 → MetricId
│           └─ resolve.ts          # 우선순위 배열 해석기
│
└─ apps/
   ├─ api/                         # Express + TS
   │  └─ src/
   │     ├─ adapters/
   │     │  ├─ financials/dart.ts        # FinancialsAdapter 구현
   │     │  ├─ financials/sec.ts
   │     │  ├─ price/krx.ts              # PriceAdapter 구현
   │     │  ├─ price/naver.ts            # 개발용 폴백
   │     │  ├─ price/tiingo.ts
   │     │  ├─ fx/ecb.ts
   │     │  └─ registry.ts               # market → adapter 라우팅
   │     ├─ core/
   │     │  ├─ http.ts             # 요청 큐 + 토큰버킷 + 지수 백오프
   │     │  ├─ cache.ts            # raw_cache 우선 조회
   │     │  └─ errors.ts
   │     ├─ db/
   │     │  ├─ schema.ts           # Drizzle
   │     │  ├─ migrations/
   │     │  └─ client.ts
   │     ├─ services/
   │     │  ├─ companySearch.ts
   │     │  ├─ financials.ts       # 캐시 → 어댑터 → 정규화 → 저장
   │     │  └─ metrics.ts          # 파생지표 조회 시점 계산
   │     ├─ routes/
   │     │  ├─ companies.ts        # GET /api/companies/search?q=
   │     │  ├─ series.ts           # GET /api/series  (핵심 엔드포인트)
   │     │  └─ health.ts
   │     ├─ jobs/
   │     │  ├─ seedDartCorpCodes.ts   # corpCode.xml(zip) 파싱
   │     │  ├─ seedSecTickers.ts      # company_tickers.json + ADR 판별
   │     │  └─ backfill.ts
   │     └─ index.ts
   │
   └─ web/                         # Vite + React
      └─ src/
         ├─ features/
         │  ├─ company-picker/     # 검색·자동완성·최대 5개·색상 배정
         │  ├─ metric-picker/      # 최대 4개
         │  ├─ period-picker/      # 연간/분기, 범위 슬라이더, 프리셋, TTM
         │  └─ export/             # CSV / PNG
         ├─ charts/
         │  ├─ ChartStack.tsx      # small multiples 컨테이너
         │  ├─ MetricChart.tsx     # 지표 1개 = 차트 1개
         │  ├─ SharedLegend.tsx    # 상단 1회만
         │  ├─ UnifiedTooltip.tsx  # 전 지표·전 기업 통합 툴팁
         │  └─ hoverSync.tsx       # 호버 시점 context
         ├─ hooks/
         │  ├─ useSeries.ts        # TanStack Query
         │  └─ useUrlState.ts      # 선택 상태 ↔ URL 쿼리 동기화
         ├─ lib/colors.ts          # 기업별 고정 팔레트
         └─ App.tsx
```

**핵심 배치 의도**: 계산식·매핑·기간정렬은 전부 `packages/shared`에 있다.
DB도 네트워크도 필요 없는 순수 함수라서 단위 테스트가 빠르고,
프론트에서 정규화·TTM을 다시 계산할 때도 같은 코드를 쓴다 (백엔드와 결과가 어긋날 수 없음).

---

## 3. DB 스키마 (초안)

```sql
companies (
  id              TEXT PK,            -- 'KR:005930' / 'US:AAPL'
  market          TEXT,               -- KOSPI|KOSDAQ|NYSE|NASDAQ
  country         TEXT,               -- KR|US
  corp_code       TEXT,               -- DART 8자리
  stock_code      TEXT,               -- 6자리
  cik             TEXT,               -- SEC 10자리
  ticker          TEXT,
  name_ko         TEXT,
  name_en         TEXT,
  fiscal_year_end_month INTEGER,      -- 정렬·배지용
  is_adr          INTEGER DEFAULT 0,  -- 20-F/40-F 제출 → 1차 범위 제외
  is_supported    INTEGER DEFAULT 1,
  updated_at      TEXT
)
-- 인덱스: name_ko, name_en, ticker, stock_code (검색 자동완성)

-- 검색 별칭. "엔비디아"로 NVDA 를 찾으려면 이게 필요하다.
-- SEC company_tickers.json 에는 영문명만 있어서 한글로는 검색이 안 된다.
company_aliases (
  company_id  TEXT,
  alias       TEXT,               -- '엔비디아', '엔디비아'(흔한 오타), 'nvidia'
  chosung     TEXT,               -- 'ㅅㅅㅈㅈ' 초성 검색용. 한글 별칭만
  alias_type  TEXT,               -- KO_NAME | KO_COMMON | EN_SHORT | TICKER
  PRIMARY KEY (company_id, alias)
)
-- 인덱스: alias, chosung

financial_facts (
  company_id      TEXT,
  metric_id       TEXT,               -- BASE 지표만 저장. 파생지표는 저장 안 함
  period_type     TEXT,               -- FY|Q
  period_start    TEXT,               -- BS 항목은 NULL
  period_end      TEXT,
  fiscal_year     INTEGER,
  fiscal_quarter  INTEGER,
  aligned_year    INTEGER,
  aligned_quarter INTEGER,
  value           TEXT,               -- 정밀도 위해 문자열(decimal). SQLite REAL 반올림 회피
  currency        TEXT,
  consolidation   TEXT,               -- CFS|OFS
  source          TEXT,
  source_tag      TEXT,
  filed_at        TEXT,
  PRIMARY KEY (company_id, metric_id, period_type, period_end, consolidation)
)

shares_outstanding (company_id, period_end, common_issued, treasury, outstanding, source)
prices            (company_id, date, close, currency, source)
fx_rates          (date, base, quote, rate)
raw_cache         (source, cache_key PK, payload BLOB, etag, fetched_at, expires_at)
fetch_log         (source, cache_key, status, attempted_at)   -- 013(데이터없음) 재조회 방지
```

**파생지표는 저장하지 않는다.** PER/ROE는 조회 시점에 BASE 값으로 계산한다.
계산식이 바뀌어도 재백필이 필요 없고, 통화 토글·TTM 조합이 곱집합으로 늘어나지 않는다.

**`value`를 문자열로 두는 이유**: 삼성전자 자산총계는 약 4.5×10^14 KRW다.
JS `number`는 2^53(≈9×10^15)까지 정확하니 당장은 괜찮지만, 원 단위 누적 연산에서
반올림이 누적된다. 저장은 문자열, 계산은 필요 시 `Decimal`로 간다.

---

## 4. 핵심 API 계약

```
GET /api/companies/search?q=엔비디아&limit=10     # 한글 별칭·초성·티커·종목코드 모두 매칭
→ [{ id, market, country, nameKo, nameEn, ticker, isSupported, fiscalYearEndMonth,
     matchedOn: 'KO_COMMON' }]

GET /api/series
    ?companies=KR:005930,US:INTC,US:NVDA
    &metrics=operatingMargin,per
    &period=annual            # annual | quarterly
    &from=2015&to=2025
    &currency=KRW             # KRW | USD | native
    &ttm=false
→ {
    companies: [{ id, nameKo, color, fiscalYearEndMonth, badges: ['9월 결산'] }],
    periods: ['2015', '2016', ...],          # 전 차트 공유 X축
    series: {
      operatingMargin: {
        unit: '%', label: '영업이익률',
        formula: '영업이익 / 매출액',            # 툴팁에 계산 근거로 노출
        basis: 'K-IFRS 연결 · 지배주주 기준',
        data: { 'KR:005930': [0.13, null, ...], 'US:NVDA': [...] }
      },
      per: { unit: '배', label: 'PER', data: {...} }
    },
    provenance: {                               # 전문가가 숫자를 검증할 수 있게
      'KR:005930': { source: 'DART', consolidation: 'CFS', fetchedAt: '...' },
      'US:NVDA':   { source: 'SEC',  consolidation: 'CFS', fetchedAt: '...' }
    },
    warnings: [{ companyId, metricId, code: 'METRIC_NOT_TAGGED' }]
  }
```

`formula` / `basis` / `provenance` 는 장식이 아니다. 실사용자가 30년 경력 투자자라
숫자의 출처와 기준을 못 밝히면 신뢰를 못 얻는다 (`03-user-context.md` 2.3).

한 번의 호출로 전 차트가 그려진다. `periods`가 공유 배열이라 프론트에서 X축 정렬이
자동으로 맞고, `null`이 그대로 내려와서 선이 끊긴다.

---

## 5. Rate limit / 캐싱 전략

```
요청 → raw_cache 조회 (hit & 미만료 → 즉시 반환)
     → fetch_log 조회 (013 '데이터 없음' 기록 있으면 재요청 안 함)
     → 소스별 토큰버킷 큐 대기
        · SEC:  10 req/s
        · DART: 실측 후 설정 (일 한도 + 초당 제한)
        · KRX:  실측 후 설정
     → 실패 시 지수 백오프 (1s → 2s → 4s → 8s, 최대 4회)
        · DART 020(한도초과) / 800(점검) → 재시도
        · DART 013(데이터없음) → 재시도 안 함, fetch_log에 기록
        · SEC 403 → UA 헤더 누락. 즉시 실패 (재시도 무의미)
     → 성공 시 raw_cache 저장 → 어댑터로 정규화 → financial_facts upsert
```

TTL: 확정 재무데이터는 사실상 불변 → **30일**. 주가·환율은 **1일**.
기업 마스터(corpCode/company_tickers)는 **7일**.

---

## 6. 환경변수

```
# .env.example
DART_API_KEY=
SEC_USER_AGENT="MyApp Research contact@example.com"   # SEC 필수. 없으면 403
KRX_AUTH_KEY=
TIINGO_API_KEY=
PRICE_PROVIDER_KR=krx           # krx | naver
PRICE_PROVIDER_US=tiingo        # tiingo | twelvedata
DATABASE_URL=file:./data/dev.db
PORT=3001
VITE_API_BASE_URL=http://localhost:3001
```

프론트에서 외부 API를 직접 부르지 않는다. `VITE_` 접두어가 붙는 건 백엔드 주소뿐이다.

---

## 7. 커밋 계획 (기능 단위)

- ✅ `docs: Phase 0 데이터 소스 조사 및 설계`
- ✅ `chore: pnpm 모노레포 및 툴체인 설정`
- ✅ `feat(shared): 표준 스키마, 지표 계산식, 기간 정렬, 계정과목 매핑`
- `docs: 사용자 맥락 반영 및 Phase 순서 조정`
- `feat(api): HTTP 큐·백오프·캐시 레이어`
- `feat(api): DB 스키마 및 마이그레이션`
- `feat(api): DART 어댑터 + 기업 마스터 시딩`
- `feat(api): 한글 별칭·초성 검색`
- ... (Phase별로 이어감)

## 8. Phase 순서 (조정됨)

| Phase | 내용 | 상태 |
|---|---|---|
| 0 | 데이터 소스 조사, 계정과목 매핑 설계 | ✅ 완료 |
| 1 | 백엔드: DART 연동, 기업 마스터 시딩, 정규화 스키마, 캐싱 | 진행 중 (DART 키 대기) |
| 2 | 프론트: 기업 검색·선택 UI + 단일 지표 라인 차트 | |
| 3 | 미국(SEC) 통합 + USD/KRW 환산 + 계정과목 매핑 | |
| 4 | **다중 지표(small multiples), 정규화, 내보내기, URL 공유** | 순서 앞당김 |
| 5 | **주가 연동 및 PER/PBR** | 순서 미룸 |

Phase 3 종료 시점에 "삼성전자 vs Intel vs NVIDIA 영업이익률 10년 추이"가 동작한다.
그때 할아버지께 드리고 피드백을 받은 뒤 4~5를 진행한다.
순서 변경 사유는 `03-user-context.md` 3장 참고.
