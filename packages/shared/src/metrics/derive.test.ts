import { describe, expect, it } from 'vitest';
import type { BaseMetricId } from '../schema/financial.js';
import { deriveMetric, isDerivedMetric, requiredBaseMetrics, type FactMap } from './derive.js';
import type { Num } from './formulas.js';

const facts = (entries: Partial<Record<BaseMetricId, Num>>): FactMap =>
  new Map(Object.entries(entries) as Array<[BaseMetricId, Num]>);

/** 삼성전자 2023 실측값 */
const SAMSUNG_2023 = facts({
  revenue: 258_935_494_000_000,
  operatingIncome: 6_566_976_000_000,
  netIncome: 14_473_401_000_000,
  totalAssets: 455_905_980_000_000,
  totalLiabilities: 92_228_115_000_000,
  totalEquity: 363_677_865_000_000,
  equityControlling: 353_233_775_000_000,
  eps: 2131,
  sharesOutstanding: 5_969_782_550,
  sharesTotal: 6_792_669_250,
  closePrice: 78_600,
});

describe('deriveMetric — 삼성전자 2023 실측값', () => {
  it('영업이익률', () => {
    expect(deriveMetric('operatingMargin', SAMSUNG_2023).value).toBeCloseTo(0.02536, 5);
  });

  it('순이익률은 지배주주 기준', () => {
    expect(deriveMetric('netMargin', SAMSUNG_2023).value).toBeCloseTo(0.0559, 4);
  });

  it('부채비율', () => {
    expect(deriveMetric('debtRatio', SAMSUNG_2023).value).toBeCloseTo(0.2536, 4);
  });

  it('PER 은 공시 EPS 를 쓴다', () => {
    // 78,600 / 2,131 = 36.9배
    expect(deriveMetric('per', SAMSUNG_2023).value).toBeCloseTo(36.88, 2);
  });

  it('BPS 는 총 주식수로 나눈다', () => {
    // 353조 / 67.9억주 = 52,002원
    expect(deriveMetric('bps', SAMSUNG_2023).value).toBeCloseTo(52_002.2, 1);
  });

  it('시가총액은 보통주 기준 — 우선주는 별도 종목이다', () => {
    expect(deriveMetric('marketCap', SAMSUNG_2023).value).toBe(469_224_908_430_000);
  });
});

describe('deriveMetric — ROE', () => {
  it('기초·기말 평균 자본을 쓴다', () => {
    const prev = facts({ equityControlling: 300_000 });
    const now = facts({ netIncome: 40_000, equityControlling: 500_000 });

    // 40,000 / ((300,000 + 500,000) / 2) = 10%
    const result = deriveMetric('roe', now, prev);
    expect(result.value).toBeCloseTo(0.1, 10);
    expect(result.warnings).toEqual([]);
  });

  it('기초 자본이 없으면 기말로 폴백하고 경고를 단다', () => {
    const result = deriveMetric('roe', facts({ netIncome: 40_000, equityControlling: 400_000 }));

    expect(result.value).toBeCloseTo(0.1, 10);
    expect(result.warnings).toContain('ROE_USED_ENDING_EQUITY');
  });

  it('총 순이익이 아니라 지배주주순이익을 쓴다', () => {
    const f = facts({
      netIncome: 14_473_401_000_000,
      netIncomeTotal: 15_487_100_000_000,
      equityControlling: 353_233_775_000_000,
    });
    const result = deriveMetric('roe', f);

    // 지배주주 기준 4.10%. 총 순이익을 쓰면 4.38% 로 부풀려진다
    expect(result.value).toBeCloseTo(0.04097, 5);
    expect(result.value).not.toBeCloseTo(0.04384, 5);
  });
});

describe('deriveMetric — 결측·경계', () => {
  it('필요한 BASE 값이 없으면 null', () => {
    expect(deriveMetric('operatingMargin', facts({ revenue: 100 })).value).toBeNull();
    expect(deriveMetric('per', facts({})).value).toBeNull();
  });

  it('주가가 없으면 이유를 남긴다 — 전체가 빈 차트의 원인을 화면에서 알 수 있어야 한다', () => {
    const noPrice = facts({ eps: 2131, equityControlling: 100, sharesTotal: 10 });

    for (const metric of ['per', 'pbr', 'marketCap'] as const) {
      const result = deriveMetric(metric, noPrice);
      expect(result.value).toBeNull();
      expect(result.warnings).toContain('PRICE_UNAVAILABLE');
    }
  });

  it('주가가 있으면 PRICE_UNAVAILABLE 을 달지 않는다', () => {
    const result = deriveMetric('per', facts({ closePrice: 78_600, eps: 2131 }));
    expect(result.warnings).not.toContain('PRICE_UNAVAILABLE');
  });

  it('적자면 PER 은 null 이고 경고가 붙는다', () => {
    const result = deriveMetric('per', facts({ closePrice: 50_000, eps: -1_200 }));
    expect(result.value).toBeNull();
    expect(result.warnings).toContain('NEGATIVE_EPS');
  });

  it('공시 EPS 가 없으면 추정하고 경고를 단다', () => {
    const result = deriveMetric(
      'per',
      facts({ closePrice: 50_000, netIncome: 1_000_000, sharesTotal: 100_000 }),
    );
    // EPS 10원 추정 -> 50,000 / 10
    expect(result.value).toBeCloseTo(5_000, 6);
    expect(result.warnings).toContain('METRIC_NOT_TAGGED');
  });

  it('총 주식수가 없으면 보통주 수로 폴백한다', () => {
    const result = deriveMetric('bps', facts({ equityControlling: 1_000_000, sharesOutstanding: 100 }));
    expect(result.value).toBe(10_000);
  });

  it('자본잠식이면 PBR 은 null', () => {
    const result = deriveMetric(
      'pbr',
      facts({ closePrice: 1_000, equityControlling: -500, sharesTotal: 100 }),
    );
    expect(result.value).toBeNull();
  });
});

describe('requiredBaseMetrics', () => {
  it('파생지표의 의존 BASE 지표를 모은다', () => {
    expect(requiredBaseMetrics(['operatingMargin']).sort()).toEqual(
      ['operatingIncome', 'revenue'].sort(),
    );
  });

  it('BASE 지표는 그대로 통과시킨다', () => {
    expect(requiredBaseMetrics(['revenue'])).toEqual(['revenue']);
  });

  it('중복 없이 합친다', () => {
    const result = requiredBaseMetrics(['operatingMargin', 'netMargin']);
    expect(result.filter((m) => m === 'revenue')).toHaveLength(1);
  });
});

describe('isDerivedMetric', () => {
  it('파생지표를 구분한다', () => {
    expect(isDerivedMetric('per')).toBe(true);
    expect(isDerivedMetric('roe')).toBe(true);
    // eps 는 공시값이라 BASE 다
    expect(isDerivedMetric('eps')).toBe(false);
    expect(isDerivedMetric('revenue')).toBe(false);
  });
});
