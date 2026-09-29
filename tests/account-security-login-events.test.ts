import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { LoginEvent } from "@/lib/types";
import { LOGIN_EVENT_LIMITS, getLoginEventsForUser, pruneLoginEvents, recordLoginEvent, shouldRecordLoginEvent } from "@/lib/auth/login-events";
import { getDb } from "@/lib/db/store";
import { makeUser, resetDb } from "./helpers/db";

/**
 * Login history retention is per bucket, so floods of cheap (blocked or
 * anonymous) requests can't wipe an account's history, and repeated blocked
 * attempts are written once per window.
 */

const NOW = Date.parse("2026-06-01T12:00:00Z");
let seq = 0;

function event(overrides: Partial<LoginEvent> & { at: number }): LoginEvent {
  const { at, ...rest } = overrides;
  return { id: `lev_${++seq}`, email: "x@example.com", success: false, reason: "bad_password", createdAt: new Date(at).toISOString(), ...rest };
}

const small = { ...LOGIN_EVENT_LIMITS, perUserSuccess: 3, perUserOther: 4, perEmailAnonymous: 2, anonymousTotal: 5, total: 12 };

describe("pruneLoginEvents", () => {
  it("drops events past the retention period", () => {
    const old = event({ at: NOW - LOGIN_EVENT_LIMITS.retentionMs - 1 });
    const fresh = event({ at: NOW - 1000 });
    assert.deepEqual(pruneLoginEvents([old, fresh], NOW), [fresh]);
  });

  it("failures can't push out an account's successful sign-ins", () => {
    const success = event({ at: NOW - 10_000, userId: "usr_a", success: true, reason: "ok" });
    const failures = Array.from({ length: 50 }, (_, i) => event({ at: NOW - 9_000 + i, userId: "usr_a" }));
    const kept = pruneLoginEvents([success, ...failures], NOW, small);
    assert.ok(kept.includes(success));
    assert.equal(kept.filter((e) => !e.success).length, small.perUserOther);
    // The newest failures are the ones kept.
    assert.deepEqual(kept.filter((e) => !e.success), failures.slice(-small.perUserOther));
  });

  it("anonymous floods never touch account history", () => {
    const history = [event({ at: NOW - 60_000, userId: "usr_a", success: true, reason: "ok" }), event({ at: NOW - 59_000, userId: "usr_a" })];
    const flood = Array.from({ length: 500 }, (_, i) => event({ at: NOW - 50_000 + i, email: `spray${i % 40}@example.com`, reason: "unknown_email" }));
    const kept = pruneLoginEvents([...history, ...flood], NOW, small);
    for (const e of history) assert.ok(kept.includes(e));
    const anonymous = kept.filter((e) => !e.userId);
    assert.equal(anonymous.length, small.anonymousTotal);
    const perEmail = new Map<string, number>();
    for (const e of anonymous) perEmail.set(e.email, (perEmail.get(e.email) ?? 0) + 1);
    assert.ok([...perEmail.values()].every((n) => n <= small.perEmailAnonymous));
  });

  it("past the overall cap, drops anonymous, then failures, then successes (oldest first)", () => {
    const events: LoginEvent[] = [];
    for (let u = 0; u < 5; u++) {
      events.push(event({ at: NOW - 100_000 + u, userId: `usr_${u}`, success: true, reason: "ok" }));
      events.push(event({ at: NOW - 90_000 + u, userId: `usr_${u}` }));
    }
    for (let i = 0; i < 5; i++) events.push(event({ at: NOW - 80_000 + i, email: `anon${i}@example.com`, reason: "unknown_email" }));
    const kept = pruneLoginEvents(events, NOW, { ...small, total: 8 });
    assert.equal(kept.length, 8);
    assert.equal(kept.filter((e) => !e.userId).length, 0);
    assert.equal(kept.filter((e) => e.success).length, 5, "every successful sign-in survives");
  });
});

describe("recording", () => {
  beforeEach(async () => {
    await resetDb({ users: [makeUser({ id: "usr_ev", email: "ev@example.com" })] });
  });

  it("coalesces repeated blocked attempts per subject and reason", async () => {
    for (let i = 0; i < 25; i++) await recordLoginEvent({ reason: "rate_limited", email: "ev@example.com", userId: "usr_ev", ip: "203.0.113.9" });
    for (let i = 0; i < 25; i++) await recordLoginEvent({ reason: "locked", email: "ev@example.com", userId: "usr_ev" });
    await recordLoginEvent({ reason: "ok", email: "ev@example.com", userId: "usr_ev" });
    const events = await getLoginEventsForUser("usr_ev", 100);
    assert.equal(events.filter((e) => e.reason === "rate_limited").length, 1);
    assert.equal(events.filter((e) => e.reason === "locked").length, 1);
    assert.equal(events.filter((e) => e.reason === "ok").length, 1);
  });

  it("writes blocked events again after the window and never coalesces other outcomes", () => {
    const t0 = Date.parse("2026-07-01T00:00:00Z");
    assert.equal(shouldRecordLoginEvent("rate_limited", "window@example.com", t0), true);
    assert.equal(shouldRecordLoginEvent("rate_limited", "WINDOW@example.com", t0 + 1000), false);
    assert.equal(shouldRecordLoginEvent("rate_limited", "window@example.com", t0 + 15 * 60_000 + 1), true);
    for (let i = 0; i < 5; i++) assert.equal(shouldRecordLoginEvent("bad_password", "window@example.com", t0), true);
  });

  it("never stores an untrusted/unknown IP", async () => {
    await recordLoginEvent({ reason: "bad_password", email: "ev@example.com", userId: "usr_ev", ip: "unknown" });
    const db = await getDb();
    assert.equal(db.loginEvents.at(-1)?.ip, undefined);
  });
});
