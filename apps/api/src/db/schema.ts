import { blob, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * SQLite 스키마 (로컬 개발). 배포 시 Postgres 로 옮긴다.
 * Drizzle 을 쓰는 이유가 이 방언 전환이라 SQLite 전용 타입은 피한다.
 *
 * 금액을 TEXT 로 저장하는 이유: 삼성전자 자산총계가 약 4.5e14 KRW 다.
 * JS number 는 2^53(약 9e15)까지 정확해서 당장은 괜찮지만,
 * 원 단위 누적 연산에서 반올림이 쌓인다. 저장은 문자열로 두고 필요할 때만 수치화한다.
 */

export const companies = sqliteTable(
  'companies',
  {
    /** 'KR:005930' / 'US:NVDA' */
    id: text('id').primaryKey(),
    country: text('country').notNull(), // KR | US
    market: text('market').notNull(), // KOSPI | KOSDAQ | NYSE | NASDAQ
    nameKo: text('name_ko'),
    nameEn: text('name_en'),
    /** DART 고유번호 8자리 */
    corpCode: text('corp_code'),
    /** 국내 종목코드 6자리 */
    stockCode: text('stock_code'),
    /** SEC CIK 10자리 0패딩 */
    cik: text('cik'),
    ticker: text('ticker'),
    /** 결산월 1~12. 기간 정렬과 UI 배지에 쓴다 */
    fiscalYearEndMonth: integer('fiscal_year_end_month').notNull(),
    /** 20-F / 40-F 제출자. 1차 범위에서 미지원 */
    isAdr: integer('is_adr', { mode: 'boolean' }).notNull().default(false),
    isSupported: integer('is_supported', { mode: 'boolean' }).notNull().default(true),
    /**
     * 검색 순위 보정. 클수록 위로 온다.
     * 시가총액이 없는 지금은 큐레이션 목록으로 채운다 (data/koreanAliases.ts).
     * Phase 5 에서 시가총액이 들어오면 그것으로 대체할 수 있다.
     */
    prominence: integer('prominence').notNull().default(0),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    index('idx_companies_name_ko').on(t.nameKo),
    index('idx_companies_name_en').on(t.nameEn),
    index('idx_companies_ticker').on(t.ticker),
    index('idx_companies_stock_code').on(t.stockCode),
    index('idx_companies_corp_code').on(t.corpCode),
    index('idx_companies_cik').on(t.cik),
  ],
);

/**
 * 검색 별칭.
 * SEC company_tickers.json 에는 영문명만 있어서 "엔비디아"로는 검색이 안 된다.
 * 초성(chosung)은 'ㅅㅅㅈㅈ' -> 삼성전자 같은 검색용.
 */
export const companyAliases = sqliteTable(
  'company_aliases',
  {
    companyId: text('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    /** 정규화된 별칭(소문자·공백 제거) */
    alias: text('alias').notNull(),
    chosung: text('chosung'),
    /** KO_NAME | KO_COMMON | EN_SHORT | TICKER */
    aliasType: text('alias_type').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.alias] }),
    index('idx_aliases_alias').on(t.alias),
    index('idx_aliases_chosung').on(t.chosung),
  ],
);

/**
 * BASE 지표만 저장한다. PER·ROE 같은 파생지표는 조회 시점에 계산한다.
 * 계산식이 바뀌어도 재백필이 필요 없고, 통화·TTM 조합이 곱집합으로 늘지 않는다.
 */
export const financialFacts = sqliteTable(
  'financial_facts',
  {
    companyId: text('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    metricId: text('metric_id').notNull(),
    periodType: text('period_type').notNull(), // FY | Q
    /** 재무상태표 항목은 시점 데이터라 null */
    periodStart: text('period_start'),
    periodEnd: text('period_end').notNull(),
    fiscalYear: integer('fiscal_year').notNull(),
    fiscalQuarter: integer('fiscal_quarter'),
    /** 결산월 보정된 비교용 정렬 키 */
    alignedYear: integer('aligned_year').notNull(),
    alignedQuarter: integer('aligned_quarter'),
    /** 결측은 null. 0 으로 채우지 않는다 */
    value: text('value'),
    currency: text('currency').notNull(),
    consolidation: text('consolidation').notNull(), // CFS | OFS
    source: text('source').notNull(),
    /** 실제 채택된 원본 태그. 숫자의 출처를 되짚기 위해 반드시 남긴다 */
    sourceTag: text('source_tag').notNull(),
    filedAt: text('filed_at'),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.companyId, t.metricId, t.periodType, t.periodEnd, t.consolidation],
    }),
    index('idx_facts_lookup').on(t.companyId, t.periodType, t.alignedYear),
  ],
);

