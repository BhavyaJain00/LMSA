"use client";

import { useState, useTransition } from "react";
import type { GatewayStatusView } from "@/lib/payments/types";
import { testGatewayConnectionAction } from "@/lib/actions/payments";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink, IconButton } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { SettingsSection } from "./settings-ui";
import { useT } from "@/i18n/client";

/**
 * Read-only status of the real payment gateways: whether the keys in `.env`
 * are present (secrets are masked on the server), test/live mode, the
 * webhook URL and events to configure in the gateway dashboard, and a
 * "Test connection" button.
 */
export function PaymentGatewaysPanel({ gateways, activeGateway, localAppUrl }: { gateways: GatewayStatusView[]; activeGateway: string; localAppUrl: boolean }) {
  const t = useT("admin");
  return (
    <SettingsSection
      title={t("gateways.title")}
      description={t("gateways.description")}
    >
      {gateways.map((g) => (
        <GatewayCard key={g.gateway} gateway={g} active={activeGateway === g.gateway} localAppUrl={localAppUrl} />
      ))}
    </SettingsSection>
  );
}

function GatewayCard({ gateway: g, active, localAppUrl }: { gateway: GatewayStatusView; active: boolean; localAppUrl: boolean }) {
  const t = useT("admin");
  const toast = useToast();
  const [testing, startTesting] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const test = () => {
    startTesting(async () => {
      const res = await testGatewayConnectionAction(g.gateway);
      if (res.ok) {
        setResult({ ok: true, text: res.message ?? t("gateways.connected") });
        toast.success(res.message ?? t("gateways.connected"));
      } else {
        setResult({ ok: false, text: res.error });
        toast.error(t("gateways.connectionFailed"), res.error);
      }
    });
  };

  return (
    <div className="px-4 py-5 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", g.configured ? "bg-success/12 text-success" : "bg-surface-2 text-ink-faint")}>
            <Icon.CreditCard className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-semibold text-ink">{g.label}</h4>
              {g.configured ? (
                <Badge tone="success" dot>
                  {t("gateways.configured")}
                </Badge>
              ) : (
                <Badge tone="warning" dot>
                  {t("gateways.notConfigured")}
                </Badge>
              )}
              {g.mode && <Badge tone={g.mode === "live" ? "accent" : "outline"}>{g.mode === "live" ? t("gateways.liveMode") : t("gateways.testMode")}</Badge>}
              {active && <Badge tone="info">{t("gateways.active")}</Badge>}
            </div>
            <p className="mt-0.5 text-xs text-ink-muted">{g.note}</p>
          </div>
        </div>
        {g.configured && (
          <Button variant="outline" size="sm" onClick={test} loading={testing} leftIcon={<Icon.Zap className="size-4" />}>
            {t("gateways.test")}
          </Button>
        )}
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-ink-faint">{g.keyLabel}</dt>
          <dd className="mt-0.5 font-mono text-xs text-ink" dir="ltr">{g.maskedKey || <span className="font-sans text-ink-muted">{t("gateways.notSet")}</span>}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-ink-faint">{g.webhookSecretVar}</dt>
          <dd className="mt-0.5 text-xs">
            {g.webhookConfigured ? (
              <span className="inline-flex items-center gap-1 text-success">
                <Icon.CheckCircle className="size-3.5" /> {t("gateways.set")}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-warning">
                <Icon.AlertTriangle className="size-3.5" /> {t("gateways.missingSecret")}
              </span>
            )}
          </dd>
        </div>
      </dl>

      {g.missing.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-ink">
          {g.missing.map((m) => (
            <li key={m} className="flex items-start gap-1.5">
              <Icon.AlertTriangle className="mt-px size-3.5 shrink-0 text-warning" aria-hidden="true" />
              {m}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 rounded-xl border border-border bg-surface-2 p-3">
        <p className="text-xs font-medium text-ink">{t("gateways.webhook")}</p>
        <p className="mt-0.5 text-xs text-ink-muted">
          {t.rich("gateways.webhookHelp", { gateway: g.label, variable: <span className="font-mono">{g.webhookSecretVar}</span> })}
        </p>
        <CopyField value={g.webhookUrl} label={t("gateways.webhookUrl", { gateway: g.label })} />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {g.webhookEvents.map((e) => (
            <code key={e} className="rounded-md bg-surface-1 px-1.5 py-0.5 font-mono text-[11px] text-ink-muted ring-1 ring-border">
              {e}
            </code>
          ))}
        </div>
        {localAppUrl && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-muted">
            <Icon.Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            {g.gateway === "stripe" ? (
              <span>
                {t.rich("gateways.localStripe", {
                  gateway: g.label,
                  command: (
                    <span className="font-mono" dir="ltr">
                      stripe listen --forward-to {new URL(g.webhookUrl).host}/api/payments/stripe/webhook
                    </span>
                  ),
                })}
              </span>
            ) : (
              <span>{t("gateways.localOther", { gateway: g.label })}</span>
            )}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <ButtonLink href={g.dashboardUrl} variant="ghost" size="sm" leftIcon={<Icon.ExternalLink className="size-4" />}>
            {t("gateways.openDashboard", { gateway: g.label })}
          </ButtonLink>
          <ButtonLink href={g.docsUrl} variant="ghost" size="sm" leftIcon={<Icon.BookOpen className="size-4" />}>
            {t("gateways.docs")}
          </ButtonLink>
        </div>
      </div>

      {result && (
        <p role="status" className={cn("mt-3 flex items-start gap-1.5 text-xs", result.ok ? "text-success" : "text-danger")}>
          {result.ok ? <Icon.CheckCircle className="mt-px size-3.5 shrink-0" /> : <Icon.XCircle className="mt-px size-3.5 shrink-0" />}
          {result.text}
        </p>
      )}
    </div>
  );
}

function CopyField({ value, label }: { value: string; label: string }) {
  const t = useT("admin");
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("gateways.copyFailed"), t("gateways.copyManually"));
    }
  };
  return (
    <div className="mt-2 flex items-center gap-2">
      <input
        readOnly
        value={value}
        dir="ltr"
        aria-label={label}
        onFocus={(e) => e.currentTarget.select()}
        className="h-8 min-w-0 flex-1 rounded-lg border border-border-strong bg-surface-1 px-2.5 font-mono text-xs text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
      />
      <IconButton label={copied ? t("gateways.copied") : t("gateways.copyUrl")} variant="outline" size="icon-sm" onClick={() => void copy()} className="size-8">
        {copied ? <Icon.Check className="size-4 text-success" /> : <Icon.Copy className="size-4" />}
      </IconButton>
    </div>
  );
}
