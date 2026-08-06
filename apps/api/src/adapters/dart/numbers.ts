/**
 * DART 응답의 숫자 파싱.
 *
 * DART 는 API 마다 숫자 표기가 다르다. 실측한 것:
 *  - fnlttSinglAcntAll: 콤마 없는 정수 문자열   '455905980000000', 음수 '-4480835000000'
 *  - stockTotqySttus:   콤마 있는 문자열        '5,969,782,550'
 *  - 두 API 공통:       빈 문자열 '' 과 '-' 가 "값 없음"으로 온다
 *
 * '' 와 '-' 를 0 으로 바꾸면 안 된다. 자기주식이 없는 것과 0주인 것은 결과적으로 같지만,
 * 매출이 '' 인 것과 0원인 것은 완전히 다르다. 전부 null 로 통일한다.
 */

/** JS number 가 정확히 표현할 수 있는 한계. 삼성전자 자산총계(4.5e14)는 여유롭게 이 안에 든다 */
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

export class UnsafeAmountError extends Error {
  constructor(readonly raw: string) {
    super(`정밀도를 잃는 큰 수입니다: ${raw}`);
    this.name = 'UnsafeAmountError';
  }
}

/**
 * DART 금액 문자열 -> number | null
 *
 * 값이 없으면 null. 숫자로 해석할 수 없으면 null (예외를 던지지 않는다 —
 * 계정 하나가 이상하다고 기업 전체 수집이 멈추면 안 된다).
 * 다만 안전 정수 범위를 넘으면 던진다. 조용히 틀린 숫자를 쓰는 것보다 낫다.
 */
export function parseDartAmount(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;

  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '-') return null;

  const normalized = trimmed.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;

  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  if (Math.abs(value) > MAX_SAFE) throw new UnsafeAmountError(raw);

  return value;
}

/**
 * 주식수 파싱. 금액과 규칙은 같지만 음수가 나오면 안 된다.
 * 음수 주식수는 응답이 깨진 것이므로 null 로 떨어뜨린다.
 */
export function parseShareCount(raw: string | null | undefined): number | null {
  const value = parseDartAmount(raw);
  if (value === null) return null;
  if (value < 0 || !Number.isInteger(value)) return null;
  return value;
}

/** 'YYYYMMDD' -> 'YYYY-MM-DD'. 형식이 아니면 null */
export function parseDartDate(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const [, y, mo, d] = m as unknown as [string, string, string, string];
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${y}-${mo}-${d}`;
}

/** 결산월 문자열('12') -> 1~12. 범위 밖이면 12로 본다 (국내 절대다수가 12월 결산) */
export function parseAccountingMonth(raw: string | null | undefined): number {
  const n = Number((raw ?? '').trim());
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : 12;
}
