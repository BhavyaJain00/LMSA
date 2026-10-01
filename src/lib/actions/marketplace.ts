"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, User } from "@/lib/types";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { mutate } from "@/lib/db/store";
import { audit } from "@/lib/audit";
import { fd, fdBool, isValidEmail } from "@/lib/utils";
import { cleanIdList, PAYOUT_METHODS } from "@/lib/growth/affiliates-shared";
import { MARKETPLACE_LIMITS, parseSharePercent, validateApplication } from "@/lib/teaching/marketplace-shared";
import { recordInstructorPayouts, reviewInstructorApplication, setOwnPayoutEmail, submitInstructorApplication, updateInstructorTerms } from "@/lib/teaching/marketplace";

/**
 * Instructor marketplace actions (teaching tools): members apply and keep
 * their payout email at /teach; administrators review applications, set
 * revenue shares, record payouts and configure the marketplace at
 * /admin/marketplace. Every action re-checks the caller.
 */

const MAX_BULK = 200;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

function revalidateMarketplace(profileId?: string) {
  revalidatePath("/admin/marketplace");
  if (profileId) revalidatePath(`/admin/marketplace/${profileId}`);
  revalidatePath("/teach");
  revalidatePath("/teach/earnings");
}

async function requireAdmin(): Promise<User | null> {
  const user = await getCurrentUser();
  return user && isAdmin(user) ? user : null;
}

/* ------------------------------------------------------------------ */
/* Members                                                             */
/* ------------------------------------------------------------------ */

export async function applyToTeachAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to apply to teach." };
  const checked = validateApplication({
    bio: fd(formData, "bio"),
    expertise: fd(formData, "expertise"),
    sampleUrl: fd(formData, "sampleUrl"),
    sample: fd(formData, "sample"),
    payoutEmail: fd(formData, "payoutEmail"),
  });
  const errors: Record<string, string> = checked.ok ? {} : { ...checked.errors };
  if (!fdBool(formData, "agree")) errors.agree = "Please accept the instructor terms to continue.";
  if (!checked.ok || Object.keys(errors).length) return { ok: false, error: Object.values(errors)[0] ?? "Check the highlighted fields.", fieldErrors: errors };

  const result = await submitInstructorApplication(user, checked.application, checked.payoutEmail);
  if (!result.ok) return { ok: false, error: result.error };
  await audit(user, "marketplace.apply", { type: "instructor", id: result.profile.id }, { kind: result.created ? "new" : result.resubmitted ? "resubmitted" : "edited" });
  revalidateMarketplace(result.profile.id);
  return {
    ok: true,
    data: undefined,
    message: result.created || result.resubmitted ? "Application sent. We'll let you know once it has been reviewed." : "Application updated",
  };
}

export async function updateTeachPayoutEmailAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to update your payout details." };
  const payoutEmail = fd(formData, "payoutEmail").toLowerCase();
  if (!payoutEmail || payoutEmail.length > MARKETPLACE_LIMITS.emailMax || !isValidEmail(payoutEmail)) {
    return { ok: false, error: "Enter a valid email address.", fieldErrors: { payoutEmail: "Enter a valid email address." } };
  }
  const profile = await setOwnPayoutEmail(user.id, payoutEmail);
  if (!profile) return { ok: false, error: "Apply to teach first." };
  await audit(user, "marketplace.payout_email", { type: "instructor", id: profile.id });
  revalidateMarketplace(profile.id);
  return { ok: true, data: undefined, message: "Payout email saved" };
}

/* ------------------------------------------------------------------ */
/* Administrators                                                      */
/* ------------------------------------------------------------------ */

export async function approveInstructorAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: "Only administrators can review instructors." };
  const id = fd(formData, "id");
  const share = parseSharePercent(fd(formData, "sharePercent"));
  if (share === null) return { ok: false, error: "Enter a revenue share between 0 and 100.", fieldErrors: { sharePercent: "Enter a percentage between 0 and 100." } };
  const result = await reviewInstructorApplication(admin.id, id, { decision: "approve", sharePercent: share });
  if (!result.ok) return { ok: false, error: result.error };
  await audit(admin, "marketplace.approve", { type: "instructor", id }, { user: result.userName, share, from: result.previous, roleGranted: result.roleGranted });
  if (result.roleGranted) await audit(admin, "user.roles", { type: "user", id: result.profile.userId }, { added: "course_creator", reason: "instructor approved" });
  revalidateMarketplace(id);
  return { ok: true, data: undefined, message: `${result.userName} is approved at ${share}%` };
}

