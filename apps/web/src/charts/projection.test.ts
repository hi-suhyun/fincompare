import { describe, expect, it } from 'vitest';
import {
  lastActualIndex,
  nextPeriodLabel,
  pickRepresentative,
  projectionsFor,
} from './projection.js';
import type { CompanyConsensus } from '../lib/api.js';
import type { AnalystTarget } from '../lib/api.js';

describe('nextPeriodLabel', () => {
  it('분기를 하나 넘긴다', () => {
    expect(nextPeriodLabel('2026Q1')).toBe('2026Q2');
    expect(nextPeriodLabel('2026Q3')).toBe('2026Q4');
  });

  it('4분기 다음은 이듬해 1분기다', () => {
    expect(nextPeriodLabel('2026Q4')).toBe('2027Q1');
  });

  it('연간 축은 한 해를 넘긴다', () => {
    expect(nextPeriodLabel('2026')).toBe('2027');
  });
});

const target = (firm: string, value: number): AnalystTarget => ({ firm, target: value });

describe('pickRepresentative', () => {
  it('개수가 적으면 전부 쓴다', () => {
    const picked = pickRepresentative([target('A', 100), target('B', 200)], 4);
    expect(picked.map((p) => p.firm)).toEqual(['B', 'A']);
  });

  it('많으면 최고와 최저를 반드시 넣는다', () => {
    const all = [
      target('최고', 470),
      target('KB', 420),
      target('대신', 320),
      target('메리츠', 310),
      target('미래', 280),
      target('BNK', 280),
      target('최저', 200),
    ];
    const picked = pickRepresentative(all, 4);

    expect(picked).toHaveLength(4);
    expect(picked[0]?.firm).toBe('최고');
    expect(picked[picked.length - 1]?.firm).toBe('최저');
  });

  it('평균 근처만 뽑지 않는다 — 의견 차이가 좁아 보이면 안 된다', () => {
    const all = Array.from({ length: 10 }, (_, i) => target(`증권${i}`, 100 + i * 10));
    const picked = pickRepresentative(all, 4);
    const spread = (picked[0]?.target ?? 0) - (picked[picked.length - 1]?.target ?? 0);
    // 전체 폭(190-100=90)을 그대로 담아야 한다
    expect(spread).toBe(90);
  });
});

describe('lastActualIndex', () => {
  it('값이 있는 마지막 자리를 찾는다', () => {
    // 분기 축은 아직 안 지난 분기가 뒤에 비어 있다
    expect(lastActualIndex([1, 2, 3, null, null])).toBe(2);
  });

  it('전부 비었으면 -1', () => {
    expect(lastActualIndex([null, null])).toBe(-1);
  });
});

const base: CompanyConsensus = {
  companyId: 'US:NVDA',
  estimates: {},
  priceTarget: { high: 500, avg: 319.48, low: 218, currency: 'USD' },
  source: 'FMP',
  currency: 'USD',
};

describe('projectionsFor — 집계만 있을 때', () => {
  it('증권사 목록이 없어도 최고·평균·최저로 부챗살을 만든다', () => {
    // FMP 무료 구간은 집계만 준다. 안 그리면 미국 기업은 통째로 안 보인다.
    const made = projectionsFor(base, 4);
    expect(made.map((p) => p.firm)).toEqual(['최고', '평균', '최저']);
    expect(made.map((p) => p.target)).toEqual([500, 319.48, 218]);
  });

  it('집계에서 뽑았다고 표시한다 — 증권사 이름이라고 하면 거짓이다', () => {
    expect(projectionsFor(base, 4).every((p) => p.aggregate === true)).toBe(true);
  });

  it('증권사 목록이 있으면 그쪽을 쓴다', () => {
    const withFirms: CompanyConsensus = {
      ...base,
      priceTarget: {
        ...base.priceTarget!,
        analysts: [{ firm: 'KB증권', target: 400 }],
      },
    };
    const made = projectionsFor(withFirms, 4);
    expect(made).toHaveLength(1);
    expect(made[0]?.firm).toBe('KB증권');
    expect(made[0]?.aggregate).toBeUndefined();
  });

  it('목표주가가 아예 없으면 그리지 않는다', () => {
    expect(projectionsFor({ ...base, priceTarget: null }, 4)).toEqual([]);
  });
});
