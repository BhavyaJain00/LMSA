import { createHash } from "node:crypto";
import Link from "next/link";
import { cookies } from "next/headers";
import type { Session } from "@/lib/types";
import { requireUser } from "@/lib/auth/session";
import { filter, getSettings } from "@/lib/db/store";
import { clampMinLength } from "@/lib/auth/password-policy";
import { siteConfig } from "@/lib/config";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { ThemePreferenceControl } from "@/components/profile/theme-preference";
import { LanguageSettingsCard } from "@/components/layout/language-settings-card";
import { isEmailVerified, isTwoFactorActive } from "@/lib/auth/account-status";
import { getFormatter, getT } from "@/i18n/server";
import { PasswordForm } from "./password-form";
import { SessionsPanel, type SessionRow } from "./sessions-panel";

export async function generateMetadata() {
  return { title: (await getT("account"))("settings.metaTitle") };
}

type AccountT = Awaited<ReturnType<typeof getT<"account">>>;

function describeDevice(ua: string | undefined, t: AccountT): { device: string; kind: "desktop" | "mobile" } {
  if (!ua) return { device: t("settings.sessions.unknownDevice"), kind: "desktop" };
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : /curl|node|undici/i.test(ua)
              ? t("settings.sessions.script")
              : t("settings.sessions.browser");
  const os = /iPhone|iPad|iPod/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return { device: os ? t("settings.sessions.deviceOn", { browser, os }) : browser, kind: /Mobi|iPhone|Android/.test(ua) ? "mobile" : "desktop" };
}

/**
 * The member's unexpired sessions, newest first. Expired rows are only purged when
 * their token is next presented, so they are filtered out here.
 */
