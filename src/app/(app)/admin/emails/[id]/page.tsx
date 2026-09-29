import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getOutboxEmail } from "@/lib/email/admin";
import { EMAIL_CATEGORY_LABELS } from "@/lib/email/preferences";
import { PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs, DetailItem } from "@/components/admin/settings/settings-ui";
import { EmailStatusBadge } from "@/components/admin/emails/email-status";
import { EmailDetailActions } from "@/components/admin/emails/email-detail-actions";
import { EmailPreview } from "@/components/admin/emails/email-preview";
import { formatDateTime, relativeTime, truncate } from "@/lib/utils";

export async function generateMetadata(props: PageProps<"/admin/emails/[id]">) {
  const { id } = await props.params;
  const email = await getOutboxEmail(id);
  return { title: email ? `Email: ${truncate(email.subject, 60)}` : "Email not found" };
}

export default async function OutboxEmailPage(props: PageProps<"/admin/emails/[id]">) {
  const { id } = await props.params;
  await requireRole(["moderator"], `/admin/emails/${id}`);
  const email = await getOutboxEmail(id);
  if (!email) notFound();

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={<span className="break-words">{email.subject}</span>}
        description={`${EMAIL_CATEGORY_LABELS[email.category] ?? email.category} email to ${email.toName ? `${email.toName} <${email.to}>` : email.to}`}
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Admin", href: "/admin" },
              { label: "Outbox", href: "/admin/emails" },
              { label: truncate(email.subject, 40) },
            ]}
          />
        }
        actions={<EmailDetailActions id={email.id} status={email.status} canRetry={email.canRetry} canResend={email.canResend} canDelete={email.canDelete} />}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4 lg:order-1">
          {email.lastError && (
            <div
              role={email.status === "sent" ? "status" : "alert"}
              className={
                email.status === "sent"
                  ? "flex gap-3 rounded-card border border-warning/30 bg-warning/10 p-4 text-sm text-warning"
                  : "flex gap-3 rounded-card border border-danger/30 bg-danger/10 p-4 text-sm text-danger"
              }
            >
              <Icon.AlertTriangle className="mt-0.5 size-5 shrink-0" />
              <div className="min-w-0">
                <p className="font-medium">{email.status === "sent" ? "Delivered with a warning" : email.status === "failed" ? "Delivery failed" : "Last attempt failed"}</p>
                <p className="mt-0.5 break-words">{email.lastError}</p>
              </div>
            </div>
          )}
          {email.sensitive && (
            <div className="flex gap-3 rounded-card border border-info/30 bg-info/10 p-4 text-sm text-info">
              <Icon.Lock className="mt-0.5 size-5 shrink-0" />
              <p className="min-w-0">
                This email contains a one-time link. The link is hidden here, and it is removed from storage once the email is delivered or fails, so it can&apos;t be resent —
                the member can request a new one.
              </p>
            </div>
          )}
          <EmailPreview previewHtml={email.previewHtml} html={email.html} text={email.text} headers={email.headers} subject={email.subject} />
        </div>

        <aside className="min-w-0 lg:order-2">
          <div className="rounded-card border border-border bg-surface-1 p-5 shadow-card">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-ink">Delivery</h2>
              <EmailStatusBadge status={email.status} attempts={email.attempts} />
            </div>
            <dl className="mt-4 space-y-4">
              <DetailItem label="To">
                {email.toName && <span className="block">{email.toName}</span>}
                <span className="break-all text-ink-muted">{email.to}</span>
              </DetailItem>
              {email.cc.length > 0 && (
                <DetailItem label={`Cc (${email.cc.length})`}>
                  <span className="break-all text-ink-muted">{email.cc.join(", ")}</span>
                </DetailItem>
              )}
              {email.user && (
                <DetailItem label="Member">
                  <Link href={`/admin/members/${email.user.id}`} className="text-accent hover:underline">
                    {email.user.name}
                  </Link>{" "}
                  <span className="text-ink-muted">@{email.user.username}</span>
                </DetailItem>
              )}
              <DetailItem label="Category">{EMAIL_CATEGORY_LABELS[email.category] ?? email.category}</DetailItem>
              <DetailItem label="Created">
                <span title={formatDateTime(email.createdAt)}>
                  {formatDateTime(email.createdAt)} <span className="text-ink-muted">({relativeTime(email.createdAt)})</span>
                </span>
              </DetailItem>
              {email.sentAt && <DetailItem label="Sent">{formatDateTime(email.sentAt)}</DetailItem>}
              <DetailItem label="Attempts">
                {email.attempts} of {email.maxAttempts}
              </DetailItem>
              {email.status === "queued" && email.nextAttemptAt && (
                <DetailItem label={email.attempts > 0 ? "Next retry" : "Scheduled"}>{formatDateTime(email.nextAttemptAt)}</DetailItem>
              )}
              {email.messageId && (
                <DetailItem label="Message-ID">
                  <span className="break-all font-mono text-xs">{email.messageId}</span>
                </DetailItem>
              )}
              <DetailItem label="Outbox id">
                <span className="break-all font-mono text-xs">{email.id}</span>
              </DetailItem>
            </dl>
          </div>
          <p className="mt-3 px-1 text-xs text-ink-faint">
            Failed attempts are retried after 1 minute, 5 minutes, 30 minutes and 2 hours; after {email.maxAttempts} attempts the email is marked failed.
          </p>
        </aside>
      </div>
    </div>
  );
}
