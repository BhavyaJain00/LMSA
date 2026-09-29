import type { EmailCategory, EmailStatus } from "@/lib/types";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EMAIL_CATEGORY_LABELS } from "@/lib/email/preferences";

const STATUS: Record<EmailStatus, { label: string; tone: BadgeTone }> = {
  queued: { label: "Queued", tone: "warning" },
  sending: { label: "Sending", tone: "info" },
  sent: { label: "Sent", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};

export const EMAIL_STATUS_LABELS: Record<EmailStatus, string> = {
  queued: STATUS.queued.label,
  sending: STATUS.sending.label,
  sent: STATUS.sent.label,
  failed: STATUS.failed.label,
};

/** Outbox status chip. A queued message with earlier attempts reads "Retrying". */
export function EmailStatusBadge({ status, attempts = 0, className }: { status: EmailStatus; attempts?: number; className?: string }) {
  const s = STATUS[status];
  const label = status === "queued" && attempts > 0 ? "Retrying" : s.label;
  return (
    <Badge tone={s.tone} dot className={className}>
      {label}
    </Badge>
  );
}

export function EmailCategoryBadge({ category, className }: { category: EmailCategory; className?: string }) {
  return (
    <Badge tone="outline" size="xs" className={className}>
      {EMAIL_CATEGORY_LABELS[category] ?? category}
    </Badge>
  );
}
