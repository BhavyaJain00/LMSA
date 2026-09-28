"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";

/**
 * Coupon box on the checkout page. The coupon is carried in the URL
 * (`?coupon=CODE`) so the server recomputes and validates the summary.
 */
export function CouponForm({ basePath, appliedCode, error, submittedCode }: { basePath: string; appliedCode: string | null; error: string | null; submittedCode: string }) {
  const router = useRouter();
  const [code, setCode] = useState(appliedCode ?? submittedCode);
  const [localError, setLocalError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const apply = () => {
    const value = code.trim().toUpperCase();
    if (!value) {
      setLocalError("Please enter a coupon code");
      return;
    }
    setLocalError(null);
    startTransition(() => router.replace(`${basePath}?coupon=${encodeURIComponent(value)}`, { scroll: false }));
  };

  const remove = () => {
    setCode("");
    setLocalError(null);
    startTransition(() => router.replace(basePath, { scroll: false }));
  };

  const shownError = localError ?? (appliedCode ? null : error);

  return (
    <section aria-label="Coupon" className="rounded-card border border-border bg-surface-2 p-5">
      <label htmlFor="coupon-code" className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        Enter a coupon code:
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
          aria-describedby={shownError ? "coupon-error" : appliedCode ? "coupon-applied" : undefined}
        />
        {appliedCode ? (
          <IconButton label="Remove coupon" variant="outline" onClick={remove} disabled={pending}>
            <Icon.X className="size-4" />
          </IconButton>
        ) : (
          <Button type="submit" variant="outline" loading={pending}>
            Apply
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
          Coupon {appliedCode} applied
        </p>
      )}
    </section>
  );
}
