import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { extractCorpCodeXml, listedOnly, parseCorpCodeXml } from './corpCode.js';

/** 실제 corpCode.xml 과 같은 구조. 비상장은 stock_code 가 공백 한 칸으로 온다 */
const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<result>
    <list>
        <corp_code>00126380</corp_code>
        <corp_name>삼성전자(주)</corp_name>
        <corp_eng_name>SAMSUNG ELECTRONICS CO,.LTD</corp_eng_name>
        <stock_code>005930</stock_code>
        <modify_date>20240401</modify_date>
    </list>
    <list>
        <corp_code>00434003</corp_code>
        <corp_name>다코</corp_name>
        <corp_eng_name>Daco corporation</corp_eng_name>
        <stock_code> </stock_code>
        <modify_date>20170630</modify_date>
    </list>
    <list>
        <corp_code>00430964</corp_code>
        <corp_name>굿앤엘에스</corp_name>
        <corp_eng_name>Good &amp; LS Co.,Ltd.</corp_eng_name>
        <stock_code> </stock_code>
        <modify_date>20170630</modify_date>
    </list>
    <list>
        <corp_code>00164742</corp_code>
        <corp_name>현대자동차(주)</corp_name>
        <corp_eng_name>HYUNDAI MOTOR COMPANY</corp_eng_name>
        <stock_code>005380</stock_code>
        <modify_date>20240401</modify_date>
    </list>
</result>`;

describe('parseCorpCodeXml', () => {
  it('항목을 전부 읽는다', () => {
    expect(parseCorpCodeXml(SAMPLE_XML)).toHaveLength(4);
  });

  it('종목코드의 앞자리 0 을 지키지 않으면 안 된다', () => {
    // 파서가 숫자로 바꾸면 '005930' 이 5930 이 되어 종목을 못 찾는다
    const samsung = parseCorpCodeXml(SAMPLE_XML).find((e) => e.corpCode === '00126380');
    expect(samsung?.stockCode).toBe('005930');
    expect(samsung?.corpCode).toBe('00126380');
  });

  it('비상장(공백 종목코드)은 null 로 만든다', () => {
    const daco = parseCorpCodeXml(SAMPLE_XML).find((e) => e.corpCode === '00434003');
    expect(daco?.stockCode).toBeNull();
  });

  it('XML 이스케이프를 푼다', () => {
    const good = parseCorpCodeXml(SAMPLE_XML).find((e) => e.corpCode === '00430964');
    expect(good?.corpNameEng).toBe('Good & LS Co.,Ltd.');
  });

  it('한글 회사명을 그대로 읽는다', () => {
    const hyundai = parseCorpCodeXml(SAMPLE_XML).find((e) => e.stockCode === '005380');
    expect(hyundai?.corpName).toBe('현대자동차(주)');
  });

  it('빈 결과도 터지지 않는다', () => {
    expect(parseCorpCodeXml('<?xml version="1.0"?><result></result>')).toEqual([]);
  });

  it('항목이 하나뿐일 때도 배열로 돌려준다', () => {
    const single = `<?xml version="1.0"?><result><list>
      <corp_code>00126380</corp_code><corp_name>삼성전자(주)</corp_name>
      <corp_eng_name>SAMSUNG</corp_eng_name><stock_code>005930</stock_code>
      <modify_date>20240401</modify_date></list></result>`;
    // fast-xml-parser 는 항목이 1개면 배열이 아니라 객체를 준다
    expect(parseCorpCodeXml(single)).toHaveLength(1);
  });

  it('6자리가 아닌 종목코드는 버린다', () => {
    const weird = `<?xml version="1.0"?><result><list>
      <corp_code>00000001</corp_code><corp_name>이상한회사</corp_name>
      <corp_eng_name>X</corp_eng_name><stock_code>12345</stock_code>
      <modify_date>20240401</modify_date></list></result>`;
    expect(parseCorpCodeXml(weird)[0]?.stockCode).toBeNull();
  });
});

describe('listedOnly', () => {
  it('종목코드가 있는 것만 남긴다', () => {
    const listed = listedOnly(parseCorpCodeXml(SAMPLE_XML));
    expect(listed.map((e) => e.stockCode)).toEqual(['005930', '005380']);
  });
});

describe('extractCorpCodeXml', () => {
  it('zip 에서 CORPCODE.xml 을 꺼낸다', () => {
    const zip = zipSync({ 'CORPCODE.xml': new TextEncoder().encode(SAMPLE_XML) });
    const xml = extractCorpCodeXml(zip);
    expect(parseCorpCodeXml(xml)).toHaveLength(4);
  });

  it('파일명 대소문자가 달라도 찾는다', () => {
    const zip = zipSync({ 'corpcode.xml': new TextEncoder().encode(SAMPLE_XML) });
    expect(parseCorpCodeXml(extractCorpCodeXml(zip))).toHaveLength(4);
  });

  it('없으면 들어있는 파일 목록과 함께 던진다', () => {
    const zip = zipSync({ 'other.txt': new TextEncoder().encode('x') });
    expect(() => extractCorpCodeXml(zip)).toThrow(/other\.txt/);
  });
});
