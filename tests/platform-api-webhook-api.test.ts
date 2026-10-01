import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { NextRequest } from "next/server";
import type { ApiKey, WebhookDelivery } from "@/lib/types";
import {
  createWebhookEndpointAction,
  deleteWebhookEndpointAction,
  resendWebhookDeliveryAction,
  revealWebhookSecretAction,
  rotateWebhookSecretAction,
  sendTestWebhookAction,
  setWebhookActiveAction,
  updateWebhookEndpointAction,
} from "@/lib/actions/webhooks";
import { generateApiKey } from "@/lib/api/keys";
import { apiKeyLimiter } from "@/lib/api/rate-limit";
import { createSession } from "@/lib/auth/session";
import { getDb, mutate } from "@/lib/db/store";
import { CANCELLED_MESSAGE } from "@/lib/webhooks/endpoints";
import { setWebhookAutoRun } from "@/lib/webhooks/delivery";
import { verifyWebhookSignature } from "@/lib/webhooks/signature";
import { GET as listWebhookEvents } from "@/app/api/v1/webhook-events/route";
import { GET as listWebhooks, POST as createWebhook, PUT as putWebhooks } from "@/app/api/v1/webhooks/route";
import { DELETE as deleteWebhook, GET as getWebhook, PATCH as patchWebhook } from "@/app/api/v1/webhooks/[id]/route";
import { POST as rollSecret } from "@/app/api/v1/webhooks/[id]/secret/route";
import { POST as testWebhook } from "@/app/api/v1/webhooks/[id]/test/route";
import { GET as listDeliveries } from "@/app/api/v1/webhooks/[id]/deliveries/route";
import { POST as resendDelivery } from "@/app/api/v1/webhooks/[id]/deliveries/[deliveryId]/resend/route";
import { makeUser, resetDb } from "./helpers/db";
import { resetRequest } from "./helpers/request";

/** Webhook management from the admin settings page (server actions) and from the REST API. */

setWebhookAutoRun(false);

type Json = ReturnType<typeof JSON.parse>;
type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

const admin = makeUser({ id: "usr_admin", name: "Admin", roles: ["admin"] });
const moderator = makeUser({ id: "usr_mod", roles: ["moderator"] });

/* A local receiver: webhooks to loopback are allowed by the development flag below. */
let server: http.Server;
let hookUrl = "";
let answer = 200;
const received: { headers: http.IncomingHttpHeaders; body: string }[] = [];
const savedFlag = process.env.WEBHOOKS_ALLOW_PRIVATE_NETWORK;

