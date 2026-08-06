import { describe, expect, it } from 'vitest';
import { KIFRS_ACCOUNT_MAP } from './kifrs.js';
import { expandTaxonomyVariants, resolveAll, resolveMetric } from './resolve.js';
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

describe('EPS 표기 두 갈래 — 통합 배분 vs 보통주·우선주 분리', () => {
  it('삼성전자식: 통합 기본주당이익', () => {
    const samsung: RawFact[] = [
      {
        tag: 'ifrs-full_BasicEarningsLossPerShare',
        name: '기본주당이익(손실)',
        statement: 'IS',
        value: 2131,
      },
    ];
    expect(resolveMetric(KIFRS_ACCOUNT_MAP, 'eps', samsung).value).toBe(2131);
  });

  it('현대차식: 표준계정코드 없이 보통주 EPS 를 집는다', () => {
    // 현대차 2022 실제 응답 구조. account_id 가 '-표준계정코드 미사용-' 이라 계정명으로만 찾는다
    const hyundai: RawFact[] = [
      { tag: '-표준계정코드 미사용-', name: '보통주 기본주당이익', statement: 'IS', value: 28_521 },
      { tag: '-표준계정코드 미사용-', name: '1우선주 기본주당이익', statement: 'IS', value: 28_207 },
      { tag: '-표준계정코드 미사용-', name: '보통주 희석주당이익', statement: 'IS', value: 28_521 },
    ];

    const result = resolveMetric(KIFRS_ACCOUNT_MAP, 'eps', hyundai);
    expect(result.value).toBe(28_521);
    expect(result.usedNameFallback).toBe(true);
  });

  it('우선주 EPS 를 절대 집지 않는다 — PER 이 조용히 어긋난다', () => {
    const onlyPreferred: RawFact[] = [
      { tag: '-표준계정코드 미사용-', name: '1우선주 기본주당이익', statement: 'IS', value: 28_207 },
      { tag: '-표준계정코드 미사용-', name: '우선주 기본주당이익', statement: 'IS', value: 28_207 },
    ];
    expect(resolveMetric(KIFRS_ACCOUNT_MAP, 'eps', onlyPreferred).value).toBeNull();
  });

  it('희석주당이익을 기본주당이익으로 착각하지 않는다', () => {
    const dilutedOnly: RawFact[] = [
      { tag: '-표준계정코드 미사용-', name: '보통주 희석주당이익', statement: 'IS', value: 999 },
    ];
    expect(resolveMetric(KIFRS_ACCOUNT_MAP, 'eps', dilutedOnly).value).toBeNull();
  });

  it("'연결당기순이익' 표기도 총 순이익으로 잡는다", () => {
    const hyundai: RawFact[] = [
      { tag: '-표준계정코드 미사용-', name: '연결당기순이익', statement: 'IS', value: 7_982_000_000_000 },
    ];
    expect(resolveMetric(KIFRS_ACCOUNT_MAP, 'netIncomeTotal', hyundai).value).toBe(
      7_982_000_000_000,
    );
  });
});

describe('IFRS 택사노미 접두어 변형', () => {
  it('ifrs-full_ <-> ifrs_ 를 양방향으로 확장한다', () => {
    expect(expandTaxonomyVariants(['ifrs-full_Equity'])).toEqual([
      'ifrs-full_Equity',
      'ifrs_Equity',
    ]);
    expect(expandTaxonomyVariants(['ifrs_Equity'])).toEqual(['ifrs_Equity', 'ifrs-full_Equity']);
  });

  it('IFRS 태그가 아니면 건드리지 않는다', () => {
    expect(expandTaxonomyVariants(['dart_OperatingIncomeLoss', 'NetIncomeLoss'])).toEqual([
      'dart_OperatingIncomeLoss',
      'NetIncomeLoss',
    ]);
  });

  it('중복을 만들지 않는다', () => {
    expect(expandTaxonomyVariants(['ifrs-full_Equity', 'ifrs_Equity'])).toHaveLength(2);
  });

  it('2018년 이전 보고서(ifrs_ 접두어)도 매핑된다', () => {
    // DART 는 2018년까지 ifrs_, 2019년부터 ifrs-full_ 을 쓴다.
    // 이걸 놓쳐서 2015~2018 구간의 netIncome·eps·equityControlling 이 통째로 비었었다.
    const old2017: RawFact[] = [
      {
        tag: 'ifrs_ProfitLossAttributableToOwnersOfParent',
        name: '지배기업의 소유주에게 귀속되는 당기순이익(손실)',
        statement: 'IS',
        value: 41_344_569_000_000,
      },
      { tag: 'ifrs_Equity', name: '자본총계', statement: 'BS', value: 214_491_428_000_000 },
      {
        tag: 'ifrs_EquityAttributableToOwnersOfParent',
        name: '지배기업 소유주지분',
        statement: 'BS',
        value: 207_213_416_000_000,
      },
      {
        tag: 'ifrs_BasicEarningsLossPerShare',
        name: '기본주당이익(손실) (단위:원)',
        statement: 'IS',
        value: 5421,
      },
    ];

    expect(resolveMetric(KIFRS_ACCOUNT_MAP, 'netIncome', old2017).value).toBe(41_344_569_000_000);
    expect(resolveMetric(KIFRS_ACCOUNT_MAP, 'totalEquity', old2017).value).toBe(214_491_428_000_000);
    expect(resolveMetric(KIFRS_ACCOUNT_MAP, 'equityControlling', old2017).value).toBe(
      207_213_416_000_000,
    );
    expect(resolveMetric(KIFRS_ACCOUNT_MAP, 'eps', old2017).value).toBe(5421);
  });

  it('접두어가 확장돼도 실제 채택된 태그를 그대로 기록한다', () => {
    const old: RawFact[] = [{ tag: 'ifrs_Assets', name: '자산총계', statement: 'BS', value: 100 }];
    expect(resolveMetric(KIFRS_ACCOUNT_MAP, 'totalAssets', old).sourceTag).toBe('ifrs_Assets');
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
