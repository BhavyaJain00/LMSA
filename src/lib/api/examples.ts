import { WEBHOOK_EVENTS } from "@/lib/webhooks/events";
import { buildTestPayload, serializeWebhookPayload } from "@/lib/webhooks/payload";
import type { ApiResourceName } from "./endpoints";
import {
  serializeWebhookEvent,
  type ApiBatch,
  type ApiBatchMember,
  type ApiCertificate,
  type ApiCourse,
  type ApiCourseDetail,
  type ApiDeleted,
  type ApiEnrollment,
  type ApiKeyInfo,
  type ApiPayment,
  type ApiProgress,
  type ApiUser,
  type ApiUserRef,
  type ApiWebhookDelivery,
  type ApiWebhookEndpoint,
  type ApiWebhookEndpointWithSecret,
} from "./serializers";

/**
 * Example response payloads for the OpenAPI document and the /developers
 * reference. Each example is typed against its serializer interface, so it
 * always has the exact shape the API returns. The ids match the ones used
 * in the documented requests (`examples` in `endpoints.ts`).
 *
 * Pure module: no database access.
 */

const CREATED = "2026-01-12T08:30:00.000Z";
const UPDATED = "2026-02-03T14:05:00.000Z";

function instructor(): ApiUserRef {
  return { id: "usr_maya", name: "Maya Chen", username: "maya-chen" };
}

function course(baseUrl: string): ApiCourse {
  return {
    id: "crs_data101",
    slug: "intro-to-data-analysis",
    url: `${baseUrl}/courses/intro-to-data-analysis`,
    title: "Intro to Data Analysis",
    shortIntroduction: "Learn to clean, explore and chart data with spreadsheets and SQL.",
    description: "A hands-on course for complete beginners.\n\n- Six chapters\n- One project per chapter",
    imageUrl: `${baseUrl}/uploads/courses/data101.jpg`,
    videoUrl: null,
    category: { id: "cat_data", name: "Data", slug: "data" },
    tags: ["data", "sql"],
    price: 4900,
    currency: "USD",
    paidCourse: true,
    published: true,
    publishedOn: "2026-01-15",
    publishAt: null,
    upcoming: false,
    featured: true,
    status: "approved",
    enableCertification: true,
    paidCertificate: false,
    certificatePrice: 0,
    instructors: [instructor()],
    chapterCount: 1,
    lessonCount: 2,
    durationSeconds: 1500,
    enrollmentCount: 128,
    metaDescription: "Clean, explore and chart data with spreadsheets and SQL.",
    createdAt: CREATED,
    updatedAt: UPDATED,
  };
}

function courseDetail(baseUrl: string): ApiCourseDetail {
  const lessonUrl = (number: string) => `${baseUrl}/courses/intro-to-data-analysis/learn/${number}`;
  return {
    ...course(baseUrl),
    outcomes: ["Clean messy spreadsheets", "Write SELECT queries with joins"],
    requirements: ["A laptop with a browser"],
    prerequisiteCourseIds: [],
    outline: [
      {
        id: "chp_basics",
        title: "Getting started",
        description: null,
        order: 1,
        lessons: [
          {
            id: "lsn_welcome",
            slug: "welcome",
            title: "Welcome",
            order: 1,
            number: "1-1",
            url: lessonUrl("1-1"),
            durationSeconds: 300,
            includeInPreview: true,
            contentTypes: ["video", "markdown"],
            publishAt: null,
            updatedAt: UPDATED,
          },
          {
            id: "lsn_sheets",
            slug: "working-with-spreadsheets",
            title: "Working with spreadsheets",
            order: 2,
            number: "1-2",
            url: lessonUrl("1-2"),
            durationSeconds: 1200,
            includeInPreview: false,
            contentTypes: ["markdown", "quiz"],
            publishAt: null,
            updatedAt: UPDATED,
          },
        ],
      },
    ],
  };
}

