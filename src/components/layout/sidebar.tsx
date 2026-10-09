"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import type { PublicUser } from "@/lib/types";
import { activeNavHref, isManagePath, isShellItemActive, type NavTone, type ShellNav, type ShellNavItem, type SidebarGroup } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icons";
import { getTheme, setTheme } from "@/components/ui/theme-toggle";
import { openCommandPalette } from "@/components/command-palette/events";
import { useT } from "@/i18n/client";
import { BrandMark } from "./brand-mark";
import { LanguageDialog } from "./language-switcher";
import { UserMenu } from "./user-menu";

interface SidebarState {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
}

const SidebarContext = createContext<SidebarState | null>(null);

export function useSidebar(): SidebarState {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used within SidebarProvider");
  return ctx;
}

const COLLAPSE_KEY = "ll-sidebar";
const COLLAPSE_EVENT = "ll-sidebar-change";

function subscribeCollapsed(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(COLLAPSE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(COLLAPSE_EVENT, callback);
  };
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "collapsed";
  } catch {
    return false;
  }
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  // Persisted preference read through an external store so the server render (expanded) hydrates cleanly.
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  const setCollapsed = useCallback((v: boolean) => {
    try {
      localStorage.setItem(COLLAPSE_KEY, v ? "collapsed" : "expanded");
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event(COLLAPSE_EVENT));
  }, []);
  return <SidebarContext.Provider value={{ collapsed, setCollapsed }}>{children}</SidebarContext.Provider>;
}

/** Icon colour per main destination (light and dark shades with enough contrast on the pill). */
const TONE: Record<NavTone, string> = {
  blue: "text-sky-600 dark:text-sky-400",
  pink: "text-pink-600 dark:text-pink-400",
  green: "text-emerald-600 dark:text-emerald-400",
  amber: "text-amber-600 dark:text-amber-400",
  violet: "text-violet-600 dark:text-violet-400",
};