/**
 * 발행주식수. PER/PBR 계산에 쓴다.
 * 수권주식수(isu_stock_totqy)가 아니라 유통주식수(distb_stock_co)를 써야 한다.
 * 우선주가 있는 기업은 보통주만 집계한다.
 */
export const sharesOutstanding = sqliteTable(
  'shares_outstanding',
  {
    companyId: text('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    periodEnd: text('period_end').notNull(),
    /** 발행주식총수 (보통주) */
    issued: text('issued'),
    /** 자기주식 */
    treasury: text('treasury'),
    /** 유통주식수 = 발행 - 자기주식. 이 값을 EPS 분모로 쓴다 */
    outstanding: text('outstanding'),
    source: text('source').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.periodEnd] })],
);

export const prices = sqliteTable(
  'prices',
  {
    companyId: text('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    close: text('close').notNull(),
    currency: text('currency').notNull(),
    source: text('source').notNull(),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.date] })],
);

/**
 * 애널리스트 목표주가 (개별 건).
 *
 * 집계값(연도별 high/avg/low)이 아니라 원본을 그대로 담는다. 집계 규칙이
 * 바뀌어도 다시 받지 않아도 되고, "그때 그 의견"을 발행일과 함께 볼 수 있다.
 *
 * ⚠️ 이 테이블은 배포판으로 옮기지 않는다. FMP 약관이 데이터를 제3자가
 *    접근 가능한 도구에 통합하는 것을 금지한다 (scripts/dump-for-deploy.sh 참고).
 */
export const analystTargets = sqliteTable(
  'analyst_targets',
  {
    companyId: text('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    /** 발행일 (YYYY-MM-DD) */
    publishedAt: text('published_at').notNull(),
    /** 같은 날 같은 기관이 두 건을 내는 경우가 있어 기관명까지 키에 넣는다 */
    analystCompany: text('analyst_company').notNull().default(''),
    priceTarget: text('price_target').notNull(),
    /** 발행 당시 주가. 제공처가 주지 않으면 null */
    priceWhenPosted: text('price_when_posted'),
    currency: text('currency').notNull(),
    source: text('source').notNull(),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.publishedAt, t.analystCompany] })],
);

/** ECB 기준환율. 주말·공휴일은 행이 없으므로 조회 시 직전 영업일로 forward-fill 한다 */
export const fxRates = sqliteTable(
  'fx_rates',
  {
    date: text('date').notNull(),
    base: text('base').notNull(),
    quote: text('quote').notNull(),
    rate: text('rate').notNull(),
  },
  (t) => [primaryKey({ columns: [t.date, t.base, t.quote] })],
);

/**
 * 외부 응답 원본 캐시.
 * SEC companyfacts 는 기업당 3.8MB 라 반드시 캐싱해야 한다.
 */
export const rawCache = sqliteTable(
  'raw_cache',
  {
    source: text('source').notNull(),
    cacheKey: text('cache_key').primaryKey(),
    payload: blob('payload').notNull(),
    etag: text('etag'),
    fetchedAt: text('fetched_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (t) => [index('idx_raw_cache_expires').on(t.expiresAt)],
);

/**
 * 조회 결과 기록.
 * DART 013(데이터 없음)을 여기 남겨 같은 조합을 다시 묻지 않는다.
 * 재요청하면 한도만 갉아먹고 결과는 늘 같다.
 */
export const fetchLog = sqliteTable(
  'fetch_log',
  {
    source: text('source').notNull(),
    cacheKey: text('cache_key').primaryKey(),
    /** OK | EMPTY | ERROR */
    status: text('status').notNull(),
    errorKind: text('error_kind'),
    attemptedAt: text('attempted_at').notNull(),
    /** EMPTY 기록의 유효기간. 지나면 다시 시도해본다 */
    revalidateAfter: text('revalidate_after'),
  },
  (t) => [index('idx_fetch_log_source').on(t.source)],
);
