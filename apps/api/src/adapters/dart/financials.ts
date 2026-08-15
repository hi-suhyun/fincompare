import {
  KIFRS_ACCOUNT_MAP,
  alignPeriod,
  resolveMetric,
  type BaseMetricId,
  type Consolidation,
  type FinancialDataPoint,
  type PeriodType,
  type RawFact,
} from '@fincompare/shared';
import { parseDartAmount, parseShareCount } from './numbers.js';
import type { DartFinancialRow, DartStockRow } from './schema.js';

/**
 * DART 응답 -> 내부 표준 FinancialDataPoint
 *
 * 이 모듈은 네트워크를 타지 않는다. 순수 변환만 해서 실제 응답 픽스처로 테스트한다.
 */

/** DART 는 당기/전기/전전기를 한 응답에 함께 준다 */
export type PeriodSlot = 'thstrm' | 'frmtrm' | 'bfefrmtrm';

export const PERIOD_SLOTS: readonly PeriodSlot[] = ['thstrm', 'frmtrm', 'bfefrmtrm'];

/** 매핑 대상 지표 (주식수·주가는 다른 API 에서 온다) */
const MAPPED_METRICS = Object.keys(KIFRS_ACCOUNT_MAP) as BaseMetricId[];

function amountForSlot(row: DartFinancialRow, slot: PeriodSlot): string | undefined {
  switch (slot) {
    case 'thstrm':
      return row.thstrm_amount;
    case 'frmtrm':
      return row.frmtrm_amount;
    case 'bfefrmtrm':
      return row.bfefrmtrm_amount;
  }
}

