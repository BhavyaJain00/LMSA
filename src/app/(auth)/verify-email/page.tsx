import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { isEmailVerified, maskEmail } from "@/lib/auth/account-status";
import { verifyEmailWithToken } from "@/lib/auth/verification";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { ResendVerificationButton } from "@/components/security/resend-verification-button";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("auth");
  return {
    title: t("verify.metaTitle"),
    referrer: "no-referrer",
    robots: { index: false, follow: false },
  };
}

/**
 * Landing page for verification links. Confirming is idempotent: opening a
 * link again (or after an email scanner prefetched it) still shows success
 * for an already-confirmed address.
 */
export default async function VerifyEmailPage(props: PageProps<"/verify-email">) {
  const sp = await props.searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  const [viewer, settings, t] = await Promise.all([getCurrentUser(), getSettings(), getT("auth")]);

  const outcome = token ? await verifyEmailWithToken(token) : ({ status: "invalid" } as const);
  const viewerIsOwner = viewer && "user" in outcome && outcome.user && outcome.user.id === viewer.id;
  const continueHref = viewer ? "/dashboard" : "/login";
  const continueLabel = viewer ? t("verify.continueToDashboard") : t("links.logIn");

  if (outcome.status === "verified" || outcome.status === "already_verified") {
    const email = maskEmail(outcome.user.email);
    return (
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-border bg-surface-1 p-6 text-center shadow-card sm:p-8">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-success/12 text-success">
            <Icon.CheckCircle className="size-6" />
          </span>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-ink">{outcome.status === "verified" ? t("verify.confirmedTitle") : t("verify.alreadyTitle")}</h1>
          <p className="mt-2 text-sm text-ink-muted">
            {outcome.status === "verified" ? t("verify.confirmedBody", { email, brand: settings.brand.name }) : t("verify.alreadyBody", { email })}
          </p>
          <div className="mt-6 flex justify-center">
            <ButtonLink href={viewer && !viewerIsOwner ? "/settings/security" : continueHref} rightIcon={<Icon.ArrowRight className="size-4 rtl:rotate-180" />}>
              {viewer && !viewerIsOwner ? t("verify.goToSecurity") : continueLabel}
            </ButtonLink>
          </div>
        </div>
      </div>
    );
  }

  const expired = outcome.status === "expired";
  const viewerNeedsLink = viewer && !isEmailVerified(viewer);
  return (
    <div className="w-full max-w-md">
      <div className="rounded-2xl border border-border bg-surface-1 p-6 text-center shadow-card sm:p-8">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-warning/15 text-warning">
          <Icon.AlertTriangle className="size-6" />
        </span>
        <h1 className="mt-4 text-xl font-semibold tracking-tight text-ink">{expired ? t("verify.expiredTitle") : t("verify.invalidTitle")}</h1>
        <p className="mt-2 text-sm text-ink-muted">{expired ? t("verify.expiredBody") : t("verify.invalidBody")}</p>
        <div className="mt-6 flex flex-col items-center gap-2">
          {viewerNeedsLink ? (
            <>
              <ResendVerificationButton variant="primary" size="md" label={t("verify.sendNew")} />
              <ButtonLink href="/settings/security" variant="ghost" size="sm">
                {t("verify.securitySettings")}
              </ButtonLink>
            </>
          ) : viewer ? (
            <ButtonLink href="/dashboard">{t("verify.continueToDashboard")}</ButtonLink>
          ) : (
            <>
              <ButtonLink href="/login?next=%2Fsettings%2Fsecurity">{t("verify.loginForNew")}</ButtonLink>
              <p className="text-xs text-ink-faint">{t("verify.afterLogin")}</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
