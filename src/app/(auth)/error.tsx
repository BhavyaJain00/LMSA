"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { useT } from "@/i18n/client";

/** Error boundary for the sign-in, sign-up and account-recovery screens. */
export default function AuthError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT("auth");
  const common = useT("common");
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="w-full max-w-md">
      <div role="alert" className="rounded-2xl border border-border bg-surface-1 p-6 text-center shadow-card sm:p-8">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-danger/10 text-danger">
          <Icon.AlertTriangle className="size-6" />
        </span>
        <h1 className="mt-4 text-xl font-semibold tracking-tight text-ink">{t("error.title")}</h1>
        <p className="mt-2 text-sm text-ink-muted">{t("error.body")}</p>
        {error.digest && (
          <p className="mt-2 font-mono text-xs text-ink-faint" dir="ltr">
            {common("errors.reference", { digest: error.digest })}
          </p>
        )}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button onClick={reset} leftIcon={<Icon.Refresh className="size-4" />}>
            {common("actions.tryAgain")}
          </Button>
          <ButtonLink href="/login" variant="outline">
            {t("links.backToLogin")}
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
