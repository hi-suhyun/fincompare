import type { SourceId } from '@fincompare/shared';
import type { ErrorKind } from './errors.js';
import type { Clock } from './rateLimiter.js';
import { systemClock } from './rateLimiter.js';

/**
 * 캐시 우선 조회 계층.
 *
 * 저장소 구현을 인터페이스로 분리해 두어 SQLite / Postgres / 메모리를 갈아끼울 수 있다.
 * 테스트는 메모리 구현을 쓴다.
 */

export interface CacheEntry {
  source: SourceId;
  cacheKey: string;
  payload: Uint8Array;
  etag: string | null;
  fetchedAt: number;
  expiresAt: number;
}

export type FetchStatus = 'OK' | 'EMPTY' | 'ERROR';

export interface FetchLogEntry {
  source: SourceId;
  cacheKey: string;
  status: FetchStatus;
  errorKind: ErrorKind | null;
  attemptedAt: number;
  /** EMPTY 기록의 유효기간. 지나면 다시 시도한다 */
  revalidateAfter: number | null;
}

export interface CacheStore {
  get(cacheKey: string): Promise<CacheEntry | null>;
  set(entry: CacheEntry): Promise<void>;
  delete(cacheKey: string): Promise<void>;
  getLog(cacheKey: string): Promise<FetchLogEntry | null>;
  putLog(entry: FetchLogEntry): Promise<void>;
}

/**
 * 소스별 TTL.
 * 확정 재무데이터는 사실상 불변이라 길게 잡아도 된다.
 */
export const TTL_MS = {
  /** 확정 재무제표 */
  FINANCIALS: 30 * 86_400_000,
  /** 기업 마스터 (corpCode.xml, company_tickers.json) */
  COMPANY_MASTER: 7 * 86_400_000,
  /** 주가·환율 */
  MARKET: 86_400_000,
  /**
   * 애널리스트 목표주가. 새 리포트가 매일 나오지는 않고, 무료 티어가
   * 하루 250 콜이라 자주 받을 여유도 없다.
   */
  CONSENSUS: 3 * 86_400_000,
  /** "데이터 없음" 기록 — 아직 공시 전일 수 있으니 재무데이터보다 짧게 */
  EMPTY: 7 * 86_400_000,
} as const;

export type CacheOutcome<T> =
  | { kind: 'HIT'; value: T; fetchedAt: number }
  /** 이전 조회에서 데이터가 없다고 확인된 조합 */
  | { kind: 'KNOWN_EMPTY'; attemptedAt: number }
  | { kind: 'MISS' };

export interface CachedFetchOptions<T> {
  source: SourceId;
  cacheKey: string;
  ttlMs: number;
  /** 바이트 -> 값. 캐시 히트일 때만 호출된다 */
  decode: (payload: Uint8Array) => T;
  /** 값 -> 바이트. 네트워크에서 받아왔을 때만 호출된다 */
  encode: (value: T) => Uint8Array;
  /** 실제 네트워크 호출. 큐를 거쳐 실행되어야 한다 */
  fetch: () => Promise<T>;
  /** 캐시를 무시하고 새로 받아온다 */
  forceRefresh?: boolean;
}

export class CacheLayer {
  private readonly store: CacheStore;
  private readonly clock: Clock;

  constructor(store: CacheStore, clock: Clock = systemClock) {
    this.store = store;
    this.clock = clock;
  }

  /** 네트워크를 타기 전에 캐시와 조회 기록을 먼저 본다 */
  async lookup<T>(cacheKey: string, decode: (payload: Uint8Array) => T): Promise<CacheOutcome<T>> {
    const now = this.clock.now();

    const entry = await this.store.get(cacheKey);
    if (entry !== null && entry.expiresAt > now) {
      return { kind: 'HIT', value: decode(entry.payload), fetchedAt: entry.fetchedAt };
    }

    const log = await this.store.getLog(cacheKey);
    if (
      log !== null &&
      log.status === 'EMPTY' &&
      (log.revalidateAfter === null || log.revalidateAfter > now)
    ) {
      return { kind: 'KNOWN_EMPTY', attemptedAt: log.attemptedAt };
    }

    return { kind: 'MISS' };
  }

  async store_<T>(options: {
    source: SourceId;
    cacheKey: string;
    ttlMs: number;
    payload: Uint8Array;
    etag?: string | null;
  }): Promise<void> {
    const now = this.clock.now();
    await this.store.set({
      source: options.source,
      cacheKey: options.cacheKey,
      payload: options.payload,
      etag: options.etag ?? null,
      fetchedAt: now,
      expiresAt: now + options.ttlMs,
    });
    await this.store.putLog({
      source: options.source,
      cacheKey: options.cacheKey,
      status: 'OK',
      errorKind: null,
      attemptedAt: now,
      revalidateAfter: null,
    });
  }

  /** DART 013 처럼 "그 조합에는 데이터가 없다"가 확정된 경우 */
  async markEmpty(source: SourceId, cacheKey: string, ttlMs = TTL_MS.EMPTY): Promise<void> {
    const now = this.clock.now();
    await this.store.putLog({
      source,
      cacheKey,
      status: 'EMPTY',
      errorKind: 'NOT_FOUND',
      attemptedAt: now,
      revalidateAfter: now + ttlMs,
    });
  }

  async markError(source: SourceId, cacheKey: string, errorKind: ErrorKind): Promise<void> {
    await this.store.putLog({
      source,
      cacheKey,
      status: 'ERROR',
      errorKind,
      attemptedAt: this.clock.now(),
      revalidateAfter: null,
    });
  }

  async invalidate(cacheKey: string): Promise<void> {
    await this.store.delete(cacheKey);
  }
}

/** 테스트·개발용 인메모리 저장소 */
export class MemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly logs = new Map<string, FetchLogEntry>();

  get(cacheKey: string): Promise<CacheEntry | null> {
    return Promise.resolve(this.entries.get(cacheKey) ?? null);
  }

  set(entry: CacheEntry): Promise<void> {
    this.entries.set(entry.cacheKey, entry);
    return Promise.resolve();
  }

  delete(cacheKey: string): Promise<void> {
    this.entries.delete(cacheKey);
    this.logs.delete(cacheKey);
    return Promise.resolve();
  }

  getLog(cacheKey: string): Promise<FetchLogEntry | null> {
    return Promise.resolve(this.logs.get(cacheKey) ?? null);
  }

  putLog(entry: FetchLogEntry): Promise<void> {
    this.logs.set(entry.cacheKey, entry);
    return Promise.resolve();
  }

  get size(): number {
    return this.entries.size;
  }
}

/** 캐시 키는 소스와 파라미터를 순서에 무관하게 안정적으로 직렬화한다 */
export function buildCacheKey(source: SourceId, endpoint: string, params: Record<string, string | number | undefined>): string {
  const parts = Object.entries(params)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`);
  return `${source}:${endpoint}:${parts.join('&')}`;
}