async function activeSessions(userId: string): Promise<Session[]> {
  const now = Date.now();
  const rows = await filter("sessions", (s) => s.userId === userId && new Date(s.expiresAt).getTime() > now);
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export default async function AccountSettingsPage() {
  const user = await requireUser("/settings");
  const store = await cookies();
  const token = store.get(siteConfig.sessionCookie)?.value;
  const currentHash = token ? createHash("sha256").update(token).digest("hex") : null;
  const [sessions, settings, subscriptions, t, ts, f] = await Promise.all([
    activeSessions(user.id),
    getSettings(),
    filter("subscriptions", (s) => s.userId === user.id),
    getT("account"),
    getT("shell"),
    getFormatter(),
  ]);
  const showMembership = settings.growth.subscriptionsEnabled || subscriptions.length > 0;
  const minPasswordLength = clampMinLength(settings.security.passwordMinLength);
  const rows: SessionRow[] = sessions
    .map((s) => {
      const { device, kind } = describeDevice(s.userAgent, t);
      return {
        id: s.id,
        device,
        kind,
        createdLabel: f.relative(s.createdAt),
        expiresLabel: f.date(s.expiresAt),
        current: s.tokenHash === currentHash,
      };
    })
    .sort((a, b) => Number(b.current) - Number(a.current));

  return (
    <div className="mx-auto max-w-3xl animate-fade-in">
      <PageHeader title={t("settings.metaTitle")} description={t("settings.description")} />

      <div className="space-y-6">
        <Card>
          <CardHeader
            title={t("settings.account.title")}
            description={t("settings.account.description")}
            actions={
              <ButtonLink href={`/user/${user.username}/edit`} variant="outline" size="sm" leftIcon={<Icon.Edit className="size-4" />}>
                {t("settings.account.editProfile")}
              </ButtonLink>
            }
          />
          <CardBody>
            <div className="flex items-center gap-4">
              <Avatar name={user.name} src={user.avatarUrl} size="lg" />
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-ink">{user.name}</p>
                <Link href={`/user/${user.username}`} className="text-sm text-ink-muted hover:text-accent">
                  @{user.username}
                </Link>
              </div>
            </div>
            <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-faint">{t("settings.account.email")}</dt>
                <dd className="mt-1 break-all text-ink">{user.email}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-faint">{t("settings.account.memberSince")}</dt>
                <dd className="mt-1 text-ink">{f.date(user.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-faint">{t("settings.account.roles")}</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {user.roles.map((r) => (
                    <Badge key={r} tone={r === "student" ? "neutral" : "accent"}>
                      {ts.has(`roles.${r}`) ? ts(`roles.${r}`) : r}
                    </Badge>
                  ))}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-faint">{t("settings.account.lastActive")}</dt>
                <dd className="mt-1 text-ink" title={user.lastActiveAt ? f.dateTime(user.lastActiveAt) : undefined}>
                  {user.lastActiveAt ? f.relative(user.lastActiveAt) : "—"}
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-xs text-ink-muted">{t("settings.account.changeEmail")}</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={t("settings.securityCard.title")}
            description={t("settings.securityCard.description")}
            actions={
              <ButtonLink href="/settings/security" variant="outline" size="sm" leftIcon={<Icon.ShieldCheck className="size-4" />}>
                {t("settings.securityCard.manage")}
              </ButtonLink>
            }
          />
          <CardBody className="flex flex-wrap gap-2">
            <Badge tone={isTwoFactorActive(user) ? "success" : "neutral"} dot>
              {isTwoFactorActive(user) ? t("settings.securityCard.twoFactorOn") : t("settings.securityCard.twoFactorOff")}
            </Badge>
            <Badge tone={isEmailVerified(user) ? "success" : "warning"} dot>
              {isEmailVerified(user) ? t("settings.securityCard.emailConfirmed") : t("settings.securityCard.emailNotConfirmed")}
            </Badge>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("settings.links.title")} description={t("settings.links.description")} />
          <ul className="divide-y divide-border">
            {[
              {
                href: "/settings/notifications",
                icon: <Icon.Mail className="size-4" />,
                title: t("settings.links.notifications"),
                description: t("settings.links.notificationsBody"),
              },
              {
                href: "/settings/calendar",
                icon: <Icon.Calendar className="size-4" />,
                title: t("settings.links.calendar"),
                description: t("settings.links.calendarBody"),
              },
              {
                href: "/billing/history",
                icon: <Icon.Receipt className="size-4" />,
                title: t("settings.links.orders"),
                description: t("settings.links.ordersBody"),
              },
              ...(showMembership
                ? [
                    {
                      href: "/settings/subscription",
                      icon: <Icon.Star className="size-4" />,
                      title: t("settings.links.membership"),
                      description: t("settings.links.membershipBody"),
                    },
                  ]
                : []),
              {
                href: "/settings/privacy",
                icon: <Icon.Shield className="size-4" />,
                title: t("settings.links.privacy"),
                description: t("settings.links.privacyBody"),
              },
            ].map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="group flex items-center gap-3 px-5 py-4 hover:bg-surface-2">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-muted group-hover:bg-surface-3 group-hover:text-ink">
                    {item.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-ink">{item.title}</span>
                    <span className="block text-sm text-ink-muted">{item.description}</span>
                  </span>
                  <Icon.ChevronRight className="size-4 shrink-0 text-ink-faint group-hover:text-ink rtl:rotate-180" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader
            title={t("settings.password.title")}
            description={t("settings.password.description", { count: minPasswordLength })}
          />
          <CardBody>
            <PasswordForm minLength={minPasswordLength} context={[user.name, user.email.split("@")[0] ?? ""]} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("settings.appearance.title")} description={t("settings.appearance.description")} />
          <CardBody>
            <ThemePreferenceControl />
          </CardBody>
        </Card>

        <LanguageSettingsCard />

        <Card>
          <CardHeader title={t("settings.learning.title")} description={t("settings.learning.description")} />
          <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-ink-muted">
              {user.persona?.goals?.length ? (
                t.rich("settings.learning.goals", { goals: f.list(user.persona.goals), hl: (text) => <span className="text-ink">{text}</span> })
              ) : (
                t("settings.learning.noGoals")
              )}
            </div>
            <ButtonLink href="/persona" variant="outline" size="sm" leftIcon={<Icon.Target className="size-4" />}>
              {user.persona?.goals?.length ? t("settings.learning.update") : t("settings.learning.set")}
            </ButtonLink>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("settings.sessions.title")} description={t("settings.sessions.description")} />
          <CardBody>
            {rows.length === 0 ? (
              <p className="text-sm text-ink-muted">{t("settings.sessions.none")}</p>
            ) : (
              <SessionsPanel sessions={rows} />
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
