import { describe, expect, it } from 'vitest';
import { interimLabel, ttmFromCumulative } from './interim.js';

/**
 * 삼성전자 실측 (2026-08 기준, DART).
 *   FY2025 영업이익        43.6조
 *   2026 상반기 누적      146.7조
 *   2025 상반기 누적       11.4조
 *   -> TTM                178.9조
 */
const SAMSUNG = {
  priorAnnual: 43_600_000_000_000,
  interim: {
    throughQuarter: 2 as const,
    current: 146_725_209_000_000,
    priorYear: 11_361_329_000_000,
  },
};

describe('ttmFromCumulative — 손익 항목', () => {
  it('직전 연간 + 올해 누적 - 작년 같은 기간 누적', () => {
    const ttm = ttmFromCumulative('operatingIncome', SAMSUNG.priorAnnual, SAMSUNG.interim);
    expect(ttm).toBeCloseTo(178_963_880_000_000, -9);
  });

  it('작년 같은 기간을 빼지 않으면 이중 계상된다', () => {
    // 그냥 더하면 2025 상반기가 두 번 들어간다
    const wrong = SAMSUNG.priorAnnual + SAMSUNG.interim.current;
    const right = ttmFromCumulative('operatingIncome', SAMSUNG.priorAnnual, SAMSUNG.interim)!;
    expect(wrong - right).toBeCloseTo(SAMSUNG.interim.priorYear, -6);
  });

  it('한 조각이라도 없으면 null', () => {
    // 일부만 더하면 과소 집계가 진짜 값처럼 보인다
    expect(ttmFromCumulative('operatingIncome', null, SAMSUNG.interim)).toBeNull();
    expect(
      ttmFromCumulative('operatingIncome', SAMSUNG.priorAnnual, {
        ...SAMSUNG.interim,
        current: null,
      }),
    ).toBeNull();
    expect(
      ttmFromCumulative('operatingIncome', SAMSUNG.priorAnnual, {
        ...SAMSUNG.interim,
        priorYear: null,
      }),
    ).toBeNull();
  });
});

describe('ttmFromCumulative — 시점 항목', () => {
  it('자산·자본은 합산하지 않고 최근 잔액을 쓴다', () => {
    // 자산총계를 더하고 빼면 잔액이 아니라 정체불명의 수가 된다
    const assets = ttmFromCumulative('totalAssets', 400_000_000_000_000, {
      throughQuarter: 2,
      current: 520_000_000_000_000,
      priorYear: 390_000_000_000_000,
    });
    expect(assets).toBe(520_000_000_000_000);
  });

  it('직전 연간이 없어도 최근 잔액이 있으면 값이 나온다', () => {
    const equity = ttmFromCumulative('totalEquity', null, {
      throughQuarter: 1,
      current: 300_000_000_000_000,
      priorYear: null,
    });
    expect(equity).toBe(300_000_000_000_000);
  });
});

describe('interimLabel — 연간 확정치와 구분되어야 한다', () => {
  it('어느 시점까지 반영됐는지 밝힌다', () => {
    expect(interimLabel(1)).toBe('최근 12개월 (1분기까지 반영)');
    expect(interimLabel(2)).toBe('최근 12개월 (상반기까지 반영)');
    expect(interimLabel(3)).toBe('최근 12개월 (3분기까지 반영)');
  });
});
