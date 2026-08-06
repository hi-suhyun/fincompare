import { describe, expect, it } from 'vitest';
import samsungFinancials from '../../__fixtures__/dart-samsung-2023-cfs.json' with { type: 'json' };
import samsungShares from '../../__fixtures__/dart-samsung-2023-shares.json' with { type: 'json' };
import {
  annualPeriodEnd,
  annualPeriodStart,
  convertFinancialRows,
  extractCommonShares,
  extractShares,
} from './financials.js';
import { DartFinancialResponseSchema, DartStockResponseSchema } from './schema.js';

/**
 * 픽스처는 2026-08-06 에 DART 에서 실제로 받은 삼성전자 2023 사업보고서 응답이다.
 * 손으로 만든 데이터로는 잡히지 않는 형식 문제(빈 문자열, 계정명 표기 차이)를 잡기 위함.
 */
const financials = DartFinancialResponseSchema.parse(samsungFinancials);
const shares = DartStockResponseSchema.parse(samsungShares);
const rows = financials.list ?? [];

const baseOptions = {
  companyId: 'KR:005930',
  bsnsYear: 2023,
  accountingMonth: 12,
  consolidation: 'CFS' as const,
  periodType: 'FY' as const,
  filedAt: '2024-03-12',
};

const valueOf = (points: ReturnType<typeof convertFinancialRows>['points'], metricId: string, year: number) =>
  points.find((p) => p.metricId === metricId && p.fiscalYear === year)?.value ?? null;

describe('실제 DART 응답 파싱 — 삼성전자 2023 연결', () => {
  it('픽스처가 정상 응답이다', () => {
    expect(financials.status).toBe('000');
    expect(rows.length).toBe(176);
  });

  it('8개 지표를 모두 찾는다 — 누락 없음', () => {
    const result = convertFinancialRows(rows, baseOptions);
    expect(result.missing).toEqual([]);
  });

  it('전부 태그로 찾는다 — 계정명 폴백 없음', () => {
    const result = convertFinancialRows(rows, baseOptions);
    expect(result.nameFallbacks).toEqual([]);
  });

  it('공시된 실제 숫자와 일치한다', () => {
    const { points } = convertFinancialRows(rows, baseOptions);

    expect(valueOf(points, 'revenue', 2023)).toBe(258_935_494_000_000);
    expect(valueOf(points, 'operatingIncome', 2023)).toBe(6_566_976_000_000);
    expect(valueOf(points, 'totalAssets', 2023)).toBe(455_905_980_000_000);
    expect(valueOf(points, 'totalLiabilities', 2023)).toBe(92_228_115_000_000);
    expect(valueOf(points, 'totalEquity', 2023)).toBe(363_677_865_000_000);
  });

  it('매출액 계정명이 "영업수익"이어도 태그로 잡는다', () => {
    // 삼성전자는 account_nm 이 '매출액'이 아니라 '영업수익'이다.
    // 계정명 매칭을 1순위로 뒀다면 놓쳤을 케이스.
    const revenue = rows.find((r) => r.account_id === 'ifrs-full_Revenue');
    expect(revenue?.account_nm).toBe('영업수익');

    const { points } = convertFinancialRows(rows, baseOptions);
    const point = points.find((p) => p.metricId === 'revenue' && p.fiscalYear === 2023);
    expect(point?.sourceTag).toBe('ifrs-full_Revenue');
  });

  it('영업이익을 "계속영업이익"과 혼동하지 않는다', () => {
    const { points } = convertFinancialRows(rows, baseOptions);
    const point = points.find((p) => p.metricId === 'operatingIncome' && p.fiscalYear === 2023);

    expect(point?.sourceTag).toBe('dart_OperatingIncomeLoss');
    // 계속영업이익(15.4조)이 아니라 영업이익(6.5조)이어야 한다
    expect(point?.value).toBe(6_566_976_000_000);
    expect(point?.value).not.toBe(15_487_100_000_000);
  });

  it('지배주주순이익과 총 순이익을 구분한다 — 삼성전자도 1조원 차이가 난다', () => {
    const { points } = convertFinancialRows(rows, baseOptions);

    const controlling = valueOf(points, 'netIncome', 2023);
    const total = valueOf(points, 'netIncomeTotal', 2023);

    expect(controlling).toBe(14_473_401_000_000);
    expect(total).toBe(15_487_100_000_000);
    expect(total! - controlling!).toBe(1_013_699_000_000); // 비지배지분 귀속분
  });

  it('재무상태표 항목은 periodStart 가 없다 — 시점 데이터', () => {
    const { points } = convertFinancialRows(rows, baseOptions);

    const assets = points.find((p) => p.metricId === 'totalAssets' && p.fiscalYear === 2023);
    const revenue = points.find((p) => p.metricId === 'revenue' && p.fiscalYear === 2023);

    expect(assets?.periodStart).toBeNull();
    expect(revenue?.periodStart).toBe('2023-01-01');
    expect(revenue?.periodEnd).toBe('2023-12-31');
  });
});

describe('전기·전전기 추출 — 호출 1회로 3개년', () => {
  it('사업보고서 하나에서 3개 연도가 나온다', () => {
    const { points } = convertFinancialRows(rows, { ...baseOptions, includePriorPeriods: true });

    const years = [...new Set(points.map((p) => p.fiscalYear))].sort();
    expect(years).toEqual([2021, 2022, 2023]);
  });

  it('전기·전전기 값이 실제 공시치와 맞는다', () => {
    const { points } = convertFinancialRows(rows, { ...baseOptions, includePriorPeriods: true });

    // 2022년 반도체 호황 -> 2023년 급락이 그대로 보인다
    expect(valueOf(points, 'operatingIncome', 2022)).toBe(43_376_630_000_000);
    expect(valueOf(points, 'operatingIncome', 2021)).toBe(51_633_856_000_000);
    expect(valueOf(points, 'revenue', 2022)).toBe(302_231_360_000_000);
  });

  it('기본값은 당기만 뽑는다', () => {
    const { points } = convertFinancialRows(rows, baseOptions);
    expect([...new Set(points.map((p) => p.fiscalYear))]).toEqual([2023]);
  });
});