function user(baseUrl: string): ApiUser {
  return {
    id: "usr_priya",
    username: "priya-sharma",
    name: "Priya Sharma",
    email: "priya@example.com",
    roles: ["student"],
    enabled: true,
    headline: "Data analyst in training",
    location: "Pune, India",
    bio: null,
    avatarUrl: null,
    profileUrl: `${baseUrl}/user/priya-sharma`,
    emailVerified: true,
    twoFactorEnabled: false,
    createdAt: CREATED,
    lastActiveAt: UPDATED,
  };
}

const ENROLLMENT: ApiEnrollment = {
  id: "enr_8k2m4x",
  userId: "usr_priya",
  courseId: "crs_data101",
  memberType: "student",
  progress: 50,
  completed: false,
  completedAt: null,
  enrolledAt: CREATED,
  currentLessonId: "lsn_sheets",
  paymentId: "pay_5n7q1r",
  batchId: null,
  certificateId: null,
};

const PROGRESS: ApiProgress = {
  enrollmentId: "enr_8k2m4x",
  userId: "usr_priya",
  courseId: "crs_data101",
  percent: 50,
  completedLessons: 1,
  totalLessons: 2,
  completed: false,
  completedAt: null,
  lastActivityAt: UPDATED,
  lessons: [
    { lessonId: "lsn_welcome", chapterId: "chp_basics", title: "Welcome", status: "complete", completedAt: "2026-01-12T09:00:00.000Z", timeSpentSeconds: 340, updatedAt: "2026-01-12T09:00:00.000Z" },
    { lessonId: "lsn_sheets", chapterId: "chp_basics", title: "Working with spreadsheets", status: "partial", completedAt: null, timeSpentSeconds: 610, updatedAt: UPDATED },
  ],
};

const PAYMENT: ApiPayment = {
  id: "pay_5n7q1r",
  orderId: "ORD-2026-0142",
  userId: "usr_priya",
  status: "paid",
  itemType: "course",
  itemId: "crs_data101",
  itemTitle: "Intro to Data Analysis",
  originalAmount: 4900,
  discountAmount: 490,
  taxAmount: 0,
  amount: 4410,
  refundedAmount: 0,
  currency: "USD",
  couponCode: "WELCOME10",
  gateway: "stripe",
  gatewayPaymentId: "pi_3Qx8example",
  invoiceNumber: "INV-2026-0142",
  billingName: "Priya Sharma",
  billingCountry: "IN",
  taxCountry: null,
  taxRate: null,
  installmentNumber: null,
  installmentsTotal: null,
  subscriptionId: null,
  affiliateId: null,
  upsellOfPaymentId: null,
  giftId: null,
  createdAt: CREATED,
  paidAt: "2026-01-12T08:31:10.000Z",
  refundedAt: null,
};

function certificate(baseUrl: string): ApiCertificate {
  return {
    id: "crt_2d6f8h",
    code: "LL-7Q4K-92XM",
    userId: "usr_priya",
    courseId: "crs_data101",
    batchId: null,
    issueDate: "2026-02-03",
    expiryDate: null,
    published: true,
    verifyUrl: `${baseUrl}/certificates/LL-7Q4K-92XM`,
  };
}

function batch(baseUrl: string): ApiBatch {
  return {
    id: "bat_spring26",
    slug: "spring-cohort",
    url: `${baseUrl}/batches/spring-cohort`,
    title: "Spring cohort",
    description: "Six weeks of live sessions with weekly projects.",
    imageUrl: null,
    startDate: "2026-03-02",
    endDate: "2026-04-10",
    startTime: "18:00",
    endTime: "19:30",
    timezone: "Asia/Kolkata",
    medium: "online",
    status: "upcoming",
    seatCount: 40,
    seatsTaken: 27,
    seatsLeft: 13,
    paidBatch: false,
    amount: 0,
    currency: "USD",
    published: true,
    allowSelfEnrollment: true,
    certification: true,
    instructors: [instructor()],
    courseIds: ["crs_data101"],
    createdAt: CREATED,
    updatedAt: UPDATED,
  };
}

const BATCH_MEMBER: ApiBatchMember = {
  id: "bte_4h8j2k",
  batchId: "bat_spring26",
  userId: "usr_priya",
  source: "api",
  paymentId: null,
  enrolledAt: UPDATED,
};

