import type { PriceTargetConsensus } from '@fincompare/shared';
import { CacheLayer, TTL_MS, buildCacheKey } from '../../core/cache.js';
import { SourceError } from '../../core/errors.js';
import { SourceClient } from '../../core/http.js';
import type { RequestQueue } from '../../core/queue.js';
import {
  FmpErrorSchema,
  FmpEstimateListSchema,
  FmpPriceTargetConsensusListSchema,
} from './schema.js';
import type { ConsensusAdapter, ConsensusResult, EstimateRow } from './types.js';

/**
 * Financial Modeling Prep — 애널리스트 컨센서스.
 *
 * ⚠️ 약관: FMP 는 데이터를 "제3자가 접근 가능한 도구나 애플리케이션에 통합"하는
 *    것을 금지한다. Tiingo("보여주거나 공유하지 말라")보다 강하다.
 *    따라서 이 데이터는 **로컬·셀프호스트에서 본인만** 볼 수 있고,
 *    가족 배포판에는 키도 데이터도 올리지 않는다.
 *    (docs/00-data-sources.md, scripts/dump-for-deploy.sh 참고)
 *
 * 무료 티어에서 실제로 쓸 수 있는 것 (2026-08 확인):
 *   analyst-estimates       ✅ 10년치 연간 EPS·매출 추정 low/avg/high — 핵심
 *   price-target-consensus  ✅ 현재 컨센서스 한 건
 *   price-target-news       ❌ 402. 발행일이 붙은 개별 목표가는 유료다
 *   /api/v4/price-target    ❌ 403. 2025-08-31 자로 폐지된 레거시
 *
 * 그래서 "그때의 추정이 맞았나"는 목표주가가 아니라 **추정치**로 답한다.
 * 추정치는 회계연도 단위라 우리 연간 축과 그대로 맞물린다.
 */

const BASE_URL = 'https://financialmodelingprep.com/stable';

/** limit 은 무료 티어에서 10 이 상한이다. 넘기면 402 가 온다 */
const MAX_ESTIMATE_YEARS = 10;

export interface FmpConsensusAdapterOptions {
  apiKey: string;
  queue: RequestQueue;
  cache: CacheLayer;
  fetchImpl?: typeof globalThis.fetch;
}

function decode(bytes: Uint8Array, what: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (cause) {
    throw new SourceError('FMP', 'PARSE', `${what}: JSON 파싱 실패`, { cause });
  }
}

/** 요금제 밖 요청은 200 본문에 안내 문구로 오기도 한다. 데이터 없음과 구분해야 한다 */
function throwIfErrorBody(json: unknown, symbol: string): void {
  const parsed = FmpErrorSchema.safeParse(json);
  if (!parsed.success) return;

  const message = 'Error Message' in parsed.data ? parsed.data['Error Message'] : parsed.data.message;
  const kind = /premium|subscription|plan|legacy|upgrade|restricted/i.test(message)
    ? 'AUTH'
    : 'INVALID_REQUEST';
  throw new SourceError('FMP', kind, `${symbol}: ${message}`);
}

export class FmpConsensusAdapter implements ConsensusAdapter {
  readonly source = 'FMP' as const;

  private readonly client: SourceClient;
  private readonly apiKey: string;

  constructor(options: FmpConsensusAdapterOptions) {
    if (options.apiKey.trim() === '') {
      throw new Error('FMP_API_KEY 가 비어 있습니다');
    }
    this.apiKey = options.apiKey;
    this.client = new SourceClient({
      source: 'FMP',
      queue: options.queue,
      cache: options.cache,
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    });
  }

  async fetchConsensus(ticker: string): Promise<ConsensusResult> {
    const symbol = ticker.toUpperCase();

    // 추정치가 핵심이라 먼저 받는다. 목표주가는 없어도 기능이 성립한다.
    const estimates = await this.fetchEstimates(symbol);

    let priceTarget: PriceTargetConsensus | null = null;
    let priceTargetNote: string | undefined;
    try {
      priceTarget = await this.fetchPriceTarget(symbol);
    } catch (error) {
      // 목표주가를 못 받아도 추정치 밴드는 그대로 쓸 수 있다
      priceTargetNote =
        error instanceof SourceError ? `목표주가를 받지 못했습니다: ${error.message}` : undefined;
    }

    return {
      estimates,
      priceTarget,
      ...(priceTargetNote === undefined ? {} : { priceTargetNote }),
    };
  }

  private async fetchEstimates(symbol: string): Promise<EstimateRow[]> {
    const result = await this.client.get({
      // 키는 캐시 키에 넣지 않는다 — DB 에 문자열로 남으면 안 된다
      url:
        `${BASE_URL}/analyst-estimates?symbol=${symbol}&period=annual` +
        `&limit=${MAX_ESTIMATE_YEARS}&apikey=${this.apiKey}`,
      cacheKey: buildCacheKey('FMP', 'analyst-estimates', { symbol }),
      ttlMs: TTL_MS.CONSENSUS,
      parse: (bytes) => {
        const json = decode(bytes, symbol);
        throwIfErrorBody(json, symbol);

        const parsed = FmpEstimateListSchema.safeParse(json);
        if (!parsed.success) {
          throw new SourceError('FMP', 'PARSE', `${symbol}: 추정치 응답 스키마 불일치`);
        }

        const rows: EstimateRow[] = [];
        for (const row of parsed.data) {
          const periodEnd = row.date.slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) continue;

          // 지표별로 한 줄씩 펼친다. 아래쪽이 지표 이름만 보고 처리할 수 있게.
          if (row.epsAvg !== null) {
            rows.push({
              periodEnd,
              metricId: 'eps',
              low: row.epsLow,
              avg: row.epsAvg,
              high: row.epsHigh,
              count: row.numAnalystsEps,
            });
          }
          if (row.revenueAvg !== null) {
            rows.push({
              periodEnd,
              metricId: 'revenue',
              low: row.revenueLow,
              avg: row.revenueAvg,
              high: row.revenueHigh,
              count: row.numAnalystsRevenue,
            });
          }
        }
        return rows;
      },
    });

    return result === null ? [] : result.value;
  }

  private async fetchPriceTarget(symbol: string): Promise<PriceTargetConsensus | null> {
    const result = await this.client.get({
      url: `${BASE_URL}/price-target-consensus?symbol=${symbol}&apikey=${this.apiKey}`,
      cacheKey: buildCacheKey('FMP', 'price-target-consensus', { symbol }),
      ttlMs: TTL_MS.CONSENSUS,
      parse: (bytes) => {
        const json = decode(bytes, symbol);
        throwIfErrorBody(json, symbol);

        const parsed = FmpPriceTargetConsensusListSchema.safeParse(json);
        if (!parsed.success) {
          throw new SourceError('FMP', 'PARSE', `${symbol}: 목표주가 응답 스키마 불일치`);
        }

        const row = parsed.data[0];
        if (row === undefined || row.targetConsensus === null) return null;

        return {
          high: row.targetHigh,
          avg: row.targetConsensus,
          low: row.targetLow,
          currency: 'USD',
        };
      },
    });

    return result === null ? null : result.value;
  }
}
