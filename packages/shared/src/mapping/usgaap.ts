import type { AccountMap } from './types.js';

/**
 * US GAAP (SEC EDGAR companyfacts) -> 내부 표준 스키마
 *
 * 국가 간 비교에서 반드시 지켜야 할 등가관계:
 *
 *   US GAAP NetIncomeLoss      == K-IFRS ProfitLossAttributableToOwnersOfParent
 *   US GAAP ProfitLoss         == K-IFRS ProfitLoss
 *   US GAAP StockholdersEquity == K-IFRS EquityAttributableToOwnersOfParent
 *
 * US GAAP 의 NetIncomeLoss 와 StockholdersEquity 는 이름과 달리
 * 이미 비지배지분이 빠진 값이다. 이름만 보고 K-IFRS 의 총액 계정과 짝지으면
 * 비지배지분이 큰 기업(지주회사 등)의 ROE / PER 이 국가별로 체계적으로 왜곡된다.
 */
export const USGAAP_ACCOUNT_MAP: AccountMap = {
  revenue: {
    // ASC 606(2018) 전후로 태그가 바뀐다. 우선순위 배열이 그 전환을 흡수한다.
    tags: [
      'RevenueFromContractWithCustomerExcludingAssessedTax',
      'Revenues',
      'RevenueFromContractWithCustomerIncludingAssessedTax',
      'SalesRevenueNet', // 2018 이전
      'SalesRevenueGoodsNet',
    ],
    note: 'ASC 606 전환(2018) 경계에서 태그가 바뀜',
  },

  operatingIncome: {
    tags: ['OperatingIncomeLoss'],
    // 은행·보험 등 상당수 금융사는 이 태그를 아예 태깅하지 않는다 -> null + 경고
    note: '미국 금융사 상당수가 미태깅 — 결측 시 METRIC_NOT_TAGGED',
  },

  netIncome: {
    tags: ['NetIncomeLoss'],
    note: '이미 비지배지분 제외 — 지배주주순이익에 해당',
  },

  netIncomeTotal: {
    tags: ['ProfitLoss', 'NetIncomeLoss'],
  },

  totalAssets: {
    tags: ['Assets'],
  },

  totalLiabilities: {
    // Liabilities 를 태깅하지 않는 기업이 있다.
    // 그 경우 어댑터가 Assets - Equity(비지배포함) 로 파생 계산한다.
    tags: ['Liabilities'],
    note: '미태깅 시 Assets - StockholdersEquityIncluding...NoncontrollingInterest 로 파생',
  },

  totalEquity: {
    tags: [
      'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
      'StockholdersEquity',
    ],
  },

  equityControlling: {
    tags: ['StockholdersEquity'],
    note: '이미 지배주주지분만 — 비지배지분 미포함',
  },

  sharesOutstanding: {
    tags: [
      'EntityCommonStockSharesOutstanding', // dei 택사노미
      'CommonStockSharesOutstanding',
      'CommonStockSharesIssued',
      'WeightedAverageNumberOfDilutedSharesOutstanding',
    ],
  },
};

/** totalLiabilities 미태깅 시 파생 계산에 쓰는 태그 */
export const USGAAP_EQUITY_INCL_NCI_TAG =
  'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest';

/** ADR / 외국사기업 판별용 서식 코드. 1차 범위에서 제외한다 */
export const FOREIGN_ISSUER_FORMS = ['20-F', '40-F', '6-K'] as const;
