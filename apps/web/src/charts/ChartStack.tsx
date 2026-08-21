import { OVERLAY_READABLE_LINES, chartHeight } from '@fincompare/shared';
import { useMemo, useRef } from 'react';
import { ExportButtons } from '../features/export/ExportButtons.js';
import type { SeriesResponse } from '../lib/api.js';
import { formatByUnit, resolveCurrency } from '../lib/format.js';
import { MAX_PROJECTIONS, nextPeriodLabel, projectionsFor } from './projection.js';
import { HoverSyncProvider } from './hoverSync.js';
import { MetricChart } from './MetricChart.js';
import { OverlayChart } from './OverlayChart.js';
import { OverlayLegend } from './OverlayLegend.js';
import { ReadoutPanel } from './ReadoutPanel.js';
import { HoverTooltip } from './HoverTooltip.js';
import { SharedLegend } from './SharedLegend.js';
import { WarningList } from './WarningList.js';
import { KoreanConsensusLink } from '../features/KoreanConsensusLink.js';

interface Props {
  data: SeriesResponse;
  logScale: boolean;
  /** 로그 축을 켜는 손잡이. 격차가 클 때 안내에서 바로 켤 수 있게 한다 */
  onLogScaleChange: (value: boolean) => void;
  /** 한 차트에 겹쳐 그린다. 정규화 모드에서만 켜진다 (App 에서 강제) */
  overlay: boolean;
}

/**
 * 기본은 지표 하나당 차트 하나를 세로로 쌓는 것이다 (small multiples).
 *
 * 모든 차트가 X축(기간)을 공유하고 좌우 폭·시작점이 정확히 맞아야 한다.
 * 맨 아래 차트에만 X축 라벨을 노출하고 위쪽은 눈금선만 둔다 — 같은 연도 라벨이
 * 네 번 반복되면 읽을 것이 늘어날 뿐 정보는 늘지 않는다.
 *
 * 겹쳐 보기는 정규화 모드에서만 쓴다. 이유는 OverlayChart 주석 참고.
 */
