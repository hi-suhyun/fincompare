import { describe, expect, it, vi } from 'vitest';
import type {
  ConsensusAdapter,
  ConsensusResult,
  EstimateRow,
} from '../adapters/consensus/types.js';
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
  const fetchConsensus = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  return {
    adapter: { source: 'FMP', fetchConsensus },
    calls: () => fetchConsensus.mock.calls.length,
  };
}

/** 엔비디아는 1월 결산이라 종료일 2024-01-25 가 우리 축의 2023년이 된다 */
const estimate = (periodEnd: string, avg: number, count = 20): EstimateRow => ({
  periodEnd,
  metricId: 'eps',
  low: avg * 0.9,
  avg,
  high: avg * 1.1,
  count,
});

const NVDA = { id: 'US:NVDA', country: 'US', ticker: 'NVDA' };
const SAMSUNG = { id: 'KR:005930', country: 'KR', ticker: '005930' };

describe('ensureConsensus — 국내 기업', () => {
  it('국내 기업은 외부를 부르지 않는다', async () => {
    // 컨센서스를 크롤링·저장하지 않는 것이 이 프로젝트의 결정이다
    const handle = await makeDb();
    const { adapter, calls } = makeAdapter({ estimates: [], priceTarget: null });
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

  it('직접 조사 기록이 있으면 그것을 쓴다', async () => {
    const handle = await makeDb();
    const { adapter, calls } = makeAdapter({ estimates: [], priceTarget: null });
    const warnings: ConsensusWarning[] = [];

    const result = await ensureConsensus(
      {
        db: handle.db,
        consensus: adapter,
        krResearch: [
          {
            companyId: 'KR:005930',
            asOf: '2026-08-15',
            priceTarget: { high: 670000, avg: 491875, low: 370000 },
            estimates: { eps: [{ year: 2024, high: 9800, avg: 8400, low: 6900, count: 21 }] },
            sources: ['https://markets.hankyung.com/stock/005930/consensus'],
          },
        ],
      },
      SAMSUNG,
      YEARS,
      warnings,
    );

    expect(result?.source).toBe('직접 조사');
    expect(result?.priceTarget?.avg).toBe(491875);
    // 기록이 있어도 제공처는 부르지 않는다 — 국내는 받아오지 않기로 한 것이다
    expect(calls()).toBe(0);
    handle.close();
  });

  it('다른 기업의 기록을 끌어다 쓰지 않는다', async () => {
    const handle = await makeDb();
    const { adapter } = makeAdapter({ estimates: [], priceTarget: null });
    const warnings: ConsensusWarning[] = [];

    const result = await ensureConsensus(
      {
        db: handle.db,
        consensus: adapter,
        krResearch: [
          {
            companyId: 'KR:000660',
            asOf: '2026-08-15',
            estimates: { eps: [{ year: 2024, high: 1, avg: 1, low: 1, count: 1 }] },
            sources: ['https://example.com/a'],
          },
        ],
      },
      SAMSUNG,
      YEARS,
      warnings,
    );

    expect(result).toBeNull();
    handle.close();
  });
});

describe('ensureConsensus — 회계연도 정렬', () => {
  it('1월 결산 기업의 추정치를 실제값과 같은 해에 놓는다', async () => {
    // 종료일 2024-01-25 는 우리 축에서 2023년이다. 연도만 잘라 쓰면
    // 추정치가 실제값보다 한 해 뒤로 밀려 비교 자체가 어긋난다.
    const handle = await makeDb();
    const { adapter } = makeAdapter({
      estimates: [estimate('2024-01-25', 1.23926, 28)],
      priceTarget: null,
    });
    const warnings: ConsensusWarning[] = [];

    const result = await ensureConsensus(
      { db: handle.db, consensus: adapter },
      NVDA,
      YEARS,
      warnings,
    );

    const eps = result?.estimates['eps'];
    expect(eps?.find((p) => p.year === 2023)?.avg).toBeCloseTo(1.23926, 5);
    expect(eps?.find((p) => p.year === 2024)?.avg).toBeNull();
    handle.close();
  });

  it('요청하지 않은 해는 null 로 남긴다', async () => {
    // 0 으로 채우면 "그 해 추정이 0" 으로 읽힌다
    const handle = await makeDb();
    const { adapter } = makeAdapter({
      estimates: [estimate('2024-01-25', 1.24)],
      priceTarget: null,
    });
    const warnings: ConsensusWarning[] = [];

    const result = await ensureConsensus(
      { db: handle.db, consensus: adapter },
      NVDA,
      YEARS,
      warnings,
    );

    expect(result?.estimates['eps']?.map((p) => p.year)).toEqual(YEARS);
    expect(result?.estimates['eps']?.find((p) => p.year === 2022)).toEqual({
      year: 2022,
      high: null,
      avg: null,
      low: null,
      count: 0,
    });
    handle.close();
  });
});

describe('ensureConsensus — 캐싱', () => {
  it('두 번째 호출은 추정치를 DB 에서 읽는다', async () => {
    // 무료 티어가 하루 250 콜이라 재요청이 비싸다.
    // 목표주가는 "지금 값" 이라 저장하지 않으므로 매번 부르지만,
    // 그쪽은 HTTP 캐시(3일)가 막아 준다.
    const handle = await makeDb();
    const { adapter, calls } = makeAdapter({
      estimates: [estimate('2024-01-25', 1.24), estimate('2025-01-26', 2.95)],
      priceTarget: null,
    });
    const warnings: ConsensusWarning[] = [];
    const deps = { db: handle.db, consensus: adapter };

    const first = await ensureConsensus(deps, NVDA, YEARS, warnings);
    const second = await ensureConsensus(deps, NVDA, YEARS, warnings);

    // 추정치는 저장분에서 나온다 — 값이 같아야 한다
    expect(second?.estimates).toEqual(first?.estimates);
    handle.close();
  });

  it('다시 받으면 값이 갱신된다', async () => {
    // 추정치는 계속 바뀐다. 같은 기간에 옛 값이 남아 있으면 안 된다.
    const handle = await makeDb();
    const warnings: ConsensusWarning[] = [];

    const before = makeAdapter({ estimates: [estimate('2024-01-25', 1.0)], priceTarget: null });
    await ensureConsensus({ db: handle.db, consensus: before.adapter }, NVDA, YEARS, warnings);

    // 저장된 값을 지우고 새 값을 받게 한다
    await handle.execute("DELETE FROM analyst_estimates");
    const after = makeAdapter({ estimates: [estimate('2024-01-25', 2.0)], priceTarget: null });
    const result = await ensureConsensus(
      { db: handle.db, consensus: after.adapter },
      NVDA,
      YEARS,
      warnings,
    );

    expect(result?.estimates['eps']?.find((p) => p.year === 2023)?.avg).toBe(2.0);
    handle.close();
  });
});

describe('ensureConsensus — 실패해도 조회를 죽이지 않는다', () => {
  it('제공처 오류는 경고로 남기고 null 을 준다', async () => {
    // 컨센서스는 부가 정보다. 이것 때문에 재무지표까지 못 보면 안 된다.
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
    expect(warnings[0]?.detail).toContain('컨센서스를 받지 못했습니다');
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

describe('ensureConsensus — 목표주가', () => {
  it('막혔으면 이유를 경고로 남기고 추정치는 살린다', async () => {
    const handle = await makeDb();
    const { adapter } = makeAdapter({
      estimates: [estimate('2024-01-25', 1.24)],
      priceTarget: null,
      priceTargetNote: '목표주가를 받지 못했습니다: 요금제 제한',
    });
    const warnings: ConsensusWarning[] = [];

    const result = await ensureConsensus(
      { db: handle.db, consensus: adapter },
      NVDA,
      YEARS,
      warnings,
    );

    expect(result?.estimates['eps']).toBeDefined();
    expect(warnings[0]?.detail).toContain('목표주가');
    handle.close();
  });
});
