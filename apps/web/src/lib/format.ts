/**
 * 숫자 표기.
 *
 * 삼성전자 자산총계는 455,905,980,000,000원이다. 원 단위로 찍으면 자릿수를 셀 수 없다.
 * 국내 투자자에게 익숙한 조·억 단위로 축약한다.
 */

const JO = 1e12; // 조
const EOK = 1e8; // 억
const MAN = 1e4; // 만

export const NO_DATA = '데이터 없음';

/** 통화 축약. 부호를 유지한다 — 영업적자를 양수처럼 보이게 하면 안 된다 */
export function formatCurrency(value: number | null, currency: 'KRW' | 'USD' = 'KRW'): string {
  if (value === null || !Number.isFinite(value)) return NO_DATA;

  if (currency === 'USD') {
    const abs = Math.abs(value);
    if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B$`;
    if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M$`;
    return `${value.toLocaleString('en-US')}$`;
  }

  const abs = Math.abs(value);
  if (abs >= JO) return `${(value / JO).toFixed(abs >= 100 * JO ? 0 : 1)}조`;
  if (abs >= EOK) return `${(value / EOK).toFixed(abs >= 100 * EOK ? 0 : 1)}억`;
  if (abs >= MAN) return `${(value / MAN).toFixed(0)}만`;
  return value.toLocaleString('ko-KR');
}

/** 비율은 소수로 저장되어 있다. 표시할 때 %로 바꾼다 */
export function formatPercent(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return NO_DATA;
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatMultiple(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return NO_DATA;
  return `${value.toFixed(digits)}배`;
}

export function formatCount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return NO_DATA;
  return value.toLocaleString('ko-KR');
}

export function formatIndex(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return NO_DATA;
  return value.toFixed(0);
}

/**
 * 지표 단위에 맞는 표기를 고른다.
 * 단위 문자열은 백엔드가 내려준 것을 그대로 쓴다.
 */
export function formatByUnit(value: number | null, unit: string): string {
  if (unit.startsWith('지수')) return formatIndex(value);
  switch (unit) {
    case '%':
      return formatPercent(value);
    case '배':
      return formatMultiple(value);
    case '주':
      return formatCount(value);
    case '통화':
      return formatCurrency(value);
    default:
      return value === null ? NO_DATA : value.toLocaleString('ko-KR');
  }
}

/** Y축 눈금은 툴팁보다 더 짧아야 한다 */
export function formatAxisTick(value: number, unit: string): string {
  if (unit.startsWith('지수')) return value.toFixed(0);
  switch (unit) {
    case '%':
      return `${(value * 100).toFixed(0)}%`;
    case '배':
      return value.toFixed(0);
    case '통화': {
      const abs = Math.abs(value);
      if (abs >= JO) return `${(value / JO).toFixed(0)}조`;
      if (abs >= EOK) return `${(value / EOK).toFixed(0)}억`;
      return value.toLocaleString('ko-KR');
    }
    case '주': {
      const abs = Math.abs(value);
      if (abs >= EOK) return `${(value / EOK).toFixed(0)}억`;
      if (abs >= MAN) return `${(value / MAN).toFixed(0)}만`;
      return String(value);
    }
    default:
      return String(value);
  }
}

/** 차트 좌상단 라벨: "영업이익 (조 원)" 처럼 단위를 함께 보여준다 */
export function unitLabel(unit: string, values: readonly (number | null)[]): string {
  if (unit !== '통화') return unit;

  const max = Math.max(...values.filter((v): v is number => v !== null).map(Math.abs), 0);
  if (max >= JO) return '조 원';
  if (max >= EOK) return '억 원';
  return '원';
}
