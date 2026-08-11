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
  type SplitEvent,
} from '@fincompare/shared';
import type { Db } from '../db/client.js';
import type { DartClient } from '../adapters/dart/client.js';
import type { SecClient } from '../adapters/sec/client.js';
import { FxTable, type FxClient } from '../adapters/fx/ecb.js';
import { convertValue, fiscalPeriodBounds } from './currency.js';
import { ensureAnnualFinancials, loadCompanies, loadFacts } from './financials.js';
import { ensureClosePrices, isSplitAdjustedSource, type PriceDeps } from './prices.js';
import { ensureConsensus, type CompanyConsensus, type ConsensusWarning } from './consensus.js';
import type { ConsensusAdapter } from '../adapters/consensus/types.js';

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
  /**
   * 액면분할 이전 구간의 주당 지표를 분할 후 기준으로 환산한다.
   *
   * 끄면 각 시점 공시값 그대로라 분할 지점에서 선이 끊긴다 — 삼성전자
   * 2018년 EPS 가 299,868 -> 6,461 로 떨어져 이익이 98% 증발한 것처럼 보인다.
   *
   * PER·PBR 은 켜든 끄든 같다. 분자(주가)와 분모(EPS·BPS)가 같은 계수로
   * 나뉘므로 비율이 보존된다.
   */
  adjustSplits: boolean;
  /**
   * 애널리스트 목표주가 밴드를 함께 준다.
   *
   * 미국 기업만 대상이고 FMP 키가 있어야 한다. 국내는 컨센서스를 저장하지
   * 않기로 했으므로(저작권) 링크아웃만 제공한다.
   */
  consensus: boolean;
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
  /** 목표주가 밴드. 요청하지 않았거나 받을 수 없으면 빈 배열 */
  consensus: CompanyConsensus[];
}

export interface SeriesDeps extends PriceDeps {
  db: Db;
  dart: DartClient;
  sec: SecClient;
  fx: FxClient;
  /** 목표주가 제공처. 키가 없으면 null */
  consensusAdapter?: ConsensusAdapter | null;
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

  /*
   * 분할 지점은 조정하기 전에 찾아 둔다.
   * 조정하고 나면 주식수 시계열이 매끄러워져서 다시는 찾을 수 없다.
   */
  const splitEvents = new Map<string, SplitEvent[]>();
  for (const company of companies) {
    const byYear = facts.get(company.id);
    if (byYear === undefined) continue;
    const shares = periods.map((p) => byYear.get(Number(p))?.get('sharesOutstanding') ?? null);
    const events = detectSplits(periods, shares);
    if (events.length > 0) splitEvents.set(company.id, events);
  }

  /*
   * 분할 계수도 조정 전에 잡아 둔다. 목표주가에 같은 계수를 먹여야
   * 밴드와 주가가 같은 기준 위에 놓인다.
   */
  const splitFactorsById = new Map<string, number[]>();
  for (const company of companies) {
    const byYear = facts.get(company.id);
    if (byYear === undefined) continue;
    const shares = periods.map((p) => byYear.get(Number(p))?.get('sharesOutstanding') ?? null);
    const factors = splitAdjustmentFactors(periods, shares);
    if (factors.some((f) => f !== 1)) splitFactorsById.set(company.id, factors);
  }

  if (request.adjustSplits) applyDisplaySplitAdjustment(companies, facts, periods);

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

  /*
   * 목표주가.
   *
   * 재무지표 수집이 끝난 뒤에 부른다. 주가 밴드를 그리려면 같은 축(연도)이
   * 필요하고, 실패해도 재무지표는 이미 손에 있어야 하기 때문이다.
   *
   * 국내 기업·키 없음·제공처 오류는 모두 조용히 null 로 떨어지고,
   * 알릴 것이 있을 때만 경고가 쌓인다.
   */
  const consensus: CompanyConsensus[] = [];
  if (request.consensus) {
    const consensusWarnings: ConsensusWarning[] = [];
    const years = periods.map(Number);
    const results = await Promise.all(
      companies.map((company) =>
        ensureConsensus(
          { db: deps.db, consensus: deps.consensusAdapter ?? null },
          company,
          years,
          consensusWarnings,
        ),
      ),
    );

    for (const result of results) {
      if (result === null) continue;

      /*
       * 추정치를 주가·EPS 와 같은 기준에 놓는다.
       *
       * FMP 추정치는 **현재 기준**(모든 분할 반영)으로 온다. 우리 실제값은
       * adjustSplits 가 켜져 있을 때만 같은 기준이 된다. 껐을 때는 각 시점
       * 공시값이라 분할 이전 구간이 배수만큼 크다 — 그때는 추정치를 되돌려
       * 올려 줘야 밴드와 실제선이 겹친다.
       *
       * 엔비디아 2023년(FY2024)이면 추정 EPS 1.24 -> 12.4 가 되어야
       * 실제 공시값 12.05 와 나란히 놓인다.
       */
      if (!request.adjustSplits) {
        const factors = splitFactorsById.get(result.companyId);
        if (factors !== undefined) {
          for (const [metricId, points] of Object.entries(result.estimates)) {
            if (!PER_SHARE_METRICS.has(metricId)) continue;
            result.estimates[metricId] = points.map((point, index) => {
              const factor = factors[index] ?? 1;
              if (factor === 1) return point;
              return {
                ...point,
                high: point.high === null ? null : point.high * factor,
                avg: point.avg === null ? null : point.avg * factor,
                low: point.low === null ? null : point.low * factor,
              };
            });
          }
        }
      }

      consensus.push(result);
    }

    for (const w of consensusWarnings) {
      warnings.push({
        companyId: w.companyId,
        metricId: 'closePrice',
        code: 'PRICE_UNAVAILABLE',
        detail: w.detail,
      });
    }
  }

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
      //
      // 단 이미 다른 경고가 그 이유를 말하고 있으면 덧붙이지 않는다.
      // 미국 PER 은 PRICE_UNAVAILABLE 이 "주가를 연동하지 않아서"라고
      // 정확히 설명하는데, 여기에 일반적인 문구를 얹으면 소음만 는다.
      const alreadyExplained = warnings.some(
        (w) => w.companyId === company.id && w.metricId === metricId,
      );

