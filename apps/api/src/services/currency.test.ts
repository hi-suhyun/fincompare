import { describe, expect, it } from 'vitest';
import { FxTable } from '../adapters/fx/ecb.js';
import { convertValue, fiscalPeriodBounds, needsConversion } from './currency.js';

/** 2024년 USD/KRW. 연초 1300 -> 연말 1400 으로 오른 상황 */
const TABLE = new FxTable([
  { date: '2024-01-02', rate: 1300 },
  { date: '2024-06-28', rate: 1350 },
  { date: '2024-12-31', rate: 1400 },
]);

const ctx = {
  from: 'USD' as const,
  to: 'KRW' as const,
  table: TABLE,
  periodStart: '2024-01-01',
  periodEnd: '2024-12-31',
};

describe('needsConversion', () => {
  it('통화 지표만 환산 대상이다', () => {
    expect(needsConversion('revenue')).toBe(true);
    expect(needsConversion('totalAssets')).toBe(true);
    expect(needsConversion('eps')).toBe(true);
  });

  it('주식수는 통화와 무관하다', () => {
    expect(needsConversion('sharesOutstanding')).toBe(false);
    expect(needsConversion('sharesTotal')).toBe(false);
  });
});

describe('convertValue — 환율 선택', () => {
  it('손익은 기간 평균 환율을 쓴다', () => {
    // (1300 + 1350 + 1400) / 3 = 1350
    expect(convertValue(100, 'revenue', ctx)).toBe(135_000);
  });

  it('재무상태는 기말 환율을 쓴다', () => {
    expect(convertValue(100, 'totalAssets', ctx)).toBe(140_000);
  });

  it('매출과 자산에 다른 환율이 적용된다 — 이게 규칙의 요점이다', () => {
    expect(convertValue(100, 'revenue', ctx)).not.toBe(convertValue(100, 'totalAssets', ctx));
  });

  it('주가는 기말 환율을 쓴다', () => {
    expect(convertValue(100, 'closePrice', ctx)).toBe(140_000);
  });

  it('EPS 는 손익이므로 평균 환율을 쓴다', () => {
    expect(convertValue(10, 'eps', ctx)).toBe(13_500);
  });
});

describe('convertValue — 환산하지 않는 경우', () => {
  it('같은 통화면 그대로 둔다', () => {
    expect(convertValue(100, 'revenue', { ...ctx, from: 'KRW', to: 'KRW' })).toBe(100);
  });

  it('주식수는 환산하지 않는다', () => {
    expect(convertValue(1_000_000, 'sharesOutstanding', ctx)).toBe(1_000_000);
  });

  it('결측은 결측 그대로', () => {
    expect(convertValue(null, 'revenue', ctx)).toBeNull();
  });

  it('환율을 못 구하면 null — 원 통화 값을 섞어 내보내지 않는다', () => {
    const empty = { ...ctx, table: new FxTable([]) };
    expect(convertValue(100, 'revenue', empty)).toBeNull();
  });

  it('구간 이전 시점이라 환율이 없어도 null', () => {
    const before = { ...ctx, periodStart: '2020-01-01', periodEnd: '2020-12-31' };
    expect(convertValue(100, 'totalAssets', before)).toBeNull();
  });
});

describe('fiscalPeriodBounds', () => {
  it('12월 결산', () => {
    expect(fiscalPeriodBounds(2024, 12)).toEqual({ start: '2024-01-01', end: '2024-12-31' });
  });

  it('9월 결산 (Apple)', () => {
    expect(fiscalPeriodBounds(2024, 9)).toEqual({ start: '2023-10-01', end: '2024-09-30' });
  });

  it('1월 결산 (NVIDIA)', () => {
    expect(fiscalPeriodBounds(2024, 1)).toEqual({ start: '2023-02-01', end: '2024-01-31' });
  });

  it('2월 결산은 윤년 말일을 맞춘다', () => {
    expect(fiscalPeriodBounds(2024, 2).end).toBe('2024-02-29');
  });
});
