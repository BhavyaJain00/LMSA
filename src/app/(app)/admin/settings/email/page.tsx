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
import { getFormatter } from "@/i18n/server";
import type { Metadata } from "next";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("admin");
  return { title: t("pages.settings.email.metaTitle") };
}

function Value({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return <span className={muted ? "text-sm text-ink-muted" : "break-all text-sm text-ink"}>{children}</span>;
}

export default async function EmailSettingsPage() {
  const t = await getT("admin");
  const admin = await requireRole(["admin"], "/admin/settings/email");
  const settings = await getSettings();
  const transport = getTransportStatus(settings);
  const counts = await getOutboxCounts();
  const delivery = getDeliveryState();
  const cron = cronUrl();
  const f = await getFormatter();

  return (
    <>
      <SettingsPanelHeader
        title={t("pages.settings.email.title")}
        description={t("pages.settings.email.description")}
        actions={
          <ButtonLink href="/admin/emails" variant="outline" size="sm" leftIcon={<Icon.Send className="size-4" />}>
            {t("pages.settings.email.openOutbox")}
          </ButtonLink>
        }
      />

      <div className="space-y-6">
        <SettingsSection
          title={t("pages.settings.email.delivery.title")}
          description={t("pages.settings.email.delivery.description")}
          actions={
            transport.transport === "log" ? (
              <Badge tone="info">{t("pages.settings.email.delivery.logOnly")}</Badge>
            ) : transport.ready ? (
              <Badge tone="success" dot>
                {t("pages.settings.email.delivery.smtpReady")}
              </Badge>
            ) : (
              <Badge tone="danger" dot>
                {t("pages.settings.email.delivery.needsAttention")}
              </Badge>
            )
          }
        >
          {(transport.problems.length > 0 || transport.warnings.length > 0 || delivery.configError) && (
            <div className="space-y-2 px-4 py-4 sm:px-5">
              {delivery.configError && (
                <p role="alert" className="flex gap-2 text-sm text-danger">
                  <Icon.XCircle className="mt-0.5 size-4 shrink-0" />
                  {t("pages.settings.email.delivery.paused", { error: delivery.configError })}
                </p>
              )}
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
          <SettingsRow label={t("pages.settings.email.delivery.transport")} description={t("pages.settings.email.delivery.transportHint")}>
            <Value>{transport.transport === "smtp" ? "SMTP" : t("pages.settings.email.delivery.logValue")}</Value>
          </SettingsRow>
          {transport.transport === "smtp" && (
            <>
              <SettingsRow label={t("pages.settings.email.delivery.server")} description={t("pages.settings.email.delivery.serverHint")}>
                <Value>{transport.host ? <span dir="ltr">{`${transport.host}:${transport.port}`}</span> : t("pages.settings.email.delivery.hostMissing")}</Value>
              </SettingsRow>
              <SettingsRow
                label={t("pages.settings.email.delivery.encryption")}
                description={t("pages.settings.email.delivery.encryptionHint")}
              >
                <Value>{transport.security === "STARTTLS" ? (transport.tlsRequired ? t("pages.settings.email.delivery.starttlsRequired") : t("pages.settings.email.delivery.starttlsOptional")) : transport.security}</Value>
              </SettingsRow>
              <SettingsRow label={t("pages.settings.email.delivery.signIn")} description={t("pages.settings.email.delivery.signInHint")}>
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  <Value>{transport.user || t("pages.settings.email.delivery.noUser")}</Value>
                  {transport.user &&
                    (transport.passSet ? (
                      <Badge tone="success" size="xs">
                        {t("pages.settings.email.delivery.passSet")}
                      </Badge>
                    ) : (
                      <Badge tone="danger" size="xs">
                        {t("pages.settings.email.delivery.passMissing")}
                      </Badge>
                    ))}
                </span>
              </SettingsRow>
            </>
          )}
          <SettingsRow label={t("pages.settings.email.delivery.sender")} description={transport.sender?.source === "default" ? t("pages.settings.email.delivery.senderDefault") : t("pages.settings.email.delivery.senderFrom")}>
            <Value muted={!transport.sender}>{transport.sender ? <span dir="ltr">{`${settings.email.fromName || transport.sender.name} <${transport.sender.address}>`}</span> : t("pages.settings.email.delivery.notConfigured")}</Value>
          </SettingsRow>
          {transport.transport === "smtp" && (
            <SettingsRow label={t("pages.settings.email.delivery.check")} description={t("pages.settings.email.delivery.checkHint")}>
              <VerifyConnection disabled={!transport.ready} />
            </SettingsRow>
          )}
        </SettingsSection>

        <EmailSettingsForm initial={settings.email} senderAddress={transport.sender?.address ?? null} />

        <SettingsSection title={t("pages.settings.email.test.title")} description={t("pages.settings.email.test.description")}>
          <div className="px-4 py-4 sm:px-5">
            <SendTestEmailForm defaultTo={admin.email} />
          </div>
        </SettingsSection>

        <SettingsSection
          title={t("pages.settings.email.cron.title")}
          description={t("pages.settings.email.cron.description")}
        >
          <SettingsRow label={t("pages.settings.email.cron.url")} description={t("pages.settings.email.cron.urlHint")} stacked>
            <CopyField value={cron} label={t("pages.settings.email.cron.url")} secret />
            <p dir="ltr" className="mt-2 font-mono text-[11px] text-ink-muted">* * * * * curl -fsS &quot;&lt;cron URL&gt;&quot; &gt; /dev/null</p>
          </SettingsRow>
          <SettingsRow label={t("pages.settings.email.cron.outbox")} description={t("pages.settings.email.cron.outboxHint")}>
            <span className="flex flex-wrap gap-1.5">
              <Badge tone="warning">{t("pages.settings.email.cron.queued", { count: counts.queued })}</Badge>
              <Badge tone="success">{t("pages.settings.email.cron.sent", { count: counts.sent })}</Badge>
              <Badge tone={counts.failed ? "danger" : "neutral"}>{t("pages.settings.email.cron.failed", { count: counts.failed })}</Badge>
            </span>
          </SettingsRow>
          <SettingsRow label={t("pages.settings.email.cron.lastRun")} description={t("pages.settings.email.cron.lastRunHint")}>
            <Value muted={!delivery.lastRun}>
              {delivery.running
                ? t("pages.settings.email.cron.running")
                : delivery.lastRun
                  ? `${t("pages.settings.email.cron.runSummary", {
                      when: f.relative(delivery.lastRun.startedAt),
                      sent: delivery.lastRun.sent,
                      retried: delivery.lastRun.retried,
                      failed: delivery.lastRun.failed,
                    })}${delivery.lastRun.error ? ` · ${delivery.lastRun.error}` : ""}`
                  : t("pages.settings.email.cron.noRun")}
            </Value>
          </SettingsRow>
        </SettingsSection>
      </div>
    </>
  );
}
