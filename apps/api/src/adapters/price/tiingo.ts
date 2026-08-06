import { z } from 'zod';
import { CacheLayer, TTL_MS, buildCacheKey } from '../../core/cache.js';
import { SourceError } from '../../core/errors.js';
import { SourceClient } from '../../core/http.js';
import type { RequestQueue } from '../../core/queue.js';
import { pickCloses, type PriceAdapter, type PricePoint } from './types.js';

/**
 * Tiingo — 미국 주가.
 *
 * 한 번의 호출로 전체 히스토리(30년+)가 온다. 기업당 1회면 끝이다.
 *
 * ⚠️ 무료 티어는 "Internal Use Only" 다. 공개 배포하려면 Power 플랜이 필요하다
 * (docs/00-data-sources.md 3.4). 가족 전용 배포도 엄밀히는 무료 티어 범위 밖이므로,
 * 공개 시점에 라이선스를 정리해야 한다.
 *
 * `adjClose` 는 분할·배당 조정가, `close` 는 실거래가다.
 * PER 계산 기준을 EPS(각 시점 공시값)와 맞추려면 **미조정 close** 를 쓴다.
 */

const BASE_URL = 'https://api.tiingo.com/tiingo/daily';

const TiingoRowSchema = z.object({
  date: z.string(),
  close: z.number(),
  adjClose: z.number().optional(),
});

export interface TiingoPriceAdapterOptions {
  apiKey: string;
  queue: RequestQueue;
  cache: CacheLayer;
  fetchImpl?: typeof globalThis.fetch;
}

export class TiingoPriceAdapter implements PriceAdapter {
  readonly source = 'TIINGO' as const;
  /** 미조정 close 를 쓴다. EPS 가 각 시점 공시값이라 기준을 맞춘다 */
  readonly isSplitAdjusted = false;

  private readonly client: SourceClient;
  private readonly apiKey: string;

  constructor(options: TiingoPriceAdapterOptions) {
    if (options.apiKey.trim() === '') {
      throw new Error('TIINGO_API_KEY 가 비어 있습니다');
    }
    this.apiKey = options.apiKey;
    this.client = new SourceClient({
      source: 'TIINGO',
      queue: options.queue,
      cache: options.cache,
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    });
  }

  async fetchCloses(ticker: string, dates: readonly string[]): Promise<PricePoint[]> {
    if (dates.length === 0) return [];

    const sorted = [...dates].sort();
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (first === undefined || last === undefined) return [];

    // 기말이 휴장이면 직전 거래일로 거슬러야 하므로 앞을 넉넉히 잡는다
    const start = `${Number(first.slice(0, 4)) - 1}-01-01`;
    const params = { ticker: ticker.toLowerCase(), start, end: last };

    const result = await this.client.get({
      // 키를 캐시 키에 넣지 않는다 — DB 에 문자열로 남으면 안 된다
      url: `${BASE_URL}/${ticker}/prices?startDate=${start}&endDate=${last}&token=${this.apiKey}`,
      cacheKey: buildCacheKey('TIINGO', 'prices', params),
      ttlMs: TTL_MS.MARKET,
      parse: (bytes) => {
        let json: unknown;
        try {
          json = JSON.parse(new TextDecoder().decode(bytes));
        } catch (cause) {
          throw new SourceError('TIINGO', 'PARSE', `${ticker}: JSON 파싱 실패`, { cause });
        }

        const parsed = z.array(TiingoRowSchema).safeParse(json);
        if (!parsed.success) {
          throw new SourceError('TIINGO', 'PARSE', `${ticker}: 응답 스키마 불일치`);
        }
        if (parsed.data.length === 0) {
          throw new SourceError('TIINGO', 'NOT_FOUND', `주가 데이터가 없습니다: ${ticker}`);
        }

        return parsed.data.map((row) => ({
          // Tiingo 는 ISO 8601 타임스탬프로 준다
          date: row.date.slice(0, 10),
          close: row.close,
          currency: 'USD' as const,
        }));
      },
    });

    return result === null ? [] : pickCloses(result.value, sorted);
  }
}
