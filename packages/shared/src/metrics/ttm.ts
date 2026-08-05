import { isFlowMetric, type BaseMetricId } from '../schema/financial.js';
import type { Num } from './formulas.js';

/**
 * TTM(최근 4개 분기)
 *
 *  - 손익 항목은 4개 분기를 합산한다
 *  - 재무상태 항목은 시점 데이터라 합산하지 않고 최근 분기 값을 그대로 쓴다
 *    (자산총계를 4번 더하면 자산이 4배가 된다)
 *  - 4개 중 하나라도 결측이면 null. 부분 합산은 과소 집계를 진짜 값처럼 보이게 만든다
 */

export const TTM_WINDOW = 4;

/** 입력은 과거 -> 최근 순서의 4개 분기 값 */
export function ttmValue(metricId: BaseMetricId, quarters: readonly Num[]): Num {
  if (quarters.length !== TTM_WINDOW) {
    throw new Error(`TTM 은 ${TTM_WINDOW}개 분기가 필요합니다 (받은 값: ${quarters.length})`);
  }

  if (!isFlowMetric(metricId)) {
    const latest = quarters[TTM_WINDOW - 1];
    return latest ?? null;
  }

  let sum = 0;
  for (const q of quarters) {
    if (q === null || !Number.isFinite(q)) return null;
    sum += q;
  }
  return Number.isFinite(sum) ? sum : null;
}

/**
 * 분기 시계열 전체를 TTM 시계열로 바꾼다.
 * 앞의 3개 구간은 창이 안 차서 null 이 된다 — 이 자리를 0 으로 채우면 안 된다.
 */
export function ttmSeries(metricId: BaseMetricId, series: readonly Num[]): Num[] {
  return series.map((_, i) =>
    i < TTM_WINDOW - 1 ? null : ttmValue(metricId, series.slice(i - TTM_WINDOW + 1, i + 1)),
  );
}
