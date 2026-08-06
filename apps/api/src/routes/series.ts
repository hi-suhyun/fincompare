import { MAX_COMPANIES, MAX_METRICS, MetricIdSchema } from '@fincompare/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { DartClient } from '../adapters/dart/client.js';
import type { Db } from '../db/client.js';
import { buildSeries } from '../services/series.js';

const CURRENT_YEAR = new Date().getUTCFullYear();
/** DART 는 2015년 이후만 제공한다 */
const EARLIEST_YEAR = 2015;

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
  })
  .refine((v) => v.from <= v.to, {
    message: '시작 연도가 종료 연도보다 늦습니다',
    path: ['from'],
  });

export function createSeriesRouter(db: Db, dart: DartClient): Router {
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
      { db, dart },
      {
        companyIds,
        metrics,
        fromYear: parsed.data.from,
        toYear: parsed.data.to,
        normalize: parsed.data.normalize,
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
