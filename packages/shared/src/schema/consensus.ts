import type { MetricId } from './financial.js';

/**
 * 애널리스트 컨센서스.
 *
 * 이건 예측이 아니라 **의견**이다. 발행 시점의 정보와 그 사람의 판단이
 * 섞여 있다. 화면에서도 그렇게 말한다.
 *
 * 두 가지를 다룬다:
 *
 *   추정치(estimates)  연도별 EPS·매출 추정 범위. 실제값과 같은 축 위에 놓여
 *                      "그때의 추정이 맞았는지"를 보여준다. 이게 핵심이다.
 *   목표주가(priceTarget)  현재 시점의 컨센서스 한 건. 과거 이력은 유료라
 *                      받을 수 없어서, 추이가 아니라 지금 값으로만 쓴다.
 */

/** 밴드 한 점. 값이 없는 해는 null 로 남긴다 — 0 으로 채우면 "추정이 0" 으로 읽힌다 */
export interface ConsensusPoint {
  year: number;
  high: number | null;
  avg: number | null;
  low: number | null;
  /** 그 해 추정에 참여한 애널리스트 수. 적으면 평균을 믿기 어렵다 */
  count: number;
}

/** 추정을 신뢰하기 어려운 하한. 이보다 적으면 화면에서 표본 수를 함께 알린다 */
export const THIN_CONSENSUS_COUNT = 3;

/** 추정치를 제공하는 지표. 우리가 이미 차트로 그리는 것만 다룬다 */
export const ESTIMATED_METRICS = ['eps', 'revenue'] as const;
export type EstimatedMetricId = (typeof ESTIMATED_METRICS)[number];

export function isEstimatedMetric(metricId: MetricId): metricId is EstimatedMetricId {
  return (ESTIMATED_METRICS as readonly string[]).includes(metricId);
}

/** 현재 목표주가 컨센서스. 과거 이력이 없으므로 시계열이 아니다 */
export interface PriceTargetConsensus {
  high: number | null;
  avg: number | null;
  low: number | null;
  currency: string;
}

/**
 * 그 해 추정이 실제와 얼마나 어긋났는지.
 *
 * 실제 / 추정 평균이다. 1 이면 정확히 맞았고, 0.5 면 실제가 추정의 절반에
 * 그쳤다는 뜻이다. 맞고 틀림을 점수로 재려는 게 아니라 어느 쪽으로 얼마나
 * 치우쳤는지를 한 숫자로 보여주기 위한 것이다.
 */
export function realizationRatio(point: ConsensusPoint, actual: number | null): number | null {
  if (point.avg === null || point.avg === 0) return null;
  if (actual === null || !Number.isFinite(actual)) return null;
  return actual / point.avg;
}

/** 실제값이 추정 범위 안에 들어왔는지. 범위가 없으면 판단하지 않는다 */
export function withinBand(point: ConsensusPoint, actual: number | null): boolean | null {
  if (point.low === null || point.high === null) return null;
  if (actual === null || !Number.isFinite(actual)) return null;
  return actual >= point.low && actual <= point.high;
}

/** 요청한 연도 축에 맞춰 빈 해를 채운다. 없는 해는 null 로 남는다 */
export function alignToYears(
  byYear: ReadonlyMap<number, ConsensusPoint>,
  years: readonly number[],
): ConsensusPoint[] {
  return years.map(
    (year) => byYear.get(year) ?? { year, high: null, avg: null, low: null, count: 0 },
  );
}
