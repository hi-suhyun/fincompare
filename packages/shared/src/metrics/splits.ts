import type { BaseMetricId } from '../schema/financial.js';

/**
 * 액면분할·병합 감지.
 *
 * 왜 필요한가: 주당 지표(EPS·BPS)는 공시값이라 그 시점의 액면가 기준이다.
 * 삼성전자는 2018년 5월에 50:1 액면분할을 했다.
 *
 *   2017  EPS 299,868원
 *   2018  EPS   6,461원
 *
 * 조정 없이 한 차트에 그리면 이익이 98% 증발한 것처럼 보인다.
 * 실제로는 주식 수가 50배 늘었을 뿐이다.
 *
 * 완전한 해결은 과거 값을 현재 액면 기준으로 환산하는 것이지만(Phase 5, 주가와 함께),
 * 그 전까지는 최소한 **불연속 지점을 찾아 표시**해야 한다.
 * 조용히 잘못 읽히게 두는 것이 가장 나쁘다.
 */

/** 주당 지표 — 액면분할의 영향을 직접 받는다 */
export const PER_SHARE_METRICS: ReadonlySet<BaseMetricId | string> = new Set([
  'eps',
  'bps',
  'closePrice',
  'per',
  'pbr',
]);

/** 이 배수를 넘는 주식수 변동은 증자·자사주로 설명하기 어렵다 */
export const SPLIT_RATIO_THRESHOLD = 1.5;

export interface SplitEvent {
  /** 변동이 감지된 기간 라벨 */
  period: string;
  /** 직전 대비 주식수 배수. 50 이면 50:1 분할, 0.2 면 5:1 병합 */
  ratio: number;
  kind: 'SPLIT' | 'REVERSE_SPLIT';
}

/**
 * 주식수 시계열에서 급변 지점을 찾는다.
 *
 * 유상증자와 구분하려면 자본금 변화를 함께 봐야 한다:
 *   액면분할 — 주식수 증가, 자본금 그대로 (액면가만 낮아진다)
 *   유상증자 — 주식수 증가, 자본금도 증가
 *
 * `issuedCapital` 을 주면 그 구분을 적용하고, 없으면 주식수만으로 판단한다.
 */
export function detectSplits(
  periods: readonly string[],
  shares: readonly (number | null)[],
  issuedCapital?: readonly (number | null)[],
): SplitEvent[] {
  const events: SplitEvent[] = [];

  for (let i = 1; i < shares.length; i++) {
    const prev = shares[i - 1] ?? null;
    const curr = shares[i] ?? null;
    if (prev === null || curr === null || prev <= 0 || curr <= 0) continue;

    const ratio = curr / prev;
    if (ratio < SPLIT_RATIO_THRESHOLD && ratio > 1 / SPLIT_RATIO_THRESHOLD) continue;

    // 자본금이 함께 비슷한 비율로 늘었으면 증자다 — 액면분할이 아니다
    if (issuedCapital !== undefined) {
      const prevCapital = issuedCapital[i - 1] ?? null;
      const currCapital = issuedCapital[i] ?? null;
      if (prevCapital !== null && currCapital !== null && prevCapital > 0) {
        const capitalRatio = currCapital / prevCapital;
        // 자본금 변동이 주식수 변동의 절반을 넘으면 증자로 본다
        if (Math.abs(capitalRatio - 1) > Math.abs(ratio - 1) * 0.5) continue;
      }
    }

    const period = periods[i];
    if (period === undefined) continue;

    events.push({ period, ratio, kind: ratio > 1 ? 'SPLIT' : 'REVERSE_SPLIT' });
  }

  return events;
}

/** 사용자에게 보여줄 문구 */
export function describeSplit(event: SplitEvent): string {
  if (event.kind === 'SPLIT') {
    return `${event.period}년경 액면분할 추정 (주식수 ${event.ratio.toFixed(1)}배). ` +
      `주당 지표는 각 시점 공시값이라 이 구간에서 불연속입니다.`;
  }
  return `${event.period}년경 액면병합 추정 (주식수 ${(1 / event.ratio).toFixed(1)}:1). ` +
    `주당 지표는 각 시점 공시값이라 이 구간에서 불연속입니다.`;
}
