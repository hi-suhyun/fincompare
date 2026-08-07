import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useUrlState } from './useUrlState.js';

function setSearch(search: string): void {
  window.history.replaceState(null, '', `/${search}`);
}

beforeEach(() => setSearch(''));
afterEach(() => setSearch(''));

const currentSearch = (): URLSearchParams => new URLSearchParams(window.location.search);

describe('겹쳐 보기 ↔ 정규화 불변식', () => {
  /**
   * 단위가 다른 지표를 한 축에 겹치면 교차점이 축 설정에 따라 임의로 만들어져
   * 없는 상관관계가 보인다. 시작=100 으로 맞춰야만 겹치는 게 정당하다.
   * 이 조합이 어긋나면 차트가 조용히 거짓말을 하므로 상태 한 곳에서 강제한다.
   */
  it('겹쳐 보기를 켜면 정규화가 함께 켜진다', () => {
    const { result } = renderHook(() => useUrlState());

    expect(result.current[0].normalize).toBe(false);
    act(() => result.current[1]({ overlay: true }));

    expect(result.current[0].overlay).toBe(true);
    expect(result.current[0].normalize).toBe(true);
  });

  it('정규화를 끄면 겹쳐 보기도 꺼진다', () => {
    const { result } = renderHook(() => useUrlState());

    act(() => result.current[1]({ overlay: true }));
    act(() => result.current[1]({ normalize: false }));

    expect(result.current[0].normalize).toBe(false);
    expect(result.current[0].overlay).toBe(false);
  });

  it('정규화가 켜진 상태에서 겹쳐 보기만 끌 수 있다', () => {
    const { result } = renderHook(() => useUrlState());

    act(() => result.current[1]({ overlay: true }));
    act(() => result.current[1]({ overlay: false }));

    expect(result.current[0].overlay).toBe(false);
    // 정규화는 사용자가 켠 것이 아니지만, 끄지는 않는다 — 임의로 되돌리면 놀란다
    expect(result.current[0].normalize).toBe(true);
  });

  it('URL 로 겹쳐 보기만 들어와도 정규화 없이는 무시한다', () => {
    // 손으로 만든 링크나 옛 북마크로 ov=1 만 올 수 있다
    setSearch('?c=KR:005930&m=revenue&ov=1');
    const { result } = renderHook(() => useUrlState());

    expect(result.current[0].overlay).toBe(false);
  });

  it('URL 에 둘 다 있으면 그대로 복원한다', () => {
    setSearch('?c=KR:005930&m=revenue&n=1&ov=1');
    const { result } = renderHook(() => useUrlState());

    expect(result.current[0].normalize).toBe(true);
    expect(result.current[0].overlay).toBe(true);
  });
});

describe('URL 반영', () => {
  it('겹쳐 보기를 켜면 URL 에 n 과 ov 가 함께 남는다', () => {
    const { result } = renderHook(() => useUrlState());

    act(() => result.current[1]({ companyIds: ['KR:005930'], overlay: true }));

    expect(currentSearch().get('n')).toBe('1');
    expect(currentSearch().get('ov')).toBe('1');
  });

  it('끄면 URL 에서 사라진다', () => {
    const { result } = renderHook(() => useUrlState());

    act(() => result.current[1]({ overlay: true }));
    act(() => result.current[1]({ normalize: false }));

    expect(currentSearch().get('ov')).toBeNull();
    expect(currentSearch().get('n')).toBeNull();
  });

  it('기본 상태에서는 켜져 있지 않다', () => {
    const { result } = renderHook(() => useUrlState());
    expect(result.current[0].overlay).toBe(false);
    expect(result.current[0].normalize).toBe(false);
  });
});
