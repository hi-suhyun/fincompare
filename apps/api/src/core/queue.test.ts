import { describe, expect, it, vi } from 'vitest';
import { SourceError } from './errors.js';
import { DEFAULT_RETRY_POLICY, RequestQueue, backoffDelayMs } from './queue.js';
import { RateLimiter, type Clock } from './rateLimiter.js';

class FakeClock implements Clock {
  private t = 0;
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

/** sleep 을 가짜로 두고, 잔 시간만큼 시계를 굴린다 */
function makeHarness(options: { capacity?: number; refillPerSecond?: number; dailyQuota?: number } = {}) {
  const clock = new FakeClock();
  const slept: number[] = [];
  const limiter = new RateLimiter({
    capacity: options.capacity ?? 100,
    refillPerSecond: options.refillPerSecond ?? 100,
    ...(options.dailyQuota === undefined ? {} : { dailyQuota: options.dailyQuota }),
    clock,
  });
  const sleep = (ms: number): Promise<void> => {
    slept.push(ms);
    clock.advance(ms);
    return Promise.resolve();
  };
  return { clock, slept, limiter, sleep };
}

describe('backoffDelayMs', () => {
  it('시도 횟수에 따라 지수적으로 늘어난다', () => {
    const noJitter = { ...DEFAULT_RETRY_POLICY, jitterRatio: 0 };
    expect(backoffDelayMs(1, noJitter, () => 0.5)).toBe(1_000);
    expect(backoffDelayMs(2, noJitter, () => 0.5)).toBe(2_000);
    expect(backoffDelayMs(3, noJitter, () => 0.5)).toBe(4_000);
  });

  it('maxDelayMs 에서 멈춘다', () => {
    const noJitter = { ...DEFAULT_RETRY_POLICY, jitterRatio: 0 };
    expect(backoffDelayMs(10, noJitter, () => 0.5)).toBe(DEFAULT_RETRY_POLICY.maxDelayMs);
  });

  it('지터가 대기 시간을 흔든다', () => {
    const policy = { ...DEFAULT_RETRY_POLICY, jitterRatio: 0.2 };
    expect(backoffDelayMs(1, policy, () => 0)).toBe(800); // -20%
    expect(backoffDelayMs(1, policy, () => 1)).toBe(1_200); // +20%
  });

  it('음수가 되지 않는다', () => {
    const policy = { ...DEFAULT_RETRY_POLICY, jitterRatio: 2 };
    expect(backoffDelayMs(1, policy, () => 0)).toBeGreaterThanOrEqual(0);
  });
});

describe('RequestQueue — 기본 동작', () => {
  it('성공하면 그대로 반환한다', async () => {
    const h = makeHarness();
    const queue = new RequestQueue({ source: 'SEC', limiter: h.limiter, sleep: h.sleep });

    await expect(queue.enqueue(() => Promise.resolve('ok'))).resolves.toBe('ok');
  });

  it('요청을 직렬로 처리한다', async () => {
    const h = makeHarness();
    const queue = new RequestQueue({ source: 'SEC', limiter: h.limiter, sleep: h.sleep });
    const order: number[] = [];

    await Promise.all(
      [1, 2, 3].map((n) =>
        queue.enqueue(async () => {
          order.push(n);
          await Promise.resolve();
          order.push(n * 10);
          return n;
        }),
      ),
    );

    // 겹쳐 돌면 [1,2,3,10,20,30] 이 된다
    expect(order).toEqual([1, 10, 2, 20, 3, 30]);
  });

  it('앞 요청이 실패해도 뒤 요청이 계속 처리된다', async () => {
    const h = makeHarness();
    const queue = new RequestQueue({ source: 'SEC', limiter: h.limiter, sleep: h.sleep });

    const failing = queue.enqueue(() =>
      Promise.reject(new SourceError('SEC', 'AUTH', 'User-Agent 누락')),
    );
    const following = queue.enqueue(() => Promise.resolve('살아있음'));

    await expect(failing).rejects.toThrow(SourceError);
    await expect(following).resolves.toBe('살아있음');
  });

  it('동시성을 올리면 요청이 겹쳐서 실행된다', async () => {
    const h = makeHarness();
    const queue = new RequestQueue({
      source: 'DART',
      limiter: h.limiter,
      sleep: h.sleep,
      concurrency: 3,
    });

    let concurrent = 0;
    let peak = 0;
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });

    const tasks = [1, 2, 3, 4, 5].map(() =>
      queue.enqueue(async () => {
        concurrent += 1;
        peak = Math.max(peak, concurrent);
        await gate;
        concurrent -= 1;
        return 1;
      }),
    );

    // 이벤트 루프를 비워 슬롯이 다 채워지게 한다
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(peak).toBe(3); // 5개를 넣어도 동시에 3개까지만
    expect(queue.pendingCount).toBe(5); // 나머지 2개는 슬롯을 기다리는 중

    openGate();
    await Promise.all(tasks);
    expect(queue.pendingCount).toBe(0);
  });

