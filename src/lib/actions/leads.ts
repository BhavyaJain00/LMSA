"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/types";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { getRequestInfo } from "@/lib/auth/request-info";
import { SlidingWindowRateLimiter, perIpLimit } from "@/lib/auth/rate-limit";
import { getDb, mutate } from "@/lib/db/store";
import { audit } from "@/lib/audit";
import { captureLead, confirmLead, getLead, renderConfirmationEmail, unsubscribeLead } from "@/lib/seo/lead-capture";
import { checkConfirmLink, checkUnsubscribeLink } from "@/lib/seo/lead-tokens";
import { leadStatus, looksAutomated } from "@/lib/seo/leads";
import { enqueueEmail } from "@/lib/email";
import { fd, fdBool, isValidEmail } from "@/lib/utils";

/**
 * Lead capture Server Actions (round 3).
 *
 * The public form is open to everyone, so it is defended in layers: a hidden
 * honeypot field and a minimum fill time (bots get a normal-looking "check
 * your inbox" answer and nothing is stored), a per-IP limit and a per-address
 * limit (nobody can flood a stranger's inbox with confirmation emails), and
 * double opt-in through a signed link before anything else is sent.
 */

const g = globalThis as unknown as { __llLeadLimiter?: SlidingWindowRateLimiter };
const limiter: SlidingWindowRateLimiter = (g.__llLeadLimiter ??= new SlidingWindowRateLimiter({ maxKeys: 50_000 }));
const PER_IP = { limit: 6, windowMs: 10 * 60 * 1000 };
const SHARED = { limit: 300, windowMs: 10 * 60 * 1000 };
const PER_EMAIL = { limit: 3, windowMs: 60 * 60 * 1000 };
const ADMIN_ONLY = "Only administrators can manage leads.";
const MAX_BULK = 500;

export type LeadSubmitStatus = "confirmation_sent" | "already_confirmed";

/** Public lead form: `email`, `name`, `consent`, `source`, `courseId`, honeypot `website`, `renderedAt` (ms). */
export async function submitLeadAction(_prev: ActionResult<{ status: LeadSubmitStatus }> | null, formData: FormData): Promise<ActionResult<{ status: LeadSubmitStatus }>> {
  const email = fd(formData, "email").toLowerCase();
  const name = fd(formData, "name").slice(0, 120);
  const consent = fdBool(formData, "consent");

  // Bots: same answer as a real sign-up, nothing stored or sent.
  if (looksAutomated(fd(formData, "website"), Number(fd(formData, "renderedAt")))) return { ok: true, data: { status: "confirmation_sent" } };

  const fieldErrors: Record<string, string> = {};
  if (!isValidEmail(email) || email.length > 254) fieldErrors.email = "Please enter a valid email address.";
  if (!consent) fieldErrors.consent = "Please tick the box to agree to receive emails from us.";
  if (Object.keys(fieldErrors).length) return { ok: false, error: Object.values(fieldErrors)[0]!, fieldErrors };

  const info = await getRequestInfo();
  const bucket = perIpLimit("lead", info.ip, PER_IP, SHARED);
  if (!limiter.hit(bucket.key, bucket.rule).ok) return { ok: false, error: "Too many sign-ups from your network. Please try again in a few minutes." };
  // Per address: silently skip extra emails so the form can't be used to bombard someone's inbox.
  if (!limiter.hit(`lead-email:${email}`, PER_EMAIL).ok) return { ok: true, data: { status: "confirmation_sent" } };

  const result = await captureLead({ email, name: name || undefined, source: fd(formData, "source"), courseId: fd(formData, "courseId") || undefined, consent });
  if (!result.ok) return { ok: false, error: result.error, fieldErrors: { email: result.error } };
  revalidatePath("/admin/leads");
  return { ok: true, data: { status: result.status } };
}

