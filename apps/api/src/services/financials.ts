import {
  alignPeriod,
  type BaseMetricId,
  type Consolidation,
  type FinancialDataPoint,
  type WarningCode,
} from '@fincompare/shared';
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { DartClient } from '../adapters/dart/client.js';
import type { SecClient } from '../adapters/sec/client.js';
import { convertSecFacts } from '../adapters/sec/financials.js';
import { convertFinancialRows, extractShares } from '../adapters/dart/financials.js';
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
export async function loadFacts(
  db: Db,
  companyIds: readonly string[],
  fromYear: number,
  toYear: number,
): Promise<Map<string, Map<number, Map<BaseMetricId, number | null>>>> {
  const out = new Map<string, Map<number, Map<BaseMetricId, number | null>>>();
  if (companyIds.length === 0) return out;

  const rows = await db
    .select({
      companyId: financialFacts.companyId,
      metricId: financialFacts.metricId,
      alignedYear: financialFacts.alignedYear,
      value: financialFacts.value,
      sourceTag: financialFacts.sourceTag,
      consolidation: financialFacts.consolidation,
    })
    .from(financialFacts)
    .where(
      and(
        inArray(financialFacts.companyId, [...companyIds]),
        eq(financialFacts.periodType, 'FY'),
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
    let byMetric = byYear.get(row.alignedYear);
    if (byMetric === undefined) {
      byMetric = new Map();
      byYear.set(row.alignedYear, byMetric);
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
