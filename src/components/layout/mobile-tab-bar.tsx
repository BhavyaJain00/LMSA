"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { isTabActive, youTabMatches, type MobileTab } from "./mobile-tabs";

const tabClass =
  "relative flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 pt-1.5 pb-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

function TabLink({ href, active, label, children }: { href: string; active: boolean; label: string; children: ReactNode }) {
  return (
    <li className="flex min-w-0 flex-1">
      <Link href={href} aria-current={active ? "page" : undefined} className={cn(tabClass, active ? "text-accent" : "text-ink-muted hover:text-ink")}>
        {children}
        <span className="max-w-full truncate">{label}</span>
      </Link>
    </li>
  );
}

/**
 * Phone bottom tab bar (hidden from `lg` up, where the sidebar takes over).
 * Signed-in members end with a "You" tab drawn as their avatar, which leads to
 * the /you account hub; guests end with "Log in".
 */
export function MobileTabBar({ tabs, user }: { tabs: MobileTab[]; user: { name: string; username: string; avatarUrl?: string } | null }) {
  const pathname = usePathname() ?? "/";
  const t = useT("shell");
  const youActive = user ? isTabActive(pathname, youTabMatches(user.username)) : pathname === "/login";
  const loginHref = pathname && pathname !== "/login" ? `/login?next=${encodeURIComponent(pathname)}` : "/login";

  return (
    <nav
      aria-label={t("nav.primary")}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface-1/95 pb-[env(safe-area-inset-bottom)] shadow-pop backdrop-blur lg:hidden print:hidden"
    >
      <ul className="mx-auto flex h-16 max-w-xl items-stretch gap-1 px-2">
        {tabs.map((tab) => {
          const active = isTabActive(pathname, tab.match);
          const IconCmp = Icon[tab.icon] ?? Icon.Dot;
          const count = tab.badge ?? 0;
          return (
            <TabLink key={tab.key} href={tab.href} active={active} label={tab.label}>
              <span className="relative">
                <IconCmp className="size-5" aria-hidden="true" />
                {count > 0 && (
                  <span className="absolute -inset-e-2.5 -top-1.5 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] font-semibold leading-4 text-accent-fg ring-2 ring-surface-1">
                    {count > 99 ? "99+" : count}
                  </span>
                )}
              </span>
              {count > 0 && <span className="sr-only">{t("tabs.unread", { count })}</span>}
            </TabLink>
          );
        })}
        {user ? (
          <TabLink href="/you" active={youActive} label={t("tabs.you")}>
            <Avatar name={user.name} src={user.avatarUrl} size="xs" className={cn("size-6 text-[10px]", youActive && "ring-2 ring-accent ring-offset-2 ring-offset-surface-1")} />
          </TabLink>
        ) : (
          <TabLink href={loginHref} active={youActive} label={t("tabs.logIn")}>
            <Icon.LogIn className="size-5" aria-hidden="true" />
          </TabLink>
        )}
      </ul>
    </nav>
  );
}
