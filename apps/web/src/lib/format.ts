/**
 * 숫자 표기.
 *
 * 삼성전자 자산총계는 455,905,980,000,000원이다. 원 단위로 찍으면 자릿수를 셀 수 없다.
 * 국내 투자자에게 익숙한 조·억 단위로 축약한다.
 */

const JO = 1e12; // 조
const EOK = 1e8; // 억
const B = 1e9; // billion
const M = 1e6; // million

export const NO_DATA = '데이터 없음';

/**
 * 화면에 찍을 통화.
 *
 * 'mixed' 는 국내·미국을 원래 통화 그대로 함께 보는 경우다. 축 하나에
 * 원과 달러를 같이 놓을 수 없으므로 축약도 통화 표기도 하지 않는다.
 */
export type DisplayCurrency = 'KRW' | 'USD' | 'mixed';

/**
 * 응답의 표시 통화와 기업 구성을 실제로 찍을 통화로 바꾼다.
 *
 * native 는 "각 기업의 보고 통화 그대로"라서 그 자체로는 무엇을 찍을지 모른다.
 * 기업이 모두 한 나라면 그 나라 통화로 확정되고, 섞여 있으면 확정할 수 없다.
 */
export function resolveCurrency(
  displayCurrency: 'KRW' | 'USD' | 'native',
  countries: readonly string[],
): DisplayCurrency {
  if (displayCurrency !== 'native') return displayCurrency;

  const unique = new Set(countries);
  if (unique.size === 1) return unique.has('US') ? 'USD' : 'KRW';
  return unique.size === 0 ? 'KRW' : 'mixed';
}

/**
 * 통화 축약. 부호를 유지한다 — 영업적자를 양수처럼 보이게 하면 안 된다.
 *
 * 억 미만은 축약하지 않는다. EPS 28,732원을 "3만"으로 줄이면 정밀도가 통째로 날아간다.
 * 주당 지표는 원 단위 자릿수 자체가 정보다.
 */
export function formatCurrency(value: number | null, currency: DisplayCurrency = 'KRW'): string {
  if (value === null || !Number.isFinite(value)) return NO_DATA;

  const abs = Math.abs(value);

  if (currency === 'USD') {
    // 달러는 조·억으로 읽지 않는다. 10억 달러를 "10억"이라 쓰면 원화로 읽힌다.
    if (abs >= B) return `${(value / B).toFixed(1)}십억 달러`;
    if (abs >= M) return `${(value / M).toFixed(1)}백만 달러`;
    return `${Math.round(value).toLocaleString('en-US')}달러`;
  }

  if (currency === 'mixed') {
    // 통화가 섞였으면 축약이 거짓말이 된다. 숫자만 그대로 보여준다.
    return Math.round(value).toLocaleString('ko-KR');
  }

  if (abs >= JO) return `${(value / JO).toFixed(abs >= 100 * JO ? 0 : 1)}조`;
  if (abs >= EOK) return `${(value / EOK).toFixed(abs >= 100 * EOK ? 0 : 1)}억`;
  return Math.round(value).toLocaleString('ko-KR');
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
export function formatByUnit(
  value: number | null,
  unit: string,
  currency: DisplayCurrency = 'KRW',
): string {
  if (unit.startsWith('지수')) return formatIndex(value);
  switch (unit) {
    case '%':
      return formatPercent(value);
    case '배':
      return formatMultiple(value);
    case '주':
      return formatCount(value);
    case '통화':
      return formatCurrency(value, currency);
    default:
      return value === null ? NO_DATA : value.toLocaleString('ko-KR');
  }
}

/** Y축 눈금은 툴팁보다 더 짧아야 한다 */
export function formatAxisTick(
  value: number,
  unit: string,
  currency: DisplayCurrency = 'KRW',
): string {
  if (unit.startsWith('지수')) return value.toFixed(0);
  switch (unit) {
    case '%':
      return `${(value * 100).toFixed(0)}%`;
    case '배':
      return value.toFixed(0);
    case '통화': {
      const abs = Math.abs(value);
      // 눈금은 단위를 붙이지 않는다. 차트 좌상단 라벨이 단위를 이미 말한다.
      if (currency === 'USD') {
        if (abs >= B) return (value / B).toFixed(0);
        if (abs >= M) return (value / M).toFixed(0);
        return value.toLocaleString('en-US');
      }
      if (abs >= JO) return `${(value / JO).toFixed(0)}조`;
      if (abs >= EOK) return `${(value / EOK).toFixed(0)}억`;
      return value.toLocaleString('ko-KR');
    }
    case '주': {
      const abs = Math.abs(value);
      if (abs >= EOK) return `${(value / EOK).toFixed(0)}억`;
      return Math.round(value).toLocaleString('ko-KR');
    }
    default:
      return String(value);
  }
}

/** 차트 좌상단 라벨: "영업이익 (조 원)" 처럼 단위를 함께 보여준다 */
export function unitLabel(
  unit: string,
  values: readonly (number | null)[],
  currency: DisplayCurrency = 'KRW',
): string {
  if (unit !== '통화') return unit;

  const max = Math.max(...values.filter((v): v is number => v !== null).map(Math.abs), 0);

  if (currency === 'USD') {
    if (max >= B) return '십억 달러';
    if (max >= M) return '백만 달러';
    return '달러';
  }

  // 통화가 섞이면 축약 배수를 하나로 정할 수 없다. 무엇이 섞였는지만 밝힌다.
  if (currency === 'mixed') return '각 기업의 보고 통화';

  if (max >= JO) return '조 원';
  if (max >= EOK) return '억 원';
  return '원';
}
