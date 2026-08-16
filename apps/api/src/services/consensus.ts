import {
  alignPeriod,
  alignToYears,
  type ConsensusPoint,
  type EstimatedMetricId,
  type PriceTargetConsensus,
} from '@fincompare/shared';
import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { ConsensusAdapter, EstimateRow } from '../adapters/consensus/types.js';
import { SourceError } from '../core/errors.js';
import type { Db } from '../db/client.js';
import { analystEstimates } from '../db/schema.js';
// 타입은 저쪽에서 이쪽을 참조하지만 import type 이라 지워진다 — 런타임 순환은 없다
import { toCompanyConsensus, type KrConsensusEntry } from './krConsensusFile.js';

/**
 * 애널리스트 컨센서스 수집·집계.
 *
 * 원본(기간별 추정치)을 DB 에 담고, 화면에는 연도 축에 맞춰 접어서 준다.
 * 집계를 저장하지 않는 이유는 규칙이 바뀔 수 있어서다 — 규칙이 바뀌어도
 * 다시 받지 않아도 된다. 무료 티어가 하루 250 콜이라 재요청은 비싸다.
 */

export interface ConsensusDeps {
  db: Db;
  /** 키가 없으면 null. 그때는 기능 자체가 꺼진다 */
  consensus: ConsensusAdapter | null;
  /**
   * 국내 컨센서스 — 사용자가 직접 조사해 적어 둔 기록.
   *
   * 제공처가 없어서가 아니라 **쓰지 않기로 한 것**이다. 자동 수집 대신
   * 로컬 파일을 읽는다. 자세한 이유는 krConsensusFile.ts 에 적어 두었다.
   */
  krResearch?: readonly KrConsensusEntry[];
}

export interface ConsensusWarning {
  companyId: string;
  detail: string;
}

export interface CompanyConsensus {
  companyId: string;
  /** 지표별 추정 밴드. 요청한 연도 축에 맞춰져 있다 */
  estimates: Record<string, ConsensusPoint[]>;
  /**
   * 현재 목표주가 컨센서스.
   *
   * 과거 발행분은 유료 구간이라 시계열이 아니다. 화면에서도 추이가 아니라
   * "지금 수준"으로만 쓴다.
   */
  priceTarget: PriceTargetConsensus | null;
  source: string;
  /**
   * 추정치가 적힌 통화.
   *
   * 실제값은 「표시 통화」로 환산되지만 추정치는 받은 그대로다. 둘이 어긋나면
   * 밴드와 실선이 엉뚱한 자리에 겹치므로, 화면에서 이 값을 보고 그릴지 정한다.
   * 미국은 FMP 가 달러로 주고, 국내 조사 기록은 원화다.
   */
  currency: 'KRW' | 'USD';
  /**
   * 조사 시점 (YYYY-MM-DD). 직접 조사 기록에만 있다.
   *
   * 제공처에서 받은 값은 늘 최신이라 시점을 밝힐 필요가 없지만, 손으로 적은
   * 기록은 언제 적었는지가 값 자체만큼 중요하다 — 반년 지난 목표주가는
   * 지금 목표주가가 아니다.
   */
  asOf?: string;
  /** 그 숫자를 어디서 봤는지. 화면에서 눌러 확인할 수 있어야 한다 */
  sources?: readonly string[];
  note?: string;
}

async function loadStored(db: Db, companyId: string): Promise<EstimateRow[]> {
  const rows = await db
    .select()
    .from(analystEstimates)
    .where(eq(analystEstimates.companyId, companyId));

  return rows.map((row) => ({
    periodEnd: row.periodEnd,
    metricId: row.metricId as EstimatedMetricId,
    low: row.low === null ? null : Number(row.low),
    avg: row.avg === null ? null : Number(row.avg),
    high: row.high === null ? null : Number(row.high),
    count: row.analystCount,
  }));
}

async function store(
  db: Db,
  companyId: string,
  rows: readonly EstimateRow[],
  source: string,
): Promise<void> {
  if (rows.length === 0) return;

  const values = rows.map((r) => ({
    companyId,
    periodEnd: r.periodEnd,
    metricId: r.metricId,
    low: r.low === null ? null : String(r.low),
    avg: r.avg === null ? null : String(r.avg),
    high: r.high === null ? null : String(r.high),
    analystCount: r.count,
    source,
  }));

  // 추정치는 계속 갱신된다. 나중 값이 이긴다.
  // excluded 를 써야 행마다 자기 값으로 갱신된다 — 고정값을 넣으면 전부 같아진다.
  await db
    .insert(analystEstimates)
    .values(values)
    .onConflictDoUpdate({
      target: [analystEstimates.companyId, analystEstimates.periodEnd, analystEstimates.metricId],
      set: {
        low: sql`excluded.low`,
        avg: sql`excluded.avg`,
        high: sql`excluded.high`,
        analystCount: sql`excluded.analyst_count`,
        source: sql`excluded.source`,
      },
    });
}

