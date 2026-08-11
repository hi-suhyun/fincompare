import { describe, expect, it, vi } from 'vitest';
import type { AnalystTarget } from '@fincompare/shared';
import type { ConsensusAdapter, ConsensusResult } from '../adapters/consensus/types.js';
import { createDb, type DbHandle } from '../db/client.js';
import { companies } from '../db/schema.js';
import { SourceError } from '../core/errors.js';
import { ensureConsensus, type ConsensusWarning } from './consensus.js';

const YEARS = [2022, 2023, 2024];

async function makeDb(): Promise<DbHandle> {
  const handle = await createDb(':memory:');
  await handle.db.insert(companies).values([
    {
      id: 'US:NVDA',
      country: 'US',
      market: 'NASDAQ',
      nameKo: '엔비디아',
      nameEn: 'NVIDIA CORP',
      corpCode: null,
      stockCode: null,
      cik: '0001045810',
      ticker: 'NVDA',
      fiscalYearEndMonth: 1,
      isAdr: false,
      isSupported: true,
      prominence: 100,
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'KR:005930',
      country: 'KR',
      market: 'KOSPI',
      nameKo: '삼성전자',
      nameEn: 'SAMSUNG',
      corpCode: '00126380',
      stockCode: '005930',
      cik: null,
      ticker: '005930',
      fiscalYearEndMonth: 12,
      isAdr: false,
      isSupported: true,
      prominence: 100,
      updatedAt: new Date().toISOString(),
    },
  ]);
  return handle;
}

function makeAdapter(result: ConsensusResult | Error): {
  adapter: ConsensusAdapter;
  calls: () => number;
} {
  const fetchTargets = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  return {
    adapter: { source: 'FMP', fetchTargets },
    calls: () => fetchTargets.mock.calls.length,
  };
}

const target = (publishedAt: string, priceTarget: number, company = 'A'): AnalystTarget => ({
  companyId: 'US:NVDA',
  publishedAt,
  priceTarget,
  priceWhenPosted: null,
  analystCompany: company,
  currency: 'USD',
});

const NVDA = { id: 'US:NVDA', country: 'US', ticker: 'NVDA' };
const SAMSUNG = { id: 'KR:005930', country: 'KR', ticker: '005930' };

describe('ensureConsensus — 국내 기업', () => {
  it('국내 기업은 외부를 부르지 않는다', async () => {
    // 컨센서스를 크롤링·저장하지 않는 것이 이 프로젝트의 결정이다
    const handle = await makeDb();
    const { adapter, calls } = makeAdapter({ targets: [], historical: true });
    const warnings: ConsensusWarning[] = [];

    const result = await ensureConsensus(
      { db: handle.db, consensus: adapter },
      SAMSUNG,
      YEARS,
      warnings,
    );

    expect(result).toBeNull();
    expect(calls()).toBe(0);
    handle.close();
  });
});

describe('ensureConsensus — 캐싱', () => {
  it('두 번째 호출은 DB 에서 읽고 외부를 다시 부르지 않는다', async () => {
    // 무료 티어가 하루 250 콜이라 재요청이 비싸다
    const handle = await makeDb();
    const { adapter, calls } = makeAdapter({
      targets: [target('2023-05-01', 400), target('2024-02-01', 600, 'B')],
      historical: true,
    });
    const warnings: ConsensusWarning[] = [];
    const deps = { db: handle.db, consensus: adapter };

    const first = await ensureConsensus(deps, NVDA, YEARS, warnings);
    const second = await ensureConsensus(deps, NVDA, YEARS, warnings);

    expect(calls()).toBe(1);
    expect(second?.points).toEqual(first?.points);
    handle.close();
  });

  it('저장된 값으로 연도별 밴드를 만든다', async () => {
    const handle = await makeDb();
    const { adapter } = makeAdapter({
      targets: [
        target('2023-03-01', 300, 'A'),
        target('2023-09-01', 500, 'B'),
        target('2024-01-01', 700, 'C'),
      ],
      historical: true,
    });
    const warnings: ConsensusWarning[] = [];

    const result = await ensureConsensus(
      { db: handle.db, consensus: adapter },
      NVDA,
      YEARS,
      warnings,
    );

    expect(result?.points).toEqual([
      { year: 2022, high: null, avg: null, low: null, count: 0 },
      { year: 2023, high: 500, avg: 400, low: 300, count: 2 },
      { year: 2024, high: 700, avg: 700, low: 700, count: 1 },
    ]);
    handle.close();
  });
});

describe('ensureConsensus — 실패해도 조회를 죽이지 않는다', () => {
  it('제공처 오류는 경고로 남기고 null 을 준다', async () => {
    // 목표주가는 부가 정보다. 이것 때문에 재무지표까지 못 보면 안 된다.
    const handle = await makeDb();
    const { adapter } = makeAdapter(new SourceError('FMP', 'TRANSIENT', '일시 오류'));
    const warnings: ConsensusWarning[] = [];

    const result = await ensureConsensus(
      { db: handle.db, consensus: adapter },
      NVDA,
      YEARS,
      warnings,
    );

    expect(result).toBeNull();
    expect(warnings[0]?.detail).toContain('목표주가를 받지 못했습니다');
    handle.close();
  });

  it('키가 없으면 조용히 꺼진다', async () => {
    const handle = await makeDb();
    const warnings: ConsensusWarning[] = [];

    const result = await ensureConsensus({ db: handle.db, consensus: null }, NVDA, YEARS, warnings);

    expect(result).toBeNull();
    // 키를 안 넣은 건 설정 문제가 아니라 선택이다. 경고로 시끄럽게 하지 않는다.
    expect(warnings).toHaveLength(0);
    handle.close();
  });
});

describe('ensureConsensus — 과거 이력 여부', () => {
  it('요금제가 막아 현재 컨센서스만 왔으면 그대로 알린다', async () => {
    const handle = await makeDb();
    const { adapter } = makeAdapter({
      targets: [target('2026-08-10', 500, '컨센서스 최고')],
      historical: false,
      reason: '이 요금제에서는 과거 목표주가를 받을 수 없습니다',
    });
    const warnings: ConsensusWarning[] = [];

    const result = await ensureConsensus(
      { db: handle.db, consensus: adapter },
      NVDA,
      YEARS,
      warnings,
    );

    expect(result?.historical).toBe(false);
    expect(warnings[0]?.detail).toContain('과거');
    handle.close();
  });

  it('저장분이 한 해뿐이면 과거 이력으로 보지 않는다', async () => {
    const handle = await makeDb();
    const { adapter } = makeAdapter({
      targets: [target('2024-01-01', 500, 'A'), target('2024-06-01', 600, 'B')],
      historical: false,
    });
    const warnings: ConsensusWarning[] = [];
    const deps = { db: handle.db, consensus: adapter };

    await ensureConsensus(deps, NVDA, YEARS, warnings);
    // 두 번째 호출은 DB 경로를 탄다 — 여기서도 판정이 같아야 한다
    const cached = await ensureConsensus(deps, NVDA, YEARS, warnings);

    expect(cached?.historical).toBe(false);
    handle.close();
  });
});
