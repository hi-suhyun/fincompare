import type { PeriodType } from '../schema/financial.js';

/**
 * 결산월이 다른 기업을 한 X축에 놓기 위한 정렬 규칙.
 *
 * 연간: periodEnd 에서 3개월을 뺀 날짜가 속한 달력 연도
 * 분기: periodEnd 에서 45일을 뺀 날짜가 속한 달력 분기
 *
 * 이 규칙은 SEC 가 companyfacts 의 `frame` 필드에 쓰는 배정과
 * 실측 케이스(AAPL 9월결산 / NVDA 1월결산 / MSFT 6월결산) 전부에서 일치한다.
 * 자세한 검증 표는 docs/01-account-mapping.md 3.2 참고.
 *
 * 주의: SEC 의 `fy` / `fp` 필드는 "이 숫자가 실린 보고서"를 가리키는 값이라
 * 회계연도 식별자로 쓸 수 없다. 반드시 이 함수로 periodEnd 에서 계산한다.
 */

export interface AlignedPeriod {
  alignedYear: number;
  alignedQuarter: 1 | 2 | 3 | 4 | null;
}

const DAY_MS = 86_400_000;

/** 'YYYY-MM-DD' -> UTC 자정 Date. 로컬 타임존 영향을 받지 않게 UTC 로 고정한다. */
export function parseIsoDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`잘못된 날짜 형식: ${iso}`);
  const [, y, mo, d] = m as unknown as [string, string, string, string];
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (Number.isNaN(date.getTime())) throw new Error(`잘못된 날짜: ${iso}`);
  return date;
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * 달을 뺀다. 말일 보정 포함 — 2025-03-31 에서 1개월을 빼면 2025-02-28.
 * (보정 없이 Date 에 넘기면 3월로 넘어가 버린다)
 */
export function subtractMonths(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  const targetMonthLastDay = new Date(Date.UTC(y, m - months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - months, Math.min(d, targetMonthLastDay)));
}

export function subtractDays(date: Date, days: number): Date {
  return new Date(date.getTime() - days * DAY_MS);
}

export function alignPeriod(periodEnd: string, periodType: PeriodType): AlignedPeriod {
  const end = parseIsoDate(periodEnd);

  if (periodType === 'FY') {
    return { alignedYear: subtractMonths(end, 3).getUTCFullYear(), alignedQuarter: null };
  }

  const anchor = subtractDays(end, 45);
  const quarter = (Math.floor(anchor.getUTCMonth() / 3) + 1) as 1 | 2 | 3 | 4;
  return { alignedYear: anchor.getUTCFullYear(), alignedQuarter: quarter };
}

/** 정렬 보정이 실제로 일어났는지 — UI 배지·경고 표시용 */
export function isFiscalYearShifted(periodEnd: string, fiscalYear: number, periodType: PeriodType): boolean {
  return alignPeriod(periodEnd, periodType).alignedYear !== fiscalYear;
}

/** 12월 결산이 아닌 기업에 붙일 배지 문구. 12월이면 null */
export function fiscalYearEndBadge(month: number): string | null {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`잘못된 결산월: ${month}`);
  }
  return month === 12 ? null : `${month}월 결산`;
}

/**
 * 정렬 키 문자열. 차트 X축 카테고리로 그대로 쓴다.
 * 'FY' -> '2024', 'Q' -> '2024Q3'
 */
export function alignedKey(p: AlignedPeriod): string {
  return p.alignedQuarter === null ? String(p.alignedYear) : `${p.alignedYear}Q${p.alignedQuarter}`;
}

/** from~to 사이의 X축 카테고리를 빠짐없이 생성한다. 데이터가 없는 구간도 자리를 차지해야 선이 끊긴다. */
export function buildPeriodAxis(from: number, to: number, periodType: PeriodType): string[] {
  if (to < from) throw new Error(`잘못된 기간: ${from} ~ ${to}`);
  const out: string[] = [];
  for (let y = from; y <= to; y++) {
    if (periodType === 'FY') out.push(String(y));
    else for (let q = 1; q <= 4; q++) out.push(`${y}Q${q}`);
  }
  return out;
}
