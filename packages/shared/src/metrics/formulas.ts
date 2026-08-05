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

export const eps = (netIncomeControlling: Num, sharesOutstanding: Num): Num =>
  safeDivide(netIncomeControlling, sharesOutstanding);

export const bps = (equityControlling: Num, sharesOutstanding: Num): Num =>
  safeDivide(equityControlling, sharesOutstanding);

/**
 * PER = 주가 / EPS
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
