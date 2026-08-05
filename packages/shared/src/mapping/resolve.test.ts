import { describe, expect, it } from 'vitest';
import { KIFRS_ACCOUNT_MAP } from './kifrs.js';
import { resolveAll, resolveMetric } from './resolve.js';
import type { RawFact } from './types.js';
import { USGAAP_ACCOUNT_MAP } from './usgaap.js';

describe('K-IFRS 매핑', () => {
  const facts: RawFact[] = [
    { tag: 'ifrs-full_Revenue', name: '매출액', statement: 'IS', value: 258_935_494_000_000 },
    { tag: 'dart_OperatingIncomeLoss', name: '영업이익', statement: 'IS', value: 6_566_976_000_000 },
    {
      tag: 'ifrs-full_ProfitLossAttributableToOwnersOfParent',
      name: '지배기업 소유주지분 순이익',
      statement: 'IS',
      value: 15_487_100_000_000,
    },
    { tag: 'ifrs-full_ProfitLoss', name: '당기순이익', statement: 'IS', value: 15_487_100_000_000 },
    { tag: 'ifrs-full_Assets', name: '자산총계', statement: 'BS', value: 455_905_980_000_000 },
    { tag: 'ifrs-full_Liabilities', name: '부채총계', statement: 'BS', value: 92_228_115_000_000 },
  ];

  it('영업이익은 금감원 확장 태그로 찾는다 — ifrs-full_ 접두어로만 찾으면 누락된다', () => {
    const r = resolveMetric(KIFRS_ACCOUNT_MAP, 'operatingIncome', facts);
    expect(r.value).toBe(6_566_976_000_000);
    expect(r.sourceTag).toBe('dart_OperatingIncomeLoss');
    expect(r.usedNameFallback).toBe(false);
  });

  it('지배주주순이익과 총 순이익을 구분해서 집는다', () => {
    expect(resolveMetric(KIFRS_ACCOUNT_MAP, 'netIncome', facts).sourceTag).toBe(
      'ifrs-full_ProfitLossAttributableToOwnersOfParent',
    );
    expect(resolveMetric(KIFRS_ACCOUNT_MAP, 'netIncomeTotal', facts).sourceTag).toBe(
      'ifrs-full_ProfitLoss',
    );
  });

  it('재무제표 구분(sj_div)이 다르면 집지 않는다', () => {
    const wrongStatement: RawFact[] = [
      { tag: 'ifrs-full_Assets', name: '자산총계', statement: 'CF', value: 999 },
    ];
    expect(resolveMetric(KIFRS_ACCOUNT_MAP, 'totalAssets', wrongStatement).value).toBeNull();
  });

  it('태그가 없으면 계정명 폴백을 쓰고 플래그를 남긴다', () => {
    const nameOnly: RawFact[] = [
      { tag: 'entity00126380_Revenue', name: '매출액', statement: 'IS', value: 1234 },
    ];
    const r = resolveMetric(KIFRS_ACCOUNT_MAP, 'revenue', nameOnly);
    expect(r.value).toBe(1234);
    expect(r.usedNameFallback).toBe(true);
    expect(r.sourceTag).toBe('name:매출액');
  });

  it('계정명 표기 변형(영업수익)도 폴백으로 잡는다', () => {
    const variant: RawFact[] = [{ tag: 'custom_X', name: '영업수익', statement: 'IS', value: 500 }];
    expect(resolveMetric(KIFRS_ACCOUNT_MAP, 'revenue', variant).value).toBe(500);
  });

  it('매칭 실패는 0 이 아니라 null 이다', () => {
    const r = resolveMetric(KIFRS_ACCOUNT_MAP, 'operatingIncome', []);
    expect(r.value).toBeNull();
    expect(r.sourceTag).toBeNull();
  });

  it('값이 null 인 행은 건너뛰고 다음 후보로 넘어간다', () => {
    const withNull: RawFact[] = [
      { tag: 'ifrs-full_Revenue', name: '매출액', statement: 'IS', value: null },
      { tag: 'ifrs-full_RevenueFromSaleOfGoods', name: '재화 매출', statement: 'IS', value: 777 },
    ];
    const r = resolveMetric(KIFRS_ACCOUNT_MAP, 'revenue', withNull);
    expect(r.value).toBe(777);
    expect(r.sourceTag).toBe('ifrs-full_RevenueFromSaleOfGoods');
  });
});

