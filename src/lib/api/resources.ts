import type { ApiResourceName } from "./endpoints";
import type { JsonSchema } from "./schema";
import type {
  ApiBatch,
  ApiBatchMember,
  ApiCertificate,
  ApiChapter,
  ApiCourse,
  ApiCourseDetail,
  ApiDeleted,
  ApiEnrollment,
  ApiKeyInfo,
  ApiLesson,
  ApiLessonProgress,
  ApiPayment,
  ApiProgress,
  ApiUser,
  ApiUserRef,
  ApiWebhookDelivery,
  ApiWebhookEndpoint,
  ApiWebhookEndpointWithSecret,
  ApiWebhookEvent,
} from "./serializers";

/**
 * Field-level JSON Schemas of every response payload (`serializers.ts`),
 * for the OpenAPI document and the /developers reference.
 *
 * Each property map is typed against its serializer interface
 * (`Fields<ApiCourse>` must name every key of `ApiCourse` and nothing
 * else), so adding or removing a field without documenting it fails the
 * type check. Pure module: safe on the client.
 */

type Fields<T> = { [K in keyof Required<T>]: JsonSchema };

const ROLES = ["student", "course_creator", "moderator", "batch_evaluator", "admin"];
const MEMBER_TYPES = ["student", "mentor", "staff"];
const COURSE_STATUSES = ["in_progress", "under_review", "approved"];
const PROGRESS_STATUSES = ["complete", "partial", "incomplete"];
const PAYMENT_STATUSES = ["pending", "paid", "failed", "refunded"];
const PAYMENT_ITEM_TYPES = ["course", "batch", "certificate", "plan", "bundle", "gift", "seats"];
const BLOCK_TYPES = ["markdown", "video", "audio", "pdf", "image", "file", "code", "embed", "quiz", "assignment", "exercise", "callout"];

function withDescription(schema: JsonSchema, description?: string): JsonSchema {
  return description ? { ...schema, description } : schema;
}

const str = (description?: string) => withDescription({ type: "string" }, description);
const int = (description?: string, minimum?: number) => withDescription({ type: "integer", ...(minimum === undefined ? {} : { minimum }) }, description);
const bool = (description?: string) => withDescription({ type: "boolean" }, description);
const dateTime = (description?: string) => withDescription({ type: "string", format: "date-time" }, description);
const date = (description?: string) => withDescription({ type: "string", format: "date" }, description);
const uri = (description?: string) => withDescription({ type: "string", format: "uri" }, description);
const oneOf = (values: readonly string[], description?: string) => withDescription({ type: "string", enum: [...values] }, description);
const list = (items: JsonSchema, description?: string) => withDescription({ type: "array", items }, description);
const ref = (name: string, description?: string) => withDescription({ $ref: `#/components/schemas/${name}` }, description);

/** The same schema, also accepting `null`. */
function nullable(schema: JsonSchema): JsonSchema {
  if (typeof schema.type === "string") {
    const out: JsonSchema = { ...schema, type: [schema.type, "null"] };
    // An enum must list null too, or a null value fails validation.
    if (Array.isArray(schema.enum)) out.enum = [...schema.enum, null];
    return out;
  }
  const { description, ...rest } = schema;
  return withDescription({ anyOf: [rest, { type: "null" }] }, typeof description === "string" ? description : undefined);
}

/** A closed object: every listed field is always present unless named in `optional`. */
function object<T>(properties: Fields<T>, opts: { optional?: readonly (keyof T & string)[]; description?: string } = {}): JsonSchema {
  const optional = new Set<string>(opts.optional ?? []);
  return withDescription(
    {
      type: "object",
      required: Object.keys(properties).filter((key) => !optional.has(key)),
      properties,
      additionalProperties: false,
    },
    opts.description,
  );
}

/* ------------------------------------------------------------------ */
/* Shared parts                                                        */
/* ------------------------------------------------------------------ */

const userRefFields: Fields<ApiUserRef> = { id: str(), name: str(), username: str() };

