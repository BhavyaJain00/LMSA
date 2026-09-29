"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, EmailMessage, EmailStatus, NotificationType, User } from "@/lib/types";
import { getCurrentUser, isAdmin, isModerator } from "@/lib/auth/session";
import { mutate } from "@/lib/db/store";
import { fd, fdBool, isValidEmail } from "@/lib/utils";
import {
  deleteEmail,
  deliverDueEmails,
  pruneOutbox,
  resendEmail,
  retryAllFailed,
  retryEmail,
  sendTestEmail,
  verifySmtpConnection,
} from "@/lib/email";
import { parseAddress } from "@/lib/email/mime";
import { isNotificationType } from "@/lib/email/preferences";

/**
 * Email administration: Settings → Email (admins) and the outbox
 * (admins and moderators). Every action re-checks the caller's role.
 */

type Errors = Record<string, string>;

const ADMIN_ONLY: ActionResult<never> = { ok: false, error: "Only administrators can change email settings." };
const STAFF_ONLY: ActionResult<never> = { ok: false, error: "Only administrators and moderators can manage the outbox." };

async function adminUser(): Promise<User | null> {
  const user = await getCurrentUser();
  return user && isAdmin(user) ? user : null;
}

async function outboxUser(): Promise<User | null> {
  const user = await getCurrentUser();
  return user && isModerator(user) ? user : null;
}

