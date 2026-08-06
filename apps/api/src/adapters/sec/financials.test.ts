import { describe, expect, it } from 'vitest';
import aaplRaw from '../../__fixtures__/sec-aapl-trimmed.json' with { type: 'json' };
import intcRaw from '../../__fixtures__/sec-intc-trimmed.json' with { type: 'json' };
import nvdaRaw from '../../__fixtures__/sec-nvda-trimmed.json' with { type: 'json' };
import { convertSecFacts, isForeignIssuer } from './financials.js';
import {
  SecCompanyFactsSchema,
  marketFromExchange,
  padCik,
  parseFiscalYearEndMonth,
  readConcept,
} from './schema.js';

/**
 * 픽스처는 2026-08-06 에 data.sec.gov 에서 실제로 받은 companyfacts 다.
 * 우리가 매핑하는 태그와 2014년 이후 10-K/10-Q 행만 남겨 용량을 줄였다.
 */
const aapl = SecCompanyFactsSchema.parse(aaplRaw);
const nvda = SecCompanyFactsSchema.parse(nvdaRaw);
const intc = SecCompanyFactsSchema.parse(intcRaw);

const valueOf = (
  result: ReturnType<typeof convertSecFacts>,
  metricId: string,
  year: number,
): number | null => result.points.find((p) => p.metricId === metricId && p.alignedYear === year)?.value ?? null;

const tagOf = (
  result: ReturnType<typeof convertSecFacts>,
  metricId: string,
  year: number,
): string | undefined =>
  result.points.find((p) => p.metricId === metricId && p.alignedYear === year)?.sourceTag;

describe('SEC 응답 파싱 — Apple (9월 결산)', () => {
  const result = convertSecFacts(aapl, {
    companyId: 'US:AAPL',
    fromYear: 2016,
    toYear: 2025,
    fiscalYearEndMonth: 9,
  });

  it('공시된 실제 매출과 일치한다', () => {
    // FY2024 (2023-10-01 ~ 2024-09-28) 매출 391,035백만$
    expect(valueOf(result, 'revenue', 2024)).toBe(391_035_000_000);
    // FY2021 매출 365,817백만$
    expect(valueOf(result, 'revenue', 2021)).toBe(365_817_000_000);
  });

  it('fy 필드를 믿지 않는다 — 같은 기간이 fy 2021/2022/2023 으로 세 번 실려 있다', () => {
    const concept = readConcept(aapl, 'us-gaap', 'RevenueFromContractWithCustomerExcludingAssessedTax');
    const rows = concept?.units['USD'] ?? [];
    const fy2021Period = rows.filter((r) => r.start === '2020-09-27' && r.end === '2021-09-25');

    // 원 보고서 + 이후 두 번의 비교표시. fy 를 믿으면 같은 매출이 세 연도에 찍힌다.
    expect(fy2021Period.map((r) => r.fy).sort()).toEqual([2021, 2022, 2023]);

    // 그럼에도 우리는 start/end 로 계산해 2021 하나로만 배정한다
    expect(valueOf(result, 'revenue', 2021)).toBe(365_817_000_000);
    expect(valueOf(result, 'revenue', 2023)).toBe(383_285_000_000);
  });

  it('중복 행 중 가장 먼저 제출된 보고서를 택한다', () => {
    // 같은 기간이 여러 보고서에 실린다. 원 보고서(최초 제출)를 기준으로 삼아
    // DART 쪽 "각 연도 사업보고서 공시값"과 기준을 맞춘다.
    const point = result.points.find((p) => p.metricId === 'revenue' && p.alignedYear === 2021);
    expect(point?.filedAt).toBe('2021-10-29');
  });

  it('한 연도에 매출 행이 하나만 남는다', () => {
    const revenues = result.points.filter((p) => p.metricId === 'revenue');
    const years = revenues.map((p) => p.alignedYear);
    expect(new Set(years).size).toBe(years.length);
  });

  it('9월 결산이 같은 달력 연도로 정렬된다', () => {
    const point = result.points.find((p) => p.metricId === 'revenue' && p.alignedYear === 2024);
    expect(point?.periodEnd).toBe('2024-09-28');
    expect(point?.periodStart).toBe('2023-10-01');
  });

  it('영업이익·순이익·자산을 모두 찾는다', () => {
    expect(valueOf(result, 'operatingIncome', 2024)).toBe(123_216_000_000);
    expect(valueOf(result, 'netIncome', 2024)).toBe(93_736_000_000);
    expect(valueOf(result, 'totalAssets', 2024)).toBe(364_980_000_000);
  });

  it('재무상태표 항목은 periodStart 가 없다', () => {
    const assets = result.points.find((p) => p.metricId === 'totalAssets' && p.alignedYear === 2024);
    expect(assets?.periodStart).toBeNull();
    expect(assets?.periodEnd).toBe('2024-09-28');
  });

  it('통화는 USD, 연결 기준이다', () => {
    const point = result.points.find((p) => p.metricId === 'revenue');
    expect(point?.currency).toBe('USD');
    expect(point?.consolidation).toBe('CFS');
    expect(point?.source).toBe('SEC');
  });

  it('공시 EPS 를 그대로 읽는다', () => {
    // FY2024 기본주당이익 6.11$
    expect(valueOf(result, 'eps', 2024)).toBeCloseTo(6.11, 2);
  });
});

