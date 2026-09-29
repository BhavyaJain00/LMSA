import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { CONSENT_COOKIE, parseConsentValue, serializeConsent } from "@/lib/legal/consent-shared";
import { readConsentCookie } from "@/lib/legal/consent";
import { audit, buildAuditEvent, sanitizeAuditMeta } from "@/lib/audit";
import { getDb } from "@/lib/db/store";
import { resetDb } from "./helpers/db";
import { resetRequest } from "./helpers/request";

/** Round 3 wave A foundation: the consent cookie format and the audit log writer. */

describe("consent cookie", () => {
  it("round-trips a decision", () => {
    for (const analytics of [true, false]) {
      for (const marketing of [true, false]) {
        assert.deepEqual(parseConsentValue(serializeConsent({ analytics, marketing })), { analytics, marketing, decided: true });
      }
    }
  });

  it("stores compact JSON {a,m}", () => {
    assert.equal(decodeURIComponent(serializeConsent({ analytics: true, marketing: false })), '{"a":1,"m":0}');
    assert.deepEqual(parseConsentValue('{"a":0,"m":1}'), { analytics: false, marketing: true, decided: true }, "unencoded values are accepted");
  });

  it("treats missing or malformed values as undecided (no optional cookies)", () => {
    const undecided = { analytics: false, marketing: false, decided: false };
    for (const raw of [undefined, null, "", "yes", "%E0%A4%A", "[]", "null", '{"a":1}', '{"a":true,"m":true}', '{"a":2,"m":1}', `{"a":1,"m":1,"x":"${"y".repeat(300)}"}`]) {
      assert.deepEqual(parseConsentValue(raw), undecided, String(raw));
    }
  });

  it("returns a fresh object each time (callers may mutate it)", () => {
    const a = parseConsentValue(null);
    a.analytics = true;
    assert.equal(parseConsentValue(null).analytics, false);
  });

  it("is read from the request on the server", async () => {
    resetRequest({ cookies: { [CONSENT_COOKIE]: serializeConsent({ analytics: true, marketing: false }) } });
    assert.deepEqual(await readConsentCookie(), { analytics: true, marketing: false, decided: true });
    resetRequest();
    assert.deepEqual(await readConsentCookie(), { analytics: false, marketing: false, decided: false });
  });
});

describe("audit log", () => {
  beforeEach(async () => {
    await resetDb();
    resetRequest();
  });

  it("builds bounded, clean events", () => {
    const event = buildAuditEvent(
      { id: "usr_admin" },
      "  settings.update\n",
      { type: "settings", id: "seo" },
      { group: "seo", count: 3, ok: true, none: null, nan: Number.NaN, long: "x".repeat(2000), nested: { a: 1 } as unknown as string },
      "203.0.113.7",
      new Date("2026-05-01T00:00:00.000Z"),
    );
    assert.match(event.id, /^aud/);
    assert.equal(event.action, "settings.update");
    assert.equal(event.actorId, "usr_admin");
    assert.equal(event.targetType, "settings");
    assert.equal(event.targetId, "seo");
    assert.equal(event.ip, "203.0.113.7");
    assert.equal(event.createdAt, "2026-05-01T00:00:00.000Z");
    assert.equal(event.meta?.group, "seo");
    assert.equal(event.meta?.count, 3);
    assert.equal(event.meta?.ok, true);
    assert.equal(event.meta?.none, null);
    assert.equal(event.meta?.nan, null);
    assert.ok(String(event.meta?.long).length <= 500);
    assert.ok(!("nested" in (event.meta ?? {})), "objects are dropped");
  });

  it("omits unknown IPs, anonymous actors and empty meta", () => {
    const event = buildAuditEvent(null, "system.purge", undefined, {}, "unknown");
    assert.equal(event.actorId, undefined);
    assert.equal(event.ip, undefined);
    assert.equal(event.meta, undefined);
    assert.equal(event.targetType, undefined);
    assert.equal(buildAuditEvent(null, "   ", undefined, undefined, undefined).action, "unknown");
  });

  it("caps the number of meta keys and ignores prototype keys", () => {
    const meta = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, i]));
    assert.equal(Object.keys(sanitizeAuditMeta(meta) ?? {}).length, 30);
    const tricky = JSON.parse('{"__proto__":"x","constructor":"y","ok":1}') as Record<string, number>;
    assert.deepEqual(sanitizeAuditMeta(tricky), { ok: 1 });
  });

  it("records events in the store with the trusted client IP", async () => {
    const previous = process.env.TRUST_PROXY_HOPS;
    process.env.TRUST_PROXY_HOPS = "1";
    try {
      resetRequest({ headers: { "x-forwarded-for": "6.6.6.6, 198.51.100.4" } });
      await audit({ id: "usr_admin" }, "course.publish", { type: "course", id: "crs_js" }, { title: "Modern JavaScript" });
    } finally {
      if (previous === undefined) delete process.env.TRUST_PROXY_HOPS;
      else process.env.TRUST_PROXY_HOPS = previous;
    }
    const db = await getDb();
    assert.equal(db.auditEvents.length, 1);
    const [event] = db.auditEvents;
    assert.equal(event?.action, "course.publish");
    assert.equal(event?.targetId, "crs_js");
    assert.equal(event?.ip, "198.51.100.4", "the proxy-appended entry, never the spoofable left one");
    assert.deepEqual(event?.meta, { title: "Modern JavaScript" });
  });

  it("never throws, even when the store rejects the write", async () => {
    const db = await getDb();
    const original = db.auditEvents;
    // Simulate a broken collection: push throws.
    Object.defineProperty(db, "auditEvents", {
      configurable: true,
      get: () => ({ push: () => { throw new Error("disk full"); } }),
    });
    const errors: unknown[] = [];
    const consoleError = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);
    try {
      await assert.doesNotReject(audit({ id: "usr_admin" }, "user.delete"));
    } finally {
      console.error = consoleError;
      Object.defineProperty(db, "auditEvents", { configurable: true, writable: true, enumerable: true, value: original });
    }
    assert.equal(errors.length, 1, "the failure is logged");
  });
});
