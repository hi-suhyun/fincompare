/**
 * 한경 컨센서스로 나가는 링크.
 *
 * 리포트 내용·목표주가·추정치는 **가져오지 않는다.** 증권사 리포트는
 * 저작물이고 한경도 "어떠한 경우에도 허가 없이 전재·복사될 수 없다" 고
 * 명시한다. 우리는 아무것도 저장하지 않고 길만 놓는다.
 *
 * 그래도 쓸모가 있는 이유: 차트에서 "2023년에 왜 꺾였지?" 하는 순간
 * 그 시점의 리포트로 두 번의 클릭 없이 바로 갈 수 있다.
 */

const HANKYUNG_SEARCH = 'https://consensus.hankyung.com/analysis/list';

/** 종목 리포트만. 산업·시장 리포트가 섞이면 그 기업 이야기가 묻힌다 */
const REPORT_TYPE_COMPANY = 'CO';

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface ReportLinkRange {
  /** 검색어. 기업명을 그대로 쓴다 */
  name: string;
  from: Date;
  to: Date;
}

/**
 * 검색 URL을 만든다.
 *
 * search_text 가 실제로 필터링하는 항목이다. search_value 도 폼에 있지만
 * 걸어도 안 먹고, 둘을 같이 넘기면 오히려 결과가 비어 버린다.
 *
 * 날짜를 안 주면 한경이 최근 7일로 잡아서, 그 주에 리포트가 없는 기업은
 * "결과가 없습니다" 만 보게 된다 — 링크가 고장난 것처럼 읽힌다.
 */
export function reportSearchUrl({ name, from, to }: ReportLinkRange): string {
  const query = new URLSearchParams({
    search_text: name,
    sdate: isoDate(from),
    edate: isoDate(to),
    report_type: REPORT_TYPE_COMPANY,
  });
  return `${HANKYUNG_SEARCH}?${query.toString()}`;
}

/**
 * 차트의 한 시점("2024" 또는 "2024Q1")을 검색 기간으로 바꾼다.
 *
 * 리포트는 실적 발표 **뒤에** 나오므로 기간을 그대로 쓰면 정작 그 실적을
 * 논한 리포트가 빠진다. 끝을 두 달 늘려 잡는다.
 */
export function periodToRange(period: string, name: string): ReportLinkRange {
  const match = /^(\d{4})(?:Q([1-4]))?$/.exec(period);
  if (match === null) {
    const now = new Date();
    const year = new Date(now);
    year.setFullYear(year.getFullYear() - 1);
    return { name, from: year, to: now };
  }

  const year = Number(match[1]);
  const quarter = match[2] === undefined ? null : Number(match[2]);

  const from =
    quarter === null ? new Date(Date.UTC(year, 0, 1)) : new Date(Date.UTC(year, (quarter - 1) * 3, 1));

  const to =
    quarter === null ? new Date(Date.UTC(year + 1, 1, 28)) : new Date(Date.UTC(year, quarter * 3 + 2, 0));

  return { name, from, to };
}
