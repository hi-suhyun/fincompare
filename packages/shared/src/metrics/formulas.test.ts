import { describe, expect, it } from 'vitest';
import {
  bps,
  debtRatio,
  eps,
  marketCap,
  netMargin,
  operatingMargin,
  pbr,
  per,
  roe,
  safeAverage,
  safeDivide,
} from './formulas.js';

describe('safeDivide — 결측 전파와 0 분모 방어', () => {
  it('정상 나눗셈', () => {
    expect(safeDivide(10, 4)).toBe(2.5);
  });

  it('분자·분모 어느 쪽이 null 이어도 null', () => {
    expect(safeDivide(null, 4)).toBeNull();
    expect(safeDivide(10, null)).toBeNull();
    expect(safeDivide(null, null)).toBeNull();
  });

  it('분모 0 은 Infinity 가 아니라 null', () => {
    expect(safeDivide(10, 0)).toBeNull();
    expect(safeDivide(0, 0)).toBeNull();
  });

  it('0 을 결측으로 취급하지 않는다 — 분자 0 은 정상적으로 0', () => {
    expect(safeDivide(0, 10)).toBe(0);
  });

  it('NaN / Infinity 입력은 null 로 떨어진다', () => {
    expect(safeDivide(NaN, 10)).toBeNull();
    expect(safeDivide(Infinity, 10)).toBeNull();
  });
});

describe('safeAverage', () => {
  it('평균을 낸다', () => {
    expect(safeAverage(100, 200)).toBe(150);
  });

  it('한쪽이 null 이면 null', () => {
    expect(safeAverage(null, 200)).toBeNull();
  });
});

describe('operatingMargin / netMargin', () => {
  it('삼성전자 2023 실측 대조 (영업이익 6.57조 / 매출 258.94조 ≈ 2.54%)', () => {
    const m = operatingMargin(6_566_976_000_000, 258_935_494_000_000);
    expect(m).toBeCloseTo(0.02536, 5);
  });

  it('영업적자는 음수 그대로 유지한다 (null 로 만들지 않는다)', () => {
    expect(operatingMargin(-1000, 5000)).toBe(-0.2);
  });

  it('매출 0 이면 null', () => {
    expect(operatingMargin(1000, 0)).toBeNull();
  });

  it('영업이익 미태깅(null)이면 null', () => {
    expect(operatingMargin(null, 5000)).toBeNull();
  });

  it('netMargin 도 같은 규칙', () => {
    expect(netMargin(500, 5000)).toBe(0.1);
    expect(netMargin(500, null)).toBeNull();
  });
});

describe('roe — 지배주주 기준', () => {
  it('평균 자본으로 계산한다', () => {
    // 순이익 100, 기초자본 800, 기말자본 1200 -> 100 / 1000
    expect(roe(100, 800, 1200)).toBeCloseTo(0.1, 10);
  });

  it('기초자본이 없으면 기말자본으로 폴백한다', () => {
    expect(roe(100, null, 1000)).toBeCloseTo(0.1, 10);
  });

  it('순이익이 null 이면 null', () => {
    expect(roe(null, 800, 1200)).toBeNull();
  });

  it('기말자본까지 없으면 null', () => {
    expect(roe(100, null, null)).toBeNull();
  });

  it('자본잠식(자본 0)이면 null', () => {
    expect(roe(100, 0, 0)).toBeNull();
  });

  it('비지배지분 기준으로 계산하면 값이 달라진다 — 지배주주 기준을 써야 하는 이유', () => {
    const netIncomeControlling = 80;
    const equityControlling = 1000;
    const equityIncludingNci = 1500;

    const correct = roe(netIncomeControlling, equityControlling, equityControlling);
    const wrong = roe(netIncomeControlling, equityIncludingNci, equityIncludingNci);

    expect(correct).toBeCloseTo(0.08, 10);
    expect(wrong).toBeCloseTo(0.0533, 4);
    expect(correct).not.toBeCloseTo(wrong as number, 3);
  });
});

describe('debtRatio', () => {
  it('부채 / 자본', () => {
    expect(debtRatio(500, 1000)).toBe(0.5);
  });

  it('자본잠식이면 음수가 그대로 나온다 (숨기지 않는다)', () => {
    expect(debtRatio(500, -100)).toBe(-5);
  });

  it('자본 0 이면 null', () => {
    expect(debtRatio(500, 0)).toBeNull();
  });
});

describe('eps / bps', () => {
  it('EPS = 지배주주순이익 / 유통주식수', () => {
    expect(eps(1_000_000, 100_000)).toBe(10);
  });

  it('주식수가 없으면 null', () => {
    expect(eps(1_000_000, null)).toBeNull();
  });

  it('주식수 0 이면 null', () => {
    expect(bps(1_000_000, 0)).toBeNull();
  });
});

describe('per — 적자 처리', () => {
  it('정상 PER', () => {
    expect(per(50_000, 5_000)).toBe(10);
  });

  it('EPS 가 음수면 null — 음수 PER 은 해석 불가', () => {
    expect(per(50_000, -5_000)).toBeNull();
  });

  it('EPS 가 0 이면 null', () => {
    expect(per(50_000, 0)).toBeNull();
  });

  it('주가가 없으면 null', () => {
    expect(per(null, 5_000)).toBeNull();
  });
});

describe('pbr — 자본잠식 처리', () => {
  it('정상 PBR', () => {
    expect(pbr(50_000, 25_000)).toBe(2);
  });

  it('BPS 가 0 이하면 null', () => {
    expect(pbr(50_000, 0)).toBeNull();
    expect(pbr(50_000, -1_000)).toBeNull();
  });
});

describe('marketCap — 큰 수 정밀도', () => {
  it('삼성전자 규모(약 470조)도 정수 정밀도를 유지한다', () => {
    const value = marketCap(78_600, 5_969_782_550);
    // 2^53 (약 9.0e15) 이내라 안전
    expect(value).toBe(469_224_908_430_000);
    expect(Number.isSafeInteger(value as number)).toBe(true);
  });

  it('한쪽이 null 이면 null', () => {
    expect(marketCap(null, 100)).toBeNull();
  });
});
