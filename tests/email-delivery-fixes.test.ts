import { after, before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import {
  LINK_EXPIRED_ERROR,
  MAX_ATTEMPTS,
  RETRY_DELAYS_MS,
  deliverDueEmails,
  enqueueEmail,
  getDeliveryState,
  isLinkExpired,
  linkExpiresAt,
  retryDelayMs,
  retryEmail,
} from "@/lib/email/outbox";
import { getTransportStatus, oneTimeLinks, smtpClientOptions, smtpTlsRequired } from "@/lib/email/transport";
import { buildMimeMessage } from "@/lib/email/mime";
import { mailEnv } from "@/lib/server-env";
import { AUTH_TOKEN_TTL_MS } from "@/lib/auth/tokens";
import { findById, getSettings, mutate } from "@/lib/db/store";
import { makeUser, resetDb } from "./helpers/db";

const ada = makeUser({ id: "usr_ada", email: "ada@example.com", name: "Ada" });
const RESET_LINK = "http://localhost:3000/reset-password?token=AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde";

describe("retry schedule", () => {
  it("uses every backoff step, including 12 h, before failing", () => {
    assert.equal(MAX_ATTEMPTS, RETRY_DELAYS_MS.length + 1);
    const waits = Array.from({ length: MAX_ATTEMPTS - 1 }, (_, i) => retryDelayMs(i + 1));
    assert.deepEqual(waits, RETRY_DELAYS_MS);
    assert.equal(waits.at(-1), 12 * 3_600_000);
  });
});

describe("one-time links", () => {
  let infos: string[] = [];
  before(() => {
    mock.method(console, "info", (line: string) => {
      infos.push(String(line));
    });
  });
  after(() => mock.restoreAll());
  beforeEach(async () => {
    infos = [];
    await resetDb({ users: [ada] });
  });

  it("knows when a reset or verification link expires", () => {
    const createdAt = "2026-01-01T00:00:00.000Z";
    assert.equal(linkExpiresAt({ category: "password_reset", createdAt }), Date.parse(createdAt) + AUTH_TOKEN_TTL_MS.password_reset);
    assert.equal(linkExpiresAt({ category: "email_verification", createdAt }), Date.parse(createdAt) + AUTH_TOKEN_TTL_MS.email_verification);
    assert.equal(linkExpiresAt({ category: "announcement", createdAt }), null);
    assert.equal(isLinkExpired({ category: "password_reset", createdAt }, Date.parse(createdAt) + 59 * 60_000), false);
    assert.equal(isLinkExpired({ category: "password_reset", createdAt }, Date.parse(createdAt) + 60 * 60_000), true);
  });

  it("fails expired links instead of delivering them, and scrubs the token", async () => {
    const queued = await enqueueEmail({ to: ada.email, userId: ada.id, subject: "Reset", html: `<a href="${RESET_LINK}">Reset</a>`, text: `Reset: ${RESET_LINK}`, category: "password_reset" });
    await mutate((db) => {
      const row = db.emails.find((e) => e.id === queued.id)!;
      row.createdAt = new Date(Date.now() - 2 * 3_600_000).toISOString();
      row.attempts = 4;
    });
    assert.deepEqual(await retryEmail(queued.id), { ok: false, error: "The one-time link in this email has expired, so it was not sent. Ask the member to request a new link." });
    const row = await findById("emails", queued.id);
    assert.equal(row?.status, "failed");
    assert.equal(row?.lastError, LINK_EXPIRED_ERROR);
    assert.ok(!row?.text.includes("AbCdEf"));
  });

  it("the runner skips expired links too", async () => {
    const queued = await enqueueEmail({ to: ada.email, userId: ada.id, subject: "Verify", html: "<p>x</p>", text: "x", category: "email_verification" });
    await mutate((db) => {
      db.emails.find((e) => e.id === queued.id)!.createdAt = new Date(Date.now() - 25 * 3_600_000).toISOString();
    });
    await deliverDueEmails(10, { wait: true, force: true });
    assert.equal((await findById("emails", queued.id))?.status, "failed");
  });

  it("a newer link supersedes an older queued one", async () => {
    await mutate((db) => {
      db.emails.push({ id: "eml_old", to: ada.email, userId: ada.id, subject: "Reset", html: RESET_LINK, text: RESET_LINK, category: "password_reset", status: "queued", attempts: 2, nextAttemptAt: new Date(Date.now() + 3_600_000).toISOString(), createdAt: new Date().toISOString() });
    });
    await enqueueEmail({ to: ada.email, userId: ada.id, subject: "Reset", html: "<p>new</p>", text: "new", category: "password_reset" });
    const old = await findById("emails", "eml_old");
    assert.equal(old?.status, "failed");
    assert.match(old?.lastError ?? "", /newer link/);
    assert.ok(!old?.text.includes("AbCdEf"));
  });

  it("prints one-time links to the console with the log transport outside production", async () => {
    const sent = await enqueueEmail({ to: ada.email, userId: ada.id, subject: "Reset", html: `<a href="${RESET_LINK}">Reset</a>`, text: `Choose a new password: ${RESET_LINK}`, category: "password_reset" }, { deliverNow: true });
    assert.equal(sent.status, "sent");
    const line = infos.find((l) => l.includes("DEV ONLY"));
    assert.ok(line?.includes(RESET_LINK), infos.join("\n"));
    assert.deepEqual(oneTimeLinks(`See (${RESET_LINK}). And https://x.test/courses?token=abc`), [RESET_LINK]);
  });

  it("never prints them in production", async () => {
    const env = process.env as Record<string, string | undefined>;
    const previous = env.NODE_ENV;
    env.NODE_ENV = "production";
    try {
      await enqueueEmail({ to: ada.email, userId: ada.id, subject: "Reset", html: "<p>x</p>", text: `Reset: ${RESET_LINK}`, category: "password_reset" }, { deliverNow: true });
    } finally {
      env.NODE_ENV = previous;
    }
    assert.ok(!infos.some((l) => l.includes("DEV ONLY")));
  });
});

describe("sender misconfiguration", () => {
  before(() => {
    mock.method(console, "warn", () => undefined);
    mock.method(console, "info", () => undefined);
  });
  after(() => mock.restoreAll());

  it("pauses delivery for a long time with an admin-visible error instead of looping", async () => {
    await resetDb({ users: [ada] });
    const saved = { transport: mailEnv.transport, from: mailEnv.from, user: mailEnv.user };
    Object.assign(mailEnv, { transport: "smtp", from: "", user: "apikey" });
    try {
      await enqueueEmail({ to: ada.email, subject: "Hi", html: "<p>Hi</p>", category: "notification" });
      const run = await deliverDueEmails(10, { wait: true, force: true });
      assert.equal(run.reason, "no_sender");
      const state = getDeliveryState();
      assert.match(state.configError ?? "", /No sender address/);
      assert.ok(state.pausedUntil && Date.parse(state.pausedUntil) - Date.now() > 20 * 60_000, "paused for a long time");
      const again = await deliverDueEmails();
      assert.equal(again.reason, "cooldown");
      assert.ok(getTransportStatus(await getSettings()).problems.some((p) => /MAIL_FROM/.test(p)));
    } finally {
      Object.assign(mailEnv, saved);
      await deliverDueEmails(10, { wait: true, force: true });
    }
    assert.equal(getDeliveryState().configError, null);
  });
});

describe("SMTP TLS policy", () => {
  it("requires TLS by default and allows an explicit opt-out", () => {
    const env = process.env as Record<string, string | undefined>;
    const previous = env.SMTP_REQUIRE_TLS;
    try {
      delete env.SMTP_REQUIRE_TLS;
      assert.equal(smtpTlsRequired(), true);
      assert.equal(smtpClientOptions().requireTls, undefined, "undefined = required unless the host is loopback");
      env.SMTP_REQUIRE_TLS = "false";
      assert.equal(smtpTlsRequired(), false);
      assert.equal(smtpClientOptions().requireTls, false);
      env.SMTP_REQUIRE_TLS = "true";
      assert.equal(smtpTlsRequired(), true);
    } finally {
      if (previous === undefined) delete env.SMTP_REQUIRE_TLS;
      else env.SMTP_REQUIRE_TLS = previous;
    }
  });
});

describe("MIME base64 text parts", () => {
  it("encode line breaks as CRLF", () => {
    const text = "ééééé\nééééé\nééé";
    const built = buildMimeMessage({ from: { address: "a@example.com" }, to: [{ address: "b@example.com" }], subject: "x", text, html: "<p>ééééé</p>\n<p>ééé</p>" });
    const parts = built.raw.split(/--=_ll_[0-9a-f]+/);
    const decoded = parts
      .filter((p) => /Content-Transfer-Encoding: base64/.test(p))
      .map((p) => Buffer.from(p.split("\r\n\r\n")[1]!.replace(/\r\n/g, ""), "base64").toString("utf8"));
    assert.equal(decoded.length, 2);
    assert.equal(decoded[0], "ééééé\r\nééééé\r\nééé");
    assert.equal(decoded[1], "<p>ééééé</p>\r\n<p>ééé</p>");
  });
});
