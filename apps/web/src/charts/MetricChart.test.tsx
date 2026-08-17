import { cleanup, render } from '@testing-library/react';
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
  priceTarget: { high: 650000, avg: 493542, low: 300000, currency: 'KRW' },
  source: '직접 조사',
  currency: 'KRW',
  asOf: '2026-08-17',
  sources: ['https://example.com/a'],
};

const PERIODS = ['2024', '2025', '2026'];

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

describe('MetricChart — 목표주가 띠', () => {
  it('주가 차트에 가로 띠와 평균선을 눕힌다', () => {
    const container = draw(PRICE_METRIC, [RESEARCH]);
    expect(container.querySelectorAll('[class*=reference-area]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('[class*=reference-line]').length).toBeGreaterThan(0);
  });

  it('목표주가가 축 위로 잘리지 않게 축을 넓힌다', () => {
    /*
     * 실제 주가 최고가 334,000 인데 목표 상단이 650,000 이다.
     * 축이 그대로면 띠가 화면 밖으로 나가 "얼마나 위인지" 를 못 읽는다.
     *
     * 눈금 문자열은 단위가 붙어 오므로(34만 · 340,000) 절대값을 못 박지 않고
     * 목표주가가 없을 때와 견준다 — 넓어졌다는 사실만 확인하면 된다.
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

  it('주가가 아닌 지표에는 눕히지 않는다', () => {
    const revenue = { ...PRICE_METRIC, metricId: 'revenue', label: '매출액' } as SeriesMetric;
    const container = draw(revenue, [RESEARCH]);
    expect(container.querySelectorAll('[class*=reference-area]').length).toBe(0);
  });

  it('통화가 어긋나면 그리지 않는다 — 원화 목표주가를 달러 축에 얹을 수 없다', () => {
    const container = draw(PRICE_METRIC, [RESEARCH], 'USD');
    expect(container.querySelectorAll('[class*=reference-area]').length).toBe(0);
  });

  it('목표주가가 없으면 아무것도 눕히지 않는다', () => {
    const container = draw(PRICE_METRIC, [{ ...RESEARCH, priceTarget: null }]);
    expect(container.querySelectorAll('[class*=reference-area]').length).toBe(0);
  });
});
