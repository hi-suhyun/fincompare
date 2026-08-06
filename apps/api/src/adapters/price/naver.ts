import { CacheLayer, TTL_MS, buildCacheKey } from '../../core/cache.js';
import { SourceError } from '../../core/errors.js';
import { SourceClient } from '../../core/http.js';
import type { RequestQueue } from '../../core/queue.js';
import { pickCloses, type PriceAdapter, type PricePoint } from './types.js';

/**
 * 네이버 금융 주가 — 비공식 엔드포인트.
 *
 * ⚠️ 문서화되지 않은 엔드포인트다. 예고 없이 막힐 수 있고 이용 근거가 없다.
 * KRX Open API 승인 전까지의 개발용 폴백이다 (PRICE_PROVIDER_KR=naver).
 * 공개 배포한다면 KRX 로 전환해야 한다.
 *
 * 장점: 10년치 월봉이 한 번의 호출로 온다.
 * 주의: **수정주가**다. 액면분할이 소급 반영되어 있어 미조정 EPS 와 직접 나누면 안 된다.
 */

const BASE_URL = 'https://api.finance.naver.com/siseJson.naver';

/** 봇으로 보이지 않게. 비공식 엔드포인트라 최소한의 예의를 지킨다 */
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export interface NaverPriceAdapterOptions {
  queue: RequestQueue;
  cache: CacheLayer;
  fetchImpl?: typeof globalThis.fetch;
}

/**
 * 응답이 JSON 이 아니라 **JavaScript 배열 리터럴**이다. 작은따옴표를 쓴다:
 *
 *   [['날짜', '시가', ...],
 *   ["20240102", 78200, 79800, 78200, 79600, 17142847, 54.05],
 *
 * eval 하지 않고 직접 파싱한다 — 외부 문자열을 실행하면 안 된다.
 */
export function parseNaverSiseJson(raw: string): PricePoint[] {
  const out: PricePoint[] = [];

  // ["20240102", 78200, 79800, 78200, 79600, ...] 형태의 행만 뽑는다.
  // 헤더 행은 날짜 자리가 '날짜' 라 정규식에 걸리지 않는다.
  const rowPattern = /\[\s*["'](\d{8})["']\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/g;

  for (const match of raw.matchAll(rowPattern)) {
    const [, yyyymmdd, , , , close] = match;
    if (yyyymmdd === undefined || close === undefined) continue;

    const value = Number(close);
    if (!Number.isFinite(value) || value <= 0) continue;

    out.push({
      date: `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`,
      close: value,
      currency: 'KRW',
    });
  }

  return out;
}

export class NaverPriceAdapter implements PriceAdapter {
  readonly source = 'NAVER' as const;
  /** 네이버는 수정주가를 준다. 삼성전자 2017년 종가가 50,960원으로 온다(실제 2,548,000원) */
  readonly isSplitAdjusted = true;

  private readonly client: SourceClient;

  constructor(options: NaverPriceAdapterOptions) {
    this.client = new SourceClient({
      source: 'NAVER',
      queue: options.queue,
      cache: options.cache,
      defaultHeaders: { 'User-Agent': BROWSER_UA, Referer: 'https://finance.naver.com/' },
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    });
  }

  async fetchCloses(stockCode: string, dates: readonly string[]): Promise<PricePoint[]> {
    if (dates.length === 0) return [];

    const sorted = [...dates].sort();
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (first === undefined || last === undefined) return [];

    // 요청 구간보다 앞을 넉넉히 잡는다. 기말이 휴장이면 직전 거래일로 거슬러야 한다.
    const startTime = `${first.slice(0, 4)}0101`.replace(/-/g, '');
    const endTime = last.replace(/-/g, '');
    const params = { symbol: stockCode, start: startTime, end: endTime };

    const result = await this.client.get({
      url:
        `${BASE_URL}?symbol=${stockCode}&requestType=1` +
        `&startTime=${startTime}&endTime=${endTime}&timeframe=day`,
      cacheKey: buildCacheKey('NAVER', 'siseJson', params),
      ttlMs: TTL_MS.MARKET,
      parse: (bytes) => {
        const text = new TextDecoder().decode(bytes);
        const series = parseNaverSiseJson(text);
        if (series.length === 0) {
          throw new SourceError('NAVER', 'NOT_FOUND', `주가 데이터가 없습니다: ${stockCode}`);
        }
        return series;
      },
    });

    return result === null ? [] : pickCloses(result.value, sorted);
  }
}
