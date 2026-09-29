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

/**
 * Read-only status of the real payment gateways: whether the keys in `.env`
 * are present (secrets are masked on the server), test/live mode, the
 * webhook URL and events to configure in the gateway dashboard, and a
 * "Test connection" button.
 */
export function PaymentGatewaysPanel({ gateways, activeGateway, localAppUrl }: { gateways: GatewayStatusView[]; activeGateway: string; localAppUrl: boolean }) {
  return (
    <SettingsSection
      title="Payment gateways"
      description="Stripe and Razorpay are configured with environment variables in your .env file (restart the server after changing them). Manual payments always work."
    >
      {gateways.map((g) => (
        <GatewayCard key={g.gateway} gateway={g} active={activeGateway === g.gateway} localAppUrl={localAppUrl} />
      ))}
    </SettingsSection>
  );
}

function GatewayCard({ gateway: g, active, localAppUrl }: { gateway: GatewayStatusView; active: boolean; localAppUrl: boolean }) {
  const toast = useToast();
  const [testing, startTesting] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const test = () => {
    startTesting(async () => {
      const res = await testGatewayConnectionAction(g.gateway);
      if (res.ok) {
        setResult({ ok: true, text: res.message ?? "Connected." });
        toast.success(res.message ?? "Connected");
      } else {
        setResult({ ok: false, text: res.error });
        toast.error("Connection failed", res.error);
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
                  Configured
                </Badge>
              ) : (
                <Badge tone="warning" dot>
                  Not configured
                </Badge>
              )}
              {g.mode && <Badge tone={g.mode === "live" ? "accent" : "outline"}>{g.mode === "live" ? "Live mode" : "Test mode"}</Badge>}
              {active && <Badge tone="info">Active at checkout</Badge>}
            </div>
            <p className="mt-0.5 text-xs text-ink-muted">{g.note}</p>
          </div>
        </div>
        {g.configured && (
          <Button variant="outline" size="sm" onClick={test} loading={testing} leftIcon={<Icon.Zap className="size-4" />}>
            Test connection
          </Button>
        )}
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-ink-faint">{g.keyLabel}</dt>
          <dd className="mt-0.5 font-mono text-xs text-ink">{g.maskedKey || <span className="font-sans text-ink-muted">Not set</span>}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-ink-faint">{g.webhookSecretVar}</dt>
          <dd className="mt-0.5 text-xs">
            {g.webhookConfigured ? (
              <span className="inline-flex items-center gap-1 text-success">
                <Icon.CheckCircle className="size-3.5" /> Set
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-warning">
                <Icon.AlertTriangle className="size-3.5" /> Missing — webhooks are rejected until it is set
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
        <p className="text-xs font-medium text-ink">Webhook endpoint</p>
        <p className="mt-0.5 text-xs text-ink-muted">
          Add this URL in the {g.label} dashboard and subscribe to the events below, then copy the signing secret into <span className="font-mono">{g.webhookSecretVar}</span>.
          Orders are also confirmed when learners return from checkout, but webhooks make it reliable.
        </p>
        <CopyField value={g.webhookUrl} label={`${g.label} webhook URL`} />
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
                APP_URL points to this computer, which {g.label} cannot reach. For local testing run{" "}
                <span className="font-mono">stripe listen --forward-to {new URL(g.webhookUrl).host}/api/payments/stripe/webhook</span> and use the secret it prints.
              </span>
            ) : (
              <span>APP_URL points to this computer, which {g.label} cannot reach. Expose it with a tunnel (and set APP_URL to the tunnel address) to receive webhooks locally.</span>
            )}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <ButtonLink href={g.dashboardUrl} variant="ghost" size="sm" leftIcon={<Icon.ExternalLink className="size-4" />}>
            Open {g.label} webhooks
          </ButtonLink>
          <ButtonLink href={g.docsUrl} variant="ghost" size="sm" leftIcon={<Icon.BookOpen className="size-4" />}>
            Webhook docs
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
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy", "Select the URL and copy it manually.");
    }
  };
  return (
    <div className="mt-2 flex items-center gap-2">
      <input
        readOnly
        value={value}
        aria-label={label}
        onFocus={(e) => e.currentTarget.select()}
        className="h-8 min-w-0 flex-1 rounded-lg border border-border-strong bg-surface-1 px-2.5 font-mono text-xs text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
      />
      <IconButton label={copied ? "Copied" : "Copy URL"} variant="outline" size="icon-sm" onClick={() => void copy()} className="size-8">
        {copied ? <Icon.Check className="size-4 text-success" /> : <Icon.Copy className="size-4" />}
      </IconButton>
    </div>
  );
}