describe('결산월 반영', () => {
  it('12월 결산은 당해 1월 1일 ~ 12월 31일', () => {
    expect(annualPeriodStart(2023, 12)).toBe('2023-01-01');
    expect(annualPeriodEnd(2023, 12)).toBe('2023-12-31');
  });

  it('3월 결산은 전년 4월 1일 ~ 당해 3월 31일', () => {
    expect(annualPeriodStart(2023, 3)).toBe('2022-04-01');
    expect(annualPeriodEnd(2023, 3)).toBe('2023-03-31');
  });

  it('2월 결산은 윤년 말일을 맞춘다', () => {
    expect(annualPeriodEnd(2024, 2)).toBe('2024-02-29');
    expect(annualPeriodEnd(2023, 2)).toBe('2023-02-28');
  });

  it('결산월이 12월이 아니면 alignedYear 가 보정된다', () => {
    // 3월 결산 -> periodEnd 2023-03-31 -> -3개월 -> 2022
    const { points } = convertFinancialRows(rows, { ...baseOptions, accountingMonth: 3 });
    const revenue = points.find((p) => p.metricId === 'revenue');

    expect(revenue?.fiscalYear).toBe(2023);
    expect(revenue?.alignedYear).toBe(2022);
  });
});

describe('주식의 총수 현황 — 실제 응답', () => {
  it('보통주만 집계한다 — 우선주·합계를 섞지 않는다', () => {
    const result = extractCommonShares(shares.list ?? []);

    expect(result.outstanding).toBe(5_969_782_550); // 보통주
    expect(result.outstanding).not.toBe(6_792_669_250); // 합계
    expect(result.outstanding).not.toBe(822_886_700); // 우선주
  });

  it("자기주식이 '-' 이면 0으로 본다", () => {
    const result = extractCommonShares(shares.list ?? []);
    expect(result.treasury).toBe(0);
    expect(result.issued).toBe(5_969_782_550);
  });

  it('콤마가 있는 숫자를 파싱한다', () => {
    const common = (shares.list ?? []).find((r) => r.se === '보통주');
    expect(common?.istc_totqy).toContain(','); // 원본은 '5,969,782,550'
    expect(extractCommonShares(shares.list ?? []).issued).toBe(5_969_782_550);
  });

  it('distb_stock_co 가 없으면 발행 - 자기주식으로 계산한다', () => {
    const result = extractCommonShares([
      { se: '보통주', istc_totqy: '1,000,000', tesstk_co: '50,000', distb_stock_co: '' },
    ]);
    expect(result.outstanding).toBe(950_000);
  });

  it('보통주 행이 없으면 전부 null', () => {
    expect(extractCommonShares([{ se: '우선주', istc_totqy: '100' }])).toEqual({
      issued: null,
      treasury: null,
      outstanding: null,
    });
  });
});

describe('EPS 분모 — 참가적 우선주', () => {
  it('보통주 + 우선주를 합산한다', () => {
    const result = extractShares(shares.list ?? []);

    expect(result.common.outstanding).toBe(5_969_782_550);
    expect(result.preferred.outstanding).toBe(822_886_700);
    expect(result.totalOutstanding).toBe(6_792_669_250);
  });

  it('공시 EPS 와 맞아떨어지는 분모를 준다', () => {
    // 삼성전자 2023 공시 기본주당이익 = 2,131원
    const { points } = convertFinancialRows(rows, baseOptions);
    const netIncome = valueOf(points, 'netIncome', 2023);
    const { totalOutstanding } = extractShares(shares.list ?? []);

    const computed = Math.round(netIncome! / totalOutstanding!);
    expect(computed).toBe(2131);
  });

  it('공시 EPS 를 직접 읽어온다 — 계산하지 않는다', () => {
    const { points } = convertFinancialRows(rows, { ...baseOptions, includePriorPeriods: true });

    const eps2023 = points.find((p) => p.metricId === 'eps' && p.fiscalYear === 2023);
    expect(eps2023?.value).toBe(2131);
    expect(eps2023?.sourceTag).toBe('ifrs-full_BasicEarningsLossPerShare');

    expect(valueOf(points, 'eps', 2022)).toBe(8057);
    expect(valueOf(points, 'eps', 2021)).toBe(5777);
  });

  it('우선주가 없는 기업은 보통주 수가 곧 총 주식수', () => {
    const result = extractShares([
      { se: '보통주', istc_totqy: '1,000,000', tesstk_co: '-', distb_stock_co: '1,000,000' },
      { se: '우선주', istc_totqy: '-', tesstk_co: '-', distb_stock_co: '-' },
    ]);
    expect(result.totalOutstanding).toBe(1_000_000);
  });
});

describe('빈 슬롯 처리', () => {
  it('전전기 값이 전혀 없으면 그 연도 행을 만들지 않는다', () => {
    // 분기보고서에는 bfefrmtrm 이 없다. 빈 연도를 null 행으로 채우면
    // "조회했는데 미공시"로 오인된다.
    const withoutPrior = rows.map((r) => ({
      ...r,
      frmtrm_amount: '',
      bfefrmtrm_amount: '',
    }));

    const { points } = convertFinancialRows(withoutPrior, {
      ...baseOptions,
      includePriorPeriods: true,
    });

    expect([...new Set(points.map((p) => p.fiscalYear))]).toEqual([2023]);
  });
});
