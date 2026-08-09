/**
 * 미국 기업 마스터 시딩.
 *
 *   pnpm --filter @fincompare/api seed:us
 *   pnpm --filter @fincompare/api seed:us -- --all      (전체 약 10,000개)
 *
 * 기본은 한글 별칭 목록에 있는 종목만 시딩한다.
 * 전체를 돌리면 submissions 를 종목마다 불러야 해서 시간이 오래 걸린다.
 */
import { SecClient } from '../adapters/sec/client.js';
import { loadConfig } from '../config.js';
import { CacheLayer } from '../core/cache.js';
import { SourceError } from '../core/errors.js';
import { RequestQueue } from '../core/queue.js';
import { DEFAULT_LIMITS, RateLimiter } from '../core/rateLimiter.js';
import { SqliteCacheStore } from '../db/cacheStore.js';
import { createDb } from '../db/client.js';
import { seedUsCompanies } from '../jobs/seedUsCompanies.js';

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.SEC_USER_AGENT.trim() === '') {
    console.error('SEC_USER_AGENT 가 없습니다. SEC 는 이 헤더 없이 호출하면 403 을 돌려줍니다.');
    process.exit(1);
  }

  const includeAll = process.argv.includes('--all');
  const handle = await createDb(config.DATABASE_URL);
  const limiter = new RateLimiter({ ...DEFAULT_LIMITS.SEC });
  const sec = new SecClient({
    userAgent: config.SEC_USER_AGENT,
    queue: new RequestQueue({ source: 'SEC', limiter, concurrency: 6 }),
    cache: new CacheLayer(new SqliteCacheStore(handle.db)),
  });

  const startedAt = Date.now();
  let lastLine = '';

  const result = await seedUsCompanies(handle.db, sec, {
    includeAll,
    onProgress: (done, total, message) => {
      const line = message ?? `[detail] ${done}/${total}`;
      if (line !== lastLine) {
        console.log(line);
        lastLine = line;
      }
    },
  });

  console.log('\n── 미국 기업 시딩 완료 ──────────────────────');
  console.log(`  company_tickers 전체   : ${result.totalTickers.toLocaleString()}`);
  console.log(`  시딩 대상              : ${result.targeted.toLocaleString()}`);
  console.log(`  저장                   : ${result.inserted.toLocaleString()}`);
  console.log(`  제외 (ADR, 20-F/40-F)  : ${result.skippedAdr.toLocaleString()}`);
  console.log(`  제외 (NYSE·NASDAQ 아님) : ${result.skippedExchange.toLocaleString()}`);
  console.log(`  실패                   : ${result.failed.toLocaleString()}`);
  console.log(`  검색 별칭              : ${result.aliasCount.toLocaleString()}`);
  console.log(
    `  소요                   : ${((Date.now() - startedAt) / 1000).toFixed(1)}초 | 호출 ${limiter.quota.used}건`,
  );

  await handle.close();
}

main().catch((error: unknown) => {
  if (error instanceof SourceError) {
    console.error(`\n❌ [${error.kind}] ${error.message}`);
  } else {
    console.error('\n❌', error);
  }
  process.exit(1);
});
