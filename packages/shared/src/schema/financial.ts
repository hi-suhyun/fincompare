import { z } from 'zod';
import { CurrencySchema, SourceIdSchema } from './company.js';

/**
 * BASE 지표 — 외부 소스에서 직접 가져와 DB에 저장하는 값.
 * 파생지표(PER, ROE 등)는 저장하지 않고 조회 시점에 계산한다.
 */
export const BaseMetricIdSchema = z.enum([
  'revenue',
  'operatingIncome',
  /** 지배주주 귀속 당기순이익 */
  'netIncome',
  /** 비지배지분 포함 당기순이익 */
  'netIncomeTotal',
  'totalAssets',
  'totalLiabilities',
  /** 비지배지분 포함 자본총계 */
  'totalEquity',
  /** 지배주주지분 자본 */
  'equityControlling',
  /** 보통주 유통주식수 */
  'sharesOutstanding',
  /** 기말 종가 */
  'closePrice',
]);
export type BaseMetricId = z.infer<typeof BaseMetricIdSchema>;

export const DerivedMetricIdSchema = z.enum([
  'operatingMargin',
  'netMargin',
  'roe',
  'debtRatio',
  'eps',
  'bps',
  'per',
  'pbr',
  'marketCap',
]);
export type DerivedMetricId = z.infer<typeof DerivedMetricIdSchema>;

export const MetricIdSchema = z.union([BaseMetricIdSchema, DerivedMetricIdSchema]);
export type MetricId = BaseMetricId | DerivedMetricId;

/** 재무상태표 항목은 시점 데이터라 기간 합산·TTM 대상이 아니다 */
export const STOCK_METRICS: ReadonlySet<BaseMetricId> = new Set([
  'totalAssets',
  'totalLiabilities',
  'totalEquity',
  'equityControlling',
  'sharesOutstanding',
  'closePrice',
]);

export const isFlowMetric = (id: BaseMetricId): boolean => !STOCK_METRICS.has(id);

export const PeriodTypeSchema = z.enum(['FY', 'Q']);
export type PeriodType = z.infer<typeof PeriodTypeSchema>;

/** 연결/별도. SEC는 항상 연결이므로 CFS 고정 */
export const ConsolidationSchema = z.enum(['CFS', 'OFS']);
export type Consolidation = z.infer<typeof ConsolidationSchema>;

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 형식이어야 함');

export const FinancialDataPointSchema = z.object({
  companyId: z.string(),
  metricId: BaseMetricIdSchema,
  periodType: PeriodTypeSchema,
  /** 재무상태표 항목은 시점 데이터라 null */
  periodStart: IsoDate.nullable(),
  periodEnd: IsoDate,
  /** 기업이 보고한 회계연도 (NVDA FY2022) */
  fiscalYear: z.number().int(),
  fiscalQuarter: z.number().int().min(1).max(4).nullable(),
  /** 비교용 정렬 연도 (NVDA FY2022 -> 2021) */
  alignedYear: z.number().int(),
  alignedQuarter: z.number().int().min(1).max(4).nullable(),
  /**
   * 결측은 명시적 null. 0으로 채우지 않는다.
   * 행 자체가 없음 = 미조회 / value: null = 조회했으나 미공시.
   */
  value: z.number().nullable(),
  currency: CurrencySchema,
  consolidation: ConsolidationSchema,
  source: SourceIdSchema,
  /** 채택된 원본 태그. ifrs-full_Revenue, OperatingIncomeLoss 등 */
  sourceTag: z.string(),
  filedAt: IsoDate.nullable(),
});
export type FinancialDataPoint = z.infer<typeof FinancialDataPointSchema>;

export const WarningCodeSchema = z.enum([
  /** 소스에 해당 태그가 아예 없음 (미국 금융사의 OperatingIncomeLoss 등) */
  'METRIC_NOT_TAGGED',
  /** 연결(CFS)이 없어 별도(OFS)로 폴백 */
  'FELL_BACK_TO_SEPARATE',
  /** ROE 기초자본이 없어 기말자본으로 계산 */
  'ROE_USED_ENDING_EQUITY',
  /** 적자라 PER 계산 불가 */
  'NEGATIVE_EPS',
  /** TTM 구성 분기 중 결측이 있어 계산 불가 */
  'TTM_INCOMPLETE',
  /** 결산월이 12월이 아니라 정렬 보정이 적용됨 */
  'FISCAL_YEAR_SHIFTED',
]);
export type WarningCode = z.infer<typeof WarningCodeSchema>;

export const SeriesWarningSchema = z.object({
  companyId: z.string(),
  metricId: MetricIdSchema,
  code: WarningCodeSchema,
  detail: z.string().optional(),
});
export type SeriesWarning = z.infer<typeof SeriesWarningSchema>;

export const METRIC_META: Record<MetricId, { label: string; unit: string; kind: 'absolute' | 'ratio' | 'valuation' }> = {
  revenue: { label: '매출액', unit: '통화', kind: 'absolute' },
  operatingIncome: { label: '영업이익', unit: '통화', kind: 'absolute' },
  netIncome: { label: '당기순이익', unit: '통화', kind: 'absolute' },
  netIncomeTotal: { label: '당기순이익(비지배포함)', unit: '통화', kind: 'absolute' },
  totalAssets: { label: '자산총계', unit: '통화', kind: 'absolute' },
  totalLiabilities: { label: '부채총계', unit: '통화', kind: 'absolute' },
  totalEquity: { label: '자본총계', unit: '통화', kind: 'absolute' },
  equityControlling: { label: '지배주주지분', unit: '통화', kind: 'absolute' },
  sharesOutstanding: { label: '유통주식수', unit: '주', kind: 'absolute' },
  closePrice: { label: '종가', unit: '통화', kind: 'valuation' },
  operatingMargin: { label: '영업이익률', unit: '%', kind: 'ratio' },
  netMargin: { label: '순이익률', unit: '%', kind: 'ratio' },
  roe: { label: 'ROE', unit: '%', kind: 'ratio' },
  debtRatio: { label: '부채비율', unit: '%', kind: 'ratio' },
  eps: { label: 'EPS', unit: '통화', kind: 'valuation' },
  bps: { label: 'BPS', unit: '통화', kind: 'valuation' },
  per: { label: 'PER', unit: '배', kind: 'valuation' },
  pbr: { label: 'PBR', unit: '배', kind: 'valuation' },
  marketCap: { label: '시가총액', unit: '통화', kind: 'valuation' },
};
