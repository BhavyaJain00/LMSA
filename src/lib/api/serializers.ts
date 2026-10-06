import type {
  ApiKey,
  Batch,
  BatchEnrollment,
  Category,
  Certificate,
  Chapter,
  Course,
  CourseStatus,
  Enrollment,
  Lesson,
  LessonBlock,
  LessonProgress,
  MemberType,
  Payment,
  PaymentItemType,
  PaymentStatus,
  ProgressStatus,
  Role,
  User,
  WebhookDelivery,
  WebhookEndpoint,
} from "@/lib/types";
import { exampleEventData, type WebhookEventDoc, type WebhookFieldDoc } from "@/lib/webhooks/events";
import { TEST_EVENT_ID_PREFIX, parseWebhookPayload } from "@/lib/webhooks/payload";
import { webhookEndpointStatus, type WebhookDisabledReason, type WebhookEndpointStatus } from "@/lib/webhooks/types";
import { latest, type Timestamps } from "./pagination";

/**
 * Safe public representations of stored rows for the REST API.
 *
 * Every field is listed explicitly (allow-list), so a field added to a
 * stored type never leaks by accident: no password hashes, two-factor
 * secrets, recovery codes, calendar tokens, checkout links or tax ids ever
 * leave through the API. Missing optional values are `null`, dates are ISO
 * 8601 strings and URLs are absolute.
 *
 * Pure module: callers pass the lookups (users, categories, counts) in.
 */

export interface SerializeContext {
  /** Site origin without a trailing slash, e.g. "https://learn.example.com". */
  baseUrl: string;
}

/** A path or URL as an absolute URL (null for empty or unusable values). */
export function absoluteUrl(baseUrl: string, value: string | undefined | null): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/") && !value.startsWith("//")) return `${baseUrl}${value}`;
  return null;
}

/* ------------------------------------------------------------------ */
/* Account                                                             */
/* ------------------------------------------------------------------ */

export interface ApiKeyInfo {
  apiVersion: "v1";
  /** The key used for the request (never the secret part). */
  key: { id: string; name: string; prefix: string; scopes: string[]; createdAt: string; lastUsedAt: string | null };
  rateLimit: { limit: number; windowSeconds: number };
  site: { name: string; url: string };
}

export function serializeKeyInfo(
  key: Pick<ApiKey, "id" | "name" | "prefix" | "scopes" | "createdAt" | "lastUsedAt">,
  rateLimit: { limit: number; windowMs: number },
  site: { name: string; url: string },
): ApiKeyInfo {
  return {
    apiVersion: "v1",
    key: { id: key.id, name: key.name, prefix: key.prefix, scopes: [...key.scopes], createdAt: key.createdAt, lastUsedAt: key.lastUsedAt ?? null },
    rateLimit: { limit: rateLimit.limit, windowSeconds: rateLimit.windowMs / 1000 },
    site: { name: site.name, url: site.url },
  };
}

/** Answer of a DELETE endpoint. */
export interface ApiDeleted {
  id: string;
  /** Kind of record removed, e.g. "enrollment". */
  object: string;
  deleted: true;
}

export function serializeDeleted(object: string, id: string): ApiDeleted {
  return { id, object, deleted: true };
}

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

export interface ApiUserRef {
  id: string;
  name: string;
  username: string;
}

export interface ApiUser {
  id: string;
  username: string;
  name: string;
  email: string;
  roles: Role[];
  enabled: boolean;
  headline: string | null;
  location: string | null;
  bio: string | null;
  avatarUrl: string | null;
  profileUrl: string;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  createdAt: string;
  lastActiveAt: string | null;
}

export function serializeUserRef(user: Pick<User, "id" | "name" | "username">): ApiUserRef {
  return { id: user.id, name: user.name, username: user.username };
}

