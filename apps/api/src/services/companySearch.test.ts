import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type DbHandle } from '../db/client.js';
import { companies, companyAliases } from '../db/schema.js';
import { buildAliasRows, buildCompanyRow, type CompanyRow } from './companySeed.js';
import { searchCompanies } from './companySearch.js';

/** 실제 DART 응답 모양의 최소 픽스처 */
function seedEntry(
  corpCode: string,
  stockCode: string,
  corpName: string,
  stockName: string,
  corpNameEng: string,
  corpCls: string,
  accMt = '12',
) {
  const entry = {
    corpCode,
    corpName,
    corpNameEng,
    stockCode,
    modifyDate: '20240401',
  };
  const detail = {
    status: '000',
    message: '정상',
    corp_name: corpName,
    stock_name: stockName,
    corp_name_eng: corpNameEng,
    stock_code: stockCode,
    corp_cls: corpCls,
    acc_mt: accMt,
  };
  return { entry, detail, corpName };
}

const FIXTURES = [
  seedEntry('00126380', '005930', '삼성전자(주)', '삼성전자', 'SAMSUNG ELECTRONICS CO,.LTD', 'Y'),
  seedEntry('00164779', '000660', '에스케이하이닉스(주)', 'SK하이닉스', 'SK hynix Inc.', 'Y'),
  seedEntry('00164742', '005380', '현대자동차(주)', '현대자동차', 'HYUNDAI MOTOR COMPANY', 'Y'),
  seedEntry('00256598', '035420', '주식회사 네이버', 'NAVER', 'NAVER Corporation', 'Y'),
  seedEntry('00631518', '323410', '주식회사 카카오뱅크', '카카오뱅크', 'KakaoBank Corp.', 'Y'),
  seedEntry('00258801', '035720', '주식회사 카카오', '카카오', 'Kakao Corp.', 'Y'),
  seedEntry('00113058', '036570', '주식회사 엔씨소프트', '엔씨소프트', 'NCSOFT Corporation', 'K'),
  // 상장폐지 — corp_cls 'E' 라 검색에 나오면 안 된다
  seedEntry('00260985', '036720', '한빛네트', '한빛네트', 'Hanbit Net', 'E'),
];

describe('기업 검색', () => {
  let handle: DbHandle;

  beforeEach(async () => {
    handle = await createDb(':memory:');

    const companyRows: CompanyRow[] = [];
    for (const f of FIXTURES) {
      const row = buildCompanyRow(f.entry, f.detail);
      if (row !== null) companyRows.push(row);
    }

    await handle.db.insert(companies).values(
      companyRows.map((r) => ({ ...r, updatedAt: '2026-08-06' })),
    );

    const aliases = companyRows.flatMap((row) => {
      const fixture = FIXTURES.find((f) => f.entry.stockCode === row.stockCode);
      return buildAliasRows(row, fixture?.corpName ?? '');
    });
    await handle.db.insert(companyAliases).values(aliases);
  });

  afterEach(async () => {
    await handle.close();
  });

  const ids = async (q: string, limit = 10): Promise<string[]> =>
    (await searchCompanies(handle.db, q, { limit })).map((r) => r.id);

  it('상장폐지 기업은 시딩 단계에서 걸러진다', async () => {
    const all = await handle.db.select().from(companies);
    expect(all).toHaveLength(7); // 8개 중 한빛네트 제외
    expect(await ids('한빛네트')).toEqual([]);
  });

  it('한글 정확 일치', async () => {
    expect((await ids('삼성전자'))[0]).toBe('KR:005930');
  });

  it('한글 전방 일치', async () => {
    expect(await ids('현대')).toContain('KR:005380');
  });

  it('종목코드로 찾는다 — 전문가는 005930 을 안다', async () => {
    expect((await ids('005930'))[0]).toBe('KR:005930');
  });

  it('영문명으로 찾는다', async () => {
    expect((await ids('samsung'))[0]).toBe('KR:005930');
    expect((await ids('hyundai'))[0]).toBe('KR:005380');
  });

  it('초성으로 찾는다', async () => {
    expect((await ids('ㅅㅅㅈㅈ'))[0]).toBe('KR:005930');
    expect(await ids('ㅎㄷㅈㄷㅊ')).toContain('KR:005380');
  });

  it('통용 별칭으로 찾는다 — "현대차"는 DART 공식명이 아니다', async () => {
    expect(await ids('현대차')).toContain('KR:005380');
    expect(await ids('ㅎㄷㅊ')).toContain('KR:005380');
    expect(await ids('삼전')).toContain('KR:005930');
  });

  it('법인격 표기를 넘어 찾는다 — DART 는 "주식회사 네이버" 로 저장한다', async () => {
    expect((await ids('네이버'))[0]).toBe('KR:035420');
  });

  it('종목명이 영문이어도 한글 법인명으로 찾을 수 있다', async () => {
    // stock_name 은 'NAVER' 지만 corp_name 은 '주식회사 네이버'
    expect((await ids('naver'))[0]).toBe('KR:035420');
    expect((await ids('네이버'))[0]).toBe('KR:035420');
  });

  it('짧은 이름이 먼저 온다 — "카카오"가 "카카오뱅크"보다 위', async () => {
    const result = await ids('카카오');
    expect(result[0]).toBe('KR:035720'); // 카카오
    expect(result).toContain('KR:323410'); // 카카오뱅크도 나오되 뒤
    expect(result.indexOf('KR:035720')).toBeLessThan(result.indexOf('KR:323410'));
  });

  it('KOSPI 가 KOSDAQ 보다 위로 온다', async () => {
    const results = await searchCompanies(handle.db, '주식회사');
    const markets = results.map((r) => r.market);
    const firstKosdaq = markets.indexOf('KOSDAQ');
    const lastKospi = markets.lastIndexOf('KOSPI');
    if (firstKosdaq !== -1 && lastKospi !== -1) {
      expect(lastKospi).toBeLessThan(firstKosdaq);
    }
  });

  it('SK하이닉스는 영문·한글·초성 모두로 찾힌다', async () => {
    expect(await ids('SK하이닉스')).toContain('KR:000660');
    expect(await ids('하이닉스')).toContain('KR:000660');
    expect(await ids('hynix')).toContain('KR:000660');
  });

  it('없는 검색어는 빈 배열', async () => {
    expect(await ids('존재하지않는회사이름')).toEqual([]);
  });

  it('빈 검색어는 DB 를 건드리지 않고 빈 배열', async () => {
    expect(await ids('')).toEqual([]);
    expect(await ids('   ')).toEqual([]);
  });

  it('limit 을 지킨다', async () => {
    expect((await ids('주식회사', 2)).length).toBeLessThanOrEqual(2);
  });

  it('LIKE 와일드카드를 이스케이프한다 — 검색어 % 가 전체 매칭이 되면 안 된다', async () => {
    expect(await ids('%')).toEqual([]);
    expect(await ids('_')).toEqual([]);
  });

  it('결과에 결산월과 매칭 방식이 담긴다', async () => {
    const [first] = await searchCompanies(handle.db, '삼성전자');
    expect(first?.fiscalYearEndMonth).toBe(12);
    expect(first?.matchedOn).toBe('EXACT');
    expect(first?.market).toBe('KOSPI');
  });
});

