import {
  USGAAP_ACCOUNT_MAP,
  USGAAP_EQUITY_INCL_NCI_TAG,
  alignPeriod,
  expandTaxonomyVariants,
  type BaseMetricId,
  type FinancialDataPoint,
} from '@fincompare/shared';
import { readConcept, type SecCompanyFacts, type SecFactRow } from './schema.js';

/**
 * SEC companyfacts -> 내부 표준 FinancialDataPoint
 *
 * 핵심 제약 (실측으로 확인, docs/00-data-sources.md 1장):
 *
 *  1. `fy` / `fp` 는 회계연도 식별자가 아니다. 비교표시로 실린 값도 그 보고서의 fy 를 달고 온다.
 *     AAPL FY2021 매출(3,658억$)이 fy=2023 으로 찍힌다.
 *     -> 회계연도는 반드시 start / end 날짜에서 직접 계산한다.
 *
 *  2. `frame` 은 결측이 많다 (NVDA 연간 6개 중 2개만).
 *     -> 정렬 키로 못 쓴다. alignPeriod() 로 우리 규칙을 적용한다.
 *
 *  3. 같은 기간이 여러 보고서에 반복해서 실린다.
 *     -> 가장 먼저 제출된 것(원 보고서)을 택한다. DART 쪽을 "각 연도 사업보고서 공시값"으로
 *        맞췄으므로 기준을 통일한다. 재작성 값을 쓰고 싶으면 여기만 바꾸면 된다.
 */

/** 연간으로 인정할 기간 길이(일). 52/53주 회계연도를 포함해야 한다 */
const ANNUAL_MIN_DAYS = 340;
const ANNUAL_MAX_DAYS = 400;

const DAY_MS = 86_400_000;

function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(end) - Date.parse(start)) / DAY_MS);
}

function isAnnualPeriod(row: SecFactRow): boolean {
  if (row.start === undefined) return false;
  const days = daysBetween(row.start, row.end);
  return days >= ANNUAL_MIN_DAYS && days <= ANNUAL_MAX_DAYS;
}

/** 재무상태표 항목은 start 가 없는 시점 데이터다 */
const BALANCE_SHEET_METRICS: ReadonlySet<BaseMetricId> = new Set([
  'totalAssets',
  'totalLiabilities',
  'totalEquity',
  'equityControlling',
]);

const SHARE_METRICS: ReadonlySet<BaseMetricId> = new Set(['sharesOutstanding', 'sharesTotal']);

export interface SecConvertOptions {
  companyId: string;
  fromYear: number;
  toYear: number;
  fiscalYearEndMonth: number;
}

export interface SecConvertResult {
  points: FinancialDataPoint[];
  /** 아예 못 찾은 지표 */
  missing: BaseMetricId[];
}

interface Candidate {
  row: SecFactRow;
  tag: string;
}

/**
 * 한 개념(태그)의 행들 중 우리가 쓸 것만 골라 회계연도별로 모은다.
 * 같은 연도에 여러 후보가 있으면 가장 먼저 제출된 것을 택한다.
 */
function collectByYear(
  facts: SecCompanyFacts,
  tags: readonly string[],
  wantPointInTime: boolean,
  unitFilter: (unit: string) => boolean,
): Map<number, Candidate> {
  const byYear = new Map<number, Candidate>();

  // 태그를 우선순위 순으로 본다. 상위 태그가 채운 연도는 하위 태그가 덮지 않는다.
  // ASC 606 전환처럼 태그가 바뀌는 구간에서는 최신 태그가 최근 연도를 채우고,
  // 구 태그(SalesRevenueNet 등)가 남은 과거 연도를 메운다.
  for (const tag of expandTaxonomyVariants(tags)) {
    const forThisTag = new Map<number, Candidate>();

    for (const taxonomy of Object.keys(facts.facts)) {
      const concept = readConcept(facts, taxonomy, tag);
      if (concept === null) continue;

      for (const [unit, rows] of Object.entries(concept.units)) {
        if (!unitFilter(unit)) continue;

        for (const row of rows) {
          // 10-K 만 본다. 10-Q 는 분기 데이터라 연간 시계열에 섞이면 안 된다.
          if (row.form !== '10-K') continue;

          if (wantPointInTime) {
            // 재무상태표: start 가 있으면 기간 데이터라 제외
            if (row.start !== undefined) continue;
          } else if (!isAnnualPeriod(row)) {
            continue;
          }

          const year = alignPeriod(row.end, 'FY').alignedYear;
          const existing = forThisTag.get(year);

          // 같은 연도 중복: 먼저 제출된 것을 쓴다 (원 보고서 = 그때 공시한 값)
          if (existing === undefined || (row.filed ?? '9999') < (existing.row.filed ?? '9999')) {
            forThisTag.set(year, { row, tag });
          }
        }
      }
    }

    for (const [year, candidate] of forThisTag) {
      if (!byYear.has(year)) byYear.set(year, candidate);
    }
  }

  return byYear;
}

