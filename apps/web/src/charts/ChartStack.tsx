import { OVERLAY_READABLE_LINES, chartHeight } from '@fincompare/shared';
import { useMemo, useRef } from 'react';
import { ExportButtons } from '../features/export/ExportButtons.js';
import type { SeriesResponse } from '../lib/api.js';
import { resolveCurrency } from '../lib/format.js';
import { HoverSyncProvider } from './hoverSync.js';
import { MetricChart } from './MetricChart.js';
import { OverlayChart } from './OverlayChart.js';
import { OverlayLegend } from './OverlayLegend.js';
import { ReadoutPanel } from './ReadoutPanel.js';
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

  // 밴드가 실제로 그려지는 조건. 안내 문구를 그때만 띄운다.
  const consensusShown =
    !overlay &&
    data.series.some((metric) =>
      data.consensus.some((c) => c.estimates[metric.metricId] !== undefined),
    ) &&
    !(currency === 'KRW');

  // 현재 목표주가는 시계열이 아니라 "지금 값" 이다. 있을 때만 따로 알린다.
  const priceTargets = data.consensus.filter((c) => c.priceTarget !== null);

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

          {overlay ? (
            <OverlayChart data={data} height={height} logScale={logScale} />
          ) : (
            <div className="flex flex-col gap-3">
              {data.series.map((metric, index) => (
                <MetricChart
                  key={metric.metricId}
                  metric={metric}
                  companies={data.companies}
                  periods={data.periods}
                  height={height}
                  showXAxisLabels={index === data.series.length - 1}
                  logScale={logScale}
                  currency={currency}
                  consensus={data.consensus}
                />
              ))}
            </div>
          )}
        </div>

        <KoreanConsensusLink companies={data.companies} />

        <WarningList warnings={data.warnings} companies={data.companies} />
      </div>
    </HoverSyncProvider>
  );
}
