import { LINE_WIDTH } from '@fincompare/shared';
import type { SeriesCompany } from '../lib/api.js';

interface Props {
  companies: readonly SeriesCompany[];
  provenance: Record<string, { source: string; consolidation: string; basis: string }>;
}

/**
 * 범례는 화면 상단에 딱 한 번만 둔다.
 *
 * 차트마다 반복하면 지표 4개일 때 같은 정보가 네 번 나온다.
 * 기업별 색상은 모든 차트에서 고정이므로 한 번만 알려주면 된다.
 *
 * 색만으로 구분하지 않고 선 스타일도 함께 보여준다 — 색 구분이 어려운 경우 대비.
 */
export function SharedLegend({ companies, provenance }: Props): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {companies.map((company) => {
        const source = provenance[company.id];
        return (
          <span key={company.id} className="flex items-center gap-2">
            <svg width="34" height="12" aria-hidden className="shrink-0">
              <line
                x1="1"
                y1="6"
                x2="33"
                y2="6"
                stroke={company.color}
                strokeWidth={LINE_WIDTH}
                {...(company.dash === null ? {} : { strokeDasharray: company.dash })}
              />
            </svg>
            <span className="font-medium">{company.nameKo ?? company.id}</span>
            <span className="tabular text-sm text-[var(--ink-muted)]">{company.ticker}</span>
            {company.badges.map((badge) => (
              <span key={badge} className="rounded bg-[#fff4e0] px-1.5 py-0.5 text-sm text-[#8a5a00]">
                {badge}
              </span>
            ))}
            {source !== undefined && (
              // 전문가는 숫자의 출처와 기준을 따진다. 연결/별도가 섞이면 값이 달라진다.
              <span
                className="rounded border border-[var(--line)] px-1.5 py-0.5 text-sm text-[var(--ink-muted)]"
                title={`출처: ${source.source} · ${source.basis}`}
              >
                {source.consolidation}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
