import {
  ABSOLUTE_EARLIEST_YEAR,
  MAX_COMPANIES,
  MAX_METRICS,
  MetricIdSchema,
  type MetricId,
} from '@fincompare/shared';
import { useCallback, useEffect, useState } from 'react';

/**
 * 선택 상태를 URL 쿼리에 담는다.
 *
 * 할아버지가 보시던 화면을 그대로 북마크하거나 링크로 보낼 수 있어야 한다.
 * 새로고침해도 선택이 유지되는 게 우선이고, 공유는 그 부산물이다.
 */

export type DisplayCurrency = 'KRW' | 'USD' | 'native';

export interface AppState {
  companyIds: string[];
  metrics: MetricId[];
  fromYear: number;
  toYear: number;
  normalize: boolean;
  /** 표시 통화. native = 각 기업의 보고 통화 그대로 */
  currency: DisplayCurrency;
}

const CURRENT_YEAR = new Date().getFullYear();
const EARLIEST_YEAR = ABSOLUTE_EARLIEST_YEAR;

export const DEFAULT_STATE: AppState = {
  companyIds: [],
  // 할아버지가 요청하신 건 영업이익 비교였다. 그것을 기본으로 둔다.
  metrics: ['operatingIncome', 'operatingMargin'],
  fromYear: 2016,
  toYear: CURRENT_YEAR - 1,
  normalize: false,
  // 국내 기업만 볼 때는 환산이 불필요하다. 해외를 섞으면 화면에서 바꾸면 된다.
  currency: 'native',
};

function clampYear(value: number, fallback: number): number {
  if (!Number.isInteger(value) || value < EARLIEST_YEAR || value > CURRENT_YEAR) return fallback;
  return value;
}

function parseState(search: string): AppState {
  const params = new URLSearchParams(search);

  const companyIds = (params.get('c') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .slice(0, MAX_COMPANIES);

  const metrics = (params.get('m') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .map((s) => MetricIdSchema.safeParse(s))
    .filter((r): r is { success: true; data: MetricId } => r.success)
    .map((r) => r.data)
    .slice(0, MAX_METRICS);

  const from = clampYear(Number(params.get('from')), DEFAULT_STATE.fromYear);
  const to = clampYear(Number(params.get('to')), DEFAULT_STATE.toYear);

  return {
    companyIds,
    metrics: metrics.length > 0 ? metrics : DEFAULT_STATE.metrics,
    fromYear: Math.min(from, to),
    toYear: Math.max(from, to),
    normalize: params.get('n') === '1',
    currency: parseCurrency(params.get('cur')),
  };
}

function parseCurrency(raw: string | null): DisplayCurrency {
  return raw === 'KRW' || raw === 'USD' ? raw : 'native';
}

function toSearch(state: AppState): string {
  const params = new URLSearchParams();
  if (state.companyIds.length > 0) params.set('c', state.companyIds.join(','));
  params.set('m', state.metrics.join(','));
  params.set('from', String(state.fromYear));
  params.set('to', String(state.toYear));
  if (state.normalize) params.set('n', '1');
  if (state.currency !== 'native') params.set('cur', state.currency);
  return params.toString();
}

export function useUrlState(): [AppState, (updater: Partial<AppState>) => void] {
  const [state, setState] = useState<AppState>(() => parseState(window.location.search));

  // 뒤로가기로 이전 비교 화면으로 돌아갈 수 있어야 한다
  useEffect(() => {
    const onPopState = (): void => setState(parseState(window.location.search));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const update = useCallback((patch: Partial<AppState>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      const search = toSearch(next);
      // replaceState 를 쓰면 히스토리가 안 쌓여 뒤로가기가 앱을 벗어난다.
      // 선택 변경마다 pushState 하면 히스토리가 지저분해지므로 replace 로 둔다.
      window.history.replaceState(null, '', `${window.location.pathname}?${search}`);
      return next;
    });
  }, []);

  return [state, update];
}

export function shareUrl(state: AppState): string {
  return `${window.location.origin}${window.location.pathname}?${toSearch(state)}`;
}
