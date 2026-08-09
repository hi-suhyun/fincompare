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
  reportingCurrency,
  splitAdjustmentFactors,
  styleForIndex,
  type BaseMetricId,
  type Currency,
  type MetricId,
  type SeriesWarning,
} from '@fincompare/shared';
import type { Db } from '../db/client.js';
import type { DartClient } from '../adapters/dart/client.js';
import type { SecClient } from '../adapters/sec/client.js';
import { FxTable, type FxClient } from '../adapters/fx/ecb.js';
import { convertValue, fiscalPeriodBounds } from './currency.js';
import { ensureAnnualFinancials, loadCompanies, loadFacts } from './financials.js';
import { ensureClosePrices, isSplitAdjustedSource, type PriceDeps } from './prices.js';

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
  /**
   * 표시 통화. 'native' 면 각 기업의 보고 통화를 그대로 쓴다.
   * 정규화 모드에서는 환산하지 않는다 — 성장률에 환율 변동이 섞이면
   * 기업 성과가 아니라 환율을 보게 된다.
   */
  currency: 'KRW' | 'USD' | 'native';
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
  /** 화면에 표시되는 통화. 'native' 면 기업별 보고 통화 그대로다 */
  displayCurrency: 'KRW' | 'USD' | 'native';
  series: SeriesMetric[];
  provenance: Record<string, { source: string; consolidation: string; basis: string }>;
  warnings: SeriesWarning[];
}

export interface SeriesDeps extends PriceDeps {
  db: Db;
  dart: DartClient;
  sec: SecClient;
  fx: FxClient;
}

