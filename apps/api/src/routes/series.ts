import {
  ABSOLUTE_EARLIEST_YEAR,
  MAX_COMPANIES,
  MAX_METRICS,
  MetricIdSchema,
} from '@fincompare/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { DartClient } from '../adapters/dart/client.js';
import type { SecClient } from '../adapters/sec/client.js';
import type { FxClient } from '../adapters/fx/ecb.js';
import type { PriceAdapter } from '../adapters/price/types.js';
import type { ConsensusAdapter } from '../adapters/consensus/types.js';
import type { Db } from '../db/client.js';
import { buildSeries } from '../services/series.js';
import type { KrConsensusEntry } from '../services/krConsensusFile.js';

const CURRENT_YEAR = new Date().getUTCFullYear();
/**
 * 요청 가능한 최소 연도. 소스별 실제 하한은 다르다 (DART 2015, SEC 2009).
 * 여기서는 가장 이른 쪽으로 열어 두고, 데이터가 없는 구간은 자연스럽게 결측이 된다.
 */
const EARLIEST_YEAR = ABSOLUTE_EARLIEST_YEAR;

const csv = (value: string): string[] =>
  value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');

const SeriesQuerySchema = z
  .object({
    companies: z
      .string()
      .transform(csv)
      .pipe(
        z
          .array(z.string())
          .min(1, '기업을 하나 이상 선택하세요')
          .max(MAX_COMPANIES, `기업은 최대 ${MAX_COMPANIES}개까지 비교할 수 있습니다`),
      ),
    metrics: z
      .string()
      .transform(csv)
      .pipe(
        z
          .array(MetricIdSchema)
          .min(1, '지표를 하나 이상 선택하세요')
          .max(MAX_METRICS, `지표는 최대 ${MAX_METRICS}개까지 선택할 수 있습니다`),
      ),
    from: z.coerce.number().int().min(EARLIEST_YEAR).max(CURRENT_YEAR).default(EARLIEST_YEAR),
    to: z.coerce.number().int().min(EARLIEST_YEAR).max(CURRENT_YEAR).default(CURRENT_YEAR),
    normalize: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    // native = 각 기업의 보고 통화 그대로. 국내만 비교할 때는 환산이 불필요하다.
    currency: z.enum(['KRW', 'USD', 'native']).default('native'),
    /*
     * 기본값이 true 인 이유: 이 도구는 장기 추이를 보는 물건이다.
     * 조정하지 않으면 분할 지점에서 선이 끊겨 추이 자체를 읽을 수 없고,
     * 그게 원래 사용자가 하려던 일이다. PER·PBR 은 어느 쪽이든 같다.
     * 각 시점 공시값이 필요하면 끄면 된다 — 화면에 기준을 함께 표시한다.
     */
    adjustSplits: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    /*
     * 목표주가 밴드. 기본은 꺼짐이다.
     * 무료 티어가 하루 250 콜이라, 보겠다고 한 적 없는 조회에서 태우면 안 된다.
     */
    consensus: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    /** 축 단위. 분기는 조회한 기업만 그때그때 받는다 */
    periodType: z.enum(['FY', 'Q']).default('FY'),
  })
  .refine((v) => v.from <= v.to, {
    message: '시작 연도가 종료 연도보다 늦습니다',
    path: ['from'],
  });

export interface SeriesRouterDeps {
  db: Db;
  dart: DartClient;
  sec: SecClient;
  fx: FxClient;
  krPrice: PriceAdapter | null;
  usPrice: PriceAdapter | null;
  /** 목표주가 제공처. 키가 없으면 null 이고 기능이 꺼진다 */
  consensusAdapter: ConsensusAdapter | null;
  /** 국내 컨센서스 직접 조사 기록. 없으면 빈 배열 */
  krResearch: readonly KrConsensusEntry[];
}

export function createSeriesRouter(deps: SeriesRouterDeps): Router {
  const router = Router();

  router.get('/', (req, res, next) => {
    const parsed = SeriesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: 'INVALID_QUERY',
        detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
      return;
    }

    // 중복 요청은 색상 배정을 어긋나게 하므로 여기서 제거한다
    const companyIds = [...new Set(parsed.data.companies)];
    const metrics = [...new Set(parsed.data.metrics)];

    buildSeries(
      deps,
      {
        companyIds,
        metrics,
        fromYear: parsed.data.from,
        toYear: parsed.data.to,
        normalize: parsed.data.normalize,
        currency: parsed.data.currency,
        adjustSplits: parsed.data.adjustSplits,
        consensus: parsed.data.consensus,
        periodType: parsed.data.periodType,
      },
    )
      .then((result) => {
        if (result.companies.length === 0) {
          res.status(404).json({ error: 'NO_COMPANIES', message: '요청한 기업을 찾을 수 없습니다' });
          return;
        }
        res.json(result);
      })
      .catch(next);
  });

  return router;
}
