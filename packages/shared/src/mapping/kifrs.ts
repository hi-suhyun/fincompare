import type { AccountMap } from './types.js';

/**
 * K-IFRS (DART fnlttSinglAcntAll) -> 내부 표준 스키마
 *
 * account_id 를 1순위 키로 쓴다.
 */
export const KIFRS_ACCOUNT_MAP: AccountMap = {
  revenue: {
    tags: [
      'ifrs-full_Revenue',
      'ifrs_Revenue',
      'ifrs-full_RevenueFromSaleOfGoods',
      'ifrs-full_RevenueFromRenderingOfServices',
    ],
    namePattern: /^(매출액?|수익\(매출액\)|영업수익)$/,
    statements: ['IS', 'CIS'],
  },

  operatingIncome: {
    // 영업이익은 IFRS 표준 태그가 없다. IFRS 가 영업손익 표시를 강제하지 않아서
    // 한국은 금감원 확장 태그 dart_OperatingIncomeLoss 를 쓴다.
    // 'ifrs-full_' 접두어로만 찾으면 영업이익이 통째로 빠진다.
    tags: ['dart_OperatingIncomeLoss', 'ifrs-full_ProfitLossFromOperatingActivities'],
    namePattern: /^영업이익(\(손실\))?$/,
    statements: ['IS', 'CIS'],
    note: 'IFRS 표준 태그 없음 — 금감원 확장 태그 사용',
  },

  netIncome: {
    // 지배주주 귀속분. US GAAP NetIncomeLoss 와 대응되는 값이다.
    tags: ['ifrs-full_ProfitLossAttributableToOwnersOfParent'],
    namePattern: /지배(기업)?\s*(소유주|주주).*(순이익|당기순이익)/,
    statements: ['IS', 'CIS'],
  },

  netIncomeTotal: {
    tags: ['ifrs-full_ProfitLoss'],
    // 현대차처럼 표준계정코드를 쓰지 않고 '연결당기순이익'으로 적는 기업이 있다
    namePattern: /^(연결)?당기순이익(\(손실\))?$/,
    statements: ['IS', 'CIS'],
  },

  totalAssets: {
    tags: ['ifrs-full_Assets'],
    namePattern: /^자산총계$/,
    statements: ['BS'],
  },

  totalLiabilities: {
    tags: ['ifrs-full_Liabilities'],
    namePattern: /^부채총계$/,
    statements: ['BS'],
  },

  totalEquity: {
    tags: ['ifrs-full_Equity'],
    namePattern: /^자본총계$/,
    statements: ['BS'],
  },

  equityControlling: {
    // US GAAP StockholdersEquity 와 대응
    tags: ['ifrs-full_EquityAttributableToOwnersOfParent'],
    namePattern: /지배(기업)?\s*(소유주|주주)\s*지분/,
    statements: ['BS'],
  },

  eps: {
    // 공시된 기본주당이익을 그대로 쓴다. 직접 계산하면 참가적 우선주가 있는 기업에서 틀린다.
    // 삼성전자 2023: 공시 2,131원 vs 보통주로 나눈 계산값 2,424원.
    tags: ['ifrs-full_BasicEarningsLossPerShare'],
    //
    // 표기가 기업마다 두 갈래다:
    //   삼성전자  '기본주당이익(손실)'      2,131원   (보통주·우선주 통합 배분)
    //   현대차    '보통주 기본주당이익'    28,521원   (보통주)
    //            '1우선주 기본주당이익'   28,207원   (우선주 — 쓰면 안 된다)
    //
    // 우선주 EPS 를 집으면 PER 이 조용히 어긋난다. '우선주'가 들어간 계정은 배제한다.
    namePattern: /^(?!.*우선주)(보통주\s*)?기본주당(순)?이익/,
    statements: ['IS', 'CIS'],
    note: '공시값 사용. 직접 계산 금지. 우선주 EPS 배제',
  },
};
