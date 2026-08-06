import { describe, expect, it } from 'vitest';
import { FxTable, type FxRate } from './ecb.js';

/** ECB 실제 고시 형태 — 영업일만 있고 주말은 행이 없다 */
const RATES: FxRate[] = [
  { date: '2024-01-02', rate: 1300 }, // 화
  { date: '2024-01-03', rate: 1310 },
  { date: '2024-01-04', rate: 1320 },
  { date: '2024-01-05', rate: 1330 }, // 금
  // 1/6(토), 1/7(일) 없음
  { date: '2024-01-08', rate: 1340 }, // 월
];

describe('FxTable.at — 직전 영업일 채우기', () => {
  const table = new FxTable(RATES);

  it('고시된 날은 그 값을 준다', () => {
    expect(table.at('2024-01-03')).toBe(1310);
  });

  it('주말은 직전 금요일 값을 쓴다', () => {
    expect(table.at('2024-01-06')).toBe(1330);
    expect(table.at('2024-01-07')).toBe(1330);
  });

  it('앞으로 당겨오지 않는다 — 아직 없는 환율을 쓰면 안 된다', () => {
    // 1/1 은 데이터 시작 이전. 1/2 값(1300)을 끌어오면 미래를 참조하는 셈이다.
    expect(table.at('2024-01-01')).toBeNull();
  });

  it('마지막 고시일 이후는 마지막 값을 유지한다', () => {
    expect(table.at('2024-02-01')).toBe(1340);
  });

  it('데이터가 없으면 null', () => {
    expect(new FxTable([]).at('2024-01-03')).toBeNull();
    expect(new FxTable([]).isEmpty).toBe(true);
  });
});

describe('FxTable.average — 기간 평균', () => {
  const table = new FxTable(RATES);

  it('구간 내 영업일 평균을 낸다', () => {
    // 1300, 1310, 1320, 1330, 1340 -> 1320
    expect(table.average('2024-01-01', '2024-01-31')).toBe(1320);
  });

  it('부분 구간도 맞다', () => {
    // 1310, 1320 -> 1315
    expect(table.average('2024-01-03', '2024-01-04')).toBe(1315);
  });

  it('구간에 고시가 하나도 없으면 기말 시점 값으로 폴백한다', () => {
    expect(table.average('2024-01-06', '2024-01-07')).toBe(1330);
  });

  it('매출을 기말 환율로 환산하면 값이 달라진다 — 평균을 써야 하는 이유', () => {
    const avg = table.average('2024-01-01', '2024-01-31');
    const endOfPeriod = table.at('2024-01-31');

    expect(avg).toBe(1320);
    expect(endOfPeriod).toBe(1340);
    expect(avg).not.toBe(endOfPeriod);
  });
});

describe('FxTable — 입력 정렬', () => {
  it('순서가 뒤섞인 입력도 정렬해서 처리한다', () => {
    const shuffled = new FxTable([
      { date: '2024-01-08', rate: 1340 },
      { date: '2024-01-02', rate: 1300 },
      { date: '2024-01-05', rate: 1330 },
    ]);
    expect(shuffled.at('2024-01-06')).toBe(1330);
    expect(shuffled.at('2024-01-03')).toBe(1300);
  });
});
