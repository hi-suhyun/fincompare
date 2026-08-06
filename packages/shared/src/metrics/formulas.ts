/**
 * 지표 계산식. 전부 순수 함수이고 DB·네트워크 의존이 없다.
 *
 * 공통 규칙
 *  - 입력이 하나라도 null 이면 결과는 null (결측 전파)
 *  - 분모가 0 이면 null. Infinity / NaN 을 절대 내보내지 않는다
 *  - 비율은 소수(0.13)로 반환한다. % 변환은 표시 레이어에서 한다
 */

export type Num = number | null;

/** 유한수가 아니면 null 로 떨어뜨린다. 모든 계산의 최종 관문 */
const finite = (v: number): Num => (Number.isFinite(v) ? v : null);

/** 결측 전파 + 0 분모 방어를 한 곳에 모은 나눗셈 */
export function safeDivide(numerator: Num, denominator: Num): Num {
  if (numerator === null || denominator === null) return null;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator === 0) return null;
  return finite(numerator / denominator);
}

export function safeMultiply(a: Num, b: Num): Num {
  if (a === null || b === null) return null;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return finite(a * b);
}

export function safeAverage(a: Num, b: Num): Num {
  if (a === null || b === null) return null;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return finite((a + b) / 2);
}

// ---------------------------------------------------------------- 수익성

export const operatingMargin = (operatingIncome: Num, revenue: Num): Num =>
  safeDivide(operatingIncome, revenue);

export const netMargin = (netIncome: Num, revenue: Num): Num => safeDivide(netIncome, revenue);

/**
 * ROE = 지배주주순이익 / 평균 지배주주지분
 *
 * 반드시 지배주주 기준으로 계산한다. US GAAP `NetIncomeLoss` 와 `StockholdersEquity` 는
 * 이미 비지배지분이 빠진 값이라, K-IFRS 쪽에서 `ProfitLoss`(총액)를 쓰면
 * 비지배지분이 큰 기업의 ROE 가 국가별로 체계적으로 왜곡된다.
 *
 * 기초자본이 없으면(첫 해 등) 기말자본으로 계산하고 호출부가 경고를 붙인다.
 */
export function roe(netIncomeControlling: Num, beginningEquity: Num, endingEquity: Num): Num {
  const avg = beginningEquity === null ? endingEquity : safeAverage(beginningEquity, endingEquity);
  return safeDivide(netIncomeControlling, avg);
}

/** 부채비율 = 부채총계 / 자본총계 (한국식). 자본잠식이면 음수가 나오는데 그대로 둔다 */
export const debtRatio = (totalLiabilities: Num, totalEquity: Num): Num =>
  safeDivide(totalLiabilities, totalEquity);

// ------------------------------------------------------------- 밸류에이션

/**
 * EPS 폴백 계산.
 *
 * ⚠️ 가능하면 쓰지 말 것. EPS 는 공시값(`ifrs-full_BasicEarningsLossPerShare` /
 * `EarningsPerShareBasic`)을 그대로 쓰는 게 원칙이다.
 *
 * 이유: 참가적 우선주가 있으면 이익이 보통주·우선주에 배분된다.
 * 삼성전자 2023 공시 EPS 는 2,131원인데 지배주주순이익을 보통주 유통주식수로
 * 나누면 2,424원(13.7% 과대)이 나온다. 총 주식수로 나눠야 2,131원이 된다.
 * 배분 규칙은 기업마다 다르므로 직접 계산은 근사치일 뿐이다.
 *
 * 그래서 분모로 **총 주식수(보통주+우선주)**를 받는다. 공시값이 없는 기업에서만 쓰고,
 * 화면에는 "추정치" 표시를 붙여야 한다.
 */
export const estimateEps = (netIncomeControlling: Num, sharesTotal: Num): Num =>
  safeDivide(netIncomeControlling, sharesTotal);

/**
 * BPS = 지배주주지분 / 총 주식수
 *
 * EPS 와 같은 분모를 써야 PER 과 PBR 이 서로 일관된다.
 * 보통주만으로 나누면 우선주가 있는 기업의 PBR 이 PER 과 다른 기준이 되어
 * 두 지표를 나란히 놓고 볼 수 없다.
 */
export const bps = (equityControlling: Num, sharesTotal: Num): Num =>
  safeDivide(equityControlling, sharesTotal);

/**
 * PER = 주가 / EPS
 *
 * `epsValue` 는 공시된 기본주당이익을 넣는 게 원칙이다 (estimateEps 주석 참고).
 * EPS 가 0 이하면 null. 적자 기업의 음수 PER 은 해석이 불가능하고,
 * 차트에 그리면 축 스케일을 망가뜨린다.
 */
export function per(closePrice: Num, epsValue: Num): Num {
  if (epsValue !== null && epsValue <= 0) return null;
  return safeDivide(closePrice, epsValue);
}

/** PBR = 주가 / BPS. 자본잠식(BPS <= 0)이면 null */
export function pbr(closePrice: Num, bpsValue: Num): Num {
  if (bpsValue !== null && bpsValue <= 0) return null;
  return safeDivide(closePrice, bpsValue);
}

export const marketCap = (closePrice: Num, sharesOutstanding: Num): Num =>
  safeMultiply(closePrice, sharesOutstanding);
