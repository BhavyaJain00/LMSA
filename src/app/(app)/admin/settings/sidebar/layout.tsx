import { AdminI18n } from "@/components/admin/i18n";

/** Hands the sidebar manager's messages (`sidebarManager.`) to this page's client components (see `src/components/admin/i18n-slices.ts`). */
export default function AdminSidebarSettingsLayout({ children }: LayoutProps<"/admin/settings/sidebar">) {
  return <AdminI18n section="settingsSidebar">{children}</AdminI18n>;
}