const isMoneyUnit = (unit: string): boolean => unit === 'USD';
const isShareUnit = (unit: string): boolean => unit === 'shares';
const isPerShareUnit = (unit: string): boolean => unit === 'USD/shares';

export function convertSecFacts(
  facts: SecCompanyFacts,
  options: SecConvertOptions,
): SecConvertResult {
  const points: FinancialDataPoint[] = [];
  const missing: BaseMetricId[] = [];

  const metricIds = Object.keys(USGAAP_ACCOUNT_MAP) as BaseMetricId[];

  /** metricId -> year -> value */
  const resolved = new Map<BaseMetricId, Map<number, Candidate>>();

  for (const metricId of metricIds) {
    const rule = USGAAP_ACCOUNT_MAP[metricId];
    if (rule === undefined) continue;

    const unitFilter = SHARE_METRICS.has(metricId)
      ? isShareUnit
      : metricId === 'eps'
        ? isPerShareUnit
        : isMoneyUnit;

    const byYear = collectByYear(
      facts,
      rule.tags,
      BALANCE_SHEET_METRICS.has(metricId) || SHARE_METRICS.has(metricId),
      unitFilter,
    );

    resolved.set(metricId, byYear);
    if (byYear.size === 0) missing.push(metricId);
  }

  // Liabilities 를 태깅하지 않는 기업이 있다. Assets - Equity(비지배포함) 로 메운다.
  patchDerivedLiabilities(facts, resolved);

  for (let year = options.fromYear; year <= options.toYear; year++) {
    for (const metricId of metricIds) {
      const candidate = resolved.get(metricId)?.get(year);
      if (candidate === undefined) continue;

      const { row, tag } = candidate;
      const aligned = alignPeriod(row.end, 'FY');

      points.push({
        companyId: options.companyId,
        metricId,
        periodType: 'FY',
        periodStart: row.start ?? null,
        periodEnd: row.end,
        // SEC 의 fy 는 신뢰할 수 없다. 우리가 계산한 정렬 연도를 회계연도로도 쓴다.
        fiscalYear: aligned.alignedYear,
        fiscalQuarter: null,
        alignedYear: aligned.alignedYear,
        alignedQuarter: aligned.alignedQuarter,
        value: row.val,
        currency: 'USD',
        // SEC 는 항상 연결이다
        consolidation: 'CFS',
        source: 'SEC',
        sourceTag: tag,
        filedAt: row.filed ?? null,
      });
    }
  }

  return { points, missing };
}

/**
 * Liabilities 미태깅 기업 보정.
 *
 * 미국 기업 중 부채총계를 별도로 태깅하지 않는 곳이 있다.
 * 대차평형(자산 = 부채 + 자본)으로 파생 계산한다.
 */
function patchDerivedLiabilities(
  facts: SecCompanyFacts,
  resolved: Map<BaseMetricId, Map<number, Candidate>>,
): void {
  const liabilities = resolved.get('totalLiabilities');
  const assets = resolved.get('totalAssets');
  if (liabilities === undefined || assets === undefined) return;

  const equityInclNci = collectByYear(facts, [USGAAP_EQUITY_INCL_NCI_TAG], true, isMoneyUnit);

  for (const [year, assetCandidate] of assets) {
    if (liabilities.has(year)) continue;

    const equity = equityInclNci.get(year);
    if (equity === undefined) continue;

    liabilities.set(year, {
      tag: `(파생) Assets - ${USGAAP_EQUITY_INCL_NCI_TAG}`,
      row: {
        end: assetCandidate.row.end,
        val: assetCandidate.row.val - equity.row.val,
        ...(assetCandidate.row.filed === undefined ? {} : { filed: assetCandidate.row.filed }),
        form: '10-K',
      },
    });
  }
}

/** 20-F / 40-F 제출 이력이 있으면 ADR·외국사기업이다. 1차 범위에서 제외 */
export function isForeignIssuer(forms: readonly string[] | undefined): boolean {
  if (forms === undefined) return false;
  return forms.some((form) => form === '20-F' || form === '40-F');
}
