import {
  USGAAP_ACCOUNT_MAP,
  alignPeriod,
  expandTaxonomyVariants,
  type BaseMetricId,
  type FinancialDataPoint,
} from '@fincompare/shared';
import { readConcept, type SecCompanyFacts, type SecFactRow } from './schema.js';

/**
 * SEC companyfacts -> 분기 시계열.
 *
 * 연간 변환(financials.ts)은 10-K 만 보고 ~365일 구간만 취한다. 분기는
 * 그 필터에 전부 걸려 빠지므로 여기서 따로 뽑는다.
 *
 * 연간 쪽과 같은 원칙을 지킨다:
 *  - fy / fp 를 믿지 않는다. 기간은 start / end 에서 직접 계산한다.
 *    (엔비디아는 같은 2025-01-27~04-27 구간이 fy=2026 과 fy=2027 로 두 번 실린다)
 *  - 같은 기간이 여러 보고서에 반복되면 가장 먼저 제출된 것을 쓴다.
 *
 * 4분기는 10-Q 가 없다. 연간에서 3분기 누적을 빼야 나오는데, 그건 분기
 * 데이터만으로는 안 되므로 여기서 만들지 않는다 — 호출한 쪽에서 채운다.
 */

const DAY_MS = 86_400_000;

/** 분기로 인정할 기간 길이(일). 13주 회계분기와 달력 분기를 모두 담는다 */
const QUARTER_MIN_DAYS = 80;
const QUARTER_MAX_DAYS = 100;

/** 재무상태표 항목은 start 가 없는 시점 데이터다 */
const BALANCE_SHEET_METRICS: ReadonlySet<BaseMetricId> = new Set([
  'totalAssets',
  'totalLiabilities',
  'totalEquity',
  'equityControlling',
]);

function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(end) - Date.parse(start)) / DAY_MS);
}

function isQuarterPeriod(row: SecFactRow): boolean {
  if (row.start === undefined) return false;
  const days = daysBetween(row.start, row.end);
  return days >= QUARTER_MIN_DAYS && days <= QUARTER_MAX_DAYS;
}

/** 정렬 연도·분기를 한 키로. 2026Q1 처럼 */
function quarterKey(year: number, quarter: number): string {
  return `${year}Q${quarter}`;
}

interface Candidate {
  row: SecFactRow;
  tag: string;
}

export interface SecQuarterConvertOptions {
  companyId: string;
  /** 이 연도부터 (정렬 연도 기준) */
  fromYear: number;
  toYear: number;
}

/**
 * 지표 하나의 분기 시계열을 뽑는다.
 *
 * 태그가 바뀌는 구간(ASC 606 등)을 위해 연간 쪽과 같이 태그 우선순위대로
 * 훑고, 앞선 태그가 채우지 못한 분기만 뒤 태그가 메운다.
 */
function resolveQuarters(
  facts: SecCompanyFacts,
  tags: readonly string[],
  unitFilter: (unit: string) => boolean,
  wantPointInTime: boolean,
): Map<string, Candidate> {
  const byQuarter = new Map<string, Candidate>();

  for (const tag of expandTaxonomyVariants(tags)) {
    const forThisTag = new Map<string, Candidate>();

    for (const taxonomy of Object.keys(facts.facts)) {
      const concept = readConcept(facts, taxonomy, tag);
      if (concept === null) continue;

      for (const [unit, rows] of Object.entries(concept.units)) {
        if (!unitFilter(unit)) continue;

        for (const row of rows) {
          // 10-Q 가 기본이고, 4분기 시점 데이터는 10-K 에만 있다
          if (row.form !== '10-Q' && row.form !== '10-K') continue;

          if (wantPointInTime) {
            // 재무상태표: 기간 데이터가 아니라 그 시점의 잔액이다
            if (row.start !== undefined) continue;
          } else if (!isQuarterPeriod(row)) {
            continue;
          }

          const aligned = alignPeriod(row.end, 'Q');
          if (aligned.alignedQuarter === null) continue;
          const key = quarterKey(aligned.alignedYear, aligned.alignedQuarter);

          const existing = forThisTag.get(key);
          // 같은 분기 중복: 먼저 제출된 것을 쓴다 (그때 공시한 값)
          if (existing === undefined || (row.filed ?? '9999') < (existing.row.filed ?? '9999')) {
            forThisTag.set(key, { row, tag });
          }
        }
      }
    }

    for (const [key, candidate] of forThisTag) {
      if (!byQuarter.has(key)) byQuarter.set(key, candidate);
    }
  }

  return byQuarter;
}

const isMoneyUnit = (unit: string): boolean => unit === 'USD';
const isShareUnit = (unit: string): boolean => unit === 'shares';
const isPerShareUnit = (unit: string): boolean => unit === 'USD/shares';

function unitFilterFor(metricId: BaseMetricId): (unit: string) => boolean {
  if (metricId === 'sharesOutstanding' || metricId === 'sharesTotal') return isShareUnit;
  if (metricId === 'eps') return isPerShareUnit;
  return isMoneyUnit;
}

export function convertSecQuarters(
  facts: SecCompanyFacts,
  options: SecQuarterConvertOptions,
): FinancialDataPoint[] {
  const points: FinancialDataPoint[] = [];
  const metricIds = Object.keys(USGAAP_ACCOUNT_MAP) as BaseMetricId[];

  for (const metricId of metricIds) {
    const mapping = USGAAP_ACCOUNT_MAP[metricId];
    if (mapping === undefined) continue;

    const wantPointInTime = BALANCE_SHEET_METRICS.has(metricId);
    const resolved = resolveQuarters(
      facts,
      mapping.tags,
      unitFilterFor(metricId),
      wantPointInTime,
    );

    for (const [key, candidate] of resolved) {
      const [yearPart, quarterPart] = key.split('Q');
      const year = Number(yearPart);
      const quarter = Number(quarterPart);
      if (year < options.fromYear || year > options.toYear) continue;

      points.push({
        companyId: options.companyId,
        metricId,
        periodType: 'Q',
        periodStart: candidate.row.start ?? null,
        periodEnd: candidate.row.end,
        fiscalYear: year,
        fiscalQuarter: quarter,
        alignedYear: year,
        alignedQuarter: quarter,
        value: candidate.row.val,
        currency: 'USD',
        consolidation: 'CFS',
        source: 'SEC',
        sourceTag: candidate.tag,
        filedAt: candidate.row.filed ?? null,
      });
    }
  }

  return points;
}
