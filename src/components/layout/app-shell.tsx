import type { ReactNode } from "react";
import { getCurrentPublicUser } from "@/lib/auth/session";
import { getDb, getSettings } from "@/lib/db/store";
import { cn } from "@/lib/utils";
import { buildNavigation, navContextFor, type NavContext } from "@/lib/nav";
import { countUnreadMessages } from "@/lib/comms/messages";
import { getNotifications, getUnreadCount } from "@/lib/services/notifications";
import { AccountSecurityBanner } from "@/components/security/account-security-banner";
import { SiteFooter } from "@/components/marketing/site-footer";
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
  let context: NavContext = {};
  let membership = false;
  if (user) {
    [notifications, unread] = await Promise.all([getNotifications(user.id, 10), getUnreadCount(user.id)]);
    const db = await getDb();
    if (user.roles.some((r) => r !== "student")) {
      grading = db.assignmentSubmissions.filter((s) => s.status === "not_graded").length;
    }
    context = { ...navContextFor(db, user.id), messages: countUnreadMessages(db, user.id) };
    membership = settings.growth.subscriptionsEnabled || db.subscriptions.some((s) => s.userId === user.id);
  }
  const sections = buildNavigation(user, settings, { ...context, unread, grading });
  const tabs = buildMobileTabs(user, settings, settings.features.notifications ? unread : 0);

  return (
    <SidebarProvider>
      <div className="flex min-h-screen">
        <Sidebar sections={sections} brand={{ name: settings.brand.name, logoUrl: settings.brand.logoUrl }} />
        {/* Below lg the phone tab bar is fixed to the bottom, so the column reserves its height. */}
        <div className={cn("flex min-w-0 flex-1 flex-col", MOBILE_TAB_BAR_PADDING)}>
          <Header
            user={user}
            notifications={notifications}
            unread={unread}
            showNotifications={settings.features.notifications}
            membership={membership}
            gifts={settings.growth.giftsEnabled}
          />
          <main className={contained ? "mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8" : "flex-1"}>
            {/* Email verification / required 2FA notice (renders nothing when there is nothing to do). */}
            <AccountSecurityBanner className={contained ? undefined : "mx-4 mt-4 sm:mx-6 lg:mx-8"} />
            {children}
          </main>
          <SiteFooter />
        </div>
      </div>
      <MobileTabBar tabs={tabs} user={user ? { name: user.name, username: user.username, avatarUrl: user.avatarUrl } : null} />
    </SidebarProvider>
  );
}
