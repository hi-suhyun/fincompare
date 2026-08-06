/**
 * 국내 주요 기업의 통용 별칭.
 *
 * 왜 필요한가: DART 의 공식 종목명과 투자자가 실제로 치는 이름이 다르다.
 *   DART '현대자동차'  ← 사람들은 '현대차'
 *   DART '기아'        ← 예전 이름 '기아자동차'로도 찾는다
 *   DART 'LG에너지솔루션' ← '엘지엔솔', 'LG엔솔'
 *
 * 별칭이 없으면 초성 검색도 어긋난다. '현대차' 의 초성은 ㅎㄷㅊ 인데
 * '현대자동차' 의 초성은 ㅎㄷㅈㄷㅊ 라서 ㅎㄷㅊ 로는 안 나온다.
 *
 * `major` 는 검색 순위 보정용이다. 'samsung' 을 치면 삼성제약이 아니라
 * 삼성전자가 먼저 나와야 하는데, 시가총액 데이터가 없는 지금은
 * 이 목록이 그 역할을 한다. Phase 5 에서 시가총액이 들어오면 대체할 수 있다.
 *
 * 손으로 관리하는 목록이라 완전하지 않다. 빠진 기업은 공식 종목명으로는 정상 검색된다.
 */

export interface KoreanAliasEntry {
  stockCode: string;
  /** 통용 별칭. 공식 종목명은 시딩 때 자동으로 들어가므로 여기 적지 않는다 */
  aliases: readonly string[];
  /** 검색 순위를 끌어올릴 대형·유명주 */
  major?: boolean;
}

