import "server-only";
import type { Database, Notification, Payment, Settings, User } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { formatDate, formatDateTime, formatPrice } from "@/lib/utils";
import { addMinutesToClock, formatClock12, formatDayKey, formatTzLabel, zonedTimeToUtc } from "@/components/batches/tz";
import { brandFromSettings } from "./context";
import { isSafeAddress } from "./mime";
import { type EnqueueEmailInput, enqueueEmails } from "./outbox";
import { type EmailPreferenceKey, emailCategoryForNotification, preferenceForNotification, preferenceLabel, resolveEmailPreferences } from "./preferences";
import { preferencesUrl, unsubscribeUrl } from "./signing";
import { renderBatchConfirmation } from "./batch";
import { gatewayLabel, liveClassProviderLabel, paymentItemLabel } from "./format";
import {
  type EmailBrand,
  type EmailFooter,
  type LiveClassEmailVariant,
  type RenderedEmail,
  certificateIssuedEmail,
  enrollmentConfirmationEmail,
  gradedEmail,
  liveClassEmail,
  notificationEmail,
  paymentReceiptEmail,
  paymentRefundEmail,
} from "./templates";

/**
 * Email copies of in-app notifications.
 *
 * Rules (Settings → Email):
 *  - nothing is sent while `settings.email.enabled` is off;
 *  - the notification type must be in `settings.email.notifyTypes` (course
 *    and batch publishing also follow Learning → "Send notification … Email");
 *  - the recipient must exist, be enabled, have a valid address and allow
 *    the matching preference category (`EmailPreferences`);
 *  - nobody is emailed about their own action (`fromUserId`).
 * Payment receipts and batch enrollment confirmations are recognised from
 * the notification link and always follow their own rules (receipts cannot
 * be opted out of; confirmations are sent once per member).
 *
 * Where the notification points at a known record (certificate, live class,
 * quiz/assignment submission, course, payment) a richer template is used;
 * otherwise a generic notification email.
 */

interface Plan {
  input: EnqueueEmailInput;
  /** Mark the batch confirmation as sent (applied in one write after planning). */
  confirmationEnrollmentId?: string;
}

const REASONS: Record<EmailPreferenceKey, string> = {
  enrollment: "you have enrollment emails turned on",
  announcements: "you have announcement emails turned on",
  liveClasses: "you're enrolled in a batch with live classes",
  grading: "you have grade and feedback emails turned on",
  certificates: "you have certificate emails turned on",
  discussions: "you take part in this discussion",
  reminders: "you have reminder emails turned on",
  payments: "you have payment emails turned on",
};

function footer(brand: EmailBrand, user: User, pref: EmailPreferenceKey | null, reason?: string): EmailFooter {
  if (!pref) return { reason: reason ?? `You received this email because of activity on your ${brand.name} account.`, preferencesUrl: preferencesUrl() };
  return {
    reason: reason ?? `You're receiving this because ${REASONS[pref]} on ${brand.name}.`,
    preferencesUrl: preferencesUrl(),
    unsubscribeUrl: unsubscribeUrl(user.id, pref),
    unsubscribeLabel: `Unsubscribe from ${preferenceLabel(pref).toLowerCase()} emails`,
  };
}

function toInput(rendered: RenderedEmail, user: User, category: EnqueueEmailInput["category"]): EnqueueEmailInput {
  return { to: user.email, toName: user.name, userId: user.id, subject: rendered.subject, html: rendered.html, text: rendered.text, category };
}

function typeEnabled(settings: Settings, n: Notification): boolean {
  if (settings.email.notifyTypes.includes(n.type)) return true;
  if (n.type === "course_published" && settings.learning.notifyOnPublishedCourses === "email") return true;
  if (n.type === "batch_published" && settings.learning.notifyOnPublishedBatches === "email") return true;
  return false;
}

