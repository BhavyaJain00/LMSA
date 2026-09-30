import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";
import type { ApiKey } from "@/lib/types";
import { generateApiKey } from "@/lib/api/keys";
import { apiKeyLimiter } from "@/lib/api/rate-limit";
import { API_SCOPE_IDS } from "@/lib/api/scopes";
import { getDb } from "@/lib/db/store";
import { settleEvents } from "@/lib/events";
import { GET as keyInfo } from "@/app/api/v1/route";
import { GET as listCourses, POST as createCourse, PUT as putCourses } from "@/app/api/v1/courses/route";
import { GET as getCourse, PATCH as patchCourse } from "@/app/api/v1/courses/[id]/route";
import { GET as listUsers, POST as createUser } from "@/app/api/v1/users/route";
import { GET as getUser, PATCH as patchUser } from "@/app/api/v1/users/[id]/route";
import { GET as listEnrollments, POST as createEnrollment } from "@/app/api/v1/enrollments/route";
import { DELETE as deleteEnrollment, GET as getEnrollment } from "@/app/api/v1/enrollments/[id]/route";
import { GET as listProgress } from "@/app/api/v1/progress/route";
import { GET as listPayments } from "@/app/api/v1/payments/route";
import { GET as listCertificates } from "@/app/api/v1/certificates/route";
import { GET as listBatches } from "@/app/api/v1/batches/route";
import { POST as addBatchMember } from "@/app/api/v1/batches/[id]/members/route";
import { GET as unknownPath } from "@/app/api/v1/[...path]/route";
import { makeBatch, makeChapter, makeCourse, makeEnrollment, makeLesson, makePayment, makeProgress, makeUser, resetDb } from "./helpers/db";

/** Parsed response bodies are inspected freely in assertions. */
type Json = ReturnType<typeof JSON.parse>;
type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

const BASE = "http://localhost:3000/api/v1";
const admin = makeUser({ id: "usr_admin", name: "Admin", roles: ["admin"] });
const teacher = makeUser({ id: "usr_teacher", name: "Teacher", roles: ["course_creator"] });
const ada = makeUser({ id: "usr_ada", name: "Ada", email: "ada@example.com", twoFactorSecretEnc: "v1.secret", recoveryCodeHashes: ["h"], calendarToken: "cal" });
const course = makeCourse({ id: "crs_js", slug: "javascript", title: "JavaScript", instructorIds: [teacher.id], tags: ["web"] });
const draft = makeCourse({ id: "crs_draft", slug: "draft", title: "Draft", published: false, status: "in_progress", instructorIds: [teacher.id] });
const chapter = makeChapter({ id: "chp_1", courseId: course.id });
const lesson1 = makeLesson({ id: "les_1", courseId: course.id, chapterId: chapter.id, order: 1, instructorNotes: "secret notes" });
const lesson2 = makeLesson({ id: "les_2", courseId: course.id, chapterId: chapter.id, order: 2 });
const batch = makeBatch({ id: "bat_1", slug: "spring", title: "Spring cohort", courseIds: [course.id], seatCount: 1 });

let keys: Record<string, string> = {};

function keyRow(id: string, scopes: readonly string[], extra: Partial<ApiKey> = {}): { row: ApiKey; key: string } {
  const generated = generateApiKey();
  return { key: generated.key, row: { id, name: id, prefix: generated.prefix, keyHash: generated.keyHash, scopes: [...scopes], createdById: admin.id, createdAt: "2026-01-01T00:00:00.000Z", ...extra } };
}

async function call(handler: Handler, method: string, path: string, opts: { key?: string | null; body?: unknown; params?: Record<string, string>; rawBody?: string; contentType?: string } = {}) {
  const headers = new Headers();
  if (opts.key !== null) headers.set("authorization", `Bearer ${opts.key ?? keys.full}`);
  let body: string | undefined;
  if (opts.rawBody !== undefined || opts.body !== undefined) {
    body = opts.rawBody ?? JSON.stringify(opts.body);
    headers.set("content-type", opts.contentType ?? "application/json");
  }
  const request = new Request(`${BASE}${path}`, { method, headers, body }) as unknown as NextRequest;
  const response = await handler(request, { params: Promise.resolve(opts.params ?? {}) });
  const text = await response.text();
  return { status: response.status, headers: response.headers, json: (text ? JSON.parse(text) : null) as Json };
}

