import type { Metadata } from "next";
import Link from "next/link";
import { getSettings } from "@/lib/db/store";
import { checkAuthToken } from "@/lib/auth/tokens";
import { clampMinLength } from "@/lib/auth/password-policy";
import { maskEmail } from "@/lib/auth/account-status";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
  title: "Choose a new password",
  // The token is in the URL: never leak it through the Referer header.
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function ResetPasswordPage(props: PageProps<"/reset-password">) {
  const sp = await props.searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  const [check, settings] = await Promise.all([checkAuthToken(token, "password_reset"), getSettings()]);

  if (check.status !== "valid") {
    const heading = check.status === "used" ? "This link was already used" : check.status === "expired" ? "This link has expired" : "This link isn't valid";
    const body =
      check.status === "used"
        ? "Each reset link works once. If you still need to change your password, request a new link."
        : check.status === "expired"
          ? "Reset links expire after 1 hour to keep your account safe. Request a new one below."
          : "The link may be incomplete or it was replaced by a newer one. Make sure you opened the latest email, or request a new link.";
    return (
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-border bg-surface-1 p-6 text-center shadow-card sm:p-8">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-warning/15 text-warning">
            <Icon.AlertTriangle className="size-6" />
          </span>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-ink">{heading}</h1>
          <p className="mt-2 text-sm text-ink-muted">{body}</p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <ButtonLink href="/forgot-password">Request a new link</ButtonLink>
            <ButtonLink href="/login" variant="outline">
              Back to log in
            </ButtonLink>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md">
      <div className="rounded-2xl border border-border bg-surface-1 p-6 shadow-card sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Choose a new password</h1>
        <p className="mt-1 text-sm text-ink-muted">
          For your {settings.brand.name} account <span className="font-medium text-ink">{maskEmail(check.user.email)}</span>.
        </p>
        <div className="mt-6">
          <ResetPasswordForm token={token} email={check.user.email} name={check.user.name} minLength={clampMinLength(settings.security.passwordMinLength)} />
        </div>
      </div>
      <p className="mt-4 text-center text-sm text-ink-muted">
        <Link href="/login" className="font-medium text-accent hover:underline">
          Back to log in
        </Link>
      </p>
    </div>
  );
}
