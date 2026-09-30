import type {
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
} from "@/lib/types";
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
  return { createdAt: user.createdAt, updatedAt: latest(user.createdAt, user.emailVerifiedAt, user.lastActiveAt) };
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
