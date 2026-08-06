import { normalizeForSearch, toChosung, type Market } from '@fincompare/shared';
import type { CorpCodeEntry } from '../adapters/dart/corpCode.js';
import type { DartCompanyResponse } from '../adapters/dart/schema.js';
import { marketFromCorpCls } from '../adapters/dart/schema.js';
import { parseAccountingMonth } from '../adapters/dart/numbers.js';
import { ALIAS_BY_STOCK_CODE, prominenceFor } from '../data/koreanAliases.js';

/**
 * corpCode.xml + company.json -> DB 행 만들기.
 *
 * 네트워크·DB 를 타지 않는 순수 변환이라 단위 테스트가 쉽다.
 */

export interface CompanyRow {
  id: string;
  country: 'KR';
  market: Market;
  nameKo: string;
  nameEn: string | null;
  corpCode: string;
  stockCode: string;
  cik: null;
  ticker: null;
  fiscalYearEndMonth: number;
  isAdr: false;
  isSupported: true;
  prominence: number;
}

export interface AliasRow {
  companyId: string;
  alias: string;
  chosung: string | null;
  aliasType: 'KO_NAME' | 'KO_COMMON' | 'EN_SHORT' | 'TICKER';
}

/**
 * corp_cls 가 Y/K 가 아니면 null 을 준다.
 * 종목코드가 남아 있어도 상장폐지(E)나 코넥스(N)면 1차 범위 밖이다.
 * corpCode.xml 만으로는 이걸 구분할 수 없어서 company.json 이 반드시 필요하다.
 */
export function buildCompanyRow(
  entry: CorpCodeEntry,
  detail: DartCompanyResponse,
): CompanyRow | null {
  if (entry.stockCode === null) return null;

  const market = marketFromCorpCls(detail.corp_cls);
  if (market === null) return null;

  // 종목명(stock_name)이 검색에 더 적합하다. corp_name 은 '삼성전자(주)' 처럼 법인격이 붙는다.
  const nameKo = (detail.stock_name ?? entry.corpName).trim();
  const nameEn = (detail.corp_name_eng ?? entry.corpNameEng ?? '').trim();

  return {
    id: `KR:${entry.stockCode}`,
    country: 'KR',
    market,
    nameKo,
    nameEn: nameEn === '' ? null : nameEn,
    corpCode: entry.corpCode,
    stockCode: entry.stockCode,
    cik: null,
    ticker: null,
    fiscalYearEndMonth: parseAccountingMonth(detail.acc_mt),
    isAdr: false,
    isSupported: true,
    prominence: prominenceFor(entry.stockCode),
  };
}

/**
 * 검색 별칭을 만든다.
 *
 * 같은 기업에 여러 표기가 붙는다: 종목명, 법인명, 영문명, 종목코드.
 * 정규화 후 중복은 제거하되, 어느 종류에서 왔는지는 남긴다 (순위 계산에 쓴다).
 */
export function buildAliasRows(company: CompanyRow, corpName: string): AliasRow[] {
  const rows = new Map<string, AliasRow>();

  const add = (raw: string, aliasType: AliasRow['aliasType']): void => {
    const alias = normalizeForSearch(raw);
    if (alias === '') return;
    // 먼저 들어온 종류를 유지한다 — KO_NAME 이 EN_SHORT 보다 먼저 추가된다
    if (rows.has(alias)) return;

    rows.set(alias, {
      companyId: company.id,
      alias,
      chosung: /[가-힣]/.test(raw) ? toChosung(alias) : null,
      aliasType,
    });
  };

  add(company.nameKo, 'KO_NAME');
  add(corpName, 'KO_NAME');
  if (company.nameEn !== null) add(company.nameEn, 'EN_SHORT');
  add(company.stockCode, 'TICKER');

  // 통용 별칭. DART 공식 종목명과 실제로 치는 이름이 다른 경우를 메운다.
  // '현대자동차'(ㅎㄷㅈㄷㅊ) 만으로는 '현대차'(ㅎㄷㅊ) 로 못 찾는다.
  for (const alias of ALIAS_BY_STOCK_CODE.get(company.stockCode) ?? []) {
    add(alias, 'KO_COMMON');
  }

  return [...rows.values()];
}
