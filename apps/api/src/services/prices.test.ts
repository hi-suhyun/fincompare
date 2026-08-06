import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PriceAdapter, PricePoint } from '../adapters/price/types.js';
import { createDb } from '../db/client.js';
import { companies, financialFacts } from '../db/schema.js';
import type { CompanyRef } from './financials.js';
import { ensureClosePrices } from './prices.js';

/** 요청받은 날짜를 그대로 돌려주는 어댑터. 어떤 날짜를 요청했는지 확인하는 게 목적 */
function fakeAdapter(
  source: PriceAdapter['source'],
  isSplitAdjusted: boolean,
  closes: Record<string, number>,
): PriceAdapter & { requested: string[] } {
  const requested: string[] = [];
  return {
    source,
    isSplitAdjusted,
    requested,
    fetchCloses(_id: string, dates: readonly string[]): Promise<PricePoint[]> {
      requested.push(...dates);
      return Promise.resolve(
        dates
          .filter((d) => closes[d] !== undefined)
          .map((d) => ({
            date: d,
            close: closes[d] as number,
            currency: source === 'TIINGO' ? ('USD' as const) : ('KRW' as const),
          })),
      );
    },
  };
}

const NVDA: CompanyRef = {
  id: 'US:NVDA',
  corpCode: null,
  cik: '0001045810',
  // 1월 결산 — 정렬 연도가 회계연도 라벨보다 1년 앞선다
  fiscalYearEndMonth: 1,
  country: 'US',
  nameKo: '엔비디아',
  nameEn: 'NVIDIA CORP',
  market: 'NASDAQ',
  ticker: 'NVDA',
  stockCode: null,
};

describe('ensureClosePrices — 정렬 연도', () => {
  let handle: ReturnType<typeof createDb>;

  beforeEach(async () => {
    handle = createDb(':memory:');
    await handle.db.insert(companies).values({
      id: NVDA.id,
      country: 'US',
      market: 'NASDAQ',
      nameKo: '엔비디아',
      nameEn: 'NVIDIA CORP',
      cik: NVDA.cik,
      ticker: 'NVDA',
      fiscalYearEndMonth: 1,
      updatedAt: '2026-08-06',
    });

    // 재무데이터가 먼저 있어야 한다. NVDA FY2024 = 2023-02 ~ 2024-01 -> 정렬 연도 2023
    await handle.db.insert(financialFacts).values([
      {
        companyId: NVDA.id,
        metricId: 'revenue',
        periodType: 'FY',
        periodStart: '2023-01-30',
        periodEnd: '2024-01-28',
        fiscalYear: 2023,
        alignedYear: 2023,
        value: '60922000000',
        currency: 'USD',
        consolidation: 'CFS',
        source: 'SEC',
        sourceTag: 'Revenues',
        updatedAt: '2026-08-06',
      },
      {
        companyId: NVDA.id,
        metricId: 'revenue',
        periodType: 'FY',
        periodStart: '2024-01-29',
        periodEnd: '2025-01-26',
        fiscalYear: 2024,
        alignedYear: 2024,
        value: '130497000000',
        currency: 'USD',
        consolidation: 'CFS',
        source: 'SEC',
        sourceTag: 'Revenues',
        updatedAt: '2026-08-06',
      },
    ]);
  });

  afterEach(() => {
    handle.close();
  });

  const storedPrices = async () =>
    (await handle.db.select().from(financialFacts)).filter((r) => r.metricId === 'closePrice');

  it('재무데이터의 기말일을 그대로 요청한다 — 결산월로 추정하지 않는다', async () => {
    const adapter = fakeAdapter('TIINGO', false, { '2024-01-28': 610.31, '2025-01-26': 142.62 });

    await ensureClosePrices(
      { db: handle.db, krPrice: null, usPrice: adapter },
      NVDA,
      2023,
      2024,
    );

    // 월말(2024-01-31)이 아니라 실제 회계연도 종료일을 쓴다.
    // 52/53주 회계연도를 쓰는 기업은 기말이 월말이 아니다.
    expect(adapter.requested.sort()).toEqual(['2024-01-28', '2025-01-26']);
  });

  it('정렬 연도가 재무데이터와 어긋나지 않는다', async () => {
    // 이 버그로 NVDA 2024 PER 이 통째로 비었다.
    // 라벨(2024)로 날짜를 만들면 2024-01-31 이 되고, 그 정렬 연도는 2023 이라
    // 2024 자리에 넣으려던 주가가 2023 에 저장되고 2024 는 영영 비었다.
    const adapter = fakeAdapter('TIINGO', false, { '2024-01-28': 610.31, '2025-01-26': 142.62 });

    await ensureClosePrices(
      { db: handle.db, krPrice: null, usPrice: adapter },
      NVDA,
      2023,
      2024,
    );

    const rows = await storedPrices();
    const byYear = new Map(rows.map((r) => [r.alignedYear, Number(r.value)]));

    expect(byYear.get(2023)).toBe(610.31);
    expect(byYear.get(2024)).toBe(142.62);
  });

  it('두 번째 호출은 네트워크를 타지 않는다', async () => {
    const deps = {
      db: handle.db,
      krPrice: null,
      usPrice: fakeAdapter('TIINGO', false, { '2024-01-28': 610.31, '2025-01-26': 142.62 }),
    };

    await ensureClosePrices(deps, NVDA, 2023, 2024);
    const before = deps.usPrice.requested.length;
    await ensureClosePrices(deps, NVDA, 2023, 2024);

    expect(deps.usPrice.requested.length).toBe(before);
  });

  it('어댑터가 없으면 이유를 알린다', async () => {
    const warnings = await ensureClosePrices(
      { db: handle.db, krPrice: null, usPrice: null },
      NVDA,
      2023,
      2024,
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.detail).toContain('TIINGO_API_KEY');
  });
});