beforeEach(async () => {
  const full = keyRow("key_full", API_SCOPE_IDS);
  const read = keyRow("key_read", ["courses:read", "users:read"]);
  const revoked = keyRow("key_revoked", API_SCOPE_IDS, { revokedAt: "2026-01-02T00:00:00.000Z" });
  keys = { full: full.key, read: read.key, revoked: revoked.key };
  for (const id of ["key_full", "key_read", "key_revoked"]) apiKeyLimiter.reset(id);
  await resetDb({
    users: [admin, teacher, ada],
    courses: [course, draft],
    chapters: [chapter],
    lessons: [lesson1, lesson2],
    enrollments: [makeEnrollment({ id: "enr_1", userId: ada.id, courseId: course.id, progress: 50 })],
    progress: [makeProgress(lesson1, ada.id, { updatedAt: "2026-01-20T00:00:00.000Z" })],
    payments: [
      makePayment({ id: "pay_1", userId: ada.id, itemId: course.id, status: "paid", paidAt: "2026-01-15T12:00:00.000Z", gstin: "GSTSECRET", checkoutUrl: "https://checkout.example/secret", address: { line1: "1 Road", city: "Pune", country: "IN" } }),
      makePayment({ id: "pay_2", userId: ada.id, itemId: course.id, status: "pending" }),
    ],
    certificates: [{ id: "cert_1", code: "LL-AAAA-BBBB", userId: ada.id, courseId: course.id, issueDate: "2026-01-10", published: true }],
    batches: [batch],
    apiKeys: [full.row, read.row, revoked.row],
    settings: { email: { enabled: false }, gamification: { enabled: false }, commerce: { paymentGateway: "none" } },
  });
});

