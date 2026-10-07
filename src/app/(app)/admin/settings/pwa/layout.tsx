import { AdminI18n } from "@/components/admin/i18n";

/** Hands the app install settings form's messages (`pwaForm.`) to this page's client components (see `src/components/admin/i18n-slices.ts`). */
export default function AdminPwaSettingsLayout({ children }: LayoutProps<"/admin/settings/pwa">) {
  return <AdminI18n section="settingsPwa">{children}</AdminI18n>;
}