export async function buildSeries(deps: SeriesDeps, request: SeriesRequest): Promise<SeriesResponse> {
  const companies = await loadCompanies(deps.db, request.companyIds);
  const warnings: SeriesWarning[] = [];
  const neededBase = new Set(requiredBaseMetrics(request.metrics));

  // ROE 는 기초자본이 필요하므로 요청 구간보다 1년 앞서 받아둔다
  const fetchFrom = request.fromYear - 1;

  // 밸류에이션 지표를 요청했을 때만 주가를 받는다. 안 쓸 데이터를 위해 외부 호출을 하지 않는다.
  const needsPrice = neededBase.has('closePrice');

  const fetchResults = await Promise.allSettled(
    companies.map((company) =>
      ensureAnnualFinancials(deps, company, fetchFrom, request.toYear),
    ),
  );

  if (needsPrice) {
    const priceResults = await Promise.allSettled(
      companies.map((company) => ensureClosePrices(deps, company, request.fromYear, request.toYear)),
    );
    for (const [index, result] of priceResults.entries()) {
      const company = companies[index];
      if (company === undefined || result.status === 'rejected') continue;
      for (const w of result.value) {
        warnings.push({
          companyId: w.companyId,
          metricId: 'per',
          code: 'PRICE_UNAVAILABLE',
          detail: w.detail,
        });
      }
    }
  }

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

  if (needsPrice) applySplitAdjustment(deps, companies, facts, periods, warnings);

  // 정규화 모드에서는 환산하지 않는다. 성장률에 환율 변동이 섞이면
  // 기업 성과가 아니라 환율을 보게 된다.
  const targetCurrency = request.normalize ? 'native' : request.currency;
  const displayCurrency = await applyCurrency(
    deps,
    companies,
    facts,
    fetchFrom,
    request.toYear,
    targetCurrency,
    warnings,
  );

  const seriesCompanies: SeriesCompany[] = companies.map((company, index) => {
    const style = styleForIndex(index);
    const badge = fiscalYearEndBadge(company.fiscalYearEndMonth);
    return {
      id: company.id,
      country: company.country,
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
          warnings.push({ companyId: company.id, metricId, code, period });
        }
        return result.value;
      });

      /*
       * 구간 전체가 비어 있으면 여기서 알린다.
       *
       * 수집 단계의 경고만으로는 부족하다. 이미 저장된 연도는 수집을 건너뛰므로,
       * 미리 받아둔 DB(배포판이 그렇다)에서는 경고가 아예 만들어지지 않는다.
       * 그러면 사용자는 이유 없는 빈 차트를 보게 된다 — 값이 없는 것과
       * 회사가 그 항목을 보고하지 않는 것은 다른 이야기다.
       *
       * 예: ExxonMobil 은 OperatingIncomeLoss 를 태깅하지 않는다. 세전이익으로
       * 대신하면 이자·투자손익이 섞여 영업이익이 아니게 되므로 채우지 않는다.
       */
      if (raw.every((value) => value === null)) {
        warnings.push({
          companyId: company.id,
          metricId,
          code: 'METRIC_NOT_TAGGED',
          detail: '이 기업은 해당 기간에 이 항목을 공시하지 않았습니다',
        });
      }

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

  // 액면분할 불연속을 알린다. 조정 없이 그리면 삼성전자 2018년에
  // EPS 가 98% 증발한 것처럼 보인다.
  //
  // 단 **실제로 값이 그려지는 지표에만** 붙인다. 미국 기업은 주가를 쓰지 않아
  // PER 이 전부 비는데, 빈 차트에 "불연속" 경고를 띄우면 소음일 뿐이다.
  // 경고가 많으면 진짜 중요한 것을 놓친다.
  const drawnPerShareMetric = series.find(
    (s) =>
      PER_SHARE_METRICS.has(s.metricId) &&
      Object.values(s.data).some((values) => values.some((v) => v !== null)),
  );

  if (drawnPerShareMetric !== undefined) {
    for (const company of companies) {
      const byYear = facts.get(company.id);
      if (byYear === undefined) continue;

      // 그 기업의 값이 하나도 없으면 그 기업에는 알릴 것이 없다
      const companyHasValues = (drawnPerShareMetric.data[company.id] ?? []).some((v) => v !== null);
      if (!companyHasValues) continue;

      const shareSeries = periods.map(
        (p) => byYear.get(Number(p))?.get('sharesOutstanding') ?? null,
      );
      for (const event of detectSplits(periods, shareSeries)) {
        warnings.push({
          companyId: company.id,
          metricId: drawnPerShareMetric.metricId,
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

  return {
    companies: seriesCompanies,
    periods,
    displayCurrency,
    series,
    provenance,
    warnings: dedupe(warnings),
  };
}

/**
 * 수정주가와 공시 EPS 의 기준을 맞춘다 (제자리 수정).
 *
 * 주가 소스가 수정주가(액면분할 소급 조정)를 주는데 EPS·BPS 는 각 시점 공시값이다.
 * 그대로 나누면 삼성전자 2017년 PER 이 0.17배로 나온다 (실제 약 8.5배).
 *
 * 조정 방향:
 *   EPS       -> 계수로 나눈다 (분할 후 기준으로 낮춘다)
 *   주식수    -> 계수를 곱한다 (분할 후 기준으로 늘린다)
 * 이렇게 하면 BPS(자본/주식수)와 시가총액(주가×주식수)도 함께 맞는다.
 *
 * 미조정 주가를 주는 소스(KRX, Tiingo)에서는 아무것도 하지 않는다.
 */
function applySplitAdjustment(
  deps: SeriesDeps,
  companies: readonly { id: string; country: string; market: string; stockCode: string | null; ticker: string | null; fiscalYearEndMonth: number }[],
  facts: Map<string, Map<number, Map<BaseMetricId, number | null>>>,
  periods: readonly string[],
  warnings: SeriesWarning[],
): void {
  for (const company of companies) {
    if (!isSplitAdjustedSource(deps, company as never)) continue;

    const byYear = facts.get(company.id);
    if (byYear === undefined) continue;

    const shares = periods.map((p) => byYear.get(Number(p))?.get('sharesOutstanding') ?? null);
    const factors = splitAdjustmentFactors(periods, shares);
    if (factors.every((f) => f === 1)) continue;

    for (const [index, period] of periods.entries()) {
      const factor = factors[index] ?? 1;
      if (factor === 1) continue;

      const metrics = byYear.get(Number(period));
      if (metrics === undefined) continue;

      const eps = metrics.get('eps');
      if (eps != null) metrics.set('eps', eps / factor);

      for (const shareMetric of ['sharesOutstanding', 'sharesTotal'] as const) {
        const value = metrics.get(shareMetric);
        if (value != null) metrics.set(shareMetric, value * factor);
      }
    }

    warnings.push({
      companyId: company.id,
      metricId: 'per',
      code: 'SHARE_COUNT_JUMP',
      detail:
        '주가가 수정주가라 액면분할 이전 구간의 EPS·주식수를 같은 기준으로 조정했습니다. ' +
        '공시 원값과는 다릅니다.',
    });
  }
}

/**
 * BASE 값을 표시 통화로 환산한다 (제자리 수정).
 *
 * 파생지표를 계산하기 전에 해야 한다. BPS 같은 지표는 통화 항목과 주식수를 나눈 값이라,
 * 파생 이후에 환산하면 어느 쪽을 바꿔야 할지 알 수 없다.
 *
 * 환율은 방향당 한 번만 받아온다 (USD->KRW 또는 KRW->USD).
 * 반환값은 화면에 표시할 통화 — 환산이 아예 없었으면 'native'.
 */
async function applyCurrency(
  deps: SeriesDeps,
  companies: readonly { id: string; country: string; fiscalYearEndMonth: number }[],
  facts: Map<string, Map<number, Map<BaseMetricId, number | null>>>,
  fromYear: number,
  toYear: number,
  target: 'KRW' | 'USD' | 'native',
  warnings: SeriesWarning[],
): Promise<'KRW' | 'USD' | 'native'> {
  if (target === 'native') return 'native';

  const needed = new Set<Currency>();
  for (const company of companies) {
    const from = reportingCurrency(company.country as 'KR' | 'US');
    if (from !== target) needed.add(from);
  }
  if (needed.size === 0) return target;

  // ECB 는 영업일만 고시한다. 구간 앞뒤로 여유를 둬야 기말이 휴일일 때도 채워진다.
  const rangeStart = `${fromYear - 1}-01-01`;
  const rangeEnd = `${toYear}-12-31`;

  const tables = new Map<Currency, FxTable>();
  for (const from of needed) {
    try {
      const rates = await deps.fx.fetchRange(from, target, rangeStart, rangeEnd);
      tables.set(from, new FxTable(rates));
    } catch {
      tables.set(from, new FxTable([]));
    }
  }

  for (const company of companies) {
    const from = reportingCurrency(company.country as 'KR' | 'US');
    if (from === target) continue;

    const table = tables.get(from);
    const byYear = facts.get(company.id);
    if (table === undefined || byYear === undefined) continue;

    if (table.isEmpty) {
      warnings.push({
        companyId: company.id,
        metricId: 'revenue',
        code: 'METRIC_NOT_TAGGED',
        detail: `환율(${from}->${target})을 받지 못해 이 기업은 환산하지 못했습니다`,
      });
      continue;
    }

    for (const [year, metrics] of byYear) {
      const bounds = fiscalPeriodBounds(year, company.fiscalYearEndMonth);
      for (const [metricId, value] of metrics) {
        metrics.set(
          metricId,
          convertValue(value, metricId, {
            from,
            to: target,
            table,
            periodStart: bounds.start,
            periodEnd: bounds.end,
          }),
        );
      }
    }
  }

  return target;
}

/**
 * 같은 경고가 연도마다 반복되면 화면이 시끄러워진다. 지표·기업 단위로 합치되,
 * 어느 연도들이었는지는 남긴다 — "2023" 하나만 보이면 다른 해는 괜찮은지 알 수 없다.
 */
function dedupe(warnings: readonly SeriesWarning[]): SeriesWarning[] {
  const seen = new Map<string, SeriesWarning>();
  const periods = new Map<string, string[]>();

  for (const w of warnings) {
    const key = `${w.companyId}|${w.metricId}|${w.code}`;
    if (!seen.has(key)) seen.set(key, w);
    if (w.period !== undefined) {
      const list = periods.get(key);
      if (list === undefined) periods.set(key, [w.period]);
      else if (!list.includes(w.period)) list.push(w.period);
    }
  }

  return [...seen.entries()].map(([key, warning]) => {
    const list = periods.get(key);
    return list === undefined ? warning : { ...warning, period: list.sort().join(', ') };
  });
}
