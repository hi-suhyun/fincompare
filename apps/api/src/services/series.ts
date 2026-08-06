import {
  METRIC_FORMULA,
  PER_SHARE_METRICS,
  describeSplit,
  detectSplits,
  METRIC_META,
  buildPeriodAxis,
  deriveMetric,
  fiscalYearEndBadge,
  isDerivedMetric,
  normalizeToBase,
  requiredBaseMetrics,
  styleForIndex,
  type BaseMetricId,
  type MetricId,
  type SeriesWarning,
} from '@fincompare/shared';
import type { Db } from '../db/client.js';
import type { DartClient } from '../adapters/dart/client.js';
import { ensureAnnualFinancials, loadCompanies, loadFacts } from './financials.js';

/**
 * 차트 하나를 그리는 데 필요한 모든 것을 한 번에 준다.
 *
 * periods 를 공유 배열로 내려주면 프론트에서 X축 정렬이 자동으로 맞고,
 * null 이 그대로 내려가므로 데이터가 없는 구간에서 선이 끊긴다.
 */

export interface SeriesRequest {
  companyIds: readonly string[];
  metrics: readonly MetricId[];
  fromYear: number;
  toYear: number;
  /** 시작 시점을 100 으로 정규화. 규모가 다른 기업 비교에 쓴다 */
  normalize: boolean;
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
  /** 계산 근거. 개념 설명이 아니라 어떻게 나온 숫자인지 */
  formula: string;
  basis: string;
  data: Record<string, Array<number | null>>;
  /** 정규화 모드에서 100 으로 잡은 시점 */
  normalizedBase?: Record<string, string | null>;
}

export interface SeriesResponse {
  companies: SeriesCompany[];
  periods: string[];
  series: SeriesMetric[];
  provenance: Record<string, { source: string; consolidation: string; basis: string }>;
  warnings: SeriesWarning[];
}

export interface SeriesDeps {
  db: Db;
  dart: DartClient;
}

