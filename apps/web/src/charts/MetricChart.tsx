import { LINE_WIDTH } from '@fincompare/shared';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CompanyConsensus, SeriesCompany, SeriesMetric } from '../lib/api.js';
import { formatAxisTick, unitLabel } from '../lib/format.js';
import type { DisplayCurrency } from '../lib/format.js';
import { useHoverSync } from './hoverSync.js';

interface Props {
  metric: SeriesMetric;
  companies: readonly SeriesCompany[];
  periods: readonly string[];
  height: number;
  /** 맨 아래 차트에만 X축 라벨을 노출한다. 위쪽은 눈금선만 */
  showXAxisLabels: boolean;
  logScale: boolean;
  /** 표시 통화. 축 라벨과 눈금이 이 값을 따른다 */
  currency: DisplayCurrency;
  /**
   * 애널리스트 추정 밴드. 추정치가 있는 지표(EPS·매출액)에만 얹는다.
   *
   * 빈 배열이면 아무것도 그리지 않는다 — 토글이 꺼져 있거나, 국내 기업이거나,
   * 키가 없거나, 이 지표에 추정치가 없는 경우다.
   */
  consensus?: readonly CompanyConsensus[];
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
  currency,
  consensus = [],
}: Props): React.ReactElement {
  const { activePeriod, setActivePeriod, setPoint, scheduleClear } = useHoverSync();

  /*
   * 추정 밴드.
   *
   * 통화 단위 지표(매출액 등)는 화면 통화가 원화면 그리지 않는다. 추정치는
   * 달러값인데 실제값만 환산되면 1,400배쯤 어긋난 그림이 된다 —
   * 틀린 밴드를 그리느니 감추고 이유를 밝힌다.
   * EPS 는 정규화 모드에서 지수로 바뀌므로 그때도 뺀다.
   */
  const isMoneyMetric = metric.unit === '통화';
  const currencyMismatch = isMoneyMetric && currency === 'KRW';
  const normalized = metric.unit.startsWith('지수');

  const bands = consensus
    .map((c) => ({ companyId: c.companyId, points: c.estimates[metric.metricId] }))
    .filter(
      (b): b is { companyId: string; points: NonNullable<typeof b.points> } =>
        b.points !== undefined && !currencyMismatch && !normalized,
    );

  const bandHiddenByCurrency =
    currencyMismatch && consensus.some((c) => c.estimates[metric.metricId] !== undefined);

  const rows = periods.map((period, index) => {
    const row: Record<string, string | number | null | [number, number]> = { period };
    for (const company of companies) {
      row[company.id] = metric.data[company.id]?.[index] ?? null;
    }

    // 밴드는 [low, high] 쌍으로 넣는다. Recharts Area 가 이 형태를 범위로 그린다.
    for (const band of bands) {
      const point = band.points[index];
      if (point === undefined || point.low === null || point.high === null) continue;
      row[`${band.companyId}__band`] = [point.low, point.high];
      row[`${band.companyId}__avg`] = point.avg;
    }
    return row;
  });

  const allValues = companies.flatMap((c) => metric.data[c.id] ?? []);
  const displayUnit = unitLabel(metric.unit, allValues, currency);

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

      {bandHiddenByCurrency && (
        <p className="mb-1 text-sm text-[#8a5a00]">
          애널리스트 추정치는 달러 기준이라 원화 보기에서는 밴드를 그리지 않습니다.
          「표시 통화」를 원래 통화나 달러로 바꾸면 보입니다.
        </p>
      )}

      {logScale && !canUseLog && (
        <p className="mb-1 text-sm text-[#8a5a00]">
          0 이하 값이 있어 이 지표는 로그 축을 적용하지 않았습니다.
        </p>
      )}

      {/*
        커서 좌표는 여기서 잡는다. Recharts 의 onMouseMove 는 차트 내부 좌표만
        주는데, 툴팁은 화면 좌표로 띄워야 하기 때문이다.
      */}
      <div
        onMouseMove={(e) => setPoint({ x: e.clientX, y: e.clientY })}
        onMouseLeave={scheduleClear}
      >
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart
          data={rows}
          margin={CHART_MARGIN}
          onMouseMove={(state) => {
            const label = state.activeLabel;
            if (typeof label === 'string') setActivePeriod(label);
          }}
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
            tickFormatter={(value: number) => formatAxisTick(value, metric.unit, currency)}
          />

          {/* 비율 지표는 0선이 의미를 가진다 — 흑자·적자 경계 */}
          {(metric.unit === '%' || allValues.some((v) => v !== null && v < 0)) && (
            <ReferenceLine y={0} stroke="#b9bec7" strokeWidth={1.5} />
          )}

          {activePeriod !== null && (
            <ReferenceLine x={activePeriod} stroke="#16181d" strokeWidth={1.5} strokeDasharray="4 3" />
          )}

          {/*
            밴드를 선보다 먼저 그린다. 나중에 그린 것이 위에 오므로,
            실제 주가 선이 밴드에 가려지면 안 된다.
          */}
          {bands.map((band) => {
            const company = companies.find((c) => c.id === band.companyId);
            if (company === undefined) return null;
            return (
              <Area
                key={`${band.companyId}-band`}
                type="linear"
                dataKey={`${band.companyId}__band`}
                stroke="none"
                fill={company.color}
                fillOpacity={0.14}
                connectNulls={false}
                isAnimationActive={false}
                activeDot={false}
                legendType="none"
                name={`${company.nameKo ?? company.id} 추정 범위`}
              />
            );
          })}

          {bands.map((band) => {
            const company = companies.find((c) => c.id === band.companyId);
            if (company === undefined) return null;
            return (
              <Line
                key={`${band.companyId}-avg`}
                type="linear"
                dataKey={`${band.companyId}__avg`}
                stroke={company.color}
                strokeWidth={1.5}
                // 점선으로 둬야 실제 주가(실선)와 헷갈리지 않는다
                strokeDasharray="2 4"
                connectNulls={false}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
                legendType="none"
                name={`${company.nameKo ?? company.id} 추정 평균`}
              />
            );
          })}

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
        </ComposedChart>
      </ResponsiveContainer>
      </div>
    </section>
  );
}
