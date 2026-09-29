"use client";

import type { PublicUser } from "@/lib/types";
import { Avatar } from "@/components/ui/avatar";
import { Dropdown } from "@/components/ui/dropdown";
import { Icon } from "@/components/ui/icons";
import { logoutAction } from "@/lib/actions/auth";
import { roleLabels } from "@/lib/config";

export function UserMenu({ user }: { user: PublicUser }) {
  const isStaff = user.roles.some((r) => r !== "student");
  return (
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
          <p className="truncate text-xs text-ink-muted">{user.email}</p>
          <p className="mt-1 text-[11px] text-ink-faint">{user.roles.map((r) => roleLabels[r] ?? r).join(" · ")}</p>
        </div>
      }
      items={[
        { label: "Dashboard", href: "/dashboard", icon: <Icon.Home /> },
        { label: "My profile", href: `/user/${user.username}`, icon: <Icon.User /> },
        { label: "Edit profile", href: `/user/${user.username}/edit`, icon: <Icon.Edit /> },
        ...(isStaff ? [{ label: "Admin", href: "/admin", icon: <Icon.Layout /> }] : []),
        { label: "Account settings", href: "/settings", icon: <Icon.Settings /> },
        { label: "Security", href: "/settings/security", icon: <Icon.ShieldCheck /> },
        { label: "Email notifications", href: "/settings/notifications", icon: <Icon.Mail /> },
        { label: "Orders & invoices", href: "/billing/history", icon: <Icon.Receipt /> },
        { label: "You", description: "Your account hub and shortcuts", href: "/you", icon: <Icon.Smartphone /> },
        { label: "Log out", action: logoutAction, icon: <Icon.LogOut />, separator: true, destructive: true },
      ]}
    />
  );
}
