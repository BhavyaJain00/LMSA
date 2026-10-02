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
import { deviceLabel } from "@/components/security/device-label";
import { cn } from "@/lib/utils";
import { getFormatter, getT } from "@/i18n/server";

export async function generateMetadata() {
  return { title: (await getT("account"))("security.metaTitle") };
}

async function sessionRows(user: User): Promise<SecuritySessionRow[]> {
  const now = Date.now();
  const [current, t, f] = await Promise.all([getCurrentSessionTokenHash(), getT("account"), getFormatter()]);
  const rows: Session[] = await filter("sessions", (s) => s.userId === user.id && new Date(s.expiresAt).getTime() > now);
  return rows
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((s) => {
      const ua = describeUserAgent(s.userAgent);
      return {
        id: s.id,
        device: deviceLabel(ua, t),
        kind: ua.kind,
        signedInLabel: f.relative(s.createdAt),
        signedInTitle: f.dateTime(s.createdAt),
        expiresLabel: f.date(s.expiresAt),
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
  const [settings, t, f] = await Promise.all([getSettings(), getT("account"), getFormatter()]);
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
        title={t("security.metaTitle")}
        description={t("security.description")}
        breadcrumbs={<Breadcrumbs items={[{ label: t("settings.metaTitle"), href: "/settings" }, { label: t("security.metaTitle") }]} />}
      />

      {requiredNow && (
        <div role="alert" className="mb-6 flex items-start gap-3 rounded-card border border-accent/30 bg-accent/10 px-4 py-3">
          <Icon.ShieldCheck className="mt-0.5 size-5 shrink-0 text-accent" />
          <div className="text-sm">
            <p className="font-medium text-ink">{t("security.requiredTitle")}</p>
            <p className="text-ink-muted">{t("security.requiredBody", { brand })}</p>
          </div>
        </div>
      )}
      {twoFactorOn && sp.required === "2fa" && next && (
        <div role="status" className="mb-6 flex flex-col gap-3 rounded-card border border-success/30 bg-success/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-sm font-medium text-ink">
            <Icon.CheckCircle className="size-5 text-success" />
            {t("security.allSet")}
          </p>
          <ButtonLink href={next} size="sm" rightIcon={<Icon.ArrowRight className="size-4 rtl:rotate-180" />}>
            {t("security.continue")}
          </ButtonLink>
        </div>
      )}

      <div className="space-y-6">
        <Card>
          <CardHeader title={t("security.checkup.title")} description={t("security.checkup.description")} />
          <CardBody>
            <ul className="grid gap-4 sm:grid-cols-3">
              <CheckItem
                ok={verified}
                label={verified ? t("security.checkup.emailConfirmed") : t("security.checkup.emailNotConfirmed")}
                detail={
                  user.emailVerifiedAt
                    ? t("security.checkup.confirmedOn", { date: f.date(user.emailVerifiedAt) })
                    : verified
                      ? t("security.checkup.addedByOrg")
                      : t("security.checkup.checkInbox")
                }
              />
              <CheckItem
                ok={twoFactorOn}
                label={twoFactorOn ? t("security.checkup.twoFactorOn") : t("security.checkup.twoFactorOff")}
                detail={twoFactorOn ? t("security.checkup.codesLeft", { count: recoveryLeft }) : t("security.checkup.addsCode")}
              />
              <CheckItem
                ok={sessions.length <= 3}
                label={t("security.checkup.devices", { count: sessions.length })}
                detail={lastSignIn ? t("security.checkup.lastSignIn", { when: f.relative(lastSignIn.createdAt) }) : t("security.checkup.noSignIns")}
              />
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={t("security.email.title")}
            description={t("security.email.description")}
            actions={
              verified ? (
                <Badge tone="success" dot>
                  {t("security.email.confirmed")}
                </Badge>
              ) : (
                <Badge tone="warning" dot>
                  {t("security.email.notConfirmed")}
                </Badge>
              )
            }
          />
          <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-sm">
              <p className="break-all font-medium text-ink" dir="ltr">{user.email}</p>
              <p className="mt-0.5 text-ink-muted">
                {verified
                  ? user.emailVerifiedAt
                    ? t("security.email.confirmedOn", { date: f.date(user.emailVerifiedAt) })
                    : t("security.email.addedByOrg")
                  : settings.security.requireEmailVerification
                    ? t("security.email.confirmRequired")
                    : t("security.email.confirmOptional")}
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
            title={t("security.twoFactor.title")}
            description={t("security.twoFactor.description")}
            actions={
              twoFactorOn ? (
                <Badge tone="success" dot>
                  {t("security.twoFactor.on")}
                </Badge>
              ) : pendingSetup ? (
                <Badge tone="info" dot>
                  {t("security.twoFactor.settingUp")}
                </Badge>
              ) : (
                <Badge tone="neutral" dot>
                  {t("security.twoFactor.off")}
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
                    <p className="font-medium text-ink">{t("security.twoFactor.app")}</p>
                    <p className="text-ink-muted">
                      {recoveryLeft > 0 ? (
                        <>
                          {t("security.twoFactor.codesLeft", { count: recoveryLeft, total: 10 })}
                          {recoveryLeft <= 3 && <span className="font-medium text-warning"> {t("security.twoFactor.generateSoon")}</span>}
                        </>
                      ) : (
                        <span className="font-medium text-warning">{t("security.twoFactor.noCodesLeft")}</span>
                      )}
                    </p>
                  </div>
                </div>
                <TwoFactorManage brand={brand} email={user.email} canDisable={canDisable} recoveryCodesLeft={recoveryLeft} />
                {!canDisable && <p className="text-xs text-ink-muted">{t("security.twoFactor.required")}</p>}
              </div>
            ) : pendingSetup && otpauth && pendingSecret ? (
              <TwoFactorSetup
                qr={qrMatrix ? <QrCode code={qrMatrix} title={t("security.twoFactor.qrTitle", { brand })} /> : null}
                secret={formatSecretForDisplay(pendingSecret)}
                brand={brand}
                email={user.email}
                continueTo={requiredNow && next ? next : undefined}
              />
            ) : pendingSetup ? (
              <div className="space-y-3">
                <p className="text-sm text-danger">
                  {t("security.twoFactor.keyUnreadable")}
                </p>
                <StartTwoFactorButton label={t("security.twoFactor.startAgain")} />
              </div>
            ) : settings.security.allowTwoFactor ? (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-ink-muted">{t("security.twoFactor.pitch")}</p>
                <div className="shrink-0">
                  <StartTwoFactorButton />
                </div>
              </div>
            ) : (
              <p className="text-sm text-ink-muted">{t("security.twoFactor.unavailable", { brand })}</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("security.password.title")} description={t("security.password.description", { count: minLength })} />
          <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-ink-muted">
              {t.rich("security.password.body", {
                link: (text) => (
                  <Link href={`/forgot-password?email=${encodeURIComponent(user.email)}`} className="font-medium text-accent hover:underline">
                    {text}
                  </Link>
                ),
              })}
            </p>
            <ButtonLink href="/settings" variant="outline" size="sm" leftIcon={<Icon.Lock className="size-4" />}>
              {t("security.password.change")}
            </ButtonLink>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("security.activity.title")} description={t("security.activity.description")} />
          <CardBody>
            {events.length === 0 ? (
              <EmptyState compact icon={<Icon.Clock />} title={t("security.activity.emptyTitle")} description={t("security.activity.emptyBody")} />
            ) : (
              <LoginActivityList events={events} />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("security.devices.title")} description={t("security.devices.description")} />
          <CardBody>
            {sessions.length === 0 ? (
              <EmptyState compact icon={<Icon.Monitor />} title={t("security.devices.emptyTitle")} description={t("security.devices.emptyBody")} />
            ) : (
              <SecuritySessions sessions={sessions} />
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
