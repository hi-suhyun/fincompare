import { alignPeriod, type BaseMetricId, type FinancialDataPoint } from '@fincompare/shared';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import type { PriceAdapter } from '../adapters/price/types.js';
import { SourceError } from '../core/errors.js';
import type { Db } from '../db/client.js';
import { financialFacts, prices } from '../db/schema.js';
import type { CompanyRef } from './financials.js';
import { fiscalPeriodBounds } from './currency.js';

/**
 * 기말 종가 수집.
 *
 * 필요한 건 회계연도 기말 시점의 종가뿐이다. 일별 전체를 저장할 이유가 없다.
 * 기업 5개 × 10년이면 50개 지점이고, 대부분 소스가 한 번의 호출로 전 구간을 준다.
 */

export interface PriceDeps {
  db: Db;
  /** 국내·해외 각각의 구현체. 없으면 그 시장은 주가 없이 동작한다 */
  krPrice: PriceAdapter | null;
  usPrice: PriceAdapter | null;
}

export interface PriceWarning {
  companyId: string;
  detail: string;
}

function adapterFor(deps: PriceDeps, company: CompanyRef): PriceAdapter | null {
  return company.country === 'US' ? deps.usPrice : deps.krPrice;
}

/**
 * 어댑터가 요구하는 식별자를 만든다.
 * KRX 는 시장별로 엔드포인트가 달라 '{market}:{code}' 를 받는다.
 */
function identifierFor(adapter: PriceAdapter, company: CompanyRef): string | null {
  if (adapter.source === 'KRX') {
    return company.stockCode === null ? null : `${company.market}:${company.stockCode}`;
  }
  if (adapter.source === 'NAVER') return company.stockCode;
  return company.ticker;
}

export async function ensureClosePrices(
  deps: PriceDeps,
  company: CompanyRef,
  fromYear: number,
  toYear: number,
): Promise<PriceWarning[]> {
  const warnings: PriceWarning[] = [];
  const adapter = adapterFor(deps, company);

  if (adapter === null) {
    warnings.push({
      companyId: company.id,
      detail:
        company.country === 'US'
          ? '미국 주가 소스가 설정되지 않았습니다 (TIINGO_API_KEY)'
          : '국내 주가 소스가 설정되지 않았습니다',
    });
    return warnings;
  }

  const identifier = identifierFor(adapter, company);
  if (identifier === null) return warnings;

  // 이미 받아둔 연도는 건너뛴다
  const existing = await deps.db
    .selectDistinct({ alignedYear: financialFacts.alignedYear })
    .from(financialFacts)
    .where(
      and(
        eq(financialFacts.companyId, company.id),
        eq(financialFacts.metricId, 'closePrice'),
        gte(financialFacts.alignedYear, fromYear),
        lte(financialFacts.alignedYear, toYear),
      ),
    );
  const have = new Set(existing.map((r) => r.alignedYear));

  const targets: Array<{ year: number; date: string }> = [];
  for (let year = fromYear; year <= toYear; year++) {
    if (have.has(year)) continue;
    targets.push({ year, date: fiscalPeriodBounds(year, company.fiscalYearEndMonth).end });
  }
  if (targets.length === 0) return warnings;

  let points;
  try {
    points = await adapter.fetchCloses(
      identifier,
      targets.map((t) => t.date),
    );
  } catch (error) {
    warnings.push({
      companyId: company.id,
      detail:
        error instanceof SourceError
          ? `주가를 받지 못했습니다: ${error.message}`
          : '주가를 받지 못했습니다',
    });
    return warnings;
  }

  const byDate = new Map(points.map((p) => [p.date, p]));
  const facts: FinancialDataPoint[] = [];
  const priceRows: Array<typeof prices.$inferInsert> = [];

  for (const target of targets) {
    const point = byDate.get(target.date);
    if (point === undefined) continue;

    const aligned = alignPeriod(target.date, 'FY');
    facts.push({
      companyId: company.id,
      metricId: 'closePrice' as BaseMetricId,
      periodType: 'FY',
      periodStart: null,
      periodEnd: target.date,
      fiscalYear: target.year,
      fiscalQuarter: null,
      alignedYear: aligned.alignedYear,
      alignedQuarter: aligned.alignedQuarter,
      value: point.close,
      currency: point.currency,
      consolidation: 'CFS',
      source: adapter.source,
      sourceTag: adapter.isSplitAdjusted ? 'close(수정주가)' : 'close(실거래)',
      filedAt: null,
    });

    priceRows.push({
      companyId: company.id,
      date: target.date,
      close: String(point.close),
      currency: point.currency,
      source: adapter.source,
    });
  }

  await storePriceFacts(deps.db, facts, priceRows);
  return warnings;
}

/** 이 회사 주가가 수정주가인지 — EPS 쪽 기준을 맞출지 판단하는 데 쓴다 */
export function isSplitAdjustedSource(deps: PriceDeps, company: CompanyRef): boolean {
  return adapterFor(deps, company)?.isSplitAdjusted ?? false;
}

const BATCH = 200;

async function storePriceFacts(
  db: Db,
  facts: readonly FinancialDataPoint[],
  priceRows: readonly (typeof prices.$inferInsert)[],
): Promise<void> {
  if (facts.length === 0) return;
  const updatedAt = new Date().toISOString();

  const rows = facts.map((p) => ({
    companyId: p.companyId,
    metricId: p.metricId,
    periodType: p.periodType,
    periodStart: p.periodStart,
    periodEnd: p.periodEnd,
    fiscalYear: p.fiscalYear,
    fiscalQuarter: p.fiscalQuarter,
    alignedYear: p.alignedYear,
    alignedQuarter: p.alignedQuarter,
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
          currency: sql`excluded.currency`,
          source: sql`excluded.source`,
          sourceTag: sql`excluded.source_tag`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }

  for (let i = 0; i < priceRows.length; i += BATCH) {
    await db
      .insert(prices)
      .values(priceRows.slice(i, i + BATCH))
      .onConflictDoUpdate({
        target: [prices.companyId, prices.date],
        set: { close: sql`excluded.close`, source: sql`excluded.source` },
      });
  }
}