/**
 * 소스 전환은 국내에서 실제로 일어난다 (KRX 승인 전 네이버 → 승인 후 KRX).
 * 네이버는 수정주가, KRX 는 미조정 실거래가라 섞이면 PER 이 조용히 틀린다.
 */
describe('ensureClosePrices — 소스 전환', () => {
  let handle: ReturnType<typeof createDb>;

  const SAMSUNG: CompanyRef = {
    id: 'KR:005930',
    corpCode: '00126380',
    cik: null,
    fiscalYearEndMonth: 12,
    country: 'KR',
    nameKo: '삼성전자',
    nameEn: 'SAMSUNG ELECTRONICS',
    market: 'KOSPI',
    ticker: null,
    stockCode: '005930',
  };

  beforeEach(async () => {
    handle = createDb(':memory:');
    await handle.db.insert(companies).values({
      id: SAMSUNG.id,
      country: 'KR',
      market: 'KOSPI',
      nameKo: '삼성전자',
      corpCode: SAMSUNG.corpCode,
      stockCode: SAMSUNG.stockCode,
      fiscalYearEndMonth: 12,
      updatedAt: '2026-08-06',
    });
    await handle.db.insert(financialFacts).values({
      companyId: SAMSUNG.id,
      metricId: 'revenue',
      periodType: 'FY',
      periodStart: '2017-01-01',
      periodEnd: '2017-12-31',
      fiscalYear: 2017,
      alignedYear: 2017,
      value: '239575376000000',
      currency: 'KRW',
      consolidation: 'CFS',
      source: 'DART',
      sourceTag: 'ifrs_Revenue',
      updatedAt: '2026-08-06',
    });
  });

  afterEach(() => {
    handle.close();
  });

  it('소스가 바뀌면 다시 받는다', async () => {
    // 네이버 수정주가
    const naver = fakeAdapter('NAVER', true, { '2017-12-31': 50_960 });
    await ensureClosePrices({ db: handle.db, krPrice: naver, usPrice: null }, SAMSUNG, 2017, 2017);

    // KRX 미조정 실거래가 — 같은 날짜인데 값이 50배 다르다
    const krx = fakeAdapter('KRX', false, { '2017-12-31': 2_548_000 });
    await ensureClosePrices({ db: handle.db, krPrice: krx, usPrice: null }, SAMSUNG, 2017, 2017);

    expect(krx.requested).toEqual(['2017-12-31']);

    const rows = (await handle.db.select().from(financialFacts)).filter(
      (r) => r.metricId === 'closePrice',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.source).toBe('KRX');
    expect(Number(rows[0]?.value)).toBe(2_548_000);
  });

  it('같은 소스면 재사용한다', async () => {
    const deps = {
      db: handle.db,
      krPrice: fakeAdapter('KRX', false, { '2017-12-31': 2_548_000 }),
      usPrice: null,
    };

    await ensureClosePrices(deps, SAMSUNG, 2017, 2017);
    await ensureClosePrices(deps, SAMSUNG, 2017, 2017);

    expect(deps.krPrice.requested).toEqual(['2017-12-31']);
  });

  it('수정주가 소스인지 노출한다 — EPS 조정 여부를 결정하는 값이다', () => {
    expect(fakeAdapter('NAVER', true, {}).isSplitAdjusted).toBe(true);
    expect(fakeAdapter('KRX', false, {}).isSplitAdjusted).toBe(false);
  });
});