describe('SEC 응답 파싱 — NVIDIA (1월 결산)', () => {
  const result = convertSecFacts(nvda, {
    companyId: 'US:NVDA',
    fromYear: 2016,
    toYear: 2025,
    fiscalYearEndMonth: 1,
  });

  it('1월 결산은 직전 달력 연도로 정렬된다', () => {
    // NVDA FY2022 = 2021-02-01 ~ 2022-01-30 -> 2021 년으로 간다
    const point = result.points.find((p) => p.metricId === 'revenue' && p.alignedYear === 2021);
    expect(point?.periodEnd).toBe('2022-01-30');
    expect(point?.value).toBe(26_914_000_000);
  });

  it('회계연도 라벨이 아니라 정렬 연도로 비교된다', () => {
    // NVDA 가 부르는 FY2022 의 값이 2021 자리에 온다.
    // 삼성전자 2021(1~12월)과 나란히 놓으려면 이렇게 해야 한다.
    expect(valueOf(result, 'revenue', 2021)).toBe(26_914_000_000);
    expect(valueOf(result, 'revenue', 2016)).toBe(6_910_000_000);
  });

  it('한 연도에 두 개의 회계연도가 겹치지 않는다', () => {
    const years = result.points
      .filter((p) => p.metricId === 'revenue')
      .map((p) => p.alignedYear);
    expect(new Set(years).size).toBe(years.length);
  });
});

describe('SEC 응답 파싱 — Intel (ASC 606 태그 전환)', () => {
  const result = convertSecFacts(intc, {
    companyId: 'US:INTC',
    fromYear: 2015,
    toYear: 2024,
    fiscalYearEndMonth: 12,
  });

  it('매출 시계열이 태그 전환 구간에서 끊기지 않는다', () => {
    for (const year of [2016, 2017, 2018, 2019, 2020]) {
      expect(valueOf(result, 'revenue', year)).not.toBeNull();
    }
  });

  it('연도마다 실제로 채택된 태그를 기록한다', () => {
    const tag2020 = tagOf(result, 'revenue', 2020);
    expect(tag2020).toBeDefined();
    expect(typeof tag2020).toBe('string');
  });

  it('부채총계를 찾거나 파생 계산한다', () => {
    const liabilities = valueOf(result, 'totalLiabilities', 2020);
    expect(liabilities).not.toBeNull();
    expect(liabilities).toBeGreaterThan(0);
  });
});

describe('요청 구간 밖은 내려주지 않는다', () => {
  it('fromYear~toYear 범위만 담는다', () => {
    const result = convertSecFacts(aapl, {
      companyId: 'US:AAPL',
      fromYear: 2022,
      toYear: 2023,
      fiscalYearEndMonth: 9,
    });
    const years = [...new Set(result.points.map((p) => p.alignedYear))].sort();
    expect(years).toEqual([2022, 2023]);
  });
});

describe('isForeignIssuer', () => {
  it('20-F 제출자는 ADR 로 본다', () => {
    expect(isForeignIssuer(['10-Q', '20-F', '6-K'])).toBe(true);
  });

  it('40-F(캐나다)도 제외한다', () => {
    expect(isForeignIssuer(['40-F'])).toBe(true);
  });

  it('10-K 제출자는 대상이다', () => {
    expect(isForeignIssuer(['10-K', '10-Q', '8-K'])).toBe(false);
  });

  it('목록이 없으면 대상으로 본다', () => {
    expect(isForeignIssuer(undefined)).toBe(false);
  });
});

describe('SEC 식별자 유틸', () => {
  it('CIK 를 10자리로 채운다 — URL 에 그대로 쓰인다', () => {
    expect(padCik(320193)).toBe('0000320193');
    expect(padCik('1045810')).toBe('0001045810');
    expect(padCik('CIK0000320193')).toBe('0000320193');
  });

  it('fiscalYearEnd MMDD 에서 결산월을 뽑는다', () => {
    expect(parseFiscalYearEndMonth('0930')).toBe(9);
    expect(parseFiscalYearEndMonth('1231')).toBe(12);
    expect(parseFiscalYearEndMonth('0126')).toBe(1);
  });

  it('결산월이 없거나 이상하면 12월로 본다', () => {
    expect(parseFiscalYearEndMonth(null)).toBe(12);
    expect(parseFiscalYearEndMonth('9999')).toBe(12);
  });

  it('거래소를 내부 Market 으로 바꾼다', () => {
    expect(marketFromExchange(['Nasdaq'])).toBe('NASDAQ');
    expect(marketFromExchange(['NYSE'])).toBe('NYSE');
  });

  it('NYSE·NASDAQ 이 아니면 지원 대상이 아니다', () => {
    expect(marketFromExchange(['OTC'])).toBeNull();
    expect(marketFromExchange([])).toBeNull();
    expect(marketFromExchange(undefined)).toBeNull();
  });
});
