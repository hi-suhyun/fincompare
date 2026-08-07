import { LINE_WIDTH, metricLineStyle } from '@fincompare/shared';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { SeriesResponse } from '../lib/api.js';
import { useHoverSync } from './hoverSync.js';

interface Props {
  data: SeriesResponse;
  height: number;
  logScale: boolean;
}

/**
 * 여러 지표를 한 차트에 겹쳐 그린다.
 *
 * 원칙적으로 이 서비스는 이중 Y축과 겹쳐 그리기를 금지한다. 스케일이 다른 지표를
 * 한 축에 놓으면 두 선이 교차하는 지점이 축 설정에 따라 임의로 만들어져서,
 * 없는 상관관계를 있는 것처럼 보이게 하기 때문이다.
 *
 * **정규화 모드에서는 그 문제가 사라진다.** 모든 계열이 "시작 시점 = 100" 이라는
 * 같은 단위(지수)로 바뀌므로 한 축에 놓는 것이 정당하다. 축이 하나뿐이니
 * 축 설정으로 교차점을 조작할 여지도 없다.
 *
 * 그래서 이 컴포넌트는 정규화 모드에서만 쓰인다 (App 에서 강제).
 *
 * 구분은 두 축으로 나눈다:
 *   색 = 기업 (쌓아 보기와 동일하게 유지 — 눈이 다시 배우지 않아야 한다)
 *   선 = 지표
 */
const Y_AXIS_WIDTH = 78;
const CHART_MARGIN = { top: 8, right: 24, bottom: 4, left: 0 };

interface OverlayLine {
  key: string;
  companyId: string;
  color: string;
  dash: string | null;
  name: string;
}

export function OverlayChart({ data, height, logScale }: Props): React.ReactElement {
  const { activePeriod, setActivePeriod } = useHoverSync();

  const lines: OverlayLine[] = [];
  for (const [metricIndex, metric] of data.series.entries()) {
    const lineStyle = metricLineStyle(metricIndex);
    for (const company of data.companies) {
      lines.push({
        key: `${company.id}|${metric.metricId}`,
        companyId: company.id,
        color: company.color,
        dash: lineStyle.dash,
        name: `${company.nameKo ?? company.id} · ${metric.label}`,
      });
    }
  }

  const rows = data.periods.map((period, index) => {
    const row: Record<string, string | number | null> = { period };
    for (const [metricIndex, metric] of data.series.entries()) {
      void metricIndex;
      for (const company of data.companies) {
        row[`${company.id}|${metric.metricId}`] = metric.data[company.id]?.[index] ?? null;
      }
    }
    return row;
  });

  const allValues = data.series.flatMap((m) => data.companies.flatMap((c) => m.data[c.id] ?? []));
  const canUseLog = allValues.every((v) => v === null || v > 0);
  const useLog = logScale && canUseLog;

  return (
    <section className="rounded-xl border border-[var(--line)] bg-white px-4 pb-2 pt-3">
      <div className="mb-1 flex items-baseline gap-2">
        <h3 className="text-lg font-semibold">지표 겹쳐 보기</h3>
        <span className="text-sm text-[var(--ink-muted)]">(지수, 시작 시점 = 100)</span>
        <span className="ml-auto text-sm text-[var(--ink-muted)]">
          같은 단위로 맞췄으므로 한 축에 겹칠 수 있습니다
        </span>
      </div>

      {logScale && !canUseLog && (
        <p className="mb-1 text-sm text-[#8a5a00]">
          0 이하 값이 있어 로그 축을 적용하지 않았습니다.
        </p>
      )}

      <ResponsiveContainer width="100%" height={height}>
        <LineChart
          data={rows}
          margin={CHART_MARGIN}
          onMouseMove={(state) => {
            const label = state.activeLabel;
            if (typeof label === 'string') setActivePeriod(label);
          }}
          onMouseLeave={() => setActivePeriod(null)}
        >
          <CartesianGrid stroke="#e8eaee" vertical={false} />
          <Tooltip content={() => null} cursor={false} isAnimationActive={false} />

          <XAxis
            dataKey="period"
            tick={{ fontSize: 14, fill: 'var(--ink-muted)' }}
            tickLine={false}
            axisLine={{ stroke: 'var(--line)' }}
            height={28}
            interval="preserveStartEnd"
            minTickGap={12}
          />

          <YAxis
            width={Y_AXIS_WIDTH}
            tick={{ fontSize: 14, fill: 'var(--ink-muted)' }}
            tickLine={false}
            axisLine={false}
            scale={useLog ? 'log' : 'auto'}
            domain={['auto', 'auto']}
            tickFormatter={(value: number) => value.toFixed(0)}
          />

          {/* 시작 기준선. 이 위로 올라갔는지 아래로 내려갔는지가 이 차트의 핵심이다 */}
          <ReferenceLine y={100} stroke="#b9bec7" strokeWidth={1.5} strokeDasharray="2 4" />

          {activePeriod !== null && (
            <ReferenceLine x={activePeriod} stroke="#16181d" strokeWidth={1.5} strokeDasharray="4 3" />
          )}

          {lines.map((line) => (
            <Line
              key={line.key}
              type="linear"
              dataKey={line.key}
              stroke={line.color}
              strokeWidth={LINE_WIDTH}
              {...(line.dash === null ? {} : { strokeDasharray: line.dash })}
              connectNulls={false}
              dot={{ r: 3, strokeWidth: 0, fill: line.color }}
              activeDot={{ r: 6, strokeWidth: 2, stroke: '#fff' }}
              isAnimationActive={false}
              name={line.name}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </section>
  );
}
