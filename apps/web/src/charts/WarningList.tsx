import { METRIC_META, type MetricId } from '@fincompare/shared';
import type { SeriesCompany, SeriesWarning } from '../lib/api.js';

interface Props {
  warnings: readonly SeriesWarning[];
  companies: readonly SeriesCompany[];
}

/**
 * 데이터에 대한 단서를 숨기지 않는다.
 *
 * 30년 경력 투자자는 숫자가 이상하면 바로 알아챈다. 왜 그런지 화면에서 알 수 있어야
 * 서비스를 믿고 쓸 수 있다. 조용히 넘어가면 "이 서비스는 못 믿겠다"가 된다.
 * (docs/03-user-context.md 2.3)
 */
const WARNING_TEXT: Record<string, { title: string; tone: 'info' | 'caution' }> = {
  METRIC_NOT_TAGGED: { title: '공시에서 해당 계정을 찾지 못했습니다', tone: 'caution' },
  FELL_BACK_TO_SEPARATE: { title: '연결재무제표가 없어 별도재무제표를 썼습니다', tone: 'caution' },
  ROE_USED_ENDING_EQUITY: { title: '기초자본이 없어 기말자본으로 ROE를 계산했습니다', tone: 'info' },
  NEGATIVE_EPS: { title: '적자 구간이라 PER을 계산하지 않았습니다', tone: 'info' },
  PRICE_UNAVAILABLE: { title: '주가 데이터가 없어 밸류에이션을 계산하지 못했습니다', tone: 'info' },
  SHARE_COUNT_JUMP: { title: '액면분할·병합 구간입니다', tone: 'caution' },
  TTM_INCOMPLETE: { title: '분기 데이터가 부족해 TTM을 계산하지 않았습니다', tone: 'info' },
  FISCAL_YEAR_SHIFTED: { title: '결산월이 달라 기간을 보정했습니다', tone: 'info' },
};

export function WarningList({ warnings, companies }: Props): React.ReactElement | null {
  if (warnings.length === 0) return null;

  const nameOf = (id: string): string =>
    companies.find((c) => c.id === id)?.nameKo ?? id;

  const metricLabel = (id: MetricId): string => METRIC_META[id]?.label ?? id;

  return (
    <section className="rounded-xl border border-[var(--line)] bg-white px-4 py-3">
      <h2 className="mb-2 font-semibold">데이터 안내 ({warnings.length})</h2>
      <ul className="flex flex-col gap-1.5">
        {warnings.map((warning, index) => {
          const meta = WARNING_TEXT[warning.code] ?? {
            title: warning.code,
            tone: 'info' as const,
          };
          return (
            <li key={`${warning.companyId}-${warning.code}-${index}`} className="flex gap-2 text-sm">
              <span
                aria-hidden
                className={`mt-0.5 shrink-0 ${
                  meta.tone === 'caution' ? 'text-[#c4551a]' : 'text-[var(--ink-muted)]'
                }`}
              >
                {meta.tone === 'caution' ? '▲' : 'ⓘ'}
              </span>
              <span>
                <span className="font-medium">{nameOf(warning.companyId)}</span>
                <span className="text-[var(--ink-muted)]"> · {metricLabel(warning.metricId)}</span>
                {' — '}
                {warning.detail ?? meta.title}
                {/* 어느 해였는지는 설명 뒤에 붙인다. 연도만 있으면 무슨 문제인지 알 수 없다 */}
                {warning.period !== undefined && (
                  <span className="text-[var(--ink-muted)]"> ({warning.period}년)</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
