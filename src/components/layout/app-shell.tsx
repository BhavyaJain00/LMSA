import type { ReactNode } from "react";
import { getCurrentPublicUser } from "@/lib/auth/session";
import { getDb, getSettings } from "@/lib/db/store";
import { cn } from "@/lib/utils";
import { buildNavigation } from "@/lib/nav";
import { getNotifications, getUnreadCount } from "@/lib/services/notifications";
import { AccountSecurityBanner } from "@/components/security/account-security-banner";
import { Header } from "./header";
import { MobileTabBar } from "./mobile-tab-bar";
import { buildMobileTabs, MOBILE_TAB_BAR_PADDING } from "./mobile-tabs";
import { Sidebar, SidebarProvider } from "./sidebar";

/**
 * Sidebar + header shell used by every page except auth screens, the lesson
 * player and the printable certificate.
 */
export async function AppShell({ children, contained = true }: { children: ReactNode; contained?: boolean }) {
  const [user, settings] = await Promise.all([getCurrentPublicUser(), getSettings()]);
  let notifications: Awaited<ReturnType<typeof getNotifications>> = [];
  let unread = 0;
  let grading = 0;
  if (user) {
    [notifications, unread] = await Promise.all([getNotifications(user.id, 10), getUnreadCount(user.id)]);
    if (user.roles.some((r) => r !== "student")) {
      const db = await getDb();
      grading = db.assignmentSubmissions.filter((s) => s.status === "not_graded").length;
    }
  }
  const sections = buildNavigation(user, settings, { unread, grading });
  const tabs = buildMobileTabs(user, settings, settings.features.notifications ? unread : 0);

  return (
    <SidebarProvider>
      <div className="flex min-h-screen">
        <Sidebar sections={sections} brand={{ name: settings.brand.name, logoUrl: settings.brand.logoUrl }} />
        {/* Below lg the phone tab bar is fixed to the bottom, so the column reserves its height. */}
        <div className={cn("flex min-w-0 flex-1 flex-col", MOBILE_TAB_BAR_PADDING)}>
          <Header user={user} notifications={notifications} unread={unread} showNotifications={settings.features.notifications} />
          <main className={contained ? "mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8" : "flex-1"}>
            {/* Email verification / required 2FA notice (renders nothing when there is nothing to do). */}
            <AccountSecurityBanner className={contained ? undefined : "mx-4 mt-4 sm:mx-6 lg:mx-8"} />
            {children}
          </main>
          {settings.brand.footerText && <footer className="border-t border-border px-6 py-4 text-center text-xs text-ink-faint">{settings.brand.footerText}</footer>}
        </div>
      </div>
      <MobileTabBar tabs={tabs} user={user ? { name: user.name, username: user.username, avatarUrl: user.avatarUrl } : null} />
    </SidebarProvider>
  );
}
