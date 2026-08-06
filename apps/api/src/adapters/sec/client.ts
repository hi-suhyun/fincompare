import type { z } from 'zod';
import { CacheLayer, TTL_MS, buildCacheKey } from '../../core/cache.js';
import { SourceError } from '../../core/errors.js';
import { SourceClient } from '../../core/http.js';
import type { RequestQueue } from '../../core/queue.js';
import {
  SecCompanyFactsSchema,
  SecSubmissionsSchema,
  SecTickersSchema,
  padCik,
  type SecCompanyFacts,
} from './schema.js';

/**
 * SEC EDGAR 클라이언트.
 *
 * 인증 키는 없지만 **User-Agent 헤더가 필수**다. 없으면 403 이 떨어진다 (실측 확인).
 * 형식은 "{앱이름} {연락처 이메일}".
 *
 * companyfacts 는 기업당 3.8MB 다. 한 번 받으면 그 기업의 전 계정·전 기간이 다 들어 있으므로
 * 기업당 1회 호출 + 캐시가 정답이다.
 */

const DATA_BASE = 'https://data.sec.gov';
const WWW_BASE = 'https://www.sec.gov';

export interface SecClientOptions {
  userAgent: string;
  queue: RequestQueue;
  cache: CacheLayer;
  fetchImpl?: typeof globalThis.fetch;
}

export class SecClient {
  private readonly client: SourceClient;

  constructor(options: SecClientOptions) {
    if (options.userAgent.trim() === '') {
      throw new Error(
        'SEC_USER_AGENT 가 비어 있습니다. SEC 는 User-Agent 없이 호출하면 403 을 돌려줍니다.',
      );
    }

    this.client = new SourceClient({
      source: 'SEC',
      queue: options.queue,
      cache: options.cache,
      defaultHeaders: {
        'User-Agent': options.userAgent,
        'Accept-Encoding': 'gzip, deflate',
      },
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    });
  }

  private async getJson<S extends z.ZodType>(
    url: string,
    cacheKey: string,
    schema: S,
    ttlMs: number,
  ): Promise<z.infer<S> | null> {
    const result = await this.client.get({
      url,
      cacheKey,
      ttlMs,
      parse: (bytes) => {
        let json: unknown;
        try {
          json = JSON.parse(new TextDecoder().decode(bytes));
        } catch (cause) {
          throw new SourceError('SEC', 'PARSE', `JSON 파싱 실패: ${url}`, { cause });
        }

        const parsed = schema.safeParse(json);
        if (!parsed.success) {
          throw new SourceError(
            'SEC',
            'PARSE',
            `응답 스키마 불일치 (${url}) — ${parsed.error.issues
              .slice(0, 3)
              .map((i) => `${i.path.join('.')}: ${i.message}`)
              .join(', ')}`,
          );
        }
        return parsed.data;
      },
    });

    return result === null ? null : (result.value as z.infer<S>);
  }

  /** 기업당 1회. 전 계정·전 기간이 한 응답에 들어 있다 */
  fetchCompanyFacts(cik: string | number): Promise<SecCompanyFacts | null> {
    const padded = padCik(cik);
    return this.getJson(
      `${DATA_BASE}/api/xbrl/companyfacts/CIK${padded}.json`,
      buildCacheKey('SEC', 'companyfacts', { cik: padded }),
      SecCompanyFactsSchema,
      TTL_MS.FINANCIALS,
    );
  }

  /** 거래소·결산월·제출 서식 목록. ADR 판별에 쓴다 */
  fetchSubmissions(cik: string | number): Promise<z.infer<typeof SecSubmissionsSchema> | null> {
    const padded = padCik(cik);
    return this.getJson(
      `${DATA_BASE}/submissions/CIK${padded}.json`,
      buildCacheKey('SEC', 'submissions', { cik: padded }),
      SecSubmissionsSchema,
      TTL_MS.COMPANY_MASTER,
    );
  }

  /** 전체 상장사 티커 목록. 약 800KB */
  fetchTickers(): Promise<z.infer<typeof SecTickersSchema> | null> {
    return this.getJson(
      `${WWW_BASE}/files/company_tickers.json`,
      buildCacheKey('SEC', 'company_tickers', {}),
      SecTickersSchema,
      TTL_MS.COMPANY_MASTER,
    );
  }
}
