import { sql } from 'drizzle-orm';
import type { DartClient } from '../adapters/dart/client.js';
import { extractCorpCodeXml, listedOnly, parseCorpCodeXml } from '../adapters/dart/corpCode.js';
import { DartCompanyResponseSchema } from '../adapters/dart/schema.js';
import { SourceError } from '../core/errors.js';
import type { Db } from '../db/client.js';
import { companies, companyAliases } from '../db/schema.js';
import { buildAliasRows, buildCompanyRow, type AliasRow, type CompanyRow } from '../services/companySeed.js';

/**
 * 기업 마스터 시딩.
 *
 * 2단계로 나뉜다:
 *  1. corpCode.xml (1회 호출) — 고유번호 ↔ 종목코드 ↔ 회사명. 약 118,000건 중 상장 4,000건
 *  2. company.json (기업당 1회) — 시장구분(corp_cls)·결산월(acc_mt)
 *
 * 2단계가 필요한 이유: corpCode.xml 에는 시장 구분이 없고, 종목코드가 남아 있어도
 * 상장폐지된 회사가 섞여 있다. corp_cls 로만 현재 상장 여부를 알 수 있다.
 *
 * 약 4,000회 호출이라 일일 한도 안에서 한 번에 끝난다. 캐시가 있으므로 재실행은 공짜다.
 */

export interface SeedProgress {
  phase: 'corpcode' | 'detail' | 'write';
  total: number;
  done: number;
  message?: string;
}

export interface SeedResult {
  /** corpCode.xml 의 전체 항목 수 */
  totalEntries: number;
  /** 종목코드를 가진 항목 수 (상장폐지 포함) */
  withStockCode: number;
  /** 실제로 저장된 현재 상장사 수 */
  inserted: number;
  /** corp_cls 가 Y/K 가 아니라 제외된 수 */
  skippedNotListed: number;
  /** 조회 실패 */
  failed: number;
  aliasCount: number;
}

export interface SeedOptions {
  onProgress?: (progress: SeedProgress) => void;
  /** 테스트·부분 실행용 상한 */
  limit?: number;
}

export async function seedKoreanCompanies(
  db: Db,
  dart: DartClient,
  options: SeedOptions = {},
): Promise<SeedResult> {
  const report = (p: SeedProgress): void => options.onProgress?.(p);

  report({ phase: 'corpcode', total: 1, done: 0, message: 'corpCode.xml 내려받는 중' });

  const zip = await dart.callBinary('corpCode');
  if (zip === null) throw new Error('corpCode.xml 을 받지 못했습니다');

  const entries = parseCorpCodeXml(extractCorpCodeXml(zip));
  const listed = listedOnly(entries);
  const targets = options.limit === undefined ? listed : listed.slice(0, options.limit);

  report({ phase: 'corpcode', total: 1, done: 1, message: `상장 후보 ${listed.length}건` });

  const companyRows: CompanyRow[] = [];
  const aliasRows: AliasRow[] = [];
  let skippedNotListed = 0;
  let failed = 0;

  // 청크 단위로 겹쳐 보낸다. 유량은 큐가 막으므로 여기서는 RTT 를 겹치는 게 목적이다.
  // 순차로 돌리면 왕복 지연이 그대로 쌓여 4,000건에 26분이 걸린다.
  const CHUNK = 100;
  let quotaExhausted = false;

  for (let offset = 0; offset < targets.length && !quotaExhausted; offset += CHUNK) {
    const chunk = targets.slice(offset, offset + CHUNK);

    const results = await Promise.allSettled(
      chunk.map(async (entry) => {
        const detail = await dart.call(
          'company',
          { corp_code: entry.corpCode },
          DartCompanyResponseSchema,
        );
        return { entry, detail };
      }),
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        const error: unknown = result.reason;
        // 일일 한도가 끝나면 더 진행해도 소용없다. 모은 것을 저장하고 멈춘다.
        if (error instanceof SourceError && error.kind === 'QUOTA_EXCEEDED') {
          quotaExhausted = true;
        } else {
          failed += 1;
        }
        continue;
      }

      const { entry, detail } = result.value;
      if (detail === null) {
        skippedNotListed += 1;
        continue;
      }

      const row = buildCompanyRow(entry, detail);
      if (row === null) {
        skippedNotListed += 1;
        continue;
      }

      companyRows.push(row);
      aliasRows.push(...buildAliasRows(row, detail.corp_name ?? entry.corpName));
    }

    report({
      phase: 'detail',
      total: targets.length,
      done: Math.min(offset + CHUNK, targets.length),
      ...(quotaExhausted ? { message: '일일 호출 한도 소진 — 여기까지 저장하고 중단합니다' } : {}),
    });
  }

  report({ phase: 'write', total: companyRows.length, done: 0, message: 'DB 저장 중' });
  await writeCompanies(db, companyRows, aliasRows);
  report({ phase: 'write', total: companyRows.length, done: companyRows.length });

  return {
    totalEntries: entries.length,
    withStockCode: listed.length,
    inserted: companyRows.length,
    skippedNotListed,
    failed,
    aliasCount: aliasRows.length,
  };
}

/** SQLite 는 쿼리당 변수 개수 제한이 있어서 나눠 넣는다 */
const BATCH_SIZE = 200;

export async function writeCompanies(
  db: Db,
  companyRows: readonly CompanyRow[],
  aliasRows: readonly AliasRow[],
): Promise<void> {
  const updatedAt = new Date().toISOString();

  for (let i = 0; i < companyRows.length; i += BATCH_SIZE) {
    const batch = companyRows.slice(i, i + BATCH_SIZE).map((r) => ({ ...r, updatedAt }));
    await db
      .insert(companies)
      .values(batch)
      .onConflictDoUpdate({
        target: companies.id,
        set: {
          market: sql`excluded.market`,
          nameKo: sql`excluded.name_ko`,
          nameEn: sql`excluded.name_en`,
          corpCode: sql`excluded.corp_code`,
          fiscalYearEndMonth: sql`excluded.fiscal_year_end_month`,
          isSupported: sql`excluded.is_supported`,
          prominence: sql`excluded.prominence`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }

  for (let i = 0; i < aliasRows.length; i += BATCH_SIZE) {
    await db
      .insert(companyAliases)
      .values(aliasRows.slice(i, i + BATCH_SIZE))
      .onConflictDoNothing();
  }
}
