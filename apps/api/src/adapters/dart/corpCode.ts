import { XMLParser } from 'fast-xml-parser';
import { unzipSync } from 'fflate';

/**
 * corpCode.xml — DART 기업 고유번호 마스터
 *
 * zip 으로 받아서 푼다. 압축 3.6MB / 해제 30MB / 118,664개 항목이고
 * 그중 종목코드가 있는 건 3,981개다.
 *
 * 주의: 종목코드가 있다고 현재 상장사인 건 아니다. 상장폐지된 회사도 종목코드가 남아 있다.
 * 현재 상장 여부와 시장 구분은 company.json 의 corp_cls 로만 알 수 있다.
 */

export interface CorpCodeEntry {
  corpCode: string;
  corpName: string;
  corpNameEng: string | null;
  /** 6자리 종목코드. 비상장이면 null */
  stockCode: string | null;
  modifyDate: string | null;
}

interface RawCorpCodeItem {
  corp_code?: string | number;
  corp_name?: string | number;
  corp_eng_name?: string | number;
  stock_code?: string | number;
  modify_date?: string | number;
}

/** 항상 문자열로 만든다. 종목코드 '005930' 이 숫자 5930 이 되면 안 된다 */
function str(value: string | number | undefined): string {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

/** 종목코드는 정확히 숫자 6자리여야 한다. 공백 한 칸(' ')이 비상장 표시로 온다 */
function normalizeStockCode(raw: string | number | undefined): string | null {
  const s = str(raw);
  return /^\d{6}$/.test(s) ? s : null;
}

export function parseCorpCodeXml(xml: string): CorpCodeEntry[] {
  const parser = new XMLParser({
    ignoreAttributes: true,
    // 종목코드·고유번호는 앞자리 0 이 의미를 가진다. 숫자로 바꾸면 망가진다.
    parseTagValue: false,
    trimValues: true,
  });

  const parsed = parser.parse(xml) as { result?: { list?: RawCorpCodeItem | RawCorpCodeItem[] } };
  const list = parsed.result?.list;
  if (list === undefined) return [];

  const items = Array.isArray(list) ? list : [list];

  return items
    .map((item): CorpCodeEntry | null => {
      const corpCode = str(item.corp_code);
      const corpName = str(item.corp_name);
      if (corpCode === '' || corpName === '') return null;

      const corpNameEng = str(item.corp_eng_name);
      const modifyDate = str(item.modify_date);

      return {
        corpCode,
        corpName,
        corpNameEng: corpNameEng === '' ? null : corpNameEng,
        stockCode: normalizeStockCode(item.stock_code),
        modifyDate: modifyDate === '' ? null : modifyDate,
      };
    })
    .filter((e): e is CorpCodeEntry => e !== null);
}

/** DART 가 주는 zip 에서 CORPCODE.xml 을 꺼낸다 */
export function extractCorpCodeXml(zipBytes: Uint8Array): string {
  const files = unzipSync(zipBytes);
  const name = Object.keys(files).find((f) => f.toUpperCase().endsWith('CORPCODE.XML'));

  if (name === undefined) {
    throw new Error(
      `zip 안에 CORPCODE.xml 이 없습니다. 들어있는 파일: ${Object.keys(files).join(', ')}`,
    );
  }

  const bytes = files[name];
  if (bytes === undefined) throw new Error(`zip 항목을 읽을 수 없습니다: ${name}`);

  return new TextDecoder('utf-8').decode(bytes);
}

/** 상장사만 (종목코드 보유). 현재 상장 여부는 company.json 으로 다시 걸러야 한다 */
export function listedOnly(entries: readonly CorpCodeEntry[]): CorpCodeEntry[] {
  return entries.filter((e) => e.stockCode !== null);
}
