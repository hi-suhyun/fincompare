import { describe, expect, it, vi } from 'vitest';
import { CacheLayer, MemoryCacheStore, buildCacheKey } from '../../core/cache.js';
import { RequestQueue } from '../../core/queue.js';
import { RateLimiter } from '../../core/rateLimiter.js';
import { FmpConsensusAdapter } from './fmp.js';

/**
 * URL 로 응답을 갈라 준다. price-target 과 price-target-consensus 가
 * 서로 다르게 동작하는 경우(요금제 차단 등)를 재현해야 한다.
 */
function makeAdapter(routes: { historical?: unknown; current?: unknown; status?: number }) {
  const urls: string[] = [];
  const fetchImpl = vi.fn(async (url: string) => {
    urls.push(url);
    const isConsensus = url.includes('price-target-consensus');
    const body = isConsensus ? routes.current : routes.historical;
    return new Response(JSON.stringify(body ?? []), { status: routes.status ?? 200 });
  });

  const adapter = new FmpConsensusAdapter({
    apiKey: 'test-key',
    queue: new RequestQueue({
      source: 'FMP',
      limiter: new RateLimiter({ capacity: 100, refillPerSecond: 1000 }),
      sleep: () => Promise.resolve(),
    }),
    cache: new CacheLayer(new MemoryCacheStore()),
    fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
  });

  return { adapter, urls, fetchImpl };
}

describe('FmpConsensusAdapter — 과거 목표주가', () => {
  it('발행일과 함께 개별 목표가를 읽는다', async () => {
    const { adapter } = makeAdapter({
      historical: [
        {
          symbol: 'NVDA',
          publishedDate: '2023-05-25T12:30:00.000Z',
          priceTarget: 450,
          priceWhenPosted: 305.38,
          analystCompany: 'Morgan Stanley',
        },
      ],
    });

    const result = await adapter.fetchTargets('NVDA');

    expect(result.historical).toBe(true);
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0]).toMatchObject({
      companyId: 'US:NVDA',
      // 타임스탬프에서 날짜만 잘라낸다
      publishedAt: '2023-05-25',
      priceTarget: 450,
      priceWhenPosted: 305.38,
      analystCompany: 'Morgan Stanley',
    });
  });

  it('숫자가 문자열로 와도 읽는다', async () => {
    // FMP 는 같은 필드를 기업마다 다른 타입으로 준다
    const { adapter } = makeAdapter({
      historical: [
        { symbol: 'NVDA', publishedDate: '2023-05-25', priceTarget: '450', priceWhenPosted: '305' },
      ],
    });

    const result = await adapter.fetchTargets('NVDA');
    expect(result.targets[0]?.priceTarget).toBe(450);
  });

  it('쓸 수 없는 행만 건너뛰고 나머지는 살린다', async () => {
    const { adapter } = makeAdapter({
      historical: [
        { symbol: 'NVDA', publishedDate: '2023-05-25', priceTarget: null },
        { symbol: 'NVDA', publishedDate: 'not-a-date', priceTarget: 400 },
        { symbol: 'NVDA', publishedDate: '2023-06-01', priceTarget: 0 },
        { symbol: 'NVDA', publishedDate: '2023-07-01', priceTarget: 500 },
      ],
    });

    const result = await adapter.fetchTargets('NVDA');

    expect(result.targets).toHaveLength(1);
    expect(result.targets[0]?.priceTarget).toBe(500);
  });

  it('API 키를 캐시 키에 남기지 않는다', async () => {
    const store = new MemoryCacheStore();
    const adapter = new FmpConsensusAdapter({
      apiKey: 'super-secret',
      queue: new RequestQueue({
        source: 'FMP',
        limiter: new RateLimiter({ capacity: 100, refillPerSecond: 1000 }),
        sleep: () => Promise.resolve(),
      }),
      cache: new CacheLayer(store),
      fetchImpl: (async () =>
        new Response(
          JSON.stringify([{ symbol: 'NVDA', publishedDate: '2023-05-25', priceTarget: 450 }]),
        )) as unknown as typeof globalThis.fetch,
    });

    await adapter.fetchTargets('NVDA');

    // 심볼만으로 만든 키로 꺼내진다면, 키에 토큰이 섞이지 않았다는 뜻이다
    const cacheKey = buildCacheKey('FMP', 'price-target', { symbol: 'NVDA' });
    expect(cacheKey).not.toContain('super-secret');
    await expect(store.get(cacheKey)).resolves.not.toBeNull();
  });
});

describe('FmpConsensusAdapter — 요금제가 과거 이력을 막았을 때', () => {
  const blocked = { 'Error Message': 'This endpoint is available under Premium plan.' };

  it('현재 컨센서스로 내려가고 그 사실을 알린다', async () => {
    // 조용히 빈 값을 주면 "목표주가가 없는 기업"으로 오해된다
    const { adapter } = makeAdapter({
      historical: blocked,
      current: [{ symbol: 'NVDA', targetHigh: 500, targetLow: 300, targetConsensus: 420, targetMedian: 410 }],
    });

    const result = await adapter.fetchTargets('NVDA');

    expect(result.historical).toBe(false);
    expect(result.reason).toContain('과거');
    expect(result.targets.map((t) => t.priceTarget)).toEqual([500, 420, 300]);
  });

  it('개별 목표가가 0건이어도 컨센서스를 시도한다', async () => {
    const { adapter, urls } = makeAdapter({
      historical: [],
      current: [{ symbol: 'NVDA', targetHigh: 500, targetLow: 300, targetConsensus: 420, targetMedian: 410 }],
    });

    const result = await adapter.fetchTargets('NVDA');

    expect(urls.some((u) => u.includes('price-target-consensus'))).toBe(true);
    expect(result.targets).toHaveLength(3);
  });

  it('컨센서스도 비어 있으면 빈 목록을 준다', async () => {
    const { adapter } = makeAdapter({ historical: [], current: [] });

    const result = await adapter.fetchTargets('NVDA');

    expect(result.targets).toEqual([]);
    expect(result.historical).toBe(false);
  });
});
