import type { AnalystTarget } from '@fincompare/shared';

/**
 * 목표주가 제공처.
 *
 * 주가 어댑터(PriceAdapter)와 같은 모양으로 둔다. 제공처를 갈아끼울 때
 * 서비스 계층을 건드리지 않기 위해서다.
 */
export interface ConsensusAdapter {
  /** 캐시·경고에 찍히는 이름 */
  readonly source: string;

  /**
   * 개별 목표주가를 발행일과 함께 받아온다.
   *
   * 과거 이력을 주지 못하는 제공처·요금제도 있다. 그때는 현재 컨센서스만
   * 담은 한 건을 오늘 날짜로 돌려주고 `historical: false` 로 알린다 —
   * 화면에서 "과거 비교는 불가"라고 정직하게 말할 수 있어야 한다.
   */
  fetchTargets(ticker: string): Promise<ConsensusResult>;
}

export interface ConsensusResult {
  targets: AnalystTarget[];
  /**
   * 과거 발행분까지 받았는지.
   *
   * false 면 targets 는 "지금 시점의 컨센서스" 한 건뿐이다. 그 경우
   * "그때의 추정이 맞았나"는 답할 수 없다.
   */
  historical: boolean;
  /** 과거 이력을 못 받았다면 그 이유 */
  reason?: string;
}
