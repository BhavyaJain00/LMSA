import "server-only";
import type { EmailMessage, User } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { siteConfig } from "@/lib/config";
import { formatDate, formatDateTime, formatPrice } from "@/lib/utils";
import { addMinutesToClock, formatClock12, formatDayKey, formatTzLabel, zonedTimeToUtc } from "@/components/batches/tz";
import { brandFromSettings } from "./context";
import { gatewayLabel, liveClassProviderLabel, paymentItemLabel, utcStamp } from "./format";
import { isSafeAddress } from "./mime";
import { enqueueEmail, enqueueEmails, type EnqueueEmailInput } from "./outbox";
import { resolveEmailPreferences } from "./preferences";
import { preferencesUrl, unsubscribeUrl } from "./signing";
import { getTransportStatus } from "./transport";
import {
  certificateIssuedEmail,
  emailVerificationEmail,
  enrollmentConfirmationEmail,
  liveClassEmail,
  passwordResetEmail,
  paymentReceiptEmail,
  paymentReminderEmail,
  testEmail,
  welcomeEmail,
  type RenderedEmail,
} from "./templates";

/**
 * Ready-made senders for the rest of the app. Each loads what it needs,
 * applies the email rules (master switch + member preferences for optional
 * emails; auth emails always send) and queues the message.
 */

type Recipient = Pick<User, "id" | "name" | "email"> & Partial<Pick<User, "enabled" | "emailPreferences">>;

function input(rendered: RenderedEmail, user: Recipient, category: EnqueueEmailInput["category"]): EnqueueEmailInput {
  return { to: user.email, toName: user.name, userId: user.id, subject: rendered.subject, html: rendered.html, text: rendered.text, category };
}

/* ------------------------------------------------------------------ */
/* Account emails (always sent)                                        */
/* ------------------------------------------------------------------ */

export async function sendWelcomeEmail(user: Recipient, opts: { verifyUrl?: string } = {}): Promise<EmailMessage | null> {
  if (!isSafeAddress(user.email)) return null;
  const db = await getDb();
  const rendered = welcomeEmail(brandFromSettings(db.settings), {
    name: user.name,
    verifyUrl: opts.verifyUrl,
    footer: { reason: `You received this email because you created an account on ${db.settings.brand.name}.`, preferencesUrl: preferencesUrl() },
  });
  return enqueueEmail(input(rendered, user, "welcome"));
}

export async function sendPasswordResetEmail(opts: {
  user: Recipient;
  resetUrl: string;
  expiresInMinutes?: number;
  ipAddress?: string;
}): Promise<EmailMessage | null> {
  if (!isSafeAddress(opts.user.email)) return null;
  const db = await getDb();
  const rendered = passwordResetEmail(brandFromSettings(db.settings), {
    name: opts.user.name,
    resetUrl: opts.resetUrl,
    expiresInMinutes: opts.expiresInMinutes,
    requestedAt: utcStamp(),
    ipAddress: opts.ipAddress,
  });
  return enqueueEmail(input(rendered, opts.user, "password_reset"));
}

export async function sendEmailVerificationEmail(opts: { user: Recipient; verifyUrl: string; expiresInHours?: number }): Promise<EmailMessage | null> {
  if (!isSafeAddress(opts.user.email)) return null;
  const db = await getDb();
  const rendered = emailVerificationEmail(brandFromSettings(db.settings), {
    name: opts.user.name,
    verifyUrl: opts.verifyUrl,
    expiresInHours: opts.expiresInHours,
  });
  return enqueueEmail(input(rendered, opts.user, "email_verification"));
}

/* ------------------------------------------------------------------ */
/* Learning emails (respect preferences)                               */
/* ------------------------------------------------------------------ */

/** Course enrollment confirmation to the learner. */
export async function sendCourseEnrollmentEmail(userId: string, courseId: string, opts: { addedBy?: string } = {}): Promise<EmailMessage | null> {
  const db = await getDb();
  if (!db.settings.email.enabled) return null;
  const user = db.users.find((u) => u.id === userId);
  const course = db.courses.find((c) => c.id === courseId);
  if (!user || !course || !user.enabled || !isSafeAddress(user.email) || !resolveEmailPreferences(user).enrollment) return null;
  const brand = brandFromSettings(db.settings);
  const lessons = db.lessons.filter((l) => l.courseId === course.id).length;
  const rendered = enrollmentConfirmationEmail(brand, {
    name: user.name,
    kind: "course",
    title: course.title,
    url: `/courses/${course.slug}`,
    summary: course.shortIntroduction || undefined,
    addedBy: opts.addedBy,
    details: [
      { label: "Instructors", value: course.instructorIds.map((id) => db.users.find((u) => u.id === id)?.name).filter(Boolean).join(", ") },
      { label: "Lessons", value: lessons ? String(lessons) : "" },
    ],
    footer: {
      reason: `You're receiving this because you enrolled in ${course.title}.`,
      preferencesUrl: preferencesUrl(),
      unsubscribeUrl: unsubscribeUrl(user.id, "enrollment"),
      unsubscribeLabel: "Unsubscribe from enrollment emails",
    },
  });
  return enqueueEmail(input(rendered, user, "notification"));
}

