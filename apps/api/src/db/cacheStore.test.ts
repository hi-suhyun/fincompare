import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CacheLayer, TTL_MS } from '../core/cache.js';
import { SqliteCacheStore } from './cacheStore.js';
import { createDb } from './client.js';

/**
 * 인메모리 SQLite 로 실제 마이그레이션을 돌려서 검증한다.
 * 스키마가 실제로 동작하는지(제약, 인덱스, upsert)를 확인하는 게 목적이다.
 */
describe('SqliteCacheStore', () => {
  let handle: ReturnType<typeof createDb>;
  let cache: CacheLayer;

  beforeEach(() => {
    handle = createDb(':memory:');
    cache = new CacheLayer(new SqliteCacheStore(handle.db));
  });

  afterEach(() => {
    handle.close();
  });

  const encode = (s: string): Uint8Array => new TextEncoder().encode(s);
  const decode = (b: Uint8Array): string => new TextDecoder().decode(b);

  it('마이그레이션이 8개 테이블을 만든다', () => {
    const rows = handle.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'")
      .all() as Array<{ name: string }>;

    expect(rows.map((r) => r.name).sort()).toEqual([
      'companies',
      'company_aliases',
      'fetch_log',
      'financial_facts',
      'fx_rates',
      'prices',
      'raw_cache',
      'shares_outstanding',
    ]);
  });

  it('저장한 바이너리를 그대로 돌려준다', async () => {
    await cache.store_({
      source: 'SEC',
      cacheKey: 'SEC:companyfacts:cik=0000320193',
      ttlMs: TTL_MS.FINANCIALS,
      payload: encode('{"entityName":"Apple Inc."}'),
    });

    const result = await cache.lookup('SEC:companyfacts:cik=0000320193', decode);
    expect(result).toMatchObject({ kind: 'HIT', value: '{"entityName":"Apple Inc."}' });
  });

  it('바이너리가 손상되지 않는다 — 3.8MB 응답도 그대로 왕복해야 한다', async () => {
    const payload = new Uint8Array(256);
    for (let i = 0; i < 256; i++) payload[i] = i;

    await cache.store_({ source: 'SEC', cacheKey: 'bin', ttlMs: 1000, payload });

    const result = await cache.lookup('bin', (b) => b);
    expect(result.kind).toBe('HIT');
    if (result.kind === 'HIT') expect(Array.from(result.value)).toEqual(Array.from(payload));
  });

  it('같은 키로 다시 저장하면 덮어쓴다', async () => {
    await cache.store_({ source: 'DART', cacheKey: 'k', ttlMs: 1000, payload: encode('old') });
    await cache.store_({ source: 'DART', cacheKey: 'k', ttlMs: 1000, payload: encode('new') });

    const result = await cache.lookup('k', decode);
    expect(result).toMatchObject({ kind: 'HIT', value: 'new' });

    const count = handle.sqlite.prepare('SELECT COUNT(*) AS c FROM raw_cache').get() as { c: number };
    expect(count.c).toBe(1);
  });

  it('데이터 없음 기록이 DB 를 거쳐서도 유지된다', async () => {
    await cache.markEmpty('DART', 'DART:fnlttSinglAcntAll:corp=00126380&year=2015');

    const result = await cache.lookup('DART:fnlttSinglAcntAll:corp=00126380&year=2015', decode);
    expect(result.kind).toBe('KNOWN_EMPTY');
  });

  it('EMPTY 기록을 성공으로 덮으면 HIT 이 된다', async () => {
    await cache.markEmpty('DART', 'k');
    await cache.store_({ source: 'DART', cacheKey: 'k', ttlMs: 1000, payload: encode('v') });

    expect((await cache.lookup('k', decode)).kind).toBe('HIT');
  });

  it('invalidate 하면 캐시와 로그가 함께 사라진다', async () => {
    await cache.store_({ source: 'SEC', cacheKey: 'k', ttlMs: 1000, payload: encode('v') });
    await cache.invalidate('k');

    expect((await cache.lookup('k', decode)).kind).toBe('MISS');

    const logs = handle.sqlite.prepare('SELECT COUNT(*) AS c FROM fetch_log').get() as { c: number };
    expect(logs.c).toBe(0);
  });

  it('외래키 제약이 켜져 있다 — 없는 기업의 재무데이터가 들어가면 안 된다', () => {
    expect(() =>
      handle.sqlite
        .prepare(
          `INSERT INTO financial_facts
           (company_id, metric_id, period_type, period_end, fiscal_year, aligned_year,
            currency, consolidation, source, source_tag, updated_at)
           VALUES ('KR:없는회사','revenue','FY','2024-12-31',2024,2024,'KRW','CFS','DART','x','2026-08-06')`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY/i);
  });
});
