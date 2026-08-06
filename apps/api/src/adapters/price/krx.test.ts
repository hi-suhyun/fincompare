import { describe, expect, it, vi } from 'vitest';
import { CacheLayer, MemoryCacheStore } from '../../core/cache.js';
import { RequestQueue } from '../../core/queue.js';
import { RateLimiter } from '../../core/rateLimiter.js';
import { KrxPriceAdapter } from './krx.js';

/**
 * KRX 는 basDd(하루)를 주면 그날 전 종목이 온다.
 * 휴장일에는 OutBlock_1 이 빈 배열로 온다.
 */
function makeAdapter(tradingDays: Record<string, number>) {
  const calls: string[] = [];

  const fetchImpl = vi.fn(async (url: string) => {
    const basDd = new URL(url).searchParams.get('basDd') ?? '';
    calls.push(basDd);

    const close = tradingDays[basDd];
    const body =
      close === undefined
        ? { OutBlock_1: [] }
        : {
            OutBlock_1: [
              {
                BAS_DD: basDd,
                ISU_CD: '005930',
                ISU_NM: '삼성전자',
                TDD_CLSPRC: String(close),
                MKTCAP: '317592431660000',
                LIST_SHRS: '5969782550',
              },
            ],
          };
    return new Response(JSON.stringify(body), { status: 200 });
  });

  const adapter = new KrxPriceAdapter({
    authKey: 'test-key',
    queue: new RequestQueue({
      source: 'KRX',
      limiter: new RateLimiter({ capacity: 100, refillPerSecond: 1000 }),
      sleep: () => Promise.resolve(),
    }),
    cache: new CacheLayer(new MemoryCacheStore()),
    fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
  });

  return { adapter, calls, fetchImpl };
}

describe('KrxPriceAdapter — 휴장일 폴백', () => {
  it('그날 거래가 있으면 바로 쓴다', async () => {
    const { adapter, calls } = makeAdapter({ '20241230': 53_200 });

    const result = await adapter.fetchCloses('KOSPI:005930', ['2024-12-30']);

    expect(result).toEqual([{ date: '2024-12-30', close: 53_200, currency: 'KRW' }]);
    expect(calls).toEqual(['20241230']);
  });

  it('12월 31일은 늘 휴장이라 직전 거래일로 거슬러 간다', async () => {
    const { adapter, calls } = makeAdapter({ '20241230': 53_200 });

    const result = await adapter.fetchCloses('KOSPI:005930', ['2024-12-31']);

    // 요청한 날짜로 라벨링한다 — 기말 시점 값이라는 의미가 유지돼야 한다
    expect(result).toEqual([{ date: '2024-12-31', close: 53_200, currency: 'KRW' }]);
    expect(calls).toEqual(['20241231', '20241230']);
  });

  it('연말 마지막 거래일이 해마다 다른 것을 흡수한다', async () => {
    // 2016년은 12/29 가 마지막 거래일 (12/30 은 폐장)
    const { adapter, calls } = makeAdapter({ '20161229': 1_802_000 });

    const result = await adapter.fetchCloses('KOSPI:005930', ['2016-12-31']);

    expect(result[0]?.close).toBe(1_802_000);
    expect(calls).toEqual(['20161231', '20161230', '20161229']);
  });

  it('긴 연휴도 넘어간다', async () => {
    const { adapter } = makeAdapter({ '20240925': 61_000 });
    const result = await adapter.fetchCloses('KOSPI:005930', ['2024-09-30']);
    expect(result[0]?.close).toBe(61_000);
  });

  it('최대 조회 일수를 넘으면 포기한다 — 무한 호출을 막는다', async () => {
    const { adapter, calls } = makeAdapter({});

    const result = await adapter.fetchCloses('KOSPI:005930', ['2024-12-31']);

    expect(result).toEqual([]);
    expect(calls).toHaveLength(10);
  });

  it('거래일인데 그 종목이 없으면 미상장으로 보고 더 거슬러 가지 않는다', async () => {
    const { adapter, calls } = makeAdapter({ '20241230': 53_200 });

    const result = await adapter.fetchCloses('KOSPI:000000', ['2024-12-30']);

    expect(result).toEqual([]);
    expect(calls).toEqual(['20241230']);
  });
});

describe('KrxPriceAdapter — 시장 라우팅', () => {
  it('KOSDAQ 은 다른 엔드포인트를 쓴다', async () => {
    const { adapter, fetchImpl } = makeAdapter({ '20241230': 1_000 });

    await adapter.fetchCloses('KOSDAQ:005930', ['2024-12-30']);

    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('ksq_bydd_trd');
  });

  it('KOSPI 는 stk_bydd_trd', async () => {
    const { adapter, fetchImpl } = makeAdapter({ '20241230': 1_000 });

    await adapter.fetchCloses('KOSPI:005930', ['2024-12-30']);

    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('stk_bydd_trd');
  });

  it('식별자 형식이 틀리면 던진다', async () => {
    const { adapter } = makeAdapter({});
    await expect(adapter.fetchCloses('005930', ['2024-12-30'])).rejects.toThrow(/형식/);
  });

  it('지원하지 않는 시장은 던진다', async () => {
    const { adapter } = makeAdapter({});
    await expect(adapter.fetchCloses('KONEX:005930', ['2024-12-30'])).rejects.toThrow(/지원하지/);
  });
});

describe('KrxPriceAdapter — 미조정 실거래가', () => {
  it('액면분할 소급 조정을 하지 않는다고 선언한다', () => {
    const { adapter } = makeAdapter({});
    // 이 플래그로 호출부가 EPS 조정 여부를 결정한다
    expect(adapter.isSplitAdjusted).toBe(false);
  });

  it('분할 이전 주가를 그대로 준다', async () => {
    // 2017-12-28 삼성전자 실거래가. 네이버 수정주가는 50,960 원이다
    const { adapter } = makeAdapter({ '20171228': 2_548_000 });

    const result = await adapter.fetchCloses('KOSPI:005930', ['2017-12-28']);

    expect(result[0]?.close).toBe(2_548_000);
  });
});