describe('buildCompanyRow', () => {
  it('코넥스(N)와 상장폐지(E)는 제외한다', () => {
    const konex = seedEntry('1', '111111', 'A', 'A', 'A', 'N');
    const delisted = seedEntry('2', '222222', 'B', 'B', 'B', 'E');

    expect(buildCompanyRow(konex.entry, konex.detail)).toBeNull();
    expect(buildCompanyRow(delisted.entry, delisted.detail)).toBeNull();
  });

  it('종목코드가 없으면 제외한다', () => {
    const f = seedEntry('3', '333333', 'C', 'C', 'C', 'Y');
    expect(buildCompanyRow({ ...f.entry, stockCode: null }, f.detail)).toBeNull();
  });

  it('결산월을 반영한다', () => {
    const march = seedEntry('4', '444444', 'D', 'D', 'D', 'Y', '3');
    expect(buildCompanyRow(march.entry, march.detail)?.fiscalYearEndMonth).toBe(3);
  });

  it('종목명을 우선 쓴다 — corp_name 은 법인격이 붙는다', () => {
    const f = FIXTURES[0]!;
    expect(buildCompanyRow(f.entry, f.detail)?.nameKo).toBe('삼성전자');
  });
});

describe('buildAliasRows', () => {
  it('종목명·법인명·영문명·종목코드를 모두 별칭으로 만든다', () => {
    const f = FIXTURES[0]!;
    const row = buildCompanyRow(f.entry, f.detail)!;
    const aliases = buildAliasRows(row, f.corpName).map((a) => a.alias);

    expect(aliases).toContain('삼성전자');
    expect(aliases).toContain('samsungelectronics');
    expect(aliases).toContain('005930');
  });

  it('통용 별칭을 붙인다 — DART 공식명과 사람들이 치는 이름이 다르다', () => {
    const f = FIXTURES[0]!;
    const row = buildCompanyRow(f.entry, f.detail)!;
    const aliases = buildAliasRows(row, f.corpName);

    const samjeon = aliases.find((a) => a.alias === '삼전');
    expect(samjeon?.aliasType).toBe('KO_COMMON');
  });

  it('현대자동차에 "현대차" 별칭이 붙어 초성 검색이 통한다', () => {
    const f = FIXTURES[2]!; // 현대자동차
    const row = buildCompanyRow(f.entry, f.detail)!;
    const aliases = buildAliasRows(row, f.corpName);

    const nickname = aliases.find((a) => a.alias === '현대차');
    expect(nickname).toBeDefined();
    // '현대자동차' 초성은 ㅎㄷㅈㄷㅊ 라서 ㅎㄷㅊ 로는 안 잡힌다
    expect(nickname?.chosung).toBe('ㅎㄷㅊ');
    expect(aliases.find((a) => a.alias === '현대자동차')?.chosung).toBe('ㅎㄷㅈㄷㅊ');
  });

  it('유명주에 prominence 가 붙는다', () => {
    const samsung = buildCompanyRow(FIXTURES[0]!.entry, FIXTURES[0]!.detail)!;
    const nc = buildCompanyRow(FIXTURES[6]!.entry, FIXTURES[6]!.detail)!;

    expect(samsung.prominence).toBeGreaterThan(0);
    expect(nc.prominence).toBeGreaterThan(0); // 엔씨소프트도 목록에 있다
  });

  it('한글 별칭에만 초성을 붙인다', () => {
    const f = FIXTURES[0]!;
    const row = buildCompanyRow(f.entry, f.detail)!;
    const aliases = buildAliasRows(row, f.corpName);

    expect(aliases.find((a) => a.alias === '삼성전자')?.chosung).toBe('ㅅㅅㅈㅈ');
    expect(aliases.find((a) => a.alias === '005930')?.chosung).toBeNull();
  });

  it('정규화 후 중복된 별칭은 하나로 합친다', () => {
    // 종목명 '삼성전자' 와 법인명 '삼성전자(주)' 는 정규화하면 같아진다
    const f = FIXTURES[0]!;
    const row = buildCompanyRow(f.entry, f.detail)!;
    const aliases = buildAliasRows(row, f.corpName);

    expect(aliases.filter((a) => a.alias === '삼성전자')).toHaveLength(1);
  });
});
