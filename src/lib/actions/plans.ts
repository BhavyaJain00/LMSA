"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult, MembershipPlan, User } from "@/lib/types";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { getDb, mutate } from "@/lib/db/store";
import { audit } from "@/lib/audit";
import { setFlash } from "@/lib/flash";
import { currencies } from "@/lib/config";
import { fd, fdBool, uid } from "@/lib/utils";
import { lessonHref, getNextLesson } from "@/lib/data/courses";
import { gatewayErrorMessage, isConfigured } from "@/lib/payments/gateway";
import { toGatewayAmount } from "@/lib/payments/amounts";
import { retrieveStripePrice } from "@/lib/payments/stripe";
import { fetchRazorpayPlan } from "@/lib/payments/razorpay";
import { currentSubscription } from "@/lib/commerce/access";
import { validatePlanInput, type PlanDraft } from "@/lib/commerce/plans";
import { isOngoing } from "@/lib/commerce/subscriptions";
import {
  cancelAtPeriodEnd,
  cancelMembershipAtPeriodEndByAdmin,
  cancelMembershipNow,
  changeMembershipPlan,
  extendMembership,
  grantMembershipByAdmin,
  joinCourseWithMembership,
  openRenewalOrder,
  refreshFromGateway,
  resumeMembership,
  type ServiceResult,
} from "@/lib/commerce/membership-service";
import { getSubscription } from "@/lib/commerce/membership-store";

/**
 * Server Actions for memberships: plan management (administrators), the
 * member's own membership (cancel, resume, change plan, renew), opening a
 * course included in a membership, and administrator actions on members'
 * memberships (cancel, extend, grant, refresh from the gateway).
 */

function revalidateMemberships(): void {
  revalidatePath("/pricing");
  revalidatePath("/settings/subscription");
  revalidatePath("/admin/settings/plans");
  revalidatePath("/billing/history");
  // Course access depends on memberships.
  revalidatePath("/", "layout");
}

function toResult(res: ServiceResult): ActionResult {
  return res.ok ? { ok: true, data: undefined, message: res.message } : { ok: false, error: res.error };
}

async function requireAdminActor(): Promise<User | null> {
  const user = await getCurrentUser();
  return user && isAdmin(user) ? user : null;
}

/* ------------------------------------------------------------------ */
/* Plans (administrators)                                              */
/* ------------------------------------------------------------------ */

/** Check that a gateway price entered by hand bills exactly the plan's price and interval. */
async function gatewayPriceProblems(draft: PlanDraft): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};
  const amount = toGatewayAmount(draft.price, draft.currency);
  const { stripe, razorpay } = draft.gatewayPriceIds;
  if (stripe && isConfigured("stripe")) {
    try {
      const price = await retrieveStripePrice(stripe);
      if (price.unitAmount !== amount || price.currency.toUpperCase() !== draft.currency || price.interval !== draft.interval) {
        errors.stripePriceId = "This Stripe price doesn't bill the plan's price, currency and interval.";
      } else if (!price.active) errors.stripePriceId = "This Stripe price is archived.";
    } catch (error) {
      errors.stripePriceId = gatewayErrorMessage(error);
    }
  }
  if (razorpay && isConfigured("razorpay")) {
    try {
      const plan = await fetchRazorpayPlan(razorpay);
      const period = draft.interval === "year" ? "yearly" : "monthly";
      if (plan.amount !== amount || plan.currency.toUpperCase() !== draft.currency || plan.period !== period || plan.interval !== 1) {
        errors.razorpayPlanId = "This Razorpay plan doesn't bill the plan's price, currency and interval.";
      }
    } catch (error) {
      errors.razorpayPlanId = gatewayErrorMessage(error);
    }
  }
  return errors;
}