describe("API authentication", () => {
  it("requires a bearer key", async () => {
    const res = await call(listCourses, "GET", "/courses", { key: null });
    assert.equal(res.status, 401);
    assert.equal(res.json!.error.code, "unauthorized");
    assert.match(res.headers.get("www-authenticate") ?? "", /Bearer/);
    assert.ok(res.headers.get("x-request-id"));
  });

  it("rejects unknown and revoked keys", async () => {
    const unknown = await call(listCourses, "GET", "/courses", { key: generateApiKey().key });
    assert.equal(unknown.status, 401);
    assert.equal(unknown.json!.error.code, "invalid_api_key");
    const revoked = await call(listCourses, "GET", "/courses", { key: keys.revoked });
    assert.equal(revoked.status, 401);
    assert.equal(revoked.json!.error.code, "revoked_api_key");
  });

  it("stops accepting a key once its creator is no longer an enabled admin", async () => {
    const db = await getDb();
    db.users.find((u) => u.id === admin.id)!.roles = ["moderator"];
    const res = await call(listCourses, "GET", "/courses");
    assert.equal(res.status, 401);
    assert.equal(res.json!.error.code, "invalid_api_key");
    assert.match(res.json!.error.message, /no longer an active administrator/);
  });

  it("enforces scopes with a precise error", async () => {
    const res = await call(listPayments, "GET", "/payments", { key: keys.read });
    assert.equal(res.status, 403);
    assert.equal(res.json!.error.code, "insufficient_scope");
    assert.equal(res.json!.error.details.required, "payments:read");
  });

  it("refuses everything when the API is switched off", async () => {
    const db = await getDb();
    db.settings.api.enabled = false;
    const res = await call(listCourses, "GET", "/courses");
    assert.equal(res.status, 403);
    assert.equal(res.json!.error.code, "api_disabled");
  });

  it("rate limits per key with headers and Retry-After", async () => {
    const ok = await call(keyInfo, "GET", "");
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("x-ratelimit-limit"), "120");
    assert.equal(ok.headers.get("x-ratelimit-remaining"), "119");
    assert.match(ok.headers.get("x-ratelimit-reset") ?? "", /^\d+$/);
    assert.equal(ok.headers.get("cache-control"), "no-store");
    for (let i = 0; i < 119; i++) apiKeyLimiter.hit("key_full", { limit: 120, windowMs: 60_000 });
    const limited = await call(keyInfo, "GET", "");
    assert.equal(limited.status, 429);
    assert.equal(limited.json!.error.code, "rate_limited");
    assert.match(limited.headers.get("retry-after") ?? "", /^\d+$/);
    // Other keys have their own budget.
    assert.equal((await call(listCourses, "GET", "/courses", { key: keys.read })).status, 200);
  });

  it("describes the key and records its use", async () => {
    const res = await call(keyInfo, "GET", "");
    assert.equal(res.json!.data.key.id, "key_full");
    assert.equal(res.json!.data.rateLimit.limit, 120);
    assert.ok(!JSON.stringify(res.json).includes("keyHash"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const db = await getDb();
    assert.ok(db.apiKeys.find((k) => k.id === "key_full")!.lastUsedAt);
  });

  it("answers unknown paths with the JSON envelope", async () => {
    const res = await call(unknownPath as unknown as Handler, "GET", "/nope");
    assert.equal(res.status, 404);
    assert.equal(res.json!.error.code, "not_found");
  });

  it("answers unsupported methods with 405, the JSON envelope and an Allow header", async () => {
    const put = await call(putCourses as unknown as Handler, "PUT", "/courses", { body: {} });
    assert.equal(put.status, 405);
    assert.equal(put.json!.error.code, "method_not_allowed");
    assert.deepEqual(put.json!.error.details.allowed, ["GET", "POST"]);
    assert.equal(put.headers.get("allow"), "GET, POST, HEAD, OPTIONS");
    assert.equal(put.headers.get("cache-control"), "no-store");
    const get = await call(getEnrollment as unknown as Handler, "GET", "/enrollments/enr_1", { params: { id: "enr_1" } });
    assert.equal(get.status, 405);
    assert.equal(get.headers.get("allow"), "DELETE, OPTIONS");
    assert.match(get.json!.error.message, /GET is not supported on \/api\/v1\/enrollments\/enr_1\. Use DELETE\./);
  });

  it("builds pagination links on the site's public origin", async () => {
    // Behind a reverse proxy the request URL carries the internal host.
    const request = new Request("http://10.0.0.5:8080/api/v1/courses?per_page=1", { headers: { authorization: `Bearer ${keys.full}` } }) as unknown as NextRequest;
    const response = await listCourses(request, { params: Promise.resolve({}) });
    assert.equal(response.status, 200);
    const link = response.headers.get("link") ?? "";
    assert.match(link, /<http:\/\/localhost:3000\/api\/v1\/courses\?page=2&perPage=1>; rel="next"/);
    assert.ok(!link.includes("10.0.0.5"));
  });
});

describe("courses", () => {
  it("lists courses with filters and pagination meta", async () => {
    const all = await call(listCourses, "GET", "/courses?perPage=1");
    assert.equal(all.status, 200);
    assert.deepEqual(all.json!.meta, { page: 1, perPage: 1, total: 2, totalPages: 2, hasMore: true });
    assert.match(all.headers.get("link") ?? "", /rel="next"/);
    const published = await call(listCourses, "GET", "/courses?published=true&tag=WEB");
    assert.deepEqual(
      published.json!.data.map((c: { id: string }) => c.id),
      [course.id],
    );
    assert.equal(published.json!.data[0].lessonCount, 2);
    assert.equal(published.json!.data[0].instructors[0].name, "Teacher");
  });

  it("explains invalid query parameters", async () => {
    const res = await call(listCourses, "GET", "/courses?perPage=500&published=maybe&updated_since=yesterday");
    assert.equal(res.status, 400);
    assert.equal(res.json!.error.code, "validation_failed");
    assert.deepEqual(Object.keys(res.json!.error.details).sort(), ["perPage", "published", "updated_since"]);
  });

  it("returns the outline, with lesson content only for courses:write", async () => {
    const reader = await call(getCourse, "GET", "/courses/javascript", { key: keys.read, params: { id: "javascript" } });
    assert.equal(reader.status, 200);
    const lessons = reader.json!.data.outline[0].lessons;
    assert.deepEqual(
      lessons.map((l: { id: string; number: string }) => [l.id, l.number]),
      [
        ["les_1", "1-1"],
        ["les_2", "1-2"],
      ],
    );
    assert.equal(lessons[0].blocks, undefined);
    assert.equal(lessons[0].instructorNotes, undefined);
    const writer = await call(getCourse, "GET", "/courses/crs_js", { params: { id: "crs_js" } });
    assert.equal(writer.json!.data.outline[0].lessons[0].instructorNotes, "secret notes");
    assert.ok(Array.isArray(writer.json!.data.outline[0].lessons[0].blocks));
    const missing = await call(getCourse, "GET", "/courses/nope", { params: { id: "nope" } });
    assert.equal(missing.status, 404);
  });

  it("creates a course with validation and an audit entry", async () => {
    const invalid = await call(createCourse, "POST", "/courses", { body: { title: "", shortIntroduction: "x", description: "y", price: -1, bogus: true } });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.json!.error.details.title, "Must not be empty.");
    assert.equal(invalid.json!.error.details.price, "Must be 0 or more.");
    assert.equal(invalid.json!.error.details.bogus, "Unknown field.");

    const res = await call(createCourse, "POST", "/courses", {
      body: { title: "Data Analysis", shortIntroduction: "Learn data.", description: "# Hello", tags: ["data", "Data"], instructorIds: [teacher.id] },
    });
    assert.equal(res.status, 201);
    assert.equal(res.json!.data.slug, "data-analysis");
    assert.deepEqual(res.json!.data.tags, ["data"]);
    assert.equal(res.json!.data.published, false);
    const db = await getDb();
    const stored = db.courses.find((c) => c.slug === "data-analysis")!;
    assert.equal(stored.createdById, admin.id);
    const event = db.auditEvents.find((e) => e.action === "api.course.create");
    assert.equal(event?.actorId, admin.id);
    assert.equal(event?.meta?.apiKeyId, "key_full");
  });

  it("refuses a read-only key, paid courses without a gateway and taken slugs", async () => {
    assert.equal((await call(createCourse, "POST", "/courses", { key: keys.read, body: { title: "T", shortIntroduction: "S", description: "D" } })).status, 403);
    const paid = await call(patchCourse, "PATCH", "/courses/crs_js", { params: { id: "crs_js" }, body: { paidCourse: true, price: 4900 } });
    assert.equal(paid.status, 400);
    assert.match(paid.json!.error.details.paidCourse, /payment gateway/);
    const taken = await call(patchCourse, "PATCH", "/courses/crs_js", { params: { id: "crs_js" }, body: { slug: "draft" } });
    assert.equal(taken.status, 409);
    assert.equal(taken.json!.error.code, "conflict");
    const empty = await call(patchCourse, "PATCH", "/courses/crs_js", { params: { id: "crs_js" }, body: {} });
    assert.equal(empty.status, 400);
    const youtube = await call(patchCourse, "PATCH", "/courses/crs_js", { params: { id: "crs_js" }, body: { videoUrl: "https://youtu.be/abc" } });
    assert.equal(youtube.status, 400);
  });

  it("updates and publishes a course", async () => {
    const res = await call(patchCourse, "PATCH", "/courses/draft", { params: { id: "draft" }, body: { title: "Final title", published: true, categoryId: null } });
    assert.equal(res.status, 200);
    assert.equal(res.json!.data.title, "Final title");
    assert.equal(res.json!.data.published, true);
    assert.equal(res.json!.data.status, "approved");
    assert.ok(res.json!.data.publishedOn);
    const db = await getDb();
    assert.ok(db.auditEvents.some((e) => e.action === "course.publish" && e.targetId === draft.id));
  });

  it("rejects bodies that are not JSON", async () => {
    const wrongType = await call(patchCourse, "PATCH", "/courses/crs_js", { params: { id: "crs_js" }, rawBody: "title=x", contentType: "application/x-www-form-urlencoded" });
    assert.equal(wrongType.status, 415);
    const broken = await call(patchCourse, "PATCH", "/courses/crs_js", { params: { id: "crs_js" }, rawBody: "{nope" });
    assert.equal(broken.status, 400);
    assert.equal(broken.json!.error.code, "invalid_json");
  });
});

