import { describe, expect, it } from 'vitest';
import { aggregateByYear, realizationRatio, type AnalystTarget } from './consensus.js';

const target = (publishedAt: string, priceTarget: number): AnalystTarget => ({
  companyId: 'US:NVDA',
  publishedAt,
  priceTarget,
  priceWhenPosted: null,
  analystCompany: null,
  currency: 'USD',
});

describe('aggregateByYear — 발행 연도로 묶는다', () => {
  it('연도별 high/avg/low 와 표본 수를 낸다', () => {
    const points = aggregateByYear(
      [target('2023-03-01', 300), target('2023-08-15', 500), target('2023-11-30', 400)],
      [2023],
    );

    expect(points[0]).toEqual({ year: 2023, high: 500, avg: 400, low: 300, count: 3 });
  });

  it('목표가가 없는 해는 null 로 남긴다', () => {
    // 0 으로 채우면 "그 해 목표가가 0원이었다"로 읽힌다
    const points = aggregateByYear([target('2023-01-01', 100)], [2022, 2023]);

    expect(points[0]).toEqual({ year: 2022, high: null, avg: null, low: null, count: 0 });
    expect(points[1]?.count).toBe(1);
  });

  it('0 이하 목표가는 집계에서 뺀다', () => {
    const points = aggregateByYear(
      [target('2023-01-01', 0), target('2023-02-01', -5), target('2023-03-01', 200)],
      [2023],
    );

    expect(points[0]).toEqual({ year: 2023, high: 200, avg: 200, low: 200, count: 1 });
  });

  it('요청하지 않은 연도는 내지 않는다', () => {
    const points = aggregateByYear([target('2019-01-01', 100)], [2023]);
    expect(points).toHaveLength(1);
    expect(points[0]?.year).toBe(2023);
  });
});

describe('realizationRatio — 그때의 의견이 어느 쪽으로 얼마나 빗나갔나', () => {
  const point = { year: 2023, high: 500, avg: 400, low: 300, count: 3 };

  it('실제가 목표에 못 미치면 1 미만', () => {
    expect(realizationRatio(point, 280)).toBeCloseTo(0.7, 5);
  });

  it('실제가 목표를 넘으면 1 초과', () => {
    expect(realizationRatio(point, 600)).toBeCloseTo(1.5, 5);
  });

  it('한쪽이라도 없으면 null', () => {
    expect(realizationRatio(point, null)).toBeNull();
    expect(realizationRatio({ ...point, avg: null }, 400)).toBeNull();
  });
});

describe('밴드는 주가와 같은 기준 위에 놓여야 한다', () => {
  // 목표주가는 발행 시점 기준 값이다. 주가만 액면분할 조정하고 목표가를 두면
  // 밴드가 주가로부터 배수만큼 떠버린다 — 엔비디아 2021년이면 10배 위에 뜬다.
  // 조정은 series 계층에서 하지만, 그 전제가 되는 성질을 여기 못박아 둔다.
  it('같은 계수로 나누면 목표가 대비 실제 비율이 보존된다', () => {
    const point = { year: 2021, high: 900, avg: 800, low: 700, count: 2 };
    const rawActual = 228.4;
    const factor = 10;

    const adjusted = { ...point, high: 90, avg: 80, low: 70 };
    const adjustedActual = rawActual / factor;

    expect(realizationRatio(adjusted, adjustedActual)).toBeCloseTo(
      realizationRatio(point, rawActual)!,
      10,
    );
  });
});