export function ChartStack({
  data,
  logScale,
  onLogScaleChange,
  overlay,
}: Props): React.ReactElement {
  const captureRef = useRef<HTMLDivElement>(null);

  // 통화는 여기서 한 번만 정한다. 차트마다 따로 판단하면 축과 표가 어긋난다.
  const currency = resolveCurrency(
    data.displayCurrency,
    data.companies.map((c) => c.country),
  );

  /*
   * 한 차트 안에서 배수 격차가 크면 작은 쪽이 바닥에 눌려 "변화 없음"처럼 보인다.
   *
   * 엔비디아(지수 6,742)와 삼성전자(333)를 함께 그리면 축이 0~8000 이 되고,
   * 삼성전자가 3.3배 오른 것이 0 근처 직선으로 읽힌다. 선형 축에서는 배수 변화를
   * 큰 쪽이 전부 가져가기 때문이다. 로그 축은 같은 배수를 같은 높이로 그린다.
   *
   * 지표마다 축이 따로이므로 지표별로 재고 가장 심한 것을 쓴다.
   */
  const spread = useMemo(() => {
    if (logScale) return 1;

    let worst = 1;
    for (const metric of data.series) {
      let max = 0;
      let min = Number.POSITIVE_INFINITY;
      for (const values of Object.values(metric.data)) {
        for (const value of values) {
          // 음수·0 은 로그 축으로도 해결되지 않으므로 격차 판단에서 뺀다
          if (value === null || !Number.isFinite(value) || value <= 0) continue;
          max = Math.max(max, value);
          min = Math.min(min, value);
        }
      }
      if (min !== Number.POSITIVE_INFINITY && min > 0) worst = Math.max(worst, max / min);
    }
    return worst;
  }, [data.series, logScale]);

  // 20배쯤부터 작은 쪽 선이 축 바닥에 붙어 기울기를 읽을 수 없다
  const spreadTooWide = spread >= 20;

  /*
   * 표시 통화와 맞는 컨센서스만 그린다.
   *
   * 실제값은 「표시 통화」로 환산되지만 추정치는 받은 그대로다. 달러 추정치를
   * 원화 차트에 얹으면 밴드가 실선에서 1,300배 떨어진 자리에 그려진다.
   * 국내 조사 기록은 원화라서 반대로 원화 보기에서만 맞는다.
   */
  // 'mixed' 는 기업마다 자기 통화로 그린다는 뜻이라 어느 쪽 추정치든 제자리에 얹힌다
  const drawableConsensus = data.consensus.filter(
    (c) => currency === 'mixed' || currency === c.currency,
  );

  // 밴드가 실제로 그려지는 조건. 안내 문구를 그때만 띄운다.
  const consensusShown =
    !overlay &&
    data.series.some((metric) =>
      drawableConsensus.some((c) => c.estimates[metric.metricId] !== undefined),
    );

  /*
   * 목표주가 가닥이 뻗을 자리를 축 끝에 한 칸 만든다.
   *
   * 차트끼리 X축이 어긋나면 안 되므로 **모든 차트에** 같은 축을 준다.
   * 값 표와 툴팁에는 원래 축을 그대로 준다 — 실제값이 없는 칸이라
   * "데이터 없음" 만 뜨는데, 그건 읽을 것이 아니라 소음이다.
   */
  const showsPrice = data.series.some((m) => m.metricId === 'closePrice');
  const hasProjections = drawableConsensus.some(
    (c) => projectionsFor(c, MAX_PROJECTIONS).length > 0,
  );
  const axisPeriods = useMemo(() => {
    const last = data.periods[data.periods.length - 1];
    if (!showsPrice || !hasProjections || overlay || last === undefined) return data.periods;
    return [...data.periods, nextPeriodLabel(last)];
  }, [data.periods, showsPrice, hasProjections, overlay]);

  // 직접 조사한 기록은 제공처 데이터와 구분해서 보여줘야 한다 — 출처와 조사 시점까지
  const researched = data.consensus.filter((c) => c.sources !== undefined && c.sources.length > 0);
  const researchedIds = new Set(researched.map((c) => c.companyId));

  /*
   * 현재 목표주가는 시계열이 아니라 "지금 값" 이다. 있을 때만 따로 알린다.
   *
   * 직접 조사한 것은 제 상자에서 출처와 함께 보여주므로 여기서 뺀다 —
   * 양쪽에 다 실으면 같은 숫자가 두 번 나온다.
   */
  const priceTargets = data.consensus.filter(
    (c) => c.priceTarget !== null && !researchedIds.has(c.companyId),
  );

  /*
   * 컨센서스를 켰는데 밴드가 안 보이는 경우를 설명한다.
   *
   * 추정치는 매출액·EPS 에만 있다. 영업이익·주가를 보고 있으면 아무 일도
   * 일어나지 않는데, 아무 말도 없으면 "기능이 고장났나" 로 읽힌다.
   */
  const hasEstimates = data.consensus.some((c) => Object.keys(c.estimates).length > 0);
  const shownMetricIds = new Set(data.series.map((m) => m.metricId));
  const estimatedButNotShown = data.consensus
    .flatMap((c) => Object.keys(c.estimates))
    .filter((metricId) => !shownMetricIds.has(metricId as never));

  // 추정치는 있는데 표시 통화가 달라서 못 그리는 경우. 어느 쪽으로 바꿔야 하는지 알려준다
  const blockedCurrency =
    hasEstimates && drawableConsensus.length === 0 ? (currency === 'KRW' ? 'USD' : 'KRW') : null;

  const consensusIdle = !consensusShown && hasEstimates;

  /*
   * 분기 축에서 추정 밴드가 빠진 것을 차트 옆에서 말한다.
   *
   * 토글 설명에도 적어 뒀지만 그건 화면 위쪽이라, 분기로 바꾸고 차트만
   * 보고 있으면 밴드가 왜 사라졌는지 알 수 없다.
   */
  const quarterly = (data.periods[0] ?? '').includes('Q');
  const estimatesDroppedByQuarter =
    quarterly &&
    data.consensus.length > 0 &&
    data.series.some((m) => m.metricId === 'eps' || m.metricId === 'revenue');

  const lineCount = data.series.length * data.companies.length;
  // 겹쳐 보기는 한 차트라 세로 공간을 몰아 쓸 수 있다
  const height = overlay ? 420 : chartHeight(data.series.length);

  return (
    <HoverSyncProvider>
      <div className="flex flex-col gap-3">
        <ExportButtons data={data} captureRef={captureRef} />

        {/*
          이미지로 담는 범위. 범례·값 표·차트까지 넣고 경고 목록은 뺀다 —
          경고는 화면에서 읽는 안내이지 차트의 일부가 아니다.
        */}
        <div ref={captureRef} className="flex flex-col gap-3 bg-[var(--surface-sunken)]">
          {overlay ? (
            <OverlayLegend companies={data.companies} metrics={data.series} />
          ) : (
            <SharedLegend companies={data.companies} provenance={data.provenance} />
          )}

          <ReadoutPanel
            companies={data.companies}
            metrics={data.series}
            periods={data.periods}
            currency={currency}
          />

          {spreadTooWide && (
            <p className="rounded-xl border-2 border-[#e8d5a8] bg-[#fffaf0] px-4 py-2.5 text-sm">
              가장 큰 값과 작은 값이 {Math.round(spread).toLocaleString('ko-KR')}배 차이라, 작은
              쪽은 바닥에 눌려 변화가 없어 보입니다.{' '}
              <button
                type="button"
                onClick={() => onLogScaleChange(true)}
                className="font-medium text-[#0072B2] underline underline-offset-2"
              >
                로그 축으로 보기
              </button>
              {' — '}같은 배수 변화를 같은 높이로 그려서 두 기업의 흐름이 함께 읽힙니다.
            </p>
          )}

          {overlay && lineCount > OVERLAY_READABLE_LINES && (
            <p className="rounded-xl border-2 border-[#e8d5a8] bg-[#fffaf0] px-4 py-2.5 text-sm">
              선이 {lineCount}개라 겹쳐 보기로는 구분이 어렵습니다. 기업이나 지표를 줄이거나
              쌓아 보기로 돌아가세요.
            </p>
          )}

          {estimatesDroppedByQuarter && (
            <p className="rounded-xl border border-[var(--line)] bg-white px-4 py-2.5 text-sm text-[var(--ink-muted)]">
              매출액·EPS <strong className="font-medium">추정 밴드는 분기 보기에서 빠집니다</strong>{' '}
              — 애널리스트 추정치가 연 단위라 분기 칸에 얹으면 자리가 어긋납니다. 「연간」으로
              바꾸면 보입니다. 목표주가 가닥은 분기에서도 그대로 나옵니다.
            </p>
          )}

          {consensusIdle && (
            <p className="rounded-xl border border-[var(--line)] bg-white px-4 py-2.5 text-sm text-[var(--ink-muted)]">
              {overlay
                ? '겹쳐 보기에서는 추정치 밴드를 그리지 않습니다. 「한 차트에 겹쳐 보기」를 끄면 보입니다.'
                : blockedCurrency !== null
                  ? `추정치는 ${blockedCurrency === 'USD' ? '달러' : '원화'} 기준이라 지금 표시 통화에서는 밴드를 그리지 않습니다. 「표시 통화」를 ${blockedCurrency === 'USD' ? '달러' : '원화'}나 「원래 통화」로 바꾸면 보입니다.`
                  : estimatedButNotShown.length > 0
                    ? `애널리스트 추정치는 매출액·EPS 에만 있습니다. 지금 보고 있는 지표에는 추정치가 없어 밴드가 그려지지 않았습니다 — 「매출액」이나 「EPS」를 골라 보세요.`
                    : '이 기업의 추정치를 찾지 못했습니다.'}
              {priceTargets.length > 0 && (
                <>
                  {' '}
                  현재 목표주가 컨센서스:{' '}
                  {priceTargets
                    .map((c) => {
                      const company = data.companies.find((x) => x.id === c.companyId);
                      const t = c.priceTarget;
                      const name = company?.nameKo ?? c.companyId;
                      return `${name} ${t?.low ?? '?'}~${t?.high ?? '?'} (평균 ${t?.avg ?? '?'})`;
                    })
                    .join(' · ')}
                  .
                </>
              )}
            </p>
          )}

          {consensusShown && (
            <p className="rounded-xl border border-[var(--line)] bg-white px-4 py-2.5 text-sm text-[var(--ink-muted)]">
              옅은 띠는 <strong className="font-medium">애널리스트 추정치</strong>의 최고~최저
              범위이고, 점선은 평균입니다. 실선(실제 공시값)이 띠 안에 있으면 그 해 추정이
              맞았다는 뜻입니다.{' '}
              <strong className="font-medium">추정치는 예측이 아니라 애널리스트의 의견</strong>
              입니다 — 당시의 정보와 판단이 섞여 있고, 실제와 다를 수 있습니다.
              {priceTargets.length > 0 && (
                <>
                  {' '}
                  현재 목표주가 컨센서스:{' '}
                  {priceTargets
                    .map((c) => {
                      const company = data.companies.find((x) => x.id === c.companyId);
                      const t = c.priceTarget;
                      const name = company?.nameKo ?? c.companyId;
                      return `${name} ${t?.low ?? '?'}~${t?.high ?? '?'} (평균 ${t?.avg ?? '?'})`;
                    })
                    .join(' · ')}
                  . 목표주가는 과거 이력을 받을 수 없어 지금 값만 보여줍니다.
                </>
              )}
            </p>
          )}

          {/*
            직접 조사 기록은 제공처 데이터와 섞이면 안 된다.
            누가 언제 어디서 본 숫자인지 밝혀야 그 값을 믿을지 판단할 수 있다.
          */}
          {researched.length > 0 && (
            <div className="rounded-xl border border-[#c8a2c8] bg-[#faf5fb] px-4 py-2.5 text-sm">
              {researched.map((c) => {
                const company = data.companies.find((x) => x.id === c.companyId);
                const name = company?.nameKo ?? c.companyId;
                return (
                  <p key={c.companyId} className="[&+&]:mt-1.5">
                    <strong className="font-medium">{name}</strong>의 컨센서스는 제공처에서 받은
                    값이 아니라 <strong className="font-medium">직접 조사해 적어 둔 기록</strong>
                    입니다
                    {c.asOf !== undefined && <> (조사일 {c.asOf})</>}. 적은 뒤에 바뀌었을 수
                    있습니다.
                    {c.priceTarget !== null && (
                      <>
                        {' '}
                        목표주가{' '}
                        <span className="tabular">
                          {formatByUnit(c.priceTarget.low, '통화', 'KRW')}~
                          {formatByUnit(c.priceTarget.high, '통화', 'KRW')}
                        </span>
                        , 평균{' '}
                        <strong className="font-medium tabular">
                          {formatByUnit(c.priceTarget.avg, '통화', 'KRW')}
                        </strong>
                        .
                      </>
                    )}
                    {c.note !== undefined && <> {c.note}</>}{' '}
                    {c.sources?.map((url, i) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-[#0072B2] underline underline-offset-2"
                      >
                        출처{c.sources !== undefined && c.sources.length > 1 ? ` ${i + 1}` : ''} ↗
                        {i < (c.sources?.length ?? 0) - 1 ? ' ' : ''}
                      </a>
                    ))}
                  </p>
                );
              })}
            </div>
          )}

          {overlay ? (
            <OverlayChart data={data} height={height} logScale={logScale} />
          ) : (
            <div className="flex flex-col gap-3">
              {data.series.map((metric, index) => (
                <MetricChart
                  key={metric.metricId}
                  metric={metric}
                  companies={data.companies}
                  periods={axisPeriods}
                  height={height}
                  showXAxisLabels={index === data.series.length - 1}
                  logScale={logScale}
                  currency={currency}
                  consensus={drawableConsensus}
                />
              ))}
            </div>
          )}
        </div>

        {/* 커서 옆 툴팁. 리포트 링크를 누를 수 있으려면 커서 가까이 있어야 한다 */}
        <HoverTooltip
          companies={data.companies}
          metrics={data.series}
          periods={data.periods}
          currency={currency}
        />

        <KoreanConsensusLink companies={data.companies} periods={data.periods} />

        <WarningList warnings={data.warnings} companies={data.companies} />
      </div>
    </HoverSyncProvider>
  );
}