export function serializeUser(user: User, ctx: SerializeContext): ApiUser {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    roles: [...user.roles],
    enabled: user.enabled,
    headline: user.headline ?? null,
    location: user.location ?? null,
    bio: user.bio ?? null,
    avatarUrl: absoluteUrl(ctx.baseUrl, user.avatarUrl),
    profileUrl: `${ctx.baseUrl}/user/${encodeURIComponent(user.username)}`,
    // Accounts that never had to verify (seeded, admin-created) count as verified.
    emailVerified: !!user.emailVerifiedAt || !user.emailVerificationRequired,
    twoFactorEnabled: !!user.twoFactorEnabled,
    createdAt: user.createdAt,
    lastActiveAt: user.lastActiveAt ?? null,
  };
}

export function userStamps(user: User): Timestamps {
  return { createdAt: user.createdAt, updatedAt: latest(user.createdAt, user.updatedAt, user.emailVerifiedAt, user.lastActiveAt) };
}

/* ------------------------------------------------------------------ */
/* Courses                                                             */
/* ------------------------------------------------------------------ */

export interface CourseStats {
  chapterCount: number;
  lessonCount: number;
  durationSeconds: number;
  enrollmentCount: number;
}

export interface CourseLookups extends SerializeContext {
  users: ReadonlyMap<string, User>;
  categories: ReadonlyMap<string, Category>;
  stats: ReadonlyMap<string, CourseStats>;
}

