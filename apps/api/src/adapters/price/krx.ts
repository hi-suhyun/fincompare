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
  /** 종목코드 6자리 */
  ISU_CD: z.string(),
  ISU_NM: z.string().optional(),
  /** 종가. 미조정 실거래가다 (2017-12-28 삼성전자 = 2,548,000) */
  TDD_CLSPRC: z.string(),
  /** 시가총액. 우리가 주가×주식수로 계산할 필요 없이 그대로 온다 */
  MKTCAP: z.string().optional(),
  /** 상장주식수 */
  LIST_SHRS: z.string().optional(),
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

/** 하루치 전 종목 시세 한 줄 */
export interface KrxDailyRow {
  stockCode: string;
  date: string;
  close: number;
  /** 시가총액. KRX 가 계산해서 주므로 우리가 주가×주식수 하지 않는다 */
  marketCap: number | null;
  listedShares: number | null;
}

const DAY_MS = 86_400_000;

/**
 * 직전 거래일을 찾을 때 최대로 거슬러 올라갈 일수.
 * 설·추석 연휴가 가장 길어야 5일 남짓이라 10일이면 충분하다.
 * 캐시가 있으니 한 번 찾은 날짜는 다시 호출하지 않는다.
 */
const MAX_LOOKBACK_DAYS = 10;

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
      const hit = await this.findOnOrBefore(endpoint, date, stockCode);
      if (hit === null) continue;
      out.push({ date, close: hit, currency: 'KRW' });
    }

    return out;
  }

  /**
   * 해당 날짜에 거래가 없으면 직전 거래일로 거슬러 올라간다.
   *
   * 회계연도 기말은 대개 12월 31일인데 그날은 늘 휴장이다.
   * 게다가 연말 마지막 거래일이 해마다 다르다 — 2016년은 12/29, 2015·2024년은 12/30.
   * 하루만 빼는 고정 규칙으로는 맞출 수 없다.
   */
  private async findOnOrBefore(
    endpoint: string,
    date: string,
    stockCode: string,
  ): Promise<number | null> {
    let cursor = Date.parse(`${date}T00:00:00Z`);

    for (let attempt = 0; attempt < MAX_LOOKBACK_DAYS; attempt++) {
      const basDd = new Date(cursor).toISOString().slice(0, 10).replace(/-/g, '');
      const rows = await this.fetchDay(endpoint, basDd);

      if (rows.length > 0) {
        const hit = rows.find((r) => r.ISU_CD === stockCode || r.ISU_CD.endsWith(stockCode));
        if (hit === undefined) return null; // 거래는 있었는데 그 종목이 없다 = 미상장

        const close = Number(hit.TDD_CLSPRC.replace(/,/g, ''));
        return Number.isFinite(close) && close > 0 ? close : null;
      }

      cursor -= DAY_MS;
    }

    return null;
  }

  /**
   * 하루치 전 종목 시세를 통째로 받는다.
   *
   * 백필용이다. KRX 는 한 번 호출에 그 날 상장된 모든 종목이 오므로,
   * 종목별로 부르면 2,600배를 낭비하게 된다. 연말 10개 날짜만 받으면
   * 전 종목 10년치가 20번 호출(시장 2개 × 10년)로 채워진다.
   *
   * 휴장일이면 빈 배열이 온다 — 호출한 쪽에서 직전 거래일로 거슬러야 한다.
   */
  async fetchMarketDay(market: KrxMarket, date: string): Promise<KrxDailyRow[]> {
    const rows = await this.fetchDay(ENDPOINT_BY_MARKET[market], date.replace(/-/g, ''));

    const out: KrxDailyRow[] = [];
    for (const row of rows) {
      const close = Number(row.TDD_CLSPRC.replace(/,/g, ''));
      if (!Number.isFinite(close) || close <= 0) continue;

      const marketCap = row.MKTCAP === undefined ? null : Number(row.MKTCAP.replace(/,/g, ''));
      const shares = row.LIST_SHRS === undefined ? null : Number(row.LIST_SHRS.replace(/,/g, ''));

      out.push({
        stockCode: row.ISU_CD.trim(),
        date: `${row.BAS_DD.slice(0, 4)}-${row.BAS_DD.slice(4, 6)}-${row.BAS_DD.slice(6, 8)}`,
        close,
        marketCap: marketCap !== null && Number.isFinite(marketCap) ? marketCap : null,
        listedShares: shares !== null && Number.isFinite(shares) ? shares : null,
      });
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
