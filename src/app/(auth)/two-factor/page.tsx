import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { safeRedirectPath } from "@/lib/auth/redirects";
import { getSettings } from "@/lib/db/store";
import { checkAuthToken } from "@/lib/auth/tokens";
import { readTwoFactorChallengeCookie } from "@/lib/auth/two-factor";
import { maskEmail } from "@/lib/auth/account-status";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { getT } from "@/i18n/server";
import { TwoFactorForm } from "./two-factor-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("auth");
  return {
    title: t("twoFactor.metaTitle"),
    robots: { index: false, follow: false },
  };
}

export default async function TwoFactorPage(props: PageProps<"/two-factor">) {
  const sp = await props.searchParams;
  const next = safeRedirectPath(sp.next, undefined);
  const [viewer, raw, settings, t] = await Promise.all([getCurrentUser(), readTwoFactorChallengeCookie(), getSettings(), getT("auth")]);
  const check = await checkAuthToken(raw, "two_factor_login");

  if (check.status !== "valid") {
    if (viewer) redirect(next ?? "/dashboard");
    return (
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-border bg-surface-1 p-6 text-center shadow-card sm:p-8">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-warning/15 text-warning">
            <Icon.Clock className="size-6" />
          </span>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-ink">{t("twoFactor.expiredTitle")}</h1>
          <p className="mt-2 text-sm text-ink-muted">{t("twoFactor.expiredBody")}</p>
          <div className="mt-6 flex justify-center">
            <ButtonLink href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}>{t("links.backToLogin")}</ButtonLink>
          </div>
        </div>
      </div>
    );
  }

  const recoveryAvailable = (check.user.recoveryCodeHashes?.length ?? 0) > 0;

  return (
    <div className="w-full max-w-md">
      <div className="rounded-2xl border border-border bg-surface-1 p-6 shadow-card sm:p-8">
        <span className="flex size-11 items-center justify-center rounded-xl bg-accent/12 text-accent">
          <Icon.ShieldCheck className="size-6" />
        </span>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink">{t("twoFactor.title")}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {t.rich("twoFactor.subtitle", {
            brand: settings.brand.name,
            email: maskEmail(check.user.email),
            b: (text) => (
              <span className="font-medium text-ink" dir="ltr">
                {text}
              </span>
            ),
          })}
        </p>
        <div className="mt-6">
          <TwoFactorForm next={next} recoveryAvailable={recoveryAvailable} />
        </div>
      </div>
    </div>
  );
}
