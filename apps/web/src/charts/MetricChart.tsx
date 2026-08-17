import { LINE_WIDTH } from '@fincompare/shared';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Customized,
  Line,
  ReferenceArea,
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

/**
 * Customized 가 넘겨주는 차트 내부값 중 우리가 쓰는 부분.
 *
 * Recharts 가 타입을 공개하지 않아 최소한만 좁혀 쓴다. 없으면 그냥 안 그린다.
 */
interface ChartInternals {
  yAxisMap?: Record<string, { scale?: (value: number) => number }>;
  offset?: { left: number; width: number };
}

/** 평균선을 집기 쉽게 덮는 투명 띠의 높이(px) */
const HIT_AREA_HEIGHT = 18;

function TargetHitAreas({
  chart,
  targets,
  onEnter,
}: {
  chart: ChartInternals;
  targets: readonly CompanyConsensus[];
  onEnter: (c: CompanyConsensus) => void;
}): React.ReactElement | null {
  const yAxis = Object.values(chart.yAxisMap ?? {})[0];
  const scale = yAxis?.scale;
  const offset = chart.offset;
  if (scale === undefined || offset === undefined) return null;

  return (
    <g>
      {targets.map((c) => {
        const avg = c.priceTarget?.avg;
        if (avg === null || avg === undefined) return null;
        const y = scale(avg);
        if (!Number.isFinite(y)) return null;
        return (
          <rect
            key={`${c.companyId}-hit`}
            x={offset.left}
            y={y - HIT_AREA_HEIGHT / 2}
            width={offset.width}
            height={HIT_AREA_HEIGHT}
            fill="transparent"
            style={{ cursor: 'pointer' }}
            onMouseEnter={() => onEnter(c)}
          />
        );
      })}
    </g>
  );
}

/**
 * 목표주가 띠를 마지막 몇 구간에 걸칠지.
 *
 * 3 이면 최근 3년에만 걸린다. 목표주가는 "지금" 하나뿐이라 과거까지 덮으면
 * 그때도 그렇게 봤다는 거짓말이 된다.
 */
const TARGET_BAND_PERIODS = 3;

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
  const [openTargets, setOpenTargets] = useState<CompanyConsensus | null>(null);

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
   * 목표주가는 주가 차트에 가로 띠로 눕힌다.
   *
   * 연도별 추정치와 달리 목표주가는 "지금 값" 하나뿐이라 시계열이 될 수 없다.
   * 그래도 주가 차트 위에 눕혀 두면 **지금 주가가 증권가 시각의 어디쯤인지**가
   * 한눈에 보인다 — 이게 목표주가로 답할 수 있는 유일하게 정직한 질문이다.
   *
   * 축은 띠까지 담기게 아래 domain 에서 직접 넓힌다. 목표주가가 축 위로
   * 잘려 나가면 "얼마나 위인지" 를 못 읽어서 띠를 그린 의미가 없다.
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

  // 축이 담아야 하는 목표주가 값들. 로그 축은 눈금 규칙이 달라 건드리지 않는다
  const targetBounds = useLog
    ? []
    : priceTargets
        .flatMap((c) => [c.priceTarget?.low, c.priceTarget?.high])
        .filter((v): v is number => typeof v === 'number');

  /*
   * 띠를 마지막 몇 해에만 건다.
   *
   * 전 구간에 깔면 2016년 자리까지 덮여서 "그때도 이렇게 봤다" 로 읽힌다.
   * 목표주가는 오늘 하나뿐이라 그건 거짓이다. 오른쪽 끝에 붙여 두면
   * 비교 대상이 마지막 실제 주가라는 게 그림만으로 드러난다.
   */
  const targetFrom = periods[Math.max(0, periods.length - TARGET_BAND_PERIODS)];
  const targetTo = periods[periods.length - 1];
  /*
   * 띠를 걸 구간. 축이 비어 있으면 걸 자리가 없어 통째로 생략한다.
   * 하나로 묶어 둬야 아래에서 from·to 가 있다는 것이 타입으로 좁혀진다.
   */
  const targetSpan =
    priceTargets.length > 0 && targetFrom !== undefined && targetTo !== undefined
      ? { from: targetFrom, to: targetTo }
      : null;

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

      {priceTargets.length > 0 && (
        <p className="mb-1 text-sm text-[var(--ink-muted)]">
          가로 띠는 <strong className="font-medium">현재 목표주가</strong>의 최고~최저 범위,
          점선은 평균입니다. 과거 시점이 아니라 <strong className="font-medium">지금</strong>{' '}
          시각이라 가로로 눕혀 둡니다 — 마지막 실제 주가와의 거리가 곧 증권가가 보는 여지입니다.
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
            consensus={openTargets}
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
            Fragment 로 묶지 않는다. Recharts 는 자식을 훑어 ReferenceArea 를
            찾는데 Fragment 안까지 내려가지 않아서, 묶는 순간 통째로 사라진다.
            위 밴드도 같은 이유로 두 번 나눠 그린다.
          */}
          {targetSpan === null
            ? null
            : priceTargets.map((c) => {
            const company = companies.find((x) => x.id === c.companyId);
            const t = c.priceTarget;
            if (company === undefined || t === null || t.low === null || t.high === null) {
              return null;
            }
            return (
              <ReferenceArea
                key={`${c.companyId}-target-range`}
                x1={targetSpan.from}
                x2={targetSpan.to}
                y1={t.low}
                y2={t.high}
                fill={company.color}
                fillOpacity={0.1}
                stroke="none"
              />
            );
          })}

          {targetSpan === null
            ? null
            : priceTargets.map((c) => {
            const company = companies.find((x) => x.id === c.companyId);
            const t = c.priceTarget;
            if (company === undefined || t === null || t.avg === null) return null;
            return (
              <ReferenceLine
                key={`${c.companyId}-target-avg`}
                segment={[
                  { x: targetSpan.from, y: t.avg },
                  { x: targetSpan.to, y: t.avg },
                ]}
                stroke={company.color}
                strokeWidth={1.5}
                // 점선이라야 실제 주가(실선)와 헷갈리지 않는다
                strokeDasharray="6 4"
              />
            );
          })}

          {/*
            평균선을 집을 수 있게 투명한 띠를 덧댄다.
            1.5px 선은 마우스로 맞히기 어렵고, Recharts 의 ReferenceLine 은
            마우스 이벤트를 넘겨주지 않는다. Customized 로 실제 축 스케일을
            받아 와야 평균값의 픽셀 위치를 정확히 알 수 있다.
          */}
          {targetSpan !== null && (
            <Customized
              component={(props: unknown) => (
                <TargetHitAreas
                  chart={props as ChartInternals}
                  targets={priceTargets}
                  onEnter={setOpenTargets}
                />
              )}
            />
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
