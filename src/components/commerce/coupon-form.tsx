"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { useT } from "@/i18n/client";

/**
 * Coupon box on the checkout page. The coupon is carried in the URL
 * (`?coupon=CODE`) so the server recomputes and validates the summary.
 * `keep` is a query string of other checkout choices to carry along
 * (e.g. "pay=installments").
 */
export function CouponForm({ basePath, appliedCode, error, submittedCode, keep = "" }: { basePath: string; appliedCode: string | null; error: string | null; submittedCode: string; keep?: string }) {
  const router = useRouter();
  const t = useT("account");
  const [code, setCode] = useState(appliedCode ?? submittedCode);
  const [localError, setLocalError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const apply = () => {
    const value = code.trim().toUpperCase();
    if (!value) {
      setLocalError(t("commerce.coupon.empty"));
      return;
    }
    setLocalError(null);
    const query = new URLSearchParams(keep);
    query.set("coupon", value);
    startTransition(() => router.replace(`${basePath}?${query}`, { scroll: false }));
  };

  const remove = () => {
    setCode("");
    setLocalError(null);
    startTransition(() => router.replace(keep ? `${basePath}?${keep}` : basePath, { scroll: false }));
  };

  const shownError = localError ?? (appliedCode ? null : error);

  return (
    <section aria-label={t("commerce.coupon.label")} className="rounded-card border border-border bg-surface-2 p-5">
      <label htmlFor="coupon-code" className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        {t("commerce.coupon.enter")}
      </label>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!appliedCode) apply();
        }}
      >
        <Input
          id="coupon-code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s+/g, ""))}
          placeholder="COUPON2025"
          disabled={!!appliedCode || pending}
          invalid={!!shownError}
          maxLength={32}
          autoComplete="off"
          spellCheck={false}
          className="font-mono uppercase tracking-wide"
          dir="ltr"
          aria-describedby={shownError ? "coupon-error" : appliedCode ? "coupon-applied" : undefined}
        />
        {appliedCode ? (
          <IconButton label={t("commerce.coupon.remove")} variant="outline" onClick={remove} disabled={pending}>
            <Icon.X className="size-4" />
          </IconButton>
        ) : (
          <Button type="submit" variant="outline" loading={pending}>
            {t("commerce.coupon.apply")}
          </Button>
        )}
      </form>
      {shownError && (
        <p id="coupon-error" role="alert" className="mt-2 text-xs text-danger">
          {shownError}
        </p>
      )}
      {appliedCode && (
        <p id="coupon-applied" className="mt-2 flex items-center gap-1.5 text-xs font-medium text-success">
          <Icon.CheckCircle className="size-4" />
          {t("commerce.coupon.applied", { code: appliedCode })}
        </p>
      )}
    </section>
  );
}
