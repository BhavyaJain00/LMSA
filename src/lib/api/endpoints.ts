import type { MemberType, PaymentItemType, PaymentStatus, Role } from "@/lib/types";
import { currencies } from "@/lib/config";
import { WEBHOOK_EVENT_NAMES } from "@/lib/webhooks/events";
import { DELIVERY_STATUSES } from "@/lib/webhooks/log";
import { MAX_WEBHOOK_DESCRIPTION_LENGTH, MAX_WEBHOOK_URL_LENGTH } from "@/lib/webhooks/policy";
import type { ApiScope } from "./scopes";
import { listQueryProperties } from "./pagination";
import { s, type ObjectSchema, type Schema } from "./schema";

/**
 * Every endpoint of REST API v1, described as data.
 *
 * Each route handler under `src/app/api/v1` is built from its definition
 * here (`apiRoute(endpoints.listCourses, …)`), which fixes the required
 * scope and validates the path, query string and JSON body. The OpenAPI
 * document and the developer docs are generated from the same list, so the
 * docs cannot drift from what the API accepts.
 *
 * Paths use OpenAPI syntax relative to `/api/v1` (`/courses/{id}`).
 */

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export const API_TAGS = ["Account", "Courses", "Users", "Enrollments", "Progress", "Payments", "Certificates", "Batches", "Webhooks"] as const;
export type ApiTag = (typeof API_TAGS)[number];

/** Response payload shapes (`src/lib/api/serializers.ts`). */
export type ApiResourceName =
  | "KeyInfo"
  | "Course"
  | "CourseDetail"
  | "User"
  | "Enrollment"
  | "Progress"
  | "Payment"
  | "Certificate"
  | "Batch"
  | "BatchMember"
  | "WebhookEndpoint"
  | "WebhookEndpointWithSecret"
  | "WebhookDelivery"
  | "WebhookEvent"
  | "Deleted";

export interface EndpointDef {
  /** OpenAPI operationId. */
  id: string;
  method: HttpMethod;
  path: string;
  tag: ApiTag;
  summary: string;
  description?: string;
  /** Scope the key needs (null: any valid key). */
  scope: ApiScope | null;
  /** Path parameters: name → description. */
  params?: Record<string, string>;
  query?: ObjectSchema<Record<string, Schema>>;
  body?: ObjectSchema<Record<string, Schema>>;
  response: {
    status: 200 | 201;
    resource: ApiResourceName;
    /** A paginated list of `resource`. */
    list?: boolean;
    description: string;
  };
  /** Other success statuses, e.g. 200 when POST finds an existing row. */
  alsoReturns?: { status: number; description: string }[];
  /** Error statuses specific to this endpoint (401, 403, 429 and 500 apply to all). */
  errors: number[];
  /** Values used in the documented request (the curl example and the OpenAPI examples). */
  examples?: {
    params?: Record<string, string>;
    query?: Record<string, string | number | boolean>;
    body?: Record<string, unknown>;
  };
}

function define<const D extends EndpointDef>(def: D): D {
  return def;
}

/* ------------------------------------------------------------------ */
/* Shared field schemas                                                */
/* ------------------------------------------------------------------ */

const ASSIGNABLE_ROLES = ["student", "course_creator", "moderator", "batch_evaluator"] as const satisfies readonly Exclude<Role, "admin">[];
const MEMBER_TYPES = ["student", "mentor", "staff"] as const satisfies readonly MemberType[];
const PAYMENT_STATUSES = ["pending", "paid", "failed", "refunded"] as const satisfies readonly PaymentStatus[];
const PAYMENT_ITEM_TYPES = ["course", "batch", "certificate", "plan", "bundle", "gift", "seats"] as const satisfies readonly PaymentItemType[];

const id = (description: string) => s.string({ minLength: 1, maxLength: 200, description });
const optionalId = (description: string) => s.string({ optional: true, minLength: 1, maxLength: 200, description });

