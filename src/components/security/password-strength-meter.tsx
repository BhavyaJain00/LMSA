"use client";

import { passwordRequirements, passwordStrength } from "@/lib/auth/password-policy";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

const BAR_TONE = ["bg-danger", "bg-danger", "bg-warning", "bg-success", "bg-success"] as const;
const TEXT_TONE = ["text-danger", "text-danger", "text-warning", "text-success", "text-success"] as const;

/**
 * Live strength meter + policy checklist for a new password. `context` holds
 * personal words (name, email) that make a password easier to guess.
 */
export function PasswordStrengthMeter({
  password,
  minLength,
  context = [],
  id,
  className,
}: {
  password: string;
  minLength: number;
  context?: string[];
  id?: string;
  className?: string;
}) {
  const strength = passwordStrength(password, minLength, context);
  const requirements = passwordRequirements(password, minLength);
  const filled = password ? Math.max(1, strength.score) : 0;

  return (
    <div id={id} className={cn("mt-2 space-y-2", className)}>
      <div className="flex gap-1" aria-hidden="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <span key={i} className={cn("h-1.5 flex-1 rounded-full transition-colors", i < filled ? BAR_TONE[strength.score] : "bg-surface-3")} />
        ))}
      </div>
      <p className="text-xs text-ink-muted" aria-live="polite">
        {password ? (
          <>
            Strength: <span className={cn("font-medium", TEXT_TONE[strength.score])}>{strength.label}</span>
            {strength.suggestions[0] && <span className="text-ink-faint"> · {strength.suggestions[0]}</span>}
          </>
        ) : (
          "Use a long passphrase — length matters more than symbols."
        )}
      </p>
      <ul className="grid gap-1 text-xs sm:grid-cols-3" aria-label="Password requirements">
        {requirements.map((r) => (
          <li key={r.id} className={cn("flex items-center gap-1.5", r.met ? "text-success" : "text-ink-muted")}>
            {r.met ? <Icon.CheckCircle className="size-3.5 shrink-0" /> : <Icon.Circle className="size-3.5 shrink-0" />}
            <span>
              {r.label}
              <span className="sr-only">{r.met ? " (met)" : " (not met yet)"}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
