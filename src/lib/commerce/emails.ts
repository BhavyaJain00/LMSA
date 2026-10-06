import "server-only";
import type { MembershipPlan, Payment, Subscription, User } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { brandFromSettings, enqueueEmail, preferencesUrl, unsubscribeUrl } from "@/lib/email";
import { isSafeAddress } from "@/lib/email/mime";
import { resolveEmailPreferences } from "@/lib/email/preferences";
import { renderEmail, type EmailBlock, type EmailBrand, type RenderedEmail } from "@/lib/email/templates";
import { notify } from "@/lib/services/notifications";
import { formatDate, formatPrice } from "@/lib/utils";
import { intervalSuffix, planAccessLabel } from "./plans";
import { pastDueGraceEnd } from "./subscriptions";

/**
 * Membership emails and in-app notices. Lifecycle messages (started, payment
 * due, ended, cancellation scheduled) are account emails about something the
 * member pays for, so they are sent whenever email is on; the renewal and
 * trial reminders follow the member's "payments" email preference. The
 * in-app notice never sends its own generic email copy (`email: false`), so
 * members get exactly one email per message.
 */

export type MembershipMessage = "started" | "trial_started" | "payment_due" | "ended" | "expired" | "cancel_scheduled" | "resumed" | "plan_changed" | "plan_change_scheduled" | "renewal_due" | "trial_ending";

const SUBSCRIPTION_PAGE = "/settings/subscription";

interface Context {
  user: User;
  subscription: Subscription;
  plan: MembershipPlan | null;
  /** The plan the membership moves to at its next renewal, when a change is scheduled. */
  pendingPlan: MembershipPlan | null;
  brand: EmailBrand;
  emailEnabled: boolean;
  /** A notice with this dedupe key was already sent. */
  alreadySent: boolean;
}

async function context(subscriptionId: string, dedupeKey: string | undefined): Promise<Context | null> {
  const db = await getDb();
  const subscription = db.subscriptions.find((s) => s.id === subscriptionId);
  if (!subscription) return null;
  const user = db.users.find((u) => u.id === subscription.userId);
  if (!user) return null;
  return {
    user,
    subscription: { ...subscription },
    plan: db.plans.find((p) => p.id === subscription.planId) ?? null,
    pendingPlan: subscription.pendingPlanId ? (db.plans.find((p) => p.id === subscription.pendingPlanId) ?? null) : null,
    brand: brandFromSettings(db.settings),
    emailEnabled: db.settings.email.enabled,
    alreadySent: !!dedupeKey && db.notifications.some((n) => n.userId === user.id && n.dedupeKey === dedupeKey),
  };
}

function price(plan: MembershipPlan | null): string {
  if (!plan) return "";
  return `${formatPrice(plan.price, plan.currency)}${intervalSuffix(plan.interval)}`;
}

function graceEnd(sub: Subscription): string {
  return new Date(pastDueGraceEnd(sub)).toISOString();
}

interface Copy {
  subject: string;
  notice: string;
  heading: string;
  blocks: EmailBlock[];
  /** Follows the member's "payments" email preference (reminders). */
  optional?: boolean;
}

