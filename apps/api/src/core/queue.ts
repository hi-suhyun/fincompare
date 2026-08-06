import type { SourceId } from '@fincompare/shared';
import { SourceError } from './errors.js';
import type { QuotaState, RateLimiter } from './rateLimiter.js';

/**
 * 소스별 직렬 요청 큐 + 지수 백오프.
 *
 * 큐를 소스별로 하나만 두고 직렬 처리한다. 병렬로 쏘면서 유량을 맞추는 것보다
 * 한 줄로 세워 토큰을 기다리는 쪽이 단순하고, 어차피 캐시가 대부분을 흡수한다.
 */

export type Sleep = (ms: number) => Promise<void>;

export const realSleep: Sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export interface RetryPolicy {
  /** 최초 시도를 포함한 총 시도 횟수 */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** 백오프에 곱할 무작위 지터 비율(0~1). 동시 재시도가 겹치는 걸 막는다 */
  jitterRatio: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 4,
  baseDelayMs: 1_000,
  maxDelayMs: 8_000,
  jitterRatio: 0.2,
};

export interface RequestQueueOptions {
  source: SourceId;
  limiter: RateLimiter;
  retry?: Partial<RetryPolicy>;
  sleep?: Sleep;
  /** 0~1 난수. 테스트에서 고정하려고 주입 가능하게 둔다 */
  random?: () => number;
}

/** 시도 횟수에 따른 대기 시간. 지터 포함 */
export function backoffDelayMs(attempt: number, policy: RetryPolicy, random: () => number): number {
  const exponential = policy.baseDelayMs * 2 ** (attempt - 1);
  const capped = Math.min(exponential, policy.maxDelayMs);
  const jitter = capped * policy.jitterRatio * (random() * 2 - 1);
  return Math.max(0, Math.round(capped + jitter));
}

export class RequestQueue {
  readonly source: SourceId;
  readonly limiter: RateLimiter;

  private readonly policy: RetryPolicy;
  private readonly sleep: Sleep;
  private readonly random: () => number;
  /** 직렬 처리를 위한 꼬리 프로미스 */
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;

  constructor(options: RequestQueueOptions) {
    this.source = options.source;
    this.limiter = options.limiter;
    this.policy = { ...DEFAULT_RETRY_POLICY, ...options.retry };
    this.sleep = options.sleep ?? realSleep;
    this.random = options.random ?? Math.random;
  }

  get pendingCount(): number {
    return this.pending;
  }

  /**
   * 요청을 큐에 넣는다. 토큰을 기다린 뒤 실행하고, 재시도 가능한 오류면 백오프 후 재시도한다.
   *
   * `task` 는 반드시 SourceError 를 던져야 분류가 동작한다.
   * 그 외 예외는 재시도 없이 그대로 올린다 — 정체를 모르는 오류를 재시도하면
   * 같은 실패를 반복하면서 한도만 먹는다.
   */
  enqueue<T>(task: () => Promise<T>): Promise<T> {
    this.pending += 1;
    const run = this.tail.then(
      () => this.runWithRetry(task),
      () => this.runWithRetry(task),
    );
    // tail 은 실패를 전파하지 않아야 다음 작업이 이어진다
    this.tail = run.catch(() => undefined);
    return run.finally(() => {
      this.pending -= 1;
    });
  }

  private async runWithRetry<T>(task: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.policy.maxAttempts; attempt++) {
      await this.waitForToken();
      this.limiter.consume();

      try {
        return await task();
      } catch (error) {
        lastError = error;

        if (!(error instanceof SourceError)) throw error;

        // 일일 한도 소진은 오늘 안에는 절대 풀리지 않는다.
        // 백오프로 기다려봐야 시간만 버리므로 즉시 포기하고 큐 전체를 막는다.
        if (error.kind === 'QUOTA_EXCEEDED') {
          this.limiter.markQuotaExhausted();
          throw error;
        }

        if (!error.retryable || attempt === this.policy.maxAttempts) throw error;

        // 소스가 Retry-After 로 알려줬으면 그 값을 존중한다
        const delay =
          error.retryAfterMs ?? backoffDelayMs(attempt, this.policy, this.random);
        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  private async waitForToken(): Promise<void> {
    for (;;) {
      const delay = this.limiter.nextDelayMs();

      if (delay === null) {
        throw new SourceError(
          this.source,
          'QUOTA_EXCEEDED',
          `${this.source} 일일 호출 한도를 모두 사용했습니다. ` +
            `약 ${Math.ceil(this.limiter.msUntilQuotaReset() / 60_000)}분 뒤 초기화됩니다.`,
        );
      }

      if (delay === 0) return;
      await this.sleep(delay);
    }
  }
}

/** 소스별 큐를 한 곳에서 관리한다 */
export class QueueRegistry {
  private readonly queues = new Map<SourceId, RequestQueue>();

  register(queue: RequestQueue): void {
    this.queues.set(queue.source, queue);
  }

  get(source: SourceId): RequestQueue {
    const queue = this.queues.get(source);
    if (!queue) throw new Error(`등록되지 않은 소스: ${source}`);
    return queue;
  }

  /** 관리 화면·헬스체크용 스냅샷 */
  snapshot(): Partial<Record<SourceId, { pending: number; quota: QuotaState }>> {
    const out: Partial<Record<SourceId, { pending: number; quota: QuotaState }>> = {};
    for (const [source, queue] of this.queues) {
      out[source] = { pending: queue.pendingCount, quota: queue.limiter.quota };
    }
    return out;
  }
}
