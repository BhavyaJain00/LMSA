import assert from "node:assert/strict";
import { test } from "node:test";
import { ENDPOINT_LIST } from "@/lib/api/endpoints";
import { buildOpenApiDocument, errorStatusesFor, SHARED_ERROR_STATUSES } from "@/lib/api/openapi";

type Doc = {
  openapi: string;
  servers: { url: string }[];
  tags: { name: string }[];
  paths: Record<string, Record<string, Record<string, unknown>>>;
  components: { schemas: Record<string, unknown>; securitySchemes: Record<string, { scheme: string }> };
};

const doc = buildOpenApiDocument(ENDPOINT_LIST, "https://lms.example") as unknown as Doc;

test("openapi: document is 3.1 and served from the public origin", () => {
  assert.equal(doc.openapi, "3.1.0");
  assert.deepEqual(doc.servers, [{ url: "https://lms.example/api/v1" }]);
  assert.equal(doc.components.securitySchemes.apiKey.scheme, "bearer");
});

test("openapi: every registered endpoint becomes exactly one operation", () => {
  const operations = Object.values(doc.paths).flatMap((methods) => Object.values(methods));
  assert.equal(operations.length, ENDPOINT_LIST.length);
  assert.equal(new Set(operations.map((operation) => operation.operationId)).size, ENDPOINT_LIST.length);
  for (const def of ENDPOINT_LIST) {
    const operation = doc.paths[def.path]?.[def.method.toLowerCase()];
    assert.ok(operation, `${def.method} ${def.path}`);
    assert.equal(operation.operationId, def.id);
    assert.equal(Boolean(operation.requestBody), Boolean(def.body), `${def.id} request body`);
  }
});

test("openapi: path parameters in the template are all declared", () => {
  for (const def of ENDPOINT_LIST) {
    const names = [...def.path.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
    const operation = doc.paths[def.path][def.method.toLowerCase()];
    const declared = ((operation.parameters ?? []) as { name: string; in: string; required: boolean }[]).filter((p) => p.in === "path");
    assert.deepEqual(declared.map((p) => p.name).sort(), [...names].sort(), def.id);
    assert.ok(declared.every((p) => p.required));
  }
});

test("openapi: responses document the success status and the shared errors", () => {
  for (const def of ENDPOINT_LIST) {
    const responses = doc.paths[def.path][def.method.toLowerCase()].responses as Record<string, unknown>;
    assert.ok(responses[String(def.response.status)], `${def.id} success`);
    for (const status of SHARED_ERROR_STATUSES) assert.ok(responses[String(status)], `${def.id} ${status}`);
    assert.ok(doc.components.schemas[def.response.resource], `${def.id} resource schema`);
  }
});

test("openapi: errorStatusesFor merges, de-duplicates and sorts", () => {
  assert.deepEqual(errorStatusesFor({ errors: [404, 400, 401] }), [400, 401, 403, 404, 429, 500]);
});

test("openapi: only tags in use are listed", () => {
  const used = new Set(ENDPOINT_LIST.map((def) => def.tag));
  assert.deepEqual(doc.tags.map((tag) => tag.name).sort(), [...used].sort());
});