function copyFor(kind: MembershipMessage, ctx: Context, extra: { order?: Payment; previousPlanName?: string }): Copy {
  const { subscription: sub, plan, brand } = ctx;
  const name = plan?.name ?? "your membership";
  const until = formatDate(sub.currentPeriodEnd);
  const manage: EmailBlock = { type: "button", label: "Manage your membership", url: SUBSCRIPTION_PAGE };
  const browse: EmailBlock = { type: "button", label: "Browse courses", url: "/courses" };
  const access = plan ? planAccessLabel(plan.access) : "";

  switch (kind) {
    case "trial_started":
      return {
        subject: `Your free trial of ${name} has started`,
        notice: `Your trial runs until ${until}. Cancel before then and you won't be charged.`,
        heading: "Your free trial has started",
        blocks: [
          { type: "paragraph", text: `Welcome aboard! You now have full access to ${access.toLowerCase()} until ${until}.` },
          { type: "details", rows: [{ label: "Plan", value: name }, { label: "Trial ends", value: until }, { label: "Then", value: price(plan) }] },
          { type: "callout", tone: "info", text: `You can cancel any time before ${until} from your membership page and nothing will be charged.` },
          browse,
          { type: "muted", text: "Manage or cancel your membership from Settings → Membership." },
        ],
      };
    case "started":
      return {
        subject: `Welcome to ${name}`,
        notice: sub.cancelAtPeriodEnd ? `Your access runs until ${until}.` : `Your membership is active until ${until}.`,
        heading: `Welcome to ${name}`,
        blocks: [
          { type: "paragraph", text: `Your membership is active. You have full access to ${access.toLowerCase()}.` },
          {
            type: "details",
            rows: [
              { label: "Plan", value: name },
              { label: "Price", value: price(plan) },
              { label: plan?.interval === "one_time" ? "Access" : "Current period ends", value: plan?.interval === "one_time" ? "Lifetime" : until },
            ],
          },
          browse,
          { type: "muted", text: "Your receipt is on its way in a separate email." },
        ],
      };
    case "payment_due": {
      const grace = formatDate(graceEnd(sub));
      return {
        subject: `Action needed: payment for ${name}`,
        notice: `We couldn't collect your membership payment. Your access continues until ${grace}.`,
        heading: "We couldn't collect your payment",
        blocks: [
          { type: "paragraph", text: `The renewal of ${name} hasn't been paid yet. Your courses stay open until ${grace} so you have time to sort it out.` },
          { type: "callout", tone: "warning", text: "Update your payment method or pay the renewal from your membership page to keep learning without interruption." },
          manage,
        ],
      };
    }
    case "ended":
      return {
        subject: `Your ${name} membership has ended`,
        notice: "Your membership has ended. Your progress is saved if you rejoin.",
        heading: "Your membership has ended",
        blocks: [
          { type: "paragraph", text: `Your access through ${name} has ended. Your progress, notes and certificates are saved, so you can pick up where you left off whenever you rejoin.` },
          { type: "button", label: "See membership plans", url: "/pricing" },
        ],
      };
    case "expired":
      return {
        subject: `Your ${name} membership has expired`,
        notice: "Your membership expired because the renewal wasn't paid. Your progress is saved.",
        heading: "Your membership has expired",
        blocks: [
          { type: "paragraph", text: `We didn't receive the renewal payment for ${name}, so your membership has expired and its courses are locked again. Your progress is saved.` },
          { type: "button", label: "Rejoin", url: "/pricing" },
        ],
      };
    case "cancel_scheduled":
      return {
        subject: `Your ${name} membership will end on ${until}`,
        notice: `Cancelled. You keep access until ${until}.`,
        heading: "Your cancellation is confirmed",
        blocks: [
          { type: "paragraph", text: `You won't be charged again. You keep full access until ${until}, and you can change your mind any time before then.` },
          manage,
        ],
      };
    case "resumed":
      return {
        subject: `Your ${name} membership will continue`,
        notice: `Your membership will renew on ${until}.`,
        heading: "Welcome back",
        blocks: [{ type: "paragraph", text: `Your membership is no longer set to end. It renews on ${until} at ${price(plan)}.` }, manage],
      };
    case "plan_changed":
      return {
        subject: `You're now on ${name}`,
        notice: `Your membership changed${extra.previousPlanName ? ` from ${extra.previousPlanName}` : ""} to ${name}.`,
        heading: "Your plan has changed",
        blocks: [
          { type: "paragraph", text: `Your membership is now ${name} (${price(plan)}). ${access} ${access ? "are included." : ""}`.trim() },
          { type: "muted", text: sub.gateway === "stripe" ? "Any difference in price is prorated on your next invoice." : "The new price applies from your next renewal." },
          manage,
        ],
      };
    case "plan_change_scheduled": {
      const next = ctx.pendingPlan;
      const nextName = next?.name ?? "your new plan";
      return {
        subject: `Your plan changes to ${nextName} at your next renewal`,
        notice: `${nextName} starts when your membership renews. Until then you keep ${name}.`,
        heading: "Your plan change is scheduled",
        blocks: [
          {
            type: "paragraph",
            text: `Your membership moves from ${name} to ${nextName}${next ? ` (${price(next)})` : ""} when it renews${sub.status === "trialing" ? " after your first paid period" : ` on ${until}`}. Until then you keep ${name} and its courses.`,
          },
          manage,
        ],
      };
    }
    case "renewal_due": {
      const order = extra.order;
      return {
        subject: `Your ${name} membership renews on ${until}`,
        notice: order ? `Renewal ${order.orderId} (${formatPrice(order.amount, order.currency)}) is ready to pay.` : `Your membership renews on ${until}.`,
        heading: "Time to renew",
        optional: true,
        blocks: [
          { type: "paragraph", text: `Your current membership period ends on ${until}. Pay the renewal to keep learning without a break.` },
          ...(order
            ? ([
                { type: "details", rows: [{ label: "Order", value: order.orderId }, { label: "Amount", value: formatPrice(order.amount, order.currency) }] },
                { type: "button", label: "Pay renewal", url: `/billing/success/${encodeURIComponent(order.orderId)}` },
              ] as EmailBlock[])
            : [manage]),
        ],
      };
    }
    case "trial_ending":
      return {
        subject: `Your free trial of ${name} ends on ${until}`,
        notice: `Your trial ends on ${until}. After that you'll be charged ${price(plan)}.`,
        heading: "Your trial ends soon",
        optional: true,
        blocks: [
          { type: "paragraph", text: `Your free trial ends on ${until}. Your membership then continues at ${price(plan)} unless you cancel before that date.` },
          manage,
        ],
      };
  }
  // Exhaustive switch: every message kind returns above.
  return { subject: brand.name, notice: "", heading: brand.name, blocks: [] };
}

