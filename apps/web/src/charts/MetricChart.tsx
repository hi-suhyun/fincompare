import { LINE_WIDTH } from '@fincompare/shared';
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
import type { SeriesCompany, SeriesMetric } from '../lib/api.js';
import { formatAxisTick, unitLabel } from '../lib/format.js';
import { useHoverSync } from './hoverSync.js';

interface Props {
  metric: SeriesMetric;
  companies: readonly SeriesCompany[];
  periods: readonly string[];
  height: number;
  /** 맨 아래 차트에만 X축 라벨을 노출한다. 위쪽은 눈금선만 */
  showXAxisLabels: boolean;
  logScale: boolean;
}

/**
 * 지표 하나 = 차트 하나.
 *
 * 이중 Y축을 쓰지 않는 이유: 스케일이 다른 지표를 한 축에 겹치면
 * 두 선이 교차하는 지점이 축 설정에 따라 임의로 만들어져서,
 * 없는 상관관계를 있는 것처럼 보이게 한다.
 *
 * Y축 너비를 고정해야 여러 차트의 좌우 폭과 시작점이 정확히 맞는다.
 * 값에 따라 자동으로 잡히게 두면 차트마다 그래프 영역이 어긋나서
 * 같은 연도가 세로로 정렬되지 않는다.
 */
const Y_AXIS_WIDTH = 78;
const CHART_MARGIN = { top: 8, right: 24, bottom: 4, left: 0 };

export function MetricChart({
  metric,
  companies,
  periods,
  height,
  showXAxisLabels,
  logScale,
}: Props): React.ReactElement {
  const { activePeriod, setActivePeriod } = useHoverSync();

  const rows = periods.map((period, index) => {
    const row: Record<string, string | number | null> = { period };
    for (const company of companies) {
      row[company.id] = metric.data[company.id]?.[index] ?? null;
    }
    return row;
  });

  const allValues = companies.flatMap((c) => metric.data[c.id] ?? []);
  const displayUnit = unitLabel(metric.unit, allValues);

  // 로그축은 0 이하 값을 그리지 못한다. 적자가 있으면 조용히 선이 사라진다.
  const canUseLog = allValues.every((v) => v === null || v > 0);
  const useLog = logScale && canUseLog;

  return (
    <section className="rounded-xl border border-[var(--line)] bg-white px-4 pb-2 pt-3">
      <div className="mb-1 flex items-baseline gap-2">
        <h3 className="text-lg font-semibold">{metric.label}</h3>
        <span className="text-sm text-[var(--ink-muted)]">({displayUnit})</span>
        <span
          className="ml-auto text-sm text-[var(--ink-muted)]"
          title={`${metric.formula}\n${metric.basis}`}
        >
          {metric.formula}
        </span>
      </div>

      {logScale && !canUseLog && (
        <p className="mb-1 text-sm text-[#8a5a00]">
          0 이하 값이 있어 이 지표는 로그 축을 적용하지 않았습니다.
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

          {/*
            Recharts 는 <Tooltip> 이 있어야 activeLabel 과 activeDot 을 계산한다.
            차트마다 툴팁을 띄우지는 않을 것이므로 아무것도 그리지 않게 두고,
            값 표시는 ReadoutPanel 하나가 맡는다. cursor 도 끈다 —
            세로 기준선은 아래 ReferenceLine 이 모든 차트에 동기화해서 그린다.
          */}
          <Tooltip content={() => null} cursor={false} isAnimationActive={false} />

          <XAxis
            dataKey="period"
            tick={showXAxisLabels ? { fontSize: 14, fill: 'var(--ink-muted)' } : false}
            tickLine={false}
            axisLine={{ stroke: 'var(--line)' }}
            height={showXAxisLabels ? 28 : 8}
            interval="preserveStartEnd"
            minTickGap={12}
          />

          <YAxis
            width={Y_AXIS_WIDTH}
            tick={{ fontSize: 14, fill: 'var(--ink-muted)' }}
            tickLine={false}
            axisLine={false}
            scale={useLog ? 'log' : 'auto'}
            domain={useLog ? ['auto', 'auto'] : ['auto', 'auto']}
            tickFormatter={(value: number) => formatAxisTick(value, metric.unit)}
          />

          {/* 비율 지표는 0선이 의미를 가진다 — 흑자·적자 경계 */}
          {(metric.unit === '%' || allValues.some((v) => v !== null && v < 0)) && (
            <ReferenceLine y={0} stroke="#b9bec7" strokeWidth={1.5} />
          )}

          {activePeriod !== null && (
            <ReferenceLine x={activePeriod} stroke="#16181d" strokeWidth={1.5} strokeDasharray="4 3" />
          )}

          {companies.map((company) => (
            <Line
              key={company.id}
              type="linear"
              dataKey={company.id}
              stroke={company.color}
              strokeWidth={LINE_WIDTH}
              {...(company.dash === null ? {} : { strokeDasharray: company.dash })}
              // 값이 없는 구간은 선을 끊는다. 이어 버리면 없는 데이터를 지어내는 셈이다.
              connectNulls={false}
              dot={{ r: 3, strokeWidth: 0, fill: company.color }}
              activeDot={{ r: 6, strokeWidth: 2, stroke: '#fff' }}
              isAnimationActive={false}
              name={company.nameKo ?? company.id}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </section>
  );
}
