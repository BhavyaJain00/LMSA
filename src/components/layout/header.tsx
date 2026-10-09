"use client";

import Link from "next/link";
import type { Notification, PublicUser } from "@/lib/types";
import { Icon } from "@/components/ui/icons";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { ButtonLink } from "@/components/ui/button";
import { openCommandPalette } from "@/components/command-palette/events";
import { useT } from "@/i18n/client";
import { BrandMark } from "./brand-mark";
import { NotificationsBell } from "./notifications-bell";

/**
 * Phone and tablet top bar (hidden from `lg`, where the sidebar takes over): the site's mark, search, the
 * theme switch and notifications (members) or "Log in" (guests). Navigation is the bottom tab bar.
 */
export function Header({
  user,
  brand,
  notifications,
  unread,
  showNotifications,
}: {
  user: PublicUser | null;
  brand: { name: string; logoUrl?: string };
  notifications: Notification[];
  unread: number;
  showNotifications: boolean;
}) {
  const t = useT("shell");
  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-1 bg-surface/90 px-3 backdrop-blur sm:px-4 lg:hidden print:hidden">
      <Link href="/" className="me-auto min-w-0 rounded-lg py-1 focus-visible:outline-2 focus-visible:outline-accent">
        <BrandMark name={brand.name} logoUrl={brand.logoUrl} nameClassName="text-base font-bold" />
      </Link>
      <button
        type="button"
        onClick={openCommandPalette}
        className="rounded-lg p-2 text-ink-muted hover:bg-panel hover:text-ink"
        aria-label={t("header.search")}
        aria-keyshortcuts="Control+K Meta+K"
      >
        <Icon.Search className="size-5" />
      </button>
      <ThemeToggle />
      {user ? (
        showNotifications && <NotificationsBell notifications={notifications} unread={unread} />
      ) : (
        <ButtonLink href="/login" size="sm" className="ms-1">
          {t("header.logIn")}
        </ButtonLink>
      )}
    </header>
  );
}
