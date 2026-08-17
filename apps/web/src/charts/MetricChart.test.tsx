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

  it('띠를 전 구간이 아니라 마지막 몇 해에만 건다', () => {
    /*
     * 목표주가는 오늘 하나뿐이다. 2016년 자리까지 덮으면 "그때도 이렇게 봤다"
     * 로 읽히는데 그건 거짓이다.
     */
    const long = { ...PRICE_METRIC, data: { 'KR:005930': [1, 2, 3, 4, 5, 334000] } } as SeriesMetric;
    const { container } = render(
      <HoverSyncProvider>
        <MetricChart
          metric={long}
          companies={[SAMSUNG]}
          periods={['2021', '2022', '2023', '2024', '2025', '2026']}
          height={300}
          showXAxisLabels
          logScale={false}
          currency="KRW"
          consensus={[RESEARCH]}
        />
      </HoverSyncProvider>,
    );

    const band = container.querySelector('[class*=reference-area-rect]');
    expect(band).not.toBeNull();

    // 마지막 3개 구간(2024~2026)에만 걸려야 한다
    expect(band?.getAttribute('x1')).toBe('2024');
    expect(band?.getAttribute('x2')).toBe('2026');

    // 그림 영역 전체를 덮으면 안 된다
    const gridLine = container.querySelector('[class*=cartesian-grid] line');
    const bandWidth = Number(band?.getAttribute('width') ?? 0);
    const plotWidth = Number(gridLine?.getAttribute('width') ?? 0);
    expect(bandWidth).toBeGreaterThan(0);
    expect(bandWidth).toBeLessThan(plotWidth);
  });
});

describe('AnalystTargetPanel — 증권사별 목표주가', () => {
  it('평균선 위에 올리면 증권사별로 펼친다', async () => {
    const container = draw(PRICE_METRIC, [RESEARCH]);
    const hit = container.querySelector('rect[fill=transparent]');
    expect(hit).not.toBeNull();

    fireEvent.mouseEnter(hit as Element);
    expect(await screen.findByText('한국투자증권')).toBeTruthy();
    expect(screen.getByText('DB증권')).toBeTruthy();
  });

  it('상향·하향을 직전 목표가와 함께 보여준다', async () => {
    const container = draw(PRICE_METRIC, [RESEARCH]);
    fireEvent.mouseEnter(container.querySelector('rect[fill=transparent]') as Element);
    // 한국투자 380만 -> 470만 상향
    expect(await screen.findByText(/▲/)).toBeTruthy();
    // 미래에셋 420만 -> 280만 하향
    expect(screen.getByText(/▼/)).toBeTruthy();
  });

  it('전체 집계가 아니라는 것을 밝힌다', async () => {
    // 조사한 것만 실리므로 평균·개수가 안 맞을 수 있다. 그걸 오류로 읽으면 곤란하다.
    const container = draw(PRICE_METRIC, [RESEARCH]);
    fireEvent.mouseEnter(container.querySelector('rect[fill=transparent]') as Element);
    expect(await screen.findByText(/전체 집계가 아니라서/)).toBeTruthy();
  });
});
