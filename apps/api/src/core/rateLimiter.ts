/**
 * 소스별 요청 유량 제어.
 *
 * 두 가지를 동시에 지킨다:
 *  1. 초당 유량 (토큰 버킷) — SEC 10 req/s 같은 제한
 *  2. 일일 한도 (카운터) — DART 의 일일 호출 제한
 *
 * 일일 한도가 중요한 이유: 한도를 넘기면 그날 하루 서비스가 통째로 멈춘다.
 * 그래서 한도에 닿기 전에 스스로 막고, 소스가 QUOTA_EXCEEDED 를 주면
 * 남은 시간 동안 아예 요청을 내보내지 않는다.
 *
 * 시각·대기는 주입 가능하게 두어 테스트에서 실제로 기다리지 않게 한다.
 */

export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

export interface RateLimiterOptions {
  /** 버스트 허용량 */
  capacity: number;
  /** 초당 토큰 회복량 */
  refillPerSecond: number;
  /** 일일 호출 한도. 미설정이면 무제한 */
  dailyQuota?: number;
  /**
   * 일일 한도가 초기화되는 기준 타임존 오프셋(분).
   * DART 는 한국 기관이므로 KST(+540) 자정 기준으로 본다.
   */
  dayResetOffsetMinutes?: number;
  clock?: Clock;
}

export interface QuotaState {
  /** 오늘 사용한 호출 수 */
  used: number;
  /** 남은 호출 수. 무제한이면 null */
  remaining: number | null;
  /** 소스가 한도 초과를 통보해 차단된 상태인지 */
  exhausted: boolean;
}

const MS_PER_DAY = 86_400_000;
const MS_PER_MINUTE = 60_000;

export class RateLimiter {
  private readonly capacity: number;
  private readonly refillPerSecond: number;
  private readonly dailyQuota: number | null;
  private readonly dayResetOffsetMs: number;
  private readonly clock: Clock;

  private tokens: number;
  private lastRefillAt: number;
  private dayIndex: number;
  private usedToday = 0;
  /** 소스가 QUOTA_EXCEEDED 를 준 날. 그날은 더 이상 내보내지 않는다 */
  private exhaustedDay: number | null = null;

  constructor(options: RateLimiterOptions) {
    if (options.capacity <= 0) throw new Error('capacity 는 1 이상이어야 합니다');
    if (options.refillPerSecond <= 0) throw new Error('refillPerSecond 는 0보다 커야 합니다');

    this.capacity = options.capacity;
    this.refillPerSecond = options.refillPerSecond;
    this.dailyQuota = options.dailyQuota ?? null;
    this.dayResetOffsetMs = (options.dayResetOffsetMinutes ?? 0) * MS_PER_MINUTE;
    this.clock = options.clock ?? systemClock;

    this.tokens = options.capacity;
    this.lastRefillAt = this.clock.now();
    this.dayIndex = this.currentDayIndex();
  }

  private currentDayIndex(): number {
    return Math.floor((this.clock.now() + this.dayResetOffsetMs) / MS_PER_DAY);
  }

  /** 날짜가 바뀌었으면 일일 카운터를 초기화한다 */
  private rolloverIfNeeded(): void {
    const today = this.currentDayIndex();
    if (today !== this.dayIndex) {
      this.dayIndex = today;
      this.usedToday = 0;
      this.exhaustedDay = null;
    }
  }

  private refill(): void {
    const now = this.clock.now();
    const elapsedMs = now - this.lastRefillAt;
    if (elapsedMs <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + (elapsedMs / 1000) * this.refillPerSecond);
    this.lastRefillAt = now;
  }

  get quota(): QuotaState {
    this.rolloverIfNeeded();
    return {
      used: this.usedToday,
      remaining: this.dailyQuota === null ? null : Math.max(0, this.dailyQuota - this.usedToday),
      exhausted: this.exhaustedDay === this.dayIndex,
    };
  }

