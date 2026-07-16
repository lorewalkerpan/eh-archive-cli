import assert from "node:assert/strict";
import test from "node:test";
import { AdaptiveLimiter, isThrottleError } from "../src/adaptive.js";

test("recognizes rate limiting and timeout failures", () => {
  assert.equal(isThrottleError("ZIP download failed (429)."), true);
  assert.equal(isThrottleError("ZIP download failed (503)."), true);
  assert.equal(isThrottleError("The operation was aborted."), true);
  assert.equal(isThrottleError("Gallery URLs must use e-hentai.org."), false);
});

test("reduces concurrency on throttling and restores it after stable successes", () => {
  const limiter = new AdaptiveLimiter(3, 1, true);
  assert.deepEqual(limiter.failed("ZIP download failed (429)."), { kind: "reduced", concurrency: 2, cooldownMs: 1000 });
  assert.equal(limiter.succeeded(), undefined);
  assert.equal(limiter.succeeded(), undefined);
  assert.equal(limiter.succeeded(), undefined);
  assert.deepEqual(limiter.succeeded(), { kind: "recovered", concurrency: 3 });
  assert.deepEqual(limiter.snapshot(), {
    enabled: true,
    requestedConcurrency: 3,
    finalConcurrency: 3,
    reductions: 1,
    recoveries: 1
  });
});
