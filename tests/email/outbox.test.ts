import { after, before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import {
  RETRY_DELAYS_MS,
  deleteEmail,
  deliverDueEmails,
  enqueueEmail,
  enqueueEmails,
  getOutboxCounts,
  isSensitiveCategory,
  pruneOutbox,
  redactForView,
  resendEmail,
  retryDelayMs,
  retryEmail,
} from "@/lib/email/outbox";
import { parseOutboxFilters } from "@/lib/email/admin";
import { findById, mutate } from "@/lib/db/store";
import { makeUser, resetDb } from "../helpers/db";

const ada = makeUser({ id: "usr_ada", email: "ada@example.com", name: "Ada" });

describe("email outbox (store, log transport)", () => {
  before(() => {
    // The log transport prints one line per message; keep the test output clean.
    mock.method(console, "info", () => undefined);
  });
  after(() => mock.restoreAll());
  beforeEach(async () => {
    await resetDb({ users: [ada] });
  });

  it("stores, wraps and delivers a message", async () => {
    const sent = await enqueueEmail(
      { to: " Ada@Example.com ", toName: "Ada\r\nLovelace", userId: ada.id, subject: "Hi\r\nBcc: evil@example.com", html: "<p>Hello <b>Ada</b></p>", category: "notification" },
      { deliverNow: true },
    );
    assert.equal(sent.status, "sent");
    assert.equal(sent.to, "ada@example.com");
    assert.equal(sent.toName, "Ada Lovelace");
    assert.equal(sent.subject, "Hi Bcc: evil@example.com");
    assert.equal(sent.attempts, 1);
    assert.ok(sent.sentAt);
    assert.match(sent.messageId!, /^<[^@]+@learnloop\.test>$/);
    assert.match(sent.html, /<html[\s>]/i);
    assert.ok(sent.text.includes("Hello Ada"));
    assert.equal((await findById("emails", sent.id))?.status, "sent");
  });

  it("fails invalid messages immediately without trying to send them", async () => {
    const bad = await enqueueEmail({ to: "not-an-address", subject: "x", html: "<p>x</p>", category: "notification" }, { deliverNow: true });
    assert.equal(bad.status, "failed");
    assert.match(bad.lastError!, /Invalid recipient address/);
    const empty = await enqueueEmail({ to: "ada@example.com", subject: "", html: "  ", category: "notification" });
    assert.equal(empty.status, "failed");
    assert.equal(empty.subject, "(no subject)");
    assert.match(empty.lastError!, /no content/);
  });

  it("removes one-time links from stored bodies once delivered", async () => {
    const link = "http://localhost:3000/reset-password?token=Zx9_secret-token-value";
    const sent = await enqueueEmail({ to: "ada@example.com", subject: "Reset", html: `<a href="${link}">Reset</a>`, text: `Reset: ${link}`, category: "password_reset" }, { deliverNow: true });
    assert.equal(sent.status, "sent");
    const stored = await findById("emails", sent.id);
    assert.ok(!stored!.html.includes("Zx9_secret"));
    assert.ok(!stored!.text.includes("Zx9_secret"));
    assert.ok(stored!.text.includes("token=[redacted]"));
    assert.equal(isSensitiveCategory("password_reset"), true);
    assert.equal(isSensitiveCategory("notification"), false);
    assert.deepEqual(await resendEmail(sent.id), { ok: false, error: "Password reset and verification emails contain one-time links and can't be resent. Ask the member to request a new link." });
  });

  it("delivers queued messages in a run and reports counts", async () => {
    await enqueueEmails([
      { to: "a@example.com", subject: "A", html: "<p>A</p>", category: "announcement" },
      { to: "b@example.com", subject: "B", html: "<p>B</p>", category: "announcement" },
      { to: "broken", subject: "C", html: "<p>C</p>", category: "announcement" },
    ]);
    const run = await deliverDueEmails(50, { wait: true, force: true });
    const counts = await getOutboxCounts();
    assert.equal(counts.total, 3);
    assert.equal(counts.sent, 2);
    assert.equal(counts.failed, 1);
    assert.equal(counts.queued, 0);
    assert.ok(run.sent <= 2);
  });

  it("supports retry, resend, delete and prune", async () => {
    const sent = await enqueueEmail({ to: "ada@example.com", subject: "Hello", html: "<p>Hi</p>", category: "announcement" }, { deliverNow: true });
    assert.deepEqual(await retryEmail(sent.id), { ok: false, error: "This email was already sent. Use Resend to send a new copy." });
    const copy = await resendEmail(sent.id);
    assert.ok(copy.ok && copy.message && copy.message.id !== sent.id && copy.message.status === "sent");

    await mutate((db) => {
      const row = db.emails.find((e) => e.id === sent.id)!;
      row.sentAt = new Date(Date.now() - 40 * 86_400_000).toISOString();
    });
    assert.equal(await pruneOutbox(30), 1);
    assert.equal(await findById("emails", sent.id), null);
    assert.deepEqual(await deleteEmail(sent.id), { ok: false, error: "This email no longer exists." });
    if (copy.ok && copy.message) assert.deepEqual(await deleteEmail(copy.message.id), { ok: true, message: null });
    assert.equal((await getOutboxCounts()).total, 0);
  });
});

describe("outbox helpers", () => {
  it("backs off between retries", () => {
    assert.deepEqual(RETRY_DELAYS_MS, [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000]);
    assert.equal(retryDelayMs(0), 60_000);
    assert.equal(retryDelayMs(1), 60_000);
    assert.equal(retryDelayMs(3), 1_800_000);
    assert.equal(retryDelayMs(99), 43_200_000);
  });

  it("hides token values in admin views", () => {
    assert.equal(redactForView("https://lms.test/verify-email?token=abc123&next=/x"), "https://lms.test/verify-email?token=••••••••&next=/x");
    assert.equal(redactForView('href="/x?a=1&amp;token=zzz"'), 'href="/x?a=1&amp;token=••••••••"');
  });

  it("parses outbox filters from the query string defensively", () => {
    assert.deepEqual(parseOutboxFilters({ status: "failed", category: "payment", q: "  ada  ", page: "3" }), { status: "failed", category: "payment", q: "ada", page: 3 });
    assert.deepEqual(parseOutboxFilters({ status: "hacked", category: "constructor", page: "-1" }), { status: "all", category: "all", q: "", page: 1 });
    assert.equal(parseOutboxFilters({ category: ["batch", "x"] }).category, "batch");
    assert.equal(parseOutboxFilters({ q: "x".repeat(500) }).q.length, 120);
  });
});
