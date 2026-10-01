import assert from "node:assert/strict";
import { createHmac, timingSafeEqual } from "node:crypto";
import { describe, it } from "node:test";
import type { NextRequest } from "next/server";
import { ERROR_CODES, buildEndpointDocs, curlExample, exampleUrl, fetchExample, schemaParams } from "@/lib/api/docs";
import { NO_ENDPOINT_FILTER, filterEndpointDocs, groupEndpointDocs } from "@/lib/api/docs-filter";
import { API_TAGS, ENDPOINT_LIST, endpoints, type ApiResourceName } from "@/lib/api/endpoints";
import { resourceExample, responseExample } from "@/lib/api/examples";
import { buildOpenApiDocument, errorDescription, eventDataSchema, WEBHOOK_HEADERS } from "@/lib/api/openapi";
import { RESOURCE_SCHEMAS, describeSchemaType, resourceFields } from "@/lib/api/resources";
import { s, type JsonSchema } from "@/lib/api/schema";
import { NODE_VERIFY_SAMPLE, VERIFY_SAMPLES } from "@/lib/api/webhook-samples";
import { WEBHOOK_EVENTS, exampleEventData } from "@/lib/webhooks/events";
import { buildTestPayload } from "@/lib/webhooks/payload";
import { generateWebhookSecret, isWebhookSecret, signatureHeader } from "@/lib/webhooks/signature";
import { DELETE as openapiDelete, GET as openapiGet, POST as openapiPost } from "@/app/api/v1/openapi.json/route";

/** OpenAPI document details, the /developers view models and the documented examples. */

const BASE = "https://lms.example";
const doc = buildOpenApiDocument(ENDPOINT_LIST, BASE) as JsonSchema & {
  components: { schemas: Record<string, JsonSchema> };
  paths: Record<string, Record<string, JsonSchema>>;
  webhooks: Record<string, { post: JsonSchema }>;
};

/* ------------------------------------------------------------------ */
/* A small JSON Schema checker (the subset the document uses)          */
/* ------------------------------------------------------------------ */

function check(schema: JsonSchema, value: unknown, path: string, errors: string[]): void {
  if (typeof schema.$ref === "string") {
    const name = schema.$ref.replace("#/components/schemas/", "");
    const target = doc.components.schemas[name];
    if (!target) errors.push(`${path}: unknown $ref ${name}`);
    else check(target, value, path, errors);
    return;
  }
  if (Array.isArray(schema.anyOf)) {
    const ok = (schema.anyOf as JsonSchema[]).some((option) => {
      const inner: string[] = [];
      check(option, value, path, inner);
      return inner.length === 0;
    });
    if (!ok) errors.push(`${path}: matches no anyOf option`);
    return;
  }
  if ("const" in schema && value !== schema.const) errors.push(`${path}: expected ${String(schema.const)}`);
  if (Array.isArray(schema.enum) && !(schema.enum as unknown[]).includes(value)) errors.push(`${path}: ${JSON.stringify(value)} not in enum`);
  if (schema.type === undefined) return;
  const types = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string];
  const actual = value === null ? "null" : Array.isArray(value) ? "array" : Number.isInteger(value) ? "integer" : typeof value;
  const matches = types.some((type) => type === actual || (type === "number" && actual === "integer"));
  if (!matches) {
    errors.push(`${path}: expected ${types.join("|")}, got ${actual}`);
    return;
  }
  if (actual === "array" && schema.items) (value as unknown[]).forEach((item, index) => check(schema.items as JsonSchema, item, `${path}[${index}]`, errors));
  if (actual === "object") {
    const record = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
    for (const key of (schema.required as string[] | undefined) ?? []) if (!(key in record)) errors.push(`${path}.${key}: missing`);
    for (const [key, item] of Object.entries(record)) {
      if (properties[key]) check(properties[key], item, `${path}.${key}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${path}.${key}: not in schema`);
    }
  }
}

function assertMatches(schema: JsonSchema, value: unknown, label: string) {
  const errors: string[] = [];
  check(schema, value, label, errors);
  assert.deepEqual(errors, [], label);
}

