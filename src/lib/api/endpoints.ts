import type { MemberType, PaymentItemType, PaymentStatus, Role } from "@/lib/types";
import { currencies } from "@/lib/config";
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

export const API_TAGS = ["Account", "Courses", "Users", "Enrollments", "Progress", "Payments", "Certificates", "Batches"] as const;
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
  }),

  /* ------------------------------ Users ------------------------------ */
  listUsers: define({
    id: "listUsers",
    method: "GET",
    path: "/users",
    tag: "Users",
    summary: "List members",
    description: "`updated_since` matches members created, verified or active since that time.",
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
      username: s.string({ optional: true, lowercase: true, format: "username", description: "Profile handle. Generated from the email when left out." }),
      password: s.string({ optional: true, raw: true, maxLength: 200, description: "Initial password (must meet the site's password policy)." }),
      roles: s.array(s.enum(ASSIGNABLE_ROLES), { optional: true, maxItems: 4, dedupe: true, description: 'Roles (default ["student"]).' }),
      sendWelcomeEmail: s.boolean({ optional: true, description: "Email a welcome message, plus a set-password link when no password is given. Default true." }),
      ...profileFields,
    }),
    response: { status: 201, resource: "User", description: "The new member." },
    errors: [400, 409],
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
        username: s.string({ optional: true, lowercase: true, format: "username" }),
        email: s.string({ optional: true, lowercase: true, format: "email", maxLength: 254 }),
        roles: s.array(s.enum(ASSIGNABLE_ROLES), { optional: true, maxItems: 4, dedupe: true, description: "Replaces the member's roles." }),
        enabled: s.boolean({ optional: true, description: "false disables the account and signs the member out." }),
        ...profileFields,
      },
      { nonEmpty: true },
    ),
    response: { status: 200, resource: "User", description: "The updated member." },
    errors: [400, 403, 404, 409],
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
  }),
} as const satisfies Record<string, EndpointDef>;

export type EndpointName = keyof typeof endpoints;

export const ENDPOINT_LIST: readonly EndpointDef[] = Object.values(endpoints);
