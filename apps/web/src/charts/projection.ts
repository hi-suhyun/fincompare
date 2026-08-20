import type { AnalystTarget, CompanyConsensus } from '../lib/api.js';

/**
 * 목표주가를 주가 선의 **연장**으로 그린다.
 *
 * 가로 띠로 눕혔더니 두 가지가 잘못 읽혔다. 전 구간에 깔려서 "2016년에도
 * 이렇게 봤다" 로 보였고, 증권사별 편차가 한 덩어리로 뭉개져 평균 근처에
 * 다 몰려 있는 것처럼 보였다.
 *
 * 지금까지의 실제 주가는 한 줄 그대로 두고, 마지막 실제 지점에서 다음
 * 구간까지 증권사별로 한 가닥씩 옅게 뻗는다. 부챗살이 벌어진 폭이 곧
 * 증권가의 의견 차이다.
 */

/** 한 가닥. 마지막 실제 주가에서 목표가까지 잇는다 */
export interface Projection {
  companyId: string;
  /** 차트 dataKey. 회사·증권사마다 달라야 선이 섞이지 않는다 */
  key: string;
  firm: string;
  target: number;
  date?: string | undefined;
  previous?: number | undefined;
}

/**
 * 다음 구간 라벨.
 *
 * "2026Q4" -> "2027Q1", "2026" -> "2027".
 * buildPeriodAxis 가 만드는 라벨과 같은 형식이어야 축이 이어진다.
 */
export function nextPeriodLabel(label: string): string {
  const quarter = /^(\d{4})Q([1-4])$/.exec(label);
  if (quarter === null) return String(Number(label) + 1);

  const year = Number(quarter[1]);
  const q = Number(quarter[2]);
  return q === 4 ? `${year + 1}Q1` : `${year}Q${q + 1}`;
}

/**
 * 대표 증권사를 고른다.
 *
 * 전부 그리면 열 가닥이 겹쳐 아무것도 안 보인다. 최고·최저는 반드시 넣고,
 * 나머지는 사이를 고르게 나눠 집는다 — 평균 근처만 뽑으면 의견 차이가
 * 실제보다 좁아 보인다.
 */
export function pickRepresentative(
  analysts: readonly AnalystTarget[],
  max: number,
): AnalystTarget[] {
  const sorted = [...analysts].sort((a, b) => b.target - a.target);
  if (sorted.length <= max) return sorted;

  const picked: AnalystTarget[] = [];
  for (let i = 0; i < max; i++) {
    // 0 과 max-1 이 정확히 양 끝에 떨어진다
    const index = Math.round((i * (sorted.length - 1)) / (max - 1));
    const item = sorted[index];
    if (item !== undefined && !picked.includes(item)) picked.push(item);
  }
  return picked;
}

/** 한 기업의 목표주가를 가닥으로 편다 */
export function projectionsFor(
  consensus: CompanyConsensus,
  max: number,
): Projection[] {
  const analysts = consensus.priceTarget?.analysts ?? [];
  if (analysts.length === 0) return [];

  return pickRepresentative(analysts, max).map((a, index) => ({
    companyId: consensus.companyId,
    key: `${consensus.companyId}__proj${index}`,
    firm: a.firm,
    target: a.target,
    date: a.date,
    previous: a.previous,
  }));
}

/**
 * 마지막으로 실제값이 있는 자리.
 *
 * 여기서부터 가닥이 뻗는다. 끝에서 두 번째가 아니라 **값이 있는** 마지막
 * 자리를 찾아야 한다 — 분기 축은 아직 안 지난 분기가 뒤에 비어 있다.
 */
export function lastActualIndex(values: ReadonlyArray<number | null>): number {
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] !== null && values[i] !== undefined) return i;
  }
  return -1;
}
