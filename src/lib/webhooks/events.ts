import { DOMAIN_EVENTS, type DomainEventMap, type DomainEventName } from "@/lib/events-shared";

/**
 * Webhook event catalog: every domain event an endpoint can subscribe to,
 * with the documentation of its `data` fields and an example.
 *
 * Shared by the delivery worker (payload building), the OpenAPI document,
 * the developer docs, the admin endpoint form and "Send test event".
 * No runtime imports beyond the event names: safe on the client.
 */

export type WebhookEventName = DomainEventName;

export interface WebhookFieldDoc {
  name: string;
  type: "string" | "integer" | "boolean";
  description: string;
  /** The field may be missing from `data`. */
  optional?: boolean;
  nullable?: boolean;
  enum?: readonly string[];
}

export interface WebhookEventDoc<N extends WebhookEventName = WebhookEventName> {
  name: N;
  /** Short label for lists ("Enrollment created"). */
  label: string;
  description: string;
  fields: readonly WebhookFieldDoc[];
  example: DomainEventMap[N];
}

/* ------------------------------------------------------------------ */
/* Related records added to `data`                                     */
/* ------------------------------------------------------------------ */

export interface WebhookUserRef {
  id: string;
  name: string;
  email: string;
  username: string;
}

export interface WebhookCourseRef {
  id: string;
  title: string;
  slug: string;
  url: string;
}

export interface WebhookBatchRef {
  id: string;
  title: string;
  slug: string;
  url: string;
}

export interface WebhookLessonRef {
  id: string;
  title: string;
}

/** Looks up the records an event refers to (null when a record no longer exists). */
export interface WebhookRefResolver {
  user(id: string): WebhookUserRef | null;
  course(id: string): WebhookCourseRef | null;
  batch(id: string): WebhookBatchRef | null;
  lesson(id: string): WebhookLessonRef | null;
}

/** The objects added next to `userId`, `courseId`, `batchId` and `lessonId`, for the docs. */
export const WEBHOOK_EXPANSIONS: readonly { idField: string; field: string; description: string; fields: readonly WebhookFieldDoc[] }[] = [
  {
    idField: "userId",
    field: "user",
    description: "The member the event is about.",
    fields: [
      { name: "id", type: "string", description: "User id." },
      { name: "name", type: "string", description: "Full name." },
      { name: "email", type: "string", description: "Email address." },
      { name: "username", type: "string", description: "Profile handle." },
    ],
  },
  {
    idField: "courseId",
    field: "course",
    description: "The course the event is about.",
    fields: [
      { name: "id", type: "string", description: "Course id." },
      { name: "title", type: "string", description: "Course title." },
      { name: "slug", type: "string", description: "URL slug." },
      { name: "url", type: "string", description: "Public course page." },
    ],
  },
  {
    idField: "batchId",
    field: "batch",
    description: "The batch the event is about.",
    fields: [
      { name: "id", type: "string", description: "Batch id." },
      { name: "title", type: "string", description: "Batch title." },
      { name: "slug", type: "string", description: "URL slug." },
      { name: "url", type: "string", description: "Public batch page." },
    ],
  },
  {
    idField: "lessonId",
    field: "lesson",
    description: "The lesson the event is about.",
    fields: [
      { name: "id", type: "string", description: "Lesson id." },
      { name: "title", type: "string", description: "Lesson title." },
    ],
  },
];

/**
 * Event data plus the records it refers to: `userId` gains a `user` object,
 * `courseId` a `course`, `batchId` a `batch` and `lessonId` a `lesson`, so
 * receivers (Zapier, a CRM) rarely need a follow-up API call. A record that
 * no longer exists is `null`. Ids are always kept.
 */
export function expandEventData(data: object, resolve: WebhookRefResolver): Record<string, unknown> {
  const source = data as Record<string, unknown>;
  const out: Record<string, unknown> = { ...source };
  if (typeof source.userId === "string") out.user = resolve.user(source.userId);
  if (typeof source.courseId === "string") out.course = resolve.course(source.courseId);
  if (typeof source.batchId === "string") out.batch = resolve.batch(source.batchId);
  if (typeof source.lessonId === "string") out.lesson = resolve.lesson(source.lessonId);
  return out;
}

/* ------------------------------------------------------------------ */
/* Catalog                                                             */
/* ------------------------------------------------------------------ */

const PAYMENT_ITEM_TYPES = ["course", "batch", "certificate", "plan", "bundle", "gift", "seats"] as const;
const SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due", "cancelled", "expired"] as const;

const userId: WebhookFieldDoc = { name: "userId", type: "string", description: "Id of the member." };
const courseId: WebhookFieldDoc = { name: "courseId", type: "string", description: "Id of the course." };

