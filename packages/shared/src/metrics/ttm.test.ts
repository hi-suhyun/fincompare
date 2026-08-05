import { describe, expect, it } from 'vitest';
import { ttmSeries, ttmValue } from './ttm.js';

describe('ttmValue — 손익 항목', () => {
  it('4개 분기를 합산한다', () => {
    expect(ttmValue('revenue', [100, 110, 120, 130])).toBe(460);
  });

  it('하나라도 결측이면 null — 부분 합산 금지', () => {
    // 3개만 더하면 460 이 아니라 360 이 나오고, 그게 진짜 값처럼 보인다
    expect(ttmValue('revenue', [100, null, 120, 130])).toBeNull();
    expect(ttmValue('operatingIncome', [null, null, null, null])).toBeNull();
  });

  it('적자 분기가 섞여도 정상 합산한다', () => {
    expect(ttmValue('operatingIncome', [100, -50, 30, 20])).toBe(100);
  });
});

describe('ttmValue — 재무상태 항목', () => {
  it('합산하지 않고 최근 분기 값을 쓴다', () => {
    // 자산총계를 4번 더하면 자산이 4배가 된다
    expect(ttmValue('totalAssets', [1000, 1100, 1200, 1300])).toBe(1300);
  });

  it('과거 분기가 결측이어도 최근 값이 있으면 살린다', () => {
    expect(ttmValue('totalEquity', [null, null, null, 500])).toBe(500);
  });

  it('최근 분기가 결측이면 null', () => {
    expect(ttmValue('totalAssets', [1000, 1100, 1200, null])).toBeNull();
  });

  it('주식수·주가도 시점 데이터로 취급한다', () => {
    expect(ttmValue('sharesOutstanding', [10, 10, 10, 9])).toBe(9);
    expect(ttmValue('closePrice', [100, 110, 120, 130])).toBe(130);
  });
});

describe('ttmValue — 입력 검증', () => {
  it('4개가 아니면 던진다', () => {
    expect(() => ttmValue('revenue', [100, 110, 120])).toThrow(/4개 분기/);
  });
});

describe('ttmSeries', () => {
  it('앞 3개 구간은 창이 안 차서 null 이다', () => {
    const result = ttmSeries('revenue', [100, 110, 120, 130, 140]);
    expect(result).toEqual([null, null, null, 460, 500]);
  });

  it('중간 결측은 그 결측이 창에 걸리는 4개 구간을 전부 null 로 만든다', () => {
    const result = ttmSeries('revenue', [100, null, 120, 130, 140, 150, 160]);
    expect(result).toEqual([null, null, null, null, null, 540, 580]);
  });

  it('재무상태 항목은 첫 3개 구간만 null 이고 이후는 그대로 따라간다', () => {
    expect(ttmSeries('totalAssets', [1, 2, 3, 4, 5])).toEqual([null, null, null, 4, 5]);
  });
});
