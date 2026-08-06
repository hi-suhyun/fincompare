/**
 * 미국 기업의 한글 별칭.
 *
 * 왜 필요한가: SEC company_tickers.json 에는 영문명만 있다.
 *
 *   {"cik_str":1045810,"ticker":"NVDA","title":"NVIDIA CORP"}
 *
 * 할아버지는 "엔비디아"라고 치신다. 별칭이 없으면 검색이 아예 안 된다.
 * 전문성과 무관한 문제다 — 티커를 아셔도 한글로 치는 게 자연스럽다.
 *
 * 국내 투자자가 실제로 찾는 종목 위주로 손으로 관리한다.
 * 빠진 기업은 티커·영문명으로는 정상 검색된다.
 */

export interface UsAliasEntry {
  ticker: string;
  /** 한글 표기. 첫 번째가 대표 표기로 nameKo 에 들어간다 */
  korean: readonly string[];
  major?: boolean;
}

export const US_ALIASES: readonly UsAliasEntry[] = [
  // ── 반도체 ────────────────────────────────────────────────
  { ticker: 'NVDA', korean: ['엔비디아', '엔디비아'], major: true },
  { ticker: 'INTC', korean: ['인텔'], major: true },
  { ticker: 'AMD', korean: ['에이엠디', 'AMD'], major: true },
  { ticker: 'MU', korean: ['마이크론'], major: true },
  { ticker: 'AVGO', korean: ['브로드컴'], major: true },
  { ticker: 'QCOM', korean: ['퀄컴'], major: true },
  { ticker: 'TXN', korean: ['텍사스인스트루먼트', 'TI'], major: true },
  { ticker: 'AMAT', korean: ['어플라이드머티어리얼즈', '어플라이드'], major: true },
  { ticker: 'LRCX', korean: ['램리서치'], major: true },
  { ticker: 'KLAC', korean: ['KLA', '케이엘에이'] },
  { ticker: 'ADI', korean: ['아나로그디바이스'] },
  { ticker: 'ARM', korean: ['암', 'ARM홀딩스'] },

  // ── 빅테크 ────────────────────────────────────────────────
  { ticker: 'AAPL', korean: ['애플'], major: true },
  { ticker: 'MSFT', korean: ['마이크로소프트', 'MS'], major: true },
  { ticker: 'GOOGL', korean: ['알파벳', '구글'], major: true },
  { ticker: 'GOOG', korean: ['알파벳C', '구글C'] },
  { ticker: 'AMZN', korean: ['아마존'], major: true },
  { ticker: 'META', korean: ['메타', '페이스북'], major: true },
  { ticker: 'NFLX', korean: ['넷플릭스'], major: true },
  { ticker: 'ORCL', korean: ['오라클'], major: true },
  { ticker: 'CRM', korean: ['세일즈포스'], major: true },
  { ticker: 'ADBE', korean: ['어도비'], major: true },
  { ticker: 'IBM', korean: ['아이비엠', 'IBM'] },
  { ticker: 'CSCO', korean: ['시스코'] },
  { ticker: 'PLTR', korean: ['팔란티어'], major: true },
  { ticker: 'UBER', korean: ['우버'] },
  { ticker: 'ABNB', korean: ['에어비앤비'] },

  // ── 자동차·산업 ───────────────────────────────────────────
  { ticker: 'TSLA', korean: ['테슬라'], major: true },
  { ticker: 'F', korean: ['포드'] },
  { ticker: 'GM', korean: ['제너럴모터스', 'GM'] },
  { ticker: 'RIVN', korean: ['리비안'] },
  { ticker: 'BA', korean: ['보잉'], major: true },
  { ticker: 'CAT', korean: ['캐터필러'] },
  { ticker: 'GE', korean: ['제너럴일렉트릭', 'GE'] },
  { ticker: 'LMT', korean: ['록히드마틴'] },
  { ticker: 'RTX', korean: ['RTX', '레이시온'] },

  // ── 금융 ──────────────────────────────────────────────────
  { ticker: 'BRK-B', korean: ['버크셔해서웨이', '버크셔'], major: true },
  { ticker: 'JPM', korean: ['제이피모건', 'JP모건'], major: true },
  { ticker: 'BAC', korean: ['뱅크오브아메리카'] },
  { ticker: 'GS', korean: ['골드만삭스'], major: true },
  { ticker: 'MS', korean: ['모건스탠리'] },
  { ticker: 'V', korean: ['비자'], major: true },
  { ticker: 'MA', korean: ['마스터카드'], major: true },
  { ticker: 'PYPL', korean: ['페이팔'] },
  { ticker: 'COIN', korean: ['코인베이스'] },

  // ── 헬스케어 ──────────────────────────────────────────────
  { ticker: 'JNJ', korean: ['존슨앤드존슨', '존슨앤존슨', 'J&J'], major: true },
  { ticker: 'LLY', korean: ['일라이릴리', '릴리'], major: true },
  { ticker: 'PFE', korean: ['화이자'], major: true },
  { ticker: 'MRK', korean: ['머크'] },
  { ticker: 'ABBV', korean: ['애브비'] },
  { ticker: 'UNH', korean: ['유나이티드헬스'] },
  { ticker: 'MRNA', korean: ['모더나'] },

  // ── 소비재 ────────────────────────────────────────────────
  { ticker: 'KO', korean: ['코카콜라'], major: true },
  { ticker: 'PEP', korean: ['펩시코', '펩시'] },
  { ticker: 'MCD', korean: ['맥도날드'] },
  { ticker: 'SBUX', korean: ['스타벅스'] },
  { ticker: 'NKE', korean: ['나이키'] },
  { ticker: 'PG', korean: ['프록터앤드갬블', 'P&G'] },
  { ticker: 'COST', korean: ['코스트코'], major: true },
  { ticker: 'WMT', korean: ['월마트'], major: true },
  { ticker: 'HD', korean: ['홈디포'] },
  { ticker: 'DIS', korean: ['디즈니'], major: true },

  // ── 에너지 ────────────────────────────────────────────────
  { ticker: 'XOM', korean: ['엑슨모빌'], major: true },
  { ticker: 'CVX', korean: ['셰브론'] },
  { ticker: 'OXY', korean: ['옥시덴탈'] },
];

export const US_ALIAS_BY_TICKER: ReadonlyMap<string, UsAliasEntry> = new Map(
  US_ALIASES.map((e) => [e.ticker.toUpperCase(), e]),
);

export const PROMINENCE_MAJOR = 100;

export function usProminenceFor(ticker: string): number {
  return US_ALIAS_BY_TICKER.get(ticker.toUpperCase())?.major === true ? PROMINENCE_MAJOR : 0;
}

/** 대표 한글 표기. 없으면 null 이고 검색은 영문명·티커로만 된다 */
export function koreanNameFor(ticker: string): string | null {
  return US_ALIAS_BY_TICKER.get(ticker.toUpperCase())?.korean[0] ?? null;
}
