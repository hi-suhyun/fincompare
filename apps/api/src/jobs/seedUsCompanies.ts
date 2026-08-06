import { normalizeForSearch, toChosung } from '@fincompare/shared';
import { sql } from 'drizzle-orm';
import type { SecClient } from '../adapters/sec/client.js';
import { isForeignIssuer } from '../adapters/sec/financials.js';
import { marketFromExchange, padCik, parseFiscalYearEndMonth } from '../adapters/sec/schema.js';
import { SourceError } from '../core/errors.js';
import { US_ALIAS_BY_TICKER, koreanNameFor, usProminenceFor } from '../data/usAliases.js';
import type { Db } from '../db/client.js';
import { companies, companyAliases } from '../db/schema.js';
import type { AliasRow } from '../services/companySeed.js';

/**
 * 미국 기업 마스터 시딩.
 *
 * company_tickers.json 에는 약 10,000개 항목이 있고 ADR·비상장·소형주가 다 섞여 있다.
 * 전부에 대해 submissions 를 부르면 10,000회 호출이라 시간이 오래 걸린다.
 *
 * 1차 범위는 "10-K 를 내는 미국 기업"이므로, 한글 별칭 목록에 있는 종목을 우선 시딩하고
 * 나머지는 사용자가 실제로 검색·선택할 때 지연 시딩한다.
 * 할아버지가 비교하실 종목은 대부분 별칭 목록 안에 있다.
 */

export interface UsSeedResult {
  totalTickers: number;
  /** 시딩 대상으로 고른 수 */
  targeted: number;
  inserted: number;
  /** 20-F / 40-F 제출자 (ADR) */
  skippedAdr: number;
  /** NYSE·NASDAQ 이 아닌 곳 */
  skippedExchange: number;
  failed: number;
  aliasCount: number;
}

export interface UsSeedOptions {
  onProgress?: (done: number, total: number, message?: string) => void;
  /**
   * 별칭 목록 밖의 종목까지 시딩할지.
   * 기본은 별칭 목록만 — 전체는 약 10,000회 호출이 든다.
   */
  includeAll?: boolean;
  limit?: number;
}

export async function seedUsCompanies(
  db: Db,
  sec: SecClient,
  options: UsSeedOptions = {},
): Promise<UsSeedResult> {
  const tickers = await sec.fetchTickers();
  if (tickers === null) throw new Error('company_tickers.json 을 받지 못했습니다');

  const entries = Object.values(tickers);

  const wanted =
    options.includeAll === true
      ? entries
      : entries.filter((e) => US_ALIAS_BY_TICKER.has(e.ticker.toUpperCase()));

  const targets = options.limit === undefined ? wanted : wanted.slice(0, options.limit);

  options.onProgress?.(0, targets.length, `대상 ${targets.length}개 / 전체 ${entries.length}개`);

  const companyRows: Array<typeof companies.$inferInsert> = [];
  const aliasRows: AliasRow[] = [];
  let skippedAdr = 0;
  let skippedExchange = 0;
  let failed = 0;

  const CHUNK = 20;
  const updatedAt = new Date().toISOString();

  for (let offset = 0; offset < targets.length; offset += CHUNK) {
    const chunk = targets.slice(offset, offset + CHUNK);

    const results = await Promise.allSettled(
      chunk.map(async (entry) => ({ entry, submissions: await sec.fetchSubmissions(entry.cik_str) })),
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        if (result.reason instanceof SourceError && result.reason.kind === 'QUOTA_EXCEEDED') {
          options.onProgress?.(offset, targets.length, '호출 한도 소진 — 여기까지 저장합니다');
          offset = targets.length;
          break;
        }
        failed += 1;
        continue;
      }

      const { entry, submissions } = result.value;
      if (submissions === null) {
        failed += 1;
        continue;
      }

      // ADR·외국사기업은 20-F/40-F 를 낸다. US GAAP 태그가 달라 1차 범위에서 제외한다.
      if (isForeignIssuer(submissions.filings?.recent?.form)) {
        skippedAdr += 1;
        continue;
      }

      const market = marketFromExchange(submissions.exchanges);
      if (market === null) {
        skippedExchange += 1;
        continue;
      }

      const ticker = entry.ticker.toUpperCase();
      const id = `US:${ticker}`;
      const nameKo = koreanNameFor(ticker);

      companyRows.push({
        id,
        country: 'US',
        market,
        nameKo,
        nameEn: entry.title,
        corpCode: null,
        stockCode: null,
        cik: padCik(entry.cik_str),
        ticker,
        fiscalYearEndMonth: parseFiscalYearEndMonth(submissions.fiscalYearEnd),
        isAdr: false,
        isSupported: true,
        prominence: usProminenceFor(ticker),
        updatedAt,
      });

      aliasRows.push(...buildUsAliases(id, ticker, entry.title));
    }

    options.onProgress?.(Math.min(offset + CHUNK, targets.length), targets.length);
  }

  await writeUsCompanies(db, companyRows, aliasRows);

  return {
    totalTickers: entries.length,
    targeted: targets.length,
    inserted: companyRows.length,
    skippedAdr,
    skippedExchange,
    failed,
    aliasCount: aliasRows.length,
  };
}

export function buildUsAliases(companyId: string, ticker: string, englishName: string): AliasRow[] {
  const rows = new Map<string, AliasRow>();

  const add = (raw: string, aliasType: AliasRow['aliasType']): void => {
    const alias = normalizeForSearch(raw);
    if (alias === '' || rows.has(alias)) return;
    rows.set(alias, {
      companyId,
      alias,
      chosung: /[가-힣]/.test(raw) ? toChosung(alias) : null,
      aliasType,
    });
  };

  add(ticker, 'TICKER');
  add(englishName, 'EN_SHORT');
  for (const korean of US_ALIAS_BY_TICKER.get(ticker.toUpperCase())?.korean ?? []) {
    add(korean, 'KO_COMMON');
  }

  return [...rows.values()];
}

const BATCH = 200;

async function writeUsCompanies(
  db: Db,
  companyRows: readonly (typeof companies.$inferInsert)[],
  aliasRows: readonly AliasRow[],
): Promise<void> {
  for (let i = 0; i < companyRows.length; i += BATCH) {
    await db
      .insert(companies)
      .values(companyRows.slice(i, i + BATCH))
      .onConflictDoUpdate({
        target: companies.id,
        set: {
          market: sql`excluded.market`,
          nameKo: sql`excluded.name_ko`,
          nameEn: sql`excluded.name_en`,
          cik: sql`excluded.cik`,
          ticker: sql`excluded.ticker`,
          fiscalYearEndMonth: sql`excluded.fiscal_year_end_month`,
          isAdr: sql`excluded.is_adr`,
          isSupported: sql`excluded.is_supported`,
          prominence: sql`excluded.prominence`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }

  for (let i = 0; i < aliasRows.length; i += BATCH) {
    await db
      .insert(companyAliases)
      .values(aliasRows.slice(i, i + BATCH))
      .onConflictDoNothing();
  }
}
