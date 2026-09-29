import { type EmailBrand, type EmailBlock, type EmailFooter, type RenderedEmail, renderEmail } from "./layout";

export interface BatchMessageEmailData {
  /** Subject (placeholders already filled). */
  subject: string;
  /** Message body as markdown (placeholders already filled, values markdown-escaped). */
  markdown?: string;
  /** The same body already rendered (`prepareMarkdown` + `personalize`); used instead of `markdown`. */
  body?: { html: string; text: string };
  batchTitle: string;
  batchUrl: string;
  senderName?: string;
  /** Set on the copy sent to CC addresses. */
  ccRecipientCount?: number;
  footer?: EmailFooter;
}

/**
 * A message written from a batch email template (e.g. the enrollment
 * confirmation) or composed by staff for a batch. The body is the author's
 * own letter, so there is no generated greeting.
 */
export function batchMessageEmail(brand: EmailBrand, data: BatchMessageEmailData): RenderedEmail {
  const blocks: EmailBlock[] = [];
  if (data.ccRecipientCount !== undefined) {
    blocks.push({
      type: "callout",
      tone: "info",
      text: `You were copied on this message, which was sent to ${data.ccRecipientCount} ${data.ccRecipientCount === 1 ? "member" : "members"} of ${data.batchTitle}.`,
    });
  }
  blocks.push(data.body ? { type: "html", html: data.body.html, text: data.body.text } : { type: "markdown", markdown: data.markdown ?? "" });
  blocks.push({ type: "button", label: "Open the batch", url: data.batchUrl });
  if (data.senderName) blocks.push({ type: "muted", text: `Sent by ${data.senderName} for ${data.batchTitle}.` });
  return renderEmail(brand, data.subject, {
    preheader: data.batchTitle,
    eyebrow: data.batchTitle,
    heading: data.subject,
    blocks,
    footer: data.footer,
  });
}
