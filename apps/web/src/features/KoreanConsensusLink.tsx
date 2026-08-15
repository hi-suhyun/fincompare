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

/**
 * 검색 기간.
 *
 * 날짜를 안 주면 한경이 **최근 7일**로 잡는다. 그 주에 리포트가 안 나온
 * 기업은 "결과가 없습니다"만 보게 되어, 링크가 고장난 것처럼 읽힌다.
 * 2년이면 어지간한 기업은 리포트가 몇 건씩 잡힌다.
 */
const SEARCH_YEARS = 2;

/** 종목 리포트만. 산업·시장 리포트가 섞이면 그 기업 이야기가 묻힌다 */
const REPORT_TYPE_COMPANY = 'CO';

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function KoreanConsensusLink({ companies }: Props): React.ReactElement | null {
  const korean = companies.filter((c) => c.country === 'KR');
  if (korean.length === 0) return null;

  const today = new Date();
  const from = new Date(today);
  from.setFullYear(from.getFullYear() - SEARCH_YEARS);

  return (
    <section className="rounded-xl border border-[var(--line)] bg-white px-4 py-3">
      <h3 className="font-semibold">국내 기업 애널리스트 리포트</h3>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">
        증권사 리포트는 저작물이라 이 화면으로 가져오지 않습니다. 원문에서 직접 확인하세요.
      </p>

      <ul className="mt-2.5 flex flex-wrap gap-2">
        {korean.map((company) => {
          const name = company.nameKo ?? company.id;
          /*
           * search_text 가 실제로 필터링하는 항목이다.
           * search_value 도 폼에 있지만 걸어도 안 먹고, 둘을 같이 넘기면
           * 오히려 결과가 비어 버린다 — 하나만 쓴다.
           */
          const query = new URLSearchParams({
            search_text: name,
            sdate: isoDate(from),
            edate: isoDate(today),
            report_type: REPORT_TYPE_COMPANY,
          });
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