/** Confirmation button of /free/confirm (`l` lead id, `e` expiry, `t` token from the emailed link). */
export async function confirmLeadAction(formData: FormData): Promise<ActionResult<{ courseSlug?: string; courseTitle?: string }>> {
  const lead = await getLead(fd(formData, "l"));
  const check = checkConfirmLink(lead, fd(formData, "e"), fd(formData, "t"));
  if (check === "expired") return { ok: false, error: "This confirmation link has expired. Sign up again to get a new one." };
  if (check !== "ok" || !lead) return { ok: false, error: "This confirmation link is not valid. Copy the whole link from the email, or sign up again." };
  const result = await confirmLead(lead.id);
  if (!result) return { ok: false, error: "This sign-up no longer exists. Please sign up again." };
  revalidatePath("/admin/leads");
  return {
    ok: true,
    data: result.course ? { courseSlug: result.course.slug, courseTitle: result.course.title } : {},
    message: result.firstTime ? "Your email is confirmed" : "Your email was already confirmed",
  };
}

/** Unsubscribe button of /free/unsubscribe (`l` lead id, `t` token). */
export async function unsubscribeLeadAction(formData: FormData): Promise<ActionResult> {
  const lead = await getLead(fd(formData, "l"));
  if (!checkUnsubscribeLink(lead, fd(formData, "t")) || !lead) return { ok: false, error: "This unsubscribe link is not valid. Use the link from the most recent email." };
  await unsubscribeLead(lead.id);
  revalidatePath("/admin/leads");
  return { ok: true, data: undefined, message: "You're unsubscribed" };
}

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

async function requireAdmin() {
  const user = await getCurrentUser();
  return user && isAdmin(user) ? user : null;
}

/** Permanently delete leads (personal data). */
export async function deleteLeadsAction(ids: string[]): Promise<ActionResult<{ deleted: number }>> {
  const user = await requireAdmin();
  if (!user) return { ok: false, error: ADMIN_ONLY };
  const wanted = new Set((Array.isArray(ids) ? ids : []).filter((id): id is string => typeof id === "string").slice(0, MAX_BULK));
  if (!wanted.size) return { ok: false, error: "Select at least one lead." };
  const deleted = await mutate((db) => {
    const before = db.leads.length;
    db.leads = db.leads.filter((l) => !wanted.has(l.id));
    db.sequenceEnrollments = db.sequenceEnrollments.filter((e) => !e.leadId || !wanted.has(e.leadId));
    return before - db.leads.length;
  });
  await audit(user, "leads.delete", undefined, { count: deleted });
  revalidatePath("/admin/leads");
  return { ok: true, data: { deleted }, message: deleted === 1 ? "Lead deleted" : `${deleted} leads deleted` };
}

/** Send the confirmation email again to leads that have not confirmed (max once per address per hour). */
export async function resendLeadConfirmationsAction(ids: string[]): Promise<ActionResult<{ sent: number }>> {
  const user = await requireAdmin();
  if (!user) return { ok: false, error: ADMIN_ONLY };
  const wanted = new Set((Array.isArray(ids) ? ids : []).filter((id): id is string => typeof id === "string").slice(0, MAX_BULK));
  const db = await getDb();
  const pending = db.leads.filter((l) => wanted.has(l.id) && leadStatus(l) === "pending");
  let sent = 0;
  for (const lead of pending) {
    if (!limiter.hit(`lead-email:${lead.email}`, PER_EMAIL).ok) continue;
    const course = lead.courseId ? (db.courses.find((c) => c.id === lead.courseId) ?? null) : null;
    const email = await renderConfirmationEmail(lead, course);
    await enqueueEmail({ to: lead.email, toName: lead.name, subject: email.subject, html: email.html, text: email.text, category: "other" });
    sent++;
  }
  await audit(user, "leads.resend_confirmation", undefined, { requested: wanted.size, sent });
  if (!pending.length) return { ok: false, error: "Only leads waiting for confirmation can be sent the email again." };
  return { ok: true, data: { sent }, message: sent === pending.length ? `Confirmation email sent to ${sent} ${sent === 1 ? "lead" : "leads"}` : `Sent ${sent} of ${pending.length}; the others were emailed in the last hour.` };
}