const courseFields = {
  title: s.string({ optional: true, minLength: 1, maxLength: 140, description: "Course title.", example: "Intro to Data Analysis" }),
  slug: s.string({
    optional: true,
    lowercase: true,
    minLength: 1,
    maxLength: 80,
    format: "slug",
    description: "URL slug (`/courses/<slug>`). Generated from the title when left out on create. Changing it keeps old links working with a redirect.",
    example: "intro-to-data-analysis",
  }),
  shortIntroduction: s.string({ optional: true, minLength: 1, maxLength: 300, description: "One or two sentences shown on course cards." }),
  description: s.string({ optional: true, raw: true, minLength: 1, maxLength: 50_000, description: "Full description in Markdown." }),
  imageUrl: s.string({ optional: true, nullable: true, maxLength: 2000, format: "url", description: "Cover image URL (null removes it)." }),
  videoUrl: s.string({ optional: true, nullable: true, maxLength: 2000, format: "url", description: "Direct .mp4/.webm promo video URL (null removes it). YouTube and Vimeo links are refused." }),
  categoryId: s.string({ optional: true, nullable: true, maxLength: 200, description: "Category id (null removes it)." }),
  tags: s.array(s.string({ minLength: 1, maxLength: 32 }), { optional: true, maxItems: 12, dedupe: true, description: "Up to 12 tags." }),
  price: s.integer({ optional: true, minimum: 0, maximum: 100_000_000, description: "Price in the smallest currency unit (cents). 0 means free.", example: 4900 }),
  currency: s.enum(currencies, { optional: true, description: "ISO 4217 currency of the price." }),
  paidCourse: s.boolean({ optional: true, description: "Learners must buy the course before they can enroll." }),
  published: s.boolean({ optional: true, description: "Show the course in the catalog." }),
  featured: s.boolean({ optional: true, description: "Highlight the course in the catalog." }),
  upcoming: s.boolean({ optional: true, description: "Show as coming soon and block enrollment." }),
  enableCertification: s.boolean({ optional: true, description: "Issue a certificate automatically on completion." }),
  instructorIds: s.array(s.string({ minLength: 1, maxLength: 200 }), {
    optional: true,
    maxItems: 20,
    dedupe: true,
    description: "Instructor user ids (course creators, moderators or admins). Defaults to the key's creator on create.",
  }),
  outcomes: s.array(s.string({ minLength: 1, maxLength: 200 }), { optional: true, maxItems: 20, dedupe: true, description: "What learners will be able to do." }),
  requirements: s.array(s.string({ minLength: 1, maxLength: 200 }), { optional: true, maxItems: 20, dedupe: true, description: "What learners need before starting." }),
  metaDescription: s.string({ optional: true, nullable: true, maxLength: 160, description: "Search result summary (max 160 characters)." }),
};

const profileFields = {
  headline: s.string({ optional: true, nullable: true, maxLength: 120, description: "Short headline shown on the profile." }),
  location: s.string({ optional: true, nullable: true, maxLength: 80 }),
  bio: s.string({ optional: true, nullable: true, raw: true, maxLength: 2000, description: "Markdown biography." }),
};

const memberFields = {
  userId: optionalId("Id of an existing member."),
  email: s.string({ optional: true, lowercase: true, format: "email", maxLength: 254, description: "Email of an existing member (instead of userId)." }),
};

/* ------------------------------------------------------------------ */
/* Endpoints                                                           */
/* ------------------------------------------------------------------ */

