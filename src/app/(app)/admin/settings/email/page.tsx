import { requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { cronUrl, getDeliveryState, getOutboxCounts, getTransportStatus } from "@/lib/email";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { SettingsPanelHeader, SettingsRow, SettingsSection } from "@/components/admin/settings/settings-ui";
import { EmailSettingsForm } from "@/components/admin/settings/email-settings-form";
import { SendTestEmailForm } from "@/components/admin/emails/send-test-email";
import { VerifyConnection } from "@/components/admin/emails/verify-connection";
import { CopyField } from "@/components/admin/emails/copy-field";
import { formatNumber, relativeTime } from "@/lib/utils";

export const metadata = { title: "Email settings" };

function Value({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return <span className={muted ? "text-sm text-ink-muted" : "break-all text-sm text-ink"}>{children}</span>;
}

export default async function EmailSettingsPage() {
  const admin = await requireRole(["admin"], "/admin/settings/email");
  const settings = await getSettings();
  const transport = getTransportStatus(settings);
  const counts = await getOutboxCounts();
  const delivery = getDeliveryState();
  const cron = cronUrl();

  return (
    <>
      <SettingsPanelHeader
        title="Email"
        description="How the platform sends email: delivery status, sender identity, which notifications are emailed and scheduled delivery."
        actions={
          <ButtonLink href="/admin/emails" variant="outline" size="sm" leftIcon={<Icon.Send className="size-4" />}>
            Open outbox
          </ButtonLink>
        }
      />

      <div className="space-y-6">
        <SettingsSection
          title="Delivery"
          description="Configured in the server's .env file (MAIL_TRANSPORT, MAIL_FROM, SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS)."
          actions={
            transport.transport === "log" ? (
              <Badge tone="info">Log only</Badge>
            ) : transport.ready ? (
              <Badge tone="success" dot>
                SMTP ready
              </Badge>
            ) : (
              <Badge tone="danger" dot>
                Needs attention
              </Badge>
            )
          }
        >
          {(transport.problems.length > 0 || transport.warnings.length > 0) && (
            <div className="space-y-2 px-4 py-4 sm:px-5">
              {transport.problems.map((p) => (
                <p key={p} role="alert" className="flex gap-2 text-sm text-danger">
                  <Icon.XCircle className="mt-0.5 size-4 shrink-0" />
                  {p}
                </p>
              ))}
              {transport.warnings.map((w) => (
                <p key={w} className="flex gap-2 text-sm text-warning">
                  <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  {w}
                </p>
              ))}
            </div>
          )}
          <SettingsRow label="Transport" description="“log” records emails without sending them; “smtp” delivers them.">
            <Value>{transport.transport === "smtp" ? "SMTP" : "Log (MAIL_TRANSPORT=log)"}</Value>
          </SettingsRow>
          {transport.transport === "smtp" && (
            <>
              <SettingsRow label="Server" description="Host and port (the host is partly hidden).">
                <Value>{transport.host ? `${transport.host}:${transport.port}` : "SMTP_HOST missing"}</Value>
              </SettingsRow>
              <SettingsRow label="Encryption" description="Implicit TLS (SMTP_SECURE=true, usually port 465) or STARTTLS when the server offers it.">
                <Value>{transport.security}</Value>
              </SettingsRow>
              <SettingsRow label="Sign-in" description="Credentials are only ever sent over an encrypted connection.">
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  <Value>{transport.user || "No SMTP_USER"}</Value>
                  {transport.user &&
                    (transport.passSet ? (
                      <Badge tone="success" size="xs">
                        SMTP_PASS set
                      </Badge>
                    ) : (
                      <Badge tone="danger" size="xs">
                        SMTP_PASS missing
                      </Badge>
                    ))}
                </span>
              </SettingsRow>
            </>
          )}
          <SettingsRow label="Sender address" description={transport.sender?.source === "default" ? "No MAIL_FROM set — a placeholder address is used in log mode." : "From MAIL_FROM (or SMTP_USER)."}>
            <Value muted={!transport.sender}>{transport.sender ? `${settings.email.fromName || transport.sender.name} <${transport.sender.address}>` : "Not configured"}</Value>
          </SettingsRow>
          {transport.transport === "smtp" && (
            <SettingsRow label="Connection check" description="Connects, negotiates TLS and signs in without sending an email.">
              <VerifyConnection disabled={!transport.ready} />
            </SettingsRow>
          )}
        </SettingsSection>

        <EmailSettingsForm initial={settings.email} senderAddress={transport.sender?.address ?? null} />

        <SettingsSection title="Send a test email" description="Delivers a branded test message right away and shows the result.">
          <div className="px-4 py-4 sm:px-5">
            <SendTestEmailForm defaultTo={admin.email} />
          </div>
        </SettingsSection>

        <SettingsSection
          title="Scheduled delivery"
          description="Emails are sent in the background as soon as they are queued, and retried automatically (1 min, 5 min, 30 min, 2 h; failed after 5 attempts). Call this URL every minute from a scheduler so retries also happen after restarts."
        >
          <SettingsRow label="Cron URL" description="Keep it secret: anyone with the URL can trigger delivery. It changes when APP_SECRET changes." stacked>
            <CopyField value={cron} label="Cron URL" secret />
            <p className="mt-2 font-mono text-[11px] text-ink-muted">* * * * * curl -fsS &quot;&lt;cron URL&gt;&quot; &gt; /dev/null</p>
          </SettingsRow>
          <SettingsRow label="Outbox" description="Messages currently in the outbox.">
            <span className="flex flex-wrap gap-1.5">
              <Badge tone="warning">{formatNumber(counts.queued)} queued</Badge>
              <Badge tone="success">{formatNumber(counts.sent)} sent</Badge>
              <Badge tone={counts.failed ? "danger" : "neutral"}>{formatNumber(counts.failed)} failed</Badge>
            </span>
          </SettingsRow>
          <SettingsRow label="Last delivery run" description="In this server process.">
            <Value muted={!delivery.lastRun}>
              {delivery.running
                ? "Running now"
                : delivery.lastRun
                  ? `${relativeTime(delivery.lastRun.startedAt)} · ${delivery.lastRun.sent} sent, ${delivery.lastRun.retried} to retry, ${delivery.lastRun.failed} failed${delivery.lastRun.error ? ` · ${delivery.lastRun.error}` : ""}`
                  : "No run since the server started"}
            </Value>
          </SettingsRow>
        </SettingsSection>
      </div>
    </>
  );
}
