import type { SeriesCompany } from '../lib/api.js';
import { periodToRange, reportSearchUrl } from './reportLink.js';

interface Props {
  companies: readonly SeriesCompany[];
  /** 현재 보고 있는 기간 축. 링크를 그 구간으로 맞춘다 */
  periods: readonly string[];
}

/**
 * 국내 기업 리포트 안내.
 *
 * 증권사 리포트와 그 컨센서스는 저작물이다. 가져와서 저장하거나 화면에
 * 다시 뿌리지 않고, 원문을 보러 가는 길만 놓는다.
 *
 * 시점별 링크는 값 표(ReadoutPanel)에 있다. 여기는 "왜 숫자가 없는지" 를
 * 설명하고 전체 기간 링크를 주는 자리다.
 */
export function KoreanConsensusLink({ companies, periods }: Props): React.ReactElement | null {
  const korean = companies.filter((c) => c.country === 'KR');
  if (korean.length === 0) return null;

  const first = periods[0];
  const last = periods[periods.length - 1];
  if (first === undefined || last === undefined) return null;

  return (
    <section className="rounded-xl border border-[var(--line)] bg-white px-4 py-3">
      <h3 className="font-semibold">국내 기업 애널리스트 리포트</h3>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">
        증권사 리포트의 목표주가·추정치는 저작물이라{' '}
        <strong className="font-medium">자동으로 받아와 보관하지 않습니다.</strong> 차트 위 값
        표에서 <strong className="font-medium">그 시점 리포트</strong>로 바로 갈 수 있고, 아래는
        보고 있는 기간 전체입니다.
      </p>

      <ul className="mt-2.5 flex flex-wrap gap-2">
        {korean.map((company) => {
          const name = company.nameKo ?? company.id;
          // 축의 처음부터 끝까지를 한 구간으로 묶는다
          const start = periodToRange(first, name);
          const end = periodToRange(last, name);
          return (
            <li key={company.id}>
              <a
                href={reportSearchUrl({ name, from: start.from, to: end.to })}
                target="_blank"
                // noreferrer 까지 붙여야 원본 탭 정보가 새지 않는다
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border-2 border-[var(--line)]
                           px-3 py-2 font-medium hover:border-[#0072B2] hover:text-[#0072B2]"
              >
                <span
                  aria-hidden
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: company.color }}
                />
                {name} 리포트 보기
                <span aria-hidden>↗</span>
              </a>
            </li>
          );
        })}
      </ul>

      <p className="mt-2 text-sm text-[var(--ink-muted)]">한경 컨센서스에서 열립니다.</p>
    </section>
  );
}
