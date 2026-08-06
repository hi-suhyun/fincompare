import { describe, expect, it } from 'vitest';
import {
  describeSplit,
  detectSplits,
  snapToStandardRatio,
  splitAdjustmentFactors,
} from './splits.js';

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

describe('snapToStandardRatio — 실제 분할 비율로 스냅', () => {
  it('삼성전자 46.5배 -> 50:1', () => {
    // 연말 주식수 비율에는 자사주 변동이 섞여 46.5배로 잡힌다.
    // 그대로 쓰면 7% 오차가 PER 에 실린다.
    expect(snapToStandardRatio(46.5)).toBe(50);
  });

  it('흔한 비율들', () => {
    expect(snapToStandardRatio(2.02)).toBe(2);
    expect(snapToStandardRatio(9.8)).toBe(10);
    expect(snapToStandardRatio(4.95)).toBe(5);
  });

  it('액면병합은 역수로 돌려준다', () => {
    expect(snapToStandardRatio(0.2)).toBeCloseTo(0.2, 10); // 5:1 병합
    expect(snapToStandardRatio(0.51)).toBeCloseTo(0.5, 10); // 2:1 병합
  });

  it('표준 비율과 멀면 분할로 보지 않는다', () => {
    // 35배 — 어느 표준 비율과도 15% 이상 떨어져 있다
    expect(snapToStandardRatio(35)).toBeNull();
  });
});

describe('splitAdjustmentFactors — 주가와 EPS 기준 맞추기', () => {
  const periods = ['2016', '2017', '2018', '2019'];
  const shares = [128_386_494, 128_386_494, 5_969_782_550, 5_969_782_550];

  it('분할 이전 구간에 50 이 붙는다', () => {
    expect(splitAdjustmentFactors(periods, shares)).toEqual([50, 50, 1, 1]);
  });

  it('조정하면 PER 이 제자리를 찾는다', () => {
    const factors = splitAdjustmentFactors(periods, shares);

    // 2017: 수정주가 50,960 / 공시 EPS 299,868
    const reportedEps2017 = 299_868;
    const adjustedPrice2017 = 50_960;

    const wrongPer = adjustedPrice2017 / reportedEps2017;
    const adjustedPer = adjustedPrice2017 / (reportedEps2017 / (factors[1] ?? 1));

    expect(wrongPer).toBeCloseTo(0.17, 2); // 말이 안 되는 값
    expect(adjustedPer).toBeCloseTo(8.5, 1); // 실제와 맞는 값
  });

  it('분할이 없으면 전 구간 1', () => {
    expect(splitAdjustmentFactors(periods, [1000, 1000, 1000, 1000])).toEqual([1, 1, 1, 1]);
  });

  it('자본금이 함께 늘면 증자로 보고 조정하지 않는다', () => {
    const factors = splitAdjustmentFactors(
      ['2020', '2021'],
      [1000, 2000],
      [500, 1000],
    );
    expect(factors).toEqual([1, 1]);
  });

  it('분할이 두 번이면 계수가 누적된다', () => {
    const factors = splitAdjustmentFactors(
      ['2018', '2019', '2020'],
      [100, 1000, 5000], // 10:1 그리고 5:1
    );
    expect(factors).toEqual([50, 5, 1]);
  });
});
