import type { MetricId } from '@fincompare/shared';

/**
 * 백엔드 호출. 프론트에서 외부 API 를 직접 부르지 않는다 —
 * API 키가 노출되고 캐싱도 안 된다.
 */

const BASE_URL = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? 'http://localhost:3100';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, params: Record<string, string>): Promise<T> {
  const query = new URLSearchParams(params);
  const response = await fetch(`${BASE_URL}${path}?${query.toString()}`);

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
      error?: string;
      detail?: string[];
    };
    const detail = body.detail?.join(', ');
    throw new ApiError(
      body.message ?? detail ?? `요청 실패 (${response.status})`,
      response.status,
      body.error,
    );
  }

  return (await response.json()) as T;
}

export interface CompanySearchResult {
  id: string;
  country: string;
  market: string;
  nameKo: string | null;
  nameEn: string | null;
  ticker: string | null;
  fiscalYearEndMonth: number;
  fiscalYearEndBadge: string | null;
  isSupported: boolean;
  matchedOn: string;
}

export function searchCompanies(query: string, limit = 8): Promise<{ results: CompanySearchResult[] }> {
  return request('/api/companies/search', { q: query, limit: String(limit) });
}

export interface SeriesCompany {
  id: string;
  nameKo: string | null;
  nameEn: string | null;
  market: string;
  ticker: string | null;
  color: string;
  dash: string | null;
  fiscalYearEndMonth: number;
  badges: string[];
}

export interface SeriesMetric {
  metricId: MetricId;
  label: string;
  unit: string;
  formula: string;
  basis: string;
  data: Record<string, Array<number | null>>;
  normalizedBase?: Record<string, string | null>;
}

export interface SeriesWarning {
  companyId: string;
  metricId: MetricId;
  code: string;
  detail?: string;
}

export interface SeriesResponse {
  companies: SeriesCompany[];
  periods: string[];
  series: SeriesMetric[];
  provenance: Record<string, { source: string; consolidation: string; basis: string }>;
  warnings: SeriesWarning[];
}

export interface SeriesParams {
  companyIds: readonly string[];
  metrics: readonly MetricId[];
  fromYear: number;
  toYear: number;
  normalize: boolean;
}

export function fetchSeries(params: SeriesParams): Promise<SeriesResponse> {
  return request('/api/series', {
    companies: params.companyIds.join(','),
    metrics: params.metrics.join(','),
    from: String(params.fromYear),
    to: String(params.toYear),
    normalize: String(params.normalize),
  });
}

export interface HealthResponse {
  ok: boolean;
  companies: number;
  missingKeys: string[];
}

export function fetchHealth(): Promise<HealthResponse> {
  return request('/api/health', {});
}