before(async () => {
  process.env.WEBHOOKS_ALLOW_PRIVATE_NETWORK = "true";
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      received.push({ headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      res.writeHead(answer, { "Content-Type": "text/plain" }).end(answer < 300 ? "ok" : "down");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  hookUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
});

after(async () => {
  process.env.WEBHOOKS_ALLOW_PRIVATE_NETWORK = savedFlag;
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

let keys: Record<string, string> = {};

function keyRow(id: string, scopes: string[]): { row: ApiKey; key: string } {
  const generated = generateApiKey();
  return { key: generated.key, row: { id, name: id, prefix: generated.prefix, keyHash: generated.keyHash, scopes, createdById: admin.id, createdAt: "2026-01-01T00:00:00.000Z" } };
}

beforeEach(async () => {
  received.length = 0;
  answer = 200;
  const manage = keyRow("key_hooks", ["webhooks:manage"]);
  const read = keyRow("key_read", ["courses:read"]);
  keys = { manage: manage.key, read: read.key };
  for (const id of ["key_hooks", "key_read"]) apiKeyLimiter.reset(id);
  await resetDb({ users: [admin, moderator], apiKeys: [manage.row, read.row], settings: { email: { enabled: false } } });
});

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) for (const v of Array.isArray(value) ? value : [value]) data.append(key, v);
  return data;
}

async function signIn(userId: string) {
  resetRequest();
  await createSession(userId);
}

async function call(handler: Handler, method: string, path: string, opts: { key?: string; body?: unknown; params?: Record<string, string> } = {}) {
  const headers = new Headers({ authorization: `Bearer ${opts.key ?? keys.manage}` });
  let body: string | undefined;
  if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers.set("content-type", "application/json");
  }
  const request = new Request(`http://localhost:3000/api/v1${path}`, { method, headers, body }) as unknown as NextRequest;
  const response = await handler(request, { params: Promise.resolve(opts.params ?? {}) });
  const text = await response.text();
  return { status: response.status, headers: response.headers, json: (text ? JSON.parse(text) : null) as Json };
}

describe("webhook admin actions", () => {
  it("are for administrators only", async () => {
    await signIn(moderator.id);
    const res = await createWebhookEndpointAction(null, form({ url: hookUrl, events: ["lead.created"] }));
    assert.equal(res.ok, false);
    assert.equal((await getDb()).webhookEndpoints.length, 0);
  });

  it("validate the URL and the events field by field", async () => {
    await signIn(admin.id);
    const res = await createWebhookEndpointAction(null, form({ url: "ftp://example.com/x", events: ["nope"], description: "x".repeat(200) }));
    assert.ok(!res.ok);
    assert.ok(res.fieldErrors?.url);
    assert.ok(res.fieldErrors?.events);
    assert.ok(res.fieldErrors?.description);
  });

  it("create an endpoint with an encrypted secret, reveal and rotate it, all audited", async () => {
    await signIn(admin.id);
    const created = await createWebhookEndpointAction(null, form({ url: hookUrl, description: " CRM  sync ", events: ["payment.paid", "lead.created", "payment.paid"] }));
    assert.ok(created.ok);
    const { id, secret } = created.data;
    let db = await getDb();
    const row = db.webhookEndpoints.find((e) => e.id === id)!;
    assert.deepEqual([row.description, row.source, row.createdById, row.active], ["CRM sync", "admin", admin.id, true]);
    assert.deepEqual(row.events, ["payment.paid", "lead.created"], "catalog order, no duplicates");
    assert.ok(!JSON.stringify(db).includes(secret), "the secret is stored encrypted");

    const duplicate = await createWebhookEndpointAction(null, form({ url: `${hookUrl}/`, events: ["lead.created"] }));
    assert.ok(!duplicate.ok);
    assert.ok(duplicate.fieldErrors?.url);

    const revealed = await revealWebhookSecretAction(id);
    assert.ok(revealed.ok);
    assert.equal(revealed.data.secret, secret);

    const rotated = await rotateWebhookSecretAction(id);
    assert.ok(rotated.ok);
    assert.notEqual(rotated.data.secret, secret);
    const after = await revealWebhookSecretAction(id);
    assert.ok(after.ok);
    assert.equal(after.data.secret, rotated.data.secret);

    db = await getDb();
    const actions = db.auditEvents.filter((e) => e.targetId === id).map((e) => e.action);
    assert.deepEqual(actions, ["webhook.create", "webhook.secret_reveal", "webhook.secret_rotate", "webhook.secret_reveal"]);
    assert.ok(!JSON.stringify(db.auditEvents).includes("/hook"), "audit entries carry the host, not the path");
  });

  it("edit, pause (cancelling waiting deliveries), resume and delete an endpoint", async () => {
    await signIn(admin.id);
    const created = await createWebhookEndpointAction(null, form({ url: hookUrl, events: ["lead.created"] }));
    assert.ok(created.ok);
    const { id } = created.data;

    const edited = await updateWebhookEndpointAction(null, form({ id, url: hookUrl, description: "Leads", events: ["lead.created", "user.registered"] }));
    assert.ok(edited.ok);
    assert.deepEqual((await getDb()).webhookEndpoints[0]!.events, ["user.registered", "lead.created"]);
    const unchanged = await updateWebhookEndpointAction(null, form({ id, url: hookUrl, description: "Leads", events: ["lead.created", "user.registered"] }));
    assert.equal(unchanged.ok && unchanged.message, "Nothing changed.");

    await mutate((db) => {
      const waiting: WebhookDelivery = { id: "whd_wait", endpointId: id, event: "lead.created", payload: "{}", status: "pending", attempts: 1, nextAttemptAt: new Date(Date.now() + 60_000).toISOString(), createdAt: new Date().toISOString() };
      db.webhookDeliveries.push(waiting);
      db.webhookEndpoints[0]!.failureCount = 4;
      db.webhookEndpoints[0]!.failingSince = new Date().toISOString();
    });
    const paused = await setWebhookActiveAction(id, false);
    assert.ok(paused.ok);
    let db = await getDb();
    assert.equal(db.webhookEndpoints[0]!.active, false);
    assert.deepEqual([db.webhookDeliveries[0]!.status, db.webhookDeliveries[0]!.lastError], ["failed", CANCELLED_MESSAGE]);

    assert.ok((await setWebhookActiveAction(id, true)).ok);
    db = await getDb();
    assert.deepEqual([db.webhookEndpoints[0]!.active, db.webhookEndpoints[0]!.failureCount, db.webhookEndpoints[0]!.failingSince], [true, 0, undefined], "back on with a clean record");

    assert.ok((await deleteWebhookEndpointAction(id)).ok);
    db = await getDb();
    assert.deepEqual([db.webhookEndpoints.length, db.webhookDeliveries.length], [0, 0]);
    assert.deepEqual(
      db.auditEvents.map((e) => e.action),
      ["webhook.create", "webhook.update", "webhook.disable", "webhook.enable", "webhook.delete"],
    );
    assert.equal((await deleteWebhookEndpointAction(id)).ok, false);
  });

  it("send a signed test event and resend it", async () => {
    await signIn(admin.id);
    const created = await createWebhookEndpointAction(null, form({ url: hookUrl, events: ["lead.created"] }));
    assert.ok(created.ok);

    answer = 503;
    const failed = await sendTestWebhookAction(created.data.id, "certificate.issued");
    assert.ok(failed.ok, "the action worked even though the receiver failed");
    assert.deepEqual([failed.data.delivered, failed.data.responseStatus], [false, 503]);
    assert.match(failed.message ?? "", /not delivered/);
    assert.equal(received.length, 1);
    assert.equal(received[0]!.headers["ll-event"], "certificate.issued");
    assert.equal(verifyWebhookSignature(received[0]!.headers["ll-signature"] as string, created.data.secret, received[0]!.body).ok, true);

    answer = 200;
    const resent = await resendWebhookDeliveryAction(failed.data.deliveryId);
    assert.ok(resent.ok);
    assert.deepEqual([resent.data.delivered, resent.data.responseStatus], [true, 200]);
    assert.equal(received[1]!.body, received[0]!.body, "the same payload is sent again");
    assert.equal(received[1]!.headers["ll-event-id"], received[0]!.headers["ll-event-id"]);

    const db = await getDb();
    assert.ok(db.auditEvents.some((e) => e.action === "webhook.test"));
    assert.ok(db.auditEvents.some((e) => e.action === "webhook.resend"));
    assert.equal(db.webhookEndpoints[0]!.failureCount, 0, "manual sends do not count against the endpoint");
  });
});

describe("/api/v1/webhooks", () => {
  it("requires the webhooks:manage scope, except for the event catalog", async () => {
    const denied = await call(listWebhooks, "GET", "/webhooks", { key: keys.read });
    assert.equal(denied.status, 403);
    assert.equal(denied.json!.error.code, "insufficient_scope");

    const catalog = await call(listWebhookEvents, "GET", "/webhook-events", { key: keys.read });
    assert.equal(catalog.status, 200);
    const names = (catalog.json!.data as { name: string }[]).map((e) => e.name);
    for (const name of ["enrollment.created", "payment.paid", "payment.refunded", "course.completed", "lesson.completed", "certificate.issued", "user.registered", "subscription.changed", "lead.created"]) {
      assert.ok(names.includes(name), name);
    }
  });

  it("creates, lists, updates and deletes endpoints without ever listing the secret", async () => {
    const invalid = await call(createWebhook, "POST", "/webhooks", { body: { url: "ftp://example.com/x", events: [] } });
    assert.equal(invalid.status, 400);

    const created = await call(createWebhook, "POST", "/webhooks", { body: { url: hookUrl, events: ["enrollment.created"], description: "LMS → CRM" } });
    assert.equal(created.status, 201);
    const { id, secret } = created.json!.data as { id: string; secret: string };
    assert.match(secret, /^whsec_/);
    assert.equal(created.json!.data.description, "LMS → CRM");

    const list = await call(listWebhooks, "GET", "/webhooks?active=true");
    assert.equal(list.status, 200);
    assert.equal(list.json!.meta.total, 1);
    assert.ok(!JSON.stringify(list.json).includes(secret));
    const one = await call(getWebhook, "GET", `/webhooks/${id}`, { params: { id } });
    assert.equal(one.json!.data.status, "active");
    assert.equal(one.json!.data.secret, undefined);

    const patched = await call(patchWebhook, "PATCH", `/webhooks/${id}`, { params: { id }, body: { active: false, events: ["payment.paid", "lead.created"] } });
    assert.equal(patched.status, 200);
    assert.deepEqual([patched.json!.data.active, patched.json!.data.status, patched.json!.data.events], [false, "disabled", ["payment.paid", "lead.created"]]);
    const empty = await call(patchWebhook, "PATCH", `/webhooks/${id}`, { params: { id }, body: {} });
    assert.equal(empty.status, 400);

    const rolled = await call(rollSecret, "POST", `/webhooks/${id}/secret`, { params: { id } });
    assert.equal(rolled.status, 200);
    assert.notEqual(rolled.json!.data.secret, secret);

    const removed = await call(deleteWebhook, "DELETE", `/webhooks/${id}`, { params: { id } });
    assert.equal(removed.status, 200);
    assert.equal(removed.json!.data.deleted, true);
    assert.equal((await call(getWebhook, "GET", `/webhooks/${id}`, { params: { id } })).status, 404);

    const db = await getDb();
    const audit = db.auditEvents.filter((e) => e.action.startsWith("api.webhook.")).map((e) => e.action);
    assert.deepEqual(audit, ["api.webhook.create", "api.webhook.update", "api.webhook.secret_rotate", "api.webhook.delete"]);
    assert.equal(db.webhookEndpoints.length, 0);
  });

  it("sends a test event, lists the deliveries and resends one", async () => {
    const created = await call(createWebhook, "POST", "/webhooks", { body: { url: hookUrl, events: ["lead.created"] } });
    const { id, secret } = created.json!.data as { id: string; secret: string };

    answer = 500;
    const test = await call(testWebhook, "POST", `/webhooks/${id}/test`, { params: { id }, body: { event: "payment.paid" } });
    assert.equal(test.status, 200);
    assert.deepEqual([test.json!.data.status, test.json!.data.test, test.json!.data.responseStatus], ["failed", true, 500]);
    assert.match(test.json!.data.eventId, /^evt_test_/);
    assert.equal(verifyWebhookSignature(received[0]!.headers["ll-signature"] as string, secret, received[0]!.body).ok, true);
    assert.equal((await call(testWebhook, "POST", `/webhooks/${id}/test`, { params: { id }, body: { event: "nope" } })).status, 400);

    const log = await call(listDeliveries, "GET", `/webhooks/${id}/deliveries?status=failed`, { params: { id } });
    assert.equal(log.status, 200);
    assert.equal(log.json!.meta.total, 1);
    const deliveryId = log.json!.data[0].id as string;

    answer = 200;
    const resent = await call(resendDelivery, "POST", `/webhooks/${id}/deliveries/${deliveryId}/resend`, { params: { id, deliveryId } });
    assert.equal(resent.status, 200);
    assert.deepEqual([resent.json!.data.status, resent.json!.data.resentFromId], ["success", deliveryId]);

    const other = await call(createWebhook, "POST", "/webhooks", { body: { url: `${hookUrl}-2`, events: ["lead.created"] } });
    const otherId = other.json!.data.id as string;
    const wrongEndpoint = await call(resendDelivery, "POST", `/webhooks/${otherId}/deliveries/${deliveryId}/resend`, { params: { id: otherId, deliveryId } });
    assert.equal(wrongEndpoint.status, 404, "a delivery is resent only through its own endpoint");
  });

  it("answers unsupported methods with 405 and an Allow header", async () => {
    const res = await call(putWebhooks as unknown as Handler, "PUT", "/webhooks");
    assert.equal(res.status, 405);
    assert.equal(res.json!.error.code, "method_not_allowed");
    assert.match(res.headers.get("allow") ?? "", /GET, POST/);
  });
});
