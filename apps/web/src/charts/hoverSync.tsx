import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * 차트 간 호버 동기화.
 *
 * 한 차트에 마우스를 올리면 모든 차트에 같은 시점의 세로 기준선이 함께 뜬다.
 * 이게 이 서비스의 핵심 인터랙션이다 — 여러 지표를 세로로 쌓아 놓고
 * "2018년에 이 회사들이 어땠나"를 한 번에 읽는 것.
 *
 * 커서 옆 툴팁까지 여기서 관리한다. 툴팁 안에 리포트 링크가 있어서
 * **마우스를 툴팁으로 옮겨도 시점이 유지되어야** 클릭할 수 있다.
 * 차트를 벗어나면 잠깐 기다렸다가 지우고, 그 사이 툴팁에 들어오면 취소한다.
 */

/** 차트를 벗어난 뒤 툴팁을 지우기까지의 유예(ms). 차트 -> 툴팁 이동에 걸리는 시간 */
const LEAVE_GRACE_MS = 260;

export interface HoverPoint {
  /** 화면 좌표 (position: fixed 기준) */
  x: number;
  y: number;
}

interface HoverSyncValue {
  /** 현재 가리키고 있는 기간 라벨. null 이면 호버 중이 아니다 */
  activePeriod: string | null;
  /** 커서 위치. 툴팁을 띄울 자리 */
  point: HoverPoint | null;
  setActivePeriod: (period: string | null) => void;
  setPoint: (point: HoverPoint | null) => void;
  /** 차트를 벗어났다. 유예를 두고 지운다 */
  scheduleClear: () => void;
  /** 툴팁 안으로 들어왔다. 예약된 지우기를 취소한다 */
  cancelClear: () => void;
}

const HoverSyncContext = createContext<HoverSyncValue | null>(null);

export function HoverSyncProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [activePeriod, setActivePeriod] = useState<string | null>(null);
  const [point, setPoint] = useState<HoverPoint | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClear = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const scheduleClear = useCallback(() => {
    cancelClear();
    timer.current = setTimeout(() => {
      setActivePeriod(null);
      setPoint(null);
      timer.current = null;
    }, LEAVE_GRACE_MS);
  }, [cancelClear]);

  // 호버가 갱신되면 예약된 지우기는 의미가 없다
  const updatePeriod = useCallback(
    (next: string | null) => {
      if (next !== null) cancelClear();
      setActivePeriod(next);
    },
    [cancelClear],
  );

  const value = useMemo(
    () => ({
      activePeriod,
      point,
      setActivePeriod: updatePeriod,
      setPoint,
      scheduleClear,
      cancelClear,
    }),
    [activePeriod, point, updatePeriod, scheduleClear, cancelClear],
  );

  return <HoverSyncContext.Provider value={value}>{children}</HoverSyncContext.Provider>;
}

export function useHoverSync(): HoverSyncValue {
  const value = useContext(HoverSyncContext);
  if (value === null) throw new Error('HoverSyncProvider 안에서만 쓸 수 있습니다');
  return value;
}
