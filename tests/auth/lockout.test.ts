import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { clearLoginFailures, registerLoginFailure, unlockAccount } from "@/lib/auth/lockout";
import { authRateLimiter } from "@/lib/auth/rate-limit";
import { getLoginThrottleStatus, loginThrottleKey, recordLoginFailure } from "@/lib/auth/login-throttle";
import {
  formatWait,
  hasPendingTwoFactorSetup,
  isAccountLocked,
  isEmailVerified,
  isTwoFactorActive,
  lockRemainingMs,
  maskEmail,
  mustSetUpTwoFactor,
} from "@/lib/auth/account-status";
import { findById } from "@/lib/db/store";
import { makeUser, resetDb } from "../helpers/db";

const security = { maxLoginAttempts: 3, lockoutMinutes: 15 };
const user = makeUser({ id: "usr_lock", email: "lock@example.com" });

describe("account lockout (store)", () => {
  beforeEach(async () => {
    await resetDb({ users: [user] });
  });

  it("counts consecutive failures and locks at the threshold", async () => {
    const t0 = new Date("2026-06-01T08:00:00Z");
    assert.deepEqual(await registerLoginFailure(user.id, security, t0), { locked: false, failures: 1 });
    assert.deepEqual(await registerLoginFailure(user.id, security, t0), { locked: false, failures: 2 });
    const third = await registerLoginFailure(user.id, security, t0);
    assert.equal(third.locked, true);
    assert.equal(third.lockedUntil, new Date(t0.getTime() + 15 * 60_000).toISOString());
    const stored = await findById("users", user.id);
    assert.equal(stored?.lockedUntil, third.lockedUntil);
    assert.equal(isAccountLocked(stored!, t0.getTime() + 60_000), true);
  });

  it("does not extend an active lock", async () => {
    const t0 = new Date("2026-06-01T08:00:00Z");
    for (let i = 0; i < 3; i++) await registerLoginFailure(user.id, security, t0);
    const during = await registerLoginFailure(user.id, security, new Date(t0.getTime() + 5 * 60_000));
    assert.equal(during.locked, true);
    assert.equal(during.lockedUntil, new Date(t0.getTime() + 15 * 60_000).toISOString());
  });

  it("starts over once the lock has expired", async () => {
    const t0 = new Date("2026-06-01T08:00:00Z");
    for (let i = 0; i < 3; i++) await registerLoginFailure(user.id, security, t0);
    const after = await registerLoginFailure(user.id, security, new Date(t0.getTime() + 16 * 60_000));
    assert.deepEqual(after, { locked: false, failures: 1 });
    assert.equal((await findById("users", user.id))?.lockedUntil, undefined);
  });

  it("clears the counter after a successful sign-in", async () => {
    await registerLoginFailure(user.id, security);
    await registerLoginFailure(user.id, security);
    await clearLoginFailures(user.id);
    assert.equal((await findById("users", user.id))?.failedLoginCount, 0);
    assert.deepEqual(await registerLoginFailure(user.id, security), { locked: false, failures: 1 });
  });

  it("treats odd settings safely and ignores unknown users", async () => {
    assert.equal((await registerLoginFailure(user.id, { maxLoginAttempts: 0, lockoutMinutes: 0 })).locked, true);
    assert.deepEqual(await registerLoginFailure("usr_missing", security), { locked: false, failures: 0 });
  });

  it("locks unknown addresses exactly like registered ones", async () => {
    const t0 = new Date("2026-06-01T08:00:00Z");
    for (let i = 0; i < 3; i++) {
      const known = await registerLoginFailure(user.id, security, t0);
      const unknown = await recordLoginFailure("nobody@example.com", security, t0);
      assert.deepEqual({ ...unknown, lockedUntil: undefined }, { ...known, lockedUntil: undefined });
    }
    assert.equal((await getLoginThrottleStatus("NOBODY@example.com ", t0.getTime() + 1_000)).locked, true);
    assert.equal(loginThrottleKey("Nobody@Example.com"), loginThrottleKey("nobody@example.com"));
    assert.ok(!loginThrottleKey("nobody@example.com").includes("nobody"), "stored keys do not reveal the address");
  });

  it("admin unlock clears the lock and the in-memory counters", async () => {
    for (let i = 0; i < 3; i++) await registerLoginFailure(user.id, security);
    const rule = { limit: 1, windowMs: 60_000 };
    authRateLimiter.hit("login:email:lock@example.com", rule);
    authRateLimiter.hit("login:acct:lock@example.com|10.0.0.1", rule);
    authRateLimiter.hit(`2fa:${user.id}|10.0.0.1`, rule);

    const unlocked = await unlockAccount(user.id);
    assert.equal(unlocked?.lockedUntil, undefined);
    assert.equal(unlocked?.failedLoginCount, 0);
    assert.equal(authRateLimiter.check("login:email:lock@example.com", rule).ok, true);
    assert.equal(authRateLimiter.check("login:acct:lock@example.com|10.0.0.1", rule).ok, true);
    assert.equal(authRateLimiter.check(`2fa:${user.id}|10.0.0.1`, rule).ok, true);
    assert.equal((await getLoginThrottleStatus("lock@example.com")).locked, false);
    assert.equal(await unlockAccount("usr_missing"), null);
  });
});

