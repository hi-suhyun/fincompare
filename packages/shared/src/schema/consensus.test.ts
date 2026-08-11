import { describe, expect, it } from 'vitest';
import {
  alignToYears,
  isEstimatedMetric,
  realizationRatio,
  withinBand,
  type ConsensusPoint,
} from './consensus.js';

const point = (year: number, low: number, avg: number, high: number, count = 20): ConsensusPoint => ({
  year,
  low,
  avg,
  high,
  count,
});

describe('alignToYears — 요청한 축에 맞춘다', () => {
  it('없는 해는 null 로 남긴다', () => {
    // 0 으로 채우면 "그 해 추정이 0" 으로 읽힌다
    const byYear = new Map([[2023, point(2023, 1, 1.2, 1.4)]]);

    expect(alignToYears(byYear, [2022, 2023, 2024])).toEqual([
      { year: 2022, high: null, avg: null, low: null, count: 0 },
      { year: 2023, low: 1, avg: 1.2, high: 1.4, count: 20 },
      { year: 2024, high: null, avg: null, low: null, count: 0 },
    ]);
  });

  it('요청하지 않은 해는 내지 않는다', () => {
    const byYear = new Map([[2019, point(2019, 1, 2, 3)]]);
    expect(alignToYears(byYear, [2023]).map((p) => p.year)).toEqual([2023]);
  });
});

describe('realizationRatio — 그때의 추정이 어느 쪽으로 얼마나 빗나갔나', () => {
  // 엔비디아 실측: 2022년(FY2023) 추정 EPS 0.33 vs 실제 0.18.
  // 암호화폐 폭락으로 애널리스트가 2배 가까이 높게 봤던 해다.
  const nvda2022 = point(2022, 0.257, 0.327, 0.388, 13);

  it('실제가 추정에 못 미치면 1 미만', () => {
    expect(realizationRatio(nvda2022, 0.176)).toBeCloseTo(0.538, 3);
  });

  it('실제가 추정을 넘으면 1 초과', () => {
    expect(realizationRatio(point(2025, 4.6, 4.69, 4.73), 4.93)).toBeCloseTo(1.051, 3);
  });

  it('한쪽이라도 없으면 null', () => {
    expect(realizationRatio(nvda2022, null)).toBeNull();
    expect(realizationRatio({ ...nvda2022, avg: null }, 1)).toBeNull();
  });

  it('추정이 0 이면 나누지 않는다', () => {
    expect(realizationRatio({ ...nvda2022, avg: 0 }, 1)).toBeNull();
  });
});

describe('withinBand — 실제가 추정 범위 안에 들어왔는지', () => {
  const band = point(2024, 2.93, 2.95, 2.99, 33);

  it('범위 안이면 true', () => {
    expect(withinBand(band, 2.97)).toBe(true);
  });

  it('범위를 벗어나면 false', () => {
    expect(withinBand(band, 3.5)).toBe(false);
    expect(withinBand(band, 2.0)).toBe(false);
  });

  it('경계값은 안에 있는 것으로 본다', () => {
    expect(withinBand(band, 2.93)).toBe(true);
    expect(withinBand(band, 2.99)).toBe(true);
  });

  it('범위가 없으면 판단하지 않는다', () => {
    expect(withinBand({ ...band, low: null }, 2.97)).toBeNull();
    expect(withinBand(band, null)).toBeNull();
  });
});

describe('isEstimatedMetric — 추정치를 붙일 지표만 고른다', () => {
  it('EPS·매출액만 대상이다', () => {
    expect(isEstimatedMetric('eps')).toBe(true);
    expect(isEstimatedMetric('revenue')).toBe(true);
  });

  it('나머지는 아니다', () => {
    // 추정치가 없는 지표에 밴드를 얹으려 하면 안 된다
    expect(isEstimatedMetric('per')).toBe(false);
    expect(isEstimatedMetric('closePrice')).toBe(false);
    expect(isEstimatedMetric('totalAssets')).toBe(false);
  });
});

describe('밴드는 실제값과 같은 기준 위에 놓여야 한다', () => {
  // FMP 추정치는 현재 기준(모든 분할 반영)으로 온다. 우리 실제값은
  // adjustSplits 를 껐을 때 각 시점 공시값이라 분할 이전이 배수만큼 크다.
  // 그때는 추정치를 되돌려 올려야 밴드와 실제선이 겹친다.
  it('같은 계수를 먹이면 실제/추정 비율이 보존된다', () => {
    // 엔비디아 2023년(FY2024): 조정 기준 추정 1.239 / 실제 1.205
    const adjusted = point(2023, 1.219, 1.239, 1.265, 28);
    const adjustedActual = 1.205;

    // 조정을 끄면 양쪽 다 10배 (2024년 10:1 분할)
    const factor = 10;
    const raw = {
      ...adjusted,
      low: adjusted.low! * factor,
      avg: adjusted.avg! * factor,
      high: adjusted.high! * factor,
    };
    const rawActual = adjustedActual * factor;

    expect(realizationRatio(raw, rawActual)).toBeCloseTo(
      realizationRatio(adjusted, adjustedActual)!,
      10,
    );
    expect(withinBand(raw, rawActual)).toBe(withinBand(adjusted, adjustedActual));
  });
});
