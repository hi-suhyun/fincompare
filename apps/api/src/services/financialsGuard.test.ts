import { describe, expect, it, vi } from 'vitest';
import { createDb, type DbHandle } from '../db/client.js';
import { companies, financialFacts } from '../db/schema.js';
import { ensureAnnualFinancials } from './financials.js';
import type { DartClient } from '../adapters/dart/client.js';
import type { SecClient } from '../adapters/sec/client.js';

/**
 * "이미 받아둔 연도는 건너뛴다" 판정에 주가가 섞이면 안 된다.
 *
 * 주가는 거래소에서 따로 받아 같은 테이블(financial_facts)에 담긴다.
 * 이 구분이 없으면 주가만 채워진 기업이 "수집 완료"로 잡혀 공시를 아예
 * 부르지 않는다 — LG에너지솔루션이 KRX 주가 4건 때문에 재무 0건이 됐다.
 */

const LG = {
  id: 'KR:373220',
  corpCode: '01515323',
  cik: null,
  fiscalYearEndMonth: 12,
  country: 'KR',
  nameKo: 'LG에너지솔루션',
  nameEn: null,
  market: 'KOSPI',
  ticker: '373220',
  stockCode: '373220',
};

async function makeDb(): Promise<DbHandle> {
  const handle = await createDb(':memory:');
  await handle.db.insert(companies).values({
    id: LG.id,
    country: 'KR',
    market: 'KOSPI',
    nameKo: LG.nameKo,
    nameEn: null,
    corpCode: LG.corpCode,
    stockCode: LG.stockCode,
    cik: null,
    ticker: LG.ticker,
    fiscalYearEndMonth: 12,
    isAdr: false,
    isSupported: true,
    prominence: 0,
    updatedAt: new Date().toISOString(),
  });
  return handle;
}

/** 주가만 넣어 둔다. 재무데이터는 없는 상태 */
async function seedPricesOnly(handle: DbHandle, years: readonly number[]): Promise<void> {
  const now = new Date().toISOString();
  await handle.db.insert(financialFacts).values(
    years.map((year) => ({
      companyId: LG.id,
      metricId: 'closePrice',
      periodType: 'FY',
      periodStart: null,
      periodEnd: `${year}-12-30`,
      fiscalYear: year,
      fiscalQuarter: null,
      alignedYear: year,
      alignedQuarter: null,
      value: '400000',
      currency: 'KRW',
      consolidation: 'CFS',
      source: 'KRX',
      sourceTag: 'close(실거래)',
      filedAt: null,
      updatedAt: now,
    })),
  );
}

describe('주가는 재무 수집을 막지 않는다', () => {
  it('주가만 있는 연도는 여전히 공시를 부른다', async () => {
    const handle = await makeDb();
    await seedPricesOnly(handle, [2022, 2023, 2024]);

    // DART 는 call() 하나로 통한다. 아무것도 못 받은 것처럼 null 을 준다.
    const call = vi.fn(async () => null);
    const dart = { call };

    await ensureAnnualFinancials(
      { db: handle.db, dart: dart as unknown as DartClient, sec: {} as SecClient },
      LG,
      2022,
      2024,
    );

    // 주가가 있다고 건너뛰면 호출이 0 이 된다
    expect(call.mock.calls.length).toBeGreaterThan(0);
    handle.close();
  });

  it('재무데이터가 이미 있는 연도는 건너뛴다', async () => {
    const handle = await makeDb();
    const now = new Date().toISOString();
    await handle.db.insert(financialFacts).values({
      companyId: LG.id,
      metricId: 'revenue',
      periodType: 'FY',
      periodStart: null,
      periodEnd: '2023-12-31',
      fiscalYear: 2023,
      fiscalQuarter: null,
      alignedYear: 2023,
      alignedQuarter: null,
      value: '33745470000000',
      currency: 'KRW',
      consolidation: 'CFS',
      source: 'DART',
      sourceTag: 'ifrs-full_Revenue',
      filedAt: null,
      updatedAt: now,
    });

    const call = vi.fn(async () => null);
    const dart = { call };

    await ensureAnnualFinancials(
      { db: handle.db, dart: dart as unknown as DartClient, sec: {} as SecClient },
      LG,
      2023,
      2023,
    );

    // 캐시가 동작해야 DART 일일 한도를 아낀다
    expect(call.mock.calls.length).toBe(0);
    handle.close();
  });
});
