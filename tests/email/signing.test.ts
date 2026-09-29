import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cronKey,
  cronUrl,
  findUnsubscribeLink,
  isUnsubscribeScope,
  preferencesUrl,
  unsubscribeToken,
  unsubscribeUrl,
  verifyCronKey,
  verifyUnsubscribeToken,
} from "@/lib/email/signing";
import {
  EMAIL_PREFERENCE_KEYS,
  SENSITIVE_EMAIL_CATEGORIES,
  defaultEmailPreferences,
  emailCategoryForNotification,
  isEmailCategory,
  isEmailPreferenceKey,
  isNotificationType,
  preferenceForNotification,
  preferenceLabel,
  resolveEmailPreferences,
} from "@/lib/email/preferences";

const flip = (token: string) => `${token[0] === "A" ? "B" : "A"}${token.slice(1)}`;

describe("unsubscribe links", () => {
  it("signs (user, category) pairs", () => {
    const token = unsubscribeToken("usr_ada", "grading");
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(unsubscribeToken("usr_ada", "grading"), token);
    assert.notEqual(unsubscribeToken("usr_ada", "payments"), token);
    assert.notEqual(unsubscribeToken("usr_bob", "grading"), token);
    assert.notEqual(unsubscribeToken("usr_ada", "all"), token);
  });

  it("verifies only the matching user, category and token", () => {
    const token = unsubscribeToken("usr_ada", "grading");
    assert.equal(verifyUnsubscribeToken("usr_ada", "grading", token), true);
    assert.equal(verifyUnsubscribeToken("usr_ada", "all", unsubscribeToken("usr_ada", "all")), true);
    assert.equal(verifyUnsubscribeToken("usr_bob", "grading", token), false);
    assert.equal(verifyUnsubscribeToken("usr_ada", "payments", token), false);
    assert.equal(verifyUnsubscribeToken("usr_ada", "grading", flip(token)), false);
    assert.equal(verifyUnsubscribeToken("usr_ada", "grading", `${token}=`), false);
    assert.equal(verifyUnsubscribeToken("usr_ada", "grading", ""), false);
    assert.equal(verifyUnsubscribeToken("usr_ada", "grading", null), false);
    assert.equal(verifyUnsubscribeToken(null, "grading", token), false);
    assert.equal(verifyUnsubscribeToken("usr_ada", "admin", token), false);
    assert.equal(verifyUnsubscribeToken("x".repeat(101), "grading", unsubscribeToken("x".repeat(101), "grading")), false);
  });

  it("builds one-click links that verify", () => {
    const url = new URL(unsubscribeUrl("usr_ada", "announcements"));
    assert.equal(`${url.origin}${url.pathname}`, "http://localhost:3000/settings/notifications");
    assert.equal(url.searchParams.get("unsubscribe"), "announcements");
    assert.equal(url.searchParams.get("u"), "usr_ada");
    assert.equal(verifyUnsubscribeToken(url.searchParams.get("u"), url.searchParams.get("unsubscribe"), url.searchParams.get("t")), true);
    assert.equal(preferencesUrl(), "http://localhost:3000/settings/notifications");
  });

  it("finds a valid link for the recipient inside a rendered body", () => {
    const link = unsubscribeUrl("usr_ada", "grading");
    const html = `<p>Hi</p><a href="${link.replace(/&/g, "&amp;")}">Unsubscribe</a>`;
    assert.equal(findUnsubscribeLink(html, "usr_ada"), link);
    assert.equal(findUnsubscribeLink(`Unsubscribe: ${link}`, "usr_ada"), link);
    assert.equal(findUnsubscribeLink(html, "usr_bob"), null);
    const forged = link.replace(/t=([^&]+)$/, (_m, t: string) => `t=${flip(t)}`);
    assert.equal(findUnsubscribeLink(forged, "usr_ada"), null);
    assert.equal(findUnsubscribeLink("no links here", "usr_ada"), null);
  });

  it("recognises scopes", () => {
    assert.equal(isUnsubscribeScope("all"), true);
    for (const key of EMAIL_PREFERENCE_KEYS) assert.equal(isUnsubscribeScope(key), true);
    assert.equal(isUnsubscribeScope("admin"), false);
    assert.equal(isUnsubscribeScope(1), false);
  });
});

describe("cron key", () => {
  it("is stable, verifiable and separate from other signatures", () => {
    const key = cronKey();
    assert.match(key, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(cronKey(), key);
    assert.equal(verifyCronKey(key), true);
    assert.equal(verifyCronKey(` ${key} `), true);
    assert.equal(verifyCronKey(flip(key)), false);
    assert.equal(verifyCronKey(unsubscribeToken("deliver", "all")), false);
    assert.equal(verifyCronKey(undefined), false);
    assert.equal(cronUrl(), `http://localhost:3000/api/cron/emails?key=${key}`);
  });
});

describe("email preferences", () => {
  it("defaults every category on and merges stored choices", () => {
    assert.ok(Object.values(defaultEmailPreferences()).every(Boolean));
    assert.deepEqual(resolveEmailPreferences(null), defaultEmailPreferences());
    const stored = resolveEmailPreferences({ emailPreferences: { ...defaultEmailPreferences(), grading: false, payments: "no" as unknown as boolean } });
    assert.equal(stored.grading, false);
    assert.equal(stored.payments, true);
  });

  it("maps notifications to preference and outbox categories", () => {
    assert.equal(preferenceForNotification({ type: "quiz_graded" }), "grading");
    assert.equal(preferenceForNotification({ type: "badge" }), "certificates");
    assert.equal(preferenceForNotification({ type: "system" }), "reminders");
    assert.equal(preferenceForNotification({ type: "system", dedupeKey: "payment-reminder:pay_1:2026-01-01" }), "payments");
    assert.equal(preferenceForNotification({ type: "system", link: "/billing/success/ORD-1" }), "payments");
    assert.equal(preferenceForNotification({ type: "system", dedupeKey: "live-class-reminder:lc_1" }), "liveClasses");
    assert.equal(emailCategoryForNotification({ type: "system", link: "/billing/x" }), "payment");
    assert.equal(emailCategoryForNotification({ type: "system", dedupeKey: "drip:les_1" }), "reminder");
    assert.equal(emailCategoryForNotification({ type: "announcement" }), "announcement");
    assert.equal(emailCategoryForNotification({ type: "reply" }), "notification");
  });

  it("validates keys, types and categories", () => {
    assert.equal(isEmailPreferenceKey("grading"), true);
    assert.equal(isEmailPreferenceKey("toString"), false);
    assert.equal(isNotificationType("mention"), true);
    assert.equal(isNotificationType("hack"), false);
    assert.equal(isEmailCategory("password_reset"), true);
    assert.equal(isEmailCategory("constructor"), false);
    assert.deepEqual(SENSITIVE_EMAIL_CATEGORIES, ["password_reset", "email_verification"]);
    assert.equal(preferenceLabel("all"), "all optional emails");
    assert.equal(preferenceLabel("liveClasses"), "Live classes");
  });
});
