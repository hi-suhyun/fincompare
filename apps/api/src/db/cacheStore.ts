import type { SourceId } from '@fincompare/shared';
import { eq } from 'drizzle-orm';
import type { CacheEntry, CacheStore, FetchLogEntry, FetchStatus } from '../core/cache.js';
import type { ErrorKind } from '../core/errors.js';
import type { Db } from './client.js';
import { fetchLog, rawCache } from './schema.js';

/**
 * SQLite 기반 CacheStore.
 *
 * 시각은 DB에 ISO 문자열로 넣는다. 숫자 타임스탬프보다 눈으로 읽기 쉽고,
 * Postgres 로 옮길 때 timestamp 컬럼으로 그대로 매핑된다.
 */
export class SqliteCacheStore implements CacheStore {
  constructor(private readonly db: Db) {}

  async get(cacheKey: string): Promise<CacheEntry | null> {
    const rows = await this.db.select().from(rawCache).where(eq(rawCache.cacheKey, cacheKey)).limit(1);
    const row = rows[0];
    if (row === undefined) return null;

    return {
      source: row.source as SourceId,
      cacheKey: row.cacheKey,
      payload: new Uint8Array(row.payload as Buffer),
      etag: row.etag,
      fetchedAt: Date.parse(row.fetchedAt),
      expiresAt: Date.parse(row.expiresAt),
    };
  }

  async set(entry: CacheEntry): Promise<void> {
    const values = {
      source: entry.source,
      cacheKey: entry.cacheKey,
      payload: Buffer.from(entry.payload),
      etag: entry.etag,
      fetchedAt: new Date(entry.fetchedAt).toISOString(),
      expiresAt: new Date(entry.expiresAt).toISOString(),
    };

    await this.db
      .insert(rawCache)
      .values(values)
      .onConflictDoUpdate({ target: rawCache.cacheKey, set: values });
  }

  async delete(cacheKey: string): Promise<void> {
    await this.db.delete(rawCache).where(eq(rawCache.cacheKey, cacheKey));
    await this.db.delete(fetchLog).where(eq(fetchLog.cacheKey, cacheKey));
  }

  async getLog(cacheKey: string): Promise<FetchLogEntry | null> {
    const rows = await this.db.select().from(fetchLog).where(eq(fetchLog.cacheKey, cacheKey)).limit(1);
    const row = rows[0];
    if (row === undefined) return null;

    return {
      source: row.source as SourceId,
      cacheKey: row.cacheKey,
      status: row.status as FetchStatus,
      errorKind: row.errorKind as ErrorKind | null,
      attemptedAt: Date.parse(row.attemptedAt),
      revalidateAfter: row.revalidateAfter === null ? null : Date.parse(row.revalidateAfter),
    };
  }

  async putLog(entry: FetchLogEntry): Promise<void> {
    const values = {
      source: entry.source,
      cacheKey: entry.cacheKey,
      status: entry.status,
      errorKind: entry.errorKind,
      attemptedAt: new Date(entry.attemptedAt).toISOString(),
      revalidateAfter:
        entry.revalidateAfter === null ? null : new Date(entry.revalidateAfter).toISOString(),
    };

    await this.db
      .insert(fetchLog)
      .values(values)
      .onConflictDoUpdate({ target: fetchLog.cacheKey, set: values });
  }
}