/** Create or update a membership plan. */
export async function savePlanAction(_prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  const actor = await requireAdminActor();
  if (!actor) return { ok: false, error: "Only administrators can manage membership plans." };
  const id = fd(formData, "id");
  const db = await getDb();
  const existing = id ? db.plans.find((p) => p.id === id) : undefined;
  if (id && !existing) return { ok: false, error: "This plan no longer exists." };

  const parsed = validatePlanInput(
    {
      name: fd(formData, "name"),
      slug: fd(formData, "slug"),
      description: fd(formData, "description"),
      interval: fd(formData, "interval"),
      price: fd(formData, "price"),
      currency: fd(formData, "currency"),
      trialDays: fd(formData, "trialDays"),
      accessType: fd(formData, "accessType"),
      courseIds: formData.getAll("courseIds").map(String),
      features: fd(formData, "features"),
      active: fdBool(formData, "active"),
      stripePriceId: fd(formData, "stripePriceId"),
      razorpayPlanId: fd(formData, "razorpayPlanId"),
    },
    { knownCourseIds: new Set(db.courses.map((c) => c.id)), currencies },
  );
  if (!parsed.ok) return { ok: false, error: Object.values(parsed.errors)[0] ?? "Please fix the errors below.", fieldErrors: parsed.errors };
  const draft = parsed.draft;
  if (db.plans.some((p) => p.slug === draft.slug && p.id !== id)) {
    return { ok: false, error: "Another plan already uses this URL name.", fieldErrors: { slug: "Already used by another plan." } };
  }

  // Gateway prices keep billing their old amount: forget linked ones when the price changes, unless re-entered.
  const billingChanged = !!existing && (existing.price !== draft.price || existing.currency !== draft.currency || existing.interval !== draft.interval);
  const gatewayPriceIds = { ...draft.gatewayPriceIds };
  if (billingChanged) {
    if (gatewayPriceIds.stripe === existing?.gatewayPriceIds?.stripe) delete gatewayPriceIds.stripe;
    if (gatewayPriceIds.razorpay === existing?.gatewayPriceIds?.razorpay) delete gatewayPriceIds.razorpay;
  }
  const entered = { ...draft, gatewayPriceIds: { ...draft.gatewayPriceIds } };
  if (existing?.gatewayPriceIds?.stripe === entered.gatewayPriceIds.stripe) delete entered.gatewayPriceIds.stripe;
  if (existing?.gatewayPriceIds?.razorpay === entered.gatewayPriceIds.razorpay) delete entered.gatewayPriceIds.razorpay;
  const priceErrors = await gatewayPriceProblems(entered);
  if (Object.keys(priceErrors).length) return { ok: false, error: Object.values(priceErrors)[0]!, fieldErrors: priceErrors };

  const nowIso = new Date().toISOString();
  const planId = existing?.id ?? uid("plan");
  await mutate((d) => {
    const fields = {
      slug: draft.slug,
      name: draft.name,
      description: draft.description,
      interval: draft.interval,
      price: draft.price,
      currency: draft.currency,
      trialDays: draft.trialDays,
      access: draft.access,
      active: draft.active,
      features: draft.features,
      gatewayPriceIds: Object.keys(gatewayPriceIds).length ? gatewayPriceIds : undefined,
      updatedAt: nowIso,
    } satisfies Partial<MembershipPlan>;
    const row = d.plans.find((p) => p.id === planId);
    if (row) Object.assign(row, fields);
    else d.plans.push({ id: planId, ...fields, createdAt: nowIso });
  });
  await audit(actor, existing ? "plan.update" : "plan.create", { type: "plan", id: planId }, { name: draft.name, price: draft.price, currency: draft.currency, interval: draft.interval });
  revalidateMemberships();
  return {
    ok: true,
    data: { id: planId },
    message: existing
      ? billingChanged
        ? "Plan saved. New members pay the new price; current members keep their billing until they change plan."
        : "Plan saved."
      : "Plan created.",
  };
}

/** Offer or retire a plan (retired plans keep their members). */
export async function setPlanActiveAction(planId: string, active: boolean): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor) return { ok: false, error: "Only administrators can manage membership plans." };
  const changed = await mutate((d) => {
    const row = d.plans.find((p) => p.id === planId);
    if (!row) return false;
    row.active = active === true;
    row.updatedAt = new Date().toISOString();
    return true;
  });
  if (!changed) return { ok: false, error: "This plan no longer exists." };
  await audit(actor, active ? "plan.activate" : "plan.retire", { type: "plan", id: planId });
  revalidateMemberships();
  return { ok: true, data: undefined, message: active ? "The plan is offered on the pricing page." : "The plan was retired. Current members keep it." };
}

/** Delete a plan nobody ever bought (plans with members or orders can only be retired). */
export async function deletePlanAction(planId: string): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor) return { ok: false, error: "Only administrators can manage membership plans." };
  const res = await mutate((d): "missing" | "in_use" | "deleted" => {
    const row = d.plans.find((p) => p.id === planId);
    if (!row) return "missing";
    const used = d.subscriptions.some((s) => s.planId === planId) || d.payments.some((p) => p.itemType === "plan" && (p.planId ?? p.itemId) === planId);
    if (used) return "in_use";
    d.plans = d.plans.filter((p) => p.id !== planId);
    return "deleted";
  });
  if (res === "missing") return { ok: false, error: "This plan no longer exists." };
  if (res === "in_use") return { ok: false, error: "This plan has members or orders, so it can't be deleted. Retire it instead." };
  await audit(actor, "plan.delete", { type: "plan", id: planId });
  revalidateMemberships();
  return { ok: true, data: undefined, message: "Plan deleted." };
}

