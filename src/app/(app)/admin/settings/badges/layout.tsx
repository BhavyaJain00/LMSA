import { AdminI18n } from "@/components/admin/i18n";

/** Hands the badge manager's messages (`badges.`) to this page's client components. */
export default function AdminBadgesSettingsLayout({ children }: LayoutProps<"/admin/settings/badges">) {
  return <AdminI18n section="settingsBadges">{children}</AdminI18n>;
}
