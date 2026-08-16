import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadKrConsensusFile, toCompanyConsensus } from './krConsensusFile.js';

/**
 * 국내 컨센서스 직접 조사 기록.
 *
 * 여기서 지켜야 할 것은 두 가지다 — 잘못 적은 파일이 조용히 사라지지 않을 것,
 * 그리고 출처 없는 숫자가 화면에 올라가지 않을 것.
 */

let dir: string;
let dbUrl: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kr-consensus-'));
  dbUrl = `file:${join(dir, 'dev.db')}`;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function write(contents: unknown): void {
  writeFileSync(join(dir, 'kr-consensus.json'), JSON.stringify(contents));
}

const SAMSUNG = {
  companyId: 'KR:005930',
  asOf: '2026-08-15',
  priceTarget: { high: 670000, avg: 491875, low: 370000 },
  estimates: {
    eps: [{ year: 2026, high: 9800, avg: 8400, low: 6900, count: 21 }],
  },
  sources: ['https://markets.hankyung.com/stock/005930/consensus'],
};

describe('loadKrConsensusFile', () => {
  it('파일이 없으면 빈 목록이다', () => {
    expect(loadKrConsensusFile(dbUrl)).toEqual([]);
  });

  it('DB 옆에서 찾는다 — 그 경로가 gitignore 되어 있다', () => {
    write({ entries: [SAMSUNG] });
    const entries = loadKrConsensusFile(dbUrl);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.companyId).toBe('KR:005930');
  });

  it('출처가 없으면 받지 않는다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    write({ entries: [{ ...SAMSUNG, sources: [] }] });

    expect(loadKrConsensusFile(dbUrl)).toEqual([]);
    // 왜 안 실렸는지 알 수 있어야 한다. 조용히 사라지면 파일을 고칠 수 없다.
    expect(warn).toHaveBeenCalled();
  });

  it('형식이 깨져도 서버를 죽이지 않고 경고만 남긴다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeFileSync(join(dir, 'kr-consensus.json'), '{ 이건 JSON 이 아니다');

    expect(loadKrConsensusFile(dbUrl)).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });
});

describe('toCompanyConsensus', () => {
  it('요청한 연도 축에 맞춰 접는다', () => {
    const result = toCompanyConsensus(SAMSUNG, [2024, 2025, 2026]);
    expect(result.estimates['eps']).toHaveLength(3);
    expect(result.estimates['eps']?.[2]?.avg).toBe(8400);
    // 조사하지 않은 해는 비워 둔다 — 0 으로 채우면 없는 추정이 있는 것처럼 보인다
    expect(result.estimates['eps']?.[0]?.avg).toBeNull();
  });

  it('제공처 데이터와 구분되도록 출처와 조사일을 싣는다', () => {
    const result = toCompanyConsensus(SAMSUNG, [2026]);
    expect(result.source).toBe('직접 조사');
    expect(result.asOf).toBe('2026-08-15');
    expect(result.sources).toEqual([SAMSUNG.sources[0]]);
  });

  it('원화로 표시한다 — 달러 추정치와 같은 축에 얹히면 안 된다', () => {
    const result = toCompanyConsensus(SAMSUNG, [2026]);
    expect(result.currency).toBe('KRW');
    expect(result.priceTarget?.currency).toBe('KRW');
  });

  it('요청 구간에 값이 하나도 없는 지표는 싣지 않는다', () => {
    const result = toCompanyConsensus(SAMSUNG, [2020, 2021]);
    expect(result.estimates['eps']).toBeUndefined();
    // 목표주가는 "지금 값" 이라 연도 축과 무관하게 남는다
    expect(result.priceTarget?.avg).toBe(491875);
  });

  it('목표주가 없이 추정치만 적어도 된다', () => {
    const { priceTarget: _drop, ...noTarget } = SAMSUNG;
    const result = toCompanyConsensus(noTarget, [2026]);
    expect(result.priceTarget).toBeNull();
    expect(result.estimates['eps']?.[0]?.avg).toBe(8400);
  });
});
