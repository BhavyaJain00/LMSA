import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { NextRequest } from "next/server";
import type { WebhookDelivery, WebhookEndpoint } from "@/lib/types";
import type { DomainEvent } from "@/lib/events-shared";
import { getDb, mutate } from "@/lib/db/store";
import { cronKey } from "@/lib/email";
import { decryptWebhookSecret, encryptWebhookSecret, webhookSsrfOptions } from "@/lib/webhooks/config";
import {
  enqueueWebhookEvent,
  pruneWebhookDeliveries,
  resendFailedDeliveries,
  resendWebhookDelivery,
  runWebhookDeliveries,
  sendTestWebhook,
  setWebhookAutoRun,
  undeliveredEvents,
  type WebhookTransport,
} from "@/lib/webhooks/delivery";
import { CANCELLED_MESSAGE } from "@/lib/webhooks/endpoints";
import { postWebhook, type WebhookHttpResult } from "@/lib/webhooks/http";
import { parseWebhookPayload } from "@/lib/webhooks/payload";
import { AUTO_DISABLE_AFTER_MS, MAX_DELIVERY_ATTEMPTS, RESPONSE_BODY_LIMIT, RETRY_DELAYS_MS } from "@/lib/webhooks/policy";
import { generateWebhookSecret, verifyWebhookSignature } from "@/lib/webhooks/signature";
import { GET as cronGET } from "@/app/api/cron/webhooks/route";
import { makeUser, resetDb } from "./helpers/db";

/** The delivery worker: queueing, signing, retries, auto-disable, test events, resends, the cron route and the HTTP client. */

setWebhookAutoRun(false);

