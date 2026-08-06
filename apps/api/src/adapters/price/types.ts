import type { Currency } from '@fincompare/shared';

/**
 * 주가 어댑터 공통 인터페이스.
 *
 * 시장을 추가하려면 구현체만 늘리면 된다.
 * 라이선스 사정으로 소스를 갈아끼울 일이 실제로 생기므로(docs/00-data-sources.md 3.4)
 * 이 경계를 지키는 게 중요하다.
 */

export interface PricePoint {
  /** ISO date */
  date: string;
  close: number;
  currency: Currency;
}

export interface PriceAdapter {
  readonly source: 'KRX' | 'NAVER' | 'TIINGO';
  /**
   * 수정주가(액면분할 소급 조정) 여부.
   *
   * 이게 왜 인터페이스에 있냐면, 수정주가를 미조정 EPS 와 나누면 PER 이 조용히 틀리기 때문이다.
   * 삼성전자 2017: 수정주가 50,960 / 공시 EPS 299,868 = 0.17배 (실제 약 8.5배).
   * 호출부가 조정 여부를 알아야 EPS 쪽 기준을 맞출 수 있다.
   */
  readonly isSplitAdjusted: boolean;

  /**
   * 지정한 날짜들의 종가를 가져온다.
   *
   * 정확히 그날 거래가 없으면(휴장) 직전 거래일 종가를 쓴다.
   * 뒤 날짜를 끌어오면 아직 형성되지 않은 가격을 쓰는 셈이다.
   */
  fetchCloses(identifier: string, dates: readonly string[]): Promise<PricePoint[]>;
}

/**
 * 일별 시계열에서 지정한 날짜의 값을 고른다.
 * 그날이 없으면 직전 거래일로 거슬러 올라간다.
 */
export function pickCloses(
  series: readonly PricePoint[],
  dates: readonly string[],
): PricePoint[] {
  const sorted = [...series].sort((a, b) => (a.date < b.date ? -1 : 1));
  const out: PricePoint[] = [];

  for (const target of dates) {
    let best: PricePoint | null = null;
    for (const point of sorted) {
      if (point.date > target) break;
      best = point;
    }
    // 구간 시작 이전이면 값이 없다. 앞으로 당겨오지 않는다.
    if (best !== null) out.push({ ...best, date: target });
  }

  return out;
}
