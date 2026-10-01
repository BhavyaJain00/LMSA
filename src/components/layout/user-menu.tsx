"use client";

import { useCallback, useState } from "react";
import type { PublicUser } from "@/lib/types";
import { Avatar } from "@/components/ui/avatar";
import { Dropdown } from "@/components/ui/dropdown";
import { Icon } from "@/components/ui/icons";
import { logoutAction } from "@/lib/actions/auth";
import { LOCALE_INFO } from "@/i18n/config";
import { useLocale, useT } from "@/i18n/client";
import type { ShellKey } from "@/lib/nav";
import { LanguageDialog } from "./language-switcher";

/**
 * Account menu. `membership` shows the Membership link (subscriptions are on,
 * or the member has one); `gifts` shows the gift purchases page. "Language"
 * opens the language picker.
 */
export function UserMenu({ user, membership = false, gifts = false }: { user: PublicUser; membership?: boolean; gifts?: boolean }) {
  const t = useT("shell");
  const locale = useLocale();
  const [languageOpen, setLanguageOpen] = useState(false);
  const closeLanguage = useCallback(() => setLanguageOpen(false), []);
  const isStaff = user.roles.some((r) => r !== "student");
  const roleLabel = (role: string) => {
    const key = `roles.${role}` as ShellKey;
    return t.has(key) ? t(key) : role;
  };
  return (
    <>
      <Dropdown
        trigger={
          <span className="flex items-center gap-2 rounded-lg p-1 hover:bg-surface-2">
            <Avatar name={user.name} src={user.avatarUrl} size="sm" />
            <Icon.ChevronDown className="hidden size-4 text-ink-faint sm:block" />
          </span>
        }
        header={
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">{user.name}</p>
            <p className="truncate text-xs text-ink-muted" dir="ltr">
              {user.email}
            </p>
            <p className="mt-1 text-[11px] text-ink-faint">{user.roles.map(roleLabel).join(" · ")}</p>
          </div>
        }
        items={[
          { label: t("menu.dashboard"), href: "/dashboard", icon: <Icon.Home /> },
          { label: t("menu.myProfile"), href: `/user/${user.username}`, icon: <Icon.User /> },
          { label: t("menu.editProfile"), href: `/user/${user.username}/edit`, icon: <Icon.Edit /> },
          ...(isStaff ? [{ label: t("menu.admin"), href: "/admin", icon: <Icon.Layout /> }] : []),
          { label: t("menu.accountSettings"), href: "/settings", icon: <Icon.Settings /> },
          { label: t("menu.security"), href: "/settings/security", icon: <Icon.ShieldCheck /> },
          { label: t("menu.emailNotifications"), href: "/settings/notifications", icon: <Icon.Mail /> },
          { label: t("menu.privacy"), href: "/settings/privacy", icon: <Icon.Shield /> },
          { label: t("menu.orders"), href: "/billing/history", icon: <Icon.Receipt /> },
          ...(membership ? [{ label: t("menu.membership"), href: "/settings/subscription", icon: <Icon.Star /> }] : []),
          ...(gifts ? [{ label: t("menu.gifts"), href: "/gift", icon: <Icon.Gift /> }] : []),
          { label: t("menu.you"), description: t("menu.youDescription"), href: "/you", icon: <Icon.Smartphone /> },
          {
            label: t("menu.language"),
            description: <span lang={locale}>{LOCALE_INFO[locale].nativeName}</span>,
            icon: <Icon.Globe />,
            onClick: () => setLanguageOpen(true),
            separator: true,
          },
          { label: t("menu.logOut"), action: logoutAction, icon: <Icon.LogOut />, separator: true, destructive: true },
        ]}
      />
      <LanguageDialog open={languageOpen} onClose={closeLanguage} />
    </>
  );
}