export const KOREAN_ALIASES: readonly KoreanAliasEntry[] = [
  // ── 시가총액 상위 ────────────────────────────────────────────
  { stockCode: '005930', aliases: ['삼전', '삼성전자보통주'], major: true },
  { stockCode: '000660', aliases: ['하닉', '에스케이하이닉스'], major: true },
  { stockCode: '373220', aliases: ['LG엔솔', '엘지엔솔', '엘지에너지솔루션'], major: true },
  { stockCode: '207940', aliases: ['삼바', '삼성바이오'], major: true },
  { stockCode: '005380', aliases: ['현대차', '현대자동차주식회사'], major: true },
  { stockCode: '000270', aliases: ['기아자동차', '기아차'], major: true },
  { stockCode: '005490', aliases: ['포스코', '포스코홀딩스', '포항제철'], major: true },
  { stockCode: '068270', aliases: ['셀트', '셀트리온헬스케어'], major: true },
  { stockCode: '035420', aliases: ['네이버', 'naver', 'NHN'], major: true },
  { stockCode: '035720', aliases: ['다음카카오'], major: true },
  { stockCode: '051910', aliases: ['LG화학', '엘지화학'], major: true },
  { stockCode: '006400', aliases: ['삼성SDI', '삼성에스디아이'], major: true },
  { stockCode: '012330', aliases: ['모비스'], major: true },
  { stockCode: '105560', aliases: ['KB금융지주', '국민은행'], major: true },
  { stockCode: '055550', aliases: ['신한지주', '신한은행'], major: true },
  { stockCode: '086790', aliases: ['하나은행', '하나금융지주'], major: true },
  { stockCode: '316140', aliases: ['우리은행', '우리금융지주'], major: true },
  { stockCode: '000810', aliases: ['삼성화재해상보험'], major: true },
  { stockCode: '032830', aliases: ['삼성생명보험'], major: true },
  { stockCode: '009150', aliases: ['삼전기'], major: true },
  { stockCode: '028260', aliases: ['삼성물산'], major: true },
  { stockCode: '066570', aliases: ['LG전자', '엘지전자'], major: true },
  { stockCode: '003550', aliases: ['LG', '엘지', 'LG그룹'], major: true },
  { stockCode: '017670', aliases: ['SK텔레콤', 'SKT', '에스케이텔레콤'], major: true },
  { stockCode: '030200', aliases: ['KT', '케이티', '한국통신'], major: true },
  { stockCode: '032640', aliases: ['LG유플러스', '엘지유플러스', 'LGU+'], major: true },
  { stockCode: '015760', aliases: ['한국전력', '한전'], major: true },
  { stockCode: '034730', aliases: ['SK', '에스케이'], major: true },
  { stockCode: '096770', aliases: ['SK이노베이션', '에스케이이노베이션'], major: true },
  { stockCode: '010950', aliases: ['S-Oil', '에스오일', '쌍용정유'], major: true },
  { stockCode: '011200', aliases: ['HMM', '현대상선'], major: true },
  { stockCode: '009540', aliases: ['HD한국조선해양', '현대중공업지주'], major: true },
  { stockCode: '010140', aliases: ['삼성중공업'], major: true },
  { stockCode: '042660', aliases: ['한화오션', '대우조선해양', 'DSME'], major: true },
  { stockCode: '012450', aliases: ['한화에어로', '한화에어로스페이스'], major: true },
  { stockCode: '047810', aliases: ['KAI', '한국항공우주산업'], major: true },
  { stockCode: '064350', aliases: ['현대로템'], major: true },
  { stockCode: '018260', aliases: ['삼성SDS', '삼성에스디에스'], major: true },
  { stockCode: '036570', aliases: ['NC', '엔씨', 'NC소프트'], major: true },
  { stockCode: '251270', aliases: ['넷마블게임즈'], major: true },
  { stockCode: '259960', aliases: ['크래프톤', '배틀그라운드'], major: true },
  { stockCode: '293490', aliases: ['카겜'], major: true },
  { stockCode: '035900', aliases: ['JYP', 'JYP엔터'], major: true },
  { stockCode: '041510', aliases: ['SM', 'SM엔터', '에스엠엔터테인먼트'] },
  { stockCode: '352820', aliases: ['하이브', 'HYBE', '빅히트'], major: true },
  { stockCode: '122870', aliases: ['와이지', 'YG', 'YG엔터'] },
  { stockCode: '128940', aliases: ['한미약품'], major: true },
  { stockCode: '000100', aliases: ['유한양행'], major: true },
  { stockCode: '302440', aliases: ['SK바이오사이언스'], major: true },
  { stockCode: '326030', aliases: ['SK바이오팜'], major: true },
  { stockCode: '196170', aliases: ['알테오젠'], major: true },
  { stockCode: '247540', aliases: ['에코프로비엠', '에코프로BM'], major: true },
  { stockCode: '086520', aliases: ['에코프로'], major: true },
  { stockCode: '066970', aliases: ['엘앤에프', 'L&F'], major: true },
  { stockCode: '003670', aliases: ['포스코퓨처엠', '포스코케미칼'], major: true },
  { stockCode: '000120', aliases: ['CJ대한통운', '대한통운'] },
  { stockCode: '097950', aliases: ['CJ제일제당', '제일제당'], major: true },
  { stockCode: '271560', aliases: ['오리온'], major: true },
  { stockCode: '004370', aliases: ['농심', '신라면'], major: true },
  { stockCode: '033780', aliases: ['KT&G', '담배인삼공사'], major: true },
  { stockCode: '090430', aliases: ['아모레퍼시픽', '아모레'], major: true },
  { stockCode: '051900', aliases: ['LG생활건강', 'LG생건', '엘지생활건강'], major: true },
  { stockCode: '069960', aliases: ['현대백화점'] },
  { stockCode: '004170', aliases: ['신세계백화점'] },
  { stockCode: '139480', aliases: ['이마트'], major: true },
  { stockCode: '282330', aliases: ['BGF리테일', 'CU', '씨유'] },
  { stockCode: '023530', aliases: ['롯데쇼핑', '롯데백화점'] },
  { stockCode: '267250', aliases: ['HD현대', '현대중공업홀딩스'], major: true },
  { stockCode: '241560', aliases: ['두산밥캣'], major: true },
  { stockCode: '000150', aliases: ['두산'], major: true },
  { stockCode: '034020', aliases: ['두산에너빌리티', '두산중공업'], major: true },
  { stockCode: '010130', aliases: ['고려아연'], major: true },
  { stockCode: '011170', aliases: ['롯데케미칼', '호남석유화학'] },
  { stockCode: '002790', aliases: ['아모레G', '아모레퍼시픽그룹'] },
  { stockCode: '323410', aliases: ['카뱅'], major: true },
  { stockCode: '377300', aliases: ['카페이'], major: true },
  { stockCode: '138040', aliases: ['메리츠금융지주', '메리츠'], major: true },
  { stockCode: '024110', aliases: ['기업은행', 'IBK'], major: true },
  { stockCode: '316140', aliases: ['우리금융'], major: true },
  { stockCode: '029780', aliases: ['삼성카드'] },
  { stockCode: '005940', aliases: ['NH투자증권', '우리투자증권'] },
  { stockCode: '016360', aliases: ['삼성증권'] },
  { stockCode: '006800', aliases: ['미래에셋증권', '미래에셋대우'] },
  { stockCode: '039490', aliases: ['키움증권', '키움'] },
];

/** stockCode -> 별칭 목록 */
export const ALIAS_BY_STOCK_CODE: ReadonlyMap<string, readonly string[]> = new Map(
  KOREAN_ALIASES.map((e) => [e.stockCode, e.aliases]),
);

/** 검색 순위를 끌어올릴 종목코드 */
export const MAJOR_STOCK_CODES: ReadonlySet<string> = new Set(
  KOREAN_ALIASES.filter((e) => e.major === true).map((e) => e.stockCode),
);

/** 순위 보정값. 클수록 위로 온다 */
export const PROMINENCE_MAJOR = 100;
export const PROMINENCE_DEFAULT = 0;

export function prominenceFor(stockCode: string): number {
  return MAJOR_STOCK_CODES.has(stockCode) ? PROMINENCE_MAJOR : PROMINENCE_DEFAULT;
}
