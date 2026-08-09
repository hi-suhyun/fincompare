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

  /** 비밀번호를 물어야 하는 상태 */
  get needsPassword(): boolean {
    return this.status === 401;
  }
}

/**
 * 가족 전용 게이트를 통과하기 위한 비밀번호.
 *
 * 서버가 쿠키를 구워 주므로 보통은 한 번만 쓰인다.
 * 브라우저에 남겨 두는 이유는 쿠키가 만료되거나 지워졌을 때 다시 묻지 않기 위해서다.
 * 공개 데이터에 대한 호출 한도 보호용이라 비밀 등급이 높지 않다.
 */
const PASSWORD_KEY = 'fincompare.accessPassword';

export function getStoredPassword(): string | null {
  try {
    return window.localStorage.getItem(PASSWORD_KEY);
  } catch {
    return null;
  }
}

export function storePassword(password: string): void {
  try {
    window.localStorage.setItem(PASSWORD_KEY, password);
  } catch {
    // 시크릿 모드 등에서 막힐 수 있다. 쿠키만으로도 이번 세션은 돈다.
  }
}

export function clearStoredPassword(): void {
  try {
    window.localStorage.removeItem(PASSWORD_KEY);
  } catch {
    /* 무시 */
  }
}

async function request<T>(path: string, params: Record<string, string>): Promise<T> {
  const query = new URLSearchParams(params);
  const password = getStoredPassword();

  const response = await fetch(`${BASE_URL}${path}?${query.toString()}`, {
    // 접근 게이트 쿠키를 주고받는다
    credentials: 'include',
    ...(password === null ? {} : { headers: { 'X-Access-Password': password } }),
  });

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
  country: string;
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
  /** 어느 시점의 문제인지. 설명(detail)과 별도로 둔다 */
  period?: string;
}

export interface SeriesResponse {
  companies: SeriesCompany[];
  periods: string[];
  displayCurrency: 'KRW' | 'USD' | 'native';
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
  currency: 'KRW' | 'USD' | 'native';
}

export function fetchSeries(params: SeriesParams): Promise<SeriesResponse> {
  return request('/api/series', {
    companies: params.companyIds.join(','),
    metrics: params.metrics.join(','),
    from: String(params.fromYear),
    to: String(params.toYear),
    normalize: String(params.normalize),
    currency: params.currency,
  });
}

export interface HealthResponse {
  ok: boolean;
  companies: number;
  missingKeys: string[];
  /** 이 인스턴스가 실제로 주가를 붙일 수 있는지 (셀프호스트는 키에 따라 다르다) */
  capabilities?: { krPrices: boolean; usPrices: boolean };
}

export function fetchHealth(): Promise<HealthResponse> {
  return request('/api/health', {});
}
