import type { LoginEventReason } from "@/lib/auth/login-reasons";
import type { MessageKey } from "@/i18n/catalog";

/** Message keys for the stored login-event reasons (labels in `LOGIN_EVENT_REASONS` stay English for logs and exports). */
export const LOGIN_REASON_KEYS: Record<LoginEventReason, MessageKey<"account">> = {
  ok: "security.reason.ok",
  signup: "security.reason.signup",
  "2fa_ok": "security.reason.twoFactorOk",
  recovery_code: "security.reason.recoveryCode",
  password_reset: "security.reason.passwordReset",
  "2fa_challenge": "security.reason.twoFactorChallenge",
  bad_password: "security.reason.badPassword",
  unknown_email: "security.reason.unknownEmail",
  lockout: "security.reason.lockout",
  locked: "security.reason.locked",
  disabled: "security.reason.disabled",
  rate_limited: "security.reason.rateLimited",
  "2fa_failed": "security.reason.twoFactorFailed",
  "2fa_lockout": "security.reason.twoFactorLockout",
};
