/**
 * 애널리스트 목표주가 컨센서스.
 *
 * 이건 예측이 아니라 **의견**이다. 목표주가는 애널리스트가 "이 정도가 적정하다"고
 * 밝힌 값이고, 발행 시점의 정보와 그 사람의 판단이 섞여 있다. 화면에서도 그렇게 말한다.
 *
 * 우리 차트는 연간 축이라 개별 목표가(일 단위 발행)를 그대로 얹을 수 없다.
 * 발행 연도로 묶어 그 해의 high/avg/low 를 만든다. 그러면
 * "그 해에 나온 의견의 범위" 대 "그 해 실제 종가"가 같은 x 위에 놓여,
 * 당시의 추정이 실제로 맞았는지가 눈으로 읽힌다.
 */

export interface ConsensusPoint {
  /** 회계연도 정렬 기준 연도. 주가 시계열과 같은 축을 쓴다 */
  year: number;
  /** 그 해 발행된 목표주가 중 최고 */
  high: number | null;
  /** 단순 평균. 발행 기관 가중치는 주지 않는다 — 가중치 근거가 없다 */
  avg: number | null;
  low: number | null;
  /** 그 해 집계에 들어간 목표주가 개수. 1~2건이면 avg 를 신뢰하기 어렵다 */
  count: number;
}

/** 집계를 신뢰하기 어려운 하한. 이보다 적으면 화면에서 표본 수를 함께 알린다 */
export const THIN_CONSENSUS_COUNT = 3;

/**
 * 개별 목표주가 한 건.
 *
 * priceWhenPosted 를 함께 들고 있는 이유는 "그때 맞았나"를 재려면
 * 발행 시점 주가가 필요하기 때문이다. 목표가만 있으면 그 의견이 얼마나
 * 공격적이었는지 알 수 없다.
 */
export interface AnalystTarget {
  companyId: string;
  /** 발행일 (YYYY-MM-DD) */
  publishedAt: string;
  priceTarget: number;
  /** 발행 당시 주가. 제공처가 주지 않으면 null */
  priceWhenPosted: number | null;
  analystCompany: string | null;
  currency: string;
}

/**
 * 발행 연도로 묶어 밴드를 만든다.
 *
 * 회계연도가 아니라 **발행 연도**로 묶는 게 맞다. 목표주가는 회계기간에
 * 속한 값이 아니라 그 시점의 의견이라, 결산월이 다른 기업이라고 해서
 * 의견이 밀려 나가지 않는다.
 */
export function aggregateByYear(
  targets: readonly AnalystTarget[],
  years: readonly number[],
): ConsensusPoint[] {
  const byYear = new Map<number, number[]>();

  for (const target of targets) {
    if (!Number.isFinite(target.priceTarget) || target.priceTarget <= 0) continue;
    const year = Number(target.publishedAt.slice(0, 4));
    if (!Number.isInteger(year)) continue;
    const list = byYear.get(year);
    if (list === undefined) byYear.set(year, [target.priceTarget]);
    else list.push(target.priceTarget);
  }

  return years.map((year) => {
    const values = byYear.get(year);
    if (values === undefined || values.length === 0) {
      return { year, high: null, avg: null, low: null, count: 0 };
    }
    const sum = values.reduce((acc, v) => acc + v, 0);
    return {
      year,
      high: Math.max(...values),
      avg: sum / values.length,
      low: Math.min(...values),
      count: values.length,
    };
  });
}

/**
 * 그 해 의견이 실제와 얼마나 어긋났는지.
 *
 * 평균 목표가 대비 실제 종가의 비율이다. 1 이면 정확히 맞았고,
 * 0.7 이면 실제가 목표의 70% 에 그쳤다는 뜻이다.
 *
 * 맞고 틀림을 점수로 재려는 게 아니라, 어느 쪽으로 얼마나 치우쳤는지를
 * 한 숫자로 보여주기 위한 것이다.
 */
export function realizationRatio(point: ConsensusPoint, actualClose: number | null): number | null {
  if (point.avg === null || point.avg <= 0) return null;
  if (actualClose === null || !Number.isFinite(actualClose)) return null;
  return actualClose / point.avg;
}
