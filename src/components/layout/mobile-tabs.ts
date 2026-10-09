import type { IconName } from "@/components/ui/icons";
import type { PublicUser, Settings } from "@/lib/types";
import { buildNavigation, buildShellNav, englishShellLabel, type ShellLabel, type ShellNav } from "@/lib/nav";

/** One destination on the phone bottom tab bar. */
export interface MobileTab {
  key: string;
  label: string;
  href: string;
  icon: IconName;
  /** Path prefixes that mark this tab as the current one. */
  match: string[];
  /** Only the exact href marks the tab as current (the guest home page "/"). */
  exact?: boolean;
  badge?: number;
}

/**
 * Bottom padding for content rendered above the tab bar: the bar's 4rem height
 * plus the device safe-area inset, removed from `lg` up where the bar is hidden.
 */
export const MOBILE_TAB_BAR_PADDING = "pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0";

/** The main destinations that get a phone tab (Messages and Manage are reached from the "You" tab). */
const TAB_KEYS = ["home", "courses", "discussions"] as const;

/**
 * Tabs for the phone bottom bar: Home, Courses and Discussions (the same main destinations as the sidebar),
 * followed by the member's "You" tab or "Log in", which the tab bar renders itself. `nav` is the shell
 * navigation the sidebar uses; without it, it is built from the user and settings.
 */
export function buildMobileTabs(user: PublicUser | null, settings: Settings, nav?: ShellNav, l: ShellLabel = englishShellLabel): MobileTab[] {
  const shell = nav ?? buildShellNav(user, settings, buildNavigation(user, settings, {}, l), l);
  return shell.primary
    .filter((item) => (TAB_KEYS as readonly string[]).includes(item.key))
    .map((item) => ({ key: item.key, label: item.label, href: item.href, icon: item.icon, match: item.match, exact: item.exact, badge: item.badge }));
}

/** Paths that belong to the member's "You" tab. */
export function youTabMatches(username: string): string[] {
  return ["/you", `/user/${username}`, "/settings", "/persona", "/notifications", "/messages", "/admin"];
}

export function isTabActive(pathname: string, match: string[], exact?: string): boolean {
  if (exact !== undefined) return pathname === exact;
  return match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
}