  it('동시성을 넘겨도 유량 제한은 그대로 지킨다', async () => {
    const h = makeHarness({ capacity: 2, refillPerSecond: 2 });
    const queue = new RequestQueue({
      source: 'DART',
      limiter: h.limiter,
      sleep: h.sleep,
      concurrency: 5,
    });

    await Promise.all([1, 2, 3, 4].map(() => queue.enqueue(() => Promise.resolve(1))));

    // 버스트 2개는 즉시, 나머지 2개는 토큰을 기다린다
    expect(h.slept.length).toBeGreaterThan(0);
    expect(h.limiter.quota.used).toBe(4);
  });

  it('토큰이 없으면 기다렸다가 보낸다', async () => {
    const h = makeHarness({ capacity: 1, refillPerSecond: 2 });
    const queue = new RequestQueue({ source: 'SEC', limiter: h.limiter, sleep: h.sleep });

    await queue.enqueue(() => Promise.resolve(1));
    await queue.enqueue(() => Promise.resolve(2));

    expect(h.slept).toContain(500); // 초당 2개 -> 500ms 대기
  });
});

describe('RequestQueue — 재시도 분류', () => {
  it('TRANSIENT 는 재시도한다', async () => {
    const h = makeHarness();
    const queue = new RequestQueue({
      source: 'SEC',
      limiter: h.limiter,
      sleep: h.sleep,
      random: () => 0.5,
    });

    const task = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new SourceError('SEC', 'TRANSIENT', '502'))
      .mockResolvedValueOnce('복구됨');

    await expect(queue.enqueue(task)).resolves.toBe('복구됨');
    expect(task).toHaveBeenCalledTimes(2);
    expect(h.slept).toEqual([1_000]);
  });

  it('AUTH 는 재시도하지 않는다 — SEC User-Agent 누락은 몇 번을 보내도 403 이다', async () => {
    const h = makeHarness();
    const queue = new RequestQueue({ source: 'SEC', limiter: h.limiter, sleep: h.sleep });

    const task = vi
      .fn<() => Promise<never>>()
      .mockRejectedValue(new SourceError('SEC', 'AUTH', '403'));

    await expect(queue.enqueue(task)).rejects.toThrow(/403/);
    expect(task).toHaveBeenCalledTimes(1);
    expect(h.slept).toEqual([]);
  });

  it('NOT_FOUND 는 재시도하지 않는다 — DART 013 은 다시 물어도 013 이다', async () => {
    const h = makeHarness();
    const queue = new RequestQueue({ source: 'DART', limiter: h.limiter, sleep: h.sleep });

    const task = vi
      .fn<() => Promise<never>>()
      .mockRejectedValue(new SourceError('DART', 'NOT_FOUND', '조회된 데이터가 없습니다'));

    await expect(queue.enqueue(task)).rejects.toThrow();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('QUOTA_EXCEEDED 는 즉시 포기하고 그날 큐 전체를 막는다', async () => {
    const h = makeHarness({ dailyQuota: 1000 });
    const queue = new RequestQueue({ source: 'DART', limiter: h.limiter, sleep: h.sleep });

    const task = vi
      .fn<() => Promise<never>>()
      .mockRejectedValue(new SourceError('DART', 'QUOTA_EXCEEDED', 'status 020'));

    await expect(queue.enqueue(task)).rejects.toThrow(/020/);
    expect(task).toHaveBeenCalledTimes(1);
    expect(h.slept).toEqual([]); // 백오프로 시간 버리지 않는다
    expect(h.limiter.isBlockedToday).toBe(true);

    // 이후 요청은 아예 나가지 않는다
    const next = vi.fn<() => Promise<string>>().mockResolvedValue('나가면 안 됨');
    await expect(queue.enqueue(next)).rejects.toThrow(/일일 호출 한도/);
    expect(next).not.toHaveBeenCalled();
  });

  it('maxAttempts 를 넘기면 마지막 오류를 던진다', async () => {
    const h = makeHarness();
    const queue = new RequestQueue({
      source: 'SEC',
      limiter: h.limiter,
      sleep: h.sleep,
      retry: { maxAttempts: 3 },
      random: () => 0.5,
    });

    const task = vi
      .fn<() => Promise<never>>()
      .mockRejectedValue(new SourceError('SEC', 'TRANSIENT', '503'));

    await expect(queue.enqueue(task)).rejects.toThrow(/503/);
    expect(task).toHaveBeenCalledTimes(3);
    expect(h.slept).toEqual([1_000, 2_000]);
  });

  it('SourceError 가 아닌 예외는 재시도 없이 그대로 올린다', async () => {
    const h = makeHarness();
    const queue = new RequestQueue({ source: 'SEC', limiter: h.limiter, sleep: h.sleep });

    const task = vi
      .fn<() => Promise<never>>()
      .mockRejectedValue(new TypeError('개발자 실수'));

    await expect(queue.enqueue(task)).rejects.toThrow(TypeError);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('Retry-After 를 주면 백오프 대신 그 값을 존중한다', async () => {
    const h = makeHarness();
    const queue = new RequestQueue({
      source: 'SEC',
      limiter: h.limiter,
      sleep: h.sleep,
      random: () => 0.5,
    });

    const task = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(
        new SourceError('SEC', 'RATE_LIMIT', '429', { retryAfterMs: 3_500 }),
      )
      .mockResolvedValueOnce('ok');

    await expect(queue.enqueue(task)).resolves.toBe('ok');
    expect(h.slept).toEqual([3_500]);
  });

  it('재시도할 때마다 토큰을 다시 소비한다 — 재시도도 유량이다', async () => {
    const h = makeHarness({ capacity: 100, refillPerSecond: 100, dailyQuota: 1000 });
    const queue = new RequestQueue({
      source: 'SEC',
      limiter: h.limiter,
      sleep: h.sleep,
      retry: { maxAttempts: 3 },
      random: () => 0.5,
    });

    const task = vi
      .fn<() => Promise<never>>()
      .mockRejectedValue(new SourceError('SEC', 'TRANSIENT', '503'));

    await expect(queue.enqueue(task)).rejects.toThrow();
    expect(h.limiter.quota.used).toBe(3);
  });
});

describe('RequestQueue — pendingCount', () => {
  it('처리 중인 요청 수를 센다', async () => {
    const h = makeHarness();
    const queue = new RequestQueue({ source: 'SEC', limiter: h.limiter, sleep: h.sleep });

    expect(queue.pendingCount).toBe(0);
    const p = queue.enqueue(() => Promise.resolve(1));
    expect(queue.pendingCount).toBe(1);
    await p;
    expect(queue.pendingCount).toBe(0);
  });
});