  /** 일일 한도를 다 썼거나 소스가 차단을 통보한 상태 */
  get isBlockedToday(): boolean {
    const q = this.quota;
    return q.exhausted || (q.remaining !== null && q.remaining <= 0);
  }

  /**
   * 다음 요청까지 기다려야 하는 시간(ms).
   * 0 이면 지금 바로 보내도 된다. 일일 한도가 막혔으면 null.
   */
  nextDelayMs(): number | null {
    this.rolloverIfNeeded();
    if (this.isBlockedToday) return null;

    this.refill();
    if (this.tokens >= 1) return 0;
    return Math.ceil(((1 - this.tokens) / this.refillPerSecond) * 1000);
  }

  /**
   * 토큰이 있으면 1개를 소비하고 true, 없으면 아무것도 하지 않고 false.
   *
   * 확인과 소비가 한 동작이어야 한다. 동시 요청이 여럿이면
   * nextDelayMs() 로 확인한 뒤 consume() 하는 사이에 다른 요청이 토큰을 가져간다.
   */
  tryConsume(): boolean {
    this.rolloverIfNeeded();
    if (this.isBlockedToday) return false;

    this.refill();
    if (this.tokens < 1) return false;

    this.tokens -= 1;
    this.usedToday += 1;
    return true;
  }

  /**
   * 토큰 1개를 소비한다. 없으면 던진다 — 조용히 유량을 넘기느니 버그를 드러내는 게 낫다.
   * 동시 요청 환경에서는 tryConsume() 을 쓸 것.
   */
  consume(): void {
    if (!this.tryConsume()) {
      throw new Error('토큰이 없습니다. nextDelayMs() 로 대기한 뒤 호출하세요');
    }
  }

  /** 소스가 일일 한도 초과를 통보했을 때 — 그날은 더 이상 내보내지 않는다 */
  markQuotaExhausted(): void {
    this.rolloverIfNeeded();
    this.exhaustedDay = this.dayIndex;
  }

  /** 다음 일일 한도 초기화까지 남은 시간(ms) */
  msUntilQuotaReset(): number {
    const now = this.clock.now();
    const nextDayStart = (this.currentDayIndex() + 1) * MS_PER_DAY - this.dayResetOffsetMs;
    return Math.max(0, nextDayStart - now);
  }
}

/**
 * 소스별 기본 설정.
 *
 * DART 와 KRX 의 실제 한도는 공식 문서에서 확인되지 않았다(docs/00-data-sources.md 4장).
 * 키 발급 후 실측해서 조정해야 한다. 그때까지는 보수적으로 잡는다.
 */
export const DEFAULT_LIMITS = {
  /** SEC 공지 기준 10 req/s. 안전 마진을 두고 8 로 잡는다 */
  SEC: { capacity: 8, refillPerSecond: 8 },
  /** 일일 한도 미확인. 통용 수치 20,000 에서 마진을 뺀 19,000 으로 시작 */
  DART: { capacity: 5, refillPerSecond: 5, dailyQuota: 19_000, dayResetOffsetMinutes: 540 },
  /** 한도 미확인. 승인 후 실측 */
  KRX: { capacity: 2, refillPerSecond: 2, dayResetOffsetMinutes: 540 },
  /** 무료 티어 1,000 req/일, 50 req/시간 */
  TIINGO: { capacity: 2, refillPerSecond: 0.013, dailyQuota: 900 },
  /** 비공식 엔드포인트. 눈에 띄지 않게 느리게 */
  NAVER: { capacity: 1, refillPerSecond: 1 },
  /**
   * FMP 무료 티어 250 req/일. 마진을 두고 220 으로 잡는다.
   * 기업당 1회면 충분한 데이터라 초당 한도는 넉넉히 둬도 된다.
   */
  FMP: { capacity: 2, refillPerSecond: 2, dailyQuota: 220 },
  /** ECB. 부담 없지만 예의상 */
  ECB: { capacity: 5, refillPerSecond: 5 },
} as const satisfies Record<string, RateLimiterOptions>;