export async function buildSeries(deps: SeriesDeps, request: SeriesRequest): Promise<SeriesResponse> {
  const companies = await loadCompanies(deps.db, request.companyIds);
  const warnings: SeriesWarning[] = [];
  const neededBase = new Set(requiredBaseMetrics(request.metrics));

  // ROE 는 기초자본이 필요하므로 요청 구간보다 1년 앞서 받아둔다
  const fetchFrom = request.fromYear - 1;

  const fetchResults = await Promise.allSettled(
    companies.map((company) =>
      ensureAnnualFinancials(deps, company, fetchFrom, request.toYear),
    ),
  );

  for (const [index, result] of fetchResults.entries()) {
    const company = companies[index];
    if (company === undefined) continue;

    if (result.status === 'rejected') {
      warnings.push({
        companyId: company.id,
        metricId: request.metrics[0] ?? 'revenue',
        code: 'METRIC_NOT_TAGGED',
        detail: result.reason instanceof Error ? result.reason.message : '데이터 수집 실패',
      });
      continue;
    }

    for (const w of result.value) {
      // 요청하지 않은 지표의 결측까지 올리면 경고창이 소음이 된다.
      // 매출액만 물었는데 "eps 없음"이 뜨면 사용자는 뭘 봐야 할지 모른다.
      if (w.metricId !== null && !neededBase.has(w.metricId)) continue;

      warnings.push({
        companyId: w.companyId,
        metricId: w.metricId ?? request.metrics[0] ?? 'revenue',
        code: w.code,
        ...(w.detail === undefined ? {} : { detail: w.detail }),
      });
    }
  }

  const facts = await loadFacts(deps.db, request.companyIds, fetchFrom, request.toYear);
  const periods = buildPeriodAxis(request.fromYear, request.toYear, 'FY');

  const seriesCompanies: SeriesCompany[] = companies.map((company, index) => {
    const style = styleForIndex(index);
    const badge = fiscalYearEndBadge(company.fiscalYearEndMonth);
    return {
      id: company.id,
      nameKo: company.nameKo,
      nameEn: company.nameEn,
      market: company.market,
      ticker: company.ticker ?? company.stockCode,
      color: style.color,
      dash: style.dash,
      fiscalYearEndMonth: company.fiscalYearEndMonth,
      badges: badge === null ? [] : [badge],
    };
  });

  const series: SeriesMetric[] = request.metrics.map((metricId) => {
    const meta = METRIC_META[metricId];
    const data: Record<string, Array<number | null>> = {};
    const normalizedBase: Record<string, string | null> = {};

    for (const company of companies) {
      const byYear = facts.get(company.id);
      const raw = periods.map((period) => {
        const year = Number(period);
        const yearFacts = byYear?.get(year);
        if (yearFacts === undefined) return null;

        if (!isDerivedMetric(metricId)) {
          return yearFacts.get(metricId as BaseMetricId) ?? null;
        }

        const prevFacts = byYear?.get(year - 1);
        const result = deriveMetric(metricId, yearFacts, prevFacts);
        for (const code of result.warnings) {
          warnings.push({ companyId: company.id, metricId, code, detail: period });
        }
        return result.value;
      });

      if (request.normalize) {
        const normalized = normalizeToBase(raw);
        data[company.id] = normalized.values;
        normalizedBase[company.id] =
          normalized.baseIndex === null ? null : (periods[normalized.baseIndex] ?? null);
      } else {
        data[company.id] = raw;
      }
    }

    return {
      metricId,
      label: meta.label,
      // 정규화 모드에서는 단위가 의미를 잃는다. 시작 시점 = 100 기준의 지수다.
      unit: request.normalize ? '지수 (시작=100)' : meta.unit,
      formula: METRIC_FORMULA[metricId],
      basis: 'K-IFRS 연결 · 지배주주 기준',
      data,
      ...(request.normalize ? { normalizedBase } : {}),
    };
  });

  // 주당 지표를 요청했으면 액면분할 불연속을 찾아 알린다.
  // 조정 없이 그리면 삼성전자 2018년에 EPS 가 98% 증발한 것처럼 보인다.
  const wantsPerShare = request.metrics.some((m) => PER_SHARE_METRICS.has(m));
  if (wantsPerShare) {
    for (const company of companies) {
      const byYear = facts.get(company.id);
      if (byYear === undefined) continue;

      const shareSeries = periods.map(
        (p) => byYear.get(Number(p))?.get('sharesOutstanding') ?? null,
      );
      for (const event of detectSplits(periods, shareSeries)) {
        warnings.push({
          companyId: company.id,
          metricId: request.metrics.find((m) => PER_SHARE_METRICS.has(m)) ?? 'eps',
          code: 'SHARE_COUNT_JUMP',
          detail: describeSplit(event),
        });
      }
    }
  }

  const provenance: Record<string, { source: string; consolidation: string; basis: string }> = {};
  for (const company of companies) {
    const usedSeparate = warnings.some(
      (w) => w.companyId === company.id && w.code === 'FELL_BACK_TO_SEPARATE',
    );
    provenance[company.id] = {
      source: company.country === 'KR' ? 'DART' : 'SEC EDGAR',
      consolidation: usedSeparate ? 'OFS (별도)' : 'CFS (연결)',
      basis: '각 연도 사업보고서 공시값',
    };
  }

  return { companies: seriesCompanies, periods, series, provenance, warnings: dedupe(warnings) };
}

/** 같은 경고가 연도마다 반복되면 화면이 시끄러워진다. 지표·기업 단위로 합친다 */
function dedupe(warnings: readonly SeriesWarning[]): SeriesWarning[] {
  const seen = new Map<string, SeriesWarning>();
  for (const w of warnings) {
    const key = `${w.companyId}|${w.metricId}|${w.code}`;
    if (!seen.has(key)) seen.set(key, w);
  }
  return [...seen.values()];
}
