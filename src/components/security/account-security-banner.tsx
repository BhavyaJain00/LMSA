import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { isEmailVerified, maskEmail, mustSetUpTwoFactor } from "@/lib/auth/account-status";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { ResendVerificationButton } from "./resend-verification-button";
import { getT } from "@/i18n/server";

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
  const [settings, t] = await Promise.all([getSettings(), getT("account")]);

  if (settings.security.requireEmailVerification && !isEmailVerified(user)) {
    return (
      <div
        role="status"
        className={cn("mb-5 flex flex-col gap-3 rounded-card border border-warning/30 bg-warning/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between", className)}
      >
        <div className="flex min-w-0 items-start gap-3">
          <Icon.Mail className="mt-0.5 size-5 shrink-0 text-warning" />
          <div className="min-w-0 text-sm">
            <p className="font-medium text-ink">{t("security.banner.confirmTitle")}</p>
            <p className="text-ink-muted">
              {t.rich("security.banner.confirmBody", {
                email: maskEmail(user.email),
                b: (text) => (
                  <span className="font-medium text-ink" dir="ltr">
                    {text}
                  </span>
                ),
              })}
            </p>
          </div>
        </div>
        <div className="shrink-0 ps-8 sm:ps-0">
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
            <p className="font-medium text-ink">{t("security.banner.twoFactorTitle")}</p>
            <p className="text-ink-muted">{t("security.banner.twoFactorBody")}</p>
          </div>
        </div>
        <Link href="/settings/security?required=2fa" className="inline-flex shrink-0 items-center gap-1 ps-8 text-sm font-medium text-accent hover:underline sm:ps-0">
          {t("security.banner.setUp")}
          <Icon.ArrowRight className="size-4 rtl:rotate-180" aria-hidden="true" />
        </Link>
      </div>
    );
  }

  return null;
}