function CountBadge({ count, className }: { count: number; className?: string }) {
  return (
    <span className={cn("min-w-5 rounded-full bg-accent px-1.5 py-px text-center text-micro font-bold text-accent-fg", className)}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

function MainLink({ item, active, collapsed }: { item: ShellNavItem; active: boolean; collapsed: boolean }) {
  const IconCmp = Icon[item.icon] ?? Icon.Dot;
  const badge = item.badge ?? 0;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      className={cn(
        "relative flex min-h-12 items-center gap-3 rounded-xl px-3.5 text-[0.9375rem] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        active ? "bg-surface-1 text-ink shadow-sm ring-1 ring-border-strong" : "bg-panel/70 text-ink-muted hover:bg-surface-1 hover:text-ink",
        collapsed && "justify-center px-0",
      )}
    >
      <IconCmp className={cn("size-5 shrink-0", TONE[item.tone])} aria-hidden="true" />
      {collapsed ? <span className="sr-only">{item.label}</span> : <span className="truncate">{item.label}</span>}
      {badge > 0 && (collapsed ? <span className="absolute inset-e-2 top-2 size-2 rounded-full bg-accent" /> : <CountBadge count={badge} className="ms-auto" />)}
    </Link>
  );
}

/** Staff tools under "Manage", listed while a page in /admin is open. */
function ManageLinks({ groups, pathname }: { groups: SidebarGroup[]; pathname: string }) {
  const current = activeNavHref(
    groups.flatMap((g) => g.items),
    pathname,
  );
  return (
    <div className="mt-2 ms-5 space-y-3 border-s border-border ps-3">
      {groups.map((group) => (
        <div key={group.id}>
          {group.title && <p className="px-2 pb-1 text-micro font-semibold uppercase tracking-wide text-ink-faint">{group.title}</p>}
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const IconCmp = Icon[item.icon] ?? Icon.Dot;
              const active = item.href === current;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors",
                      active ? "bg-surface-1 font-semibold text-ink shadow-sm" : "text-ink-muted hover:bg-panel hover:text-ink",
                    )}
                  >
                    <IconCmp className="size-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{item.label}</span>
                    {item.badge ? <CountBadge count={item.badge} className="ms-auto" /> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** The admin's own sidebar links (Settings → Sidebar) and "Contact us", in small type under the main links. */
function CustomLinks({ items }: { items: ShellNav["custom"] }) {
  return (
    <ul className="mt-4 space-y-0.5 border-t border-border pt-3">
      {items.map((item) => {
        const IconCmp = Icon[item.icon] ?? Icon.ExternalLink;
        const classes = "flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm text-ink-muted hover:bg-panel hover:text-ink";
        const inner = (
          <>
            <IconCmp className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{item.label}</span>
          </>
        );
        return (
          <li key={item.href}>
            {/^https?:/.test(item.href) ? (
              <a href={item.href} target="_blank" rel="noopener noreferrer" className={classes}>
                {inner}
              </a>
            ) : item.href.startsWith("mailto:") ? (
              <a href={item.href} className={classes}>
                {inner}
              </a>
            ) : (
              <Link href={item.href} className={classes}>
                {inner}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const squareButton =
  "relative flex h-11 items-center justify-center rounded-xl bg-panel text-ink-muted ring-1 ring-border transition-colors hover:bg-surface-1 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/**
 * Desktop sidebar (from `lg`): the site's mark, a handful of large links (Home, Courses, Discussions,
 * Messages, Manage), the account card and a row of quick buttons (theme, notifications, settings). Phones
 * use the bottom tab bar instead.
 */
export function Sidebar({
  nav,
  brand,
  user,
  unread = 0,
  showNotifications = true,
  membership = false,
  gifts = false,
}: {
  nav: ShellNav;
  brand: { name: string; logoUrl?: string };
  user: PublicUser | null;
  unread?: number;
  showNotifications?: boolean;
  membership?: boolean;
  gifts?: boolean;
}) {
  const { collapsed, setCollapsed } = useSidebar();
  const pathname = usePathname() ?? "/";
  const t = useT("shell");
  const tc = useT("common");
  const [languageOpen, setLanguageOpen] = useState(false);
  const inManage = isManagePath(pathname);
  const loginHref = pathname !== "/" && pathname !== "/login" ? `/login?next=${encodeURIComponent(pathname)}` : "/login";
  const languageButton = (
    <button type="button" onClick={() => setLanguageOpen(true)} className={squareButton} aria-label={t("menu.language")} title={t("menu.language")}>
      <Icon.Globe className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
    </button>
  );

  return (
    <aside className={cn("sticky top-0 hidden h-screen shrink-0 flex-col gap-3 p-3 transition-[width] duration-200 lg:flex print:hidden", collapsed ? "w-[5.5rem]" : "w-[17rem]")}>
      <div className={cn("flex items-center gap-1 ps-2 pt-1", collapsed && "flex-col gap-2 ps-0")}>
        <Link
          href="/"
          className={cn("min-w-0 flex-1 rounded-lg py-1 focus-visible:outline-2 focus-visible:outline-accent", collapsed && "flex-none")}
          aria-label={collapsed ? t("header.homeLink", { brand: brand.name }) : undefined}
        >
          <BrandMark name={brand.name} logoUrl={brand.logoUrl} showName={!collapsed} nameClassName="text-lg font-bold" />
        </Link>
        <button
          type="button"
          onClick={openCommandPalette}
          className="rounded-lg p-2 text-ink-muted hover:bg-panel hover:text-ink"
          aria-label={t("header.search")}
          title={t("header.searchPlaceholder")}
          aria-keyshortcuts="Control+K Meta+K"
        >
          <Icon.Search className="size-5" />
        </button>
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="rounded-lg p-2 text-ink-muted hover:bg-panel hover:text-ink"
          aria-label={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
          aria-expanded={!collapsed}
        >
          <Icon.PanelLeft className="size-5 rtl:-scale-x-100" />
        </button>
      </div>

      <nav className="-mx-1 flex-1 overflow-y-auto px-1 py-1 scrollbar-thin" aria-label={t("nav.main")}>
        <ul className="space-y-2">
          {nav.primary.map((item) => (
            <li key={item.key}>
              <MainLink item={item} active={isShellItemActive(item, pathname)} collapsed={collapsed} />
              {item.key === "manage" && inManage && !collapsed && nav.manage && <ManageLinks groups={nav.manage} pathname={pathname} />}
            </li>
          ))}
        </ul>
        {nav.custom.length > 0 && !collapsed && <CustomLinks items={nav.custom} />}
      </nav>

      {user ? (
        <UserMenu user={user} membership={membership} gifts={gifts} extra={nav.account} variant="card" collapsed={collapsed} />
      ) : (
        <Link
          href={loginHref}
          className={cn("flex items-center gap-3 rounded-xl bg-panel p-2.5 ring-1 ring-border transition-colors hover:bg-surface-1", collapsed && "justify-center p-2")}
          title={collapsed ? t("tabs.logIn") : undefined}
        >
          <span className={cn("flex shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent", collapsed ? "size-8" : "size-10")}>
            <Icon.User className="size-5" aria-hidden="true" />
          </span>
          {collapsed ? (
            <span className="sr-only">{t("tabs.logIn")}</span>
          ) : (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">{t("tabs.logIn")}</span>
                <span className="block truncate text-xs text-ink-faint">{t("sidebar.signInForMore")}</span>
              </span>
              <Icon.ChevronRight className="size-4 shrink-0 text-ink-faint rtl:rotate-180" aria-hidden="true" />
            </>
          )}
        </Link>
      )}

      <div className={cn("grid gap-2", collapsed ? "grid-cols-1" : user ? "grid-cols-3" : "grid-cols-2")}>
        <button
          type="button"
          onClick={() => setTheme(getTheme() === "dark" ? "light" : "dark")}
          className={squareButton}
          aria-label={tc("a11y.toggleTheme")}
          title={tc("a11y.toggleTheme")}
        >
          <Icon.Moon className="hidden size-5 text-amber-400 dark:block" aria-hidden="true" />
          <Icon.Sun className="size-5 text-amber-600 dark:hidden" aria-hidden="true" />
        </button>
        {user ? (
          <>
            {showNotifications ? (
              <Link href="/notifications" className={squareButton} aria-label={t("notifications.labelUnread", { count: unread })} title={t("nav.notifications")}>
                <Icon.Bell className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                {unread > 0 && <CountBadge count={unread} className="absolute -top-1.5 -inset-e-1.5 ring-2 ring-surface" />}
              </Link>
            ) : (
              languageButton
            )}
            <Link href="/settings" className={squareButton} aria-label={t("nav.settings")} title={t("nav.settings")}>
              <Icon.Settings className="size-5 text-violet-600 dark:text-violet-400" aria-hidden="true" />
            </Link>
          </>
        ) : (
          languageButton
        )}
      </div>
      <LanguageDialog open={languageOpen} onClose={() => setLanguageOpen(false)} />
    </aside>
  );
}
