import type { AnalystTarget } from '@fincompare/shared';
import { CacheLayer, TTL_MS, buildCacheKey } from '../../core/cache.js';
import { SourceError } from '../../core/errors.js';
import { SourceClient } from '../../core/http.js';
import type { RequestQueue } from '../../core/queue.js';
import {
  FmpConsensusListSchema,
  FmpErrorSchema,
  FmpPriceTargetListSchema,
} from './schema.js';
import type { ConsensusAdapter, ConsensusResult } from './types.js';

/**
 * Financial Modeling Prep — 애널리스트 목표주가.
 *
 * ⚠️ 약관: FMP 는 데이터를 "제3자가 접근 가능한 도구나 애플리케이션에 통합"하는
 *    것을 금지한다. Tiingo("보여주거나 공유하지 말라")보다 강하다.
 *    따라서 이 데이터는 **로컬·셀프호스트에서 본인만** 볼 수 있고,
 *    가족 배포판에는 키도 데이터도 올리지 않는다.
 *    (docs/00-data-sources.md, scripts/dump-for-deploy.sh 참고)
 *
 * 두 엔드포인트를 쓴다:
 *   price-target            발행일이 붙은 개별 목표가 — "그때의 의견"
 *   price-target-consensus  현재 컨센서스 한 건 — 위가 막혔을 때의 대체재
 *
 * 무료 티어에서 개별 목표가가 막힐 수 있다. 그때는 조용히 비우지 않고
 * historical: false 로 알려서, 화면이 "과거 비교 불가"라고 말할 수 있게 한다.
 */

const BASE_URL = 'https://financialmodelingprep.com/api/v4';

export interface FmpConsensusAdapterOptions {
  apiKey: string;
  queue: RequestQueue;
  cache: CacheLayer;
  fetchImpl?: typeof globalThis.fetch;
}

/** 요금제 밖 요청은 200 + 안내 문구로 온다. 데이터 없음과 구분해야 한다 */
function readErrorMessage(json: unknown): string | null {
  const parsed = FmpErrorSchema.safeParse(json);
  return parsed.success ? parsed.data['Error Message'] : null;
}

function decode(bytes: Uint8Array, what: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (cause) {
    throw new SourceError('FMP', 'PARSE', `${what}: JSON 파싱 실패`, { cause });
  }
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

  async fetchTargets(ticker: string): Promise<ConsensusResult> {
    const symbol = ticker.toUpperCase();

    // 1) 발행일이 붙은 개별 목표가를 먼저 시도한다
    try {
      const targets = await this.fetchHistorical(symbol);
      if (targets.length > 0) return { targets, historical: true };
    } catch (error) {
      // 요금제·권한 문제면 대체재로 내려간다. 그 외(네트워크 등)는 그대로 올린다.
      const recoverable =
        error instanceof SourceError &&
        (error.kind === 'AUTH' || error.kind === 'INVALID_REQUEST' || error.kind === 'NOT_FOUND');
      if (!recoverable) throw error;
    }

    // 2) 현재 컨센서스만이라도 받는다
    const current = await this.fetchCurrent(symbol);
    return {
      targets: current,
      historical: false,
      reason:
        '이 요금제에서는 과거 목표주가를 받을 수 없어 현재 컨센서스만 표시합니다. ' +
        '과거 시점과의 비교는 할 수 없습니다.',
    };
  }

  private async fetchHistorical(symbol: string): Promise<AnalystTarget[]> {
    const result = await this.client.get({
      // 키는 캐시 키에 넣지 않는다 — DB 에 문자열로 남으면 안 된다
      url: `${BASE_URL}/price-target?symbol=${symbol}&apikey=${this.apiKey}`,
      cacheKey: buildCacheKey('FMP', 'price-target', { symbol }),
      ttlMs: TTL_MS.CONSENSUS,
      parse: (bytes) => {
        const json = decode(bytes, symbol);

        const message = readErrorMessage(json);
        if (message !== null) {
          // 권한 문제인지 진짜 오류인지는 문구로만 구분된다
          const kind = /premium|subscription|plan|not available|upgrade/i.test(message)
            ? 'AUTH'
            : 'INVALID_REQUEST';
          throw new SourceError('FMP', kind, `${symbol}: ${message}`);
        }

        const parsed = FmpPriceTargetListSchema.safeParse(json);
        if (!parsed.success) {
          throw new SourceError('FMP', 'PARSE', `${symbol}: 목표주가 응답 스키마 불일치`);
        }

        const targets: AnalystTarget[] = [];
        for (const row of parsed.data) {
          // 목표가나 발행일이 없는 행은 쓸 수 없다. 통째로 버리지 말고 그 행만 건너뛴다.
          if (row.priceTarget === null || row.priceTarget <= 0) continue;
          const publishedAt = row.publishedDate.slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(publishedAt)) continue;

          targets.push({
            companyId: `US:${symbol}`,
            publishedAt,
            priceTarget: row.priceTarget,
            priceWhenPosted: row.priceWhenPosted,
            analystCompany: row.analystCompany ?? row.analystName ?? null,
            currency: 'USD',
          });
        }
        return targets;
      },
    });

    return result === null ? [] : result.value;
  }

  private async fetchCurrent(symbol: string): Promise<AnalystTarget[]> {
    const today = new Date().toISOString().slice(0, 10);

    const result = await this.client.get({
      url: `${BASE_URL}/price-target-consensus?symbol=${symbol}&apikey=${this.apiKey}`,
      cacheKey: buildCacheKey('FMP', 'price-target-consensus', { symbol }),
      ttlMs: TTL_MS.CONSENSUS,
      parse: (bytes) => {
        const json = decode(bytes, symbol);

        const message = readErrorMessage(json);
        if (message !== null) {
          throw new SourceError('FMP', 'AUTH', `${symbol}: ${message}`);
        }

        const parsed = FmpConsensusListSchema.safeParse(json);
        if (!parsed.success) {
          throw new SourceError('FMP', 'PARSE', `${symbol}: 컨센서스 응답 스키마 불일치`);
        }

        const row = parsed.data[0];
        if (row === undefined) return [];

        /*
         * high / consensus / low 를 각각 한 건의 "의견"으로 펼친다.
         * 집계 함수(aggregateByYear)가 개별 목표가 목록을 받게 되어 있어서,
         * 여기서 같은 모양으로 맞춰 주면 아래쪽이 분기를 몰라도 된다.
         */
        const rows: Array<[number | null, string]> = [
          [row.targetHigh, '컨센서스 최고'],
          [row.targetConsensus, '컨센서스 평균'],
          [row.targetLow, '컨센서스 최저'],
        ];

        const targets: AnalystTarget[] = [];
        for (const [value, label] of rows) {
          if (value === null || value <= 0) continue;
          targets.push({
            companyId: `US:${symbol}`,
            publishedAt: today,
            priceTarget: value,
            priceWhenPosted: null,
            analystCompany: label,
            currency: 'USD',
          });
        }
        return targets;
      },
    });

    return result === null ? [] : result.value;
  }
}
