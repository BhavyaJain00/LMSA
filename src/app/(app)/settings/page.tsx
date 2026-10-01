import { createHash } from "node:crypto";
import Link from "next/link";
import { cookies } from "next/headers";
import type { Session } from "@/lib/types";
import { requireUser } from "@/lib/auth/session";
import { filter, getSettings } from "@/lib/db/store";
import { clampMinLength } from "@/lib/auth/password-policy";
import { roleLabels, siteConfig } from "@/lib/config";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { ThemePreferenceControl } from "@/components/profile/theme-preference";
import { isEmailVerified, isTwoFactorActive } from "@/lib/auth/account-status";
import { formatDate, formatDateTime, relativeTime } from "@/lib/utils";
import { PasswordForm } from "./password-form";
import { SessionsPanel, type SessionRow } from "./sessions-panel";

export const metadata = { title: "Account settings" };

function describeDevice(ua: string | undefined): { device: string; kind: "desktop" | "mobile" } {
  if (!ua) return { device: "Unknown device", kind: "desktop" };
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
              ? "Script"
              : "Browser";
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
  return { device: os ? `${browser} on ${os}` : browser, kind: /Mobi|iPhone|Android/.test(ua) ? "mobile" : "desktop" };
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
  const [sessions, settings, subscriptions] = await Promise.all([activeSessions(user.id), getSettings(), filter("subscriptions", (s) => s.userId === user.id)]);
  const showMembership = settings.growth.subscriptionsEnabled || subscriptions.length > 0;
  const minPasswordLength = clampMinLength(settings.security.passwordMinLength);
  const rows: SessionRow[] = sessions
    .map((s) => {
      const { device, kind } = describeDevice(s.userAgent);
      return {
        id: s.id,
        device,
        kind,
        createdLabel: relativeTime(s.createdAt),
        expiresLabel: formatDate(s.expiresAt),
        current: s.tokenHash === currentHash,
      };
    })
    .sort((a, b) => Number(b.current) - Number(a.current));

  return (
    <div className="mx-auto max-w-3xl animate-fade-in">
      <PageHeader title="Account settings" description="Manage your sign-in details, appearance and active sessions." />

      <div className="space-y-6">
        <Card>
          <CardHeader
            title="Account"
            description="Your name and photo are public on your profile. Your email is only visible to you and moderators."
            actions={
              <ButtonLink href={`/user/${user.username}/edit`} variant="outline" size="sm" leftIcon={<Icon.Edit className="size-4" />}>
                Edit profile
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
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-faint">Email</dt>
                <dd className="mt-1 break-all text-ink">{user.email}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-faint">Member since</dt>
                <dd className="mt-1 text-ink">{formatDate(user.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-faint">Roles</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {user.roles.map((r) => (
                    <Badge key={r} tone={r === "student" ? "neutral" : "accent"}>
                      {roleLabels[r] ?? r}
                    </Badge>
                  ))}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-faint">Last active</dt>
                <dd className="mt-1 text-ink" title={user.lastActiveAt ? formatDateTime(user.lastActiveAt) : undefined}>
                  {user.lastActiveAt ? relativeTime(user.lastActiveAt) : "—"}
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-xs text-ink-muted">To change the email address on your account, contact an administrator.</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Security"
            description="Two-step verification, email confirmation, sign-in history and signed-in devices."
            actions={
              <ButtonLink href="/settings/security" variant="outline" size="sm" leftIcon={<Icon.ShieldCheck className="size-4" />}>
                Manage security
              </ButtonLink>
            }
          />
          <CardBody className="flex flex-wrap gap-2">
            <Badge tone={isTwoFactorActive(user) ? "success" : "neutral"} dot>
              Two-step verification {isTwoFactorActive(user) ? "on" : "off"}
            </Badge>
            <Badge tone={isEmailVerified(user) ? "success" : "warning"} dot>
              {isEmailVerified(user) ? "Email confirmed" : "Email not confirmed"}
            </Badge>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Notifications, calendar and billing" description="Choose which emails you get, sync your schedule and find your receipts." />
          <ul className="divide-y divide-border">
            {[
              {
                href: "/settings/notifications",
                icon: <Icon.Mail className="size-4" />,
                title: "Email notifications",
                description: "Pick the emails you receive about courses, batches, grades and payments.",
              },
              {
                href: "/settings/calendar",
                icon: <Icon.Calendar className="size-4" />,
                title: "Calendar feed",
                description: "Subscribe to your live classes and evaluations in Google, Apple or Outlook calendar.",
              },
              {
                href: "/billing/history",
                icon: <Icon.Receipt className="size-4" />,
                title: "Orders & invoices",
                description: "Your purchases, payment status and downloadable invoices.",
              },
              ...(showMembership
                ? [
                    {
                      href: "/settings/subscription",
                      icon: <Icon.Star className="size-4" />,
                      title: "Membership",
                      description: "Your plan, billing dates and membership invoices.",
                    },
                  ]
                : []),
              {
                href: "/settings/privacy",
                icon: <Icon.Shield className="size-4" />,
                title: "Privacy & data",
                description: "Download your data, manage cookies or delete your account.",
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
                  <Icon.ChevronRight className="size-4 shrink-0 text-ink-faint group-hover:text-ink" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader
            title="Password"
            description={`Use at least ${minPasswordLength} characters with letters and numbers. A longer passphrase is stronger than a short, complex one.`}
          />
          <CardBody>
            <PasswordForm minLength={minPasswordLength} context={[user.name, user.email.split("@")[0] ?? ""]} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Appearance" description="Choose how the app looks on this device." />
          <CardBody>
            <ThemePreferenceControl />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Learning preferences" description="Your answers help us recommend courses and batches." />
          <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-ink-muted">
              {user.persona?.goals?.length ? (
                <>
                  Goals: <span className="text-ink">{user.persona.goals.join(", ")}</span>
                </>
              ) : (
                "You haven't shared your learning goals yet."
              )}
            </div>
            <ButtonLink href="/persona" variant="outline" size="sm" leftIcon={<Icon.Target className="size-4" />}>
              {user.persona?.goals?.length ? "Update goals" : "Set goals"}
            </ButtonLink>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Sessions" description="Devices where you're currently logged in." />
          <CardBody>
            {rows.length === 0 ? (
              <p className="text-sm text-ink-muted">No active sessions found.</p>
            ) : (
              <SessionsPanel sessions={rows} />
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