/** Certificate issued (when the caller has the certificate id rather than a notification). */
export async function sendCertificateIssuedEmail(certificateId: string): Promise<EmailMessage | null> {
  const db = await getDb();
  if (!db.settings.email.enabled) return null;
  const cert = db.certificates.find((c) => c.id === certificateId);
  const user = cert ? db.users.find((u) => u.id === cert.userId) : null;
  if (!cert || !user || !user.enabled || !isSafeAddress(user.email) || !resolveEmailPreferences(user).certificates) return null;
  const course = cert.courseId ? db.courses.find((c) => c.id === cert.courseId) : null;
  const rendered = certificateIssuedEmail(brandFromSettings(db.settings), {
    name: user.name,
    courseTitle: course?.title ?? "your course",
    code: cert.code,
    issueDate: formatDate(cert.issueDate),
    expiryDate: cert.expiryDate ? formatDate(cert.expiryDate) : undefined,
    evaluatorName: cert.evaluatorId ? db.users.find((u) => u.id === cert.evaluatorId)?.name : undefined,
    certificateUrl: `/certificates/${cert.code}`,
    footer: {
      reason: `You're receiving this because you earned a certificate on ${db.settings.brand.name}.`,
      preferencesUrl: preferencesUrl(),
      unsubscribeUrl: unsubscribeUrl(user.id, "certificates"),
      unsubscribeLabel: "Unsubscribe from certificate emails",
    },
  });
  return enqueueEmail(input(rendered, user, "notification"));
}

/** Same-day reminder for a live class to every enrolled student of its batch. Returns the number queued. */
export async function sendLiveClassReminderEmails(liveClassId: string): Promise<number> {
  const db = await getDb();
  if (!db.settings.email.enabled || !db.settings.email.notifyTypes.includes("live_class")) return 0;
  const liveClass = db.liveClasses.find((c) => c.id === liveClassId);
  const batch = liveClass ? db.batches.find((b) => b.id === liveClass.batchId) : null;
  if (!liveClass || !batch) return 0;
  const brand = brandFromSettings(db.settings);
  const startsAt = zonedTimeToUtc(liveClass.date, liveClass.time, liveClass.timezone);
  const host = db.users.find((u) => u.id === liveClass.hostId);
  const link = `/batches/${batch.slug}?tab=classes#class-${liveClass.id}`;
  const inputs: EnqueueEmailInput[] = [];
  for (const e of db.batchEnrollments.filter((x) => x.batchId === batch.id)) {
    const user = db.users.find((u) => u.id === e.userId);
    if (!user || !user.enabled || !isSafeAddress(user.email) || !resolveEmailPreferences(user).liveClasses) continue;
    const rendered = liveClassEmail(brand, {
      name: user.name,
      variant: "reminder",
      subject: `Live class today: ${liveClass.title}`,
      classTitle: liveClass.title,
      batchTitle: batch.title,
      description: liveClass.description,
      dateLabel: formatDayKey(liveClass.date, "long"),
      timeLabel: `${formatClock12(liveClass.time)} – ${formatClock12(addMinutesToClock(liveClass.time, liveClass.durationMinutes))}`,
      timezoneLabel: Number.isNaN(startsAt) ? liveClass.timezone : formatTzLabel(liveClass.timezone, startsAt),
      durationLabel: `${liveClass.durationMinutes} minutes`,
      hostName: host?.name,
      providerLabel: liveClassProviderLabel(liveClass.provider),
      joinUrl: /^https?:\/\//i.test(liveClass.joinUrl) ? liveClass.joinUrl : undefined,
      detailsUrl: link,
      footer: {
        reason: `You're receiving this because you're enrolled in ${batch.title}.`,
        preferencesUrl: preferencesUrl(),
        unsubscribeUrl: unsubscribeUrl(user.id, "liveClasses"),
        unsubscribeLabel: "Unsubscribe from live class emails",
      },
    });
    inputs.push(input(rendered, user, "reminder"));
  }
  await enqueueEmails(inputs);
  return inputs.length;
}

