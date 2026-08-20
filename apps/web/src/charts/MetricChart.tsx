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
import { useRef, useState } from 'react';
import { useHoverSync } from './hoverSync.js';
import { AnalystTargetPanel } from './AnalystTargetPanel.js';
import { lastActualIndex, projectionsFor, type Projection } from './projection.js';

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

/** 가닥을 몇 개까지 그릴지. 넘으면 겹쳐서 오히려 안 읽힌다 */
const MAX_PROJECTIONS = 4;

/** Recharts 가 점 렌더러에 넘겨주는 값 중 우리가 쓰는 것 */
interface DotProps {
  cx?: number;
  cy?: number;
  index?: number;
  value?: number | null;
}

/**
 * 가닥 끝의 점.
 *
 * 예측 지점에만 찍는다. 시작점은 실제 주가 선 위라 이미 점이 있고,
 * 두 번 찍으면 같은 값이 겹쳐 보인다.
 *
 * 점 위에 올리면 어느 증권사가 낸 값인지 편다. 선은 옅어서 집기 어려우므로
 * 눈에 보이는 점보다 큰 투명 원을 겹쳐 둔다.
 */
function ProjectionDot({
  dot,
  projection,
  color,
  onEnter,
}: {
  dot: DotProps;
  projection: Projection;
  color: string;
  onEnter: (p: Projection) => void;
}): React.ReactElement | null {
  const { cx, cy, value } = dot;
  if (cx === undefined || cy === undefined) return null;
  // 시작점(실제 주가와 같은 값)에는 찍지 않는다
  if (value !== projection.target) return null;

  return (
    <g style={{ cursor: 'pointer' }} onMouseEnter={() => onEnter(projection)}>
      <circle cx={cx} cy={cy} r={4} fill={color} fillOpacity={0.75} />
      <circle cx={cx} cy={cy} r={11} fill="transparent" />
    </g>
  );
}


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
  const chartBox = useRef<HTMLDivElement>(null);
  // 평균선을 집었을 때 펼 증권사 표. null 이면 닫혀 있다
  const [openTargets, setOpenTargets] = useState<Projection | null>(null);

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

  /*
   * 목표주가는 주가 선의 연장으로 그린다.
   *
   * 마지막 실제 지점에서 다음 구간까지 증권사별로 한 가닥씩 옅게 뻗는다.
   * 부챗살이 벌어진 폭이 곧 증권가의 의견 차이다. 자세한 이유는 projection.ts.
   */
  const priceTargets =
    metric.metricId === 'closePrice' && !normalized
      ? consensus.filter((c) => {
          const t = c.priceTarget;
          if (t === null) return false;
          // 원화 목표주가를 달러 축에 얹으면 1,300배 어긋난다
          return currency === 'mixed' || currency === t.currency;
        })
      : [];

  const projections = priceTargets.flatMap((c) => projectionsFor(c, MAX_PROJECTIONS));

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

  /*
   * 가닥을 rows 에 심는다.
   *
   * 마지막 실제 지점과 예측 지점 두 칸에만 값을 넣는다. 나머지는 null 이라
   * connectNulls={false} 로 두면 그 구간만 선이 그려진다.
   */
  const anchorIndex = new Map<string, number>();
  for (const company of companies) {
    anchorIndex.set(company.id, lastActualIndex(metric.data[company.id] ?? []));
  }

  const forecastIndex = periods.length - 1;
  for (const p of projections) {
    const from = anchorIndex.get(p.companyId);
    if (from === undefined || from < 0 || from >= forecastIndex) continue;
    const anchor = rows[from];
    const tip = rows[forecastIndex];
    if (anchor === undefined || tip === undefined) continue;
    anchor[p.key] = metric.data[p.companyId]?.[from] ?? null;
    tip[p.key] = p.target;
  }

  const allValues = companies.flatMap((c) => metric.data[c.id] ?? []);
  const displayUnit = unitLabel(metric.unit, allValues, currency);

  // 로그축은 0 이하 값을 그리지 못한다. 적자가 있으면 조용히 선이 사라진다.
  const canUseLog = allValues.every((v) => v === null || v > 0);
  const useLog = logScale && canUseLog;

  // 축이 담아야 하는 목표가들. 로그 축은 눈금 규칙이 달라 건드리지 않는다
  const targetBounds = useLog ? [] : projections.map((p) => p.target);

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

      {projections.length > 0 && (
        <p className="mb-1 text-sm text-[var(--ink-muted)]">
          오른쪽 끝에서 갈라지는 옅은 점선은 <strong className="font-medium">증권사별 목표주가</strong>
          입니다. 점에 마우스를 올리면 어느 증권사인지 나옵니다. 벌어진 폭이 곧 의견 차이입니다 —
          목표주가는 통상 12개월 기준이라, 다음 구간에 찍은 것은 자리를 표시한 것이지 그때
          그 값이 된다는 뜻이 아닙니다.
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
      <div ref={chartBox} onMouseLeave={scheduleClear} className="relative">
        {/*
          평균선 위에 올렸을 때 증권사별 목표가를 편다.
          SVG 안에서는 표를 그릴 수 없어 위에 덮어 띄운다.
        */}
        {openTargets !== null && (
          <AnalystTargetPanel
            projection={openTargets}
            consensus={priceTargets.find((c) => c.companyId === openTargets.companyId)}
            company={companies.find((x) => x.id === openTargets.companyId)}
            onClose={() => setOpenTargets(null)}
          />
        )}
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart
          data={rows}
          margin={CHART_MARGIN}
          onMouseMove={(state) => {
            const label = state.activeLabel;
            if (typeof label !== 'string') return;
            setActivePeriod(label);

            /*
             * 툴팁은 커서가 아니라 **세로 기준선**에 붙인다.
             *
             * 커서를 따라가면 툴팁 쪽으로 마우스를 옮길 때마다 툴팁도 같이
             * 밀려나서 링크를 영영 누를 수 없다. 기준선에 붙여 두면 그 기간
             * 안에서는 가만히 있어서 걸어 들어갈 수 있다.
             */
            const box = chartBox.current?.getBoundingClientRect();
            const coord = state.activeCoordinate;
            if (box === undefined || coord === undefined) return;

            setPoint({
              x: box.left + coord.x,
              y: box.top,
              // 기간이나 차트가 바뀔 때만 옮긴다
              anchor: `${label}|${metric.metricId}`,
            });
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
            /*
             * 목표주가가 실제 주가 범위 밖이면 축을 직접 넓힌다.
             *
             * ReferenceArea 의 ifOverflow="extendDomain" 은 이 조합에서 먹지
             * 않았다. 축이 그대로면 목표주가 띠가 화면 밖으로 잘려 "얼마나
             * 위인지" 를 못 읽는데, 그게 이 띠를 그리는 이유의 전부다.
             */
            domain={targetBounds.length === 0 ? ['auto', 'auto'] : [
              (min: number) => Math.min(min, ...targetBounds),
              (max: number) => Math.max(max, ...targetBounds),
            ]}
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
            목표주가 띠. 실제 주가 선보다 먼저 그려 뒤에 깔리게 한다.
          */}
          {/*
            목표주가 가닥. 실제 선보다 먼저 그려 뒤에 깔리게 한다.
            옅게 두는 건 이게 공시값이 아니라 의견이기 때문이다.
          */}
          {projections.map((p) => {
            const company = companies.find((x) => x.id === p.companyId);
            if (company === undefined) return null;
            return (
              <Line
                key={p.key}
                type="linear"
                dataKey={p.key}
                stroke={company.color}
                strokeOpacity={0.45}
                strokeWidth={1.5}
                strokeDasharray="5 4"
                connectNulls={false}
                isAnimationActive={false}
                legendType="none"
                name={`${p.firm} 목표주가`}
                activeDot={false}
                dot={(dotProps: unknown) => (
                  <ProjectionDot
                    dot={dotProps as DotProps}
                    projection={p}
                    color={company.color}
                    onEnter={setOpenTargets}
                  />
                )}
              />
            );
          })}

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
