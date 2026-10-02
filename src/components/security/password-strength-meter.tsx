"use client";

import { passwordRequirements, passwordStrength } from "@/lib/auth/password-policy";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n/catalog";

type Key = MessageKey<"account">;

/** Strength labels by score (0–4), matching `passwordStrength`. */
const LEVEL_KEYS: Key[] = [
  "global.password.level.tooWeak",
  "global.password.level.weak",
  "global.password.level.fair",
  "global.password.level.good",
  "global.password.level.strong",
];

/** The English suggestions `passwordStrength` returns, mapped to messages. */
const TIP_KEYS: Record<string, Key> = {
  "Avoid common passwords and predictable words.": "global.password.tip.common",
  "Don't include your name or email.": "global.password.tip.personal",
  "Avoid repeated characters and sequences like “abc” or “123”.": "global.password.tip.sequences",
  "Longer is stronger — try a passphrase of three or four words.": "global.password.tip.longer",
  "Mix in capitals or symbols.": "global.password.tip.mix",
};

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
  const t = useT("account");
  const strength = passwordStrength(password, minLength, context);
  const tip = strength.suggestions[0];
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
            {t.rich("global.password.strength", {
              label: LEVEL_KEYS[strength.score] ? t(LEVEL_KEYS[strength.score]!) : strength.label,
              tone: (text) => <span className={cn("font-medium", TEXT_TONE[strength.score])}>{text}</span>,
            })}
            {tip && <span className="text-ink-faint"> · {TIP_KEYS[tip] ? t(TIP_KEYS[tip]!) : tip}</span>}
          </>
        ) : (
          t("global.password.hint")
        )}
      </p>
      <ul className="grid gap-1 text-xs sm:grid-cols-3" aria-label={t("global.password.requirements")}>
        {requirements.map((r) => (
          <li key={r.id} className={cn("flex items-center gap-1.5", r.met ? "text-success" : "text-ink-muted")}>
            {r.met ? <Icon.CheckCircle className="size-3.5 shrink-0" /> : <Icon.Circle className="size-3.5 shrink-0" />}
            <span>
              {r.id === "length" ? t("global.password.req.length", { count: minLength }) : t(`global.password.req.${r.id}`)}
              <span className="sr-only"> {r.met ? t("global.password.met") : t("global.password.notMet")}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
