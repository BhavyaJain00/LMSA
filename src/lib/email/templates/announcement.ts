import { type EmailBrand, type EmailBlock, type EmailFooter, type RenderedEmail, firstName, renderEmail } from "./layout";

export interface AnnouncementEmailData {
  /** Recipient name; omitted for the copy sent to CC addresses. */
  recipientName?: string;
  contextKind: "batch" | "course";
  contextTitle: string;
  /** Subject line (placeholders already filled). */
  subject: string;
  /** Announcement body as markdown (placeholders already filled, values markdown-escaped). */
  markdown: string;
  authorName?: string;
  /** Link to the batch/course announcements. */
  url: string;
  /** For the CC copy: how many members received the announcement. */
  ccRecipientCount?: number;
  footer?: EmailFooter;
}

/** Announcement posted to a batch or course. */
export function announcementEmail(brand: EmailBrand, data: AnnouncementEmailData): RenderedEmail {
  const where = data.contextKind === "batch" ? "Batch" : "Course";
  const blocks: EmailBlock[] = [];
  if (data.ccRecipientCount !== undefined) {
    blocks.push({
      type: "callout",
      tone: "info",
      text: `You were copied on this announcement, which was sent to ${data.ccRecipientCount} ${data.ccRecipientCount === 1 ? "member" : "members"} of the ${where.toLowerCase()} ${data.contextTitle}.`,
    });
  }
  blocks.push({ type: "markdown", markdown: data.markdown });
  blocks.push({ type: "divider" });
  if (data.authorName) blocks.push({ type: "muted", text: `Posted by ${data.authorName} in ${data.contextTitle}.` });
  blocks.push({ type: "button", label: data.contextKind === "batch" ? "Open the batch" : "Open the course", url: data.url });
  return renderEmail(brand, data.subject, {
    preheader: `${where} announcement · ${data.contextTitle}`,
    eyebrow: `${where} announcement · ${data.contextTitle}`,
    heading: data.subject,
    greeting: data.recipientName ? `Hi ${firstName(data.recipientName)},` : undefined,
    blocks,
    footer: data.footer,
  });
}
