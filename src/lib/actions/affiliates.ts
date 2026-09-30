"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, Affiliate, User } from "@/lib/types";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { mutate } from "@/lib/db/store";
import { audit } from "@/lib/audit";
import { notify, notifyMany } from "@/lib/services/notifications";
import { fd, fdBool, formatPrice, isValidEmail } from "@/lib/utils";
import { AFFILIATE_STATUSES, clampCookieDays, clampPercent, cleanIdList, MAX_COOKIE_DAYS, normalizeCode, PAYOUT_METHODS } from "@/lib/growth/affiliates-shared";
import { applyForAffiliate, approveCommissions, recordAffiliatePayout, voidCommissions } from "@/lib/growth/affiliates";

/**
 * Affiliate programme actions (growth area): members join and manage their
 * payout email at /affiliate; administrators review affiliates, approve or
 * void commissions, record payouts and configure the programme at
 * /admin/affiliates. Every action re-checks the caller.
 */

const MAX_BULK = 500;

function revalidateAffiliates(affiliateId?: string) {
  revalidatePath("/admin/affiliates");
  if (affiliateId) revalidatePath(`/admin/affiliates/${affiliateId}`);
  revalidatePath("/affiliate");
}

async function requireAdmin(): Promise<User | null> {
  const user = await getCurrentUser();
  return user && isAdmin(user) ? user : null;
}

/* ------------------------------------------------------------------ */
/* Members                                                             */
/* ------------------------------------------------------------------ */

export async function applyAffiliateAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to join the affiliate program." };
  const payoutEmail = fd(formData, "payoutEmail").toLowerCase();
  const errors: Record<string, string> = {};
  if (payoutEmail && (payoutEmail.length > 200 || !isValidEmail(payoutEmail))) errors.payoutEmail = "Enter a valid email address, or leave it empty.";
  if (!fdBool(formData, "agree")) errors.agree = "Please accept the program rules to continue.";
  if (Object.keys(errors).length) return { ok: false, error: Object.values(errors)[0], fieldErrors: errors };

  const result = await applyForAffiliate(user, payoutEmail || undefined);
  if (!result.ok) return { ok: false, error: result.error };
  if (result.created) await audit(user, "affiliate.apply", { type: "affiliate", id: result.affiliate.id }, { status: result.affiliate.status });
  revalidateAffiliates(result.affiliate.id);
  return {
    ok: true,
    data: undefined,
    message:
      result.affiliate.status === "active"
        ? `You're in! Your referral code is ${result.affiliate.code}.`
        : "Thanks for applying. We'll let you know as soon as your account is reviewed.",
  };
}

export async function updatePayoutEmailAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to update your payout details." };
  const payoutEmail = fd(formData, "payoutEmail").toLowerCase();
  if (payoutEmail && (payoutEmail.length > 200 || !isValidEmail(payoutEmail))) {
    return { ok: false, error: "Enter a valid email address.", fieldErrors: { payoutEmail: "Enter a valid email address." } };
  }
  const id = await mutate((d) => {
    const affiliate = d.affiliates.find((a) => a.userId === user.id);
    if (!affiliate) return null;
    affiliate.payoutEmail = payoutEmail || undefined;
    return affiliate.id;
  });
  if (!id) return { ok: false, error: "Join the affiliate program first." };
  await audit(user, "affiliate.payout_email", { type: "affiliate", id });
  revalidateAffiliates(id);
  return { ok: true, data: undefined, message: payoutEmail ? "Payout email saved" : "Payout email removed. We'll use your account email." };
}

/* ------------------------------------------------------------------ */
/* Administrators                                                      */
/* ------------------------------------------------------------------ */

const STATUS_MESSAGES: Record<Affiliate["status"], { subject: string; message: string }> = {
  active: { subject: "Your affiliate account is active", message: "Share your referral links to start earning commissions." },
  paused: { subject: "Your affiliate account was paused", message: "New referrals don't earn commissions for now. Contact us if you have questions." },
  pending: { subject: "Your affiliate account is under review", message: "We'll let you know once it has been reviewed." },
};