/** 사업보고서 기준 기말일. 결산월을 받아 그 달의 말일로 만든다 */
export function annualPeriodEnd(fiscalYear: number, accountingMonth: number): string {
  const lastDay = new Date(Date.UTC(fiscalYear, accountingMonth, 0)).getUTCDate();
  return `${fiscalYear}-${String(accountingMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

export function annualPeriodStart(fiscalYear: number, accountingMonth: number): string {
  // 12월 결산이면 당해 1월 1일, 그 외에는 전년도 (결산월+1) 1일
  const startMonth = (accountingMonth % 12) + 1;
  const startYear = accountingMonth === 12 ? fiscalYear : fiscalYear - 1;
  return `${startYear}-${String(startMonth).padStart(2, '0')}-01`;
}

export interface ConvertOptions {
  companyId: string;
  /** 요청한 사업연도. 전기/전전기는 여기서 1, 2를 뺀다 */
  bsnsYear: number;
  /** 결산월 (company.json 의 acc_mt) */
  accountingMonth: number;
  consolidation: Consolidation;
  periodType: PeriodType;
  filedAt: string | null;
  /**
   * 전기/전전기까지 뽑을지.
   * 사업보고서 1회 호출로 3개년이 오므로 호출 수를 1/3로 줄일 수 있다.
   * 다만 전기/전전기 값은 그 보고서 시점의 재작성(restatement) 반영값이라
   * 원 보고서 값과 다를 수 있다. 정확도가 중요하면 false 로 두고 연도별로 호출한다.
   */
  includePriorPeriods?: boolean;
}

export interface ConvertResult {
  points: FinancialDataPoint[];
  /** 태그로 못 찾고 계정명 폴백을 쓴 지표. 신뢰도가 낮으니 기록해 둔다 */
  nameFallbacks: BaseMetricId[];
  /** 아예 못 찾은 지표 */
  missing: BaseMetricId[];
}

export function convertFinancialRows(
  rows: readonly DartFinancialRow[],
  options: ConvertOptions,
): ConvertResult {
  const slots: PeriodSlot[] =
    options.includePriorPeriods === true ? [...PERIOD_SLOTS] : ['thstrm'];

  const points: FinancialDataPoint[] = [];
  const nameFallbacks = new Set<BaseMetricId>();
  const missing = new Set<BaseMetricId>();

  for (const [slotIndex, slot] of slots.entries()) {
    const fiscalYear = options.bsnsYear - slotIndex;
    const periodEnd = annualPeriodEnd(fiscalYear, options.accountingMonth);
    const periodStart = annualPeriodStart(fiscalYear, options.accountingMonth);
    const aligned = alignPeriod(periodEnd, options.periodType);

    // 이 슬롯에 값이 하나도 없으면 해당 연도는 보고서에 없는 것이다.
    // 빈 연도를 null 행으로 채우면 "조회했는데 미공시"로 오인된다.
    const slotHasAnyValue = rows.some((r) => {
      const raw = amountForSlot(r, slot);
      return raw !== undefined && raw.trim() !== '' && raw.trim() !== '-';
    });
    if (!slotHasAnyValue) continue;

    const facts: RawFact[] = rows.map((row) => ({
      tag: row.account_id,
      name: row.account_nm,
      statement: row.sj_div,
      value: safeAmount(amountForSlot(row, slot)),
    }));

    for (const metricId of MAPPED_METRICS) {
      const resolved = resolveMetric(KIFRS_ACCOUNT_MAP, metricId, facts);

      if (resolved.usedNameFallback) nameFallbacks.add(metricId);
      if (resolved.value === null && slotIndex === 0) missing.add(metricId);

      // 재무상태표 항목은 시점 데이터라 periodStart 가 없다
      const isBalanceSheet = resolved.sourceTag !== null && isBalanceSheetMetric(metricId);

      points.push({
        companyId: options.companyId,
        metricId,
        periodType: options.periodType,
        periodStart: isBalanceSheet ? null : periodStart,
        periodEnd,
        fiscalYear,
        fiscalQuarter: null,
        alignedYear: aligned.alignedYear,
        alignedQuarter: aligned.alignedQuarter,
        value: resolved.value,
        currency: 'KRW',
        consolidation: options.consolidation,
        source: 'DART',
        sourceTag: resolved.sourceTag ?? '(미발견)',
        filedAt: options.filedAt,
      });
    }
  }

  return { points, nameFallbacks: [...nameFallbacks], missing: [...missing] };
}

const BALANCE_SHEET_METRICS: ReadonlySet<BaseMetricId> = new Set<BaseMetricId>([
  'totalAssets',
  'totalLiabilities',
  'totalEquity',
  'equityControlling',
]);

function isBalanceSheetMetric(metricId: BaseMetricId): boolean {
  return BALANCE_SHEET_METRICS.has(metricId);
}

/** 계정 하나가 이상하다고 기업 전체 수집이 멈추면 안 된다 */
function safeAmount(raw: string | undefined): number | null {
  try {
    return parseDartAmount(raw);
  } catch {
    return null;
  }
}

/**
 * 주식의 총수 현황 -> 보통주 유통주식수
 *
 * 함정 세 가지를 여기서 막는다:
 *  1. isu_stock_totqy(수권주식수)가 아니라 distb_stock_co(유통주식수)를 쓴다
 *  2. se 가 보통주/우선주/합계/비고로 나뉜다. 보통주만 집계해야 보통주 EPS 가 나온다
 *  3. distb_stock_co 가 비어 있으면 발행주식총수 - 자기주식으로 계산한다
 */
export interface ShareCounts {
  issued: number | null;
  treasury: number | null;
  /** 보통주 유통주식수 */
  outstanding: number | null;
}

export interface ShareBreakdown {
  common: ShareCounts;
  preferred: ShareCounts;
  /**
   * 보통주 + 우선주 유통주식수.
   *
   * EPS·BPS 의 분모는 이 값이다. 참가적 우선주가 이익을 나눠 갖기 때문이다.
   * 삼성전자 2023 공시 EPS(2,131원)는 지배주주순이익을 이 값으로 나눈 결과와 일치하고,
   * 보통주만으로 나누면 2,424원이 나와 13.7% 어긋난다.
   */
  totalOutstanding: number | null;
}

function extractRow(rows: readonly DartStockRow[], se: string): ShareCounts {
  const row = rows.find((r) => r.se.trim() === se);
  if (row === undefined) return { issued: null, treasury: null, outstanding: null };

  const issued = parseShareCount(row.istc_totqy);
  // '-' 는 자기주식이 없다는 뜻이다. 유통주식수 계산에서는 0으로 본다.
  const treasuryRaw = parseShareCount(row.tesstk_co);
  const treasury = treasuryRaw ?? (row.tesstk_co?.trim() === '-' ? 0 : null);

  const reported = parseShareCount(row.distb_stock_co);
  const derived = issued !== null && treasury !== null ? issued - treasury : null;

  return { issued, treasury, outstanding: reported ?? derived };
}

/**
 * 주식의 총수 현황을 보통주 / 우선주 / 합계로 나눠 뽑는다.
 *
 * `se` 는 보통주 / 우선주 / 합계 / 비고 네 종류로 온다.
 * '합계' 행을 그대로 쓰지 않고 보통주+우선주를 더하는 이유는,
 * 우선주가 없는 기업은 '우선주' 행 자체가 없거나 '-' 로 오기 때문이다.
 */
export function extractShares(rows: readonly DartStockRow[]): ShareBreakdown {
  const common = extractRow(rows, '보통주');
  const preferred = extractRow(rows, '우선주');

  const totalOutstanding =
    common.outstanding === null
      ? null
      : common.outstanding + (preferred.outstanding ?? 0);

  return { common, preferred, totalOutstanding };
}

/** 보통주만 필요할 때 (시가총액 등) */
export function extractCommonShares(rows: readonly DartStockRow[]): ShareCounts {
  return extractRow(rows, '보통주');
}

/**
 * 분기·반기 보고서에서 누적 실적을 뽑는다.
 *
 * 연간 변환(convertFinancialRows)과 달리 지표별 값 한 벌만 돌려준다 —
 * 이 값들은 그대로 차트에 올라가는 게 아니라 TTM 계산의 재료다.
 *
 * 한 응답에 당기 누적과 전기 같은 기간 누적이 함께 들어 있어서,
 * TTM 을 만드는 데 기업당 1회 호출이면 끝난다.
 */
export function extractCumulative(rows: readonly DartFinancialRow[]): {
  current: Map<BaseMetricId, number | null>;
  priorYear: Map<BaseMetricId, number | null>;
} {
  const read = (pick: (row: DartFinancialRow) => string | undefined) => {
    const facts: RawFact[] = rows.map((row) => ({
      tag: row.account_id,
      name: row.account_nm,
      statement: row.sj_div,
      value: safeAmount(pick(row)),
    }));

    const out = new Map<BaseMetricId, number | null>();
    for (const metricId of MAPPED_METRICS) {
      out.set(metricId, resolveMetric(KIFRS_ACCOUNT_MAP, metricId, facts).value);
    }
    return out;
  };

  return {
    // 재무상태표 항목에는 누적이 없다. 그때는 당기(=분기말 잔액)로 떨어진다.
    current: read((row) => row.thstrm_add_amount ?? row.thstrm_amount),
    priorYear: read((row) => row.frmtrm_add_amount ?? row.frmtrm_amount),
  };
}

export interface QuarterConvertOptions {
  companyId: string;
  fiscalYear: number;
  quarter: 1 | 2 | 3;
  accountingMonth: number;
  consolidation: Consolidation;
}

/**
 * 분기 보고서 한 건을 분기 시계열 한 점으로 바꾼다.
 *
 * thstrm_amount 를 쓴다 — 분기 보고서에서 이 값은 그 분기 3개월치다.
 * 누적(thstrm_add_amount)을 쓰면 2분기가 상반기 합이 되어 분기 흐름이 아니다.
 *
 * 재무상태표 항목은 분기말 잔액이라 그대로 쓴다.
 */
export function convertQuarterRows(
  rows: readonly DartFinancialRow[],
  options: QuarterConvertOptions,
): FinancialDataPoint[] {
  const facts: RawFact[] = rows.map((row) => ({
    tag: row.account_id,
    name: row.account_nm,
    statement: row.sj_div,
    value: safeAmount(row.thstrm_amount),
  }));

  const periodEnd = quarterEnd(options.fiscalYear, options.accountingMonth, options.quarter);
  const points: FinancialDataPoint[] = [];

  for (const metricId of MAPPED_METRICS) {
    const resolved = resolveMetric(KIFRS_ACCOUNT_MAP, metricId, facts);
    if (resolved.value === null) continue;

    points.push({
      companyId: options.companyId,
      metricId,
      periodType: 'Q',
      periodStart: null,
      periodEnd,
      fiscalYear: options.fiscalYear,
      fiscalQuarter: options.quarter,
      alignedYear: options.fiscalYear,
      alignedQuarter: options.quarter,
      value: resolved.value,
      currency: 'KRW',
      consolidation: options.consolidation,
      source: 'DART',
      sourceTag: resolved.sourceTag ?? '(미발견)',
      filedAt: null,
    });
  }

  return points;
}

/** 분기말 날짜. 결산월 기준으로 3·6·9개월 뒤 */
function quarterEnd(fiscalYear: number, accountingMonth: number, quarter: 1 | 2 | 3): string {
  const startMonth = (accountingMonth % 12) + 1;
  const raw = startMonth + quarter * 3 - 1;
  const endMonth = ((raw - 1) % 12) + 1;
  const endYear = raw > 12 ? fiscalYear + 1 : fiscalYear;
  const lastDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();
  return `${endYear}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}
