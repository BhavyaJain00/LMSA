import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { isEmailVerified, maskEmail, mustSetUpTwoFactor } from "@/lib/auth/account-status";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { ResendVerificationButton } from "./resend-verification-button";

/**
 * App-wide account notice, rendered above page content:
 *  - "Confirm your email" when `requireEmailVerification` is on and the member
 *    hasn't verified (enrolling and purchasing are blocked until they do);
 *  - "Set up two-step verification" for staff when the platform requires it.
 * Renders nothing for guests and for members with nothing to do.
 */
export async function AccountSecurityBanner({ className }: { className?: string }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const settings = await getSettings();

  if (settings.security.requireEmailVerification && !isEmailVerified(user)) {
    return (
      <div
        role="status"
        className={cn("mb-5 flex flex-col gap-3 rounded-card border border-warning/30 bg-warning/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between", className)}
      >
        <div className="flex min-w-0 items-start gap-3">
          <Icon.Mail className="mt-0.5 size-5 shrink-0 text-warning" />
          <div className="min-w-0 text-sm">
            <p className="font-medium text-ink">Confirm your email address</p>
            <p className="text-ink-muted">
              We sent a link to <span className="font-medium text-ink">{maskEmail(user.email)}</span>. You&apos;ll be able to enroll in courses and make purchases once it&apos;s
              confirmed.
            </p>
          </div>
        </div>
        <div className="shrink-0 pl-8 sm:pl-0">
          <ResendVerificationButton />
        </div>
      </div>
    );
  }

  if (mustSetUpTwoFactor(user, settings.security)) {
    return (
      <div
        role="status"
        className={cn("mb-5 flex flex-col gap-3 rounded-card border border-accent/30 bg-accent/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between", className)}
      >
        <div className="flex min-w-0 items-start gap-3">
          <Icon.ShieldCheck className="mt-0.5 size-5 shrink-0 text-accent" />
          <div className="min-w-0 text-sm">
            <p className="font-medium text-ink">Two-step verification is required for your role</p>
            <p className="text-ink-muted">Set it up to keep using admin and teaching tools.</p>
          </div>
        </div>
        <Link href="/settings/security?required=2fa" className="shrink-0 pl-8 text-sm font-medium text-accent hover:underline sm:pl-0">
          Set it up now →
        </Link>
      </div>
    );
  }

  return null;
}
