import type { SourceId } from '@fincompare/shared';
import { CacheLayer, type CacheOutcome } from './cache.js';
import { SourceError, classifyHttpStatus, parseRetryAfter } from './errors.js';
import type { RequestQueue } from './queue.js';

/**
 * 캐시 우선 -> 큐 -> 네트워크 순서를 한 곳에 모은 클라이언트.
 *
 * 어댑터는 이 클래스만 쓰고 fetch 를 직접 부르지 않는다.
 * 그래야 유량 제어와 캐싱을 빠뜨릴 수 없다.
 */

export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

export interface SourceClientOptions {
  source: SourceId;
  queue: RequestQueue;
  cache: CacheLayer;
  /** 모든 요청에 붙는 헤더. SEC User-Agent 처럼 필수인 것들 */
  defaultHeaders?: Record<string, string>;
  fetchImpl?: FetchImpl;
}

export interface GetOptions<T> {
  url: string;
  cacheKey: string;
  ttlMs: number;
  /** 응답 본문 -> 값. Zod 검증은 여기서 한다 */
  parse: (body: Uint8Array) => T;
  headers?: Record<string, string>;
  /**
   * 파싱된 값이 "데이터 없음"인지 판정한다.
   * DART 처럼 HTTP 200 에 status 코드로 결과를 알려주는 소스를 위한 훅.
   * SourceError 를 던지면 그 분류가 그대로 쓰인다.
   */
  forceRefresh?: boolean;
}

export interface FetchResult<T> {
  value: T;
  /** 캐시에서 왔는지 네트워크에서 왔는지 */
  fromCache: boolean;
  fetchedAt: number;
}

export class SourceClient {
  readonly source: SourceId;

  private readonly queue: RequestQueue;
  private readonly cache: CacheLayer;
  private readonly defaultHeaders: Record<string, string>;
  private readonly fetchImpl: FetchImpl;

  constructor(options: SourceClientOptions) {
    this.source = options.source;
    this.queue = options.queue;
    this.cache = options.cache;
    this.defaultHeaders = options.defaultHeaders ?? {};
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * 캐시를 먼저 보고, 없으면 큐를 거쳐 받아온다.
   *
   * 반환값이 null 이면 "그 조합에 데이터가 없음"이 확정된 것이다.
   * 오류로 못 받은 것과 구분된다 — 오류는 던진다.
   */
  async get<T>(options: GetOptions<T>): Promise<FetchResult<T> | null> {
    if (options.forceRefresh !== true) {
      const cached: CacheOutcome<T> = await this.cache.lookup(options.cacheKey, options.parse);

      if (cached.kind === 'HIT') {
        return { value: cached.value, fromCache: true, fetchedAt: cached.fetchedAt };
      }
      if (cached.kind === 'KNOWN_EMPTY') {
        return null;
      }
    }

    let body: Uint8Array;
    try {
      body = await this.queue.enqueue(() => this.rawGet(options.url, options.headers));
    } catch (error) {
      if (error instanceof SourceError) {
        if (error.cacheableAsEmpty) {
          await this.cache.markEmpty(this.source, options.cacheKey);
          return null;
        }
        await this.cache.markError(this.source, options.cacheKey, error.kind);
      }
      throw error;
    }

    let value: T;
    try {
      value = options.parse(body);
    } catch (error) {
      if (error instanceof SourceError && error.cacheableAsEmpty) {
        await this.cache.markEmpty(this.source, options.cacheKey);
        return null;
      }
      // 파싱 실패는 재시도해도 같은 결과다. 캐시에 넣지 않고 그대로 올린다.
      throw error instanceof SourceError
        ? error
        : new SourceError(this.source, 'PARSE', `응답 파싱 실패: ${options.url}`, { cause: error });
    }

    await this.cache.store_({
      source: this.source,
      cacheKey: options.cacheKey,
      ttlMs: options.ttlMs,
      payload: body,
    });

    return { value, fromCache: false, fetchedAt: Date.now() };
  }

  /** 큐 안에서 실행되는 실제 HTTP 호출 */
  private async rawGet(url: string, headers?: Record<string, string>): Promise<Uint8Array> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { ...this.defaultHeaders, ...headers },
      });
    } catch (error) {
      throw new SourceError(this.source, 'TRANSIENT', `네트워크 오류: ${url}`, { cause: error });
    }

    const kind = classifyHttpStatus(response.status);
    if (kind !== null) {
      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'), Date.now());
      throw new SourceError(
        this.source,
        kind,
        `${this.source} 요청 실패 (HTTP ${response.status}): ${url}`,
        retryAfterMs === undefined
          ? { code: String(response.status) }
          : { code: String(response.status), retryAfterMs },
      );
    }

    return new Uint8Array(await response.arrayBuffer());
  }
}