const WEBHOOK_ENDPOINT: ApiWebhookEndpoint = {
  id: "whk_3f9a2c",
  url: "https://hooks.example.com/learnloop",
  description: "CRM sync",
  events: ["enrollment.created", "payment.paid"],
  active: true,
  status: "active",
  failureCount: 0,
  lastError: null,
  lastDeliveryAt: UPDATED,
  lastSuccessAt: UPDATED,
  lastFailureAt: null,
  disabledAt: null,
  disabledReason: null,
  secretRotatedAt: null,
  createdAt: CREATED,
  updatedAt: CREATED,
};

const WEBHOOK_ENDPOINT_WITH_SECRET: ApiWebhookEndpointWithSecret = {
  ...WEBHOOK_ENDPOINT,
  lastDeliveryAt: null,
  lastSuccessAt: null,
  secret: "whsec_Xq2b7Lr9TzK4mWc1Pv8Hs3Nd6Fg0Jy5Ab2Ce4Gh7Ik9",
};

function webhookDelivery(baseUrl: string): ApiWebhookDelivery {
  const payload = buildTestPayload("enrollment.created", baseUrl, "evt_test_4k8d2m", new Date(UPDATED));
  return {
    id: "whd_91c4e7",
    endpointId: "whk_3f9a2c",
    event: "enrollment.created",
    eventId: payload.id,
    status: "success",
    attempts: 1,
    test: true,
    resentFromId: null,
    responseStatus: 200,
    responseBody: '{"received":true}',
    error: null,
    durationMs: 184,
    createdAt: UPDATED,
    lastAttemptAt: UPDATED,
    deliveredAt: UPDATED,
    nextAttemptAt: null,
    payload: JSON.parse(serializeWebhookPayload(payload)) as Record<string, unknown>,
  };
}

function keyInfo(baseUrl: string): ApiKeyInfo {
  return {
    apiVersion: "v1",
    key: { id: "key_7tq2", name: "CRM sync", prefix: "ll_live_7tq2x9mb4c", scopes: ["courses:read", "enrollments:write"], createdAt: CREATED, lastUsedAt: UPDATED },
    rateLimit: { limit: 120, windowSeconds: 60 },
    site: { name: "LearnLoop", url: baseUrl },
  };
}

const DELETED: ApiDeleted = { id: "enr_8k2m4x", object: "enrollment", deleted: true };

/** An example of a resource as the API returns it, on the given site origin. */
export function resourceExample(name: ApiResourceName, baseUrl: string): unknown {
  switch (name) {
    case "KeyInfo":
      return keyInfo(baseUrl);
    case "Course":
      return course(baseUrl);
    case "CourseDetail":
      return courseDetail(baseUrl);
    case "User":
      return user(baseUrl);
    case "Enrollment":
      return ENROLLMENT;
    case "Progress":
      return PROGRESS;
    case "Payment":
      return PAYMENT;
    case "Certificate":
      return certificate(baseUrl);
    case "Batch":
      return batch(baseUrl);
    case "BatchMember":
      return BATCH_MEMBER;
    case "WebhookEndpoint":
      return WEBHOOK_ENDPOINT;
    case "WebhookEndpointWithSecret":
      return WEBHOOK_ENDPOINT_WITH_SECRET;
    case "WebhookDelivery":
      return webhookDelivery(baseUrl);
    case "WebhookEvent":
      return serializeWebhookEvent(WEBHOOK_EVENTS[0], { baseUrl });
    case "Deleted":
      return DELETED;
  }
}

/** The full success body of an endpoint: `{ data }`, or `{ data: [...], meta }` for lists. */
export function responseExample(response: { resource: ApiResourceName; list?: boolean }, baseUrl: string): { data: unknown; meta?: Record<string, unknown> } {
  const item = resourceExample(response.resource, baseUrl);
  if (!response.list) return { data: item };
  return { data: [item], meta: { page: 1, perPage: 25, total: 1, totalPages: 1, hasMore: false } };
}
