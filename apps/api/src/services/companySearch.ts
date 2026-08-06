import {
  MATCH_RANK,
  isChosungQuery,
  matchKind,
  normalizeForSearch,
  type MatchKind,
} from '@fincompare/shared';
import { inArray, like, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { companies, companyAliases } from '../db/schema.js';

/**
 * 기업 검색.
 *
 * 할아버지가 실제로 칠 법한 입력을 전부 받는다:
 *   삼성전자 / 삼성 / ㅅㅅㅈㅈ / 005930 / samsung
 *
 * SQL 로는 후보를 넉넉히 좁히고, 최종 순위는 애플리케이션에서 정한다.
 * LIKE 순위를 SQL 로 표현하면 읽기 어렵고 방언마다 달라진다.
 */

export interface SearchResult {
  id: string;
  country: string;
  market: string;
  nameKo: string | null;
  nameEn: string | null;
  ticker: string | null;
  stockCode: string | null;
  fiscalYearEndMonth: number;
  isSupported: boolean;
  /** 어떤 표기로 걸렸는지 — UI 에서 매칭된 부분을 강조하는 데 쓴다 */
  matchedOn: MatchKind;
}

interface SearchRow extends Omit<SearchResult, 'matchedOn'> {
  prominence: number;
}

/** SQL LIKE 의 와일드카드를 이스케이프한다 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface SearchOptions {
  limit?: number;
  /** 미지원 기업(ADR 등)도 결과에 포함할지. 기본은 포함하되 뒤로 밀린다 */
  includeUnsupported?: boolean;
}

export async function searchCompanies(
  db: Db,
  query: string,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  const limit = options.limit ?? 10;
  const normalized = normalizeForSearch(query);
  if (normalized === '') return [];

  const pattern = `${escapeLike(normalized)}%`;
  const containsPattern = `%${escapeLike(normalized)}%`;

  // 초성 검색은 전방 일치만 본다. 아무 데나 걸리면 결과가 수백 개로 불어난다.
  const condition = isChosungQuery(normalized)
    ? like(companyAliases.chosung, pattern)
    : or(like(companyAliases.alias, containsPattern), like(companyAliases.chosung, pattern));

  const rows = await db
    .selectDistinct({
      id: companies.id,
      country: companies.country,
      market: companies.market,
      nameKo: companies.nameKo,
      nameEn: companies.nameEn,
      ticker: companies.ticker,
      stockCode: companies.stockCode,
      fiscalYearEndMonth: companies.fiscalYearEndMonth,
      isSupported: companies.isSupported,
      prominence: companies.prominence,
    })
    .from(companyAliases)
    .innerJoin(companies, sql`${companies.id} = ${companyAliases.companyId}`)
    .where(condition)
    // 순위는 아래에서 다시 매기지만, 후보를 자르기 전에 정확 일치가 살아남아야 한다
    .limit(limit * 20);

  // DB 에서 조회한 별칭까지 후보에 넣어야 '현대차' 로 '현대자동차'를 찾을 수 있다
  const aliasesByCompany = await loadAliases(db, rows.map((r) => r.id));

  const scored = (rows as SearchRow[])
    .map((row) => {
      const candidates = [
        row.nameKo,
        row.nameEn,
        row.ticker,
        row.stockCode,
        ...(aliasesByCompany.get(row.id) ?? []),
      ].filter((c): c is string => c !== null);

      const best = candidates.reduce<MatchKind>((acc, candidate) => {
        const kind = matchKind(query, candidate);
        return MATCH_RANK[kind] < MATCH_RANK[acc] ? kind : acc;
      }, 'NONE');

      return { ...row, matchedOn: best };
    })
    .filter((row) => row.matchedOn !== 'NONE')
    .filter((row) => (options.includeUnsupported === false ? row.isSupported : true));

  scored.sort((a, b) => {
    // 1. 지원 기업이 먼저
    if (a.isSupported !== b.isSupported) return a.isSupported ? -1 : 1;
    // 2. 매칭 품질
    const rankDiff = MATCH_RANK[a.matchedOn] - MATCH_RANK[b.matchedOn];
    if (rankDiff !== 0) return rankDiff;
    // 3. 유명주 우선. 'samsung' 을 치면 삼성제약이 아니라 삼성전자가 먼저여야 한다
    const prominenceDiff = b.prominence - a.prominence;
    if (prominenceDiff !== 0) return prominenceDiff;
    // 4. KOSPI 를 KOSDAQ 보다 위로
    const marketDiff = marketWeight(a.market) - marketWeight(b.market);
    if (marketDiff !== 0) return marketDiff;
    // 5. 이름이 짧을수록 위로. '카카오'가 '카카오뱅크'보다 먼저 나와야 한다
    return (a.nameKo?.length ?? 99) - (b.nameKo?.length ?? 99);
  });

  return scored.slice(0, limit).map(({ prominence: _prominence, ...rest }) => rest);
}

/** 후보 기업들의 별칭을 한 번에 읽어온다 */
async function loadAliases(db: Db, companyIds: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (companyIds.length === 0) return out;

  const rows = await db
    .select({ companyId: companyAliases.companyId, alias: companyAliases.alias })
    .from(companyAliases)
    .where(inArray(companyAliases.companyId, [...companyIds]));

  for (const row of rows) {
    const list = out.get(row.companyId);
    if (list === undefined) out.set(row.companyId, [row.alias]);
    else list.push(row.alias);
  }
  return out;
}

function marketWeight(market: string): number {
  switch (market) {
    case 'KOSPI':
      return 0;
    case 'NYSE':
    case 'NASDAQ':
      return 1;
    case 'KOSDAQ':
      return 2;
    default:
      return 3;
  }
}