function render(ctx: Context, copy: Copy): RenderedEmail {
  const footer = copy.optional
    ? {
        reason: `You're receiving this because you have payment emails turned on at ${ctx.brand.name}.`,
        preferencesUrl: preferencesUrl(),
        unsubscribeUrl: unsubscribeUrl(ctx.user.id, "payments"),
        unsubscribeLabel: "Unsubscribe from payment reminders",
      }
    : { reason: `You received this email because you have a membership at ${ctx.brand.name}.`, preferencesUrl: preferencesUrl() };
  return renderEmail(ctx.brand, copy.subject, {
    preheader: copy.notice,
    eyebrow: "Membership",
    heading: copy.heading,
    greeting: `Hi ${ctx.user.name.split(/\s+/)[0] || "there"},`,
    blocks: copy.blocks,
    signoff: ["Happy learning,", `The ${ctx.brand.name} team`],
    footer,
  });
}

/**
 * Tell a member about their membership: an in-app notice (deduplicated by
 * `dedupeKey`) and, unless system notices are already emailed, an email.
 * Never throws: messaging must not undo the change it reports.
 */
export async function sendMembershipMessage(
  subscriptionId: string,
  kind: MembershipMessage,
  opts: { dedupeKey?: string; order?: Payment; previousPlanName?: string } = {},
): Promise<void> {
  try {
    const ctx = await context(subscriptionId, opts.dedupeKey);
    if (!ctx || ctx.alreadySent) return;
    const copy = copyFor(kind, ctx, opts);
    await notify(ctx.user.id, {
      type: "system",
      subject: copy.subject,
      message: copy.notice,
      link: kind === "renewal_due" && opts.order ? `/billing/success/${encodeURIComponent(opts.order.orderId)}` : SUBSCRIPTION_PAGE,
      dedupeKey: opts.dedupeKey,
      email: false,
    });
    if (!ctx.emailEnabled || !ctx.user.enabled || !isSafeAddress(ctx.user.email)) return;
    if (copy.optional && !resolveEmailPreferences(ctx.user).payments) return;
    const rendered = render(ctx, copy);
    await enqueueEmail({ to: ctx.user.email, toName: ctx.user.name, userId: ctx.user.id, subject: rendered.subject, html: rendered.html, text: rendered.text, category: "payment" });
  } catch (error) {
    console.error("[memberships] could not send a membership message:", error instanceof Error ? error.message : String(error));
  }
}
