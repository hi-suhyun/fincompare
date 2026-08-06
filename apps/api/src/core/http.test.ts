import { describe, expect, it, vi } from 'vitest';
import { CacheLayer, MemoryCacheStore, TTL_MS } from './cache.js';
import { SourceError } from './errors.js';
import { SourceClient, type FetchImpl } from './http.js';
import { RequestQueue } from './queue.js';
import { RateLimiter } from './rateLimiter.js';

function makeClient(fetchImpl: FetchImpl, defaultHeaders?: Record<string, string>) {
  const limiter = new RateLimiter({ capacity: 100, refillPerSecond: 1000 });
  const queue = new RequestQueue({
    source: 'SEC',
    limiter,
    sleep: () => Promise.resolve(),
    random: () => 0.5,
  });
  const cache = new CacheLayer(new MemoryCacheStore());
  return new SourceClient({
    source: 'SEC',
    queue,
    cache,
    fetchImpl,
    ...(defaultHeaders === undefined ? {} : { defaultHeaders }),
  });
}

const jsonResponse = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), { status: 200, ...init });

/**
 * Response body 는 한 번만 읽을 수 있다.
 * mockResolvedValue 로 같은 객체를 재사용하면 두 번째 호출에서 터지므로
 * 호출마다 새 Response 를 만들어 준다 (실제 fetch 의 동작과 같다).
 */
const alwaysRespond = (factory: () => Response): FetchImpl =>
  vi.fn<FetchImpl>().mockImplementation(() => Promise.resolve(factory()));

const parseJson = <T,>(bytes: Uint8Array): T =>
  JSON.parse(new TextDecoder().decode(bytes)) as T;

describe('SourceClient — 캐시 우선', () => {
  it('첫 호출은 네트워크, 두 번째는 캐시', async () => {
    const fetchImpl = vi.fn<FetchImpl>().mockResolvedValue(jsonResponse({ v: 1 }));
    const client = makeClient(fetchImpl);

    const opts = {
      url: 'https://data.sec.gov/x',
      cacheKey: 'k',
      ttlMs: TTL_MS.FINANCIALS,
      parse: parseJson<{ v: number }>,
    };

    const first = await client.get(opts);
    const second = await client.get(opts);

    expect(first?.value).toEqual({ v: 1 });
    expect(first?.fromCache).toBe(false);
    expect(second?.fromCache).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('forceRefresh 는 캐시를 건너뛴다', async () => {
    const fetchImpl = alwaysRespond(() => jsonResponse({ v: 1 }));
    const client = makeClient(fetchImpl);
    const opts = {
      url: 'https://data.sec.gov/x',
      cacheKey: 'k',
      ttlMs: TTL_MS.FINANCIALS,
      parse: parseJson<{ v: number }>,
    };

    await client.get(opts);
    await client.get({ ...opts, forceRefresh: true });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('SourceClient — 헤더', () => {
  it('기본 헤더를 모든 요청에 붙인다 — SEC User-Agent 는 없으면 403', async () => {
    const fetchImpl = vi.fn<FetchImpl>().mockResolvedValue(jsonResponse({}));
    const client = makeClient(fetchImpl, { 'User-Agent': 'FinCompare me@example.com' });

    await client.get({
      url: 'https://data.sec.gov/x',
      cacheKey: 'k',
      ttlMs: TTL_MS.FINANCIALS,
      parse: parseJson,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://data.sec.gov/x',
      expect.objectContaining({
        headers: expect.objectContaining({ 'User-Agent': 'FinCompare me@example.com' }),
      }),
    );
  });
});

describe('SourceClient — 오류 처리', () => {
  it('403 은 AUTH 로 분류되고 재시도하지 않는다', async () => {
    const fetchImpl = vi.fn<FetchImpl>().mockResolvedValue(new Response('', { status: 403 }));
    const client = makeClient(fetchImpl);

    await expect(
      client.get({ url: 'u', cacheKey: 'k', ttlMs: 1000, parse: parseJson }),
    ).rejects.toMatchObject({ kind: 'AUTH' });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('404 는 "데이터 없음"으로 캐시되고 null 을 준다', async () => {
    const fetchImpl = vi.fn<FetchImpl>().mockResolvedValue(new Response('', { status: 404 }));
    const client = makeClient(fetchImpl);
    const opts = { url: 'u', cacheKey: 'k', ttlMs: 1000, parse: parseJson };

    expect(await client.get(opts)).toBeNull();

    // 두 번째 호출은 네트워크를 타지 않는다
    expect(await client.get(opts)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('5xx 는 재시도한다', async () => {
    const fetchImpl = vi
      .fn<FetchImpl>()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ v: 2 }));
    const client = makeClient(fetchImpl);

    const result = await client.get({
      url: 'u',
      cacheKey: 'k',
      ttlMs: 1000,
      parse: parseJson<{ v: number }>,
    });

    expect(result?.value).toEqual({ v: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('429 의 Retry-After 를 존중한다', async () => {
    const fetchImpl = vi
      .fn<FetchImpl>()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = makeClient(fetchImpl);

    await expect(
      client.get({ url: 'u', cacheKey: 'k', ttlMs: 1000, parse: parseJson }),
    ).resolves.toMatchObject({ value: { ok: true } });
  });

  it('네트워크 예외는 TRANSIENT 로 감싸 재시도한다', async () => {
    const fetchImpl = vi
      .fn<FetchImpl>()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(jsonResponse({ v: 3 }));
    const client = makeClient(fetchImpl);

    const result = await client.get({
      url: 'u',
      cacheKey: 'k',
      ttlMs: 1000,
      parse: parseJson<{ v: number }>,
    });
    expect(result?.value).toEqual({ v: 3 });
  });
});

describe('SourceClient — 파싱', () => {
  it('파싱 실패는 PARSE 로 감싸고 캐시에 넣지 않는다', async () => {
    const fetchImpl = alwaysRespond(() => new Response('not json'));
    const client = makeClient(fetchImpl);
    const opts = { url: 'u', cacheKey: 'k', ttlMs: 1000, parse: parseJson };

    await expect(client.get(opts)).rejects.toMatchObject({ kind: 'PARSE' });

    // 캐시에 안 들어갔으므로 다시 네트워크를 탄다
    await expect(client.get(opts)).rejects.toMatchObject({ kind: 'PARSE' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('parse 가 NOT_FOUND 를 던지면 데이터 없음으로 캐시한다 — DART 013 경로', async () => {
    // DART 는 HTTP 200 에 status 코드로 결과를 알려준다
    const fetchImpl = vi.fn<FetchImpl>().mockResolvedValue(jsonResponse({ status: '013' }));
    const client = makeClient(fetchImpl);
    const opts = {
      url: 'u',
      cacheKey: 'k',
      ttlMs: 1000,
      parse: (): never => {
        throw new SourceError('DART', 'NOT_FOUND', '조회된 데이터가 없습니다');
      },
    };

    expect(await client.get(opts)).toBeNull();
    expect(await client.get(opts)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
