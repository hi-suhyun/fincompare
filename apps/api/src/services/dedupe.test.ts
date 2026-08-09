import { describe, expect, it } from 'vitest';
import type { SeriesWarning } from '@fincompare/shared';
import { dedupeWarnings } from './series.js';

const base = { companyId: 'US:NVDA', metricId: 'closePrice' } as const;

describe('경고 중복 제거', () => {
  it('한 기업의 서로 다른 분할을 하나로 뭉개지 않는다', () => {
    // 엔비디아는 2021년 4:1, 2024년 10:1 로 두 번 분할했다.
    // 코드까지만 묶으면 뒤의 10:1 이 통째로 사라진다.
    const warnings: SeriesWarning[] = [
      { ...base, code: 'SHARE_COUNT_JUMP', detail: '2021년 4:1 액면분할' },
      { ...base, code: 'SHARE_COUNT_JUMP', detail: '2024년 10:1 액면분할' },
    ];

    const result = dedupeWarnings(warnings);

    expect(result).toHaveLength(2);
    expect(result.map((w) => w.detail)).toEqual([
      '2021년 4:1 액면분할',
      '2024년 10:1 액면분할',
    ]);
  });

  it('내용이 같으면 합치고 시점을 모은다', () => {
    const warnings: SeriesWarning[] = [
      { ...base, code: 'NEGATIVE_EPS', period: '2022' },
      { ...base, code: 'NEGATIVE_EPS', period: '2023' },
      { ...base, code: 'NEGATIVE_EPS', period: '2022' },
    ];

    const result = dedupeWarnings(warnings);

    expect(result).toHaveLength(1);
    expect(result[0]?.period).toBe('2022, 2023');
  });

  it('기업이 다르면 따로 남긴다', () => {
    const warnings: SeriesWarning[] = [
      { ...base, code: 'SHARE_COUNT_JUMP', detail: '같은 문구' },
      { companyId: 'KR:005930', metricId: 'closePrice', code: 'SHARE_COUNT_JUMP', detail: '같은 문구' },
    ];

    expect(dedupeWarnings(warnings)).toHaveLength(2);
  });
});
