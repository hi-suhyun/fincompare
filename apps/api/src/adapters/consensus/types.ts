import type { EstimatedMetricId, PriceTargetConsensus } from '@fincompare/shared';

/**
 * 컨센서스 제공처.
 *
 * 주가 어댑터(PriceAdapter)와 같은 모양으로 둔다. 제공처를 갈아끼울 때
 * 서비스 계층을 건드리지 않기 위해서다.
 */
export interface ConsensusAdapter {
  /** 캐시·경고에 찍히는 이름 */
  readonly source: string;

  fetchConsensus(ticker: string): Promise<ConsensusResult>;
}

/** 회계기간 하나에 대한 추정치 */
export interface EstimateRow {
  /**
   * 회계기간 종료일 (YYYY-MM-DD).
   *
   * 연도가 아니라 종료일을 그대로 들고 온다. 결산월이 다른 기업을 실제값과
   * 같은 해에 놓으려면 우리 정렬 규칙(alignPeriod)을 태워야 하는데,
   * 그러려면 종료일이 필요하다.
   */
  periodEnd: string;
  metricId: EstimatedMetricId;
  low: number | null;
  avg: number | null;
  high: number | null;
  /** 추정에 참여한 애널리스트 수 */
  count: number;
}

export interface ConsensusResult {
  /** 연도별 추정치. 이게 "그때의 추정이 맞았나"를 답한다 */
  estimates: EstimateRow[];
  /**
   * 현재 목표주가 컨센서스.
   *
   * 과거 발행분은 유료 구간이라 받을 수 없다. 그래서 시계열이 아니라
   * "지금 값" 하나다 — 화면에서도 추이가 아니라 현재 수준으로만 쓴다.
   */
  priceTarget: PriceTargetConsensus | null;
  /** 목표주가 과거 이력을 받을 수 없는 이유. 화면에 그대로 보여준다 */
  priceTargetNote?: string;
}
