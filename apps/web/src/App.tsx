import { MAX_COMPANIES } from '@fincompare/shared';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { ChartStack } from './charts/ChartStack.js';
import { CompanyPicker } from './features/company-picker/CompanyPicker.js';
import { MetricPicker } from './features/metric-picker/MetricPicker.js';
import { PeriodPicker } from './features/period-picker/PeriodPicker.js';
import { Presets } from './features/Presets.js';
import { CurrencyToggle } from './features/CurrencyToggle.js';
import { useUrlState } from './hooks/useUrlState.js';
import { ApiError, fetchSeries, type CompanySearchResult } from './lib/api.js';

export function App(): React.ReactElement {
  const [state, update] = useUrlState();
  const [logScale, setLogScale] = useState(false);
  // 검색으로 고른 이름은 시리즈 응답이 오기 전에도 칩에 보여야 한다
  const [pickedNames, setPickedNames] = useState<Map<string, string>>(new Map());

  const hasCompanies = state.companyIds.length > 0;

  const { data, isPending, isFetching, error } = useQuery({
    queryKey: [
      'series',
      state.companyIds,
      state.metrics,
      state.fromYear,
      state.toYear,
      state.normalize,
      state.currency,
    ],
    queryFn: () =>
      fetchSeries({
        companyIds: state.companyIds,
        metrics: state.metrics,
        fromYear: state.fromYear,
        toYear: state.toYear,
        normalize: state.normalize,
        currency: state.currency,
      }),
    enabled: hasCompanies,
  });

  const names = useMemo(() => {
    const map = new Map(pickedNames);
    for (const company of data?.companies ?? []) {
      map.set(company.id, company.nameKo ?? company.id);
    }
    return map;
  }, [pickedNames, data]);

  const countries = useMemo(
    () => new Set((data?.companies ?? []).map((c) => c.country)),
    [data],
  );
  // 국내·해외가 섞였을 때만 통화 토글이 의미를 가진다
  const isMixedMarket = countries.size > 1;
  const hasUsCompanies = countries.has('US');

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

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6">
      <header>
        <h1 className="text-2xl font-bold">재무지표 비교</h1>
        <p className="text-[var(--ink-muted)]">
          여러 기업의 재무지표를 같은 기간에 겹쳐서 봅니다. 출처는 금융감독원 DART입니다.
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
            />
            <hr className="border-[var(--line)]" />
            <div className="flex flex-wrap items-start justify-between gap-4">
              <PeriodPicker
                fromYear={state.fromYear}
                toYear={state.toYear}
                normalize={state.normalize}
                onChange={update}
              />
              <div className="flex flex-col items-start gap-4">
                <CurrencyToggle
                  value={state.currency}
                  onChange={(currency) => update({ currency })}
                  isMixed={isMixedMarket}
                  disabled={state.normalize}
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
          <ChartStack data={data} logScale={logScale} />
        </div>
      )}

      <footer className="text-sm text-[var(--ink-muted)]">
        재무데이터: 금융감독원 DART(국내) · SEC EDGAR(미국). 각 연도 사업보고서 공시값 기준.
        <br />
        주가: 한국거래소(KRX) 일별매매정보, 액면분할 미조정 실거래 종가. 환율: ECB.
        <br />
        투자 판단의 근거로 쓰기 전에 원문 공시를 확인하세요.
      </footer>
    </div>
  );
}