/* ------------------------------------------------------------------ */

describe("OpenAPI resource schemas", () => {
  const resources = [...new Set(ENDPOINT_LIST.map((def) => def.response.resource))] as ApiResourceName[];

  it("describes every response resource field by field", () => {
    for (const name of resources) {
      const schema = doc.components.schemas[name]!;
      assert.equal(schema.type, "object", name);
      assert.equal(schema.additionalProperties, false, `${name} is closed`);
      assert.ok(Object.keys(schema.properties as object).length > 1, `${name} has fields`);
    }
  });

  it("every documented example matches its schema", () => {
    for (const name of resources) assertMatches(doc.components.schemas[name]!, resourceExample(name, BASE), name);
  });

  it("success responses carry the full example body, lists with page meta", () => {
    for (const def of ENDPOINT_LIST) {
      const content = (doc.paths[def.path]![def.method.toLowerCase()]!.responses as Record<string, JsonSchema>)[String(def.response.status)]!.content as Record<string, JsonSchema>;
      const json = content["application/json"]!;
      assert.deepEqual(json.example, responseExample(def.response, BASE), def.id);
      assertMatches(json.schema as JsonSchema, json.example, def.id);
    }
  });

  it("the example signing secret has the real format", () => {
    assert.ok(isWebhookSecret((resourceExample("WebhookEndpointWithSecret", BASE) as { secret: string }).secret));
  });

  it("resourceFields flattens a schema for the docs", () => {
    const fields = resourceFields("Course");
    assert.deepEqual(fields.map((f) => f.name), Object.keys(RESOURCE_SCHEMAS.Course!.properties as object));
    const category = fields.find((f) => f.name === "category")!;
    assert.equal(category.type, "object | null");
    assert.equal(fields.find((f) => f.name === "instructors")!.type, "UserRef[]");
    assert.deepEqual(fields.find((f) => f.name === "status")!.values, ["in_progress", "under_review", "approved"]);
    assert.equal(describeSchemaType({ type: ["string", "null"], format: "date-time" }), "string (date-time) | null");
    const lesson = resourceFields("Lesson");
    assert.equal(lesson.find((f) => f.name === "blocks")!.required, false);
    assert.equal(lesson.find((f) => f.name === "title")!.required, true);
  });
});

describe("OpenAPI webhooks", () => {
  it("documents every event as an incoming POST with the signature headers", () => {
    assert.deepEqual(Object.keys(doc.webhooks).sort(), WEBHOOK_EVENTS.map((e) => e.name).sort());
    for (const event of WEBHOOK_EVENTS) {
      const post = doc.webhooks[event.name]!.post;
      const headers = (post.parameters as { name: string; in: string }[]).filter((p) => p.in === "header").map((p) => p.name);
      assert.deepEqual(headers, WEBHOOK_HEADERS.map((h) => h.name));
      assert.ok(headers.includes("LL-Signature"));
      const json = ((post.requestBody as JsonSchema).content as Record<string, JsonSchema>)["application/json"]!;
      assertMatches(json.schema as JsonSchema, json.example, event.name);
    }
  });

  it("event data schemas accept the documented example and require the related records", () => {
    for (const event of WEBHOOK_EVENTS) {
      const schema = eventDataSchema(event);
      assertMatches(schema, exampleEventData(event.name, BASE), event.name);
      const hasUser = event.fields.some((f) => f.name === "userId" && !f.optional);
      if (hasUser) assert.ok((schema.required as string[]).includes("user"), `${event.name} requires user`);
    }
    const certificate = eventDataSchema(WEBHOOK_EVENTS.find((e) => e.name === "certificate.issued")!);
    assert.ok(!(certificate.required as string[]).includes("course"), "an optional id makes its record optional");
  });
});

