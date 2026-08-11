import { describe, expect, it } from 'vitest';
import type { SeriesResponse } from '../../lib/api.js';
import { buildCsv, buildFileName } from './csv.js';

const DATA: SeriesResponse = {
  companies: [
    {
      id: 'KR:005930',
      country: 'KR',
      nameKo: '삼성전자',
      nameEn: 'SAMSUNG ELECTRONICS',
      market: 'KOSPI',
      ticker: '005930',
      color: '#0072B2',
      dash: null,
      fiscalYearEndMonth: 12,
      badges: [],
    },
    {
      id: 'US:NVDA',
      country: 'US',
      nameKo: '엔비디아',
      nameEn: 'NVIDIA CORP',
      market: 'NASDAQ',
      ticker: 'NVDA',
      color: '#D55E00',
      dash: '8 4',
      fiscalYearEndMonth: 1,
      badges: ['1월 결산'],
    },
  ],
  periods: ['2023', '2024'],
  displayCurrency: 'native',
  series: [
    {
      metricId: 'operatingIncome',
      label: '영업이익',
      unit: '통화',
      formula: '공시 영업이익',
      basis: 'K-IFRS 연결',
      data: {
        'KR:005930': [6_566_976_000_000, 32_725_500_000_000],
        'US:NVDA': [32_972_000_000, null],
      },
    },
    {
      metricId: 'operatingMargin',
      label: '영업이익률',
      unit: '%',
      formula: '영업이익 / 매출액',
      basis: 'K-IFRS 연결',
      data: {
        'KR:005930': [0.02536, 0.1088],
        'US:NVDA': [0.5412, null],
      },
    },
  ],
  provenance: {
    'KR:005930': { source: 'DART', consolidation: 'CFS (연결)', basis: '각 연도 사업보고서 공시값' },
    'US:NVDA': { source: 'SEC EDGAR', consolidation: 'CFS (연결)', basis: '각 연도 사업보고서 공시값' },
  },
  warnings: [],
  consensus: [],
};

const NOW = new Date('2026-08-06T00:00:00Z');

const bodyOf = (csv: string): string[] => {
  const lines = csv.replace(/^﻿/, '').split('\r\n');
  const headerIndex = lines.findIndex((l) => l.startsWith('기간,기업'));
  return lines.slice(headerIndex).filter((l) => l !== '');
};

describe('buildCsv — 엑셀 호환', () => {
  it('BOM 으로 시작한다 — 없으면 엑셀이 한글을 깬다', () => {
    expect(buildCsv(DATA, { now: NOW }).startsWith('﻿')).toBe(true);
  });

  it('줄바꿈은 CRLF', () => {
    const csv = buildCsv(DATA, { now: NOW });
    expect(csv).toContain('\r\n');
    expect(csv.endsWith('\r\n')).toBe(true);
  });
});

describe('buildCsv — 표 구조', () => {
  it('한 행이 (기간 × 기업) 하나다', () => {
    const rows = bodyOf(buildCsv(DATA, { now: NOW }));

    // 헤더 1 + 기간 2 × 기업 2 = 5
    expect(rows).toHaveLength(5);
    expect(rows[1]).toContain('2023,삼성전자,005930,KOSPI,12월');
    expect(rows[2]).toContain('2023,엔비디아,NVDA,NASDAQ,1월');
    expect(rows[3]).toContain('2024,삼성전자');
  });

  it('지표가 열이 되고 단위를 이름에 적는다', () => {
    const [header] = bodyOf(buildCsv(DATA, { now: NOW }));
    expect(header).toBe('기간,기업,종목코드,시장,결산월,영업이익(보고통화),영업이익률(%)');
  });

  it('통화 열 이름이 표시 통화를 따라간다', () => {
    const krw = bodyOf(buildCsv({ ...DATA, displayCurrency: 'KRW' }, { now: NOW }))[0];
    expect(krw).toContain('영업이익(원)');

    const usd = bodyOf(buildCsv({ ...DATA, displayCurrency: 'USD' }, { now: NOW }))[0];
    expect(usd).toContain('영업이익(달러)');
  });
});