export interface ApiCourse {
  id: string;
  slug: string;
  url: string;
  title: string;
  shortIntroduction: string;
  /** Markdown. */
  description: string;
  imageUrl: string | null;
  videoUrl: string | null;
  category: { id: string; name: string; slug: string } | null;
  tags: string[];
  /** Smallest currency unit (cents). */
  price: number;
  currency: string;
  paidCourse: boolean;
  published: boolean;
  publishedOn: string | null;
  publishAt: string | null;
  upcoming: boolean;
  featured: boolean;
  status: CourseStatus;
  enableCertification: boolean;
  paidCertificate: boolean;
  certificatePrice: number;
  instructors: ApiUserRef[];
  chapterCount: number;
  lessonCount: number;
  durationSeconds: number;
  enrollmentCount: number;
  metaDescription: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiLesson {
  id: string;
  slug: string;
  title: string;
  order: number;
  /** 1-based chapter and lesson numbers used in lesson URLs. */
  number: string;
  url: string;
  durationSeconds: number;
  includeInPreview: boolean;
  /** Kinds of content in the lesson, e.g. ["video", "quiz"]. */
  contentTypes: LessonBlock["type"][];
  publishAt: string | null;
  updatedAt: string;
  /** Lesson content: only for keys with the courses:write scope. */
  blocks?: LessonBlock[];
  instructorNotes?: string | null;
}

export interface ApiChapter {
  id: string;
  title: string;
  description: string | null;
  order: number;
  lessons: ApiLesson[];
}

export interface ApiCourseDetail extends ApiCourse {
  outcomes: string[];
  requirements: string[];
  prerequisiteCourseIds: string[];
  outline: ApiChapter[];
}

const EMPTY_STATS: CourseStats = { chapterCount: 0, lessonCount: 0, durationSeconds: 0, enrollmentCount: 0 };

/** Chapter/lesson/enrollment counts for many courses in one pass. */
export function buildCourseStats(data: { chapters: readonly Chapter[]; lessons: readonly Lesson[]; enrollments: readonly Enrollment[] }): Map<string, CourseStats> {
  const stats = new Map<string, CourseStats>();
  const get = (courseId: string) => {
    let entry = stats.get(courseId);
    if (!entry) stats.set(courseId, (entry = { ...EMPTY_STATS }));
    return entry;
  };
  for (const chapter of data.chapters) get(chapter.courseId).chapterCount++;
  for (const lesson of data.lessons) {
    const entry = get(lesson.courseId);
    entry.lessonCount++;
    entry.durationSeconds += Math.max(0, lesson.durationSeconds || 0);
  }
  for (const enrollment of data.enrollments) if (enrollment.memberType === "student") get(enrollment.courseId).enrollmentCount++;
  return stats;
}

export function serializeCourse(course: Course, lookups: CourseLookups): ApiCourse {
  const category = course.categoryId ? lookups.categories.get(course.categoryId) : undefined;
  const stats = lookups.stats.get(course.id) ?? EMPTY_STATS;
  return {
    id: course.id,
    slug: course.slug,
    url: `${lookups.baseUrl}/courses/${course.slug}`,
    title: course.title,
    shortIntroduction: course.shortIntroduction,
    description: course.description,
    imageUrl: absoluteUrl(lookups.baseUrl, course.imageUrl),
    videoUrl: absoluteUrl(lookups.baseUrl, course.videoUrl),
    category: category ? { id: category.id, name: category.name, slug: category.slug } : null,
    tags: [...course.tags],
    price: course.price,
    currency: course.currency,
    paidCourse: course.paidCourse,
    published: course.published,
    publishedOn: course.publishedOn ?? null,
    publishAt: course.publishAt ?? null,
    upcoming: course.upcoming,
    featured: course.featured,
    status: course.status,
    enableCertification: course.enableCertification,
    paidCertificate: course.paidCertificate,
    certificatePrice: course.certificatePrice,
    instructors: course.instructorIds.flatMap((id) => {
      const user = lookups.users.get(id);
      return user ? [serializeUserRef(user)] : [];
    }),
    chapterCount: stats.chapterCount,
    lessonCount: stats.lessonCount,
    durationSeconds: stats.durationSeconds,
    enrollmentCount: stats.enrollmentCount,
    metaDescription: course.metaDescription ?? null,
    createdAt: course.createdAt,
    updatedAt: course.updatedAt,
  };
}

/**
 * A course with its outline (chapters → lessons in order). Lesson content
 * (`blocks`, instructor notes) is included only when `includeContent`.
 */
export function serializeCourseDetail(
  course: Course,
  chapters: readonly Chapter[],
  lessons: readonly Lesson[],
  lookups: CourseLookups,
  includeContent: boolean,
): ApiCourseDetail {
  const ordered = [...chapters].filter((c) => c.courseId === course.id).sort((a, b) => a.order - b.order);
  const outline = ordered.map((chapter, chapterIndex): ApiChapter => {
    const chapterLessons = lessons.filter((l) => l.chapterId === chapter.id).sort((a, b) => a.order - b.order);
    return {
      id: chapter.id,
      title: chapter.title,
      description: chapter.description ?? null,
      order: chapter.order,
      lessons: chapterLessons.map((lesson, lessonIndex) => {
        const number = `${chapterIndex + 1}-${lessonIndex + 1}`;
        const out: ApiLesson = {
          id: lesson.id,
          slug: lesson.slug,
          title: lesson.title,
          order: lesson.order,
          number,
          url: `${lookups.baseUrl}/courses/${course.slug}/learn/${number}`,
          durationSeconds: lesson.durationSeconds,
          includeInPreview: lesson.includeInPreview,
          contentTypes: [...new Set(lesson.blocks.map((b) => b.type))],
          publishAt: lesson.publishAt ?? null,
          updatedAt: lesson.updatedAt,
        };
        if (includeContent) {
          out.blocks = structuredClone(lesson.blocks);
          out.instructorNotes = lesson.instructorNotes ?? null;
        }
        return out;
      }),
    };
  });
  return {
    ...serializeCourse(course, lookups),
    outcomes: [...course.outcomes],
    requirements: [...course.requirements],
    prerequisiteCourseIds: [...(course.prerequisiteCourseIds ?? [])],
    outline,
  };
}

export function courseStamps(course: Course): Timestamps {
  return { createdAt: course.createdAt, updatedAt: course.updatedAt };
}

/* ------------------------------------------------------------------ */
/* Enrollments & progress                                              */
/* ------------------------------------------------------------------ */

export interface ApiEnrollment {
  id: string;
  userId: string;
  courseId: string;
  memberType: MemberType;
  /** 0-100. */
  progress: number;
  completed: boolean;
  completedAt: string | null;
  enrolledAt: string;
  currentLessonId: string | null;
  paymentId: string | null;
  batchId: string | null;
  certificateId: string | null;
}

export function serializeEnrollment(enrollment: Enrollment): ApiEnrollment {
  return {
    id: enrollment.id,
    userId: enrollment.userId,
    courseId: enrollment.courseId,
    memberType: enrollment.memberType,
    progress: enrollment.progress,
    completed: !!enrollment.completedAt,
    completedAt: enrollment.completedAt ?? null,
    enrolledAt: enrollment.enrolledAt,
    currentLessonId: enrollment.currentLessonId ?? null,
    paymentId: enrollment.paymentId ?? null,
    batchId: enrollment.batchId ?? null,
    certificateId: enrollment.certificateId ?? null,
  };
}

/** Latest lesson-progress change per `${userId}:${courseId}`. */
export function lastProgressByEnrollment(progress: readonly LessonProgress[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of progress) {
    const key = `${row.userId}:${row.courseId}`;
    const current = out.get(key);
    const next = latest(current, row.updatedAt, row.completedAt);
    if (next) out.set(key, next);
  }
  return out;
}

export function enrollmentStamps(enrollment: Enrollment, lastProgress: ReadonlyMap<string, string>): Timestamps {
  return {
    createdAt: enrollment.enrolledAt,
    updatedAt: latest(enrollment.enrolledAt, enrollment.completedAt, lastProgress.get(`${enrollment.userId}:${enrollment.courseId}`)),
  };
}

export interface ApiLessonProgress {
  lessonId: string;
  chapterId: string;
  title: string;
  status: ProgressStatus;
  completedAt: string | null;
  /** Seconds spent on the lesson page. */
  timeSpentSeconds: number;
  updatedAt: string | null;
}

export interface ApiProgress {
  enrollmentId: string;
  userId: string;
  courseId: string;
  /** 0-100. */
  percent: number;
  completedLessons: number;
  totalLessons: number;
  completed: boolean;
  completedAt: string | null;
  lastActivityAt: string | null;
  lessons: ApiLessonProgress[];
}

/**
 * One learner's progress in one course. `lessons` must be the course's
 * lessons in outline order; `rows` the learner's progress rows for it.
 */
export function serializeProgress(enrollment: Enrollment, lessons: readonly Lesson[], rows: readonly LessonProgress[]): ApiProgress {
  const byLesson = new Map(rows.map((r) => [r.lessonId, r]));
  const items = lessons.map((lesson): ApiLessonProgress => {
    const row = byLesson.get(lesson.id);
    return {
      lessonId: lesson.id,
      chapterId: lesson.chapterId,
      title: lesson.title,
      status: row?.status ?? "incomplete",
      completedAt: row?.completedAt ?? null,
      timeSpentSeconds: row?.dwellSeconds ?? 0,
      updatedAt: row?.updatedAt ?? null,
    };
  });
  const completedLessons = items.filter((i) => i.status === "complete").length;
  const total = lessons.length;
  return {
    enrollmentId: enrollment.id,
    userId: enrollment.userId,
    courseId: enrollment.courseId,
    percent: total ? Math.round((completedLessons / total) * 100) : 0,
    completedLessons,
    totalLessons: total,
    completed: !!enrollment.completedAt || (total > 0 && completedLessons >= total),
    completedAt: enrollment.completedAt ?? null,
    lastActivityAt: latest(...rows.map((r) => r.updatedAt)) || null,
    lessons: items,
  };
}

/* ------------------------------------------------------------------ */
/* Payments                                                            */
/* ------------------------------------------------------------------ */

export interface ApiPayment {
  id: string;
  orderId: string;
  userId: string;
  status: PaymentStatus;
  itemType: PaymentItemType;
  itemId: string;
  itemTitle: string;
  /** Amounts in the smallest currency unit. */
  originalAmount: number;
  discountAmount: number;
  taxAmount: number;
  amount: number;
  refundedAmount: number;
  currency: string;
  couponCode: string | null;
  gateway: string;
  gatewayPaymentId: string | null;
  invoiceNumber: string | null;
  billingName: string;
  billingCountry: string | null;
  taxCountry: string | null;
  taxRate: number | null;
  installmentNumber: number | null;
  installmentsTotal: number | null;
  subscriptionId: string | null;
  affiliateId: string | null;
  /** Order bump: the payment of the main order it was added to. */
  upsellOfPaymentId: string | null;
  /** Gift purchase or redeemed gift order: the gift it belongs to. */
  giftId: string | null;
  createdAt: string;
  paidAt: string | null;
  refundedAt: string | null;
}

export function serializePayment(payment: Payment): ApiPayment {
  return {
    id: payment.id,
    orderId: payment.orderId,
    userId: payment.userId,
    status: payment.status,
    itemType: payment.itemType,
    itemId: payment.itemId,
    itemTitle: payment.itemTitle,
    originalAmount: payment.originalAmount,
    discountAmount: payment.discountAmount,
    taxAmount: payment.taxAmount,
    amount: payment.amount,
    refundedAmount: payment.refundedAmount ?? 0,
    currency: payment.currency,
    couponCode: payment.couponCode ?? null,
    gateway: payment.gateway,
    gatewayPaymentId: payment.gatewayPaymentId ?? null,
    invoiceNumber: payment.invoiceNumber ?? null,
    billingName: payment.billingName,
    billingCountry: payment.address?.country || null,
    taxCountry: payment.taxCountry ?? null,
    taxRate: payment.taxRate ?? null,
    installmentNumber: payment.installmentNumber ?? null,
    installmentsTotal: payment.installmentsTotal ?? null,
    subscriptionId: payment.subscriptionId ?? null,
    affiliateId: payment.affiliateId ?? null,
    upsellOfPaymentId: payment.upsellOfPaymentId ?? null,
    giftId: payment.giftId ?? null,
    createdAt: payment.createdAt,
    paidAt: payment.paidAt ?? null,
    refundedAt: payment.refundedAt ?? null,
  };
}

export function paymentStamps(payment: Payment): Timestamps {
  return {
    createdAt: payment.createdAt,
    updatedAt: latest(payment.createdAt, payment.paidAt, payment.refundedAt, ...(payment.refunds ?? []).map((r) => r.at)),
  };
}

/* ------------------------------------------------------------------ */
/* Certificates                                                        */
/* ------------------------------------------------------------------ */

export interface ApiCertificate {
  id: string;
  code: string;
  userId: string;
  courseId: string | null;
  batchId: string | null;
  issueDate: string;
  expiryDate: string | null;
  published: boolean;
  verifyUrl: string;
}

export function serializeCertificate(certificate: Certificate, ctx: SerializeContext): ApiCertificate {
  return {
    id: certificate.id,
    code: certificate.code,
    userId: certificate.userId,
    courseId: certificate.courseId ?? null,
    batchId: certificate.batchId ?? null,
    issueDate: certificate.issueDate,
    expiryDate: certificate.expiryDate ?? null,
    published: certificate.published,
    verifyUrl: `${ctx.baseUrl}/certificates/${encodeURIComponent(certificate.code)}`,
  };
}

export function certificateStamps(certificate: Certificate): Timestamps {
  return { createdAt: certificate.issueDate, updatedAt: certificate.issueDate };
}

/* ------------------------------------------------------------------ */
/* Batches                                                             */
/* ------------------------------------------------------------------ */

export interface ApiBatch {
  id: string;
  slug: string;
  url: string;
  title: string;
  description: string;
  imageUrl: string | null;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  timezone: string;
  medium: Batch["medium"];
  /** Relative to now, using the batch's own time zone. */
  status: "upcoming" | "active" | "completed";
  /** 0 = unlimited. */
  seatCount: number;
  seatsTaken: number;
  seatsLeft: number | null;
  paidBatch: boolean;
  amount: number;
  currency: string;
  published: boolean;
  allowSelfEnrollment: boolean;
  certification: boolean;
  instructors: ApiUserRef[];
  courseIds: string[];
  createdAt: string;
  updatedAt: string;
}

export function serializeBatch(
  batch: Batch,
  state: { seatsTaken: number; status: ApiBatch["status"] },
  users: ReadonlyMap<string, User>,
  ctx: SerializeContext,
): ApiBatch {
  const { seatsTaken, status } = state;
  return {
    id: batch.id,
    slug: batch.slug,
    url: `${ctx.baseUrl}/batches/${batch.slug}`,
    title: batch.title,
    description: batch.description,
    imageUrl: absoluteUrl(ctx.baseUrl, batch.imageUrl),
    startDate: batch.startDate,
    endDate: batch.endDate,
    startTime: batch.startTime,
    endTime: batch.endTime,
    timezone: batch.timezone,
    medium: batch.medium,
    status,
    seatCount: batch.seatCount,
    seatsTaken,
    seatsLeft: batch.seatCount > 0 ? Math.max(0, batch.seatCount - seatsTaken) : null,
    paidBatch: batch.paidBatch,
    amount: batch.amount,
    currency: batch.currency,
    published: batch.published,
    allowSelfEnrollment: batch.allowSelfEnrollment,
    certification: batch.certification,
    instructors: batch.instructorIds.flatMap((id) => {
      const user = users.get(id);
      return user ? [serializeUserRef(user)] : [];
    }),
    courseIds: [...batch.courseIds],
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
  };
}

export function batchStamps(batch: Batch): Timestamps {
  return { createdAt: batch.createdAt, updatedAt: batch.updatedAt };
}

export interface ApiBatchMember {
  id: string;
  batchId: string;
  userId: string;
  source: string | null;
  paymentId: string | null;
  enrolledAt: string;
}

export function serializeBatchMember(member: BatchEnrollment): ApiBatchMember {
  return {
    id: member.id,
    batchId: member.batchId,
    userId: member.userId,
    source: member.source ?? null,
    paymentId: member.paymentId ?? null,
    enrolledAt: member.enrolledAt,
  };
}

/* ------------------------------------------------------------------ */
/* Webhooks                                                            */
/* ------------------------------------------------------------------ */

export interface ApiWebhookEndpoint {
  id: string;
  url: string;
  description: string | null;
  /** Subscribed event names. */
  events: string[];
  active: boolean;
  /** "failing" while the latest attempts failed and are being retried. */
  status: WebhookEndpointStatus;
  /** Failed attempts in a row (0 after a success). */
  failureCount: number;
  lastError: string | null;
  lastDeliveryAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  /** Set when the system switched the endpoint off (repeated failures, 410 Gone). */
  disabledAt: string | null;
  disabledReason: WebhookDisabledReason | null;
  secretRotatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiWebhookEndpointWithSecret extends ApiWebhookEndpoint {
  /** Signing secret (`whsec_…`): returned only when the endpoint is created or its secret is rolled. */
  secret: string;
}

/** A webhook endpoint without its signing secret. */
export function serializeWebhookEndpoint(endpoint: WebhookEndpoint): ApiWebhookEndpoint {
  return {
    id: endpoint.id,
    url: endpoint.url,
    description: endpoint.description ?? null,
    events: [...endpoint.events],
    active: endpoint.active,
    status: webhookEndpointStatus(endpoint),
    failureCount: endpoint.failureCount,
    lastError: endpoint.lastError ?? null,
    lastDeliveryAt: endpoint.lastDeliveryAt ?? null,
    lastSuccessAt: endpoint.lastSuccessAt ?? null,
    lastFailureAt: endpoint.lastFailureAt ?? null,
    disabledAt: endpoint.disabledAt ?? null,
    disabledReason: endpoint.disabledReason ?? null,
    secretRotatedAt: endpoint.secretRotatedAt ?? null,
    createdAt: endpoint.createdAt,
    updatedAt: endpoint.updatedAt ?? endpoint.createdAt,
  };
}

export function webhookEndpointStamps(endpoint: WebhookEndpoint): Timestamps {
  return { createdAt: endpoint.createdAt, updatedAt: latest(endpoint.createdAt, endpoint.updatedAt) };
}

export interface ApiWebhookDelivery {
  id: string;
  endpointId: string;
  /** Event name, e.g. "payment.paid". */
  event: string;
  /** `id` of the payload: the same for every retry and resend of one event. */
  eventId: string;
  status: WebhookDelivery["status"];
  attempts: number;
  /** Sent with "Send test event". */
  test: boolean;
  /** The delivery this one repeats, for resends. */
  resentFromId: string | null;
  /** HTTP status the receiver answered with (null when no response arrived). */
  responseStatus: number | null;
  /** Start of the response body. */
  responseBody: string | null;
  /** Why the latest attempt failed. */
  error: string | null;
  /** Duration of the latest attempt in milliseconds. */
  durationMs: number | null;
  createdAt: string;
  lastAttemptAt: string | null;
  deliveredAt: string | null;
  /** When the next retry is due (pending deliveries only). */
  nextAttemptAt: string | null;
  /** The JSON body that was sent. */
  payload: Record<string, unknown> | null;
}

export function serializeWebhookDelivery(delivery: WebhookDelivery): ApiWebhookDelivery {
  const payload = parseWebhookPayload(delivery.payload);
  return {
    id: delivery.id,
    endpointId: delivery.endpointId,
    event: delivery.event,
    eventId: delivery.eventId ?? payload?.id ?? delivery.id,
    status: delivery.status,
    attempts: delivery.attempts,
    test: !!delivery.test,
    resentFromId: delivery.resentFromId ?? null,
    responseStatus: delivery.responseStatus ?? null,
    responseBody: delivery.responseBody ?? null,
    error: delivery.lastError ?? null,
    durationMs: delivery.durationMs ?? null,
    createdAt: delivery.createdAt,
    lastAttemptAt: delivery.lastAttemptAt ?? null,
    deliveredAt: delivery.deliveredAt ?? null,
    nextAttemptAt: delivery.status === "pending" ? (delivery.nextAttemptAt ?? null) : null,
    payload: payload ? { ...payload } : null,
  };
}

export function webhookDeliveryStamps(delivery: WebhookDelivery): Timestamps {
  return { createdAt: delivery.createdAt, updatedAt: latest(delivery.createdAt, delivery.lastAttemptAt, delivery.deliveredAt) };
}

export interface ApiWebhookEvent {
  /** Event name to subscribe to. */
  name: string;
  label: string;
  description: string;
  /** Fields of the payload's `data` object. */
  fields: { name: string; type: WebhookFieldDoc["type"]; description: string; optional: boolean; nullable: boolean; enum: string[] | null }[];
  /** The payload "Send test event" delivers for this event. */
  example: { id: string; type: string; createdAt: string; data: Record<string, unknown> };
}

export function serializeWebhookEvent(event: WebhookEventDoc, ctx: SerializeContext): ApiWebhookEvent {
  return {
    name: event.name,
    label: event.label,
    description: event.description,
    fields: event.fields.map((field) => ({
      name: field.name,
      type: field.type,
      description: field.description,
      optional: !!field.optional,
      nullable: !!field.nullable,
      enum: field.enum ? [...field.enum] : null,
    })),
    example: { id: `${TEST_EVENT_ID_PREFIX}4k8d2m`, type: event.name, createdAt: "2026-01-15T09:30:00.000Z", data: exampleEventData(event.name, ctx.baseUrl) },
  };
}