/** Approve, pause or reactivate an affiliate. */
export async function setAffiliateStatusAction(affiliateId: string, status: Affiliate["status"]): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: "Only administrators can manage affiliates." };
  if (typeof affiliateId !== "string" || !(AFFILIATE_STATUSES as readonly string[]).includes(status)) return { ok: false, error: "Invalid request." };
  const change = await mutate((d) => {
    const affiliate = d.affiliates.find((a) => a.id === affiliateId);
    if (!affiliate) return null;
    const previous = affiliate.status;
    affiliate.status = status;
    return { previous, userId: affiliate.userId, code: affiliate.code };
  });
  if (!change) return { ok: false, error: "This affiliate no longer exists." };
  if (change.previous !== status) {
    await audit(admin, "affiliate.status", { type: "affiliate", id: affiliateId }, { from: change.previous, to: status });
    await notify(change.userId, { type: "system", ...STATUS_MESSAGES[status], link: "/affiliate", fromUserId: admin.id });
  }
  revalidateAffiliates(affiliateId);
  const label = status === "active" ? (change.previous === "pending" ? "approved" : "reactivated") : status === "paused" ? "paused" : "moved back to review";
  return { ok: true, data: undefined, message: `Affiliate ${change.code} ${label}` };
}

/** Edit an affiliate's code, commission rate, payout email and status. */
export async function updateAffiliateAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: "Only administrators can manage affiliates." };
  const id = fd(formData, "id");
  const rawCode = fd(formData, "code");
  const code = normalizeCode(rawCode);
  const percentRaw = fd(formData, "commissionPercent");
  const percent = Number(percentRaw);
  const payoutEmail = fd(formData, "payoutEmail").toLowerCase();
  const status = fd(formData, "status");

  const errors: Record<string, string> = {};
  if (!code) errors.code = "Use 3–32 letters, digits, dashes or underscores.";
  if (percentRaw === "" || !Number.isFinite(percent) || percent < 0 || percent > 100) errors.commissionPercent = "Enter a percentage between 0 and 100.";
  if (payoutEmail && (payoutEmail.length > 200 || !isValidEmail(payoutEmail))) errors.payoutEmail = "Enter a valid email address.";
  if (!(AFFILIATE_STATUSES as readonly string[]).includes(status)) errors.status = "Choose a status.";
  if (Object.keys(errors).length || !code) return { ok: false, error: Object.values(errors)[0] ?? "Check the highlighted fields.", fieldErrors: errors };

  const result = await mutate((d) => {
    const affiliate = d.affiliates.find((a) => a.id === id);
    if (!affiliate) return { error: "This affiliate no longer exists." } as const;
    if (d.affiliates.some((a) => a.id !== id && a.code.toUpperCase() === code)) return { error: "Another affiliate already uses this code.", field: "code" } as const;
    const before = { code: affiliate.code, commissionPercent: affiliate.commissionPercent, status: affiliate.status };
    affiliate.code = code;
    affiliate.commissionPercent = clampPercent(percent);
    affiliate.payoutEmail = payoutEmail || undefined;
    affiliate.status = status as Affiliate["status"];
    return { before, after: { code: affiliate.code, commissionPercent: affiliate.commissionPercent, status: affiliate.status }, userId: affiliate.userId } as const;
  });
  if ("error" in result) {
    return { ok: false, error: result.error ?? "Could not save.", fieldErrors: "field" in result && result.field ? { [result.field]: result.error } : undefined };
  }
  await audit(admin, "affiliate.update", { type: "affiliate", id }, {
    code: result.after.code,
    commissionPercent: result.after.commissionPercent,
    status: result.after.status,
    previousCode: result.before.code,
    previousPercent: result.before.commissionPercent,
  });
  if (result.before.status !== result.after.status) {
    await notify(result.userId, { type: "system", ...STATUS_MESSAGES[result.after.status], link: "/affiliate", fromUserId: admin.id });
  }
  if (result.before.commissionPercent !== result.after.commissionPercent) {
    await notify(result.userId, {
      type: "system",
      subject: `Your commission rate is now ${result.after.commissionPercent}%`,
      message: "It applies to sales from now on; earlier commissions keep their amounts.",
      link: "/affiliate",
      fromUserId: admin.id,
    });
  }
  revalidateAffiliates(id);
  return {
    ok: true,
    data: undefined,
    message: result.before.code !== result.after.code ? `Saved. Links with the old code ${result.before.code} no longer credit this affiliate.` : "Affiliate saved",
  };
}

export async function approveCommissionsAction(ids: string[]): Promise<ActionResult<{ approved: number }>> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: "Only administrators can approve commissions." };
  const clean = cleanIdList(ids, MAX_BULK);
  if (!clean) return { ok: false, error: `Select between 1 and ${MAX_BULK} commissions.` };
  const { approved, affiliateUserIds } = await approveCommissions(clean);
  if (!approved) return { ok: false, error: "None of the selected commissions are waiting for approval." };
  await audit(admin, "affiliate.commissions_approve", undefined, { count: approved });
  await notifyMany(affiliateUserIds, {
    type: "system",
    subject: "Commissions approved",
    message: "Approved commissions are included in your next payout.",
    link: "/affiliate",
    fromUserId: admin.id,
  });
  revalidateAffiliates();
  return { ok: true, data: { approved }, message: `${approved} ${approved === 1 ? "commission" : "commissions"} approved` };
}

