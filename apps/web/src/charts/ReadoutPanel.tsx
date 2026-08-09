import type { SeriesCompany, SeriesMetric } from '../lib/api.js';
import { NO_DATA, formatByUnit } from '../lib/format.js';
import type { DisplayCurrency } from '../lib/format.js';
import { useHoverSync } from './hoverSync.js';

interface Props {
  companies: readonly SeriesCompany[];
  metrics: readonly SeriesMetric[];
  periods: readonly string[];
  /** 표시 통화. 금액 표기가 이 값을 따른다 */
  currency: DisplayCurrency;
}

/**
 * 호버 시점의 전 기업·전 지표 값을 한 번에 보여준다.
 *
 * 커서를 따라다니는 툴팁 대신 고정 패널로 둔 이유:
 *  - 지표 4개 × 기업 5개면 툴팁이 커져서 차트를 가린다
 *  - 따라다니는 창은 눈으로 쫓아야 한다. 자리가 고정되면 시선이 안 흔들린다
 *  - 호버를 풀어도 마지막 시점이 남아서 값을 다시 확인할 수 있다
 *
 * 세로 기준선은 차트에 그대로 있으므로 "어느 시점인지"는 차트에서,
 * "값이 얼마인지"는 여기서 읽는다.
 */
export function ReadoutPanel({
  companies,
  metrics,
  periods,
  currency,
}: Props): React.ReactElement {
  const { activePeriod } = useHoverSync();

  const period = activePeriod ?? periods[periods.length - 1] ?? null;
  const index = period === null ? -1 : periods.indexOf(period);

  return (
    <div
      // readout-panel 클래스는 이미지 내보내기에서 sticky·스크롤을 풀기 위한 표식이다
      // (index.css 의 [data-exporting] 규칙). 화면에서는 아무 영향이 없다.
      className="readout-panel sticky top-0 z-10 overflow-x-auto rounded-xl border
                 border-[var(--line)] bg-white/95 px-4 py-3 backdrop-blur"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="mb-2 flex items-baseline gap-2">
        <span className="tabular text-xl font-bold">{period ?? '—'}년</span>
        <span className="text-sm text-[var(--ink-muted)]">
          {activePeriod === null ? '차트에 마우스를 올리면 그 시점 값이 표시됩니다' : '전체 지표'}
        </span>
      </div>

      <table className="w-full min-w-max border-collapse">
        <thead>
          <tr className="border-b border-[var(--line)] text-left">
            <th scope="col" className="py-1.5 pr-4 font-medium text-[var(--ink-muted)]">
              기업
            </th>
            {metrics.map((metric) => (
              <th
                key={metric.metricId}
                scope="col"
                className="py-1.5 pr-4 text-right font-medium text-[var(--ink-muted)]"
                title={`${metric.label} = ${metric.formula}`}
              >
                {metric.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {companies.map((company) => (
            <tr key={company.id} className="border-b border-[#f0f1f4] last:border-0">
              <th scope="row" className="py-1.5 pr-4 text-left font-medium">
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="inline-block h-3 w-3 shrink-0 rounded-full"
                    style={{ background: company.color }}
                  />
                  {company.nameKo ?? company.id}
                  {company.badges.map((badge) => (
                    <span
                      key={badge}
                      className="rounded bg-[#fff4e0] px-1.5 py-0.5 text-xs text-[#8a5a00]"
                    >
                      {badge}
                    </span>
                  ))}
                </span>
              </th>
              {metrics.map((metric) => {
                const value = index < 0 ? null : (metric.data[company.id]?.[index] ?? null);
                return (
                  <td
                    key={metric.metricId}
                    className={`tabular py-1.5 pr-4 text-right ${
                      value === null ? 'text-[var(--ink-muted)]' : ''
                    }`}
                  >
                    {value === null ? NO_DATA : formatByUnit(value, metric.unit, currency)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
