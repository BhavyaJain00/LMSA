"use client";

import { useCallback, useState } from "react";
import type { PublicUser } from "@/lib/types";
import type { NavItem, ShellKey } from "@/lib/nav";
import { Avatar } from "@/components/ui/avatar";
import { Dropdown, type DropdownItem } from "@/components/ui/dropdown";
import { Icon } from "@/components/ui/icons";
import { logoutAction } from "@/lib/actions/auth";
import { LOCALE_INFO } from "@/i18n/config";
import { useLocale, useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { LanguageDialog } from "./language-switcher";

/**
 * Account menu, kept short: profile, the member's personal pages (`extra`: peer reviews, team, teaching,
 * affiliate...), settings, orders, language and log out. Security, privacy and email preferences live inside
 * Settings. `variant="card"` is the account card at the bottom of the sidebar (opens upwards); the default is
 * the avatar button used in top bars.
 */
export function UserMenu({
  user,
  membership = false,
  gifts = false,
  extra = [],
  variant = "avatar",
  collapsed = false,
}: {
  user: PublicUser;
  /** Show the Membership link (subscriptions are on, or the member has one). */
  membership?: boolean;
  /** Show the gift purchases page. */
  gifts?: boolean;
  /** Personal pages from the navigation (see `ShellNav.account`). */
  extra?: NavItem[];
  variant?: "avatar" | "card";
  /** Card variant in the collapsed sidebar: avatar only. */
  collapsed?: boolean;
}) {
  const t = useT("shell");
  const locale = useLocale();
  const [languageOpen, setLanguageOpen] = useState(false);
  const closeLanguage = useCallback(() => setLanguageOpen(false), []);
  const isStaff = user.roles.some((r) => r !== "student");
  const roleLabel = (role: string) => {
    const key = `roles.${role}` as ShellKey;
    return t.has(key) ? t(key) : role;
  };

  const profileHref = `/user/${user.username}`;
  const fixed = new Set([profileHref, "/settings", "/billing/history", "/settings/subscription", "/gift", "/admin"]);
  const items: DropdownItem[] = [
    { label: t("menu.myProfile"), href: profileHref, icon: <Icon.User /> },
    ...extra
      .filter((item) => !fixed.has(item.href))
      .map((item): DropdownItem => {
        const IconCmp = Icon[item.icon] ?? Icon.Dot;
        return { label: item.label, href: item.href, icon: <IconCmp /> };
      }),
    ...(isStaff && variant === "avatar" ? [{ label: t("nav.manage"), href: "/admin", icon: <Icon.Layout /> }] : []),
    { label: t("nav.settings"), href: "/settings", icon: <Icon.Settings />, separator: true },
    { label: t("menu.orders"), href: "/billing/history", icon: <Icon.Receipt /> },
    ...(membership ? [{ label: t("menu.membership"), href: "/settings/subscription", icon: <Icon.Star /> }] : []),
    ...(gifts ? [{ label: t("menu.gifts"), href: "/gift", icon: <Icon.Gift /> }] : []),
    {
      label: t("menu.language"),
      description: <span lang={locale}>{LOCALE_INFO[locale].nativeName}</span>,
      icon: <Icon.Globe />,
      onClick: () => setLanguageOpen(true),
    },
    { label: t("menu.logOut"), action: logoutAction, icon: <Icon.LogOut />, separator: true, destructive: true },
  ];

  const header = (
    <div className="min-w-0">
      <p className="truncate text-sm font-semibold text-ink">{user.name}</p>
      <p className="truncate text-xs text-ink-muted" dir="ltr">
        {user.email}
      </p>
      {isStaff && <p className="mt-1 text-micro text-ink-faint">{user.roles.map(roleLabel).join(" · ")}</p>}
    </div>
  );

  const trigger =
    variant === "card" ? (
      <span
        className={cn(
          "flex w-full items-center gap-3 rounded-xl bg-panel p-2.5 text-start ring-1 ring-border transition-colors hover:bg-surface-1",
          collapsed && "justify-center p-2",
        )}
      >
        <Avatar name={user.name} src={user.avatarUrl} size={collapsed ? "sm" : "md"} />
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink">{user.name}</span>
              <span className="block truncate text-xs text-ink-faint">{t("sidebar.viewAccount")}</span>
            </span>
            <Icon.ChevronsUpDown className="size-4 shrink-0 text-ink-faint" />
          </>
        )}
      </span>
    ) : (
      <span className="flex items-center gap-2 rounded-lg p-1 hover:bg-surface-2">
        <Avatar name={user.name} src={user.avatarUrl} size="sm" />
        <Icon.ChevronDown className="hidden size-4 text-ink-faint sm:block" />
      </span>
    );

  return (
    <>
      <Dropdown
        trigger={trigger}
        header={header}
        items={items}
        label={t("sidebar.accountMenu")}
        side={variant === "card" ? "top" : "bottom"}
        align={variant === "card" ? "start" : "end"}
        className={variant === "card" ? "block w-full" : undefined}
        triggerClassName={variant === "card" ? "w-full" : undefined}
        menuClassName={variant === "card" ? "w-64" : undefined}
      />
      <LanguageDialog open={languageOpen} onClose={closeLanguage} />
    </>
  );
}
