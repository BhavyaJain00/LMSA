import { after, before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { unsubscribeToken, findUnsubscribeScope, oneClickUnsubscribeUrl, unsubscribeUrl } from "@/lib/email/signing";
import { applySignedSubscription, decodeReceipt, encodeReceipt, readSignedSubscription } from "@/lib/email/subscriptions";
import { confirmationUrl, oneClickUnsubscribe, signedParams } from "@/lib/email/one-click";
import { confirmUnsubscribeAction, resubscribeWithTokenAction, saveEmailPreferencesAction } from "@/lib/actions/email-preferences";
import { describeEmailHeaders, enqueueEmail, redactForView } from "@/lib/email/outbox";
import { UNSUBSCRIBE_RECEIPT_COOKIE } from "@/lib/email/unsubscribe-cookie";
import { findById } from "@/lib/db/store";
import { captureRedirect, requestCookie, resetRequest } from "./helpers/request";
import { makeUser, resetDb } from "./helpers/db";

/** Review finding: GET of an unsubscribe link must not change preferences; POST does, and Undo persists. */

const ada = makeUser({ id: "usr_ada", email: "ada@example.com", name: "Ada" });

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function announcementsOn(): Promise<boolean | undefined> {
  return (await findById("users", ada.id))?.emailPreferences?.announcements;
}

describe("signed unsubscribe links", () => {
  before(() => {
    mock.method(console, "info", () => undefined);
  });
  after(() => mock.restoreAll());
  beforeEach(async () => {
    resetRequest();
    await resetDb({ users: [ada] });
  });

  const token = unsubscribeToken(ada.id, "announcements");

  it("reading a link (the GET page) never writes", async () => {
    for (let i = 0; i < 3; i++) {
      const state = await readSignedSubscription(ada.id, "announcements", token);
      assert.equal(state?.subscribed, true);
    }
    assert.equal(await announcementsOn(), undefined);
    assert.equal(await readSignedSubscription(ada.id, "announcements", `${token.slice(0, -1)}A`), null);
    assert.equal(await readSignedSubscription(ada.id, "grading", token), null);
  });

  it("confirming unsubscribes, then redirects to a URL without the token and sets a receipt", async () => {
    const target = await captureRedirect(() => confirmUnsubscribeAction(null, form({ u: ada.id, scope: "announcements", t: token })));
    assert.equal(target, "/settings/notifications?confirmed=1");
    assert.ok(!/[?&](t|u|unsubscribe)=/.test(target));
    assert.equal(await announcementsOn(), false);
    const receipt = decodeReceipt(requestCookie(UNSUBSCRIBE_RECEIPT_COOKIE));
    assert.deepEqual(receipt, { userId: ada.id, scope: "announcements", token });
  });

  it("Undo persists (rendering the result page re-applies nothing)", async () => {
    await captureRedirect(() => confirmUnsubscribeAction(null, form({ u: ada.id, scope: "announcements", t: token })));
    await captureRedirect(() => resubscribeWithTokenAction(null, form({ u: ada.id, scope: "announcements", t: token })));
    assert.equal(await announcementsOn(), true);
    // What the result page does on every render:
    const receipt = decodeReceipt(requestCookie(UNSUBSCRIBE_RECEIPT_COOKIE))!;
    const shown = await readSignedSubscription(receipt.userId, receipt.scope, receipt.token);
    assert.equal(shown?.subscribed, true);
    assert.equal(await announcementsOn(), true);
  });

  it("a later preference change is not reverted by opening the link again", async () => {
    await captureRedirect(() => confirmUnsubscribeAction(null, form({ u: ada.id, scope: "announcements", t: token })));
    // The member turns announcements back on (preferences form / Subscribe to all)…
    await applySignedSubscription(ada.id, "announcements", token, true);
    // …and the page with the original link renders again (refresh, revalidation, link scanner).
    for (let i = 0; i < 3; i++) await readSignedSubscription(ada.id, "announcements", token);
    assert.equal(await announcementsOn(), true);
    // Preference actions need a session; the signed link never grants one.
    assert.equal((await saveEmailPreferencesAction(null, form({ announcements: "on" }))).ok, false);
  });

  it("rejects forged links without writing", async () => {
    const result = await confirmUnsubscribeAction(null, form({ u: ada.id, scope: "announcements", t: unsubscribeToken("usr_bob", "announcements") }));
    assert.deepEqual(result, { ok: false, error: "This link is invalid. Open your email preferences to change your subscriptions." });
    assert.equal(await announcementsOn(), undefined);
    assert.equal(decodeReceipt(encodeReceipt({ userId: ada.id, scope: "announcements", token: "x".repeat(43) })), null);
    assert.equal(decodeReceipt("not base64 json"), null);
  });
});

describe("RFC 8058 one-click endpoint", () => {
  before(() => {
    mock.method(console, "info", () => undefined);
  });
  after(() => mock.restoreAll());
  beforeEach(async () => {
    await resetDb({ users: [ada] });
  });

  it("POST with the signed URL unsubscribes; GET only points to the confirmation page", async () => {
    const url = new URL(oneClickUnsubscribeUrl(ada.id, "announcements"));
    assert.equal(url.pathname, "/api/email/unsubscribe");
    const params = signedParams(url.searchParams);
    assert.equal(confirmationUrl(params), unsubscribeUrl(ada.id, "announcements"));
    assert.equal(await announcementsOn(), undefined);
    const result = await oneClickUnsubscribe(params);
    assert.equal(result.status, 200);
    assert.equal(await announcementsOn(), false);
  });

  it("accepts the parameters from a form body and refuses bad signatures", async () => {
    const t = unsubscribeToken(ada.id, "grading");
    const body = new URLSearchParams({ "List-Unsubscribe": "One-Click", unsubscribe: "grading", u: ada.id, t });
    assert.equal((await oneClickUnsubscribe(signedParams(new URLSearchParams(), body))).status, 200);
    assert.equal((await findById("users", ada.id))?.emailPreferences?.grading, false);
    const bad = await oneClickUnsubscribe(signedParams(new URLSearchParams({ unsubscribe: "all", u: ada.id, t })));
    assert.equal(bad.status, 400);
    assert.equal(confirmationUrl({ scope: "all", userId: ada.id, token: t }), "http://localhost:3000/settings/notifications");
  });

  it("sends List-Unsubscribe pointing at the endpoint with List-Unsubscribe-Post", async () => {
    const link = unsubscribeUrl(ada.id, "announcements");
    const message = await enqueueEmail({ to: ada.email, userId: ada.id, subject: "News", html: `<p>Hi <a href="${link.replace(/&/g, "&amp;")}">Unsubscribe</a></p>`, category: "announcement" });
    const headers = new Map(await describeEmailHeaders(message));
    assert.equal(headers.get("List-Unsubscribe"), `<${oneClickUnsubscribeUrl(ada.id, "announcements")}>`);
    assert.equal(headers.get("List-Unsubscribe-Post"), "List-Unsubscribe=One-Click");
    assert.equal(findUnsubscribeScope(message.html, ada.id), "announcements");
  });

  it("hides unsubscribe signatures in admin views", () => {
    const link = unsubscribeUrl(ada.id, "announcements");
    const redacted = redactForView(`<a href="${link.replace(/&/g, "&amp;")}">x</a>`);
    assert.ok(!redacted.includes(unsubscribeToken(ada.id, "announcements")));
    assert.ok(redacted.includes("t=••••••••"));
  });
});
