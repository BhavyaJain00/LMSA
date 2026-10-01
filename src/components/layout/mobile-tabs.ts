import type { IconName } from "@/components/ui/icons";
import type { PublicUser, Settings } from "@/lib/types";
import { englishShellLabel, type ShellLabel } from "@/lib/nav";

/** One destination on the phone bottom tab bar. */
export interface MobileTab {
  key: string;
  label: string;
  href: string;
  icon: IconName;
  /** Path prefixes that mark this tab as the current one. */
  match: string[];
  badge?: number;
}

/**
 * Bottom padding for content rendered above the tab bar: the bar's 4rem height
 * plus the device safe-area inset, removed from `lg` up where the bar is hidden.
 */
export const MOBILE_TAB_BAR_PADDING = "pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0";

/** Most tabs besides the trailing "You" / "Log in" tab. */
const MAX_TABS = 4;

/**
 * Tabs for the phone bottom bar (MobileLayout in Frappe LMS). Signed-in members
 * get Home, Courses, Batches and Notifications (falling back to Programs and
 * Jobs when a feature is switched off) followed by their "You" tab; guests get
 * Courses, Batches, Jobs and Statistics followed by "Log in". The trailing tab
 * is rendered separately, so it is not part of this list.
 */
export function buildMobileTabs(user: PublicUser | null, settings: Settings, unread = 0, l: ShellLabel = englishShellLabel): MobileTab[] {
  const f = settings.features;
  const candidates: (MobileTab | false)[] = user
    ? [
        { key: "home", label: l("tabs.home"), href: "/dashboard", icon: "Home", match: ["/dashboard"] },
        f.courses && { key: "courses", label: l("nav.courses"), href: "/courses", icon: "BookOpen", match: ["/courses"] },
        f.batches && { key: "batches", label: l("nav.batches"), href: "/batches", icon: "Users", match: ["/batches"] },
        f.notifications && { key: "notifications", label: l("nav.notifications"), href: "/notifications", icon: "Bell", match: ["/notifications"], badge: unread },
        f.programs && { key: "programs", label: l("nav.programs"), href: "/programs", icon: "Layers", match: ["/programs"] },
        f.jobs && { key: "jobs", label: l("nav.jobs"), href: "/jobs", icon: "Briefcase", match: ["/jobs"] },
      ]
    : [
        f.courses && { key: "courses", label: l("nav.courses"), href: "/courses", icon: "BookOpen", match: ["/courses"] },
        f.batches && { key: "batches", label: l("nav.batches"), href: "/batches", icon: "Users", match: ["/batches"] },
        f.jobs && { key: "jobs", label: l("nav.jobs"), href: "/jobs", icon: "Briefcase", match: ["/jobs"] },
        f.statistics && settings.learning.allowGuestAccess && { key: "statistics", label: l("nav.statistics"), href: "/statistics", icon: "BarChart", match: ["/statistics"] },
        f.programs && { key: "programs", label: l("nav.programs"), href: "/programs", icon: "Layers", match: ["/programs"] },
      ];
  return candidates.filter((t): t is MobileTab => !!t).slice(0, MAX_TABS);
}

/** Paths that belong to the member's "You" tab. */
export function youTabMatches(username: string): string[] {
  return ["/you", `/user/${username}`, "/settings", "/persona"];
}

export function isTabActive(pathname: string, match: string[]): boolean {
  return match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
}
