import Link from "next/link";
import type { ReactNode } from "react";
import type { Session, User } from "@/lib/types";
import { getCurrentSessionTokenHash, requireUser } from "@/lib/auth/session";
import { filter, getSettings } from "@/lib/db/store";
import { hasPendingTwoFactorSetup, isEmailVerified, isTwoFactorActive, mustSetUpTwoFactor } from "@/lib/auth/account-status";
import { getLoginEventsForUser } from "@/lib/auth/login-events";
import { openTotpSecret, otpauthUriFor } from "@/lib/auth/two-factor";
import { formatSecretForDisplay } from "@/lib/auth/totp";
import { safeRedirectPath } from "@/lib/auth/redirects";
import { tryEncodeQr } from "@/lib/qr";
import { describeUserAgent } from "@/lib/auth/user-agent";
import { clampMinLength } from "@/lib/auth/password-policy";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { LoginActivityList } from "@/components/security/login-activity-list";
import { QrCode } from "@/components/security/qr-code";
import { ResendVerificationButton } from "@/components/security/resend-verification-button";
import { SecuritySessions, type SecuritySessionRow } from "@/components/security/security-sessions";
import { StartTwoFactorButton, TwoFactorSetup } from "@/components/security/two-factor-setup";
import { TwoFactorManage } from "@/components/security/two-factor-manage";
import { cn, formatDate, formatDateTime, relativeTime } from "@/lib/utils";

export const metadata = { title: "Security" };

async function sessionRows(user: User): Promise<SecuritySessionRow[]> {
  const now = Date.now();
  const current = await getCurrentSessionTokenHash();
  const rows: Session[] = await filter("sessions", (s) => s.userId === user.id && new Date(s.expiresAt).getTime() > now);
  return rows
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((s) => {
      const ua = describeUserAgent(s.userAgent);
      return {
        id: s.id,
        device: ua.label,
        kind: ua.kind,
        signedInLabel: relativeTime(s.createdAt),
        signedInTitle: formatDateTime(s.createdAt),
        expiresLabel: formatDate(s.expiresAt),
        current: s.tokenHash === current,
      };
    })
    .sort((a, b) => Number(b.current) - Number(a.current));
}

function CheckItem({ ok, label, detail }: { ok: boolean; label: string; detail: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full", ok ? "bg-success/12 text-success" : "bg-warning/15 text-warning")}>
        {ok ? <Icon.Check className="size-3.5" /> : <Icon.AlertTriangle className="size-3.5" />}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{label}</p>
        <p className="text-xs text-ink-muted">{detail}</p>
      </div>
    </li>
  );
}

