import { AdminI18n } from "@/components/admin/i18n";

/** Hands the security settings form's messages (`securityForm.`) to this page's client components (see `src/components/admin/i18n-slices.ts`). */
export default function AdminSecuritySettingsLayout({ children }: LayoutProps<"/admin/settings/security">) {
  return <AdminI18n section="settingsSecurity">{children}</AdminI18n>;
}
