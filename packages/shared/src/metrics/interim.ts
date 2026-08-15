import { isFlowMetric, type BaseMetricId } from '../schema/financial.js';
import type { Num } from './formulas.js';

/**
 * 진행 중인 회계연도의 최근 실적 (TTM).
 *
 * 회계연도가 끝나기 전에는 연간 수치가 존재하지 않는다. 삼성전자를 2026년
 * 8월에 보면 FY2026 은 2027년 3월에야 공시되므로, 연간만 그리는 차트에서는
 * 최근 8개월의 실적이 통째로 보이지 않는다 — "인터넷에는 다 나오는데
 * 여기선 안 보인다" 가 여기서 나온다.
 *
 * 그래서 최근 12개월(TTM)을 한 점으로 만들어 축 끝에 붙인다.
 *
 *   TTM = 직전 연간 + 올해 누적 − 작년 같은 기간 누적
 *
 * 분기를 4번 받아 더하지 않는 이유는 호출 비용이다. DART 반기보고서 응답
 * 하나에 "당기 누적"과 "전기 같은 기간 누적"이 함께 들어 있어서, 기업당
 * 1회 호출로 끝난다. DART 는 기업×연도마다 불러야 해서 이 차이가 크다.
 */

/** 진행 중인 해의 누적 실적 한 벌 */
export interface InterimCumulative {
  /** 누적이 끝나는 분기. 1 = 1분기, 2 = 반기, 3 = 3분기 */
  throughQuarter: 1 | 2 | 3;
  /** 올해 누적 */
  current: Num;
  /** 작년 같은 기간 누적 */
  priorYear: Num;
}

/**
 * TTM 값을 만든다.
 *
 * 손익 항목만 합산이 성립한다. 자산총계 같은 시점(stock) 항목은 더하고 빼는
 * 게 말이 안 되므로 **가장 최근 누적 시점의 값**을 그대로 쓴다 —
 * 자산은 그 시점의 잔액이지 기간의 합이 아니다.
 *
 * 한 조각이라도 없으면 null 이다. 일부만 더하면 과소 집계를 진짜 값처럼
 * 보이게 만든다.
 */
export function ttmFromCumulative(
  metricId: BaseMetricId,
  priorAnnual: Num,
  interim: InterimCumulative,
): Num {
  if (!isFlowMetric(metricId)) {
    // 시점 항목: 최근 분기말 잔액이 곧 "지금 값"이다
    return interim.current;
  }

  if (priorAnnual === null || interim.current === null || interim.priorYear === null) return null;
  return priorAnnual + interim.current - interim.priorYear;
}

/** 화면에 붙일 꼬리표. 연간 확정치와 헷갈리면 안 된다 */
export function interimLabel(throughQuarter: 1 | 2 | 3): string {
  const period = throughQuarter === 1 ? '1분기' : throughQuarter === 2 ? '상반기' : '3분기';
  return `최근 12개월 (${period}까지 반영)`;
}
