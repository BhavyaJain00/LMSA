import type { Metadata } from "next";
import Link from "next/link";
import { getSettings } from "@/lib/db/store";
import { checkAuthToken } from "@/lib/auth/tokens";
import { clampMinLength } from "@/lib/auth/password-policy";
import { maskEmail } from "@/lib/auth/account-status";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { getT } from "@/i18n/server";
import { ResetPasswordForm } from "./reset-password-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("auth");
  return {
    title: t("reset.metaTitle"),
    // The token is in the URL: never leak it through the Referer header.
    referrer: "no-referrer",
    robots: { index: false, follow: false },
  };
}

export default async function ResetPasswordPage(props: PageProps<"/reset-password">) {
  const sp = await props.searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  const [check, settings, t] = await Promise.all([checkAuthToken(token, "password_reset"), getSettings(), getT("auth")]);

  if (check.status !== "valid") {
    const heading = check.status === "used" ? t("reset.usedTitle") : check.status === "expired" ? t("reset.expiredTitle") : t("reset.invalidTitle");
    const body = check.status === "used" ? t("reset.usedBody") : check.status === "expired" ? t("reset.expiredBody") : t("reset.invalidBody");
    return (
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-border bg-surface-1 p-6 text-center shadow-card sm:p-8">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-warning/15 text-warning">
            <Icon.AlertTriangle className="size-6" />
          </span>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-ink">{heading}</h1>
          <p className="mt-2 text-sm text-ink-muted">{body}</p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <ButtonLink href="/forgot-password">{t("reset.requestNew")}</ButtonLink>
            <ButtonLink href="/login" variant="outline">
              {t("links.backToLogin")}
            </ButtonLink>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md">
      <div className="rounded-2xl border border-border bg-surface-1 p-6 shadow-card sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t("reset.title")}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {t.rich("reset.subtitle", {
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
          <ResetPasswordForm token={token} email={check.user.email} name={check.user.name} minLength={clampMinLength(settings.security.passwordMinLength)} />
        </div>
      </div>
      <p className="mt-4 text-center text-sm text-ink-muted">
        <Link href="/login" className="font-medium text-accent hover:underline">
          {t("links.backToLogin")}
        </Link>
      </p>
    </div>
  );
}