describe("account status helpers", () => {
  it("email verification", () => {
    assert.equal(isEmailVerified({}), true);
    assert.equal(isEmailVerified({ emailVerificationRequired: true }), false);
    assert.equal(isEmailVerified({ emailVerificationRequired: true, emailVerifiedAt: "2026-01-01T00:00:00Z" }), true);
  });

  it("two-step verification states", () => {
    assert.equal(isTwoFactorActive({ twoFactorEnabled: true, twoFactorSecretEnc: "v1.x" }), true);
    assert.equal(isTwoFactorActive({ twoFactorEnabled: true }), false);
    assert.equal(hasPendingTwoFactorSetup({ twoFactorSecretEnc: "v1.x" }), true);
    assert.equal(hasPendingTwoFactorSetup({ twoFactorEnabled: true, twoFactorSecretEnc: "v1.x" }), false);
  });

  it("enforces 2FA for staff only when both settings are on", () => {
    const staff = { roles: ["course_creator" as const] };
    const student = { roles: ["student" as const] };
    const on = { allowTwoFactor: true, enforceTwoFactorForStaff: true };
    assert.equal(mustSetUpTwoFactor(staff, on), true);
    assert.equal(mustSetUpTwoFactor(student, on), false);
    assert.equal(mustSetUpTwoFactor({ ...staff, twoFactorEnabled: true, twoFactorSecretEnc: "v1.x" }, on), false);
    assert.equal(mustSetUpTwoFactor(staff, { allowTwoFactor: false, enforceTwoFactorForStaff: true }), false);
    assert.equal(mustSetUpTwoFactor(staff, { allowTwoFactor: true, enforceTwoFactorForStaff: false }), false);
  });

  it("lock timing", () => {
    const now = Date.parse("2026-06-01T08:00:00Z");
    assert.equal(lockRemainingMs({}, now), 0);
    assert.equal(lockRemainingMs({ lockedUntil: "garbage" }, now), 0);
    assert.equal(lockRemainingMs({ lockedUntil: "2026-06-01T08:05:00Z" }, now), 300_000);
    assert.equal(isAccountLocked({ lockedUntil: "2026-06-01T07:59:59Z" }, now), false);
  });

  it("formats waits and masks emails", () => {
    assert.equal(formatWait(10_000), "a few seconds");
    assert.equal(formatWait(60_000), "1 minute");
    assert.equal(formatWait(14 * 60_000 + 1), "15 minutes");
    assert.equal(formatWait(61 * 60_000), "2 hours");
    assert.equal(maskEmail("ada@example.com"), "ad•••@example.com");
    assert.equal(maskEmail("a@example.com"), "a•••@example.com");
    assert.equal(maskEmail("nodomain"), "n•••");
  });
});
