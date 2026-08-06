import type { BaseMetricId, DerivedMetricId, MetricId, WarningCode } from '../schema/financial.js';
import {
  bps,
  debtRatio,
  estimateEps,
  marketCap,
  netMargin,
  operatingMargin,
  pbr,
  per,
  roe,
  type Num,
} from './formulas.js';

/**
 * BASE 지표에서 파생지표를 계산한다.
 *
 * 파생지표는 저장하지 않고 조회 시점에 계산한다. 계산식이 바뀌어도 재백필이 필요 없고,
 * 통화·TTM 조합이 곱집합으로 늘어나지 않는다.
 */

/** 한 기간의 BASE 값 모음 */
export type FactMap = ReadonlyMap<BaseMetricId, Num>;

export interface DerivedResult {
  value: Num;
  warnings: WarningCode[];
}

const get = (facts: FactMap, id: BaseMetricId): Num => facts.get(id) ?? null;

/**
 * @param facts     이번 기간의 BASE 값
 * @param prevFacts 직전 기간의 BASE 값. ROE 의 기초자본에 쓴다. 없으면 기말자본으로 폴백
 */
export function deriveMetric(
  metricId: DerivedMetricId,
  facts: FactMap,
  prevFacts?: FactMap,
): DerivedResult {
  const warnings: WarningCode[] = [];

  switch (metricId) {
    case 'operatingMargin':
      return { value: operatingMargin(get(facts, 'operatingIncome'), get(facts, 'revenue')), warnings };

    case 'netMargin':
      return { value: netMargin(get(facts, 'netIncome'), get(facts, 'revenue')), warnings };

    case 'roe': {
      const beginning = prevFacts === undefined ? null : get(prevFacts, 'equityControlling');
      const ending = get(facts, 'equityControlling');
      if (beginning === null && ending !== null) warnings.push('ROE_USED_ENDING_EQUITY');
      return { value: roe(get(facts, 'netIncome'), beginning, ending), warnings };
    }

    case 'debtRatio':
      return { value: debtRatio(get(facts, 'totalLiabilities'), get(facts, 'totalEquity')), warnings };

    case 'bps':
      return { value: bps(get(facts, 'equityControlling'), sharesForPerShare(facts)), warnings };

    case 'per': {
      const price = requirePrice(facts, warnings);
      const epsValue = epsFor(facts, warnings);
      if (epsValue !== null && epsValue <= 0) warnings.push('NEGATIVE_EPS');
      return { value: per(price, epsValue), warnings };
    }

    case 'pbr': {
      const price = requirePrice(facts, warnings);
      const bpsValue = bps(get(facts, 'equityControlling'), sharesForPerShare(facts));
      return { value: pbr(price, bpsValue), warnings };
    }

    case 'marketCap': {
      // 시가총액은 보통주 기준이다. 우선주는 별도 종목으로 거래된다.
      const price = requirePrice(facts, warnings);
      return { value: marketCap(price, get(facts, 'sharesOutstanding')), warnings };
    }
  }
}

/**
 * 주가를 읽되, 없으면 이유를 남긴다.
 *
 * 밸류에이션 지표가 통째로 비어 있을 때 "왜 안 나오지"를 화면에서 알 수 있어야 한다.
 * 값이 없는 것과 계산이 불가능한 것은 사용자에게 다른 정보다.
 */
function requirePrice(facts: FactMap, warnings: WarningCode[]): Num {
  const price = get(facts, 'closePrice');
  if (price === null) warnings.push('PRICE_UNAVAILABLE');
  return price;
}

/**
 * EPS·BPS 의 분모.
 *
 * 총 주식수(보통주+우선주)를 쓴다. 참가적 우선주가 이익을 나눠 갖기 때문이다.
 * 총 주식수가 없으면 보통주 수로 폴백하지만, 우선주가 있는 기업에서는 과대계상된다.
 */
function sharesForPerShare(facts: FactMap): Num {
  return get(facts, 'sharesTotal') ?? get(facts, 'sharesOutstanding');
}

/**
 * PER 계산에 쓸 EPS.
 * 공시값이 있으면 그대로 쓰고, 없을 때만 추정한다 (docs/01-account-mapping.md 5.1).
 */
function epsFor(facts: FactMap, warnings: WarningCode[]): Num {
  const reported = get(facts, 'eps');
  if (reported !== null) return reported;

  const estimated = estimateEps(get(facts, 'netIncome'), sharesForPerShare(facts));
  if (estimated !== null) warnings.push('METRIC_NOT_TAGGED');
  return estimated;
}

/** 파생지표가 필요로 하는 BASE 지표. 어떤 데이터를 받아와야 하는지 결정할 때 쓴다 */
export const DERIVED_DEPENDENCIES: Record<DerivedMetricId, readonly BaseMetricId[]> = {
  operatingMargin: ['operatingIncome', 'revenue'],
  netMargin: ['netIncome', 'revenue'],
  roe: ['netIncome', 'equityControlling'],
  debtRatio: ['totalLiabilities', 'totalEquity'],
  bps: ['equityControlling', 'sharesTotal', 'sharesOutstanding'],
  per: ['closePrice', 'eps', 'netIncome', 'sharesTotal', 'sharesOutstanding'],
  pbr: ['closePrice', 'equityControlling', 'sharesTotal', 'sharesOutstanding'],
  marketCap: ['closePrice', 'sharesOutstanding'],
};

const DERIVED_IDS = new Set(Object.keys(DERIVED_DEPENDENCIES));

export function isDerivedMetric(id: MetricId): id is DerivedMetricId {
  return DERIVED_IDS.has(id);
}

/** 요청된 지표들을 그리려면 어떤 BASE 지표가 필요한지 */
export function requiredBaseMetrics(metrics: readonly MetricId[]): BaseMetricId[] {
  const out = new Set<BaseMetricId>();
  for (const metric of metrics) {
    if (isDerivedMetric(metric)) {
      for (const dep of DERIVED_DEPENDENCIES[metric]) out.add(dep);
    } else {
      out.add(metric);
    }
  }
  return [...out];
}

/** 지표별 계산식 설명. 툴팁에 계산 근거로 노출한다 (개념 설명이 아니다) */
export const METRIC_FORMULA: Record<MetricId, string> = {
  revenue: '공시 매출액',
  operatingIncome: '공시 영업이익',
  netIncome: '지배주주 귀속 당기순이익',
  netIncomeTotal: '당기순이익 (비지배지분 포함)',
  totalAssets: '자산총계',
  totalLiabilities: '부채총계',
  totalEquity: '자본총계 (비지배지분 포함)',
  equityControlling: '지배주주지분',
  sharesOutstanding: '보통주 유통주식수 (자기주식 제외)',
  sharesTotal: '보통주 + 우선주 유통주식수',
  eps: '공시 기본주당이익',
  closePrice: '기말 종가',
  operatingMargin: '영업이익 / 매출액',
  netMargin: '지배주주순이익 / 매출액',
  roe: '지배주주순이익 / 평균 지배주주지분',
  debtRatio: '부채총계 / 자본총계',
  bps: '지배주주지분 / 총 주식수',
  per: '종가 / 공시 기본주당이익',
  pbr: '종가 / BPS',
  marketCap: '종가 × 보통주 유통주식수',
};