/* ------------------------------------------------------------------ */
/* Payments                                                            */
/* ------------------------------------------------------------------ */

/** Receipt for a paid order (receipts ignore preferences but respect the master switch). */
export async function sendPaymentReceiptEmail(paymentId: string): Promise<EmailMessage | null> {
  const db = await getDb();
  if (!db.settings.email.enabled) return null;
  const payment = db.payments.find((p) => p.id === paymentId);
  const user = payment ? db.users.find((u) => u.id === payment.userId) : null;
  if (!payment || payment.status !== "paid" || !user || !user.enabled || !isSafeAddress(user.email)) return null;
  const brand = brandFromSettings(db.settings);
  const course = payment.itemType !== "batch" ? db.courses.find((c) => c.id === payment.itemId) : null;
  const batch = payment.itemType === "batch" ? db.batches.find((b) => b.id === payment.itemId) : null;
  const rendered = paymentReceiptEmail(brand, {
    name: user.name,
    orderId: payment.orderId,
    invoiceNumber: payment.invoiceNumber,
    itemTitle: payment.itemTitle,
    itemLabel: paymentItemLabel(payment.itemType),
    originalAmount: formatPrice(payment.originalAmount, payment.currency, "Free"),
    discountAmount: payment.discountAmount ? `−${formatPrice(payment.discountAmount, payment.currency)}` : undefined,
    couponCode: payment.couponCode,
    taxAmount: payment.taxAmount ? formatPrice(payment.taxAmount, payment.currency) : undefined,
    taxLabel: db.settings.commerce.taxLabel || "Tax",
    total: formatPrice(payment.amount, payment.currency, "Free"),
    paidAt: formatDateTime(payment.paidAt ?? payment.createdAt),
    gateway: gatewayLabel(payment.gateway),
    gatewayPaymentId: payment.gatewayPaymentId,
    billingName: payment.billingName,
    accessUrl: batch ? `/batches/${batch.slug}` : course ? `/courses/${course.slug}` : "/",
    invoiceUrl: `${siteConfig.appUrl}/billing/success/${encodeURIComponent(payment.orderId)}`,
    footer: { reason: `You received this receipt because you made a purchase on ${brand.name}.`, preferencesUrl: preferencesUrl() },
  });
  return enqueueEmail(input(rendered, user, "payment"));
}

/** Reminder for an unpaid order (respects the "payments" preference). */
export async function sendPaymentReminderEmail(paymentId: string, checkoutPath?: string): Promise<EmailMessage | null> {
  const db = await getDb();
  if (!db.settings.email.enabled) return null;
  const payment = db.payments.find((p) => p.id === paymentId);
  const user = payment ? db.users.find((u) => u.id === payment.userId) : null;
  if (!payment || payment.status !== "pending" || !user || !user.enabled || !isSafeAddress(user.email) || !resolveEmailPreferences(user).payments) return null;
  const rendered = paymentReminderEmail(brandFromSettings(db.settings), {
    name: user.name,
    orderId: payment.orderId,
    itemTitle: payment.itemTitle,
    amount: formatPrice(payment.amount, payment.currency),
    createdAt: formatDateTime(payment.createdAt),
    checkoutUrl: checkoutPath ?? payment.checkoutUrl ?? `/billing/${payment.itemType}/${payment.itemId}`,
    footer: {
      reason: "You're receiving this because you started an order and haven't completed the payment.",
      preferencesUrl: preferencesUrl(),
      unsubscribeUrl: unsubscribeUrl(user.id, "payments"),
      unsubscribeLabel: "Unsubscribe from payment reminders",
    },
  });
  return enqueueEmail(input(rendered, user, "payment"));
}

/* ------------------------------------------------------------------ */
/* Test                                                                */
/* ------------------------------------------------------------------ */

/** Send a test message and wait for the delivery result. */
export async function sendTestEmail(to: string, requestedBy: Pick<User, "id" | "name">): Promise<EmailMessage> {
  const db = await getDb();
  const brand = brandFromSettings(db.settings);
  const status = getTransportStatus(db.settings);
  const rendered = testEmail(brand, {
    requestedBy: requestedBy.name,
    transportLabel: status.label,
    sentAt: `${formatDateTime(new Date().toISOString())} (server time)`,
    outboxUrl: "/admin/emails",
  });
  return enqueueEmail({ to, subject: rendered.subject, html: rendered.html, text: rendered.text, category: "test" }, { deliverNow: true });
}
