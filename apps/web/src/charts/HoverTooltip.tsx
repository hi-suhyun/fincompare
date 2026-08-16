import { useEffect, useState } from 'react';
import type { SeriesCompany, SeriesMetric } from '../lib/api.js';
import { formatByUnit, NO_DATA, type DisplayCurrency } from '../lib/format.js';
import { periodToRange, reportSearchUrl } from '../features/reportLink.js';
import { useHoverSync } from './hoverSync.js';

interface Props {
  companies: readonly SeriesCompany[];
  metrics: readonly SeriesMetric[];
  periods: readonly string[];
  currency: DisplayCurrency;
}

/**
 * 기준선에서 띄울 거리(px).
 *
 * 너무 멀면 마우스가 그 사이를 지나며 차트를 벗어난 것으로 잡히고,
 * 너무 가까우면 선을 가린다. 12px 이면 한 번에 걸어 들어갈 수 있다.
 */
const OFFSET_X = 12;
/** 차트 위쪽에서 조금 내려 붙인다. 선의 시작점을 가리지 않게 */
const OFFSET_Y = 8;

/** 화면 끝에서 이만큼 남으면 반대편으로 넘긴다 */
const EDGE_MARGIN = 16;

/**
 * 세로 기준선 옆 툴팁.
 *
 * 고정 값 표(ReadoutPanel)가 이미 있는데 이걸 따로 두는 이유는 **클릭** 때문이다.
 * 리포트 링크가 값 표에만 있으면, 링크로 마우스를 옮기는 순간 차트를 벗어나
 * 시점이 마지막 기간으로 돌아가 버린다 — 누르려던 그 해의 리포트가 아니다.
 *
 * 커서를 따라다니게 만들었더니 이번에는 다가갈 때마다 도망갔다. 그래서
 * **기준선에 고정**한다 — 같은 기간 안에서는 움직이지 않아 걸어 들어갈 수 있다.
 * 툴팁 위로 넘어와도 시점을 유지한다 (hoverSync 의 유예 로직).
 */
export function HoverTooltip({
  companies,
  metrics,
  periods,
  currency,
}: Props): React.ReactElement | null {
  const { activePeriod, point, cancelClear, scheduleClear } = useHoverSync();
  const [viewport, setViewport] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const measure = (): void => setViewport({ w: window.innerWidth, h: window.innerHeight });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  if (activePeriod === null || point === null) return null;

  const index = periods.indexOf(activePeriod);
  if (index === -1) return null;

  const isQuarter = activePeriod.includes('Q');
  const label = isQuarter ? activePeriod : `${activePeriod}년`;
  const korean = companies.filter((c) => c.country === 'KR');

  // 오른쪽·아래가 좁으면 반대편으로 넘긴다. 잘려서 안 보이면 소용없다.
  const estimatedWidth = 320;
  const estimatedHeight = 90 + companies.length * 26 + (korean.length > 0 ? 34 : 0);
  const flipX = point.x + OFFSET_X + estimatedWidth > viewport.w - EDGE_MARGIN;
  const flipY = point.y + OFFSET_Y + estimatedHeight > viewport.h - EDGE_MARGIN;

  const left = flipX ? point.x - OFFSET_X - estimatedWidth : point.x + OFFSET_X;
  const top = flipY ? Math.max(EDGE_MARGIN, point.y - OFFSET_Y - estimatedHeight) : point.y + OFFSET_Y;

  return (
    <div
      // 마우스가 넘어와도 시점이 유지되어야 링크를 누를 수 있다
      onMouseEnter={cancelClear}
      onMouseLeave={scheduleClear}
      style={{ left, top, width: estimatedWidth }}
      className="pointer-events-auto fixed z-50 rounded-xl border border-[var(--line)]
                 bg-white/98 px-3.5 py-3 shadow-lg backdrop-blur"
      role="dialog"
      aria-label={`${label} 값`}
    >
      <div className="mb-1.5 text-lg font-bold tabular">{label}</div>

      <table className="w-full border-collapse text-sm">
        <tbody>
          {companies.map((company) => (
            <tr key={company.id} className="align-baseline">
              <th
                scope="row"
                className="whitespace-nowrap py-0.5 pr-2 text-left font-medium"
              >
                <span
                  aria-hidden
                  className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
                  style={{ backgroundColor: company.color }}
                />
                {company.nameKo ?? company.id}
              </th>
              {metrics.map((metric) => {
                const value = metric.data[company.id]?.[index] ?? null;
                return (
                  <td key={metric.metricId} className="tabular py-0.5 pl-2 text-right">
                    {value === null ? (
                      <span className="text-[var(--ink-muted)]">{NO_DATA}</span>
                    ) : (
                      formatByUnit(value, metric.unit, currency)
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {metrics.length > 1 && (
        <div className="mt-1 flex justify-end gap-2 text-xs text-[var(--ink-muted)]">
          {metrics.map((metric) => (
            <span key={metric.metricId}>{metric.label}</span>
          ))}
        </div>
      )}

      {korean.length > 0 && (
        <div className="mt-2 flex flex-wrap items-baseline gap-2 border-t border-[var(--line)] pt-2 text-sm">
          <span className="text-[var(--ink-muted)]">리포트</span>
          {korean.map((company) => {
            const name = company.nameKo ?? company.id;
            return (
              <a
                key={company.id}
                href={reportSearchUrl(periodToRange(activePeriod, name))}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-[#0072B2] underline underline-offset-2"
                title={`${name} · ${label} 전후 증권사 리포트 (한경 컨센서스)`}
              >
                {name} ↗
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