export default async function SecuritySettingsPage(props: PageProps<"/settings/security">) {
  const user = await requireUser("/settings/security");
  const sp = await props.searchParams;
  const settings = await getSettings();
  const next = safeRedirectPath(sp.next, undefined);
  const requiredNow = mustSetUpTwoFactor(user, settings.security);

  const verified = isEmailVerified(user);
  const twoFactorOn = isTwoFactorActive(user);
  const pendingSetup = hasPendingTwoFactorSetup(user);
  const recoveryLeft = user.recoveryCodeHashes?.length ?? 0;
  const brand = settings.brand.name;

  const [events, sessions] = await Promise.all([getLoginEventsForUser(user.id, 20), sessionRows(user)]);
  const lastSignIn = events.find((e) => e.success);

  // Setup material is only derived while a setup is pending.
  const pendingSecret = pendingSetup ? openTotpSecret(user) : null;
  const otpauth = pendingSecret ? otpauthUriFor(user, pendingSecret, brand) : null;
  // Never let an unencodable URI break the page: setup then falls back to the typed key.
  const qrMatrix = otpauth ? tryEncodeQr(otpauth) : null;

  const canDisable = twoFactorOn && !mustSetUpTwoFactor({ ...user, twoFactorEnabled: false }, settings.security);
  const minLength = clampMinLength(settings.security.passwordMinLength);

  return (
    <div className="mx-auto max-w-3xl animate-fade-in">
      <PageHeader
        title="Security"
        description="Protect your account with a strong password, a confirmed email and two-step verification."
        breadcrumbs={<Breadcrumbs items={[{ label: "Account settings", href: "/settings" }, { label: "Security" }]} />}
      />

      {requiredNow && (
        <div role="alert" className="mb-6 flex items-start gap-3 rounded-card border border-accent/30 bg-accent/10 px-4 py-3">
          <Icon.ShieldCheck className="mt-0.5 size-5 shrink-0 text-accent" />
          <div className="text-sm">
            <p className="font-medium text-ink">Two-step verification is required for your role</p>
            <p className="text-ink-muted">{brand} asks staff to protect their accounts with an authenticator app. Set it up below to continue to admin and teaching tools.</p>
          </div>
        </div>
      )}
      {twoFactorOn && sp.required === "2fa" && next && (
        <div role="status" className="mb-6 flex flex-col gap-3 rounded-card border border-success/30 bg-success/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-sm font-medium text-ink">
            <Icon.CheckCircle className="size-5 text-success" />
            You&apos;re all set — two-step verification is on.
          </p>
          <ButtonLink href={next} size="sm" rightIcon={<Icon.ArrowRight className="size-4" />}>
            Continue
          </ButtonLink>
        </div>
      )}

      <div className="space-y-6">
        <Card>
          <CardHeader title="Security checkup" description="A quick look at how well your account is protected." />
          <CardBody>
            <ul className="grid gap-4 sm:grid-cols-3">
              <CheckItem
                ok={verified}
                label={verified ? "Email confirmed" : "Email not confirmed"}
                detail={user.emailVerifiedAt ? `Confirmed ${formatDate(user.emailVerifiedAt)}` : verified ? "Added by your organisation" : "Check your inbox for the link"}
              />
              <CheckItem
                ok={twoFactorOn}
                label={twoFactorOn ? "Two-step verification on" : "Two-step verification off"}
                detail={twoFactorOn ? `${recoveryLeft} recovery ${recoveryLeft === 1 ? "code" : "codes"} left` : "Adds a code from your phone at sign-in"}
              />
              <CheckItem
                ok={sessions.length <= 3}
                label={`${sessions.length} signed-in ${sessions.length === 1 ? "device" : "devices"}`}
                detail={lastSignIn ? `Last sign-in ${relativeTime(lastSignIn.createdAt)}` : "No sign-ins recorded yet"}
              />
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Email address"
            description="Used to sign in, reset your password and receive account notices."
            actions={
              verified ? (
                <Badge tone="success" dot>
                  Confirmed
                </Badge>
              ) : (
                <Badge tone="warning" dot>
                  Not confirmed
                </Badge>
              )
            }
          />
          <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-sm">
              <p className="break-all font-medium text-ink">{user.email}</p>
              <p className="mt-0.5 text-ink-muted">
                {verified
                  ? user.emailVerifiedAt
                    ? `Confirmed on ${formatDate(user.emailVerifiedAt)}.`
                    : "This address was added by your organisation and doesn't need confirming."
                  : settings.security.requireEmailVerification
                    ? "Confirm it to enroll in courses and make purchases. The link we sent expires after 24 hours."
                    : "Confirm it so you can always recover your account. The link we sent expires after 24 hours."}
              </p>
            </div>
            {!verified && (
              <div className="shrink-0">
                <ResendVerificationButton />
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Two-step verification"
            description="After your password, sign-in also asks for a 6-digit code from an authenticator app on your phone."
            actions={
              twoFactorOn ? (
                <Badge tone="success" dot>
                  On
                </Badge>
              ) : pendingSetup ? (
                <Badge tone="info" dot>
                  Setting up
                </Badge>
              ) : (
                <Badge tone="neutral" dot>
                  Off
                </Badge>
              )
            }
          />
          <CardBody>
            {twoFactorOn ? (
              <div className="space-y-4">
                <div className="flex items-start gap-3 rounded-lg bg-surface-2/70 px-3 py-3 text-sm">
                  <Icon.Smartphone className="mt-0.5 size-5 shrink-0 text-ink-muted" />
                  <div className="min-w-0">
                    <p className="font-medium text-ink">Authenticator app</p>
                    <p className="text-ink-muted">
                      {recoveryLeft > 0 ? (
                        <>
                          {recoveryLeft} of 10 recovery codes left.
                          {recoveryLeft <= 3 && <span className="font-medium text-warning"> Generate new codes soon.</span>}
                        </>
                      ) : (
                        <span className="font-medium text-warning">No recovery codes left — generate a new set so you can&apos;t get locked out.</span>
                      )}
                    </p>
                  </div>
                </div>
                <TwoFactorManage brand={brand} email={user.email} canDisable={canDisable} recoveryCodesLeft={recoveryLeft} />
                {!canDisable && <p className="text-xs text-ink-muted">Your role requires two-step verification, so it can&apos;t be turned off.</p>}
              </div>
            ) : pendingSetup && otpauth && pendingSecret ? (
              <TwoFactorSetup
                qr={qrMatrix ? <QrCode code={qrMatrix} title={`QR code to add ${brand} to your authenticator app`} /> : null}
                secret={formatSecretForDisplay(pendingSecret)}
                brand={brand}
                email={user.email}
                continueTo={requiredNow && next ? next : undefined}
              />
            ) : pendingSetup ? (
              <div className="space-y-3">
                <p className="text-sm text-danger">
                  The setup key for your unfinished setup can&apos;t be read any more (the server key changed). Start again to get a new QR code.
                </p>
                <StartTwoFactorButton label="Start again" />
              </div>
            ) : settings.security.allowTwoFactor ? (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-ink-muted">Even if someone learns your password, they won&apos;t get in without your phone. Setup takes about a minute.</p>
                <div className="shrink-0">
                  <StartTwoFactorButton />
                </div>
              </div>
            ) : (
              <p className="text-sm text-ink-muted">Two-step verification isn&apos;t available on {brand} right now. An administrator can turn it on.</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Password" description={`Use at least ${minLength} characters with letters and numbers. A long passphrase is easiest to remember.`} />
          <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-ink-muted">
              Changing your password signs you out on your other devices. Forgot it?{" "}
              <Link href={`/forgot-password?email=${encodeURIComponent(user.email)}`} className="font-medium text-accent hover:underline">
                Reset it by email
              </Link>
              .
            </p>
            <ButtonLink href="/settings" variant="outline" size="sm" leftIcon={<Icon.Lock className="size-4" />}>
              Change password
            </ButtonLink>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Recent sign-in activity" description="The last 20 attempts to sign in to your account. If something looks unfamiliar, change your password." />
          <CardBody>
            {events.length === 0 ? (
              <EmptyState compact icon={<Icon.Clock />} title="No sign-in activity yet" description="Sign-ins and failed attempts will appear here from now on." />
            ) : (
              <LoginActivityList events={events} />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Signed-in devices" description="Browsers and devices where you're currently signed in." />
          <CardBody>
            {sessions.length === 0 ? (
              <EmptyState compact icon={<Icon.Monitor />} title="No active sessions" description="Devices you sign in on will be listed here." />
            ) : (
              <SecuritySessions sessions={sessions} />
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
