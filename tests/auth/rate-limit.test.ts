import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FailureLockout, RATE_LIMITS, SlidingWindowRateLimiter, emailKey } from "@/lib/auth/rate-limit";

const rule = { limit: 3, windowMs: 60_000 };

describe("SlidingWindowRateLimiter", () => {
  it("allows `limit` attempts per window and counts down `remaining`", () => {
    const limiter = new SlidingWindowRateLimiter();
    const t0 = 1_000_000;
    assert.deepEqual(limiter.hit("k", rule, t0), { ok: true, limit: 3, remaining: 2, retryAfterMs: 0 });
    assert.equal(limiter.hit("k", rule, t0 + 1_000).remaining, 1);
    assert.equal(limiter.hit("k", rule, t0 + 2_000).remaining, 0);
    const blocked = limiter.hit("k", rule, t0 + 3_000);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.remaining, 0);
    // The oldest counted attempt (t0) frees a slot at t0 + window.
    assert.equal(blocked.retryAfterMs, 57_000);
  });

  it("slides: a slot frees exactly when the oldest attempt leaves the window", () => {
    const limiter = new SlidingWindowRateLimiter();
    const t0 = 5_000_000;
    for (let i = 0; i < 3; i++) limiter.hit("k", rule, t0 + i * 10_000);
    assert.equal(limiter.hit("k", rule, t0 + 59_999).ok, false);
    assert.equal(limiter.hit("k", rule, t0 + 60_000).ok, true);
    // Now attempts at +10s, +20s and +60s count: the next slot frees at +70s.
    const blocked = limiter.hit("k", rule, t0 + 61_000);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.retryAfterMs, 9_000);
  });

  it("does not record rejected attempts (no lock-in while hammering)", () => {
    const limiter = new SlidingWindowRateLimiter();
    const t0 = 10_000_000;
    for (let i = 0; i < 3; i++) limiter.hit("k", rule, t0);
    for (let i = 1; i <= 50; i++) assert.equal(limiter.hit("k", rule, t0 + i * 1000).ok, false);
    assert.equal(limiter.hit("k", rule, t0 + 60_000).ok, true);
  });

  it("check() reports without recording", () => {
    const limiter = new SlidingWindowRateLimiter();
    for (let i = 0; i < 5; i++) assert.equal(limiter.check("k", rule, 1_000).ok, true);
    limiter.hit("k", rule, 1_000);
    assert.equal(limiter.check("k", rule, 1_000).remaining, 2);
  });

  it("keeps keys independent and supports reset / resetPrefix", () => {
    const limiter = new SlidingWindowRateLimiter();
    for (const key of ["login:acct:a@x.com|1.1.1.1", "login:acct:a@x.com|2.2.2.2", "login:acct:b@x.com|1.1.1.1"]) {
      for (let i = 0; i < 3; i++) limiter.hit(key, rule, 100);
    }
    assert.equal(limiter.hit("login:acct:a@x.com|1.1.1.1", rule, 200).ok, false);
    assert.equal(limiter.resetPrefix("login:acct:a@x.com|"), 2);
    assert.equal(limiter.hit("login:acct:a@x.com|1.1.1.1", rule, 200).ok, true);
    assert.equal(limiter.hit("login:acct:b@x.com|1.1.1.1", rule, 200).ok, false);
    limiter.reset("login:acct:b@x.com|1.1.1.1");
    assert.equal(limiter.hit("login:acct:b@x.com|1.1.1.1", rule, 200).ok, true);
  });

  it("bounds memory: evicts the least recently used key past maxKeys", () => {
    const limiter = new SlidingWindowRateLimiter({ maxKeys: 3 });
    for (const key of ["a", "b", "c", "d"]) limiter.hit(key, rule, 1_000);
    assert.equal(limiter.size, 3);
    // "a" was evicted, so it starts over; "d" is still tracked.
    for (let i = 0; i < 2; i++) limiter.hit("d", rule, 1_000);
    assert.equal(limiter.hit("d", rule, 1_000).ok, false);
  });

  it("sweep() drops keys whose attempts expired", () => {
    const limiter = new SlidingWindowRateLimiter();
    limiter.hit("old", rule, 0);
    limiter.hit("new", rule, 100_000);
    limiter.sweep(100_000);
    assert.equal(limiter.size, 1);
  });
});

describe("FailureLockout", () => {
  it("locks a key after maxFailures and unlocks after lockMs", () => {
    const lockout = new FailureLockout();
    const t0 = 50_000;
    assert.deepEqual(lockout.fail("k", 3, 60_000, t0), { locked: false, failures: 1, lockedUntil: null });
    assert.equal(lockout.fail("k", 3, 60_000, t0 + 1).failures, 2);
    const locked = lockout.fail("k", 3, 60_000, t0 + 2);
    assert.equal(locked.locked, true);
    assert.equal(locked.lockedUntil, t0 + 2 + 60_000);
    assert.equal(lockout.status("k", t0 + 30_000).locked, true);
    assert.equal(lockout.status("k", t0 + 2 + 60_000).locked, false);
  });

  it("does not extend a lock while it is active", () => {
    const lockout = new FailureLockout();
    lockout.fail("k", 1, 10_000, 0);
    const again = lockout.fail("k", 1, 10_000, 5_000);
    assert.equal(again.locked, true);
    assert.equal(again.lockedUntil, 10_000);
  });

  it("starts counting again after the lock ends", () => {
    const lockout = new FailureLockout();
    lockout.fail("k", 2, 10_000, 0);
    lockout.fail("k", 2, 10_000, 1);
    assert.deepEqual(lockout.fail("k", 2, 10_000, 20_000), { locked: false, failures: 1, lockedUntil: null });
  });

  it("forgets failures after the memory period", () => {
    const lockout = new FailureLockout({ memoryMs: 1_000 });
    lockout.fail("k", 5, 500, 0);
    assert.equal(lockout.status("k", 999).failures, 1);
    assert.deepEqual(lockout.status("k", 1_000), { locked: false, failures: 0, lockedUntil: null });
    assert.equal(lockout.size, 0);
  });

  it("clear() resets a key and maxKeys bounds memory", () => {
    const lockout = new FailureLockout({ maxKeys: 2 });
    lockout.fail("a", 1, 10_000, 0);
    lockout.clear("a");
    assert.equal(lockout.status("a", 1).locked, false);
    for (const key of ["x", "y", "z"]) lockout.fail(key, 5, 10_000, 0);
    assert.equal(lockout.size, 2);
    assert.equal(lockout.status("x", 1).failures, 0);
  });
});

describe("shared rules", () => {
  it("normalises email keys", () => {
    assert.equal(emailKey("  Ada@Example.COM "), "ada@example.com");
  });

  it("defines sane limits", () => {
    for (const [name, r] of Object.entries(RATE_LIMITS)) {
      assert.ok(Number.isInteger(r.limit) && r.limit > 0, name);
      assert.ok(r.windowMs >= 60_000, name);
    }
    assert.ok(RATE_LIMITS.loginAccount.limit <= RATE_LIMITS.loginIp.limit);
  });
});