function revalidateOutbox(id?: string) {
  revalidatePath("/admin/emails");
  if (id) revalidatePath(`/admin/emails/${id}`);
  revalidatePath("/admin/settings/email");
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export async function saveEmailSettingsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  if (!(await adminUser())) return ADMIN_ONLY;
  const enabled = fdBool(formData, "enabled");
  const fromName = fd(formData, "fromName").replace(/\s+/g, " ");
  const replyTo = fd(formData, "replyTo");
  const footerText = fd(formData, "footerText").replace(/\r\n?/g, "\n");
  const rawTypes = formData.getAll("notifyTypes").filter((v): v is string => typeof v === "string");

  const errors: Errors = {};
  if (!fromName) errors.fromName = "Enter the name emails are sent from.";
  else if (fromName.length > 80) errors.fromName = "Keep the sender name under 80 characters.";
  else if (/[<>@"\\]/.test(fromName)) errors.fromName = "The sender name can't contain <, >, @, quotes or backslashes.";
  if (replyTo && (!isValidEmail(replyTo) || !parseAddress(replyTo))) errors.replyTo = "Enter a valid email address, or leave it empty.";
  if (footerText.length > 500) errors.footerText = "Keep the footer under 500 characters.";
  const unknown = rawTypes.filter((t) => !isNotificationType(t));
  if (unknown.length) errors.notifyTypes = "Unknown notification type selected.";
  if (Object.keys(errors).length) return { ok: false, error: Object.values(errors)[0]!, fieldErrors: errors };

  const notifyTypes = Array.from(new Set(rawTypes)) as NotificationType[];
  await mutate((db) => {
    db.settings.email = {
      enabled,
      fromName,
      replyTo: replyTo ? replyTo.toLowerCase() : undefined,
      footerText: footerText || undefined,
      notifyTypes,
    };
    db.settings.updatedAt = new Date().toISOString();
  });
  revalidatePath("/", "layout");
  return { ok: true, data: undefined, message: enabled ? "Email settings saved" : "Email settings saved — notification emails are off" };
}

/* ------------------------------------------------------------------ */
/* Test email & connection check                                       */
/* ------------------------------------------------------------------ */

/** Simple per-process limit so the test form can't be used to spam an address. */
const testSends = new Map<string, number[]>();
const TEST_LIMIT = 10;
const TEST_WINDOW_MS = 10 * 60_000;

function allowTestSend(userId: string): boolean {
  const now = Date.now();
  const recent = (testSends.get(userId) ?? []).filter((t) => now - t < TEST_WINDOW_MS);
  if (recent.length >= TEST_LIMIT) {
    testSends.set(userId, recent);
    return false;
  }
  recent.push(now);
  testSends.set(userId, recent);
  return true;
}

export interface TestEmailResult {
  id: string;
  status: EmailStatus;
  lastError?: string;
}

export async function sendTestEmailAction(_prev: ActionResult<TestEmailResult> | null, formData: FormData): Promise<ActionResult<TestEmailResult>> {
  const user = await outboxUser();
  if (!user) return STAFF_ONLY;
  const to = fd(formData, "to").toLowerCase();
  if (!to || !isValidEmail(to) || !parseAddress(to)) return { ok: false, error: "Enter a valid email address.", fieldErrors: { to: "Enter a valid email address." } };
  if (!allowTestSend(user.id)) return { ok: false, error: "You've sent several test emails in the last few minutes. Please wait a moment." };
  let message: EmailMessage;
  try {
    message = await sendTestEmail(to, user);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The test email could not be sent." };
  }
  revalidateOutbox(message.id);
  const data: TestEmailResult = { id: message.id, status: message.status, lastError: message.lastError };
  if (message.status === "sent") return { ok: true, data, message: `Test email sent to ${to}` };
  if (message.status === "queued") return { ok: true, data, message: `Delivery failed, will retry: ${message.lastError ?? "unknown error"}` };
  return { ok: false, error: message.lastError ? `Delivery failed: ${message.lastError}` : "Delivery failed." };
}

export interface VerifyConnectionResult {
  secure: boolean;
  tlsProtocol: string | null;
  authMechanism: string | null;
  capabilities: string[];
  maxMessageSize: number;
  greeting: string;
}

export async function verifySmtpConnectionAction(): Promise<ActionResult<VerifyConnectionResult>> {
  if (!(await adminUser())) return ADMIN_ONLY;
  try {
    const info = await verifySmtpConnection();
    const bits = [info.secure ? `encrypted (${info.tlsProtocol ?? "TLS"})` : "not encrypted", info.authMechanism ? `signed in with ${info.authMechanism}` : "no authentication"];
    return { ok: true, data: info, message: `Connected: ${bits.join(", ")}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not connect to the SMTP server." };
  }
}

/* ------------------------------------------------------------------ */
/* Outbox                                                              */
/* ------------------------------------------------------------------ */

export interface RunDeliveryResult {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
}

export async function runDeliveryAction(): Promise<ActionResult<RunDeliveryResult>> {
  if (!(await outboxUser())) return STAFF_ONLY;
  const result = await deliverDueEmails(100, { wait: true, force: true });
  revalidateOutbox();
  if (result.reason === "no_sender") return { ok: false, error: result.error ?? "No sender address is configured." };
  const data = { claimed: result.claimed, sent: result.sent, retried: result.retried, failed: result.failed };
  if (result.error && !result.sent) return { ok: false, error: `Delivery stopped: ${result.error}` };
  if (!result.claimed) return { ok: true, data, message: "Nothing was waiting to be sent." };
  const parts = [`${result.sent} sent`];
  if (result.retried) parts.push(`${result.retried} will retry`);
  if (result.failed) parts.push(`${result.failed} failed`);
  return { ok: true, data, message: `Delivery run finished: ${parts.join(", ")}` };
}

function opMessage(message: EmailMessage | null, fallback: string): ActionResult {
  if (!message) return { ok: true, data: undefined, message: fallback };
  if (message.status === "sent") return { ok: true, data: undefined, message: "Email sent" };
  if (message.status === "queued") return { ok: true, data: undefined, message: message.lastError ? `Not sent yet — will retry: ${message.lastError}` : "Email queued" };
  if (message.status === "failed") return { ok: false, error: message.lastError ? `Delivery failed: ${message.lastError}` : "Delivery failed." };
  return { ok: true, data: undefined, message: fallback };
}

export async function retryEmailAction(id: string): Promise<ActionResult> {
  if (!(await outboxUser())) return STAFF_ONLY;
  if (typeof id !== "string" || !id) return { ok: false, error: "Missing email id." };
  const result = await retryEmail(id);
  revalidateOutbox(id);
  if (!result.ok) return { ok: false, error: result.error };
  return opMessage(result.message, "Email queued");
}

export async function resendEmailAction(id: string): Promise<ActionResult<{ id: string | null }>> {
  if (!(await outboxUser())) return STAFF_ONLY;
  if (typeof id !== "string" || !id) return { ok: false, error: "Missing email id." };
  const result = await resendEmail(id);
  revalidateOutbox(id);
  if (!result.ok) return { ok: false, error: result.error };
  const outcome = opMessage(result.message, "A new copy was queued");
  if (!outcome.ok) return outcome;
  return { ok: true, data: { id: result.message?.id ?? null }, message: outcome.message === "Email sent" ? "A new copy was sent" : outcome.message };
}

export async function deleteEmailAction(id: string): Promise<ActionResult> {
  if (!(await outboxUser())) return STAFF_ONLY;
  if (typeof id !== "string" || !id) return { ok: false, error: "Missing email id." };
  const result = await deleteEmail(id);
  revalidateOutbox();
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, data: undefined, message: "Email deleted" };
}

export async function retryAllFailedAction(): Promise<ActionResult<{ requeued: number }>> {
  if (!(await outboxUser())) return STAFF_ONLY;
  const { requeued, skipped } = await retryAllFailed();
  if (requeued) await deliverDueEmails(100, { wait: true, force: true });
  revalidateOutbox();
  if (!requeued) return { ok: true, data: { requeued }, message: skipped ? "Nothing to retry — the remaining failures contain expired one-time links." : "There are no failed emails." };
  return { ok: true, data: { requeued }, message: `${requeued} failed ${requeued === 1 ? "email was" : "emails were"} queued again` };
}

export async function pruneSentEmailsAction(days: number): Promise<ActionResult<{ removed: number }>> {
  if (!(await outboxUser())) return STAFF_ONLY;
  const safeDays = Number.isFinite(days) ? Math.min(3650, Math.max(1, Math.floor(days))) : 30;
  const removed = await pruneOutbox(safeDays);
  revalidateOutbox();
  return { ok: true, data: { removed }, message: removed ? `Deleted ${removed} sent ${removed === 1 ? "email" : "emails"} older than ${safeDays} days` : `No sent emails older than ${safeDays} days` };
}
