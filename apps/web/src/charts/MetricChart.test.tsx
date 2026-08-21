import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { cloneElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HoverSyncProvider } from './hoverSync.js';
import { MetricChart } from './MetricChart.js';
import type { CompanyConsensus, SeriesCompany, SeriesMetric } from '../lib/api.js';

/*
 * ResponsiveContainer 는 부모 폭을 ResizeObserver 로 재서 그린다. jsdom 에는
 * 레이아웃도 ResizeObserver 도 없어서 차트가 통째로 렌더되지 않는다.
 * 컨테이너를 걷어내고 차트에 크기를 직접 박아 넣어야 안을 볼 수 있다.
 */
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) =>
      cloneElement(children as React.ReactElement<{ width: number; height: number }>, {
        width: 800,
        height: 300,
      }),
  };
});

afterEach(cleanup);

const SAMSUNG: SeriesCompany = {
  id: 'KR:005930',
  nameKo: '삼성전자',
  ticker: '005930',
  country: 'KR',
  color: '#0072B2',
  dash: null,
} as SeriesCompany;

const PRICE_METRIC: SeriesMetric = {
  metricId: 'closePrice',
  label: '주가',
  unit: '통화',
  formula: '회계연도 기말 종가',
  basis: '',
  data: { 'KR:005930': [55000, 78000, 334000] },
} as SeriesMetric;

const RESEARCH: CompanyConsensus = {
  companyId: 'KR:005930',
  estimates: {},
  priceTarget: {
    high: 650000,
    avg: 493542,
    low: 300000,
    currency: 'KRW',
    analysts: [
      { firm: '한국투자증권', target: 4700000, date: '2026-07-30', previous: 3800000 },
      { firm: '미래에셋증권', target: 2800000, previous: 4200000 },
      { firm: 'DB증권', target: 2000000 },
    ],
  },
  source: '직접 조사',
  currency: 'KRW',
  asOf: '2026-08-17',
  sources: ['https://example.com/a'],
};

// 마지막 칸이 예측 자리다. ChartStack 이 실제로도 한 칸을 덧붙여 넘긴다.
const PERIODS = ['2024', '2025', '2026', '2027'];

function draw(
  metric: SeriesMetric,
  consensus: readonly CompanyConsensus[],
  currency: 'KRW' | 'USD' | 'mixed' = 'KRW',
): HTMLElement {
  const { container } = render(
    <HoverSyncProvider>
      <MetricChart
        metric={metric}
        companies={[SAMSUNG]}
        periods={PERIODS}
        height={300}
        showXAxisLabels
        logScale={false}
        currency={currency}
        consensus={consensus}
      />
    </HoverSyncProvider>,
  );
  return container;
}

