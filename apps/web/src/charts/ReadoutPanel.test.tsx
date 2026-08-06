import { cleanup, render, screen, within } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { SeriesCompany, SeriesMetric } from '../lib/api.js';
import { HoverSyncProvider, useHoverSync } from './hoverSync.js';
import { ReadoutPanel } from './ReadoutPanel.js';

afterEach(cleanup);

const COMPANIES: SeriesCompany[] = [
  {
    id: 'KR:005930',
    country: 'KR',
    nameKo: '삼성전자',
    nameEn: 'SAMSUNG',
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
    nameEn: 'NVIDIA',
    market: 'NASDAQ',
    ticker: 'NVDA',
    color: '#D55E00',
    dash: '8 4',
    fiscalYearEndMonth: 1,
    badges: ['1월 결산'],
  },
];

const PERIODS = ['2022', '2023', '2024'];

const METRICS: SeriesMetric[] = [
  {
    metricId: 'operatingIncome',
    label: '영업이익',
    unit: '통화',
    formula: '공시 영업이익',
    basis: 'K-IFRS 연결',
    data: {
      'KR:005930': [43_376_630_000_000, 6_566_976_000_000, 32_725_500_000_000],
      // 중간 결측 — 0 으로 채우면 안 된다
      'US:NVDA': [null, 32_972_000_000, null],
    },
  },
  {
    metricId: 'operatingMargin',
    label: '영업이익률',
    unit: '%',
    formula: '영업이익 / 매출액',
    basis: 'K-IFRS 연결',
    data: {
      'KR:005930': [0.1435, 0.0254, 0.1088],
      'US:NVDA': [null, 0.5432, null],
    },
  },
];

/** 테스트에서 호버 시점을 직접 조작한다 */
function SetPeriod({ period }: { period: string | null }): null {
  const { setActivePeriod } = useHoverSync();
  useEffect(() => setActivePeriod(period), [period, setActivePeriod]);
  return null;
}

function renderPanel(activePeriod?: string): void {
  render(
    <HoverSyncProvider>
      {activePeriod !== undefined && <SetPeriod period={activePeriod} />}
      <ReadoutPanel companies={COMPANIES} metrics={METRICS} periods={PERIODS} />
    </HoverSyncProvider>,
  );
}

const rowFor = (name: string): HTMLElement => screen.getByRole('row', { name: new RegExp(name) });

describe('ReadoutPanel — 기본 상태', () => {
  it('호버 전에는 마지막 시점을 보여준다', () => {
    renderPanel();
    expect(screen.getByText('2024년')).toBeDefined();
  });

  it('호버 전에는 안내 문구를 띄운다', () => {
    renderPanel();
    expect(screen.getByText(/마우스를 올리면/)).toBeDefined();
  });

  it('전 기업 · 전 지표를 한 표에 담는다', () => {
    renderPanel();
    expect(screen.getByRole('columnheader', { name: '영업이익' })).toBeDefined();
    expect(screen.getByRole('columnheader', { name: '영업이익률' })).toBeDefined();
    expect(rowFor('삼성전자')).toBeDefined();
    expect(rowFor('엔비디아')).toBeDefined();
  });
});

describe('ReadoutPanel — 호버 시점 반영', () => {
  it('호버한 시점의 값으로 바뀐다', () => {
    renderPanel('2023');

    expect(screen.getByText('2023년')).toBeDefined();
    // 2023년 삼성전자 영업이익 6.57조
    expect(within(rowFor('삼성전자')).getByText('6.6조')).toBeDefined();
    expect(within(rowFor('삼성전자')).getByText('2.5%')).toBeDefined();
  });

  it('시점을 바꾸면 다른 값이 나온다', () => {
    renderPanel('2022');
    expect(within(rowFor('삼성전자')).getByText('43.4조')).toBeDefined();
    // 0.1435 -> 14.3%. toFixed 는 부동소수 표현 때문에 14.35 를 내림한다
    expect(within(rowFor('삼성전자')).getByText('14.3%')).toBeDefined();
  });

  it('결산월 배지를 함께 보여준다 — 왜 그 자리에 정렬됐는지 알 수 있어야 한다', () => {
    renderPanel('2023');
    expect(within(rowFor('엔비디아')).getByText('1월 결산')).toBeDefined();
  });
});

describe('ReadoutPanel — 결측 표시', () => {
  it('값이 없는 구간은 "데이터 없음"으로 구분한다', () => {
    renderPanel('2022');

    const nvidia = rowFor('엔비디아');
    // 0 이나 빈칸이 아니라 명시적으로 없다고 말해야 한다
    expect(within(nvidia).getAllByText('데이터 없음')).toHaveLength(2);
    expect(within(nvidia).queryByText('0')).toBeNull();
  });

  it('값이 있는 시점에서는 결측 표시가 사라진다', () => {
    renderPanel('2023');

    const nvidia = rowFor('엔비디아');
    expect(within(nvidia).queryByText('데이터 없음')).toBeNull();
    expect(within(nvidia).getByText('54.3%')).toBeDefined();
  });
});

describe('ReadoutPanel — 접근성', () => {
  it('값 변화를 스크린리더에 알린다', () => {
    renderPanel('2023');
    const live = document.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
  });

  it('기업명이 행 헤더다', () => {
    renderPanel();
    expect(screen.getByRole('rowheader', { name: /삼성전자/ })).toBeDefined();
  });
});
