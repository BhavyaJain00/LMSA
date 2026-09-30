import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { API_KEY_RATE_LIMIT, FixedWindowLimiter, rateLimitHeaders } from "@/lib/api/rate-limit";

const rule = { limit: 3, windowMs: 60_000 };
const T0 = 1_700_000_040_000; // 40 s into a minute window

describe("FixedWindowLimiter", () => {
  it("allows `limit` requests per window and counts down remaining", () => {
    const limiter = new FixedWindowLimiter();
    const results = [0, 1, 2].map((i) => limiter.hit("k", rule, T0 + i));
    assert.deepEqual(
      results.map((r) => [r.ok, r.remaining]),
      [
        [true, 2],
        [true, 1],
        [true, 0],
      ],
    );
    const blocked = limiter.hit("k", rule, T0 + 10);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.remaining, 0);
  });

  it("reports the window end and a whole-second Retry-After", () => {
    const limiter = new FixedWindowLimiter();
    for (let i = 0; i < 3; i++) limiter.hit("k", rule, T0);
    const blocked = limiter.hit("k", rule, T0 + 500);
    const windowStart = T0 - (T0 % rule.windowMs);
    assert.equal(blocked.resetAt, windowStart + rule.windowMs);
    assert.equal(blocked.retryAfterSeconds, Math.ceil((windowStart + rule.windowMs - (T0 + 500)) / 1000));
  });

  it("starts a fresh window after the reset time", () => {
    const limiter = new FixedWindowLimiter();
    for (let i = 0; i < 4; i++) limiter.hit("k", rule, T0);
    const next = limiter.hit("k", rule, T0 + rule.windowMs);
    assert.equal(next.ok, true);
    assert.equal(next.remaining, 2);
  });

  it("keeps separate counters per key", () => {
    const limiter = new FixedWindowLimiter();
    for (let i = 0; i < 3; i++) limiter.hit("a", rule, T0);
    assert.equal(limiter.hit("a", rule, T0).ok, false);
    assert.equal(limiter.hit("b", rule, T0).ok, true);
  });

  it("does not count rejected requests", () => {
    const limiter = new FixedWindowLimiter();
    for (let i = 0; i < 10; i++) limiter.hit("k", rule, T0);
    // Still exactly `limit` counted: the next window is fully available.
    const fresh = limiter.hit("k", rule, T0 + rule.windowMs);
    assert.equal(fresh.remaining, rule.limit - 1);
  });

  it("stays bounded in memory", () => {
    const limiter = new FixedWindowLimiter({ maxKeys: 5 });
    for (let i = 0; i < 50; i++) limiter.hit(`key-${i}`, rule, T0);
    assert.ok(limiter.size <= 5);
  });

  it("uses 120 requests per minute per key by default", () => {
    assert.deepEqual(API_KEY_RATE_LIMIT, { limit: 120, windowMs: 60_000 });
  });
});

describe("rateLimitHeaders", () => {
  it("sends X-RateLimit-* on success", () => {
    const headers = rateLimitHeaders({ ok: true, limit: 120, remaining: 119, resetAt: 1_700_000_060_000, retryAfterSeconds: 0 });
    assert.deepEqual(headers, { "X-RateLimit-Limit": "120", "X-RateLimit-Remaining": "119", "X-RateLimit-Reset": "1700000060" });
  });

  it("adds Retry-After when refused", () => {
    const headers = rateLimitHeaders({ ok: false, limit: 120, remaining: 0, resetAt: 1_700_000_060_000, retryAfterSeconds: 17 });
    assert.equal(headers["Retry-After"], "17");
    assert.equal(headers["X-RateLimit-Remaining"], "0");
  });
});