/** Turn membership sales on or off (the pricing page, its menu link and new membership checkouts). Running memberships are not affected. */
export async function setMembershipsEnabledAction(enabled: boolean): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor) return { ok: false, error: "Only administrators can change membership settings." };
  const on = enabled === true;
  await mutate((d) => {
    d.settings.growth.subscriptionsEnabled = on;
    d.settings.updatedAt = new Date().toISOString();
  });
  await audit(actor, "settings.update", { type: "settings", id: "growth" }, { subscriptionsEnabled: on });
  revalidateMemberships();
  return {
    ok: true,
    data: undefined,
    message: on ? "Memberships are on sale. The pricing page is live." : "Membership sales are paused. Current members keep their access and billing.",
  };
}

/* ------------------------------------------------------------------ */
/* The member's own membership                                         */
/* ------------------------------------------------------------------ */

async function ownMembership(): Promise<{ user: User; subscriptionId: string } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Please log in again to continue." };
  const db = await getDb();
  const current = currentSubscription(db, user.id);
  if (!current) return { error: "You don't have a membership." };
  return { user, subscriptionId: current.id };
}

async function withOwnMembership(run: (sub: NonNullable<Awaited<ReturnType<typeof getSubscription>>>) => Promise<ServiceResult>): Promise<ActionResult> {
  const own = await ownMembership();
  if ("error" in own) return { ok: false, error: own.error };
  const sub = await getSubscription(own.subscriptionId);
  if (!sub || sub.userId !== own.user.id) return { ok: false, error: "You don't have a membership." };
  const res = await run(sub);
  revalidateMemberships();
  return toResult(res);
}

export async function cancelMyMembershipAction(): Promise<ActionResult> {
  return withOwnMembership((sub) => cancelAtPeriodEnd(sub));
}

export async function resumeMyMembershipAction(): Promise<ActionResult> {
  return withOwnMembership((sub) => resumeMembership(sub));
}

export async function changeMyPlanAction(planId: string): Promise<ActionResult> {
  if (typeof planId !== "string" || !planId) return { ok: false, error: "Choose a plan." };
  const db = await getDb();
  const target = db.plans.find((p) => p.id === planId);
  if (!target) return { ok: false, error: "This plan is no longer offered." };
  return withOwnMembership((sub) => changeMembershipPlan(sub, target));
}

/** "Renew now" for a membership paid by hand: opens (or reuses) the renewal order and goes to it. */
export async function renewMyMembershipAction(): Promise<ActionResult> {
  const own = await ownMembership();
  if ("error" in own) return { ok: false, error: own.error };
  const sub = await getSubscription(own.subscriptionId);
  if (!sub || sub.userId !== own.user.id) return { ok: false, error: "You don't have a membership." };
  if (!isOngoing(sub) || sub.cancelAtPeriodEnd) return { ok: false, error: "This membership doesn't renew. Choose a plan to join again." };
  const order = await openRenewalOrder(sub, { notifyMember: false });
  if (!order) return { ok: false, error: "This membership renews automatically; there is nothing to pay here." };
  revalidateMemberships();
  const fresh = (await getDb()).payments.find((p) => p.id === order.id);
  if (fresh?.status === "paid") await setFlash("Your membership was renewed.", "success");
  redirect(`/billing/success/${encodeURIComponent(order.orderId)}`);
}

/** "Start learning" on a course included in the member's plan. */
export async function joinCourseWithMembershipAction(slug: string): Promise<ActionResult<{ href: string }>> {
  const user = await getCurrentUser();
  if (!user) {
    await setFlash("Please log in to start this course.", "warning");
    redirect(`/login?next=${encodeURIComponent(typeof slug === "string" ? `/courses/${slug}` : "/courses")}`);
  }
  if (typeof slug !== "string" || !slug || slug.length > 200) return { ok: false, error: "Course not found." };
  const db = await getDb();
  const course = db.courses.find((c) => c.slug === slug);
  if (!course) return { ok: false, error: "Course not found." };
  const res = await joinCourseWithMembership(user, course);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(`/courses/${course.slug}`);
  revalidatePath("/dashboard");
  const next = await getNextLesson(course, user);
  return {
    ok: true,
    data: { href: next ? lessonHref(course.slug, next) : `/courses/${course.slug}` },
    message: res.alreadyEnrolled ? "Welcome back!" : "Included in your membership. Enjoy the course!",
  };
}

