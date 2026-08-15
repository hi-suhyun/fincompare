/**
 * 국내 기업 재무데이터 백필.
 *
 *   pnpm --filter @fincompare/api backfill:kr                (시총 상위 300개)
 *   pnpm --filter @fincompare/api backfill:kr -- --top 100
 *   pnpm --filter @fincompare/api backfill:kr -- --from 2018
 *
 * 조회 화면이 부르는 것과 같은 ensureAnnualFinancials 를 쓴다. 저장 경로가
 * 갈리면 미리 받아둔 값과 그때그때 받은 값이 달라질 수 있다.
 *
 * ⚠️ DART 는 SEC 와 달리 **기업×연도마다** 호출해야 한다. SEC 는 기업당 1회로
 *    전 기간이 오지만 DART 는 사업연도별 API 라, 300개 × 11년 = 3,300 호출이다.
 *    일일 한도(19,000)의 17% 라 한 번에 끝나지만 전체 2,596개는 1.5일 걸린다.
 *    그래서 시가총액 상위부터 채운다.
 *
 * 순위 근거는 companies.market_cap 이다. 먼저 backfill:kr-prices 를 돌려야
 * 이 값이 채워진다 — prominence 는 수기 목록이라 상위권이 100 으로 뭉쳐 있다.
 */
import { EARLIEST_YEAR_BY_COUNTRY } from '@fincompare/shared';
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { DartClient } from '../adapters/dart/client.js';
import { SecClient } from '../adapters/sec/client.js';
import { loadConfig } from '../config.js';
import { CacheLayer } from '../core/cache.js';
import { RequestQueue } from '../core/queue.js';
import { DEFAULT_LIMITS, RateLimiter } from '../core/rateLimiter.js';
import { SqliteCacheStore } from '../db/cacheStore.js';
import { createDb } from '../db/client.js';
import { companies as companiesTable, financialFacts } from '../db/schema.js';
import { ensureAnnualFinancials, loadCompanies } from '../services/financials.js';

function readFlag(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.DART_API_KEY.trim() === '') {
    console.error('DART_API_KEY 가 없습니다. .env 를 확인하세요.');
    process.exit(1);
  }

  const top = Number(readFlag('top') ?? 300);
  const fromYear = Number(readFlag('from') ?? EARLIEST_YEAR_BY_COUNTRY.KR);
  const toYear = Number(readFlag('to') ?? new Date().getFullYear() - 1);

  const handle = await createDb(config.DATABASE_URL);
  const cache = new CacheLayer(new SqliteCacheStore(handle.db));

  const dart = new DartClient({
    apiKey: config.DART_API_KEY,
    queue: new RequestQueue({
      source: 'DART',
      limiter: new RateLimiter({ ...DEFAULT_LIMITS.DART }),
      concurrency: 4,
    }),
    cache,
  });

  // 국내만 도는데도 넘겨야 한다. 실제로 불릴 일은 없다.
  const sec = new SecClient({
    userAgent: config.SEC_USER_AGENT,
    queue: new RequestQueue({
      source: 'SEC',
      limiter: new RateLimiter({ ...DEFAULT_LIMITS.SEC }),
      concurrency: 2,
    }),
    cache,
  });

  const ranked = await handle.db
    .select({ id: companiesTable.id, nameKo: companiesTable.nameKo, cap: companiesTable.marketCap })
    .from(companiesTable)
    .where(and(eq(companiesTable.country, 'KR'), isNotNull(companiesTable.marketCap)))
    // SQLite 는 text 컬럼을 문자열로 정렬한다. 숫자로 캐스팅해야 순서가 맞는다.
    .orderBy(desc(sql`CAST(${companiesTable.marketCap} AS REAL)`))
    .limit(top);

  if (ranked.length === 0) {
    console.error('시가총액이 기록된 국내 기업이 없습니다.');
    console.error('먼저 실행하세요: pnpm --filter @fincompare/api backfill:kr-prices');
    process.exit(1);
  }

  const targets = await loadCompanies(
    handle.db,
    ranked.map((r) => r.id),
  );
  // loadCompanies 는 순서를 보장하지 않는다. 시총 순으로 다시 세운다.
  const order = new Map(ranked.map((r, i) => [r.id, i]));
  targets.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  const years = toYear - fromYear + 1;
  console.log(`국내 시총 상위 ${targets.length}개, ${fromYear}~${toYear} 백필`);
  console.log(`예상 호출: 최대 ${(targets.length * years).toLocaleString()}회 (DART 일일 한도 19,000)\n`);

  const startedAt = Date.now();
  let done = 0;
  let failed = 0;
  const empty: string[] = [];

  for (const company of targets) {
    const label = company.nameKo ?? company.id;

    try {
      await ensureAnnualFinancials({ db: handle.db, dart, sec }, company, fromYear, toYear);

      const [row] = await handle.db
        .select({ n: sql<number>`count(*)` })
        .from(financialFacts)
        .where(
          and(
            eq(financialFacts.companyId, company.id),
            // 주가는 이미 채워져 있으므로 재무데이터만 센다
            sql`${financialFacts.source} = 'DART'`,
          ),
        );
      const stored = row?.n ?? 0;

      done += 1;
      if (done % 20 === 0 || stored === 0) {
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        console.log(
          `  [${String(done).padStart(3)}/${targets.length}] ${label.padEnd(14)} ${String(stored).padStart(4)}건  (${elapsed}초)`,
        );
      }
      if (stored === 0) empty.push(label);
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.log(`  [${String(done + failed).padStart(3)}/${targets.length}] ${label.padEnd(14)} 실패 — ${message}`);

      // 일일 한도를 소진했으면 더 돌아도 의미가 없다
      if (/한도|quota|020/i.test(message)) {
        console.error('\nDART 일일 한도를 소진한 것으로 보입니다. 내일 이어서 실행하세요.');
        break;
      }
    }
  }

  const seconds = Math.round((Date.now() - startedAt) / 1000);
  console.log();
  console.log(`완료: ${done}개 성공, ${failed}개 실패, ${Math.floor(seconds / 60)}분 ${seconds % 60}초`);

  if (empty.length > 0) {
    console.log();
    console.log(`값이 들어오지 않은 기업 ${empty.length}개 (지주사·금융사는 계정 체계가 다를 수 있습니다):`);
    console.log(`  ${empty.slice(0, 20).join(', ')}${empty.length > 20 ? ' …' : ''}`);
  }

  handle.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