const courseFields: Fields<ApiCourse> = {
  id: str(),
  slug: str(),
  url: uri("Public course page."),
  title: str(),
  shortIntroduction: str(),
  description: str("Markdown."),
  imageUrl: nullable(uri()),
  videoUrl: nullable(uri("Promo video.")),
  category: nullable(object<NonNullable<ApiCourse["category"]>>({ id: str(), name: str(), slug: str() })),
  tags: list(str()),
  price: int("Smallest currency unit (cents).", 0),
  currency: str("ISO 4217 code."),
  paidCourse: bool(),
  published: bool(),
  publishedOn: nullable(str("When the course was first published.")),
  publishAt: nullable(dateTime("Scheduled publication time.")),
  upcoming: bool("Shown as coming soon; enrollment is closed."),
  featured: bool(),
  status: oneOf(COURSE_STATUSES, "Review status."),
  enableCertification: bool(),
  paidCertificate: bool(),
  certificatePrice: int("Smallest currency unit.", 0),
  instructors: list(ref("UserRef")),
  chapterCount: int(undefined, 0),
  lessonCount: int(undefined, 0),
  durationSeconds: int("Total lesson length.", 0),
  enrollmentCount: int("Learners enrolled (mentors and staff excluded).", 0),
  metaDescription: nullable(str()),
  createdAt: dateTime(),
  updatedAt: dateTime(),
};

const lessonFields: Fields<ApiLesson> = {
  id: str(),
  slug: str(),
  title: str(),
  order: int(),
  number: str('1-based chapter and lesson numbers used in lesson URLs, e.g. "2-3".'),
  url: uri(),
  durationSeconds: int(undefined, 0),
  includeInPreview: bool("Readable without enrolling."),
  contentTypes: list(oneOf(BLOCK_TYPES), "Kinds of content in the lesson."),
  publishAt: nullable(dateTime()),
  updatedAt: dateTime(),
  blocks: list(
    { type: "object", required: ["id", "type"], properties: { id: str(), type: oneOf(BLOCK_TYPES) }, additionalProperties: true },
    "Lesson content blocks. Only for keys with the courses:write scope.",
  ),
  instructorNotes: nullable(str("Only for keys with the courses:write scope.")),
};

const chapterFields: Fields<ApiChapter> = {
  id: str(),
  title: str(),
  description: nullable(str()),
  order: int(),
  lessons: list(ref("Lesson")),
};

const lessonProgressFields: Fields<ApiLessonProgress> = {
  lessonId: str(),
  chapterId: str(),
  title: str(),
  status: oneOf(PROGRESS_STATUSES),
  completedAt: nullable(dateTime()),
  timeSpentSeconds: int("Seconds spent on the lesson page.", 0),
  updatedAt: nullable(dateTime()),
};

const webhookEndpointFields: Fields<ApiWebhookEndpoint> = {
  id: str(),
  url: uri(),
  description: nullable(str()),
  events: list(str(), "Subscribed event names."),
  active: bool(),
  status: oneOf(["active", "failing", "disabled"], '"failing" while the latest attempts failed and are being retried.'),
  failureCount: int("Failed attempts in a row (0 after a success).", 0),
  lastError: nullable(str()),
  lastDeliveryAt: nullable(dateTime()),
  lastSuccessAt: nullable(dateTime()),
  lastFailureAt: nullable(dateTime()),
  disabledAt: nullable(dateTime("When the system switched the endpoint off.")),
  disabledReason: nullable(oneOf(["failures", "gone"], '"failures": repeated failed deliveries; "gone": the receiver answered 410.')),
  secretRotatedAt: nullable(dateTime()),
  createdAt: dateTime(),
  updatedAt: dateTime(),
};

const webhookPayloadSchema: JsonSchema = {
  type: "object",
  required: ["id", "type", "createdAt", "data"],
  properties: {
    id: str("Event id: the same for every retry and resend. Test events start with evt_test_."),
    type: str("Event name."),
    createdAt: dateTime("When the event happened."),
    data: { type: "object", additionalProperties: true, description: "Event fields (see the event catalog)." },
  },
  additionalProperties: false,
};

/* ------------------------------------------------------------------ */
/* Resources                                                           */
/* ------------------------------------------------------------------ */

