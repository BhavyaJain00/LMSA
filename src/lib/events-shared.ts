import type { MemberType, PaymentItemType, SubscriptionStatus } from "@/lib/types";

/**
 * Domain event names and payloads (round 3 wave B), shared by the server-side
 * event bus (`src/lib/events.ts`) and client UI that lists events, e.g. the
 * webhook endpoint form. No runtime imports: safe on the client.
 *
 * Payloads carry ids plus the few fields most handlers need; handlers look
 * up anything else in the store (the row may have changed since the event).
 */
export interface DomainEventMap {
  /** An order moved to paid (exactly once per order). */
  "payment.paid": {
    paymentId: string;
    orderId: string;
    userId: string;
    itemType: PaymentItemType;
    itemId: string;
    itemTitle: string;
    /** Amount charged (tax included), smallest currency unit. */
    amount: number;
    taxAmount: number;
    discountAmount: number;
    currency: string;
    gateway: string;
    couponCode?: string;
    affiliateId?: string;
  };
  /** Money was returned on a paid order: `full` when the order is now refunded and its access removed. */
  "payment.refunded": {
    paymentId: string;
    orderId: string;
    userId: string;
    itemType: PaymentItemType;
    itemId: string;
    /** Order amount. */
    amount: number;
    /** Total refunded so far on the order. */
    refundedAmount: number;
    currency: string;
    full: boolean;
  };
  /** A learner was newly enrolled in a course (not emitted for an existing enrollment). */
  "enrollment.created": {
    enrollmentId: string;
    userId: string;
    courseId: string;
    memberType: MemberType;
    paymentId?: string;
    batchId?: string;
  };
  /** A new account was created. */
  "user.registered": {
    userId: string;
    email: string;
    name: string;
    /** How the account was created. */
    source: "signup" | "admin" | "invite" | "import";
  };
  /** A marketing lead was captured for a new email address. */
  "lead.created": {
    leadId: string;
    email: string;
    name?: string;
    source: string;
    courseId?: string;
    consent: boolean;
  };
  /** A learner finished every lesson of a course (once per enrollment). */
  "course.completed": {
    enrollmentId: string;
    userId: string;
    courseId: string;
  };
  /** A lesson moved to complete for a learner (once per learner and lesson). */
  "lesson.completed": {
    userId: string;
    courseId: string;
    chapterId: string;
    lessonId: string;
  };
  /** A certificate was created (once per learner and course). */
  "certificate.issued": {
    certificateId: string;
    code: string;
    userId: string;
    courseId?: string;
    batchId?: string;
  };
  /** A membership subscription was created or changed status. */
  "subscription.changed": {
    subscriptionId: string;
    userId: string;
    planId: string;
    status: SubscriptionStatus;
    /** Status before the change; null for a new subscription. */
    previousStatus: SubscriptionStatus | null;
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: string;
  };
}

export type DomainEventName = keyof DomainEventMap;

/** A dispatched event: the payload plus a unique id and the time it happened. */
export interface DomainEvent<N extends DomainEventName = DomainEventName> {
  id: string;
  name: N;
  createdAt: string;
  data: DomainEventMap[N];
}

/** Every event with a short description (for webhook subscriptions, docs and admin UI). */
export const DOMAIN_EVENTS: readonly { name: DomainEventName; description: string }[] = [
  { name: "enrollment.created", description: "A learner was enrolled in a course." },
  { name: "payment.paid", description: "An order was paid." },
  { name: "payment.refunded", description: "An order was refunded, fully or in part." },
  { name: "course.completed", description: "A learner completed a course." },
  { name: "lesson.completed", description: "A learner completed a lesson." },
  { name: "certificate.issued", description: "A certificate was issued." },
  { name: "user.registered", description: "A new account was created." },
  { name: "subscription.changed", description: "A membership subscription started or changed status." },
  { name: "lead.created", description: "A new marketing lead signed up." },
];

export const DOMAIN_EVENT_NAMES: readonly DomainEventName[] = DOMAIN_EVENTS.map((e) => e.name);

export function isDomainEventName(value: unknown): value is DomainEventName {
  return typeof value === "string" && (DOMAIN_EVENT_NAMES as readonly string[]).includes(value);
}
