import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { searchCompanies } from '../services/companySearch.js';

const SearchQuerySchema = z.object({
  q: z.string().min(1, '검색어가 필요합니다'),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export function createCompaniesRouter(db: Db): Router {
  const router = Router();

  router.get('/search', (req, res, next) => {
    const parsed = SearchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: 'INVALID_QUERY',
        detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
      return;
    }

    searchCompanies(db, parsed.data.q, { limit: parsed.data.limit })
      .then((results) => {
        res.json({
          query: parsed.data.q,
          results: results.map((r) => ({
            id: r.id,
            country: r.country,
            market: r.market,
            nameKo: r.nameKo,
            nameEn: r.nameEn,
            ticker: r.ticker ?? r.stockCode,
            fiscalYearEndMonth: r.fiscalYearEndMonth,
            // 12월 결산이 아니면 UI 가 배지를 단다
            fiscalYearEndBadge: r.fiscalYearEndMonth === 12 ? null : `${r.fiscalYearEndMonth}월 결산`,
            isSupported: r.isSupported,
            matchedOn: r.matchedOn,
          })),
        });
      })
      .catch(next);
  });

  return router;
}
