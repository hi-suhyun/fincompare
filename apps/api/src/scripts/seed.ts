/**
 * 기업 마스터 시딩 실행.
 *
 *   pnpm --filter @fincompare/api seed
 *   pnpm --filter @fincompare/api seed -- --limit 50    (맛보기)
 *
 * 약 4,000회 호출, 3~5분 걸린다. 캐시가 남아 있으면 재실행은 거의 즉시 끝난다.
 */
import { DartClient } from '../adapters/dart/client.js';
import { loadConfig } from '../config.js';
import { CacheLayer } from '../core/cache.js';
import { SourceError } from '../core/errors.js';
import { RequestQueue } from '../core/queue.js';
import { DEFAULT_LIMITS, RateLimiter } from '../core/rateLimiter.js';
import { SqliteCacheStore } from '../db/cacheStore.js';
import { createDb } from '../db/client.js';
import { seedKoreanCompanies } from '../jobs/seedCompanies.js';

function parseLimit(argv: readonly string[]): number | undefined {
  const index = argv.indexOf('--limit');
  if (index === -1) return undefined;
  const value = Number(argv[index + 1]);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.DART_API_KEY === '') {
    console.error('DART_API_KEY 가 없습니다. .env 를 확인하세요.');
    process.exit(1);
  }

  const limit = parseLimit(process.argv);
  const handle = createDb(config.DATABASE_URL);
  const limiter = new RateLimiter({ ...DEFAULT_LIMITS.DART, capacity: 10, refillPerSecond: 10 });
  // 약 4,000회를 직렬로 돌리면 RTT 가 그대로 쌓여 26분이 걸린다.
  // DART 는 실측상 20 req/s 를 받아주므로 겹쳐 보낸다.
  const queue = new RequestQueue({ source: 'DART', limiter, concurrency: 8 });
  const cache = new CacheLayer(new SqliteCacheStore(handle.db));
  const dart = new DartClient({ apiKey: config.DART_API_KEY, queue, cache });

  const startedAt = Date.now();
  let lastLine = '';

  const result = await seedKoreanCompanies(handle.db, dart, {
    ...(limit === undefined ? {} : { limit }),
    onProgress: (p) => {
      const line =
        p.message !== undefined
          ? `[${p.phase}] ${p.message}`
          : `[${p.phase}] ${p.done}/${p.total} (${((p.done / p.total) * 100).toFixed(0)}%)`;
      if (line !== lastLine) {
        console.log(line);
        lastLine = line;
      }
    },
  });

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log('\n── 시딩 완료 ────────────────────────────────');
  console.log(`  corpCode.xml 전체 항목 : ${result.totalEntries.toLocaleString()}`);
  console.log(`  종목코드 보유          : ${result.withStockCode.toLocaleString()}`);
  console.log(`  저장된 현재 상장사     : ${result.inserted.toLocaleString()}`);
  console.log(`  제외 (폐지·코넥스 등)  : ${result.skippedNotListed.toLocaleString()}`);
  console.log(`  조회 실패              : ${result.failed.toLocaleString()}`);
  console.log(`  검색 별칭              : ${result.aliasCount.toLocaleString()}`);
  console.log(`  소요                   : ${elapsed}초 | API 호출 ${limiter.quota.used}건`);

  handle.close();
}

main().catch((error: unknown) => {
  if (error instanceof SourceError) {
    console.error(`\n❌ [${error.kind}] ${error.message}`);
  } else {
    console.error('\n❌', error);
  }
  process.exit(1);
});
