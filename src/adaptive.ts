export type AdaptiveEvent =
  | { kind: "reduced"; concurrency: number; cooldownMs: number }
  | { kind: "recovered"; concurrency: number };

export type AdaptiveSnapshot = {
  enabled: boolean;
  requestedConcurrency: number;
  finalConcurrency: number;
  reductions: number;
  recoveries: number;
};

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function isThrottleError(message: string): boolean {
  return /\((?:408|425|429|500|502|503|504)\)|timed out|aborted/i.test(message);
}

/** Coordinates batch starts and adapts to server-side rate-limit signals. */
export class AdaptiveLimiter {
  private active = 0;
  private limit: number;
  private nextStartAt = 0;
  private cooldownUntil = 0;
  private cooldownMs = 0;
  private successfulSinceAdjustment = 0;
  private reductions = 0;
  private recoveries = 0;

  constructor(
    private readonly requestedConcurrency: number,
    private readonly minimumDelayMs: number,
    private readonly enabled: boolean
  ) {
    this.limit = requestedConcurrency;
  }

  async acquire(): Promise<void> {
    while (true) {
      const now = Date.now();
      const nextAllowedAt = Math.max(this.nextStartAt, this.cooldownUntil);
      if (this.active < this.limit && now >= nextAllowedAt) {
        this.active += 1;
        this.nextStartAt = now + this.minimumDelayMs;
        return;
      }
      const waitForStart = Math.max(0, nextAllowedAt - now);
      await sleep(Math.max(25, Math.min(waitForStart || 100, 250)));
    }
  }

  release(): void {
    this.active -= 1;
  }

  succeeded(): AdaptiveEvent | undefined {
    if (!this.enabled || this.limit >= this.requestedConcurrency) return undefined;
    this.successfulSinceAdjustment += 1;
    if (this.successfulSinceAdjustment < Math.max(3, this.limit * 2)) return undefined;
    this.limit += 1;
    this.recoveries += 1;
    this.successfulSinceAdjustment = 0;
    this.cooldownMs = this.minimumDelayMs;
    return { kind: "recovered", concurrency: this.limit };
  }

  failed(message: string): AdaptiveEvent | undefined {
    if (!this.enabled || !isThrottleError(message)) return undefined;
    this.successfulSinceAdjustment = 0;
    this.cooldownMs = Math.min(60_000, Math.max(1_000, this.minimumDelayMs * 2, this.cooldownMs * 2));
    this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + this.cooldownMs);
    if (this.limit > 1) {
      this.limit -= 1;
      this.reductions += 1;
    }
    return { kind: "reduced", concurrency: this.limit, cooldownMs: this.cooldownMs };
  }

  snapshot(): AdaptiveSnapshot {
    return {
      enabled: this.enabled,
      requestedConcurrency: this.requestedConcurrency,
      finalConcurrency: this.limit,
      reductions: this.reductions,
      recoveries: this.recoveries
    };
  }
}