      if (!alreadyExplained && raw.every((value) => value === null)) {
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
      basis:
        request.adjustSplits && PER_SHARE_METRICS.has(metricId)
          ? '연결 · 지배주주 기준 · 액면분할 조정'
          : '연결 · 지배주주 기준 · 각 시점 공시값',
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
      // 조정 전에 찾아 둔 이벤트를 쓴다. 지금 다시 찾으면 조정된 주식수라 안 잡힌다.
      const events = splitEvents.get(company.id);
      if (events === undefined) continue;

      // 그 기업의 값이 하나도 없으면 그 기업에는 알릴 것이 없다
      const companyHasValues = (drawnPerShareMetric.data[company.id] ?? []).some((v) => v !== null);
      if (!companyHasValues) continue;

      for (const event of events) {
        warnings.push({
          companyId: company.id,
          metricId: drawnPerShareMetric.metricId,
          code: 'SHARE_COUNT_JUMP',
          detail: describeSplit(event, request.adjustSplits),
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
    warnings: dedupeWarnings(warnings),
    consensus,
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
/**
 * 액면분할 이전 구간의 주당 지표를 분할 후 기준으로 환산한다 (제자리 수정).
 *
 * 왜 필요한가: 주당 지표는 각 시점 공시값이라 분할 지점에서 선이 끊긴다.
 * 삼성전자 2018년 50:1 분할이면 EPS 가 299,868 -> 6,461 로 떨어져
 * 이익이 98% 증발한 것처럼 보인다. 실제로는 주식 수가 50배 늘었을 뿐이다.
 *
 * BASE 값에만 손대면 파생지표는 저절로 맞는다:
 *   주가 / 계수, EPS / 계수, 주식수 * 계수
 *   -> BPS(자본/주식수)도 자동으로 /계수
 *   -> PER(주가/EPS)·PBR(주가/BPS)은 분자·분모가 같이 나뉘어 값이 그대로다
 *
 * 자본·매출 같은 총액 지표는 분할의 영향을 받지 않으므로 건드리지 않는다.
 */
function applyDisplaySplitAdjustment(
  companies: readonly { id: string }[],
  facts: Map<string, Map<number, Map<BaseMetricId, number | null>>>,
  periods: readonly string[],
): void {
  for (const company of companies) {
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

      for (const perShare of ['eps', 'closePrice'] as const) {
        const value = metrics.get(perShare);
        if (value != null) metrics.set(perShare, value / factor);
      }
      for (const shareCount of ['sharesOutstanding', 'sharesTotal'] as const) {
        const value = metrics.get(shareCount);
        if (value != null) metrics.set(shareCount, value * factor);
      }
    }
  }
}

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
export function dedupeWarnings(warnings: readonly SeriesWarning[]): SeriesWarning[] {
  const seen = new Map<string, SeriesWarning>();
  const periods = new Map<string, string[]>();

  for (const w of warnings) {
    /*
     * detail 까지 키에 넣는다.
     *
     * 코드까지만 묶으면 한 기업의 서로 다른 사건이 하나로 합쳐진다 — 엔비디아는
     * 2021년 4:1 과 2024년 10:1 로 두 번 분할했는데, 둘 다 SHARE_COUNT_JUMP 라서
     * 앞의 하나만 남고 10:1 이 통째로 사라졌다.
     *
     * 내용이 같은 경고(연도별로 반복되는 NEGATIVE_EPS 등)는 detail 도 같으므로
     * 여전히 하나로 합쳐지고 period 목록만 늘어난다.
     */
    const key = `${w.companyId}|${w.metricId}|${w.code}|${w.detail ?? ''}`;
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
