"use client";

import { useRef, type ChangeEvent } from "react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";

/**
 * One-time code field: numeric keyboard on phones, `one-time-code` autofill,
 * large monospace digits, and optional auto-submit once 6 digits are typed.
 */
export function OtpCodeInput({
  id,
  name = "code",
  value,
  onChange,
  invalid,
  autoFocus,
  autoSubmit = false,
  disabled,
  describedBy,
  label,
}: {
  id: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  autoFocus?: boolean;
  /** Submit the enclosing form as soon as 6 digits are entered. */
  autoSubmit?: boolean;
  disabled?: boolean;
  describedBy?: string;
  label?: string;
}) {
  const t = useT("account");
  const ref = useRef<HTMLInputElement>(null);
  const submitted = useRef<string | null>(null);

  const handle = (e: ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
    onChange(digits);
    if (digits.length < 6) submitted.current = null;
    if (autoSubmit && digits.length === 6 && submitted.current !== digits) {
      submitted.current = digits;
      // Let React commit the value before submitting.
      requestAnimationFrame(() => ref.current?.form?.requestSubmit());
    }
  };

  return (
    <input
      ref={ref}
      id={id}
      name={name}
      value={value}
      onChange={handle}
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]{6}"
      maxLength={6}
      placeholder="000000"
      aria-label={label ?? t("global.otp.label")}
      dir="ltr"
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      autoFocus={autoFocus}
      disabled={disabled}
      className={cn(
        "h-12 w-full rounded-lg border border-border-strong bg-surface-1 px-3 text-center font-mono text-2xl tracking-[0.5em] text-ink placeholder:text-ink-faint/60 transition-colors",
        "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-60",
        "aria-invalid:border-danger aria-invalid:focus:ring-danger/25",
      )}
    />
  );
}
