import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HoverTooltip } from './HoverTooltip.js';
import { HoverSyncProvider, useHoverSync } from './hoverSync.js';
import type { SeriesCompany, SeriesMetric } from '../lib/api.js';

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
    dash: '6 3',
    fiscalYearEndMonth: 1,
    badges: [],
  },
];

const METRICS: SeriesMetric[] = [
  {
    metricId: 'operatingIncome',
    label: '영업이익',
    unit: '통화',
    formula: '공시 영업이익',
    basis: '연결',
    data: { 'KR:005930': [36_000_000_000_000, null], 'US:NVDA': [null, 5_000_000_000] },
  },
];

const PERIODS = ['2020', '2021'];

// 렌더가 쌓이면 role=dialog 가 여러 개가 되어 조회가 깨진다
afterEach(cleanup);

/** 테스트에서 호버 상태를 직접 세팅한다 */
function SetHover({ period }: { period: string | null }): null {
  const { setActivePeriod, setPoint } = useHoverSync();
  useEffect(() => {
    setActivePeriod(period);
    setPoint(period === null ? null : { x: 100, y: 100 });
  }, [period, setActivePeriod, setPoint]);
  return null;
}

function renderTooltip(period: string | null) {
  return render(
    <HoverSyncProvider>
      <SetHover period={period} />
      <HoverTooltip
        companies={COMPANIES}
        metrics={METRICS}
        periods={PERIODS}
        currency="KRW"
      />
    </HoverSyncProvider>,
  );
}

describe('HoverTooltip — 표시', () => {
  it('호버 중이 아니면 아무것도 그리지 않는다', () => {
    renderTooltip(null);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('그 시점의 값과 연도를 보여준다', () => {
    renderTooltip('2020');
    const tip = screen.getByRole('dialog');
    expect(tip.textContent).toContain('2020년');
    expect(tip.textContent).toContain('36.0조');
  });

  it('값이 없으면 0 이 아니라 "데이터 없음"', () => {
    renderTooltip('2021');
    expect(screen.getByRole('dialog').textContent).toContain('데이터 없음');
  });

  it('분기에는 "년" 을 붙이지 않는다', () => {
    render(
      <HoverSyncProvider>
        <SetHover period="2024Q1" />
        <HoverTooltip
          companies={COMPANIES}
          metrics={METRICS}
          periods={['2024Q1']}
          currency="KRW"
        />
      </HoverSyncProvider>,
    );
    const tip = screen.getByRole('dialog');
    expect(tip.textContent).toContain('2024Q1');
    expect(tip.textContent).not.toContain('2024Q1년');
  });
});

describe('HoverTooltip — 리포트 링크', () => {
  it('국내 기업만 링크를 준다', () => {
    renderTooltip('2020');
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]?.textContent).toContain('삼성전자');
  });

  it('링크가 그 시점 구간으로 좁혀진다', () => {
    // 시점이 아니라 전체 기간으로 가면 "그때의 리포트" 가 아니다
    renderTooltip('2020');
    const href = screen.getByRole('link').getAttribute('href') ?? '';
    const params = new URL(href).searchParams;
    expect(params.get('sdate')).toBe('2020-01-01');
    expect(params.get('search_text')).toBe('삼성전자');
  });

  it('새 탭으로 열고 원본 정보를 넘기지 않는다', () => {
    renderTooltip('2020');
    const link = screen.getByRole('link');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });
});

describe('HoverTooltip — 마우스를 옮겨도 사라지지 않아야 한다', () => {
  it('툴팁에 들어오면 지우기 예약이 취소된다', () => {
    // 이게 이 컴포넌트의 존재 이유다. 링크로 마우스를 옮기는 순간 사라지면
    // 누르려던 그 해의 리포트로 갈 수 없다.
    vi.useFakeTimers();

    function Harness(): React.ReactElement {
      const { scheduleClear } = useHoverSync();
      return (
        <>
          <button type="button" onClick={scheduleClear}>
            차트를 벗어남
          </button>
          <HoverTooltip
            companies={COMPANIES}
            metrics={METRICS}
            periods={PERIODS}
            currency="KRW"
          />
        </>
      );
    }

    render(
      <HoverSyncProvider>
        <SetHover period="2020" />
        <Harness />
      </HoverSyncProvider>,
    );

    const tip = screen.getByRole('dialog');

    // 차트를 벗어나 지우기가 예약된 상태에서 툴팁으로 마우스가 넘어온다
    fireEvent.click(screen.getByRole('button'));
    fireEvent.mouseEnter(tip);
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.queryByRole('dialog')).not.toBeNull();
    vi.useRealTimers();
  });

  it('툴팁도 벗어나면 사라진다', () => {
    vi.useFakeTimers();

    render(
      <HoverSyncProvider>
        <SetHover period="2020" />
        <HoverTooltip
          companies={COMPANIES}
          metrics={METRICS}
          periods={PERIODS}
          currency="KRW"
        />
      </HoverSyncProvider>,
    );

    fireEvent.mouseLeave(screen.getByRole('dialog'));
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    // 계속 떠 있으면 차트를 가린다
    expect(screen.queryByRole('dialog')).toBeNull();
    vi.useRealTimers();
  });
});