function pathOf(link: string | undefined): string {
  if (!link) return "";
  const hash = link.indexOf("#");
  const q = link.indexOf("?");
  const end = [hash, q].filter((i) => i >= 0).reduce((a, b) => Math.min(a, b), link.length);
  return link.slice(0, end);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function itemAccessUrl(db: Database, payment: Payment): string {
  if (payment.itemType === "batch") {
    const batch = db.batches.find((b) => b.id === payment.itemId);
    return batch ? `/batches/${batch.slug}` : "/batches";
  }
  const course = db.courses.find((c) => c.id === payment.itemId);
  if (!course) return "/courses";
  if (payment.itemType === "certificate") {
    const cert = db.certificates.find((c) => c.userId === payment.userId && c.courseId === course.id && c.published);
    return cert ? `/certificates/${cert.code}` : `/courses/${course.slug}`;
  }
  return `/courses/${course.slug}`;
}

/* ------------------------------------------------------------------ */
/* Rich variants                                                       */
/* ------------------------------------------------------------------ */

function paymentPlan(db: Database, brand: EmailBrand, n: Notification, user: User): Plan | null | undefined {
  const m = /^\/billing\/success\/([^/?#]+)/.exec(n.link ?? "");
  if (!m) return undefined;
  const payment = db.payments.find((p) => p.orderId === safeDecode(m[1]!) && p.userId === user.id);
  if (!payment) return undefined;
  const settings = db.settings;
  if (payment.status === "paid" && !/refund/i.test(n.subject)) {
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
      taxLabel: settings.commerce.taxLabel || "Tax",
      total: formatPrice(payment.amount, payment.currency, "Free"),
      paidAt: formatDateTime(payment.paidAt ?? payment.createdAt),
      gateway: gatewayLabel(payment.gateway),
      gatewayPaymentId: payment.gatewayPaymentId,
      billingName: payment.billingName,
      accessUrl: itemAccessUrl(db, payment),
      invoiceUrl: `${brand.appUrl}/billing/${payment.invoiceNumber ? "invoice" : "success"}/${encodeURIComponent(payment.orderId)}`,
      footer: footer(brand, user, null, `You received this receipt because you made a purchase on ${brand.name}.`),
    });
    return { input: toInput(rendered, user, "payment") };
  }
  if (payment.status === "refunded") {
    if (!resolveEmailPreferences(user).payments) return null;
    const rendered = paymentRefundEmail(brand, {
      name: user.name,
      orderId: payment.orderId,
      itemTitle: payment.itemTitle,
      refundedAmount: formatPrice(payment.refundedAmount ?? payment.amount, payment.currency),
      refundedAt: formatDateTime(payment.refundedAt ?? new Date().toISOString()),
      gateway: gatewayLabel(payment.gateway),
      refundId: payment.refundId,
      orderUrl: `/billing/success/${encodeURIComponent(payment.orderId)}`,
      footer: footer(brand, user, "payments"),
    });
    return { input: toInput(rendered, user, "payment") };
  }
  return undefined;
}

function batchConfirmationPlan(db: Database, brand: EmailBrand, n: Notification, user: User): Plan | null | undefined {
  if (n.type !== "batch_published") return undefined;
  const m = /^\/batches\/([^/?#]+)$/.exec(pathOf(n.link));
  if (!m) return undefined;
  const batch = db.batches.find((b) => b.slug === safeDecode(m[1]!));
  if (!batch) return undefined;
  const enrollment = db.batchEnrollments.find((e) => e.batchId === batch.id && e.userId === user.id);
  // Only a fresh enrollment whose confirmation hasn't gone out yet.
  if (!enrollment || enrollment.confirmationEmailSent || Date.now() - Date.parse(enrollment.enrolledAt) > 24 * 3_600_000) return undefined;
  if (!resolveEmailPreferences(user).enrollment) return null;
  const rendered = renderBatchConfirmation(db, brand, batch, user);
  return { input: toInput(rendered, user, "batch"), confirmationEnrollmentId: enrollment.id };
}

function liveClassVariant(subject: string): LiveClassEmailVariant {
  if (/^live class today/i.test(subject)) return "reminder";
  if (/rescheduled/i.test(subject)) return "rescheduled";
  if (/^new live class/i.test(subject)) return "scheduled";
  if (/recording/i.test(subject)) return "recording";
  return "update";
}

function richPlan(db: Database, brand: EmailBrand, n: Notification, user: User, pref: EmailPreferenceKey): RenderedEmail | null {
  const link = n.link ?? "";
  const path = pathOf(link);
  const f = footer(brand, user, pref);
  const actor = n.fromUserId ? db.users.find((u) => u.id === n.fromUserId) : null;

  if (n.type === "certificate") {
    const m = /^\/certificates\/([^/]+)$/.exec(path);
    const cert = m ? db.certificates.find((c) => c.code === safeDecode(m[1]!) && c.userId === user.id) : null;
    if (cert) {
      const course = cert.courseId ? db.courses.find((c) => c.id === cert.courseId) : null;
      const batch = cert.batchId ? db.batches.find((b) => b.id === cert.batchId) : null;
      const evaluator = cert.evaluatorId ? db.users.find((u) => u.id === cert.evaluatorId) : null;
      return certificateIssuedEmail(brand, {
        name: user.name,
        courseTitle: course?.title ?? batch?.title ?? "your course",
        code: cert.code,
        issueDate: formatDate(cert.issueDate),
        expiryDate: cert.expiryDate ? formatDate(cert.expiryDate) : undefined,
        evaluatorName: evaluator?.name,
        certificateUrl: link,
        subject: n.subject,
        footer: f,
      });
    }
  }

  if (n.type === "live_class") {
    const m = /#class-([A-Za-z0-9_-]+)/.exec(link);
    const liveClass = m ? db.liveClasses.find((c) => c.id === m[1]) : null;
    const batch = liveClass ? db.batches.find((b) => b.id === liveClass.batchId) : null;
    if (liveClass && batch) {
      const startsAt = zonedTimeToUtc(liveClass.date, liveClass.time, liveClass.timezone);
      const host = db.users.find((u) => u.id === liveClass.hostId);
      const variant = liveClassVariant(n.subject);
      const joinUrl = /^https?:\/\//i.test(liveClass.joinUrl) ? liveClass.joinUrl : undefined;
      return liveClassEmail(brand, {
        name: user.name,
        variant,
        subject: n.subject,
        classTitle: liveClass.title,
        batchTitle: batch.title,
        description: liveClass.description,
        dateLabel: formatDayKey(liveClass.date, "long"),
        timeLabel: `${formatClock12(liveClass.time)} – ${formatClock12(addMinutesToClock(liveClass.time, liveClass.durationMinutes))}`,
        timezoneLabel: Number.isNaN(startsAt) ? liveClass.timezone : formatTzLabel(liveClass.timezone, startsAt),
        durationLabel: `${liveClass.durationMinutes} minutes`,
        hostName: host?.name,
        providerLabel: liveClassProviderLabel(liveClass.provider),
        joinUrl,
        detailsUrl: link,
        recordingUrl: liveClass.recordingUrl ? link : undefined,
        footer: f,
      });
    }
  }

  if (n.type === "quiz_graded") {
    const m = /^\/quiz\/submissions\/([^/]+)$/.exec(path);
    const sub = m ? db.quizSubmissions.find((s) => s.id === safeDecode(m[1]!) && s.userId === user.id) : null;
    if (sub) {
      const course = sub.courseId ? db.courses.find((c) => c.id === sub.courseId) : null;
      const fmt = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
      return gradedEmail(brand, {
        name: user.name,
        kind: "quiz",
        title: sub.quizTitle,
        outcome: sub.pendingGrading ? "graded" : sub.passed ? "passed" : "failed",
        score: `${fmt(sub.score)} / ${fmt(sub.scoreOutOf)}`,
        percentage: sub.percentage,
        passingPercentage: sub.passingPercentage,
        graderName: actor?.name,
        courseTitle: course?.title,
        url: link,
        subject: n.subject,
        footer: f,
      });
    }
  }

  if (n.type === "assignment_graded") {
    const m = /^\/assignments\/([^/]+)$/.exec(path);
    const assignmentId = m ? safeDecode(m[1]!) : null;
    const sub = assignmentId
      ? db.assignmentSubmissions
          .filter((s) => s.assignmentId === assignmentId && s.userId === user.id)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
      : null;
    if (sub) {
      const course = sub.courseId ? db.courses.find((c) => c.id === sub.courseId) : null;
      const feedbackOnly = /comment/i.test(n.subject);
      return gradedEmail(brand, {
        name: user.name,
        kind: "assignment",
        title: sub.assignmentTitle,
        outcome: feedbackOnly ? "feedback" : sub.status === "pass" ? "passed" : sub.status === "fail" ? "failed" : "graded",
        feedbackMarkdown: sub.comments,
        graderName: actor?.name,
        courseTitle: course?.title,
        url: link,
        subject: n.subject,
        footer: f,
      });
    }
  }

  if (n.type === "enrollment") {
    const course = /^\/courses\/([^/]+)$/.exec(path);
    if (course) {
      const c = db.courses.find((x) => x.slug === safeDecode(course[1]!));
      const enrolled = c && db.enrollments.some((e) => e.courseId === c.id && e.userId === user.id && e.memberType === "student");
      if (c && enrolled) {
        const lessons = db.lessons.filter((l) => l.courseId === c.id).length;
        const instructors = c.instructorIds.map((id) => db.users.find((u) => u.id === id)?.name).filter(Boolean).join(", ");
        return enrollmentConfirmationEmail(brand, {
          name: user.name,
          kind: "course",
          title: c.title,
          url: `/courses/${c.slug}`,
          summary: c.shortIntroduction || undefined,
          addedBy: n.message,
          details: [
            { label: "Instructors", value: instructors },
            { label: "Lessons", value: lessons ? String(lessons) : "" },
          ],
          subject: n.subject,
          footer: f,
        });
      }
    }
    const program = /^\/programs\/([^/]+)$/.exec(path);
    if (program) {
      const p = db.programs.find((x) => x.slug === safeDecode(program[1]!));
      if (p && db.programMembers.some((m) => m.programId === p.id && m.userId === user.id)) {
        return enrollmentConfirmationEmail(brand, {
          name: user.name,
          kind: "program",
          title: p.title,
          url: `/programs/${p.slug}`,
          summary: p.description || undefined,
          details: [{ label: "Courses", value: String(p.courseIds.length) }],
          subject: n.subject,
          footer: f,
        });
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

function planFor(db: Database, brand: EmailBrand, n: Notification, user: User): Plan | null {
  const payment = paymentPlan(db, brand, n, user);
  if (payment !== undefined) return payment;
  const confirmation = batchConfirmationPlan(db, brand, n, user);
  if (confirmation !== undefined) return confirmation;

  if (!typeEnabled(db.settings, n)) return null;
  const pref = preferenceForNotification(n);
  if (!resolveEmailPreferences(user)[pref]) return null;

  const rich = richPlan(db, brand, n, user, pref);
  if (rich) return { input: toInput(rich, user, emailCategoryForNotification(n)) };

  const actor = n.fromUserId ? db.users.find((u) => u.id === n.fromUserId) : null;
  const rendered = notificationEmail(brand, {
    name: user.name,
    type: n.type,
    subject: n.subject,
    message: n.message,
    url: n.link,
    actorName: actor?.name,
    footer: footer(brand, user, pref),
  });
  return { input: toInput(rendered, user, emailCategoryForNotification(n)) };
}

/**
 * Queue the email copies for freshly created notifications. Never throws —
 * email problems must not break the action that created the notification.
 * Returns the number of emails queued.
 */
export async function emailNotifications(notifications: Notification[]): Promise<number> {
  if (!notifications.length) return 0;
  try {
    const db = await getDb();
    if (!db.settings.email.enabled) return 0;
    const brand = brandFromSettings(db.settings);
    const plans: Plan[] = [];
    for (const n of notifications) {
      const user = db.users.find((u) => u.id === n.userId);
      if (!user || !user.enabled || !isSafeAddress(user.email)) continue;
      if (n.fromUserId && n.fromUserId === user.id) continue;
      const plan = planFor(db, brand, n, user);
      if (plan) plans.push(plan);
    }
    if (!plans.length) return 0;
    const confirmations = plans.map((p) => p.confirmationEnrollmentId).filter((id): id is string => !!id);
    let allowed = plans;
    if (confirmations.length) {
      // Claim the "confirmation sent" flags atomically so a confirmation is only ever sent once.
      const claimed = await mutate((d) => {
        const ok = new Set<string>();
        for (const id of confirmations) {
          const row = d.batchEnrollments.find((e) => e.id === id);
          if (row && !row.confirmationEmailSent) {
            row.confirmationEmailSent = true;
            ok.add(id);
          }
        }
        return ok;
      });
      allowed = plans.filter((p) => !p.confirmationEnrollmentId || claimed.has(p.confirmationEnrollmentId));
    }
    await enqueueEmails(allowed.map((p) => p.input));
    return allowed.length;
  } catch (error) {
    console.error("[email] could not queue notification emails:", error instanceof Error ? error.message : String(error));
    return 0;
  }
}
