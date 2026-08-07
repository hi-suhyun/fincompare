/**
 * 기업별 고정 색상.
 *
 * Okabe-Ito 색맹 안전 팔레트를 쓴다. 국내 투자자에게 익숙한 빨강=상승/파랑=하락
 * 관행과 섞이지 않도록, 등락을 뜻하지 않는 중립적인 색만 고른다.
 *
 * 색만으로 구분하지 않는다 — 선 스타일(실선/파선/점선)을 함께 달리해서
 * 색 구분이 어려운 경우에도 읽히게 한다 (docs/03-user-context.md 2.5).
 */

export interface SeriesStyle {
  color: string;
  /** SVG stroke-dasharray. null 이면 실선 */
  dash: string | null;
  /** 접근성 라벨. 범례에서 색 이름을 함께 읽어줄 때 쓴다 */
  label: string;
}

/** 최대 5개 기업까지 비교한다 */
export const MAX_COMPANIES = 5;

/** 지표는 최대 4개까지 동시 선택 */
export const MAX_METRICS = 4;

export const SERIES_STYLES: readonly SeriesStyle[] = [
  { color: '#0072B2', dash: null, label: '파랑' },
  { color: '#D55E00', dash: '8 4', label: '주황빨강' },
  { color: '#009E73', dash: '2 3', label: '초록' },
  { color: '#CC79A7', dash: '10 3 2 3', label: '분홍' },
  { color: '#E69F00', dash: '4 2', label: '노랑주황' },
];

export function styleForIndex(index: number): SeriesStyle {
  const style = SERIES_STYLES[index % SERIES_STYLES.length];
  if (style === undefined) throw new Error(`색상 팔레트가 비어 있습니다`);
  return style;
}

/**
 * 겹쳐 보기에서 **지표**를 구분하는 선 스타일.
 *
 * 겹치면 한 차트에 (기업 × 지표) 조합이 다 들어온다. 두 축으로 나눠 읽게 한다:
 *   색   = 기업  (쌓아 보기와 같은 색을 유지해야 눈이 다시 배우지 않는다)
 *   선   = 지표
 *
 * 그래서 기업 색상용 dash 와는 별도 목록이 필요하다.
 */
export interface MetricLineStyle {
  dash: string | null;
  label: string;
}

export const METRIC_LINE_STYLES: readonly MetricLineStyle[] = [
  { dash: null, label: '실선' },
  { dash: '7 4', label: '파선' },
  { dash: '2 3', label: '점선' },
  { dash: '12 3 2 3', label: '일점쇄선' },
];

export function metricLineStyle(index: number): MetricLineStyle {
  const style = METRIC_LINE_STYLES[index % METRIC_LINE_STYLES.length];
  if (style === undefined) throw new Error('지표 선 스타일 목록이 비어 있습니다');
  return style;
}

/**
 * 겹쳐 보기가 읽을 만한 선 개수의 상한.
 *
 * 기업 5개 × 지표 4개 = 20개까지 가능한데, 그쯤 되면 색과 선 스타일로도
 * 구분이 안 된다. 넘으면 화면에서 안내한다 (막지는 않는다 — 판단은 사용자 몫).
 */
export const OVERLAY_READABLE_LINES = 8;

/**
 * 차트 개수에 따른 높이(px).
 * 1개 400 -> 4개 200. 그 이하로는 줄이지 않는다 — 읽을 수 없어진다.
 */
export function chartHeight(chartCount: number): number {
  const heights: Record<number, number> = { 1: 400, 2: 280, 3: 230, 4: 200 };
  return heights[Math.min(Math.max(chartCount, 1), 4)] ?? 200;
}

/** 차트 선 굵기. Recharts 기본 1px 은 고령 사용자에게 너무 얇다 */
export const LINE_WIDTH = 2.5;
export const LINE_WIDTH_HOVER = 3.5;
