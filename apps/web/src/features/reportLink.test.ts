import { describe, expect, it } from 'vitest';
import { periodToRange, reportSearchUrl } from './reportLink.js';

const iso = (d: Date): string => d.toISOString().slice(0, 10);

describe('periodToRange — 차트 시점을 검색 기간으로', () => {
  it('연간은 그 해 전체 + 두 달', () => {
    // 리포트는 실적 발표 뒤에 나온다. 2024년을 논한 리포트가 2025년 초에
    // 나오므로 끝을 늘려 잡지 않으면 정작 그 실적 리포트가 빠진다.
    const r = periodToRange('2024', '삼성전자');
    expect(iso(r.from)).toBe('2024-01-01');
    expect(iso(r.to)).toBe('2025-02-28');
  });

  it('분기는 그 분기 + 두 달', () => {
    const q1 = periodToRange('2024Q1', '삼성전자');
    expect(iso(q1.from)).toBe('2024-01-01');
    // 1분기(1~3월) 실적 리포트는 5월까지 나온다
    expect(iso(q1.to)).toBe('2024-05-31');

    const q4 = periodToRange('2024Q4', '삼성전자');
    expect(iso(q4.from)).toBe('2024-10-01');
    expect(iso(q4.to)).toBe('2025-02-28');
  });

  it('알 수 없는 형식이면 최근 1년으로 떨어진다', () => {
    // 링크가 깨지느니 넓게 잡는 편이 낫다
    const r = periodToRange('이상한값', '삼성전자');
    expect(r.to.getTime()).toBeGreaterThan(r.from.getTime());
  });
});

describe('reportSearchUrl — 실제로 결과가 나오는 형태여야 한다', () => {
  const url = reportSearchUrl(periodToRange('2024', '삼성전자'));
  const params = new URL(url).searchParams;

  it('search_text 로 검색어를 넘긴다', () => {
    // search_value 는 걸어도 안 먹고, 둘을 같이 넘기면 결과가 비어 버린다
    expect(params.get('search_text')).toBe('삼성전자');
    expect(params.get('search_value')).toBeNull();
  });

  it('날짜를 반드시 넘긴다', () => {
    // 안 주면 한경이 최근 7일로 잡아 "결과가 없습니다" 가 뜬다
    expect(params.get('sdate')).toBe('2024-01-01');
    expect(params.get('edate')).toBe('2025-02-28');
  });

  it('종목 리포트로 좁힌다', () => {
    expect(params.get('report_type')).toBe('CO');
  });
});
