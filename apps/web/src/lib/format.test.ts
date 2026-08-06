import { describe, expect, it } from 'vitest';
import { formatByUnit, formatCurrency } from './format.js';

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

  it('달러는 B/M 으로 축약한다', () => {
    expect(formatCurrency(391_035_000_000, 'USD')).toBe('391.0B$');
    expect(formatCurrency(6.11, 'USD')).toBe('6.11$');
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
