import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { checkAuthToken } from "@/lib/auth/tokens";
import { readTwoFactorChallengeCookie } from "@/lib/auth/two-factor";
import { maskEmail } from "@/lib/auth/account-status";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { TwoFactorForm } from "./two-factor-form";

export const metadata: Metadata = {
  title: "Two-step verification",
  robots: { index: false, follow: false },
};

export default async function TwoFactorPage(props: PageProps<"/two-factor">) {
  const sp = await props.searchParams;
  const next = typeof sp.next === "string" && sp.next.startsWith("/") && !sp.next.startsWith("//") && !sp.next.startsWith("/\\") ? sp.next : undefined;
  const [viewer, raw, settings] = await Promise.all([getCurrentUser(), readTwoFactorChallengeCookie(), getSettings()]);
  const check = await checkAuthToken(raw, "two_factor_login");

  if (check.status !== "valid") {
    if (viewer) redirect(next ?? "/dashboard");
    return (
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-border bg-surface-1 p-6 text-center shadow-card sm:p-8">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-warning/15 text-warning">
            <Icon.Clock className="size-6" />
          </span>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-ink">Your sign-in attempt expired</h1>
          <p className="mt-2 text-sm text-ink-muted">For your security, the verification step times out after 10 minutes. Log in again to continue.</p>
          <div className="mt-6 flex justify-center">
            <ButtonLink href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}>Back to log in</ButtonLink>
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
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink">Two-step verification</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Signing in to {settings.brand.name} as <span className="font-medium text-ink">{maskEmail(check.user.email)}</span>.
        </p>
        <div className="mt-6">
          <TwoFactorForm next={next} recoveryAvailable={recoveryAvailable} />
        </div>
      </div>
    </div>
  );
}