describe('US GAAP 매핑 — ASC 606 전환 경계', () => {
  it('2018 이후 태그를 우선 채택한다', () => {
    const post: RawFact[] = [
      { tag: 'RevenueFromContractWithCustomerExcludingAssessedTax', value: 391_035_000_000 },
      { tag: 'Revenues', value: 391_035_000_000 },
    ];
    expect(resolveMetric(USGAAP_ACCOUNT_MAP, 'revenue', post).sourceTag).toBe(
      'RevenueFromContractWithCustomerExcludingAssessedTax',
    );
  });

  it('2018 이전 SalesRevenueNet 으로 폴백해 시계열이 끊기지 않는다', () => {
    const pre: RawFact[] = [{ tag: 'SalesRevenueNet', value: 229_234_000_000 }];
    const r = resolveMetric(USGAAP_ACCOUNT_MAP, 'revenue', pre);
    expect(r.value).toBe(229_234_000_000);
    expect(r.sourceTag).toBe('SalesRevenueNet');
  });
});

describe('US GAAP 매핑 — 비지배지분 등가관계', () => {
  const facts: RawFact[] = [
    { tag: 'NetIncomeLoss', value: 80 },
    { tag: 'ProfitLoss', value: 100 },
    { tag: 'StockholdersEquity', value: 1000 },
    { tag: 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest', value: 1500 },
  ];

  it('netIncome 은 지배주주분(NetIncomeLoss)을 집는다', () => {
    expect(resolveMetric(USGAAP_ACCOUNT_MAP, 'netIncome', facts).value).toBe(80);
  });

  it('netIncomeTotal 은 비지배 포함(ProfitLoss)을 집는다', () => {
    expect(resolveMetric(USGAAP_ACCOUNT_MAP, 'netIncomeTotal', facts).value).toBe(100);
  });

  it('equityControlling 과 totalEquity 를 뒤바꾸지 않는다', () => {
    expect(resolveMetric(USGAAP_ACCOUNT_MAP, 'equityControlling', facts).value).toBe(1000);
    expect(resolveMetric(USGAAP_ACCOUNT_MAP, 'totalEquity', facts).value).toBe(1500);
  });

  it('ProfitLoss 가 없으면 NetIncomeLoss 로 폴백한다', () => {
    const noProfitLoss: RawFact[] = [{ tag: 'NetIncomeLoss', value: 80 }];
    expect(resolveMetric(USGAAP_ACCOUNT_MAP, 'netIncomeTotal', noProfitLoss).value).toBe(80);
  });
});

describe('US GAAP 매핑 — 미태깅 케이스', () => {
  it('OperatingIncomeLoss 미태깅(금융사)은 null 로 남는다', () => {
    const bank: RawFact[] = [
      { tag: 'Revenues', value: 100 },
      { tag: 'NetIncomeLoss', value: 20 },
    ];
    const r = resolveMetric(USGAAP_ACCOUNT_MAP, 'operatingIncome', bank);
    expect(r.value).toBeNull();
    expect(r.sourceTag).toBeNull();
  });

  it('Liabilities 미태깅도 null — 파생 계산은 어댑터 책임이다', () => {
    const noLiab: RawFact[] = [
      { tag: 'Assets', value: 1000 },
      { tag: 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest', value: 400 },
    ];
    expect(resolveMetric(USGAAP_ACCOUNT_MAP, 'totalLiabilities', noLiab).value).toBeNull();
  });
});

describe('resolveAll', () => {
  it('맵에 정의된 지표를 모두 해석한다', () => {
    const facts: RawFact[] = [{ tag: 'Assets', value: 1000 }];
    const all = resolveAll(USGAAP_ACCOUNT_MAP, facts);
    expect(all.totalAssets?.value).toBe(1000);
    expect(all.revenue?.value).toBeNull();
    expect(Object.keys(all).sort()).toEqual(Object.keys(USGAAP_ACCOUNT_MAP).sort());
  });
});
