import type { SourceId } from '@fincompare/shared';

/**
 * 외부 소스 오류 분류.
 *
 * 재시도해도 되는 것과 아닌 것을 구분하는 게 핵심이다.
 * DART 는 일일 호출 한도가 있어서, 재시도가 무의미한 오류에 백오프를 태우면
 * 시간만 버리는 게 아니라 남은 한도를 갉아먹는다.
 */
export type ErrorKind =
  /** 인증 실패. 키가 틀렸거나 SEC User-Agent 누락. 재시도 무의미 */
  | 'AUTH'
  /** 요청 파라미터가 잘못됨. 재시도 무의미 */
  | 'INVALID_REQUEST'
  /** 해당 조건의 데이터가 없음(DART 013). 재시도 무의미 + 결측으로 캐시 */
  | 'NOT_FOUND'
  /** 순간 유량 초과. 잠시 뒤 재시도하면 됨 */
  | 'RATE_LIMIT'
  /** 일일 한도 소진(DART 020). 오늘은 재시도해도 소용없음 */
  | 'QUOTA_EXCEEDED'
  /** 시스템 점검(DART 800). 재시도 가능 */
  | 'MAINTENANCE'
  /** 네트워크/5xx. 재시도 가능 */
  | 'TRANSIENT'
  /** 응답 스키마가 예상과 다름. 재시도해도 같은 결과 */
  | 'PARSE'
  | 'UNKNOWN';

const RETRYABLE: ReadonlySet<ErrorKind> = new Set<ErrorKind>([
  'RATE_LIMIT',
  'MAINTENANCE',
  'TRANSIENT',
  'UNKNOWN',
]);

/** 결측으로 캐시해서 다시 묻지 않아야 하는 오류 */
const CACHEABLE_AS_EMPTY: ReadonlySet<ErrorKind> = new Set<ErrorKind>(['NOT_FOUND']);

export class SourceError extends Error {
  readonly source: SourceId;
  readonly kind: ErrorKind;
  /** 원본 상태 코드. HTTP 든 DART status 든 그대로 담는다 */
  readonly code: string | undefined;
  /** Retry-After 헤더 등 소스가 알려준 대기 시간 */
  readonly retryAfterMs: number | undefined;

  constructor(
    source: SourceId,
    kind: ErrorKind,
    message: string,
    options: { code?: string; retryAfterMs?: number; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'SourceError';
    this.source = source;
    this.kind = kind;
    this.code = options.code;
    this.retryAfterMs = options.retryAfterMs;
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.kind);
  }

  get cacheableAsEmpty(): boolean {
    return CACHEABLE_AS_EMPTY.has(this.kind);
  }
}

/**
 * DART OpenAPI status 코드 -> ErrorKind
 * 코드 목록은 개발가이드의 「응답 결과」 표를 그대로 옮긴 것이다.
 */
export function classifyDartStatus(status: string): ErrorKind | null {
  switch (status) {
    case '000':
      return null; // 정상
    case '010': // 등록되지 않은 키
    case '011': // 사용할 수 없는 키
    case '012': // 접근할 수 없는 IP
    case '101': // 부적절한 접근
    case '901': // 서비스 중지
      return 'AUTH';
    case '013': // 조회된 데이터가 없음
    case '014': // 파일이 존재하지 않음
      return 'NOT_FOUND';
    case '020': // 요청 제한 초과 — 일일 한도
      return 'QUOTA_EXCEEDED';
    case '021': // 조회 가능한 회사 개수 초과
    case '100': // 필드의 부적절한 값
      return 'INVALID_REQUEST';
    case '800': // 시스템 점검
      return 'MAINTENANCE';
    case '900': // 정의되지 않은 오류
      return 'UNKNOWN';
    default:
      return 'UNKNOWN';
  }
}

export function classifyHttpStatus(status: number): ErrorKind | null {
  if (status >= 200 && status < 300) return null;
  // SEC 는 User-Agent 가 없으면 403 을 준다. 재시도해도 계속 403 이다.
  if (status === 401 || status === 403) return 'AUTH';
  if (status === 404) return 'NOT_FOUND';
  if (status === 429) return 'RATE_LIMIT';
  if (status >= 400 && status < 500) return 'INVALID_REQUEST';
  return 'TRANSIENT';
}

/** Retry-After 헤더 파싱. 초 단위 숫자와 HTTP-date 형식을 모두 받는다 */
export function parseRetryAfter(header: string | null, now: number): number | undefined {
  if (header === null) return undefined;

  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}