export const RESOURCE_SCHEMAS: Record<ApiResourceName | "UserRef" | "Lesson" | "Chapter" | "LessonProgress" | "WebhookPayload", JsonSchema> = {
  UserRef: object<ApiUserRef>(userRefFields),
  Lesson: object<ApiLesson>(lessonFields, { optional: ["blocks", "instructorNotes"] }),
  Chapter: object<ApiChapter>(chapterFields),
  LessonProgress: object<ApiLessonProgress>(lessonProgressFields),
  WebhookPayload: webhookPayloadSchema,

  KeyInfo: object<ApiKeyInfo>({
    apiVersion: oneOf(["v1"]),
    key: object<ApiKeyInfo["key"]>({
      id: str(),
      name: str(),
      prefix: str("Start of the key, to recognise it."),
      scopes: list(str()),
      createdAt: dateTime(),
      lastUsedAt: nullable(dateTime()),
    }),
    rateLimit: object<ApiKeyInfo["rateLimit"]>({ limit: int("Requests per window.", 1), windowSeconds: int(undefined, 1) }),
    site: object<ApiKeyInfo["site"]>({ name: str(), url: uri() }),
  }),
  Course: object<ApiCourse>(courseFields),
  CourseDetail: object<ApiCourseDetail>({
    ...courseFields,
    outcomes: list(str()),
    requirements: list(str()),
    prerequisiteCourseIds: list(str(), "Courses to complete first."),
    outline: list(ref("Chapter"), "Chapters with their lessons, in order."),
  }),
  User: object<ApiUser>({
    id: str(),
    username: str(),
    name: str(),
    email: { type: "string", format: "email" },
    roles: list(oneOf(ROLES)),
    enabled: bool("false for disabled accounts."),
    headline: nullable(str()),
    location: nullable(str()),
    bio: nullable(str("Markdown.")),
    avatarUrl: nullable(uri()),
    profileUrl: uri(),
    emailVerified: bool(),
    twoFactorEnabled: bool(),
    createdAt: dateTime(),
    lastActiveAt: nullable(dateTime()),
  }),
  Enrollment: object<ApiEnrollment>({
    id: str(),
    userId: str(),
    courseId: str(),
    memberType: oneOf(MEMBER_TYPES),
    progress: { type: "integer", minimum: 0, maximum: 100, description: "Percent of lessons completed." },
    completed: bool(),
    completedAt: nullable(dateTime()),
    enrolledAt: dateTime(),
    currentLessonId: nullable(str()),
    paymentId: nullable(str()),
    batchId: nullable(str()),
    certificateId: nullable(str()),
  }),
  Progress: object<ApiProgress>({
    enrollmentId: str(),
    userId: str(),
    courseId: str(),
    percent: { type: "integer", minimum: 0, maximum: 100 },
    completedLessons: int(undefined, 0),
    totalLessons: int(undefined, 0),
    completed: bool(),
    completedAt: nullable(dateTime()),
    lastActivityAt: nullable(dateTime()),
    lessons: list(ref("LessonProgress"), "Every lesson of the course in outline order."),
  }),
  Payment: object<ApiPayment>({
    id: str(),
    orderId: str(),
    userId: str(),
    status: oneOf(PAYMENT_STATUSES),
    itemType: oneOf(PAYMENT_ITEM_TYPES),
    itemId: str(),
    itemTitle: str(),
    originalAmount: int("Smallest currency unit.", 0),
    discountAmount: int(undefined, 0),
    taxAmount: int(undefined, 0),
    amount: int("Amount charged.", 0),
    refundedAmount: int(undefined, 0),
    currency: str(),
    couponCode: nullable(str()),
    gateway: str(),
    gatewayPaymentId: nullable(str()),
    invoiceNumber: nullable(str()),
    billingName: str(),
    billingCountry: nullable(str()),
    taxCountry: nullable(str()),
    taxRate: nullable({ type: "number", description: "Percent." }),
    installmentNumber: nullable(int()),
    installmentsTotal: nullable(int()),
    subscriptionId: nullable(str()),
    affiliateId: nullable(str()),
    upsellOfPaymentId: nullable(str("For an order bump: the payment of the main order it was added to.")),
    giftId: nullable(str("For a gift purchase or a redeemed gift: the gift it belongs to.")),
    createdAt: dateTime(),
    paidAt: nullable(dateTime()),
    refundedAt: nullable(dateTime()),
  }),
  Certificate: object<ApiCertificate>({
    id: str(),
    code: str("Public verification code."),
    userId: str(),
    courseId: nullable(str()),
    batchId: nullable(str()),
    issueDate: date(),
    expiryDate: nullable(date()),
    published: bool(),
    verifyUrl: uri(),
  }),
  Batch: object<ApiBatch>({
    id: str(),
    slug: str(),
    url: uri(),
    title: str(),
    description: str(),
    imageUrl: nullable(uri()),
    startDate: date(),
    endDate: date(),
    startTime: str("HH:MM in the batch's time zone."),
    endTime: str("HH:MM in the batch's time zone."),
    timezone: str("IANA time zone."),
    medium: oneOf(["online", "offline"]),
    status: oneOf(["upcoming", "active", "completed"]),
    seatCount: int("0 means unlimited.", 0),
    seatsTaken: int(undefined, 0),
    seatsLeft: nullable(int("null when seats are unlimited.", 0)),
    paidBatch: bool(),
    amount: int("Smallest currency unit.", 0),
    currency: str(),
    published: bool(),
    allowSelfEnrollment: bool(),
    certification: bool(),
    instructors: list(ref("UserRef")),
    courseIds: list(str()),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
  BatchMember: object<ApiBatchMember>({
    id: str(),
    batchId: str(),
    userId: str(),
    source: nullable(str("How the member joined.")),
    paymentId: nullable(str()),
    enrolledAt: dateTime(),
  }),
  WebhookEndpoint: object<ApiWebhookEndpoint>(webhookEndpointFields),
  WebhookEndpointWithSecret: object<ApiWebhookEndpointWithSecret>({
    ...webhookEndpointFields,
    secret: str("Signing secret (whsec_…). Returned only on create and when the secret is rolled."),
  }),
  WebhookDelivery: object<ApiWebhookDelivery>({
    id: str(),
    endpointId: str(),
    event: str(),
    eventId: str("Payload id: the same for every retry and resend of one event."),
    status: oneOf(["pending", "success", "failed"], "pending: waiting for a retry."),
    attempts: int(undefined, 0),
    test: bool('Sent with "Send test event".'),
    resentFromId: nullable(str("The delivery this one repeats.")),
    responseStatus: nullable(int("HTTP status the receiver answered with.")),
    responseBody: nullable(str("Start of the response body.")),
    error: nullable(str("Why the latest attempt failed.")),
    durationMs: nullable(int(undefined, 0)),
    createdAt: dateTime(),
    lastAttemptAt: nullable(dateTime()),
    deliveredAt: nullable(dateTime()),
    nextAttemptAt: nullable(dateTime("When the next retry is due.")),
    payload: nullable(ref("WebhookPayload", "The JSON body that was sent.")),
  }),
  WebhookEvent: object<ApiWebhookEvent>({
    name: str("Event name to subscribe to."),
    label: str(),
    description: str(),
    fields: list(
      object<ApiWebhookEvent["fields"][number]>({
        name: str(),
        type: oneOf(["string", "integer", "boolean"]),
        description: str(),
        optional: bool(),
        nullable: bool(),
        enum: nullable(list(str())),
      }),
      "Fields of the payload's data object.",
    ),
    example: ref("WebhookPayload", 'The payload "Send test event" delivers.'),
  }),
  Deleted: object<ApiDeleted>({ id: str(), object: str("Kind of record removed."), deleted: { type: "boolean", const: true } }),
};

export type ResourceSchemaName = keyof typeof RESOURCE_SCHEMAS;

/** One documented field of a resource, flattened for the docs page. */
export interface ResourceField {
  name: string;
  /** Human-readable type, e.g. "string (date-time) | null", "Course[]". */
  type: string;
  required: boolean;
  description: string | null;
  values: string[] | null;
}

/** Readable type of a JSON Schema property. */
export function describeSchemaType(schema: JsonSchema): string {
  if (typeof schema.$ref === "string") return schema.$ref.split("/").pop() ?? "object";
  if (Array.isArray(schema.anyOf)) return (schema.anyOf as JsonSchema[]).map(describeSchemaType).join(" | ");
  const types = Array.isArray(schema.type) ? (schema.type as string[]) : [String(schema.type ?? "object")];
  return types
    .map((type) => {
      if (type === "array") return `${describeSchemaType((schema.items as JsonSchema) ?? {})}[]`;
      if (type === "string" && typeof schema.format === "string") return `string (${schema.format})`;
      return type;
    })
    .join(" | ");
}

/** The top-level fields of a resource, in declaration order. */
export function resourceFields(name: ResourceSchemaName): ResourceField[] {
  const schema = RESOURCE_SCHEMAS[name];
  const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((schema.required as string[] | undefined) ?? []);
  return Object.entries(properties).map(([field, prop]) => {
    const values = Array.isArray(prop.enum) ? (prop.enum as unknown[]).filter((v): v is string => typeof v === "string") : null;
    return {
      name: field,
      type: describeSchemaType(prop),
      required: required.has(field),
      description: typeof prop.description === "string" ? prop.description : null,
      values,
    };
  });
}
