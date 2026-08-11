import { aggregateByYear, type AnalystTarget, type ConsensusPoint } from '@fincompare/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { ConsensusAdapter } from '../adapters/consensus/types.js';
import { SourceError } from '../core/errors.js';
import type { Db } from '../db/client.js';
import { analystTargets } from '../db/schema.js';

/**
 * 목표주가 수집·집계.
 *
 * 원본(개별 목표가)을 DB 에 담고, 화면에는 연도별 밴드로 접어서 준다.
 * 집계를 저장하지 않는 이유는 규칙이 바뀔 수 있어서다 — 규칙이 바뀌어도
 * 다시 받지 않아도 된다. 무료 티어가 하루 250 콜이라 재요청은 비싸다.
 */

export interface ConsensusDeps {
  db: Db;
  /** 키가 없으면 null. 그때는 기능 자체가 꺼진다 */
  consensus: ConsensusAdapter | null;
}

export interface ConsensusWarning {
  companyId: string;
  detail: string;
}

export interface CompanyConsensus {
  companyId: string;
  points: ConsensusPoint[];
  /** 과거 발행분까지 받았는지. false 면 "그때 맞았나"는 답할 수 없다 */
  historical: boolean;
  source: string;
}

/** 이미 받아 둔 게 있으면 외부를 부르지 않는다 */
async function loadStored(db: Db, companyId: string): Promise<AnalystTarget[]> {
  const rows = await db
    .select()
    .from(analystTargets)
    .where(eq(analystTargets.companyId, companyId));

  return rows.map((row) => ({
    companyId: row.companyId,
    publishedAt: row.publishedAt,
    priceTarget: Number(row.priceTarget),
    priceWhenPosted: row.priceWhenPosted === null ? null : Number(row.priceWhenPosted),
    analystCompany: row.analystCompany === '' ? null : row.analystCompany,
    currency: row.currency,
  }));
}

async function store(db: Db, targets: readonly AnalystTarget[], source: string): Promise<void> {
  if (targets.length === 0) return;

  const rows = targets.map((t) => ({
    companyId: t.companyId,
    publishedAt: t.publishedAt,
    // 기본키의 일부라 null 을 넣을 수 없다. 빈 문자열로 두고 읽을 때 되돌린다.
    analystCompany: t.analystCompany ?? '',
    priceTarget: String(t.priceTarget),
    priceWhenPosted: t.priceWhenPosted === null ? null : String(t.priceWhenPosted),
    currency: t.currency,
    source,
  }));

  // 같은 기관이 같은 날 목표가를 고쳐 내는 경우가 있다. 나중 값이 이긴다.
  // excluded 를 써야 행마다 자기 값으로 갱신된다 — 고정값을 넣으면 전부 같아진다.
  await db
    .insert(analystTargets)
    .values(rows)
    .onConflictDoUpdate({
      target: [analystTargets.companyId, analystTargets.publishedAt, analystTargets.analystCompany],
      set: {
        priceTarget: sql`excluded.price_target`,
        priceWhenPosted: sql`excluded.price_when_posted`,
        currency: sql`excluded.currency`,
        source: sql`excluded.source`,
      },
    });
}

/**
 * 한 기업의 목표주가 밴드를 만든다.
 *
 * 국내 기업은 아예 시도하지 않는다. 컨센서스를 크롤링·저장하지 않는 것이
 * 이 프로젝트의 결정이고, 화면에서는 링크아웃만 제공한다.
 */
export async function ensureConsensus(
  deps: ConsensusDeps,
  company: { id: string; country: string; ticker: string | null },
  years: readonly number[],
  warnings: ConsensusWarning[],
): Promise<CompanyConsensus | null> {
  if (company.country !== 'US') return null;
  if (deps.consensus === null) return null;

  const ticker = company.ticker;
  if (ticker === null || ticker.trim() === '') {
    warnings.push({ companyId: company.id, detail: '티커가 없어 목표주가를 받을 수 없습니다' });
    return null;
  }

  const stored = await loadStored(deps.db, company.id);
  if (stored.length > 0) {
    return {
      companyId: company.id,
      points: aggregateByYear(stored, years),
      // 저장된 값이 오늘 하루치뿐이면 과거 이력이 아니다
      historical: new Set(stored.map((t) => t.publishedAt.slice(0, 4))).size > 1,
      source: deps.consensus.source,
    };
  }

  try {
    const result = await deps.consensus.fetchTargets(ticker);

    if (result.targets.length === 0) {
      warnings.push({
        companyId: company.id,
        detail: '이 기업의 목표주가를 찾지 못했습니다',
      });
      return null;
    }

    await store(deps.db, result.targets, deps.consensus.source);

    if (result.reason !== undefined) {
      warnings.push({ companyId: company.id, detail: result.reason });
    }

    return {
      companyId: company.id,
      points: aggregateByYear(result.targets, years),
      historical: result.historical,
      source: deps.consensus.source,
    };
  } catch (error) {
    // 목표주가는 부가 정보다. 못 받았다고 재무지표 조회 전체를 실패시키지 않는다.
    const detail =
      error instanceof SourceError
        ? `목표주가를 받지 못했습니다: ${error.message}`
        : '목표주가를 받지 못했습니다';
    warnings.push({ companyId: company.id, detail });
    return null;
  }
}

/** 테스트·스크립트에서 저장된 목표주가를 지울 때 */
export async function clearConsensus(db: Db, companyId: string, source: string): Promise<void> {
  await db
    .delete(analystTargets)
    .where(and(eq(analystTargets.companyId, companyId), eq(analystTargets.source, source)));
}
