import { describe, expect, it } from 'vitest';
import { describeSplit, detectSplits } from './splits.js';

describe('detectSplits — 삼성전자 50:1 액면분할', () => {
  const periods = ['2016', '2017', '2018', '2019'];
  // 2018년 5월 50:1 분할. 실제 발행주식수 흐름
  const shares = [128_386_494, 128_386_494, 5_969_782_550, 5_969_782_550];

  it('분할 지점을 찾는다', () => {
    const events = detectSplits(periods, shares);

    expect(events).toHaveLength(1);
    expect(events[0]?.period).toBe('2018');
    expect(events[0]?.kind).toBe('SPLIT');
    expect(events[0]?.ratio).toBeCloseTo(46.5, 1);
  });

  it('설명 문구가 불연속을 알린다', () => {
    const [event] = detectSplits(periods, shares);
    const text = describeSplit(event!);

    expect(text).toContain('2018');
    expect(text).toContain('액면분할');
    expect(text).toContain('불연속');
  });
});

describe('detectSplits — 오탐 방지', () => {
  it('주식수가 안정적이면 아무것도 잡지 않는다', () => {
    expect(detectSplits(['2020', '2021', '2022'], [1000, 1000, 1000])).toEqual([]);
  });

  it('자사주 매입·소각 정도의 변동은 무시한다', () => {
    // 5% 감소
    expect(detectSplits(['2020', '2021'], [1000, 950])).toEqual([]);
  });

  it('40% 증자도 임계값 아래라 무시한다', () => {
    expect(detectSplits(['2020', '2021'], [1000, 1400])).toEqual([]);
  });

  it('자본금이 함께 늘면 증자로 보고 분할로 잡지 않는다', () => {
    // 주식수 2배, 자본금도 2배 -> 유상증자
    const events = detectSplits(['2020', '2021'], [1000, 2000], [500, 1000]);
    expect(events).toEqual([]);
  });

  it('자본금이 그대로면 액면분할로 잡는다', () => {
    // 주식수 2배, 자본금 동일 -> 액면가가 절반이 된 것
    const events = detectSplits(['2020', '2021'], [1000, 2000], [500, 500]);
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('SPLIT');
  });
});

describe('detectSplits — 액면병합', () => {
  it('주식수가 크게 줄면 병합으로 본다', () => {
    const events = detectSplits(['2020', '2021'], [5000, 1000]);

    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('REVERSE_SPLIT');
    expect(describeSplit(events[0]!)).toContain('5.0:1');
  });
});

describe('detectSplits — 결측 처리', () => {
  it('결측 구간은 건너뛴다', () => {
    expect(detectSplits(['2020', '2021', '2022'], [1000, null, 50_000])).toEqual([]);
  });

  it('0 이나 음수는 무시한다', () => {
    expect(detectSplits(['2020', '2021'], [0, 1000])).toEqual([]);
  });

  it('빈 배열도 터지지 않는다', () => {
    expect(detectSplits([], [])).toEqual([]);
  });
});
