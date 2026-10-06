import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";
import type { ApiKey, Database } from "@/lib/types";
import { authenticateApiKey } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { readBodyText } from "@/lib/api/handler";
import { generateApiKey } from "@/lib/api/keys";
import { endpoints } from "@/lib/api/endpoints";
import { buildOpenApiDocument, errorStatusesFor } from "@/lib/api/openapi";
import { API_AUTH_FAILURE_LIMIT, API_AUTH_FAILURE_SHARED_LIMIT, apiAuthFailures, apiKeyLimiter } from "@/lib/api/rate-limit";
import { API_SCOPE_IDS } from "@/lib/api/scopes";
import { userStamps } from "@/lib/api/serializers";
import { getDb } from "@/lib/db/store";
import { settleEvents } from "@/lib/events";
import { POST as createCourse } from "@/app/api/v1/courses/route";
import { GET as listUsers } from "@/app/api/v1/users/route";
import { PATCH as patchUser } from "@/app/api/v1/users/[id]/route";
import { makeUser, resetDb } from "./helpers/db";

type Json = ReturnType<typeof JSON.parse>;

const admin = makeUser({ id: "usr_admin", name: "Admin", roles: ["admin"] });
const ada = makeUser({ id: "usr_ada", name: "Ada", email: "ada@example.com", createdAt: "2025-01-01T00:00:00.000Z", lastActiveAt: "2025-02-01T00:00:00.000Z" });

function keyRow(id: string, extra: Partial<ApiKey> = {}): { row: ApiKey; key: string } {
  const generated = generateApiKey();
  return {
    key: generated.key,
    row: { id, name: id, prefix: generated.prefix, keyHash: generated.keyHash, scopes: [...API_SCOPE_IDS], createdById: admin.id, createdAt: "2026-01-01T00:00:00.000Z", ...extra },
  };
}

function expectApiError(fn: () => unknown, status: number, code: string): ApiError {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof ApiError, "expected an ApiError");
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return error;
  }
  assert.fail(`expected ${status} ${code}`);
}

describe("API key authentication vs the failure limiter", () => {
  const valid = keyRow("key_valid");
  const revoked = keyRow("key_revoked", { revokedAt: "2026-01-02T00:00:00.000Z" });
  const db = { apiKeys: [valid.row, revoked.row], users: [admin] } as unknown as Database;
  const junk = `ll_live_aaaaaaaaaa_${"x".repeat(40)}`;

  beforeEach(() => {
    apiAuthFailures.reset("api-auth:unknown");
    apiAuthFailures.reset("api-auth:203.0.113.9");
  });

  it("keeps accepting valid keys after junk keys filled the shared unknown-IP bucket", () => {
    const now = Date.now();
    for (let i = 0; i < API_AUTH_FAILURE_SHARED_LIMIT.limit; i++) {
      expectApiError(() => authenticateApiKey(db, `Bearer ${junk}`, "unknown", now), 401, "invalid_api_key");
    }
    // The attacker is now throttled...
    const limited = expectApiError(() => authenticateApiKey(db, `Bearer ${junk}`, "unknown", now), 429, "rate_limited");
    assert.match(limited.headers?.["Retry-After"] ?? "", /^\d+$/);
    // ...but a legitimate integration behind the same (unknown) IP is not.
    assert.equal(authenticateApiKey(db, `Bearer ${valid.key}`, "unknown", now).id, "key_valid");
    // Failures stay throttled: a missing header and a revoked key get 429 too.
    expectApiError(() => authenticateApiKey(db, null, "unknown", now), 429, "rate_limited");
    expectApiError(() => authenticateApiKey(db, `Bearer ${revoked.key}`, "unknown", now), 429, "rate_limited");
  });

  it("counts missing, invalid and revoked keys per known IP but never valid ones", () => {
    const now = Date.now();
    const ip = "203.0.113.9";
    for (let i = 0; i < 50; i++) authenticateApiKey(db, `Bearer ${valid.key}`, ip, now);
    assert.equal(apiAuthFailures.check(`api-auth:${ip}`, API_AUTH_FAILURE_LIMIT, now).remaining, API_AUTH_FAILURE_LIMIT.limit);
    expectApiError(() => authenticateApiKey(db, null, ip, now), 401, "unauthorized");
    expectApiError(() => authenticateApiKey(db, `Bearer ${revoked.key}`, ip, now), 401, "revoked_api_key");
    expectApiError(() => authenticateApiKey(db, `Bearer ${junk}`, ip, now), 401, "invalid_api_key");
    assert.equal(apiAuthFailures.check(`api-auth:${ip}`, API_AUTH_FAILURE_LIMIT, now).remaining, API_AUTH_FAILURE_LIMIT.limit - 3);
  });

  it("treats a valid key whose owner is no longer an active admin as a failure", () => {
    const now = Date.now();
    const disabledDb = { apiKeys: [valid.row], users: [{ ...admin, enabled: false }] } as unknown as Database;
    expectApiError(() => authenticateApiKey(disabledDb, `Bearer ${valid.key}`, "203.0.113.9", now), 401, "invalid_api_key");
    assert.equal(apiAuthFailures.check("api-auth:203.0.113.9", API_AUTH_FAILURE_LIMIT, now).remaining, API_AUTH_FAILURE_LIMIT.limit - 1);
  });
});

function streamOf(chunks: Uint8Array[], onCancel?: () => void): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++]);
      else controller.close();
    },
    cancel() {
      onCancel?.();
    },
  });
}

