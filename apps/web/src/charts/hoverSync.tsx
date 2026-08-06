import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * 차트 간 호버 동기화.
 *
 * 한 차트에 마우스를 올리면 모든 차트에 같은 시점의 세로 기준선이 함께 뜬다.
 * 이게 이 서비스의 핵심 인터랙션이다 — 여러 지표를 세로로 쌓아 놓고
 * "2018년에 이 회사들이 어땠나"를 한 번에 읽는 것.
 *
 * 상태를 context 하나에 두면 차트가 몇 개로 늘어나도 툴팁은 하나로 유지된다.
 */

interface HoverSyncValue {
  /** 현재 가리키고 있는 기간 라벨. null 이면 호버 중이 아니다 */
  activePeriod: string | null;
  setActivePeriod: (period: string | null) => void;
}

const HoverSyncContext = createContext<HoverSyncValue | null>(null);

export function HoverSyncProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [activePeriod, setActivePeriod] = useState<string | null>(null);
  const value = useMemo(() => ({ activePeriod, setActivePeriod }), [activePeriod]);

  return <HoverSyncContext.Provider value={value}>{children}</HoverSyncContext.Provider>;
}

export function useHoverSync(): HoverSyncValue {
  const value = useContext(HoverSyncContext);
  if (value === null) throw new Error('HoverSyncProvider 안에서만 쓸 수 있습니다');
  return value;
}
