import Link from "next/link";
import type { ReactNode } from "react";
import { getCurrentPublicUser } from "@/lib/auth/session";
import { getDb, getSettings } from "@/lib/db/store";
import { buildNavigation, managesOrganization } from "@/lib/nav";
import { getUnreadCount } from "@/lib/services/notifications";
import { logoutAction } from "@/lib/actions/auth";
import { Avatar } from "@/components/ui/avatar";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { ColourModeRow } from "@/components/profile/theme-preference";
import { buildMobileTabs } from "@/components/layout/mobile-tabs";
import { SearchRow } from "./you-rows";

export const metadata = { title: "You" };

const rowClass = "flex min-h-12 w-full items-center gap-3 px-4 py-2 transition-colors hover:bg-surface-2 focus-visible:bg-surface-2";

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`group-${title}`}>
      <h2 id={`group-${title}`} className="mb-2 px-1 text-xs font-medium uppercase tracking-wider text-ink-faint">
        {title}
      </h2>
      <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface-1">{children}</ul>
    </section>
  );
}

function Row({ href, icon, label, value, external }: { href: string; icon: ReactNode; label: string; value?: ReactNode; external?: boolean }) {
  const inner = (
    <>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-muted [&>svg]:size-4">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-ink">{label}</span>
      {value !== undefined && <span className="text-sm text-ink-muted">{value}</span>}
      {external ? (
        <Icon.ExternalLink className="size-4 shrink-0 text-ink-faint" />
      ) : (
        <Icon.ChevronRight className="size-4 shrink-0 text-ink-faint rtl:rotate-180" />
      )}
    </>
  );
  return (
    <li>
      {external ? (
        <a href={href} className={rowClass} target={href.startsWith("mailto:") ? undefined : "_blank"} rel="noopener noreferrer">
          {inner}
        </a>
      ) : (
        <Link href={href} className={rowClass}>
          {inner}
        </Link>
      )}
    </li>
  );
}

/**
 * Phone-first account hub: profile summary, every destination from the
 * sidebar, and account actions (notifications, search, colour mode, log out).
 */
export default async function YouPage() {
  const [user, settings] = await Promise.all([getCurrentPublicUser(), getSettings()]);

  if (!user) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center py-16 text-center">
        <span className="mb-3 flex size-14 items-center justify-center rounded-full bg-surface-2 text-ink-faint">
          <Icon.User className="size-7" />
        </span>
        <h1 className="sr-only">You</h1>
        <p className="text-sm text-ink-muted">Log in to see your account.</p>
        <Link href="/login?next=/you" className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-accent underline underline-offset-4">
          Log in
        </Link>
      </div>
    );
  }

  const unread = settings.features.notifications ? await getUnreadCount(user.id) : 0;
  const sections = buildNavigation(user, settings, { managesOrg: managesOrganization((await getDb()).organizations, user.id) });
  // Destinations already on the phone tab bar are not repeated under "Pages".
  const skip = new Set(["/notifications", `/user/${user.username}`, ...buildMobileTabs(user, settings).map((t) => t.href)]);
  const pageGroups = sections
    .map((section) => ({
      title: section.title === "Manage" ? "Manage" : section.title === "Links" ? "More" : "Pages",
      items: section.items.filter((i) => !skip.has(i.href)),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="mx-auto max-w-lg animate-fade-in space-y-8">
      <h1 className="sr-only">You</h1>

      <div className="flex flex-col items-center pt-2 text-center">
        <Avatar name={user.name} src={user.avatarUrl} size="2xl" className="size-24" />
        <p className="mt-3 text-2xl font-semibold tracking-tight text-ink">{user.name}</p>
        {user.headline && <p className="mt-0.5 text-sm text-ink-muted">{user.headline}</p>}
        <Link href={`/user/${user.username}`} className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-accent hover:underline">
          View profile
        </Link>
        <div className="mt-1 flex gap-2">
          <ButtonLink href="/dashboard" size="sm" variant="subtle" leftIcon={<Icon.Home className="size-4" />}>
            Dashboard
          </ButtonLink>
          <ButtonLink href={`/user/${user.username}/edit`} size="sm" variant="subtle" leftIcon={<Icon.Edit className="size-4" />}>
            Edit profile
          </ButtonLink>
        </div>
      </div>

      {pageGroups.map((group, gi) => (
        <Group key={`${group.title}-${gi}`} title={group.title}>
          {group.items.map((item) => {
            const IconCmp = Icon[item.icon] ?? Icon.Dot;
            const external = /^https?:\/\//.test(item.href) || item.href.startsWith("mailto:");
            return (
              <Row
                key={item.href}
                href={item.href}
                label={item.label === "Programming Exercises" ? "Exercises" : item.label}
                icon={<IconCmp />}
                external={external}
                value={item.badge ? item.badge : undefined}
              />
            );
          })}
        </Group>
      ))}

      <Group title="Account">
        {settings.features.notifications && <Row href="/notifications" icon={<Icon.Bell />} label="Notifications" value={unread > 0 ? unread : undefined} />}
        <li>
          <SearchRow className={rowClass} />
        </li>
        <Row href="/settings" icon={<Icon.Settings />} label="Account settings" />
        <Row href="/settings/security" icon={<Icon.ShieldCheck />} label="Security" />
        <Row href="/settings/notifications" icon={<Icon.Mail />} label="Email notifications" />
        <Row href="/settings/calendar" icon={<Icon.Calendar />} label="Calendar feed" />
        <Row href="/billing/history" icon={<Icon.Receipt />} label="Orders & invoices" />
        <Row href="/persona" icon={<Icon.Target />} label="Learning goals" />
        <li>
          <ColourModeRow className={rowClass} />
        </li>
        <li>
          <form action={logoutAction}>
            <button type="submit" className={`${rowClass} text-left`}>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-danger/10 text-danger">
                <Icon.LogOut className="size-4" />
              </span>
              <span className="min-w-0 flex-1 text-sm text-danger">Log out</span>
            </button>
          </form>
        </li>
      </Group>

      <p className="pb-4 text-center text-xs text-ink-faint">
        Signed in as {user.email} · {settings.brand.name}
      </p>
    </div>
  );
}
