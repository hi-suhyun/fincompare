import { alignPeriod, type BaseMetricId, type FinancialDataPoint } from '@fincompare/shared';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import type { PriceAdapter, PricePoint } from '../adapters/price/types.js';
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
    // 구현 세부(환경변수 이름)가 아니라 사용자가 알아야 할 이유를 적는다.
    // 미국 주가는 무료 API 가 전부 재배포·표시를 금지해서 의도적으로 뺀 것이다
    // (docs/00-data-sources.md 3.4). 재무지표는 SEC 로 정상 제공된다.
    warnings.push({
      companyId: company.id,
      detail:
        company.country === 'US'
          ? '미국 기업은 주가 연동을 하지 않아 밸류에이션 지표가 없습니다. 재무지표는 정상 제공됩니다'
          : '국내 주가 소스가 설정되지 않았습니다 (KRX_AUTH_KEY)',
    });
    return warnings;
  }

  const identifier = identifierFor(adapter, company);
  if (identifier === null) return warnings;

  /**
   * 이미 받아둔 연도는 건너뛴다 — 단 **같은 소스로 받은 것만**.
   *
   * 소스가 바뀌면 기준이 달라진다. 네이버는 수정주가, KRX 는 미조정 실거래가다.
   * 2017년 삼성전자가 한쪽은 50,960원, 다른 쪽은 2,548,000원이다.
   * 섞이면 액면분할 조정이 어긋나 PER 이 조용히 틀린다.
   */
  const existing = await deps.db
    .selectDistinct({ alignedYear: financialFacts.alignedYear })
    .from(financialFacts)
    .where(
      and(
        eq(financialFacts.companyId, company.id),
        eq(financialFacts.metricId, 'closePrice'),
        eq(financialFacts.source, adapter.source),
        gte(financialFacts.alignedYear, fromYear),
        lte(financialFacts.alignedYear, toYear),
      ),
    );
  const have = new Set(existing.map((r) => r.alignedYear));

  /**
   * 기말일은 **재무데이터가 저장한 periodEnd 를 그대로 쓴다.**
   *
   * 회계연도 라벨로 월말을 계산하면 정렬 연도가 어긋난다.
   * NVDA(1월 결산)는 FY2024 기말이 2024-01-31 인데 정렬 연도는 2023 이다.
   * 라벨 기준으로 날짜를 만들면 2024년 자리에 넣으려던 주가가 2023년에 저장되고,
   * 2024년은 영영 비어 매번 다시 받으려 한다.
   *
   * 재무데이터의 periodEnd 를 쓰면 정렬이 자동으로 맞고,
   * AAPL 처럼 52/53주 회계연도를 쓰는 기업의 실제 기말일(2024-09-28)도 정확해진다.
   */
  const periodEnds = await deps.db
    .selectDistinct({
      alignedYear: financialFacts.alignedYear,
      periodEnd: financialFacts.periodEnd,
    })
    .from(financialFacts)
    .where(
      and(
        eq(financialFacts.companyId, company.id),
        eq(financialFacts.periodType, 'FY'),
        eq(financialFacts.metricId, 'revenue'),
        gte(financialFacts.alignedYear, fromYear),
        lte(financialFacts.alignedYear, toYear),
      ),
    );

  const targets: Array<{ year: number; date: string }> = [];
  for (const row of periodEnds) {
    if (have.has(row.alignedYear)) continue;
    targets.push({ year: row.alignedYear, date: row.periodEnd });
  }

  // 재무데이터가 없는 연도는 결산월로 추정한다. 주가만 있어도 아쉬우니 시도는 한다.
  const covered = new Set(periodEnds.map((r) => r.alignedYear));
  for (let year = fromYear; year <= toYear; year++) {
    if (have.has(year) || covered.has(year)) continue;
    const bounds = fiscalPeriodBounds(year, company.fiscalYearEndMonth);
    // 결산월 보정으로 정렬 연도가 밀리는 기업은 추정 자체가 어긋나므로 건너뛴다
    if (alignPeriod(bounds.end, 'FY').alignedYear !== year) continue;
    targets.push({ year, date: bounds.end });
  }

  if (targets.length === 0) return warnings;

  let points: PricePoint[];
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

    facts.push({
      companyId: company.id,
      metricId: 'closePrice' as BaseMetricId,
      periodType: 'FY',
      periodStart: null,
      periodEnd: target.date,
      fiscalYear: target.year,
      fiscalQuarter: null,
      // target.year 는 이미 재무데이터의 정렬 연도다. 다시 계산하면 어긋난다.
      alignedYear: target.year,
      alignedQuarter: null,
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
