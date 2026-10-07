import { AdminI18n } from "@/components/admin/i18n";

/** Hands the backup and data-transfer messages (`backups.`, `dataPanel.`) to this page's client components. */
export default function AdminDataSettingsLayout({ children }: LayoutProps<"/admin/settings/data">) {
  return <AdminI18n section="settingsData">{children}</AdminI18n>;
}
