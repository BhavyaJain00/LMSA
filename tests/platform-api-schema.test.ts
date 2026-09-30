import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isIsoDay, parseIsoTimestamp, s, searchParamsToObject, toJsonSchema, validate, type Infer } from "@/lib/api/schema";
import { ENDPOINT_LIST, endpoints } from "@/lib/api/endpoints";
import { API_SCOPE_IDS } from "@/lib/api/scopes";

type IsAny<T> = 0 extends 1 & T ? true : false;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const body = s.object(
  {
    name: s.string({ minLength: 2, maxLength: 10 }),
    email: s.string({ optional: true, lowercase: true, format: "email" }),
    role: s.enum(["student", "admin"] as const, { optional: true }),
    count: s.integer({ optional: true, minimum: 1, maximum: 5 }),
    active: s.boolean({ optional: true }),
    categoryId: s.string({ optional: true, nullable: true }),
    tags: s.array(s.string({ minLength: 1 }), { optional: true, maxItems: 3, dedupe: true }),
  },
  { anyOf: ["name"] },
);

describe("schema types", () => {
  it("infers precise types (never any)", () => {
    type Body = Infer<typeof body>;
    const notAny: IsAny<Body> = false;
    const role: Equal<Body["role"], "student" | "admin" | undefined> = true;
    const category: Equal<Body["categoryId"], string | null | undefined> = true;
    const name: Equal<Body["name"], string> = true;
    type Query = Infer<NonNullable<(typeof endpoints)["listCourses"]["query"]>>;
    const published: Equal<Query["published"], boolean | undefined> = true;
    assert.deepEqual([notAny, role, category, name, published], [false, true, true, true, true]);
  });
});

describe("validate", () => {
  it("accepts valid input, trims strings and lower-cases where asked", () => {
    const result = validate(body, { name: "  Ada  ", email: "ADA@Example.com", tags: ["a", "A", "b"] });
    assert.ok(result.ok);
    assert.deepEqual(result.value, { name: "Ada", email: "ada@example.com", tags: ["a", "b"] });
  });

  it("reports every problem with the field path", () => {
    const result = validate(body, { name: "A", email: "nope", role: "owner", count: 9, active: "yes", tags: ["ok", ""], extra: 1 });
    assert.ok(!result.ok);
    assert.equal(result.details.name, "Must be at least 2 characters.");
    assert.equal(result.details.email, "Must be a valid email address.");
    assert.equal(result.details.role, 'Must be one of "student", "admin".');
    assert.equal(result.details.count, "Must be 5 or less.");
    assert.equal(result.details.active, "Must be true or false, got a string.");
    assert.equal(result.details["tags[1]"], "Must not be empty.");
    assert.equal(result.details.extra, "Unknown field.");
  });

  it("requires required fields and rejects non-objects", () => {
    const missing = validate(body, {});
    assert.ok(!missing.ok);
    assert.equal(missing.details.name, "This field is required.");
    const notObject = validate(body, [1, 2]);
    assert.ok(!notObject.ok);
    assert.equal(notObject.details.body, "Must be a JSON object, got an array.");
  });

  it("accepts null only for nullable fields", () => {
    assert.ok(validate(body, { name: "Ada", categoryId: null }).ok);
    const result = validate(body, { name: "Ada", email: null });
    assert.ok(!result.ok);
    assert.equal(result.details.email, "Must not be null.");
  });

  it("rejects prototype-polluting keys", () => {
    const result = validate(body, JSON.parse('{"name":"Ada","__proto__":{"admin":true}}'));
    assert.ok(!result.ok);
    assert.equal(result.details.__proto__, "Unknown field.");
  });

  it("enforces anyOf and nonEmpty", () => {
    const member = s.object({ userId: s.string({ optional: true }), email: s.string({ optional: true }) }, { anyOf: ["userId", "email"] });
    const none = validate(member, {});
    assert.ok(!none.ok);
    assert.equal(none.details.body, 'Send one of "userId", "email".');
    assert.ok(validate(member, { email: "a@b.co" }).ok);
    const patch = s.object({ title: s.string({ optional: true }) }, { nonEmpty: true });
    assert.ok(!validate(patch, {}).ok);
  });

  it("rejects floats and oversized arrays", () => {
    const result = validate(body, { name: "Ada", count: 1.5, tags: ["a", "b", "c", "d"] });
    assert.ok(!result.ok);
    assert.match(result.details.count!, /whole number/);
    assert.equal(result.details.tags, "Must have at most 3 items.");
  });

  it("coerces query-string values", () => {
    const query = s.object({ page: s.integer({ optional: true, minimum: 1 }), published: s.boolean({ optional: true }), q: s.string({ optional: true }) }, { allowUnknown: true });
    const ok = validate(query, { page: "3", published: "false", q: "", other: "x" }, { coerce: true });
    assert.ok(ok.ok);
    assert.deepEqual(ok.value, { page: 3, published: false });
    const bad = validate(query, { page: "2.5", published: "maybe" }, { coerce: true });
    assert.ok(!bad.ok);
    assert.equal(bad.details.page, "Must be a whole number.");
    assert.equal(bad.details.published, 'Must be "true" or "false".');
  });

  it("checks date, date-time, url, slug and username formats", () => {
    const formats = s.object({
      day: s.string({ optional: true, format: "date" }),
      at: s.string({ optional: true, format: "date-time" }),
      url: s.string({ optional: true, format: "url" }),
      slug: s.string({ optional: true, format: "slug" }),
      username: s.string({ optional: true, format: "username" }),
    });
    assert.ok(validate(formats, { day: "2026-02-28", at: "2026-02-28T10:00:00Z", url: "/uploads/a.png", slug: "intro-to-js", username: "ada_l" }).ok);
    const bad = validate(formats, { day: "2026-02-30", at: "yesterday", url: "javascript:alert(1)", slug: "Intro JS", username: "a" });
    assert.ok(!bad.ok);
    assert.deepEqual(Object.keys(bad.details).sort(), ["at", "day", "slug", "url", "username"]);
    assert.ok(!validate(formats, { url: "//evil.example/x" }).ok);
  });

  it("parses ISO timestamps strictly", () => {
    assert.equal(parseIsoTimestamp("2026-01-01"), Date.parse("2026-01-01T00:00:00Z"));
    assert.equal(parseIsoTimestamp("2026-01-01T10:30:00+02:00"), Date.parse("2026-01-01T08:30:00Z"));
    assert.equal(parseIsoTimestamp("2026-13-01"), null);
    assert.equal(parseIsoTimestamp("1700000000"), null);
    assert.equal(isIsoDay("2024-02-29"), true);
    assert.equal(isIsoDay("2025-02-29"), false);
  });

  it("uses the first value of repeated query keys", () => {
    assert.deepEqual(searchParamsToObject(new URLSearchParams("a=1&a=2&b=3")), { a: "1", b: "3" });
  });
});

