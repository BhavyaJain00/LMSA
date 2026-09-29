import type { NotificationType } from "@/lib/types";
import { type EmailBrand, type EmailBlock, type EmailFooter, type RenderedEmail, firstName, renderEmail } from "./layout";

export interface NotificationEmailData {
  name: string;
  type: NotificationType;
  subject: string;
  message?: string;
  /** App path or absolute URL the notification points to. */
  url?: string;
  /** Who triggered it ("Maya Patel"). */
  actorName?: string;
  footer?: EmailFooter;
}

const PRESENTATION: Record<NotificationType, { eyebrow: string; cta: string }> = {
  enrollment: { eyebrow: "Enrollment", cta: "Open" },
  course_published: { eyebrow: "New course", cta: "View the course" },
  batch_published: { eyebrow: "Batch", cta: "View the batch" },
  live_class: { eyebrow: "Live class", cta: "View class details" },
  assignment_graded: { eyebrow: "Assignment", cta: "View assignment" },
  quiz_graded: { eyebrow: "Quiz result", cta: "Review your submission" },
  certificate: { eyebrow: "Certificate", cta: "View details" },
  badge: { eyebrow: "Badge earned", cta: "See your badges" },
  mention: { eyebrow: "Mention", cta: "View the discussion" },
  reply: { eyebrow: "New reply", cta: "View the discussion" },
  announcement: { eyebrow: "Announcement", cta: "Read the announcement" },
  system: { eyebrow: "Update", cta: "Open" },
};

/** Generic email copy of an in-app notification. */
export function notificationEmail(brand: EmailBrand, data: NotificationEmailData): RenderedEmail {
  const p = PRESENTATION[data.type] ?? PRESENTATION.system;
  const blocks: EmailBlock[] = [];
  if (data.actorName && (data.type === "mention" || data.type === "reply")) {
    blocks.push({ type: "paragraph", text: data.type === "mention" ? `${data.actorName} mentioned you in a discussion.` : `${data.actorName} replied to a discussion you're part of.` });
  }
  if (data.message?.trim()) {
    const message = data.message.trim();
    blocks.push(data.type === "mention" || data.type === "reply" ? { type: "quote", text: message.length > 1200 ? `${message.slice(0, 1200)}…` : message } : { type: "paragraph", text: message });
  }
  if (data.url) blocks.push({ type: "button", label: p.cta, url: data.url });
  return renderEmail(brand, data.subject, {
    preheader: data.message?.slice(0, 140) || data.subject,
    eyebrow: p.eyebrow,
    heading: data.subject,
    greeting: `Hi ${firstName(data.name)},`,
    blocks,
    footer: data.footer,
  });
}
