import { z } from 'zod';
import { CacheLayer, TTL_MS, buildCacheKey } from '../../core/cache.js';
import { SourceError } from '../../core/errors.js';
import { SourceClient } from '../../core/http.js';
import type { RequestQueue } from '../../core/queue.js';
import type { PriceAdapter, PricePoint } from './types.js';

/**
 * KRX Open API 주가 — 공식 소스.
 *
 * 네이버와 달리 **미조정 실거래 종가**를 준다. 그 날 실제로 체결된 가격이다.
 * 액면분할 조정 문제가 없으므로 PER 계산이 깔끔하다.
 *
 * 호출 구조가 특이하다: `basDd`(하루)를 주면 **그날 전 종목**이 온다.
 * 종목별로 부르는 게 아니라 날짜별로 부르고 필요한 종목을 골라낸다.
 * 분기말 44개 날짜 × 2개 시장 = 88회면 전 종목 11년치가 끝난다.
 *
 * ⚠️ 키 발급과 별개로 「서비스이용 > 주식」에서 서비스별 API 이용신청이
 * 승인돼야 한다. 미승인 상태에서는 모든 엔드포인트가 401 을 준다.
 */

const BASE_URL = 'https://data-dbg.krx.co.kr/svc/apis/sto';

const KrxRowSchema = z.object({
  BAS_DD: z.string(),
  ISU_CD: z.string(),
  ISU_NM: z.string().optional(),
  /** 종가. 콤마가 섞여 온다 */
  TDD_CLSPRC: z.string(),
});

const KrxResponseSchema = z.object({
  OutBlock_1: z.array(KrxRowSchema).optional(),
});

export interface KrxPriceAdapterOptions {
  authKey: string;
  queue: RequestQueue;
  cache: CacheLayer;
  fetchImpl?: typeof globalThis.fetch;
}

/** 'KOSPI' 와 'KOSDAQ' 은 엔드포인트가 다르다 */
const ENDPOINT_BY_MARKET = {
  KOSPI: 'stk_bydd_trd',
  KOSDAQ: 'ksq_bydd_trd',
} as const;

export type KrxMarket = keyof typeof ENDPOINT_BY_MARKET;

export class KrxPriceAdapter implements PriceAdapter {
  readonly source = 'KRX' as const;
  /** 실거래 종가. 분할 소급 조정이 없다 */
  readonly isSplitAdjusted = false;

  private readonly client: SourceClient;

  constructor(options: KrxPriceAdapterOptions) {
    if (options.authKey.trim() === '') {
      throw new Error('KRX_AUTH_KEY 가 비어 있습니다');
    }

    this.client = new SourceClient({
      source: 'KRX',
      queue: options.queue,
      cache: options.cache,
      defaultHeaders: { AUTH_KEY: options.authKey },
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    });
  }

  /**
   * `identifier` 는 `{market}:{stockCode}` 형식이다.
   * 시장별로 엔드포인트가 다르고, 종목코드만으로는 어느 쪽인지 알 수 없다.
   */
  async fetchCloses(identifier: string, dates: readonly string[]): Promise<PricePoint[]> {
    const [market, stockCode] = identifier.split(':');
    if (market === undefined || stockCode === undefined) {
      throw new Error(`KRX 식별자는 '{market}:{stockCode}' 형식이어야 합니다: ${identifier}`);
    }

    const endpoint = ENDPOINT_BY_MARKET[market as KrxMarket];
    if (endpoint === undefined) {
      throw new Error(`KRX 가 지원하지 않는 시장: ${market}`);
    }

    const out: PricePoint[] = [];

    // 날짜별 호출이라 요청한 날짜만큼 부른다. 한 번의 응답에 전 종목이 들어 있어
    // 여러 기업을 비교할 때도 캐시가 그대로 재사용된다.
    for (const date of dates) {
      const basDd = date.replace(/-/g, '');
      const rows = await this.fetchDay(endpoint, basDd);
      const hit = rows.find((r) => r.ISU_CD === stockCode || r.ISU_CD.endsWith(stockCode));
      if (hit === undefined) continue;

      const close = Number(hit.TDD_CLSPRC.replace(/,/g, ''));
      if (!Number.isFinite(close) || close <= 0) continue;

      out.push({ date, close, currency: 'KRW' });
    }

    return out;
  }

  private async fetchDay(
    endpoint: string,
    basDd: string,
  ): Promise<z.infer<typeof KrxRowSchema>[]> {
    const result = await this.client.get({
      url: `${BASE_URL}/${endpoint}?basDd=${basDd}`,
      cacheKey: buildCacheKey('KRX', endpoint, { basDd }),
      // 지난 거래일 시세는 바뀌지 않는다. 하루짜리 TTL 로 둘 이유가 없다.
      ttlMs: TTL_MS.FINANCIALS,
      parse: (bytes) => {
        let json: unknown;
        try {
          json = JSON.parse(new TextDecoder().decode(bytes));
        } catch (cause) {
          throw new SourceError('KRX', 'PARSE', `${endpoint}: JSON 파싱 실패`, { cause });
        }

        const parsed = KrxResponseSchema.safeParse(json);
        if (!parsed.success) {
          throw new SourceError('KRX', 'PARSE', `${endpoint}: 응답 스키마 불일치`);
        }
        return parsed.data.OutBlock_1 ?? [];
      },
    });

    return result?.value ?? [];
  }
}
