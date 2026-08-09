/**
 * 미국 기업 재무데이터 미리 받아두기.
 *
 *   pnpm --filter @fincompare/api backfill:us
 *   pnpm --filter @fincompare/api backfill:us -- --from 2010
 *   pnpm --filter @fincompare/api backfill:us -- --force   (이미 있어도 다시)
 *
 * 조회 화면이 부르는 것과 같은 ensureAnnualFinancials 를 쓴다. 저장 경로가
 * 갈리면 미리 받아둔 값과 그때그때 받은 값이 달라질 수 있다.
 *
 * SEC companyfacts 는 한 번 받으면 전 기간이 들어 있어서 기업당 1회 호출이면
 * 끝난다. 64개 기준으로 몇 분이면 된다.
 */
import { SecClient } from '../adapters/sec/client.js';
import { DartClient } from '../adapters/dart/client.js';
import { loadConfig } from '../config.js';
import { CacheLayer } from '../core/cache.js';
import { RequestQueue } from '../core/queue.js';
import { DEFAULT_LIMITS, RateLimiter } from '../core/rateLimiter.js';
import { SqliteCacheStore } from '../db/cacheStore.js';
import { createDb } from '../db/client.js';
import { companies as companiesTable, financialFacts } from '../db/schema.js';
import { ensureAnnualFinancials, loadCompanies } from '../services/financials.js';
import { EARLIEST_YEAR_BY_COUNTRY } from '@fincompare/shared';
import { eq, sql } from 'drizzle-orm';

function readFlag(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.SEC_USER_AGENT.trim() === '') {
    console.error('SEC_USER_AGENT 가 없습니다. SEC 는 이 헤더 없이 호출하면 403 을 돌려줍니다.');
    process.exit(1);
  }

  const force = process.argv.includes('--force');
  const fromYear = Number(readFlag('from') ?? EARLIEST_YEAR_BY_COUNTRY.US);
  const toYear = Number(readFlag('to') ?? new Date().getFullYear());

  const handle = await createDb(config.DATABASE_URL);
  const cache = new CacheLayer(new SqliteCacheStore(handle.db));

  const sec = new SecClient({
    userAgent: config.SEC_USER_AGENT,
    queue: new RequestQueue({
      source: 'SEC',
      limiter: new RateLimiter({ ...DEFAULT_LIMITS.SEC }),
      concurrency: 6,
    }),
    cache,
  });

  // 미국 기업만 도는데도 넘겨야 한다. 실제로 불릴 일은 없다.
  const dart = new DartClient({
    apiKey: config.DART_API_KEY,
    queue: new RequestQueue({
      source: 'DART',
      limiter: new RateLimiter({ ...DEFAULT_LIMITS.DART }),
      concurrency: 2,
    }),
    cache,
  });

  const ids = (
    await handle.db
      .select({ id: companiesTable.id })
      .from(companiesTable)
      .where(eq(companiesTable.country, 'US'))
      .orderBy(companiesTable.id)
  ).map((row) => row.id);

  const targets = await loadCompanies(handle.db, ids);
  console.log(`미국 기업 ${targets.length}개, ${fromYear}~${toYear} 백필`);
  if (force) console.log('--force: 이미 저장된 연도도 다시 받는다');
  console.log();

  const startedAt = Date.now();
  let done = 0;
  let failed = 0;
  const problems: string[] = [];

  for (const company of targets) {
    const label = company.ticker ?? company.id;

    if (force) {
      // ensureAnnualFinancials 는 이미 있는 연도를 건너뛴다. 다시 받으려면 비워야 한다.
      await handle.db.delete(financialFacts).where(eq(financialFacts.companyId, company.id));
    }

    try {
      const warnings = await ensureAnnualFinancials({ db: handle.db, dart, sec }, company, fromYear, toYear);
      const [row] = await handle.db
        .select({ n: sql<number>`count(*)` })
        .from(financialFacts)
        .where(eq(financialFacts.companyId, company.id));
      const stored = row?.n ?? 0;

      done += 1;
      const note = warnings.length > 0 ? `  (경고 ${warnings.length})` : '';
      console.log(`  [${String(done).padStart(2)}/${targets.length}] ${label.padEnd(6)} ${String(stored).padStart(4)}건${note}`);

      // 값이 하나도 안 들어온 기업은 따로 모아 끝에 보여준다.
      // 은행·보험처럼 계정 체계가 다른 곳이 여기 걸린다.
      if (stored === 0) problems.push(`${label}: 저장된 값 없음`);
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.log(`  [${String(done + failed).padStart(2)}/${targets.length}] ${label.padEnd(6)} 실패 — ${message}`);
      problems.push(`${label}: ${message}`);
    }
  }

  const seconds = Math.round((Date.now() - startedAt) / 1000);
  console.log();
  console.log(`완료: ${done}개 성공, ${failed}개 실패, ${seconds}초`);

  if (problems.length > 0) {
    console.log();
    console.log('확인이 필요한 기업:');
    for (const line of problems) console.log(`  - ${line}`);
  }

  handle.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
