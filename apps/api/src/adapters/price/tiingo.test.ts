import { describe, expect, it, vi } from 'vitest';
import { CacheLayer, MemoryCacheStore } from '../../core/cache.js';
import { RequestQueue } from '../../core/queue.js';
import { RateLimiter } from '../../core/rateLimiter.js';
import { TiingoPriceAdapter } from './tiingo.js';

/**
 * Tiingo 는 한 번의 호출로 전체 히스토리를 준다.
 * close 는 미조정 실거래가, adjClose 는 분할·배당 조정가다.
 */
function makeAdapter(rows: Array<{ date: string; close: number; adjClose?: number }>) {
  const urls: string[] = [];
  const fetchImpl = vi.fn(async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify(rows), { status: 200 });
  });

  const adapter = new TiingoPriceAdapter({
    apiKey: 'test-token',
    queue: new RequestQueue({
      source: 'TIINGO',
      limiter: new RateLimiter({ capacity: 100, refillPerSecond: 1000 }),
      sleep: () => Promise.resolve(),
    }),
    cache: new CacheLayer(new MemoryCacheStore()),
    fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
  });

  return { adapter, urls, fetchImpl };
}

/** Tiingo 는 ISO 8601 타임스탬프로 날짜를 준다 */
const ts = (date: string): string => `${date}T00:00:00.000Z`;

describe('TiingoPriceAdapter — 미조정가 사용', () => {
  it('adjClose 가 아니라 close 를 쓴다', async () => {
    // AAPL 은 2020년 4:1 분할. 2019년 실거래가는 218$, 조정가는 54.5$ 다.
    // SEC EPS 를 최초 제출값(분할 전 기준)으로 쓰므로 주가도 미조정이어야 짝이 맞는다.
    const { adapter } = makeAdapter([{ date: ts('2019-09-27'), close: 218.82, adjClose: 54.7 }]);

    const result = await adapter.fetchCloses('AAPL', ['2019-09-27']);

    expect(result[0]?.close).toBe(218.82);
    expect(result[0]?.close).not.toBe(54.7);
  });

  it('분할 조정을 하지 않는다고 선언한다', () => {
    const { adapter } = makeAdapter([]);
    expect(adapter.isSplitAdjusted).toBe(false);
  });

  it('통화는 USD', async () => {
    const { adapter } = makeAdapter([{ date: ts('2024-09-30'), close: 233.0 }]);
    const result = await adapter.fetchCloses('AAPL', ['2024-09-30']);
    expect(result[0]?.currency).toBe('USD');
  });
});

describe('TiingoPriceAdapter — 휴장일 처리', () => {
  const series = [
    { date: ts('2024-12-27'), close: 255.59 },
    { date: ts('2024-12-30'), close: 252.2 },
    // 12/31 은 거래일이지만 응답에 없는 상황을 가정
  ];

  it('요청 날짜에 값이 없으면 직전 거래일을 쓴다', async () => {
    const { adapter } = makeAdapter(series);

    const result = await adapter.fetchCloses('AAPL', ['2024-12-31']);

    expect(result[0]?.close).toBe(252.2);
    // 요청한 날짜로 라벨링한다 — 기말 시점 값이라는 의미가 유지돼야 한다
    expect(result[0]?.date).toBe('2024-12-31');
  });

  it('여러 기말 시점을 한 번의 호출로 처리한다', async () => {
    const { adapter, fetchImpl } = makeAdapter(series);

    const result = await adapter.fetchCloses('AAPL', ['2024-12-27', '2024-12-31']);

    expect(result.map((r) => r.close)).toEqual([255.59, 252.2]);
    // 기업당 1회. 날짜마다 부르지 않는다
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('구간 시작 이전은 값이 없다 — 앞으로 당겨오지 않는다', async () => {
    const { adapter } = makeAdapter(series);
    expect(await adapter.fetchCloses('AAPL', ['2024-01-01'])).toEqual([]);
  });
});

describe('TiingoPriceAdapter — 요청 구성', () => {
  it('기말이 휴장일 수 있으므로 시작을 1년 앞당겨 받는다', async () => {
    const { adapter, urls } = makeAdapter([{ date: ts('2024-12-30'), close: 252.2 }]);

    await adapter.fetchCloses('AAPL', ['2024-12-31']);

    expect(urls[0]).toContain('startDate=2023-01-01');
    expect(urls[0]).toContain('endDate=2024-12-31');
  });

  it('빈 요청은 호출하지 않는다', async () => {
    const { adapter, fetchImpl } = makeAdapter([]);
    expect(await adapter.fetchCloses('AAPL', [])).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('키가 없으면 생성 시점에 던진다', () => {
    expect(
      () =>
        new TiingoPriceAdapter({
          apiKey: '   ',
          queue: new RequestQueue({
            source: 'TIINGO',
            limiter: new RateLimiter({ capacity: 1, refillPerSecond: 1 }),
          }),
          cache: new CacheLayer(new MemoryCacheStore()),
        }),
    ).toThrow(/TIINGO_API_KEY/);
  });
});

describe('TiingoPriceAdapter — 오류 처리', () => {
  it('빈 응답은 데이터 없음으로 다룬다', async () => {
    const { adapter } = makeAdapter([]);
    expect(await adapter.fetchCloses('NOPE', ['2024-12-31'])).toEqual([]);
  });

  it('스키마가 다르면 던진다', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ detail: 'Not found' }), { status: 200 }),
    );
    const adapter = new TiingoPriceAdapter({
      apiKey: 'test-token',
      queue: new RequestQueue({
        source: 'TIINGO',
        limiter: new RateLimiter({ capacity: 100, refillPerSecond: 1000 }),
        sleep: () => Promise.resolve(),
      }),
      cache: new CacheLayer(new MemoryCacheStore()),
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
    });

    await expect(adapter.fetchCloses('AAPL', ['2024-12-31'])).rejects.toMatchObject({
      kind: 'PARSE',
    });
  });
});
