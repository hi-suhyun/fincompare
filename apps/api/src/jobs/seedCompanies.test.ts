import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../db/client.js';
import { companies, companyAliases } from '../db/schema.js';
import type { AliasRow, CompanyRow } from '../services/companySeed.js';
import { writeCompanies } from './seedCompanies.js';

/**
 * 재시딩(upsert) 검증.
 *
 * onConflictDoUpdate 의 set 절에 컬럼을 빠뜨리면 재시딩해도 그 값만 옛것으로 남는다.
 * 실제로 prominence 를 빠뜨려서 별칭은 갱신됐는데 검색 순위만 안 바뀌는 일이 있었다.
 * 조용히 틀리는 종류의 버그라 테스트로 고정한다.
 */
describe('writeCompanies — 재시딩', () => {
  let handle: ReturnType<typeof createDb>;

  const baseRow: CompanyRow = {
    id: 'KR:005930',
    country: 'KR',
    market: 'KOSPI',
    nameKo: '삼성전자',
    nameEn: 'SAMSUNG ELECTRONICS',
    corpCode: '00126380',
    stockCode: '005930',
    cik: null,
    ticker: null,
    fiscalYearEndMonth: 12,
    isAdr: false,
    isSupported: true,
    prominence: 0,
  };

  const alias = (a: string): AliasRow => ({
    companyId: 'KR:005930',
    alias: a,
    chosung: null,
    aliasType: 'KO_NAME',
  });

  beforeEach(() => {
    handle = createDb(':memory:');
  });

  afterEach(() => {
    handle.close();
  });

  const read = async () =>
    (await handle.db.select().from(companies).where(eq(companies.id, 'KR:005930')))[0];

  it('새 기업을 넣는다', async () => {
    await writeCompanies(handle.db, [baseRow], [alias('삼성전자')]);
    expect((await read())?.nameKo).toBe('삼성전자');
  });

  it('재시딩이 변경 가능한 컬럼을 모두 갱신한다', async () => {
    await writeCompanies(handle.db, [baseRow], []);

    await writeCompanies(
      handle.db,
      [
        {
          ...baseRow,
          nameKo: '삼성전자우',
          nameEn: 'SAMSUNG ELECTRONICS PREF',
          market: 'KOSDAQ',
          fiscalYearEndMonth: 3,
          prominence: 100,
        },
      ],
      [],
    );

    const row = await read();
    expect(row?.nameKo).toBe('삼성전자우');
    expect(row?.nameEn).toBe('SAMSUNG ELECTRONICS PREF');
    expect(row?.market).toBe('KOSDAQ');
    expect(row?.fiscalYearEndMonth).toBe(3);
    // 이 줄이 없어서 검색 순위가 계속 0 이었다
    expect(row?.prominence).toBe(100);
  });

  it('재시딩해도 행이 중복되지 않는다', async () => {
    await writeCompanies(handle.db, [baseRow], [alias('삼성전자')]);
    await writeCompanies(handle.db, [baseRow], [alias('삼성전자'), alias('삼전')]);

    expect(await handle.db.select().from(companies)).toHaveLength(1);
    expect(await handle.db.select().from(companyAliases)).toHaveLength(2);
  });

  it('배치 크기를 넘는 양도 처리한다', async () => {
    const many: CompanyRow[] = Array.from({ length: 450 }, (_, i) => ({
      ...baseRow,
      id: `KR:${String(i).padStart(6, '0')}`,
      stockCode: String(i).padStart(6, '0'),
    }));
    const manyAliases: AliasRow[] = many.map((c) => ({
      companyId: c.id,
      alias: c.stockCode,
      chosung: null,
      aliasType: 'TICKER',
    }));

    await writeCompanies(handle.db, many, manyAliases);

    expect(await handle.db.select().from(companies)).toHaveLength(450);
    expect(await handle.db.select().from(companyAliases)).toHaveLength(450);
  });
});
