"use client";

import type { Notification, PublicUser } from "@/lib/types";
import { Icon } from "@/components/ui/icons";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { ButtonLink } from "@/components/ui/button";
import { useSidebar } from "./sidebar";
import { UserMenu } from "./user-menu";
import { NotificationsBell } from "./notifications-bell";
import { CommandPaletteButton } from "@/components/command-palette/open-button";
import { openCommandPalette } from "@/components/command-palette/events";
import { useT } from "@/i18n/client";

export function Header({
  user,
  notifications,
  unread,
  showNotifications,
  membership = false,
  gifts = false,
}: {
  user: PublicUser | null;
  notifications: Notification[];
  unread: number;
  showNotifications: boolean;
  /** Show the Membership link in the account menu. */
  membership?: boolean;
  /** Show the Gifts link in the account menu. */
  gifts?: boolean;
}) {
  const { setMobileOpen } = useSidebar();
  const t = useT("shell");

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-border bg-surface-1/90 px-3 backdrop-blur sm:px-5">
      <button type="button" onClick={() => setMobileOpen(true)} className="rounded-lg p-2 text-ink-muted hover:bg-surface-2 lg:hidden" aria-label={t("sidebar.openMenu")}>
        <Icon.Menu className="size-5" />
      </button>

      {/* Opens the command palette (Ctrl K / ⌘K): search courses, batches, jobs, people and pages. */}
      <div className="hidden max-w-md flex-1 sm:block">
        <CommandPaletteButton className="w-full" label={t("header.searchPlaceholder")} />
      </div>

      <div className="ms-auto flex items-center gap-1">
        <button
          type="button"
          onClick={openCommandPalette}
          className="rounded-lg p-2 text-ink-muted hover:bg-surface-2 sm:hidden"
          aria-label={t("header.search")}
          aria-keyshortcuts="Control+K Meta+K"
        >
          <Icon.Search className="size-5" />
        </button>
        <ThemeToggle />
        {user ? (
          <>
            {showNotifications && <NotificationsBell notifications={notifications} unread={unread} />}
            <UserMenu user={user} membership={membership} gifts={gifts} />
          </>
        ) : (
          <>
            <ButtonLink href="/login" variant="ghost" size="sm">
              {t("header.logIn")}
            </ButtonLink>
            <ButtonLink href="/register" size="sm">
              {t("header.signUp")}
            </ButtonLink>
          </>
        )}
      </div>
    </header>
  );
}
