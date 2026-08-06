/**
 * DART 연동 스모크 테스트.
 *
 *   pnpm --filter @fincompare/api verify:dart
 *
 * 키가 살아 있는지, 캐시가 실제로 네트워크를 막는지, "데이터 없음"이
 * 재조회되지 않는지를 실제 API 로 확인한다. 단위 테스트가 픽스처로 검증하는 것과 달리
 * 이건 큐·캐시·DB·파싱이 함께 도는지를 본다.
 */
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { CacheLayer, TTL_MS } from '../core/cache.js';
import { SourceError } from '../core/errors.js';
import { RequestQueue } from '../core/queue.js';
import { DEFAULT_LIMITS, RateLimiter } from '../core/rateLimiter.js';
import { DartClient } from '../adapters/dart/client.js';
import { convertFinancialRows, extractShares } from '../adapters/dart/financials.js';
import {
  DartCompanyResponseSchema,
  DartFinancialResponseSchema,
  DartStockResponseSchema,
  REPORT_CODE,
  marketFromCorpCls,
} from '../adapters/dart/schema.js';
import { parseAccountingMonth } from '../adapters/dart/numbers.js';
import { SqliteCacheStore } from '../db/cacheStore.js';
import { createDb } from '../db/client.js';

// .env 는 모노레포 루트에만 둔다. 앱마다 복사하면 키가 여기저기 흩어진다.
config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)), quiet: true });

const SAMSUNG = '00126380';

function fmtKrw(value: number | null): string {
  if (value === null) return '데이터 없음';
  return `${(value / 1e12).toFixed(2)}조 원`;
}

