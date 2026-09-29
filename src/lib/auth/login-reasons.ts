/**
 * Reasons recorded on `LoginEvent.reason`, with display labels and tones.
 * Pure constants so both server pages and client filters can use them.
 */

export type LoginEventTone = "success" | "info" | "warning" | "danger";

export interface LoginReasonInfo {
  label: string;
  tone: LoginEventTone;
  /** Whether the attempt ended with a signed-in session. */
  signedIn: boolean;
}

export const LOGIN_EVENT_REASONS = {
  ok: { label: "Signed in", tone: "success", signedIn: true },
  signup: { label: "Account created", tone: "success", signedIn: true },
  "2fa_ok": { label: "Signed in with authenticator code", tone: "success", signedIn: true },
  recovery_code: { label: "Signed in with a recovery code", tone: "warning", signedIn: true },
  password_reset: { label: "Signed in after resetting password", tone: "info", signedIn: true },
  "2fa_challenge": { label: "Password accepted, waiting for code", tone: "info", signedIn: false },
  bad_password: { label: "Wrong password", tone: "danger", signedIn: false },
  unknown_email: { label: "No account with this email", tone: "danger", signedIn: false },
  lockout: { label: "Wrong password — account locked", tone: "danger", signedIn: false },
  locked: { label: "Blocked: account temporarily locked", tone: "danger", signedIn: false },
  disabled: { label: "Blocked: account disabled", tone: "danger", signedIn: false },
  rate_limited: { label: "Blocked: too many attempts", tone: "danger", signedIn: false },
  "2fa_failed": { label: "Wrong verification code", tone: "danger", signedIn: false },
  "2fa_lockout": { label: "Wrong verification code — account locked", tone: "danger", signedIn: false },
} as const satisfies Record<string, LoginReasonInfo>;

export type LoginEventReason = keyof typeof LOGIN_EVENT_REASONS;

export const LOGIN_EVENT_REASON_KEYS = Object.keys(LOGIN_EVENT_REASONS) as LoginEventReason[];

export function isLoginEventReason(value: unknown): value is LoginEventReason {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(LOGIN_EVENT_REASONS, value);
}

/** Display info for a stored reason (older or unknown values fall back gracefully). */
export function describeLoginReason(reason: string | undefined, success: boolean): LoginReasonInfo {
  if (isLoginEventReason(reason)) return LOGIN_EVENT_REASONS[reason];
  return success ? { label: "Signed in", tone: "success", signedIn: true } : { label: reason ? reason.replace(/_/g, " ") : "Failed sign-in", tone: "danger", signedIn: false };
}
