import { METRIC_META, isFlowMetric, type BaseMetricId, type Currency } from '@fincompare/shared';
import type { FxTable } from '../adapters/fx/ecb.js';

/**
 * 통화 환산.
 *
 * BASE 값 단계에서 환산해야 한다. 파생지표(BPS 등)는 통화 항목과 주식수를 나눈 값이라,
 * 환산을 파생 이후에 하면 어느 쪽을 바꿔야 할지 알 수 없어진다.
 *
 * 환율 선택 규칙 (docs/01-account-mapping.md 4장):
 *   손익(flow)  -> 해당 회계기간의 평균 환율
 *   재무상태(stock)·주가 -> 기말 시점 환율
 *
 * 매출을 기말 환율로 환산하면 한 해 내내 그 환율이었던 것처럼 왜곡된다.
 */

/** 통화 단위를 가진 지표만 환산 대상이다. 비율·주식수는 통화와 무관하다 */
export function needsConversion(metricId: BaseMetricId): boolean {
  return METRIC_META[metricId].unit === '통화';
}

export interface ConversionContext {
  /** 원 통화 */
  from: Currency;
  /** 표시 통화 */
  to: Currency;
  table: FxTable;
  periodStart: string;
  periodEnd: string;
}

/**
 * 값 하나를 환산한다. 환율을 못 구하면 null —
 * 환산 못 한 값을 원 통화 그대로 섞어 내보내면 축이 뒤섞인다.
 */
export function convertValue(
  value: number | null,
  metricId: BaseMetricId,
  context: ConversionContext,
): number | null {
  if (value === null) return null;
  if (context.from === context.to) return value;
  if (!needsConversion(metricId)) return value;

  const rate = isFlowMetric(metricId)
    ? context.table.average(context.periodStart, context.periodEnd)
    : context.table.at(context.periodEnd);

  if (rate === null || rate === 0) return null;

  // FxTable 은 base=from, quote=to 로 받아온다. 즉 rate = 1 from 당 to 금액.
  return value * rate;
}

/** 회계연도의 시작·종료일. 결산월을 반영한다 */
export function fiscalPeriodBounds(
  year: number,
  fiscalYearEndMonth: number,
): { start: string; end: string } {
  const lastDay = new Date(Date.UTC(year, fiscalYearEndMonth, 0)).getUTCDate();
  const end = `${year}-${String(fiscalYearEndMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const startMonth = (fiscalYearEndMonth % 12) + 1;
  const startYear = fiscalYearEndMonth === 12 ? year : year - 1;
  const start = `${startYear}-${String(startMonth).padStart(2, '0')}-01`;

  return { start, end };
}
