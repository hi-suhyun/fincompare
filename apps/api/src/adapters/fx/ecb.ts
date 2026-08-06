import { z } from 'zod';
import { CacheLayer, TTL_MS, buildCacheKey } from '../../core/cache.js';
import { SourceError } from '../../core/errors.js';
import { SourceClient } from '../../core/http.js';
import type { RequestQueue } from '../../core/queue.js';

/**
 * 환율 — Frankfurter (ECB 기준환율).
 *
 * 무료이고 API 키가 필요 없다 (실측 확인). 1999년부터 제공한다.
 * exchangerate.host 는 유료화되어 키 없이는 쓸 수 없다.
 *
 * 주의: ECB 는 영업일에만 고시한다. 주말·공휴일은 행이 아예 없으므로
 * 조회할 때 직전 영업일 값으로 채워야 한다.
 */

const BASE_URL = 'https://api.frankfurter.dev/v1';

const FrankfurterRangeSchema = z.object({
  base: z.string(),
  start_date: z.string(),
  end_date: z.string(),
  rates: z.record(z.string(), z.record(z.string(), z.number())),
});

export interface FxClientOptions {
  queue: RequestQueue;
  cache: CacheLayer;
  fetchImpl?: typeof globalThis.fetch;
}

export interface FxRate {
  date: string;
  rate: number;
}

export class FxClient {
  private readonly client: SourceClient;

  constructor(options: FxClientOptions) {
    this.client = new SourceClient({
      source: 'ECB',
      queue: options.queue,
      cache: options.cache,
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    });
  }

  /** 기간 환율. 영업일만 돌아온다 — 주말·공휴일은 행이 없다 */
  async fetchRange(base: string, quote: string, from: string, to: string): Promise<FxRate[]> {
    const params = { base, quote, from, to };

    const result = await this.client.get({
      url: `${BASE_URL}/${from}..${to}?base=${base}&symbols=${quote}`,
      cacheKey: buildCacheKey('ECB', 'range', params),
      ttlMs: TTL_MS.MARKET,
      parse: (bytes) => {
        let json: unknown;
        try {
          json = JSON.parse(new TextDecoder().decode(bytes));
        } catch (cause) {
          throw new SourceError('ECB', 'PARSE', '환율 응답 JSON 파싱 실패', { cause });
        }

        const parsed = FrankfurterRangeSchema.safeParse(json);
        if (!parsed.success) {
          throw new SourceError('ECB', 'PARSE', '환율 응답 스키마 불일치');
        }

        return Object.entries(parsed.data.rates)
          .map(([date, rates]) => ({ date, rate: rates[quote] }))
          .filter((r): r is FxRate => r.rate !== undefined)
          .sort((a, b) => (a.date < b.date ? -1 : 1));
      },
    });

    return result?.value ?? [];
  }
}

/**
 * 환율 조회기.
 *
 * ECB 는 영업일만 고시하므로, 찾는 날짜에 값이 없으면 **직전 영업일**로 거슬러 올라간다.
 * 앞으로 당겨오면(다음 영업일) 아직 일어나지 않은 환율을 쓰는 셈이 된다.
 */
export class FxTable {
  private readonly sorted: readonly FxRate[];

  constructor(rates: readonly FxRate[]) {
    this.sorted = [...rates].sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  get isEmpty(): boolean {
    return this.sorted.length === 0;
  }

  /** 해당 시점 환율. 없으면 직전 영업일 값. 그마저 없으면 null */
  at(date: string): number | null {
    let best: number | null = null;
    for (const row of this.sorted) {
      if (row.date > date) break;
      best = row.rate;
    }
    return best;
  }

  /**
   * 기간 평균 환율. 손익(flow) 항목 환산에 쓴다.
   * 매출을 기말 환율로 환산하면 한 해 내내 그 환율이었던 것처럼 왜곡된다.
   */
  average(start: string, end: string): number | null {
    const inRange = this.sorted.filter((r) => r.date >= start && r.date <= end);
    if (inRange.length === 0) return this.at(end);
    const sum = inRange.reduce((acc, r) => acc + r.rate, 0);
    return sum / inRange.length;
  }
}