describe("readBodyText", () => {
  it("returns an empty string without a body", async () => {
    assert.equal(await readBodyText(null, 10), "");
  });

  it("decodes UTF-8 split across chunks", async () => {
    const bytes = new TextEncoder().encode('{"name":"Zoë 😀"}');
    const chunks = [bytes.slice(0, 11), bytes.slice(11, 15), bytes.slice(15)];
    assert.equal(await readBodyText(streamOf(chunks), 1024), '{"name":"Zoë 😀"}');
  });

  it("accepts a body of exactly the limit", async () => {
    assert.equal(await readBodyText(streamOf([new Uint8Array(8).fill(97)]), 8), "aaaaaaaa");
  });

  it("stops reading and cancels the stream as soon as the limit is passed", async () => {
    let pulled = 0;
    let cancelled = false;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    await assert.rejects(readBodyText(endless, 4096), (error: unknown) => error instanceof ApiError && error.status === 413 && error.code === "payload_too_large");
    assert.ok(cancelled, "the stream was cancelled");
    assert.ok(pulled <= 7, `read only a little past the limit (pulled ${pulled} chunks)`);
  });
});

describe("API routes: body limit, user change stamps", () => {
  let fullKey = "";

  beforeEach(async () => {
    const full = keyRow("key_full");
    fullKey = full.key;
    apiKeyLimiter.reset("key_full");
    await resetDb({ users: [admin, ada], apiKeys: [full.row], settings: { email: { enabled: false }, gamification: { enabled: false } } });
  });

  async function call(handler: (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>, init: RequestInit & { path: string; params?: Record<string, string> }) {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${fullKey}`);
    const request = new Request(`http://localhost:3000/api/v1${init.path}`, { ...init, headers }) as unknown as NextRequest;
    const response = await handler(request, { params: Promise.resolve(init.params ?? {}) });
    const text = await response.text();
    return { status: response.status, json: (text ? JSON.parse(text) : null) as Json };
  }

  it("answers 413 to a chunked body without Content-Length that passes the limit", async () => {
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent === 0) controller.enqueue(new TextEncoder().encode('{"title":"'));
        else controller.enqueue(new Uint8Array(64 * 1024).fill(97));
        sent++;
        if (sent > 200) controller.close();
      },
    });
    const res = await call(createCourse, { path: "/courses", method: "POST", headers: { "content-type": "application/json" }, body, duplex: "half" } as RequestInit & { path: string });
    assert.equal(res.status, 413);
    assert.equal(res.json!.error.code, "payload_too_large");
    assert.ok(sent < 20, `stopped reading early (read ${sent} chunks)`);
  });

  it("stamps updatedAt on PATCH so updated_since sync sees member edits", async () => {
    const before = new Date(Date.now() - 1000).toISOString();
    const listedBefore = await call(listUsers, { path: `/users?updated_since=${encodeURIComponent(before)}`, method: "GET" });
    assert.equal(listedBefore.status, 200);
    assert.ok(!listedBefore.json!.data.some((u: { id: string }) => u.id === ada.id), "ada is not changed yet");

    const patched = await call(patchUser, {
      path: `/users/${ada.id}`,
      method: "PATCH",
      params: { id: ada.id },
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ada.new@example.com", roles: ["student", "course_creator"] }),
    });
    assert.equal(patched.status, 200);
    await settleEvents();

    const row = (await getDb()).users.find((u) => u.id === ada.id)!;
    assert.ok(row.updatedAt && row.updatedAt >= before);
    assert.equal(userStamps(row).updatedAt, row.updatedAt);

    const listedAfter = await call(listUsers, { path: `/users?updated_since=${encodeURIComponent(before)}`, method: "GET" });
    assert.equal(listedAfter.status, 200);
    const found = listedAfter.json!.data.find((u: { id: string }) => u.id === ada.id);
    assert.ok(found, "ada is returned after the edit");
    assert.equal(found.email, "ada.new@example.com");
  });

  it("does not stamp a PATCH that changes nothing", async () => {
    const res = await call(patchUser, {
      path: `/users/${ada.id}`,
      method: "PATCH",
      params: { id: ada.id },
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada" }),
    });
    assert.equal(res.status, 200);
    assert.equal((await getDb()).users.find((u) => u.id === ada.id)!.updatedAt, undefined);
  });
});

describe("OpenAPI: body-reading errors", () => {
  it("adds 400, 413 and 415 to endpoints with a JSON body only", () => {
    assert.deepEqual(errorStatusesFor({ errors: [409], body: endpoints.createCourse.body }), [400, 401, 403, 409, 413, 415, 429, 500]);
    assert.deepEqual(errorStatusesFor({ errors: [404] }), [401, 403, 404, 429, 500]);
  });

  it("documents 413 and 415 on every operation that takes a body", () => {
    const doc = buildOpenApiDocument(undefined, "https://lms.example") as Json;
    let withBody = 0;
    for (const item of Object.values(doc.paths) as Json[]) {
      for (const operation of Object.values(item) as Json[]) {
        if (!operation || typeof operation !== "object" || !("responses" in operation)) continue;
        const responses = Object.keys(operation.responses);
        if (operation.requestBody) {
          withBody++;
          assert.ok(responses.includes("413") && responses.includes("415"), `${operation.operationId} documents 413 and 415`);
        } else {
          assert.ok(!responses.includes("415"), `${operation.operationId} has no body, so no 415`);
        }
      }
    }
    assert.ok(withBody >= 5);
  });
});