export async function rejectInstructorAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: "Only administrators can review instructors." };
  const id = fd(formData, "id");
  const reason = fd(formData, "reason").trim();
  if (reason.length < 10 || reason.length > MARKETPLACE_LIMITS.reasonMax) {
    const message = reason.length < 10 ? "Give the applicant a short reason (at least 10 characters)." : `Keep the reason under ${MARKETPLACE_LIMITS.reasonMax} characters.`;
    return { ok: false, error: message, fieldErrors: { reason: message } };
  }
  const result = await reviewInstructorApplication(admin.id, id, { decision: "reject", reason });
  if (!result.ok) return { ok: false, error: result.error };
  await audit(admin, "marketplace.reject", { type: "instructor", id }, { user: result.userName, from: result.previous });
  revalidateMarketplace(id);
  return { ok: true, data: undefined, message: result.previous === "approved" ? `${result.userName} was suspended` : `Application from ${result.userName} declined` };
}

export async function updateInstructorTermsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: "Only administrators can manage instructors." };
  const id = fd(formData, "id");
  const share = parseSharePercent(fd(formData, "sharePercent"));
  const payoutEmail = fd(formData, "payoutEmail").toLowerCase();
  const errors: Record<string, string> = {};
  if (share === null) errors.sharePercent = "Enter a percentage between 0 and 100.";
  if (payoutEmail && (payoutEmail.length > MARKETPLACE_LIMITS.emailMax || !isValidEmail(payoutEmail))) errors.payoutEmail = "Enter a valid email address.";
  if (share === null || Object.keys(errors).length) return { ok: false, error: Object.values(errors)[0], fieldErrors: errors };
  const result = await updateInstructorTerms(id, { sharePercent: share, payoutEmail: payoutEmail || undefined });
  if (!result.ok) return { ok: false, error: result.error };
  await audit(admin, "marketplace.terms", { type: "instructor", id }, { shareFrom: result.before.revenueSharePercent, shareTo: share, payoutEmailChanged: result.before.payoutEmail !== result.profile.payoutEmail });
  revalidateMarketplace(id);
  return { ok: true, data: undefined, message: "Instructor terms saved. New sales use the new share." };
}

/**
 * Record payouts for one or more instructors in one currency. `instructorIds`
 * (user ids) arrive as repeated form fields so the same action serves the
 * single and the bulk dialog.
 */
export async function recordInstructorPayoutAction(_prev: ActionResult<{ paid: number }> | null, formData: FormData): Promise<ActionResult<{ paid: number }>> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: "Only administrators can record payouts." };
  const ids = cleanIdList(formData.getAll("instructorId"), MAX_BULK);
  const currency = fd(formData, "currency").toUpperCase();
  const method = fd(formData, "method");
  const reference = fd(formData, "reference").trim();
  const through = fd(formData, "through");
  const errors: Record<string, string> = {};
  if (!ids) errors.instructorId = "Choose at least one instructor.";
  if (!/^[A-Z]{3}$/.test(currency)) errors.currency = "Choose a currency.";
  if (!PAYOUT_METHODS.some((m) => m.value === method)) errors.method = "Choose how the payout was sent.";
  if (reference.length > MARKETPLACE_LIMITS.referenceMax) errors.reference = `Keep the reference under ${MARKETPLACE_LIMITS.referenceMax} characters.`;
  if (through && !DAY_KEY.test(through)) errors.through = "Enter a valid date.";
  if (!ids || Object.keys(errors).length) return { ok: false, error: Object.values(errors)[0] ?? "Check the highlighted fields.", fieldErrors: errors };

  const outcome = await recordInstructorPayouts(admin.id, { instructorIds: ids, currency, method, reference: reference || undefined, through: through || undefined });
  if (!outcome.payouts.length) return { ok: false, error: `There is no unpaid ${currency} balance to pay${through ? ` for sales up to ${through}` : ""}.` };
  for (const p of outcome.payouts) {
    await audit(admin, "marketplace.payout", { type: "payout", id: p.id }, { instructor: p.instructorId ?? "", amount: p.amount, currency: p.currency, method: p.method });
  }
  revalidateMarketplace();
  const skipped = outcome.skipped.length ? ` ${outcome.skipped.length} skipped with nothing to pay.` : "";
  return {
    ok: true,
    data: { paid: outcome.payouts.length },
    message: `${outcome.payouts.length} ${outcome.payouts.length === 1 ? "payout" : "payouts"} recorded.${skipped}`,
  };
}

export async function saveMarketplaceSettingsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: "Only administrators can change marketplace settings." };
  const share = parseSharePercent(fd(formData, "defaultRevenueSharePercent"));
  if (share === null) return { ok: false, error: "Enter a percentage between 0 and 100.", fieldErrors: { defaultRevenueSharePercent: "Enter a percentage between 0 and 100." } };
  const next = { enabled: fdBool(formData, "enabled"), allowApplications: fdBool(formData, "allowApplications"), defaultRevenueSharePercent: share };
  const before = await mutate((d) => {
    const prev = { ...d.settings.marketplace };
    d.settings.marketplace = { ...d.settings.marketplace, ...next };
    return prev;
  });
  await audit(admin, "marketplace.settings", { type: "settings", id: "marketplace" }, { enabled: next.enabled, allowApplications: next.allowApplications, share, wasEnabled: before.enabled });
  revalidatePath("/", "layout");
  return { ok: true, data: undefined, message: "Marketplace settings saved" };
}