describe("openapi.json route", () => {
  it("serves the document publicly with CORS and caching", async () => {
    const response = openapiGet();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.match(response.headers.get("cache-control") ?? "", /max-age=300/);
    const body = (await response.json()) as { openapi: string; paths: object };
    assert.equal(body.openapi, "3.1.0");
    assert.ok(Object.keys(body.paths).length > 10);
  });

  it("answers other methods with a JSON 405", async () => {
    for (const handler of [openapiPost, openapiDelete]) {
      const response = handler(new Request("http://localhost:3000/api/v1/openapi.json", { method: "POST" }) as unknown as NextRequest);
      assert.equal(response.status, 405);
      assert.match(response.headers.get("allow") ?? "", /GET/);
      assert.equal(((await response.json()) as { error: { code: string } }).error.code, "method_not_allowed");
    }
  });
});

describe("/developers view models", () => {
  const docs = buildEndpointDocs(ENDPOINT_LIST, BASE);

  it("every path parameter has a documented example value", () => {
    for (const def of ENDPOINT_LIST) {
      for (const name of [...def.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!)) assert.ok(def.examples?.params?.[name], `${def.id}.${name}`);
      assert.ok(!exampleUrl(def, BASE).includes("{"), def.id);
    }
  });

  it("builds the example URL with path parameters and query", () => {
    assert.equal(exampleUrl(endpoints.getKeyInfo, BASE), `${BASE}/api/v1`);
    assert.equal(exampleUrl(endpoints.listCourses, BASE), `${BASE}/api/v1/courses?published=true&perPage=50`);
    assert.equal(exampleUrl({ path: "/x/{id}", examples: { params: { id: "a b/c" } } }, BASE), `${BASE}/api/v1/x/a%20b%2Fc`);
    assert.equal(exampleUrl({ path: "/x/{id}" }, BASE), `${BASE}/api/v1/x/%3Cid%3E`);
  });

  it("writes curl commands that send the key and the JSON body", () => {
    assert.equal(curlExample(endpoints.getKeyInfo, BASE), `curl "${BASE}/api/v1" \\\n  -H "Authorization: Bearer $LL_API_KEY"`);
    const create = curlExample(endpoints.createUser, BASE);
    assert.match(create, /^curl -X POST "https:\/\/lms\.example\/api\/v1\/users"/);
    assert.match(create, /-H "Content-Type: application\/json"/);
    const json = create.slice(create.indexOf("-d '") + 4, -1);
    assert.deepEqual(JSON.parse(json), endpoints.createUser.examples.body);
    const quoted = curlExample({ method: "POST", path: "/x", body: s.object({}), examples: { body: { name: "O'Brien" } } }, BASE);
    assert.ok(quoted.includes(`"O'\\''Brien"`), "single quotes are escaped for the shell");
  });

  it("writes fetch examples that parse the envelope", () => {
    const list = fetchExample(endpoints.listCourses, BASE);
    assert.match(list, /const \{ data, meta \} = await response\.json\(\);$/);
    assert.ok(!list.includes("method:"), "GET is the default");
    const create = fetchExample(endpoints.createWebhook, BASE);
    assert.match(create, /method: "POST"/);
    assert.match(create, /body: JSON\.stringify\(\{/);
    assert.match(create, /process\.env\.LL_API_KEY/);
  });

  it("lists required fields first, with limits and allowed values", () => {
    const params = schemaParams(endpoints.createUser.body, "body", endpoints.createUser.examples.body);
    assert.deepEqual(params.slice(0, 2).map((p) => p.name), ["name", "email"]);
    const name = params.find((p) => p.name === "name")!;
    assert.deepEqual(name.constraints, ["2–100 characters"]);
    assert.equal(name.example, "Priya Sharma");
    const roles = params.find((p) => p.name === "roles")!;
    assert.equal(roles.type, "enum[]");
    assert.ok(roles.values!.includes("student") && !roles.values!.includes("admin"));
    assert.equal(params.find((p) => p.name === "email")!.type, "string (email)");
    const perPage = schemaParams(endpoints.listCourses.query, "query").find((p) => p.name === "perPage")!;
    assert.deepEqual(perPage.constraints, ["1–100"]);
  });

  it("documents each endpoint's statuses and body rules", () => {
    const enroll = docs.find((d) => d.id === "createEnrollment")!;
    assert.deepEqual(enroll.alsoReturns.map((r) => r.status), [200]);
    assert.ok(enroll.bodyRules.some((rule) => rule.includes("`userId` or `email`")));
    assert.deepEqual(enroll.errors.map((e) => e.status), [400, 401, 403, 404, 429, 500]);
    const patch = docs.find((d) => d.id === "updateCourse")!;
    assert.ok(patch.bodyRules.some((rule) => rule.startsWith("Send at least one field")));
    assert.equal(docs.find((d) => d.id === "getKeyInfo")!.scope, null);
  });

  it("filters endpoints by words, tag and method and groups them by tag", () => {
    assert.equal(filterEndpointDocs(docs, NO_ENDPOINT_FILTER).length, docs.length);
    const webhooks = filterEndpointDocs(docs, { q: "", tag: "Webhooks", method: "" });
    assert.ok(webhooks.length >= 8 && webhooks.every((d) => d.tag === "Webhooks"));
    assert.deepEqual(filterEndpointDocs(docs, { q: "enroll email", tag: "", method: "POST" }).map((d) => d.id), ["createEnrollment", "addBatchMember"]);
    assert.deepEqual(filterEndpointDocs(docs, { q: "email", tag: "Users", method: "POST" }).map((d) => d.id), ["createUser"]);
    assert.deepEqual(filterEndpointDocs(docs, { q: "/api/v1/payments", tag: "", method: "" }).map((d) => d.id), ["listPayments"]);
    assert.deepEqual(filterEndpointDocs(docs, { q: "zzz-nothing", tag: "", method: "" }), []);
    const groups = groupEndpointDocs(webhooks, API_TAGS);
    assert.deepEqual(groups.map((g) => g.tag), ["Webhooks"]);
  });

  it("documents every error code with the status the API uses", () => {
    for (const [code, info] of Object.entries(ERROR_CODES)) {
      assert.ok(info.description.length > 10, code);
      assert.notEqual(errorDescription(info.status), "The request could not be completed.", `${code} → ${info.status}`);
    }
  });
});

describe("signature verification samples", () => {
  /** The Node.js sample from the docs, run as written (minus the ES module syntax). */
  function loadNodeSample(): (raw: string, header: string | null, secret: string, tolerance?: number) => boolean {
    const source = NODE_VERIFY_SAMPLE.replace(/^import .*$/m, "").replace("export function", "function");
    return new Function("createHmac", "timingSafeEqual", "Buffer", `${source}\nreturn verifyLearnLoopSignature;`)(createHmac, timingSafeEqual, Buffer);
  }

  it("the Node.js sample accepts a real signature and rejects tampering, other secrets and stale requests", () => {
    const verify = loadNodeSample();
    const secret = generateWebhookSecret();
    const body = JSON.stringify(buildTestPayload("payment.paid", BASE, "evt_test_1"));
    const now = Math.floor(Date.now() / 1000);
    assert.equal(verify(body, signatureHeader(secret, body, now), secret), true);
    assert.equal(verify(`${body} `, signatureHeader(secret, body, now), secret), false);
    assert.equal(verify(body, signatureHeader(generateWebhookSecret(), body, now), secret), false);
    assert.equal(verify(body, signatureHeader(secret, body, now - 3600), secret), false);
    assert.equal(verify(body, null, secret), false);
    assert.equal(verify(body, "t=abc,v1=00", secret), false);
    // During a secret rotation a header may carry several v1 values.
    const both = `${signatureHeader(generateWebhookSecret(), body, now)},v1=${signatureHeader(secret, body, now).split("v1=")[1]}`;
    assert.equal(verify(body, both, secret), true);
  });

  it("offers Node.js, Python and PHP", () => {
    assert.deepEqual(VERIFY_SAMPLES.map((sample) => sample.label), ["Node.js", "Python", "PHP"]);
    for (const sample of VERIFY_SAMPLES) assert.ok(sample.code.includes("LL-Signature") || sample.code.includes("LL_SIGNATURE"), sample.label);
  });
});
