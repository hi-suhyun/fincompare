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

/** 가닥을 몇 개까지 그릴지. 넘으면 겹쳐서 오히려 안 읽힌다 */
export const MAX_PROJECTIONS = 4;

/** 한 가닥. 마지막 실제 주가에서 목표가까지 잇는다 */
export interface Projection {
  companyId: string;
  /** 차트 dataKey. 회사·증권사마다 달라야 선이 섞이지 않는다 */
  key: string;
  /** 증권사 이름. 집계만 있을 때는 '최고'·'평균'·'최저' 가 들어간다 */
  firm: string;
  target: number;
  /**
   * 개별 증권사가 아니라 **집계에서 뽑은** 가닥인지.
   *
   * FMP 무료 구간은 증권사별 목록을 주지 않고 최고·평균·최저만 준다.
   * 그것도 부챗살로 그릴 수는 있지만, 화면에서 "어느 증권사" 라고 말하면
   * 거짓이 된다.
   */
  aggregate?: boolean;
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

  if (analysts.length > 0) {
    return pickRepresentative(analysts, max).map((a, index) => ({
      companyId: consensus.companyId,
      key: `${consensus.companyId}__proj${index}`,
      firm: a.firm,
      target: a.target,
      date: a.date,
      previous: a.previous,
    }));
  }

  /*
   * 증권사별 목록이 없으면 집계로 부챗살을 만든다.
   *
   * FMP 무료 구간은 최고·평균·최저만 준다. 가닥을 하나도 안 그리면 미국
   * 기업에서는 컨센서스가 통째로 안 보인다 — 실제로 엔비디아가 그랬다.
   * 폭은 그대로 드러나므로 부챗살의 뜻은 살아 있다.
   */
  const t = consensus.priceTarget;
  if (t === null || t === undefined) return [];

  const rows: Array<[string, number | null]> = [
    ['최고', t.high],
    ['평균', t.avg],
    ['최저', t.low],
  ];

  return rows
    .filter((row): row is [string, number] => row[1] !== null)
    .map(([label, value], index) => ({
      companyId: consensus.companyId,
      key: `${consensus.companyId}__proj${index}`,
      firm: label,
      target: value,
      aggregate: true,
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
