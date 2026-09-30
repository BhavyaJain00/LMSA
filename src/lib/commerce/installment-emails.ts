import "server-only";
import type { Course, Payment, User } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { brandFromSettings, enqueueEmail, preferencesUrl, unsubscribeUrl } from "@/lib/email";
import { isSafeAddress } from "@/lib/email/mime";
import { resolveEmailPreferences } from "@/lib/email/preferences";
import { renderEmail, type EmailBlock, type EmailBrand } from "@/lib/email/templates";
import { notify } from "@/lib/services/notifications";
import { formatDate, formatPrice } from "@/lib/utils";
import { INSTALLMENT_GRACE_DAYS, planOfPayment, type InstallmentPart, type InstallmentPlan } from "./installments";

/**
 * Payment plan emails and in-app notices: the schedule after the first
 * payment, reminders around each due date, the pause warning, and the end of
 * a plan. "Due soon" and "due" reminders follow the learner's "payments"
 * email preference; everything that changes what they can access (paused,
 * cancelled, paid in full) is an account email and always sent. The in-app
 * notice never sends its own generic email copy, so there is exactly one
 * email per message.
 */

export type InstallmentMessage = "started" | "upcoming" | "due" | "last_warning" | "paused" | "charge_failed" | "completed" | "cancelled" | "waived";

interface Context {
  user: User;
  course: Course | null;
  part: Payment;
  plan: InstallmentPlan;
  brand: EmailBrand;
  emailEnabled: boolean;
  alreadySent: boolean;
}

async function context(partPaymentId: string, dedupeKey: string | undefined): Promise<Context | null> {
  const db = await getDb();
  const part = db.payments.find((p) => p.id === partPaymentId);
  if (!part) return null;
  const plan = planOfPayment(db.payments, part);
  const user = db.users.find((u) => u.id === part.userId);
  if (!plan || !user) return null;
  return {
    user,
    course: db.courses.find((c) => c.id === part.itemId) ?? null,
    part: { ...part },
    plan,
    brand: brandFromSettings(db.settings),
    emailEnabled: db.settings.email.enabled,
    alreadySent: !!dedupeKey && db.notifications.some((n) => n.userId === user.id && n.dedupeKey === dedupeKey),
  };
}

export function installmentOrderPath(orderId: string): string {
  return `/billing/success/${encodeURIComponent(orderId)}`;
}

function partLine(part: InstallmentPart, currency: string): string {
  const amount = formatPrice(part.amount, currency, "waived");
  if (part.status === "paid") return `${amount} · paid${part.paidAt ? ` on ${formatDate(part.paidAt)}` : ""}`;
  if (part.status === "waived") return "Waived";
  if (part.status === "refunded") return `${amount} · refunded`;
  if (part.status === "cancelled") return `${amount} · cancelled`;
  return `${amount} · due ${part.dueAt ? formatDate(part.dueAt) : "later"}`;
}

function scheduleBlock(plan: InstallmentPlan): EmailBlock {
  return { type: "details", title: "Your payment plan", rows: plan.parts.map((p) => ({ label: `Payment ${p.number} of ${plan.total}`, value: partLine(p, plan.currency) })) };
}

interface Copy {
  subject: string;
  notice: string;
  heading: string;
  blocks: EmailBlock[];
  link: string;
  /** Follows the learner's "payments" email preference. */
  optional?: boolean;
}