describe("users", () => {
  it("never exposes secrets", async () => {
    const res = await call(getUser, "GET", "/users/usr_ada", { params: { id: ada.id } });
    assert.equal(res.status, 200);
    const text = JSON.stringify(res.json);
    for (const secret of ["passwordHash", "scrypt", "twoFactorSecretEnc", "v1.secret", "recoveryCodeHashes", "calendarToken"]) assert.ok(!text.includes(secret), secret);
    assert.equal(res.json!.data.profileUrl, `http://localhost:3000/user/${ada.username}`);
  });

  it("searches and filters members", async () => {
    const res = await call(listUsers, "GET", "/users?q=ada");
    assert.deepEqual(
      res.json!.data.map((u: { id: string }) => u.id),
      [ada.id],
    );
    const admins = await call(listUsers, "GET", "/users?role=admin");
    assert.deepEqual(
      admins.json!.data.map((u: { id: string }) => u.id),
      [admin.id],
    );
  });

  it("creates members and refuses duplicates and the admin role", async () => {
    const res = await call(createUser, "POST", "/users", { body: { name: "Grace Hopper", email: "Grace@Example.com", password: "a-long-Passw0rd!", sendWelcomeEmail: false } });
    assert.equal(res.status, 201);
    assert.equal(res.json!.data.email, "grace@example.com");
    assert.equal(res.json!.data.username, "grace");
    assert.deepEqual(res.json!.data.roles, ["student"]);
    const dup = await call(createUser, "POST", "/users", { body: { name: "Grace", email: "grace@example.com", sendWelcomeEmail: false } });
    assert.equal(dup.status, 409);
    const adminRole = await call(createUser, "POST", "/users", { body: { name: "Mallory", email: "m@example.com", roles: ["admin"], sendWelcomeEmail: false } });
    assert.equal(adminRole.status, 400);
    assert.match(adminRole.json!.error.details["roles[0]"], /Must be one of/);
    await settleEvents();
  });

  it("emails a set-password link when no password is given", async () => {
    const res = await call(createUser, "POST", "/users", { body: { name: "Linus Pauling", email: "linus@example.com" } });
    assert.equal(res.status, 201);
    const db = await getDb();
    assert.ok(db.authTokens.some((t) => t.userId === res.json!.data.id && t.purpose === "password_reset"));
    await settleEvents();
  });

  it("updates profiles, disables accounts and protects administrators", async () => {
    const res = await call(patchUser, "PATCH", "/users/usr_ada", { params: { id: ada.id }, body: { headline: "Engineer", enabled: false, roles: ["course_creator"] } });
    assert.equal(res.status, 200);
    assert.equal(res.json!.data.enabled, false);
    assert.deepEqual(res.json!.data.roles, ["course_creator"]);
    const db = await getDb();
    assert.ok(db.auditEvents.some((e) => e.action === "user.disable" && e.targetId === ada.id));
    const protectedAdmin = await call(patchUser, "PATCH", "/users/usr_admin", { params: { id: admin.id }, body: { enabled: false } });
    assert.equal(protectedAdmin.status, 403);
    const taken = await call(patchUser, "PATCH", "/users/usr_ada", { params: { id: ada.id }, body: { username: teacher.username } });
    assert.equal(taken.status, 409);
  });
});

