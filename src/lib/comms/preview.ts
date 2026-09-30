import "server-only";
import type { User } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { siteConfig } from "@/lib/config";
import { SlidingWindowRateLimiter } from "@/lib/auth/rate-limit";
import { isSafeAddress } from "@/lib/email/mime";
import { enqueueEmail } from "@/lib/email/outbox";
import { externalRecipientLimitMessage, reserveExternalRecipients, retryAfterLabel } from "@/lib/email/quota";
import { MAX_TEST_RECIPIENTS, type CampaignContent, parseAddressList } from "./campaign-core";
import { courseValues, prepareCampaign, renderCampaignEmail } from "./render";
import { firstNameOf } from "./segments";

/**
 * Previews and test sends of marketing emails (broadcasts and sequence
 * steps) for staff. Neither is tracked or counted in a campaign's numbers.
 */

const EMAIL_OFF = "Email is turned off. Switch it on in Settings → Email first.";

const TESTS_PER_USER = { limit: 10, windowMs: 10 * 60_000 };
const g = globalThis as unknown as { __llCommsTestLimiter?: SlidingWindowRateLimiter };
const testLimiter: SlidingWindowRateLimiter = (g.__llCommsTestLimiter ??= new SlidingWindowRateLimiter({ maxKeys: 5_000 }));

/** Forget the test-send counters (tests). */
export function resetTestSendLimits(): void {
  testLimiter.resetPrefix("comms-test:");
}

/** `{{ course_title }}` / `{{ course_url }}` values for a course id (generic wording when there is none). */
export async function courseValuesFor(courseId: string | null | undefined): Promise<Record<string, string>> {
  const db = await getDb();
  const course = courseId ? db.courses.find((c) => c.id === courseId) : null;
  return courseValues(course, siteConfig.appUrl);
}

export type TestSendResult = { ok: true; sent: string[]; pending: string[] } | { ok: false; error: string };

/**
 * Send a test copy to the staff member (the default) or up to a few other
 * addresses. Copies are marked "[Test]", delivered right away and untracked.
 */
export async function sendCampaignTest(
  sender: Pick<User, "id" | "name" | "email">,
  content: CampaignContent,
  to: string,
  extraValues: Record<string, string> = {},
): Promise<TestSendResult> {
  const db = await getDb();
  if (!db.settings.email.enabled) return { ok: false, error: EMAIL_OFF };
  const own = sender.email.trim().toLowerCase();
  const addresses = parseAddressList(to || own);
  if (!addresses.length) return { ok: false, error: "Enter at least one email address." };
  if (addresses.length > MAX_TEST_RECIPIENTS) return { ok: false, error: `Send a test to at most ${MAX_TEST_RECIPIENTS} addresses at a time.` };
  const invalid = addresses.find((a) => !isSafeAddress(a));
  if (invalid) return { ok: false, error: `${invalid.slice(0, 120)} isn't a valid email address.` };

  const limit = testLimiter.hit(`comms-test:${sender.id}`, TESTS_PER_USER);
  if (!limit.ok) return { ok: false, error: `You've sent a lot of tests. Try again ${retryAfterLabel(limit.retryAfterMs)}.` };
  const external = addresses.filter((a) => a !== own);
  if (external.length) {
    const quota = reserveExternalRecipients(sender.id, external.length);
    if (!quota.ok) return { ok: false, error: externalRecipientLimitMessage(quota) };
  }

  const prepared = prepareCampaign(db.settings, content, extraValues);
  const sent: string[] = [];
  const pending: string[] = [];
  for (const address of addresses) {
    const mine = address === own;
    const rendered = renderCampaignEmail(
      prepared,
      { kind: "test", email: address, name: mine ? sender.name : "", firstName: mine ? firstNameOf(sender.name) : "", sentBy: sender.name },
      { subjectPrefix: "[Test] " },
    );
    const message = await enqueueEmail(
      { to: address, userId: mine ? sender.id : undefined, subject: rendered.subject, html: rendered.html, text: rendered.text, category: "test" },
      { deliverNow: true },
    );
    (message.status === "sent" ? sent : pending).push(address);
  }
  return { ok: true, sent, pending };
}

/** "Test sent to a@b.c" / "… is queued and will be retried" for toasts. */
export function describeTestSend(result: Extract<TestSendResult, { ok: true }>): string {
  const parts: string[] = [];
  if (result.sent.length) parts.push(`Test sent to ${result.sent.join(", ")}`);
  if (result.pending.length) parts.push(`${result.pending.join(", ")} couldn't be delivered right away — see the email outbox`);
  return `${parts.join(". ")}.`;
}

export interface CampaignPreview {
  subject: string;
  html: string;
}

/** The email as the viewer would receive it (nothing is sent or tracked). */
export async function previewCampaign(viewer: Pick<User, "name" | "email">, content: CampaignContent, extraValues: Record<string, string> = {}): Promise<CampaignPreview> {
  const db = await getDb();
  const prepared = prepareCampaign(db.settings, content, extraValues);
  const rendered = renderCampaignEmail(prepared, {
    kind: "test",
    email: viewer.email,
    name: viewer.name,
    firstName: firstNameOf(viewer.name),
    sentBy: viewer.name,
  });
  return { subject: rendered.subject, html: rendered.html };
}