const LABELS: Record<WebhookEventName, string> = {
  "enrollment.created": "Enrollment created",
  "payment.paid": "Payment paid",
  "payment.refunded": "Payment refunded",
  "course.completed": "Course completed",
  "lesson.completed": "Lesson completed",
  "certificate.issued": "Certificate issued",
  "user.registered": "User registered",
  "subscription.changed": "Subscription changed",
  "lead.created": "Lead created",
};

type Details = { [N in WebhookEventName]: { fields: readonly WebhookFieldDoc[]; example: DomainEventMap[N] } };

const DETAILS: Details = {
  "enrollment.created": {
    fields: [
      { name: "enrollmentId", type: "string", description: "Id of the new enrollment." },
      userId,
      courseId,
      { name: "memberType", type: "string", description: "How the member takes part in the course.", enum: ["student", "mentor", "staff"] },
      { name: "paymentId", type: "string", description: "Order that paid for the enrollment.", optional: true },
      { name: "batchId", type: "string", description: "Batch the enrollment came from.", optional: true },
    ],
    example: { enrollmentId: "enr_8k2m4x", userId: "usr_priya", courseId: "crs_data101", memberType: "student", paymentId: "pay_7d1q9z" },
  },
  "payment.paid": {
    fields: [
      { name: "paymentId", type: "string", description: "Id of the payment." },
      { name: "orderId", type: "string", description: "Order number shown to the buyer." },
      userId,
      { name: "itemType", type: "string", description: "What was bought.", enum: PAYMENT_ITEM_TYPES },
      { name: "itemId", type: "string", description: "Id of the course, batch, plan or bundle." },
      { name: "itemTitle", type: "string", description: "Title of the item at the time of purchase." },
      { name: "amount", type: "integer", description: "Amount charged, tax included, in the smallest currency unit (cents)." },
      { name: "taxAmount", type: "integer", description: "Tax part of the amount." },
      { name: "discountAmount", type: "integer", description: "Discount taken off the list price." },
      { name: "currency", type: "string", description: "ISO 4217 currency code." },
      { name: "gateway", type: "string", description: 'Payment gateway, e.g. "stripe", "razorpay" or "manual".' },
      { name: "couponCode", type: "string", description: "Coupon used on the order.", optional: true },
      { name: "affiliateId", type: "string", description: "Affiliate credited with the sale.", optional: true },
    ],
    example: {
      paymentId: "pay_7d1q9z",
      orderId: "ORD-2026-00184",
      userId: "usr_priya",
      itemType: "course",
      itemId: "crs_data101",
      itemTitle: "Intro to Data Analysis",
      amount: 4900,
      taxAmount: 0,
      discountAmount: 1000,
      currency: "USD",
      gateway: "stripe",
      couponCode: "WELCOME10",
    },
  },
  "payment.refunded": {
    fields: [
      { name: "paymentId", type: "string", description: "Id of the payment." },
      { name: "orderId", type: "string", description: "Order number shown to the buyer." },
      userId,
      { name: "itemType", type: "string", description: "What was bought.", enum: PAYMENT_ITEM_TYPES },
      { name: "itemId", type: "string", description: "Id of the course, batch, plan or bundle." },
      { name: "amount", type: "integer", description: "Order amount in the smallest currency unit." },
      { name: "refundedAmount", type: "integer", description: "Total refunded so far on the order." },
      { name: "currency", type: "string", description: "ISO 4217 currency code." },
      { name: "full", type: "boolean", description: "true when the whole order is refunded and its access removed." },
    ],
    example: { paymentId: "pay_7d1q9z", orderId: "ORD-2026-00184", userId: "usr_priya", itemType: "course", itemId: "crs_data101", amount: 4900, refundedAmount: 4900, currency: "USD", full: true },
  },
  "course.completed": {
    fields: [{ name: "enrollmentId", type: "string", description: "Id of the enrollment." }, userId, courseId],
    example: { enrollmentId: "enr_8k2m4x", userId: "usr_priya", courseId: "crs_data101" },
  },
  "lesson.completed": {
    fields: [userId, courseId, { name: "chapterId", type: "string", description: "Id of the chapter." }, { name: "lessonId", type: "string", description: "Id of the lesson." }],
    example: { userId: "usr_priya", courseId: "crs_data101", chapterId: "chp_basics", lessonId: "les_spreadsheets" },
  },
  "certificate.issued": {
    fields: [
      { name: "certificateId", type: "string", description: "Id of the certificate." },
      { name: "code", type: "string", description: "Verification code printed on the certificate." },
      userId,
      { name: "courseId", type: "string", description: "Course the certificate is for.", optional: true },
      { name: "batchId", type: "string", description: "Batch the certificate is for.", optional: true },
    ],
    example: { certificateId: "cert_5h3n8w", code: "LL-7GQ2-M4XK", userId: "usr_priya", courseId: "crs_data101" },
  },
  "user.registered": {
    fields: [
      userId,
      { name: "email", type: "string", description: "Email address of the account." },
      { name: "name", type: "string", description: "Full name." },
      { name: "source", type: "string", description: "How the account was created.", enum: ["signup", "admin", "invite", "import"] },
    ],
    example: { userId: "usr_priya", email: "priya@example.com", name: "Priya Sharma", source: "signup" },
  },
  "subscription.changed": {
    fields: [
      { name: "subscriptionId", type: "string", description: "Id of the membership subscription." },
      userId,
      { name: "planId", type: "string", description: "Id of the membership plan." },
      { name: "status", type: "string", description: "Status after the change.", enum: SUBSCRIPTION_STATUSES },
      { name: "previousStatus", type: "string", description: "Status before the change; null for a new subscription.", nullable: true, enum: SUBSCRIPTION_STATUSES },
      { name: "cancelAtPeriodEnd", type: "boolean", description: "The member cancelled and keeps access until the period ends." },
      { name: "currentPeriodEnd", type: "string", description: "End of the paid period (ISO 8601)." },
    ],
    example: {
      subscriptionId: "sub_2v9c1r",
      userId: "usr_priya",
      planId: "plan_pro_monthly",
      status: "active",
      previousStatus: null,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: "2026-02-15T09:30:00.000Z",
    },
  },
  "lead.created": {
    fields: [
      { name: "leadId", type: "string", description: "Id of the lead." },
      { name: "email", type: "string", description: "Email address that signed up." },
      { name: "name", type: "string", description: "Name, when it was given.", optional: true },
      { name: "source", type: "string", description: 'Where the lead signed up, e.g. "blog" or "course:crs_data101".' },
      { name: "courseId", type: "string", description: "Course whose preview or syllabus was requested.", optional: true },
      { name: "consent", type: "boolean", description: "Whether marketing consent was given." },
    ],
    example: { leadId: "lead_4t6b2p", email: "sam@example.com", name: "Sam Carter", source: "course:crs_data101", courseId: "crs_data101", consent: true },
  },
};

