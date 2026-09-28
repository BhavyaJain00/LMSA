"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { Notification, PublicUser } from "@/lib/types";
import { Icon } from "@/components/ui/icons";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { ButtonLink } from "@/components/ui/button";
import { useSidebar } from "./sidebar";
import { UserMenu } from "./user-menu";
import { NotificationsBell } from "./notifications-bell";

export function Header({
  user,
  notifications,
  unread,
  showNotifications,
}: {
  user: PublicUser | null;
  notifications: Notification[];
  unread: number;
  showNotifications: boolean;
}) {
  const { setMobileOpen } = useSidebar();
  const router = useRouter();
  const [q, setQ] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    router.push(term ? `/courses?search=${encodeURIComponent(term)}` : "/courses");
  };

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-border bg-surface-1/90 px-3 backdrop-blur sm:px-5">
      <button type="button" onClick={() => setMobileOpen(true)} className="rounded-lg p-2 text-ink-muted hover:bg-surface-2 lg:hidden" aria-label="Open menu">
        <Icon.Menu className="size-5" />
      </button>

      <form onSubmit={submit} role="search" className="relative hidden max-w-md flex-1 sm:block">
        <Icon.Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search courses…"
          className="h-9 w-full rounded-lg border border-border bg-surface-2 pl-9 pr-12 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:bg-surface-1 focus:outline-none focus:ring-2 focus:ring-accent/25"
        />
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-surface-1 px-1.5 text-[10px] text-ink-faint md:block">/</kbd>
      </form>

      <div className="ml-auto flex items-center gap-1">
        <Link href="/courses" className="rounded-lg p-2 text-ink-muted hover:bg-surface-2 sm:hidden" aria-label="Search">
          <Icon.Search className="size-5" />
        </Link>
        <ThemeToggle />
        {user ? (
          <>
            {showNotifications && <NotificationsBell notifications={notifications} unread={unread} />}
            <UserMenu user={user} />
          </>
        ) : (
          <>
            <ButtonLink href="/login" variant="ghost" size="sm">
              Log in
            </ButtonLink>
            <ButtonLink href="/register" size="sm">
              Sign up
            </ButtonLink>
          </>
        )}
      </div>
    </header>
  );
}