describe('MetricChart — 목표주가 가닥', () => {
  it('실적과 예측 사이가 비어 있어도 선을 잇는다', () => {
    /*
     * 분기 축은 아직 안 지난 분기가 뒤에 비어 있다. 끊으면 점만 남고
     * 선이 사라져서 어디서 갈라졌는지 알 수 없다.
     */
    const gapped = {
      ...PRICE_METRIC,
      data: { 'KR:005930': [55000, 78000, 334000, null, null] },
    } as SeriesMetric;
    const { container } = render(
      <HoverSyncProvider>
        <MetricChart
          metric={gapped}
          companies={[SAMSUNG]}
          periods={['2024Q1', '2024Q2', '2024Q3', '2024Q4', '2025Q1']}
          height={300}
          showXAxisLabels
          logScale={false}
          currency="KRW"
          consensus={[RESEARCH]}
        />
      </HoverSyncProvider>,
    );

    // 가닥마다 곡선이 하나씩 있어야 한다 (실제 선 1 + 가닥 3)
    expect(container.querySelectorAll('[class*=recharts-line-curve]').length).toBe(4);
    // 점은 예측 자리에만
    expect(container.querySelectorAll('g[style*="cursor: pointer"] circle[r="4"]').length).toBe(3);
  });

  it('마지막 실제 지점에서 증권사별로 갈라진다', () => {
    const container = draw(PRICE_METRIC, [RESEARCH]);
    // 증권사 3곳 = 가닥 3개. 실제 주가 선까지 더해 4개가 된다.
    const lines = container.querySelectorAll('[class*=recharts-line-curve]');
    expect(lines.length).toBe(4);
  });

  it('예측 지점에만 점을 찍는다 — 시작점은 실제 선에 이미 있다', () => {
    const container = draw(PRICE_METRIC, [RESEARCH]);
    // 가닥 3개 × 눈에 보이는 점 1개
    const dots = container.querySelectorAll('g[style*="cursor: pointer"] circle[r="4"]');
    expect(dots.length).toBe(3);
  });

  it('목표가가 축 위로 잘리지 않게 축을 넓힌다', () => {
    /*
     * 실제 주가 최고가 334,000 인데 목표 상단이 470만이다.
     * 축이 그대로면 가닥이 화면 밖으로 나가 얼마나 위인지 못 읽는다.
     */
    const topTick = (el: HTMLElement): number => {
      const ys = [...el.querySelectorAll('[class*=yAxis] text')].map((t) =>
        Number((t.textContent ?? '').replace(/[^0-9.]/g, '')),
      );
      return Math.max(...ys);
    };

    const withTarget = topTick(draw(PRICE_METRIC, [RESEARCH]));
    cleanup();
    const without = topTick(draw(PRICE_METRIC, []));

    expect(withTarget).toBeGreaterThan(without);
  });

  it('주가가 아닌 지표에는 그리지 않는다', () => {
    const revenue = { ...PRICE_METRIC, metricId: 'revenue', label: '매출액' } as SeriesMetric;
    const container = draw(revenue, [RESEARCH]);
    expect(container.querySelectorAll('g[style*="cursor: pointer"] circle[r="4"]').length).toBe(0);
  });

  it('통화가 어긋나면 그리지 않는다 — 원화 목표주가를 달러 축에 얹을 수 없다', () => {
    const container = draw(PRICE_METRIC, [RESEARCH], 'USD');
    expect(container.querySelectorAll('g[style*="cursor: pointer"] circle[r="4"]').length).toBe(0);
  });

  it('증권사별 목표가가 없으면 집계로 세 가닥을 그린다', () => {
    // FMP 무료 구간은 집계만 준다. 안 그리면 미국 기업은 통째로 안 보인다.
    const noAnalysts = {
      ...RESEARCH,
      priceTarget: { high: 650000, avg: 493542, low: 300000, currency: 'KRW' },
    };
    const container = draw(PRICE_METRIC, [noAnalysts]);
    expect(container.querySelectorAll('g[style*="cursor: pointer"] circle[r="4"]').length).toBe(3);
  });

  it('목표주가가 아예 없으면 그리지 않는다', () => {
    const container = draw(PRICE_METRIC, [{ ...RESEARCH, priceTarget: null }]);
    expect(container.querySelectorAll('g[style*="cursor: pointer"] circle[r="4"]').length).toBe(0);
  });
});

describe('AnalystTargetPanel — 점에 올렸을 때', () => {
  it('어느 증권사가 낸 값인지 보여준다', async () => {
    const container = draw(PRICE_METRIC, [RESEARCH]);
    const dot = container.querySelector('g[style*="cursor: pointer"]');
    expect(dot).not.toBeNull();

    fireEvent.mouseEnter(dot as Element);
    // 가장 높은 값을 낸 곳이 첫 가닥이다
    expect(await screen.findByText('한국투자증권')).toBeTruthy();
  });

  it('상향·하향을 직전 목표가와 함께 보여준다', async () => {
    const container = draw(PRICE_METRIC, [RESEARCH]);
    fireEvent.mouseEnter(container.querySelector('g[style*="cursor: pointer"]') as Element);
    // 한국투자 380만 -> 470만 상향
    expect(await screen.findByText(/직전 .*에서 상향/)).toBeTruthy();
  });

  it('전체 집계가 아니라는 것을 밝힌다', async () => {
    // 조사한 것만 실리므로 평균·개수가 안 맞을 수 있다. 그걸 오류로 읽으면 곤란하다.
    const container = draw(PRICE_METRIC, [RESEARCH]);
    fireEvent.mouseEnter(container.querySelector('g[style*="cursor: pointer"]') as Element);
    expect(await screen.findByText(/전체 집계가 아니라/)).toBeTruthy();
  });
});
