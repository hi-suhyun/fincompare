import { describe, expect, it } from 'vitest';
import { parseNaverSiseJson } from './naver.js';
import { pickCloses, type PricePoint } from './types.js';

/** 네이버 실제 응답 형태. JSON 이 아니라 JS 배열 리터럴이고 작은따옴표를 쓴다 */
const RAW = `
 [['날짜', '시가', '고가', '저가', '종가', '거래량', '외국인소진율'],

	["20240102", 78200, 79800, 78200, 79600, 17142847, 54.05],
		["20240103", 78500, 78800, 77000, 77000, 21753644, 54.04],
		["20240104", 76100, 77300, 76100, 76600, 15324439, 54.05]]
`;

describe('parseNaverSiseJson', () => {
  it('종가를 뽑는다', () => {
    const rows = parseNaverSiseJson(RAW);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ date: '2024-01-02', close: 79_600, currency: 'KRW' });
  });

  it('헤더 행을 데이터로 착각하지 않는다', () => {
    const rows = parseNaverSiseJson(RAW);
    expect(rows.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date))).toBe(true);
  });

  it('YYYYMMDD 를 ISO 로 바꾼다', () => {
    expect(parseNaverSiseJson(RAW)[2]?.date).toBe('2024-01-04');
  });

  it('빈 응답도 터지지 않는다', () => {
    expect(parseNaverSiseJson('')).toEqual([]);
    expect(parseNaverSiseJson("[['날짜','시가','고가','저가','종가']]")).toEqual([]);
  });

  it('eval 없이 파싱한다 — 외부 문자열을 실행하지 않는다', () => {
    // 실행됐다면 전역이 오염된다
    const malicious = `[["20240102", 1, 2, 3, 100, 5]] ; globalThis.__pwned = true;`;
    const rows = parseNaverSiseJson(malicious);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.close).toBe(100);
    expect((globalThis as Record<string, unknown>)['__pwned']).toBeUndefined();
  });
});

describe('pickCloses — 휴장일 처리', () => {
  const series: PricePoint[] = [
    { date: '2024-12-26', close: 100, currency: 'KRW' },
    { date: '2024-12-27', close: 110, currency: 'KRW' },
    { date: '2024-12-30', close: 120, currency: 'KRW' },
    // 12/31 은 휴장
  ];

  it('그날 거래가 있으면 그 종가', () => {
    expect(pickCloses(series, ['2024-12-27'])[0]?.close).toBe(110);
  });

  it('휴장일은 직전 거래일 종가를 쓴다', () => {
    const picked = pickCloses(series, ['2024-12-31']);
    expect(picked[0]?.close).toBe(120);
    // 요청한 날짜로 라벨링한다 — 기말 시점 값이라는 의미가 유지돼야 한다
    expect(picked[0]?.date).toBe('2024-12-31');
  });

  it('뒤 날짜를 끌어오지 않는다 — 아직 형성되지 않은 가격이다', () => {
    expect(pickCloses(series, ['2024-12-01'])).toEqual([]);
  });

  it('여러 날짜를 한 번에 고른다', () => {
    const picked = pickCloses(series, ['2024-12-27', '2024-12-31']);
    expect(picked.map((p) => p.close)).toEqual([110, 120]);
  });

  it('입력 순서가 뒤섞여도 정렬해서 처리한다', () => {
    const shuffled = [...series].reverse();
    expect(pickCloses(shuffled, ['2024-12-31'])[0]?.close).toBe(120);
  });
});
