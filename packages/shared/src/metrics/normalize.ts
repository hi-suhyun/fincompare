import type { Num } from './formulas.js';

/**
 * 성장률 비교 모드 — 시작 시점 = 100 으로 정규화.
 * 규모가 다른 기업(삼성전자 vs 소형주)을 한 차트에서 비교하려면 이게 필수다.
 *
 * 기준점 규칙: 선택 구간에서 **값이 있는 첫 시점**을 100 으로 삼는다.
 * 구간 시작에 결측이 있다고 전체를 못 그리게 하면 안 되기 때문이다.
 * 대신 어느 시점을 기준으로 잡았는지 반환해서 UI 가 표시할 수 있게 한다.
 *
 * 기준값이 0 이거나 음수면 정규화하지 않는다(null 시리즈 반환).
 * 적자에서 흑자로 간 기업의 "이익 -200% 성장" 같은 숫자는 의미가 없다.
 */

export interface NormalizeResult {
  values: Num[];
  /** 100 으로 잡힌 인덱스. 정규화 불가면 null */
  baseIndex: number | null;
  baseValue: number | null;
}

export const NORMALIZE_BASE = 100;

export function normalizeToBase(series: readonly Num[]): NormalizeResult {
  const baseIndex = series.findIndex((v) => v !== null && Number.isFinite(v));

  if (baseIndex === -1) {
    return { values: series.map(() => null), baseIndex: null, baseValue: null };
  }

  const baseValue = series[baseIndex] as number;

  if (baseValue <= 0) {
    return { values: series.map(() => null), baseIndex: null, baseValue };
  }

  return {
    values: series.map((v) => (v === null || !Number.isFinite(v) ? null : (v / baseValue) * NORMALIZE_BASE)),
    baseIndex,
    baseValue,
  };
}

/**
 * 로그 스케일에 올릴 수 있는 시리즈인지.
 * 0 이하 값이 하나라도 있으면 로그축이 그 점을 그리지 못하므로 토글을 막아야 한다.
 */
export function isLogScaleSafe(series: readonly Num[]): boolean {
  return series.every((v) => v === null || (Number.isFinite(v) && v > 0));
}