export async function voidCommissionsAction(ids: string[]): Promise<ActionResult<{ voided: number }>> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: "Only administrators can void commissions." };
  const clean = cleanIdList(ids, MAX_BULK);
  if (!clean) return { ok: false, error: `Select between 1 and ${MAX_BULK} commissions.` };
  const { voided, skippedPaid } = await voidCommissions(clean);
  if (!voided) return { ok: false, error: skippedPaid ? "Paid commissions can't be voided." : "The selected commissions are already void." };
  await audit(admin, "affiliate.commissions_void", undefined, { count: voided, skippedPaid });
  revalidateAffiliates();
  const note = skippedPaid ? ` ${skippedPaid} paid ${skippedPaid === 1 ? "commission was" : "commissions were"} left unchanged.` : "";
  return { ok: true, data: { voided }, message: `${voided} ${voided === 1 ? "commission" : "commissions"} voided.${note}` };
}

export async function recordPayoutAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: "Only administrators can record payouts." };
  const affiliateId = fd(formData, "affiliateId");
  const currency = fd(formData, "currency").toUpperCase();
  const method = fd(formData, "method");
  const reference = fd(formData, "reference");
  const errors: Record<string, string> = {};
  if (!/^[A-Z]{3}$/.test(currency)) errors.currency = "Choose a currency.";
  if (!PAYOUT_METHODS.some((m) => m.value === method)) errors.method = "Choose how you paid.";
  if (reference.length > 120) errors.reference = "Keep the reference under 120 characters.";
  if (Object.keys(errors).length) return { ok: false, error: Object.values(errors)[0], fieldErrors: errors };

  const result = await recordAffiliatePayout({ affiliateId, currency, method, reference });
  if (!result.ok) return { ok: false, error: result.error };
  await audit(admin, "affiliate.payout", { type: "affiliate", id: affiliateId }, { amount: result.payout.amount, currency, method, commissions: result.count });
  revalidateAffiliates(affiliateId);
  return { ok: true, data: undefined, message: `Payout of ${formatPrice(result.payout.amount, currency)} recorded (${result.count} ${result.count === 1 ? "commission" : "commissions"})` };
}

export async function saveAffiliateSettingsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: "Only administrators can change site settings." };
  if (formData.get("section") !== "affiliates") return { ok: false, error: "This form is out of date. Reload the page and try again." };
  const percentRaw = fd(formData, "defaultCommissionPercent");
  const daysRaw = fd(formData, "cookieDays");
  const percent = Number(percentRaw);
  const days = Number(daysRaw);
  const errors: Record<string, string> = {};
  if (percentRaw === "" || !Number.isFinite(percent) || percent < 0 || percent > 100) errors.defaultCommissionPercent = "Enter a percentage between 0 and 100.";
  if (daysRaw === "" || !Number.isInteger(days) || days < 1 || days > MAX_COOKIE_DAYS) errors.cookieDays = `Enter a whole number of days between 1 and ${MAX_COOKIE_DAYS}.`;
  if (Object.keys(errors).length) return { ok: false, error: Object.values(errors)[0], fieldErrors: errors };

  const next = await mutate((d) => {
    d.settings.growth = {
      ...d.settings.growth,
      affiliatesEnabled: fdBool(formData, "affiliatesEnabled"),
      affiliateAutoApprove: fdBool(formData, "affiliateAutoApprove"),
      defaultCommissionPercent: clampPercent(percent),
      cookieDays: clampCookieDays(days),
    };
    d.settings.updatedAt = new Date().toISOString();
    return d.settings.growth;
  });
  await audit(admin, "settings.update", { type: "settings", id: "growth.affiliates" }, {
    affiliatesEnabled: next.affiliatesEnabled,
    affiliateAutoApprove: next.affiliateAutoApprove,
    defaultCommissionPercent: next.defaultCommissionPercent,
    cookieDays: next.cookieDays,
  });
  // The sidebar shows "Affiliate" only while the program is on.
  revalidatePath("/", "layout");
  return { ok: true, data: undefined, message: next.affiliatesEnabled ? "Affiliate program settings saved" : "Affiliate program turned off. Existing commissions stay payable." };
}