/* ------------------------------------------------------------------ */
/* Administrators: members' memberships                                */
/* ------------------------------------------------------------------ */

export type MembershipAdminOp = "cancel_now" | "cancel_at_end" | "resume" | "refresh";

export async function adminMembershipAction(subscriptionId: string, op: MembershipAdminOp): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor) return { ok: false, error: "Only administrators can manage memberships." };
  const sub = typeof subscriptionId === "string" ? await getSubscription(subscriptionId) : null;
  if (!sub) return { ok: false, error: "Membership not found." };
  let res: ServiceResult;
  switch (op) {
    case "cancel_now":
      res = await cancelMembershipNow(sub, actor);
      break;
    case "cancel_at_end":
      res = await cancelMembershipAtPeriodEndByAdmin(sub, actor);
      break;
    case "resume":
      res = await resumeMembership(sub);
      if (res.ok) await audit(actor, "membership.resume", { type: "subscription", id: sub.id });
      break;
    case "refresh":
      res = await refreshFromGateway(sub);
      break;
    default:
      return { ok: false, error: "Unknown action." };
  }
  revalidateMemberships();
  return toResult(res);
}

export async function extendMembershipAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor) return { ok: false, error: "Only administrators can manage memberships." };
  const sub = await getSubscription(fd(formData, "subscriptionId"));
  if (!sub) return { ok: false, error: "Membership not found." };
  const raw = fd(formData, "days");
  const days = /^\d{1,4}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(days) || days < 1 || days > 3650) return { ok: false, error: "Enter between 1 and 3650 days.", fieldErrors: { days: "Enter between 1 and 3650 days." } };
  const res = await extendMembership(sub, days, actor);
  revalidateMemberships();
  return toResult(res);
}

/** Extend several memberships at once (goodwill after downtime). Gateway-billed memberships are skipped and counted. */
export async function extendMembershipsAction(subscriptionIds: string[], days: number): Promise<ActionResult<{ extended: number; skipped: number }>> {
  const actor = await requireAdminActor();
  if (!actor) return { ok: false, error: "Only administrators can manage memberships." };
  if (!Array.isArray(subscriptionIds) || subscriptionIds.some((id) => typeof id !== "string")) return { ok: false, error: "Select at least one membership." };
  const ids = [...new Set(subscriptionIds)].slice(0, 200);
  if (!ids.length) return { ok: false, error: "Select at least one membership." };
  if (!Number.isInteger(days) || days < 1 || days > 3650) return { ok: false, error: "Enter between 1 and 3650 days." };
  let extended = 0;
  let skipped = 0;
  for (const id of ids) {
    const sub = await getSubscription(id);
    const res = sub ? await extendMembership(sub, days, actor) : null;
    if (res?.ok) extended++;
    else skipped++;
  }
  revalidateMemberships();
  if (!extended) return { ok: false, error: "None of the selected memberships can be extended here: they are billed by Stripe or Razorpay." };
  const note = skipped ? ` ${skipped} billed by a payment gateway ${skipped === 1 ? "was" : "were"} skipped.` : "";
  return { ok: true, data: { extended, skipped }, message: `Extended ${extended} membership${extended === 1 ? "" : "s"} by ${days} day${days === 1 ? "" : "s"}.${note}` };
}

export async function grantMembershipAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor) return { ok: false, error: "Only administrators can manage memberships." };
  const userId = fd(formData, "userId");
  const planId = fd(formData, "planId");
  const rawDays = fd(formData, "days");
  const errors: Record<string, string> = {};
  if (!userId) errors.userId = "Choose a member.";
  if (!planId) errors.planId = "Choose a plan.";
  const days = rawDays ? (/^\d{1,4}$/.test(rawDays) ? Number(rawDays) : NaN) : undefined;
  if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > 3650)) errors.days = "Enter between 1 and 3650 days, or leave empty for one billing period.";
  if (Object.keys(errors).length) return { ok: false, error: Object.values(errors)[0]!, fieldErrors: errors };
  const res = await grantMembershipByAdmin({ userId, planId, days }, actor);
  revalidateMemberships();
  return toResult(res);
}
