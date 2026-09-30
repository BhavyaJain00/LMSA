import "server-only";
import { deleteEmail, enqueueEmail, getEmailBrand } from "@/lib/email";
import { renderEmail, type EmailBlock } from "@/lib/email/templates";

/**
 * Confirmation sent to the address an account had just before it was erased.
 *
 * The message is delivered straight away and its outbox row is removed
 * afterwards whatever the outcome: keeping it (for retries or for the email
 * log) would keep the very address the erasure just removed. Never throws.
 */

export interface ErasureRecipient {
  email: string;
  name: string;
}

/** Subject and body copy (pure; exported for tests). */
export function erasureEmailCopy(brandName: string, byAdmin: boolean): { subject: string; heading: string; paragraphs: string[] } {
  return {
    subject: `Your ${brandName} account was deleted`,
    heading: "Your account was deleted",
    paragraphs: [
      byAdmin
        ? `As requested, an administrator deleted your ${brandName} account and removed your personal data.`
        : `Your ${brandName} account was deleted and your personal data was removed, as you asked.`,
      "Orders keep their amounts and invoice numbers because the law requires it, without your name or address. Posts you wrote in discussions now show “Deleted user”.",
      "This is the last email we will send to this address. You are welcome to create a new account at any time.",
    ],
  };
}

export async function sendErasureConfirmation(recipient: ErasureRecipient, opts: { byAdmin: boolean; contactEmail?: string }): Promise<void> {
  let messageId: string | undefined;
  try {
    const brand = await getEmailBrand();
    const copy = erasureEmailCopy(brand.name, opts.byAdmin);
    const blocks: EmailBlock[] = copy.paragraphs.map((text) => ({ type: "paragraph", text }));
    blocks.push({
      type: "callout",
      tone: "warning",
      text: opts.contactEmail ? `If you didn't ask for this, write to ${opts.contactEmail} as soon as possible.` : "If you didn't ask for this, reply to this email as soon as possible.",
    });
    const first = recipient.name.trim().split(/\s+/)[0] || "there";
    const rendered = renderEmail(brand, copy.subject, {
      preheader: copy.paragraphs[0]!,
      heading: copy.heading,
      greeting: `Hi ${first},`,
      blocks,
      footer: { reason: `You received this message because your ${brand.name} account was deleted.` },
    });
    const message = await enqueueEmail(
      { to: recipient.email, toName: recipient.name, subject: rendered.subject, html: rendered.html, text: rendered.text, category: "other" },
      { deliverNow: true },
    );
    messageId = message.id;
  } catch (err) {
    console.error("[privacy] could not send the account deletion confirmation", err instanceof Error ? err.message : err);
  } finally {
    if (messageId) await deleteEmail(messageId).catch(() => undefined);
  }
}