describe("toJsonSchema", () => {
  it("describes objects with required fields, nullability and formats", () => {
    const schema = toJsonSchema(body);
    assert.equal(schema.type, "object");
    assert.deepEqual(schema.required, ["name"]);
    assert.equal(schema.additionalProperties, false);
    const props = schema.properties as Record<string, Record<string, unknown>>;
    assert.deepEqual(props.categoryId!.type, ["string", "null"]);
    assert.equal(props.email!.format, "email");
    assert.deepEqual(props.role!.enum, ["student", "admin"]);
    assert.deepEqual(props.tags, { type: "array", items: { type: "string", minLength: 1 }, maxItems: 3 });
  });
});

describe("endpoint definitions", () => {
  it("have unique ids and method+path pairs, and valid scopes", () => {
    const ids = new Set(ENDPOINT_LIST.map((e) => e.id));
    assert.equal(ids.size, ENDPOINT_LIST.length);
    const routes = new Set(ENDPOINT_LIST.map((e) => `${e.method} ${e.path}`));
    assert.equal(routes.size, ENDPOINT_LIST.length);
    for (const e of ENDPOINT_LIST) {
      if (e.scope) assert.ok(API_SCOPE_IDS.includes(e.scope), e.id);
      const pathParams = [...e.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      assert.deepEqual(pathParams.sort(), Object.keys(e.params ?? {}).sort(), `${e.id} params`);
      if (e.method === "GET") assert.equal(e.body, undefined, `${e.id} has no body`);
      if (e.response.list) assert.ok(e.query, `${e.id} lists accept pagination`);
    }
  });

  it("cover every endpoint of the brief", () => {
    const routes = ENDPOINT_LIST.map((e) => `${e.method} ${e.path}`);
    for (const expected of [
      "GET /courses",
      "GET /courses/{id}",
      "POST /courses",
      "PATCH /courses/{id}",
      "GET /users",
      "GET /users/{id}",
      "PATCH /users/{id}",
      "POST /users",
      "GET /enrollments",
      "POST /enrollments",
      "DELETE /enrollments/{id}",
      "GET /progress",
      "GET /payments",
      "GET /certificates",
      "GET /batches",
      "POST /batches/{id}/members",
    ]) {
      assert.ok(routes.includes(expected), expected);
    }
  });
});