async function main(): Promise<void> {
  const apiKey = process.env['DART_API_KEY'] ?? '';
  if (apiKey === '') {
    console.error('DART_API_KEY 가 없습니다. .env 를 확인하세요.');
    process.exit(1);
  }

  const handle = createDb(':memory:');
  const limiter = new RateLimiter({ ...DEFAULT_LIMITS.DART });
  const queue = new RequestQueue({ source: 'DART', limiter });
  const cache = new CacheLayer(new SqliteCacheStore(handle.db));
  const dart = new DartClient({ apiKey, queue, cache });

  let networkCalls = 0;
  const countingFetch: typeof globalThis.fetch = (...args) => {
    networkCalls += 1;
    return globalThis.fetch(...args);
  };
  const counted = new DartClient({ apiKey, queue, cache, fetchImpl: countingFetch });

  console.log('── 1. 기업개황 ──────────────────────────────');
  const company = await dart.call(
    'company',
    { corp_code: SAMSUNG },
    DartCompanyResponseSchema,
    TTL_MS.COMPANY_MASTER,
  );
  if (company === null) throw new Error('기업개황 조회 실패');

  const accMonth = parseAccountingMonth(company.acc_mt);
  console.log(`  ${company.stock_name} (${company.stock_code})`);
  console.log(`  시장: ${marketFromCorpCls(company.corp_cls)} | 결산월: ${accMonth}월`);

  console.log('\n── 2. 재무제표 (1회 호출로 3개년) ───────────');
  const financials = await counted.call(
    'fnlttSinglAcntAll',
    { corp_code: SAMSUNG, bsns_year: 2023, reprt_code: REPORT_CODE.ANNUAL, fs_div: 'CFS' },
    DartFinancialResponseSchema,
  );
  if (financials === null) throw new Error('재무제표 조회 실패');

  const { points, missing, nameFallbacks } = convertFinancialRows(financials.list ?? [], {
    companyId: 'KR:005930',
    bsnsYear: 2023,
    accountingMonth: accMonth,
    consolidation: 'CFS',
    periodType: 'FY',
    filedAt: null,
    includePriorPeriods: true,
  });

  for (const year of [2021, 2022, 2023]) {
    const get = (m: string): number | null =>
      points.find((p) => p.metricId === m && p.fiscalYear === year)?.value ?? null;
    const revenue = get('revenue');
    const op = get('operatingIncome');
    const margin = revenue !== null && op !== null && revenue !== 0 ? (op / revenue) * 100 : null;
    console.log(
      `  ${year}  매출 ${fmtKrw(revenue).padStart(12)}` +
        `  영업이익 ${fmtKrw(op).padStart(12)}` +
        `  영업이익률 ${margin === null ? '  없음' : `${margin.toFixed(2)}%`}`,
    );
  }
  console.log(`  누락 지표: ${missing.length === 0 ? '없음' : missing.join(', ')}`);
  console.log(`  계정명 폴백: ${nameFallbacks.length === 0 ? '없음' : nameFallbacks.join(', ')}`);

  console.log('\n── 3. 캐시가 네트워크를 막는가 ──────────────');
  const before = networkCalls;
  await counted.call(
    'fnlttSinglAcntAll',
    { corp_code: SAMSUNG, bsns_year: 2023, reprt_code: REPORT_CODE.ANNUAL, fs_div: 'CFS' },
    DartFinancialResponseSchema,
  );
  console.log(
    `  두 번째 호출 네트워크 요청: ${networkCalls - before}건 ` +
      `${networkCalls === before ? '✅ 캐시 히트' : '❌ 캐시 미스'}`,
  );

  console.log('\n── 4. 주식의 총수 현황 ──────────────────────');
  const stock = await dart.call(
    'stockTotqySttus',
    { corp_code: SAMSUNG, bsns_year: 2023, reprt_code: REPORT_CODE.ANNUAL },
    DartStockResponseSchema,
  );
  const breakdown = extractShares(stock?.list ?? []);
  console.log(`  보통주 유통주식수: ${breakdown.common.outstanding?.toLocaleString() ?? '없음'}`);
  console.log(`  우선주 유통주식수: ${breakdown.preferred.outstanding?.toLocaleString() ?? '없음'}`);
  console.log(`  합계(EPS 분모)  : ${breakdown.totalOutstanding?.toLocaleString() ?? '없음'}`);

  const reportedEps = points.find((p) => p.metricId === 'eps' && p.fiscalYear === 2023)?.value;
  const netIncome = points.find((p) => p.metricId === 'netIncome' && p.fiscalYear === 2023)?.value;
  console.log(`\n  공시 EPS(2023)      : ${reportedEps?.toLocaleString() ?? '없음'}원  ← 이 값을 쓴다`);
  if (netIncome != null && breakdown.totalOutstanding !== null) {
    const withPreferred = Math.round(netIncome / breakdown.totalOutstanding);
    console.log(`  계산 (보통주+우선주): ${withPreferred.toLocaleString()}원`);
  }
  if (netIncome != null && breakdown.common.outstanding !== null) {
    const commonOnly = Math.round(netIncome / breakdown.common.outstanding);
    const gap = reportedEps == null ? null : ((commonOnly / reportedEps - 1) * 100).toFixed(1);
    console.log(`  계산 (보통주만)     : ${commonOnly.toLocaleString()}원  ❌ 공시 대비 +${gap}%`);
  }

  console.log('\n── 5. 데이터 없는 연도는 재조회하지 않는가 ──');
  const emptyBefore = networkCalls;
  const first = await counted.call(
    'fnlttSinglAcntAll',
    { corp_code: SAMSUNG, bsns_year: 2008, reprt_code: REPORT_CODE.ANNUAL, fs_div: 'CFS' },
    DartFinancialResponseSchema,
  );
  const afterFirst = networkCalls;
  const second = await counted.call(
    'fnlttSinglAcntAll',
    { corp_code: SAMSUNG, bsns_year: 2008, reprt_code: REPORT_CODE.ANNUAL, fs_div: 'CFS' },
    DartFinancialResponseSchema,
  );
  console.log(`  2008년 조회 결과: ${first === null ? 'null (데이터 없음)' : '데이터 있음'}`);
  console.log(`  1차 네트워크: ${afterFirst - emptyBefore}건 / 2차 네트워크: ${networkCalls - afterFirst}건`);
  console.log(
    `  ${second === null && networkCalls === afterFirst ? '✅ 재조회 안 함' : '❌ 재조회 발생'}`,
  );

  console.log('\n── 6. 사용량 ────────────────────────────────');
  const q = limiter.quota;
  console.log(`  이번 실행 호출: ${q.used}건 | 남은 한도(설정값 기준): ${q.remaining ?? '무제한'}`);

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
