import { describe, expect, it } from 'vitest';
import { CacheLayer, MemoryCacheStore, TTL_MS, buildCacheKey } from './cache.js';
import type { Clock } from './rateLimiter.js';

class FakeClock implements Clock {
  private t = 1_000_000;
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

const encode = (s: string): Uint8Array => new TextEncoder().encode(s);
const decode = (b: Uint8Array): string => new TextDecoder().decode(b);

describe('buildCacheKey', () => {
  it('파라미터 순서가 달라도 같은 키를 만든다', () => {
    const a = buildCacheKey('DART', 'fnlttSinglAcntAll', { corp_code: '00126380', bsns_year: 2024 });
    const b = buildCacheKey('DART', 'fnlttSinglAcntAll', { bsns_year: 2024, corp_code: '00126380' });
    expect(a).toBe(b);
  });

  it('undefined 파라미터는 키에서 빠진다', () => {
    const key = buildCacheKey('SEC', 'companyfacts', { cik: '0000320193', unused: undefined });
    expect(key).toBe('SEC:companyfacts:cik=0000320193');
  });

  it('소스가 다르면 키가 다르다', () => {
    expect(buildCacheKey('DART', 'x', { a: 1 })).not.toBe(buildCacheKey('SEC', 'x', { a: 1 }));
  });
});

describe('CacheLayer — 조회', () => {
  it('저장한 값을 히트로 돌려준다', async () => {
    const clock = new FakeClock();
    const cache = new CacheLayer(new MemoryCacheStore(), clock);

    await cache.store_({
      source: 'SEC',
      cacheKey: 'k',
      ttlMs: TTL_MS.FINANCIALS,
      payload: encode('payload'),
    });

    const result = await cache.lookup('k', decode);
    expect(result).toEqual({ kind: 'HIT', value: 'payload', fetchedAt: clock.now() });
  });

  it('없는 키는 MISS', async () => {
    const cache = new CacheLayer(new MemoryCacheStore(), new FakeClock());
    expect(await cache.lookup('없음', decode)).toEqual({ kind: 'MISS' });
  });

  it('TTL 이 지나면 MISS 로 떨어진다', async () => {
    const clock = new FakeClock();
    const cache = new CacheLayer(new MemoryCacheStore(), clock);

    await cache.store_({ source: 'ECB', cacheKey: 'fx', ttlMs: TTL_MS.MARKET, payload: encode('1350') });
    expect((await cache.lookup('fx', decode)).kind).toBe('HIT');

    clock.advance(TTL_MS.MARKET + 1);
    expect((await cache.lookup('fx', decode)).kind).toBe('MISS');
  });

  it('decode 는 히트일 때만 호출된다 — 3.8MB 파싱을 헛되이 돌리지 않는다', async () => {
    const cache = new CacheLayer(new MemoryCacheStore(), new FakeClock());
    let calls = 0;
    const counting = (b: Uint8Array): string => {
      calls += 1;
      return decode(b);
    };

    await cache.lookup('없음', counting);
    expect(calls).toBe(0);
  });
});

describe('CacheLayer — 데이터 없음 기록', () => {
  it('markEmpty 한 키는 KNOWN_EMPTY 로 돌아온다', async () => {
    const clock = new FakeClock();
    const cache = new CacheLayer(new MemoryCacheStore(), clock);

    await cache.markEmpty('DART', 'corp:2015:11011');

    const result = await cache.lookup('corp:2015:11011', decode);
    expect(result).toEqual({ kind: 'KNOWN_EMPTY', attemptedAt: clock.now() });
  });

  it('KNOWN_EMPTY 는 유효기간이 지나면 다시 시도 대상이 된다', async () => {
    const clock = new FakeClock();
    const cache = new CacheLayer(new MemoryCacheStore(), clock);

    // 아직 공시 전일 수 있으니 영구 결측으로 굳히지 않는다
    await cache.markEmpty('DART', 'k', TTL_MS.EMPTY);
    expect((await cache.lookup('k', decode)).kind).toBe('KNOWN_EMPTY');

    clock.advance(TTL_MS.EMPTY + 1);
    expect((await cache.lookup('k', decode)).kind).toBe('MISS');
  });

  it('오류 기록은 재조회를 막지 않는다 — 일시 장애일 수 있다', async () => {
    const cache = new CacheLayer(new MemoryCacheStore(), new FakeClock());

    await cache.markError('SEC', 'k', 'TRANSIENT');

    expect((await cache.lookup('k', decode)).kind).toBe('MISS');
  });

  it('성공 저장은 이전 EMPTY 기록을 덮는다', async () => {
    const cache = new CacheLayer(new MemoryCacheStore(), new FakeClock());

    await cache.markEmpty('DART', 'k');
    expect((await cache.lookup('k', decode)).kind).toBe('KNOWN_EMPTY');

    await cache.store_({ source: 'DART', cacheKey: 'k', ttlMs: TTL_MS.FINANCIALS, payload: encode('v') });
    expect((await cache.lookup('k', decode)).kind).toBe('HIT');
  });
});

describe('CacheLayer — 무효화', () => {
  it('invalidate 하면 캐시와 기록이 함께 지워진다', async () => {
    const store = new MemoryCacheStore();
    const cache = new CacheLayer(store, new FakeClock());

    await cache.store_({ source: 'SEC', cacheKey: 'k', ttlMs: TTL_MS.FINANCIALS, payload: encode('v') });
    expect(store.size).toBe(1);

    await cache.invalidate('k');

    expect(store.size).toBe(0);
    expect((await cache.lookup('k', decode)).kind).toBe('MISS');
  });
});
