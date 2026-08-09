import { OVERLAY_READABLE_LINES, chartHeight } from '@fincompare/shared';
import { useRef } from 'react';
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

interface Props {
  data: SeriesResponse;
  logScale: boolean;
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
export function ChartStack({ data, logScale, overlay }: Props): React.ReactElement {
  const captureRef = useRef<HTMLDivElement>(null);

  // 통화는 여기서 한 번만 정한다. 차트마다 따로 판단하면 축과 표가 어긋난다.
  const currency = resolveCurrency(
    data.displayCurrency,
    data.companies.map((c) => c.country),
  );

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

          {overlay && lineCount > OVERLAY_READABLE_LINES && (
            <p className="rounded-xl border-2 border-[#e8d5a8] bg-[#fffaf0] px-4 py-2.5 text-sm">
              선이 {lineCount}개라 겹쳐 보기로는 구분이 어렵습니다. 기업이나 지표를 줄이거나
              쌓아 보기로 돌아가세요.
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
                />
              ))}
            </div>
          )}
        </div>

        <WarningList warnings={data.warnings} companies={data.companies} />
      </div>
    </HoverSyncProvider>
  );
}
