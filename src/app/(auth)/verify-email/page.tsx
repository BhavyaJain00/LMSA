import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { isEmailVerified, maskEmail } from "@/lib/auth/account-status";
import { verifyEmailWithToken } from "@/lib/auth/verification";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { ResendVerificationButton } from "@/components/security/resend-verification-button";

export const metadata: Metadata = {
  title: "Confirm your email",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

/**
 * Landing page for verification links. Confirming is idempotent: opening a
 * link again (or after an email scanner prefetched it) still shows success
 * for an already-confirmed address.
 */
export default async function VerifyEmailPage(props: PageProps<"/verify-email">) {
  const sp = await props.searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  const [viewer, settings] = await Promise.all([getCurrentUser(), getSettings()]);

  const outcome = token ? await verifyEmailWithToken(token) : ({ status: "invalid" } as const);
  const viewerIsOwner = viewer && "user" in outcome && outcome.user && outcome.user.id === viewer.id;
  const continueHref = viewer ? "/dashboard" : "/login";
  const continueLabel = viewer ? "Continue to your dashboard" : "Log in";

  if (outcome.status === "verified" || outcome.status === "already_verified") {
    return (
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-border bg-surface-1 p-6 text-center shadow-card sm:p-8">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-success/12 text-success">
            <Icon.CheckCircle className="size-6" />
          </span>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-ink">{outcome.status === "verified" ? "Email confirmed" : "Already confirmed"}</h1>
          <p className="mt-2 text-sm text-ink-muted">
            {outcome.status === "verified"
              ? `Thanks! ${maskEmail(outcome.user.email)} is confirmed. You have full access to ${settings.brand.name}.`
              : `${maskEmail(outcome.user.email)} was already confirmed — you're good to go.`}
          </p>
          <div className="mt-6 flex justify-center">
            <ButtonLink href={viewer && !viewerIsOwner ? "/settings/security" : continueHref} rightIcon={<Icon.ArrowRight className="size-4" />}>
              {viewer && !viewerIsOwner ? "Go to your security settings" : continueLabel}
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
        <h1 className="mt-4 text-xl font-semibold tracking-tight text-ink">{expired ? "This link has expired" : "This link isn't valid"}</h1>
        <p className="mt-2 text-sm text-ink-muted">
          {expired
            ? "Confirmation links work for 24 hours. Request a new one and use the newest email."
            : "The link may be incomplete, or a newer confirmation email replaced it. Use the link in the most recent email."}
        </p>
        <div className="mt-6 flex flex-col items-center gap-2">
          {viewerNeedsLink ? (
            <>
              <ResendVerificationButton variant="primary" size="md" label="Send a new link" />
              <ButtonLink href="/settings/security" variant="ghost" size="sm">
                Security settings
              </ButtonLink>
            </>
          ) : viewer ? (
            <ButtonLink href="/dashboard">Continue to your dashboard</ButtonLink>
          ) : (
            <>
              <ButtonLink href="/login?next=%2Fsettings%2Fsecurity">Log in to get a new link</ButtonLink>
              <p className="text-xs text-ink-faint">After logging in, open Settings → Security and choose “Resend confirmation email”.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
