import { describe, expect, it } from 'vitest';
import { RateLimiter, type Clock } from './rateLimiter.js';

/** 테스트에서 시간을 직접 굴린다 — 실제로 기다리지 않는다 */
class FakeClock implements Clock {
  private t: number;
  constructor(start = 0) {
    this.t = start;
  }
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
  set(ms: number): void {
    this.t = ms;
  }
}

describe('RateLimiter — 토큰 버킷', () => {
  it('버스트 용량만큼은 즉시 통과한다', () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter({ capacity: 3, refillPerSecond: 1, clock });

    for (let i = 0; i < 3; i++) {
      expect(limiter.nextDelayMs()).toBe(0);
      limiter.consume();
    }
    expect(limiter.nextDelayMs()).toBeGreaterThan(0);
  });

  it('토큰이 없으면 회복 시간을 알려준다', () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter({ capacity: 1, refillPerSecond: 2, clock });

    limiter.consume();
    // 초당 2개 회복 -> 1개 채우는 데 500ms
    expect(limiter.nextDelayMs()).toBe(500);
  });

  it('시간이 지나면 토큰이 회복된다', () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter({ capacity: 1, refillPerSecond: 2, clock });

    limiter.consume();
    clock.advance(500);
    expect(limiter.nextDelayMs()).toBe(0);
  });

  it('용량을 넘겨 쌓이지 않는다', () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter({ capacity: 2, refillPerSecond: 10, clock });

    clock.advance(60_000); // 아주 오래 놀아도
    limiter.consume();
    limiter.consume();
    expect(limiter.nextDelayMs()).toBeGreaterThan(0); // 3개째는 못 나간다
  });

  it('토큰 없이 consume 하면 던진다 — 조용히 유량을 넘기지 않는다', () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter({ capacity: 1, refillPerSecond: 1, clock });

    limiter.consume();
    expect(() => limiter.consume()).toThrow(/토큰이 없습니다/);
  });

  it('잘못된 설정은 생성 시점에 던진다', () => {
    expect(() => new RateLimiter({ capacity: 0, refillPerSecond: 1 })).toThrow();
    expect(() => new RateLimiter({ capacity: 1, refillPerSecond: 0 })).toThrow();
  });
});

describe('RateLimiter — 일일 한도', () => {
  it('한도를 다 쓰면 nextDelayMs 가 null 을 준다', () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter({
      capacity: 5,
      refillPerSecond: 100,
      dailyQuota: 3,
      clock,
    });

    for (let i = 0; i < 3; i++) {
      expect(limiter.nextDelayMs()).toBe(0);
      limiter.consume();
    }

    expect(limiter.nextDelayMs()).toBeNull();
    expect(limiter.isBlockedToday).toBe(true);
    expect(limiter.quota).toEqual({ used: 3, remaining: 0, exhausted: false });
  });

  it('소스가 한도 초과를 통보하면 즉시 차단한다', () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter({ capacity: 5, refillPerSecond: 5, dailyQuota: 1000, clock });

    limiter.consume();
    expect(limiter.isBlockedToday).toBe(false);

    limiter.markQuotaExhausted();

    expect(limiter.isBlockedToday).toBe(true);
    expect(limiter.nextDelayMs()).toBeNull();
    expect(limiter.quota.exhausted).toBe(true);
  });

  it('날짜가 바뀌면 한도가 초기화된다', () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter({ capacity: 5, refillPerSecond: 100, dailyQuota: 2, clock });

    limiter.consume();
    limiter.consume();
    expect(limiter.isBlockedToday).toBe(true);

    clock.advance(86_400_000);

    expect(limiter.isBlockedToday).toBe(false);
    expect(limiter.quota.used).toBe(0);
  });

  it('차단 상태도 날짜가 바뀌면 풀린다', () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter({ capacity: 5, refillPerSecond: 100, dailyQuota: 100, clock });

    limiter.markQuotaExhausted();
    expect(limiter.isBlockedToday).toBe(true);

    clock.advance(86_400_000);
    expect(limiter.isBlockedToday).toBe(false);
  });

  it('KST 자정 기준으로 초기화된다 — DART 는 한국 기관이다', () => {
    // 2026-08-06 14:00 UTC = 2026-08-06 23:00 KST. 아직 같은 날
    const clock = new FakeClock(Date.parse('2026-08-06T14:00:00Z'));
    const limiter = new RateLimiter({
      capacity: 5,
      refillPerSecond: 100,
      dailyQuota: 1,
      dayResetOffsetMinutes: 540,
      clock,
    });

    limiter.consume();
    expect(limiter.isBlockedToday).toBe(true);

    // UTC 로는 아직 같은 날(20:00 UTC)이지만 KST 로는 다음 날 05:00
    clock.set(Date.parse('2026-08-06T20:00:00Z'));
    expect(limiter.isBlockedToday).toBe(false);
  });

  it('한도 초기화까지 남은 시간을 알려준다', () => {
    const clock = new FakeClock(Date.parse('2026-08-06T14:00:00Z')); // 23:00 KST
    const limiter = new RateLimiter({
      capacity: 1,
      refillPerSecond: 1,
      dayResetOffsetMinutes: 540,
      clock,
    });

    expect(limiter.msUntilQuotaReset()).toBe(3_600_000); // 1시간
  });

  it('한도 미설정이면 remaining 이 null 이고 막히지 않는다', () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter({ capacity: 10, refillPerSecond: 100, clock });

    for (let i = 0; i < 10; i++) limiter.consume();

    expect(limiter.quota.remaining).toBeNull();
    expect(limiter.isBlockedToday).toBe(false);
  });
});
