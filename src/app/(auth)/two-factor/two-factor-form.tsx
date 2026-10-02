"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { ActionResult } from "@/lib/types";
import { cancelTwoFactorLoginAction, verifyTwoFactorLoginAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { OtpCodeInput } from "@/components/security/otp-code-input";
import { useT } from "@/i18n/client";

/** Second sign-in step: authenticator code, or a recovery code as fallback. */
export function TwoFactorForm({ next, recoveryAvailable }: { next?: string; recoveryAvailable: boolean }) {
  const [method, setMethod] = useState<"totp" | "recovery">("totp");
  const [code, setCode] = useState("");
  const t = useT("auth");
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(async (prev, formData) => {
    const result = await verifyTwoFactorLoginAction(prev, formData);
    if (!result.ok) setCode("");
    return result;
  }, null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const expired = errors.session === "expired";

  if (expired) {
    return (
      <div className="space-y-4">
        <FormError message={state && !state.ok ? state.error : null} />
        <Link href="/login" className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
          <Icon.ArrowLeft className="size-4 rtl:rotate-180" />
          {t("links.backToLogin")}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <form action={action} className="space-y-4" noValidate>
        {next && <input type="hidden" name="next" value={next} />}
        <input type="hidden" name="method" value={method} />
        <FormError message={state && !state.ok ? state.error : null} />
        {method === "totp" ? (
          <Field label={t("twoFactor.codeLabel")} htmlFor="code" error={errors.code} hint={t("twoFactor.codeHint")}>
            <OtpCodeInput id="code" value={code} onChange={setCode} invalid={!!errors.code} autoFocus autoSubmit disabled={pending} label={t("twoFactor.codeLabel")} />
          </Field>
        ) : (
          <Field label={t("twoFactor.recoveryLabel")} htmlFor="recoveryCode" error={errors.recoveryCode} hint={t("twoFactor.recoveryHint")}>
            <Input
              id="recoveryCode"
              name="recoveryCode"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              dir="ltr"
              placeholder="xxxxx-xxxxx"
              className="h-12 text-center font-mono text-lg tracking-widest"
              invalid={!!errors.recoveryCode}
            />
          </Field>
        )}
        <Button type="submit" className="w-full" size="lg" loading={pending} disabled={method === "totp" && code.length !== 6}>
          {t("twoFactor.submit")}
        </Button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4 text-sm">
        {recoveryAvailable || method === "recovery" ? (
          <button
            type="button"
            className="font-medium text-accent hover:underline"
            onClick={() => {
              setMethod((m) => (m === "totp" ? "recovery" : "totp"));
              setCode("");
            }}
          >
            {method === "totp" ? t("twoFactor.useRecovery") : t("twoFactor.useApp")}
          </button>
        ) : (
          <span className="text-xs text-ink-muted">{t("twoFactor.lostPhone")}</span>
        )}
        <form action={cancelTwoFactorLoginAction}>
          <button type="submit" className="font-medium text-ink-muted hover:text-ink">
            {t("twoFactor.cancel")}
          </button>
        </form>
      </div>
    </div>
  );
}
