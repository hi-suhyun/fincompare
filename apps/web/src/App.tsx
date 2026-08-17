import {
  MAX_COMPANIES,
  PER_SHARE_METRICS,
  isEstimatedMetric,
  type Country,
} from '@fincompare/shared';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChartStack } from './charts/ChartStack.js';
import { CompanyPicker } from './features/company-picker/CompanyPicker.js';
import { MetricPicker } from './features/metric-picker/MetricPicker.js';
import { PeriodPicker } from './features/period-picker/PeriodPicker.js';
import { Presets } from './features/Presets.js';
import { CurrencyToggle } from './features/CurrencyToggle.js';
import { ConsensusToggle } from './features/ConsensusToggle.js';
import { PeriodTypeToggle } from './features/PeriodTypeToggle.js';
import { AccessGate } from './features/AccessGate.js';
import { useUrlState } from './hooks/useUrlState.js';
import { ApiError, fetchHealth, fetchSeries, type CompanySearchResult } from './lib/api.js';

export function App(): React.ReactElement {
  const [state, update] = useUrlState();
  // 게이트에 막히면 비밀번호를 묻는다. 통과하면 다시 조회한다.
  const [locked, setLocked] = useState(false);
  const [logScale, setLogScale] = useState(false);
  // 검색으로 고른 이름은 시리즈 응답이 오기 전에도 칩에 보여야 한다
  const [pickedNames, setPickedNames] = useState<Map<string, string>>(new Map());

  const hasCompanies = state.companyIds.length > 0;

  const { data, isPending, isFetching, error, refetch } = useQuery({
    queryKey: [
      'series',
      state.companyIds,
      state.metrics,
      state.fromYear,
      state.toYear,
      state.normalize,
      state.currency,
      state.adjustSplits,
      state.consensus,
      state.periodType,
    ],
    queryFn: () =>
      fetchSeries({
        companyIds: state.companyIds,
        metrics: state.metrics,
        fromYear: state.fromYear,
        toYear: state.toYear,
        normalize: state.normalize,
        currency: state.currency,
        adjustSplits: state.adjustSplits,
        consensus: state.consensus,
        periodType: state.periodType,
      }),
    enabled: hasCompanies && !locked,
    retry: (count, err) => !(err instanceof ApiError && err.needsPassword) && count < 1,
  });

  useEffect(() => {
    if (error instanceof ApiError && error.needsPassword) setLocked(true);
  }, [error]);

  // 이 인스턴스의 능력치. 지표 안내 문구가 실제 설정과 어긋나지 않게 한다.
  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    staleTime: Infinity,
    retry: false,
  });
  const usPricesEnabled = health?.capabilities?.usPrices ?? false;
  const consensusEnabled = health?.capabilities?.consensus ?? false;
  const krResearchIds = useMemo(
    () => new Set(health?.capabilities?.krResearch ?? []),
    [health],
  );

  const names = useMemo(() => {
    const map = new Map(pickedNames);
    for (const company of data?.companies ?? []) {
      map.set(company.id, company.nameKo ?? company.id);
    }
    return map;
  }, [pickedNames, data]);

  const countries = useMemo(
    () => new Set((data?.companies ?? []).map((c) => c.country as Country)),
    [data],
  );
  const countryList = useMemo(() => [...countries], [countries]);
  // 국내·해외가 섞였을 때만 통화 토글이 의미를 가진다
  const isMixedMarket = countries.size > 1;
  const hasUsCompanies = countries.has('US');
  const hasKrCompanies = countries.has('KR');
  // 고른 국내 기업 중 직접 조사 기록이 있는 곳. 있으면 컨센서스 토글이 열린다
  const hasKrResearch = useMemo(
    () => (data?.companies ?? []).some((c) => krResearchIds.has(c.id)),
    [data, krResearchIds],
  );
  /*
   * 컨센서스를 얹을 수 있는 지표를 보고 있는지.
   *
   * 연도별 추정 밴드는 매출액·EPS 에만 붙지만, **목표주가는 주가 차트**에
   * 가로 띠로 눕는다. 주가를 빼 두면 목표주가만 있는 국내 기업은 토글조차
   * 켤 수 없어서 아무것도 안 뜬다 — 실제로 그렇게 막혀 있었다.
   */
  const hasEstimatedMetric = state.metrics.some(
    (m) => isEstimatedMetric(m) || m === 'closePrice',
  );
  // 액면분할 조정은 주당 지표에만 영향을 준다. 매출액만 보고 있으면 띄울 이유가 없다.
  const hasPerShareMetric = state.metrics.some((m) => PER_SHARE_METRICS.has(m));

  const addCompany = useCallback(
    (company: CompanySearchResult) => {
      setPickedNames((prev) => new Map(prev).set(company.id, company.nameKo ?? company.id));
      update({ companyIds: [...state.companyIds, company.id].slice(0, MAX_COMPANIES) });
    },
    [state.companyIds, update],
  );

  const removeCompany = useCallback(
    (companyId: string) => update({ companyIds: state.companyIds.filter((id) => id !== companyId) }),
    [state.companyIds, update],
  );

  if (locked) {
    return (
      <AccessGate
        onUnlocked={() => {
          setLocked(false);
          void refetch();
        }}
      />
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6">
      <header>
        <h1 className="text-2xl font-bold">재무지표 비교</h1>
        <p className="text-[var(--ink-muted)]">
          국내·미국 상장기업의 재무지표를 같은 기간에 겹쳐서 봅니다.
          공시 원문(DART · SEC)에서 직접 가져옵니다.
        </p>
      </header>

      <div className="flex flex-col gap-5 rounded-xl border border-[var(--line)] bg-white p-4">
        <CompanyPicker
          selected={state.companyIds}
          names={names}
          onAdd={addCompany}
          onRemove={removeCompany}
        />

        {!hasCompanies && <Presets onSelect={(companyIds) => update({ companyIds })} />}

        {hasCompanies && (
          <>
            <hr className="border-[var(--line)]" />
            <MetricPicker
              selected={state.metrics}
              onChange={(metrics) => update({ metrics })}
              hasUsCompanies={hasUsCompanies}
              usPricesEnabled={usPricesEnabled}
            />
            <hr className="border-[var(--line)]" />
            <PeriodTypeToggle
              value={state.periodType}
              onChange={(periodType) => update({ periodType })}
              consensusOn={state.consensus}
            />
            <div className="flex flex-wrap items-start justify-between gap-4">
              <PeriodPicker
                fromYear={state.fromYear}
                toYear={state.toYear}
                normalize={state.normalize}
                overlay={state.overlay}
                countries={countryList}
                onChange={update}
              />
              <div className="flex flex-col items-start gap-4">
                <CurrencyToggle
                  value={state.currency}
                  onChange={(currency) => update({ currency })}
                  isMixed={isMixedMarket}
                  disabled={state.normalize}
                />
                {hasPerShareMetric && (
                  <label className="flex max-w-xs items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={state.adjustSplits}
                      onChange={(e) => update({ adjustSplits: e.target.checked })}
                      className="mt-0.5 h-5 w-5 accent-[#0072B2]"
                    />
                    <span>
                      <span className="font-medium">액면분할 조정</span>
                      <span className="mt-0.5 block text-sm text-[var(--ink-muted)]">
                        분할 이전 구간을 분할 후 기준으로 환산해 흐름이 이어지게 합니다.
                        끄면 각 시점 공시값 그대로라 분할 지점에서 선이 끊깁니다.
                        PER·PBR 은 어느 쪽이든 같습니다.
                      </span>
                    </span>
                  </label>
                )}
                <ConsensusToggle
                  value={state.consensus}
                  onChange={(consensus) => update({ consensus })}
                  hasUsCompanies={hasUsCompanies}
                  hasKrCompanies={hasKrCompanies}
                  enabled={consensusEnabled}
                  hasEstimatedMetric={hasEstimatedMetric}
                  hasKrResearch={hasKrResearch}
                />
                <label className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={logScale}
                    onChange={(e) => setLogScale(e.target.checked)}
                    className="h-5 w-5 accent-[#0072B2]"
                  />
                  <span className="font-medium">로그 축</span>
                </label>
              </div>
            </div>
          </>
        )}
      </div>

      {hasCompanies && isPending && (
        <p className="rounded-xl border border-[var(--line)] bg-white px-4 py-8 text-center text-[var(--ink-muted)]">
          공시 데이터를 받아오는 중입니다. 처음 조회하는 기업은 시간이 조금 걸립니다.
        </p>
      )}

      {error !== null && (
        <p className="rounded-xl border-2 border-[#e0a89a] bg-[#fdf3f0] px-4 py-3">
          {error instanceof ApiError ? error.message : '데이터를 불러오지 못했습니다.'}
        </p>
      )}

      {data !== undefined && (
        <div className={isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          <ChartStack
            data={data}
            logScale={logScale}
            onLogScaleChange={setLogScale}
            overlay={state.overlay}
          />
        </div>
      )}

      <footer className="text-sm text-[var(--ink-muted)]">
        재무데이터: 금융감독원 DART(국내) · SEC EDGAR(미국). 각 연도 사업보고서 공시값 기준.
        <br />
        주가: 한국거래소(KRX) 일별매매정보, 실거래 종가. 환율: ECB.
        <br />
        주당 지표(EPS · BPS · 주가)는 기본적으로 액면분할을 조정해 보여줍니다 — 각 시점
        공시값이 필요하면 「액면분할 조정」을 끄세요. PER · PBR 은 어느 쪽이든 같습니다.
        <br />
        투자 판단의 근거로 쓰기 전에 원문 공시를 확인하세요.
      </footer>
    </div>
  );
}