function eventDoc<N extends WebhookEventName>(name: N, description: string): WebhookEventDoc<N> {
  return { name, label: LABELS[name], description, fields: DETAILS[name].fields, example: DETAILS[name].example };
}

/** Every webhook event, in the order shown in the admin form and the docs. */
export const WEBHOOK_EVENTS: readonly WebhookEventDoc[] = DOMAIN_EVENTS.map((event) => eventDoc(event.name, event.description));

export const WEBHOOK_EVENT_NAMES: readonly WebhookEventName[] = WEBHOOK_EVENTS.map((event) => event.name);

export function isWebhookEventName(value: unknown): value is WebhookEventName {
  return typeof value === "string" && (WEBHOOK_EVENT_NAMES as readonly string[]).includes(value);
}

export function webhookEventDoc(name: string): WebhookEventDoc | undefined {
  return WEBHOOK_EVENTS.find((event) => event.name === name);
}

/** "payment.paid" → "Payment paid" (unknown names are returned as they are). */
export function webhookEventLabel(name: string): string {
  return webhookEventDoc(name)?.label ?? name;
}

/** Known events only, without duplicates, in catalog order. */
export function normalizeWebhookEvents(input: readonly unknown[]): WebhookEventName[] {
  const wanted = new Set(input.filter(isWebhookEventName));
  return WEBHOOK_EVENT_NAMES.filter((name) => wanted.has(name));
}

/* ------------------------------------------------------------------ */
/* Examples (docs and test events)                                     */
/* ------------------------------------------------------------------ */

/** The records the examples refer to, on the given site origin. */
export function exampleResolver(baseUrl: string): WebhookRefResolver {
  return {
    user: (id) => ({ id, name: "Priya Sharma", email: "priya@example.com", username: "priya-sharma" }),
    course: (id) => ({ id, title: "Intro to Data Analysis", slug: "intro-to-data-analysis", url: `${baseUrl}/courses/intro-to-data-analysis` }),
    batch: (id) => ({ id, title: "Spring cohort", slug: "spring-cohort", url: `${baseUrl}/batches/spring-cohort` }),
    lesson: (id) => ({ id, title: "Working with spreadsheets" }),
  };
}

/** Example `data` of an event, as it is delivered (related records included). */
export function exampleEventData(name: WebhookEventName, baseUrl: string): Record<string, unknown> {
  return expandEventData(DETAILS[name].example, exampleResolver(baseUrl));
}
