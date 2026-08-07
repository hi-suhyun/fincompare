import { LINE_WIDTH, metricLineStyle } from '@fincompare/shared';
import type { SeriesCompany, SeriesMetric } from '../lib/api.js';

interface Props {
  companies: readonly SeriesCompany[];
  metrics: readonly SeriesMetric[];
}

/**
 * 겹쳐 보기 범례.
 *
 * (기업 × 지표) 조합을 하나씩 나열하면 5×4=20줄이 된다. 읽을 수 없다.
 * 색과 선을 **따로** 설명해서 두 줄로 끝낸다 —
 * "파란색은 삼성전자, 파선은 주가" 를 조합하면 어느 선인지 알 수 있다.
 */
export function OverlayLegend({ companies, metrics }: Props): React.ReactElement {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[var(--line)] bg-white px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="w-14 shrink-0 text-sm text-[var(--ink-muted)]">색 = 기업</span>
        {companies.map((company) => (
          <span key={company.id} className="flex items-center gap-2 whitespace-nowrap">
            <span
              aria-hidden
              className="inline-block h-3.5 w-3.5 shrink-0 rounded-full"
              style={{ background: company.color }}
            />
            <span className="font-medium">{company.nameKo ?? company.id}</span>
            {company.badges.map((badge) => (
              <span
                key={badge}
                className="shrink-0 whitespace-nowrap rounded bg-[#fff4e0] px-1.5 py-0.5 text-sm text-[#8a5a00]"
              >
                {badge}
              </span>
            ))}
          </span>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="w-14 shrink-0 text-sm text-[var(--ink-muted)]">선 = 지표</span>
        {metrics.map((metric, index) => {
          const style = metricLineStyle(index);
          return (
            <span
              key={metric.metricId}
              className="flex items-center gap-2 whitespace-nowrap"
              title={metric.formula}
            >
              <svg width="34" height="12" aria-hidden className="shrink-0">
                <line
                  x1="1"
                  y1="6"
                  x2="33"
                  y2="6"
                  stroke="var(--ink)"
                  strokeWidth={LINE_WIDTH}
                  {...(style.dash === null ? {} : { strokeDasharray: style.dash })}
                />
              </svg>
              <span className="font-medium">{metric.label}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
