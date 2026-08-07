import { chartHeight } from '@fincompare/shared';
import { useRef } from 'react';
import { ExportButtons } from '../features/export/ExportButtons.js';
import type { SeriesResponse } from '../lib/api.js';
import { HoverSyncProvider } from './hoverSync.js';
import { MetricChart } from './MetricChart.js';
import { ReadoutPanel } from './ReadoutPanel.js';
import { SharedLegend } from './SharedLegend.js';
import { WarningList } from './WarningList.js';

interface Props {
  data: SeriesResponse;
  logScale: boolean;
}

/**
 * 지표 하나당 차트 하나를 세로로 쌓는다 (small multiples).
 *
 * 모든 차트가 X축(기간)을 공유하고 좌우 폭·시작점이 정확히 맞아야 한다.
 * 맨 아래 차트에만 X축 라벨을 노출하고 위쪽은 눈금선만 둔다 — 같은 연도 라벨이
 * 네 번 반복되면 읽을 것이 늘어날 뿐 정보는 늘지 않는다.
 */
export function ChartStack({ data, logScale }: Props): React.ReactElement {
  const height = chartHeight(data.series.length);
  const captureRef = useRef<HTMLDivElement>(null);

  return (
    <HoverSyncProvider>
      <div className="flex flex-col gap-3">
        <ExportButtons data={data} captureRef={captureRef} />

        {/*
          이미지로 담는 범위. 범례·값 표·차트까지 넣고 경고 목록은 뺀다 —
          경고는 화면에서 읽는 안내이지 차트의 일부가 아니다.
        */}
        <div ref={captureRef} className="flex flex-col gap-3 bg-[var(--surface-sunken)]">
          <SharedLegend companies={data.companies} provenance={data.provenance} />
          <ReadoutPanel companies={data.companies} metrics={data.series} periods={data.periods} />

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
              />
            ))}
          </div>
        </div>

        <WarningList warnings={data.warnings} companies={data.companies} />
      </div>
    </HoverSyncProvider>
  );
}
