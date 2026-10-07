import type { MessageKey } from "@/i18n/catalog";
import type { Translator } from "@/i18n/translate";
import { waitAmount } from "./account-status";
import { passwordPolicyIssue } from "./password-policy";

/**
 * Wording for the messages the sign-in, sign-up and password Server Actions
 * return, in the reader's language (`auth` namespace). Pure: the actions pass
 * in `await getT("auth")`, and tests pass a translator for any locale.
 */

export type AuthTranslator = Translator<MessageKey<"auth">>;

/** What was attempted too often, for the rate-limit message. */
export type RateLimitedAction = "signIn" | "verification" | "signUp" | "reset" | "attempts";

const RATE_LIMIT_KEYS = {
  signIn: "errors.rateLimited.signIn",
  verification: "errors.rateLimited.verification",
  signUp: "errors.rateLimited.signUp",
  reset: "errors.rateLimited.reset",
  attempts: "errors.rateLimited.attempts",
} as const satisfies Record<RateLimitedAction, MessageKey<"auth">>;

/** "a few seconds", "3 minutes", "1 hour" in the reader's language (same rounding as `formatWait`). */
export function waitText(t: AuthTranslator, ms: number): string {
  const wait = waitAmount(ms);
  if (wait.unit === "seconds") return t("wait.seconds");
  return t(wait.unit === "minutes" ? "wait.minutes" : "wait.hours", { count: wait.count });
}

/** The account is locked after too many failures. */
export function lockedText(t: AuthTranslator, remainingMs: number): string {
  return t("errors.locked", { wait: waitText(t, remainingMs) });
}

/** A rate limit was hit; waits for the longest of the blocked limits (at least a second). */
export function rateLimitedText(t: AuthTranslator, retryAfterMs: readonly number[], what: RateLimitedAction): string {
  const wait = Math.max(...retryAfterMs, 1000);
  return t(RATE_LIMIT_KEYS[what], { wait: waitText(t, wait) });
}

/** Why the password breaks the policy, or null when it meets it. */
export function passwordPolicyText(t: AuthTranslator, password: string, minLength: number): string | null {
  const issue = passwordPolicyIssue(password, minLength);
  if (!issue) return null;
  if (issue.code === "too_short") return t("password.tooShort", { min: issue.min });
  if (issue.code === "too_long") return t("password.tooLong", { max: issue.max });
  return t("password.lettersAndNumbers");
}
