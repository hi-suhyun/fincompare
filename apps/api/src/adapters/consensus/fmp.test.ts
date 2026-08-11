import { describe, expect, it, vi } from 'vitest';
import { CacheLayer, MemoryCacheStore, buildCacheKey } from '../../core/cache.js';
import { RequestQueue } from '../../core/queue.js';
import { RateLimiter } from '../../core/rateLimiter.js';
import { FmpConsensusAdapter } from './fmp.js';

/**
 * URL 로 응답을 갈라 준다. 추정치와 목표주가가 서로 다르게 동작하는 경우
 * (요금제 차단 등)를 재현해야 한다.
 */
function makeAdapter(routes: {
  estimates?: unknown;
  priceTarget?: unknown;
  priceTargetStatus?: number;
}) {
  const urls: string[] = [];
  const fetchImpl = vi.fn(async (url: string) => {
    urls.push(url);
    if (url.includes('price-target-consensus')) {
      return new Response(JSON.stringify(routes.priceTarget ?? []), {
        status: routes.priceTargetStatus ?? 200,
      });
    }
    return new Response(JSON.stringify(routes.estimates ?? []), { status: 200 });
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

  return { adapter, urls };
}

/** 실제 FMP stable 응답에서 가져온 형태 (NVDA FY2024) */
const NVDA_FY2024 = {
  symbol: 'NVDA',
  date: '2024-01-25',
  revenueLow: 59095875397,
  revenueHigh: 60130706265,
  revenueAvg: 59306860332,
  epsLow: 1.21917,
  epsAvg: 1.23926,
  epsHigh: 1.26537,
  numAnalystsRevenue: 28,
  numAnalystsEps: 28,
};

describe('FmpConsensusAdapter — 추정치', () => {
  it('한 회계기간을 지표별로 펼친다', async () => {
    const { adapter } = makeAdapter({ estimates: [NVDA_FY2024] });

    const result = await adapter.fetchConsensus('NVDA');

    expect(result.estimates).toHaveLength(2);
    expect(result.estimates.find((e) => e.metricId === 'eps')).toEqual({
      periodEnd: '2024-01-25',
      metricId: 'eps',
      low: 1.21917,
      avg: 1.23926,
      high: 1.26537,
      count: 28,
    });
    expect(result.estimates.find((e) => e.metricId === 'revenue')?.avg).toBe(59306860332);
  });

  it('회계기간 종료일을 연도로 뭉개지 않는다', async () => {
    // 1월 결산 기업은 종료일이 있어야 실제값과 같은 해에 정렬된다
    const { adapter } = makeAdapter({ estimates: [NVDA_FY2024] });

    const result = await adapter.fetchConsensus('NVDA');

    expect(result.estimates[0]?.periodEnd).toBe('2024-01-25');
  });

  it('숫자가 문자열로 와도 읽는다', async () => {
    // FMP 는 같은 필드를 기업마다 다른 타입으로 준다
    const { adapter } = makeAdapter({
      estimates: [{ ...NVDA_FY2024, epsAvg: '1.23926', numAnalystsEps: '28' }],
    });

    const result = await adapter.fetchConsensus('NVDA');
    const eps = result.estimates.find((e) => e.metricId === 'eps');
    expect(eps?.avg).toBe(1.23926);
    expect(eps?.count).toBe(28);
  });

  it('값이 없는 지표는 행을 만들지 않는다', async () => {
    const { adapter } = makeAdapter({
      estimates: [{ ...NVDA_FY2024, epsAvg: null, revenueAvg: null }],
    });

    const result = await adapter.fetchConsensus('NVDA');
    expect(result.estimates).toEqual([]);
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
        new Response(JSON.stringify([NVDA_FY2024]))) as unknown as typeof globalThis.fetch,
    });

    await adapter.fetchConsensus('NVDA');

    // 심볼만으로 만든 키로 꺼내진다면, 키에 토큰이 섞이지 않았다는 뜻이다
    const cacheKey = buildCacheKey('FMP', 'analyst-estimates', { symbol: 'NVDA' });
    expect(cacheKey).not.toContain('super-secret');
    await expect(store.get(cacheKey)).resolves.not.toBeNull();
  });
});

describe('FmpConsensusAdapter — 목표주가', () => {
  it('현재 컨센서스를 읽는다', async () => {
    const { adapter } = makeAdapter({
      estimates: [NVDA_FY2024],
      priceTarget: [
        { symbol: 'NVDA', targetHigh: 500, targetLow: 218, targetConsensus: 319.48, targetMedian: 300 },
      ],
    });

    const result = await adapter.fetchConsensus('NVDA');

    expect(result.priceTarget).toEqual({ high: 500, avg: 319.48, low: 218, currency: 'USD' });
  });

  it('목표주가가 막혀도 추정치는 살린다', async () => {
    // 추정치가 핵심 기능이다. 목표주가는 부가라 없어도 성립해야 한다.
    const { adapter } = makeAdapter({
      estimates: [NVDA_FY2024],
      priceTarget: { 'Error Message': 'Restricted Endpoint: not available under your plan' },
    });

    const result = await adapter.fetchConsensus('NVDA');

    expect(result.estimates).toHaveLength(2);
    expect(result.priceTarget).toBeNull();
    expect(result.priceTargetNote).toContain('목표주가를 받지 못했습니다');
  });
});

describe('FmpConsensusAdapter — 요금제 차단', () => {
  it('안내 문구를 데이터로 착각하지 않는다', async () => {
    // 200 본문에 문구만 담겨 오면 "추정치 0건" 으로 조용히 넘어간다
    const { adapter } = makeAdapter({
      estimates: {
        'Error Message':
          'Legacy Endpoint : Due to Legacy endpoints being no longer supported',
      },
    });

    await expect(adapter.fetchConsensus('NVDA')).rejects.toThrow(/Legacy/);
  });
});
