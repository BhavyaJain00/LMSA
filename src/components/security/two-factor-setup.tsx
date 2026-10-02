"use client";

import { useActionState, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/types";
import { beginTwoFactorSetupAction, cancelTwoFactorSetupAction, confirmTwoFactorSetupAction } from "@/lib/actions/security";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { safeRedirectPath } from "@/lib/auth/redirects";
import { CopyButton } from "./copy-button";
import { OtpCodeInput } from "./otp-code-input";
import { RecoveryCodesDialog } from "./recovery-codes-dialog";
import { useT } from "@/i18n/client";

type ConfirmResult = ActionResult<{ recoveryCodes: string[] }>;

/** Generates a new secret and reveals the setup steps (the page re-renders with the QR code). */
export function StartTwoFactorButton({ label, variant = "primary" }: { label?: string; variant?: "primary" | "outline" }) {
  const toast = useToast();
  const t = useT("account");
  const [pending, startTransition] = useTransition();
  const start = () =>
    startTransition(async () => {
      const result = await beginTwoFactorSetupAction();
      if (!result.ok) toast.error(result.error);
    });
  return (
    <Button variant={variant} onClick={start} loading={pending} leftIcon={<Icon.ShieldCheck className="size-4" />}>
      {label ?? t("security.setup.start")}
    </Button>
  );
}

/**
 * Step-by-step authenticator setup: scan the QR code (or type the key), then
 * confirm with a code. On success the recovery codes are shown once.
 */
export function TwoFactorSetup({
  qr,
  secret,
  brand,
  email,
  continueTo,
}: {
  /** Server-rendered QR code for the otpauth:// URI (null when it couldn't be drawn: the key is shown instead). */
  qr: ReactNode | null;
  /** Base32 secret grouped in fours for manual entry. */
  secret: string;
  brand: string;
  email: string;
  /** Where to go once setup is finished (e.g. the page that required 2FA). */
  continueTo?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const t = useT("account");
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [cancelling, startCancel] = useTransition();
  const [state, formAction, pending] = useActionState<ConfirmResult | null, FormData>(async (prev, formData) => {
    const result = await confirmTwoFactorSetupAction(prev, formData);
    if (result.ok) setCodes(result.data.recoveryCodes);
    else setCode("");
    return result;
  }, null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  const cancel = () =>
    startCancel(async () => {
      const result = await cancelTwoFactorSetupAction();
      if (!result.ok) toast.error(result.error);
    });

  const finish = () => {
    setCodes(null);
    toast.success(t("security.setup.done"));
    const target = safeRedirectPath(continueTo);
    if (target) router.push(target);
    else router.refresh();
  };

  return (
    <div className="space-y-6">
      <ol className="space-y-6">
        <li className="grid gap-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-start">
          {qr ? (
            <div className="mx-auto w-44 max-w-full rounded-xl border border-border bg-white p-2 shadow-sm sm:mx-0">{qr}</div>
          ) : (
            <div role="note" className="mx-auto flex w-44 max-w-full items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs text-ink sm:mx-0">
              <Icon.AlertTriangle className="size-4 shrink-0 text-warning" />
              <span>{t("security.setup.noQr")}</span>
            </div>
          )}
          <div className="min-w-0 space-y-3">
            <p className="text-sm font-medium text-ink">
              <span className="me-2 inline-flex size-5 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-fg">1</span>
              {qr ? t("security.setup.scanTitle") : t("security.setup.keyTitle")}
            </p>
            <p className="text-sm text-ink-muted">
              {qr ? t("security.setup.scanBody") : t("security.setup.keyBody")}
            </p>
            <details open={!qr} className="group rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-sm">
              <summary className="cursor-pointer select-none font-medium text-ink marker:text-ink-faint">{t("security.setup.cantScan")}</summary>
              <div className="mt-3 space-y-3">
                <p className="break-all rounded-md bg-surface-1 px-3 py-2 font-mono text-sm tracking-wider text-ink select-all" aria-label={t("security.setup.keyLabel")} dir="ltr">
                  {secret}
                </p>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs text-ink-muted">
                  <dt>{t("security.setup.account")}</dt>
                  <dd className="truncate text-ink">
                    {brand}: {email}
                  </dd>
                  <dt>{t("security.setup.type")}</dt>
                  <dd className="text-ink">{t("security.setup.typeValue")}</dd>
                </dl>
                <CopyButton value={secret.replace(/\s+/g, "")} label={t("security.setup.copyKey")} />
              </div>
            </details>
          </div>
        </li>

        <li className="space-y-3">
          <p className="text-sm font-medium text-ink">
            <span className="me-2 inline-flex size-5 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-fg">2</span>
            {t("security.setup.enterCode")}
          </p>
          <form action={formAction} className="space-y-3" noValidate>
            <FormError message={state && !state.ok ? state.error : null} />
            <div className="max-w-xs">
              <OtpCodeInput id="setup-code" value={code} onChange={setCode} invalid={!!errors.code} autoSubmit disabled={pending} label={t("security.setup.codeLabel")} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" loading={pending} disabled={code.length !== 6} leftIcon={<Icon.ShieldCheck className="size-4" />}>
                {t("security.setup.turnOn")}
              </Button>
              <Button type="button" variant="ghost" onClick={cancel} loading={cancelling} disabled={pending}>
                {t("security.setup.cancel")}
              </Button>
            </div>
          </form>
        </li>
      </ol>

      <RecoveryCodesDialog codes={codes} brand={brand} email={email} onDone={finish} />
    </div>
  );
}
