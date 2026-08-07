import type { Country } from '../schema/company.js';

/**
 * 소스별 데이터 제공 하한.
 *
 * 이 값은 "우리가 정한 정책"이 아니라 **소스의 물리적 한계**다.
 *
 *   DART  2015년부터 (공식 문서에 "2015년 이후부터 정보제공" 명시)
 *   SEC   2009년 무렵부터. XBRL 제출이 2009~2011 에 걸쳐 단계적으로 의무화됐다.
 *         실측: AAPL 2007-09, NVDA 2008-01, INTC 2007-12 부터 10-K 데이터가 있다.
 *         대형사는 더 이르지만 전체를 보장할 수 있는 선은 2009 다.
 *
 * 한동안 2015 를 전 소스 공통 하한으로 쓰고 있었는데, 그건 DART 의 한계를
 * 미국 기업에까지 적용한 것이었다. "전체" 기간을 골라도 10년만 보이던 원인이다.
 */
export const EARLIEST_YEAR_BY_COUNTRY: Readonly<Record<Country, number>> = {
  KR: 2015,
  US: 2009,
};

/** 어느 소스든 이보다 앞선 데이터는 없다 */
export const ABSOLUTE_EARLIEST_YEAR = Math.min(...Object.values(EARLIEST_YEAR_BY_COUNTRY));

/**
 * 선택한 기업들을 함께 볼 때의 최대 조회 범위.
 *
 * 교집합이 아니라 **합집합**을 쓴다. 삼성전자(2015~)와 NVIDIA(2009~)를 함께 고르면
 * 2009년부터 보여주고 삼성전자 쪽은 2014년까지 선이 끊긴다.
 * 교집합으로 자르면 NVIDIA 의 긴 이력이 통째로 사라진다 — 비교 도구에서
 * 더 많은 정보를 버리는 쪽을 기본으로 삼을 이유가 없다.
 *
 * 빈 배열이면 가장 넓은 범위를 준다 (아직 기업을 안 고른 상태).
 */
export function earliestYearFor(countries: readonly Country[]): number {
  if (countries.length === 0) return ABSOLUTE_EARLIEST_YEAR;
  return Math.min(...countries.map((c) => EARLIEST_YEAR_BY_COUNTRY[c]));
}

/** 그 나라 데이터가 시작되는 해를 사람이 읽을 문구로 */
export function coverageNote(countries: readonly Country[]): string | null {
  const hasKr = countries.includes('KR');
  const hasUs = countries.includes('US');

  if (hasKr && hasUs) {
    return `국내 공시(DART)는 ${EARLIEST_YEAR_BY_COUNTRY.KR}년부터, 미국 공시(SEC)는 ${EARLIEST_YEAR_BY_COUNTRY.US}년 무렵부터 제공됩니다. 그 이전 구간은 선이 끊깁니다.`;
  }
  if (hasKr) return `국내 공시(DART)는 ${EARLIEST_YEAR_BY_COUNTRY.KR}년부터 제공됩니다.`;
  if (hasUs) return `미국 공시(SEC)는 ${EARLIEST_YEAR_BY_COUNTRY.US}년 무렵부터 제공됩니다. 기업에 따라 시작 시점이 다릅니다.`;
  return null;
}