/**
 * 추정치를 연도 축에 접는다.
 *
 * 연도는 회계기간 종료일에서 실제값과 **같은 규칙**으로 뽑는다. 연도만
 * 잘라 쓰면 1월 결산인 엔비디아의 추정치가 실제값보다 한 해 뒤로 밀린다.
 */
function foldByMetric(
  rows: readonly EstimateRow[],
  years: readonly number[],
): Record<string, ConsensusPoint[]> {
  const byMetric = new Map<string, Map<number, ConsensusPoint>>();

  for (const row of rows) {
    const year = alignPeriod(row.periodEnd, 'FY').alignedYear;
    let table = byMetric.get(row.metricId);
    if (table === undefined) {
      table = new Map<number, ConsensusPoint>();
      byMetric.set(row.metricId, table);
    }
    table.set(year, {
      year,
      high: row.high,
      avg: row.avg,
      low: row.low,
      count: row.count,
    });
  }

  const result: Record<string, ConsensusPoint[]> = {};
  for (const [metricId, table] of byMetric) {
    const points = alignToYears(table, years);
    // 요청 구간에 값이 하나도 없으면 실을 이유가 없다
    if (points.some((p) => p.avg !== null)) result[metricId] = points;
  }
  return result;
}

/**
 * 한 기업의 컨센서스를 준비한다.
 *
 * 국내 기업은 **자동으로 받아오지 않는다.** 증권사 리포트와 그 집계는
 * 저작물이고 제공처 약관이 기계적 수집을 막는다. 대신 사용자가 직접
 * 조사해 로컬 파일에 적어 둔 것이 있으면 그것을 쓴다.
 */
export async function ensureConsensus(
  deps: ConsensusDeps,
  company: { id: string; country: string; ticker: string | null },
  years: readonly number[],
  warnings: ConsensusWarning[],
): Promise<CompanyConsensus | null> {
  if (company.country !== 'US') {
    const entry = deps.krResearch?.find((e) => e.companyId === company.id);
    if (entry === undefined) return null;

    const research = toCompanyConsensus(entry, years);
    // 목표주가도 추정치도 없으면 실을 것이 없다 — 출처만 적힌 빈 항목
    if (Object.keys(research.estimates).length === 0 && research.priceTarget === null) return null;
    return research;
  }

  if (deps.consensus === null) return null;

  const ticker = company.ticker;
  if (ticker === null || ticker.trim() === '') {
    warnings.push({ companyId: company.id, detail: '티커가 없어 컨센서스를 받을 수 없습니다' });
    return null;
  }

  const stored = await loadStored(deps.db, company.id);
  if (stored.length > 0) {
    const estimates = foldByMetric(stored, years);
    if (Object.keys(estimates).length === 0) return null;

    /*
     * 목표주가는 "지금 값"이라 DB 에 담지 않는다. 그렇다고 캐시된 조회에서
     * 통째로 빼면, 추정치가 한 번 저장된 뒤로는 목표주가가 영영 안 나온다 —
     * 실제로 처음 한 번만 보이고 사라졌다.
     *
     * 제공처 호출은 HTTP 캐시(3일)가 막아 주므로 매번 불러도 부담이 없다.
     */
    let priceTarget: PriceTargetConsensus | null = null;
    try {
      priceTarget = (await deps.consensus.fetchConsensus(ticker)).priceTarget;
    } catch {
      // 목표주가는 부가 정보다. 못 받아도 추정치 밴드는 그대로 쓴다.
    }

    return {
      companyId: company.id,
      estimates,
      priceTarget,
      source: deps.consensus.source,
      currency: 'USD',
    };
  }

  try {
    const result = await deps.consensus.fetchConsensus(ticker);

    if (result.estimates.length === 0 && result.priceTarget === null) {
      warnings.push({ companyId: company.id, detail: '이 기업의 컨센서스를 찾지 못했습니다' });
      return null;
    }

    await store(deps.db, company.id, result.estimates, deps.consensus.source);

    if (result.priceTargetNote !== undefined) {
      warnings.push({ companyId: company.id, detail: result.priceTargetNote });
    }

    return {
      companyId: company.id,
      estimates: foldByMetric(result.estimates, years),
      priceTarget: result.priceTarget,
      source: deps.consensus.source,
      currency: 'USD',
    };
  } catch (error) {
    // 컨센서스는 부가 정보다. 못 받았다고 재무지표 조회 전체를 실패시키지 않는다.
    const detail =
      error instanceof SourceError
        ? `컨센서스를 받지 못했습니다: ${error.message}`
        : '컨센서스를 받지 못했습니다';
    warnings.push({ companyId: company.id, detail });
    return null;
  }
}