describe('buildCsv — 값 표기', () => {
  it('서식 없는 순수 숫자를 쓴다 — "6.6조" 로 적으면 엑셀이 문자열로 읽는다', () => {
    const rows = bodyOf(buildCsv(DATA, { now: NOW }));
    expect(rows[1]).toContain('6566976000000');
    expect(rows[1]).not.toContain('조');
  });

  it('비율은 %로 펼친다', () => {
    // 0.02536 -> 2.5360
    expect(bodyOf(buildCsv(DATA, { now: NOW }))[1]).toContain('2.5360');
  });

  it('결측은 빈 칸이다 — 0 으로 채우면 실제 0 과 구분되지 않는다', () => {
    const rows = bodyOf(buildCsv(DATA, { now: NOW }));
    const nvda2024 = rows.find((r) => r.startsWith('2024,엔비디아'));

    expect(nvda2024).toBe('2024,엔비디아,NVDA,NASDAQ,1월,,');
    expect(nvda2024).not.toContain(',0,');
  });
});

describe('buildCsv — 출처 표기', () => {
  it('상단에 출처와 계산식을 적는다', () => {
    const csv = buildCsv(DATA, { now: NOW });

    expect(csv).toContain('생성일,2026-08-06');
    expect(csv).toContain('출처,삼성전자,DART,CFS (연결)');
    expect(csv).toContain('출처,엔비디아,SEC EDGAR');
    expect(csv).toContain('계산식,영업이익률,영업이익 / 매출액');
  });

  it('표시 통화를 밝힌다', () => {
    expect(buildCsv(DATA, { now: NOW })).toContain('표시 통화,각 기업의 보고 통화');
    expect(buildCsv({ ...DATA, displayCurrency: 'KRW' }, { now: NOW })).toContain('표시 통화,KRW');
  });

  it('끄면 표만 나온다', () => {
    const csv = buildCsv(DATA, { includeMetadata: false, now: NOW });
    expect(csv).not.toContain('생성일');
    expect(csv.replace(/^﻿/, '').startsWith('기간,기업')).toBe(true);
  });
});

describe('buildCsv — 이스케이프', () => {
  it('쉼표가 든 이름을 따옴표로 감싼다', () => {
    const withComma = {
      ...DATA,
      companies: [{ ...DATA.companies[0]!, nameKo: '삼성전자, 우선주' }],
    };
    expect(buildCsv(withComma, { now: NOW })).toContain('"삼성전자, 우선주"');
  });

  it('따옴표는 두 번 쓴다 (RFC 4180)', () => {
    const withQuote = {
      ...DATA,
      companies: [{ ...DATA.companies[0]!, nameKo: '삼"성' }],
    };
    expect(buildCsv(withQuote, { now: NOW })).toContain('"삼""성"');
  });
});

describe('buildFileName', () => {
  it('기업명과 기간을 담는다', () => {
    expect(buildFileName(DATA, 'csv', NOW)).toBe(
      '재무지표비교_삼성전자-엔비디아_2023_2024_2026-08-06.csv',
    );
  });

  it('4개 이상이면 줄여 쓴다', () => {
    const many = {
      ...DATA,
      companies: [
        ...DATA.companies,
        { ...DATA.companies[0]!, id: 'a', nameKo: '카카오' },
        { ...DATA.companies[0]!, id: 'b', nameKo: '네이버' },
      ],
    };
    expect(buildFileName(many, 'png', NOW)).toContain('삼성전자-엔비디아-카카오-외1');
  });

  it('파일명에 못 쓰는 문자를 걸러낸다', () => {
    const risky = {
      ...DATA,
      companies: [{ ...DATA.companies[0]!, nameKo: 'A/B:C*D' }],
    };
    const name = buildFileName(risky, 'csv', NOW);
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
    expect(name).toContain('ABCD');
  });
});
