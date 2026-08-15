/**
 * 국내 전 종목 주가·시가총액 백필.
 *
 *   pnpm --filter @fincompare/api backfill:kr-prices
 *   pnpm --filter @fincompare/api backfill:kr-prices -- --from 2015
 *
 * KRX 는 한 번 호출에 그 날 상장된 **모든 종목**이 온다. 종목별로 부르면
 * 2,600배를 낭비하는 셈이라, 연말 날짜만 골라 시장(KOSPI·KOSDAQ)별로 받는다.
 * 10년이면 20번 호출로 전 종목 10년치가 채워진다.
 *
 * 시가총액도 같은 응답에 들어 있다. 이걸 companies.market_cap 에 적어 두면
 * "상위 N개" 를 뽑을 실제 근거가 생긴다 — prominence 는 수기 목록이라
 * 상위권이 전부 100 으로 뭉쳐 순서가 무작위였다.
 */
import { alignPeriod } from '@fincompare/shared';
import { eq, sql } from 'drizzle-orm';
import { KrxPriceAdapter, type KrxDailyRow, type KrxMarket } from '../adapters/price/krx.js';
import { loadConfig } from '../config.js';
import { CacheLayer } from '../core/cache.js';
import { RequestQueue } from '../core/queue.js';
import { DEFAULT_LIMITS, RateLimiter } from '../core/rateLimiter.js';
import { SqliteCacheStore } from '../db/cacheStore.js';
import { createDb } from '../db/client.js';
import { companies, financialFacts, prices } from '../db/schema.js';

/** 연말 마지막 거래일은 해마다 다르다. 휴장이면 하루씩 거슬러 본다 */
const MAX_LOOKBACK_DAYS = 10;

const MARKETS: KrxMarket[] = ['KOSPI', 'KOSDAQ'];

function readFlag(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.KRX_AUTH_KEY.trim() === '') {
    console.error('KRX_AUTH_KEY 가 없습니다. .env 를 확인하세요.');
    process.exit(1);
  }

  const thisYear = new Date().getFullYear();
  const fromYear = Number(readFlag('from') ?? 2015);
  // 올해 연말은 아직 오지 않았으므로 작년까지가 기본이다
  const toYear = Number(readFlag('to') ?? thisYear - 1);

  const handle = await createDb(config.DATABASE_URL);
  const adapter = new KrxPriceAdapter({
    authKey: config.KRX_AUTH_KEY,
    queue: new RequestQueue({
      source: 'KRX',
      limiter: new RateLimiter(DEFAULT_LIMITS.KRX),
      concurrency: 2,
    }),
    cache: new CacheLayer(new SqliteCacheStore(handle.db)),
  });

  // 종목코드 -> 기업 ID. KRX 는 종목코드로만 말한다.
  const krCompanies = await handle.db
    .select({ id: companies.id, stockCode: companies.stockCode })
    .from(companies)
    .where(eq(companies.country, 'KR'));

  const idByCode = new Map<string, string>();
  for (const c of krCompanies) {
    if (c.stockCode !== null) idByCode.set(c.stockCode, c.id);
  }

  console.log(`국내 ${idByCode.size}개 종목, ${fromYear}~${toYear} 연말 주가 백필`);
  console.log(`예상 호출: ${(toYear - fromYear + 1) * MARKETS.length}회\n`);

  const startedAt = Date.now();
  const now = new Date().toISOString();
  /** 종목코드 -> 가장 최근 시가총액. 마지막 해 값이 남는다 */
  const latestCap = new Map<string, number>();
  let priceRows = 0;
  let factRows = 0;

  for (let year = fromYear; year <= toYear; year++) {
    for (const market of MARKETS) {
      // 12/31 이 휴장이면 하루씩 거슬러 실제 마지막 거래일을 찾는다
      let rows: KrxDailyRow[] = [];
      let date = `${year}-12-31`;
      for (let i = 0; i < MAX_LOOKBACK_DAYS; i++) {
        rows = await adapter.fetchMarketDay(market, date);
        if (rows.length > 0) break;
        date = shiftDays(date, -1);
      }

      if (rows.length === 0) {
        console.log(`  ${year} ${market.padEnd(6)} 거래일을 찾지 못했습니다`);
        continue;
      }

      const priceValues: Array<typeof prices.$inferInsert> = [];
      const factValues: Array<typeof financialFacts.$inferInsert> = [];

      for (const row of rows) {
        const companyId = idByCode.get(row.stockCode);
        // 우리 마스터에 없는 종목(리츠·스팩 등)은 건너뛴다
        if (companyId === undefined) continue;

        if (row.marketCap !== null) latestCap.set(companyId, row.marketCap);

        priceValues.push({
          companyId,
          date: row.date,
          close: String(row.close),
          currency: 'KRW',
          source: 'KRX',
        });

        // 차트가 읽는 곳은 financial_facts 다. prices 는 원본 보관용.
        factValues.push({
          companyId,
          metricId: 'closePrice',
          periodType: 'FY',
          periodStart: null,
          periodEnd: row.date,
          fiscalYear: year,
          fiscalQuarter: null,
          alignedYear: alignPeriod(row.date, 'FY').alignedYear,
          alignedQuarter: null,
          value: String(row.close),
          currency: 'KRW',
          consolidation: 'CFS',
          source: 'KRX',
          sourceTag: 'close(실거래)',
          filedAt: null,
          updatedAt: now,
        });
      }

      if (priceValues.length > 0) {
        await handle.db.insert(prices).values(priceValues).onConflictDoNothing();
        await handle.db.insert(financialFacts).values(factValues).onConflictDoNothing();
        priceRows += priceValues.length;
        factRows += factValues.length;
      }

      console.log(`  ${year} ${market.padEnd(6)} ${date}  ${priceValues.length}종목`);
    }
  }

  // 시가총액을 기업 마스터에 적는다. 백필 우선순위와 검색 랭킹의 근거가 된다.
  if (latestCap.size > 0) {
    for (const [companyId, cap] of latestCap) {
      await handle.db
        .update(companies)
        .set({ marketCap: String(cap) })
        .where(eq(companies.id, companyId));
    }
  }

  const seconds = Math.round((Date.now() - startedAt) / 1000);
  console.log();
  console.log(`완료: 주가 ${priceRows.toLocaleString()}건, 지표 ${factRows.toLocaleString()}건, ${seconds}초`);
  console.log(`시가총액 기록: ${latestCap.size.toLocaleString()}개 종목`);

  const [top] = await handle.db
    .select({ n: sql<number>`count(*)` })
    .from(companies)
    .where(sql`${companies.marketCap} IS NOT NULL`);
  console.log(`시가총액 보유 기업: ${top?.n ?? 0}개`);

  handle.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