describe("enrollments, progress, payments, certificates, batches", () => {
  it("enrolls by email idempotently and removes enrollments", async () => {
    const created = await call(createEnrollment, "POST", "/enrollments", { body: { email: "ada@example.com", courseId: draft.id } });
    assert.equal(created.status, 201);
    assert.equal(created.json!.data.courseId, draft.id);
    const again = await call(createEnrollment, "POST", "/enrollments", { body: { userId: ada.id, courseId: draft.id } });
    assert.equal(again.status, 200);
    assert.equal(again.json!.data.id, created.json!.data.id);
    const missing = await call(createEnrollment, "POST", "/enrollments", { body: { courseId: draft.id } });
    assert.equal(missing.status, 400);
    const unknown = await call(createEnrollment, "POST", "/enrollments", { body: { email: "nobody@example.com", courseId: draft.id } });
    assert.equal(unknown.status, 400);
    assert.ok(unknown.json!.error.details.email);

    const removed = await call(deleteEnrollment, "DELETE", `/enrollments/${created.json!.data.id}`, { params: { id: created.json!.data.id } });
    assert.equal(removed.status, 200);
    assert.equal(removed.json!.data.deleted, true);
    const gone = await call(deleteEnrollment, "DELETE", "/enrollments/enr_x", { params: { id: "enr_x" } });
    assert.equal(gone.status, 404);
    await settleEvents();
  });

  it("filters enrollments by updated_since using lesson progress", async () => {
    const res = await call(listEnrollments, "GET", "/enrollments?updated_since=2026-01-19");
    assert.deepEqual(
      res.json!.data.map((e: { id: string }) => e.id),
      ["enr_1"],
    );
    const later = await call(listEnrollments, "GET", "/enrollments?updated_since=2026-01-21");
    assert.equal(later.json!.meta.total, 0);
  });

  it("reports per-lesson progress", async () => {
    const res = await call(listProgress, "GET", `/progress?userId=${ada.id}&courseId=${course.id}`);
    assert.equal(res.status, 200);
    const [row] = res.json!.data;
    assert.equal(row.percent, 50);
    assert.equal(row.completedLessons, 1);
    assert.deepEqual(
      row.lessons.map((l: { lessonId: string; status: string }) => [l.lessonId, l.status]),
      [
        ["les_1", "complete"],
        ["les_2", "incomplete"],
      ],
    );
    const unknown = await call(listProgress, "GET", "/progress?userId=usr_none");
    assert.equal(unknown.status, 404);
  });

  it("lists payments without tax ids or checkout links", async () => {
    const res = await call(listPayments, "GET", "/payments?status=paid");
    assert.deepEqual(
      res.json!.data.map((p: { id: string }) => p.id),
      ["pay_1"],
    );
    assert.equal(res.json!.data[0].billingCountry, "IN");
    const text = JSON.stringify(res.json);
    assert.ok(!text.includes("GSTSECRET"));
    assert.ok(!text.includes("checkout.example"));
    assert.ok(!text.includes("1 Road"));
  });

  it("lists certificates with verification links", async () => {
    const res = await call(listCertificates, "GET", `/certificates?userId=${ada.id}`);
    assert.equal(res.json!.data[0].verifyUrl, "http://localhost:3000/certificates/LL-AAAA-BBBB");
  });

  it("lists batches and adds members with seat limits", async () => {
    const list = await call(listBatches, "GET", "/batches");
    assert.equal(list.json!.data[0].seatsLeft, 1);
    const added = await call(addBatchMember, "POST", "/batches/spring/members", { params: { id: "spring" }, body: { userId: ada.id } });
    assert.equal(added.status, 201);
    assert.equal(added.json!.data.source, "API");
    const again = await call(addBatchMember, "POST", "/batches/spring/members", { params: { id: "spring" }, body: { email: "ada@example.com" } });
    assert.equal(again.status, 200);
    const full = await call(addBatchMember, "POST", "/batches/spring/members", { params: { id: "spring" }, body: { userId: teacher.id } });
    assert.equal(full.status, 409);
    await settleEvents();
  });
});
