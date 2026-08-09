import { describe, expect, it } from 'vitest';
import { formatAxisTick, formatByUnit, formatCurrency, resolveCurrency, unitLabel } from './format.js';

describe('formatCurrency — 억 미만은 축약하지 않는다', () => {
  it('EPS 는 원 단위 자릿수가 정보다', () => {
    // '3만' 으로 줄이면 정밀도가 통째로 날아간다
    expect(formatCurrency(28_732)).toBe('28,732');
    expect(formatCurrency(2_131)).toBe('2,131');
    expect(formatCurrency(-13_244)).toBe('-13,244');
  });

  it('억 이상은 축약한다', () => {
    expect(formatCurrency(6_566_976_000_000)).toBe('6.6조');
    expect(formatCurrency(455_905_980_000_000)).toBe('456조');
    expect(formatCurrency(9_876_543_210)).toBe('98.8억');
  });

  it('적자를 양수로 보이게 하지 않는다', () => {
    expect(formatCurrency(-11_700_000_000_000)).toBe('-11.7조');
  });

  it('달러는 달러 단위로 읽는다', () => {
    // 조·억으로 쓰면 원화로 읽힌다. NVDA 영업이익 $130.4B 를 "1304억"으로
    // 찍어 놓고 "억 원"이라 라벨을 달던 버그가 실제로 있었다.
    expect(formatCurrency(130_387_000_000, 'USD')).toBe('130.4십억 달러');
    expect(formatCurrency(391_035_000_000, 'USD')).toBe('391.0십억 달러');
    expect(formatCurrency(-11_678_000_000, 'USD')).toBe('-11.7십억 달러');
  });

  it('통화가 섞이면 축약하지 않는다', () => {
    // 원과 달러를 한 축에 놓고 "조"로 줄이면 둘 다 거짓말이 된다
    expect(formatCurrency(130_387_000_000, 'mixed')).toBe('130,387,000,000');
  });
});

describe('resolveCurrency — native 를 실제 통화로 확정한다', () => {
  it('한 나라면 그 나라 통화다', () => {
    expect(resolveCurrency('native', ['KR', 'KR'])).toBe('KRW');
    expect(resolveCurrency('native', ['US'])).toBe('USD');
  });

  it('섞이면 확정할 수 없다', () => {
    expect(resolveCurrency('native', ['KR', 'US'])).toBe('mixed');
  });

  it('명시적으로 정했으면 기업 구성과 무관하다', () => {
    expect(resolveCurrency('USD', ['KR', 'US'])).toBe('USD');
    expect(resolveCurrency('KRW', ['US'])).toBe('KRW');
  });

  it('기업이 없으면 기본값', () => {
    expect(resolveCurrency('native', [])).toBe('KRW');
  });
});

describe('unitLabel — 축 라벨이 통화를 속이지 않는다', () => {
  it('달러 값에 원 라벨을 달지 않는다', () => {
    expect(unitLabel('통화', [130_387_000_000], 'USD')).toBe('십억 달러');
    expect(unitLabel('통화', [5_000_000], 'USD')).toBe('백만 달러');
  });

  it('원화는 조·억으로 읽는다', () => {
    expect(unitLabel('통화', [455_905_980_000_000], 'KRW')).toBe('조 원');
    expect(unitLabel('통화', [9_876_543_210], 'KRW')).toBe('억 원');
  });

  it('섞이면 무엇이 섞였는지 밝힌다', () => {
    expect(unitLabel('통화', [1, 2], 'mixed')).toBe('각 기업의 보고 통화');
  });
});

describe('formatAxisTick — 눈금은 라벨의 배수를 따른다', () => {
  it('달러 눈금은 십억 단위 숫자만 찍는다', () => {
    expect(formatAxisTick(130_000_000_000, '통화', 'USD')).toBe('130');
    expect(formatAxisTick(0, '통화', 'USD')).toBe('0');
  });

  it('원화 눈금은 기존대로 조·억을 붙인다', () => {
    expect(formatAxisTick(6_000_000_000_000, '통화', 'KRW')).toBe('6조');
  });
});

describe('formatByUnit', () => {
  it('단위에 맞는 표기를 고른다', () => {
    expect(formatByUnit(0.0254, '%')).toBe('2.5%');
    expect(formatByUnit(36.88, '배')).toBe('36.9배');
    expect(formatByUnit(5_969_782_550, '주')).toBe('5,969,782,550');
    expect(formatByUnit(2_131, '통화')).toBe('2,131');
  });

  it('결측은 "데이터 없음"', () => {
    expect(formatByUnit(null, '%')).toBe('데이터 없음');
    expect(formatByUnit(null, '통화')).toBe('데이터 없음');
  });
});