function copyFor(kind: InstallmentMessage, ctx: Context): Copy {
  const { plan, part, course } = ctx;
  const title = course?.title ?? part.itemTitle.replace(/ · payment \d+ of \d+$/, "");
  const coursePath = course ? `/courses/${course.slug}` : "/courses";
  const planPath = installmentOrderPath(plan.anchor.orderId);
  const next = plan.next;
  const nextLabel = next ? `Payment ${next.number} of ${plan.total}` : `Payment ${part.installmentNumber ?? 1} of ${plan.total}`;
  const nextAmount = formatPrice(next?.amount ?? part.amount, plan.currency);
  const nextDue = next?.dueAt ? formatDate(next.dueAt) : "";
  const pausesOn = plan.pausesAt ? formatDate(plan.pausesAt) : "";
  const payPath = installmentOrderPath(next?.orderId ?? part.orderId);
  const pay: EmailBlock = { type: "button", label: `Pay ${nextAmount}`, url: payPath };
  const auto = plan.autoCharge;

  switch (kind) {
    case "started":
      return {
        subject: `Your payment plan for ${title}`,
        notice: next ? `${plan.total} payments of ${formatPrice(part.amount, plan.currency)}. The next one is due on ${nextDue}.` : `${plan.total} payments of ${formatPrice(part.amount, plan.currency)}.`,
        heading: "Your payment plan is set up",
        link: planPath,
        blocks: [
          { type: "paragraph", text: `Thanks for your first payment. You have full access to ${title} while your plan is up to date.` },
          scheduleBlock(plan),
          {
            type: "callout",
            tone: "info",
            text: auto
              ? "The remaining payments are charged to your card automatically on the dates above. There is nothing you need to do."
              : "We'll remind you a few days before each payment is due. You can also pay early at any time from your orders page.",
          },
          { type: "button", label: "Start learning", url: coursePath },
          { type: "muted", text: `If a payment is more than ${INSTALLMENT_GRACE_DAYS} days late, access to the course is paused until it is paid. Your progress is always kept.` },
        ],
      };
    case "upcoming":
      return {
        subject: `${nextLabel} for ${title} is due on ${nextDue}`,
        notice: `${nextAmount} is due on ${nextDue}. You can pay it now.`,
        heading: "A payment is coming up",
        link: payPath,
        optional: true,
        blocks: [
          { type: "paragraph", text: `${nextLabel} for ${title} is due on ${nextDue}.` },
          { type: "details", rows: [{ label: "Amount", value: nextAmount }, { label: "Due", value: nextDue }, { label: "Paid so far", value: `${plan.paidCount} of ${plan.total} payments` }] },
          pay,
        ],
      };
    case "due":
      return {
        subject: `${nextLabel} for ${title} is due`,
        notice: `${nextAmount} was due on ${nextDue}. Pay by ${pausesOn} to keep your access.`,
        heading: "Your payment is due",
        link: payPath,
        optional: true,
        blocks: [
          {
            type: "paragraph",
            text: auto
              ? `We haven't been able to collect ${nextLabel.toLowerCase()} for ${title} (${nextAmount}, due ${nextDue}). You can pay it yourself with the button below.`
              : `${nextLabel} for ${title} (${nextAmount}) was due on ${nextDue}.`,
          },
          { type: "callout", tone: "warning", text: `Pay by ${pausesOn} to keep learning without interruption.` },
          pay,
        ],
      };
    case "charge_failed":
      return {
        subject: `We couldn't charge your card for ${title}`,
        notice: `${nextLabel} (${nextAmount}) could not be charged. Pay it to keep your access.`,
        heading: "Your payment didn't go through",
        link: payPath,
        blocks: [
          { type: "paragraph", text: `The automatic charge for ${nextLabel.toLowerCase()} of your ${title} payment plan was declined.` },
          { type: "callout", tone: "warning", text: pausesOn ? `Pay ${nextAmount} by ${pausesOn} to keep your access. You can use another card.` : `Pay ${nextAmount} to keep your access. You can use another card.` },
          pay,
        ],
      };
    case "last_warning":
      return {
        subject: `Access to ${title} pauses on ${pausesOn}`,
        notice: `${nextLabel} (${nextAmount}) is ${plan.overdueDays} days overdue. Access pauses on ${pausesOn}.`,
        heading: "Your access is about to pause",
        link: payPath,
        blocks: [
          { type: "paragraph", text: `${nextLabel} for ${title} (${nextAmount}) has been overdue since ${nextDue}.` },
          { type: "callout", tone: "danger", text: `Unless it is paid by ${pausesOn}, the lessons lock until the payment arrives. Your progress stays saved.` },
          pay,
        ],
      };
    case "paused":
      return {
        subject: `Your access to ${title} is paused`,
        notice: `${nextLabel} (${nextAmount}) is overdue. Pay it to unlock the course again.`,
        heading: "Your access is paused",
        link: payPath,
        blocks: [
          { type: "paragraph", text: `${nextLabel} for ${title} (${nextAmount}) is more than ${INSTALLMENT_GRACE_DAYS} days overdue, so the lessons are locked for now.` },
          { type: "callout", tone: "info", text: "Your progress, notes and quiz results are saved. Everything unlocks again as soon as the payment arrives." },
          pay,
        ],
      };
    case "completed":
      return {
        subject: `${title} is paid in full`,
        notice: `All ${plan.total} payments are complete. The course is yours for good.`,
        heading: "You've paid in full",
        link: coursePath,
        blocks: [
          { type: "paragraph", text: `That was the last payment of your plan for ${title}. The course is yours to keep, with nothing more to pay.` },
          scheduleBlock(plan),
          { type: "button", label: "Continue learning", url: coursePath },
        ],
      };
    case "waived":
      return {
        subject: `The remaining payments for ${title} were waived`,
        notice: "Nothing more is due on your payment plan. The course is yours to keep.",
        heading: "Nothing more to pay",
        link: coursePath,
        blocks: [
          { type: "paragraph", text: `We've waived the remaining payments of your plan for ${title}. You keep full access and nothing more is due.` },
          { type: "button", label: "Continue learning", url: coursePath },
        ],
      };
    case "cancelled":
      return {
        subject: `Your payment plan for ${title} was cancelled`,
        notice: "The remaining payments were cancelled and the lessons are locked. Your progress is saved.",
        heading: "Your payment plan was cancelled",
        link: coursePath,
        blocks: [
          { type: "paragraph", text: `Your payment plan for ${title} was cancelled, so no further payments are due and the lessons are locked.` },
          { type: "paragraph", text: "Your progress is saved. If you'd like to continue, you can buy the course from its page, or reply to this email and we'll help." },
          { type: "button", label: "View the course", url: coursePath },
        ],
      };
  }
  // Exhaustive switch: every message kind returns above.
  return { subject: ctx.brand.name, notice: "", heading: ctx.brand.name, blocks: [], link: planPath };
}