const T0 = Date.parse("2026-03-01T10:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const HOUR = 3_600_000;

const admin = makeUser({ id: "usr_admin", name: "Admin", roles: ["admin"] });
const ada = makeUser({ id: "usr_ada", name: "Ada", email: "ada@example.com" });
const SECRET = generateWebhookSecret();

function endpointRow(id: string, extra: Partial<WebhookEndpoint> = {}): WebhookEndpoint {
  return { id, url: `https://hooks.example.com/${id}`, secretEnc: encryptWebhookSecret(SECRET), events: ["user.registered", "enrollment.created"], active: true, failureCount: 0, createdAt: iso(T0 - 10 * HOUR), ...extra };
}

function deliveryRow(id: string, endpointId: string, extra: Partial<WebhookDelivery> = {}): WebhookDelivery {
  const payload = JSON.stringify({ id: `evt_${id}`, type: "user.registered", createdAt: iso(T0), data: { userId: ada.id } });
  return { id, endpointId, event: "user.registered", eventId: `evt_${id}`, payload, status: "pending", attempts: 0, nextAttemptAt: iso(T0), createdAt: iso(T0), ...extra };
}

interface Call {
  url: string;
  body: string;
  headers: Record<string, string>;
}

/** A fake receiver answering with the given statuses in turn (the last one repeats). */
function receiver(...statuses: number[]): { transport: WebhookTransport; calls: Call[] } {
  const calls: Call[] = [];
  const transport: WebhookTransport = async (url, body, headers) => {
    calls.push({ url, body, headers });
    const status = statuses[Math.min(calls.length - 1, statuses.length - 1)]!;
    const ok = status >= 200 && status < 300;
    return { ok, status, body: ok ? "thanks" : "nope", durationMs: 4, ...(ok ? {} : { error: `The endpoint answered ${status}.` }) } satisfies WebhookHttpResult;
  };
  return { transport, calls };
}

async function seed(endpoints: WebhookEndpoint[], deliveries: WebhookDelivery[] = [], apiEnabled = true) {
  await resetDb({ users: [admin, ada], webhookEndpoints: endpoints, webhookDeliveries: deliveries, settings: { email: { enabled: false }, api: { enabled: apiEnabled } } });
}

async function delivery(id: string): Promise<WebhookDelivery> {
  const row = (await getDb()).webhookDeliveries.find((d) => d.id === id);
  assert.ok(row, `delivery ${id}`);
  return row;
}

async function endpoint(id: string): Promise<WebhookEndpoint> {
  const row = (await getDb()).webhookEndpoints.find((e) => e.id === id);
  assert.ok(row, `endpoint ${id}`);
  return row;
}

describe("webhook secrets at rest", () => {
  it("are encrypted with AES-256-GCM and read back only when intact", () => {
    const stored = encryptWebhookSecret(SECRET);
    assert.match(stored, /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    assert.ok(!stored.includes(SECRET.slice(6)), "the secret never appears in clear text");
    assert.notEqual(stored, encryptWebhookSecret(SECRET), "a fresh IV every time");
    assert.equal(decryptWebhookSecret(stored), SECRET);

    const [version, iv, tag, data] = stored.split(".");
    const flipped = `${data!.startsWith("A") ? "B" : "A"}${data!.slice(1)}`;
    assert.equal(decryptWebhookSecret([version, iv, tag, flipped].join(".")), null, "tampered ciphertext");
    for (const bad of [undefined, null, "", "whsec_plain", "v1.a.b"]) assert.equal(decryptWebhookSecret(bad), null);
  });

  it("allow private destinations only outside production and only when asked", () => {
    const saved = { flag: process.env.WEBHOOKS_ALLOW_PRIVATE_NETWORK, env: process.env.NODE_ENV };
    const env = process.env as Record<string, string | undefined>;
    try {
      env.WEBHOOKS_ALLOW_PRIVATE_NETWORK = "";
      assert.equal(webhookSsrfOptions().allowPrivate, false);
      env.WEBHOOKS_ALLOW_PRIVATE_NETWORK = "true";
      env.NODE_ENV = "development";
      assert.equal(webhookSsrfOptions().allowPrivate, true);
      env.NODE_ENV = "production";
      assert.equal(webhookSsrfOptions().allowPrivate, false, "ignored in production");
    } finally {
      env.WEBHOOKS_ALLOW_PRIVATE_NETWORK = saved.flag;
      env.NODE_ENV = saved.env;
    }
  });
});

describe("queueing domain events", () => {
  const event: DomainEvent<"user.registered"> = { id: "evt_user_1", name: "user.registered", createdAt: iso(T0), data: { userId: ada.id, email: ada.email, name: ada.name, source: "signup" } };

  it("creates one delivery per active endpoint subscribed to the event, once", async () => {
    await seed([endpointRow("whk_a"), endpointRow("whk_off", { active: false }), endpointRow("whk_other", { events: ["payment.paid"] })]);
    assert.equal(await enqueueWebhookEvent(event), 1);
    assert.equal(await enqueueWebhookEvent(event), 0, "the same event is not queued twice");
    const [row] = (await getDb()).webhookDeliveries;
    assert.equal(row!.endpointId, "whk_a");
    assert.equal(row!.status, "pending");
    const payload = parseWebhookPayload(row!.payload);
    assert.ok(payload);
    assert.deepEqual([payload.id, payload.type, payload.createdAt], ["evt_user_1", "user.registered", iso(T0)]);
    assert.equal((payload.data as { userId: string }).userId, ada.id);
  });

  it("queues nothing while the API is switched off", async () => {
    await seed([endpointRow("whk_a")], [], false);
    assert.equal(await enqueueWebhookEvent(event), 0);
    assert.equal((await getDb()).webhookDeliveries.length, 0);
  });
});

describe("delivery worker", () => {
  beforeEach(async () => {
    await seed([endpointRow("whk_a", { failureCount: 3, failingSince: iso(T0 - HOUR), lastError: "old" })], [deliveryRow("whd_1", "whk_a")]);
  });

  it("signs the request and records a success on the delivery and the endpoint", async () => {
    const { transport, calls } = receiver(200);
    const run = await runWebhookDeliveries({ wait: true, now: T0, transport });
    assert.deepEqual([run.ran, run.attempted, run.delivered, run.pending, run.nextRunAt], [true, 1, 1, 0, null]);

    const [call] = calls;
    assert.equal(call!.url, "https://hooks.example.com/whk_a");
    assert.equal(call!.headers["LL-Event"], "user.registered");
    assert.equal(call!.headers["LL-Event-Id"], "evt_whd_1");
    assert.equal(call!.headers["LL-Delivery"], "whd_1");
    assert.equal(call!.headers["LL-Attempt"], "1");
    assert.match(call!.headers["Content-Type"]!, /^application\/json/);
    assert.deepEqual(verifyWebhookSignature(call!.headers["LL-Signature"], SECRET, call!.body, { now: T0 }), { ok: true, timestamp: T0 / 1000 });

    const row = await delivery("whd_1");
    assert.deepEqual([row.status, row.attempts, row.responseStatus, row.responseBody, row.deliveredAt], ["success", 1, 200, "thanks", iso(T0)]);
    const ep = await endpoint("whk_a");
    assert.deepEqual([ep.failureCount, ep.failingSince, ep.lastError, ep.lastSuccessAt], [0, undefined, undefined, iso(T0)]);
  });

  it("retries with backoff, 8 attempts in all, then marks the delivery failed", async () => {
    const { transport, calls } = receiver(500);
    let at = T0;
    for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS; attempt++) {
      const early = await runWebhookDeliveries({ wait: true, now: at - 1, transport });
      assert.equal(early.attempted, 0, "nothing is sent before the retry is due");
      const run = await runWebhookDeliveries({ wait: true, now: at, transport });
      assert.equal(run.attempted, 1, `attempt ${attempt}`);
      const row = await delivery("whd_1");
      assert.equal(row.attempts, attempt);
      assert.equal(calls.at(-1)!.headers["LL-Attempt"], String(attempt));
      if (attempt < MAX_DELIVERY_ATTEMPTS) {
        assert.equal(row.status, "pending");
        assert.equal(row.nextAttemptAt, iso(at + RETRY_DELAYS_MS[attempt - 1]!));
        assert.equal(run.retrying, 1);
        at += RETRY_DELAYS_MS[attempt - 1]!;
      } else {
        assert.equal(row.status, "failed");
        assert.equal(row.nextAttemptAt, undefined);
        assert.equal(row.responseStatus, 500);
        assert.match(row.lastError ?? "", /500/);
        assert.equal(run.failed, 1);
      }
    }
    assert.equal(calls.length, MAX_DELIVERY_ATTEMPTS);
    assert.equal((await runWebhookDeliveries({ wait: true, now: at + 30 * HOUR, transport })).attempted, 0, "no ninth attempt");
    const ep = await endpoint("whk_a");
    assert.equal(ep.active, true, "a failing day shorter than the auto-disable window keeps the endpoint on");
    assert.equal(ep.failureCount, 3 + MAX_DELIVERY_ATTEMPTS);
  });

  it("holds back an endpoint's other due deliveries after a 5xx", async () => {
    await mutate((db) => {
      db.webhookDeliveries.push(deliveryRow("whd_2", "whk_a", { createdAt: iso(T0 + 1) }), deliveryRow("whd_3", "whk_a", { createdAt: iso(T0 + 2) }));
    });
    const { transport, calls } = receiver(503);
    const run = await runWebhookDeliveries({ wait: true, now: T0 + 10, transport });
    assert.deepEqual([run.attempted, run.postponed], [1, 2]);
    assert.equal(calls.length, 1);
    assert.equal((await delivery("whd_2")).nextAttemptAt, iso(T0 + 10 + RETRY_DELAYS_MS[0]!));
    assert.equal((await delivery("whd_2")).attempts, 0, "postponed, not attempted");
  });

  it("does not hold back other deliveries after a 4xx answer", async () => {
    await mutate((db) => {
      db.webhookDeliveries.push(deliveryRow("whd_2", "whk_a", { createdAt: iso(T0 + 1) }));
    });
    const { transport } = receiver(400, 200);
    const run = await runWebhookDeliveries({ wait: true, now: T0 + 10, transport });
    assert.deepEqual([run.attempted, run.delivered, run.retrying, run.postponed], [2, 1, 1, 0]);
  });

  it("fails without sending when the signing secret cannot be decrypted", async () => {
    await mutate((db) => {
      db.webhookEndpoints[0]!.secretEnc = "v1.broken.secret.value";
    });
    const { transport, calls } = receiver(200);
    await runWebhookDeliveries({ wait: true, now: T0, transport });
    assert.equal(calls.length, 0);
    const row = await delivery("whd_1");
    assert.equal(row.status, "pending");
    assert.match(row.lastError ?? "", /signing secret could not be read/);
  });

  it("turns a thrown transport error into a failed attempt", async () => {
    const transport: WebhookTransport = async () => {
      throw new Error("socket hang up");
    };
    const run = await runWebhookDeliveries({ wait: true, now: T0, transport });
    assert.equal(run.retrying, 1);
    assert.match((await delivery("whd_1")).lastError ?? "", /socket hang up/);
  });

  it("cancels waiting deliveries of an endpoint that is off, and sends nothing while the API is off", async () => {
    await mutate((db) => {
      db.settings.api.enabled = false;
    });
    const { transport, calls } = receiver(200);
    assert.equal((await runWebhookDeliveries({ wait: true, now: T0, transport })).reason, "api_disabled");
    assert.equal(calls.length, 0);

    await mutate((db) => {
      db.settings.api.enabled = true;
      db.webhookEndpoints[0]!.active = false;
    });
    const run = await runWebhookDeliveries({ wait: true, now: T0, transport });
    assert.deepEqual([run.cancelled, run.attempted], [1, 0]);
    const row = await delivery("whd_1");
    assert.deepEqual([row.status, row.lastError], ["failed", CANCELLED_MESSAGE]);
  });
});

describe("auto-disable", () => {
  it("switches an endpoint off after a day of failures, cancels what waits and tells the admins", async () => {
    await seed(
      [endpointRow("whk_a", { failureCount: MAX_DELIVERY_ATTEMPTS - 1, failingSince: iso(T0 - AUTO_DISABLE_AFTER_MS - HOUR) })],
      [deliveryRow("whd_due", "whk_a"), deliveryRow("whd_later", "whk_a", { nextAttemptAt: iso(T0 + HOUR) })],
    );
    const run = await runWebhookDeliveries({ wait: true, now: T0, transport: receiver(500).transport });
    assert.deepEqual([run.disabled, run.cancelled, run.failed], [1, 1, 1]);

    const ep = await endpoint("whk_a");
    assert.deepEqual([ep.active, ep.disabledReason, ep.disabledAt], [false, "failures", iso(T0)]);
    assert.equal((await delivery("whd_due")).status, "failed");
    assert.match((await delivery("whd_due")).lastError ?? "", /500/, "the attempted delivery keeps its own error");
    assert.deepEqual([(await delivery("whd_later")).status, (await delivery("whd_later")).lastError], ["failed", CANCELLED_MESSAGE]);

    const db = await getDb();
    assert.ok(db.auditEvents.some((e) => e.action === "webhook.auto_disable" && e.targetId === "whk_a"));
    const note = db.notifications.find((n) => n.userId === admin.id);
    assert.ok(note, "admins are notified");
    assert.match(note.subject, /hooks\.example\.com/);
    assert.equal(note.link, "/admin/settings/api/webhooks/whk_a");
    assert.ok(!db.notifications.some((n) => n.userId === ada.id), "learners are not");
  });

  it("does not switch off an endpoint that has failed often but only briefly", async () => {
    await seed([endpointRow("whk_a", { failureCount: 50, failingSince: iso(T0 - HOUR) })], [deliveryRow("whd_due", "whk_a")]);
    const run = await runWebhookDeliveries({ wait: true, now: T0, transport: receiver(500).transport });
    assert.equal(run.disabled, 0);
    assert.equal((await endpoint("whk_a")).active, true);
  });

  it("switches an endpoint off at once when it answers 410 Gone", async () => {
    await seed([endpointRow("whk_a")], [deliveryRow("whd_due", "whk_a")]);
    await runWebhookDeliveries({ wait: true, now: T0, transport: receiver(410).transport });
    const ep = await endpoint("whk_a");
    assert.deepEqual([ep.active, ep.disabledReason], [false, "gone"]);
  });
});

describe("test events and resends", () => {
  beforeEach(async () => {
    await seed(
      [endpointRow("whk_a"), endpointRow("whk_paused", { active: false })],
      [
        deliveryRow("whd_failed", "whk_a", { status: "failed", attempts: 8, lastError: "500" }),
        deliveryRow("whd_ok", "whk_a", { status: "success", attempts: 1, createdAt: iso(T0 + 1) }),
        deliveryRow("whd_wait", "whk_a", { attempts: 2, nextAttemptAt: iso(T0 + HOUR), createdAt: iso(T0 + 2) }),
      ],
    );
  });

  it("sends the example payload once, to any endpoint, without counting towards its health", async () => {
    const { transport, calls } = receiver(500);
    const result = await sendTestWebhook("whk_paused", "enrollment.created", { transport });
    assert.ok(result.ok);
    assert.deepEqual([result.delivery.status, result.delivery.attempts, result.delivery.test], ["failed", 1, true], "a single attempt, no retry");
    assert.equal(calls.length, 1);
    const payload = parseWebhookPayload(calls[0]!.body);
    assert.ok(payload);
    assert.ok(payload.id.startsWith("evt_test_"));
    assert.equal(payload.type, "enrollment.created");
    assert.equal(verifyWebhookSignature(calls[0]!.headers["LL-Signature"], SECRET, calls[0]!.body).ok, true);
    assert.equal((await endpoint("whk_paused")).failureCount, 0);

    assert.deepEqual(await sendTestWebhook("whk_a", "not.an.event", { transport }), { ok: false, reason: "invalid", error: "Pick the event to send." });
    assert.equal((await sendTestWebhook("whk_gone", "lead.created", { transport })).ok, false);
    assert.ok(!(await getDb()).webhookDeliveries.some((d) => d.endpointId === "whk_gone"), "no row left for a missing endpoint");
  });

  it("resends a finished delivery with the same event id as a new log entry", async () => {
    const { transport, calls } = receiver(200);
    const result = await resendWebhookDelivery("whd_failed", { transport });
    assert.ok(result.ok);
    assert.notEqual(result.delivery.id, "whd_failed");
    assert.deepEqual([result.delivery.resentFromId, result.delivery.eventId, result.delivery.status], ["whd_failed", "evt_whd_failed", "success"]);
    assert.equal(calls[0]!.body, (await delivery("whd_failed")).payload, "the same payload");
    assert.equal(calls[0]!.headers["LL-Event-Id"], "evt_whd_failed");

    const again = await resendWebhookDelivery(result.delivery.id, { transport });
    assert.ok(again.ok);
    assert.equal(again.delivery.resentFromId, "whd_failed", "resends point at the original");

    const pending = await resendWebhookDelivery("whd_wait", { transport });
    assert.ok(!pending.ok);
    assert.equal(pending.reason, "invalid");
    const missing = await resendWebhookDelivery("whd_nope", { transport });
    assert.ok(!missing.ok);
    assert.equal(missing.reason, "not_found");
  });

  it("refuses manual sends while the API is off", async () => {
    await mutate((db) => {
      db.settings.api.enabled = false;
    });
    const { transport, calls } = receiver(200);
    assert.equal((await sendTestWebhook("whk_a", "lead.created", { transport })).ok, false);
    assert.equal((await resendWebhookDelivery("whd_failed", { transport })).ok, false);
    assert.equal(calls.length, 0);
  });

  it("finds the events an endpoint never received and queues them again", async () => {
    const db = await getDb();
    assert.deepEqual(
      undeliveredEvents(db.webhookDeliveries, "whk_a").map((d) => d.id),
      ["whd_failed"],
    );
    const resent = { ...deliveryRow("whd_resent", "whk_a", { status: "success", createdAt: iso(T0 + 5) }), resentFromId: "whd_failed" };
    assert.deepEqual(undeliveredEvents([...db.webhookDeliveries, resent], "whk_a"), [], "a successful resend counts as received");

    const queued = await resendFailedDeliveries("whk_a");
    assert.deepEqual(queued, { ok: true, queued: 1, remaining: 0 });
    const copy = (await getDb()).webhookDeliveries.find((d) => d.resentFromId === "whd_failed");
    assert.ok(copy);
    assert.equal(copy.status, "pending");

    const paused = await resendFailedDeliveries("whk_paused");
    assert.ok(!paused.ok);
    assert.equal(paused.reason, "invalid");
  });
});

describe("delivery log retention", () => {
  it("prunes finished rows older than 30 days and keeps waiting ones", async () => {
    const old = iso(T0 - 40 * 24 * HOUR);
    await seed([endpointRow("whk_a")], [deliveryRow("whd_old", "whk_a", { status: "success", createdAt: old }), deliveryRow("whd_old_wait", "whk_a", { createdAt: old }), deliveryRow("whd_new", "whk_a", { status: "failed" })]);
    assert.equal(await pruneWebhookDeliveries(T0), 1);
    assert.deepEqual(
      (await getDb()).webhookDeliveries.map((d) => d.id),
      ["whd_old_wait", "whd_new"],
    );
  });
});

describe("HTTP client and cron route", () => {
  let server: http.Server;
  let base = "";
  const received: { path: string; headers: http.IncomingHttpHeaders; body: string }[] = [];
  const savedFlag = process.env.WEBHOOKS_ALLOW_PRIVATE_NETWORK;

  before(async () => {
    process.env.WEBHOOKS_ALLOW_PRIVATE_NETWORK = "true";
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const path = req.url ?? "/";
        received.push({ path, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
        if (path === "/redirect") {
          res.writeHead(302, { Location: "/ok" }).end();
        } else if (path === "/slow") {
          setTimeout(() => res.writeHead(200).end("late"), 1_000);
        } else if (path === "/big") {
          res.writeHead(500, { "Content-Type": "text/plain" }).end("x".repeat(RESPONSE_BODY_LIMIT * 3));
        } else {
          res.writeHead(200, { "Content-Type": "text/plain" }).end("received\u0000");
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    process.env.WEBHOOKS_ALLOW_PRIVATE_NETWORK = savedFlag;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    received.length = 0;
  });

  it("posts the body and headers and keeps a clean response body", async () => {
    const result = await postWebhook(`${base}/ok?x=1`, '{"a":1}', { "LL-Event": "lead.created" }, { allowPrivate: true });
    assert.deepEqual([result.ok, result.status, result.body], [true, 200, "received"]);
    assert.equal(received[0]!.path, "/ok?x=1");
    assert.equal(received[0]!.body, '{"a":1}');
    assert.equal(received[0]!.headers["ll-event"], "lead.created");
  });

  it("does not follow redirects, truncates long bodies and times out", async () => {
    const redirect = await postWebhook(`${base}/redirect`, "{}", {}, { allowPrivate: true });
    assert.deepEqual([redirect.ok, redirect.status], [false, 302]);
    assert.match(redirect.error ?? "", /Redirects are not followed/);
    assert.equal(received.length, 1, "the redirect target was not requested");

    const big = await postWebhook(`${base}/big`, "{}", {}, { allowPrivate: true });
    assert.equal(big.ok, false);
    assert.equal(big.body!.length, RESPONSE_BODY_LIMIT + 1, "truncated with an ellipsis");

    const slow = await postWebhook(`${base}/slow`, "{}", {}, { allowPrivate: true, timeoutMs: 150 });
    assert.equal(slow.ok, false);
    assert.match(slow.error ?? "", /timed out/);
  });

  it("refuses loopback destinations unless private networks are allowed", async () => {
    const blocked = await postWebhook(`${base}/ok`, "{}", {});
    assert.deepEqual([blocked.ok, blocked.blocked], [false, true]);
    assert.equal(received.length, 0, "nothing was sent");
    const ftp = await postWebhook("ftp://example.com/hook", "{}", {}, { allowPrivate: true });
    assert.equal(ftp.blocked, true);
  });

  it("cron route requires the cron key and delivers what is due", async () => {
    await seed([endpointRow("whk_local", { url: `${base}/hook` })], [deliveryRow("whd_cron", "whk_local", { nextAttemptAt: iso(Date.now() - 1000), createdAt: iso(Date.now() - 1000) })]);
    const request = (url: string, headers: Record<string, string> = {}) => Object.assign(new Request(url, { headers }), { nextUrl: new URL(url) }) as unknown as NextRequest;

    const denied = await cronGET(request("http://localhost:3000/api/cron/webhooks?key=wrong"));
    assert.equal(denied.status, 401);
    assert.equal(received.length, 0);

    const res = await cronGET(request("http://localhost:3000/api/cron/webhooks", { authorization: `Bearer ${cronKey()}` }));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = (await res.json()) as { ok: boolean; delivered: number; pending: number };
    assert.deepEqual([body.ok, body.delivered, body.pending], [true, 1, 0]);
    assert.equal(received.length, 1);
    assert.equal(verifyWebhookSignature(received[0]!.headers["ll-signature"] as string, SECRET, received[0]!.body).ok, true);
    assert.equal((await delivery("whd_cron")).status, "success");
  });
});