export const endpoints = {
  getKeyInfo: define({
    id: "getKeyInfo",
    method: "GET",
    path: "/",
    tag: "Account",
    summary: "Check your API key",
    description: "Returns the key's name, scopes and rate limit. Use it to test a connection.",
    scope: null,
    response: { status: 200, resource: "KeyInfo", description: "The key used for this request." },
    errors: [],
  }),

  /* ----------------------------- Courses ----------------------------- */
  listCourses: define({
    id: "listCourses",
    method: "GET",
    path: "/courses",
    tag: "Courses",
    summary: "List courses",
    description: "All courses, including unpublished drafts. Filter with `published=true` for the public catalog.",
    scope: "courses:read",
    query: s.object(
      {
        ...listQueryProperties,
        q: s.string({ optional: true, maxLength: 200, description: "Search in title, slug, short introduction and tags." }),
        published: s.boolean({ optional: true, description: "Only published (true) or unpublished (false) courses." }),
        categoryId: optionalId("Only courses in this category."),
        instructorId: optionalId("Only courses taught by this user."),
        tag: s.string({ optional: true, maxLength: 32, description: "Only courses with this tag (case-insensitive)." }),
      },
      { allowUnknown: true },
    ),
    response: { status: 200, resource: "Course", list: true, description: "A page of courses." },
    errors: [400],
    examples: { query: { published: true, perPage: 50 } },
  }),
  getCourse: define({
    id: "getCourse",
    method: "GET",
    path: "/courses/{id}",
    tag: "Courses",
    summary: "Get a course with its outline",
    description: "The course with chapters and lessons in order. Lesson content (`blocks`, `instructorNotes`) is included only for keys with the courses:write scope.",
    scope: "courses:read",
    params: { id: "Course id or slug." },
    response: { status: 200, resource: "CourseDetail", description: "The course." },
    errors: [404],
    examples: { params: { id: "intro-to-data-analysis" } },
  }),
  createCourse: define({
    id: "createCourse",
    method: "POST",
    path: "/courses",
    tag: "Courses",
    summary: "Create a course",
    description: "Creates a course (unpublished unless `published` is true). Add chapters and lessons in the course editor.",
    scope: "courses:write",
    body: s.object({
      ...courseFields,
      title: s.string({ minLength: 1, maxLength: 140, description: "Course title.", example: "Intro to Data Analysis" }),
      shortIntroduction: s.string({ minLength: 1, maxLength: 300, description: "One or two sentences shown on course cards." }),
      description: s.string({ raw: true, minLength: 1, maxLength: 50_000, description: "Full description in Markdown." }),
    }),
    response: { status: 201, resource: "CourseDetail", description: "The new course." },
    errors: [400, 409],
    examples: {
      body: {
        title: "Intro to Data Analysis",
        shortIntroduction: "Learn to clean, explore and chart data with spreadsheets and SQL.",
        description: "A hands-on course for complete beginners.\n\n- Six chapters\n- One project per chapter",
        price: 4900,
        currency: "USD",
        paidCourse: true,
        tags: ["data", "sql"],
      },
    },
  }),
  updateCourse: define({
    id: "updateCourse",
    method: "PATCH",
    path: "/courses/{id}",
    tag: "Courses",
    summary: "Update a course",
    description: "Changes only the fields you send.",
    scope: "courses:write",
    params: { id: "Course id or slug." },
    body: s.object(courseFields, { nonEmpty: true }),
    response: { status: 200, resource: "CourseDetail", description: "The updated course." },
    errors: [400, 404, 409],
    examples: { params: { id: "crs_data101" }, body: { published: true, featured: true, price: 3900 } },
  }),

  /* ------------------------------ Users ------------------------------ */
  listUsers: define({
    id: "listUsers",
    method: "GET",
    path: "/users",
    tag: "Users",
    summary: "List members",
    description: "`updated_since` matches members created, edited (name, email, roles, status, profile), verified or active since that time.",
    scope: "users:read",
    query: s.object(
      {
        ...listQueryProperties,
        q: s.string({ optional: true, maxLength: 200, description: "Search in name, email and username." }),
        email: s.string({ optional: true, lowercase: true, maxLength: 254, description: "Exact email address." }),
        role: s.enum(["student", "course_creator", "moderator", "batch_evaluator", "admin"] as const, { optional: true, description: "Only members with this role." }),
        enabled: s.boolean({ optional: true, description: "Only enabled (true) or disabled (false) accounts." }),
      },
      { allowUnknown: true },
    ),
    response: { status: 200, resource: "User", list: true, description: "A page of members." },
    errors: [400],
    examples: { query: { updated_since: "2026-01-01T00:00:00Z", sort: "updated_at" } },
  }),
  getUser: define({
    id: "getUser",
    method: "GET",
    path: "/users/{id}",
    tag: "Users",
    summary: "Get a member",
    scope: "users:read",
    params: { id: "User id." },
    response: { status: 200, resource: "User", description: "The member." },
    errors: [404],
    examples: { params: { id: "usr_priya" } },
  }),
  createUser: define({
    id: "createUser",
    method: "POST",
    path: "/users",
    tag: "Users",
    summary: "Create a member",
    description:
      "Creates an account. Without a `password`, the member gets an email with a link to choose one (when `sendWelcomeEmail` is true, the default). The admin role can't be granted through the API.",
    scope: "users:write",
    body: s.object({
      name: s.string({ minLength: 2, maxLength: 100, description: "Full name.", example: "Priya Sharma" }),
      email: s.string({ lowercase: true, format: "email", maxLength: 254, example: "priya@example.com" }),
      username: s.string({ optional: true, lowercase: true, minLength: 3, maxLength: 40, format: "username", description: "Profile handle. Generated from the email when left out." }),
      password: s.string({ optional: true, raw: true, maxLength: 200, description: "Initial password (must meet the site's password policy)." }),
      roles: s.array(s.enum(ASSIGNABLE_ROLES), { optional: true, maxItems: 4, dedupe: true, description: 'Roles (default ["student"]).' }),
      sendWelcomeEmail: s.boolean({ optional: true, description: "Email a welcome message, plus a set-password link when no password is given. Default true." }),
      ...profileFields,
    }),
    response: { status: 201, resource: "User", description: "The new member." },
    errors: [400, 409],
    examples: { body: { name: "Priya Sharma", email: "priya@example.com", roles: ["student"], sendWelcomeEmail: true } },
  }),
  updateUser: define({
    id: "updateUser",
    method: "PATCH",
    path: "/users/{id}",
    tag: "Users",
    summary: "Update a member",
    description:
      "Changes only the fields you send. Disabling an account signs the member out everywhere. Administrator accounts can't have their email, roles or status changed through the API.",
    scope: "users:write",
    params: { id: "User id." },
    body: s.object(
      {
        name: s.string({ optional: true, minLength: 2, maxLength: 100 }),
        username: s.string({ optional: true, lowercase: true, minLength: 3, maxLength: 40, format: "username" }),
        email: s.string({ optional: true, lowercase: true, format: "email", maxLength: 254 }),
        roles: s.array(s.enum(ASSIGNABLE_ROLES), { optional: true, maxItems: 4, dedupe: true, description: "Replaces the member's roles." }),
        enabled: s.boolean({ optional: true, description: "false disables the account and signs the member out." }),
        ...profileFields,
      },
      { nonEmpty: true },
    ),
    response: { status: 200, resource: "User", description: "The updated member." },
    errors: [400, 403, 404, 409],
    examples: { params: { id: "usr_priya" }, body: { headline: "Data analyst in training", location: "Pune, India" } },
  }),

  /* --------------------------- Enrollments --------------------------- */
  listEnrollments: define({
    id: "listEnrollments",
    method: "GET",
    path: "/enrollments",
    tag: "Enrollments",
    summary: "List enrollments",
    description: "`updated_since` also matches enrollments with lesson progress since that time.",
    scope: "enrollments:read",
    query: s.object(
      {
        ...listQueryProperties,
        userId: optionalId("Only this member's enrollments."),
        courseId: optionalId("Only enrollments in this course."),
        completed: s.boolean({ optional: true, description: "Only completed (true) or unfinished (false) enrollments." }),
        memberType: s.enum(MEMBER_TYPES, { optional: true }),
      },
      { allowUnknown: true },
    ),
    response: { status: 200, resource: "Enrollment", list: true, description: "A page of enrollments." },
    errors: [400],
    examples: { query: { courseId: "crs_data101", completed: false } },
  }),
  createEnrollment: define({
    id: "createEnrollment",
    method: "POST",
    path: "/enrollments",
    tag: "Enrollments",
    summary: "Enroll a member in a course",
    description:
      "Identify the member with `userId` or `email`. Enrolling someone who is already enrolled returns the existing enrollment with status 200. Paid courses are not charged: use this for access granted outside the site's checkout.",
    scope: "enrollments:write",
    body: s.object(
      {
        ...memberFields,
        courseId: id("Course id."),
        memberType: s.enum(MEMBER_TYPES, { optional: true, description: 'Default "student". Mentors and staff are not counted as learners.' }),
        sendConfirmationEmail: s.boolean({ optional: true, description: "Email the learner an enrollment confirmation. Default false." }),
      },
      { anyOf: ["userId", "email"] },
    ),
    response: { status: 201, resource: "Enrollment", description: "The new enrollment." },
    alsoReturns: [{ status: 200, description: "The member was already enrolled: the existing enrollment." }],
    errors: [400, 404],
    examples: { body: { email: "priya@example.com", courseId: "crs_data101", sendConfirmationEmail: true } },
  }),
  deleteEnrollment: define({
    id: "deleteEnrollment",
    method: "DELETE",
    path: "/enrollments/{id}",
    tag: "Enrollments",
    summary: "Remove an enrollment",
    description: "Removes the member from the course together with their lesson progress in it. Payments and certificates are kept.",
    scope: "enrollments:write",
    params: { id: "Enrollment id." },
    response: { status: 200, resource: "Deleted", description: "The enrollment was removed." },
    errors: [404],
    examples: { params: { id: "enr_8k2m4x" } },
  }),

  /* ----------------------------- Progress ---------------------------- */
  listProgress: define({
    id: "listProgress",
    method: "GET",
    path: "/progress",
    tag: "Progress",
    summary: "Get learner progress",
    description: "Per-enrollment progress with a status for every lesson. Pass `userId` and `courseId` for one learner in one course.",
    scope: "progress:read",
    query: s.object(
      {
        ...listQueryProperties,
        userId: optionalId("Only this member."),
        courseId: optionalId("Only this course."),
        completed: s.boolean({ optional: true, description: "Only finished (true) or unfinished (false) courses." }),
      },
      { allowUnknown: true },
    ),
    response: { status: 200, resource: "Progress", list: true, description: "A page of progress records." },
    errors: [400, 404],
    examples: { query: { userId: "usr_priya", courseId: "crs_data101" } },
  }),

  /* ----------------------------- Payments ---------------------------- */
  listPayments: define({
    id: "listPayments",
    method: "GET",
    path: "/payments",
    tag: "Payments",
    summary: "List payments",
    description: "Orders of every status. `updated_since` also matches orders paid or refunded since that time.",
    scope: "payments:read",
    query: s.object(
      {
        ...listQueryProperties,
        status: s.enum(PAYMENT_STATUSES, { optional: true }),
        userId: optionalId("Only this member's orders."),
        itemType: s.enum(PAYMENT_ITEM_TYPES, { optional: true, description: "What was bought." }),
        itemId: optionalId("Only orders for this course, batch, plan…"),
      },
      { allowUnknown: true },
    ),
    response: { status: 200, resource: "Payment", list: true, description: "A page of payments." },
    errors: [400],
    examples: { query: { status: "paid", updated_since: "2026-01-01" } },
  }),

  /* --------------------------- Certificates -------------------------- */
  listCertificates: define({
    id: "listCertificates",
    method: "GET",
    path: "/certificates",
    tag: "Certificates",
    summary: "List certificates",
    scope: "progress:read",
    query: s.object(
      {
        ...listQueryProperties,
        userId: optionalId("Only this member's certificates."),
        courseId: optionalId("Only certificates for this course."),
        batchId: optionalId("Only certificates for this batch."),
        published: s.boolean({ optional: true, description: "Only public (true) or hidden (false) certificates." }),
      },
      { allowUnknown: true },
    ),
    response: { status: 200, resource: "Certificate", list: true, description: "A page of certificates." },
    errors: [400],
    examples: { query: { courseId: "crs_data101" } },
  }),

  /* ----------------------------- Batches ----------------------------- */
  listBatches: define({
    id: "listBatches",
    method: "GET",
    path: "/batches",
    tag: "Batches",
    summary: "List batches",
    scope: "courses:read",
    query: s.object(
      {
        ...listQueryProperties,
        q: s.string({ optional: true, maxLength: 200, description: "Search in title, slug and description." }),
        published: s.boolean({ optional: true }),
        courseId: optionalId("Only batches that include this course."),
        status: s.enum(["upcoming", "active", "completed"] as const, { optional: true, description: "Relative to today (UTC)." }),
      },
      { allowUnknown: true },
    ),
    response: { status: 200, resource: "Batch", list: true, description: "A page of batches." },
    errors: [400],
    examples: { query: { status: "upcoming", published: true } },
  }),
  getBatch: define({
    id: "getBatch",
    method: "GET",
    path: "/batches/{id}",
    tag: "Batches",
    summary: "Get a batch",
    scope: "courses:read",
    params: { id: "Batch id or slug." },
    response: { status: 200, resource: "Batch", description: "The batch." },
    errors: [404],
    examples: { params: { id: "spring-cohort" } },
  }),
  addBatchMember: define({
    id: "addBatchMember",
    method: "POST",
    path: "/batches/{id}/members",
    tag: "Batches",
    summary: "Add a member to a batch",
    description:
      "Enrolls the member in the batch and in every course of the batch, and sends the batch confirmation. Adding someone who is already a member returns 200. Seat limits apply; paid batches are not charged.",
    scope: "enrollments:write",
    params: { id: "Batch id or slug." },
    body: s.object(memberFields, { anyOf: ["userId", "email"] }),
    response: { status: 201, resource: "BatchMember", description: "The new batch membership." },
    alsoReturns: [{ status: 200, description: "The member was already in the batch." }],
    errors: [400, 404, 409],
    examples: { params: { id: "spring-cohort" }, body: { email: "priya@example.com" } },
  }),

  /* ----------------------------- Webhooks ---------------------------- */
  listWebhookEvents: define({
    id: "listWebhookEvents",
    method: "GET",
    path: "/webhook-events",
    tag: "Webhooks",
    summary: "List webhook event types",
    description: "Every event an endpoint can subscribe to, with the fields of its `data` and an example payload. Any valid key may read it.",
    scope: null,
    query: s.object({ page: listQueryProperties.page, perPage: listQueryProperties.perPage }, { allowUnknown: true }),
    response: { status: 200, resource: "WebhookEvent", list: true, description: "The event catalog." },
    errors: [400],
  }),
  listWebhooks: define({
    id: "listWebhooks",
    method: "GET",
    path: "/webhooks",
    tag: "Webhooks",
    summary: "List webhook endpoints",
    description: "Signing secrets are never listed: a secret is returned once, when the endpoint is created or its secret is rolled.",
    scope: "webhooks:manage",
    query: s.object(
      {
        ...listQueryProperties,
        active: s.boolean({ optional: true, description: "Only endpoints that are switched on (true) or off (false)." }),
        event: s.enum(WEBHOOK_EVENT_NAMES, { optional: true, description: "Only endpoints subscribed to this event." }),
      },
      { allowUnknown: true },
    ),
    response: { status: 200, resource: "WebhookEndpoint", list: true, description: "A page of webhook endpoints." },
    errors: [400],
    examples: { query: { active: true } },
  }),
  createWebhook: define({
    id: "createWebhook",
    method: "POST",
    path: "/webhooks",
    tag: "Webhooks",
    summary: "Create a webhook endpoint",
    description:
      "Subscribes a URL to events. The response includes the signing `secret`: store it, because the list and get endpoints never return it. The URL must be a public http(s) address; private, loopback and link-local destinations are refused.",
    scope: "webhooks:manage",
    body: s.object({
      url: s.string({ minLength: 1, maxLength: MAX_WEBHOOK_URL_LENGTH, description: "Public http(s) URL that receives the POST requests.", example: "https://hooks.example.com/learnloop" }),
      events: s.array(s.enum(WEBHOOK_EVENT_NAMES), { maxItems: WEBHOOK_EVENT_NAMES.length, dedupe: true, description: "Events to send (at least one)." }),
      description: s.string({ optional: true, nullable: true, maxLength: MAX_WEBHOOK_DESCRIPTION_LENGTH, description: "What receives these events." }),
      active: s.boolean({ optional: true, description: "false creates the endpoint switched off. Default true." }),
    }),
    response: { status: 201, resource: "WebhookEndpointWithSecret", description: "The new endpoint with its signing secret." },
    errors: [400, 409],
    examples: { body: { url: "https://hooks.example.com/learnloop", events: ["enrollment.created", "payment.paid"], description: "CRM sync" } },
  }),
  getWebhook: define({
    id: "getWebhook",
    method: "GET",
    path: "/webhooks/{id}",
    tag: "Webhooks",
    summary: "Get a webhook endpoint",
    scope: "webhooks:manage",
    params: { id: "Webhook endpoint id." },
    response: { status: 200, resource: "WebhookEndpoint", description: "The endpoint." },
    errors: [404],
    examples: { params: { id: "whk_3f9a2c" } },
  }),
  updateWebhook: define({
    id: "updateWebhook",
    method: "PATCH",
    path: "/webhooks/{id}",
    tag: "Webhooks",
    summary: "Update a webhook endpoint",
    description:
      "Changes only the fields you send. `active: false` switches the endpoint off and cancels the deliveries waiting for a retry; `active: true` switches it back on with a clean failure record.",
    scope: "webhooks:manage",
    params: { id: "Webhook endpoint id." },
    body: s.object(
      {
        url: s.string({ optional: true, minLength: 1, maxLength: MAX_WEBHOOK_URL_LENGTH, description: "Public http(s) URL that receives the POST requests." }),
        events: s.array(s.enum(WEBHOOK_EVENT_NAMES), { optional: true, maxItems: WEBHOOK_EVENT_NAMES.length, dedupe: true, description: "Replaces the subscribed events (at least one)." }),
        description: s.string({ optional: true, nullable: true, maxLength: MAX_WEBHOOK_DESCRIPTION_LENGTH, description: "What receives these events (null removes it)." }),
        active: s.boolean({ optional: true, description: "Switch the endpoint on or off." }),
      },
      { nonEmpty: true },
    ),
    response: { status: 200, resource: "WebhookEndpoint", description: "The updated endpoint." },
    errors: [400, 404],
    examples: { params: { id: "whk_3f9a2c" }, body: { events: ["enrollment.created", "course.completed", "certificate.issued"] } },
  }),
  deleteWebhook: define({
    id: "deleteWebhook",
    method: "DELETE",
    path: "/webhooks/{id}",
    tag: "Webhooks",
    summary: "Delete a webhook endpoint",
    description: "Removes the endpoint together with its delivery log. Use this to unsubscribe.",
    scope: "webhooks:manage",
    params: { id: "Webhook endpoint id." },
    response: { status: 200, resource: "Deleted", description: "The endpoint was deleted." },
    errors: [404],
    examples: { params: { id: "whk_3f9a2c" } },
  }),
  rollWebhookSecret: define({
    id: "rollWebhookSecret",
    method: "POST",
    path: "/webhooks/{id}/secret",
    tag: "Webhooks",
    summary: "Roll the signing secret",
    description: "Replaces the signing secret. The old secret stops working at once: every request sent from now on, retries included, is signed with the new one.",
    scope: "webhooks:manage",
    params: { id: "Webhook endpoint id." },
    response: { status: 200, resource: "WebhookEndpointWithSecret", description: "The endpoint with its new signing secret." },
    errors: [404],
    examples: { params: { id: "whk_3f9a2c" } },
  }),
  testWebhook: define({
    id: "testWebhook",
    method: "POST",
    path: "/webhooks/{id}/test",
    tag: "Webhooks",
    summary: "Send a test event",
    description:
      "Delivers the documented example payload of an event to the endpoint once, signed with its secret, and returns what the receiver answered. The event id starts with `evt_test_`. The endpoint does not have to be subscribed to the event or switched on.",
    scope: "webhooks:manage",
    params: { id: "Webhook endpoint id." },
    body: s.object({ event: s.enum(WEBHOOK_EVENT_NAMES, { description: "Event to send." }) }),
    response: { status: 200, resource: "WebhookDelivery", description: "The test delivery with the receiver's answer (`status` is `success` or `failed`)." },
    errors: [400, 404, 409],
    examples: { params: { id: "whk_3f9a2c" }, body: { event: "enrollment.created" } },
  }),
  listWebhookDeliveries: define({
    id: "listWebhookDeliveries",
    method: "GET",
    path: "/webhooks/{id}/deliveries",
    tag: "Webhooks",
    summary: "List deliveries of an endpoint",
    description: "The delivery log of the last 30 days: status, attempts, the receiver's response and the payload that was sent.",
    scope: "webhooks:manage",
    params: { id: "Webhook endpoint id." },
    query: s.object(
      {
        ...listQueryProperties,
        status: s.enum(DELIVERY_STATUSES, { optional: true, description: "pending (waiting for a retry), success or failed." }),
        event: s.enum(WEBHOOK_EVENT_NAMES, { optional: true, description: "Only deliveries of this event." }),
      },
      { allowUnknown: true },
    ),
    response: { status: 200, resource: "WebhookDelivery", list: true, description: "A page of deliveries." },
    errors: [400, 404],
    examples: { params: { id: "whk_3f9a2c" }, query: { status: "failed" } },
  }),
  resendWebhookDelivery: define({
    id: "resendWebhookDelivery",
    method: "POST",
    path: "/webhooks/{id}/deliveries/{deliveryId}/resend",
    tag: "Webhooks",
    summary: "Resend a delivery",
    description: "Sends the same payload (same event id) again, once, and returns the new delivery. A delivery that is still being retried can't be resent.",
    scope: "webhooks:manage",
    params: { id: "Webhook endpoint id.", deliveryId: "Id of the delivery to send again." },
    response: { status: 200, resource: "WebhookDelivery", description: "The new delivery with the receiver's answer." },
    errors: [404, 409],
    examples: { params: { id: "whk_3f9a2c", deliveryId: "whd_91c4e7" } },
  }),
} as const satisfies Record<string, EndpointDef>;

export type EndpointName = keyof typeof endpoints;

export const ENDPOINT_LIST: readonly EndpointDef[] = Object.values(endpoints);
