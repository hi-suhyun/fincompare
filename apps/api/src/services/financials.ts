import {
  TTM_WINDOW,
  alignPeriod,
  isFlowMetric,
  ttmFromCumulative,
  ttmValue,
  type BaseMetricId,
  type Consolidation,
  type FinancialDataPoint,
  type WarningCode,
} from '@fincompare/shared';
import { and, eq, gte, inArray, lte, not, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { DartClient } from '../adapters/dart/client.js';
import type { SecClient } from '../adapters/sec/client.js';
import { convertSecFacts } from '../adapters/sec/financials.js';
import { convertSecQuarters } from '../adapters/sec/quarters.js';
import {
  convertFinancialRows,
  convertQuarterRows,
  extractCumulative,
  extractShares,
} from '../adapters/dart/financials.js';
import {
  DartFinancialResponseSchema,
  DartStockResponseSchema,
  REPORT_CODE,
} from '../adapters/dart/schema.js';
import { SourceError } from '../core/errors.js';
import type { Db } from '../db/client.js';
import { companies, financialFacts } from '../db/schema.js';

/**
 * 재무데이터 수집·저장.
 *
 * 연도별로 따로 호출한다. 사업보고서 하나에서 전기·전전기까지 뽑으면 호출이 1/3로 줄지만,
 * 그 값들은 그 보고서 시점의 재작성(restatement) 반영값이라 원 보고서와 다를 수 있다.
 * 30년 경력 투자자가 쓰는 서비스라 "각 연도 사업보고서의 공시값"이라는 일관된 기준을 택했다.
 * 캐시 덕에 두 번째부터는 네트워크를 타지 않으므로 호출 수 차이는 1회성 비용이다.
 */

export interface FinancialsDeps {
  db: Db;
  dart: DartClient;
  sec: SecClient;
}

export interface CompanyRef {
  id: string;
  corpCode: string | null;
  cik: string | null;
  fiscalYearEndMonth: number;
  country: string;
  nameKo: string | null;
  nameEn: string | null;
  market: string;
  ticker: string | null;
  stockCode: string | null;
}

export interface FetchWarning {
  companyId: string;
  metricId: BaseMetricId | null;
  code: WarningCode;
  detail?: string;
}

/** 이미 저장된 연도는 건너뛴다 */
async function existingYears(db: Db, companyId: string, from: number, to: number): Promise<Set<number>> {
  const rows = await db
    .selectDistinct({ fiscalYear: financialFacts.fiscalYear })
    .from(financialFacts)
    .where(
      and(
        eq(financialFacts.companyId, companyId),
        eq(financialFacts.periodType, 'FY'),
        gte(financialFacts.fiscalYear, from),
        lte(financialFacts.fiscalYear, to),
        /*
         * 주가는 "재무데이터가 있다"의 근거가 되지 못한다.
         *
         * 주가는 거래소에서 따로 받아 같은 테이블에 담기므로, 이 조건이 없으면
         * 주가만 채워진 기업이 "이미 수집됨"으로 잡혀 공시 수집이 통째로
         * 막힌다. LG에너지솔루션이 KRX 주가 4건 때문에 재무 0건이 됐다.
         */
        not(eq(financialFacts.metricId, 'closePrice')),
      ),
    );
  return new Set(rows.map((r) => r.fiscalYear));
}

/**
 * 한 기업의 연간 재무데이터를 확보한다.
 *
 * 연결(CFS)을 먼저 보고, 없으면 별도(OFS)로 폴백한다.
 * 폴백했으면 경고를 달아 화면에서 구분해 보여줄 수 있게 한다 — 연결과 별도를
 * 섞어 놓고 말하지 않으면 숫자가 왜 튀는지 알 수 없다.
 */
export async function ensureAnnualFinancials(
  deps: FinancialsDeps,
  company: CompanyRef,
  fromYear: number,
  toYear: number,
): Promise<FetchWarning[]> {
  if (company.country === 'US') return ensureUsFinancials(deps, company, fromYear, toYear);
  return ensureKoreanFinancials(deps, company, fromYear, toYear);
}

/**
 * 미국 기업. SEC companyfacts 는 한 번 받으면 전 기간이 들어 있으므로
 * 연도별로 나눠 부를 필요가 없다 — 기업당 1회 호출이 끝이다.
 */
async function ensureUsFinancials(
  deps: FinancialsDeps,
  company: CompanyRef,
  fromYear: number,
  toYear: number,
): Promise<FetchWarning[]> {
  const warnings: FetchWarning[] = [];
  if (company.cik === null) return warnings;

  const have = await existingYears(deps.db, company.id, fromYear, toYear);
  const missingCount = toYear - fromYear + 1 - have.size;
  if (missingCount <= 0) return warnings;

  const facts = await deps.sec.fetchCompanyFacts(company.cik);
  if (facts === null) {
    warnings.push({
      companyId: company.id,
      metricId: null,
      code: 'METRIC_NOT_TAGGED',
      detail: 'SEC 에서 이 기업의 재무데이터를 찾지 못했습니다',
    });
    return warnings;
  }

  const converted = convertSecFacts(facts, {
    companyId: company.id,
    fromYear,
    toYear,
    fiscalYearEndMonth: company.fiscalYearEndMonth,
  });

  for (const metricId of converted.missing) {
    warnings.push({ companyId: company.id, metricId, code: 'METRIC_NOT_TAGGED' });
  }

  await storeFacts(deps.db, converted.points);
  return warnings;
}

async function ensureKoreanFinancials(
  deps: FinancialsDeps,
  company: CompanyRef,
  fromYear: number,
  toYear: number,
): Promise<FetchWarning[]> {
  const warnings: FetchWarning[] = [];

  if (company.corpCode === null) return warnings;

  const have = await existingYears(deps.db, company.id, fromYear, toYear);
  const missing: number[] = [];
  for (let year = fromYear; year <= toYear; year++) {
    if (!have.has(year)) missing.push(year);
  }
  if (missing.length === 0) return warnings;

  const points: FinancialDataPoint[] = [];

  const results = await Promise.allSettled(
    missing.map(async (year) => {
      const fetched = await fetchYear(deps.dart, company, year);
      return { year, ...fetched };
    }),
  );

  for (const result of results) {
    if (result.status === 'rejected') {
      const error: unknown = result.reason;
      if (error instanceof SourceError) {
        warnings.push({
          companyId: company.id,
          metricId: null,
          code: 'METRIC_NOT_TAGGED',
          detail: error.message,
        });
      }
      continue;
    }

    const { year, rows, consolidation, shares } = result.value;
    if (rows === null) continue; // 그 연도는 공시가 없다

    if (consolidation === 'OFS') {
      warnings.push({
        companyId: company.id,
        metricId: null,
        code: 'FELL_BACK_TO_SEPARATE',
        detail: `${year}년: 연결재무제표가 없어 별도재무제표를 사용했습니다`,
      });
    }

    const converted = convertFinancialRows(rows, {
      companyId: company.id,
      bsnsYear: year,
      accountingMonth: company.fiscalYearEndMonth,
      consolidation,
      periodType: 'FY',
      filedAt: null,
    });
    points.push(...converted.points);

    for (const metricId of converted.missing) {
      warnings.push({ companyId: company.id, metricId, code: 'METRIC_NOT_TAGGED' });
    }

    // 주식수는 별도 API 라 별도 행으로 만든다
    if (shares !== null) {
      const periodEnd = periodEndFor(year, company.fiscalYearEndMonth);
      const aligned = alignPeriod(periodEnd, 'FY');
      const shareEntries: Array<[BaseMetricId, number | null]> = [
        ['sharesOutstanding', shares.common.outstanding],
        ['sharesTotal', shares.totalOutstanding],
      ];

      for (const [metricId, value] of shareEntries) {
        points.push({
          companyId: company.id,
          metricId,
          periodType: 'FY',
          periodStart: null,
          periodEnd,
          fiscalYear: year,
          fiscalQuarter: null,
          alignedYear: aligned.alignedYear,
          alignedQuarter: aligned.alignedQuarter,
          value,
          currency: 'KRW',
          consolidation,
          source: 'DART',
          sourceTag: 'stockTotqySttus',
          filedAt: null,
        });
      }
    }
  }

  await storeFacts(deps.db, points);
  return warnings;
}

function periodEndFor(fiscalYear: number, accountingMonth: number): string {
  const lastDay = new Date(Date.UTC(fiscalYear, accountingMonth, 0)).getUTCDate();
  return `${fiscalYear}-${String(accountingMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

type StatementRows = NonNullable<
  z.infer<typeof DartFinancialResponseSchema>['list']
>;

async function fetchYear(
  dart: DartClient,
  company: CompanyRef,
  year: number,
): Promise<{
  rows: StatementRows | null;
  consolidation: Consolidation;
  shares: ReturnType<typeof extractShares> | null;
}> {
  const statements = await fetchStatements(dart, company.corpCode!, year);

  let shares: ReturnType<typeof extractShares> | null = null;
  if (statements.rows !== null) {
    const stock = await dart.call(
      'stockTotqySttus',
      { corp_code: company.corpCode!, bsns_year: year, reprt_code: REPORT_CODE.ANNUAL },
      DartStockResponseSchema,
    );
    if (stock !== null) shares = extractShares(stock.list ?? []);
  }

  return { ...statements, shares };
}

async function fetchStatements(
  dart: DartClient,
  corpCode: string,
  year: number,
): Promise<{ rows: StatementRows | null; consolidation: Consolidation }> {
  for (const consolidation of ['CFS', 'OFS'] as const) {
    const response = await dart.call(
      'fnlttSinglAcntAll',
      { corp_code: corpCode, bsns_year: year, reprt_code: REPORT_CODE.ANNUAL, fs_div: consolidation },
      DartFinancialResponseSchema,
    );
    if (response !== null && (response.list?.length ?? 0) > 0) {
      return { rows: response.list ?? [], consolidation };
    }
  }
  return { rows: null, consolidation: 'CFS' };
}

const BATCH = 200;

async function storeFacts(db: Db, points: readonly FinancialDataPoint[]): Promise<void> {
  if (points.length === 0) return;
  const updatedAt = new Date().toISOString();

  const rows = points.map((p) => ({
    companyId: p.companyId,
    metricId: p.metricId,
    periodType: p.periodType,
    periodStart: p.periodStart,
    periodEnd: p.periodEnd,
    fiscalYear: p.fiscalYear,
    fiscalQuarter: p.fiscalQuarter,
    alignedYear: p.alignedYear,
    alignedQuarter: p.alignedQuarter,
    // 정밀도를 지키려고 문자열로 저장한다
    value: p.value === null ? null : String(p.value),
    currency: p.currency,
    consolidation: p.consolidation,
    source: p.source,
    sourceTag: p.sourceTag,
    filedAt: p.filedAt,
    updatedAt,
  }));

  for (let i = 0; i < rows.length; i += BATCH) {
    await db
      .insert(financialFacts)
      .values(rows.slice(i, i + BATCH))
      .onConflictDoUpdate({
        target: [
          financialFacts.companyId,
          financialFacts.metricId,
          financialFacts.periodType,
          financialFacts.periodEnd,
          financialFacts.consolidation,
        ],
        set: {
          value: sql`excluded.value`,
          sourceTag: sql`excluded.source_tag`,
          alignedYear: sql`excluded.aligned_year`,
          alignedQuarter: sql`excluded.aligned_quarter`,
          filedAt: sql`excluded.filed_at`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
}

/** 저장된 BASE 값을 (companyId -> alignedYear -> metricId -> value) 로 읽어온다 */
/**
 * 저장된 값을 기간 라벨로 키를 잡아 돌려준다.
 *
 * 라벨은 buildPeriodAxis 가 만드는 것과 같다 — 연간이면 "2024",
 * 분기면 "2024Q1". 숫자 연도로 잡으면 분기를 담을 수 없다.
 */
export async function loadFacts(
  db: Db,
  companyIds: readonly string[],
  fromYear: number,
  toYear: number,
  periodType: 'FY' | 'Q' = 'FY',
): Promise<Map<string, Map<string, Map<BaseMetricId, number | null>>>> {
  const out = new Map<string, Map<string, Map<BaseMetricId, number | null>>>();
  if (companyIds.length === 0) return out;

  const rows = await db
    .select({
      companyId: financialFacts.companyId,
      metricId: financialFacts.metricId,
      alignedYear: financialFacts.alignedYear,
      alignedQuarter: financialFacts.alignedQuarter,
      value: financialFacts.value,
      sourceTag: financialFacts.sourceTag,
      consolidation: financialFacts.consolidation,
    })
    .from(financialFacts)
    .where(
      and(
        inArray(financialFacts.companyId, [...companyIds]),
        eq(financialFacts.periodType, periodType),
        gte(financialFacts.alignedYear, fromYear),
        lte(financialFacts.alignedYear, toYear),
      ),
    );

  for (const row of rows) {
    let byYear = out.get(row.companyId);
    if (byYear === undefined) {
      byYear = new Map();
      out.set(row.companyId, byYear);
    }
    // buildPeriodAxis 와 같은 라벨을 만든다
    const key =
      row.alignedQuarter === null
        ? String(row.alignedYear)
        : `${row.alignedYear}Q${row.alignedQuarter}`;

    let byMetric = byYear.get(key);
    if (byMetric === undefined) {
      byMetric = new Map();
      byYear.set(key, byMetric);
    }
    byMetric.set(row.metricId as BaseMetricId, row.value === null ? null : Number(row.value));
  }

  return out;
}

export async function loadCompanies(db: Db, ids: readonly string[]): Promise<CompanyRef[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: companies.id,
      corpCode: companies.corpCode,
      cik: companies.cik,
      fiscalYearEndMonth: companies.fiscalYearEndMonth,
      country: companies.country,
      nameKo: companies.nameKo,
      nameEn: companies.nameEn,
      market: companies.market,
      ticker: companies.ticker,
      stockCode: companies.stockCode,
    })
    .from(companies)
    .where(inArray(companies.id, [...ids]));

  // 요청 순서를 유지한다. 색상 배정이 순서에 묶여 있어서 뒤섞이면 안 된다.
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => r !== undefined);
}

/**
 * 진행 중인 회계연도의 최근 12개월 실적(TTM)을 확보한다.
 *
 * 회계연도가 끝나기 전에는 연간 수치가 존재하지 않는다. 2026년 8월에
 * 삼성전자를 보면 FY2026 은 2027년 3월에야 공시되므로, 연간만 그리면
 * 최근 8개월이 통째로 안 보인다 — "네이버에는 나오는데 여기선 안 보인다".
 *
 * 최신 분기 보고서 하나로 해결한다. 그 응답에 당기 누적과 전기 같은 기간
 * 누적이 함께 들어 있어서, TTM = 직전 연간 + 당기누적 - 전기누적 이 된다.
 * 분기를 4번 받아 더하는 것보다 호출이 적다 — DART 는 기업×연도마다
 * 불러야 해서 이 차이가 크다.
 */
export async function ensureInterimTtm(
  deps: FinancialsDeps,
  company: CompanyRef,
  year: number,
): Promise<{ label: string | null }> {
  if (company.country === 'US') return ensureUsInterimTtm(deps, company, year);
  if (company.corpCode === null) return { label: null };

  const existing = await db_hasInterimLabel(deps.db, company.id, year);
  if (existing !== null) return { label: existing };

  // 늦은 분기부터 본다. 3분기가 있으면 그게 가장 최신이다.
  const attempts: Array<{ code: string; through: 1 | 2 | 3 }> = [
    { code: REPORT_CODE.Q3, through: 3 },
    { code: REPORT_CODE.HALF, through: 2 },
    { code: REPORT_CODE.Q1, through: 1 },
  ];

  for (const attempt of attempts) {
    let rows: StatementRows | null = null;
    let consolidation: Consolidation = 'CFS';

    for (const fs of ['CFS', 'OFS'] as const) {
      const response = await deps.dart.call(
        'fnlttSinglAcntAll',
        { corp_code: company.corpCode, bsns_year: year, reprt_code: attempt.code, fs_div: fs },
        DartFinancialResponseSchema,
      );
      if (response !== null && (response.list?.length ?? 0) > 0) {
        rows = response.list ?? [];
        consolidation = fs;
        break;
      }
    }
    if (rows === null) continue;

    const { current, priorYear } = extractCumulative(rows);
    const priorAnnual = await loadAnnualValues(deps.db, company.id, year - 1);

    const periodEnd = quarterEndFor(year, company.fiscalYearEndMonth, attempt.through);
    const aligned = alignPeriod(periodEnd, 'FY');
    const points: FinancialDataPoint[] = [];

    for (const metricId of current.keys()) {
      const value = ttmFromCumulative(metricId, priorAnnual.get(metricId) ?? null, {
        throughQuarter: attempt.through,
        current: current.get(metricId) ?? null,
        priorYear: priorYear.get(metricId) ?? null,
      });
      if (value === null) continue;

      points.push({
        companyId: company.id,
        metricId,
        // 연간 축에 얹히지만 확정 연간이 아니다. sourceTag 로 구분한다.
        periodType: 'FY',
        periodStart: null,
        periodEnd,
        fiscalYear: year,
        fiscalQuarter: attempt.through,
        alignedYear: aligned.alignedYear,
        alignedQuarter: null,
        value,
        currency: 'KRW',
        consolidation,
        source: 'DART',
        sourceTag: `TTM(${attempt.through}분기까지)`,
        filedAt: null,
      });
    }

    if (points.length === 0) continue;
    await storeFacts(deps.db, points);
    return { label: quarterLabel(attempt.through) };
  }

  return { label: null };
}

const QUARTER_LABEL = { 1: '1분기', 2: '상반기', 3: '3분기' } as const;

function quarterLabel(through: 1 | 2 | 3): string {
  return QUARTER_LABEL[through];
}

/** 이미 만들어 둔 TTM 이 있으면 어느 분기까지 반영됐는지 돌려준다 */
async function db_hasInterimLabel(db: Db, companyId: string, year: number): Promise<string | null> {
  const rows = await db
    .select({ tag: financialFacts.sourceTag })
    .from(financialFacts)
    .where(
      and(
        eq(financialFacts.companyId, companyId),
        eq(financialFacts.fiscalYear, year),
        sql`${financialFacts.sourceTag} LIKE 'TTM(%'`,
      ),
    )
    .limit(1);

  const tag = rows[0]?.tag;
  if (tag === undefined) return null;
  const match = /TTM\((\d)분기까지\)/.exec(tag);
  const q = match?.[1];
  return q === undefined ? '최근 분기' : quarterLabel(Number(q) as 1 | 2 | 3);
}

/** 직전 연간 확정치. TTM 의 기준선이 된다 */
async function loadAnnualValues(
  db: Db,
  companyId: string,
  year: number,
): Promise<Map<BaseMetricId, number | null>> {
  const rows = await db
    .select({ metricId: financialFacts.metricId, value: financialFacts.value })
    .from(financialFacts)
    .where(
      and(
        eq(financialFacts.companyId, companyId),
        eq(financialFacts.fiscalYear, year),
        eq(financialFacts.source, 'DART'),
        // 작년 TTM 을 기준선으로 삼으면 오차가 누적된다. 확정 연간만 쓴다.
        sql`${financialFacts.sourceTag} NOT LIKE 'TTM(%'`,
      ),
    );

  const out = new Map<BaseMetricId, number | null>();
  for (const row of rows) {
    out.set(row.metricId as BaseMetricId, row.value === null ? null : Number(row.value));
  }
  return out;
}

/** 분기말 날짜. 결산월 기준으로 3·6·9개월 뒤 */
function quarterEndFor(fiscalYear: number, accountingMonth: number, through: 1 | 2 | 3): string {
  const startMonth = (accountingMonth % 12) + 1;
  const endMonth = ((startMonth - 1 + through * 3 - 1) % 12) + 1;
  const endYear = startMonth + through * 3 - 1 > 12 ? fiscalYear + 1 : fiscalYear;
  const lastDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();
  return `${endYear}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}


/**
 * 미국 기업의 진행 중인 회계연도 TTM.
 *
 * SEC companyfacts 는 10-Q 로 분기를 함께 준다. 국내처럼 누적을 빼고 더할
 * 필요 없이 **최근 4개 분기를 그대로 합산**하면 된다.
 *
 * 엔비디아는 1월 결산이라 2026년 8월이면 FY2027 이 진행 중이다. 우리 축의
 * 2026년이 그 해인데, 연간 확정치가 없어 통째로 비어 있었다.
 */
async function ensureUsInterimTtm(
  deps: FinancialsDeps,
  company: CompanyRef,
  year: number,
): Promise<{ label: string | null }> {
  if (company.cik === null) return { label: null };

  const existing = await db_hasInterimLabel(deps.db, company.id, year);
  if (existing !== null) return { label: existing };

  const facts = await deps.sec.fetchCompanyFacts(company.cik);
  if (facts === null) return { label: null };

  // 진행 중인 해와 직전 해의 분기를 모두 받아야 4개가 채워진다
  const quarters = convertSecQuarters(facts, {
    companyId: company.id,
    fromYear: year - 2,
    toYear: year,
  });

  /** metricId -> "YYYYQn" -> 값 */
  const byMetric = new Map<BaseMetricId, Map<string, number | null>>();
  for (const point of quarters) {
    let table = byMetric.get(point.metricId);
    if (table === undefined) {
      table = new Map<string, number | null>();
      byMetric.set(point.metricId, table);
    }
    table.set(`${point.alignedYear}Q${point.alignedQuarter ?? 0}`, point.value);
  }

  /*
   * 4분기를 채운다.
   *
   * 미국 기업은 4분기에 10-Q 를 내지 않는다 — 연간 10-K 하나로 갈음한다.
   * 그래서 SEC 에는 Q4 가 아예 없고, 최근 4개 분기를 모으면 항상 한 칸이 빈다.
   *
   * Q4 = 연간 - (1+2+3분기). 연간 확정치는 이미 DB 에 있으므로 그걸 쓴다.
   */
  for (const [metricId, table] of byMetric) {
    if (!isFlowMetric(metricId)) continue;

    for (const y of [year - 1, year - 2]) {
      if (table.get(`${y}Q4`) != null) continue;

      const q1 = table.get(`${y}Q1`);
      const q2 = table.get(`${y}Q2`);
      const q3 = table.get(`${y}Q3`);
      if (q1 == null || q2 == null || q3 == null) continue;

      const annual = await loadAnnualValue(deps.db, company.id, y, metricId);
      if (annual === null) continue;

      table.set(`${y}Q4`, annual - q1 - q2 - q3);
    }
  }

  // 진행 중인 해에 실제로 보고된 마지막 분기를 찾는다
  let latestQuarter = 0;
  for (const table of byMetric.values()) {
    for (let q = 4; q >= 1; q--) {
      if (table.get(`${year}Q${q}`) != null) {
        latestQuarter = Math.max(latestQuarter, q);
        break;
      }
    }
  }
  if (latestQuarter === 0) return { label: null };

  /** 최근 4개 분기 키. 진행 중인 해의 마지막 분기부터 거꾸로 */
  const window: string[] = [];
  for (let i = 0; i < TTM_WINDOW; i++) {
    const offset = latestQuarter - i;
    const y = offset > 0 ? year : year - 1;
    const q = offset > 0 ? offset : offset + 4;
    window.unshift(`${y}Q${q}`);
  }

  const periodEnd = quarters
    .filter((p) => p.alignedYear === year && p.alignedQuarter === latestQuarter)
    .map((p) => p.periodEnd)
    .sort()
    .pop();
  if (periodEnd === undefined) return { label: null };

  const aligned = alignPeriod(periodEnd, 'FY');
  const points: FinancialDataPoint[] = [];

  for (const [metricId, table] of byMetric) {
    const values = window.map((key) => table.get(key) ?? null);
    // 4개 중 하나라도 없으면 null 이다. 부분 합산은 과소 집계를 진짜처럼 보이게 한다.
    if (values.some((v) => v === null)) continue;

    const value = ttmValue(metricId, values);
    if (value === null) continue;

    points.push({
      companyId: company.id,
      metricId,
      // 연간 축에 얹히지만 확정 연간이 아니다. sourceTag 로 구분한다.
      periodType: 'FY',
      periodStart: null,
      periodEnd,
      fiscalYear: year,
      fiscalQuarter: latestQuarter,
      alignedYear: aligned.alignedYear,
      alignedQuarter: null,
      value,
      currency: 'USD',
      consolidation: 'CFS',
      source: 'SEC',
      sourceTag: `TTM(${latestQuarter}분기까지)`,
      filedAt: null,
    });
  }

  if (points.length === 0) return { label: null };
  await storeFacts(deps.db, points);
  return { label: quarterLabel(Math.min(latestQuarter, 3) as 1 | 2 | 3) };
}


/** 한 지표의 연간 확정치. Q4 를 역산할 때 쓴다 */
async function loadAnnualValue(
  db: Db,
  companyId: string,
  year: number,
  metricId: BaseMetricId,
): Promise<number | null> {
  const rows = await db
    .select({ value: financialFacts.value })
    .from(financialFacts)
    .where(
      and(
        eq(financialFacts.companyId, companyId),
        eq(financialFacts.alignedYear, year),
        eq(financialFacts.metricId, metricId),
        eq(financialFacts.periodType, 'FY'),
        // TTM 을 기준선으로 삼으면 오차가 누적된다. 확정 연간만 쓴다.
        sql`${financialFacts.sourceTag} NOT LIKE 'TTM(%'`,
      ),
    )
    .limit(1);

  const value = rows[0]?.value;
  return value === undefined || value === null ? null : Number(value);
}

/**
 * 분기 시계열을 확보한다.
 *
 * 국내는 DART 분기·반기 보고서에서, 미국은 SEC 10-Q 에서 받는다.
 * 조회한 기업만 그때그때 받는다 — 300개를 미리 받으면 DART 호출이
 * 기업×연도×4 라 일일 한도를 크게 먹는다.
 */
export async function ensureQuarterlyFinancials(
  deps: FinancialsDeps,
  company: CompanyRef,
  fromYear: number,
  toYear: number,
): Promise<FetchWarning[]> {
  if (company.country === 'US') return ensureUsQuarters(deps, company, fromYear, toYear);
  return ensureKoreanQuarters(deps, company, fromYear, toYear);
}

async function ensureUsQuarters(
  deps: FinancialsDeps,
  company: CompanyRef,
  fromYear: number,
  toYear: number,
): Promise<FetchWarning[]> {
  const warnings: FetchWarning[] = [];
  if (company.cik === null) return warnings;

  const have = await existingQuarters(deps.db, company.id, fromYear, toYear);
  // 요청 구간이 이미 다 차 있으면 부르지 않는다
  if (have.size >= (toYear - fromYear + 1) * 4) return warnings;

  const facts = await deps.sec.fetchCompanyFacts(company.cik);
  if (facts === null) return warnings;

  const points = convertSecQuarters(facts, { companyId: company.id, fromYear, toYear });

  /*
   * 4분기를 채운다.
   *
   * 미국 기업은 4분기에 10-Q 를 내지 않고 연간 10-K 하나로 갈음한다.
   * 그래서 SEC 에 Q4 가 아예 없어, 분기 축에서 매년 마지막 칸이 빈다.
   * Q4 = 연간 - (1+2+3분기).
   */
  const byMetricYear = new Map<string, Map<number, number>>();
  for (const point of points) {
    if (point.alignedQuarter === null || point.value === null) continue;
    const key = `${point.metricId}|${point.alignedYear}`;
    let table = byMetricYear.get(key);
    if (table === undefined) {
      table = new Map<number, number>();
      byMetricYear.set(key, table);
    }
    table.set(point.alignedQuarter, point.value);
  }

  const derived: FinancialDataPoint[] = [];
  for (const [key, table] of byMetricYear) {
    const [metricRaw, yearRaw] = key.split('|');
    const metricId = metricRaw as BaseMetricId;
    const year = Number(yearRaw);
    if (table.has(4)) continue;

    const q1 = table.get(1);
    const q2 = table.get(2);
    const q3 = table.get(3);
    if (q1 === undefined || q2 === undefined || q3 === undefined) continue;

    const annual = await loadAnnualValue(deps.db, company.id, year, metricId);
    if (annual === null) continue;

    // 시점 항목은 뺄셈이 성립하지 않는다. 연말 잔액이 곧 4분기 값이다.
    const value = isFlowMetric(metricId) ? annual - q1 - q2 - q3 : annual;

    derived.push({
      companyId: company.id,
      metricId,
      periodType: 'Q',
      periodStart: null,
      periodEnd: `${year}-12-31`,
      fiscalYear: year,
      fiscalQuarter: 4,
      alignedYear: year,
      alignedQuarter: 4,
      value,
      currency: 'USD',
      consolidation: 'CFS',
      source: 'SEC',
      sourceTag: '4분기(연간-3분기합)',
      filedAt: null,
    });
  }

  await storeFacts(deps.db, [...points, ...derived]);
  return warnings;
}

/**
 * 국내 분기.
 *
 * DART 는 분기별 3개월치를 thstrm_amount 로 준다. 4분기는 보고서가 따로
 * 없어서 연간에서 3분기 누적을 빼야 하는데, 그 누적이 3분기 보고서의
 * thstrm_add_amount 다.
 */
async function ensureKoreanQuarters(
  deps: FinancialsDeps,
  company: CompanyRef,
  fromYear: number,
  toYear: number,
): Promise<FetchWarning[]> {
  const warnings: FetchWarning[] = [];
  if (company.corpCode === null) return warnings;

  const have = await existingQuarters(deps.db, company.id, fromYear, toYear);

  const REPORTS: Array<{ code: string; quarter: 1 | 2 | 3 }> = [
    { code: REPORT_CODE.Q1, quarter: 1 },
    { code: REPORT_CODE.HALF, quarter: 2 },
    { code: REPORT_CODE.Q3, quarter: 3 },
  ];

  for (let year = fromYear; year <= toYear; year++) {
    // 그 해 분기가 이미 다 있으면 건너뛴다
    if ([1, 2, 3, 4].every((q) => have.has(`${year}Q${q}`))) continue;

    const points: FinancialDataPoint[] = [];
    /** 3분기 누적. 4분기를 역산할 때 쓴다 */
    let q3Cumulative: Map<BaseMetricId, number | null> | null = null;

    for (const report of REPORTS) {
      let rows: StatementRows | null = null;
      let consolidation: Consolidation = 'CFS';

      for (const fs of ['CFS', 'OFS'] as const) {
        const response = await deps.dart.call(
          'fnlttSinglAcntAll',
          { corp_code: company.corpCode, bsns_year: year, reprt_code: report.code, fs_div: fs },
          DartFinancialResponseSchema,
        );
        if (response !== null && (response.list?.length ?? 0) > 0) {
          rows = response.list ?? [];
          consolidation = fs;
          break;
        }
      }
      if (rows === null) continue;

      const converted = convertQuarterRows(rows, {
        companyId: company.id,
        fiscalYear: year,
        quarter: report.quarter,
        accountingMonth: company.fiscalYearEndMonth,
        consolidation,
      });
      points.push(...converted);

      if (report.quarter === 3) {
        q3Cumulative = extractCumulative(rows).current;
      }
    }

    // 4분기 = 연간 - 3분기 누적
    if (q3Cumulative !== null) {
      const annual = await loadAnnualValues(deps.db, company.id, year);
      const periodEnd = periodEndFor(year, company.fiscalYearEndMonth);

      for (const [metricId, cumulative] of q3Cumulative) {
        const total = annual.get(metricId) ?? null;
        if (total === null) continue;

        // 시점 항목은 뺄셈이 성립하지 않는다. 연말 잔액이 곧 4분기 값이다.
        const value = isFlowMetric(metricId)
          ? cumulative === null
            ? null
            : total - cumulative
          : total;
        if (value === null) continue;

        points.push({
          companyId: company.id,
          metricId,
          periodType: 'Q',
          periodStart: null,
          periodEnd,
          fiscalYear: year,
          fiscalQuarter: 4,
          alignedYear: year,
          alignedQuarter: 4,
          value,
          currency: 'KRW',
          consolidation: 'CFS',
          source: 'DART',
          sourceTag: '4분기(연간-3분기누적)',
          filedAt: null,
        });
      }
    }

    await storeFacts(deps.db, points);
  }

  return warnings;
}

/** 이미 저장된 분기 라벨 */
async function existingQuarters(
  db: Db,
  companyId: string,
  from: number,
  to: number,
): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({
      year: financialFacts.alignedYear,
      quarter: financialFacts.alignedQuarter,
    })
    .from(financialFacts)
    .where(
      and(
        eq(financialFacts.companyId, companyId),
        eq(financialFacts.periodType, 'Q'),
        gte(financialFacts.alignedYear, from),
        lte(financialFacts.alignedYear, to),
      ),
    );
  return new Set(rows.filter((r) => r.quarter !== null).map((r) => `${r.year}Q${r.quarter}`));
}
