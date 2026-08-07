import { describe, expect, it } from 'vitest';
import {
  ABSOLUTE_EARLIEST_YEAR,
  EARLIEST_YEAR_BY_COUNTRY,
  coverageNote,
  earliestYearFor,
} from './coverage.js';

describe('earliestYearFor', () => {
  it('국내만 고르면 DART 하한', () => {
    expect(earliestYearFor(['KR'])).toBe(2015);
  });

  it('미국만 고르면 SEC 하한 — 2015 로 막지 않는다', () => {
    // 이 값을 2015 로 두면 "전체" 를 골라도 10년만 보인다.
    // SEC 는 AAPL 2007, NVDA 2008 부터 10-K 데이터가 있다.
    expect(earliestYearFor(['US'])).toBe(2009);
  });

  it('섞으면 더 이른 쪽을 쓴다 — 합집합', () => {
    // 교집합(2015)으로 자르면 NVIDIA 의 2009~2014 이력이 통째로 사라진다.
    // 비교 도구가 정보를 먼저 버릴 이유가 없다.
    expect(earliestYearFor(['KR', 'US'])).toBe(2009);
  });

  it('아직 아무것도 안 골랐으면 가장 넓게', () => {
    expect(earliestYearFor([])).toBe(ABSOLUTE_EARLIEST_YEAR);
    expect(ABSOLUTE_EARLIEST_YEAR).toBe(2009);
  });

  it('같은 나라를 여러 번 골라도 결과가 같다', () => {
    expect(earliestYearFor(['KR', 'KR', 'KR'])).toBe(2015);
  });
});

describe('coverageNote', () => {
  it('섞였을 때 두 하한을 다 알린다', () => {
    const note = coverageNote(['KR', 'US']);
    expect(note).toContain('2015');
    expect(note).toContain('2009');
    expect(note).toContain('끊깁니다');
  });

  it('국내만이면 DART 만 언급한다', () => {
    const note = coverageNote(['KR']);
    expect(note).toContain('DART');
    expect(note).not.toContain('SEC');
  });

  it('미국만이면 기업마다 다르다는 것을 밝힌다', () => {
    const note = coverageNote(['US']);
    expect(note).toContain('SEC');
    expect(note).toContain('기업에 따라');
  });

  it('아무것도 없으면 알릴 것도 없다', () => {
    expect(coverageNote([])).toBeNull();
  });
});

describe('EARLIEST_YEAR_BY_COUNTRY', () => {
  it('DART 하한은 공식 문서 기준 2015', () => {
    expect(EARLIEST_YEAR_BY_COUNTRY.KR).toBe(2015);
  });

  it('SEC 하한은 XBRL 의무화 시점', () => {
    expect(EARLIEST_YEAR_BY_COUNTRY.US).toBe(2009);
  });
});
