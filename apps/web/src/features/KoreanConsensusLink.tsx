import type { SeriesCompany } from '../lib/api.js';

interface Props {
  companies: readonly SeriesCompany[];
}

/**
 * 국내 기업 컨센서스는 링크아웃만 한다.
 *
 * 증권사 리포트와 그 컨센서스는 저작물이다. 가져와서 저장하거나 화면에
 * 다시 뿌리지 않고, 원문을 보러 가는 길만 놓는다.
 *
 * 한경 컨센서스는 종목코드로 바로 열리지 않아 검색 결과로 보낸다.
 */
const HANKYUNG_SEARCH = 'https://consensus.hankyung.com/analysis/list';

export function KoreanConsensusLink({ companies }: Props): React.ReactElement | null {
  const korean = companies.filter((c) => c.country === 'KR');
  if (korean.length === 0) return null;

  return (
    <section className="rounded-xl border border-[var(--line)] bg-white px-4 py-3">
      <h3 className="font-semibold">국내 기업 애널리스트 리포트</h3>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">
        증권사 리포트는 저작물이라 이 화면으로 가져오지 않습니다. 원문에서 직접 확인하세요.
      </p>

      <ul className="mt-2.5 flex flex-wrap gap-2">
        {korean.map((company) => {
          const name = company.nameKo ?? company.id;
          const query = new URLSearchParams({ search_text: name });
          return (
            <li key={company.id}>
              <a
                href={`${HANKYUNG_SEARCH}?${query.toString()}`}
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
