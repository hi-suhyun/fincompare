import { describe, expect, it } from 'vitest';
import {
  alignPeriod,
  alignedKey,
  buildPeriodAxis,
  fiscalYearEndBadge,
  isFiscalYearShifted,
  parseIsoDate,
  subtractDays,
  subtractMonths,
  toIsoDate,
} from './align.js';

describe('subtractMonths — 말일 보정', () => {
  it('말일에서 달을 빼면 대상 월의 말일로 잘린다', () => {
    // 보정 없이 Date 에 넘기면 2025-03-03 으로 넘어가 버린다
    expect(toIsoDate(subtractMonths(parseIsoDate('2025-03-31'), 1))).toBe('2025-02-28');
    expect(toIsoDate(subtractMonths(parseIsoDate('2024-03-31'), 1))).toBe('2024-02-29'); // 윤년
  });

  it('연도를 넘어가도 맞다', () => {
    expect(toIsoDate(subtractMonths(parseIsoDate('2022-01-30'), 3))).toBe('2021-10-30');
  });
});

describe('alignPeriod — 연간 (SEC frame 실측 대조)', () => {
  // docs/01-account-mapping.md 3.2 의 검증표와 동일한 케이스.
  // 기대값은 SEC companyfacts 의 frame 필드를 실제로 조회해서 확인한 값이다.
  const cases: Array<[string, string, number, string]> = [
    ['삼성전자 (12월 결산)', '2025-12-31', 2025, 'CY2025'],
    ['AAPL (9월 결산)', '2025-09-27', 2025, 'CY2025'],
    ['AAPL (9월 결산)', '2024-09-28', 2024, 'CY2024'],
    ['NVDA (1월 결산)', '2022-01-30', 2021, 'CY2021'],
    ['NVDA (1월 결산)', '2017-01-29', 2016, 'CY2016'],
    ['MSFT (6월 결산)', '2008-06-30', 2008, 'CY2008'],
    ['MSFT (6월 결산)', '2010-06-30', 2010, 'CY2010'],
  ];

  it.each(cases)('%s %s -> %i (SEC %s)', (_label, periodEnd, expected) => {
    expect(alignPeriod(periodEnd, 'FY')).toEqual({ alignedYear: expected, alignedQuarter: null });
  });

  it('결산월 3월 이하는 직전 연도, 4월 이상은 당해 연도로 간다', () => {
    expect(alignPeriod('2025-03-31', 'FY').alignedYear).toBe(2024);
    expect(alignPeriod('2025-04-30', 'FY').alignedYear).toBe(2025);
  });
});

describe('alignPeriod — 분기 (SEC frame 실측 대조)', () => {
  const cases: Array<[string, number, number, string]> = [
    ['2025-12-27', 2025, 4, 'CY2025Q4'],
    ['2026-03-28', 2026, 1, 'CY2026Q1'],
    ['2026-06-27', 2026, 2, 'CY2026Q2'],
    ['2025-06-28', 2025, 2, 'CY2025Q2'],
  ];

  it.each(cases)('%s -> %iQ%i (SEC %s)', (periodEnd, year, quarter) => {
    expect(alignPeriod(periodEnd, 'Q')).toEqual({ alignedYear: year, alignedQuarter: quarter });
  });

  it('12월 결산 기업의 4개 분기가 Q1~Q4 에 정확히 떨어진다', () => {
    expect(alignPeriod('2024-03-31', 'Q')).toEqual({ alignedYear: 2024, alignedQuarter: 1 });
    expect(alignPeriod('2024-06-30', 'Q')).toEqual({ alignedYear: 2024, alignedQuarter: 2 });
    expect(alignPeriod('2024-09-30', 'Q')).toEqual({ alignedYear: 2024, alignedQuarter: 3 });
    expect(alignPeriod('2024-12-31', 'Q')).toEqual({ alignedYear: 2024, alignedQuarter: 4 });
  });
});

describe('타임존 안전성', () => {
  it('UTC 로 파싱하므로 로컬 타임존이 결과를 바꾸지 않는다', () => {
    // KST(UTC+9)에서 로컬 Date 로 파싱하면 하루 밀려 연도가 바뀌는 경계
    expect(alignPeriod('2022-01-01', 'FY').alignedYear).toBe(2021);
    expect(alignPeriod('2021-12-31', 'FY').alignedYear).toBe(2021);
  });
});

describe('isFiscalYearShifted', () => {
  it('NVDA FY2022 는 2021 로 밀리므로 shifted', () => {
    expect(isFiscalYearShifted('2022-01-30', 2022, 'FY')).toBe(true);
  });

  it('12월 결산은 밀리지 않는다', () => {
    expect(isFiscalYearShifted('2024-12-31', 2024, 'FY')).toBe(false);
  });
});

describe('fiscalYearEndBadge', () => {
  it('12월 결산은 배지가 없다', () => {
    expect(fiscalYearEndBadge(12)).toBeNull();
  });

  it('그 외 결산월은 배지를 단다', () => {
    expect(fiscalYearEndBadge(9)).toBe('9월 결산');
    expect(fiscalYearEndBadge(1)).toBe('1월 결산');
  });

  it('잘못된 결산월은 던진다', () => {
    expect(() => fiscalYearEndBadge(0)).toThrow();
    expect(() => fiscalYearEndBadge(13)).toThrow();
  });
});

describe('buildPeriodAxis', () => {
  it('연간 축', () => {
    expect(buildPeriodAxis(2023, 2025, 'FY')).toEqual(['2023', '2024', '2025']);
  });

  it('분기 축은 연도당 4개', () => {
    expect(buildPeriodAxis(2024, 2024, 'Q')).toEqual(['2024Q1', '2024Q2', '2024Q3', '2024Q4']);
  });

  it('역순 범위는 던진다', () => {
    expect(() => buildPeriodAxis(2025, 2020, 'FY')).toThrow();
  });
});

describe('alignedKey', () => {
  it('연간은 연도만, 분기는 YYYYQn', () => {
    expect(alignedKey({ alignedYear: 2024, alignedQuarter: null })).toBe('2024');
    expect(alignedKey({ alignedYear: 2024, alignedQuarter: 3 })).toBe('2024Q3');
  });
});
