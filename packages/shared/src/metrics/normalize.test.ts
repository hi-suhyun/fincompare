import { describe, expect, it } from 'vitest';
import { isLogScaleSafe, normalizeToBase } from './normalize.js';

describe('normalizeToBase', () => {
  it('첫 값을 100 으로 놓고 나머지를 비율로 바꾼다', () => {
    const r = normalizeToBase([200, 240, 300]);
    expect(r.values).toEqual([100, 120, 150]);
    expect(r.baseIndex).toBe(0);
    expect(r.baseValue).toBe(200);
  });

  it('규모가 100배 다른 두 기업이 같은 성장률이면 같은 선이 된다', () => {
    const big = normalizeToBase([100_000_000, 150_000_000]);
    const small = normalizeToBase([1_000_000, 1_500_000]);
    expect(big.values).toEqual(small.values);
  });

  it('앞쪽 결측은 건너뛰고 값이 있는 첫 시점을 기준으로 잡는다', () => {
    const r = normalizeToBase([null, null, 50, 75]);
    expect(r.values).toEqual([null, null, 100, 150]);
    expect(r.baseIndex).toBe(2);
  });

  it('중간 결측은 null 로 유지한다 — 0 으로 채우지 않는다', () => {
    const r = normalizeToBase([200, null, 300]);
    expect(r.values).toEqual([100, null, 150]);
  });

  it('기준값이 0 이면 정규화하지 않는다', () => {
    const r = normalizeToBase([0, 100, 200]);
    expect(r.values).toEqual([null, null, null]);
    expect(r.baseIndex).toBeNull();
  });

  it('기준값이 음수(적자 시작)면 정규화하지 않는다 — -200% 성장은 의미 없음', () => {
    const r = normalizeToBase([-100, 50, 200]);
    expect(r.values).toEqual([null, null, null]);
    expect(r.baseIndex).toBeNull();
    expect(r.baseValue).toBe(-100);
  });

  it('전부 결측이면 전부 null', () => {
    const r = normalizeToBase([null, null]);
    expect(r.values).toEqual([null, null]);
    expect(r.baseIndex).toBeNull();
  });

  it('기준 이후 적자 전환은 음수 그대로 표현한다', () => {
    const r = normalizeToBase([100, -50]);
    expect(r.values).toEqual([100, -50]);
  });

  it('빈 배열도 터지지 않는다', () => {
    expect(normalizeToBase([])).toEqual({ values: [], baseIndex: null, baseValue: null });
  });
});

describe('isLogScaleSafe', () => {
  it('전부 양수면 안전', () => {
    expect(isLogScaleSafe([1, 10, 100])).toBe(true);
  });

  it('결측은 로그축에 문제가 되지 않는다', () => {
    expect(isLogScaleSafe([1, null, 100])).toBe(true);
  });

  it('0 이나 음수가 있으면 로그축 토글을 막아야 한다', () => {
    expect(isLogScaleSafe([1, 0, 100])).toBe(false);
    expect(isLogScaleSafe([1, -5, 100])).toBe(false);
  });
});