/**
 * Tell a learner about their payment plan: an in-app notice (deduplicated by
 * `dedupeKey`) and an email. `partPaymentId` is any order of the plan.
 * Returns true when the notice was created. Never throws: messaging must not
 * undo the payment work it reports.
 */
export async function sendInstallmentMessage(partPaymentId: string, kind: InstallmentMessage, opts: { dedupeKey?: string } = {}): Promise<boolean> {
  try {
    const ctx = await context(partPaymentId, opts.dedupeKey);
    if (!ctx || ctx.alreadySent) return false;
    const copy = copyFor(kind, ctx);
    await notify(ctx.user.id, { type: "system", subject: copy.subject, message: copy.notice, link: copy.link, dedupeKey: opts.dedupeKey, email: false });
    if (!ctx.emailEnabled || !ctx.user.enabled || !isSafeAddress(ctx.user.email)) return true;
    if (copy.optional && !resolveEmailPreferences(ctx.user).payments) return true;
    const rendered = renderEmail(ctx.brand, copy.subject, {
      preheader: copy.notice,
      eyebrow: "Payment plan",
      heading: copy.heading,
      greeting: `Hi ${ctx.user.name.split(/\s+/)[0] || "there"},`,
      blocks: copy.blocks,
      signoff: ["Happy learning,", `The ${ctx.brand.name} team`],
      footer: copy.optional
        ? {
            reason: `You're receiving this because you have payment emails turned on at ${ctx.brand.name}.`,
            preferencesUrl: preferencesUrl(),
            unsubscribeUrl: unsubscribeUrl(ctx.user.id, "payments"),
            unsubscribeLabel: "Unsubscribe from payment reminders",
          }
        : { reason: `You received this email because you are paying a course at ${ctx.brand.name} in installments.`, preferencesUrl: preferencesUrl() },
    });
    await enqueueEmail({ to: ctx.user.email, toName: ctx.user.name, userId: ctx.user.id, subject: rendered.subject, html: rendered.html, text: rendered.text, category: "payment" });
    return true;
  } catch (error) {
    console.error("[installments] could not send a payment plan message:", error instanceof Error ? error.message : String(error));
    return false;
  }
}
